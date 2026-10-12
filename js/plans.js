import { EQUIPMENT, FOCUSES } from './data.js';
import { generateSession } from './generator.js';
import { loadRatio } from './stats.js';

// Planes de preparación física: generales (gratis) y el personalizado (Premium).
// Cada sesión del plan tiene una clave estable 'w{semana}s{n}' (PlanState.completed usa esas claves)
// y una semilla derivada del plan y la clave, así la sesión es siempre la misma.

export const MAX_MINUTES = 60;

export const PLANS = [
  {
    id: 'primeros-pasos',
    name: 'Primeros pasos',
    icon: '🌱',
    description: 'Tu primer plan: split-step, desplazamientos laterales y un core que proteja tu espalda. Sin material y en 20 minutos.',
    level: 1,
    weeks: 4,
    sessionsPerWeek: 2,
    minutes: 20,
    focuses: ['completa', 'agilidad', 'core', 'prevencion'],
  },
  {
    id: 'pretemporada',
    name: 'Pretemporada',
    icon: '🔥',
    description: 'Ponte a punto antes de la liga: piernas, agilidad y resistencia para llegar a todas las bolas sin fundirte en el segundo set.',
    level: 2,
    weeks: 4,
    sessionsPerWeek: 3,
    minutes: 30,
    focuses: ['completa', 'agilidad', 'resistencia', 'potencia', 'core'],
  },
  {
    id: 'piernas-explosivas',
    name: 'Piernas explosivas',
    icon: '🦵',
    description: 'Salto, frenada y primer paso. Para llegar a la dejada, salir rápido de la pared y rematar por 3 con más potencia.',
    level: 2,
    weeks: 6,
    sessionsPerWeek: 2,
    minutes: 30,
    focuses: ['potencia', 'agilidad'],
  },
  {
    id: 'hombro-sano',
    name: 'Hombro sano',
    icon: '🛡️',
    description: 'Prevención para quien remata y saca mucho: manguito rotador, escápula y core para cuidar hombro, codo y espalda.',
    level: 1,
    weeks: 4,
    sessionsPerWeek: 2,
    minutes: 20,
    focuses: ['prevencion', 'core'],
  },
  {
    id: 'tercer-set',
    name: 'Tercer set',
    icon: '🔋',
    description: 'Intervalos que imitan los puntos largos para que el tercer set lo ganes tú. Para jugadores con buena base física.',
    level: 3,
    weeks: 4,
    sessionsPerWeek: 3,
    minutes: 40,
    focuses: ['resistencia', 'agilidad', 'core'],
  },
];

export function getPlan(id) {
  return PLANS.find((p) => p.id === id) ?? null;
}

// Hash FNV-1a de 32 bits: semilla estable a partir de un texto.
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Progresión suave: la segunda mitad del plan dura 5 minutos más (nunca más de 60).
function progressMinutes(base, week, weeks) {
  return Math.min(MAX_MINUTES, base + (week > Math.ceil(weeks / 2) ? 5 : 0));
}

function planSession(plan, { week, index, focus, level, minutes, prefix = plan.name, seedText }) {
  const key = `w${week}s${index}`;
  return {
    key,
    planId: plan.id,
    week,
    index,
    title: `${prefix} · ${FOCUSES[focus]?.label ?? 'Sesión'}`,
    focus,
    level,
    minutes,
    seed: hashSeed(seedText ?? `${plan.id}:${key}`),
  };
}

// Sesiones del plan en orden. Los objetivos (focuses) rotan sesión a sesión.
export function planSessions(plan) {
  if (!plan) return [];
  if (Array.isArray(plan.sessions)) return plan.sessions;
  const sessions = [];
  for (let week = 1; week <= plan.weeks; week++) {
    for (let index = 1; index <= plan.sessionsPerWeek; index++) {
      const i = (week - 1) * plan.sessionsPerWeek + index - 1;
      sessions.push(planSession(plan, {
        week,
        index,
        focus: plan.focuses[i % plan.focuses.length],
        level: plan.level,
        minutes: progressMinutes(plan.minutes, week, plan.weeks),
      }));
    }
  }
  return sessions;
}

// Sesión lista para el temporizador. Sin `equipment` usa el material de la sesión (plan Premium) o ninguno.
export function sessionForPlan(planSession, { equipment } = {}) {
  const session = generateSession({
    focus: planSession.focus,
    level: planSession.level,
    minutes: planSession.minutes,
    equipment: equipment ?? planSession.equipment ?? [],
    seed: planSession.seed,
  });
  session.title = planSession.title;
  session.plan = planSession.planId ? { planId: planSession.planId, sessionKey: planSession.key } : null;
  return session;
}

const isFinished = (plan, planState) =>
  Boolean(planState?.finished?.some((f) => f === plan.id || f?.planId === plan.id));

// Progreso de un plan. Solo cuenta planState.completed si es el plan activo; un plan terminado
// antes (y no reiniciado) aparece completo.
export function planProgress(plan, planState) {
  const sessions = planSessions(plan);
  const total = sessions.length;
  const active = Boolean(plan) && planState?.planId === plan.id;
  if (!active) {
    const finished = Boolean(plan) && isFinished(plan, planState);
    return {
      done: finished ? total : 0,
      total,
      pct: finished ? 100 : 0,
      currentWeek: finished ? plan.weeks : 1,
      finished,
      active: false,
    };
  }
  const completed = planState.completed ?? {};
  const done = sessions.filter((s) => completed[s.key]).length;
  const next = sessions.find((s) => !completed[s.key]);
  return {
    done,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
    currentWeek: next ? next.week : plan.weeks,
    finished: total > 0 && done >= total,
    active: true,
  };
}

// Siguiente sesión pendiente del plan activo (null si ya están todas). Para un plan que no es el
// activo devuelve la primera, porque empezarlo reinicia el progreso.
export function nextPlanSession(plan, planState) {
  const sessions = planSessions(plan);
  if (!plan || planState?.planId !== plan.id) return sessions[0] ?? null;
  const completed = planState.completed ?? {};
  return sessions.find((s) => !completed[s.key]) ?? null;
}

// ---------- Plan personalizado (Premium) ----------

const EQUIPMENT_LABELS = {
  banda: 'Banda elástica',
  conos: 'Conos',
  escalera: 'Escalera de agilidad',
  banco: 'Banco o step',
  'balón medicinal': 'Balón medicinal',
  mancuerna: 'Mancuerna',
  comba: 'Comba',
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const PREMIUM_QUESTIONS = [
  {
    id: 'goal',
    label: '¿Qué quieres conseguir?',
    type: 'single',
    options: [
      { value: 'rendimiento', label: 'Rendir más en pista' },
      { value: 'prevencion', label: 'Evitar lesiones' },
      { value: 'resistencia', label: 'Aguantar los partidos largos' },
      { value: 'potencia', label: 'Ganar potencia y explosividad' },
      { value: 'lesion', label: 'Volver tras una lesión' },
    ],
  },
  {
    id: 'days',
    label: '¿Cuántos días a la semana puedes entrenar?',
    type: 'single',
    options: [
      { value: '2', label: '2 días' },
      { value: '3', label: '3 días' },
      { value: '4', label: '4 días' },
    ],
  },
  {
    id: 'minutes',
    label: '¿Cuánto tiempo por sesión?',
    type: 'single',
    options: [
      { value: '20', label: '20 min' },
      { value: '30', label: '30 min' },
      { value: '45', label: '45 min' },
    ],
  },
  {
    id: 'level',
    label: '¿Cómo está tu forma física?',
    type: 'single',
    options: [
      { value: '1', label: 'Empezando' },
      { value: '2', label: 'Normal' },
      { value: '3', label: 'Muy en forma' },
    ],
  },
  {
    id: 'pains',
    label: '¿Tienes alguna molestia?',
    type: 'multi',
    options: [
      { value: 'hombro', label: 'Hombro' },
      { value: 'codo', label: 'Codo' },
      { value: 'rodilla', label: 'Rodilla' },
      { value: 'espalda', label: 'Espalda' },
      { value: 'tobillo', label: 'Tobillo' },
      { value: 'ninguna', label: 'Ninguna' },
    ],
  },
  {
    id: 'equipment',
    label: '¿Qué material tienes?',
    type: 'multi',
    options: EQUIPMENT.map((value) => ({ value, label: EQUIPMENT_LABELS[value] ?? capitalize(value) })),
  },
  {
    id: 'matches',
    label: '¿Cuántos partidos juegas a la semana?',
    type: 'single',
    options: [
      { value: '0-1', label: '0-1' },
      { value: '2-3', label: '2-3' },
      { value: '4+', label: '4 o más' },
    ],
  },
];

export const DEFAULT_PREMIUM_ANSWERS = {
  goal: 'rendimiento',
  days: '3',
  minutes: '30',
  level: '2',
  pains: [],
  equipment: [],
  matches: '2-3',
};

// Respuestas válidas (valores como texto, igual que en PREMIUM_QUESTIONS). 'ninguna' se ignora.
export function normalizePremiumAnswers(answers) {
  const raw = { ...DEFAULT_PREMIUM_ANSWERS, ...(answers && typeof answers === 'object' ? answers : {}) };
  const out = {};
  for (const q of PREMIUM_QUESTIONS) {
    const valid = q.options.map((o) => o.value);
    if (q.type === 'single') {
      const v = String(raw[q.id]);
      out[q.id] = valid.includes(v) ? v : DEFAULT_PREMIUM_ANSWERS[q.id];
    } else {
      const list = (Array.isArray(raw[q.id]) ? raw[q.id] : []).map(String);
      out[q.id] = valid.filter((v) => list.includes(v));
    }
  }
  out.pains = out.pains.filter((p) => p !== 'ninguna');
  return out;
}

// Peso de cada objetivo de sesión según la meta del jugador.
const GOAL_WEIGHTS = {
  rendimiento: { completa: 2, agilidad: 2, potencia: 1, core: 1, resistencia: 1 },
  prevencion: { prevencion: 3, core: 2, completa: 1, agilidad: 1 },
  resistencia: { resistencia: 3, agilidad: 2, completa: 1, core: 1 },
  potencia: { potencia: 3, agilidad: 2, core: 1, completa: 1 },
  lesion: { prevencion: 3, core: 2, completa: 1 },
};

const GOAL_NOTES = {
  rendimiento: 'Mezclamos agilidad, potencia y core para que rindas más en cada punto.',
  prevencion: 'Priorizamos prevención y core: menos lesiones, más partidos.',
  resistencia: 'Más intervalos de resistencia para que llegues entero al tercer set.',
  potencia: 'Más trabajo de salto y primer paso para ganar explosividad.',
  lesion: 'Vuelta tras lesión: empezamos en nivel de iniciación y subimos poco a poco. Sigue las pautas de tu fisio.',
};

const PAIN_NOTES = {
  hombro: 'Hombro: añadimos trabajo de manguito rotador y escápula. Calienta bien antes de bandejas y remates.',
  codo: 'Codo: fortalecemos antebrazo y hombro. Revisa el grip y el peso de tu pala.',
  rodilla: 'Rodilla: más estabilidad y menos saltos seguidos. Si duele al aterrizar, para.',
  espalda: 'Espalda: core antirrotación y movilidad. No fuerces los giros en frío.',
  tobillo: 'Tobillo: equilibrio y apoyos estables. Usa zapatillas de pádel con buen agarre.',
};

// Reparto ponderado suave (smooth weighted round-robin): determinista y bien mezclado.
function weightedSequence(weights, count) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  const current = Object.fromEntries(entries.map(([k]) => [k, 0]));
  const out = [];
  for (let i = 0; i < count; i++) {
    let best = null;
    for (const [k, w] of entries) {
      current[k] += w;
      if (best === null || current[k] > current[best]) best = k;
    }
    current[best] -= total;
    out.push(best);
  }
  return out;
}

// Plan Premium de 4 semanas a partir del cuestionario y de la carga reciente del jugador.
// Mismas respuestas, actividades y fecha → mismo plan.
export function personalizedPlan(answers, myActivities = [], now = new Date()) {
  const a = normalizePremiumAnswers(answers);
  const weeks = 4;
  const days = Number(a.days);
  const level = Number(a.level);
  const goalLabel = PREMIUM_QUESTIONS[0].options.find((o) => o.value === a.goal).label;
  const notes = [GOAL_NOTES[a.goal]];

  // Carga reciente alta: -20 % de volumen.
  const { zone } = loadRatio(myActivities ?? [], now);
  const highLoad = zone === 'alta' || zone === 'riesgo';
  const volume = highLoad ? 0.8 : 1;
  const baseMinutes = Math.round(Number(a.minutes) * volume);
  if (highLoad) {
    notes.push(`Tu carga de las últimas semanas está ${zone === 'riesgo' ? 'muy alta' : 'alta'}: bajamos el volumen un 20 % para que no te sobrecargues.`);
  }

  // Mucho partido: una sesión menos por semana.
  const sessionsPerWeek = a.matches === '4+' ? Math.max(1, days - 1) : days;
  const weights = { ...GOAL_WEIGHTS[a.goal] };
  if (a.matches === '4+') {
    notes.push('Juegas 4 o más partidos por semana: quitamos una sesión semanal para que llegues fresco.');
  } else if (a.matches === '0-1') {
    weights.resistencia = (weights.resistencia ?? 0) + 1;
    notes.push('Juegas poco: añadimos resistencia para que el físico no te frene cuando vuelvas a pista.');
  }

  // Cada molestia suma trabajo de prevención y movilidad: la primera reserva una sesión de prevención
  // cada semana (cada dos si solo hay una sesión semanal) y las demás suben su peso en el reparto.
  const preventionSlot = (week) => a.pains.length > 0 && (sessionsPerWeek >= 2 || week % 2 === 0);
  a.pains.forEach((pain, i) => {
    if (i > 0) weights.prevencion = (weights.prevencion ?? 0) + 1;
    if ((pain === 'rodilla' || pain === 'tobillo') && weights.potencia) weights.potencia -= 1;
    notes.push(PAIN_NOTES[pain]);
  });
  if (a.pains.length) notes.push('Si una molestia va a más o duele al entrenar, para y consulta con un fisioterapeuta.');
  if (!a.equipment.length) notes.push('Sin material: todos los ejercicios se hacen con tu propio peso.');

  const plan = {
    id: 'premium',
    name: 'Tu plan personalizado',
    icon: '👑',
    description: `Objetivo: ${goalLabel.toLowerCase()}. ${sessionsPerWeek} ${sessionsPerWeek === 1 ? 'sesión' : 'sesiones'} por semana de ${baseMinutes} min durante ${weeks} semanas.`,
    level: a.goal === 'lesion' ? 1 : level,
    weeks,
    sessionsPerWeek,
    minutes: baseMinutes,
    focuses: [],
    equipment: a.equipment,
    premium: true,
  };

  const weekNumbers = Array.from({ length: weeks }, (_, i) => i + 1);
  const freeSlots = (week) => sessionsPerWeek - (preventionSlot(week) ? 1 : 0);
  const sequence = weightedSequence(weights, weekNumbers.reduce((n, week) => n + freeSlots(week), 0));
  const sessions = [];
  let cursor = 0;
  for (const week of weekNumbers) {
    const focuses = sequence.slice(cursor, cursor + freeSlots(week));
    cursor += focuses.length;
    if (preventionSlot(week)) focuses.push('prevencion');
    const weekLevel = a.goal === 'lesion' ? (week <= 2 ? 1 : Math.min(level, 2)) : level;
    const minutes = Math.round(progressMinutes(Number(a.minutes), week, weeks) * volume);
    focuses.forEach((focus, i) => {
      const session = planSession(plan, {
        week,
        index: i + 1,
        focus,
        level: weekLevel,
        minutes,
        prefix: 'Plan Premium',
        seedText: `premium:${a.goal}:${a.level}:w${week}s${i + 1}`,
      });
      sessions.push({ ...session, equipment: a.equipment });
    });
  }

  // Objetivos del plan, de más a menos frecuentes.
  const counts = new Map();
  for (const s of sessions) counts.set(s.focus, (counts.get(s.focus) ?? 0) + 1);
  plan.focuses = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([focus]) => focus);
  plan.sessions = sessions;
  plan.notes = notes;
  return plan;
}
