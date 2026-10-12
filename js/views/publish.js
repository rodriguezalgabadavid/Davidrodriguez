import { ACTIVITY_TYPES, MATCH_KINDS, knownNames, matchOutcome, parseSets } from '../activities.js';
import { FOCUSES } from '../data.js';
import { resizeImage } from '../photos.js';
import { escapeHtml, toLocalInput } from '../ui.js';
import { showCelebration, snapshot, snapshotFrom } from './celebrate.js';

// Publicar una actividad en menos de 15 segundos: tipo → ¿cómo fue? → (opcional) foto y texto → Publicar.
// Lo demás va en "Más detalles".

const TYPES = [
  { id: 'partido', icon: '🎾', label: 'Partido' },
  { id: 'entreno', icon: '💪', label: 'Entreno' },
  { id: 'clase', icon: '🎯', label: 'Clase' },
];

const RESULTS = [
  { value: 'true', icon: '🏆', label: 'Victoria', tone: 'win' },
  { value: 'false', icon: '😤', label: 'Derrota', tone: 'loss' },
  { value: 'none', icon: '🤝', label: 'Sin resultado', tone: 'draw' },
];

const RPE_LABELS = {
  1: 'Muy suave', 2: 'Suave', 3: 'Moderado', 4: 'Algo duro', 5: 'Duro',
  6: 'Duro', 7: 'Muy duro', 8: 'Muy duro', 9: 'Extremo', 10: 'Máximo',
};

const MAX_MINUTES = 600;
const MAX_GAMES = 99;
const FUTURE_SLACK_MS = 5 * 60 * 1000;

// Estado del borrador que no vive en el DOM. Se limpia al salir de la vista y en cada render.
let photo = null; // { blob, url }
let durationTouched = false;
let busy = false;
let mounted = false;

function clearPhoto() {
  if (photo?.url) URL.revokeObjectURL(photo.url);
  photo = null;
}

function resetDraft() {
  clearPhoto();
  durationTouched = false;
}

// ---------- Render ----------

function radioTiles({ name, cls, items, selected, change = '' }) {
  return items.map((it) => `
    <label class="${cls}${it.tone ? ` ${cls}-${it.tone}` : ''}">
      <input type="radio" name="${name}" value="${escapeHtml(it.value ?? it.id)}" ${selected === (it.value ?? it.id) ? 'checked' : ''} ${change ? `data-change="${change}"` : ''} />
      <span><span class="${cls}-icon" aria-hidden="true">${it.icon}</span>${escapeHtml(it.label)}</span>
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
    <div class="sets-input">
      <span></span><span class="label">Set 1</span><span class="label">Set 2</span><span class="label">Set 3</span>
      <span class="label">Nosotros</span>${cells('a', 'nuestros juegos')}
      <span class="label">Rivales</span>${cells('b', 'juegos rivales')}
    </div>`;
}

function photoDrop() {
  return `
    <input class="post-sr-only post-photo-input" id="post-photo-input" type="file" accept="image/*" data-change="photo" />
    <label class="post-photo-drop" id="post-photo-drop" for="post-photo-input">
      <span class="post-photo-icon" aria-hidden="true">📷</span>
      <strong class="post-photo-label">Añadir foto</strong>
      <span class="muted">La pista, tu pareja, el marcador…</span>
    </label>
    <div class="post-photo-preview" id="post-photo-preview" hidden></div>`;
}

function streakLine(before) {
  const streak = before?.streak;
  if (!streak?.weeks || streak.activeThisWeek) return '';
  const weeks = streak.weeks === 1 ? '1 semana' : `${streak.weeks} semanas`;
  return `<p class="post-streak">🔥 Publica esta semana y mantienes tu racha de ${weeks}.</p>`;
}

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

function setBusy(form, on) {
  const button = form.querySelector('.post-submit');
  button.disabled = on;
  button.setAttribute('aria-busy', String(on));
  button.textContent = on ? 'Publicando…' : 'Publicar';
}

function applyType(form, type) {
  form.querySelectorAll('[data-only]').forEach((el) => {
    el.hidden = el.dataset.only !== type;
  });
  if (!durationTouched) form.elements.minutes.value = ACTIVITY_TYPES[type].defaultMinutes;
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
    const sets = `${score.setsFor}-${score.setsAgainst} en sets`;
    if (score.won === true) verdict.textContent = `🏆 Victoria · ${sets}`;
    else if (score.won === false) verdict.textContent = `Derrota · ${sets}`;
    else verdict.textContent = `Empate a sets (${score.setsFor}-${score.setsAgainst})`;
    verdict.classList.add(score.won === true ? 'post-verdict-win' : score.won === false ? 'post-verdict-loss' : 'post-verdict-draw');
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
    <button type="button" class="post-photo-remove" data-action="remove-photo" aria-label="Quitar foto">✕</button>
    <label class="post-photo-change" for="post-photo-input">Cambiar foto</label>`;
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
        <header class="post-head">
          <h1>¿Qué has hecho hoy?</h1>
          ${streakLine(ctx.cache.before)}
        </header>

        <fieldset class="post-types">
          <legend class="post-sr-only">Tipo de actividad</legend>
          ${radioTiles({ name: 'type', cls: 'post-type', items: TYPES, selected: type, change: 'type' })}
        </fieldset>

        <div class="card post-card" data-only="partido" ${type === 'partido' ? '' : 'hidden'}>
          <fieldset class="post-results" id="post-results">
            <legend class="post-q">¿Cómo fue?</legend>
            <div class="post-results-grid">
              ${radioTiles({ name: 'won', cls: 'post-result', items: RESULTS, selected: null })}
            </div>
          </fieldset>
          <button type="button" class="link post-add-sets" data-action="toggle-sets" aria-expanded="false" aria-controls="post-sets">＋ Añadir resultado</button>
          <div class="post-sets" id="post-sets" hidden>
            ${setsGrid()}
            <p class="hint">Deja vacío el set que no se jugó. Un súper tie-break se apunta como set (p. ej. 10-8).</p>
            <p class="post-verdict" id="post-verdict" aria-live="polite"></p>
          </div>
        </div>

        <div class="post-photo">${photoDrop()}</div>

        <div class="field post-text">
          <label class="field-label" for="post-text">¿Qué tal ha ido?</label>
          <textarea class="input" id="post-text" name="text" rows="3" maxlength="2000" placeholder="Cuéntalo en una frase (opcional)"></textarea>
        </div>

        <details class="card post-details">
          <summary>
            <span>Más detalles</span>
            <span class="muted">Fecha, duración, esfuerzo, con quién…</span>
          </summary>
          <div class="post-details-body">
            <div class="field-row">
              <div class="field">
                <label class="field-label" for="post-date">Fecha y hora</label>
                <input class="input" id="post-date" name="date" type="datetime-local" value="${toLocalInput(now)}" max="${toLocalInput(now.getTime() + 24 * 3600e3)}" />
              </div>
              <div class="field">
                <label class="field-label" for="post-minutes">Duración (min)</label>
                <input class="input" id="post-minutes" name="minutes" type="number" inputmode="numeric" min="1" max="${MAX_MINUTES}" value="${minutes}" data-input="duration" />
              </div>
            </div>

            <div class="field">
              <div class="row-between">
                <label class="field-label" for="post-rpe">Esfuerzo: <span id="post-rpe-out" class="post-rpe-out">sin indicar</span></label>
                <button type="button" class="link post-rpe-clear" data-action="clear-rpe" hidden>Quitar</button>
              </div>
              <input id="post-rpe" name="rpe" type="range" min="1" max="10" value="6" data-input="rpe" data-set="0" aria-describedby="post-rpe-hint" />
              <p class="hint" id="post-rpe-hint">Mueve la barra si quieres apuntarlo (1 = muy suave, 10 = máximo).</p>
            </div>

            <div data-only="partido" ${type === 'partido' ? '' : 'hidden'}>
              <div class="field">
                <label class="field-label" for="post-partner">Compañero/a</label>
                <input class="input" id="post-partner" name="partner" list="post-people" maxlength="40" autocomplete="off" placeholder="Nombre" />
              </div>
              <div class="field-row">
                <div class="field">
                  <label class="field-label" for="post-rival1">Rival 1</label>
                  <input class="input" id="post-rival1" name="rival1" list="post-people" maxlength="40" autocomplete="off" />
                </div>
                <div class="field">
                  <label class="field-label" for="post-rival2">Rival 2</label>
                  <input class="input" id="post-rival2" name="rival2" list="post-people" maxlength="40" autocomplete="off" />
                </div>
              </div>
              <fieldset class="field">
                <legend class="field-label">Tipo de partido</legend>
                <div class="chips">${chipRadios('matchKind', MATCH_KINDS, null)}</div>
              </fieldset>
            </div>

            <fieldset class="field" data-only="entreno" ${type === 'entreno' ? '' : 'hidden'}>
              <legend class="field-label">Objetivo</legend>
              <div class="chips">${chipRadios('focus', focusOptions, focus)}</div>
            </fieldset>

            <div class="field">
              <label class="field-label" for="post-club">Club o pista</label>
              <input class="input" id="post-club" name="club" list="post-clubs" maxlength="40" autocomplete="off" value="${escapeHtml(me?.club ?? '')}" />
            </div>
            ${datalist('post-people', people)}
            ${datalist('post-clubs', clubs)}
          </div>
        </details>

        <p class="form-error" id="post-error" role="alert" hidden></p>
        <button class="btn primary big post-submit" type="submit">Publicar</button>
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

    'toggle-sets'(el) {
      const form = el.closest('form');
      const box = form.querySelector('#post-sets');
      const open = box.hidden;
      box.hidden = !open;
      el.setAttribute('aria-expanded', String(open));
      el.textContent = open ? '－ Quitar resultado' : '＋ Añadir resultado';
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
      try {
        const after = await snapshot(ctx).catch(() => null);
        await showCelebration(ctx, { activity, before, after });
      } catch (err) {
        console.error(err);
      } finally {
        busy = false;
      }
      if (mounted) ctx.navigate('actividad', { id: activity.id });
    },
  },
};
