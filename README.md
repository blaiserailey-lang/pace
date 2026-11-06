# BLOB

Your day as a living string of jelly blobs, for the Mac.

The lime **Brain** on the left is your timer. To its right, the **Living Flow** is a horizontal string of glowing jelly blobs joined by elastic strands: calendar events, flexible work sessions, lunch, and deadlines. Click a blob for a short context card, start a timer, or tell Blob what changed ("I'm running 20 min late", "move the inbox sweep to 3pm"). Blob answers with a suggestion, and nothing changes until you press **Approve**. When you approve, the string rearranges itself.

## How planning works

All planning lives in `src/engine/flow.js`, a deterministic engine with unit tests:

- **Calendar events are anchors.** Blob never moves them.
- **Session lengths are yours.** When you add a deadline you choose how many sessions you want and how long each one is. Blob doesn't estimate how long work takes, and nothing stores hours left or percent complete.
- **Suggestions, not surprises.** Every change comes as a proposal with a plain-language reason. Calendar changes, running late, time's up (+15, +30, finish, reschedule) and missed sessions all work this way.
- **Slack is kept.** Blob plans at most 70% of a day's free time on its own, keeps a buffer between blobs, and only picks weekdays.
- **Deadline status comes from you.** Healthy, Needs attention, Critical and Completed are based on your check-ins and on calendar facts, such as a conflict taking the last session before the due date.

## Color system

| Kind | Color |
| --- | --- |
| Brain (timer) | Lime |
| Email & admin | Purple |
| Fitness & personal | Electric blue |
| Meals & breaks | Orange |
| Meetings | Pink |
| Creative | Pale blue |
| Planning & projects | Violet |
| Deadline status | Teal (healthy), amber (needs attention), pink (critical), grey (completed) |

## Sample data

Until you connect a calendar, BLOB opens on a labeled sample day with a demo clock that starts at 9:20am. The calendar, inbox and tasks are made up. Connecting Google Calendar replaces the sample calendar and switches to the real clock. "Remove sample tasks" in Settings clears the rest.

## Connections (Mac app)

BLOB signs in with **your own** Google and Spotify developer apps, so your data only goes between your Mac and those services. Sign-in opens your browser and returns to `http://127.0.0.1:53682/callback`. Refresh tokens are kept in the macOS Keychain.

**Google Calendar (read-only)**

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Google Calendar API**.
2. Under **Google Auth Platform** (OAuth consent screen), choose External, fill in the app name, add yourself as a **test user**, and add the scope `.../auth/calendar.readonly`.
3. Under **Clients**, create an OAuth client of type **Desktop app**. Copy its client ID and client secret.
4. In BLOB, open Settings → Google Calendar, paste both, and press **Connect**.

You can connect **several Google accounts** (add each one as a test user in step 2) and switch individual calendars on or off in Settings. BLOB reads the next 7 days every 5 minutes. All-day events, events marked "free", and events you declined are skipped.

**Calendar links**

Any calendar with an iCal link (Google's secret address, Outlook, iCloud, a shared team calendar) can be added in Settings → Calendar links. Add as many as you like; each can be switched off or removed.

**Spotify (Premium needed for playback control)**

1. At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), create an app. Set the redirect URI to `http://127.0.0.1:53682/callback` and tick **Web API**.
2. Under **User management**, add your Spotify account's email.
3. In BLOB, open Settings → Spotify, paste the client ID and press **Connect**. If you connected before this version, disconnect and connect again so BLOB can see what's playing.

The Spotify player in the bottom-right corner of the stage shows what's playing on your Spotify (any device). Open it with the arrow for the album art, progress, previous and next. Its **What plays when** button (or the playlist name at the top of the open player) sets the music:

- **For each kind of blob**: one of your playlists, Liked Songs, an artist's radio (type the artist's name in the search box), "Keep what's playing", or "Silence". Meetings start as Silence.
- **Just this blob**: give one blob its own music.
- **Rules**: start music with the timer, pause it with the timer, pause or keep playing at time's up, leave alone music you put on yourself, and shuffle.

The timer only ever pauses music BLOB started, and the music buttons never touch the timer. Seeing what's playing works on any account; playing, pausing and skipping need Premium. Spotify no longer lets new apps open its own radio playlists, so artist radio plays the artist and Spotify's Autoplay continues with similar songs.

## Get the app

Download the `.dmg` from the latest [release](https://github.com/blaiserailey-lang/pace/releases/latest).

**Updates:** every push to `main` publishes a new release. BLOB checks for one at launch and every few hours, and shows an **Update** button in the top bar (or use Settings → App updates). Updates are signed with the key in the `TAURI_SIGNING_PRIVATE_KEY` repository secret, and the app only installs bundles signed with it. Builds also stay available under **Actions → Build → Pace-mac**. The app isn't signed yet, so the first time, right-click **BLOB** in Applications and choose **Open**.

## Develop

Needs Node 22 and Rust (stable).

```sh
npm install
npm test           # scheduling engine tests
npm run dev        # run the app with live reload
npm run build      # build for this machine
cargo test --manifest-path src-tauri/Cargo.toml
```

- `src/` is the UI in plain HTML, CSS and JS with no build step. `engine/flow.js` is the scheduler, `jelly.js` the soft-body blob renderer, `app.js` the Brain, Living Flow, context card and helper, and `sounds.js` your sound bites.
- `src-tauri/` is the native shell (Tauri 2): menu-bar countdown, notifications, calendar fetch, and keep-running-when-closed.

## Roadmap

See the architecture doc for phases. Next up: Google Calendar sign-in (read-only), then metadata-only Gmail suggestions.
