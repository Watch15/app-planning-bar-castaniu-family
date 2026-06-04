# Templyo

Application web SaaS de gestion de plannings pour bars et restaurants multi-établissements. Conçue pour un patron gérant plusieurs adresses et une équipe de staff, avec une vue dédiée pour chaque employé.

---

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | Node.js + Express 4 |
| Base de données | MongoDB Atlas (`gestion_bar`) |
| Auth | Sessions serveur + bcryptjs (12 rounds) |
| Email | Resend API (HTTP direct, pas de SDK) |
| SMS | Twilio API (HTTP direct, pas de SDK) |
| Notifications push | Web Push API — VAPID (`web-push`) |
| Frontend | HTML5 / CSS3 / JS vanilla — zéro dépendance front |
| Sécurité | helmet + CSP, morgan, Sentry conditionnel |
| Hébergement | Railway (déploiement auto depuis GitHub) |
| Mobile | PWA installable iOS & Android |
| Tests | `node --test` natif — zéro dépendance |
| CI | GitHub Actions — matrice Node 20/22 |

---

## Structure du projet

```
app-templyo/
├── server.js                      ← Serveur Express — toutes les routes API et auth (~3500 lignes)
├── package.json
├── .env                           ← Variables d'environnement (à créer, ne jamais commiter)
├── lib/
│   └── utils.js                   ← Helpers purs testables (isValidObjectId, hashToken, normalizePhone, computeActiveDate, toDateStr)
├── tests/
│   ├── utils.test.js              ← 43 tests node --test (helpers purs)
│   └── shift-hours.test.js        ← 6 tests — heures effectives d'un shift
├── .github/
│   └── workflows/
│       └── ci.yml                 ← CI : npm ci → syntax check → npm test (Node 20/22)
├── public/
│   ├── index.html                 ← Interface patron / directeur
│   ├── planning.html              ← Interface staff — planning + dispos + pointage responsable
│   ├── pointage.html              ← Interface compte établissement — saisie heures réelles
│   ├── performance.html           ← Pilotage économique patron/directeur — CA, coefficients, KPIs
│   ├── politique-confidentialite.html  ← Page légale RGPD
│   ├── login.html                 ← Page de connexion (email ou téléphone)
│   ├── set-password.html          ← Activation / réinitialisation mot de passe
│   ├── script.js                  ← Logique patron — planning, drag & drop, modales (~6800 lignes)
│   ├── style.css                  ← Styles globaux
│   ├── manifest.json              ← PWA manifest
│   ├── sw.js                      ← Service Worker — cache offline + Web Push
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
└── scripts/
    ├── init-db.js                 ← Initialise collections et indexes MongoDB
    ├── create-patron.js           ← Crée le compte patron en CLI
    └── seed.js                    ← Insère des données de démonstration
```

---

## Installation

```bash
npm install
# Créer le fichier .env (voir section Variables d'environnement)
npm run init
npm run create-patron
npm run seed      # optionnel — données de démo
npm run dev       # → http://localhost:3000
```

---

## Variables d'environnement (.env)

```env
# Obligatoire
MONGO_URI=mongodb+srv://...
SESSION_SECRET=chaine-aleatoire-longue-minimum-32-chars
NODE_ENV=production
APP_URL=https://ton-app.railway.app

# Email
RESEND_API_KEY=re_...

# SMS (optionnel — invitations et reset par téléphone)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+33...

# Web Push notifications (optionnel)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=mailto:admin@templyo.fr

# Monitoring (optionnel — Sentry inactif si absent)
SENTRY_DSN=https://...
SENTRY_TRACES=0.1

# Port (optionnel, défaut 3000)
PORT=3000
```

> ⚠️ `SESSION_SECRET` est **obligatoire en production** — le serveur refuse de démarrer sans elle.

---

## Commandes

| Commande | Description |
|---|---|
| `npm run dev` | Serveur avec rechargement automatique (`node --watch`) |
| `npm start` | Serveur en production (remplace `%%BUILD_TIME%%` dans sw.js au démarrage) |
| `npm run init` | Recrée les collections et indexes MongoDB |
| `npm run create-patron` | Crée le compte patron en CLI |
| `npm run seed` | Insère des shifts de démonstration |
| `npm test` | Lance les 49 tests unitaires (`node --test`, 2 suites) |

---

## Rôles utilisateurs

| Rôle | Description |
|---|---|
| `patron` | Super-admin — accès complet à tous les établissements et paramètres |
| `directeur` | Manager — limité aux établissements assignés |
| `staff` | Employé — lecture seule de son planning, envoi de disponibilités |
| `etablissement` | Compte par lieu — accès pointage uniquement (`pointage.html`) |

---

## Fonctionnalités

### Authentification
- Connexion email + mot de passe ou numéro de téléphone + mot de passe
- Sessions serveur MongoDB — TTL 30 jours **glissant** (renouvelé à chaque visite), cookie `httpOnly`
- Invitation par email (Resend) ou SMS (Twilio) — lien activation 24h
- Réinitialisation mot de passe par email ou SMS (expire 1h)
- Fallback lien manuel si l'envoi échoue
- Rate limiting : 10 tentatives / 15 min / IP

### Vue patron (`index.html`)
- Timeline drag & drop par membre du staff — snap 15 min, resize gauche/droite
- Détection conflits et chevauchements entre établissements
- Le Joker — shift non attribué avec note, visible du staff
- Copie d'un jour vers d'autres jours de la semaine
- Publication / dépublication de la semaine
- ~~Échange de shifts — demande staff à staff, validation patron avec raison~~ *(code livré mais désactivé en attente validation client — réactivable par retrait des `/* */` dans server.js)*
- Gestion staff : couleur, email, téléphone, rôles, établissements préférentiels
- Import en masse via CSV/tableau (nom + email ou téléphone)
- Gestion établissements dans l'app (modale CRUD)
- Disponibilités : toggle ouverture, deadline configurable (jour + heure), mode urgence
- Validation dispo → création shift automatique
- Récapitulatif mensuel planifié vs réel + export CSV
- Notifications in-app (badge + historique activité)

### Vue staff (`planning.html`)
- Mon planning : stats semaine/mois (toggle), jours travaillés, collègues, heures par établissement
- Onglet Historique : semaines passées (jusqu'à 5), heures **réelles** (sinon planifiées) + répartition par établissement
- **Synchro agenda** : abonnement iCal (Google / Apple / Outlook), synchro auto sans login après un réglage unique (semaines publiées)
- Mes dispos : Soir / Midi / Personnalisé / Indisponible + note par jour
- Onglet Pointage : saisie heures réelles pour les responsables de soirée
- Bouton Web Push — activation/désactivation des notifications

### Pointage (`pointage.html`)
- Interface dédiée au compte établissement
- Saisie et modification des heures réelles (real_start / real_end)
- Champs préremplis aux heures planifiées + saisie restreinte au quart d'heure
- Ré-édition possible par patron/directeur (établissement = verrouillé après enregistrement)
- Badge « ✓ Validé » + carte verte sur les shifts pointés
- Écart planifié vs réel coloré (vert/orange/gris)
- Footer total soirée : heures réelles vs planifiées + nb shifts pointés
- Ajout de staff non planifié (shift extra)
- Heure de bascule du jour configurable (`cutoff_hour`, défaut 9h) — bandeau si date active = veille

### Performance (`performance.html`)
- Saisie CA quotidien depuis le calendrier (modale CA)
- KPIs : CA total, heures travaillées, masse salariale brute/chargée + coefficients
- Calendrier hebdo : couleur par jour (vert si coeff < objectif, rouge sinon)
- Table détaillée + breakdown staff par soirée (heures, taux, salaire brut)
- Filtre période suit la semaine sélectionnée dans le calendrier
- Paramètres configurables : `target_gross`, `target_charged`, `charge_rate` (taux de charges patronales appliqué dynamiquement)
- Snapshot `hourly_rate_snapshot` sur chaque shift pour stabilité historique

### Web Push
- Notifications natives iOS/Android via VAPID
- Debounce 60s sur les modifications de shift (anti-spam drag/resize)
- Ciblage : uniquement le staff concerné par les changements
- Nettoyage automatique des abonnements expirés

### PWA
- Installable sans App Store — iOS (Safari) et Android (Chrome)
- Cache First sur les assets statiques, Network First sur l'API
- Cache auto-invalidé à chaque déploiement Railway via `%%BUILD_TIME%%`

---

## Collections MongoDB

| Collection | Contenu |
|---|---|
| `establishments` | Bars/restaurants avec horaires |
| `staff` | Membres (couleur, email, téléphone, venues préférentiels, rôles) |
| `shifts` | Shifts planifiés (inclut `is_joker`, `real_start`, `real_end`, `note`) |
| `users` | Comptes de connexion |
| `sessions` | Sessions actives (TTL 30 jours glissant) |
| `availabilities` | Disponibilités soumises par le staff |
| `roles` | Rôles créés par le patron (responsable / informatif) |
| `settings` | Paramètres polymorphes (clé `key`) : `dispo`, `performance`, `pointage`, `publish_<weekStart>`, `lock_dispos_<weekStart>` |
| `push_subscriptions` | Endpoints VAPID par utilisateur |
| `notifications` | Notifications in-app patron/directeur |
| `staff_notifications` | Notifications in-app staff (max 20 dernières non lues) |
| `shift_swaps` | Demandes d'échange de shifts *(routes désactivées en attente validation client — collection conservée)* |
| `daily_revenue` | CA quotidien saisi pour le module Performance |

---

## Routes API principales

### Auth
| Méthode | Route | Accès |
|---|---|---|
| POST | `/auth/login` | Public |
| POST | `/auth/logout` | Authentifié |
| GET | `/auth/me` | Authentifié |
| POST | `/auth/set-password` | Public (token invitation) |
| PATCH | `/auth/reset-password` | Public (token reset) |
| POST | `/auth/forgot-password` | Public |

### Comptes & Staff
| Méthode | Route | Accès |
|---|---|---|
| GET/POST | `/api/users` | Patron |
| POST | `/api/users/bulk` | Admin (import en masse) |
| PATCH | `/api/users/:id/reset-password` | Patron |
| DELETE | `/api/users/:id` | Patron |
| GET/POST | `/api/staff` | Authentifié / Patron |
| PATCH/DELETE | `/api/staff/:id` | Patron |

### Établissements
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/establishments` | Authentifié |
| POST | `/api/establishments` | Admin |
| PATCH/DELETE | `/api/establishments/:id` | Admin |

### Shifts & Pointage
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/shifts/:establishmentId/:date` | Authentifié |
| GET | `/api/week-full/:establishmentId` | Authentifié |
| GET | `/api/my-shifts` | Authentifié |
| POST | `/api/shifts` | Patron |
| PATCH/DELETE | `/api/shifts/:id` | Patron |
| PATCH | `/api/shifts/:id/transfer` | Patron — transfert cross-établissement |
| PATCH | `/api/shifts/:id/joker-open` | Patron — ouvrir un Joker aux candidatures staff |
| POST | `/api/shifts/:id/joker-candidature` | Staff — postuler sur un Joker ouvert |
| GET | `/api/shifts/joker-ouverts` | Authentifié — Jokers ouverts par établissement |
| POST | `/api/copy-day` | Patron |
| GET | `/api/pointage/:date` | Authentifié |
| PATCH | `/api/shifts/:id/pointage-resp` | Patron — désigner responsable de soirée |
| GET/PATCH | `/api/pointage-settings` | Authentifié / Admin — `cutoff_hour` |
| GET | `/api/recap-mensuel` | Patron |
| GET | `/api/calendar-url` | Authentifié — URL d'abonnement iCal du staff (génère le token) |
| GET | `/api/calendar/:token.ics` | **Public** (token = auth) — flux iCal lecture seule, semaines publiées |

### Disponibilités
| Méthode | Route | Accès |
|---|---|---|
| GET/PATCH | `/api/dispo-settings` | Authentifié / Patron |
| GET | `/api/dispos/mine` | Authentifié |
| GET | `/api/dispos/previous` | Authentifié |
| POST | `/api/dispos` | Authentifié |
| GET | `/api/dispos/pending` | Patron — onglet « 📋 En attente » |
| GET | `/api/dispos/count` | Patron — badge header |
| GET | `/api/dispos/non-affectees` | Patron — onglet « 🔄 À réaffecter » |
| GET | `/api/dispos/sans-dispo` | Patron — onglet « 🔔 Sans dispo » |
| GET/POST | `/api/dispos/week-note` | Authentifié — note hebdo libre du staff |
| GET | `/api/dispos/notes` | Patron — onglet « 📝 Notes » |
| PATCH | `/api/dispos/:id/confirm` | Patron |
| PATCH | `/api/dispos/:id/reject` | Patron |
| PATCH | `/api/dispos/:id/ignore` | Patron |
| POST | `/api/dispos/rappel` | Patron — envoi rappel push manuel |

### Performance / CA
| Méthode | Route | Accès |
|---|---|---|
| POST | `/api/revenue` | Authentifié — saisie CA quotidien |
| GET | `/api/revenue/:establishmentId/:date` | Authentifié |
| GET | `/api/performance` | Patron — agrégats par soirée (CA, masse sal., coeff, breakdown staff) |
| GET/PATCH | `/api/performance-settings` | Authentifié / Patron — `target_gross`, `target_charged`, `charge_rate` |

### Échanges de shifts *(routes désactivées en attente validation client — code conservé, commenté dans server.js)*
| Méthode | Route | Accès |
|---|---|---|
| POST | `/api/shift-swaps` | Authentifié |
| GET | `/api/shift-swaps/pending` | Patron |
| GET | `/api/shift-swaps/mine` | Authentifié |
| PATCH | `/api/shift-swaps/:id/approve` | Patron |
| PATCH | `/api/shift-swaps/:id/reject` | Patron |
| DELETE | `/api/shift-swaps/:id` | Authentifié |

### Web Push & Notifications
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/push/vapid-public-key` | Public |
| POST/DELETE | `/api/push/subscribe` | Authentifié |
| GET | `/api/notifications` | Patron |
| PATCH | `/api/notifications/read-all` | Patron |

### Infra
| Méthode | Route | Accès |
|---|---|---|
| GET | `/health` | Public — ping MongoDB + uptime |

---

## Règles techniques à ne jamais casser

### Timezone — jamais `toISOString()`
`toISOString()` retourne UTC. En UTC+2, minuit local = 22h UTC → décalage d'un jour.
Toujours utiliser les méthodes locales ou le helper `toDateStr()` de `lib/utils.js` :

```js
// ✅ Correct
function toDateStr(d) {
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

// ❌ Interdit
d.toISOString().slice(0, 10)
```

### `script.js` — monolithique, ne pas découper
`script.js` est volontairement gardé en un seul fichier (~4700 lignes) pour la stabilité. Ne pas refactoriser ni découper en modules sans décision architecturale explicite. Toute modification doit être **additive et ciblée**.

### Sessions MongoDB — promesses uniquement
MongoDB 6+ ne supporte plus les callbacks. Le `CustomMongoStore` utilise exclusivement `.then().catch()`.

### Cache Service Worker — ne pas toucher `%%BUILD_TIME%%`
`npm start` remplace ce token par `Date.now()` au démarrage Railway → invalidation automatique du cache à chaque déploiement.

### Helpers purs → `lib/utils.js`
Tout ce qui est testable sans Express/Mongo/réseau doit aller dans `lib/utils.js`. Ajouter un test dans `tests/utils.test.js` à chaque nouveau helper.

---

## Tests

```bash
npm test
# Lance : node --test tests/utils.test.js tests/shift-hours.test.js
# 49 tests (2 suites) — timezone, padding dates, téléphones, tokens, ObjectId,
# heures effectives d'un shift (réel/planifié, pointage partiel, shift de nuit)
```

La CI GitHub Actions tourne automatiquement sur chaque push/PR vers `main` (Node 20 + 22).