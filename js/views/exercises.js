import { CATEGORIES, EXERCISES, LEVELS } from '../data.js';
import { PREMIUM_QUESTIONS } from '../plans.js';
import { icon } from '../icons.js';
import { emptyState, escapeHtml } from '../ui.js';

// Biblioteca de ejercicios: búsqueda + categorías + tarjetas desplegables.
// Al buscar solo se actualiza la lista de resultados, así el campo de texto no pierde el foco.

const EQUIPMENT_LABELS = Object.fromEntries(
  (PREMIUM_QUESTIONS.find((q) => q.id === 'equipment')?.options ?? []).map((o) => [o.value, o.label]),
);

const MAX_QUERY = 60;

// Minúsculas y sin tildes: "rotacion" encuentra "rotación".
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const SEARCH_INDEX = new Map(
  EXERCISES.map((e) => [e.id, fold(`${e.name} ${e.description} ${e.padel} ${CATEGORIES[e.category]?.label ?? ''} ${e.equipment.join(' ')}`)]),
);

function filterExercises({ query = '', category = 'all' }) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return EXERCISES.filter((e) =>
    (category === 'all' || e.category === category)
    && words.every((w) => SEARCH_INDEX.get(e.id).includes(w)));
}

function exerciseCard(ex) {
  const c = CATEGORIES[ex.category] ?? { label: ex.category, color: 'currentColor' };
  const pills = [
    ex.sides ? '<span class="pill">Ambos lados</span>' : '',
    ...(ex.equipment.length
      ? ex.equipment.map((e) => `<span class="pill">${escapeHtml(EQUIPMENT_LABELS[e] ?? e)}</span>`)
      : ['<span class="pill">Sin material</span>']),
  ].join('');
  return `
    <details class="exercise lib-exercise">
      <summary>
        <span class="dot" style="--tag:${escapeHtml(c.color)}" aria-hidden="true"></span>
        <span class="lib-ex-text">
          <span class="exercise-name">${escapeHtml(ex.name)}</span>
          <span class="lib-ex-meta">${escapeHtml(c.label)} · ${escapeHtml(LEVELS[ex.level]?.label ?? '')}</span>
        </span>
        <span class="lib-ex-chevron" aria-hidden="true">${icon('chevron', { size: 20 })}</span>
      </summary>
      <div class="exercise-body">
        <p>${escapeHtml(ex.description)}</p>
        <p class="why lib-why">${icon('ball', { size: 18 })}<span><strong>En pista:</strong> ${escapeHtml(ex.padel)}</span></p>
        <div class="pills">${pills}</div>
      </div>
    </details>`;
}

function countText(n) {
  return n === 1 ? '1 ejercicio' : `${n} ejercicios`;
}

function resultsHtml(list) {
  if (!list.length) {
    return emptyState({ icon: icon('search', { size: 30 }), title: 'Sin resultados', text: 'Prueba con otra palabra o elige otra categoría.' });
  }
  return list.map(exerciseCard).join('');
}

function state(ctx) {
  ctx.cache.query ??= '';
  ctx.cache.category ??= 'all';
  return ctx.cache;
}

function updateResults(ctx) {
  const list = filterExercises(state(ctx));
  const results = document.getElementById('lib-results');
  const count = document.getElementById('lib-count');
  if (results) results.innerHTML = resultsHtml(list);
  if (count) count.textContent = countText(list.length);
}

export default {
  route: 'ejercicios',
  tab: 'entrenar',

  async render(ctx) {
    const { query, category } = state(ctx);
    const list = filterExercises({ query, category });
    const chip = (key, label) => `
      <button class="chip${category === key ? ' on' : ''}" data-action="category" data-value="${escapeHtml(key)}" aria-pressed="${category === key}">${escapeHtml(label)}</button>`;
    return `
      <p class="muted lib-intro">Cada ejercicio, explicado y con su para qué en pista.</p>
      <div class="lib-filters">
        <label class="sr-only" for="lib-query">Buscar ejercicio</label>
        <div class="lib-search-wrap">
          <span class="lib-search-icon" aria-hidden="true">${icon('search', { size: 20 })}</span>
          <input class="input search lib-search" id="lib-query" type="search" inputmode="search" autocomplete="off"
            maxlength="${MAX_QUERY}" placeholder="Hombro, salto, rotación…" value="${escapeHtml(query)}" data-input="search" />
        </div>
        <div class="chips scroll lib-chips" role="group" aria-label="Categorías">
          ${chip('all', 'Todos')}
          ${Object.entries(CATEGORIES).map(([key, c]) => chip(key, c.label)).join('')}
        </div>
      </div>
      <p class="label lib-count" id="lib-count" role="status" aria-live="polite">${countText(list.length)}</p>
      <section class="library lib-results" id="lib-results" aria-label="Ejercicios">
        ${resultsHtml(list)}
      </section>`;
  },

  actions: {
    search(el, ctx) {
      state(ctx).query = el.value.slice(0, MAX_QUERY);
      updateResults(ctx);
    },

    category(el, ctx) {
      const key = el.dataset.value === 'all' || CATEGORIES[el.dataset.value] ? el.dataset.value : 'all';
      state(ctx).category = key;
      el.parentElement.querySelectorAll('.chip').forEach((chip) => {
        const on = chip.dataset.value === key;
        chip.classList.toggle('on', on);
        chip.setAttribute('aria-pressed', String(on));
      });
      updateResults(ctx);
    },
  },
};
