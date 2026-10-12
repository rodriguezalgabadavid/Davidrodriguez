// Comunidad de ejemplo del modo demo: jugadores ficticios (todos con demo: true), sus partidos, clases y
// entrenos, "¡Vamos!", comentarios y a quién siguen. También genera las publicaciones nuevas de la
// "comunidad viva", los comentarios automáticos y las fotos de ejemplo (ilustraciones SVG ligeras).

import { matchOutcome } from '../activities.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Generador pseudoaleatorio con semilla: la comunidad sale igual en cada dispositivo.
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const between = (min, max, rng) => min + Math.floor(rng() * (max - min + 1));

function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------- Fotos de ejemplo (SVG como data URI, ~1-2 KB cada una) ----------

const PALETTES = [
  { bg: '#1f2a37', court: '#2563eb', wall: '#93c5fd', net: '#0f172a', ball: '#facc15' },
  { bg: '#14261c', court: '#15803d', wall: '#86efac', net: '#052e16', ball: '#fde047' },
  { bg: '#3b1d12', court: '#c2410c', wall: '#fdba74', net: '#1c0a05', ball: '#bef264' },
  { bg: '#231942', court: '#6d28d9', wall: '#c4b5fd', net: '#120a24', ball: '#fef08a' },
  { bg: '#0f2f3a', court: '#0e7490', wall: '#a5f3fc', net: '#062028', ball: '#d9f99d' },
  { bg: '#2d2a26', court: '#4d7c0f', wall: '#d9f99d', net: '#1a1a1a', ball: '#fde68a' },
];
const SKIES = [['#fb923c', '#7c2d12'], ['#38bdf8', '#1e3a8a'], ['#f472b6', '#4c1d95'], ['#fcd34d', '#b45309']];
const PHOTO_KINDS = ['court', 'racket', 'evening'];

const r0 = (n) => Math.round(n);

// Pista vista desde arriba (20 × 10 m → 320 × 160), con jugadores y bola.
function courtFromAbove(p, rng) {
  const players = [0, 1, 2, 3]
    .map((i) => `<circle cx='${r0((i < 2 ? 55 : 215) + rng() * 130)}' cy='${r0(85 + rng() * 130)}' r='9' fill='#000' opacity='.35'/>`)
    .join('');
  return `<rect width='400' height='300' fill='${p.bg}'/>`
    + `<g transform='rotate(${r0(rng() * 24 - 12)} 200 150)'>`
    + `<rect x='24' y='58' width='352' height='184' fill='${p.wall}' opacity='.2'/>`
    + `<rect x='40' y='70' width='320' height='160' fill='${p.court}' stroke='#fff' stroke-width='3'/>`
    + `<path d='M89 70v160M311 70v160M89 150h222' stroke='#fff' stroke-width='3'/>`
    + `<path d='M40 70v160M360 70v160' stroke='${p.wall}' stroke-width='7' opacity='.8'/>`
    + `<path d='M200 60v180' stroke='${p.net}' stroke-width='5'/>`
    + players
    + `<circle cx='${r0(60 + rng() * 280)}' cy='${r0(80 + rng() * 140)}' r='5' fill='${p.ball}'/>`
    + '</g>';
}

// Pala y bola sobre la pista.
function racketAndBall(p, rng) {
  const bx = r0(250 + rng() * 80);
  const by = r0(170 + rng() * 70);
  return `<defs><pattern id='h' width='13' height='13' patternUnits='userSpaceOnUse'><circle cx='6.5' cy='6.5' r='2.6' fill='${p.bg}' opacity='.6'/></pattern></defs>`
    + `<rect width='400' height='300' fill='${p.bg}'/>`
    + `<circle cx='${r0(120 + rng() * 160)}' cy='${r0(90 + rng() * 120)}' r='150' fill='${p.court}' opacity='.45'/>`
    + `<g transform='rotate(${r0(rng() * 50 - 25)} 160 150)'>`
    + `<rect x='146' y='200' width='28' height='80' rx='10' fill='${p.net}'/>`
    + `<path d='M128 182h64l-20 26h-24z' fill='${p.wall}'/>`
    + `<ellipse cx='160' cy='118' rx='74' ry='84' fill='${p.wall}'/>`
    + `<ellipse cx='160' cy='118' rx='62' ry='72' fill='${p.court}'/>`
    + `<ellipse cx='160' cy='118' rx='62' ry='72' fill='url(#h)'/>`
    + '</g>'
    + `<ellipse cx='${bx + 8}' cy='${by + 27}' rx='26' ry='6' fill='#000' opacity='.3'/>`
    + `<circle cx='${bx}' cy='${by}' r='26' fill='${p.ball}'/>`
    + `<path d='M${bx - 24} ${by - 10}q24 16 48 0M${bx - 24} ${by + 10}q24-16 48 0' stroke='#fff' stroke-width='3' fill='none'/>`;
}

// Pista en perspectiva al atardecer, con focos y red.
function eveningCourt(p, rng) {
  const sky = pick(SKIES, rng);
  const left = (y) => r0(120 - (y - 120) * 0.611);
  const right = (y) => 400 - left(y);
  const netL = left(176) - 8;
  const netR = right(176) + 8;
  return `<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${sky[0]}'/><stop offset='1' stop-color='${sky[1]}'/></linearGradient>`
    + `<pattern id='m' width='6' height='6' patternUnits='userSpaceOnUse'><path d='M0 0l6 6M6 0l-6 6' stroke='${p.net}'/></pattern></defs>`
    + `<rect width='400' height='300' fill='url(#s)'/>`
    + `<rect y='96' width='400' height='34' fill='${p.bg}' opacity='.6'/>`
    + `<path d='M50 30v100M350 30v100' stroke='${p.bg}' stroke-width='4'/>`
    + `<circle cx='50' cy='30' r='7' fill='#fff8d6'/><circle cx='350' cy='30' r='7' fill='#fff8d6'/>`
    + `<polygon points='120,84 280,84 280,120 120,120' fill='${p.wall}' opacity='.35'/>`
    + `<polygon points='120,120 280,120 390,300 10,300' fill='${p.court}'/>`
    + `<path d='M120 120L10 300M280 120l110 180M120 120h160M${left(148)} 148H${right(148)}M${left(232)} 232H${right(232)}M200 148v84' stroke='#fff' stroke-width='2.5' fill='none'/>`
    + `<rect x='${netL}' y='160' width='${netR - netL}' height='18' fill='url(#m)'/>`
    + `<path d='M${netL} 160H${netR}' stroke='#fff' stroke-width='3'/>`
    + `<circle cx='${r0(150 + rng() * 100)}' cy='${r0(200 + rng() * 60)}' r='5' fill='${p.ball}'/>`;
}

// Ilustración de pádel (sin texto) como data URI. Misma semilla → misma imagen.
export function padelPhoto(seed = Math.floor(Math.random() * 1e9), kind = null) {
  const rng = seeded(seed);
  const palette = pick(PALETTES, rng);
  const scene = kind ?? pick(PHOTO_KINDS, rng);
  const body = scene === 'racket' ? racketAndBall(palette, rng) : scene === 'evening' ? eveningCourt(palette, rng) : courtFromAbove(palette, rng);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 400 300'>${body}</svg>`;
  return `data:image/svg+xml,${svg.replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}`;
}

// ---------- Jugadores ----------

const PLAYERS = [
  { key: 'lucia', name: 'Lucía M.', level: 3, position: 'reves', club: 'Club Pádel Norte', isPremium: true, joined: 240,
    bio: 'Revés de toda la vida. Liga los martes y americanas cuando me dejan.' },
  { key: 'javi', name: 'Javi R.', level: 2, position: 'drive', club: 'Club Pádel Norte', isPremium: false, joined: 180,
    bio: 'Drive con más ganas que técnica. Siempre me apunto a un cuarto.' },
  { key: 'marta', name: 'Marta G.', level: 2, position: 'reves', club: 'Indoor Sur', isPremium: true, joined: 150,
    bio: 'Pádel tres veces por semana. Haciendo el plan de físico personalizado.' },
  { key: 'carlos', name: 'Carlos P.', level: 1, position: 'drive', club: 'Pádel Las Lomas', isPremium: false, joined: 90,
    bio: 'Empecé hace tres meses y ya no puedo parar.' },
  { key: 'ana', name: 'Ana S.', level: 3, position: 'drive', club: 'Indoor Sur', isPremium: false, joined: 300,
    bio: 'Drive zurda. Un buen globo lo arregla todo.' },
  { key: 'pablo', name: 'Pablo D.', level: 2, position: 'reves', club: 'Pádel Las Lomas', isPremium: true, joined: 200,
    bio: 'Revés y globo. Si me buscas, estoy en la pista 3.' },
  { key: 'nuria', name: 'Nuria F.', level: 1, position: 'reves', club: 'Club Pádel Norte', isPremium: false, joined: 45,
    bio: 'Nueva en esto del pádel. ¡Busco gente para jugar!' },
];

const userId = (key) => `demo-${key}`;

// Quién sigue a quién dentro de la comunidad de ejemplo.
const FOLLOWS = {
  lucia: ['nuria', 'marta', 'ana', 'javi'],
  javi: ['lucia', 'pablo', 'carlos', 'nuria'],
  marta: ['ana', 'lucia', 'javi'],
  carlos: ['pablo', 'nuria', 'javi'],
  ana: ['marta', 'lucia', 'pablo'],
  pablo: ['carlos', 'javi', 'ana', 'marta'],
  nuria: ['lucia', 'carlos', 'javi', 'marta'],
};

// ---------- Publicaciones de ejemplo ----------
// Cuándo: { d, h } = hace d días a las h:00; { ago } = hace ese número de horas.

const POSTS = [
  // Lucía
  { by: 'lucia', d: 1, h: 20, type: 'partido', matchKind: 'liga', min: 95, rpe: 8, partner: 'Nuria', rivals: ['Marta', 'Ana'],
    sets: [[6, 4], [3, 6], [10, 8]], photo: 'court',
    text: 'Súper tie-break a cara de perro. 10-8 y tres puntos para casa 😅',
    comments: [['marta', 'La revancha en la vuelta, que lo sepáis 😤'], ['nuria', '¡Qué nervios! Gracias por tirar del carro 🙌']] },
  { by: 'lucia', d: 3, h: 8, type: 'entreno', focus: 'agilidad', title: 'Piernas y desplazamientos', min: 45, rpe: 7,
    text: 'Split-step y cambios de dirección antes del curro. Ya noto las piernas más rápidas.' },
  { by: 'lucia', d: 9, h: 11, type: 'partido', matchKind: 'torneo', min: 100, rpe: 9, partner: 'Nuria', rivals: ['Ana', 'Pablo'],
    sets: [[4, 6], [6, 7]], text: 'Cuartos del torneo del club. Nos faltó un pelín en el tie-break del segundo.' },
  { by: 'lucia', d: 13, h: 19, type: 'clase', title: 'Clase: víbora y salida de pared', min: 60, rpe: 5,
    text: 'Por fin la víbora sale con efecto 🙌' },
  { by: 'lucia', d: 20, h: 20, type: 'partido', matchKind: 'amistoso', min: 80, rpe: 6, partner: 'Javi', rivals: ['Carlos', 'Pablo'],
    sets: [[6, 2], [6, 3]], photo: 'racket', text: 'Pachanga de jueves. Buen ritmo y mejores risas.' },

  // Javi
  { by: 'javi', ago: 3, type: 'partido', matchKind: 'amistoso', min: 90, rpe: 8, partner: 'Pablo', rivals: ['Carlos', 'Nuria'],
    sets: [[6, 3], [4, 6], [6, 4]], text: 'Tres sets y hora y media de pista. Mañana no me levanto 😂',
    comments: [['nuria', 'Casi os pillamos en el tercero… ¡la próxima caéis! 😂'], ['pablo', 'Agujetas hasta en las pestañas.']] },
  { by: 'javi', d: 2, h: 7, type: 'entreno', focus: 'core', title: 'Core antes del curro', min: 30, rpe: 6,
    text: 'Media hora de core antes de trabajar. Poco a poco.' },
  { by: 'javi', d: 6, h: 21, type: 'partido', matchKind: 'liga', min: 75, rpe: 7, partner: 'Lucía', rivals: ['Marta', 'Ana'],
    sets: [[2, 6], [3, 6]], text: 'Nos pasaron por encima. Toca entrenar la defensa del globo.' },
  { by: 'javi', d: 15, h: 18, type: 'partido', matchKind: 'americana', min: 120, rpe: 7, won: true, sets: [], photo: 'evening',
    text: 'Americana del sábado: 3 de 4 partidos ganados. Premio: una lata de bolas 🎾',
    comments: [['marta', '¿Una lata de bolas? ¡Menudo premio! 😂']] },

  // Marta
  { by: 'marta', ago: 6, type: 'entreno', focus: 'potencia', title: 'Potencia y salto', min: 40, rpe: 7,
    text: 'Sesión de potencia del plan. Las zancadas con salto pican 🔥',
    comments: [['lucia', '¿Qué tal el plan personalizado? Me lo estoy pensando.'], ['marta', 'Lo recomiendo, se nota en las piernas 💪']] },
  { by: 'marta', d: 1, h: 20, type: 'partido', matchKind: 'liga', min: 95, rpe: 9, partner: 'Ana', rivals: ['Lucía', 'Nuria'],
    sets: [[4, 6], [6, 3], [8, 10]], text: 'Perdimos en el súper tie-break. Qué partidazo, eso sí.' },
  { by: 'marta', d: 5, h: 19, type: 'clase', title: 'Clase: bandeja', min: 60, rpe: 5, photo: 'racket',
    text: 'Bandeja, bandeja y más bandeja.' },
  { by: 'marta', d: 6, h: 21, type: 'partido', matchKind: 'liga', min: 75, rpe: 7, partner: 'Ana', rivals: ['Javi', 'Lucía'],
    sets: [[6, 2], [6, 3]], text: 'Partido serio de liga. Ana estuvo imparable en la red 💪' },
  { by: 'marta', d: 9, h: 8, type: 'entreno', focus: 'prevencion', title: 'Prevención de hombro', min: 25, rpe: 4, text: '' },
  { by: 'marta', d: 16, h: 10, type: 'partido', matchKind: 'torneo', min: 85, rpe: 7, partner: 'Ana', rivals: ['Pablo', 'Carlos'],
    sets: [[6, 4], [6, 4]], text: 'Primera ronda superada. ¡Seguimos!' },

  // Carlos
  { by: 'carlos', d: 1, h: 18, type: 'clase', title: 'Clase de iniciación', min: 60, rpe: 5, photo: 'court',
    text: 'Hoy tocaba volea. Ya no le doy con el marco… casi nunca 😅' },
  { by: 'carlos', d: 4, h: 20, type: 'partido', matchKind: 'amistoso', min: 105, rpe: 8, partner: 'Pablo', rivals: ['Edu', 'Rocío'],
    sets: [[6, 7], [6, 4], [7, 6]], photo: 'evening', text: 'Primer partido ganado a tres sets. ¡Lo celebro como un Mundial! 🏆',
    comments: [['pablo', '¡Vaya partidazo, compañero! 🏆'], ['javi', 'Se te ve suelto ya, Carlos. ¡Enhorabuena!'], ['nuria', '¡Grande!']] },
  { by: 'carlos', d: 8, h: 9, type: 'entreno', focus: 'core', title: 'Movilidad y core', min: 30, rpe: 5, text: '' },
  { by: 'carlos', d: 20, h: 20, type: 'partido', matchKind: 'amistoso', min: 80, rpe: 7, partner: 'Pablo', rivals: ['Lucía', 'Javi'],
    sets: [[2, 6], [3, 6]], text: 'Contra los del nivel de arriba. Se aprende un montón perdiendo.' },

  // Ana
  { by: 'ana', ago: 9, type: 'entreno', focus: 'potencia', title: 'Fuerza de piernas', min: 50, rpe: 7,
    text: 'Pierna y glúteo. Sin piernas no hay bandeja.' },
  { by: 'ana', d: 9, h: 11, type: 'partido', matchKind: 'torneo', min: 100, rpe: 9, partner: 'Pablo', rivals: ['Lucía', 'Nuria'],
    sets: [[6, 4], [7, 6]], photo: 'court', text: '¡A semis! Tie-break del segundo sufriendo como nunca.',
    comments: [['lucia', 'Enhorabuena, merecido. Ese tie-break fue vuestro.'], ['pablo', '¡A por la final!']] },
  { by: 'ana', d: 12, h: 19, type: 'clase', title: 'Clase: remate por 3', min: 60, rpe: 6, text: 'Remate por 3: de diez, dos fuera de pista. Algo es algo.' },
  { by: 'ana', d: 22, h: 20, type: 'partido', matchKind: 'amistoso', min: 80, rpe: 7, partner: 'Marta', rivals: ['Edu', 'Rocío'],
    sets: [[7, 5], [6, 4]], text: '' },

  // Pablo
  { by: 'pablo', d: 2, h: 20, type: 'partido', matchKind: 'liga', min: 65, rpe: 6, partner: 'Carlos', rivals: ['Sergio', 'Lola'],
    sets: [[6, 1], [6, 2]], photo: 'court', text: 'Partido rápido de liga. Carlos jugó como un veterano 👏' },
  { by: 'pablo', d: 3, h: 19, type: 'entreno', focus: 'resistencia', title: 'Intervalos en pista', min: 35, rpe: 8,
    text: 'Intervalos en pista. Pulsaciones por las nubes 🫀' },
  { by: 'pablo', d: 7, h: 18, type: 'clase', title: 'Clase: defensa de pared', min: 60, rpe: 5, photo: 'racket',
    text: 'Salida de doble pared: ya me sale una de cada tres 😂',
    comments: [['carlos', 'Una de tres ya es más que yo 😂']] },
  { by: 'pablo', d: 14, h: 18, type: 'partido', matchKind: 'americana', min: 120, rpe: 6, won: false, sets: [],
    text: 'Americana del sábado. Gané uno de cuatro, pero risas aseguradas.' },
  { by: 'pablo', d: 17, h: 8, type: 'entreno', focus: 'agilidad', title: 'Agilidad', min: 30, rpe: 6, text: '' },

  // Nuria
  { by: 'nuria', ago: 3, type: 'partido', matchKind: 'amistoso', min: 90, rpe: 8, partner: 'Carlos', rivals: ['Javi', 'Pablo'],
    sets: [[3, 6], [6, 4], [4, 6]], photo: 'evening', text: 'Casi, casi. Tres sets contra Javi y Pablo, ¡la próxima caen!' },
  { by: 'nuria', d: 2, h: 9, type: 'entreno', focus: 'resistencia', title: 'Plan general · semana 1', min: 25, rpe: 5,
    text: 'Empezando el plan general de físico. ¡Primera semana hecha!' },
  { by: 'nuria', d: 6, h: 18, type: 'clase', title: 'Clase: saque y resto', min: 60, rpe: 4, text: '' },
  { by: 'nuria', d: 10, h: 20, type: 'partido', matchKind: 'amistoso', min: 85, rpe: 6, partner: 'Lucía', rivals: ['Marta', 'Carlos'],
    sets: [[6, 4], [6, 4]], photo: 'racket', text: 'Con Lucía de compañera cualquiera gana 😂 ¡Gracias, crack!',
    comments: [['lucia', '¡Has jugado genial! Repetimos cuando quieras.']] },
];

const iso = (ms) => new Date(ms).toISOString();

function postDate(post, now) {
  if (post.ago != null) return now - post.ago * HOUR;
  const d = new Date(now - post.d * DAY);
  d.setHours(post.h, 0, 0, 0);
  return Math.min(d.getTime(), now - HOUR);
}

function activityRecord(fields, { id, userId: uid, date, createdAt, photoUrl = null }) {
  const isMatch = fields.type === 'partido';
  const sets = isMatch ? (fields.sets ?? []).map(([a, b]) => [a, b]) : [];
  const won = isMatch ? (sets.length ? matchOutcome(sets).won : fields.won ?? null) : null;
  return {
    id,
    userId: uid,
    type: fields.type,
    date: iso(date),
    seconds: Math.round((fields.min ?? 60) * 60),
    rpe: fields.rpe ?? null,
    won,
    sets,
    matchKind: isMatch ? fields.matchKind ?? 'amistoso' : null,
    partner: isMatch ? fields.partner ?? '' : '',
    rivals: isMatch ? [...(fields.rivals ?? [])] : [],
    club: fields.club ?? '',
    title: fields.title ?? '',
    text: fields.text ?? '',
    photoUrl,
    plan: null,
    focus: fields.type === 'entreno' ? fields.focus ?? null : null,
    createdAt: iso(createdAt),
  };
}

// Comunidad inicial. Devuelve registros en el formato interno de LocalBackend.
export function seedCommunity(now = new Date()) {
  const nowMs = new Date(now).getTime();
  const rng = seeded(20261012);
  const users = PLAYERS.map((p) => ({
    id: userId(p.key),
    name: p.name,
    avatarUrl: null,
    level: p.level,
    position: p.position,
    club: p.club,
    bio: p.bio,
    isPremium: p.isPremium,
    createdAt: iso(nowMs - p.joined * DAY),
    demo: true,
  }));
  const clubOf = Object.fromEntries(PLAYERS.map((p) => [p.key, p.club]));

  const follows = [];
  for (const [follower, list] of Object.entries(FOLLOWS)) {
    list.forEach((following, i) => {
      follows.push({ followerId: userId(follower), followingId: userId(following), createdAt: iso(nowMs - (40 - i * 3) * DAY) });
    });
  }
  const followersOf = (key) => follows.filter((f) => f.followingId === userId(key)).map((f) => f.followerId);

  const activities = [];
  const kudos = [];
  const comments = [];
  POSTS.forEach((post, index) => {
    const date = postDate(post, nowMs);
    const createdAt = Math.min(date + (post.min ?? 60) * MINUTE + between(5, 40, rng) * MINUTE, nowMs - 20 * MINUTE);
    const activity = activityRecord(
      { club: clubOf[post.by], ...post },
      {
        id: randomId(),
        userId: userId(post.by),
        date,
        createdAt,
        photoUrl: post.photo ? padelPhoto(1000 + index * 7919, post.photo) : null,
      },
    );
    activities.push(activity);

    // Las reacciones llegan en las horas siguientes a publicar (nunca en el futuro).
    const span = Math.max(MINUTE, Math.min(nowMs - createdAt, 10 * HOUR));
    const commenters = (post.comments ?? []).map(([key]) => userId(key)).filter((id) => id !== activity.userId);
    const fans = shuffled(followersOf(post.by), rng).slice(0, between(1, 4, rng));
    for (const fan of new Set([...fans, ...commenters])) {
      kudos.push({ activityId: activity.id, userId: fan, createdAt: iso(createdAt + Math.round(span * rng() * 0.6)) });
    }
    (post.comments ?? []).forEach(([key, text], i, list) => {
      comments.push({
        id: randomId(),
        activityId: activity.id,
        userId: userId(key),
        text,
        createdAt: iso(createdAt + Math.round((span * (i + 1)) / (list.length + 1))),
      });
    });
  });

  return { users, activities, kudos, comments, follows };
}

// ---------- Comunidad viva: publicaciones nuevas de los jugadores de ejemplo ----------

const OTHER_NAMES = ['Edu', 'Rocío', 'Sergio', 'Lola', 'Íñigo', 'Bea', 'Dani', 'Irene', 'Álex', 'Clara'];
const WIN_SETS = [[[6, 3], [6, 4]], [[7, 5], [6, 3]], [[6, 2], [4, 6], [6, 4]], [[7, 6], [6, 2]]];
const LOSS_SETS = [[[4, 6], [3, 6]], [[6, 7], [5, 7]], [[6, 4], [3, 6], [4, 6]]];
const SUPER_SETS = [[[6, 4], [4, 6], [10, 7]], [[3, 6], [7, 5], [10, 8]]];

const LIVE_POSTS = [
  { type: 'partido', matchKind: 'amistoso', sets: WIN_SETS, min: 90, rpe: 7,
    texts: ['Partidito antes de cenar. ¡Victoria!', 'Ganamos sin sufrir demasiado. Buen ritmo hoy 🎾', 'Qué bien entra la bandeja cuando hay confianza.'] },
  { type: 'partido', matchKind: 'liga', sets: LOSS_SETS, min: 85, rpe: 8,
    texts: ['Hoy no hubo manera. Toca revancha.', 'Perdimos, pero jugando bien. Seguimos sumando.', 'Nos ganaron desde el fondo de pista. Apuntado para el próximo entreno.'] },
  { type: 'partido', matchKind: 'liga', sets: SUPER_SETS, min: 100, rpe: 9,
    texts: ['¡Al súper tie-break y para casa! 🔥', 'Súper tie-break de infarto. Qué manera de sufrir.'] },
  { type: 'partido', matchKind: 'americana', sets: null, min: 120, rpe: 6,
    texts: ['Americana del club: risas, calor y muchas bolas al cristal.'] },
  { type: 'entreno', focus: 'agilidad', title: 'Agilidad en pista', min: 30, rpe: 7,
    texts: ['Escalera, conos y split-step. Las piernas lo notan.', 'Sesión corta pero intensa. ¡A llegar a todas!'] },
  { type: 'entreno', focus: 'core', title: 'Core y estabilidad', min: 25, rpe: 6,
    texts: ['Core para que no duela la espalda en el tercer set.'] },
  { type: 'entreno', focus: 'potencia', title: 'Potencia y salto', min: 35, rpe: 8,
    texts: ['Saltos y balón medicinal. ¡A por el remate por 3!'] },
  { type: 'entreno', focus: 'prevencion', title: 'Prevención de hombro', min: 20, rpe: 4,
    texts: ['Gomas y rotaciones. El hombro lo agradece.'] },
  { type: 'clase', title: 'Clase: bandeja', min: 60, rpe: 5, texts: ['Hoy tocó bandeja. Cada vez sale más plana 🙌'] },
  { type: 'clase', title: 'Clase: salida de pared', min: 60, rpe: 5, texts: ['Salida de pared de fondo. Poco a poco va saliendo.'] },
];

// Publicación nueva de un jugador de ejemplo, terminada hace entre 20 min y 5 h.
export function demoPost(author, { now = new Date(), rng = Math.random } = {}) {
  const nowMs = new Date(now).getTime();
  const template = pick(LIVE_POSTS, rng);
  const fields = { ...template, club: author.club, text: pick(template.texts, rng) };
  if (template.type === 'partido') {
    const firstName = author.name.split(' ')[0];
    const names = shuffled([...OTHER_NAMES, ...PLAYERS.map((p) => p.name.split(' ')[0])].filter((n) => n !== firstName), rng);
    fields.partner = names[0];
    fields.rivals = [names[1], names[2]];
    fields.sets = template.sets ? pick(template.sets, rng) : [];
    fields.won = null;
  }
  const createdAt = nowMs - between(20, 300, rng) * MINUTE;
  const date = createdAt - fields.min * MINUTE - between(5, 30, rng) * MINUTE;
  const photoUrl = rng() < 0.35 ? padelPhoto(Math.floor(rng() * 1e9)) : null;
  return activityRecord(fields, { id: randomId(), userId: author.id, date, createdAt, photoUrl });
}

// ---------- Comentarios automáticos (modo demo) ----------

const REACTIONS = {
  victory: [
    '¡Vaya partidazo! Esa victoria se celebra 🍻',
    '¡Qué máquinas! A este paso subís de categoría 💪',
    'Esa bandeja está fina últimamente. ¡Bien jugado!',
    '¡Enhorabuena! La próxima me apunto de cuarto.',
    'Por 3 y fuera, ¿no? 😂 ¡Bien ganado!',
  ],
  threeSets: [
    '¡Al tercero y ganando! Eso es cabeza fría 🧊',
    'Tres sets de los que cansan. ¡Victoria con mérito! 🔥',
  ],
  defeat: [
    'Se pierde aprendiendo. ¡La próxima es vuestra! 💪',
    'Hay días que la bola no entra. ¡A por la revancha!',
    'Mucho globo de los rivales, ¿eh? Paciencia y a la siguiente.',
    'Lo importante es jugar. ¡Ánimo, crack!',
  ],
  match: [
    '¡Así se hace! ¿Cuándo echamos uno?',
    'Buen partido. ¡A seguir sumando horas de pista!',
    'Qué ganas de pista me das. ¿Jugamos esta semana?',
  ],
  entreno: [
    '¡Esas piernas van a llegar a todas las bolas! 🦵',
    'El físico se nota en el tercer set. ¡Bien hecho!',
    'Constancia = nivel. ¡Vamos!',
    'Qué disciplina. La próxima sesión la hago contigo 💪',
  ],
  clase: [
    '¿Qué tocaba hoy, bandeja o víbora? 😄',
    'Las clases se notan, ¡cada vez pegas mejor!',
    'Buena inversión. ¡Ahora a probarlo en partido!',
  ],
  photo: [
    '¡Fotón! 📸',
    'Qué buena pinta tiene esa pista.',
    'Esa foto merece portada 😎',
    '¡Qué ambientazo!',
  ],
};

// Comentario de un amigo según el tipo de actividad, el resultado y si lleva foto.
export function reactionComment(activity, rng = Math.random) {
  if (activity.photoUrl && rng() < 0.4) return pick(REACTIONS.photo, rng);
  if (activity.type === 'entreno') return pick(REACTIONS.entreno, rng);
  if (activity.type === 'clase') return pick(REACTIONS.clase, rng);
  const sets = activity.sets ?? [];
  const won = sets.length ? matchOutcome(sets).won : activity.won ?? null;
  if (won === true) return pick(sets.length >= 3 && rng() < 0.5 ? REACTIONS.threeSets : REACTIONS.victory, rng);
  if (won === false) return pick(REACTIONS.defeat, rng);
  return pick(REACTIONS.match, rng);
}
