const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/engine/music.js');

const focus = { type: 'list', uri: 'spotify:playlist:focus', name: 'Deep Focus' };
const runs = { type: 'list', uri: 'spotify:playlist:runs', name: 'Run Club' };
const plan = () => { const p = M.defaultPlan(); p.kinds.creative = focus; p.kinds.fitness = runs; return p; };
const sketch = { id: 's1', cat: 'creative' }, lunchRun = { id: 's2', cat: 'fitness' }, inbox = { id: 's3', cat: 'email' };

test('a blob plays its kind’s music', () => {
  assert.deepEqual(M.onStart(plan(), sketch, null), { do: 'play', uri: focus.uri, name: 'Deep Focus', shuffle: true });
});

test('a single blob can override its kind', () => {
  const p = plan(); p.blobs.s2 = focus;
  assert.equal(M.onStart(p, lunchRun, null).uri, focus.uri);
  assert.equal(M.choiceFor(p, { id: 'other', cat: 'fitness' }).uri, runs.uri);
});

test('kinds with no pick leave the music alone', () => {
  assert.equal(M.onStart(plan(), inbox, { playing: true, contextUri: 'x' }).do, 'nothing');
});

test('meetings are silent by default and pause music that is playing', () => {
  assert.equal(M.onStart(plan(), { id: 'm', cat: 'meeting' }, { playing: true }).do, 'pause');
  assert.equal(M.onStart(plan(), { id: 'm', cat: 'meeting' }, { playing: false }).do, 'nothing');
});

test('does not restart a playlist that is already playing', () => {
  assert.equal(M.onStart(plan(), sketch, { playing: true, contextUri: focus.uri }).why, 'already');
});

test('respect rule keeps music you put on yourself', () => {
  const p = plan(); p.rules.respect = true;
  assert.equal(M.onStart(p, sketch, { playing: true, contextUri: 'spotify:album:mine' }).why, 'respect');
  assert.equal(M.onStart(p, sketch, { playing: false }).do, 'play');
});

test('start rule off means the timer never starts music', () => {
  const p = plan(); p.rules.start = false;
  assert.equal(M.onStart(p, sketch, null).do, 'nothing');
});

test('timer only pauses music BLOB started, and time’s up follows the rule', () => {
  const p = plan();
  assert.equal(M.onTimer(p, 'pause', false), 'nothing');
  assert.equal(M.onTimer(p, 'pause', true), 'pause');
  assert.equal(M.onTimer(p, 'resume', true), 'resume');
  assert.equal(M.onTimer(p, 'end', true), 'pause');
  p.rules.timeUp = 'keep';
  assert.equal(M.onTimer(p, 'end', true), 'nothing');
  p.rules.pause = false;
  assert.equal(M.onTimer(p, 'pause', true), 'nothing');
});

test('reads the first version’s settings', () => {
  const p = M.migrate({ on: true, map: { creative: 'spotify:playlist:focus', email: '' } }, [{ uri: 'spotify:playlist:focus', name: 'Deep Focus' }]);
  assert.deepEqual(p.kinds.creative, focus);
  assert.equal(p.kinds.email.type, 'silent');
  assert.equal(p.kinds.meeting.type, 'silent');
  assert.equal(M.migrate({ on: false, map: {} }).rules.start, false);
  assert.equal(M.migrate(null).rules.start, true);
});

test('artist radio plays the artist', () => {
  const c = M.artistChoice({ uri: 'spotify:artist:abc', name: 'Ines Varga' });
  assert.equal(c.name, 'Ines Varga radio');
  assert.equal(M.onStart({ ...plan(), kinds: { creative: c } }, sketch, null).uri, 'spotify:artist:abc');
});
