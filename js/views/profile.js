import { POSITIONS } from '../activities.js';
import { completedChallenges } from '../challenges.js';
import { activityCard, demoTag, globalActions } from '../components.js';
import { LEVELS } from '../data.js';
import { icon } from '../icons.js';
import { achievements, matchStats, weekSummary, weeklyStreak } from '../stats.js';
import { avatar, emptyState, escapeHtml, formatHours, premiumBadge, sheet } from '../ui.js';

// Perfil (mío o de otro jugador) al estilo del perfil de atleta de Strava: cabecera con avatar grande,
// contadores, la semana y las estadísticas, la tira de logros, compañeros y su actividad.

const PAGE = 20;
const STATS_LIMIT = 500; // actividades de otro jugador que se usan para sus estadísticas
const GOAL_MAX = 7;

const plural = (n, one, many) => (n === 1 ? one : many);
const attr = (v) => escapeHtml(v ?? '');

// ---------- Cabecera ----------

function metaLine(p) {
  const level = LEVELS[p.level]?.label;
  const parts = [level ? `Nivel ${level.toLowerCase()}` : '', POSITIONS[p.position] ?? ''].filter(Boolean);
  return `
    ${p.club ? `<p class="prof-meta prof-club">${icon('pin', { size: 16 })}<span>${escapeHtml(p.club)}</span></p>` : ''}
    ${parts.length ? `<p class="prof-meta">${parts.map((t) => `<span class="prof-meta-item">${escapeHtml(t)}</span>`).join('')}</p>` : ''}`;
}

function followButton(p) {
  const on = Boolean(p.followedByMe);
  return `
    <button class="btn big prof-follow${on ? '' : ' primary'}" data-action="${on ? 'unfollow' : 'follow'}"
      data-user-id="${attr(p.id)}" data-name="${attr(p.name)}" aria-pressed="${on ? 'true' : 'false'}">${on ? 'Siguiendo' : 'Seguir'}</button>`;
}

function header(p, { isMe, activityCount }) {
  const id = attr(p.id);
  const followers = Number(p.followersCount) || 0;
  const following = Number(p.followingCount) || 0;
  const acts = Number.parseInt(activityCount, 10) || 0;
  return `
    <header class="card prof-head">
      <div class="prof-top">
        <span class="prof-avatar">${avatar(p, 'lg')}</span>
        <div class="prof-id">
          <h2 class="prof-name"><span class="prof-name-text">${escapeHtml(p.name)}</span>${premiumBadge(p)}${demoTag(p)}</h2>
          ${metaLine(p)}
        </div>
      </div>
      ${p.bio ? `<p class="prof-bio">${escapeHtml(p.bio)}</p>` : ''}
      <div class="prof-counts">
        <button class="prof-count" data-action="show-people" data-kind="following" data-owner="${id}">
          <strong class="prof-count-num">${following}</strong><span class="prof-count-label">Siguiendo</span>
        </button>
        <button class="prof-count" data-action="show-people" data-kind="followers" data-owner="${id}">
          <strong class="prof-count-num" data-prof-followers="${id}">${followers}</strong><span class="prof-count-label">${plural(followers, 'Seguidor', 'Seguidores')}</span>
        </button>
        <div class="prof-count">
          <strong class="prof-count-num">${escapeHtml(activityCount)}</strong><span class="prof-count-label">${plural(acts, 'Actividad', 'Actividades')}</span>
        </div>
      </div>
      ${isMe ? `<button class="btn big prof-edit" data-route="ajustes">${icon('edit', { size: 20 })}<span>Editar perfil</span></button>` : followButton(p)}
    </header>`;
}

// ---------- Esta semana (solo en mi perfil) ----------

function delta(diff, format = String) {
  if (!diff) return '<dd class="prof-delta">Igual</dd>';
  return diff > 0
    ? `<dd class="prof-delta up">+${escapeHtml(format(diff))}</dd>`
    : `<dd class="prof-delta down">−${escapeHtml(format(-diff))}</dd>`;
}

function weekCard(activities, ctx) {
  const { current: cur, previous: prev } = weekSummary(activities, ctx.now);
  const goal = Math.min(GOAL_MAX, Math.max(1, Math.round(Number(ctx.settings?.weeklyGoal) || 3)));
  const pct = Math.min(100, Math.round((cur.count / goal) * 100));
  const reached = cur.count >= goal;
  return `
    <section class="card prof-card" aria-labelledby="prof-week-title">
      <div class="prof-card-head">
        <h2 id="prof-week-title">Esta semana</h2>
        <span class="prof-goal${reached ? ' done' : ''}">${reached ? icon('check', { size: 18 }) : ''}<span><strong>${cur.count}</strong> de ${goal} de tu objetivo</span></span>
      </div>
      <div class="progress prof-goal-bar${reached ? ' done' : ''}" role="progressbar" aria-label="Objetivo semanal"
        aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(cur.count, goal)}"><div style="width:${pct}%"></div></div>
      <dl class="stats-row prof-week-stats">
        <div><dt class="stat-label">Actividades</dt><dd class="stat-value">${cur.count}</dd>${delta(cur.count - prev.count)}</div>
        <div><dt class="stat-label">Tiempo</dt><dd class="stat-value">${escapeHtml(formatHours(cur.minutes))}</dd>${delta(cur.minutes - prev.minutes, formatHours)}</div>
        <div><dt class="stat-label">Partidos G–P</dt><dd class="stat-value">${cur.wins}–${cur.losses}</dd></div>
      </dl>
      <p class="prof-note">Diferencia con la semana pasada</p>
    </section>`;
}

// ---------- Estadísticas ----------

function monthMinutes(activities, now) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const seconds = activities
    .filter((a) => {
      const d = new Date(a.date);
      return d >= from && d < to;
    })
    .reduce((s, a) => s + (Number(a.seconds) || 0), 0);
  return Math.round(seconds / 60);
}

function statsCard(activities, stats, ctx, isMe) {
  const streak = weeklyStreak(activities, ctx.now);
  const atRisk = isMe && streak.weeks > 0 && !streak.activeThisWeek;
  const rate = stats.winRate == null
    ? '<span aria-hidden="true">—</span><span class="sr-only">Sin resultados</span>'
    : `${stats.winRate}<small>%</small>`;
  return `
    <section class="card prof-card" aria-labelledby="prof-stats-title">
      <h2 id="prof-stats-title">Estadísticas</h2>
      <dl class="stats-row prof-stats">
        <div>
          <dt class="stat-label">Racha</dt>
          <dd class="stat-value prof-streak"><span class="prof-flame${streak.weeks ? ' on' : ''}" aria-hidden="true">${icon('flame', { size: 16 })}</span>${streak.weeks}<small aria-hidden="true">sem.</small><span class="sr-only"> ${plural(streak.weeks, 'semana', 'semanas')}</span></dd>
        </div>
        <div><dt class="stat-label">Partidos G–P</dt><dd class="stat-value">${stats.won}–${stats.lost}</dd></div>
        <div><dt class="stat-label">Victorias</dt><dd class="stat-value">${rate}</dd></div>
        <div><dt class="stat-label">Horas este mes</dt><dd class="stat-value">${escapeHtml(formatHours(monthMinutes(activities, ctx.now)))}</dd></div>
      </dl>
      ${atRisk ? `<p class="prof-risk">${icon('flame', { size: 18 })}<span>¡Juega esta semana para no perder tu racha!</span></p>` : ''}
    </section>`;
}

// ---------- Logros ----------

function medal(b) {
  return `
    <li class="prof-medal${b.unlocked ? ' on' : ''}" title="${attr(b.description)}">
      <span class="prof-medal-disc" aria-hidden="true">
        <span class="prof-medal-art">${escapeHtml(b.icon)}</span>
        ${b.unlocked ? '' : `<span class="prof-medal-lock">${icon('lock', { size: 12 })}</span>`}
      </span>
      <span class="prof-medal-label">${b.unlocked ? '' : '<span class="sr-only">Pendiente: </span>'}${escapeHtml(b.label)}</span>
    </li>`;
}

function badgeStrip(list, isMe) {
  const unlocked = list.filter((b) => b.unlocked);
  const sorted = [...unlocked, ...list.filter((b) => !b.unlocked)];
  const empty = isMe ? 'Aún no tienes logros: publica tu primer partido para estrenarte.' : 'Aún no tiene logros.';
  return `
    <section class="card prof-card${isMe ? ' prof-tap' : ''}" aria-labelledby="prof-logros-title" ${isMe ? 'data-route="retos"' : ''}>
      <div class="prof-card-head">
        <h2 id="prof-logros-title">Logros <span class="prof-head-count">${unlocked.length}/${list.length}</span></h2>
        ${isMe ? `<button class="link prof-see-all" data-route="retos">Ver todos${icon('chevron', { size: 18 })}</button>` : ''}
      </div>
      ${unlocked.length ? '' : `<p class="prof-note">${empty}</p>`}
      <ul class="prof-medals" tabindex="0" aria-labelledby="prof-logros-title">${sorted.map(medal).join('')}</ul>
    </section>`;
}

// ---------- Mejores compañeros (solo en mi perfil) ----------

function partnersCard(stats) {
  const top = stats.partners.slice(0, 3);
  if (!top.length) return '';
  return `
    <section class="card prof-card" aria-labelledby="prof-partners-title">
      <h2 id="prof-partners-title">Mejores compañeros</h2>
      <ol class="prof-rows">
        ${top.map((p) => `
          <li class="prof-row">
            <span class="prof-row-avatar" aria-hidden="true">${avatar({ id: p.name, name: p.name })}</span>
            <span class="prof-row-text">
              <strong class="prof-row-name" title="${attr(p.name)}">${escapeHtml(p.name)}</strong>
              <span class="prof-row-sub">${p.played} ${plural(p.played, 'partido juntos', 'partidos juntos')}</span>
            </span>
            <span class="prof-row-end">
              <strong class="prof-rec">${p.won}–${p.lost}</strong>
              <span class="prof-row-sub">G–P</span>
            </span>
          </li>`).join('')}
      </ol>
    </section>`;
}

// ---------- Actividad ----------

function moreButton(ownerId, list) {
  if (list.length < PAGE) return '';
  return `<button class="btn prof-more" data-action="more" data-owner="${attr(ownerId)}" data-before="${attr(list.at(-1).date)}" data-before-id="${attr(list.at(-1).id)}">Ver más</button>`;
}

function activitySection(list, ctx, { isMe, profile }) {
  if (!list.length) {
    const state = isMe
      ? emptyState({
        icon: icon('ball', { size: 30 }),
        title: 'Aún no has publicado nada',
        text: 'Tu primer partido o entreno aparecerá aquí.',
        action: `<button class="btn primary" data-route="publicar">${icon('plus', { size: 20 })}<span>Publicar actividad</span></button>`,
      })
      : emptyState({ icon: icon('ball', { size: 30 }), title: 'Todavía no ha publicado nada', text: `Cuando ${profile.name} publique, lo verás aquí.` });
    return `<div class="card prof-empty">${state}</div>`;
  }
  return `
    <section class="prof-activity" aria-labelledby="prof-act-title">
      <h2 id="prof-act-title" class="prof-section-title">${isMe ? 'Tu actividad' : 'Actividad'}</h2>
      <div class="prof-list" id="prof-list">${list.map((a) => activityCard(a, ctx)).join('')}</div>
      ${moreButton(profile.id, list)}
    </section>`;
}

// ---------- Seguidores / siguiendo ----------

function personRow(p, meId) {
  const isMe = Boolean(meId) && p.id === meId;
  const name = isMe ? 'Tú' : p.name;
  return `
    <li>
      <button class="prof-person" data-route="perfil" ${isMe ? '' : `data-param-id="${attr(p.id)}"`}>
        <span class="prof-row-avatar" aria-hidden="true">${avatar(p)}</span>
        <span class="prof-person-name" title="${attr(name)}">${escapeHtml(name)}</span>${premiumBadge(p)}${demoTag(p)}
        <span class="prof-person-go" aria-hidden="true">${icon('chevron', { size: 18 })}</span>
      </button>
    </li>`;
}

function bumpFollowers(userId, diff) {
  for (const el of document.querySelectorAll('[data-prof-followers]')) {
    if (el.getAttribute('data-prof-followers') !== String(userId)) continue;
    const n = Math.max(0, (Number(el.textContent) || 0) + diff);
    el.textContent = String(n);
    const label = el.nextElementSibling;
    if (label) label.textContent = plural(n, 'Seguidor', 'Seguidores');
  }
}

// ---------- Vista ----------

export default {
  route: 'perfil',
  tab: 'perfil',

  async render(ctx) {
    const { backend, me } = ctx;
    const wanted = ctx.params?.id ? String(ctx.params.id) : null;
    const isMe = !wanted || wanted === me?.id;
    const id = isMe ? me.id : wanted;

    const [profile, list, all, joined, planState] = await Promise.all([
      isMe ? backend.getMe() : backend.getProfile(id),
      backend.getUserActivities(id, { limit: PAGE }),
      isMe ? backend.getMyActivities() : backend.getUserActivities(id, { limit: STATS_LIMIT }),
      isMe ? backend.getJoinedChallenges().catch(() => []) : [],
      isMe ? backend.getPlanState().catch(() => null) : null,
    ]);

    if (!profile) {
      return `
        <section class="prof-view">
          <div class="card prof-empty">
            ${emptyState({
              icon: icon('user', { size: 30 }),
              title: 'No encontramos a este jugador',
              text: 'Puede que el enlace ya no sea válido.',
              action: `<button class="btn primary" data-route="buscar">${icon('search', { size: 20 })}<span>Buscar jugadores</span></button>`,
            })}
          </div>
        </section>`;
    }

    const stats = matchStats(all);
    // Para mí cuentan también retos y planes; de otros jugadores solo vemos sus actividades.
    const badges = isMe
      ? achievements(all, { completedChallenges: completedChallenges(joined, all), finishedPlans: planState?.finished ?? [] })
      : achievements(all);
    const activityCount = !isMe && all.length >= STATS_LIMIT ? `${STATS_LIMIT}+` : String(all.length);

    return `
      <section class="prof-view">
        ${header(profile, { isMe, activityCount })}
        ${isMe ? weekCard(all, ctx) : ''}
        ${statsCard(all, stats, ctx, isMe)}
        ${badgeStrip(badges, isMe)}
        ${isMe ? partnersCard(stats) : ''}
        ${activitySection(list, ctx, { isMe, profile })}
      </section>`;
  },

  actions: {
    back(el, ctx) {
      ctx.back();
    },

    async more(el, ctx) {
      const list = document.getElementById('prof-list');
      if (!list) return;
      el.disabled = true;
      el.textContent = 'Cargando…';
      let items;
      try {
        items = await ctx.backend.getUserActivities(el.dataset.owner, { before: el.dataset.before, beforeId: el.dataset.beforeId, limit: PAGE });
      } catch (error) {
        el.disabled = false;
        el.textContent = 'Ver más';
        throw error;
      }
      const seen = new Set([...list.querySelectorAll('.act-card[data-id]')].map((card) => card.dataset.id));
      list.insertAdjacentHTML('beforeend', items.filter((a) => !seen.has(a.id)).map((a) => activityCard(a, ctx)).join(''));
      if (items.length < PAGE) {
        el.remove();
        return;
      }
      el.dataset.before = items.at(-1).date;
      el.dataset.beforeId = items.at(-1).id;
      el.disabled = false;
      el.textContent = 'Ver más';
    },

    async 'show-people'(el, ctx) {
      const owner = el.dataset.owner;
      if (!owner) return;
      const followers = el.dataset.kind === 'followers';
      const people = await (followers ? ctx.backend.getFollowers(owner) : ctx.backend.getFollowing(owner));
      const mine = owner === ctx.me?.id;
      const empty = followers
        ? (mine ? 'Aún no te sigue nadie. ¡Publica y te encontrarán!' : 'Aún no tiene seguidores.')
        : (mine ? 'Aún no sigues a nadie.' : 'Aún no sigue a nadie.');
      sheet(`
        <div class="prof-sheet">
          <h2>${followers ? 'Seguidores' : 'Siguiendo'} <span class="muted">${people.length}</span></h2>
          ${people.length
            ? `<ul class="prof-people">${people.map((p) => personRow(p, ctx.me?.id)).join('')}</ul>`
            : `<p class="muted">${empty}</p>${mine && !followers ? `<button class="btn primary big" data-route="buscar">${icon('search', { size: 20 })}<span>Buscar jugadores</span></button>` : ''}`}
        </div>`);
    },

    // Como las globales, y además actualizan el contador de seguidores de la cabecera.
    async follow(el, ctx) {
      const userId = el.dataset.userId;
      await globalActions.follow(el, ctx);
      bumpFollowers(userId, 1);
      ctx.refreshMe().catch(() => null);
    },

    async unfollow(el, ctx) {
      const userId = el.dataset.userId;
      await globalActions.unfollow(el, ctx);
      bumpFollowers(userId, -1);
      ctx.refreshMe().catch(() => null);
    },
  },
};
