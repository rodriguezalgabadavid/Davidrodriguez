import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGES, challengeProgress, completedChallenges, currentChallenges, getChallenge, instanceId, isoWeek, leaderboard,
  periodKey, periodRange, rangeFromInstanceId,
} from '../js/challenges.js';

const at = (y, m, d, h = 18, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 14, 20); // miércoles 14/10/2026
const local = (y, m, d) => new Date(y, m - 1, d).getTime();
const range = (r) => r && [r.from.getTime(), r.to.getTime()];

const author = (id, name) => ({ id, name, avatarUrl: null, isPremium: false });
const act = (userId, name, date, extra = {}) => ({ userId, author: author(userId, name), type: 'partido', date, seconds: 5400, sets: [], won: null, ...extra });

test('catálogo de retos', () => {
  assert.ok(CHALLENGES.length >= 6 && CHALLENGES.length <= 8);
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, CHALLENGES.length);
  assert.ok(CHALLENGES.some((c) => c.period === 'week'));
  assert.ok(CHALLENGES.some((c) => c.period === 'month'));
  for (const c of CHALLENGES) {
    assert.ok(c.icon && c.title && c.description && c.unit, c.id);
    assert.ok(['week', 'month'].includes(c.period), c.id);
    assert.ok(c.target > 0, c.id);
    assert.ok(!c.id.includes(':'), c.id);
  }
  assert.equal(getChallenge('partidos-mes').target, 8);
  assert.equal(getChallenge('no-existe'), null);
});

test('ids de instancia: mes y semana ISO', () => {
  assert.equal(instanceId(getChallenge('partidos-mes'), now), 'partidos-mes:2026-10');
  assert.equal(instanceId(getChallenge('activo-semana'), now), 'activo-semana:2026-W42');
  assert.equal(periodKey('month', new Date(2026, 0, 1, 0, 0)), '2026-01');
  assert.equal(periodKey('month', new Date(2026, 11, 31, 23, 59)), '2026-12');
});

test('semana ISO al cambiar de año', () => {
  // 2026 empieza en jueves: tiene semana 53, que acaba el domingo 3/1/2027.
  assert.equal(periodKey('week', new Date(2026, 11, 28)), '2026-W53');
  assert.equal(periodKey('week', new Date(2027, 0, 1)), '2026-W53');
  assert.equal(periodKey('week', new Date(2027, 0, 3, 23, 59)), '2026-W53');
  assert.equal(periodKey('week', new Date(2027, 0, 4)), '2027-W01');
  // El lunes 30/12/2024 ya es la semana 1 de 2025.
  assert.equal(periodKey('week', new Date(2024, 11, 30)), '2025-W01');
  // El domingo 31/12/2023 es la semana 52 de 2023.
  assert.equal(periodKey('week', new Date(2023, 11, 31)), '2023-W52');
  assert.deepEqual(isoWeek(new Date(2026, 0, 1)), { year: 2026, week: 1 });
});

test('rangos de periodo con límites', () => {
  assert.deepEqual(range(periodRange('month', now)), [local(2026, 10, 1), local(2026, 11, 1)]);
  assert.deepEqual(range(periodRange('week', now)), [local(2026, 10, 12), local(2026, 10, 19)]);
  assert.deepEqual(range(periodRange('month', new Date(2026, 11, 31, 23))), [local(2026, 12, 1), local(2027, 1, 1)]);
});

test('rangeFromInstanceId interpreta meses y semanas', () => {
  assert.deepEqual(range(rangeFromInstanceId('partidos-mes:2026-10')), [local(2026, 10, 1), local(2026, 11, 1)]);
  assert.deepEqual(range(rangeFromInstanceId('partidos-mes:2026-12')), [local(2026, 12, 1), local(2027, 1, 1)]);
  assert.deepEqual(range(rangeFromInstanceId('activo-semana:2026-W42')), [local(2026, 10, 12), local(2026, 10, 19)]);
  assert.deepEqual(range(rangeFromInstanceId('activo-semana:2026-W53')), [local(2026, 12, 28), local(2027, 1, 4)]);
  assert.deepEqual(range(rangeFromInstanceId('activo-semana:2025-W01')), [local(2024, 12, 30), local(2025, 1, 6)]);
  assert.equal(rangeFromInstanceId('activo-semana:2025-W53'), null); // 2025 solo tiene 52 semanas
  assert.equal(rangeFromInstanceId('activo-semana:2026-W00'), null);
  assert.equal(rangeFromInstanceId('partidos-mes:2026-13'), null);
  assert.equal(rangeFromInstanceId('partidos-mes'), null);
  assert.equal(rangeFromInstanceId(''), null);
  assert.equal(rangeFromInstanceId(undefined), null);
  // Ida y vuelta para todas las semanas de un par de años
  for (let d = new Date(2025, 11, 1); d < new Date(2027, 1, 1); d.setDate(d.getDate() + 1)) {
    const id = instanceId(getChallenge('activo-semana'), d);
    const r = rangeFromInstanceId(id);
    assert.ok(r.from <= d && d < r.to, id);
  }
});

test('retos activos con días restantes contando hoy', () => {
  const list = currentChallenges(now);
  assert.equal(list.length, CHALLENGES.length);
  const week = list.find((c) => c.id === 'activo-semana');
  const month = list.find((c) => c.id === 'partidos-mes');
  assert.equal(week.instanceId, 'activo-semana:2026-W42');
  assert.equal(week.endsInDays, 5); // miércoles → domingo
  assert.equal(month.endsInDays, 18); // 14 → 31 de octubre
  assert.equal(month.title, getChallenge('partidos-mes').title);
  assert.equal(currentChallenges(new Date(2026, 9, 18, 23)).find((c) => c.id === 'activo-semana').endsInDays, 1);
  assert.equal(currentChallenges(new Date(2026, 9, 31, 10)).find((c) => c.id === 'partidos-mes').endsInDays, 1);
  assert.equal(currentChallenges(new Date(2026, 9, 1, 0)).find((c) => c.id === 'partidos-mes').endsInDays, 31);
});

test('progreso de un reto mensual cuenta solo el periodo', () => {
  const mine = [
    act('me', 'Yo', at(2026, 10, 1, 0, 0)),
    act('me', 'Yo', at(2026, 10, 5)),
    act('me', 'Yo', at(2026, 10, 31, 23, 59)),
    act('me', 'Yo', at(2026, 9, 30, 23, 59)), // septiembre
    act('me', 'Yo', at(2026, 11, 1, 0, 0)), // noviembre
    { userId: 'me', type: 'entreno', date: at(2026, 10, 3), seconds: 1800 },
  ];
  const p = challengeProgress(getChallenge('partidos-mes'), mine, now);
  assert.equal(p.instanceId, 'partidos-mes:2026-10');
  assert.deepEqual([p.value, p.target, p.pct, p.done], [3, 8, 38, false]);
  assert.equal(p.endsInDays, 18);
  assert.equal(p.from.getTime(), local(2026, 10, 1));
  assert.equal(p.to.getTime(), local(2026, 11, 1));
});

test('progreso de un reto semanal y reto completado', () => {
  const fisico = getChallenge('fisico-semana');
  const sessions = [12, 13, 14, 18].map((d) => ({ type: 'entreno', date: at(2026, 10, d, 9), seconds: 1800 }));
  const p = challengeProgress(fisico, [...sessions, { type: 'entreno', date: at(2026, 10, 11, 23, 59), seconds: 1800 }], now);
  assert.deepEqual([p.value, p.pct, p.done], [4, 100, true]);
  const almost = challengeProgress(fisico, sessions.slice(0, 2), now);
  assert.deepEqual([almost.value, almost.pct, almost.done], [2, 67, false]);
});

test('métricas de los retos', () => {
  const month = [
    act('me', 'Yo', at(2026, 10, 2), { won: true, partner: 'Javi', photoUrl: 'a.jpg' }),
    act('me', 'Yo', at(2026, 10, 3), { sets: [[6, 2], [6, 3]], won: null, partner: ' javi ' }),
    act('me', 'Yo', at(2026, 10, 4), { sets: [[2, 6], [3, 6]], won: true, partner: 'Pablo' }),
    act('me', 'Yo', at(2026, 10, 5), { won: false, partner: '' }),
    { userId: 'me', type: 'clase', date: at(2026, 10, 6), seconds: 3600, partner: 'Lucía', photoUrl: 'b.jpg' },
    { userId: 'me', type: 'entreno', date: at(2026, 10, 7), seconds: 7200 },
  ];
  const value = (id) => challengeProgress(getChallenge(id), month, now).value;
  assert.equal(value('partidos-mes'), 4);
  assert.equal(value('victorias-mes'), 2); // el marcador manda sobre won
  assert.equal(value('horas-mes'), 7); // 4 × 1,5 h + 1 h de clase; el físico no cuenta
  assert.equal(value('fotos-mes'), 2);
  assert.equal(value('companeros-mes'), 2); // Javi y Pablo (solo partidos)
  assert.equal(challengeProgress(getChallenge('horas-mes'), [act('me', 'Yo', at(2026, 10, 2), { seconds: 4000 })], now).value, 1.1);
});

test('clasificación del círculo', () => {
  const circle = [
    act('u1', 'Marta', at(2026, 10, 2)),
    act('u1', 'Marta', at(2026, 10, 9)),
    act('u2', 'Ana', at(2026, 10, 3)),
    act('u2', 'Ana', at(2026, 10, 4)),
    act('me', 'Yo', at(2026, 10, 5), { isMine: true }),
    act('u3', 'Luis', at(2026, 9, 28)), // fuera del periodo: aparece con 0
    { ...act('u4', 'Eva', at(2026, 10, 6)), type: 'entreno' }, // aparece con 0 partidos
  ];
  const board = leaderboard(getChallenge('partidos-mes'), circle, now);
  assert.deepEqual(board.map((r) => [r.userId, r.value]), [['u2', 2], ['u1', 2], ['me', 1], ['u4', 0], ['u3', 0]]);
  assert.equal(board[0].author.name, 'Ana');
  assert.equal(board.find((r) => r.userId === 'me').isMine, true);
  assert.deepEqual(leaderboard(getChallenge('partidos-mes'), [], now), []);
});

test('retos completados entre los que me apunté', () => {
  const mine = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((d) => act('me', 'Yo', at(2026, 9, d))), // 8 partidos en septiembre
    ...[12, 13, 14].map((d) => act('me', 'Yo', at(2026, 10, d, 9))), // 3 esta semana
    act('me', 'Yo', at(2026, 10, 14, 10)),
  ];
  const joined = [
    'partidos-mes:2026-09', // completado
    'partidos-mes:2026-10', // 4 de 8
    'activo-semana:2026-W42', // 4 de 4 → completado aunque la semana no haya terminado
    'activo-semana:2026-W41', // 0
    'inventado:2026-10',
    'partidos-mes:2026-99',
  ];
  assert.deepEqual(completedChallenges(joined, mine), ['partidos-mes:2026-09', 'activo-semana:2026-W42']);
  assert.deepEqual(completedChallenges([], mine), []);
});

test('el reto de horas no se da por cumplido por redondeo (11 h 57 min no son 12 h)', () => {
  const horas = getChallenge('horas-mes');
  const almost = [...Array(7)].map((_, i) => act('me', 'Yo', at(2026, 10, 1 + i), { seconds: 90 * 60 }))
    .concat(act('me', 'Yo', at(2026, 10, 9), { seconds: 87 * 60 }));
  const p = challengeProgress(horas, almost, now);
  assert.equal(p.value, 11.9);
  assert.equal(p.done, false);
});
