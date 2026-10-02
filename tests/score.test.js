'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Score = require('../js/score.js');

const entry = (priority, criteria = {}) => ({ priority, criteria });

test('ohne Angaben kein Score', () => {
  assert.equal(Score.compute(entry(null)), null);
  assert.equal(Score.compute(entry(null, { anticipation: null })), null);
});

test('nur Priorität: Score = Priorität', () => {
  assert.equal(Score.compute(entry(4)), 4);
  assert.equal(Score.compute(entry(1)), 1);
});

test('gewichteter Mittelwert mit Standardgewichten', () => {
  // (5*50 + 3*20 + 1*15 + 5*10 + (6-1)*5) / 100 = (250+60+15+50+25)/100 = 4.0
  assert.equal(Score.compute(entry(5, { anticipation: 3, urgency: 1, mood: 5, effort: 1 })), 4);
  // (2*50 + 5*20) / 70 = 200/70 = 2.857 -> 2.9
  assert.equal(Score.compute(entry(2, { anticipation: 5 })), 2.9);
});

test('hoher Aufwand senkt, geringer Aufwand hebt den Score', () => {
  const easy = Score.compute(entry(3, { effort: 1 }));
  const hard = Score.compute(entry(3, { effort: 5 }));
  assert.ok(easy > hard);
  // (3*50 + 1*5)/55 = 2.818 -> 2.8
  assert.equal(hard, 2.8);
});

test('Gewichte sind anpassbar; Gewicht 0 schaltet ein Kriterium ab', () => {
  const e = entry(1, { anticipation: 5 });
  assert.equal(Score.compute(e, { priority: 1, anticipation: 1 }), 3);
  assert.equal(Score.compute(e, { priority: 0, anticipation: 10 }), 5);
  assert.equal(Score.compute(entry(4), { priority: 0 }), null);
});

test('ungültige Werte werden ignoriert, finalRating zählt nicht', () => {
  assert.equal(Score.compute({ priority: 7, criteria: { anticipation: 4 }, finalRating: 1 }), 4);
  assert.equal(Score.compute({ priority: '5', criteria: {} }), null);
});
