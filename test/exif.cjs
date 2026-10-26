// A minimal EXIF block for tests: inserts an APP1 "Exif" segment into a JPEG with the time a photo was taken
// (DateTimeOriginal, and OffsetTimeOriginal when given), GPS position and the 35 mm focal length.
//   withExif(jpegBuffer, { date: '2026:10:21 22:14:00', offset: '+02:00', lat: 48.18, lon: 10.08, f35: 26 })
function tiff({ date, offset, lat, lon, f35 }) {
  // big-endian TIFF; values that don't fit into an entry go into a data area after the directories
  const ifds = [], data = [];
  const asc = s => Buffer.from(s + '\0', 'latin1');
  const rat3 = v => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 100); const b = Buffer.alloc(24); [[d, 1], [m, 1], [s, 100]].forEach(([n, q], i) => { b.writeUInt32BE(n, 8 * i); b.writeUInt32BE(q, 8 * i + 4); }); return b; };
  const ifd0 = [], exif = [], gps = [];
  if (date) exif.push([0x9003, 2, asc(date)]);
  if (offset) exif.push([0x9011, 2, asc(offset)]);
  if (f35) exif.push([0xa405, 3, f35]);
  if (lat != null) gps.push([1, 2, asc(lat >= 0 ? 'N' : 'S')], [2, 5, rat3(lat)], [3, 2, asc(lon >= 0 ? 'E' : 'W')], [4, 5, rat3(lon)]);
  ifd0.push([0x8769, 4, 'EXIF'], [0x8825, 4, 'GPS']);
  const size = list => 2 + 12 * list.length + 4;
  const o0 = 8, oE = o0 + size(ifd0), oG = oE + size(exif); let od = oG + size(gps);
  const out = Buffer.alloc(od + 512); out.write('MM', 0, 'latin1'); out.writeUInt16BE(42, 2); out.writeUInt32BE(o0, 4);
  const write = (at, list) => {
    out.writeUInt16BE(list.length, at);
    list.sort((a, b) => a[0] - b[0]).forEach(([tag, type, val], i) => {
      const e = at + 2 + 12 * i; out.writeUInt16BE(tag, e); out.writeUInt16BE(type, e + 2);
      if (val === 'EXIF' || val === 'GPS') { out.writeUInt32BE(1, e + 4); out.writeUInt32BE(val === 'EXIF' ? oE : oG, e + 8); return; }
      if (typeof val === 'number') { out.writeUInt32BE(1, e + 4); out.writeUInt16BE(val, e + 8); return; }
      const cnt = type === 5 ? val.length / 8 : val.length; out.writeUInt32BE(cnt, e + 4);
      if (val.length <= 4) val.copy(out, e + 8); else { out.writeUInt32BE(od, e + 8); val.copy(out, od); od += val.length + (val.length % 2); }
    });
    out.writeUInt32BE(0, at + 2 + 12 * list.length);
  };
  write(o0, ifd0); write(oE, exif); write(oG, gps);
  return out.subarray(0, od);
}
function withExif(jpeg, info) {
  const t = tiff(info), body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
  const seg = Buffer.alloc(4); seg.writeUInt16BE(0xffe1, 0); seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, body, jpeg.subarray(2)]);
}
module.exports = { withExif };
