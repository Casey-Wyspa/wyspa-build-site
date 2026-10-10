// Wyspa Build: read a CAD file in the browser and fill in the quote fields.
// DXF -> flat panel (outline, cut length, holes). STEP/IGES/STL -> flat panel or molded part
// (size, surface area, wall thickness). Choices round up so the instant price errs high.
// Nothing leaves the browser until the customer presses Send.
(function () {
  const $ = s => document.querySelector(s);
  const say = t => { $('#cadmsg').textContent = t; };
  const OCCT = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';
  const RH = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/';

  async function handle(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    say(`Reading ${file.name}…`);
    try {
      let geo;
      if (ext === 'dxf') geo = fromDxf(await file.text());
      else if (ext === 'stl') geo = fromMesh(parseStl(await file.arrayBuffer()));
      else if (['step', 'stp', 'iges', 'igs'].includes(ext)) geo = fromMesh(await parseCad(file, ext), 'mm from file');
      else if (ext === '3dm') geo = await parse3dm(file);
      else {
        say(`We can't read .${ext} files here. Export a STEP or DXF and drop that in, or fill in the fields. Your file will still be sent with the request.`);
        return window.WB.applyFile(null, file);
      }
      window.WB.applyFile(geo, file);
    } catch (e) {
      say(`Couldn't read ${file.name}. Fill in the fields below; your file will still be sent with the request.`);
      window.WB.applyFile(null, file);
    }
  }

  // ---------- DXF (2D) ----------
  function fromDxf(text) {
    const ln = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < ln.length; i += 2) pairs.push([parseInt(ln[i], 10), ln[i + 1].trim()]);
    let scale = 1, i = 0;
    const ui = pairs.findIndex(p => p[0] === 9 && p[1] === '$INSUNITS');
    if (ui >= 0) scale = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }[parseInt(pairs[ui + 1][1], 10)] || 1;
    while (i < pairs.length && !(pairs[i][0] === 2 && pairs[i][1] === 'ENTITIES')) i++;
    const ents = [];
    let cur = null;
    for (; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) {
        if (v === 'ENDSEC') break;
        cur = { type: v, x: [], y: [], b: [] }; ents.push(cur); continue;
      }
      if (!cur) continue;
      const n = parseFloat(v);
      if (c === 10) { cur.x.push(n); cur.b.push(0); } else if (c === 20) cur.y.push(n);
      else if (c === 11) cur.x2 = n; else if (c === 21) cur.y2 = n;
      else if (c === 40) cur.r = n; else if (c === 50) cur.a0 = n; else if (c === 51) cur.a1 = n;
      else if (c === 42 && cur.b.length) cur.b[cur.b.length - 1] = n;
      else if (c === 70) cur.flags = parseInt(v, 10);
    }
    // POLYLINE + VERTEX entities -> one polyline
    const flat = [];
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      if (e.type === 'POLYLINE') {
        const p = { type: 'LWPOLYLINE', x: [], y: [], b: [], flags: e.flags };
        while (ents[k + 1] && ents[k + 1].type === 'VERTEX') { const vt = ents[++k]; p.x.push(vt.x[0]); p.y.push(vt.y[0]); p.b.push(vt.b[0] || 0); }
        flat.push(p);
      } else if (e.type !== 'VERTEX' && e.type !== 'SEQEND') flat.push(e);
    }
    let len = 0, closed = 0, circles = 0;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    const pt = (x, y) => { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); };
    const arcPts = (cx, cy, r, a0, a1) => { let s = a1 - a0; if (s <= 0) s += 360; for (let t = 0; t <= 16; t++) { const a = (a0 + s * t / 16) * Math.PI / 180; pt(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return r * s * Math.PI / 180; };
    for (const e of flat) {
      if (e.type === 'LINE' && e.x.length) { pt(e.x[0], e.y[0]); pt(e.x2, e.y2); len += Math.hypot(e.x2 - e.x[0], e.y2 - e.y[0]); }
      else if (e.type === 'CIRCLE') { circles++; len += arcPts(e.x[0], e.y[0], e.r, 0, 360); }
      else if (e.type === 'ARC') len += arcPts(e.x[0], e.y[0], e.r, e.a0, e.a1);
      else if (e.type === 'LWPOLYLINE' && e.x.length > 1) {
        const isClosed = (e.flags & 1) === 1, n = e.x.length;
        if (isClosed) closed++;
        for (let k = 0; k < (isClosed ? n : n - 1); k++) {
          const j = (k + 1) % n, d = Math.hypot(e.x[j] - e.x[k], e.y[j] - e.y[k]), bu = e.b[k] || 0;
          pt(e.x[k], e.y[k]);
          len += bu ? d * (Math.atan(bu) * 4) / (2 * Math.sin(Math.atan(bu) * 2)) : d;   // arc length for bulged segments
        }
        pt(e.x[n - 1], e.y[n - 1]);
      } else if ((e.type === 'SPLINE' || e.type === 'ELLIPSE') && e.x.length) {
        for (let k = 0; k < e.x.length; k++) pt(e.x[k], e.y[k]);
        for (let k = 1; k < e.x.length; k++) len += Math.hypot(e.x[k] - e.x[k - 1], e.y[k] - e.y[k - 1]);
        if (e.type === 'SPLINE' && (e.flags & 1)) closed++;
      }
    }
    if (!isFinite(bb[0])) throw new Error('no geometry');
    const L = (bb[2] - bb[0]) * scale, W = (bb[3] - bb[1]) * scale;
    return { kind: 'panel', L, W, cutM: len * scale / 1000, holes: Math.max(0, circles + closed - 1), units: scale === 1 && ui < 0 ? 'assumed mm' : 'units from file' };
  }

  // ---------- 3D meshes ----------
  function parseStl(buf) {
    const dv = new DataView(buf), n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    if (n && 84 + n * 50 === buf.byteLength) {
      const t = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) t[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
      return t;
    }
    const m = new TextDecoder().decode(buf).match(/vertex\s+\S+\s+\S+\s+\S+/g) || [];
    return Float32Array.from(m.flatMap(s => s.split(/\s+/).slice(1).map(Number)));
  }

  function loadOcct() {
    if (window._occt) return window._occt;
    window._occt = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = OCCT + 'occt-import-js.js';
      s.onload = () => window.occtimportjs({ locateFile: f => OCCT + f }).then(ok, no);
      s.onerror = no;
      document.head.appendChild(s);
    });
    return window._occt;
  }

  async function parseCad(file, ext) {
    say(`Reading ${file.name}… (first STEP file takes a few seconds)`);
    const occt = await loadOcct(), data = new Uint8Array(await file.arrayBuffer());
    const r = ext.startsWith('i') ? occt.ReadIgesFile(data, null) : occt.ReadStepFile(data, null);
    if (!r.success || !r.meshes.length) throw new Error('no shapes');
    const tri = [];
    for (const m of r.meshes) {
      const p = m.attributes.position.array, idx = m.index.array;
      for (let i = 0; i < idx.length; i++) tri.push(p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2]);
    }
    return Float32Array.from(tri);
  }

  // ---------- Rhino .3dm ----------
  function loadRhino() {
    if (window._rh) return window._rh;
    window._rh = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = RH + 'rhino3dm.min.js';
      s.onload = () => window.rhino3dm({ locateFile: f => RH + f }).then(ok, no);
      s.onerror = no;
      document.head.appendChild(s);
    });
    return window._rh;
  }

  async function parse3dm(file) {
    say(`Reading ${file.name}… (first Rhino file takes a few seconds)`);
    const rh = await loadRhino();
    const doc = rh.File3dm.fromByteArray(new Uint8Array(await file.arrayBuffer()));
    if (!doc) throw new Error('not a Rhino file');
    const U = rh.UnitSystem, u = doc.settings().modelUnitSystem.value;
    const k = { [U.Millimeters.value]: 1, [U.Centimeters.value]: 10, [U.Meters.value]: 1000, [U.Inches.value]: 25.4, [U.Feet.value]: 304.8 }[u] || 1;
    const tri = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let curves = 0, closedCurves = 0, solids = 0;
    const addMesh = m => {
      if (!m) return;
      const j = m.toThreejsJSON().data, p = j.attributes.position.array, idx = j.index ? j.index.array : [...Array(p.length / 3).keys()];
      for (let i = 0; i < idx.length; i++) tri.push(p[idx[i] * 3] * k, p[idx[i] * 3 + 1] * k, p[idx[i] * 3 + 2] * k);
    };
    const objs = doc.objects();
    for (let i = 0; i < objs.count; i++) {
      const g = objs.get(i).geometry(), b = g.getBoundingBox();
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], b.min[a] * k); hi[a] = Math.max(hi[a], b.max[a] * k); }
      if (g instanceof rh.Mesh) { addMesh(g); solids++; }
      else if (g instanceof rh.Brep) { solids++; const f = g.faces(); for (let n = 0; n < f.count; n++) addMesh(f.get(n).getMesh(rh.MeshType.Any)); }
      else if (g instanceof rh.Extrusion) { solids++; addMesh(g.getMesh(rh.MeshType.Any)); }
      else if (g instanceof rh.Curve) { curves++; if (g.isClosed) closedCurves++; }
    }
    if (!isFinite(lo[0])) throw new Error('empty file');
    const dims = [0, 1, 2].map(a => hi[a] - lo[a]).sort((x, y) => y - x), units = k === 1 ? 'mm from file' : 'converted to mm';
    if (!solids && curves) return { kind: 'panel', L: dims[0], W: dims[1], holes: Math.max(0, closedCurves - 1), cutM: 0, units };
    if (tri.length >= 9) return fromMesh(Float32Array.from(tri), units);
    // Surfaces saved without render meshes: size only
    return dims[2] < 0.04 * dims[1] ? { kind: 'panel', L: dims[0], W: dims[1], T: dims[2] || 0, units } : { kind: 'molded', L: dims[0], W: dims[1], H: dims[2], units };
  }

  function fromMesh(t, U = 'assumed mm') {
    if (t.length < 9) throw new Error('empty mesh');
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let area = 0, vol = 0;
    for (let i = 0; i < t.length; i += 9) {
      for (let j = 0; j < 9; j++) { const a = j % 3; lo[a] = Math.min(lo[a], t[i + j]); hi[a] = Math.max(hi[a], t[i + j]); }
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      vol += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
    }
    const [a, b, c] = [0, 1, 2].map(k => hi[k] - lo[k]).sort((x, y) => y - x);
    vol = Math.abs(vol);
    const wall = vol > 0 ? 2 * vol / area : 0;          // thin shell: volume ≈ (area / 2) × wall
    if (c <= Math.max(wall * 1.5, 0.5) || c < 0.04 * b) return { kind: 'panel', L: a, W: b, T: c, units: U };
    const shape = (area / 2) / (a * b);                 // mold-side surface vs. footprint
    return { kind: 'molded', L: a, W: b, H: c, wall, complex: shape > 2.5, units: U };
  }

  // ---------- wiring ----------
  const zone = $('#drop'), inp = $('#cad');
  inp.addEventListener('change', () => inp.files[0] && handle(inp.files[0]));
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('on'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('on'); }));
  zone.addEventListener('drop', e => e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]));
  window.WB_readFile = handle;
})();
