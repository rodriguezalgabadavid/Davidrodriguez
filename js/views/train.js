import { CONFIG } from '../config.js';
import { EXERCISES, FOCUSES, LEVELS } from '../data.js';
import { generateSession } from '../generator.js';
import {
  PLANS,
  PREMIUM_QUESTIONS,
  getPlan,
  nextPlanSession,
  personalizedPlan,
  planProgress,
  planSessions,
  sessionForPlan,
} from '../plans.js';
import { askConfirm, escapeHtml, toast } from '../ui.js';
import { showCelebration, snapshot } from './celebrate.js';

// Entrenar: plan activo (una acción principal: empezar la siguiente sesión), catálogo de planes
// gratuitos, sesión rápida y acceso a Premium y a la biblioteca de ejercicios.

const QUICK_MINUTES = [15, 20, 30, 45];
const DEFAULT_QUICK = { focus: 'completa', minutes: 20 };

const EQUIPMENT_LABELS = Object.fromEntries(
  (PREMIUM_QUESTIONS.find((q) => q.id === 'equipment')?.options ?? []).map((o) => [o.value, o.label]),
);

let starting = false; // evita abrir dos veces el temporizador con un doble toque

// ---------- Utilidades compartidas con premium.js ----------

export const focusLabel = (planSession) => FOCUSES[planSession?.focus]?.label ?? planSession?.title ?? 'Sesión';

export function equipmentText(list = []) {
  if (!list?.length) return 'Sin material';
  return list.map((e) => EQUIPMENT_LABELS[e] ?? e).join(', ');
}

export function levelLabel(level) {
  return LEVELS[level]?.label ?? LEVELS[2].label;
}

export function progressBar(pct, label) {
  const value = Math.min(100, Math.max(0, Math.round(Number(pct) || 0)));
  return `
    <div class="plan-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-label="${escapeHtml(label)}">
      <span style="width:${value}%"></span>
    </div>`;
}

// Número de la sesión dentro del plan (1, 2, 3…). Se compara por clave: planSessions crea objetos nuevos.
export function sessionNumber(plan, planSession) {
  return planSessions(plan).findIndex((s) => s.key === planSession?.key) + 1;
}

const isFinished = (planState, planId) =>
  (planState?.finished ?? []).some((f) => (f?.planId ?? f) === planId);

// askConfirm con una acción asíncrona: los errores se muestran como aviso.
export function confirmThen(message, label, fn) {
  askConfirm(message, label, () => {
    Promise.resolve()
      .then(fn)
      .catch((error) => {
        console.error(error);
        toast(error.message || 'No se ha podido completar la acción.');
      });
  });
}

// Abre el temporizador. Al guardar: publica el entreno en el muro, marca la sesión del plan (si la hay),
// celebra lo conseguido y vuelve a `returnTo` para ver el progreso actualizado.
export async function playSession(ctx, session, { planSession = null, total = 0, returnTo = 'entrenar' } = {}) {
  if (starting) return;
  starting = true;
  let before = null;
  try {
    before = await snapshot(ctx).catch(() => null);
  } finally {
    starting = false;
  }

  const planRef = planSession ? { planId: planSession.planId, sessionKey: planSession.key } : null;

  async function save(result) {
    toast('Guardando tu entreno…');
    let activity;
    try {
      activity = await ctx.backend.createActivity({
        type: 'entreno',
        date: new Date().toISOString(),
        seconds: result.seconds,
        rpe: result.rpe,
        title: session.title,
        focus: session.focus,
        plan: planRef,
      }, null);
    } catch (error) {
      console.error(error);
      // No perdemos la sesión: se puede reintentar.
      askConfirm(`${error.message || 'No se ha podido guardar el entreno.'} ¿Lo intentamos otra vez?`, 'Reintentar', () => save(result));
      return;
    }

    if (planSession) {
      try {
        await ctx.backend.completePlanSession(planSession.key, total);
      } catch (error) {
        console.error(error);
        toast(error.message || 'Tu entreno está publicado, pero no se ha podido marcar en el plan.');
      }
    }

    const after = await snapshot(ctx).catch(() => null);
    try {
      await showCelebration(ctx, { activity, before, after });
    } catch (error) {
      console.error(error);
    }
    // Si durante la celebración se cambió de pantalla, no se le saca de ahí.
    if (location.hash.slice(1) === returnTo) ctx.navigate(returnTo);
  }

  ctx.startSession(session, { onSave: save });
}

// ---------- Tarjetas ----------

function upsellCard(ctx) {
  const demo = ctx.backend.mode === 'demo';
  return `
    <button class="card prem-upsell" data-route="premium">
      <span class="prem-crown" aria-hidden="true">👑</span>
      <span class="prem-upsell-body">
        <span class="prem-eyebrow">Premium</span>
        <strong class="prem-upsell-title">Plan personalizado para tu pádel</strong>
        <span class="prem-upsell-text">Se adapta a tu nivel, a tus partidos y a tus molestias.</span>
        <span class="prem-upsell-price">${escapeHtml(CONFIG.premiumPrice)}/${escapeHtml(CONFIG.premiumPeriod)}${demo ? ' · en la demo, gratis y sin pagos' : ''}</span>
      </span>
      <span class="prem-upsell-go" aria-hidden="true">›</span>
    </button>`;
}

function premiumCard(ctx, { answers, premiumPlan, planState, activePlan }) {
  const isPremium = Boolean(ctx.me?.isPremium);
  if (activePlan?.id === 'premium') return ''; // la tarjeta del plan activo ya es la del plan Premium
  if (!isPremium) return upsellCard(ctx);

  const button = (label) => `<button class="btn big${activePlan ? '' : ' primary'}" data-route="premium">${label}</button>`;
  const head = (title) => `
    <div class="plan-head">
      <span class="plan-icon prem-icon" aria-hidden="true">👑</span>
      <div class="plan-head-text">
        <span class="prem-eyebrow">Premium</span>
        <h2>${title}</h2>
      </div>
    </div>`;

  if (!answers || !premiumPlan) {
    return `
      <section class="card prem-card">
        ${head('Crea tu plan personalizado')}
        <p class="muted">${PREMIUM_QUESTIONS.length} preguntas rápidas y lo adaptamos a tu nivel, tus partidos y tus molestias.</p>
        ${button('Crear mi plan')}
      </section>`;
  }

  const next = nextPlanSession(premiumPlan, planState);
  return `
    <section class="card prem-card">
      ${head('Tu plan personalizado')}
      ${next ? `<p class="prem-card-next">Siguiente: <strong>${escapeHtml(focusLabel(next))}</strong> · ${next.minutes} min</p>` : ''}
      ${button('Ver mi plan')}
    </section>`;
}

function lockedPremiumCard() {
  return `
    <section class="card plan-active plan-premium">
      <div class="plan-head">
        <span class="plan-icon prem-icon" aria-hidden="true">👑</span>
        <div class="plan-head-text">
          <span class="label">Tu plan</span>
          <h2>Tu plan personalizado</h2>
        </div>
      </div>
      <p class="muted">Tu Premium no está activo. Reactívalo para seguir con tu plan o elige un plan gratuito.</p>
      <button class="btn primary big" data-route="premium">Ver Premium</button>
      <button class="link plan-leave" data-action="leave-plan">Dejar el plan</button>
    </section>`;
}

function activePlanCard(ctx, plan, planState) {
  if (!plan) return '';
  const premium = plan.id === 'premium';
  if (premium && !ctx.me?.isPremium) return lockedPremiumCard();

  const progress = planProgress(plan, planState);
  const next = nextPlanSession(plan, planState);
  const weekText = `Semana ${progress.currentWeek} de ${plan.weeks}`;
  const equipment = premium ? next?.equipment ?? plan.equipment ?? [] : [];

  return `
    <section class="card plan-active${premium ? ' plan-premium' : ''}">
      <div class="plan-head">
        <span class="plan-icon${premium ? ' prem-icon' : ''}" aria-hidden="true">${escapeHtml(plan.icon ?? '📋')}</span>
        <div class="plan-head-text">
          <span class="label">Tu plan</span>
          <h2>${escapeHtml(plan.name)}</h2>
        </div>
      </div>
      <div class="plan-progress-line">
        <strong>${weekText}</strong>
        <span class="muted">${progress.done}/${progress.total} sesiones</span>
      </div>
      ${progressBar(progress.pct, `${plan.name}: ${progress.done} de ${progress.total} sesiones`)}
      ${next ? `
        <button class="btn primary big plan-start" data-action="start-next">
          ▶ Empezar sesión ${sessionNumber(plan, next)}: ${escapeHtml(focusLabel(next))}
        </button>
        <p class="hint center">≈ ${next.minutes} min · ${escapeHtml(levelLabel(next.level))} · ${escapeHtml(equipmentText(equipment))}</p>`
        : '<p class="plan-finished">🎉 ¡Has completado todas las sesiones!</p>'}
      <div class="plan-active-links">
        ${premium ? '<button class="link" data-route="premium">Ver mi plan completo</button>' : ''}
        <button class="link plan-leave" data-action="leave-plan">Dejar el plan</button>
      </div>
    </section>`;
}

function planCard(plan, planState) {
  const active = planState.planId === plan.id;
  const finished = isFinished(planState, plan.id);
  const total = plan.weeks * plan.sessionsPerWeek;
  let action;
  if (active) action = '<span class="plan-badge">En curso</span>';
  else {
    action = `<button class="btn plan-card-btn" data-action="start-plan" data-id="${escapeHtml(plan.id)}">${finished ? 'Repetir plan' : 'Empezar plan'}</button>`;
  }
  return `
    <article class="card plan-card${active ? ' is-active' : ''}">
      <div class="plan-head">
        <span class="plan-icon" aria-hidden="true">${escapeHtml(plan.icon)}</span>
        <div class="plan-head-text">
          <h3>${escapeHtml(plan.name)}</h3>
          <span class="plan-meta">${plan.weeks} semanas · ${plan.sessionsPerWeek} × semana · ${plan.minutes} min · ${escapeHtml(levelLabel(plan.level))}</span>
        </div>
      </div>
      <p class="plan-desc">${escapeHtml(plan.description)}</p>
      <div class="plan-card-foot">
        <span class="plan-card-info">
          ${finished ? '<span class="plan-done">✓ Completado</span>' : `<span class="muted">${total} sesiones</span>`}
        </span>
        ${action}
      </div>
    </article>`;
}

function catalog(planState, activePlan) {
  return `
    <section class="train-section" aria-labelledby="train-plans-title">
      <div class="train-section-head">
        <h2 id="train-plans-title">Planes gratuitos</h2>
        <span class="muted">${PLANS.length} planes</span>
      </div>
      ${activePlan ? '' : '<p class="muted train-section-sub">Elige uno y te guiamos sesión a sesión.</p>'}
      <div class="plan-list">
        ${PLANS.map((p) => planCard(p, planState)).join('')}
      </div>
    </section>`;
}

function quickSession(ctx) {
  const quick = (ctx.cache.quick ??= { ...DEFAULT_QUICK });
  const level = LEVELS[ctx.me?.level] ? Number(ctx.me.level) : 2;
  const { work, rest } = LEVELS[level];
  return `
    <section class="card train-quick" aria-labelledby="train-quick-title">
      <h2 id="train-quick-title">⚡ Sesión rápida</h2>
      <p class="muted">Sin plan y sin material: elige objetivo y tiempo, y a moverte.</p>
      <form class="train-quick-form" data-submit="quick" data-change="quick-change">
        <fieldset class="field">
          <legend class="field-label">Objetivo</legend>
          <div class="chips">
            ${Object.entries(FOCUSES).map(([key, f]) => `
              <label class="chip-radio">
                <input type="radio" name="focus" value="${key}" ${quick.focus === key ? 'checked' : ''} />
                <span>${escapeHtml(f.label)}</span>
              </label>`).join('')}
          </div>
          <p class="hint" id="train-focus-hint">${escapeHtml(FOCUSES[quick.focus]?.description ?? '')}</p>
        </fieldset>
        <fieldset class="field">
          <legend class="field-label">Duración</legend>
          <div class="segmented">
            ${QUICK_MINUTES.map((m) => `
              <label>
                <input type="radio" name="minutes" value="${m}" ${quick.minutes === m ? 'checked' : ''} />
                <span>${m} min</span>
              </label>`).join('')}
          </div>
        </fieldset>
        <button class="btn primary big" type="submit">▶ Empezar sesión rápida</button>
        <p class="hint center">${escapeHtml(levelLabel(level))} · ${work}s de trabajo y ${rest}s de descanso</p>
      </form>
    </section>`;
}

function libraryLink() {
  return `
    <button class="card train-link" data-route="ejercicios">
      <span class="train-link-icon" aria-hidden="true">📚</span>
      <span class="train-link-body">
        <strong>Biblioteca de ejercicios</strong>
        <span class="muted">${EXERCISES.length} ejercicios explicados para pádel</span>
      </span>
      <span class="train-link-go" aria-hidden="true">›</span>
    </button>`;
}

// ---------- Vista ----------

export default {
  route: 'entrenar',
  tab: 'entrenar',

  async render(ctx) {
    const { backend } = ctx;
    const raw = await backend.getPlanState();
    const planState = {
      planId: raw?.planId ?? null,
      startedAt: raw?.startedAt ?? null,
      completed: raw?.completed ?? {},
      finished: Array.isArray(raw?.finished) ? raw.finished : [],
    };
    const premiumActive = planState.planId === 'premium';

    let answers = null;
    let myActivities = [];
    if (ctx.me?.isPremium || premiumActive) {
      [answers, myActivities] = await Promise.all([
        backend.getPremiumAnswers().catch(() => null),
        backend.getMyActivities().catch(() => []),
      ]);
    }
    const premiumPlan = answers || premiumActive ? personalizedPlan(answers ?? {}, myActivities, ctx.now) : null;
    const activePlan = premiumActive ? premiumPlan : getPlan(planState.planId);
    ctx.cache.data = { planState, activePlan };

    return `
      <header class="train-head">
        <h1>Entrenar</h1>
        <p class="muted">Físico específico para pádel. Cada sesión que termines se publica en tu muro.</p>
      </header>
      ${premiumCard(ctx, { answers, premiumPlan, planState, activePlan })}
      ${activePlanCard(ctx, activePlan, planState)}
      ${catalog(planState, activePlan)}
      ${quickSession(ctx)}
      ${libraryLink()}`;
  },

  actions: {
    async 'start-next'(el, ctx) {
      const { planState, activePlan: plan } = ctx.cache.data ?? {};
      if (!plan) return;
      if (plan.id === 'premium' && !ctx.me?.isPremium) return ctx.navigate('premium');
      const next = nextPlanSession(plan, planState);
      if (!next) return;
      // Los planes gratuitos son sin material; el Premium usa el material de tus respuestas.
      const session = sessionForPlan(next, plan.id === 'premium' ? {} : { equipment: [] });
      await playSession(ctx, session, { planSession: next, total: planSessions(plan).length, returnTo: 'entrenar' });
    },

    'leave-plan'(el, ctx) {
      const { activePlan } = ctx.cache.data ?? {};
      const name = activePlan?.name ?? 'tu plan';
      confirmThen(`¿Dejar «${name}»? Perderás el progreso de este plan.`, 'Dejar el plan', async () => {
        await ctx.backend.abandonPlan();
        toast('Has dejado el plan. Elige otro cuando quieras.');
        ctx.navigate('entrenar');
      });
    },

    'start-plan'(el, ctx) {
      const plan = getPlan(el.dataset.id);
      const { planState, activePlan } = ctx.cache.data ?? {};
      if (!plan || planState?.planId === plan.id) return;
      const go = async () => {
        await ctx.backend.startPlan(plan.id);
        toast(`¡«${plan.name}» en marcha! Empieza por la sesión 1.`);
        ctx.navigate('entrenar'); // vuelve arriba, donde está el botón de empezar
      };
      if (planState?.planId) {
        const current = activePlan?.name ?? 'otro plan';
        confirmThen(`Ya tienes «${current}» en marcha. Si empiezas «${plan.name}», perderás su progreso.`, 'Cambiar de plan', go);
        return;
      }
      return go();
    },

    'quick-change'(form, ctx) {
      const focus = FOCUSES[form.elements.focus.value] ? form.elements.focus.value : DEFAULT_QUICK.focus;
      const minutes = Number(form.elements.minutes.value) || DEFAULT_QUICK.minutes;
      ctx.cache.quick = { focus, minutes };
      const hint = form.querySelector('#train-focus-hint');
      if (hint) hint.textContent = FOCUSES[focus].description;
    },

    async quick(form, ctx) {
      const focus = FOCUSES[form.elements.focus.value] ? form.elements.focus.value : DEFAULT_QUICK.focus;
      const minutes = QUICK_MINUTES.includes(Number(form.elements.minutes.value)) ? Number(form.elements.minutes.value) : DEFAULT_QUICK.minutes;
      const level = LEVELS[ctx.me?.level] ? Number(ctx.me.level) : 2;
      ctx.cache.quick = { focus, minutes };
      const session = generateSession({ focus, level, minutes, equipment: [], seed: Date.now() });
      session.title = FOCUSES[focus].label;
      await playSession(ctx, session, { returnTo: 'entrenar' });
    },
  },
};
