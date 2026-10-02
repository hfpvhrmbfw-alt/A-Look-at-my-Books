'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../js/model.js');
const Transfer = require('../js/transfer.js');

function sampleState() {
  const s = Model.emptyState();
  const w = Model.createWork({ title: 'Kairos', authors: ['Jenny Erpenbeck'], genres: ['Roman'], coverId: 'c1' });
  const ed = Model.createEdition({ workId: w.id, isbn13: '9783630877396', publisher: 'Penguin', pages: 400, coverId: 'c1' });
  const e = Model.createEntry({ workId: w.id, editionIds: [ed.id], status: 'reading', ownership: 'print', priority: 4, notes: 'Zitat: "Zeit"; gut' });
  e.progress.page = 100;
  e.progress.unit = 'page';
  s.works.push(w);
  s.editions.push(ed);
  s.entries.push(e);
  s.settings.googleApiKey = 'GEHEIM';
  return s;
}

test('JSON-Export enthält alles außer dem API-Key, nur benutzte Cover', () => {
  const out = Transfer.exportJson(sampleState(), { c1: 'data:image/jpeg;base64,AAA', alt: 'data:x' }, new Date('2026-10-02T00:00:00Z'));
  assert.equal(out.app, 'buecher-tracker');
  assert.equal(out.version, 2);
  assert.equal(out.data.settings.googleApiKey, '');
  assert.equal(out.data.entries.length, 1);
  assert.deepEqual(Object.keys(out.covers), ['c1']);
});

test('JSON-Export und -Import ergeben wieder denselben Bestand', () => {
  const state = sampleState();
  const text = JSON.stringify(Transfer.exportJson(state));
  const { state: imported } = Transfer.parseImport(text);
  assert.deepEqual(imported.entries, state.entries);
  assert.deepEqual(imported.works, state.works);
  assert.deepEqual(imported.editions, state.editions);
});

test('Import akzeptiert auch die alte Version-1-Liste', () => {
  const { state } = Transfer.parseImport(JSON.stringify([{ id: 'x', title: 'Alt', author: 'A', status: 'want', rating: 0, notes: '', addedAt: '2026-01-01T00:00:00Z' }]));
  assert.equal(state.entries[0].status, 'backlog');
});

test('Import lehnt kaputte oder fremde Dateien verständlich ab', () => {
  assert.throws(() => Transfer.parseImport('{kaputt'), /kein gültiges JSON/);
  assert.throws(() => Transfer.parseImport('{"foo":1}'), /keine Büchersammlung/);
  assert.throws(() => Transfer.parseImport(JSON.stringify({ app: 'buecher-tracker', version: 99, data: {} })), /neueren Version/);
});

test('Zusammenführen fügt hinzu und überschreibt nichts', () => {
  const current = sampleState();
  const other = sampleState();
  other.entries[0].notes = 'geändert';
  const both = Transfer.mergeStates(current, { works: [...current.works, ...other.works], editions: other.editions, entries: [...current.entries, ...other.entries] });
  assert.equal(both.added, 1);
  assert.equal(both.skipped, 1);
  assert.equal(both.state.entries.length, 2);
  assert.equal(both.state.entries[0].notes, current.entries[0].notes);
  assert.equal(current.entries.length, 1, 'Original bleibt unverändert');
});

test('CSV: Kopfzeile, Semikolon, Anführungszeichen, BOM', () => {
  const csv = Transfer.exportCsv(sampleState());
  assert.ok(csv.startsWith('﻿Titel;Untertitel;'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^Kairos;;Jenny Erpenbeck;Lese gerade;Print;4;4;25;/);
  assert.match(lines[1], /;"Zitat: ""Zeit""; gut";/);
  assert.match(lines[1], /;9783630877396;;Penguin;;400;/);
});
