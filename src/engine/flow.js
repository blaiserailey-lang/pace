/* BLOB scheduling engine.
 *
 * Pure and deterministic: every function takes the whole state (plus `now`) and returns new data.
 * Nothing here changes the plan on its own. Requests return a *proposal* (a summary, a plain-word
 * reason and a list of changes), and only `apply(state, proposal)` produces the new plan, after the
 * person approves it.
 *
 * Ground rules from the product spec:
 *  - Calendar events and protected time are anchors. The engine never moves them.
 *  - Session lengths are commitments the person chose, never estimates of how much work is left.
 *  - No field stores estimated hours or percent complete. Deadline status comes only from the
 *    person's own check-ins and from calendar facts.
 *  - Leave slack: engine-chosen placements fill at most `maxFill` of a day's free time.
 *
 * Times are epoch milliseconds in local time. Durations are minutes.
 */
(function (root) {
  const MIN = 60000, DAY = 1440 * MIN;

  const DEFAULT_PREFS = {
    dayStart: 9 * 60,        // minutes after midnight
    dayEnd: 18 * 60,
    buffer: 10,              // minutes kept clear between blobs
    lunch: { start: 12 * 60 + 30, dur: 45 },
    maxFill: 0.7,            // share of free time the engine may plan on its own
    sessionLen: 60,          // default deadline session length (a commitment, not an estimate)
    horizonDays: 14,
    workDays: [1, 2, 3, 4, 5], // Mon–Fri. The engine only picks times on these days; you can still pick any day yourself.
  };

  /* ---------- time helpers ---------- */
  const dayOf = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (day, n) => { const d = new Date(day); d.setDate(d.getDate() + n); return d.getTime(); };
  const at = (day, minutes) => day + minutes * MIN;
  const ceil5 = ms => Math.ceil(ms / (5 * MIN)) * 5 * MIN;
  const end = it => it.start + it.dur * MIN;
  const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

  function clock(ms) {
    const d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
  }
  function dayName(ms, now) {
    const diff = Math.round((dayOf(ms) - dayOf(now)) / DAY);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    return new Date(ms).toLocaleDateString('en-US', { weekday: 'long' });
  }
  const when = (ms, now) => `${dayName(ms, now)} at ${clock(ms)}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* ---------- state ---------- */
  function createState(init = {}) {
    return {
      prefs: { ...DEFAULT_PREFS, ...(init.prefs || {}), lunch: { ...DEFAULT_PREFS.lunch, ...((init.prefs || {}).lunch || {}) } },
      events: (init.events || []).map(e => ({ kind: 'event', cat: 'meeting', ...e })),         // fixed: {id,title,start,dur,cat}
      sessions: (init.sessions || []).map(s => ({ status: 'planned', cat: 'project', ...s })), // flexible: {id,title,start,dur,cat,deadlineId?}
      deadlines: (init.deadlines || []).map(d => ({ report: null, done: false, ...d })),      // {id,title,due,cat,sessionLen,report,done}
    };
  }
  const clone = s => ({ prefs: s.prefs, events: s.events.map(e => ({ ...e })), sessions: s.sessions.map(x => ({ ...x })), deadlines: s.deadlines.map(d => ({ ...d })) });

  const isWorkDay = (s, day) => !s.prefs.workDays || s.prefs.workDays.includes(new Date(day).getDay());
  const lunchBlock = (s, day) => s.prefs.lunch && s.prefs.lunch.dur && isWorkDay(s, day) ? { id: `lunch-${day}`, kind: 'meal', title: 'Lunch', cat: 'meal', start: at(day, s.prefs.lunch.start), dur: s.prefs.lunch.dur, fixed: true } : null;
  const isLive = x => x.status === 'planned' || x.status === 'active';

  /* Fixed things on a day: calendar events, protected time and lunch. */
  function anchors(s, day) {
    const out = s.events.filter(e => overlaps(e.start, end(e), day, day + DAY));
    const l = lunchBlock(s, day);
    if (l && !out.some(e => overlaps(e.start, end(e), l.start, end(l)))) out.push(l);
    return out.sort((a, b) => a.start - b.start);
  }

  /* Everything for one day, in time order: what the Living Flow draws. */
  function dayFlow(s, day) {
    day = dayOf(day);
    const fixed = anchors(s, day).map(e => ({ ...e, fixed: true }));
    const flex = s.sessions.filter(x => x.status !== 'moved' && dayOf(x.start) === day).map(x => ({ ...x, kind: 'session', fixed: false }));
    return fixed.concat(flex).sort((a, b) => a.start - b.start || (a.fixed ? -1 : 1));
  }

  /* Minutes in the working window not taken by anchors. */
  function capacity(s, day) {
    const w0 = at(day, s.prefs.dayStart), w1 = at(day, s.prefs.dayEnd);
    let free = (w1 - w0) / MIN;
    for (const a of anchors(s, day)) free -= Math.max(0, Math.min(end(a), w1) - Math.max(a.start, w0)) / MIN;
    return Math.max(0, free);
  }
  const plannedMinutes = (s, day, exclude) => s.sessions
    .filter(x => isLive(x) && dayOf(x.start) === day && !exclude.has(x.id))
    .reduce((t, x) => t + x.dur, 0);

  /* Earliest start on `day` at or after `from` where `dur` fits with buffers. Returns null if none. */
  function slotOnDay(s, day, dur, { from = 0, exclude = new Set(), cap = true } = {}) {
    const { buffer, maxFill } = s.prefs;
    const w0 = at(day, s.prefs.dayStart), w1 = at(day, s.prefs.dayEnd);
    if (cap && plannedMinutes(s, day, exclude) + dur > maxFill * capacity(s, day)) return null;
    const busy = anchors(s, day).concat(s.sessions.filter(x => isLive(x) && !exclude.has(x.id) && dayOf(x.start) === day))
      .map(b => [b.start - buffer * MIN, end(b) + buffer * MIN]).sort((a, b) => a[0] - b[0]);
    let t = ceil5(Math.max(w0, from));
    for (const [b0, b1] of busy) {
      if (t + dur * MIN <= b0) break;
      if (b1 > t) t = ceil5(b1);
    }
    return t + dur * MIN <= w1 ? t : null;
  }

  /* Earliest slot from `from` onward, across days, before `until` (exclusive end). */
  function findSlot(s, dur, { from, until = Infinity, exclude = new Set(), cap = true, skipDays = new Set() } = {}) {
    const first = dayOf(from);
    for (let i = 0; i < s.prefs.horizonDays; i++) {
      const day = addDays(first, i);
      if (day >= until) break;
      if (skipDays.has(day) || !isWorkDay(s, day)) continue;
      const t = slotOnDay(s, day, dur, { from, exclude, cap });
      if (t != null && t + dur * MIN <= until) return t;
    }
    return null;
  }

  /* The free start on `day` closest to `target` (earlier or later), not before `notBefore`. */
  function nearestOnDay(s, day, dur, target, { exclude = new Set(), notBefore = 0 } = {}) {
    const w0 = Math.max(at(day, s.prefs.dayStart), ceil5(notBefore)), w1 = at(day, s.prefs.dayEnd);
    let best = null;
    for (let c = w0; c + dur * MIN <= w1; c += 5 * MIN) {
      if (slotOnDay(s, day, dur, { from: c, exclude, cap: false }) !== c) continue;
      if (best == null || Math.abs(c - target) < Math.abs(best - target)) best = c;
    }
    return best;
  }

  /* ---------- proposals ---------- */
  function proposal(kind, summary, reason, changes, extra = {}) {
    return { id: `${kind}:${changes.map(c => c.id).join(',') || 'none'}`, kind, summary, reason, changes, conflicts: extra.conflicts || [], options: extra.options || null };
  }
  const find = (s, id) => s.sessions.find(x => x.id === id) || null;

  /* Add one flexible session. `session` = {id, title, cat, dur, start?, deadlineId?}. */
  function proposeAdd(s, session, now) {
    const dur = session.dur;
    if (session.start != null) {
      const t = session.start, day = dayOf(t);
      const ok = slotOnDay(s, day, dur, { from: t, cap: false }) === t;
      if (ok) return proposal('add', `Add “${session.title}” ${when(t, now)}`, `That time is free on your calendar.`, [{ op: 'add', id: session.id, item: { ...session, start: t, status: 'planned' } }]);
      const alt = nearestOnDay(s, day, dur, t, { notBefore: now }) ?? findSlot(s, dur, { from: t });
      if (alt == null) return proposal('add', `No room for “${session.title}”`, `Nothing free for ${plural(dur, 'minute')} in the next ${s.prefs.horizonDays} days.`, [], { conflicts: [session.id] });
      return proposal('add', `Add “${session.title}” ${when(alt, now)}`, `${clock(t)} is taken, so this is the closest free ${plural(dur, 'minute')}.`, [{ op: 'add', id: session.id, item: { ...session, start: alt, status: 'planned' } }]);
    }
    const t = findSlot(s, dur, { from: now });
    if (t == null) return proposal('add', `No room for “${session.title}”`, `Nothing free for ${plural(dur, 'minute')} in the next ${s.prefs.horizonDays} days without overfilling your days.`, [], { conflicts: [session.id] });
    return proposal('add', `Add “${session.title}” ${when(t, now)}`, `It's the earliest free ${plural(dur, 'minute')} that keeps a buffer around your other blobs.`, [{ op: 'add', id: session.id, item: { ...session, start: t, status: 'planned' } }]);
  }

  /* A deadline plus the sessions the person wants before it.
     `d` = {id, title, due, cat, sessions: how many sessions you want, sessionLen}. */
  function proposeDeadline(s, d, now) {
    const len = d.sessionLen || s.prefs.sessionLen, want = Math.max(1, d.sessions || 1);
    const firstDay = dayOf(now), lastDay = dayOf(d.due);
    const days = [];
    for (let day = firstDay; day <= lastDay && days.length < s.prefs.horizonDays; day = addDays(day, 1)) if (isWorkDay(s, day)) days.push(day);
    // Spread across the available days: pick evenly spaced days, earliest first.
    const picks = [], tried = new Set();
    const order = [];
    for (let k = 0; k < want; k++) order.push(days[Math.min(days.length - 1, Math.floor(k * days.length / want))]);
    const staged = clone(s);
    const changes = [{ op: 'deadline', id: d.id, item: { id: d.id, title: d.title, due: d.due, cat: d.cat || 'project', sessionLen: len, report: null, done: false } }];
    let n = 0;
    for (const target of order) {
      if (target == null) break;
      // Try the target day, then later days before the due date, then earlier ones; one session per deadline per day.
      const candidates = days.filter(x => x >= target).concat(days.filter(x => x < target).reverse());
      let placed = null;
      for (const day of candidates) {
        if (tried.has(day)) continue;
        const t = slotOnDay(staged, day, len, { from: day === firstDay ? now : 0 });
        if (t != null && t + len * MIN <= d.due) { placed = t; tried.add(day); break; }
      }
      if (placed == null) continue;
      n++;
      const item = { id: `${d.id}-s${n}`, title: d.title, cat: d.cat || 'project', start: placed, dur: len, deadlineId: d.id, status: 'planned' };
      staged.sessions.push(item); picks.push(item);
      changes.push({ op: 'add', id: item.id, item });
    }
    const dueTxt = when(d.due, now);
    if (!picks.length) return proposal('deadline', `Track “${d.title}” (due ${dueTxt})`, `There's no free ${plural(len, 'minute')} block before it's due, so no sessions are planned. You could shorten the sessions or free up time.`, changes, { conflicts: [d.id] });
    const list = picks.map(p => when(p.start, now)).join(', ');
    const short = picks.length < want ? ` Only ${picks.length} of the ${want} sessions fit before it's due.` : '';
    return proposal('deadline', `Plan ${plural(picks.length, 'session')} for “${d.title}”`,
      `It's due ${dueTxt}. These are open ${len}-minute slots on separate days: ${list}.${short}`, changes, { conflicts: picks.length < want ? [d.id] : [] });
  }

  /* Move a flexible session. target: {start} | 'later' (later today) | 'tomorrow' | 'next' (next free). */
  function proposeMove(s, id, target, now) {
    const x = find(s, id);
    if (!x) return proposal('move', 'Nothing to move', 'That blob is no longer on the plan.', []);
    if (x.fixed) return proposal('move', 'Calendar events stay put', 'Blob never moves calendar events.', []);
    const ex = new Set([id]), dl = x.deadlineId ? s.deadlines.find(d => d.id === x.deadlineId) : null;
    const until = dl ? dl.due : Infinity;
    let t = null, why = '';
    const skip = new Set(s.sessions.filter(o => o.deadlineId && o.deadlineId === x.deadlineId && o.id !== id && isLive(o)).map(o => dayOf(o.start)));
    if (target && typeof target === 'object' && target.start != null) {
      const day = dayOf(target.start);
      t = slotOnDay(s, day, x.dur, { from: target.start, exclude: ex, cap: false });
      if (t !== target.start) t = nearestOnDay(s, day, x.dur, target.start, { exclude: ex, notBefore: now });
      why = t === target.start ? `${clock(t)} is free.` : t != null ? `${clock(target.start)} is taken, so this is the closest free time that day.` : '';
      if (t == null) {
        t = findSlot(s, x.dur, { from: Math.max(now, target.start), until, exclude: ex, skipDays: skip });
        why = `Nothing is free around ${clock(target.start)} that day, so this is the next open time after it.`;
      }
    } else if (target === 'later') {
      t = slotOnDay(s, dayOf(now), x.dur, { from: Math.max(now, end(x)), exclude: ex });
      why = 'This is the next open block later today.';
    } else if (target === 'tomorrow') {
      const day = addDays(dayOf(x.start > now ? x.start : now), 1);
      t = findSlot(s, x.dur, { from: day, until, exclude: ex, skipDays: skip });
      why = 'This is the first open block tomorrow or after.';
    } else {
      t = findSlot(s, x.dur, { from: Math.max(now, end(x)), until, exclude: ex, skipDays: skip });
      why = 'This is the next open block.';
    }
    if (t == null) {
      const alt = findSlot(s, x.dur, { from: now, until, exclude: ex, skipDays: skip });
      return proposal('move', `Couldn't find that slot for “${x.title}”`, alt != null ? `Nearest open time is ${when(alt, now)}.` : dl ? `Nothing free before it's due ${when(dl.due, now)}.` : 'Nothing free in the next two weeks.', [], { conflicts: [id], options: alt != null ? [{ start: alt }] : null });
    }
    if (dl && t + x.dur * MIN > dl.due) return proposal('move', `That's after “${dl.title}” is due`, `It's due ${when(dl.due, now)}.`, [], { conflicts: [id] });
    return proposal('move', `Move “${x.title}” to ${when(t, now)}`, why + (dl ? ` Still before it's due ${when(dl.due, now)}.` : ''), [{ op: 'move', id, from: x.start, to: t }]);
  }

  /* Edit a flexible session after it was created. patch = {title?, cat?, dur?}.
     Renaming or recolouring never moves anything. A longer blob that no longer fits where it is
     either pushes the later flexible blobs that day (when no calendar event is in the way) or
     moves itself to the closest free time. Anchors never move. Nothing changes until applied. */
  function proposeEdit(s, id, patch, now) {
    const x = find(s, id);
    if (!x) return proposal('edit', 'Nothing to edit', 'That blob is no longer on the plan.', []);
    const changes = [];
    const meta = {};
    if (patch.title != null && patch.title.trim() && patch.title.trim() !== x.title) meta.title = patch.title.trim();
    if (patch.cat && patch.cat !== x.cat) meta.cat = patch.cat;
    if (Object.keys(meta).length) changes.push({ op: 'edit', id, from: { title: x.title, cat: x.cat }, to: meta });
    const name = meta.title || x.title, dur = patch.dur ? Math.max(5, Math.round(patch.dur)) : x.dur;
    if (dur === x.dur) return proposal('edit', changes.length ? `Update “${name}”` : 'Nothing changed', changes.length ? 'Its time stays the same.' : '', changes);
    changes.push({ op: 'resize', id, from: x.dur, to: dur });
    const day = dayOf(x.start), ex = new Set([id]), buf = s.prefs.buffer * MIN;
    if (dur < x.dur || slotOnDay(s, day, dur, { from: x.start, exclude: ex, cap: false }) === x.start)
      return proposal('edit', `Make “${name}” ${plural(dur, 'minute')}`, dur < x.dur ? 'Shorter, same start. Nothing else moves.' : 'It still fits where it is. Nothing else moves.', changes);
    const staged = clone(s), y = staged.sessions.find(o => o.id === id);
    y.dur = dur;
    const anchorHit = anchors(s, day).find(a => overlaps(y.start - buf, end(y) + buf, a.start, end(a)));
    if (!anchorHit) {
      const { changes: shifts, bumped } = reflowAfter(staged, end(y) + buf, now, new Set([id]));
      return proposal('edit', `Make “${name}” ${plural(dur, 'minute')}`,
        `${plural(shifts.length, 'later blob')} shift${shifts.length === 1 ? 's' : ''} to make room${bumped.length ? `, and ${plural(bumped.length, 'blob')} moves to another day` : ''}. Calendar events keep their times.`, changes.concat(shifts));
    }
    const t = nearestOnDay(staged, day, dur, x.start, { exclude: ex, notBefore: now }) ?? findSlot(staged, dur, { from: Math.max(now, x.start), exclude: ex });
    if (t == null) return proposal('edit', `No room for a ${plural(dur, 'minute')} “${name}”`, `It would run into “${anchorHit.title}” and nothing else is free.`, [], { conflicts: [id] });
    return proposal('edit', `Make “${name}” ${plural(dur, 'minute')} and move it to ${when(t, now)}`,
      `At ${clock(x.start)} it would run into “${anchorHit.title}”, which stays put. This is the closest free time.`, changes.concat([{ op: 'move', id, from: x.start, to: t }]), { conflicts: [anchorHit.id] });
  }

  /* Take a flexible session off the plan. Calendar events can't be removed here. */
  function proposeRemove(s, id) {
    const x = find(s, id);
    if (!x) return proposal('remove', 'Nothing to remove', '', []);
    return proposal('remove', `Remove “${x.title}”`, 'Nothing else moves.', [{ op: 'remove', id }]);
  }

  /* Push the remaining flexible sessions today forward after something ran long. Anchors never move. */
  function reflowAfter(s, from, now, ex = new Set()) {
    const staged = clone(s), changes = [], bumped = [];
    const today = dayOf(from);
    // Sessions that haven't started yet, in order. Lift them all, then put each back at its own
    // time or the next free time after it, so nothing ever moves earlier.
    const later = staged.sessions.filter(x => x.status === 'planned' && !ex.has(x.id) && dayOf(x.start) === today && x.start >= now).sort((a, b) => a.start - b.start);
    later.forEach(x => ex.add(x.id));
    for (const x of later) {
      const dl = x.deadlineId ? staged.deadlines.find(d => d.id === x.deadlineId) : null;
      let t = slotOnDay(staged, today, x.dur, { from: Math.max(from, x.start), exclude: ex, cap: false });
      if (t != null && dl && t + x.dur * MIN > dl.due) t = null;
      if (t == null) {
        const skip = new Set(staged.sessions.filter(o => o.deadlineId && o.deadlineId === x.deadlineId && o.id !== x.id && isLive(o)).map(o => dayOf(o.start)));
        t = findSlot(staged, x.dur, { from: addDays(today, 1), until: dl ? dl.due : Infinity, exclude: ex, skipDays: skip });
        bumped.push(x);
      }
      ex.delete(x.id);
      if (t == null) { changes.push({ op: 'unplace', id: x.id, from: x.start }); x.status = 'unplaced'; continue; }
      if (t !== x.start) changes.push({ op: 'move', id: x.id, from: x.start, to: t });
      x.start = t;
    }
    return { changes, bumped, staged };
  }

  /* Time's up on the active session. choice: 'extend15' | 'extend30' | 'finish' | 'reschedule'. */
  function proposeTimeUp(s, id, choice, now) {
    const x = find(s, id);
    if (!x) return proposal('timeup', 'Nothing running', '', []);
    if (choice === 'finish') return proposal('timeup', `Finish “${x.title}”`, 'Marks it done and pops the blob.', [{ op: 'status', id, to: 'done' }]);
    if (choice === 'reschedule') {
      const p = proposeMove(s, id, 'next', now);
      return { ...p, kind: 'timeup', summary: p.changes.length ? `Pick “${x.title}” up again ${when(p.changes[0].to, now)}` : p.summary };
    }
    const add = choice === 'extend30' ? 30 : 15;
    const staged = clone(s), y = staged.sessions.find(o => o.id === id);
    y.dur += add;
    const { changes, bumped } = reflowAfter(staged, end(y) + s.prefs.buffer * MIN, now, new Set([id]));
    const nextAnchor = anchors(s, dayOf(now)).find(a => a.start >= end(x) && a.start < end(y) + s.prefs.buffer * MIN);
    const reason = [nextAnchor ? `That runs into “${nextAnchor.title}” at ${clock(nextAnchor.start)}, which stays put.` : `Ends at ${clock(end(y))}.`,
      changes.length ? `${plural(changes.length, 'later blob')} shift${changes.length === 1 ? 's' : ''} to make room${bumped.length ? `, and ${plural(bumped.length, 'blob')} moves to another day` : ''}.` : 'Nothing else has to move.'].join(' ');
    return proposal('timeup', `Add ${add} minutes to “${x.title}”`, reason, [{ op: 'resize', id, from: x.dur, to: y.dur }, ...changes], { conflicts: nextAnchor ? [nextAnchor.id] : [] });
  }

  /* You're behind by `minutes`: shift today's flexible sessions that haven't started yet. */
  function proposeRunningLate(s, minutes, now) {
    const { changes, bumped } = reflowAfter(s, now + minutes * MIN, now);
    if (!changes.length) return proposal('late', 'Nothing needs to move', `Your next flexible blob already starts after ${clock(now + minutes * MIN)}.`, []);
    return proposal('late', `Shift ${plural(changes.length, 'blob')} for running ${minutes} minutes behind`,
      `Calendar events keep their times. ${bumped.length ? `${plural(bumped.length, 'blob')} no longer fit${bumped.length === 1 ? 's' : ''} today and move${bumped.length === 1 ? 's' : ''} to the next open day.` : 'Everything still fits today.'}`, changes);
  }

  /* A calendar event was added or changed. Flexible sessions it now overlaps get new times. */
  function proposeCalendarChange(s, ev, now) {
    const staged = clone(s);
    const i = staged.events.findIndex(e => e.id === ev.id);
    const before = i >= 0 ? staged.events[i] : null;
    const next = { kind: 'event', cat: 'meeting', ...(before || {}), ...ev };
    if (i >= 0) staged.events[i] = next; else staged.events.push(next);
    const buf = s.prefs.buffer * MIN;
    const hit = staged.sessions.filter(x => isLive(x) && overlaps(x.start, end(x), next.start - buf, end(next) + buf)).sort((a, b) => a.start - b.start);
    const changes = [{ op: 'event', id: next.id, item: next }];
    const ex = new Set(hit.map(x => x.id));
    for (const x of hit) {
      const dl = x.deadlineId ? staged.deadlines.find(d => d.id === x.deadlineId) : null;
      const skip = new Set(staged.sessions.filter(o => o.deadlineId && o.deadlineId === x.deadlineId && o.id !== x.id && isLive(o)).map(o => dayOf(o.start)));
      const t = findSlot(staged, x.dur, { from: Math.max(now, x.start), until: dl ? dl.due : Infinity, exclude: ex, skipDays: skip });
      ex.delete(x.id);
      if (t == null) { changes.push({ op: 'unplace', id: x.id, from: x.start }); x.status = 'unplaced'; if (dl) changes.push({ op: 'flag', id: dl.id, to: 'displaced' }); continue; }
      changes.push({ op: 'move', id: x.id, from: x.start, to: t }); x.start = t;
    }
    const what = before ? `“${next.title}” moved to ${clock(next.start)}` : `“${next.title}” was added at ${clock(next.start)}`;
    return proposal('calendar', hit.length ? `Calendar changed: move ${plural(hit.length, 'blob')}` : 'Calendar changed: nothing to move',
      `${what}. ${hit.length ? 'It overlaps ' + hit.map(x => `“${x.title}”`).join(', ') + ', so ' + (hit.length === 1 ? 'that blob gets' : 'those blobs get') + ' the next open time.' : 'None of your blobs overlap it.'}`, changes);
  }

  /* A session's time passed without it being started. */
  function proposeMissed(s, id, now) {
    const x = find(s, id);
    if (!x) return proposal('missed', 'Nothing missed', '', []);
    const p = proposeMove(s, id, 'next', now);
    if (!p.changes.length) {
      const dl = x.deadlineId ? s.deadlines.find(d => d.id === x.deadlineId) : null;
      return proposal('missed', `No time left for “${x.title}”`, p.reason, dl ? [{ op: 'unplace', id, from: x.start }, { op: 'flag', id: dl.id, to: 'displaced' }] : [{ op: 'unplace', id, from: x.start }], { conflicts: [id] });
    }
    return { ...p, kind: 'missed', summary: `Missed “${x.title}”. Pick it up ${when(p.changes[0].to, now)}?`, reason: `Its ${clock(x.start)} slot has passed. ${p.reason}` };
  }

  /* ---------- applying an approved proposal ---------- */
  function apply(s, p) {
    const n = clone(s);
    for (const c of p.changes) {
      const x = n.sessions.find(o => o.id === c.id);
      if (c.op === 'add') n.sessions.push({ ...c.item });
      else if (c.op === 'move' && x) { x.start = c.to; x.status = 'planned'; }
      else if (c.op === 'resize' && x) x.dur = c.to;
      else if (c.op === 'edit' && x) Object.assign(x, c.to);
      else if (c.op === 'status' && x) x.status = c.to;
      else if (c.op === 'unplace' && x) x.status = 'unplaced';
      else if (c.op === 'remove') n.sessions = n.sessions.filter(o => o.id !== c.id);
      else if (c.op === 'event') { const i = n.events.findIndex(e => e.id === c.id); if (i >= 0) n.events[i] = { ...c.item }; else n.events.push({ ...c.item }); }
      else if (c.op === 'deadline') { const i = n.deadlines.findIndex(d => d.id === c.id); if (i >= 0) n.deadlines[i] = { ...n.deadlines[i], ...c.item }; else n.deadlines.push({ ...c.item }); }
      else if (c.op === 'flag') { const d = n.deadlines.find(o => o.id === c.id); if (d) d.displaced = true; }
    }
    // Finishing every session for a deadline doesn't mark the deadline done; only the person does.
    return n;
  }

  /* The person's own check-in on a deadline: 'on-track' | 'unsure' | 'behind' | 'done'. */
  function report(s, deadlineId, value) {
    const n = clone(s), d = n.deadlines.find(o => o.id === deadlineId);
    if (!d) return n;
    if (value === 'done') d.done = true; else { d.report = value; d.done = false; }
    return n;
  }

  /* Deadline status from grounded signals only. */
  function deadlineStatus(s, deadlineId, now) {
    const d = s.deadlines.find(o => o.id === deadlineId);
    if (!d) return null;
    if (d.done) return { state: 'completed', reason: 'You marked it done.' };
    const ahead = s.sessions.filter(x => x.deadlineId === d.id && isLive(x) && end(x) > now && end(x) <= d.due);
    const daysLeft = (d.due - now) / DAY;
    if (d.report === 'behind') return { state: 'critical', reason: 'You said you’re behind.' };
    if (d.due <= now) return { state: 'critical', reason: 'The due time has passed and it isn’t marked done.' };
    if (d.displaced && !ahead.length) return { state: 'critical', reason: 'A calendar conflict took the last session before it’s due.' };
    if (d.report === 'unsure') return { state: 'attention', reason: 'You said you’re not sure you’re on track.' };
    if (!ahead.length && daysLeft <= 3) return { state: 'attention', reason: `Due ${when(d.due, now)} with no session planned.` };
    if (d.report === 'on-track') return { state: 'healthy', reason: 'You said it’s on track.' };
    if (ahead.length) return { state: 'healthy', reason: `${plural(ahead.length, 'session')} planned before it’s due.` };
    return { state: 'healthy', reason: `Due ${when(d.due, now)}. Nothing planned yet.` };
  }

  const api = {
    DEFAULT_PREFS, MIN, DAY, dayOf, addDays, at, clock, when, end,
    createState, dayFlow, capacity, slotOnDay, findSlot,
    proposeAdd, proposeDeadline, proposeMove, proposeTimeUp, proposeRunningLate, proposeCalendarChange, proposeMissed, proposeEdit, proposeRemove,
    apply, report, deadlineStatus,
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BlobEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
