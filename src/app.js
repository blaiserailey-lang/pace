const $ = s => document.querySelector(s);
/* Desktop bridge: tells the native side (menu-bar countdown + notifications) where the clock is.
   The native side keeps its own wall-clock deadline, so alerts fire even if this view is throttled. */
const tauri = window.__TAURI__;
function syncDesktop(){
  if (!tauri) return;
  const b = plan[idx], nx = plan[idx+1];
  const pers = $('#personality').value;
  tauri.core.invoke('sync_timer', {
    running: !!(running && b),
    remainingS: Math.max(0, remaining) / speed,
    label: b ? TYPE_LABEL[b.type] : '',
    nextTitle: nx ? (nx.type==='focus' ? `Focus: ${nx.name}` : TYPE_LABEL[nx.type]) : 'Day complete',
    nextBody: nx ? LINES[pers][nx.type](nx.name) : LINES[pers].done(),
  }).catch(()=>{});
}
const MODE_COLOR = {focus:'--work', snack:'--snack', meal:'--meal', chill:'--chill', hype:'--hype'};
const MUSIC = {focus:'Work mix', snack:'Chill mix', meal:'Chill mix', chill:'Chill mix', hype:'Hype mix'};
const TYPE_LABEL = {focus:'Focus', snack:'Snack break', meal:'Meal break', chill:'Chill break', hype:'Hype up'};
const today = new Date(); const iso = d => { const x = new Date(today); x.setDate(x.getDate()+d); return x.toISOString().slice(0,10); };

let projects = [
  {name:'Example: EP mix revisions', due: iso(4), hours: 10},
  {name:'Example: Artist apps pitch deck', due: iso(9), hours: 8},
  {name:'Example: Music video treatment', due: iso(14), hours: 6},
];
try { const s = JSON.parse(localStorage.getItem('pace.projects')); if (Array.isArray(s) && s.length) projects = s; } catch(e){}
const save = () => { try { localStorage.setItem('pace.projects', JSON.stringify(projects)); } catch(e){} };

const LINES = {
  coach:{focus:p=>`Locked in on ${p}. Phones down.`, snack:()=>'Grab a snack. Water too.', meal:()=>'Real food. Away from the desk.', chill:()=>'Stretch it out. Reset.', hype:()=>'Second half. Let\'s go!', warn:()=>'Five minutes. Land the plane.', done:()=>'Day done. Strong work.'},
  chill:{focus:p=>`Easy flow on ${p}.`, snack:()=>'Snack time, no rush.', meal:()=>'Go eat something good.', chill:()=>'Breathe. Look out a window.', hype:()=>'Little energy boost, then back in.', warn:()=>'Five more minutes, wrap it gently.', done:()=>'That\'s the day. Proud of you.'},
  hype:{focus:p=>`${p}. We cooking!`, snack:()=>'Fuel up, champ!', meal:()=>'Big meal energy!', chill:()=>'Cool down, we earned it.', hype:()=>'TURN IT UP. Next round!', warn:()=>'FIVE MINUTES! Finish strong!', done:()=>'W. Absolute W. See you tomorrow.'}
};
const MOUTH = {focus:'M50 79h20', snack:'M48 76q12 12 24 0', meal:'M48 76q12 12 24 0', chill:'M50 80q10 4 20 0', hype:'M46 74q14 18 28 0z'};

const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
const fmtClock = m => { let h = Math.floor(m/60), mm = String(m%60).padStart(2,'0'); const ap = h>=12?'p':'a'; h = ((h+11)%12)+1; return `${h}:${mm}${ap}`; };

const nowMin = () => { const d = new Date(); return d.getHours()*60 + d.getMinutes(); };
const ceil5 = m => Math.ceil(m/5)*5;
/* Start the day from now if we're already inside the working day */
function dayStartFromNow(){
  const s = toMin($('#dayStart').value||'10:00'), e = toMin($('#dayEnd').value||'18:00'), n = ceil5(nowMin());
  return (n > s && n < e - 15) ? n : s;
}
function buildPlan(startAt, prior=[]){
  const start = startAt ?? dayStartFromNow(), end = toMin($('#dayEnd').value||'18:00');
  const focus = Math.max(15, +$('#focus').value||50), snack = Math.max(5, +$('#snack').value||10), meal = toMin($('#meal').value||'13:00');
  const now = new Date(); now.setHours(0,0,0,0);
  const need = projects.filter(p=>p.name && p.hours>0).map(p=>{
    const days = Math.max(1, Math.ceil((new Date(p.due+'T23:59') - now)/864e5));
    const clean = p.name.replace(/^Example:\s*/,'');
    const got = prior.filter(b=>b.type==='focus' && b.name===clean).reduce((s,b)=>s+b.dur,0);
    return {name:p.name, target: p.hours*60/days, got, days};
  });
  const lastPrior = prior[prior.length-1];
  const blocks = []; let t = start, mealDone = prior.some(b=>b.type==='meal') || (!prior.length && start > meal + 30), focusN = prior.filter(b=>b.type==='focus').length, afterMeal = false;
  let last = lastPrior && lastPrior.type==='focus' ? need.find(n=>n.name.replace(/^Example:\s*/,'')===lastPrior.name) || null : null;
  const needBreak = lastPrior && lastPrior.type==='focus';
  if (needBreak && t + 15 <= end){ if (focusN % 3 === 0) blocks.push({type:'chill', start:t, dur:15, name:'Chill break', sub:'Stretch, walk, reset'}), t+=15; else { const sn=Math.max(5, +$('#snack').value||10); blocks.push({type:'snack', start:t, dur:sn, name:'Snack break', sub:'Snack + water'}); t+=sn; } }
  const push = (type, dur, name, sub='') => { blocks.push({type, start:t, dur, name, sub}); t += dur; };
  while (t + 15 <= end && need.length){
    if (!mealDone && t >= meal - 20){ push('meal', 60, 'Meal break', 'Step away from the desk'); mealDone = true; afterMeal = true; continue; }
    if (afterMeal){ push('hype', 5, 'Hype up', 'One loud song, then back in'); afterMeal = false; }
    let pool = need.length > 1 ? need.filter(n=>n!==last) : need;
    pool.sort((a,b)=> (b.target-b.got) - (a.target-a.got) || a.days-b.days);
    const p = pool[0]; const dur = Math.min(focus, end - t);
    if (dur < 15) break;
    const behind = p.target - p.got;
    push('focus', dur, p.name.replace(/^Example:\s*/,''), p.days <= 3 ? `Due in ${p.days} day${p.days>1?'s':''} · priority` : (behind>0?`${Math.round(p.target)} min/day to stay on track`:'Getting ahead'));
    p.got += dur; last = p; focusN++;
    if (t + 15 > end) break;
    if (focusN % 3 === 0) push('chill', 15, 'Chill break', 'Stretch, walk, reset');
    else push('snack', snack, 'Snack break', 'Snack + water');
  }
  return blocks;
}

let plan = [], idx = 0, remaining = 0, running = false, started = false, speed = 1, lastTick = 0, warned = {};
function rebuild(keep){
  if (keep && started && plan[idx]){
    const head = plan.slice(0, idx+1), cur = plan[idx];
    plan = head.concat(buildPlan(cur.start + cur.dur, head));
  } else {
    plan = buildPlan(); idx = 0; remaining = plan.length ? plan[0].dur*60 : 0;
  }
  renderSheet(); renderClock();
}
/* Recompute start times after a block changes length */
function reflow(){ for (let i=1;i<plan.length;i++) plan[i].start = plan[i-1].start + plan[i-1].dur; }

function renderSheet(){
  const sheet = $('#sheet'); sheet.innerHTML = '';
  let focusMin = 0;
  plan.forEach((b,i)=>{
    if (b.type==='focus') focusMin += b.dur;
    const el = document.createElement('div');
    el.className = 'blk' + (i===idx && started ? ' now' : '') + (i<idx ? ' done':'');
    el.style.setProperty('--c', `var(${MODE_COLOR[b.type]})`);
    el.innerHTML = `<span class="t">${fmtClock(b.start)}</span><span class="bar"></span><span class="n"></span><span class="d">${b.dur}m</span>`;
    const n = el.querySelector('.n'); n.textContent = b.name; const s = document.createElement('small'); s.textContent = (b.type==='focus'?'Focus · ':'') + b.sub; n.appendChild(s);
    sheet.appendChild(el);
  });
  $('#summary').textContent = `${(focusMin/60).toFixed(1)} h focus · ${plan.filter(b=>b.type!=='focus').length} breaks`;
  const cur = sheet.querySelector('.now'); if (cur) cur.scrollIntoView({block:'nearest'});
}

function setMode(type){
  document.documentElement.style.setProperty('--mode', `var(${MODE_COLOR[type]})`);
  curMood = type; const m = $('#mouth'); if (m) m.setAttribute('d', MOUTH[type]);
  if (char3d) char3d.setMode(type);
  $('#musicMode').textContent = 'Spotify: ' + MUSIC[type];
}
function say(key, p){ const pers = $('#personality').value; $('#say').textContent = LINES[pers][key](p); }

function renderClock(){
  const b = plan[idx];
  if (!b){ $('#time').textContent = '00:00'; $('#blockName').textContent = 'Add a project'; $('#blockType').textContent = ''; $('#next').textContent=''; return; }
  setMode(b.type);
  const r = Math.max(0, Math.ceil(remaining));
  $('#time').textContent = `${String(Math.floor(r/60)).padStart(2,'0')}:${String(r%60).padStart(2,'0')}`;
  $('#blockType').textContent = TYPE_LABEL[b.type];
  $('#blockName').textContent = b.type==='focus' ? b.name : b.sub;
  $('#arc').setAttribute('stroke-dashoffset', String(1000 - 1000 * (remaining / (b.dur*60))));
  const nx = plan[idx+1];
  $('#next').textContent = nx ? `Up next at ${fmtClock(b.start + b.dur)}: ${nx.type==='focus' ? nx.name : TYPE_LABEL[nx.type]}` : 'Last block of the day';
}

function enter(i){
  idx = i; warned = {};
  if (idx >= plan.length){ running = false; started = false; sfx('done'); say('done'); $('#go').textContent='Start day'; idx = plan.length-1; remaining = 0; renderSheet(); renderClock(); syncDesktop(); return; }
  const b = plan[idx]; remaining = b.dur*60;
  say(b.type, b.name); renderSheet(); renderClock(); syncDesktop();
  if (char3d) char3d.hop();
}

/* Driven by the wall clock (Date.now), not animation frames, so the day keeps
   running when the tab is in the background or the laptop sleeps. */
function tick(){
  const ts = Date.now();
  if (running){
    remaining -= (ts - lastTick)/1000 * speed;
    let guard = 0;
    while (running && remaining <= 0 && guard++ < 50){
      const over = -remaining;
      sfx('end'); setTimeout(()=>sfx('start'), 700); enter(idx+1);
      if (running) remaining -= over;   // carry time that passed while hidden
    }
    const b = plan[idx];
    if (running && b && b.dur > 6){
      if (remaining <= 300 && !warned.five){ warned.five = true; sfx('warn'); say('warn'); }
      if (remaining <= 60 && !warned.one){ warned.one = true; sfx('tick'); }
    }
    renderClock();
  }
  lastTick = ts;
}

/* Sound packs: synthesized per personality so the prototype needs no audio files */
let ctx;
function tone(freq, t0, dur, type='sine', gain=.2, glide){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime + t0);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, ctx.currentTime + t0 + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + t0 + .02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
  o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + dur + .05);
}
function sfx(ev){
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state==='suspended') ctx.resume(); } catch(e){ return; }
  const p = $('#personality').value;
  const packs = {
    coach:{ start:()=>{tone(2100,0,.12,'square',.08);tone(2100,.16,.35,'square',.08,1900)}, warn:()=>{tone(1800,0,.15,'square',.07)}, tick:()=>tone(1500,0,.08,'square',.06), end:()=>{tone(2200,0,.5,'square',.09,2000);tone(2200,.55,.5,'square',.09,2000)}, done:()=>[523,659,784,1047].forEach((f,i)=>tone(f,i*.12,.25,'triangle',.15)) },
    chill:{ start:()=>{tone(659,0,1.2,'sine',.18);tone(988,.15,1.2,'sine',.1)}, warn:()=>tone(784,0,1,'sine',.14), tick:()=>tone(1175,0,.4,'sine',.08), end:()=>[784,659,523].forEach((f,i)=>tone(f,i*.25,1.1,'sine',.15)), done:()=>[523,659,784,988].forEach((f,i)=>tone(f,i*.3,1.4,'sine',.12)) },
    hype:{ start:()=>{tone(110,0,.25,'sawtooth',.2,55);tone(880,.05,.3,'sawtooth',.07,1760)}, warn:()=>{[0,.18,.36].forEach(t=>tone(440,t,.12,'sawtooth',.1))}, tick:()=>tone(660,0,.1,'sawtooth',.08), end:()=>{[0,.02,.04].forEach((d,i)=>tone([233,277,349][i],d,.9,'sawtooth',.1))}, done:()=>{[0,.02,.04].forEach((d,i)=>tone([262,330,392][i],d,1.4,'sawtooth',.1));tone(110,0,.4,'sawtooth',.2,40)} }
  };
  (packs[p][ev]||(()=>{}))();
}

/* Projects table */
function renderProjects(){
  const tb = $('#projects'); tb.innerHTML = '';
  projects.forEach((p,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input id="pn${i}" aria-label="Project name"></td><td><input id="pd${i}" type="date" aria-label="Due date"></td><td><input id="ph${i}" type="number" min="0" step="0.5" aria-label="Hours left"></td><td><button class="x" aria-label="Remove project">✕</button></td>`;
    const [n,d,h] = tr.querySelectorAll('input'); n.value = p.name; d.value = p.due; h.value = p.hours;
    n.oninput = e=>{p.name=e.target.value; changed();}; d.onchange = e=>{p.due=e.target.value; changed();}; h.oninput = e=>{p.hours=+e.target.value; changed();};
    tr.querySelector('button').onclick = ()=>{ projects.splice(i,1); renderProjects(); changed(); };
    tb.appendChild(tr);
  });
}
function changed(){ save(); rebuild(true); }

$('#add').onclick = ()=>{ projects.push({name:'New project', due: iso(7), hours: 5}); renderProjects(); changed(); };
const SETTINGS = ['dayStart','dayEnd','focus','snack','meal','personality'];
try { const st = JSON.parse(localStorage.getItem('pace.settings')) || {}; SETTINGS.forEach(k=>{ if (st[k] != null) $('#'+k).value = st[k]; }); } catch(e){}
const saveSettings = () => { try { localStorage.setItem('pace.settings', JSON.stringify(Object.fromEntries(SETTINGS.map(k=>[k, $('#'+k).value])))); } catch(e){} };
['#dayStart','#dayEnd','#focus','#snack','#meal'].forEach(s=>$(s).addEventListener('change', ()=>{ saveSettings(); rebuild(true); }));
$('#personality').onchange = ()=>{ saveSettings(); const b = plan[idx]; if (b) say(b.type, b.name); sfx('start'); };
$('#go').onclick = ()=>{
  if (!plan.length) return;
  if (!started){ plan = buildPlan(); if (!plan.length) return; started = true; running = true; lastTick = Date.now(); sfx('start'); enter(0); $('#go').textContent='Pause'; return; }
  running = !running; lastTick = Date.now(); $('#go').textContent = running ? 'Pause' : 'Resume'; syncDesktop();
};
$('#skip').onclick = ()=>{ if (!started) return; sfx('end'); enter(idx+1); };
$('#plus').onclick = ()=>{ if (!plan[idx]) return; remaining += 300; plan[idx].dur += 5; reflow(); renderSheet(); renderClock(); syncDesktop(); };
$('#speed').onclick = e=>{ speed = speed===1 ? 60 : 1; e.target.textContent = `Demo speed: ${speed===1?'off':'60×'}`; e.target.setAttribute('aria-pressed', speed!==1); syncDesktop(); };
document.querySelectorAll('[data-snd]').forEach(b=>b.onclick=()=>sfx(b.dataset.snd));

/* Eyes follow the pointer a little */
document.addEventListener('pointermove', e=>{
  const r = $('#char').getBoundingClientRect(); const dx = Math.max(-2, Math.min(2,(e.clientX-(r.left+r.width/2))/80)), dy = Math.max(-2, Math.min(2,(e.clientY-(r.top+r.height/2))/80));
  if (char3d) char3d.lookAt((e.clientX-(r.left+r.width/2))/300, (e.clientY-(r.top+r.height/2))/300);
  if (!$('#pl')) return;
  $('#pl').setAttribute('cx', 46+dx); $('#pr').setAttribute('cx', 74+dx); $('#pl').setAttribute('cy', 57+dy); $('#pr').setAttribute('cy', 57+dy);
});

/* ---------- Character editor ---------- */
let charCfg = loadChar(), curMood = 'focus', char3d = null;
let charImage = null; try { charImage = localStorage.getItem('pace.charImage'); } catch(e){}

function renderChar(){
  const photo = charCfg.kind === 'photo' && charImage;
  $('#charName').textContent = charCfg.name || 'Pip';
  $('#char').hidden = !!photo; $('#char3d').hidden = !photo;
  $('.editor').classList.toggle('photo', !!photo);
  $('#cDrawn').hidden = !photo;
  if (!photo) {
    $('#char').innerHTML = charSVG(charCfg, MOUTH[curMood] || MOUTH.focus, true);
    $('#charPreview').outerHTML = `<svg id="charPreview" viewBox="0 0 120 120" role="img" aria-label="Character preview">${charSVG(charCfg, MOUTH[curMood] || MOUTH.focus)}</svg>`;
  } else {
    $('#charPreview').outerHTML = `<img id="charPreview" alt="Your character's cutout" src="${charImage}">`;
    if (last3DImage !== charImage) {
      last3DImage = charImage;
      ensure3D().then(c => { if (c) c.setImage(charImage); else { $('#char3d').hidden = true; $('#char').hidden = false; $('#char').innerHTML = charSVG(charCfg, MOUTH[curMood] || MOUTH.focus, true); } });
    }
  }
  $('#cName').value = charCfg.name;
  $('#cShape').value = charCfg.shape; $('#cEyes').value = charCfg.eyes; $('#cAddon').value = charCfg.addon;
  document.querySelectorAll('#cColors .swatch').forEach(b => b.setAttribute('aria-checked', String(b.dataset.c === charCfg.color)));
  const custom = $('#cCustom'); if (charCfg.color !== 'mode' && !CHAR_SWATCHES.includes(charCfg.color)) custom.value = charCfg.color;
}
function updateChar(patch){ charCfg = {...charCfg, ...patch}; saveChar(charCfg); renderChar(); }

let loading3D = null, last3DImage = null;
function ensure3D(){
  if (char3d) return Promise.resolve(char3d);
  if (!loading3D) loading3D = new Promise(res => {
    const go = () => { try { char3d = new window.PaceChar3D.Char3D($('#char3d')); char3d.setMode(curMood); } catch(e) { char3d = null; } res(char3d); };
    if (window.PaceChar3D) go(); else {
      window.addEventListener('pace3d-ready', go, {once:true});
      setTimeout(() => { if (!window.PaceChar3D) res(null); }, 8000);   // 3D couldn't load: keep the drawn character
    }
  });
  return loading3D;
}

function setupEditor(){
  const fill = (sel, opts) => { $(sel).innerHTML = Object.entries(opts).map(([v,l]) => `<option value="${v}">${l}</option>`).join(''); };
  fill('#cShape', CHAR_OPTIONS.shape); fill('#cEyes', CHAR_OPTIONS.eyes); fill('#cAddon', CHAR_OPTIONS.addon);
  $('#cColors').innerHTML = `<button type="button" class="swatch mode" role="radio" data-c="mode">Match the block</button>` +
    CHAR_SWATCHES.map(c => `<button type="button" class="swatch" role="radio" data-c="${c}" style="--sw:${c}" aria-label="Color ${c}"></button>`).join('') +
    `<input type="color" id="cCustom" class="swatch-custom" value="#ff7a59" aria-label="Pick any color">`;
  $('#cColors').addEventListener('click', e => { const b = e.target.closest('.swatch'); if (b) updateChar({color: b.dataset.c}); });
  $('#cCustom').addEventListener('input', e => updateChar({color: e.target.value}));
  $('#cName').addEventListener('input', e => updateChar({name: e.target.value.slice(0,20)}));
  $('#cShape').onchange = e => updateChar({shape: e.target.value});
  $('#cEyes').onchange = e => updateChar({eyes: e.target.value});
  $('#cAddon').onchange = e => updateChar({addon: e.target.value});
  $('#charRandom').onclick = () => {
    const pick = o => { const k = Object.keys(o); return k[Math.floor(Math.random()*k.length)]; };
    updateChar({kind:'drawn', shape: pick(CHAR_OPTIONS.shape), eyes: pick(CHAR_OPTIONS.eyes), addon: pick(CHAR_OPTIONS.addon),
      color: Math.random() < .3 ? 'mode' : CHAR_SWATCHES[Math.floor(Math.random()*CHAR_SWATCHES.length)]});
  };
  $('#charReset').onclick = () => { charCfg = {...CHAR_DEFAULT}; saveChar(charCfg); renderChar(); };
  $('#cDrawn').onclick = () => updateChar({kind:'drawn'});
  $('#cPhoto').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const status = $('#cPhotoStatus'); status.textContent = 'Puffing it up…';
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const c = await ensure3D();
    if (!c) { status.textContent = "This device can't show 3D, so the drawn character stays."; return; }
    try {
      const cut = await c.setImage(url);
      charImage = cut; last3DImage = cut; try { localStorage.setItem('pace.charImage', cut); } catch(err){}
      charCfg = {...charCfg, kind:'photo'}; saveChar(charCfg);
      status.textContent = 'Done. Click your character to make it hop.';
      renderChar();
    } catch(err) { status.textContent = "Couldn't read that picture. Try a PNG or JPG."; }
    e.target.value = '';
  };
}
setupEditor(); renderChar();

renderProjects(); rebuild(false); lastTick = Date.now(); setInterval(tick, 250);
document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) tick(); });
/* Before the day starts, keep the preview anchored to the current time */
setInterval(()=>{ if (!started) rebuild(false); }, 60000);
