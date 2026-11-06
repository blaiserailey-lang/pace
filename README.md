# Blobs

Your day as a stack of squishy jelly blobs, for the Mac.

The big blob at the top is what you're doing right now. It shows the task and a countdown, and it takes on that task's color. Run your mouse across it to push it around, or poke it. Tap it to open the rest of today's blobs, where you can add, edit, drag to rearrange, or shuffle your day. When a blob's time is up it pops and the next one flows in, until there are no blobs left.

## How the day is built

- **Projects** have a due date and hours left. Blobs works back from each deadline (hours left ÷ days left) and rotates focus blobs between projects so none gets starved.
- **Calendar events** keep their real times, and focus blobs and breaks fill the gaps. Import a `.ics` file, or paste Google Calendar's "secret address in iCal format" to sync (live sync works in the Mac app).
- **Breaks**: snack breaks between focus blobs, a chill break every third one, and a meal at your chosen time.

## Color system

| Kind | Colors |
| --- | --- |
| Work projects | Cool hues: blue, violet, teal, sky, purple, sea green. After six projects, two-color gradients of those. |
| Personal projects | Warm hues: coral, pink, orange, then warm gradients. |
| Meetings | Indigo to slate gradient |
| Personal events | Soft coral gradient |
| Snack / Chill / Meal | Lime jelly / mint / lime to yellow |

Tap a project's color dot in Set up your day to pick a different one.

## Also

- Menu-bar countdown and a notification when each blob ends, even with the window closed (quit from the menu-bar icon).
- Sound packs (Bloop, Soft chimes, Crisp beeps), plus your own sound bites and catchphrases for each moment.
- Check in: a quick status update, and an automatic one halfway through each focus blob.

## Get the app

Every push to `main` builds a universal Mac app. Open the latest run under **Actions → Build**, download **Pace-mac**, and open the `.dmg`. The app isn't signed yet, so the first time, right-click **Blobs** in Applications and choose **Open**.

## Develop

Needs Node 22 and Rust (stable).

```sh
npm install
npm run dev        # run the app with live reload
npm run build      # build for this machine
cargo test --manifest-path src-tauri/Cargo.toml
```

- `src/` is the UI in plain HTML, CSS and JS with no build step. `jelly.js` is the soft-body blob, `app.js` the planner and timer, and `sounds.js` the sound bites.
- `src-tauri/` is the native shell (Tauri 2): menu-bar countdown, notifications, calendar fetch, and keep-running-when-closed.

## Roadmap

- Google Calendar sign-in (OAuth) in addition to the iCal link
- Spotify playback that follows the active blob's mix
- Signed and notarized builds
