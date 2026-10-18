#!/usr/bin/env python3
"""Baut dist/index.html: eine einzige, eigenständige HTML-Datei ohne externe Abhängigkeiten
(außer Google Fonts). Fügt Astronomy Engine, Sternkatalog und Solver inline ein.

    python3 scripts/build.py
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = lambda *a: os.path.join(ROOT, *a)
read = lambda *a: open(p(*a), encoding='utf-8').read()

astronomy = ("/*! Astronomy Engine 2.1.19 (c) Don Cross, MIT License, https://github.com/cosinekitty/astronomy */\n"
             + read('vendor', 'astronomy.browser.min.js'))
core = ("/* Sternkatalog: d3-celestial data (c) Olaf Frohn, BSD-3-Clause */\n"
        + read('src', 'data.js') + read('src', 'solver.js'))
core = core.replace("if (typeof module !== 'undefined') module.exports = Solver;", '')

page = read('src', 'app.html')
for chunk in (astronomy, core):
    assert '</script' not in chunk.lower(), 'Inline-Skript enthält </script'
page = page.replace('/*__ASTRONOMY__*/', astronomy).replace('/*__CORE__*/', core)

html = ('<!doctype html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>body{margin:0}</style></head><body>' + page + '</body></html>')
os.makedirs(p('dist'), exist_ok=True)
open(p('dist', 'index.html'), 'w', encoding='utf-8').write(html)
print('dist/index.html', len(html) // 1024, 'KB')
