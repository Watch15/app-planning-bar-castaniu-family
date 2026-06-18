# 🛠️ Méthode de travail & CI/CD — Templyo

> Document d'analyse : qu'est-ce qu'on fait *réellement* aujourd'hui (preuves à
> l'appui), et où sont les marges d'amélioration. Basé sur l'état du dépôt au
> 2026-06-18. À relire quand le process change.

---

## 1. Notre méthode de travail : c'est de l'agile *léger*, pas du Scrum

### Verdict
**Kanban / flux continu sous cadre documentaire BMAD**, piloté par un développeur
solo assisté d'agents IA. Ce n'est **ni du Scrum**, ni du waterfall.

### Preuves dans le dépôt
| Indice | Ce qu'on observe | Ce que ça implique |
|---|---|---|
| `docs/` = PRD + architecture + backlog + ux-design | Jeu de docs **BMAD** (« Documentation agents BMAD ») | Cadre agile *AI-driven* : la spec vit dans les docs, pas dans des tickets externes |
| `docs/backlog.md` | **Un backlog unique priorisé** P1/P2/P3 + « Déjà livré » + « Reste à faire » | Gestion de flux à la Kanban (pull du plus prioritaire), pas d'itérations fermées |
| IDs typés `B-`/`E-`/`F-`/`D-`/`R-`/`C-`/`U-` | Bugs, Enhancements, Features, Done/Décisions, Refacto, Corrections, UX | Traçabilité fine, chaque item a un contexte + une décision |
| « Sprint mai 2026 », « Sprint juin 2026 » | **Lots thématiques mensuels**, pas de dates de début/fin ni de ceremonies | « Sprint » au sens marketing, pas au sens Scrum (pas de time-box, pas de vélocité) |
| D-xx avec justification (ex. D-83, D-75) | **Décisions d'architecture documentées** au fil de l'eau | Pratique proche d'un mini-ADR (Architecture Decision Record) embarqué |
| Politique « pas de réécriture big-bang » (backlog §Reste à faire) | Refactor **incrémental opportuniste** (modèle D-73) | Lean : on réduit la dette par petites extractions testées |
| Branches `dev` → `main` (merge/rebase), fork `castanui` | Trunk léger : intégration sur `dev`, promotion vers `main` | Pas de Git Flow lourd (pas de `release/*`, `hotfix/*` formels) |

### Comment ça se traduit concrètement
1. Un besoin/bug entre dans `backlog.md` avec un ID et une priorité.
2. On le traite (souvent en binôme dev + agent IA), code + test si pertinent.
3. Commit conventionnel (`feat:`/`fix:`/`perf:`/`docs:`) sur `dev`.
4. L'item passe en « ✅ Done » avec un D-xx qui **documente la décision** et le commit.
5. `dev` → `main` (rebase pour garder un historique linéaire), push → déploiement Railway.

### Ce qui est sain
- Backlog vivant et **honnête** (les features désactivées F-05/F-09 sont tracées, pas cachées).
- **Décisions documentées** : un nouvel arrivant comprend le *pourquoi*, pas juste le *quoi*.
- Refactor maîtrisé, contraintes critiques écrites noir sur blanc (`architecture.md` §3).

### Ce qui manque pour « mûrir » la méthode
- Pas de **Definition of Done** explicite (quand un item est-il vraiment fini ? test ? doc ? déployé ?).
- Pas de distinction nette **work-in-progress** : le backlog mélange « à faire », « en cours », « fait » dans des tableaux séparés mais sans colonne *Doing* ni limite de WIP.
- Le suivi vit **dans un fichier Markdown** : zéro automatisation (pas d'issues GitHub liées aux commits, pas de board).

---

## 2. CI/CD : on a une vraie CI + un CD découplé (donc *pas* un pipeline CI/CD intégré)

### Verdict
- ✅ **CI réelle** mais **minimale** : GitHub Actions.
- ✅ **CD réel** : Railway déploie automatiquement depuis GitHub.
- ⚠️ **Les deux ne sont pas chaînés** : Railway déploie sur `git push` **sans attendre que la CI soit verte**. On a donc « CI + auto-deploy » côté à côté, **pas** un pipeline CI/CD où le déploiement est *gardé* par les tests.

### Preuves
| Élément | Source | Constat |
|---|---|---|
| `.github/workflows/ci.yml` | déclenché `push`/`PR` sur `main` | `npm ci` → `node -c` (syntax) → `npm test`. **Aucune étape `deploy`.** |
| Matrice Node 20.x + 22.x | `ci.yml` | Bon point : compat multi-version testée |
| « Railway (déploiement auto depuis GitHub) » | `README.md` l.19 | Le CD est géré **par Railway**, hors GitHub Actions |
| `%%BUILD_TIME%%` remplacé au `npm start` | `README.md` l.207/357 | Invalidation de cache PWA au déploiement — déjà automatisée |
| Pas de `Procfile`/`Dockerfile`/`railway.toml` | racine du repo | Railway utilise l'auto-détection (Nixpacks) — config implicite |
| `GET /health` (ping Mongo + uptime) | `architecture.md` §10 | Healthcheck en place pour le liveness Railway |

### Schéma de ce qui se passe aujourd'hui
```
                 ┌─ GitHub Actions CI ──► tests (informatif seulement)
git push main ──►│
                 └─ Railway webhook ─────► build + deploy PROD (ne lit pas la CI)
```
> Le risque concret : un commit qui **casse les tests** est quand même **déployé en prod**
> par Railway, en parallèle de la CI qui vire au rouge. La CI protège la PR, pas la prod.

### Niveau de maturité (auto-évaluation)
| Capacité | État | Note /5 |
|---|---|---|
| Build automatisé | ✅ Railway | 4 |
| Tests automatisés en CI | ✅ mais peu de couverture (4 suites, surtout `lib/`) | 2.5 |
| Lint / qualité statique | ❌ seulement `node -c` (syntaxe), pas d'ESLint | 1 |
| Déploiement automatisé | ✅ Railway auto | 4 |
| **Déploiement *gardé* par la CI** | ❌ découplé | 1 |
| Environnement de staging | ❌ pas de preview/staging documenté | 1 |
| Rollback | ⚠️ via redeploy Railway manuel | 2 |
| Secrets gérés | ✅ variables Railway, jamais commitées | 4 |
| Observabilité | ✅ morgan + Sentry conditionnel + `/health` | 3.5 |

---

## 3. Axes d'amélioration — priorisés

> Format aligné sur `backlog.md` (P1 = à faire en premier). Effort indicatif : 🟢 faible · 🟡 moyen · 🔴 élevé.

### P1 — Fermer le trou « prod déployée même si CI rouge »
| ID | Action | Effort | Bénéfice |
|---|---|---|---|
| CD-01 | **Garder le déploiement par la CI.** Soit activer dans Railway « Wait for CI to pass before deploy » (check GitHub), soit déclencher le deploy *depuis* GitHub Actions (Railway CLI / deploy hook) **après** le job `test`. | 🟢 | La prod ne reçoit plus un commit cassé |
| CD-02 | **Protéger `main`** (GitHub branch protection) : exiger la CI verte + 1 review avant merge. Aujourd'hui le rebase/push direct sur `main` est possible. | 🟢 | Empêche un push direct non testé |
| CD-03 | **Étendre la CI à `dev`** (actuellement `branches: [main]` seulement) : tester avant même la promotion vers `main`. | 🟢 | Feedback plus tôt dans le flux |

### P2 — Élever la qualité statique et la couverture
| ID | Action | Effort | Bénéfice |
|---|---|---|---|
| CD-04 | **Ajouter ESLint** (config minimale) en étape CI — `node -c` ne détecte que les erreurs de syntaxe, pas les `==`, variables inutilisées, `await` oubliés, etc. | 🟡 | Attrape une classe entière de bugs |
| CD-05 | **Étendre les tests de routes** (le harnais D-82 existe déjà) : injecter un faux `db` pour tester les routes *avec données* — prérequis explicite avant le découpage `server.js` (R-04). | 🔴 | Dé-risque le refactor + protège les routes |
| CD-06 | **Cibler les chemins critiques en test** : `POST /api/dispos` (deadline + garde congé, cf. le bug récent), `/api/performance` (calcul masse salariale), `isDatePublished`. | 🟡 | Couvre la logique métier qui fait mal si elle casse |

### P3 — Industrialiser le process & l'environnement
| ID | Action | Effort | Bénéfice |
|---|---|---|---|
| CD-07 | **Environnement de staging Railway** + base Mongo dédiée : tester un déploiement réel avant la prod (le projet note « non testable en réel ici »). | 🟡 | Valide migrations/déploiement sans risque prod |
| CD-08 | **Smoke test post-déploiement** : un job qui `curl /health` après deploy et alerte si 503. | 🟢 | Détecte un déploiement KO en secondes |
| CD-09 | **Versionnage / CHANGELOG** : `package.json` est déjà en `3.0.0` mais pas de tags git ni de changelog. Taguer les releases sur `main`. | 🟢 | Rollback ciblé + traçabilité des mises en prod |
| CD-10 | **Dependabot / audit deps** (`npm audit` en CI) : 10 dépendances back, dont `express`, `helmet`, `mongodb` — surveiller les CVE. | 🟢 | Sécurité de la chaîne de dépendances |

### Côté méthode (process)
| ID | Action | Effort | Bénéfice |
|---|---|---|---|
| PR-01 | Écrire une **Definition of Done** courte en tête de `backlog.md` (code + test si logique + doc D-xx + déployé). | 🟢 | Critère partagé, fin de l'ambiguïté « c'est fini ? » |
| PR-02 | **Limite de WIP** : une colonne/section « En cours » avec max 1–2 items, pour éviter l'éparpillement. | 🟢 | Flux plus lisse, moins de branches en l'air |
| PR-03 | **Lier commits ↔ items** : déjà fait pour beaucoup de D-xx (colonne Commit). Le systématiser (ou passer à des issues GitHub) faciliterait l'audit. | 🟡 | Traçabilité automatique besoin→code |

---

## 4. Résumé exécutif

- **Méthode** : agile léger façon **Kanban + BMAD**, dev solo + IA. Saine et bien documentée ;
  lui manque surtout une *Definition of Done* et une limite de WIP pour être pleinement « Kanban ».
- **CI/CD** : une **CI** honnête (tests multi-Node) **et** un **CD** Railway automatique, mais
  **non chaînés** → la prod peut recevoir un commit que la CI rejette. **C'est le point n°1 à corriger**
  (CD-01/02), à très faible effort.
- **Le reste** (ESLint, couverture routes, staging, smoke test, tags) fait passer d'un
  « ça marche » artisanal à un pipeline industriel — par petites touches, cohérent avec
  la philosophie incrémentale déjà en place (modèle D-73).

---

*Généré le 2026-06-18. Si tu mets en place CD-01 (deploy gardé par la CI), reviens
mettre à jour le §2 et la grille de maturité.*
