import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, computeStreak, weekActivity } from '../js/stats.js';

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).toISOString();
const now = new Date(2026, 9, 14, 20); // miércoles 14/10/2026

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

test('actividad semanal por día', () => {
  const week = weekActivity([{ date: at(2026, 10, 14), seconds: 1800 }], now);
  assert.equal(week.length, 7);
  assert.equal(week[0].label, 'L');
  assert.equal(week[2].minutes, 30);
  assert.ok(week[2].isToday);
});
