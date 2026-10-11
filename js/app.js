import { CATEGORIES, EQUIPMENT, EXERCISES, FOCUSES, LEVELS, getExercise } from './data.js';
import { buildTimeline, formatTime, generateSession, timelineDuration } from './generator.js';
import { computeStats, weekActivity } from './stats.js';

// ---------- Persistencia ----------

const STORAGE = { settings: 'padelfit:settings', history: 'padelfit:history' };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function loadList(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (modo privado): la app sigue funcionando en memoria.
  }
}

const state = {
  settings: load(STORAGE.settings, {
    focus: 'completa',
    level: 2,
    minutes: 30,
    equipment: [],
    weeklyGoal: 3,
    sound: true,
  }),
  history: loadList(STORAGE.history),
  session: null,
  library: { category: 'all', query: '' },
};

const saveSettings = () => save(STORAGE.settings, state.settings);
const saveHistory = () => save(STORAGE.history, state.history);

// ---------- Utilidades ----------

const $view = document.getElementById('view');
const $player = document.getElementById('player');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function categoryTag(category) {
  const c = CATEGORIES[category];
  return `<span class="tag" style="--tag:${c.color}">${c.label}</span>`;
}

function exerciseCard(ex, { compact = false } = {}) {
  const extras = [
    ex.sides ? '<span class="pill">Ambos lados</span>' : '',
    ...ex.equipment.map((e) => `<span class="pill">${escapeHtml(e)}</span>`),
    `<span class="pill">${LEVELS[ex.level].label}</span>`,
  ].join('');
  return `
    <details class="exercise">
      <summary>
        <span class="dot" style="--tag:${CATEGORIES[ex.category].color}"></span>
        <span class="exercise-name">${escapeHtml(ex.name)}</span>
      </summary>
      <div class="exercise-body">
        ${compact ? '' : categoryTag(ex.category)}
        <p>${escapeHtml(ex.description)}</p>
        <p class="why"><strong>En pista:</strong> ${escapeHtml(ex.padel)}</p>
        <div class="pills">${extras}</div>
      </div>
    </details>`;
}

// Confirmación dentro de la página (confirm() nativo no está disponible en todos los visores).
function askConfirm(message, confirmLabel, onConfirm) {
  const dialog = document.createElement('div');
  dialog.className = 'confirm';
  dialog.innerHTML = `
    <div class="confirm-box card" role="alertdialog" aria-modal="true">
      <p>${escapeHtml(message)}</p>
      <div class="actions">
        <button class="btn" data-confirm="no">Cancelar</button>
        <button class="btn danger solid" data-confirm="yes">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>`;
  dialog.addEventListener('click', (event) => {
    const choice = event.target.closest('[data-confirm]')?.dataset.confirm;
    if (!choice && event.target !== dialog) return;
    dialog.remove();
    if (choice === 'yes') onConfirm();
  });
  document.body.append(dialog);
  dialog.querySelector('[data-confirm="no"]').focus();
}

// ---------- Vistas ----------

function viewInicio() {
  const stats = computeStats(state.history);
  const goal = state.settings.weeklyGoal;
  const pct = Math.min(100, Math.round((stats.thisWeek / goal) * 100));
  const week = weekActivity(state.history);
  const maxMin = Math.max(30, ...week.map((d) => d.minutes));

  return `
    <section class="hero card">
      <h1>¡A por el punto!</h1>
      <p>Preparación física pensada para el pádel: piernas rápidas, core fuerte y hombro sano.</p>
      <button class="btn primary big" data-action="go-train">Entrenar ahora</button>
    </section>

    <section class="stats">
      <div class="stat card"><span class="stat-value">${stats.streak}</span><span class="stat-label">días de racha</span></div>
      <div class="stat card"><span class="stat-value">${stats.thisWeek}/${goal}</span><span class="stat-label">sesiones esta semana</span></div>
      <div class="stat card"><span class="stat-value">${stats.minutes}</span><span class="stat-label">minutos totales</span></div>
    </section>

    <section class="card">
      <div class="row-between">
        <h2>Esta semana</h2>
        <span class="muted">${pct}% del objetivo</span>
      </div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="week" role="img" aria-label="Minutos entrenados por día esta semana">
        ${week
          .map(
            (d) => `
          <div class="week-day ${d.isToday ? 'today' : ''}">
            <div class="bar-track"><div class="bar" style="height:${(d.minutes / maxMin) * 100}%"></div></div>
            <span>${d.label}</span>
          </div>`,
          )
          .join('')}
      </div>
    </section>

    <section>
      <h2>¿Qué quieres trabajar hoy?</h2>
      <div class="focus-grid">
        ${Object.entries(FOCUSES)
          .map(
            ([key, f]) => `
          <button class="focus-card card" data-action="quick-focus" data-focus="${key}">
            <strong>${f.label}</strong>
            <span>${f.description}</span>
          </button>`,
          )
          .join('')}
      </div>
    </section>`;
}

function viewEntrenar() {
  const s = state.settings;
  const session = state.session;
  const form = `
    <section class="card">
      <h2>Diseña tu sesión</h2>
      <div class="field">
        <label>Objetivo</label>
        <div class="chips">
          ${Object.entries(FOCUSES)
            .map(([k, f]) => `<button class="chip ${s.focus === k ? 'on' : ''}" data-set="focus" data-value="${k}">${f.label}</button>`)
            .join('')}
        </div>
        <p class="hint">${FOCUSES[s.focus].description}</p>
      </div>
      <div class="field">
        <label>Nivel</label>
        <div class="segmented">
          ${Object.entries(LEVELS)
            .map(([k, l]) => `<button class="${String(s.level) === k ? 'on' : ''}" data-set="level" data-value="${k}">${l.label}</button>`)
            .join('')}
        </div>
        <p class="hint">${LEVELS[s.level].work}s de trabajo / ${LEVELS[s.level].rest}s de descanso</p>
      </div>
      <div class="field">
        <label>Duración</label>
        <div class="segmented">
          ${[15, 20, 30, 45, 60]
            .map((m) => `<button class="${s.minutes === m ? 'on' : ''}" data-set="minutes" data-value="${m}">${m}'</button>`)
            .join('')}
        </div>
      </div>
      <div class="field">
        <label>Material disponible</label>
        <div class="chips">
          ${EQUIPMENT.map(
            (e) => `<button class="chip ${s.equipment.includes(e) ? 'on' : ''}" data-action="toggle-equipment" data-value="${e}">${e}</button>`,
          ).join('')}
        </div>
        <p class="hint">Sin material también puedes entrenar: elegiremos ejercicios con tu peso corporal.</p>
      </div>
      <button class="btn primary big" data-action="generate">${session ? 'Generar otra sesión' : 'Generar sesión'}</button>
    </section>`;

  if (!session) return form;

  const steps = buildTimeline(session);
  const preview = `
    <section class="card session" id="session-preview">
      <div class="row-between">
        <div>
          <h2>${escapeHtml(session.title)}</h2>
          <p class="muted">${LEVELS[session.level].label} · ~${Math.round(timelineDuration(steps) / 60)} min · ${session.rounds} ronda${session.rounds === 1 ? '' : 's'} en el bloque principal</p>
        </div>
      </div>
      ${session.blocks
        .map(
          (b) => `
        <div class="block">
          <h3>${b.name}${b.key === 'main' ? ` <span class="muted">× ${session.rounds} · ${session.work}s/${session.rest}s</span>` : ''}</h3>
          ${b.exercises.map((id) => exerciseCard(getExercise(id), { compact: true })).join('')}
        </div>`,
        )
        .join('')}
      <div class="actions">
        <button class="btn" data-action="generate">Otra variante</button>
        <button class="btn primary" data-action="start">▶ Empezar</button>
      </div>
    </section>`;
  return form + preview;
}

function viewEjercicios() {
  const { category, query } = state.library;
  const q = query.trim().toLowerCase();
  const list = EXERCISES.filter(
    (e) =>
      (category === 'all' || e.category === category) &&
      (!q || `${e.name} ${e.description} ${e.padel}`.toLowerCase().includes(q)),
  );
  return `
    <section class="card">
      <h2>Biblioteca de ejercicios</h2>
      <input class="search" type="search" placeholder="Buscar: hombro, salto, rotación…" value="${escapeHtml(query)}" data-input="library-query" />
      <div class="chips scroll">
        <button class="chip ${category === 'all' ? 'on' : ''}" data-action="library-category" data-value="all">Todos</button>
        ${Object.entries(CATEGORIES)
          .map(([k, c]) => `<button class="chip ${category === k ? 'on' : ''}" data-action="library-category" data-value="${k}">${c.label}</button>`)
          .join('')}
      </div>
    </section>
    <section class="library">
      ${list.length ? list.map((e) => exerciseCard(e)).join('') : '<p class="muted center">No hay ejercicios que coincidan.</p>'}
    </section>`;
}

function viewProgreso() {
  const stats = computeStats(state.history);
  const items = [...state.history].reverse();
  const dateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `
    <section class="stats">
      <div class="stat card"><span class="stat-value">${stats.total}</span><span class="stat-label">sesiones</span></div>
      <div class="stat card"><span class="stat-value">${stats.minutes}</span><span class="stat-label">minutos</span></div>
      <div class="stat card"><span class="stat-value">${stats.streak}</span><span class="stat-label">racha</span></div>
    </section>

    <section class="card">
      <h2>Historial</h2>
      ${
        items.length
          ? `<ul class="history">${items
              .map(
                (h) => `
            <li>
              <div>
                <strong>${escapeHtml(h.title)}</strong>
                <span class="muted">${dateFmt.format(new Date(h.date))}</span>
              </div>
              <div class="history-meta">
                <span>${Math.round(h.seconds / 60)} min</span>
                ${h.rpe ? `<span class="pill">Esfuerzo ${h.rpe}/10</span>` : ''}
              </div>
            </li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">Aún no has completado ninguna sesión. ¡La primera es la más importante!</p>'
      }
    </section>

    <section class="card">
      <h2>Ajustes</h2>
      <div class="field">
        <label for="goal">Objetivo semanal: <strong>${state.settings.weeklyGoal}</strong> sesiones</label>
        <input id="goal" type="range" min="1" max="7" value="${state.settings.weeklyGoal}" data-input="weekly-goal" />
      </div>
      <label class="switch">
        <input type="checkbox" ${state.settings.sound ? 'checked' : ''} data-input="sound" />
        <span>Avisos sonoros y vibración</span>
      </label>
      ${state.history.length ? '<button class="btn danger" data-action="clear-history">Borrar historial</button>' : ''}
    </section>`;
}

const VIEWS = { inicio: viewInicio, entrenar: viewEntrenar, ejercicios: viewEjercicios, progreso: viewProgreso };

function currentRoute() {
  const route = location.hash.replace('#', '');
  return VIEWS[route] ? route : 'inicio';
}

function render() {
  const route = currentRoute();
  $view.innerHTML = VIEWS[route]();
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.route === route));
}

function navigate(route) {
  if (location.hash === `#${route}`) render();
  else location.hash = route;
  window.scrollTo(0, 0);
}

function newSession() {
  const { focus, level, minutes, equipment } = state.settings;
  state.session = generateSession({ focus, level, minutes, equipment, seed: Math.floor(Math.random() * 2 ** 31) });
}

// ---------- Eventos ----------

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-route], [data-action], [data-set]');
  if (!el || $player.contains(el)) return;

  if (el.dataset.route) return navigate(el.dataset.route);

  if (el.dataset.set) {
    const key = el.dataset.set;
    state.settings[key] = key === 'focus' ? el.dataset.value : Number(el.dataset.value);
    state.session = null;
    saveSettings();
    return render();
  }

  switch (el.dataset.action) {
    case 'go-train':
      return navigate('entrenar');
    case 'quick-focus':
      state.settings.focus = el.dataset.focus;
      saveSettings();
      newSession();
      return navigate('entrenar');
    case 'toggle-equipment': {
      const eq = new Set(state.settings.equipment);
      eq.has(el.dataset.value) ? eq.delete(el.dataset.value) : eq.add(el.dataset.value);
      state.settings.equipment = [...eq];
      state.session = null;
      saveSettings();
      return render();
    }
    case 'generate':
      newSession();
      render();
      return document.getElementById('session-preview')?.scrollIntoView({ behavior: 'smooth' });
    case 'start':
      return startPlayer(state.session);
    case 'library-category':
      state.library.category = el.dataset.value;
      return render();
    case 'clear-history':
      return askConfirm('¿Seguro que quieres borrar todo el historial?', 'Borrar', () => {
        state.history = [];
        saveHistory();
        render();
      });
  }
});

document.addEventListener('input', (event) => {
  const el = event.target;
  switch (el.dataset.input) {
    case 'library-query': {
      state.library.query = el.value;
      const pos = el.selectionStart;
      render();
      const input = $view.querySelector('[data-input="library-query"]');
      input.focus();
      input.setSelectionRange(pos, pos);
      return;
    }
    case 'weekly-goal':
      state.settings.weeklyGoal = Number(el.value);
      saveSettings();
      el.previousElementSibling.querySelector('strong').textContent = el.value;
      return;
    case 'sound':
      state.settings.sound = el.checked;
      saveSettings();
      return;
  }
});

window.addEventListener('hashchange', render);

// ---------- Reproductor de la sesión ----------

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
};

function beep(freq = 880, duration = 0.12) {
  if (!state.settings.sound || !player.audio) return;
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
  if (state.settings.sound && navigator.vibrate) navigator.vibrate(pattern);
}

async function requestWakeLock() {
  try {
    player.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // No disponible: la pantalla puede apagarse, el temporizador sigue siendo correcto al volver.
  }
}

function startPlayer(session) {
  if (!session) return;
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
    case 'save':
      state.history.push({
        date: new Date().toISOString(),
        title: player.session.title,
        focus: player.session.focus,
        level: player.session.level,
        seconds: player.completedSeconds,
        rpe: Number($player.querySelector('#rpe').value),
      });
      saveHistory();
      closePlayer();
      state.session = null;
      return navigate('progreso');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$player.hidden && !player.done) requestWakeLock();
});

// ---------- Arranque ----------

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
