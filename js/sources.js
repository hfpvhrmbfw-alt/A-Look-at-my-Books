/*
  Metadaten-Quellen: Abfragen und Umwandeln in ein gemeinsames Format.

  Quellen (alle ohne Pflicht-Key, direkt aus dem Browser abrufbar):
    dnb         – Deutsche Nationalbibliothek, SRU-Schnittstelle (MARC21-XML).
                  Beste Quelle für deutschsprachige Ausgaben: Auflage, Einband, Übersetzer:in.
                  Hinweis: Erlaubt der Dienst keine Browser-Anfragen (CORS), wird er übersprungen.
    googlebooks – Google Books API; gute Beschreibungen und Cover. Optionaler API-Key aus den
                  Einstellungen (nur im Browser gespeichert), sonst geteiltes Kontingent.
    openlibrary – Open Library (Internet Archive); trennt selbst Werk und Ausgabe, liefert
                  das Erstveröffentlichungsjahr des Werks und Cover.

  Gemeinsames Format eines Treffers (Kandidat):
    { source, sourceId, work: {…Werk-Felder}, edition: {…Ausgabe-Felder}, coverUrl, uncertain }
  Werk- und Ausgabe-Felder werden hier getrennt, auch wenn eine Quelle sie mischt.

  Die Umwandlung (parse…) ist reine Logik und getestet; die Abfragen bekommen `fetch` übergeben,
  damit Tests die Quellen ersetzen können. Browser: window.Sources, Node: require.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Sources = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LABELS = { dnb: 'DNB', googlebooks: 'Google Books', openlibrary: 'Open Library' };
  const TIMEOUT_MS = 10000;

  /* ---------- kleine Helfer ---------- */

  const LANGUAGES = {
    ger: 'Deutsch', deu: 'Deutsch', de: 'Deutsch',
    eng: 'Englisch', en: 'Englisch',
    fre: 'Französisch', fra: 'Französisch', fr: 'Französisch',
    spa: 'Spanisch', es: 'Spanisch',
    ita: 'Italienisch', it: 'Italienisch',
    rus: 'Russisch', ru: 'Russisch',
    pol: 'Polnisch', pl: 'Polnisch',
    dut: 'Niederländisch', nld: 'Niederländisch', nl: 'Niederländisch',
    swe: 'Schwedisch', sv: 'Schwedisch',
    nor: 'Norwegisch', no: 'Norwegisch', nob: 'Norwegisch',
    dan: 'Dänisch', da: 'Dänisch',
    jpn: 'Japanisch', ja: 'Japanisch',
    chi: 'Chinesisch', zho: 'Chinesisch', zh: 'Chinesisch',
    por: 'Portugiesisch', pt: 'Portugiesisch',
    lat: 'Latein', la: 'Latein',
    grc: 'Altgriechisch', gre: 'Griechisch', ell: 'Griechisch', el: 'Griechisch',
    heb: 'Hebräisch', he: 'Hebräisch',
    tur: 'Türkisch', tr: 'Türkisch',
    cze: 'Tschechisch', ces: 'Tschechisch', cs: 'Tschechisch',
    hun: 'Ungarisch', hu: 'Ungarisch',
    fin: 'Finnisch', fi: 'Finnisch',
    ara: 'Arabisch', ar: 'Arabisch',
    kor: 'Koreanisch', ko: 'Koreanisch',
  };

  function language(code) {
    const c = String(code || '').toLowerCase().replace(/^\/languages\//, '').trim();
    return c ? (LANGUAGES[c] || c) : '';
  }

  /** Erstes vierstelliges Jahr in einem Text, z. B. "[2021]" oder "March 3, 2021". */
  function year(text) {
    const m = String(text || '').match(/(1[4-9]|20)\d{2}/);
    return m ? Number(m[0]) : null;
  }

  /** Erste Zahl in einem Text, z. B. "416 Seiten" -> 416. */
  function firstNumber(text) {
    const m = String(text || '').match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  /** Satzzeichen am Ende entfernen (MARC/ISBD: " /", " :", " ;", " ="). */
  function trimPunct(text) {
    return String(text || '')
      .replace(/[\u0098\u009c]/g, '') // Nichtsortierzeichen der DNB
      .replace(/[\s/:;,=.]+$/, '')
      .trim();
  }

  /** "Erpenbeck, Jenny" -> "Jenny Erpenbeck" (mehrteilige Vornamen bleiben erhalten). */
  function personName(name) {
    const n = trimPunct(name);
    const m = n.match(/^([^,]+),\s*(.+)$/);
    return m ? `${m[2]} ${m[1]}` : n;
  }

  function uniq(list) {
    const seen = new Set();
    return list.filter((x) => {
      const k = String(x).toLowerCase();
      if (!x || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function cleanIsbn(text) {
    return String(text || '').toUpperCase().replace(/[^0-9X]/g, '');
  }

  /** ISBN-10 und -13 aus einer Liste roher ISBNs. */
  function isbns(list) {
    const out = { isbn10: '', isbn13: '' };
    for (const raw of list) {
      const s = cleanIsbn(raw);
      if (s.length === 13 && !out.isbn13) out.isbn13 = s;
      if (s.length === 10 && !out.isbn10) out.isbn10 = s;
    }
    return out;
  }

  /** Einbandart aus Freitext (DNB 020 $c, Open Library physical_format). */
  function binding(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return '';
    if (/klappenbroschur/.test(t)) return 'Klappenbroschur';
    if (/leinen|ln\./.test(t)) return 'Leinen';
    if (/festeinband|gb\.|pp\.|hardcover|hard cover|gebunden|hardback/.test(t)) return 'Hardcover';
    if (/taschenbuch|mass market|pocket/.test(t)) return 'Taschenbuch';
    if (/paperback|softcover|kart|kt\.|broschur|brosch/.test(t)) return 'Paperback';
    if (/e-?book|epub|kindle|online|electronic/.test(t)) return '';
    return '';
  }

  function emptyCandidate(source, sourceId) {
    return {
      source,
      sourceId: String(sourceId || ''),
      work: {},
      edition: {},
      coverUrl: '',
      uncertain: false,
    };
  }

  /** Leere Werte entfernen, damit ein Kandidat nur echte Angaben enthält. */
  function compact(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      out[k] = v;
    }
    return out;
  }

  /* ====================================================================
     Google Books
     ==================================================================== */

  function parseGoogleItem(item) {
    const v = (item && item.volumeInfo) || {};
    const c = emptyCandidate('googlebooks', item && item.id);
    const ids = isbns((v.industryIdentifiers || []).map((x) => x.identifier));
    c.work = compact({
      title: v.title || '',
      subtitle: v.subtitle || '',
      authors: v.authors || [],
      description: v.description ? v.description.replace(/<[^>]+>/g, '').trim() : '',
      genres: uniq((v.categories || []).flatMap((x) => x.split('/')).map((x) => x.trim())).slice(0, 5),
    });
    c.edition = compact({
      isbn10: ids.isbn10,
      isbn13: ids.isbn13,
      publisher: v.publisher || '',
      year: year(v.publishedDate),
      pages: v.pageCount > 0 ? v.pageCount : null,
      language: language(v.language),
    });
    const img = v.imageLinks || {};
    c.coverUrl = String(img.thumbnail || img.smallThumbnail || '').replace(/^http:/, 'https:').replace('&edge=curl', '');
    return c;
  }

  function parseGoogle(json) {
    return ((json && json.items) || []).map(parseGoogleItem);
  }

  function googleUrl(query, apiKey, max = 20) {
    const key = apiKey ? `&key=${encodeURIComponent(apiKey)}` : '';
    return `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${max}&printType=books${key}`;
  }

  /* ====================================================================
     Open Library
     ==================================================================== */

  /** Ausgabe aus /isbn/{isbn}.json bzw. /works/…/editions.json. */
  function parseOpenLibraryEdition(json) {
    const c = emptyCandidate('openlibrary', json && json.key);
    if (!json || typeof json !== 'object') return c;
    const ids = isbns([...(json.isbn_13 || []), ...(json.isbn_10 || [])]);
    const roles = (json.contributors || []).reduce((acc, x) => {
      const r = String(x.role || '').toLowerCase();
      if (/transl|übers/.test(r)) acc.translators.push(x.name);
      else if (/edit|herausg/.test(r)) acc.editors.push(x.name);
      else if (/illustr/.test(r)) acc.illustrators.push(x.name);
      return acc;
    }, { translators: [], editors: [], illustrators: [] });
    c.work = compact({
      title: json.title || '',
      subtitle: json.subtitle || '',
      originalTitle: json.translation_of || '',
      originalLanguage: language(((json.translated_from || [])[0] || {}).key),
      series: trimPunct(((json.series || [])[0] || '').replace(/\s*;\s*\d+.*$/, '')),
    });
    c.edition = compact({
      isbn10: ids.isbn10,
      isbn13: ids.isbn13,
      publisher: (json.publishers || [])[0] || '',
      year: year(json.publish_date),
      printing: json.edition_name || '',
      binding: binding(json.physical_format),
      pages: json.number_of_pages > 0 ? json.number_of_pages : null,
      language: language(((json.languages || [])[0] || {}).key),
      translators: roles.translators,
      editors: roles.editors,
      illustrators: roles.illustrators,
    });
    const cover = (json.covers || []).find((id) => id > 0);
    if (cover) c.coverUrl = `https://covers.openlibrary.org/b/id/${cover}-M.jpg`;
    c.workKey = ((json.works || [])[0] || {}).key || '';
    return c;
  }

  /** Werk-Angaben aus search.json (ein Dokument): Autor:innen, Erstveröffentlichung, Themen. */
  function parseOpenLibrarySearchDoc(doc) {
    return compact({
      title: doc.title || '',
      authors: doc.author_name || [],
      year: doc.first_publish_year || null,
      genres: uniq((doc.subject || []).filter((s) => s.length < 40)).slice(0, 5),
    });
  }

  /** Beschreibung aus einem Werk (/works/OL…W.json). */
  function parseOpenLibraryWork(json) {
    if (!json) return {};
    const d = json.description;
    return compact({
      description: typeof d === 'string' ? d : (d && d.value) || '',
      genres: uniq((json.subjects || []).filter((s) => s.length < 40)).slice(0, 5),
    });
  }

  /* ====================================================================
     Deutsche Nationalbibliothek (SRU, MARC21-XML)
     ==================================================================== */

  function decodeXml(text) {
    return String(text)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&amp;/g, '&');
  }

  /** Zerlegt MARC21-XML in Datensätze: [{ '245': [{a: [...], b: [...]}], ... }]. Ohne DOM, damit es auch in Node läuft. */
  function parseMarcRecords(xml) {
    const records = [];
    const recRe = /<(?:\w+:)?record\b[^>]*>([\s\S]*?)<\/(?:\w+:)?record>/g;
    let rm;
    while ((rm = recRe.exec(String(xml || '')))) {
      const fields = {};
      const fRe = /<(?:\w+:)?datafield\b[^>]*\btag="(\d{3})"[^>]*>([\s\S]*?)<\/(?:\w+:)?datafield>/g;
      let fm;
      while ((fm = fRe.exec(rm[1]))) {
        const sub = {};
        const sRe = /<(?:\w+:)?subfield\b[^>]*\bcode="(\w)"[^>]*>([\s\S]*?)<\/(?:\w+:)?subfield>/g;
        let sm;
        while ((sm = sRe.exec(fm[2]))) (sub[sm[1]] = sub[sm[1]] || []).push(decodeXml(sm[2]).trim());
        (fields[fm[1]] = fields[fm[1]] || []).push(sub);
      }
      const cRe = /<(?:\w+:)?controlfield\b[^>]*\btag="001"[^>]*>([\s\S]*?)<\/(?:\w+:)?controlfield>/;
      const cm = rm[1].match(cRe);
      fields._id = cm ? cm[1].trim() : '';
      if (Object.keys(fields).length > 1) records.push(fields);
    }
    return records;
  }

  function parseDnbRecord(r) {
    const c = emptyCandidate('dnb', r._id);
    const f = (tag) => r[tag] || [];
    const sf = (tag, code) => f(tag).flatMap((x) => x[code] || []);
    const first = (tag, code) => sf(tag, code)[0] || '';

    // Personen nach Rolle (Relator-Code in $4)
    const people = { aut: [], trl: [], edt: [], ill: [], aui: [], aft: [] };
    for (const p of [...f('100'), ...f('700')]) {
      const name = personName((p.a || [])[0]);
      const roles = p['4'] || (p === f('100')[0] ? ['aut'] : []);
      for (const role of roles) {
        const key = role.replace(/^.*\//, '');
        if (people[key]) people[key].push(name);
      }
      if (!p['4'] && p !== f('100')[0] && /übers/i.test((p.e || []).join(' '))) people.trl.push(name);
    }
    if (f('100').length && !people.aut.length) people.aut.push(personName(first('100', 'a')));

    // Originaltitel: 246 mit $i "Originaltitel" oder Fußnote 500 "Originaltitel: …"
    let originalTitle = '';
    for (const t of f('246')) {
      if (/original/i.test((t.i || []).join(' '))) originalTitle = trimPunct((t.a || [])[0]);
    }
    if (!originalTitle) {
      const note = sf('500', 'a').find((n) => /^Originaltitel/i.test(n));
      if (note) originalTitle = trimPunct(note.replace(/^Originaltitel\s*:?\s*/i, ''));
    }
    if (!originalTitle) originalTitle = trimPunct(first('240', 'a'));

    const imprint = f('264').length ? '264' : '260';
    const isbnFields = f('020');
    const ids = isbns(isbnFields.flatMap((x) => [...(x.a || []), ...(x['9'] || [])]));
    const bindingText = isbnFields.flatMap((x) => [...(x.c || []), ...(x.q || [])]).join(' ');
    const title = trimPunct(first('245', 'a'));
    const part = [first('245', 'n'), first('245', 'p')].map(trimPunct).filter(Boolean).join(' ');
    const seriesField = f('490')[0] || f('830')[0];
    const langs = sf('041', 'a');

    c.work = compact({
      title: part ? `${title}. ${part}` : title,
      subtitle: trimPunct(first('245', 'b')),
      authors: uniq(people.aut),
      originalTitle,
      originalLanguage: language(first('041', 'h')),
      description: first('520', 'a'),
      genres: uniq([...sf('655', 'a'), ...sf('689', 'a')].map(trimPunct)).slice(0, 5),
      series: seriesField ? trimPunct((seriesField.a || [])[0]) : '',
      seriesNumber: seriesField ? trimPunct((seriesField.v || [])[0]).replace(/^(Bd\.|Band)\s*/i, '') : '',
    });
    c.edition = compact({
      isbn10: ids.isbn10,
      isbn13: ids.isbn13,
      publisher: trimPunct(first(imprint, 'b')),
      year: year(first(imprint, 'c')),
      printing: trimPunct(first('250', 'a')),
      binding: binding(bindingText),
      pages: firstNumber(first('300', 'a')),
      language: language(langs[0]),
      translators: uniq(people.trl),
      editors: uniq(people.edt),
      illustrators: uniq(people.ill),
      forewordBy: uniq([...people.aui, ...people.aft]).join('; '),
    });
    // Kein Cover von der DNB: portal.dnb.de erlaubt das Herunterladen im Browser nicht (CORS,
    // auf dem iPhone mit cors-check.html geprüft). Cover kommen von Google Books und Open Library.
    return c;
  }

  function parseDnb(xml) {
    return parseMarcRecords(xml).map(parseDnbRecord);
  }

  /** CQL-Wert in Anführungszeichen (für Titel/Personen mit Leerzeichen). */
  function cql(text) {
    return `"${String(text).replace(/["\\]/g, ' ').trim()}"`;
  }

  function dnbUrl(query, max = 20) {
    return 'https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve' +
      `&query=${encodeURIComponent(query)}&recordSchema=MARC21-xml&maximumRecords=${max}`;
  }

  /* ====================================================================
     Abfragen (mit Timeout und verständlichen Fehlern)
     ==================================================================== */

  class SourceError extends Error {
    constructor(message, kind) {
      super(message);
      this.kind = kind; // 'timeout' | 'ratelimit' | 'blocked' | 'http' | 'parse'
    }
  }

  /** fetch mit Timeout; wirft SourceError mit deutscher Meldung. */
  async function getText(fetchFn, url, timeoutMs = TIMEOUT_MS) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
    } catch (err) {
      if (err && err.name === 'AbortError') throw new SourceError('antwortet nicht (Zeitüberschreitung)', 'timeout');
      throw new SourceError('nicht erreichbar (offline oder vom Browser blockiert)', 'blocked');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 429) throw new SourceError('zu viele Anfragen, bitte später erneut versuchen', 'ratelimit');
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`Fehler ${res.status}`, 'http');
    return res.text();
  }

  async function getJson(fetchFn, url) {
    const text = await getText(fetchFn, url);
    if (text == null) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new SourceError('unerwartete Antwort', 'parse');
    }
  }

  /**
   * Suchanfrage an eine Quelle.
   *   query = { isbn } oder { title, author, publisher, year }
   *   opts  = { fetch, apiKey }
   * Ergebnis: Liste von Kandidaten (leer, wenn nichts gefunden).
   */
  const QUERIES = {
    async googlebooks(query, { fetch, apiKey }) {
      let q;
      if (query.isbn) q = `isbn:${query.isbn}`;
      else {
        q = [
          query.title && `intitle:${query.title}`,
          query.author && `inauthor:${query.author}`,
          query.publisher && `inpublisher:${query.publisher}`,
        ].filter(Boolean).join(' ');
      }
      const json = await getJson(fetch, googleUrl(q, apiKey, query.isbn ? 5 : 20));
      return parseGoogle(json);
    },

    async openlibrary(query, { fetch }) {
      if (query.isbn) {
        const edition = await getJson(fetch, `https://openlibrary.org/isbn/${query.isbn}.json`);
        if (!edition) return [];
        const c = parseOpenLibraryEdition(edition);
        // Werk-Angaben: Autor:innen, Erstveröffentlichung, Beschreibung
        const [search, work] = await Promise.all([
          getJson(fetch, `https://openlibrary.org/search.json?isbn=${query.isbn}&fields=title,author_name,first_publish_year,subject&limit=1`).catch(() => null),
          c.workKey ? getJson(fetch, `https://openlibrary.org${c.workKey}.json`).catch(() => null) : null,
        ]);
        const doc = search && search.docs && search.docs[0];
        if (doc) {
          const w = parseOpenLibrarySearchDoc(doc);
          c.work = Object.assign({}, w, c.work, { title: c.work.title || w.title });
          // Werktitel weicht vom Ausgabentitel ab: vermutlich Originaltitel (weniger sicher)
          if (doc.title && c.work.title && doc.title !== c.work.title && !c.work.originalTitle) {
            c.work.originalTitle = doc.title;
          }
        }
        Object.assign(c.work, Object.assign(parseOpenLibraryWork(work), c.work));
        return [c];
      }
      // Titel/Autor: Werke suchen, dann die Ausgaben der besten Werke holen
      const params = [
        query.title && `title=${encodeURIComponent(query.title)}`,
        query.author && `author=${encodeURIComponent(query.author)}`,
      ].filter(Boolean).join('&');
      const search = await getJson(fetch, `https://openlibrary.org/search.json?${params}&fields=key,title,author_name,first_publish_year,subject&limit=3`);
      const docs = ((search && search.docs) || []).slice(0, 2);
      const lists = await Promise.all(docs.map(async (doc) => {
        const eds = await getJson(fetch, `https://openlibrary.org${doc.key}/editions.json?limit=30`).catch(() => null);
        const w = parseOpenLibrarySearchDoc(doc);
        return ((eds && eds.entries) || []).map((e) => {
          const c = parseOpenLibraryEdition(e);
          c.work = Object.assign({}, w, c.work);
          return c;
        });
      }));
      return lists.flat();
    },

    async dnb(query, { fetch }) {
      let q;
      if (query.isbn) q = `num=${query.isbn}`;
      else {
        q = [
          query.title && `tit=${cql(query.title)}`,
          query.author && `per=${cql(query.author)}`,
          query.publisher && `vlg=${cql(query.publisher)}`,
          query.year && `jhr=${Number(query.year)}`,
        ].filter(Boolean).join(' and ');
      }
      const xml = await getText(fetch, dnbUrl(q));
      return xml ? parseDnb(xml) : [];
    },
  };

  return {
    LABELS, QUERIES, SourceError,
    // für Tests und Wiederverwendung
    language, year, binding, personName, trimPunct,
    parseGoogle, parseGoogleItem, parseOpenLibraryEdition, parseOpenLibrarySearchDoc,
    parseOpenLibraryWork, parseMarcRecords, parseDnb, dnbUrl, googleUrl,
  };
});
