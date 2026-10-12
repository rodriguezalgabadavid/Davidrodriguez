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
import { escapeHtml, toast } from '../ui.js';
import {
  confirmThen,
  equipmentText,
  focusLabel,
  levelLabel,
  playSession,
  progressBar,
  sessionNumber,
} from './train.js';

// Premium: sin suscripción → paywall honesto; con suscripción → cuestionario y plan personalizado.

const BENEFITS = [
  { icon: '📅', title: 'Plan de 4 semanas para ti', text: 'Según tu nivel, los días que puedes entrenar y el material que tienes.' },
  { icon: '🎾', title: 'Se adapta a tus partidos', text: 'Si juegas mucho o tu carga de la semana está alta, ajusta el volumen para que llegues fresco.' },
  { icon: '🩹', title: 'Cuida tus molestias', text: 'Trabajo específico para hombro, codo, rodilla, espalda o tobillo.' },
  { icon: '⏱️', title: 'Sesiones guiadas', text: 'Temporizador con cada ejercicio explicado: solo tienes que seguirlo.' },
  { icon: '🏅', title: 'Insignia PRO en tu perfil', text: 'Que se note que vas en serio.', badge: true },
];

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

let editing = false; // "Editar respuestas" vuelve a enseñar el cuestionario
let busy = false;

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

function paywall(ctx) {
  const demo = ctx.backend.mode === 'demo';
  return `
    <button class="link back" data-route="entrenar">← Entrenar</button>
    <section class="prem-hero" aria-labelledby="prem-title">
      <span class="prem-crown prem-crown-lg" aria-hidden="true">👑</span>
      <span class="prem-eyebrow">PadelFit Premium</span>
      <h1 id="prem-title">Tu preparación física, hecha para ti</h1>
      <p class="prem-lead">Un plan de 4 semanas creado a partir de tu nivel, tus partidos y tus molestias. Y que cambia contigo.</p>
      <p class="prem-price"><strong>${escapeHtml(CONFIG.premiumPrice)}</strong><span>/${escapeHtml(CONFIG.premiumPeriod)}</span></p>
      <button class="btn primary big prem-cta" data-action="checkout">Hazte Premium</button>
      <p class="prem-small">Cancela cuando quieras. Pago seguro con Stripe.</p>
      ${demo ? '<p class="prem-demo">Modo demo: no se cobra nada. Puedes activar una prueba de 30 días.</p>' : ''}
    </section>

    <section class="card prem-benefits" aria-labelledby="prem-benefits-title">
      <h2 id="prem-benefits-title">Qué incluye</h2>
      <ul class="prem-list">
        ${BENEFITS.map((b) => `
          <li>
            <span class="prem-list-icon" aria-hidden="true">${b.icon}</span>
            <span class="prem-list-body">
              <strong>${escapeHtml(b.title)}${b.badge ? ' <span class="premium-badge">PRO</span>' : ''}</strong>
              <span class="muted">${escapeHtml(b.text)}</span>
            </span>
          </li>`).join('')}
      </ul>
    </section>

    <section class="card prem-free">
      <h3>Lo de siempre sigue gratis</h3>
      <p class="muted">Planes generales, sesiones rápidas, retos y toda la parte social.</p>
    </section>

    <button class="btn primary big prem-cta" data-action="checkout">Hazte Premium · ${price()}</button>`;
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
    ${isEdit
      ? '<button class="link back" data-action="cancel-edit">← Mi plan</button>'
      : '<button class="link back" data-route="entrenar">← Entrenar</button>'}
    <header class="prem-head">
      <span class="prem-eyebrow">👑 Premium</span>
      <h1>${isEdit ? 'Edita tus respuestas' : 'Creemos tu plan'}</h1>
      <p class="muted">${PREMIUM_QUESTIONS.length} preguntas rápidas. ${isEdit ? 'Tu plan se recalcula al guardar.' : 'Puedes cambiarlas cuando quieras.'}</p>
    </header>
    <form class="card prem-quiz" data-submit="save-answers" data-change="quiz-change">
      ${PREMIUM_QUESTIONS.map((q) => `
        <fieldset class="prem-q">
          <legend class="field-label">${escapeHtml(q.label)}</legend>
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
      <button class="btn primary big" type="submit">${isEdit ? 'Guardar y actualizar mi plan' : 'Crear mi plan'}</button>
      ${isEdit ? '<button class="btn big" type="button" data-action="cancel-edit">Cancelar</button>' : ''}
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
  return until ? `Premium activo · se renueva el ${until}.` : 'Premium activo.';
}

function weekCard(plan, week, { completed, next, active, currentWeek, allDone }) {
  const sessions = planSessions(plan).filter((s) => s.week === week);
  const now = active && week === currentWeek;
  return `
    <section class="card plan-week${now ? ' is-current' : ''}" aria-label="Semana ${week}">
      <h3 class="plan-week-title">Semana ${week}${now ? ' <span class="plan-badge">Ahora</span>' : ''}</h3>
      <ol class="plan-sessions">
        ${sessions.map((s) => {
          const done = allDone || Boolean(completed[s.key]);
          const isNext = !allDone && next?.key === s.key;
          return `
            <li class="plan-session${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}">
              ${done
                ? '<span class="plan-session-mark" role="img" aria-label="Hecha">✓</span>'
                : `<span class="plan-session-mark" aria-hidden="true">${s.index}</span>`}
              <span class="plan-session-body">
                <strong>${escapeHtml(focusLabel(s))}</strong>
                <span class="muted">${s.minutes} min · ${escapeHtml(levelLabel(s.level))}</span>
              </span>
              ${isNext ? '<span class="plan-session-tag">Siguiente</span>' : ''}
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
    <button class="link back" data-route="entrenar">← Entrenar</button>
    <section class="card plan-active plan-premium prem-plan" aria-labelledby="prem-plan-title">
      <div class="plan-head">
        <span class="plan-icon prem-icon" aria-hidden="true">👑</span>
        <div class="plan-head-text">
          <span class="prem-eyebrow">Premium${subscription?.simulated ? ' · demo' : ''}</span>
          <h1 id="prem-plan-title">${escapeHtml(plan.name)}</h1>
        </div>
      </div>
      <p class="muted">${escapeHtml(plan.description)}</p>
      ${active ? `
        <div class="plan-progress-line">
          <strong>Semana ${progress.currentWeek} de ${plan.weeks}</strong>
          <span class="muted">${progress.done}/${progress.total} sesiones</span>
        </div>
        ${progressBar(progress.pct, `Tu plan: ${progress.done} de ${progress.total} sesiones`)}` : ''}
      ${finishedBefore ? '<p class="plan-finished">🎉 ¡Completaste tu plan! Repítelo o edita tus respuestas para crear uno nuevo.</p>' : ''}
      ${next ? `
        <button class="btn primary big plan-start" data-action="start-session">
          ${finishedBefore ? '↻ Repetir plan' : '▶ Empezar'} sesión ${sessionNumber(plan, next)}: ${escapeHtml(focusLabel(next))}
        </button>
        <p class="hint center">≈ ${next.minutes} min · ${escapeHtml(levelLabel(next.level))} · ${escapeHtml(equipmentText(next.equipment ?? plan.equipment))}</p>`
        : '<p class="plan-finished">🎉 ¡Has completado tu plan! Edita tus respuestas para crear el siguiente.</p>'}
      ${other ? `<p class="hint">Ahora tienes «${escapeHtml(other.name)}» en marcha. Al empezar, pasarás a tu plan personalizado.</p>` : ''}
    </section>

    ${plan.notes?.length ? `
      <section class="card prem-notes" aria-labelledby="prem-notes-title">
        <h2 id="prem-notes-title">Adaptado a ti</h2>
        <ul class="prem-notes-list">
          ${plan.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}
        </ul>
      </section>` : ''}

    <div class="prem-weeks">
      ${weeks.map((w) => weekCard(plan, w, { completed, next, active, currentWeek: progress.currentWeek, allDone: finishedBefore })).join('')}
    </div>

    <section class="card prem-manage">
      <p class="prem-manage-status">${escapeHtml(subscriptionText(subscription))}</p>
      <div class="actions wrap">
        <button class="btn" data-action="edit-answers">✏️ Editar respuestas</button>
        <button class="btn" data-action="manage">Gestionar suscripción</button>
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
      return paywall(ctx);
    }
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

  unmount() {
    editing = false;
  },

  actions: {
    async checkout(el, ctx) {
      const { backend } = ctx;
      if (backend.mode === 'demo') {
        confirmThen('Modo demo: se activará Premium 30 días sin cobrar nada.', 'Activar demo', async () => {
          await backend.startCheckout();
          await ctx.refreshMe();
          toast('Premium de prueba activado 👑 Sin cobros: es la demo.');
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
      toast(wasEditing ? 'Plan actualizado ✓' : '¡Tu plan está listo! 💪');
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
        await playSession(ctx, sessionForPlan(next), { planSession: next, total: planSessions(plan).length, returnTo: 'premium' });
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
