import { ACTIVITY_TYPES, activityTitle, formatScore, matchOutcome } from './activities.js';
import { getPlan } from './plans.js';
import { icon, TYPE_ICONS } from './icons.js';
import { avatar, escapeHtml, formatDuration, premiumBadge, sheet, toast } from './ui.js';

// Componentes sociales compartidos: tarjeta de actividad, botón de seguir y acciones globales
// ("¡Vamos!", abrir actividad, seguir/dejar de seguir, ver quién ha dado "¡Vamos!").
// Las acciones globales funcionan en cualquier vista porque app.js las busca si la vista no las define.

// Eventos del documento para que las vistas reaccionen a cambios hechos desde una tarjeta.
export const KUDOS_EVENT = 'padelfit:kudos'; // detail: { id, kudoedByMe, kudosCount }
export const FOLLOW_EVENT = 'padelfit:follow'; // detail: { userId, following }

// ---------- Utilidades ----------

const attr = (value) => escapeHtml(value ?? '');

// Elementos marcados con `name="id"` (sin construir selectores con ids arbitrarios).
function marked(name, id) {
  return [...document.querySelectorAll(`[${name}]`)].filter((el) => el.getAttribute(name) === String(id));
}

function wonOf(a) {
  if (a.sets?.length) return matchOutcome(a.sets).won;
  return typeof a.won === 'boolean' ? a.won : null;
}

export const demoTag = (profile) => (profile?.demo ? '<span class="act-demo" title="Jugador de ejemplo del modo demo">ejemplo</span>' : '');

const profileLink = (id) => `href="#perfil" data-route="perfil" data-param-id="${attr(id)}"`;

// ---------- Tarjeta de actividad (al estilo Strava) ----------
// Cabecera con autor, fecha y club · título grande · texto · fila de estadísticas · foto o la pista con el
// marcador (nuestro "mapa") · resumen de ¡Vamos! y comentarios · botones ¡Vamos! y Comentar.

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

// "Hoy a las 19:30", "Ayer a las 19:30", "6 oct. · 19:30"
function whenLabel(date, now) {
  const d = new Date(date);
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return `Hoy a las ${timeFmt.format(d)}`;
  if (days === 1) return `Ayer a las ${timeFmt.format(d)}`;
  return `${dayFmt.format(d)} · ${timeFmt.format(d)}`;
}

const VERDICT = { true: 'Victoria', false: 'Derrota' };

function statsFor(a) {
  const items = [];
  if (a.type === 'partido') {
    const won = wonOf(a);
    items.push(['Resultado', won === null ? (a.sets?.length ? 'Empate' : '—') : VERDICT[won]]);
  }
  if (a.seconds > 0) items.push([a.type === 'partido' ? 'Tiempo' : 'Duración', formatDuration(a.seconds)]);
  if (a.rpe) items.push(['Esfuerzo', `${a.rpe}<small>/10</small>`, true]);
  if (a.type === 'entreno' && a.plan?.planId) {
    const name = getPlan(a.plan.planId)?.name ?? (a.plan.planId === 'premium' ? 'Personalizado' : 'Plan');
    items.push(['Plan', escapeHtml(name), true]);
  }
  if (!items.length) return '';
  return `
    <dl class="stats-row act-stats">
      ${items.map(([k, v, raw]) => `<div><dt class="stat-label">${k}</dt><dd class="stat-value">${raw ? v : escapeHtml(v)}</dd></div>`).join('')}
    </dl>`;
}

function peopleLine(a) {
  if (a.type !== 'partido') return '';
  const parts = [];
  if (a.partner) parts.push(`Con <strong>${escapeHtml(a.partner)}</strong>`);
  if (a.rivals?.length) parts.push(`contra ${a.rivals.map((r) => `<strong>${escapeHtml(r)}</strong>`).join(' y ')}`);
  return parts.length ? `<p class="act-people">${icon('users', { size: 18 })}<span>${parts.join(' · ')}</span></p>` : '';
}

// La pista vista desde arriba con el marcador encima: lo que en Strava sería el mapa del recorrido.
function courtScore(a) {
  const sets = a.sets ?? [];
  const { won } = matchOutcome(sets);
  const row = (label, side, isWinner) => `
    <div class="court-row${isWinner ? ' court-row-win' : ''}">
      <span class="court-team">${label}</span>
      ${sets.map(([x, y]) => {
        const mine = side === 0 ? x : y;
        const theirs = side === 0 ? y : x;
        return `<span class="court-set${mine > theirs ? ' court-set-won' : ''}">${escapeHtml(mine)}</span>`;
      }).join('')}
    </div>`;
  const verdict = won === null ? 'Empate' : VERDICT[won];
  return `
    <div class="court" role="img" aria-label="${attr(`${verdict}: ${formatScore(sets)}`)}">
      <svg class="court-lines" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <rect x="6" y="6" width="188" height="88" rx="2"/>
        <path d="M37 6v88M163 6v88M37 50h126"/>
        <path class="court-net" d="M100 2v96"/>
      </svg>
      <div class="court-board" aria-hidden="true">
        ${row('Nosotros', 0, won === true)}
        ${row('Rivales', 1, won === false)}
      </div>
    </div>`;
}

function media(a, author, title, link) {
  if (a.photoUrl) {
    return `
      <figure class="act-photo">
        <img src="${attr(a.photoUrl)}" alt="${attr(`Foto de ${author.name}: ${title}`)}" loading="${link ? 'lazy' : 'eager'}" decoding="async" />
      </figure>`;
  }
  if (a.type === 'partido' && a.sets?.length) return courtScore(a);
  return '';
}

const kudosWhoLabel = (n) => `${n} ¡Vamos!`;
const commentsLabel = (n) => `${n} comentario${n === 1 ? '' : 's'}`;

function footer(a) {
  const id = attr(a.id);
  const kudos = Number(a.kudosCount) || 0;
  const comments = Number(a.commentsCount) || 0;
  // En tus propias actividades no te das "¡Vamos!" a ti mismo: el botón muestra quién te lo ha dado.
  const kudosButton = a.isMine
    ? `<button class="act-action" data-action="show-kudoers" data-id="${id}">
        ${icon('racket')}<span>¡Vamos!</span><span class="kudos-count" hidden>${kudos}</span>
      </button>`
    : `<button class="act-action kudos-btn${a.kudoedByMe ? ' kudos-on' : ''}" data-action="kudos" data-id="${id}" data-kudos-btn="${id}"
        data-count="${kudos}" aria-pressed="${a.kudoedByMe ? 'true' : 'false'}">
        ${icon('racket')}<span>¡Vamos!</span><span class="kudos-count" hidden>${kudos}</span>
      </button>`;
  return `
    <div class="act-social">
      <button class="act-social-link kudos-who" data-action="show-kudoers" data-id="${id}" data-kudos-who="${id}"${kudos ? '' : ' hidden'}>${kudosWhoLabel(kudos)}</button>
      <button class="act-social-link act-cm-btn" data-action="open-activity" data-id="${id}" data-focus="comment"${comments ? '' : ' hidden'}>
        <span data-cm-for="${id}" data-cm-label="long"${comments ? '' : ' hidden'}>${commentsLabel(comments)}</span>
      </button>
    </div>
    <footer class="act-actions">
      ${kudosButton}
      <button class="act-action" data-action="open-activity" data-id="${id}" data-focus="comment">${icon('comment')}<span>Comentar</span></button>
    </footer>`;
}

// Tarjeta social de una actividad. Con link = true toda la tarjeta abre el detalle
// (los botones de dentro siguen funcionando porque la delegación busca el elemento más cercano).
export function activityCard(activity, ctx, { link = true } = {}) {
  const a = activity;
  const id = attr(a.id);
  const type = ACTIVITY_TYPES[a.type] ? a.type : 'entreno';
  const author = a.author ?? { id: a.userId, name: 'Jugador', avatarUrl: null, isPremium: false };
  const title = activityTitle(a);
  const now = ctx?.now ?? new Date();
  const titleHtml = link
    ? `<a class="act-title-link" href="#actividad" data-route="actividad" data-param-id="${id}">${escapeHtml(title)}</a>`
    : escapeHtml(title);

  return `
    <article class="act-card${link ? ' act-linked' : ''}" ${link ? `data-action="open-activity" data-id="${id}"` : ''} style="--type:var(--t-${type})">
      <header class="act-head">
        <a class="act-avatar" ${profileLink(author.id)} tabindex="-1" aria-hidden="true">${avatar(author)}</a>
        <div class="act-who">
          <span class="act-name-line"><a class="act-name" ${profileLink(author.id)}>${escapeHtml(author.name)}</a>${premiumBadge(author)}${demoTag(author)}</span>
          <span class="act-meta">
            <span class="act-type" title="${attr(ACTIVITY_TYPES[type].label)}">${icon(TYPE_ICONS[type], { size: 16 })}<span class="sr-only">${escapeHtml(ACTIVITY_TYPES[type].label)}.</span></span>
            <time datetime="${attr(a.date)}">${escapeHtml(whenLabel(a.date, now))}</time>${a.club ? `<span class="act-club">· ${escapeHtml(a.club)}</span>` : ''}
          </span>
        </div>
      </header>
      <h2 class="act-title">${titleHtml}</h2>
      ${a.text ? `<p class="act-text${link ? ' act-text-clamp' : ''}">${escapeHtml(a.text)}</p>` : ''}
      ${statsFor(a)}
      ${peopleLine(a)}
      ${!link && a.type === 'partido' && a.sets?.length && a.photoUrl ? courtScore(a) : ''}
      ${media(a, author, title, link)}
      ${footer(a)}
    </article>`;
}

// ---------- Contadores en vivo ----------

function applyKudos(id, { kudoedByMe, kudosCount }, { pop = false } = {}) {
  const count = Math.max(0, Number(kudosCount) || 0);
  for (const btn of marked('data-kudos-btn', id)) {
    btn.setAttribute('aria-pressed', kudoedByMe ? 'true' : 'false');
    btn.dataset.count = String(count);
    btn.classList.toggle('kudos-on', Boolean(kudoedByMe));
    const counter = btn.querySelector('.kudos-count');
    if (counter) {
      counter.textContent = String(count);
      counter.hidden = count === 0;
    }
    if (pop) {
      btn.classList.remove('kudos-pop');
      void btn.offsetWidth; // reinicia la animación
      btn.classList.add('kudos-pop');
    }
  }
  for (const el of marked('data-kudos-who', id)) {
    el.textContent = kudosWhoLabel(count);
    el.hidden = count === 0;
  }
}

// Actualiza el contador de comentarios de una actividad en todo lo que haya pintado.
export function updateCommentCount(activityId, count) {
  const n = Math.max(0, Number(count) || 0);
  for (const el of marked('data-cm-for', activityId)) {
    el.textContent = el.dataset.cmLabel === 'long' ? commentsLabel(n) : String(n);
    el.hidden = n === 0;
    // Sin comentarios, el enlace del resumen desaparece entero (un botón vacío no tiene nombre accesible).
    if (el.dataset.cmLabel === 'long') el.closest('.act-cm-btn')?.toggleAttribute('hidden', n === 0);
  }
}

// ---------- Seguir ----------

export function followButton(profile, following = Boolean(profile?.followedByMe)) {
  return `
    <button class="btn card-follow${following ? '' : ' primary'}" data-action="${following ? 'unfollow' : 'follow'}"
      data-user-id="${attr(profile.id)}" data-name="${attr(profile.name)}" aria-pressed="${following ? 'true' : 'false'}">${following ? 'Siguiendo' : 'Seguir'}</button>`;
}

function updateFollowButtons(userId, following, { busy = false } = {}) {
  for (const btn of marked('data-user-id', userId)) {
    if (!['follow', 'unfollow'].includes(btn.dataset.action)) continue;
    btn.dataset.action = following ? 'unfollow' : 'follow';
    btn.textContent = following ? 'Siguiendo' : 'Seguir';
    btn.setAttribute('aria-pressed', following ? 'true' : 'false');
    btn.classList.toggle('primary', !following);
    btn.disabled = busy;
  }
}

async function setFollow(el, ctx, following) {
  const userId = el.dataset.userId;
  if (!userId) return;
  const name = el.dataset.name || '';
  updateFollowButtons(userId, following, { busy: true });
  try {
    await (following ? ctx.backend.follow(userId) : ctx.backend.unfollow(userId));
  } catch (error) {
    updateFollowButtons(userId, !following);
    throw error;
  }
  updateFollowButtons(userId, following);
  document.dispatchEvent(new CustomEvent(FOLLOW_EVENT, { detail: { userId, following } }));
  if (following) toast(name ? `Ahora sigues a ${name}` : 'Ahora le sigues');
  else toast(name ? `Has dejado de seguir a ${name}` : 'Has dejado de seguirle');
}

// ---------- Hoja "¡Vamos!" ----------

function kudoerRow(p, meId) {
  const isMe = Boolean(meId) && p.id === meId;
  return `
    <li>
      <button class="kudos-person" data-route="perfil" ${isMe ? '' : `data-param-id="${attr(p.id)}"`}>
        ${avatar(p)}<span class="kudos-person-name">${isMe ? 'Tú' : escapeHtml(p.name)}</span>${premiumBadge(p)}${demoTag(p)}
      </button>
    </li>`;
}

// ---------- Acciones globales ----------

const kudosInFlight = new Set();

export const globalActions = {
  // "¡Vamos!": se pinta al momento en todas las tarjetas de esa actividad y se confirma con el servidor.
  async kudos(el, ctx) {
    const id = el.dataset.id;
    if (!id || kudosInFlight.has(id)) return;
    const wasOn = el.getAttribute('aria-pressed') === 'true';
    const before = { kudoedByMe: wasOn, kudosCount: Number(el.dataset.count) || 0 };
    applyKudos(id, { kudoedByMe: !wasOn, kudosCount: before.kudosCount + (wasOn ? -1 : 1) }, { pop: !wasOn });
    kudosInFlight.add(id);
    try {
      const result = await ctx.backend.toggleKudos(id);
      applyKudos(id, result);
      document.dispatchEvent(new CustomEvent(KUDOS_EVENT, { detail: { id, ...result } }));
    } catch (error) {
      applyKudos(id, before);
      throw error;
    } finally {
      kudosInFlight.delete(id);
    }
  },

  'open-activity'(el, ctx) {
    const id = el.dataset.id;
    if (!id) return;
    // Si el usuario estaba seleccionando texto de la tarjeta, no navegamos.
    if (el.tagName === 'ARTICLE' && String(window.getSelection?.() ?? '').trim()) return;
    ctx.navigate('actividad', el.dataset.focus ? { id, focus: el.dataset.focus } : { id });
  },

  follow: (el, ctx) => setFollow(el, ctx, true),
  unfollow: (el, ctx) => setFollow(el, ctx, false),

  async 'show-kudoers'(el, ctx) {
    const id = el.dataset.id;
    if (!id) return;
    const people = await ctx.backend.getKudoers(id);
    sheet(`
      <div class="kudos-sheet">
        <h2>${icon('racket')} ¡Vamos! <span class="muted">${people.length}</span></h2>
        ${people.length
          ? `<ul class="kudos-list">${people.map((p) => kudoerRow(p, ctx.me?.id)).join('')}</ul>`
          : '<p class="muted">Aún nadie ha dado ¡Vamos! a esta actividad.</p>'}
      </div>`);
  },
};
