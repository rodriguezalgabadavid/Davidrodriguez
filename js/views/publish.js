import { ACTIVITY_TYPES, MATCH_KINDS, knownNames, matchOutcome, parseSets } from '../activities.js';
import { FOCUSES } from '../data.js';
import { icon, TYPE_ICONS } from '../icons.js';
import { resizeImage } from '../photos.js';
import { escapeHtml, toLocalInput } from '../ui.js';
import { showCelebration, snapshot, snapshotFrom } from './celebrate.js';

// Publicar una actividad en menos de 15 segundos: tipo → ¿cómo fue? → (opcional) foto y texto → Publicar.
// Lo demás va en "Más detalles".

const TYPES = [
  { id: 'partido', icon: TYPE_ICONS.partido, label: 'Partido' },
  { id: 'entreno', icon: TYPE_ICONS.entreno, label: 'Entreno' },
  { id: 'clase', icon: TYPE_ICONS.clase, label: 'Clase' },
];

const RESULTS = [
  { value: 'true', icon: 'trophy', label: 'Victoria' },
  { value: 'false', icon: 'close', label: 'Derrota' },
  { value: 'none', icon: 'ball', label: 'Sin resultado' },
];

const RPE_LABELS = {
  1: 'Muy suave', 2: 'Suave', 3: 'Cómodo', 4: 'Moderado', 5: 'Algo duro',
  6: 'Duro', 7: 'Muy duro', 8: 'Intenso', 9: 'Casi al límite', 10: 'Máximo',
};

const MAX_MINUTES = 600;
const MAX_GAMES = 99;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

// Estado del borrador que no vive en el DOM. Se limpia al salir de la vista y en cada render.
let photo = null; // { blob, url }
let durationTouched = false;
let clubTouched = false;
let busy = false;
let mounted = false;

function clearPhoto() {
  if (photo?.url) URL.revokeObjectURL(photo.url);
  photo = null;
}

function resetDraft() {
  clearPhoto();
  durationTouched = false;
  clubTouched = false;
}

// El club del perfil se propone para partidos y clases; un entreno suele ser en casa o en el gimnasio.
const clubFor = (type, myClub) => (type === 'entreno' ? '' : myClub ?? '');

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d;
}

// ---------- Render ----------

// Tipo de actividad: control segmentado con icono (como el selector de deporte de Strava).
function typeOptions(selected) {
  return TYPES.map((t) => `
    <label>
      <input type="radio" name="type" value="${t.id}" ${selected === t.id ? 'checked' : ''} data-change="type" />
      <span>${icon(t.icon, { size: 20 })}${escapeHtml(t.label)}</span>
    </label>`).join('');
}

// ¿Cómo ha ido?: tres opciones grandes. Lo marcado lleva borde, fondo suave y una marca de verificación.
function resultTiles() {
  return RESULTS.map((r) => `
    <label class="post-result">
      <input type="radio" name="won" value="${r.value}" />
      <span class="post-result-tile">
        <span class="post-result-icon">${icon(r.icon, { size: 22 })}</span>
        <span class="post-result-label">${escapeHtml(r.label)}</span>
        <span class="post-result-check">${icon('check', { size: 14 })}</span>
      </span>
    </label>`).join('');
}

function chipRadios(name, options, selected) {
  return Object.entries(options).map(([value, label]) => `
    <label class="chip-radio">
      <input type="radio" name="${name}" value="${escapeHtml(value)}" ${selected === value ? 'checked' : ''} />
      <span>${escapeHtml(label)}</span>
    </label>`).join('');
}

function setsGrid() {
  const cells = (side, label) => [0, 1, 2].map((i) => `
    <input class="input score-input" name="s${i}${side}" type="number" inputmode="numeric" min="0" max="${MAX_GAMES}"
      data-input="score" aria-label="Set ${i + 1}, ${label}" />`).join('');
  return `
    <div class="post-sets-grid">
      <span></span><span class="label">Set 1</span><span class="label">Set 2</span><span class="label">Set 3</span>
      <span class="post-sets-team">Nosotros</span>${cells('a', 'nuestros juegos')}
      <span class="post-sets-team">Rivales</span>${cells('b', 'juegos rivales')}
    </div>`;
}

const SETS_TOGGLE = {
  closed: `${icon('plus', { size: 20 })}<span>Añadir resultado</span>`,
  open: `${icon('close', { size: 20 })}<span>Quitar resultado</span>`,
};

function photoDrop() {
  return `
    <input class="sr-only post-photo-input" id="post-photo-input" type="file" accept="image/*" data-change="photo" />
    <label class="post-photo-drop" id="post-photo-drop" for="post-photo-input">
      <span class="post-photo-icon">${icon('camera', { size: 26 })}</span>
      <strong class="post-photo-label">Añadir foto</strong>
      <span class="post-photo-hint">La pista, tu pareja, el marcador…</span>
    </label>
    <div class="post-photo-preview" id="post-photo-preview" hidden></div>`;
}

function streakLine(before) {
  const streak = before?.streak;
  if (!streak?.weeks || streak.activeThisWeek) return '';
  const weeks = streak.weeks === 1 ? '1 semana' : `${streak.weeks} semanas`;
  return `
    <p class="post-streak">
      <span class="post-streak-icon">${icon('flame', { size: 20 })}</span>
      <span>Publica esta semana y mantienes tu racha de <strong>${weeks}</strong>.</span>
    </p>`;
}

// Etiqueta de un campo de "Más detalles" con su icono (decorativo).
const detailLabel = (forId, iconName, text) =>
  `<label class="field-label post-label" for="${forId}">${icon(iconName, { size: 18 })}<span>${text}</span></label>`;
const detailLegend = (iconName, text) =>
  `<legend class="field-label post-label">${icon(iconName, { size: 18 })}<span>${text}</span></legend>`;

function datalist(id, values) {
  return `<datalist id="${id}">${values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>`;
}

async function loadContext(backend) {
  const [activities, joined, planState] = await Promise.all([
    backend.getMyActivities().catch((error) => {
      console.error(error);
      return null;
    }),
    backend.getJoinedChallenges().catch(() => []),
    backend.getPlanState().catch(() => null),
  ]);
  return { activities, joined, planState };
}

// ---------- Lectura y validación del formulario ----------

function scoreRows(form) {
  return [0, 1, 2].map((i) => [form.elements[`s${i}a`].value.trim(), form.elements[`s${i}b`].value.trim()]);
}

// Marcador: { filled: false } si no se ha apuntado; si no, sets válidos y resultado, o un error.
function readScore(form) {
  const box = form.querySelector('#post-sets');
  if (!box || box.hidden) return { filled: false };
  const rows = scoreRows(form);
  if (rows.every(([a, b]) => a === '' && b === '')) return { filled: false };
  const incomplete = rows.some(([a, b]) => (a === '') !== (b === ''));
  const { sets, error } = parseSets(rows);
  if (error) return { filled: true, incomplete, error };
  if (sets.some(([a, b]) => a > MAX_GAMES || b > MAX_GAMES)) {
    return { filled: true, error: `Revisa el marcador: como mucho ${MAX_GAMES} juegos por set.` };
  }
  return { filled: true, sets, ...matchOutcome(sets) };
}

function wonFromRadio(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function readForm(form) {
  const f = form.elements;
  const type = ACTIVITY_TYPES[f.type.value] ? f.type.value : 'partido';

  const date = f.date.value ? new Date(f.date.value) : new Date();
  if (Number.isNaN(date.getTime())) return { error: 'Revisa la fecha y la hora.', focus: f.date };
  if (date.getTime() - Date.now() > FUTURE_SLACK_MS) return { error: 'La fecha no puede ser futura.', focus: f.date };

  const rawMinutes = f.minutes.value.trim();
  const minutes = rawMinutes === '' ? ACTIVITY_TYPES[type].defaultMinutes : Number(rawMinutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) {
    return { error: `La duración tiene que estar entre 1 y ${MAX_MINUTES} minutos.`, focus: f.minutes };
  }

  const input = {
    type,
    date: date.toISOString(),
    seconds: Math.round(minutes * 60),
    rpe: f.rpe.dataset.set === '1' ? Number(f.rpe.value) : null,
    won: null,
    sets: [],
    matchKind: null,
    partner: '',
    rivals: [],
    club: f.club.value,
    title: '',
    text: f.text.value,
    plan: null,
    focus: null,
  };

  if (type === 'partido') {
    const score = readScore(form);
    if (score.error) return { error: score.error, focus: f.s0a };
    input.sets = score.filled ? score.sets : [];
    input.won = score.filled ? score.won : wonFromRadio(f.won.value);
    input.matchKind = f.matchKind.value || null;
    input.partner = f.partner.value;
    input.rivals = [f.rival1.value, f.rival2.value].map((r) => r.trim()).filter(Boolean);
  }
  if (type === 'entreno') input.focus = f.focus.value || null;
  return { input };
}

// ---------- Actualizaciones en el sitio (sin repintar: no se pierde lo escrito) ----------

function showError(form, message, focusEl = null) {
  const el = form.querySelector('#post-error');
  el.textContent = message;
  el.hidden = false;
  if (focusEl && !focusEl.closest('[hidden]')) {
    focusEl.closest('details')?.setAttribute('open', '');
    focusEl.focus();
  }
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function clearError(form) {
  const el = form.querySelector('#post-error');
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function setBusy(form, on, label = on ? 'Publicando…' : 'Publicar') {
  const button = form.querySelector('.post-submit');
  button.disabled = on;
  button.setAttribute('aria-busy', String(on));
  button.textContent = label;
}

function applyType(form, type) {
  form.querySelectorAll('[data-only]').forEach((el) => {
    el.hidden = el.dataset.only !== type;
  });
  if (!durationTouched) form.elements.minutes.value = ACTIVITY_TYPES[type].defaultMinutes;
  if (!clubTouched) form.elements.club.value = clubFor(type, form.elements.club.dataset.default);
  clearError(form);
}

function updateVerdict(form) {
  const score = readScore(form);
  const verdict = form.querySelector('#post-verdict');
  const results = form.querySelector('#post-results');
  const locked = score.filled && !score.error;
  const derived = locked ? (score.won === true ? 'true' : score.won === false ? 'false' : 'none') : null;

  results.classList.toggle('post-locked', locked);
  results.querySelectorAll('input[name="won"]').forEach((input) => {
    if (locked) input.checked = input.value === derived;
    input.disabled = locked && input.value !== derived;
  });

  verdict.className = 'post-verdict';
  if (!score.filled) {
    verdict.textContent = '';
  } else if (score.error) {
    verdict.textContent = score.incomplete ? 'Completa el set para ver el resultado.' : score.error;
    verdict.classList.add('post-verdict-pending');
  } else {
    // Resultado con texto (no solo color) y sets ganados en cifras.
    const sets = `${score.setsFor}-${score.setsAgainst} en sets`;
    const [tone, word] = score.won === true ? ['win', 'Victoria'] : score.won === false ? ['loss', 'Derrota'] : ['draw', 'Empate'];
    verdict.innerHTML = `<span class="result ${tone}">${word}</span><span class="post-verdict-sets">${sets}</span>`;
    verdict.classList.add(`post-verdict-${tone}`);
  }
}

function renderPhoto(form) {
  const drop = form.querySelector('#post-photo-drop');
  const preview = form.querySelector('#post-photo-preview');
  if (!photo) {
    preview.hidden = true;
    preview.innerHTML = '';
    drop.hidden = false;
    return;
  }
  preview.innerHTML = `
    <img src="${escapeHtml(photo.url)}" alt="Vista previa de tu foto" />
    <label class="post-photo-change" for="post-photo-input">${icon('image', { size: 18 })}<span>Cambiar foto</span></label>
    <button type="button" class="post-photo-remove" data-action="remove-photo" aria-label="Quitar foto">${icon('trash', { size: 20 })}</button>`;
  preview.hidden = false;
  drop.hidden = true;
}

function setPhotoBusy(form, on) {
  const drop = form.querySelector('#post-photo-drop');
  drop.classList.toggle('post-photo-busy', on);
  drop.querySelector('.post-photo-label').textContent = on ? 'Preparando foto…' : 'Añadir foto';
}

// ---------- Vista ----------

export default {
  route: 'publicar',
  tab: 'publicar',

  async render(ctx) {
    resetDraft();
    const { backend, now, params, me } = ctx;
    const type = ACTIVITY_TYPES[params.type] ? params.type : 'partido';
    const focus = FOCUSES[params.focus] ? params.focus : null;

    // El "antes" de la celebración se calcula ya, para que publicar sea instantáneo.
    const data = await loadContext(backend);
    ctx.cache.before = data.activities ? snapshotFrom(data, now) : null;

    const { people, clubs } = knownNames(data.activities ?? []);
    if (me?.club && !clubs.some((c) => c.toLowerCase() === me.club.toLowerCase())) clubs.unshift(me.club);
    const minutes = ACTIVITY_TYPES[type].defaultMinutes;
    const focusOptions = Object.fromEntries(Object.entries(FOCUSES).map(([k, f]) => [k, f.label]));

    return `
      <form class="post" data-submit="publish" novalidate>
        ${streakLine(ctx.cache.before)}

        <section class="card post-card">
          <fieldset class="post-group">
            <legend class="post-legend"><h2 class="post-h">¿Qué has hecho?</h2></legend>
            <div class="segmented post-types">${typeOptions(type)}</div>
          </fieldset>
        </section>

        <section class="card post-card post-match" data-only="partido" ${type === 'partido' ? '' : 'hidden'}>
          <fieldset class="post-group post-results" id="post-results">
            <legend class="post-legend">
              <h2 class="post-h">¿Cómo ha ido?</h2>
              <span class="post-locked-note">${icon('lock', { size: 16 })}Según el marcador</span>
            </legend>
            <div class="post-results-grid">${resultTiles()}</div>
          </fieldset>
          <div class="post-score">
            <button type="button" class="btn ghost post-add-sets" data-action="toggle-sets" aria-expanded="false" aria-controls="post-sets">${SETS_TOGGLE.closed}</button>
            <div class="post-sets" id="post-sets" hidden>
              ${setsGrid()}
              <p class="hint">Deja vacío el set que no se jugó. Un súper tie-break se apunta como set (p. ej. 10-8).</p>
              <p class="post-verdict" id="post-verdict" aria-live="polite"></p>
            </div>
          </div>
        </section>

        <section class="card post-card" aria-labelledby="post-share-title">
          <h2 class="post-h" id="post-share-title">Cuéntalo <span class="post-optional">opcional</span></h2>
          <div class="post-photo">${photoDrop()}</div>
          <div class="field post-text">
            <label class="field-label" for="post-text">Descripción</label>
            <textarea class="input" id="post-text" name="text" rows="3" maxlength="2000" placeholder="¿Qué tal ha ido? Una frase basta"></textarea>
          </div>
        </section>

        <details class="card post-details">
          <summary>
            <span class="post-details-icon">${icon('sliders', { size: 20 })}</span>
            <span class="post-details-text">
              <strong>Más detalles</strong>
              <span class="post-details-hint">Fecha, duración, esfuerzo, con quién…</span>
            </span>
            ${icon('chevron', { size: 20, className: 'post-details-chevron' })}
          </summary>
          <div class="post-details-body">
            <div class="post-row post-when">
              <div class="field post-when-date">
                ${detailLabel('post-date', 'calendar', 'Fecha y hora')}
                <input class="input" id="post-date" name="date" type="datetime-local" value="${toLocalInput(now)}" max="${toLocalInput(endOfDay(now))}" />
              </div>
              <div class="field post-when-minutes">
                ${detailLabel('post-minutes', 'clock', 'Duración<span class="sr-only"> en minutos</span>')}
                <div class="post-unit">
                  <input class="input" id="post-minutes" name="minutes" type="number" inputmode="numeric" min="1" max="${MAX_MINUTES}" value="${minutes}" data-input="duration" />
                  <span class="post-unit-text" aria-hidden="true">min</span>
                </div>
              </div>
            </div>

            <div class="post-row field">
              <div class="post-rpe-head">
                <label class="field-label post-label" for="post-rpe">${icon('bolt', { size: 18 })}<span>Esfuerzo</span></label>
                <span class="post-rpe-out" id="post-rpe-out">sin indicar</span>
              </div>
              <input id="post-rpe" name="rpe" type="range" min="1" max="10" value="6" data-input="rpe" data-set="0" aria-describedby="post-rpe-hint" />
              <div class="post-rpe-foot">
                <p class="hint" id="post-rpe-hint">Mueve la barra si quieres apuntarlo (1 = muy suave, 10 = máximo).</p>
                <button type="button" class="link post-rpe-clear" data-action="clear-rpe" hidden>Quitar</button>
              </div>
            </div>

            <div data-only="partido" ${type === 'partido' ? '' : 'hidden'}>
              <div class="post-row field">
                ${detailLabel('post-partner', 'user', 'Compañero/a')}
                <input class="input" id="post-partner" name="partner" list="post-people" maxlength="40" autocomplete="off" placeholder="Nombre" />
              </div>
              <div class="post-row field-row">
                <div class="field">
                  ${detailLabel('post-rival1', 'users', 'Rival 1')}
                  <input class="input" id="post-rival1" name="rival1" list="post-people" maxlength="40" autocomplete="off" />
                </div>
                <div class="field">
                  ${detailLabel('post-rival2', 'users', 'Rival 2')}
                  <input class="input" id="post-rival2" name="rival2" list="post-people" maxlength="40" autocomplete="off" />
                </div>
              </div>
              <fieldset class="post-row field">
                ${detailLegend('trophy', 'Tipo de partido')}
                <div class="chips">${chipRadios('matchKind', MATCH_KINDS, null)}</div>
              </fieldset>
            </div>

            <fieldset class="post-row field" data-only="entreno" ${type === 'entreno' ? '' : 'hidden'}>
              ${detailLegend('target', 'Objetivo')}
              <div class="chips">${chipRadios('focus', focusOptions, focus)}</div>
            </fieldset>

            <div class="post-row field">
              ${detailLabel('post-club', 'pin', 'Club o pista')}
              <input class="input" id="post-club" name="club" list="post-clubs" maxlength="40" autocomplete="off" data-input="club"
                  value="${escapeHtml(clubFor(type, me?.club))}" data-default="${escapeHtml(me?.club ?? '')}" />
            </div>
            ${datalist('post-people', people)}
            ${datalist('post-clubs', clubs)}
          </div>
        </details>

        <div class="post-bar">
          <p class="form-error" id="post-error" role="alert" hidden></p>
          <button class="btn primary big post-submit" type="submit">Publicar</button>
        </div>
      </form>`;
  },

  mount() {
    mounted = true;
  },

  unmount() {
    mounted = false;
    resetDraft();
  },

  actions: {
    type(el) {
      applyType(el.form, el.value);
    },

    duration() {
      durationTouched = true;
    },

    club() {
      clubTouched = true;
    },

    'toggle-sets'(el) {
      const form = el.closest('form');
      const box = form.querySelector('#post-sets');
      const open = box.hidden;
      box.hidden = !open;
      el.setAttribute('aria-expanded', String(open));
      el.innerHTML = open ? SETS_TOGGLE.open : SETS_TOGGLE.closed;
      if (open) form.elements.s0a.focus();
      else box.querySelectorAll('input').forEach((input) => { input.value = ''; });
      updateVerdict(form);
    },

    score(el) {
      updateVerdict(el.form);
    },

    rpe(el) {
      el.dataset.set = '1';
      const form = el.form;
      form.querySelector('#post-rpe-out').textContent = `${el.value}/10 · ${RPE_LABELS[el.value] ?? ''}`;
      form.querySelector('.post-rpe-clear').hidden = false;
    },

    'clear-rpe'(el) {
      const form = el.closest('form');
      const range = form.elements.rpe;
      range.dataset.set = '0';
      range.value = '6';
      form.querySelector('#post-rpe-out').textContent = 'sin indicar';
      el.hidden = true;
      range.focus();
    },

    async photo(el) {
      const form = el.form;
      const file = el.files?.[0];
      if (!file) return;
      clearError(form);
      setPhotoBusy(form, true);
      try {
        const blob = await resizeImage(file);
        if (!form.isConnected) return;
        clearPhoto();
        photo = { blob, url: URL.createObjectURL(blob) };
        renderPhoto(form);
      } catch (error) {
        if (form.isConnected) showError(form, error.message || 'No se ha podido usar esa foto. Prueba con otra.');
      } finally {
        el.value = ''; // permite volver a elegir la misma foto
        if (form.isConnected) setPhotoBusy(form, false);
      }
    },

    'remove-photo'(el) {
      const form = el.closest('form');
      clearPhoto();
      renderPhoto(form);
      form.elements['post-photo-input']?.focus();
    },

    async publish(form, ctx) {
      if (busy) return;
      clearError(form);
      const { input, error, focus } = readForm(form);
      if (error) {
        showError(form, error, focus);
        return;
      }

      busy = true;
      setBusy(form, true);
      let activity;
      let before = ctx.cache.before ?? null;
      try {
        if (!before) before = await snapshot(ctx).catch(() => null);
        activity = await ctx.backend.createActivity(input, photo?.blob ?? null);
      } catch (err) {
        console.error(err);
        busy = false;
        setBusy(form, false);
        showError(form, err.message || 'No se ha podido publicar. Revisa tu conexión e inténtalo de nuevo.');
        return;
      }

      // Publicado: se limpia el borrador y se celebra lo conseguido.
      ctx.cache.before = null;
      resetDraft();
      if (form.isConnected) {
        renderPhoto(form);
        setBusy(form, true, '¡Publicado!');
      }
      try {
        const after = await snapshot(ctx).catch(() => null);
        await showCelebration(ctx, { activity, before, after });
      } catch (err) {
        console.error(err);
      } finally {
        busy = false;
      }
      // replace: "Volver" desde la actividad recién publicada lleva a donde estabas, no al formulario vacío.
      if (mounted) ctx.navigate('actividad', { id: activity.id }, { replace: true });
    },
  },
};
