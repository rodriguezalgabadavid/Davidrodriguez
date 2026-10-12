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
