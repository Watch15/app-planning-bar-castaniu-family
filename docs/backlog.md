# Backlog — Templyo

Registre des bugs identifiés, améliorations en attente et fonctionnalités futures.
Ajouter les nouveaux éléments avec une description courte, un contexte et une priorité. Retirer ou déplacer vers `done` une fois résolus.

---

## P1 — Bugs bloquants (à faire en premier)

| ID | Description | Domaine | Statut |
|---|---|---|---|
| B-04 | **Barre staff verticale mobile** — sur téléphone vertical la barre est difficilement utilisable : scroll horizontal, cartes trop petites, recherche/filtres peu accessibles | Mobile / Staff bar | ✅ Done |
| B-05 | **Touch OPEN_TIME bypass** — comportement voulu : le snap bloque avant l'ouverture pour la planification, les heures réelles peuvent dépasser librement | Timeline / Touch | ✅ By design |
| B-06 | **Validation / erreurs inaccessibles mobile** — modales de confirmation et toasts d'erreur passent sous le clavier ou hors écran en mode portrait | Mobile / UX | ✅ Done |

---

## P2 — Améliorations (après les P1)

| ID | Description | Domaine | Statut |
|---|---|---|---|
| E-03 | **Pointage : onglet responsable** — remplacer le compte `etablissement` par un onglet dédié dans la vue staff pour le `responsable` de soirée, qui peut valider les horaires sans compte séparé | Pointage / Auth | ✅ Done |
| E-04 | **Heures côté staff** — affichage amélioré sur `planning.html` : total semaine, heures par établissement, comparaison semaines | Staff view | ✅ Done |
| B-02 | Responsivité petits écrans — certaines modales ou panneaux débordent ou perdent leur padding | CSS / Mobile | ✅ Done |
| B-03 | Audit `pointerdown` vs `click` sur boutons mobiles — certains boutons de validation modale peuvent manquer les taps sur iOS/Android | Mobile / Events | ✅ Done |

---

## P3 — Nouvelles fonctionnalités (roadmap)

| ID | Description | Domaine | Notes |
|---|---|---|---|
| ~~F-03~~ | ~~**Note sur Joker**~~ | Joker / UX | ✅ Done — champ `note` sur shifts Joker, saisie modale patron, affichage staff si Joker attribué |
| ~~F-04~~ | ~~**Récap mensuel heures (export CSV)**~~ | Dashboard / Export | ✅ Done — CSV livré en D-17, **migré vers Excel `.xlsx`** + ventilation par établissement en D-52 |
| F-05 | **Échange de shifts avec validation patron** | Shifts / Notifications | ⏸️ Code livré (D-18) mais **désactivé en attente validation client** — collection `shift_swaps` conservée, 7 routes commentées via `/* */` dans `server.js` lignes 2186→2422 et 2488→2550. Modales front/back fonctionnelles, à réactiver d'un seul retrait de commentaires |

---

## Déjà livré / non prioritaire

| ID | Description | Décision |
|---|---|---|
| — | Push notifications | Déjà en place (VAPID + SW) |
| — | Template semaine | Déjà couvert par "copier un jour" (feature existante) |
| — | Alerte heures sup | Reporté — pas de demande terrain |

---

## Fait

| ID | Description | Commit |
|---|---|---|
| D-01 | Contraste tabs Jour/Semaine fond clair | bb6cab3 |
| D-02 | Contraste total heures par ligne timeline | 3a310d0 |
| D-03 | Styles copy-week-section/label/grid manquants | 2ba4fe5 |
| D-04 | Copie vers semaine suivante — modale deux sections | 9396d05 |
| D-05 | Snap mobile — flag `_touchActive` bloque mousedown Android | 5f44ae8 |
| D-06 | Heures timeline dynamiques — `applyVenueHours()` | 5f44ae8 |
| D-07 | `PX_PER_HOUR` 60 universel — SNAP entier, fin des minutes irrégulières | 1c40ffe |
| D-08 | Placement jusqu'à heure fermeture — clamp `END_HOUR-0.25` | 1c40ffe |
| D-09 | `OPEN_TIME`/`CLOSE_TIME` — borne visuelle ≠ borne métier (mouse/drag) | e4b032e |
| D-10 | Lien SMS cliquable — restaure `https://` dans les 3 envois Twilio | 66a7869 |
| D-11 | Barre staff mobile — bottom sheet 2 colonnes 60vh scroll vertical | — |
| D-12 | Modales bottom sheet mobile — `align-items:flex-end`, `border-radius:20px 20px 0 0`, `font-size:16px` | — |
| D-13 | Toast mobile — repositionné en haut de l'écran (ne passe plus sous la barre staff) | — |
| D-14 | E-04 — stats staff : delta heures vs sem. prec. + répartition par établissement | — |
| D-15 | E-03 — onglet Pointage pour directeur dans planning.html + sélecteur établissement dans pointage.html | — |
| D-16 | B-03 — `touch-action: manipulation` global sur boutons/liens | — |
| D-17 | F-04 — Export CSV du récap mensuel (UTF-8 BOM, séparateur `;`, compatible Excel FR) | — |
| D-18 | F-05 — Échange de shifts : collection `shift_swaps`, 7 routes backend, modale patron (✓/✗ + raison), modale staff (4 semaines glissantes, cross-établissement). **Routes désactivées depuis mai 2026 en attente validation client** — code conservé, à réactiver par retrait des `/* */` blocs (lignes 2186→2422 et 2488→2550 server.js) | — |
| D-19 | F-03 — Note sur Joker : champ `note` sur shifts Joker, saisie patron dans modale Joker, affichage staff si Joker attribué | — |
| D-20 | UX — refonte header patron (I-01/02/03) : brand mobile + ⏱ Pointage ambre + drawer restructuré | — |
| D-21 | UX — pointage (PT-01/02/03/04/05/06) : validated-card, édition heures réelles, total-footer, gap coloré, session-banner, mobile layout | — |
| D-22 | UX — planning staff (P-03/04) : cutoff_hour sur onglet Pointage + spacer safe-area-inset-bottom | — |
| D-23 | UX — auth (L-02/L-04, S-01/S-03) : login scroll, année dynamique, toggle œil, guard token absent | — |
| **Sprint court — sécurité / infra** ||
| D-24 | `SESSION_SECRET` hard-crash en prod + `sameSite:'lax'` sur cookie session | — |
| D-25 | `app.set('trust proxy', 1)` en prod (Railway reverse proxy) | — |
| D-26 | `.gitignore` nettoyé — renommé depuis `gitignore`, retrait `docs/`, ajout `.env.*`, `.idea/`, `.vscode/` | — |
| D-27 | `toISOString()` remplacé par formatage local dans `script.js:3779` (bug off-by-one timezone potentiel) | — |
| **Sprint moyen — sécurité / observabilité** ||
| D-28 | `helmet()` + CSP adaptée au stack (Google Fonts, `'unsafe-inline'` toléré) | — |
| D-29 | `morgan` access logs (`combined` prod, `dev` local) | — |
| D-30 | `GET /health` — ping MongoDB + uptime, pour Railway + monitoring | — |
| D-31 | Indexes MongoDB manquants — push_subscriptions.user_id, notifications(user_id,read,created_at), shift_swaps(status,created_at), settings.key unique, users.phone/invite_token/reset_token sparse | — |
| D-32 | `escapeHtml()` étendu (quotes) + appliqué aux `innerHTML` user-data : venues, staff rows, users, roles, agenda pills, swap cards, conflict toast | — |
| D-33 | Sentry intégration conditionnelle — init uniquement si `SENTRY_DSN` présent, `setupExpressErrorHandler` + fallback `app.use((err,req,res,next))` | — |
| **Phase 3 — fondations** ||
| D-34 | `lib/utils.js` — extraction helpers purs (`isValidObjectId`, `hashToken`, `normalizePhone`, `computeActiveDate`, `toDateStr`) | — |
| D-35 | `tests/utils.test.js` — 20 tests `node --test` natif (cutoff 0/pile/bascule mois-année, padding date, téléphones internationaux) | — |
| D-36 | GitHub Actions CI — `.github/workflows/ci.yml`, matrice Node 20/22, `npm ci` → syntax check → `npm test` | — |
| **Bugs hotfix** ||
| D-37 | Double bouton ⏱ Pointage dans header patron — retrait insertion JS dupliquée dans `script.js:init()` | — |
| D-38 | Modale approbation échange patron — heures ≥ 24h wrap sur 00-23 (`_fmtSwapTime` aligné sur `fmtHour`) | — |
| D-39 | Stats « Moy. par personne » (vue jour + vue semaine) — jokers exclus du numérateur ET dénominateur | — |
| D-40 | Rebranding Planning Bar → Templyo | — |      
| D-41 | La normalisation des numero de telephone, pour que +33612345678 et 0612345678 matchent en base | — |
| **Sprint mai 2026 — nouvelles features** ||
| D-42 | **F-06 — Joker ouvert au staff** : toggle patron « 📢 Proposer au staff », push Web à tout le staff de l'établissement, candidatures horodatées dans `joker_candidates[]`, assignation 1 clic depuis la modale, bloc « 📢 Créneau disponible » dans `planning.html` | 0b47394 |
| D-43 | **F-07 — Transfert de shift cross-établissement** : route `PATCH /api/shifts/:id/transfer`, notif push staff « 🔄 Shift transféré » | e416616 |
| D-44 | **F-08 — Recherche insensible aux accents (NFD)** : helper `normalizeStr()` appliqué à la barre staff + modale notes (« emilie » matche « Émilie ») | 7cd9c22 |
| D-45 | Hotfix — route `PATCH /api/shifts/:id/joker-open` déplacée avant `/api/shifts/:id` (la route générique l'aurait capturée, 404) + gestion d'erreur côté client robuste si réponse non-JSON | 17f1e5f |
| D-46 | Hotfix — query `GET /api/shifts/joker-ouverts` utilise `$or` (`is_joker: true` OR `staff_id: '__joker__'`) pour matcher les Jokers historiques sans champ `is_joker` | 783464c |
| D-47 | Hotfix critique — routes Joker accidentellement à l'intérieur du bloc `/* F-05 DÉSACTIVÉ */` lignes 2186→2550 → invisibles à Express, 404 silencieux. Bloc scindé en deux (2186→2422 et 2488→2550) pour libérer la section Joker | (à commit) |
| D-48 | Création compte staff lie automatiquement le téléphone à un staff existant + greeting SMS/email trimé proprement | 0de5f7b ce7c0c2 2923718 |
| D-49 | **Audit ergonomie tactile/mobile (7 pages)** — Bloquants levés sur l'ensemble du parcours : tailles tactiles ≥ 44 px (`.modal-close` 32→44, `.view-tab`, `.cal-nav` 30→44, `.dispo-time-input` 36→44, boutons login/set-password, onglets `.week-sub-tab`, `.staff-modal-tab`, 4 boutons inline du modal Dispos), anti-zoom iOS via règle globale `font-size:16px` sur inputs mobile (`style.css` + exceptions `.copy-time-input`, `.staff-search-input`), scrolls horizontaux ajoutés (`.table-wrap` perf, calendrier perf <480 px en `repeat(7, 64px)` scroll-snap, `.tabs-bar` planning, container onglets Staff & Dispos), `.modal-header` rendu `position:sticky` → close toujours accessible pendant scroll modal | (à commit) |
| D-50 | **Audit code — 7 bloquants levés (sécurité + DB + cohérence)** : (B7) index `daily_revenue(establishment_id, date)` unique + `staff_notifications(staff_id, created_at)` ajoutés au startup serveur ET dans `init-db.js` ; (B4) filter `is_joker \|\| staff_id==='__joker__'` dans `/api/performance` (KPI heures, table, détail, calendrier) ; (B1) `toISOString()` → format local sur `deadline` `/api/dispo-settings` (conforme §3.1) ; (B8) `escapeHtml(String(...))` sur `shift._id` et `shift.staff_id` dans attribut `onclick` (script.js:1421) ; (B5) `findOneAndUpdate` atomique avec filter `'joker_candidates.staff_id': { $ne }` sur candidature Joker (anti double-tap) ; (B3) replace_all × 86 — `{ error: e.message }` → log serveur + `{ error: 'Erreur interne' }` (conforme §12, plus de fuite stack) ; (B2) fallback `findOne({ invite_token: token })` / `reset_token: token` en clair supprimés (tokens pré-migration de toute façon expirés via TTL 24h/1h) | (à commit) |
| **Sprint mai 2026 — exports & récaps** ||
| D-51 | **Export PDF du tableau de bord hebdomadaire** (`index.html`, sous-onglet Semaine → Tableau de bord) — bouton « 🖨 Imprimer » remplacé par « 📄 PDF » qui télécharge directement `planning-YYYY-MM-DD.pdf` (A4 paysage). Fit-to-page via `min(scaleX,scaleY)` + centrage : **toujours 1 page** quel que soit le nombre de staff (densité adaptative ≤15 / 16-25 / 26+ : police 12/11/10 px, paddings et pills ajustés ; conteneur 1200/1400 px pour matcher le ratio paysage). En-tête style Gantt : logo Templyo + **nom de l'établissement** + libellé de semaine + badge « Semaine ». **Colonne « Total heures » par personne retirée à la demande utilisateur**. Pile : `jspdf` 2.5.1 + `html2canvas` 1.4.1 **auto-hébergés** dans `/public/vendor/` (téléchargés depuis cdnjs, **pas de CDN runtime**, précachés par le SW). Bouton Gantt et bouton du récap mensuel inchangés. | (à commit) |
| D-52 | **Récap mensuel patron — ventilation par établissement + export Excel** (`index.html` modale Récap) — `GET /api/recap-mensuel` retourne désormais `by_establishment[]` par staff (`{ establishment_id, establishment_name, planned_hours }`, trié alphabétiquement). ⚠️ Lookup établissement par champ custom `id` (pas `_id`) — les shifts référencent `establishments.id`. Modale : colonnes par établissement insérées entre **Nom** et `Jours/Planifiées/Réelles/Écart` (affichées uniquement si « Tous les établissements » sélectionné), cellule **vide** si pas d'heures (auparavant « — »), ligne de total agrégée par estab, `overflow-x:auto` pour mobile, `escapeHtml(staff_name)` ajouté. **Export CSV remplacé par export Excel `.xlsx`** : `📊 Excel` (titre « Enregistrer en Excel (.xlsx) »), nouvelle fonction `exportRecapXlsx` via **SheetJS** (`xlsx.full.min.js` 0.18.5 auto-hébergé `/public/vendor/`, précaché SW), feuille « Récap YYYY-MM », largeurs auto, mêmes colonnes que la modale. Ancienne fonction `exportRecapCsv` supprimée. | (à commit) |
| D-53 | **Vue staff — toggle Semaine/Mois + stats Historique** (`planning.html`) — segmented control « Semaine / Mois » au-dessus de `#week-stats`, défaut Semaine. Mode **Mois** : `loadMonthRecap()` + `renderMonthStats()` (3 cartes Jours/Shifts/Heures + delta « vs mois préc. »), via la route existante `/api/my-shifts`. État `_lastWeekData`/`_lastMonthData` pour switch instantané. **Onglet Historique** : bloc stats (3 cartes) au-dessus des cartes journées + répartition par établissement si > 1. *(Note : les deltas hebdo « vs sem. préc. » de ce sprint ont été retirés ensuite — voir D-61)* | (à commit) |
| **Sprint mai 2026 — dispos individuelles & pointage** ||
| D-54 | **Suppression d'un shift non pointé depuis le pointage** — `DELETE /api/shifts/:id/pointage` (refus 409 si `real_start`/`real_end` déjà saisi), bouton « Supprimer » à 2 clics (Supprimer → Confirmer, reset 4s) sur les cartes non validées de `pointage.html`. Accessible établissement / patron / directeur / responsable de soirée | c8c0ecf |
| D-55 | **Convention de nommage dans le sélecteur « service non planifié »** (`pointage.html`) — helper `staffDisplayName()` (surnom sinon prénom), aligné avec le reste de l'app | c5fd6e4 |
| D-56 | **Plusieurs responsables de soirée par jour** — `isResponsablePourSoiree()` passe de `.find()` à `.filter()/.some()`, retrait du `$unset` qui dé-désignait les autres responsables. Permet ex. 1 responsable matin + 1 soir | 4a18137 |
| D-57 | **B-10 — Aucun push pour un shift passé** — garde `shift.date >= toDateStr(new Date())` (comparaison lexicographique `YYYY-MM-DD`) sur les 6 sites push shift : `POST /api/shifts`, `PATCH /api/shifts/:id` (callback debounce, in-app patron conservé), `/transfer`, `/joker-open`, `DELETE /api/shifts/:id`, `PATCH /api/publish/:weekStart` (filtre `distinct` sur `date >= max(weekStart, today)`). Rappels dispos & notifs in-app non touchés | 3c863c6 |
| D-58 | **E-15 — Réouverture dispo individuelle par staff** — champ `settings.dispo.force_open_staff[]`, route `PATCH /api/dispo-settings/force-open-staff` (add/remove, placée avant `/api/dispo-settings`), bypass deadline dans `POST /api/dispos` + cleanup auto à la soumission, `GET /api/dispo-settings` expose `force_open_staff` + recalcul `canSubmit`, bouton « 🔓 Rouvrir » par ligne dans l'onglet « Sans dispo » | 9974900 |
| D-59 | **Onglet « 🔓 Modifier » dans la modale Dispos** — pour les staff ayant déjà envoyé. `GET /api/dispos/with-dispo` (liste + compteur + flag `reopened`), `POST /api/dispos/reopen-for-correction` (supprime les dispos de la semaine + `$addToSet force_open_staff`). Bouton « Rouvrir » à 2 clics avec confirmation destructive | d7408ad |
| D-60 | **Barre d'onglets Dispos — `flex-wrap`** (`index.html`) — les 5 onglets ne tenaient plus sur une ligne (overflow-x masqué → onglet « Notes » inaccessible). Passage en `flex-wrap:wrap`, padding/hauteur compactés (44→40), « Modifier dispo » raccourci en « Modifier » | c35c960 |
| D-61 | **Retrait du delta « vs semaine précédente » côté staff** (`planning.html`) — suppression du calcul + affichage sur les stats semaine courante (`renderStats`/`renderStatsInto`) et historique (`buildHistStatsHtml`/`renderHistoriqueWeek`/`loadHistoriqueWeek`). 2 fetch `/api/my-shifts` N-1 en moins par chargement. **Le delta mensuel est conservé.** Annule partiellement D-14 et la partie hebdo de D-53 | 3404c2a |

---

## P2 — Audit ergonomie restant (mai 2026)

Items 🟠 Importants / 🟡 Cosmétiques relevés par l'audit D-49 mais non corrigés (UX dégradée mais page utilisable). À planifier si demande terrain.

| ID | Description | Domaine | Statut |
|---|---|---|---|
| ~~U-01~~ | ~~`pointage.html` `.btn-save` utilise `var(--dark-surface)` au lieu de `var(--accent)`~~ | pointage / cohérence | ✅ Done — `.btn-save` bg `var(--accent)` + hover `var(--accent-soft)` (pointage.html ligne 191/197) |
| ~~U-02~~ | ~~`pointage.html` `.validated-badge` : couleurs en dur (`#6EE7B7`, `#d1fae5`, `#065f46`)~~ | pointage / tokens | ✅ Done — `.validated-badge` + `.shift-card.validated-card` + `.ecart-badge.pos/zero` migrés vers `--success-*` / `--validated-*` / `--gap-under-bg` ; tokens manquants ajoutés au `:root` de pointage.html |
| U-03 | `performance.html` `.targets-form` (3 inputs + bouton) sans `min-width` par groupe → wrap instable 360-400 px | performance / mobile | 🟠 |
| U-04 | `performance.html` `.kpi-sub` 11 px font-weight 400 sur fond clair → contraste / hiérarchie faible | performance / typo | 🟠 |
| U-05 | `planning.html` `.dispo-type-btn.selected-off` sur `--light-bg` (#f4f5f8) → état sélectionné peu distinctif | planning / contraste | 🟠 |
| U-06 | `index.html` ~74 styles inline avec couleurs en dur (`#fff8e1`, `#fde8e8`, `rgba(108,99,255,0.1)`) → maintenance fragmentée (refactor lourd, à reporter sauf bug visuel) | index / dette | 🟡 |
| U-07 | `politique-confidentialite.html` logo 34×34 vs standard 28×28, pas de breakpoint tablette (768-1024 px, saute desktop → mobile à 600 px) | politique / cohérence | 🟡 |
| U-08 | `performance.html` `.day-card.empty` utilise `#fffbf0` / `#b45309` au lieu de `--warning-*` | performance / tokens | 🟡 |
| U-09 | `index.html` `.resizer` timeline 16 px de large → difficile au doigt, mais élargir = risque de régression sur le drag/snap | index / timeline | 🟡 |

---

## Notes pour les agents

- **Timezone** : ne jamais utiliser `toISOString()` — toujours `getFullYear()/getMonth()/getDate()`. Voir `docs/architecture.md` §3.1. Helper pur : `toDateStr()` dans `lib/utils.js`.
- **script.js** : fichier monolithique (~7300 lignes) — modifications additives et ciblées uniquement, pas de refactoring sans décision explicite.
- **server.js** : monolithique (~3800 lignes). Helpers purs dans `lib/utils.js` (testés). Split en routers = chantier futur (#10 backlog). ⚠️ **Deux blocs `/* F-05 DÉSACTIVÉ */`** : ne JAMAIS y ajouter de nouvelles routes — elles seraient invisibles à Express (cf. D-47). Les n° de ligne ont bougé depuis (server.js a grossi) — repérer les blocs par le marqueur de commentaire, pas par le n° de ligne.
- **Push & shift passé** : aucun push lié à un shift si `shift.date < toDateStr(new Date())` (B-10 / D-57). Ne touche pas les rappels dispos ni les notifs in-app patron.
- **Réouverture dispo** : `settings.dispo.force_open_staff[]` autorise un staff précis à soumettre malgré la deadline (E-15 / D-58), purgé à la soumission. Onglets « Sans dispo » (rouvrir simple) et « Modifier » (supprime les dispos existantes puis rouvre).
- **Tests** : `npm test` (zéro dépendance, `node --test`). Ajouter un test quand on extrait un helper pur, change une règle de date/heure, ou fixe un bug qui pourrait régresser.
- **Joker** : `staff_id === '__joker__'` et `is_joker: true`. F-03 ajoute un champ `note`, F-06 (D-42) ajoute `joker_open: bool` + `joker_candidates[]` pour le système de candidatures staff. **Les jokers sont exclus des stats « Moy. par personne »** (D-39). Toujours tester l'identité Joker avec `is_joker || staff_id === '__joker__'` (anciens documents sans flag).
- **Timeline** : tester drag, resize et snap sur desktop ET mobile 390px portrait après chaque modification.
- **OPEN_TIME / CLOSE_TIME** : bornes métier décimales (ex. 9.5 = 09:30). `START_HOUR`/`END_HOUR` sont des entiers pour l'affichage uniquement.
- **Heures ≥ 24h** : convention interne pour les shifts de nuit (25.5 = 01h30 du lendemain). Toujours wrap avec `((h % 24) + 24) % 24` avant affichage.
- **CSP (helmet)** : `'unsafe-inline'` toléré sur `script-src`/`style-src` tant que les HTML contiennent des `<script>`/`<style>` inline. À retirer si on extrait tout.
- **Sentry** : désactivé par défaut, s'active seulement si `SENTRY_DSN` présent côté Railway.
