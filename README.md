# Kassabuch

Web-App (PWA) für Kleinbetriebe: Belege fotografieren, Tageslosung, Tips, Gehälter und Bargeldbewegungen erfassen und daraus ein Excel-Kassabuch im gewohnten Layout erzeugen. Läuft auf iPhone und Android, alle Daten bleiben auf dem Gerät.

## Veröffentlichen mit GitHub Pages

Einmalig, ungefähr 10 Minuten. Es braucht nur einen Browser, kein Programm.

1. **Konto anlegen:** Auf [github.com](https://github.com) kostenlos registrieren (falls noch kein Konto vorhanden ist).
2. **Repository anlegen:** Rechts oben auf **+** und dann **New repository** klicken.
   * Name: zum Beispiel `kassabuch`
   * Sichtbarkeit: **Public** (GitHub Pages ist im Gratis-Tarif nur für öffentliche Repositories verfügbar. Im Code stehen keine Daten und kein API-Schlüssel.)
   * Auf **Create repository** klicken.
3. **Dateien hochladen:** Im neuen Repository auf den Link **uploading an existing file** klicken. Dann den **Inhalt** des Ordners `kassabuch-app` (nicht den Ordner selbst) in das Browserfenster ziehen: `index.html`, `manifest.webmanifest`, `sw.js`, `.nojekyll`, `README.md` und die Ordner `css`, `js`, `icons`, `vendor`. Unten auf **Commit changes** klicken.
   * Hinweis: Windows blendet `.nojekyll` eventuell aus. Die App funktioniert auch ohne diese Datei.
4. **Pages einschalten:** Im Repository auf **Settings**, links auf **Pages**. Bei **Source** die Option **Deploy from a branch** wählen, bei **Branch** `main` und `/ (root)` einstellen und **Save** klicken.
5. **Warten und öffnen:** Nach ein bis zwei Minuten erscheint oben auf derselben Seite die Adresse, zum Beispiel `https://BENUTZERNAME.github.io/kassabuch/`.

### Auf dem Handy installieren

* **iPhone:** Die Adresse in **Safari** öffnen, auf **Teilen** tippen, dann **Zum Home-Bildschirm**. Wichtig: Die App immer über das Symbol am Home-Bildschirm starten. Nur so bleiben die Daten dauerhaft gespeichert.
* **Android:** Die Adresse in **Chrome** öffnen, im Menü (drei Punkte) auf **App installieren** oder **Zum Startbildschirm hinzufügen** tippen.

### Updates einspielen

Geänderte Dateien genauso über **Add file** und **Upload files** hochladen und bestehende überschreiben. Bei der Datei `sw.js` die Versionsnummer in der Zeile `const CACHE = 'kassabuch-v1';` erhöhen (zum Beispiel auf `v2`). Die Handys laden die neue Version beim übernächsten Öffnen der App.

## Belegerkennung

* **Mit Claude-API-Schlüssel** (Einstellungen, Belegerkennung): Das Foto geht direkt vom Handy an die Claude-API. Sehr genaue Erkennung, etwa 2 Cent pro Beleg mit Claude Opus 5. Den Schlüssel gibt es unter [console.anthropic.com](https://console.anthropic.com) (API Keys, vorher etwas Guthaben aufladen).
* **Ohne Schlüssel oder ohne Internet:** Texterkennung am Handy (Tesseract). Kostenlos, aber ungenauer. Beim ersten Mal lädt sie einmalig etwa 5 MB aus dem Internet.

Der Schlüssel liegt nur im Speicher des Handys. Für die geplante öffentliche Version kommt er auf einen Server.

## Datensicherung

Jede exportierte Excel-Datei enthält ein unsichtbares Blatt mit allen Daten des Betriebs. Über **Export, Sicherung einlesen** lässt sich damit alles auf einem neuen Handy wiederherstellen. Die App erinnert nach einer Woche ohne Export daran.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `css/app.css` | Oberfläche |
| `js/app.js` | Ansichten, Formulare, Abläufe |
| `js/db.js` | Speicherung im Gerät (IndexedDB) |
| `js/ledger.js` | Beträge in Cent, Sortierung, laufender Kassastand |
| `js/excel.js` | Excel-Export und Wiederherstellung (ExcelJS) |
| `js/ocr.js` | Belegerkennung mit Claude oder Tesseract |
| `js/templates.js` | Branchenvorlagen, Kategorien, bekannte Lieferanten |
| `js/i18n.js` | Texte Deutsch und Englisch |
| `sw.js`, `manifest.webmanifest` | Offline-Betrieb und Installation |

Lokal testen: `python -m http.server 8765` im Ordner starten und `http://localhost:8765` öffnen.
