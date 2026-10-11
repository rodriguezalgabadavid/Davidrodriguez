import { getExercise } from './data.js';
import { buildTimeline, formatTime, timelineDuration } from './generator.js';
import { askConfirm, escapeHtml } from './ui.js';

// Reproductor a pantalla completa de una sesión de preparación física (temporizador de intervalos).

const player = {
  session: null,
  steps: [],
  index: 0,
  remaining: 0,
  endsAt: 0,
  running: false,
  timer: null,
  done: false,
  sideSwitched: false,
  audio: null,
  wakeLock: null,
  activeMs: 0,
  resumedAt: 0,
  settings: { sound: true },
  onSave: null,
};

const $player = document.getElementById('player');

function beep(freq = 880, duration = 0.12) {
  if (!player.settings.sound || !player.audio) return;
  const ctx = player.audio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function vibrate(pattern) {
  if (player.settings.sound && navigator.vibrate) navigator.vibrate(pattern);
}

async function requestWakeLock() {
  try {
    player.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // No disponible: la pantalla puede apagarse, el temporizador sigue siendo correcto al volver.
  }
}

// settings: { sound }, onSave: callback con la actividad completada { title, focus, level, seconds, rpe }.
export function startPlayer(session, { settings, onSave }) {
  if (!session) return;
  player.settings = settings;
  player.onSave = onSave;
  try {
    player.audio ??= new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    player.audio = null;
  }
  Object.assign(player, { session, steps: buildTimeline(session), done: false, running: false, activeMs: 0 });
  $player.hidden = false;
  document.body.classList.add('no-scroll');
  requestWakeLock();
  goToStep(0, true);
}

function goToStep(index, autoplay = player.running) {
  stopClock();
  player.index = index;
  player.remaining = player.steps[index].seconds;
  player.sideSwitched = false;
  if (autoplay) resume();
  else renderPlayer();
}

// Tiempo realmente entrenado: solo cuenta mientras el temporizador está en marcha.
function stopClock() {
  if (player.running) player.activeMs += Date.now() - player.resumedAt;
  player.running = false;
  clearInterval(player.timer);
}

function resume() {
  player.running = true;
  player.resumedAt = Date.now();
  player.endsAt = Date.now() + player.remaining * 1000;
  clearInterval(player.timer);
  player.timer = setInterval(tick, 200);
  renderPlayer();
}

function pause() {
  stopClock();
  renderPlayer();
}

function tick() {
  const remaining = Math.max(0, Math.ceil((player.endsAt - Date.now()) / 1000));
  if (remaining === player.remaining) return;
  player.remaining = remaining;
  const step = player.steps[player.index];

  if (remaining > 0 && remaining <= 3) beep(660);
  const ex = step.kind === 'work' && getExercise(step.exerciseId);
  if (ex?.sides && !player.sideSwitched && remaining <= Math.floor(step.seconds / 2)) {
    player.sideSwitched = true;
    beep(990, 0.2);
    vibrate(150);
  }

  if (remaining === 0) {
    if (player.index + 1 >= player.steps.length) return finishPlayer();
    const next = player.steps[player.index + 1];
    beep(next.kind === 'work' ? 1200 : 520, 0.3);
    vibrate(next.kind === 'work' ? [100, 60, 100] : 250);
    player.index++;
    player.remaining = next.seconds;
    // Encadenar sobre el final anterior: si la pestaña estuvo en segundo plano, el reloj se pone al día.
    player.endsAt += next.seconds * 1000;
    player.sideSwitched = false;
  }
  renderPlayer();
}

function elapsedSeconds() {
  const before = player.steps.slice(0, player.index).reduce((s, st) => s + st.seconds, 0);
  return before + (player.steps[player.index].seconds - player.remaining);
}

function nextWorkStep(from) {
  return player.steps.slice(from + 1).find((s) => s.kind === 'work');
}

function renderPlayer() {
  if (player.done) return;
  const step = player.steps[player.index];
  const total = timelineDuration(player.steps);
  const progress = (elapsedSeconds() / total) * 100;
  const isWork = step.kind === 'work';
  const ex = isWork ? getExercise(step.exerciseId) : null;
  const upcoming = nextWorkStep(player.index);
  const upcomingEx = upcoming && getExercise(upcoming.exerciseId);
  const stepPct = ((step.seconds - player.remaining) / step.seconds) * 100;
  const showSwitch = ex?.sides && player.sideSwitched;

  $player.className = `player ${isWork ? 'work' : 'rest'}`;
  $player.innerHTML = `
    <div class="player-top">
      <button class="icon-btn" data-player="close" aria-label="Salir">✕</button>
      <div class="player-meta">
        <span>${escapeHtml(step.block)}</span>
        ${step.rounds > 1 ? `<span>Ronda ${step.round}/${step.rounds}</span>` : ''}
      </div>
      <span class="muted-light">${formatTime(total - elapsedSeconds())}</span>
    </div>
    <div class="progress thin"><div style="width:${progress}%"></div></div>

    <div class="player-main">
      <span class="phase">${isWork ? (showSwitch ? '¡Cambia de lado!' : 'Trabajo') : escapeHtml(step.label || 'Descanso')}</span>
      <h1>${isWork ? escapeHtml(ex.name) : upcomingEx ? `Siguiente: ${escapeHtml(upcomingEx.name)}` : 'Último esfuerzo'}</h1>
      <div class="ring" style="--p:${stepPct}">
        <span class="clock">${formatTime(player.remaining)}</span>
      </div>
      <p class="player-desc">${escapeHtml((isWork ? ex : upcomingEx)?.description ?? '')}</p>
      ${isWork && upcomingEx ? `<p class="player-next">Después: ${escapeHtml(upcomingEx.name)}</p>` : ''}
    </div>

    <div class="player-controls">
      <button class="icon-btn" data-player="prev" aria-label="Anterior" ${player.index === 0 ? 'disabled' : ''}>⏮</button>
      <button class="icon-btn play" data-player="toggle" aria-label="${player.running ? 'Pausar' : 'Reanudar'}">${player.running ? '⏸' : '▶'}</button>
      <button class="icon-btn" data-player="next" aria-label="Siguiente">⏭</button>
    </div>`;
}

function finishPlayer() {
  stopClock();
  player.done = true;
  beep(1320, 0.5);
  vibrate([200, 100, 200, 100, 400]);
  const seconds = Math.round(player.activeMs / 1000);
  player.completedSeconds = seconds;
  $player.className = 'player finish';
  $player.innerHTML = `
    <div class="player-main">
      <span class="phase">Sesión completada</span>
      <h1>¡Gran trabajo! 🎾</h1>
      <p class="player-desc">${escapeHtml(player.session.title)} · ${formatTime(seconds)} de entrenamiento</p>
      <div class="field">
        <label for="rpe">¿Cómo de dura ha sido? <strong id="rpe-value">6</strong>/10</label>
        <input id="rpe" type="range" min="1" max="10" value="6" />
      </div>
      <button class="btn primary big" data-player="save">Guardar sesión</button>
    </div>`;
  $player.querySelector('#rpe').addEventListener('input', (e) => {
    $player.querySelector('#rpe-value').textContent = e.target.value;
  });
}

function closePlayer() {
  stopClock();
  player.wakeLock?.release?.().catch(() => {});
  player.wakeLock = null;
  $player.hidden = true;
  $player.innerHTML = '';
  document.body.classList.remove('no-scroll');
}

$player.addEventListener('click', (event) => {
  const action = event.target.closest('[data-player]')?.dataset.player;
  switch (action) {
    case 'toggle':
      player.audio?.resume?.();
      return player.running ? pause() : resume();
    case 'next':
      if (player.index + 1 >= player.steps.length) return finishPlayer();
      return goToStep(player.index + 1);
    case 'prev':
      return goToStep(Math.max(0, player.index - 1));
    case 'close':
      return askConfirm('¿Salir de la sesión? No se guardará el progreso.', 'Salir', closePlayer);
    case 'save': {
      const rpe = Number($player.querySelector('#rpe').value);
      closePlayer();
      return player.onSave?.({
        title: player.session.title,
        focus: player.session.focus,
        level: player.session.level,
        seconds: player.completedSeconds,
        rpe,
      });
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$player.hidden && !player.done) requestWakeLock();
});
