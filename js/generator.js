import { EXERCISES, FOCUSES, LEVELS } from './data.js';

// Duración de cada ejercicio de calentamiento y vuelta a la calma, y transición entre ellos.
export const PREP_WORK = 45;
export const PREP_REST = 10;

// Generador pseudoaleatorio determinista (mulberry32) para poder repetir una sesión con la misma semilla.
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const MAIN_CATEGORIES = ['agilidad', 'potencia', 'core', 'hombro', 'resistencia'];

const clamp =(n, min, max) => Math.min(max, Math.max(min, n));

export function availableExercises({ level, equipment = [] }) {
  return EXERCISES.filter(
    (e) => e.level <= level && e.equipment.every((item) => equipment.includes(item)),
  );
}

// Elige `count` ejercicios repartidos de forma equilibrada entre las categorías (round-robin).
function pickBalanced(pool, categories, count, rng, exclude = new Set()) {
  const queues = categories.map((cat) =>
    shuffle(pool.filter((e) => e.category === cat && !exclude.has(e.id)), rng),
  );
  const picked = [];
  let i = 0;
  while (picked.length < count && queues.some((q) => q.length)) {
    const queue = queues[i % queues.length];
    if (queue.length) picked.push(queue.shift());
    i++;
  }
  return picked;
}

export function generateSession({
  focus = 'completa',
  level = 2,
  minutes = 30,
  equipment = [],
  seed = Date.now(),
} = {}) {
  const focusDef = FOCUSES[focus];
  const levelDef = LEVELS[level];
  if (!focusDef) throw new Error(`Objetivo desconocido: ${focus}`);
  if (!levelDef) throw new Error(`Nivel desconocido: ${level}`);

  const rng = createRng(seed);
  const pool = availableExercises({ level, equipment });
  const prepStep = PREP_WORK + PREP_REST;
  const totalSecs = minutes * 60;

  const warmupCount = clamp(Math.round((totalSecs * 0.15) / prepStep), 4, 6);
  const cooldownCount = clamp(Math.round((totalSecs * 0.1) / prepStep), 3, 6);
  const warmup = pickBalanced(pool, ['calentamiento'], warmupCount, rng);
  const cooldown = pickBalanced(pool, ['movilidad'], cooldownCount, rng);

  const used = new Set([...warmup, ...cooldown].map((e) => e.id));
  const mainCount = minutes <= 20 ? 4 : minutes <= 35 ? 5 : 6;
  const main = pickBalanced(pool, focusDef.categories, mainCount, rng, used);
  // Con poco material o nivel bajo puede que el objetivo no tenga suficientes ejercicios: completamos con otras categorías.
  if (main.length < mainCount) {
    main.forEach((e) => used.add(e.id));
    const others = MAIN_CATEGORIES.filter((c) => !focusDef.categories.includes(c));
    main.push(...pickBalanced(pool, others, mainCount - main.length, rng, used));
  }

  const { work, rest } = levelDef;
  const roundRest = level === 3 ? 45 : 60;
  const prepSecs = (warmup.length + cooldown.length) * prepStep;
  const mainSecs = Math.max(0, totalSecs - prepSecs);
  const perRound = main.length * (work + rest);
  const rounds = perRound ? clamp(Math.round((mainSecs + roundRest) / (perRound + roundRest)), 1, 8) : 0;

  return {
    id: `s-${seed}`,
    seed,
    title: focusDef.label,
    focus,
    level,
    minutes,
    equipment,
    work,
    rest,
    roundRest,
    rounds,
    blocks: [
      { key: 'warmup', name: 'Calentamiento', exercises: warmup.map((e) => e.id) },
      { key: 'main', name: 'Bloque principal', exercises: main.map((e) => e.id) },
      { key: 'cooldown', name: 'Vuelta a la calma', exercises: cooldown.map((e) => e.id) },
    ],
  };
}

// Convierte una sesión en una línea de tiempo de intervalos (trabajo / descanso) para el temporizador.
export function buildTimeline(session) {
  const steps = [];
  for (const block of session.blocks) {
    if (!block.exercises.length) continue;
    const isMain = block.key === 'main';
    const rounds = isMain ? session.rounds : 1;
    const work = isMain ? session.work : PREP_WORK;
    const rest = isMain ? session.rest : PREP_REST;
    for (let round = 1; round <= rounds; round++) {
      block.exercises.forEach((exerciseId, i) => {
        steps.push({ kind: 'work', seconds: work, exerciseId, block: block.name, round, rounds });
        const lastInRound = i === block.exercises.length - 1;
        if (!lastInRound) {
          steps.push({ kind: 'rest', seconds: rest, block: block.name, round, rounds });
        } else if (round < rounds) {
          steps.push({ kind: 'rest', seconds: session.roundRest, block: block.name, round, rounds, label: 'Descanso entre rondas' });
        }
      });
    }
    steps.push({ kind: 'rest', seconds: PREP_REST, block: block.name, label: 'Cambio de bloque' });
  }
  // La sesión termina con el último ejercicio, no con un descanso.
  while (steps.length && steps[steps.length - 1].kind === 'rest') steps.pop();
  return steps;
}

export function timelineDuration(steps) {
  return steps.reduce((sum, s) => sum + s.seconds, 0);
}

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
