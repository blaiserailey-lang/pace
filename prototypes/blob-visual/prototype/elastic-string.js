export class ElasticString extends HTMLElement {
  #nodes = [];
  #path;
  #observer = new ResizeObserver(() => this.refresh());

  constructor() {
    super();
    const root = this.attachShadow({mode:'open'});
    root.innerHTML = `<style>:host{display:block;pointer-events:none}svg{display:block;width:100%;height:100%;overflow:visible}</style>
      <svg aria-hidden="true">
        <defs>
          <linearGradient id="strand" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse" spreadMethod="reflect" gradientTransform="scale(1 7)">
            <stop stop-color="#baa6ed"/><stop offset="1" stop-color="#746590"/>
          </linearGradient>
          <path id="curve"/>
        </defs>
        <g fill="none" stroke-linecap="round">
          <use href="#curve" stroke="#a394c8" stroke-width="10" opacity=".08"/>
          <use href="#curve" stroke="#a496cb" stroke-width="5" opacity=".29"/>
          <use href="#curve" stroke="url(#strand)" stroke-width="3" opacity=".68"/>
          <use href="#curve" stroke="#f1e6ff" stroke-width=".75" opacity=".54" transform="translate(0 -.85)"/>
        </g>
      </svg>`;
    this.#path = root.querySelector('#curve');
  }

  connectedCallback() {
    this.#observe();
  }

  disconnectedCallback() {
    this.#observer.disconnect();
  }

  set nodes(nodes) {
    this.#nodes = Array.from(nodes);
    if (this.isConnected) this.#observe();
  }

  #observe() {
    this.#observer.disconnect();
    this.#observer.observe(this);
    for (const node of this.#nodes) this.#observer.observe(node);
    this.refresh();
  }

  refresh() {
    const bounds = this.getBoundingClientRect();
    const centers = this.#nodes.map(node => {
      const box = node.getBoundingClientRect();
      return {x:box.left - bounds.left + box.width / 2, y:box.top - bounds.top + box.height / 2, rx:box.width * .32, ry:box.height * .31};
    });
    const edge = (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx / from.rx, dy / from.ry);
      const scale = distance > 0 ? Math.min(.42, 1 / distance) : 0;
      return {x:from.x + dx * scale, y:from.y + dy * scale};
    };
    const segments = centers.slice(1).map((next, index) => {
      const prior = centers[index];
      if (!prior.rx || !next.rx) return '';
      const a = edge(prior, next);
      const b = edge(next, prior);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const sag = Math.min(27, Math.hypot(dx, dy) * .18);
      return `M ${a.x} ${a.y} C ${a.x + dx * .42} ${a.y + sag}, ${b.x - dx * .42} ${b.y + sag}, ${b.x} ${b.y}`;
    });
    this.#path.setAttribute('d', segments.join(' '));
  }
}
customElements.define('elastic-string', ElasticString);
