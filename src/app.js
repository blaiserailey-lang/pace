/* BLOB desktop UI: the Brain (timer) on the left and the Living Flow, a string of jelly blobs, to the right.
   All planning goes through BlobEngine (engine/flow.js). The UI only asks for proposals, shows them, and
   applies them when you press Approve. The helper in the ask bar is a set of plain rules, not AI. */
(function () {
  const E = window.BlobEngine, MIN = E.MIN, DAY = E.DAY;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  let seq = 0; const uid = p => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

  /* ---------- colour system (from the handoff) ---------- */
  const CATS = {
    project:  { label: 'Planning & projects', c: ['#b49bff', '#5a35ff'] },
    email:    { label: 'Email & admin',       c: ['#d48bff', '#8a2be2'] },
    fitness:  { label: 'Fitness & personal',  c: ['#5ab8ff', '#1747ff'] },
    meal:     { label: 'Meals & breaks',      c: ['#ffc061', '#ff6a00'] },
    meeting:  { label: 'Meetings',            c: ['#ff86cc', '#ff1f7a'] },
    creative: { label: 'Creative',            c: ['#e6f6ff', '#7cc4ff'], light: true },
  };
  const catOf = c => CATS[c] || CATS[c === 'personal' ? 'fitness' : 'project'];
  const BRAIN = ['#e0ff5c', '#5fd413'];
  const STATUS = { healthy: 'Healthy', attention: 'Needs attention', critical: 'Critical', completed: 'Completed' };
  const stColor = s => `var(--${s})`;

  /* ---------- clock: sample day runs on a demo clock so it always looks like a workday ---------- */
  const clock = { real: store.get('blob.realClock', false), speed: 1, base: 0, anchor: 0 };
  const now = () => clock.real ? Date.now() : clock.base + (Date.now() - clock.anchor) * clock.speed;
  const setNow = ms => { clock.base = ms; clock.anchor = Date.now(); };
  const setSpeed = v => { setNow(now()); clock.speed = v; };
  // The sample day is today, or next Monday when today is a weekend.
  const demoDay = () => { let d = E.dayOf(Date.now()); while ([0, 6].includes(new Date(d).getDay())) d = E.addDays(d, 1); return d; };
  const today9 = () => demoDay() + (9 * 60 + 20) * MIN;

  /* ---------- sample data, clearly labeled ---------- */
  function sampleState(startAt) {
    // Day 0 is the sample day; 1, 2, 3 are the following workdays.
    const work = [E.dayOf(startAt)];
    while (work.length < 6) { let d = E.addDays(work[work.length - 1], 1); while ([0, 6].includes(new Date(d).getDay())) d = E.addDays(d, 1); work.push(d); }
    const t = (d, hm) => { const [h, m] = hm.split(':').map(Number); return work[d] + (h * 60 + m) * MIN; };
    const cal = 'Sample calendar';
    let s = E.createState({
      events: [
        { id: 'ev-standup', title: 'Team standup', start: t(0, '09:30'), dur: 15, cat: 'meeting', source: cal },
        { id: 'ev-review', title: 'Client review', start: t(0, '14:00'), dur: 60, cat: 'meeting', source: cal },
        { id: 'ev-gym', title: 'Gym', start: t(0, '17:30'), dur: 45, cat: 'fitness', source: cal },
        { id: 'ev-crit', title: 'Design crit', start: t(1, '11:00'), dur: 60, cat: 'meeting', source: cal },
        { id: 'ev-run', title: 'Run club', start: t(1, '17:15'), dur: 45, cat: 'fitness', source: cal },
        { id: 'ev-1on1', title: '1:1 with Sam', start: t(2, '10:00'), dur: 30, cat: 'meeting', source: cal },
      ],
      sessions: [
        { id: 'se-inbox', title: 'Inbox sweep', cat: 'email', start: t(0, '10:00'), dur: 30, source: 'Sample task' },
        { id: 'se-sketch', title: 'Album cover sketches', cat: 'creative', start: t(0, '10:45'), dur: 60, source: 'Sample task' },
        { id: 'se-plan', title: 'Plan next week', cat: 'project', start: t(0, '15:20'), dur: 45, source: 'Sample task' },
        { id: 'se-label', title: 'Reply to label', cat: 'email', start: t(1, '09:30'), dur: 30, source: 'Sample task' },
        { id: 'se-mix', title: 'Mix review', cat: 'creative', start: t(1, '14:00'), dur: 60, source: 'Sample task' },
        { id: 'se-walk', title: 'Walk', cat: 'fitness', start: t(2, '12:00'), dur: 20, source: 'Sample task' },
      ],
    });
    // One deadline already set up, so the deadline-aware flow is visible on first open.
    s.deadlines.push({ id: 'dl-grant', title: 'Grant application', due: t(4, '17:00'), cat: 'project', sessionLen: 60, report: null, done: false });
    s.sessions.push(
      { id: 'dl-grant-s1', title: 'Grant application', cat: 'project', start: t(2, '14:00'), dur: 60, deadlineId: 'dl-grant', status: 'planned', source: 'Sample deadline' },
      { id: 'dl-grant-s2', title: 'Grant application', cat: 'project', start: t(3, '10:00'), dur: 60, deadlineId: 'dl-grant', status: 'planned', source: 'Sample deadline' });
    s.sample = true;
    return s;
  }

  /* ---------- state ---------- */
  let saved = store.get('blob.state', null);
  const savedClock = store.get('blob.clock', null);
  const fresh = saved && saved.day === E.dayOf(Date.now());
  if (!clock.real) setNow(fresh && savedClock ? savedClock : today9());
  let state = fresh ? saved.state : sampleState(now());
  const save = () => { store.set('blob.state', { day: E.dayOf(Date.now()), state }); if (!clock.real) store.set('blob.clock', now()); };
  save();

  const ui = { selected: null, zoom: store.get('blob.zoom', 1), proposal: null, card: null, missedAsked: new Set() };
  let timer = store.get('blob.timer', null); // {id, endsAt, left, total, running}
  const saveTimer = () => store.set('blob.timer', timer);
  const hooks = { brain: () => {} };   // the music blob repaints along with the Brain

  /* ---------- formatting ---------- */
  const clk = ms => E.clock(ms);
  const mmss = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };
  const durTxt = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;
  const until = ms => { const d = ms - now(); if (d <= 0) return 'now'; const m = Math.round(d / MIN); if (m < 60) return `in ${m}m`; const h = Math.floor(m / 60); if (h < 24) return `in ${h}h ${m % 60}m`; return `in ${Math.floor(h / 24)}d ${h % 24}h`; };
  const dayLabel = day => { const d = Math.round((day - E.dayOf(now())) / DAY); return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : new Date(day).toLocaleDateString('en-US', { weekday: 'long' }); };

  /* ---------- what's on the string ---------- */
  // A week ahead, stretched to reach any open deadline in the next two weeks.
  const VISIBLE_DAYS = 7;
  function flowItems() {
    const n = now(), d0 = E.dayOf(n), out = [];
    const lastDue = Math.max(0, ...state.deadlines.filter(d => !d.done).map(d => Math.round((E.dayOf(d.due) - d0) / DAY) + 1));
    for (let i = 0; i < Math.min(14, Math.max(VISIBLE_DAYS, lastDue)); i++) {
      const day = E.addDays(d0, i);
      const list = E.dayFlow(state, day).filter(x => x.kind !== 'session' || x.status === 'planned' || x.status === 'active');
      for (const d of state.deadlines) if (E.dayOf(d.due) === day) list.push({ id: 'due-' + d.id, kind: 'deadline', title: d.title, start: d.due, dur: 0, cat: d.cat, deadlineId: d.id, fixed: true });
      list.sort((a, b) => a.start - b.start || (a.kind === 'deadline' ? 1 : -1));
      list.forEach(x => { x.day = day; x.past = x.kind !== 'deadline' && E.end(x) <= n && x.status !== 'active'; x.missed = x.past && x.kind === 'session'; });
      out.push(...list);
    }
    return out;
  }
  const findItem = id => flowItems().find(x => x.id === id);
  const session = id => state.sessions.find(x => x.id === id);
  const upcoming = () => flowItems().filter(x => !x.past && x.kind !== 'deadline');

  /* ---------- layout + elastic motion ---------- */
  const stage = $('#stage'), track = $('#track'), lane = $('#lane'), strandsCv = $('#strands'), sg = strandsCv.getContext('2d');
  const nodes = new Map(); let order = [], dividers = [];
  const GAP = 20;
  const sizeFor = it => it.kind === 'deadline' ? 136 : it.past ? 84 : Math.max(106, Math.min(168, 100 + it.dur * 0.62));

  function layout(list) {
    const z = ui.zoom * (innerWidth > 760 ? 1 : 0.72), mid = track.clientHeight * (innerWidth > 760 ? 0.42 : 0.5), pos = [], divs = [];
    let x = 50 * z, prevDay = list.length ? list[0].day : null;
    divs.push({ x: 40 * z, day: prevDay, first: true });
    list.forEach((it, i) => {
      if (it.day !== prevDay) { x += 46 * z; divs.push({ x, day: it.day }); x += 46 * z; prevDay = it.day; }
      const s = sizeFor(it) * z;
      x += s / 2;
      pos.push({ x, y: mid + Math.sin(i * 1.3) * 10 * z, s });
      x += s / 2 + GAP * z;
    });
    return { pos, divs, width: x + 60 };
  }

  function brainInLane() {
    const b = $('#brain').getBoundingClientRect(), l = lane.getBoundingClientRect();
    return { x: b.left + b.width / 2 - l.left, y: b.top + b.height / 2 - l.top };
  }

  function makeNode(it) {
    const wrap = document.createElement('div'); wrap.className = 'node'; wrap.setAttribute('role', 'listitem');
    const el = document.createElement('button'); el.className = 'blob'; el.type = 'button';
    el.innerHTML = '<span class="face"><span class="t"></span><strong class="n"></strong><span class="d"></span></span>';
    wrap.appendChild(el); lane.appendChild(wrap);
    const n = { id: it.id, wrap, el, x: 0, y: 0, vx: 0, vy: 0, sc: 0.2, vs: 0, tx: 0, ty: 0, ts: 0, size: 0 };
    n.jelly = new Jelly(el, { colors: catOf(it.cat).c, glow: true, radius: 0.46, points: 26, wobble: 1.1 });
    el.addEventListener('click', () => select(n.id));
    return n;
  }

  function paintNode(n, it) {
    const el = n.el, c = catOf(it.cat);
    const cls = ['blob', it.kind, it.past && 'past', it.missed && 'missed', it.kind === 'session' && timer && timer.id === it.id && 'active',
      ui.selected === it.id && 'selected', c.light && 'light', ui.proposal && ui.proposal.touch.has(it.id) && 'preview'];
    let st = null;
    if (it.deadlineId) { st = E.deadlineStatus(state, it.deadlineId, now()); if (st) cls.push(st.state); }
    el.className = cls.filter(Boolean).join(' ');
    el.style.setProperty('--st', st ? stColor(st.state) : '');
    const [t, nm, d] = el.querySelectorAll('.face > *');
    if (it.kind === 'deadline') {
      t.textContent = 'DUE'; nm.textContent = it.title; d.textContent = `${clk(it.start)} · ${until(it.start)}`;
    } else {
      t.textContent = clk(it.start); nm.textContent = it.title; d.textContent = durTxt(it.dur);
    }
    let tag = el.querySelector('.tag');
    if (it.kind === 'session' && st) { if (!tag) { tag = document.createElement('span'); tag.className = 'tag'; el.appendChild(tag); } tag.title = `${STATUS[st.state]}: ${st.reason}`; }
    else if (tag) tag.remove();
    const label = it.kind === 'deadline' ? `Deadline: ${it.title}, due ${E.when(it.start, now())}${st ? ', ' + STATUS[st.state] : ''}`
      : `${it.title}, ${E.when(it.start, now())}, ${durTxt(it.dur)}${it.fixed ? ', calendar event' : ''}${it.missed ? ', missed' : ''}`;
    el.setAttribute('aria-label', label);
    if (n.cat !== it.cat) { n.jelly.setColors(c.c); n.cat = it.cat; }
    n.jelly.dim = it.past ? 0.3 : 1;
  }

  function render() {
    const list = flowItems(), L = layout(list), ids = new Set(list.map(x => x.id));
    for (const [id, n] of nodes) if (!ids.has(id) && !n.leaving) {
      n.leaving = true; n.el.classList.add('popping');
      setTimeout(() => { n.wrap.remove(); nodes.delete(id); }, 440);
    }
    const from = brainInLane();
    list.forEach((it, i) => {
      let n = nodes.get(it.id);
      if (!n || n.leaving) { if (n) { n.wrap.remove(); } n = makeNode(it); n.x = from.x; n.y = from.y; n.sc = 0.15; nodes.set(it.id, n); }
      const p = L.pos[i];
      n.tx = p.x; n.ty = p.y;
      if (Math.abs(n.size - p.s) > 0.5) { n.size = p.s; n.wrap.style.width = n.wrap.style.height = p.s + 'px'; }
      n.item = it; paintNode(n, it);
    });
    order = list.map(x => x.id);
    lane.style.width = L.width + 'px';
    lane.querySelectorAll('.divider,.nowpin').forEach(d => d.remove());
    dividers = L.divs;
    for (const d of L.divs) { const el = document.createElement('div'); el.className = 'divider'; el.style.left = d.x + 'px'; el.textContent = dayLabel(d.day); lane.appendChild(el); }
    const firstUp = list.find(x => !x.past);
    if (firstUp) { const p = L.pos[list.indexOf(firstUp)], pin = document.createElement('div'); pin.className = 'nowpin'; pin.textContent = `now ${clk(now())}`; pin.style.left = p.x + 'px'; pin.style.top = (p.y - p.s / 2 - 34) + 'px'; lane.appendChild(pin); }
    renderBrain();
  }

  // One loop: springs pull each blob to its place (overshooting a little, like jelly), then the strands are drawn.
  let lastT = 0;
  function frame(ts) {
    const dt = Math.min(0.033, (ts - (lastT || ts)) / 1000) || 0.016; lastT = ts;
    const k = 90, c = 11;
    for (const n of nodes.values()) {
      n.vx += (k * (n.tx - n.x) - c * n.vx) * dt; n.vy += (k * (n.ty - n.y) - c * n.vy) * dt;
      n.vs += (140 * (1 - n.sc) - 12 * n.vs) * dt;
      n.x += n.vx * dt; n.y += n.vy * dt; n.sc += n.vs * dt;
      const s = n.size;
      n.wrap.style.transform = `translate(${n.x - s / 2}px,${n.y - s / 2}px) scale(${Math.max(0.05, n.sc)})`;
      // A fast move squishes the jelly in the direction of travel.
      if (Math.abs(n.vx) > 220 && n.jelly) n.jelly.vx += n.vx * 0.002;
    }
    drawStrands(ts / 1000);
    requestAnimationFrame(frame);
  }

  function drawStrands(t) {
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (strandsCv.width !== Math.round(r.width * dpr) || strandsCv.height !== Math.round(r.height * dpr)) { strandsCv.width = Math.round(r.width * dpr); strandsCv.height = Math.round(r.height * dpr); }
    sg.setTransform(dpr, 0, 0, dpr, 0, 0); sg.clearRect(0, 0, r.width, r.height);
    const l = lane.getBoundingClientRect(), tr = track.getBoundingClientRect(), ox = l.left - r.left, oy = l.top - r.top;
    const pts = order.map(id => nodes.get(id)).filter(n => n && !n.leaving).map(n => ({ x: n.x + ox, y: n.y + oy, s: n.size * n.sc, c: catOf(n.item.cat).c[1], past: n.item.past, kind: n.item.kind }));
    const b = $('#brain').getBoundingClientRect();
    const brain = { x: b.left + b.width / 2 - r.left, y: b.top + b.height / 2 - r.top, s: b.width * 0.92, c: BRAIN[1] };
    const first = pts.find(p => !p.past);
    sg.save();
    sg.beginPath(); sg.rect(tr.left - r.left, 0, tr.width, r.height); sg.clip();
    for (let i = 0; i < pts.length - 1; i++) strand(pts[i], pts[i + 1], t, i, pts[i].past || pts[i + 1].past ? 0.25 : 1);
    sg.restore();
    if (first && innerWidth > 760) {
      const tgt = first.x < tr.left - r.left ? { ...first, x: tr.left - r.left + 4 } : first;
      strand(brain, tgt, t, -1, 1);
    }
    // The music blob hangs from a strand of its own into the Brain.
    if (innerWidth > 760) {
      const m = music.el.getBoundingClientRect();
      const top = { x: brain.x + 8, y: m.top + m.height / 2 - r.top, s: m.height, c: MUSIC[1] };
      strand(top, { ...brain, s: brain.s * 0.62, c: MUSIC[0] }, t, 9, music.linked ? 0.85 : 0.3);
    }
  }
  // A strand is a glowing jelly bridge: thick where it meets each blob, pinched in the middle, and it
  // thins out as it stretches.
  function strand(a, b, t, i, alpha) {
    const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    const ra = a.s * 0.4, rb = b.s * 0.4;
    const span = dist - ra - rb; if (span < -10) return;
    const w0 = Math.min(a.s, b.s) * 0.12, pinch = Math.max(1.5, w0 * Math.min(0.75, 36 / Math.max(10, span)));
    const ax = a.x + ux * ra * 0.8, ay = a.y + uy * ra * 0.8, bx = b.x - ux * rb * 0.8, by = b.y - uy * rb * 0.8;
    const mx = (ax + bx) / 2, my = (ay + by) / 2 + Math.sin(t * 2.1 + i) * 3;
    const nx = -uy, ny = ux;
    const grad = sg.createLinearGradient(ax, ay, bx, by); grad.addColorStop(0, a.c); grad.addColorStop(1, b.c);
    sg.save(); sg.globalAlpha = alpha;
    sg.shadowColor = b.c; sg.shadowBlur = 16; sg.fillStyle = grad;
    sg.beginPath();
    sg.moveTo(ax + nx * w0, ay + ny * w0);
    sg.quadraticCurveTo(mx + nx * pinch, my + ny * pinch, bx + nx * w0, by + ny * w0);
    sg.lineTo(bx - nx * w0, by - ny * w0);
    sg.quadraticCurveTo(mx - nx * pinch, my - ny * pinch, ax - nx * w0, ay - ny * w0);
    sg.closePath(); sg.fill();
    sg.shadowBlur = 0; sg.globalAlpha = alpha * 0.55; sg.strokeStyle = 'rgba(255,255,255,.7)'; sg.lineWidth = Math.max(1, pinch * 0.35);
    sg.beginPath(); sg.moveTo(ax + nx * w0 * 0.4, ay + ny * w0 * 0.4); sg.quadraticCurveTo(mx + nx * pinch * 0.4, my + ny * pinch * 0.4, bx + nx * w0 * 0.4, by + ny * w0 * 0.4); sg.stroke();
    sg.restore();
  }

  /* ---------- the Brain ---------- */
  const brainJelly = new Jelly($('#brain'), { colors: BRAIN, glow: true, radius: 0.45, points: 36, wobble: 0.9 });
  const SEGS = 14;
  $('#gauge').innerHTML = Array.from({ length: SEGS }, (_, i) => {
    const a0 = (-160 + i * (140 / SEGS) + 1.5) * Math.PI / 180, a1 = (-160 + (i + 1) * (140 / SEGS) - 1.5) * Math.PI / 180, R = 66;
    const p = a => `${100 + Math.cos(a) * R} ${100 + Math.sin(a) * R}`;
    return `<path d="M ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)}" stroke-width="9" stroke-linecap="round" fill="none"/>`;
  }).join('');
  const segColor = i => { const t = i / (SEGS - 1); return t < 0.5 ? `hsl(${130 - t * 120} 100% 55%)` : `hsl(${70 - (t - 0.5) * 80} 100% 55%)`; };

  function renderBrain() {
    const n = now(), act = timer && session(timer.id);
    const segs = $$('#gauge path');
    let frac = 0;
    if (act) {
      const left = timer.running ? (timer.endsAt - n) / 1000 : timer.left / 1000;
      frac = Math.max(0, Math.min(1, left * 1000 / timer.total));
      $('#brainLbl').textContent = timer.running ? catOf(act.cat).label : 'Paused';
      $('#brainTime').textContent = mmss(left);
      $('#brainTitle').textContent = act.title;
      const nx = upcoming().find(x => x.id !== act.id && x.start >= act.start);
      $('#brainSub').textContent = nx ? `Then ${nx.title} at ${clk(nx.start)}` : '';
      $('#go').textContent = timer.running ? 'Pause' : 'Resume'; $('#go').disabled = false;
      $('#finish').hidden = false;
    } else {
      const nx = upcoming()[0];
      $('#brainLbl').textContent = nx ? 'Up next' : 'All clear';
      const d = nx && new Date(nx.start);
      $('#brainTime').textContent = nx ? `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}` : '✓';
      $('#brainTitle').textContent = nx ? nx.title : 'Nothing left on the string';
      $('#brainSub').textContent = nx ? (nx.start > n ? until(nx.start) : 'happening now') : '';
      const startable = nx && nx.kind === 'session';
      $('#go').textContent = startable ? 'Start' : 'Start next';
      $('#go').disabled = !upcoming().some(x => x.kind === 'session');
      $('#finish').hidden = true;
    }
    segs.forEach((s, i) => { const on = act && i < Math.ceil(frac * SEGS); s.setAttribute('stroke', on ? segColor(SEGS - 1 - i) : 'rgba(10,40,0,.35)'); });
    $('#clockBadge').textContent = `${clock.real ? '' : 'Demo clock '}${clk(n)}${clock.speed > 1 ? ' · ' + clock.speed + '×' : ''}`;
    $('#dateLine').textContent = new Date(n).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    $('#sampleBadge').hidden = !state.sample;
    hooks.brain();
  }

  /* ---------- timer ---------- */
  // Pressing Start is your call, so the session moves to now without asking. Anything it now
  // overlaps is a separate suggestion you approve.
  function startTimer(id) {
    const x = session(id); if (!x) return;
    const n = now(), at = Math.floor(n / MIN) * MIN;
    if (timer && timer.id !== id) { const prev = session(timer.id); if (prev && prev.status === 'active') state = E.apply(state, { changes: [{ op: 'status', id: prev.id, to: 'planned' }] }); }
    const moved = Math.abs(x.start - at) > 15 * MIN;
    state = E.apply(state, { changes: [...(moved ? [{ op: 'move', id, from: x.start, to: at }] : []), { op: 'status', id, to: 'active' }] });
    timer = { id, total: x.dur * MIN, endsAt: n + x.dur * MIN, left: x.dur * MIN, running: true, warned: false };
    saveTimer(); save(); cue('start', 'start'); brainJelly.jiggle(1.2); closeCard(); render(); syncDesktop();
    music.forBlob(x);
    if (moved) setTimeout(() => scrollToX((nodes.get(id)?.tx || 0) - track.clientWidth * 0.3), 80);
    const p = E.proposeRunningLate(state, 0, n);
    if (p.changes.length) {
      p.summary = `Make room after “${x.title}”?`;
      p.reason = `It now runs until ${clk(n + x.dur * MIN)}. ${p.reason}`;
      setTimeout(() => showProposal(p), 500);
    }
    const clash = state.events.find(e => e.start < n + x.dur * MIN && E.end(e) > n);
    if (clash && !p.changes.length) setTimeout(() => reply(`Heads up: <b>${esc(clash.title)}</b> is at ${clk(clash.start)}. Calendar events stay put, so you may want to pause for it.`), 500);
  }
  function togglePause() {
    if (!timer) return;
    if (timer.running) { timer.left = timer.endsAt - now(); timer.running = false; music.timerEvent('pause'); }
    else { timer.endsAt = now() + timer.left; timer.running = true; music.timerEvent('resume'); }
    saveTimer(); renderBrain(); syncDesktop();
  }
  function finishActive(id = timer && timer.id) {
    if (!id) return;
    const n = nodes.get(id);
    if (n) n.jelly.pop();
    state = E.apply(state, { changes: [{ op: 'status', id, to: 'done' }] });
    if (timer && timer.id === id) { timer = null; music.timerEvent('end'); }
    saveTimer(); save(); cue(upcoming().some(x => x.kind === 'session') ? 'end' : 'done', upcoming().length ? 'tick' : 'done');
    closeCard(); setTimeout(render, 120); brainJelly.jiggle(1.5); syncDesktop();
  }
  const requestStart = id => startTimer(id);

  function tick() {
    const n = now();
    if (timer && timer.running) {
      const left = timer.endsAt - n;
      if (!timer.warned && left <= 2 * MIN && timer.total > 4 * MIN) { timer.warned = true; cue('warn', 'warn'); saveTimer(); }
      if (left <= 0) { timer.left = 0; timer.running = false; saveTimer(); cue('end', 'end'); brainJelly.jiggle(2); showTimeUp(timer.id); syncDesktop(); music.timerEvent('end'); }
    }
    // A session whose time passed without being started: offer a new time (once).
    if (!ui.card) {
      const missed = state.sessions.find(x => x.status === 'planned' && E.end(x) <= n && E.dayOf(x.start) === E.dayOf(n) && !ui.missedAsked.has(x.id) && (!timer || timer.id !== x.id));
      if (missed) { ui.missedAsked.add(missed.id); showProposal(E.proposeMissed(state, missed.id, n)); }
    }
    renderBrain();
  }

  /* ---------- context card (mini-chat, proposals, details) ---------- */
  const card = $('#card');
  function openCard(html, kind) {
    card.innerHTML = html; card.hidden = false; ui.card = kind;
    card.querySelector('[data-x]')?.addEventListener('click', closeCard);
    const mini = card.querySelector('.mini');
    if (mini) mini.addEventListener('submit', e => { e.preventDefault(); const v = mini.querySelector('input').value.trim(); if (v) handleAsk(v, ui.selected); });
  }
  function closeCard() {
    card.hidden = true; card.innerHTML = ''; ui.card = null;
    if (ui.proposal) { ui.proposal = null; }
    if (ui.selected) { ui.selected = null; }
    render();
  }
  const xBtn = '<button class="ghost icon" data-x aria-label="Close">✕</button>';
  const miniChat = ph => `<form class="mini"><input placeholder="${esc(ph)}" aria-label="Ask about this blob"><button class="ghost">Ask</button></form>`;
  const statusChip = st => `<span class="status" style="--st:${stColor(st.state)}">${STATUS[st.state]}</span>`;

  function select(id) {
    const it = findItem(id); if (!it) return;
    ui.selected = id; ui.proposal = null;
    const n = now(), c = catOf(it.cat);
    const kicker = `<span class="kicker"><i style="--a:${c.c[0]};--b:${c.c[1]}"></i>${esc(c.label)}${it.fixed && it.kind === 'event' ? ' · calendar' : ''}</span>`;
    if (it.kind === 'deadline') return showDeadline(it.deadlineId);
    if (it.kind === 'event' || it.kind === 'meal') {
      openCard(`<div class="head"><div>${kicker}<h3>${esc(it.title)}</h3></div>${xBtn}</div>
        <p class="meta">${E.when(it.start, n)} – ${clk(E.end(it))} · ${durTxt(it.dur)}</p>
        <p class="from">${it.kind === 'meal' ? 'Lunch comes from your settings.' : `From your ${esc(it.source || 'calendar')}.`} Blob keeps it where it is.</p>`, 'detail');
      return render();
    }
    const st = it.deadlineId && E.deadlineStatus(state, it.deadlineId, n);
    const dl = it.deadlineId && state.deadlines.find(d => d.id === it.deadlineId);
    const isActive = timer && timer.id === id;
    openCard(`<div class="head"><div>${kicker}<h3>${esc(it.title)}</h3></div>${xBtn}</div>
      <p class="meta">${E.when(it.start, n)} – ${clk(E.end(it))} · ${durTxt(it.dur)} you chose${it.missed ? ' · <b>missed</b>' : ''}</p>
      ${dl ? `<p>Toward <b>${esc(dl.title)}</b>, due ${E.when(dl.due, n)} ${statusChip(st)}</p>` : ''}
      <div class="actions">
        ${isActive ? '<button class="primary" data-a="done">Done</button>' : '<button class="primary" data-a="start">Start timer</button>'}
        <button class="ghost" data-a="later">Later today</button>
        <button class="ghost" data-a="tomorrow">Tomorrow</button>
        ${isActive ? '' : '<button class="ghost" data-a="done">Mark done</button>'}
        ${dl ? '<button class="ghost" data-a="deadline">Deadline</button>' : ''}
      </div>
      ${miniChat('e.g. “move to 3pm”, “push to tomorrow”')}
      <p class="from">${esc(it.source || 'You added this')}. <span class="label-ai">The helper follows fixed rules; it isn't AI.</span></p>`, 'detail');
    card.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'start') requestStart(id);
      else if (a === 'done') finishActive(id);
      else if (a === 'deadline') showDeadline(it.deadlineId);
      else showProposal(E.proposeMove(state, id, a, now()));
    });
    render();
  }

  function changeRows(p) {
    const n = now();
    const name = id => { const x = session(id) || state.events.find(e => e.id === id) || state.deadlines.find(d => d.id === id); return x ? x.title : id; };
    return p.changes.map(c => {
      if (c.op === 'add') return `<li><span class="op">add</span>${esc(c.item.title)} · ${E.when(c.item.start, n)} · ${durTxt(c.item.dur)}</li>`;
      if (c.op === 'move') return `<li><span class="op">move</span>${esc(name(c.id))}: ${clk(c.from)} → ${E.when(c.to, n)}</li>`;
      if (c.op === 'resize') return `<li><span class="op">extend</span>${esc(name(c.id))}: ${durTxt(c.from)} → ${durTxt(c.to)}</li>`;
      if (c.op === 'status') return `<li><span class="op">${esc(c.to)}</span>${esc(name(c.id))}</li>`;
      if (c.op === 'unplace') return `<li><span class="op">no time</span>${esc(name(c.id))} comes off the string until you pick a time</li>`;
      if (c.op === 'deadline') return `<li><span class="op">deadline</span>${esc(c.item.title)}, due ${E.when(c.item.due, n)}</li>`;
      if (c.op === 'event') return `<li><span class="op">calendar</span>${esc(c.item.title)} · ${clk(c.item.start)}–${clk(E.end(c.item))} (stays fixed)</li>`;
      if (c.op === 'flag') return '';
      return '';
    }).join('');
  }

  function showProposal(p) {
    const touched = new Set(p.changes.map(c => c.id));
    ui.proposal = { p, touch: touched };
    const can = p.changes.some(c => c.op !== 'flag');
    openCard(`<div class="head"><div><span class="kicker">Suggestion</span><h3>${esc(p.summary)}</h3></div>${xBtn}</div>
      <p>${esc(p.reason)}</p>
      ${can ? `<ul class="changes">${changeRows(p)}</ul>` : ''}
      ${p.options ? p.options.map((o, i) => `<button class="ghost" data-opt="${i}" style="margin-top:10px">Use ${esc(E.when(o.start, now()))}</button>`).join('') : ''}
      <div class="actions">
        ${can ? '<button class="primary" data-ok>Approve</button>' : ''}
        <button class="ghost" data-no>${can ? 'Not now' : 'OK'}</button>
      </div>
      <p class="from">Nothing changes until you approve. <span class="label-ai">Rule-based helper, not AI.</span></p>`, 'proposal');
    card.querySelector('[data-ok]')?.addEventListener('click', () => approve(p));
    card.querySelector('[data-no]').addEventListener('click', closeCard);
    card.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
      const id = p.conflicts[0], o = p.options[+b.dataset.opt];
      showProposal(E.proposeMove(state, id, { start: o.start }, now()));
    });
    render();
  }

  function approve(p) {
    const added = p.changes.filter(c => c.op === 'add').map(c => c.id);
    state = E.apply(state, p); state.sample = state.sample && true;
    save(); ui.proposal = null; closeCard();
    sfx('tick');
    if (p.after) p.after();
    // Bring new or moved blobs into view and give them a wobble.
    const focus = added[0] || (p.changes.find(c => c.op === 'move') || {}).id;
    if (focus) setTimeout(() => { const n = nodes.get(focus); if (n) { scrollToX(n.tx - track.clientWidth * 0.35); n.jelly.jiggle(1.5); } }, 60);
    if (timer && p.changes.some(c => c.op === 'move' && c.id === timer.id)) { timer = null; saveTimer(); }
    render(); syncDesktop();
  }

  function showTimeUp(id) {
    const x = session(id); if (!x) return;
    ui.selected = id;
    openCard(`<div class="head"><div><span class="kicker">Time's up</span><h3>${esc(x.title)}</h3></div>${xBtn}</div>
      <p>Your ${durTxt(x.dur)} is done. What do you want to do?</p>
      <div class="actions">
        <button class="ghost" data-t="extend15">+15 min</button>
        <button class="ghost" data-t="extend30">+30 min</button>
        <button class="primary" data-t="finish">Finish</button>
        <button class="ghost" data-t="reschedule">Reschedule the rest</button>
      </div>`, 'timeup');
    card.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      const choice = b.dataset.t;
      if (choice === 'finish') return finishActive(id);
      const p = E.proposeTimeUp(state, id, choice, now());
      if (choice.startsWith('extend')) {
        const add = (p.changes[0].to - p.changes[0].from) * MIN;
        p.after = () => { timer = { ...timer, total: timer.total + add, endsAt: now() + add, left: add, running: true, warned: false }; saveTimer(); renderBrain(); syncDesktop(); music.timerEvent('resume'); };
        if (p.changes.length === 1) return approve(p);   // nothing else moves: no need to ask
      } else {
        p.after = () => { timer = null; saveTimer(); renderBrain(); };
      }
      showProposal(p);
    });
  }

  function showDeadline(dlId) {
    const d = state.deadlines.find(o => o.id === dlId); if (!d) return;
    const n = now(), st = E.deadlineStatus(state, dlId, n), c = catOf(d.cat);
    const ss = state.sessions.filter(x => x.deadlineId === dlId && x.status !== 'moved').sort((a, b) => a.start - b.start);
    ui.selected = 'due-' + dlId;
    openCard(`<div class="head"><div><span class="kicker"><i style="--a:${c.c[0]};--b:${c.c[1]}"></i>Deadline</span><h3>${esc(d.title)}</h3></div>${xBtn}</div>
      <p class="meta">Due ${E.when(d.due, n)} · ${until(d.due)}</p>
      <p>${statusChip(st)} <span class="meta">${esc(st.reason)}</span></p>
      <ul class="changes">${ss.length ? ss.map(x => `<li><span class="op">${x.status === 'done' ? 'done' : x.status === 'unplaced' ? 'no time' : 'session'}</span>${x.status === 'unplaced' ? 'Needs a new time' : E.when(x.start, n)} · ${durTxt(x.dur)}</li>`).join('') : '<li class="meta">No sessions planned.</li>'}</ul>
      <p class="meta" style="margin-top:12px">How's it going? Only you know, so status comes from your answer.</p>
      <div class="actions">
        <button class="ghost" data-r="on-track">On track</button>
        <button class="ghost" data-r="unsure">Not sure</button>
        <button class="ghost" data-r="behind">Behind</button>
        <button class="primary" data-r="done">It's done</button>
        <button class="ghost" data-r="more">Add a session</button>
      </div>`, 'deadline');
    card.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
      const r = b.dataset.r;
      if (r === 'more') return showProposal(E.proposeAdd(state, { id: uid(dlId), title: d.title, cat: d.cat, dur: d.sessionLen || 60, deadlineId: dlId, source: 'You added this' }, now()));
      state = E.report(state, dlId, r); save();
      if (r === 'done') { const nd = nodes.get('due-' + dlId); if (nd) nd.jelly.jiggle(2); cue('done', 'done'); }
      showDeadline(dlId); render();
      if (r === 'behind') {
        const p = E.proposeAdd(state, { id: uid(dlId), title: d.title, cat: d.cat, dur: d.sessionLen || 60, deadlineId: dlId, source: 'You added this' }, now());
        if (p.changes.length) { p.summary = `Add another session for “${d.title}”?`; p.reason = `You said you're behind. ${p.reason}`; setTimeout(() => showProposal(p), 500); }
      }
    });
    render();
  }

  /* ---------- rule-based helper (ask bar + mini-chat). Plain patterns, no AI. ---------- */
  function parseTime(text) {
    const m = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);
    if (!m) return null;
    let h = +m[1]; const mi = +(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (!ap && h < 8) h += 12;
    const day = /tomorrow/i.test(text) ? E.addDays(E.dayOf(now()), 1) : E.dayOf(now());
    return day + (h * 60 + mi) * MIN;
  }
  function targetSession(ctxId, text) {
    if (ctxId && session(ctxId)) return session(ctxId);
    const lower = text.toLowerCase();
    const named = state.sessions.find(x => (x.status === 'planned' || x.status === 'active') && lower.includes(x.title.toLowerCase()));
    if (named) return named;
    if (timer && /\b(this|current)\b/.test(lower)) return session(timer.id);
    const nx = upcoming().find(x => x.kind === 'session' && (!timer || x.id !== timer.id));
    return nx ? session(nx.id) : null;
  }
  function reply(html) {
    openCard(`<div class="head"><div><span class="kicker">Blob</span></div>${xBtn}</div><div class="reply">${html}</div>
      <p class="from"><span class="label-ai">Rule-based helper, not AI.</span></p>`, 'reply');
  }
  function handleAsk(text, ctxId) {
    const t = text.toLowerCase(), n = now();
    if (/deadline|\bdue\b/.test(t)) return openDeadline();
    if (/inbox|e-?mail|gmail/.test(t)) return showInbox();
    let m = t.match(/(?:late|behind)(?:\s+by)?\s+(\d+)|(\d+)\s*(?:min|minutes)?\s*(?:late|behind)/);
    if (m || /running late|i'?m late|behind schedule/.test(t)) return showProposal(E.proposeRunningLate(state, +(m && (m[1] || m[2])) || 15, n));
    if (/what'?s next|next up|what now/.test(t)) {
      const up = upcoming().slice(0, 3);
      return reply(up.length ? up.map((x, i) => `${i ? '' : '<b>Next:</b> '}${esc(x.title)} at ${clk(x.start)}${x.kind === 'event' ? ' (calendar)' : ''}`).join('<br>') : 'Nothing left today. Add a blob with “+ Blob”.');
    }
    if (/^add\b|new blob|schedule\b/.test(t)) { const title = text.replace(/^(add|schedule)\s+/i, '').replace(/\s+(at|tomorrow).*$/i, '').trim(); return openBlob(title, parseTime(text)); }
    const x = targetSession(ctxId, text);
    if (/done|finished|complete/.test(t) && x) return finishActive(x.id);
    if (/start|begin/.test(t) && x) return requestStart(x.id);
    if (/move|push|shift|reschedule|later|tomorrow|\bat\b|\d\s*(am|pm)/.test(t)) {
      if (!x) return reply('There are no flexible blobs to move. Calendar events stay where they are.');
      const at = parseTime(text);
      if (at) return showProposal(E.proposeMove(state, x.id, { start: at }, n));
      if (/tomorrow/.test(t)) return showProposal(E.proposeMove(state, x.id, 'tomorrow', n));
      if (/later|after/.test(t)) return showProposal(E.proposeMove(state, x.id, 'later', n));
      return showProposal(E.proposeMove(state, x.id, 'next', n));
    }
    reply('I can move a blob (“move the inbox sweep to 3pm”, “push this to tomorrow”), shift your day (“I\'m 20 min late”), add a blob or a deadline, or tell you what\'s next.');
  }
  $('#ask').addEventListener('submit', e => { e.preventDefault(); const v = $('#askInput').value.trim(); if (!v) return; $('#askInput').value = ''; handleAsk(v, null); });
  $$('#chips [data-ask]').forEach(b => b.onclick = () => handleAsk(b.dataset.ask, null));

  /* ---------- sample inbox (Gmail stand-in) ---------- */
  const SAMPLE_MAIL = [
    { from: 'Studio booking', subj: 'Confirm Thursday session' },
    { from: 'Label A&R', subj: 'Notes on the rough mix' },
    { from: 'Accountant', subj: 'Receipts for October' },
  ];
  function showInbox() {
    const p = E.proposeAdd(state, { id: uid('se'), title: 'Reply to 3 emails', cat: 'email', dur: 20, source: 'Suggested from sample inbox' }, now());
    p.summary = 'Add a 20-minute email blob?'; p.reason = `3 starred threads in your sample inbox. ${p.reason}`;
    showProposal(p);
    const list = document.createElement('ul'); list.className = 'mail';
    list.innerHTML = SAMPLE_MAIL.map(m => `<li><span class="who">${esc(m.from)}</span>${esc(m.subj)}</li>`).join('');
    card.querySelector('p').after(list);
    const note = document.createElement('p'); note.className = 'from'; note.textContent = 'Sample inbox. Gmail connects in a later phase, read-only, and Blob never sends or deletes mail.';
    list.after(note);
  }

  /* ---------- dialogs ---------- */
  const catOptions = sel => { sel.innerHTML = Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join(''); };
  catOptions($('#dlCat')); catOptions($('#bCat'));
  $$('dialog [data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
  const isoDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function openDeadline() {
    closeCard();
    $('#dlName').value = ''; let due = E.dayOf(now()); for (let k = 0; k < 4;) { due = E.addDays(due, 1); if (![0, 6].includes(new Date(due).getDay())) k++; }
    $('#dlDate').value = isoDay(due); $('#dlCat').value = 'project';
    $('#deadlineDlg').showModal(); $('#dlName').focus();
  }
  $('#deadlineForm').addEventListener('submit', e => {
    e.preventDefault();
    const [Y, Mo, D] = $('#dlDate').value.split('-').map(Number), [h, mi] = $('#dlTime').value.split(':').map(Number);
    const due = new Date(Y, Mo - 1, D, h, mi).getTime();
    $('#deadlineDlg').close();
    if (due <= now()) return reply('That due time has already passed. Pick a later one.');
    showProposal(E.proposeDeadline(state, { id: uid('dl'), title: $('#dlName').value.trim(), due, sessions: +$('#dlCount').value, sessionLen: +$('#dlLen').value, cat: $('#dlCat').value }, now()));
  });
  function openBlob(title = '', at = null) {
    closeCard();
    $('#bName').value = title; $('#bCat').value = 'project';
    $('#bWhen').value = at ? 'at' : 'next'; $('#bAtWrap').hidden = !at;
    if (at) { const d = new Date(at); $('#bAt').value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    $('#blobDlg').showModal(); $('#bName').focus();
  }
  $('#bWhen').onchange = () => { $('#bAtWrap').hidden = $('#bWhen').value !== 'at'; };
  $('#blobForm').addEventListener('submit', e => {
    e.preventDefault(); $('#blobDlg').close();
    const s = { id: uid('se'), title: $('#bName').value.trim(), cat: $('#bCat').value, dur: +$('#bLen').value, source: 'You added this' };
    if ($('#bWhen').value === 'at' && $('#bAt').value) { const [h, m] = $('#bAt').value.split(':').map(Number); s.start = E.dayOf(now()) + (h * 60 + m) * MIN; }
    showProposal(E.proposeAdd(state, s, now()));
  });
  $('#addDeadline').onclick = openDeadline;
  $('#addBlob').onclick = () => openBlob();

  /* ---------- settings ---------- */
  const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const toM = v => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  function fillSettings() {
    const p = state.prefs;
    $('#sStart').value = hm(p.dayStart); $('#sEnd').value = hm(p.dayEnd); $('#sLunch').value = hm(p.lunch.start); $('#sBuffer').value = String(p.buffer);
    $('#sReal').checked = clock.real; $('#pack').value = store.get('blob.pack', 'blob');
    $('#gId').value = conn.gId; $('#gSecret').value = conn.gSecret; $('#spId').value = conn.spId;
    refreshConnections();
  }
  $('#openSettings').onclick = () => { fillSettings(); $('#settingsDlg').showModal(); };
  const setPrefs = patch => { state = { ...state, prefs: { ...state.prefs, ...patch } }; save(); render(); };
  $('#sStart').onchange = e => setPrefs({ dayStart: toM(e.target.value) });
  $('#sEnd').onchange = e => setPrefs({ dayEnd: toM(e.target.value) });
  $('#sLunch').onchange = e => setPrefs({ lunch: { ...state.prefs.lunch, start: toM(e.target.value) } });
  $('#sBuffer').onchange = e => setPrefs({ buffer: +e.target.value });
  $('#sReal').onchange = e => { clock.real = e.target.checked; store.set('blob.realClock', clock.real); if (!clock.real) setNow(today9()); render(); };
  $('#sSpeed').onclick = e => { setSpeed(clock.speed === 1 ? 60 : 1); e.target.textContent = `Demo speed: ${clock.speed === 1 ? 'off' : '60×'}`; e.target.setAttribute('aria-pressed', String(clock.speed !== 1)); renderBrain(); syncDesktop(); };
  $('#pack').onchange = e => { store.set('blob.pack', e.target.value); sfx('start'); };
  $$('[data-snd]').forEach(b => b.onclick = () => sfx(b.dataset.snd));
  $('#resetSample').onclick = () => {
    if (!clock.real) setNow(today9());
    state = sampleState(now()); timer = null; saveTimer(); ui.missedAsked.clear(); save();
    $('#settingsDlg').close(); nodes.forEach(n => n.wrap.remove()); nodes.clear(); render(); jumpNow();
  };

  /* ---------- calendar import (.ics file or the secret iCal link) ---------- */
  function parseICS(text) {
    const out = [], from = E.dayOf(now()), to = E.addDays(from, VISIBLE_DAYS);
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    let ev = null;
    const parseDate = (prop, val) => {
      if (/VALUE=DATE(?!-)/.test(prop) || /^\d{8}$/.test(val)) return null;
      const m = val.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/); if (!m) return null;
      const [, Y, Mo, D, h, mi, s, z] = m;
      return z ? Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s) : new Date(+Y, +Mo - 1, +D, +h, +mi, +s).getTime();
    };
    for (const ln of lines) {
      if (ln === 'BEGIN:VEVENT') ev = {};
      else if (ln === 'END:VEVENT') { if (ev && ev.s && ev.e) out.push(ev); ev = null; }
      else if (ev) {
        const i = ln.indexOf(':'), prop = ln.slice(0, i), val = ln.slice(i + 1);
        if (prop.startsWith('DTSTART')) ev.s = parseDate(prop, val);
        else if (prop.startsWith('DTEND')) ev.e = parseDate(prop, val);
        else if (prop === 'SUMMARY') ev.title = val.replace(/\\,/g, ',').replace(/\\n/g, ' ');
        else if (prop === 'UID') ev.uid = val;
        else if (prop === 'STATUS' && val === 'CANCELLED') ev.cancel = true;
      }
    }
    return out.filter(e => !e.cancel && e.s >= from && e.s < to).map((e, i) => ({
      id: 'ics-' + (e.uid || i) + '-' + e.s, title: e.title || 'Event', start: e.s, dur: Math.max(5, Math.round((e.e - e.s) / MIN)), source: 'Your calendar',
      cat: /gym|workout|run\b|yoga|doctor|dentist|family|kids|personal/i.test(e.title || '') ? 'fitness' : /lunch|dinner|breakfast|coffee/i.test(e.title || '') ? 'meal' : 'meeting',
    }));
  }
  /* Calendar events are facts, so they go straight onto the string. Your flexible blobs that they now
     overlap get new-time suggestions you approve; nothing of yours moves silently. A real calendar
     replaces the sample one. */
  function syncEvents(list, source, label, { quiet = false } = {}) {
    list = list.map(e => ({ ...e, source }));
    const key = e => `${e.title}|${e.start}|${e.dur}`;
    const old = new Map(state.events.filter(e => e.source === source).map(e => [e.id, e]));
    const changed = list.filter(e => !old.has(e.id) || key(old.get(e.id)) !== key(e));
    const removed = [...old.keys()].filter(id => !list.some(e => e.id === id)).length;
    const changedIds = new Set(changed.map(e => e.id));
    let staged = { ...state, events: state.events.filter(e => e.source !== source && e.source !== 'Sample calendar').concat(list.filter(e => !changedIds.has(e.id))) };
    const moves = [];
    for (const ev of changed) { const p = E.proposeCalendarChange(staged, ev, now()); staged = E.apply(staged, p); moves.push(...p.changes.filter(c => c.op !== 'event')); }
    const hadSample = state.events.some(e => e.source === 'Sample calendar');
    state = { ...state, events: staged.events };
    if (hadSample) state.sample = state.sessions.some(x => /^Sample/.test(x.source || ''));
    save(); render();
    const what = `${label}: ${changed.length ? `${changed.length} new or changed` : 'no changes'}${removed ? `, ${removed} removed` : ''}`;
    $('#calMsg').textContent = `${what}. ${list.length} event${list.length === 1 ? '' : 's'} in the next ${VISIBLE_DAYS} days.`;
    const n = moves.filter(c => c.op === 'move' || c.op === 'unplace').length;
    if (n) {
      if ($('#settingsDlg').open) $('#settingsDlg').close();
      showProposal({ kind: 'calendar', summary: `${label} changed: move ${n} blob${n === 1 ? '' : 's'}?`, reason: `${what}. ${n === 1 ? 'One of your blobs overlaps' : 'Some of your blobs overlap'} the new times, so here are the next open slots. Calendar events stay where they are.`, changes: moves, conflicts: [] });
    } else if (!quiet) reply(`${esc(what)}. None of your blobs overlap, so nothing else changes.`);
  }
  /* ---------- calendars: any number of Google accounts and iCal links ---------- */
  const tauri = window.__TAURI__;
  const Links = window.BlobLinks;
  const conn = store.get('blob.conn', { gId: '', gSecret: '', spId: '' });
  conn.accounts = conn.accounts || [];   // [{key, email, cals: {calendarId: {name, color, on}}}]
  conn.links = conn.links || [];         // [{id, name, url, on}]
  const saveConn = () => store.set('blob.conn', conn);
  const legacyLink = store.get('blob.icsUrl', '');
  if (legacyLink && !conn.links.length) {
    conn.links.push({ id: 'l' + Date.now().toString(36), name: 'Calendar', url: legacyLink, on: true });
    store.set('blob.icsUrl', ''); saveConn();
    state = { ...state, events: state.events.filter(e => e.source !== 'Your calendar') };
  }
  const acctSource = a => `Google: ${a.key}`;
  const linkSource = l => `Link: ${l.id}`;
  const stamp = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  $('#icsFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; syncEvents(parseICS(await f.text()), `File: ${f.name}`, f.name); e.target.value = ''; };

  async function fetchLink(url) { return tauri?.core ? tauri.core.invoke('fetch_text', { url }) : (await fetch(url)).text(); }
  async function syncLink(l, quiet) {
    if (!l.on) return syncEvents([], linkSource(l), l.name, { quiet: true });
    const list = parseICS(await fetchLink(l.url)).map(e => ({ ...e, id: `${l.id}:${e.id}` }));
    syncEvents(list, linkSource(l), l.name, { quiet });
  }
  async function loadCalendars(a) {
    const cals = await Links.calendars(a.key), next = {};
    for (const c of cals) next[c.id] = { name: c.name, color: c.color, on: a.cals[c.id] ? a.cals[c.id].on : (c.selected || c.primary) };
    a.cals = next; a.email = (cals.find(c => c.primary) || {}).id || a.email; saveConn();
  }
  async function syncAccount(a, quiet) {
    const from = E.dayOf(Date.now()), to = E.addDays(from, VISIBLE_DAYS);
    const ids = Object.keys(a.cals).filter(id => a.cals[id].on);
    const seen = new Set();
    // The same meeting on two of your calendars should be one blob.
    const list = (ids.length ? await Links.calendarEvents(a.key, ids, from, to) : [])
      .filter(e => { const k = `${e.title}|${e.start}|${e.dur}`; if (seen.has(k)) return false; seen.add(k); return true; });
    syncEvents(list, acctSource(a), a.email || 'Google Calendar', { quiet });
  }
  let syncing = false;
  async function syncAll(quiet = true) {
    if (syncing) return; syncing = true;
    const errs = [];
    if (Links && Links.available) for (const a of conn.accounts) { try { await syncAccount(a, quiet); } catch (e) { errs.push(`${a.email || 'Google'}: ${String(e).slice(0, 100)}`); } }
    for (const l of conn.links) { try { await syncLink(l, quiet); } catch (e) { errs.push(`${l.name}: ${tauri ? "couldn't reach the link" : 'browsers block calendar links, so this works in the Mac app'}`); } }
    syncing = false;
    const msg = errs.length ? `Sync problems: ${errs.join('; ')}` : `Synced ${stamp()}`;
    $('#gMsg').textContent = conn.accounts.length ? msg : '';
    $('#calMsg').textContent = conn.links.length ? msg : '';
  }

  function renderCalendars() {
    $('#gAccounts').innerHTML = conn.accounts.map((a, i) => `<div class="acct" data-i="${i}">
      <div class="acct-head"><span class="acct-name">${esc(a.email || 'Google account')}</span><button class="ghost small" data-drop>Disconnect</button></div>
      <div class="cals">${Object.entries(a.cals).map(([id, c]) => `<label><input type="checkbox" data-cal="${esc(id)}" ${c.on ? 'checked' : ''}><i style="background:${esc(c.color)}"></i>${esc(c.name)}</label>`).join('') || '<small>Loading calendars…</small>'}</div></div>`).join('');
    $$('#gAccounts .acct').forEach(row => {
      const a = conn.accounts[+row.dataset.i];
      row.querySelector('[data-drop]').onclick = async () => {
        await Links.disconnect(a.key).catch(() => {});
        conn.accounts.splice(conn.accounts.indexOf(a), 1); saveConn();
        state = { ...state, events: state.events.filter(e => e.source !== acctSource(a)) }; save(); render(); renderCalendars();
      };
      row.querySelectorAll('[data-cal]').forEach(cb => cb.onchange = () => { a.cals[cb.dataset.cal].on = cb.checked; saveConn(); syncAccount(a, true).catch(e => { $('#gMsg').textContent = String(e).slice(0, 140); }); });
    });
    $('#icsLinks').innerHTML = conn.links.map((l, i) => `<div class="acct" data-i="${i}"><div class="acct-head">
      <label class="check" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-on ${l.on ? 'checked' : ''}>${esc(l.name)}</label>
      <small class="acct-name">${esc(l.url.replace(/^(https?|webcal):\/\//, '').slice(0, 60))}…</small><button class="ghost small" data-drop>Remove</button></div></div>`).join('');
    $$('#icsLinks .acct').forEach(row => {
      const l = conn.links[+row.dataset.i];
      row.querySelector('[data-on]').onchange = e => { l.on = e.target.checked; saveConn(); syncLink(l, true).catch(() => {}); };
      row.querySelector('[data-drop]').onclick = () => {
        conn.links.splice(conn.links.indexOf(l), 1); saveConn();
        state = { ...state, events: state.events.filter(e => e.source !== linkSource(l)) }; save(); render(); renderCalendars();
      };
    });
    $('#gConnect').textContent = conn.accounts.length ? 'Add another Google account' : 'Connect Google Calendar';
    $('#gSync').hidden = !conn.accounts.length;
  }
  $('#icsUrlGo').onclick = async () => {
    const url = $('#icsUrl').value.trim(); if (!url) return;
    const name = $('#icsName').value.trim() || `Calendar ${conn.links.length + 1}`;
    const l = { id: 'l' + Date.now().toString(36), name, url, on: true };
    $('#calMsg').textContent = 'Fetching your calendar…';
    try { await syncLink(l, false); }
    catch (err) { $('#calMsg').textContent = tauri ? "Couldn't reach that link. Check it's the iCal address." : 'Browsers block calendar links from other sites. This works in the Mac app; here, download the .ics and import it.'; return; }
    conn.links.push(l); saveConn(); $('#icsUrl').value = $('#icsName').value = ''; renderCalendars();
    $('#calMsg').textContent = `Added ${name}. Synced ${stamp()}.`;
  };

  /* ---------- music: the now-playing blob and "What plays when" (plan logic in engine/music.js) ---------- */
  const MP = window.BlobMusic, MUSIC = ['#6ef3ff', '#8b5cff'];
  const music = (() => {
    let plan = MP.migrate(store.get('blob.music', null));
    const savePlan = () => store.set('blob.music', plan);
    // np: what Spotify says is playing. ours: BLOB started the music that's on, so the timer may pause it.
    const st = { linked: false, np: null, problem: '', premium: true, ours: false, note: '', noteT: 0, lists: null, liked: null, pick: null, q: '', artists: [] };
    const npEl = $('#np'), face = $('#npFace');
    const jelly = new Jelly(npEl, { colors: MUSIC, glow: true, radius: 0.44, points: 56, wobble: 1.5, wide: true, waist: 0.2, lobe: 0.16 });
    let pollT = 0, searchT = 0;

    const say = (msg, ms = 6000) => { st.note = msg; clearTimeout(st.noteT); st.noteT = setTimeout(() => { st.note = ''; paint(); }, ms); paint(); };
    function failed(e) {
      const m = String((e && e.message) || e);
      if (/Premium/.test(m)) st.premium = false;
      else if (/Open Spotify/.test(m)) st.problem = 'nodev';
      else say(m.slice(0, 120));
      paint();
    }
    // The blob music is for now: the running timer's, else the next one you could start.
    const focusBlob = () => (timer && session(timer.id)) || upcoming().find(x => x.kind === 'session') || null;
    const allChoices = () => [...Object.values(plan.kinds), ...Object.values(plan.blobs)];
    const contextName = uri => { if (!uri) return ''; const c = allChoices().find(x => x.uri === uri) || (st.lists || []).find(x => x.uri === uri); return c ? c.name : uri.includes(':collection') ? 'Liked Songs' : uri.includes(':artist:') ? 'Artist' : uri.includes(':album:') ? 'Album' : 'Spotify'; };

    async function refresh() {
      if (!st.linked) return;
      try { st.np = await Links.nowPlaying(); if (st.np) st.problem = ''; }
      catch (e) { st.np = null; }
      paint();
    }
    function schedule() {
      clearInterval(pollT);
      if (st.linked) pollT = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    }
    const playback = () => st.np ? { playing: st.np.playing, contextUri: st.np.contextUri } : null;

    async function play(choice) {
      try {
        await Links.play(choice ? choice.uri : null);
        if (choice && plan.rules.shuffle) Links.shuffle(true);
        st.ours = true; st.problem = ''; st.premium = true;
        jelly.jiggle(1);
        setTimeout(refresh, 700);
      } catch (e) { failed(e); }
    }
    async function pause() { await Links.pause(); if (st.np) st.np.playing = false; paint(); setTimeout(refresh, 700); }

    /* Timer hooks */
    async function forBlob(blob) {
      if (!st.linked) return;
      await refresh();
      const d = MP.onStart(plan, blob, playback());
      if (d.do === 'play') play({ uri: d.uri, name: d.name });
      else if (d.do === 'pause') { pause(); st.ours = false; }
      else if (d.why === 'respect') say(`Kept your music. Tap ▾ to switch to ${d.name}.`);
      else if (d.why === 'already') st.ours = true;
    }
    function timerEvent(ev) {
      if (!st.linked) return;
      const a = MP.onTimer(plan, ev, st.ours);
      if (a === 'pause') pause();
      else if (a === 'resume') play(null);
    }

    /* Buttons on the blob */
    async function control(what) {
      if (what === 'toggle') {
        if (st.np && st.np.playing) { st.ours = false; return pause(); }
        if (st.np && st.np.title) return play(null);
        const c = MP.choiceFor(plan, focusBlob());
        return play(c.type === 'list' ? c : st.liked || (await likedSongs()));
      }
      try { await Links.control(what); st.premium = true; jelly.jiggle(1.2); setTimeout(refresh, 600); } catch (e) { failed(e); }
    }
    async function likedSongs() { if (!st.liked) st.liked = await Links.likedSongs().catch(() => null); return st.liked; }

    /* The now-playing blob */
    function paint() {
      const n = st.np, blob = focusBlob(), next = MP.choiceFor(plan, blob);
      const eq = on => `<span class="eq${on ? '' : ' stop'}" aria-hidden="true"><i></i><i></i><i></i></span>`;
      const planBtn = '<button class="round" data-np="plan" aria-label="What plays when" title="What plays when">♪</button>';
      const art = src => src ? `<img class="art" src="${esc(src)}" alt="">` : '<span class="art" aria-hidden="true"></span>';
      let html, cls = '';
      if (!Links || !Links.available) {
        cls = 'off'; html = `${art()}<div class="info"><span class="kick"><span>Music</span></span><span class="song">Spotify works in the Mac app</span><span class="who">Shows what's playing and follows your blobs</span></div><span></span>${planBtn}`;
      } else if (!st.linked) {
        cls = 'off'; html = `${art()}<div class="info"><span class="kick"><span>Spotify</span></span><span class="song">Not connected</span><span class="who">Music can follow your blobs</span></div><span></span><button class="act" data-np="connect">Connect</button>`;
      } else if (st.problem === 'nodev' && !(n && n.title)) {
        cls = 'warn'; html = `${art()}<div class="info"><span class="kick"><span>Spotify isn't open</span></span><span class="song">Open Spotify on this Mac</span><span class="who">Then BLOB can play your music</span></div><span></span><button class="act" data-np="retry">Try again</button>`;
      } else if (n && n.title) {
        if (!n.playing) cls = 'paused';
        const ctl = st.premium
          ? `<div class="ctl"><button data-np="prev" aria-label="Previous song">⏮</button><button class="big" data-np="toggle" aria-label="${n.playing ? 'Pause music' : 'Play music'}">${n.playing ? '❚❚' : '▶'}</button><button data-np="next" aria-label="Next song">⏭</button></div>`
          : '<span class="msg">Play and skip need Spotify Premium</span>';
        html = `${art(n.art)}<div class="info"><button class="kick" data-np="swap" title="Change the music">${eq(n.playing)}<span>${esc(st.note || contextName(n.contextUri))} ▾</span></button>
          <span class="song">${esc(n.title)}</span><span class="who">${esc(n.artist)}${n.duration ? ` · <span data-t></span> / ${mmss(n.duration / 1000)}` : ''}</span>
          <span class="bar"><i data-bar></i></span></div>${ctl}${planBtn}`;
      } else {
        const what = next.type === 'list' ? next.name : next.type === 'silent' ? 'Silence' : '';
        html = `${art()}<div class="info"><button class="kick" data-np="swap" title="Change the music">${eq(false)}<span>${esc(st.note || (blob ? catOf(blob.cat).label + ' music' : 'Music'))} ▾</span></button>
          <span class="song">${esc(what || 'Nothing playing')}</span><span class="who">${what === 'Silence' ? 'Nothing plays for this blob' : what ? 'Plays when you start' : 'Pick music under What plays when'}</span></div>
          <div class="ctl">${st.premium ? '<button class="big" data-np="toggle" aria-label="Play music">▶</button>' : ''}</div>${planBtn}`;
      }
      npEl.className = 'np' + (cls ? ' ' + cls : '') + (n && n.playing ? ' playing' : '');
      // Only rebuild when something changed, so a focused button keeps its focus.
      if (html !== lastHtml) { face.innerHTML = html; lastHtml = html; }
      clockTick();
    }
    let lastHtml = '';
    function clockTick() {
      const n = st.np; if (!n || !n.duration) return;
      const pos = Math.min(n.duration, n.progress + (n.playing ? Date.now() - n.at : 0));
      const t = face.querySelector('[data-t]'), bar = face.querySelector('[data-bar]');
      if (t) t.textContent = mmss(pos / 1000);
      if (bar) bar.style.width = (pos / n.duration * 100).toFixed(1) + '%';
    }
    npEl.addEventListener('click', e => {
      const b = e.target.closest('[data-np]'); if (!b) { jelly.jiggle(0.4); return; }
      const a = b.dataset.np;
      if (a === 'plan') return openPlan();
      if (a === 'swap') { const blob = focusBlob(); return openPlan(blob && plan.blobs[blob.id] ? 'blob' : blob ? blob.cat : null); }
      if (a === 'connect') { fillSettings(); $('#settingsDlg').showModal(); return; }
      if (a === 'retry') { st.problem = ''; const c = MP.choiceFor(plan, focusBlob()); return timer && timer.running && c.type === 'list' ? play(c) : refresh(); }
      control(a);
    });
    // Keep the song clock moving between checks.
    setInterval(() => { if (st.np && st.np.playing && !document.hidden) clockTick(); }, 1000);

    /* "What plays when" */
    async function loadLists() {
      if (st.lists || !st.linked) return;
      try { st.lists = await Links.playlists(); } catch (e) { st.lists = []; }
      likedSongs();
      // Settings from the first version only had playlist addresses: fill in their names.
      let fixed = false;
      for (const c of allChoices()) if (c.name === 'Your playlist') { const p = st.lists.find(x => x.uri === c.uri); if (p) { c.name = p.name; fixed = true; } }
      if (fixed) savePlan();
    }
    function openPlan(open = null) {
      st.pick = open; st.q = ''; st.artists = [];
      loadLists().then(() => { if (ui.card === 'music') renderPlan(); });
      renderPlan();
    }
    function renderPlan() {
      const blob = focusBlob();
      const dot = c => `<i class="dot" style="--a:${c.c[0]};--b:${c.c[1]}"></i>`;
      const row = (key, label, colors, choice, extra = '') => `<div class="mp-row${extra}"><span class="lab">${dot({ c: colors })}<span>${esc(label)}</span></span>
        <button class="pick" data-pick="${key}" aria-expanded="${st.pick === key}"><b>${esc(MP.label(choice))}</b><span>${st.pick === key ? '▲' : '▼'}</span></button>
        ${st.pick === key ? `<div class="mp-picker"><input id="mpQ" placeholder="Search your playlists, or type an artist for their radio" aria-label="Search playlists or artists" value="${esc(st.q)}"><div id="mpRes">${results()}</div></div>` : ''}</div>`;
      const sw = (k, txt, sub) => `<div class="mp-rule"><span>${txt}${sub ? `<small>${sub}</small>` : ''}</span><button class="sw" role="switch" aria-checked="${!!plan.rules[k]}" data-rule="${k}" aria-label="${esc(txt)}"></button></div>`;
      openCard(`<div class="mp"><div class="head"><div><span class="kicker"><i style="--a:${MUSIC[0]};--b:${MUSIC[1]}"></i>Music</span><h3>What plays when</h3></div>${xBtn}</div>
        ${st.linked ? '' : '<p class="meta">Connect Spotify in Settings to use these.</p>'}
        <h4>For each kind of blob</h4>
        <div class="mp-rows">${Object.entries(CATS).map(([k, c]) => row(k, c.label, c.c, plan.kinds[k] || MP.KEEP, blob && blob.cat === k ? ' cur' : '')).join('')}</div>
        ${blob ? `<h4>Just this blob</h4><div class="mp-rows">${row('blob', blob.title, catOf(blob.cat).c, plan.blobs[blob.id] || { type: 'same', name: '' }).replace('<b></b>', `<b>Same as ${esc(catOf(blob.cat).label)}</b>`)}</div>` : ''}
        <h4>Rules</h4>
        ${sw('start', 'Start music when I start a blob')}
        ${sw('pause', 'Pause music when I pause the timer', 'And play again when you resume')}
        <div class="mp-rule"><span>When time's up</span><span class="seg"><button data-up="pause" class="${plan.rules.timeUp === 'pause' ? 'on' : ''}">Pause music</button><button data-up="keep" class="${plan.rules.timeUp === 'keep' ? 'on' : ''}">Keep playing</button></span></div>
        ${sw('respect', "Don't take over music I put on myself", 'If something is already playing when a blob starts, BLOB leaves it')}
        ${sw('shuffle', 'Shuffle')}
        <p class="from">The timer only pauses music BLOB started. Artist radio plays the artist, then Spotify's Autoplay keeps going with similar songs.</p></div>`, 'music');
      card.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { st.pick = st.pick === b.dataset.pick ? null : b.dataset.pick; st.q = ''; st.artists = []; renderPlan(); const q = $('#mpQ'); if (q) q.focus(); });
      card.querySelectorAll('[data-rule]').forEach(b => b.onclick = () => { plan.rules[b.dataset.rule] = !plan.rules[b.dataset.rule]; savePlan(); b.setAttribute('aria-checked', plan.rules[b.dataset.rule]); });
      card.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { plan.rules.timeUp = b.dataset.up; savePlan(); renderPlan(); });
      const q = $('#mpQ');
      if (q) q.oninput = () => {
        st.q = q.value; paintResults();
        clearTimeout(searchT);
        if (st.q.trim().length >= 2 && st.linked) searchT = setTimeout(async () => { const asked = st.q; const found = await Links.searchArtists(asked.trim()).catch(() => []); if (asked === st.q) { st.artists = found; paintResults(); } }, 300);
        else st.artists = [];
      };
      bindResults();
    }
    function results() {
      const key = st.pick, blob = focusBlob();
      const cur = key === 'blob' ? (blob && plan.blobs[blob.id]) : plan.kinds[key];
      const q = st.q.trim().toLowerCase();
      const same = (a, b) => a && b && a.type === b.type && (a.type !== 'list' || a.uri === b.uri);
      const opt = (c, txt, img, special) => `<button class="mp-opt${special ? ' special' : ''}${same(cur, c) || (!cur && c.type === 'same') || (!cur && key !== 'blob' && c.type === 'keep') ? ' sel' : ''}" data-c="${esc(JSON.stringify(c))}">${img === undefined ? '' : img ? `<img src="${esc(img)}" alt="">` : '<i></i>'}<span>${esc(txt)}</span></button>`;
      const specials = [
        ...(key === 'blob' && blob ? [opt({ type: 'same' }, `Same as ${catOf(blob.cat).label}`, undefined, true)] : []),
        opt(MP.KEEP, "Keep what's playing", undefined, true), opt(MP.SILENT, 'Silence', undefined, true),
      ];
      const lists = [...(st.liked ? [st.liked] : []), ...(st.lists || [])].filter(p => !q || p.name.toLowerCase().includes(q));
      const radio = st.artists.map(a => opt(MP.artistChoice(a), `📻 ${a.name} radio`, a.art));
      return `<div class="mp-opts">${specials.join('')}</div>
        ${radio.length ? `<span class="sub">Artist radio</span><div class="mp-opts">${radio.join('')}</div>` : q.length >= 2 && st.linked ? '<span class="sub">Looking for artists…</span>' : ''}
        <span class="sub">${st.lists ? 'Your playlists' : st.linked ? 'Loading your playlists…' : ''}</span>
        <div class="mp-opts">${lists.map(p => opt({ type: 'list', uri: p.uri, name: p.name }, p.name, p.art || '')).join('') || (st.lists ? '<span class="sub">No playlists match.</span>' : '')}</div>`;
    }
    function paintResults() { const r = $('#mpRes'); if (r) { r.innerHTML = results(); bindResults(); } }
    function bindResults() {
      card.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
        const c = JSON.parse(b.dataset.c), blob = focusBlob();
        if (st.pick === 'blob') { if (c.type === 'same') delete plan.blobs[blob.id]; else plan.blobs[blob.id] = c; }
        else plan.kinds[st.pick] = c;
        savePlan();
        // Changing the music for the blob that's running switches it now.
        if (timer && timer.running && blob && timer.id === blob.id && (st.pick === 'blob' || st.pick === blob.cat)) {
          const now = MP.choiceFor(plan, blob);
          if (now.type === 'list') play(now); else if (now.type === 'silent' && st.np && st.np.playing) pause();
        }
        st.pick = null; renderPlan(); paint(); jelly.jiggle(0.8);
      });
    }

    function setLinked(v) {
      st.linked = v;
      if (!v) { st.np = null; st.lists = null; st.liked = null; }
      schedule(); refresh(); paint();
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    hooks.brain = paint;
    paint();
    return { forBlob, timerEvent, setLinked, openPlan, paint, el: npEl, get linked() { return st.linked; } };
  })();
  let calTimer = 0;
  async function refreshConnections(announce = false) {
    renderCalendars();
    if (!calTimer && conn.links.length) { calTimer = setInterval(() => syncAll(true), 5 * 60000); syncAll(true); }
    if (!Links || !Links.available) {
      $('#gBox').classList.add('off'); $('#spBox').classList.add('off');
      $('#gMsg').textContent = $('#spMsg').textContent = 'Works in the Mac app.';
      $('#gConnect').disabled = $('#spConnect').disabled = true;
      return;
    }
    // An account connected before multi-account support lives under the plain "google" key.
    if (!conn.accounts.some(a => a.key === 'google') && await Links.status('google')) {
      conn.accounts.unshift({ key: 'google', email: '', cals: {} }); saveConn();
      state = { ...state, events: state.events.filter(e => e.source !== 'Google Calendar') };
    }
    const sp = await Links.status('spotify');
    $('#spConnect').hidden = sp; $('#spDisconnect').hidden = !sp; $('#spMap').hidden = !sp;
    music.setLinked(sp);
    for (const a of conn.accounts) if (!Object.keys(a.cals).length) await loadCalendars(a).catch(() => {});
    renderCalendars();
    if (conn.accounts.length) {
      // Real clock once a real calendar is in.
      if (!clock.real) { clock.real = true; store.set('blob.realClock', true); }
      if (!calTimer) calTimer = setInterval(() => syncAll(true), 5 * 60000);
      syncAll(!announce);
    }
  }
  $('#spPlan').onclick = () => { $('#settingsDlg').close(); music.openPlan(); };
  $('#gId').oninput = e => { conn.gId = e.target.value.trim(); saveConn(); };
  $('#gSecret').oninput = e => { conn.gSecret = e.target.value.trim(); saveConn(); };
  $('#spId').oninput = e => { conn.spId = e.target.value.trim(); saveConn(); };
  $('#gConnect').onclick = async () => {
    $('#gMsg').textContent = 'Finish signing in in your browser…';
    const a = { key: 'google:' + Date.now().toString(36), email: '', cals: {} };
    try {
      await Links.connect(a.key, conn.gId, conn.gSecret);
      await loadCalendars(a);
      if (conn.accounts.some(o => o.email && o.email === a.email)) { await Links.disconnect(a.key); $('#gMsg').textContent = `${a.email} is already connected.`; return; }
      conn.accounts.push(a); saveConn();
      $('#gMsg').textContent = `Connected ${a.email}. Pick which calendars to show.`;
      await refreshConnections(true);
    } catch (e) { $('#gMsg').textContent = String(e).slice(0, 160); }
  };
  $('#gSync').onclick = () => syncAll(false);
  $('#spConnect').onclick = async () => {
    $('#spMsg').textContent = 'Finish signing in in your browser…';
    try { await Links.connect('spotify', conn.spId); $('#spMsg').textContent = 'Connected. Set what plays when from the ♪ on the music blob.'; await refreshConnections(); }
    catch (e) { $('#spMsg').textContent = String(e).slice(0, 160); }
  };
  $('#spDisconnect').onclick = async () => { await Links.disconnect('spotify'); $('#spMsg').textContent = 'Disconnected.'; refreshConnections(); };
  $('#clearSample').onclick = () => {
    const ids = new Set(state.sessions.filter(x => /^Sample/.test(x.source || '')).map(x => x.id));
    state = { ...state, sessions: state.sessions.filter(x => !ids.has(x.id)), deadlines: state.deadlines.filter(d => d.id !== 'dl-grant'), events: state.events.filter(e => e.source !== 'Sample calendar') };
    state.sample = false; if (timer && ids.has(timer.id)) { timer = null; saveTimer(); }
    save(); render();
  };
  refreshConnections();

  /* ---------- app updates: new builds from GitHub, installed in place (Mac app only) ---------- */
  const updates = (() => {
    let available = null;
    async function check(loud) {
      if (!tauri) { $('#verMsg').textContent = 'Updates work in the Mac app.'; return; }
      $('#verMsg').textContent = 'Checking…';
      try {
        const u = await tauri.core.invoke('check_update');
        available = u.version;
        $('#updateBtn').hidden = !available;
        if (available) $('#updateBtn').textContent = `Update to ${available}`;
        $('#verMsg').textContent = available ? `You have ${u.current}. Version ${available} is ready.` : `You have ${u.current}, the latest.`;
      } catch (e) { $('#verMsg').textContent = loud ? `Couldn't check for updates: ${String(e).slice(0, 120)}` : ''; }
    }
    async function install() {
      if (!available) return;
      $('#updateBtn').disabled = true; $('#updateBtn').textContent = 'Updating…';
      save(); saveTimer();
      try { await tauri.core.invoke('install_update'); }   // BLOB restarts when this succeeds
      catch (e) { $('#updateBtn').disabled = false; $('#updateBtn').textContent = `Update to ${available}`; reply(`The update didn't install: ${esc(String(e).slice(0, 160))}`); }
    }
    return { check, install };
  })();
  $('#checkUpdate').onclick = () => updates.check(true);
  $('#updateBtn').onclick = () => updates.install();
  if (tauri) { setTimeout(() => updates.check(false), 4000); setInterval(() => updates.check(false), 6 * 3600 * 1000); }

  /* ---------- demo scenarios ---------- */
  $$('#chips [data-demo]').forEach(b => b.onclick = () => {
    const n = now();
    if (b.dataset.demo === 'skip') { if (clock.real) return reply('Skipping ahead only works on the demo clock. Turn off “Use the real clock” in Settings.'); setNow(n + 60 * MIN); if (timer && timer.running) {} render(); tick(); return; }
    // A new meeting lands on top of your next flexible blob.
    const nx = upcoming().find(x => x.kind === 'session' && (!timer || x.id !== timer.id));
    const start = nx ? nx.start + 10 * MIN : Math.ceil((n + 60 * MIN) / (15 * MIN)) * 15 * MIN;
    const p = E.proposeCalendarChange(state, { id: uid('ev'), title: 'Vendor call (sample)', start, dur: 30, cat: 'meeting', source: 'Sample calendar' }, n);
    showProposal(p);
  });

  /* ---------- pan, zoom, jump to now ---------- */
  function scrollToX(x) { track.scrollTo({ left: Math.max(0, x), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
  function jumpNow() { const f = upcoming()[0]; const n = f && nodes.get(f.id); scrollToX(n ? n.tx - 90 * ui.zoom : 0); }
  $('#jumpNow').onclick = jumpNow;
  const zoomBy = d => { ui.zoom = Math.max(0.6, Math.min(1.5, +(ui.zoom + d).toFixed(2))); store.set('blob.zoom', ui.zoom); render(); };
  $('#zoomIn').onclick = () => zoomBy(0.15); $('#zoomOut').onclick = () => zoomBy(-0.15);
  track.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 0.1 : -0.1); return; }
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); track.scrollLeft += e.deltaY; }
  }, { passive: false });
  let pan = null;
  track.addEventListener('pointerdown', e => { if (e.target.closest('.blob') || e.button !== 0) return; pan = { x: e.clientX, left: track.scrollLeft }; track.classList.add('panning'); track.setPointerCapture(e.pointerId); });
  track.addEventListener('pointermove', e => { if (pan) track.scrollLeft = pan.left - (e.clientX - pan.x); });
  const endPan = () => { pan = null; track.classList.remove('panning'); };
  track.addEventListener('pointerup', endPan); track.addEventListener('pointercancel', endPan);
  track.addEventListener('keydown', e => { if (e.key === 'ArrowRight') track.scrollLeft += 120; if (e.key === 'ArrowLeft') track.scrollLeft -= 120; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.card && !document.querySelector('dialog[open]')) closeCard(); });
  new ResizeObserver(() => render()).observe(track);

  /* ---------- Brain controls ---------- */
  $('#go').onclick = () => {
    if (timer) return togglePause();
    const nx = upcoming().find(x => x.kind === 'session'); if (nx) requestStart(nx.id);
  };
  $('#finish').onclick = () => finishActive();
  $('#brain').addEventListener('click', () => { if (timer) select(timer.id); else { const nx = upcoming()[0]; if (nx) select(nx.id); } });

  /* ---------- sounds ---------- */
  let actx;
  function tone(f, t0, dur, type = 'sine', gain = .2, slideTo) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, actx.currentTime + t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, actx.currentTime + t0 + dur);
    g.gain.setValueAtTime(0.0001, actx.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(gain, actx.currentTime + t0 + .02);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t0 + dur);
    o.connect(g).connect(actx.destination); o.start(actx.currentTime + t0); o.stop(actx.currentTime + t0 + dur + .05);
  }
  function sfx(ev) {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { return; }
    const packs = {
      blob: { start: () => { tone(520, 0, .18, 'sine', .25, 180); tone(780, .14, .22, 'sine', .18, 300); }, warn: () => tone(660, 0, .25, 'sine', .2, 260),
              tick: () => tone(900, 0, .12, 'sine', .14, 400), end: () => { tone(300, 0, .3, 'sine', .3, 90); tone(620, .18, .25, 'sine', .16, 200); },
              done: () => [392, 523, 659, 784].forEach((f, i) => tone(f, i * .14, .3, 'sine', .2, f * .6)) },
      crisp: { start: () => { tone(2100, 0, .12, 'square', .08); tone(2100, .16, .35, 'square', .08, 1900); }, warn: () => tone(1800, 0, .15, 'square', .07), tick: () => tone(1500, 0, .08, 'square', .06), end: () => { tone(2200, 0, .5, 'square', .09, 2000); tone(2200, .55, .5, 'square', .09, 2000); }, done: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .12, .25, 'triangle', .15)) },
      soft: { start: () => { tone(659, 0, 1.2, 'sine', .18); tone(988, .15, 1.2, 'sine', .1); }, warn: () => tone(784, 0, 1, 'sine', .14), tick: () => tone(1175, 0, .4, 'sine', .08), end: () => [784, 659, 523].forEach((f, i) => tone(f, i * .25, 1.1, 'sine', .15)), done: () => [523, 659, 784, 988].forEach((f, i) => tone(f, i * .3, 1.4, 'sine', .12)) },
    };
    ((packs[store.get('blob.pack', 'blob')] || packs.blob)[ev] || (() => {}))();
  }
  async function cue(moment, synth) { const d = await (window.playBite ? playBite(moment).catch(() => 0) : 0); if (!d && synth) sfx(synth); }
  if (window.setupSounds) setupSounds((what, id) => { if (what === 'play') cue(id, { start: 'start', warn: 'warn', end: 'end', break: 'tick', update: 'tick', done: 'done' }[id]); });

  /* ---------- desktop bridge: menu-bar countdown + notification in the Mac app ---------- */
  function syncDesktop() {
    if (!tauri) return;
    const act = timer && session(timer.id), nx = upcoming().find(x => !act || x.id !== act.id);
    const line = (m, p) => (window.customLine && customLine(m, p)) || '';
    tauri.core.invoke('sync_timer', {
      running: !!(act && timer.running), remainingS: act ? Math.max(0, (timer.running ? timer.endsAt - now() : timer.left) / 1000) / clock.speed : 0,
      label: act ? act.title.slice(0, 18) : '',
      nextTitle: act ? `Time's up: ${act.title}` : 'BLOB',
      nextBody: line('end', act && act.title) || (nx ? `Next: ${nx.title} at ${clk(nx.start)}` : 'Nothing else on the string.'),
    }).catch(() => {});
  }

  /* ---------- go ---------- */
  render();
  requestAnimationFrame(frame);
  setTimeout(jumpNow, 400);
  setInterval(tick, 250);
  setInterval(() => { save(); render(); }, 30000);
  window.__blob = { get state() { return state; }, now, setNow, render, handleAsk }; // for tests and the console
})();
