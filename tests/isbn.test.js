'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Isbn = require('../js/isbn.js');

test('bereinigt Bindestriche, Leerzeichen und Präfix', () => {
  assert.equal(Isbn.clean('ISBN 978-3-423-21412-4'), '9783423214124');
  assert.equal(Isbn.clean(' 3-499-22667-x '), '349922667X');
  assert.equal(Isbn.clean('ISBN-13: 978 0 306 40615 7'), '9780306406157');
});

test('prüft ISBN-10 inkl. Prüfziffer X', () => {
  assert.equal(Isbn.isValid10('0-306-40615-2'), true);
  assert.equal(Isbn.isValid10('0-306-40615-3'), false);
  assert.equal(Isbn.isValid10('080442957X'), true);
  assert.equal(Isbn.isValid10('0804429570'), false);
  assert.equal(Isbn.isValid10('12345'), false);
});

test('prüft ISBN-13', () => {
  assert.equal(Isbn.isValid13('978-0-306-40615-7'), true);
  assert.equal(Isbn.isValid13('978-0-306-40615-8'), false);
  assert.equal(Isbn.isValid13('9791034304080'), true);
  assert.equal(Isbn.isValid13('1234567890123'), false); // kein 978/979
});

test('rechnet ISBN-10 in ISBN-13 um und zurück', () => {
  assert.equal(Isbn.to13('0306406152'), '9780306406157');
  assert.equal(Isbn.to13('080442957X'), '9780804429573');
  assert.equal(Isbn.to10('9780306406157'), '0306406152');
  assert.equal(Isbn.to10('9780804429573'), '080442957X');
});

test('979er ISBN hat keine ISBN-10', () => {
  assert.equal(Isbn.to10('9791034304080'), null);
  assert.deepEqual(Isbn.parse('979-10-343-0408-0'), {
    valid: true, isbn10: '', isbn13: '9791034304080', error: '',
  });
});

test('ungültige Eingaben liefern null bzw. verständliche Fehler', () => {
  assert.equal(Isbn.to13('0306406153'), null);
  assert.equal(Isbn.to10('9780306406158'), null);
  assert.match(Isbn.parse('0306406153').error, /Prüfziffer/);
  assert.match(Isbn.parse('12345').error, /10 oder 13 Stellen/);
  assert.match(Isbn.parse('1234567890123').error, /978 oder 979/);
  assert.match(Isbn.parse('03064A6152').error, /9 Ziffern/);
});

test('parse liefert beide Formen', () => {
  assert.deepEqual(Isbn.parse('3-499-22667-X').valid, Isbn.isValid10('349922667X'));
  const r = Isbn.parse('0-306-40615-2');
  assert.equal(r.valid, true);
  assert.equal(r.isbn10, '0306406152');
  assert.equal(r.isbn13, '9780306406157');
  assert.deepEqual(Isbn.parse(''), { valid: true, isbn10: '', isbn13: '', error: '' });
});
