/* Jelly: a soft-body blob drawn on a canvas. Push it with the pointer, poke it, watch it wobble.
   Each blob is a ring of points with a springy radius; neighbours pull on each other so a dent
   spreads like gelatin, and a gentle idle wobble keeps it alive. One shared loop drives every blob. */
(function () {
  const blobs = new Set();
  let raf = 0, last = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function loop(ts) {
    const dt = Math.min(0.033, (ts - (last || ts)) / 1000) || 0.016; last = ts;
    for (const b of blobs) { if (!b.canvas.isConnected) { blobs.delete(b); continue; } b.step(dt); b.draw(); }
    raf = blobs.size ? requestAnimationFrame(loop) : 0;
    if (!raf) last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`; };
  const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;
  // like rgba() but also takes the 'rgb(r,g,b)' strings mix() returns
  const rgbaOf = (c, a) => c[0] === '#' ? rgba(c, a) : c.replace('rgb(', 'rgba(').replace(')', `,${a})`);

  class Jelly {
    /* host: element the canvas fills. opts: {colors:[c1,c2?], rim, wobble, seed, points, glow, radius, lumpy, aspect}
       rim: an optional colour for a band around the edge (where a blob came from, e.g. its calendar).
       lumpy: how irregular the silhouette is (0 = round). aspect: >1 makes it wider than tall.
       glow: neon look for dark backgrounds (outer glow + floor light); the canvas then overhangs the
       host so the glow isn't clipped. radius: body radius as a share of the host's smaller side. */
    constructor(host, opts = {}) {
      this.host = host;
      this.canvas = document.createElement('canvas');
      this.canvas.className = opts.glow ? 'jelly glow' : 'jelly';
      this.glow = !!opts.glow; this.radius = opts.radius || 0.43;
      this.canvas.setAttribute('aria-hidden', 'true');
      host.prepend(this.canvas);
      this.g = this.canvas.getContext('2d');
      this.n = opts.points || 30;
      this.seed = opts.seed ?? Math.random() * 1000;
      this.d = new Float32Array(this.n); this.v = new Float32Array(this.n);
      this.cx = 0; this.cy = 0; this.vx = 0; this.vy = 0;   // body offset (blob slides when pushed)
      this.sq = 0; this.vsq = 0;                             // squash
      this.idle = opts.wobble ?? 1;
      this.colors = opts.colors || ['#8ad62f'];
      this.color = this.colors.slice(); this.target = this.colors.slice(); this.colorT = 1;
      this.rim = opts.rim || null;
      this.lumpy = opts.lumpy ?? 1; this.aspect = opts.aspect ?? 1.06;
      this.lobes = Float32Array.from({ length: this.n }, (_, i) => this.lobeAt(i / this.n * Math.PI * 2));
      // bubbles: fixed spots near the edge, a few bigger ones, mostly tiny
      let r = this.seed * 9301 + 49297; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
      this.bubbles = Array.from({ length: opts.bubbles ?? 16 }, (_, i) => ({
        a: rnd() * Math.PI * 2, inset: 0.6 + rnd() * 0.24, r: i % 4 === 0 ? 0.055 + rnd() * 0.03 : 0.014 + rnd() * 0.026,
        o: i % 3 === 0 ? 0.7 : 0.48, ph: rnd() * 6 }));
      this.pointer = null;
      this.resize();
      new ResizeObserver(() => this.resize()).observe(host);
      host.addEventListener('pointermove', e => this.onMove(e));
      host.addEventListener('pointerleave', () => { this.pointer = null; });
      host.addEventListener('pointerdown', e => this.poke(e));
      blobs.add(this); kick();
    }
    resize() {
      const hw = this.host.offsetWidth, hh = this.host.offsetHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      const k = this.glow ? 1.6 : 1;   // must match the canvas.jelly.glow overhang in CSS
      this.w = hw * k; this.h = hh * k;
      this.canvas.width = Math.max(1, this.w * dpr); this.canvas.height = Math.max(1, this.h * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.R = Math.min(hw, hh) * this.radius;
    }
    setRim(c) { if (c !== this.rim) { this.rim = c || null; this.jiggle(0.3); } }
    setColors(colors) {
      const c = colors.length > 1 ? colors : [colors[0], colors[0]];
      this.color = this.current(); this.target = c.slice(); this.colorT = 0;
      this.jiggle(0.5);
    }
    current() {
      const a = this.color.length > 1 ? this.color : [this.color[0], this.color[0]], b = this.target.length > 1 ? this.target : [this.target[0], this.target[0]];
      if (this.colorT >= 1) return b;
      return [0, 1].map(i => { const m = mix(a[i], b[i], this.colorT).match(/\d+/g).map(Number); return '#' + m.map(v => v.toString(16).padStart(2, '0')).join(''); });
    }
    local(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }; }
    onMove(e) {
      const p = this.local(e), prev = this.pointer;
      this.pointer = p;
      if (!prev || reduced) return;
      const mvx = p.x - prev.x, mvy = p.y - prev.y, speed = Math.hypot(mvx, mvy);
      // Moving across the blob drags its surface and nudges the body along.
      const ang = Math.atan2(p.y - this.cy, p.x - this.cx), dist = Math.hypot(p.x - this.cx, p.y - this.cy);
      if (dist < this.R * 1.15) {
        for (let i = 0; i < this.n; i++) {
          const a = i / this.n * Math.PI * 2, diff = Math.atan2(Math.sin(a - ang), Math.cos(a - ang));
          const fall = Math.exp(-diff * diff * 6);
          this.v[i] -= fall * speed * 0.9;
        }
        this.vx += mvx * 0.6; this.vy += mvy * 0.6;
      }
    }
    poke(e) {
      const p = e ? this.local(e) : { x: 0, y: -this.R };
      const ang = Math.atan2(p.y - this.cy, p.x - this.cx);
      for (let i = 0; i < this.n; i++) {
        const a = i / this.n * Math.PI * 2, diff = Math.atan2(Math.sin(a - ang), Math.cos(a - ang));
        this.v[i] -= Math.exp(-diff * diff * 3) * this.R * 2.2;
      }
      this.vsq += 4;
    }
    jiggle(s = 1) { for (let i = 0; i < this.n; i++) this.v[i] += Math.sin(i * 2.3 + this.seed) * this.R * 0.8 * s; this.vsq -= 3 * s; }
    step(dt) {
      const n = this.n, k = 120, damp = 5.5, tension = 260;
      const t = performance.now() / 1000;
      // Pointer resting inside near the rim presses a dent.
      let press = null;
      if (this.pointer) { const dd = Math.hypot(this.pointer.x - this.cx, this.pointer.y - this.cy); if (dd < this.R) press = { ang: Math.atan2(this.pointer.y - this.cy, this.pointer.x - this.cx), depth: (this.R - dd) / this.R }; }
      for (let i = 0; i < n; i++) {
        const l = this.d[(i + n - 1) % n], r = this.d[(i + 1) % n];
        let rest = 0;
        if (!reduced) rest += (Math.sin(t * 1.7 + i * 0.7 + this.seed) * 0.022 + Math.sin(t * 1.1 - i * 0.45 + this.seed * 2) * 0.018) * this.R * this.idle;
        if (press) {
          const a = i / n * Math.PI * 2, diff = Math.atan2(Math.sin(a - press.ang), Math.cos(a - press.ang));
          rest -= Math.exp(-diff * diff * 5) * press.depth * this.R * 0.18;
        }
        const acc = -k * (this.d[i] - rest) - damp * this.v[i] + tension * (l + r - 2 * this.d[i]) / 4;
        this.v[i] += acc * dt;
      }
      for (let i = 0; i < n; i++) { this.d[i] += this.v[i] * dt; this.d[i] = Math.max(-this.R * 0.45, Math.min(this.R * 0.45, this.d[i])); }
      // body spring back to centre
      this.vx += (-60 * this.cx - 7 * this.vx) * dt; this.vy += (-60 * this.cy - 7 * this.vy) * dt;
      this.cx += this.vx * dt; this.cy += this.vy * dt;
      const lim = this.R * 0.12; this.cx = Math.max(-lim, Math.min(lim, this.cx)); this.cy = Math.max(-lim, Math.min(lim, this.cy));
      this.vsq += (-90 * this.sq - 6 * this.vsq) * dt; this.sq += this.vsq * dt; this.sq = Math.max(-0.25, Math.min(0.25, this.sq));
      if (this.colorT < 1) this.colorT = Math.min(1, this.colorT + dt * 1.6);
    }
    /* The resting silhouette: a few slow lobes so each blob is a lumpy cloud, not a ball.
       Same seed, same shape, so a blob keeps its face between reloads. */
    lobeAt(a) {
      const s = this.seed, k = this.lumpy;
      return k * (0.02 * Math.sin(2 * a + s * 0.6) + 0.038 * Math.sin(4 * a + s) + 0.028 * Math.sin(6 * a + s * 1.7) + 0.016 * Math.sin(9 * a + s * 2.3));
    }
    path() {
      const n = this.n, pts = [], rad = [], ox = this.w / 2 + this.cx, oy = this.h / 2 + this.cy + this.R * 0.04;
      const sx = (1 + this.sq * 0.5) * this.aspect, sy = (1 - this.sq) / this.aspect;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, r = this.R * (1 + this.lobes[i]) + this.d[i];
        rad.push(r); pts.push([ox + Math.cos(a) * r * sx, oy + Math.sin(a) * r * sy]);
      }
      const p = new Path2D();
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let m = mid(pts[n - 1], pts[0]); p.moveTo(m[0], m[1]);
      for (let i = 0; i < n; i++) { const nx = mid(pts[i], pts[(i + 1) % n]); p.quadraticCurveTo(pts[i][0], pts[i][1], nx[0], nx[1]); }
      p.closePath();
      // a point just inside the surface at angle a (follows every dent and wobble)
      const at = (a, inset) => {
        const f = ((a / (Math.PI * 2)) % 1 + 1) % 1 * n, i = Math.floor(f) % n, u = f - Math.floor(f);
        const r = (rad[i] * (1 - u) + rad[(i + 1) % n] * u) * inset;
        return [ox + Math.cos(a) * r * sx, oy + Math.sin(a) * r * sy];
      };
      return { p, ox, oy, at };
    }
    /* The material (shared by the Brain, task blobs and anything else made of jelly): a deep,
       see-through body that is darkest in the middle, a bright gradient rim with a soft bloom,
       light pooling along the bottom, curved specular streaks that follow the surface, and
       bubbles suspended near the edge. Colours come from the blob's two colours. */
    draw() {
      const g = this.g, R = this.R, [c1, c2] = this.current(), dim = this.dim ?? 1;
      g.clearRect(0, 0, this.w, this.h);
      const { p, ox, oy, at } = this.path();
      const light = mix(c1, '#ffffff', 0.55), mid = mix(c2, c1, 0.35), depth = mix(c2, '#000000', 0.42),
        dark = mix(c2, '#0a0716', 0.78), glow = mix(c2, c1, 0.2);
      const top = oy - R, bot = oy + R;
      // bloom behind the body
      if (this.glow) {
        g.save(); g.globalAlpha = 0.5 * dim; g.shadowColor = glow; g.shadowBlur = R * 0.32;
        g.lineWidth = R * 0.06; g.strokeStyle = glow; g.stroke(p); g.restore();
      } else {
        g.save(); g.fillStyle = 'rgba(20,24,50,.16)'; g.filter = 'blur(6px)';
        g.beginPath(); g.ellipse(this.w / 2 + this.cx * 0.5, oy + R * (1 - this.sq) * 0.98, R * 0.78, R * 0.12, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      // body: lit at the top, deep in the middle, glowing again underneath
      const body = g.createLinearGradient(ox - R * 0.25, top, ox + R * 0.25, bot);
      body.addColorStop(0, mid); body.addColorStop(0.27, depth); body.addColorStop(0.59, dark); body.addColorStop(0.8, depth); body.addColorStop(1, glow);
      g.save(); g.globalAlpha = 0.92; g.fillStyle = body; g.fill(p); g.restore();
      const rimGrad = g.createLinearGradient(ox - R * 0.65, top, ox + R * 0.55, bot);
      rimGrad.addColorStop(0, light); rimGrad.addColorStop(0.26, mid); rimGrad.addColorStop(0.55, depth); rimGrad.addColorStop(0.8, glow); rimGrad.addColorStop(1, light);
      const shine = g.createLinearGradient(ox - R * 0.9, top, ox + R * 0.9, oy + R * 0.6);
      shine.addColorStop(0, rgbaOf(light, 0)); shine.addColorStop(0.32, rgbaOf(light, 0.92)); shine.addColorStop(0.66, 'rgba(255,255,255,.75)'); shine.addColorStop(1, rgbaOf(light, 0));
      g.save(); g.clip(p);
      // caustics: light gathering in the belly and a softer wash near the top
      const cau = (x, y, rx, ry, a) => {
        g.save(); g.globalAlpha = a; g.translate(x, y); g.scale(1, ry / rx);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        rg.addColorStop(0, rgbaOf(light, 0.82)); rg.addColorStop(0.43, rgbaOf(glow, 0.28)); rg.addColorStop(1, rgbaOf(glow, 0));
        g.fillStyle = rg; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill(); g.restore();
      };
      cau(ox, oy + R * 0.92, R * 1.05, R * 0.5, 0.75);
      cau(ox - R * 0.05, oy - R * 0.72, R * 0.68, R * 0.24, 0.4);
      // the inside of the rim: a wide soft band, then a thin bright line that catches the light
      g.lineWidth = R * 0.13; g.globalAlpha = 0.43; g.strokeStyle = rimGrad; g.stroke(p);
      g.lineWidth = R * 0.045; g.globalAlpha = 0.9; g.strokeStyle = shine; g.stroke(p);
      g.globalAlpha = 1;
      // bubbles suspended near the edge
      const tt = performance.now() / 1000;
      for (const b of this.bubbles) {
        const [bx, by] = at(b.a + Math.sin(tt * 0.35 + b.ph) * 0.03, b.inset);
        const br = R * b.r, y = by + Math.sin(tt * 0.8 + b.ph) * R * 0.012;
        const bg = g.createRadialGradient(bx - br * 0.4, y - br * 0.5, 0, bx, y, br);
        bg.addColorStop(0, rgbaOf(light, 0.85)); bg.addColorStop(0.3, rgbaOf(mid, 0.4)); bg.addColorStop(0.7, rgbaOf(dark, 0.42)); bg.addColorStop(1, rgbaOf(light, 0.66));
        g.globalAlpha = b.o; g.fillStyle = bg; g.beginPath(); g.arc(bx, y, br, 0, Math.PI * 2); g.fill();
        g.lineWidth = 0.8; g.strokeStyle = rgbaOf(light, 0.3); g.stroke();
      }
      g.globalAlpha = 1;
      // specular streaks: curved highlights that ride just inside the surface
      g.lineCap = 'round';
      const streak = (a0, a1, inset, w, alpha) => {
        g.beginPath();
        for (let k = 0; k <= 14; k++) { const [x, y] = at(a0 + (a1 - a0) * k / 14, inset); k ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.globalAlpha = alpha; g.lineWidth = w; g.strokeStyle = shine; g.stroke();
      };
      const D = Math.PI / 180;
      streak(188 * D, 252 * D, 0.8, Math.max(2, R * 0.045), 0.9);
      streak(282 * D, 318 * D, 0.8, Math.max(1.5, R * 0.032), 0.7);
      streak(142 * D, 168 * D, 0.82, Math.max(1.2, R * 0.026), 0.6);
      streak(55 * D, 82 * D, 0.84, Math.max(1.2, R * 0.024), 0.45);
      g.restore();
      // optional colour band around the edge (where a blob came from, e.g. its calendar)
      if (this.rim) {
        g.save(); g.globalAlpha = dim; g.lineWidth = Math.max(3, R * 0.1); g.strokeStyle = this.rim;
        g.shadowColor = this.rim; g.shadowBlur = R * 0.25; g.stroke(p); g.restore();
      }
      // the outer rim itself
      g.save(); g.lineWidth = Math.max(1.5, R * 0.022); g.strokeStyle = rimGrad; g.stroke(p); g.restore();
    }
    /* Pop: squash, burst outwards and fade. Resolves when finished. */
    pop() {
      return new Promise(res => {
        this.jiggle(2); this.vsq += 8;
        this.host.classList.add('popping');
        setTimeout(res, reduced ? 0 : 420);
      });
    }
  }
  window.Jelly = Jelly;
  window.JellyColors = { rgba, mix };
})();
