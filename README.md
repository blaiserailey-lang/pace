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

Until Google sign-in lands, BLOB opens on a labeled sample day with a demo clock that starts at 9:20am. The calendar, inbox and tasks are made up. In Settings you can switch to the real clock, import an `.ics` file, or paste Google Calendar's secret iCal link (live sync works in the Mac app).

## Get the app

Every push to `main` builds a universal Mac app. Open the latest run under **Actions → Build**, download **Pace-mac**, and open the `.dmg`. The app isn't signed yet, so the first time, right-click **BLOB** in Applications and choose **Open**.

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
