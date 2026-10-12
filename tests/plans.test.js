import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT, FOCUSES, LEVELS } from '../js/data.js';
import {
  DEFAULT_PREMIUM_ANSWERS, MAX_MINUTES, PLANS, PREMIUM_QUESTIONS, getPlan, hashSeed, nextPlanSession, normalizePremiumAnswers,
  personalizedPlan, planProgress, planSessions, sessionForPlan,
} from '../js/plans.js';

const now = new Date(2026, 9, 14, 20);
const daysAgo = (d) => new Date(now - d * 864e5).toISOString();
const steady = [1, 8, 15, 22].map((d) => ({ type: 'partido', date: daysAgo(d), seconds: 3600, rpe: 5 }));
const spike = [...steady, { type: 'partido', date: daysAgo(2), seconds: 3 * 3600, rpe: 8 }]; // zona de riesgo
const state = (planId, keys = [], finished = []) => ({
  planId, startedAt: planId ? daysAgo(10) : null, completed: Object.fromEntries(keys.map((k) => [k, daysAgo(1)])), finished,
});

test('catálogo de planes generales', () => {
  assert.deepEqual(PLANS.map((p) => p.id), ['primeros-pasos', 'pretemporada', 'piernas-explosivas', 'hombro-sano', 'tercer-set']);
  for (const p of PLANS) {
    assert.ok(p.name && p.description && p.icon, p.id);
    assert.ok(LEVELS[p.level], p.id);
    assert.ok(p.weeks > 0 && p.sessionsPerWeek > 0 && p.minutes > 0, p.id);
    assert.ok(p.focuses.length && p.focuses.every((f) => FOCUSES[f]), p.id);
  }
  const byId = Object.fromEntries(PLANS.map((p) => [p.id, [p.level, p.weeks, p.sessionsPerWeek, p.minutes]]));
  assert.deepEqual(byId, {
    'primeros-pasos': [1, 4, 2, 20],
    pretemporada: [2, 4, 3, 30],
    'piernas-explosivas': [2, 6, 2, 30],
    'hombro-sano': [1, 4, 2, 20],
    'tercer-set': [3, 4, 3, 40],
  });
  assert.equal(getPlan('pretemporada').name, 'Pretemporada');
  assert.equal(getPlan('premium'), null);
  assert.equal(getPlan('nada'), null);
});

test('sesiones del plan: claves, orden y rotación de objetivos', () => {
  const plan = getPlan('pretemporada');
  const sessions = planSessions(plan);
  assert.equal(sessions.length, 12);
  assert.deepEqual(sessions.slice(0, 4).map((s) => s.key), ['w1s1', 'w1s2', 'w1s3', 'w2s1']);
  assert.equal(new Set(sessions.map((s) => s.key)).size, 12);
  assert.deepEqual(sessions.slice(0, 6).map((s) => s.focus), ['completa', 'agilidad', 'resistencia', 'potencia', 'core', 'completa']);
  for (const s of sessions) {
    assert.equal(s.key, `w${s.week}s${s.index}`);
    assert.equal(s.level, plan.level);
    assert.equal(s.planId, 'pretemporada');
    assert.ok(s.title.includes(FOCUSES[s.focus].label));
    assert.ok(Number.isInteger(s.seed) && s.seed >= 0);
  }
  assert.deepEqual(planSessions(null), []);
});

test('sesiones deterministas con semillas estables y distintas', () => {
  const a = planSessions(getPlan('tercer-set'));
  const b = planSessions(getPlan('tercer-set'));
  assert.deepEqual(a, b);
  assert.equal(a[0].seed, hashSeed('tercer-set:w1s1'));
  const allSeeds = PLANS.flatMap((p) => planSessions(p).map((s) => s.seed));
  assert.equal(new Set(allSeeds).size, allSeeds.length);
  assert.deepEqual(sessionForPlan(a[3]), sessionForPlan(b[3]));
});

test('progresión: la segunda mitad del plan dura 5 minutos más, máximo 60', () => {
  const minutes = (id) => planSessions(getPlan(id)).map((s) => [s.week, s.minutes]);
  assert.deepEqual([...new Set(minutes('pretemporada').map(([w, m]) => `${w}:${m}`))], ['1:30', '2:30', '3:35', '4:35']);
  assert.deepEqual([...new Set(minutes('piernas-explosivas').map(([w, m]) => `${w}:${m}`))], ['1:30', '2:30', '3:30', '4:35', '5:35', '6:35']);
  const long = { id: 'largo', name: 'Largo', level: 3, weeks: 2, sessionsPerWeek: 1, minutes: 58, focuses: ['resistencia'] };
  assert.deepEqual(planSessions(long).map((s) => s.minutes), [58, MAX_MINUTES]);
});

test('sessionForPlan genera la sesión del temporizador con el título del plan', () => {
  const ps = planSessions(getPlan('piernas-explosivas'))[0];
  const session = sessionForPlan(ps);
  assert.equal(session.title, ps.title);
  assert.equal(session.focus, ps.focus);
  assert.equal(session.level, ps.level);
  assert.equal(session.minutes, ps.minutes);
  assert.equal(session.seed, ps.seed);
  assert.deepEqual(session.equipment, []);
  assert.deepEqual(session.plan, { planId: 'piernas-explosivas', sessionKey: 'w1s1' });
  assert.ok(session.blocks.every((b) => b.exercises.length > 0));
  assert.deepEqual(sessionForPlan(ps, { equipment: ['conos', 'comba'] }).equipment, ['conos', 'comba']);
});

test('progreso del plan activo', () => {
  const plan = getPlan('hombro-sano'); // 8 sesiones
  assert.deepEqual(planProgress(plan, state('hombro-sano', ['w1s1', 'w1s2', 'w2s1'])), {
    done: 3, total: 8, pct: 38, currentWeek: 2, finished: false, active: true,
  });
  assert.deepEqual(planProgress(plan, state('hombro-sano')), { done: 0, total: 8, pct: 0, currentWeek: 1, finished: false, active: true });
  const all = planSessions(plan).map((s) => s.key);
  assert.equal(planProgress(plan, state('hombro-sano', all)).finished, true);
  assert.equal(planProgress(plan, state('hombro-sano', all)).currentWeek, 4);
  // Claves que no son del plan no cuentan
  assert.equal(planProgress(plan, state('hombro-sano', ['w9s9', 'w1s1'])).done, 1);
});

test('el progreso solo se lee del plan activo', () => {
  const plan = getPlan('hombro-sano');
  assert.deepEqual(planProgress(plan, state('pretemporada', ['w1s1', 'w1s2'])), {
    done: 0, total: 8, pct: 0, currentWeek: 1, finished: false, active: false,
  });
  assert.equal(planProgress(plan, undefined).done, 0);
  const finished = state(null, [], [{ planId: 'hombro-sano', finishedAt: daysAgo(3) }]);
  assert.deepEqual(planProgress(plan, finished), { done: 8, total: 8, pct: 100, currentWeek: 4, finished: true, active: false });
  // Si se reinicia, vuelve a empezar aunque se terminara antes
  const restarted = { ...state('hombro-sano', ['w1s1']), finished: finished.finished };
  assert.deepEqual([planProgress(plan, restarted).done, planProgress(plan, restarted).finished], [1, false]);
});

test('siguiente sesión del plan', () => {
  const plan = getPlan('primeros-pasos');
  const sessions = planSessions(plan);
  assert.equal(nextPlanSession(plan, state('primeros-pasos')).key, 'w1s1');
  assert.equal(nextPlanSession(plan, state('primeros-pasos', ['w1s1', 'w1s2'])).key, 'w2s1');
  assert.equal(nextPlanSession(plan, state('primeros-pasos', ['w1s2'])).key, 'w1s1'); // la que quedó pendiente
  assert.equal(nextPlanSession(plan, state('primeros-pasos', sessions.map((s) => s.key))), null);
  // Un plan que no es el activo empieza por su primera sesión
  assert.equal(nextPlanSession(plan, state('pretemporada', ['w1s1'])).key, 'w1s1');
  assert.equal(nextPlanSession(plan, null).key, 'w1s1');
});

test('cuestionario Premium', () => {
  assert.deepEqual(PREMIUM_QUESTIONS.map((q) => q.id), ['goal', 'days', 'minutes', 'level', 'pains', 'equipment', 'matches']);
  for (const q of PREMIUM_QUESTIONS) {
    assert.ok(q.label && ['single', 'multi'].includes(q.type) && q.options.length >= 2, q.id);
    assert.ok(q.options.every((o) => typeof o.value === 'string' && o.label), q.id);
    const answer = DEFAULT_PREMIUM_ANSWERS[q.id];
    if (q.type === 'single') assert.ok(q.options.some((o) => o.value === answer), q.id);
    else assert.ok(Array.isArray(answer), q.id);
  }
  const options = (id) => PREMIUM_QUESTIONS.find((q) => q.id === id).options.map((o) => o.value);
  assert.deepEqual(options('goal'), ['rendimiento', 'prevencion', 'resistencia', 'potencia', 'lesion']);
  assert.deepEqual(options('days'), ['2', '3', '4']);
  assert.deepEqual(options('minutes'), ['20', '30', '45']);
  assert.deepEqual(options('level'), ['1', '2', '3']);
  assert.deepEqual(options('pains'), ['hombro', 'codo', 'rodilla', 'espalda', 'tobillo', 'ninguna']);
  assert.deepEqual(options('equipment'), EQUIPMENT);
  assert.deepEqual(options('matches'), ['0-1', '2-3', '4+']);
});

test('las respuestas no válidas vuelven a los valores por defecto', () => {
  const a = normalizePremiumAnswers({ goal: 'volar', days: 3, minutes: '90', level: 2, pains: ['rodilla', 'pie', 'ninguna'], equipment: 'conos', matches: null });
  assert.deepEqual(a, { goal: 'rendimiento', days: '3', minutes: '30', level: '2', pains: ['rodilla'], equipment: [], matches: '2-3' });
  assert.deepEqual(normalizePremiumAnswers(null), DEFAULT_PREMIUM_ANSWERS);
});

test('plan personalizado: forma de plan y determinismo', () => {
  const plan = personalizedPlan(DEFAULT_PREMIUM_ANSWERS, steady, now);
  assert.equal(plan.id, 'premium');
  assert.equal(plan.name, 'Tu plan personalizado');
  assert.ok(plan.description && plan.icon);
  assert.deepEqual([plan.weeks, plan.sessionsPerWeek, plan.minutes, plan.level], [4, 3, 30, 2]);
  assert.equal(plan.sessions.length, 12);
  assert.equal(planSessions(plan), plan.sessions);
  assert.deepEqual(plan.sessions.slice(0, 4).map((s) => s.key), ['w1s1', 'w1s2', 'w1s3', 'w2s1']);
  assert.ok(plan.sessions.every((s) => FOCUSES[s.focus] && s.planId === 'premium'));
  assert.deepEqual(new Set(plan.focuses), new Set(plan.sessions.map((s) => s.focus)));
  assert.ok(plan.notes.length >= 1);
  assert.deepEqual(personalizedPlan(DEFAULT_PREMIUM_ANSWERS, steady, now), plan);
  assert.deepEqual(personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS }, [...steady], new Date(now)), plan);
  // Y funciona con planProgress / nextPlanSession / sessionForPlan
  assert.deepEqual(planProgress(plan, state('premium', ['w1s1'])).done, 1);
  assert.equal(nextPlanSession(plan, state('premium', ['w1s1'])).key, 'w1s2');
  assert.deepEqual(sessionForPlan(plan.sessions[0]).plan, { planId: 'premium', sessionKey: 'w1s1' });
});

test('plan personalizado: el objetivo pesa en el reparto', () => {
  const count = (plan, focus) => plan.sessions.filter((s) => s.focus === focus).length;
  const power = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, goal: 'potencia' }, [], now);
  const endurance = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, goal: 'resistencia' }, [], now);
  assert.equal(power.focuses[0], 'potencia');
  assert.equal(endurance.focuses[0], 'resistencia');
  assert.ok(count(power, 'potencia') > count(endurance, 'potencia'));
  assert.ok(count(endurance, 'resistencia') > count(power, 'resistencia'));
});

test('plan personalizado: cada molestia añade prevención y una nota', () => {
  const base = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, goal: 'potencia' }, [], now);
  const sore = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, goal: 'potencia', pains: ['hombro', 'rodilla'] }, [], now);
  const prevention = (plan) => plan.sessions.filter((s) => s.focus === 'prevencion').length;
  assert.equal(prevention(base), 0);
  for (let week = 1; week <= 4; week++) {
    assert.ok(sore.sessions.some((s) => s.week === week && s.focus === 'prevencion'), `semana ${week}`);
  }
  const oneSore = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, goal: 'potencia', pains: ['hombro'] }, [], now);
  assert.ok(prevention(sore) > prevention(oneSore));
  assert.ok(sore.notes.some((n) => n.startsWith('Hombro')));
  assert.ok(sore.notes.some((n) => n.startsWith('Rodilla')));
  assert.ok(sore.notes.some((n) => /fisioterapeuta/.test(n)));
  assert.equal(sore.notes.length, base.notes.length + 3);
  // 'ninguna' no cuenta como molestia
  assert.deepEqual(personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, goal: 'potencia', pains: ['ninguna'] }, [], now), base);
  // Con una sola sesión semanal, prevención cada dos semanas
  const single = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, days: '2', matches: '4+', pains: ['codo'] }, [], now);
  assert.deepEqual(single.sessions.map((s) => s.focus === 'prevencion'), [false, true, false, true]);
});

test('plan personalizado: con carga alta baja el volumen un 20 %', () => {
  const normal = personalizedPlan(DEFAULT_PREMIUM_ANSWERS, steady, now);
  const tired = personalizedPlan(DEFAULT_PREMIUM_ANSWERS, spike, now);
  assert.equal(normal.minutes, 30);
  assert.equal(tired.minutes, 24);
  tired.sessions.forEach((s, i) => assert.equal(s.minutes, Math.round(normal.sessions[i].minutes * 0.8)));
  assert.ok(tired.notes.some((n) => /20 %/.test(n)));
  assert.ok(!normal.notes.some((n) => /20 %/.test(n)));
  assert.equal(tired.sessions.length, normal.sessions.length);
});

test('plan personalizado: con 4 o más partidos por semana, menos sesiones', () => {
  const regular = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, days: '3', matches: '2-3' }, [], now);
  const busy = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, days: '3', matches: '4+' }, [], now);
  assert.equal(regular.sessionsPerWeek, 3);
  assert.equal(busy.sessionsPerWeek, 2);
  assert.equal(busy.sessions.length, 8);
  for (let week = 1; week <= 4; week++) assert.equal(busy.sessions.filter((s) => s.week === week).length, 2);
  assert.ok(busy.notes.some((n) => /4 o más partidos/.test(n)));
  assert.equal(personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, days: '2', matches: '4+' }, [], now).sessionsPerWeek, 1);
});

test('plan personalizado: material, minutos, progresión y vuelta tras lesión', () => {
  const plan = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, minutes: '45', equipment: ['comba', 'conos'] }, [], now);
  assert.deepEqual(plan.equipment, ['conos', 'comba']);
  assert.deepEqual(sessionForPlan(plan.sessions[0]).equipment, ['conos', 'comba']);
  assert.deepEqual([...new Set(plan.sessions.map((s) => s.minutes))], [45, 50]);
  assert.ok(!plan.notes.some((n) => /Sin material/.test(n)));

  const comeback = personalizedPlan({ ...DEFAULT_PREMIUM_ANSWERS, goal: 'lesion', level: '3' }, [], now);
  assert.equal(comeback.level, 1);
  assert.deepEqual([...new Set(comeback.sessions.map((s) => `${s.week}:${s.level}`))], ['1:1', '2:1', '3:2', '4:2']);
  assert.equal(comeback.focuses[0], 'prevencion');
  for (const s of comeback.sessions) assert.ok(sessionForPlan(s).blocks.length === 3);
});
