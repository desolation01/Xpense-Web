# Xpense Web

Clean route-first static structure for fast navigation and maintenance.

## Routes
- `/` -> landing page
- `/tracker-login` -> auth page
- `/expense-tracker` -> dashboard
- `/user-manual` -> manual/docs

## Project Structure
- `api/` - serverless API handlers (`api.js`, `chat.js`)
- `assets/` - images/icons/screenshots/docs media
- `css/` - shared styles (`landing.css`, `tracker.css`, etc.)
- `js/` - client scripts (`tracker.js`, `pwa.js`, auth logic)
- `expense-tracker/index.html` - dashboard page
- `tracker-login/index.html` - login/register page
- `user-manual/index.html` - manual page
- `index.html` - landing page
- `sw.js` - service worker
- `manifest.json` - PWA manifest
- `dev-server.js` - local dev server

## Backward Compatibility
Legacy files are preserved as redirects:
- `expense-tracker.html` -> `/expense-tracker`
- `tracker-login.html` -> `/tracker-login`
- `user-manual.html` -> `/user-manual`

## Local Development
```bash
npm run dev
```
Then open `http://localhost:3000`.
