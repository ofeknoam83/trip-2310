/* טיול 23-24/10 – client */

// ---------- utils ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>',
  all: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  drive: '<svg viewBox="0 0 24 24"><path d="M8 3h8l6 10-4 7H6l-4-7 6-10zM2 13h20M8 3l6 10M16 3l-6 10"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 50) return 'עכשיו';
  if (s < 3600) return `לפני ${Math.round(s / 60)} דק׳`;
  if (s < 86400) return `לפני ${Math.round(s / 3600)} שע׳`;
  return `לפני ${Math.round(s / 86400)} ימים`;
}
function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)} מ׳` : `${km.toFixed(km < 10 ? 1 : 0)} ק״מ`);

// ---------- state ----------
const COLLS = ['people', 'tasks', 'supplies', 'locations', 'pins', 'info'];
const S = Object.fromEntries(COLLS.map((c) => [c, new Map()]));
let me = ls.get('trip.me');
let online = new Set();
let config = { voice: false, photos: false, driveFolderUrl: '' };
let loaded = false;

const person = (id) => S.people.get(id);
const meP = () => person(me);
const info = () => S.info.get('main') || {};
const sortedPeople = () => [...S.people.values()].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));

function av(p, size = 36, cls = '') {
  if (!p) return `<span class="av initials ${cls}" style="--s:${size}px;--c:#8e97c0">?</span>`;
  const on = online.has(p.id) ? ' online' : '';
  const style = `--s:${size}px;--c:${esc(p.color || '#ff8a3d')}`;
  if (p.avatar) return `<span class="av${on} ${cls}" style="${style};background-image:url('${esc(p.avatar)}')" title="${esc(p.name)}"></span>`;
  return `<span class="av initials${on} ${cls}" style="${style}" title="${esc(p.name)}">${esc((p.name || '?').trim()[0])}</span>`;
}
const firstName = (p) => (p?.name || 'מישהו').split(' ')[0];

// ---------- socket ----------
const socket = io({ transports: ['websocket', 'polling'] });
function op(coll, action, id, data) {
  return new Promise((resolve) => {
    socket.timeout(15000).emit('op', { coll, action, id, data }, (err, res) => {
      if (err) { toast('אין קליטה כרגע – השינוי יישלח כשהחיבור יחזור'); resolve(null); return; }
      if (!res?.ok) toast('לא נשמר: ' + (res?.error || 'שגיאה'));
      resolve(res?.doc || null);
    });
  });
}

socket.on('connect', () => { if (me) socket.emit('hello', me); updateOnlineLine(); if (shareOn) sendLoc(true); });
socket.on('disconnect', updateOnlineLine);
socket.on('state', (snap) => {
  for (const c of COLLS) { S[c].clear(); for (const d of snap[c] || []) S[c].set(d.id, d); }
  loaded = true;
  if (!me || !S.people.has(me)) { me = null; showGate(); } else hideGate();
  renderAll();
});
socket.on('upsert', ({ coll, doc, by }) => {
  const prev = S[coll].get(doc.id);
  S[coll].set(doc.id, doc);
  if (by && by !== me) notifyChange(coll, prev, doc, by);
  renderColl(coll);
});
socket.on('remove', ({ coll, id }) => { S[coll].delete(id); renderColl(coll); });
socket.on('presence', (ids) => { online = new Set(ids); updateOnlineLine(); renderAll(); });
socket.on('photos:changed', ({ by }) => {
  photosStale = true;
  if (route === 'photos') loadPhotos(true);
  if (by && by !== me) toast(`${esc(firstName(person(by)))} העלה תמונה חדשה`, person(by));
});

function notifyChange(coll, prev, doc, by) {
  const who = person(by); const n = esc(firstName(who));
  if (coll === 'tasks') {
    if (!prev) toast(`${n} הוסיף משימה: ${esc(doc.title)}`, who);
    else if (!prev.owners?.includes(by) && doc.owners?.includes(by)) toast(`${n} לקח את: ${esc(doc.title)}`, who);
    else if (!prev.done && doc.done) toast(`${n} סימן כבוצע: ${esc(doc.title)}`, who);
  } else if (coll === 'supplies') {
    if (!prev) toast(`${n} הוסיף לציוד: ${esc(doc.item)}`, who);
    else if (prev.bringer !== by && doc.bringer === by) toast(`${n} מביא: ${esc(doc.item)}`, who);
  } else if (coll === 'pins' && !prev) toast(`${n} סימן נקודה במפה: ${esc(doc.name)}`, who);
  else if (coll === 'info') toast(`${n} עדכן את פרטי הטיול`, who);
}

function updateOnlineLine() {
  const el = $('#online-line');
  if (!socket.connected) { el.textContent = 'אין חיבור – מנסה שוב…'; el.style.color = 'var(--rose)'; return; }
  el.style.color = '';
  el.textContent = online.size > 1 ? `${online.size} מחוברים עכשיו` : 'מחובר';
}

let toastTimer = 0;
function toast(html, p) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = (p ? av(p, 28) : '') + `<span>${html}</span>`;
  $('#toasts').append(el);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(() => el.remove(), 4200);
  clearTimeout(toastTimer);
}

// ---------- routing ----------
const ROUTES = ['home', 'tasks', 'gear', 'map', 'voice', 'photos'];
let route = ROUTES.includes(location.hash.slice(2)) ? location.hash.slice(2) : 'home';
const sections = {};
function go(r) {
  if (!ROUTES.includes(r)) r = 'home';
  route = r;
  if (location.hash !== `#/${r}`) history.replaceState(null, '', `#/${r}`);
  for (const [k, el] of Object.entries(sections)) el.hidden = k !== r;
  $$('.tabbar button').forEach((b) => { if (b.dataset.go === r) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (r === 'map') ensureMap();
  if (r === 'photos' && (photosStale || !photos.length)) loadPhotos();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => go(location.hash.slice(2)));
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); }
});

function mountSections() {
  const view = $('#view');
  view.innerHTML = `
    <section id="sec-home"></section>
    <section id="sec-tasks">
      <h1 class="page-title">משימות</h1>
      <p class="page-sub">כל אחד יכול להוסיף משימה ולקחת אחריות. משימה בלי אחראי מסומנת בכתום.</p>
      <form class="add-bar" id="task-form">
        <input class="input" name="title" placeholder="משימה חדשה, למשל: להביא גנרטור" maxlength="140" autocomplete="off">
        <button class="btn" type="submit">${ICON.plus}הוספה</button>
      </form>
      <div class="chips" id="task-chips"></div>
      <div class="list" id="task-list"></div>
    </section>
    <section id="sec-gear">
      <h1 class="page-title">רשימת ציוד</h1>
      <p class="page-sub">מוסיפים מה צריך, ולוחצים ״אני מביא״ על מה שלוקחים.</p>
      <div class="panel" id="gear-progress"></div>
      <form class="add-bar" id="gear-form">
        <input class="input" name="item" placeholder="פריט, למשל: פטיש ליתדות" maxlength="140" autocomplete="off">
        <button class="btn" type="submit">${ICON.plus}הוספה</button>
      </form>
      <div class="chips" id="gear-chips"></div>
      <div id="gear-list"></div>
    </section>
    <section id="sec-map">
      <h1 class="page-title">מפה חיה</h1>
      <div class="map-wrap">
        <div id="map" dir="ltr"></div>
        <div class="map-tools">
          <button class="icon-btn" id="map-me" aria-label="מרכז עליי">${ICON.me}</button>
          <button class="icon-btn" id="map-all" aria-label="הצג את כולם">${ICON.all}</button>
          <button class="icon-btn" id="map-layer" aria-label="החלף שכבת מפה">${ICON.layers}</button>
        </div>
      </div>
      <div class="panel">
        <div class="share-toggle">
          <button class="switch" id="share-switch" role="switch" aria-checked="false" aria-label="שיתוף מיקום"></button>
          <div class="grow"><b>שתף את המיקום שלי</b><div class="small muted" id="share-status">כולם יראו איפה אתה על המפה</div></div>
        </div>
        <div class="share-toggle" style="margin-top:14px">
          <button class="switch" id="wake-switch" role="switch" aria-checked="false" aria-label="השאר מסך דלוק"></button>
          <div class="grow"><b>השאר את המסך דלוק</b><div class="small muted">הדפדפן שולח מיקום וקשר רק כשהאתר פתוח</div></div>
        </div>
      </div>
      <div class="panel"><div class="panel-head"><h2>מי איפה</h2><span class="small muted">לחיצה ארוכה על המפה מוסיפה נקודה</span></div><div id="where-list"></div></div>
    </section>
    <section id="sec-voice"></section>
    <section id="sec-photos">
      <h1 class="page-title">תמונות מהטיול</h1>
      <p class="page-sub">כל תמונה שמעלים נשמרת בתיקייה משותפת בגוגל דרייב, ופתוחה לצפייה לכולם.</p>
      <div class="panel">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <label class="btn" style="flex:1">${ICON.upload}העלאת תמונות<input type="file" id="photo-input" accept="image/*,video/*" multiple hidden></label>
          <a class="btn ghost" id="drive-link" target="_blank" rel="noopener" hidden>${ICON.drive}התיקייה בדרייב</a>
        </div>
        <div class="upload-q" id="upload-q"></div>
      </div>
      <div class="chips" id="photo-chips"></div>
      <div id="photo-grid"></div>
    </section>`;
  for (const r of ROUTES) sections[r] = $(`#sec-${r}`);
  bindTasks(); bindGear(); bindMap(); bindPhotos();
}

// ---------- render dispatch ----------
function renderAll() {
  if (!loaded) return;
  renderMe(); renderHome(); renderTasks(); renderGear(); renderWhere(); updateMarkers(); renderVoice(); renderDots();
  if (route === 'photos') renderPhotos();
}
function renderColl(c) {
  if (c === 'people') return renderAll();
  if (c === 'tasks') { renderTasks(); renderHome(); }
  if (c === 'supplies') { renderGear(); renderHome(); }
  if (c === 'info') renderHome();
  if (c === 'locations' || c === 'pins') { updateMarkers(); renderWhere(); }
  renderDots();
}
function renderDots() {
  const wanted = [...S.tasks.values()].filter((t) => !t.done && !t.owners?.length).length;
  const unclaimed = [...S.supplies.values()].filter((s) => !s.bringer).length;
  const d1 = $('#dot-tasks'); d1.textContent = wanted; d1.classList.toggle('show', wanted > 0);
  const d2 = $('#dot-gear'); d2.textContent = unclaimed; d2.classList.toggle('show', unclaimed > 0);
  $('#dot-voice').classList.toggle('show', !!room);
}
function renderMe() { $('#me-btn').innerHTML = av(meP(), 40); }

// ---------- home ----------
function countCompanions(s) {
  if (!s?.trim()) return 0;
  return s.replace(/\s+ו(?=\S)/g, ',').split(/[,،+]/).map((x) => x.trim()).filter(Boolean).length;
}
let countdownTimer;
function renderHome() {
  const i = info();
  const ppl = sortedPeople();
  const head = ppl.reduce((n, p) => n + 1 + countCompanions(p.companions), 0);
  const tasks = [...S.tasks.values()];
  const supplies = [...S.supplies.values()];
  const openTasks = tasks.filter((t) => !t.done).length;
  const wanted = tasks.filter((t) => !t.done && !t.owners?.length).length;
  const unclaimed = supplies.filter((s) => !s.bringer).length;
  const myTasks = tasks.filter((t) => !t.done && t.owners?.includes(me));
  const myGear = supplies.filter((s) => s.bringer === me);
  const row = (k, v) => `<dt>${k}</dt><dd class="${v ? '' : 'empty'}">${v ? esc(v) : 'עוד לא נקבע'}</dd>`;

  $('#sec-home').innerHTML = `
    <div class="hero">
      <div class="when">${esc(i.dates || '')}</div>
      <div class="countdown" id="countdown"></div>
      <div class="area">${esc(i.area || '')}</div>
      <div class="convoy">${ppl.map((p) => av(p, 42)).join('')}</div>
    </div>

    <div class="stats" style="margin-bottom:14px">
      <button class="stat" data-go="tasks"><b>${wanted}</b><span>משימות בלי אחראי, מתוך ${openTasks} פתוחות</span></button>
      <button class="stat" data-go="gear"><b>${unclaimed}</b><span>פריטי ציוד שאף אחד עוד לא לקח</span></button>
    </div>

    ${me ? `<div class="panel">
      <div class="panel-head"><h2>עליי</h2></div>
      ${myTasks.length || myGear.length ? `
        <dl class="kv">
          <dt>משימות</dt><dd class="${myTasks.length ? '' : 'empty'}">${myTasks.length ? myTasks.map((t) => esc(t.title)).join('\n') : 'אין'}</dd>
          <dt>מביא</dt><dd class="${myGear.length ? '' : 'empty'}">${myGear.length ? myGear.map((s) => esc(s.item) + (s.qty ? ` (${esc(s.qty)})` : '')).join('\n') : 'כלום עדיין'}</dd>
        </dl>` : `<p class="muted" style="margin:0 0 12px">עוד לא לקחת שום דבר.</p>
        <div style="display:flex;gap:8px"><button class="btn small" data-go="tasks">לקחת משימה</button><button class="btn small ghost" data-go="gear">להביא ציוד</button></div>`}
    </div>` : ''}

    <div class="panel">
      <div class="panel-head"><h2>פרטי הטיול</h2><button class="btn small ghost" id="edit-info">${ICON.edit}עריכה</button></div>
      <dl class="kv">
        ${row('איפה', i.area)}
        ${row('נקודת מפגש', i.meeting)}
        ${row('שעת מפגש', i.meetingTime)}
        ${row('הערות', i.notes)}
      </dl>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>מי מגיע</h2><span><span class="headcount">${head}</span> <span class="small muted">אנשים בערך</span></span></div>
      ${ppl.map((p) => `
        <div class="who-row">
          ${av(p, 44)}
          <div class="grow"><b>${esc(p.name)}${p.id === me ? ' <span class="small muted">(אני)</span>' : ''}</b>
          <small>${p.companions ? 'מגיע עם ' + esc(p.companions) : 'מגיע לבד, או שעוד לא עדכן'}</small></div>
          ${p.id === me ? `<button class="btn small ghost" data-act="profile">עריכה</button>` : ''}
        </div>`).join('')}
      <button class="btn ghost block" id="add-person" style="margin-top:12px">${ICON.plus}הוספת משתתף</button>
    </div>`;

  $('#edit-info').onclick = editInfo;
  $('#add-person').onclick = () => personSheet(null);
  $$('#sec-home [data-act="profile"]').forEach((b) => (b.onclick = () => personSheet(meP())));
  tickCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(tickCountdown, 30000);
}
function tickCountdown() {
  const el = $('#countdown'); if (!el) return;
  const start = Date.parse(info().start || '');
  if (!start) { el.innerHTML = ''; return; }
  const ms = start - Date.now();
  if (ms <= 0) {
    el.innerHTML = ms > -2.5 * 86400e3 ? '<div class="unit"><b>בשטח!</b></div>' : '<div class="unit"><b>היה מטורף</b></div>';
    return;
  }
  const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  const u = (n, l) => `<div class="unit"><b>${n}</b><span>${l}</span></div>`;
  el.innerHTML = d > 0
    ? u(d, d === 1 ? 'יום' : 'ימים') + '<span class="sep">:</span>' + u(h, 'שעות') + '<span class="sep">:</span>' + u(m, 'דקות')
    : u(h, 'שעות') + '<span class="sep">:</span>' + u(m, 'דקות');
}

function editInfo() {
  const i = info();
  const startLocal = i.start ? new Date(Date.parse(i.start) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  openSheet(`
    <h3>פרטי הטיול</h3>
    <form id="f">
      <label class="field"><span>איפה</span><input class="input" name="area" value="${esc(i.area)}"></label>
      <label class="field"><span>נקודת מפגש</span><input class="input" name="meeting" value="${esc(i.meeting)}" placeholder="למשל: תחנת דלק צומת הערבה"></label>
      <label class="field"><span>שעת מפגש</span><input class="input" name="meetingTime" value="${esc(i.meetingTime)}" placeholder="למשל: שישי 10:00"></label>
      <label class="field"><span>יציאה (לספירה לאחור)</span><input class="input" type="datetime-local" name="start" value="${startLocal}"></label>
      <label class="field"><span>תאריכים</span><input class="input" name="dates" value="${esc(i.dates)}"></label>
      <label class="field"><span>הערות</span><textarea class="input" name="notes">${esc(i.notes)}</textarea></label>
      <div class="actions"><button class="btn" type="submit">שמירה</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
    </form>`, (root) => {
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      if (fd.start) fd.start = new Date(fd.start).toISOString();
      closeSheet();
      await op('info', 'patch', 'main', fd);
    };
  });
}

// ---------- people / identity ----------
const COLORS = ['#ff8a3d', '#7fe0d2', '#ffd166', '#9b8cff', '#ff6b8b', '#62b6ff', '#c3f584', '#f4a3ff'];
function showGate() {
  if ($('.gate')) { renderGate(); return; }
  const g = document.createElement('div');
  g.className = 'gate';
  document.body.append(g);
  renderGate();
}
function renderGate() {
  const g = $('.gate'); if (!g) return;
  g.innerHTML = `
    <img class="group" src="/avatars/group.jpg" alt="">
    <h1>טיול 23-24/10</h1>
    <p>מי אתה? לוחצים על התמונה שלך וזהו.</p>
    <div class="pick-people">${[...S.people.values()].map((p) => `<button data-id="${esc(p.id)}">${av(p, 72)}<span>${esc(p.name)}</span></button>`).join('')}</div>
    <form class="other" id="gate-form">
      <label class="field"><span>לא ברשימה? כתוב את השם שלך</span>
        <div class="add-bar" style="margin:0"><input class="input" name="name" maxlength="40" placeholder="השם שלך" autocomplete="name"><button class="btn" type="submit">כניסה</button></div>
      </label>
    </form>`;
  $$('.pick-people button', g).forEach((b) => (b.onclick = () => setMe(b.dataset.id)));
  $('#gate-form', g).onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    const doc = await op('people', 'add', null, { name, color: COLORS[S.people.size % COLORS.length] });
    if (doc) setMe(doc.id);
  };
}
function hideGate() { $('.gate')?.remove(); }
function setMe(id) {
  me = id; ls.set('trip.me', id);
  socket.emit('hello', id);
  hideGate(); renderAll();
  toast(`היי ${esc(firstName(meP()))}! טוב שבאת`, meP());
}
$('#me-btn').onclick = () => (meP() ? personSheet(meP()) : showGate());

function resizeImage(file, max, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
async function squareAvatar(file) {
  const data = await resizeImage(file, 600, 0.9);
  const img = new Image(); img.src = data; await img.decode();
  const s = Math.min(img.width, img.height); const c = document.createElement('canvas'); c.width = c.height = 160;
  c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
  return c.toDataURL('image/jpeg', 0.82);
}

function personSheet(p) {
  const isNew = !p;
  const d = p || { name: '', companions: '', color: COLORS[S.people.size % COLORS.length], avatar: '' };
  let avatar = d.avatar; let color = d.color;
  openSheet(`
    <h3>${isNew ? 'משתתף חדש' : p.id === me ? 'הפרופיל שלי' : esc(p.name)}</h3>
    <form id="f">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <span id="pv"></span>
        <label class="btn small ghost">החלפת תמונה<input type="file" accept="image/*" id="pf" hidden></label>
      </div>
      <label class="field"><span>שם</span><input class="input" name="name" value="${esc(d.name)}" maxlength="40" required></label>
      <label class="field"><span>מגיע עם</span><input class="input" name="companions" value="${esc(d.companions)}" placeholder="למשל: עמית, ונועה" maxlength="120"></label>
      <div class="field"><span>צבע על המפה</span><div style="display:flex;gap:10px;flex-wrap:wrap" id="sw">
        ${COLORS.map((c) => `<button type="button" data-c="${c}" aria-label="${c}" style="width:34px;height:34px;border-radius:50%;background:${c};box-shadow:${c === color ? '0 0 0 3px var(--sand)' : 'none'}"></button>`).join('')}
      </div></div>
      <div class="actions"><button class="btn" type="submit">${isNew ? 'הוספה' : 'שמירה'}</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
      ${!isNew && p.id === me ? `<button class="btn ghost block" type="button" id="switch-user" style="margin-top:10px">אני לא ${esc(firstName(p))} – החלפת משתמש</button>` : ''}
    </form>`, (root) => {
    const pv = () => ($('#pv', root).innerHTML = av({ ...d, id: '', avatar, color, name: $('[name=name]', root).value || d.name || '?' }, 72));
    pv();
    $('[name=name]', root).oninput = pv;
    $('#pf', root).onchange = async (e) => { const f = e.target.files[0]; if (f) { avatar = await squareAvatar(f); pv(); } };
    $$('#sw button', root).forEach((b) => (b.onclick = () => { color = b.dataset.c; $$('#sw button', root).forEach((x) => (x.style.boxShadow = x === b ? '0 0 0 3px var(--sand)' : 'none')); pv(); }));
    $('#switch-user', root)?.addEventListener('click', () => { closeSheet(); me = null; ls.set('trip.me', null); showGate(); });
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      const data = { name: e.target.name.value, companions: e.target.companions.value, color, avatar };
      closeSheet();
      await op('people', isNew ? 'add' : 'patch', p?.id, data);
    };
  });
}

// ---------- sheet ----------
function openSheet(html, bind) {
  closeSheet();
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  $$('[data-close]', root).forEach((b) => (b.onclick = closeSheet));
  bind?.(root);
  setTimeout(() => $('.sheet input:not([type=file]), .sheet textarea', root)?.focus({ preventScroll: true }), 250);
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

function peoplePicker(selected, multi) {
  return `<div class="pick-people" id="pp">${sortedPeople().map((p) =>
    `<button type="button" data-id="${esc(p.id)}" aria-pressed="${selected.includes(p.id)}">${av(p, 54)}<span>${esc(firstName(p))}</span></button>`).join('')}</div>`;
}
function bindPicker(root, selected, multi) {
  $$('#pp button', root).forEach((b) => (b.onclick = () => {
    const id = b.dataset.id;
    if (multi) { const i = selected.indexOf(id); i >= 0 ? selected.splice(i, 1) : selected.push(id); }
    else { const was = selected[0] === id; selected.length = 0; if (!was) selected.push(id); }
    $$('#pp button', root).forEach((x) => x.setAttribute('aria-pressed', selected.includes(x.dataset.id)));
  }));
}

// ---------- tasks ----------
let taskFilter = 'all';
function bindTasks() {
  $('#task-form').onsubmit = async (e) => {
    e.preventDefault();
    const title = e.target.title.value.trim(); if (!title) return;
    e.target.title.value = '';
    await op('tasks', 'add', null, { title, owners: [] });
  };
  $('#task-list').addEventListener('click', async (e) => {
    const rowEl = e.target.closest('.row'); if (!rowEl) return;
    const t = S.tasks.get(rowEl.dataset.id); if (!t) return;
    if (e.target.closest('.check')) return op('tasks', 'patch', t.id, { done: !t.done });
    if (e.target.closest('.take')) {
      if (!me) return showGate();
      const owners = t.owners?.includes(me) ? t.owners.filter((x) => x !== me) : [...(t.owners || []), me];
      return op('tasks', 'patch', t.id, { owners });
    }
    taskSheet(t);
  });
}
function renderTasks() {
  const all = [...S.tasks.values()];
  const counts = {
    all: all.length,
    mine: all.filter((t) => t.owners?.includes(me)).length,
    wanted: all.filter((t) => !t.done && !t.owners?.length).length,
    open: all.filter((t) => !t.done).length,
  };
  const labels = { all: 'הכול', wanted: 'בלי אחראי', mine: 'שלי', open: 'פתוחות' };
  $('#task-chips').innerHTML = Object.keys(labels).map((k) => `<button class="chip" data-f="${k}" aria-pressed="${taskFilter === k}">${labels[k]} ${counts[k]}</button>`).join('');
  $$('#task-chips .chip').forEach((c) => (c.onclick = () => { taskFilter = c.dataset.f; renderTasks(); }));

  const list = all.filter((t) => taskFilter === 'all' || (taskFilter === 'mine' && t.owners?.includes(me))
    || (taskFilter === 'wanted' && !t.done && !t.owners?.length) || (taskFilter === 'open' && !t.done))
    .sort((a, b) => (a.done - b.done) || ((a.owners?.length ? 1 : 0) - (b.owners?.length ? 1 : 0)) || (a.createdAt - b.createdAt));
  $('#task-list').innerHTML = list.length ? list.map((t) => {
    const wanted = !t.done && !t.owners?.length;
    const mine = t.owners?.includes(me);
    return `<div class="row ${t.done ? 'done' : ''} ${wanted ? 'wanted' : ''}" data-id="${esc(t.id)}">
      <button class="check" role="checkbox" aria-checked="${!!t.done}" aria-label="בוצע">${ICON.check}</button>
      <div class="grow"><span class="title">${esc(t.title)}</span>
        ${wanted ? '<span class="wanted-tag">מחפשת מתנדב</span>' : t.owners?.length ? `<span class="meta">${t.owners.map((o) => esc(firstName(person(o)))).join(', ')}</span>` : ''}
        ${t.note ? `<div class="meta">${esc(t.note)}</div>` : ''}</div>
      <div class="stack">${(t.owners || []).map((o) => av(person(o), 28)).join('')}</div>
      ${t.done ? '' : `<button class="take ${mine ? 'mine' : ''}">${mine ? 'שלי' : 'אני לוקח'}</button>`}
    </div>`;
  }).join('') : `<div class="empty-state">${taskFilter === 'mine' ? 'עוד לא לקחת משימה. עברו ל״בלי אחראי״ ובחרו אחת.' : 'אין משימות כאן. הוסיפו אחת למעלה.'}</div>`;
}
function taskSheet(t) {
  const owners = [...(t.owners || [])];
  openSheet(`
    <h3>עריכת משימה</h3>
    <form id="f">
      <label class="field"><span>משימה</span><input class="input" name="title" value="${esc(t.title)}" maxlength="140" required></label>
      <label class="field"><span>פרטים</span><textarea class="input" name="note" maxlength="500">${esc(t.note)}</textarea></label>
      <div class="field"><span>מי אחראי</span>${peoplePicker(owners, true)}</div>
      <div class="actions"><button class="btn" type="submit">שמירה</button><button class="btn danger" type="button" id="del">מחיקה</button></div>
    </form>`, (root) => {
    bindPicker(root, owners, true);
    $('#del', root).onclick = async () => { if (confirmInline($('#del', root))) { closeSheet(); await op('tasks', 'del', t.id); } };
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      closeSheet();
      await op('tasks', 'patch', t.id, { title: e.target.title.value, note: e.target.note.value, owners });
    };
  });
}
// Two-tap delete instead of a blocking confirm() dialog
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; btn.textContent = 'בטוח? לחצו שוב';
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'מחיקה'; }, 3000);
  return false;
}

// ---------- gear ----------
let gearFilter = 'all';
const gearCats = () => [...new Set([...S.supplies.values()].map((s) => s.cat || 'כללי'))];
function bindGear() {
  $('#gear-form').onsubmit = async (e) => {
    e.preventDefault();
    const item = e.target.item.value.trim(); if (!item) return;
    e.target.item.value = '';
    await op('supplies', 'add', null, { item, cat: 'כללי' });
  };
  $('#gear-list').addEventListener('click', async (e) => {
    const rowEl = e.target.closest('.row'); if (!rowEl) return;
    const s = S.supplies.get(rowEl.dataset.id); if (!s) return;
    if (e.target.closest('.check')) return op('supplies', 'patch', s.id, { done: !s.done });
    if (e.target.closest('.take')) {
      if (!me) return showGate();
      return op('supplies', 'patch', s.id, { bringer: s.bringer === me ? null : me });
    }
    gearSheet(s);
  });
}
function renderGear() {
  const all = [...S.supplies.values()];
  const claimed = all.filter((s) => s.bringer).length;
  const packed = all.filter((s) => s.done).length;
  $('#gear-progress').innerHTML = `
    <div style="display:flex;justify-content:space-between;font-weight:700"><span>יש מי שמביא</span><span>${claimed} מתוך ${all.length}</span></div>
    <div class="progress"><i style="width:${all.length ? (claimed / all.length) * 100 : 0}%"></i></div>
    <div class="small muted" style="margin-top:6px">${packed} פריטים כבר ארוזים</div>`;
  const labels = { all: 'הכול', none: 'בלי מביא', mine: 'מה אני מביא' };
  const counts = { all: all.length, none: all.filter((s) => !s.bringer).length, mine: all.filter((s) => s.bringer === me).length };
  $('#gear-chips').innerHTML = Object.keys(labels).map((k) => `<button class="chip" data-f="${k}" aria-pressed="${gearFilter === k}">${labels[k]} ${counts[k]}</button>`).join('');
  $$('#gear-chips .chip').forEach((c) => (c.onclick = () => { gearFilter = c.dataset.f; renderGear(); }));
  const list = all.filter((s) => gearFilter === 'all' || (gearFilter === 'none' && !s.bringer) || (gearFilter === 'mine' && s.bringer === me));
  const cats = gearCats().filter((c) => list.some((s) => (s.cat || 'כללי') === c));
  $('#gear-list').innerHTML = cats.length ? cats.map((c) => `
    <h3 class="cat-title">${esc(c)}</h3>
    <div class="list">${list.filter((s) => (s.cat || 'כללי') === c).sort((a, b) => (a.done - b.done) || (a.createdAt - b.createdAt)).map((s) => {
      const mine = s.bringer === me;
      return `<div class="row ${s.done ? 'done' : ''} ${!s.bringer ? 'wanted' : ''}" data-id="${esc(s.id)}">
        <button class="check" role="checkbox" aria-checked="${!!s.done}" aria-label="ארוז">${ICON.check}</button>
        <div class="grow"><span class="title">${esc(s.item)}${s.qty ? ` <span class="meta">× ${esc(s.qty)}</span>` : ''}</span>
          ${s.bringer ? `<span class="meta">${esc(firstName(person(s.bringer)))} מביא</span>` : '<span class="wanted-tag">צריך מישהו שיביא</span>'}</div>
        ${s.bringer && !mine ? av(person(s.bringer), 30) : ''}
        <button class="take ${mine ? 'mine' : ''}">${mine ? 'אני מביא' : s.bringer ? 'גם אני' : 'אני מביא'}</button>
      </div>`;
    }).join('')}</div>`).join('') : `<div class="empty-state">${gearFilter === 'mine' ? 'עוד לא לקחת שום ציוד.' : 'הרשימה ריקה. הוסיפו פריט למעלה.'}</div>`;
  // "גם אני" on an item someone else brings: duplicate it for me
  $$('#gear-list .take').forEach((b) => {
    const s = S.supplies.get(b.closest('.row').dataset.id);
    if (s?.bringer && s.bringer !== me) b.onclick = async (e) => {
      e.stopPropagation();
      if (!me) return showGate();
      await op('supplies', 'add', null, { item: s.item, cat: s.cat, qty: s.qty, bringer: me });
    };
  });
}
function gearSheet(s) {
  const bringer = s.bringer ? [s.bringer] : [];
  const cats = gearCats();
  openSheet(`
    <h3>עריכת פריט</h3>
    <form id="f">
      <label class="field"><span>פריט</span><input class="input" name="item" value="${esc(s.item)}" maxlength="140" required></label>
      <div style="display:flex;gap:10px">
        <label class="field" style="flex:1"><span>כמות</span><input class="input" name="qty" value="${esc(s.qty)}" maxlength="30" placeholder="למשל: 2"></label>
        <label class="field" style="flex:2"><span>קטגוריה</span><input class="input" name="cat" value="${esc(s.cat || 'כללי')}" list="cats" maxlength="30"></label>
        <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>
      <div class="field"><span>מי מביא</span>${peoplePicker(bringer, false)}</div>
      <div class="actions"><button class="btn" type="submit">שמירה</button><button class="btn danger" type="button" id="del">מחיקה</button></div>
    </form>`, (root) => {
    bindPicker(root, bringer, false);
    $('#del', root).onclick = async () => { if (confirmInline($('#del', root))) { closeSheet(); await op('supplies', 'del', s.id); } };
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      closeSheet();
      await op('supplies', 'patch', s.id, { item: e.target.item.value, qty: e.target.qty.value, cat: e.target.cat.value, bringer: bringer[0] || null });
    };
  });
}

// ---------- map & location ----------
let map, layerTopo, layerSat, useSat = false;
const markers = new Map(); const pinMarkers = new Map();
const PIN_KINDS = { camp: ['⛺', 'לינה'], meet: ['🚙', 'מפגש'], water: ['💧', 'מים'], view: ['🌄', 'תצפית'], other: ['📍', 'אחר'] };
const STALE_MS = 10 * 60e3;

function ensureMap() {
  if (map) { setTimeout(() => map.invalidateSize(), 50); return; }
  if (!window.L) return;
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([31.0, 35.25], 8);
  layerTopo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
  }).addTo(map);
  layerSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Imagery © Esri',
  });
  map.on('contextmenu', (e) => pinSheet(e.latlng));
  updateMarkers();
  fitAll(false);
  setTimeout(() => map.invalidateSize(), 100);
}
function faceIcon(p, loc) {
  const stale = !loc.sharing || Date.now() - loc.t > STALE_MS;
  return L.divIcon({
    className: '', iconSize: [40, 40], iconAnchor: [20, 20],
    html: `<div class="pin-face ${stale ? 'stale' : ''}">${!stale ? `<span class="pulse" style="--c:${esc(p.color)}"></span>` : ''}${av(p, 40)}<label>${esc(firstName(p))}</label></div>`,
  });
}
function updateMarkers() {
  if (!map) return;
  for (const loc of S.locations.values()) {
    const p = person(loc.id); if (!p) continue;
    const ll = [loc.lat, loc.lng];
    let m = markers.get(loc.id);
    if (!m) { m = L.marker(ll, { zIndexOffset: loc.id === me ? 1000 : 0 }).addTo(map); markers.set(loc.id, m); }
    m.setLatLng(ll); m.setIcon(faceIcon(p, loc));
    m.bindPopup(`<b>${esc(p.name)}</b><br>${loc.sharing ? 'עודכן ' : 'הפסיק לשתף · '}${ago(loc.t)}${loc.battery != null ? `<br>סוללה ${Math.round(loc.battery * 100)}%` : ''}`);
  }
  for (const [id, m] of markers) if (!S.locations.has(id)) { m.remove(); markers.delete(id); }
  for (const pin of S.pins.values()) {
    let m = pinMarkers.get(pin.id);
    const [emoji, label] = PIN_KINDS[pin.kind] || PIN_KINDS.other;
    const icon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 28], html: `<div class="place-pin">${emoji}</div>` });
    if (!m) { m = L.marker([pin.lat, pin.lng], { icon }).addTo(map); pinMarkers.set(pin.id, m); }
    m.setIcon(icon);
    const nav = `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`;
    const waze = `https://waze.com/ul?ll=${pin.lat},${pin.lng}&navigate=yes`;
    m.bindPopup(`<b>${esc(pin.name)}</b> <span class="small muted">${label}</span><br>
      <a href="${waze}" target="_blank" rel="noopener">Waze</a> | <a href="${nav}" target="_blank" rel="noopener">Google Maps</a><br>
      <button class="btn small danger" style="margin-top:8px" data-delpin="${esc(pin.id)}">מחיקת נקודה</button>`);
  }
  for (const [id, m] of pinMarkers) if (!S.pins.has(id)) { m.remove(); pinMarkers.delete(id); }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-delpin]');
  if (b && confirmInline(b)) { map?.closePopup(); op('pins', 'del', b.dataset.delpin); }
});
function fitAll(animate = true) {
  if (!map) return;
  const pts = [...S.locations.values()].filter((l) => l.sharing).map((l) => [l.lat, l.lng]).concat([...S.pins.values()].map((p) => [p.lat, p.lng]));
  if (pts.length === 1) map.setView(pts[0], 13, { animate });
  else if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 14, animate });
}
function pinSheet(latlng) {
  let kind = 'camp';
  openSheet(`
    <h3>נקודה חדשה במפה</h3>
    <form id="f">
      <label class="field"><span>שם</span><input class="input" name="name" maxlength="60" placeholder="למשל: חניון הלילה" required></label>
      <div class="field"><span>סוג</span><div class="chips" id="kinds">${Object.entries(PIN_KINDS).map(([k, [e, l]]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="${k === kind}">${e} ${l}</button>`).join('')}</div></div>
      <p class="small muted">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</p>
      <div class="actions"><button class="btn" type="submit">הוספה</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
    </form>`, (root) => {
    $$('#kinds .chip', root).forEach((c) => (c.onclick = () => { kind = c.dataset.k; $$('#kinds .chip', root).forEach((x) => x.setAttribute('aria-pressed', x === c)); }));
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault(); closeSheet();
      await op('pins', 'add', null, { name: e.target.name.value, kind, lat: latlng.lat, lng: latlng.lng });
    };
  });
}

let shareOn = ls.get('trip.share') === '1';
let watchId = null; let lastPos = null; let lastSent = { t: 0, lat: 0, lng: 0 }; let battery = null;
navigator.getBattery?.().then((b) => { battery = b; }).catch(() => {});

function sendLoc(force) {
  if (!lastPos || !me) return;
  const now = Date.now();
  const moved = distKm(lastSent, lastPos) * 1000;
  if (!force && now - lastSent.t < 15000 && moved < 25) return;
  socket.emit('loc', { ...lastPos, battery: battery?.level ?? null });
  lastSent = { t: now, lat: lastPos.lat, lng: lastPos.lng };
}
function startShare() {
  if (!navigator.geolocation) { toast('הדפדפן הזה לא תומך בשיתוף מיקום'); return; }
  if (!me) { showGate(); return; }
  shareOn = true; ls.set('trip.share', '1');
  watchId = navigator.geolocation.watchPosition((pos) => {
    lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, heading: pos.coords.heading, speed: pos.coords.speed };
    sendLoc(false);
    $('#share-status').textContent = `משתף · דיוק ${Math.round(pos.coords.accuracy)} מ׳`;
  }, (err) => {
    $('#share-status').textContent = err.code === 1 ? 'אין הרשאת מיקום. אפשרו מיקום לאתר בהגדרות הדפדפן.' : 'מחפש אות GPS…';
    if (err.code === 1) stopShare(false);
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  $('#share-switch').setAttribute('aria-checked', 'true');
  $('#share-status').textContent = 'מחפש מיקום…';
}
function stopShare(tell = true) {
  shareOn = false; ls.set('trip.share', null);
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  $('#share-switch').setAttribute('aria-checked', 'false');
  if (tell) { socket.emit('loc:stop'); $('#share-status').textContent = 'כולם יראו איפה אתה על המפה'; }
}
setInterval(() => { if (shareOn) sendLoc(true); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (shareOn) sendLoc(true); if (wakeOn) requestWake(); renderWhere(); }
});

let wakeOn = false; let wakeLock = null;
async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ }
}

function bindMap() {
  $('#share-switch').onclick = () => (shareOn && watchId != null ? stopShare() : startShare());
  $('#wake-switch').onclick = async () => {
    wakeOn = !wakeOn;
    $('#wake-switch').setAttribute('aria-checked', wakeOn);
    if (wakeOn) { await requestWake(); if (!navigator.wakeLock) toast('הדפדפן לא מאפשר להשאיר את המסך דלוק. כבו נעילה אוטומטית בהגדרות הטלפון.'); }
    else { wakeLock?.release(); wakeLock = null; }
  };
  $('#map-me').onclick = () => {
    const l = S.locations.get(me);
    if (l) map?.setView([l.lat, l.lng], 14);
    else toast('הפעילו שיתוף מיקום כדי לראות את עצמכם');
  };
  $('#map-all').onclick = () => fitAll();
  $('#map-layer').onclick = () => {
    useSat = !useSat;
    if (useSat) { map.removeLayer(layerTopo); layerSat.addTo(map); } else { map.removeLayer(layerSat); layerTopo.addTo(map); }
  };
  $('#where-list').addEventListener('click', (e) => {
    const r = e.target.closest('[data-loc]'); if (!r) return;
    const l = S.locations.get(r.dataset.loc);
    if (l && map) { map.setView([l.lat, l.lng], 15); markers.get(l.id)?.openPopup(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  if (shareOn) startShare();
}
function renderWhere() {
  const el = $('#where-list'); if (!el) return;
  const mine = S.locations.get(me);
  const rows = sortedPeople().map((p) => {
    const l = S.locations.get(p.id);
    const live = l?.sharing && Date.now() - l.t < STALE_MS;
    let status = 'לא משתף מיקום';
    if (l) status = (l.sharing ? (live ? 'משתף' : 'אין עדכון') : 'הפסיק לשתף') + ' · ' + ago(l.t);
    const dist = l && mine && p.id !== me ? ` · ${fmtDist(distKm(mine, l))} ממך` : '';
    return `<div class="who-row" ${l ? `data-loc="${esc(p.id)}" style="cursor:pointer"` : ''}>
      ${av(p, 40)}<div class="grow"><b>${esc(p.name)}</b><small style="color:${live ? 'var(--moon)' : ''}">${status}${dist}</small></div></div>`;
  });
  el.innerHTML = rows.join('');
}
setInterval(() => { if (route === 'map') { renderWhere(); updateMarkers(); } }, 30000);

// ---------- voice (LiveKit) ----------
let room = null; let voiceMode = ls.get('trip.voiceMode') || 'ptt'; let talking = false; let connecting = false;
let audioCtx;
function chirp(up = true) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(up ? 1200 : 900, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(up ? 1800 : 600, audioCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0.05, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.13);
  } catch { /* no audio */ }
}
function micPub() { return room?.localParticipant.getTrackPublication(LivekitClient.Track.Source.Microphone); }
async function setTalking(on) {
  if (!room) return;
  talking = on;
  const pub = micPub();
  if (pub?.track) { on ? await pub.unmute() : await pub.mute(); }
  else if (on) await room.localParticipant.setMicrophoneEnabled(true);
  chirp(on);
  renderVoice();
}
async function connectVoice() {
  if (!me) return showGate();
  if (!window.LivekitClient) { toast('רכיב הקשר לא נטען. בדקו חיבור ונסו שוב.'); return; }
  connecting = true; renderVoice();
  try {
    const r = await fetch(`/api/voice/token?id=${encodeURIComponent(me)}`);
    if (!r.ok) throw new Error('token');
    const { url, token } = await r.json();
    const { Room, RoomEvent } = LivekitClient;
    room = new Room({
      adaptiveStream: true, dynacast: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      reconnectPolicy: undefined,
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === 'audio') { const el = track.attach(); el.dataset.lk = '1'; document.body.append(el); }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((e) => e.remove()));
    let prevSpeakers = new Set();
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const now = new Set(speakers.map((s) => s.identity));
      if (voiceMode === 'ptt' && [...now].some((i) => !prevSpeakers.has(i) && i !== room.localParticipant.identity)) chirp(true);
      prevSpeakers = now; renderVoice();
    });
    for (const ev of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.Reconnecting, RoomEvent.Reconnected]) room.on(ev, renderVoice);
    room.on(RoomEvent.Disconnected, () => { room = null; talking = false; $$('audio[data-lk]').forEach((e) => e.remove()); renderVoice(); renderDots(); });
    await room.connect(url, token);
    await room.startAudio();
    await room.localParticipant.setMicrophoneEnabled(true);
    if (voiceMode === 'ptt') await micPub()?.mute(); else talking = true;
    toast('מחובר לקשר');
  } catch (e) {
    console.error(e);
    toast(e?.name === 'NotAllowedError' ? 'צריך לאשר גישה למיקרופון כדי לדבר בקשר' : 'לא הצלחנו להתחבר לקשר. בדקו קליטה ונסו שוב.');
    try { await room?.disconnect(); } catch { /* ignore */ }
    room = null;
  }
  connecting = false; renderVoice(); renderDots();
}
async function disconnectVoice() { await room?.disconnect(); room = null; talking = false; renderVoice(); renderDots(); }

function voiceParticipants() {
  if (!room) return [];
  const list = [room.localParticipant, ...room.remoteParticipants.values()];
  return list.map((pt) => ({
    id: pt.identity.split(':')[0], name: pt.name, local: pt === room.localParticipant,
    speaking: pt.isSpeaking, mic: pt.isMicrophoneEnabled,
  }));
}
function renderVoice() {
  const sec = $('#sec-voice'); if (!sec) return;
  // Keep the PTT button stable while it is pressed
  if (talking && voiceMode === 'ptt' && $('#ptt')?.classList.contains('on')) { renderVoicePeople(); return; }
  if (!config.voice) {
    sec.innerHTML = `<h1 class="page-title">קשר</h1>
      <div class="panel"><h2>הקשר עוד לא מחובר</h2><p class="muted" style="margin:0">צריך להוסיף מפתחות LiveKit בהגדרות השרת. ברגע שזה יקרה, כאן יופיע מכשיר הקשר.</p></div>`;
    return;
  }
  const state = room ? (room.state === 'reconnecting' ? 'מתחבר מחדש…' : 'מחובר') : connecting ? 'מתחבר…' : 'לא מחובר';
  sec.innerHTML = `
    <h1 class="page-title">קשר</h1>
    <p class="page-sub">מכשיר קשר לכל החבר׳ה. עובד גם בסלולר, כל עוד האתר פתוח.</p>
    <div class="seg" role="group" aria-label="מצב קשר">
      <button data-mode="ptt" aria-pressed="${voiceMode === 'ptt'}">מכשיר קשר</button>
      <button data-mode="open" aria-pressed="${voiceMode === 'open'}">שיחה פתוחה</button>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>${state}</h2>
        ${room ? '<button class="btn small danger" id="v-off">ניתוק</button>' : ''}</div>
      ${room ? `
        <div class="ptt-zone">
          ${voiceMode === 'ptt'
            ? `<button class="ptt ${talking ? 'on' : ''}" id="ptt">${talking ? 'משדר' : 'לחצו<br>לדבר'}<small>${talking ? 'שחררו לסיום' : 'החזיקו את הכפתור'}</small></button>`
            : `<button class="ptt ${talking ? 'on' : ''}" id="mute">${talking ? 'פתוח' : 'מושתק'}<small>${talking ? 'לחצו להשתקה' : 'לחצו לפתוח מיקרופון'}</small></button>`}
        </div>`
        : `<button class="btn teal block" id="v-on" ${connecting ? 'disabled' : ''}>${connecting ? 'מתחבר…' : 'התחברות לקשר'}</button>
           <p class="small muted" style="margin:10px 0 0">בפעם הראשונה הדפדפן יבקש גישה למיקרופון.</p>`}
    </div>
    <div class="panel"><div class="panel-head"><h2>בקשר עכשיו</h2></div><div class="voice-people" id="v-people"></div></div>`;
  renderVoicePeople();
  $$('.seg button', sec).forEach((b) => (b.onclick = async () => {
    voiceMode = b.dataset.mode; ls.set('trip.voiceMode', voiceMode);
    if (room) await setTalking(voiceMode === 'open');
    renderVoice();
  }));
  $('#v-on', sec)?.addEventListener('click', connectVoice);
  $('#v-off', sec)?.addEventListener('click', disconnectVoice);
  $('#mute', sec)?.addEventListener('click', () => setTalking(!talking));
  const ptt = $('#ptt', sec);
  if (ptt) {
    const down = (e) => { e.preventDefault(); ptt.setPointerCapture?.(e.pointerId); ptt.classList.add('on'); ptt.innerHTML = 'משדר<small>שחררו לסיום</small>'; setTalking(true); };
    const up = () => { if (!talking) return; ptt.classList.remove('on'); setTalking(false); };
    ptt.addEventListener('pointerdown', down);
    ptt.addEventListener('pointerup', up);
    ptt.addEventListener('pointercancel', up);
    ptt.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
function renderVoicePeople() {
  const el = $('#v-people'); if (!el) return;
  const ps = voiceParticipants();
  el.innerHTML = ps.length ? ps.map((v) => {
    const p = person(v.id) || { id: v.id, name: v.name, color: '#8e97c0' };
    return `<div class="voice-person ${v.speaking ? 'speaking' : ''} ${v.mic ? '' : 'muted'}">${av(p, 52)}<span>${esc(firstName(p))}${v.local ? ' (אני)' : ''}</span></div>`;
  }).join('') : '<p class="muted" style="margin:0">אף אחד לא מחובר כרגע.</p>';
}
// Space bar = push-to-talk on desktop
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && route === 'voice' && room && voiceMode === 'ptt' && !e.repeat && !e.target.closest('input,textarea')) { e.preventDefault(); setTalking(true); } });
document.addEventListener('keyup', (e) => { if (e.code === 'Space' && route === 'voice' && room && voiceMode === 'ptt' && talking) { e.preventDefault(); setTalking(false); } });

// ---------- photos ----------
let photos = []; let photosStale = true; let photoFilter = 'all'; let photosLoading = false;
const thumbUrl = (id) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w480`;
const fullUrl = (id) => `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w2048`;
const queue = [];

function bindPhotos() {
  $('#photo-input').onchange = (e) => { for (const f of e.target.files) enqueue(f); e.target.value = ''; };
}
async function loadPhotos(fresh = false) {
  if (!config.photos) { renderPhotos(); return; }
  photosLoading = true; renderPhotos();
  try {
    const r = await fetch('/api/photos' + (fresh ? '?fresh=1' : ''));
    const j = await r.json();
    photos = j.files || []; photosStale = false;
  } catch { toast('לא הצלחנו לטעון תמונות. בדקו קליטה.'); }
  photosLoading = false; renderPhotos();
}
function renderPhotos() {
  const link = $('#drive-link');
  if (config.driveFolderUrl) { link.href = config.driveFolderUrl; link.hidden = false; }
  if (!config.photos) {
    $('#photo-grid').innerHTML = '<div class="empty-state">העלאת תמונות עוד לא מחוברת לדרייב.</div>';
    return;
  }
  const byIds = [...new Set(photos.map((p) => p.byId).filter(Boolean))];
  $('#photo-chips').innerHTML = photos.length ? [`<button class="chip" data-f="all" aria-pressed="${photoFilter === 'all'}">כולם ${photos.length}</button>`]
    .concat(byIds.map((id) => `<button class="chip" data-f="${esc(id)}" aria-pressed="${photoFilter === id}">${esc(firstName(person(id)))} ${photos.filter((p) => p.byId === id).length}</button>`)).join('') : '';
  $$('#photo-chips .chip').forEach((c) => (c.onclick = () => { photoFilter = c.dataset.f; renderPhotos(); }));
  const list = photos.filter((p) => photoFilter === 'all' || p.byId === photoFilter);
  $('#photo-grid').innerHTML = list.length
    ? `<div class="grid">${list.map((p, i) => `<button data-i="${i}" aria-label="תמונה של ${esc(p.by)}">
        <img src="${thumbUrl(p.id)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        ${p.mime?.startsWith('video') ? '<span class="vid">וידאו</span>' : ''}
        <span class="by">${av(person(p.byId) || { name: p.by, color: '#8e97c0' }, 22)}</span></button>`).join('')}</div>`
    : `<div class="empty-state">${photosLoading ? 'טוען תמונות…' : 'עוד אין תמונות. הראשון שמעלה – מנצח.'}</div>`;
  $$('#photo-grid .grid button').forEach((b) => (b.onclick = () => lightbox(list, +b.dataset.i)));
}
function lightbox(list, i) {
  const lb = document.createElement('div'); lb.className = 'lightbox';
  const show = () => {
    const p = list[i];
    const media = p.mime?.startsWith('video')
      ? `<iframe src="https://drive.google.com/file/d/${encodeURIComponent(p.id)}/preview" allow="autoplay"></iframe>`
      : `<img src="${fullUrl(p.id)}" alt="" referrerpolicy="no-referrer">`;
    lb.innerHTML = `
      <div class="lb-top">${av(person(p.byId) || { name: p.by, color: '#8e97c0' }, 34)}
        <div style="flex:1"><b>${esc(p.by || 'אורח')}</b><div class="small muted">${new Date(p.t).toLocaleString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</div></div>
        <a class="icon-btn" href="https://drive.google.com/file/d/${encodeURIComponent(p.id)}/view" target="_blank" rel="noopener" aria-label="פתיחה בדרייב">${ICON.drive}</a>
        <button class="icon-btn" data-x aria-label="סגירה">${ICON.close}</button></div>
      <div class="lb-img">${media}</div>
      <div class="lb-nav"><button class="btn ghost" data-n="-1" ${i === 0 ? 'disabled' : ''}>הקודמת</button><span class="muted">${i + 1} / ${list.length}</span><button class="btn ghost" data-n="1" ${i === list.length - 1 ? 'disabled' : ''}>הבאה</button></div>`;
    $('[data-x]', lb).onclick = () => lb.remove();
    $$('[data-n]', lb).forEach((b) => (b.onclick = () => { i = Math.max(0, Math.min(list.length - 1, i + +b.dataset.n)); show(); }));
  };
  // swipe
  let sx = null;
  lb.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 60) { i = Math.max(0, Math.min(list.length - 1, i + (dx > 0 ? 1 : -1))); show(); }
  });
  show(); document.body.append(lb);
}

function renderQueue() {
  $('#upload-q').innerHTML = queue.filter((q) => q.state !== 'gone').map((q) => `
    <div class="row"><div class="grow"><span class="title" style="font-weight:600">${esc(q.file.name)}</span></div>
    <span class="small" style="color:${q.state === 'error' ? 'var(--rose)' : q.state === 'done' ? 'var(--moon)' : 'var(--sand-dim)'}">${{
      wait: 'ממתין', prep: 'מכין…', up: 'מעלה…', done: 'הועלה', error: q.err || 'נכשל', retry: 'מנסה שוב…',
    }[q.state]}</span></div>`).join('');
}
function enqueue(file) {
  if (!config.photos) { toast('העלאת תמונות עוד לא מחוברת'); return; }
  if (!me) { showGate(); return; }
  queue.push({ file, state: 'wait' }); renderQueue(); pump();
}
let pumping = false;
async function pump() {
  if (pumping) return; pumping = true;
  for (const q of queue) {
    if (q.state !== 'wait') continue;
    try {
      q.state = 'prep'; renderQueue();
      let data, mime;
      if (q.file.type.startsWith('video/')) {
        if (q.file.size > 35e6) throw Object.assign(new Error(), { msg: 'וידאו מעל 35MB – העלו ישירות לתיקייה' });
        data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.onerror = rej; fr.readAsDataURL(q.file); });
        mime = q.file.type;
      } else {
        data = (await resizeImage(q.file, 2560, 0.86)).split(',')[1]; mime = 'image/jpeg';
      }
      let ok = false;
      for (let a = 0; a < 3 && !ok; a++) {
        q.state = a ? 'retry' : 'up'; renderQueue();
        try {
          const r = await fetch('/api/photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, mime, by: me, name: q.file.name }) });
          ok = r.ok;
        } catch { /* network */ }
        if (!ok) await new Promise((r) => setTimeout(r, 3000 * (a + 1)));
      }
      if (!ok) throw Object.assign(new Error(), { msg: 'נכשל – בדקו קליטה' });
      q.state = 'done';
    } catch (e) {
      q.state = 'error'; q.err = e.msg || 'הקובץ לא נתמך';
    }
    renderQueue();
  }
  pumping = false;
  setTimeout(() => { queue.forEach((q) => { if (q.state === 'done') q.state = 'gone'; }); renderQueue(); }, 4000);
  loadPhotos(true);
}

// ---------- boot ----------
mountSections();
go(route);
fetch('/api/config').then((r) => r.json()).then((c) => { config = c; renderVoice(); if (route === 'photos') loadPhotos(); else renderPhotos(); }).catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
