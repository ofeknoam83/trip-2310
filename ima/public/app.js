/* IMA קשר – push-to-talk client */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

let people = []; let me = ls.get('ima.me'); let roles = []; let voiceOn = false;
const person = (id) => people.find((p) => p.id === id);
const pidOf = (identity) => String(identity || '').split(':')[0];
function av(p, s = 40) {
  const st = `--s:${s}px` + (p?.avatar ? `;background-image:url('${esc(p.avatar)}')` : '');
  return `<span class="av" style="${st}">${p?.avatar ? '' : esc((p?.name || '?').trim()[0])}</span>`;
}
function toast(t) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = t;
  $('#toasts').append(el); setTimeout(() => el.remove(), 3500);
}
const fmtDur = (ms) => { const s = Math.max(1, Math.round(ms / 1000)); return s < 60 ? `${s} שנ׳` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const clock = (t) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

// ---------- roster over socket.io ----------
const socket = io('/ima');
const emit = (ev, d) => new Promise((r) => socket.timeout(10000).emit(ev, d, (err, res) => r(err ? { ok: false, error: 'אין חיבור' } : res)));
socket.on('people', (list) => {
  people = list;
  if (me && !person(me)) { me = null; ls.set('ima.me', null); leave(); }
  if (!me) showGate(); else hideGate();
  renderMe(); renderGate(); renderOnline(); renderChannel();
});
fetch('/ima/api/config').then((r) => r.json()).then((c) => { voiceOn = c.voice; roles = c.roles; renderPtt(); }).catch(() => {});

function renderMe() { $('#me-btn').innerHTML = me ? av(person(me), 38) : ''; }
$('#me-btn').onclick = () => person(me) && profileSheet(person(me));

// ---------- gate: choose who you are ----------
let query = '';
function showGate() {
  if ($('.gate')) return;
  const g = document.createElement('div'); g.className = 'gate';
  g.innerHTML = `<div class="gate-inner">
    ${$('.logo')?.outerHTML || '<span class="logo-text">IMA</span>'}
    <h1>מי אתה?</h1><p>בחר/י את השם שלך מהרשימה, או הוסף/י את עצמך.</p>
    <input class="input" id="g-q" placeholder="חיפוש לפי שם" autocomplete="off">
    <div id="g-list"></div>
    <div class="group-title">לא ברשימה?</div>
    <button class="btn ghost block" id="g-add">הוספת עצמי</button>
  </div>`;
  document.body.append(g);
  $('#g-q', g).oninput = (e) => { query = e.target.value.trim(); renderGate(); };
  $('#g-add', g).onclick = () => profileSheet(null);
  renderGate();
}
function hideGate() { $('.gate')?.remove(); }
function renderGate() {
  const el = $('#g-list'); if (!el) return;
  const list = people.filter((p) => !query || p.name.includes(query));
  if (!list.length) { el.innerHTML = `<p style="margin-top:14px">${people.length ? 'לא נמצא. אפשר להוסיף את עצמך למטה.' : 'הרשימה עוד ריקה – הראשון שמוסיף את עצמו פותח אותה.'}</p>`; return; }
  const order = [...roles, ...new Set(list.map((p) => p.role))].filter((r, i, a) => a.indexOf(r) === i);
  el.innerHTML = order.filter((r) => list.some((p) => p.role === r)).map((r) => `
    <div class="group-title">${esc(r)}</div>
    <div class="pick">${list.filter((p) => p.role === r).sort((a, b) => a.name.localeCompare(b.name, 'he')).map((p) =>
      `<button data-id="${esc(p.id)}">${av(p, 42)}<span><b>${esc(p.name)}</b><small>${esc(p.role)}</small></span></button>`).join('')}</div>`).join('');
  $$('#g-list button').forEach((b) => (b.onclick = () => { me = b.dataset.id; ls.set('ima.me', me); hideGate(); renderMe(); renderPtt(); }));
}

// ---------- profile sheet (add / edit / switch) ----------
async function squareAvatar(file) {
  const url = URL.createObjectURL(file); const img = new Image(); img.src = url; await img.decode();
  const s = Math.min(img.naturalWidth, img.naturalHeight); const c = document.createElement('canvas'); c.width = c.height = 160;
  c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 160, 160);
  URL.revokeObjectURL(url); return c.toDataURL('image/jpeg', 0.82);
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }
function profileSheet(p) {
  const isNew = !p; let role = p?.role || roles[1] || 'אחר'; let avatar = p?.avatar || '';
  $('#sheet-root').innerHTML = `<div class="backdrop"></div><div class="sheet" role="dialog" aria-modal="true">
    <h3>${isNew ? 'הוספת עצמי' : 'הפרופיל שלי'}</h3>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px"><span id="pv"></span>
      <label class="btn ghost">תמונה<input type="file" accept="image/*" id="pf" hidden></label></div>
    <label class="field"><span>שם מלא</span><input class="input" id="pn" maxlength="40" value="${esc(p?.name || '')}" placeholder="למשל: ד״ר דנה לוי"></label>
    <div class="field"><span>תפקיד</span><div class="roles" id="pr">${roles.map((r) => `<button type="button" data-r="${esc(r)}" aria-pressed="${r === role}">${esc(r)}</button>`).join('')}</div></div>
    <div class="row-actions"><button class="btn" id="ps">${isNew ? 'הוספה וכניסה' : 'שמירה'}</button><button class="btn ghost" id="pc">ביטול</button></div>
    ${isNew ? '' : `<div class="row-actions"><button class="btn ghost" id="pw">החלפת משתמש</button><button class="btn danger" id="pd">הסרה מהרשימה</button></div>`}
  </div>`;
  const root = $('#sheet-root');
  const pv = () => ($('#pv', root).innerHTML = av({ name: $('#pn', root).value || '?', avatar }, 64));
  pv(); $('#pn', root).oninput = pv;
  $('#pf', root).onchange = async (e) => { if (e.target.files[0]) { avatar = await squareAvatar(e.target.files[0]); pv(); } };
  $$('#pr button', root).forEach((b) => (b.onclick = () => { role = b.dataset.r; $$('#pr button', root).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
  $('.backdrop', root).onclick = closeSheet; $('#pc', root).onclick = closeSheet;
  $('#ps', root).onclick = async () => {
    const name = $('#pn', root).value.trim(); if (!name) return toast('צריך שם');
    const res = isNew ? await emit('person:add', { name, role, avatar }) : await emit('person:update', { id: p.id, name, role, avatar });
    if (!res?.ok) return toast(res?.error || 'לא נשמר');
    closeSheet(); if (isNew) { me = res.person.id; ls.set('ima.me', me); hideGate(); renderMe(); renderPtt(); }
  };
  $('#pw', root)?.addEventListener('click', () => { closeSheet(); leave(); me = null; ls.set('ima.me', null); showGate(); renderMe(); });
  $('#pd', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget; if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = 'בטוח? לחיצה נוספת'; return; }
    closeSheet(); leave(); await emit('person:remove', { id: p.id });
  });
}

// ---------- voice (LiveKit, push-to-talk only) ----------
let room = null; let connecting = false; let tx = false; let actx;
const txState = new Map(); // personId -> start time of current transmission
const log = [];

function beep(kind) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(); const g = actx.createGain(); const t = actx.currentTime;
    const f = { start: [1400, 1900], end: [1000, 700], in: [880, 1320], busy: [300, 300] }[kind] || [1000, 1000];
    o.type = 'square'; o.frequency.setValueAtTime(f[0], t); o.frequency.exponentialRampToValueAtTime(f[1], t + 0.09);
    g.gain.setValueAtTime(0.045, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.14);
  } catch {}
}
const micPub = () => room?.localParticipant.getTrackPublication(LivekitClient.Track.Source.Microphone);
const otherTalking = () => [...txState.keys()].some((id) => id !== me);

async function connect() {
  if (!me || connecting || room) return;
  if (!voiceOn) return toast('הקשר עוד לא מוגדר בשרת');
  if (!window.LivekitClient) return toast('רכיב הקשר לא נטען – בדקו חיבור');
  connecting = true; renderPtt();
  try {
    const r = await fetch(`/ima/api/token?id=${encodeURIComponent(me)}`); if (!r.ok) throw new Error('token');
    const { url, token } = await r.json();
    const { Room, RoomEvent, Track } = LivekitClient;
    room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    room.on(RoomEvent.TrackSubscribed, (t) => { if (t.kind === 'audio') { const el = t.attach(); el.dataset.lk = 1; document.body.append(el); } });
    room.on(RoomEvent.TrackUnsubscribed, (t) => t.detach().forEach((e) => e.remove()));
    const onMute = (pub, part, muted) => {
      if (pub.source !== Track.Source.Microphone || part === room.localParticipant) return;
      const id = pidOf(part.identity);
      if (!muted && !txState.has(id)) { txState.set(id, Date.now()); beep('in'); }
      if (muted && txState.has(id)) { log.unshift({ id, name: part.name, start: txState.get(id), end: Date.now() }); txState.delete(id); beep('end'); renderLog(); }
      renderChannel(); renderOnline(); renderPtt();
    };
    room.on(RoomEvent.TrackMuted, (pub, part) => onMute(pub, part, true));
    room.on(RoomEvent.TrackUnmuted, (pub, part) => onMute(pub, part, false));
    room.on(RoomEvent.TrackPublished, (pub, part) => { if (!pub.isMuted) onMute(pub, part, false); });
    room.on(RoomEvent.ParticipantDisconnected, (part) => { txState.delete(pidOf(part.identity)); renderChannel(); renderOnline(); renderPtt(); });
    room.on(RoomEvent.ParticipantConnected, () => { renderOnline(); renderChannel(); });
    room.on(RoomEvent.Reconnecting, () => setConn('wait', 'מתחבר מחדש…'));
    room.on(RoomEvent.Reconnected, () => setConn('on', 'מחובר'));
    room.on(RoomEvent.Disconnected, () => { room = null; tx = false; txState.clear(); $$('audio[data-lk]').forEach((e) => e.remove()); setConn('', 'לא מחובר'); renderAll(); });
    await room.connect(url, token);
    await room.startAudio();
    await room.localParticipant.setMicrophoneEnabled(true);
    await micPub()?.mute();
    setConn('on', 'מחובר');
  } catch (e) {
    console.error(e);
    toast(e?.name === 'NotAllowedError' ? 'צריך לאשר גישה למיקרופון' : 'לא הצלחנו להתחבר לקשר');
    try { await room?.disconnect(); } catch {} room = null;
  }
  connecting = false; renderAll();
}
async function leave() { try { await room?.disconnect(); } catch {} room = null; }
async function setTx(on) {
  if (!room || tx === on) return;
  if (on && otherTalking() && person(me)?.role !== 'מוקד') { beep('busy'); toast('הערוץ תפוס – חכו שיסיימו'); return; }
  tx = on; const pub = micPub();
  if (pub?.track) await (on ? pub.unmute() : pub.mute());
  beep(on ? 'start' : 'end');
  if (on) txState.set(me, Date.now());
  else if (txState.has(me)) { log.unshift({ id: me, name: person(me)?.name, start: txState.get(me), end: Date.now() }); txState.delete(me); renderLog(); }
  renderPtt(); renderChannel(); renderOnline();
}
function setConn(cls, text) { const el = $('#conn'); el.className = 'pill ' + cls; el.textContent = text; }

// ---------- render ----------
function renderAll() { renderPtt(); renderChannel(); renderOnline(); renderLog(); }
function renderPtt() {
  const b = $('#ptt'); b.classList.toggle('ready', !!room); b.classList.toggle('tx', tx);
  b.classList.toggle('blocked', !!room && !tx && otherTalking() && person(me)?.role !== 'מוקד');
  b.disabled = !me || connecting;
  $('#leave').hidden = !room;
  if (!room) { $('#ptt-label').textContent = connecting ? 'מתחבר…' : 'התחברות לקשר'; $('#ptt-hint').textContent = 'לחיצה אחת כדי להתחיל'; return; }
  if (tx) { $('#ptt-label').textContent = 'משדר'; $('#ptt-hint').textContent = 'שחררו לסיום'; return; }
  if (otherTalking()) { $('#ptt-label').textContent = 'ערוץ תפוס'; $('#ptt-hint').textContent = person(me)?.role === 'מוקד' ? 'מוקד: אפשר לפרוץ לשידור' : 'מחכים לסיום השידור'; return; }
  $('#ptt-label').textContent = 'לחץ לדבר'; $('#ptt-hint').textContent = 'החזיקו את הכפתור';
}
let timerT;
function renderChannel() {
  const el = $('#channel'); clearInterval(timerT);
  const n = room ? room.remoteParticipants.size + 1 : 0;
  const talking = [...txState.entries()];
  el.classList.toggle('live', !!room); el.classList.toggle('busy', talking.length > 0);
  if (talking.length) {
    const [id, start] = talking[0]; const p = person(id) || { name: '?' };
    el.innerHTML = `<div class="ch-busy">${av(p, 48)}<div><b>${esc(p.name)}${id === me ? ' (אני)' : ''}</b><small>${esc(p.role || '')} · משדר עכשיו</small></div><span class="timer" id="timer"></span></div>`;
    const tick = () => { const t = $('#timer'); if (t) t.textContent = fmtDur(Date.now() - start).replace(' שנ׳', 's'); };
    tick(); timerT = setInterval(tick, 500);
  } else {
    el.innerHTML = `<div class="ch-idle"><span class="ch-dot"></span><div><b>${room ? 'ערוץ פנוי' : 'לא מחובר לערוץ'}</b><small>${room ? `${n} מחוברים לערוץ` : 'לחצו על הכפתור כדי להתחבר'}</small></div></div>`;
  }
}
function renderOnline() {
  const el = $('#online'); if (!el) return;
  if (!room) { el.innerHTML = '<span class="empty">מתחברים כדי לראות מי בערוץ.</span>'; $('#online-n').textContent = '0'; return; }
  const parts = [room.localParticipant, ...room.remoteParticipants.values()];
  const seen = new Set(); const rows = [];
  for (const pt of parts) {
    const id = pidOf(pt.identity); if (seen.has(id)) continue; seen.add(id);
    const p = person(id) || { name: pt.name || '?', role: '' };
    rows.push(`<div class="p ${txState.has(id) ? 'tx' : ''}">${av(p, 52)}<span>${esc(p.name.split(' ').slice(0, 2).join(' '))}${id === me ? ' (אני)' : ''}</span><small>${esc(p.role || '')}</small></div>`);
  }
  $('#online-n').textContent = rows.length; el.innerHTML = rows.join('');
}
function renderLog() {
  const el = $('#log');
  el.innerHTML = log.length ? log.slice(0, 25).map((l) => { const p = person(l.id) || { name: l.name || '?' };
    return `<li>${av(p, 30)}<span class="who">${esc(p.name)}<small>${esc(p.role || '')}</small></span><span class="t">${clock(l.start)}<br>${fmtDur(l.end - l.start)}</span></li>`; }).join('')
    : '<li class="empty">עוד לא היו שידורים מאז שהתחברת.</li>';
}

// ---------- PTT input ----------
const ptt = $('#ptt');
ptt.addEventListener('click', () => { if (!room) connect(); });
ptt.addEventListener('pointerdown', (e) => { if (!room) return; e.preventDefault(); ptt.setPointerCapture?.(e.pointerId); setTx(true); });
const up = () => { if (tx) setTx(false); };
ptt.addEventListener('pointerup', up); ptt.addEventListener('pointercancel', up); ptt.addEventListener('lostpointercapture', up);
ptt.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && room && !e.repeat && !e.target.closest('input')) { e.preventDefault(); setTx(true); } });
document.addEventListener('keyup', (e) => { if (e.code === 'Space' && room) { e.preventDefault(); setTx(false); } });
$('#leave').onclick = leave;

// keep the screen on while on duty
let wake = null;
$('#wake').onclick = async (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', on);
  if (on) { try { wake = await navigator.wakeLock.request('screen'); } catch { toast('הדפדפן לא מאפשר להשאיר מסך דלוק'); } } else { wake?.release(); wake = null; }
};
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && $('#wake').getAttribute('aria-pressed') === 'true') { try { wake = await navigator.wakeLock.request('screen'); } catch {} } });

renderAll();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/ima/sw.js', { scope: '/ima/' }).catch(() => {});
