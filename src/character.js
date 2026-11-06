/* Character builder: draws the Pace character from a small config so people can make their own.
   Config is saved per user. Mood (mouth shape) and, by default, color still follow the current block. */
const CHAR_DEFAULT = { name: 'Pip', shape: 'blob', color: 'mode', eyes: 'round', addon: 'none' };

const CHAR_OPTIONS = {
  shape: { blob: 'Blob', square: 'Cube', egg: 'Egg', ghost: 'Ghost' },
  eyes: { round: 'Round', dots: 'Dots', sleepy: 'Sleepy', sparkle: 'Sparkle' },
  addon: { none: 'None', headphones: 'Headphones', cap: 'Cap', beanie: 'Beanie', glasses: 'Glasses', shades: 'Shades', crown: 'Crown' },
};
const CHAR_SWATCHES = ['#3d5cff', '#e2366b', '#1f9d6b', '#e08a1e', '#8a5cf0', '#10a5c4', '#2b2f45'];

const BODY = {
  blob: '<path d="M60 14c28 0 44 20 44 50 0 28-18 46-44 46S16 92 16 64c0-30 16-50 44-50z"/>',
  square: '<rect x="18" y="20" width="84" height="88" rx="26"/>',
  egg: '<path d="M60 10c24 0 40 34 40 60 0 24-17 40-40 40S20 94 20 70c0-26 16-60 40-60z"/>',
  ghost: '<path d="M60 14c26 0 42 20 42 46v48l-10-8-10 8-11-8-11 8-11-8-11 8-10-8V60c0-26 16-46 42-46z"/>',
};

function eyesSVG(kind, ids) {
  const pl = ids ? ' id="pl"' : '', pr = ids ? ' id="pr"' : '';
  const ink = '#171a2b';
  switch (kind) {
    case 'dots':
      return `<g class="blink"><circle${pl} cx="47" cy="58" r="5" fill="${ink}"/><circle${pr} cx="75" cy="58" r="5" fill="${ink}"/></g>`;
    case 'sleepy':
      return `<g class="blink"><ellipse cx="46" cy="58" rx="7" ry="6" fill="#fff"/><ellipse cx="74" cy="58" rx="7" ry="6" fill="#fff"/>
        <circle${pl} cx="47" cy="59" r="3.2" fill="${ink}"/><circle${pr} cx="75" cy="59" r="3.2" fill="${ink}"/>
        <path d="M38 56h16M66 56h16" stroke="${ink}" stroke-width="3" stroke-linecap="round"/></g>`;
    case 'sparkle':
      return `<g class="blink"><ellipse cx="46" cy="56" rx="7" ry="9" fill="#fff"/><ellipse cx="74" cy="56" rx="7" ry="9" fill="#fff"/>
        <circle${pl} cx="47" cy="58" r="4.6" fill="${ink}"/><circle${pr} cx="75" cy="58" r="4.6" fill="${ink}"/>
        <circle cx="45" cy="54" r="1.6" fill="#fff"/><circle cx="73" cy="54" r="1.6" fill="#fff"/></g>`;
    default:
      return `<g class="blink"><ellipse cx="46" cy="56" rx="6" ry="8" fill="#fff"/><ellipse cx="74" cy="56" rx="6" ry="8" fill="#fff"/>
        <circle${pl} cx="47" cy="58" r="3.4" fill="${ink}"/><circle${pr} cx="75" cy="58" r="3.4" fill="${ink}"/></g>`;
  }
}

function addonSVG(kind) {
  const ink = 'var(--ink)';
  switch (kind) {
    case 'headphones':
      return `<path d="M20 62Q20 12 60 12T100 62" stroke="${ink}" stroke-width="6" fill="none" stroke-linecap="round"/>
        <rect x="9" y="50" width="16" height="28" rx="7" fill="${ink}"/><rect x="95" y="50" width="16" height="28" rx="7" fill="${ink}"/>`;
    case 'cap':
      return `<path d="M26 36Q28 6 60 6T94 36Z" fill="${ink}"/><path d="M86 33h24q4 0 1 5H84Z" fill="${ink}"/>
        <circle cx="60" cy="8" r="3" fill="var(--panel)"/>`;
    case 'beanie':
      return `<path d="M24 38Q24 4 60 4T96 38Z" fill="var(--hype)"/><rect x="21" y="30" width="78" height="11" rx="5" fill="var(--hype)" stroke="var(--panel)" stroke-width="1.5"/>
        <circle cx="60" cy="4" r="7" fill="var(--hype)" stroke="var(--panel)" stroke-width="1.5"/>`;
    case 'glasses':
      return `<g stroke="${ink}" stroke-width="3" fill="none"><circle cx="46" cy="57" r="11"/><circle cx="74" cy="57" r="11"/><path d="M57 56q3-3 6 0"/></g>`;
    case 'shades':
      return `<path d="M32 48h56v6q-1 12-12 12h-4q-9 0-11-10h-2q-2 10-11 10h-4q-12 0-12-12z" fill="${ink}"/>
        <path d="M38 52h10" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`;
    case 'crown':
      return `<path d="M36 26l6-20 9 12 9-14 9 14 9-12 6 20z" fill="#f4c430" stroke="#c9971b" stroke-width="1.5" stroke-linejoin="round"/>`;
    default:
      return '';
  }
}

/* Returns the inner markup of a 120×120 character SVG.
   withIds=true is for the live desk character (pointer-following pupils and mood mouth). */
function charSVG(cfg, mouth = 'M48 78q12 10 24 0', withIds = false) {
  const c = { ...CHAR_DEFAULT, ...cfg };
  const fill = c.color === 'mode' ? '' : ` style="fill:${/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#3d5cff'}"`;
  const hair = ['none', 'glasses', 'shades'].includes(c.addon) && c.shape !== 'ghost'
    ? '<path d="M44 12q4 -8 10 0" stroke="var(--ink)" stroke-width="3" fill="none" stroke-linecap="round"/>' : '';
  const hidesEyes = c.addon === 'shades';
  return `<g class="bob">
    <ellipse cx="60" cy="114" rx="34" ry="4" fill="var(--line)"/>
    <g class="body"${fill}>${BODY[c.shape] || BODY.blob}</g>
    ${hair}
    ${hidesEyes ? (withIds ? '<g hidden><circle id="pl"/><circle id="pr"/></g>' : '') : eyesSVG(c.eyes, withIds)}
    ${addonSVG(c.addon)}
    <path${withIds ? ' id="mouth"' : ''} d="${mouth}" stroke="#171a2b" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  </g>`;
}

function loadChar() {
  try { return { ...CHAR_DEFAULT, ...(JSON.parse(localStorage.getItem('pace.character')) || {}) }; }
  catch (e) { return { ...CHAR_DEFAULT }; }
}
function saveChar(cfg) { try { localStorage.setItem('pace.character', JSON.stringify(cfg)); } catch (e) {} }
