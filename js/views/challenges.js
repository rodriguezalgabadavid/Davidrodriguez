import { challengeProgress, completedChallenges, currentChallenges, leaderboard } from '../challenges.js';
import { achievements } from '../stats.js';
import { avatar, escapeHtml, premiumBadge, toast } from '../ui.js';

// Retos: completar cosas es el gancho. Retos de la semana y del mes, clasificación entre amigos
// y los logros que se ganan por el camino.

const TOP = 5;

const numFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const fmt = (n) => numFmt.format(Number(n) || 0);
const plural = (n, one, many) => (n === 1 ? one : many);

const demoTag = (p) => (p?.demo ? '<span class="ch-demo" title="Jugador de ejemplo del modo demo">ejemplo</span>' : '');

const endsText = (days) => (days <= 1 ? 'Termina hoy' : `Termina en ${days} días`);

function progressBar(value, target, pct, label) {
  return `
    <div class="ch-progress" role="progressbar" aria-label="${escapeHtml(label)}"
      aria-valuemin="0" aria-valuemax="${Number(target) || 0}" aria-valuenow="${Math.min(Number(value) || 0, Number(target) || 0)}">
      <span style="width:${Math.min(100, Math.max(0, Number(pct) || 0))}%"></span>
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
  return `
    <li class="ch-row${r.isMine ? ' ch-me' : ''}">
      <span class="ch-rank">${r.rank}</span>
      <a class="ch-person" href="#perfil" ${target}>
        ${avatar(author, 'sm')}
        <span class="ch-person-name">${r.isMine ? 'Tú' : escapeHtml(author.name)}</span>${r.isMine ? '' : premiumBadge(author)}${demoTag(author)}
      </a>
      <span class="ch-value" aria-label="${escapeHtml(`${fmt(r.value)} ${unit}`)}">${fmt(r.value)}</span>
    </li>`;
}

function board(challenge, progress, circle, ctx) {
  if (!circle) return '<p class="ch-board-note muted">No se ha podido cargar la clasificación.</p>';
  const rows = rankedRows(challenge, progress, circle, ctx);
  const others = rows.filter((r) => !r.isMine);
  if (!others.length) {
    const text = (ctx.me?.followingCount ?? 0) > 0
      ? 'Tus amigos aún no suman en este reto. ¡Toma ventaja!'
      : 'Sigue a jugadores para competir con tus amigos.';
    return `
      <div class="ch-board ch-board-empty">
        <p class="muted">${text}</p>
        <button class="btn ch-invite" data-route="buscar">Buscar jugadores</button>
      </div>`;
  }
  const top = rows.slice(0, TOP);
  const mine = rows.findIndex((r) => r.isMine);
  const extra = mine >= TOP ? `<li class="ch-gap" aria-hidden="true">···</li>${boardRow(rows[mine], challenge.unit)}` : '';
  return `
    <div class="ch-board">
      <h3 class="ch-board-title">Entre tus amigos <span class="muted">· ${escapeHtml(challenge.unit)}</span></h3>
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
      <p class="ch-status ch-status-done">🎉 ¡Completado! <span class="muted">${fmt(p.value)}/${p.target} ${unit}</span></p>`;
  } else if (joined) {
    const cta = c.metric === 'fitness'
      ? '<button class="link ch-cta" data-route="entrenar">Entrenar ahora</button>'
      : '<button class="link ch-cta" data-route="publicar">Publicar actividad</button>';
    body = `
      ${progressBar(p.value, p.target, p.pct, `${fmt(p.value)} de ${p.target} ${c.unit}`)}
      <div class="ch-status">
        <span><strong>${fmt(p.value)}</strong>/${p.target} ${unit}</span>
        <span class="muted">Te faltan ${fmt(p.target - p.value)}</span>
      </div>
      ${cta}`;
  } else {
    body = `
      ${p.value > 0 ? `<p class="ch-hint">Ya llevas ${fmt(p.value)} de ${p.target}. Únete y que cuente.</p>` : ''}
      <button class="btn primary ch-join" data-action="join" data-instance-id="${escapeHtml(c.instanceId)}">Unirme</button>`;
  }

  return `
    <article class="card ch-card${joined ? ' ch-joined' : ''}${joined && p.done ? ' ch-done' : ''}">
      <div class="ch-card-head">
        <span class="ch-icon" aria-hidden="true">${escapeHtml(c.icon)}</span>
        <div class="ch-info">
          <h2 class="ch-title">${escapeHtml(c.title)}</h2>
          <p class="ch-desc">${escapeHtml(c.description)}</p>
        </div>
      </div>
      <p class="ch-meta"><span class="ch-period">${period}</span><span>⏳ ${endsText(p.endsInDays)}</span></p>
      ${body}
      ${joined ? board(c, p, circle, ctx) : ''}
    </article>`;
}

// ---------- Logros ----------

function achievementsSection(list) {
  const unlocked = list.filter((b) => b.unlocked);
  const sorted = [...unlocked, ...list.filter((b) => !b.unlocked)];
  return `
    <section class="card ch-achievements" aria-labelledby="ch-ach-title">
      <div class="row-between">
        <h2 id="ch-ach-title">Tus logros</h2>
        <span class="muted">${unlocked.length}/${list.length}</span>
      </div>
      <ul class="badges ch-badges">
        ${sorted.map((b) => `
          <li class="badge${b.unlocked ? ' on' : ' ch-locked'}">
            <span class="badge-icon" aria-hidden="true">${escapeHtml(b.icon)}</span>
            <strong>${escapeHtml(b.label)}</strong>
            <span>${b.unlocked ? '' : '<span class="ch-sr-only">Pendiente: </span>'}${escapeHtml(b.description)}</span>
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

    return `
      <section class="ch-view">
        <header class="ch-header">
          <div class="ch-header-text">
            <h1 class="ch-heading">Retos</h1>
            <p class="muted">Completa retos para ganar logros</p>
          </div>
          <div class="ch-count" aria-label="${done} ${plural(done, 'reto completado', 'retos completados')}">
            <strong>🏅 ${done}</strong>
            <span>${plural(done, 'completado', 'completados')}</span>
          </div>
        </header>

        <div class="ch-list">
          ${items.map((item) => challengeCard(item, circles.get(item.c.period), ctx)).join('')}
        </div>

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
      toast('¡Reto aceptado! A por él 💪');
      ctx.rerender();
    },
  },
};
