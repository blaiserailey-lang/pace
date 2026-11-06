/* Google Calendar and Spotify, through the Mac app's native bridge (src-tauri/src/oauth.rs).
   Sign-in uses your own client IDs (see README → Connections). Tokens stay in the macOS Keychain;
   this file only asks the native side to call an allow-listed API. In a plain browser these are off. */
(function () {
  const tauri = window.__TAURI__;
  const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
  const MIN = 60000;

  const SCOPES = {
    google: ['https://www.googleapis.com/auth/calendar.readonly'],
    spotify: ['user-modify-playback-state', 'user-read-playback-state', 'playlist-read-private', 'playlist-read-collaborative'],
  };
  const api = (provider, method, url, body) => invoke('api_request', { provider, method, url, body: body ?? null });
  const qs = o => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  // Calendar titles that hint at a category. Anything else counts as a meeting.
  const guessCat = t => /gym|workout|run\b|yoga|swim|doctor|dentist|family|kids|personal|walk/i.test(t) ? 'fitness'
    : /lunch|dinner|breakfast|coffee/i.test(t) ? 'meal' : /studio|session|mix|write|record/i.test(t) ? 'creative' : 'meeting';

  const Links = {
    available: !!tauri,
    redirectUri: 'http://127.0.0.1:53682/callback',
    status: p => tauri ? invoke('oauth_status', { provider: p }) : Promise.resolve(false),
    connect: (p, clientId, clientSecret) => invoke('oauth_connect', { provider: p, clientId, clientSecret: clientSecret || null, scopes: SCOPES[p] }),
    disconnect: p => invoke('oauth_disconnect', { provider: p }),

    /* The calendars on one Google account (provider "google" or "google:<id>" for extra accounts). */
    async calendars(p) {
      const list = await api(p, 'GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?' + qs({ minAccessRole: 'reader', maxResults: 100 }));
      return (list.items || []).map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, selected: !!c.selected, color: c.backgroundColor || '#888' }));
    },

    /* Timed events from the given calendars between two times. All-day events, cancelled ones,
       ones you declined, and ones marked "free" are left out. */
    async calendarEvents(p, calIds, from, to) {
      const out = [];
      for (const calId of calIds) {
        let pageToken = '';
        do {
          const res = await api(p, 'GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?` +
            qs({ singleEvents: 'true', orderBy: 'startTime', timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), maxResults: 250, ...(pageToken ? { pageToken } : {}) }));
          for (const ev of res.items || []) {
            if (ev.status === 'cancelled' || !ev.start || !ev.start.dateTime || ev.transparency === 'transparent') continue;
            if ((ev.attendees || []).some(a => a.self && a.responseStatus === 'declined')) continue;
            const start = Date.parse(ev.start.dateTime), end = Date.parse(ev.end.dateTime);
            out.push({ id: `g-${calId}-${ev.id}`, title: ev.summary || 'Busy', start, dur: Math.max(5, Math.round((end - start) / MIN)), cat: guessCat(ev.summary || ''), calendar: calId });
          }
          pageToken = res.nextPageToken || '';
        } while (pageToken);
      }
      return out.sort((a, b) => a.start - b.start);
    },

    async playlists() {
      const res = await api('spotify', 'GET', 'https://api.spotify.com/v1/me/playlists?limit=50');
      return (res.items || []).filter(Boolean).map(p => ({ uri: p.uri, name: p.name, art: ((p.images || []).slice(-1)[0] || {}).url || '' }));
    },
    async play(uri) {
      try { await api('spotify', 'PUT', 'https://api.spotify.com/v1/me/player/play', uri ? { context_uri: uri } : undefined); }
      catch (e) { throw new Error(/NO_ACTIVE_DEVICE|404/.test(String(e)) ? 'Open Spotify on this Mac (or any device) first, then try again.' : /PREMIUM|403/.test(String(e)) ? 'Spotify only lets apps control playback on Premium accounts.' : String(e)); }
    },
    pause: () => api('spotify', 'PUT', 'https://api.spotify.com/v1/me/player/pause').catch(() => {}),

    /* What's playing on your Spotify right now, or null when nothing is. Works on free accounts too. */
    async nowPlaying() {
      const r = await api('spotify', 'GET', 'https://api.spotify.com/v1/me/player?additional_types=episode');
      if (!r || typeof r !== 'object') return null;
      const it = r.item || {};
      const imgs = (it.album && it.album.images) || it.images || [];
      return {
        playing: !!r.is_playing,
        title: it.name || '',
        artist: (it.artists || []).map(a => a.name).join(', ') || (it.show && it.show.name) || '',
        art: (imgs.find(i => i.width && i.width <= 300) || imgs[0] || {}).url || '',
        progress: r.progress_ms || 0, duration: it.duration_ms || 0,
        contextUri: (r.context && r.context.uri) || '',
        device: r.device ? r.device.name : '',
        shuffle: !!r.shuffle_state,
        at: Date.now(),
      };
    },
    control: async (what) => {
      const url = { next: 'next', prev: 'previous' }[what];
      try { await api('spotify', 'POST', `https://api.spotify.com/v1/me/player/${url}`); }
      catch (e) { throw new Error(/NO_ACTIVE_DEVICE|404/.test(String(e)) ? 'Open Spotify on this Mac (or any device) first, then try again.' : /PREMIUM|403/.test(String(e)) ? 'Spotify only lets apps control playback on Premium accounts.' : String(e)); }
    },
    shuffle: on => api('spotify', 'PUT', `https://api.spotify.com/v1/me/player/shuffle?state=${on ? 'true' : 'false'}`).catch(() => {}),
    /* Artists for "artist radio". */
    async searchArtists(q) {
      const res = await api('spotify', 'GET', 'https://api.spotify.com/v1/search?' + qs({ q, type: 'artist', limit: 5 }));
      return ((res.artists && res.artists.items) || []).filter(Boolean).map(a => ({ uri: a.uri, name: a.name, art: ((a.images || []).slice(-1)[0] || {}).url || '' }));
    },
    /* Liked Songs plays as the account's "collection". */
    async likedSongs() {
      const me = await api('spotify', 'GET', 'https://api.spotify.com/v1/me');
      return me && me.id ? { uri: `spotify:user:${me.id}:collection`, name: 'Liked Songs' } : null;
    },
  };
  window.BlobLinks = Links;
})();
