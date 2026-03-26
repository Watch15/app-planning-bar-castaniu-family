# Planning Bar

Application web de gestion de plannings pour bars et restaurants multi-établissements. Conçue pour un patron gérant plusieurs adresses et une équipe de staff, avec une vue dédiée pour chaque employé.

---

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | Node.js + Express 4 |
| Base de données | MongoDB Atlas (`gestion_bar`) |
| Auth | Sessions serveur + bcryptjs |
| Email | Resend API (HTTP) |
| Frontend | HTML5 / CSS3 / JS vanilla (zéro dépendance front) |
| Hébergement | Railway |
| Mobile | PWA (installable iOS & Android) |

---

## Structure du projet

```
app-planning-bar/
├── server.js                   ← Serveur Express (point d'entrée)
├── package.json
├── .env                        ← Variables d'environnement (à créer)
├── public/
│   ├── index.html              ← Interface patron
│   ├── planning.html           ← Interface staff
│   ├── login.html              ← Page de connexion
│   ├── set-password.html       ← Activation / reset mot de passe
│   ├── script.js               ← Logique patron
│   ├── style.css               ← Styles globaux
│   ├── manifest.json           ← PWA manifest
│   ├── sw.js                   ← Service Worker (cache offline)
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
└── scripts/
    ├── init-db.js              ← Initialise la base de données
    ├── create-patron.js        ← Crée le compte patron en CLI
    └── seed.js                 ← Insère des données de démonstration
```

---

## Installation

```bash
npm install
# Créer le fichier .env (voir section Variables d'environnement)
npm run init
npm run create-patron
npm run seed      # optionnel
npm run dev       # → http://localhost:3000
```

---

## Variables d'environnement (.env)

```env
MONGO_URI=mongodb+srv://...
PORT=3000
SESSION_SECRET=chaine-aleatoire-longue
NODE_ENV=production
RESEND_API_KEY=re_...
APP_URL=https://ton-app.railway.app
```

---

## Commandes

| Commande | Description |
|---|---|
| `npm run dev` | Serveur avec rechargement automatique |
| `npm start` | Serveur en production |
| `npm run init` | Recrée les collections et index MongoDB |
| `npm run create-patron` | Crée le compte patron en CLI |
| `npm run seed` | Insère des shifts de démonstration |

---

## Fonctionnalités

### Authentification

- Connexion email + mot de passe (bcryptjs, hash 12 rounds)
- Sessions serveur stockées en MongoDB (7 jours), cookie httpOnly
- Invitation par email via Resend API — lien d'activation 24h
- Réinitialisation de mot de passe par lien email (expire 1h)
- Fallback lien manuel si l'envoi email échoue
- Deux rôles : `patron` (accès complet) et `staff` (lecture seule)

---

### Vue patron (`index.html`)

#### Header
- Deux niveaux : actions en haut (Staff, Comptes, Dispos, toggle dispos, utilisateur, déconnexion) — établissements scrollables en dessous
- Avatar initiale de l'utilisateur connecté
- Badge rouge sur le bouton Dispos si des disponibilités sont en attente

#### Navigation semaine
- Flèches précédent / suivant, bouton Aujourd'hui
- Deux vues : **Jour** (timeline) et **Semaine** (tableau de bord + agenda)

#### Cards semaine
- 7 cards cliquables (lundi → dimanche)
- Points de couleur représentant le staff planifié ce jour
- Aujourd'hui : bordure violette — Jour sélectionné : bordure noire — Vide : bordure rouge pointillée
- Alerte `!` rouge si aucun responsable planifié ce jour (quand des rôles responsables existent)

#### Timeline (vue jour)
- Planning drag & drop par membre du staff
- Snap à l'heure, resize gauche/droite
- Détection des conflits et chevauchements entre établissements
- Dispos confirmées affichées en fond semi-transparent
- Copie d'un jour vers d'autres jours de la semaine
- Bouton "Publier la semaine"

#### Gestion du staff — onglet Membres
- Couleur, nom, email par personne
- Établissements préférentiels : le staff affecté apparaît en premier dans la barre (★ dorée)
- Affectation de rôles : badges cliquables groupés Responsable / Informatif
- Enregistrement individuel, suppression avec ses shifts

#### Gestion du staff — onglet Rôles
- Création libre de rôles avec nom et type
- **Responsable** : alerte visuelle sur le planning si absent d'un service
- **Informatif** : indication seulement côté patron
- Suppression d'un rôle (retiré de tous les profils)

#### Barre staff
- Recherche par nom en temps réel
- Filtres par rôle (pills dynamiques)
- Staff préférentiel affiché en premier avec ★
- Badge rôle sur chaque carte (priorité au responsable)
- Drag & drop vers la timeline

#### Gestion des comptes
- Invitation Staff ou Patron par email avec lien d'activation
- Liaison compte ↔ profil staff
- Reset de mot de passe par le patron
- Suppression de compte

#### Disponibilités côté patron
- Toggle ouverture / fermeture de la saisie
- Validation : choisir l'établissement et créer le shift automatiquement
- Refus en un clic

#### Publication
- "Publier la semaine" rend le planning visible côté staff
- Dépublication possible à tout moment

---

### Vue staff (`planning.html`)

#### Mon planning
- Stats : jours travaillés, shifts, heures totales
- Jours travaillés : bordure colorée, établissement, horaires, durée, collègues
- Aujourd'hui : bordure violette
- Jours de repos : grille compacte 5 colonnes (pas de lignes vides)
- Semaine suivante visible si publiée par le patron

#### Mes dispos
- Saisie pour la semaine suivante, deadline vendredi 13h automatique
- Par jour : **Soir** (16h→2h), **Midi** (10h→17h), **Personnalisé**, **Indisponible**
- Note optionnelle par jour
- Bouton "Envoyer mes dispos" fixe en bas d'écran

---

### PWA

Installable sur mobile sans App Store.

- **iOS (Safari)** : partage → "Sur l'écran d'accueil"
- **Android (Chrome)** : menu → "Installer l'application"

Lance en plein écran. Le Service Worker met en cache les assets statiques (chargement instantané, partiel hors ligne). Les données API passent toujours par le réseau.

---

## Collections MongoDB

| Collection | Contenu |
|---|---|
| `establishments` | Bars/restaurants avec horaires |
| `staff` | Membres (couleur, email, venues préférentiels, rôles) |
| `shifts` | Shifts planifiés |
| `users` | Comptes de connexion |
| `sessions` | Sessions actives (TTL automatique) |
| `availabilities` | Disponibilités soumises par le staff |
| `roles` | Rôles créés par le patron |
| `settings` | Paramètres (ouverture dispos, publication semaines) |

---

## Routes API

### Auth
| Méthode | Route | Accès |
|---|---|---|
| POST | `/auth/login` | Public |
| POST | `/auth/logout` | Authentifié |
| GET | `/auth/me` | Authentifié |
| POST | `/auth/set-password` | Public (token) |
| PATCH | `/auth/reset-password` | Public (token) |
| POST | `/auth/forgot-password` | Public |

### Comptes
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/users` | Patron |
| POST | `/api/users` | Patron |
| PATCH | `/api/users/:id/reset-password` | Patron |
| DELETE | `/api/users/:id` | Patron |

### Staff
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/staff` | Authentifié |
| POST | `/api/staff` | Patron |
| PATCH | `/api/staff/:id` | Patron |
| DELETE | `/api/staff/:id` | Patron |

### Établissements
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/establishments` | Authentifié |

### Shifts
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/shifts/:establishmentId/:date` | Authentifié |
| GET | `/api/week/:establishmentId?from=&to=` | Authentifié |
| GET | `/api/my-shifts?from=&to=` | Authentifié |
| POST | `/api/shifts` | Patron |
| PATCH | `/api/shifts/:id` | Patron |
| DELETE | `/api/shifts/:id` | Patron |
| POST | `/api/copy-day` | Patron |

### Disponibilités
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/dispo-settings` | Authentifié |
| PATCH | `/api/dispo-settings` | Patron |
| GET | `/api/dispos/mine?from=&to=` | Authentifié |
| POST | `/api/dispos` | Authentifié |
| GET | `/api/dispos/pending?from=&to=` | Patron |
| GET | `/api/dispos/count` | Patron |
| PATCH | `/api/dispos/:id/confirm` | Patron |
| PATCH | `/api/dispos/:id/reject` | Patron |
| GET | `/api/dispos/confirmed?from=&to=` | Patron |

### Publication
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/publish/:weekStart` | Authentifié |
| PATCH | `/api/publish/:weekStart` | Patron |

### Rôles
| Méthode | Route | Accès |
|---|---|---|
| GET | `/api/roles` | Authentifié |
| POST | `/api/roles` | Patron |
| DELETE | `/api/roles/:id` | Patron |

---

## Points techniques à ne pas casser

### Bug timezone
`toISOString()` retourne UTC. En UTC+2, minuit local = 22h UTC → décalage d'un jour. Tous les `toDateStr()` utilisent `getFullYear() / getMonth() / getDate()` (heure locale). **Ne jamais remplacer par `toISOString()`.**

### Sessions MongoDB
MongoDB 6+ ne supporte plus les callbacks. Le `CustomMongoStore` utilise exclusivement `.then().catch()`.

### Performance semaine
`currentShiftsWeek` est construit depuis `weekFullData` déjà en mémoire après son chargement — aucun fetch supplémentaire pour les points couleur des cards.