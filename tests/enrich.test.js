'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sources = require('../js/sources.js');
const Enrich = require('../js/enrich.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

/** Ersetzt fetch: Antworten je nach URL, zählt Aufrufe. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [pattern, reply] of routes) {
      if (url.includes(pattern)) {
        if (reply instanceof Error) throw reply;
        if (typeof reply === 'number') return { ok: false, status: reply, text: async () => '' };
        return { ok: true, status: 200, text: async () => reply };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  fn.calls = calls;
  return fn;
}

function memoryCache() {
  const data = new Map();
  return { get: (k) => data.get(k), set: (k, v) => data.set(k, v), data };
}

/* ---------- Umwandeln der Quellen ---------- */

test('DNB (MARC21): Werk und Ausgabe getrennt, Einband, Auflage, Seiten', () => {
  const [c] = Sources.parseDnb(fixture('dnb-kairos.xml'));
  assert.equal(c.source, 'dnb');
  assert.deepEqual(c.work.authors, ['Jenny Erpenbeck']);
  assert.equal(c.work.title, 'Kairos');
  assert.equal(c.work.subtitle, 'Roman');
  assert.deepEqual(c.work.genres, ['Roman', 'Berlin & DDR']);
  assert.equal(c.edition.isbn13, '9783630877396');
  assert.equal(c.edition.publisher, 'Penguin Verlag');
  assert.equal(c.edition.year, 2021);
  assert.equal(c.edition.printing, '1. Auflage');
  assert.equal(c.edition.binding, 'Hardcover');
  assert.equal(c.edition.pages, 411);
  assert.equal(c.edition.language, 'Deutsch');
  assert.equal(c.work.year, undefined, 'Erscheinungsjahr der Ausgabe ist nicht das Werkjahr');
});

test('DNB: Übersetzung mit Originaltitel, Originalsprache, Übersetzer, Reihe, ISBD-Zeichen', () => {
  const [c] = Sources.parseDnb(fixture('dnb-translation.xml'));
  assert.equal(c.work.title, 'Per Anhalter durch die Galaxis');
  assert.equal(c.work.subtitle, 'Roman');
  assert.equal(c.work.originalTitle, "The hitchhiker's guide to the galaxy");
  assert.equal(c.work.originalLanguage, 'Englisch');
  assert.deepEqual(c.work.authors, ['Douglas Adams']);
  assert.equal(c.work.series, 'Rowohlt-Taschenbuch');
  assert.equal(c.work.seriesNumber, '22667');
  assert.deepEqual(c.edition.translators, ['Benjamin Schwarz']);
  assert.equal(c.edition.forewordBy, 'Max Muster');
  assert.equal(c.edition.isbn10, '3499226677');
  assert.equal(c.edition.publisher, 'Rowohlt');
  assert.equal(c.edition.binding, 'Paperback');
});

test('Google Books: Beschreibung ohne HTML, Jahr zur Ausgabe, https-Cover', () => {
  const [c] = Sources.parseGoogle(JSON.parse(fixture('google-kairos.json')));
  assert.equal(c.work.description, 'Berlin, 1986: Eine junge Frau und ein älterer Mann.');
  assert.equal(c.edition.year, 2021);
  assert.equal(c.work.year, undefined);
  assert.equal(c.edition.language, 'Deutsch');
  assert.deepEqual(c.work.genres, ['Fiction', 'Literary']);
  assert.match(c.coverUrl, /^https:\/\/books\.google\.com/);
  assert.doesNotMatch(c.coverUrl, /edge=curl/);
});

test('Open Library: Ausgabe mit Einband, Sprache und Cover', () => {
  const c = Sources.parseOpenLibraryEdition(JSON.parse(fixture('ol-edition-kairos.json')));
  assert.equal(c.edition.binding, 'Hardcover');
  assert.equal(c.edition.language, 'Deutsch');
  assert.equal(c.coverUrl, 'https://covers.openlibrary.org/b/id/12345-M.jpg');
  assert.equal(c.workKey, '/works/OL1W');
});

/* ---------- Zusammenführen ---------- */

const candidates = () => [
  ...Sources.parseDnb(fixture('dnb-kairos.xml')),
  ...Sources.parseGoogle(JSON.parse(fixture('google-kairos.json'))),
  Object.assign(Sources.parseOpenLibraryEdition(JSON.parse(fixture('ol-edition-kairos.json'))), { work: { title: 'Kairos', year: 2021, authors: ['Jenny Erpenbeck'] } }),
];

test('Zusammenführen: eine Ausgabe pro ISBN, Quellen-Priorität je Feld, Alternativen', () => {
  const groups = Enrich.mergeCandidates(candidates());
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.deepEqual(g.sources.sort(), ['dnb', 'googlebooks', 'openlibrary']);
  // Ausgabe-Felder: DNB zuerst
  assert.equal(g.edition.publisher.value, 'Penguin Verlag');
  assert.equal(g.edition.publisher.source, 'dnb');
  assert.deepEqual(g.edition.publisher.alternatives.map((a) => a.value), ['Penguin', 'Penguin']);
  assert.equal(g.edition.pages.value, 411);
  assert.equal(g.edition.pages.alternatives[0].value, 416);
  // Beschreibung: Google zuerst; Werkjahr: Open Library
  assert.equal(g.work.description.source, 'googlebooks');
  assert.equal(g.work.year.source, 'openlibrary');
  // ISBN-10 wird ergänzt
  assert.equal(g.edition.isbn10.value, '3630877397');
  assert.equal(g.covers[0].source, 'dnb');
});

test('Vergleich: neu / abweichend / identisch, nur "neu" ist vorausgewählt', () => {
  const [g] = Enrich.mergeCandidates(candidates());
  const rows = Enrich.compare(g, {
    work: { title: 'Kairos', authors: [], subtitle: '' },
    edition: { publisher: 'Mein Verlag', pages: 411, isbn13: '9783630877396' },
  });
  const byField = Object.fromEntries(rows.map((r) => [`${r.scope}.${r.field}`, r]));
  assert.equal(byField['work.title'].status, 'identisch');
  assert.equal(byField['work.authors'].status, 'neu');
  assert.equal(byField['work.authors'].selected, true);
  assert.equal(byField['edition.publisher'].status, 'abweichend');
  assert.equal(byField['edition.publisher'].selected, false);
  assert.equal(byField['edition.pages'].status, 'identisch');
  assert.equal(byField['edition.pages'].selected, false);
});

test('Übernehmen: nur ausgewählte Felder, mit Quelle und Datum; manuelle Werte bleiben', () => {
  const [g] = Enrich.mergeCandidates(candidates());
  const work = { title: 'Kairos', authors: [], sources: { title: { source: 'manual', at: 'x' } } };
  const edition = { publisher: 'Mein Verlag', sources: { publisher: { source: 'manual', at: 'x' } } };
  const rows = Enrich.compare(g, { work, edition });
  Enrich.applyRows(rows, { work, edition }, '2026-10-02T12:00:00.000Z');
  assert.deepEqual(work.authors, ['Jenny Erpenbeck']);
  assert.deepEqual(work.sources.authors, { source: 'dnb', at: '2026-10-02T12:00:00.000Z' });
  assert.equal(edition.publisher, 'Mein Verlag', 'abweichender manueller Wert wird nicht überschrieben');
  assert.equal(edition.sources.publisher.source, 'manual');
  // ausdrücklich bestätigt -> wird übernommen
  rows.find((r) => r.field === 'publisher').selected = true;
  Enrich.applyRows(rows, { work, edition }, '2026-10-02T12:00:00.000Z');
  assert.equal(edition.publisher, 'Penguin Verlag');
  assert.equal(edition.sources.publisher.source, 'dnb');
});

test('Mehrdeutigkeit: die Ausgabe, die zu Verlag und Jahr passt, steht vorn', () => {
  const mk = (isbn13, publisher, year, binding) => ({
    source: 'googlebooks', sourceId: isbn13, uncertain: false, coverUrl: '',
    work: { title: 'Der Zauberberg', authors: ['Thomas Mann'] },
    edition: { isbn13, publisher, year, binding },
  });
  const groups = Enrich.mergeCandidates([
    mk('9783596294336', 'Fischer Taschenbuch', 1991, 'Taschenbuch'),
    mk('9783100483218', 'S. Fischer', 2002, 'Hardcover'),
    mk('9783596904266', 'Fischer Klassik', 2012, 'Taschenbuch'),
  ]);
  const ranked = Enrich.rankEditions(groups, { title: 'Der Zauberberg', author: 'Mann', publisher: 'S. Fischer', year: 2002 });
  assert.equal(ranked[0].edition.isbn13.value, '9783100483218');
  assert.ok(ranked[0].match.reasons.includes('Verlag'));
  assert.ok(ranked[0].match.reasons.includes('Jahr'));
});

test('Besondere Ausgaben werden erkannt', () => {
  assert.equal(Enrich.detectSpecial({ title: 'Kairos', author: 'X' }).special, false);
  assert.equal(Enrich.detectSpecial({ title: 'Faust', year: 1923 }).special, true);
  const r = Enrich.detectSpecial({ title: 'Faust', isbn: '', printing: 'Sonderausgabe zum Jubiläum' });
  assert.equal(r.special, true);
  assert.ok(r.reasons.includes('keine ISBN'));
  assert.ok(r.reasons.some((x) => /Sonderausgabe/.test(x)));
  assert.equal(Enrich.detectSpecial({ isbn: '9783630877396', kinds: ['signiert'] }).special, true);
});

/* ---------- Abfrage mit gemockten Quellen ---------- */

const kairosRoutes = () => [
  ['services.dnb.de', fixture('dnb-kairos.xml')],
  ['googleapis.com', fixture('google-kairos.json')],
  ['openlibrary.org/isbn/', fixture('ol-edition-kairos.json')],
  ['openlibrary.org/search.json', JSON.stringify({ docs: [{ title: 'Kairos', author_name: ['Jenny Erpenbeck'], first_publish_year: 2021 }] })],
  ['openlibrary.org/works/', JSON.stringify({ description: { value: 'Werkbeschreibung' } })],
];

test('lookup mit nur einer ISBN liefert Vorschläge für die fehlenden Felder', async () => {
  const fetch = mockFetch(kairosRoutes());
  const r = await Enrich.lookup({ isbn: '978-3-630-87739-6' }, { fetch, cache: memoryCache() });
  assert.equal(r.strategy, 'isbn');
  assert.deepEqual(r.errors, []);
  assert.equal(r.editions.length, 1);
  const rows = Enrich.compare(r.editions[0], { work: {}, edition: { isbn13: '9783630877396' } });
  const fields = rows.filter((x) => x.status === 'neu').map((x) => x.field);
  for (const f of ['title', 'authors', 'description', 'publisher', 'pages', 'binding', 'language']) {
    assert.ok(fields.includes(f), `Vorschlag für ${f}`);
  }
  assert.ok(r.editions[0].match.reasons.includes('ISBN'));
});

test('lookup: Ausfall einer Quelle wird gemeldet, die anderen liefern weiter', async () => {
  const routes = kairosRoutes();
  routes[0] = ['services.dnb.de', new TypeError('Failed to fetch')];
  routes[1] = ['googleapis.com', 429];
  const r = await Enrich.lookup({ isbn: '9783630877396' }, { fetch: mockFetch(routes) });
  assert.equal(r.editions.length, 1);
  assert.deepEqual(r.editions[0].sources, ['openlibrary']);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors.find((e) => e.source === 'dnb').message, /nicht erreichbar/);
  assert.match(r.errors.find((e) => e.source === 'googlebooks').message, /zu viele Anfragen/);
});

test('lookup: Zeitüberschreitung wird abgefangen', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const r = await Enrich.lookup({ isbn: '9783630877396' }, {
    fetch: mockFetch([['services.dnb.de', abort], ['googleapis.com', abort], ['openlibrary.org', abort]]),
  });
  assert.equal(r.editions.length, 0);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0].message, /Zeitüberschreitung/);
});

test('lookup: Ergebnisse werden zwischengespeichert', async () => {
  const fetch = mockFetch(kairosRoutes());
  const cache = memoryCache();
  await Enrich.lookup({ isbn: '9783630877396' }, { fetch, cache, now: 1000 });
  const first = fetch.calls.length;
  await Enrich.lookup({ isbn: '9783630877396' }, { fetch, cache, now: 2000 });
  assert.equal(fetch.calls.length, first, 'kein zweiter Abruf');
  await Enrich.lookup({ isbn: '9783630877396' }, { fetch, cache, now: 1000 + Enrich.CACHE_TTL_MS + 1 });
  assert.ok(fetch.calls.length > first, 'nach Ablauf wird neu abgefragt');
});

test('lookup mit Titel + Autor liefert eine Trefferliste mehrerer Ausgaben', async () => {
  const google = { items: [
    { id: 'a', volumeInfo: { title: 'Der Zauberberg', authors: ['Thomas Mann'], publisher: 'Fischer Taschenbuch', publishedDate: '1991', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9783596294336' }] } },
    { id: 'b', volumeInfo: { title: 'Der Zauberberg', authors: ['Thomas Mann'], publisher: 'S. Fischer', publishedDate: '2002', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9783100483218' }] } },
  ] };
  const fetch = mockFetch([['googleapis.com', JSON.stringify(google)]]);
  const r = await Enrich.lookup({ title: 'Der Zauberberg', author: 'Thomas Mann', publisher: 'S. Fischer' }, { fetch, sources: ['googlebooks'] });
  assert.equal(r.strategy, 'title');
  assert.equal(r.editions.length, 2);
  assert.equal(r.editions[0].edition.publisher.value, 'S. Fischer');
  assert.match(decodeURIComponent(fetch.calls[0]), /intitle:Der Zauberberg inauthor:Thomas Mann/);
});

test('lookup: besondere Ausgabe wird zusätzlich gezielt gesucht und als weniger sicher markiert', async () => {
  const fetch = mockFetch([['services.dnb.de', fixture('dnb-translation.xml')]]);
  const r = await Enrich.lookup({ title: 'Per Anhalter durch die Galaxis', publisher: 'Rowohlt', year: 1969, printing: 'Erstausgabe' }, { fetch, sources: ['dnb'] });
  assert.equal(r.special.special, true);
  assert.ok(r.editions.length >= 1);
  assert.ok(r.editions.every((e) => e.uncertain));
  assert.ok(fetch.calls.some((u) => decodeURIComponent(u).includes('jhr=1969')));
});
