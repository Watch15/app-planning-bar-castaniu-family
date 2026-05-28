# UX Design — Templyo
**Statut : En cours — items Haut/Moyen livrés (D-20→D-23 commit Avril, D-49 audit tactile mai 2026). Restants 🟠/🟡 listés `backlog.md` U-01→U-09.**
**Date : Avril 2026 — mis à jour mai 2026**

---

## 1. Design System existant

### Tokens couleurs (style.css)
| Token | Valeur | Usage |
|---|---|---|
| `--dark-bg` | `#0f0f1a` | Header, fond pages auth |
| `--dark-surface` | `#1a1a2e` | Venue-bar, boutons sombres |
| `--accent` | `#6C63FF` | CTA principal, focus, today |
| `--light-bg` | `#f4f5f8` | Fond pages principales |
| `--light-card` | `#ffffff` | Cartes, modales |
| `--success` | `#10b981` | Heures validées, delta + |
| `--warning` | `#f59e0b` | Shifts extra, alertes |
| `--danger` | `#ef4444` | Erreurs, jours vides |

### Typographie
Inter uniquement. Échelle : 11px (labels caps) → 13px (corps) → 14–15px (titres).

---

## 2. Audit page par page

### 2.1 login.html
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| L-01 | Logo dupliqué : brand logo + logo dans la card | Faible | |
| ~~L-02~~ | ~~"Mot de passe oublié ?" expand inline — pousse la card hors écran mobile~~ | Moyen | ✅ Done — `overflow-y:auto` + `margin:auto 0` |
| L-03 | Pas de retour visuel focus sur input type="tel" | Faible | |
| ~~L-04~~ | ~~Copyright "2025" daté~~ | Cosmétique | ✅ Done — année dynamique |
| ~~L-05~~ | ~~Boutons / inputs ~36 px (sous seuil tactile 44 px) + inputs 14 px (zoom iOS au focus)~~ | Haut | ✅ Done (D-49) — toggle-btn min-44, inputs 44+16px, btn-login 48px |

### 2.2 set-password.html
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| ~~S-01~~ | ~~Pas de toggle 👁 "voir le mot de passe"~~ | Moyen | ✅ Done — déjà en place (`btn-eye`) |
| S-02 | Pas d'indicateur de force du mot de passe | Faible | |
| ~~S-03~~ | ~~Token absent → message d'erreur sans bouton retour clair~~ | Moyen | ✅ Done — bouton "← Retour à la connexion" + champs masqués |
| ~~S-04~~ | ~~Inputs / bouton ~36 px tactile + font 14 px (zoom iOS)~~ | Haut | ✅ Done (D-49) — inputs 44+16px, `.btn-eye` 40×40, `.btn` min-48 |

### 2.3 index.html (Patron / Directeur)
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| ~~I-01~~ | ~~Header trop chargé mobile — 7+ éléments visibles~~ | Haut | ✅ Done — brand mobile (icon + titre + rôle) à gauche, seuls 🔔 + ☰ à droite |
| ~~I-02~~ | ~~⏱ Pointage dans le header non distingué visuellement~~ | Moyen | ✅ Done — bouton dédié amber `#f59e0b` dans header + drawer |
| ~~I-03~~ | ~~Règle floue sur ce qui se cache dans le drawer mobile vs visible~~ | Moyen | ✅ Done — drawer groupé Gestion / Planning / Déconnexion, règle documentée en commentaire |
| I-04 | Cartes semaine : pas de mois dans le titre jour en desktop | Faible | |
| I-05 | Pas de panneau stats en vue Jour (seulement en vue Semaine) | Moyen | |
| I-06 | Pas de confirmation visuelle après drag/drop | Faible | |
| I-07 | Jokers sans légende — un nouveau patron ne comprend pas | Moyen | |
| ~~I-08~~ | ~~Modale Joker — toggle « 📢 Proposer au staff », badge timeline « 📢 Ouvert », liste candidatures horodatées (`HHhMM`) avec bouton Assigner, polling 30s~~ | Moyen | ✅ Done (F-06 / D-42) |
| I-09 | Transfert de shift cross-établissement — accessible depuis la modale shift (entrée discrète, à promouvoir si usage récurrent) | Faible | F-07 livré, UX à affiner |
| ~~I-10~~ | ~~`.modal-close` 32×32 + `.view-tab` ~24×24 + onglets internes Dispos/Staff inline ~32 px tactile + inputs modales 13 px (zoom iOS)~~ | Haut | ✅ Done (D-49) — `.modal-close` 44, `.view-tab` min-36, onglets internes ≥44 + `overflow-x:auto` partout, anti-zoom iOS global mobile |
| ~~I-11~~ | ~~Modal-header pouvait scroller hors viewport → close button hors d'atteinte~~ | Haut | ✅ Done (D-49) — `.modal-header` `position:sticky;top:0` |
| I-12 | ~74 styles inline avec couleurs en dur (`#fff8e1`, `#fde8e8`, `rgba(108,99,255,0.1)`) → maintenance fragmentée | Faible | 🟡 U-06 backlog — refactor lourd à reporter |
| I-13 | `.resizer` timeline 16 px de large → difficile au doigt | Faible | 🟡 U-09 backlog — risque régression drag/snap |

### 2.4 planning.html (Staff)
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| P-01 | Collègues en pastilles sans nom au tap mobile | Moyen | |
| ~~P-02~~ | ~~Delta heures uniquement textuel, pas de couleur sur mobile portrait~~ | Faible | ✅ Obsolète — delta hebdo « vs sem. préc. » retiré côté staff (D-61). Le delta mensuel subsiste mais hors scope mobile portrait |
| ~~P-03~~ | ~~Onglet ⏱ Pointage actif seulement le jour J — disparu le lendemain~~ | Haut | ✅ Done — date de référence = date active (cutoff_hour) |
| ~~P-04~~ | ~~Bouton fixe "Envoyer" dispos couvre le dernier jour sur petits écrans~~ | Moyen | ✅ Done — spacer 96px + safe-area-inset-bottom |
| P-05 | Pas de confirmation visuelle post-envoi dispos au-delà du toast | Faible | |
| P-06 | Aucun moyen pour le staff de voir les shifts des semaines passées | Moyen | |
| ~~P-07~~ | ~~Bloc « 📢 Créneau disponible » en haut du planning + bouton « Je suis disponible » → POST candidature, désactivé après envoi avec « ✅ Candidature envoyée »~~ | Moyen | ✅ Done (F-06 / D-42) |
| P-08 | Pas de rafraîchissement auto côté staff pour détecter de nouveaux Jokers ouverts — rechargement manuel nécessaire | Moyen | |
| ~~P-09~~ | ~~`.tab-btn` ~24×24 + `.dispo-time-input` 36 px (sous seuil tactile) + risque débordement tabs sans scroll~~ | Haut | ✅ Done (D-49) — tabs min-44 + `overflow-x:auto`, `.dispo-time-input` 44px + font 16 |
| P-10 | `.dispo-type-btn.selected-off` sur `--light-bg` → état sélectionné peu distinctif | Moyen | 🟠 U-05 backlog |

### 2.5 pointage.html
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| ~~PT-01~~ | ~~Shifts déjà validés sans état visuel "terminé"~~ | Haut | ✅ Done — `validated-card` + badge `✓ Validé` |
| ~~PT-02~~ | ~~Impossible de modifier une heure réelle déjà saisie depuis pointage.html~~ | Haut | ✅ Done — patron/directeur peuvent ré-éditer, établissement verrouillé |
| ~~PT-03~~ | ~~Pas de total des heures du soir affiché en bas de page~~ | Moyen | ✅ Done — `total-footer` (réel / planifié + nb shifts pointés) |
| ~~PT-04~~ | ~~Écart badge sans couleur différenciée (positif / négatif)~~ | Moyen | ✅ Done — déjà en place (`.pos` vert, `.neg` orange, `.zero` gris) |
| ~~PT-05~~ | ~~Inputs heures + bouton Valider débordent sur mobile portrait~~ | Moyen | ✅ Done — déjà en place (media query 600px : 52px + flex-wrap) |
| ~~PT-06~~ | ~~Heure de bascule (9h) non indiquée — date "hier" inexpliquée~~ | Moyen | ✅ Done — bandeau `session-banner` quand date active = veille |
| ~~PT-07~~ | ~~`.btn-save` utilise `var(--dark-surface)` au lieu de `var(--accent)`~~ | Moyen | ✅ Done (U-01) — bg accent + hover accent-soft |
| ~~PT-08~~ | ~~`.validated-badge` couleurs en dur (`#6EE7B7`, `#d1fae5`, `#065f46`)~~ | Faible | ✅ Done (U-02) — migré vers tokens success/validated/gap-under |

### 2.6 performance.html (Patron / Directeur — pilotage économique)
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| ~~PF-01~~ | ~~Calendrier `repeat(7, 1fr)` illisible sur 360 px (cases ~51 px)~~ | Haut | ✅ Done (D-49) — `repeat(7, 64px)` + `overflow-x:auto` + `scroll-snap` < 480 px |
| ~~PF-02~~ | ~~Table 7 colonnes sans scroll horizontal → débordement mobile~~ | Haut | ✅ Done (D-49) — `overflow-x:auto` sur `.table-wrap` + `min-width:640px` table |
| ~~PF-03~~ | ~~`.cal-nav` 30×30 px sous seuil tactile 44 px~~ | Moyen | ✅ Done (D-49) — 44×44 px |
| PF-04 | `.targets-form` (3 inputs + bouton) wrap instable 360-400 px (pas de `min-width` par groupe) | Moyen | 🟠 U-03 backlog |
| PF-05 | `.kpi-sub` 11 px font-weight 400 → contraste / hiérarchie faible sur fond clair | Faible | 🟠 U-04 backlog |
| PF-06 | `.day-card.empty` couleurs en dur (`#fffbf0`, `#b45309`) au lieu de `--warning-*` | Cosmétique | 🟡 U-08 backlog |

### 2.7 politique-confidentialite.html
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| PC-01 | Logo 34×34 vs standard 28×28 + pas de breakpoint tablette (saute desktop → mobile à 600 px) | Cosmétique | 🟡 U-07 backlog |

---

## 3. Priorités recommandées

| Prio | ID | Action | Page | Statut |
|---|---|---|---|---|
| ~~🔴 Haut~~ | ~~PT-01~~ | ~~État visuel "validé" sur les cartes pointage~~ | pointage.html | ✅ Done |
| ~~🔴 Haut~~ | ~~PT-02~~ | ~~Édition heure réelle depuis pointage.html — patron/directeur uniquement (établissement = saisie unique verrouillée après enregistrement)~~ | pointage.html | ✅ Done |
| ~~🔴 Haut~~ | ~~P-03~~ | ~~Onglet pointage actif sur le shift du jour même si lendemain~~ | planning.html | ✅ Done |
| ~~🟡 Moyen~~ | ~~I-01~~ | ~~Header mobile allégé — tout dans le drawer~~ | index.html | ✅ Done |
| ~~🟡 Moyen~~ | ~~PT-05~~ | ~~Layout mobile inputs heures pointage~~ | pointage.html | ✅ Done |
| ~~🟡 Moyen~~ | ~~PT-03~~ | ~~Footer récap heures totales~~ | pointage.html | ✅ Done |
| ~~🟡 Moyen~~ | ~~S-01~~ | ~~Toggle voir mot de passe sur set-password~~ | set-password.html | ✅ Done |
| 🟢 Faible | L-01 | Dédoublonnage logo login | login.html | |
| ~~🟢 Faible~~ | ~~PT-04~~ | ~~Couleur différenciée sur l'écart badge~~ | pointage.html | ✅ Done |

---

## 4. Palette — tokens à ajouter (non prioritaire)

```css
/* Responsable */
--gold:             #F5A623;
--gold-bg:          #FFF8EC;
--gold-text:        #7C4E00;
--gold-glow:        rgba(245,166,35,0.20);

/* Shifts extra */
--extra:            #0EA5E9;
--extra-bg:         #E0F2FE;
--extra-text:       #0C4A6E;

/* Joker */
--joker:            rgba(108,99,255,0.55);
--joker-bg:         rgba(108,99,255,0.07);

/* Shift validé pointage */
--validated:        #059669;
--validated-bg:     #ECFDF5;
--validated-border: #6EE7B7;

/* Écart horaire */
--gap-over:         #10b981;
--gap-over-bg:      #D1FAE5;
--gap-under:        #F97316;
--gap-under-bg:     #FFF7ED;
--gap-exact:        #8892a4;

/* Nuit tardive */
--night:            #E8A045;
--night-bg:         rgba(232,160,69,0.10);

/* Joker ouvert au staff (F-06) */
--joker-open:        #534AB7;
--joker-open-bg:     #f0effe;   /* dégradé : #f0effe 0% → #e8e4ff 100% */
--joker-open-border: #c5beff;
--joker-open-applied:#27ae60;   /* bouton "✅ Candidature envoyée" */
```

Actions associées :
- Remplacer `#f0c040` hardcodé (👑 responsable) par `var(--gold)` dans script.js / style.css
- Remplacer `#95a5a6` (joker) par `var(--joker)`
- Supprimer les `:root` doublons dans login.html et set-password.html, importer style.css

---

## 5. Flux utilisateur — frictions identifiées

- **Staff** : deadline dispos vendredi 13h non affichée sur planning.html
- **Staff** : shifts passés inaccessibles (P-06)
- ~~**Patron** : export heures mensuelles absent (F-04 backlog)~~ — ✅ Livré (export Excel `.xlsx`, ex-CSV — D-52)
- ~~**Établissement** : shifts validés vs non-validés non différenciés (PT-01)~~ — ✅ Livré (`validated-card` + badge)
