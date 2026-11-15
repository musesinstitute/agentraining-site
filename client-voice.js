/* Client Discovery voice capture: user-controlled audio recording + server transcription.
   No Web Speech API and no automatic submission to analysis. */
(function () {
  'use strict';
  const MAX_AUDIO_BYTES = 2500000;
  const MAX_RECORD_MS = 90000;
  const MIME_TYPES = [
    'audio/webm;codecs=opus', 'audio/webm',
    'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'
  ];
  const tx = (en, zh) => {
    const q = new URLSearchParams(location.search);
    return (q.get('lang') || sessionStorage.getItem('agentraining_lang') || navigator.language || 'en')
      .toLowerCase().startsWith('zh') ? zh : en;
  };
  window.setupClientDiscoveryVoice = function (button, input, status, canRecord, onBusy) {
    let stream = null, recorder = null, deadline = null;
    let working = false, session = 0;
    const idle = () => { button.textContent = button.dataset?.compactVoice === 'true' ? '🎤' : tx('🎤 Record answer', '🎤 录制回答'); button.title = tx('Record speech and review transcript before sending', '录音转写后先核对文字，再发送'); button.setAttribute('aria-label', button.title); };
    const setBusy = active => { if (typeof onBusy === 'function') onBusy(active); };
    const stopTracks = () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      if (deadline) clearTimeout(deadline);
      deadline = null;
    };
    const stop = (discard) => {
      if (discard) session += 1;
      if (recorder && recorder.state === 'recording') recorder.stop();
      else stopTracks();
    };
    const cleanup = () => {
      session += 1;
      stop(true);
      working = false; button.disabled = false; idle(); setBusy(false);
    };
    async function start() {
      if (working || (recorder && recorder.state === 'recording')) return;
      if (typeof canRecord === 'function' && !canRecord()) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        status(tx('This browser cannot record audio. Type your answer instead.',
                  '此浏览器不能录音，请改用手动输入。'));
        return;
      }
      const token = ++session;
      working = true;
      button.disabled = true; setBusy(true);
      status(tx('Checking cloud transcription service…', '正在检查语音转写服务…'));
      let micRequested = false;
      try {
        const ready = await fetch('/.netlify/functions/transcribe-audio', { method: 'GET' });
        const capability = await ready.json().catch(() => ({}));
        if (token !== session) return;
        if (!ready.ok || !capability.ready) {
          status(tx('Cloud transcription is not ready on this preview (API credentials or rate-limit storage). No recording was started. Please type your answer.',
                    '测试版语音服务尚未就绪（API 凭证或请求限制存储）。麦克风未启动，请先使用文字输入。'));
          working = false; button.disabled = false; idle(); setBusy(false); return;
        }
        status(tx('Requesting microphone access…', '正在请求麦克风权限…'));
        micRequested = true;
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (token !== session) { microphone.getTracks().forEach(track => track.stop()); working = false; setBusy(false); return; }
        stream = microphone;
        const mime = MIME_TYPES.find(type => MediaRecorder.isTypeSupported?.(type));
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const ownRecorder = recorder;
        const ownChunks = [];
        recorder.ondataavailable = e => { if (e.data?.size) ownChunks.push(e.data); };
        recorder.onerror = () => {
          if (token === session) status(tx('Audio recording failed. Please type your answer.', '录音失败，请改用手动输入。'));
          stop(true); working = false; button.disabled = false; idle(); setBusy(false);
        };
        recorder.onstop = async () => {
          microphone.getTracks().forEach(track => track.stop());
          if (recorder === ownRecorder) {
            if (deadline) clearTimeout(deadline);
            deadline = null; stream = null; recorder = null;
          }
          const audio = new Blob(ownChunks, { type: ownRecorder.mimeType || mime || '' });
          if (token !== session) return;
          if (!audio.size) {
            status(tx('No audio was recorded. Please try again.', '没有录到声音，请重试。'));
            button.disabled = false; idle(); setBusy(false); return;
          }
          if (audio.size > MAX_AUDIO_BYTES) {
            status(tx('Recording is too large to transcribe. Try a shorter segment; no text was replaced.',
                      '录音文件超过转写限制，请分段重录；原有文字没有被覆盖。'));
            button.disabled = false; idle(); setBusy(false); return;
          }
          button.disabled = true;
          status(tx('Transcribing Chinese, English and insurance terms…',
                    '正在转写中英文及保险专业术语…'));
          try {
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result).split(',')[1]);
              reader.onerror = () => reject(new Error('Audio read failed'));
              reader.readAsDataURL(audio);
            });
            const res = await fetch('/.netlify/functions/transcribe-audio', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audioBase64: base64, mimeType: audio.type })
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(result.error || 'Transcription unavailable');
            if (token !== session) return;
            const words = String(result.text || '').trim();
            if (!words) throw new Error('Empty transcript');
            const previous = input.value.trim();
            const combined = [previous, words].filter(Boolean).join('\n');
            const maxText = input.maxLength > 0 ? input.maxLength : 8000;
            if (combined.length > maxText) {
              // Do not silently cut or replace user speech.
              throw new Error(tx('Transcript exceeds answer length limit. Record a shorter segment.',
                                 '转写文字超过输入框上限，请分段录音，原有文字已保留。'));
            }
            input.value = combined;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            status(tx('Transcript added. Correct names and terms before sending to AI.',
                      '转写已加入输入框。请先核对姓名与术语，确认后再发送给 AI。'));
            input.focus();
          } catch (err) {
            if (token === session) status(tx('Transcription failed: ', '转写失败：') + (err.message || 'Unknown error') +
              tx('. You may type your answer; existing text is safe.', '。可手动输入，已有文字未丢失。'));
          } finally {
            if (token === session) { working = false; button.disabled = false; idle(); setBusy(false); }
          }
        };
        recorder.start();
        working = false;
        button.disabled = false;
        button.textContent = button.dataset?.compactVoice === 'true' ? '■' : tx('■ Stop & transcribe', '■ 停止并转写'); button.title = tx('Stop recording and transcribe', '停止录音并开始转写'); button.setAttribute('aria-label', button.title);
        status(tx('Recording (up to 90 seconds). Stop to transcribe; pauses will not end recording. No audio is saved in this browser.',
                  '正在录音（最长90秒）。说完请点停止并转写；停顿不会自动结束。录音不会保存在浏览器中。'));
        deadline = setTimeout(() => {
          if (recorder && recorder.state === 'recording') {
            status(tx('90 seconds reached. Transcribing this segment; you can record another afterward.',
                      '已录满90秒，正在转写本段；之后可继续录下一段。'));
            recorder.stop();
          }
        }, MAX_RECORD_MS);
      } catch (err) {
        if (token === session) {
          status(micRequested ? tx('Microphone unavailable. Check browser permission, or type your answer.',
                    '无法使用麦克风，请检查浏览器权限或手动输入。') : tx('Voice service check failed. Please type your answer.', '语音转写服务检查失败，请先使用文字输入。'));
          stopTracks(); working = false; button.disabled = false; idle(); setBusy(false);
        }
      }
    }
    button.addEventListener('click', () => {
      if (recorder && recorder.state === 'recording') {
        button.disabled = true; status(tx('Preparing transcript…', '正在准备转写…'));
        recorder.stop();
      } else start();
    });
    idle();
    return { cancel: cleanup, recording: () => recorder?.state === 'recording' };
  };
})();
