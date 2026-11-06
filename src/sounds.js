/* Sound bites + catchphrases: your own clips and lines for each moment of the day.
   Clips are trimmed in the browser, stored as short WAVs in IndexedDB, and played instead of
   the built-in synth sounds. Catchphrases replace the personality's lines in the speech bubble. */

const MOMENTS = [
  { id: 'start',  label: 'Focus starts',     hint: 'Use {project} for the project name' },
  { id: 'warn',   label: '5-minute warning', hint: '' },
  { id: 'end',    label: "Time's up",        hint: '' },
  { id: 'break',  label: 'Break starts',     hint: 'Snack, chill and meal breaks' },
  { id: 'hype',   label: 'Hype up',          hint: 'After lunch' },
  { id: 'update', label: 'Check-in update',  hint: 'Halfway through focus, or when you press Check in' },
  { id: 'done',   label: 'Day complete',     hint: '' },
];
const MAX_BITE = 8; // seconds

/* ---------- storage ---------- */
const soundDB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('pace-sounds', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => {
    const t = db.transaction('clips', mode), s = t.objectStore('clips'), out = fn(s);
    t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
  }); };
  return {
    get: id => tx('readonly', s => s.get(id)),
    put: (id, v) => tx('readwrite', s => s.put(v, id)),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

let catchphrases = {};
try { catchphrases = JSON.parse(localStorage.getItem('pace.catchphrases')) || {}; } catch (e) {}
const saveCatchphrases = () => { try { localStorage.setItem('pace.catchphrases', JSON.stringify(catchphrases)); } catch (e) {} };

/* A random custom line for a moment, or null to fall back to the personality. */
function customLine(moment, project) {
  const lines = (catchphrases[moment] || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  return lines[Math.floor(Math.random() * lines.length)].replace(/\{project\}/gi, project || 'this');
}

/* ---------- playback ---------- */
const clipCache = {};   // moment -> AudioBuffer | null
const clipLens = {};    // moment -> seconds (0 when using the built-in sound)
let biteCtx;
const audioCtx = () => { biteCtx = biteCtx || new (window.AudioContext || window.webkitAudioContext)(); if (biteCtx.state === 'suspended') biteCtx.resume(); return biteCtx; };

async function loadClip(moment) {
  if (moment in clipCache) return clipCache[moment];
  try {
    const rec = await soundDB.get(moment);
    clipCache[moment] = rec ? await audioCtx().decodeAudioData(await rec.wav.arrayBuffer()) : null;
  } catch (e) { clipCache[moment] = null; }
  return clipCache[moment];
}
let currentBite = null;
/* Plays the custom clip for a moment. Resolves to its length in seconds, or 0 if there is none. */
async function playBite(moment) {
  const buf = await loadClip(moment);
  if (!buf) return 0;
  try {
    if (currentBite) try { currentBite.stop(); } catch (e) {}
    const ctx = audioCtx(), src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    currentBite = src; return buf.duration;
  } catch (e) { return 0; }
}

/* ---------- WAV encoding ---------- */
function encodeWav(buf, start, end) {
  const rate = Math.min(buf.sampleRate, 44100), ch = 1;
  const s0 = Math.floor(start * buf.sampleRate), s1 = Math.floor(end * buf.sampleRate);
  const step = buf.sampleRate / rate, n = Math.floor((s1 - s0) / step);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, str) => { for (let i = 0; i < str.length; i++) out.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, n * 2, true);
  const fade = Math.min(n / 4, rate * 0.01);   // 10 ms fades so bites don't click
  for (let i = 0; i < n; i++) {
    const k = s0 + Math.floor(i * step);
    let v = 0; for (const c of chans) v += c[k] || 0; v /= chans.length;
    if (i < fade) v *= i / fade; if (n - i < fade) v *= (n - i) / fade;
    out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}

/* ---------- trimmer dialog ---------- */
const trim = { buf: null, start: 0, end: 0, moment: null, name: '' };

function drawWave() {
  const cv = document.getElementById('trimWave'), g = cv.getContext('2d');
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr; g.scale(dpr, dpr);
  const W = r.width, H = r.height, css = getComputedStyle(document.documentElement);
  g.clearRect(0, 0, W, H);
  if (!trim.buf) return;
  const data = trim.buf.getChannelData(0), per = Math.max(1, Math.floor(data.length / W)), dur = trim.buf.duration;
  const x0 = trim.start / dur * W, x1 = trim.end / dur * W;
  g.fillStyle = css.getPropertyValue('--chip'); g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.18; g.fillStyle = css.getPropertyValue('--work'); g.fillRect(x0, 0, x1 - x0, H); g.globalAlpha = 1;
  for (let x = 0; x < W; x++) {
    let mx = 0; for (let i = x * per; i < (x + 1) * per && i < data.length; i += 4) mx = Math.max(mx, Math.abs(data[i]));
    g.fillStyle = x >= x0 && x <= x1 ? css.getPropertyValue('--work') : css.getPropertyValue('--muted');
    const h = Math.max(1, mx * H * 0.9); g.fillRect(x, (H - h) / 2, 1, h);
  }
  g.fillStyle = css.getPropertyValue('--ink'); g.fillRect(x0 - 1, 0, 3, H); g.fillRect(x1 - 1, 0, 3, H);
}

function syncTrimInputs() {
  const s = document.getElementById('trimStart'), e = document.getElementById('trimEnd'), d = trim.buf ? trim.buf.duration : 0;
  for (const el of [s, e]) { el.max = d.toFixed(2); }
  s.value = trim.start.toFixed(2); e.value = trim.end.toFixed(2);
  document.getElementById('trimLen').textContent = `${(trim.end - trim.start).toFixed(1)}s selected · max ${MAX_BITE}s`;
  document.getElementById('trimSave').disabled = !trim.buf || trim.end - trim.start < 0.15;
  drawWave();
}
function setRange(start, end) {
  const d = trim.buf.duration;
  start = Math.max(0, Math.min(start, d - 0.1)); end = Math.max(start + 0.1, Math.min(end, d, start + MAX_BITE));
  trim.start = start; trim.end = end; syncTrimInputs();
}

async function openTrimmer(moment) {
  trim.moment = moment; trim.buf = null;
  const m = MOMENTS.find(x => x.id === moment);
  document.getElementById('trimTitle').textContent = `Sound bite: ${m.label}`;
  document.getElementById('trimMsg').textContent = 'Pick an audio or video clip. You can trim it after.';
  document.getElementById('trimBody').hidden = true;
  syncTrimInputs();
  document.getElementById('trimDlg').showModal();
}

let previewSrc = null;
function previewTrim() {
  if (!trim.buf) return;
  const ctx = audioCtx(); if (previewSrc) try { previewSrc.stop(); } catch (e) {}
  previewSrc = ctx.createBufferSource(); previewSrc.buffer = trim.buf; previewSrc.connect(ctx.destination);
  previewSrc.start(0, trim.start, trim.end - trim.start);
}

function setupSounds(onChange) {
  const host = document.getElementById('moments');
  host.innerHTML = MOMENTS.map(m => `
    <div class="moment" data-m="${m.id}">
      <div class="moment-head"><strong>${m.label}</strong>${m.hint ? `<small>${m.hint}</small>` : ''}</div>
      <textarea rows="2" aria-label="${m.label} catchphrases, one per line" placeholder="Your catchphrases, one per line (leave empty for the personality's)"></textarea>
      <div class="moment-clip">
        <span class="clip-state">Built-in sound</span>
        <button type="button" class="small play">Play</button>
        <button type="button" class="small add">Add clip</button>
        <button type="button" class="small rm" hidden aria-label="Remove ${m.label} clip">Remove</button>
      </div>
    </div>`).join('');

  const refresh = async id => {
    const row = host.querySelector(`[data-m="${id}"]`), rec = await soundDB.get(id).catch(() => null);
    clipLens[id] = rec ? rec.len : 0;
    row.querySelector('.clip-state').textContent = rec ? `Clip · ${rec.name} · ${rec.len.toFixed(1)}s` : 'Built-in sound';
    row.querySelector('.add').textContent = rec ? 'Replace clip' : 'Add clip';
    row.querySelector('.rm').hidden = !rec;
  };
  MOMENTS.forEach(m => {
    const row = host.querySelector(`[data-m="${m.id}"]`), ta = row.querySelector('textarea');
    ta.value = catchphrases[m.id] || '';
    ta.addEventListener('input', () => { catchphrases[m.id] = ta.value; saveCatchphrases(); });
    row.querySelector('.play').onclick = () => onChange('play', m.id);
    row.querySelector('.add').onclick = () => openTrimmer(m.id);
    row.querySelector('.rm').onclick = async () => { await soundDB.del(m.id); delete clipCache[m.id]; refresh(m.id); };
    refresh(m.id);
  });

  const file = document.getElementById('trimFile');
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    const msg = document.getElementById('trimMsg'); msg.textContent = 'Reading the clip…';
    try {
      trim.buf = await audioCtx().decodeAudioData(await f.arrayBuffer());
      trim.name = f.name.replace(/\.[^.]+$/, '').slice(0, 24);
      document.getElementById('trimBody').hidden = false;
      msg.textContent = 'Drag on the waveform to pick the bite, then press Play to check it.';
      setRange(0, Math.min(trim.buf.duration, 3));
    } catch (e) { msg.textContent = "Couldn't read audio from that file. Try an MP3, M4A, WAV or MP4."; }
    file.value = '';
  };
  const wave = document.getElementById('trimWave');
  let dragFrom = null;
  const tAt = e => { const r = wave.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * trim.buf.duration; };
  wave.addEventListener('pointerdown', e => { if (!trim.buf) return; wave.setPointerCapture(e.pointerId); dragFrom = tAt(e); setRange(dragFrom, dragFrom + 0.1); });
  wave.addEventListener('pointermove', e => { if (dragFrom == null) return; const t = tAt(e); setRange(Math.min(dragFrom, t), Math.max(dragFrom, t)); });
  wave.addEventListener('pointerup', () => { if (dragFrom != null) { dragFrom = null; previewTrim(); } });
  document.getElementById('trimStart').oninput = e => setRange(+e.target.value, trim.end);
  document.getElementById('trimEnd').oninput = e => setRange(trim.start, +e.target.value);
  document.getElementById('trimPlay').onclick = previewTrim;
  document.getElementById('trimCancel').onclick = () => document.getElementById('trimDlg').close();
  document.getElementById('trimSave').onclick = async () => {
    const wav = encodeWav(trim.buf, trim.start, trim.end);
    await soundDB.put(trim.moment, { wav, name: trim.name, len: trim.end - trim.start });
    delete clipCache[trim.moment];
    document.getElementById('trimDlg').close();
    refresh(trim.moment); onChange('play', trim.moment);
  };
  window.addEventListener('resize', () => { if (document.getElementById('trimDlg').open) drawWave(); });
}
