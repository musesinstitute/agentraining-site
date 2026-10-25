import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const opening = read('manager-demo-opening.html');
const hub = read('manager-demo-hub.html');
const phases = read('manager-demo-phases.html');
const mission = read('mission-control-v2-1.html');
const pilot = read('pilot-start.html');
const review = read('manager-demo-review.html');

test('canonical four-chapter path and back navigation are preserved', () => {
  assert.match(opening, /href="manager-demo-hub\.html"/);
  assert.match(hub, /href="manager-demo-phases\.html"/);
  assert.match(hub, /href="manager-demo-opening\.html"/);
  assert.match(phases, /href="mission-control-v2-1\.html"/);
  assert.match(phases, /href="manager-demo-hub\.html"/);
  assert.match(mission, /href="manager-demo-phases\.html"/);
  assert.match(mission, /href="manager-demo-opening\.html"/);
  assert.match(review, /href="manager-demo-opening\.html"/);
});

test('all core demonstration assets and human manager judgment survive', () => {
  assert.match(opening, /Who helps you manage the risks in your team/);
  for (const name of ['Practice Studio', 'Client Studio', 'Knowledge Studio', 'Leadership Studio'])
    assert.match(hub, new RegExp(name));
  assert.match(hub, /data-studio="3"/);
  assert.match(phases, /Three Phases\. Seven Steps/);
  assert.match(phases, /Michelle Torres/);
  assert.match(phases, /Review & Reassess/);
  assert.match(phases, /AI recommends; the manager decides/);
  assert.match(mission, /Mission Control/);
  assert.match(mission, /V2\.2/);
  for (const id of ['saveOverride', 'toStep5', 'reassessReport', 'openReassessReport'])
    assert.match(mission, new RegExp(id));
});

test('Chapter 4 connects to existing Pilot form and labelled Day-14 mock report', () => {
  assert.match(mission, /id="pilotInvitation"/);
  assert.match(mission, /Day 14 Team Readiness Report/);
  assert.match(mission, /illustrative template/);
  assert.match(mission, /Insufficient evidence stays labelled/);
  assert.match(mission, /Expand \/ Adjust \/ Stop/);
  assert.match(mission, /href="\/pilot-start\.html"/);
  assert.match(mission, /Pilot access is requested, not automatically granted/);
  assert.match(mission, /No learner records, assignments or manager feedback are changed/);
});

test('real Pilot request path remains a Netlify form, not subscription or account creation', () => {
  assert.match(pilot, /<form name="pilot-request" method="POST" action="\/pilot-requested\.html" data-netlify="true"/);
  assert.match(pilot, /name="form-name" value="pilot-request"/);
  assert.match(pilot, /name="email" required/);
  assert.match(pilot, /No credit card/);
  assert.match(pilot, /does not create a paid subscription/);
  assert.match(pilot, /Day 14/);
  assert.doesNotMatch(pilot, /(?:2|3)-minute Practice/);
  assert.match(pilot, /time varies/);
});

test('sample scores never masquerade as measured learner or business outcomes', () => {
  assert.match(opening, /Sample scenarios and results are fictional/);
  assert.match(hub, /Illustrative demonstration only/);
  assert.match(phases, /Any time-jump results in this demo are simulated/);
  assert.match(mission, /All five advisors, ratings and simulated Day-7 outcomes above are fictional/);
  assert.match(mission, /No revenue, retention or readiness guarantee/);
  assert.doesNotMatch(review, /External review edition · PR #61|This is a pre-merge demonstration/);
});

test('existing inline JavaScript syntax remains valid', () => {
  for (const [name, src] of [['opening', opening], ['hub', hub], ['phases', phases], ['mission', mission], ['pilot', pilot]]) {
    const scripts = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length >= 1, name + ' should have an inline controller');
    for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script), name + ' inline JS syntax');
  }
});
