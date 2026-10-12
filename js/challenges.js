import { matchWon } from './activities.js';
import { addDays, startOfWeek } from './stats.js';

// Retos semanales y mensuales. Cada periodo es una "instancia" distinta del reto, con id
// `${id}:${clave}`: 'YYYY-MM' para los mensuales y 'YYYY-Www' (semana ISO, de lunes a domingo)
// para los semanales. Todas las fechas en hora local.

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHALLENGES = [
  {
    id: 'activo-semana', icon: '🔥', title: '4 actividades esta semana', period: 'week', metric: 'activities', target: 4, unit: 'actividades',
    description: 'Partidos, clases o físico: todo suma. Publica 4 actividades antes del domingo.',
  },
  {
    id: 'fisico-semana', icon: '⚡', title: '3 sesiones de físico esta semana', period: 'week', metric: 'fitness', target: 3, unit: 'sesiones',
    description: 'Tres sesiones de preparación física en la semana. Tus piernas lo notarán en el tercer set.',
  },
  {
    id: 'partidos-mes', icon: '🎾', title: '8 partidos este mes', period: 'month', metric: 'matches', target: 8, unit: 'partidos',
    description: 'Dos partidos por semana y lo tienes. Amistosos, liga, americanas… todos cuentan.',
  },
  {
    id: 'victorias-mes', icon: '🏆', title: '5 victorias este mes', period: 'month', metric: 'wins', target: 5, unit: 'victorias',
    description: 'Gana 5 partidos este mes. Apunta el resultado al publicar para que cuenten.',
  },
  {
    id: 'horas-mes', icon: '⏱️', title: '12 horas de pádel este mes', period: 'month', metric: 'hours', target: 12, unit: 'horas',
    description: 'Suma 12 horas en pista entre partidos y clases.',
  },
  {
    id: 'fotos-mes', icon: '📸', title: 'Comparte 4 fotos este mes', period: 'month', metric: 'photos', target: 4, unit: 'fotos',
    description: 'La pista, tu pareja, el resultado… Publica 4 actividades con foto.',
  },
  {
    id: 'companeros-mes', icon: '🤝', title: 'Juega con 3 compañeros distintos este mes', period: 'month', metric: 'partners', target: 3, unit: 'compañeros',
    description: 'Cambia de pareja y conoce otros juegos. Apunta a tu compañero al publicar el partido.',
  },
];

export function getChallenge(id) {
  return CHALLENGES.find((c) => c.id === id) ?? null;
}

const pad = (n) => String(n).padStart(2, '0');

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Semana ISO: la semana 1 es la que contiene el 4 de enero; el año es el del jueves de esa semana.
export function isoWeek(date) {
  const monday = startOfWeek(date);
  const year = addDays(monday, 3).getFullYear();
  const week1 = startOfWeek(new Date(year, 0, 4));
  return { year, week: Math.round((monday - week1) / (7 * DAY_MS)) + 1 };
}

export function periodKey(period, now = new Date()) {
  const d = new Date(now);
  if (period === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const { year, week } = isoWeek(d);
  return `${year}-W${pad(week)}`;
}

// { from, to } del periodo que contiene `now` (from incluido, to excluido).
export function periodRange(period, now = new Date()) {
  const d = new Date(now);
  if (period === 'month') {
    return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
  }
  const from = startOfWeek(d);
  return { from, to: addDays(from, 7) };
}

export function instanceId(challenge, now = new Date()) {
  return `${challenge.id}:${periodKey(challenge.period, now)}`;
}

// 'partidos-mes:2026-10' → { from: 1/10/2026, to: 1/11/2026 }; 'x:2026-W53' → semana ISO 53.
export function rangeFromInstanceId(id) {
  const key = String(id ?? '').split(':').pop();
  let m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m) {
    const [year, month] = [Number(m[1]), Number(m[2])];
    if (month < 1 || month > 12) return null;
    return { from: new Date(year, month - 1, 1), to: new Date(year, month, 1) };
  }
  m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (m) {
    const [year, week] = [Number(m[1]), Number(m[2])];
    if (week < 1) return null;
    const from = addDays(startOfWeek(new Date(year, 0, 4)), (week - 1) * 7);
    const check = isoWeek(from);
    if (check.year !== year || check.week !== week) return null; // p. ej. semana 53 en un año que solo tiene 52
    return { from, to: addDays(from, 7) };
  }
  return null;
}

// Días que quedan contando hoy (el domingo de la semana del reto → 1).
function daysLeft(to, now) {
  return Math.max(0, Math.round((to - startOfDay(now)) / DAY_MS));
}

const inRange = (a, from, to) => {
  const t = new Date(a.date);
  return t >= from && t < to;
};

// Valor de la métrica de un reto con las actividades dadas (ya filtradas por periodo).
export function metricValue(metric, activities) {
  switch (metric) {
    case 'activities':
      return activities.length;
    case 'matches':
      return activities.filter((a) => a.type === 'partido').length;
    case 'wins':
      return activities.filter((a) => matchWon(a) === true).length;
    case 'fitness':
      return activities.filter((a) => a.type === 'entreno').length;
    case 'hours': {
      const seconds = activities.filter((a) => a.type !== 'entreno').reduce((s, a) => s + (Number(a.seconds) || 0), 0);
      return Math.round((seconds / 3600) * 10) / 10;
    }
    case 'photos':
      return activities.filter((a) => Boolean(a.photoUrl)).length;
    case 'partners': {
      const names = activities
        .filter((a) => a.type === 'partido' && a.partner)
        .map((a) => String(a.partner).trim().toLowerCase())
        .filter(Boolean);
      return new Set(names).size;
    }
    default:
      return 0;
  }
}

// Retos activos ahora mismo, con su instancia y su periodo.
export function currentChallenges(now = new Date()) {
  return CHALLENGES.map((c) => {
    const { from, to } = periodRange(c.period, now);
    return { ...c, instanceId: instanceId(c, now), from, to, endsInDays: daysLeft(to, now) };
  });
}

export function challengeProgress(challenge, myActivities, now = new Date()) {
  const { from, to } = periodRange(challenge.period, now);
  const value = metricValue(challenge.metric, myActivities.filter((a) => inRange(a, from, to)));
  return {
    instanceId: instanceId(challenge, now),
    value,
    target: challenge.target,
    pct: Math.min(100, Math.round((value / challenge.target) * 100)),
    done: value >= challenge.target,
    from,
    to,
    endsInDays: daysLeft(to, now),
  };
}

// Clasificación del periodo actual entre las actividades de tu círculo (tú + a quien sigues).
// Aparece todo el que tenga alguna actividad en la lista, aunque su valor sea 0.
export function leaderboard(challenge, circleActivities, now = new Date()) {
  const { from, to } = periodRange(challenge.period, now);
  const users = new Map();
  for (const a of circleActivities) {
    if (!a?.userId) continue;
    const entry = users.get(a.userId) ?? { userId: a.userId, author: a.author ?? null, isMine: Boolean(a.isMine), list: [] };
    if (!entry.author && a.author) entry.author = a.author;
    if (inRange(a, from, to)) entry.list.push(a);
    users.set(a.userId, entry);
  }
  const name = (e) => e.author?.name ?? '';
  return [...users.values()]
    .map(({ list, ...e }) => ({ ...e, value: metricValue(challenge.metric, list) }))
    .sort((a, b) => b.value - a.value || name(a).localeCompare(name(b), 'es'));
}

// De los retos a los que me apunté, los que ya he completado (en su propio periodo).
export function completedChallenges(joinedIds = [], myActivities = []) {
  return joinedIds.filter((id) => {
    const challenge = getChallenge(String(id).split(':')[0]);
    const range = rangeFromInstanceId(id);
    if (!challenge || !range) return false;
    const value = metricValue(challenge.metric, myActivities.filter((a) => inRange(a, range.from, range.to)));
    return value >= challenge.target;
  });
}
