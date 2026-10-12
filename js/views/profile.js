import { POSITIONS } from '../activities.js';
import { completedChallenges } from '../challenges.js';
import { activityCard, globalActions } from '../components.js';
import { LEVELS } from '../data.js';
import { achievements, matchStats, weekSummary, weeklyStreak } from '../stats.js';
import { avatar, emptyState, escapeHtml, formatHours, premiumBadge, sheet } from '../ui.js';

// Perfil (mío o de otro jugador): cabecera social, rachas y balance, logros y su actividad.

const PAGE = 20;
const STATS_LIMIT = 500; // actividades de otro jugador que se usan para sus estadísticas
const GOAL_MAX = 7;

const plural = (n, one, many) => (n === 1 ? one : many);
const attr = (v) => escapeHtml(v ?? '');

const demoTag = (p) => (p?.demo ? '<span class="prof-demo" title="Jugador de ejemplo del modo demo">ejemplo</span>' : '');

const backLink = '<button class="link prof-back" data-action="back">← Volver</button>';

// ---------- Cabecera ----------

function metaLine(p) {
  return [p.club, LEVELS[p.level]?.label, POSITIONS[p.position]].filter(Boolean).map(escapeHtml).join(' · ');
}

function followButton(p) {
  const on = Boolean(p.followedByMe);
  return `
    <button class="btn prof-follow${on ? '' : ' primary'}" data-action="${on ? 'unfollow' : 'follow'}"
      data-user-id="${attr(p.id)}" data-name="${attr(p.name)}" aria-pressed="${on ? 'true' : 'false'}">${on ? 'Siguiendo' : 'Seguir'}</button>`;
}

function header(p, { isMe, activityCount }) {
  const id = attr(p.id);
  const meta = metaLine(p);
  const followers = Number(p.followersCount) || 0;
  const following = Number(p.followingCount) || 0;
  return `
    <header class="card prof-head">
      <div class="prof-top">
        ${avatar(p, 'lg')}
        <div class="prof-id">
          <h1 class="prof-name"><span>${escapeHtml(p.name)}</span>${premiumBadge(p)}${demoTag(p)}</h1>
          ${meta ? `<p class="prof-meta">${meta}</p>` : ''}
        </div>
      </div>
      ${p.bio ? `<p class="prof-bio">${escapeHtml(p.bio)}</p>` : ''}
      <div class="prof-counts">
        <div class="prof-count"><strong>${escapeHtml(activityCount)}</strong><span>actividades</span></div>
        <button class="prof-count" data-action="show-people" data-kind="followers" data-owner="${id}">
          <strong data-prof-followers="${id}">${followers}</strong><span>${plural(followers, 'seguidor', 'seguidores')}</span>
        </button>
        <button class="prof-count" data-action="show-people" data-kind="following" data-owner="${id}">
          <strong>${following}</strong><span>siguiendo</span>
        </button>
      </div>
      <div class="prof-actions">
        ${isMe ? '<button class="btn" data-route="ajustes">Editar perfil</button>' : followButton(p)}
      </div>
    </header>`;
}

// ---------- Destacados ----------

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

function highlights(activities, stats, ctx, isMe) {
  const streak = weeklyStreak(activities, ctx.now);
  const atRisk = isMe && streak.weeks > 0 && !streak.activeThisWeek;
  return `
    <div class="prof-highlights">
      <div class="card prof-stat">
        <span class="prof-stat-big">🔥 ${streak.weeks}</span>
        <span class="prof-stat-label">${plural(streak.weeks, 'semana', 'semanas')} de racha</span>
        ${atRisk ? '<span class="prof-stat-sub prof-risk">¡Juega esta semana!</span>' : ''}
      </div>
      <div class="card prof-stat">
        <span class="prof-stat-big">${stats.won}–${stats.lost}</span>
        <span class="prof-stat-label">Partidos G–P</span>
        <span class="prof-stat-sub">${stats.winRate == null ? 'Sin resultados' : `${stats.winRate} % victorias`}</span>
      </div>
      <div class="card prof-stat">
        <span class="prof-stat-big">${escapeHtml(formatHours(monthMinutes(activities, ctx.now)))}</span>
        <span class="prof-stat-label">Este mes</span>
      </div>
    </div>`;
}

// ---------- Logros ----------

function badgeStrip(list, isMe) {
  const unlocked = list.filter((b) => b.unlocked);
  const items = unlocked.length
    ? `<ul class="prof-badges">${unlocked.map((b) => `
        <li class="prof-badge" title="${attr(b.description)}">
          <span class="prof-badge-icon" aria-hidden="true">${escapeHtml(b.icon)}</span>
          <span class="prof-badge-label">${escapeHtml(b.label)}</span>
        </li>`).join('')}</ul>`
    : `<p class="muted">${isMe ? 'Aún no tienes logros: publica tu primer partido para estrenarte.' : 'Aún no tiene logros.'}</p>`;
  return `
    <section class="card prof-logros${isMe ? ' prof-tap' : ''}" aria-labelledby="prof-logros-title" ${isMe ? 'data-route="retos"' : ''}>
      <div class="row-between">
        <h2 id="prof-logros-title">Logros <span class="muted">${unlocked.length}/${list.length}</span></h2>
        ${isMe ? '<button class="link" data-route="retos">Ver todos</button>' : ''}
      </div>
      ${items}
    </section>`;
}

// ---------- Solo en mi perfil ----------

function delta(diff, format = String) {
  if (!diff) return '<span class="prof-delta">=</span>';
  return diff > 0
    ? `<span class="prof-delta up">+${escapeHtml(format(diff))}</span>`
    : `<span class="prof-delta down">−${escapeHtml(format(-diff))}</span>`;
}

function weekCard(activities, ctx) {
  const { current: cur, previous: prev } = weekSummary(activities, ctx.now);
  const goal = Math.min(GOAL_MAX, Math.max(1, Math.round(Number(ctx.settings?.weeklyGoal) || 3)));
  const pct = Math.min(100, Math.round((cur.count / goal) * 100));
  return `
    <section class="card prof-week" aria-labelledby="prof-week-title">
      <div class="row-between">
        <h2 id="prof-week-title">Tu semana</h2>
        <span class="muted">${cur.count}/${goal} de tu objetivo</span>
      </div>
      <div class="prof-progress" role="progressbar" aria-label="Objetivo semanal" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(cur.count, goal)}">
        <span style="width:${pct}%"></span>
      </div>
      <dl class="prof-week-grid">
        <div><dt>Actividades</dt><dd>${cur.count} ${delta(cur.count - prev.count)}</dd></div>
        <div><dt>Tiempo</dt><dd>${escapeHtml(formatHours(cur.minutes))} ${delta(cur.minutes - prev.minutes, formatHours)}</dd></div>
        <div><dt>Partidos G–P</dt><dd>${cur.wins}–${cur.losses}</dd></div>
      </dl>
      <p class="prof-week-note muted">Comparado con la semana pasada</p>
    </section>`;
}

function partnersCard(stats) {
  const top = stats.partners.slice(0, 3);
  if (!top.length) return '';
  return `
    <section class="card prof-partners" aria-labelledby="prof-partners-title">
      <h2 id="prof-partners-title">Mejores compañeros</h2>
      <ol class="prof-partner-list">
        ${top.map((p) => `
          <li class="prof-partner">
            <span class="prof-partner-name">${escapeHtml(p.name)}</span>
            <span class="muted">${p.played} ${plural(p.played, 'partido', 'partidos')}</span>
            <span class="prof-partner-rec">${p.won}–${p.lost}</span>
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
    return isMe
      ? emptyState({
        icon: '🎾',
        title: 'Aún no has publicado nada',
        text: 'Tu primer partido o entreno aparecerá aquí.',
        action: '<button class="btn primary" data-route="publicar">Publicar actividad</button>',
      })
      : emptyState({ icon: '🎾', title: 'Todavía no ha publicado nada', text: `Cuando ${profile.name} publique, lo verás aquí.` });
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
  return `
    <li>
      <button class="prof-person" data-route="perfil" ${isMe ? '' : `data-param-id="${attr(p.id)}"`}>
        ${avatar(p, 'sm')}<span class="prof-person-name">${isMe ? 'Tú' : escapeHtml(p.name)}</span>${premiumBadge(p)}${demoTag(p)}
      </button>
    </li>`;
}

function bumpFollowers(userId, diff) {
  for (const el of document.querySelectorAll('[data-prof-followers]')) {
    if (el.getAttribute('data-prof-followers') !== String(userId)) continue;
    const n = Math.max(0, (Number(el.textContent) || 0) + diff);
    el.textContent = String(n);
    const label = el.nextElementSibling;
    if (label) label.textContent = plural(n, 'seguidor', 'seguidores');
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
          ${backLink}
          ${emptyState({
            icon: '🤷',
            title: 'No encontramos a este jugador',
            text: 'Puede que el enlace ya no sea válido.',
            action: '<button class="btn primary" data-route="buscar">Buscar jugadores</button>',
          })}
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
        ${isMe ? '' : backLink}
        ${header(profile, { isMe, activityCount })}
        ${highlights(all, stats, ctx, isMe)}
        ${badgeStrip(badges, isMe)}
        ${isMe ? weekCard(all, ctx) : ''}
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
            : `<p class="muted">${empty}</p>${mine && !followers ? '<button class="btn primary" data-route="buscar">Buscar jugadores</button>' : ''}`}
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
