# A-Look-at-my-Books

Book Tracker of current reads, next in line etc.

Ein Bücher-Tracker mit Leseliste, ohne Abhängigkeiten und ohne Build:
`index.html` plus ein paar Skripte im Ordner `js/`.

## Funktionen

- **Leseliste** mit den Status Lese gerade, Als Nächstes, Wunschliste/Backlog, Gelesen und Abgebrochen.
  Die Leseliste zeigt die offenen Bücher, gelesene und abgebrochene stehen im **Archiv**.
- **Besitzformat** E-Book, Print, beides oder noch nicht; bei „beides“ auch, in welchem Format du gerade liest.
  Filter „E-Book“ / „Print“ lassen sich mit Status, Genre/Tag und Mindestscore kombinieren.
- **Werk und Ausgabe getrennt**: Werk (Titel, Autor:innen, Original, Reihe, Genres …) und die Ausgabe,
  die du besitzt (ISBN mit Prüfziffer-Check, Verlag, Auflage, Einband, Seiten, Übersetzer:in …),
  dazu Angaben für besondere Ausgaben (Erstausgabe, signiert, Zustand, Erwerb …).
- **Score** aus Priorität, Vorfreude, Zeitdruck, Aufwand und Stimmung; Gewichte unter *Einstellungen* einstellbar.
  Sortierung nach Score, Titel, Autor:in, Seiten, Datum oder Format; „Als Nächstes“ mit ↑/↓ ordnen.
- **Lesefortschritt** als Seite, Prozent oder Kapitel, mit Verlauf, Fortschrittsbalken und grober Restdauer.
- **Metadaten-Suche** über ISBN oder Titel + Autor:in bei der Deutschen Nationalbibliothek, Google Books
  und Open Library. Vorschläge werden feldweise angezeigt (neu / abweichend / identisch) und nur mit
  Bestätigung übernommen; die Herkunft jedes Feldes wird gespeichert. Cover werden lokal gespeichert.
- **Import/Export** als JSON (vollständig, inkl. Cover) und CSV (Tabelle).

## Als App auf dem iPhone

Die Seite ist eine PWA (Progressive Web App): Sie lässt sich wie eine App auf den Home-Bildschirm legen
und startet nach dem ersten Laden auch ohne Internet.

1. `https://hfpvhrmbfw-alt.github.io/A-Look-at-my-Books/` in **Safari** öffnen.
2. Unten auf das Teilen-Symbol (Quadrat mit Pfeil nach oben) tippen.
3. **Zum Home-Bildschirm** wählen und „Hinzufügen“ tippen.

Wichtig: Die App auf dem Home-Bildschirm hat **eigenen Speicher, getrennt von Safari**.
Bücher, die du vorher in Safari eingetragen hast, holst du so hinüber: in Safari *Einstellungen* →
*Export JSON*, dann in der App *Einstellungen* → *Backup wiederherstellen*.

Auf Android oder am Computer (Chrome, Edge) bietet der Browser „App installieren“ an.

**Lokal ohne Internet-Adresse:** Den Ordner herunterladen und `index.html` per Doppelklick öffnen.
Alles funktioniert, nur der Offline-Modus nicht (der braucht eine `http(s)`-Adresse).

Eine Schritt-für-Schritt-Anleitung für die Veröffentlichung über GitHub Pages steht in
[ANLEITUNG.md](ANLEITUNG.md).

## Updates ausrollen

Der Service Worker (`sw.js`) speichert alle App-Dateien in einem Cache mit Versionsnummer.

1. Dateien ändern.
2. In `sw.js` die Zeile `const VERSION = 1;` um eins erhöhen. **Ohne diesen Schritt sehen
   installierte Apps die Änderung nicht.**
3. Neue Dateien in `js/` oder `icons/` zusätzlich in `APP_FILES` in `sw.js` eintragen
   (`npm test` meldet, wenn etwas fehlt).
4. Hochladen bzw. auf `main` mergen. GitHub Pages braucht danach ein bis zwei Minuten.

Beim nächsten Öffnen lädt die App die neue Version im Hintergrund und zeigt oben
„Neue Version verfügbar · Neu laden“. Nach dem Tippen läuft die neue Version, alte Caches werden gelöscht.
Die installierte Version steht in den *Einstellungen* ganz unten („App-Version …“).

## Icon ersetzen

Die Icons in `icons/` sind Platzhalter (schwarzes „B“ auf Signal-Orange). Zum Ersetzen vier PNG-Dateien
mit denselben Namen und Größen ablegen:

| Datei | Größe | Hinweis |
| --- | --- | --- |
| `icon-192.png` | 192 × 192 | Android, Chrome |
| `icon-512.png` | 512 × 512 | Android, Chrome, Startbildschirm |
| `icon-maskable-512.png` | 512 × 512 | Motiv nur im inneren Kreis (80 %), Rand wird beschnitten |
| `apple-touch-icon-180.png` | 180 × 180 | iPhone; ohne Transparenz, iOS rundet die Ecken selbst |

Danach die Version in `sw.js` erhöhen. Auf dem iPhone übernimmt iOS ein neues Icon erst,
wenn die App vom Home-Bildschirm entfernt und neu hinzugefügt wird (vorher exportieren!).

## Wo liegen die Daten?

Nur im Browser auf deinem Gerät, nie auf einem Server: die Bücher im `localStorage`
(`buecher-tracker.v2`), Cover in IndexedDB (`buecher-tracker`), dazu der Zwischenspeicher der Suche,
die Design-Wahl und die App-Dateien für den Offline-Start. Alle Namen beginnen mit `buecher-tracker`,
weil sich alle GitHub-Pages-Seiten eines Kontos (`NAME.github.io`) denselben Speicher teilen.

Der Browser kann lokale Daten löschen (Speichermangel, Website-Daten löschen, App vom Home-Bildschirm
entfernen). Deshalb regelmäßig sichern: *Einstellungen* → *Export JSON* (enthält alles inkl. Cover).

- **Import JSON** fügt die Bücher aus der Datei hinzu; vorhandene bleiben unverändert.
- **Backup wiederherstellen** ersetzt alle Bücher auf dem Gerät durch die aus der Datei.
  Der vorherige Stand wird vorher unter `buecher-tracker.v2.vorWiederherstellung` aufgehoben.

Beim ersten Öffnen nach dem Update werden die Daten der ersten Version (`buecher-tracker.v1`)
automatisch übernommen; die alten Daten bleiben als Sicherung unverändert liegen.

## Metadaten-Quellen

| Quelle | Wofür | Key |
| --- | --- | --- |
| Deutsche Nationalbibliothek (SRU) | deutsche Ausgaben: Auflage, Einband, Übersetzer:in, Originaltitel | keiner |
| Google Books | Beschreibungen, Cover | optional |
| Open Library | Erscheinungsjahr des Werks, Cover, Ausgaben eines Werks | keiner |

Die Quellen werden direkt aus dem Browser abgefragt, ohne eigenen Server. Ist eine Quelle nicht
erreichbar (Zeitüberschreitung, zu viele Anfragen oder vom Browser blockiert), wird sie übersprungen
und im Dialog genannt. Offline sagt die Suche das in einem Satz; die App bleibt voll nutzbar.
Ergebnisse werden 30 Tage zwischengespeichert, übernommene Cover dauerhaft auf dem Gerät.

Ob eine Quelle in deinem Browser funktioniert, zeigt die Prüfseite
`https://hfpvhrmbfw-alt.github.io/A-Look-at-my-Books/cors-check.html`. Rot markierte Quellen
in der App unter *Einstellungen* → *Metadaten-Suche* abschalten.
Ein Google-Books-API-Key kann in den Einstellungen eingetragen werden; er bleibt nur
im Browser und wird weder exportiert noch ins Repository geschrieben.

## Tests

Die reine Logik (ISBN, Datenmodell und Migration, Filter/Sortierung, Score, Fortschritt,
Quellen-Auswertung, Zusammenführen der Vorschläge, Import/Export, Design-Wahl, Offline-Dateiliste) ist mit dem in Node
eingebauten Testrunner getestet, ohne zusätzliche Pakete. Die Quellen werden dabei mit
gespeicherten Antworten (`tests/fixtures/`) nachgebildet.

```
npm test        # oder: node --test
```

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Design (CSS) und Gerüst (HTML) |
| `js/app.js` | Oberfläche: Liste, Dialoge, Ereignisse |
| `js/model.js` | Datenmodell Werk/Ausgabe/Eintrag, Migration, Laden |
| `js/isbn.js` | ISBN prüfen und umrechnen |
| `js/list.js` | Filtern, Sortieren, Warteschlange |
| `js/score.js` | Score-Berechnung |
| `js/progress.js` | Lesefortschritt |
| `js/sources.js` | Abfrage und Auswertung der Quellen |
| `js/enrich.js` | Zusammenführen, Vergleich, Passung, Cache |
| `js/covers.js` | Cover in IndexedDB |
| `js/transfer.js` | Import/Export |
| `js/theme.js` | Design-Wahl System/Hell/Dunkel (Schalter oben rechts, gespeichert in diesem Browser) |
| `sw.js` | Service Worker: Offline-Start, Versionsnummer, Updates |
| `manifest.webmanifest` | Name, Farben und Icons für „Zum Home-Bildschirm“ |
| `icons/` | App-Icons (Platzhalter) |
| `cors-check.html` | Prüfseite: Welche Metadaten-Quellen funktionieren in diesem Browser? |
