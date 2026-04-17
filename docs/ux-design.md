# UX Design — Templyo
**Statut : En cours — la plupart des items Haut/Moyen sont livrés ; voir `backlog.md` D-20→D-23 pour la trace commit.**
**Date : Avril 2026**

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

### 2.2 set-password.html
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| ~~S-01~~ | ~~Pas de toggle 👁 "voir le mot de passe"~~ | Moyen | ✅ Done — déjà en place (`btn-eye`) |
| S-02 | Pas d'indicateur de force du mot de passe | Faible | |
| ~~S-03~~ | ~~Token absent → message d'erreur sans bouton retour clair~~ | Moyen | ✅ Done — bouton "← Retour à la connexion" + champs masqués |

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

### 2.4 planning.html (Staff)
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| P-01 | Collègues en pastilles sans nom au tap mobile | Moyen | |
| P-02 | Delta heures uniquement textuel, pas de couleur sur mobile portrait | Faible | |
| ~~P-03~~ | ~~Onglet ⏱ Pointage actif seulement le jour J — disparu le lendemain~~ | Haut | ✅ Done — date de référence = date active (cutoff_hour) |
| ~~P-04~~ | ~~Bouton fixe "Envoyer" dispos couvre le dernier jour sur petits écrans~~ | Moyen | ✅ Done — spacer 96px + safe-area-inset-bottom |
| P-05 | Pas de confirmation visuelle post-envoi dispos au-delà du toast | Faible | |
| P-06 | Aucun moyen pour le staff de voir les shifts des semaines passées | Moyen | |

### 2.5 pointage.html
| # | Problème | Sévérité | Statut |
|---|---|---|---|
| ~~PT-01~~ | ~~Shifts déjà validés sans état visuel "terminé"~~ | Haut | ✅ Done — `validated-card` + badge `✓ Validé` |
| ~~PT-02~~ | ~~Impossible de modifier une heure réelle déjà saisie depuis pointage.html~~ | Haut | ✅ Done — patron/directeur peuvent ré-éditer, établissement verrouillé |
| ~~PT-03~~ | ~~Pas de total des heures du soir affiché en bas de page~~ | Moyen | ✅ Done — `total-footer` (réel / planifié + nb shifts pointés) |
| ~~PT-04~~ | ~~Écart badge sans couleur différenciée (positif / négatif)~~ | Moyen | ✅ Done — déjà en place (`.pos` vert, `.neg` orange, `.zero` gris) |
| ~~PT-05~~ | ~~Inputs heures + bouton Valider débordent sur mobile portrait~~ | Moyen | ✅ Done — déjà en place (media query 600px : 52px + flex-wrap) |
| ~~PT-06~~ | ~~Heure de bascule (9h) non indiquée — date "hier" inexpliquée~~ | Moyen | ✅ Done — bandeau `session-banner` quand date active = veille |

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
```

Actions associées :
- Remplacer `#f0c040` hardcodé (👑 responsable) par `var(--gold)` dans script.js / style.css
- Remplacer `#95a5a6` (joker) par `var(--joker)`
- Supprimer les `:root` doublons dans login.html et set-password.html, importer style.css

---

## 5. Flux utilisateur — frictions identifiées

- **Staff** : deadline dispos vendredi 13h non affichée sur planning.html
- **Staff** : shifts passés inaccessibles (P-06)
- ~~**Patron** : export heures mensuelles absent (F-04 backlog)~~ — ✅ Livré (export CSV)
- ~~**Établissement** : shifts validés vs non-validés non différenciés (PT-01)~~ — ✅ Livré (`validated-card` + badge)
