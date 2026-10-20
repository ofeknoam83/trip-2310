/* טיול 23-24/10 – client */
import { PLACES, REGIONS, locate } from '/places.js';
import * as F from '/food.js';
import { initGame } from '/game-client.js';

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
const COLLS = ['people', 'tasks', 'supplies', 'locations', 'pins', 'info', 'news', 'routes', 'food', 'foodchat', 'expenses', 'payments'];
const S = Object.fromEntries(COLLS.map((c) => [c, new Map()]));
let me = ls.get('trip.me');
let online = new Set();
let config = { voice: false, photos: false, driveFolderUrl: '' };
let game = null; // Wife GO
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
  // Carry on navigating after a reload
  const resume = ls.get('trip.nav');
  if (resume && !nav && me && info().activeRoute === resume && S.routes.has(resume)) startNav();
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
const ROUTES = ['home', 'tasks', 'gear', 'food', 'money', 'map', 'voice', 'photos', 'game'];
const hashRoute = () => location.hash.slice(2).split('?')[0];
const hashQuery = new URLSearchParams(location.hash.split('?')[1] || '');
let route = ROUTES.includes(hashRoute()) ? hashRoute() : 'home';
const sections = {};
function go(r) {
  if (!ROUTES.includes(r)) r = 'home';
  route = r;
  if (location.hash !== `#/${r}`) history.replaceState(null, '', `#/${r}`);
  for (const [k, el] of Object.entries(sections)) el.hidden = k !== r;
  $$('.tabbar button').forEach((b) => { if (b.dataset.go === r) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (r === 'map') ensureMap();
  if (r === 'game') game?.render(); else game?.leave();
  if (r === 'photos' && (photosStale || !photos.length)) loadPhotos();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => go(hashRoute()));
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
      <div class="panel" id="route-panel"></div>
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
    <section id="sec-food">
      <h1 class="page-title">אוכל ושתייה</h1>
      <p class="page-sub">הכמויות מחושבות לפי מי שמגיע ומה הילדים אוכלים, ומתעדכנות לבד. אפשר לבקש מהשף לשנות כל דבר.</p>
      <div class="panel" id="food-head"></div>
      <div class="panel chef" id="chef"></div>
      <div id="food-tools"></div>
      <div id="food-list"></div>
      <button class="btn ghost block" id="food-add" style="margin-top:6px">+ הוספת פריט</button>
    </section>
    <section id="sec-money">
      <h1 class="page-title">הוצאות</h1>
      <p class="page-sub">כל אחד מוסיף מה הוא שילם, והאתר מחשב מי מעביר למי – בכמה שפחות העברות.</p>
      <div class="panel" id="money-sum"></div>
      <div class="panel" id="money-settle"></div>
      <div class="panel" id="money-list"></div>
    </section>
    <section id="sec-game"></section>
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
  bindTasks(); bindGear(); bindFood(); bindMoney(); bindMap(); bindPhotos();
}

// ---------- render dispatch ----------
function renderAll() {
  if (!loaded) return;
  renderMe(); renderHome(); renderTasks(); renderGear(); renderWhere(); updateMarkers(); renderVoice(); renderDots(); renderRoutePanel(); drawRoute(); renderFood(); renderMoney();
  if (route === 'photos') renderPhotos();
}
function renderColl(c) {
  if (c === 'people') return renderAll();
  if (c === 'expenses' || c === 'payments') renderMoney();
  if (c === 'food' || c === 'foodchat') { if (c === 'foodchat') renderChef(); else renderFood(); }
  if (c === 'tasks') { renderTasks(); renderHome(); }
  if (c === 'supplies') { renderGear(); renderHome(); }
  if (c === 'info' || c === 'news') renderHome();
  if (c === 'info') renderFood();
  if (c === 'locations' || c === 'pins') { updateMarkers(); renderWhere(); }
  if (c === 'routes' || c === 'info') {
    if (nav && (!S.routes.has(nav.id) || info().activeRoute !== nav.id)) stopNav(false);
    renderRoutePanel(); drawRoute(); renderHome();
  }
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
const partySize = (p) => { const r = rsvpOf(p); return r === 'no' ? 0 : 1 + (r === 'with' ? F.partyOf(p).length : 0); };
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

    ${me && meP() && !meP().phone ? `<div class="panel phone-nudge"><div class="who-row" style="border:0;padding:0">
      <span style="font-size:26px">📱</span><div class="grow"><b>הוסיפו את המספר שלכם לביט</b><small>כדי שאפשר יהיה להחזיר לכם כסף על הוצאות</small></div>
      <button class="btn small" id="add-phone">הוספה</button></div></div>` : ''}
    ${game?.homeCard() || ''}
    ${homeRouteCard()}

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
  $('#speak-here')?.addEventListener('click', (e) => speak($('.where-card .place-text')?.textContent || '', e.currentTarget, { place: e.currentTarget.dataset.place, part: placeTab }));
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
    <p class="muted" style="margin:0 0 10px">אתם מחוץ לאזורים שהמדריך מכיר${by}. המקומות הכי קרובים:</p>${near}</div>`;
  return `<div class="panel where-card">
    <small class="muted">${inside ? 'אתם עכשיו ב' : 'האזור שבו אתם'}${by}</small>
    <h2 class="where-title">${esc(subject.name)}</h2>
    ${inside && region ? `<span class="region-tag">${esc(region.name)}</span>` : ''}
    <div class="seg" id="place-tabs" style="margin-top:12px">${Object.entries(PLACE_TABS).map(([k, v]) => `<button data-t="${k}" aria-pressed="${placeTab === k}">${v}</button>`).join('')}</div>
    <p class="place-text">${esc(subject[placeTab] || subject.geo)}</p>
    <button class="btn small ghost speak" id="speak-here" data-place="${esc(subject.id)}">🔊 הקראה</button>
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
    $('#speak-all', r).onclick = (e) => speak(`${p.name}. ${p.geo} ${p.history} ${p.kids}`, e.currentTarget, { place: p.id, part: 'all' });
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-place]');
  if (b && !b.classList.contains('speak')) { e.preventDefault(); map?.closePopup(); placeSheet(b.dataset.place); }
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
  let party = F.partyOf(d).map((m) => ({ ...m }));
  openSheet(`
    <h3>${isNew ? 'משתתף חדש' : p.id === me ? 'הפרופיל שלי' : esc(p.name)}</h3>
    <form id="f">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <span id="pv"></span>
        <label class="btn small ghost">החלפת תמונה<input type="file" accept="image/*" id="pf" hidden></label>
      </div>
      <label class="field"><span>שם</span><input class="input" name="name" value="${esc(d.name)}" maxlength="40" required></label>
      <label class="field"><span>טלפון (להעברות בביט)</span><input class="input" name="phone" type="tel" inputmode="tel" dir="ltr" value="${esc(d.phone || '')}" maxlength="20" placeholder="05X-XXXXXXX"></label>
      <div class="field"><span>מגיע?</span><div class="seg" id="rsvp" style="margin:0">
        <button type="button" data-r="solo">לבד</button>
        <button type="button" data-r="with">עם עוד אנשים</button>
        <button type="button" data-r="no">לא מגיע</button>
      </div></div>
      <div class="field" id="comp-field"><span>מי מגיע איתו</span><div id="party-rows"></div>
        <button type="button" class="btn small ghost" id="party-add">+ הוספת מלווה</button></div>
      <div class="field"><span>אני</span><label class="small"><input type="checkbox" name="drinks" ${d.drinks !== false ? 'checked' : ''}> שותה אלכוהול</label>
        <label class="small" style="margin-inline-start:12px"><input type="checkbox" name="veg" ${d.veg ? 'checked' : ''}> צמחוני</label>
        <label class="small" style="margin-inline-start:12px"><input type="checkbox" name="noRed" ${d.noRed ? 'checked' : ''}> בלי בשר אדום</label></div>
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
    const drawParty = () => {
      $('#party-rows', root).innerHTML = party.map((m, i) => `<div class="party-row" data-i="${i}">
        <input class="input" data-k="name" value="${esc(m.name)}" placeholder="שם" maxlength="30">
        <select class="input" data-k="kind"><option value="kid" ${m.kind !== 'adult' ? 'selected' : ''}>ילד</option><option value="adult" ${m.kind === 'adult' ? 'selected' : ''}>מבוגר</option></select>
        <select class="input" data-k="age" ${m.kind === 'adult' ? 'hidden' : ''}>${Object.entries(F.AGES).map(([k, l]) => `<option value="${k}" ${(m.age || 'mid') === k ? 'selected' : ''}>${l.replace('גיל ', '')}</option>`).join('')}</select>
        <button type="button" class="mini" data-x aria-label="הסרה">✕</button>
        <div class="party-flags"><label class="small"><input type="checkbox" data-k="veg" ${m.veg ? 'checked' : ''}> צמחוני</label>
          <label class="small"><input type="checkbox" data-k="noRed" ${m.noRed ? 'checked' : ''}> בלי בשר אדום</label>
          ${m.kind === 'adult' ? `<label class="small"><input type="checkbox" data-k="drinks" ${m.drinks !== false ? 'checked' : ''}> שותה</label>` : ''}</div>
      </div>`).join('');
    };
    $('#party-rows', root).addEventListener('input', (e) => {
      const row = e.target.closest('.party-row'); const k = e.target.dataset.k; if (!row || !k) return;
      const m = party[+row.dataset.i];
      m[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (k === 'kind') { if (m.kind === 'adult') delete m.age; else m.age = m.age || 'mid'; drawParty(); }
      syncR();
    });
    $('#party-rows', root).addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) { party.splice(+x.closest('.party-row').dataset.i, 1); drawParty(); syncR(); } });
    $('#party-add', root).onclick = () => { party.push({ name: '', kind: 'kid', age: 'mid' }); drawParty(); syncR(); $('#party-rows .party-row:last-child input', root)?.focus(); };
    drawParty();
    const syncR = () => {
      $$('#rsvp button', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === rsvp));
      $('#comp-field', root).hidden = rsvp !== 'with';
      const n = partySize({ rsvp, party });
      $('#party', root).textContent = rsvp === 'unknown' ? 'בחרו אם מגיע.' : rsvp === 'no' ? 'לא נספר במספר האנשים.' : `נספר כ־${n} ${n === 1 ? 'איש' : 'אנשים'}.`;
    };
    $$('#rsvp button', root).forEach((b) => (b.onclick = () => { rsvp = b.dataset.r; syncR(); }));
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
      const clean = rsvp === 'with' ? party.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim() })) : [];
      const data = { name: e.target.name.value, phone: e.target.phone.value, companions: clean.map((m) => m.name).join(', '), party: clean, rsvp, color, avatar,
        drinks: e.target.drinks.checked, veg: e.target.veg.checked, noRed: e.target.noRed.checked };
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
function closeSheet() { $('#sheet-root').innerHTML = ''; try { speechSynthesis.cancel(); } catch {} if (narr) { narr.pause(); narr = null; } game?.narrate(false); }
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
    const rowEl = e.target.closest('.row'); if (!rowEl || e.target.closest('[data-go]')) return;
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
        ${t.note ? `<div class="meta">${esc(t.note)}</div>` : ''}
        ${isFoodTask(t) ? '<button class="chip food-link" data-go="food">🛒 כמויות ורשימת קניות</button>' : ''}</div>
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
  updateMarkers(); drawRoute(); game?.drawMap();
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
  const r = activeRoute();
  const pts = [...S.locations.values()].filter((l) => l.sharing && Date.now() - l.t < STALE_MS).map((l) => [l.lat, l.lng])
    .concat([...S.pins.values()].map((p) => [p.lat, p.lng]))
    .concat(r ? r.pts.filter((_, i) => i % 20 === 0).concat([r.pts.at(-1)]) : []);
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
    if (nav) navTick(lastPos);
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

// ---------- money: shared expenses, who owes whom, Bit ----------
const nis = (x) => `₪${(Math.round(x * 100) / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
const famSize = (id) => { const p = person(id); return p ? Math.max(1, partySize(p)) : 1; };
const coming = () => [...S.people.values()].filter((p) => rsvpOf(p) !== 'no');
const EXP_CATS = ['אוכל', 'שתייה', 'דלק', 'ציוד', 'לינה / כניסה', 'אחר'];

// Each expense: payer, amount, the families it's split between, and how (equally or by number of people)
function shares(e) {
  const among = (e.among?.length ? e.among : coming().map((p) => p.id)).filter((id) => S.people.has(id));
  const w = among.map((id) => (e.by === 'people' ? famSize(id) : 1));
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  return among.map((id, i) => [id, (e.amount * w[i]) / tot]);
}
function balances() {
  const bal = new Map([...S.people.keys()].map((id) => [id, 0]));
  const add = (id, x) => bal.set(id, (bal.get(id) || 0) + x);
  for (const e of S.expenses.values()) { add(e.paidBy, +e.amount || 0); for (const [id, x] of shares(e)) add(id, -x); }
  for (const p of S.payments.values()) { add(p.from, +p.amount || 0); add(p.to, -(+p.amount || 0)); }
  return bal;
}
// Fewest transfers: biggest debtor pays biggest creditor, repeat
function settle(bal) {
  const debt = [...bal].filter(([, v]) => v < -0.5).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v);
  const cred = [...bal].filter(([, v]) => v > 0.5).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  const out = [];
  while (debt.length && cred.length) {
    const d = debt[0], c = cred[0]; const x = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amount: Math.round(x) });
    d.v -= x; c.v -= x;
    if (d.v < 0.5) debt.shift(); if (c.v < 0.5) cred.shift();
    debt.sort((a, b) => b.v - a.v); cred.sort((a, b) => b.v - a.v);
  }
  return out.filter((t) => t.amount > 0);
}

function bindMoney() {
  $('#sec-money').addEventListener('click', (e) => {
    if (e.target.closest('#exp-add')) return expenseSheet(null);
    const ex = e.target.closest('[data-exp]'); if (ex) return expenseSheet(S.expenses.get(ex.dataset.exp));
    const pay = e.target.closest('[data-pay]'); if (pay) return paySheet(JSON.parse(pay.dataset.pay));
    const un = e.target.closest('[data-unpay]'); if (un && confirmInline(un)) return op('payments', 'del', un.dataset.unpay);
  });
}

function renderMoney() {
  const root = $('#sec-money'); if (!root || !loaded) return;
  const exps = [...S.expenses.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const total = exps.reduce((a, e) => a + (+e.amount || 0), 0);
  const bal = balances(); const plan = settle(bal);
  const mineBal = bal.get(me) || 0;
  const people = coming().length || 1;
  $('#money-sum').innerHTML = `
    <div class="food-count money-count">
      <div><b>${nis(total)}</b><span>סה״כ הוצאות</span></div>
      <div><b>${nis(total / people)}</b><span>ממוצע למשפחה</span></div>
      <div class="${mineBal < -0.5 ? 'neg' : mineBal > 0.5 ? 'pos' : ''}"><b>${nis(Math.abs(mineBal))}</b><span>${mineBal < -0.5 ? 'אני חייב' : mineBal > 0.5 ? 'חייבים לי' : 'אני מאוזן'}</span></div>
    </div>`;
  $('#money-settle').innerHTML = `<div class="panel-head"><h2>מי מעביר למי</h2><span class="small muted">${plan.length ? `${plan.length} העברות וסיימנו` : ''}</span></div>
    ${plan.length ? plan.map((t) => {
      const f = person(t.from), to = person(t.to); const mine = t.from === me;
      return `<div class="who-row settle-row ${mine ? 'mine' : ''}">
        ${av(f, 36)}
        <div class="grow"><b>${mine ? 'אני' : esc(firstName(f))}</b><small>מעביר ל${t.to === me ? 'י' : esc(firstName(to))}</small></div>
        <b class="amt">${nis(t.amount)}</b>
        ${mine || t.to === me ? `<button class="btn small ${mine ? '' : 'ghost'}" data-pay='${esc(JSON.stringify(t))}'>${mine ? '💸 ביט' : 'קיבלתי'}</button>` : ''}
      </div>`;
    }).join('') : `<p class="muted" style="margin:0">${exps.length ? 'כולם מאוזנים 🎉' : 'עוד אין הוצאות.'}</p>`}`;
  const pays = [...S.payments.values()].sort((a, b) => b.t - a.t);
  $('#money-list').innerHTML = `<div class="panel-head"><h2>הוצאות</h2><button class="btn small" id="exp-add">+ הוצאה</button></div>
    ${exps.length ? exps.map((e) => {
      const p = person(e.paidBy); const n = shares(e).length;
      return `<div class="row exp-row" data-exp="${esc(e.id)}">${av(p, 34)}
        <div class="grow"><span class="title">${esc(e.title)}</span><div class="meta">${esc(firstName(p))} שילם · ${n === coming().length ? 'כולם' : `${n} משפחות`} · ${e.by === 'people' ? 'לפי נפשות' : 'שווה למשפחה'}${e.cat ? ` · ${esc(e.cat)}` : ''}</div></div>
        <b class="amt">${nis(e.amount)}</b></div>`;
    }).join('') : '<p class="muted" style="margin:0">הוסיפו כל הוצאה משותפת: בשר, דלק, כניסה לחניון…</p>'}
    ${pays.length ? `<div class="panel-head" style="margin-top:16px"><h2>העברות שבוצעו</h2></div>${pays.map((x) => `
      <div class="who-row">${av(person(x.from), 28)}<div class="grow"><b>${esc(firstName(person(x.from)))} ← ${esc(firstName(person(x.to)))}</b><small>${x.method === 'cash' ? 'מזומן' : 'ביט'} · ${ago(x.t)}</small></div>
        <b class="amt">${nis(x.amount)}</b><button class="mini" data-unpay="${esc(x.id)}" aria-label="ביטול">✕</button></div>`).join('')}` : ''}`;
}

function expenseSheet(e) {
  const isNew = !e;
  const d = e || { title: '', amount: '', paidBy: me, among: [], by: 'family', cat: 'אוכל' };
  let among = new Set(d.among?.length ? d.among : coming().map((p) => p.id));
  let by = d.by || 'family'; let paidBy = d.paidBy || me;
  openSheet(`
    <h3>${isNew ? 'הוצאה חדשה' : 'עריכת הוצאה'}</h3>
    <form id="f">
      <label class="field"><span>על מה</span><input class="input" name="title" value="${esc(d.title)}" maxlength="80" placeholder="למשל: בשר מהקצב" required></label>
      <div class="grid2">
        <label class="field"><span>סכום (₪)</span><input class="input" name="amount" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(d.amount)}" required></label>
        <label class="field"><span>קטגוריה</span><select class="input" name="cat">${EXP_CATS.map((c) => `<option ${d.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span>מי שילם</span><div class="pick-people" id="payer">${coming().map((p) => `<button type="button" data-id="${esc(p.id)}" aria-pressed="${p.id === paidBy}">${av(p, 40)}<span>${esc(firstName(p))}</span></button>`).join('')}</div></div>
      <div class="field"><span>מתחלק בין</span><div class="pick-people" id="among">${coming().map((p) => `<button type="button" data-id="${esc(p.id)}" aria-pressed="${among.has(p.id)}">${av(p, 40)}<span>${esc(firstName(p))}</span></button>`).join('')}</div></div>
      <div class="seg" id="by" style="margin:0 0 6px"><button type="button" data-b="family">שווה לכל משפחה</button><button type="button" data-b="people">לפי מספר נפשות</button></div>
      <p class="small muted" id="split-prev" style="margin:0 0 12px"></p>
      <div class="actions"><button class="btn" type="submit">${isNew ? 'הוספה' : 'שמירה'}</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
      ${isNew ? '' : '<button class="btn danger block" type="button" id="del" style="margin-top:10px">מחיקת ההוצאה</button>'}
    </form>`, (root) => {
    const prev = () => {
      $$('#by button', root).forEach((b) => b.setAttribute('aria-pressed', b.dataset.b === by));
      const amt = +$('[name=amount]', root).value || 0;
      const sh = shares({ amount: amt, among: [...among], by });
      $('#split-prev', root).textContent = amt && sh.length ? sh.map(([id, x]) => `${firstName(person(id))} ${nis(x)}`).join(' · ') : '';
    };
    $$('#payer button', root).forEach((b) => (b.onclick = () => { paidBy = b.dataset.id; $$('#payer button', root).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
    $$('#among button', root).forEach((b) => (b.onclick = () => { among.has(b.dataset.id) ? among.delete(b.dataset.id) : among.add(b.dataset.id); b.setAttribute('aria-pressed', among.has(b.dataset.id)); prev(); }));
    $$('#by button', root).forEach((b) => (b.onclick = () => { by = b.dataset.b; prev(); }));
    $('[name=amount]', root).oninput = prev; prev();
    $('#del', root)?.addEventListener('click', (ev) => { if (confirmInline(ev.currentTarget)) { closeSheet(); op('expenses', 'del', e.id); } });
    $('#f', root).onsubmit = async (ev) => {
      ev.preventDefault();
      if (!among.size) return toast('בחרו בין מי מתחלקים');
      const all = among.size === coming().length;
      const data = { title: ev.target.title.value, amount: +ev.target.amount.value || 0, cat: ev.target.cat.value, paidBy, by, among: all ? [] : [...among] };
      closeSheet(); await op('expenses', isNew ? 'add' : 'patch', e?.id, data);
    };
  });
}

// Bit has no public API for transfers between people: we copy the phone and amount, open the app, then record the payment
function paySheet(t) {
  const to = person(t.to); const from = person(t.from); const mine = t.from === me;
  const phone = (to?.phone || '').replace(/[^\d+]/g, '');
  const android = /android/i.test(navigator.userAgent);
  const bitUrl = android ? 'intent://#Intent;package=com.bnhp.payments.paymentsapp;end' : 'https://apps.apple.com/il/app/bit/id1182007739';
  openSheet(`
    <h3>${mine ? `העברה ל${esc(firstName(to))}` : `${esc(firstName(from))} מעביר לך`}</h3>
    <div class="pay-big">${nis(t.amount)}</div>
    ${mine ? `
      <div class="who-row">${av(to, 40)}<div class="grow"><b>${esc(to?.name || '')}</b><small dir="ltr" style="text-align:right">${phone ? esc(phone) : `${esc(firstName(to))} עוד לא הוסיף מספר לביט – בקשו ממנו להוסיף בפרופיל`}</small></div>
        ${phone ? '<button class="btn small ghost" id="cp-phone">העתקה</button>' : ''}</div>
      <a class="btn block bit-btn" id="open-bit" href="${bitUrl}" target="_blank" rel="noopener">💸 פתיחת ביט</a>
      <p class="small muted">ביט לא מאפשרת לאתרים חיצוניים לבצע העברה. לחיצה מעתיקה את המספר והסכום ופותחת את ביט – שם בוחרים "העברה לפי מספר נייד", מדביקים ומאשרים. אחר כך חוזרים לכאן ומסמנים ששילמתם.</p>` : '<p class="small muted">סמנו כשהכסף הגיע אליכם.</p>'}
    <div class="actions" style="margin-top:12px">
      <button class="btn teal" id="paid-bit">✓ ${mine ? 'העברתי בביט' : 'קיבלתי בביט'}</button>
      <button class="btn ghost" id="paid-cash">שולם במזומן</button>
    </div>`, (root) => {
    const copy = (s) => navigator.clipboard?.writeText(s).then(() => toast('הועתק'), () => {});
    $('#cp-phone', root)?.addEventListener('click', () => copy(phone));
    $('#open-bit', root)?.addEventListener('click', () => { copy(`${phone} ${t.amount}`); });
    const record = async (method) => { closeSheet(); await op('payments', 'add', null, { from: t.from, to: t.to, amount: t.amount, method }); toast(`נרשם: ${esc(firstName(from))} ← ${esc(firstName(to))} ${nis(t.amount)}`); };
    $('#paid-bit', root).onclick = () => record('bit');
    $('#paid-cash', root).onclick = () => record('cash');
  });
}

// ---------- food & drinks (quantities by headcount + the chef assistant) ----------
let foodView = ls.get('trip.foodView') === 'shop' ? 'shop' : 'meals';
let foodFilter = 'all';
let chefBusy = false;
const foodBuffer = () => (Number.isFinite(+info().foodBuffer) ? +info().foodBuffer : F.DEFAULT_BUFFER);
const foodEaters = () => F.eaters([...S.people.values()]);
const isFoodTask = (t) => /ארוח|אוכל|אלכוהול|שתי|מנגל|בשר|קניות/.test(t.title || '');

function bindFood() {
  $('#sec-food').addEventListener('click', (e) => {
    const row = e.target.closest('[data-food]');
    if (row) {
      const it = S.food.get(row.dataset.food); if (!it) return;
      if (e.target.closest('.check')) { op('food', 'patch', it.id, { bought: !it.bought }); return; }
      if (e.target.closest('.take')) { op('food', 'patch', it.id, { owner: it.owner === me ? null : me }); return; }
      foodSheet(it); return;
    }
    const c = e.target.closest('[data-fv]'); if (c) { foodView = c.dataset.fv; ls.set('trip.foodView', foodView); renderFood(); return; }
    const f = e.target.closest('[data-ff]'); if (f) { foodFilter = f.dataset.ff; renderFood(); return; }
    if (e.target.closest('#food-add')) foodSheet(null);
    if (e.target.closest('#food-buffer')) bufferSheet();
    if (e.target.closest('#food-family')) { if (me) personSheet(meP()); else showGate(); }
    const sug = e.target.closest('[data-sug]'); if (sug) { $('#chef-in').value = sug.dataset.sug; $('#chef-in').focus(); }
  });
  $('#sec-food').addEventListener('submit', (e) => { if (e.target.id === 'chef-form') { e.preventDefault(); sendChef(); } });
}

function renderFood() {
  const root = $('#sec-food'); if (!root || !loaded) return;
  const list = foodEaters(); const h = F.headcount(list); const buf = foodBuffer();
  const items = [...S.food.values()];
  const q = new Map(items.map((i) => [i.id, F.qtyOf(i, list, buf)]));
  const unknown = [...S.people.values()].filter((p) => !p.rsvp || p.rsvp === 'unknown').length;
  const guessed = [...S.people.values()].filter((p) => (p.rsvp || '') !== 'no' && !Array.isArray(p.party) && p.companions?.trim()).length;

  $('#food-head').innerHTML = `
    <div class="food-count">
      <div><b>${h.adults}</b><span>מבוגרים</span></div>
      <div><b>${h.kids}</b><span>ילדים</span></div>
      <div><b>${h.drinkers}</b><span>שותים</span></div>
      <button id="food-buffer"><b>${buf}%</b><span>מרווח</span></button>
    </div>
    <p class="small muted" style="margin:10px 0 0">${h.kids ? `ילדים: ${['small', 'mid', 'teen'].filter((a) => h[a]).map((a) => `${h[a]} ב${F.AGES[a]}`).join(', ')}. ` : ''}${h.veg ? `${h.veg} צמחונים. ` : ''}${unknown ? `${unknown} עוד לא אישרו הגעה. ` : ''}${guessed ? `אצל ${guessed} משפחות הגילים עוד משוערים.` : ''}</p>
    <button class="btn small ghost" id="food-family" style="margin-top:10px">👨‍👧 עריכת המשפחה שלי</button>`;

  renderChef();

  const mine = (i) => i.owner === me;
  const shown = items.filter((i) => foodFilter === 'all' || (foodFilter === 'mine' && mine(i)) || (foodFilter === 'open' && !i.bought) || (foodFilter === 'free' && !i.owner));
  const counts = { all: items.length, free: items.filter((i) => !i.owner).length, open: items.filter((i) => !i.bought).length, mine: items.filter(mine).length };
  $('#food-tools').innerHTML = `
    <div class="seg" style="margin:0 0 10px"><button data-fv="meals" aria-pressed="${foodView === 'meals'}">לפי ארוחות</button><button data-fv="shop" aria-pressed="${foodView === 'shop'}">רשימת קניות</button></div>
    <div class="chips">${Object.entries({ all: 'הכול', free: 'בלי קונה', open: 'לא נקנה', mine: 'שלי' }).map(([k, l]) => `<button class="chip" data-ff="${k}" aria-pressed="${foodFilter === k}">${l} ${counts[k]}</button>`).join('')}</div>`;

  const groups = foodView === 'meals'
    ? F.mealsOf(shown).map((m) => [m, shown.filter((i) => (i.meal || 'כללי') === m)])
    : [...new Set(shown.map((i) => i.cat || 'אחר'))].map((c) => [c, shown.filter((i) => (i.cat || 'אחר') === c)]);
  $('#food-list').innerHTML = groups.length ? groups.map(([g, its]) => `
    <div class="panel food-group"><div class="panel-head"><h2>${esc(g)}</h2><span class="small muted">${its.filter((i) => i.bought).length}/${its.length} נקנו</span></div>
      ${its.map((i) => foodRow(i, q.get(i.id), foodView === 'shop')).join('')}
    </div>`).join('') : '<div class="empty-state">אין פריטים כאן.</div>';
}

function foodRow(i, q, showMeal) {
  const o = person(i.owner);
  const per = [i.perAdult ? `מבוגר ${F.fmtAmount(i.unit, i.perAdult).replace(/^(\d+) יח׳$/, '$1')}` : '',
    ...['small', 'mid', 'teen'].filter((a) => i.perKid?.[a]).map((a) => `${F.AGES[a].replace('גיל ', '')}: ${F.fmtAmount(i.unit, i.perKid[a]).replace(/^(\d+) יח׳$/, '$1')}`)]
    .filter(Boolean).join(' · ');
  return `<div class="row food-row ${i.bought ? 'done' : ''}" data-food="${esc(i.id)}">
    <button class="check" role="checkbox" aria-checked="${!!i.bought}" aria-label="נקנה">${ICON.check}</button>
    <div class="grow"><span class="title">${esc(i.name)}</span>
      <div class="food-qty">${esc(F.fmtQty(i, q))}</div>
      <div class="meta">${showMeal ? `${esc(i.meal)} · ` : ''}${i.who && i.who !== 'all' ? `${F.WHO[i.who]} · ` : ''}${per || 'בלי כמות לאדם'}${i.extra ? ` · ${i.extra > 0 ? '+' : ''}${i.extra}` : ''}${i.note ? ` · ${esc(i.note)}` : ''}</div></div>
    <div class="row-side">${o && i.owner !== me ? `<span class="owner-av" title="${esc(o.name)}">${av(o, 26)}</span>` : `<button class="take ${i.owner === me ? 'mine' : ''}">${i.owner === me ? 'אני קונה' : 'אני אקנה'}</button>`}</div>
  </div>`;
}

// ----- the chef -----
function renderChef() {
  const el = $('#chef'); if (!el) return;
  const msgs = [...S.foodchat.values()].sort((a, b) => a.t - b.t).slice(-30);
  const log = msgs.map((m) => m.role === 'user'
    ? `<div class="msg me-msg">${av(person(m.by), 28)}<div><b>${esc(firstName(person(m.by)))}</b><p>${esc(m.text)}</p></div></div>`
    : `<div class="msg chef-msg ${m.error ? 'err' : ''}"><span class="chef-av">👨‍🍳</span><div><p>${esc(m.text).replace(/\n/g, '<br>')}</p>${(m.changes || []).length ? `<div class="changes">${m.changes.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</div></div>`).join('');
  const prev = $('#chef-in')?.value || '';
  el.innerHTML = `
    <div class="panel-head"><h2>👨‍🍳 השף</h2><span class="small muted">כתבו מה לשנות, והרשימה מתעדכנת לכולם</span></div>
    ${config.chef ? '' : '<p class="small muted">השף יתחבר אחרי שמוסיפים מפתח OPENAI_API_KEY ב־Render. בינתיים אפשר לערוך את הרשימה ידנית.</p>'}
    <div class="chef-log" id="chef-log">${log || `<div class="msg chef-msg"><span class="chef-av">👨‍🍳</span><div><p>היי! תספרו לי מי מגיע ומה הילדים אוכלים, ואני אתאים את הכמויות. אפשר גם לבקש להוסיף מנה, להחליף תפריט או לשאול כמה צריך.</p></div></div>`}
      ${chefBusy ? '<div class="msg chef-msg"><span class="chef-av">👨‍🍳</span><div><p class="typing"><i></i><i></i><i></i></p></div></div>' : ''}</div>
    <div class="chips sugs">${['הילדים של עידו בני 4 ו־9', 'תוסיף קבבים לערב שישי', 'יפתח צמחוני', 'כמה בירות צריך?', 'תוריד את הדגנים'].map((s) => `<button class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <form id="chef-form" class="chef-form"><input class="input" id="chef-in" placeholder="למשל: שני הילדים של תומר לא אוכלים בשר אדום" maxlength="1000" autocomplete="off" ${config.chef ? '' : 'disabled'}><button class="btn" ${config.chef && !chefBusy ? '' : 'disabled'}>שליחה</button></form>`;
  $('#chef-in').value = prev;
  const lg = $('#chef-log'); lg.scrollTop = lg.scrollHeight;
}
async function sendChef() {
  const inp = $('#chef-in'); const text = inp.value.trim(); if (!text || chefBusy) return;
  if (!me) return showGate();
  chefBusy = true; inp.value = ''; renderChef();
  try {
    const r = await fetch('/api/food/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, by: me }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.doc) toast(esc(j.error || 'השף לא זמין כרגע'));
  } catch { toast('אין חיבור לשרת'); }
  chefBusy = false; renderChef();
}

// ----- manual editing -----
function foodSheet(it) {
  const isNew = !it;
  const d = it || { meal: F.MEAL_ORDER[0], cat: '', name: '', unit: 'unit', who: 'all', perAdult: 0, perKid: { small: 0, mid: 0, teen: 0 }, tags: [], pack: 0, packName: '', extra: 0, note: '' };
  const meals = [...new Set([...F.MEAL_ORDER, ...[...S.food.values()].map((x) => x.meal)])];
  const numIn = (n, v, l) => `<label class="field"><span>${l}</span><input class="input" name="${n}" type="number" inputmode="decimal" step="any" min="0" value="${v ?? 0}"></label>`;
  openSheet(`
    <h3>${isNew ? 'פריט חדש' : esc(d.name)}</h3>
    <form id="f">
      <label class="field"><span>שם</span><input class="input" name="name" value="${esc(d.name)}" maxlength="80" required></label>
      <div class="grid2">
        <label class="field"><span>ארוחה</span><input class="input" name="meal" list="meals-dl" value="${esc(d.meal)}" maxlength="40"><datalist id="meals-dl">${meals.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></label>
        <label class="field"><span>קטגוריה</span><input class="input" name="cat" value="${esc(d.cat || '')}" maxlength="30" placeholder="בשר, ירקות…"></label>
        <label class="field"><span>יחידה</span><select class="input" name="unit">${Object.entries(F.UNITS).map(([k, l]) => `<option value="${k}" ${d.unit === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>למי</span><select class="input" name="who">${Object.entries(F.WHO).map(([k, l]) => `<option value="${k}" ${(d.who || 'all') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <p class="small muted" style="margin:0 0 8px">כמות לאדם (גולמי)</p>
      <div class="grid4">${numIn('perAdult', d.perAdult, 'מבוגר')}${numIn('k_small', d.perKid?.small, 'ילד 3–6')}${numIn('k_mid', d.perKid?.mid, 'ילד 7–12')}${numIn('k_teen', d.perKid?.teen, 'נער 13+')}</div>
      <div class="grid2">${numIn('pack', d.pack, 'גודל אריזה')}<label class="field"><span>שם האריזה</span><input class="input" name="packName" value="${esc(d.packName || '')}" maxlength="30" placeholder="חבילות, שישיות…"></label>
        ${numIn('extra', d.extra, 'תוספת ידנית')}<div class="field"><span>סוג</span><label class="small"><input type="checkbox" name="meat" ${d.tags?.includes('meat') ? 'checked' : ''}> בשר</label> <label class="small"><input type="checkbox" name="red" ${d.tags?.includes('red') ? 'checked' : ''}> בשר אדום</label></div></div>
      <label class="field"><span>הערה</span><input class="input" name="note" value="${esc(d.note || '')}" maxlength="200"></label>
      <div class="actions"><button class="btn" type="submit">${isNew ? 'הוספה' : 'שמירה'}</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
      ${isNew ? '' : '<button class="btn danger block" type="button" id="del" style="margin-top:10px">מחיקת הפריט</button>'}
    </form>`, (root) => {
    $('#del', root)?.addEventListener('click', (e) => { if (confirmInline(e.currentTarget)) { closeSheet(); op('food', 'del', it.id); } });
    $('#f', root).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      const data = { name: f.name.value, meal: f.meal.value || 'כללי', cat: f.cat.value, unit: f.unit.value, who: f.who.value,
        perAdult: +f.perAdult.value || 0, perKid: { small: +f.k_small.value || 0, mid: +f.k_mid.value || 0, teen: +f.k_teen.value || 0 },
        pack: +f.pack.value || 0, packName: f.packName.value, extra: +f.extra.value || 0, note: f.note.value,
        tags: [f.meat.checked && 'meat', f.red.checked && 'red'].filter(Boolean) };
      if (data.tags.includes('red') && !data.tags.includes('meat')) data.tags.push('meat');
      closeSheet(); await op('food', isNew ? 'add' : 'patch', it?.id, data);
    };
  });
}
function bufferSheet() {
  openSheet(`<h3>מרווח ביטחון</h3><p class="small muted">כמה להוסיף על הכמות המחושבת, כדי שלא ייגמר.</p>
    <form id="f"><label class="field"><span>אחוזים</span><input class="input" name="b" type="number" min="0" max="50" value="${foodBuffer()}"></label>
    <div class="actions"><button class="btn" type="submit">שמירה</button><button class="btn ghost" type="button" data-close>ביטול</button></div></form>`, (root) => {
    $('#f', root).onsubmit = (e) => { e.preventDefault(); closeSheet(); op('info', 'patch', 'main', { foodBuffer: +e.target.b.value || 0 }); };
  });
}

// ---------- navigation route (import + voice guidance) ----------
const activeRoute = () => S.routes.get(info().activeRoute) || null;
let routeLayer = null; let routeLayerId = null;
let nav = null; // { id, cum, items, lastIdx, offCount, offSince, lastOffSay, done, nextKm, warnedSunset, mute, speeds }
let navMute = ls.get('trip.navMute') === '1';
const SRC_NAME = { amudanan: 'עמוד ענן', offroad: 'אוף רוד', israelhiking: 'מפת שבילי ישראל', mymaps: 'Google My Maps', link: 'קישור', file: 'קובץ' };

// Local flat projection in metres around a reference latitude – accurate enough for a few km
function proj(lat, lng, lat0) { const k = 111320; return [lng * k * Math.cos(lat0 * Math.PI / 180), lat * k]; }
function cumOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distKm({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] }) * 1000);
  return cum;
}
// Nearest point on the route to pos: segment index, distance along the route and distance off it (metres)
function snap(pts, cum, pos, from = 0, to = pts.length - 1) {
  let best = { off: Infinity, idx: 0, along: 0, pt: pts[0] };
  const [px, py] = proj(pos.lat, pos.lng, pos.lat);
  for (let i = Math.max(0, from); i < Math.min(to, pts.length - 1); i++) {
    const [ax, ay] = proj(pts[i][0], pts[i][1], pos.lat); const [bx, by] = proj(pts[i + 1][0], pts[i + 1][1], pos.lat);
    const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const cx = ax + t * dx, cy = ay + t * dy; const off = Math.hypot(px - cx, py - cy);
    if (off < best.off) best = { off, idx: i, along: cum[i] + t * (cum[i + 1] - cum[i]), pt: [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])] };
  }
  return best;
}
const DIRS = ['צפון', 'צפון־מזרח', 'מזרח', 'דרום־מזרח', 'דרום', 'דרום־מערב', 'מערב', 'צפון־מערב'];
function bearing(a, b) {
  const r = Math.PI / 180; const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const dirName = (deg) => DIRS[Math.round(deg / 45) % 8];
const sayDist = (m) => (m >= 950 ? `${(m / 1000).toFixed(m < 9500 ? 1 : 0).replace('.0', '')} קילומטר` : `${Math.max(50, Math.round(m / 50) * 50)} מטר`);
const firstSentence = (s) => (String(s || '').match(/^[^.!?]*[.!?]/)?.[0] || String(s || '')).trim();

// Sunset for a date and place (NOAA approximation), as a Date
function sunsetAt(lat, lng, d = new Date()) {
  const r = Math.PI / 180;
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
  const g = (2 * Math.PI / 365) * (day - 1 + 0.5);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(decl)) - Math.tan(lat * r) * Math.tan(decl)) / r;
  const mins = 720 - 4 * (lng - ha) - eq; // UTC minutes
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + mins * 60e3);
}
const hhmm = (d) => d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

// Everything worth announcing along the route: the file's own waypoints, our map pins, and known places near the line
function routeItems(r, cum) {
  const items = [];
  const add = (it, maxOff) => { const s = snap(r.pts, cum, it); if (s.off <= maxOff) items.push({ ...it, along: s.along, off: s.off }); };
  for (const w of r.wpts || []) add({ kind: 'wpt', name: w.name, desc: w.desc, lat: w.lat, lng: w.lng }, 800);
  for (const p of S.pins.values()) add({ kind: 'pin', name: p.name, desc: (PIN_KINDS[p.kind] || PIN_KINDS.other)[1], lat: p.lat, lng: p.lng }, 400);
  for (const p of PLACES) add({ kind: 'place', id: p.id, name: p.name, desc: firstSentence(p.geo), lat: p.lat, lng: p.lng }, Math.max(400, Math.min(p.r * 1000, 2500)));
  items.sort((a, b) => a.along - b.along);
  // Merge duplicates (same name, or a pin sitting on a waypoint)
  return items.filter((it, i) => !items.slice(0, i).some((o) => Math.abs(o.along - it.along) < 80 && (o.name === it.name || it.kind !== 'place')));
}

let navQueue = [];
function navSay(text, urgent = false) {
  if (navMute || !('speechSynthesis' in window)) return;
  if (urgent) { navQueue = []; speechSynthesis.cancel(); }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'he-IL'; u.rate = 1;
  const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('he')); if (v) u.voice = v;
  speechSynthesis.speak(u);
}

function startNav() {
  const r = activeRoute(); if (!r) return toast('קודם טוענים ציר');
  if (!me) return showGate();
  const cum = cumOf(r.pts);
  nav = { id: r.id, cum, items: routeItems(r, cum), lastIdx: null, offCount: 0, lastOffSay: 0, wasOff: false, nextKm: 5, warnedSunset: false, speeds: [], lastFix: null, gapSaid: 0, started: Date.now() };
  ls.set('trip.nav', r.id);
  if (!shareOn || watchId == null) startShare();
  if (!wakeOn) { wakeOn = true; $('#wake-switch')?.setAttribute('aria-checked', 'true'); requestWake(); }
  navSay(`מתחילים ניווט בציר ${r.name}. ${sayDist(r.km * 1000)}${nav.items.length ? `, ו־${nav.items.length} נקודות ציון בדרך` : ''}.`, true);
  if (lastPos) navTick(lastPos, true);
  renderNavBar(); renderRoutePanel();
}
function stopNav(said = true) {
  if (!nav) return;
  nav = null; ls.set('trip.nav', null);
  if (said) navSay('הניווט הסתיים', true);
  renderNavBar(); renderRoutePanel();
}

function navTick(pos, first = false) {
  const r = nav && S.routes.get(nav.id); if (!r) return;
  const { cum } = nav; const total = cum[cum.length - 1];
  // Search near the last match while on the route, the whole route otherwise
  let s = nav.lastIdx != null && !nav.wasOff ? snap(r.pts, cum, pos, nav.lastIdx - 40, nav.lastIdx + 400) : null;
  if (!s || s.off > 120) s = snap(r.pts, cum, pos);
  nav.lastIdx = s.idx; nav.along = s.along; nav.off = s.off; nav.pos = pos;
  if (first) for (const it of nav.items) if (it.along < s.along - 50) it.done = it.a1 = it.a2 = true;

  // Speed (moving average of real movement) for the ETA
  if (nav.lastFix) {
    const dt = (Date.now() - nav.lastFix.t) / 3600e3; const dk = distKm(nav.lastFix, pos);
    if (dt > 0.003 && dk > 0.02) { nav.speeds.push(dk / dt); nav.speeds = nav.speeds.slice(-12); nav.lastFix = { ...pos, t: Date.now() }; }
  } else nav.lastFix = { ...pos, t: Date.now() };

  // Off the route
  if (s.off > 150) {
    nav.offCount++;
    if (nav.offCount >= 2 && (!nav.wasOff || Date.now() - nav.lastOffSay > 90e3)) {
      navSay(`שימו לב, ירדתם מהציר. הציר נמצא ${sayDist(s.off)} מכם, לכיוון ${dirName(bearing(pos, { lat: s.pt[0], lng: s.pt[1] }))}.`, true);
      nav.wasOff = true; nav.lastOffSay = Date.now();
    }
  } else {
    if (nav.wasOff && s.off < 70) { navSay('חזרתם לציר.'); nav.wasOff = false; }
    nav.offCount = 0;
  }

  // Waypoints ahead
  if (!nav.wasOff) for (const it of nav.items) {
    if (it.done) continue;
    const d = it.along - s.along;
    const near = distKm(pos, it) * 1000;
    if (d < -60 && near > 300) { it.done = true; continue; } // passed it
    if (!it.a1 && d <= 1000 && d > 400) { it.a1 = true; navSay(`בעוד ${sayDist(d)}: ${it.name}.`); }
    else if (!it.a2 && d <= 300 && d > 60) { it.a1 = it.a2 = true; navSay(`עוד ${sayDist(d)}: ${it.name}.`); }
    else if (d <= 60 && near < Math.max(150, it.off + 80)) {
      it.done = it.a1 = it.a2 = true;
      const side = it.off > 120 ? ` ${it.name} נמצא ${sayDist(it.off)} מהציר, לכיוון ${dirName(bearing(pos, it))}.` : '';
      navSay(`הגעתם: ${it.name}.${side} ${it.desc ? firstSentence(it.desc) : ''}`);
    }
  }

  // Progress every 5 km
  const doneKm = s.along / 1000; const leftKm = (total - s.along) / 1000;
  if (doneKm >= nav.nextKm && leftKm > 1) { navSay(`עברתם ${Math.floor(doneKm)} קילומטר. נשארו ${sayDist(leftKm * 1000)}.`); nav.nextKm = Math.floor(doneKm / 5) * 5 + 5; }

  // Sunset check
  const speed = navSpeed();
  const sunset = sunsetAt(pos.lat, pos.lng);
  if (!nav.warnedSunset && leftKm > 2 && speed) {
    const eta = new Date(Date.now() + (leftKm / speed) * 3600e3);
    if (eta > new Date(sunset - 20 * 60e3) && Date.now() < +sunset) { nav.warnedSunset = true; navSay(`שימו לב: בקצב הנוכחי תסיימו בערך ב־${hhmm(eta)}, והשקיעה ב־${hhmm(sunset)}.`); }
  }

  // Convoy: whoever is in front hears when someone falls far behind
  const others = [...S.locations.values()].filter((l) => l.id !== me && l.sharing && Date.now() - l.t < STALE_MS)
    .map((l) => ({ l, s: snap(r.pts, cum, l) })).filter((x) => x.s.off < 500);
  if (others.length && others.every((x) => x.s.along <= s.along)) {
    const last = others.reduce((a, b) => (a.s.along < b.s.along ? a : b));
    const gap = s.along - last.s.along;
    if (gap > 2000 && Date.now() - nav.gapSaid > 10 * 60e3) { nav.gapSaid = Date.now(); navSay(`${firstName(person(last.l.id))} ${sayDist(gap)} מאחוריכם.`); }
  }

  // End of the route
  if (total - s.along < 60 && distKm(pos, { lat: r.pts.at(-1)[0], lng: r.pts.at(-1)[1] }) * 1000 < 120) { navSay(`הגעתם לסוף הציר, ${r.name}. כל הכבוד!`, true); stopNav(false); return; }
  renderNavBar();
}
function navSpeed() { const v = nav?.speeds || []; if (v.length < 3) return 0; const sorted = [...v].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; }

function renderNavBar() {
  let el = $('#nav-bar');
  if (!nav) { el?.remove(); document.body.classList.remove('navigating'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'nav-bar'; document.body.append(el); }
  document.body.classList.add('navigating');
  const r = S.routes.get(nav.id); const total = nav.cum.at(-1);
  const along = nav.along || 0; const left = Math.max(0, total - along);
  const next = nav.items.find((it) => !it.done && it.along >= along - 60);
  const speed = navSpeed();
  const eta = speed ? hhmm(new Date(Date.now() + (left / 1000 / speed) * 3600e3)) : null;
  const sunset = nav.pos ? hhmm(sunsetAt(nav.pos.lat, nav.pos.lng)) : null;
  const off = nav.off > 150;
  el.className = off ? 'off' : '';
  el.innerHTML = `
    <div class="nav-main">
      ${nav.pos == null ? '<b>מחפש מיקום GPS…</b>'
        : off ? `<b>⚠️ מחוץ לציר · ${fmtDist(nav.off / 1000)}</b><small>הציר לכיוון ${dirName(bearing(nav.pos, (() => { const s = snap(r.pts, nav.cum, nav.pos); return { lat: s.pt[0], lng: s.pt[1] }; })()))}</small>`
        : next ? `<b>${esc(next.name)}</b><small>בעוד ${fmtDist((next.along - along) / 1000)}</small>`
        : `<b>${esc(r.name)}</b><small>אין עוד נקודות ציון עד הסוף</small>`}
    </div>
    <div class="nav-stats"><span>נשארו <b>${fmtDist(left / 1000)}</b></span>${eta ? `<span>הגעה ~<b>${eta}</b></span>` : ''}${sunset ? `<span>🌇 ${sunset}</span>` : ''}</div>
    <div class="nav-prog"><i style="width:${Math.min(100, (along / total) * 100).toFixed(1)}%"></i></div>
    <div class="nav-btns">
      <button class="icon-btn" id="nav-mute" aria-label="${navMute ? 'הפעלת קול' : 'השתקה'}">${navMute ? '🔇' : '🔊'}</button>
      <button class="icon-btn" id="nav-map" aria-label="למפה">🗺️</button>
      <button class="icon-btn" id="nav-stop" aria-label="סיום ניווט">⏹</button>
    </div>`;
  $('#nav-mute', el).onclick = () => { navMute = !navMute; ls.set('trip.navMute', navMute ? '1' : null); if (navMute) speechSynthesis.cancel(); renderNavBar(); };
  $('#nav-map', el).onclick = () => { go('map'); if (nav?.pos) map?.setView([nav.pos.lat, nav.pos.lng], 15); };
  $('#nav-stop', el).onclick = () => stopNav();
}

function drawRoute() {
  if (!map) return;
  const r = activeRoute();
  const key = r ? `${r.id}:${r.pts.length}` : null;
  if (key === routeLayerId) return;
  routeLayer?.remove(); routeLayer = null; routeLayerId = key;
  if (!r) return;
  const ll = r.pts.map(([a, b]) => [a, b]);
  routeLayer = L.layerGroup([
    L.polyline(ll, { color: '#140c06', weight: 9, opacity: 0.55, interactive: false }),
    L.polyline(ll, { color: '#ff8a3d', weight: 5, opacity: 0.95, interactive: false }),
    L.marker(ll[0], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="route-end start">▶</div>' }) }).bindPopup(`<b>תחילת הציר</b><br>${esc(r.name)}`),
    L.marker(ll.at(-1), { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="route-end">🏁</div>' }) }).bindPopup(`<b>סוף הציר</b><br>${esc(r.name)}`),
    ...(r.wpts || []).map((w, i) => L.marker([w.lat, w.lng], { icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: `<div class="route-wpt">${i + 1}</div>` }) })
      .bindPopup(`<b>${esc(w.name)}</b>${w.desc ? `<br><span class="small">${esc(w.desc)}</span>` : ''}`)),
  ]).addTo(map);
}
function fitRoute() { const r = activeRoute(); if (map && r) map.fitBounds(r.pts, { padding: [30, 30] }); }

function homeRouteCard() {
  const r = activeRoute(); if (!r) return '';
  return `<div class="panel route-home">
    <div class="panel-head"><h2>🧭 ציר הניווט</h2><button class="btn small ghost" data-go="map">למפה</button></div>
    <div class="route-card"><div class="grow"><b>${esc(r.name)}</b><small>${fmtDist(r.km)} · ${SRC_NAME[r.source] || 'קובץ'} · הקראה קולית של נקודות הציון בדרך</small></div></div>
    <div class="actions" style="margin-top:12px">${nav ? '<button class="btn danger" data-navtoggle>⏹ סיום ניווט</button>' : '<button class="btn" data-navtoggle>▶ התחלת ניווט קולי</button>'}</div>
  </div>`;
}
document.addEventListener('click', (e) => { if (e.target.closest('#add-phone')) { personSheet(meP()); setTimeout(() => $('#sheet-root [name=phone]')?.focus(), 300); } });
document.addEventListener('click', (e) => { if (e.target.closest('[data-navtoggle]')) { nav ? stopNav() : startNav(); renderHome(); } });

function renderRoutePanel() {
  const el = $('#route-panel'); if (!el) return;
  const r = activeRoute(); const count = S.routes.size;
  el.innerHTML = `
    <div class="panel-head"><h2>ציר ניווט</h2>${count ? `<button class="btn small ghost" id="route-manage">${count > 1 ? `כל הצירים (${count})` : 'ניהול'}</button>` : ''}</div>
    ${r ? `
      <div class="route-card">
        <div class="grow"><b>${esc(r.name)}</b>
          <small>${fmtDist(r.km)} · ${(r.wpts || []).length} נקודות ציון · ${SRC_NAME[r.source] || 'קובץ'}${r.createdBy && person(r.createdBy) ? ` · ${esc(firstName(person(r.createdBy)))}` : ''}</small></div>
        <button class="icon-btn" id="route-fit" aria-label="הצג את הציר">${ICON.all}</button>
      </div>
      <div class="actions" style="margin-top:12px">
        ${nav ? '<button class="btn danger" id="nav-toggle">⏹ סיום ניווט</button>' : '<button class="btn" id="nav-toggle">▶ התחלת ניווט קולי</button>'}
      </div>
      <p class="small muted" style="margin:10px 0 0">הקראה של נקודות הציון בדרך, מקומות מוכרים ליד הציר ונקודות שסימנתם במפה, התראה כשיורדים מהציר ובדיקת זמן מול השקיעה. הניווט משתף את המיקום שלך עם הקבוצה.</p>
      <details class="route-add"><summary>טעינת ציר אחר</summary>${importForm()}</details>`
    : importForm(true)}`;
  bindImport(el);
  $('#route-manage', el)?.addEventListener('click', routesSheet);
  $('#route-fit', el)?.addEventListener('click', fitRoute);
  $('#nav-toggle', el)?.addEventListener('click', () => (nav ? stopNav() : startNav()));
}
function importForm(intro = false) {
  return `${intro ? '<p class="small muted" style="margin:0 0 10px">משתפים קישור למסלול מעמוד ענן, אוף רוד, מפת שבילי ישראל או Google My Maps, או מעלים קובץ GPX / KML. כולם יראו את הציר.</p>' : ''}
    <form class="route-import">
      <input class="input" name="url" type="url" inputmode="url" placeholder="הדבקת קישור למסלול" dir="ltr">
      <button class="btn" type="submit">טעינה</button>
    </form>
    <label class="btn ghost small route-file">📂 העלאת קובץ GPX / KML<input type="file" accept=".gpx,.kml,.kmz,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" hidden></label>
    <p class="small muted route-msg" hidden></p>`;
}
function bindImport(root) {
  for (const f of $$('.route-import', root)) {
    const msg = f.parentElement.querySelector('.route-msg');
    f.onsubmit = (e) => { e.preventDefault(); const url = f.url.value.trim(); if (url) importRoute({ url }, f.querySelector('button'), msg); };
    const file = f.parentElement.querySelector('.route-file input');
    if (file) file.onchange = async () => {
      const x = file.files[0]; if (!x) return;
      if (x.size > 15e6) return toast('הקובץ גדול מדי');
      const b64 = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(x); });
      importRoute({ file: b64, filename: x.name }, file.parentElement, msg); file.value = '';
    };
  }
}
async function importRoute(body, btn, msg) {
  const label = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = '⏳ טוען…'; }
  if (msg) msg.hidden = true;
  try {
    const r = await fetch('/api/routes/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, by: me }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'הטעינה נכשלה');
    toast(`🧭 נטען הציר "${esc(j.doc.name)}" · ${fmtDist(j.doc.km)}`);
    S.routes.set(j.doc.id, j.doc); renderRoutePanel(); drawRoute(); fitRoute();
  } catch (e) {
    if (msg) { msg.textContent = e.message; msg.hidden = false; } else toast(esc(e.message));
  } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}
function routesSheet() {
  const list = [...S.routes.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const act = info().activeRoute;
  openSheet(`<h3>צירי ניווט</h3>
    <div class="route-list">${list.map((r) => `
      <div class="who-row">
        <div class="grow"><b>${esc(r.name)}</b><small>${fmtDist(r.km)} · ${SRC_NAME[r.source] || 'קובץ'} · ${ago(r.createdAt)}</small></div>
        ${r.id === act ? '<span class="chip" aria-pressed="true">פעיל</span>' : `<button class="btn small" data-act="${esc(r.id)}">בחירה</button>`}
        <button class="btn small ghost" data-ren="${esc(r.id)}">שינוי שם</button>
        <button class="btn small danger" data-del="${esc(r.id)}">מחיקה</button>
      </div>`).join('')}</div>
    <div class="actions"><button class="btn ghost" data-close>סגירה</button></div>`, (root) => {
    $$('[data-act]', root).forEach((b) => (b.onclick = async () => { if (nav) stopNav(false); await op('info', 'patch', 'main', { activeRoute: b.dataset.act }); closeSheet(); fitRoute(); }));
    $$('[data-ren]', root).forEach((b) => (b.onclick = async () => { const r = S.routes.get(b.dataset.ren); const n = prompt('שם הציר', r?.name || ''); if (n?.trim()) { await op('routes', 'patch', b.dataset.ren, { name: n.trim() }); routesSheet(); } }));
    $$('[data-del]', root).forEach((b) => (b.onclick = async () => { if (!confirmInline(b)) return; if (nav?.id === b.dataset.del) stopNav(false); await op('routes', 'del', b.dataset.del); routesSheet(); }));
  });
}

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
game = initGame({ $, $$, esc, toast, openSheet, closeSheet, av, person, firstName, ls, socket, confirmInline, resizeImage, distKm,
  partyOf: F.partyOf, onReady: () => { if (loaded) renderHome(); }, getMe: () => me, getPos: () => lastPos, getPeople: () => [...S.people.values()], getMap: () => map });
go(route);
fetch('/api/config').then((r) => r.json()).then((c) => { config = c; sheetStatus = c.gearSheet || null; renderGear(); renderVoice(); if (route === 'photos') loadPhotos(); else renderPhotos(); }).catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (hashQuery.get('route') === 'ok') setTimeout(() => toast('🧭 הציר נטען'), 800);
if (hashQuery.get('route') === 'fail') setTimeout(() => {
  toast('לא הצלחתי לקרוא מסלול ממה ששיתפתם. ייצאו קובץ GPX/KML ושתפו אותו.');
  const u = $('#route-panel input[name=url]'); if (u && hashQuery.get('link')) u.value = hashQuery.get('link');
}, 800);

// ---------- read aloud (device voice) ----------
let narr = null; // currently playing ElevenLabs audio
function speak(text, btn, tts) {
  if (narr) { narr.pause(); narr = null; game?.narrate(false); if (btn) btn.textContent = '🔊 הקראה'; return; }
  if (config.tts && tts) {
    game?.narrate(true);
    narr = new Audio(`/api/tts?place=${encodeURIComponent(tts.place)}&part=${tts.part}`);
    if (btn) btn.textContent = '⏳ מכין הקראה…';
    narr.onplaying = () => { if (btn) btn.textContent = '⏹ עצירה'; };
    narr.onended = () => { narr = null; game?.narrate(false); if (btn) btn.textContent = '🔊 הקראה'; };
    narr.onerror = () => { narr = null; game?.narrate(false); if (btn) btn.textContent = '🔊 הקראה'; toast('ההקראה לא זמינה כרגע – משתמשים בקול של הטלפון'); speak(text, btn); };
    narr.play().catch(() => {});
    return;
  }
  if (!('speechSynthesis' in window)) return toast('הדפדפן הזה לא תומך בהקראה');
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); game?.narrate(false); if (btn) btn.textContent = '🔊 הקראה'; return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'he-IL'; u.rate = 0.95;
  const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('he'));
  if (v) u.voice = v;
  u.onend = () => { game?.narrate(false); if (btn) btn.textContent = '🔊 הקראה'; };
  u.onerror = () => game?.narrate(false);
  if (btn) btn.textContent = '⏹ עצירה';
  game?.narrate(true);
  speechSynthesis.speak(u);
}
