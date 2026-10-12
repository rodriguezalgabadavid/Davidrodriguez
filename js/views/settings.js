import { POSITIONS } from '../activities.js';
import { CONFIG } from '../config.js';
import { LEVELS } from '../data.js';
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
    <fieldset class="field">
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

function profileForm(p) {
  const bio = p?.bio ?? '';
  const levels = Object.entries(LEVELS).map(([value, l]) => [value, l.label]);
  // "Los dos" se guarda como sin posición (null).
  const positions = [...Object.entries(POSITIONS), ['', 'Los dos']];
  return `
    <form class="card set-card" data-submit="save-profile" autocomplete="off">
      <h2>Tu perfil</h2>
      <div class="field">
        <label class="field-label" for="set-name">Nombre</label>
        <input class="input" id="set-name" name="name" value="${escapeHtml(p?.name ?? '')}" maxlength="${NAME_MAX}"
          required autocomplete="name" autocapitalize="words" placeholder="Cómo te verán tus amigos" />
      </div>
      ${segmented('level', levels, p?.level ?? 2, 'Nivel')}
      ${segmented('position', positions, p?.position ?? '', 'Juegas de…')}
      <div class="field">
        <label class="field-label" for="set-club">Club <span class="muted">(opcional)</span></label>
        <input class="input" id="set-club" name="club" value="${escapeHtml(p?.club ?? '')}" maxlength="${CLUB_MAX}"
          placeholder="Dónde sueles jugar" />
      </div>
      <div class="field">
        <label class="field-label" for="set-bio">Sobre ti <span class="muted">(opcional)</span></label>
        <textarea class="input" id="set-bio" name="bio" rows="3" maxlength="${BIO_MAX}" data-input="bio-count"
          placeholder="Cuándo juegas, qué buscas, tu golpe favorito…" aria-describedby="set-bio-hint">${escapeHtml(bio)}</textarea>
        <p class="hint set-counter" id="set-bio-hint"><span id="set-bio-count">${bio.length}</span>/${BIO_MAX}</p>
      </div>
      <button class="btn primary big" type="submit">Guardar cambios</button>
    </form>`;
}

// ---------- Preferencias ----------

function preferences(settings) {
  const goal = clampGoal(settings?.weeklyGoal);
  return `
    <section class="card set-card" aria-labelledby="set-prefs-title">
      <h2 id="set-prefs-title">Preferencias</h2>
      <label class="set-row">
        <span class="set-row-text">
          <strong>Sonido y vibración</strong>
          <span class="muted">Avisos del temporizador al entrenar</span>
        </span>
        <input class="set-switch" type="checkbox" role="switch" data-change="sound" ${settings?.sound ? 'checked' : ''} />
      </label>
      <div class="set-row">
        <span class="set-row-text">
          <strong>Objetivo semanal</strong>
          <span class="muted">Actividades por semana. Lo verás en tu racha.</span>
        </span>
        <div class="set-stepper" role="group" aria-label="Objetivo semanal">
          <button class="set-step" type="button" data-action="goal" data-delta="-1" aria-label="Una menos" ${goal <= GOAL_MIN ? 'disabled' : ''}>−</button>
          <output class="set-goal" id="set-goal" aria-live="polite">${goal}</output>
          <button class="set-step" type="button" data-action="goal" data-delta="1" aria-label="Una más" ${goal >= GOAL_MAX ? 'disabled' : ''}>+</button>
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

function subscriptionBlock(sub, demo) {
  if (!sub) {
    return `
      <section class="card set-card" aria-labelledby="set-sub-title">
        <h2 id="set-sub-title">Suscripción</h2>
        <p class="muted">No se ha podido cargar tu suscripción.</p>
        <button class="btn" data-action="retry">Reintentar</button>
      </section>`;
  }
  if (sub.active) {
    const until = sub.renewsAt ? dateFmt.format(new Date(sub.renewsAt)) : '';
    return `
      <section class="card set-card set-sub set-sub-on" aria-labelledby="set-sub-title">
        <h2 id="set-sub-title">Suscripción</h2>
        <p class="set-sub-status">${premiumBadge({ isPremium: true })} Premium activo${until ? ` hasta el ${escapeHtml(until)}` : ''}</p>
        <p class="hint">${escapeHtml(renewalHint(sub))}</p>
        <button class="btn" data-action="manage-subscription">Gestionar suscripción</button>
      </section>`;
  }
  if (sub.manageable) {
    // Suscripción en Stripe sin Premium activo (cobro pendiente): se arregla en el portal, no pagando otra.
    return `
      <section class="card set-card set-sub" aria-labelledby="set-sub-title">
        <h2 id="set-sub-title">Suscripción</h2>
        <p class="set-sub-status">Premium en pausa</p>
        <p class="muted">Hay un problema con el cobro de tu suscripción. Revisa tu método de pago para recuperar Premium.</p>
        <button class="btn primary" data-action="manage-subscription">Gestionar suscripción</button>
      </section>`;
  }
  return `
    <section class="card set-card set-sub" aria-labelledby="set-sub-title">
      <h2 id="set-sub-title">Suscripción</h2>
      <p class="set-sub-status">Plan gratuito</p>
      <p class="muted">Con Premium tienes un plan de físico hecho para tu juego por ${escapeHtml(CONFIG.premiumPrice)}/${escapeHtml(CONFIG.premiumPeriod)}.</p>
      ${demo ? '<p class="hint">En la demo el pago es simulado: no se cobra nada.</p>' : ''}
      <button class="btn primary" data-route="premium">Ver Premium</button>
    </section>`;
}

// ---------- Cuenta y privacidad ----------

function accountBlock(demo) {
  if (demo) {
    return `
      <section class="card set-card" aria-labelledby="set-account-title">
        <h2 id="set-account-title">Cuenta</h2>
        <p class="muted">Estás en modo demo: tu cuenta, la comunidad de ejemplo y el pago son simulados y solo se guardan en este dispositivo.</p>
        <button class="btn danger set-danger" data-action="reset-demo">Reiniciar demo</button>
      </section>`;
  }
  return `
    <section class="card set-card" aria-labelledby="set-account-title">
      <h2 id="set-account-title">Cuenta</h2>
      <button class="btn set-danger" data-action="sign-out">Cerrar sesión</button>
    </section>`;
}

function privacyNote(demo) {
  return `
    <section class="set-privacy" aria-labelledby="set-privacy-title">
      <h2 id="set-privacy-title">Privacidad</h2>
      <p class="muted">Lo que publicas lo pueden ver los usuarios de PadelFit. Las fotos se guardan como enlaces públicos: no subas nada que no quieras compartir.</p>
      ${demo ? '<p class="muted">En la demo, todo se queda en este dispositivo.</p>' : ''}
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
        <button class="link set-back" data-route="perfil">← Tu perfil</button>
        <h1 class="set-heading">Ajustes</h1>
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
