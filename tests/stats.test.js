'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../js/stats.js');

const book = (id, fields = {}) => Object.assign({ id, title: id, pages: 300, status: 'reading', progress: { endDate: null, log: [] }, genres: [] }, fields);

test('Seiten je Tag: Zuwachs zum vorigen Eintrag, Prozent über die Seitenzahl', () => {
  const b = book('a', { pages: 400, progress: { log: [
    { date: '2026-11-01', page: 40 },
    { date: '2026-11-02', page: 100 },
    { date: '2026-11-04', percent: 50 },
  ] } });
  assert.deepEqual(Stats.pagesByDay([b]), { '2026-11-01': 40, '2026-11-02': 60, '2026-11-04': 100 });
});

test('Gelesen ohne Verlauf: alle Seiten am Enddatum; mit Verlauf nur der Rest', () => {
  const ohne = book('a', { status: 'read', pages: 250, progress: { endDate: '2026-03-10', log: [] } });
  const mit = book('b', { status: 'read', pages: 200, progress: { endDate: '2026-03-12', log: [{ date: '2026-03-11', page: 150 }] } });
  assert.deepEqual(Stats.pagesByDay([ohne, mit]), { '2026-03-10': 250, '2026-03-11': 150, '2026-03-12': 50 });
});

test('Zurückblättern zählt nicht negativ, mehrere Bücher am selben Tag werden addiert', () => {
  const a = book('a', { progress: { log: [{ date: '2026-01-01', page: 100 }, { date: '2026-01-02', page: 80 }, { date: '2026-01-03', page: 120 }] } });
  const b = book('b', { progress: { log: [{ date: '2026-01-03', page: 10 }] } });
  assert.deepEqual(Stats.pagesByDay([a, b]), { '2026-01-01': 100, '2026-01-03': 30 });
});

test('Zeitraum Monat, Woche, Jahr', () => {
  const byDay = { '2026-11-02': 10, '2026-11-10': 20, '2026-11-12': 5, '2026-10-31': 7 };
  const m = Stats.period(byDay, 'month', '2026-11-12');
  assert.equal(m.bars.length, 30);
  assert.equal(m.total, 35);
  assert.deepEqual(m.axis, ['1.', '10.', '20.', '30.']);
  const w = Stats.period(byDay, 'week', '2026-11-12'); // Donnerstag
  assert.equal(w.bars[0].key, '2026-11-09');
  assert.equal(w.total, 25);
  const y = Stats.period(byDay, 'year', '2026-11-12');
  assert.equal(y.bars.length, 12);
  assert.equal(y.bars[9].value, 7);
  assert.equal(y.bars[10].value, 35);
});

test('Lesetempo je Monat bis heute', () => {
  const t = Stats.tempo({ '2026-01-05': 31, '2026-02-01': 56, '2026-03-02': 20 }, '2026-03-10');
  assert.deepEqual(t, [1, 2, 2]);
});

test('Längste Serie: Tage am Stück', () => {
  const s = Stats.longestStreak({ '2026-01-30': 5, '2026-01-31': 5, '2026-02-01': 5, '2026-02-03': 9, '2026-02-04': 0 });
  assert.deepEqual(s, { days: 3, start: '2026-01-30', end: '2026-02-01' });
  assert.equal(Stats.longestStreak({}).days, 0);
});

test('Dickstes Buch und gelesene Bücher des Jahres', () => {
  const books = [
    book('a', { status: 'read', pages: 500, progress: { endDate: '2025-12-30' } }),
    book('b', { status: 'read', pages: 420, progress: { endDate: '2026-02-01' } }),
    book('c', { status: 'read', pages: 300, progress: { endDate: '2026-05-01' } }),
    book('d', { status: 'reading', pages: 900 }),
  ];
  assert.equal(Stats.readIn(books, 2026).length, 2);
  assert.equal(Stats.thickest(books, 2026).id, 'b');
  assert.equal(Stats.thickest(books, 2024), null);
});

test('Mappen: Lesejahr, Tags im Farbwechsel, Wunschliste; Einzelbücher entfallen', () => {
  const books = [
    book('a', { status: 'read', progress: { endDate: '2026-01-01' }, genres: ['Klassiker', 'Dystopie'] }),
    book('b', { status: 'read', progress: { endDate: '2026-04-01' }, genres: ['klassiker '] }),
    book('c', { status: 'read', progress: { endDate: '2025-04-01' }, genres: ['Western'] }),
    book('d', { status: 'backlog', genres: ['Western'] }),
    book('e', { status: 'backlog', genres: ['Klassiker'] }),
  ];
  const f = Stats.folders(books);
  assert.deepEqual(f.map((x) => [x.kind, x.title, x.color, x.ids]), [
    ['year', '2026', 'tanne', ['a', 'b']],
    ['genre', 'Klassiker', 'accent', ['a', 'b', 'e']],
    ['genre', 'Western', 'himmel', ['c', 'd']],
    ['wish', 'Wunschliste', 'senf', ['d', 'e']],
  ]);
});
