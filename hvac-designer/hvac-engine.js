/*
 * מנוע חישוב ובחירת מערכת מיזוג אוויר – מותאם לתנאי האקלים והשוק בישראל
 * HVAC load estimation & system-selection engine (Israel)
 *
 * שיטה: חישוב עומסים מקורב (שיטת "בלוק" לפי מעטפת, אנשים, תאורה, ציוד,
 * אוויר צח וחדירות) ובחירת מערכת לפי כללי תכנון מקובלים בשוק הישראלי.
 * מתאים לתכנון ראשוני / היתכנות. אינו מחליף חישוב עומסים מפורט
 * (ASHRAE RTS / HAP / TRACE) ותכנון מהנדס מוסמך.
 *
 * Works in the browser (window.HVAC) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVAC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KW_TO_BTU = 3412.14;
  const KW_PER_TR = 3.517;
  const M3H_PER_KW = 193; // ~400 CFM לטון קירור
  const INDOOR = { tSummer: 24, hSummer: 48, tWinter: 21 }; // 24°C/50% → h≈48 kJ/kg

  /* ---------- אזורי אקלים (תנאי תכן מקורבים, ~0.4%-1% קיץ / 99% חורף) ---------- */
  const REGIONS = {
    coastal:  { name: 'מישור החוף (ת"א, חיפה, אשדוד, נתניה)', tSummer: 33, wbSummer: 26, hOut: 81, tWinter: 6,  eflh: 950,  humid: true },
    inland:   { name: 'שפלה ופנים הארץ (מודיעין, רחובות, עפולה)', tSummer: 35, wbSummer: 25, hOut: 76, tWinter: 4,  eflh: 1050, humid: false },
    mountain: { name: 'אזור ההר (ירושלים, צפת, גוש עציון)',   tSummer: 32, wbSummer: 21, hOut: 62, tWinter: 1,  eflh: 550,  humid: false },
    negev:    { name: 'צפון הנגב (באר שבע, דימונה, ערד)',       tSummer: 37, wbSummer: 22, hOut: 65, tWinter: 3,  eflh: 1200, humid: false },
    valley:   { name: 'בקעת הירדן, בית שאן, הכנרת',            tSummer: 41, wbSummer: 26, hOut: 81, tWinter: 6,  eflh: 1650, humid: true },
    arava:    { name: 'הערבה ואילת',                            tSummer: 43, wbSummer: 23, hOut: 69, tWinter: 9,  eflh: 2050, humid: false },
  };

  /* ---------- סוגי מבנים: צפיפות ועומסים פנימיים ---------- */
  // occ: מ"ר לאדם | pS/pL: חום מוחשי/כמוס לאדם [W] | light, equip: W/m²
  // oaP: ל'/ש' לאדם | oaA: ל'/ש' למ"ר (ASHRAE 62.1) | ach: חדירות [החלפות/שעה]
  // div: מקדם בו-זמניות למערכת מרכזית (ביחס לעומס המבנה המצטבר) | use: מקדם שעות הפעלה | extWall: חלק הקירות החיצוניים
  const BUILDING_TYPES = {
    apartment:  { name: 'דירת מגורים',              group: 'res', occ: 15,  pS: 70,  pL: 45,  light: 6,  equip: 12,  oaP: 0,   oaA: 0,   ach: 0.6, div: 0.90, use: 1.0, extWall: 0.6, roof: false },
    house:      { name: 'בית פרטי / וילה',           group: 'res', occ: 20,  pS: 70,  pL: 45,  light: 6,  equip: 12,  oaP: 0,   oaA: 0,   ach: 0.7, div: 0.90, use: 1.0, extWall: 1.0, roof: true },
    office:     { name: 'משרדים',                   group: 'com', occ: 10,  pS: 75,  pL: 55,  light: 9,  equip: 15,  oaP: 2.5, oaA: 0.3, ach: 0.3, div: 0.95, use: 1.2, extWall: 1.0, roof: true },
    retail:     { name: 'מסחר / חנויות / אולם תצוגה', group: 'com', occ: 6,   pS: 75,  pL: 55,  light: 16, equip: 6,   oaP: 3.8, oaA: 0.6, ach: 0.6, div: 0.90, use: 1.5, extWall: 1.0, roof: true },
    restaurant: { name: 'מסעדה / קפה',               group: 'com', occ: 2.5, pS: 75,  pL: 75,  light: 12, equip: 35,  oaP: 3.8, oaA: 0.9, ach: 0.6, div: 0.90, use: 1.4, extWall: 1.0, roof: true },
    education:  { name: 'חינוך / כיתות / אולמות',      group: 'com', occ: 2.5, pS: 70,  pL: 45,  light: 10, equip: 6,   oaP: 5.0, oaA: 0.6, ach: 0.4, div: 0.90, use: 0.9, extWall: 1.0, roof: true },
    clinic:     { name: 'מרפאה / מעבדה',              group: 'com', occ: 8,   pS: 75,  pL: 55,  light: 12, equip: 20,  oaP: 2.5, oaA: 0.9, ach: 0.3, div: 0.90, use: 1.3, extWall: 1.0, roof: true },
    industrial: { name: 'אולם ייצור / תעשייה',        group: 'ind', occ: 30,  pS: 115, pL: 120, light: 8,  equip: 25,  oaP: 0,   oaA: 0.9, ach: 0.5, div: 0.95, use: 1.8, extWall: 1.0, roof: true },
    warehouse:  { name: 'מחסן / מרכז לוגיסטי',        group: 'ind', occ: 100, pS: 115, pL: 120, light: 6,  equip: 3,   oaP: 0,   oaA: 0.3, ach: 0.3, div: 1.00, use: 1.5, extWall: 1.0, roof: true },
    server:     { name: 'חדר שרתים / תקשורת',          group: 'it',  occ: 200, pS: 75,  pL: 55,  light: 10, equip: 600, oaP: 0,   oaA: 0.1, ach: 0.1, div: 1.00, use: 5.5, extWall: 0.5, roof: false },
  };

  /* ---------- בידוד (לפי רמת עמידה בת"י 1045) ---------- */
  const INSULATION = {
    new:  { name: 'חדש – לפי ת"י 1045 (קיר מבודד, זיגוג כפול)', uWall: 0.6, uRoof: 0.45, uGlass: 2.8, shgc: 0.40 },
    std:  { name: 'בינוני – בנייה משנות ה-90/2000',             uWall: 1.2, uRoof: 0.9,  uGlass: 4.0, shgc: 0.60 },
    poor: { name: 'חלש – ללא בידוד / פח / זיגוג יחיד',           uWall: 2.0, uRoof: 2.5,  uGlass: 5.8, shgc: 0.75 },
  };
  const GLAZING = {
    low:  { name: 'מעט חלונות (~12%)',   wwr: 0.12 },
    med:  { name: 'רגיל (~22%)',          wwr: 0.22 },
    high: { name: 'הרבה זכוכית / קיר מסך (~40%)', wwr: 0.40 },
  };

  /* ---------- קטלוג יחידות מקובלות בשוק הישראלי (תפוקות קירור נומינליות) ---------- */
  // "כ"ס" – הסימון המסחרי המקובל בישראל (לא כוח סוס מכני). ערכים מקורבים.
  const CATALOG = {
    wallSplit: [
      { label: '1 כ"ס',    kw: 2.6 }, { label: '1.25 כ"ס', kw: 3.5 }, { label: '1.5 כ"ס', kw: 4.2 },
      { label: '2 כ"ס',    kw: 5.3 }, { label: '2.5 כ"ס',  kw: 6.6 }, { label: '3 כ"ס',   kw: 7.6 },
    ],
    floorStanding: [ { label: 'מזגן עומד 4 כ"ס', kw: 10.5 }, { label: 'מזגן עומד 5 כ"ס', kw: 13.5 } ],
    miniCentral: [
      { label: 'מיני מרכזי 2.5 כ"ס', kw: 7.0 },  { label: 'מיני מרכזי 3.5 כ"ס', kw: 9.5 },
      { label: 'מיני מרכזי 4 כ"ס',   kw: 10.5 }, { label: 'מיני מרכזי 5 כ"ס',   kw: 13.5 },
      { label: 'מיני מרכזי 6 כ"ס',   kw: 16.0 }, { label: 'מיני מרכזי 7.5 כ"ס', kw: 20.0 },
    ],
    miniVrf: [
      { label: 'Mini-VRF 4HP', kw: 12.1 }, { label: 'Mini-VRF 5HP', kw: 14.0 }, { label: 'Mini-VRF 6HP', kw: 15.5 },
      { label: 'Mini-VRF 8HP', kw: 22.4 }, { label: 'Mini-VRF 10HP', kw: 28.0 }, { label: 'Mini-VRF 12HP', kw: 33.5 },
    ],
    vrfModule: [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32].map(hp => ({ label: 'VRF ' + hp + 'HP', hp, kw: Math.round(hp * 2.8 * 10) / 10 })),
    rooftop: [5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 60].map(tr => ({ label: 'יחידת גג ' + tr + ' TR', tr, kw: Math.round(tr * KW_PER_TR * 10) / 10 })),
  };
  const VRF_SYSTEM_MAX_KW = 3 * 90; // עד ~96HP למערכת (3 מודולים)

  /* ---------- נתוני מערכות: עלות מותקנת מקורבת, יעילות, יתרונות/חסרונות ---------- */
  // cost: ₪ לקו"ט קירור מותקן (טווח מחירים מקורב 2025-2026, כולל התקנה בסיסית) | eer: יעילות עונתית אפקטיבית
  const SYSTEMS = {
    split:       { name: 'מזגנים עיליים (ספליט) בכל חדר', short: 'עיליים',       cost: [1100, 1600], eer: 3.6,
      pros: ['עלות התקנה נמוכה', 'שליטה נפרדת בכל חדר', 'אין צורך בתקרה מונמכת', 'תקלה ביחידה אחת לא משביתה את כל הבית'],
      cons: ['יחידה גלויה בכל חדר', 'הרבה מעבים בחזית / במסתור', 'פיזור אוויר פחות אחיד'] },
    miniCentral: { name: 'מיני מרכזי (מפוצל מתועל)', short: 'מיני מרכזי', cost: [1800, 2600], eer: 3.3,
      pros: ['מראה נקי – רק תריסים', 'מעבה אחד לכל הדירה/אזור', 'פיזור אוויר אחיד', 'הפתרון הנפוץ בדירות חדשות בישראל'],
      cons: ['טמפרטורה אחת לכל החדרים (אלא אם מוסיפים מדפי ויסות / בקר אזורים)', 'דורש תקרה מונמכת ~25-30 ס"מ', 'תקלה משביתה את כל האזור'] },
    miniVrf:     { name: 'Mini-VRF (מעבה אחד, יחידה פנימית לכל חדר)', short: 'Mini-VRF', cost: [2600, 3400], eer: 4.0,
      pros: ['טמפרטורה נפרדת לכל חדר', 'יעילות אנרגטית גבוהה בעומס חלקי', 'מעבה אחד', 'גמישות ביחידות פנימיות (תעלתי/קיר/קסטה)'],
      cons: ['עלות גבוהה', 'דורש מתקין מוסמך VRF ותכנון צנרת', 'חיבור תלת-פאזי בדגמים הגדולים'] },
    vrf:         { name: 'מערכת VRF מרכזית (+יחידות אוויר צח)', short: 'VRF', cost: [2800, 3800], eer: 4.0,
      pros: ['שליטה לכל חלל', 'אפשרות השבת חום (Heat Recovery) – קירור וחימום בו-זמנית', 'מודולרית – הרחבה בשלבים', 'ללא מים/משאבות/חדר מכונות'],
      cons: ['מוגבלת באורכי צנרת ובכמות קרר בחללים קטנים (EN 378)', 'אוויר צח נדרש בנפרד (ERV/DOAS)', 'עלות גבוהה מעל ~400 קו"ט – צ\'ילר משתלם יותר'] },
    rooftop:     { name: 'יחידות גג מאוחדות (Rooftop Package)', short: 'יחידות גג', cost: [1600, 2400], eer: 3.0,
      pros: ['מתאים לחללים פתוחים גדולים', 'אוויר צח וכלכלן (Economizer) מובנים', 'התקנה מהירה, ללא צנרת קרר ארוכה'],
      cons: ['דורש גג נושא ותעלות גדולות', 'שליטה אזורית מוגבלת', 'יעילות נמוכה מ-VRF'] },
    chillerAir:  { name: 'צ\'ילר מקורר אוויר + מפזרי מאוורר (FCU) / מטפלי אוויר (AHU)', short: 'צ\'ילר (אוויר)', cost: [3200, 4800], eer: 2.9,
      pros: ['מתאים למבנים גדולים (מאות קו"ט ומעלה)', 'אין קרר בתוך המבנה – מים בלבד', 'אורך חיים ארוך (20-25 שנה)', 'קל לשלב אוויר צח, סינון ובקרת לחות'],
      cons: ['עלות ראשונית גבוהה', 'נדרש חדר משאבות, צנרת מים ובידוד', 'דורש תחזוקה מקצועית שוטפת'] },
    chillerWater:{ name: 'צ\'ילר מקורר מים + מגדלי קירור + AHU/FCU', short: 'צ\'ילר (מים)', cost: [3600, 5200], eer: 4.3,
      pros: ['היעילות הגבוהה ביותר במבנים גדולים מאוד', 'עלות תפעול נמוכה'],
      cons: ['מגדלי קירור – טיפול מים ומניעת לגיונלה', 'צריכת מים', 'מתאים רק מ-~1,000 קו"ט ומעלה'] },
    evaporative: { name: 'מצנני אוויר אוופורטיביים (מצנני מים)', short: 'אוופורטיבי', cost: [300, 600], eer: 15,
      pros: ['זול מאוד בהתקנה ובתפעול', 'יעיל באקלים יבש (נגב, ערבה, ירושלים)', 'אוורור רב'],
      cons: ['לא מתאים לאקלים לח (מישור החוף, בקעת הירדן)', 'אין שליטה בלחות – לא מתאים למוצרים רגישים', 'צריכת מים וטיפול נגד לגיונלה'] },
    crac:        { name: 'מזגנים מדויקים לחדר שרתים (CRAC / In-Row) בתצורת N+1', short: 'CRAC', cost: [6000, 9000], eer: 3.2,
      pros: ['פעולה 24/7', 'בקרת טמפרטורה ולחות מדויקת', 'יתירות'], cons: ['עלות גבוהה', 'דורש תכנון מעברים חמים/קרים'] },
  };

  const BRANDS = {
    split:       ['תדיראן', 'אלקטרה', 'טורנדו', 'Gree', 'Mitsubishi Electric', 'LG', 'Samsung', 'Toshiba', 'Daikin'],
    miniCentral: ['תדיראן', 'אלקטרה', 'טורנדו', 'Gree', 'LG', 'Mitsubishi Electric', 'Daikin', 'Toshiba'],
    miniVrf:     ['תדיראן (VRF BOX)', 'אלקטרה', 'LG (Multi V S)', 'Samsung (DVM S Eco)', 'Mitsubishi Electric', 'Daikin', 'Toshiba', 'Gree'],
    vrf:         ['תדיראן (TADIRAN VRF PRIME – ייצור בעפולה)', 'אלקטרה', 'Daikin (VRV)', 'Mitsubishi Electric (City Multi)', 'LG (Multi V)', 'Samsung (DVM)', 'Toshiba', 'Hitachi', 'Gree'],
    rooftop:     ['Carrier', 'Trane', 'York', 'Daikin', 'Lennox', 'תדיראן', 'אלקטרה'],
    chillerAir:  ['Carrier', 'Trane', 'York (JCI)', 'Daikin', 'Climaveneta / Mitsubishi', 'אלקטרה', 'תדיראן'],
    chillerWater:['Carrier', 'Trane', 'York (JCI)', 'Daikin'],
    evaporative: ['ייצור מקומי ויבוא – מגוון יצרנים'],
    crac:        ['Vertiv (Liebert)', 'Schneider (Uniflair)', 'Stulz', 'Daikin'],
  };

  /* ---------- עזר ---------- */
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const pickUnit = (list, kw) => list.find(u => u.kw >= kw) || null;

  // פיצול עומס לכמות יחידות מינימלית מתוך קטלוג
  function splitIntoUnits(list, kw) {
    const max = list[list.length - 1].kw;
    const n = Math.max(1, Math.ceil(kw / max));
    const unit = pickUnit(list, kw / n);
    return { count: n, unit, totalKw: round(n * unit.kw) };
  }

  // שילוב מודולי VRF למערכת (עד 3 מודולים)
  function vrfCombination(kw) {
    const mods = CATALOG.vrfModule;
    const single = pickUnit(mods, kw);
    if (single) return [single];
    let best = null;
    for (const a of mods) for (const b of mods) {
      if (b.hp < a.hp) continue;
      const s = a.kw + b.kw;
      if (s >= kw && (!best || s < best.s)) best = { s, set: [a, b] };
    }
    if (best) return best.set;
    for (const a of mods) for (const b of mods) for (const c of mods) {
      if (b.hp < a.hp || c.hp < b.hp) continue;
      const s = a.kw + b.kw + c.kw;
      if (s >= kw && (!best || s < best.s)) best = { s, set: [a, b, c] };
    }
    return best ? best.set : null;
  }

  /* ---------- ברירת מחדל לחלוקת חדרים ---------- */
  function defaultRooms(input) {
    const t = BUILDING_TYPES[input.buildingType];
    const n = Math.max(1, Math.round(input.rooms));
    const A = input.area;
    const rooms = [];
    if (t.group === 'res') {
      // בישראל "מספר חדרים" כולל את הסלון. 4 חדרים = סלון + 3 חדרי שינה.
      if (n === 1) return [{ name: 'סלון / חלל מגורים', area: round(A, 0), kind: 'living' }];
      const living = A * (n <= 3 ? 0.42 : 0.34);
      const rest = (A - living) / (n - 1);
      rooms.push({ name: 'סלון + מטבח + פינת אוכל', area: round(living, 0), kind: 'living' });
      for (let i = 1; i < n; i++) {
        const isMamad = input.mamad && i === n - 1;
        rooms.push({ name: isMamad ? 'ממ"ד (חדר שינה)' : (i === 1 ? 'חדר שינה הורים' : 'חדר שינה ' + i), area: round(rest, 0), kind: isMamad ? 'mamad' : 'bedroom' });
      }
      return rooms;
    }
    if (t.group === 'ind' && n > 1) {
      // אולם עיקרי + משרדים/נלווים
      const office = Math.min(A * 0.15, 40 * (n - 1));
      rooms.push({ name: input.buildingType === 'warehouse' ? 'אולם אחסון' : 'אולם ייצור', area: round(A - office, 0), kind: 'hall' });
      for (let i = 1; i < n; i++) rooms.push({ name: 'משרד / חלל נלווה ' + i, area: round(office / (n - 1), 0), kind: 'office' });
      return rooms;
    }
    for (let i = 0; i < n; i++) rooms.push({ name: 'חלל ' + (i + 1), area: round(A / n, 0), kind: 'zone' });
    return rooms;
  }

  /* ---------- חישוב עומסים ---------- */
  function computeLoads(input) {
    const reg = REGIONS[input.region];
    const t = BUILDING_TYPES[input.buildingType];
    const ins = INSULATION[input.insulation];
    const gl = GLAZING[input.glazing];
    const A = input.area, H = input.height, floors = Math.max(1, input.floors || 1);

    const footprint = A / floors;
    const perimeter = 4 * Math.sqrt(footprint) * 1.15; // מקדם צורה (מבנה לא ריבועי)
    const wallGross = perimeter * H * floors * t.extWall;
    const glassA = wallGross * gl.wwr;
    const wallA = wallGross - glassA;
    const roofExposed = input.roofExposed != null ? input.roofExposed : t.roof;
    const roofA = roofExposed ? footprint : 0;
    const volume = A * H;

    const dT = reg.tSummer - INDOOR.tSummer;
    const dTw = INDOOR.tWinter - reg.tWinter;
    // אולמות גבוהים: חלק מעומס הגג נשאר בשכבה העליונה (ריבוד)
    const stratFactor = H > 6 ? 0.7 : (H > 4 ? 0.85 : 1);

    const W = {}; // Watt
    W.walls = ins.uWall * wallA * (dT + 7);
    W.roof = ins.uRoof * roofA * (dT + 18) * stratFactor;
    W.glassCond = ins.uGlass * glassA * dT;
    W.solar = glassA * ins.shgc * 250 * 0.85; // קרינה ממוצעת לחזיתות בשעת שיא, עם הצללה חלקית
    const people = input.people != null && input.people > 0 ? input.people : Math.max(1, Math.round(A / t.occ));
    W.peopleS = people * t.pS;
    W.peopleL = people * t.pL;
    W.lighting = A * t.light;
    W.equipment = input.equipmentKw != null && input.equipmentKw > 0 ? input.equipmentKw * 1000 : A * t.equip;

    // אוויר צח (מכני) + חדירות
    const oaLs = people * t.oaP + A * t.oaA;
    const infLs = t.ach * volume / 3.6;
    const q = (oaLs + infLs) / 1000; // m³/s
    const totalAir = 1.2 * q * Math.max(0, reg.hOut - INDOOR.hSummer) * 1000;
    W.airS = 1.2 * 1.006 * q * dT * 1000;
    W.airL = Math.max(0, totalAir - W.airS);

    const sensible = W.walls + W.roof + W.glassCond + W.solar + W.peopleS + W.lighting + W.equipment + W.airS;
    const latent = W.peopleL + W.airL;
    const safety = 1.10;
    const peakKw = (sensible + latent) * safety / 1000;
    const blockKw = peakKw * t.div; // עומס בו-זמני למערכת מרכזית

    // חימום (ללא זיכוי רווחים פנימיים – שמרני)
    const heatW = (ins.uWall * wallA + ins.uRoof * roofA + ins.uGlass * glassA) * dTw + 1.2 * 1.006 * q * dTw * 1000;
    const heatKw = heatW * 1.1 / 1000;

    const breakdown = [
      { key: 'envelope', name: 'מעטפת (קירות וגג)', kw: (W.walls + W.roof) / 1000 },
      { key: 'glass',    name: 'זיגוג וקרינת שמש',  kw: (W.glassCond + W.solar) / 1000 },
      { key: 'people',   name: 'אנשים',            kw: (W.peopleS + W.peopleL) / 1000 },
      { key: 'internal', name: 'תאורה וציוד',       kw: (W.lighting + W.equipment) / 1000 },
      { key: 'air',      name: 'אוויר צח וחדירות',  kw: (W.airS + W.airL) / 1000 },
    ].map(b => ({ ...b, kw: round(b.kw * safety, 2) }));

    return {
      peakKw: round(peakKw, 2), blockKw: round(blockKw, 2), heatKw: round(heatKw, 2),
      sensibleKw: round(sensible * safety / 1000, 2), latentKw: round(latent * safety / 1000, 2),
      shr: round(sensible / (sensible + latent), 2),
      btu: Math.round(peakKw * KW_TO_BTU), tr: round(peakKw / KW_PER_TR, 1),
      wPerM2: Math.round(peakKw * 1000 / A), m2PerTr: round(A / (peakKw / KW_PER_TR), 1),
      people, oaM3h: Math.round(oaLs * 3.6), volume: Math.round(volume),
      geometry: { footprint: round(footprint, 0), perimeter: round(perimeter, 0), wallA: round(wallA, 0), glassA: round(glassA, 0), roofA: round(roofA, 0) },
      breakdown, stratFactor,
    };
  }

  /* ---------- בחירת מערכת ---------- */
  function selectSystems(input, loads, rooms) {
    const t = BUILDING_TYPES[input.buildingType];
    const reg = REGIONS[input.region];
    const H = input.height, A = input.area, floors = Math.max(1, input.floors || 1);
    const kw = loads.blockKw;
    const ductOk = H >= 2.6;
    const nRooms = rooms.length;
    const notes = [];
    let primary, alts = [];

    if (t.group === 'res') {
      if (!ductOk) notes.push('גובה תקרה ' + H + ' מ\' נמוך מ-2.60 מ\' – אין מקום לתקרה מונמכת לתעלות. הומלצו מערכות ללא תעלות (עיליים / VRF עם יחידות קיר).');
      if (nRooms <= 2 || A < 60) { primary = 'split'; alts = ductOk ? ['miniCentral'] : ['miniVrf']; }
      else if (!ductOk) { primary = 'split'; alts = ['miniVrf']; }
      else if (A > 200 || floors > 1 || kw > 20) { primary = 'miniVrf'; alts = ['miniCentral', 'split']; }
      else { primary = 'miniCentral'; alts = ['miniVrf', 'split']; }
    } else if (t.group === 'it') {
      primary = 'crac'; alts = ['split'];
      notes.push('חדר שרתים: לתכנן יתירות N+1, הפעלה 24/7, ניטור טמפרטורה והתראות. בחדר קטן (עד ~10 קו"ט) ניתן להסתפק ב-2 מזגנים עיליים "תעשייתיים" עם בקר החלפה.');
    } else if (t.group === 'ind') {
      const dry = !reg.humid;
      if (input.buildingType === 'warehouse' && dry && !input.strictTemp) {
        primary = kw > 60 ? 'rooftop' : 'miniCentral'; alts = ['evaporative', 'chillerAir'];
      } else if (kw <= 60) { primary = 'miniCentral'; alts = ['rooftop', 'vrf']; }
      else if (kw <= 500) { primary = 'rooftop'; alts = ['chillerAir', 'vrf']; }
      else { primary = 'chillerAir'; alts = ['rooftop', kw > 1000 ? 'chillerWater' : 'vrf']; }
      if (dry && !alts.includes('evaporative') && !input.strictTemp) alts.push('evaporative');
      if (H > 6) notes.push('גובה ' + H + ' מ\': מומלץ למזג רק את אזור השהייה (עד ~3 מ\') – פיזור דרך שרוולי בד (Textile ducts) או מפזרים בגובה נמוך, ומאווררי תקרה נגד ריבוד (HVLS). חושב מקדם ריבוד ' + loads.stratFactor + ' על עומס הגג.');
      if (rooms.some(r => r.kind === 'office')) notes.push('המשרדים והחללים הנלווים – מומלץ מערכת נפרדת (מיני מרכזי / VRF) כדי לא להפעיל את מערכת האולם לשעות המשרד.');
    } else {
      // מסחרי / משרדים
      if (kw <= 20 && nRooms <= 3) { primary = 'miniCentral'; alts = ['split', 'miniVrf']; }
      else if (input.buildingType === 'retail' && nRooms <= 3 && kw <= 300) { primary = 'rooftop'; alts = ['vrf', 'miniCentral']; }
      else if (kw <= 400) { primary = 'vrf'; alts = [kw > 150 ? 'chillerAir' : 'miniCentral', 'rooftop']; }
      else if (kw <= 1200) { primary = 'chillerAir'; alts = ['vrf', 'chillerWater']; }
      else { primary = 'chillerWater'; alts = ['chillerAir', 'vrf']; }
      if (!ductOk && ['miniCentral', 'rooftop'].includes(primary)) {
        notes.push('גובה התקרה נמוך לתעלות – הוחלף ל-VRF עם יחידות קסטה/קיר.');
        primary = 'vrf';
      }
      if (loads.oaM3h > 0) notes.push('אוויר צח נדרש: כ-' + loads.oaM3h.toLocaleString('he-IL') + ' מ"ק/ש\' (ASHRAE 62.1). מומלץ מחליף אוויר עם השבת אנרגיה (ERV/HRV) או יחידת אוויר צח מטופל (DOAS).');
    }
    alts = alts.filter((s, i) => s !== primary && alts.indexOf(s) === i);

    if (t.group === 'res' && input.mamad) notes.push('ממ"ד: מזגן עילי נפרד דרך השרוול/הפתח שהוכן מראש לפי הנחיות פיקוד העורף. אין לקדוח או להעביר תעלות בקירות הממ"ד ללא אישור.');
    if (reg.humid) notes.push(reg.name + ' – אקלים לח: לוודא שהיחידות מסוגלות להוריד לחות (SHR ≈ ' + loads.shr + '); מצנן אוופורטיבי אינו מתאים.');
    if (reg.tSummer >= 40) notes.push('טמפרטורת תכן ' + reg.tSummer + '°C: לבחור מעבים שמדורגים לפעולה ב-46°C–52°C (דגמי "T3 / טרופיים") ולמקם אותם בצל עם פינוי אוויר חם תקין.');

    return { primary, alternatives: alts, notes };
  }

  /* ---------- פירוט ציוד לכל אופציה ---------- */
  function equipmentFor(sys, input, loads, rooms) {
    const items = [];
    const roomPeak = r => r.loadKw;
    const warn = [];
    switch (sys) {
      case 'split': {
        for (const r of rooms) {
          if (r.kind === 'hall') { const s = splitIntoUnits(CATALOG.floorStanding, roomPeak(r)); items.push({ room: r.name, unit: s.count + ' × ' + s.unit.label, kw: s.totalKw }); continue; }
          const u = pickUnit(CATALOG.wallSplit, roomPeak(r));
          if (u) items.push({ room: r.name, unit: u.label + ' (עילי)', kw: u.kw });
          else { const s = splitIntoUnits(CATALOG.floorStanding, roomPeak(r)); items.push({ room: r.name, unit: s.count + ' × ' + s.unit.label, kw: s.totalKw }); }
        }
        break;
      }
      case 'miniCentral': {
        // ממ"ד בנפרד בעילי; שאר החדרים מחולקים ליחידות מיני מרכזי
        const ducted = rooms.filter(r => r.kind !== 'mamad');
        const mamad = rooms.filter(r => r.kind === 'mamad');
        // מיני מרכזי מספק את כל החדרים בו-זמנית – גודל לפי סכום עומסי החדרים × מקדם בו-זמניות
        const blk = ducted.reduce((s, r) => s + r.loadKw, 0) * BUILDING_TYPES[input.buildingType].div;
        const s = splitIntoUnits(CATALOG.miniCentral, blk);
        const air = Math.round(s.totalKw * M3H_PER_KW);
        items.push({ room: ducted.length > 1 ? 'כל החדרים (' + ducted.length + ')' : ducted[0].name, unit: s.count + ' × ' + s.unit.label, kw: s.totalKw, extra: 'ספיקת אוויר ~' + air.toLocaleString('he-IL') + ' מ"ק/ש\'' });
        for (const r of mamad) { const u = pickUnit(CATALOG.wallSplit, r.loadKw); items.push({ room: r.name, unit: u.label + ' (עילי)', kw: u.kw }); }
        break;
      }
      case 'miniVrf':
      case 'vrf': {
        const out = sys === 'miniVrf' && loads.blockKw <= 33.5 ? [pickUnit(CATALOG.miniVrf, loads.blockKw)] : null;
        let systems = [];
        if (out) systems = [out];
        else {
          const nSys = Math.max(1, Math.ceil(loads.blockKw / VRF_SYSTEM_MAX_KW));
          for (let i = 0; i < nSys; i++) systems.push(vrfCombination(loads.blockKw / nSys));
        }
        const outKw = systems.reduce((s, set) => s + set.reduce((a, m) => a + m.kw, 0), 0);
        systems.forEach((set, i) => items.push({ room: systems.length > 1 ? 'מערכת ' + (i + 1) : 'יחידה חיצונית', unit: set.map(m => m.label).join(' + '), kw: round(set.reduce((a, m) => a + m.kw, 0)) }));
        let idu = 0;
        for (const r of rooms) {
          const kind = r.kind === 'hall' ? 'תעלתית בלחץ גבוה' : (input.height >= 2.6 && r.kind !== 'mamad' ? 'תעלתית / קסטה' : 'קיר');
          const n = Math.max(1, Math.ceil(r.loadKw / 14));
          const each = Math.max(1.5, Math.ceil(r.loadKw / n * 10) / 10);
          idu += n * each;
          items.push({ room: r.name, unit: n + ' × יח\' פנימית ' + kind + ' ' + each + ' קו"ט', kw: round(n * each) });
        }
        const ratio = Math.round(idu / outKw * 100);
        items.push({ room: 'יחס חיבור', unit: ratio + '% (מומלץ 50%–130%)', kw: null });
        // בדיקת ריכוז קרר בחדר הקטן (EN 378 / ISO 5149), R410A ‎0.44 ק"ג/מ"ק
        const charge = (outKw / systems.length) * 0.35;
        const minVol = charge / 0.44;
        const small = rooms.filter(r => r.area * input.height < minVol);
        if (small.length) warn.push('בדיקת EN 378: כמות קרר מוערכת ~' + round(charge, 0) + ' ק"ג למערכת. חללים בנפח קטן מ-' + round(minVol, 0) + ' מ"ק (' + small.map(r => r.name).join(', ') + ') – נדרש גלאי דליפה + שסתומי ניתוק, או חיבורם למערכת קטנה נפרדת.');
        break;
      }
      case 'rooftop': {
        const s = splitIntoUnits(CATALOG.rooftop, loads.blockKw);
        items.push({ room: 'כלל המבנה', unit: s.count + ' × ' + s.unit.label, kw: s.totalKw, extra: 'ספיקה כוללת ~' + Math.round(s.totalKw * M3H_PER_KW).toLocaleString('he-IL') + ' מ"ק/ש\'' });
        break;
      }
      case 'chillerAir':
      case 'chillerWater': {
        const maxUnit = sys === 'chillerAir' ? 1400 : 3500;
        const n = Math.max(loads.blockKw > 250 ? 2 : 1, Math.ceil(loads.blockKw / maxUnit));
        const each = Math.ceil(loads.blockKw / n / 10) * 10;
        items.push({ room: 'מקור קירור', unit: n + ' × צ\'ילר ' + (sys === 'chillerAir' ? 'מקורר אוויר' : 'מקורר מים') + ' ' + each + ' קו"ט (' + round(each / KW_PER_TR, 0) + ' TR)', kw: n * each });
        const flow = loads.blockKw / (4.186 * 5) * 3.6; // ΔT=5K → מ"ק/ש'
        items.push({ room: 'מים קרים', unit: '7/12°C, ספיקה ~' + round(flow, 0) + ' מ"ק/ש\', משאבות N+1', kw: null });
        if (sys === 'chillerWater') items.push({ room: 'מגדלי קירור', unit: n + ' × ~' + Math.round(each * 1.25) + ' קו"ט דחייה', kw: null });
        for (const r of rooms) items.push({ room: r.name, unit: r.kind === 'hall' || r.area > 250 ? 'מטפל אוויר (AHU) ~' + Math.round(r.loadKw * M3H_PER_KW).toLocaleString('he-IL') + ' מ"ק/ש\'' : Math.max(1, Math.ceil(r.loadKw / 7)) + ' × מפזר מאוורר (FCU)', kw: round(r.loadKw) });
        break;
      }
      case 'evaporative': {
        const air = loads.volume * 25; // ~25 החלפות לשעה
        const n = Math.ceil(air / 18000);
        items.push({ room: 'כלל האולם', unit: n + ' × מצנן אוופורטיבי 18,000 מ"ק/ש\'', kw: null, extra: '~25 החלפות אוויר לשעה + פתחי פליטה' });
        break;
      }
      case 'crac': {
        const n = Math.max(1, Math.ceil(loads.peakKw / 60));
        const each = Math.ceil(loads.peakKw / n);
        items.push({ room: 'חדר השרתים', unit: (n + 1) + ' × יחידת CRAC/In-Row ' + each + ' קו"ט (N+1)', kw: n * each });
        break;
      }
    }
    return { items: mergeItems(items), warnings: warn };
  }

  // איחוד שורות זהות (למשל 30 חללים עם אותה יחידה)
  function mergeItems(items) {
    const out = [];
    for (const it of items) {
      const prev = out.find(o => o.unit === it.unit && o.kw === it.kw && !o.extra && !it.extra && o.kw != null);
      if (prev) { prev.rooms.push(it.room); prev.count++; }
      else out.push({ ...it, rooms: [it.room], count: 1 });
    }
    return out.map(o => ({ room: o.count === 1 ? o.room : (o.count <= 3 ? o.rooms.join(', ') : o.count + ' חללים (' + o.rooms[0] + ' … ' + o.rooms[o.count - 1] + ')'), unit: o.unit, kw: o.kw, extra: o.extra, count: o.count }));
  }

  function economics(sys, input, loads) {
    const S = SYSTEMS[sys];
    const reg = REGIONS[input.region];
    const t = BUILDING_TYPES[input.buildingType];
    const capKw = sys === 'evaporative' ? loads.blockKw * 0.6 : loads.blockKw;
    const elecKw = capKw / S.eer;
    const hours = Math.min(8760, reg.eflh * t.use);
    const kwh = elecKw * hours * 0.75; // מקדם עומס חלקי
    const price = input.elecPrice || 0.64;
    return {
      costMin: Math.round(capKw * S.cost[0] / 1000) * 1000,
      costMax: Math.round(capKw * S.cost[1] / 1000) * 1000,
      elecKw: round(elecKw, 1),
      kwhYear: Math.round(kwh),
      costYear: Math.round(kwh * price / 100) * 100,
      threePhase: elecKw > 4.5,
    };
  }

  /* ---------- API ראשי ---------- */
  function design(raw) {
    const input = Object.assign({
      buildingType: 'apartment', region: 'coastal', insulation: 'new', glazing: 'med',
      area: 120, rooms: 5, height: 2.7, floors: 1, mamad: true, roofExposed: null,
      equipmentKw: null, people: null, strictTemp: false, elecPrice: 0.64,
    }, raw || {});
    const errors = [];
    if (!BUILDING_TYPES[input.buildingType]) errors.push('סוג מבנה לא מוכר');
    if (!REGIONS[input.region]) errors.push('אזור לא מוכר');
    if (!(input.area >= 8 && input.area <= 200000)) errors.push('שטח חייב להיות בין 8 ל-200,000 מ"ר');
    if (!(input.rooms >= 1 && input.rooms <= 500)) errors.push('מספר חדרים חייב להיות בין 1 ל-500');
    if (!(input.height >= 2.2 && input.height <= 30)) errors.push('גובה חייב להיות בין 2.2 ל-30 מ\'');
    if (errors.length) return { ok: false, errors };
    if (BUILDING_TYPES[input.buildingType].group !== 'res') input.mamad = false;

    const loads = computeLoads(input);
    let rooms = (input.roomList && input.roomList.length ? input.roomList : defaultRooms(input)).map(r => ({ ...r }));
    const sumA = rooms.reduce((s, r) => s + r.area, 0) || 1;
    // עומס תכן לחדר: שיא החדר (כיוון חזית, שעת שיא) גבוה מחלקו היחסי בעומס המבנה הבו-זמני
    const f = { res: 1.3, com: 1.2, ind: 1.05, it: 1.0 }[BUILDING_TYPES[input.buildingType].group];
    const roomFactor = 1 + (f - 1) * Math.min(1, (rooms.length - 1) / 3); // חלל יחיד = עומס המבנה
    rooms.forEach(r => {
      r.loadKw = round(loads.peakKw * r.area / sumA * roomFactor, 2);
      r.btu = Math.round(r.loadKw * KW_TO_BTU);
      r.airM3h = Math.round(r.loadKw * M3H_PER_KW);
      r.grilles = Math.max(1, Math.ceil(r.airM3h / 400));
    });

    const sel = selectSystems(input, loads, rooms);
    const options = [sel.primary, ...sel.alternatives].map(key => {
      const eq = equipmentFor(key, input, loads, rooms);
      return { key, ...SYSTEMS[key], brands: BRANDS[key], equipment: eq.items, warnings: eq.warnings, econ: economics(key, input, loads) };
    });

    return { ok: true, input, loads, rooms, region: REGIONS[input.region], type: BUILDING_TYPES[input.buildingType], recommended: options[0], options, notes: sel.notes };
  }

  return { design, computeLoads, defaultRooms, REGIONS, BUILDING_TYPES, INSULATION, GLAZING, CATALOG, SYSTEMS, BRANDS, KW_TO_BTU, KW_PER_TR };
});
