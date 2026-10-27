// Night sky topic pages, all calculated with Astronomy Engine and linked with the weekly posts (scripts/sky.mjs):
//   /sky/moon/                  the Moon: its next phases, the years, about the phases and observing
//   /sky/moon/<year>/           Moon calendar: every phase of the year, full Moon names, supermoons, blue moons,
//                               eclipses, the darkest nights of each month
//   /sky/meteor-showers/        the meteor showers of the year, by their next peak
//   /sky/meteor-showers/<slug>/ one shower: peak (from the solar longitude of its maximum), the Moon at the peak in the
//                               next years, the radiant, words about it
//   /sky/calendar/<year>/       every event of the year by month: eclipses (seen from a few cities), meteor showers,
//                               Moon and planets close together, oppositions, elongations, seasons, full and new Moons
//   /sky/                       an overview, only while no week is published (otherwise the week, scripts/sky.mjs)
// Each also under /de/…, German times in CET/CEST, English in UTC (turned into the reader's zone in the browser).
// Years: from 2026 to the year after the build.
import { createRequire } from 'node:module';
import { L, LANGS, MONTH, PL_DE, CON_DE, esc, pageHtml, moonSvg, weekPath, skyPath, skyNav, fmtAt, timeTag, tzNote, tzScript, ZONE, LOCALE, weekStart, rangeText } from './sky.mjs';

const require = createRequire(import.meta.url);
const A = require('astronomy-engine');
const ZEvents = require('../src/events.js');
const DAY = 864e5, T = d => A.MakeTime(d);
export const FIRST_YEAR = 2026;
const iso = d => d.toISOString().replace(/\.\d+Z$/, 'Z');
const mslug = m => MONTH.en[m].toLowerCase();
// year, month (0–11), day of a moment in the page's time zone
const partsIn = (d, lang) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: ZONE[lang], year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d).map(x => [x.type, x.value])); return { y: +p.year, m: +p.month - 1, d: +p.day }; };
const dayText = (d, lang, opts) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: ZONE[lang], day: 'numeric', month: 'long', ...(opts || {}) }).format(d);
const CON_DE2 = { ...CON_DE, Bootes: 'Bärenhüter', Lyra: 'Leier', Perseus: 'Perseus', Draco: 'Drache', 'Ursa Minor': 'Kleiner Bär', 'Ursa Major': 'Großer Bär', Hercules: 'Herkules', Andromeda: 'Andromeda', Cassiopeia: 'Kassiopeia' };
const conName = (c, lang) => lang === 'de' ? CON_DE2[c] || c : c === 'Bootes' ? 'Boötes' : c;
const plName = (b, lang) => lang === 'de' ? PL_DE[b] || b : b;

// ---------- words ----------
const W = {
  en: {
    more: 'More on this', moonMonth: (m, y) => `Moon calendar: ${m} ${y}`, calMonth: (m, y) => `All events in ${m} ${y}`, showerLink: n => `${n}: peak, Moon and radiant`,
    moonTitle: 'The Moon’s phases: next full Moon and new Moon', moonIntro: 'When is the next full Moon or new Moon? The Moon’s phases for this year and next, with the darkest nights for galaxies, nebulae and meteors.',
    nextPhases: 'The next phases', years: 'Moon calendar by year', moonYearLink: y => `Moon calendar ${y}`, openMoon: 'Open the Moon in Zenigo',
    aboutPhasesH: 'The phases', aboutPhases: 'The Moon takes 29.5 days from one new Moon to the next. At new Moon it stands between Earth and Sun and can’t be seen. At first quarter it is half lit and high in the evening sky; at full Moon it is opposite the Sun and up all night; at last quarter it rises around midnight.',
    observeH: 'The Moon and observing', observe: 'A bright Moon washes out faint galaxies, nebulae and meteors. The week around new Moon gives the darkest nights; around full Moon the Moon itself, the planets and double stars are the better targets. In a telescope the Moon shows the most detail along the terminator, the line between day and night, so the days around the quarters are best.',
    yearTitle: y => `Moon calendar ${y}: every full Moon, new Moon and quarter`, yearH1: y => `Moon calendar ${y}`,
    yearIntro: (y, next) => `Every phase of the Moon in ${y}, with the full Moon names, supermoons and the darkest nights of each month.` + (next ? ` Next full Moon: ${next}.` : ''),
    yearDesc: y => `All Moon phases of ${y}: dates and times of every full Moon, new Moon and quarter, full Moon names, supermoons, blue moons and the darkest nights for observing.`,
    supermoon: 'Supermoon', blue: 'Blue Moon', eclipse: 'Eclipse', dark: (a, b) => `Darkest nights: ${a} to ${b}, around the new Moon.`, weekPost: 'Night sky that week',
    names: ['Wolf Moon', 'Snow Moon', 'Worm Moon', 'Pink Moon', 'Flower Moon', 'Strawberry Moon', 'Buck Moon', 'Sturgeon Moon', 'Corn Moon', 'Hunter’s Moon', 'Beaver Moon', 'Cold Moon'], harvest: 'Harvest Moon', hunter: 'Hunter’s Moon',
    namesNote: 'The full Moon names are the traditional ones of North America; the Harvest Moon is the full Moon nearest the September equinox. A supermoon here is a full Moon closer than 360,000 km; a blue moon the second full Moon of a calendar month (in UTC).',
    showersTitle: 'Meteor showers: when they peak and how the Moon affects them', showersH1: 'Meteor showers',
    showersIntro: 'The meteor showers of the year in the order of their next peak, with how much the Moon will brighten the sky.',
    showersTipsH: 'How to watch a meteor shower', showersTips: ['Get away from lights and give your eyes 20 minutes to adapt.', 'Lie back and look about halfway up the sky, not straight at the radiant: meteors are longer away from it.', 'Most showers are best after midnight, when the radiant is high and your side of the Earth faces the stream.', 'No telescope or binoculars needed: they show too little sky.'],
    th: { name: 'Shower', active: 'Active', peak: 'Next peak', zhr: 'Per hour', moon: 'Moon' }, perHour: n => `up to ${n}`, lit: k => `${k} % lit`,
    showerTitle: (n, y) => `${n} ${y}: peak, Moon and where to look`, showerDesc: (n, y, night, k) => `The ${n} ${y}: the peak in the night of ${night}, the Moon ${k} % lit, where the radiant stands and how many meteors to expect.`,
    facts: { active: 'Active', peak: y => `Peak ${y}`, rate: 'Rate at the peak', speed: 'Speed', radiant: 'Radiant', parent: 'Source', moon: 'Moon at the peak' },
    night: (a, b) => `night of ${a} to ${b}`, rateText: n => `up to ${n} meteors an hour under a dark sky (ZHR)`, kms: v => `${v} km/s`,
    radiantH: 'Where to look', radiantText: (con, n, s, h) => `The meteors seem to come from a point in ${con}. ${n}${s} ${h}`,
    fromN: a => a > 0 ? `From 50° N it climbs to ${a}° above the horizon; ` : 'From 50° N it stays below the horizon; ', fromS: a => a > 0 ? `from 35° S to ${a}°.` : 'from 35° S it stays below the horizon.',
    highAt: h => h >= 6 && h < 12 ? `It is highest in the morning, so the hours before dawn are best.` : h >= 12 && h < 18 ? `It is highest in the afternoon, so the evening is best.` : `It is highest around ${h === 0 ? 'midnight' : h < 6 ? h + ' a.m.' : h - 12 + ' p.m.'} local time.`,
    tipH: 'Tips', nextYearsH: 'The next years', thY: { year: 'Year', night: 'Peak night', moon: 'Moon', rating: 'Conditions' }, rating: ['good', 'fair', 'poor'],
    weeksH: 'In the weekly night sky', allShowers: 'All meteor showers', inCal: y => `Calendar ${y}`,
    calTitle: y => `Astronomy calendar ${y}: eclipses, meteor showers, planets and the Moon`, calH1: y => `Astronomy calendar ${y}`,
    calIntro: y => `Every event of ${y} worth going out for, month by month: eclipses, meteor showers, the Moon passing planets, planets close together, oppositions, the seasons and the full and new Moons.`,
    calDesc: y => `The night sky events of ${y} by month: eclipses with where they can be seen, meteor showers with the Moon, conjunctions, oppositions, equinoxes and solstices, full and new Moons.`,
    highlightsH: 'Highlights of the year', weeksIn: 'Weekly night sky', none: 'Nothing calculated for this month.',
    seasons: ['March equinox', 'June solstice', 'September equinox', 'December solstice'], seasonsSub: ['day and night about equal', 'longest day in the north', 'day and night about equal', 'shortest day in the north'],
    moonPasses: (p, s) => `Moon passes ${p} (${s}°)`, occ: 'an occultation seen from some parts of the Earth', pair: (a, b, s) => `${a} and ${b} ${s}° apart`, sky: v => `${v} sky`,
    opp: p => `${p} at opposition`, oppSub: 'closest and brightest, up all night', elong: p => `${p} at greatest elongation`, elongSub: (d, v) => `${d}° from the Sun, ${v} sky`,
    lunar: { total: 'Total lunar eclipse', partial: 'Partial lunar eclipse', penumbral: 'Penumbral lunar eclipse' }, solar: { total: 'Total solar eclipse', annular: 'Annular solar eclipse', partial: 'Partial solar eclipse', hybrid: 'Hybrid solar eclipse' },
    showerPeak: n => `${n} peak`, showerSub: (z, k) => `up to ${z} an hour · Moon ${k} % lit`, fullMoon: 'Full Moon', newMoon: 'New Moon',
    seenFrom: 'Seen from', covered: k => `${k} % covered`, totalHere: 'total', annularHere: 'annular', moonUp: a => `Moon ${a}° high`, notSeen: 'not visible', solarSafe: 'Only with a certified solar filter.',
    overviewTitle: 'Night sky: what to see this week, the Moon, meteor showers and the year’s events', overviewH1: 'Night sky',
    overviewIntro: 'Every week the events worth seeing in the night sky, the Moon’s phases, the meteor showers and the calendar of the year.', comingUp: 'Coming up',
    cards: { moon: 'Moon calendar', moonSub: next => `Next full Moon: ${next}`, showers: 'Meteor showers', showersSub: (n, d) => `Next: ${n}, ${d}`, calendar: y => `Calendar ${y}`, calendarSub: 'Eclipses, planets and more, month by month' },
    calc: 'Calculated with Astronomy Engine; meteor shower data from the International Meteor Organization.',
  },
  de: {
    more: 'Mehr dazu', moonMonth: (m, y) => `Mondkalender: ${m} ${y}`, calMonth: (m, y) => `Alle Ereignisse im ${m} ${y}`, showerLink: n => `${n}: Maximum, Mond und Radiant`,
    moonTitle: 'Mondphasen: der nächste Vollmond und Neumond', moonIntro: 'Wann ist der nächste Vollmond oder Neumond? Die Mondphasen für dieses und das nächste Jahr, mit den dunkelsten Nächten für Galaxien, Nebel und Meteore.',
    nextPhases: 'Die nächsten Phasen', years: 'Mondkalender nach Jahr', moonYearLink: y => `Mondkalender ${y}`, openMoon: 'Den Mond in Zenigo öffnen',
    aboutPhasesH: 'Die Phasen', aboutPhases: 'Von einem Neumond zum nächsten braucht der Mond 29,5 Tage. Bei Neumond steht er zwischen Erde und Sonne und ist nicht zu sehen. Im ersten Viertel ist er halb beleuchtet und steht abends hoch; bei Vollmond steht er der Sonne gegenüber und ist die ganze Nacht zu sehen; im letzten Viertel geht er gegen Mitternacht auf.',
    observeH: 'Der Mond und das Beobachten', observe: 'Ein heller Mond überstrahlt lichtschwache Galaxien, Nebel und Meteore. Die Woche um Neumond bringt die dunkelsten Nächte; um Vollmond sind der Mond selbst, die Planeten und Doppelsterne die besseren Ziele. Im Teleskop zeigt der Mond die meisten Details entlang des Terminators, der Grenze zwischen Tag und Nacht: Die Tage um die Viertel sind am besten.',
    yearTitle: y => `Mondkalender ${y}: alle Vollmonde, Neumonde und Viertel`, yearH1: y => `Mondkalender ${y}`,
    yearIntro: (y, next) => `Alle Mondphasen ${y}, mit den Namen der Vollmonde, Supermonden und den dunkelsten Nächten jedes Monats.` + (next ? ` Nächster Vollmond: ${next}.` : ''),
    yearDesc: y => `Alle Mondphasen ${y}: Datum und Uhrzeit jedes Vollmonds, Neumonds und Viertels, Vollmondnamen, Supermonde, Blue Moons und die dunkelsten Nächte zum Beobachten.`,
    supermoon: 'Supermond', blue: 'Blue Moon', eclipse: 'Finsternis', dark: (a, b) => `Dunkelste Nächte: ${a} bis ${b}, rund um den Neumond.`, weekPost: 'Sternenhimmel dieser Woche',
    names: ['Wolfsmond', 'Schneemond', 'Wurmmond', 'Rosa Mond', 'Blumenmond', 'Erdbeermond', 'Hirschmond', 'Störmond', 'Maismond', 'Jägermond', 'Bibermond', 'Kalter Mond'], harvest: 'Erntemond', hunter: 'Jägermond',
    namesNote: 'Die Vollmondnamen folgen den überlieferten Namen Nordamerikas; der Erntemond ist der Vollmond, der der Herbst-Tagundnachtgleiche am nächsten liegt. Ein Supermond ist hier ein Vollmond näher als 360 000 km, ein Blue Moon der zweite Vollmond eines Kalendermonats (nach deutscher Zeit).',
    showersTitle: 'Meteorströme: wann ihr Maximum ist und wie der Mond stört', showersH1: 'Meteorströme',
    showersIntro: 'Die Meteorströme des Jahres in der Reihenfolge ihres nächsten Maximums, mit dem Mondlicht in diesen Nächten.',
    showersTipsH: 'So beobachtest du einen Meteorstrom', showersTips: ['Geh weg vom Licht und gib deinen Augen 20 Minuten, um sich an die Dunkelheit zu gewöhnen.', 'Leg dich hin und schau etwa auf halbe Höhe, nicht direkt zum Radianten: Weiter weg sind die Spuren länger.', 'Die meisten Ströme sind nach Mitternacht am besten, wenn der Radiant hoch steht und deine Erdseite dem Strom zugewandt ist.', 'Kein Teleskop und kein Fernglas: Sie zeigen zu wenig Himmel.'],
    th: { name: 'Strom', active: 'Aktiv', peak: 'Nächstes Maximum', zhr: 'Pro Stunde', moon: 'Mond' }, perHour: n => `bis ${n}`, lit: k => `${k} % beleuchtet`,
    showerTitle: (n, y) => `${n} ${y}: Maximum, Mond und wohin du schauen musst`, showerDesc: (n, y, night, k) => `Die ${n} ${y}: das Maximum in der Nacht ${night}, der Mond zu ${k} % beleuchtet, wo der Radiant steht und wie viele Meteore du erwarten kannst.`,
    facts: { active: 'Aktiv', peak: y => `Maximum ${y}`, rate: 'Rate im Maximum', speed: 'Geschwindigkeit', radiant: 'Radiant', parent: 'Ursprung', moon: 'Mond im Maximum' },
    night: (a, b) => `vom ${a} auf den ${b}`, rateText: n => `bis zu ${n} Meteore pro Stunde unter dunklem Himmel (ZHR)`, kms: v => `${v} km/s`,
    radiantH: 'Wohin schauen', radiantText: (con, n, s, h) => `Die Meteore scheinen aus einem Punkt im Sternbild ${con} zu kommen. ${n}${s} ${h}`,
    fromN: a => a > 0 ? `Von 50° Nord aus steigt er bis ${a}° über den Horizont, ` : 'Von 50° Nord aus bleibt er unter dem Horizont, ', fromS: a => a > 0 ? `von 35° Süd bis ${a}°.` : 'von 35° Süd aus bleibt er unter dem Horizont.',
    highAt: h => h >= 6 && h < 12 ? 'Am höchsten steht er am Morgen, die Stunden vor der Dämmerung sind also am besten.' : h >= 12 && h < 18 ? 'Am höchsten steht er am Nachmittag, der Abend ist also am besten.' : `Am höchsten steht er gegen ${h} Uhr Ortszeit.`,
    tipH: 'Tipps', nextYearsH: 'Die nächsten Jahre', thY: { year: 'Jahr', night: 'Nacht des Maximums', moon: 'Mond', rating: 'Bedingungen' }, rating: ['gut', 'mittel', 'schlecht'],
    weeksH: 'Im wöchentlichen Sternenhimmel', allShowers: 'Alle Meteorströme', inCal: y => `Kalender ${y}`,
    calTitle: y => `Himmelsereignisse ${y}: Finsternisse, Meteorströme, Planeten und Mond`, calH1: y => `Himmelsereignisse ${y}`,
    calIntro: y => `Alle Ereignisse ${y}, für die sich der Blick nach oben lohnt, Monat für Monat: Finsternisse, Meteorströme, der Mond bei den Planeten, Planeten nah beieinander, Oppositionen, die Jahreszeiten sowie Voll- und Neumonde.`,
    calDesc: y => `Die Himmelsereignisse ${y} nach Monaten: Finsternisse und wo sie zu sehen sind, Meteorströme mit dem Mond, Konjunktionen, Oppositionen, Tagundnachtgleichen und Sonnenwenden, Voll- und Neumonde.`,
    highlightsH: 'Höhepunkte des Jahres', weeksIn: 'Wöchentlicher Sternenhimmel', none: 'Für diesen Monat ist nichts berechnet.',
    seasons: ['Frühlingsanfang', 'Sommeranfang', 'Herbstanfang', 'Winteranfang'], seasonsSub: ['Tagundnachtgleiche', 'Sonnenwende, längster Tag', 'Tagundnachtgleiche', 'Sonnenwende, kürzester Tag'],
    moonPasses: (p, s) => `Mond bei ${p} (${s}°)`, occ: 'von manchen Orten der Erde aus eine Bedeckung', pair: (a, b, s) => `${a} und ${b} ${s}° beieinander`, sky: v => v === 'morning' ? 'am Morgenhimmel' : 'am Abendhimmel',
    opp: p => `${p} in Opposition`, oppSub: 'am hellsten, die ganze Nacht zu sehen', elong: p => `${p} in größter Elongation`, elongSub: (d, v) => `${d}° von der Sonne, ${v === 'morning' ? 'am Morgenhimmel' : 'am Abendhimmel'}`,
    lunar: { total: 'Totale Mondfinsternis', partial: 'Partielle Mondfinsternis', penumbral: 'Halbschatten-Mondfinsternis' }, solar: { total: 'Totale Sonnenfinsternis', annular: 'Ringförmige Sonnenfinsternis', partial: 'Partielle Sonnenfinsternis', hybrid: 'Hybride Sonnenfinsternis' },
    showerPeak: n => `${n}: Maximum`, showerSub: (z, k) => `bis ${z} pro Stunde · Mond ${k} % beleuchtet`, fullMoon: 'Vollmond', newMoon: 'Neumond',
    seenFrom: 'Gesehen aus', covered: k => `${k} % bedeckt`, totalHere: 'total', annularHere: 'ringförmig', moonUp: a => `Mond ${a}° hoch`, notSeen: 'nicht zu sehen', solarSafe: 'Nur mit zertifiziertem Sonnenfilter beobachten.',
    overviewTitle: 'Sternenhimmel: was diese Woche zu sehen ist, Mond, Meteorströme und die Ereignisse des Jahres', overviewH1: 'Sternenhimmel',
    overviewIntro: 'Jede Woche die sehenswerten Ereignisse am Nachthimmel, die Mondphasen, die Meteorströme und der Kalender des Jahres.', comingUp: 'Demnächst',
    cards: { moon: 'Mondkalender', moonSub: next => `Nächster Vollmond: ${next}`, showers: 'Meteorströme', showersSub: (n, d) => `Als Nächstes: ${n}, ${d}`, calendar: y => `Kalender ${y}`, calendarSub: 'Finsternisse, Planeten und mehr, Monat für Monat' },
    calc: 'Berechnet mit Astronomy Engine; Daten der Meteorströme von der International Meteor Organization.',
  },
};

// ---------- meteor showers ----------
// IMO data: solar longitude of the maximum (J2000), activity (month 1–12, day), radiant (hours, degrees), ZHR, speed
export const SHOWERS = [
  { slug: 'quadrantids', sl: 283.15, active: [[12, 28], [1, 12]], ra: 15.33, dec: 49, zhr: 80, v: 41, name: { en: 'Quadrantids', de: 'Quadrantiden' }, parent: { en: 'asteroid 2003 EH1, probably a broken-up comet', de: 'Asteroid 2003 EH1, wohl ein zerfallener Komet' },
    text: { en: 'The Quadrantids are one of the strongest showers of the year, but their peak is short: the best rates last only a few hours. The meteors seem to come from the north-east, near the handle of the Big Dipper, from the old constellation Quadrans Muralis that gave the shower its name.', de: 'Die Quadrantiden gehören zu den stärksten Strömen des Jahres, ihr Maximum ist aber kurz: Die besten Raten halten nur wenige Stunden an. Die Meteore scheinen aus dem Nordosten zu kommen, nahe der Deichsel des Großen Wagens, aus dem alten Sternbild Mauerquadrant, das dem Strom seinen Namen gab.' },
    tip: { en: 'Watch in the second half of the night, when the radiant is high in the north-east. Dress for winter: you will be sitting still for an hour or more.', de: 'Beobachte in der zweiten Nachthälfte, wenn der Radiant hoch im Nordosten steht. Zieh dich winterfest an: Du sitzt eine Stunde oder länger still.' } },
  { slug: 'lyrids', sl: 32.32, active: [[4, 14], [4, 30]], ra: 18.07, dec: 34, zhr: 18, v: 49, name: { en: 'Lyrids', de: 'Lyriden' }, parent: { en: 'Comet C/1861 G1 (Thatcher)', de: 'Komet C/1861 G1 (Thatcher)' },
    text: { en: 'The Lyrids are the oldest recorded meteor shower: Chinese astronomers noted them 2,700 years ago. Usually they bring a modest 15 to 20 meteors an hour with fast, bright trails, but now and then they surprise with a short burst. The radiant lies near Vega in Lyra.', de: 'Die Lyriden sind der älteste überlieferte Meteorstrom: Chinesische Astronomen beschrieben sie schon vor 2700 Jahren. Meist bringen sie bescheidene 15 bis 20 Meteore pro Stunde mit schnellen, hellen Spuren, ab und zu überraschen sie mit einem kurzen Ausbruch. Der Radiant liegt nahe der Wega in der Leier.' },
    tip: { en: 'The radiant rises in the evening and is highest before dawn, so the hours after midnight are best.', de: 'Der Radiant geht abends auf und steht vor der Morgendämmerung am höchsten: Die Stunden nach Mitternacht sind am besten.' } },
  { slug: 'eta-aquariids', sl: 45.5, active: [[4, 19], [5, 28]], ra: 22.53, dec: -1, zhr: 50, v: 66, name: { en: 'Eta Aquariids', de: 'Eta-Aquariiden' }, parent: { en: 'Halley’s Comet (1P/Halley)', de: 'Halleyscher Komet (1P/Halley)' },
    text: { en: 'The Eta Aquariids are dust from Halley’s Comet: fast meteors, often with glowing trails. From the southern hemisphere they are among the best showers of the year; from mid-northern latitudes the radiant rises only shortly before dawn, and you see far fewer.', de: 'Die Eta-Aquariiden sind Staub des Halleyschen Kometen: schnelle Meteore, oft mit nachleuchtenden Spuren. Auf der Südhalbkugel gehören sie zu den besten Strömen des Jahres; in mittleren nördlichen Breiten geht der Radiant erst kurz vor der Dämmerung auf, man sieht dort deutlich weniger.' },
    tip: { en: 'Look east in the last two hours before dawn.', de: 'Schau in den letzten zwei Stunden vor der Dämmerung nach Osten.' } },
  { slug: 'perseids', sl: 140.0, active: [[7, 17], [8, 24]], ra: 3.2, dec: 58, zhr: 100, v: 59, name: { en: 'Perseids', de: 'Perseiden' }, parent: { en: 'Comet Swift–Tuttle (109P)', de: 'Komet Swift-Tuttle (109P)' },
    text: { en: 'The Perseids are the best-known shower of the year: warm summer nights in the north and up to 100 meteors an hour at the peak, many of them bright, some with lasting trails. Activity builds for weeks, so the nights before and after the peak are worth it too.', de: 'Die Perseiden sind der bekannteste Strom des Jahres: laue Sommernächte im Norden und bis zu 100 Meteore pro Stunde im Maximum, viele davon hell, manche mit nachleuchtender Spur. Die Aktivität steigt über Wochen an, auch die Nächte vor und nach dem Maximum lohnen sich.' },
    tip: { en: 'The radiant in Perseus climbs all night, so the rates rise towards dawn. Lie on a lounger and take in as much sky as you can.', de: 'Der Radiant im Perseus steigt die ganze Nacht, die Raten nehmen zum Morgen hin zu. Leg dich auf eine Liege und überblicke so viel Himmel wie möglich.' } },
  { slug: 'draconids', sl: 195.4, active: [[10, 6], [10, 10]], ra: 17.47, dec: 54, zhr: 10, v: 20, name: { en: 'Draconids', de: 'Draconiden' }, parent: { en: 'Comet Giacobini–Zinner (21P)', de: 'Komet Giacobini-Zinner (21P)' },
    text: { en: 'The Draconids are usually a quiet shower, but known for rare storms: in 1933 and 1946 thousands of meteors an hour were seen. They are slow meteors and, unlike most showers, best in the evening, when the radiant in Draco stands high.', de: 'Die Draconiden sind meist ein ruhiger Strom, bekannt aber für seltene Meteorstürme: 1933 und 1946 fielen Tausende Meteore pro Stunde. Es sind langsame Meteore und anders als bei den meisten Strömen ist der Abend am besten, wenn der Radiant im Drachen hoch steht.' },
    tip: { en: 'Watch in the evening after dark; by the morning the radiant is low.', de: 'Beobachte abends nach Einbruch der Dunkelheit; zum Morgen hin steht der Radiant tief.' } },
  { slug: 'orionids', sl: 208, active: [[10, 2], [11, 7]], ra: 6.33, dec: 16, zhr: 20, v: 66, name: { en: 'Orionids', de: 'Orioniden' }, parent: { en: 'Halley’s Comet (1P/Halley)', de: 'Halleyscher Komet (1P/Halley)' },
    text: { en: 'The Orionids are the second shower from Halley’s Comet each year. They are fast and mostly faint, with now and then a bright one leaving a glowing trail. The maximum is broad: several nights around the peak give similar rates.', de: 'Die Orioniden sind der zweite Strom des Halleyschen Kometen im Jahr. Sie sind schnell und meist eher schwach, ab und zu leuchtet ein heller mit nachglühender Spur auf. Das Maximum ist breit: Mehrere Nächte um den Höhepunkt bringen ähnliche Raten.' },
    tip: { en: 'The radiant near Orion’s club rises around midnight; the best hours are before dawn.', de: 'Der Radiant nahe Orions Keule geht gegen Mitternacht auf; am besten sind die Stunden vor der Dämmerung.' } },
  { slug: 'taurids', sl: 230, active: [[9, 10], [12, 10]], ra: 3.87, dec: 22, zhr: 5, v: 29, name: { en: 'Taurids', de: 'Tauriden' }, parent: { en: 'Comet Encke (2P)', de: 'Komet Encke (2P)' },
    text: { en: 'The Taurids come in two branches: the Southern Taurids peak around 10 October, the Northern Taurids around 12 November (the peak given here). Together they are active for three months, but with only about 5 meteors an hour. What makes them special are slow, bright fireballs, more common in years when the Earth crosses a denser swarm.', de: 'Die Tauriden haben zwei Zweige: Die Südlichen Tauriden haben ihr Maximum um den 10. Oktober, die Nördlichen um den 12. November (das Maximum hier). Zusammen sind sie drei Monate aktiv, mit nur etwa 5 Meteoren pro Stunde. Besonders sind ihre langsamen, hellen Feuerkugeln, häufiger in Jahren, in denen die Erde einen dichteren Schwarm kreuzt.' },
    tip: { en: 'No need to wait for the peak: any dark night from October to mid-November can bring a Taurid fireball. The radiant near the Pleiades is up from the evening.', de: 'Auf das Maximum musst du nicht warten: Jede dunkle Nacht von Oktober bis Mitte November kann eine Tauriden-Feuerkugel bringen. Der Radiant nahe den Plejaden steht ab dem Abend am Himmel.' } },
  { slug: 'leonids', sl: 235.27, active: [[11, 6], [11, 30]], ra: 10.2, dec: 22, zhr: 15, v: 71, name: { en: 'Leonids', de: 'Leoniden' }, parent: { en: 'Comet Tempel–Tuttle (55P)', de: 'Komet Tempel-Tuttle (55P)' },
    text: { en: 'The Leonids are the fastest meteors of the year, hitting the atmosphere at 71 km/s. Most years they are a modest shower of 10 to 15 an hour, but around the returns of Comet Tempel–Tuttle every 33 years they have produced storms, in 1833, 1966 and around 2000.', de: 'Die Leoniden sind die schnellsten Meteore des Jahres: Sie treffen mit 71 km/s auf die Atmosphäre. In den meisten Jahren sind sie ein bescheidener Strom mit 10 bis 15 pro Stunde, doch um die Wiederkehr des Kometen Tempel-Tuttle alle 33 Jahre gab es Meteorstürme, 1833, 1966 und um 2000.' },
    tip: { en: 'The radiant in Leo rises around midnight; watch in the hours before dawn.', de: 'Der Radiant im Löwen geht gegen Mitternacht auf; beobachte in den Stunden vor der Dämmerung.' } },
  { slug: 'geminids', sl: 262.2, active: [[12, 4], [12, 20]], ra: 7.47, dec: 33, zhr: 150, v: 35, name: { en: 'Geminids', de: 'Geminiden' }, parent: { en: 'asteroid 3200 Phaethon', de: 'Asteroid 3200 Phaethon' },
    text: { en: 'The Geminids are the richest shower of the year, with up to 150 meteors an hour under a dark sky. They are slow and often bright, and unlike most showers they come from an asteroid. The radiant near Castor is up from the evening, so the Geminids are good before midnight too.', de: 'Die Geminiden sind der ergiebigste Strom des Jahres, mit bis zu 150 Meteoren pro Stunde unter dunklem Himmel. Sie sind langsam und oft hell, und anders als die meisten Ströme stammen sie von einem Asteroiden. Der Radiant nahe Kastor steht schon abends am Himmel, die Geminiden lohnen sich also auch vor Mitternacht.' },
    tip: { en: 'Dress for a December night and give it at least an hour. The rates are best around 2 a.m., when the radiant is highest.', de: 'Zieh dich für eine Dezembernacht an und nimm dir mindestens eine Stunde Zeit. Am meisten fallen gegen 2 Uhr, wenn der Radiant am höchsten steht.' } },
  { slug: 'ursids', sl: 270.7, active: [[12, 17], [12, 26]], ra: 14.47, dec: 76, zhr: 10, v: 33, name: { en: 'Ursids', de: 'Ursiden' }, parent: { en: 'Comet Tuttle (8P)', de: 'Komet Tuttle (8P)' },
    text: { en: 'The Ursids close the year just before Christmas: a small shower of about 10 meteors an hour, with occasional outbursts. From mid-northern latitudes the radiant near the Little Dipper never sets.', de: 'Die Ursiden schließen das Jahr kurz vor Weihnachten ab: ein kleiner Strom mit etwa 10 Meteoren pro Stunde und gelegentlichen Ausbrüchen. In mittleren nördlichen Breiten geht der Radiant nahe dem Kleinen Wagen nie unter.' },
    tip: { en: 'Best in the hours before dawn, when the radiant is highest in the north.', de: 'Am besten in den Stunden vor der Dämmerung, wenn der Radiant hoch im Norden steht.' } },
];
// The peak of a shower in a year: when the Sun reaches the solar longitude of its maximum (J2000, turned to the
// equinox of date), with the Moon's light then
export function showerPeak(s, year) {
  const lon = (s.sl + 1.3969713 * (year - 2000) / 100) % 360;
  const t = A.SearchSunLongitude(lon, T(new Date(Date.UTC(year, 0, 1))), 367);
  const d = t.date, k = A.Illumination(A.Body.Moon, t).phase_fraction;
  return { d, k, phase: A.MoonPhase(t) };
}
// the next peak from a moment on (this year's, or next year's when it has passed by more than two days)
const nextPeak = (s, now) => { const y = now.getUTCFullYear(), p = showerPeak(s, y); return p.d.getTime() > now.getTime() - 2 * DAY ? { ...p, year: y } : { ...showerPeak(s, y + 1), year: y + 1 }; };
// "night of 13 to 14 December": a peak before noon belongs to the night before (in the page's zone)
function peakNight(d, lang) {
  const p = partsIn(d, lang), h = +new Intl.DateTimeFormat('en-GB', { timeZone: ZONE[lang], hour: 'numeric', hourCycle: 'h23' }).format(d);
  const day = new Date(Date.UTC(p.y, p.m, p.d) - (h < 12 ? DAY : 0)), f = x => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(x);
  return { a: f(day), b: f(new Date(day.getTime() + DAY)), first: day };
}
// "13–14 December" / "13./14. Dezember" (the night of the peak)
function nightShort(first, lang, year) {
  const b = new Date(first.getTime() + DAY), M = MONTH[lang], [d1, m1, d2, m2] = [first.getUTCDate(), first.getUTCMonth(), b.getUTCDate(), b.getUTCMonth()], yy = year ? ' ' + b.getUTCFullYear() : '';
  if (lang === 'de') return m1 === m2 ? `${d1}./${d2}. ${M[m2]}${yy}` : `${d1}. ${M[m1]} / ${d2}. ${M[m2]}${yy}`;
  return m1 === m2 ? `${d1}–${d2} ${M[m2]}${yy}` : `${d1} ${M[m1]} – ${d2} ${M[m2]}${yy}`;
}
const activeText = (s, lang) => s.active.map(([m, d]) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(2026, m - 1, d)))).join(' – ');
const rateClass = k => k < 0.3 ? 0 : k < 0.7 ? 1 : 2;

// ---------- the Moon ----------
// every phase of a year (UTC), with the full Moon's name, supermoon, blue moon (in the page's zone) and eclipses
export function moonYear(year, lang, eclipses = []) {
  const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year + 1, 0, 1)), w = W[lang];
  const ph = ZEvents.search(A, { from: new Date(from.getTime() - 3 * DAY), to: new Date(to.getTime() + 3 * DAY), skip: ['lunar-eclipse', 'solar-eclipse', 'moon-planet', 'planet-planet', 'opposition', 'elongation', 'meteor-shower'] })
    .map(q => ({ ...q, at: partsIn(q.peak, lang) })).filter(q => q.at.y === year);
  const equinox = A.Seasons(year).sep_equinox.date, fulls = ph.filter(q => q.quarter === 2);
  const harvest = fulls.reduce((b, q) => !b || Math.abs(q.peak - equinox) < Math.abs(b.peak - equinox) ? q : b, null), hunter = fulls[fulls.indexOf(harvest) + 1];
  const perMonth = {};
  for (const q of ph) {
    if (q.quarter === 2) {
      const n = (perMonth[q.at.m] = (perMonth[q.at.m] || 0) + 1);
      q.blue = n === 2;
      q.name = q.blue ? w.blue : q === harvest ? w.harvest : q === hunter ? w.hunter : w.names[q.at.m];
      q.km = Math.hypot(...['x', 'y', 'z'].map(c => A.GeoMoon(T(q.peak))[c])) * A.KM_PER_AU;
      q.super = q.km < 360000;
    }
    q.eclipse = eclipses.find(e => Math.abs(e.peak - q.peak) < 0.75 * DAY && ((q.quarter === 2 && e.type === 'lunar-eclipse') || (q.quarter === 0 && e.type === 'solar-eclipse')));
  }
  return ph;
}

// ---------- the calendar of a year ----------
const CITIES = { en: [['London', 51.51, -0.13], ['New York', 40.71, -74.01], ['Los Angeles', 34.05, -118.24], ['Sydney', -33.87, 151.21]],
  de: [['Berlin', 52.52, 13.4], ['München', 48.14, 11.58], ['Wien', 48.21, 16.37], ['Zürich', 47.38, 8.54]] };
// where the eclipses of 2026 and 2027 can be seen (not calculated here)
const ECLIPSE_WHERE = {
  '2026-02-17': { en: 'Annular in Antarctica.', de: 'Ringförmig in der Antarktis.' },
  '2026-03-03': { en: 'Seen from East Asia, Australia, the Pacific and the Americas.', de: 'Zu sehen in Ostasien, Australien, im Pazifik und in Amerika.' },
  '2026-08-12': { en: 'Total in Greenland, Iceland and northern Spain; partial in Europe, North Africa and the far north of America.', de: 'Total in Grönland, Island und Nordspanien; partiell in Europa, Nordafrika und im hohen Norden Amerikas.' },
  '2026-08-28': { en: 'Seen from the Americas, Europe, Africa and western Asia.', de: 'Zu sehen in Amerika, Europa, Afrika und Westasien.' },
  '2027-02-06': { en: 'Annular across South America and the Atlantic to West Africa.', de: 'Ringförmig über Südamerika und den Atlantik bis Westafrika.' },
  '2027-08-02': { en: 'Total along a path across southern Spain, North Africa, Egypt and Arabia; partial in Europe, Africa and the Middle East.', de: 'Total auf einem Streifen über Südspanien, Nordafrika, Ägypten und Arabien; partiell in Europa, Afrika und dem Nahen Osten.' },
};
export function calendarYear(year) {
  const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year + 1, 0, 1)), out = [];
  for (const e of ZEvents.search(A, { from, to, skip: ['meteor-shower'] })) {
    if (e.type === 'moon-phase' && (e.quarter === 1 || e.quarter === 3)) continue;
    if (e.type === 'conjunction' && e.bodies[0] === 'Moon' && A.AngleFromSun(A.Body[e.bodies[1]], T(e.peak)) < 15) continue;
    out.push(e);
  }
  for (const s of SHOWERS) { const p = showerPeak(s, year); if (p.d >= from && p.d < to) out.push({ type: 'meteor-shower', peak: p.d, shower: s, moon: p.k }); }
  const se = A.Seasons(year);
  [se.mar_equinox, se.jun_solstice, se.sep_equinox, se.dec_solstice].forEach((t, i) => out.push({ type: 'season', peak: t.date, season: i }));
  out.forEach(e => {
    e.id = e.peak.toISOString().slice(0, 10) + '-' + (e.type === 'meteor-shower' ? e.shower.slug : e.type === 'season' ? ['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice'][e.season] : e.type === 'moon-phase' ? ['new-moon', '', 'full-moon'][e.quarter] : e.type + (e.bodies ? '-' + e.bodies.join('-').toLowerCase() : ''));
    e.hl = e.type === 'lunar-eclipse' || e.type === 'solar-eclipse' || (e.type === 'opposition' && ['Mars', 'Jupiter', 'Saturn'].includes(e.bodies[0])) || (e.type === 'meteor-shower' && e.shower.zhr >= 50) || (e.type === 'conjunction' && e.sep < 1 && e.bodies[0] !== 'Moon');
  });
  return out.sort((a, b) => a.peak - b.peak);
}
// an eclipse as seen from the page's cities
function eclipseSeen(e, lang) {
  const w = W[lang];
  return CITIES[lang].map(([name, la, lo]) => {
    const obs = new A.Observer(la, lo, 0);
    if (e.type === 'lunar-eclipse') { const q = A.Equator(A.Body.Moon, T(e.peak), obs, true, true), h = A.Horizon(T(e.peak), obs, q.ra, q.dec, 'normal').altitude; return `${name}: ${h > 0 ? w.moonUp(Math.round(h)) : w.notSeen}`; }
    try {
      const l = A.SearchLocalSolarEclipse(T(new Date(e.peak.getTime() - DAY)), obs);
      if (Math.abs(l.peak.time.date - e.peak) > DAY || l.peak.altitude <= 0) return `${name}: ${w.notSeen}`;
      return `${name}: ${l.kind === 'total' ? w.totalHere : l.kind === 'annular' ? w.annularHere : w.covered(Math.round(l.obscuration * 100))}`;
    } catch (x) { return `${name}: ${w.notSeen}`; }
  }).join(' · ');
}
function eventText(e, lang) {
  const w = W[lang], pl = b => plName(b, lang);
  switch (e.type) {
    case 'moon-phase': return { label: e.quarter === 2 ? w.fullMoon : w.newMoon };
    case 'conjunction': return e.bodies[0] === 'Moon' ? { label: w.moonPasses(pl(e.bodies[1]), e.sep.toFixed(1)), sub: e.sep < 1.2 ? w.occ : '' } : { label: w.pair(pl(e.bodies[0]), pl(e.bodies[1]), e.sep.toFixed(1)), sub: w.sky(e.visibility) };
    case 'opposition': return { label: w.opp(pl(e.bodies[0])), sub: w.oppSub };
    case 'elongation': return { label: w.elong(pl(e.bodies[0])), sub: w.elongSub(Math.round(e.elongation), e.visibility) };
    case 'lunar-eclipse': return { label: w.lunar[e.kind], sub: [ECLIPSE_WHERE[e.peak.toISOString().slice(0, 10)]?.[lang], w.seenFrom + ' ' + eclipseSeen(e, lang) + '.'].filter(Boolean).join(' ') };
    case 'solar-eclipse': return { label: w.solar[e.kind], sub: [ECLIPSE_WHERE[e.peak.toISOString().slice(0, 10)]?.[lang], w.seenFrom + ' ' + eclipseSeen(e, lang) + '.', w.solarSafe].filter(Boolean).join(' ') };
    case 'meteor-shower': return { label: w.showerPeak(e.shower.name[lang]), sub: w.showerSub(e.shower.zhr, Math.round(e.moon * 100)) };
    case 'season': return { label: w.seasons[e.season], sub: w.seasonsSub[e.season] };
  }
  return { label: e.type };
}

// ---------- links between the pages ----------
const moonYearPath = (lang, y) => skyPath(lang, 'moon/' + y);
const calPath = (lang, y) => skyPath(lang, 'calendar/' + y);
const showerPath = (lang, s) => skyPath(lang, 'meteor-showers' + (s ? '/' + s.slug : ''));
// the published weeks that a moment falls in (Friday to Thursday), or that start in a month
const weekOf = (weeks, d) => weeks.find(w => d >= weekStart(w.week) && d < new Date(weekStart(w.week).getTime() + 7 * DAY));
const weeksInMonth = (weeks, y, m) => weeks.filter(w => { const s = weekStart(w.week); return s.getUTCFullYear() === y && s.getUTCMonth() === m; });
const weekLinks = (ws, lang) => ws.map(w => `<a href="${weekPath(lang, w.week)}">${esc(rangeText(w.week, lang))}</a>`).join(' · ');

// "More on this" under a weekly post: the Moon calendar and calendar of its month(s), and the meteor showers peaking
// within two days of the week
export function weekRelated(w, lang) {
  const t = W[lang], s = weekStart(w.week), e = new Date(s.getTime() + 7 * DAY), items = [];
  const months = [...new Set([s, new Date(e.getTime() - DAY)].map(d => d.getUTCFullYear() * 12 + d.getUTCMonth()))];
  for (const k of months) { const y = Math.floor(k / 12), m = k % 12; if (y < FIRST_YEAR) continue; items.push(`<li><a href="${moonYearPath(lang, y)}#${mslug(m)}">${esc(t.moonMonth(MONTH[lang][m], y))}</a></li>`, `<li><a href="${calPath(lang, y)}#${mslug(m)}">${esc(t.calMonth(MONTH[lang][m], y))}</a></li>`); }
  for (const sh of SHOWERS) for (const y of new Set([s.getUTCFullYear(), e.getUTCFullYear()])) {
    const p = showerPeak(sh, y); if (p.d > s.getTime() - 2 * DAY && p.d < e.getTime() + 2 * DAY) items.push(`<li><a href="${showerPath(lang, sh)}">${esc(t.showerLink(sh.name[lang]))}</a></li>`);
  }
  return items.length ? `<h2>${esc(t.more)}</h2>\n    <ul class="sky-more">${items.join('')}</ul>` : '';
}

// ---------- pages ----------
const crumbs = (lang, items, other) => `<nav class="wk-crumbs" aria-label="Breadcrumb">${items.map(([t, h]) => h ? `<a href="${h}">${esc(t)}</a>` : `<span>${esc(t)}</span>`).join(' › ')}<a class="wk-lang" href="${other}" hreflang="${lang === 'en' ? 'de' : 'en'}" lang="${lang === 'en' ? 'de' : 'en'}">${esc(L[lang].other)}</a></nav>`;
const breadcrumbLd = (SITE, items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + p })) });
const article = (body) => `<main class="wrap">\n  <article class="doc full wk">\n${body}\n  </article>\n</main>\n${tzScript}`;
// list items that are past in the reader's browser are hidden (the pages are built once a week)
const hidePast = `<script>(() => { const n = Date.now(); document.querySelectorAll("[data-until]").forEach(e => { if (Date.parse(e.dataset.until) < n) e.hidden = true; }); })();</script>`;

function moonHub(lang, ctx) {
  const t = W[lang], now = ctx.now, next = ZEvents.search(A, { from: now, to: new Date(now.getTime() + 140 * DAY), skip: ['lunar-eclipse', 'solar-eclipse', 'moon-planet', 'planet-planet', 'opposition', 'elongation', 'meteor-shower'] }).slice(0, 12);
  const items = next.map((q, i) => `<li data-until="${iso(q.peak)}"${i >= 8 ? ' class="mc-later"' : ''}>${moonSvg([0, 90, 180, 270][q.quarter], 'wk-moon')}<b>${esc(L[lang].q[q.quarter])}</b> ${timeTag(q.peak, lang, { year: 'numeric' })}</li>`).join('');
  return article(`    ${crumbs(lang, [[L[lang].sky, weekPath(lang)], [NAVN[lang].moon]], skyPath(lang === 'en' ? 'de' : 'en', 'moon'))}
    ${skyNav(lang, 'moon', ctx.navOpts)}
    <h1>${esc(t.moonTitle)}</h1>
    <p class="intro">${esc(t.moonIntro)}</p>
    ${tzNote(lang)}
    <h2>${esc(t.nextPhases)}</h2>
    <ul class="mc-list mc-next">${items}</ul>
    <h2>${esc(t.years)}</h2>
    <ul class="sky-more">${ctx.years.map(y => `<li><a href="${moonYearPath(lang, y)}">${esc(t.moonYearLink(y))}</a></li>`).join('')}</ul>
    <h2>${esc(t.aboutPhasesH)}</h2>
    <p>${esc(t.aboutPhases)}</p>
    <h2>${esc(t.observeH)}</h2>
    <p>${esc(t.observe)}</p>
    <p><a class="open ghost" rel="nofollow" href="/app/#go=Moon&amp;src=moon">${esc(t.openMoon)}</a></p>
    <p class="muted wk-small">${esc(t.calc)}</p>`) + hidePast;
}
const NAVN = { en: { moon: 'Moon calendar', showers: 'Meteor showers' }, de: { moon: 'Mondkalender', showers: 'Meteorströme' } };

function moonYearPage(lang, y, ctx) {
  const t = W[lang], ph = moonYear(y, lang, ctx.cal(y)), now = ctx.now;
  const nextFull = ph.find(q => q.quarter === 2 && q.peak > now);
  const months = [...Array(12)].map((_, m) => {
    const qs = ph.filter(q => q.at.m === m);
    const li = qs.map(q => {
      const tags = [q.super && `<span class="mc-tag">${esc(t.supermoon)}</span>`, q.eclipse && `<a class="mc-tag ecl" href="${calPath(lang, y)}#${q.eclipse.id}">${esc(t.eclipse)}</a>`].filter(Boolean).join('');
      return `<li>${moonSvg([0, 90, 180, 270][q.quarter], 'wk-moon')}<b>${esc(L[lang].q[q.quarter])}${q.name ? ' · ' + esc(q.name) : ''}</b> ${timeTag(q.peak, lang)}${tags}</li>`;
    }).join('');
    const nm = qs.find(q => q.quarter === 0), wk = nm && weekOf(ctx.weeks, nm.peak);
    const dark = nm ? `<p class="muted">${esc(t.dark(dayText(new Date(nm.peak.getTime() - 3 * DAY), lang), dayText(new Date(nm.peak.getTime() + 3 * DAY), lang)))}${wk ? ` <a href="${weekPath(lang, wk.week)}">${esc(t.weekPost)}</a>` : ''}</p>` : '';
    return `    <h2 id="${mslug(m)}">${esc(MONTH[lang][m])} ${y}</h2>
    <ul class="mc-list">${li}</ul>
    ${dark}
    <p class="sky-links"><a href="${calPath(lang, y)}#${mslug(m)}">${esc(t.calMonth(MONTH[lang][m], y))}</a>${weeksInMonth(ctx.weeks, y, m).length ? ' · ' + weekLinks(weeksInMonth(ctx.weeks, y, m), lang) : ''}</p>`;
  }).join('\n');
  const jump = `<nav class="mc-jump" aria-label="${esc(t.yearH1(y))}">${MONTH[lang].map((n, m) => `<a href="#${mslug(m)}">${esc(n.slice(0, 3))}</a>`).join('')}</nav>`;
  return article(`    ${crumbs(lang, [[L[lang].sky, weekPath(lang)], [NAVN[lang].moon, skyPath(lang, 'moon')], [String(y)]], moonYearPath(lang === 'en' ? 'de' : 'en', y))}
    ${skyNav(lang, 'moon', ctx.navOpts)}
    <h1>${esc(t.yearH1(y))}</h1>
    <p class="intro">${esc(t.yearIntro(y, nextFull && nextFull.peak.getUTCFullYear() === y ? fmtAt(nextFull.peak, lang, false, { year: 'numeric' }) : ''))}</p>
    ${tzNote(lang)}
    ${jump}
${months}
    <p class="muted wk-small">${esc(t.namesNote)}</p>
    <p class="sky-links">${ctx.years.filter(x => x !== y).map(x => `<a href="${moonYearPath(lang, x)}">${esc(t.moonYearLink(x))}</a>`).join(' · ')}</p>
    <p class="muted wk-small">${esc(t.calc)}</p>`);
}

function showersHub(lang, ctx) {
  const t = W[lang], rows = SHOWERS.map(s => ({ s, p: nextPeak(s, ctx.now) })).sort((a, b) => a.p.d - b.p.d);
  const tr = rows.map(({ s, p }) => { const n = peakNight(p.d, lang); return `<tr><th scope="row"><a href="${showerPath(lang, s)}">${esc(s.name[lang])}</a></th><td>${esc(activeText(s, lang))}</td><td>${esc(nightShort(n.first, lang, true))}</td><td class="num">${esc(t.perHour(s.zhr))}</td><td class="num">${Math.round(p.k * 100)} %</td></tr>`; }).join('\n        ');
  return article(`    ${crumbs(lang, [[L[lang].sky, weekPath(lang)], [NAVN[lang].showers]], showerPath(lang === 'en' ? 'de' : 'en'))}
    ${skyNav(lang, 'showers', ctx.navOpts)}
    <h1>${esc(t.showersH1)}</h1>
    <p class="intro">${esc(t.showersIntro)}</p>
    <div class="wk-tablewrap"><table class="wk-planets sh-table">
      <thead><tr><th>${esc(t.th.name)}</th><th>${esc(t.th.active)}</th><th>${esc(t.th.peak)}</th><th class="num">${esc(t.th.zhr)}</th><th class="num">${esc(t.th.moon)}</th></tr></thead>
      <tbody>
        ${tr}
      </tbody>
    </table></div>
    <h2>${esc(t.showersTipsH)}</h2>
    <ul>${t.showersTips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <p class="muted wk-small">${esc(t.calc)}</p>`);
}

function showerPage(lang, s, ctx) {
  const t = W[lang], p = nextPeak(s, ctx.now), n = peakNight(p.d, lang), k = Math.round(p.k * 100);
  const sunRa = A.Equator(A.Body.Sun, T(p.d), new A.Observer(0, 0, 0), true, true).ra, hi = Math.round(((s.ra - sunRa + 12) % 24 + 24) % 24) % 24;
  const con = conName(A.Constellation(s.ra, s.dec).name, lang), altN = Math.round(90 - Math.abs(50 - s.dec)), altS = Math.round(90 - Math.abs(-35 - s.dec));
  const years = [...Array(5)].map((_, i) => { const y = p.year + i, q = showerPeak(s, y), nn = peakNight(q.d, lang), kk = Math.round(q.k * 100); return `<tr><th scope="row">${y}</th><td>${esc(nightShort(nn.first, lang))}</td><td class="num">${kk} %</td><td>${esc(t.rating[rateClass(q.k)])}</td></tr>`; }).join('\n        ');
  const wks = ctx.weeks.filter(w => { const st = weekStart(w.week).getTime(), y = weekStart(w.week).getUTCFullYear(); return [y, y + 1].some(yy => { const d = showerPeak(s, yy).d.getTime(); return d > st - 2 * DAY && d < st + 9 * DAY; }); });
  const pm = partsIn(p.d, lang);
  const facts = [[t.facts.active, activeText(s, lang)], [t.facts.peak(p.year), t.night(n.a, n.b), timeTag(p.d, lang)], [t.facts.rate, t.rateText(s.zhr)], [t.facts.moon, t.lit(k)],
    [t.facts.radiant, `${con} (RA ${Math.floor(s.ra)}h ${String(Math.round((s.ra % 1) * 60)).padStart(2, '0')}m, Dec ${s.dec > 0 ? '+' : ''}${s.dec}°)`], [t.facts.speed, t.kms(s.v)], [t.facts.parent, s.parent[lang]]];
  return article(`    ${crumbs(lang, [[L[lang].sky, weekPath(lang)], [NAVN[lang].showers, showerPath(lang)], [s.name[lang]]], showerPath(lang === 'en' ? 'de' : 'en', s))}
    ${skyNav(lang, 'showers', ctx.navOpts)}
    <h1>${esc(t.showerTitle(s.name[lang], p.year))}</h1>
    <p class="intro">${esc(s.text[lang])}</p>
    ${tzNote(lang)}
    <div class="wk-tablewrap"><table class="wk-planets sh-facts">
      <tbody>
        ${facts.map(([a, b, c]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}${c ? ' · ' + c : ''}</td></tr>`).join('\n        ')}
      </tbody>
    </table></div>
    <h2>${esc(t.radiantH)}</h2>
    <p>${esc(t.radiantText(con, t.fromN(altN), t.fromS(altS), t.highAt(hi)))}</p>
    <h2>${esc(t.tipH)}</h2>
    <p>${esc(s.tip[lang])}</p>
    <h2>${esc(t.nextYearsH)}</h2>
    <div class="wk-tablewrap"><table class="wk-planets">
      <thead><tr><th>${esc(t.thY.year)}</th><th>${esc(t.thY.night)}</th><th class="num">${esc(t.thY.moon)}</th><th>${esc(t.thY.rating)}</th></tr></thead>
      <tbody>
        ${years}
      </tbody>
    </table></div>
    ${wks.length ? `<h2>${esc(t.weeksH)}</h2>\n    <p class="sky-links">${weekLinks(wks, lang)}</p>` : ''}
    <p class="sky-links"><a href="${showerPath(lang)}">${esc(t.allShowers)}</a> · <a href="${calPath(lang, p.year)}#${mslug(pm.m)}">${esc(t.calMonth(MONTH[lang][pm.m], p.year))}</a> · <a href="${moonYearPath(lang, p.year)}#${mslug(pm.m)}">${esc(t.moonMonth(MONTH[lang][pm.m], p.year))}</a></p>
    <p class="muted wk-small">${esc(t.calc)}</p>`);
}

function calendarPage(lang, y, ctx) {
  const t = W[lang], evs = ctx.cal(y).map(e => ({ ...e, at: partsIn(e.peak, lang) })).filter(e => e.at.y === y);
  const li = e => {
    const x = eventText(e, lang);
    const label = e.type === 'meteor-shower' ? `<a href="${showerPath(lang, e.shower)}">${esc(x.label)}</a>` : e.type === 'moon-phase' ? `<a href="${moonYearPath(lang, y)}#${mslug(e.at.m)}">${esc(x.label)}</a>` : esc(x.label);
    return `<li id="${e.id}" class="cal-ev${e.hl ? ' hl' : ''}"><span class="cal-d">${e.type === 'meteor-shower' ? `<time datetime="${iso(e.peak)}">${esc(fmtAt(e.peak, lang))}</time>` : timeTag(e.peak, lang)}</span><span class="cal-t"><b>${label}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></li>`;
  };
  // the week a meteor shower falls in, for its page and the week post
  const months = [...Array(12)].map((_, m) => {
    const list = evs.filter(e => e.at.m === m), wks = weeksInMonth(ctx.weeks, y, m);
    return `    <h2 id="${mslug(m)}">${esc(MONTH[lang][m])} ${y}</h2>
    ${list.length ? `<ul class="cal-list">${list.map(li).join('')}</ul>` : `<p class="muted">${esc(t.none)}</p>`}
    <p class="sky-links"><a href="${moonYearPath(lang, y)}#${mslug(m)}">${esc(t.moonMonth(MONTH[lang][m], y))}</a>${wks.length ? ` · ${esc(t.weeksIn)}: ${weekLinks(wks, lang)}` : ''}</p>`;
  }).join('\n');
  const hl = evs.filter(e => e.hl).map(e => `<li><a href="#${e.id}">${esc(eventText(e, lang).label)}</a> <small>${esc(dayText(e.peak, lang))}</small></li>`).join('');
  const jump = `<nav class="mc-jump" aria-label="${esc(t.calH1(y))}">${MONTH[lang].map((n, m) => `<a href="#${mslug(m)}">${esc(n.slice(0, 3))}</a>`).join('')}</nav>`;
  return article(`    ${crumbs(lang, [[L[lang].sky, weekPath(lang)], [t.calH1(y)]], calPath(lang === 'en' ? 'de' : 'en', y))}
    ${skyNav(lang, 'calendar', { ...ctx.navOpts, year: y })}
    <h1>${esc(t.calH1(y))}</h1>
    <p class="intro">${esc(t.calIntro(y))}</p>
    ${tzNote(lang)}
    ${hl ? `<h2>${esc(t.highlightsH)}</h2>\n    <ul class="cal-hl">${hl}</ul>` : ''}
    ${jump}
${months}
    <p class="sky-links">${ctx.years.filter(x => x !== y).map(x => `<a href="${calPath(lang, x)}">${esc(t.calH1(x))}</a>`).join(' · ')}</p>
    <p class="muted wk-small">${esc(t.calc)}</p>`);
}

// /sky/ while no week is published: what comes next, and the topic pages
function overview(lang, ctx) {
  const t = W[lang], now = ctx.now, y = now.getUTCFullYear();
  const soon = [...ctx.cal(y), ...ctx.cal(y + 1)].filter(e => e.peak > now && e.type !== 'season').slice(0, 8);
  const nf = soon.find(e => e.type === 'moon-phase' && e.quarter === 2) || ctx.cal(y + 1).find(e => e.type === 'moon-phase' && e.quarter === 2);
  const ns = SHOWERS.map(s => ({ s, p: nextPeak(s, now) })).sort((a, b) => a.p.d - b.p.d)[0];
  const card = (h, a, b) => `<a class="sky-card" href="${h}"><b>${esc(a)}</b><small>${esc(b)}</small></a>`;
  return article(`    ${skyNav(lang, 'week', ctx.navOpts)}
    <h1>${esc(t.overviewH1)}</h1>
    <p class="intro">${esc(t.overviewIntro)}</p>
    <div class="sky-cards">${card(skyPath(lang, 'moon'), t.cards.moon, nf ? t.cards.moonSub(dayText(nf.peak, lang)) : '')}${card(showerPath(lang), t.cards.showers, t.cards.showersSub(ns.s.name[lang], dayText(ns.p.d, lang)))}${card(calPath(lang, y), t.cards.calendar(y), t.cards.calendarSub)}</div>
    ${tzNote(lang)}
    <h2>${esc(t.comingUp)}</h2>
    <ul class="cal-list">${soon.map(e => { const x = eventText(e, lang); return `<li data-until="${iso(e.peak)}" class="cal-ev${e.hl ? ' hl' : ''}"><span class="cal-d">${timeTag(e.peak, lang)}</span><span class="cal-t"><b><a href="${calPath(lang, e.peak.getUTCFullYear())}#${e.id}">${esc(x.label)}</a></b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></li>`; }).join('')}</ul>
    <p class="muted wk-small">${esc(t.calc)}</p>`) + hidePast;
}

// Builds every topic page with the helpers of buildSky (put, hdr, ftr); returns the sitemap entries
export function buildTopics({ sky, fontCss, SITE, now = new Date() }) {
  const urls = [], lastmod = now.toISOString().slice(0, 10), y0 = now.getUTCFullYear();
  const years = []; for (let y = FIRST_YEAR; y <= Math.max(FIRST_YEAR, y0 + 1); y++) years.push(y);
  const calCache = {}, cal = y => calCache[y] || (calCache[y] = calendarYear(y));
  const ctx = { now, years, cal, weeks: sky.published.length ? sky.published : sky.all.filter(w => w.status === 'published'), navOpts: { year: y0, archive: sky.all.length > 0 } };
  const page = (rest, active, title, desc, body, ld, crumbsLd) => {
    const alt = Object.fromEntries(LANGS.map(l => [l, skyPath(l, rest)]));
    for (const lang of LANGS) {
      const path = alt[lang];
      sky.put('dist' + path + 'index.html', pageHtml({ lang, title: title(lang), desc: desc(lang), url: SITE + path, alt, body: body(lang), ld: [...(ld ? [ld(lang)] : []), breadcrumbLd(SITE, crumbsLd(lang))], header: sky.hdr(lang, path), footer: sky.ftr(lang), fontCss, SITE }));
    }
    urls.push({ loc: SITE + alt.en, alt, lastmod });
  };
  const sk = lang => [L[lang].sky, weekPath(lang)];
  page('moon', 'moon', l => W[l].moonTitle, l => W[l].moonIntro, l => moonHub(l, ctx), null, l => [sk(l), [NAVN[l].moon, skyPath(l, 'moon')]]);
  for (const y of years) page('moon/' + y, 'moon', l => W[l].yearTitle(y), l => W[l].yearDesc(y), l => moonYearPage(l, y, ctx), null, l => [sk(l), [NAVN[l].moon, skyPath(l, 'moon')], [String(y), moonYearPath(l, y)]]);
  page('meteor-showers', 'showers', l => W[l].showersTitle, l => W[l].showersIntro, l => showersHub(l, ctx), null, l => [sk(l), [NAVN[l].showers, showerPath(l)]]);
  for (const s of SHOWERS) {
    const p = nextPeak(s, now);
    page('meteor-showers/' + s.slug, 'showers', l => W[l].showerTitle(s.name[l], p.year), l => { const n = peakNight(p.d, l); return W[l].showerDesc(s.name[l], p.year, l === 'de' ? `${n.a} auf den ${n.b}` : `${n.a} to ${n.b}`, Math.round(p.k * 100)); }, l => showerPage(l, s, ctx), null,
      l => [sk(l), [NAVN[l].showers, showerPath(l)], [s.name[l], showerPath(l, s)]]);
  }
  for (const y of years) page('calendar/' + y, 'calendar', l => W[l].calTitle(y), l => W[l].calDesc(y), l => calendarPage(l, y, ctx), null, l => [sk(l), [W[l].calH1(y), calPath(l, y)]]);
  // /sky/ itself, while there is no week yet (the Worker serves the week of the day once there is one)
  const alt = Object.fromEntries(LANGS.map(l => [l, weekPath(l)]));
  if (!sky.current) for (const lang of LANGS) sky.put('dist' + alt[lang] + 'index.html', pageHtml({ lang, title: W[lang].overviewTitle, desc: W[lang].overviewIntro, url: SITE + alt[lang], alt, body: overview(lang, ctx), header: sky.hdr(lang, alt[lang]), footer: sky.ftr(lang), fontCss, SITE }));
  if (!sky.urls.some(u => u.loc === SITE + alt.en)) urls.push({ loc: SITE + alt.en, alt, lastmod });
  return { urls, years };
}
