/* טיול 23-24/10 – client */
import { PLACES, REGIONS, locate } from '/places.js';
import { BINGO } from '/games-data.js';

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
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
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
const COLLS = ['people', 'tasks', 'supplies', 'locations', 'pins', 'info', 'news', 'kids'];
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
  if (coll === 'locations' && !lastPos && doc.sharing && route === 'home') setTimeout(renderHome, 0);
  const prev = S[coll].get(doc.id);
  S[coll].set(doc.id, doc);
  if (by && by !== me) notifyChange(coll, prev, doc, by);
  renderColl(coll);
});
socket.on('remove', ({ coll, id }) => {
  S[coll].delete(id);
  if (coll === 'people' && id === me) { me = null; ls.set('trip.me', null); closeSheet(); showGate(); }
  if (coll === 'people') renderGate();
  renderColl(coll);
});
let sheetStatus = null;
socket.on('sheet', (st) => { sheetStatus = st; if (route === 'gear') renderSheetBar(); });
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
const ROUTES = ['home', 'tasks', 'gear', 'map', 'voice', 'photos', 'games'];
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
      <div class="seg" id="gear-seg" role="group" aria-label="סוג ציוד">
        <button data-scope="shared">ציוד לכולם <span class="n"></span></button>
        <button data-scope="personal">ציוד אישי <span class="n"></span></button>
      </div>
      <p class="page-sub" id="gear-sub" style="margin-top:0"></p>
      <div class="panel share-toggle" id="sheet-bar" hidden></div>
      <div class="panel" id="gear-progress"></div>
      <form class="add-bar" id="gear-form">
        <input class="input" name="item" placeholder="פריט, למשל: פטיש ליתדות" maxlength="140" autocomplete="off">
        <select class="input" id="gear-cat" hidden style="flex:0 0 auto;width:auto"></select>
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
    <section id="sec-games">
      <h1 class="page-title">משחקים</h1>
      <p class="page-sub">משחקים חיים לילדים – כל אחד משחק מהטלפון של ההורה, והנקודות נצברות בטבלה.</p>
      <div class="panel" id="player-bar"></div>
      <div class="panel" id="game-live"></div>
      <div class="panel"><div class="panel-head"><h2>בינגו מדבר</h2><span class="small muted">מסמנים מה ראיתם בדרך</span></div><div id="bingo"></div></div>
      <div class="panel board"><div class="panel-head"><h2>טבלת האלופים</h2></div><div id="kids-board"></div></div>
    </section>
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
  renderMe(); renderHome(); renderTasks(); renderGear(); renderWhere(); updateMarkers(); renderVoice(); renderDots(); renderGames();
  if (route === 'photos') renderPhotos();
}
function renderColl(c) {
  if (c === 'people') return renderAll();
  if (c === 'tasks') { renderTasks(); renderHome(); }
  if (c === 'supplies') { renderGear(); renderHome(); }
  if (c === 'info' || c === 'news') renderHome();
  if (c === 'kids') renderGames();
  if (c === 'locations' || c === 'pins') { updateMarkers(); renderWhere(); }
  renderDots();
}
function renderDots() {
  const wanted = [...S.tasks.values()].filter((t) => !t.done && !t.owners?.length).length;
  const unclaimed = [...S.supplies.values()].filter((s) => s.scope !== 'personal' && !(s.bringerText?.trim() || s.bringer)).length;
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
const rsvpOf = (p) => p.rsvp || (p.companions?.trim() ? 'with' : 'unknown');
const partySize = (p) => { const r = rsvpOf(p); return r === 'no' ? 0 : 1 + (r === 'with' ? countCompanions(p.companions) : 0); };
function rsvpLine(p) {
  const r = rsvpOf(p);
  if (r === 'no') return 'לא מגיע';
  if (r === 'solo') return 'מגיע לבד';
  if (r === 'with') return p.companions?.trim() ? `מגיע עם ${esc(p.companions)} · ${partySize(p)} אנשים` : 'מגיע עם עוד אנשים';
  return '<span style="color:var(--ember-2)">עוד לא עדכן</span>';
}
let countdownTimer;
function renderHome() {
  const i = info();
  const ppl = sortedPeople();
  const head = ppl.reduce((n, p) => n + partySize(p), 0);
  const pending = ppl.filter((p) => rsvpOf(p) === 'unknown').length;
  const tasks = [...S.tasks.values()];
  const supplies = [...S.supplies.values()];
  const openTasks = tasks.filter((t) => !t.done).length;
  const wanted = tasks.filter((t) => !t.done && !t.owners?.length).length;
  const unclaimed = supplies.filter((s) => s.scope !== 'personal' && !(s.bringerText?.trim() || s.bringer)).length;
  const personalGear = supplies.filter((s) => s.scope === 'personal');
  const myPacked = personalGear.filter((s) => (s.packedBy || []).includes(me)).length;
  const myTasks = tasks.filter((t) => !t.done && t.owners?.includes(me));
  const myGear = supplies.filter((s) => s.scope !== 'personal' && ((s.bringers || []).includes(me) || s.bringer === me));
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
      <button class="stat" data-go="gear"><b>${unclaimed}</b><span>פריטי ציוד לכולם שאף אחד עוד לא לקח</span></button>
    </div>

    ${me ? `<div class="panel">
      <div class="panel-head"><h2>עליי</h2></div>
      ${myTasks.length || myGear.length ? `
        <dl class="kv">
          <dt>משימות</dt><dd class="${myTasks.length ? '' : 'empty'}">${myTasks.length ? myTasks.map((t) => esc(t.title)).join('\n') : 'אין'}</dd>
          <dt>מביא לכולם</dt><dd class="${myGear.length ? '' : 'empty'}">${myGear.length ? myGear.map((s) => esc(s.item) + (s.qty ? ` (${esc(s.qty)})` : '')).join('\n') : 'כלום עדיין'}</dd>
          ${personalGear.length ? `<dt>ציוד אישי</dt><dd>ארזתי ${myPacked} מתוך ${personalGear.length}</dd>` : ''}
        </dl>` : `<p class="muted" style="margin:0 0 12px">עוד לא לקחת שום דבר.</p>
        <div style="display:flex;gap:8px"><button class="btn small" data-go="tasks">לקחת משימה</button><button class="btn small ghost" data-go="gear">להביא ציוד</button></div>`}
    </div>` : ''}

    ${renderWhereAmI()}

    ${renderNews()}

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
      <div class="panel-head"><h2>מי מגיע</h2><span><span class="headcount">${head}</span> <span class="small muted">אנשים${pending ? ` · ${pending} עוד לא עדכנו` : ''}</span></span></div>
      ${ppl.map((p) => `
        <div class="who-row ${rsvpOf(p) === 'no' ? 'not-coming' : ''}">
          ${av(p, 44)}
          <div class="grow"><b>${esc(p.name)}${p.id === me ? ' <span class="small muted">(אני)</span>' : ''}</b>
          <small>${rsvpLine(p)}</small></div>
          <button class="btn small ghost" data-person="${esc(p.id)}">עריכה</button>
        </div>`).join('')}
      <button class="btn ghost block" id="add-person" style="margin-top:12px">${ICON.plus}הוספת משתתף</button>
    </div>`;

  $('#edit-info').onclick = editInfo;
  $('#locate-once')?.addEventListener('click', locateOnce);
  $('#speak-here')?.addEventListener('click', (e) => speak($('.where-card .place-text')?.textContent || '', e.currentTarget));
  $$('#place-tabs button').forEach((b) => (b.onclick = () => { placeTab = b.dataset.t; ls.set('trip.placeTab', placeTab); renderHome(); }));
  $('#add-person').onclick = () => personSheet(null);
  $$('#sec-home [data-person]').forEach((b) => (b.onclick = () => personSheet(person(b.dataset.person))));
  tickCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(tickCountdown, 30000);
}
function renderNews() {
  const news = [...S.news.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6);
  if (!news.length) return '';
  return `<div class="panel">
    <div class="panel-head"><h2>עדכונים מהקבוצה</h2><span class="small muted">מהווטסאפ, כל 10 דק׳</span></div>
    ${news.map((n) => `<div class="news-row">${n.who && person(n.who) ? av(person(n.who), 28) : '<span class="news-dot"></span>'}
      <div class="grow"><div>${esc(n.text)}</div><small class="muted">${ago(n.createdAt)}</small></div></div>`).join('')}
  </div>`;
}
// ---------- where are we (places south of Be'er Sheva) ----------
let geoPos = null;
let placeTab = ls.get('trip.placeTab') || 'geo';
const PLACE_TABS = { geo: 'גאוגרפיה', history: 'היסטוריה', kids: 'לילדים' };
function refPos() {
  if (lastPos) return { lat: lastPos.lat, lng: lastPos.lng, src: 'me' };
  const mine = S.locations.get(me); if (mine) return { lat: mine.lat, lng: mine.lng, src: 'me' };
  if (geoPos) return { ...geoPos, src: 'me' };
  const other = [...S.locations.values()].filter((l) => l.sharing).sort((a, b) => b.t - a.t)[0];
  return other ? { lat: other.lat, lng: other.lng, src: other.id } : null;
}
function locateOnce() {
  if (!navigator.geolocation) return toast('הדפדפן לא תומך במיקום');
  toast('מאתר מיקום…');
  navigator.geolocation.getCurrentPosition((p) => { geoPos = { lat: p.coords.latitude, lng: p.coords.longitude }; renderHome(); checkArrival(geoPos); },
    () => toast('לא קיבלנו מיקום. אפשרו גישה למיקום בדפדפן.'), { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
}
function renderWhereAmI() {
  const pos = refPos();
  if (!pos) return `<div class="panel where-card"><div class="panel-head"><h2>איפה אנחנו?</h2></div>
    <p class="muted" style="margin:0 0 12px">שתפו מיקום או זהו אותו פעם אחת, ונספר לכם על המקום: גאוגרפיה, היסטוריה ופינה לילדים.</p>
    <button class="btn small teal" id="locate-once">זיהוי מיקום</button></div>`;
  const { inside, nearest, region } = locate(pos);
  const subject = inside || region;
  const by = pos.src !== 'me' && person(pos.src) ? ` · לפי המיקום של ${esc(firstName(person(pos.src)))}` : '';
  const near = `<div class="near">${nearest.slice(0, 3).map((p) => `<button class="chip" data-place="${p.id}">${esc(p.name)} · ${fmtDist(p.d)}</button>`).join('')}</div>`;
  if (!subject) return `<div class="panel where-card"><div class="panel-head"><h2>איפה אנחנו?</h2></div>
    <p class="muted" style="margin:0 0 10px">אתם מחוץ לאזורים שהמדריך מכיר (דרומית לבאר שבע וים המלח)${by}. המקומות הכי קרובים:</p>${near}</div>`;
  return `<div class="panel where-card">
    <small class="muted">${inside ? 'אתם עכשיו ב' : 'האזור שבו אתם'}${by}</small>
    <h2 class="where-title">${esc(subject.name)}</h2>
    ${inside && region ? `<span class="region-tag">${esc(region.name)}</span>` : ''}
    <div class="seg" id="place-tabs" style="margin-top:12px">${Object.entries(PLACE_TABS).map(([k, v]) => `<button data-t="${k}" aria-pressed="${placeTab === k}">${v}</button>`).join('')}</div>
    <p class="place-text">${esc(subject[placeTab] || subject.geo)}</p>
    <button class="btn small ghost speak" id="speak-here">🔊 הקראה</button>
    <small class="muted">${inside ? 'עוד מקומות קרובים' : 'מקומות קרובים'}</small>${near}
  </div>`;
}
function placeSheet(id) {
  const p = PLACES.find((x) => x.id === id); if (!p) return;
  const region = REGIONS.find((g) => g.id === p.region);
  const pos = refPos();
  const d = pos ? fmtDist(distKm(pos, p)) : '';
  openSheet(`
    <h3>${esc(p.name)}</h3>
    <p class="small muted" style="margin:-8px 0 14px">${esc(region?.name || '')}${d ? ` · ${d} מכם` : ''}</p>
    <div class="place-sec"><b>גאוגרפיה</b><p>${esc(p.geo)}</p></div>
    <div class="place-sec"><b>היסטוריה</b><p>${esc(p.history)}</p></div>
    <div class="place-sec kids"><b>לילדים</b><p>${esc(p.kids)}</p></div>
    <div class="actions">
      <button class="btn teal speak" id="speak-all">🔊 הקראה</button>
      <a class="btn ghost" href="https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes" target="_blank" rel="noopener">Waze</a>
    </div>`, (r) => {
    $('#speak-all', r).onclick = (e) => speak(`${p.name}. ${p.geo} ${p.history} ${p.kids}`, e.currentTarget);
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-place]');
  if (b) { e.preventDefault(); map?.closePopup(); placeSheet(b.dataset.place); }
});
function checkArrival(pos) {
  if (!pos) return;
  const { inside } = locate(pos);
  if (!inside || ls.get('trip.lastPlace') === inside.id) return;
  ls.set('trip.lastPlace', inside.id);
  toast(`הגעתם ל<b>${esc(inside.name)}</b> <button class="btn small teal" data-place="${inside.id}">לסקירה</button>`);
  if (route === 'home') renderHome();
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
  const d = p || { name: '', companions: '', color: COLORS[S.people.size % COLORS.length], avatar: '', rsvp: 'unknown' };
  let avatar = d.avatar; let color = d.color; let rsvp = rsvpOf(d);
  openSheet(`
    <h3>${isNew ? 'משתתף חדש' : p.id === me ? 'הפרופיל שלי' : esc(p.name)}</h3>
    <form id="f">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <span id="pv"></span>
        <label class="btn small ghost">החלפת תמונה<input type="file" accept="image/*" id="pf" hidden></label>
      </div>
      <label class="field"><span>שם</span><input class="input" name="name" value="${esc(d.name)}" maxlength="40" required></label>
      <div class="field"><span>מגיע?</span><div class="seg" id="rsvp" style="margin:0">
        <button type="button" data-r="solo">לבד</button>
        <button type="button" data-r="with">עם עוד אנשים</button>
        <button type="button" data-r="no">לא מגיע</button>
      </div></div>
      <label class="field" id="comp-field"><span>מי מגיע איתו (שמות, מופרדים בפסיק)</span><input class="input" name="companions" value="${esc(d.companions)}" placeholder="למשל: עמית, נועה" maxlength="120"></label>
      <p class="small muted" id="party" style="margin:-4px 0 12px"></p>
      <div class="field"><span>צבע על המפה</span><div style="display:flex;gap:10px;flex-wrap:wrap" id="sw">
        ${COLORS.map((c) => `<button type="button" data-c="${c}" aria-label="${c}" style="width:34px;height:34px;border-radius:50%;background:${c};box-shadow:${c === color ? '0 0 0 3px var(--sand)' : 'none'}"></button>`).join('')}
      </div></div>
      <div class="actions"><button class="btn" type="submit">${isNew ? 'הוספה' : 'שמירה'}</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
      ${!isNew && p.id === me ? `<button class="btn ghost block" type="button" id="switch-user" style="margin-top:10px">אני לא ${esc(firstName(p))} – החלפת משתמש</button>` : ''}
      ${!isNew ? `<button class="btn danger block" type="button" id="remove-person" style="margin-top:10px">הסרת ${esc(firstName(p))} מהטיול</button>` : ''}
    </form>`, (root) => {
    const pv = () => ($('#pv', root).innerHTML = av({ ...d, id: '', avatar, color, name: $('[name=name]', root).value || d.name || '?' }, 72));
    pv();
    $('[name=name]', root).oninput = pv;
    $('#pf', root).onchange = async (e) => { const f = e.target.files[0]; if (f) { avatar = await squareAvatar(f); pv(); } };
    $$('#sw button', root).forEach((b) => (b.onclick = () => { color = b.dataset.c; $$('#sw button', root).forEach((x) => (x.style.boxShadow = x === b ? '0 0 0 3px var(--sand)' : 'none')); pv(); }));
    const syncR = () => {
      $$('#rsvp button', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === rsvp));
      $('#comp-field', root).hidden = rsvp !== 'with';
      const n = partySize({ rsvp, companions: $('[name=companions]', root).value });
      $('#party', root).textContent = rsvp === 'unknown' ? 'בחרו אם מגיע.' : rsvp === 'no' ? 'לא נספר במספר האנשים.' : `נספר כ־${n} ${n === 1 ? 'איש' : 'אנשים'}.`;
    };
    $$('#rsvp button', root).forEach((b) => (b.onclick = () => { rsvp = b.dataset.r; syncR(); }));
    $('[name=companions]', root).oninput = syncR;
    syncR();
    $('#remove-person', root)?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!b.dataset.armed) {
        b.dataset.armed = '1'; b.textContent = `בטוח? ${firstName(p)} יוסר גם ממשימות, ציוד ומהמפה – לחצו שוב`;
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = `הסרת ${firstName(p)} מהטיול`; } }, 4000);
        return;
      }
      closeSheet();
      await op('people', 'del', p.id);
      toast(`${esc(firstName(p))} הוסר מהטיול`);
    });
    $('#switch-user', root)?.addEventListener('click', () => { closeSheet(); me = null; ls.set('trip.me', null); showGate(); });
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      const data = { name: e.target.name.value, companions: rsvp === 'with' ? e.target.companions.value : '', rsvp, color, avatar };
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
function closeSheet() { $('#sheet-root').innerHTML = ''; try { speechSynthesis.cancel(); } catch {} }
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
    const del = e.target.closest('.mini.del');
    if (del) { if (confirmInline(del)) op('tasks', 'del', t.id); return; }
    if (e.target.closest('.take')) {
      if (!me) return showGate();
      return toggleIn('tasks', t.id, 'owners', me);
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
        ${wanted ? '<span class="wanted-tag">מחפשת מתנדב</span>' : t.owners?.length ? `<span class="owners"><span class="stack">${t.owners.map((o) => av(person(o), 22)).join('')}</span><span class="meta">${t.owners.map((o) => esc(firstName(person(o)))).join(', ')}</span></span>` : ''}
        ${t.note ? `<div class="meta">${esc(t.note)}</div>` : ''}</div>
      <div class="row-side">
        ${t.done ? '' : `<button class="take ${mine ? 'mine' : ''}">${mine ? 'שלי' : 'אני לוקח'}</button>`}
        <div class="row-tools"><button class="mini edit" aria-label="עריכה">${ICON.edit}</button><button class="mini del" aria-label="מחיקה">${ICON.trash}</button></div>
      </div>
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
  const orig = btn.innerHTML;
  btn.dataset.armed = '1'; btn.textContent = btn.classList.contains('mini') ? 'למחוק?' : 'בטוח? לחצו שוב';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.innerHTML = orig; } }, 3000);
  return false;
}

// ---------- gear ----------
// Two lists: shared gear (one person brings it for everyone) and personal gear (everyone brings their own).
let gearScope = ls.get('trip.gearScope') === 'personal' ? 'personal' : 'shared';
let gearFilter = 'all';
const scopeOf = (s) => (s.scope === 'personal' ? 'personal' : 'shared');
const gearOf = (scope) => [...S.supplies.values()].filter((s) => scopeOf(s) === scope);
const gearCats = (scope) => [...new Set(gearOf(scope).map((s) => s.cat || 'כללי'))];
const packedByMe = (s) => (s.packedBy || []).includes(me);
const sheetMode = () => [...S.supplies.values()].some((s) => s.source === 'sheet');
const bringersOf = (s) => (s.bringers?.length ? s.bringers : s.bringer ? [s.bringer] : []);
const hasBringer = (s) => !!(s.bringerText?.trim() || s.bringer);

function sheetEmit(ev, data, okMsg) {
  socket.timeout(25000).emit(ev, data, (err, res) => {
    if (err) toast('אין קליטה כרגע – נסו שוב');
    else if (!res?.ok) toast('לא נשמר בגיליון: ' + esc(res?.error || 'שגיאה'));
    else if (okMsg) toast(okMsg);
  });
}
function renderSheetBar() {
  const el = $('#sheet-bar'); if (!el) return;
  const st = sheetStatus;
  if (!sheetMode() && !st?.ok) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div class="grow"><b>מסונכרן עם הגיליון</b><div class="small muted">${st?.ok ? 'עודכן ' + ago(st.at) : st?.error ? 'לא מצליח לקרוא את הגיליון כרגע' : 'מתחבר לגיליון…'} · שינויים בגיליון מופיעים כאן תוך שניות</div></div>
    <a class="btn small ghost" href="${esc(st?.url || '#')}" target="_blank" rel="noopener">פתיחת הגיליון</a>`;
}
function renderAddCats() {
  const sel = $('#gear-cat');
  const cols = (sheetStatus?.columns || []).filter((c) => c.scope === gearScope);
  sel.hidden = !sheetMode() || gearScope === 'personal' || cols.length < 2;
  sel.innerHTML = cols.map((c) => `<option value="${c.col}">${esc(c.cat)}</option>`).join('');
}

function toggleIn(coll, id, field, value) {
  socket.timeout(15000).emit('toggle', { coll, id, field, value }, (err, res) => {
    if (err) toast('אין קליטה כרגע – השינוי יישלח כשהחיבור יחזור');
    else if (!res?.ok) toast('לא נשמר: ' + (res?.error || 'שגיאה'));
  });
}

function bindGear() {
  $('#gear-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-scope]'); if (!b) return;
    gearScope = b.dataset.scope; gearFilter = 'all'; ls.set('trip.gearScope', gearScope); renderGear();
  });
  $('#gear-form').onsubmit = async (e) => {
    e.preventDefault();
    const item = e.target.item.value.trim(); if (!item) return;
    e.target.item.value = '';
    if (sheetMode()) {
      const cols = (sheetStatus?.columns || []).filter((c) => c.scope === gearScope);
      const col = gearScope === 'personal' ? cols[0]?.col : +$('#gear-cat').value || cols[0]?.col;
      if (!col) return toast('לא נמצאה עמודה מתאימה בגיליון');
      return sheetEmit('gear:add', { col, text: item }, `נוסף לגיליון: ${esc(item)}`);
    }
    await op('supplies', 'add', null, { item, cat: gearScope === 'personal' ? 'אישי' : 'כללי', scope: gearScope });
  };
  $('#gear-list').addEventListener('click', async (e) => {
    const rowEl = e.target.closest('.row'); if (!rowEl) return;
    const s = S.supplies.get(rowEl.dataset.id); if (!s) return;
    const del = e.target.closest('.mini.del');
    if (del) { if (confirmInline(del)) op('supplies', 'del', s.id); return; }
    if (scopeOf(s) === 'personal') {
      if (e.target.closest('.check')) { if (!me) return showGate(); return toggleIn('supplies', s.id, 'packedBy', me); }
      return s.source === 'sheet' ? undefined : gearSheet(s);
    }
    if (e.target.closest('.check')) return op('supplies', 'patch', s.id, { done: !s.done });
    if (e.target.closest('.take') && s.source === 'sheet') {
      if (!me) return showGate();
      const on = !bringersOf(s).includes(me);
      return sheetEmit('gear:claim', { id: s.id, on });
    }
    if (s.source === 'sheet') return;
    if (e.target.closest('.take')) {
      if (!me) return showGate();
      if (s.bringer && s.bringer !== me) return op('supplies', 'add', null, { item: s.item, cat: s.cat, qty: s.qty, bringer: me, scope: 'shared' });
      return op('supplies', 'patch', s.id, { bringer: s.bringer === me ? null : me });
    }
    gearSheet(s);
  });
}

function renderGear() {
  renderSheetBar(); renderAddCats();
  $$('#gear-seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.scope === gearScope));
  const shared = gearOf('shared'); const personal = gearOf('personal');
  $('#gear-seg [data-scope=shared] .n').textContent = shared.length;
  $('#gear-seg [data-scope=personal] .n').textContent = personal.length;
  const input = $('#gear-form input');
  input.placeholder = gearScope === 'personal' ? 'מה כל אחד צריך להביא? למשל: כפפות' : 'מה צריך לקבוצה? למשל: פטיש ליתדות';
  $('#gear-sub').textContent = gearScope === 'personal'
    ? 'כל אחד מביא לעצמו. מסמנים ✓ על מה שארזתם – כל אחד רואה רק את הסימון שלו.'
    : sheetMode() ? 'הרשימה מגיעה מהגיליון. ״אני מביא״ כותב את השם שלך בעמודת האחראי, בלי למחוק אף אחד אחר.' : 'ציוד לכולם: מישהו אחד מביא לכל הקבוצה. לוחצים ״אני מביא״ על מה שלוקחים.';

  if (gearScope === 'personal') {
    const mine = personal.filter(packedByMe).length;
    const others = sortedPeople().length;
    $('#gear-progress').innerHTML = `
      <div style="display:flex;justify-content:space-between;font-weight:700"><span>ארזתי</span><span>${mine} מתוך ${personal.length}</span></div>
      <div class="progress"><i style="width:${personal.length ? (mine / personal.length) * 100 : 0}%"></i></div>
      <div class="small muted" style="margin-top:6px">${mine === personal.length && personal.length ? 'הכול ארוז. אפשר לצאת!' : 'הסימון שלך אישי. ליד כל פריט רואים כמה מתוך ' + others + ' כבר ארזו.'}</div>`;
    const labels = { all: 'הכול', todo: 'עוד לא ארזתי' };
    const counts = { all: personal.length, todo: personal.filter((s) => !packedByMe(s)).length };
    $('#gear-chips').innerHTML = Object.keys(labels).map((k) => `<button class="chip" data-f="${k}" aria-pressed="${gearFilter === k}">${labels[k]} ${counts[k]}</button>`).join('');
    $$('#gear-chips .chip').forEach((c) => (c.onclick = () => { gearFilter = c.dataset.f; renderGear(); }));
    const list = personal.filter((s) => gearFilter === 'all' || !packedByMe(s)).sort((a, b) => (packedByMe(a) - packedByMe(b)) || ((a.order ?? a.createdAt) - (b.order ?? b.createdAt)));
    $('#gear-list').innerHTML = list.length ? `<div class="list">${list.map((s) => {
      const packed = packedByMe(s);
      const who = (s.packedBy || []).filter((id) => S.people.has(id));
      return `<div class="row ${packed ? 'done' : ''}" data-id="${esc(s.id)}">
        <button class="check" role="checkbox" aria-checked="${packed}" aria-label="ארזתי">${ICON.check}</button>
        <div class="grow"><span class="title">${esc(s.item)}${s.qty ? ` <span class="meta">× ${esc(s.qty)}</span>` : ''}</span>
          ${who.length ? `<span class="owners"><span class="stack">${who.slice(0, 6).map((id) => av(person(id), 22)).join('')}</span><span class="meta">${who.length} ארזו</span></span>` : '<span class="meta">אף אחד עוד לא ארז</span>'}</div>
        ${s.source === 'sheet' ? '' : `<div class="row-side"><div class="row-tools"><button class="mini edit" aria-label="עריכה">${ICON.edit}</button><button class="mini del" aria-label="מחיקה">${ICON.trash}</button></div></div>`}
      </div>`;
    }).join('')}</div>` : `<div class="empty-state">${gearFilter === 'todo' ? 'ארזת הכול!' : 'אין עדיין ציוד אישי. הוסיפו פריט למעלה.'}</div>`;
    return;
  }

  const claimed = shared.filter(hasBringer).length;
  const packed = shared.filter((s) => s.done).length;
  $('#gear-progress').innerHTML = `
    <div style="display:flex;justify-content:space-between;font-weight:700"><span>יש מי שמביא</span><span>${claimed} מתוך ${shared.length}</span></div>
    <div class="progress"><i style="width:${shared.length ? (claimed / shared.length) * 100 : 0}%"></i></div>
    <div class="small muted" style="margin-top:6px">${packed} פריטים כבר ארוזים</div>`;
  const labels = { all: 'הכול', none: 'בלי מביא', mine: 'מה אני מביא' };
  const counts = { all: shared.length, none: shared.filter((s) => !hasBringer(s)).length, mine: shared.filter((s) => bringersOf(s).includes(me)).length };
  if (!labels[gearFilter]) gearFilter = 'all';
  $('#gear-chips').innerHTML = Object.keys(labels).map((k) => `<button class="chip" data-f="${k}" aria-pressed="${gearFilter === k}">${labels[k]} ${counts[k]}</button>`).join('');
  $$('#gear-chips .chip').forEach((c) => (c.onclick = () => { gearFilter = c.dataset.f; renderGear(); }));
  const list = shared.filter((s) => gearFilter === 'all' || (gearFilter === 'none' && !hasBringer(s)) || (gearFilter === 'mine' && bringersOf(s).includes(me)));
  const catOrder = (c) => Math.min(...shared.filter((s) => (s.cat || 'כללי') === c).map((s) => s.order ?? Infinity));
  const cats = gearCats('shared').filter((c) => list.some((s) => (s.cat || 'כללי') === c)).sort((a, b) => catOrder(a) - catOrder(b));
  $('#gear-list').innerHTML = cats.length ? cats.map((c) => `
    <h3 class="cat-title">${esc(c)}</h3>
    <div class="list">${list.filter((s) => (s.cat || 'כללי') === c).sort((a, b) => (a.done - b.done) || ((a.order ?? a.createdAt) - (b.order ?? b.createdAt))).map((s) => {
      const bs = bringersOf(s);
      const mine = bs.includes(me);
      const fromSheet = s.source === 'sheet';
      const who = fromSheet
        ? (s.bringerText?.trim() ? `<span class="owners">${bs.length ? `<span class="stack">${bs.map((id) => av(person(id), 22)).join('')}</span>` : ''}<span class="meta">${esc(s.bringerText)}</span></span>` : '<span class="wanted-tag">צריך מישהו שיביא</span>')
        : (s.bringer ? `<span class="owners">${av(person(s.bringer), 22)}<span class="meta">${esc(firstName(person(s.bringer)))} מביא</span></span>` : '<span class="wanted-tag">צריך מישהו שיביא</span>');
      const take = fromSheet && !s.sheetRespCol ? '' : `<button class="take ${mine ? 'mine' : ''}">${mine ? 'אני מביא' : hasBringer(s) ? 'גם אני' : 'אני מביא'}</button>`;
      return `<div class="row ${s.done ? 'done' : ''} ${!hasBringer(s) ? 'wanted' : ''}" data-id="${esc(s.id)}">
        <button class="check" role="checkbox" aria-checked="${!!s.done}" aria-label="ארוז">${ICON.check}</button>
        <div class="grow"><span class="title">${esc(s.item)}${s.qty ? ` <span class="meta">× ${esc(s.qty)}</span>` : ''}</span>${who}</div>
        <div class="row-side">
          ${take}
          ${fromSheet ? '' : `<div class="row-tools"><button class="mini edit" aria-label="עריכה">${ICON.edit}</button><button class="mini del" aria-label="מחיקה">${ICON.trash}</button></div>`}
        </div>
      </div>`;
    }).join('')}</div>`).join('') : `<div class="empty-state">${gearFilter === 'mine' ? 'עוד לא לקחת שום ציוד.' : 'הרשימה ריקה. הוסיפו פריט למעלה.'}</div>`;
}

function gearSheet(s) {
  const bringer = s.bringer ? [s.bringer] : [];
  let scope = scopeOf(s);
  const cats = gearCats(scope);
  openSheet(`
    <h3>עריכת פריט</h3>
    <form id="f">
      <label class="field"><span>פריט</span><input class="input" name="item" value="${esc(s.item)}" maxlength="140" required></label>
      <div class="field"><span>סוג</span><div class="seg" id="scope-seg" style="margin:0">
        <button type="button" data-scope="shared" aria-pressed="${scope === 'shared'}">ציוד לכולם</button>
        <button type="button" data-scope="personal" aria-pressed="${scope === 'personal'}">ציוד אישי</button>
      </div></div>
      <div style="display:flex;gap:10px">
        <label class="field" style="flex:1"><span>כמות</span><input class="input" name="qty" value="${esc(s.qty)}" maxlength="30" placeholder="למשל: 2"></label>
        <label class="field" style="flex:2" id="cat-field"><span>קטגוריה</span><input class="input" name="cat" value="${esc(s.cat || 'כללי')}" list="cats" maxlength="30"></label>
        <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>
      <div class="field" id="bringer-field"><span>מי מביא</span>${peoplePicker(bringer, false)}</div>
      <div class="actions"><button class="btn" type="submit">שמירה</button><button class="btn danger" type="button" id="del">מחיקה</button></div>
    </form>`, (root) => {
    bindPicker(root, bringer, false);
    const sync = () => {
      $$('#scope-seg button', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.scope === scope));
      $('#bringer-field', root).hidden = scope === 'personal';
      $('#cat-field', root).hidden = scope === 'personal';
    };
    $$('#scope-seg button', root).forEach((b) => (b.onclick = () => { scope = b.dataset.scope; sync(); }));
    sync();
    $('#del', root).onclick = async () => { if (confirmInline($('#del', root))) { closeSheet(); await op('supplies', 'del', s.id); } };
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault();
      closeSheet();
      const data = { item: e.target.item.value, qty: e.target.qty.value, scope };
      if (scope === 'shared') Object.assign(data, { cat: e.target.cat.value, bringer: bringer[0] || null });
      else Object.assign(data, { cat: 'אישי', bringer: null });
      await op('supplies', 'patch', s.id, data);
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
  if (!poiLayer) {
    poiLayer = L.layerGroup(PLACES.map((p) => L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: '<div class="poi"></div>' }), zIndexOffset: -500,
    }).bindPopup(`<b>${esc(p.name)}</b><br><button class="btn small teal" style="margin-top:8px" data-place="${p.id}">סקירה גאוגרפית והיסטורית</button>`))).addTo(map);
  }
}
let poiLayer = null;
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
    checkArrival(lastPos);
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
fetch('/api/config').then((r) => r.json()).then((c) => { config = c; sheetStatus = c.gearSheet || null; renderGear(); renderVoice(); if (route === 'photos') loadPhotos(); else renderPhotos(); }).catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ---------- games (kids) ----------
let game = null;
let currentKid = ls.get('trip.kid');
const kidOf = (id) => S.kids.get(id);
const myKids = () => [...S.kids.values()].filter((k) => k.parent === me);
function kidAv(k, s = 24) { return av({ id: k?.id, name: k?.name || '?', color: person(k?.parent)?.color || '#7fe0d2' }, s); }
function setKid(id) {
  currentKid = id; ls.set('trip.kid', id); socket.emit('kid:select', id || '');
  renderGames();
}
socket.on('connect', () => { if (currentKid) socket.emit('kid:select', currentKid); });
socket.on('game', (g) => {
  const was = game?.phase;
  game = g;
  if (g && route !== 'games' && was !== g.phase && (g.phase === 'question' && g.idx === 0 || g.phase === 'compose')) {
    toast(`🎲 התחיל משחק: ${g.type === 'trivia' ? 'חידון מדבר' : 'אמת או שקר'} <button class="btn small" data-go="games">להצטרף</button>`);
  }
  $('#dot-game')?.classList.toggle('show', !!g && g.phase !== 'end');
  renderGames();
});
socket.on('bingo', ({ name }) => toast(`🎉 בינגו! ${esc(name)} השלים שורה וקיבל 150 נקודות`));
const gemit = (ev, d) => new Promise((r) => socket.timeout(10000).emit(ev, d, (err, res) => {
  if (err) toast('אין קליטה כרגע'); else if (res && !res.ok && res.error) toast(esc(res.error));
  r(res);
}));

let gameTimer;
function renderGames() {
  const root = $('#sec-games'); if (!root) return;
  clearInterval(gameTimer);
  // player bar
  const k = kidOf(currentKid);
  if (currentKid && !k) { currentKid = null; ls.set('trip.kid', null); }
  const all = [...S.kids.values()].sort((a, b) => (a.parent === me ? -1 : 0) - (b.parent === me ? -1 : 0) || a.name.localeCompare(b.name, 'he'));
  const suggest = (meP()?.companions || '').replace(/\s+ו(?=\S)/g, ',').split(/[,،+]/).map((x) => x.trim()).filter((n) => n && !all.some((x) => x.name === n));
  $('#player-bar').innerHTML = `
    <div class="panel-head" style="margin-bottom:8px"><h2>מי משחק בטלפון הזה?</h2></div>
    <div class="player-bar">
      ${all.map((x) => `<button class="kid-chip" data-kid="${esc(x.id)}" aria-pressed="${x.id === currentKid}">${kidAv(x)}${esc(x.name)}</button>`).join('')}
      ${suggest.map((n) => `<button class="kid-chip add" data-addkid="${esc(n)}">+ ${esc(n)}</button>`).join('')}
      <button class="kid-chip add" id="add-kid">+ ילד/ה</button>
    </div>
    ${!all.length ? '<p class="small muted" style="margin:10px 0 0">מוסיפים את הילדים פעם אחת, ואז כל טלפון בוחר מי משחק בו.</p>' : ''}`;
  $$('#player-bar [data-kid]').forEach((b) => (b.onclick = () => setKid(b.dataset.kid === currentKid ? null : b.dataset.kid)));
  $$('#player-bar [data-addkid]').forEach((b) => (b.onclick = async () => { const d = await op('kids', 'add', null, { name: b.dataset.addkid, parent: me }); if (d) setKid(d.id); }));
  $('#add-kid').onclick = () => openSheet(`<h3>ילד/ה חדש/ה</h3>
    <label class="field"><span>שם</span><input class="input" id="kn" maxlength="30" placeholder="למשל: עמית"></label>
    <div class="actions"><button class="btn" id="ks">הוספה</button><button class="btn ghost" data-close>ביטול</button></div>`, (r) => {
    $('#ks', r).onclick = async () => { const n = $('#kn', r).value.trim(); if (!n) return; closeSheet(); const d = await op('kids', 'add', null, { name: n, parent: me }); if (d) setKid(d.id); };
  });

  // live game / launcher
  const live = $('#game-live');
  if (!game) {
    live.innerHTML = `<div class="launch">
      <button data-start="trivia"><span class="ic">🧠</span><span><b>חידון מדבר</b><small>8 שאלות על המדבר, החיות והמקומות. מי שעונה נכון ומהר – מקבל יותר נקודות.</small></span></button>
      <button data-start="tf"><span class="ic">🤥</span><span><b>אמת או שקר</b><small>כל ילד כותב שני משפטים על עצמו – אחד אמת ואחד שקר. כולם מנחשים.</small></span></button>
    </div>`;
    $$('[data-start]', live).forEach((b) => (b.onclick = () => gemit('game:start', { type: b.dataset.start, by: me })));
  } else if (game.type === 'trivia') renderTrivia(live);
  else if (game.type === 'tf') renderTF(live);

  renderBingo();
  // leaderboard
  const board = [...S.kids.values()].sort((a, b) => (b.points || 0) - (a.points || 0));
  $('#kids-board').innerHTML = board.length ? board.map((x, i) => `
    <div class="who-row">${kidAv(x, 40)}<div class="grow"><b>${['🥇', '🥈', '🥉'][i] || ''} ${esc(x.name)} <small>${person(x.parent) ? '· של ' + esc(firstName(person(x.parent))) : ''}</small></b></div><span class="pts">${x.points || 0}</span></div>`).join('')
    : '<p class="muted" style="margin:0">עוד אין שחקנים. הוסיפו ילדים למעלה.</p>';
}
const stopBtn = '<button class="btn small ghost" data-gstop>סיום משחק</button>';
function bindStop(el) { $$('[data-gstop]', el).forEach((b) => (b.onclick = () => gemit('game:stop'))); }
const needKid = () => (currentKid ? '' : '<p class="small" style="color:var(--ember-2);margin:0 0 10px">בחרו למעלה מי משחק בטלפון הזה כדי להשתתף.</p>');

function renderTrivia(el) {
  const g = game; const mine = g.answers?.[currentKid];
  const answered = (g.answered || []).includes(currentKid);
  if (g.phase === 'end') {
    const top = Object.entries(g.round || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    el.innerHTML = `<div class="q-head"><span>החידון נגמר!</span>${stopBtn}</div>
      ${top.length ? `<div class="podium">${top.map(([id, p], i) => `<div class="p">${kidAv(kidOf(id), 48)}<span>${esc(kidOf(id)?.name || '?')}</span><div class="bar" style="height:${[110, 80, 60][i]}px">${i + 1}</div><small>${p} נק׳</small></div>`).join('')}</div>` : '<p>אף אחד לא צבר נקודות הפעם 🙂</p>'}
      <button class="btn block" data-again>עוד סיבוב</button>`;
    $('[data-again]', el).onclick = async () => { await gemit('game:stop'); gemit('game:start', { type: 'trivia', by: me }); };
    return bindStop(el);
  }
  const revealed = g.phase === 'reveal';
  el.innerHTML = `${needKid()}
    <div class="q-head"><span>שאלה ${g.idx + 1} מתוך ${g.total}</span><span>ענו: ${(g.answered || []).length}</span></div>
    ${revealed ? '' : '<div class="timebar"><i id="tb"></i></div>'}
    <div class="q-text">${esc(g.q)}</div>
    <div class="opts ${revealed ? 'revealed' : ''}">${g.o.map((o, i) => `<button data-a="${i}" class="${revealed && i === g.answer ? 'right' : ''} ${(revealed ? mine?.choice : pickedNow) === i ? 'picked' : ''}" ${answered || revealed || !currentKid ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</div>
    ${revealed ? `<div class="fact">💡 ${esc(g.fact)}</div>
      <div class="gains">${Object.entries(g.gained || {}).map(([id, p]) => `<span class="gain">${esc(kidOf(id)?.name || '?')} +${p}</span>`).join('') || '<span class="small muted">אף אחד לא צדק הפעם</span>'}</div>` : ''}
    <div class="actions"><button class="btn ghost" data-gnext>${revealed ? 'לשאלה הבאה' : 'לגלות תשובה'}</button>${stopBtn}</div>`;
  $$('[data-a]', el).forEach((b) => (b.onclick = async () => { pickedNow = +b.dataset.a; renderTrivia(el); await gemit('trivia:answer', { kidId: currentKid, choice: +b.dataset.a }); }));
  $('[data-gnext]', el).onclick = () => gemit('trivia:next');
  bindStop(el);
  if (!revealed) {
    const tick = () => { const t = $('#tb'); if (!t) return; t.style.width = Math.max(0, (g.endsAt - Date.now()) / 200) + '%'; };
    tick(); gameTimer = setInterval(tick, 250);
  } else pickedNow = null;
}
let pickedNow = null;

function renderTF(el) {
  const g = game; const teller = kidOf(g.teller);
  if (g.phase === 'compose') {
    el.innerHTML = `${needKid()}<div class="q-head"><span>אמת או שקר – מי מספר?</span>${stopBtn}</div>
      <p class="muted" style="margin:8px 0 12px">הילד שמספר כותב שני משפטים על עצמו: אחד אמת ואחד שקר. כולם ינחשו מה האמת.</p>
      ${currentKid ? `<label class="field"><span>משפט ראשון</span><input class="input" id="tfa" maxlength="160" placeholder="למשל: פעם ראיתי נחש בגינה"></label>
      <label class="field"><span>משפט שני</span><input class="input" id="tfb" maxlength="160" placeholder="למשל: אני יודע לשרוק עם שתי אצבעות"></label>
      <div class="field"><span>איזה מהם אמת?</span><div class="seg" id="tft" style="margin:0"><button type="button" data-t="0" aria-pressed="true">הראשון</button><button type="button" data-t="1" aria-pressed="false">השני</button></div></div>
      <button class="btn block" id="tfs">שליחה – ${esc(kidOf(currentKid)?.name || '')} מספר/ת</button>` : ''}`;
    let t = 0;
    $$('#tft button', el).forEach((b) => (b.onclick = () => { t = +b.dataset.t; $$('#tft button', el).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
    $('#tfs', el)?.addEventListener('click', () => gemit('tf:submit', { kidId: currentKid, a: $('#tfa', el).value, b: $('#tfb', el).value, trueIdx: t }));
    return bindStop(el);
  }
  const reveal = g.phase === 'tfreveal';
  const isTeller = currentKid === g.teller;
  const myVote = g.votes?.[currentKid] ?? tfPick;
  el.innerHTML = `${needKid()}<div class="q-head"><span>${kidAv(teller, 24)} ${esc(teller?.name || '?')} מספר/ת</span><span>ניחשו: ${(g.voted || []).length}</span></div>
    <div class="tf-cards">${g.statements.map((st, i) => `<button data-v="${i}" class="${reveal ? (i === g.trueIdx ? 'true' : 'false') : ''} ${myVote === i ? 'picked' : ''}" ${reveal || isTeller || !currentKid ? 'disabled' : ''}>
      ${reveal ? `<span class="tag">${i === g.trueIdx ? '✅ אמת' : '❌ שקר'}</span>` : ''}${esc(st)}</button>`).join('')}</div>
    ${isTeller && !reveal ? '<p class="muted" style="margin:0 0 10px">אל תגלו! מחכים שכולם ינחשו.</p>' : ''}
    ${reveal ? `<div class="gains">${Object.entries(g.gained || {}).map(([id, p]) => `<span class="gain">${esc(kidOf(id)?.name || '?')} +${p}</span>`).join('') || '<span class="small muted">אין נקודות בסיבוב הזה</span>'}</div>` : ''}
    <div class="actions">${reveal ? '<button class="btn" data-tfnext>הבא בתור</button>' : '<button class="btn" data-tfrev>לגלות את האמת</button>'}${stopBtn}</div>`;
  $$('[data-v]', el).forEach((b) => (b.onclick = () => { tfPick = +b.dataset.v; renderTF(el); gemit('tf:vote', { kidId: currentKid, pick: +b.dataset.v }); }));
  $('[data-tfrev]', el)?.addEventListener('click', () => gemit('tf:reveal'));
  $('[data-tfnext]', el)?.addEventListener('click', () => { tfPick = null; gemit('tf:next'); });
  bindStop(el);
}
let tfPick = null;

// bingo: a card per phone, kept in the browser
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function bingoCard() {
  let c = null; try { c = JSON.parse(ls.get('trip.bingo') || 'null'); } catch {}
  if (!c || c.items?.length !== 9) {
    const pool = [...BINGO]; for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    c = { items: pool.slice(0, 9), on: [], claimed: [] }; ls.set('trip.bingo', JSON.stringify(c));
  }
  return c;
}
function renderBingo() {
  const el = $('#bingo'); if (!el) return;
  const c = bingoCard();
  const wins = LINES.filter((l) => l.every((i) => c.on.includes(i)));
  const newWin = wins.find((l) => !c.claimed.includes(l.join()));
  el.innerHTML = `<div class="bingo">${c.items.map((it, i) => `<button data-b="${i}" class="${c.on.includes(i) ? 'on' : ''} ${wins.some((l) => l.includes(i)) ? 'win' : ''}">${esc(it)}</button>`).join('')}</div>
    <div class="actions">${newWin ? '<button class="btn" id="bingo-claim">בינגו! 🎉</button>' : ''}<button class="btn ghost" id="bingo-new">כרטיס חדש</button></div>`;
  $$('[data-b]', el).forEach((b) => (b.onclick = () => { const i = +b.dataset.b; c.on = c.on.includes(i) ? c.on.filter((x) => x !== i) : [...c.on, i]; ls.set('trip.bingo', JSON.stringify(c)); renderBingo(); }));
  $('#bingo-claim', el)?.addEventListener('click', async () => {
    if (!currentKid) return toast('בחרו למעלה מי משחק בטלפון הזה');
    const res = await gemit('bingo:win', { kidId: currentKid });
    if (res?.ok) { c.claimed.push(newWin.join()); ls.set('trip.bingo', JSON.stringify(c)); renderBingo(); }
  });
  $('#bingo-new', el).onclick = () => { ls.set('trip.bingo', null); renderBingo(); };
}

// ---------- read aloud (device voice) ----------
function speak(text, btn) {
  if (!('speechSynthesis' in window)) return toast('הדפדפן הזה לא תומך בהקראה');
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); if (btn) btn.textContent = '🔊 הקראה'; return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'he-IL'; u.rate = 0.95;
  const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('he'));
  if (v) u.voice = v;
  u.onend = () => { if (btn) btn.textContent = '🔊 הקראה'; };
  if (btn) btn.textContent = '⏹ עצירה';
  speechSynthesis.speak(u);
}
