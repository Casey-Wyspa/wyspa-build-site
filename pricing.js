// Wyspa Build: pricing model for instant budgetary quotes.
// Method (set by Casey 2026-10-10): price = labor hours x $169/hr + materials x 2.
// Hours and material costs are deliberately conservative (rounded up) estimates.
// Edit this file only; index.html reads everything from WYSPA_PRICING.
window.WYSPA_PRICING = {
  currency: "USD",
  rate: 169,                  // $/hr, shop + engineering labor
  materialMult: 2,            // materials and consumables billed at 2x cost
  reviewHours: 2,             // per order: Wyspa engineering review and approval
  uploadUrl: "https://script.google.com/macros/s/AKfycbxhM3gdUmvr6sD52QXUTkzJY2zbjkdK3MWFhvEw-DMHVpwpJ4J8L_DJ-WB7ErAXgsmRHg/exec",              // Apps Script web app URL for file uploads (upload-script/Code.gs); empty = email only
  minOrder: 1500,             // floor on the order total (set by Casey 2026-10-10)

  // Learning curve: multiplier on LABOR hours only (materials don't get cheaper)
  qtyBreaks: [
    { min: 1, mult: 1.00 },
    { min: 10, mult: 0.92 },
    { min: 50, mult: 0.85 },
    { min: 250, mult: 0.80 },
  ],

  // Raw material cost per m² per ply (fabric + resin), cured ply thickness t in mm, fabric gsm per mm of cured laminate.
  // 2026-10-10: Fibre Glast list prices + epoxy at $39.81/kg x1.5 waste; t from Wyspa laminate engine
  // (Vf 0.50 carbon, 0.45 glass, 0.55 prepreg). Sources: build_work/research/material-costs.md
  // 2026-10-13: cutting scrap x1.2 -> x1.3 (Wyspa's own cost model); prepreg from ACP list (Fibre Glast was the high outlier)
  // density: cured laminate g/cm³, for part weight (laminate engine: carbon fiber 1.80, E-glass 2.54, epoxy 1.08, prepreg resin 1.10 g/cm³ at the Vf above;
  //   checks: 2 mm carbon 2.88 kg/m², 2.1 mm glass 3.65 kg/m², 1.94 mm hybrid 3.11 kg/m²; research/pricing/laminate-calibration.md)
  // fab: the fabric part of perM2 (list price x1.3 scrap; the rest is resin, not discounted).
  // vol: fabric volume prices, [m² of this fabric in the whole order (net, before scrap), price factor]. The order pays the cheapest option,
  //   buying up to a break if that costs less, so a bigger order never pays more for fabric. Breaks = supplier yardage / 1.3 scrap
  //   (10 yd = 9 m², 50 yd = 45 m², 100 yd = 90 m²). 2026-10-13 cycle 22, sources in build_work/research/material-costs.md.
  plies: {
    carbon:  { label: "Carbon fiber",   gsm: 200, t: 0.22, gsmPerMm: 900,  perM2: 70, density: 1.44,      // 3K 2x2 twill
               fab: 62.8, vol: [[45, 0.82]],                  // Fibre Glast $56.18/yd (10 yd cut) -> Rock West 50 yd roll $45.96/yd
               bulk: { gsm: 670, t: 0.75, perM2mm: 165,       // heavy 12K twill for the inside of thick laminates, $ per m² per mm
                       fabPerMm: 132, vol: [[45, 0.70]] } },  // Fibre Glast $88/yd (10 yd cut) -> Rock West 50 yd roll $60.68/yd
    prepreg: { label: "Carbon (prepreg)", gsm: 200, t: 0.20, gsmPerMm: 1000, perM2: 137, density: 1.49,      // 3K twill prepreg, ACP $122/yd list x1.3 scrap
               fab: 136.6, vol: [[4.5, 0.90], [9, 0.80], [45, 0.75]] },  // ACP 5-9 yd $109.80, 10-49 yd $97.60, 50+ yd $91.50
    glass:   { label: "Fiberglass",     gsm: 300, t: 0.26, gsmPerMm: 1140, perM2: 28, density: 1.74,       // 7781 E-glass
               fab: 17.7, vol: [[9, 0.87], [90, 0.83]] },     // Fibre Glast $15.86/yd -> Aircraft Spruce $13.65/yd; Rock West 100 yd roll $13.09/yd
    hybrid:  { label: "Carbon + glass", gsm: 250, t: 0.24, gsmPerMm: 1040, perM2: 49, density: 1.60,       // average of one carbon + one 7781 ply
               mix: ["carbon", "glass"] },                    // half the area on each fabric's volume prices
  },
  consumablesPerM2: 20,       // peel ply, bag, breather, release, per m² of part per cure: the floor
  consumablesPerHour: 15,     // consumables per part labor hour, as a composite shop billed them (2025 invoice, actual); the larger of the two is used

  // Flat panels: laid up flat, cured, CNC cut
  panel: {
    materials: ["carbon", "prepreg", "glass", "hybrid"],
    core: { label: "Foam core", perM2mm: 7, hrPerM2: 0.4, minT: 3, density: 80, bondKgM2: 0.3 },  // core $ per m² per mm; thinnest stock foam is 1/8 in (3.2 mm); H80 foam 80 kg/m³ plus about 0.3 kg/m² bond resin (laminate engine)
    finish: {
      matte: { label: "Matte", perM2: 0,  hrPerM2: 0 },
      gloss: { label: "Gloss one side",   perM2: 15, hrPerM2: 0.6 },
      clear: { label: "Clear coat",    perM2: 30, hrPerM2: 1.2 },
    },
    hrPerM2Ply: 0.08,         // layup per m² per ply
    hrPerPart: 0.2,           // demold, inspect, handle
    hrPerMCut: 0.06,          // CNC routing per meter of perimeter
    hrPerHole: 0.02,
    setupHours: 1.5,          // per order: CNC program + fixture
    maxSize: [2400, 1200],    // mm, largest sheet partner builders press
  },

  // Rotors / propellers: molded in a matched metal mold
  rotor: {
    materials: ["carbon", "prepreg"],
    matBase: 4, matPerIn2: 0.035,          // raw material $ = base + k * D² (D in inches)
    hrBase: 1.0, hrPerIn: 0.04,            // layup, press, demold, trim per rotor
    bladeMult: { 2: 1.0, 3: 1.4, 4: 1.8 },
    balanceHours: 0.25,                    // dynamic balance + inspection, per rotor
    kgPerIn2: 0.00012,                     // weight = k x D² x blade factor = the laminate in matPerIn2 less 30% scrap. 15 in 2-blade: 27 g (T-Motor 15x5 carbon: 21-27.5 g)
    mold: { hrBase: 12, hrPerIn: 1.0, matBase: 100, matPerIn: 8 },  // CNC aluminum mold
  },

  // Molded parts: priced from envelope surface area, ply count and complexity
  molded: {
    materials: ["carbon", "prepreg", "glass", "hybrid"],
    complexity: {
      simple:  { label: "Open, depth under half the width",   labor: 1.0, tool: 1.0 },
      medium:  { label: "Deep, or has flanges or inserts",    labor: 1.6, tool: 1.7 },
      complex: { label: "Closed or hollow (engineer quote)",  labor: 2.6, tool: 2.8 },
    },
    setupHours: 3,                         // new-mold orders: ply templates, trim fixture, first-part check
    hrPerPart: 2.0, trimHours: 2.0,        // per part: mold prep, bag and cure; trim, sand and drill
    hrPerM2: 1.0, hrPerM2Ply: 1.3,         // layup per m² of surface, plus per ply
    wetGsmPerCure: 1200,                   // wet layup: at most about 1,200 gsm of dry fabric per cure (3 plies of 400 gsm, a 2025 aircraft repair spec). Prepreg: one cure
    hrPerCure: 1.0,                        // each extra cure: re-bag and cure setup (half of hrPerPart), plus hrPerM2 x surface to sand, peel ply and bag again
    tool: { hrMin: 18, hrPerM2: 30, matPerM2: 250 },  // plug + mold; hrMin counted once, the shape's tool factor scales only the area hours (B42, 2026-10-12)
  },

  // Anything past these limits gets no instant price; it goes to engineer review instead
  review: {
    panelMaxT: 25,            // mm, solid panels
    panelCoreMaxT: 40,        // mm, foam-core panels (1 in core + skins); research/pricing/cored-limit-proposal-2026-10-12.md
    rotorMaxD: 40,            // in
    rotorMaxBlades: 3,
    moldedMaxDim: 1500,       // mm, longest side
    moldedMaxDepth: 400,      // mm
    moldedMaxDepthRatio: 1.0, // depth over the shorter side; deeper parts need a split mold (closed-tool evidence, 2026-10-13)
    maxPlies: 20,
    moldedHrPerKg: [3, 12],   // molded labor hours per kg of part outside this goes to engineer review. Big-part aerospace plan: 4.1-6.2 h/kg (wing 6.4-9.6)
    moldedHrPerKgMinKg: 2,    // only parts of at least this weight: below it the fixed prep/trim hours dominate (a real 0.5 kg skin took 13.5 h/kg)
    moldedSmallKg: 0.2, moldedSmallGsm: 2400,   // molded part under 0.2 kg with more than 2,400 gsm of fabric (over 2 wet cures): a shop would press-mold or machine it (2026-10-13)
    panelMaxSolidT: 10,       // mm, solid laminate (cure heat, voids, press size)
    minSkin: 0.4,             // mm, cored panel skin (2 plies)
    maxCoreToSkin: 50,        // core thickness / skin thickness (dents, inserts, edge crush)
  },

  // Lead time in working days by order type (before any shipping)
  leadDays: { panel: [10, 15], rotor: [15, 20], rotorNewMold: [25, 35], molded: [20, 30], moldedNewMold: [35, 50] },
};
