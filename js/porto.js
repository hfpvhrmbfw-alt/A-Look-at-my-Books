// Helfer zu den Porto-Bausteinen in components.css. Ohne Abhängigkeiten, als <script src="porto.js"> einbinden.
// Porto.postmark(opts)  Poststempel als SVG-Text
// Porto.icon(name)      Symbol als SVG-Text (Namen: Porto.icons)
// Porto.motif(name)     Bild für Marken ohne Cover (Namen: Porto.motifs)
// Porto.countTo(el, n)  Zahl hochzählen
// Porto.tilt(el)        Element neigt sich zum Zeiger
// Porto.replay(el)      Animationsklasse neu abspielen
// Porto.wire(bereich)   schaltet in einem Bereich alles ein: data-motif, data-pm, data-icon, data-stampable, data-stamp-for,
//                       .folder, .pillseg (data-count-target, data-bars), .pillbar, .hairbars (data-tip), data-tilt, data-count, data-stamped-count
(function (root) {
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let uid = 0;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Doppelring mit Schrift auf dem Kreis, Datum in der Mitte, Wellenlinien nach rechts, leicht abgenutzte Farbe.
  function postmark({ top = 'GELESEN', bottom = '', date = '', year = '', waves = true, cls = '' } = {}) {
    const id = 'pm' + (++uid), w = waves ? 190 : 104;
    const wave = y => `M92 ${y} q8 -6 16 0 t16 0 t16 0 t16 0 t16 0 t16 0`;
    return `<svg class="postmark ${cls}" viewBox="0 0 ${w} 104" aria-hidden="true">
<defs><path id="${id}t" d="M14 52 a38 38 0 0 1 76 0"/><path id="${id}b" d="M8 52 a44 44 0 0 0 88 0"/>
<filter id="${id}f" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${uid * 7}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -.85 1.12"/><feComposite in="SourceGraphic" operator="in"/></filter></defs>
<g filter="url(#${id}f)" fill="none" stroke="currentColor">
<circle cx="52" cy="52" r="49" stroke-width="2.4"/><circle cx="52" cy="52" r="45.5" stroke-width=".9"/><circle cx="52" cy="52" r="29" stroke-width="1.4"/>
${waves ? [34, 43, 52, 61, 70].map(y => `<path d="${wave(y)}" stroke-width="1.5"/>`).join('') : ''}
<g stroke="none" fill="currentColor" font-family="var(--font-label), monospace" font-weight="600" text-anchor="middle">
<text font-size="9.5" letter-spacing="1.6"><textPath href="#${id}t" startOffset="50%">${esc(top)}</textPath></text>
${bottom ? `<text font-size="8.5" letter-spacing="1.4"><textPath href="#${id}b" startOffset="50%">${esc(bottom)}</textPath></text>` : ''}
<text x="52" y="${year ? 51 : 56}" font-size="12">${esc(date)}</text>${year ? `<text x="52" y="64" font-size="10">${esc(year)}</text>` : ''}
</g></g></svg>`;
  }

  const P = {
    regal: '<path d="M5 4v16M9.5 4v16M14 5.5l4.5 14"/><path d="M3 20h18"/>',
    suche: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    zahlen: '<path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    buch: '<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/>',
    lesezeichen: '<path d="M7 4h10v16l-5-4-5 4z"/>',
    stern: '<path d="M12 4l2.5 5.2 5.5.7-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.7z"/>',
    haken: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    mappe: '<path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5H10l2 2.5h6.5A1.5 1.5 0 0 1 20 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/>',
    marke: '<rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M8.5 15l2.5-4 2 2.5 1.5-2 1 3.5z"/>',
    uhr: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    zurueck: '<path d="M15 5l-7 7 7 7"/>',
    zahnrad: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2L18 18M18 6l-1.8 1.8M7.8 16.2L6 18"/>',
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;


  // Motive für Marken ohne Bild: wenige flache Farben wie bei alten Briefmarken und Zündholzetiketten.
  const M = {
    streifen: () => { const c = ['var(--senf)', 'var(--accent)', 'var(--rose)', 'var(--paper)', 'var(--himmel)', 'var(--tanne)'];
      return `<rect width="100" height="150" fill="var(--paper)"/>` + c.map((f, i) => `<path d="M-10 ${40 + i * 16} L35 ${-5 + i * 16} L55 ${15 + i * 16} L110 ${-40 + i * 16} V${-24 + i * 16} L55 ${31 + i * 16} L35 ${11 + i * 16} L-10 ${56 + i * 16}Z" fill="${f}"/>`).join(''); },
    punkte: () => { let o = `<rect width="100" height="150" fill="var(--paper)"/>`;
      for (let y = 0; y < 21; y++) for (let x = 0; x < 14; x++) { const px = 4.5 + x * 7, py = 5 + y * 7, d = Math.abs((px - 50) * .9 + (py - 75) * .5) / 26 + Math.hypot(px - 50, py - 75) / 90; const r = Math.max(.5, 3.3 - d * 2.6); o += `<circle cx="${px}" cy="${py}" r="${r.toFixed(2)}" fill="var(--tanne)"/>`; }
      return o; },
    planet: () => { let st = ''; for (let i = 0; i < 26; i++) st += `<circle cx="${(i * 37) % 100}" cy="${(i * 53) % 95}" r="${i % 3 ? .7 : 1.1}" fill="var(--himmel)"/>`;
      return `<rect width="100" height="150" fill="#1C1A16"/>${st}<circle cx="78" cy="22" r="9" fill="var(--senf)"/><circle cx="58" cy="150" r="62" fill="var(--accent)"/><path d="M-5 60 L48 96 L40 108Z" fill="var(--paper)"/><path d="M40 108 L48 96 L60 104 L52 116Z" fill="var(--himmel)"/>`; },
    welle: () => `<rect width="100" height="150" fill="var(--himmel)"/><circle cx="68" cy="42" r="17" fill="var(--paper)"/>` + ['var(--tanne)', 'var(--paper)', 'var(--tanne)', 'var(--senf)'].map((f, i) => `<path d="M-10 ${86 + i * 16} q15 -14 30 0 t30 0 t30 0 t30 0 V160 H-10Z" fill="${f}"/>`).join(''),
  };
  M.sonne = () => `<rect width="100" height="150" fill="var(--senf)"/>` + Array.from({ length: 12 }, (_, i) => `<path d="M50 92 L${(50 + 140 * Math.cos(i * Math.PI / 6)).toFixed(1)} ${(92 + 140 * Math.sin(i * Math.PI / 6)).toFixed(1)} L${(50 + 140 * Math.cos(i * Math.PI / 6 + .26)).toFixed(1)} ${(92 + 140 * Math.sin(i * Math.PI / 6 + .26)).toFixed(1)}Z" fill="var(--paper)" opacity=".55"/>`).join('') + `<circle cx="50" cy="92" r="24" fill="var(--accent)"/><rect y="118" width="100" height="32" fill="var(--tanne)"/>`;
  M.raute = () => { let o = `<rect width="100" height="150" fill="var(--tanne)"/>`; const c = ['var(--accent)', 'var(--senf)', 'var(--paper)'];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) { const cx = 12.5 + x * 25, cy = 12.5 + y * 25; o += `<path d="M${cx} ${cy - 11} L${cx + 11} ${cy} L${cx} ${cy + 11} L${cx - 11} ${cy}Z" fill="${c[(x + y) % 3]}"/><circle cx="${cx}" cy="${cy}" r="3" fill="var(--tanne)"/>`; }
    return o; };
  const motif = (name, cls = 'stamp-img') => `<svg class="${cls}" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${(M[name] || M.streifen)()}</svg>`;

  function countTo(el, to, ms = 600) {
    const from = parseFloat(el.textContent.replace(/\./g, '').replace(',', '.')) || 0;
    const fmt = n => Math.round(n).toLocaleString('de-DE');
    if (reduce()) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    (function step(t) { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); })(t0);
  }
  function tilt(el, max = 16) {
    const host = el.parentElement;
    host.addEventListener('pointermove', e => { if (reduce()) return; const r = host.getBoundingClientRect(); el.style.transform = `rotateY(${((e.clientX - r.left) / r.width - .5) * 2 * max}deg) rotateX(${-((e.clientY - r.top) / r.height - .5) * 2 * max}deg)`; });
    host.addEventListener('pointerleave', () => { el.style.transform = ''; });
  }
  function replay(el, cls) { const c = cls || [...el.classList].find(x => x.startsWith('m-')); if (!c) return; el.classList.remove(c); void el.offsetWidth; el.classList.add(c); }

  // Alles Antippbare in einem Bereich einschalten. Bezüge (data-tip, data-count-target …) gelten innerhalb des nächsten [data-scope].
  function wire(area = document) {
    const scopeOf = el => el.closest('[data-scope]') || area;
    const bars = (sel, i) => sel.forEach((el, k) => el.style.setProperty('--v', Math.round(15 + 85 * Math.abs(Math.sin((k + 1) * (i + 1.3))))));
    area.querySelectorAll('[data-motif]').forEach(n => { n.outerHTML = motif(n.dataset.motif); });
    area.querySelectorAll('[data-icon]').forEach(n => { n.outerHTML = icon(n.dataset.icon); });
    area.querySelectorAll('[data-pm]').forEach(n => { n.outerHTML = postmark({ top: n.dataset.pm || 'GELESEN', bottom: n.dataset.pmBottom || '', date: n.dataset.date || '', year: n.dataset.year || '' }); });
    area.querySelectorAll('[data-stampable]').forEach(b => b.addEventListener('click', () => {
      const on = !b.classList.contains('is-stamped'); b.classList.toggle('is-stamped', on); b.setAttribute('aria-pressed', on);
      b.dispatchEvent(new CustomEvent('porto:stamp', { bubbles: true, detail: on }));
    }));
    area.querySelectorAll('[data-stamp-for]').forEach(b => b.addEventListener('click', () => scopeOf(b).querySelector(b.dataset.stampFor)?.click()));
    area.querySelectorAll('[data-stamped-count]').forEach(el => { const sc = scopeOf(el); sc.addEventListener('porto:stamp', () => countTo(el, sc.querySelectorAll('.is-stamped').length, 300)); });
    area.querySelectorAll('.folder').forEach(f => f.addEventListener('click', () => { f.classList.toggle('open'); f.setAttribute('aria-expanded', f.classList.contains('open')); }));
    area.querySelectorAll('.pillseg').forEach(seg => {
      const bs = [...seg.querySelectorAll('button')], sc = scopeOf(seg); seg.style.setProperty('--n', bs.length);
      bs.forEach((b, i) => b.addEventListener('click', () => {
        seg.style.setProperty('--i', i); bs.forEach(x => x.setAttribute('aria-pressed', x === b));
        if (seg.dataset.countTarget && b.dataset.v) countTo(sc.querySelector(seg.dataset.countTarget), +b.dataset.v, 700);
        if (seg.dataset.bars) bars(sc.querySelectorAll(seg.dataset.bars + ' i'), i);
      }));
    });
    area.querySelectorAll('.pillbar').forEach(bar => bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b) bar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
    area.querySelectorAll('.hairbars').forEach(h => {
      const tip = h.dataset.tip && scopeOf(h).querySelector(h.dataset.tip), is = h.querySelectorAll('i');
      is.forEach(i => i.addEventListener('pointerenter', () => { is.forEach(x => x.classList.toggle('on', x === i)); if (tip && i.dataset.label) tip.textContent = i.dataset.label; }));
    });
    area.querySelectorAll('[data-tilt]').forEach(el => tilt(el, 12));
    area.querySelectorAll('[data-count]').forEach(el => countTo(el, +el.dataset.count, 900));
  }

  root.Porto = { postmark, icon, icons: Object.keys(P), motif, motifs: Object.keys(M), countTo, tilt, replay, wire };
})(typeof window !== 'undefined' ? window : globalThis);
