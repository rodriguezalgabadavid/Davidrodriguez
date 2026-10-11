// Actividades del muro: partidos, clases y sesiones de preparación física.
// Forma común: { id, type, date (ISO), seconds, rpe (1-10), title?, notes? }
// Partido además: { matchKind, position, partner, rivals: [a, b], club, sets: [[nosotros, ellos], ...] }

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

export function formatScore(sets = []) {
  return sets.map(([a, b]) => `${a}-${b}`).join(' ');
}

// Carga interna de la sesión (método sRPE de Foster): minutos × esfuerzo percibido.
export function sessionLoad(activity) {
  return Math.round(((activity.seconds || 0) / 60) * (activity.rpe || 0));
}

export function activityTitle(activity) {
  if (activity.title) return activity.title;
  if (activity.type === 'partido') {
    const { won } = matchOutcome(activity.sets);
    const kind = MATCH_KINDS[activity.matchKind] ?? 'Partido';
    const verdict = won === null ? 'Empate' : won ? 'Victoria' : 'Derrota';
    return `${verdict} · ${kind}`;
  }
  return ACTIVITY_TYPES[activity.type]?.label ?? 'Actividad';
}

const cleanName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// Normaliza lo que llega del formulario o de una importación.
export function normalizeActivity(input) {
  const type = ACTIVITY_TYPES[input.type] ? input.type : 'entreno';
  const activity = {
    id: input.id || newId(),
    type,
    date: new Date(input.date || Date.now()).toISOString(),
    seconds: Math.max(0, Math.round(Number(input.seconds) || 0)),
    rpe: Math.min(10, Math.max(1, Math.round(Number(input.rpe) || 5))),
  };
  if (cleanName(input.title)) activity.title = cleanName(input.title);
  if (String(input.notes ?? '').trim()) activity.notes = String(input.notes).trim();
  if (input.focus) activity.focus = input.focus;
  if (input.level) activity.level = input.level;
  if (input.demo) activity.demo = true;
  if (type === 'partido') {
    activity.matchKind = MATCH_KINDS[input.matchKind] ? input.matchKind : 'amistoso';
    if (POSITIONS[input.position]) activity.position = input.position;
    activity.partner = cleanName(input.partner);
    activity.rivals = (input.rivals ?? []).map(cleanName).filter(Boolean);
    activity.club = cleanName(input.club);
    activity.sets = (input.sets ?? []).map(([a, b]) => [Number(a), Number(b)]);
  }
  return activity;
}

// El historial de la primera versión de la app solo tenía sesiones de preparación física.
export function migrateLegacyHistory(history) {
  return history.map((h) => normalizeActivity({ ...h, type: 'entreno' }));
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

// Datos de ejemplo para enseñar la app vacía. Se marcan con demo: true para poder borrarlos.
export function demoActivities(now = new Date()) {
  const at = (daysAgo, hour) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const match = (daysAgo, hour, extra) =>
    normalizeActivity({ type: 'partido', date: at(daysAgo, hour), seconds: 90 * 60, demo: true, ...extra });
  return [
    match(1, 20, { matchKind: 'liga', position: 'reves', partner: 'Javi', rivals: ['Marta', 'Luis'], club: 'Club Pádel Norte', sets: [[6, 4], [3, 6], [7, 5]], rpe: 8, notes: 'Remontada en el tercero. Las bandejas al cristal funcionaron.' }),
    normalizeActivity({ type: 'entreno', date: at(2, 9), seconds: 32 * 60, rpe: 7, title: 'Potencia y salto', focus: 'potencia', level: 2, demo: true }),
    match(4, 19, { matchKind: 'amistoso', position: 'reves', partner: 'Javi', rivals: ['Carlos', 'Ana'], club: 'Club Pádel Norte', sets: [[6, 2], [6, 3]], rpe: 6 }),
    normalizeActivity({ type: 'clase', date: at(5, 18), seconds: 60 * 60, rpe: 5, title: 'Clase: salida de pared', demo: true }),
    match(7, 11, { matchKind: 'torneo', position: 'drive', partner: 'Pablo', rivals: ['Marta', 'Luis'], club: 'Indoor Sur', sets: [[4, 6], [5, 7]], rpe: 9, notes: 'Mucho globo, nos faltó paciencia.' }),
    normalizeActivity({ type: 'entreno', date: at(8, 9), seconds: 28 * 60, rpe: 6, title: 'Prevención de lesiones', focus: 'prevencion', level: 2, demo: true }),
    match(10, 20, { matchKind: 'liga', position: 'reves', partner: 'Javi', rivals: ['Sergio', 'Nacho'], club: 'Club Pádel Norte', sets: [[7, 6], [6, 4]], rpe: 7 }),
    match(13, 19, { matchKind: 'americana', position: 'reves', partner: 'Pablo', rivals: ['Carlos', 'Ana'], club: 'Indoor Sur', sets: [[3, 6]], rpe: 6 }),
    normalizeActivity({ type: 'entreno', date: at(15, 9), seconds: 30 * 60, rpe: 6, title: 'Agilidad en pista', focus: 'agilidad', level: 2, demo: true }),
    match(17, 20, { matchKind: 'liga', position: 'reves', partner: 'Javi', rivals: ['Eva', 'Pedro'], club: 'Club Pádel Norte', sets: [[6, 0], [6, 3]], rpe: 6 }),
    normalizeActivity({ type: 'clase', date: at(19, 18), seconds: 60 * 60, rpe: 5, title: 'Clase: bandeja y víbora', demo: true }),
    match(22, 19, { matchKind: 'amistoso', position: 'drive', partner: 'Pablo', rivals: ['Sergio', 'Nacho'], club: 'Indoor Sur', sets: [[6, 4], [4, 6], [10, 7]], rpe: 8 }),
    normalizeActivity({ type: 'entreno', date: at(24, 9), seconds: 30 * 60, rpe: 6, title: 'Core y golpeo', focus: 'core', level: 2, demo: true }),
    match(26, 20, { matchKind: 'liga', position: 'reves', partner: 'Javi', rivals: ['Marta', 'Luis'], club: 'Club Pádel Norte', sets: [[5, 7], [6, 7]], rpe: 7 }),
  ];
}
