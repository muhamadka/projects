// הרצה: node test/engine.test.js
const assert = require('assert');
const H = require('../hvac-engine.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }

test('דירה 120 מ"ר, 5 חדרים, מישור החוף → מיני מרכזי + עילי בממ"ד', () => {
  const r = H.design({ buildingType: 'apartment', area: 120, rooms: 5, height: 2.7, region: 'coastal' });
  assert.ok(r.ok);
  assert.strictEqual(r.recommended.key, 'miniCentral');
  assert.strictEqual(r.rooms.length, 5);
  assert.ok(r.recommended.equipment.some(e => /ממ"ד/.test(e.room) && /עילי/.test(e.unit)));
  assert.ok(r.loads.wPerM2 > 50 && r.loads.wPerM2 < 130, 'W/m² סביר למגורים');
});

test('דירה עם תקרה נמוכה (2.5 מ\') → ללא תעלות', () => {
  const r = H.design({ buildingType: 'apartment', area: 100, rooms: 4, height: 2.5 });
  assert.ok(!['miniCentral', 'rooftop'].includes(r.recommended.key));
});

test('דירת 2 חדרים → מזגנים עיליים', () => {
  assert.strictEqual(H.design({ area: 55, rooms: 2 }).recommended.key, 'split');
});

test('וילה דו-קומתית 280 מ"ר → Mini-VRF', () => {
  const r = H.design({ buildingType: 'house', area: 280, rooms: 7, floors: 2 });
  assert.strictEqual(r.recommended.key, 'miniVrf');
});

test('משרדים 1,200 מ"ר → VRF + המלצת אוויר צח', () => {
  const r = H.design({ buildingType: 'office', area: 1200, rooms: 30, height: 3.2, floors: 3 });
  assert.strictEqual(r.recommended.key, 'vrf');
  assert.ok(r.loads.oaM3h > 0);
  assert.strictEqual(r.freshAir.mode, 'erv');
  assert.ok(r.freshAir.options.some(o => o.key === 'doas'));
});

test('משרדים 8,000 מ"ר → צ\'ילר עם לפחות 2 יחידות', () => {
  const r = H.design({ buildingType: 'office', area: 8000, rooms: 120, height: 3.5, floors: 8 });
  assert.ok(r.recommended.key.startsWith('chiller'));
  assert.ok(/^[2-9] ×/.test(r.recommended.equipment[0].unit));
});

test('אולם תעשייה גבוה בנגב → יחידות גג/צ\'ילר, הערת ריבוד, אופציה אוופורטיבית', () => {
  const r = H.design({ buildingType: 'industrial', area: 2500, rooms: 4, height: 9, region: 'negev' });
  assert.ok(['rooftop', 'chillerAir'].includes(r.recommended.key));
  assert.ok(r.notes.some(n => /ריבוד/.test(n)));
  assert.ok(r.options.some(o => o.key === 'evaporative'));
});

test('אקלים לח – אין המלצה אוופורטיבית', () => {
  const r = H.design({ buildingType: 'warehouse', area: 3000, rooms: 2, height: 10, region: 'coastal' });
  assert.ok(!r.options.some(o => o.key === 'evaporative'));
});

test('חדר שרתים → CRAC N+1', () => {
  const r = H.design({ buildingType: 'server', area: 40, rooms: 1, height: 3 });
  assert.strictEqual(r.recommended.key, 'crac');
  assert.ok(/N\+1/.test(r.recommended.equipment[0].unit));
});

test('עומס עולה עם גובה, אזור חם ובידוד חלש', () => {
  const base = H.design({ area: 150, rooms: 5 }).loads.peakKw;
  assert.ok(H.design({ area: 150, rooms: 5, height: 3.5 }).loads.peakKw > base);
  assert.ok(H.design({ area: 150, rooms: 5, region: 'arava' }).loads.peakKw > base);
  assert.ok(H.design({ area: 150, rooms: 5, insulation: 'poor' }).loads.peakKw > base);
});

test('חלל יחיד – עומס החדר שווה לעומס המבנה', () => {
  const r = H.design({ buildingType: 'retail', area: 400, rooms: 1, height: 4 });
  assert.ok(Math.abs(r.rooms[0].loadKw - r.loads.peakKw) < 0.05);
});

test('רשימת חדרים מותאמת אישית', () => {
  const r = H.design({ area: 100, rooms: 2, roomList: [{ name: 'סלון', area: 70, kind: 'living' }, { name: 'חדר', area: 30, kind: 'bedroom' }] });
  assert.strictEqual(r.rooms[0].name, 'סלון');
  assert.ok(r.rooms[0].loadKw > r.rooms[1].loadKw);
});

test('קלט שגוי מחזיר שגיאות', () => {
  const r = H.design({ area: 0, rooms: 0, height: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 3);
});

test('אוויר צח במגורים: ASHRAE 62.2 ו-ERV מוריד את העומס לעומת מאוורר ללא השבה', () => {
  const erv = H.design({ area: 120, rooms: 5, freshAir: 'erv' });
  const fan = H.design({ area: 120, rooms: 5, freshAir: 'mau' });
  assert.strictEqual(erv.freshAir.reqM3h, Math.round((0.15 * 120 + 3.5 * 5) * 3.6));
  assert.ok(erv.loads.peakKw < fan.loads.peakKw);
  assert.ok(erv.freshAir.recoveredKw > 0 && fan.freshAir.recoveredKw === 0);
});

test('ללא אוורור מכני במגורים – אין ספיקת אוויר צח בעומסים', () => {
  const r = H.design({ area: 120, rooms: 5, freshAir: 'none' });
  assert.strictEqual(r.loads.fresh.flowM3h, 0);
  assert.ok(r.freshAir.notes.some(n => /לשדרג/.test(n)));
});

test('משרדים גדולים – DOAS מוריד את עומס האוויר הצח מהמערכת הראשית', () => {
  const r = H.design({ buildingType: 'office', area: 4000, rooms: 60, height: 3.2, floors: 4 });
  assert.strictEqual(r.freshAir.mode, 'doas');
  assert.strictEqual(r.loads.fresh.mainKw, 0);
  assert.ok(r.freshAir.doasCoilKw > 0);
});

console.log('\n' + passed + ' בדיקות עברו');
