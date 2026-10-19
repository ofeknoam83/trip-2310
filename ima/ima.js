// IMA push-to-talk, mounted at /ima on the same service.
// Separate LiveKit room and a separate roster ("ima_people" in the same store).
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { imaPeople } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLES = ['מוקד', 'רופא/ה', 'ייעוץ', 'אחות/אח', 'פרמדיק/ית', 'אחר'];
const COLL = 'ima_people';
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
function clean(d = {}) {
  const out = {};
  if (d.name !== undefined) out.name = str(d.name, 40);
  if (d.role !== undefined) out.role = ROLES.includes(d.role) ? d.role : 'אחר';
  if (d.avatar !== undefined) out.avatar = typeof d.avatar === 'string' && (d.avatar.startsWith('data:image/') || /^\/ima\/avatars\/[a-z0-9-]+\.jpg$/.test(d.avatar)) ? d.avatar.slice(0, 60000) : '';
  return out;
}

export function mountIma({ app, io, store, livekit }) {
  const room = (process.env.IMA_LIVEKIT_ROOM || 'ima-ptt').trim();
  const list = () => store.all(COLL).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  // Seed the roster once, only if it is empty
  if (!store.all(COLL).length) {
    let t = Date.now();
    for (const p of imaPeople) store.put(COLL, null, { ...p, avatar: p.avatar || '', createdAt: t++ });
    console.log(`[ima] seeded ${imaPeople.length} people`);
  }

  app.use('/ima', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
  app.get('/ima/api/config', (_q, r) => r.json({ voice: !!(livekit.url && livekit.key && livekit.secret), roles: ROLES }));
  app.get('/ima/api/token', async (req, res) => {
    if (!livekit.key) return res.status(503).json({ error: 'voice not configured' });
    const p = store.get(COLL, str(req.query.id, 40));
    if (!p) return res.status(404).json({ error: 'unknown user' });
    const at = new AccessToken(livekit.key, livekit.secret, {
      identity: `${p.id}:${crypto.randomBytes(2).toString('hex')}`, name: p.name, ttl: '12h', metadata: JSON.stringify({ role: p.role }),
    });
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    res.json({ url: livekit.url, token: await at.toJwt() });
  });
  app.get('/ima/*', (_q, r) => r.sendFile(path.join(__dirname, 'public', 'index.html')));

  const nsp = io.of('/ima');
  nsp.on('connection', (s) => {
    s.emit('people', list());
    s.on('person:add', async (d, ack) => {
      const c = clean(d);
      if (!c.name) return ack?.({ ok: false, error: 'חסר שם' });
      const p = await store.put(COLL, null, { role: 'אחר', avatar: '', ...c, createdAt: Date.now() });
      nsp.emit('people', list()); ack?.({ ok: true, person: p });
    });
    s.on('person:update', async ({ id, ...d } = {}, ack) => {
      const p = await store.patch(COLL, str(id, 40), clean(d));
      if (!p) return ack?.({ ok: false, error: 'not found' });
      nsp.emit('people', list()); ack?.({ ok: true, person: p });
    });
    s.on('person:remove', async ({ id } = {}, ack) => {
      await store.del(COLL, str(id, 40)); nsp.emit('people', list()); ack?.({ ok: true });
    });
  });
}
