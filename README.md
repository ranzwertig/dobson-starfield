# Dobson-Lotse

Web-App, die über die Handykamera feststellt, wohin ein Dobson-Teleskop zeigt, und dann mit Azimut-/Höhenpfeilen zum gewünschten Objekt führt. Das Handy wird parallel zum Tubus montiert. Die App erkennt die Sterne im Kamerabild, vergleicht sie mit einem Sternkatalog (Plate Solving) und rechnet die Richtung über Uhrzeit und Standort in Höhe/Azimut um.

Alles läuft lokal im Browser: kein Server, keine Anmeldung. Die fertige App ist eine einzige HTML-Datei von etwa 310 KB.

## Benutzen

1. `dist/index.html` über HTTPS ausliefern (z. B. Cloudflare Pages: Build-Befehl leer, Ausgabeverzeichnis `dist`). Kamera und GPS gibt der Browser nur über HTTPS frei.
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
| `src/data.js` | Sternkatalog bis 6 mag, Sternnamen, Messier-Objekte, Sternbildlinien (generiert) |
| `vendor/astronomy.browser.min.js` | Astronomy Engine 2.1.19 |
| `scripts/build.py` | baut `dist/index.html` |
| `scripts/prep_catalog.py` | erzeugt `src/data.js` aus d3-celestial |
| `scripts/image_to_f32.py` | wandelt ein Foto für `test/photo.js` um |
| `test/synthetic.js` | synthetische Sternfelder mit bekannter Lösung |
| `test/photo.js` | löst ein echtes Foto |

## Bauen und testen

```bash
python3 scripts/build.py            # -> dist/index.html
node test/synthetic.js 21 4         # Seed, Anzahl pro Fall

pip install pillow numpy
python3 scripts/image_to_f32.py foto.jpg /tmp/foto
node test/photo.js /tmp/foto
```

Katalog neu erzeugen:

```bash
npm pack d3-celestial@0.7.35 && tar xzf d3-celestial-0.7.35.tgz
python3 scripts/prep_catalog.py package/data src/data.js
```

## Bekannte Grenzen

- Unter echtem Himmel mit Live-Kamera noch nicht getestet. Ob die Videobelichtung im Browser genug Sterne liefert, hängt stark vom Handy ab.
- Ohne bekanntes Bildfeld braucht die App mindestens 10 passende Sterne. Sehr sternarme Bilder werden deshalb lieber abgelehnt als falsch gelöst.
- Schmale Bildfelder weit entfernt vom Startwert (66°) können beim ersten Lösen bis zu etwa 40 Sekunden dauern.

## Fremdcode und Daten

- Sternkatalog, Namen, Messier-Daten und Sternbildlinien: [d3-celestial](https://github.com/ofrohn/d3-celestial) von Olaf Frohn, BSD-3-Clause
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) von Don Cross, MIT
