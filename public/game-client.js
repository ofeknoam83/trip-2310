// "Wife GO" – client. AR catch screen (camera + gyro-anchored 3D model), radar, collection, leaderboard, character admin.
const RAR = { common: { name: 'רגילה', color: '#7fe0d2', chance: 0.75, pts: 10 }, rare: { name: 'נדירה', color: '#ffb36b', chance: 0.55, pts: 30 }, legendary: { name: 'אגדית', color: '#ff6b8b', chance: 0.35, pts: 100 } };
const STATUS = { queued: 'בתור', upload: 'מעלה תמונה', model: 'בונה מודל תלת־ממד', rig: 'מוסיף שלד', anim: 'מוסיף תנועה', ready: 'מוכנה', failed: 'נכשל' };
const NEAR_M = 40;
const CACHE = 'trip-game-v1';

export function initGame(ctx) {
  const { $, $$, esc, toast, openSheet, closeSheet, av, person, firstName, ls, socket } = ctx;
  let pin = ls.get('trip.gamepin') || '';
  let unlocked = false; let info = { enabled: false, models: false };
  const G = { gchars: new Map(), gspawns: new Map(), gcatches: new Map() };
  let player = ls.get('trip.gameplayer') || '';
  let pos = null; let watch = null; let heading = null;
  let view = 'radar';
  let mapLayer = null;

  const me = () => ctx.getMe();
  const players = () => { const p = person(me()); return p ? [p.name, ...ctx.partyOf(p).map((m) => m.name).filter(Boolean)] : []; };
  const curPlayer = () => (players().includes(player) ? player : players()[0] || '');
  const blobUrl = (key) => `/api/game/blob/${encodeURIComponent(key)}?pin=${encodeURIComponent(pin)}`;
  const api = (path, opt = {}) => fetch(path, { ...opt, headers: { 'content-type': 'application/json', 'x-game-pin': pin, ...(opt.headers || {}) } });
  const dist = (a, b) => ctx.distKm(a, b) * 1000;
  const bearing = (a, b) => { const r = Math.PI / 180; const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r); const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r); return (Math.atan2(y, x) / r + 360) % 360; };
  const ready = () => [...G.gchars.values()].filter((c) => c.status === 'ready' && c.glb);
  const myCatches = () => [...G.gcatches.values()].filter((c) => c.by === me() && c.player === curPlayer());
  const caughtChar = (id) => myCatches().some((c) => c.char === id);
  const caughtSpawn = (id) => myCatches().some((c) => c.spawn === id);
  const liveSpawns = () => [...G.gspawns.values()].filter((s) => (s.trail || s.until > Date.now()) && G.gchars.get(s.char)?.status === 'ready' && !caughtSpawn(s.id));

  // ---------- unlock & sync ----------
  async function check() {
    try { info = await (await api('/api/game/check')).json(); } catch { /* offline */ }
    unlocked = !!info.ok;
    if (unlocked) { socket.emit('game:join', pin); await load(); }
    render(); ctx.onReady?.();
  }
  async function load() {
    try {
      const r = await api('/api/game/state'); if (!r.ok) return;
      const j = await r.json();
      for (const [k, list] of [['gchars', j.chars], ['gspawns', j.spawns], ['gcatches', j.catches]]) { G[k].clear(); for (const d of list) G[k].set(d.id, d); }
      ls.set('trip.gamecache', JSON.stringify(j));
      prefetch();
    } catch {
      const c = ls.get('trip.gamecache'); if (c) { const j = JSON.parse(c); for (const [k, list] of [['gchars', j.chars], ['gspawns', j.spawns], ['gcatches', j.catches]]) for (const d of list) G[k].set(d.id, d); }
    }
    flushQueue(); render(); drawMap();
  }
  socket.on('connect', () => { if (unlocked) { socket.emit('game:join', pin); load(); } });
  socket.on('game:upsert', ({ coll, doc }) => { G[coll]?.set(doc.id, doc); if (coll === 'gchars' && doc.status === 'ready') prefetch(); render(); drawMap(); });
  socket.on('game:remove', ({ coll, id }) => { G[coll]?.delete(id); render(); drawMap(); });

  // Keep the 3D models on the phone so the game works without reception
  async function prefetch() {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(CACHE);
      for (const c of ready()) for (const k of [c.glb, c.glbWave, c.thumb].filter(Boolean)) {
        const url = blobUrl(k); if (!(await cache.match(url))) { const r = await fetch(url); if (r.ok) await cache.put(url, r); }
      }
    } catch { /* storage full or private mode */ }
  }
  async function getBlobUrl(key) {
    const url = blobUrl(key);
    try { const cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return URL.createObjectURL(await hit.blob()); } catch { /* no cache */ }
    return url;
  }

  // Catches made without reception wait in a queue
  const queue = () => { try { return JSON.parse(ls.get('trip.gamequeue') || '[]'); } catch { return []; } };
  async function flushQueue() {
    const q = queue(); if (!q.length) return;
    const left = [];
    for (const c of q) {
      try { const r = await api('/api/game/catch', { method: 'POST', body: JSON.stringify(c) }); if (r.status >= 500 || r.status === 0) left.push(c); } catch { left.push(c); }
    }
    ls.set('trip.gamequeue', left.length ? JSON.stringify(left) : null);
  }
  setInterval(() => { if (unlocked && navigator.onLine) flushQueue(); }, 30000);

  // ---------- location ----------
  function track(on) {
    if (on && !watch && navigator.geolocation) {
      watch = navigator.geolocation.watchPosition((p) => { pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; renderRadar(); }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    } else if (!on && watch != null) { navigator.geolocation.clearWatch(watch); watch = null; }
  }
  window.addEventListener('deviceorientationabsolute', (e) => { if (e.alpha != null) heading = 360 - e.alpha; }, true);
  window.addEventListener('deviceorientation', (e) => { if (e.webkitCompassHeading != null) heading = e.webkitCompassHeading; }, true);
  const herePos = () => pos || ctx.getPos();

  // ---------- render ----------
  function render() {
    const root = $('#sec-game'); if (!root) return;
    if (!info.enabled && !unlocked) { root.innerHTML = `${head()}<div class="panel"><p class="muted" style="margin:0">המשחק יופעל אחרי שמגדירים קוד טיול (GAME_PIN) בשרת.</p></div>`; return; }
    if (!unlocked) {
      root.innerHTML = `${head()}<div class="panel go-lock"><div class="go-logo">🔒</div><p>המשחק נעול בקוד של הטיול.</p>
        <form id="go-pin"><input class="input" name="p" inputmode="numeric" autocomplete="off" placeholder="קוד הטיול" maxlength="12"><button class="btn">כניסה</button></form></div>`;
      $('#go-pin', root).onsubmit = async (e) => { e.preventDefault(); pin = e.target.p.value.trim(); await check(); if (unlocked) ls.set('trip.gamepin', pin); else toast('קוד שגוי'); };
      return;
    }
    const pts = myCatches().reduce((a, c) => a + (c.points || 0), 0);
    root.innerHTML = `${head()}
      <div class="panel go-player">
        <div class="chips">${players().map((n) => `<button class="chip" data-pl="${esc(n)}" aria-pressed="${n === curPlayer()}">${esc(n)}</button>`).join('')}</div>
        <div class="go-score"><b>${pts}</b><span>נקודות ל${esc(curPlayer())}</span><b>${new Set(myCatches().map((c) => c.char)).size}/${ready().length}</b><span>נתפסו</span></div>
      </div>
      <div class="seg" style="margin:0 0 12px">${[['radar', 'מסביבי'], ['dex', 'האוסף'], ['board', 'טבלה'], ['admin', 'דמויות']].map(([k, l]) => `<button data-gv="${k}" aria-pressed="${view === k}">${l}</button>`).join('')}</div>
      <div id="go-body"></div>`;
    $$('[data-pl]', root).forEach((b) => (b.onclick = () => { player = b.dataset.pl; ls.set('trip.gameplayer', player); render(); }));
    $$('[data-gv]', root).forEach((b) => (b.onclick = () => { view = b.dataset.gv; render(); }));
    ({ radar: renderRadar, dex: renderDex, board: renderBoard, admin: renderAdmin })[view]();
  }
  const head = () => '<h1 class="page-title go-title">Wife <span>GO</span></h1><p class="page-sub">מוצאים את הנשים בשטח, מכוונים את המצלמה ותופסים.</p>';

  function renderRadar() {
    const el = $('#go-body'); if (!el || view !== 'radar' || !unlocked) return;
    const here = herePos();
    const list = liveSpawns().map((s) => ({ s, c: G.gchars.get(s.char), d: here ? dist(here, s) : null })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)).slice(0, 12);
    el.innerHTML = `
      <div class="panel">
        ${!here ? '<p class="muted" style="margin:0 0 10px">מחפש מיקום… אפשרו מיקום כדי לראות מי קרובה.</p>' : ''}
        ${list.length ? list.map(({ s, c, d }) => {
          const near = d != null && d <= NEAR_M; const r = RAR[s.rarity] || RAR.common;
          const dir = here && d != null ? bearing(here, s) - (heading ?? 0) : 0;
          return `<div class="who-row go-spawn ${near ? 'near' : ''}" style="--rc:${r.color}">
            <span class="go-thumb ${caughtChar(c.id) ? '' : 'unknown'}">${c.thumb ? `<img src="${blobUrl(c.thumb)}" alt="">` : '❓'}</span>
            <div class="grow"><b>${caughtChar(c.id) ? esc(c.name) : '???'}</b><small><span style="color:${r.color}">${r.name}</span>${s.trail ? ' · על הציר' : s.until < 9e15 ? ` · עוד ${Math.max(1, Math.round((s.until - Date.now()) / 60e3))} דק׳` : ''}</small></div>
            ${d != null ? `<span class="go-dist"><i style="transform:rotate(${heading == null ? bearing(here, s) : dir}deg)">⬆</i>${d < 1000 ? `${Math.round(d)} מ׳` : `${(d / 1000).toFixed(1)} ק״מ`}</span>` : ''}
            <button class="btn small ${near ? '' : 'ghost'}" data-catch="${esc(s.id)}" ${near ? '' : 'disabled'}>${near ? 'לתפוס!' : 'רחוק'}</button>
          </div>`;
        }).join('') : `<p class="muted" style="margin:0">${ready().length ? 'אין כרגע אף אחת בסביבה. הן מופיעות ליד הקבוצה, ליד נקודות במפה ולאורך הציר.' : 'עוד אין דמויות. מוסיפים אותן בלשונית "דמויות".'}</p>`}
      </div>
      <button class="btn ghost block" id="go-practice">🎯 תרגול – דמות מול המצלמה (בלי נקודות)</button>`;
    $$('[data-catch]', el).forEach((b) => (b.onclick = () => { const s = G.gspawns.get(b.dataset.catch); if (s) openAR(G.gchars.get(s.char), s); }));
    $('#go-practice', el)?.addEventListener('click', () => {
      const r = ready();
      if (!r.length) { toast('קודם מוסיפים דמות בלשונית "דמויות"'); view = 'admin'; render(); return; }
      openAR(r[Math.floor(Math.random() * r.length)], null);
    });
  }

  function renderDex() {
    const el = $('#go-body'); if (!el) return;
    const chars = [...G.gchars.values()].filter((c) => c.status === 'ready');
    el.innerHTML = `<div class="go-dex">${chars.map((c) => {
      const got = caughtChar(c.id); const r = RAR[c.rarity] || RAR.common;
      return `<button class="go-card ${got ? '' : 'locked'}" data-card="${esc(c.id)}" style="--rc:${r.color}">
        <span class="go-thumb big ${got ? '' : 'unknown'}">${c.thumb ? `<img src="${blobUrl(c.thumb)}" alt="">` : '❓'}</span>
        <b>${got ? esc(c.name) : '???'}</b><small>${r.name}</small></button>`;
    }).join('') || '<p class="muted">עוד אין דמויות מוכנות.</p>'}</div>`;
    $$('[data-card]', el).forEach((b) => (b.onclick = () => cardSheet(G.gchars.get(b.dataset.card))));
  }

  function cardSheet(c) {
    const got = caughtChar(c.id); const r = RAR[c.rarity] || RAR.common; const h = person(c.husband);
    const n = [...G.gcatches.values()].filter((x) => x.char === c.id).length;
    openSheet(`<div class="go-sheet" style="--rc:${r.color}">
      <div class="go-view" id="go-view"></div>
      <h3>${got ? esc(c.name) : '???'}</h3>
      <p class="small muted" style="margin:-6px 0 10px">${r.name}${got && c.title ? ` · ${esc(c.title)}` : ''}${got && h ? ` · של ${esc(firstName(h))}` : ''} · נתפסה ${n} פעמים</p>
      ${got ? `${Object.entries(c.stats || {}).map(([k, v]) => `<div class="go-stat"><span>${esc(k)}</span><i><b style="width:${v}%"></b></i><em>${v}</em></div>`).join('')}
        ${c.move ? `<p><b>מהלך מיוחד:</b> ${esc(c.move)}</p>` : ''}` : '<p class="muted">תפסו אותה כדי לפתוח את הכרטיס.</p>'}
      <div class="actions"><button class="btn ghost" data-close>סגירה</button></div></div>`, (root) => { if (got) viewer($('#go-view', root), c); });
  }

  function renderBoard() {
    const el = $('#go-body'); if (!el) return;
    const rows = new Map();
    for (const c of G.gcatches.values()) {
      const k = `${c.by}|${c.player}`; const r = rows.get(k) || { by: c.by, player: c.player, pts: 0, n: 0, chars: new Set(), mom: false };
      r.pts += c.points || 0; r.n++; r.chars.add(c.char); r.mom ||= !!c.mom; rows.set(k, r);
    }
    const list = [...rows.values()].sort((a, b) => b.pts - a.pts);
    const fam = new Map(); for (const r of list) fam.set(r.by, (fam.get(r.by) || 0) + r.pts);
    el.innerHTML = `<div class="panel"><div class="panel-head"><h2>שחקנים</h2></div>
      ${list.length ? list.map((r, i) => `<div class="who-row">${i < 3 ? `<span class="go-medal">${['🥇', '🥈', '🥉'][i]}</span>` : `<span class="go-medal">${i + 1}</span>`}
        <div class="grow"><b>${esc(r.player)}${r.mom ? ' 💛' : ''}</b><small>${esc(firstName(person(r.by)))} · ${r.chars.size} דמויות · ${r.n} תפיסות</small></div><b class="amt">${r.pts}</b></div>`).join('') : '<p class="muted" style="margin:0">עוד אף אחד לא תפס.</p>'}
      </div>
      ${fam.size ? `<div class="panel"><div class="panel-head"><h2>משפחות</h2></div>${[...fam].sort((a, b) => b[1] - a[1]).map(([id, p]) => `<div class="who-row">${av(person(id), 32)}<div class="grow"><b>${esc(firstName(person(id)))}</b></div><b class="amt">${p}</b></div>`).join('')}</div>` : ''}`;
  }

  function renderAdmin() {
    const el = $('#go-body'); if (!el) return;
    const chars = [...G.gchars.values()].sort((a, b) => a.createdAt - b.createdAt);
    el.innerHTML = `<div class="panel">
      <div class="panel-head"><h2>דמויות</h2><button class="btn small" id="go-add">+ דמות</button></div>
      ${chars.map((c) => `<div class="who-row">
        <span class="go-thumb">${c.thumb ? `<img src="${blobUrl(c.thumb)}" alt="">` : c.photo ? `<img src="${blobUrl(c.photo)}" alt="">` : '❓'}</span>
        <div class="grow"><b>${esc(c.name)}</b><small>${STATUS[c.status] || c.status}${c.status !== 'ready' && c.status !== 'failed' ? ` · ${c.progress || 0}%` : ''}${c.error ? ` · ${esc(c.error)}` : ''}${c.status === 'ready' && c.source !== 'glb' && !c.glbWave ? ' · בלי אנימציה' : ''}${c.source === 'glb' ? ' · GLB' : ''}</small></div>
        ${c.status === 'failed' ? `<button class="btn small" data-retry="${esc(c.id)}">שוב</button>` : ''}
        ${c.status === 'ready' ? `<button class="btn small ${narratorId === c.id ? 'teal' : 'ghost'}" data-narr="${esc(c.id)}" title="מופיע כשמקריאים סקירה">🎙️</button>` : ''}
        <button class="btn small ghost" data-edit="${esc(c.id)}">עריכה</button>
      </div>`).join('') || '<p class="muted" style="margin:0">הוסיפו כל אחת – קובץ GLB מ־Avaturn, או תמונה של גוף מלא שתהפוך למודל ב־Tripo (כמה דקות).</p>'}
      </div>
      <button class="btn danger block" id="go-wipe">מחיקת כל התמונות והמודלים (אחרי הטיול)</button>`;
    $('#go-add', el)?.addEventListener('click', () => charSheet(null));
    $$('[data-edit]', el).forEach((b) => (b.onclick = () => charSheet(G.gchars.get(b.dataset.edit))));
    $$('[data-narr]', el).forEach((b) => (b.onclick = async () => {
      const off = narratorId === b.dataset.narr;
      const r = await api('/api/game/narrator', { method: 'POST', body: JSON.stringify({ id: off ? null : b.dataset.narr }) }); const j = await r.json().catch(() => ({}));
      narratorId = j.narrator || null; narrInfo = null; toast(narratorId ? `${esc(G.gchars.get(narratorId)?.name || '')} יקריא את הסקירות 🎙️` : 'בלי קריין על המסך'); renderAdmin();
    }));
    $$('[data-retry]', el).forEach((b) => (b.onclick = () => api(`/api/game/chars/${b.dataset.retry}/retry`, { method: 'POST', body: '{}' })));
    $('#go-wipe', el).onclick = (e) => { if (ctx.confirmInline(e.currentTarget)) api('/api/game/wipe', { method: 'POST', body: '{}' }).then(() => toast('הכול נמחק')); };
  }

  function charSheet(c) {
    const isNew = !c; const d = c || { name: '', husband: me(), rarity: 'common', title: '', move: '', stats: { 'סבלנות': 70, 'מדורה': 70, 'ניווט': 70 } };
    let photo = '';
    const people = ctx.getPeople();
    openSheet(`<h3>${isNew ? 'דמות חדשה' : esc(d.name)}</h3><form id="f">
      ${isNew ? `<div class="seg" id="src" style="margin:0 0 12px"><button type="button" data-s="glb" aria-pressed="true">קובץ GLB (Avaturn)</button><button type="button" data-s="photo" aria-pressed="false" ${info.models ? '' : 'disabled'}>תמונה → Tripo</button></div>
        <label class="field" id="f-glb"><span>קובץ GLB</span><input type="file" accept=".glb,model/gltf-binary" id="gl"></label>
        <label class="field" id="f-photo" hidden><span>תמונה (גוף מלא, מלפנים)</span><input type="file" accept="image/*" id="ph"></label><div id="ph-prev"></div>` : ''}
      <div class="grid2">
        <label class="field"><span>שם</span><input class="input" name="name" value="${esc(d.name)}" maxlength="30" required></label>
        <label class="field"><span>נשואה ל</span><select class="input" name="husband">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === d.husband ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>נדירות</span><select class="input" name="rarity">${Object.entries(RAR).map(([k, r]) => `<option value="${k}" ${d.rarity === k ? 'selected' : ''}>${r.name}</option>`).join('')}</select></label>
        <label class="field"><span>תואר</span><input class="input" name="title" value="${esc(d.title || '')}" maxlength="60" placeholder="מלכת השטח"></label>
      </div>
      <label class="field"><span>מהלך מיוחד</span><input class="input" name="move" value="${esc(d.move || '')}" maxlength="60" placeholder="מבט אחד ששולח לישון"></label>
      <div class="grid2">${Object.entries(d.stats || {}).slice(0, 4).map(([k, v], i) => `<label class="field"><span><input class="input mini-in" name="sk${i}" value="${esc(k)}" maxlength="20"></span><input class="input" name="sv${i}" type="number" min="0" max="100" value="${v}"></label>`).join('')}</div>
      <div class="actions"><button class="btn" type="submit">${isNew ? 'בניית דמות' : 'שמירה'}</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
      ${isNew ? '' : '<button class="btn danger block" type="button" id="del" style="margin-top:10px">מחיקת הדמות</button>'}
    </form>`, (root) => {
      let src = 'glb'; let glb = ''; let thumb = '';
      $$('#src button', root).forEach((bt) => (bt.onclick = () => { src = bt.dataset.s; $$('#src button', root).forEach((x) => x.setAttribute('aria-pressed', x === bt)); $('#f-glb', root).hidden = src !== 'glb'; $('#f-photo', root).hidden = src !== 'photo'; }));
      $('#gl', root)?.addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (f.size > 30e6) return toast('הקובץ גדול מ־30MB');
        const prev = $('#ph-prev', root); prev.innerHTML = '<p class="small muted">טוען את הדמות…</p>';
        glb = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(f); });
        try { const u = URL.createObjectURL(f); thumb = await snapshot(u); URL.revokeObjectURL(u); prev.innerHTML = `<img src="${thumb}" style="max-height:220px;border-radius:12px;margin-bottom:10px">`; }
        catch { prev.innerHTML = '<p class="small muted">לא הצלחתי להציג את הקובץ – אפשר עדיין לשמור.</p>'; }
        if (!$('[name=name]', root).value) $('[name=name]', root).value = f.name.replace(/\.glb$/i, '').slice(0, 30);
      });
      $('#ph', root)?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; photo = await ctx.resizeImage(f, 1600, 0.9); $('#ph-prev', root).innerHTML = `<img src="${photo}" style="max-height:180px;border-radius:12px;margin-bottom:10px">`; });
      $('#del', root)?.addEventListener('click', (e) => { if (ctx.confirmInline(e.currentTarget)) { closeSheet(); api(`/api/game/chars/${c.id}`, { method: 'DELETE' }); } });
      $('#f', root).onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        const stats = {}; for (let i = 0; i < 4; i++) if (f[`sk${i}`]?.value.trim()) stats[f[`sk${i}`].value.trim()] = +f[`sv${i}`].value || 0;
        const body = { name: f.name.value, husband: f.husband.value, rarity: f.rarity.value, title: f.title.value, move: f.move.value, stats };
        if (isNew && src === 'glb' && !glb) return toast('בחרו קובץ GLB');
        if (isNew && src === 'photo' && !photo) return toast('בחרו תמונה');
        const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = '⏳ שולח…';
        const r = await api(isNew ? '/api/game/chars' : `/api/game/chars/${c.id}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(isNew ? (src === 'glb' ? { ...body, glb, thumb } : { ...body, photo }) : body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { btn.disabled = false; btn.textContent = 'נסו שוב'; return toast(esc(j.error || 'שגיאה')); }
        closeSheet(); if (isNew) toast(src === 'glb' ? 'הדמות נוספה 🎉' : 'הדמות בבנייה – זה לוקח כמה דקות');
      };
    });
  }

  // ---------- three.js ----------
  let THREE = null; let GLTFLoader = null;
  async function three() {
    if (!THREE) { THREE = await import('/vendor/three/build/three.module.js'); ({ GLTFLoader } = await import('/vendor/three/examples/jsm/loaders/GLTFLoader.js')); }
    return THREE;
  }
  async function loadModel(key, direct = false) {
    await three();
    const url = direct ? key : await getBlobUrl(key);
    const gltf = await new GLTFLoader().loadAsync(url);
    const obj = gltf.scene;
    // Normalise to ~1.7 m tall, feet on the ground, facing the camera
    const box = new THREE.Box3().setFromObject(obj); const size = box.getSize(new THREE.Vector3());
    const s = 1.7 / (size.y || 1); obj.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(obj); const c = box2.getCenter(new THREE.Vector3());
    obj.position.sub(new THREE.Vector3(c.x, box2.min.y, c.z));
    const holder = new THREE.Group(); holder.add(obj);
    // Keep built-in animations in place: drop sideways root motion, keep the up/down
    for (const clip of gltf.animations) for (const tr of clip.tracks) {
      if (/(^|[.:|/])hips\.position$/i.test(tr.name) || /hips\.position/i.test(tr.name)) {
        const v = tr.values; const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
    }
    // Skeleton motion: without clips it does everything (arms down, breathing, looking around);
    // with clips (Avaturn's idle) it only adds the wave on top
    const proc = procedural(holder, !gltf.animations.length);
    return { holder, clips: gltf.animations, proc };
  }

  // Lower the arms from the T/A pose, then breathe, look around, and wave on demand.
  // Works on any humanoid skeleton with Mixamo-style bone names, without knowing its axes.
  function procedural(holder, full = true) {
    holder.updateMatrixWorld(true);
    const bones = {}; holder.traverse((o) => { if (o.isBone) bones[o.name.replace(/^.*[:_]/, '').toLowerCase()] = o; });
    const b = (n) => bones[n.toLowerCase()];
    if (!b('RightArm') && !b('LeftArm')) return null;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const wp = (o) => o.getWorldPosition(new THREE.Vector3());
    // Rotate a bone so the direction to its child points along a world direction
    const aim = (bone, child, dir) => {
      if (!bone || !child) return;
      holder.updateMatrixWorld(true);
      const cur = wp(child).sub(wp(bone)).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(cur, dir.clone().applyQuaternion(holder.getWorldQuaternion(new THREE.Quaternion())).normalize());
      const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parentQ.invert().multiply(delta.multiply(boneQ)));
    };
    // Which way is the model's left/right? Use the shoulders.
    const side = b('RightArm') && b('LeftArm') ? Math.sign(wp(b('RightArm')).x - wp(b('LeftArm')).x) || 1 : 1;
    if (full) {
      aim(b('LeftArm'), b('LeftForeArm'), V(-side * 0.18, -1, 0.05));
      aim(b('RightArm'), b('RightForeArm'), V(side * 0.18, -1, 0.05));
      aim(b('LeftForeArm'), b('LeftHand'), V(-side * 0.1, -1, 0.2));
      aim(b('RightForeArm'), b('RightHand'), V(side * 0.1, -1, 0.2));
    }
    const rest = new Map(); for (const k of ['Spine1', 'Spine2', 'Neck', 'Head', 'RightArm', 'RightForeArm']) if (b(k)) rest.set(k, b(k).quaternion.clone());
    let waving = 0; let up = null; let talking = 0;
    return {
      set wave(v) { waving = v ? 1 : 0; },
      set talk(v) { talking = v ? 1 : 0; },
      update(t) {
        const sp = b('Spine2') || b('Spine1'); const hd = b('Head');
        if (full && sp) { sp.quaternion.copy(rest.get(sp === b('Spine2') ? 'Spine2' : 'Spine1')); sp.rotateX(Math.sin(t * 1.6) * 0.025); }
        if (full && hd) { hd.quaternion.copy(rest.get('Head')); hd.rotateY(Math.sin(t * 0.5) * 0.25); hd.rotateX(Math.sin(t * 0.8) * 0.05); }
        // "Talking": small nods and turns of the head, a little sway in the chest
        if (talking && hd) { hd.rotateX(Math.sin(t * 7.5) * 0.045 + Math.sin(t * 2.9) * 0.03); hd.rotateY(Math.sin(t * 1.6) * 0.09); hd.rotateZ(Math.sin(t * 2.2) * 0.03); }
        if (talking && sp) sp.rotateY(Math.sin(t * 1.3) * 0.04);
        const ra = b('RightArm'), rf = b('RightForeArm');
        if (ra && waving) {
          if (!up) { aim(ra, rf, V(side * 0.55, 0.85, 0.15)); aim(rf, b('RightHand'), V(side * 0.2, 1, 0.1)); up = { a: ra.quaternion.clone(), f: rf?.quaternion.clone() }; }
          ra.quaternion.copy(up.a);
          if (rf) { rf.quaternion.copy(up.f); const axis = wp(rf).sub(wp(ra)).normalize(); const q = new THREE.Quaternion().setFromAxisAngle(axis, Math.sin(t * 9) * 0.6); const pq = rf.parent.getWorldQuaternion(new THREE.Quaternion()); const lq = pq.clone().invert().multiply(q).multiply(pq); rf.quaternion.premultiply(lq); }
        } else if (ra && up) { if (full) { ra.quaternion.copy(rest.get('RightArm')); if (rf) rf.quaternion.copy(rest.get('RightForeArm')); } up = null; }
      },
    };
  }
  // Render a still of a model for its card (used for uploaded GLB files)
  async function snapshot(url) {
    await three();
    const w = 512, h = 640; const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true }); renderer.setSize(w, h);
    const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x664422, 2.4));
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 50); cam.position.set(0, 1.0, 3.6); cam.lookAt(0, 0.88, 0);
    const { holder, clips } = await loadModel(url, true); scene.add(holder);
    if (clips.length) { const mx = new THREE.AnimationMixer(holder); mx.clipAction(clips[0]).play(); mx.update(1.5); }
    renderer.render(scene, cam);
    renderer.setClearColor(0x000000, 0); renderer.render(scene, cam);
    const out = renderer.domElement.toDataURL('image/png'); renderer.dispose(); return out;
  }
  // Small turntable viewer for the card
  async function viewer(el, c) {
    try {
      await three();
      const w = el.clientWidth || 300, h = 260;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setSize(w, h); renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      el.append(renderer.domElement);
      const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x664422, 2.2));
      const cam = new THREE.PerspectiveCamera(35, w / h, 0.1, 50); cam.position.set(0, 1.0, 3.3); cam.lookAt(0, 0.85, 0);
      const m = await loadModel(c.glbWave || c.glb); const { holder, clips } = m; scene.add(holder);
      const mixer = clips.length ? new THREE.AnimationMixer(holder) : null; if (mixer) mixer.clipAction(clips[0]).play();
      const clock = new THREE.Clock(); let tt = 0;
      const loop = () => { if (!el.isConnected) { renderer.dispose(); return; } const dt = clock.getDelta(); tt += dt; mixer?.update(dt); if (m.proc) { m.proc.wave = tt % 6 > 4; m.proc.update(tt); } holder.rotation.y += 0.008; renderer.render(scene, cam); requestAnimationFrame(loop); };
      loop();
    } catch (e) { el.innerHTML = c.thumb ? `<img src="${blobUrl(c.thumb)}" style="max-height:240px">` : ''; }
  }

  // ---------- AR catch ----------
  async function openAR(c, spawn) {
    if (!c) return;
    // iOS needs a tap-triggered permission for motion sensors
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch { /* denied */ }
    const r = RAR[spawn?.rarity || c.rarity] || RAR.common;
    const ov = document.createElement('div'); ov.className = 'go-ar'; ov.style.setProperty('--rc', r.color);
    ov.innerHTML = `<video playsinline muted autoplay></video><canvas></canvas>
      <div class="go-ring"><i></i></div><div class="go-heart">❤️</div>
      <div class="go-top"><button class="icon-btn go-x" aria-label="סגירה">✕</button><div><b>${caughtChar(c.id) ? esc(c.name) : '???'}</b><small>${r.name}${spawn ? '' : ' · תרגול'}</small></div></div>
      <div class="go-hint">החליקו למעלה כדי לזרוק ❤️ – בזמן שהעיגול קטן</div>
      <div class="go-msg" hidden></div>`;
    document.body.append(ov); document.body.classList.add('go-open');
    const video = $('video', ov); const canvas = $('canvas', ov);
    let stream = null; let alive = true;
    const close = () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); window.removeEventListener('deviceorientation', onOri); ov.remove(); document.body.classList.remove('go-open'); render(); };
    $('.go-x', ov).onclick = close;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); video.srcObject = stream; } catch { ov.classList.add('nocam'); }

    await three();
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x886644, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, 4, 3); scene.add(sun);
    const cam = new THREE.PerspectiveCamera(62, 1, 0.05, 100); cam.position.set(0, 1.5, 0);
    const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    resize(); addEventListener('resize', resize);

    let model; try { model = await loadModel(c.glb); } catch { toast('לא הצלחתי לטעון את הדמות'); close(); return; }
    scene.add(model.holder);
    let mixer = model.clips.length ? new THREE.AnimationMixer(model.holder) : null; if (mixer) mixer.clipAction(model.clips[0]).play();
    const wavePromise = c.glbWave ? loadModel(c.glbWave).catch(() => null) : Promise.resolve(null);

    // Phone orientation → camera rotation (same maths as three's old DeviceOrientationControls)
    const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    let ori = null; let placed = false;
    function onOri(e) { if (e.alpha != null) ori = e; }
    window.addEventListener('deviceorientation', onOri);
    const D = Math.PI / 180;
    const place = () => {
      // Stand her ~2.5 m in front of wherever the phone points when the screen opens
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      model.holder.position.set(f.x * 2.5, 0, f.z * 2.5); model.holder.lookAt(0, 0, 0); model.holder.rotation.x = 0; model.holder.rotation.z = 0;
      placed = true;
    };
    const clock = new THREE.Clock(); let dodge = 0; let t = 0;
    const loop = () => {
      if (!alive) { renderer.dispose(); removeEventListener('resize', resize); return; }
      const dt = clock.getDelta(); t += dt;
      if (ori) {
        const orient = (screen.orientation?.angle || window.orientation || 0) * D;
        euler.set(ori.beta * D, ori.alpha * D, -ori.gamma * D, 'YXZ'); cam.quaternion.setFromEuler(euler); cam.quaternion.multiply(q1); cam.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
      }
      if (!placed && (ori || t > 1.2)) place();
      if (dodge > 0) { dodge -= dt; model.holder.position.x += Math.sin(t * 30) * 0.02; }
      mixer?.update(dt); model.proc?.update(t);
      renderer.render(scene, cam);
      // ring follows her on screen
      const head = model.holder.position.clone(); head.y = 1.1; head.project(cam);
      const ring = $('.go-ring', ov);
      const vis = head.z < 1 && Math.abs(head.x) < 1.2 && Math.abs(head.y) < 1.2;
      ring.style.opacity = vis ? 1 : 0;
      ring.style.left = `${(head.x + 1) / 2 * innerWidth}px`; ring.style.top = `${(1 - head.y) / 2 * innerHeight}px`;
      ring.style.setProperty('--k', String(0.35 + 0.65 * Math.abs(Math.sin(t * 2.2))));
      ov.dataset.vis = vis ? '1' : '';
      requestAnimationFrame(loop);
    };
    loop();

    // Throw: swipe up
    let start = null; let tries = 0; let done = false;
    ov.addEventListener('pointerdown', (e) => { if (!e.target.closest('.go-top')) start = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    ov.addEventListener('pointerup', async (e) => {
      if (!start || done) return; const dy = start.y - e.clientY; const dx = e.clientX - start.x; const dtm = performance.now() - start.t; start = null;
      if (dy < 50 || dtm > 1500) return;
      tries++;
      const ring = $('.go-ring', ov); const k = +ring.style.getPropertyValue('--k') || 1;
      const rx = parseFloat(ring.style.left), ry = parseFloat(ring.style.top);
      const tx = e.clientX + dx * 0.6; const aim = Math.abs(tx - rx) / innerWidth; // 0 = dead centre
      const heart = $('.go-heart', ov);
      heart.style.transition = 'none'; heart.style.left = `${e.clientX}px`; heart.style.top = `${innerHeight - 80}px`; heart.style.transform = 'translate(-50%,-50%) scale(1.4)'; heart.style.opacity = 1;
      requestAnimationFrame(() => { heart.style.transition = 'left .55s ease-out, top .55s cubic-bezier(.2,-0.6,.6,1), transform .55s'; heart.style.left = `${tx}px`; heart.style.top = `${ry}px`; heart.style.transform = 'translate(-50%,-50%) scale(.6)'; });
      await new Promise((res) => setTimeout(res, 580));
      heart.style.opacity = 0;
      const hit = ov.dataset.vis && aim < 0.12;
      const chance = hit ? Math.min(0.97, r.chance + (1 - k) * 0.35) : 0;
      if (Math.random() < chance) {
        done = true; chirp([660, 880, 1320]);
        const wave = await wavePromise;
        if (!wave && model.proc) model.proc.wave = true;
        if (wave) { scene.remove(model.holder); wave.holder.position.copy(model.holder.position); wave.holder.quaternion.copy(model.holder.quaternion); scene.add(wave.holder); model = wave; mixer = wave.clips.length ? new THREE.AnimationMixer(wave.holder) : null; if (mixer) mixer.clipAction(wave.clips[0]).play(); }
        confetti(ov);
        const res = spawn ? await record(spawn) : null;
        msg(`<b>תפסת את ${esc(c.name)}!</b>${res ? `<span>+${res.points} נקודות${res.mom ? ' · זאת אמא! 💛' : ''}${res.queued ? ' · יישמר כשתחזור קליטה' : ''}</span>` : '<span>תרגול – בלי נקודות</span>'}<button class="btn" id="go-done">מעולה</button>`);
        $('#go-done', ov).onclick = close;
      } else {
        chirp([300, 220]); dodge = 0.5;
        if (spawn && r === RAR.legendary && tries >= 3 && Math.random() < 0.5) { done = true; msg('<b>היא ברחה! 💨</b><span>אולי בפעם הבאה</span><button class="btn" id="go-done">טוב…</button>'); $('#go-done', ov).onclick = close; }
        else flash(hit ? 'כמעט! חכו שהעיגול יהיה קטן' : 'פספוס – כוונו אליה');
      }
    });
    const flash = (s) => { const m = $('.go-hint', ov); m.textContent = s; m.classList.remove('pulse'); void m.offsetWidth; m.classList.add('pulse'); };
    const msg = (html) => { const m = $('.go-msg', ov); m.innerHTML = html; m.hidden = false; $('.go-hint', ov).hidden = true; };
  }
  async function record(s) {
    const here = herePos() || {};
    const body = { spawn: s.id, by: me(), player: curPlayer(), lat: here.lat, lng: here.lng, t: Date.now() };
    try {
      const r = await api('/api/game/catch', { method: 'POST', body: JSON.stringify(body) }); const j = await r.json().catch(() => ({}));
      if (r.ok) { G.gcatches.set(j.doc.id, j.doc); return j.doc; }
      toast(esc(j.error || 'לא נשמר')); return null;
    } catch {
      ls.set('trip.gamequeue', JSON.stringify([...queue(), body]));
      const c = G.gchars.get(s.char); const pts = (RAR[s.rarity] || RAR.common).pts;
      G.gcatches.set(`q-${Date.now()}`, { spawn: s.id, char: s.char, by: me(), player: curPlayer(), points: pts, t: Date.now() });
      return { points: pts, queued: true, mom: c?.husband === me() && curPlayer() !== person(me())?.name };
    }
  }
  let actx;
  function chirp(freqs) {
    try { actx ||= new AudioContext(); freqs.forEach((f, i) => { const o = actx.createOscillator(); const g = actx.createGain(); o.frequency.value = f; o.type = 'triangle'; g.gain.setValueAtTime(0.0001, actx.currentTime + i * 0.09); g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + i * 0.09 + 0.25); o.connect(g).connect(actx.destination); o.start(actx.currentTime + i * 0.09); o.stop(actx.currentTime + i * 0.09 + 0.3); }); } catch { /* no audio */ }
  }
  function confetti(ov) {
    for (let i = 0; i < 40; i++) { const s = document.createElement('i'); s.className = 'go-conf'; s.textContent = ['❤️', '✨', '💛', '⭐'][i % 4]; s.style.left = `${Math.random() * 100}%`; s.style.animationDelay = `${Math.random() * 0.4}s`; ov.append(s); }
  }

  // ---------- map & home ----------
  function drawMap() {
    const map = ctx.getMap(); const L = window.L; if (!map || !L) return;
    if (!mapLayer) mapLayer = L.layerGroup().addTo(map);
    mapLayer.clearLayers();
    if (!unlocked) return;
    for (const s of liveSpawns()) {
      const r = RAR[s.rarity] || RAR.common;
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="go-pin" style="--rc:${r.color}">❤️</div>` }), zIndexOffset: 300 })
        .bindPopup(`<b>${caughtChar(s.char) ? esc(G.gchars.get(s.char)?.name || '') : '???'}</b><br><span class="small">${r.name}</span><br><button class="btn small" data-go="game" style="margin-top:6px">ל־Wife GO</button>`).addTo(mapLayer);
    }
  }
  function homeCard() {
    const here = herePos(); const n = unlocked ? liveSpawns().filter((s) => here && dist(here, s) < 1000).length : 0;
    return `<div class="panel go-home" data-go="game"><div class="who-row" style="border:0;padding:0"><span class="go-logo sm">❤️</span>
      <div class="grow"><b>Wife <span class="go-o">GO</span></b><small>${!info.enabled ? 'בקרוב – מחכה להפעלה' : unlocked ? (n ? `${n} בטווח קילומטר ממך` : 'מחפשים אותן בשטח') : 'נעול בקוד הטיול'}</small></div><span class="btn small">${!info.enabled ? 'מה זה?' : unlocked ? 'לשחק' : 'פתיחה'}</span></div></div>`;
  }

  // ---------- narrator on screen while a place overview is read aloud ----------
  let narratorId = null; let narrInfo = null; let narr = null;
  fetch('/api/narrator').then((r) => r.json()).then(async (j) => {
    narratorId = j.id || null; narrInfo = j;
    if (j.id && 'caches' in window) { const src = `/api/narrator.glb?v=${encodeURIComponent(j.v || '')}`; try { const c = await caches.open(CACHE); if (!(await c.match(src))) { const r = await fetch(src); if (r.ok) await c.put(src, r); } } catch { /* ignore */ } }
  }).catch(() => {});
  async function narrate(on) {
    if (!on) { if (narr) { narr.el.classList.add('out'); const n = narr; narr = null; n.stopped = true; clearTimeout(n.slow); setTimeout(() => { n.el.remove(); n.renderer?.dispose(); }, 400); } return; }
    if (narr) return;
    try { if (!narrInfo) narrInfo = await (await fetch('/api/narrator')).json(); } catch { return; }
    if (!narrInfo?.id) return;
    const el = document.createElement('div'); el.className = 'narrator';
    el.innerHTML = `<canvas></canvas><img class="narr-img" alt="" hidden><div class="narr-load"><i></i><i></i><i></i></div><div class="narr-err" hidden></div><div class="narr-name">🎙️ ${esc(narrInfo.name || '')}</div>`;
    // If 3D can't be shown, fall back to a picture of the character that bobs while talking
    const fallback = (why) => {
      if (me.stopped) return;
      const img = $('.narr-img', el); img.src = `/api/narrator.img?v=${encodeURIComponent(narrInfo.v || '')}`; img.hidden = false;
      img.onerror = () => { img.hidden = true; };
      el.classList.add('ready', 'flat'); const er = $('.narr-err', el); er.textContent = why; er.hidden = !why;
      console.warn('[narrator] 3D unavailable:', why);
    };
    document.body.append(el); requestAnimationFrame(() => el.classList.add('in'));
    const me = { el, stopped: false }; narr = me;
    try {
      const slow = setTimeout(() => { if (!el.classList.contains('ready')) fallback('הטעינה איטית'); }, 15000);
      me.slow = slow;
      await three();
      const canvas = $('canvas', el); const w = 170, h = 230;
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(w, h, false); me.renderer = renderer;
      const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x664422, 2.3));
      const key = new THREE.DirectionalLight(0xffe2c0, 1.3); key.position.set(1.5, 2.5, 3); scene.add(key);
      const cam = new THREE.PerspectiveCamera(30, w / h, 0.05, 20); cam.position.set(0, 1.38, 2.25); cam.lookAt(0, 1.18, 0);
      // Keep the model on the phone after the first time (cache by version)
      const src = `/api/narrator.glb?v=${encodeURIComponent(narrInfo.v || '')}`;
      let url = src;
      try { const cache = await caches.open(CACHE); let hit = await cache.match(src); if (!hit) { const r = await fetch(src); if (r.ok) { await cache.put(src, r.clone()); hit = r; } } if (hit) url = URL.createObjectURL(await hit.blob()); } catch { /* no cache */ }
      const m = await loadModel(url, true);
      if (me.stopped) { renderer.dispose(); return; }
      scene.add(m.holder);
      const mixer = m.clips.length ? new THREE.AnimationMixer(m.holder) : null; if (mixer) mixer.clipAction(m.clips[0]).play();
      if (m.proc) m.proc.talk = true;
      clearTimeout(slow); el.classList.remove('flat'); $('.narr-img', el).hidden = true; $('.narr-err', el).hidden = true;
      el.classList.add('ready');
      const clock = new THREE.Clock(); let t = 0;
      const loop = () => { if (me.stopped) return; const dt = clock.getDelta(); t += dt; mixer?.update(dt); m.proc?.update(t); renderer.render(scene, cam); requestAnimationFrame(loop); };
      loop();
    } catch (e) { fallback(String(e?.message || e).slice(0, 80)); }
  }

  check();
  return { narrate, render: () => { render(); track(true); }, leave: () => track(false), drawMap, homeCard };
}
