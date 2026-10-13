import { POSITIONS } from '../activities.js';
import { demoTag } from '../components.js';
import { LEVELS } from '../data.js';
import { icon } from '../icons.js';
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

// Cabecera: la pista (nuestro "mapa") con el icono de la app, la propuesta de valor en una línea y tres
// razones para entrar. Es la única pantalla con h1 propio: aquí la barra superior no lleva título.
const PROPS = [
  ['camera', 'Comparte tus partidos', 'con foto y resultado'],
  ['trophy', 'Completa retos', 'y desbloquea logros'],
  ['dumbbell', 'Entrena tu físico', 'con planes para pádel'],
];

function courtArt() {
  return `
    <div class="onb-court" aria-hidden="true">
      <svg class="onb-court-lines" viewBox="0 0 200 100" focusable="false">
        <rect x="6" y="6" width="188" height="88" rx="2"/>
        <path d="M37 6v88M163 6v88M37 50h126"/>
        <path class="onb-court-net" d="M100 2v96"/>
      </svg>
      <span class="onb-ball"></span>
      <img class="onb-logo" src="icons/icon.svg" alt="" width="72" height="72" />
    </div>`;
}

function heroHtml() {
  return `
    <header class="card onb-hero">
      ${courtArt()}
      <div class="onb-hero-body">
        <p class="onb-kicker">Bienvenido a PadelFit</p>
        <h1 class="onb-title">La red social del pádel</h1>
        <p class="onb-lead">Tus partidos, tus retos y tu físico, con tus amigos de pista.</p>
        <ul class="onb-props">
          ${PROPS.map(([name, title, text]) => `
            <li class="onb-prop">
              <span class="onb-prop-icon">${icon(name, { size: 22 })}</span>
              <span class="onb-prop-text"><strong>${title}</strong> <span>${text}</span></span>
            </li>`).join('')}
        </ul>
      </div>
    </header>`;
}

// Además del enlace, el correo trae un código de 6 cifras: es la forma de entrar en la app instalada en
// iPhone, donde el enlace se abre en Safari y la sesión no llega a la app.
function sentHtml(email) {
  return `
    <div class="card onb-card onb-sent" role="status">
      <span class="onb-sent-icon">${icon('check', { size: 28 })}</span>
      <h2>Te hemos enviado un enlace a tu correo</h2>
      <p class="muted">Ábrelo desde <strong class="onb-email">${escapeHtml(email)}</strong> en este dispositivo para entrar. Si no lo ves, mira en spam.</p>
      <form class="onb-code" data-submit="verify-code" novalidate>
        <label class="field-label" for="onb-code">¿Usas la app instalada? Escribe el código del correo</label>
        <div class="onb-code-row">
          <input class="input" id="onb-code" name="code" inputmode="numeric" autocomplete="one-time-code"
            maxlength="6" pattern="[0-9]{6}" placeholder="123456" />
          <button class="btn primary" type="submit">Entrar</button>
        </div>
        <p class="form-error" role="alert" hidden></p>
      </form>
      <button type="button" class="link onb-link" data-action="other-email">Usar otro correo</button>
    </div>`;
}

function signInHtml() {
  const card = sentTo
    ? sentHtml(sentTo)
    : `
      <form class="card onb-card" data-submit="sign-in" novalidate>
        <div class="onb-card-head">
          <h2>Entra o crea tu cuenta</h2>
          <p class="muted">Gratis. Solo necesitas tu email.</p>
        </div>
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

// Indicador de paso: dos barras (la actual y las anteriores en azul) y el texto "Paso 1 de 2".
function stepsHtml(step) {
  return `
    <p class="onb-steps">
      <span class="onb-bars" aria-hidden="true"><i class="on"></i><i class="${step === 2 ? 'on' : ''}"></i></span>
      <span>Paso ${step} de 2</span>
    </p>`;
}

function demoNote(demo) {
  return demo
    ? `<p class="onb-demo-note">${icon('info', { size: 18 })}<span>Modo demo: tus datos se guardan solo en este dispositivo y la comunidad es de ejemplo.</span></p>`
    : '';
}

function profileStepHtml() {
  const levels = Object.entries(LEVELS).map(([value, l]) => [value, l.label]);
  const positions = [...Object.entries(POSITIONS), ['', 'Los dos']];
  return `
    <form class="onb-step" data-step="1" data-submit="next" novalidate ${draft.step === 1 ? '' : 'hidden'}>
      ${heroHtml()}
      <div class="card onb-card">
        ${stepsHtml(1)}
        <div class="onb-card-head">
          <h2 tabindex="-1">Crea tu perfil</h2>
          <p class="muted">Así te encontrarán tus compañeros de pista.</p>
        </div>
        <div class="field">
          <label class="field-label" for="onb-name">¿Cómo te llamas?</label>
          <input class="input" id="onb-name" name="name" maxlength="${NAME_MAX}" autocomplete="name" autocapitalize="words"
            required placeholder="Nombre y apellido" value="${escapeHtml(draft.name)}" aria-describedby="onb-name-hint" />
          <p class="hint" id="onb-name-hint">Tu nombre aparece en tus partidos y comentarios.</p>
        </div>
        ${segmented('level', levels, draft.level, 'Tu nivel')}
        ${segmented('position', positions, draft.position, 'Juegas de… <span class="onb-optional">(opcional)</span>')}
        <div class="field">
          <label class="field-label" for="onb-club">Tu club <span class="onb-optional">(opcional)</span></label>
          <input class="input" id="onb-club" name="club" maxlength="${CLUB_MAX}" autocomplete="off"
            placeholder="Dónde sueles jugar" value="${escapeHtml(draft.club)}" />
        </div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn primary big" type="submit">Siguiente</button>
      </div>
    </form>`;
}

// ---------- Seguir jugadores (paso 2) ----------

// Dos líneas cortas de detalle en gris, como en las listas de Strava: cómo juega (nivel · posición) y
// dónde (su club; si no tiene, cuántos le siguen).
function playerMeta(p) {
  const game = [];
  if (LEVELS[p.level]) game.push(LEVELS[p.level].label);
  if (POSITIONS[p.position]) game.push(POSITIONS[p.position]);
  const followers = Number(p.followersCount) || 0;
  const place = p.club || (followers ? `${followers} ${plural(followers, 'seguidor', 'seguidores')}` : '');
  return [game.join(' · '), place].filter(Boolean);
}

// Botón conmutable: "Seguir" (borde azul) ↔ "Siguiendo" (gris, con marca) y aria-pressed. La única acción
// principal de la pantalla es "Empezar".
// El nombre del jugador va oculto a la vista para que el lector de pantalla diga a quién sigues.
const pickLabel = (on, name) =>
  `${on ? icon('check', { size: 18 }) : ''}<span>${on ? 'Siguiendo' : 'Seguir'}<span class="sr-only"> a ${escapeHtml(name)}</span></span>`;

function pickButton(p) {
  const on = picked.has(p.id);
  return `
    <button type="button" class="btn onb-pick" data-action="pick" data-id="${escapeHtml(p.id)}"
      data-name="${escapeHtml(p.name)}" aria-pressed="${on ? 'true' : 'false'}">${pickLabel(on, p.name)}</button>`;
}

function playerRow(p) {
  const meta = playerMeta(p);
  return `
    <li class="onb-player">
      ${avatar(p)}
      <span class="onb-player-info">
        <span class="onb-player-line">
          <span class="onb-player-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
          ${premiumBadge(p) || demoTag(p) ? `<span class="onb-player-tags">${premiumBadge(p)}${demoTag(p)}</span>` : ''}
        </span>
        ${meta.map((line) => `<span class="onb-player-meta">${escapeHtml(line)}</span>`).join('')}
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
      <div class="onb-list-head">
        <h3 class="label">${demo ? 'Jugadores de ejemplo' : 'Sugeridos para ti'}</h3>
        <button type="button" class="link onb-link" data-action="pick-all">${allPicked ? 'Quitar todos' : 'Seguir a todos'}</button>
      </div>
      <ul class="onb-players">${players.map(playerRow).join('')}</ul>`
    : `<p class="muted onb-empty">${icon('search', { size: 20 })}<span>Aún no hay jugadores para sugerirte. Podrás buscarlos desde la lupa de arriba cuando entres.</span></p>`;
  return `
    <div class="onb-step" data-step="2" ${draft.step === 2 ? '' : 'hidden'}>
      <div class="card onb-card">
        ${stepsHtml(2)}
        <div class="onb-card-head">
          <h2 tabindex="-1">Sigue a otros jugadores</h2>
          <p class="muted">Verás sus partidos en tu muro y podréis daros ¡Vamos!</p>
        </div>
        ${list}
      </div>
      <p class="onb-picked" aria-live="polite">${pickedText(players.length)}</p>
      <p class="form-error" role="alert" hidden></p>
      <button type="button" class="btn primary big onb-start" data-action="finish">Empezar</button>
      <button type="button" class="btn ghost onb-back" data-action="back-step">${icon('back', { size: 20 })}<span>Atrás</span></button>
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
  root.querySelector(`.onb-step[data-step="${step}"] h2[tabindex]`)?.focus();
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
    btn.innerHTML = pickLabel(on, btn.dataset.name ?? '');
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
            <span class="onb-sent-icon">${icon('ball', { size: 28 })}</span>
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

    async 'verify-code'(form, ctx) {
      if (busy || !sentTo) return;
      clearError(form);
      const code = form.elements.namedItem('code').value.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) {
        showError(form, 'El código tiene 6 cifras.');
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      busy = true;
      button.disabled = true;
      try {
        // Al validarse, el backend avisa del cambio de sesión y la app pasa al paso del perfil.
        await ctx.backend.verifyEmailCode(sentTo, code);
      } catch (error) {
        showError(form, error.message || 'El código no es válido. Pide uno nuevo.');
        button.disabled = false;
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

      if (failed) toast(`No se ha podido seguir a ${failed} ${plural(failed, 'jugador', 'jugadores')}. Búscalos desde la lupa de arriba.`);
      else toast(`¡Ya estás dentro, ${profile.name}! Publica tu primer partido con ＋`);

      // Si la app ya pasó al inicio antes de terminar de seguir, se repinta para que salgan sus partidos.
      if (!mounted) ctx.rerender();
    },
  },
};
