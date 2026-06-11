# Graph Report - app-planning-bar  (2026-06-11)

## Corpus Check
- 29 files · ~137,728 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 799 nodes · 1318 edges · 56 communities (43 shown, 13 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e794004d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Planning Board UI|Planning Board UI]]
- [[_COMMUNITY_Architecture & Design Rationale|Architecture & Design Rationale]]
- [[_COMMUNITY_html2canvas Render Engine|html2canvas Render Engine]]
- [[_COMMUNITY_html2canvas Parser|html2canvas Parser]]
- [[_COMMUNITY_Main Planning Script (State)|Main Planning Script (State)]]
- [[_COMMUNITY_Express Server & API|Express Server & API]]
- [[_COMMUNITY_Week Data Loading|Week Data Loading]]
- [[_COMMUNITY_NPM Dependencies|NPM Dependencies]]
- [[_COMMUNITY_Time Clock (Pointage)|Time Clock (Pointage)]]
- [[_COMMUNITY_Dispo Control Init|Dispo Control Init]]
- [[_COMMUNITY_Shift CRUD & Rendering|Shift CRUD & Rendering]]
- [[_COMMUNITY_Shared Utils & Validation|Shared Utils & Validation]]
- [[_COMMUNITY_Week View Rendering|Week View Rendering]]
- [[_COMMUNITY_PWA Manifest|PWA Manifest]]
- [[_COMMUNITY_Staff Card Styling|Staff Card Styling]]
- [[_COMMUNITY_Week Calculation Module|Week Calculation Module]]
- [[_COMMUNITY_Shift Hours Module|Shift Hours Module]]
- [[_COMMUNITY_Account Management UI|Account Management UI]]
- [[_COMMUNITY_Patron Creation Script|Patron Creation Script]]
- [[_COMMUNITY_Establishment Management|Establishment Management]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_html2canvas Helpers|html2canvas Helpers]]
- [[_COMMUNITY_html2canvas Color|html2canvas Color]]
- [[_COMMUNITY_Session Management|Session Management]]
- [[_COMMUNITY_Tap Selection|Tap Selection]]
- [[_COMMUNITY_Timeline Rendering|Timeline Rendering]]
- [[_COMMUNITY_Shift Drag Interaction|Shift Drag Interaction]]
- [[_COMMUNITY_Route Tests|Route Tests]]
- [[_COMMUNITY_html2canvas Internals A|html2canvas Internals A]]
- [[_COMMUNITY_html2canvas Internals B|html2canvas Internals B]]
- [[_COMMUNITY_html2canvas SVG Draw|html2canvas SVG Draw]]
- [[_COMMUNITY_html2canvas Internals C|html2canvas Internals C]]
- [[_COMMUNITY_PWA App Icons|PWA App Icons]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_DB Init Script|DB Init Script]]
- [[_COMMUNITY_DB Seed Script|DB Seed Script]]
- [[_COMMUNITY_Push Reminder Scheduler|Push Reminder Scheduler]]
- [[_COMMUNITY_Daily Cron Jobs|Daily Cron Jobs]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Service Worker Cache|Service Worker Cache]]
- [[_COMMUNITY_html2canvas Internals F|html2canvas Internals F]]
- [[_COMMUNITY_Healthcheck Endpoint|Healthcheck Endpoint]]
- [[_COMMUNITY_Helmet Security Headers|Helmet Security Headers]]
- [[_COMMUNITY_Build-less Frontend|Build-less Frontend]]
- [[_COMMUNITY_In-Memory Rate Limiter|In-Memory Rate Limiter]]
- [[_COMMUNITY_Resend Email API|Resend Email API]]
- [[_COMMUNITY_Sentry Observability|Sentry Observability]]
- [[_COMMUNITY_Twilio SMS API|Twilio SMS API]]
- [[_COMMUNITY_Privacy Policy (RGPD)|Privacy Policy (RGPD)]]
- [[_COMMUNITY_Monthly Patron Recap|Monthly Patron Recap]]

## God Nodes (most connected - your core abstractions)
1. `_()` - 36 edges
2. `m()` - 31 edges
3. `addDays()` - 25 edges
4. `toDateStr()` - 24 edges
5. `init()` - 20 edges
6. `3. Fonctionnalités principales` - 20 edges
7. `showToast()` - 19 edges
8. `make_xlsx_lib()` - 17 edges
9. `Architecture technique — Templyo` - 17 edges
10. `loadDayDetail()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Pièges blocs /* F-05 DÉSACTIVÉ */ (D-47)` --references--> `server.js (serveur Express monolithique)`  [EXTRACTED]
  docs/backlog.md → README.md
- `Disponibilités staff & patron` --implements--> `planning.html (interface staff)`  [INFERRED]
  docs/prd.md → public/planning.html
- `Performance — pilotage économique` --implements--> `performance.html (pilotage économique)`  [INFERRED]
  docs/prd.md → public/performance.html
- `Onglet Mon équipe (responsable)` --implements--> `planning.html (interface staff)`  [INFERRED]
  docs/prd.md → public/planning.html
- `Audit ergonomie tactile mobile (D-49)` --references--> `pointage.html (compte établissement)`  [EXTRACTED]
  docs/ux-design.md → public/pointage.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Modules UMD partagés navigateur/Node testés** — architecture_umd_module, architecture_week_module, architecture_shift_hours_module, readme_lib_utils [EXTRACTED 0.90]
- **Sûreté timezone via toDateStr** — architecture_timezone_rule, architecture_todatestr, architecture_push_past_shift_guard [EXTRACTED 0.85]
- **Cycle de vie feature iCal (livrée puis désactivée)** — backlog_f09_ical, architecture_ical_feed, architecture_calendar_enabled_flag [EXTRACTED 0.90]

## Communities (56 total, 13 thin omitted)

### Community 0 - "Planning Board UI"
Cohesion: 0.05
Nodes (64): addDays(), allEstablishments, allStaff, applyCongeModes(), applyStatsPeriod(), buildHistStatsHtml(), buildTeamDisplayNames(), cancelConge() (+56 more)

### Community 1 - "Architecture & Design Rationale"
Cohesion: 0.20
Nodes (12): hourly_rate_snapshot / fixed_rate_snapshot, Modèle de données shifts, Modes de rémunération staff (Mutual exclusion Option A), F-06 Joker ouvert au staff (candidatures), Nom staff dénormalisé (source de vérité D-77), pointage.html (compte établissement), Disponibilités staff & patron, Shifts Joker (créneau ouvert) (+4 more)

### Community 2 - "html2canvas Render Engine"
Cohesion: 0.04
Nodes (17): an(), Be(), cn(), Cs(), E(), fn(), gs(), I() (+9 more)

### Community 3 - "html2canvas Parser"
Cohesion: 0.13
Nodes (36): Ae(), mr(), QB(), re(), se(), SUPPORT_WORD_BREAKING(), w(), _() (+28 more)

### Community 4 - "Main Planning Script (State)"
Cohesion: 0.03
Nodes (51): allEstablishments, allGroups, allRoles, allStaff, AUTO_COLORS, buildEstablishmentSelect(), clearTapSelection(), confirmAllForStaff() (+43 more)

### Community 5 - "Express Server & API"
Cohesion: 0.05
Nodes (21): app, bcrypt, cleanupOldJokers(), client, connectDB(), cors, crypto, dispoOpenVenues() (+13 more)

### Community 6 - "Week Data Loading"
Cohesion: 0.12
Nodes (33): addDays(), exportWeekCSV(), formatDateShort(), generatePrintGantt(), getMondayOf(), isToday(), loadDisposList(), loadModifyTab() (+25 more)

### Community 7 - "NPM Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, bcryptjs, cors, dotenv, express, express-session, helmet, mongodb (+16 more)

### Community 8 - "Time Clock (Pointage)"
Cohesion: 0.14
Nodes (20): allStaff, buildShiftCard(), checkAuth(), fmtH(), getActiveDate(), init(), initExtraForm(), initRevenueForm() (+12 more)

### Community 9 - "Dispo Control Init"
Cohesion: 0.11
Nodes (21): acknowledgeOffDispo(), buildStaffDisplayNames(), checkAuth(), decideConge(), init(), initDropZone(), initNotifListeners(), initStaffSearch() (+13 more)

### Community 10 - "Shift CRUD & Rendering"
Cohesion: 0.26
Nodes (15): assignStaffToJoker(), createShift(), deleteShift(), exportRecapXlsx(), _ignoreNonAffectee(), _nonAffecteesAfterRemove(), onUp(), _recreateShiftFromDispo() (+7 more)

### Community 11 - "Shared Utils & Validation"
Cohesion: 0.15
Nodes (19): chargeMultiplier(), computeActiveDate(), congeCoversDate(), congeDaysInRange(), crypto, datesOverlap(), hashToken(), isAutoPublished() (+11 more)

### Community 12 - "Week View Rendering"
Cohesion: 0.11
Nodes (21): applyVenueHours(), applyViewMode(), buildDisplayedStaff(), buildRoleFilters(), extendDisplayForRealHours(), formatDateLong(), _kpiProgressBar(), loadDayDetail() (+13 more)

### Community 13 - "PWA Manifest"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, short_name, shortcuts (+2 more)

### Community 14 - "Staff Card Styling"
Cohesion: 0.21
Nodes (13): applyCardNameContrast(), _buildCongeRow(), createShiftEl(), createStaffRow(), displayName(), escapeHtml(), _fmtCongeDateFr(), openNotifPanel() (+5 more)

### Community 15 - "Week Calculation Module"
Cohesion: 0.31
Nodes (6): disposWeekStart(), currentWeekStart(), weekStart(), assert, { test }, { weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }

### Community 16 - "Shift Hours Module"
Cohesion: 0.33
Nodes (8): fmtClock(), fmtDurationH(), fmtHourOfDay(), shiftDurationHours(), shiftEffectiveHours(), assert, { shiftEffectiveHours, shiftDurationHours, fmtHourOfDay, fmtClock, fmtDurationH }, { test }

### Community 17 - "Account Management UI"
Cohesion: 0.38
Nodes (7): openAccountsModal(), populateBarsCheckboxes(), populateStaffSelect(), renderAccountsList(), renderPendingInvites(), switchAccountsTab(), _updatePendingBadge()

### Community 18 - "Patron Creation Script"
Cohesion: 0.33
Nodes (6): ask(), bcrypt, main(), { MongoClient }, readline, rl

### Community 19 - "Establishment Management"
Cohesion: 0.33
Nodes (6): addEstablishment(), loadGroups(), openEstablishmentsModal(), renderEstablishmentsList(), renderGroupFilter(), renderTabs()

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (8): Garde B-10 — pas de push pour shift passé, Service Worker / PWA (Cache First, BUILD_TIME), Règle timezone — jamais toISOString(), toDateStr() helper, Architecture Web Push (VAPID), index.html (interface patron/directeur), lib/utils.js (helpers purs), script.js (logique patron monolithique)

### Community 21 - "html2canvas Helpers"
Cohesion: 0.40
Nodes (5): dA(), FA(), hA(), lA(), UA()

### Community 22 - "html2canvas Color"
Cohesion: 0.18
Nodes (11): ee(), fe(), He(), ie(), KB(), ne(), oe(), te() (+3 more)

### Community 23 - "Session Management"
Cohesion: 0.50
Nodes (4): CustomMongoStore (sessions promesses), SESSION_SECRET obligatoire en production, Session TTL 30 jours glissant (rolling/touch), Trust proxy en production (Railway)

### Community 24 - "Tap Selection"
Cohesion: 0.14
Nodes (13): 10. Déploiement (Railway), 11. Headers de sécurité (helmet), 12. Observabilité, 13. Tests & CI, 1. Stack, 2. Structure du projet, 6. Architecture Web Push, 7. PWA / Service Worker (+5 more)

### Community 25 - "Timeline Rendering"
Cohesion: 0.05
Nodes (41): Hiérarchie des rôles & middlewares auth, R-04 Découpage server.js en routers (reporté), GitHub Actions CI Workflow, Node 20/22 Test Matrix, CI Syntax Check (node -c), Auth, Authentification, Cache Service Worker — ne pas toucher `%%BUILD_TIME%%` (+33 more)

### Community 26 - "Shift Drag Interaction"
Cohesion: 0.06
Nodes (32): 1. Objet, 2. Utilisateurs & Rôles, 3.10 Publication, 3.11 Vue Staff (`planning.html`), 3.12 PWA, 3.13 Transfert de shift cross-établissement, 3.14 Recherche insensible aux accents, 3.15 SMS (Twilio) (+24 more)

### Community 27 - "Route Tests"
Cohesion: 0.50
Nodes (3): app, assert, { test, before, after }

### Community 28 - "html2canvas Internals A"
Cohesion: 0.14
Nodes (14): Flag CALENDAR_ENABLED (iCal désactivé D-83), Synchronisation agenda — flux iCal (D-72), Pièges blocs /* F-05 DÉSACTIVÉ */ (D-47), F-05 Échange de shifts (désactivé), F-09 Abonnement agenda iCal, Backlog — Templyo, Déjà livré / non prioritaire, Fait (+6 more)

### Community 30 - "html2canvas SVG Draw"
Cohesion: 0.50
Nodes (4): gr(), Lr(), pr(), SUPPORT_FOREIGNOBJECT_DRAWING()

### Community 31 - "html2canvas Internals C"
Cohesion: 0.11
Nodes (17): 1. Design System existant, 2.1 login.html, 2.2 set-password.html, 2.3 index.html (Patron / Directeur), 2.4 planning.html (Staff), 2.5 pointage.html, 2.6 performance.html (Patron / Directeur — pilotage économique), 2.7 politique-confidentialite.html (+9 more)

### Community 32 - "PWA App Icons"
Cohesion: 1.00
Nodes (3): App Icon 192px (White T on Purple), App Icon 512px (White T on Purple), App Icon 72px (White T on Purple)

### Community 33 - "Community 33"
Cohesion: 0.17
Nodes (22): allEstabs, checkAuth(), currentData, dateLabel(), escapeHtml(), fmtEUR(), fmtHours(), fmtPct() (+14 more)

### Community 36 - "Push Reminder Scheduler"
Cohesion: 0.67
Nodes (3): checkDispoRappels(), computeEffectiveDeadline(), sendPushToStaff()

### Community 37 - "Daily Cron Jobs"
Cohesion: 0.28
Nodes (9): public/lib/shift-hours.js (heures effectives), Module UMD partagé navigateur/Node, WEEK_CUTOFF_HOUR = 6 (cutoff semaine en cours), public/lib/week.js (weekStart/currentWeekStart), Refacto incrémentale (modèle D-73), performance.html (pilotage économique), planning.html (interface staff), Onglet Mon équipe (responsable) (+1 more)

### Community 38 - "Community 38"
Cohesion: 0.40
Nodes (5): loadCongesList(), loadStaffNotesList(), normalizeStr(), renderCongesListPatron(), renderStaffNotesList()

### Community 39 - "Community 39"
Cohesion: 0.20
Nodes (10): 3.1 Fuseau horaire — NE JAMAIS utiliser `toISOString()`, 3.2 Sessions MongoDB — promesses uniquement, 3.3 `script.js` — monolithique, ne pas découper, 3.4 Frontend — aucun outillage de build, 3.5 API / auth contournent toujours le cache du Service Worker, 3.6 Les helpers purs vivent dans `lib/utils.js`, 3.7 En production `SESSION_SECRET` est obligatoire, 3.8 Trust proxy en production (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.22
Nodes (9): 5. Modèle de données (collections clés), `daily_revenue`, `notifications`, `push_subscriptions`, `settings` — documents clés, `shift_swaps` *(feature F-05 — code livré mais désactivée en attente validation client)*, `shifts`, `staff` — champs de rémunération (+1 more)

### Community 41 - "Community 41"
Cohesion: 0.39
Nodes (7): closeMobileDrawer(), _closeStaffBar(), openDispoSettingsMobile(), openMobileDrawer(), _openStaffBar(), syncDrawerDispoToggle(), toggleStaffBar()

### Community 42 - "Community 42"
Cohesion: 0.40
Nodes (5): 14. Synchronisation agenda — flux iCal (D-72), Génération du `.ics`, Limites connues (documentées pour le support), Principe, Routes

### Community 43 - "Community 43"
Cohesion: 0.50
Nodes (4): 4. Authentification & autorisation, Hiérarchie des rôles, Limitation du débit, Session

### Community 46 - "html2canvas Internals F"
Cohesion: 0.18
Nodes (11): A(), CA(), fr(), Hn(), Xt(), C(), Dt(), n() (+3 more)

## Knowledge Gaps
- **239 isolated node(s):** `crypto`, `{ weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }`, `name`, `version`, `description` (+234 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Architecture technique — Templyo` connect `Tap Selection` to `Architecture & Design Rationale`, `Community 39`, `Community 40`, `Community 42`, `Community 43`, `Community 20`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `fmtH()` connect `Time Clock (Pointage)` to `Shift CRUD & Rendering`, `Week View Rendering`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `server.js (serveur Express monolithique)` connect `Timeline Rendering` to `html2canvas Internals A`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `m()` (e.g. with `Ee()` and `Ae()`) actually correct?**
  _`m()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `crypto`, `{ weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }`, `name` to the rest of the system?**
  _244 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Planning Board UI` be split into smaller, more focused modules?**
  _Cohesion score 0.0532724505327245 - nodes in this community are weakly interconnected._
- **Should `html2canvas Render Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.04011299435028248 - nodes in this community are weakly interconnected._