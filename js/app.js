import { createBackend } from './backend/index.js';
import { globalActions } from './components.js';
import { startPlayer } from './player.js';
import { escapeHtml, loading, toast } from './ui.js';

import feed from './views/feed.js';
import activity from './views/activity.js';
import notifications from './views/notifications.js';
import search from './views/search.js';
import publish from './views/publish.js';
import onboarding from './views/onboarding.js';
import challenges from './views/challenges.js';
import profile from './views/profile.js';
import settingsView from './views/settings.js';
import train from './views/train.js';
import exercises from './views/exercises.js';
import premium from './views/premium.js';

// ---------- Rutas ----------

const VIEWS = Object.fromEntries(
  [feed, activity, notifications, search, publish, onboarding, challenges, profile, settingsView, train, exercises, premium]
    .map((v) => [v.route, v]),
);
const REQUIRED_PARAMS = { actividad: ['id'] };
const DEFAULT_ROUTE = 'inicio';
const ONBOARDING_ROUTE = 'bienvenida';

// ---------- Preferencias locales ----------

const SETTINGS_KEY = 'padelfit:settings';

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
    return { sound: stored.sound ?? true, weeklyGoal: stored.weeklyGoal ?? 3 };
  } catch {
    return { sound: true, weeklyGoal: 3 };
  }
}

// ---------- Estado de la app ----------

const $view = document.getElementById('view');
const $tabbar = document.querySelector('.tabbar');
const $topbar = document.querySelector('.topbar');
const $notifCount = document.getElementById('notif-count');

const app = {
  backend: null,
  me: null,
  authState: 'signed-out',
  settings: loadSettings(),
  paramsByRoute: {},
  current: null, // { route, view }
  renderToken: 0,
  caches: {},
};

function makeCtx(route) {
  app.caches[route] ??= {};
  return {
    backend: app.backend,
    me: app.me,
    params: app.paramsByRoute[route] ?? {},
    now: new Date(),
    settings: app.settings,
    saveSettings() {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings));
      } catch {
        // Sin almacenamiento: las preferencias duran lo que la sesión.
      }
    },
    navigate,
    back,
    rerender: () => render(),
    refreshMe,
    refreshBadge,
    startSession: (session, { onSave } = {}) => startPlayer(session, { settings: app.settings, onSave }),
    cache: app.caches[route],
  };
}

function currentRoute() {
  const route = location.hash.replace('#', '') || DEFAULT_ROUTE;
  if (app.authState !== 'ready') return ONBOARDING_ROUTE;
  if (route === ONBOARDING_ROUTE || !VIEWS[route]) return DEFAULT_ROUTE;
  const params = app.paramsByRoute[route] ?? {};
  if ((REQUIRED_PARAMS[route] ?? []).some((p) => params[p] == null)) return DEFAULT_ROUTE;
  return route;
}

function closeOverlays() {
  document.querySelectorAll('.sheet-backdrop').forEach((el) => el.remove());
}

export function navigate(route, params = {}) {
  app.paramsByRoute[route] = params;
  closeOverlays();
  if (location.hash === `#${route}`) render({ scrollTop: true });
  else location.hash = route; // hashchange → render
}

function back() {
  if (history.length > 1) history.back();
  else navigate(DEFAULT_ROUTE);
}

async function refreshMe() {
  app.me = await app.backend.getMe();
  return app.me;
}

async function refreshBadge() {
  if (app.authState !== 'ready') return;
  try {
    const n = await app.backend.getUnreadCount();
    $notifCount.textContent = n > 9 ? '9+' : String(n);
    $notifCount.hidden = n === 0;
  } catch {
    // El contador no es crítico.
  }
}

async function render({ scrollTop = false } = {}) {
  const route = currentRoute();
  const view = VIEWS[route];
  const token = ++app.renderToken;

  if (app.current && app.current.view !== view) app.current.view.unmount?.();
  const changed = app.current?.route !== route;
  app.current = { route, view };

  document.body.dataset.route = route;
  $tabbar.hidden = route === ONBOARDING_ROUTE;
  $topbar.querySelector('.topbar-actions').hidden = route === ONBOARDING_ROUTE;
  document.querySelectorAll('.tabbar [data-route]').forEach((b) => b.classList.toggle('on', b.dataset.route === view.tab));

  if (changed) $view.innerHTML = loading();
  const ctx = makeCtx(route);
  let html;
  try {
    html = await view.render(ctx);
  } catch (error) {
    console.error(error);
    html = `
      <div class="card error-card">
        <h2>Algo ha fallado</h2>
        <p class="muted">${escapeHtml(error.message || 'No se ha podido cargar esta pantalla.')}</p>
        <button class="btn" data-action="retry">Reintentar</button>
      </div>`;
  }
  if (token !== app.renderToken) return; // otro render más reciente ganó la carrera
  $view.innerHTML = html;
  try {
    view.mount?.($view, ctx);
  } catch (error) {
    console.error(error);
  }
  if (changed || scrollTop) window.scrollTo(0, 0);
}

// ---------- Delegación de eventos ----------

function paramsFrom(el) {
  const params = {};
  for (const [key, value] of Object.entries(el.dataset)) {
    if (key.startsWith('param') && key.length > 5) params[key[5].toLowerCase() + key.slice(6)] = value;
  }
  return params;
}

async function runAction(name, el, event) {
  const handler = app.current?.view.actions?.[name] ?? globalActions[name];
  if (name === 'retry') return render();
  if (!handler) return console.warn(`Acción sin manejador: ${name}`);
  try {
    await handler(el, makeCtx(app.current.route), event);
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se ha podido completar la acción.');
  }
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-route], [data-action]');
  if (!el || el.closest('#player, .confirm')) return;
  if (el.disabled) return;
  if (el.dataset.route) {
    event.preventDefault();
    return navigate(el.dataset.route, paramsFrom(el));
  }
  if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('http')) event.preventDefault();
  runAction(el.dataset.action, el, event);
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-submit]');
  if (!form) return;
  event.preventDefault();
  runAction(form.dataset.submit, form, event);
});

document.addEventListener('input', (event) => {
  const el = event.target.closest('[data-input]');
  if (el) runAction(el.dataset.input, el, event);
});

document.addEventListener('change', (event) => {
  const el = event.target.closest('[data-change]');
  if (el) runAction(el.dataset.change, el, event);
});

window.addEventListener('hashchange', () => {
  closeOverlays();
  render();
});

// ---------- Arranque ----------

async function start() {
  $view.innerHTML = loading();
  try {
    app.backend = await createBackend();
    await app.backend.init();
    app.authState = await app.backend.getAuthState();
    if (app.authState === 'ready') await refreshMe();
  } catch (error) {
    console.error(error);
    $view.innerHTML = `
      <div class="card error-card">
        <h2>No se ha podido conectar</h2>
        <p class="muted">${escapeHtml(error.message || 'Revisa tu conexión e inténtalo de nuevo.')}</p>
        <button class="btn" onclick="location.reload()">Reintentar</button>
      </div>`;
    return;
  }

  document.getElementById('demo-banner').hidden = app.backend.mode !== 'demo';

  app.backend.onAuthChange(async (state) => {
    const wasReady = app.authState === 'ready';
    app.authState = state;
    app.me = state === 'ready' ? await app.backend.getMe() : null;
    if (state === 'ready' && !wasReady) navigate(DEFAULT_ROUTE);
    else render();
    refreshBadge();
  });

  app.backend.subscribe((event) => {
    refreshBadge();
    if (event.type === 'notification' && app.current?.route === 'notificaciones') render();
    if (event.type === 'feed' && ['inicio', 'actividad'].includes(app.current?.route)) render();
  });

  await render();
  refreshBadge();
}

start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
