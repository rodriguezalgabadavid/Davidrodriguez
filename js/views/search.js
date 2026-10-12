import { POSITIONS } from '../activities.js';
import { demoTag, followButton, globalActions } from '../components.js';
import { avatar, escapeHtml, premiumBadge } from '../ui.js';

// Buscar jugadores por nombre y seguirles. Al escribir solo se repinta la lista de resultados
// (el campo no se toca, así no pierde el foco ni el cursor).

const DEBOUNCE_MS = 250;
const MAX_QUERY = 60; // longitud máxima de un nombre de perfil
const ENRICH_MAX = 8; // perfiles completos (club, posición) que se piden por búsqueda

let timer = null;
let token = 0; // la última búsqueda lanzada gana; las respuestas viejas se descartan
let mounted = false;

// ---------- Fragmentos ----------

const byAttr = (name, value) => [...document.querySelectorAll(`[${name}]`)].filter((el) => el.getAttribute(name) === value);

function subLine(profile) {
  return [profile?.club, POSITIONS[profile?.position]].filter(Boolean).join(' · ');
}

function isFollowing(p, cache) {
  if (cache.following) return cache.following.has(p.id);
  return Boolean(cache.profiles?.get(p.id)?.followedByMe ?? p.followedByMe);
}

function personRow(p, cache) {
  const id = escapeHtml(p.id);
  const sub = subLine(cache.profiles?.get(p.id) ?? p);
  return `
    <li class="search-row">
      <a class="search-person" href="#perfil" data-route="perfil" data-param-id="${id}">
        ${avatar(p)}
        <span class="search-who">
          <span class="search-name"><span class="search-name-text">${escapeHtml(p.name)}</span>${premiumBadge(p)}${demoTag(p)}</span>
          <span class="search-sub muted" data-sub-for="${id}"${sub ? '' : ' hidden'}>${escapeHtml(sub)}</span>
        </span>
      </a>
      ${followButton(p, isFollowing(p, cache))}
    </li>`;
}

function resultsHtml(query, results, cache) {
  if (!query) return '<p class="search-hint muted">Escribe el nombre de un jugador para encontrarlo y seguirle.</p>';
  if (!results.length) {
    return `
      <div class="search-none">
        <span aria-hidden="true">🤷</span>
        <p>No hay jugadores con «${escapeHtml(query)}».</p>
        <p class="muted">Prueba con otro nombre o con solo una parte.</p>
      </div>`;
  }
  const n = results.length;
  return `
    <p class="search-count muted">${n === 1 ? '1 jugador' : `${n} jugadores`}</p>
    <ul class="search-list">${results.map((p) => personRow(p, cache)).join('')}</ul>`;
}

// La búsqueda devuelve perfiles mínimos: se completan (club, posición) en segundo plano.
async function enrich(results, ctx, myToken) {
  const cache = ctx.cache;
  cache.profiles ??= new Map();
  const missing = results.filter((p) => !cache.profiles.has(p.id)).slice(0, ENRICH_MAX);
  if (!missing.length) return;
  await Promise.all(missing.map(async (p) => {
    try {
      const profile = await ctx.backend.getProfile(p.id);
      if (profile) cache.profiles.set(p.id, profile);
    } catch {
      // Sin club no pasa nada: la fila ya se ve bien sin él.
    }
  }));
  if (myToken !== token || !mounted) return;
  for (const p of missing) {
    const sub = subLine(cache.profiles.get(p.id));
    if (!sub) continue;
    for (const el of byAttr('data-sub-for', p.id)) {
      el.textContent = sub;
      el.hidden = false;
    }
  }
}

function resultsBox() {
  return document.getElementById('search-results');
}

async function runSearch(rawQuery, ctx) {
  const my = ++token;
  const query = String(rawQuery ?? '').trim().slice(0, MAX_QUERY);
  const box = resultsBox();
  if (!query) {
    ctx.cache.results = [];
    if (box) {
      box.innerHTML = resultsHtml('', [], ctx.cache);
      box.removeAttribute('aria-busy');
    }
    return;
  }
  box?.setAttribute('aria-busy', 'true');
  let results;
  try {
    results = await ctx.backend.searchPlayers(query);
  } catch (error) {
    if (my !== token || !mounted) return;
    const current = resultsBox();
    if (current) {
      current.innerHTML = `<p class="search-hint muted">${escapeHtml(error.message || 'No se ha podido buscar. Inténtalo de nuevo.')}</p>`;
      current.removeAttribute('aria-busy');
    }
    return;
  }
  if (my !== token || !mounted) return;
  ctx.cache.results = results;
  const current = resultsBox();
  if (!current) return;
  current.innerHTML = resultsHtml(query, results, ctx.cache);
  current.removeAttribute('aria-busy');
  enrich(results, ctx, my);
}

// ---------- Vista ----------

export default {
  route: 'buscar',
  tab: null,

  async render(ctx) {
    const cache = ctx.cache;
    const query = String(cache.query ?? '').trim();
    const [suggested, following, results] = await Promise.all([
      ctx.backend.suggestedPlayers().catch(() => []),
      ctx.backend.getFollowing(ctx.me.id)
        .then((list) => new Set(list.map((p) => p.id)))
        .catch(() => null),
      query ? ctx.backend.searchPlayers(query).catch(() => []) : [],
    ]);

    cache.following = following;
    cache.profiles ??= new Map();
    for (const p of suggested) cache.profiles.set(p.id, p); // ya son perfiles completos
    cache.results = results;

    return `
      <section class="search-view">
        <h1 class="search-heading">Buscar jugadores</h1>
        <form class="search-form" data-submit="search" role="search" autocomplete="off">
          <label class="search-field">
            <span class="search-icon" aria-hidden="true">🔍</span>
            <input class="input search-input" type="search" name="q" value="${escapeHtml(cache.query ?? '')}"
              placeholder="Nombre del jugador" aria-label="Buscar jugadores por nombre" maxlength="${MAX_QUERY}"
              enterkeyhint="search" autocapitalize="words" spellcheck="false" data-input="query" />
          </label>
        </form>

        <div class="search-results" id="search-results" aria-live="polite">${resultsHtml(query, results, cache)}</div>

        <section class="card search-suggest" aria-labelledby="search-suggest-title">
          <h2 id="search-suggest-title" class="search-suggest-title">Sugerencias</h2>
          ${suggested.length
            ? `<ul class="search-list">${suggested.map((p) => personRow(p, cache)).join('')}</ul>`
            : '<p class="muted">Ya sigues a todos los jugadores que te sugeriríamos. ¡Busca a tus amigos por su nombre!</p>'}
        </section>
      </section>`;
  },

  mount(root, ctx) {
    mounted = true;
    const input = root.querySelector('.search-input');
    if (input) {
      input.focus({ preventScroll: true });
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch {
        // Algunos navegadores no permiten mover el cursor en type="search".
      }
    }
    if (ctx.cache.results?.length) enrich(ctx.cache.results, ctx, token);
  },

  unmount() {
    mounted = false;
    clearTimeout(timer);
    token++;
  },

  actions: {
    query(el, ctx) {
      ctx.cache.query = el.value;
      clearTimeout(timer);
      if (!el.value.trim()) return runSearch('', ctx); // borrar es instantáneo
      resultsBox()?.setAttribute('aria-busy', 'true');
      timer = setTimeout(() => runSearch(el.value, ctx), DEBOUNCE_MS);
    },

    // Intro / botón "buscar" del teclado: busca ya y cierra el teclado para ver los resultados.
    search(form, ctx) {
      clearTimeout(timer);
      const input = form.elements.q;
      ctx.cache.query = input.value;
      input.blur();
      return runSearch(input.value, ctx);
    },

    // Como las globales, y además recuerdan a quién sigues para las próximas búsquedas.
    async follow(el, ctx) {
      const id = el.dataset.userId;
      await globalActions.follow(el, ctx);
      ctx.cache.following?.add(id);
    },

    async unfollow(el, ctx) {
      const id = el.dataset.userId;
      await globalActions.unfollow(el, ctx);
      ctx.cache.following?.delete(id);
    },
  },
};
