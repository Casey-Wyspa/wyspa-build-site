// Wyspa Build: pricing model for instant budgetary quotes.
// Method (set by Casey 2026-10-10): price = labor hours x $169/hr + materials x 2.
// Hours and material costs are deliberately conservative (rounded up) estimates.
// Edit this file only; index.html reads everything from WYSPA_PRICING.
window.WYSPA_PRICING = {
  currency: "USD",
  rate: 169,                  // $/hr, shop + design labor
  materialMult: 2,            // materials and consumables billed at 2x cost
  reviewHours: 2,             // per order: Wyspa part check and approval
  uploadUrl: "https://script.google.com/macros/s/AKfycbxhM3gdUmvr6sD52QXUTkzJY2zbjkdK3MWFhvEw-DMHVpwpJ4J8L_DJ-WB7ErAXgsmRHg/exec",              // Apps Script web app URL for file uploads (upload-script/Code.gs); empty = email only
  checkoutEnabled: true,      // "Order and pay by card" button (Square link made by upload-script/Code.gs, live @3, tested 10-15)
  minOrder: 1500,             // floor on the order total (set by Casey 2026-10-10)

  // Learning curve: multiplier on LABOR hours only (materials don't get cheaper)
  qtyBreaks: [
    { min: 1, mult: 1.00 },
    { min: 10, mult: 0.92 },
    { min: 50, mult: 0.85 },
    { min: 250, mult: 0.80 },
  ],
  qtyCurve: "loglinear",      // B178 (2026-10-15): between two breaks the multiplier follows a straight line on log(qty) (a Wright learning curve per segment), flat past the last break. Breaks unchanged; delete this line to go back to steps. build_work/research/pricing/b178-qty-curve-2026-10-15.md

  // Raw material cost per m² per ply (fabric + resin), cured ply thickness t in mm, fabric gsm per mm of cured laminate.
  // 2026-10-10: Fibre Glast list prices + epoxy at $39.81/kg (2026-10-15: resin bought = fabric weight, was cured resin x1.5); t from Wyspa laminate engine
  // (Vf 0.50 carbon, 0.45 glass, 0.55 prepreg). Sources: build_work/research/material-costs.md
  // 2026-10-13: cutting scrap x1.2 -> x1.3 (Wyspa's own cost model); prepreg from ACP list (Fibre Glast was the high outlier)
  // density: cured laminate g/cm³, for part weight (laminate engine: carbon fiber 1.80, E-glass 2.54, epoxy 1.08, prepreg resin 1.10 g/cm³ at the Vf above;
  //   checks: 2 mm carbon 2.88 kg/m², 2.1 mm glass 3.65 kg/m², 1.94 mm hybrid 3.11 kg/m²; research/pricing/laminate-calibration.md)
  // fab: the fabric part of perM2 (list price x1.3 scrap; the rest is resin, not discounted).
  // vol: fabric volume prices, [m² of this fabric in the whole order (net, before scrap), price factor]. The order pays the cheapest option,
  //   buying up to a break if that costs less, so a bigger order never pays more for fabric. Breaks = supplier yardage / 1.3 scrap
  //   (10 yd = 9 m², 50 yd = 45 m², 100 yd = 90 m²). 2026-10-13 cycle 22, sources in build_work/research/material-costs.md.
  plies: {
    carbon:  { label: "Carbon fiber",   gsm: 200, t: 0.22, gsmPerMm: 900,  perM2: 71, density: 1.44,      // 3K 2x2 twill. 2026-10-15: resin bought = fabric weight (bagged wet layup: Gougeon Epoxyworks mixes 1.22 kg/kg; Fibre Glast "in excess of 100%"), was cured resin x1.5
               fab: 62.8, vol: [[45, 0.82]],                  // Fibre Glast $56.18/yd (10 yd cut) -> Rock West 50 yd roll $45.96/yd
               bulk: { gsm: 670, t: 0.75, perM2mm: 168,       // heavy 12K twill for the inside of thick laminates, $ per m² per mm
                       fabPerMm: 132, vol: [[45, 0.70]] } },  // Fibre Glast $88/yd (10 yd cut) -> Rock West 50 yd roll $60.68/yd
    prepreg: { label: "Carbon (prepreg)", gsm: 200, t: 0.20, gsmPerMm: 1000, perM2: 137, density: 1.49,      // 3K twill prepreg, ACP $122/yd list x1.3 scrap
               fab: 136.6, vol: [[4.5, 0.90], [9, 0.80], [45, 0.75]] },  // ACP 5-9 yd $109.80, 10-49 yd $97.60, 50+ yd $91.50
    glass:   { label: "Fiberglass",     gsm: 300, t: 0.26, gsmPerMm: 1140, perM2: 30, density: 1.74,       // 7781 E-glass
               fab: 17.7, vol: [[9, 0.87], [90, 0.83]],       // Fibre Glast $15.86/yd -> Aircraft Spruce $13.65/yd; Rock West 100 yd roll $13.09/yd
               cureGsm: 4500,                                 // glass wet layup per cure (~4 mm): West System lays full skins in one cure; Scott Bader 3 mm/operation polyester scaled to epoxy ~5 mm, x0.8 (judgment)
               layHrPerM2Ply: 0.6 },                          // molded wet layup per m² per ply (glass only): timed hand lay-up 0.35 flat incl. cutting, ~0.56 on shaped tools (Skramstad, MSU 1999); x1.7 for a curved mold (judgment). build_work/research/pricing/molded-wetlayup-2026-10-13.md
    hybrid:  { label: "Carbon + glass", gsm: 250, t: 0.24, gsmPerMm: 1040, perM2: 51, density: 1.60,       // average of one carbon + one 7781 ply
               mix: ["carbon", "glass"] },                    // half the area on each fabric's volume prices
  },
  consumablesPerM2: 20,       // peel ply, bag, breather, release, per m² of part per cure: the floor
  consumablesPerHour: 15,     // shop supplies per part labor hour (abrasives, tape, gloves, solvent; bag film billed separately), 2025 shop invoice, actual. On panel cut/drill hours it also stands for cutter and drill wear: $1.35/m and $0.30/hole vs sourced $1.6-5.3/m and $0.09-0.15/hole. The larger of this and consumablesPerM2 is used

  // Flat panels: laid up flat, cured, CNC cut
  panel: {
    materials: ["carbon", "prepreg", "glass", "hybrid"],
    // Foam core is bought as stock sheets: [sheet mm, $ per m² of part]. H80 foam 48 x 96 in list price x 1.3 scrap, rounded up (dealer list prices checked 2026-10-15).
    // A core is charged as the first sheet at least as thick; over 31.75 mm, the cheapest two sheets plus one bond line (bondM2). Thinnest stock is 1/8 in (3.2 mm).
    // H80 foam 80 kg/m³ plus about 0.3 kg/m² bond resin (laminate engine); weight uses the core thickness itself.
    core: { label: "Foam core", stock: [[3.175, 36], [6.35, 54], [9.525, 77], [12.7, 95], [15.875, 110], [19.05, 133], [25.4, 165], [31.75, 201]], bondM2: 12,
            hrPerM2: 0.4, minT: 3, density: 80, bondKgM2: 0.3,
            seal: { hrPerM: 0.04, hrPerPart: 0.05, usdPerM2Edge: 129 },   // cut foam edges filled and sanded flush: aPriori paste 0.1 m/s + NREL hand trim 30 m/h + 3 min handling; 3 mm fill x 1.08 g/cm³ x $39.81/kg. research/pricing/core-edges-inserts-2026-10-16.md
            pot:  { hr: 0.05, hrPart: 0.05, usdPerMm: 0.22 },   // c52: per filled hole + once per part with holes (one mix, tape, clean-up). Steps: core-out 20 s (Compass Marine marinehowto.com/?p=11571 "10-20 seconds, per hole") + fill 40 s (aPriori) + top-off/flush ~60 s; SECAM: conventional potted NAS insert 2 min incl. drilling (vendor claim). Was 0.15 h/hole (Dzus US3964531, 10 min per metal insert, one at a time). Resin: aPriori 80 mm potted cylinder x core mm, epoxy $39.81/kg. research/pricing/potted-hole-time-2026-10-16.md
          },
    finish: {
      matte: { label: "Matte", perM2: 0,  hrPerM2: 0 },
      gloss: { label: "Gloss one side",   perM2: 15, hrPerM2: 0.6 },
      clear: { label: "Clear coat",    perM2: 30, hrPerM2: 1.2 },
    },
    plyTolMm: 0.1,            // B1 2026-10-15: built carbon stack (3K/12K mix) within this of the typed thickness, else the nearest; panel-properties.md
    hrPerM2Ply: 0.042,        // layup per m² per ply: NREL flat shear-web rate, 24 m²/h/person (blade cost model, WISDEM blade_cost.py). Was 0.08 until 2026-10-13
    bagHrPerM2: 0.36,         // per m² of sheet, one cure: tool prep, peel ply, breather, bag, pull, debag (same NREL model). build_work/research/pricing/panel-bag-and-cures-2026-10-13.md
    hrPerPart: 0.1,           // per cut part: lift off, tabs/edges by hand, check, bag. Sourced 2.5-6 min (Boothroyd handling, ARKU + Sawmill Creek deburr, WOODWEB sheet change); 0.1 = top of range. Was 0.2 (judgment) until 2026-10-15. build_work/research/pricing/small-flat-hours-2026-10-15.md
    hrPerMCut: 0.09,          // per meter of cut edge: CNC rough + finish pass 0.052 h/m (Amana CFRP chart, 1/4 in bit 23 + 28 in/min, one pass to 6.35 mm)
                              //   + hand edge trim/deburr 0.033 h/m (NREL blade cost model, shear-web trim 30 m/h/person); build_work/research/pricing/panel-hours-2026-10-13.md
    hrPerHole: 0.02,
    setupHours: 1.5,          // once per order: file check, CAM, vacuum table + zero (holes-setup-2026-10-15.md)
    setupExtraHours: 0.5,     // each further flat item in the order: its toolpath + its own sheet zero and first-part check (setup-per-order-2026-10-16.md)
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
    wallUnder: 0.05,   // B196 (2026-10-15): wall = nearest whole plies, but never more than 5% under the typed wall (then one more ply). Was: always rounded up. research/pricing/b196-molded-ply-rounding-2026-10-15.md
    complexity: {
      simple:  { label: "Open, depth up to half the width",   labor: 1.0, tool: 1.0 },
      medium:  { label: "Deep, or has flanges or inserts",    labor: 1.6, tool: 1.7 },
      complex: { label: "Closed or hollow (custom quote)",  labor: 2.6, tool: 2.8 },
    },
    setupHours: 3,                         // per new mold (each new-mold item): ply templates, trim fixture, first-part check
    hrPerPart: 2.0, trimHours: 2.0,        // per part: mold prep, bag and cure; trim, sand and drill
    fixedFullM2: 0.12, fixedMinScale: 0.4, // B90: under 0.12 m² of surface, the per-part and per-extra-cure hours scale with sqrt(area / 0.12) (edge to trim and bag), never under 0.4x (1.6 h). Full 4 h at 0.12 m² and up (D-spigot 0.12 m², foil-wing skin 0.23 m²). research/pricing/b90-small-molded-2026-10-13.md. Since c40 this applies to trimHours only.
    prepFullM2: 0.234,                     // c40: hrPerPart (mold prep, bag, demold) and hrPerCure scale with sqrt(area / 0.234), same 0.4 floor: S8 (foil-wing skin, 0.234 m²) is the job that timed mold prep; S11 (0.12 m²) timed finishing only. research/pricing/small-molded-cover-2026-10-15.md
    hrPerM2: 1.0, hrPerM2Ply: 1.3,         // layup per m² of surface, plus per ply (carbon, prepreg, carbon+glass: X2; glass uses plies.glass.layHrPerM2Ply)
    wetGsmPerCure: 4000,                   // carbon and carbon+glass wet layup in a mold: about 4,000 gsm of dry fabric per cure (20 plies, ~4.4 mm; same resin mass per cure as glass cureGsm; West System, Gurit, PRO-SET, Scott Bader). Was 1,200 from an on-aircraft joint repair spec (B108). Glass uses its own cureGsm. Prepreg: one cure
    hrPerCure: 1.0,                        // each extra cure: re-bag and cure setup (half of hrPerPart), plus hrPerM2 x surface to sand, peel ply and bag again
    tool: { hrMin: 18, hrMinPerM2: 16, hrPerM2: 30, matPerM2: 250,   // plug + mold; hrMin counted once, the shape's tool factor scales only the area hours (B42, 2026-10-12)
            // c43: the floor rises 16 h/m² (18 + 16 x area, or 30 x area if higher): X2 plug rule $5,000 + $2,045/m² scaled to 18 h; D-spigot 18 h at 0.12 m², foil-wing mold ~$4,150 at 0.47 m². research/pricing/mold-size-2026-10-15.md
            matPerM2Prepreg: 2476 },   // prepreg cures hot, so its mold is a heat-proof carbon tooling laminate: Wyspa job cost model, mold material = 2x part material = $2,476 per m² of part
                                       // (cross-check: 16 plies x $137/m²/ply list prepreg = $2,192). Wet, glass and hybrid keep $250 (room-temperature mold vendor quote). 2026-10-14
    copies: { max: 4, maxM2: 0.12, hrMin: 3, daysRepeat: 5 },   // B138: parts up to 0.12 m² may use up to 4 molds off one plug, only when one mold would put the ready date past review.maxLeadDays (fewest molds that fit; else review as before). Each extra mold max(3 h, area hours) + one mold's material (past job data: 3.4 h per small mold; 3 h per tool piece); repeat orders add 5 days to make the copies. research/pricing/b138-small-molded-capacity-2026-10-14.md
  },

  // Anything past these limits gets no instant price; it goes to engineer review instead
  review: {
    panelMaxT: 25,            // mm, solid panels
    panelCoreMaxT: 40,        // mm, foam-core panels (1 in core + skins); research/pricing/cored-limit-proposal-2026-10-12.md
    rotorMaxD: 32,            // in. QUEST A1 (2026-10-15): 2-blade up to 32 in only, until Wyspa has built and tested a rotor; research/rotors/program.md decision 6
    rotorMaxBlades: 2,        // 3- and 4-blade: priced by hand (A1)
    rotorUnitsD: 40,          // in: a bare number over this asks "is it in mm?" (B62)
    moldedMaxDim: 1500,       // mm, longest side
    moldedMaxDepth: 400,      // mm
    moldedMaxDepthRatio: 1.0, // depth over the shorter side; deeper parts need a split mold (closed-tool evidence, 2026-10-13)
    moldedTubeRatio: 20, moldedTubeDepth: 0.75,   // B157: length over 20x the width with depth at least 0.75x the width is a tube or rod (closed mold, mandrel or stock tube): priced by hand
    maxPlies: 20,
    moldedHrPerKg: [3, 12],   // molded labor hours per kg of part outside this goes to engineer review. Big-part aerospace plan: 4.1-6.2 h/kg (wing 6.4-9.6)
    moldedHrPerKgGlass: [1.5, 12],  // glass wet layup runs ~2-3.5 h/kg at the glass layup rate; a timed flat glass part took ~0.6 h/kg (Skramstad 1999). Judgment floor
    moldedHrPerKgMinKg: 2,   // only parts of at least this weight: below it the fixed prep/trim hours dominate (a real 0.5 kg skin took 13.5 h/kg)
    moldedSmallKg: 0.2, moldedSmallGsm: 2400,   // molded part under 0.2 kg with more than 2,400 gsm of fabric (thick for its size): a shop would press-mold or machine it (2026-10-13)
    panelMaxSolidT: 10,       // mm, solid laminate (cure heat, voids, press size)
    minSkin: 0.4,             // mm, cored panel skin (2 plies)
    maxCoreToSkin: 50,        // core thickness / skin thickness (dents, inserts, edge crush)
    maxLeadDays: 60,          // B116: ready date past 60 working days (high end) -> engineer plans it; longest Drive lead ~65 days (research/pricing/lead-time-2026-10-14.md)
  },

  // Lead time in working days by order type (before any shipping)
  leadDays: { panel: [10, 15], rotor: [15, 20], rotorNewMold: [25, 35], molded: [20, 30], moldedNewMold: [35, 50] },
  // B116 (2026-10-14): extra days for big orders. base ranges already hold 5 days of work (D-spigot job);
  // one mold: 1 cure/day molded, 2 press cycles/day rotor (judgment, wet-layup working time + cure). research/pricing/lead-time-2026-10-14.md
  // c61 (2026-10-17): 16 shop h/day = 2 people x 8 h (was 8, from a budget "shop day $680" line, not a pace). Still under the only shop actual:
  // CJR invoice 1165, 481.5 h in ~5 weeks with 2-3 people = ~19 h/day (research/pricing/x2-reference.md 3.1). Dates only; prices unchanged.
  // research/pricing/qty30-hatch-capacity-2026-10-17.md
  leadQty: { hrPerDay: 16, daysInBase: 5, cyclesPerDay: { rotor: 2, molded: 1 } },
};
