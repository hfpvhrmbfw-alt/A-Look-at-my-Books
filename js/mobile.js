/*
  Anpassungen für das iPhone (Bildschirmtastatur)
  ================================================
  Safari verkleinert beim Einblenden der Tastatur nicht die Seite, sondern legt die
  Tastatur darüber. Ein unten angedockter Dialog läge dann teilweise dahinter.
  Deshalb schreiben wir die sichtbare Höhe (--vvh) und die von der Tastatur verdeckte
  Höhe (--kb) als CSS-Variablen auf <html>; das CSS in index.html nutzt sie für die Dialoge.
  Außerdem wird ein angetipptes Feld im Dialog sichtbar gescrollt, falls es verdeckt ist.
  Ohne visualViewport (ältere Browser, Desktop ohne Unterstützung) passiert nichts.
*/
(function () {
  'use strict';
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;

  function update() {
    // Teil des Fensters unterhalb des sichtbaren Bereichs = Tastatur (0, wenn keine offen ist)
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--kb', `${kb}px`);
  }
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();

  // Nur auf Touch-Geräten. Erst nach dem Einblenden der Tastatur scrollen, sonst stimmt die Höhe noch nicht
  document.addEventListener('focusin', (event) => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const el = event.target;
    if (!el.matches || !el.matches('dialog input, dialog select, dialog textarea')) return;
    if (el.type === 'checkbox' || el.type === 'file') return;
    setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
  });
})();
