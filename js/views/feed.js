import { activityCard, demoTag, followButton, globalActions } from '../components.js';
import { challengeProgress, currentChallenges } from '../challenges.js';
import { icon } from '../icons.js';
import { addDays, dayKey, startOfWeek, weekSummary, weeklyStreak } from '../stats.js';
import { avatar, emptyState, escapeHtml, formatHours, premiumBadge, toast } from '../ui.js';

// Inicio: "Tu semana" (racha, cifras de la semana y días con actividad), el reto en curso, la caja para
// publicar y el muro de actividades de quien sigues.

const PAGE = 20;
const RESTORE_SCROLL_MS = 5 * 60 * 1000; // al volver pronto (p. ej. del detalle), se recupera la posición
const SUGGEST_IF_FOLLOWING_LESS_THAN = 3;

let lastCache = null; // para guardar la posición de scroll al salir (unmount no recibe ctx)

const plural = (n, one, many) => (n === 1 ? one : many);
const formatValue = (v) => String(Math.round(Number(v) * 10) / 10).replace('.', ',');

// ---------- Tu semana ----------

const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function weekDays(myActivities, now) {
  const active = new Set(myActivities.map((a) => dayKey(a.date)));
  const start = startOfWeek(now);
  const today = dayKey(now);
  let past = true;
  return DAY_LETTERS.map((letter, i) => {
    const key = dayKey(addDays(start, i));
    const isToday = key === today;
    const day = { letter, name: DAY_NAMES[i], active: active.has(key), isToday, future: !past };
    if (isToday) past = false;
    return day;
  });
}

function dayStrip(days) {
  return `
    <ol class="feed-days" aria-label="Días con actividad esta semana">
      ${days.map((d) => {
        const state = d.active ? 'con actividad' : d.future ? 'por llegar' : 'sin actividad';
        const cls = ['feed-day', d.active && 'is-active', d.isToday && 'is-today', d.future && 'is-future'].filter(Boolean).join(' ');
        return `
          <li class="${cls}">
            <span class="feed-day-letter" aria-hidden="true">${d.letter}</span>
            <span class="feed-day-mark" aria-hidden="true">${d.active ? icon('check', { size: 16 }) : ''}</span>
            <span class="sr-only">${d.isToday ? 'Hoy, ' : ''}${d.name}: ${state}.</span>
          </li>`;
      }).join('')}
    </ol>`;
}

function streakNudge(weeks, activeThisWeek, now) {
  if (activeThisWeek || weeks === 0) return '';
  const daysLeft = 7 - ((new Date(now).getDay() + 6) % 7); // lunes → 7, domingo → 1
  const text = daysLeft === 1
    ? 'Último día: juega o entrena hoy para mantener tu racha.'
    : `Juega o entrena antes del domingo para mantener tu racha (quedan ${daysLeft} días).`;
  return `
    <div class="feed-nudge" role="status">
      <span class="feed-nudge-icon" aria-hidden="true">${icon('clock', { size: 20 })}</span>
      <p class="feed-nudge-text">${text}</p>
      <button class="btn ghost feed-nudge-btn" data-route="entrenar">Entrenar</button>
    </div>`;
}

function weekCard(myActivities, ctx) {
  const { weeks, activeThisWeek } = weeklyStreak(myActivities, ctx.now);
  const goal = Math.min(7, Math.max(1, Number(ctx.settings?.weeklyGoal) || 3));
  const { count, minutes, wins, losses } = weekSummary(myActivities, ctx.now).current;
  const alive = weeks > 0;
  const weeksText = `${weeks} ${plural(weeks, 'semana', 'semanas')}`;

  return `
    <section class="card feed-week" aria-labelledby="feed-week-title">
      <a class="feed-week-main" href="#perfil" data-route="perfil">
        <div class="feed-week-head">
          <h2 class="label feed-week-title" id="feed-week-title">Esta semana</h2>
          <span class="feed-streak${alive ? ' is-alive' : ''}" title="Semanas seguidas con alguna actividad">
            ${icon('flame', { size: 16 })}<span class="sr-only">Racha:</span> ${weeksText}
          </span>
        </div>
        <dl class="stats-row feed-week-stats">
          <div>
            <dt class="stat-label">Actividades</dt>
            <dd class="stat-value">${count}<small>/${goal}</small><span class="sr-only"> de tu objetivo semanal</span></dd>
          </div>
          <div>
            <dt class="stat-label">Tiempo</dt>
            <dd class="stat-value">${escapeHtml(formatHours(minutes))}</dd>
          </div>
          <div>
            <dt class="stat-label">Partidos <abbr title="ganados y perdidos">G–P</abbr></dt>
            <dd class="stat-value"><span aria-hidden="true">${wins}–${losses}</span><span class="sr-only">${wins} ${plural(wins, 'ganado', 'ganados')} y ${losses} ${plural(losses, 'perdido', 'perdidos')}</span></dd>
          </div>
        </dl>
        ${dayStrip(weekDays(myActivities, ctx.now))}
        ${!alive && !activeThisWeek ? '<p class="feed-week-hint">Publica algo esta semana para empezar tu racha.</p>' : ''}
      </a>
      ${streakNudge(weeks, activeThisWeek, ctx.now)}
    </section>`;
}

// ---------- Reto ----------

const daysLeftText = (n) => (n <= 1 ? 'Último día' : `Quedan ${n} días`);

function progressBar(pct) {
  return `<span class="feed-ch-progress" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></span>`;
}

function remainingText(p, unit) {
  const left = Math.max(0, p.target - p.value);
  return left === 1 ? 'Te falta 1' : `Te faltan ${formatValue(left)} ${unit}`;
}

function meter(p, unit) {
  return `
    <span class="feed-ch-meter">
      ${progressBar(p.pct)}
      <span class="feed-ch-value"><span aria-hidden="true">${formatValue(p.value)}/${p.target}</span><span class="sr-only">${formatValue(p.value)} de ${p.target} ${unit}.</span></span>
    </span>`;
}

function challengeCard(myActivities, joined, ctx) {
  const current = currentChallenges(ctx.now).map((c) => ({ c, p: challengeProgress(c, myActivities, ctx.now) }));
  const mine = current.filter(({ c }) => joined.includes(c.instanceId));

  if (mine.length) {
    // El más relevante: sin completar, el más avanzado y, a igualdad, el que acaba antes.
    mine.sort((x, y) => Number(x.p.done) - Number(y.p.done) || y.p.pct - x.p.pct || x.p.endsInDays - y.p.endsInDays);
    const { c, p } = mine[0];
    return `
      <button class="card feed-ch feed-ch-link" data-route="retos">
        <span class="feed-ch-icon${p.done ? ' is-done' : ''}" aria-hidden="true">${icon(p.done ? 'check' : 'trophy', { size: 22 })}</span>
        <span class="feed-ch-body">
          <span class="label">Tu reto${mine.length > 1 ? ` · ${mine.length} activos` : ''}</span>
          <span class="feed-ch-title">${escapeHtml(c.title)}</span>
          ${meter(p, escapeHtml(c.unit))}
          <span class="feed-ch-sub">${p.done
            ? '<strong>¡Completado!</strong>'
            : `<strong>${remainingText(p, escapeHtml(c.unit))}</strong> · ${daysLeftText(p.endsInDays)}`}</span>
        </span>
        <span class="feed-ch-chevron" aria-hidden="true">${icon('chevron', { size: 20 })}</span>
      </button>`;
  }

  // Sin retos: invitación al reto del mes en el que ya llevas más avance.
  const monthly = current.filter(({ c }) => c.period === 'month');
  const pick = [...monthly].filter(({ p }) => !p.done).sort((x, y) => y.p.pct - x.p.pct)[0] ?? monthly[0] ?? current[0];
  if (!pick) return '';
  const { c, p } = pick;
  return `
    <div class="card feed-ch">
      <span class="feed-ch-icon" aria-hidden="true">${icon('trophy', { size: 22 })}</span>
      <div class="feed-ch-body">
        <span class="label">Reto del mes</span>
        <span class="feed-ch-title">${escapeHtml(c.title)}</span>
        <span class="feed-ch-sub">${p.value > 0
          ? `Ya llevas ${formatValue(p.value)} de ${p.target} · ${daysLeftText(p.endsInDays)}`
          : daysLeftText(p.endsInDays)}</span>
      </div>
      <button class="btn ghost feed-ch-join" data-action="join-challenge" data-instance-id="${escapeHtml(c.instanceId)}">Unirme</button>
    </div>`;
}

// ---------- Publicar ----------

function composer(me) {
  return `
    <button class="feed-composer" data-route="publicar">
      ${avatar(me)}
      <span class="feed-composer-text">¿Has jugado hoy? Publícalo</span>
      <span class="feed-composer-icon" aria-hidden="true">${icon('camera', { size: 22 })}</span>
    </button>`;
}

// ---------- Sugerencias ----------

function personRow(p) {
  const id = escapeHtml(p.id);
  return `
    <li class="soc-row">
      <a class="soc-person" href="#perfil" data-route="perfil" data-param-id="${id}">
        ${avatar(p)}
        <span class="soc-who">
          <span class="soc-name"><span class="soc-name-text" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>${premiumBadge(p)}${demoTag(p)}</span>
          ${p.club ? `<span class="soc-sub">${escapeHtml(p.club)}</span>` : ''}
        </span>
      </a>
      ${followButton(p, false)}
    </li>`;
}

function suggestions(players) {
  if (!players.length) return '';
  return `
    <section class="card feed-suggest" aria-labelledby="feed-suggest-title">
      <div class="feed-suggest-head">
        <h2 class="feed-suggest-title" id="feed-suggest-title">Jugadores que quizá conozcas</h2>
        <button class="btn ghost feed-suggest-search" data-route="buscar">${icon('search', { size: 18 })}<span>Buscar</span></button>
      </div>
      <ul class="soc-list">${players.map(personRow).join('')}</ul>
      <p class="feed-suggest-refresh" hidden>
        <button class="btn" data-action="refresh">Ver su actividad en tu muro</button>
      </p>
    </section>`;
}

// ---------- Muro ----------

const moreButton = '<button class="btn big feed-more" data-action="more">Ver más</button>';
const endNote = `<p class="feed-end">${icon('ball', { size: 20 })}<span>Ya lo has visto todo. ¡A la pista!</span></p>`;

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
    cache.lastId = items.at(-1)?.id ?? null;
    cache.topId = items[0]?.id ?? null;

    const onlyMine = items.every((a) => a.isMine);
    const players = early ?? (onlyMine ? await backend.suggestedPlayers().catch(() => []) : []);
    const suggestBlock = suggestions(players);

    const hooks = `
      ${weekCard(myActivities, ctx)}
      ${challengeCard(myActivities, joined, ctx)}
      ${composer(ctx.me)}`;

    if (!items.length) {
      return `
        <section class="feed-view">
          ${hooks}
          ${suggestBlock}
          ${emptyState({
            icon: icon('racket', { size: 30 }),
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
        <h2 class="label feed-heading">Actividad</h2>
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
        items = await ctx.backend.getFeed({ before: ctx.cache.lastDate ?? undefined, beforeId: ctx.cache.lastId ?? undefined, limit: PAGE });
      } catch (error) {
        el.disabled = false;
        el.textContent = 'Ver más';
        throw error;
      }
      const seen = new Set([...list.querySelectorAll('.act-card[data-id]')].map((card) => card.dataset.id));
      const fresh = items.filter((a) => !seen.has(a.id));
      list.insertAdjacentHTML('beforeend', fresh.map((a) => activityCard(a, ctx)).join(''));
      ctx.cache.count = (ctx.cache.count || 0) + fresh.length;
      if (items.length) {
        ctx.cache.lastDate = items.at(-1).date;
        ctx.cache.lastId = items.at(-1).id;
      }
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
      toast('¡Reto aceptado! A por él');
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
