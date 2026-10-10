// Wyspa Build: pricing model for instant budgetary quotes.
// Method (set by Casey 2026-10-10): price = labor hours x $169/hr + materials x 2.
// Hours and material costs are deliberately conservative (rounded up) estimates.
// Edit this file only; index.html reads everything from WYSPA_PRICING.
window.WYSPA_PRICING = {
  currency: "USD",
  rate: 169,                  // $/hr, shop + engineering labor
  materialMult: 2,            // materials and consumables billed at 2x cost
  reviewHours: 2,             // per order: Wyspa engineering review and approval
  minOrder: 350,              // floor on the order total

  // Learning curve: multiplier on LABOR hours only (materials don't get cheaper)
  qtyBreaks: [
    { min: 1, mult: 1.00 },
    { min: 10, mult: 0.92 },
    { min: 50, mult: 0.85 },
    { min: 250, mult: 0.80 },
  ],

  // Raw material cost per m² per ply (fabric + resin), with ply thickness in mm
  plies: {
    carbon:  { label: "Carbon fiber (wet / vacuum)", perM2: 55, t: 0.25 },
    prepreg: { label: "Carbon prepreg (oven cure)",  perM2: 95, t: 0.25 },
    glass:   { label: "Fiberglass (E-glass)",        perM2: 18, t: 0.25 },
    hybrid:  { label: "Carbon/glass hybrid",         perM2: 38, t: 0.25 },
  },
  consumablesPerM2: 20,       // peel ply, bag, breather, release, per m² of part per cure

  // Flat panels: laid up flat, cured, CNC cut
  panel: {
    materials: ["carbon", "prepreg", "glass", "hybrid"],
    core: { label: "Foam/honeycomb core", perM2: 70, hrPerM2: 0.4 },
    finish: {
      matte: { label: "Peel-ply / matte", perM2: 0,  hrPerM2: 0 },
      gloss: { label: "Gloss one side",   perM2: 15, hrPerM2: 0.6 },
      clear: { label: "Clear-coat UV",    perM2: 30, hrPerM2: 1.2 },
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
    mold: { hrBase: 12, hrPerIn: 1.0, matBase: 100, matPerIn: 8 },  // CNC aluminum mold
  },

  // Molded parts: priced from envelope surface area, ply count and complexity
  molded: {
    materials: ["carbon", "prepreg", "glass", "hybrid"],
    complexity: {
      simple:  { label: "Simple: open, shallow, no undercuts",   labor: 1.0, tool: 1.0 },
      medium:  { label: "Medium: curved, flanges, inserts",      labor: 1.6, tool: 1.7 },
      complex: { label: "Complex: closed/split mold, undercuts", labor: 2.6, tool: 2.8 },
    },
    hrPerPart: 1.0, trimHours: 0.5,        // prep/demold and trim per part
    hrPerM2: 0.5, hrPerM2Ply: 0.12,        // layup per m² of surface, plus per ply
    tool: { hrMin: 16, hrPerM2: 30, matPerM2: 250 },  // plug + mold
  },

  // Lead time in working days by order type (before any shipping)
  leadDays: { panel: [10, 15], rotor: [15, 20], rotorNewMold: [25, 35], molded: [20, 30], moldedNewMold: [35, 50] },
};
