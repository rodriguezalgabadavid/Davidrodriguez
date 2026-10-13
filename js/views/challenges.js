import { challengeProgress, completedChallenges, currentChallenges, leaderboard } from '../challenges.js';
import { demoTag } from '../components.js';
import { icon } from '../icons.js';
import { achievements } from '../stats.js';
import { avatar, escapeHtml, premiumBadge, toast } from '../ui.js';

// Retos: completar cosas es el gancho. Retos de la semana y del mes, clasificación entre amigos
// y los logros que se ganan por el camino.

const TOP = 5;

const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const fmt = (n) => numFmt.format(Number(n) || 0);
const plural = (n, one, many) => (n === 1 ? one : many);

const endsText = (days) => (days <= 1 ? 'Termina hoy' : `Quedan ${days} días`);

function progressBar(value, target, pct, label) {
  return `
    <div class="progress ch-progress" role="progressbar" aria-label="${escapeHtml(label)}"
      aria-valuemin="0" aria-valuemax="${Number(target) || 0}" aria-valuenow="${Math.min(Number(value) || 0, Number(target) || 0)}">
      <div style="width:${Math.min(100, Math.max(0, Number(pct) || 0))}%"></div>
    </div>`;
}

// ---------- Clasificación "Entre tus amigos" ----------

// Filas con puesto (empates comparten puesto). Siempre aparezco yo, aunque aún no sume nada.
function rankedRows(challenge, progress, circle, ctx) {
  const rows = leaderboard(challenge, circle, ctx.now).filter((r) => r.isMine || r.value > 0);
  if (!rows.some((r) => r.isMine)) {
    rows.push({ userId: ctx.me?.id, author: ctx.me, isMine: true, value: progress.value });
    rows.sort((a, b) => b.value - a.value);
  }
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.value !== rows[i - 1].value) rank = i + 1;
    return { ...r, rank };
  });
}

function boardRow(r, unit) {
  const author = r.author ?? { id: r.userId, name: 'Jugador' };
  const target = r.isMine ? 'data-route="perfil"' : `data-route="perfil" data-param-id="${escapeHtml(r.userId)}"`;
  const name = r.isMine ? 'Tú' : author.name;
  return `
    <li class="ch-row${r.isMine ? ' ch-me' : ''}">
      <span class="ch-rank"><span class="sr-only">Puesto </span>${r.rank}</span>
      <a class="ch-person" href="#perfil" ${target}>
        <span class="ch-person-avatar" aria-hidden="true">${avatar(author, 'sm')}</span>
        <span class="ch-person-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>${r.isMine ? '' : premiumBadge(author)}${demoTag(author)}
      </a>
      <span class="ch-value"><span aria-hidden="true">${fmt(r.value)}</span><span class="sr-only">${escapeHtml(`${fmt(r.value)} ${unit}`)}</span></span>
    </li>`;
}

function board(challenge, progress, circle, ctx) {
  if (!circle) return '<p class="ch-board-note">No se ha podido cargar la clasificación.</p>';
  const rows = rankedRows(challenge, progress, circle, ctx);
  const others = rows.filter((r) => !r.isMine);
  if (!others.length) {
    const text = (ctx.me?.followingCount ?? 0) > 0
      ? 'Tus amigos aún no suman en este reto. ¡Toma ventaja!'
      : 'Sigue a jugadores para competir con tus amigos.';
    return `
      <div class="ch-board ch-board-empty">
        <span class="ch-board-icon" aria-hidden="true">${icon('users', { size: 20 })}</span>
        <p>${text}</p>
        <button class="btn ch-invite" data-route="buscar">${icon('search', { size: 18 })}<span>Buscar jugadores</span></button>
      </div>`;
  }
  const top = rows.slice(0, TOP);
  const mine = rows.findIndex((r) => r.isMine);
  const extra = mine >= TOP ? `<li class="ch-gap" aria-hidden="true">···</li>${boardRow(rows[mine], challenge.unit)}` : '';
  return `
    <div class="ch-board">
      <h4 class="label ch-board-title">Entre tus amigos <span class="ch-board-unit">· ${escapeHtml(challenge.unit)}</span></h4>
      <ol class="ch-rows">${top.map((r) => boardRow(r, challenge.unit)).join('')}${extra}</ol>
    </div>`;
}

// ---------- Tarjeta de reto ----------

function challengeCard({ c, p, joined }, circle, ctx) {
  const period = c.period === 'week' ? 'Semanal' : 'Mensual';
  const unit = escapeHtml(c.unit);
  let body;
  if (joined && p.done) {
    body = `
      ${progressBar(p.value, p.target, 100, `Completado: ${fmt(p.value)} de ${p.target} ${c.unit}`)}
      <div class="ch-status">
        <span class="ch-done-text">${icon('check', { size: 20 })}<span>¡Completado!</span></span>
        <span class="ch-of"><strong>${fmt(p.value)}</strong> de ${p.target} ${unit}</span>
      </div>`;
  } else if (joined) {
    const cta = c.metric === 'fitness'
      ? `<button class="link ch-cta" data-route="entrenar">Entrenar ahora${icon('chevron', { size: 18 })}</button>`
      : `<button class="link ch-cta" data-route="publicar">Publicar actividad${icon('chevron', { size: 18 })}</button>`;
    body = `
      ${progressBar(p.value, p.target, p.pct, `${fmt(p.value)} de ${p.target} ${c.unit}`)}
      <div class="ch-status">
        <span class="ch-of"><strong>${fmt(p.value)}</strong> de ${p.target} ${unit}</span>
        <span class="ch-left">Te faltan ${fmt(p.target - p.value)}</span>
      </div>
      ${cta}`;
  } else {
    body = `
      ${p.value > 0 ? `<p class="ch-hint">${icon('bolt', { size: 18 })}<span>Ya llevas ${fmt(p.value)} de ${p.target}. Únete y que cuente.</span></p>` : ''}
      <button class="btn primary ch-join" data-action="join" data-instance-id="${escapeHtml(c.instanceId)}">${icon('plus', { size: 20 })}<span>Unirme</span></button>`;
  }

  return `
    <article class="card ch-card${joined && p.done ? ' ch-done' : ''}">
      <div class="ch-card-head">
        <span class="ch-icon" aria-hidden="true">${escapeHtml(c.icon)}</span>
        <div class="ch-info">
          <p class="ch-meta">
            <span class="ch-period">${period}</span>
            <span class="ch-ends">${icon('clock', { size: 16 })}<span>${endsText(p.endsInDays)}</span></span>
          </p>
          <h3 class="ch-title">${escapeHtml(c.title)}</h3>
          <p class="ch-desc">${escapeHtml(c.description)}</p>
        </div>
      </div>
      ${body}
      ${joined ? board(c, p, circle, ctx) : ''}
    </article>`;
}

function challengeSection(id, title, items, circles, ctx) {
  if (!items.length) return '';
  return `
    <section class="ch-section" aria-labelledby="${id}">
      <h2 id="${id}" class="ch-section-title">${title}</h2>
      <div class="ch-list">
        ${items.map((item) => challengeCard(item, circles.get(item.c.period), ctx)).join('')}
      </div>
    </section>`;
}

// ---------- Logros ----------

function achievementsSection(list) {
  const unlocked = list.filter((b) => b.unlocked);
  const sorted = [...unlocked, ...list.filter((b) => !b.unlocked)];
  return `
    <section class="ch-section" aria-labelledby="ch-ach-title">
      <div class="ch-section-head">
        <h2 id="ch-ach-title" class="ch-section-title">Tus logros</h2>
        <span class="ch-section-count">${unlocked.length} de ${list.length}</span>
      </div>
      <ul class="ch-badges">
        ${sorted.map((b) => `
          <li class="ch-badge${b.unlocked ? ' on' : ''}">
            <span class="ch-medal" aria-hidden="true">
              <span class="ch-medal-art">${escapeHtml(b.icon)}</span>
              ${b.unlocked ? `<span class="ch-medal-mark on">${icon('check', { size: 12 })}</span>` : `<span class="ch-medal-mark">${icon('lock', { size: 12 })}</span>`}
            </span>
            <strong class="ch-badge-name">${escapeHtml(b.label)}</strong>
            <span class="ch-badge-desc"><span class="sr-only">${b.unlocked ? 'Conseguido: ' : 'Pendiente: '}</span>${escapeHtml(b.description)}</span>
          </li>`).join('')}
      </ul>
    </section>`;
}

// ---------- Vista ----------

export default {
  route: 'retos',
  tab: 'retos',

  async render(ctx) {
    const { backend, now } = ctx;
    const [myActivities, joined, planState] = await Promise.all([
      backend.getMyActivities(),
      backend.getJoinedChallenges(),
      backend.getPlanState().catch(() => null),
    ]);

    const joinedSet = new Set(joined);
    const items = currentChallenges(now).map((c) => ({ c, p: challengeProgress(c, myActivities, now), joined: joinedSet.has(c.instanceId) }));
    // Primero los míos sin completar, luego los completados y al final los demás.
    const order = (x) => (x.joined ? (x.p.done ? 1 : 0) : 2);
    items.sort((a, b) => order(a) - order(b));

    // Una sola petición por periodo (semana y mes) para las clasificaciones de mis retos.
    const ranges = new Map();
    for (const { c, joined: isJoined } of items) {
      if (isJoined && !ranges.has(c.period)) ranges.set(c.period, { from: c.from, to: c.to });
    }
    const circles = new Map(await Promise.all([...ranges].map(async ([period, { from, to }]) => [
      period,
      await backend.getCircleActivities({ from: from.toISOString(), to: to.toISOString() }).catch(() => null),
    ])));

    const completed = completedChallenges(joined, myActivities);
    const badges = achievements(myActivities, { completedChallenges: completed, finishedPlans: planState?.finished ?? [] });
    const done = completed.length;
    const mine = items.filter((x) => x.joined);
    const open = items.filter((x) => !x.joined);
    const active = mine.filter((x) => !x.p.done).length;
    const unlocked = badges.filter((b) => b.unlocked).length;

    return `
      <section class="ch-view">
        <header class="card ch-summary">
          <span class="ch-summary-icon" aria-hidden="true">${icon('medal', { size: 28 })}</span>
          <div class="ch-summary-body">
            <dl class="stats-row ch-summary-stats">
              <div><dt class="stat-label">Completados</dt><dd class="stat-value">${done}</dd></div>
              <div><dt class="stat-label">En curso</dt><dd class="stat-value">${active}</dd></div>
              <div><dt class="stat-label">Logros</dt><dd class="stat-value">${unlocked}<small>/${badges.length}</small></dd></div>
            </dl>
            <p class="ch-summary-note">${done
              ? `Llevas ${done} ${plural(done, 'reto completado', 'retos completados')}. ¡Sigue así!`
              : 'Completa retos para ganar logros.'}</p>
          </div>
        </header>

        ${challengeSection('ch-mine-title', 'Tus retos', mine, circles, ctx)}
        ${challengeSection('ch-open-title', mine.length ? 'Únete a más retos' : 'Retos disponibles', open, circles, ctx)}

        ${achievementsSection(badges)}
      </section>`;
  },

  actions: {
    async join(el, ctx) {
      const id = el.dataset.instanceId;
      if (!id) return;
      el.disabled = true;
      try {
        await ctx.backend.joinChallenge(id);
      } catch (error) {
        el.disabled = false;
        throw error;
      }
      toast('¡Reto aceptado! A por él');
      ctx.rerender();
    },
  },
};
