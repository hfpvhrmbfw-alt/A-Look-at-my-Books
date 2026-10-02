'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../js/model.js');
const Isbn = require('../js/isbn.js');

/** Kleiner Ersatz für localStorage. */
function memoryStorage(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

const v1Books = [
  {
    id: 'a1', title: 'Der Zauberberg', author: 'Thomas Mann', status: 'read', rating: 5,
    notes: 'Langsam, aber lohnend', addedAt: '2026-01-05T10:00:00.000Z',
    isbn: '', genre: '', pages: null, startDate: null, endDate: null, coverUrl: '',
  },
  {
    id: 'a2', title: 'Kairos', author: 'Jenny Erpenbeck', status: 'want', rating: 4,
    notes: '', addedAt: '2026-02-01T10:00:00.000Z',
    isbn: '978-3-630-87739-6', genre: 'Roman, DDR', pages: 416, startDate: null, endDate: null, coverUrl: '',
  },
  {
    id: 'a3', title: 'Altes Buch', author: 'Anonym', status: 'reading', rating: 0,
    notes: 'Notiz', addedAt: '2026-03-01T10:00:00.000Z', isbn: '123', pages: null,
  },
];

test('Migration übernimmt alle Bücher mit Titel, Autor, Notizen und Datum', () => {
  const state = Model.migrateV1(v1Books, Isbn.parse);
  assert.equal(state.version, 2);
  assert.equal(state.entries.length, 3);
  assert.equal(state.works.length, 3);
  const [e1, e2, e3] = state.entries;
  assert.equal(e1.id, 'a1');
  assert.equal(Model.resolve(state, e1).work.title, 'Der Zauberberg');
  assert.deepEqual(Model.resolve(state, e1).work.authors, ['Thomas Mann']);
  assert.equal(e1.notes, 'Langsam, aber lohnend');
  assert.equal(e1.addedAt, '2026-01-05T10:00:00.000Z');
  assert.equal(e3.notes.startsWith('Notiz'), true);
  assert.equal(e2.ownership, null, 'Besitzformat war in v1 nicht erfasst');
});

test('Migration bildet Status und Sterne ab', () => {
  const [e1, e2, e3] = Model.migrateV1(v1Books, Isbn.parse).entries;
  assert.equal(e1.status, 'read');
  assert.equal(e1.finalRating, 5);
  assert.equal(e1.priority, null);
  assert.equal(e1.progress.percent, 100);
  assert.equal(e2.status, 'backlog');
  assert.equal(e2.priority, 4);
  assert.equal(e2.finalRating, null);
  assert.equal(e3.status, 'reading');
  assert.equal(e3.priority, null, '0 Sterne = keine Angabe');
});

test('Migration legt eine Ausgabe für ISBN und Seiten an und trennt Werk-Felder', () => {
  const state = Model.migrateV1(v1Books, Isbn.parse);
  const { work, editions } = Model.resolve(state, state.entries[1]);
  assert.deepEqual(work.genres, ['Roman', 'DDR']);
  assert.equal(editions.length, 1);
  assert.equal(editions[0].isbn13, '9783630877396');
  assert.equal(editions[0].isbn10, '3630877397');
  assert.equal(editions[0].pages, 416);
  assert.equal(editions[0].sources.isbn13.source, 'manual');
  assert.equal(Model.resolve(state, state.entries[0]).editions.length, 0);
});

test('ungültige ISBN aus v1 geht nicht verloren', () => {
  const state = Model.migrateV1(v1Books, Isbn.parse);
  const e3 = state.entries[2];
  assert.match(e3.notes, /ISBN \(aus alter Version, ungültig\): 123/);
  assert.equal(Model.resolve(state, e3).editions[0].isbn13, '');
});

test('loadFromStorage migriert v1 einmalig und lässt v1 als Sicherung liegen', () => {
  const original = JSON.stringify(v1Books);
  const storage = memoryStorage({ [Model.KEYS.v1]: original });
  const first = Model.loadFromStorage(storage, Isbn.parse);
  assert.equal(first.migrated, true);
  assert.equal(first.state.entries.length, 3);
  assert.equal(storage.data[Model.KEYS.v1], original);
  assert.ok(storage.data[Model.KEYS.v2]);

  const second = Model.loadFromStorage(storage, Isbn.parse);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.state, first.state);
});

test('leerer Speicher ergibt leeren Zustand', () => {
  const { state, migrated } = Model.loadFromStorage(memoryStorage(), Isbn.parse);
  assert.equal(migrated, false);
  assert.deepEqual(state.entries, []);
  assert.equal(state.settings.weights.priority, 50);
});

test('normalizeState ergänzt fehlende Felder und verwirft kaputte Einträge', () => {
  const state = Model.normalizeState({
    works: [{ id: 'w1', title: 'X' }, null],
    editions: [{ id: 'ed1', workId: 'w1', special: { condition: 'gut' } }],
    entries: [
      { id: 'e1', workId: 'w1', status: 'gibtsnicht', editionIds: ['ed1', 'weg'], progress: { page: 12 } },
      { id: 'e2', workId: 'fehlt' },
    ],
    settings: { weights: { priority: 70 } },
  });
  assert.equal(state.entries.length, 1);
  const e = state.entries[0];
  assert.equal(e.status, 'backlog');
  assert.deepEqual(e.editionIds, ['ed1']);
  assert.equal(e.progress.page, 12);
  assert.deepEqual(e.progress.log, []);
  assert.equal(state.editions[0].special.condition, 'gut');
  assert.deepEqual(state.editions[0].special.kinds, []);
  assert.equal(state.settings.weights.priority, 70);
  assert.equal(state.settings.weights.anticipation, 20);
});
