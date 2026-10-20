// Finder-shoe adapter with a T-slot base: Explore Scientific or Vixen/Synta foot, or a universal V-block that sits on
// any tube and is held with cable ties or hose clamps.
// JSCAD design: the same file runs in the configurator on the website (global jscadModeling from the browser bundle),
// in Node (require) and in the JSCAD web UI at openjscad.xyz (main + getParameterDefinitions).
// Port of finder_tslot_customizer.scad; all dimensions in mm.
'use strict';
(function () {
  const jscad = typeof jscadModeling !== 'undefined' ? jscadModeling : require('@jscad/modeling');
  const { primitives, transforms, booleans, extrusions, hulls } = jscad;
  const { polygon, circle, cuboid, roundedRectangle, rectangle } = primitives;
  const { translate, rotateX, rotateY } = transforms;
  const { union, subtract, intersect } = booleans;
  const { extrudeLinear } = extrusions;
  const { hull } = hulls;

  const getParameterDefinitions = () => [
    { name: 'gMount', type: 'group', caption: 'Mount' },
    { name: 'mountType', type: 'choice', caption: 'Mount type', values: ['es', 'vixen', 'vblock'], captions: ['Explore Scientific finder shoe', 'Vixen / Synta finder shoe', 'Universal V-block with straps'], initial: 'es' },
    { name: 'mountLen', type: 'float', caption: 'Foot length', initial: 44, min: 20, max: 200, step: 1 },

    { name: 'gBase', type: 'group', caption: 'Base' },
    { name: 'overhangFront', type: 'float', caption: 'Overhang front', initial: 30, min: 0, max: 250, step: 5 },
    { name: 'overhangBack', type: 'float', caption: 'Overhang back', initial: 30, min: 0, max: 250, step: 5 },
    { name: 'plateW', type: 'float', caption: 'Plate width', initial: 26, min: 20, max: 40, step: 0.5 },
    { name: 'transitionH', type: 'float', caption: 'Transition height', initial: 6, min: 2, max: 15, step: 0.5 },
    { name: 'footClear', type: 'float', caption: 'Straight section above the foot', initial: 1, min: 0, max: 5, step: 0.5 },
    { name: 'cornerR', type: 'float', caption: 'Corner radius', initial: 4, min: 0, max: 10, step: 0.5 },
    { name: 'edgeChamfer', type: 'float', caption: 'Edge chamfer', initial: 1, min: 0, max: 3, step: 0.25 },

    { name: 'gSlot', type: 'group', caption: 'T-slot', advanced: true },
    { name: 'slotOpen', type: 'float', caption: 'Slot opening', initial: 6.4, min: 4, max: 10, step: 0.1 },
    { name: 'slotLip', type: 'float', caption: 'Lip thickness', initial: 2.5, min: 1.5, max: 5, step: 0.1 },
    { name: 'cavityW', type: 'float', caption: 'Cavity width', initial: 11.2, min: 7, max: 20, step: 0.1 },
    { name: 'cavityH', type: 'float', caption: 'Cavity wall height', initial: 4, min: 2, max: 10, step: 0.1 },
    { name: 'roof', type: 'choice', caption: 'Cavity roof', values: ['peak', 'chamfer'], captions: ['45° peak, no bridge', 'Flat, 45° corners'], initial: 'peak' },
    { name: 'peakR', type: 'float', caption: 'Peak radius', initial: 2, min: 0, max: 5, step: 0.25 },
    { name: 'roofChamfer', type: 'float', caption: 'Corner chamfer (flat roof)', initial: 1.5, min: 0.5, max: 5, step: 0.1 },
    { name: 'leadIn', type: 'float', caption: 'Lead-in chamfer', initial: 0.6, min: 0, max: 1.5, step: 0.1 },
    { name: 'slotFloor', type: 'float', caption: 'Material above the cavity', initial: 2, min: 1.2, max: 6, step: 0.1 },

    { name: 'gES', type: 'group', caption: 'Explore Scientific foot', showIf: { mountType: 'es' } },
    { name: 'esNotch', type: 'choice', caption: 'Stop notch', values: ['back', 'front', 'none'], captions: ['Back end', 'Front end', 'None'], initial: 'back' },

    { name: 'gVixen', type: 'group', caption: 'Vixen / Synta foot', showIf: { mountType: 'vixen' } },
    { name: 'vixenW', type: 'float', caption: 'Width at the bottom', initial: 31.5, min: 28, max: 36, step: 0.1 },
    { name: 'vixenH', type: 'float', caption: 'Dovetail height', initial: 8, min: 5, max: 12, step: 0.1 },
    { name: 'vixenAngle', type: 'float', caption: 'Flank angle', initial: 60, min: 45, max: 75, step: 1 },

    { name: 'gV', type: 'group', caption: 'V-block', showIf: { mountType: 'vblock' } },
    { name: 'tubeD', type: 'float', caption: 'Outer diameter of your tube', initial: 230, min: 40, max: 400, step: 1 },
    { name: 'vAngle', type: 'float', caption: 'V angle (included)', initial: 165, min: 100, max: 176, step: 1 },
    { name: 'vWidth', type: 'float', caption: 'V-block width', initial: 40, min: 20, max: 80, step: 1 },
    { name: 'strapCount', type: 'float', caption: 'Strap channels', initial: 2, min: 1, max: 6, step: 1, unit: '' },
    { name: 'strapW', type: 'float', caption: 'Channel width (strap + clearance)', initial: 10, min: 4, max: 30, step: 0.5 },
    { name: 'strapH', type: 'float', caption: 'Channel height', initial: 3.5, min: 1.5, max: 8, step: 0.5 },
    { name: 'strapFloor', type: 'float', caption: 'Material between V and channel', initial: 2, min: 1.2, max: 6, step: 0.1 }
  ];

  const SEG = 48;
  const EPS = 0.01;
  const deg = a => a * Math.PI / 180;

  // polygon regardless of point order (JSCAD wants counter-clockwise)
  const poly = pts => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return polygon({ points: a < 0 ? pts.slice().reverse() : pts });
  };

  // extrude a 2D profile (x across, y up) along +Y over [y0, y0 + l]
  const along = (y0, l, shape) => translate([0, y0 + l, 0], rotateX(deg(90), extrudeLinear({ height: l }, shape)));

  // key figures, also shown on the website
  const V_EDGE = 1.5;   // flat strip along the outer edges of the V-block, so they are not knife-sharp
  const dims = p => {
    const isES = p.mountType === 'es', isV = p.mountType === 'vblock';
    const vxTop = p.vixenW - 2 * p.vixenH / Math.tan(deg(p.vixenAngle));
    // V-block: phi = half the included angle, measured from the vertical; the V spans the width minus the edge strips
    const phi = deg(p.vAngle / 2), vHalf = p.vWidth / 2 - V_EDGE;
    const vDepth = vHalf / Math.tan(phi);
    const chRoof = p.strapW / 2;                                   // 45° roof over each channel (prints without bridge)
    const chZ0 = vDepth + p.strapFloor;                            // tip of the channel roof
    const vFootH = chZ0 + chRoof + p.strapH + 2;
    const footH = isES ? 19.9 : isV ? vFootH : p.vixenH;
    const footTW = isES ? 13 : isV ? p.vWidth : vxTop;
    const zTr0 = footH + (isV ? 0 : p.footClear);
    // never steeper than 45° when printed upside down (a wide V-block narrows towards the plate)
    const zPl0 = zTr0 + Math.max(p.transitionH, (footTW - p.plateW) / 2);
    // tube fit: largest tube that still rests on both flanks, contact span and gap under the apex for tubeD
    const R = p.tubeD / 2;
    const maxTubeD = 2 * vHalf / Math.cos(phi);
    const contactSpan = 2 * R * Math.cos(phi);
    const apexGap = R / Math.sin(phi) - R;                          // distance from the V apex down to the tube surface
    const roofH = p.roof === 'peak' ? p.cavityW / 2 : p.roofChamfer;
    const plateT = p.slotFloor + roofH + p.cavityH + p.slotLip;
    return {
      isES, isV, vxTop, footTW, zTr0, zPl0, roofH, plateT, vDepth, vHalf, chZ0, chRoof, maxTubeD, contactSpan, apexGap,
      length: p.mountLen + p.overhangFront + p.overhangBack,
      height: zPl0 + plateT,
      width: Math.max(p.plateW, isES ? 18.5 : isV ? p.vWidth : p.vixenW)
    };
  };

  // the adapter in use orientation: shoe floor at z = 0, slot face on top, length along +Y (front end at max Y)
  const adapter = p => {
    const d = dims(p), L = d.length, yM0 = p.overhangBack, zTr0 = d.zTr0, zPl0 = d.zPl0, totalH = d.height;

    let foot;
    if (d.isES) {
      foot = along(yM0, p.mountLen, poly([
        [-9.25, 0], [9.25, 0], [9.25, 2.3], [6.5, 2.3],
        [6.5, 6.8], [4.0, 10.55], [6.5, 14.3], [6.5, zTr0 + EPS],
        [-6.5, zTr0 + EPS], [-6.5, 14.3], [-4.0, 10.55], [-6.5, 6.8],
        [-6.5, 2.3], [-9.25, 2.3]
      ]));
      if (p.esNotch !== 'none') {
        const yn = p.esNotch === 'back' ? yM0 - EPS : yM0 + p.mountLen - 4.4, sz = [5, 4.4 + EPS, 6];
        foot = subtract(foot, cuboid({ size: sz, center: [0, yn + sz[1] / 2, -1 + sz[2] / 2] }));
      }
    } else if (d.isV) {
      // block with a V-notch underneath; channels run across it for cable ties or hose clamps
      const w2 = p.vWidth / 2;
      foot = along(yM0, p.mountLen, poly([
        [-w2, 0], [-d.vHalf, 0], [0, d.vDepth], [d.vHalf, 0], [w2, 0],
        [w2, zTr0 + EPS], [-w2, zTr0 + EPS]
      ]));
      const n = Math.round(p.strapCount);
      for (let i = 0; i < n; i++) {
        const yc = yM0 + p.mountLen * (i + 0.5) / n, sw = p.strapW / 2;
        // channel cross-section in the y/z plane: pointed towards the V (that is the roof when printed upside down)
        const ch = polygon({ points: [[yc, d.chZ0], [yc + sw, d.chZ0 + d.chRoof], [yc + sw, d.chZ0 + d.chRoof + p.strapH], [yc - sw, d.chZ0 + d.chRoof + p.strapH], [yc - sw, d.chZ0 + d.chRoof]] });
        // extrude along X across the whole block: build in the x/y plane as (y, z) and turn it so the extrusion runs along x
        const bar = transforms.rotateY(deg(90), transforms.rotateZ(deg(90), extrudeLinear({ height: p.vWidth + 2 }, ch)));
        foot = subtract(foot, translate([-(p.vWidth / 2 + 1), 0, 0], bar));
      }
    } else {
      foot = along(yM0, p.mountLen, poly([
        [-p.vixenW / 2, 0], [p.vixenW / 2, 0],
        [d.vxTop / 2, p.vixenH], [d.vxTop / 2, zTr0 + EPS],
        [-d.vxTop / 2, zTr0 + EPS], [-d.vxTop / 2, p.vixenH]
      ]));
    }

    const c = p.edgeChamfer, f = p.slotFloor, cw = p.cavityW, ch = p.cavityH, li = p.leadIn, pw = p.plateW, so = p.slotOpen, rh = d.roofH;
    const outer = poly([
      [-d.footTW / 2, zTr0], [d.footTW / 2, zTr0], [pw / 2, zPl0],
      [pw / 2, totalH - c], [pw / 2 - c, totalH], [-pw / 2 + c, totalH], [-pw / 2, totalH - c],
      [-pw / 2, zPl0]
    ]);
    const walls = [[cw / 2, zPl0 + f + rh], [cw / 2, zPl0 + f + rh + ch], [-cw / 2, zPl0 + f + rh + ch], [-cw / 2, zPl0 + f + rh]];
    const cavity = p.roof === 'peak'
      ? hull(p.peakR > 0
        ? circle({ radius: p.peakR, center: [0, zPl0 + f + p.peakR * Math.SQRT2], segments: SEG })
        : rectangle({ size: [EPS, EPS], center: [0, zPl0 + f] }), poly(walls))
      : poly([[-cw / 2 + rh, zPl0 + f], [cw / 2 - rh, zPl0 + f], ...walls]);
    const opening = poly([
      [-so / 2, zPl0 + f + rh + ch - EPS], [so / 2, zPl0 + f + rh + ch - EPS],
      [so / 2, totalH - li], [so / 2 + li, totalH + EPS], [-so / 2 - li, totalH + EPS], [-so / 2, totalH - li]
    ]);
    const plan = p.cornerR > 0
      ? roundedRectangle({ size: [pw, L], roundRadius: Math.min(p.cornerR, pw / 2 - EPS, L / 2 - EPS), segments: SEG, center: [0, L / 2] })
      : rectangle({ size: [pw, L], center: [0, L / 2] });
    const base = intersect(along(0, L, subtract(outer, cavity, opening)), translate([0, 0, -1], extrudeLinear({ height: totalH + 2 }, plan)));
    return union(foot, base);
  };

  // print orientation: slot face on the bed, foot pointing up
  const main = p => translate([0, 0, dims(p).height], rotateY(Math.PI, adapter(p)));

  const defaults = () => Object.fromEntries(getParameterDefinitions().filter(d => d.type !== 'group').map(d => [d.name, d.initial]));

  // for the configurator: size line and values shown in the text
  const summary = p => { const d = dims(p); return `${d.length.toFixed(0)} × ${d.width.toFixed(1)} × ${d.height.toFixed(1)} mm`; };
  const texts = p => {
    const d = dims(p);
    return {
      screw: (p.slotLip + 3).toFixed(1), vxTop: d.vxTop.toFixed(1),
      maxTubeD: d.maxTubeD.toFixed(0),
      vFit: p.tubeD <= d.maxTubeD
        ? `A ${p.tubeD} mm tube rests on both flanks, with its two contact lines ${d.contactSpan.toFixed(0)} mm apart.`
        : `A ${p.tubeD} mm tube is too big for this V: make the angle larger or the block wider.`
    };
  };

  const fileTag = p => `${p.mountType}-${Math.round(dims(p).length)}mm`;

  const api = { main, inUse: adapter, adapter, dims, defaults, summary, texts, fileTag, getParameterDefinitions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.FinderAdapter = api;
})();
