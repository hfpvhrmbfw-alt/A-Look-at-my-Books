/*
  Import und Export der Büchersammlung.
    JSON – vollständig (Werke, Ausgaben, Einträge, Einstellungen, Cover als Daten-URLs);
           zum Sichern und Umziehen auf ein anderes Gerät. Der API-Key wird nie exportiert.
    CSV  – flache Tabelle (eine Zeile pro Buch, Trennzeichen ";") zum Ansehen in Excel/Numbers.
  Beim Import werden Bücher hinzugefügt; Einträge, Werke und Ausgaben mit bereits
  vorhandener ID bleiben unverändert (nichts wird überschrieben).
  "Backup wiederherstellen" ersetzt dagegen den ganzen Bestand (replaceState).
  Reine Logik ohne DOM (Browser: window.Transfer, Node: require).
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'), require('./isbn.js'), require('./score.js'), require('./progress.js'));
  } else {
    root.Transfer = factory(root.Model, root.Isbn, root.Score, root.Progress);
  }
})(typeof self !== 'undefined' ? self : this, function (Model, Isbn, Score, Progress) {
  'use strict';

  const APP = 'buecher-tracker';

  /** Export-Objekt (ohne API-Key). covers: { id: dataURL }. */
  function exportJson(state, covers = {}, now = new Date()) {
    const data = JSON.parse(JSON.stringify(state));
    data.settings = Object.assign({}, data.settings, { googleApiKey: '' });
    const used = new Set([...data.works, ...data.editions].map((x) => x.coverId).filter(Boolean));
    const coverData = {};
    for (const [id, url] of Object.entries(covers)) if (used.has(id)) coverData[id] = url;
    return { app: APP, version: Model.VERSION, exportedAt: now.toISOString(), data, covers: coverData };
  }

  /**
   * Liest eine Export-Datei. Akzeptiert den eigenen Export, einen rohen v2-Zustand
   * oder die Liste der alten Version 1. Ergebnis: { state, covers } oder Fehler mit deutscher Meldung.
   */
  function parseImport(text) {
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error('Die Datei ist kein gültiges JSON.');
    }
    if (Array.isArray(json)) return { state: Model.migrateV1(json, Isbn.parse), covers: {} };
    if (json && json.app === APP && json.data) {
      if (json.version > Model.VERSION) throw new Error('Die Datei stammt aus einer neueren Version der App.');
      return { state: Model.normalizeState(json.data), covers: json.covers || {} };
    }
    if (json && Array.isArray(json.entries) && Array.isArray(json.works)) {
      return { state: Model.normalizeState(json), covers: {} };
    }
    throw new Error('Die Datei enthält keine Büchersammlung.');
  }

  /**
   * Fügt importierte Bücher hinzu. Vorhandene IDs werden übersprungen.
   * Ergebnis: { state, added, skipped } – `state` ist ein neues Objekt.
   */
  function mergeStates(current, imported) {
    const out = JSON.parse(JSON.stringify(current));
    const has = (list, id) => list.some((x) => x.id === id);
    let added = 0;
    let skipped = 0;
    for (const w of imported.works) if (!has(out.works, w.id)) out.works.push(w);
    for (const e of imported.editions) if (!has(out.editions, e.id)) out.editions.push(e);
    for (const entry of imported.entries) {
      if (has(out.entries, entry.id)) { skipped++; continue; }
      out.entries.push(entry);
      added++;
    }
    return { state: out, added, skipped };
  }

  /**
   * Backup wiederherstellen: Der importierte Bestand ersetzt den aktuellen vollständig.
   * Der API-Key wird nie exportiert; deshalb bleibt der Key dieses Geräts erhalten.
   */
  function replaceState(current, imported) {
    const out = JSON.parse(JSON.stringify(imported));
    out.settings = Object.assign({}, out.settings, { googleApiKey: (current.settings && current.settings.googleApiKey) || '' });
    return out;
  }

  /* ---------- CSV ---------- */

  const CSV_COLUMNS = [
    'Titel', 'Untertitel', 'Autor:innen', 'Status', 'Besitzformat', 'Score', 'Priorität',
    'Fortschritt %', 'Begonnen', 'Beendet', 'Bewertung nach dem Lesen', 'ISBN-13', 'ISBN-10',
    'Verlag', 'Jahr der Ausgabe', 'Seiten', 'Einband/E-Book-Format', 'Reihe', 'Band',
    'Originaltitel', 'Genres', 'Tags', 'Notizen', 'Hinzugefügt',
  ];

  function csvCell(value) {
    const s = value == null ? '' : String(value);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** CSV mit ";" als Trennzeichen und BOM, damit Excel Umlaute richtig liest. */
  function exportCsv(state) {
    const lines = [CSV_COLUMNS.map(csvCell).join(';')];
    for (const entry of state.entries) {
      const { work, editions } = Model.resolve(state, entry);
      const ed = editions[0] || {};
      const pages = (editions.find((e) => e.pages) || {}).pages || null;
      const score = Score.compute(entry, state.settings.weights);
      const pct = Progress.percentOf(entry.progress, pages);
      const row = [
        work.title, work.subtitle, work.authors.join('; '),
        Model.STATUSES[entry.status] || entry.status,
        Model.OWNERSHIP[entry.ownership] || '',
        score == null ? '' : String(score).replace('.', ','),
        entry.priority || '',
        pct == null ? '' : String(Math.round(pct)),
        entry.progress.startDate || '', entry.progress.endDate || '',
        entry.finalRating || '',
        ed.isbn13 || '', ed.isbn10 || '', ed.publisher || '', ed.year || '', pages || '',
        ed.binding || ed.ebookFormat || '',
        work.series, work.seriesNumber, work.originalTitle,
        work.genres.join(', '), entry.tags.join(', '), entry.notes,
        (entry.addedAt || '').slice(0, 10),
      ];
      lines.push(row.map(csvCell).join(';'));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  return { exportJson, parseImport, mergeStates, replaceState, exportCsv, CSV_COLUMNS };
});
