/*
  Metadaten-Anreicherung: Quellen abfragen, Treffer zusammenführen, mit den eigenen
  Angaben vergleichen und Ausgaben nach Passung sortieren.

  Grundsätze:
  - Vorschlag statt Überschreiben: Ergebnis ist eine Liste von Feldern mit Status
    neu / abweichend / identisch. Nur "neu" ist vorausgewählt; manuelle Werte werden
    nie ohne Bestätigung ersetzt.
  - Werk und Ausgabe bleiben getrennt (siehe sources.js).
  - Fällt eine Quelle aus, geht es mit den anderen weiter; Fehler werden gesammelt.
  - Ergebnisse werden zwischengespeichert, damit nicht jedes Öffnen neue Anfragen auslöst.

  Reine Logik bis auf `lookup`, das fetch und Cache übergeben bekommt.
  Browser: window.Enrich, Node: require.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./isbn.js'), require('./sources.js'));
  } else {
    root.Enrich = factory(root.Isbn, root.Sources);
  }
})(typeof self !== 'undefined' ? self : this, function (Isbn, Sources) {
  'use strict';

  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

  // Felder, die vorgeschlagen werden können, mit Beschriftung
  const WORK_FIELDS = {
    title: 'Titel',
    subtitle: 'Untertitel',
    authors: 'Autor:in',
    originalTitle: 'Originaltitel',
    originalLanguage: 'Originalsprache',
    year: 'Erscheinungsjahr des Werks',
    series: 'Reihe',
    seriesNumber: 'Band',
    genres: 'Genres/Themen',
    description: 'Beschreibung',
  };
  const EDITION_FIELDS = {
    isbn13: 'ISBN-13',
    isbn10: 'ISBN-10',
    publisher: 'Verlag',
    year: 'Erscheinungsjahr der Ausgabe',
    printing: 'Auflage',
    binding: 'Einband',
    pages: 'Seitenzahl',
    language: 'Sprache der Ausgabe',
    translators: 'Übersetzer:in',
    editors: 'Herausgeber:in',
    illustrators: 'Illustrator:in',
    forewordBy: 'Vor-/Nachwort von',
  };

  // Welche Quelle bei welchem Feld zuerst zählt (die DNB kennt deutsche Ausgaben am besten,
  // Google Books hat meist die besten Beschreibungen, Open Library das Werkjahr)
  const DEFAULT_ORDER = ['dnb', 'openlibrary', 'googlebooks'];
  const FIELD_ORDER = {
    'work.description': ['googlebooks', 'openlibrary', 'dnb'],
    'work.year': ['openlibrary', 'dnb', 'googlebooks'],
    'work.genres': ['dnb', 'googlebooks', 'openlibrary'],
  };

  /* ---------- Vergleich ---------- */

  function norm(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(norm).filter(Boolean).sort().join('|');
    return String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9|]+/g, ' ')
      .trim();
  }

  function isEmpty(value) {
    return value == null || value === '' || (Array.isArray(value) && value.length === 0);
  }

  function sameValue(a, b) {
    return norm(a) === norm(b);
  }

  /** Ähnlichkeit zweier Texte: enthält einer den anderen (z. B. "Penguin" in "Penguin Verlag")? */
  function similar(a, b) {
    const x = norm(a);
    const y = norm(b);
    return Boolean(x && y && (x.includes(y) || y.includes(x)));
  }

  /* ---------- Zusammenführen ---------- */

  /** Schlüssel einer Ausgabe: ISBN-13, sonst Titel + Verlag + Jahr. */
  function editionKey(c) {
    const e = c.edition || {};
    const isbn13 = e.isbn13 || (e.isbn10 ? Isbn.to13(e.isbn10) : '') || '';
    if (isbn13) return 'isbn:' + isbn13;
    return 'x:' + [norm((c.work || {}).title), norm(e.publisher), e.year || ''].join('/');
  }

  /**
   * Führt Kandidaten verschiedener Quellen zu Ausgaben zusammen.
   * Ergebnis je Ausgabe: { key, sources, work: {feld: Vorschlag}, edition: {feld: Vorschlag},
   *   covers: [{url, source}], uncertain }, Vorschlag = { value, source, alternatives }.
   */
  function mergeCandidates(candidates) {
    const groups = new Map();
    for (const c of candidates) {
      const key = editionKey(c);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    return [...groups.entries()].map(([key, list]) => {
      const merged = { key, sources: [...new Set(list.map((c) => c.source))], work: {}, edition: {}, covers: [], uncertain: list.some((c) => c.uncertain) };
      for (const scope of ['work', 'edition']) {
        const fields = scope === 'work' ? WORK_FIELDS : EDITION_FIELDS;
        for (const field of Object.keys(fields)) {
          const order = FIELD_ORDER[`${scope}.${field}`] || DEFAULT_ORDER;
          const values = list
            .filter((c) => !isEmpty((c[scope] || {})[field]))
            .sort((a, b) => rank(order, a.source) - rank(order, b.source))
            .map((c) => ({ value: c[scope][field], source: c.source }));
          if (!values.length) continue;
          const alternatives = values.slice(1).filter((v) => !sameValue(v.value, values[0].value));
          merged[scope][field] = { value: values[0].value, source: values[0].source, alternatives };
        }
      }
      // ISBN ergänzen, wenn nur eine Form bekannt ist
      const e = merged.edition;
      if (e.isbn10 && !e.isbn13 && Isbn.to13(e.isbn10.value)) {
        e.isbn13 = { value: Isbn.to13(e.isbn10.value), source: e.isbn10.source, alternatives: [] };
      }
      if (e.isbn13 && !e.isbn10 && Isbn.to10(e.isbn13.value)) {
        e.isbn10 = { value: Isbn.to10(e.isbn13.value), source: e.isbn13.source, alternatives: [] };
      }
      for (const c of list.slice().sort((a, b) => rank(DEFAULT_ORDER, a.source) - rank(DEFAULT_ORDER, b.source))) {
        if (c.coverUrl && !merged.covers.some((x) => x.url === c.coverUrl)) merged.covers.push({ url: c.coverUrl, source: c.source });
      }
      return merged;
    });
  }

  function rank(order, source) {
    const i = order.indexOf(source);
    return i === -1 ? order.length : i;
  }

  /* ---------- Passung zu meinen Eingaben ---------- */

  /**
   * Bewertet, wie gut eine Ausgabe zu meinen Angaben passt (ISBN, Verlag, Jahr, Einband,
   * Sprache, Titel, Autor:in). Ergebnis: { score, reasons } – reasons als Text für die Anzeige.
   */
  function matchEdition(group, input) {
    let score = 0;
    const reasons = [];
    const ed = group.edition;
    const w = group.work;
    const val = (x) => (x ? x.value : null);
    const inputIsbn = input.isbn ? Isbn.parse(input.isbn) : null;
    if (inputIsbn && inputIsbn.valid && inputIsbn.isbn13 && val(ed.isbn13) === inputIsbn.isbn13) {
      score += 100;
      reasons.push('ISBN');
    }
    if (input.title && similar(val(w.title), input.title)) { score += 10; reasons.push('Titel'); }
    if (input.author && (val(w.authors) || []).some((a) => similar(a, input.author))) { score += 10; reasons.push('Autor:in'); }
    if (input.publisher && similar(val(ed.publisher), input.publisher)) { score += 30; reasons.push('Verlag'); }
    if (input.year && val(ed.year)) {
      const diff = Math.abs(Number(input.year) - val(ed.year));
      if (diff === 0) { score += 20; reasons.push('Jahr'); } else if (diff === 1) score += 8;
      else score -= Math.min(15, diff);
    }
    if (input.binding && sameValue(val(ed.binding), input.binding)) { score += 10; reasons.push('Einband'); }
    if (input.language && sameValue(val(ed.language), input.language)) { score += 5; reasons.push('Sprache'); }
    // Vollständigere Datensätze leicht bevorzugen
    score += Math.min(5, Object.keys(ed).length / 2) + group.sources.length;
    return { score, reasons };
  }

  /** Sortiert Ausgaben nach Passung (beste zuerst) und hängt `match` an. */
  function rankEditions(groups, input) {
    return groups
      .map((g) => Object.assign({}, g, { match: matchEdition(g, input) }))
      .sort((a, b) => b.match.score - a.match.score);
  }

  /* ---------- Besondere Ausgaben ---------- */

  const SPECIAL_WORDS = /sonderausgabe|erstausgabe|erste auflage|1\.\s*aufl|limitiert|nummeriert|signiert|reprint|nachdruck|faksimile|lizenzausgabe|schmuckausgabe|vorzugsausgabe|jubiläumsausgabe|antiquar/i;

  /**
   * Deuten die Eingaben auf eine Sonder-, Sammler- oder Altausgabe hin?
   * input: { isbn, year, printing, publisherSeries, notes, kinds, title }
   */
  function detectSpecial(input) {
    const reasons = [];
    if (!input.isbn) reasons.push('keine ISBN');
    if (input.year && Number(input.year) < 1970) reasons.push('erschienen vor Einführung der ISBN');
    if ((input.kinds || []).length) reasons.push('als besondere Ausgabe markiert');
    const text = [input.printing, input.publisherSeries, input.notes, input.title].join(' ');
    const m = text.match(SPECIAL_WORDS);
    if (m) reasons.push(`Hinweis „${m[0]}“`);
    // Ohne ISBN allein ist ein Buch noch nicht besonders (z. B. nur Titel + Autor eingegeben)
    const special = reasons.some((r) => r !== 'keine ISBN');
    return { special, reasons: special ? reasons : [] };
  }

  /* ---------- Vergleich mit meinen Angaben ---------- */

  /**
   * Vergleicht eine Ausgabe mit den aktuellen Werten.
   * current = { work: {...}, edition: {...} }
   * Ergebnis: Zeilen { scope, field, label, current, value, source, alternatives, status, selected }.
   * status: 'neu' (bei mir leer), 'abweichend', 'identisch'. Vorausgewählt ist nur 'neu'.
   */
  function compare(group, current) {
    const rows = [];
    for (const [scope, fields] of [['work', WORK_FIELDS], ['edition', EDITION_FIELDS]]) {
      for (const [field, label] of Object.entries(fields)) {
        const proposal = group[scope][field];
        if (!proposal) continue;
        const cur = ((current || {})[scope] || {})[field];
        const status = isEmpty(cur) ? 'neu' : sameValue(cur, proposal.value) ? 'identisch' : 'abweichend';
        rows.push({
          scope, field, label,
          current: cur,
          value: proposal.value,
          source: proposal.source,
          alternatives: proposal.alternatives,
          status,
          selected: status === 'neu',
        });
      }
    }
    return rows;
  }

  /**
   * Übernimmt ausgewählte Zeilen in Werk/Ausgabe und vermerkt die Herkunft
   * (Quelle + Abrufdatum). Nicht ausgewählte Zeilen bleiben unberührt.
   */
  function applyRows(rows, targets, at = new Date().toISOString()) {
    for (const row of rows) {
      if (!row.selected) continue;
      const entity = targets[row.scope];
      if (!entity) continue;
      entity[row.field] = Array.isArray(row.value) ? row.value.slice() : row.value;
      entity.sources = entity.sources || {};
      entity.sources[row.field] = { source: row.source, at };
    }
    return targets;
  }

  /* ---------- Abfrage mit Cache und Fallback ---------- */

  function cacheKey(source, query) {
    return `${source}:${JSON.stringify(query)}`;
  }

  /**
   * Sucht Metadaten.
   *   input: Angaben vom Einband { isbn, title, author, publisher, year, binding, language,
   *          printing, publisherSeries, notes, kinds }
   *   opts:  { fetch, cache: {get,set}, sources: ['dnb', …], apiKey, now }
   * Ergebnis: { editions (nach Passung sortiert), errors: [{source, message}], special, strategy }
   */
  async function lookup(input, opts) {
    const sources = (opts.sources || DEFAULT_ORDER).filter((s) => Sources.QUERIES[s]);
    const now = opts.now || Date.now();
    const errors = [];
    const parsedIsbn = input.isbn ? Isbn.parse(input.isbn) : null;
    const isbn = parsedIsbn && parsedIsbn.valid ? parsedIsbn.isbn13 || parsedIsbn.isbn10 : '';
    const special = detectSpecial(Object.assign({}, input, { isbn }));

    async function ask(source, query) {
      const key = cacheKey(source, query);
      const hit = opts.cache && opts.cache.get(key);
      if (hit && now - hit.at < CACHE_TTL_MS) return hit.candidates;
      try {
        const candidates = await Sources.QUERIES[source](query, { fetch: opts.fetch, apiKey: opts.apiKey });
        if (opts.cache) opts.cache.set(key, { at: now, candidates });
        return candidates;
      } catch (err) {
        errors.push({ source, message: `${Sources.LABELS[source] || source}: ${err.message || 'Fehler'}` });
        return [];
      }
    }
    const askAll = async (query, list = sources) => (await Promise.all(list.map((s) => ask(s, query)))).flat();

    let candidates = [];
    let strategy = '';
    // 1. ISBN ist der sicherste Treffer
    if (isbn) {
      strategy = 'isbn';
      candidates = await askAll({ isbn });
      // Nur Treffer mit genau dieser ISBN zählen
      const isbn13 = parsedIsbn.isbn13;
      candidates = candidates.filter((c) => !isbn13 || editionKey(c) === 'isbn:' + isbn13 || !c.edition.isbn13);
    }
    // 2. sonst (oder ohne Treffer) Titel + Autor, eingegrenzt durch Verlag/Jahr
    if (!candidates.length && (input.title || input.author)) {
      strategy = strategy ? 'isbn+title' : 'title';
      const query = { title: input.title || '', author: input.author || '' };
      candidates = await askAll(query);
      if (input.publisher || input.year) {
        // Gezielt nach der Ausgabe suchen (DNB kann nach Verlag und Jahr filtern)
        const narrow = await askAll(Object.assign({}, query, { publisher: input.publisher || '', year: input.year || '' }), sources.filter((s) => s === 'dnb'));
        candidates = candidates.concat(narrow);
      }
    }
    // 3. Besondere Ausgabe: zusätzlich gezielt nach Ausgabe-Details suchen, als weniger sicher markieren
    if (special.special) {
      if (input.title && (input.publisher || input.year) && strategy !== 'title') {
        const extra = await askAll({ title: input.title, author: input.author || '', publisher: input.publisher || '', year: input.year || '' }, sources.filter((s) => s === 'dnb'));
        candidates = candidates.concat(extra);
      }
      candidates = candidates.map((c) => Object.assign({}, c, { uncertain: true }));
    }

    const editions = rankEditions(mergeCandidates(candidates), Object.assign({}, input, { isbn }));
    return { editions, errors, special, strategy };
  }

  return {
    WORK_FIELDS, EDITION_FIELDS, CACHE_TTL_MS,
    norm, sameValue, mergeCandidates, matchEdition, rankEditions, detectSpecial, compare, applyRows, lookup,
  };
});
