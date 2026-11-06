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

  class Jelly {
    /* host: element the canvas fills. opts: {colors:[c1,c2?], wobble, seed, points, glow, radius, wide, waist, lobe}
       glow: neon look for dark backgrounds (outer glow + floor light); the canvas then overhangs the
       host so the glow isn't clipped. radius: body radius as a share of the host's smaller side.
       wide: stretch the body to fill a wide host (a long, soft jelly rather than a circle); waist pinches
       its middle and lobe makes one end fatter than the other (negative: the right end). */
    constructor(host, opts = {}) {
      this.host = host;
      this.canvas = document.createElement('canvas');
      this.canvas.className = opts.glow ? 'jelly glow' : 'jelly';
      this.glow = !!opts.glow; this.radius = opts.radius || 0.43;
      this.wide = !!opts.wide; this.waist = opts.waist || 0; this.lobe = opts.lobe || 0; this.ax = 1;
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
      this.ax = this.wide ? Math.max(1, hw * 0.45 / Math.max(1, this.R)) : 1;   // horizontal stretch
    }
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
    path() {
      const n = this.n, pts = [], ox = this.w / 2 + this.cx, oy = this.h / 2 + this.cy + this.R * 0.04;
      const sx = 1 + this.sq * 0.5, sy = 1 - this.sq;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, r = this.R + this.d[i];
        let ux = Math.cos(a), uy = Math.sin(a);
        if (this.wide) {
          // squarer ends and a soft pinch in the middle, so it reads as a jelly bean, not a lens
          const c = ux, s = uy;
          ux = Math.sign(c) * Math.pow(Math.abs(c), 0.72) * this.ax;
          uy = Math.sign(s) * Math.pow(Math.abs(s), 0.9) * (1 - this.waist * Math.exp(-c * c * 10)) * (1 - this.lobe * c);
        }
        pts.push([ox + ux * r * sx, oy + uy * r * sy]);
      }
      const p = new Path2D();
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let m = mid(pts[n - 1], pts[0]); p.moveTo(m[0], m[1]);
      for (let i = 0; i < n; i++) { const nx = mid(pts[i], pts[(i + 1) % n]); p.quadraticCurveTo(pts[i][0], pts[i][1], nx[0], nx[1]); }
      p.closePath();
      return { p, ox, oy };
    }
    draw() {
      const g = this.g, R = this.R, [c1, c2] = this.current();
      g.clearRect(0, 0, this.w, this.h);
      const { p, ox, oy } = this.path();
      if (this.glow) {
        // light pooling on the floor, then a neon halo behind the body
        g.save(); g.globalAlpha = 0.45 * (this.dim ?? 1); g.fillStyle = c2; g.filter = `blur(${Math.max(4, R * 0.18)}px)`;
        g.beginPath(); g.ellipse(this.w / 2 + this.cx * 0.5, oy + R * 1.08, R * 0.8 * this.ax, R * 0.13, 0, 0, Math.PI * 2); g.fill(); g.restore();
        g.save(); g.globalAlpha = 0.55 * (this.dim ?? 1); g.shadowColor = c1; g.shadowBlur = R * 0.55; g.fillStyle = c2; g.fill(p); g.restore();
      } else {
        // contact shadow
        g.save(); g.fillStyle = 'rgba(20,24,50,.16)'; g.filter = 'blur(6px)';
        g.beginPath(); g.ellipse(this.w / 2 + this.cx * 0.5, oy + R * (1 - this.sq) * 0.98, R * 0.78, R * 0.12, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      // body: the two colours run diagonally, lit from the top-left
      g.save(); g.clip(p);
      const lin = g.createLinearGradient(ox - R * this.ax, oy - R, ox + R * this.ax, oy + R);
      lin.addColorStop(0, c1); lin.addColorStop(1, c2);
      g.fillStyle = lin; g.fill(p);
      const shade = g.createRadialGradient(ox - R * 0.3 * this.ax, oy - R * 0.35, R * 0.1, ox, oy, R * 1.25 * (this.wide ? this.ax * 0.75 : 1));
      shade.addColorStop(0, 'rgba(255,255,255,.38)'); shade.addColorStop(0.45, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,10,40,.32)');
      g.fillStyle = shade; g.fill(p);
      // see-through depth: a lighter core and a few suspended bubbles
      const core = g.createRadialGradient(ox + R * 0.15, oy + R * 0.25, 0, ox + R * 0.15, oy + R * 0.25, R * 0.7);
      core.addColorStop(0, 'rgba(255,255,255,.16)'); core.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = core; g.fill(p);
      const t = performance.now() / 1000;
      g.fillStyle = 'rgba(255,255,255,.28)';
      for (let i = 0; i < 4; i++) {
        const a = this.seed + i * 1.9, rr = R * (0.68 + 0.14 * ((i * 37 + this.seed) % 1));
        const bx = ox + Math.cos(a) * rr * this.ax, by = oy + Math.sin(a) * rr + Math.sin(t * 0.8 + i) * R * 0.02;
        g.beginPath(); g.arc(bx, by, R * (0.025 + i * 0.008), 0, Math.PI * 2); g.fill();
      }
      g.restore();
      // glossy rim + specular highlight
      g.save(); g.lineWidth = Math.max(1.5, R * 0.03); g.strokeStyle = 'rgba(255,255,255,.45)'; g.stroke(p); g.restore();
      g.save(); g.clip(p);
      g.fillStyle = 'rgba(255,255,255,.75)'; g.filter = `blur(${Math.max(1, R * 0.03)}px)`;
      g.beginPath(); g.ellipse(ox - R * (this.wide ? this.ax * 0.62 : 0.38) + this.cx * 0.2, oy - R * 0.5, R * 0.26 * (this.wide ? 1.6 : 1), R * 0.11, this.wide ? -0.25 : -0.55, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(ox - R * 0.08, oy - R * 0.66, R * 0.045, 0, Math.PI * 2); g.fill();
      g.restore();
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
