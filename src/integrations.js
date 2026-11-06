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

    /* Timed events from your calendars that are switched on in Google Calendar, between two times.
       All-day events, cancelled ones, ones you declined, and ones marked "free" are left out. */
    async calendarEvents(from, to) {
      const list = await api('google', 'GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?' + qs({ minAccessRole: 'reader', maxResults: 50 }));
      const cals = (list.items || []).filter(c => c.selected || c.primary);
      const out = [];
      for (const cal of cals) {
        let pageToken = '';
        do {
          const res = await api('google', 'GET', `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?` +
            qs({ singleEvents: 'true', orderBy: 'startTime', timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), maxResults: 250, ...(pageToken ? { pageToken } : {}) }));
          for (const ev of res.items || []) {
            if (ev.status === 'cancelled' || !ev.start || !ev.start.dateTime || ev.transparency === 'transparent') continue;
            if ((ev.attendees || []).some(a => a.self && a.responseStatus === 'declined')) continue;
            const start = Date.parse(ev.start.dateTime), end = Date.parse(ev.end.dateTime);
            out.push({ id: `g-${cal.id}-${ev.id}`, title: ev.summary || 'Busy', start, dur: Math.max(5, Math.round((end - start) / MIN)), cat: guessCat(ev.summary || ''), source: 'Google Calendar' });
          }
          pageToken = res.nextPageToken || '';
        } while (pageToken);
      }
      // The same meeting on two calendars should be one blob.
      const seen = new Set();
      return out.sort((a, b) => a.start - b.start).filter(e => { const k = `${e.title}|${e.start}|${e.dur}`; if (seen.has(k)) return false; seen.add(k); return true; });
    },

    async playlists() {
      const res = await api('spotify', 'GET', 'https://api.spotify.com/v1/me/playlists?limit=50');
      return (res.items || []).filter(Boolean).map(p => ({ uri: p.uri, name: p.name }));
    },
    async play(uri) {
      try { await api('spotify', 'PUT', 'https://api.spotify.com/v1/me/player/play', uri ? { context_uri: uri } : undefined); }
      catch (e) { throw new Error(/NO_ACTIVE_DEVICE|404/.test(String(e)) ? 'Open Spotify on this Mac (or any device) first, then try again.' : /PREMIUM|403/.test(String(e)) ? 'Spotify only lets apps control playback on Premium accounts.' : String(e)); }
    },
    pause: () => api('spotify', 'PUT', 'https://api.spotify.com/v1/me/player/pause').catch(() => {}),
  };
  window.BlobLinks = Links;
})();
