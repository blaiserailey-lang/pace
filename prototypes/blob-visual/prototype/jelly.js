const palettes = {
  violet: ['#e7c8ff', '#a76af2', '#6936a9', '#25183f', '#9d57ed'],
  rose: ['#ffd4ef', '#f288c2', '#a64283', '#441f43', '#ee72b6'],
  lime: ['#efffc7', '#a9e74c', '#658c2b', '#2b4017', '#a6ee48'],
  blue: ['#c9eaff', '#6bb7fa', '#315dba', '#172950', '#5e9aef'],
  amber: ['#ffedc6', '#ffc379', '#ad6540', '#482c31', '#f69d65'],
};

const profiles = [
  'M31 97C38 65 57 64 81 44C104 24 122 16 150 25C177 34 185 26 211 25C243 24 247 49 268 65C289 81 303 97 298 126C294 149 275 157 266 177C254 207 230 225 196 220C166 216 156 238 126 229C103 222 93 207 69 202C39 196 20 173 27 145C32 124 26 118 31 97Z',
  'M27 107C33 86 58 82 67 63C83 31 113 22 142 33C170 45 181 26 209 30C238 34 242 51 266 63C297 80 306 110 290 136C275 160 282 175 260 197C237 219 210 209 189 220C164 233 141 236 119 222C98 207 85 219 64 208C39 195 32 171 37 151C42 131 22 127 27 107Z',
  'M20 119C20 86 39 69 64 59C86 50 87 33 111 26C138 17 152 29 170 28C195 26 211 18 234 34C251 46 254 63 271 71C296 83 308 104 301 132C295 155 284 158 279 183C272 211 250 229 221 225C200 222 184 239 161 239C135 239 129 227 105 227C77 228 61 217 54 195C48 175 27 168 22 149C19 140 20 129 20 119Z',
  'M29 116C29 94 45 81 62 73C82 63 79 39 110 32C137 24 150 38 170 31C202 20 220 27 233 44C245 61 271 57 287 79C304 102 289 119 290 140C291 165 289 188 261 198C235 206 223 195 202 216C181 235 151 231 129 221C108 211 97 220 75 210C50 199 46 179 44 164C42 144 30 139 29 116Z',
];

const bubbles = [
  [66,97,8],[80,82,3],[91,105,3],[239,77,9],[252,93,3],[263,113,5],
  [56,146,4],[73,169,10],[96,192,5],[219,191,3],[248,176,7],[265,150,3],
  [115,61,5],[199,60,4],[128,203,3],[193,211,7],[228,99,2],[58,125,2],
];

let sequence = 0;

export function jellyArt(tone, profile = 0) {
  const [light, mid, depth, dark, glow] = palettes[tone] ?? palettes.violet;
  const shape = profiles[profile] ?? profiles[0];
  const id = 'jelly-' + ++sequence;
  const url = name => `url(#${id}-${name})`;
  return `<svg viewBox="0 0 320 260" aria-hidden="true" focusable="false" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${id}-body" x2=".24" y2="1">
        <stop stop-color="${mid}" stop-opacity=".87"/><stop offset=".27" stop-color="${depth}" stop-opacity=".82"/>
        <stop offset=".59" stop-color="${dark}" stop-opacity=".89"/><stop offset=".8" stop-color="${depth}" stop-opacity=".82"/>
        <stop offset="1" stop-color="${glow}" stop-opacity=".85"/>
      </linearGradient>
      <linearGradient id="${id}-rim" x1=".18" x2=".78" y2="1">
        <stop stop-color="${light}"/><stop offset=".26" stop-color="${mid}"/><stop offset=".55" stop-color="${depth}"/>
        <stop offset=".8" stop-color="${glow}"/><stop offset="1" stop-color="${light}"/>
      </linearGradient>
      <linearGradient id="${id}-shine" x1=".05" x2=".94" y2=".8">
        <stop stop-color="${light}" stop-opacity="0"/><stop offset=".32" stop-color="${light}" stop-opacity=".92"/>
        <stop offset=".66" stop-color="white" stop-opacity=".75"/><stop offset="1" stop-color="${light}" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${id}-caustic" cy=".9" r=".7">
        <stop stop-color="${light}" stop-opacity=".82"/><stop offset=".43" stop-color="${glow}" stop-opacity=".28"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${id}-bubble" cx=".31" cy=".24" r=".75">
        <stop stop-color="${light}" stop-opacity=".8"/><stop offset=".27" stop-color="${mid}" stop-opacity=".4"/><stop offset=".65" stop-color="${dark}" stop-opacity=".42"/><stop offset="1" stop-color="${light}" stop-opacity=".66"/>
      </radialGradient>
      <clipPath id="${id}-clip"><path d="${shape}"/></clipPath>
    </defs>
    <path class="bloom" d="${shape}" fill="none" stroke="${glow}" stroke-width="9"/>
    <path d="${shape}" fill="${url('body')}" stroke="${url('rim')}" stroke-width="2.2"/>
    <g clip-path="${url('clip')}">
      <ellipse cx="159" cy="174" rx="148" ry="61" fill="${url('caustic')}"/>
      <ellipse cx="149" cy="47" rx="96" ry="31" fill="${url('caustic')}" opacity=".52" transform="rotate(-9 149 47)"/>
      <path d="${shape}" fill="none" stroke="${url('rim')}" stroke-width="15" opacity=".43"/>
      <path d="${shape}" fill="none" stroke="${url('shine')}" stroke-width="5" opacity=".92"/>
      <path d="M48 94C65 85 80 66 101 54S132 48 150 48" fill="none" stroke="${url('shine')}" stroke-linecap="round" stroke-width="5" opacity=".88"/>
      <path d="M192 43C214 40 239 54 252 69M172 215C198 208 223 217 247 194M44 138Q46 160 61 175" fill="none" stroke="${url('shine')}" stroke-linecap="round" stroke-width="3.1" opacity=".67"/>
      ${bubbles.map(([x,y,r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${url('bubble')}" stroke="${light}" stroke-opacity=".25" stroke-width=".8" opacity="${i % 3 === 0 ? '.68' : '.47'}"/>`).join('')}
    </g>
  </svg>`;
}

export const jellyStyles = `
  :host{display:block;min-width:0;color:#fff;font-family:inherit}
  *{box-sizing:border-box}
  .shell{position:relative;width:100%;aspect-ratio:320 / 260;isolation:isolate}
  .material{position:absolute;inset:0;z-index:-1;pointer-events:none;animation:float var(--drift-period,6.8s) ease-in-out infinite;animation-delay:var(--drift-delay,0s)}
  .material svg{width:100%;height:100%;overflow:visible}
  .bloom{filter:blur(7px);opacity:.28;transition:opacity 200ms}
  .shell:hover .bloom,.shell:focus-within .bloom{opacity:.53}
  @keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.018,.985)}}
  @media(prefers-reduced-motion:reduce){.material{animation:none}.bloom{transition:none}}
  button{font:inherit;color:inherit;cursor:pointer}
  button:focus-visible{outline:2px solid #f2ffd4;outline-offset:3px}
`;

export class JellyBlob extends HTMLElement {
  #task;
  #art;
  #button;
  #time;
  #title;
  #category;

  constructor() {
    super();
    const root = this.attachShadow({mode:'open'});
    root.innerHTML = `<style>${jellyStyles}
      button{position:absolute;inset:14% 13%;display:grid;align-content:center;justify-items:center;gap:5px;padding:5px 10px;border:0;border-radius:46%;background:none;text-align:center;text-shadow:0 1px 4px #000}
      button:active{transform:scale(.97)}
      .time,.category{font-size:clamp(9px,1vw,11px);font-weight:720;letter-spacing:.10em}
      .time{color:#f9eafa}.title{font-size:clamp(14px,1.5vw,21px);font-weight:700;line-height:1.08;letter-spacing:-.035em;overflow-wrap:anywhere}
      .category{color:#f1e6f5;letter-spacing:.04em}
    </style><div class="shell"><div class="material"></div><button type="button"><span class="time"></span><span class="title"></span><span class="category"></span></button></div>`;
    this.#art = root.querySelector('.material');
    this.#button = root.querySelector('button');
    this.#time = root.querySelector('.time');
    this.#title = root.querySelector('.title');
    this.#category = root.querySelector('.category');
    this.#button.addEventListener('click', () => {
      if (this.#task) this.dispatchEvent(new CustomEvent('task-select', {detail:this.#task, bubbles:true, composed:true}));
    });
  }

  set task(task) {
    this.#task = task;
    this.#art.innerHTML = jellyArt(task.tone, task.profile);
    this.#time.textContent = task.time;
    this.#title.textContent = task.title;
    this.#category.textContent = task.category;
  }
}

customElements.define('jelly-blob', JellyBlob);
