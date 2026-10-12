import { FOCUSES } from './data.js';

// Actividades de la red social: partidos, clases y sesiones de preparación física.
// Modelo completo (Activity) e ActivityInput: ver docs/ARCHITECTURE.md.

export const ACTIVITY_TYPES = {
  partido: { label: 'Partido', icon: '🎾', defaultMinutes: 90 },
  clase: { label: 'Clase técnica', icon: '🎯', defaultMinutes: 60 },
  entreno: { label: 'Preparación física', icon: '⚡', defaultMinutes: 40 },
};

export const MATCH_KINDS = {
  amistoso: 'Amistoso',
  liga: 'Liga',
  torneo: 'Torneo',
  americana: 'Americana',
};

export const POSITIONS = { drive: 'Drive', reves: 'Revés' };

// Límites de los campos editables (coinciden con lo que acepta la base de datos).
export const LIMITS = {
  seconds: 36000, // 10 h
  name: 40, // compañero, rivales y club
  rivals: 2,
  title: 80,
  text: 2000,
  sets: 5,
  games: 99,
};

export function newId() {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Convierte las filas del formulario en sets numéricos. Las filas vacías se ignoran.
export function parseSets(rows) {
  const sets = [];
  for (const [a, b] of rows) {
    const empty = (v) => v === '' || v === null || v === undefined;
    if (empty(a) && empty(b)) continue;
    const x = Number(a);
    const y = Number(b);
    if (empty(a) || empty(b) || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      return { sets: [], error: `Revisa el set ${sets.length + 1}: faltan juegos o hay un número no válido.` };
    }
    if (x === y) return { sets: [], error: `El set ${sets.length + 1} no puede acabar en empate (${x}-${y}).` };
    sets.push([x, y]);
  }
  if (!sets.length) return { sets, error: 'Añade al menos un set con el resultado.' };
  return { sets, error: null };
}

// won: true / false, o null si los sets quedaron igualados (p. ej. se acabó la hora de pista).
export function matchOutcome(sets = []) {
  let setsFor = 0;
  let setsAgainst = 0;
  let gamesFor = 0;
  let gamesAgainst = 0;
  for (const [a, b] of sets) {
    gamesFor += a;
    gamesAgainst += b;
    if (a > b) setsFor++;
    else setsAgainst++;
  }
  const won = setsFor === setsAgainst ? null : setsFor > setsAgainst;
  return { setsFor, setsAgainst, gamesFor, gamesAgainst, won };
}

// Resultado de un partido: el marcador manda; sin marcador, lo que dijo el jugador (won).
export function matchWon(activity) {
  if (activity?.type !== 'partido') return null;
  if (activity.sets?.length) return matchOutcome(activity.sets).won;
  return typeof activity.won === 'boolean' ? activity.won : null;
}

export function formatScore(sets = []) {
  return sets.map(([a, b]) => `${a}-${b}`).join(' ');
}

// Carga interna de la sesión (método sRPE de Foster): minutos × esfuerzo percibido.
// Sin RPE apuntado la carga es 0.
export function sessionLoad(activity) {
  return Math.round(((activity.seconds || 0) / 60) * (activity.rpe || 0));
}

export function activityTitle(activity) {
  const title = String(activity?.title ?? '').trim();
  if (title) return title;
  if (activity.type === 'partido') {
    const won = matchWon(activity);
    const verdict = won === true ? 'Victoria' : won === false ? 'Derrota' : activity.sets?.length ? 'Empate' : 'Partido';
    const kind = MATCH_KINDS[activity.matchKind];
    return kind ? `${verdict} · ${kind}` : verdict;
  }
  if (activity.type === 'entreno') return FOCUSES[activity.focus]?.label ?? 'Preparación física';
  if (activity.type === 'clase') return 'Clase';
  return 'Actividad';
}

const cleanLine = (s, max) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, max).trim();

function cleanDate(value) {
  const d = value instanceof Date ? new Date(value) : new Date(value ?? Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function cleanRpe(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : null;
}

// Sets válidos: pares de enteros 0-99 sin empate. Lo demás se descarta.
function cleanSets(sets) {
  if (!Array.isArray(sets)) return [];
  const out = [];
  for (const pair of sets) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [a, b] = [pair[0], pair[1]].map((v) => (v === '' || v === null ? NaN : Number(v)));
    const ok = (n) => Number.isInteger(n) && n >= 0 && n <= LIMITS.games;
    if (!ok(a) || !ok(b) || a === b) continue;
    out.push([a, b]);
    if (out.length === LIMITS.sets) break;
  }
  return out;
}

function cleanWon(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function cleanPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const planId = cleanLine(plan.planId, 40);
  if (!planId) return null;
  return { planId, sessionKey: cleanLine(plan.sessionKey, 40) };
}

// Sanea lo que llega del formulario, de una importación o del backend antes de guardar.
// Devuelve solo los campos de ActivityInput.
export function normalizeActivityInput(input = {}) {
  const type = ACTIVITY_TYPES[input.type] ? input.type : 'entreno';
  const isMatch = type === 'partido';
  const sets = isMatch ? cleanSets(input.sets) : [];
  let won = null;
  if (isMatch) won = sets.length ? matchOutcome(sets).won : cleanWon(input.won);
  return {
    type,
    date: cleanDate(input.date),
    seconds: Math.min(LIMITS.seconds, Math.max(0, Math.round(Number(input.seconds) || 0))),
    rpe: cleanRpe(input.rpe),
    won,
    sets,
    matchKind: isMatch && MATCH_KINDS[input.matchKind] ? input.matchKind : null,
    partner: cleanLine(input.partner, LIMITS.name),
    rivals: isMatch
      ? (Array.isArray(input.rivals) ? input.rivals : []).map((r) => cleanLine(r, LIMITS.name)).filter(Boolean).slice(0, LIMITS.rivals)
      : [],
    club: cleanLine(input.club, LIMITS.name),
    title: cleanLine(input.title, LIMITS.title),
    text: String(input.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, LIMITS.text).trim(),
    plan: cleanPlan(input.plan),
    focus: type === 'entreno' && FOCUSES[input.focus] ? input.focus : null,
  };
}

// Convierte lo que guardaron versiones anteriores de la app en ActivityInput:
// - v1: historial de sesiones de físico { date, title, seconds, rpe, focus, level }.
// - v2: actividades { type, date, seconds, rpe, sets, partner, rivals, club, matchKind, notes, title, focus }.
// Los datos de ejemplo de la v2 (demo: true) no son del usuario y se descartan.
export function fromLegacy(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object' && !item.demo)
    .map((item) => normalizeActivityInput({
      ...item,
      type: ACTIVITY_TYPES[item.type] ? item.type : 'entreno',
      text: item.text ?? item.notes ?? '',
      plan: null,
    }));
}

export function sortByDateDesc(activities) {
  return [...activities].sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Nombres ya usados (compañeros, rivales, clubes) para autocompletar el formulario.
export function knownNames(activities) {
  const people = new Map();
  const clubs = new Map();
  for (const a of activities) {
    if (a.type !== 'partido') continue;
    for (const name of [a.partner, ...(a.rivals ?? [])]) {
      if (name) people.set(name.toLowerCase(), name);
    }
    if (a.club) clubs.set(a.club.toLowerCase(), a.club);
  }
  return { people: [...people.values()].sort(), clubs: [...clubs.values()].sort() };
}
