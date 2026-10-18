"""Erzeugt src/data.js aus den Daten von d3-celestial 0.7.35 (BSD-3-Clause).
   npm pack d3-celestial@0.7.35 && tar xzf d3-celestial-0.7.35.tgz
   python3 scripts/prep_catalog.py package/data src/data.js"""
import json, sys, os
D = sys.argv[1]; OUT = sys.argv[2]
ld = lambda f: json.load(open(os.path.join(D, f), encoding='utf-8'))
stars = ld('stars.6.json')['features']
names = ld('starnames.json')
ra = lambda lon: lon + 360 if lon < 0 else lon

rows = []
for f in stars:
    m = f['properties']['mag']
    if m is None or m > 6.0: continue
    lon, lat = f['geometry']['coordinates']
    rows.append((round(ra(lon), 3), round(lat, 3), round(m, 2), str(f['id'])))
rows.sort(key=lambda r: r[2])
flat = []
labels = {}
for i, (a, d, m, hid) in enumerate(rows):
    flat += [a, d, m]
    n = names.get(hid)
    if not n: continue
    if n.get('name') and m < 4.5:
        labels[i] = n['name']
    elif n.get('bayer') and m < 3.6:
        labels[i] = n['bayer'] + ' ' + n['c']

GER = {'M1':'Krebsnebel','M8':'Lagunennebel','M13':'Herkules-Kugelsternhaufen','M16':'Adlernebel','M17':'Omeganebel',
 'M20':'Trifidnebel','M27':'Hantelnebel','M31':'Andromedagalaxie','M33':'Dreiecksgalaxie','M42':'Orionnebel',
 'M44':'Krippe (Praesepe)','M45':'Plejaden (Siebengestirn)','M51':'Whirlpool-Galaxie','M57':'Ringnebel','M64':'Black-Eye-Galaxie',
 'M81':'Bodes Galaxie','M82':'Zigarrengalaxie','M97':'Eulennebel','M101':'Feuerradgalaxie','M104':'Sombrerogalaxie','M11':'Wildentenhaufen',
 'M6':'Schmetterlingshaufen','M7':'Ptolemäus-Haufen','M24':'Sagittarius-Sternwolke','M35':'Offener Sternhaufen in den Zwillingen',
 'M3':'Kugelsternhaufen','M92':'Kugelsternhaufen','M15':'Kugelsternhaufen','M2':'Kugelsternhaufen','M5':'Kugelsternhaufen','M22':'Kugelsternhaufen'}
TYPES = {'s':'Spiralgalaxie','e':'Elliptische Galaxie','i':'Irreguläre Galaxie','sfr':'Sternentstehungsgebiet','gc':'Kugelsternhaufen','oc':'Offener Haufen','pn':'Planetarischer Nebel','en':'Emissionsnebel','rn':'Reflexionsnebel','snr':'Supernova-Rest',
 'sg':'Spiralgalaxie','eg':'Elliptische Galaxie','ig':'Irreguläre Galaxie','lg':'Linsengalaxie','bn':'Nebel','sn':'Nebel','dn':'Dunkelnebel','pos':'Sternfeld','ds':'Doppelstern','ast':'Asterismus','pg':'Galaxie','g':'Galaxie','s0':'Linsengalaxie'}
mess = []
for f in ld('messier.json')['features']:
    p = f['properties']; lon, lat = f['geometry']['coordinates']
    mess.append([p['name'], round(ra(lon), 3), round(lat, 3), p.get('mag'), GER.get(p['name']) or p.get('alt') or '', TYPES.get(p.get('type'), p.get('type') or ''), p.get('desig') or ''])

lines = []
for f in ld('constellations.lines.json')['features']:
    for seg in f['geometry']['coordinates']:
        lines.append([v for pt in seg for v in (round(ra(pt[0]), 2), round(pt[1], 2))])

js = ('const STARS=' + json.dumps(flat, separators=(',', ':')) + ';\n'
      'const STARLABELS=' + json.dumps(labels, ensure_ascii=False, separators=(',', ':')) + ';\n'
      'const MESSIER=' + json.dumps(mess, ensure_ascii=False, separators=(',', ':')) + ';\n'
      'const CLINES=' + json.dumps(lines, separators=(',', ':')) + ';\n')
open(OUT, 'w', encoding='utf-8').write(js)
print(len(rows), 'stars', len(labels), 'labels', len(mess), 'messier', len(lines), 'lines', len(js)//1024, 'KB')
