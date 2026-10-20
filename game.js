// "Wife GO": collect the wives in AR. Characters are 3D models made from photos with Tripo,
// spawned around the group and along the route. Everything here sits behind a trip PIN.
import crypto from 'node:crypto';

const TRIPO = (process.env.TRIPO_API_BASE || 'https://openapi.tripo3d.ai/v3').trim().replace(/\/$/, '');
const TRIPO_KEY = (process.env.TRIPO_API_KEY || '').trim();
const TRIPO_MODEL = (process.env.TRIPO_MODEL || 'v3.1-20260211').trim();
const RIG_MODEL = (process.env.TRIPO_RIG_MODEL || 'v1.0-20240301').trim(); // v1.0 has the wave / dance presets
const PIN = (process.env.GAME_PIN || '').trim();

export const GAME_COLLS = ['gchars', 'gspawns', 'gcatches'];
const RARITY = { common: { w: 70, pts: 10, life: [25, 45] }, rare: { w: 25, pts: 30, life: [15, 30] }, legendary: { w: 5, pts: 100, life: [8, 15] } };
const CATCH_M = 80; // server-side tolerance; the app asks for ~40 m
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const rid = () => crypto.randomBytes(6).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const distM = (a, b) => { const R = 6371000, r = Math.PI / 180; const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const offset = (p, m, deg) => { const r = Math.PI / 180; return { lat: p.lat + (m * Math.cos(deg * r)) / 111320, lng: p.lng + (m * Math.sin(deg * r)) / (111320 * Math.cos(p.lat * r)) }; };
const pick = (w) => { const t = Object.values(w).reduce((a, b) => a + b, 0); let x = Math.random() * t; for (const [k, v] of Object.entries(w)) { if ((x -= v) <= 0) return k; } return Object.keys(w)[0]; };

// ---------- Tripo ----------
async function tripo(path, body) {
  const r = await fetch(`${TRIPO}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TRIPO_KEY}`, ...(body && { 'content-type': 'application/json' }) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.code !== undefined && j.code !== 0)) throw new Error(j.message || j.error?.message || `Tripo ${r.status}`);
  return j.data ?? j;
}
async function tripoUpload(buf, name) {
  const fd = new FormData(); fd.append('file', new Blob([buf], { type: 'image/jpeg' }), name || 'photo.jpg');
  const r = await fetch(`${TRIPO}/files`, { method: 'POST', headers: { authorization: `Bearer ${TRIPO_KEY}` }, body: fd, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data?.file_token) throw new Error(j.message || `upload ${r.status}`);
  return j.data.file_token;
}
async function waitTask(id, onProgress, maxMs = 15 * 60e3) {
  const t0 = Date.now();
  for (;;) {
    const d = await tripo(`/tasks/${id}`);
    if (d.status === 'success') return d;
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(d.status)) throw new Error(`Tripo task ${d.status}`);
    onProgress?.(d.progress || 0);
    if (Date.now() - t0 > maxMs) throw new Error('Tripo timeout');
    await sleep(3000);
  }
}
async function download(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const outUrl = (d) => d.output?.model_url || d.output?.pbr_model || d.output?.model || d.output?.model_urls?.[0];

export function mountGame({ app, io, store }) {
  const room = io.to('game');
  const emit = (coll, doc) => room.emit('game:upsert', { coll, doc: lite(coll, doc) });
  const lite = (coll, d) => (coll === 'gchars' ? (({ tasks, ...x }) => x)(d) : d);
  const ok = (req) => !!PIN && String(req.headers['x-game-pin'] || req.query.pin || '') === PIN;
  const guard = (req, res, next) => (ok(req) ? next() : res.status(PIN ? 401 : 503).json({ error: PIN ? 'קוד שגוי' : 'המשחק עוד לא הופעל (חסר GAME_PIN בשרת)' }));

  // ----- character pipeline: photo → model → rig check → rig → idle + wave animations -----
  const running = new Set();
  async function pipeline(id) {
    if (running.has(id)) return; running.add(id);
    const set = async (patch) => { const c = store.get('gchars', id); if (!c) throw new Error('gone'); const doc = await store.patch('gchars', id, patch); emit('gchars', doc); return doc; };
    try {
      let c = store.get('gchars', id); if (!c) return;
      const tasks = { ...(c.tasks || {}) };
      const step = async (name, label, create, after) => {
        if (tasks[`${name}Done`]) return;
        if (!tasks[name]) { tasks[name] = (await create()).task_id; await set({ tasks, status: label, progress: 0 }); }
        const d = await waitTask(tasks[name], (p) => { if (p % 10 < 3) set({ status: label, progress: p }).catch(() => {}); });
        await after(d); tasks[`${name}Done`] = true; await set({ tasks });
      };
      if (!tasks.file) { const photo = await store.blobGet(c.photo); tasks.file = await tripoUpload(photo, `${id}.jpg`); await set({ tasks, status: 'upload' }); }
      await step('model', 'model', () => tripo('/generation/image-to-model', { input: tasks.file, model: TRIPO_MODEL, texture: true, pbr: true, texture_quality: 'standard', face_limit: 20000, orientation: 'align_image', enable_image_autofix: true }), async (d) => {
        await store.blobPut(`g-${id}-static`, await download(outUrl(d)));
        if (d.output?.rendered_image_url) await store.blobPut(`g-${id}-thumb`, await download(d.output.rendered_image_url)).catch(() => {});
        await set({ glb: `g-${id}-static`, thumb: d.output?.rendered_image_url ? `g-${id}-thumb` : '' });
      });
      let riggable = tasks.riggable;
      if (riggable === undefined) {
        try { const d = await waitTask((await tripo('/animations/rig-check', { input: tasks.model })).task_id); riggable = d.output?.riggable !== false; } catch { riggable = false; }
        tasks.riggable = riggable; await set({ tasks });
      }
      if (riggable) {
        try {
          await step('rig', 'rig', () => tripo('/animations/rig', { input: tasks.model, model: RIG_MODEL, rig_type: 'biped', spec: 'tripo', out_format: 'glb' }), async () => {});
          await step('idle', 'anim', () => tripo('/animations/retarget', { input: tasks.rig, animation: 'preset:biped:idle', out_format: 'glb', animate_in_place: true }), async (d) => {
            await store.blobPut(`g-${id}-idle`, await download(outUrl(d))); await set({ glb: `g-${id}-idle` });
          });
          await step('wave', 'anim', () => tripo('/animations/retarget', { input: tasks.rig, animation: 'preset:biped:wave_goodbye_01', out_format: 'glb', animate_in_place: true }), async (d) => {
            await store.blobPut(`g-${id}-wave`, await download(outUrl(d))); await set({ glbWave: `g-${id}-wave` });
          });
        } catch (e) { console.warn(`[game] ${id} animation skipped:`, e.message); }
      }
      await set({ status: 'ready', progress: 100, error: '' }); setTimeout(tick, 500);
      console.log(`[game] character ${id} ready`);
    } catch (e) {
      console.error(`[game] ${id} failed:`, e.message);
      if (store.get('gchars', id)) await set({ status: 'failed', error: e.message }).catch(() => {});
    } finally { running.delete(id); }
  }
  // Resume anything that was in progress when the server restarted
  setTimeout(() => { for (const c of store.all('gchars')) if (!['ready', 'failed'].includes(c.status) && TRIPO_KEY) pipeline(c.id); }, 5000);

  // ----- spawns -----
  function anchors() {
    const out = [];
    const locs = store.all('locations').filter((l) => l.sharing && Date.now() - l.t < 30 * 60e3);
    if (locs.length) out.push({ lat: locs.reduce((a, l) => a + l.lat, 0) / locs.length, lng: locs.reduce((a, l) => a + l.lng, 0) / locs.length, r: [80, 500] });
    for (const p of store.all('pins')) out.push({ lat: p.lat, lng: p.lng, r: [30, 250], camp: p.kind === 'camp' });
    return out;
  }
  async function spawnTick() {
    const chars = store.all('gchars').filter((c) => c.status === 'ready' && c.glb);
    if (!chars.length) return;
    const now = Date.now();
    for (const s of store.all('gspawns')) if (s.until < now - 60e3 && !s.trail) { await store.del('gspawns', s.id); room.emit('game:remove', { coll: 'gspawns', id: s.id }); }
    const live = store.all('gspawns').filter((s) => !s.trail && s.until > now);
    const want = Math.min(10, 3 + chars.length);
    const places = anchors(); if (!places.length) return;
    for (let i = live.length; i < want; i++) {
      const a = places[Math.floor(Math.random() * places.length)];
      const rar = pick(Object.fromEntries(Object.entries(RARITY).map(([k, v]) => [k, v.w])));
      const pool = chars.filter((c) => (c.rarity || 'common') === rar);
      const c = (pool.length ? pool : chars)[Math.floor(Math.random() * (pool.length ? pool : chars).length)];
      const [lo, hi] = RARITY[c.rarity || 'common'].life;
      const pos = offset(a, a.r[0] + Math.random() * (a.r[1] - a.r[0]), Math.random() * 360);
      const doc = await store.put('gspawns', rid(), { char: c.id, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), from: now, until: now + (lo + Math.random() * (hi - lo)) * 60e3, rarity: c.rarity || 'common' });
      emit('gspawns', doc);
    }
  }
  // Fixed spawns along the active route, so the game works without reception
  async function trailSpawns() {
    const route = store.get('routes', store.get('info', 'main')?.activeRoute);
    const chars = store.all('gchars').filter((c) => c.status === 'ready' && c.glb);
    const key = route && chars.length ? `${route.id}:${chars.map((c) => c.id).sort().join(',')}` : '';
    if (!key || store.get('info', 'main')?.gameTrail === key) return;
    for (const s of store.all('gspawns').filter((x) => x.trail)) { await store.del('gspawns', s.id); room.emit('game:remove', { coll: 'gspawns', id: s.id }); }
    let acc = 0; let n = 0;
    for (let i = 1; i < route.pts.length; i++) {
      acc += distM({ lat: route.pts[i - 1][0], lng: route.pts[i - 1][1] }, { lat: route.pts[i][0], lng: route.pts[i][1] });
      if (acc < 2500) continue; acc = 0;
      const c = chars[n++ % chars.length];
      const pos = offset({ lat: route.pts[i][0], lng: route.pts[i][1] }, 15 + Math.random() * 25, Math.random() * 360);
      emit('gspawns', await store.put('gspawns', rid(), { char: c.id, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), from: 0, until: 9e15, rarity: c.rarity || 'common', trail: true }));
    }
    await store.patch('info', 'main', { gameTrail: key });
  }
  const tick = () => { spawnTick().catch((e) => console.warn('[game] spawn', e.message)); trailSpawns().catch((e) => console.warn('[game] trail', e.message)); };
  setInterval(tick, 45e3);
  setTimeout(() => { spawnTick().catch(() => {}); trailSpawns().catch(() => {}); }, 8000);

  // ----- REST -----
  app.get('/api/game/check', (req, res) => res.json({ enabled: !!PIN, ok: ok(req), models: !!TRIPO_KEY }));
  app.get('/api/game/state', guard, (_req, res) => res.json({
    chars: store.all('gchars').map((c) => lite('gchars', c)),
    spawns: store.all('gspawns').filter((s) => s.trail || s.until > Date.now()),
    catches: store.all('gcatches'),
  }));
  app.get('/api/game/blob/:key', guard, async (req, res) => {
    const key = str(req.params.key, 80); if (!/^g-[\w-]+-(static|idle|wave|thumb|photo)$/.test(key)) return res.status(404).end();
    const b = await store.blobGet(key); if (!b) return res.status(404).end();
    const img = b[0] === 0x89 ? 'image/png' : b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : 'image/jpeg';
    res.set({ 'content-type': key.endsWith('thumb') || key.endsWith('photo') ? img : 'model/gltf-binary', 'cache-control': 'private, max-age=31536000, immutable' }).send(b);
  });
  const charShape = (d) => ({
    ...(d.name !== undefined && { name: str(d.name, 30) }),
    ...(d.husband !== undefined && { husband: str(d.husband, 40) }),
    ...(d.rarity !== undefined && { rarity: RARITY[d.rarity] ? d.rarity : 'common' }),
    ...(d.title !== undefined && { title: str(d.title, 60) }),
    ...(d.move !== undefined && { move: str(d.move, 60) }),
    ...(d.stats !== undefined && { stats: Object.fromEntries(Object.entries(d.stats || {}).slice(0, 4).map(([k, v]) => [str(k, 20), Math.max(0, Math.min(100, Math.round(+v || 0)))])) }),
  });
  app.post('/api/game/chars', guard, async (req, res) => {
    const d = req.body || {};
    const id = rid();
    const b64 = (s) => Buffer.from(String(s).replace(/^data:[^,]+,/, ''), 'base64');
    // A ready-made GLB (e.g. from Avaturn): no Tripo needed
    if (typeof d.glb === 'string' && d.glb.length > 1000) {
      const glb = b64(d.glb);
      if (glb.toString('ascii', 0, 4) !== 'glTF') return res.status(400).json({ error: 'זה לא קובץ GLB' });
      await store.blobPut(`g-${id}-static`, glb);
      if (typeof d.thumb === 'string' && d.thumb.length > 500) await store.blobPut(`g-${id}-thumb`, b64(d.thumb));
      const doc = await store.put('gchars', id, { name: 'דמות', rarity: 'common', stats: {}, ...charShape(d), glb: `g-${id}-static`, thumb: d.thumb ? `g-${id}-thumb` : '', source: 'glb', procedural: true, status: 'ready', progress: 100, tasks: {}, createdAt: Date.now() });
      emit('gchars', doc); setTimeout(tick, 500); return res.json({ ok: true, doc: lite('gchars', doc) });
    }
    if (!TRIPO_KEY) return res.status(503).json({ error: 'חסר TRIPO_API_KEY בשרת' });
    if (typeof d.photo !== 'string' || d.photo.length < 1000) return res.status(400).json({ error: 'חסרה תמונה או קובץ GLB' });
    await store.blobPut(`g-${id}-photo`, Buffer.from(d.photo.replace(/^data:[^,]+,/, ''), 'base64'));
    const doc = await store.put('gchars', id, { name: 'דמות', rarity: 'common', stats: {}, ...charShape(d), photo: `g-${id}-photo`, status: 'queued', progress: 0, tasks: {}, createdAt: Date.now() });
    emit('gchars', doc); pipeline(id);
    res.json({ ok: true, doc: lite('gchars', doc) });
  });
  app.patch('/api/game/chars/:id', guard, async (req, res) => {
    const c = store.get('gchars', str(req.params.id, 40)); if (!c) return res.status(404).json({ error: 'not found' });
    const d = req.body || {}; const patch = charShape(d);
    if (typeof d.thumb === 'string' && d.thumb.length > 500) { await store.blobPut(`g-${c.id}-thumb`, Buffer.from(d.thumb.replace(/^data:[^,]+,/, ''), 'base64')); patch.thumb = `g-${c.id}-thumb`; }
    const doc = await store.patch('gchars', c.id, patch); emit('gchars', doc); res.json({ ok: true, doc: lite('gchars', doc) });
  });
  app.post('/api/game/chars/:id/retry', guard, async (req, res) => {
    const c = store.get('gchars', str(req.params.id, 40)); if (!c) return res.status(404).json({ error: 'not found' });
    // Keep finished steps, drop the one that failed
    const tasks = { ...(c.tasks || {}) }; for (const k of ['model', 'rig', 'idle', 'wave']) if (tasks[k] && !tasks[`${k}Done`]) delete tasks[k];
    if (req.body?.full) for (const k of Object.keys(tasks)) delete tasks[k];
    const doc = await store.patch('gchars', c.id, { tasks, status: 'queued', error: '' }); emit('gchars', doc); pipeline(c.id); res.json({ ok: true });
  });
  const dropChar = async (id) => {
    for (const s of ['static', 'idle', 'wave', 'thumb', 'photo']) await store.blobPut(`g-${id}-${s}`, Buffer.alloc(0)).catch(() => {});
    for (const s of store.all('gspawns').filter((x) => x.char === id)) { await store.del('gspawns', s.id); room.emit('game:remove', { coll: 'gspawns', id: s.id }); }
    await store.del('gchars', id); room.emit('game:remove', { coll: 'gchars', id });
  };
  app.delete('/api/game/chars/:id', guard, async (req, res) => { await dropChar(str(req.params.id, 40)); res.json({ ok: true }); });
  // After the trip: remove every photo, model, spawn and catch
  app.post('/api/game/wipe', guard, async (_req, res) => {
    for (const c of store.all('gchars')) await dropChar(c.id);
    for (const coll of ['gspawns', 'gcatches']) for (const d of store.all(coll)) { await store.del(coll, d.id); room.emit('game:remove', { coll, id: d.id }); }
    res.json({ ok: true });
  });
  app.post('/api/game/catch', guard, async (req, res) => {
    const { spawn, by, player, lat, lng, t } = req.body || {};
    const s = store.get('gspawns', str(spawn, 40)); const p = store.get('people', str(by, 40));
    if (!s || !p) return res.status(404).json({ error: 'הדמות כבר לא פה' });
    const who = str(player, 30) || p.name;
    const when = Number.isFinite(+t) ? Math.min(+t, Date.now()) : Date.now(); // catches made offline arrive later
    if (!s.trail && (when > s.until + 120e3 || when < s.from)) return res.status(410).json({ error: 'הדמות כבר ברחה' });
    if (!Number.isFinite(+lat) || distM({ lat: +lat, lng: +lng }, s) > CATCH_M) return res.status(400).json({ error: 'צריך להתקרב עוד' });
    if (store.all('gcatches').some((x) => x.spawn === s.id && x.by === p.id && x.player === who)) return res.status(409).json({ error: 'כבר תפסת אותה כאן' });
    const c = store.get('gchars', s.char);
    const first = !store.all('gcatches').some((x) => x.char === s.char && x.by === p.id && x.player === who);
    const mom = c?.husband === p.id && who !== p.name; // a kid catching their own mom
    const points = RARITY[s.rarity || 'common'].pts * (first ? 2 : 1) + (mom ? 50 : 0);
    const doc = await store.put('gcatches', rid(), { spawn: s.id, char: s.char, by: p.id, player: who, t: when, points, first, mom });
    emit('gcatches', doc);
    if (c) {
      const news = await store.put('news', null, { text: `${who} תפס/ה את ${c.name}${mom ? ' – את אמא! 💛' : ''} (+${points})`, who: p.id, source: 'game', createdAt: Date.now() });
      io.emit('upsert', { coll: 'news', doc: news, by: p.id });
    }
    res.json({ ok: true, doc });
  });

  io.on('connection', (socket) => {
    socket.on('game:join', (pin, ack) => { if (PIN && String(pin) === PIN) { socket.join('game'); ack?.({ ok: true }); } else ack?.({ ok: false }); });
  });
}
