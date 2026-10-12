import { activityCard, demoTag, followButton, globalActions } from '../components.js';
import { challengeProgress, currentChallenges } from '../challenges.js';
import { weekSummary, weeklyStreak } from '../stats.js';
import { avatar, emptyState, escapeHtml, premiumBadge, toast } from '../ui.js';

// Inicio: tira de enganche (racha, reto, publicar) + muro de actividades de quien sigues.

const PAGE = 20;
const RESTORE_SCROLL_MS = 5 * 60 * 1000; // al volver pronto (p. ej. del detalle), se recupera la posición
const SUGGEST_IF_FOLLOWING_LESS_THAN = 3;

let lastCache = null; // para guardar la posición de scroll al salir (unmount no recibe ctx)

const plural = (n, one, many) => (n === 1 ? one : many);
const formatValue = (v) => String(v).replace('.', ',');

// ---------- Tira de enganche ----------

function streakTile(myActivities, ctx) {
  const { weeks } = weeklyStreak(myActivities, ctx.now);
  const goal = Math.min(7, Math.max(1, Number(ctx.settings?.weeklyGoal) || 3));
  const count = weekSummary(myActivities, ctx.now).current.count;
  const dots = Array.from({ length: goal }, (_, i) => `<i class="feed-dot${i < count ? ' on' : ''}"></i>`).join('');
  return `
    <button class="feed-tile feed-streak" data-route="perfil" aria-label="Racha: ${weeks} ${plural(weeks, 'semana', 'semanas')} seguidas. Esta semana ${count} de ${goal}.">
      <span class="feed-tile-label">Tu racha</span>
      <span class="feed-tile-big">🔥 ${weeks} <small>${weeks ? plural(weeks, 'semana', 'semanas seguidas') : 'semanas'}</small></span>
      <span class="feed-tile-sub">${weeks ? `Esta semana: ${count}/${goal}` : 'Publica algo esta semana para empezarla'}</span>
      ${weeks ? `<span class="feed-dots" aria-hidden="true">${dots}</span>` : ''}
    </button>`;
}

function streakNudge(myActivities, now) {
  const { weeks, activeThisWeek } = weeklyStreak(myActivities, now);
  if (activeThisWeek || weeks === 0) return '';
  const daysLeft = 7 - ((new Date(now).getDay() + 6) % 7); // lunes → 7, domingo → 1
  const text = daysLeft === 1
    ? 'Último día: juega o entrena hoy para mantener tu racha'
    : `Juega o entrena antes del domingo para mantener tu racha (quedan ${daysLeft} días)`;
  return `
    <div class="banner feed-nudge" role="status">
      <span>⏳ ${text}</span>
      <button class="link" data-route="entrenar">Entrenar</button>
    </div>`;
}

const daysLeftText = (n) => (n <= 1 ? 'Último día' : `Quedan ${n} días`);

function progressBar(pct) {
  return `<span class="feed-progress" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></span>`;
}

function challengeTile(myActivities, joined, ctx) {
  const current = currentChallenges(ctx.now).map((c) => ({ c, p: challengeProgress(c, myActivities, ctx.now) }));
  const mine = current.filter(({ c }) => joined.includes(c.instanceId));

  if (mine.length) {
    // El más relevante: sin completar, el más avanzado y, a igualdad, el que acaba antes.
    mine.sort((x, y) => Number(x.p.done) - Number(y.p.done) || y.p.pct - x.p.pct || x.p.endsInDays - y.p.endsInDays);
    const { c, p } = mine[0];
    return `
      <button class="feed-tile feed-challenge" data-route="retos">
        <span class="feed-tile-label">Tu reto${mine.length > 1 ? ` · ${mine.length} activos` : ''}</span>
        <span class="feed-tile-title">${c.icon} ${escapeHtml(c.title)}</span>
        ${progressBar(p.pct)}
        <span class="feed-tile-sub">${p.done
          ? '¡Completado! 🎉'
          : `${formatValue(p.value)}/${p.target} ${escapeHtml(c.unit)} · ${daysLeftText(p.endsInDays)}`}</span>
      </button>`;
  }

  // Sin retos: invitación al reto del mes en el que ya llevas más avance.
  const monthly = current.filter(({ c }) => c.period === 'month');
  const pick = [...monthly].filter(({ p }) => !p.done).sort((x, y) => y.p.pct - x.p.pct)[0] ?? monthly[0] ?? current[0];
  if (!pick) return '';
  const { c, p } = pick;
  return `
    <div class="feed-tile feed-challenge feed-join">
      <span class="feed-tile-label">Reto del mes</span>
      <span class="feed-tile-title">${c.icon} ${escapeHtml(c.title)}</span>
      <span class="feed-tile-sub">${p.value > 0 ? `Ya llevas ${formatValue(p.value)} de ${p.target}` : daysLeftText(p.endsInDays)}</span>
      <button class="btn primary feed-join-btn" data-action="join-challenge" data-instance-id="${escapeHtml(c.instanceId)}">Unirme</button>
    </div>`;
}

function composer(me) {
  return `
    <button class="feed-composer" data-route="publicar">
      ${avatar(me)}
      <span class="feed-composer-text">¿Has jugado hoy? Publícalo</span>
      <span class="feed-composer-icon" aria-hidden="true">📷</span>
    </button>`;
}

// ---------- Sugerencias ----------

function suggestions(players) {
  if (!players.length) return '';
  return `
    <section class="card feed-suggest" aria-labelledby="feed-suggest-title">
      <div class="row-between">
        <h2 id="feed-suggest-title">Jugadores que quizá conozcas</h2>
        <button class="link" data-route="buscar">Buscar</button>
      </div>
      <ul class="feed-suggest-list">
        ${players.map((p) => `
          <li class="feed-person">
            <a class="feed-person-link" href="#perfil" data-route="perfil" data-param-id="${escapeHtml(p.id)}">
              ${avatar(p, 'lg')}
              <span class="feed-person-name">${escapeHtml(p.name)}${premiumBadge(p)}</span>
              <span class="feed-person-club">${escapeHtml(p.club)}</span>
              ${demoTag(p)}
            </a>
            ${followButton(p, false)}
          </li>`).join('')}
      </ul>
      <p class="feed-suggest-refresh" hidden>
        <button class="btn" data-action="refresh">Ver su actividad en tu muro</button>
      </p>
    </section>`;
}

// ---------- Muro ----------

const moreButton = '<button class="btn feed-more" data-action="more">Ver más</button>';
const endNote = '<p class="feed-end muted">Ya lo has visto todo. ¡A la pista! 🎾</p>';

export default {
  route: 'inicio',
  tab: 'inicio',

  async render(ctx) {
    const { backend } = ctx;
    const cache = ctx.cache;
    const limit = Math.max(PAGE, cache.count || 0); // al volver, se mantienen las páginas ya cargadas
    const fewFollowing = (ctx.me?.followingCount ?? 0) < SUGGEST_IF_FOLLOWING_LESS_THAN;

    const [items, myActivities, joined, early] = await Promise.all([
      backend.getFeed({ limit }),
      backend.getMyActivities().catch(() => []),
      backend.getJoinedChallenges().catch(() => []),
      fewFollowing ? backend.suggestedPlayers().catch(() => []) : null,
    ]);

    cache.count = items.length;
    cache.lastDate = items.at(-1)?.date ?? null;
    cache.topId = items[0]?.id ?? null;

    const onlyMine = items.every((a) => a.isMine);
    const players = early ?? (onlyMine ? await backend.suggestedPlayers().catch(() => []) : []);
    const suggestBlock = suggestions(players);

    const hooks = `
      <div class="feed-hooks">
        <div class="feed-tiles">
          ${streakTile(myActivities, ctx)}
          ${challengeTile(myActivities, joined, ctx)}
        </div>
        ${streakNudge(myActivities, ctx.now)}
        ${composer(ctx.me)}
      </div>`;

    if (!items.length) {
      return `
        <section class="feed-view">
          ${hooks}
          ${suggestBlock}
          ${emptyState({
            icon: '🎾',
            title: 'Tu muro está vacío',
            text: 'Publica tu primer partido o sigue a jugadores para ver aquí su actividad.',
            action: '<button class="btn primary" data-route="publicar">Publicar actividad</button>',
          })}
        </section>`;
    }

    const cards = items.map((a) => activityCard(a, ctx));
    // Si solo hay cosas mías, las sugerencias van arriba; si no, entre las primeras tarjetas.
    if (suggestBlock && !onlyMine) cards.splice(Math.min(3, cards.length), 0, suggestBlock);

    return `
      <section class="feed-view">
        ${hooks}
        ${onlyMine ? suggestBlock : ''}
        <h1 class="feed-heading">Actividad</h1>
        <div class="feed-list" id="feed-list">${cards.join('')}</div>
        ${items.length >= limit ? moreButton : endNote}
      </section>`;
  },

  mount(root, ctx) {
    const cache = ctx.cache;
    lastCache = cache;
    const restore = cache.leftAt && Date.now() - cache.leftAt < RESTORE_SCROLL_MS && cache.leftTopId === cache.topId;
    if (restore && cache.scrollY > 0) {
      const y = cache.scrollY;
      requestAnimationFrame(() => window.scrollTo(0, y)); // después del scroll arriba que hace app.js
    }
    cache.leftAt = null;
  },

  unmount() {
    if (!lastCache) return;
    lastCache.scrollY = window.scrollY;
    lastCache.leftAt = Date.now();
    lastCache.leftTopId = lastCache.topId;
  },

  actions: {
    async more(el, ctx) {
      const list = document.getElementById('feed-list');
      if (!list) return;
      el.disabled = true;
      el.textContent = 'Cargando…';
      let items;
      try {
        items = await ctx.backend.getFeed({ before: ctx.cache.lastDate ?? undefined, limit: PAGE });
      } catch (error) {
        el.disabled = false;
        el.textContent = 'Ver más';
        throw error;
      }
      const seen = new Set([...list.querySelectorAll('.act-card[data-id]')].map((card) => card.dataset.id));
      const fresh = items.filter((a) => !seen.has(a.id));
      list.insertAdjacentHTML('beforeend', fresh.map((a) => activityCard(a, ctx)).join(''));
      ctx.cache.count = (ctx.cache.count || 0) + fresh.length;
      if (items.length) ctx.cache.lastDate = items.at(-1).date;
      if (items.length < PAGE) el.outerHTML = endNote;
      else {
        el.disabled = false;
        el.textContent = 'Ver más';
      }
    },

    async 'join-challenge'(el, ctx) {
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

    // Igual que la acción global, y además ofrece refrescar el muro con la gente nueva.
    async follow(el, ctx) {
      await globalActions.follow(el, ctx);
      el.closest('.feed-suggest')?.querySelector('.feed-suggest-refresh')?.removeAttribute('hidden');
    },

    async refresh(el, ctx) {
      el.disabled = true;
      ctx.cache.count = 0;
      await ctx.refreshMe().catch(() => null); // para saber a cuánta gente sigues ya
      ctx.navigate('inicio');
    },
  },
};
