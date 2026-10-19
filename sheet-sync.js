// Live gear list from a Google Sheet (read-only; the sheet is the source of truth).
// Layout: a header row of category columns, each optionally followed by an "אחראי" column;
// a header containing "אישי" is the personal-gear list.
import crypto from 'node:crypto';

export const SHEET_ID = (process.env.GEAR_SHEET_ID || '1jf0KjwNvr-dwU7q2atBx8tMkIqXq2ucJgLy-AUyLpHE').trim();
export const SHEET_GID = (process.env.GEAR_SHEET_GID || '0').trim();
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`;
const CSV_URL = (process.env.GEAR_SHEET_CSV_URL || '').trim() || `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}

const isResp = (h) => /^אחראי/.test(h);

// Turn the sheet into gear items
export function sheetColumns(rows) {
  const hi = rows.findIndex((r) => r.some((x) => x));
  if (hi < 0) return [];
  return rows[hi].map((h, i) => ({ h, i })).filter(({ h }) => h && !isResp(h))
    .map(({ h, i }) => ({ cat: h, scope: /אישי/.test(h) ? 'personal' : 'shared', col: i + 1, headerRow: hi + 1 }));
}

export function sheetToItems(rows) {
  const hi = rows.findIndex((r) => r.some((x) => x));
  if (hi < 0) return [];
  const header = rows[hi];
  const cols = [];
  header.forEach((h, i) => {
    if (!h || isResp(h)) return;
    cols.push({ i, cat: h, scope: /אישי/.test(h) ? 'personal' : 'shared', resp: isResp(header[i + 1] || '') ? i + 1 : -1 });
  });
  const items = []; const seen = new Map();
  cols.forEach((col, ci) => {
    for (let r = hi + 1; r < rows.length; r++) {
      const item = rows[r][col.i];
      if (!item) continue;
      const base = `${col.scope}|${col.cat}|${item}`;
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      const id = 'sh-' + crypto.createHash('sha1').update(`${base}|${n}`).digest('base64url').slice(0, 10);
      items.push({
        id, item, cat: col.scope === 'personal' ? 'אישי' : col.cat, scope: col.scope,
        bringerText: col.resp >= 0 ? (rows[r][col.resp] || '') : '',
        order: ci * 1000 + r,
        // 1-based sheet coordinates, used when writing back
        sheetRow: r + 1, sheetCol: col.i + 1, sheetRespCol: col.resp >= 0 ? col.resp + 1 : 0,
      });
    }
  });
  return items;
}

// Match free-text names in the "אחראי" cell to participants
export function matchPeople(text, people) {
  if (!text) return [];
  const tokens = text.split(/[,،/&+\n]|\sו(?=\S)|\sאו\s/).map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (const t of tokens) {
    const p = people.find((p) => {
      const full = (p.name || '').trim(); const first = full.split(/\s+/)[0];
      return t === full || t === first || (t.length >= 2 && (full.startsWith(t) || t.startsWith(full)));
    });
    if (p && !out.includes(p.id)) out.push(p.id);
  }
  return out;
}

export function startSheetSync({ store, io, intervalMs = 8000 }) {
  const status = { ok: false, at: 0, error: '', url: SHEET_URL, columns: [] };
  let running = null;
  async function sync() {
    if (running) { await running; }   // let a write-triggered sync run after the current one
    let done; running = new Promise((r) => { done = r; });
    try {
      const r = await fetch(CSV_URL, { redirect: 'follow' });
      if (!r.ok) throw new Error(`sheet HTTP ${r.status}`);
      const text = await r.text();
      if (/^\s*</.test(text)) throw new Error('sheet is not public');
      const rows = parseCsv(text);
      const items = sheetToItems(rows);
      status.columns = sheetColumns(rows);
      const people = store.all('people');
      const keep = new Set(items.map((x) => x.id));

      // First successful sync: the sheet replaces the gear that was managed in the app
      if (!store.get('info', 'main')?.gearSheetV1) {
        for (const s of store.all('supplies')) if (s.source !== 'sheet') { await store.del('supplies', s.id); io.emit('remove', { coll: 'supplies', id: s.id }); }
        await store.patch('info', 'main', { gearSheetV1: true });
      }
      for (const it of items) {
        const cur = store.get('supplies', it.id);
        const bringers = matchPeople(it.bringerText, people);
        const next = {
          item: it.item, cat: it.cat, scope: it.scope, order: it.order, source: 'sheet',
          sheetRow: it.sheetRow, sheetCol: it.sheetCol, sheetRespCol: it.sheetRespCol,
          bringerText: it.bringerText, bringers, bringer: bringers[0] || null,
          qty: '', done: cur?.done || false, packedBy: cur?.packedBy || [],
          createdBy: cur?.createdBy || 'sheet', createdAt: cur?.createdAt || Date.now(),
        };
        const { id: _i, ...prev } = cur || {};
        if (!cur || JSON.stringify(prev) !== JSON.stringify({ ...prev, ...next })) {
          const doc = await store.put('supplies', it.id, next);
          io.emit('upsert', { coll: 'supplies', doc, by: null });
        }
      }
      for (const s of store.all('supplies')) {
        if (s.source === 'sheet' && !keep.has(s.id)) { await store.del('supplies', s.id); io.emit('remove', { coll: 'supplies', id: s.id }); }
      }
      Object.assign(status, { ok: true, at: Date.now(), error: '' });
    } catch (e) {
      Object.assign(status, { ok: false, error: e.message });
      console.error('[sheet]', e.message);
    } finally {
      const p = running; running = null; done();
      io.emit('sheet', status);
    }
  }
  sync();
  setInterval(sync, intervalMs);
  return { status, sync };
}
