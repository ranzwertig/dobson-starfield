// Observing lists for the search categories: Caldwell, Herschel 400 and a curated list of popular showpieces.
// Writes public/app/lists.json (with the shapes of the larger galaxies). Objects of these lists that the deep catalogue (public/app/dso.json, from
// d3-celestial) lacks are added from OpenNGC (Mattia Verga, CC-BY-SA-4.0, https://github.com/mattiaverga/OpenNGC).
//   node scripts/lists.mjs path/to/OpenNGC/NGC.csv
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const dso = JSON.parse(readFileSync(new URL('public/app/dso.json', root), 'utf8'));
const MESSIER = JSON.parse(readFileSync(new URL('src/data.js', root), 'utf8').match(/const MESSIER=(\[.*?\]);/s)[1]);
const inDso = new Set(dso.map(d => d[0]));
const messierOf = {};
MESSIER.forEach(r => String(r[6] || '').split(/[,/]/).map(s => s.trim()).filter(Boolean).forEach(d => { messierOf[d] = r[0]; }));

// OpenNGC: "NGC0040" → "NGC 40"
const csv = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const head = csv[0].split(';'), col = n => head.indexOf(n);
const open = {};
for (const line of csv.slice(1)) {
  const f = line.split(';'), m = /^(NGC|IC)0*(\d+)\s*([A-Z]?)$/.exec(f[col('Name')]); if (!m) continue;
  open[m[1] + ' ' + m[2] + (m[3] ? m[3] : '')] = f;
}
const hms = s => { const [h, m, x] = s.split(':').map(Number); return (h + m / 60 + x / 3600) * 15; };
const dms = s => { const sg = s[0] === '-' ? -1 : 1, [d, m, x] = s.replace(/^[+-]/, '').split(':').map(Number); return sg * (d + m / 60 + x / 3600); };
const CLS = { G: 'gal', GPair: 'gal', GTrpl: 'gal', GGroup: 'gal', OCl: 'open', '*Ass': 'open', GCl: 'glob', PN: 'pn', HII: 'neb', EmN: 'neb', RfN: 'neb', Neb: 'neb', SNR: 'neb', 'Cl+N': 'neb' };
const TYPE = { OCl: 'Open cluster', '*Ass': 'Stellar association', GCl: 'Globular cluster', PN: 'Planetary nebula', HII: 'Emission nebula', EmN: 'Emission nebula',
  RfN: 'Reflection nebula', Neb: 'Nebula', SNR: 'Supernova remnant', 'Cl+N': 'Cluster with nebula', GPair: 'Galaxy pair', GTrpl: 'Galaxy triplet', GGroup: 'Galaxy group' };
const galType = h => /^S0/.test(h) ? 'Lenticular galaxy' : /^S/.test(h) ? 'Spiral galaxy' : /^E/.test(h) ? 'Elliptical galaxy' : /^I/.test(h) ? 'Irregular galaxy' : 'Galaxy';
const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;
const extra = [];
function fromOpen(id) {
  let f = open[id]; if (!f) return null;
  if (f[col('Type')] === 'Dup') { const p = f[col('NGC')] ? 'NGC ' + +f[col('NGC')] : f[col('IC')] ? 'IC ' + +f[col('IC')] : null; f = p && open[p]; if (!f) return null; }
  const t = f[col('Type')], cls = CLS[t]; if (!cls) return null;
  const B = parseFloat(f[col('B-Mag')]), V = parseFloat(f[col('V-Mag')]);
  const mag = !isNaN(V) && !isNaN(B) ? Math.min(V, B) : !isNaN(V) ? V : !isNaN(B) ? B - 0.7 : null;
  const size = parseFloat(f[col('MajAx')]);
  const name = (f[col('Common names')] || '').split(',')[0].trim();
  return [id, r3(hms(f[col('RA')])), r3(dms(f[col('Dec')])), mag == null ? null : r1(mag), cls, isNaN(size) ? null : r1(size), name, t === 'G' ? galType(f[col('Hubble')] || '') : TYPE[t] || 'Nebula'];
}
const missing = [];
// one entry of a list ("NGC 650/651", "NGC 869 & NGC 884", "Mel 25") → the id the app uses, added from OpenNGC if needed
const ALIAS = { 'Mel 25': 'C 41', 'Sh2-155': 'C 9', 'Coalsack': 'C 99' };
function resolve(entry) {
  const alts = entry.split(/\s*(?:\/|&)\s*/).map(s => s.trim()).map((s, i, a) => (/^\d+$/.test(s) ? a[0].replace(/\d+$/, s) : s));
  for (const a0 of alts) {
    const a = ALIAS[a0] || a0;
    if (messierOf[a]) return messierOf[a];
    if (inDso.has(a) || extra.some(e => e[0] === a)) return a;
  }
  for (const a of alts) { const row = fromOpen(a); if (row) { extra.push(row); return a; } }   // nebulae often have no magnitude: kept anyway
  missing.push(entry); return null;
}

const CALDWELL = ['NGC 188', 'NGC 40', 'NGC 4236', 'NGC 7023', 'IC 342', 'NGC 6543', 'NGC 2403', 'NGC 559', 'Sh2-155', 'NGC 663', 'NGC 7635', 'NGC 6946', 'NGC 457', 'NGC 869 & NGC 884',
  'NGC 6826', 'NGC 7243', 'NGC 147', 'NGC 185', 'IC 5146', 'NGC 7000', 'NGC 4449', 'NGC 7662', 'NGC 891', 'NGC 1275', 'NGC 2419', 'NGC 4244', 'NGC 6888', 'NGC 752', 'NGC 5005',
  'NGC 7331', 'IC 405', 'NGC 4631', 'NGC 6992', 'NGC 6960', 'NGC 4889', 'NGC 4559', 'NGC 6885', 'NGC 4565', 'NGC 2392', 'NGC 3626', 'Mel 25', 'NGC 7006', 'NGC 7814', 'NGC 7479',
  'NGC 5248', 'NGC 2261', 'NGC 6934', 'NGC 2775', 'NGC 2237', 'NGC 2244', 'IC 1613', 'NGC 4697', 'NGC 3115', 'NGC 2506', 'NGC 7009', 'NGC 246', 'NGC 6822', 'NGC 2360', 'NGC 3242',
  'NGC 4038', 'NGC 4039', 'NGC 247', 'NGC 7293', 'NGC 2362', 'NGC 253', 'NGC 5694', 'NGC 1097', 'NGC 6729', 'NGC 6302', 'NGC 300', 'NGC 2477', 'NGC 55', 'NGC 1851', 'NGC 3132',
  'NGC 6124', 'NGC 6231', 'NGC 5128', 'NGC 6541', 'NGC 3201', 'NGC 5139', 'NGC 6352', 'NGC 6193', 'NGC 4945', 'NGC 5286', 'IC 2391', 'NGC 6397', 'NGC 1261', 'NGC 5823', 'NGC 6087',
  'NGC 2867', 'NGC 3532', 'NGC 3372', 'NGC 6752', 'NGC 4755', 'NGC 6025', 'NGC 2516', 'NGC 3766', 'NGC 4609', 'Coalsack', 'IC 2944', 'NGC 6744', 'IC 2602', 'NGC 2070', 'NGC 362',
  'NGC 4833', 'NGC 104', 'NGC 6101', 'NGC 4372', 'NGC 3195'];
// Herschel 400 (Astronomical League), as NGC numbers
const H400 = `40 129 136 157 185 205 225 246 247 253 278 288 381 404 436 457 488 524 559 584 596 598 613 615 637 650/651 654 659 663 720 752 772 779 869 884 891 908 936 1022
1023 1027 1052 1055 1084 1245 1342 1407 1444 1501 1502 1513 1528 1535 1545 1647 1664 1788 1817 1857 1907 1931 1961 1964 1980 1999 2022 2024 2126 2129 2158 2169 2185 2186 2194
2204 2215 2232 2244 2251 2264 2266 2281 2286 2301 2304 2311 2324 2335 2343 2353 2354 2355 2360 2362 2371/2372 2392 2395 2403 2419 2420 2421 2422 2423 2438 2440 2479 2482 2489
2506 2509 2527 2539 2548 2567 2571 2613 2627 2655 2681 2683 2742 2768 2775 2782 2787 2811 2841 2859 2903 2950 2964 2974 2976 2985 3034 3077 3079 3115 3147 3166 3169 3184 3190
3193 3198 3226 3227 3242 3245 3277 3294 3310 3344 3377 3379 3384 3395 3412 3414 3432 3486 3489 3504 3521 3556 3593 3607 3608 3610 3613 3619 3621 3626 3628 3631 3640 3655 3665
3675 3686 3726 3729 3810 3813 3877 3893 3898 3900 3912 3938 3941 3945 3949 3953 3962 3982 3992 3998 4026 4027 4030 4036 4038 4039 4041 4051 4085 4088 4102 4111 4143 4147 4150
4151 4179 4203 4214 4216 4245 4251 4258 4261 4273 4274 4278 4281 4293 4303 4314 4346 4350 4361 4365 4371 4394 4414 4419 4429 4435 4438 4442 4448 4449 4450 4459 4473 4477 4478
4485 4490 4494 4526 4527 4535 4536 4546 4548 4550 4559 4565 4570 4594 4596 4618 4631 4636 4643 4654 4656 4660 4665 4666 4689 4697 4698 4699 4725 4753 4754 4762 4781 4800 4845
4856 4866 4900 4958 4995 5005 5033 5054 5195 5248 5273 5322 5363 5364 5466 5473 5474 5557 5566 5576 5631 5634 5676 5689 5694 5746 5846 5866 5897 5907 5982 6118 6144 6171 6207
6217 6229 6235 6284 6287 6293 6304 6316 6342 6355 6356 6369 6401 6426 6440 6445 6451 6514 6517 6520 6522 6528 6540 6543 6544 6553 6568 6569 6583 6624 6629 6633 6638 6642 6645
6664 6712 6755 6756 6781 6802 6818 6823 6826 6830 6834 6866 6882 6885 6905 6910 6934 6939 6940 6946 7000 7006 7008 7009 7044 7062 7086 7128 7142 7160 7209 7217 7243 7296 7331
7380 7448 7479 7510 7606 7662 7686 7723 7727 7789 7790 7814`.split(/\s+/).map(n => 'NGC ' + n);
// Herschel II (Astronomical League; the list of the Rose City Astronomers / AL, as NGC numbers, 400 objects)
const H2 = `23 24 125 151 175 198 206 214 217 315 337 357 410 428 499 513 514 604 636 660 665 672 706 718 741 821 890 896 925 991 1003 1012 1032 1035 1045 1058
1060 1070 1073 1087 1090 1114 1156 1161 1162 1169 1172 1175 1184 1187 1193 1199 1207 1209 1325 1332 1348 1353 1400 1421 1491 1507 1514 1579 1582 1587
1600 1605 1618 1624 1637 1662 1663 1700 1762 1778 1779 1832 1883 1977 1985 2023 2071 2112 2139 2170 2182 2192 2196 2236 2245 2252 2254 2259 2261 2269
2274 2283 2302 2309 2316 2331 2339 2346 2347 2359 2366 2367 2374 2396 2414 2415 2432 2467 2493 2500 2525 2541 2610 2639 2756 2765 2781 2784 2805 2855
2880 2889 2986 3065 3067 3073 3078 3107 3145 3156 3158 3162 3177 3225 3254 3274 3301 3319 3338 3359 3424 3430 3507 3511 3513 3516 3524 3547 3583 3585
3596 3599 3605 3611 3622 3636 3637 3642 3646 3652 3659 3666 3668 3669 3672 3681 3682 3683 3689 3693 3705 3732 3756 3887 3892 4013 4024 4039 4045 4047
4062 4073 4096 4100 4105 4124 4133 4136 4138 4144 4152 4157 4168 4169 4185 4189 4212 4217 4220 4224 4233 4235 4236 4237 4241 4244 4248 4250 4256 4260
4264 4267 4270 4271 4290 4291 4294 4298 4299 4302 4310 4312 4313 4319 4336 4339 4340 4343 4359 4369 4379 4395 4487 4517 4519 4571 4586 4605 4608 4612
4639 4647 4691 4742 4880 4902 4904 4914 4915 4928 4939 4941 4956 4981 4984 4999 5012 5018 5020 5023 5037 5044 5053 5056 5061 5068 5077 5078 5084 5087
5103 5129 5134 5204 5308 5371 5383 5426 5430 5440 5443 5444 5445 5447 5448 5462 5480 5481 5485 5490 5493 5506 5507 5520 5523 5529 5533 5548 5560 5582
5585 5590 5595 5597 5600 5602 5605 5638 5660 5668 5687 5728 5750 5775 5791 5806 5812 5813 5831 5838 5850 5854 5861 5864 5878 5879 5899 5970 5985 6015
6058 6070 6106 6155 6166 6181 6239 6340 6507 6526 6548 6596 6604 6717 6772 6793 6800 6804 6814 6824 6857 6888 6894 6907 6960 6991 6992 6997 7023 7031
7042 7067 7082 7129 7139 7156 7171 7177 7184 7218 7245 7332 7354 7377 7392 7419 7457 7463 7465 7492 7507 7541 7562 7600 7619 7623 7626 7635 7640 7742
7762 7785 7814 7832`.split(/\s+/).map(n => 'NGC ' + n);
// SAC's 110 Best of the NGC (Saguaro Astronomy Club, https://www.saguaroastro.org/110-best-ngc-objects); the Double
// Cluster counts as one
const SAC110 = ['NGC 891', 'NGC 7662', 'NGC 6781', 'NGC 7009', 'NGC 7293', 'NGC 772', 'NGC 1907', 'NGC 1931', 'NGC 1501', 'NGC 2403', 'NGC 2655', 'NGC 185',
  'NGC 281', 'NGC 457', 'NGC 663', 'NGC 7789', 'NGC 5128', 'NGC 5139', 'NGC 40', 'NGC 6939', 'NGC 6946', 'NGC 7129', 'NGC 246', 'NGC 936', 'NGC 2359', 'NGC 4274',
  'NGC 4414', 'NGC 4494', 'NGC 4559', 'NGC 4565', 'NGC 4725', 'NGC 4361', 'NGC 4111', 'NGC 4214', 'NGC 4244', 'NGC 4449', 'NGC 4490', 'NGC 4631', 'NGC 4656',
  'NGC 5005', 'NGC 5033', 'NGC 6819', 'NGC 6826', 'NGC 6960', 'NGC 6992', 'NGC 7000', 'NGC 7027', 'NGC 5907', 'NGC 6503', 'NGC 6543', 'NGC 1232', 'NGC 1535',
  'NGC 2158', 'NGC 2392', 'NGC 6207', 'NGC 6210', 'NGC 3242', 'NGC 7209', 'NGC 7243', 'NGC 2903', 'NGC 3384', 'NGC 3521', 'NGC 3607', 'NGC 3628', 'NGC 3344',
  'NGC 3432', 'NGC 2683', 'NGC 2244', 'NGC 2261', 'NGC 6369', 'NGC 6572', 'NGC 6633', 'NGC 1788', 'NGC 1973', 'NGC 2024', 'NGC 2022', 'NGC 2194', 'NGC 7331',
  'NGC 869 & NGC 884', 'NGC 1023', 'NGC 1491', 'NGC 2438', 'NGC 2440', 'NGC 2539', 'NGC 253', 'NGC 6712', 'NGC 3115', 'NGC 6445', 'NGC 6520', 'NGC 6818',
  'NGC 2841', 'NGC 3079', 'NGC 3077', 'NGC 3184', 'NGC 3675', 'NGC 3877', 'NGC 3941', 'NGC 4026', 'NGC 4088', 'NGC 4605', 'NGC 4216', 'NGC 4388', 'NGC 4438',
  'NGC 4526', 'NGC 4535', 'NGC 4567', 'NGC 4699', 'NGC 4762', 'NGC 5746', 'NGC 6940'];
// Popular: the classic showpieces for a small or medium telescope from mid-northern latitudes (curated)
const POPULAR = [
  'Moon', 'Jupiter', 'Saturn', 'Mars', 'Venus',
  'M45', 'M44', 'NGC 869', 'M13', 'M92', 'M3', 'M5', 'M15', 'M22', 'M11', 'M35', 'M36', 'M37', 'M52', 'M103', 'NGC 457', 'M46', 'NGC 7789', 'Cr 399',
  'M42', 'M8', 'M17', 'M20', 'M16', 'M27', 'M57', 'M97', 'M1', 'NGC 6543', 'NGC 7662', 'NGC 7009', 'NGC 2392', 'NGC 6826', 'NGC 6960', 'NGC 6992', 'NGC 7000', 'NGC 7293', 'NGC 2244',
  'M31', 'M33', 'M51', 'M81', 'M82', 'M101', 'M104', 'M64', 'M65', 'M66', 'M63', 'M106', 'M94', 'NGC 4565', 'NGC 891', 'NGC 4631', 'NGC 7331', 'NGC 2403', 'NGC 253'];

const caldwell = CALDWELL.map((e, i) => [i + 1, resolve(e)]).filter(x => x[1]);
// Herschel II and SAC 110 are Pro observing programmes: their objects stay out of the free catalogue (no extras); those it
// lacks come with the extended catalogue (scripts/extended.mjs). A duplicate in OpenNGC counts as its main entry.
function resolveExt(entry) {
  const alts = entry.split(/\s*(?:\/|&)\s*/).map(s => s.trim());
  for (const a of alts) { if (messierOf[a]) return messierOf[a]; if (inDso.has(a) || extra.some(e => e[0] === a)) return a; }
  for (const a of alts) {
    const f = open[a]; if (!f) continue;
    if (f[col('Type')] === 'Dup') { const p = f[col('NGC')] ? 'NGC ' + +f[col('NGC')] : f[col('IC')] ? 'IC ' + +f[col('IC')] : null; if (p && messierOf[p]) return messierOf[p]; if (p && open[p]) return p; continue; }
    if (CLS[f[col('Type')]]) return a;
  }
  missing.push(entry); return null;
}
const herschel2 = [...new Set(H2.map(resolveExt).filter(Boolean))];
const sac110 = [...new Set(SAC110.map(resolveExt).filter(Boolean))];
const herschel = [...new Set(H400.map(resolve).filter(Boolean))];
const PLANETS = new Set(['Moon', 'Jupiter', 'Saturn', 'Mars', 'Venus']);
const popular = POPULAR.map(e => (PLANETS.has(e) || /^M\d+$/.test(e) ? e : resolve(e))).filter(Boolean);
// Shapes of the larger galaxies (major and minor axis in arcminutes, position angle from north through east), so a
// labelled photo can outline them as they are: Messier galaxies and those of the deep catalogue at least 3′ long
const shapes = [];
const shapeOf = (id, desig) => {
  let f = open[desig || id]; if (!f) return;
  if (f[col('Type')] === 'Dup') { const p = f[col('NGC')] ? 'NGC ' + +f[col('NGC')] : f[col('IC')] ? 'IC ' + +f[col('IC')] : null; f = p && open[p]; if (!f) return; }
  const maj = parseFloat(f[col('MajAx')]), min = parseFloat(f[col('MinAx')]), pa = parseFloat(f[col('PosAng')]);
  if (!(maj >= 3) || isNaN(min) || isNaN(pa)) return;
  shapes.push([id, r1(maj), r1(min), Math.round(pa)]);
};
MESSIER.forEach(r => { if (/galaxy/i.test(r[5] || '')) shapeOf(r[0], String(r[6] || '').split(/[,/]/)[0].trim()); });
dso.concat(extra).forEach(d => { if (d[4] === 'gal') shapeOf(d[0]); });
writeFileSync(new URL('public/app/lists.json', root), JSON.stringify({
  source: 'Caldwell (P. Moore), Herschel 400 and Herschel II (Astronomical League), SAC 110 Best of the NGC (Saguaro Astronomy Club), popular: curated. Extra objects and galaxy shapes from OpenNGC (Mattia Verga, CC-BY-SA-4.0).',
  extra, caldwell, herschel, popular, shapes, herschel2, sac110 }));
console.log(`galaxy shapes: ${shapes.length}`);
console.log(`public/app/lists.json: ${caldwell.length} Caldwell, ${herschel.length} Herschel 400, ${popular.length} popular, ${extra.length} objects added from OpenNGC`);
if (missing.length) console.log('not found:', missing.join(', '));
