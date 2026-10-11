import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityTitle, demoActivities, formatScore, knownNames, matchOutcome, migrateLegacyHistory,
  normalizeActivity, parseSets, sessionLoad,
} from '../js/activities.js';

test('parseSets ignora filas vacías y convierte a números', () => {
  const { sets, error } = parseSets([['6', '4'], ['3', '6'], ['', '']]);
  assert.equal(error, null);
  assert.deepEqual(sets, [[6, 4], [3, 6]]);
});

test('parseSets detecta sets incompletos, empatados o vacíos', () => {
  assert.match(parseSets([['6', '']]).error, /set 1/);
  assert.match(parseSets([['6', '4'], ['5', '5']]).error, /set 2.*empate/);
  assert.match(parseSets([['', ''], ['', '']]).error, /al menos un set/);
  assert.match(parseSets([['6', '-1']]).error, /no válido/);
});

test('matchOutcome cuenta sets y juegos', () => {
  assert.deepEqual(matchOutcome([[6, 4], [3, 6], [7, 5]]), { setsFor: 2, setsAgainst: 1, gamesFor: 16, gamesAgainst: 15, won: true });
  assert.equal(matchOutcome([[4, 6], [5, 7]]).won, false);
  assert.equal(matchOutcome([[6, 4], [4, 6]]).won, null);
});

test('carga de sesión = minutos × RPE', () => {
  assert.equal(sessionLoad({ seconds: 90 * 60, rpe: 7 }), 630);
  assert.equal(sessionLoad({ seconds: 0, rpe: 7 }), 0);
});

test('título automático de partidos', () => {
  const a = normalizeActivity({ type: 'partido', matchKind: 'liga', sets: [[6, 4], [6, 3]] });
  assert.equal(activityTitle(a), 'Victoria · Liga');
  assert.equal(formatScore(a.sets), '6-4 6-3');
  assert.equal(activityTitle({ ...a, title: 'Final del club' }), 'Final del club');
});

test('normalizeActivity limpia nombres y acota el RPE', () => {
  const a = normalizeActivity({ type: 'partido', partner: '  Javi   García ', rivals: ['Ana', ' ', 'Luis'], rpe: 14, seconds: '5400' });
  assert.equal(a.partner, 'Javi García');
  assert.deepEqual(a.rivals, ['Ana', 'Luis']);
  assert.equal(a.rpe, 10);
  assert.equal(a.seconds, 5400);
  assert.equal(a.matchKind, 'amistoso');
});

test('migra el historial antiguo a actividades de preparación física', () => {
  const [a] = migrateLegacyHistory([{ date: '2026-10-11T19:00:00.000Z', title: 'Core y golpeo', seconds: 1200, rpe: 6 }]);
  assert.equal(a.type, 'entreno');
  assert.equal(a.title, 'Core y golpeo');
  assert.ok(a.id);
});

test('knownNames agrupa sin distinguir mayúsculas', () => {
  const names = knownNames([
    { type: 'partido', partner: 'Javi', rivals: ['ana', 'Luis'], club: 'Norte' },
    { type: 'partido', partner: 'javi', rivals: ['Ana'], club: 'norte' },
  ]);
  assert.equal(names.people.length, 3);
  assert.equal(names.clubs.length, 1);
});

test('los datos de ejemplo son válidos y están marcados', () => {
  const demo = demoActivities(new Date(2026, 9, 14));
  assert.ok(demo.length >= 5);
  assert.ok(demo.every((a) => a.demo && a.id && a.seconds > 0));
  assert.ok(demo.filter((a) => a.type === 'partido').every((a) => parseSets(a.sets.map(String).map((s) => s.split(','))).error === null));
});
