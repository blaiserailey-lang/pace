# Pace

A Mac desk timer that paces your day around your deadlines.

List your projects with a due date and the hours left. Pace works back from each deadline (hours left ÷ days left) to build today's run sheet: focus blocks that rotate between projects, snack and chill breaks, a meal, and a quick hype-up after lunch. A little character runs the clock, talks in the personality you pick (Coach, Chill friend, Hype man), and plays its own sounds.

The countdown also lives in the Mac menu bar, and you get a notification when each block ends, even with the window closed. Closing the window keeps the day running; quit from the menu-bar icon.

## Get the app

Every push to `main` builds a universal Mac app. Open the latest run under **Actions → Build**, download **Pace-mac**, and open the `.dmg`.

The app isn't signed yet, so the first time you open it, right-click **Pace** in Applications and choose **Open**.

## Develop

Needs Node 22 and Rust (stable).

```sh
npm install
npm run dev        # run the app with live reload
npm run build      # build for this machine
cargo test --manifest-path src-tauri/Cargo.toml
```

- `src/` is the app UI (plain HTML, CSS and JS, no build step). It was ported from the Phase 1 prototype.
- `src/char3d.js` turns an uploaded picture into a puffy 3D character (three.js, all on-device).
- `src-tauri/` is the native shell (Tauri 2): menu-bar countdown, notifications, keep-running-when-closed.

## Roadmap

- Spotify playback that switches between Work, Chill and Hype mixes
- Sound bites & catchphrases per moment (done in-app; clips stay on your device)
- Optional AI image-to-3D "HD" character
- Launch at login and a start-of-day reminder
- Signed and notarized builds
