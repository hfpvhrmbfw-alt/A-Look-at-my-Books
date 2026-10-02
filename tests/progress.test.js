'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Progress = require('../js/progress.js');

const empty = () => ({ unit: 'page', page: null, percent: null, chapter: null, chapterCount: null, startDate: null, endDate: null, log: [] });

test('Seite ist führend: Prozent wird über die Seitenzahl abgeleitet', () => {
  assert.deepEqual(Progress.derive({ unit: 'page', value: 104 }, 416), { page: 104, percent: 25, chapter: null });
  assert.deepEqual(Progress.derive({ unit: 'page', value: 500 }, 416), { page: 416, percent: 100, chapter: null });
  assert.deepEqual(Progress.derive({ unit: 'page', value: 50 }, null), { page: 50, percent: null, chapter: null });
});

test('Prozent ist führend (E-Book ohne Seiten), Seite nur mit Seitenzahl', () => {
  assert.deepEqual(Progress.derive({ unit: 'percent', value: 38 }, null), { page: null, percent: 38, chapter: null });
  assert.deepEqual(Progress.derive({ unit: 'percent', value: 50 }, 300), { page: 150, percent: 50, chapter: null });
  assert.equal(Progress.derive({ unit: 'percent', value: 130 }).percent, 100);
});

test('Kapitel ist führend: Prozent über die Kapitelanzahl', () => {
  assert.deepEqual(Progress.derive({ unit: 'chapter', value: 3, chapterCount: 12 }, 240), { page: 60, percent: 25, chapter: 3 });
  assert.deepEqual(Progress.derive({ unit: 'chapter', value: 3 }), { page: null, percent: null, chapter: 3 });
});

test('record schreibt Stand, Verlauf (ein Eintrag pro Tag) und Startdatum', () => {
  const p = empty();
  Progress.record(p, { unit: 'page', value: 40, date: '2026-10-01' }, 400);
  Progress.record(p, { unit: 'page', value: 60, date: '2026-10-03' }, 400);
  Progress.record(p, { unit: 'page', value: 80, date: '2026-10-03' }, 400);
  assert.equal(p.startDate, '2026-10-01');
  assert.equal(p.page, 80);
  assert.equal(p.percent, 20);
  assert.deepEqual(p.log.map((e) => [e.date, e.page]), [['2026-10-01', 40], ['2026-10-03', 80]]);
  assert.equal(Progress.lastReadAt(p), '2026-10-03');
});

test('Restdauer aus dem Lesetempo', () => {
  const p = empty();
  Progress.record(p, { unit: 'percent', value: 10, date: '2026-10-01' });
  assert.equal(Progress.estimateDaysLeft(p), null, 'ein Eintrag ohne früheres Startdatum reicht nicht');
  Progress.record(p, { unit: 'percent', value: 30, date: '2026-10-05' });
  // 20 % in 4 Tagen = 5 %/Tag, 70 % fehlen -> 14 Tage
  assert.equal(Progress.estimateDaysLeft(p), 14);
});

test('Restdauer nutzt ein früheres Startdatum als 0 %', () => {
  const p = empty();
  p.startDate = '2026-09-21';
  Progress.record(p, { unit: 'page', value: 100, date: '2026-10-01' }, 200);
  // 50 % in 10 Tagen -> 5 %/Tag, 50 % fehlen -> 10 Tage
  assert.equal(Progress.estimateDaysLeft(p, 200), 10);
});

test('Gelesen: 100 %, letzte Seite, Enddatum vorbelegt aber überschreibbar', () => {
  const p = empty();
  Progress.record(p, { unit: 'page', value: 120, date: '2026-09-01' }, 300);
  Progress.markRead(p, 300, '2026-10-02');
  assert.equal(p.percent, 100);
  assert.equal(p.page, 300);
  assert.equal(p.endDate, '2026-10-02');
  assert.equal(Progress.percentOf(p, 300), 100);
  const q = empty();
  Progress.markRead(q, null);
  assert.equal(q.endDate, Progress.today());
  assert.equal(q.startDate, q.endDate);
});

test('Prozent wird nachträglich abgeleitet, wenn die Seitenzahl später bekannt ist', () => {
  const p = empty();
  Progress.record(p, { unit: 'page', value: 50, date: '2026-10-01' }, null);
  assert.equal(p.percent, null);
  assert.equal(Progress.percentOf(p, 200), 25);
  assert.equal(Progress.describe(p, 200), 'S. 50 von 200 · 25 %');
});

test('today liefert lokales Datum', () => {
  assert.equal(Progress.today(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});
