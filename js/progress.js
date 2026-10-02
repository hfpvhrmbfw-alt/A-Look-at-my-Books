/*
  Lesefortschritt: Stand eintragen, ableiten, Verlauf, Restdauer.

  progress = {
    unit: 'page' | 'percent' | 'chapter',   // führende Eingabeart
    page, percent, chapter, chapterCount,
    startDate, endDate,                      // 'YYYY-MM-DD'
    log: [{ date, page, percent, chapter }]  // Lese-Einträge, ältester zuerst
  }
  Die führende Angabe wird gespeichert, die anderen werden soweit möglich abgeleitet
  (Seite <-> Prozent über die Seitenzahl der Ausgabe, Kapitel -> Prozent über die
  Kapitelanzahl). E-Books ohne feste Seiten nutzen Prozent bzw. Position.

  Reine Logik ohne DOM (Browser: window.Progress, Node: require).
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Progress = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UNITS = { page: 'Seite', percent: 'Prozent', chapter: 'Kapitel' };
  const DAY = 24 * 60 * 60 * 1000;

  function num(v) {
    const n = Number(v);
    return v === null || v === '' || v === undefined || !Number.isFinite(n) ? null : n;
  }
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const round1 = (n) => Math.round(n * 10) / 10;

  /** Heutiges Datum als 'YYYY-MM-DD' (lokale Zeit). */
  function today(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  /**
   * Leitet aus der führenden Angabe die übrigen ab.
   * Ergebnis: { page, percent, chapter } – nicht ableitbare Werte bleiben null.
   */
  function derive({ unit, value, chapterCount }, totalPages) {
    const pages = num(totalPages) > 0 ? num(totalPages) : null;
    const chapters = num(chapterCount) > 0 ? num(chapterCount) : null;
    const v = num(value);
    const out = { page: null, percent: null, chapter: null };
    if (v == null) return out;
    if (unit === 'page') {
      out.page = Math.max(0, Math.round(pages ? Math.min(v, pages) : v));
      if (pages) out.percent = round1(clamp((out.page / pages) * 100, 0, 100));
    } else if (unit === 'percent') {
      out.percent = round1(clamp(v, 0, 100));
      if (pages) out.page = Math.round((out.percent / 100) * pages);
    } else if (unit === 'chapter') {
      out.chapter = Math.max(0, Math.round(chapters ? Math.min(v, chapters) : v));
      if (chapters) out.percent = round1(clamp((out.chapter / chapters) * 100, 0, 100));
      if (chapters && pages) out.page = Math.round((out.percent / 100) * pages);
    }
    return out;
  }

  /**
   * Trägt einen neuen Stand ein: setzt die führende Einheit, leitet ab, hängt einen
   * Verlaufseintrag an (ein Eintrag pro Tag wird ersetzt) und setzt ggf. das Startdatum.
   * Ändert `progress` direkt und gibt es zurück.
   */
  function record(progress, { unit, value, chapterCount, date }, totalPages) {
    const day = date || today();
    if (chapterCount !== undefined) progress.chapterCount = num(chapterCount);
    const d = derive({ unit, value, chapterCount: progress.chapterCount }, totalPages);
    progress.unit = unit;
    Object.assign(progress, d);
    if (!progress.startDate || progress.startDate > day) progress.startDate = day;
    progress.log = (progress.log || []).filter((e) => e.date !== day);
    progress.log.push(Object.assign({ date: day }, d));
    progress.log.sort((a, b) => a.date.localeCompare(b.date));
    return progress;
  }

  /**
   * Prozent für die Anzeige: gespeicherter Wert, sonst aus Seite/Kapitel abgeleitet
   * (z. B. wenn die Seitenzahl erst nachträglich bekannt wurde).
   */
  function percentOf(progress, totalPages) {
    if (!progress) return null;
    const value = progress.unit === 'percent' ? progress.percent
      : progress.unit === 'chapter' ? progress.chapter : progress.page;
    const d = derive({ unit: progress.unit, value, chapterCount: progress.chapterCount }, totalPages);
    return d.percent != null ? d.percent : num(progress.percent);
  }

  /** Datum des letzten Lese-Eintrags (oder null). */
  function lastReadAt(progress) {
    const log = (progress && progress.log) || [];
    return log.length ? log[log.length - 1].date : null;
  }

  /**
   * Grobe Restdauer in Tagen aus dem bisherigen Tempo (Prozent pro Tag zwischen
   * Start bzw. erstem Eintrag und letztem Eintrag). null, wenn nicht schätzbar.
   */
  function estimateDaysLeft(progress, totalPages) {
    const pct = percentOf(progress, totalPages);
    if (pct == null || pct >= 100) return pct >= 100 ? 0 : null;
    const log = (progress.log || []).filter((e) => e.percent != null);
    if (!log.length) return null;
    const last = log[log.length - 1];
    // Ausgangspunkt: erster Eintrag, oder Startdatum mit 0 %, falls früher
    let from = { date: log[0].date, percent: log[0].percent };
    if (progress.startDate && progress.startDate < from.date) from = { date: progress.startDate, percent: 0 };
    const days = (Date.parse(last.date) - Date.parse(from.date)) / DAY;
    const gained = last.percent - from.percent;
    if (!(days > 0) || !(gained > 0)) return null;
    return Math.max(1, Math.ceil((100 - pct) / (gained / days)));
  }

  /**
   * Buch als gelesen markieren: 100 %, letzte Seite/Kapitel, Enddatum vorbelegen
   * (ein vorhandenes oder übergebenes Datum hat Vorrang).
   */
  function markRead(progress, totalPages, endDate) {
    progress.percent = 100;
    if (num(totalPages) > 0) progress.page = num(totalPages);
    if (num(progress.chapterCount) > 0) progress.chapter = num(progress.chapterCount);
    progress.endDate = endDate || progress.endDate || today();
    if (!progress.startDate) progress.startDate = progress.endDate;
    return progress;
  }

  /** Text für die Karte, z. B. "S. 120 von 416 · 29 %" oder "38 %". */
  function describe(progress, totalPages) {
    if (!progress) return '';
    const pct = percentOf(progress, totalPages);
    const parts = [];
    if (progress.unit === 'chapter' && progress.chapter != null) {
      parts.push(`Kapitel ${progress.chapter}` + (progress.chapterCount ? ` von ${progress.chapterCount}` : ''));
    } else if (progress.unit === 'page' && progress.page != null) {
      parts.push(`S. ${progress.page}` + (num(totalPages) > 0 ? ` von ${totalPages}` : ''));
    }
    if (pct != null) parts.push(`${String(Math.round(pct))} %`);
    return parts.join(' · ');
  }

  return { UNITS, today, derive, record, percentOf, lastReadAt, estimateDaysLeft, markRead, describe };
});
