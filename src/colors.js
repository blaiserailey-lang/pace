/* BLOB colour system.
   Every blob's body colour answers "what is this?", and its rim answers "which calendar did it come from?".
     1. A blob that belongs to a project takes the project's colour. If it also came from a calendar,
        that calendar's colour shows as a band around the edge.
     2. Otherwise a calendar event takes its calendar's colour (personal = blue, session = grey).
     3. Otherwise a blob you made takes its kind's colour (breaks, admin, fitness, creative).
   Some colours are reserved and never fill a blob: lime belongs to the Brain, aqua-into-violet to the music blob, and teal, gold and
   pink only ever mean Deadline Gravity (healthy, needs attention, critical).
   Each colour is a pair [light, deep]; the jelly runs light to deep diagonally. */
(function () {
  // Calendars. Personal and session were picked by blaise; any other calendar gets the next free one.
  const CALENDARS = {
    personal: { label: 'Blue', c: ['#7cc0ff', '#1f5bff'] },
    session:  { label: 'Grey', c: ['#d9dde8', '#5f6679'] },
    lavender: { label: 'Lavender', c: ['#c9b8ff', '#5b3cf0'] },
    sky:      { label: 'Sky', c: ['#9cecff', '#0f8fc4'] },
    rose:     { label: 'Rose', c: ['#ffb3c8', '#c2185b'] },
  };

  // Kinds, for blobs that aren't a project and didn't come from a calendar.
  const KINDS = {
    meal:     { label: 'Breaks & meals',            c: ['#ffc061', '#ff6a00'] },
    email:    { label: 'Email, admin & planning',   c: ['#eaa2ff', '#a21fd6'] },
    fitness:  { label: 'Fitness & health',          c: ['#9dffb4', '#12a84a'] },
    creative: { label: 'Creative',                  c: ['#ffffff', '#d7c4f2'], light: true },
    meeting:  { label: 'Meetings',                  c: CALENDARS.lavender.c },
  };

  /* Projects. Oliver Malcom is solid red. Every new project gets the next two-tone signature that no
     other open project is using, so no two projects ever share a look. Red, blue and grey never
     appear in a signature, so they keep their meaning. */
  const RED = ['#ff7a6b', '#e3141c'];
  const SIGNATURES = [
    { label: 'Sunset', c: ['#ffcf4a', '#e0309f'] },
    { label: 'Ember',  c: ['#ffb347', '#a01870'] },
    { label: 'Meadow', c: ['#ffe36b', '#13a35c'] },
    { label: 'Berry',  c: ['#ff86b0', '#6a24c9'] },
    { label: 'Dusk',   c: ['#ffab78', '#6d35ff'] },
    { label: 'Citrus', c: ['#fff06a', '#ff4f1a'] },
    { label: 'Orchid', c: ['#ffc2f2', '#9b2fd6'] },
  ];
  const PROJECT_COLORS = [{ key: 'red', label: 'Red', c: RED }, ...SIGNATURES.map(s => ({ key: s.label.toLowerCase(), ...s }))];

  const RESERVED = {
    brain:     ['#e0ff5c', '#5fd413'],
    music:     ['#6ef3ff', '#8b5cff'],   // the now-playing blob (Spotify player)
    healthy:   '#19e3c3',
    attention: '#ffd60a',
    critical:  '#ff3d7f',
  };

  const projectColor = key => (PROJECT_COLORS.find(p => p.key === key) || PROJECT_COLORS[1]).c;
  /* The next colour for a new project: red for Oliver Malcom, otherwise the first signature that no
     open project uses. Once all seven are taken, the least used one is shared. */
  function nextProjectColor(title, used) {
    if (/oliver\s*malcom/i.test(title || '') && !used.includes('red')) return 'red';
    const free = SIGNATURES.map(s => s.label.toLowerCase()).filter(k => !used.includes(k));
    if (free.length) return free[0];
    const count = k => used.filter(u => u === k).length;
    return SIGNATURES.map(s => s.label.toLowerCase()).sort((a, b) => count(a) - count(b))[0];
  }
  /* A calendar's default colour from its name: anything called personal is blue, anything called
     session is grey, and the rest take the next free calendar colour. */
  function defaultCalendarColor(name, primary, used) {
    if (/session/i.test(name || '')) return 'session';
    if (/personal/i.test(name || '') || primary) return 'personal';
    return ['lavender', 'sky', 'rose'].find(k => !used.includes(k)) || 'lavender';
  }

  // Dark text on light blobs, white text on the rest, judged from the colour behind the words.
  const lum = h => { const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const isLight = c => (lum(c[0]) + lum(c[1])) / 2 > 0.5;

  window.BlobColors = { CALENDARS, KINDS, PROJECT_COLORS, SIGNATURES, RESERVED, projectColor, nextProjectColor, defaultCalendarColor, isLight };
})();
