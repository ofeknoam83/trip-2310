// Route import: GPX / KML / KMZ / GeoJSON files and share links (Amud Anan, Off-Road, Israel Hiking Map,
// Google My Maps, or any link that serves one of those files).
import { unzipSync, strFromU8 } from 'fflate';

const UA = 'Mozilla/5.0 (trip-2310 route import)';
const MAX_BYTES = 15 * 1024 * 1024;

// ---------- geometry ----------
export function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const okPt = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

// Drop points closer than minM to the previous kept point, then thin evenly to a hard cap
function simplify(pts, minM = 8, cap = 5000) {
  const out = [];
  for (const p of pts) if (!out.length || distM(out[out.length - 1], p) >= minM) out.push(p);
  if (pts.length && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  if (out.length <= cap) return out;
  const step = out.length / cap;
  return Array.from({ length: cap }, (_, i) => out[Math.floor(i * step)]).concat([out[out.length - 1]]);
}

// ---------- parsers ----------
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${t}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${t}>`, 'i')); return m ? decode(m[1]) : ''; };
const attr = (s, a) => { const m = s.match(new RegExp(`\\b${a}\\s*=\\s*["']([^"']+)["']`, 'i')); return m ? m[1] : null; };

function parseGpx(xml) {
  const lines = []; const wpts = [];
  // Tracks (each trkseg is a line) and routes
  for (const seg of xml.match(/<(?:\w+:)?(trkseg|rte)\b[\s\S]*?<\/(?:\w+:)?\1>/gi) || []) {
    const pts = [...seg.matchAll(/<(?:\w+:)?(?:trkpt|rtept)\b([^>]*)>/gi)].map((m) => [+attr(m[1], 'lat'), +attr(m[1], 'lon')]).filter(okPt);
    if (pts.length > 1) lines.push(pts);
    // Named route points are waypoints too
    for (const m of seg.matchAll(/<(?:\w+:)?rtept\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?rtept>/gi)) {
      const name = tag(m[2], 'name'); if (name) wpts.push({ name, lat: +attr(m[1], 'lat'), lng: +attr(m[1], 'lon'), desc: tag(m[2], 'desc') || tag(m[2], 'cmt') });
    }
  }
  for (const m of xml.matchAll(/<(?:\w+:)?wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?wpt>)/gi)) {
    wpts.push({ name: tag(m[2] || '', 'name') || 'נקודת ציון', lat: +attr(m[1], 'lat'), lng: +attr(m[1], 'lon'), desc: tag(m[2] || '', 'desc') || tag(m[2] || '', 'cmt') });
  }
  const meta = xml.match(/<(?:\w+:)?metadata\b[\s\S]*?<\/(?:\w+:)?metadata>/i)?.[0] || '';
  const trk = xml.match(/<(?:\w+:)?(?:trk|rte)\b[\s\S]*?<\/(?:\w+:)?(?:trk|rte)>/i)?.[0] || '';
  const name = tag(meta, 'name') || tag(trk.replace(/<(?:\w+:)?(?:trkseg|rtept)\b[\s\S]*/i, ''), 'name');
  return { name, lines, wpts };
}

function parseKml(xml) {
  const lines = []; const wpts = [];
  const coords = (s) => s.trim().split(/\s+/).map((t) => t.split(',')).map(([lng, lat]) => [+lat, +lng]).filter(okPt);
  for (const pm of xml.match(/<(?:\w+:)?Placemark\b[\s\S]*?<\/(?:\w+:)?Placemark>/gi) || []) {
    const name = tag(pm.replace(/<(?:\w+:)?(?:LineString|Point|MultiGeometry)\b[\s\S]*/i, ''), 'name');
    const desc = tag(pm, 'description');
    for (const ls of pm.match(/<(?:\w+:)?LineString\b[\s\S]*?<\/(?:\w+:)?LineString>/gi) || []) {
      const pts = coords(tag(ls, 'coordinates')); if (pts.length > 1) lines.push(pts);
    }
    // gx:Track
    const gx = [...pm.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/gi)].map((m) => m[1].trim().split(/\s+/)).map(([lng, lat]) => [+lat, +lng]).filter(okPt);
    if (gx.length > 1) lines.push(gx);
    for (const pt of pm.match(/<(?:\w+:)?Point\b[\s\S]*?<\/(?:\w+:)?Point>/gi) || []) {
      const [p] = coords(tag(pt, 'coordinates')); if (p) wpts.push({ name: name || 'נקודת ציון', lat: p[0], lng: p[1], desc });
    }
  }
  const doc = xml.match(/<(?:\w+:)?Document\b[\s\S]*?(?=<(?:\w+:)?(?:Placemark|Folder)\b)/i)?.[0] || '';
  return { name: tag(doc, 'name'), lines, wpts };
}

function parseGeoJson(j) {
  const lines = []; const wpts = [];
  const feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ geometry: j, properties: {} }];
  const ll = (c) => [+c[1], +c[0]];
  for (const f of feats || []) {
    const g = f.geometry || {}; const name = f.properties?.name || f.properties?.title || '';
    if (g.type === 'LineString') lines.push(g.coordinates.map(ll).filter(okPt));
    if (g.type === 'MultiLineString') for (const c of g.coordinates) lines.push(c.map(ll).filter(okPt));
    if (g.type === 'Point') wpts.push({ name: name || 'נקודת ציון', lat: +g.coordinates[1], lng: +g.coordinates[0], desc: f.properties?.description || '' });
  }
  return { name: j.name || j.properties?.name || '', lines: lines.filter((l) => l.length > 1), wpts };
}

// Israel Hiking Map share data container
function parseIhm(j) {
  const lines = []; const wpts = [];
  const routes = j.dataContainer?.routes || j.routes || [];
  for (const r of routes) {
    for (const s of r.segments || []) {
      const pts = (s.latlngs || []).map((p) => [+p.lat, +p.lng]).filter(okPt);
      if (pts.length > 1) lines.push(pts);
    }
    for (const m of r.markers || []) wpts.push({ name: m.title || 'נקודת ציון', lat: +m.latlng?.lat, lng: +m.latlng?.lng, desc: m.description || '' });
  }
  return { name: j.title || routes[0]?.name || '', lines, wpts, joined: true };
}

// Turn parsed lines into one route. Lines are chained in file order, each flipped if that brings it closer.
function finish(parsed, fallbackName) {
  const lines = parsed.lines.filter((l) => l.length > 1);
  if (!lines.length) throw new Error('לא נמצא מסלול בקובץ');
  let pts = [];
  for (const l of lines) {
    if (pts.length) {
      const end = pts[pts.length - 1];
      const fwd = distM(end, l[0]), rev = distM(end, l[l.length - 1]);
      pts = pts.concat(rev < fwd ? [...l].reverse() : l);
    } else pts = l.slice();
  }
  pts = simplify(pts).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]);
  let km = 0; for (let i = 1; i < pts.length; i++) km += distM(pts[i - 1], pts[i]) / 1000;
  const wpts = parsed.wpts.filter((w) => okPt([w.lat, w.lng])).slice(0, 300)
    .map((w) => ({ name: String(w.name).slice(0, 80), lat: +(+w.lat).toFixed(6), lng: +(+w.lng).toFixed(6), desc: String(w.desc || '').slice(0, 300) }));
  return { name: String(parsed.name || fallbackName || 'ציר ניווט').slice(0, 80), pts, wpts, km: +km.toFixed(2) };
}

// Bytes → route, by sniffing the content
export function parseRouteBytes(buf, nameHint = '') {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) { // zip → KMZ
    const files = unzipSync(new Uint8Array(b));
    const kml = Object.keys(files).find((f) => /\.kml$/i.test(f));
    if (!kml) throw new Error('בקובץ KMZ אין KML');
    return finish(parseKml(strFromU8(files[kml])), nameHint);
  }
  const text = b.toString('utf8').replace(/^﻿/, '');
  const head = text.slice(0, 2000);
  if (/<gpx\b/i.test(head) || /<gpx\b/i.test(text)) return finish(parseGpx(text), nameHint);
  if (/<kml\b/i.test(head) || /<Placemark\b/i.test(text)) return finish(parseKml(text), nameHint);
  if (/^\s*[{[]/.test(text)) {
    const j = JSON.parse(text);
    if (j.dataContainer || (Array.isArray(j.routes) && j.routes[0]?.segments)) return finish(parseIhm(j), nameHint);
    return finish(parseGeoJson(j), nameHint);
  }
  throw new Error('פורמט לא מוכר – צריך GPX, KML, KMZ או GeoJSON');
}

// ---------- links ----------
async function get(url, depth = 0, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`הקישור החזיר שגיאה ${r.status}`);
  const len = +r.headers.get('content-length') || 0;
  if (len > MAX_BYTES) throw new Error('הקובץ גדול מדי');
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, type: r.headers.get('content-type') || '', finalUrl: r.url, depth };
}

// Rewrite well-known share links to the URL that serves the route data
function knownSource(u) {
  const url = new URL(u);
  const host = url.hostname.replace(/^www\./, '');
  // Israel Hiking Map: /share/{id} → JSON data container
  if (/israelhiking\.osm\.org\.il$/.test(host)) {
    const id = url.pathname.match(/\/share\/([^/?#]+)/)?.[1] || url.searchParams.get('s');
    if (id) return { url: `https://israelhiking.osm.org.il/api/urls/${encodeURIComponent(id)}`, source: 'israelhiking' };
  }
  // Google My Maps → KML export
  if (/google\.[a-z.]+$/.test(host) && url.pathname.startsWith('/maps/d/')) {
    const mid = url.searchParams.get('mid');
    if (mid) return { url: `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`, source: 'mymaps' };
  }
  return null;
}

export function sourceOf(u) {
  const h = (() => { try { return new URL(u).hostname; } catch { return ''; } })();
  if (/amudanan/.test(h)) return 'amudanan';
  if (/off-road|offroad|onelink|myadventure/.test(h)) return 'offroad';
  if (/israelhiking/.test(h)) return 'israelhiking';
  if (/google\./.test(h)) return 'mymaps';
  return 'link';
}

// Off-Road (off-road.io/track/{id}): track details, then its point layers
const OFFROAD_API = 'https://api.off-road.io/_ah/api/offroadApi/v2';
const offroadId = (u) => { try { const x = new URL(u); return /off-road\.io$/.test(x.hostname) ? x.pathname.match(/\/track\/(\d{6,})/)?.[1] : null; } catch { return null; } };
async function fetchOffroad(id) {
  const h = { referer: 'https://off-road.io/', origin: 'https://off-road.io', accept: 'application/json' };
  const t = JSON.parse((await get(`${OFFROAD_API}/tracks/trackResult/${id}`, 0, h)).buf.toString('utf8')).track;
  if (!t?.trackLayerKey) throw new Error('המסלול באוף רוד לא נמצא או שהוא פרטי');
  const lay = JSON.parse((await get(`${OFFROAD_API}/trackLayers/${encodeURIComponent(t.trackLayerKey)}`, 0, h)).buf.toString('utf8'));
  const lines = (lay.layers || []).map((l) => (l.path || []).map((p) => [+p.latitude, +p.longitude]).filter(okPt)).filter((l) => l.length > 1);
  // Off-Road titles often end with the recording date and time
  const name = String(t.title || '').replace(/[\s-–]*\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?)?\s*$/, '').replace(/\s+/g, ' ').trim();
  return finish({ name, lines, wpts: [] }, 'מסלול מאוף רוד');
}

export async function fetchRoute(link) {
  let url;
  try { url = new URL(String(link).trim().match(/https?:\/\/\S+/)?.[0] || String(link).trim()).href; } catch { throw new Error('זה לא נראה כמו קישור'); }
  const orId = offroadId(url);
  if (orId) return fetchOffroad(orId);
  const known = knownSource(url);
  const first = await get(known?.url || url);
  const orAfter = offroadId(first.finalUrl); // short links that redirect to off-road.io
  if (orAfter) return fetchOffroad(orAfter);
  try { return parseRouteBytes(first.buf); } catch (e) { if (!/<html|<!doctype/i.test(first.buf.slice(0, 600).toString())) throw e; }

  // An HTML page: maybe it redirected to a known service, or it links to a route file
  const again = knownSource(first.finalUrl);
  if (again && again.url !== known?.url) return parseRouteBytes((await get(again.url)).buf);
  const html = first.buf.toString('utf8');
  const cands = [...html.matchAll(/(?:href|src|content|data-url)\s*=\s*["']([^"']+?\.(?:gpx|kml|kmz|geojson)(?:\?[^"']*)?)["']/gi)].map((m) => m[1])
    .concat([...html.matchAll(/["'](https?:\/\/[^"'\s]+?\.(?:gpx|kml|kmz|geojson)(?:\?[^"'\s]*)?)["']/gi)].map((m) => m[1]));
  for (const c of [...new Set(cands)].slice(0, 4)) {
    try { return parseRouteBytes((await get(new URL(c.replace(/&amp;/g, '&'), first.finalUrl).href)).buf); } catch { /* next */ }
  }
  const err = new Error('nofile');
  err.code = 'NOFILE';
  throw err;
}
