'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Theme = require('../js/theme.js');

function memoryStorage() {
  const data = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

test('Schalter wechselt System → Hell → Dunkel → System', () => {
  assert.equal(Theme.next('system'), 'light');
  assert.equal(Theme.next('light'), 'dark');
  assert.equal(Theme.next('dark'), 'system');
  assert.equal(Theme.next('quatsch'), 'light');
});

test('System folgt dem Gerät, Hell und Dunkel sind fest', () => {
  assert.equal(Theme.resolve('system', true), 'dark');
  assert.equal(Theme.resolve('system', false), 'light');
  assert.equal(Theme.resolve('light', true), 'light');
  assert.equal(Theme.resolve('dark', false), 'dark');
  assert.equal(Theme.resolve(undefined, true), 'dark');
});

test('Wahl wird gespeichert; System entfernt den Eintrag', () => {
  const s = memoryStorage();
  assert.equal(Theme.load(s), 'system');
  Theme.save(s, 'dark');
  assert.equal(s.data[Theme.STORAGE_KEY], 'dark');
  assert.equal(Theme.load(s), 'dark');
  Theme.save(s, 'system');
  assert.equal(Theme.STORAGE_KEY in s.data, false);
  s.data[Theme.STORAGE_KEY] = 'pink';
  assert.equal(Theme.load(s), 'system');
});

test('Gesperrter Speicher führt nicht zu Fehlern', () => {
  const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); }, removeItem() { throw new Error('nope'); } };
  assert.equal(Theme.load(broken), 'system');
  assert.equal(Theme.save(broken, 'light'), 'light');
});
