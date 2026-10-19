import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { Server } from 'socket.io';
import { AccessToken } from 'livekit-server-sdk';
import { createStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const {
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
  APPS_SCRIPT_URL, DRIVE_FOLDER_URL,
} = process.env;

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
  }),
  pins: (d) => ({
    ...(d.name !== undefined && { name: str(d.name, 60) }),
    ...(d.kind !== undefined && { kind: ['camp', 'meet', 'water', 'view', 'other'].includes(d.kind) ? d.kind : 'other' }),
    ...(d.lat !== undefined && { lat: num(d.lat) }),
    ...(d.lng !== undefined && { lng: num(d.lng) }),
  }),
  info: (d) => Object.fromEntries(
    ['title', 'dates', 'start', 'area', 'meeting', 'meetingTime', 'notes']
      .filter((k) => d[k] !== undefined).map((k) => [k, str(d[k], 600)]),
  ),
};

// ---------- REST ----------
app.get('/api/config', (_req, res) => {
  res.json({
    voice: !!(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    photos: !!APPS_SCRIPT_URL,
    driveFolderUrl: DRIVE_FOLDER_URL || '',
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

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 2e5, pingInterval: 20000, pingTimeout: 30000 });

const online = new Map(); // socket.id -> personId
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
      const clean = SHAPES[coll](data || {});
      let doc;
      if (action === 'add' && coll !== 'info') {
        const by = online.get(socket.id) || 'guest';
        const base = coll === 'people'
          ? { name: 'אורח', companions: '', color: '#ff9e4a', avatar: '' }
          : coll === 'tasks' ? { owners: [], note: '', done: false }
            : coll === 'supplies' ? { qty: '', cat: 'כללי', bringer: null, done: false } : {};
        if (coll === 'tasks' && !clean.title) throw new Error('missing title');
        if (coll === 'supplies' && !clean.item) throw new Error('missing item');
        if (coll === 'pins' && (clean.lat == null || clean.lng == null)) throw new Error('missing coords');
        doc = await store.put(coll, null, { ...base, ...clean, createdBy: by, createdAt: Date.now() });
        io.emit('upsert', { coll, doc, by: online.get(socket.id) || null });
      } else if (action === 'patch') {
        doc = coll === 'info' && !store.get('info', 'main')
          ? await store.put('info', 'main', clean)
          : await store.patch(coll, str(id, 40), clean);
        if (!doc) throw new Error('not found');
        io.emit('upsert', { coll, doc, by: online.get(socket.id) || null });
      } else if (action === 'del' && ['tasks', 'supplies', 'pins'].includes(coll)) {
        await store.del(coll, str(id, 40));
        io.emit('remove', { coll, id });
      } else throw new Error('bad action');
      ack?.({ ok: true, doc });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
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
