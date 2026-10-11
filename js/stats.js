import { matchOutcome, sessionLoad } from './activities.js';

// Estadísticas a partir de las actividades registradas.
// Cada actividad: { date: ISO string, type, seconds, rpe, ... } (ver activities.js)

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - offset);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const inRange = (a, from, to) => {
  const t = new Date(a.date);
  return t >= from && t < to;
};

// Días consecutivos con actividad, contando hasta hoy (o hasta ayer si hoy aún no has entrenado).
export function computeStreak(activities, now = new Date()) {
  const days = new Set(activities.map((h) => dayKey(h.date)));
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function computeStats(activities, now = new Date()) {
  const weekStart = startOfWeek(now);
  return {
    total: activities.length,
    minutes: Math.round(activities.reduce((sum, h) => sum + (h.seconds || 0), 0) / 60),
    thisWeek: activities.filter((h) => new Date(h.date) >= weekStart).length,
    streak: computeStreak(activities, now),
  };
}

function summarize(activities) {
  const matches = activities.filter((a) => a.type === 'partido').map((a) => matchOutcome(a.sets));
  return {
    count: activities.length,
    minutes: Math.round(activities.reduce((s, a) => s + (a.seconds || 0), 0) / 60),
    load: activities.reduce((s, a) => s + sessionLoad(a), 0),
    wins: matches.filter((m) => m.won === true).length,
    losses: matches.filter((m) => m.won === false).length,
  };
}

// Resumen de esta semana y de la anterior, para comparar.
export function weekSummary(activities, now = new Date()) {
  const start = startOfWeek(now);
  const prevStart = addDays(start, -7);
  return {
    current: summarize(activities.filter((a) => inRange(a, start, addDays(start, 7)))),
    previous: summarize(activities.filter((a) => inRange(a, prevStart, start))),
  };
}

// Minutos por día de la semana actual (lunes..domingo), separados por tipo de actividad.
export function weekActivity(activities, now = new Date()) {
  const start = startOfWeek(now);
  return Array.from({ length: 7 }, (_, i) => {
    const key = dayKey(addDays(start, i));
    const ofDay = activities.filter((h) => dayKey(h.date) === key);
    const byType = {};
    for (const a of ofDay) byType[a.type] = (byType[a.type] || 0) + Math.round((a.seconds || 0) / 60);
    return {
      key,
      label: ['L', 'M', 'X', 'J', 'V', 'S', 'D'][i],
      minutes: Object.values(byType).reduce((s, m) => s + m, 0),
      byType,
      isToday: key === dayKey(now),
    };
  });
}

// Carga semanal de las últimas `weeks` semanas (la última es la actual).
export function weeklyLoad(activities, now = new Date(), weeks = 8) {
  const current = startOfWeek(now);
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(current, (i - weeks + 1) * 7);
    const ofWeek = activities.filter((a) => inRange(a, start, addDays(start, 7)));
    return {
      start,
      label: `${start.getDate()}/${start.getMonth() + 1}`,
      load: ofWeek.reduce((s, a) => s + sessionLoad(a), 0),
      minutes: Math.round(ofWeek.reduce((s, a) => s + (a.seconds || 0), 0) / 60),
    };
  });
}

// Ratio carga aguda (últimos 7 días) / crónica (media semanal de los últimos 28 días).
// Hace falta al menos 3 semanas de historial: con menos, la media mensual sale artificialmente baja.
export const MIN_HISTORY_DAYS = 21;

export function loadRatio(activities, now = new Date()) {
  const end = new Date(now);
  const oldest = Math.min(...activities.map((a) => new Date(a.date).getTime()));
  if (!activities.length || end - oldest < MIN_HISTORY_DAYS * DAY_MS) {
    return { acute: 0, chronic: 0, ratio: null, zone: null };
  }
  const acute = activities.filter((a) => inRange(a, new Date(end - 7 * DAY_MS), end)).reduce((s, a) => s + sessionLoad(a), 0);
  const chronic = activities.filter((a) => inRange(a, new Date(end - 28 * DAY_MS), end)).reduce((s, a) => s + sessionLoad(a), 0) / 4;
  if (!chronic) return { acute, chronic: 0, ratio: null, zone: null };
  const ratio = acute / chronic;
  const zone = ratio < 0.8 ? 'baja' : ratio <= 1.3 ? 'optima' : ratio <= 1.5 ? 'alta' : 'riesgo';
  return { acute, chronic: Math.round(chronic), ratio: Math.round(ratio * 100) / 100, zone };
}

function record(map, name, won) {
  if (!name) return;
  const key = name.toLowerCase();
  const entry = map.get(key) ?? { name, played: 0, won: 0, lost: 0 };
  entry.played++;
  if (won === true) entry.won++;
  if (won === false) entry.lost++;
  map.set(key, entry);
}

const byPlayed = (a, b) => b.played - a.played || b.won - a.won || a.name.localeCompare(b.name);

export function matchStats(activities) {
  const matches = activities
    .filter((a) => a.type === 'partido')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((a) => ({ ...a, outcome: matchOutcome(a.sets) }));

  const totals = { played: matches.length, won: 0, lost: 0, drawn: 0, setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0 };
  const partners = new Map();
  const rivals = new Map();
  const positions = { drive: { played: 0, won: 0 }, reves: { played: 0, won: 0 } };
  let run = 0;
  let bestWinStreak = 0;

  for (const m of matches) {
    const { won } = m.outcome;
    if (won === true) totals.won++;
    else if (won === false) totals.lost++;
    else totals.drawn++;
    totals.setsFor += m.outcome.setsFor;
    totals.setsAgainst += m.outcome.setsAgainst;
    totals.gamesFor += m.outcome.gamesFor;
    totals.gamesAgainst += m.outcome.gamesAgainst;

    run = won === true ? run + 1 : 0;
    bestWinStreak = Math.max(bestWinStreak, run);

    record(partners, m.partner, won);
    for (const r of m.rivals ?? []) record(rivals, r, won);
    if (positions[m.position]) {
      positions[m.position].played++;
      if (won === true) positions[m.position].won++;
    }
  }

  const decided = totals.won + totals.lost;
  return {
    ...totals,
    winRate: decided ? Math.round((totals.won / decided) * 100) : null,
    currentWinStreak: run,
    bestWinStreak,
    lastResults: matches.slice(-5).map((m) => m.outcome.won),
    partners: [...partners.values()].sort(byPlayed),
    rivals: [...rivals.values()].sort(byPlayed),
    positions,
  };
}

export const ACHIEVEMENTS = [
  { id: 'primer-partido', icon: '🎾', label: 'Primer partido', description: 'Registra tu primer partido.' },
  { id: 'primera-victoria', icon: '🏆', label: 'Primera victoria', description: 'Gana un partido.' },
  { id: 'remontada', icon: '🔄', label: 'Remontada', description: 'Gana un partido después de perder el primer set.' },
  { id: 'rosco', icon: '🍩', label: 'Rosco', description: 'Gana un set 6-0.' },
  { id: 'racha-3', icon: '🔥', label: 'En racha', description: 'Encadena 3 victorias seguidas.' },
  { id: 'racha-5', icon: '⚡', label: 'Imparable', description: 'Encadena 5 victorias seguidas.' },
  { id: 'torneo', icon: '🥇', label: 'Competidor', description: 'Juega un partido de torneo.' },
  { id: 'diez-partidos', icon: '🔟', label: '10 partidos', description: 'Registra 10 partidos.' },
  { id: 'fisico-5', icon: '💪', label: 'Base física', description: 'Completa 5 sesiones de preparación física.' },
  { id: 'fisico-20', icon: '🦵', label: 'Piernas de acero', description: 'Completa 20 sesiones de preparación física.' },
  { id: 'semana-4', icon: '📅', label: 'Semana completa', description: 'Haz 4 actividades en una misma semana.' },
  { id: 'horas-25', icon: '⏱️', label: '25 horas en pista', description: 'Suma 25 horas entre partidos y clases.' },
];

export function achievements(activities) {
  const stats = matchStats(activities);
  const matches = activities.filter((a) => a.type === 'partido');
  const fitness = activities.filter((a) => a.type === 'entreno').length;
  const courtHours = activities.filter((a) => a.type !== 'entreno').reduce((s, a) => s + (a.seconds || 0), 0) / 3600;
  const perWeek = new Map();
  for (const a of activities) {
    const k = dayKey(startOfWeek(a.date));
    perWeek.set(k, (perWeek.get(k) || 0) + 1);
  }

  const unlocked = {
    'primer-partido': stats.played >= 1,
    'primera-victoria': stats.won >= 1,
    remontada: matches.some((m) => m.sets?.length > 1 && m.sets[0][0] < m.sets[0][1] && matchOutcome(m.sets).won === true),
    rosco: matches.some((m) => m.sets?.some(([a, b]) => a === 6 && b === 0)),
    'racha-3': stats.bestWinStreak >= 3,
    'racha-5': stats.bestWinStreak >= 5,
    torneo: matches.some((m) => m.matchKind === 'torneo'),
    'diez-partidos': stats.played >= 10,
    'fisico-5': fitness >= 5,
    'fisico-20': fitness >= 20,
    'semana-4': [...perWeek.values()].some((n) => n >= 4),
    'horas-25': courtHours >= 25,
  };
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: Boolean(unlocked[a.id]) }));
}
