# Graph Report - app-planning-bar  (2026-06-28)

## Corpus Check
- 35 files · ~149,188 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 917 nodes · 1496 edges · 62 communities (50 shown, 12 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `db28bf49`
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
- [[_COMMUNITY_Community 12|Community 12]]
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
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Healthcheck Endpoint|Healthcheck Endpoint]]
- [[_COMMUNITY_Helmet Security Headers|Helmet Security Headers]]
- [[_COMMUNITY_Build-less Frontend|Build-less Frontend]]
- [[_COMMUNITY_In-Memory Rate Limiter|In-Memory Rate Limiter]]
- [[_COMMUNITY_Resend Email API|Resend Email API]]
- [[_COMMUNITY_Sentry Observability|Sentry Observability]]
- [[_COMMUNITY_Twilio SMS API|Twilio SMS API]]
- [[_COMMUNITY_Privacy Policy (RGPD)|Privacy Policy (RGPD)]]
- [[_COMMUNITY_Monthly Patron Recap|Monthly Patron Recap]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]

## God Nodes (most connected - your core abstractions)
1. `_()` - 36 edges
2. `m()` - 31 edges
3. `addDays()` - 27 edges
4. `toDateStr()` - 26 edges
5. `showToast()` - 23 edges
6. `init()` - 20 edges
7. `3. Fonctionnalités principales` - 20 edges
8. `loadDayDetail()` - 18 edges
9. `make_xlsx_lib()` - 17 edges
10. `Architecture technique — Templyo` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Disponibilités staff & patron` --implements--> `planning.html (interface staff)`  [INFERRED]
  docs/prd.md → public/planning.html
- `Onglet Mon équipe (responsable)` --implements--> `planning.html (interface staff)`  [INFERRED]
  docs/prd.md → public/planning.html
- `disposWeekStart()` --calls--> `weekStart()`  [EXTRACTED]
  lib/utils.js → public/lib/week.js
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

## Communities (62 total, 12 thin omitted)

### Community 0 - "Planning Board UI"
Cohesion: 0.05
Nodes (64): addDays(), allEstablishments, allStaff, applyCongeModes(), applyStatsPeriod(), buildHistStatsHtml(), buildTeamDisplayNames(), cancelConge() (+56 more)

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
Cohesion: 0.03
Nodes (67): allEstablishments, allGroups, allRoles, allStaff, AUTO_COLORS, _autoScroll, _autoScrollTick(), _btnCopyWeek (+59 more)

### Community 5 - "Express Server & API"
Cohesion: 0.04
Nodes (21): app, bcrypt, cleanupOldJokers(), client, connectDB(), cors, crypto, dispoOpenVenues() (+13 more)

### Community 6 - "Week Data Loading"
Cohesion: 0.09
Nodes (44): addDays(), applyVenueHours(), exportWeekCSV(), generatePrintGantt(), getMondayOf(), isToday(), loadCongesList(), loadDisposKpi() (+36 more)

### Community 7 - "NPM Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, bcryptjs, cors, dotenv, express, express-session, helmet, mongodb (+21 more)

### Community 8 - "Time Clock (Pointage)"
Cohesion: 0.16
Nodes (18): allStaff, buildShiftCard(), checkAuth(), fmtH(), getActiveDate(), init(), initExtraForm(), initRevenueForm() (+10 more)

### Community 9 - "Dispo Control Init"
Cohesion: 0.10
Nodes (23): acknowledgeOffDispo(), buildRoleFilters(), buildStaffDisplayNames(), checkAuth(), decideConge(), init(), initDropZone(), initNotifListeners() (+15 more)

### Community 10 - "Shift CRUD & Rendering"
Cohesion: 0.20
Nodes (10): Auth, Comptes & Staff, Disponibilités, Infra, Performance / CA, Routes API principales, Shifts & Pointage, Web Push & Notifications (+2 more)

### Community 11 - "Shared Utils & Validation"
Cohesion: 0.17
Nodes (18): chargeMultiplier(), computeActiveDate(), crypto, disposWeekStart(), hashToken(), isAutoPublished(), isDatePublished(), isFullRangeOnConge() (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.20
Nodes (11): Garde B-10 — pas de push pour shift passé, Service Worker / PWA (Cache First, BUILD_TIME), Règle timezone — jamais toISOString(), toDateStr() helper, Architecture Web Push (VAPID), GitHub Actions CI Workflow, Node 20/22 Test Matrix, CI Syntax Check (node -c) (+3 more)

### Community 13 - "PWA Manifest"
Cohesion: 0.18
Nodes (10): background_color, description, display, icons, name, orientation, short_name, shortcuts (+2 more)

### Community 14 - "Staff Card Styling"
Cohesion: 0.17
Nodes (16): applyCardNameContrast(), _buildCongeRow(), createShiftEl(), createStaffRow(), displayName(), escapeHtml(), _fmtCongeDateFr(), _kpiEstabRow() (+8 more)

### Community 15 - "Week Calculation Module"
Cohesion: 0.36
Nodes (5): currentWeekStart(), weekStart(), assert, { test }, { weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }

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
Cohesion: 0.11
Nodes (18): 1. Notre méthode de travail : c'est de l'agile *léger*, pas du Scrum, 2. CI/CD : on a une vraie CI + un CD découplé (donc *pas* un pipeline CI/CD intégré), 3. Axes d'amélioration — priorisés, 4. Résumé exécutif, Ce qui est sain, Ce qui manque pour « mûrir » la méthode, Comment ça se traduit concrètement, Côté méthode (process) (+10 more)

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (9): 1. Design System existant, 3. Priorités recommandées, 4. Palette — tokens à ajouter (non prioritaire), 5. Flux utilisateur — frictions identifiées, Tokens couleurs (style.css), Typographie, UX Design — Templyo, login.html (page de connexion) (+1 more)

### Community 21 - "html2canvas Helpers"
Cohesion: 0.57
Nodes (7): hideError(), loginEmail(), loginPhone(), redirectByRole(), setLoading(), showError(), switchMode()

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
Cohesion: 0.15
Nodes (12): Hiérarchie des rôles & middlewares auth, Collections MongoDB, Commandes, Installation, Rôles utilisateurs (patron/directeur/staff/etablissement), Rôles utilisateurs, Stack technique Templyo, Stack technique (+4 more)

### Community 26 - "Shift Drag Interaction"
Cohesion: 0.06
Nodes (32): 1. Objet, 2. Utilisateurs & Rôles, 3.10 Publication, 3.11 Vue Staff (`planning.html`), 3.12 PWA, 3.13 Transfert de shift cross-établissement, 3.14 Recherche insensible aux accents, 3.15 SMS (Twilio) (+24 more)

### Community 27 - "Route Tests"
Cohesion: 0.50
Nodes (3): app, assert, { test, before, after }

### Community 28 - "html2canvas Internals A"
Cohesion: 0.20
Nodes (9): Backlog — Templyo, Déjà livré / non prioritaire, Fait, Notes pour les agents, P1 — Bugs bloquants (à faire en premier), P2 — Améliorations (après les P1), P2 — Audit ergonomie restant (mai 2026), P3 — Nouvelles fonctionnalités (roadmap) (+1 more)

### Community 29 - "html2canvas Internals B"
Cohesion: 0.29
Nodes (6): congeCoversDate(), congeDaysInRange(), datesOverlap(), assert, { datesOverlap, congeCoversDate, congeDaysInRange }, { test }

### Community 30 - "html2canvas SVG Draw"
Cohesion: 0.50
Nodes (4): gr(), Lr(), pr(), SUPPORT_FOREIGNOBJECT_DRAWING()

### Community 31 - "html2canvas Internals C"
Cohesion: 0.25
Nodes (8): Authentification, Fonctionnalités, Performance (`performance.html`), Pointage (`pointage.html`), PWA, Vue patron (`index.html`), Vue staff (`planning.html`), Web Push

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
Cohesion: 0.50
Nodes (3): globals, js, sharedRules

### Community 38 - "Community 38"
Cohesion: 0.16
Nodes (27): applyShiftAssignment(), assignStaffToJoker(), buildDisplayedStaff(), createShift(), deleteShift(), dispoHoursFor(), exportRecapXlsx(), extendDisplayForRealHours() (+19 more)

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (6): Cache Service Worker — ne pas toucher `%%BUILD_TIME%%`, Helpers purs → `lib/utils.js`, Règles techniques à ne jamais casser, `script.js` — monolithique, ne pas découper, Sessions MongoDB — promesses uniquement, Timezone — jamais `toISOString()`

### Community 40 - "Community 40"
Cohesion: 0.06
Nodes (35): 0. En une phrase, 10. PWA / Service Worker, 11. Intégrations externes, 12. Tests & CI, 13. Documentation (`docs/`) & conventions, 14. Parcours de prise en main recommandé, 1. Démarrer en local (5 minutes), 2. Les 6 règles d'or (à ne JAMAIS enfreindre) (+27 more)

### Community 41 - "Community 41"
Cohesion: 0.39
Nodes (7): closeMobileDrawer(), _closeStaffBar(), openDispoSettingsMobile(), openMobileDrawer(), _openStaffBar(), syncDrawerDispoToggle(), toggleStaffBar()

### Community 42 - "Community 42"
Cohesion: 0.14
Nodes (15): eq(), isObjId(), isOperator(), makeCollection(), makeDb(), matchField(), plainEq(), splitDisposByConges() (+7 more)

### Community 43 - "Community 43"
Cohesion: 0.50
Nodes (4): Pièges blocs /* F-05 DÉSACTIVÉ */ (D-47), F-05 Échange de shifts (désactivé), R-04 Découpage server.js en routers (reporté), server.js (serveur Express monolithique)

### Community 46 - "html2canvas Internals F"
Cohesion: 0.18
Nodes (11): A(), CA(), fr(), Hn(), Xt(), C(), Dt(), n() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (8): 2.1 login.html, 2.2 set-password.html, 2.3 index.html (Patron / Directeur), 2.4 planning.html (Staff), 2.5 pointage.html, 2.6 performance.html (Patron / Directeur — pilotage économique), 2.7 politique-confidentialite.html, 2. Audit page par page

### Community 57 - "Community 57"
Cohesion: 0.33
Nodes (6): addEstablishment(), loadGroups(), openEstablishmentsModal(), renderEstablishmentsList(), renderGroupFilter(), renderTabs()

### Community 58 - "Community 58"
Cohesion: 0.33
Nodes (7): public/lib/shift-hours.js (heures effectives), Module UMD partagé navigateur/Node, WEEK_CUTOFF_HOUR = 6 (cutoff semaine en cours), public/lib/week.js (weekStart/currentWeekStart), Refacto incrémentale (modèle D-73), planning.html (interface staff), Onglet Mon équipe (responsable)

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (6): applyViewMode(), renderDashboard(), renderWeekFull(), renderWeekGantt(), staffMatchesCurrentGroup(), switchToDayView()

### Community 60 - "Community 60"
Cohesion: 0.40
Nodes (5): dA(), FA(), hA(), lA(), UA()

### Community 61 - "Community 61"
Cohesion: 1.00
Nodes (3): Flag CALENDAR_ENABLED (iCal désactivé D-83), Synchronisation agenda — flux iCal (D-72), F-09 Abonnement agenda iCal

## Knowledge Gaps
- **300 isolated node(s):** `js`, `globals`, `sharedRules`, `crypto`, `{ weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }` (+295 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Architecture technique — Templyo` connect `Tap Selection` to `Architecture & Design Rationale`, `Community 12`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `fmtH()` connect `Time Clock (Pointage)` to `Community 59`, `Main Planning Script (State)`, `Community 38`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `server.js (serveur Express monolithique)` connect `Community 43` to `Timeline Rendering`, `Shift CRUD & Rendering`, `Community 12`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `m()` (e.g. with `Ee()` and `Ae()`) actually correct?**
  _`m()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `js`, `globals`, `sharedRules` to the rest of the system?**
  _305 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Planning Board UI` be split into smaller, more focused modules?**
  _Cohesion score 0.0532724505327245 - nodes in this community are weakly interconnected._
- **Should `html2canvas Render Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.04011299435028248 - nodes in this community are weakly interconnected._