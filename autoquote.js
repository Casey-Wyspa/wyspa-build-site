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
      const s = { bb: cb, len, closed, round: e.type === 'CIRCLE' };
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
    // B146: two or more closed loops that sit inside no other closed loop are separate parts nested on one sheet, priced as
    // a set (each part's holes stay holes). Only when every other shape is inside one of them; a drawing frame never gets here.
    // B122: round holes (circles, or closed loops as wide as tall with a circle's perimeter) vs other cutouts, for the
    // words only; the price uses the total. When the outline is in the list, the largest closed loop is it.
    const isRound = s => { const w = s.bb[2] - s.bb[0], h = s.bb[3] - s.bb[1]; return s.round || (w > 0 && h > 0 && Math.abs(w / h - 1) < 0.03 && Math.abs(s.len / (Math.PI * (w + h) / 2) - 1) < 0.02); };
    let set = null;
    if (part.bb === bb) {
      // B162: nesting depth, even/odd. Loops at depth 0, 2, 4 are parts (a lid nested in another part's cutout); depth 1, 3 are
      // holes or cutouts of the part around them. A round loop centred in a round hole (a counterbore drawn as 2 circles) stays a hole.
      const cl = shapes.filter(s => s.closed), outer = s => cl.filter(o => inside(s, o)), mid = s => [(s.bb[0] + s.bb[2]) / 2, (s.bb[1] + s.bb[3]) / 2];
      const ring = (s, o) => isRound(s) && isRound(o) && Math.hypot(mid(s)[0] - mid(o)[0], mid(s)[1] - mid(o)[1]) <= tol + 0.02 * (o.bb[2] - o.bb[0]);
      const top = cl.filter(s => { const os = outer(s); if (os.length % 2) return false; if (!os.length) return true;
        const hole = os.reduce((a, o) => area(o) < area(a) ? o : a); return !ring(s, hole); });
      if (top.length > 1 && shapes.every(s => top.includes(s) || top.some(o => inside(s, o)))) set = top;
    }
    const [x0, y0, x1, y1] = part.bb, holes = set ? shapes.filter(s => s.closed).length - set.length : inner.filter(s => s.closed).length - (part.bb === bb ? 1 : 0);
    const loops = set ? shapes.filter(s => s.closed && !set.includes(s)) : inner.filter(s => s.closed);
    if (!set && part.bb === bb && loops.length) loops.splice(loops.indexOf(loops.reduce((a, s) => area(s) > area(a) ? s : a)), 1);
    // B146: each part's size in mm, long side first, largest part first.
    const parts = set && set.map(s => [s.bb[2] - s.bb[0], s.bb[3] - s.bb[1]].map(v => v * scale).sort((p, q) => q - p)).sort((p, q) => q[0] * q[1] - p[0] * p[1]);
    const round = Math.min(Math.max(0, holes), loops.filter(isRound).length);
    // B132: each hole's edge length (m), so the page doesn't charge a hole's edge twice (it's already in cutM).
    const holeM = loops.length === Math.max(0, holes) ? loops.map(s => s.len * scale / 1000) : null;
    return { kind: 'panel', L: (x1 - x0) * scale, W: (y1 - y0) * scale, cutM: part.len * scale / 1000, holes: Math.max(0, holes), round, holeM, parts, units, inch: uc === 1 || scale === 25.4 && !uc };
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
    let area = 0, vol = 0; const S = [0, 0, 0];   // S: sum of the triangles' area vectors, zero for a closed surface
    for (let i = 0; i + 8 < t.length; i += 9) {
      let ok = true;
      for (let j = 0; j < 9; j++) if (!isFinite(t[i + j])) ok = false;
      if (!ok) continue;
      for (let j = 0; j < 9; j++) { const a = j % 3; lo[a] = Math.min(lo[a], t[i + j]); hi[a] = Math.max(hi[a], t[i + j]); }
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      area += Math.hypot(...n) / 2; n.forEach((v, k) => S[k] += v / 2);
      vol += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
    }
    const ext = [0, 1, 2].map(k => hi[k] - lo[k]), ax = ext.indexOf(Math.min(...ext));
    let [a, b, c] = [...ext].sort((x, y) => y - x), s = 1;
    if (!(isFinite(a) && a > 0 && isFinite(area) && isFinite(vol))) throw new Error('bad mesh');
    // B68: closed shell (every edge used twice) = outside + inside + rim, so one side is half; an open surface is one side already.
    const q = a * 1e-5, key = i => `${Math.round(t[i] / q)},${Math.round(t[i + 1] / q)},${Math.round(t[i + 2] / q)}`, edges = new Map();
    for (let i = 0; i + 8 < t.length; i += 9) {
      const k = [key(i), key(i + 3), key(i + 6)];
      for (let j = 0; j < 3; j++) { const e = [k[j], k[(j + 1) % 3]].sort().join('|'), o = edges.get(e); if (o) o.n++; else edges.set(e, { n: 1, p: i + 3 * j, r: i + 3 * ((j + 1) % 3) }); }
    }
    let openLen = 0;   // total length of edges used once (holes in the mesh)
    for (const o of edges.values()) if (o.n === 1) openLen += Math.hypot(t[o.p] - t[o.r], t[o.p + 1] - t[o.r + 1], t[o.p + 2] - t[o.r + 2]);
    const open = openLen > 0;
    vol = Math.abs(vol);
    // B104: an open surface (a Rhino cover exported as a surface) has no volume or wall; its "volume" depends on where the origin is.
    // Tested by shape, not shared edges, since STEP faces are meshed apart even on a closed solid.
    let wall = vol > 0 && Math.hypot(...S) < 0.1 * area ? 2 * vol / area : 0;   // thin shell: volume ≈ (area / 2) × wall
    // B156: a measured wall means two skins, so one side is half the area, even with a small gap in the mesh (a nozzle hole
    // exported with no rim face): open edges shorter than half the footprint's perimeter. A real open surface keeps its full area.
    const oneSide = !open || wall > 0 && openLen < (a + b) ? area / 2 : area;
    // No units (STL) and tiny: almost certainly drawn in inches, same rule as DXF. Small-ish: ask.
    if (U === 'assumed mm' && a < 25) { s = 25.4; [a, b, c, wall] = [a, b, c, wall].map(v => v * 25.4); U = "assumed inches; change the size if that's wrong"; }
    else if (U === 'assumed mm' && a < 60) U = "read as mm; if it's in inches, fix the size";
    // B107: shallow (under 4% of the width) is flat only if the depth is under 3 walls; a shallow dome or open surface is molded.
    // B159: inch: an auto-scaled inch file is shown in inches first, like an inch DXF or STEP (B57/B66).
    if (c <= Math.max(wall * 1.5, 0.5) || c < 0.04 * b && c <= 3 * wall) return { kind: 'panel', L: a, W: b, T: c, units: U, inch: s > 1, ...plateEdges(t, ax, c / s, s) };
    const m2 = oneSide * s * s / 1e6, shape = m2 * 1e6 / (a * b);   // mold-side surface (m²) vs. footprint
    // B125, in file units. The gap is capped at half the depth: an open surface can give a made-up wall (B104), and a wall
    // over a quarter of the depth is already "closed or solid" on the page.
    const wrap = wrapFrac(t, ax, lo, hi, Math.max(Math.min(3 * wall / s, 0.5 * ext[ax]), 0.15 * ext[ax]), !open);
    return { kind: 'molded', L: a, W: b, H: c, wall, m2, complex: shape > 2.5 || wrap > 0.35, units: U, inch: s > 1 };
  }

  // B125: a part that wraps around (a tube, duct or closed box) has skin on both the top and the bottom along the pull
  // direction, so it can't come out of a one-piece open mold. A grid of rays along the depth axis counts the separate
  // skins each ray crosses; the two faces of one solid wall are closer than `gap`, so they count as one. Open trays,
  // covers, domes and canopies give one skin per ray. Returns the share of rays that hit the part and cross 2+ skins.
  // solid (every edge shared): a skin is a stretch inside material, from where the ray goes in to where it comes out
  // (faces facing the other way), and skins must have air between them. So an L-bracket read along its length, which is
  // 40 mm of material in one go, is one skin, not two. An open surface has no inside: each face it crosses is a skin.
  function wrapFrac(t, ax, lo, hi, gap, solid) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3, N = 32, du = (hi[u] - lo[u]) / N, dv = (hi[v] - lo[v]) / N, j = 0.0137;   // j: off the grid lines of square parts
    if (!(du > 0 && dv > 0 && gap > 0)) return 0;
    const hits = Array.from({ length: N * N }, () => []);
    const rng = (a, b, l, d) => [Math.max(0, Math.ceil((a - l) / d - 0.5 - j)), Math.min(N - 1, Math.floor((b - l) / d - 0.5 - j))];
    for (let i = 0; i + 8 < t.length; i += 9) {
      const x0 = t[i + u], y0 = t[i + v], x1 = t[i + 3 + u], y1 = t[i + 3 + v], x2 = t[i + 6 + u], y2 = t[i + 6 + v];
      const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!(Math.abs(d) > 0)) continue;   // edge-on to the rays: a side wall
      const [a0, a1] = rng(Math.min(x0, x1, x2), Math.max(x0, x1, x2), lo[u], du), [b0, b1] = rng(Math.min(y0, y1, y2), Math.max(y0, y1, y2), lo[v], dv);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) {
        const x = lo[u] + (a + 0.5 + j) * du, y = lo[v] + (b + 0.5 + j) * dv;
        const l1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / d, l2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / d;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        hits[a * N + b].push([t[i + ax] + l1 * (t[i + 3 + ax] - t[i + ax]) + l2 * (t[i + 6 + ax] - t[i + ax]), Math.sign(d)]);
      }
    }
    // Two faces at the same height facing opposite ways (a tray exported as outer box minus inner box, both with a
    // bottom at the open rim) cancel out: there's no material there.
    const eps = 1e-4 * (hi[ax] - lo[ax]);
    let hit = 0, two = 0;
    for (const h0 of hits) {
      h0.sort((p, q) => p[0] - q[0]);
      const h = [];
      for (const p of h0) { const k = h.findIndex(o => o[1] === -p[1] && Math.abs(o[0] - p[0]) <= eps); if (k >= 0) h.splice(k, 1); else h.push(p); }
      if (!h.length) continue;
      hit++;
      let n = 0, end = 0, sum = 0, air = false;
      for (const [z, g] of h) { if (!sum) { if (n++ && z - end > gap) air = true; } sum += g; if (!sum) end = z; }
      if (solid && !sum ? air : h.some((z, k) => k && z[0] - h[k - 1][0] > gap)) two++;   // in and out don't match up: count faces
    }
    return hit ? two / hit : 0;
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
