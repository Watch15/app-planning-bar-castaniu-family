# Product Requirements Document — Planning Bar

## 1. Purpose

Planning Bar is a multi-establishment staff scheduling web application designed for a bar/restaurant owner managing multiple venues and a team of employees. It provides a full scheduling interface for the owner and a read-only personal planning view for each staff member, accessible on mobile as a PWA.

---

## 2. Users & Roles

| Role | Description |
|---|---|
| `patron` | Super-admin. Full access to all establishments, all staff, all settings. |
| `directeur` | Manager scoped to assigned establishments. Can manage planning and staff for their venues. |
| `staff` | Employee. Read-only access to their own schedule and availability submission. |
| `etablissement` | Per-venue account for on-site timeclock access (`pointage.html`). |

---

## 3. Core Features

### 3.1 Authentication
- Email or phone number + password login (bcryptjs, 12 rounds)
- Server-side sessions stored in MongoDB (7-day TTL, httpOnly cookie)
- Invitation by email via Resend API — 24h activation link
- Password reset by email link (1h expiry)
- Manual link fallback if email delivery fails
- Rate limiting: 10 attempts per 15 min per IP

### 3.2 Multi-establishment Planning (Patron / Directeur view — `index.html`)

#### Header
- Two-level header: actions row (Staff, Accounts, Availabilities, toggle, user, logout) + scrollable establishments row
- User avatar (initial letter)
- Red badge on Availabilities button when pending submissions exist
- Mobile: hamburger menu opens a bottom-sheet drawer

#### Week navigation
- Previous / Next arrows, Today button
- Two views: **Day** (timeline) and **Week** (dashboard + agenda)

#### Week cards
- 7 clickable cards (Mon → Sun)
- Colour dots representing scheduled staff per day
- Today: purple border — Selected day: black border — Empty: red dashed border
- `!` alert if no `responsable`-role staff is scheduled (when responsible roles exist)

#### Day timeline
- Drag & drop scheduling per staff member
- Hour snap, left/right resize
- Cross-establishment conflict and overlap detection
- Confirmed availabilities displayed as semi-transparent background
- Copy a day's shifts to other days of the week
- "Publish week" button

#### Staff bar
- Real-time name search
- Role filter pills (dynamic)
- Preferred-venue staff shown first with ★ badge
- Role badge per card (responsible role takes priority)
- Drag & drop to timeline

### 3.3 Joker Shifts
A **Joker** is a placeholder shift with no assigned staff member (`staff_id: '__joker__'`, `is_joker: true`). It represents an open slot that needs filling.

- Jokers are excluded from conflict detection
- Jokers appear in the staff member's view so they can see open slots at their establishment
- A joker can be converted to a real shift by assigning a staff member (sets `is_joker: false`)
- Jokers are filtered out of colleague lists and statistics

### 3.4 Web Push Notifications
- VAPID-based push via `web-push` library
- Service Worker handles push reception and displays notifications with icon, badge, vibration
- Notification click opens / focuses the relevant page
- Staff subscriptions stored in `push_subscriptions` collection (stale 410/404 subscriptions auto-deleted)
- Debounce: shift update notifications fire 60 seconds after last drag/resize to avoid spam
- In-app notifications for patron/directeur stored in `notifications` collection

### 3.5 Staff Management
- Colour, name, email per person
- Preferred establishments: staff appears first in the bar (★ gold)
- Role assignment: clickable badges grouped as Responsable / Informatif
- Individual save, deletion with all associated shifts

### 3.6 Roles
- Free-form role creation with name and type
- **Responsable**: visual alert on planning if absent from a service
- **Informatif**: indication for patron only
- Deletion removes role from all profiles

### 3.7 Account Management
- Invite staff, directeur, or etablissement by email with activation link
- Link account ↔ staff profile
- Patron can reset any account password
- Account deletion

### 3.8 Availabilities (Staff side — `planning.html`)
- Staff submits for the following week; deadline auto-set to Friday 13:00
- Per day: **Evening** (16h→2h), **Midday** (10h→17h), **Custom**, **Unavailable**
- Optional note per day
- Fixed "Send my availabilities" button at bottom of screen

### 3.9 Availabilities (Patron side)
- Toggle open / close availability submission
- Validate: choose establishment, auto-create shift
- One-click reject

### 3.10 Publication
- "Publish week" makes the schedule visible to staff
- Unpublish possible at any time

### 3.11 Staff View (`planning.html`)
- Stats: days worked, shifts, total hours
- Working days: coloured border, establishment, times, duration, colleagues
- Today: purple border
- Rest days: compact 5-column grid (no empty rows)
- Next week visible if published

### 3.12 PWA
- Installable on mobile without App Store
- iOS (Safari): Share → Add to Home Screen
- Android (Chrome): Menu → Install app
- Launches fullscreen; Service Worker caches static assets (instant load, partial offline)
- API/auth requests always go through the network

### 3.13 SMS (Twilio)
- Optional SMS sending via Twilio API
- French mobile number normalisation (06/07 → +336/+337)
- Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` env vars

---

## 4. MongoDB Collections

| Collection | Contents |
|---|---|
| `establishments` | Bars/restaurants with schedules |
| `staff` | Members (colour, email, preferred venues, roles) |
| `shifts` | Scheduled shifts (includes `is_joker` flag) |
| `users` | Login accounts |
| `sessions` | Active sessions (auto-TTL) |
| `availabilities` | Staff-submitted availabilities |
| `roles` | Patron-created roles |
| `settings` | Settings (availability open state, published weeks) |
| `push_subscriptions` | Web Push endpoint subscriptions per user |
| `notifications` | In-app notifications for patron/directeur |

---

## 5. Environment Variables

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Express session signing key |
| `NODE_ENV` | `production` enables secure cookies and CORS restriction |
| `APP_URL` | Public URL (used for CORS and email links) |
| `RESEND_API_KEY` | Resend email API key |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key |
| `VAPID_EMAIL` | Contact email for VAPID (default `mailto:admin@planning-bar.fr`) |
| `TWILIO_ACCOUNT_SID` | Twilio account SID (optional) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token (optional) |
| `TWILIO_FROM` | Twilio sender number (optional) |

---

## 6. Hosting

- **Platform**: Railway
- **Database**: MongoDB Atlas (`gestion_bar`)
