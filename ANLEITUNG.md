# Anleitung: Bücher-Tracker als App aufs iPhone

Die App braucht keinen Server und keinen Build. GitHub Pages stellt die Dateien einfach
als Website bereit. Du brauchst nur ein (kostenloses) GitHub-Konto.

Der Weg in Kürze: Repository öffentlich machen, Pages einschalten, Adresse in Safari öffnen,
„Zum Home-Bildschirm“ wählen.

---

## Teil A: Dein vorhandenes Repository `A-Look-at-my-Books`

Die Dateien liegen schon auf GitHub. Es fehlen nur zwei Einstellungen.

### 1. Repository öffentlich machen

GitHub Pages ist mit einem kostenlosen Konto nur für öffentliche Repositories verfügbar.
Im Repository stehen keine persönlichen Daten: Deine Bücher liegen nur auf deinem Gerät.

1. Auf github.com dein Repository öffnen.
2. Oben auf **Settings** (Zahnrad) tippen.
3. Ganz nach unten zu **Danger Zone** scrollen, dort **Change visibility** → **Change to public**.
4. Die Rückfrage bestätigen (Repository-Namen eintippen).

### 2. GitHub Pages einschalten

1. In **Settings** links auf **Pages** (unter „Code and automation“).
2. Bei **Source**: **Deploy from a branch**.
3. Bei **Branch**: `main` und Ordner `/ (root)` wählen, dann **Save**.
4. Ein bis zwei Minuten warten und die Seite neu laden. Oben erscheint
   „Your site is live at `https://hfpvhrmbfw-alt.github.io/A-Look-at-my-Books/`“.

Weiter mit **Teil C**.

---

## Teil B: Ganz neu anlegen (z. B. für Freunde)

1. Auf github.com oben rechts **+** → **New repository**.
2. Einen Namen eingeben, z. B. `buecher`. Er wird Teil der Adresse.
3. **Public** wählen, „Add a README file“ **nicht** ankreuzen, dann **Create repository**.
4. Auf der leeren Seite auf **uploading an existing file** tippen.
5. Alle Dateien und Ordner dieses Projekts in das Feld ziehen
   (`index.html`, `sw.js`, `manifest.webmanifest`, `cors-check.html` und die Ordner `js` und `icons`;
   `tests` und `package.json` sind nicht nötig, schaden aber auch nicht).
6. Unten **Commit changes**.
7. Pages einschalten wie in Teil A, Schritt 2.
8. Die Adresse lautet `https://KONTONAME.github.io/REPONAME/`, z. B.
   `https://anna.github.io/buecher/`.

Alle Pfade in der App sind relativ. Sie läuft deshalb unter jedem Repository-Namen.

---

## Teil C: Auf dem iPhone installieren

1. Die Adresse in **Safari** öffnen (nicht in Chrome oder einer anderen App, nur Safari kann
   auf dem iPhone Web-Apps installieren).
2. Einmal kurz warten, bis die Seite ganz geladen ist. Dabei speichert sie sich für den Offline-Start.
3. Unten auf das **Teilen**-Symbol tippen (Quadrat mit Pfeil nach oben).
4. Nach unten scrollen und **Zum Home-Bildschirm** wählen, dann **Hinzufügen**.
5. Die App über das neue Symbol „Bücher“ öffnen. Sie startet ohne Safari-Leisten.

**Bücher aus Safari übernehmen:** Die App auf dem Home-Bildschirm hat einen eigenen Speicher.
Hast du vorher schon in Safari Bücher eingetragen: in Safari *Einstellungen* → **Export JSON**
(landet in „Dateien“ → Downloads), dann in der App *Einstellungen* → **Backup wiederherstellen**
und die Datei wählen.

**Prüfen, ob alles klappt**
- Flugmodus an, App öffnen: Sie startet und zeigt deine Bücher.
- In der App *Einstellungen*, ganz unten: „App-Version 1 · startet auch offline“.
- Mit Internet `…/cors-check.html` öffnen: Zeigt, welche Metadaten-Quellen auf deinem iPhone
  funktionieren. Rote Quellen in der App unter *Einstellungen* → *Metadaten-Suche* abschalten.

---

## Sichern nicht vergessen

Deine Bücher liegen nur auf dem iPhone. Löschst du das App-Symbol, sind sie weg.
Deshalb ab und zu *Einstellungen* → **Export JSON** und die Datei z. B. in iCloud Drive ablegen.

## Neue Version einspielen

Siehe „Updates ausrollen“ in der [README](README.md): Dateien ändern, in `sw.js` die Zahl bei
`const VERSION` erhöhen, hochladen. Beim nächsten Öffnen zeigt die App
„Neue Version verfügbar · Neu laden“.
