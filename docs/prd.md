# Document d'Exigences Produit — Templyo

## 1. Objet

Templyo est une application web SaaS de planification du personnel multi-établissements, conçue pour un patron de bar/restaurant gérant plusieurs lieux et une équipe d'employés. Elle fournit une interface de planification complète pour le patron et une vue planning personnelle en lecture seule pour chaque membre du staff, accessible sur mobile sous forme de PWA.

---

## 2. Utilisateurs & Rôles

| Rôle | Description |
|---|---|
| `patron` | Super-admin. Accès complet à tous les établissements, tout le personnel, tous les paramètres. |
| `directeur` | Manager limité aux établissements qui lui sont assignés. Peut gérer le planning et le personnel de ses établissements. |
| `staff` | Employé. Accès en lecture seule à son planning et envoi de disponibilités. |
| `etablissement` | Compte par établissement pour le pointage sur place (`pointage.html`). |

---

## 3. Fonctionnalités principales

### 3.1 Authentification
- Connexion par e-mail ou téléphone + mot de passe (bcryptjs, 12 rounds)
- Sessions côté serveur stockées dans MongoDB (TTL 7 jours, cookie httpOnly)
- Invitation par e-mail via l'API Resend — lien d'activation valable 24h
- Réinitialisation du mot de passe par lien e-mail (expiration 1h)
- Lien manuel de repli si l'envoi d'e-mail échoue
- Limitation du débit : 10 tentatives par 15 minutes par IP

### 3.2 Planning multi-établissements (vue Patron / Directeur — `index.html`)

#### En-tête
- En-tête à deux niveaux : ligne d'actions (Staff, Comptes, Disponibilités, toggle, utilisateur, déconnexion) + ligne d'établissements scrollable
- Avatar utilisateur (initiale)
- Badge rouge sur le bouton Disponibilités lorsqu'il y a des envois en attente
- Mobile : le menu hamburger ouvre un drawer bottom-sheet

#### Navigation semaine
- Flèches Précédent / Suivant, bouton Aujourd'hui
- Deux vues : **Jour** (timeline) et **Semaine** (dashboard + agenda)

#### Cartes semaine
- 7 cartes cliquables (Lun → Dim)
- Pastilles de couleur représentant le personnel planifié par jour
- Aujourd'hui : bordure violette — Jour sélectionné : bordure noire — Vide : bordure rouge pointillée
- Alerte `!` si aucun staff au rôle `responsable` n'est planifié (lorsque des rôles responsables existent)

#### Timeline jour
- Glisser-déposer pour la planification par staff
- Snap à l'heure, redimensionnement gauche/droite
- Détection de conflits et chevauchements entre établissements
- Disponibilités confirmées affichées en fond semi-transparent
- Copier les shifts d'un jour vers d'autres jours de la semaine
- Bouton « Publier la semaine »

#### Barre staff
- Recherche par nom en temps réel
- Filtres de rôles dynamiques
- Staff avec établissement préféré affiché en premier avec badge ★
- Badge de rôle par carte (le rôle responsable prime)
- Glisser-déposer vers la timeline

### 3.3 Shifts Joker
Un **Joker** est un shift sans membre du personnel assigné (`staff_id: '__joker__'`, `is_joker: true`). Il représente un créneau ouvert à pourvoir.

- Les jokers sont exclus de la détection de conflits
- Les jokers apparaissent dans la vue staff afin qu'ils voient les créneaux ouverts dans leur établissement
- Un joker peut être converti en shift réel en assignant un membre du personnel (passe `is_joker: false`)
- Les jokers sont filtrés des listes de collègues et des statistiques
- Champ `note` libre (≤ 280 caractères) — visible par le staff une fois le joker assigné

#### 3.3.bis Joker ouvert au staff (système de candidatures)
Le patron peut choisir, shift par shift, d'**ouvrir un Joker aux candidatures du staff**.

- **Côté patron** :
  - Modale du Joker : toggle « 📢 Proposer au staff » (inactif par défaut)
  - Activation → `joker_open: true`, badge « 📢 Ouvert » sur le bloc timeline, push Web envoyé à tout le staff de l'établissement abonné
  - Liste des candidats horodatée (`HHhMM`), triée par ordre d'arrivée
  - Bouton « Assigner » par candidat → le Joker devient un shift normal, `joker_open` repasse à `false`, candidatures vidées
  - Désactivation manuelle → `joker_open: false`, candidatures vidées, pas de notification
  - Polling toutes les 30s sur la modale ouverte pour rafraîchir la liste
- **Côté staff** (planning.html, vues « Mon planning » et « Semaine prochaine »):
  - Bloc dédié « 📢 Créneau disponible » au-dessus du planning
  - Bouton « Je suis disponible » → POST candidature, désactivé immédiatement, devient « ✅ Candidature envoyée »
  - Pas de retrait possible depuis l'app

### 3.4 Notifications Web Push
- Push basé sur VAPID via la bibliothèque `web-push`
- Le Service Worker gère la réception push et affiche les notifications avec icône, badge, vibration
- Le clic sur la notification ouvre / met au premier plan la page concernée
- Abonnements staff stockés dans la collection `push_subscriptions` (abonnements périmés 410/404 supprimés automatiquement)
- Debounce : les notifications de mise à jour de shift sont envoyées 60 secondes après le dernier drag/resize pour éviter le spam
- Notifications in-app pour patron/directeur stockées dans la collection `notifications`

### 3.5 Gestion du personnel
- Couleur, nom, e-mail par personne
- Établissements préférés : le staff apparaît en premier dans la barre (★ doré)
- Attribution de rôles : badges cliquables regroupés en Responsable / Informatif
- Sauvegarde individuelle, suppression avec tous les shifts associés

### 3.6 Rôles
- Création libre de rôles avec nom et type
- **Responsable** : alerte visuelle sur le planning si absent d'un service
- **Informatif** : indication à destination du patron uniquement
- La suppression retire le rôle de tous les profils

### 3.7 Gestion des comptes
- Invitation du staff, directeur ou établissement par e-mail avec lien d'activation
- Liaison compte ↔ fiche staff
- Le patron peut réinitialiser le mot de passe de n'importe quel compte
- Suppression de compte

### 3.8 Disponibilités (côté Staff — `planning.html`)
- Le staff envoie ses disponibilités pour la semaine suivante ; deadline automatique vendredi 13h00
- Par jour : **Soir** (16h→2h), **Midi** (10h→17h), **Personnalisé**, **Indisponible**
- Note optionnelle par jour
- Bouton fixe « Envoyer mes disponibilités » en bas d'écran

### 3.9 Disponibilités (côté Patron)
La modale **Disponibilités** est organisée en 4 onglets accessibles depuis le header :
- **📋 En attente** — dispos envoyées par le staff à valider / rejeter (clic = création shift, choix de l'établissement)
- **🔄 À réaffecter** — dispos acceptées mais sans shift correspondant à la date (cross-établissement : si le staff travaille ailleurs ce jour-là, la dispo est considérée comme couverte et n'apparaît pas)
- **🔔 Sans dispo** — checklist des staff actifs avec login valide qui n'ont **pas** envoyé de dispo pour la semaine cible (toujours la semaine suivante, alignée avec `_disposWeekStart`)
- **📝 Notes** — notes hebdo libres du staff par semaine

Paramétrage global :
- Toggle ouvrir / fermer l'envoi des disponibilités (`force_open`)
- `open_day` : jour de la semaine où le rappel push « Dispos ouvertes » est envoyé (Trigger 1)
- `custom_deadline` : deadline configurable (défaut : vendredi 13h00)
- 3 rappels push automatiques quotidiens à 10h via `checkDispoRappels()` : Trigger 1 (ouverture le `open_day`), J-2, J-1
- Garde anti-doublon : `notif_sent_open_week` mémorise la `weekStart` cible — Trigger 1 ne part qu'une fois par semaine cible

### 3.10 Publication
- « Publier la semaine » rend le planning visible au staff
- Dépublication possible à tout moment

### 3.11 Vue Staff (`planning.html`)
- Stats : jours travaillés, shifts, total d'heures
- Jours travaillés : bordure colorée, établissement, horaires, durée, collègues
- Aujourd'hui : bordure violette
- Jours de repos : grille compacte 5 colonnes (pas de lignes vides)
- Semaine suivante visible si publiée

### 3.12 PWA
- Installable sur mobile sans App Store
- iOS (Safari) : Partager → Ajouter à l'écran d'accueil
- Android (Chrome) : Menu → Installer l'application
- Lancement plein écran ; le Service Worker met en cache les assets statiques (chargement instantané, mode partiellement hors-ligne)
- Les requêtes API/auth passent toujours par le réseau

### 3.13 Transfert de shift cross-établissement
Le patron peut **transférer un shift** vers un autre établissement / une autre date depuis la modale du shift.

- Route dédiée `PATCH /api/shifts/:id/transfer` ({ establishment_id, date })
- Notification push automatique au staff concerné (« 🔄 Shift transféré »)
- Conserve `staff_id`, `start_time`, `end_time` ; seuls `establishment_id` + `date` changent

### 3.14 Recherche insensible aux accents
La barre staff (sidebar patron) et la modale « Notes staff » ignorent désormais les accents et la casse.

- Helper client `normalizeStr()` : `toLowerCase()` + `normalize('NFD')` + retrait des diacritiques `[̀-ͯ]`
- « émilie » matche « emilie », « ÉMILIE », « Emilie », etc.

### 3.15 SMS (Twilio)
- Envoi SMS optionnel via l'API Twilio
- Normalisation des numéros mobiles français (06/07 → +336/+337)
- Nécessite les variables d'environnement `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`

### 3.16 Performance — Pilotage économique (`performance.html`)
Page dédiée au patron / directeur pour suivre la masse salariale vs CA par soirée.

- **Saisie du CA** : modale CA depuis le calendrier (clic sur un jour) ou depuis le header — collection `daily_revenue` (`{ establishment_id, date, revenue }`)
- **KPIs** : CA total, **Heures travaillées** (somme `real_end - real_start` des shifts pointés), Masse salariale brute, Masse salariale chargée + coefficients %
- **Vue calendaire** semaine par semaine : carte par jour avec CA + heures travaillées + coefficient brut. Code couleur : vert si coeff < `target_gross`, rouge sinon, orange si CA saisi mais aucun shift pointé
- **Table détaillée** : Date, CA, Heures, Masse brute, Coeff brut, Masse chargée, Coeff chargé — scrollable horizontalement sur mobile (min-width 640 px)
- **Détail par soirée** (ligne expandable) : staff, heures réelles, taux horaire, salaire brut + total ligne (heures + €)
- **Filtre période** : « Tout l'historique », « Cette semaine », « Ce mois ». Les périodes semaine/mois suivent **la semaine actuellement affichée dans le calendrier** (navigation ‹ ›). Navigation calendrier recharge automatiquement le tableau si la période est week/month
- **Paramètres** (section « ⚙️ Paramètres ») :
  - `target_gross` (objectif coefficient brut, défaut 30 %)
  - `target_charged` (objectif coefficient chargé, défaut 43 %)
  - `charge_rate` (taux de charges patronales, défaut 45 % → multiplicateur ×1,45 sur la masse brute)
- **Calcul** : `wage_bill_charged = wage_bill_gross × (1 + charge_rate/100)` — `charge_rate` lu dynamiquement depuis `settings.performance` (plus de valeur codée en dur)
- **Snapshot taux horaire** : chaque shift conserve `hourly_rate_snapshot` au moment du pointage pour stabiliser les calculs historiques même si le `hourly_rate` du staff change ultérieurement

### 3.17 Pointage avancé (`pointage.html`)
- Saisie des heures réelles (`real_start` / `real_end`) — patron/directeur peuvent ré-éditer, compte établissement verrouillé après enregistrement
- Badge « ✓ Validé » sur les shifts pointés (carte `validated-card`)
- Écart planifié vs réel coloré : `.pos` (vert, dépassement), `.neg` (orange, sous-réalisation), `.zero` (gris)
- Footer total soirée : réel / planifié + nombre de shifts pointés
- Heure de bascule du jour configurable (`pointage_settings.cutoff_hour`, défaut 9h00) — bandeau si date active = veille
- Ajout shift extra (non planifié) avec saisie directe nom + horaires

---

## 4. Collections MongoDB

| Collection | Contenu |
|---|---|
| `establishments` | Bars/restaurants avec horaires |
| `staff` | Membres (couleur, e-mail, établissements préférés, rôles) |
| `shifts` | Shifts planifiés (inclut le flag `is_joker`) |
| `users` | Comptes de connexion |
| `sessions` | Sessions actives (TTL auto) |
| `availabilities` | Disponibilités envoyées par le staff |
| `roles` | Rôles créés par le patron |
| `settings` | Paramètres (état d'ouverture des dispos, semaines publiées) |
| `push_subscriptions` | Endpoints d'abonnements Web Push par utilisateur |
| `notifications` | Notifications in-app pour patron/directeur |
| `staff_notifications` | Notifications in-app pour staff (planning.html) |
| `shift_swaps` | Demandes d'échange entre shifts (feature F-05 — **désactivée en attente validation client**, code conservé dans `server.js`) |
| `daily_revenue` | CA quotidien saisi par établissement (`{ establishment_id, date, revenue }`) — module Performance |

---

## 5. Variables d'environnement

| Variable | Usage |
|---|---|
| `MONGO_URI` | Chaîne de connexion MongoDB Atlas |
| `PORT` | Port du serveur (3000 par défaut) |
| `SESSION_SECRET` | Clé de signature des sessions Express — **requise en production** (hard-crash au démarrage si manquante) |
| `NODE_ENV` | `production` active cookies sécurisés, restriction CORS, `trust proxy` et exigence stricte de `SESSION_SECRET` |
| `APP_URL` | URL publique (utilisée pour CORS et les liens e-mail) |
| `RESEND_API_KEY` | Clé API Resend |
| `VAPID_PUBLIC_KEY` | Clé publique VAPID pour Web Push |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID pour Web Push |
| `VAPID_EMAIL` | E-mail de contact VAPID (par défaut `mailto:admin@planning-bar.fr`) |
| `TWILIO_ACCOUNT_SID` | SID du compte Twilio (optionnel) |
| `TWILIO_AUTH_TOKEN` | Token d'authentification Twilio (optionnel) |
| `TWILIO_FROM` | Numéro expéditeur Twilio (optionnel) |
| `SENTRY_DSN` | DSN du projet Sentry (optionnel — Sentry inactif si absent) |
| `SENTRY_TRACES` | Taux d'échantillonnage des traces Sentry, 0–1 (optionnel, défaut `0.1`) |

---

## 6. Hébergement

- **Plateforme** : Railway
- **Base de données** : MongoDB Atlas (`gestion_bar`)
