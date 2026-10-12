import { POSITIONS } from '../activities.js';
import { LEVELS } from '../data.js';
import { avatar, escapeHtml, premiumBadge, toast } from '../ui.js';

// Bienvenida (sin barra inferior):
// - 'signed-out' (solo live): propuesta de valor + acceso con enlace mágico.
// - 'needs-profile': paso 1 "Tu perfil" → paso 2 "Sigue a otros jugadores" → Empezar.
// Cuando el backend avisa de 'ready', app.js navega al inicio por su cuenta.

const NAME_MAX = 40;
const CLUB_MAX = 80;
const EMAIL_MAX = 254;

// Borrador local (sobrevive a un repintado de la vista; se limpia al salir o al terminar).
let draft = freshDraft();
let picked = new Set(); // ids de jugadores sugeridos que quiero seguir
let sentTo = null; // email al que se envió el enlace mágico
let busy = false;
let mounted = false;

// position guarda la opción marcada tal cual: null (sin marcar), 'drive', 'reves' o '' ("Los dos").
function freshDraft() {
  return { step: 1, name: '', level: 2, position: null, club: '' };
}

function resetDraft() {
  draft = freshDraft();
  picked = new Set();
}

const plural = (n, one, many) => (n === 1 ? one : many);

// ---------- Acceso (live) ----------

function heroHtml() {
  return `
    <div class="onb-hero">
      <span class="onb-hero-icon" aria-hidden="true">🎾</span>
      <h1>La red social del pádel</h1>
      <p>Comparte tus partidos, completa retos con tus amigos y entrena tu físico.</p>
      <ul class="onb-props">
        <li><span aria-hidden="true">📸</span><span><strong>Comparte tus partidos</strong> con foto y resultado</span></li>
        <li><span aria-hidden="true">🏆</span><span><strong>Completa retos</strong> y desbloquea logros</span></li>
        <li><span aria-hidden="true">💪</span><span><strong>Entrena tu físico</strong> con planes para pádel</span></li>
      </ul>
    </div>`;
}

function sentHtml(email) {
  return `
    <div class="card onb-card onb-sent" role="status">
      <span class="onb-sent-icon" aria-hidden="true">📬</span>
      <h2>Te hemos enviado un enlace a tu correo</h2>
      <p class="muted">Ábrelo desde <strong>${escapeHtml(email)}</strong> en este dispositivo para entrar. Si no lo ves, mira en spam.</p>
      <button type="button" class="link onb-link" data-action="other-email">Usar otro correo</button>
    </div>`;
}

function signInHtml() {
  const card = sentTo
    ? sentHtml(sentTo)
    : `
      <form class="card onb-card" data-submit="sign-in" novalidate>
        <h2>Entra o crea tu cuenta</h2>
        <div class="field">
          <label class="field-label" for="onb-email">Tu email</label>
          <input class="input" id="onb-email" name="email" type="email" inputmode="email" autocomplete="email"
            maxlength="${EMAIL_MAX}" placeholder="tu@email.com" required aria-describedby="onb-email-hint" />
          <p class="hint" id="onb-email-hint">Te enviamos un enlace para entrar. Sin contraseñas.</p>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn primary big" type="submit">Enviarme el enlace</button>
      </form>`;
  return `<section class="onb">${heroHtml()}${card}</section>`;
}

// ---------- Perfil (paso 1) ----------

function segmented(name, options, selected, label) {
  return `
    <fieldset class="field">
      <legend class="field-label">${label}</legend>
      <div class="segmented onb-segmented">
        ${options.map(([value, text]) => `
          <label>
            <input type="radio" name="${name}" value="${escapeHtml(value)}" ${String(selected) === String(value) ? 'checked' : ''} />
            <span>${escapeHtml(text)}</span>
          </label>`).join('')}
      </div>
    </fieldset>`;
}

function stepsHtml(step) {
  return `
    <p class="onb-steps">
      <span class="onb-dots" aria-hidden="true"><i class="on"></i><i class="${step === 2 ? 'on' : ''}"></i></span>
      <span>Paso ${step} de 2</span>
    </p>`;
}

function demoNote(demo) {
  return demo
    ? '<p class="onb-demo-note">🧪 Modo demo: tus datos se guardan solo en este dispositivo y la comunidad es de ejemplo.</p>'
    : '';
}

function profileStepHtml() {
  const levels = Object.entries(LEVELS).map(([value, l]) => [value, l.label]);
  const positions = [...Object.entries(POSITIONS), ['', 'Los dos']];
  return `
    <form class="onb-step" data-step="1" data-submit="next" novalidate ${draft.step === 1 ? '' : 'hidden'}>
      ${stepsHtml(1)}
      <header class="onb-head">
        <h1 tabindex="-1">Tu perfil</h1>
        <p class="onb-intro">La red social del pádel: comparte partidos, completa retos y entrena tu físico.</p>
      </header>
      <div class="card onb-card">
        <div class="field">
          <label class="field-label" for="onb-name">¿Cómo te llamas?</label>
          <input class="input" id="onb-name" name="name" maxlength="${NAME_MAX}" autocomplete="name" autocapitalize="words"
            required placeholder="Nombre y apellido" value="${escapeHtml(draft.name)}" aria-describedby="onb-name-hint" />
          <p class="hint" id="onb-name-hint">Así te encontrarán tus compañeros.</p>
        </div>
        ${segmented('level', levels, draft.level, 'Tu nivel')}
        ${segmented('position', positions, draft.position, 'Juegas de… <span class="muted">(opcional)</span>')}
        <div class="field">
          <label class="field-label" for="onb-club">Tu club <span class="muted">(opcional)</span></label>
          <input class="input" id="onb-club" name="club" maxlength="${CLUB_MAX}" autocomplete="off"
            placeholder="Dónde sueles jugar" value="${escapeHtml(draft.club)}" />
        </div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn primary big" type="submit">Siguiente</button>
      </div>
    </form>`;
}

// ---------- Seguir jugadores (paso 2) ----------

function playerMeta(p) {
  const parts = [];
  if (LEVELS[p.level]) parts.push(LEVELS[p.level].label);
  if (POSITIONS[p.position]) parts.push(POSITIONS[p.position]);
  if (p.club) parts.push(p.club);
  const followers = Number(p.followersCount) || 0;
  if (followers) parts.push(`${followers} ${plural(followers, 'seguidor', 'seguidores')}`);
  return parts.join(' · ');
}

function pickButton(p) {
  const on = picked.has(p.id);
  return `
    <button type="button" class="btn onb-pick${on ? '' : ' primary'}" data-action="pick" data-id="${escapeHtml(p.id)}"
      aria-pressed="${on ? 'true' : 'false'}" aria-label="${escapeHtml(`Seguir a ${p.name}`)}">${on ? 'Siguiendo' : 'Seguir'}</button>`;
}

function playerRow(p) {
  const meta = playerMeta(p);
  return `
    <li class="onb-player">
      ${avatar(p)}
      <span class="onb-player-info">
        <span class="onb-player-name">${escapeHtml(p.name)}${premiumBadge(p)}${p.demo ? '<span class="onb-demo-tag">ejemplo</span>' : ''}</span>
        ${meta ? `<span class="onb-player-meta">${escapeHtml(meta)}</span>` : ''}
      </span>
      ${pickButton(p)}
    </li>`;
}

function pickedText(total) {
  const n = picked.size;
  if (!total) return '';
  if (!n) return 'Elige a quién seguir o empieza directamente.';
  return `Vas a seguir a ${n} ${plural(n, 'jugador', 'jugadores')}.`;
}

function followStepHtml(players, demo) {
  const allPicked = players.length > 0 && players.every((p) => picked.has(p.id));
  const list = players.length
    ? `
      <div class="onb-row">
        ${demo ? '<span class="onb-demo-label">Jugadores de ejemplo</span>' : '<span class="label">Sugeridos</span>'}
        <button type="button" class="link onb-link" data-action="pick-all">${allPicked ? 'Quitar todos' : 'Seguir a todos'}</button>
      </div>
      <ul class="onb-players">${players.map(playerRow).join('')}</ul>`
    : '<p class="muted onb-empty">Aún no hay jugadores para sugerirte. Podrás buscarlos con 🔍 cuando entres.</p>';
  return `
    <div class="onb-step" data-step="2" ${draft.step === 2 ? '' : 'hidden'}>
      ${stepsHtml(2)}
      <header class="onb-head">
        <h1 tabindex="-1">Sigue a otros jugadores</h1>
        <p class="onb-intro">Verás sus partidos en tu muro y podréis daros ¡Vamos!</p>
      </header>
      <div class="card onb-card">
        ${list}
      </div>
      <p class="onb-picked" aria-live="polite">${pickedText(players.length)}</p>
      <p class="form-error" role="alert" hidden></p>
      <button type="button" class="btn primary big onb-start" data-action="finish">Empezar</button>
      <button type="button" class="link onb-link onb-back" data-action="back-step">Atrás</button>
    </div>`;
}

function profileHtml(players, demo) {
  return `
    <section class="onb">
      ${profileStepHtml()}
      ${followStepHtml(players, demo)}
      ${demoNote(demo)}
    </section>`;
}

// ---------- Utilidades del DOM ----------

function showError(container, message) {
  const el = container.querySelector('.form-error');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearError(container) {
  const el = container?.querySelector('.form-error');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function goToStep(root, step) {
  draft.step = step;
  root.querySelectorAll('.onb-step').forEach((el) => {
    el.hidden = Number(el.dataset.step) !== step;
  });
  window.scrollTo(0, 0);
  root.querySelector(`.onb-step[data-step="${step}"] h1`)?.focus();
}

// Lo que hay en el formulario del paso 1 (position: la opción marcada, o null si no hay ninguna).
function readStep1(form) {
  const f = form.elements;
  const level = Number(f.namedItem('level')?.value);
  const checked = form.querySelector('input[name="position"]:checked');
  return {
    name: f.namedItem('name').value.trim().replace(/\s+/g, ' '),
    level: LEVELS[level] ? level : 2,
    position: checked ? checked.value : null,
    club: f.namedItem('club').value.trim().replace(/\s+/g, ' '),
  };
}

// Datos para backend.createProfile.
function profileInput({ name, level, position, club }) {
  return { name, level, position: POSITIONS[position] ? position : null, club };
}

function updatePicks(root, total) {
  root.querySelectorAll('.onb-pick').forEach((btn) => {
    const on = picked.has(btn.dataset.id);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('primary', !on);
    btn.textContent = on ? 'Siguiendo' : 'Seguir';
  });
  const all = total > 0 && picked.size === total;
  const allBtn = root.querySelector('[data-action="pick-all"]');
  if (allBtn) allBtn.textContent = all ? 'Quitar todos' : 'Seguir a todos';
  const text = root.querySelector('.onb-picked');
  if (text) text.textContent = pickedText(total);
}

function setStartBusy(root, on) {
  const btn = root.querySelector('.onb-start');
  if (btn) {
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
    btn.textContent = on ? 'Creando tu perfil…' : 'Empezar';
  }
  const back = root.querySelector('.onb-back');
  if (back) back.disabled = on;
}

// ---------- Vista ----------

export default {
  route: 'bienvenida',
  tab: null,

  async render(ctx) {
    const { backend } = ctx;
    const state = await backend.getAuthState();
    const demo = backend.mode === 'demo';

    if (state === 'signed-out') return signInHtml();
    if (state === 'ready') {
      // La app está a punto de llevarte al inicio.
      return `
        <section class="onb">
          <div class="card onb-card onb-sent">
            <span class="onb-sent-icon" aria-hidden="true">🎾</span>
            <h2>¡Ya estás dentro!</h2>
            <button type="button" class="btn primary big" data-route="inicio">Ir al inicio</button>
          </div>
        </section>`;
    }

    const players = await backend.suggestedPlayers().catch((error) => {
      console.error(error);
      return [];
    });
    ctx.cache.players = players;
    // Solo cuentan las selecciones de jugadores que siguen en la lista.
    const ids = new Set(players.map((p) => p.id));
    picked = new Set([...picked].filter((id) => ids.has(id)));
    return profileHtml(players, demo);
  },

  mount() {
    mounted = true;
  },

  unmount() {
    mounted = false;
    resetDraft();
    sentTo = null;
  },

  actions: {
    async 'sign-in'(form, ctx) {
      if (busy) return;
      clearError(form);
      const input = form.elements.namedItem('email');
      const email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError(form, 'Escribe un email válido, por ejemplo tu@email.com.');
        input.focus();
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      busy = true;
      button.disabled = true;
      button.textContent = 'Enviando…';
      try {
        await ctx.backend.signInWithEmail(email);
        sentTo = email;
        form.outerHTML = sentHtml(email);
      } catch (error) {
        showError(form, error.message || 'No se ha podido enviar el enlace. Inténtalo de nuevo.');
        button.disabled = false;
        button.textContent = 'Enviarme el enlace';
      } finally {
        busy = false;
      }
    },

    'other-email'(el, ctx) {
      sentTo = null;
      ctx.rerender();
    },

    next(form) {
      clearError(form);
      const profile = readStep1(form);
      if (!profile.name) {
        showError(form, 'Escribe tu nombre para que tus amigos te encuentren.');
        form.elements.namedItem('name').focus();
        return;
      }
      Object.assign(draft, profile);
      goToStep(form.closest('.onb'), 2);
    },

    'back-step'(el) {
      if (busy) return;
      const root = el.closest('.onb');
      clearError(root.querySelector('.onb-step[data-step="2"]'));
      goToStep(root, 1);
    },

    pick(el, ctx) {
      const id = el.dataset.id;
      if (!id || busy) return;
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      updatePicks(el.closest('.onb'), ctx.cache.players?.length ?? 0);
    },

    'pick-all'(el, ctx) {
      if (busy) return;
      const players = ctx.cache.players ?? [];
      const all = players.length > 0 && players.every((p) => picked.has(p.id));
      picked = all ? new Set() : new Set(players.map((p) => p.id));
      updatePicks(el.closest('.onb'), players.length);
    },

    async finish(el, ctx) {
      if (busy) return;
      const root = el.closest('.onb');
      const step = root.querySelector('.onb-step[data-step="2"]');
      const form = root.querySelector('.onb-step[data-step="1"]');
      const profile = profileInput(readStep1(form));
      if (!profile.name) {
        goToStep(root, 1);
        showError(form, 'Escribe tu nombre para que tus amigos te encuentren.');
        return;
      }

      clearError(step);
      busy = true;
      setStartBusy(root, true);
      const ids = [...picked];
      try {
        await ctx.backend.createProfile(profile);
      } catch (error) {
        console.error(error);
        busy = false;
        setStartBusy(root, false);
        showError(step, error.message || 'No se ha podido crear tu perfil. Inténtalo de nuevo.');
        return;
      }

      // El perfil ya existe: la app irá al inicio por su cuenta. Mientras, seguimos a los elegidos.
      const results = await Promise.allSettled(ids.map((id) => ctx.backend.follow(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      await ctx.refreshMe().catch((error) => console.error(error));
      busy = false;
      resetDraft();

      if (failed) toast(`No se ha podido seguir a ${failed} ${plural(failed, 'jugador', 'jugadores')}. Búscalos con 🔍.`);
      else toast(`¡Ya estás dentro, ${profile.name}! Publica tu primer partido con ＋`);

      // Si la app ya pasó al inicio antes de terminar de seguir, se repinta para que salgan sus partidos.
      if (!mounted) ctx.rerender();
    },
  },
};
