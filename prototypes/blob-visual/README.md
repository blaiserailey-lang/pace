# BLOB visual rendering playground

Run from this directory with Python 3.

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open [the local playground](http://127.0.0.1:8765/). Select a task, start or pause the countdown, or complete the focus session. The player can play, pause, expand, and skip through its mock track list. Its playback state drives the waveform. It plays no audio.

## Integrate into BLOB

Import the ES modules into BLOB's renderer or bundle them with its existing frontend. These custom elements use native HTML controls, Shadow DOM styles, and SVG artwork. The playground's layout, mock data, and timer controller are isolated in `index.html`, `prototype/playground.css`, and `prototype/playground.js`.

| Module | Element | Inputs | Events |
| --- | --- | --- | --- |
| `prototype/jelly.js` | `<jelly-blob>` | `task = {id, title, time, category, tone, profile}` | `task-select` with the task as `event.detail` |
| `prototype/elastic-string.js` | `<elastic-string>` | `nodes` as an iterable of elements in chronological order | Decorative |
| `prototype/brain-blob.js` | `<brain-blob>` | `task = {title, summary}`, `timer = {remainingSeconds, durationSeconds, state}` | `focus-action` with `{action}` |
| `prototype/spotify-capsule.js` | `<spotify-capsule>` | `track = {title, artist, artworkUrl}`, `playing` as a boolean | `playback-action` with `{action}` |

- Assign object inputs as DOM properties after the modules have loaded. Use a ref when your framework maps custom element inputs to HTML attributes. Events bubble through the Shadow DOM.
- Map scheduled tasks to display values. `time` is a formatted label. Choose `violet`, `rose`, `lime`, `blue`, or `amber` for `tone` and a silhouette from 0 to 3 for `profile`. Assign the element widths in the host layout. Use short display titles and summaries.
- Layer the strand behind the task elements in the same positioned container. Assign `strand.nodes` whenever the ordered list changes. Resize observation handles size changes. Call `strand.refresh()` after a position-only layout change and during drag or movement frames. Keep the strand overlay at the same pixel scale as its node container.
- Feed Brain Blob the current task and timer state from BLOB. Supported states are `idle`, `running`, `paused`, and `complete`. Route `start`, `pause`, and `complete` to BLOB's existing focus actions. The demo resets the mock session when selecting a different task.
- Mount the Spotify capsule outside the strand. Route `play`, `pause`, `previous`, and `next` to the host's playback controller and feed confirmed playback state back through `playing`. An omitted artwork URL uses the built-in abstract thumbnail.
- The material and waveform respect `prefers-reduced-motion`. The playground also disables node drift under that preference and suspends strand updates while the timeline is offscreen or its tab is hidden.
