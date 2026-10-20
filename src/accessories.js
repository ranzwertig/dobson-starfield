// Accessories page: configurator for the finder-shoe adapter (src/finder-adapter.js, a JSCAD design).
// Builds the form from the design's parameter definitions, renders the part with a small WebGL viewer
// (no 3D library needed) and writes a binary STL in print orientation for download.
'use strict';
(function () {
  const A = globalThis.FinderAdapter;
  const { geometries, measurements } = globalThis.jscadModeling;
  const defs = A.getParameterDefinitions();
  const defaults = A.defaults();
  const $ = s => document.querySelector(s);

  // ---------- parameters: defaults, overridden by the address (?mountType=vixen&overhangFront=80) ----------
  const params = { ...defaults };
  const q = new URLSearchParams(location.search);
  for (const d of defs) {
    if (d.type === 'group' || !q.has(d.name)) continue;
    const v = q.get(d.name);
    if (d.type === 'choice' ? d.values.includes(v) : isFinite(+v)) params[d.name] = d.type === 'choice' ? v : Math.min(d.max, Math.max(d.min, +v));
  }
  const saveToUrl = () => {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== defaults[k]) out.set(k, v);
    history.replaceState(null, '', location.pathname + (out.size ? '?' + out : '') + location.hash);
  };

  // ---------- form ----------
  // groups shown inside a closed <details>: fine-tuning most people never need
  const ADVANCED = new Set(['gSlot']);
  const form = $('#cfg-form');
  const inputs = {};
  let box = form, groupEls = {};
  const fmt = (d, v) => d.step < 1 ? (+v).toFixed(String(d.step).split('.')[1].length) : String(v);
  for (const d of defs) {
    if (d.type === 'group') {
      const wrap = document.createElement(ADVANCED.has(d.name) ? 'details' : 'fieldset');
      wrap.className = 'grp';
      const head = document.createElement(ADVANCED.has(d.name) ? 'summary' : 'legend');
      head.textContent = d.caption;
      wrap.append(head);
      form.append(wrap);
      box = wrap; groupEls[d.name] = wrap;
      continue;
    }
    const row = document.createElement('label');
    row.className = 'row';
    const cap = document.createElement('span');
    cap.textContent = d.caption;
    row.append(cap);
    if (d.type === 'choice') {
      const sel = document.createElement('select');
      sel.name = d.name;
      d.values.forEach((v, i) => sel.add(new Option(d.captions[i], v)));
      sel.value = params[d.name];
      sel.addEventListener('change', () => { params[d.name] = sel.value; changed(); });
      row.append(sel);
      inputs[d.name] = { set: v => { sel.value = v; } };
    } else {
      const range = document.createElement('input');
      Object.assign(range, { type: 'range', min: d.min, max: d.max, step: d.step, value: params[d.name], name: d.name });
      range.setAttribute('aria-label', d.caption);
      const num = document.createElement('input');
      Object.assign(num, { type: 'number', min: d.min, max: d.max, step: d.step, value: fmt(d, params[d.name]), inputMode: 'decimal' });
      num.setAttribute('aria-label', d.caption + ' in mm');
      const unit = document.createElement('i');
      unit.textContent = d.name === 'vixenAngle' ? '°' : 'mm';
      range.addEventListener('input', () => { params[d.name] = +range.value; num.value = fmt(d, range.value); changed(); });
      num.addEventListener('change', () => {
        const v = Math.min(d.max, Math.max(d.min, +num.value || d.min));
        params[d.name] = v; range.value = v; num.value = fmt(d, v); changed();
      });
      const ctl = document.createElement('span');
      ctl.className = 'ctl';
      ctl.append(range, num, unit);
      row.append(ctl);
      inputs[d.name] = { set: v => { range.value = v; num.value = fmt(d, v); } };
    }
    box.append(row);
  }
  const showGroups = () => {
    groupEls.gES.hidden = params.mountType !== 'es';
    groupEls.gVixen.hidden = params.mountType !== 'vixen';
  };
  $('#cfg-reset').addEventListener('click', () => {
    Object.assign(params, defaults);
    for (const [k, inp] of Object.entries(inputs)) inp.set(params[k]);
    changed();
  });

  // ---------- geometry -> triangles ----------
  // positions and flat normals of all triangles (polygons from JSCAD are planar and convex: fan triangulation)
  const triangles = geom => {
    const pos = [], nrm = [];
    for (const pg of geometries.geom3.toPolygons(geom)) {
      const v = pg.vertices;
      if (v.length < 3) continue;
      const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
      const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let i = 1; i < v.length - 1; i++) for (const p of [v[0], v[i], v[i + 1]]) { pos.push(p[0], p[1], p[2]); nrm.push(nx, ny, nz); }
    }
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm) };
  };

  const stlBlob = ({ pos, nrm }) => {
    const n = pos.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const head = 'Zenigo finder-shoe adapter, mm, print orientation';
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, n, true);
    for (let t = 0, o = 84; t < n; t++, o += 50) {
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, nrm[t * 9 + k], true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, pos[t * 9 + k], true);
    }
    return new Blob([buf], { type: 'model/stl' });
  };

  // ---------- tiny WebGL viewer ----------
  const canvas = $('#cfg-view');
  const gl = canvas.getContext('webgl', { antialias: true });
  let mesh = null, count = 0, center = [0, 0, 0], radius = 50;
  let yaw = deg(-55), pitch = deg(22), zoom = 1;
  function deg(a) { return a * Math.PI / 180; }

  let prog, aPos, aNrm, uMvp, uModel, bufP, bufN;
  if (gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `
      attribute vec3 p; attribute vec3 n; uniform mat4 mvp; uniform mat3 rot; varying vec3 vn;
      void main(){ vn = rot * n; gl_Position = mvp * vec4(p, 1.0); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `
      precision mediump float; varying vec3 vn;
      void main(){
        vec3 n = normalize(vn);
        float key = max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
        float fill = max(dot(n, normalize(vec3(0.6, -0.2, 0.5))), 0.0);
        vec3 c = vec3(0.94, 0.66, 0.27);
        gl_FragColor = vec4(c * (0.28 + 0.62 * key + 0.22 * fill), 1.0);
      }`));
    gl.linkProgram(prog);
    aPos = gl.getAttribLocation(prog, 'p'); aNrm = gl.getAttribLocation(prog, 'n');
    uMvp = gl.getUniformLocation(prog, 'mvp'); uModel = gl.getUniformLocation(prog, 'rot');
    bufP = gl.createBuffer(); bufN = gl.createBuffer();
  } else {
    $('#cfg-noview').hidden = false;
  }

  // column-major 4x4 helpers
  const mul = (a, b) => { const r = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; r[i * 4 + j] = s; } return r; };
  const persp = (fov, asp, near, far) => { const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far); return new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); };
  // camera orbits the part; the part's Z axis points up on screen
  const viewRot = () => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // rows: camera right, up and back axes in world coordinates (back = from the part towards the camera)
    return [cy, -sy, 0, sp * sy, sp * cy, cp, -cp * sy, -cp * cy, sp];
  };

  function draw() {
    if (!gl || !mesh) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.024, 0.031, 0.059, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const r = viewRot();
    const dist = radius * 2.6 / zoom;
    // view = translate(0,0,-dist) * R * translate(-center)
    const R = new Float32Array([r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, 0, 0, 0, 1]);
    const T = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -center[0], -center[1], -center[2], 1]);
    const V = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1]);
    const P = persp(deg(35), w / h, Math.max(dist - radius * 2, 1), dist + radius * 2);
    const mvp = mul(P, mul(V, mul(R, T)));
    gl.useProgram(prog);
    gl.uniformMatrix4fv(uMvp, false, mvp);
    gl.uniformMatrix3fv(uModel, false, new Float32Array([r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]));
    gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufN); gl.enableVertexAttribArray(aNrm); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }
  let frame = 0;
  const redraw = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); };
  new ResizeObserver(redraw).observe(canvas);

  // orbit with one pointer, zoom with two (pinch) or the wheel
  const pts = new Map();
  let pinch0 = 0, zoom0 = 1;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = zoom; } });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      yaw -= (e.clientX - prev[0]) * 0.01;
      pitch = Math.max(deg(-89), Math.min(deg(89), pitch + (e.clientY - prev[1]) * 0.01));
    } else if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()];
      zoom = Math.max(0.4, Math.min(6, zoom0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch0));
    }
    redraw();
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(0.4, Math.min(6, zoom * Math.exp(-e.deltaY * 0.0015))); redraw(); }, { passive: false });

  // ---------- update ----------
  let printView = false, current = null;
  const views = document.querySelectorAll('[name="cfg-orient"]');
  views.forEach(r => r.addEventListener('change', () => { if (r.checked) { printView = r.value === 'print'; update(true); } }));

  function update(refit) {
    showGroups();
    const geom = printView ? A.main(params) : A.adapter(params);
    current = geom;
    const t = triangles(geom);
    const [lo, hi] = measurements.measureBoundingBox(geom);
    center = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const newR = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    if (refit || !mesh) radius = newR; else radius = Math.max(radius * 0.98, newR);   // grows with the part, does not jump while sliding
    if (gl) {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.bufferData(gl.ARRAY_BUFFER, t.pos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufN); gl.bufferData(gl.ARRAY_BUFFER, t.nrm, gl.DYNAMIC_DRAW);
      count = t.pos.length / 3; mesh = true;
    }
    const d = A.dims(params);
    $('#cfg-size').textContent = `${d.length.toFixed(0)} × ${d.width.toFixed(1)} × ${d.height.toFixed(1)} mm`;
    $('#cfg-screw').textContent = `${(params.slotLip + 3).toFixed(1)} mm`;
    $('#cfg-vixen').hidden = params.mountType !== 'vixen';
    $('#cfg-vxtop').textContent = d.vxTop.toFixed(1);
    redraw();
  }

  let pending = 0;
  function changed() {
    saveToUrl();
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; update(false); });
  }

  $('#cfg-download').addEventListener('click', () => {
    const t = triangles(A.main(params));   // always print orientation
    const name = `zenigo-finder-adapter-${params.mountType}-${A.dims(params).length.toFixed(0)}mm.stl`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(stlBlob(t));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  update(true);
})();
