# A-Look-at-my-Books

Book Tracker of current reads, next in line etc.

Ein einfacher Bücher-Tracker als einzelne Datei (`index.html`), ohne Abhängigkeiten.

## Funktionen (Muss-Version)

- Buch hinzufügen mit Titel, Autor und Status
- Status: Will ich lesen, Lese ich gerade, Gelesen, Abgebrochen
- Bewertung (1–5 Sterne) und Notizen
- Liste mit Filter nach Status und Suche nach Titel/Autor
- Buch bearbeiten und löschen (mit „Rückgängig“)

## Öffnen

**Lokal:** `index.html` herunterladen und per Doppelklick im Browser öffnen.

**Online über GitHub Pages:** Im Repository unter *Settings → Pages* bei
„Source“ *Deploy from a branch* wählen, Branch `main` und Ordner `/ (root)`,
dann speichern. Nach kurzer Zeit ist die Seite erreichbar unter
`https://hfpvhrmbfw-alt.github.io/A-Look-at-my-Books/`.
Auf dem Handy lässt sie sich über „Zum Home-Bildschirm“ wie eine App ablegen.

## Wo liegen die Daten?

Im `localStorage` des Browsers, also nur auf dem Gerät und in dem Browser,
in dem die Bücher eingetragen wurden. Handy und Laptop haben getrennte Listen,
und beim Löschen der Browserdaten gehen die Einträge verloren.
Ein Export/Import (CSV) ist für später geplant.
