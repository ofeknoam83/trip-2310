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
