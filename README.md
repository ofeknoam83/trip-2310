# טיול 23-24/10

אתר הטיול של החבר׳ה: משימות, רשימת ציוד, מפה חיה עם מיקומים, קשר קולי (מכשיר קשר + שיחה פתוחה) ותמונות לתיקייה משותפת בדרייב.

## Stack
- Node 22 + Express + Socket.IO (realtime sync)
- Render Postgres (a single `docs` jsonb table; falls back to `data.json` locally)
- LiveKit Cloud for voice (TURN included, works on cellular)
- Google Apps Script web app (`apps-script/Code.gs`) saves photos to the Drive folder
- Leaflet + OpenTopoMap / Esri imagery

## Run locally
```
npm install
npm start          # http://localhost:3000
```
Optional env: `DATABASE_URL`, `APPS_SCRIPT_URL`, `DRIVE_FOLDER_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

## Deploy (Render)
New → Blueprint → this repo. `render.yaml` creates the web service (Starter) and Postgres.
Fill in the three `LIVEKIT_*` values when prompted (from LiveKit Cloud → Settings → Keys).

The seed (`seed.js`) only runs on an empty database.
