# Architecture technique — Templyo

## 1. Stack

| Couche | Technologie |
|---|---|
| Runtime | Node.js (LTS actuelle) |
| Framework | Express 4 |
| Base de données | MongoDB Atlas — base `gestion_bar` |
| Authentification | `express-session` + `bcryptjs` (12 rounds) |
| Headers de sécurité | `helmet` (CSP, HSTS, frame-ancestors, etc.) |
| Observabilité | `morgan` (logs d'accès HTTP), `@sentry/node` (conditionnel, activé si `SENTRY_DSN`) |
| Notifications push | `web-push` (VAPID) |
| E-mail | API Resend (HTTP fetch, pas de SDK) |
| SMS | API REST Twilio (HTTP fetch, pas de SDK) |
| Frontend | HTML5 / CSS3 / Vanilla JS — zéro dépendance frontend |
| PWA | Web App Manifest + Service Worker (`sw.js`) |
| Tests | `node --test` (runner intégré, zéro dépendance) |
| CI | GitHub Actions (matrice Node 20.x + 22.x) |
| Hébergement | Railway |

---

## 2. Structure du projet

```
app-planning-bar/
├── server.js                   ← Point d'entrée Express unique (monolithique)
├── package.json
├── .env                        ← Variables d'environnement (non commité)
├── .github/
│   └── workflows/
│       └── ci.yml              ← CI : npm ci + syntax check + tests (Node 20/22)
├── lib/
│   └── utils.js                ← Helpers purs (sans Express/Mongo) — testables isolément
├── tests/
│   └── utils.test.js           ← Suite node --test (20 tests)
├── public/
│   ├── index.html              ← Interface patron/directeur
│   ├── planning.html           ← Interface staff
│   ├── pointage.html           ← Interface pointage (rôle etablissement)
│   ├── performance.html        ← Pilotage économique patron/directeur (CA, coeff, KPIs)
│   ├── politique-confidentialite.html  ← Page légale RGPD
│   ├── login.html              ← Page de connexion
│   ├── set-password.html       ← Activation / réinitialisation du mot de passe
│   ├── script.js               ← Logique côté patron (monolithique — voir contrainte)
│   ├── style.css               ← Styles globaux
│   ├── manifest.json           ← Manifest PWA
│   ├── sw.js                   ← Service Worker
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── docs/                       ← Documentation agents BMAD
│   ├── prd.md
│   ├── architecture.md
│   ├── backlog.md
│   └── ux-design.md
└── scripts/
    ├── init-db.js              ← Initialise collections et indexes
    ├── create-patron.js        ← Crée un compte patron en CLI
    └── seed.js                 ← Insère des données de démo
```

---

## 3. Contraintes critiques

### 3.1 Fuseau horaire — NE JAMAIS utiliser `toISOString()`

`toISOString()` retourne l'heure UTC. En UTC+2, minuit local = 22h UTC → bug de décalage d'un jour.

**Règle** : toutes les chaînes de date doivent être construites avec les méthodes locales :
```js
// CORRECT
function toDateStr(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
}

// INTERDIT
d.toISOString().slice(0, 10)  // ← ne jamais faire ça
```

S'applique partout : frontend (script.js, planning.html, index.html) et backend (server.js).

### 3.2 Sessions MongoDB — promesses uniquement

MongoDB 6+ a abandonné le support des callbacks. Le `CustomMongoStore` dans `server.js` utilise exclusivement `.then().catch()` — jamais de callback passé directement aux méthodes du driver.

```js
// CORRECT
db.collection('sessions').findOne({ sid })
    .then(doc => { ... })
    .catch(err => cb(err));

// INTERDIT
db.collection('sessions').findOne({ sid }, (err, doc) => { ... })
```

### 3.3 `script.js` — monolithique, ne pas découper

`script.js` est la logique frontend côté patron (~6800 lignes). Il est volontairement gardé en un seul fichier pour la stabilité actuelle. Ne pas refactoriser en modules ni découper en plusieurs fichiers sans décision architecturale explicite. Ajouter toute nouvelle logique côté patron à l'intérieur de ce fichier.

### 3.4 Frontend — aucun outillage de build

Il n'y a ni bundler, ni transpileur, ni gestionnaire de paquets pour le frontend. Tout le code frontend est du ES2020+ pur servi en fichiers statiques. Ne pas introduire d'outillage frontend npm (Webpack, Vite, React, etc.) sans décision architecturale explicite.

### 3.5 API / auth contournent toujours le cache du Service Worker

Le Service Worker (`sw.js`) utilise Network First pour les routes `/api/*` et `/auth/*`. Les assets statiques utilisent Cache First. Ne jamais mettre en cache les réponses API dans le Service Worker.

### 3.6 Les helpers purs vivent dans `lib/utils.js`

Tout ce qui est pur (sans dépendance Express/Mongo/réseau) doit être dans `lib/utils.js` pour être testable isolément. Exports actuels : `isValidObjectId`, `hashToken`, `normalizePhone`, `computeActiveDate`, `toDateStr`. Ajouter les nouveaux helpers purs ici plutôt qu'en inline dans `server.js`.

### 3.7 En production `SESSION_SECRET` est obligatoire

`server.js` effectue un hard-crash au démarrage en production (`NODE_ENV=production`) si `SESSION_SECRET` est manquant — un fallback connu n'est pas acceptable car les sessions deviendraient falsifiables. En développement, un placeholder stable est utilisé avec un avertissement clair.

### 3.8 Trust proxy en production

Railway termine le TLS au niveau de son proxy. `app.set('trust proxy', 1)` est activé en production pour que `cookie.secure: true` soit honoré et que `req.ip` reflète le client, et non le proxy.

---

## 4. Authentification & autorisation

### Session
- `express-session` avec un `CustomMongoStore` basé sur la collection `sessions`
- TTL 7 jours, cookie `httpOnly`, `secure` en production
- La session contient : `_id`, `email`, `phone`, `role`, `staff_id`, `assigned_establishments`, `name`

### Hiérarchie des rôles

```
patron          → super-admin, accès illimité
directeur       → limité aux assigned_establishments[], peut gérer le planning
staff           → lecture seule, son planning + envoi de disponibilités
etablissement   → accès pointage uniquement (pointage.html)
```

Middlewares :
- `requireAuth` — tout utilisateur authentifié
- `requirePatron` — patron ou directeur
- `requireAdmin` — patron uniquement
- `requireEtablissement` — etablissement uniquement
- `canAccessEstablishment(user, id)` — patron passe outre, directeur vérifie `assigned_establishments`

### Limitation du débit
Rate limiter en mémoire basé sur `Map` (aucune dépendance externe). Login : 10 tentatives / 15 min / IP. La Map est nettoyée toutes les heures pour éviter les fuites mémoire.

---

## 5. Modèle de données (collections clés)

### `shifts`
```json
{
  "_id": ObjectId,
  "staff_id": "string | '__joker__'",
  "staff_name": "string",
  "establishment_id": "string",
  "date": "YYYY-MM-DD",
  "start_time": "number (heure décimale, ex. 18.5)",
  "end_time": "number (peut être ≥ 24 pour shifts de nuit)",
  "color": "#hex",
  "is_joker": false,
  "note": "string ≤ 280 (Joker uniquement)",
  "joker_open": false,
  "joker_candidates": [
    {
      "staff_id": "string",
      "staff_name": "string",
      "staff_color": "#hex",
      "submitted_at": "ISODate"
    }
  ],
  "real_start": "number (pointage)",
  "real_end": "number (pointage)",
  "hourly_rate_snapshot": "number (€/h figé au moment du pointage)",
  "pointage_resp": true,
  "extra": true
}
```
- `is_joker: true` ou `staff_id: '__joker__'` = créneau ouvert (pas de détection de conflit, visible par le staff de l'établissement)
- `joker_open: true` = le patron a ouvert ce Joker aux candidatures staff (notif push envoyée, bloc « Créneau disponible » visible côté staff)
- `joker_candidates[]` = liste horodatée des staff ayant cliqué « Je suis disponible » — vidée à l'assignation ou la fermeture
- `note` = note libre saisie par le patron sur un Joker (visible aussi par le staff assigné après conversion)
- `real_start` / `real_end` = heures réelles saisies au pointage
- `hourly_rate_snapshot` = copie du `hourly_rate` du staff au moment du pointage — stabilise les calculs Performance historiques même si le taux du staff change ensuite
- `pointage_resp: true` = ce shift désigne le responsable de soirée pour l'établissement/date (un seul par soirée)
- `extra: true` = shift créé directement au pointage (non planifié à l'avance)

### `push_subscriptions`
```json
{
  "_id": ObjectId,
  "user_id": "string",
  "subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
}
```
Les abonnements périmés (410/404 du service push) sont supprimés automatiquement.

### `notifications`
```json
{
  "_id": ObjectId,
  "user_id": "string",
  "type": "string",
  "message": "string",
  "establishment_id": "string",
  "read": false,
  "created_at": ISODate
}
```
Notifications in-app destinées au patron/directeur.

### `staff_notifications`
```json
{
  "_id": ObjectId,
  "staff_id": "string",
  "message": "string",
  "read": false,
  "created_at": ISODate
}
```
Notifications in-app destinées au staff (max 20 dernières non lues retournées par `/api/notifications/mine`).

### `daily_revenue`
```json
{
  "_id": ObjectId,
  "establishment_id": "string",
  "date": "YYYY-MM-DD",
  "revenue": "number (€)"
}
```
CA quotidien saisi par le patron / directeur depuis `performance.html`. Une entrée par couple `(establishment_id, date)`. Sert de dénominateur pour le coefficient de masse salariale.

### `settings` — documents clés
Collection polymorphe (clé `key` discriminante) :
- `{ key: 'dispo', open_day, custom_deadline, force_open, notif_sent_open_week, notif_sent_j2, notif_sent_j1 }` — paramétrage des dispos + état des rappels push envoyés
- `{ key: 'performance', target_gross, target_charged, charge_rate }` — objectifs coefficient + taux de charges patronales appliqué dans `/api/performance` (remplace l'ancienne valeur 1.45 codée en dur)
- `{ key: 'pointage', cutoff_hour }` — heure de bascule du jour pour `pointage.html` (défaut 9h)
- `{ key: 'publish_<YYYY-MM-DD>', published: true }` — une entrée par semaine publiée par le patron (clé = lundi de la semaine)
- `{ key: 'lock_dispos_<YYYY-MM-DD>' }` — verrouillage de la saisie dispos pour une semaine

### `shift_swaps` *(feature F-05 — code livré mais désactivée en attente validation client)*
```json
{
  "_id": ObjectId,
  "from_shift_id": "string",
  "to_shift_id": "string",
  "from_staff_id": "string",
  "to_staff_id": "string",
  "from_establishment_id": "string",
  "to_establishment_id": "string",
  "status": "pending | approved | rejected",
  "note": "string",
  "created_at": ISODate,
  "decided_at": ISODate,
  "decided_by": "string"
}
```
> ⚠️ Toutes les routes `/api/shift-swaps/*` sont commentées via deux blocs `/* */` dans `server.js` (lignes 2186→2422 et 2488→2550). **Ne jamais insérer de nouvelles routes à l'intérieur de ces blocs** — c'est un piège qui a déjà coûté un debug long (les routes Joker s'y étaient retrouvées par erreur, ne se chargeaient pas, 404 silencieux).

---

## 6. Architecture Web Push

1. Le frontend s'abonne via `navigator.serviceWorker` + `PushManager.subscribe()` en utilisant la clé publique VAPID
2. L'objet d'abonnement est envoyé au backend et stocké dans `push_subscriptions`
3. Le backend envoie via `webpush.sendNotification()` à l'intérieur de `sendPushToStaff(staffIds, payload)`
4. Les notifications de mise à jour de shift sont debouncées à 60 secondes (`scheduleShiftNotif`) pour éviter le spam pendant un drag/resize
5. Le handler `push` du Service Worker affiche la notification ; le handler `notificationclick` ouvre / met au premier plan la page cible

---

## 7. PWA / Service Worker

- Nom du cache versionné avec le placeholder `%%BUILD_TIME%%` (remplacé au déploiement)
- Évènement install : met en cache `/login.html`, `/set-password.html`, `/script.js`, `/style.css`, `/manifest.json`
- Évènement activate : supprime tous les caches sauf la version courante
- Stratégie fetch :
  - `/api/*`, `/auth/*` → Network only (503 JSON en échec)
  - Reste → Cache First, fallback réseau, fallback `/login.html`
- `message: 'skipWaiting'` force l'activation immédiate du SW après mise à jour

---

## 8. E-mail (Resend)

POST HTTP direct vers `https://api.resend.com/emails`. Pas de SDK. Expéditeur : `Templyo <onboarding@resend.dev>`. Lève une erreur sur réponse non-OK avec le message d'erreur de Resend.

---

## 9. SMS (Twilio)

POST HTTP direct vers l'API REST Twilio. Pas de SDK. Normalisation des numéros français : `06XXXXXXXX` → `+336XXXXXXXX`. Fonctionnalité optionnelle — lève une erreur proprement si les variables d'environnement sont absentes.

---

## 10. Déploiement (Railway)

- `npm start` lance `node server.js`
- `npm run dev` utilise `node --watch` pour le hot reload
- Fichiers statiques servis depuis `public/` via `express.static`
- `sw.js` servi avec les headers `Service-Worker-Allowed: /` et `Cache-Control: no-cache`
- Tous les secrets via les variables d'environnement Railway (jamais commités)
- `app.set('trust proxy', 1)` en production pour que `cookie.secure: true` fonctionne derrière le proxy Railway

### Healthcheck
`GET /health` retourne `{ ok, db, uptime }`. Utilisé par le liveness Railway et le monitoring externe. N'expose aucune donnée sensible ; retourne 503 si le ping MongoDB échoue.

---

## 11. Headers de sécurité (helmet)

`helmet()` est appliqué globalement avec une CSP adaptée à la stack :

| Directive | Sources autorisées | Pourquoi |
|---|---|---|
| `default-src` | `'self'` | verrouillage par défaut |
| `script-src`  | `'self'`, `'unsafe-inline'` | balises `<script>` inline encore utilisées (année dynamique, etc.) |
| `style-src`   | `'self'`, `'unsafe-inline'`, `fonts.googleapis.com` | usage massif d'attributs `style=""` + `<style>` inline |
| `font-src`    | `'self'`, `fonts.gstatic.com`, `data:` | Google Fonts |
| `img-src`     | `'self'`, `data:`, `blob:` | avatars / canvas |
| `worker-src`  | `'self'` | Service Worker |
| `object-src`, `frame-ancestors` | `'none'` | pas de plugins / pas d'embedding |

`'unsafe-inline'` pourra être retiré une fois les styles/scripts inline extraits.

---

## 12. Observabilité

- **Logs d'accès** — `morgan` : format `combined` en production, format `dev` en local.
- **Erreurs** — `@sentry/node` est requis et initialisé **uniquement si** `SENTRY_DSN` est défini. `setupExpressErrorHandler` est branché après les routes. Un middleware catch-all journalise `req.method`, `req.url`, `err.message` pour les erreurs non gérées et retourne `500 { error: 'Erreur interne' }`.
- **Logging de repli** — `console.error` partout (repris par le flux de logs Railway).

---

## 13. Tests & CI

- **Runner** — `node --test` (intégré). Aucune dépendance de framework.
- **Portée** — `lib/utils.js` dispose de 20 tests couvrant les cas limites (cutoff 0/pile/bascule mois-année, padding de dates, téléphones, tokens déterministes, ObjectId hex strict).
- **Commande** — `npm test` exécute `node --test "tests/**/*.test.js"`.
- **CI** — `.github/workflows/ci.yml` sur `push`/`PR` vers `main`. Matrice Node 20.x + 22.x. Étapes : `npm ci` → syntax check (`node -c` sur server.js, script.js, init-db.js) → `npm test`.

**Ajouter un test quand** : on extrait un helper pur vers `lib/`, on change une règle de date/heure, ou on corrige un bug qui pourrait régresser.
