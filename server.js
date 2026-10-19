import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { Server } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import { createStore } from './store.js';
import { startSheetSync, SHEET_ID, SHEET_GID } from './sheet-sync.js';
import Busboy from 'busboy';
import { parseRouteBytes, fetchRoute, sourceOf } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// Trim env values: pasted keys often carry a trailing newline or space, which breaks token signing
const env = (k) => (process.env[k] || '').trim();
const LIVEKIT_URL = env('LIVEKIT_URL');
const LIVEKIT_API_KEY = env('LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = env('LIVEKIT_API_SECRET');
const APPS_SCRIPT_URL = env('APPS_SCRIPT_URL');
const DRIVE_FOLDER_URL = env('DRIVE_FOLDER_URL');
const ELEVENLABS_API_KEY = env('ELEVENLABS_API_KEY');
const ELEVENLABS_VOICE_ID = env('ELEVENLABS_VOICE_ID');
const ELEVENLABS_MODEL = env('ELEVENLABS_MODEL') || 'eleven_v4';
const ELEVENLABS_BASE = env('ELEVENLABS_API_BASE') || 'https://api.elevenlabs.io';

const store = await createStore();
const app = express();
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', extensions: ['html'] }));

// ---------- helpers ----------
const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(+v) ? +v : null);
const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 20) : []);

// Whitelist of editable fields per collection
const SHAPES = {
  people: (d) => ({
    ...(d.name !== undefined && { name: str(d.name, 40) }),
    ...(d.companions !== undefined && { companions: str(d.companions, 120) }),
    ...(d.color !== undefined && { color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#ff9e4a' }),
    ...(d.avatar !== undefined && {
      avatar: typeof d.avatar === 'string' && (d.avatar.startsWith('data:image/') || d.avatar.startsWith('/avatars/'))
        ? d.avatar.slice(0, 80000) : '',
    }),
    ...(d.phone !== undefined && { phone: str(d.phone, 20) }),
    ...(d.rsvp !== undefined && { rsvp: ['unknown', 'solo', 'with', 'no'].includes(d.rsvp) ? d.rsvp : 'unknown' }),
  }),
  tasks: (d) => ({
    ...(d.title !== undefined && { title: str(d.title, 140) }),
    ...(d.note !== undefined && { note: str(d.note, 500) }),
    ...(d.owners !== undefined && { owners: ids(d.owners) }),
    ...(d.done !== undefined && { done: !!d.done }),
  }),
  supplies: (d) => ({
    ...(d.item !== undefined && { item: str(d.item, 140) }),
    ...(d.qty !== undefined && { qty: str(d.qty, 30) }),
    ...(d.cat !== undefined && { cat: str(d.cat, 30) || 'כללי' }),
    ...(d.bringer !== undefined && { bringer: typeof d.bringer === 'string' ? d.bringer.slice(0, 40) : null }),
    ...(d.done !== undefined && { done: !!d.done }),
    ...(d.scope !== undefined && { scope: d.scope === 'personal' ? 'personal' : 'shared' }),
    ...(d.packedBy !== undefined && { packedBy: ids(d.packedBy) }),
  }),
  pins: (d) => ({
    ...(d.name !== undefined && { name: str(d.name, 60) }),
    ...(d.kind !== undefined && { kind: ['camp', 'meet', 'water', 'view', 'other'].includes(d.kind) ? d.kind : 'other' }),
    ...(d.lat !== undefined && { lat: num(d.lat) }),
    ...(d.lng !== undefined && { lng: num(d.lng) }),
  }),
  // One-line updates taken from the WhatsApp group (written by the scheduled sync)
  news: (d) => ({
    ...(d.text !== undefined && { text: str(d.text, 300) }),
    ...(d.who !== undefined && { who: str(d.who, 40) }),
    ...(d.source !== undefined && { source: str(d.source, 20) }),
  }),
  // Navigation routes: geometry only comes from the import endpoint, here just the name
  routes: (d) => ({
    ...(d.name !== undefined && { name: str(d.name, 80) }),
  }),
  info: (d) => Object.fromEntries(
    ['title', 'dates', 'start', 'area', 'meeting', 'meetingTime', 'notes', 'waLast', 'activeRoute']
      .filter((k) => d[k] !== undefined).map((k) => [k, str(d[k], 600)]),
  ),
};

// ---------- REST ----------
app.get('/api/config', (_req, res) => {
  res.json({
    voice: !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    photos: !!APPS_SCRIPT_URL,
    driveFolderUrl: DRIVE_FOLDER_URL || '',
    tts: !!(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID),
    gearSheet: sheet.status,
  });
});

app.get('/api/state', (_req, res) => res.json(store.snapshot()));

app.get('/api/voice/token', async (req, res) => {
  if (!LIVEKIT_API_KEY) return res.status(503).json({ error: 'voice not configured' });
  const id = str(req.query.id, 40) || `guest-${Date.now()}`;
  const person = store.get('people', id);
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `${id}:${Math.random().toString(36).slice(2, 6)}`,
    name: person?.name || str(req.query.name, 40) || 'אורח',
    ttl: '12h',
  });
  at.addGrant({ room: 'trip-2310', roomJoin: true, canPublish: true, canSubscribe: true });
  res.json({ url: LIVEKIT_URL, token: await at.toJwt() });
});

// Photos are stored in Google Drive through an Apps Script web app (see apps-script/Code.gs)
let photoCache = { at: 0, list: [] };
async function listPhotos(force = false) {
  if (!APPS_SCRIPT_URL) return [];
  if (!force && Date.now() - photoCache.at < 20000) return photoCache.list;
  const r = await fetch(`${APPS_SCRIPT_URL}?action=list`, { redirect: 'follow' });
  const j = await r.json();
  photoCache = { at: Date.now(), list: j.files || [] };
  return photoCache.list;
}

app.get('/api/photos', async (req, res) => {
  try { res.json({ files: await listPhotos(req.query.fresh === '1') }); }
  catch (e) { console.error('[photos] list', e); res.status(502).json({ error: 'drive unavailable', files: photoCache.list }); }
});

app.post('/api/photos', async (req, res) => {
  if (!APPS_SCRIPT_URL) return res.status(503).json({ error: 'photos not configured' });
  const { data, mime, by, name } = req.body || {};
  if (typeof data !== 'string' || data.length < 100) return res.status(400).json({ error: 'no image' });
  const m = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime'].includes(mime) ? mime : 'image/jpeg';
  const who = store.get('people', str(by, 40));
  try {
    const r = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'upload', data, mime: m, by: who?.name || 'אורח', byId: who?.id || '', name: str(name, 80) }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'upload failed');
    photoCache.at = 0;
    io.emit('photos:changed', { by: who?.id || null });
    res.json(j);
  } catch (e) {
    console.error('[photos] upload', e);
    res.status(502).json({ error: 'upload failed' });
  }
});

// ---------- navigation routes ----------
const DEFAULT_ROUTE_URL = env('DEFAULT_ROUTE_URL') || 'https://off-road.io/track/6627619261120512';
async function saveRoute(r, { by, source, url, activate = true }) {
  const who = store.get('people', str(by, 40));
  const doc = await store.put('routes', null, { ...r, source: source || 'file', url: url || '', createdBy: who?.id || 'guest', createdAt: Date.now() });
  io.emit('upsert', { coll: 'routes', doc, by: who?.id || null });
  if (!activate && store.get('info', 'main')?.activeRoute && store.get('routes', store.get('info', 'main').activeRoute)) return doc;
  // The newest route becomes the active one
  const infoDoc = store.get('info', 'main') ? await store.patch('info', 'main', { activeRoute: doc.id }) : await store.put('info', 'main', { activeRoute: doc.id });
  io.emit('upsert', { coll: 'info', doc: infoDoc, by: who?.id || null });
  return doc;
}
// Load the trip's default route once (deleting it later is respected). Retries until the source answers.
async function ensureDefaultRoute() {
  if (!DEFAULT_ROUTE_URL || store.get('info', 'main')?.defaultRouteUrl === DEFAULT_ROUTE_URL) return;
  if (store.all('routes').some((r) => r.url === DEFAULT_ROUTE_URL)) return;
  try {
    const doc = await saveRoute(await fetchRoute(DEFAULT_ROUTE_URL), { source: sourceOf(DEFAULT_ROUTE_URL), url: DEFAULT_ROUTE_URL, activate: false });
    const infoDoc = store.get('info', 'main') ? await store.patch('info', 'main', { defaultRouteUrl: DEFAULT_ROUTE_URL }) : await store.put('info', 'main', { defaultRouteUrl: DEFAULT_ROUTE_URL });
    io.emit('upsert', { coll: 'info', doc: infoDoc, by: null });
    console.log(`[routes] default route loaded: ${doc.name} (${doc.km} km)`);
  } catch (e) {
    console.warn('[routes] default route failed, retrying in 10 min:', e.message);
    setTimeout(ensureDefaultRoute, 10 * 60e3);
  }
}
setTimeout(ensureDefaultRoute, 3000);

const ROUTE_HELP = {
  amudanan: 'בעמוד ענן: פותחים את המסלול ← שמירה/ייצוא ← GPX, ומעלים כאן את הקובץ.',
  offroad: 'באוף רוד: פותחים את המסלול ← שיתוף ← ייצוא קובץ GPX או KML, ומעלים כאן את הקובץ.',
};
app.post('/api/routes/import', async (req, res) => {
  const { url, file, filename, by } = req.body || {};
  try {
    let r; let source = 'file';
    if (typeof url === 'string' && url.trim()) { source = sourceOf(url); r = await fetchRoute(url); }
    else if (typeof file === 'string' && file.length) r = parseRouteBytes(Buffer.from(file, 'base64'), str(filename, 80).replace(/\.[a-z]+$/i, ''));
    else return res.status(400).json({ error: 'צריך קישור או קובץ' });
    res.json({ ok: true, doc: await saveRoute(r, { by, source, url: source === 'file' ? '' : str(url, 500) }) });
  } catch (e) {
    const src = typeof url === 'string' ? sourceOf(url) : '';
    const msg = e.code === 'NOFILE'
      ? `לא הצלחתי לקרוא מסלול מהקישור הזה. ${ROUTE_HELP[src] || 'ייצאו מהאפליקציה קובץ GPX או KML והעלו אותו כאן.'}`
      : e.name === 'TimeoutError' ? 'הקישור לא ענה בזמן' : e.message;
    console.warn('[routes] import failed', e.message);
    res.status(422).json({ error: msg });
  }
});
// PWA share target: on Android, share a GPX/KML file or a link straight from Amud Anan / Off-Road to the app
app.post('/share-target', (req, res) => {
  const fields = {}; const files = [];
  let bb;
  try { bb = Busboy({ headers: req.headers, limits: { fileSize: 15e6, files: 3 } }); } catch { return res.redirect(303, '/#/map'); }
  bb.on('field', (k, v) => { fields[k] = v; });
  bb.on('file', (_k, stream, info) => { const chunks = []; stream.on('data', (c) => chunks.push(c)); stream.on('end', () => files.push({ name: info.filename, buf: Buffer.concat(chunks) })); });
  bb.on('close', async () => {
    let ok = false;
    for (const f of files) { try { await saveRoute(parseRouteBytes(f.buf, (f.name || '').replace(/\.[a-z]+$/i, '')), { source: 'file' }); ok = true; break; } catch { /* next */ } }
    const link = [fields.url, fields.text, fields.title].join(' ').match(/https?:\/\/\S+/)?.[0];
    if (!ok && link) { try { await saveRoute(await fetchRoute(link), { source: sourceOf(link), url: link }); ok = true; } catch { /* fall through */ } }
    res.redirect(303, ok ? '/#/map?route=ok' : `/#/map?route=fail${link ? `&link=${encodeURIComponent(link)}` : ''}`);
  });
  req.pipe(bb);
});

// Narration of place overviews with an ElevenLabs voice. Each text is generated once and cached.
const { PLACES, REGIONS } = await import('./public/places.js');
const ttsInflight = new Map();
app.get('/api/tts', async (req, res) => {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) return res.status(503).json({ error: 'tts not configured' });
  const subject = PLACES.find((p) => p.id === req.query.place) || REGIONS.find((g) => g.id === req.query.place);
  const part = ['geo', 'history', 'kids', 'all'].includes(req.query.part) ? req.query.part : 'geo';
  if (!subject) return res.status(404).json({ error: 'unknown place' });
  const text = part === 'all' ? `${subject.name}. ${subject.geo} ${subject.history} ${subject.kids}` : `${subject.name}. ${subject[part]}`;
  const key = 'tts-' + crypto.createHash('sha1').update([ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL, text].join('|')).digest('hex');
  try {
    let mp3 = await store.blobGet(key);
    if (!mp3) {
      if (!ttsInflight.has(key)) {
        ttsInflight.set(key, (async () => {
          const r = await fetch(`${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_96`, {
            method: 'POST',
            headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
            body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL, language_code: 'he' }),
          });
          if (!r.ok) throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
          const buf = Buffer.from(await r.arrayBuffer());
          await store.blobPut(key, buf);
          return buf;
        })().finally(() => setTimeout(() => ttsInflight.delete(key), 1000)));
      }
      mp3 = await ttsInflight.get(key);
    }
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(mp3);
  } catch (e) {
    console.error('[tts]', e.message);
    res.status(502).json({ error: 'tts failed' });
  }
});

app.get('/healthz', (_req, res) => res.send('ok'));

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 2e5, pingInterval: 20000, pingTimeout: 30000 });

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const online = new Map(); // socket.id -> personId
const sheet = startSheetSync({ store, io });

async function callScript(body) {
  if (!APPS_SCRIPT_URL) throw new Error('script not configured');
  const r = await fetch(APPS_SCRIPT_URL, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, sheetId: SHEET_ID, gid: SHEET_GID }),
  });
  const j = await r.json().catch(() => ({ ok: false, error: 'bad script response' }));
  if (!j.ok) {
    const msg = /permission|הרשאה|access|You do not have/i.test(j.error || '') ? 'אין הרשאת עריכה לגיליון' : j.error === 'row changed' ? 'השורה בגיליון השתנתה – נסו שוב' : (j.error || 'שגיאה');
    throw new Error(msg);
  }
  return j;
}
const nameFor = (id) => (store.get('people', id)?.name || '').trim().split(/\s+/)[0];
const broadcastPresence = () => io.emit('presence', [...new Set(online.values())]);

io.on('connection', (socket) => {
  socket.emit('state', store.snapshot());
  broadcastPresence();

  socket.on('hello', (personId) => {
    if (typeof personId === 'string') { online.set(socket.id, personId.slice(0, 40)); broadcastPresence(); }
  });

  socket.on('op', async ({ coll, action, id, data } = {}, ack) => {
    try {
      if (!SHAPES[coll]) throw new Error('bad collection');
      if (coll === 'routes' && action === 'add') throw new Error('routes are added by import');
      const clean = SHAPES[coll](data || {});
      let doc;
      if (action === 'add' && coll !== 'info') {
        const by = online.get(socket.id) || 'guest';
        const base = coll === 'people'
          ? { name: 'אורח', companions: '', color: '#ff9e4a', avatar: '' }
          : coll === 'tasks' ? { owners: [], note: '', done: false }
            : coll === 'supplies' ? { qty: '', cat: 'כללי', bringer: null, done: false, scope: 'shared', packedBy: [] } : {};
        if (coll === 'tasks' && !clean.title) throw new Error('missing title');
        if (coll === 'supplies' && !clean.item) throw new Error('missing item');
        if (coll === 'pins' && (clean.lat == null || clean.lng == null)) throw new Error('missing coords');
        if (coll === 'news' && !clean.text) throw new Error('missing text');
        doc = await store.put(coll, null, { ...base, ...clean, createdBy: by, createdAt: Date.now() });
        io.emit('upsert', { coll, doc, by: online.get(socket.id) || null });
      } else if (action === 'patch') {
        doc = coll === 'info' && !store.get('info', 'main')
          ? await store.put('info', 'main', clean)
          : await store.patch(coll, str(id, 40), clean);
        if (!doc) throw new Error('not found');
        io.emit('upsert', { coll, doc, by: online.get(socket.id) || null });
      } else if (action === 'del' && coll === 'people') {
        // Remove a participant and clear them from everything that points at them
        const pid = str(id, 40);
        if (!store.get('people', pid)) throw new Error('not found');
        const by = online.get(socket.id) || null;
        for (const t of store.all('tasks')) if (t.owners?.includes(pid)) {
          io.emit('upsert', { coll: 'tasks', doc: await store.patch('tasks', t.id, { owners: t.owners.filter((x) => x !== pid) }), by });
        }
        for (const g of store.all('supplies')) if (g.bringer === pid || g.packedBy?.includes(pid)) {
          io.emit('upsert', { coll: 'supplies', doc: await store.patch('supplies', g.id, { bringer: g.bringer === pid ? null : g.bringer, packedBy: (g.packedBy || []).filter((x) => x !== pid) }), by });
        }
        if (store.get('locations', pid)) { await store.del('locations', pid); io.emit('remove', { coll: 'locations', id: pid }); }
        await store.del('people', pid);
        io.emit('remove', { coll: 'people', id: pid });
      } else if (action === 'del' && ['tasks', 'supplies', 'pins', 'news', 'routes'].includes(coll)) {
        await store.del(coll, str(id, 40));
        io.emit('remove', { coll, id });
      } else throw new Error('bad action');
      ack?.({ ok: true, doc });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  // Atomic add/remove of one id in an array field (who packed an item, who owns a task)
  const TOGGLES = { supplies: ['packedBy'], tasks: ['owners'] };
  socket.on('toggle', async ({ coll, id, field, value } = {}, ack) => {
    try {
      if (!TOGGLES[coll]?.includes(field) || typeof value !== 'string') throw new Error('bad toggle');
      const cur = store.get(coll, str(id, 40));
      if (!cur) throw new Error('not found');
      const arr = Array.isArray(cur[field]) ? cur[field] : [];
      const next = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value.slice(0, 40)];
      const doc = await store.patch(coll, cur.id, { [field]: next });
      io.emit('upsert', { coll, doc, by: online.get(socket.id) || null });
      ack?.({ ok: true, doc });
    } catch (e) { ack?.({ ok: false, error: e.message }); }
  });

  // Two-way gear sheet: write my name into an "אחראי" cell, or add an item to the first empty cell of a column
  socket.on('gear:claim', async ({ id, on } = {}, ack) => {
    try {
      const me = online.get(socket.id); if (!me) throw new Error('מי אתה?');
      const g = store.get('supplies', str(id, 40));
      if (!g || g.source !== 'sheet') throw new Error('not found');
      if (!g.sheetRespCol) throw new Error('לפריט הזה אין עמודת אחראי בגיליון');
      await callScript({ action: 'sheetClaim', row: g.sheetRow, col: g.sheetCol, respCol: g.sheetRespCol, item: g.item, name: nameFor(me), on: !!on });
      await sheet.sync();
      ack?.({ ok: true });
    } catch (e) { ack?.({ ok: false, error: e.message }); }
  });
  socket.on('gear:add', async ({ col, text } = {}, ack) => {
    try {
      const c = (sheet.status.columns || []).find((x) => x.col === Number(col));
      if (!c) throw new Error('עמודה לא קיימת בגיליון');
      if (!str(text, 140)) throw new Error('missing item');
      await callScript({ action: 'sheetAdd', col: c.col, headerRow: c.headerRow, text: str(text, 140) });
      await sheet.sync();
      ack?.({ ok: true });
    } catch (e) { ack?.({ ok: false, error: e.message }); }
  });

  socket.on('loc', async (p = {}) => {
    const personId = online.get(socket.id);
    const lat = num(p.lat); const lng = num(p.lng);
    if (!personId || lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const doc = await store.put('locations', personId, {
      lat, lng, acc: num(p.acc), heading: num(p.heading), speed: num(p.speed), battery: num(p.battery), t: Date.now(), sharing: true,
    });
    io.emit('upsert', { coll: 'locations', doc });
  });

  socket.on('loc:stop', async () => {
    const personId = online.get(socket.id);
    if (!personId) return;
    const doc = await store.patch('locations', personId, { sharing: false });
    if (doc) io.emit('upsert', { coll: 'locations', doc });
  });

  socket.on('disconnect', () => { online.delete(socket.id); broadcastPresence(); });
});

server.listen(PORT, () => console.log(`trip-2310 listening on :${PORT}`));
