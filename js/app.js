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

// Título de la barra superior (como en Strava). En inicio y en la bienvenida se ve la marca.
// Una vista puede definir `title` (texto o función de ctx) para cambiarlo.
const ROUTE_TITLES = {
  retos: 'Retos',
  publicar: 'Publicar',
  entrenar: 'Entrenar',
  ejercicios: 'Ejercicios',
  premium: 'Premium',
  notificaciones: 'Notificaciones',
  buscar: 'Buscar jugadores',
  ajustes: 'Ajustes',
  actividad: 'Actividad',
};
const BRAND_ROUTES = new Set(['inicio', 'bienvenida']);
// Pantallas principales (pestañas): sin flecha de volver. El resto la lleva en la barra superior.
const TAB_ROUTES = new Set(['inicio', 'retos', 'publicar', 'entrenar', 'perfil']);
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
const $brand = document.getElementById('topbar-brand');
const $title = document.getElementById('topbar-title');
const $start = document.getElementById('topbar-start');
const $back = document.getElementById('topbar-back');

function setTopbar(route, view, ctx) {
  let title = ROUTE_TITLES[route] ?? '';
  if (route === 'perfil') title = !ctx.params.id || ctx.params.id === ctx.me?.id ? 'Tú' : 'Perfil';
  try {
    if (view.title) title = typeof view.title === 'function' ? view.title(ctx) : view.title;
  } catch {
    // Un título que falla no debe romper la pantalla.
  }
  const brand = BRAND_ROUTES.has(route) || !title;
  const isTab = TAB_ROUTES.has(route) && !(route === 'perfil' && ctx.params.id && ctx.params.id !== ctx.me?.id);
  $brand.hidden = !brand;
  $start.hidden = brand;
  $back.hidden = isTab;
  $title.textContent = brand ? '' : title;
  document.title = brand ? 'PadelFit' : `${title} · PadelFit`;
}

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

// Cada entrada del historial guarda su ruta y sus parámetros: "Volver" restaura exactamente la pantalla
// anterior (p. ej. de un perfil a otro perfil). replace: true sustituye la entrada actual (tras publicar,
// para que "Volver" no lleve a un formulario vacío).
export function navigate(route, params = {}, { replace = false } = {}) {
  app.paramsByRoute[route] = params;
  closeOverlays();
  const state = { route, params };
  if (replace) history.replaceState(state, '', `#${route}`);
  else history.pushState(state, '', `#${route}`);
  render({ scrollTop: true });
}

const sameParams = (a = {}, b = {}) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

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

  document.body.dataset.view = route;
  $tabbar.hidden = route === ONBOARDING_ROUTE;
  $topbar.querySelector('.topbar-actions').hidden = route === ONBOARDING_ROUTE;
  document.querySelectorAll('.tabbar [data-route]').forEach((b) => b.classList.toggle('on', b.dataset.route === view.tab));

  if (changed) $view.innerHTML = loading();
  const ctx = makeCtx(route);
  setTopbar(route, view, ctx);
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
    const route = el.dataset.route;
    const params = paramsFrom(el);
    if (route === app.current?.route && sameParams(params, app.paramsByRoute[route])) {
      // Volver a tocar la pantalla actual: sube arriba como en cualquier app social; si ya estás arriba,
      // la refresca. Nunca en publicar: se perdería lo que estás escribiendo.
      if (window.scrollY > 0 || route === 'publicar') return window.scrollTo({ top: 0, behavior: 'smooth' });
      return render();
    }
    return navigate(route, params);
  }
  if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('http')) event.preventDefault();
  runAction(el.dataset.action, el, event);
});

$back.addEventListener('click', () => back());

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

// Atrás/adelante: restaura los parámetros guardados en esa entrada del historial.
window.addEventListener('popstate', (event) => {
  closeOverlays();
  if (event.state?.route) app.paramsByRoute[event.state.route] = event.state.params ?? {};
  render();
});

// Hash escrito a mano (o navegadores que no emiten popstate al cambiarlo): solo si la ruta cambió,
// para no renderizar dos veces cuando popstate ya lo hizo.
window.addEventListener('hashchange', () => {
  if (currentRoute() === app.current?.route) return;
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
    // Otra cuenta (o demo reiniciada): nada de la sesión anterior debe quedar en pantalla.
    if (state !== 'ready' || !wasReady) {
      app.caches = {};
      app.paramsByRoute = {};
    }
    if (state === 'ready' && !wasReady) navigate(DEFAULT_ROUTE);
    else render();
    refreshBadge();
  });

  // Llegan "¡Vamos!", comentarios o seguidores: se ven al momento en la pantalla abierta.
  // Si estás escribiendo (p. ej. un comentario) no se repinta, para no quitarte el foco.
  app.backend.subscribe((event) => {
    refreshBadge();
    const route = app.current?.route;
    const typing = $view.contains(document.activeElement) && document.activeElement.matches('input, textarea');
    if (route === 'notificaciones' && event.type === 'notification') render();
    else if (['inicio', 'actividad'].includes(route) && !typing) render();
  });

  // La primera entrada del historial también lleva su ruta, para que "Volver" funcione desde aquí.
  history.replaceState({ route: currentRoute(), params: app.paramsByRoute[currentRoute()] ?? {} }, '', location.hash || `#${DEFAULT_ROUTE}`);
  await render();
  refreshBadge();
}

start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
