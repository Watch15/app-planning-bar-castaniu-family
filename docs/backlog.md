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
| ~~F-04~~ | ~~**Récap mensuel heures (export CSV)**~~ | Dashboard / Export | ✅ Done — bouton `⬇ Export CSV` ajouté à la modale Récap (UTF-8 BOM, séparateur `;`) |
| ~~F-05~~ | ~~**Échange de shifts avec validation patron**~~ | Shifts / Notifications | ✅ Done — collection `shift_swaps`, cross-établissement autorisé, modale patron + modale staff |

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
| D-18 | F-05 — Échange de shifts : collection `shift_swaps`, 7 routes backend, modale patron (✓/✗ + raison), modale staff (4 semaines glissantes, cross-établissement) | — |
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

---

## Notes pour les agents

- **Timezone** : ne jamais utiliser `toISOString()` — toujours `getFullYear()/getMonth()/getDate()`. Voir `docs/architecture.md` §3.1. Helper pur : `toDateStr()` dans `lib/utils.js`.
- **script.js** : fichier monolithique (~4700 lignes) — modifications additives et ciblées uniquement, pas de refactoring sans décision explicite.
- **server.js** : monolithique (~3200 lignes). Helpers purs dans `lib/utils.js` (testés). Split en routers = chantier futur (#10 backlog). ⚠️ **Deux blocs `/* F-05 DÉSACTIVÉ */` lignes 2186→2422 et 2488→2550** : ne JAMAIS y ajouter de nouvelles routes — elles seraient invisibles à Express (cf. D-47).
- **Tests** : `npm test` (zéro dépendance, `node --test`). Ajouter un test quand on extrait un helper pur, change une règle de date/heure, ou fixe un bug qui pourrait régresser.
- **Joker** : `staff_id === '__joker__'` et `is_joker: true`. F-03 ajoute un champ `note`, F-06 (D-42) ajoute `joker_open: bool` + `joker_candidates[]` pour le système de candidatures staff. **Les jokers sont exclus des stats « Moy. par personne »** (D-39). Toujours tester l'identité Joker avec `is_joker || staff_id === '__joker__'` (anciens documents sans flag).
- **Timeline** : tester drag, resize et snap sur desktop ET mobile 390px portrait après chaque modification.
- **OPEN_TIME / CLOSE_TIME** : bornes métier décimales (ex. 9.5 = 09:30). `START_HOUR`/`END_HOUR` sont des entiers pour l'affichage uniquement.
- **Heures ≥ 24h** : convention interne pour les shifts de nuit (25.5 = 01h30 du lendemain). Toujours wrap avec `((h % 24) + 24) % 24` avant affichage.
- **CSP (helmet)** : `'unsafe-inline'` toléré sur `script-src`/`style-src` tant que les HTML contiennent des `<script>`/`<style>` inline. À retirer si on extrait tout.
- **Sentry** : désactivé par défaut, s'active seulement si `SENTRY_DSN` présent côté Railway.
