import { ACTIVITY_TYPES, activityTitle, formatScore, matchOutcome } from './activities.js';
import { getPlan } from './plans.js';
import { avatar, escapeHtml, formatDuration, formatWhen, premiumBadge, sheet, timeAgo, toast } from './ui.js';

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

// ---------- Tarjeta de actividad ----------

function resultPill(won, hasSets) {
  if (won === true) return '<span class="result win">Victoria</span>';
  if (won === false) return '<span class="result loss">Derrota</span>';
  return hasSets ? '<span class="result draw">Empate</span>' : '';
}

// Marcador completo (solo en el detalle).
function scoreboard(sets) {
  const { won } = matchOutcome(sets);
  const row = (label, side, isWinner) => `
    <tr class="${isWinner ? 'winner' : ''}">
      <th scope="row">${label}</th>
      ${sets.map(([a, b]) => {
        const mine = side === 0 ? a : b;
        const theirs = side === 0 ? b : a;
        return `<td class="${mine > theirs ? 'set-won' : ''}">${mine}</td>`;
      }).join('')}
    </tr>`;
  return `
    <table class="scoreboard act-scoreboard" aria-label="Resultado ${escapeHtml(formatScore(sets))}">
      <tbody>${row('Nosotros', 0, won === true)}${row('Rivales', 1, won === false)}</tbody>
    </table>`;
}

function matchBlock(a, { full }) {
  if (a.type !== 'partido') return '';
  const sets = a.sets ?? [];
  const pill = resultPill(wonOf(a), sets.length > 0);
  const score = sets.length
    ? (full ? scoreboard(sets) : `<span class="act-score">${escapeHtml(formatScore(sets))}</span>`)
    : '';
  const people = [];
  if (a.partner) people.push(`con <strong>${escapeHtml(a.partner)}</strong>`);
  if (a.rivals?.length) people.push(`vs ${a.rivals.map((r) => `<strong>${escapeHtml(r)}</strong>`).join(' y ')}`);
  return `
    ${pill || score ? `<div class="act-match">${pill}${score}</div>` : ''}
    ${people.length ? `<p class="act-people">${people.join(' ')}</p>` : ''}`;
}

function planLine(a) {
  if (!a.plan?.planId) return '';
  const name = getPlan(a.plan.planId)?.name ?? (a.plan.planId === 'premium' ? 'Plan personalizado' : 'Plan de físico');
  return `<p class="act-plan">📋 ${escapeHtml(name)}</p>`;
}

function statsRow(a) {
  const items = [];
  if (a.seconds > 0) items.push(['Duración', formatDuration(a.seconds)]);
  if (a.rpe) items.push(['Esfuerzo', `${a.rpe}/10`]);
  if (!items.length) return '';
  return `<dl class="act-stats">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

const kudosWhoLabel = (n) => `${n} ¡Vamos!`;

function footer(a) {
  const id = attr(a.id);
  const kudos = Number(a.kudosCount) || 0;
  const comments = Number(a.commentsCount) || 0;
  // En tus propias actividades no te das "¡Vamos!" a ti mismo: el botón muestra quién te lo ha dado.
  const kudosButton = a.isMine
    ? `<button class="kudos-btn kudos-own" data-action="show-kudoers" data-id="${id}" aria-label="Ver quién te ha dado ¡Vamos! (${kudos})">
        <span class="kudos-icon" aria-hidden="true">🙌</span><span class="kudos-label">¡Vamos!</span><span class="kudos-count">${kudos}</span>
      </button>`
    : `<button class="kudos-btn${a.kudoedByMe ? ' kudos-on' : ''}" data-action="kudos" data-id="${id}" data-kudos-btn="${id}"
        data-count="${kudos}" aria-pressed="${a.kudoedByMe ? 'true' : 'false'}">
        <span class="kudos-icon" aria-hidden="true">🙌</span><span class="kudos-label">¡Vamos!</span><span class="kudos-count"${kudos ? '' : ' hidden'}>${kudos}</span>
      </button>`;
  return `
    <footer class="act-foot">
      ${kudosButton}
      <button class="act-cm-btn" data-action="open-activity" data-id="${id}" data-focus="comment" aria-label="Comentar (${comments})">
        <span aria-hidden="true">💬</span><span class="act-cm-count" data-cm-for="${id}"${comments ? '' : ' hidden'}>${comments}</span>
      </button>
      ${a.isMine ? '' : `<button class="kudos-who" data-action="show-kudoers" data-id="${id}" data-kudos-who="${id}"${kudos ? '' : ' hidden'}>${kudosWhoLabel(kudos)}</button>`}
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
  const fullDate = formatWhen(a.date, now);
  const when = link ? timeAgo(a.date, now) : fullDate;
  const TitleTag = link ? 'h2' : 'h1';
  const titleHtml = link
    ? `<a class="act-title-link" href="#actividad" data-route="actividad" data-param-id="${id}">${escapeHtml(title)}</a>`
    : escapeHtml(title);

  return `
    <article class="card act-card${link ? ' act-linked' : ''}" ${link ? `data-action="open-activity" data-id="${id}"` : ''} style="--type:var(--t-${type})">
      <header class="act-head">
        <a class="act-avatar" ${profileLink(author.id)} tabindex="-1" aria-hidden="true">${avatar(author)}</a>
        <div class="act-who">
          <span class="act-name-line"><a class="act-name" ${profileLink(author.id)}>${escapeHtml(author.name)}</a>${premiumBadge(author)}${demoTag(author)}</span>
          <span class="act-meta"><time datetime="${attr(a.date)}" title="${attr(fullDate)}">${escapeHtml(when)}</time>${a.club ? ` · ${escapeHtml(a.club)}` : ''}</span>
        </div>
        <span class="act-type" title="${attr(ACTIVITY_TYPES[type].label)}" aria-hidden="true">${ACTIVITY_TYPES[type].icon}</span>
      </header>
      <${TitleTag} class="act-title">${titleHtml}</${TitleTag}>
      ${matchBlock(a, { full: !link })}
      ${planLine(a)}
      ${a.text ? `<p class="act-text${link ? ' act-text-clamp' : ''}">${escapeHtml(a.text)}</p>` : ''}
      ${statsRow(a)}
      ${a.photoUrl ? `
        <figure class="act-photo">
          <img src="${attr(a.photoUrl)}" alt="${attr(`Foto de ${author.name}: ${title}`)}" loading="${link ? 'lazy' : 'eager'}" decoding="async" />
        </figure>` : ''}
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
    el.textContent = String(n);
    el.hidden = n === 0;
    el.closest('.act-cm-btn')?.setAttribute('aria-label', `Comentar (${n})`);
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

function kudoerRow(p) {
  return `
    <li>
      <button class="kudos-person" data-route="perfil" data-param-id="${attr(p.id)}">
        ${avatar(p)}<span class="kudos-person-name">${escapeHtml(p.name)}</span>${premiumBadge(p)}${demoTag(p)}
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
        <h2>🙌 ¡Vamos! <span class="muted">${people.length}</span></h2>
        ${people.length
          ? `<ul class="kudos-list">${people.map(kudoerRow).join('')}</ul>`
          : '<p class="muted">Aún nadie ha dado ¡Vamos! a esta actividad.</p>'}
      </div>`);
  },
};
