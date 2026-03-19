# Planning Bar

Application de gestion de plannings multi-établissements.

## Structure du projet

```
app-planning-bar/
├── server.js              ← Serveur Express (point d'entrée)
├── package.json
├── .env                   ← À créer (voir scripts/.env.example)
├── public/                ← Fichiers servis au navigateur
│   ├── index.html         ← App patron
│   ├── login.html         ← Page de connexion
│   ├── script.js
│   └── style.css
└── scripts/               ← Scripts CLI (jamais servis au client)
    ├── init-db.js         ← Initialise la base de données
    ├── create-patron.js   ← Crée le compte patron
    ├── seed.js            ← Insère des données de test
    └── .env.example       ← Modèle pour le fichier .env
```

## Installation

```bash
# 1. Installer les dépendances
npm install

# → Remplis MONGO_URI et SESSION_SECRET

# 3. Initialiser la base de données
npm run init

# 4. Créer le compte patron
npm run create-patron

# 5. (Optionnel) Insérer des données de test
npm run seed

# 6. Lancer le serveur
npm run dev
# → http://localhost:3000  (redirige vers /login.html)
```

## Commandes disponibles

| Commande               | Description                          |
|------------------------|--------------------------------------|
| `npm run dev`          | Serveur avec rechargement automatique |
| `npm start`            | Serveur en production                |
| `npm run init`         | Recrée les collections et les index  |
| `npm run create-patron`| Crée le compte patron en CLI         |
| `npm run seed`         | Insère des shifts de démonstration   |

## Variables d'environnement (.env)

```
MONGO_URI=mongodb+srv://...
PORT=3000
SESSION_SECRET=chaine-aleatoire-longue
NODE_ENV=development
```

## Rôles

- **patron** — accès complet (planning, staff, comptes)
- **staff** — lecture seule de son propre planning
