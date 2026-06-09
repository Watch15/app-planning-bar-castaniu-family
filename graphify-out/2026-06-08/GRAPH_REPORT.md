# Graph Report - app-planning-bar  (2026-06-08)

## Corpus Check
- 25 files · ~128,596 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 717 nodes · 1150 edges · 51 communities (39 shown, 12 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4eabed21`
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
- [[_COMMUNITY_Staff Notes Sidebar|Staff Notes Sidebar]]
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
- [[_COMMUNITY_Dispo Confirmation|Dispo Confirmation]]
- [[_COMMUNITY_DB Init Script|DB Init Script]]
- [[_COMMUNITY_DB Seed Script|DB Seed Script]]
- [[_COMMUNITY_Push Reminder Scheduler|Push Reminder Scheduler]]
- [[_COMMUNITY_Daily Cron Jobs|Daily Cron Jobs]]
- [[_COMMUNITY_html2canvas Internals D|html2canvas Internals D]]
- [[_COMMUNITY_html2canvas Internals E|html2canvas Internals E]]
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
3. `addDays()` - 23 edges
4. `toDateStr()` - 21 edges
5. `3. Fonctionnalités principales` - 19 edges
6. `init()` - 18 edges
7. `make_xlsx_lib()` - 17 edges
8. `Architecture technique — Templyo` - 17 edges
9. `showToast()` - 16 edges
10. `Templyo` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Pièges blocs /* F-05 DÉSACTIVÉ */ (D-47)` --references--> `server.js (serveur Express monolithique)`  [EXTRACTED]
  docs/backlog.md → README.md
- `Disponibilités staff & patron` --implements--> `planning.html (interface staff)`  [INFERRED]
  docs/prd.md → public/planning.html
- `Onglet Mon équipe (responsable)` --implements--> `planning.html (interface staff)`  [INFERRED]
  docs/prd.md → public/planning.html
- `isAutoPublished()` --calls--> `weekStart()`  [EXTRACTED]
  lib/utils.js → public/lib/week.js
- `isDatePublished()` --calls--> `weekStart()`  [EXTRACTED]
  lib/utils.js → public/lib/week.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Modules UMD partagés navigateur/Node testés** — architecture_umd_module, architecture_week_module, architecture_shift_hours_module, readme_lib_utils [EXTRACTED 0.90]
- **Sûreté timezone via toDateStr** — architecture_timezone_rule, architecture_todatestr, architecture_push_past_shift_guard [EXTRACTED 0.85]
- **Cycle de vie feature iCal (livrée puis désactivée)** — backlog_f09_ical, architecture_ical_feed, architecture_calendar_enabled_flag [EXTRACTED 0.90]

## Communities (51 total, 12 thin omitted)

### Community 0 - "Planning Board UI"
Cohesion: 0.06
Nodes (51): addDays(), allEstablishments, allStaff, applyStatsPeriod(), buildHistStatsHtml(), buildTeamDisplayNames(), checkAuth(), createDispoCard() (+43 more)

### Community 1 - "Architecture & Design Rationale"
Cohesion: 0.18
Nodes (14): hourly_rate_snapshot / fixed_rate_snapshot, Modèle de données shifts, Modes de rémunération staff (Mutual exclusion Option A), F-06 Joker ouvert au staff (candidatures), Nom staff dénormalisé (source de vérité D-77), performance.html (pilotage économique), pointage.html (compte établissement), Disponibilités staff & patron (+6 more)

### Community 2 - "html2canvas Render Engine"
Cohesion: 0.04
Nodes (17): an(), Be(), cn(), Cs(), E(), fn(), gs(), I() (+9 more)

### Community 3 - "html2canvas Parser"
Cohesion: 0.13
Nodes (36): Ae(), mr(), QB(), re(), se(), SUPPORT_WORD_BREAKING(), w(), _() (+28 more)

### Community 4 - "Main Planning Script (State)"
Cohesion: 0.04
Nodes (45): allEstablishments, allGroups, allRoles, allStaff, AUTO_COLORS, buildEstablishmentSelect(), clearTapSelection(), confirmAllForStaff() (+37 more)

### Community 5 - "Express Server & API"
Cohesion: 0.05
Nodes (16): app, bcrypt, client, cors, crypto, express, helmet, ICS_VTIMEZONE (+8 more)

### Community 6 - "Week Data Loading"
Cohesion: 0.14
Nodes (31): addDays(), exportWeekCSV(), formatDateShort(), getMondayOf(), isToday(), loadDisposList(), loadModifyTab(), loadNonAffectees() (+23 more)

### Community 7 - "NPM Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, bcryptjs, cors, dotenv, express, express-session, helmet, mongodb (+16 more)

### Community 8 - "Time Clock (Pointage)"
Cohesion: 0.14
Nodes (20): allStaff, buildShiftCard(), checkAuth(), fmtH(), getActiveDate(), init(), initExtraForm(), initRevenueForm() (+12 more)

### Community 9 - "Dispo Control Init"
Cohesion: 0.12
Nodes (19): acknowledgeOffDispo(), buildStaffDisplayNames(), checkAuth(), init(), initDropZone(), initNotifListeners(), initStaffSearch(), initTimelineBodyTap() (+11 more)

### Community 10 - "Shift CRUD & Rendering"
Cohesion: 0.23
Nodes (16): assignStaffToJoker(), createShift(), deleteShift(), exportRecapXlsx(), generatePrintGantt(), _ignoreNonAffectee(), _nonAffecteesAfterRemove(), onUp() (+8 more)

### Community 11 - "Shared Utils & Validation"
Cohesion: 0.23
Nodes (13): chargeMultiplier(), computeActiveDate(), crypto, hashToken(), isAutoPublished(), isDatePublished(), isValidObjectId(), normalizePhone() (+5 more)

### Community 12 - "Week View Rendering"
Cohesion: 0.19
Nodes (13): applyVenueHours(), applyViewMode(), buildDisplayedStaff(), extendDisplayForRealHours(), formatDateLong(), loadDayDetail(), loadEstablishments(), parseDate() (+5 more)

### Community 13 - "PWA Manifest"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, short_name, shortcuts (+2 more)

### Community 14 - "Staff Card Styling"
Cohesion: 0.25
Nodes (11): applyCardNameContrast(), createShiftEl(), createStaffRow(), displayName(), escapeHtml(), openNotifPanel(), openReplaceStaffModal(), openTransferShiftModal() (+3 more)

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

### Community 20 - "Staff Notes Sidebar"
Cohesion: 0.40
Nodes (5): buildRoleFilters(), loadStaffNotesList(), normalizeStr(), renderSidebar(), renderStaffNotesList()

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
Cohesion: 0.05
Nodes (41): 10. Déploiement (Railway), 11. Headers de sécurité (helmet), 12. Observabilité, 13. Tests & CI, 14. Synchronisation agenda — flux iCal (D-72), 1. Stack, 2. Structure du projet, 3.1 Fuseau horaire — NE JAMAIS utiliser `toISOString()` (+33 more)

### Community 25 - "Timeline Rendering"
Cohesion: 0.05
Nodes (38): Hiérarchie des rôles & middlewares auth, R-04 Découpage server.js en routers (reporté), Auth, Authentification, Cache Service Worker — ne pas toucher `%%BUILD_TIME%%`, Collections MongoDB, Commandes, Comptes & Staff (+30 more)

### Community 26 - "Shift Drag Interaction"
Cohesion: 0.06
Nodes (31): 1. Objet, 2. Utilisateurs & Rôles, 3.10 Publication, 3.11 Vue Staff (`planning.html`), 3.12 PWA, 3.13 Transfert de shift cross-établissement, 3.14 Recherche insensible aux accents, 3.15 SMS (Twilio) (+23 more)

### Community 27 - "Route Tests"
Cohesion: 0.50
Nodes (3): app, assert, { test, before, after }

### Community 28 - "html2canvas Internals A"
Cohesion: 0.17
Nodes (11): Pièges blocs /* F-05 DÉSACTIVÉ */ (D-47), F-05 Échange de shifts (désactivé), Backlog — Templyo, Déjà livré / non prioritaire, Fait, Notes pour les agents, P1 — Bugs bloquants (à faire en premier), P2 — Améliorations (après les P1) (+3 more)

### Community 29 - "html2canvas Internals B"
Cohesion: 0.20
Nodes (11): Garde B-10 — pas de push pour shift passé, Service Worker / PWA (Cache First, BUILD_TIME), Règle timezone — jamais toISOString(), toDateStr() helper, Architecture Web Push (VAPID), GitHub Actions CI Workflow, Node 20/22 Test Matrix, CI Syntax Check (node -c) (+3 more)

### Community 30 - "html2canvas SVG Draw"
Cohesion: 0.50
Nodes (4): gr(), Lr(), pr(), SUPPORT_FOREIGNOBJECT_DRAWING()

### Community 31 - "html2canvas Internals C"
Cohesion: 0.20
Nodes (9): 1. Design System existant, 3. Priorités recommandées, 4. Palette — tokens à ajouter (non prioritaire), 5. Flux utilisateur — frictions identifiées, Tokens couleurs (style.css), Typographie, UX Design — Templyo, login.html (page de connexion) (+1 more)

### Community 32 - "PWA App Icons"
Cohesion: 1.00
Nodes (3): App Icon 192px (White T on Purple), App Icon 512px (White T on Purple), App Icon 72px (White T on Purple)

### Community 33 - "Dispo Confirmation"
Cohesion: 0.25
Nodes (8): 2.1 login.html, 2.2 set-password.html, 2.3 index.html (Patron / Directeur), 2.4 planning.html (Staff), 2.5 pointage.html, 2.6 performance.html (Patron / Directeur — pilotage économique), 2.7 politique-confidentialite.html, 2. Audit page par page

### Community 36 - "Push Reminder Scheduler"
Cohesion: 0.67
Nodes (3): checkDispoRappels(), computeEffectiveDeadline(), sendPushToStaff()

### Community 37 - "Daily Cron Jobs"
Cohesion: 0.67
Nodes (3): cleanupOldJokers(), connectDB(), scheduleDailyAt10()

### Community 38 - "html2canvas Internals D"
Cohesion: 0.40
Nodes (6): public/lib/shift-hours.js (heures effectives), Module UMD partagé navigateur/Node, public/lib/week.js (weekStart/currentWeekStart), Refacto incrémentale (modèle D-73), planning.html (interface staff), Onglet Mon équipe (responsable)

### Community 39 - "html2canvas Internals E"
Cohesion: 0.67
Nodes (4): Flag CALENDAR_ENABLED (iCal désactivé D-83), Synchronisation agenda — flux iCal (D-72), WEEK_CUTOFF_HOUR = 6 (cutoff semaine en cours), F-09 Abonnement agenda iCal

### Community 46 - "html2canvas Internals F"
Cohesion: 0.18
Nodes (11): A(), CA(), fr(), Hn(), Xt(), C(), Dt(), n() (+3 more)

## Knowledge Gaps
- **225 isolated node(s):** `crypto`, `{ weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }`, `name`, `version`, `description` (+220 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Architecture technique — Templyo` connect `Tap Selection` to `Architecture & Design Rationale`, `html2canvas Internals B`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `server.js (serveur Express monolithique)` connect `Timeline Rendering` to `html2canvas Internals A`, `html2canvas Internals B`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `CI Syntax Check (node -c)` connect `html2canvas Internals B` to `Timeline Rendering`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `m()` (e.g. with `Ee()` and `Ae()`) actually correct?**
  _`m()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `crypto`, `{ weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }`, `name` to the rest of the system?**
  _230 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Planning Board UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06428988895382817 - nodes in this community are weakly interconnected._
- **Should `html2canvas Render Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.04011299435028248 - nodes in this community are weakly interconnected._