// Food planning: who eats, how much of each item, and how that rounds to real packages.
// Shared by the browser and the server (the chef assistant), so both see the same numbers.

export const AGES = { small: 'גיל 3–6', mid: 'גיל 7–12', teen: 'גיל 13+' };
export const WHO = { all: 'כולם', adults: 'מבוגרים', kids: 'ילדים', drinkers: 'מבוגרים ששותים' };
export const UNITS = { g: 'גרם', unit: 'יח׳', l: 'ליטר' };
export const MEAL_ORDER = ['ערב שישי', 'בוקר שבת', 'צהריים שבת', 'נשנושים ומדורה', 'שתייה'];
export const DEFAULT_BUFFER = 10; // percent

// Companions written as free text ("עמית, נועה") become kids aged 7–12 until someone says otherwise
export function partyOf(p) {
  if (Array.isArray(p.party)) return p.party;
  const s = String(p.companions || '').trim();
  if (!s) return [];
  return s.replace(/\s+ו(?=\S)/g, ',').split(/[,،+]/).map((x) => x.trim()).filter(Boolean)
    .map((name) => ({ name, kind: 'kid', age: 'mid' }));
}
const coming = (p) => (p.rsvp || (String(p.companions || '').trim() ? 'with' : 'unknown')) !== 'no';

// Everyone who eats: the participant himself plus his party
export function eaters(people) {
  const out = [];
  for (const p of people) {
    if (!coming(p)) continue;
    out.push({ name: p.name, family: p.id, kind: 'adult', veg: !!p.veg, noRed: !!p.noRed, drinks: p.drinks !== false });
    if ((p.rsvp || 'with') === 'solo') continue;
    for (const m of partyOf(p)) {
      out.push({ name: m.name, family: p.id, kind: m.kind === 'adult' ? 'adult' : 'kid', age: AGES[m.age] ? m.age : 'mid',
        veg: !!m.veg, noRed: !!m.noRed, drinks: m.kind === 'adult' && m.drinks !== false });
    }
  }
  return out;
}
export function headcount(list) {
  const h = { adults: 0, kids: 0, small: 0, mid: 0, teen: 0, drinkers: 0, veg: 0 };
  for (const e of list) {
    if (e.kind === 'adult') { h.adults++; if (e.drinks) h.drinkers++; } else { h.kids++; h[e.age]++; }
    if (e.veg) h.veg++;
  }
  return h;
}

// Does this eater get this item?
function eats(item, e) {
  const w = item.who || 'all';
  if (w === 'adults' && e.kind !== 'adult') return false;
  if (w === 'kids' && e.kind !== 'kid') return false;
  if (w === 'drinkers' && !(e.kind === 'adult' && e.drinks)) return false;
  const tags = item.tags || [];
  if (e.veg && tags.includes('meat')) return false;
  if (e.noRed && tags.includes('red')) return false;
  return true;
}
export function portion(item, e) {
  if (!eats(item, e)) return 0;
  return e.kind === 'adult' ? +item.perAdult || 0 : +(item.perKid?.[e.age]) || 0;
}

// Total for an item: per-person portions, plus the safety margin, plus a manual extra, rounded to packages
export function qtyOf(item, list, bufferPct = DEFAULT_BUFFER) {
  let base = 0; let n = 0;
  for (const e of list) { const q = portion(item, e); if (q > 0) { base += q; n++; } }
  const total = Math.max(0, base * (1 + (+bufferPct || 0) / 100) + (+item.extra || 0));
  const packs = item.pack > 0 && total > 0 ? Math.ceil(total / item.pack - 1e-9) : null;
  return { total, packs, n, base };
}

const r1 = (x) => (Math.round(x * 10) / 10).toString();
export function fmtAmount(unit, x) {
  if (unit === 'g') return x >= 1000 ? `${r1(x / 1000)} ק״ג` : `${Math.round(x / 10) * 10 || Math.round(x)} גרם`;
  if (unit === 'l') return `${r1(x)} ליטר`;
  return `${Math.ceil(x - 1e-9)} יח׳`;
}
export function fmtQty(item, q) {
  if (!q.total) return '—';
  const amt = fmtAmount(item.unit, q.total);
  if (!q.packs) return amt;
  const packs = `${q.packs} ${item.packName || 'אריזות'}`;
  return item.unit === 'unit' && (!item.pack || item.pack === 1) ? packs : `${packs} · ${amt}`;
}

export function mealsOf(items) {
  const names = [...new Set(items.map((i) => i.meal || 'כללי'))];
  return names.sort((a, b) => {
    const ia = MEAL_ORDER.indexOf(a), ib = MEAL_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// Starting menu: one night out (Friday dinner, Saturday breakfast and lunch), weights are raw/uncooked
const k = (small, mid, teen) => ({ small, mid, teen });
export const DEFAULT_MENU = [
  // ערב שישי
  { id: 'f-steak', meal: 'ערב שישי', cat: 'בשר', name: 'אנטריקוט / סטייקים', unit: 'g', perAdult: 300, perKid: k(0, 0, 200), tags: ['meat', 'red'] },
  { id: 'f-schnitzel', meal: 'ערב שישי', cat: 'בשר', name: 'חזה עוף לשניצלים', unit: 'g', perAdult: 100, perKid: k(120, 180, 150), tags: ['meat'] },
  { id: 'f-crumbs', meal: 'ערב שישי', cat: 'יבש', name: 'פירורי לחם + ביצים לציפוי', unit: 'g', perAdult: 25, perKid: k(25, 35, 30), pack: 500, packName: 'שקיות פירורים' },
  { id: 'f-hotdog', meal: 'ערב שישי', cat: 'בשר', name: 'נקניקיות', unit: 'unit', perAdult: 0, perKid: k(2, 2, 1), tags: ['meat'], pack: 10, packName: 'חבילות (10)' },
  { id: 'f-pasta', meal: 'ערב שישי', cat: 'יבש', name: 'פסטה', unit: 'g', perAdult: 80, perKid: k(60, 90, 100), pack: 500, packName: 'חבילות' },
  { id: 'f-sauce', meal: 'ערב שישי', cat: 'יבש', name: 'רוטב עגבניות לפסטה', unit: 'unit', perAdult: 0.2, perKid: k(0.2, 0.25, 0.25), pack: 1, packName: 'צנצנות' },
  { id: 'f-pita', meal: 'ערב שישי', cat: 'מאפים', name: 'פיתות', unit: 'unit', perAdult: 2, perKid: k(1, 1.5, 2), pack: 10, packName: 'שקיות (10)' },
  { id: 'f-cuke', meal: 'ערב שישי', cat: 'ירקות', name: 'מלפפונים', unit: 'unit', perAdult: 1, perKid: k(0.25, 0.5, 0.75) },
  { id: 'f-tomato', meal: 'ערב שישי', cat: 'ירקות', name: 'עגבניות', unit: 'unit', perAdult: 1, perKid: k(0.25, 0.5, 0.75) },
  { id: 'f-pepper', meal: 'ערב שישי', cat: 'ירקות', name: 'פלפלים', unit: 'unit', perAdult: 0.3, perKid: k(0.1, 0.2, 0.3) },
  { id: 'f-onion', meal: 'ערב שישי', cat: 'ירקות', name: 'בצל + לימון לסלט', unit: 'unit', perAdult: 0.25, perKid: k(0.1, 0.1, 0.2) },
  { id: 'f-tahini', meal: 'ערב שישי', cat: 'יבש', name: 'טחינה גולמית', unit: 'g', perAdult: 40, perKid: k(15, 20, 30), pack: 500, packName: 'צנצנות' },
  { id: 'f-coal', meal: 'ערב שישי', cat: 'אחר', name: 'פחמים', unit: 'g', perAdult: 400, perKid: k(100, 150, 250), pack: 3000, packName: 'שקים (3 ק״ג)' },
  // בוקר שבת
  { id: 'f-eggs', meal: 'בוקר שבת', cat: 'חלבי', name: 'ביצים (שקשוקה / חביתות)', unit: 'unit', perAdult: 2, perKid: k(1, 1.5, 2), pack: 12, packName: 'תבניות (12)' },
  { id: 'f-shak', meal: 'בוקר שבת', cat: 'ירקות', name: 'עגבניות לשקשוקה', unit: 'unit', perAdult: 1, perKid: k(0.5, 0.5, 1) },
  { id: 'f-bread', meal: 'בוקר שבת', cat: 'מאפים', name: 'לחם', unit: 'unit', perAdult: 0.25, perKid: k(0.15, 0.2, 0.25), pack: 1, packName: 'כיכרות' },
  { id: 'f-white', meal: 'בוקר שבת', cat: 'חלבי', name: 'גבינה לבנה / קוטג׳', unit: 'g', perAdult: 70, perKid: k(40, 50, 70), pack: 250, packName: 'גביעים' },
  { id: 'f-yellow', meal: 'בוקר שבת', cat: 'חלבי', name: 'גבינה צהובה', unit: 'g', perAdult: 50, perKid: k(30, 40, 50), pack: 200, packName: 'אריזות' },
  { id: 'f-milk', meal: 'בוקר שבת', cat: 'חלבי', name: 'חלב (קפה ודגני בוקר)', unit: 'l', perAdult: 0.2, perKid: k(0.25, 0.3, 0.3), pack: 1, packName: 'קרטונים' },
  { id: 'f-cereal', meal: 'בוקר שבת', cat: 'יבש', name: 'דגני בוקר', unit: 'g', perAdult: 0, perKid: k(40, 50, 50), pack: 500, packName: 'קופסאות' },
  // צהריים שבת
  { id: 'f-hummus', meal: 'צהריים שבת', cat: 'יבש', name: 'חומוס', unit: 'g', perAdult: 100, perKid: k(40, 60, 80), pack: 400, packName: 'גביעים' },
  { id: 'f-tuna', meal: 'צהריים שבת', cat: 'יבש', name: 'טונה', unit: 'unit', perAdult: 0.5, perKid: k(0.25, 0.3, 0.5), pack: 4, packName: 'רביעיות' },
  { id: 'f-pita2', meal: 'צהריים שבת', cat: 'מאפים', name: 'פיתות לצהריים', unit: 'unit', perAdult: 2, perKid: k(1, 1, 1.5), pack: 10, packName: 'שקיות (10)' },
  { id: 'f-spread', meal: 'צהריים שבת', cat: 'יבש', name: 'שוקולד למריחה / ממרח', unit: 'unit', perAdult: 0, perKid: k(0.1, 0.1, 0.1), pack: 1, packName: 'צנצנות' },
  // נשנושים ומדורה
  { id: 'f-snacks', meal: 'נשנושים ומדורה', cat: 'נשנושים', name: 'במבה / ביסלי / צ׳יפס', unit: 'unit', perAdult: 0.3, perKid: k(1, 1.5, 1.5), pack: 1, packName: 'שקיות' },
  { id: 'f-marsh', meal: 'נשנושים ומדורה', cat: 'נשנושים', name: 'מרשמלו למדורה', unit: 'unit', perAdult: 0.05, perKid: k(0.2, 0.25, 0.2), pack: 1, packName: 'שקיות' },
  { id: 'f-potato', meal: 'נשנושים ומדורה', cat: 'ירקות', name: 'תפוחי אדמה לגחלים', unit: 'unit', perAdult: 1, perKid: k(0.5, 1, 1) },
  { id: 'f-fruit', meal: 'נשנושים ומדורה', cat: 'ירקות', name: 'פירות (תפוזים, תפוחים, בננות)', unit: 'unit', perAdult: 1.5, perKid: k(1.5, 2, 2) },
  // שתייה
  { id: 'f-beer', meal: 'שתייה', cat: 'אלכוהול', name: 'בירה', unit: 'unit', who: 'drinkers', perAdult: 3, perKid: k(0, 0, 0), pack: 6, packName: 'שישיות' },
  { id: 'f-wine', meal: 'שתייה', cat: 'אלכוהול', name: 'יין', unit: 'unit', who: 'drinkers', perAdult: 0.35, perKid: k(0, 0, 0), pack: 1, packName: 'בקבוקים' },
  { id: 'f-arak', meal: 'שתייה', cat: 'אלכוהול', name: 'ערק / וויסקי', unit: 'unit', who: 'drinkers', perAdult: 0.15, perKid: k(0, 0, 0), pack: 1, packName: 'בקבוקים' },
  { id: 'f-soft', meal: 'שתייה', cat: 'שתייה', name: 'שתייה קלה ומיצים', unit: 'l', perAdult: 0.5, perKid: k(0.7, 1, 1), pack: 1.5, packName: 'בקבוקי 1.5 ל׳' },
  { id: 'f-coffee', meal: 'שתייה', cat: 'שתייה', name: 'קפה שחור / נס', unit: 'g', who: 'adults', perAdult: 20, perKid: k(0, 0, 0), pack: 200, packName: 'שקיות' },
];
