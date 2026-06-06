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
│   ├── utils.test.js           ← Helpers purs lib/utils.js (43 tests)
│   ├── shift-hours.test.js     ← Heures effectives d'un shift (6 tests, D-73)
│   ├── week.test.js            ← Lundi de semaine — weekStart + currentWeekStart (15 tests, D-74/D-75)
│   └── routes.test.js          ← Intégration HTTP — boot app + middlewares auth/DB sans Mongo (2 tests, D-82)
├── public/
│   ├── index.html              ← Interface patron/directeur
│   ├── planning.html           ← Interface staff
│   ├── pointage.html           ← Interface pointage (rôle etablissement)
│   ├── performance.html        ← Pilotage économique patron/directeur (CA, coeff, KPIs)
│   ├── politique-confidentialite.html  ← Page légale RGPD
│   ├── login.html              ← Page de connexion
│   ├── set-password.html       ← Activation / réinitialisation du mot de passe
│   ├── script.js               ← Logique côté patron (monolithique — voir contrainte)
│   ├── planning.js             ← Logique côté staff (externalisée de planning.html, D-80)
│   ├── pointage.js             ← Logique du pointage (externalisée de pointage.html, D-80)
│   ├── style.css               ← Styles globaux
│   ├── manifest.json           ← Manifest PWA
│   ├── sw.js                   ← Service Worker
│   ├── lib/                    ← Code isomorphe partagé navigateur/Node (modules UMD)
│   │   ├── shift-hours.js      ← Heures effectives d'un shift (D-73)
│   │   └── week.js             ← Lundi de semaine — weekStart + currentWeekStart (cutoff 6h), réexporté par lib/utils.js (D-74/D-75)
│   ├── vendor/                 ← Libs tierces auto-hébergées (pas de CDN runtime)
│   │   ├── jspdf.umd.min.js        ← Export PDF (D-51)
│   │   ├── html2canvas.min.js      ← Capture DOM pour PDF (D-51)
│   │   └── xlsx.full.min.js        ← SheetJS — export Excel récap mensuel (D-52)
│   ├── favicon.ico             ← Favicon (PNG 32px, D-81)
│   └── icons/                  ← Icônes PWA générées (#6C63FF + « T », D-81)
│       ├── icon-72.png         ← badge notifications push
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

`script.js` est la logique frontend côté patron (~7300 lignes). Il est volontairement gardé en un seul fichier pour la stabilité actuelle. Ne pas refactoriser en modules ni découper en plusieurs fichiers sans décision architecturale explicite. Ajouter toute nouvelle logique côté patron à l'intérieur de ce fichier.

### 3.4 Frontend — aucun outillage de build

Il n'y a ni bundler, ni transpileur, ni gestionnaire de paquets pour le frontend. Tout le code frontend est du ES2020+ pur servi en fichiers statiques. Ne pas introduire d'outillage frontend npm (Webpack, Vite, React, etc.) sans décision architecturale explicite.

### 3.5 API / auth contournent toujours le cache du Service Worker

Le Service Worker (`sw.js`) utilise Network First pour les routes `/api/*` et `/auth/*`. Les assets statiques utilisent Cache First. Ne jamais mettre en cache les réponses API dans le Service Worker.

### 3.6 Les helpers purs vivent dans `lib/utils.js`

Tout ce qui est pur (sans dépendance Express/Mongo/réseau) doit être dans `lib/utils.js` pour être testable isolément. Exports actuels : `isValidObjectId`, `hashToken`, `normalizePhone`, `computeActiveDate`, `toDateStr`, `weekStart`, `currentWeekStart`, `WEEK_CUTOFF_HOUR`, `disposWeekStart`, `isAutoPublished`, `isDatePublished`, `chargeMultiplier` (dont `weekStart`/`currentWeekStart` réexportés depuis `public/lib/week.js`). Ajouter les nouveaux helpers purs ici plutôt qu'en inline dans `server.js`.

**Logique partagée navigateur + Node** : quand un helper doit être consommé par le **front** (servi en statique) ET testé sous Node, il ne peut pas vivre dans `lib/utils.js` (le navigateur ne fait pas de `require`). On utilise alors un **module UMD** sous `public/lib/` : il s'expose en global navigateur (`window.X`) via `<script src>` et reste `require()`-able en Node pour les tests. Exemples : `public/lib/shift-hours.js` (`window.ShiftHours`) + `tests/shift-hours.test.js` ; `public/lib/week.js` (`window.Week.weekStart`) + `tests/week.test.js`. Côté HTML, déléguer depuis une fonction de même nom pour préserver le hoisting sans toucher les call sites existants. **Si le helper existait déjà côté Node** (ex. `weekStart`), `lib/utils.js` le **ré-exporte** depuis le module UMD → source unique, call sites serveur inchangés (cf. D-73/D-74, gabarit des extractions futures).

### 3.7 En production `SESSION_SECRET` est obligatoire

`server.js` effectue un hard-crash au démarrage en production (`NODE_ENV=production`) si `SESSION_SECRET` est manquant — un fallback connu n'est pas acceptable car les sessions deviendraient falsifiables. En développement, un placeholder stable est utilisé avec un avertissement clair.

### 3.8 Trust proxy en production

Railway termine le TLS au niveau de son proxy. `app.set('trust proxy', 1)` est activé en production pour que `cookie.secure: true` soit honoré et que `req.ip` reflète le client, et non le proxy.

### 3.9 Semaine « en cours » — cutoff de bascule (D-75)

La plupart des fermetures se terminent vers 2h du matin. Un shift de fermeture est stocké à la **date de la veille** (`end_time` ≥ 24, ex. 26 = 2h). Pour que « cette semaine » contienne encore ce shift entre lundi 00:00 et 06:00, deux fonctions **distinctes** vivent dans `public/lib/week.js` :

- `weekStart(date)` — lundi de la semaine d'une **date calendaire**. Sert au mapping shift→semaine, à la publication, aux regroupements. **Jamais** de cutoff (sinon un shift daté un lundi basculerait à tort dans la semaine précédente).
- `currentWeekStart(now, cutoff = WEEK_CUTOFF_HOUR)` — lundi de la semaine **opérationnelle à l'instant présent** : avant `cutoff` (défaut **6h**) le lundi, on rattache à la veille. À utiliser uniquement pour « quelle semaine est-on **maintenant** » (planning par défaut, base de l'historique, flux iCal, vue patron, calendrier performance).

`WEEK_CUTOFF_HOUR = 6` est centralisé dans `public/lib/week.js` (ajustable simplement, ou branchable sur un réglage via le paramètre `cutoff`). **Indépendant** du `cutoff_hour` du pointage (9h, session quotidienne). Les traitements lancés à 10h (crons de purge) sont post-cutoff → non concernés.

---

## 4. Authentification & autorisation

### Session
- `express-session` avec un `CustomMongoStore` basé sur la collection `sessions`
- **TTL 30 jours glissant** (`SESSION_TTL_MS`), cookie `httpOnly`, `secure` en production. `rolling: true` + méthode `touch()` du store → l'expiration (cookie **et** champ `expires` en base) repart à chaque visite : déconnexion seulement après 30 j d'**inactivité** (D-70). Modifier la durée uniquement via la constante `SESSION_TTL_MS` pour garder cookie et store synchronisés.
- La session contient : `_id`, `email`, `phone`, `role`, `staff_id`, `assigned_establishments`, `establishment_id`, `name`

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
  "hourly_rate_snapshot": "number | null (€/h figé au pointage si mode horaire)",
  "fixed_rate_snapshot":  "number | null (forfait € figé au pointage si mode forfait)",
  "pointage_resp": true,
  "extra": true
}
```
- `is_joker: true` ou `staff_id: '__joker__'` = créneau ouvert (pas de détection de conflit, visible par le staff de l'établissement)
- `joker_open: true` = le patron a ouvert ce Joker aux candidatures staff (notif push envoyée, bloc « Créneau disponible » visible côté staff)
- `joker_candidates[]` = liste horodatée des staff ayant cliqué « Je suis disponible » — vidée à l'assignation ou la fermeture
- `note` = note libre saisie par le patron sur un Joker (visible aussi par le staff assigné après conversion)
- `real_start` / `real_end` = heures réelles saisies au pointage
- `hourly_rate_snapshot` / `fixed_rate_snapshot` = copie du taux (mode horaire OU forfait, mutuellement exclusifs) figée au premier pointage — stabilise les calculs Performance historiques même si le mode/taux du staff change ensuite. Exactement un des deux est non-null pour un shift pointé d'un staff rémunéré.
- `pointage_resp: true` = ce shift désigne un responsable de soirée pour l'établissement/date (plusieurs possibles, ex : 1 responsable matin + 1 responsable soir)
- `extra: true` = shift créé directement au pointage (non planifié à l'avance)

### `staff` — champs de rémunération
- `hourly_rate: number | null` — taux horaire en €/h brut
- `fixed_rate: number | null` — forfait fixe en € brut **par shift** (pas par soirée : si le staff fait 2 shifts dans la même soirée sur 2 établissements, le forfait s'applique 2×)
- **Mutual exclusion (Option A, appliquée côté serveur)** : un seul mode actif à la fois.
  - `hourly_rate` défini + `fixed_rate` null → mode horaire (`wage = hours × hourly_rate`)
  - `fixed_rate`  défini + `hourly_rate` null → mode forfait (`wage = fixed_rate`)
  - Les deux null → wage = 0 (affiché « — »)
- ⚠️ **Effet de bord à connaître** : `PATCH /api/staff/:id` force automatiquement l'autre champ à `null` dès qu'on définit l'un à une valeur non-null — **même si l'appelant n'a envoyé que le champ qu'il modifie**. Concrètement, le bulk import « 💶 Import taux » (qui n'envoie que `hourly_rate`) bascule silencieusement un staff en mode horaire en effaçant son `fixed_rate` éventuel. C'est intentionnel : garantit l'invariant « un seul mode actif » sur tous les call sites présents et futurs sans dupliquer la garde côté client.

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
- `{ key: 'dispo', open_day, custom_deadline, force_open, force_open_staff[], notif_sent_open_week, notif_sent_j2, notif_sent_j1 }` — paramétrage des dispos + état des rappels push envoyés. `force_open_staff` = tableau de `staff_id` autorisés à (re)soumettre malgré la deadline (réouverture individuelle E-15) ; chaque `staff_id` est retiré automatiquement à sa prochaine soumission réussie
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
> ⚠️ Toutes les routes `/api/shift-swaps/*` sont commentées via deux blocs `/* */` dans `server.js` (actuellement lignes 2488→2724 et 2811→2875 — repérer par le marqueur `F-05 — DÉSACTIVÉ`, les n° bougent quand le fichier grossit). **Ne jamais insérer de nouvelles routes à l'intérieur de ces blocs** — c'est un piège qui a déjà coûté un debug long (les routes Joker s'y étaient retrouvées par erreur, ne se chargeaient pas, 404 silencieux).

---

## 6. Architecture Web Push

1. Le frontend s'abonne via `navigator.serviceWorker` + `PushManager.subscribe()` en utilisant la clé publique VAPID
2. L'objet d'abonnement est envoyé au backend et stocké dans `push_subscriptions`
3. Le backend envoie via `webpush.sendNotification()` à l'intérieur de `sendPushToStaff(staffIds, payload)`
4. Les notifications de mise à jour de shift sont debouncées à 60 secondes (`scheduleShiftNotif`) pour éviter le spam pendant un drag/resize
5. Le handler `push` du Service Worker affiche la notification ; le handler `notificationclick` ouvre / met au premier plan la page cible

### Garde « pas de notification pour un shift passé » (B-10)

Aucun push lié à un shift n'est envoyé si la date du shift est strictement antérieure à aujourd'hui (`shift.date < toDateStr(new Date())`). La comparaison est lexicographique sur le format `'YYYY-MM-DD'` (cf. §3.1 — toujours `toDateStr()`, jamais `toISOString()`). Couvre `POST /api/shifts`, `PATCH /api/shifts/:id`, `PATCH /api/shifts/:id/transfer`, `PATCH /api/shifts/:id/joker-open`, `DELETE /api/shifts/:id`, `PATCH /api/publish/:weekStart` (filtre sur `date >= max(weekStart, today)`). **Ne s'applique pas** aux notifications hors-shift : rappels dispos, notifications in-app patron (`createNotifForPatrons` reste déclenché même pour un shift passé).

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
- **Portée** — **71 tests, 4 suites**. *Unitaires* : `tests/utils.test.js` (48 — cutoff 0/pile/bascule mois-année, padding de dates, téléphones, tokens, ObjectId, `isAutoPublished`/`isDatePublished` dont non-match d'une semaine adjacente), `tests/shift-hours.test.js` (6 — heures effectives réel/planifié, pointage partiel sans mélange, `real_start=0`, shift de nuit ; cf. D-71/D-73) et `tests/week.test.js` (15 — `weekStart` : lundi/dimanche/mercredi, bascule mois & année, idempotence, copie défensive ; `currentWeekStart` : cutoff hebdo 6h, lundi avant/après cutoff ; cf. D-74/D-75). *Intégration* : `tests/routes.test.js` (2 — D-82) démarre l'app sur un port éphémère et tape des routes **sans Mongo** (`GET /auth/me` → 401 sans session ; `GET /api/establishments` → 503 via `checkDB`).
- **App importable (D-82)** — `server.js` exporte `app` et n'appelle `app.listen()` / `connectDB()` que sous `if (require.main === module)`. Le test force `NODE_ENV=test` + un `MONGO_URI`/`SESSION_SECRET` factices **avant** le `require` (jamais de connexion à la vraie base ; `dotenv` ne réécrit pas les vars déjà définies). Le `setInterval` du rate-limiter est `.unref()` pour ne pas bloquer la sortie du process. Pour tester une route **avec données**, il faudra un faux `db` injectable (pas encore en place) — prérequis à étendre avant R-04.
- **Commande** — `npm test` liste explicitement les fichiers (`node --test tests/utils.test.js tests/shift-hours.test.js tests/week.test.js tests/routes.test.js`). ⚠️ **Ne pas** repasser au mode répertoire `node --test tests/` : non fiable selon la version Node (il tente de charger `tests` comme un module → `MODULE_NOT_FOUND`).
- **CI** — `.github/workflows/ci.yml` sur `push`/`PR` vers `main`. Matrice Node 20.x + 22.x. Étapes : `npm ci` → syntax check (`node -c` sur server.js, script.js, init-db.js) → `npm test`.

**Ajouter un test quand** : on extrait un helper pur vers `lib/`, on change une règle de date/heure, ou on corrige un bug qui pourrait régresser.

---

## 14. Synchronisation agenda — flux iCal (D-72)

> ⚠️ **DÉSACTIVÉE en prod (D-83)** — flag `CALENDAR_ENABLED` (défaut `false`, ou env `CALENDAR_ENABLED=true`). Routes `/api/calendar*` → 404, carte client masquée (flag jumeau dans `public/planning.js`). Code conservé. Réactiver : flipper les **deux** flags. Raison : synchro iCal non temps réel (jusqu'à ~1 h), pas assez fiable — à roder avant remise en prod.

Permet au staff d'ajouter son planning à **Google Agenda / Apple Calendrier / Outlook** via un abonnement iCal. Réglage **unique** côté utilisateur, puis l'agenda se rafraîchit tout seul → plus besoin de se connecter pour consulter ses horaires.

### Principe
- **Abonnement iCal (webcal/https)**, pas d'OAuth ni d'API par fournisseur → universel (Google/Apple/Outlook) et sans autorisation tierce.
- Chaque staff a un **token secret** stocké en clair sur son document `users` : `calendar_token` (capability **lecture seule**, faible sensibilité). Généré paresseusement au 1ᵉʳ appel de `GET /api/calendar-url`.

### Routes
- `GET /api/calendar-url` *(auth)* — crée le `calendar_token` si absent, renvoie `{ url, webcal }` (mêmes URL en `https://` et `webcal://`). Domaine : **`PUBLIC_BASE_URL`** (override dédié) > **`APP_URL`** (déjà utilisée pour les liens email/SMS) > **hôte de la requête** (zéro-config Railway). Préfixe `https://` garanti (la conversion `webcal://` en dépend). En pratique, définir `APP_URL` suffit pour tout ; `PUBLIC_BASE_URL` ne sert qu'à forcer un domaine différent pour les `.ics`.
- `GET /api/calendar/:token([a-f0-9]+).ics` *(**public** — le token authentifie)* — renvoie un `text/calendar`. **Lecture seule**, n'expose que les shifts du staff propriétaire du token, pour la **semaine en cours + les semaines futures publiées** (auto pour la semaine courante, flag `publish_<weekStart>` pour les futures). Filtrage par groupes cohérent avec `/api/my-shifts`, Jokers exclus.

### Génération du `.ics`
- En-têtes `VCALENDAR` + bloc `VTIMEZONE` **Europe/Paris** complet (règles DST CET/CEST) ; les `DTSTART`/`DTEND` sont émis en heure locale avec `TZID=Europe/Paris`.
- Conversion `(date 'YYYY-MM-DD' + heure décimale)` → horodatage local par **arithmétique entière** (`icsLocalDateTime`) : gère le passage minuit (`end_time ≥ 24` → jour suivant) **sans jamais dépendre du fuseau du serveur** (cf. §3.1).
- `UID` stable par shift (`shift-<_id>@templyo`), texte échappé (`icsEscape`).

### Limites connues (documentées pour le support)
- La synchro **n'est pas instantanée** : c'est l'agenda client qui vient chercher le flux. Apple ≈ 15 min–1 h (réglable), **Google ≈ 8–24 h** (ignore largement `REFRESH-INTERVAL`). Non forçable côté serveur.
- Un compte **sans `staff_id`** (ex. directeur) ne peut pas générer de flux (400) → suivi C-01 du backlog (masquer la carte UI).
- Le token donne accès en lecture aux horaires : compromis normal d'un flux sans login.
