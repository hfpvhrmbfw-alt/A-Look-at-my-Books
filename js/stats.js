/*
  Lesestatistik und Album-Mappen aus den eigenen Daten.

  Eingabe sind einfache Buch-Objekte:
    { id, title, pages, status, progress: { endDate, log: [{ date, page, percent }] }, genres: [] }

  - Gelesene Seiten je Tag kommen aus dem Fortschrittsverlauf (Zuwachs zum vorigen Eintrag).
  - Ein gelesenes Buch ohne (vollständigen) Verlauf zählt die restlichen Seiten am Enddatum.
  - Eine Serie sind Tage am Stück mit gelesenen Seiten.

  Reine Logik ohne DOM (Browser: window.Stats, Node: require).
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const MONTHS_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  /* ---------- Datumshilfen (alles als 'YYYY-MM-DD', ohne Zeitzonen-Sprünge) ---------- */

  function parse(day) {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fmt(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function addDays(day, n) {
    return fmt(parse(day) + n * DAY);
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1–12
  }

  /* ---------- Seiten je Tag ---------- */

  function pageOf(entry, pages) {
    if (entry.page != null && entry.page !== '') return Number(entry.page) || 0;
    if (entry.percent != null && pages) return Math.round((Number(entry.percent) / 100) * pages);
    return null;
  }

  /** { 'YYYY-MM-DD': Seiten } über alle Bücher. */
  function pagesByDay(books) {
    const out = {};
    const add = (day, n) => {
      if (!day || !(n > 0)) return;
      out[day] = (out[day] || 0) + n;
    };
    for (const b of books) {
      const p = b.progress || {};
      const pages = Number(b.pages) || 0;
      let last = 0;
      for (const e of p.log || []) {
        const page = pageOf(e, pages);
        if (page == null) continue;
        add(e.date, page - last);
        last = Math.max(last, page);
      }
      if (b.status === 'read' && p.endDate && pages > last) add(p.endDate, pages - last);
    }
    return out;
  }

  /* ---------- Zeiträume für das Strichdiagramm ---------- */

  /**
   * Striche für einen Zeitraum, der `today` enthält.
   *   'month' – je Tag des Monats, 'week' – Mo bis So, 'year' – je Monat.
   * Ergebnis: { total, bars: [{ key, label, value }], axis: [Beschriftungen] }
   */
  function period(byDay, kind, today) {
    const [y, m] = today.split('-').map(Number);
    const bars = [];
    let axis;
    if (kind === 'year') {
      for (let i = 1; i <= 12; i++) {
        const prefix = `${y}-${String(i).padStart(2, '0')}-`;
        let v = 0;
        for (const [d, n] of Object.entries(byDay)) if (d.startsWith(prefix)) v += n;
        bars.push({ key: prefix.slice(0, 7), label: MONTHS_LONG[i - 1], value: v });
      }
      axis = 'JFMAMJJASOND'.split('');
    } else if (kind === 'week') {
      const wd = (new Date(parse(today)).getUTCDay() + 6) % 7; // Mo = 0
      const start = addDays(today, -wd);
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, i);
        bars.push({ key: d, label: `${WEEKDAYS[i]} ${Number(d.slice(8))}.`, value: byDay[d] || 0 });
      }
      axis = WEEKDAYS.slice();
    } else {
      const n = daysInMonth(y, m);
      for (let i = 1; i <= n; i++) {
        const d = `${y}-${String(m).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        bars.push({ key: d, label: `${i}. ${MONTHS[m - 1]}`, value: byDay[d] || 0 });
      }
      axis = ['1.', '10.', '20.', `${n}.`];
    }
    return { total: bars.reduce((s, b) => s + b.value, 0), bars, axis };
  }

  /** Lesetempo: Seiten je Tag für jeden Monat des Jahres bis einschließlich heute. */
  function tempo(byDay, today) {
    const [y, m, d] = today.split('-').map(Number);
    const out = [];
    for (let i = 1; i <= m; i++) {
      const prefix = `${y}-${String(i).padStart(2, '0')}-`;
      let v = 0;
      for (const [day, n] of Object.entries(byDay)) if (day.startsWith(prefix)) v += n;
      const days = i === m ? d : daysInMonth(y, i);
      out.push(Math.round((v / days) * 10) / 10);
    }
    return out;
  }

  /** Längste Serie: { days, start, end } (Tage am Stück mit gelesenen Seiten). */
  function longestStreak(byDay) {
    const days = Object.keys(byDay).filter((d) => byDay[d] > 0).sort();
    let best = { days: 0, start: null, end: null };
    let start = null;
    let len = 0;
    for (let i = 0; i < days.length; i++) {
      if (i && parse(days[i]) - parse(days[i - 1]) === DAY) len++;
      else { len = 1; start = days[i]; }
      if (len > best.days) best = { days: len, start, end: days[i] };
    }
    return best;
  }

  function readIn(books, year) {
    return books.filter((b) => b.status === 'read' && b.progress && String(b.progress.endDate || '').startsWith(String(year)));
  }

  /** Dickstes gelesene Buch des Jahres (oder null). */
  function thickest(books, year) {
    return readIn(books, year)
      .filter((b) => Number(b.pages) > 0)
      .sort((a, b) => b.pages - a.pages)[0] || null;
  }

  /* ---------- Album: Mappen ---------- */

  const FOLDER_COLORS = ['accent', 'himmel', 'senf', 'rose'];

  function norm(s) {
    return String(s).trim().toLocaleLowerCase('de');
  }

  /**
   * Mappen fürs Album: je Lesejahr (Tannengrün), je Tag/Genre (Farben im Wechsel),
   * eine für die Wunschliste. Mappen mit weniger als zwei Büchern entfallen.
   * Ergebnis: [{ key, kind: 'year'|'genre'|'wish', title, color, ids }]
   */
  function folders(books) {
    const years = new Map();
    const genres = new Map();
    const wish = [];
    for (const b of books) {
      const end = b.progress && b.progress.endDate;
      if (b.status === 'read' && end) {
        const y = end.slice(0, 4);
        if (!years.has(y)) years.set(y, []);
        years.get(y).push(b.id);
      }
      if (b.status === 'backlog') wish.push(b.id);
      const seen = new Set();
      for (const g of b.genres || []) {
        const k = norm(g);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        if (!genres.has(k)) genres.set(k, { title: String(g).trim(), ids: [] });
        genres.get(k).ids.push(b.id);
      }
    }
    const out = [];
    [...years.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .forEach(([y, ids]) => out.push({ key: 'year:' + y, kind: 'year', title: y, color: 'tanne', ids }));
    const tagged = [...genres.entries()]
      .filter(([, g]) => g.ids.length >= 2)
      .sort((a, b) => b[1].ids.length - a[1].ids.length || a[1].title.localeCompare(b[1].title, 'de'));
    tagged.forEach(([k, g], i) => out.push({ key: 'genre:' + k, kind: 'genre', title: g.title, color: FOLDER_COLORS[i % FOLDER_COLORS.length], ids: g.ids }));
    if (wish.length) out.push({ key: 'wish', kind: 'wish', title: 'Wunschliste', color: FOLDER_COLORS[tagged.length % FOLDER_COLORS.length], ids: wish });
    return out.filter((f) => f.ids.length >= 2);
  }

  return { MONTHS, MONTHS_LONG, addDays, pagesByDay, period, tempo, longestStreak, readIn, thickest, folders };
});
