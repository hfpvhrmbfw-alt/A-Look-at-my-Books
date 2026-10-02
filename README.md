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

## Öffnen

**Lokal:** Den Ordner herunterladen und `index.html` per Doppelklick im Browser öffnen.

**Online über GitHub Pages:** Im Repository unter *Settings → Pages* bei
„Source“ *Deploy from a branch* wählen, Branch `main` und Ordner `/ (root)`,
dann speichern. Nach kurzer Zeit ist die Seite erreichbar unter
`https://hfpvhrmbfw-alt.github.io/A-Look-at-my-Books/`.
Auf dem Handy lässt sie sich über „Zum Home-Bildschirm“ wie eine App ablegen.

## Wo liegen die Daten?

Im Browser, also nur auf dem Gerät und in dem Browser, in dem die Bücher eingetragen wurden:
die Bücher im `localStorage` (`buecher-tracker.v2`), Cover in IndexedDB. Zum Sichern oder
Übertragen auf ein anderes Gerät: *Einstellungen* → *Export JSON* bzw. *Import JSON*.

Beim ersten Öffnen nach dem Update werden die Daten der ersten Version (`buecher-tracker.v1`)
automatisch übernommen; die alten Daten bleiben als Sicherung unverändert liegen.

## Metadaten-Quellen

| Quelle | Wofür | Key |
| --- | --- | --- |
| Deutsche Nationalbibliothek (SRU) | deutsche Ausgaben: Auflage, Einband, Übersetzer:in, Originaltitel | keiner |
| Google Books | Beschreibungen, Cover | optional |
| Open Library | Erscheinungsjahr des Werks, Cover, Ausgaben eines Werks | keiner |

Die Quellen werden direkt aus dem Browser abgefragt. Ist eine Quelle nicht erreichbar
(offline, Zeitüberschreitung, zu viele Anfragen oder vom Browser blockiert), wird sie
übersprungen und im Dialog genannt. Ergebnisse werden 30 Tage zwischengespeichert.
Ein Google-Books-API-Key kann in den Einstellungen eingetragen werden; er bleibt nur
im Browser und wird weder exportiert noch ins Repository geschrieben.

## Tests

Die reine Logik (ISBN, Datenmodell und Migration, Filter/Sortierung, Score, Fortschritt,
Quellen-Auswertung, Zusammenführen der Vorschläge, Import/Export) ist mit dem in Node
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
