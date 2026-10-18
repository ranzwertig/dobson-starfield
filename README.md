# Dobson-Lotse

Web-App, die über die Handykamera feststellt, wohin ein Dobson-Teleskop zeigt, und dann mit Azimut-/Höhenpfeilen zum gewünschten Objekt führt. Das Handy wird parallel zum Tubus montiert. Die App erkennt die Sterne im Kamerabild, vergleicht sie mit einem Sternkatalog (Plate Solving) und rechnet die Richtung über Uhrzeit und Standort in Höhe/Azimut um.

Alles läuft lokal im Browser: kein Server, keine Anmeldung. Die fertige App ist eine einzige HTML-Datei von etwa 315 KB.

## Benutzen

1. Die App über HTTPS ausliefern, Kamera und GPS gibt der Browser nur so frei. Das Repo ist mit Cloudflare verbunden: Jeder Push auf `main` baut und deployt automatisch (`npx wrangler deploy` führt vorher `npm run build` aus, siehe `wrangler.jsonc`).
2. Handy fest und parallel zum Tubus montieren, Kamera starten, **Position bestimmen**. Beim ersten Mal sucht die App das Bildfeld der Kamera und merkt es sich.
3. Einen hellen Stern im Okular zentrieren, **Okular** drücken und denselben Stern im Bild antippen. Damit kennt die App den Versatz zwischen Handy und Teleskop.
4. Ziel wählen (Messier-Objekte, helle Sterne, Mond, Planeten) und mit **Dauernd** den Pfeilen folgen.

Über **Foto** lassen sich auch gespeicherte Himmelsfotos lösen, praktisch zum Testen.

## Wie es funktioniert

1. **Aufnahme:** mehrere Videoframes mitteln (weniger Rauschen), Graustufen, lange Seite maximal 1280 px.
2. **Sternerkennung** (`detectStars`): Hintergrund und Rauschen blockweise per Median/MAD schätzen, zusammenhängende Flecken über 5σ suchen. Hotpixel, längliche oder ausgefranste Flecken, Flecken in strukturiertem Vordergrund und Himmelslücken im Laub werden verworfen. Position über den Schwerpunkt.
3. **Lochkamera-Modell:** Pixel → Einheitsvektor über die Brennweite in Pixeln.
4. **Matching:** Dreiecke aus den hellsten Bildsternen werden über ihre Winkelabstände im Katalog-Paarindex gesucht (binäre Suche plus Nachbarlisten, Händigkeit geprüft). Aus jedem Treffer wird die Rotation per Quaternion-Methode (Horn) berechnet und gegen alle Bildsterne verifiziert.
5. **Unbekanntes Bildfeld:** Suche über 12–90° in 2,5-%-Schritten, in drei Durchläufen mit wachsender Zeit pro Schritt. Die Grenzhelligkeit des Index wird an das Bildfeld angepasst.
6. **Verfeinerung:** Brennweite, radiale Verzerrung und bei genug Sternen eine Polynom-Korrektur (wie SIP) per Least-Squares, mit Ausreißer-Verwerfung.
7. **Absicherung gegen Falschtreffer:** Restfehler unter etwa 2 px, Gegenprobe der hellsten Sterne, Rangkorrelation der Helligkeiten, ohne bekanntes Bildfeld mindestens 10 passende Sterne.
8. **Navigation:** [Astronomy Engine](https://github.com/cosinekitty/astronomy) rechnet von J2000 ins Horizontsystem (inkl. Präzession, Nutation, Refraktion) und liefert Mond- und Planetenpositionen.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/app.html` | Oberfläche, Kamera, Overlay, Navigation |
| `src/solver.js` | Sternerkennung und Plate Solver (auch unter Node nutzbar) |
| `public/` | statische Zusatzdateien, werden nach `dist/` kopiert (`robots.txt`) |
| `scripts/catalog.mjs` | erzeugt `src/data.js` aus d3-celestial: Sterne bis 6 mag, Namen, Messier, Sternbildlinien |
| `scripts/build.mjs` | baut `dist/index.html` mit Astronomy Engine, Katalog und Solver inline |
| `scripts/image_to_f32.py` | wandelt ein Foto für `test/photo.cjs` um |
| `test/synthetic.cjs` | synthetische Sternfelder mit bekannter Lösung |
| `test/photo.cjs` | löst ein echtes Foto |

`dist/` und `src/data.js` werden beim Bauen erzeugt und nicht eingecheckt.

## Bauen und testen

Node 20 oder neuer.

```bash
npm install
npm run build        # -> dist/index.html + dist/robots.txt
npm test             # synthetische Sternfelder
npm run dev          # lokal mit wrangler dev
npm run deploy       # manuell deployen (sonst per Push auf main)
```

Echtes Foto testen (braucht Python mit Pillow und NumPy):

```bash
python3 scripts/image_to_f32.py foto.jpg /tmp/foto
npm run test:photo -- /tmp/foto
```

## Bekannte Grenzen

- Unter echtem Himmel mit Live-Kamera noch nicht getestet. Ob die Videobelichtung im Browser genug Sterne liefert, hängt stark vom Handy ab.
- Ohne bekanntes Bildfeld braucht die App mindestens 10 passende Sterne. Sehr sternarme Bilder werden deshalb lieber abgelehnt als falsch gelöst.
- Schmale Bildfelder weit entfernt vom Startwert (66°) können beim ersten Lösen bis zu etwa 40 Sekunden dauern.

## Fremdcode und Daten

- Sternkatalog, Namen, Messier-Daten und Sternbildlinien: [d3-celestial](https://github.com/ofrohn/d3-celestial) von Olaf Frohn, BSD-3-Clause
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) von Don Cross, MIT
