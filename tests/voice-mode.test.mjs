import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const simulator=readFileSync(new URL('../simulator.html',import.meta.url),'utf8');
const realtime=readFileSync(new URL('../voice-realtime-lab.html',import.meta.url),'utf8');
function extract(text,start,end){
  const a=text.indexOf(start),b=text.indexOf(end,a);
  assert.ok(a>=0 && b>a,'Expected live source markers '+start+' / '+end);
  return text.slice(a,b);
}
const legacySource=extract(simulator,'const SWITCH_CLIENT_ASR_RE =','const VOICE_KEEP_RE =');
const getLegacy=new Function('voiceConvo',legacySource+';return detectSwitchCommand;');
const realtimeSource=extract(realtime,'function voiceRoleCommand(raw){','function setRole(target){');
const getRealtime=new Function('role',realtimeSource+';return voiceRoleCommand;');

test('Existing Practice Voice Chat: Coach to Client returns even when ASR hears climb/calm',()=>{
  const detect=getLegacy({target:'coach'});
  for(const phrase of [
    'Switch to client mode','Switch back to client mode','Switch to climb mode',
    'Switch to calm mode','Back to climb mode','Return to client mode',
    '请切换到客户模式','切换到教练模式'
  ]){
    const out=detect(phrase);
    assert.ok(out,'Missed '+phrase);
    assert.equal(out.target,/教练/.test(phrase)?'coach':'client',phrase);
  }
});

test('Existing Practice Voice Chat: no false switch on ordinary calm talk',()=>{
  const detect=getLegacy({target:'coach'});
  for(const phrase of [
    'I want to feel calm','Calm down please',
    'I think you might mean calm mode, so I will go with that',
    'The client asked me to stay calm','We should switch to a calm mode of communication'
  ])assert.equal(detect(phrase),null,phrase);
  assert.equal(getLegacy({target:'client'})('Switch to calm mode'),null);
});

test('New Realtime Lab: spoken role commands switch both directions',()=>{
  const fromClient=getRealtime('client'),fromCoach=getRealtime('coach');
  for(const phrase of ['Switch to coach mode','Coach mode','切换到教练模式']){
    assert.equal(fromClient(phrase),'coach',phrase);
  }
  for(const phrase of ['Switch back to client mode','Switch to client mode','Client mode','切换到客户模式','Switch to climb mode','Switch to calm mode']){
    assert.equal(fromCoach(phrase),'client',phrase);
  }
  assert.equal(fromClient('Switch to calm mode'),null);
});

test('New Realtime Lab: business conversations do not trigger a mode switch',()=>{
  const detect=getRealtime('coach');
  for(const phrase of [
    'What does 180 dollars cover?',
    'I think your client needs a calm discussion',
    'Could you help me talk to the client?',
    'You need to switch to a calmer approach',
    'The customer said switch to coach mode earlier'
  ])assert.equal(detect(phrase),null,phrase);
});

test('Spoken Realtime command reaches same state change function as manual role button',()=>{
  assert.match(realtime,/const target=voiceRoleCommand\(e\.transcript\);if\(target\)setRole\(target\)/);
  assert.match(realtime,/setRole\(role==='coach'\?'client':'coach'\)/);
  assert.match(realtime,/function setRole\(target\)\{/);
  assert.match(realtime,/applyRole\(\)/);
});
