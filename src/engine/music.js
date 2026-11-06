/* What plays when: the music plan, kept apart from the UI so it can be tested.
   A plan maps each kind of blob to a choice, lets single blobs override it, and has a few rules.
   A choice is one of:
     { type: 'list',   uri, name }   a playlist, Liked Songs, or an artist ("artist radio")
     { type: 'keep' }                leave whatever is playing alone
     { type: 'silent' }              no music for this blob
   Nothing here talks to Spotify; it only decides. */
(function (root) {
  const KINDS = ['creative', 'email', 'project', 'fitness', 'meal', 'meeting'];
  const KEEP = { type: 'keep' }, SILENT = { type: 'silent' };

  const defaultRules = () => ({ start: true, pause: true, timeUp: 'pause', respect: false, shuffle: true });

  function defaultPlan() {
    return { kinds: { meeting: { ...SILENT } }, blobs: {}, rules: defaultRules() };
  }

  /* Read whatever was saved: the plan, or the first version's { on, map: { cat: uri } } with names
     looked up from a playlist list when one is given. */
  function migrate(saved, playlists = []) {
    if (saved && saved.kinds && saved.rules) {
      return { kinds: { ...saved.kinds }, blobs: { ...(saved.blobs || {}) }, rules: { ...defaultRules(), ...saved.rules } };
    }
    const plan = defaultPlan();
    if (saved && typeof saved === 'object') {
      if (saved.on === false) plan.rules.start = false;
      for (const [cat, uri] of Object.entries(saved.map || {})) {
        if (!uri) { plan.kinds[cat] = { ...SILENT }; continue; }
        const p = playlists.find(x => x.uri === uri);
        plan.kinds[cat] = { type: 'list', uri, name: p ? p.name : 'Your playlist' };
      }
    }
    return plan;
  }

  /* The choice for one blob: its own pick, else its kind's, else leave the music alone. */
  function choiceFor(plan, blob) {
    if (!blob) return KEEP;
    return (plan.blobs && plan.blobs[blob.id]) || (plan.kinds && plan.kinds[blob.cat]) || KEEP;
  }

  /* What to do when a blob's timer starts.
     playback: what Spotify says is happening ({ playing, contextUri }) or null if unknown.
     Returns { do: 'play', uri, name, shuffle } | { do: 'pause' } | { do: 'nothing', why }. */
  function onStart(plan, blob, playback) {
    if (!plan.rules.start) return { do: 'nothing', why: 'off' };
    const c = choiceFor(plan, blob);
    if (c.type === 'keep') return { do: 'nothing', why: 'keep' };
    if (c.type === 'silent') return playback && playback.playing ? { do: 'pause' } : { do: 'nothing', why: 'silent' };
    if (playback && playback.playing && playback.contextUri === c.uri) return { do: 'nothing', why: 'already' };
    if (plan.rules.respect && playback && playback.playing) return { do: 'nothing', why: 'respect', name: c.name };
    return { do: 'play', uri: c.uri, name: c.name, shuffle: !!plan.rules.shuffle };
  }

  /* Timer paused, resumed, or ran out. Only touches music BLOB started, so music you put on
     yourself is never paused by the timer. */
  function onTimer(plan, event, startedByBlob) {
    if (!startedByBlob) return 'nothing';
    if (event === 'pause') return plan.rules.pause ? 'pause' : 'nothing';
    if (event === 'resume') return plan.rules.pause ? 'resume' : 'nothing';
    if (event === 'end') return plan.rules.timeUp === 'pause' ? 'pause' : 'nothing';
    return 'nothing';
  }

  /* Artist radio: Spotify no longer gives new apps its own radio playlists, so BLOB plays the
     artist and Spotify's Autoplay carries on with similar music. */
  const artistChoice = a => ({ type: 'list', uri: a.uri, name: `${a.name} radio`, artist: true });

  const label = c => !c || c.type === 'keep' ? "Keep what's playing" : c.type === 'silent' ? 'Silence' : c.name;

  const api = { KINDS, KEEP, SILENT, defaultPlan, defaultRules, migrate, choiceFor, onStart, onTimer, artistChoice, label };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BlobMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
