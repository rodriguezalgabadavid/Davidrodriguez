import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, FOCUSES, LEVELS, getExercise } from '../js/data.js';
import { availableExercises, buildTimeline, formatTime, generateSession, timelineDuration } from '../js/generator.js';

test('los ids de ejercicios son únicos', () => {
  const ids = EXERCISES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('la misma semilla genera la misma sesión', () => {
  const a = generateSession({ focus: 'agilidad', level: 2, minutes: 30, seed: 42 });
  const b = generateSession({ focus: 'agilidad', level: 2, minutes: 30, seed: 42 });
  assert.deepEqual(a, b);
});

test('la duración real se acerca a la pedida en todas las combinaciones', () => {
  for (const focus of Object.keys(FOCUSES)) {
    for (const level of [1, 2, 3]) {
      for (const minutes of [15, 20, 30, 45, 60]) {
        for (const equipment of [[], ['banda', 'conos', 'escalera', 'banco', 'balón medicinal', 'mancuerna', 'comba']]) {
          const session = generateSession({ focus, level, minutes, equipment, seed: minutes * level });
          const secs = timelineDuration(buildTimeline(session));
          const label = `${focus}/${level}/${minutes}'/${equipment.length}`;
          assert.ok(session.blocks[1].exercises.length >= 3, `bloque principal vacío: ${label}`);
          assert.ok(Math.abs(secs - minutes * 60) <= minutes * 60 * 0.25, `${label}: ${secs}s`);
        }
      }
    }
  }
});

test('respeta el nivel y el material disponible', () => {
  for (let seed = 0; seed < 50; seed++) {
    const session = generateSession({ focus: 'completa', level: 1, minutes: 45, equipment: [], seed });
    for (const block of session.blocks) {
      for (const id of block.exercises) {
        const ex = getExercise(id);
        assert.equal(ex.level, 1, `${id} no es de iniciación`);
        assert.deepEqual(ex.equipment, [], `${id} necesita material`);
      }
    }
  }
});

test('no repite ejercicios dentro de una sesión', () => {
  for (let seed = 0; seed < 50; seed++) {
    const session = generateSession({ focus: 'prevencion', level: 3, minutes: 60, equipment: ['banda'], seed });
    const ids = session.blocks.flatMap((b) => b.exercises);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('el bloque principal usa las categorías del objetivo', () => {
  const session = generateSession({ focus: 'resistencia', level: 3, minutes: 30, seed: 7 });
  for (const id of session.blocks[1].exercises) {
    assert.ok(FOCUSES.resistencia.categories.includes(getExercise(id).category));
  }
});

test('la línea de tiempo alterna trabajo y descanso y acaba en trabajo', () => {
  const session = generateSession({ focus: 'core', level: 2, minutes: 20, seed: 3 });
  const steps = buildTimeline(session);
  assert.equal(steps[0].kind, 'work');
  assert.equal(steps.at(-1).kind, 'work');
  for (let i = 1; i < steps.length; i++) {
    assert.notEqual(steps[i].kind === 'rest' && steps[i - 1].kind === 'rest', true, `dos descansos seguidos en ${i}`);
  }
  const mainWork = steps.filter((s) => s.kind === 'work' && s.block === 'Bloque principal');
  assert.equal(mainWork.length, session.rounds * session.blocks[1].exercises.length);
  assert.ok(mainWork.every((s) => s.seconds === LEVELS[2].work));
});

test('availableExercises filtra por material', () => {
  assert.ok(availableExercises({ level: 3, equipment: [] }).every((e) => e.equipment.length === 0));
  assert.ok(availableExercises({ level: 3, equipment: ['banda'] }).some((e) => e.equipment.includes('banda')));
});

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(1800), '30:00');
});
