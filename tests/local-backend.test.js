import { test } from 'node:test';
import assert from 'node:assert/strict';

// El backend demo usa localStorage: basta un sustituto en memoria.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { LocalBackend } = await import('../js/backend/local.js');

test('la paginación no pierde actividades con la misma fecha', async () => {
  const backend = new LocalBackend();
  await backend.init();
  await backend.createProfile({ name: 'Test', level: 2 });
  const date = new Date(Date.now() - 3600e3).toISOString();
  for (let i = 0; i < 25; i++) await backend.createActivity({ type: 'entreno', date, seconds: 600, title: `s${i}` }, null);
  const me = await backend.getMe();
  const seen = [];
  let cursor = {};
  for (let page = 0; page < 10; page++) {
    const items = await backend.getUserActivities(me.id, { ...cursor, limit: 10 });
    seen.push(...items.map((a) => a.id));
    if (items.length < 10) break;
    cursor = { before: items.at(-1).date, beforeId: items.at(-1).id };
  }
  assert.equal(seen.length, 25);
  assert.equal(new Set(seen).size, 25);
  backend.destroy?.();
});

test('un plan solo se termina cuando están hechas las sesiones del plan actual', async () => {
  store.clear();
  const backend = new LocalBackend();
  await backend.init();
  await backend.createProfile({ name: 'Test', level: 2 });
  await backend.startPlan('premium');
  // Versión anterior del plan: 4 sesiones completadas que ya no existen en el plan nuevo.
  for (const key of ['w1s1', 'w1s2', 'w1s3', 'w1s4']) await backend.completePlanSession(key, ['w1s1', 'w1s2', 'w1s3', 'w1s4', 'w2s1']);
  const newKeys = ['w1s1', 'w1s2', 'w2s1', 'w2s2', 'w3s1', 'w3s2'];
  let state = await backend.completePlanSession('w2s1', newKeys);
  assert.equal(state.planId, 'premium', 'no debe terminar: faltan sesiones del plan actual');
  for (const key of ['w2s2', 'w3s1']) state = await backend.completePlanSession(key, newKeys);
  assert.equal(state.planId, 'premium');
  state = await backend.completePlanSession('w3s2', newKeys);
  assert.equal(state.planId, null);
  assert.equal(state.finished.at(-1).planId, 'premium');
});

test('reiniciar la demo no vuelve a importar el historial de versiones anteriores', async () => {
  store.clear();
  store.set('padelfit:activities', JSON.stringify([{ type: 'entreno', date: new Date().toISOString(), seconds: 600 }]));
  const backend = new LocalBackend();
  await backend.init();
  await backend.createProfile({ name: 'Primera', level: 2 });
  assert.equal((await backend.getMyActivities()).length, 1);
  await backend.signOut();
  await backend.createProfile({ name: 'Segunda', level: 2 });
  assert.equal((await backend.getMyActivities()).length, 0);
});
