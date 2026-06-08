# Graph Report - .  (2026-06-08)

## Corpus Check
- 35 files · ~128,400 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 585 nodes · 1016 edges · 57 communities (38 shown, 19 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 81 edges (avg confidence: 0.81)
- Token cost: 74,152 input · 31,779 output

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
- [[_COMMUNITY_Account Deletion|Account Deletion]]
- [[_COMMUNITY_Joker Note Modal|Joker Note Modal]]
- [[_COMMUNITY_Revenue Modal|Revenue Modal]]
- [[_COMMUNITY_Staff Modal|Staff Modal]]
- [[_COMMUNITY_Patron Password Reset|Patron Password Reset]]
- [[_COMMUNITY_Service Worker Cache|Service Worker Cache]]
- [[_COMMUNITY_html2canvas Internals F|html2canvas Internals F]]
- [[_COMMUNITY_html2canvas Internals G|html2canvas Internals G]]
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
5. `init()` - 18 edges
6. `make_xlsx_lib()` - 17 edges
7. `showToast()` - 16 edges
8. `loadDayDetail()` - 13 edges
9. `escapeHtml()` - 12 edges
10. `init()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Onglet Mon équipe (responsable)` --implements--> `planning.html (interface staff)`  [INFERRED]
  docs/prd.md → public/planning.html
- `isAutoPublished()` --calls--> `weekStart()`  [EXTRACTED]
  lib/utils.js → public/lib/week.js
- `isDatePublished()` --calls--> `weekStart()`  [EXTRACTED]
  lib/utils.js → public/lib/week.js
- `De()` --calls--> `w()`  [INFERRED]
  public/vendor/jspdf.umd.min.js → public/vendor/html2canvas.min.js
- `m()` --calls--> `Ae()`  [INFERRED]
  public/vendor/jspdf.umd.min.js → public/vendor/html2canvas.min.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Modules UMD partagés navigateur/Node testés** — architecture_umd_module, architecture_week_module, architecture_shift_hours_module, readme_lib_utils [EXTRACTED 0.90]
- **Sûreté timezone via toDateStr** — architecture_timezone_rule, architecture_todatestr, architecture_push_past_shift_guard [EXTRACTED 0.85]
- **Cycle de vie feature iCal (livrée puis désactivée)** — backlog_f09_ical, architecture_ical_feed, architecture_calendar_enabled_flag [EXTRACTED 0.90]

## Communities (57 total, 19 thin omitted)

### Community 0 - "Planning Board UI"
Cohesion: 0.06
Nodes (51): addDays(), allEstablishments, allStaff, applyStatsPeriod(), buildHistStatsHtml(), buildTeamDisplayNames(), checkAuth(), createDispoCard() (+43 more)

### Community 1 - "Architecture & Design Rationale"
Cohesion: 0.05
Nodes (49): Architecture technique — Templyo, Flag CALENDAR_ENABLED (iCal désactivé D-83), Synchronisation agenda — flux iCal (D-72), Garde B-10 — pas de push pour shift passé, hourly_rate_snapshot / fixed_rate_snapshot, Hiérarchie des rôles & middlewares auth, Service Worker / PWA (Cache First, BUILD_TIME), public/lib/shift-hours.js (heures effectives) (+41 more)

### Community 2 - "html2canvas Render Engine"
Cohesion: 0.04
Nodes (5): Ae(), QB(), re(), SUPPORT_WORD_BREAKING(), w()

### Community 3 - "html2canvas Parser"
Cohesion: 0.11
Nodes (43): CA(), fe(), fr(), mr(), ne(), se(), Xt(), _() (+35 more)

### Community 4 - "Main Planning Script (State)"
Cohesion: 0.05
Nodes (20): allEstablishments, allGroups, allRoles, allStaff, AUTO_COLORS, confirmedDispos, copyShiftsBuffer, currentShifts (+12 more)

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
Cohesion: 0.43
Nodes (5): shiftDurationHours(), shiftEffectiveHours(), assert, { shiftEffectiveHours, shiftDurationHours }, { test }

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
Cohesion: 0.40
Nodes (5): ee(), He(), ie(), te(), ye()

### Community 23 - "Session Management"
Cohesion: 0.50
Nodes (4): CustomMongoStore (sessions promesses), SESSION_SECRET obligatoire en production, Session TTL 30 jours glissant (rolling/touch), Trust proxy en production (Railway)

### Community 24 - "Tap Selection"
Cohesion: 0.50
Nodes (4): clearTapSelection(), hideTapBanner(), showTapBanner(), tapSelectStaff()

### Community 25 - "Timeline Rendering"
Cohesion: 0.50
Nodes (4): getPxPerHour(), onTouchStart(), refreshPxPerHour(), renderTimelineHeader()

### Community 26 - "Shift Drag Interaction"
Cohesion: 0.50
Nodes (4): onMove(), onTouchEnd(), onTouchMove(), updateShiftText()

### Community 27 - "Route Tests"
Cohesion: 0.50
Nodes (3): app, assert, { test, before, after }

### Community 28 - "html2canvas Internals A"
Cohesion: 0.50
Nodes (4): an(), fn(), Pt(), sn()

### Community 29 - "html2canvas Internals B"
Cohesion: 0.50
Nodes (4): E(), I(), p(), wA()

### Community 30 - "html2canvas SVG Draw"
Cohesion: 0.50
Nodes (4): gr(), Lr(), pr(), SUPPORT_FOREIGNOBJECT_DRAWING()

### Community 31 - "html2canvas Internals C"
Cohesion: 0.50
Nodes (4): gs(), ns(), rs(), ts()

### Community 32 - "PWA App Icons"
Cohesion: 1.00
Nodes (3): App Icon 192px (White T on Purple), App Icon 512px (White T on Purple), App Icon 72px (White T on Purple)

### Community 33 - "Dispo Confirmation"
Cohesion: 0.67
Nodes (3): buildEstablishmentSelect(), confirmAllForStaff(), openConfirmDispo()

### Community 36 - "Push Reminder Scheduler"
Cohesion: 0.67
Nodes (3): checkDispoRappels(), computeEffectiveDeadline(), sendPushToStaff()

### Community 37 - "Daily Cron Jobs"
Cohesion: 0.67
Nodes (3): cleanupOldJokers(), connectDB(), scheduleDailyAt10()

### Community 38 - "html2canvas Internals D"
Cohesion: 0.67
Nodes (3): cn(), on(), Qn()

### Community 39 - "html2canvas Internals E"
Cohesion: 0.67
Nodes (3): KB(), oe(), xB()

## Knowledge Gaps
- **115 isolated node(s):** `crypto`, `{ weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }`, `name`, `version`, `description` (+110 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fmtH()` connect `Time Clock (Pointage)` to `Shift CRUD & Rendering`, `Week Data Loading`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `m()` connect `html2canvas Parser` to `html2canvas Render Engine`, `html2canvas SVG Draw`, `html2canvas Color`, `html2canvas Internals E`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `renderWeekGantt()` connect `Week Data Loading` to `Time Clock (Pointage)`, `Main Planning Script (State)`, `Week View Rendering`, `Staff Card Styling`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `m()` (e.g. with `Ee()` and `Ae()`) actually correct?**
  _`m()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `crypto`, `{ weekStart, currentWeekStart, WEEK_CUTOFF_HOUR }`, `name` to the rest of the system?**
  _120 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Planning Board UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06428988895382817 - nodes in this community are weakly interconnected._
- **Should `Architecture & Design Rationale` be split into smaller, more focused modules?**
  _Cohesion score 0.05187074829931973 - nodes in this community are weakly interconnected._