# Backlog — Planning Bar

Registry of identified bugs, pending enhancements, and future features.
Add new items with a short description, context, and priority. Remove or move to `done` when resolved.

---

## P1 — Bugs bloquants (à faire en premier)

| ID | Description | Area | Status |
|---|---|---|---|
| B-04 | **Barre staff verticale mobile** — sur téléphone vertical la barre est difficilement utilisable : scroll horizontal, cartes trop petites, recherche/filtres peu accessibles | Mobile / Staff bar | ✅ Done |
| B-05 | **Touch OPEN_TIME bypass** — comportement voulu : le snap bloque avant l'ouverture pour la planification, les heures réelles peuvent dépasser librement | Timeline / Touch | ✅ By design |
| B-06 | **Validation / erreurs inaccessibles mobile** — modales de confirmation et toasts d'erreur passent sous le clavier ou hors écran en mode portrait | Mobile / UX | ✅ Done |

---

## P2 — Améliorations (après les P1)

| ID | Description | Area | Status |
|---|---|---|---|
| E-03 | **Pointage : onglet responsable** — remplacer le compte `etablissement` par un onglet dédié dans la vue staff pour le `responsable` de soirée, qui peut valider les horaires sans compte séparé | Pointage / Auth | ✅ Done |
| E-04 | **Heures côté staff** — affichage amélioré sur `planning.html` : total semaine, heures par établissement, comparaison semaines | Staff view | ✅ Done |
| B-02 | Responsivité petits écrans — certaines modales ou panneaux débordent ou perdent leur padding | CSS / Mobile | ✅ Done |
| B-03 | Audit `pointerdown` vs `click` sur boutons mobiles — certains boutons de validation modale peuvent manquer les taps sur iOS/Android | Mobile / Events | ✅ Done |

---

## P3 — Nouvelles fonctionnalités (roadmap)

| ID | Description | Area | Notes |
|---|---|---|---|
| F-03 | **Note sur Joker** — ajouter un champ `note` sur les shifts Joker uniquement, pour laisser des instructions au staff qui sera affecté (ex. "s'occuper de la caisse", "arrivée 30 min avant") | Joker / UX | Côté patron : saisie dans la modale Joker. Côté staff : affiché si le Joker leur est attribué |
| F-04 | **Récap mensuel heures (export CSV)** — vue patron : tableau par staff avec total heures/semaine sur un mois, exportable en CSV pour la paie | Dashboard / Export | Calculé depuis la collection `shifts`. Colonnes : staff, semaine, établissement, heures. |
| F-05 | **Échange de shifts avec validation patron** — un staff peut proposer d'échanger son shift avec un collègue ; le patron reçoit une notification et valide ou refuse l'échange | Shifts / Notifications | Nouveau statut `pending_swap` sur le shift. Notification in-app + push au patron. |

---

## Déjà livré / non prioritaire

| ID | Description | Décision |
|---|---|---|
| — | Push notifications | Déjà en place (VAPID + SW) |
| — | Template semaine | Déjà couvert par "copier un jour" (feature existante) |
| — | Alerte heures sup | Reporté — pas de demande terrain |

---

## Done

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

---

## Notes pour les agents

- **Timezone** : ne jamais utiliser `toISOString()` — toujours `getFullYear()/getMonth()/getDate()`. Voir `docs/architecture.md` §3.1.
- **script.js** : fichier monolithique (~4200 lignes) — modifications additives et ciblées uniquement, pas de refactoring.
- **Joker** : `staff_id === '__joker__'` et `is_joker: true`. F-03 ajoute un champ `note` uniquement sur ces shifts.
- **Timeline** : tester drag, resize et snap sur desktop ET mobile 390px portrait après chaque modification.
- **OPEN_TIME / CLOSE_TIME** : bornes métier décimales (ex. 9.5 = 09:30). `START_HOUR`/`END_HOUR` sont des entiers pour l'affichage uniquement.
