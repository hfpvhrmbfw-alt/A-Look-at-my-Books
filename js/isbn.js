/*
  ISBN-Hilfsfunktionen: bereinigen, Prüfziffer validieren, ISBN-10 <-> ISBN-13 umrechnen.
  Reine Logik ohne DOM, damit sie im Browser (als window.Isbn) und in Node-Tests
  (per require) gleich funktioniert.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Isbn = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Entfernt Bindestriche, Leerzeichen und ein vorangestelltes "ISBN"; x -> X. */
  function clean(input) {
    return String(input || '')
      .toUpperCase()
      .replace(/^\s*ISBN(-1[03])?:?\s*/, '')
      .replace(/[\s\-‐-―.]/g, '');
  }

  /** Prüfziffer einer ISBN-10 aus den ersten 9 Ziffern ('0'–'9' oder 'X'). */
  function checkDigit10(first9) {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (10 - i) * Number(first9[i]);
    const check = (11 - (sum % 11)) % 11;
    return check === 10 ? 'X' : String(check);
  }

  /** Prüfziffer einer ISBN-13 aus den ersten 12 Ziffern. */
  function checkDigit13(first12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (sum % 10)) % 10);
  }

  function isValid10(input) {
    const s = clean(input);
    if (!/^\d{9}[\dX]$/.test(s)) return false;
    return checkDigit10(s) === s[9];
  }

  function isValid13(input) {
    const s = clean(input);
    if (!/^97[89]\d{10}$/.test(s)) return false;
    return checkDigit13(s) === s[12];
  }

  /** ISBN-10 -> ISBN-13 (Präfix 978). Liefert null bei ungültiger Eingabe. */
  function to13(input) {
    const s = clean(input);
    if (!isValid10(s)) return null;
    const first12 = '978' + s.slice(0, 9);
    return first12 + checkDigit13(first12);
  }

  /** ISBN-13 -> ISBN-10. Nur für 978er ISBNs möglich, sonst null. */
  function to10(input) {
    const s = clean(input);
    if (!isValid13(s) || !s.startsWith('978')) return null;
    const first9 = s.slice(3, 12);
    return first9 + checkDigit10(first9);
  }

  /**
   * Wertet eine eingetippte ISBN aus.
   * Ergebnis: { valid, isbn10, isbn13, error } – error ist ein deutscher Hinweistext.
   * Leere Eingabe gilt als gültig (ISBN ist optional), mit isbn10/isbn13 = ''.
   */
  function parse(input) {
    const s = clean(input);
    if (!s) return { valid: true, isbn10: '', isbn13: '', error: '' };
    if (s.length === 10) {
      if (!/^\d{9}[\dX]$/.test(s)) return invalid('Eine ISBN-10 besteht aus 9 Ziffern und einer Prüfziffer (0–9 oder X).');
      if (!isValid10(s)) return invalid('Die Prüfziffer der ISBN-10 stimmt nicht. Bitte auf Tippfehler prüfen.');
      return { valid: true, isbn10: s, isbn13: to13(s), error: '' };
    }
    if (s.length === 13) {
      if (!/^\d{13}$/.test(s)) return invalid('Eine ISBN-13 besteht aus 13 Ziffern.');
      if (!/^97[89]/.test(s)) return invalid('Eine ISBN-13 beginnt mit 978 oder 979.');
      if (!isValid13(s)) return invalid('Die Prüfziffer der ISBN-13 stimmt nicht. Bitte auf Tippfehler prüfen.');
      return { valid: true, isbn10: to10(s) || '', isbn13: s, error: '' };
    }
    return invalid('Eine ISBN hat 10 oder 13 Stellen.');

    function invalid(error) { return { valid: false, isbn10: '', isbn13: '', error }; }
  }

  return { clean, isValid10, isValid13, to13, to10, parse };
});
