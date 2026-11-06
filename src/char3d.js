/* Picture → little 3D character.
   Cuts the subject out of a flat picture, "inflates" its silhouette into a soft plush-like
   mesh (height grows with distance from the edge), textures it with the picture, and animates it.
   Everything runs on-device: no network, no AI service. */
import * as THREE from './vendor/three.module.js';

const SIZE = 256;   // working resolution for the cutout
const GRID = 144;   // mesh resolution

/* ---------- 1. Cut the subject out ---------- */

function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

/* Returns {canvas, mask} where canvas is a SIZE×SIZE transparent PNG of just the subject. */
export async function cutout(src) {
  const im = await loadImage(src);
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  const s = Math.min(SIZE / im.width, SIZE / im.height) * 0.92;
  const w = im.width * s, h = im.height * s;
  g.drawImage(im, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  const data = g.getImageData(0, 0, SIZE, SIZE), px = data.data, N = SIZE * SIZE;
  const mask = new Uint8Array(N);

  // Does the picture already have transparency? Then trust it.
  let transparent = 0;
  for (let i = 0; i < N; i++) if (px[i * 4 + 3] < 20) transparent++;
  if (transparent > N * 0.05) {
    for (let i = 0; i < N; i++) mask[i] = px[i * 4 + 3] > 100 ? 1 : 0;
  } else {
    // Background = whatever is connected to the border and close to the border colour.
    const border = [];
    for (let i = 0; i < SIZE; i++) border.push(i, (SIZE - 1) * SIZE + i, i * SIZE, i * SIZE + SIZE - 1);
    const med = k => { const v = border.map(i => px[i * 4 + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const bg = [med(0), med(1), med(2)];
    const far = i => { const dr = px[i * 4] - bg[0], dg = px[i * 4 + 1] - bg[1], db = px[i * 4 + 2] - bg[2]; return dr * dr + dg * dg + db * db > 38 * 38; };
    const isBg = new Uint8Array(N), stack = [];
    for (const i of border) if (!far(i) && !isBg[i]) { isBg[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), x = i % SIZE, y = (i / SIZE) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx;
        if (!isBg[j] && !far(j)) { isBg[j] = 1; stack.push(j); }
      }
    }
    for (let i = 0; i < N; i++) mask[i] = isBg[i] ? 0 : 1;
  }
  keepLargest(mask);
  fillHoles(mask);
  for (let i = 0; i < N; i++) px[i * 4 + 3] = mask[i] ? 255 : 0;
  // Bleed edge colours outward so the mesh rim never samples dark/empty pixels.
  const tex = new Uint8ClampedArray(px), filled = mask.slice();
  for (let pass = 0; pass < 8; pass++) {
    const next = filled.slice();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x; if (filled[i]) continue;
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx; if (!filled[j]) continue;
        r += tex[j * 4]; gg += tex[j * 4 + 1]; b += tex[j * 4 + 2]; n++;
      }
      if (n) { tex[i * 4] = r / n; tex[i * 4 + 1] = gg / n; tex[i * 4 + 2] = b / n; tex[i * 4 + 3] = 255; next[i] = 1; }
    }
    filled.set(next);
  }
  g.putImageData(new ImageData(tex, SIZE, SIZE), 0, 0);
  // A clean transparent copy for saving/previewing.
  const clean = document.createElement('canvas'); clean.width = clean.height = SIZE;
  clean.getContext('2d').putImageData(data, 0, 0);
  c.clean = clean;
  return { canvas: c, mask };
}

function keepLargest(mask) {
  const N = SIZE * SIZE, lab = new Int32Array(N); let best = 0, bestN = 0, id = 0;
  for (let i = 0; i < N; i++) {
    if (!mask[i] || lab[i]) continue;
    id++; let n = 0; const st = [i]; lab[i] = id;
    while (st.length) {
      const k = st.pop(); n++; const x = k % SIZE, y = (k / SIZE) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = ny * SIZE + nx; if (mask[j] && !lab[j]) { lab[j] = id; st.push(j); }
      }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  for (let i = 0; i < N; i++) mask[i] = lab[i] === best ? 1 : 0;
}

function fillHoles(mask) {
  const N = SIZE * SIZE, out = new Uint8Array(N), st = [];
  for (let i = 0; i < SIZE; i++) for (const k of [i, (SIZE - 1) * SIZE + i, i * SIZE, i * SIZE + SIZE - 1]) if (!mask[k] && !out[k]) { out[k] = 1; st.push(k); }
  while (st.length) {
    const k = st.pop(), x = k % SIZE, y = (k / SIZE) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const j = ny * SIZE + nx; if (!mask[j] && !out[j]) { out[j] = 1; st.push(j); }
    }
  }
  for (let i = 0; i < N; i++) mask[i] = out[i] ? 0 : 1;
}

/* ---------- 2. Inflate the silhouette into a mesh ---------- */

function distanceField(mask) {
  // Two-pass chamfer distance to the nearest outside pixel.
  const INF = 1e9, d = new Float32Array(SIZE * SIZE), D1 = 1, D2 = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE) ? 0 : d[y * SIZE + x];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + D1, at(x, y - 1) + D1, at(x - 1, y - 1) + D2, at(x + 1, y - 1) + D2);
  }
  for (let y = SIZE - 1; y >= 0; y--) for (let x = SIZE - 1; x >= 0; x--) {
    const i = y * SIZE + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + D1, at(x, y + 1) + D1, at(x + 1, y + 1) + D2, at(x - 1, y + 1) + D2);
  }
  // Blur so the surface is smooth instead of stair-stepped.
  for (let pass = 0; pass < 3; pass++) {
    const t = new Float32Array(d.length);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      let s = 0, n = 0;
      for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < SIZE) { s += d[y * SIZE + xx]; n++; } }
      t[y * SIZE + x] = s / n;
    }
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      let s = 0, n = 0;
      for (let k = -2; k <= 2; k++) { const yy = y + k; if (yy >= 0 && yy < SIZE) { s += t[yy * SIZE + x]; n++; } }
      d[y * SIZE + x] = s / n;
    }
  }
  return d;
}

function inflate(mask) {
  const dist = distanceField(mask);
  let max = 1; for (const v of dist) if (v > max) max = v;
  const sample = (u, v) => {           // bilinear sample of the distance field
    const x = u * (SIZE - 1), y = v * (SIZE - 1), x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, SIZE - 1), y1 = Math.min(y0 + 1, SIZE - 1), fx = x - x0, fy = y - y0;
    const g = (a, b) => dist[b * SIZE + a];
    return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
  };
  // Pillow profile: rounded at the rim, gently domed in the middle.
  const height = dd => { const t = Math.min(1, dd / max); return Math.sqrt(t * (2 - t)) * 0.30 + t * 0.06; };

  const V = GRID + 1, pos = [], uv = [], idx = [];
  const inside = new Uint8Array(V * V), hs = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const u = i / GRID, v = j / GRID, dd = sample(u, v);
    inside[j * V + i] = dd > 0.9 ? 1 : 0; hs[j * V + i] = dd > 0.9 ? height(dd - 0.9) : 0;
  }
  // Front and back sheets share rim vertices (height 0), so they close up like a pillow.
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i;
      pos.push(i / GRID - 0.5, 0.5 - j / GRID, side * hs[k] * (side > 0 ? 1 : 0.75));
      uv.push(side > 0 ? i / GRID : i / GRID, 1 - j / GRID);
    }
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      const n = inside[a] + inside[b] + inside[c] + inside[d];
      if (n < 3) continue;
      if (side > 0) { if (inside[a] + inside[b] + inside[c] >= 2) idx.push(base + a, base + c, base + b); if (inside[b] + inside[c] + inside[d] >= 2) idx.push(base + b, base + c, base + d); }
      else { if (inside[a] + inside[b] + inside[c] >= 2) idx.push(base + a, base + b, base + c); if (inside[b] + inside[c] + inside[d] >= 2) idx.push(base + b, base + d, base + c); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Crop to the subject so it sits on the ground and fills the frame.
  geo.computeBoundingBox();
  const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, sz = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
  geo.translate(-cx, -bb.min.y, 0); geo.scale(1 / sz, 1 / sz, 1 / sz);
  return geo;
}

/* ---------- 3. Stage + animation ---------- */

const MOODS = {           // how the character moves during each block type
  focus: { bob: 0.018, speed: 1.6, sway: 0.05 },
  snack: { bob: 0.035, speed: 2.4, sway: 0.12 },
  meal:  { bob: 0.03,  speed: 1.8, sway: 0.10 },
  chill: { bob: 0.02,  speed: 0.9, sway: 0.18 },
  hype:  { bob: 0.07,  speed: 5.0, sway: 0.08 },
};

export class Char3D {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 0.6, 2.05); this.camera.lookAt(0, 0.5, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890b0, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-1.2, 2, 2.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(1.5, 1, -2); this.scene.add(rim);
    // Soft contact shadow
    const sh = document.createElement('canvas'); sh.width = sh.height = 64; const sg = sh.getContext('2d');
    const grd = sg.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(0,0,0,.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grd; sg.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.scene.add(this.shadow);
    this.rig = new THREE.Group(); this.scene.add(this.rig);
    this.mood = MOODS.focus; this.look = { x: 0, y: 0 }; this.hopT = -1; this.t0 = performance.now();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    host.addEventListener('pointerdown', () => this.hop());
    const loop = () => { this.frame(); this.raf = requestAnimationFrame(loop); }; loop();
  }
  async setImage(src) {
    const { canvas, mask } = await cutout(src);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const geo = inflate(mask);
    if (this.mesh) { this.rig.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.map?.dispose(); }
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }));
    this.rig.add(this.mesh);
    this.hop();
    return canvas.clean.toDataURL('image/png');
  }
  setMode(type) { this.mood = MOODS[type] || MOODS.focus; }
  lookAt(x, y) { this.look.x = Math.max(-1, Math.min(1, x)); this.look.y = Math.max(-1, Math.min(1, y)); }
  hop() { this.hopT = 0; }
  resize() {
    const r = this.host.getBoundingClientRect(), s = Math.max(1, Math.min(r.width, r.height));
    this.renderer.setSize(r.width, r.height, false); this.camera.aspect = r.width / Math.max(1, r.height); this.camera.updateProjectionMatrix();
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%'; void s;
  }
  frame() {
    const t = (performance.now() - this.t0) / 1000, m = this.mood, still = this.reduced;
    let y = 0, sy = 1;
    if (!still) {
      const ph = Math.sin(t * m.speed);
      y = (ph * 0.5 + 0.5) * m.bob;
      sy = 1 + ph * m.bob * 1.2;           // stretch going up, squash coming down
    }
    if (this.hopT >= 0) {                   // a little jump with squash on landing
      this.hopT += 1 / 60; const h = this.hopT;
      if (h < 0.08) sy *= 1 - h * 2.5;
      else if (h < 0.48) { const p = (h - 0.08) / 0.4; y += Math.sin(p * Math.PI) * 0.16; sy *= 1 + Math.sin(p * Math.PI) * 0.08; }
      else if (h < 0.62) sy *= 1 - Math.sin((h - 0.48) / 0.14 * Math.PI) * 0.12;
      else this.hopT = -1;
    }
    this.rig.position.y = y;
    this.rig.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    const sway = still ? 0 : Math.sin(t * 0.7) * m.sway;
    const ry = sway + this.look.x * 0.45, rx = -this.look.y * 0.18;
    this.rig.rotation.y += (ry - this.rig.rotation.y) * 0.08;
    this.rig.rotation.x += (rx - this.rig.rotation.x) * 0.08;
    this.rig.rotation.z = still ? 0 : Math.sin(t * m.speed * 0.5) * 0.025;
    const k = 1 - y * 2.5; this.shadow.scale.set(k, k, 1);
    this.renderer.render(this.scene, this.camera);
  }
}

window.PaceChar3D = { Char3D, cutout };
window.dispatchEvent(new Event('pace3d-ready'));
