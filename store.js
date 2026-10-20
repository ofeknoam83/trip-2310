// Tiny document store: Postgres (jsonb) when DATABASE_URL is set, otherwise a JSON file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import * as seed from './seed.js';

export const COLLECTIONS = ['people', 'tasks', 'supplies', 'locations', 'pins', 'info', 'news', 'routes', 'food', 'foodchat'];

const newId = () => crypto.randomBytes(6).toString('base64url');

export async function createStore() {
  const mem = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
  let persist; let blob;

  if (process.env.DATABASE_URL) {
    const ssl = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false };
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 5 });
    pool.on('error', (e) => console.error('[store] pool error', e.message));
    // The database may still be starting on first deploy – retry for up to ~2 minutes
    for (let attempt = 1; ; attempt++) {
      try { await pool.query('select 1'); break; } catch (e) {
        if (attempt >= 24) throw e;
        console.log(`[store] waiting for database (${e.code || e.message}), attempt ${attempt}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    await pool.query(`create table if not exists docs (
      coll text not null, id text not null, data jsonb not null,
      updated_at timestamptz not null default now(), primary key (coll, id))`);
    const { rows } = await pool.query('select coll, id, data from docs');
    for (const r of rows) mem[r.coll]?.set(r.id, r.data);
    await pool.query('create table if not exists blobs (key text primary key, data bytea not null, created_at timestamptz not null default now())');
    blob = {
      get: async (k) => (await pool.query('select data from blobs where key=$1', [k])).rows[0]?.data || null,
      put: (k, buf) => pool.query('insert into blobs (key, data) values ($1,$2) on conflict (key) do update set data = excluded.data', [k, buf]),
    };
    persist = {
      put: (c, id, d) => pool.query(
        `insert into docs (coll, id, data) values ($1,$2,$3)
         on conflict (coll, id) do update set data = excluded.data, updated_at = now()`, [c, id, d]),
      del: (c, id) => pool.query('delete from docs where coll=$1 and id=$2', [c, id]),
    };
    console.log(`[store] postgres, ${rows.length} docs loaded`);
  } else {
    const file = path.resolve(process.env.DATA_FILE || './data.json');
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of COLLECTIONS) for (const [id, d] of Object.entries(raw[c] || {})) mem[c].set(id, d);
    }
    let t;
    const flush = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const out = Object.fromEntries(COLLECTIONS.map((c) => [c, Object.fromEntries(mem[c])]));
        fs.writeFileSync(file, JSON.stringify(out));
      }, 200);
    };
    persist = { put: async () => flush(), del: async () => flush() };
    const dir = path.resolve(process.env.BLOB_DIR || './blobs'); fs.mkdirSync(dir, { recursive: true });
    const fp = (k) => path.join(dir, k.replace(/[^a-z0-9_-]/gi, '_'));
    blob = { get: async (k) => (fs.existsSync(fp(k)) ? fs.readFileSync(fp(k)) : null), put: async (k, b) => fs.writeFileSync(fp(k), b) };
    console.log(`[store] file ${file}`);
  }

  const store = {
    all(c) { return [...mem[c].entries()].map(([id, d]) => ({ id, ...d })); },
    get(c, id) { const d = mem[c].get(id); return d ? { id, ...d } : null; },
    async put(c, id, data) {
      id = id || newId();
      const { id: _drop, ...clean } = data;
      mem[c].set(id, clean);
      await persist.put(c, id, clean);
      return { id, ...clean };
    },
    async patch(c, id, changes) {
      const cur = mem[c].get(id);
      if (!cur) return null;
      const { id: _drop, ...clean } = changes;
      return store.put(c, id, { ...cur, ...clean });
    },
    async del(c, id) { mem[c].delete(id); await persist.del(c, id); },
    blobGet: (k) => blob.get(k),
    blobPut: (k, b) => blob.put(k, b),
    snapshot() { return Object.fromEntries(COLLECTIONS.map((c) => [c, store.all(c)])); },
  };

  // Seed an empty store
  if (mem.people.size === 0) {
    for (const p of seed.people) { const { id, ...d } = p; await store.put('people', id, d); }
    for (const t of seed.tasks) await store.put('tasks', null, t);
    for (const s of seed.supplies) await store.put('supplies', null, s);
    for (const s of seed.personalSupplies) await store.put('supplies', null, s);
    await store.put('info', 'main', { ...seed.info, gearV2: true });
    console.log('[store] seeded');
  } else {
    // One-time: split gear into shared and personal lists
    if (!mem.info.get('main')?.gearV2) {
      const toPersonal = ['שקי שינה ומזרנים', 'פנסי ראש + סוללות', 'מים – 6 ליטר לאדם ליום'];
      for (const s of store.all('supplies')) {
        if (s.scope) continue;
        if (toPersonal.includes(s.item) && !s.bringer) await store.del('supplies', s.id);
        else await store.patch('supplies', s.id, { scope: 'shared', packedBy: s.packedBy || [] });
      }
      const have = new Set(store.all('supplies').map((s) => s.item));
      for (const s of seed.personalSupplies) if (!have.has(s.item)) await store.put('supplies', null, s);
      await store.patch('info', 'main', { gearV2: true });
      console.log('[store] gear split into shared/personal');
    }
    // Fill in avatars that were added to the seed later, unless the person already set one
    for (const p of seed.people) {
      const cur = mem.people.get(p.id);
      if (cur && !cur.avatar && p.avatar) await store.patch('people', p.id, { avatar: p.avatar });
    }
  }
  return store;
}
