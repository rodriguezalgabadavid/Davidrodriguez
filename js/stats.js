import { matchOutcome, matchWon, sessionLoad } from './activities.js';

// Estadísticas a partir de las actividades registradas.
// Cada actividad: { date: ISO string, type, seconds, rpe, ... } (ver activities.js)

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lunes a las 00:00 (hora local). Se construye por fecha de calendario: en los países donde el cambio de
// hora salta la medianoche (Chile, Paraguay, Cuba…), setHours(0) en ese domingo daría las 01:00.
export function startOfWeek(date) {
  const d = new Date(date);
  const offset = (d.getDay() + 6) % 7; // lunes = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

export function addDays(date, days) {
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

// Semanas (de lunes a domingo) que tienen al menos una actividad, como claves 'YYYY-MM-DD' del lunes.
function activeWeeks(activities) {
  return new Set(activities.map((a) => dayKey(startOfWeek(a.date))));
}

// Racha semanal: semanas consecutivas con al menos una actividad. Si esta semana aún no hay
// actividad, la racha sigue viva (cuenta desde la semana pasada) hasta que acabe el domingo.
export function weeklyStreak(activities, now = new Date()) {
  const weeks = activeWeeks(activities);
  const current = startOfWeek(now);
  const activeThisWeek = weeks.has(dayKey(current));
  let cursor = activeThisWeek ? current : addDays(current, -7);
  let count = 0;
  while (weeks.has(dayKey(cursor))) {
    count++;
    cursor = addDays(cursor, -7);
  }
  return { weeks: count, activeThisWeek };
}

// La racha semanal más larga de todo el historial.
export function bestWeeklyStreak(activities) {
  const weeks = activeWeeks(activities);
  let best = 0;
  for (const key of weeks) {
    const [y, m, d] = key.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    if (weeks.has(dayKey(addDays(start, -7)))) continue; // no es el inicio de una racha
    let run = 0;
    let cursor = start;
    while (weeks.has(dayKey(cursor))) {
      run++;
      cursor = addDays(cursor, 7);
    }
    best = Math.max(best, run);
  }
  return best;
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
  const results = activities.filter((a) => a.type === 'partido').map(matchWon);
  return {
    count: activities.length,
    minutes: Math.round(activities.reduce((s, a) => s + (a.seconds || 0), 0) / 60),
    load: activities.reduce((s, a) => s + sessionLoad(a), 0),
    wins: results.filter((won) => won === true).length,
    losses: results.filter((won) => won === false).length,
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

// Balance de partidos. Si un partido no tiene marcador se usa el resultado explícito (won);
// sets y juegos solo suman de los partidos con marcador.
export function matchStats(activities) {
  const matches = activities
    .filter((a) => a.type === 'partido')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((a) => ({ ...a, outcome: { ...matchOutcome(a.sets ?? []), won: matchWon(a) } }));

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
  { id: 'primer-partido', icon: '🎾', label: 'Primer partido', description: 'Publica tu primer partido.' },
  { id: 'primera-victoria', icon: '🏆', label: 'Primera victoria', description: 'Gana un partido.' },
  { id: 'primera-foto', icon: '📸', label: 'Primera foto', description: 'Publica una actividad con foto.' },
  { id: 'popular', icon: '🙌', label: 'Popular', description: 'Recibe 10 «¡Vamos!» en total.' },
  { id: 'racha-3', icon: '🔥', label: 'En racha', description: 'Gana 3 partidos seguidos.' },
  { id: 'remontada', icon: '🔄', label: 'Remontada', description: 'Gana un partido después de perder el primer set.' },
  { id: 'rosco', icon: '🍩', label: 'Rosco', description: 'Gana un set 6-0.' },
  { id: 'torneo', icon: '🥇', label: 'Competidor', description: 'Juega un partido de torneo.' },
  { id: 'diez-partidos', icon: '🔟', label: '10 partidos', description: 'Publica 10 partidos.' },
  { id: 'constancia', icon: '📅', label: 'Constancia', description: 'Haz alguna actividad 4 semanas seguidas.' },
  { id: 'fisico-5', icon: '💪', label: 'Base física', description: 'Completa 5 sesiones de preparación física.' },
  { id: 'plan-terminado', icon: '🎓', label: 'Plan terminado', description: 'Termina un plan de preparación física.' },
  { id: 'primer-reto', icon: '⭐', label: 'Primer reto', description: 'Completa tu primer reto.' },
  { id: 'tres-retos', icon: '🏅', label: 'Cazarretos', description: 'Completa 3 retos.' },
];

// completedChallenges: instanceId[] de retos completados (challenges.js).
// finishedPlans: planes terminados (PlanState.finished).
export function achievements(activities, { completedChallenges = [], finishedPlans = [] } = {}) {
  const stats = matchStats(activities);
  const matches = activities.filter((a) => a.type === 'partido');
  const fitness = activities.filter((a) => a.type === 'entreno').length;
  const kudos = activities.reduce((s, a) => s + (Number(a.kudosCount) || 0), 0);
  const challengesDone = Array.isArray(completedChallenges) ? completedChallenges.length : 0;
  const plansDone = Array.isArray(finishedPlans) ? finishedPlans.length : 0;

  const unlocked = {
    'primer-partido': stats.played >= 1,
    'primera-victoria': stats.won >= 1,
    'primera-foto': activities.some((a) => Boolean(a.photoUrl)),
    popular: kudos >= 10,
    'racha-3': stats.bestWinStreak >= 3,
    remontada: matches.some((m) => m.sets?.length > 1 && m.sets[0][0] < m.sets[0][1] && matchOutcome(m.sets).won === true),
    rosco: matches.some((m) => m.sets?.some(([a, b]) => a === 6 && b === 0)),
    torneo: matches.some((m) => m.matchKind === 'torneo'),
    'diez-partidos': stats.played >= 10,
    constancia: bestWeeklyStreak(activities) >= 4,
    'fisico-5': fitness >= 5,
    'plan-terminado': plansDone >= 1,
    'primer-reto': challengesDone >= 1,
    'tres-retos': challengesDone >= 3,
  };
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: Boolean(unlocked[a.id]) }));
}

// Logros desbloqueados en `after` que no lo estaban en `before` (para la pantalla de celebración).
export function newlyUnlocked(before = [], after = []) {
  const had = new Set((before ?? []).filter((a) => a.unlocked).map((a) => a.id));
  return (after ?? []).filter((a) => a.unlocked && !had.has(a.id));
}
