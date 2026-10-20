// 45° mirror holder for a Picatinny rail (via a Picatinny to 1/4" camera adapter).
// The phone lies flat on the rail, its camera looking down into the mirror; the mirror turns the view by 90° along
// the tube. JSCAD design: runs in the configurator on the website, in Node and at openjscad.xyz.
// Light comes from the FRONT (-X), hits the mirror and goes straight up into the camera. The part prints as it stands:
// base on the bed, the mirror face is the top surface, the nut slot is a short bridge. All dimensions in mm.
'use strict';
(function () {
  const jscad = typeof jscadModeling !== 'undefined' ? jscadModeling : require('@jscad/modeling');
  const { primitives, transforms, booleans, extrusions } = jscad;
  const { polygon, cuboid, cylinder } = primitives;
  const { translate, rotateX, rotateY } = transforms;
  const { union, subtract } = booleans;
  const { extrudeLinear } = extrusions;

  const getParameterDefinitions = () => [
    { name: 'gMirror', type: 'group', caption: 'Mirror' },
    { name: 'mirrorW', type: 'float', caption: 'Mirror width', initial: 100, min: 30, max: 160, step: 1 },
    { name: 'mirrorL', type: 'float', caption: 'Mirror height (along the slope)', initial: 50, min: 25, max: 100, step: 1 },
    { name: 'mirrorT', type: 'float', caption: 'Mirror thickness', initial: 2, min: 1, max: 6, step: 0.1 },
    { name: 'margin', type: 'float', caption: 'Border around the mirror', initial: 2, min: 0, max: 8, step: 0.5 },
    { name: 'lip', type: 'choice', caption: 'Ledge under the mirror', values: ['yes', 'no'], captions: ['Yes, the mirror rests on it', 'No'], initial: 'yes' },

    { name: 'gMount', type: 'group', caption: 'Mounting' },
    { name: 'mode', type: 'choice', caption: '1/4" connection', values: ['female', 'male'], captions: ['Nut: the adapter has a screw', 'Screw: the adapter has a thread'], initial: 'female' },
    { name: 'riserH', type: 'float', caption: 'Extra height under the mirror', initial: 0, min: 0, max: 60, step: 1 },
    { name: 'baseMinL', type: 'float', caption: 'Minimum base length', initial: 32, min: 20, max: 80, step: 1 },

    { name: 'gHex', type: 'group', caption: 'Nut / screw head', advanced: true },
    { name: 'hexAF', type: 'float', caption: 'Hex across flats (1/4": 11.1)', initial: 11.1, min: 8, max: 14, step: 0.1 },
    { name: 'hexTFemale', type: 'float', caption: 'Nut thickness', initial: 5.6, min: 3, max: 8, step: 0.1 },
    { name: 'hexTMale', type: 'float', caption: 'Screw head height', initial: 4.4, min: 3, max: 8, step: 0.1 },
    { name: 'floorT', type: 'float', caption: 'Floor under the nut', initial: 1.2, min: 0.8, max: 4, step: 0.1 },
    { name: 'nutCover', type: 'float', caption: 'Material above the nut', initial: 2, min: 1, max: 5, step: 0.1 },
    { name: 'holeD', type: 'float', caption: 'Thread hole', initial: 6.8, min: 6, max: 8, step: 0.1 },
    { name: 'tol', type: 'float', caption: 'Clearance', initial: 0.3, min: 0, max: 0.8, step: 0.05 }
  ];

  const EPS = 0.01;
  const S45 = Math.SQRT1_2;

  const dims = p => {
    const hexT = p.mode === 'female' ? p.hexTFemale : p.hexTMale;
    const af = p.hexAF + p.tol;
    const baseT = p.floorT + hexT + p.tol + p.nutCover;
    const zb = baseT + p.riserH;
    const faceL = p.mirrorL + 2 * p.margin;
    const D = faceL * S45;
    const W = Math.max(p.mirrorW + 2 * p.margin, af + 8);
    const Db = Math.max(D, p.baseMinL);
    return {
      hexT, af, zb, D, W, Db, xs: Db / 2,
      length: Db, width: W, height: zb + D,
      // centre of the mirror surface: distance behind the front edge and height above the base
      mirrorX: (p.margin + p.mirrorL / 2) * S45 - p.mirrorT * S45,
      mirrorZ: zb + (p.margin + p.mirrorL / 2) * S45 + p.mirrorT * S45
    };
  };

  const main = p => {
    const d = dims(p);
    // wedge: profile in the x/z plane, extruded across y = 0..W
    const prof = polygon({ points: [[0, 0], [d.Db, 0], [d.Db, d.zb], [d.D, d.zb], [d.D, d.zb + d.D], [0, d.zb]] });
    let body = translate([0, d.W, 0], rotateX(Math.PI / 2, extrudeLinear({ height: d.W }, prof)));
    if (p.lip === 'yes') {
      // ledge along the lower edge of the 45° face: x along the slope, z out of the face
      const h = p.mirrorT + 1;
      const lip = cuboid({ size: [1.5, d.W, h], center: [p.margin - 0.75, d.W / 2, h / 2 - EPS] });
      body = union(body, translate([0, 0, d.zb], rotateY(-Math.PI / 4, lip)));
    }
    const hexH = d.hexT + p.tol;
    return subtract(body,
      cylinder({ radius: p.holeD / 2, height: p.floorT + hexH + 1, segments: 48, center: [d.xs, d.W / 2, -1 + (p.floorT + hexH + 1) / 2] }),
      cylinder({ radius: d.af / Math.cos(Math.PI / 6) / 2, height: hexH, segments: 6, center: [d.xs, d.W / 2, p.floorT + hexH / 2] }),
      cuboid({ size: [d.Db, d.af, hexH], center: [d.xs + d.Db / 2, d.W / 2, p.floorT + hexH / 2] }));
  };

  const defaults = () => Object.fromEntries(getParameterDefinitions().filter(d => d.type !== 'group').map(d => [d.name, d.initial]));

  // for the configurator: size line and values shown in the text
  const summary = p => { const d = dims(p); return `${d.length.toFixed(1)} × ${d.width.toFixed(0)} × ${d.height.toFixed(1)} mm`; };
  const texts = p => { const d = dims(p); return { mirrorX: d.mirrorX.toFixed(0), mirrorZ: d.mirrorZ.toFixed(0) }; };

  const fileTag = p => `${p.mirrorW}x${p.mirrorL}mm-${p.mode === 'female' ? 'nut' : 'screw'}`;

  const api = { main, dims, defaults, summary, texts, fileTag, getParameterDefinitions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.MirrorHolder = api;
})();
