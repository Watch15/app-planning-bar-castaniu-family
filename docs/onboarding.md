# 🧭 Onboarding développeur — Templyo

> Guide de prise en main complet du projet. À lire **après** un premier survol de
> [`architecture.md`](./architecture.md), qui reste la référence technique exhaustive.
> Ce document, lui, est orienté « par où je commence et où vit chaque chose ».

---

## 0. En une phrase

**Templyo** est un **SaaS de planning multi-établissements** pour bars / restaurants :
le patron construit les plannings, le staff envoie ses disponibilités et consulte ses
shifts, les établissements pointent les heures réelles, et le patron pilote la masse
salariale (CA, coefficient). Stack **délibérément minimaliste** : Node + Express +
MongoDB, frontend **HTML/CSS/Vanilla JS sans aucun build**, le tout installable en **PWA**.

---

## 1. Démarrer en local (5 minutes)

```bash
npm install
npm run init          # crée collections + indexes MongoDB
npm run seed          # données de démo
npm run create-patron # crée un compte patron (CLI interactive)
npm run dev           # node --watch server.js (hot reload)
```

Variables d'environnement minimales dans un `.env` (non commité) :

| Variable | Rôle | Obligatoire |
|---|---|---|
| `MONGO_URI` | Connexion MongoDB Atlas (base `gestion_bar`) | ✅ |
| `SESSION_SECRET` | Secret de session — **hard-crash au boot en prod si absent** | ✅ (prod) |
| `NODE_ENV` | `development` / `production` / `test` | — |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push | optionnel |
| `RESEND_API_KEY` | E-mails (Resend) | optionnel |
| `TWILIO_*` | SMS | optionnel |
| `SENTRY_DSN` | Observabilité — Sentry activé **seulement si défini** | optionnel |
| `APP_URL` / `PUBLIC_BASE_URL` | Domaine pour liens email/SMS + flux iCal | optionnel |
| `CALENDAR_ENABLED` | Active la synchro iCal (défaut `false`, **désactivée**) | optionnel |

Puis : `http://localhost:3000` → page de login.

---

## 2. Les 6 règles d'or (à ne JAMAIS enfreindre)

Détaillées dans `architecture.md` §3. Résumé impératif :

1. **Jamais `toISOString()`** sur une date → bug de fuseau (UTC+2 : minuit local = 22h UTC, décalage d'un jour). Toujours `toDateStr()` (construction locale `YYYY-MM-DD`). Vaut front **et** back.
2. **`script.js` reste monolithique** (~8000 lignes). On n'le découpe pas en modules. Toute nouvelle logique patron s'ajoute **dedans**.
3. **Aucun outillage de build front** (pas de Webpack/Vite/React/TS). ES2020+ pur servi en statique.
4. **Jamais de `<script>` inline dans un `.html`** → bloqué par la CSP (`unsafe-inline` retiré de `script-src`, D-85). Tout JS va dans un `.js` servi en statique.
5. **Sessions MongoDB = promesses uniquement** (le driver 6+ a supprimé les callbacks). `CustomMongoStore` utilise `.then().catch()`.
6. **Helpers purs → `lib/utils.js`** (testables isolément). Helpers partagés front+Node → module UMD sous `public/lib/`.

⚠️ **Invariant sécurité** : toute nouvelle route qui crée/modifie un shift, publie le
planning ou valide une dispo **doit** porter le middleware `denyObservateurEdit`.

---

## 3. Carte du dépôt

```
app-planning-bar/
├── server.js                  ← Backend Express monolithique (TOUT le back, 4647 l.)
├── lib/utils.js               ← Helpers purs testables (171 l.)
├── package.json               ← Scripts npm + dépendances (10, toutes back)
│
├── public/                    ← Frontend statique (zéro build)
│   ├── index.html  + script.js (8074 l.) + index-init.js   → Console PATRON
│   ├── planning.html + planning.js (2440 l.)               → Espace STAFF
│   ├── pointage.html + pointage.js (807 l.)                → POINTAGE (rôle établissement)
│   ├── performance.html + performance.js (544 l.)          → PILOTAGE ÉCO
│   ├── login.html + login.js                               → Connexion
│   ├── set-password.html + set-password.js                 → Activation / reset MDP
│   ├── politique-confidentialite.html                      → Légal RGPD
│   ├── style.css                                           → Styles globaux (unique)
│   ├── sw.js + sw-register.js + manifest.json + icons/     → PWA
│   ├── lib/                    ← Modules UMD partagés navigateur ↔ Node
│   │   ├── week.js             → weekStart / currentWeekStart (cutoff 6h)
│   │   └── shift-hours.js      → heures effectives d'un shift
│   └── vendor/                 ← Libs tierces auto-hébergées (jspdf, html2canvas, xlsx)
│
├── scripts/                   ← Outils CLI (init-db, seed, create-patron)
├── tests/                     ← node --test (5 suites, sans framework)
├── docs/                      ← prd, architecture, backlog, ux-design, CE fichier
└── .github/workflows/ci.yml   ← CI Node 20 + 22
```

---

## 4. Le backend (`server.js`)

Un **seul fichier**, organisé en sections séquentielles. Ordre approximatif :

1. **Config & sécurité** : `helmet` (CSP), `cors`, `morgan`, Sentry conditionnel, rate-limiter en mémoire (`Map`, login 10/15min/IP), `trust proxy` en prod.
2. **Sessions** : `CustomMongoStore` (collection `sessions`, TTL 30 j glissant, `rolling`+`touch`).
3. **Middlewares d'auth** (cf. §5).
4. **Helpers serveur** : `sendPushToStaff`, `scheduleShiftNotif` (debounce 60 s), `sendEmail` (Resend), `sendSMS` (Twilio), `createNotifForPatrons`, `touchLastUpdated`, génération iCal…
5. **Toutes les routes API** (cf. §7).
6. **Routes statiques + `/health`** et, tout en bas, `if (require.main === module) { connectDB(); app.listen() }` — `app` est **exporté** pour les tests.

### ⚠️ Zones piégées dans `server.js`
- **`shift-swaps` (F-05)** et **iCal calendar (D-72)** : code **désactivé**. Les routes `shift-swaps` sont enfermées dans des blocs `/* */` (marqueur `F-05 — DÉSACTIVÉ`) ; le calendrier dépend du flag `CALENDAR_ENABLED`. **Ne jamais insérer de nouvelle route à l'intérieur d'un bloc commenté** (piège qui a déjà coûté un long debug : 404 silencieux).
- Les **numéros de ligne dans la doc bougent** quand le fichier grossit : repérer par marqueur texte, pas par n° de ligne.

---

## 5. Authentification & rôles

### Hiérarchie
```
patron        → super-admin, accès illimité
directeur     → limité à ses assigned_establishments[], gère le planning
observateur   → vue patron complète MAIS lecture seule sur le planning (D-86)
staff         → son planning + envoi de disponibilités
etablissement → pointage uniquement (pointage.html)
```

### Middlewares (dans `server.js`)
| Middleware | Laisse passer |
|---|---|
| `requireAuth` | tout utilisateur authentifié |
| `requirePatron` | patron, directeur **ou** observateur |
| `requireAdmin` | patron **ou** observateur (gestion staff/comptes/établissements) |
| `requirePatronOnly` | patron strict (actions sensibles : changement de rôle → anti-escalade) |
| `requireEtablissement` | rôle établissement |
| `denyObservateurEdit` | **bloque l'observateur** (403) — placé après `requirePatron` sur toutes les écritures planning |
| `canAccessEstablishment(user,id)` | patron + observateur passent ; directeur vérifie `assigned_establishments` |

La session contient : `_id`, `email`, `phone`, `role`, `staff_id`, `assigned_establishments`, `establishment_id`, `name`.

---

## 6. Modèle de données (collections MongoDB)

Base `gestion_bar`. Détail des champs dans `architecture.md` §5 — résumé :

| Collection | Contenu | Particularités |
|---|---|---|
| `users` | comptes (patron/directeur/observateur/staff/établissement) | mdp bcrypt 12 rounds, `calendar_token` (iCal) |
| `staff` | fiches staff + **rémunération** | `hourly_rate` **XOR** `fixed_rate` (mutual exclusion forcée serveur) |
| `shifts` | créneaux planifiés | `start/end_time` = **heures décimales** (`end_time ≥ 24` = shift de nuit), Jokers (`is_joker`/`joker_open`/`joker_candidates`), pointage (`real_start/end`, `*_rate_snapshot`) |
| `availabilities` | disponibilités du staff | `status: pending/approved/...`, 1 doc par `(staff_id, date)`, `type:'week_note'` à part |
| `conges` | congés déclarés/validés | `mode: info` (déclaration) ou demande à valider |
| `daily_revenue` | CA quotidien par établissement | dénominateur du coefficient masse salariale |
| `settings` | **polymorphe** (clé `key`) | `dispo`, `performance`, `pointage`, `publish_<weekStart>`, `lock_dispos_<weekStart>` |
| `notifications` | notifs in-app patron/directeur | |
| `staff_notifications` | notifs in-app staff | max 20 non lues retournées |
| `push_subscriptions` | abonnements Web Push | périmés (410/404) supprimés auto |
| `sessions` | sessions Express | gérées par `CustomMongoStore` |
| `shift_swaps` | échanges de shifts | **F-05 désactivée** |

> 🔑 **Pièges de données** :
> - `PATCH /api/staff/:id` force l'autre champ de rémunération à `null` dès qu'on en définit un (invariant « un seul mode actif ») — **même si l'appelant n'a envoyé qu'un champ**. L'import « 💶 taux » bascule donc silencieusement en mode horaire.
> - Le `*_rate_snapshot` fige le taux au **premier pointage** → stabilise la Performance historique même si le taux du staff change ensuite.

---

## 7. Cartographie des routes API (`server.js`)

> ✅ actives · 🚫 désactivées (F-05/iCal). Middlewares clés entre parenthèses.

### Auth
| Méthode | Route | Note |
|---|---|---|
| POST | `/auth/login` | rate-limité |
| POST | `/auth/logout` | |
| GET | `/auth/me` | session courante |
| POST | `/auth/set-password` | activation |
| PATCH | `/auth/reset-password` | |
| POST | `/auth/forgot-password` | envoie lien (email) |

### Comptes & établissements (admin)
`/api/users` (CRUD, `:id/role` patron-only, `:id/establishments`, `:id/reset-password`,
`:id/invite-link`, `/bulk`) · `/api/establishments` (CRUD) · `/api/groups` (GET/DELETE) ·
`/api/roles` (GET/POST/DELETE).

### Staff
`GET /api/staff` · `POST /api/staff` · `POST /api/staff/bulk` · `PATCH /api/staff/:id`
(rémunération, cf. piège §6) · `DELETE /api/staff/:id`.

### Shifts & planning
| Route | Rôle |
|---|---|
| `GET /api/shifts/:establishmentId/:date` · `/api/week/:establishmentId` · `/api/week-full/:establishmentId` | lecture planning |
| `GET /api/my-shifts` | planning du staff connecté |
| `POST /api/shifts` · `PATCH /api/shifts/:id` · `DELETE` | CRUD shift (`denyObservateurEdit`) |
| `PATCH /api/shifts/:id/transfer` · `/joker-open` | transfert / ouverture Joker |
| `POST /api/copy-day` · `/api/copy-week` | duplication |
| `GET /api/shifts/joker-ouverts` · `POST /api/shifts/:id/joker-candidature` | Jokers côté staff |
| `GET/PATCH /api/publish/:weekStart` | état / publication d'une semaine |

### Disponibilités (gros domaine)
`POST /api/dispos` (UPSERT par jour, **modifiable jusqu'à la deadline**, garde serveur 403 si deadline passée) ·
`/api/dispos/mine` · `/previous` · `/pending` · `/count` · `/non-affectees` · `/sans-dispo` ·
`/with-dispo` · `/kpi` · `/confirmed` · `/notes` · `/week-note(s)` ·
`PATCH /api/dispos/:id/confirm|reject|ignore` · `POST /api/dispos/reopen-for-correction` ·
`POST /api/dispos/rappel` (push) · `GET/PATCH /api/dispo-settings` (+ `/force-open-staff`).

### Congés
`POST /api/conges` · `GET /api/conges/mine` · `DELETE /api/conges/:id` ·
`GET /api/conges` (patron, filtres `from/to/status`) · `/api/conges/pending-count` ·
`PATCH /api/conges/:id/decision`.

### Pointage & rémunération
`GET/PATCH /api/pointage-settings` · `GET /api/pointage/:date` ·
`PATCH /api/shifts/:id/pointage` (heures réelles) · `DELETE .../pointage` ·
`PATCH /api/shifts/:id/pointage-resp` · `POST /api/shifts/extra` (shift créé en soirée).

### Performance (pilotage éco)
`POST /api/revenue` · `GET /api/revenue/:establishmentId/:date` ·
`GET /api/performance` (calcul coefficient) · `GET/PATCH /api/performance-settings` ·
`GET /api/recap-mensuel` · `GET /api/me/responsable-tonight|week`.

### Push & notifications
`GET /api/push/vapid-public-key` · `POST/DELETE /api/push/subscribe` · `POST /api/push/test` ·
`GET /api/notifications(/mine)` · `PATCH .../read(-all)` · `GET /api/last-updated`.

### Système
`GET /` · `GET /health` (`{ ok, db, uptime }`, 503 si Mongo down).

### 🚫 Désactivées
`/api/shift-swaps/*` (F-05) · `/api/calendar-url` + `/api/calendar/:token.ics` (iCal, flag `CALENDAR_ENABLED`).

---

## 8. Le frontend, fichier par fichier

### `script.js` — Console patron (8074 l., le plus gros morceau)
Organisé en blocs fonctionnels. Repères principaux (n° de ligne indicatifs) :

| Zone | Fonctions clés |
|---|---|
| **Helpers & dates** | `toDateStr`, `getMondayOf`→`Week.weekStart`, `displayName`, `buildStaffDisplayNames`, `showConfirm/Prompt` |
| **Navigation & vues** | `setupWeekNav`, `initViewTabs`, `applyViewMode`, `renderWeekLabel`, `renderDateDisplay` |
| **Rendu planning** | `renderWeekGrid`, `renderBody`, `createStaffRow`, `createShiftEl`, `renderTimelineHeader` |
| **Édition shift** | `openMobileShiftEditModal`, `openTransferShiftModal`, `openReplaceStaffModal`, `openRealHoursModal` |
| **Drag & drop** | `initDropZone`, `onSidebarDragStart`, `onMove`, `onTouch*`, `tapSelectStaff` |
| **Copie** | `openCopyModal`, `openCopyWeekModal` |
| **Vues alternatives** | `renderDashboard`, `renderAgenda`, `renderWeekGantt`, `switchToDayView` |
| **Comptes/établissements** | `openAccountsModal`, `openEstablishmentsModal`, `openChangeRoleModal`, `openAssignBarsModal` |
| **Récap & CA** | `openRecapModal`, `showRecapSub`, `loadCongesCalendar`, `renderCongesCalendar`, `exportRecapXlsx`, `openRevenueModal` |
| **Dispos (patron)** | `loadDisposKpi`, `openDisposPanel`, `loadDisposList`, `confirmAllForStaff`, `sendRappelDispos`, `loadNonAffectees` |
| **Congés (patron)** | `loadCongesList`, `renderCongesListPatron`, `decideConge` |
| **Jokers/Swaps** | `loadSwapsBadge`, `openSwapsPanel` |

### `planning.js` — Espace staff (2440 l.)
`init` → `loadPlanning` → `renderDays`. Domaines : **planning perso** (`renderStats`,
`renderDaysInto`, `renderResponsableDashboard`), **disponibilités** (`loadDisposTab`,
`createDispoCard`, `submitDispos`), **congés** (`initCongesForm`, `submitConge`,
`loadCongesTab`), **Jokers ouverts** (`renderOpenJokers`), **push** (`initPushButton`,
`togglePushSubscription`), **notifs staff** (`loadStaffNotifs`), **historique**
(`loadHistoriqueWeek`). Le bloc swaps (`openSwapModal`…) suit F-05 (désactivé côté UI).

### `pointage.js` — Pointage établissement (807 l.)
`init` → `loadShifts` → `buildShiftCard`. Saisie des heures réelles (`parseTimeInput`,
`roundQuarter`, `ecartLabel`), CA du soir (`loadRevenue`, `initRevenueForm`), shifts
extra (`initExtraForm`), bascule du jour (`getActiveDate`/`setActiveDate`, cutoff 9h).

### `performance.js` — Pilotage éco (544 l.)
`init` → `loadData` → `renderKpis` + `renderTable` + `renderDetail`. Coefficient de
masse salariale, saisie CA (`openCAModal`/`saveCAFromModal`), objectifs (`saveTargets`),
calendrier (`loadCalendarWeek`/`renderCalendarGrid`).

### Glue & petits fichiers
- **`index-init.js`** — UI patron : drawer mobile, FAB staff, badge de sync.
- **`sw-register.js`** — enregistrement du Service Worker (partagé index/planning/login).
- **`login.js` / `set-password.js`** — auth.

---

## 9. Code partagé navigateur ↔ Node (`public/lib/`)

`lib/utils.js` ne peut pas être chargé par le navigateur. La logique **front+back**
vit donc dans des **modules UMD** (`window.X` ET `require()`-ables) :

| Module | Expose | Pourquoi |
|---|---|---|
| `public/lib/week.js` | `window.Week.weekStart` / `currentWeekStart` | « Lundi de la semaine » avec **cutoff 6h** : un shift de fermeture (fin à 2h) reste dans « cette semaine » entre lundi 00:00 et 06:00. `WEEK_CUTOFF_HOUR=6` centralisé ici. |
| `public/lib/shift-hours.js` | `window.ShiftHours` | Heures effectives d'un shift (réel vs planifié, gestion nuit). |

> ⚠️ **`weekStart` vs `currentWeekStart`** : `weekStart(date)` = lundi d'une date calendaire
> (mapping shift→semaine, publication, regroupements, **jamais** de cutoff).
> `currentWeekStart(now)` = lundi de la semaine **opérationnelle maintenant** (cutoff 6h).
> Ne pas confondre, c'est la source de bugs subtils.

`lib/utils.js` **ré-exporte** `weekStart`/`currentWeekStart` depuis `week.js` → source unique,
call sites serveur inchangés. C'est le **gabarit** de toute future extraction isomorphe.

---

## 10. PWA / Service Worker

- `sw.js` : **Network-only** pour `/api/*` et `/auth/*` (jamais de cache API), **Cache-First** pour les assets. Cache versionné via `%%BUILD_TIME%%` injecté au `npm start`.
- `sw-register.js` : enregistrement, `skipWaiting` force la MAJ immédiate.
- `vendor/` : libs auto-hébergées (pas de CDN runtime) — `jspdf`+`html2canvas` (PDF), `xlsx` (export Excel récap).

---

## 11. Intégrations externes

| Service | Comment | Fichier |
|---|---|---|
| **Web Push** | VAPID + `web-push`, debounce 60 s (`scheduleShiftNotif`), garde « pas de notif pour shift passé » (B-10) | `server.js` |
| **E-mail** | POST HTTP direct → `api.resend.com/emails` (pas de SDK) | `server.js` |
| **SMS** | POST HTTP direct → API REST Twilio, normalisation `06…`→`+336…` | `server.js` |
| **iCal** | flux `.ics` lecture seule par token (**désactivé**, `CALENDAR_ENABLED`) | `server.js` |
| **Sentry** | initialisé **seulement si** `SENTRY_DSN` défini | `server.js` |

---

## 12. Tests & CI

- **Runner** : `node --test` intégré, **zéro framework**.
- **5 suites** dans `tests/` : `utils` (helpers purs), `shift-hours`, `week`, `routes`
  (intégration HTTP **sans Mongo** — l'app boote sur port éphémère), `conges`.
- **Lancer** : `npm test` (liste **explicite** des fichiers — ⚠️ ne jamais repasser en
  mode répertoire `node --test tests/`, instable selon la version Node).
- **App testable** : `server.js` n'appelle `listen()`/`connectDB()` que sous
  `require.main === module` ; le test force `NODE_ENV=test` + vars factices avant le `require`.
- **CI** : `.github/workflows/ci.yml`, matrice Node 20 + 22 → `npm ci` → syntax check → `npm test`.

**Ajouter un test quand** : on extrait un helper pur, on change une règle de date/heure,
ou on corrige un bug régressable.

---

## 13. Documentation (`docs/`) & conventions

| Fichier | Contenu |
|---|---|
| `architecture.md` | ⭐ Référence technique exhaustive (à lire en premier) |
| `prd.md` | Product Requirements — le « pourquoi » produit |
| `backlog.md` | Décisions (D-xx), features (F-xx), bugs (B-xx) — **mémoire des choix** |
| `ux-design.md` | Choix UX |
| `onboarding.md` | Ce fichier |
| `graphify-out/` | Graphe de connaissances **généré** (ne pas éditer à la main ; `graphify update .` après modif code) |

> 💡 Les codes `D-73`, `F-05`, `B-10` dans les commentaires renvoient à `backlog.md`.

---

## 14. Parcours de prise en main recommandé

1. **Lire `architecture.md`** en entier (≈1 h) — surtout §3 (contraintes), §4 (rôles), §5 (data).
2. **Démarrer en local** (§1) et ouvrir les 4 interfaces (patron / staff / pointage / perf).
3. **Suivre un flux de bout en bout** : le staff envoie ses dispos (`planning.js` →
   `POST /api/dispos`) → le patron les valide et construit le planning (`script.js`) →
   publie la semaine → le staff voit ses shifts → l'établissement pointe les heures
   (`pointage.js`) → le patron lit la Performance (`performance.js`). Ce parcours
   traverse ~80 % de l'architecture.
4. **Intégrer le pattern date/semaine** (`lib/utils.js` + `public/lib/`) — l'origine de
   la majorité des bugs subtils.
5. **Lancer `npm test`** pour voir ce qui est couvert et comment l'app se teste sans Mongo.

---

*Dernière mise à jour : généré le 2026-06-18. Si tu déplaces du code, mets ce guide à jour
(les rôles, les invariants et les pièges §4/§6 sont la partie qui périme le moins vite ;
les n° de ligne, eux, bougent — fie-toi aux noms de fonctions).*
