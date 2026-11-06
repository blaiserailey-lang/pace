import {jellyArt, jellyStyles} from './jelly.js';

export class BrainBlob extends HTMLElement {
  #state = 'idle';
  #title;
  #summary;
  #clock;
  #segments;
  #toggle;
  #complete;

  constructor() {
    super();
    const root = this.attachShadow({mode:'open'});
    root.innerHTML = `<style>${jellyStyles}
      .material{--drift-period:8s;--drift-delay:-2s}
      .content{position:absolute;inset:13% 14% 10%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:clamp(3px,1vw,8px);text-align:center;text-shadow:0 1px 6px #14220c}
      .label{color:#e1ffb1;font-size:9px;letter-spacing:.17em;font-weight:800}
      .label::before{content:"";display:inline-block;width:5px;height:5px;margin:0 6px 2px 0;border-radius:50%;background:#dbff94;box-shadow:0 0 7px #bbff78}
      .clock{font-size:clamp(33px,5vw,65px);font-weight:590;font-variant-numeric:tabular-nums;letter-spacing:-.085em;line-height:.96;padding-right:.07em}
      .segments{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;width:min(148px,75%);margin:3px 0 2px}
      .segments i{height:3px;background:#ddffb044;border-radius:10px}.segments .lit{background:#ddffa5;box-shadow:0 0 4px #d5ff8a72}
      h2,p{margin:0}h2{font-size:clamp(15px,2vw,23px);font-weight:720;letter-spacing:-.04em;line-height:1.05;overflow-wrap:anywhere}
      p{font-size:clamp(10px,1vw,13px);line-height:1.2;color:#f0f9df;max-width:100%;overflow-wrap:anywhere}
      .actions{display:flex;gap:7px;margin-top:2px}
      button{border:1px solid #e8ffc379;border-radius:20px;min-height:32px;padding:4px 11px;font-size:11px;font-weight:740;background:#17230fc9;color:#f2ffe4;white-space:nowrap}
      button:first-child{background:#dafb9b;color:#17260c;border-color:#f0ffd7}
      button:hover:not(:disabled){filter:brightness(1.19)}
      button:active:not(:disabled){transform:scale(.94)}
      button:disabled{cursor:default;opacity:.76}
    </style><div class="shell"><div class="material">${jellyArt('lime', 2)}</div>
      <section class="content" aria-label="Focus timer">
        <span class="label">BRAIN BLOB</span>
        <time class="clock" role="timer" aria-live="off">25:00</time>
        <div class="segments" role="progressbar" aria-label="Focus session progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${'<i class="lit"></i>'.repeat(12)}</div>
        <h2></h2><p></p>
        <div class="actions"><button class="toggle" type="button">▶ Start</button><button class="complete" type="button">✓ Complete</button></div>
      </section>
    </div>`;
    this.#title = root.querySelector('h2');
    this.#summary = root.querySelector('p');
    this.#clock = root.querySelector('.clock');
    this.#segments = root.querySelector('.segments');
    this.#toggle = root.querySelector('.toggle');
    this.#complete = root.querySelector('.complete');
    this.#toggle.addEventListener('click', () => this.#emit(this.#state === 'running' ? 'pause' : 'start'));
    this.#complete.addEventListener('click', () => this.#emit('complete'));
  }

  #emit(action) {
    this.dispatchEvent(new CustomEvent('focus-action', {detail:{action}, bubbles:true, composed:true}));
  }

  focusControls() {
    this.#toggle.focus();
  }

  set task(task) {
    this.#title.textContent = task.title;
    this.#summary.textContent = task.summary;
  }

  set timer({remainingSeconds, durationSeconds, state}) {
    const seconds = Math.max(0, Math.ceil(remainingSeconds));
    const remainingRatio = durationSeconds > 0 ? Math.min(1, seconds / durationSeconds) : 0;
    this.#state = state;
    this.#clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
    this.#clock.dateTime = `PT${seconds}S`;
    this.#segments.setAttribute('aria-valuenow', Math.round((1 - remainingRatio) * 100));
    Array.from(this.#segments.children).forEach((segment, i) => segment.classList.toggle('lit', i < Math.ceil(remainingRatio * 12)));
    this.#toggle.textContent = {idle:'▶ Start', running:'Ⅱ Pause', paused:'▶ Resume', complete:'▶ Restart'}[state];
    this.#complete.textContent = state === 'complete' ? '✓ Completed' : '✓ Complete';
    this.#complete.disabled = state === 'complete';
  }
}

customElements.define('brain-blob', BrainBlob);
