// POST /.netlify/functions/media-transcription-webhook
//
// Step 3: the transcription provider calls this when a job finishes. This is
// the only endpoint in the product reached by an unauthenticated third party,
// so it is written defensively:
//
//   - A shared secret header, compared in constant time, is required. No
//     secret, no state change.
//   - The webhook BODY is never trusted for content. It only names a job; the
//     transcript itself is then fetched over an authenticated server-to-server
//     call to the provider. A forged webhook therefore cannot inject a single
//     character of training content.
//   - An unknown providerJobId is refused.
//   - Duplicate delivery (providers retry) is idempotent - it re-reports the
//     current state and changes nothing.
//   - A failed transcription NEVER creates a Company Knowledge record.
//
// There is deliberately no verifyRequestOrigin() here: this is a
// server-to-server call, not a browser request.

import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';
import { transcriptionAdapterFromEnv, WEBHOOK_AUTH_HEADER } from './lib/transcription-provider.mjs';
import { transcriptIntegrity } from './lib/media-ingestion.mjs';
import {
  STORE_NAME, reply, clean,
  loadJobIndex, loadMedia, loadJob, saveJob, transitionMedia, writeMediaAudit,
  knowledgeRecordFromTranscript, saveKnowledgeRecord
} from './lib/media-records.mjs';

// States that mean this job's outcome has already been recorded.
const SETTLED = new Set(['transcript_ready', 'processing', 'ready', 'failed']);

function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  // timingSafeEqual throws on length mismatch, so compare lengths first - the
  // length of a secret is not itself sensitive.
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// A webhook actor for the shared audit trail: a real, named non-human actor
// rather than a fake user identity.
const WEBHOOK_ACTOR = { id: 'transcription-provider', email: '', roles: ['system'] };

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });

    const { adapter, webhookSecret } = transcriptionAdapterFromEnv(process.env);
    // Without a configured provider there is no secret to verify against, so
    // nothing can be accepted. Fail closed.
    if (!adapter || !webhookSecret) return reply(503, { error: 'Transcription is not configured.', code: 'transcription_not_configured' });

    if (!secretMatches(req.headers.get(WEBHOOK_AUTH_HEADER), webhookSecret)) {
      console.warn('media-transcription-webhook rejected an unauthenticated callback');
      return reply(401, { error: 'Unauthorized.' });
    }

    const body = await req.json().catch(() => ({}));
    const { providerJobId, status } = adapter.parseWebhook(body);
    if (!providerJobId) return reply(400, { error: 'providerJobId is required.' });

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const index = await loadJobIndex(store, providerJobId);
    if (!index) return reply(404, { error: 'Unknown transcription job.', code: 'unknown_job' });

    const media = await loadMedia(store, index.teamId, index.mediaId);
    const job = await loadJob(store, index.teamId, index.jobId);
    if (!media || !job) return reply(404, { error: 'Unknown transcription job.', code: 'unknown_job' });

    // Idempotency: a retried delivery for an already-settled job must not
    // start a second transcript or a second knowledge record.
    if (SETTLED.has(job.state) || SETTLED.has(media.state)) {
      return reply(200, { duplicate: true, mediaState: media.state, jobState: job.state });
    }

    if (status === 'pending') return reply(200, { ignored: true, mediaState: media.state });

    if (status === 'failed') {
      await saveJob(store, { ...job, state: 'failed', finishedAt: new Date().toISOString() });
      await transitionMedia(store, media, 'failed', { failureReason: 'transcription_provider_failed' });
      await writeMediaAudit(store, index.teamId, WEBHOOK_ACTOR, 'media_transcription_complete', 'failed', { mediaId: media.id, jobId: job.id, reason: 'provider_failed' });
      // No Company Knowledge record is created. Nothing is fabricated.
      return reply(200, { accepted: true, mediaState: 'failed' });
    }

    // status === 'completed': fetch the transcript over an authenticated call.
    const result = await adapter.fetchTranscript(providerJobId);
    if (result.status === 'pending') return reply(200, { ignored: true, mediaState: media.state });
    if (result.status === 'failed' || !String(result.text || '').trim()) {
      await saveJob(store, { ...job, state: 'failed', finishedAt: new Date().toISOString() });
      await transitionMedia(store, media, 'failed', { failureReason: result.status === 'failed' ? 'transcription_provider_failed' : 'empty_transcript' });
      await writeMediaAudit(store, index.teamId, WEBHOOK_ACTOR, 'media_transcription_complete', 'failed', { mediaId: media.id, jobId: job.id, reason: result.status === 'failed' ? 'provider_failed' : 'empty_transcript' });
      return reply(200, { accepted: true, mediaState: 'failed' });
    }

    // Source before derivatives: record the transcript and its hash on the job
    // FIRST, so the transcript is never lost even if the knowledge write below
    // fails and has to be retried.
    const integrity = transcriptIntegrity(result.text);
    const finishedJob = await saveJob(store, {
      ...job,
      state: 'transcript_ready',
      transcriptSha256: integrity.transcriptSha256,
      transcriptChars: integrity.transcriptChars,
      finishedAt: new Date().toISOString()
    });
    let current = await transitionMedia(store, media, 'transcript_ready', { transcriptChars: integrity.transcriptChars });

    // Hand off to the existing Company Knowledge pipeline.
    current = await transitionMedia(store, current, 'processing');
    let knowledge;
    try {
      knowledge = knowledgeRecordFromTranscript({
        media: current,
        job: finishedJob,
        transcriptText: result.text,
        title: clean(current.title, 240) || current.fileName,
        createdBy: current.createdBy
      });
    } catch (error) {
      // Over the authoritative Company Knowledge character limit: reject
      // clearly rather than truncate. The transcript and its hash stay on the
      // job record - nothing is discarded silently.
      await transitionMedia(store, current, 'failed', { failureReason: error?.code === 'source_too_long' ? 'transcript_exceeds_source_limit' : 'knowledge_handoff_failed' });
      await writeMediaAudit(store, index.teamId, WEBHOOK_ACTOR, 'media_knowledge_handoff', 'failed', { mediaId: current.id, jobId: finishedJob.id, reason: clean(error?.code || 'knowledge_handoff_failed', 80), transcriptChars: integrity.transcriptChars });
      return reply(200, { accepted: true, mediaState: 'failed', error: clean(error?.message, 400) });
    }

    await saveKnowledgeRecord(store, knowledge);
    current = await transitionMedia(store, current, 'ready', { knowledgeId: knowledge.id });
    await writeMediaAudit(store, index.teamId, WEBHOOK_ACTOR, 'media_knowledge_handoff', 'success', {
      mediaId: current.id, jobId: finishedJob.id, knowledgeId: knowledge.id,
      transcriptChars: integrity.transcriptChars, transcriptSha256: integrity.transcriptSha256
    });

    // The new source is a DRAFT: a manager still has to run AI Analysis and
    // Approve it before any learner sees anything derived from it.
    return reply(200, { accepted: true, mediaState: 'ready', knowledgeId: knowledge.id });
  } catch (error) {
    console.error('media-transcription-webhook failed', error?.message || error);
    return reply(error?.status || 500, { error: error?.message || 'Webhook processing failed.', code: error?.code || 'webhook_failed' });
  }
}
