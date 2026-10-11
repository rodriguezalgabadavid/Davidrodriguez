import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievements, computeStats, computeStreak, loadRatio, matchStats, weekActivity, weekSummary, weeklyLoad } from '../js/stats.js';

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
const now = new Date(2026, 9, 14, 20); // miércoles 14/10/2026
const match = (date, sets, extra = {}) => ({ type: 'partido', date, sets, seconds: 5400, rpe: 7, ...extra });

test('racha de días consecutivos hasta hoy', () => {
  const history = [at(2026, 10, 12), at(2026, 10, 13), at(2026, 10, 14), at(2026, 10, 10)].map((date) => ({ date }));
  assert.equal(computeStreak(history, now), 3);
});

test('la racha se mantiene si hoy aún no has entrenado', () => {
  const history = [at(2026, 10, 12), at(2026, 10, 13)].map((date) => ({ date }));
  assert.equal(computeStreak(history, now), 2);
});

test('la racha se rompe tras un día sin entrenar', () => {
  const history = [at(2026, 10, 11), at(2026, 10, 12)].map((date) => ({ date }));
  assert.equal(computeStreak(history, now), 0);
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

test('logros', () => {
  const list = achievements([
    match(at(2026, 10, 1), [[3, 6], [6, 0], [6, 4]], { matchKind: 'torneo' }),
  ]);
  const unlocked = list.filter((a) => a.unlocked).map((a) => a.id).sort();
  assert.deepEqual(unlocked, ['primer-partido', 'primera-victoria', 'remontada', 'rosco', 'torneo']);
});
