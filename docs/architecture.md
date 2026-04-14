# Technical Architecture — Planning Bar

## 1. Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (current LTS) |
| Framework | Express 4 |
| Database | MongoDB Atlas — database `gestion_bar` |
| Auth | `express-session` + `bcryptjs` (12 rounds) |
| Push notifications | `web-push` (VAPID) |
| Email | Resend API (HTTP fetch, no SDK) |
| SMS | Twilio REST API (HTTP fetch, no SDK) |
| Frontend | HTML5 / CSS3 / Vanilla JS — zero frontend dependencies |
| PWA | Web App Manifest + Service Worker (`sw.js`) |
| Hosting | Railway |

---

## 2. Project Structure

```
app-planning-bar/
├── server.js                   ← Single Express entry point (monolithic)
├── package.json
├── .env                        ← Environment variables (not committed)
├── public/
│   ├── index.html              ← Patron/directeur interface
│   ├── planning.html           ← Staff interface
│   ├── pointage.html           ← Timeclock interface (etablissement role)
│   ├── login.html              ← Login page
│   ├── set-password.html       ← Activation / password reset
│   ├── script.js               ← Patron-side logic (monolithic — see constraint)
│   ├── style.css               ← Global styles
│   ├── manifest.json           ← PWA manifest
│   ├── sw.js                   ← Service Worker
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── docs/                       ← BMAD agent documentation
│   ├── prd.md
│   ├── architecture.md
│   └── backlog.md
└── scripts/
    ├── init-db.js              ← Initialises collections and indexes
    ← create-patron.js          ← Creates patron account via CLI
    └── seed.js                 ← Inserts demo data
```

---

## 3. Critical Constraints

### 3.1 Timezone — NEVER use `toISOString()`

`toISOString()` returns UTC. In UTC+2, local midnight = 22:00 UTC → off-by-one-day bug.

**Rule**: All date strings must be built with local time methods:
```js
// CORRECT
function toDateStr(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
}

// FORBIDDEN
d.toISOString().slice(0, 10)  // ← never do this
```

This applies everywhere: frontend (script.js, planning.html, index.html) and backend (server.js).

### 3.2 MongoDB Sessions — promise-based only

MongoDB 6+ dropped callback support. The `CustomMongoStore` in `server.js` uses exclusively `.then().catch()` — never callbacks passed directly to driver methods.

```js
// CORRECT
db.collection('sessions').findOne({ sid })
    .then(doc => { ... })
    .catch(err => cb(err));

// FORBIDDEN
db.collection('sessions').findOne({ sid }, (err, doc) => { ... })
```

### 3.3 `script.js` — monolithic, do not split

`script.js` is the patron-side frontend logic. It is intentionally kept as a single file for current stability. Do not refactor into modules or split into multiple files without an explicit architectural decision. Add new patron-side logic inside this file.

### 3.4 Frontend — zero build tooling

There is no bundler, transpiler, or package manager for the frontend. All frontend code is plain ES2020+ served as static files. Do not introduce npm-based frontend tooling (Webpack, Vite, React, etc.) without an explicit architectural decision.

### 3.5 API / auth always bypass Service Worker cache

The Service Worker (`sw.js`) uses Network First for `/api/*` and `/auth/*` routes. Static assets use Cache First. Never cache API responses in the Service Worker.

---

## 4. Authentication & Authorization

### Session
- `express-session` with a `CustomMongoStore` backed by the `sessions` collection
- 7-day TTL, `httpOnly` cookie, `secure` in production
- Session contains: `_id`, `email`, `phone`, `role`, `staff_id`, `assigned_establishments`, `name`

### Role hierarchy

```
patron          → super-admin, unrestricted access
directeur       → scoped to assigned_establishments[], can manage planning
staff           → read-only, own schedule + availability submission
etablissement   → timeclock access only (pointage.html)
```

Middleware:
- `requireAuth` — any authenticated user
- `requirePatron` — patron or directeur
- `requireAdmin` — patron only
- `requireEtablissement` — etablissement only
- `canAccessEstablishment(user, id)` — patron bypasses, directeur checks `assigned_establishments`

### Rate limiting
In-memory `Map`-based rate limiter (no external dependency). Login: 10 attempts / 15 min / IP. Map cleaned hourly to prevent memory leaks.

---

## 5. Data Model (key collections)

### `shifts`
```json
{
  "_id": ObjectId,
  "staff_id": "string | '__joker__'",
  "staff_name": "string",
  "establishment_id": "string",
  "date": "YYYY-MM-DD",
  "start_time": "HH:MM",
  "end_time": "HH:MM",
  "color": "#hex",
  "is_joker": false
}
```
`is_joker: true` + `staff_id: '__joker__'` = open placeholder slot (no conflict detection, visible to staff at that establishment).

### `push_subscriptions`
```json
{
  "_id": ObjectId,
  "user_id": "string",
  "subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
}
```
Stale subscriptions (410/404 from push service) are deleted automatically.

### `notifications`
```json
{
  "_id": ObjectId,
  "user_id": "string",
  "type": "string",
  "message": "string",
  "establishment_id": "string",
  "read": false,
  "created_at": ISODate
}
```

---

## 6. Web Push Architecture

1. Frontend subscribes via `navigator.serviceWorker` + `PushManager.subscribe()` using the VAPID public key
2. Subscription object sent to backend and stored in `push_subscriptions`
3. Backend sends via `webpush.sendNotification()` inside `sendPushToStaff(staffIds, payload)`
4. Shift update notifications are debounced 60 seconds (`scheduleShiftNotif`) to avoid spam during drag/resize
5. Service Worker `push` handler displays the notification; `notificationclick` handler opens/focuses the target page

---

## 7. PWA / Service Worker

- Cache name versioned with `%%BUILD_TIME%%` placeholder (replaced at deploy time)
- Install event: caches `/login.html`, `/set-password.html`, `/script.js`, `/style.css`, `/manifest.json`
- Activate event: deletes all caches except current version
- Fetch strategy:
  - `/api/*`, `/auth/*` → Network only (503 JSON on failure)
  - Everything else → Cache First, fallback to network, fallback to `/login.html`
- `message: 'skipWaiting'` forces immediate SW activation after update

---

## 8. Email (Resend)

Direct HTTP POST to `https://api.resend.com/emails`. No SDK. Sender: `Planning Bar <onboarding@resend.dev>`. Throws on non-OK response with Resend's error message.

---

## 9. SMS (Twilio)

Direct HTTP POST to Twilio REST API. No SDK. French number normalisation: `06XXXXXXXX` → `+336XXXXXXXX`. Optional feature — gracefully throws if env vars are missing.

---

## 10. Deployment (Railway)

- `npm start` runs `node server.js`
- `npm run dev` uses nodemon for hot reload
- Static files served from `public/` via `express.static`
- `sw.js` served with `Service-Worker-Allowed: /` and `Cache-Control: no-cache` headers
- All secrets via Railway environment variables (never committed)
