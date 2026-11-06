const icons = {
  play:'<path d="M9 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M9 6v12m6-12v12" stroke-width="2.6"/>',
  next:'<path d="m6 6 9 6-9 6z" fill="currentColor"/><path d="M17 6v12"/>',
  previous:'<path d="m18 6-9 6 9 6z" fill="currentColor"/><path d="M7 6v12"/>',
  chevron:'<path d="m6 15 6-6 6 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

export class SpotifyCapsule extends HTMLElement {
  #playing = false;
  #root;
  #art;
  #track;
  #artist;
  #play;
  #wave;

  constructor() {
    super();
    this.#root = this.attachShadow({mode:'open'});
    this.#root.innerHTML = `<style>
      :host{display:block;position:relative;color:#eeedf4;font:inherit;max-width:100%;width:318px;min-height:55px}
      *{box-sizing:border-box}
      .frame{position:absolute;right:0;bottom:0;width:100%;display:flex;align-items:flex-end;justify-content:flex-end;border-radius:40px;background:linear-gradient(140deg,#292933ed,#171820fa 58%);border:1px solid #ffffff25;box-shadow:0 9px 25px #0006,inset 0 1px #ffffff12}
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
      .transport{display:flex;align-items:center;justify-content:center;gap:12px}
      .player-label,.playback-state{display:none}
      .expanded .capsule{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:16px}
      .expanded .player-label{display:block;color:#bcb7c9;font-size:10px;font-weight:750;letter-spacing:.16em}
      .expanded .expand{grid-column:2;grid-row:1;background:#ffffff10}
      .expanded .art{grid-column:1 / -1;width:100%;height:auto;aspect-ratio:1.8;border-radius:13px}
      .expanded .meta strong{font-size:23px;white-space:normal;overflow-wrap:anywhere}
      .expanded .meta small{font-size:14px;white-space:normal;overflow-wrap:anywhere}
      .expanded .wave{display:flex;justify-content:end;gap:3px}
      .expanded .wave i{width:3px}
      .expanded .transport{grid-column:1 / -1;border-top:1px solid #ffffff18;padding-top:13px}
      .expanded .transport button{width:39px;height:39px;padding:9px}
      .expanded .transport .play{width:49px;height:49px;padding:11px}
      .expanded .playback-state{display:block;grid-column:1 / -1;text-align:center;color:#bcb7c9;font-size:11px}
      button[hidden]{display:none}
      .expand[aria-expanded="true"] svg{transform:rotate(180deg)}
      .wave{display:flex;align-items:center;gap:2px;color:#b7dd9b;height:23px}
      .wave i{display:block;width:2px;height:var(--height);background:currentColor;border-radius:4px;transform:scaleY(.58)}
      .wave.playing i{animation:wave .85s ease-in-out infinite alternate;animation-delay:var(--delay)}
      @keyframes wave{to{transform:scaleY(1)}}
      @media(prefers-reduced-motion:reduce){.wave.playing i{animation:none;transform:none}}
      @media(max-width:350px){.capsule{gap:5px}.wave{display:none}}
    </style>
    <div class="frame"><section class="capsule" aria-label="Spotify player">
      <span class="player-label" aria-hidden="true">SPOTIFY PLAYER</span>
      <div class="art" aria-hidden="true"></div>
      <div class="meta" aria-live="polite"><strong></strong><small></small></div>
      <div class="wave" aria-hidden="true">${[7,14,20,11,16,8].map((n,i) => `<i style="--height:${n}px;--delay:-${i * .17}s"></i>`).join('')}</div>
      <div class="transport" id="playback-options">
        <button class="previous" type="button" aria-label="Previous track" hidden>${icon('previous')}</button>
        <button class="play" type="button" aria-label="Play">${icon('play')}</button>
        <button class="next" type="button" aria-label="Next track" hidden>${icon('next')}</button>
      </div>
      <button class="expand" type="button" aria-label="Expand player" aria-expanded="false" aria-controls="playback-options">${icon('chevron')}</button>
      <span class="playback-state">Paused</span>
    </section></div>`;
    this.#art = this.#root.querySelector('.art');
    this.#track = this.#root.querySelector('strong');
    this.#artist = this.#root.querySelector('small');
    this.#play = this.#root.querySelector('.play');
    this.#wave = this.#root.querySelector('.wave');
    const expand = this.#root.querySelector('.expand');
    const capsule = this.#root.querySelector('.capsule');
    const frame = this.#root.querySelector('.frame');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let morph;
    let reveal;
    const previous = this.#root.querySelector('.previous');
    const next = this.#root.querySelector('.next');
    const setExpanded = open => {
      const from = frame.getBoundingClientRect();
      const fromRadius = getComputedStyle(frame).borderRadius;
      morph?.cancel();
      reveal?.cancel();
      frame.classList.remove('morphing');
      capsule.style.width = '';
      expand.setAttribute('aria-expanded', String(open));
      expand.setAttribute('aria-label', open ? 'Collapse player' : 'Expand player');
      frame.classList.toggle('expanded', open);
      previous.hidden = !open;
      next.hidden = !open;
      if (open) capsule.prepend(expand);
      else capsule.insertBefore(expand, capsule.querySelector('.playback-state'));
      expand.focus({preventScroll:true});

      if (reducedMotion.matches) return;
      const to = frame.getBoundingClientRect();
      const toRadius = getComputedStyle(frame).borderRadius;
      // Keep the destination layout anchored while the shell reveals it.
      capsule.style.width = `${capsule.getBoundingClientRect().width}px`;
      frame.classList.add('morphing');
      const duration = open ? 340 : 280;
      morph = frame.animate([
        {width:`${from.width}px`, height:`${from.height}px`, borderRadius:fromRadius},
        {width:`${to.width}px`, height:`${to.height}px`, borderRadius:toRadius},
      ], {duration, easing:'cubic-bezier(.22,.72,.25,1)'});
      reveal = capsule.animate([
        {opacity:.15},
        {opacity:1},
      ], {duration:duration * .7, easing:'ease-out'});
      morph.addEventListener('finish', () => {
        frame.classList.remove('morphing');
        capsule.style.width = '';
      }, {once:true});
    };
    expand.addEventListener('click', () => setExpanded(!frame.classList.contains('expanded')));
    this.#root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && frame.classList.contains('expanded')) {
        setExpanded(false);
      }
    });
    this.#play.addEventListener('click', () => this.#emit(this.#playing ? 'pause' : 'play'));
    previous.addEventListener('click', () => this.#emit('previous'));
    next.addEventListener('click', () => this.#emit('next'));
  }

  #emit(action) {
    this.dispatchEvent(new CustomEvent('playback-action', {detail:{action}, bubbles:true, composed:true}));
  }

  set track({title, artist, artworkUrl, artworkHue = 270}) {
    this.#track.textContent = title;
    this.#artist.textContent = artist;
    if (artworkUrl) {
      const img = document.createElement('img');
      img.src = artworkUrl;
      img.alt = '';
      this.#art.replaceChildren(img);
      return;
    }
    const hue = Number.isFinite(artworkHue) ? artworkHue : 270;
    this.#art.innerHTML = `<svg viewBox="0 0 44 44" preserveAspectRatio="xMidYMid slice"><rect width="44" height="44" fill="hsl(${hue} 30% 18%)"/>
      <circle cx="25" cy="20" r="15" fill="hsl(${hue} 66% 68%)"/>
      <path d="M0 28 14 13l15 19 15-8v20H0z" fill="hsl(${hue + 28} 40% 40%)"/>
      <path d="m0 37 13-9 12 8 19-9v17H0z" fill="hsl(${hue + 70} 40% 21%)"/>
      <path d="M5 13h13M24 26h14M5 32h17" stroke="#fff" opacity=".53" stroke-width=".6"/></svg>`;
  }

  set playing(value) {
    this.#playing = Boolean(value);
    this.#play.setAttribute('aria-label', this.#playing ? 'Pause' : 'Play');
    this.#play.innerHTML = icon(this.#playing ? 'pause' : 'play');
    this.#wave.classList.toggle('playing', this.#playing);
    this.#root.querySelector('.playback-state').textContent = this.#playing ? 'Playing' : 'Paused';
  }
}
customElements.define('spotify-capsule', SpotifyCapsule);
