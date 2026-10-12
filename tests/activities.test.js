import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityTitle, formatScore, fromLegacy, knownNames, matchOutcome, matchWon, normalizeActivityInput, parseSets, sessionLoad,
} from '../js/activities.js';

const INPUT_KEYS = ['type', 'date', 'seconds', 'rpe', 'won', 'sets', 'matchKind', 'partner', 'rivals', 'club', 'title', 'text', 'plan', 'focus'].sort();

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
  assert.match(parseSets([['6.5', '4']]).error, /no válido/);
});

test('matchOutcome cuenta sets y juegos', () => {
  assert.deepEqual(matchOutcome([[6, 4], [3, 6], [7, 5]]), { setsFor: 2, setsAgainst: 1, gamesFor: 16, gamesAgainst: 15, won: true });
  assert.equal(matchOutcome([[4, 6], [5, 7]]).won, false);
  assert.equal(matchOutcome([[6, 4], [4, 6]]).won, null);
  assert.deepEqual(matchOutcome([]), { setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0, won: null });
});

test('matchWon: el marcador manda y, sin marcador, el resultado explícito', () => {
  assert.equal(matchWon({ type: 'partido', sets: [[4, 6], [4, 6]], won: true }), false);
  assert.equal(matchWon({ type: 'partido', sets: [], won: true }), true);
  assert.equal(matchWon({ type: 'partido', sets: [], won: false }), false);
  assert.equal(matchWon({ type: 'partido', won: null }), null);
  assert.equal(matchWon({ type: 'entreno', won: true }), null);
});

test('carga de sesión = minutos × RPE (sin RPE, 0)', () => {
  assert.equal(sessionLoad({ seconds: 90 * 60, rpe: 7 }), 630);
  assert.equal(sessionLoad({ seconds: 0, rpe: 7 }), 0);
  assert.equal(sessionLoad({ seconds: 3600, rpe: null }), 0);
});

test('título automático de partidos: marcador, resultado explícito y tipo', () => {
  const a = normalizeActivityInput({ type: 'partido', matchKind: 'liga', sets: [[6, 4], [6, 3]] });
  assert.equal(activityTitle(a), 'Victoria · Liga');
  assert.equal(formatScore(a.sets), '6-4 6-3');
  assert.equal(activityTitle({ ...a, title: 'Final del club' }), 'Final del club');
  assert.equal(activityTitle({ ...a, title: '   ' }), 'Victoria · Liga');
  assert.equal(activityTitle({ type: 'partido', sets: [], won: true, matchKind: null }), 'Victoria');
  assert.equal(activityTitle({ type: 'partido', sets: [], won: false, matchKind: 'torneo' }), 'Derrota · Torneo');
  assert.equal(activityTitle({ type: 'partido', sets: [], won: null }), 'Partido');
  assert.equal(activityTitle({ type: 'partido', sets: [], won: null, matchKind: 'americana' }), 'Partido · Americana');
  assert.equal(activityTitle({ type: 'partido', sets: [[6, 4], [4, 6]], won: null }), 'Empate');
  // El marcador manda sobre won
  assert.equal(activityTitle({ type: 'partido', sets: [[2, 6], [3, 6]], won: true }), 'Derrota');
});

test('título automático de entrenos y clases', () => {
  assert.equal(activityTitle({ type: 'entreno', focus: 'potencia' }), 'Potencia y salto');
  assert.equal(activityTitle({ type: 'entreno', focus: null }), 'Preparación física');
  assert.equal(activityTitle({ type: 'entreno', focus: 'inventado' }), 'Preparación física');
  assert.equal(activityTitle({ type: 'clase' }), 'Clase');
});

test('normalizeActivityInput devuelve solo los campos de ActivityInput', () => {
  const a = normalizeActivityInput({ type: 'partido', id: 'x', userId: 'u', photoUrl: 'p', kudosCount: 3, position: 'drive' });
  assert.deepEqual(Object.keys(a).sort(), INPUT_KEYS);
  assert.deepEqual(Object.keys(normalizeActivityInput({})).sort(), INPUT_KEYS);
});

test('normalizeActivityInput limpia nombres y acota números', () => {
  const a = normalizeActivityInput({
    type: 'partido', partner: '  Javi   García ', rivals: ['Ana', ' ', 'Luis', 'Eva'], club: 'x'.repeat(60),
    rpe: 14, seconds: '5400',
  });
  assert.equal(a.partner, 'Javi García');
  assert.deepEqual(a.rivals, ['Ana', 'Luis']);
  assert.equal(a.club.length, 40);
  assert.equal(a.rpe, 10);
  assert.equal(a.seconds, 5400);
  assert.equal(a.matchKind, null);
  assert.equal(normalizeActivityInput({ rpe: 0 }).rpe, 1);
  assert.equal(normalizeActivityInput({ rpe: '' }).rpe, null);
  assert.equal(normalizeActivityInput({ rpe: null }).rpe, null);
  assert.equal(normalizeActivityInput({ rpe: 'mucho' }).rpe, null);
  assert.equal(normalizeActivityInput({ seconds: 99999 }).seconds, 36000);
  assert.equal(normalizeActivityInput({ seconds: -5 }).seconds, 0);
});

test('normalizeActivityInput: won sale del marcador o del valor explícito', () => {
  assert.equal(normalizeActivityInput({ type: 'partido', sets: [[6, 4], [6, 2]], won: false }).won, true);
  assert.equal(normalizeActivityInput({ type: 'partido', sets: [[6, 4], [2, 6]] }).won, null);
  assert.equal(normalizeActivityInput({ type: 'partido', won: true }).won, true);
  assert.equal(normalizeActivityInput({ type: 'partido', won: 'false' }).won, false);
  assert.equal(normalizeActivityInput({ type: 'partido', won: 'quizá' }).won, null);
  assert.equal(normalizeActivityInput({ type: 'partido' }).won, null);
  assert.equal(normalizeActivityInput({ type: 'clase', won: true }).won, null);
});

test('normalizeActivityInput valida los sets', () => {
  const a = normalizeActivityInput({ type: 'partido', sets: [['6', '4'], [5, 5], [6, -1], [6.5, 3], ['x', 2], [7, 6], 'nada', [10, 8]] });
  assert.deepEqual(a.sets, [[6, 4], [7, 6], [10, 8]]);
  const many = normalizeActivityInput({ type: 'partido', sets: Array.from({ length: 8 }, () => [6, 1]) });
  assert.equal(many.sets.length, 5);
  assert.deepEqual(normalizeActivityInput({ type: 'entreno', sets: [[6, 4]] }).sets, []);
});

test('normalizeActivityInput: campos según el tipo', () => {
  const entreno = normalizeActivityInput({ type: 'entreno', focus: 'core', matchKind: 'liga', rivals: ['Ana'], partner: 'Javi' });
  assert.equal(entreno.focus, 'core');
  assert.equal(entreno.matchKind, null);
  assert.deepEqual(entreno.rivals, []);
  assert.equal(entreno.partner, 'Javi');
  assert.equal(normalizeActivityInput({ type: 'entreno', focus: 'yoga' }).focus, null);
  assert.equal(normalizeActivityInput({ type: 'partido', focus: 'core' }).focus, null);
  assert.equal(normalizeActivityInput({ type: 'partido', matchKind: 'torneo' }).matchKind, 'torneo');
  assert.equal(normalizeActivityInput({ type: 'partido', matchKind: 'mundial' }).matchKind, null);
  assert.equal(normalizeActivityInput({ type: 'raro' }).type, 'entreno');
});

test('normalizeActivityInput: textos, fecha y plan', () => {
  const a = normalizeActivityInput({
    type: 'entreno',
    date: '2026-10-11T19:00:00.000Z',
    title: `  ${'T'.repeat(100)} `,
    text: `  Hola\r\nequipo ${'x'.repeat(3000)}`,
    plan: { planId: 'pretemporada', sessionKey: 'w1s2', extra: 1 },
  });
  assert.equal(a.date, '2026-10-11T19:00:00.000Z');
  assert.equal(a.title.length, 80);
  assert.equal(a.text.length, 2000);
  assert.ok(a.text.startsWith('Hola\nequipo'));
  assert.deepEqual(a.plan, { planId: 'pretemporada', sessionKey: 'w1s2' });
  assert.equal(normalizeActivityInput({ plan: { sessionKey: 'w1s1' } }).plan, null);
  assert.equal(normalizeActivityInput({ plan: 'pretemporada' }).plan, null);
  const bad = normalizeActivityInput({ date: 'ayer' });
  assert.ok(!Number.isNaN(new Date(bad.date).getTime()));
  assert.equal(normalizeActivityInput({ date: new Date(Date.UTC(2026, 0, 2)) }).date, '2026-01-02T00:00:00.000Z');
});

test('fromLegacy convierte el historial de la v1 en entrenos', () => {
  const [a] = fromLegacy([{ date: '2026-10-11T19:00:00.000Z', title: 'Core y golpeo', seconds: 1200, rpe: 6, focus: 'core', level: 2 }]);
  assert.deepEqual(Object.keys(a).sort(), INPUT_KEYS);
  assert.equal(a.type, 'entreno');
  assert.equal(a.title, 'Core y golpeo');
  assert.equal(a.focus, 'core');
  assert.equal(a.seconds, 1200);
  assert.equal(a.rpe, 6);
  assert.equal(a.date, '2026-10-11T19:00:00.000Z');
});

test('fromLegacy convierte las actividades de la v2 y descarta los datos de ejemplo', () => {
  const list = fromLegacy([
    {
      id: 'a1', type: 'partido', date: '2026-10-10T18:00:00.000Z', seconds: 5400, rpe: 8, matchKind: 'liga', position: 'reves',
      partner: 'Javi', rivals: ['Marta', 'Luis'], club: 'Club Norte', sets: [[6, 4], [3, 6], [7, 5]], notes: 'Remontada en el tercero.',
    },
    { id: 'a2', type: 'clase', date: '2026-10-09T18:00:00.000Z', seconds: 3600, rpe: 5, title: 'Clase: bandeja' },
    { id: 'a3', type: 'partido', date: '2026-10-08T18:00:00.000Z', seconds: 5400, sets: [[6, 0]], demo: true },
    null,
    'basura',
  ]);
  assert.equal(list.length, 2);
  const [match, clase] = list;
  assert.equal(match.type, 'partido');
  assert.equal(match.won, true);
  assert.equal(match.text, 'Remontada en el tercero.');
  assert.equal(match.matchKind, 'liga');
  assert.deepEqual(match.rivals, ['Marta', 'Luis']);
  assert.equal(match.plan, null);
  assert.equal(clase.type, 'clase');
  assert.equal(clase.title, 'Clase: bandeja');
  assert.deepEqual(fromLegacy(null), []);
  assert.deepEqual(fromLegacy({}), []);
});

test('knownNames agrupa sin distinguir mayúsculas', () => {
  const names = knownNames([
    { type: 'partido', partner: 'Javi', rivals: ['ana', 'Luis'], club: 'Norte' },
    { type: 'partido', partner: 'javi', rivals: ['Ana'], club: 'norte' },
  ]);
  assert.equal(names.people.length, 3);
  assert.equal(names.clubs.length, 1);
});
