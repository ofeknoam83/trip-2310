// "השף" – an assistant inside the food tab. Anyone can write to it; it changes the shared menu through tools.
import { eaters, headcount, qtyOf, fmtQty, mealsOf, AGES, WHO, DEFAULT_BUFFER, DEFAULT_MENU } from './public/food.js';

const API = 'https://api.anthropic.com/v1/messages';
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, d = 0) => (Number.isFinite(+v) ? Math.max(0, +v) : d);

export const FOOD_SHAPE = (d) => ({
  ...(d.meal !== undefined && { meal: str(d.meal, 40) || 'כללי' }),
  ...(d.cat !== undefined && { cat: str(d.cat, 30) }),
  ...(d.name !== undefined && { name: str(d.name, 80) }),
  ...(d.unit !== undefined && { unit: ['g', 'unit', 'l'].includes(d.unit) ? d.unit : 'unit' }),
  ...(d.who !== undefined && { who: Object.keys(WHO).includes(d.who) ? d.who : 'all' }),
  ...(d.perAdult !== undefined && { perAdult: num(d.perAdult) }),
  ...(d.perKid !== undefined && { perKid: { small: num(d.perKid?.small), mid: num(d.perKid?.mid), teen: num(d.perKid?.teen) } }),
  ...(d.tags !== undefined && { tags: (Array.isArray(d.tags) ? d.tags : []).filter((t) => ['meat', 'red', 'dairy'].includes(t)) }),
  ...(d.pack !== undefined && { pack: num(d.pack) }),
  ...(d.packName !== undefined && { packName: str(d.packName, 30) }),
  ...(d.extra !== undefined && { extra: Number.isFinite(+d.extra) ? +d.extra : 0 }),
  ...(d.note !== undefined && { note: str(d.note, 200) }),
  ...(d.owner !== undefined && { owner: typeof d.owner === 'string' ? d.owner.slice(0, 40) : null }),
  ...(d.bought !== undefined && { bought: !!d.bought }),
});
export const PARTY_SHAPE = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 12).map((m) => ({
  name: str(m?.name, 30) || 'ילד',
  kind: m?.kind === 'adult' ? 'adult' : 'kid',
  ...(m?.kind !== 'adult' && { age: AGES[m?.age] ? m.age : 'mid' }),
  ...(m?.veg && { veg: true }),
  ...(m?.noRed && { noRed: true }),
  ...(m?.kind === 'adult' && m?.drinks === false && { drinks: false }),
}));

export async function seedMenu(store) {
  if (store.all('food').length || store.get('info', 'main')?.foodV1) return;
  for (const { id, ...d } of DEFAULT_MENU) await store.put('food', id, { ...d, createdAt: Date.now() });
  if (store.get('info', 'main')) await store.patch('info', 'main', { foodV1: true, foodBuffer: DEFAULT_BUFFER });
  console.log('[food] default menu seeded');
}

const TOOLS = [
  {
    name: 'upsert_item',
    description: 'מוסיף פריט לרשימת האוכל או משנה פריט קיים (לפי id). כמויות הן לאדם אחד, במשקל גולמי לפני בישול. שדות שלא נשלחים לא משתנים.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id של פריט קיים לעדכון. בלי id נוצר פריט חדש.' },
        meal: { type: 'string', description: 'שם הארוחה, למשל "ערב שישי", "בוקר שבת", "צהריים שבת", "נשנושים ומדורה", "שתייה"' },
        name: { type: 'string' },
        cat: { type: 'string', description: 'קטגוריה לקנייה: בשר, ירקות, יבש, חלבי, מאפים, נשנושים, שתייה, אלכוהול, אחר' },
        unit: { type: 'string', enum: ['g', 'unit', 'l'] },
        who: { type: 'string', enum: ['all', 'adults', 'kids', 'drinkers'] },
        perAdult: { type: 'number' },
        perKid: { type: 'object', properties: { small: { type: 'number', description: 'גיל 3–6' }, mid: { type: 'number', description: 'גיל 7–12' }, teen: { type: 'number', description: 'גיל 13+' } } },
        tags: { type: 'array', items: { type: 'string', enum: ['meat', 'red', 'dairy'] }, description: 'meat = בשר (צמחונים לא מקבלים), red = בשר אדום' },
        pack: { type: 'number', description: 'גודל אריזה באותה יחידה (למשל 500 לפסטה בגרמים, 6 לשישיית בירה)' },
        packName: { type: 'string', description: 'שם האריזה ברבים, למשל "חבילות", "שישיות"' },
        extra: { type: 'number', description: 'תוספת ידנית קבועה (או מינוס) על הסה״כ, באותה יחידה' },
        note: { type: 'string' },
      },
    },
  },
  { name: 'delete_item', description: 'מוחק פריט מהרשימה', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'set_family',
    description: 'מעדכן את מי שמגיע עם משתתף: רשימה מלאה של המלווים שלו (מחליפה את הקיימת), והעדפות של המשתתף עצמו. השתמש רק כשהמשתמש אמר את זה במפורש.',
    input_schema: {
      type: 'object',
      properties: {
        personId: { type: 'string' },
        party: { type: 'array', items: { type: 'object', properties: {
          name: { type: 'string' }, kind: { type: 'string', enum: ['adult', 'kid'] }, age: { type: 'string', enum: ['small', 'mid', 'teen'] },
          veg: { type: 'boolean' }, noRed: { type: 'boolean' }, drinks: { type: 'boolean' },
        } } },
        veg: { type: 'boolean' }, noRed: { type: 'boolean' }, drinks: { type: 'boolean', description: 'האם המשתתף עצמו שותה אלכוהול' },
      },
      required: ['personId'],
    },
  },
  { name: 'set_buffer', description: 'משנה את מרווח הביטחון הכללי באחוזים (ברירת מחדל 10)', input_schema: { type: 'object', properties: { percent: { type: 'number' } }, required: ['percent'] } },
  { name: 'assign_item', description: 'משייך פריט למי שקונה אותו (personId) או מסיר שיוך (null)', input_schema: { type: 'object', properties: { id: { type: 'string' }, personId: { type: ['string', 'null'] } }, required: ['id'] } },
];

function context(store) {
  const people = store.all('people');
  const list = eaters(people);
  const h = headcount(list);
  const info = store.get('info', 'main') || {};
  const buffer = info.foodBuffer ?? DEFAULT_BUFFER;
  const items = store.all('food');
  const fam = people.map((p) => ({
    id: p.id, name: p.name, rsvp: p.rsvp || 'unknown',
    self: { veg: !!p.veg, noRed: !!p.noRed, drinks: p.drinks !== false },
    party: (p.rsvp || 'with') === 'no' || p.rsvp === 'solo' ? [] : list.filter((e) => e.family === p.id).slice(1).map(({ name, kind, age, veg, noRed, drinks }) => ({ name, kind, age, veg, noRed, drinks })),
    partyConfirmed: Array.isArray(p.party),
  }));
  const menu = mealsOf(items).map((m) => ({
    meal: m,
    items: items.filter((i) => (i.meal || 'כללי') === m).map((i) => {
      const q = qtyOf(i, list, buffer);
      const o = store.get('people', i.owner);
      return { id: i.id, name: i.name, cat: i.cat, unit: i.unit, who: i.who || 'all', perAdult: i.perAdult, perKid: i.perKid, tags: i.tags, pack: i.pack, packName: i.packName, extra: i.extra, note: i.note, total: fmtQty(i, q), owner: o?.name || null, bought: !!i.bought };
    }),
  }));
  return { trip: { dates: info.dates, area: info.area, notes: info.notes }, headcount: h, buffer, families: fam, menu };
}

const SYSTEM = (ctx, who) => `אתה "השף" של אתר טיול ג׳יפים משפחתי במדבר (לילה אחד בשטח). אתה עוזר לקבוצה לתכנן אוכל, שתייה וכמויות לפי מספר האנשים, ובמיוחד לפי הילדים ומה שהם אוכלים.
אתה מדבר עברית, קצר ופרקטי, בגובה העיניים. כותב אליך עכשיו: ${who}.

כללים:
- כשמבקשים שינוי ברשימה, בצע אותו בכלים ואז כתוב בשורה-שתיים מה השתנה ומה הכמות החדשה. בלי לשאול "לבצע?" כשהבקשה ברורה.
- הכמויות בכלים הן לאדם אחד, במשקל גולמי, ומעוגלות אוטומטית לאריזות. הסה״כ מחושב לבד לפי מי שמגיע + מרווח ביטחון.
- כמויות סבירות לגולמי: סטייק 250–350 גרם למבוגר, שניצל 150–200 גרם לילד 7–12, פסטה יבשה 80–100 גרם, 2–3 בירות לשותה בערב.
- ילדים בדרך כלל לא אוכלים סטייק – הם מקבלים שניצל, פסטה ונקניקיות. אם אומרים לך שילד מסוים כן אוכל סטייק או שהוא צמחוני, עדכן את המשפחה (set_family) או את הפריט.
- אל תמציא בני משפחה, גילים או העדפות. אם חסר מידע – שאל שאלה אחת קצרה.
- שינוי במי שמגיע (set_family) רק כשהמשתמש אמר את זה במפורש. רשימת party מחליפה את כל המלווים של אותו משתתף, אז שלח את כולם.
- אריזות ישראליות רגילות: פסטה 500 גרם, עוף/בשר בק״ג, ביצים 12 או 30, בירה בשישיות, פיתות 10 בשקית.
- אם שואלים שאלה כללית (מה כדאי לבשל, איך לארגן) – תענה בלי לשנות את הרשימה.

המצב עכשיו (JSON):
${JSON.stringify(ctx)}`;

async function applyTool(name, input, { store, io, by }) {
  const emit = (coll, doc) => io.emit('upsert', { coll, doc, by });
  if (name === 'upsert_item') {
    const clean = FOOD_SHAPE(input);
    if (input.id && store.get('food', input.id)) { const doc = await store.patch('food', input.id, clean); emit('food', doc); return `עודכן: ${doc.name}`; }
    if (!clean.name) return 'שגיאה: חסר שם';
    const doc = await store.put('food', null, { meal: 'כללי', unit: 'unit', who: 'all', perAdult: 0, perKid: { small: 0, mid: 0, teen: 0 }, ...clean, createdBy: by, createdAt: Date.now() });
    emit('food', doc); return `נוסף: ${doc.name} (id ${doc.id})`;
  }
  if (name === 'delete_item') {
    const cur = store.get('food', str(input.id, 40)); if (!cur) return 'לא נמצא';
    await store.del('food', cur.id); io.emit('remove', { coll: 'food', id: cur.id }); return `נמחק: ${cur.name}`;
  }
  if (name === 'set_family') {
    const p = store.get('people', str(input.personId, 40)); if (!p) return 'משתתף לא נמצא';
    const patch = {};
    if (input.party !== undefined) {
      patch.party = PARTY_SHAPE(input.party);
      patch.companions = patch.party.map((m) => m.name).join(', ');
      if (patch.party.length && (p.rsvp === 'solo' || !p.rsvp || p.rsvp === 'unknown')) patch.rsvp = 'with';
    }
    for (const f of ['veg', 'noRed', 'drinks']) if (typeof input[f] === 'boolean') patch[f] = input[f];
    const doc = await store.patch('people', p.id, patch); emit('people', doc); return `עודכן: ${p.name}`;
  }
  if (name === 'set_buffer') {
    const pct = Math.min(50, num(input.percent, DEFAULT_BUFFER));
    const doc = store.get('info', 'main') ? await store.patch('info', 'main', { foodBuffer: pct }) : await store.put('info', 'main', { foodBuffer: pct });
    emit('info', doc); return `מרווח ביטחון: ${pct}%`;
  }
  if (name === 'assign_item') {
    const cur = store.get('food', str(input.id, 40)); if (!cur) return 'לא נמצא';
    const owner = input.personId && store.get('people', input.personId) ? input.personId : null;
    const doc = await store.patch('food', cur.id, { owner }); emit('food', doc); return `שויך: ${cur.name}`;
  }
  return 'כלי לא מוכר';
}

export function mountChef({ app, io, store, apiKey, model, provider = 'anthropic' }) {
  const hits = new Map();
  app.post('/api/food/chat', async (req, res) => {
    if (!apiKey) return res.status(503).json({ error: 'השף עוד לא מחובר (חסר מפתח API בשרת)' });
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    const now = Date.now(); const h = (hits.get(ip) || []).filter((t) => now - t < 60e3);
    if (h.length >= 12) return res.status(429).json({ error: 'רגע, יותר מדי הודעות. נסו שוב בעוד דקה.' });
    hits.set(ip, [...h, now]);

    const text = str(req.body?.text, 1000); if (!text) return res.status(400).json({ error: 'ריק' });
    const by = store.get('people', str(req.body?.by, 40))?.id || null;
    const who = store.get('people', by)?.name || 'אורח';
    const userMsg = await store.put('foodchat', null, { role: 'user', text, by, t: now });
    io.emit('upsert', { coll: 'foodchat', doc: userMsg, by });
    // Keep the shared thread short
    const all = store.all('foodchat').sort((a, b) => a.t - b.t);
    for (const old of all.slice(0, Math.max(0, all.length - 120))) { await store.del('foodchat', old.id); io.emit('remove', { coll: 'foodchat', id: old.id }); }

    const history = store.all('foodchat').sort((a, b) => a.t - b.t).slice(-16)
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.role === 'user' ? `${store.get('people', m.by)?.name || 'אורח'}: ${m.text}` : m.text }));
    // The API needs alternating roles starting with the user
    const msgs = [];
    for (const m of history) { if (msgs.length && msgs.at(-1).role === m.role) msgs.at(-1).content += `\n${m.content}`; else msgs.push({ ...m }); }
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();

    const changes = [];
    try {
      const run = async (u) => {
        let out;
        try { out = await applyTool(u.name, u.input || {}, { store, io, by }); } catch (e) { out = `שגיאה: ${e.message}`; }
        if (!/^שגיאה|לא נמצא|לא מוכר/.test(out)) changes.push(out.replace(/\s*\(id [^)]+\)/, ''));
        return out;
      };
      const reply = provider === 'openai'
        ? await loopOpenAI({ apiKey, model, system: () => SYSTEM(context(store), who), msgs, run })
        : await loopAnthropic({ apiKey, model, system: () => SYSTEM(context(store), who), msgs, run });
      const doc = await store.put('foodchat', null, { role: 'assistant', text: reply || 'עודכן.', changes, replyTo: userMsg.id, t: Date.now() });
      io.emit('upsert', { coll: 'foodchat', doc, by: null });
      res.json({ ok: true, doc });
    } catch (e) {
      console.error('[chef]', e.message);
      const doc = await store.put('foodchat', null, { role: 'assistant', text: 'לא הצלחתי לענות עכשיו. נסו שוב עוד רגע.', error: true, changes, replyTo: userMsg.id, t: Date.now() });
      io.emit('upsert', { coll: 'foodchat', doc, by: null });
      res.status(502).json({ error: e.message, doc });
    }
  });
}

// ---------- model loops: call the model, run its tool calls, repeat until it answers ----------
async function loopAnthropic({ apiKey, model, system, msgs, run }) {
  let reply = '';
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1200, system: system(), tools: TOOLS, messages: msgs }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `API ${r.status}`);
    msgs.push({ role: 'assistant', content: j.content });
    reply = j.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim() || reply;
    const uses = j.content.filter((c) => c.type === 'tool_use');
    if (j.stop_reason !== 'tool_use' || !uses.length) break;
    const results = [];
    for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id, content: await run(u) });
    msgs.push({ role: 'user', content: results });
  }
  return reply;
}

async function loopOpenAI({ apiKey, model, system, msgs, run }) {
  const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const conv = msgs.map((m) => ({ role: m.role, content: m.content }));
  let reply = '';
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      // The system prompt is rebuilt every turn so the model sees the list after its own changes
      body: JSON.stringify({ model, reasoning_effort: 'low', max_completion_tokens: 4000, tools, messages: [{ role: 'system', content: system() }, ...conv] }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `API ${r.status}`);
    const m = j.choices?.[0]?.message || {};
    conv.push({ role: 'assistant', content: m.content ?? null, ...(m.tool_calls?.length && { tool_calls: m.tool_calls }) });
    reply = (m.content || '').trim() || reply;
    if (!m.tool_calls?.length) break;
    for (const c of m.tool_calls) {
      let input = {};
      try { input = JSON.parse(c.function?.arguments || '{}'); } catch { /* bad json */ }
      conv.push({ role: 'tool', tool_call_id: c.id, content: await run({ name: c.function?.name, input }) });
    }
  }
  return reply;
}
