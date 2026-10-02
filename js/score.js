/*
  Score für "Was lese ich als Nächstes?".

  Eingaben (jeweils 1–5, alle optional):
    priority      – Gesamtpriorität
    anticipation  – Vorfreude
    urgency       – Aktualität/Zeitdruck
    effort        – Umfang/Aufwand (1 = leicht, 5 = aufwendig); geringer Aufwand zählt positiv
    mood          – passt zur Stimmung
  Der Score ist der gewichtete Mittelwert der vorhandenen Angaben (1–5, eine Nachkommastelle).
  Fehlende Angaben zählen nicht mit; ohne jede Angabe gibt es keinen Score (null).
  Die Bewertung nach dem Lesen (finalRating) fließt bewusst nicht ein.

  Reine Logik ohne DOM (Browser: window.Score, Node: require).
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Score = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CRITERIA = {
    priority: 'Priorität',
    anticipation: 'Vorfreude',
    urgency: 'Zeitdruck',
    mood: 'Stimmung',
    effort: 'Geringer Aufwand',
  };

  const DEFAULT_WEIGHTS = { priority: 50, anticipation: 20, urgency: 15, mood: 10, effort: 5 };

  function valid(v) {
    return typeof v === 'number' && v >= 1 && v <= 5;
  }

  /** Die einzelnen Werte eines Eintrags (Aufwand bereits umgedreht). */
  function values(entry) {
    const c = entry.criteria || {};
    return {
      priority: entry.priority,
      anticipation: c.anticipation,
      urgency: c.urgency,
      mood: c.mood,
      effort: valid(c.effort) ? 6 - c.effort : null,
    };
  }

  /** Score eines Eintrags (1–5, gerundet auf 0,1) oder null. */
  function compute(entry, weights = DEFAULT_WEIGHTS) {
    let sum = 0;
    let total = 0;
    for (const [key, value] of Object.entries(values(entry))) {
      const w = Number(weights[key]);
      if (!valid(value) || !(w > 0)) continue;
      sum += value * w;
      total += w;
    }
    if (total === 0) return null;
    return Math.round((sum / total) * 10) / 10;
  }

  return { CRITERIA, DEFAULT_WEIGHTS, compute, values };
});
