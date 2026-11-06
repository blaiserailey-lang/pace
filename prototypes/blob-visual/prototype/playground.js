import './jelly.js';
import './brain-blob.js';
import './elastic-string.js';
import './spotify-capsule.js';

const tasks = [
  {id:'inbox', time:'09:00 AM', title:'Inbox sweep', category:'Admin', summary:'Triage new mail and flag replies.', tone:'violet', profile:0, durationSeconds:900},
  {id:'standup', time:'10:00 AM', title:'Team sync', category:'Meeting', summary:'Share progress and surface blockers.', tone:'rose', profile:1, durationSeconds:1200},
  {id:'brain', time:'11:00 AM', title:'Deep work', category:'Focus', summary:'Sketch the first dashboard concepts.', durationSeconds:1500},
  {id:'review', time:'01:30 PM', title:'Design review', category:'Project', summary:'Review the latest concept and capture notes.', tone:'blue', profile:3, durationSeconds:1800},
  {id:'wrap', time:'03:00 PM', title:'Wrap notes', category:'Planning', summary:'Capture decisions and tomorrow’s first step.', tone:'amber', profile:1, durationSeconds:600},
];

const timeline = document.querySelector('#timeline');
const brain = document.querySelector('#brain');
const status = document.querySelector('#announcement');
const strand = timeline.querySelector('elastic-string');
const resetFocus = document.querySelector('#reset-focus');
const nodes = tasks.map((task, index) => {
  const node = document.getElementById(task.id);
  node.task = task;
  node.style.setProperty('--drift-delay', `-${index * 1.2}s`);
  node.style.setProperty('--drift-period', `${6.3 + index * .45}s`);
  return node;
});
strand.nodes = nodes;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let visible = true;
let frame = 0;
let lastFrame = 0;

function drift(now) {
  if (now - lastFrame >= 1000 / 32) {
    nodes.forEach((node, index) => {
      const y = Math.sin(now / (1150 + index * 160) + index) * 4;
      node.style.translate = `0 ${y.toFixed(2)}px`;
    });
    strand.refresh();
    lastFrame = now;
  }
  frame = requestAnimationFrame(drift);
}

function syncMotion() {
  cancelAnimationFrame(frame);
  if (reducedMotion.matches) {
    nodes.forEach(node => { node.style.translate = ''; });
    strand.refresh();
  } else if (visible && !document.hidden) {
    frame = requestAnimationFrame(drift);
  }
}

new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
  syncMotion();
}).observe(timeline);
reducedMotion.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', syncMotion);

let current = tasks[2];
let remainingSeconds = current.durationSeconds;
let state = 'idle';
let deadline = 0;
let pausedMilliseconds = 0;
let ticker = 0;
let lastRenderedSeconds;

function renderTimer() {
  brain.timer = {remainingSeconds, durationSeconds:current.durationSeconds, state};
  lastRenderedSeconds = remainingSeconds;
}

function complete() {
  clearInterval(ticker);
  remainingSeconds = 0;
  state = 'complete';
  renderTimer();
  status.textContent = `${current.title} focus session completed.`;
}

function tick() {
  remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  if (!remainingSeconds) complete();
  else if (lastRenderedSeconds !== remainingSeconds) renderTimer();
}

function selectTask(task) {
  clearInterval(ticker);
  current = task;
  remainingSeconds = task.durationSeconds;
  pausedMilliseconds = remainingSeconds * 1000;
  state = 'idle';
  brain.task = task;
  resetFocus.hidden = task.id === 'brain';
  renderTimer();
}

selectTask(current);
timeline.addEventListener('task-select', event => {
  if (event.detail.id === current.id) return;
  selectTask(event.detail);
  status.textContent = `${current.title} is now in focus.`;
});

resetFocus.addEventListener('click', () => {
  selectTask(tasks[2]);
  brain.focusControls();
  status.textContent = 'Deep work is now in focus.';
});

brain.addEventListener('focus-action', ({detail:{action}}) => {
  if (action === 'start' && state !== 'running') {
    if (state === 'complete') {
      remainingSeconds = current.durationSeconds;
      pausedMilliseconds = remainingSeconds * 1000;
    }
    deadline = Date.now() + pausedMilliseconds;
    state = 'running';
    ticker = setInterval(tick, 250);
    renderTimer();
  } else if (action === 'pause' && state === 'running') {
    tick();
    if (state === 'complete') return;
    pausedMilliseconds = Math.max(0, deadline - Date.now());
    clearInterval(ticker);
    state = 'paused';
    renderTimer();
  } else if (action === 'complete') {
    complete();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state === 'running') tick();
});

const tracks = [
  {title:'Soft Signal', artist:'Still Hours', artworkHue:277},
  {title:'Quiet Current', artist:'Low Atlas', artworkHue:179},
  {title:'Night Window', artist:'Afterglow FM', artworkHue:16},
];
const player = document.querySelector('spotify-capsule');
let trackIndex = 0;
player.track = tracks[trackIndex];
player.addEventListener('playback-action', ({detail:{action}}) => {
  if (action === 'play' || action === 'pause') {
    player.playing = action === 'play';
    return;
  }
  const direction = action === 'next' ? 1 : -1;
  trackIndex = (trackIndex + direction + tracks.length) % tracks.length;
  player.track = tracks[trackIndex];
});
