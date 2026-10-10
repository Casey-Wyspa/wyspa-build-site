// Wyspa Build: pricing model for instant budgetary quotes.
// Every number here is a PLACEHOLDER until Casey and partner builders confirm rates.
// Edit this file only; index.html reads everything from WYSPA_PRICING.
window.WYSPA_PRICING = {
  currency: "USD",
  margin: 0.25,               // applied on top of builder cost
  engineeringReview: 250,     // flat fee per order: Wyspa checks laminate, drawings, manufacturability
  minOrder: 150,              // floor on the order total

  // Quantity breaks on unit price (qty >= min → multiplier)
  qtyBreaks: [
    { min: 1, mult: 1.00 },
    { min: 10, mult: 0.90 },
    { min: 50, mult: 0.80 },
    { min: 250, mult: 0.70 },
  ],

  // Flat panels: material + layup cost per m² per mm of thickness, plus CNC cutting
  panel: {
    materials: {
      carbon: { label: "Carbon fiber (twill/UD)", perM2mm: 210 },
      glass:  { label: "Fiberglass (E-glass)",   perM2mm: 70 },
      hybrid: { label: "Carbon/glass hybrid",    perM2mm: 140 },
    },
    cored: { label: "Foam/honeycomb core", perM2: 120 },   // added when sandwich
    finish: {
      matte:  { label: "Peel-ply / matte", perM2: 0 },
      gloss:  { label: "Gloss one side",   perM2: 60 },
      clear:  { label: "Clear-coat UV",    perM2: 110 },
    },
    cutPerM: 6,               // CNC routing per meter of perimeter
    holePrice: 0.6,           // per drilled/routed hole or cut-out
    setup: 120,               // per order: program + fixture
    maxSize: [2400, 1200],    // mm, largest sheet partner builders press
  },

  // Rotors / propellers: unit cost grows with disc area; custom molds are NRE
  rotor: {
    materials: {
      carbon:  { label: "Carbon fiber",              base: 18, perIn2: 0.08 },
      cfnylon: { label: "Carbon-filled nylon (molded)", base: 6,  perIn2: 0.025 },
    },
    bladeMult: { 2: 1.0, 3: 1.35, 4: 1.7 },
    balance: 8,               // per rotor: dynamic balancing + inspection
    moldNRE: { base: 1800, perIn: 120 },  // custom geometry tooling, per diameter inch
  },

  // Molded parts: priced from envelope surface area, ply count and complexity
  molded: {
    materials: {
      carbon: { label: "Carbon fiber (wet/vac)",   perM2ply: 95 },
      prepreg: { label: "Carbon prepreg (oven)",   perM2ply: 160 },
      glass:  { label: "Fiberglass",              perM2ply: 35 },
    },
    complexity: {
      simple:  { label: "Simple: open, shallow, no undercuts", labor: 1.0, tool: 1.0 },
      medium:  { label: "Medium: curved, flanges, inserts",    labor: 1.6, tool: 1.7 },
      complex: { label: "Complex: closed/split mold, undercuts", labor: 2.6, tool: 2.8 },
    },
    laborPerM2: 260,          // layup, bagging, trim per m² of part surface
    toolPerM2: 2200,          // plug + mold NRE per m² of part surface
    toolMin: 900,
    customerTooling: 0.0,     // multiplier on tooling when customer supplies the mold
  },

  // Lead time in working days by order type (before any shipping)
  leadDays: { panel: [7, 12], rotor: [10, 15], rotorNewMold: [20, 30], molded: [15, 25], moldedNewMold: [30, 45] },
};
