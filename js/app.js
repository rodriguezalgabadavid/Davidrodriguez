import { generateSession } from './generator.js';
import { ACTIVITY_TYPES, demoActivities, migrateLegacyHistory, normalizeActivity, parseSets } from './activities.js';
import { startPlayer } from './player.js';
import { askConfirm, toast } from './ui.js';
import {
  rpeLabel, viewActividad, viewEjercicios, viewEntrenar, viewInicio, viewProgreso, viewRegistrar,
} from './views.js';

// ---------- Persistencia ----------

const STORAGE = {
  settings: 'padelfit:settings',
  activities: 'padelfit:activities',
  legacyHistory: 'padelfit:history',
};

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento (modo privado): la app sigue funcionando en memoria.
  }
}

function loadActivities() {
  const stored = read(STORAGE.activities);
  if (Array.isArray(stored)) return stored;
  const legacy = read(STORAGE.legacyHistory);
  return Array.isArray(legacy) ? migrateLegacyHistory(legacy) : [];
}

const state = {
  settings: {
    name: '',
    position: 'reves',
    focus: 'completa',
    level: 2,
    minutes: 30,
    equipment: [],
    weeklyGoal: 4,
    sound: true,
    ...(read(STORAGE.settings) ?? {}),
  },
  activities: loadActivities(),
  session: null,
  library: { category: 'all', query: '' },
  detailId: null,
  editId: null,
  draftType: null,
};

const saveSettings = () => write(STORAGE.settings, state.settings);
const saveActivities = () => write(STORAGE.activities, state.activities);
saveActivities();

// ---------- Navegación ----------

const $view = document.getElementById('view');

const VIEWS = {
  inicio: viewInicio,
  entrenar: viewEntrenar,
  registrar: viewRegistrar,
  progreso: viewProgreso,
  ejercicios: viewEjercicios,
  actividad: viewActividad,
};

function currentRoute() {
  const route = location.hash.replace('#', '');
  if (route === 'actividad' && !state.detailId) return 'inicio';
  return VIEWS[route] ? route : 'inicio';
}

function render() {
  const route = currentRoute();
  $view.innerHTML = VIEWS[route]({ state, now: new Date() });
  const tab = route === 'actividad' ? 'inicio' : route;
  document.querySelectorAll('.tabbar [data-route]').forEach((b) => b.classList.toggle('on', b.dataset.route === tab));
}

function navigate(route) {
  if (route !== 'registrar') state.editId = null;
  if (location.hash === `#${route}`) render();
  else location.hash = route;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
  if (location.hash !== '#registrar') state.editId = null;
  render();
});

// ---------- Acciones ----------

function addActivity(input) {
  const activity = normalizeActivity(input);
  const i = state.activities.findIndex((a) => a.id === activity.id);
  if (i >= 0) state.activities[i] = activity;
  else state.activities.push(activity);
  saveActivities();
  return activity;
}

function newSession() {
  const { focus, level, minutes, equipment } = state.settings;
  state.session = generateSession({ focus, level, minutes, equipment, seed: Math.floor(Math.random() * 2 ** 31) });
}

function exportData() {
  const data = { app: 'padelfit', version: 2, exportedAt: new Date().toISOString(), settings: state.settings, activities: state.activities };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `padelfit-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast('Copia descargada');
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.activities;
    if (!Array.isArray(list)) throw new Error('formato');
    const byId = new Map(state.activities.map((a) => [a.id, a]));
    for (const raw of list) {
      const a = normalizeActivity(raw);
      byId.set(a.id, a);
    }
    const added = byId.size - state.activities.length;
    state.activities = [...byId.values()];
    if (data.settings) Object.assign(state.settings, data.settings);
    saveActivities();
    saveSettings();
    render();
    toast(`Copia restaurada: ${list.length} actividades (${added} nuevas)`);
  } catch {
    toast('No se ha podido leer el archivo. Elige una copia descargada desde PadelFit.');
  }
}

function readActivityForm(form) {
  const f = new FormData(form);
  const type = f.get('type');
  const minutes = Number(f.get('minutes'));
  const date = new Date(f.get('date'));
  if (Number.isNaN(date.getTime())) return { error: 'Indica la fecha y la hora.' };
  if (!minutes || minutes < 1) return { error: 'Indica cuántos minutos duró.' };
  const input = {
    id: state.editId ?? undefined,
    type,
    date: date.toISOString(),
    seconds: minutes * 60,
    rpe: f.get('rpe'),
    title: f.get('title'),
    notes: f.get('notes'),
  };
  const editing = state.activities.find((a) => a.id === state.editId);
  if (editing) Object.assign(input, { focus: editing.focus, level: editing.level, demo: editing.demo });
  if (type === 'partido') {
    const { sets, error } = parseSets([0, 1, 2].map((i) => [f.get(`set${i}a`), f.get(`set${i}b`)]));
    if (error) return { error };
    Object.assign(input, {
      sets,
      matchKind: f.get('matchKind'),
      position: f.get('position'),
      partner: f.get('partner'),
      rivals: [f.get('rival1'), f.get('rival2')],
      club: f.get('club'),
    });
  }
  return { input };
}

// ---------- Eventos ----------

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-route], [data-action], [data-set]');
  if (!el || el.closest('#player, .confirm')) return;

  if (el.dataset.route) {
    if (el.dataset.route === 'registrar') Object.assign(state, { draftType: null, editId: null });
    return navigate(el.dataset.route);
  }

  if (el.dataset.set) {
    const key = el.dataset.set;
    state.settings[key] = ['focus', 'position'].includes(key) ? el.dataset.value : Number(el.dataset.value);
    if (key !== 'position') state.session = null;
    saveSettings();
    return render();
  }

  switch (el.dataset.action) {
    case 'open-activity':
      state.detailId = el.dataset.id;
      return navigate('actividad');
    case 'edit-activity':
      state.editId = el.dataset.id;
      return navigate('registrar');
    case 'cancel-edit':
      state.detailId = state.editId;
      return navigate('actividad');
    case 'delete-activity':
      return askConfirm('¿Eliminar esta actividad? No se puede deshacer.', 'Eliminar', () => {
        state.activities = state.activities.filter((a) => a.id !== el.dataset.id);
        saveActivities();
        toast('Actividad eliminada');
        navigate('inicio');
      });
    case 'load-demo':
      state.activities.push(...demoActivities());
      saveActivities();
      return render();
    case 'clear-demo':
      state.activities = state.activities.filter((a) => !a.demo);
      saveActivities();
      return render();
    case 'toggle-equipment': {
      const eq = new Set(state.settings.equipment);
      eq.has(el.dataset.value) ? eq.delete(el.dataset.value) : eq.add(el.dataset.value);
      state.settings.equipment = [...eq];
      state.session = null;
      saveSettings();
      return render();
    }
    case 'generate':
      newSession();
      render();
      return document.getElementById('session-preview')?.scrollIntoView({ behavior: 'smooth' });
    case 'start':
      return startPlayer(state.session, {
        settings: state.settings,
        onSave: (result) => {
          addActivity({ ...result, type: 'entreno', date: new Date().toISOString() });
          state.session = null;
          toast('Sesión guardada en tu muro');
          navigate('inicio');
        },
      });
    case 'library-category':
      state.library.category = el.dataset.value;
      return render();
    case 'export':
      return exportData();
    case 'clear-all':
      return askConfirm('¿Borrar todas tus actividades? Descarga antes una copia si quieres conservarlas.', 'Borrar todo', () => {
        state.activities = [];
        saveActivities();
        render();
        toast('Datos borrados');
      });
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'activity-form') return;
  event.preventDefault();
  const { input, error } = readActivityForm(event.target);
  const $error = document.getElementById('form-error');
  if (error) {
    $error.textContent = error;
    $error.hidden = false;
    return $error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const wasEditing = Boolean(state.editId);
  const activity = addActivity(input);
  state.editId = null;
  toast(wasEditing ? 'Cambios guardados' : `${ACTIVITY_TYPES[activity.type].label} guardado en tu muro`);
  if (wasEditing) {
    state.detailId = activity.id;
    return navigate('actividad');
  }
  navigate('inicio');
});

document.addEventListener('change', (event) => {
  const el = event.target;
  // Cambiar el tipo en el formulario: mostrar campos de partido y proponer una duración típica.
  if (el.name === 'type' && el.form?.id === 'activity-form') {
    state.draftType = el.value;
    el.form.querySelector('[data-section="partido"]').hidden = el.value !== 'partido';
    const minutes = el.form.elements.minutes;
    if (!minutes.dataset.touched) minutes.value = ACTIVITY_TYPES[el.value].defaultMinutes;
  }
  if (el.dataset.input === 'import' && el.files?.[0]) {
    importData(el.files[0]);
    el.value = '';
  }
});

document.addEventListener('input', (event) => {
  const el = event.target;
  if (el.name === 'minutes') el.dataset.touched = '1';
  if (el.id === 'f-rpe') document.getElementById('rpe-out').textContent = rpeLabel(el.value);

  switch (el.dataset.input) {
    case 'library-query': {
      state.library.query = el.value;
      const pos = el.selectionStart;
      render();
      const input = document.getElementById('library-query');
      input.focus();
      input.setSelectionRange(pos, pos);
      return;
    }
    case 'weekly-goal':
      state.settings.weeklyGoal = Number(el.value);
      document.getElementById('goal-out').textContent = el.value;
      return saveSettings();
    case 'sound':
      state.settings.sound = el.checked;
      return saveSettings();
    case 'name':
      state.settings.name = el.value.trim();
      return saveSettings();
  }
});

// ---------- Arranque ----------

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
