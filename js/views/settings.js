import { POSITIONS } from '../activities.js';
import { CONFIG } from '../config.js';
import { LEVELS } from '../data.js';
import { icon } from '../icons.js';
import { askConfirm, escapeHtml, premiumBadge, toast } from '../ui.js';

// Ajustes: editar el perfil, preferencias del dispositivo, suscripción y cuenta.

// Límites del perfil (coinciden con la base de datos).
const NAME_MAX = 60;
const CLUB_MAX = 80;
const BIO_MAX = 500;
const GOAL_MIN = 1;
const GOAL_MAX = 7;

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
const clampGoal = (n) => Math.min(GOAL_MAX, Math.max(GOAL_MIN, Math.round(Number(n) || 3)));

// ---------- Perfil ----------

function segmented(name, options, selected, label) {
  return `
    <fieldset class="field set-fieldset">
      <legend class="field-label">${label}</legend>
      <div class="segmented set-segmented">
        ${options.map(([value, text]) => `
          <label>
            <input type="radio" name="${name}" value="${escapeHtml(value)}" ${String(selected) === String(value) ? 'checked' : ''} />
            <span>${escapeHtml(text)}</span>
          </label>`).join('')}
      </div>
    </fieldset>`;
}

// Título de grupo al estilo de los ajustes de iOS / Strava: etiqueta pequeña en mayúsculas sobre la tarjeta.
const groupTitle = (id, text) => `<h2 class="label set-group-title" id="${id}">${text}</h2>`;

function profileForm(p) {
  const bio = p?.bio ?? '';
  const levels = Object.entries(LEVELS).map(([value, l]) => [value, l.label]);
  // "Los dos" se guarda como sin posición (null).
  const positions = [...Object.entries(POSITIONS), ['', 'Los dos']];
  return `
    <section class="set-group" aria-labelledby="set-profile-title">
      ${groupTitle('set-profile-title', 'Perfil')}
      <form class="card set-card set-form" data-submit="save-profile" autocomplete="off">
        <div class="field">
          <label class="field-label" for="set-name">Nombre</label>
          <input class="input" id="set-name" name="name" value="${escapeHtml(p?.name ?? '')}" maxlength="${NAME_MAX}"
            required autocomplete="name" autocapitalize="words" placeholder="Cómo te verán tus amigos" />
        </div>
        ${segmented('level', levels, p?.level ?? 2, 'Nivel')}
        ${segmented('position', positions, p?.position ?? '', 'Juegas de…')}
        <div class="field">
          <label class="field-label" for="set-club">Club <span class="set-optional">(opcional)</span></label>
          <input class="input" id="set-club" name="club" value="${escapeHtml(p?.club ?? '')}" maxlength="${CLUB_MAX}"
            placeholder="Dónde sueles jugar" />
        </div>
        <div class="field">
          <label class="field-label" for="set-bio">Sobre ti <span class="set-optional">(opcional)</span></label>
          <textarea class="input" id="set-bio" name="bio" rows="3" maxlength="${BIO_MAX}" data-input="bio-count"
            placeholder="Cuándo juegas, qué buscas, tu golpe favorito…" aria-describedby="set-bio-hint">${escapeHtml(bio)}</textarea>
          <p class="hint set-counter" id="set-bio-hint"><span id="set-bio-count">${bio.length}</span>/${BIO_MAX} caracteres</p>
        </div>
        <button class="btn primary big" type="submit">Guardar cambios</button>
      </form>
    </section>`;
}

// ---------- Preferencias ----------

function preferences(settings) {
  const goal = clampGoal(settings?.weeklyGoal);
  return `
    <section class="set-group" aria-labelledby="set-prefs-title">
      ${groupTitle('set-prefs-title', 'Preferencias')}
      <div class="card set-list">
        <label class="set-row set-row-tap">
          <span class="set-row-icon" aria-hidden="true">${icon('bell', { size: 20 })}</span>
          <span class="set-row-text">
            <strong>Sonido y vibración</strong>
            <span class="set-row-sub">Avisos del temporizador al entrenar</span>
          </span>
          <input class="set-switch" type="checkbox" role="switch" data-change="sound" ${settings?.sound ? 'checked' : ''} />
        </label>
        <div class="set-row">
          <span class="set-row-icon" aria-hidden="true">${icon('target', { size: 20 })}</span>
          <span class="set-row-text" id="set-goal-label">
            <strong>Objetivo semanal</strong>
            <span class="set-row-sub">Actividades por semana. Lo verás en tu perfil.</span>
          </span>
          <div class="set-stepper" role="group" aria-labelledby="set-goal-label">
            <button class="set-step" type="button" data-action="goal" data-delta="-1" aria-label="Una menos" ${goal <= GOAL_MIN ? 'disabled' : ''}>−</button>
            <output class="set-goal" id="set-goal" aria-live="polite">${goal}</output>
            <button class="set-step" type="button" data-action="goal" data-delta="1" aria-label="Una más" ${goal >= GOAL_MAX ? 'disabled' : ''}>+</button>
          </div>
        </div>
      </div>
    </section>`;
}

// ---------- Suscripción ----------

function renewalHint(sub) {
  if (sub.simulated) return 'Pago simulado de la demo: no se ha cobrado nada.';
  if (sub.paymentIssue) return 'Ha fallado el último cobro: actualiza tu método de pago para no perder Premium.';
  if (sub.willRenew === false) return 'Has cancelado la renovación: Premium sigue activo hasta esa fecha.';
  return 'Se renueva sola cada mes. Puedes cancelarla cuando quieras.';
}

// Cabecera de la tarjeta de suscripción: plan y estado escrito (no solo con color).
function subHead(plan, status, tone) {
  return `
    <div class="set-sub-head">
      <span class="set-sub-icon ${tone}" aria-hidden="true">${icon('crown', { size: 22 })}</span>
      <span class="set-row-text">
        <strong class="set-sub-plan">${plan}</strong>
        <span class="set-sub-status ${tone}">${status}</span>
      </span>
    </div>`;
}

function subscriptionBlock(sub, demo) {
  let body;
  if (!sub) {
    body = `
      <div class="card set-card set-sub">
        <p class="set-text">No se ha podido cargar tu suscripción.</p>
        <button class="btn" data-action="retry">Reintentar</button>
      </div>`;
  } else if (sub.active) {
    const until = sub.renewsAt ? dateFmt.format(new Date(sub.renewsAt)) : '';
    body = `
      <div class="card set-card set-sub">
        ${subHead(`Premium ${premiumBadge({ isPremium: true })}`, `Activo${until ? ` hasta el ${escapeHtml(until)}` : ''}`, 'on')}
        <p class="set-text">${escapeHtml(renewalHint(sub))}</p>
        <button class="btn" data-action="manage-subscription">Gestionar suscripción</button>
      </div>`;
  } else if (sub.manageable) {
    // Suscripción en Stripe sin Premium activo (cobro pendiente): se arregla en el portal, no pagando otra.
    body = `
      <div class="card set-card set-sub">
        ${subHead('Premium', 'En pausa: cobro pendiente', 'warn')}
        <p class="set-text">Hay un problema con el cobro de tu suscripción. Revisa tu método de pago para recuperar Premium.</p>
        <button class="btn primary" data-action="manage-subscription">Gestionar suscripción</button>
      </div>`;
  } else {
    body = `
      <div class="card set-card set-sub">
        ${subHead('Plan gratuito', 'Sin Premium', 'off')}
        <p class="set-text">Con Premium tienes un plan de físico hecho para tu juego por <strong>${escapeHtml(CONFIG.premiumPrice)}/${escapeHtml(CONFIG.premiumPeriod)}</strong>.</p>
        ${demo ? `<p class="set-note">${icon('info', { size: 18 })}<span>En la demo el pago es simulado: no se cobra nada.</span></p>` : ''}
        <button class="btn accent" data-route="premium">${icon('crown', { size: 20 })}<span>Ver Premium</span></button>
      </div>`;
  }
  return `
    <section class="set-group" aria-labelledby="set-sub-title">
      ${groupTitle('set-sub-title', 'Suscripción')}
      ${body}
    </section>`;
}

// ---------- Cuenta y privacidad ----------

function accountBlock(demo) {
  const body = demo
    ? `
      <div class="card set-card">
        <p class="set-note">${icon('info', { size: 18 })}<span>Estás en modo demo: tu cuenta, la comunidad de ejemplo y el pago son simulados y solo se guardan en este dispositivo.</span></p>
        <button class="btn danger set-danger" data-action="reset-demo">${icon('trash', { size: 20 })}<span>Reiniciar demo</span></button>
      </div>`
    : `
      <div class="card set-card">
        <button class="btn danger set-danger" data-action="sign-out">${icon('logout', { size: 20 })}<span>Cerrar sesión</span></button>
      </div>`;
  return `
    <section class="set-group" aria-labelledby="set-account-title">
      ${groupTitle('set-account-title', 'Cuenta')}
      ${body}
    </section>`;
}

function privacyNote(demo) {
  return `
    <section class="set-group" aria-labelledby="set-privacy-title">
      ${groupTitle('set-privacy-title', 'Privacidad')}
      <div class="card set-card set-privacy">
        <p class="set-text">Lo que publicas lo pueden ver los usuarios de PadelFit. Las fotos se guardan como enlaces públicos: no subas nada que no quieras compartir.</p>
        ${demo ? '<p class="set-text">En la demo, todo se queda en este dispositivo.</p>' : ''}
      </div>
    </section>`;
}

// ---------- Vista ----------

export default {
  route: 'ajustes',
  tab: 'perfil',

  async render(ctx) {
    const { backend } = ctx;
    const [me, sub] = await Promise.all([
      backend.getMe().catch(() => null),
      backend.getSubscription().catch(() => null),
    ]);
    const demo = backend.mode === 'demo';
    return `
      <section class="set-view">
        ${profileForm(me ?? ctx.me)}
        ${preferences(ctx.settings)}
        ${subscriptionBlock(sub, demo)}
        ${accountBlock(demo)}
        ${privacyNote(demo)}
      </section>`;
  },

  actions: {
    async 'save-profile'(form, ctx) {
      const data = new FormData(form);
      const level = Number(data.get('level'));
      const position = String(data.get('position') ?? '');
      const patch = {
        name: String(data.get('name') ?? '').trim(),
        level: LEVELS[level] ? level : (ctx.me?.level ?? 2),
        position: POSITIONS[position] ? position : null,
        club: String(data.get('club') ?? '').trim(),
        bio: String(data.get('bio') ?? '').trim(),
      };
      if (!patch.name) {
        form.elements.namedItem('name')?.focus();
        toast('Escribe tu nombre para que tus amigos te encuentren.');
        return;
      }
      const button = form.querySelector('[type="submit"]');
      if (button) {
        button.disabled = true;
        button.textContent = 'Guardando…';
      }
      try {
        await ctx.backend.updateMe(patch);
        await ctx.refreshMe();
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = 'Guardar cambios';
        }
      }
      toast('Perfil guardado ✓');
    },

    'bio-count'(el) {
      const out = document.getElementById('set-bio-count');
      if (out) out.textContent = String(el.value.length);
    },

    sound(el, ctx) {
      ctx.settings.sound = el.checked;
      ctx.saveSettings();
      toast(el.checked ? 'Sonido y vibración activados' : 'Sonido y vibración desactivados');
    },

    goal(el, ctx) {
      const next = clampGoal((Number(ctx.settings.weeklyGoal) || 3) + Number(el.dataset.delta || 0));
      ctx.settings.weeklyGoal = next;
      ctx.saveSettings();
      const out = document.getElementById('set-goal');
      if (out) out.textContent = String(next);
      for (const btn of el.closest('.set-stepper')?.querySelectorAll('[data-delta]') ?? []) {
        btn.disabled = Number(btn.dataset.delta) < 0 ? next <= GOAL_MIN : next >= GOAL_MAX;
      }
    },

    // Demo: cancela el Premium simulado (con confirmación). Live: abre el portal de Stripe.
    async 'manage-subscription'(el, ctx) {
      const run = async () => {
        el.disabled = true;
        try {
          await ctx.backend.manageSubscription();
          await ctx.refreshMe();
        } catch (error) {
          el.disabled = false;
          throw error;
        }
        if (ctx.backend.mode === 'demo') toast('Premium cancelado. Era simulado: no se cobró nada.');
        ctx.rerender();
      };
      if (ctx.backend.mode !== 'demo') return run();
      askConfirm('En la demo, gestionar la suscripción la cancela al momento. ¿Cancelar tu Premium simulado?', 'Cancelar Premium', () => {
        run().catch((error) => toast(error.message || 'No se ha podido cancelar. Inténtalo de nuevo.'));
      });
    },

    // Borra la cuenta demo; la app vuelve sola a la bienvenida.
    'reset-demo'(el, ctx) {
      askConfirm('Se borrarán tu perfil, tus actividades y todo lo de la demo en este dispositivo. ¿Empezar de cero?', 'Reiniciar demo', async () => {
        try {
          await ctx.backend.signOut();
          toast('Demo reiniciada');
        } catch (error) {
          toast(error.message || 'No se ha podido reiniciar la demo.');
        }
      });
    },

    'sign-out'(el, ctx) {
      askConfirm('¿Cerrar sesión en este dispositivo?', 'Cerrar sesión', async () => {
        try {
          await ctx.backend.signOut();
        } catch (error) {
          toast(error.message || 'No se ha podido cerrar la sesión.');
        }
      });
    },
  },
};
