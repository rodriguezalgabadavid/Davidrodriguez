import { CONFIG } from '../config.js';
import { LEVELS } from '../data.js';
import {
  DEFAULT_PREMIUM_ANSWERS,
  PREMIUM_QUESTIONS,
  getPlan,
  nextPlanSession,
  personalizedPlan,
  planProgress,
  planSessions,
  sessionForPlan,
} from '../plans.js';
import { icon } from '../icons.js';
import { escapeHtml, toast } from '../ui.js';
import {
  confirmThen,
  courtLines,
  focusLabel,
  levelLabel,
  nextSessionBlock,
  planDone,
  planHead,
  planProgressBlock,
  playSession,
  sessionNumber,
} from './train.js';

// Premium: sin suscripción → paywall honesto; con suscripción → cuestionario y plan personalizado.

const BENEFITS = [
  { icon: 'calendar', title: 'Plan de 4 semanas para ti', text: 'Según tu nivel, los días que puedes entrenar y el material que tienes.' },
  { icon: 'ball', title: 'Se adapta a tus partidos', text: 'Si juegas mucho o tu carga de la semana está alta, ajusta el volumen para que llegues fresco.' },
  { icon: 'target', title: 'Cuida tus molestias', text: 'Trabajo específico para hombro, codo, rodilla, espalda o tobillo.' },
  { icon: 'clock', title: 'Sesiones guiadas', text: 'Temporizador con cada ejercicio explicado: solo tienes que seguirlo.' },
  { icon: 'medal', title: 'Insignia PRO en tu perfil', text: 'Que se note que vas en serio.', badge: true },
];

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

let editing = false; // "Editar respuestas" vuelve a enseñar el cuestionario
let busy = false;
let pollTimer = null; // espera a que el webhook de Stripe active Premium tras pagar

const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 90 * 1000;

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

const price = () => `${escapeHtml(CONFIG.premiumPrice)}/${escapeHtml(CONFIG.premiumPeriod)}`;

function setBusy(button, label) {
  if (!button) return () => {};
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  return () => {
    if (!button.isConnected) return;
    button.disabled = false;
    button.innerHTML = original;
  };
}

// ---------- Paywall ----------

// Cabecera azul de pista con la corona (paywall y estados de la suscripción).
function hero(inner, attrs = '') {
  return `
    <section class="prem-hero"${attrs}>
      ${courtLines()}
      <span class="prem-crown prem-crown-lg" aria-hidden="true">${icon('crown', { size: 30 })}</span>
      ${inner}
    </section>`;
}

// Vuelta de Stripe: el pago está hecho pero el webhook puede tardar unos segundos en activar Premium.
function activating({ timedOut = false } = {}) {
  return hero(`
    <h2 class="prem-hero-title">${timedOut ? 'Tu pago se está procesando' : 'Activando tu Premium…'}</h2>
    <p class="prem-lead">${timedOut
      ? 'Stripe aún no nos ha confirmado el pago. Suele tardar segundos; si en unos minutos no se activa, escríbenos y lo revisamos. No vuelvas a pagar.'
      : 'Gracias por tu pago. Lo estamos confirmando con Stripe; tarda solo unos segundos.'}</p>
    ${timedOut
      ? '<button class="btn accent big prem-cta" data-action="check-again">Comprobar de nuevo</button>'
      : '<div class="prem-loading" role="status"><span class="prem-spinner" aria-hidden="true"></span><span>Confirmando el pago…</span></div>'}`,
  ' aria-live="polite"');
}

// Ya hay una suscripción en Stripe (p. ej. con un cobro pendiente): se gestiona, no se paga otra.
function existingSubscription() {
  return hero(`
    <h2 class="prem-hero-title">Tu suscripción necesita atención</h2>
    <p class="prem-lead">Ya tienes una suscripción Premium, pero no está activa ahora mismo. Revisa tu método de pago en el portal de Stripe.</p>
    <button class="btn accent big prem-cta" data-action="manage">Gestionar suscripción</button>`);
}

function paywall(ctx) {
  const demo = ctx.backend.mode === 'demo';
  return `
    ${hero(`
      <span class="prem-eyebrow">PadelFit Premium</span>
      <h2 class="prem-hero-title" id="prem-title">Tu preparación física, hecha para ti</h2>
      <p class="prem-lead">Un plan de 4 semanas creado a partir de tu nivel, tus partidos y tus molestias. Y que cambia contigo.</p>
      <p class="prem-price"><strong>${escapeHtml(CONFIG.premiumPrice)}</strong><span>/${escapeHtml(CONFIG.premiumPeriod)}</span></p>
      <button class="btn accent big prem-cta" data-action="checkout">${icon('crown', { size: 20 })}Hazte Premium</button>
      <p class="prem-small">Cancela cuando quieras. Pago seguro con Stripe.</p>
      ${demo ? `<p class="prem-demo">${icon('info', { size: 16 })}<span>Modo demo: no se cobra nada. Puedes activar una prueba de 30 días.</span></p>` : ''}`,
    ' aria-labelledby="prem-title"')}

    <section class="card prem-benefits" aria-labelledby="prem-benefits-title">
      <h2 id="prem-benefits-title">Qué incluye</h2>
      <ul class="prem-list">
        ${BENEFITS.map((b) => `
          <li>
            <span class="prem-list-icon" aria-hidden="true">${icon(b.icon, { size: 20 })}</span>
            <span class="prem-list-body">
              <strong>${escapeHtml(b.title)}${b.badge ? ' <span class="premium-badge">PRO</span>' : ''}</strong>
              <span class="muted">${escapeHtml(b.text)}</span>
            </span>
          </li>`).join('')}
      </ul>
    </section>

    <section class="card prem-free" aria-labelledby="prem-free-title">
      <span class="prem-free-icon" aria-hidden="true">${icon('check', { size: 20 })}</span>
      <div>
        <h3 id="prem-free-title">Lo de siempre sigue gratis</h3>
        <p class="muted">Planes generales, sesiones rápidas, retos y toda la parte social.</p>
      </div>
    </section>

    <button class="btn primary big" data-action="checkout">Hazte Premium · ${price()}</button>
    <p class="prem-small-print">Se renueva cada ${escapeHtml(CONFIG.premiumPeriod)} hasta que lo canceles.${demo ? ' En la demo no hay cobros reales.' : ''}</p>`;
}

// ---------- Cuestionario ----------

function initialAnswers(ctx, answers) {
  const values = { ...DEFAULT_PREMIUM_ANSWERS, ...(answers ?? {}) };
  if (!answers && LEVELS[ctx.me?.level]) values.level = String(ctx.me.level);
  return values;
}

function isChecked(question, values, value) {
  const current = values[question.id];
  if (question.type === 'multi') {
    const list = Array.isArray(current) ? current.map(String) : [];
    if (value === 'ninguna') return !list.filter((v) => v !== 'ninguna').length;
    return list.includes(value);
  }
  return String(current) === value;
}

function questionnaire(ctx, answers) {
  const values = initialAnswers(ctx, answers);
  const isEdit = Boolean(answers);
  return `
    <header class="prem-head">
      ${planHead({ planId: 'premium', eyebrow: 'Premium', title: isEdit ? 'Edita tus respuestas' : 'Creemos tu plan' })}
      <p class="muted">${PREMIUM_QUESTIONS.length} preguntas rápidas. ${isEdit ? 'Tu plan se recalcula al guardar.' : 'Puedes cambiarlas cuando quieras.'}</p>
    </header>
    <form class="card prem-quiz" data-submit="save-answers" data-change="quiz-change">
      ${PREMIUM_QUESTIONS.map((q, i) => `
        <fieldset class="prem-q">
          <legend class="field-label"><span class="prem-q-num" aria-hidden="true">${i + 1}</span><span>${escapeHtml(q.label)}</span></legend>
          <div class="chips">
            ${q.options.map((o) => `
              <label class="chip-radio">
                <input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="q-${escapeHtml(q.id)}" value="${escapeHtml(o.value)}"
                  ${isChecked(q, values, String(o.value)) ? 'checked' : ''} ${q.type === 'single' ? 'required' : ''} />
                <span>${escapeHtml(o.label)}</span>
              </label>`).join('')}
          </div>
          ${q.id === 'equipment' ? '<p class="hint">¿Nada? Perfecto: entrenarás con tu propio peso.</p>' : ''}
          ${q.type === 'multi' && q.id !== 'equipment' ? '<p class="hint">Puedes marcar varias.</p>' : ''}
        </fieldset>`).join('')}
      <div class="prem-quiz-actions">
        <button class="btn primary big" type="submit">${isEdit ? 'Guardar y actualizar mi plan' : 'Crear mi plan'}</button>
        ${isEdit ? '<button class="btn big" type="button" data-action="cancel-edit">Cancelar</button>' : ''}
      </div>
    </form>`;
}

function readAnswers(form) {
  // Los campos llevan prefijo "q-": un control llamado "matches" taparía form.matches().
  const data = new FormData(form);
  const out = {};
  for (const q of PREMIUM_QUESTIONS) {
    if (q.type === 'multi') out[q.id] = data.getAll(`q-${q.id}`).map(String).filter((v) => v !== 'ninguna');
    else out[q.id] = String(data.get(`q-${q.id}`) ?? DEFAULT_PREMIUM_ANSWERS[q.id]);
  }
  return out;
}

// ---------- Plan personalizado ----------

function subscriptionText(subscription) {
  if (!subscription?.active) return 'Premium activo.';
  const until = subscription.renewsAt ? dateFmt.format(new Date(subscription.renewsAt)) : '';
  if (subscription.simulated) {
    return `Premium de prueba (demo)${until ? ` hasta el ${until}` : ''}. No se cobra nada.`;
  }
  if (subscription.paymentIssue) {
    return `Ha fallado el último cobro. Actualiza tu método de pago para no perder Premium${until ? ` (activo hasta el ${until})` : ''}.`;
  }
  if (!until) return 'Premium activo.';
  return subscription.willRenew ? `Premium activo · se renueva el ${until}.` : `Premium activo hasta el ${until}. No se renovará.`;
}

function weekCard(plan, week, { completed, next, active, currentWeek, allDone }) {
  const sessions = planSessions(plan).filter((s) => s.week === week);
  const now = active && week === currentWeek;
  const doneCount = sessions.filter((s) => allDone || completed[s.key]).length;
  return `
    <section class="card plan-week${now ? ' is-current' : ''}" aria-labelledby="plan-week-${week}">
      <div class="plan-week-head">
        <h3 class="plan-week-title" id="plan-week-${week}">Semana ${week}</h3>
        ${now ? '<span class="plan-badge">Ahora</span>' : ''}
        <span class="plan-week-count">${doneCount}/${sessions.length}</span>
      </div>
      <ol class="plan-sessions">
        ${sessions.map((s) => {
          const done = allDone || Boolean(completed[s.key]);
          const isNext = !allDone && next?.key === s.key;
          return `
            <li class="plan-session${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}">
              ${done
                ? `<span class="plan-session-mark" role="img" aria-label="Hecha">${icon('check', { size: 18 })}</span>`
                : `<span class="plan-session-mark" aria-hidden="true">${s.index}</span>`}
              <span class="plan-session-body">
                <strong>${escapeHtml(focusLabel(s))}</strong>
                <span class="muted">${s.minutes} min · ${escapeHtml(levelLabel(s.level))}</span>
              </span>
              ${isNext ? `<span class="plan-session-tag">${icon('play', { size: 14 })}Siguiente</span>` : ''}
            </li>`;
        }).join('')}
      </ol>
    </section>`;
}

function planView(ctx, { plan, planState, subscription }) {
  const active = planState.planId === 'premium';
  const other = planState.planId && !active ? getPlan(planState.planId) : null;
  const progress = planProgress(plan, planState);
  const next = nextPlanSession(plan, planState);
  const completed = active ? planState.completed ?? {} : {};
  const weeks = Array.from({ length: plan.weeks }, (_, i) => i + 1);
  // Terminado y sin reiniciar: se ve completo y se ofrece repetirlo (empezar reinicia el progreso).
  const finishedBefore = !active && progress.finished;

  return `
    <section class="card plan-active" aria-labelledby="prem-plan-title">
      ${planHead({ planId: 'premium', eyebrow: `Premium${subscription?.simulated ? ' · demo' : ''}`, title: escapeHtml(plan.name), id: 'prem-plan-title' })}
      <p class="muted prem-plan-desc">${escapeHtml(plan.description)}</p>
      ${active ? planProgressBlock(plan, progress, `Tu plan: ${progress.done} de ${progress.total} sesiones`) : ''}
      ${finishedBefore ? planDone('¡Completaste tu plan! Repítelo o edita tus respuestas para crear uno nuevo.') : ''}
      ${next ? `
        ${nextSessionBlock(plan, next, next.equipment ?? plan.equipment)}
        <button class="btn primary big plan-start" data-action="start-session">
          ${icon('play', { size: 20 })}<span>${finishedBefore ? 'Repetir plan' : `Empezar sesión ${sessionNumber(plan, next)}`}</span>
        </button>`
        : planDone('¡Has completado tu plan! Edita tus respuestas para crear el siguiente.')}
      ${other ? `<p class="hint prem-other">${icon('info', { size: 16 })}<span>Ahora tienes «${escapeHtml(other.name)}» en marcha. Al empezar, pasarás a tu plan personalizado.</span></p>` : ''}
    </section>

    ${plan.notes?.length ? `
      <section class="card prem-notes" aria-labelledby="prem-notes-title">
        <h2 id="prem-notes-title">Adaptado a ti</h2>
        <ul class="prem-notes-list">
          ${plan.notes.map((n) => `<li>${icon('check', { size: 18 })}<span>${escapeHtml(n)}</span></li>`).join('')}
        </ul>
      </section>` : ''}

    <section class="prem-weeks-section" aria-labelledby="prem-weeks-title">
      <h2 id="prem-weeks-title">Tus ${plan.weeks} semanas</h2>
      <div class="prem-weeks">
        ${weeks.map((w) => weekCard(plan, w, { completed, next, active, currentWeek: progress.currentWeek, allDone: finishedBefore })).join('')}
      </div>
    </section>

    <section class="card prem-manage" aria-labelledby="prem-manage-title">
      <h2 class="sr-only" id="prem-manage-title">Tu suscripción</h2>
      <p class="prem-manage-status">${icon('crown', { size: 20 })}<span>${escapeHtml(subscriptionText(subscription))}</span></p>
      <div class="actions wrap">
        <button class="btn" data-action="edit-answers">${icon('edit', { size: 18 })}Editar respuestas</button>
        <button class="btn" data-action="manage">${icon('sliders', { size: 18 })}Gestionar suscripción</button>
      </div>
    </section>`;
}

// ---------- Vista ----------

export default {
  route: 'premium',
  tab: 'entrenar',

  async render(ctx) {
    if (!ctx.me?.isPremium) {
      editing = false;
      if (ctx.backend.checkoutPending?.()) return activating({ timedOut: ctx.cache.pollTimedOut });
      const subscription = ctx.backend.mode === 'live' ? await ctx.backend.getSubscription().catch(() => null) : null;
      if (subscription?.manageable) return existingSubscription();
      return paywall(ctx);
    }
    stopPolling();
    ctx.backend.clearCheckoutPending?.();
    const { backend } = ctx;
    const answers = await backend.getPremiumAnswers();
    if (!answers || editing) return questionnaire(ctx, answers);

    const [planState, myActivities, subscription] = await Promise.all([
      backend.getPlanState(),
      backend.getMyActivities(),
      backend.getSubscription().catch(() => null),
    ]);
    const plan = personalizedPlan(answers, myActivities, ctx.now);
    ctx.cache.data = { plan, planState };
    return planView(ctx, { plan, planState, subscription });
  },

  mount(root, ctx) {
    if (ctx.me?.isPremium || pollTimer || ctx.cache.pollTimedOut || !ctx.backend.checkoutPending?.()) return;
    const startedAt = Date.now();
    pollTimer = setInterval(async () => {
      try {
        const me = await ctx.refreshMe();
        if (me?.isPremium) {
          stopPolling();
          ctx.backend.clearCheckoutPending?.();
          toast('¡Ya eres Premium!');
          ctx.rerender();
          return;
        }
      } catch {
        // Sin conexión un momento: se reintenta en el siguiente intervalo.
      }
      if (Date.now() - startedAt > POLL_FOR_MS) {
        stopPolling();
        ctx.cache.pollTimedOut = true;
        ctx.rerender();
      }
    }, POLL_EVERY_MS);
  },

  unmount() {
    editing = false;
    stopPolling();
  },

  actions: {
    async 'check-again'(el, ctx) {
      ctx.cache.pollTimedOut = false;
      await ctx.refreshMe();
      ctx.rerender();
    },

    async checkout(el, ctx) {
      const { backend } = ctx;
      if (backend.mode === 'demo') {
        confirmThen('Modo demo: se activará Premium 30 días sin cobrar nada.', 'Activar demo', async () => {
          await backend.startCheckout();
          await ctx.refreshMe();
          toast('Premium de prueba activado. Sin cobros: es la demo.');
          ctx.navigate('premium');
        });
        return;
      }
      // Live: redirige a Stripe. Si el navegador vuelve atrás, el botón se recupera.
      const restore = setBusy(el, 'Abriendo el pago seguro…');
      setTimeout(restore, 8000);
      try {
        const subscription = await backend.startCheckout();
        if (subscription) {
          await ctx.refreshMe();
          ctx.rerender();
        }
      } catch (error) {
        restore();
        throw error;
      }
    },

    async manage(el, ctx) {
      const { backend } = ctx;
      if (backend.mode === 'demo') {
        confirmThen('Modo demo: se cancelará tu Premium de prueba. No hay ningún cobro.', 'Dar de baja', async () => {
          await backend.manageSubscription();
          await ctx.refreshMe();
          toast('Premium de prueba cancelado.');
          ctx.navigate('premium');
        });
        return;
      }
      const restore = setBusy(el, 'Abriendo…');
      setTimeout(restore, 8000);
      try {
        const subscription = await backend.manageSubscription();
        if (subscription) {
          await ctx.refreshMe();
          ctx.rerender();
        }
      } catch (error) {
        restore();
        throw error;
      }
    },

    'quiz-change'(form, ctx, event) {
      const input = event?.target;
      if (input?.name !== 'q-pains' || !input.checked) return;
      // "Ninguna" y el resto se excluyen entre sí.
      form.querySelectorAll('input[name="q-pains"]').forEach((box) => {
        if (box !== input && (input.value === 'ninguna' || box.value === 'ninguna')) box.checked = false;
      });
    },

    async 'save-answers'(form, ctx) {
      if (busy) return;
      busy = true;
      const restore = setBusy(form.querySelector('[type="submit"]'), editing ? 'Guardando…' : 'Creando tu plan…');
      const wasEditing = editing;
      try {
        await ctx.backend.savePremiumAnswers(readAnswers(form));
      } catch (error) {
        restore();
        throw error;
      } finally {
        busy = false;
      }
      editing = false;
      toast(wasEditing ? 'Plan actualizado' : '¡Tu plan está listo!');
      ctx.navigate('premium');
    },

    'edit-answers'(el, ctx) {
      editing = true;
      ctx.navigate('premium');
    },

    'cancel-edit'(el, ctx) {
      editing = false;
      ctx.navigate('premium');
    },

    'start-session'(el, ctx) {
      const { plan, planState } = ctx.cache.data ?? {};
      if (!plan || !planState) return;
      const go = async () => {
        let state = planState;
        if (state.planId !== 'premium') {
          state = await ctx.backend.startPlan('premium');
          ctx.cache.data = { plan, planState: state };
          ctx.rerender(); // por si sale del temporizador sin guardar: la pantalla ya muestra el plan activo
        }
        const next = nextPlanSession(plan, state);
        if (!next) return;
        // Sin `equipment`: la sesión Premium usa el material de tus respuestas.
        await playSession(ctx, sessionForPlan(next), { planSession: next, sessionKeys: planSessions(plan).map((s) => s.key), returnTo: 'premium' });
      };
      if (planState.planId && planState.planId !== 'premium') {
        const current = getPlan(planState.planId)?.name ?? 'otro plan';
        confirmThen(`Tienes «${current}» en marcha. Si empiezas tu plan personalizado, perderás su progreso.`, 'Empezar', go);
        return;
      }
      return go();
    },
  },
};
