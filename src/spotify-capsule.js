/* The Spotify player, from the Codex visual handoff (prototypes/blob-visual/prototype/spotify-capsule.js):
   a small capsule that opens into a card with art, the song, a waveform and play/skip.
   It only shows what it's given and reports what you press; app.js talks to Spotify.

   Inputs (DOM properties):
     track   = { title, artist, artworkUrl, context, progress, duration, at }   progress/duration in ms, at = when progress was read
     playing = boolean
     mode    = 'ok' | 'connect' | 'retry' | 'free' | 'web'   anything but 'ok' swaps the controls for a message
     note    = short line shown under the song (e.g. "Kept your music")
   Events: 'playback-action' with detail.action = play | pause | previous | next | plan | swap | connect | retry */
(function () {
  const icons = {
    play: '<path d="M9 5v14l11-7z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M9 6v12m6-12v12" stroke-width="2.6"/>',
    next: '<path d="m6 6 9 6-9 6z" fill="currentColor"/><path d="M17 6v12"/>',
    previous: '<path d="m18 6-9 6 9 6z" fill="currentColor"/><path d="M7 6v12"/>',
    chevron: '<path d="m6 15 6-6 6 6"/>',
    note: '<path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const MESSAGES = {
    web: ['Music works in the Mac app', 'Spotify can follow your blobs there', ''],
    connect: ['Spotify isn’t connected', 'Connect it in Settings', 'Connect'],
    retry: ['Spotify isn’t open', 'Open it on this Mac, then try again', 'Try again'],
  };

  class SpotifyCapsule extends HTMLElement {
    constructor() {
      super();
      this._playing = false; this._mode = 'ok'; this._track = null; this._note = '';
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        :host{display:block;position:relative;color:#eeedf4;font:inherit;max-width:100%;width:318px;min-height:55px}
        *{box-sizing:border-box}
        .frame{position:absolute;right:0;bottom:0;width:100%;display:flex;align-items:flex-end;justify-content:flex-end;border-radius:40px;background:linear-gradient(140deg,#292933ed,#171820fa 58%);border:1px solid #ffffff25;box-shadow:0 9px 25px #0006,inset 0 1px #ffffff12;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
        .frame.expanded{width:min(360px,calc(100vw - 40px));border-radius:23px}
        .frame.morphing{overflow:hidden}
        .capsule{display:flex;flex:none;align-items:center;gap:9px;padding:7px 9px 7px 7px;width:100%;min-width:0}
        .art{width:39px;height:39px;border-radius:50%;overflow:hidden;flex:none;background:#474555}
        .art svg,.art img{display:block;width:100%;height:100%;object-fit:cover}
        .meta{min-width:0;flex:1}
        .meta strong,.meta small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .meta strong{font-size:12px}.meta small{font-size:11px;color:#b8b5c4;margin-top:3px}
        button{font:inherit;color:#e9e8f0;display:grid;place-items:center;border:1px solid transparent;background:transparent;border-radius:50%;width:31px;height:31px;cursor:pointer;padding:5px;flex:none}
        button:hover{background:#ffffff18}button:active{transform:scale(.94)}
        button:focus-visible{outline:2px solid #dbffad;outline-offset:2px}
        button svg{width:100%;height:100%}
        .play{background:#d2f6a5;color:#192713;width:34px;height:34px}.play:hover{background:#e3ffc2}
        .act{width:auto;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:700;background:#d2f6a5;color:#192713}
        .act:hover{background:#e3ffc2}
        .transport{display:flex;align-items:center;justify-content:center;gap:12px}
        .player-label,.playback-state,.progress,.plan{display:none}
        .expanded .capsule{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:16px}
        .expanded .player-label{display:flex;align-items:center;gap:6px;justify-self:start;max-width:100%;width:auto;height:auto;border-radius:6px;padding:2px 0;color:#bcb7c9;font-size:10px;font-weight:750;letter-spacing:.16em;text-transform:uppercase}
        .expanded .player-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .expanded .player-label:hover{background:none;color:#fff}
        .expanded .expand{grid-column:2;grid-row:1;background:#ffffff10}
        .expanded .art{grid-column:1 / -1;width:100%;height:auto;aspect-ratio:1.8;border-radius:13px}
        .expanded .meta strong{font-size:23px;white-space:normal;overflow-wrap:anywhere}
        .expanded .meta small{font-size:14px;white-space:normal;overflow-wrap:anywhere}
        .expanded .wave{display:flex;justify-content:end;gap:3px}
        .expanded .wave i{width:3px}
        .expanded .progress{display:grid;grid-column:1 / -1;gap:5px}
        .bar{height:4px;border-radius:3px;background:#ffffff1f;overflow:hidden}
        .bar i{display:block;height:100%;width:0;background:#d2f6a5;border-radius:3px}
        .times{display:flex;justify-content:space-between;font-size:11px;color:#bcb7c9;font-variant-numeric:tabular-nums}
        .expanded .transport{grid-column:1 / -1;border-top:1px solid #ffffff18;padding-top:13px}
        .expanded .transport button{width:39px;height:39px;padding:9px}
        .expanded .transport .play{width:49px;height:49px;padding:11px}
        .expanded .transport .act{width:auto;height:auto;padding:9px 16px}
        .expanded .playback-state{display:block;grid-column:1 / -1;text-align:center;color:#bcb7c9;font-size:11px}
        .expanded .plan{display:flex;grid-column:1 / -1;justify-self:center;align-items:center;gap:7px;width:auto;height:auto;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;border-color:#ffffff25;background:#ffffff0d}
        .expanded .plan svg{width:15px;height:15px}
        [hidden]{display:none!important}
        .expand[aria-expanded="true"] svg{transform:rotate(180deg)}
        .wave{display:flex;align-items:center;gap:2px;color:#b7dd9b;height:23px}
        .wave i{display:block;width:2px;height:var(--height);background:currentColor;border-radius:4px;transform:scaleY(.58)}
        .wave.playing i{animation:wave .85s ease-in-out infinite alternate;animation-delay:var(--delay)}
        @keyframes wave{to{transform:scaleY(1)}}
        @media(prefers-reduced-motion:reduce){.wave.playing i{animation:none;transform:none}}
        @media(max-width:350px){.capsule{gap:5px}.wave{display:none}}
      </style>
      <div class="frame"><section class="capsule" aria-label="Spotify player">
        <button class="player-label" type="button" title="Change the music"><span>Spotify player</span></button>
        <div class="art" aria-hidden="true"></div>
        <div class="meta" aria-live="polite"><strong></strong><small></small></div>
        <div class="wave" aria-hidden="true">${[7, 14, 20, 11, 16, 8].map((n, i) => `<i style="--height:${n}px;--delay:-${i * 0.17}s"></i>`).join('')}</div>
        <div class="progress"><span class="bar"><i></i></span><span class="times"><span class="pos"></span><span class="dur"></span></span></div>
        <div class="transport" id="playback-options">
          <button class="previous" type="button" aria-label="Previous track" hidden>${icon('previous')}</button>
          <button class="play" type="button" aria-label="Play">${icon('play')}</button>
          <button class="next" type="button" aria-label="Next track" hidden>${icon('next')}</button>
          <button class="act" type="button" hidden></button>
        </div>
        <button class="expand" type="button" aria-label="Expand player" aria-expanded="false" aria-controls="playback-options">${icon('chevron')}</button>
        <span class="playback-state">Paused</span>
        <button class="plan" type="button">${icon('note')}What plays when</button>
      </section></div>`;
      const $ = s => root.querySelector(s);
      this.$ = $;
      const expand = $('.expand'), capsule = $('.capsule'), frame = $('.frame');
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      let morph, reveal;
      const setExpanded = open => {
        const from = frame.getBoundingClientRect(), fromRadius = getComputedStyle(frame).borderRadius;
        morph?.cancel(); reveal?.cancel();
        frame.classList.remove('morphing'); capsule.style.width = '';
        expand.setAttribute('aria-expanded', String(open));
        expand.setAttribute('aria-label', open ? 'Collapse player' : 'Expand player');
        frame.classList.toggle('expanded', open);
        this.expanded = open; this.paint();
        if (open) capsule.prepend(expand); else capsule.insertBefore(expand, $('.playback-state'));
        if (open) capsule.prepend($('.player-label'));
        expand.focus({ preventScroll: true });
        if (reducedMotion.matches) return;
        const to = frame.getBoundingClientRect(), toRadius = getComputedStyle(frame).borderRadius;
        // Keep the destination layout anchored while the shell reveals it.
        capsule.style.width = `${capsule.getBoundingClientRect().width}px`;
        frame.classList.add('morphing');
        const duration = open ? 340 : 280;
        morph = frame.animate([
          { width: `${from.width}px`, height: `${from.height}px`, borderRadius: fromRadius },
          { width: `${to.width}px`, height: `${to.height}px`, borderRadius: toRadius },
        ], { duration, easing: 'cubic-bezier(.22,.72,.25,1)' });
        reveal = capsule.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: duration * 0.7, easing: 'ease-out' });
        morph.addEventListener('finish', () => { frame.classList.remove('morphing'); capsule.style.width = ''; }, { once: true });
      };
      this.setExpanded = setExpanded;
      expand.addEventListener('click', () => setExpanded(!frame.classList.contains('expanded')));
      root.addEventListener('keydown', e => { if (e.key === 'Escape' && frame.classList.contains('expanded')) setExpanded(false); });
      $('.play').addEventListener('click', () => this.emit(this._playing ? 'pause' : 'play'));
      $('.previous').addEventListener('click', () => this.emit('previous'));
      $('.next').addEventListener('click', () => this.emit('next'));
      $('.plan').addEventListener('click', () => this.emit('plan'));
      $('.player-label').addEventListener('click', () => this.emit('swap'));
      $('.act').addEventListener('click', () => this.emit(this._mode === 'connect' ? 'connect' : 'retry'));
      this.artKey = null;
      setInterval(() => { if (this._playing && this.expanded && !document.hidden) this.tick(); }, 1000);
      this.paint();
    }

    emit(action) { this.dispatchEvent(new CustomEvent('playback-action', { detail: { action }, bubbles: true, composed: true })); }

    set track(t) { this._track = t; this.paint(); }
    get track() { return this._track; }
    set playing(v) { this._playing = Boolean(v); this.paint(); }
    get playing() { return this._playing; }
    set mode(v) { this._mode = v || 'ok'; this.paint(); }
    get mode() { return this._mode; }
    set note(v) { this._note = v || ''; this.paint(); }

    paint() {
      const $ = this.$, t = this._track || {}, mode = this._mode, msg = MESSAGES[mode];
      const ok = mode === 'ok' || mode === 'free';
      $('strong').textContent = msg ? msg[0] : (t.title || 'Nothing playing');
      $('small').textContent = msg ? msg[1] : (this._note || t.artist || (mode === 'free' ? '' : 'Press play or start a blob'));
      $('.player-label span').textContent = (t.context || 'Spotify player') + (ok ? ' ▾' : '');
      $('.player-label').disabled = !ok;
      this.setArt(msg ? '' : t.artworkUrl, t.title || '');
      const controls = mode === 'ok';
      $('.play').hidden = !controls;
      $('.previous').hidden = !controls || !this.expanded;
      $('.next').hidden = !controls || !this.expanded;
      const act = $('.act');
      act.hidden = !(msg && msg[2]);
      if (msg) act.textContent = msg[2];
      $('.play').setAttribute('aria-label', this._playing ? 'Pause' : 'Play');
      $('.play').innerHTML = icon(this._playing ? 'pause' : 'play');
      $('.wave').classList.toggle('playing', this._playing);
      $('.wave').hidden = !!msg;
      $('.progress').hidden = !(t.duration && !msg);
      $('.plan').hidden = mode === 'web';
      $('.playback-state').textContent = mode === 'free' ? 'Playing and skipping from BLOB need Spotify Premium'
        : msg ? '' : (this._playing ? 'Playing' : 'Paused') + (t.device ? ` on ${t.device}` : '');
      this.tick();
    }

    tick() {
      const t = this._track || {}, $ = this.$;
      if (!t.duration) return;
      const pos = Math.min(t.duration, (t.progress || 0) + (this._playing && t.at ? Date.now() - t.at : 0));
      $('.bar i').style.width = (pos / t.duration * 100).toFixed(1) + '%';
      $('.pos').textContent = mmss(pos); $('.dur').textContent = mmss(t.duration);
    }

    // Album art, or the handoff's abstract thumbnail tinted from the song title.
    setArt(url, seed) {
      const key = url || 'gen:' + seed;
      if (key === this.artKey) return;
      this.artKey = key;
      const art = this.$('.art');
      if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; art.replaceChildren(img); return; }
      let hue = 270; for (const ch of seed) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
      art.innerHTML = `<svg viewBox="0 0 44 44" preserveAspectRatio="xMidYMid slice"><rect width="44" height="44" fill="hsl(${hue} 30% 18%)"/>
        <circle cx="25" cy="20" r="15" fill="hsl(${hue} 66% 68%)"/>
        <path d="M0 28 14 13l15 19 15-8v20H0z" fill="hsl(${hue + 28} 40% 40%)"/>
        <path d="m0 37 13-9 12 8 19-9v17H0z" fill="hsl(${hue + 70} 40% 21%)"/>
        <path d="M5 13h13M24 26h14M5 32h17" stroke="#fff" opacity=".53" stroke-width=".6"/></svg>`;
    }
  }
  customElements.define('spotify-capsule', SpotifyCapsule);
})();
