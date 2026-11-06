/* Blobs: your day as a stack of jelly blobs. The big blob is what you're doing now (task + timer);
   tap it to open today's blobs, where you can add, edit, drag to rearrange, or shuffle. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const uid = () => Math.random().toString(36).slice(2, 9);
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const toMin = t => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
const fmtClock = m => { m = Math.round(m); let h = Math.floor(m / 60) % 24; const mm = String(m % 60).padStart(2, '0'); const ap = h >= 12 ? 'p' : 'a'; h = ((h + 11) % 12) + 1; return `${h}:${mm}${ap}`; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const ceil5 = m => Math.ceil(m / 5) * 5;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Colour system ----------
   Work = cool hues, Personal = warm hues, Breaks = greens (the classic jelly colour).
   Once a category runs out of single colours, projects get two-colour gradients. */
const PALETTE = {
  work: [['#3d6bff'], ['#7a5cff'], ['#00a6c7'], ['#2f8dff'], ['#a35cff'], ['#14b3a3'],
         ['#3d6bff', '#00a6c7'], ['#7a5cff', '#2f8dff'], ['#a35cff', '#3d6bff'], ['#14b3a3', '#2f8dff'], ['#00a6c7', '#7a5cff'], ['#2f8dff', '#14b3a3']],
  personal: [['#ff6b5a'], ['#ff5fa2'], ['#ff9440'], ['#ff5fa2', '#ff9440'], ['#ff6b5a', '#ff5fa2'], ['#ff9440', '#ffc53d']],
};
const FIXED = {
  snack: ['#8ad62f'], chill: ['#2fd49a'], meal: ['#8ad62f', '#ffc53d'],
  meeting: ['#5562d6', '#7d86a8'], personalEvent: ['#ff8a7a', '#ffb199'], done: ['#8ad62f', '#2fd49a'],
};
const CAT_LABEL = { work: 'Work', personal: 'Personal', break: 'Break' };

let projects = store.get('pace.projects', null) || [
  { name: 'EP mix revisions', due: isoIn(4), hours: 10, cat: 'work' },
  { name: 'Artist pitch deck', due: isoIn(9), hours: 8, cat: 'work' },
  { name: 'Music video treatment', due: isoIn(14), hours: 6, cat: 'work' },
  { name: 'Guitar practice', due: isoIn(30), hours: 6, cat: 'personal' },
];
projects.forEach(p => { p.id = p.id || uid(); p.cat = p.cat || 'work'; p.name = String(p.name || '').replace(/^Example:\s*/, ''); });
function isoIn(d) { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); }
const saveProjects = () => store.set('pace.projects', projects);

function projectColors(p) {
  const same = projects.filter(q => q.cat === p.cat), i = Math.max(0, same.indexOf(p)), pal = PALETTE[p.cat] || PALETTE.work;
  return p.color != null && pal[p.color] ? pal[p.color] : pal[i % pal.length];
}
function colorsFor(it) {
  if (!it) return FIXED.done;
  if (it.kind === 'focus') { const p = projects.find(q => q.id === it.proj); return p ? projectColors(p) : PALETTE[it.cat || 'work'][0]; }
  if (it.kind === 'event') return it.cat === 'personal' ? FIXED.personalEvent : FIXED.meeting;
  if (it.kind === 'task') return it.cat === 'personal' ? PALETTE.personal[0] : it.cat === 'break' ? FIXED.snack : PALETTE.work[0];
  return FIXED[it.kind] || FIXED.snack;
}
const catOf = it => it.kind === 'focus' || it.kind === 'event' || it.kind === 'task' ? (it.cat || 'work') : 'break';
const KIND_LABEL = { focus: 'Focus', event: 'Calendar', task: 'Task', snack: 'Snack break', chill: 'Chill break', meal: 'Meal break' };

/* ---------- Settings ---------- */
const SETTINGS = ['dayStart', 'dayEnd', 'focus', 'snack', 'meal', 'pack'];
const st = store.get('pace.settings', {});
SETTINGS.forEach(k => { if (st[k] != null && $('#' + k)) $('#' + k).value = st[k]; });
const saveSettings = () => store.set('pace.settings', Object.fromEntries(SETTINGS.map(k => [k, $('#' + k).value])));

/* ---------- Calendar events (today) ---------- */
let events = (() => { const e = store.get('blobs.events', null); return e && e.date === todayKey() ? e.list : []; })();
const saveEvents = () => store.set('blobs.events', { date: todayKey(), list: events });

/* ---------- Building the day ----------
   Calendar events keep their real times; the gaps fill with focus blocks (rotating projects by
   how far behind each one is: hours left ÷ days left) and breaks. Leftover minutes stretch the
   block before them so the day stays continuous. */
function dayStartFromNow() {
  const s = toMin($('#dayStart').value || '10:00'), e = toMin($('#dayEnd').value || '18:00'), n = ceil5(nowMin());
  return n > s && n < e - 15 ? n : s;
}
function buildDay(startAt) {
  const start = startAt ?? dayStartFromNow(), end = toMin($('#dayEnd').value || '18:00');
  const focus = Math.max(15, +$('#focus').value || 50), snack = Math.max(5, +$('#snack').value || 10), meal = toMin($('#meal').value || '13:00');
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const need = projects.filter(p => p.name && p.hours > 0).map(p => {
    const days = Math.max(1, Math.ceil((new Date(p.due + 'T23:59') - midnight) / 864e5));
    return { p, target: p.hours * 60 / days, got: 0, days };
  });
  const fixed = events.filter(e => e.end > start && e.start < end).map(e => ({ ...e, start: Math.max(e.start, start) })).sort((a, b) => a.start - b.start);
  if (meal + 60 > start && meal < end && !fixed.some(e => e.start < meal + 60 && e.end > meal))
    fixed.push({ meal: true, start: Math.max(meal, start), end: meal + 60 }), fixed.sort((a, b) => a.start - b.start);

  const items = []; let t = start, focusN = 0, last = null;
  const push = (o) => { const it = { id: uid(), start: t, ...o }; items.push(it); t += it.dur; return it; };
  const fill = (until) => {
    while (until - t >= 15 && need.length) {
      const pool = need.length > 1 ? need.filter(n => n !== last) : need;
      pool.sort((a, b) => (b.target - b.got) - (a.target - a.got) || a.days - b.days);
      const n = pool[0], dur = Math.min(focus, until - t);
      push({ kind: 'focus', name: n.p.name, dur, proj: n.p.id, cat: n.p.cat, note: n.days <= 3 ? `Due in ${n.days} day${n.days > 1 ? 's' : ''}` : '' });
      n.got += dur; last = n; focusN++;
      if (until - t < 20) break;
      if (focusN % 3 === 0) push({ kind: 'chill', name: 'Chill break', dur: 15, note: 'Stretch, walk, reset' });
      else push({ kind: 'snack', name: 'Snack break', dur: snack, note: 'Snack + water' });
    }
    if (until > t && items.length) { items[items.length - 1].dur += until - t; t = until; }   // stretch the last block over a small gap
    else if (until > t) t = until;
  };
  for (const e of fixed) {
    if (e.start > t) fill(e.start);
    if (e.end <= t) continue;
    const s = Math.max(t, e.start);
    if (e.meal) push({ kind: 'meal', name: 'Meal break', dur: e.end - s, note: 'Step away from the desk' });
    else push({ kind: 'event', name: e.title, dur: e.end - s, cat: e.cat || 'work', at: e.start, evId: e.id });
  }
  fill(end);
  return items;
}

/* ---------- State ---------- */
let items = [], idx = 0, remaining = 0, running = false, started = false, speed = 1, lastTick = Date.now(), warned = {}, finished = false;
const saveDay = () => store.set('blobs.day', { date: todayKey(), items, started });
(function restore() {
  const d = store.get('blobs.day', null);
  if (d && d.date === todayKey() && Array.isArray(d.items) && d.items.length && !d.started) items = d.items;
  else items = buildDay();
  remaining = items[0] ? items[0].dur * 60 : 0;
})();

/* Recompute start times from the current blob onwards (after edits, reorders, +5). */
function reflow() {
  if (!items.length) return;
  for (let i = Math.max(1, idx); i < items.length; i++) items[i].start = items[i - 1].start + items[i - 1].dur;
}
function rebuild() {
  if (started) {
    const keep = items.slice(0, idx + 1), cur = items[idx];
    const rest = buildDay(cur.start + cur.dur);
    items = keep.concat(rest);
  } else { items = buildDay(); idx = 0; remaining = items[0] ? items[0].dur * 60 : 0; }
  saveDay(); renderAll();
}

/* ---------- Big blob ---------- */
const big = new Jelly($('#big'), { colors: colorsFor(items[0]), wobble: 1.2, points: 36 });
function renderBig() {
  const b = items[idx];
  if (finished || !b) {
    $('#bigCat').textContent = finished ? 'Day complete' : 'Nothing planned';
    $('#bigName').textContent = finished ? 'No blobs left' : 'Add a project or a blob';
    $('#time').textContent = '00:00'; $('#bigNext').textContent = finished ? 'Nice work today.' : '';
    return;
  }
  const r = Math.max(0, Math.ceil(remaining));
  $('#time').textContent = `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
  $('#bigCat').textContent = `${KIND_LABEL[b.kind] || 'Blob'} · ${CAT_LABEL[catOf(b)]}`;
  $('#bigName').textContent = b.name;
  const nx = items[idx + 1];
  $('#bigNext').textContent = nx ? `Next at ${fmtClock(b.start + b.dur)}: ${nx.name}` : 'Last blob of the day';
  const left = items.length - idx;
  $('#count').textContent = `${left} blob${left === 1 ? '' : 's'} left`;
  $('#music').textContent = 'Music: ' + ({ work: 'Work mix', personal: 'Chill mix', break: 'Chill mix' })[catOf(b)];
}
let bigKey = '';
function paintBig() {
  const c = finished ? FIXED.done : colorsFor(items[idx]), k = c.join();
  if (k !== bigKey) { bigKey = k; big.setColors(c); document.documentElement.style.setProperty('--mode', c[0]); document.documentElement.style.setProperty('--mode2', c[1] || c[0]); }
}

/* ---------- Today's blobs (tray) ---------- */
const nodes = new Map();
function blobSize(it) { return Math.round(Math.max(118, Math.min(184, 92 + it.dur * 1.1))); }
function makeBlob(it) {
  const el = document.createElement('div');
  el.className = 'blob'; el.tabIndex = 0; el.setAttribute('role', 'listitem');
  el.innerHTML = '<div class="face"><span class="t"></span><strong class="n"></strong><span class="d"></span></div>';
  el._jelly = new Jelly(el, { colors: colorsFor(it), wobble: 0.8, points: 26 });
  el._key = colorsFor(it).join();
  attachDrag(el);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(el.dataset.id); } });
  return el;
}
function renderTray() {
  const host = $('#blobs'), future = items.slice(started ? idx + 1 : 1);
  const want = new Set(future.map(i => i.id));
  for (const [id, el] of nodes) if (!want.has(id)) { nodes.delete(id); if (el.isConnected) el._jelly.pop().then(() => el.remove()); }
  future.forEach((it, i) => {
    let el = nodes.get(it.id);
    if (!el) { el = makeBlob(it); nodes.set(it.id, el); }
    el.dataset.id = it.id;
    const s = blobSize(it); el.style.setProperty('--s', s + 'px');
    el.querySelector('.n').textContent = it.name;
    const late = it.kind === 'event' && it.at != null && Math.abs(it.at - it.start) > 4;
    el.querySelector('.t').textContent = fmtClock(it.start);
    el.querySelector('.d').textContent = late ? `booked ${fmtClock(it.at)}` : `${it.dur} min`;
    el.classList.toggle('late', late);
    el.setAttribute('aria-label', `${it.name}, ${fmtClock(it.start)}, ${it.dur} minutes. Press Enter to edit.`);
    const k = colorsFor(it).join(); if (k !== el._key) { el._key = k; el._jelly.setColors(colorsFor(it)); }
    if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null);
  });
  const endAt = items.length ? items[items.length - 1].start + items[items.length - 1].dur : 0;
  $('#traySum').textContent = future.length ? `${future.length} up next · done by ${fmtClock(endAt)}` : 'Nothing else today';
}
function toggleTray(open) {
  const t = $('#tray'), o = open ?? t.hidden;
  t.hidden = !o; $('#big').setAttribute('aria-expanded', String(o));
  $('#hint').textContent = o ? 'Tap the big blob to close' : 'Tap the big blob to see what’s coming up';
  if (o) { renderTray(); requestAnimationFrame(() => nodes.forEach(el => el._jelly.resize())); }
}

/* Drag to rearrange. A tap (no movement) opens the editor. */
function attachDrag(el) {
  let sx, sy, dragging = false, pid = null;
  el.addEventListener('pointerdown', e => { if (e.button) return; sx = e.clientX; sy = e.clientY; pid = e.pointerId; dragging = false; });
  el.addEventListener('pointermove', e => {
    if (pid !== e.pointerId) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!dragging && Math.hypot(dx, dy) > 8) { dragging = true; el.setPointerCapture(pid); el.classList.add('dragging'); }
    if (!dragging) return;
    el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    el.style.pointerEvents = 'none';
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.blob');
    el.style.pointerEvents = '';
    if (over && over !== el && over.dataset.id) {
      const from = items.findIndex(i => i.id === el.dataset.id), to = items.findIndex(i => i.id === over.dataset.id);
      if (from > idx && to > idx || (!started && from >= 1 && to >= 1)) {
        const [m] = items.splice(from, 1); items.splice(to, 0, m);
        const r = el.getBoundingClientRect();
        reflow(); renderTray();
        const r2 = el.getBoundingClientRect(); sx += r2.left - r.left; sy += r2.top - r.top;
        el.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px) scale(1.06)`;
        over._jelly.jiggle(0.6);
      }
    }
  });
  const end = e => {
    if (pid !== e.pointerId) return; pid = null;
    if (dragging) { el.classList.remove('dragging'); el.style.transform = ''; el._jelly.jiggle(1); saveDay(); renderAll(); syncDesktop(); }
    else if (e.type === 'pointerup') openEdit(el.dataset.id);
    dragging = false;
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

function shuffleDay() {
  // Shuffle what's coming up; calendar events and meals keep their places.
  const from = started ? idx + 1 : 1;
  const slots = [], movable = [];
  items.slice(from).forEach((it, i) => { if (it.kind === 'event' || it.kind === 'meal') slots.push([i, it]); else movable.push(it); });
  for (let i = movable.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [movable[i], movable[j]] = [movable[j], movable[i]]; }
  // keep a break after each focus where possible
  const fx = movable.filter(x => x.kind === 'focus'), br = movable.filter(x => x.kind !== 'focus'), mixd = [];
  while (fx.length || br.length) { if (fx.length) mixd.push(fx.shift()); if (br.length) mixd.push(br.shift()); }
  const out = []; let m = 0;
  for (let i = 0; i < items.length - from; i++) { const s = slots.find(x => x[0] === i); out.push(s ? s[1] : mixd[m++]); }
  items = items.slice(0, from).concat(out.filter(Boolean));
  reflow(); saveDay(); renderTray(); nodes.forEach(el => el._jelly.jiggle(1.2)); renderBig(); syncDesktop();
}

/* ---------- Edit dialog ---------- */
let editing = null;
function fillKindOptions() {
  $('#eKind').innerHTML = projects.filter(p => p.name).map(p => `<option value="p:${p.id}">${esc(p.name)} (${CAT_LABEL[p.cat]})</option>`).join('') +
    `<option value="task:work">Other work task</option><option value="task:personal">Personal thing</option>` +
    `<option value="event:work">Meeting (work)</option><option value="event:personal">Personal event</option>` +
    `<option value="snack">Snack break</option><option value="chill">Chill break</option><option value="meal">Meal break</option>`;
}
function kindValue(it) {
  if (it.kind === 'focus') return 'p:' + it.proj;
  if (it.kind === 'task' || it.kind === 'event') return `${it.kind}:${it.cat || 'work'}`;
  return it.kind;
}
function openEdit(id) {
  fillKindOptions();
  editing = id ? items.find(i => i.id === id) : null;
  $('#editTitle').textContent = editing ? 'Edit blob' : 'Add a blob';
  $('#eName').value = editing ? editing.name : '';
  $('#eDur').value = editing ? editing.dur : 30;
  $('#eKind').value = editing ? kindValue(editing) : 'task:work';
  $('#eDelete').hidden = $('#eEarlier').hidden = $('#eLater').hidden = $('#eNow').hidden = !editing;
  $('#editDlg').showModal(); $('#eName').focus();
}
function applyKind(it, v) {
  if (v.startsWith('p:')) { const p = projects.find(q => q.id === v.slice(2)); it.kind = 'focus'; it.proj = p.id; it.cat = p.cat; if (!it.name || it._auto) it.name = p.name; }
  else if (v.includes(':')) { const [k, c] = v.split(':'); it.kind = k; it.cat = c; delete it.proj; }
  else { it.kind = v; it.cat = 'break'; delete it.proj; if (!it.name) it.name = KIND_LABEL[v]; }
}
function moveEditing(dir) {
  const i = items.indexOf(editing), j = i + dir, min = started ? idx + 1 : 1;
  if (j < min || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]]; reflow(); saveDay(); renderTray(); renderBig();
}
$('#editForm').addEventListener('submit', e => {
  e.preventDefault();
  const it = editing || { id: uid(), start: 0 };
  it.name = $('#eName').value.trim() || it.name || 'Blob';
  it.dur = Math.max(5, Math.min(240, Math.round(+$('#eDur').value || 30)));
  applyKind(it, $('#eKind').value);
  if (!editing) items.push(it);
  if (editing && items.indexOf(editing) === idx) remaining = Math.min(remaining, it.dur * 60);
  reflow(); saveDay(); $('#editDlg').close(); renderAll(); syncDesktop();
  nodes.get(it.id)?._jelly.jiggle(1);
});
$('#eCancel').onclick = () => $('#editDlg').close();
$('#eEarlier').onclick = () => moveEditing(-1);
$('#eLater').onclick = () => moveEditing(1);
$('#eDelete').onclick = () => { items.splice(items.indexOf(editing), 1); reflow(); saveDay(); $('#editDlg').close(); renderAll(); syncDesktop(); };
$('#eNow').onclick = () => {   // make this the very next blob
  const i = items.indexOf(editing), to = started ? idx + 1 : 1;
  items.splice(i, 1); items.splice(to, 0, editing); reflow(); saveDay(); $('#editDlg').close(); renderAll(); syncDesktop();
};
$('#eKind').onchange = e => { if (e.target.value.startsWith('p:') && !$('#eName').value) $('#eName').value = projects.find(p => 'p:' + p.id === e.target.value)?.name || ''; };

/* ---------- Timer ---------- */
function enter(i, afterEnd = 0) {
  idx = i; warned = {};
  if (idx >= items.length) {
    running = false; started = false; finished = true; idx = items.length;
    setTimeout(() => cue('done', 'done'), afterEnd * 1000);
    $('#go').textContent = 'Start a new day'; say(customLine('done') || 'All blobs cleared.');
    paintBig(); renderBig(); renderTray(); syncDesktop(); return;
  }
  const b = items[idx]; remaining = b.dur * 60; b.start = Math.round(started ? Math.min(b.start, nowMin()) : b.start);
  const endLine = afterEnd ? customLine('end', items[idx - 1]?.name) : null;
  say(endLine || customLine(MOMENT_OF[b.kind] || 'start', b.name) || '');
  if (endLine) setTimeout(() => { if (items[idx] === b) say(customLine(MOMENT_OF[b.kind] || 'start', b.name) || ''); }, Math.max(2500, afterEnd * 1000));
  paintBig(); renderBig(); renderTray(); syncDesktop(); big.jiggle(1.4);
  setTimeout(() => cue(MOMENT_OF[b.kind] || 'start', 'start'), afterEnd * 1000);
}
const MOMENT_OF = { focus: 'start', task: 'start', event: 'start', snack: 'break', chill: 'break', meal: 'break' };
function say(text) { $('#say').textContent = text; }

function tick() {
  const ts = Date.now();
  if (running) {
    remaining -= (ts - lastTick) / 1000 * speed;
    let guard = 0;
    while (running && remaining <= 0 && guard++ < 50) {
      const over = -remaining;
      if (guard === 1) cue('end', 'end');
      enter(idx + 1, guard === 1 ? Math.max(0.7, clipLens.end || 0) : 0);
      if (running) remaining -= over;
    }
    const b = items[idx];
    if (running && b && b.dur > 6) {
      if (remaining <= 300 && !warned.five) { warned.five = true; cue('warn', 'warn'); say(customLine('warn', b.name) || 'Five minutes left.'); big.jiggle(0.8); }
      if (catOf(b) !== 'break' && b.dur >= 30 && remaining <= b.dur * 30 && !warned.half) { warned.half = true; checkIn(); }
    }
    renderBig();
  }
  lastTick = ts;
}
function checkIn() {
  const b = items[idx]; if (!b) return;
  const leftFocus = items.slice(idx + 1).filter(x => catOf(x) !== 'break').reduce((s, x) => s + x.dur, 0) + (catOf(b) !== 'break' ? Math.ceil(remaining / 60) : 0);
  const status = `${Math.max(0, Math.ceil(remaining / 60))} min left on ${b.name}. ${items.length - idx - 1} blobs after this, ${(leftFocus / 60).toFixed(1)} h of work to go.`;
  const own = customLine('update', b.name);
  say(own ? `${own} ${status}` : status); cue('update', 'tick'); big.jiggle(0.6);
}

/* ---------- Sounds ---------- */
let ctx;
function tone(freq, t0, dur, type = 'sine', gain = .2, glide) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime + t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, ctx.currentTime + t0 + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + t0 + .02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
  o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + dur + .05);
}
function sfx(ev) {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { return; }
  const packs = {
    // Squishy bloops: sine sweeps that drop in pitch like a blob landing.
    blob: { start: () => { tone(520, 0, .18, 'sine', .25, 180); tone(780, .14, .22, 'sine', .18, 300); }, warn: () => tone(660, 0, .25, 'sine', .2, 260),
            tick: () => tone(900, 0, .12, 'sine', .14, 400), end: () => { tone(300, 0, .3, 'sine', .3, 90); tone(620, .18, .25, 'sine', .16, 200); },
            done: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * .14, .3, 'sine', .2, f * .6)) },
    crisp: { start: () => { tone(2100, 0, .12, 'square', .08); tone(2100, .16, .35, 'square', .08, 1900); }, warn: () => tone(1800, 0, .15, 'square', .07), tick: () => tone(1500, 0, .08, 'square', .06), end: () => { tone(2200, 0, .5, 'square', .09, 2000); tone(2200, .55, .5, 'square', .09, 2000); }, done: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .12, .25, 'triangle', .15)) },
    soft: { start: () => { tone(659, 0, 1.2, 'sine', .18); tone(988, .15, 1.2, 'sine', .1); }, warn: () => tone(784, 0, 1, 'sine', .14), tick: () => tone(1175, 0, .4, 'sine', .08), end: () => [784, 659, 523].forEach((f, i) => tone(f, i * .25, 1.1, 'sine', .15)), done: () => [523, 659, 784, 988].forEach((f, i) => tone(f, i * .3, 1.4, 'sine', .12)) },
  };
  ((packs[$('#pack').value] || packs.blob)[ev] || (() => {}))();
}
async function cue(moment, synth) { const d = await playBite(moment).catch(() => 0); if (!d && synth) sfx(synth); return d || 0.6; }

/* ---------- Desktop bridge (menu-bar countdown + notifications in the Mac app) ---------- */
const tauri = window.__TAURI__;
function syncDesktop() {
  if (!tauri) return;
  const b = items[idx], nx = items[idx + 1];
  tauri.core.invoke('sync_timer', {
    running: !!(running && b), remainingS: Math.max(0, remaining) / speed,
    label: b ? (KIND_LABEL[b.kind] || 'Blob') : '',
    nextTitle: nx ? nx.name : 'All blobs cleared',
    nextBody: nx ? (customLine(MOMENT_OF[nx.kind] || 'start', nx.name) || `${KIND_LABEL[nx.kind]} · ${nx.dur} min`) : (customLine('done') || 'Nice work today.'),
  }).catch(() => {});
}

/* ---------- Projects ---------- */
function renderProjects() {
  const tb = $('#projects'); tb.innerHTML = '';
  projects.forEach((p, i) => {
    const tr = document.createElement('tr'), c = projectColors(p);
    tr.innerHTML = `<td><span class="chip-dot" style="--a:${c[0]};--b:${c[1] || c[0]}"></span></td>
      <td><input aria-label="Project name"></td>
      <td><select aria-label="Type"><option value="work">Work</option><option value="personal">Personal</option></select></td>
      <td><input type="date" aria-label="Due date"></td><td><input type="number" min="0" step="0.5" aria-label="Hours left"></td>
      <td><button class="x" aria-label="Remove project">✕</button></td>`;
    const [n, d, h] = tr.querySelectorAll('input'), sel = tr.querySelector('select');
    n.value = p.name; d.value = p.due; h.value = p.hours; sel.value = p.cat;
    n.oninput = e => { p.name = e.target.value; items.forEach(it => { if (it.proj === p.id) it.name = p.name; }); saveProjects(); saveDay(); renderAll(); };
    d.onchange = e => { p.due = e.target.value; changed(); };
    h.oninput = e => { p.hours = +e.target.value; changed(); };
    sel.onchange = e => { p.cat = e.target.value; delete p.color; changed(); renderProjects(); };
    tr.querySelector('.x').onclick = () => { projects.splice(i, 1); changed(); renderProjects(); };
    tr.querySelector('.chip-dot').onclick = () => { const pal = PALETTE[p.cat]; const cur = pal.findIndex(x => x.join() === projectColors(p).join()); p.color = (cur + 1) % pal.length; saveProjects(); renderProjects(); renderAll(); };
    tb.appendChild(tr);
  });
}
function changed() { saveProjects(); rebuild(); }
$('#add').onclick = () => { projects.push({ id: uid(), name: 'New project', due: isoIn(7), hours: 5, cat: 'work' }); changed(); renderProjects(); };

/* ---------- Calendar import ---------- */
function parseICS(text) {
  const out = [], today = new Date(); today.setHours(0, 0, 0, 0);
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let ev = null;
  const parseDate = (prop, val) => {
    if (/VALUE=DATE(?!-)/.test(prop) || /^\d{8}$/.test(val)) return null;       // all-day: skip
    const m = val.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/); if (!m) return null;
    const [, Y, Mo, D, h, mi, s, z] = m;
    return z ? new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s)) : new Date(+Y, +Mo - 1, +D, +h, +mi, +s);
  };
  for (const ln of lines) {
    if (ln === 'BEGIN:VEVENT') ev = {};
    else if (ln === 'END:VEVENT') { if (ev && ev.s && ev.e) out.push(ev); ev = null; }
    else if (ev) {
      const i = ln.indexOf(':'), prop = ln.slice(0, i), val = ln.slice(i + 1);
      if (prop.startsWith('DTSTART')) ev.s = parseDate(prop, val);
      else if (prop.startsWith('DTEND')) ev.e = parseDate(prop, val);
      else if (prop === 'SUMMARY') ev.title = val.replace(/\\,/g, ',').replace(/\\n/g, ' ');
      else if (prop === 'STATUS' && val === 'CANCELLED') ev.cancel = true;
    }
  }
  return out.filter(e => !e.cancel && e.s >= today && e.s < new Date(+today + 864e5)).map(e => ({
    id: uid(), title: e.title || 'Event', start: e.s.getHours() * 60 + e.s.getMinutes(), end: Math.min(24 * 60, Math.round((e.e - today) / 6e4)),
    cat: /gym|doctor|dentist|lunch with|dinner|family|kids|personal|workout|run\b|yoga/i.test(e.title || '') ? 'personal' : 'work',
  }));
}
function setEvents(list, msg) { events = list; saveEvents(); renderEvents(); rebuild(); $('#calMsg').textContent = msg; }
function renderEvents() {
  $('#eventList').innerHTML = events.length ? events.map(e => `<li><span class="chip-dot" style="--a:${(e.cat === 'personal' ? FIXED.personalEvent : FIXED.meeting).join(';--b:')}"></span>${fmtClock(e.start)}–${fmtClock(e.end)} · ${esc(e.title)}
    <button class="small" data-flip="${e.id}">${e.cat === 'personal' ? 'Personal' : 'Work'}</button></li>`).join('') : '<li class="note">No calendar events for today yet.</li>';
}
$('#eventList').addEventListener('click', e => { const id = e.target.dataset.flip; if (!id) return; const ev = events.find(x => x.id === id); ev.cat = ev.cat === 'personal' ? 'work' : 'personal'; saveEvents(); renderEvents(); rebuild(); });
$('#icsFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const list = parseICS(await f.text()); setEvents(list, list.length ? `Added ${list.length} event${list.length > 1 ? 's' : ''} from ${f.name}.` : `No timed events today in ${f.name}.`); e.target.value = '';
};
$('#icsUrlGo').onclick = async () => {
  const url = $('#icsUrl').value.trim(); if (!url) return;
  store.set('blobs.icsUrl', url); $('#calMsg').textContent = 'Fetching your calendar…';
  try {
    const text = tauri?.core ? await tauri.core.invoke('fetch_text', { url }) : await (await fetch(url)).text();
    const list = parseICS(text); setEvents(list, `Synced ${list.length} event${list.length === 1 ? '' : 's'} for today.`);
  } catch (err) { $('#calMsg').textContent = tauri ? "Couldn't reach that calendar link. Check it's the secret iCal address." : 'Browsers block calendar links from other sites. In the Mac app this syncs directly; here, download the .ics and use "Import .ics" instead.'; }
};
$('#icsUrl').value = store.get('blobs.icsUrl', '');
$('#sampleDay').onclick = () => setEvents([
  { id: uid(), title: 'Label check-in call', start: toMin('11:30'), end: toMin('12:00'), cat: 'work' },
  { id: uid(), title: 'Gym', start: toMin('16:00'), end: toMin('17:00'), cat: 'personal' },
], 'Added two example events. Import your own calendar to replace them.');
$('#clearCal').onclick = () => setEvents([], 'Calendar events cleared.');

/* ---------- Wire up ---------- */
function renderAll() { paintBig(); renderBig(); if (!$('#tray').hidden) renderTray(); renderLegend(); }
function renderLegend() {
  const sw = (c, label) => `<span class="leg"><span class="chip-dot" style="--a:${c[0]};--b:${c[1] || c[0]}"></span>${esc(label)}</span>`;
  $('#legend').innerHTML = projects.filter(p => p.name).map(p => sw(projectColors(p), p.name)).join('') +
    sw(FIXED.meeting, 'Meetings') + sw(FIXED.personalEvent, 'Personal events') + sw(FIXED.snack, 'Snack') + sw(FIXED.chill, 'Chill') + sw(FIXED.meal, 'Meal');
}
$('#big').addEventListener('click', () => toggleTray());
$('#big').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTray(); } });
$('#trayClose').onclick = () => toggleTray(false);
$('#addBlob').onclick = () => openEdit(null);
$('#shuffle').onclick = shuffleDay;
$('#replan').onclick = () => { rebuild(); nodes.forEach(el => el._jelly.jiggle(1)); };
$('#go').onclick = () => {
  if (!started) {
    if (finished || !items.length) { finished = false; items = buildDay(); }
    if (!items.length) return;
    finished = false; started = true; running = true; lastTick = Date.now();
    items[0].start = Math.min(items[0].start, Math.round(nowMin())); reflow();
    enter(0); $('#go').textContent = 'Pause'; saveDay(); return;
  }
  running = !running; lastTick = Date.now(); $('#go').textContent = running ? 'Pause' : 'Resume'; syncDesktop();
};
$('#skip').onclick = () => { if (!started) return; cue('end', 'end'); enter(idx + 1, Math.max(0.7, clipLens.end || 0)); };
$('#plus').onclick = () => { const b = items[idx]; if (!b || finished) return; remaining += 300; b.dur += 5; reflow(); saveDay(); renderAll(); syncDesktop(); big.jiggle(0.5); };
$('#checkin').onclick = checkIn;
$('#speed').onclick = e => { speed = speed === 1 ? 60 : 1; e.target.textContent = `Demo speed: ${speed === 1 ? 'off' : '60×'}`; e.target.setAttribute('aria-pressed', String(speed !== 1)); syncDesktop(); };
['#dayStart', '#dayEnd', '#focus', '#snack', '#meal'].forEach(s => $(s).addEventListener('change', () => { saveSettings(); rebuild(); }));
$('#pack').onchange = () => { saveSettings(); sfx('start'); };
$$('[data-snd]').forEach(b => b.onclick = () => sfx(b.dataset.snd));
setupSounds((what, m) => { if (what === 'play') cue(m, { start: 'start', warn: 'warn', end: 'end', break: 'start', update: 'tick', done: 'done' }[m]); });

renderProjects(); renderEvents(); renderAll();
$('#dateLine').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
setInterval(tick, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
