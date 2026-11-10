// Run with: npm test  (TZ is pinned to UTC so clock strings are stable)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine/flow.js');

const MON = new Date(2026, 10, 9).getTime();           // Monday 9 Nov 2026, local midnight
const t = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return E.addDays(MON, day) + (h * 60 + m) * E.MIN; };
const NOW = t(0, '08:30');

function base() {
  return E.createState({
    events: [
      { id: 'standup', title: 'Team standup', start: t(0, '09:00'), dur: 30, cat: 'meeting' },
      { id: 'client', title: 'Client call', start: t(0, '14:00'), dur: 60, cat: 'meeting' },
      { id: 'gym', title: 'Gym', start: t(0, '17:00'), dur: 60, cat: 'fitness' },
    ],
  });
}
const overlapping = (a, b) => a.start < E.end(b) && b.start < E.end(a);

test('a new session goes in the earliest free slot with buffers around fixed events', () => {
  const s = base();
  const p = E.proposeAdd(s, { id: 'x', title: 'Inbox zero', cat: 'email', dur: 30 }, NOW);
  assert.equal(p.changes.length, 1);
  assert.equal(p.changes[0].item.start, t(0, '09:40')); // standup ends 9:30 + 10 min buffer
  assert.match(p.summary, /today at 9:40am/);
});

test('proposals never change the plan until applied', () => {
  const s = base();
  const before = JSON.stringify(s);
  E.proposeAdd(s, { id: 'x', title: 'Deck', dur: 60 }, NOW);
  E.proposeDeadline(s, { id: 'd', title: 'Pitch', due: t(3, '17:00'), sessions: 3 }, NOW);
  E.proposeRunningLate(s, 20, NOW);
  assert.equal(JSON.stringify(s), before);
});

test('a deadline gets sessions on separate days, all before the due time, and none on top of events', () => {
  const s = base();
  const p = E.proposeDeadline(s, { id: 'pitch', title: 'Pitch deck', due: t(3, '12:00'), sessions: 3, sessionLen: 90 }, NOW);
  const adds = p.changes.filter(c => c.op === 'add').map(c => c.item);
  assert.equal(adds.length, 3);
  const days = new Set(adds.map(a => E.dayOf(a.start)));
  assert.equal(days.size, 3);
  for (const a of adds) {
    assert.equal(a.dur, 90);
    assert.ok(E.end(a) <= t(3, '12:00'));
    for (const e of s.events) assert.ok(!overlapping(a, e), `${a.id} overlaps ${e.id}`);
  }
  const n = E.apply(s, p);
  assert.equal(n.deadlines.length, 1);
  assert.equal(n.sessions.length, 3);
});

test('a deadline that cannot fit says so instead of shrinking sessions', () => {
  const s = base();
  const p = E.proposeDeadline(s, { id: 'tight', title: 'Tight', due: t(0, '10:30'), sessions: 2, sessionLen: 120 }, NOW);
  assert.equal(p.changes.filter(c => c.op === 'add').length, 0);
  assert.deepEqual(p.conflicts, ['tight']);
  assert.match(p.reason, /no free 120 minutes block/i);
});

test('engine-chosen placements leave slack in the day', () => {
  let s = base();
  for (let i = 0; i < 12; i++) {
    const p = E.proposeAdd(s, { id: 's' + i, title: 'Block ' + i, dur: 60 }, NOW);
    s = E.apply(s, p);
  }
  const today = s.sessions.filter(x => E.dayOf(x.start) === MON).reduce((m, x) => m + x.dur, 0);
  assert.ok(today <= 0.7 * E.capacity(s, MON), `planned ${today} of ${E.capacity(s, MON)}`);
  assert.ok(s.sessions.some(x => E.dayOf(x.start) > MON), 'overflow goes to later days');
});

test('moving a session to a taken time offers the next free time that day, never on a calendar event', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'w', title: 'Write', dur: 60 }, NOW));
  const p = E.proposeMove(s, 'w', { start: t(0, '14:15') }, NOW);
  assert.equal(p.changes[0].to, t(0, '15:10'));
  const q = E.proposeMove(s, 'w', 'tomorrow', NOW);
  assert.equal(E.dayOf(q.changes[0].to), E.addDays(MON, 1));
});

test('calendar events never move', () => {
  const s = base();
  const p = E.proposeMove(s, 'standup', 'later', NOW);
  assert.equal(p.changes.length, 0);
});

test("time's up +30 pushes later sessions forward, not the client call", () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'a', title: 'A', dur: 60, start: t(0, '10:00') }, NOW));
  s = E.apply(s, E.proposeAdd(s, { id: 'b', title: 'B', dur: 60, start: t(0, '11:10') }, NOW));
  const now = t(0, '11:00');
  const p = E.proposeTimeUp(s, 'a', 'extend30', now);
  assert.deepEqual(p.changes[0], { op: 'resize', id: 'a', from: 60, to: 90 });
  const n = E.apply(s, p);
  const b = n.sessions.find(x => x.id === 'b');
  assert.ok(b.start >= t(0, '11:40'), 'B starts after A plus buffer');
  assert.ok(!overlapping(b, { start: t(0, '12:30'), dur: 45 }), 'B avoids lunch');
  assert.equal(n.events.find(e => e.id === 'client').start, t(0, '14:00'));
});

test('running late shifts only flexible sessions that have not started, and never earlier', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'a', title: 'A', dur: 30, start: t(0, '10:00') }, NOW));
  s = E.apply(s, E.proposeAdd(s, { id: 'b', title: 'B', dur: 30, start: t(0, '15:30') }, NOW));
  const p = E.proposeRunningLate(s, 45, t(0, '09:50'));
  const n = E.apply(s, p);
  assert.equal(n.sessions.find(x => x.id === 'a').start, t(0, '10:35'));
  assert.equal(n.sessions.find(x => x.id === 'b').start, t(0, '15:30'));
});

test('a calendar change moves only the sessions it now overlaps', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'a', title: 'A', dur: 60, start: t(0, '10:00') }, NOW));
  s = E.apply(s, E.proposeAdd(s, { id: 'b', title: 'B', dur: 60, start: t(0, '15:20') }, NOW));
  const p = E.proposeCalendarChange(s, { id: 'new', title: 'Surprise sync', start: t(0, '10:30'), dur: 30 }, NOW);
  const moved = p.changes.filter(c => c.op === 'move').map(c => c.id);
  assert.deepEqual(moved, ['a']);
  const n = E.apply(s, p);
  const a = n.sessions.find(x => x.id === 'a');
  for (const e of n.events) assert.ok(!overlapping(a, e));
});

test('a missed session is offered the next open slot', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'a', title: 'A', dur: 60, start: t(0, '10:00') }, NOW));
  const p = E.proposeMissed(s, 'a', t(0, '11:15'));
  assert.equal(p.kind, 'missed');
  assert.ok(p.changes[0].to >= t(0, '11:15'));
});

test('deadline status only comes from check-ins and calendar facts', () => {
  let s = base();
  s = E.apply(s, E.proposeDeadline(s, { id: 'd', title: 'Essay', due: t(2, '17:00'), sessions: 2 }, NOW));
  assert.equal(E.deadlineStatus(s, 'd', NOW).state, 'healthy');
  assert.equal(E.deadlineStatus(E.report(s, 'd', 'unsure'), 'd', NOW).state, 'attention');
  assert.equal(E.deadlineStatus(E.report(s, 'd', 'behind'), 'd', NOW).state, 'critical');
  assert.equal(E.deadlineStatus(E.report(s, 'd', 'done'), 'd', NOW).state, 'completed');
  // Doing every session does not mark the deadline done by itself.
  let all = s; for (const x of s.sessions) all = E.apply(all, { changes: [{ op: 'status', id: x.id, to: 'done' }] });
  assert.notEqual(E.deadlineStatus(all, 'd', NOW).state, 'completed');
  // Nothing planned and due soon needs attention.
  const bare = E.createState({ deadlines: [{ id: 'z', title: 'Z', due: t(1, '12:00') }] });
  assert.equal(E.deadlineStatus(bare, 'z', NOW).state, 'attention');
});

test('no estimate or percent fields exist anywhere in state or proposals', () => {
  let s = base();
  const p = E.proposeDeadline(s, { id: 'd', title: 'Essay', due: t(4, '17:00'), sessions: 2 }, NOW);
  s = E.apply(s, p);
  const text = JSON.stringify([s, p, E.deadlineStatus(s, 'd', NOW)]);
  assert.doesNotMatch(text, /estimat|percent|progress|hoursLeft|remaining/i);
});

test('engine-chosen times skip weekends', () => {
  const fri = t(4, '08:30');
  const s = E.createState({});
  const p = E.proposeDeadline(s, { id: 'w', title: 'Weekend test', due: t(7, '17:00'), sessions: 2 }, fri);
  const days = p.changes.filter(c => c.op === 'add').map(c => new Date(c.item.start).getDay());
  assert.deepEqual(days, [5, 1]); // Friday and Monday, not Saturday or Sunday
});

test('asking for a taken time offers the closest free time, earlier or later', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'w', title: 'Write', dur: 20, start: t(0, '15:30') }, NOW));
  // 13:45 for 20 min runs into the 14:00 call's buffer; 13:30 is the closest start that still ends before it.
  const p = E.proposeMove(s, 'w', { start: t(0, '13:45') }, NOW);
  assert.equal(p.changes[0].to, t(0, '13:30'));
});

test('renaming or recolouring a blob changes nothing else', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'x', title: 'Inbox', cat: 'email', dur: 30 }, NOW));
  const p = E.proposeEdit(s, 'x', { title: 'Inbox zero', cat: 'creative' }, NOW);
  assert.deepEqual(p.changes.map(c => c.op), ['edit']);
  const n = E.apply(s, p), x = n.sessions.find(o => o.id === 'x');
  assert.equal(x.title, 'Inbox zero'); assert.equal(x.cat, 'creative'); assert.equal(x.start, s.sessions[0].start);
});

test('a longer blob pushes later flexible blobs but never a calendar event', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'a', title: 'A', dur: 30, start: t(0, '10:00') }, NOW));
  s = E.apply(s, E.proposeAdd(s, { id: 'b', title: 'B', dur: 30, start: t(0, '10:40') }, NOW));
  const p = E.proposeEdit(s, 'a', { dur: 60 }, NOW);
  const n = E.apply(s, p), a = n.sessions.find(o => o.id === 'a'), b = n.sessions.find(o => o.id === 'b');
  assert.equal(a.start, t(0, '10:00')); assert.equal(a.dur, 60);
  assert.ok(b.start >= E.end(a)); assert.ok(!overlapping(a, b));
  assert.equal(JSON.stringify(n.events), JSON.stringify(s.events));
});

test('a longer blob that would hit a calendar event moves itself to free time', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'a', title: 'A', dur: 30, start: t(0, '13:00') }, NOW));
  const p = E.proposeEdit(s, 'a', { dur: 90 }, NOW);
  assert.ok(p.changes.some(c => c.op === 'move'));
  const n = E.apply(s, p), a = n.sessions.find(o => o.id === 'a');
  for (const ev of n.events) assert.ok(!overlapping(a, ev), `overlaps ${ev.title}`);
});

test('removing a blob only removes that blob', () => {
  let s = base();
  s = E.apply(s, E.proposeAdd(s, { id: 'a', title: 'A', dur: 30 }, NOW));
  const n = E.apply(s, E.proposeRemove(s, 'a'));
  assert.equal(n.sessions.length, 0); assert.equal(n.events.length, 3);
});
