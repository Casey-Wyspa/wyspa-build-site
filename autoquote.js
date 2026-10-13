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
    if (!window.WB.canSend(file.name)) { inp.value = ''; return say(window.WB.noSend(file.name)); }   // B88
    say(`Reading ${file.name}…`);
    try {
      let geo;
      if (ext === 'dxf') geo = fromDxf(await file.text());
      else if (ext === 'stl') geo = fromMesh(parseStl(await file.arrayBuffer()));
      else if (['step', 'stp', 'iges', 'igs'].includes(ext)) {
        geo = fromMesh(await parseCad(file, ext), 'mm from file');
        // B66: the sizes come back in mm either way; an inch STEP says so, like an inch DXF (B57).
        if (ext !== 'iges' && ext !== 'igs' && /CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i.test(await file.text())) Object.assign(geo, { units: 'file says inches', inch: true });
      }
      else if (ext === '3dm') geo = await parse3dm(file);
      else if (file.type.startsWith('image/') || ['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
        // applyFile shows the message (it knows whether sizes were typed).
        return window.WB.applyFile(null, file, true);
      } else {
        say(`We can't read .${ext} files here. Export a STEP or DXF and drop that in, or fill in the fields. Your file will still be sent with the request.`);
        return window.WB.applyFile(null, file);
      }
      // Garbage files can give NaN, zero or absurd sizes: treat those as unreadable.
      if (![geo.L, geo.W, geo.H ?? 1].every(v => isFinite(v) && v > 0 && v < 1e5)) throw new Error('bad size');
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
    const uc = ui >= 0 ? parseInt(pairs[ui + 1][1], 10) : 0;
    if (uc) scale = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }[uc] || 1;
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
      else if (c === 8) cur.layer = v;
    }
    // POLYLINE + VERTEX entities -> one polyline
    const flat = [];
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      if (e.type === 'POLYLINE') {
        const p = { type: 'LWPOLYLINE', x: [], y: [], b: [], flags: e.flags, layer: e.layer };
        while (ents[k + 1] && ents[k + 1].type === 'VERTEX') { const vt = ents[++k]; p.x.push(vt.x[0]); p.y.push(vt.y[0]); p.b.push(vt.b[0] || 0); }
        flat.push(p);
      } else if (e.type !== 'VERTEX' && e.type !== 'SEQEND') flat.push(e);
    }
    // Drawing exports: leave out the border, title block, notes and dimensions (by layer name). TEXT, DIMENSION and
    // INSERT (title-block blocks) are never read. If that leaves nothing, the part was on such a layer: read everything.
    const drawn = e => /^(LINE|ARC|CIRCLE|LWPOLYLINE|SPLINE|ELLIPSE)$/.test(e.type);
    const skip = /border|title|frame|sheet(?![\s_-]*metal)|format|tblock|notes?\b|(^|[^a-z])dim/i;
    let list = flat.filter(e => drawn(e) && !skip.test(e.layer || ''));
    if (!list.length) list = flat.filter(drawn);
    // Each piece keeps its own box and length so a drawing frame can be told apart from the part inside it.
    const box = () => [Infinity, Infinity, -Infinity, -Infinity], grow = (b, c) => { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[2]); b[3] = Math.max(b[3], c[3]); };
    const all = [], shapes = [], segs = [];   // segs: open pieces (LINE, ARC, open polylines) to chain into loops
    let cb;
    const pt = (x, y) => grow(cb, [x, y, x, y]);
    const arcPts = (cx, cy, r, a0, a1) => { let s = a1 - a0; if (s <= 0) s += 360; for (let t = 0; t <= 16; t++) { const a = (a0 + s * t / 16) * Math.PI / 180; pt(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return r * s * Math.PI / 180; };
    for (const e of list) {
      cb = box();
      let len = 0, closed = false, chain = null;
      if (e.type === 'LINE' && e.x.length) { pt(e.x[0], e.y[0]); pt(e.x2, e.y2); len = Math.hypot(e.x2 - e.x[0], e.y2 - e.y[0]); chain = [e.x[0], e.y[0], e.x2, e.y2]; }
      else if (e.type === 'CIRCLE') { closed = true; len = arcPts(e.x[0], e.y[0], e.r, 0, 360); }
      else if (e.type === 'ARC') {
        len = arcPts(e.x[0], e.y[0], e.r, e.a0 || 0, e.a1 || 0);
        const r = e.r, a0 = (e.a0 || 0) * Math.PI / 180, a1 = (e.a1 || 0) * Math.PI / 180;
        chain = [e.x[0] + r * Math.cos(a0), e.y[0] + r * Math.sin(a0), e.x[0] + r * Math.cos(a1), e.y[0] + r * Math.sin(a1)];
      }
      else if (e.type === 'LWPOLYLINE' && e.x.length > 1) {
        const isClosed = (e.flags & 1) === 1, n = e.x.length;
        if (isClosed) closed = true; else chain = [e.x[0], e.y[0], e.x[n - 1], e.y[n - 1]];
        for (let k = 0; k < (isClosed ? n : n - 1); k++) {
          const j = (k + 1) % n, d = Math.hypot(e.x[j] - e.x[k], e.y[j] - e.y[k]), bu = e.b[k] || 0;
          pt(e.x[k], e.y[k]);
          if (bu && d) {   // bulged segment = arc: add its length and its extent
            const th = 4 * Math.atan(bu), h = d * (1 - bu * bu) / (4 * bu);
            const cx = (e.x[k] + e.x[j]) / 2 - (e.y[j] - e.y[k]) / d * h, cy = (e.y[k] + e.y[j]) / 2 + (e.x[j] - e.x[k]) / d * h;
            const r = Math.hypot(e.x[k] - cx, e.y[k] - cy), s = Math.atan2(e.y[k] - cy, e.x[k] - cx);
            for (let t = 1; t < 32; t++) pt(cx + r * Math.cos(s + th * t / 32), cy + r * Math.sin(s + th * t / 32));
            len += r * Math.abs(th);
          } else len += d;
        }
        pt(e.x[n - 1], e.y[n - 1]);
      } else if ((e.type === 'SPLINE' || e.type === 'ELLIPSE') && e.x.length) {
        for (let k = 0; k < e.x.length; k++) pt(e.x[k], e.y[k]);
        for (let k = 1; k < e.x.length; k++) len += Math.hypot(e.x[k] - e.x[k - 1], e.y[k] - e.y[k - 1]);
        closed = e.type === 'SPLINE' && (e.flags & 1) === 1;
      }
      if (!isFinite(cb[0])) continue;
      const s = { bb: cb, len, closed };
      all.push(s);
      if (chain) segs.push([...chain, s]); else shapes.push(s);
    }
    const bb = box();
    all.forEach(s => grow(bb, s.bb));
    if (!isFinite(bb[0])) throw new Error('no geometry');
    // Chain loose pieces (LINE/ARC exports from Fusion, SolidWorks) into closed loops: a group of
    // pieces whose ends all meet another end is one loop (outline or cutout).
    const tol = Math.max(1e-6, 1e-4 * Math.hypot(bb[2] - bb[0], bb[3] - bb[1])), nodes = new Map(), par = [], deg = [];
    const find = a => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
    const node = (x, y) => {
      const gx = Math.round(x / tol), gy = Math.round(y / tol);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const id = nodes.get((gx + dx) + ',' + (gy + dy)); if (id != null) return id; }
      const id = par.length; par.push(id); deg.push(0); nodes.set(gx + ',' + gy, id); return id;
    };
    const ends = segs.map(([x1, y1, x2, y2]) => { const a = node(x1, y1), b = node(x2, y2); deg[a]++; deg[b]++; par[find(a)] = find(b); return a; });
    const open = new Set(par.map((_, k) => k).filter(k => deg[k] < 2).map(find)), groups = new Map();
    segs.forEach((g, k) => {
      const r = find(ends[k]);
      if (!groups.has(r)) { groups.set(r, { bb: box(), len: 0, closed: !open.has(r) }); shapes.push(groups.get(r)); }
      grow(groups.get(r).bb, g[4].bb); groups.get(r).len += g[4].len;
    });
    // No units in the file and a part this small: almost certainly drawn in inches.
    // B57: name the file's unit ("file says inches"), so the size can be shown in it.
    const un = { 1: 'inches', 2: 'feet', 4: 'mm', 5: 'cm', 6: 'm' }[uc];
    let units = uc ? (un ? `file says ${un}` : 'units from file') : 'assumed mm';
    if (!uc && Math.max(bb[2] - bb[0], bb[3] - bb[1]) * scale < 25) { scale = 25.4; units = "assumed inches; change the size if that's wrong"; }
    // Still the size of a drawing sheet (ISO A0-A4, ANSI A-E) with a closed frame: price the largest loop inside
    // the frame if it has holes in it or stray title-block lines are left; otherwise keep the frame and ask.
    const mm = b => [b[2] - b[0], b[3] - b[1]].map(v => v * scale).sort((x, y) => y - x);
    const isSheet = b => { const [a, c] = mm(b); return [[1189, 841], [841, 594], [594, 420], [420, 297], [297, 210], [279.4, 215.9], [431.8, 279.4], [558.8, 431.8], [863.6, 558.8], [1117.6, 863.6]].some(([p, q]) => Math.abs(a / p - 1) < 0.03 && Math.abs(c / q - 1) < 0.03); };
    const inside = (s, o) => s !== o && s.bb[0] >= o.bb[0] - tol && s.bb[1] >= o.bb[1] - tol && s.bb[2] <= o.bb[2] + tol && s.bb[3] <= o.bb[3] + tol;
    const area = s => (s.bb[2] - s.bb[0]) * (s.bb[3] - s.bb[1]);
    let part = { bb, len: all.reduce((t, s) => t + s.len, 0) }, inner = shapes;
    if (isSheet(bb) && shapes.some(s => s.closed && isSheet(s.bb))) {
      // Inner drawing frames (a loop covering most of the sheet) are not the part either.
      const frame = s => { const [a, c] = mm(s.bb), [A, C] = mm(bb); return isSheet(s.bb) || (a > 0.85 * A && c > 0.85 * C); };
      const cand = shapes.filter(s => s.closed && !frame(s)).sort((x, y) => area(y) - area(x))[0];
      if (cand && (shapes.some(s => s.closed && inside(s, cand)) || shapes.some(s => !s.closed))) {
        inner = shapes.filter(s => inside(s, cand));
        part = { bb: cand.bb, len: cand.len + inner.reduce((t, s) => t + s.len, 0) };
        units += '; we left out the drawing border, so check the size';
      } else units += '; this may be the drawing sheet, not the part';
    }
    const [x0, y0, x1, y1] = part.bb, holes = inner.filter(s => s.closed).length - (part.bb === bb ? 1 : 0);
    return { kind: 'panel', L: (x1 - x0) * scale, W: (y1 - y0) * scale, cutM: part.len * scale / 1000, holes: Math.max(0, holes), units, inch: uc === 1 };
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
    for (let i = 0; i + 8 < t.length; i += 9) {
      let ok = true;
      for (let j = 0; j < 9; j++) if (!isFinite(t[i + j])) ok = false;
      if (!ok) continue;
      for (let j = 0; j < 9; j++) { const a = j % 3; lo[a] = Math.min(lo[a], t[i + j]); hi[a] = Math.max(hi[a], t[i + j]); }
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      vol += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
    }
    const ext = [0, 1, 2].map(k => hi[k] - lo[k]), ax = ext.indexOf(Math.min(...ext));
    let [a, b, c] = [...ext].sort((x, y) => y - x), s = 1;
    if (!(isFinite(a) && a > 0 && isFinite(area) && isFinite(vol))) throw new Error('bad mesh');
    vol = Math.abs(vol);
    let wall = vol > 0 ? 2 * vol / area : 0;            // thin shell: volume ≈ (area / 2) × wall
    // No units (STL) and tiny: almost certainly drawn in inches, same rule as DXF. Small-ish: ask.
    if (U === 'assumed mm' && a < 25) { s = 25.4; [a, b, c, wall] = [a, b, c, wall].map(v => v * 25.4); U = "assumed inches; change the size if that's wrong"; }
    else if (U === 'assumed mm' && a < 60) U = "read as mm; if it's in inches, fix the size";
    if (c <= Math.max(wall * 1.5, 0.5) || c < 0.04 * b) return { kind: 'panel', L: a, W: b, T: c, units: U, ...plateEdges(t, ax, c / s, s) };
    const shape = (area / 2) / (a * b);                 // mold-side surface vs. footprint
    return { kind: 'molded', L: a, W: b, H: c, wall, complex: shape > 2.5, units: U };
  }

  // Flat plate from a 3D file (B39): the side walls are the cut edges. Their area ÷ thickness = total cut length
  // (outline + holes + cutouts); each separate ring of side wall is one outline, hole or cutout, like closed shapes in a DXF.
  // ax = the thin axis in file units, T = thickness in file units, s = file units -> mm.
  // Tilted or odd plates give nothing back, and the page then prices a plain rectangle as before.
  function plateEdges(t, ax, T, s) {
    if (!(T > 0)) return {};
    const parent = new Map(), find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const q = T / 50, key = (i) => `${Math.round(t[i] / q)},${Math.round(t[i + 1] / q)},${Math.round(t[i + 2] / q)}`;
    let side = 0;
    for (let i = 0; i + 8 < t.length; i += 9) {
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], len = Math.hypot(...n);
      if (!(len > 0) || Math.abs(n[ax]) > 0.5 * len) continue;   // top and bottom faces
      side += len / 2;
      const ks = [key(i), key(i + 3), key(i + 6)];
      ks.forEach(k => { if (!parent.has(k)) parent.set(k, k); });
      parent.set(find(ks[1]), find(ks[0])); parent.set(find(ks[2]), find(ks[0]));
    }
    const rings = new Set([...parent.keys()].map(find)).size, cutM = side / T * s / 1000;
    if (!rings || rings > 500 || !isFinite(cutM)) return {};
    return { holes: rings - 1, cutM };
  }

  // ---------- wiring ----------
  const zone = $('#drop'), inp = $('#cad');
  inp.addEventListener('change', () => inp.files[0] && handle(inp.files[0]));
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('on'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('on'); }));
  zone.addEventListener('drop', e => e.dataTransfer.files[0] && handle(e.dataTransfer.files[0]));
  window.WB_readFile = handle;
})();
