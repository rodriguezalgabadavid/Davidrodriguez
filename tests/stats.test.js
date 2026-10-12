import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS, achievements, bestWeeklyStreak, computeStats, computeStreak, loadRatio, matchStats, newlyUnlocked,
  weekActivity, weekSummary, weeklyLoad, weeklyStreak,
} from '../js/stats.js';

const at = (y, m, d, h = 18, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 14, 20); // miércoles 14/10/2026
const match = (date, sets, extra = {}) => ({ type: 'partido', date, sets, seconds: 5400, rpe: 7, ...extra });
const quick = (date, won, extra = {}) => ({ type: 'partido', date, sets: [], won, seconds: 5400, rpe: 7, ...extra });
const unlockedIds = (list) => list.filter((a) => a.unlocked).map((a) => a.id).sort();

test('racha de días consecutivos hasta hoy', () => {
  const history = [at(2026, 10, 12), at(2026, 10, 13), at(2026, 10, 14), at(2026, 10, 10)].map((date) => ({ date }));
  assert.equal(computeStreak(history, now), 3);
});

test('la racha diaria se mantiene si hoy aún no has entrenado', () => {
  const history = [at(2026, 10, 12), at(2026, 10, 13)].map((date) => ({ date }));
  assert.equal(computeStreak(history, now), 2);
});

test('la racha diaria se rompe tras un día sin entrenar', () => {
  const history = [at(2026, 10, 11), at(2026, 10, 12)].map((date) => ({ date }));
  assert.equal(computeStreak(history, now), 0);
});

test('racha semanal viva con actividad esta semana', () => {
  const history = [at(2026, 10, 12), at(2026, 10, 6), at(2026, 10, 7), at(2026, 9, 29)].map((date) => ({ date }));
  assert.deepEqual(weeklyStreak(history, now), { weeks: 3, activeThisWeek: true });
});

test('racha semanal: sigue viva si esta semana aún no hay actividad', () => {
  const history = [at(2026, 10, 6), at(2026, 9, 29), at(2026, 9, 22)].map((date) => ({ date }));
  assert.deepEqual(weeklyStreak(history, now), { weeks: 3, activeThisWeek: false });
});

test('racha semanal rota por una semana vacía', () => {
  // Ni esta semana ni la anterior: racha perdida.
  assert.deepEqual(weeklyStreak([at(2026, 9, 29), at(2026, 9, 22)].map((date) => ({ date })), now), { weeks: 0, activeThisWeek: false });
  // Esta semana sí, la anterior no: la racha empieza de nuevo.
  assert.deepEqual(weeklyStreak([at(2026, 10, 13), at(2026, 9, 29)].map((date) => ({ date })), now), { weeks: 1, activeThisWeek: true });
  assert.deepEqual(weeklyStreak([], now), { weeks: 0, activeThisWeek: false });
});

test('racha semanal: las semanas van de lunes a domingo', () => {
  const sundayNight = { date: at(2026, 10, 11, 23, 30) }; // domingo de la semana pasada
  const mondayEarly = { date: at(2026, 10, 12, 0, 30) }; // lunes de esta semana
  assert.deepEqual(weeklyStreak([sundayNight], now), { weeks: 1, activeThisWeek: false });
  assert.deepEqual(weeklyStreak([mondayEarly], now), { weeks: 1, activeThisWeek: true });
  // El domingo por la noche la semana sigue siendo la actual.
  assert.deepEqual(weeklyStreak([mondayEarly], new Date(2026, 9, 18, 23, 59)), { weeks: 1, activeThisWeek: true });
  // Al lunes siguiente la racha sigue viva aunque aún no hayas jugado.
  assert.deepEqual(weeklyStreak([mondayEarly], new Date(2026, 9, 19, 9)), { weeks: 1, activeThisWeek: false });
});

test('mejor racha semanal de todo el historial', () => {
  const dates = [at(2026, 8, 3), at(2026, 8, 10), at(2026, 8, 17), at(2026, 8, 24), at(2026, 9, 14), at(2026, 10, 12)];
  assert.equal(bestWeeklyStreak(dates.map((date) => ({ date }))), 4);
  assert.equal(bestWeeklyStreak([]), 0);
});

test('sesiones de la semana empiezan el lunes', () => {
  const history = [
    { date: at(2026, 10, 11), seconds: 600 }, // domingo anterior
    { date: at(2026, 10, 12), seconds: 1200 }, // lunes
    { date: at(2026, 10, 14), seconds: 1800 },
  ];
  const stats = computeStats(history, now);
  assert.equal(stats.total, 3);
  assert.equal(stats.thisWeek, 2);
  assert.equal(stats.minutes, 60);
});

test('actividad semanal por día y tipo', () => {
  const week = weekActivity([
    { type: 'entreno', date: at(2026, 10, 14), seconds: 1800 },
    { type: 'partido', date: at(2026, 10, 14, 21), seconds: 5400 },
  ], now);
  assert.equal(week.length, 7);
  assert.equal(week[0].label, 'L');
  assert.equal(week[2].minutes, 120);
  assert.deepEqual(week[2].byType, { entreno: 30, partido: 90 });
  assert.ok(week[2].isToday);
});

test('resumen semanal compara con la semana anterior', () => {
  const { current, previous } = weekSummary([
    match(at(2026, 10, 13), [[6, 4], [6, 4]]),
    match(at(2026, 10, 14, 10), [[2, 6], [2, 6]]),
    match(at(2026, 10, 8), [[6, 4], [6, 4]]),
  ], now);
  assert.deepEqual(current, { count: 2, minutes: 180, load: 1260, wins: 1, losses: 1 });
  assert.equal(previous.count, 1);
});

test('resumen semanal con resultados sin marcador', () => {
  const { current } = weekSummary([
    quick(at(2026, 10, 12), true),
    quick(at(2026, 10, 13), true, { rpe: null }),
    quick(at(2026, 10, 14, 10), false),
    quick(at(2026, 10, 14, 11), null),
  ], now);
  assert.deepEqual(current, { count: 4, minutes: 360, load: 1890, wins: 2, losses: 1 });
});

test('carga semanal de las últimas 8 semanas', () => {
  const weeks = weeklyLoad([match(at(2026, 10, 13), [[6, 0]]), match(at(2026, 8, 1), [[6, 0]])], now);
  assert.equal(weeks.length, 8);
  assert.equal(weeks.at(-1).load, 630);
  assert.equal(weeks.at(-1).label, '12/10');
  assert.equal(weeks.reduce((s, w) => s + w.load, 0), 630); // 1/8 queda fuera de la ventana
});

test('ratio de carga aguda/crónica', () => {
  assert.equal(loadRatio([], now).ratio, null);
  const steady = [1, 8, 15, 22].map((d) => ({ date: new Date(now - d * 864e5).toISOString(), seconds: 3600, rpe: 5 }));
  assert.equal(loadRatio(steady, now).ratio, 1);
  assert.equal(loadRatio(steady, now).zone, 'optima');
  const spike = [...steady, { date: new Date(now - 2 * 864e5).toISOString(), seconds: 3 * 3600, rpe: 8 }];
  assert.equal(loadRatio(spike, now).zone, 'riesgo');
});

test('sin 3 semanas de historial no se calcula el ratio de carga', () => {
  const recent = [1, 5, 10].map((d) => ({ date: new Date(now - d * 864e5).toISOString(), seconds: 3600, rpe: 8 }));
  assert.equal(loadRatio(recent, now).ratio, null);
});

test('estadísticas de partidos: récord, rachas, compañeros y rivales', () => {
  const activities = [
    match(at(2026, 10, 1), [[6, 4], [6, 4]], { partner: 'Javi', rivals: ['Ana', 'Luis'], position: 'reves' }),
    match(at(2026, 10, 3), [[6, 4], [6, 4]], { partner: 'javi', rivals: ['Ana', 'Pedro'], position: 'reves' }),
    match(at(2026, 10, 5), [[4, 6], [4, 6]], { partner: 'Pablo', rivals: ['Ana', 'Luis'], position: 'drive' }),
    match(at(2026, 10, 7), [[6, 4], [4, 6]], { partner: 'Pablo', rivals: ['Eva', 'Luis'] }),
    match(at(2026, 10, 9), [[6, 1], [6, 1]], { partner: 'Javi', rivals: ['Eva', 'Pedro'], position: 'reves' }),
    { type: 'entreno', date: at(2026, 10, 2), seconds: 1800, rpe: 6 },
  ];
  const s = matchStats(activities);
  assert.equal(s.played, 5);
  assert.deepEqual([s.won, s.lost, s.drawn], [3, 1, 1]);
  assert.equal(s.winRate, 75);
  assert.equal(s.bestWinStreak, 2);
  assert.equal(s.currentWinStreak, 1);
  assert.deepEqual(s.lastResults, [true, true, false, null, true]);
  assert.deepEqual(s.partners[0], { name: 'Javi', played: 3, won: 3, lost: 0 });
  assert.deepEqual(s.rivals.find((r) => r.name === 'Ana'), { name: 'Ana', played: 3, won: 2, lost: 1 });
  assert.deepEqual(s.positions, { drive: { played: 1, won: 0 }, reves: { played: 3, won: 3 } });
});

test('estadísticas de partidos con resultado explícito sin marcador', () => {
  const s = matchStats([
    quick(at(2026, 10, 1), true, { partner: 'Javi' }),
    match(at(2026, 10, 2), [[6, 3], [6, 2]], { won: false }), // el marcador manda
    quick(at(2026, 10, 3), true, { partner: 'Javi' }),
    quick(at(2026, 10, 4), null),
    quick(at(2026, 10, 5), false, { rivals: ['Ana'] }),
  ]);
  assert.equal(s.played, 5);
  assert.deepEqual([s.won, s.lost, s.drawn], [3, 1, 1]);
  assert.equal(s.winRate, 75);
  assert.equal(s.bestWinStreak, 3);
  assert.equal(s.currentWinStreak, 0);
  assert.deepEqual(s.lastResults, [true, true, true, null, false]);
  // Sets y juegos solo de los partidos con marcador
  assert.deepEqual([s.setsFor, s.setsAgainst, s.gamesFor, s.gamesAgainst], [2, 0, 12, 5]);
  assert.deepEqual(s.partners[0], { name: 'Javi', played: 2, won: 2, lost: 0 });
  assert.deepEqual(s.rivals[0], { name: 'Ana', played: 1, won: 0, lost: 1 });
});

test('catálogo de logros', () => {
  assert.equal(ACHIEVEMENTS.length, 14);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) assert.ok(a.icon && a.label && a.description, a.id);
  const list = achievements([]);
  assert.equal(list.length, 14);
  assert.ok(list.every((a) => a.unlocked === false));
});

test('logros de partido', () => {
  const list = achievements([
    match(at(2026, 10, 1), [[3, 6], [6, 0], [6, 4]], { matchKind: 'torneo' }),
  ]);
  assert.deepEqual(unlockedIds(list), ['primer-partido', 'primera-victoria', 'remontada', 'rosco', 'torneo']);
});

test('logros con victorias sin marcador y 10 partidos', () => {
  const wins = [1, 2, 3].map((d) => quick(at(2026, 10, d), true));
  assert.deepEqual(unlockedIds(achievements(wins)), ['primer-partido', 'primera-victoria', 'racha-3']);
  const ten = Array.from({ length: 10 }, (_, i) => quick(at(2026, 10, i + 1), i % 2 === 0));
  assert.ok(unlockedIds(achievements(ten)).includes('diez-partidos'));
  assert.ok(!unlockedIds(achievements(ten)).includes('racha-3'));
});

test('logros sociales: primera foto y popular', () => {
  const posts = [
    { type: 'clase', date: at(2026, 10, 1), seconds: 3600, photoUrl: 'https://x/foto.jpg', kudosCount: 4 },
    { type: 'entreno', date: at(2026, 10, 2), seconds: 1800, kudosCount: 5 },
  ];
  assert.deepEqual(unlockedIds(achievements(posts)), ['primera-foto']);
  posts.push({ type: 'entreno', date: at(2026, 10, 3), seconds: 1800, kudosCount: 1 });
  assert.deepEqual(unlockedIds(achievements(posts)), ['popular', 'primera-foto']);
});

test('logro de constancia: 4 semanas seguidas en cualquier momento', () => {
  const weeks = [at(2026, 8, 3), at(2026, 8, 12), at(2026, 8, 18), at(2026, 8, 27)].map((date) => ({ type: 'entreno', date, seconds: 1800 }));
  assert.ok(unlockedIds(achievements(weeks)).includes('constancia'));
  const withGap = [at(2026, 8, 3), at(2026, 8, 12), at(2026, 8, 26), at(2026, 9, 2)].map((date) => ({ type: 'entreno', date, seconds: 1800 }));
  assert.ok(!unlockedIds(achievements(withGap)).includes('constancia'));
});

test('logros de físico, retos y planes', () => {
  const fitness = Array.from({ length: 5 }, (_, i) => ({ type: 'entreno', date: at(2026, 10, i + 1), seconds: 1800 }));
  assert.ok(unlockedIds(achievements(fitness)).includes('fisico-5'));
  assert.ok(!unlockedIds(achievements(fitness.slice(1))).includes('fisico-5'));

  assert.deepEqual(unlockedIds(achievements([], { completedChallenges: ['partidos-mes:2026-09'] })), ['primer-reto']);
  assert.deepEqual(
    unlockedIds(achievements([], { completedChallenges: ['partidos-mes:2026-09', 'fotos-mes:2026-09', 'activo-semana:2026-W40'] })),
    ['primer-reto', 'tres-retos'],
  );
  assert.deepEqual(
    unlockedIds(achievements([], { finishedPlans: [{ planId: 'hombro-sano', finishedAt: at(2026, 10, 1) }] })),
    ['plan-terminado'],
  );
});

test('newlyUnlocked devuelve solo lo recién desbloqueado', () => {
  const before = achievements([quick(at(2026, 10, 1), false)]);
  const after = achievements([quick(at(2026, 10, 1), false), quick(at(2026, 10, 2), true, { photoUrl: 'x.jpg' })]);
  assert.deepEqual(newlyUnlocked(before, after).map((a) => a.id), ['primera-victoria', 'primera-foto']);
  assert.deepEqual(newlyUnlocked(after, after), []);
  assert.deepEqual(newlyUnlocked([], after).map((a) => a.id).sort(), ['primer-partido', 'primera-foto', 'primera-victoria']);
  assert.deepEqual(newlyUnlocked(undefined, achievements([])), []);
});
