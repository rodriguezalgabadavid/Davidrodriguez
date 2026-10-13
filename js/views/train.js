import { CONFIG } from '../config.js';
import { EXERCISES, FOCUSES, LEVELS } from '../data.js';
import { generateSession } from '../generator.js';
import { icon } from '../icons.js';
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

// Icono de cada plan (en la interfaz, iconos en lugar de los emojis del catálogo).
const PLAN_ICONS = {
  'primeros-pasos': 'target',
  pretemporada: 'calendar',
  'piernas-explosivas': 'bolt',
  'hombro-sano': 'medal',
  'tercer-set': 'flame',
  premium: 'crown',
};

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
    <div class="progress plan-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-label="${escapeHtml(label)}">
      <div style="width:${value}%"></div>
    </div>`;
}

// Número de la sesión dentro del plan (1, 2, 3…). Se compara por clave: planSessions crea objetos nuevos.
export function sessionNumber(plan, planSession) {
  return planSessions(plan).findIndex((s) => s.key === planSession?.key) + 1;
}

export const planIcon = (planId) => PLAN_ICONS[planId] ?? 'dumbbell';

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
// sessionKeys: claves de las sesiones del plan tal como es ahora (si el plan personalizado cambia, las
// sesiones completadas que ya no existen no cuentan para terminarlo).
export async function playSession(ctx, session, { planSession = null, sessionKeys = [], returnTo = 'entrenar' } = {}) {
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
        await ctx.backend.completePlanSession(planSession.key, sessionKeys);
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

// ---------- Piezas compartidas con premium.js ----------

// Cabecera de un plan: icono redondo + etiqueta pequeña + nombre.
export function planHead({ planId, eyebrow, title, level = 'h2', id = '', meta = '' }) {
  const premium = planId === 'premium';
  return `
    <div class="plan-head">
      <span class="plan-icon${premium ? ' is-premium' : ''}" aria-hidden="true">${icon(planIcon(planId), { size: 22 })}</span>
      <div class="plan-head-text">
        ${eyebrow ? `<span class="label">${eyebrow}</span>` : ''}
        <${level}${id ? ` id="${id}"` : ''}>${title}</${level}>
        ${meta ? `<span class="plan-meta">${meta}</span>` : ''}
      </div>
    </div>`;
}

// "Semana 2 de 4 · 3/8 sesiones" + barra de progreso.
export function planProgressBlock(plan, progress, label) {
  return `
    <div class="plan-progress">
      <div class="plan-progress-line">
        <strong class="plan-week-now">Semana ${progress.currentWeek} <span>de ${plan.weeks}</span></strong>
        <span class="muted">${progress.done} de ${progress.total} sesiones</span>
      </div>
      ${progressBar(progress.pct, label)}
    </div>`;
}

// Siguiente sesión: número, enfoque y detalle (minutos · nivel · material).
export function nextSessionBlock(plan, next, equipment) {
  return `
    <div class="plan-next">
      <span class="plan-next-num" aria-hidden="true">${sessionNumber(plan, next)}</span>
      <span class="plan-next-body">
        <span class="label">Siguiente sesión</span>
        <strong>${escapeHtml(focusLabel(next))}</strong>
        <span class="plan-next-meta">
          <span>${icon('clock', { size: 16 })}≈ ${next.minutes} min</span>
          <span>${icon('target', { size: 16 })}${escapeHtml(levelLabel(next.level))}</span>
          <span>${icon('dumbbell', { size: 16 })}${escapeHtml(equipmentText(equipment))}</span>
        </span>
      </span>
    </div>`;
}

export function planDone(text) {
  return `<p class="plan-finished">${icon('medal', { size: 22 })}<span>${text}</span></p>`;
}

// ---------- Tarjetas ----------

// Decoración de pista para las cabeceras de Premium (como la ilustración del marcador).
export function courtLines(className = 'prem-lines') {
  return `
    <svg class="${className}" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="188" height="88" rx="2"/>
      <path d="M37 6v88M163 6v88M37 50h126"/>
      <path class="prem-lines-net" d="M100 2v96"/>
    </svg>`;
}

function upsellCard(ctx) {
  const demo = ctx.backend.mode === 'demo';
  return `
    <section class="prem-upsell" aria-labelledby="prem-upsell-title">
      ${courtLines()}
      <div class="prem-upsell-top">
        <span class="prem-crown" aria-hidden="true">${icon('crown', { size: 22 })}</span>
        <span class="prem-eyebrow">PadelFit Premium</span>
      </div>
      <h2 class="prem-upsell-title" id="prem-upsell-title">Tu plan personalizado de pádel</h2>
      <p class="prem-upsell-text">Se adapta a tu nivel, a tus partidos y a tus molestias.</p>
      <div class="prem-upsell-foot">
        <p class="prem-upsell-price"><strong>${escapeHtml(CONFIG.premiumPrice)}</strong><span>/${escapeHtml(CONFIG.premiumPeriod)}</span></p>
        <button class="btn accent prem-upsell-cta" data-route="premium">Ver Premium${icon('chevron', { size: 18 })}</button>
      </div>
      ${demo ? `<p class="prem-upsell-demo">${icon('info', { size: 16 })}En la demo es gratis y sin pagos</p>` : ''}
    </section>`;
}

function premiumCard(ctx, { answers, premiumPlan, planState, activePlan }) {
  const isPremium = Boolean(ctx.me?.isPremium);
  if (activePlan?.id === 'premium') return ''; // la tarjeta del plan activo ya es la del plan Premium
  if (!isPremium) return upsellCard(ctx);

  const button = (label) => `<button class="btn big${activePlan ? '' : ' primary'}" data-route="premium">${label}</button>`;

  if (!answers || !premiumPlan) {
    return `
      <section class="card prem-card">
        ${planHead({ planId: 'premium', eyebrow: 'Premium', title: 'Crea tu plan personalizado' })}
        <p class="muted">${PREMIUM_QUESTIONS.length} preguntas rápidas y lo adaptamos a tu nivel, tus partidos y tus molestias.</p>
        ${button('Crear mi plan')}
      </section>`;
  }

  const next = nextPlanSession(premiumPlan, planState);
  return `
    <section class="card prem-card">
      ${planHead({ planId: 'premium', eyebrow: 'Premium', title: 'Tu plan personalizado' })}
      ${next ? `<p class="prem-card-next">${icon('play', { size: 16 })}<span>Siguiente: <strong>${escapeHtml(focusLabel(next))}</strong> · ${next.minutes} min</span></p>` : ''}
      ${button('Ver mi plan')}
    </section>`;
}

function lockedPremiumCard() {
  return `
    <section class="card plan-active">
      ${planHead({ planId: 'premium', eyebrow: 'Tu plan', title: 'Tu plan personalizado' })}
      <p class="muted">Tu Premium no está activo. Reactívalo para seguir con tu plan o elige un plan gratuito.</p>
      <button class="btn primary big" data-route="premium">${icon('crown', { size: 20 })}Ver Premium</button>
      <div class="plan-active-links">
        <button class="link plan-leave" data-action="leave-plan">Dejar el plan</button>
      </div>
    </section>`;
}

function activePlanCard(ctx, plan, planState) {
  if (!plan) return '';
  const premium = plan.id === 'premium';
  if (premium && !ctx.me?.isPremium) return lockedPremiumCard();

  const progress = planProgress(plan, planState);
  const next = nextPlanSession(plan, planState);
  const equipment = premium ? next?.equipment ?? plan.equipment ?? [] : [];

  return `
    <section class="card plan-active" aria-labelledby="plan-active-title">
      ${planHead({ planId: plan.id, eyebrow: premium ? 'Tu plan · Premium' : 'Tu plan', title: escapeHtml(plan.name), id: 'plan-active-title' })}
      ${planProgressBlock(plan, progress, `${plan.name}: ${progress.done} de ${progress.total} sesiones`)}
      ${next ? `
        ${nextSessionBlock(plan, next, equipment)}
        <button class="btn primary big plan-start" data-action="start-next">
          ${icon('play', { size: 20 })}<span>Empezar sesión ${sessionNumber(plan, next)}</span>
        </button>`
        : planDone('¡Has completado todas las sesiones!')}
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
  const action = active
    ? `<span class="plan-badge">${icon('play', { size: 14 })}En curso</span>`
    : `<button class="btn plan-card-btn" data-action="start-plan" data-id="${escapeHtml(plan.id)}">${finished ? 'Repetir plan' : 'Empezar plan'}</button>`;
  return `
    <li class="card plan-card${active ? ' is-active' : ''}">
      ${planHead({
        planId: plan.id,
        title: escapeHtml(plan.name),
        level: 'h3',
        // Espacio fino irrompible antes de cada "·": al partirse la línea, el punto nunca la empieza.
        meta: [`${plan.weeks} semanas`, `${plan.sessionsPerWeek} sesiones/semana`, `${plan.minutes} min`, escapeHtml(levelLabel(plan.level))].join('&nbsp;· '),
      })}
      <p class="plan-desc">${escapeHtml(plan.description)}</p>
      <div class="plan-card-foot">
        ${finished
          ? `<span class="plan-done">${icon('check', { size: 16 })}Completado</span>`
          : `<span class="muted">${total} sesiones</span>`}
        ${action}
      </div>
    </li>`;
}

function catalog(planState) {
  return `
    <section class="train-section" aria-labelledby="train-plans-title">
      <div class="train-section-head">
        <h2 id="train-plans-title">Planes gratuitos</h2>
        <span class="muted">${PLANS.length} planes</span>
      </div>
      <p class="muted train-section-sub">Elige uno y te guiamos sesión a sesión. Cada sesión que termines se publica en tu muro.</p>
      <ul class="plan-list">
        ${PLANS.map((p) => planCard(p, planState)).join('')}
      </ul>
    </section>`;
}

function quickSession(ctx, { primary }) {
  const quick = (ctx.cache.quick ??= { ...DEFAULT_QUICK });
  const level = LEVELS[ctx.me?.level] ? Number(ctx.me.level) : 2;
  const { work, rest } = LEVELS[level];
  return `
    <section class="card train-quick" aria-labelledby="train-quick-title">
      <div class="train-quick-head">
        <span class="plan-icon" aria-hidden="true">${icon('bolt', { size: 22 })}</span>
        <div>
          <h2 id="train-quick-title">Sesión rápida</h2>
          <p class="muted">Sin plan y sin material: elige objetivo y tiempo, y a moverte.</p>
        </div>
      </div>
      <form class="train-quick-form" data-submit="quick" data-change="quick-change">
        <fieldset class="train-fieldset">
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
        <fieldset class="train-fieldset">
          <legend class="field-label">Duración</legend>
          <div class="segmented">
            ${QUICK_MINUTES.map((m) => `
              <label>
                <input type="radio" name="minutes" value="${m}" ${quick.minutes === m ? 'checked' : ''} />
                <span>${m} min</span>
              </label>`).join('')}
          </div>
        </fieldset>
        <button class="btn big${primary ? ' primary' : ''}" type="submit">${icon('play', { size: 20 })}Empezar sesión rápida</button>
        <p class="hint center">${escapeHtml(levelLabel(level))} · ${work} s de trabajo y ${rest} s de descanso</p>
      </form>
    </section>`;
}

function libraryLink() {
  return `
    <button class="card train-link" data-route="ejercicios">
      <span class="plan-icon" aria-hidden="true">${icon('list', { size: 22 })}</span>
      <span class="train-link-body">
        <strong>Biblioteca de ejercicios</strong>
        <span class="muted">${EXERCISES.length} ejercicios explicados para pádel</span>
      </span>
      <span class="train-link-go" aria-hidden="true">${icon('chevron', { size: 20 })}</span>
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
      ${premiumCard(ctx, { answers, premiumPlan, planState, activePlan })}
      ${activePlanCard(ctx, activePlan, planState)}
      ${catalog(planState)}
      ${quickSession(ctx, { primary: !activePlan })}
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
      await playSession(ctx, session, { planSession: next, sessionKeys: planSessions(plan).map((s) => s.key), returnTo: 'entrenar' });
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
