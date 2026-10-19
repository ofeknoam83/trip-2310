/**
 * Trip photos uploader – Google Apps Script web app.
 * Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Set FOLDER_ID below to the Drive folder that holds the trip photos
 * (share the folder as "Anyone with the link – Viewer").
 */
const FOLDER_ID = '12_cVJ_vMYbYHOF_EaNxHMZ76399Hac9N';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  if (action === 'list') return json_({ ok: true, files: list_() });
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'sheetClaim') return json_(sheetClaim_(body));
    if (body.action === 'sheetAdd') return json_(sheetAdd_(body));
    if (body.action !== 'upload') return json_({ ok: false, error: 'unknown action' });
    const mime = body.mime || 'image/jpeg';
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov' }[mime] || 'jpg';
    const stamp = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd_HH-mm-ss');
    const who = String(body.by || 'אורח').slice(0, 40);
    const blob = Utilities.newBlob(Utilities.base64Decode(body.data), mime, stamp + '_' + who + '.' + ext);
    const file = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
    file.setDescription(JSON.stringify({ by: who, byId: String(body.byId || '').slice(0, 40) }));
    return json_({ ok: true, id: file.getId() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function list_() {
  const out = [];
  const it = DriveApp.getFolderById(FOLDER_ID).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    let meta = {};
    try { meta = JSON.parse(f.getDescription() || '{}'); } catch (e) {}
    out.push({
      id: f.getId(),
      name: f.getName(),
      mime: f.getMimeType(),
      by: meta.by || '',
      byId: meta.byId || '',
      t: f.getDateCreated().getTime(),
    });
  }
  out.sort(function (a, b) { return b.t - a.t; });
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: authorizes Drive and opens the folder to anyone with the link (view only). */
function setup() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  Logger.log('Folder shared: ' + folder.getUrl());
}

// ---------- gear sheet (two-way sync; never overwrites existing content) ----------
function sheet_(body) {
  const ss = SpreadsheetApp.openById(String(body.sheetId));
  const gid = Number(body.gid || 0);
  return ss.getSheets().filter(function (sh) { return sh.getSheetId() === gid; })[0] || ss.getSheets()[0];
}
function tokens_(text) {
  return String(text || '').split(/\s*[,،\/]\s*/).map(function (t) { return t.trim(); }).filter(String);
}

/** Add or remove one name in an "אחראי" cell. Other names in the cell are never touched. */
function sheetClaim_(body) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = sheet_(body);
    const row = Number(body.row), col = Number(body.col), respCol = Number(body.respCol);
    if (!row || !col || !respCol) return { ok: false, error: 'no responsible column' };
    const item = String(sh.getRange(row, col).getDisplayValue()).trim();
    if (item !== String(body.item).trim()) return { ok: false, error: 'row changed' };
    const cell = sh.getRange(row, respCol);
    const cur = String(cell.getDisplayValue()).trim();
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return { ok: false, error: 'no name' };
    const list = tokens_(cur);
    const has = list.indexOf(name) >= 0;
    if (body.on && !has) cell.setValue(cur ? cur + ', ' + name : name);
    if (!body.on && has) cell.setValue(list.filter(function (t) { return t !== name; }).join(', '));
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** Write a new item into the first empty cell of a column. Never writes over a non-empty cell. */
function sheetAdd_(body) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = sheet_(body);
    const col = Number(body.col), start = Number(body.headerRow || 1) + 1;
    const text = String(body.text || '').trim().slice(0, 140);
    if (!col || !text) return { ok: false, error: 'bad request' };
    const last = Math.max(sh.getLastRow(), start);
    const values = sh.getRange(start, col, last - start + 2, 1).getDisplayValues();
    for (var i = 0; i < values.length; i++) {
      if (!String(values[i][0]).trim()) {
        const cell = sh.getRange(start + i, col);
        if (String(cell.getDisplayValue()).trim()) continue; // changed meanwhile
        cell.setValue(text);
        return { ok: true, row: start + i };
      }
    }
    return { ok: false, error: 'no empty cell' };
  } finally { lock.releaseLock(); }
}

/** Run once from the editor after adding the sheet code, to grant the Sheets permission. */
function authorizeSheets() {
  SpreadsheetApp.openById('1jf0KjwNvr-dwU7q2atBx8tMkIqXq2ucJgLy-AUyLpHE').getName();
}
