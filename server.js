process.env.TZ = 'Europe/Paris'; // doit être avant tout require de date — gère heure d'été/hiver
require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const session = require('express-session');
const crypto  = require('crypto');
const webpush = require('web-push');
const helmet  = require('helmet');
const morgan  = require('morgan');
const { isValidObjectId, hashToken, normalizePhone } = require('./lib/utils');

// Sentry — initialisation conditionnelle (ne se charge que si SENTRY_DSN fourni).
// Doit être importé AVANT de créer l'app Express pour que l'auto-instrumentation
// capture correctement les handlers.
const Sentry = process.env.SENTRY_DSN ? require('@sentry/node') : null;
if (Sentry) {
    Sentry.init({
        dsn:              process.env.SENTRY_DSN,
        environment:      process.env.NODE_ENV || 'development',
        tracesSampleRate: Number(process.env.SENTRY_TRACES || 0.1),
    });
    console.log('✅ Sentry activé');
}

const app = express();

// Derrière le reverse proxy Railway : nécessaire pour que cookies `secure:true`
// soient émis et que req.ip reflète l'IP client (pas celle du proxy).
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Sécurité — headers HTTP (helmet). CSP adaptée au stack : vanilla JS sans
// bundler, Google Fonts, Service Worker, pas de CDN externe.
// `unsafe-inline` sur style/script reste nécessaire tant qu'on n'a pas extrait
// les <style>/<script> inline des HTML et les style="" des templates JS.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'"],
            scriptSrcAttr:  ["'unsafe-inline'"],
            styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
            imgSrc:      ["'self'", 'data:', 'blob:'],
            connectSrc:  ["'self'"],
            workerSrc:   ["'self'"],
            manifestSrc: ["'self'"],
            objectSrc:   ["'none'"],
            frameAncestors: ["'none'"],
        },
    },
    // HSTS géré par Railway (proxy TLS) — on laisse helmet le poser quand même en prod.
    crossOriginEmbedderPolicy: false,  // évite de casser certains subresources PWA
}));

// Logs HTTP structurés (morgan). 'combined' en prod (format standard Apache),
// 'dev' en local (colorisé, concis).
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(express.json());

const allowedOrigin = process.env.NODE_ENV === 'production'
    ? process.env.APP_URL
    : true;
app.use(cors({ origin: allowedOrigin, credentials: true }));

// Sécurité : en prod, un SESSION_SECRET explicite est obligatoire.
// Sans ça, le fallback est connu et les sessions deviennent forgeables.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('❌ SESSION_SECRET manquant en production — refus de démarrer.');
    process.exit(1);
}

// ── VAPID — Web Push ──────────────────────────────────────────────────────────

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:admin@planning-bar.fr',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// ── Utilitaires sécurité ──────────────────────────────────────────────────────
// isValidObjectId / hashToken / normalizePhone sont importés de ./lib/utils

// Rate limiting simple en mémoire (pas de dépendance externe)
const rateLimitMap = new Map();
function rateLimit(key, maxAttempts, windowMs) {
    const now = Date.now();
    const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    rateLimitMap.set(key, entry);
    return entry.count > maxAttempts;
}
// Nettoyage toutes les heures pour éviter les fuites mémoire
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimitMap) { if (now > v.resetAt) rateLimitMap.delete(k); }
}, 60 * 60 * 1000);
app.use(express.static('public', {
    setHeaders: (res, path) => {
        if (path.endsWith('sw.js')) {
            res.setHeader('Service-Worker-Allowed', '/');
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

const client = new MongoClient(process.env.MONGO_URI);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('gestion_bar');
        console.log('✅ Connecté à MongoDB Atlas');
        scheduleDailyAt10();
    } catch (e) {
        console.error('❌ Connexion échouée :', e.message);
        process.exit(1);
    }
}

// ── Email via Resend ──────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
    const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
            'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            from:    'Templyo <noreply@templyo.fr>',
            to,
            subject,
            html,
        }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Erreur Resend');
    }
}

// ── SMS via Twilio ────────────────────────────────────────────────────────────

// Renvoie l'URL publique de l'app, en garantissant un préfixe https://
// (sinon les clients SMS iOS/Android ne rendent pas le lien cliquable)
function appUrl() {
    let u = process.env.APP_URL || 'http://localhost:3000';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.replace(/\/+$/, '');
}

async function sendSMS(to, body) {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_FROM;
    if (!sid || !token || !from) throw new Error('Twilio non configuré (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM manquants)');
    const res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json', {
        method:  'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
            'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Erreur Twilio');
    }
}

// ── Web Push — helper envoi ───────────────────────────────────────────────────

// Envoie une notification push à une liste de staff_ids (ou à tous si staffIds est null)
async function sendPushToStaff(staffIds, payload) {
    // Stocker la notif in-app indépendamment du push (fonctionne sans VAPID)
    if (db && Array.isArray(staffIds) && staffIds.length > 0 && payload.title && payload.body) {
        try {
            await db.collection('staff_notifications').insertMany(
                staffIds.map(id => ({
                    staff_id:   id,
                    type:       payload.tag || 'templyo-notif',
                    title:      payload.title,
                    body:       payload.body,
                    url:        payload.url || '/planning.html',
                    read:       false,
                    created_at: new Date(),
                }))
            );
        } catch (e) { console.error('❌ staff_notifications insert error:', e.message); }
    }

    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        console.warn('⚠️  Web Push ignoré : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non configurés');
        return;
    }
    try {
        // Récupérer les user_ids correspondant aux staff_ids
        let userQuery = {};
        if (staffIds && staffIds.length > 0) {
            userQuery = { staff_id: { $in: staffIds } };
        }
        const users = await db.collection('users').find(userQuery, { projection: { _id: 1 } }).toArray();
        const userIds = users.map(u => String(u._id));
        console.log(`📤 Push [${payload.tag || '?'}] → staffIds=${JSON.stringify(staffIds)} → ${users.length} user(s) trouvé(s)`);
        if (userIds.length === 0) {
            console.warn('⚠️  Push annulé : aucun user trouvé pour ces staff_ids');
            return;
        }

        const subs = await db.collection('push_subscriptions')
            .find({ user_id: { $in: userIds } })
            .toArray();
        console.log(`📤 Push → ${subs.length} subscription(s) trouvée(s)`);
        if (subs.length === 0) {
            console.warn('⚠️  Push annulé : aucune subscription — staff non abonnés ou clé périmée');
            return;
        }

        const payloadStr = JSON.stringify(payload);
        const stale = [];

        await Promise.allSettled(subs.map(async sub => {
            try {
                await webpush.sendNotification(sub.subscription, payloadStr);
                console.log(`✅ Push envoyé → user_id=${sub.user_id}`);
            } catch (err) {
                // 410 Gone = subscription expirée → à supprimer
                if (err.statusCode === 410 || err.statusCode === 404) {
                    stale.push(sub._id);
                    console.warn(`⚠️  Subscription expirée (${err.statusCode}) → suppression user_id=${sub.user_id}`);
                } else {
                    console.error('❌ Push error pour user', sub.user_id, ':', err.statusCode, err.message);
                }
            }
        }));

        // Nettoyage des subscriptions expirées
        if (stale.length > 0) {
            await db.collection('push_subscriptions').deleteMany({ _id: { $in: stale } });
        }
    } catch (e) {
        console.error('❌ sendPushToStaff error:', e.message);
    }
}


// ── Helpers semaine ───────────────────────────────────────────────────────────

// Retourne le lundi de la semaine contenant `date`
function _weekStart(date) {
    const d   = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0, 0, 0, 0);
    return d;
}

// La semaine en cours (et toutes les semaines passées) est considérée publiée automatiquement
function _isAutoPublished(shiftDateStr) {
    const shiftWeek   = _weekStart(new Date(shiftDateStr + 'T12:00:00'));
    const currentWeek = _weekStart(new Date());
    return shiftWeek <= currentWeek;
}

// ── Rappels automatiques dispos ───────────────────────────────────────────────

function _disposWeekStart(now) {
    // Reproduit getMondayOf(addDays(now, 7)) du client
    const d7 = new Date(now);
    d7.setDate(now.getDate() + 7);
    const day  = d7.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d7.setDate(d7.getDate() + diff);
    d7.setHours(0, 0, 0, 0);
    return d7;
}

async function checkDispoRappels() {
    if (!db) return;
    try {
        const settings = await db.collection('settings').findOne({ key: 'dispo' }) || {};
        if (settings.force_open) return;

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const dateStr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

        const todayStr = dateStr(now);
        const todayDay = now.getDay(); // 0=dim … 6=sam

        const deadline     = computeEffectiveDeadline(settings.custom_deadline || null, now);
        const deadlineFmt  = deadline.getDate() + '/' + (deadline.getMonth() + 1);
        const deadlineTime = String(deadline.getHours()).padStart(2,'0') + 'h' + String(deadline.getMinutes()).padStart(2,'0');

        const weekMonday = _disposWeekStart(now);
        const weekStart  = dateStr(weekMonday);
        const weekEndD   = new Date(weekMonday);
        weekEndD.setDate(weekMonday.getDate() + 6);
        const weekEnd = dateStr(weekEndD);

        const j2Date = new Date(deadline); j2Date.setDate(deadline.getDate() - 2);
        const j1Date = new Date(deadline); j1Date.setDate(deadline.getDate() - 1);
        const j2Str  = dateStr(j2Date);
        const j1Str  = dateStr(j1Date);

        // Helpers déduplication
        const alreadySentToday = (field) => {
            const d = settings[field];
            return d && dateStr(new Date(d)) === todayStr;
        };

        // Helper : staff sans dispo pour la semaine
        async function getTargetsWithoutDispo(allStaff) {
            const ids = allStaff.map(s => String(s._id));
            const existing = await db.collection('availabilities').find({
                staff_id: { $in: ids },
                date:     { $gte: weekStart, $lte: weekEnd },
                status:   { $in: ['pending', 'confirmed'] },
            }, { projection: { staff_id: 1 } }).toArray();
            const done = new Set(existing.map(d => d.staff_id));
            return allStaff.filter(s => !done.has(String(s._id)));
        }

        // ── Trigger 1 : ouverture ────────────────────────────────────────────
        const openDay = settings.open_day;
        if (openDay !== null && openDay !== undefined && todayDay === openDay && !alreadySentToday('notif_sent_open')) {
            const allStaff = await db.collection('staff').find({ can_submit_dispos: true }).toArray();
            const ids = allStaff.map(s => String(s._id));
            await sendPushToStaff(ids, {
                title:   'Templyo — Dispos ouvertes',
                body:    '📅 Les disponibilités sont ouvertes ! Envoie les tiennes avant le ' + deadlineFmt,
                tag:     'rappel-dispo',
                url:     '/planning.html#dispos',
                actions: [{ action: 'envoyer', title: 'Envoyer mes dispos' }],
            });
            await db.collection('settings').updateOne({ key: 'dispo' }, { $set: { notif_sent_open: now } });
            console.log('✅ Rappel ouverture dispos →', ids.length, 'membres');
        }

        // ── Trigger 2 : J-2 ─────────────────────────────────────────────────
        if (todayStr === j2Str && !alreadySentToday('notif_sent_j2')) {
            const allStaff = await db.collection('staff').find({ can_submit_dispos: true }).toArray();
            const targets  = await getTargetsWithoutDispo(allStaff);
            const msg      = '⚠️ Plus que 2 jours pour envoyer tes disponibilités !';
            if (targets.length > 0) {
                await sendPushToStaff(targets.map(s => String(s._id)), {
                    title: 'Templyo — Rappel dispos', body: msg, tag: 'rappel-dispo', url: '/planning.html#dispos',
                    actions: [{ action: 'envoyer', title: 'Envoyer mes dispos' }],
                });
            }
            await db.collection('settings').updateOne({ key: 'dispo' }, { $set: { notif_sent_j2: now } });
            console.log('✅ Rappel J-2 →', targets.length, 'membres');
        }

        // ── Trigger 3 : J-1 ─────────────────────────────────────────────────
        if (todayStr === j1Str && !alreadySentToday('notif_sent_j1')) {
            const allStaff = await db.collection('staff').find({ can_submit_dispos: true }).toArray();
            const targets  = await getTargetsWithoutDispo(allStaff);
            const msg      = '🔴 Dernier jour ! Envoie tes disponibilités avant ' + deadlineTime;
            if (targets.length > 0) {
                await sendPushToStaff(targets.map(s => String(s._id)), {
                    title: 'Templyo — Rappel dispos', body: msg, tag: 'rappel-dispo', url: '/planning.html#dispos',
                    actions: [{ action: 'envoyer', title: 'Envoyer mes dispos' }],
                });
            }
            await db.collection('settings').updateOne({ key: 'dispo' }, { $set: { notif_sent_j1: now } });
            console.log('✅ Rappel J-1 →', targets.length, 'membres');
        }
    } catch (e) {
        console.error('❌ checkDispoRappels error:', e.message);
    }
}

function scheduleDailyAt10() {
    const now   = new Date();
    const next10 = new Date(now);
    next10.setHours(10, 0, 0, 0);
    if (next10 <= now) next10.setDate(next10.getDate() + 1);
    const msUntil10 = next10 - now;
    setTimeout(() => {
        checkDispoRappels();
        setInterval(checkDispoRappels, 24 * 60 * 60 * 1000);
    }, msUntil10);
    console.log('⏰ Rappels auto dispos programmés — prochain check 10h00');
}

// ── Debounce notifications shift (évite le spam lors du drag/resize) ─────────

const _shiftNotifDebounce = new Map(); // shiftId → { timer, originalState }

// originalState = { _id, start_time, end_time, staff_id } — état du shift AVANT le premier PATCH
// Si le shift revient à cet état dans la fenêtre de debounce, aucune notif n'est envoyée.
function scheduleShiftNotif(shiftId, originalState, pushPayload, notifPatronFn) {
    let storedOriginal;
    if (_shiftNotifDebounce.has(shiftId)) {
        // Conserver l'état original du PREMIER PATCH de cette fenêtre
        storedOriginal = _shiftNotifDebounce.get(shiftId).originalState;
        clearTimeout(_shiftNotifDebounce.get(shiftId).timer);
    } else {
        storedOriginal = originalState;
    }
    // Programmer l'envoi après 60 secondes de silence
    const timer = setTimeout(async () => {
        _shiftNotifDebounce.delete(shiftId);
        try {
            // Relire l'état final et comparer à l'état initial : si identique → pas de notif
            if (storedOriginal && storedOriginal._id) {
                const finalShift = await db.collection('shifts').findOne({ _id: storedOriginal._id });
                if (finalShift &&
                    finalShift.start_time == storedOriginal.start_time &&
                    finalShift.end_time   == storedOriginal.end_time   &&
                    String(finalShift.staff_id) === String(storedOriginal.staff_id)) {
                    return; // Revenu à l'état initial — aucune notification
                }
            }
            await pushPayload();
            await notifPatronFn();
        } catch (e) {
            console.error('❌ scheduleShiftNotif error:', e.message);
        }
    }, 60 * 1000);
    _shiftNotifDebounce.set(shiftId, { timer, originalState: storedOriginal });
}

// ── Notifications in-app pour patron/directeurs ───────────────────────────────

// Crée une notification en base pour tous les patrons + directeurs concernés par un établissement
async function createNotifForPatrons(establishmentId, type, message, extra = {}) {
    try {
        // Récupérer tous les users patron + directeurs ayant accès à cet établissement
        const allUsers = await db.collection('users').find({
            role: { $in: ['patron', 'directeur'] },
        }, { projection: { _id: 1, role: 1, assigned_establishments: 1 } }).toArray();

        const targets = allUsers.filter(u => {
            if (u.role === 'patron') return true;
            const assigned = u.assigned_establishments || [];
            return assigned.includes(establishmentId);
        });

        if (targets.length === 0) return;

        const docs = targets.map(u => ({
            user_id:          String(u._id),
            type,
            message,
            establishment_id: establishmentId,
            read:             false,
            created_at:       new Date(),
            ...extra,
        }));
        await db.collection('notifications').insertMany(docs);
    } catch (e) {
        console.error('❌ createNotifForPatrons error:', e.message);
    }
}
// ── Session ───────────────────────────────────────────────────────────────────

function setupSession() {
    const MongoSessionStore = session.Store;

    class CustomMongoStore extends MongoSessionStore {
        constructor() { super(); }

        get(sid, cb) {
            if (!db) return cb(null, null);
            db.collection('sessions').findOne({ sid })
                .then(doc => {
                    if (!doc) return cb(null, null);
                    if (doc.expires < new Date()) { this.destroy(sid, () => {}); return cb(null, null); }
                    cb(null, doc.session);
                })
                .catch(err => cb(err));
        }

        set(sid, sessionData, cb) {
            if (!db) return cb(null);
            const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            db.collection('sessions').updateOne(
                { sid },
                { $set: { sid, session: sessionData, expires } },
                { upsert: true }
            ).then(() => cb(null)).catch(err => cb(err));
        }

        destroy(sid, cb) {
            if (!db) return cb && cb(null);
            db.collection('sessions').deleteOne({ sid })
                .then(() => cb && cb(null))
                .catch(err => cb && cb(err));
        }
    }

    app.use(session({
        secret:            process.env.SESSION_SECRET || 'dev-only-insecure-secret',
        resave:            false,
        saveUninitialized: false,
        store:             new CustomMongoStore(),
        cookie: {
            httpOnly: true,
            secure:   process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge:   7 * 24 * 60 * 60 * 1000,
        },
    }));
}

setupSession();

// ── Middlewares ───────────────────────────────────────────────────────────────

function checkDB(req, res, next) {
    if (!db) return res.status(503).json({ error: 'Base de données non disponible' });
    next();
}

function requireAuth(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    next();
}

// Accepte patron ET directeur (opérations courantes sur le planning)
function requirePatron(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    const role = req.session.user.role;
    if (role !== 'patron' && role !== 'directeur') return res.status(403).json({ error: 'Accès réservé au patron' });
    next();
}

// Admin uniquement (gestion établissements, invitation patrons)
function requireAdmin(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.session.user.role !== 'patron') return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    next();
}

// Vérifie qu'un patron a accès à un établissement donné (admin = bypass total)
function canAccessEstablishment(user, establishmentId) {
    if (user.role === 'patron') return true;
    const assigned = user.assigned_establishments || [];
    return assigned.includes(establishmentId);
}

// Vérifie si un staff est le responsable de pointage pour un établissement à une date donnée.
// Les rôles sont portés par le profil staff, pas par le shift.
// Règle : parmi les shifts de cet établissement/date dont le staff a un rôle 'responsable',
//         seul celui avec pointage_resp:true peut faire le pointage.
//         Si aucun n'est explicitement désigné, personne n'a accès.
async function isResponsablePourSoiree(staffId, establishmentId, date) {
    if (!staffId || !establishmentId || !date) return false;

    // Trouver les IDs de rôles de type 'responsable'
    const responsableRoles = await db.collection('roles').find({ type: 'responsable' }).toArray();
    const responsableIds   = responsableRoles.map(r => String(r._id));
    if (responsableIds.length === 0) return false;

    // Tous les shifts de cet établissement ce jour-là
    const allShifts = await db.collection('shifts').find({
        establishment_id: establishmentId,
        date,
        staff_id: { $ne: '__joker__' },
    }).toArray();
    if (allShifts.length === 0) return false;

    // Trouver les profils staff pour ces shifts
    const staffIds  = [...new Set(allShifts.map(s => s.staff_id))];
    const staffDocs = await db.collection('staff').find({
        $or: staffIds.filter(id => id && id.length === 24).map(id => ({ _id: new ObjectId(id) }))
    }).toArray();
    const staffMap  = {};
    staffDocs.forEach(s => { staffMap[String(s._id)] = s; });

    // Filtrer les shifts dont le staff a un rôle responsable
    const responsableShifts = allShifts.filter(shift => {
        const staffDoc  = staffMap[String(shift.staff_id)];
        const staffRoles = (staffDoc && staffDoc.roles) || [];
        return staffRoles.some(r => responsableIds.includes(r));
    });

    if (responsableShifts.length === 0) return false;

    // Quelqu'un est-il explicitement désigné pointage_resp ?
    const designated = responsableShifts.find(s => s.pointage_resp === true);
    if (!designated) return false;
    return String(designated.staff_id) === String(staffId);
}

// Compte établissement uniquement
function requireEtablissement(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.session.user.role !== 'etablissement') return res.status(403).json({ error: 'Accès réservé au compte établissement' });
    next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/auth/login', checkDB, async (req, res) => {
    const { email, phone, password } = req.body;
    if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
    if (!email && !phone) return res.status(400).json({ error: 'Email ou numéro de téléphone requis' });
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (rateLimit('login:' + ip, 10, 15 * 60 * 1000))
        return res.status(429).json({ error: 'Trop de tentatives, réessaie dans 15 min.' });
    try {
        let user = null;
        const errMsg = phone ? 'Numéro ou mot de passe incorrect' : 'Email ou mot de passe incorrect';

        if (phone) {
            const normalized = normalizePhone(phone);
            user = await db.collection('users').findOne({ phone: normalized });
        } else {
            user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
        }

        if (!user) return res.status(401).json({ error: errMsg });

        // Si ce compte n'a pas de mot de passe, chercher un compte jumeau
        // (même staff_id) qui en possède un — cas : compte phone + compte email séparés
        let authUser = user;
        if (!user.password_hash && user.staff_id) {
            const sibling = await db.collection('users').findOne({
                staff_id:      String(user.staff_id),
                password_hash: { $ne: null },
                _id:           { $ne: user._id },
            });
            if (sibling) authUser = sibling;
        }

        if (!authUser.password_hash) return res.status(401).json({ error: errMsg });

        const match = await bcrypt.compare(password, authUser.password_hash);
        if (!match) return res.status(401).json({ error: errMsg });

        // Session : données du compte trouvé par l'identifiant soumis,
        // complétées par le compte jumeau si certains champs manquent
        const merged = authUser !== user ? Object.assign({}, authUser, {
            _id:   user._id,
            email: user.email  || authUser.email  || null,
            phone: user.phone  || authUser.phone  || null,
        }) : user;
        req.session.user = {
            _id:                     String(merged._id),
            email:                   merged.email  || null,
            phone:                   merged.phone  || null,
            role:                    merged.role,
            staff_id:                merged.staff_id || null,
            name:                    merged.name || '',
            assigned_establishments: merged.assigned_establishments || [],
            establishment_id:        merged.establishment_id || null,
        };
        res.json({ message: 'Connecté', user: req.session.user });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Erreur déconnexion' });
        res.clearCookie('connect.sid');
        res.json({ message: 'Déconnecté' });
    });
});

// Envoyer un OTP par SMS (pour connexion ou récupération de compte)
app.get('/auth/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    res.json({ user: req.session.user });
});

// Activation compte via token invitation
app.post('/auth/set-password', checkDB, async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });
    if (password.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });
    try {
        // Cherche d'abord le token hashé (nouveaux comptes), puis en clair (anciens comptes)
        let user = await db.collection('users').findOne({ invite_token: hashToken(token) });
        if (!user) user = await db.collection('users').findOne({ invite_token: token });
        if (!user)                            return res.status(404).json({ error: 'Lien invalide' });
        if (user.invite_expires < new Date()) return res.status(410).json({ error: 'Lien expiré (24h)' });
        if (user.password_hash)               return res.status(409).json({ error: 'Compte déjà activé, utilise la connexion' });
        const hash = await bcrypt.hash(password, 12);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { password_hash: hash, active: true }, $unset: { invite_token: '', invite_expires: '' } }
        );
        res.json({ message: 'Mot de passe créé, tu peux te connecter' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset mot de passe via token (lien email)
app.patch('/auth/reset-password', checkDB, async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });
    if (password.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });
    try {
        // Cherche d'abord le token hashé (nouveaux resets), puis en clair (anciens)
        let user = await db.collection('users').findOne({ reset_token: hashToken(token) });
        if (!user) user = await db.collection('users').findOne({ reset_token: token });
        if (!user)                           return res.status(404).json({ error: 'Lien invalide' });
        if (user.reset_expires < new Date()) return res.status(410).json({ error: 'Lien expiré (1h)' });
        const hash = await bcrypt.hash(password, 12);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { password_hash: hash, active: true }, $unset: { reset_token: '', reset_expires: '' } }
        );
        res.json({ message: 'Mot de passe mis à jour, tu peux te connecter' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mot de passe oublié — envoi lien reset par email ou par SMS
app.post('/auth/forgot-password', checkDB, async (req, res) => {
    const { email, phone } = req.body;
    if (!email && !phone) return res.status(400).json({ error: 'Email ou numéro de téléphone requis' });
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    if (rateLimit('forgot:' + ip, 3, 60 * 60 * 1000))
        return res.status(429).json({ error: 'Trop de demandes, réessaie dans 1h.' });
    try {
        let user = null;
        if (phone) {
            const normalized = normalizePhone(phone);
            user = await db.collection('users').findOne({ phone: normalized });
            if (!user) return res.json({ message: 'Si ce numéro existe, un SMS a été envoyé.' });
        } else {
            user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
            if (!user) return res.json({ message: 'Si cet email existe, un lien a été envoyé.' });
        }

        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { reset_token: hashToken(token), reset_expires: expires } }
        );

        const link = appUrl() + '/set-password.html?token=' + token + '&mode=reset';

        // ── Envoi par SMS si compte téléphone ──────────────────────────────────
        if (phone) {
            // Limite : 2 SMS reset par numéro par semaine glissante (coût)
            const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const smsCount = user.sms_reset_count || 0;
            const smsLastReset = user.sms_reset_week_start ? new Date(user.sms_reset_week_start) : null;
            // Réinitialiser le compteur si la fenêtre d'une semaine est dépassée
            const countInWindow = smsLastReset && smsLastReset > oneWeekAgo ? smsCount : 0;
            if (countInWindow >= 2) {
                return res.status(429).json({ error: 'Limite de 2 SMS par semaine atteinte. Contacte ton responsable.' });
            }
            // Incrémenter le compteur en base
            const newCount = countInWindow + 1;
            await db.collection('users').updateOne(
                { _id: user._id },
                { $set: {
                    sms_reset_count: newCount,
                    sms_reset_week_start: newCount === 1 ? new Date() : (user.sms_reset_week_start || new Date()),
                }}
            );

            let manual = false;
            try {
                // Message court : 1 segment SMS = 1 seul tarif Twilio (< 160 chars)
                await sendSMS(normalizePhone(phone), 'Templyo - Nouveau mot de passe :\n' + link);
            } catch (smsErr) {
                console.error('❌ Reset SMS failed:', smsErr.message);
                manual = true;
            }
            return res.json({
                message: 'Si ce numéro existe, un SMS a été envoyé.',
                ...(manual && { link, manual: true }),
            });
        }

        // ── Envoi par email ────────────────────────────────────────────────────
        const html =
            '<p>Bonjour ' + (user.name || '') + ',</p>' +
            '<p>Tu as demandé à réinitialiser ton mot de passe.</p>' +
            '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Réinitialiser mon mot de passe</a></p>' +
            '<p style="color:#999;font-size:12px">Ce lien expire dans 1h.</p>';

        let manual = false;
        try {
            await sendEmail(email, 'Réinitialisation de ton mot de passe', html);
        } catch (mailErr) {
            console.error('❌ Reset email failed:', mailErr.message);
            manual = true;
        }

        res.json({
            message: 'Si cet email existe, un lien a été envoyé.',
            ...(manual && { link, manual: true }),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Comptes utilisateurs ──────────────────────────────────────────────────────

app.get('/api/users', checkDB, requirePatron, async (req, res) => {
    try {
        const users = await db.collection('users')
            .find({}, { projection: { password_hash: 0, invite_token: 0 } })
            .toArray();

        // Enrichir avec le téléphone depuis staff pour les comptes qui n'en ont pas dans users
        const missing = users.filter(u => !u.phone && u.staff_id && isValidObjectId(u.staff_id));
        if (missing.length > 0) {
            const staffDocs = await db.collection('staff')
                .find({ _id: { $in: missing.map(u => new ObjectId(u.staff_id)) } }, { projection: { phone: 1 } })
                .toArray();
            const phoneMap = {};
            staffDocs.forEach(s => { if (s.phone) phoneMap[String(s._id)] = s.phone; });
            users.forEach(u => { if (!u.phone && u.staff_id && phoneMap[u.staff_id]) u.phone = phoneMap[u.staff_id]; });
        }

        // Directeur : ne voit pas les comptes patron ni les autres directeurs
        if (req.session.user.role === 'directeur') {
            return res.json(users.filter(u => u.role === 'staff' || String(u._id) === req.session.user._id));
        }
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Inviter un utilisateur (staff, directeur ou etablissement)
app.post('/api/users', checkDB, requirePatron, async (req, res) => {
    const { email, phone, staff_id, name, role, assigned_establishments, establishment_id } = req.body;
    const validRoles = ['staff', 'directeur', 'etablissement'];
    const userRole = validRoles.includes(role) ? role : 'staff';
    if (!email && !phone) return res.status(400).json({ error: 'Email ou numéro de téléphone requis' });
    if (userRole === 'directeur' && req.session.user.role !== 'patron')
        return res.status(403).json({ error: 'Seul l\'administrateur peut inviter un directeur' });
    if (userRole === 'etablissement' && req.session.user.role !== 'patron')
        return res.status(403).json({ error: 'Seul l\'administrateur peut créer un compte établissement' });
    if (userRole === 'etablissement' && !establishment_id)
        return res.status(400).json({ error: 'establishment_id requis pour un compte établissement' });
    try {
        // Vérifier doublon email
        if (email) {
            const existingEmail = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
            if (existingEmail) return res.status(409).json({ error: 'Cet email est déjà utilisé' });
        }
        // Vérifier doublon téléphone
        let normalizedPhone = null;
        if (phone) {
            normalizedPhone = normalizePhone(phone);
            const existingPhone = await db.collection('users').findOne({ phone: normalizedPhone });
            if (existingPhone) return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });
        }

        // Compte téléphone uniquement — token d'invitation pour créer le mot de passe
        if (!email && normalizedPhone) {
            const token   = crypto.randomBytes(32).toString('hex');
            const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 jours
            await db.collection('users').insertOne({
                phone:                   normalizedPhone,
                password_hash:           null,
                role:                    userRole,
                staff_id:                userRole === 'staff' ? (staff_id || null) : null,
                assigned_establishments: userRole === 'directeur' ? (assigned_establishments || []) : [],
                establishment_id:        userRole === 'etablissement' ? establishment_id : null,
                name:                    name || '',
                invite_token:            hashToken(token),
                invite_expires:          expires,
                active:                  false,
                created_at:              new Date(),
            });
            if (staff_id && userRole === 'staff' && isValidObjectId(staff_id)) {
                await db.collection('staff').updateOne(
                    { _id: new ObjectId(staff_id) },
                    { $set: { phone: normalizedPhone } }
                );
            }
            const link = appUrl() + '/set-password.html?token=' + token;
            let smsSent = true;
            try {
                await sendSMS(normalizedPhone, 'Templyo - Bonjour '  + (name ? ' ' + name : '') + '!\n' + link);
            } catch (smsErr) {
                console.error('❌ SMS bienvenue non envoyé:', smsErr.message);
                smsSent = false;
            }
            return res.status(201).json({
                message: smsSent ? 'Compte créé, SMS envoyé.' : 'Compte créé mais SMS non envoyé.',
                ...(!smsSent && { manual: true, link }),
            });
        }

        // Compte email (avec ou sans téléphone secondaire)
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.collection('users').insertOne({
            email:                   email.toLowerCase().trim(),
            ...(normalizedPhone && { phone: normalizedPhone }),
            password_hash:           null,
            role:                    userRole,
            staff_id:                userRole === 'staff' ? (staff_id || null) : null,
            assigned_establishments: userRole === 'directeur' ? (assigned_establishments || []) : [],
            establishment_id:        userRole === 'etablissement' ? establishment_id : null,
            name:                    name || '',
            invite_token:            hashToken(token),
            invite_expires:          expires,
            active:                  false,
            created_at:              new Date(),
        });

        if (staff_id && userRole === 'staff' && isValidObjectId(staff_id)) {
            await db.collection('staff').updateOne(
                { _id: new ObjectId(staff_id) },
                { $set: { email: email.toLowerCase().trim(), ...(normalizedPhone && { phone: normalizedPhone }) } }
            );
        }

        const link = appUrl() + '/set-password.html?token=' + token;
        const html =
            '<p>Bonjour ' + (name || '') + ',</p>' +
            '<p>Tu as été invité(e) à rejoindre <strong>Templyo</strong>.</p>' +
            '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
            '<p style="color:#999;font-size:12px">Ce lien expire dans 24h.</p>';

        let manual = false;
        try {
            await sendEmail(email, 'Ton accès Templyo', html);
            console.log('✅ Email envoyé à', email);
        } catch (mailErr) {
            console.error('❌ Erreur envoi email:', mailErr.message);
            manual = true;
        }

        res.status(201).json({
            message: manual ? 'Compte créé mais email non envoyé.' : 'Invitation envoyée à ' + email,
            ...(manual && { link, manual: true }),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Changer le rôle d'un utilisateur (patron admin uniquement)
app.patch('/api/users/:id/role', checkDB, requireAdmin, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { role, assigned_establishments } = req.body;
    if (!['patron', 'directeur', 'staff'].includes(role)) return res.status(400).json({ error: 'Rôle invalide (patron, directeur ou staff)' });
    // Ne pas permettre de se rétrograder soi-même
    if (String(req.params.id) === req.session.user._id) return res.status(403).json({ error: 'Impossible de changer son propre rôle' });
    try {
        const update = { role };
        if (role === 'directeur') update.assigned_establishments = assigned_establishments || [];
        if (role === 'patron')    update.assigned_establishments = [];
        if (role === 'staff')     update.assigned_establishments = [];
        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: update }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ message: 'Rôle mis à jour' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assigner des établissements à un directeur (patron admin uniquement)
app.patch('/api/users/:id/establishments', checkDB, requireAdmin, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { assigned_establishments } = req.body;
    if (!Array.isArray(assigned_establishments)) return res.status(400).json({ error: 'assigned_establishments (tableau) requis' });
    try {
        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { assigned_establishments } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ message: 'Établissements mis à jour' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset mot de passe par le patron
app.patch('/api/users/:id/reset-password', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });
    try {
        const hash   = await bcrypt.hash(password, 12);
        const result = await db.collection('users').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { password_hash: hash, active: true }, $unset: { reset_token: '', reset_expires: '' } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ message: 'Mot de passe mis à jour' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const result = await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ message: 'Compte supprimé' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Création en masse depuis CSV (nom + téléphone ou email)
app.post('/api/users/bulk', checkDB, requireAdmin, async (req, res) => {
    const { entries } = req.body; // [{ name, phone?, email? }, ...]
    if (!Array.isArray(entries) || entries.length === 0)
        return res.status(400).json({ error: 'entries (tableau) requis' });
    if (entries.length > 200)
        return res.status(400).json({ error: 'Maximum 200 entrées par import' });

    const results = { created: [], updated: [], skipped: [], failed: [] };

    for (const entry of entries) {
        const name  = (entry.name  || '').trim();
        const email = (entry.email || '').trim().toLowerCase() || null;
        const phone = (entry.phone || '').trim() || null;

        if (!name)            { results.failed.push({ entry, reason: 'Nom manquant' }); continue; }
        if (!email && !phone) { results.failed.push({ entry, reason: 'Email ou téléphone requis' }); continue; }

        try {
            const normalizedPhone = phone ? normalizePhone(phone) : null;

            // Chercher un user existant : par email, puis par téléphone
            let existingUser = null;
            if (email)           existingUser = await db.collection('users').findOne({ email });
            if (!existingUser && normalizedPhone) existingUser = await db.collection('users').findOne({ phone: normalizedPhone });

            // Sinon chercher un staff existant par nom (insensible à la casse)
            let existingStaff = null;
            if (existingUser && existingUser.staff_id) {
                existingStaff = await db.collection('staff').findOne({ _id: new ObjectId(existingUser.staff_id) });
            } else if (!existingUser) {
                existingStaff = await db.collection('staff').findOne({ name: { $regex: '^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' } });
                if (existingStaff) {
                    const uByStaff = await db.collection('users').findOne({ staff_id: String(existingStaff._id) });
                    if (uByStaff) existingUser = uByStaff;
                }
            }

            // Vérifier conflits : le nouveau email/phone appartient à quelqu'un d'autre ?
            if (email) {
                const conflict = await db.collection('users').findOne({ email, ...(existingUser ? { _id: { $ne: existingUser._id } } : {}) });
                if (conflict) { results.skipped.push({ name, reason: 'Email déjà utilisé par un autre compte : ' + email }); continue; }
            }
            if (normalizedPhone) {
                const conflict = await db.collection('users').findOne({ phone: normalizedPhone, ...(existingUser ? { _id: { $ne: existingUser._id } } : {}) });
                if (conflict) { results.skipped.push({ name, reason: 'Numéro déjà utilisé par un autre compte : ' + normalizedPhone }); continue; }
            }

            // ─── Cas 1 : staff trouvé mais pas de user lié → créer le user + envoyer invite ───
            if (existingStaff && !existingUser) {
                const token   = crypto.randomBytes(32).toString('hex');
                const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                const staffId = String(existingStaff._id);

                const staffUpdate = {};
                if (email           && !existingStaff.email) staffUpdate.email = email;
                if (normalizedPhone && !existingStaff.phone) staffUpdate.phone = normalizedPhone;
                if (Object.keys(staffUpdate).length)
                    await db.collection('staff').updateOne({ _id: existingStaff._id }, { $set: staffUpdate });

                await db.collection('users').insertOne({
                    ...(email && { email }), ...(normalizedPhone && { phone: normalizedPhone }),
                    password_hash: null, role: 'staff',
                    staff_id: staffId, assigned_establishments: [],
                    name: existingStaff.name, invite_token: hashToken(token), invite_expires: expires,
                    active: false, created_at: new Date(),
                });

                const link = appUrl() + '/set-password.html?token=' + token;
                let sent = false;
                if (normalizedPhone) {
                    try { await sendSMS(normalizedPhone, 'Templyo - Bonjour ' + existingStaff.name + '!\n' + link); sent = true; }
                    catch (e) { console.error('Bulk SMS erreur ' + existingStaff.name + ':', e.message); }
                }
                if (email) {
                    const html = '<p>Bonjour ' + existingStaff.name + ',</p><p>Tu as été invité(e) à rejoindre <strong>Templyo</strong>.</p>' +
                        '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
                        '<p style="color:#999;font-size:12px">Ce lien expire dans 7 jours.</p>';
                    try { await sendEmail(email, 'Ton accès Templyo', html); sent = true; }
                    catch (e) { console.error('Bulk email erreur ' + existingStaff.name + ':', e.message); }
                }
                results.created.push({ name: existingStaff.name, phone: normalizedPhone, email, link, sent });
                continue;
            }

            // ─── Cas 2 : user existant → update des champs manquants ───
            if (existingUser) {
                const userUpdate  = {};
                const staffUpdate = {};
                const added = [];

                if (email && !existingUser.email) { userUpdate.email = email; staffUpdate.email = email; added.push('email'); }
                if (normalizedPhone && !existingUser.phone) { userUpdate.phone = normalizedPhone; staffUpdate.phone = normalizedPhone; added.push('téléphone'); }

                if (!added.length) {
                    results.skipped.push({ name, reason: 'Déjà à jour — rien à ajouter' });
                    continue;
                }

                await db.collection('users').updateOne({ _id: existingUser._id }, { $set: userUpdate });
                if (existingUser.staff_id)
                    await db.collection('staff').updateOne({ _id: new ObjectId(existingUser.staff_id) }, { $set: staffUpdate });

                // Si le compte n'a pas encore de mot de passe, renvoyer un lien d'invitation sur le NOUVEAU canal
                let link = null, sent = false;
                if (!existingUser.password_hash) {
                    const token   = crypto.randomBytes(32).toString('hex');
                    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                    await db.collection('users').updateOne({ _id: existingUser._id }, { $set: { invite_token: hashToken(token), invite_expires: expires } });
                    link = appUrl() + '/set-password.html?token=' + token;
                    if (added.includes('téléphone') && normalizedPhone) {
                        try { await sendSMS(normalizedPhone, 'Templyo - Bienvenue ' + existingUser.name + '\nCree ton mot de passe ici\n' + link); sent = true; }
                        catch (e) { console.error('Bulk SMS erreur ' + existingUser.name + ':', e.message); }
                    }
                    if (added.includes('email') && email) {
                        const html = '<p>Bonjour ' + existingUser.name + ',</p><p>Tu as été invité(e) à rejoindre <strong>Templyo</strong>.</p>' +
                            '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
                            '<p style="color:#999;font-size:12px">Ce lien expire dans 7 jours.</p>';
                        try { await sendEmail(email, 'Ton accès Templyo', html); sent = true; }
                        catch (e) { console.error('Bulk email erreur ' + existingUser.name + ':', e.message); }
                    }
                }

                results.updated.push({ name: existingUser.name, added, phone: existingUser.phone || normalizedPhone, email: existingUser.email || email, link, sent });
                continue;
            }

            // ─── Cas 3 : rien d'existant → créer staff + user + invite ───
            const token   = crypto.randomBytes(32).toString('hex');
            const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            const COLORS = ['#3498db','#e74c3c','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a'];
            const color  = COLORS[Math.floor(Math.random() * COLORS.length)];
            const staffDoc = {
                name,
                color,
                email: email || '',
                phone: normalizedPhone || '',
                venues: [],
                roles:  [],
                can_submit_dispos: true,
                created_at: new Date(),
            };
            const staffResult = await db.collection('staff').insertOne(staffDoc);
            const staffId = String(staffResult.insertedId);

            await db.collection('users').insertOne({
                ...(email && { email }), ...(normalizedPhone && { phone: normalizedPhone }),
                password_hash: null, role: 'staff',
                staff_id: staffId, assigned_establishments: [],
                name, invite_token: hashToken(token), invite_expires: expires,
                active: false, created_at: new Date(),
            });

            const link = appUrl() + '/set-password.html?token=' + token;
            let sent = false;

            if (normalizedPhone) {
                try {
                    await sendSMS(normalizedPhone, 'Templyo - Bonjour ' + (name ? ' ' + name : '') + '!\n' + link);
                    sent = true;
                } catch (e) { console.error('Bulk SMS erreur ' + name + ':', e.message); }
            }
            if (email) {
                const html = '<p>Bonjour ' + name + ',</p><p>Tu as été invité(e) à rejoindre <strong>Templyo</strong>.</p>' +
                    '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
                    '<p style="color:#999;font-size:12px">Ce lien expire dans 7 jours.</p>';
                try { await sendEmail(email, 'Ton accès Templyo', html); sent = true; }
                catch (e) { console.error('Bulk email erreur ' + name + ':', e.message); }
            }

            results.created.push({ name, phone: normalizedPhone, email, link, sent });
        } catch (e) {
            results.failed.push({ entry, reason: e.message });
        }
    }

    res.status(201).json(results);
});

// ── Établissements ────────────────────────────────────────────────────────────

app.get('/api/establishments', checkDB, requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const all  = await db.collection('establishments').find().toArray();
        // Directeur : ne voit que ses établissements assignés
        if (user.role === 'directeur') {
            const assigned = user.assigned_establishments || [];
            return res.json(all.filter(e => assigned.includes(String(e._id)) || assigned.includes(e.id)));
        }
        // Patron (admin) : accès total
        res.json(all);
    }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/establishments', checkDB, requireAdmin, async (req, res) => {
    const { name, type, open_time, close_time, groups } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
    if (!['bar', 'restaurant'].includes(type)) return res.status(400).json({ error: 'Type : bar ou restaurant' });
    try {
        const existing = await db.collection('establishments').findOne({ name: name.trim() });
        if (existing) return res.status(409).json({ error: 'Un établissement avec ce nom existe déjà' });
        const id = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') + '_' + type;
        const doc = {
            id,
            name:       name.trim(),
            type,
            groups:     Array.isArray(groups) ? groups : [],
            open_time:  open_time  || null,
            close_time: close_time || null,
            created_at: new Date(),
        };
        const result = await db.collection('establishments').insertOne(doc);
        res.status(201).json({ ...doc, _id: result.insertedId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/establishments/:id', checkDB, requireAdmin, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { name, type, open_time, close_time, groups } = req.body;
    if (!name && !type && open_time === undefined && close_time === undefined && groups === undefined)
        return res.status(400).json({ error: 'Au moins un champ requis' });
    try {
        const update = {};
        if (name)                    update.name       = name.trim();
        if (type)                    update.type       = type;
        if (open_time  !== undefined) update.open_time  = open_time  || null;
        if (close_time !== undefined) update.close_time = close_time || null;
        if (groups !== undefined)    update.groups     = Array.isArray(groups) ? groups : [];
        const result = await db.collection('establishments').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: update }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Établissement introuvable' });
        res.json({ message: 'Établissement mis à jour' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/establishments/:id', checkDB, requireAdmin, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const estab = await db.collection('establishments').findOne({ _id: new ObjectId(req.params.id) });
        if (!estab) return res.status(404).json({ error: 'Établissement introuvable' });
        // Supprimer les shifts liés
        await db.collection('shifts').deleteMany({ establishment_id: estab.id });
        // Supprimer l'établissement
        await db.collection('establishments').deleteOne({ _id: new ObjectId(req.params.id) });
        // Retirer l'id des assigned_establishments des directeurs
        await db.collection('users').updateMany(
            { assigned_establishments: estab.id },
            { $pull: { assigned_establishments: estab.id } }
        );
        res.json({ message: 'Établissement et ses shifts supprimés' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Groupes ───────────────────────────────────────────────────────────────────

// Retourne la liste des groupes distincts (depuis establishments + staff)
app.get('/api/groups', checkDB, requireAuth, async (req, res) => {
    try {
        const estabG = await db.collection('establishments').distinct('groups');
        const staffG = await db.collection('staff').distinct('groups');
        const all = [...new Set([...estabG, ...staffG].flat())].filter(Boolean).sort();
        res.json(all);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Supprimer un groupe (le retire de tous les établissements et membres du staff)
app.delete('/api/groups/:name', checkDB, requireAdmin, async (req, res) => {
    const name = decodeURIComponent(req.params.name);
    if (!name) return res.status(400).json({ error: 'Nom du groupe requis' });
    try {
        await db.collection('establishments').updateMany(
            { groups: name },
            { $pull: { groups: name } }
        );
        await db.collection('staff').updateMany(
            { groups: name },
            { $pull: { groups: name } }
        );
        res.json({ message: 'Groupe "' + name + '" supprimé' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff ─────────────────────────────────────────────────────────────────────

app.get('/api/staff', checkDB, requireAuth, async (req, res) => {
    try { res.json(await db.collection('staff').find().toArray()); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/staff', checkDB, requirePatron, async (req, res) => {
    const { name, color, email } = req.body;
    if (!name) return res.status(400).json({ error: 'name requis' });
    try {
        const doc    = { name, color: color || '#3498db', email: email || '' };
        const result = await db.collection('staff').insertOne(doc);
        res.status(201).json({ ...doc, _id: result.insertedId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Création en masse de profils staff depuis une liste de noms — sans compte ni invitation
app.post('/api/staff/bulk', checkDB, requirePatron, async (req, res) => {
    const { names } = req.body;
    if (!Array.isArray(names) || names.length === 0)
        return res.status(400).json({ error: 'names (tableau) requis' });
    if (names.length > 200)
        return res.status(400).json({ error: 'Maximum 200 noms par import' });

    const COLORS = ['#3498db','#9b59b6','#e67e22','#2ecc71','#e74c3c','#1abc9c','#e91e8c','#f39c12','#16a085','#8e44ad','#d35400','#27ae60','#2980b9','#c0392b','#7f8c8d'];
    const existing  = await db.collection('staff').find({}, { projection: { name: 1, color: 1 } }).toArray();
    const usedNames = new Set(existing.map(s => s.name.toLowerCase()));
    const usedColors = new Set(existing.map(s => s.color));

    const results = { created: [], skipped: [], failed: [] };

    for (const raw of names) {
        const name = String(raw || '').trim();
        if (!name) { results.failed.push({ name: raw, reason: 'Nom vide' }); continue; }
        if (usedNames.has(name.toLowerCase())) { results.skipped.push({ name, reason: 'Nom déjà existant' }); continue; }

        let color = COLORS.find(c => !usedColors.has(c));
        if (!color) color = COLORS[Math.floor(Math.random() * COLORS.length)];

        try {
            const doc = {
                name, color, email: '', phone: '',
                venues: [], roles: [], can_submit_dispos: true,
                created_at: new Date(),
            };
            const result = await db.collection('staff').insertOne(doc);
            usedNames.add(name.toLowerCase());
            usedColors.add(color);
            results.created.push({ ...doc, _id: result.insertedId });
        } catch (e) {
            results.failed.push({ name, reason: e.message });
        }
    }

    res.status(201).json(results);
});

app.patch('/api/staff/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { color, name, email, venues, can_submit_dispos, groups, rest_days } = req.body;
    if (!color && !name && email === undefined && venues === undefined && can_submit_dispos === undefined && req.body.roles === undefined && groups === undefined && req.body.name_color === undefined && rest_days === undefined)
        return res.status(400).json({ error: 'color, name, email, venues, roles, groups, name_color, can_submit_dispos ou rest_days requis' });
    try {
        const update = {};
        if (color)                           update.color             = color;
        if (name)                            update.name              = name;
        if (email !== undefined)             update.email             = email;
        if (venues !== undefined)            update.venues            = venues;
        if (req.body.roles !== undefined)    update.roles             = req.body.roles;
        if (can_submit_dispos !== undefined) update.can_submit_dispos = !!can_submit_dispos;
        if (groups !== undefined)            update.groups            = Array.isArray(groups) ? groups : [];
        if (Array.isArray(rest_days))        update.rest_days         = rest_days.map(Number).filter(n => n >= 0 && n <= 6);
        if (req.body.name_color !== undefined) update.name_color      = req.body.name_color || null;
        const result = await db.collection('staff').updateOne(
            { _id: new ObjectId(req.params.id) }, { $set: update }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Staff introuvable' });
        if (color) await db.collection('shifts').updateMany({ staff_id: req.params.id }, { $set: { color } });
        if (name)  await db.collection('shifts').updateMany({ staff_id: req.params.id }, { $set: { staff_name: name } });
        res.json({ message: 'Staff mis à jour', updated: update });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/staff/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        await db.collection('shifts').deleteMany({ staff_id: req.params.id });
        const result = await db.collection('staff').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Staff introuvable' });
        res.json({ message: 'Staff supprimé' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shifts — lecture ──────────────────────────────────────────────────────────

app.get('/api/shifts/:establishmentId/:date', checkDB, requireAuth, async (req, res) => {
    try {
        const shifts = await db.collection('shifts')
            .find({ establishment_id: req.params.establishmentId, date: req.params.date })
            .sort({ start_time: 1 }).toArray();
        res.json(shifts);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/week/:establishmentId', checkDB, requireAuth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis (YYYY-MM-DD)' });
    try {
        const shifts = await db.collection('shifts').find({
            establishment_id: req.params.establishmentId,
            date: { $gte: from, $lte: to }
        }).toArray();
        const summary = {};
        for (let d = new Date(from + 'T12:00:00'); d <= new Date(to + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
            const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), j = String(d.getDate()).padStart(2,'0');
            summary[y+'-'+m+'-'+j] = 0;
        }
        shifts.forEach(s => { if (summary[s.date] !== undefined) summary[s.date]++; });
        res.json(summary);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my-shifts', checkDB, requireAuth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié à ce compte' });
    try {
        // Récupérer le profil staff pour connaître ses groupes
        const staffDoc = isValidObjectId(staffId)
            ? await db.collection('staff').findOne({ _id: new ObjectId(staffId) })
            : null;
        const staffGroups = staffDoc?.groups || [];

        // Si le staff a des groupes définis, limiter aux établissements de ces groupes
        // Les établissements sans groupe (groups vide ou absent) sont toujours inclus
        let allowedEstabIds = null;
        if (staffGroups.length > 0) {
            const groupEstabs = await db.collection('establishments').find({
                $or: [
                    { groups: { $in: staffGroups } },
                    { groups: { $size: 0 } },
                    { groups: { $exists: false } },
                ]
            }).toArray();
            allowedEstabIds = groupEstabs.map(e => e.id);
        }

        const shiftQuery = { staff_id: staffId, date: { $gte: from, $lte: to } };
        if (allowedEstabIds) shiftQuery.establishment_id = { $in: allowedEstabIds };

        const myRawShifts = await db.collection('shifts').find(shiftQuery)
            .sort({ date: 1, start_time: 1 }).toArray();

        const myEstablishments = [...new Set(myRawShifts.map(s => s.establishment_id))];
        const myDates          = [...new Set(myRawShifts.map(s => s.date))];

        const jokers = myEstablishments.length ? await db.collection('shifts').find({
            is_joker: true,
            establishment_id: { $in: myEstablishments },
            date: { $in: myDates }
        }).toArray() : [];

        const myShifts = [...myRawShifts, ...jokers].sort((a, b) =>
            a.date < b.date ? -1 : a.date > b.date ? 1 : a.start_time - b.start_time
        );

        const dates = [...new Set(myShifts.map(s => s.date))];
        const colleagueMap = {};
        for (const date of dates) {
            // Les collègues sont filtrés au même groupe si le staff a des groupes
            const colleagueQuery = {
                date,
                establishment_id: { $in: myShifts.filter(s => s.date === date).map(s => s.establishment_id) },
                staff_id: { $nin: [staffId, '__joker__'] },
            };
            colleagueMap[date] = await db.collection('shifts').find(colleagueQuery).toArray();
        }
        res.json({ shifts: myShifts, colleagues: colleagueMap });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET tous les shifts de la semaine (remplace 7 appels /api/shifts/:id/:date)
app.get('/api/week-full/:establishmentId', checkDB, requireAuth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis (YYYY-MM-DD)' });
    try {
        const shifts = await db.collection('shifts').find({
            establishment_id: req.params.establishmentId,
            date: { $gte: from, $lte: to },
        }).sort({ date: 1, start_time: 1 }).toArray();

        // Grouper par date
        const byDate = {};
        for (let d = new Date(from + 'T12:00:00'); d <= new Date(to + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
            const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
            byDate[key] = [];
        }
        shifts.forEach(s => { if (byDate[s.date] !== undefined) byDate[s.date].push(s); });
        res.json(byDate);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shifts — écriture ─────────────────────────────────────────────────────────

app.post('/api/shifts', checkDB, requirePatron, async (req, res) => {
    const { staff_id, staff_name, establishment_id, date, start_time, end_time, color, is_joker, note } = req.body;
    if (!staff_id || !establishment_id || !date || start_time == null || end_time == null)
        return res.status(400).json({ error: 'staff_id, establishment_id, date, start_time, end_time requis' });
    if (end_time <= start_time) return res.status(400).json({ error: 'end_time > start_time requis' });
    if (!canAccessEstablishment(req.session.user, establishment_id))
        return res.status(403).json({ error: 'Accès refusé à cet établissement' });
    try {
        const warnings = [];
        // Pas de détection de conflit pour les Jokers (staff non désigné)
        if (!is_joker && staff_id !== '__joker__') {
            const conflicts = await db.collection('shifts').find({
                staff_id, date, establishment_id: { $ne: establishment_id }
            }).toArray();
            for (const s of conflicts) {
                const gap = Math.min(Math.abs(start_time - s.end_time), Math.abs(s.start_time - end_time));
                if (start_time < s.end_time && end_time > s.start_time)
                    warnings.push({ type: 'overlap', message: 'Chevauchement avec ' + s.establishment_id });
                else if (gap < 1)
                    warnings.push({ type: 'gap', message: 'Seulement ' + Math.round(gap * 60) + ' min de coupure avec ' + s.establishment_id });
            }
        }
        const shift = {
            staff_id, staff_name: staff_name || '',
            establishment_id, date,
            start_time: parseFloat(start_time), end_time: parseFloat(end_time),
            color: color || '#95a5a6',
            ...(is_joker || staff_id === '__joker__' ? { is_joker: true } : {}),
            ...(note ? { note: String(note).slice(0, 280) } : {}),
        };
        const result = await db.collection('shifts').insertOne(shift);

        // Notifier les patrons/directeurs si la semaine est déjà publiée
        if (!is_joker && staff_id !== '__joker__') {
            (async () => {
                    let isPublished = _isAutoPublished(date);
                    if (!isPublished) {
                        const allPubs = await db.collection('settings').find({
                            key: { $regex: '^publish_' }, published: true,
                        }).toArray();
                        isPublished = allPubs.some(p => {
                            const weekDate  = new Date(p.key.replace('publish_', '') + 'T12:00:00');
                            const shiftDate = new Date(date + 'T12:00:00');
                            return Math.abs(shiftDate - weekDate) < 8 * 24 * 60 * 60 * 1000;
                        });
                    }
                    if (isPublished) {
                        const estabDoc  = await db.collection('establishments').findOne({ _id: establishment_id }) || {};
                        const estabName = estabDoc.name || establishment_id;
                        // Push au staff planifié
                        await sendPushToStaff([staff_id], {
                            title:   '✅ Nouveau shift — ' + estabName,
                            body:    'Tu es planifié(e) ' + formatDateFR(date) + ' · ' + formatShiftTime(parseFloat(start_time)) + ' → ' + formatShiftTime(parseFloat(end_time)),
                            tag:     'planning-publie',
                            url:     '/planning.html',
                            actions: [{ action: 'voir', title: 'Voir mon planning' }],
                        });
                        // In-app patron
                        await createNotifForPatrons(
                            establishment_id,
                            'shift_added',
                            '➕ ' + (staff_name || 'Un membre') + ' — ' + formatDateShortFR(date) + ' · ' + formatShiftTime(parseFloat(start_time)) + '→' + formatShiftTime(parseFloat(end_time)),
                            { date, shift_id: String(result.insertedId) }
                        );
                    }
                })();
        }

        res.status(201).json({ ...shift, _id: result.insertedId, warnings });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/shifts/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { start_time, end_time, staff_id, staff_name, color, is_joker, note } = req.body;
    const assigningStaff = staff_id !== undefined;
    const updatingNote   = note !== undefined;
    if (!assigningStaff && !updatingNote && start_time == null && end_time == null)
        return res.status(400).json({ error: 'start_time, end_time, staff_id ou note requis' });
    try {
        const existing = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!existing) return res.status(404).json({ error: 'Shift introuvable' });
        if (!canAccessEstablishment(req.session.user, existing.establishment_id))
            return res.status(403).json({ error: 'Accès refusé à cet établissement' });

        const newStart  = start_time != null ? parseFloat(start_time) : existing.start_time;
        const newEnd    = end_time   != null ? parseFloat(end_time)   : existing.end_time;
        if (newEnd <= newStart) return res.status(400).json({ error: 'end_time > start_time requis' });

        const updateFields = { start_time: newStart, end_time: newEnd };

        // Note sur un Joker
        if (updatingNote) updateFields.note = String(note).slice(0, 280);

        // Affectation d'un vrai staff sur un Joker
        if (assigningStaff) {
            updateFields.staff_id   = staff_id;
            updateFields.staff_name = staff_name || '';
            if (color) updateFields.color = color;
            // Si on assigne un vrai staff, retirer le flag joker
            if (is_joker === false) {
                updateFields.is_joker = false;
            }
        }

        // Détection de conflits (uniquement pour les vrais staffs)
        const effectiveStaffId = staff_id || existing.staff_id;
        const warnings = [];
        if (effectiveStaffId !== '__joker__') {
            const conflicts = await db.collection('shifts').find({
                staff_id: effectiveStaffId, date: existing.date,
                establishment_id: { $ne: existing.establishment_id },
                _id: { $ne: new ObjectId(req.params.id) }
            }).toArray();
            for (const s of conflicts) {
                const gap = Math.min(Math.abs(newStart - s.end_time), Math.abs(s.start_time - newEnd));
                if (newStart < s.end_time && newEnd > s.start_time)
                    warnings.push({ type: 'overlap', message: 'Chevauchement avec ' + s.establishment_id });
                else if (gap < 1)
                    warnings.push({ type: 'gap', message: Math.round(gap * 60) + ' min de coupure avec ' + s.establishment_id });
            }
        }

        await db.collection('shifts').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updateFields }
        );

        // ── Notifications (push staff + in-app patron) — avec debounce 60s ───────
        const targetStaffId = updateFields.staff_id || existing.staff_id;
        if (targetStaffId && targetStaffId !== '__joker__') {
            const shiftId      = String(existing._id);
            const staffName    = updateFields.staff_name || existing.staff_name || 'Un membre';
            const newS         = updateFields.start_time != null ? updateFields.start_time : existing.start_time;
            const newE         = updateFields.end_time   != null ? updateFields.end_time   : existing.end_time;
            const capturedDate = existing.date;
            const capturedEstab = existing.establishment_id;

            scheduleShiftNotif(
                shiftId,
                { _id: existing._id, start_time: existing.start_time, end_time: existing.end_time, staff_id: existing.staff_id },
                // Push au staff — lancé après 60s de silence
                async () => {
                    let isPublished = _isAutoPublished(capturedDate);
                    if (!isPublished) {
                        const allPubs = await db.collection('settings').find({
                            key: { $regex: '^publish_' }, published: true,
                        }).toArray();
                        isPublished = allPubs.some(p => {
                            const weekDate  = new Date(p.key.replace('publish_', '') + 'T12:00:00');
                            const shiftDate = new Date(capturedDate + 'T12:00:00');
                            return Math.abs(shiftDate - weekDate) < 8 * 24 * 60 * 60 * 1000;
                        });
                    }
                    if (!isPublished) return;
                    // Relire les horaires finaux depuis la base (après tous les resizes)
                    const finalShift = await db.collection('shifts').findOne({ _id: existing._id });
                    const fS = finalShift ? finalShift.start_time : newS;
                    const fE = finalShift ? finalShift.end_time   : newE;
                    const estabDoc = await db.collection('establishments').findOne({ _id: capturedEstab }) || {};
                    const estabName = estabDoc.name || capturedEstab;
                    await sendPushToStaff([targetStaffId], {
                        title:   '✏️ Shift modifié — ' + estabName,
                        body:    formatDateFR(capturedDate) + ' · ' + formatShiftTime(fS) + ' → ' + formatShiftTime(fE),
                        tag:     'shift-modifie',
                        url:     '/planning.html',
                        actions: [{ action: 'voir', title: 'Voir les changements' }],
                    });
                },
                // Notif in-app patron/directeurs
                async () => {
                    const finalShift = await db.collection('shifts').findOne({ _id: existing._id });
                    const fS = finalShift ? finalShift.start_time : newS;
                    const fE = finalShift ? finalShift.end_time   : newE;
                    await createNotifForPatrons(
                        capturedEstab,
                        'shift_modified',
                        '✏️ ' + staffName + ' — ' + formatDateShortFR(capturedDate) + ' · ' + formatShiftTime(fS) + '→' + formatShiftTime(fE),
                        { date: capturedDate, shift_id: shiftId }
                    );
                }
            );
        }

        res.json({ message: 'Shift mis à jour', warnings });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/shifts/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const existing = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!existing) return res.status(404).json({ error: 'Shift introuvable' });
        if (!canAccessEstablishment(req.session.user, existing.establishment_id))
            return res.status(403).json({ error: 'Accès refusé à cet établissement' });
        const result = await db.collection('shifts').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Shift introuvable' });
        res.json({ message: 'Shift supprimé' });
        touchLastUpdated();
        // Notifications si le shift concernait un vrai staff sur une semaine publiée
        if (!existing.is_joker && existing.staff_id && existing.staff_id !== '__joker__') {
            (async () => {
                try {
                    let isPublished = _isAutoPublished(existing.date);
                    if (!isPublished) {
                        const allPubs = await db.collection('settings').find({ key: { $regex: '^publish_' }, published: true }).toArray();
                        isPublished = allPubs.some(p => {
                            const weekDate  = new Date(p.key.replace('publish_', '') + 'T12:00:00');
                            const shiftDate = new Date(existing.date + 'T12:00:00');
                            return Math.abs(shiftDate - weekDate) < 8 * 24 * 60 * 60 * 1000;
                        });
                    }
                    if (!isPublished) return;
                    const estabDoc  = await db.collection('establishments').findOne({ _id: existing.establishment_id }) || {};
                    const estabName = estabDoc.name || existing.establishment_id;
                    await sendPushToStaff([existing.staff_id], {
                        title:   '❌ Shift annulé — ' + estabName,
                        body:    'Ton shift du ' + formatDateFR(existing.date) + ' (' + formatShiftTime(existing.start_time) + ' → ' + formatShiftTime(existing.end_time) + ') a été annulé.',
                        tag:     'shift-modifie',
                        url:     '/planning.html',
                        actions: [{ action: 'voir', title: 'Voir les changements' }],
                    });
                    await createNotifForPatrons(
                        existing.establishment_id,
                        'shift_deleted',
                        '❌ ' + (existing.staff_name || 'Un membre') + ' — ' + formatDateShortFR(existing.date) + ' · shift supprimé',
                        { date: existing.date }
                    );
                } catch { /* silencieux */ }
            })();
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/copy-day', checkDB, requirePatron, async (req, res) => {
    const { establishment_id, to_dates, shifts } = req.body;
    if (!establishment_id || !to_dates?.length || !shifts?.length)
        return res.status(400).json({ error: 'establishment_id, to_dates, shifts requis' });
    if (!canAccessEstablishment(req.session.user, establishment_id))
        return res.status(403).json({ error: 'Accès refusé à cet établissement' });
    try {
        let created = 0;
        for (const date of to_dates) {
            await db.collection('shifts').deleteMany({ establishment_id, date });
            const newShifts = shifts.map(({ _id, ...rest }) => ({ ...rest, establishment_id, date }));
            if (newShifts.length > 0) { await db.collection('shifts').insertMany(newShifts); created += newShifts.length; }
        }
        res.json({ message: created + ' shifts copiés sur ' + to_dates.length + ' jour(s)' });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Disponibilités ────────────────────────────────────────────────────────────

/**
 * Calcule la deadline effective de la semaine Lun–Dim en cours.
 *
 * Règle : la semaine tourne le LUNDI. Sam et Dim appartiennent encore à la
 * semaine qui vient de se terminer → si la deadline du cycle (ex vendredi 13h)
 * est déjà passée, on retourne cette date dans le passé (deadlinePassed = true)
 * et on ne roule PAS sur la semaine suivante avant le lundi.
 *
 * @param {string|null} customDeadlineIso  ISO date stockée (patron) — sert de
 *        patron récurrent (jour-de-semaine + heure) ; jamais utilisée en absolu.
 * @param {Date}        now
 * @returns {Date}  date effective de la deadline du cycle courant
 */
function computeEffectiveDeadline(customDeadlineIso, now) {
    // Jour JS (0=dim … 6=sam) → jour semaine lundi-based (lun=1 … dim=7)
    const jsDay  = now.getDay();
    const weekDay = jsDay === 0 ? 7 : jsDay; // dim devient 7 (fin de semaine)

    // Extraire jour-cible et heure depuis le patron (custom ou défaut vendredi 13h)
    let targetJsDay = 5, targetH = 13, targetM = 0;
    if (customDeadlineIso) {
        // Parser manuellement : "YYYY-MM-DDTHH:MM:SS" stocké en heure locale Paris.
        // new Date(isoString) sur un serveur UTC interprèterait cette chaîne en UTC
        // et décalerait l'heure de +2h en heure d'été → bug deadline décalée.
        const [datePart, timePart = '13:00'] = customDeadlineIso.split('T');
        const [y, mo, d] = datePart.split('-').map(Number);
        const [h, m]     = timePart.split(':').map(Number);
        targetJsDay = new Date(y, mo - 1, d).getDay(); // date locale, pas de conversion UTC
        targetH     = h;
        targetM     = m;
    }
    const wTarget = targetJsDay === 0 ? 7 : targetJsDay; // même normalisation

    const result = new Date(now);
    if (weekDay <= wTarget) {
        // On est avant ou au jour cible → deadline de CETTE semaine (dans le futur ou aujourd'hui)
        result.setDate(now.getDate() + (wTarget - weekDay));
    } else {
        // On est après le jour cible (sam/dim ou jours suivants) → deadline déjà passée cette semaine
        // On retourne la date passée pour que deadlinePassed = true
        result.setDate(now.getDate() - (weekDay - wTarget));
    }
    result.setHours(targetH, targetM, 0, 0);
    return result;
}

app.get('/api/dispo-settings', checkDB, requireAuth, async (req, res) => {
    try {
        const settings = await db.collection('settings').findOne({ key: 'dispo' }) || { open: true, message: null };
        const now    = new Date();
        const forceOpen = !!settings.force_open;
        const customDeadline = settings.custom_deadline || null;
        const effectiveDeadline = computeEffectiveDeadline(customDeadline, now);
        const effectiveDeadlinePassed = now > effectiveDeadline;

        // Vérifier si ce staff a le droit d'envoyer des dispos
        let staffCanSubmit = true;
        let staffDoc = null;
        const staffId = req.session.user.staff_id;
        if (staffId && isValidObjectId(staffId)) {
            staffDoc = await db.collection('staff').findOne({ _id: new ObjectId(staffId) });
            if (staffDoc && staffDoc.can_submit_dispos === false) staffCanSubmit = false;
        }

        res.json({
            open: settings.open,
            message: settings.message,
            deadline: effectiveDeadline.toISOString(),
            deadlinePassed: effectiveDeadlinePassed,
            canSubmit: staffCanSubmit && settings.open && (!effectiveDeadlinePassed || forceOpen),
            staffCanSubmit,
            force_open: forceOpen,
            custom_deadline: customDeadline,
            open_day: settings.open_day ?? null,
            rest_days: staffDoc ? (staffDoc.rest_days || []) : [],
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/dispo-settings', checkDB, requirePatron, async (req, res) => {
    const { open, message, force_open, custom_deadline, open_day } = req.body;
    try {
        const update = { key: 'dispo', open: !!open, message: message || null, force_open: !!force_open };
        if (custom_deadline !== undefined) update.custom_deadline = custom_deadline || null;
        if (open_day !== undefined) update.open_day = (open_day !== null && open_day !== '') ? parseInt(open_day) : null;
        await db.collection('settings').updateOne(
            { key: 'dispo' },
            { $set: update },
            { upsert: true }
        );
        res.json({ message: 'Paramètres mis à jour' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dispos/mine', checkDB, requireAuth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié' });
    try {
        const dispos = await db.collection('availabilities').find({ staff_id: staffId, date: { $gte: from, $lte: to } }).toArray();
        res.json(dispos);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dispos/previous', checkDB, requireAuth, async (req, res) => {
    const { week_start } = req.query;
    if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start))
        return res.status(400).json({ error: 'week_start invalide (YYYY-MM-DD)' });
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié' });
    try {
        const [y, mo, day] = week_start.split('-').map(Number);
        const pad = n => String(n).padStart(2, '0');
        const prevMonday = new Date(y, mo - 1, day - 7);
        const prevSunday = new Date(y, mo - 1, day - 1);
        const prevFrom = prevMonday.getFullYear() + '-' + pad(prevMonday.getMonth() + 1) + '-' + pad(prevMonday.getDate());
        const prevTo   = prevSunday.getFullYear() + '-' + pad(prevSunday.getMonth() + 1) + '-' + pad(prevSunday.getDate());
        const docs = await db.collection('availabilities').find({
            staff_id: staffId,
            date: { $gte: prevFrom, $lte: prevTo },
            type: { $ne: 'week_note' },
        }).toArray();
        res.json(docs.map(doc => ({ date: doc.date, type: doc.type, start_time: doc.start_time, end_time: doc.end_time, note: doc.note || '' })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dispos/week-notes', checkDB, requirePatron, async (req, res) => {
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start requis' });
    try {
        const docs = await db.collection('availabilities').find({ week_start, type: 'week_note' }).toArray();
        res.json(docs.map(d => ({ staff_id: d.staff_id, week_note: d.week_note })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dispos/notes', checkDB, requirePatron, async (req, res) => {
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start requis' });
    try {
        const [y, mo, d] = week_start.split('-').map(Number);
        const we = new Date(y, mo - 1, d + 6);
        const pad = n => String(n).padStart(2, '0');
        const weekEnd = we.getFullYear() + '-' + pad(we.getMonth() + 1) + '-' + pad(we.getDate());

        // Récupérer notes semaine + toutes les dispos de la semaine en une seule passe
        const allDocs = await db.collection('availabilities').find({
            $or: [
                { week_start, type: 'week_note' },
                { date: { $gte: week_start, $lte: weekEnd }, type: { $ne: 'week_note' } },
            ],
        }).toArray();

        // Grouper par staff_id
        const byStaff = {};
        allDocs.forEach(doc => {
            const sid = doc.staff_id;
            if (!byStaff[sid]) byStaff[sid] = { week_note: '', day_notes: [], statuses: new Set() };
            if (doc.type === 'week_note') {
                byStaff[sid].week_note = doc.week_note || '';
            } else {
                if (doc.note && doc.note.trim()) byStaff[sid].day_notes.push({ date: doc.date, note: doc.note.trim() });
                if (doc.status) byStaff[sid].statuses.add(doc.status);
            }
        });

        // Feature 1 — exclure les staff sans aucune note
        const staffIds = Object.keys(byStaff).filter(sid => {
            const s = byStaff[sid];
            return (s.week_note && s.week_note.trim()) || s.day_notes.length > 0;
        });
        if (staffIds.length === 0) return res.json([]);

        const staffDocs = await db.collection('staff').find({ _id: { $in: staffIds.map(id => new ObjectId(id)) } }).toArray();
        const staffMap = {};
        staffDocs.forEach(s => { staffMap[String(s._id)] = { name: s.name, color: s.color }; });

        function aggStatus(set) {
            if (!set || set.size === 0) return null;
            if (set.has('pending')) return 'pending';
            if (set.has('confirmed') && set.has('rejected')) return 'mixed';
            if (set.has('confirmed')) return 'confirmed';
            if (set.has('rejected')) return 'rejected';
            return null;
        }

        res.json(staffIds.map(sid => {
            const s = byStaff[sid];
            s.day_notes.sort((a, b) => a.date.localeCompare(b.date));
            return {
                staff_id:     sid,
                week_note:    (s.week_note && s.week_note.trim()) ? s.week_note.trim() : null,
                day_notes:    s.day_notes,
                name:         staffMap[sid]?.name  || 'Inconnu',
                color:        staffMap[sid]?.color || '#95a5a6',
                dispo_status: aggStatus(s.statuses),
            };
        }));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dispos/week-note', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start requis' });
    if (!staffId) return res.json({ week_note: '' });
    try {
        const doc = await db.collection('availabilities').findOne({ staff_id: staffId, week_start, type: 'week_note' });
        res.json({ week_note: doc ? doc.week_note : '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dispos/week-note', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié' });
    const { week_start, week_note } = req.body;
    if (!week_start || !/^\d{4}-\d{2}-\d{2}$/.test(week_start))
        return res.status(400).json({ error: 'week_start invalide (YYYY-MM-DD)' });
    if (week_note !== undefined && String(week_note).length > 200)
        return res.status(400).json({ error: 'Note trop longue (200 caractères max)' });
    try {
        await db.collection('availabilities').updateOne(
            { staff_id: staffId, week_start, type: 'week_note' },
            { $set: { staff_id: staffId, week_start, type: 'week_note', week_note: String(week_note || '').slice(0, 200) } },
            { upsert: true }
        );
        res.json({ message: 'Note enregistrée' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dispos', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié' });
    // Vérifier que ce staff a le droit de soumettre des dispos
    const staffDoc = await db.collection('staff').findOne({ _id: new ObjectId(staffId) });
    if (staffDoc && staffDoc.can_submit_dispos === false)
        return res.status(403).json({ error: 'Tu n\'es pas autorisé à envoyer des disponibilités.' });
    const settings = await db.collection('settings').findOne({ key: 'dispo' }) || { open: true };
    const now = new Date();
    if (!settings.open) return res.status(403).json({ error: 'La saisie des disponibilités est fermée.' });
    const effectiveDeadline = computeEffectiveDeadline(settings.custom_deadline || null, now);
    if (!settings.force_open && now > effectiveDeadline)
        return res.status(403).json({ error: 'La deadline est passée.' });
    const { dispos } = req.body;
    if (!Array.isArray(dispos) || dispos.length === 0) return res.status(400).json({ error: 'Aucune disponibilité fournie' });
    try {
        const ops = dispos.map(d => ({
            updateOne: {
                filter: { staff_id: staffId, date: d.date, type: d.type || 'custom' },
                update: { $setOnInsert: {
                    staff_id: staffId, staff_name: req.session.user.name || '',
                    date: d.date, type: d.type || 'custom',
                    start_time: parseFloat(d.start_time), end_time: parseFloat(d.end_time),
                    note: d.note || '', status: 'pending', created_at: new Date(),
                }},
                upsert: true,
            },
        }));
        const result = await db.collection('availabilities').bulkWrite(ops, { ordered: false });
        const inserted = result.upsertedCount;
        if (inserted === 0) return res.status(409).json({ error: 'Des disponibilités ont déjà été soumises pour cette période.' });
        res.status(201).json({ message: inserted + ' disponibilité(s) enregistrée(s)' });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dispos/pending', checkDB, requirePatron, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        const dispos = await db.collection('availabilities').find({ date: { $gte: from, $lte: to }, status: 'pending' }).sort({ date: 1, start_time: 1 }).toArray();
        res.json(dispos);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dispos/count', checkDB, requirePatron, async (req, res) => {
    try {
        const count = await db.collection('availabilities').countDocuments({ status: 'pending' });
        res.json({ count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/dispos/:id/confirm', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { establishment_id, create_shift } = req.body;
    if (!establishment_id) return res.status(400).json({ error: 'establishment_id requis' });
    try {
        const dispo = await db.collection('availabilities').findOne({ _id: new ObjectId(req.params.id) });
        if (!dispo) return res.status(404).json({ error: 'Dispo introuvable' });
        await db.collection('availabilities').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'confirmed', establishment_id } });
        if (create_shift) {
            const staffMember = await db.collection('staff').findOne({ _id: new ObjectId(dispo.staff_id) });
            await db.collection('shifts').insertOne({
                staff_id: dispo.staff_id, staff_name: dispo.staff_name,
                establishment_id, date: dispo.date,
                start_time: dispo.start_time, end_time: dispo.end_time,
                color: staffMember?.color || '#3498db',
            });
        }
        res.json({ message: 'Dispo confirmée' + (create_shift ? ' et shift créé' : '') });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/dispos/:id/reject', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const dispo = await db.collection('availabilities').findOne({ _id: new ObjectId(req.params.id) });
        if (!dispo) return res.status(404).json({ error: 'Dispo introuvable' });
        const result = await db.collection('availabilities').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'rejected' } });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Dispo introuvable' });
        res.json({ message: 'Dispo refusée' });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Échanges de shifts (F-05) — DÉSACTIVÉ ───────────────────────────────────
//
// Collection `shift_swaps` : { from_shift_id, to_shift_id, from_staff_id,
//   to_staff_id, from_establishment_id, to_establishment_id, status, note,
//   created_at, decided_at, decided_by }
// Échange autorisé entre établissements différents. Validation patron requise.

// POST — un staff propose un échange (son shift contre celui d'un collègue)
app.post('/api/shift-swaps', checkDB, requireAuth, async (req, res) => {
    const user = req.session.user;
    const staffId = user.staff_id;
    if (!staffId) return res.status(403).json({ error: 'Action réservée au staff' });

    const { from_shift_id, to_shift_id, note } = req.body;
    if (!isValidObjectId(from_shift_id) || !isValidObjectId(to_shift_id)) {
        return res.status(400).json({ error: 'IDs invalides' });
    }
    if (from_shift_id === to_shift_id) {
        return res.status(400).json({ error: 'Les deux shifts doivent être différents' });
    }
    try {
        const [fromShift, toShift] = await Promise.all([
            db.collection('shifts').findOne({ _id: new ObjectId(from_shift_id) }),
            db.collection('shifts').findOne({ _id: new ObjectId(to_shift_id) }),
        ]);
        if (!fromShift || !toShift) return res.status(404).json({ error: 'Shift introuvable' });

        // Le staff doit être propriétaire du from_shift
        if (String(fromShift.staff_id) !== String(staffId)) {
            return res.status(403).json({ error: 'Vous n\'êtes pas propriétaire de ce shift' });
        }
        // On ne peut pas demander à échanger avec son propre shift
        if (String(toShift.staff_id) === String(staffId)) {
            return res.status(400).json({ error: 'Choisissez un shift d\'un collègue' });
        }
        // Pas de Joker
        if (fromShift.is_joker || toShift.is_joker || toShift.staff_id === '__joker__' || fromShift.staff_id === '__joker__') {
            return res.status(400).json({ error: 'Échange impossible avec un Joker' });
        }
        // Shifts futurs uniquement (date >= aujourd'hui)
        const today = new Date();
        const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        if (fromShift.date < todayStr || toShift.date < todayStr) {
            return res.status(400).json({ error: 'Seuls les shifts futurs peuvent être échangés' });
        }
        // Pas de demande pending déjà existante sur l'un des deux shifts
        const existing = await db.collection('shift_swaps').findOne({
            status: 'pending',
            $or: [
                { from_shift_id: String(fromShift._id) },
                { to_shift_id:   String(fromShift._id) },
                { from_shift_id: String(toShift._id)   },
                { to_shift_id:   String(toShift._id)   },
            ],
        });
        if (existing) return res.status(409).json({ error: 'Une demande d\'échange est déjà en cours sur l\'un de ces shifts' });

        const swap = {
            from_shift_id:         String(fromShift._id),
            to_shift_id:           String(toShift._id),
            from_staff_id:         String(fromShift.staff_id),
            from_staff_name:       fromShift.staff_name || '',
            to_staff_id:           String(toShift.staff_id),
            to_staff_name:         toShift.staff_name || '',
            from_establishment_id: fromShift.establishment_id,
            to_establishment_id:   toShift.establishment_id,
            from_date:             fromShift.date,
            to_date:               toShift.date,
            from_start_time:       fromShift.start_time,
            from_end_time:         fromShift.end_time,
            to_start_time:         toShift.start_time,
            to_end_time:           toShift.end_time,
            note:                  (note || '').toString().slice(0, 280),
            status:                'pending',
            created_at:            new Date(),
            decided_at:            null,
            decided_by:            null,
        };
        const result = await db.collection('shift_swaps').insertOne(swap);

        // Notif in-app patrons des deux établissements
        const message = (user.name || 'Un staff') + ' propose un échange : ' +
            formatDateFR(fromShift.date) + ' ' + formatShiftTime(fromShift.start_time) + '→' + formatShiftTime(fromShift.end_time) +
            ' contre ' + (toShift.staff_name || 'collègue') + ' le ' +
            formatDateFR(toShift.date) + ' ' + formatShiftTime(toShift.start_time) + '→' + formatShiftTime(toShift.end_time);
        await createNotifForPatrons(fromShift.establishment_id, 'shift_swap_request', message, { swap_id: String(result.insertedId) });
        if (toShift.establishment_id !== fromShift.establishment_id) {
            await createNotifForPatrons(toShift.establishment_id, 'shift_swap_request', message, { swap_id: String(result.insertedId) });
        }

        res.status(201).json({ message: 'Demande d\'échange envoyée', swap_id: String(result.insertedId) });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET — patron : liste des demandes en attente
app.get('/api/shift-swaps/pending', checkDB, requirePatron, async (req, res) => {
    const user = req.session.user;
    try {
        const swaps = await db.collection('shift_swaps').find({ status: 'pending' }).sort({ created_at: -1 }).toArray();
        // Filtrer : directeur ne voit que les swaps impliquant ses établissements
        const filtered = user.role === 'patron'
            ? swaps
            : swaps.filter(s => canAccessEstablishment(user, s.from_establishment_id) || canAccessEstablishment(user, s.to_establishment_id));
        res.json(filtered);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET — patron : compteur pour badge header
app.get('/api/shift-swaps/count', checkDB, requirePatron, async (req, res) => {
    const user = req.session.user;
    try {
        if (user.role === 'patron') {
            const count = await db.collection('shift_swaps').countDocuments({ status: 'pending' });
            return res.json({ count });
        }
        const swaps = await db.collection('shift_swaps').find({ status: 'pending' }).toArray();
        const count = swaps.filter(s => canAccessEstablishment(user, s.from_establishment_id) || canAccessEstablishment(user, s.to_establishment_id)).length;
        res.json({ count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET — staff : ses propres demandes (pending + récentes)
app.get('/api/shift-swaps/mine', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.json([]);
    try {
        const swaps = await db.collection('shift_swaps').find({
            $or: [{ from_staff_id: String(staffId) }, { to_staff_id: String(staffId) }],
        }).sort({ created_at: -1 }).limit(50).toArray();
        res.json(swaps);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH — patron approuve : swap effectif des staff sur les 2 shifts
app.patch('/api/shift-swaps/:id/approve', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const user = req.session.user;
    try {
        const swap = await db.collection('shift_swaps').findOne({ _id: new ObjectId(req.params.id) });
        if (!swap) return res.status(404).json({ error: 'Demande introuvable' });
        if (swap.status !== 'pending') return res.status(409).json({ error: 'Demande déjà traitée' });

        // Directeur : doit avoir accès à l'un des deux établissements
        if (!canAccessEstablishment(user, swap.from_establishment_id) && !canAccessEstablishment(user, swap.to_establishment_id)) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        // Recharger les shifts (ils peuvent avoir bougé entre temps)
        const [fromShift, toShift] = await Promise.all([
            db.collection('shifts').findOne({ _id: new ObjectId(swap.from_shift_id) }),
            db.collection('shifts').findOne({ _id: new ObjectId(swap.to_shift_id) }),
        ]);
        if (!fromShift || !toShift) {
            await db.collection('shift_swaps').updateOne({ _id: swap._id }, { $set: { status: 'rejected', decided_at: new Date(), decided_by: String(user._id), reject_reason: 'Shift supprimé' } });
            return res.status(410).json({ error: 'Un des shifts n\'existe plus, demande annulée' });
        }

        // Récupérer les couleurs des 2 staff (un staff garde sa couleur même sur un shift d'un autre)
        const [fromStaffDoc, toStaffDoc] = await Promise.all([
            isValidObjectId(swap.from_staff_id) ? db.collection('staff').findOne({ _id: new ObjectId(swap.from_staff_id) }) : null,
            isValidObjectId(swap.to_staff_id)   ? db.collection('staff').findOne({ _id: new ObjectId(swap.to_staff_id)   }) : null,
        ]);
        const fromColor = fromStaffDoc?.color || fromShift.color || '#3498db';
        const toColor   = toStaffDoc?.color   || toShift.color   || '#3498db';

        // Swap : from_shift devient porté par to_staff, et vice versa
        await Promise.all([
            db.collection('shifts').updateOne({ _id: fromShift._id }, { $set: {
                staff_id:   swap.to_staff_id,
                staff_name: swap.to_staff_name,
                color:      toColor,
            }}),
            db.collection('shifts').updateOne({ _id: toShift._id }, { $set: {
                staff_id:   swap.from_staff_id,
                staff_name: swap.from_staff_name,
                color:      fromColor,
            }}),
        ]);
        await db.collection('shift_swaps').updateOne({ _id: swap._id }, { $set: {
            status: 'approved', decided_at: new Date(), decided_by: String(user._id),
        }});

        res.json({ message: 'Échange approuvé' });
        touchLastUpdated();

        // Push aux deux staff
        (async () => {
            try {
                await sendPushToStaff([swap.from_staff_id, swap.to_staff_id], {
                    title:   '✅ Échange approuvé',
                    body:    'Votre échange de shift a été validé par le patron.',
                    tag:     'shift-modifie',
                    url:     '/planning.html',
                    actions: [{ action: 'voir', title: 'Voir les changements' }],
                });
            } catch {}
        })();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH — patron refuse
app.patch('/api/shift-swaps/:id/reject', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const user = req.session.user;
    const reason = (req.body?.reason || '').toString().slice(0, 280);
    try {
        const swap = await db.collection('shift_swaps').findOne({ _id: new ObjectId(req.params.id) });
        if (!swap) return res.status(404).json({ error: 'Demande introuvable' });
        if (swap.status !== 'pending') return res.status(409).json({ error: 'Demande déjà traitée' });

        if (!canAccessEstablishment(user, swap.from_establishment_id) && !canAccessEstablishment(user, swap.to_establishment_id)) {
            return res.status(403).json({ error: 'Accès refusé' });
        }

        await db.collection('shift_swaps').updateOne({ _id: swap._id }, { $set: {
            status: 'rejected', decided_at: new Date(), decided_by: String(user._id), reject_reason: reason || null,
        }});

        res.json({ message: 'Échange refusé' });
        touchLastUpdated();

        // Push au proposeur uniquement
        (async () => {
            try {
                await sendPushToStaff([swap.from_staff_id], {
                    title:   '❌ Échange refusé',
                    body:    reason ? 'Votre demande d\'échange a été refusée : ' + reason : 'Votre demande d\'échange a été refusée par le patron.',
                    tag:     'shift-modifie',
                    url:     '/planning.html',
                    actions: [{ action: 'voir', title: 'Voir les changements' }],
                });
            } catch {}
        })();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET — staff : liste des shifts futurs échangeables (autres staff, ses établissements)
app.get('/api/shifts-for-swap', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.json([]);
    const from = req.query.from;
    const to   = req.query.to;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        // Établissements où le staff a au moins un shift dans la période
        const own = await db.collection('shifts').find({
            staff_id: String(staffId),
            date: { $gte: from, $lte: to },
        }).project({ establishment_id: 1 }).toArray();
        const estabIds = [...new Set(own.map(s => s.establishment_id))];
        if (estabIds.length === 0) return res.json([]);

        // Shifts futurs des autres staff dans ces établissements
        const shifts = await db.collection('shifts').find({
            establishment_id: { $in: estabIds },
            date: { $gte: from, $lte: to },
            staff_id: { $nin: [String(staffId), '__joker__'] },
            is_joker: { $ne: true },
        }).sort({ date: 1, start_time: 1 }).toArray();

        // Exclure les shifts ayant déjà une demande d'échange pending
        const pendingSwaps = await db.collection('shift_swaps').find({
            status: 'pending',
        }).project({ from_shift_id: 1, to_shift_id: 1 }).toArray();
        const blockedIds = new Set();
        pendingSwaps.forEach(sw => { blockedIds.add(sw.from_shift_id); blockedIds.add(sw.to_shift_id); });

        const out = shifts
            .filter(s => !blockedIds.has(String(s._id)))
            .map(s => ({
                _id:              String(s._id),
                staff_id:         s.staff_id,
                staff_name:       s.staff_name,
                color:            s.color,
                date:             s.date,
                start_time:       s.start_time,
                end_time:         s.end_time,
                establishment_id: s.establishment_id,
            }));
        res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE — staff annule sa propre demande (tant que pending)
app.delete('/api/shift-swaps/:id', checkDB, requireAuth, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const staffId = req.session.user.staff_id;
    try {
        const swap = await db.collection('shift_swaps').findOne({ _id: new ObjectId(req.params.id) });
        if (!swap) return res.status(404).json({ error: 'Demande introuvable' });
        if (swap.status !== 'pending') return res.status(409).json({ error: 'Demande déjà traitée' });
        if (String(swap.from_staff_id) !== String(staffId)) return res.status(403).json({ error: 'Seul le proposeur peut annuler' });
        await db.collection('shift_swaps').deleteOne({ _id: swap._id });
        res.json({ message: 'Demande annulée' });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

─────────────────────────────────────────────────────────────────────────── */

// ── Publication du planning ───────────────────────────────────────────────────

// GET statut publication d'une semaine
app.get('/api/publish/:weekStart', checkDB, requireAuth, async (req, res) => {
    try {
        // La semaine en cours et les semaines passées sont automatiquement publiées
        if (_isAutoPublished(req.params.weekStart)) return res.json({ published: true, auto: true });
        const pub = await db.collection('settings').findOne({ key: 'publish_' + req.params.weekStart });
        res.json({ published: !!(pub && pub.published) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH publier/dépublier une semaine (patron)
app.patch('/api/publish/:weekStart', checkDB, requirePatron, async (req, res) => {
    const { published } = req.body;
    const weekStart = req.params.weekStart;
    try {
        await db.collection('settings').updateOne(
            { key: 'publish_' + weekStart },
            { $set: { key: 'publish_' + weekStart, published: !!published, updated_at: new Date() } },
            { upsert: true }
        );

        // ── Notifications push à la publication ───────────────────────────────
        if (published) {
            // Récupérer tous les staff_ids qui ont un shift cette semaine (hors jokers)
            const weekEnd = (() => {
                const d = new Date(weekStart + 'T12:00:00');
                d.setDate(d.getDate() + 6);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const j = String(d.getDate()).padStart(2, '0');
                return y + '-' + m + '-' + j;
            })();

            db.collection('shifts').distinct('staff_id', {
                date: { $gte: weekStart, $lte: weekEnd },
                staff_id: { $ne: '__joker__' },
                is_joker: { $ne: true },
            }).then(staffIds => {
                if (!staffIds.length) return;
                return sendPushToStaff(staffIds, {
                    title:   '📅 Planning disponible',
                    body:    'La ' + formatWeekFR(weekStart) + ' est publiée — consulte ton planning.',
                    tag:     'planning-publie',
                    url:     '/planning.html',
                    actions: [{ action: 'voir', title: 'Voir mon planning' }],
                });
            }).catch(() => { /* silencieux — ne pas bloquer */ });
        }

        res.json({ message: published ? 'Planning publié' : 'Planning dépublié' });
        touchLastUpdated();
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET dispos confirmées pour une semaine (affichage fond planning patron)
app.get('/api/dispos/confirmed', checkDB, requirePatron, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        const dispos = await db.collection('availabilities').find({
            date:   { $gte: from, $lte: to },
            status: 'confirmed',
        }).toArray();
        res.json(dispos);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rappel dispo manuel (patron) ─────────────────────────────────────────────

app.post('/api/dispos/rappel', checkDB, requirePatron, async (req, res) => {
    const { week_start, message } = req.body;
    if (!week_start) return res.status(400).json({ error: 'week_start requis' });

    const [y, mo, d] = week_start.split('-').map(Number);
    const pad = n => String(n).padStart(2, '0');
    const weDate = new Date(y, mo - 1, d + 6);
    const week_end = weDate.getFullYear() + '-' + pad(weDate.getMonth() + 1) + '-' + pad(weDate.getDate());

    try {
        const settings = await db.collection('settings').findOne({ key: 'dispo' }) || {};
        const deadline = computeEffectiveDeadline(settings.custom_deadline || null, new Date());
        const deadlineStr = deadline.getDate() + '/' + (deadline.getMonth() + 1) + '/' + deadline.getFullYear();
        const msgText = (message && message.trim()) || ('⏰ N\'oublie pas d\'envoyer tes disponibilités avant le ' + deadlineStr);

        const allStaffDocs = await db.collection('staff').find({ can_submit_dispos: true }).toArray();
        const allStaffIds  = allStaffDocs.map(s => String(s._id));

        const existing = await db.collection('availabilities').find({
            staff_id: { $in: allStaffIds },
            date:     { $gte: week_start, $lte: week_end },
            status:   { $in: ['pending', 'confirmed'] },
        }, { projection: { staff_id: 1 } }).toArray();
        const alreadyIds = new Set(existing.map(doc => doc.staff_id));

        const targets    = allStaffDocs.filter(s => !alreadyIds.has(String(s._id)));
        const targetIds  = targets.map(s => String(s._id));

        if (targets.length === 0) return res.json({ sent: 0 });

        await sendPushToStaff(targetIds, {
            title:   'Templyo — Rappel dispos',
            body:    msgText,
            tag:     'rappel-dispo',
            url:     '/planning.html#dispos',
            actions: [{ action: 'envoyer', title: 'Envoyer mes dispos' }],
        });

        await db.collection('notifications').insertOne({
            type:       'rappel_dispo',
            message:    'Rappel dispos envoyé à ' + targets.length + ' membre(s) — semaine du ' + week_start,
            week_start,
            sent_to:    targetIds,
            read:       false,
            created_at: new Date(),
        });

        res.json({ sent: targets.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rôles ─────────────────────────────────────────────────────────────────────

app.get('/api/roles', checkDB, requireAuth, async (req, res) => {
    try {
        const roles = await db.collection('roles').find().sort({ type: 1, name: 1 }).toArray();
        res.json(roles);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/roles', checkDB, requirePatron, async (req, res) => {
    const { name, type } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    if (!['responsable', 'informatif'].includes(type)) return res.status(400).json({ error: 'Type: responsable ou informatif' });
    try {
        const existing = await db.collection('roles').findOne({ name: name.trim() });
        if (existing) return res.status(409).json({ error: 'Ce rôle existe déjà' });
        const result = await db.collection('roles').insertOne({ name: name.trim(), type, created_at: new Date() });
        res.status(201).json({ _id: result.insertedId, name: name.trim(), type });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/roles/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        await db.collection('roles').deleteOne({ _id: new ObjectId(req.params.id) });
        // Retirer ce rôle de tous les staffs
        await db.collection('staff').updateMany(
            { roles: req.params.id },
            { $pull: { roles: req.params.id } }
        );
        res.json({ message: 'Rôle supprimé' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET shifts du jour avec alerte responsable manquant
app.get('/api/shifts/:establishmentId/:date/check-responsable', checkDB, requirePatron, async (req, res) => {
    try {
        const shifts = await db.collection('shifts')
            .find({ establishment_id: req.params.establishmentId, date: req.params.date })
            .toArray();

        const responsableRoles = await db.collection('roles').find({ type: 'responsable' }).toArray();
        const responsableIds   = responsableRoles.map(r => String(r._id));

        // Vérifier si au moins un shift a un rôle responsable
        const hasResponsable = shifts.some(s =>
            s.roles && s.roles.some(r => responsableIds.includes(r))
        );

        res.json({ hasResponsable, count: shifts.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Récap mensuel ────────────────────────────────────────────────────────────

app.get('/api/recap-mensuel', checkDB, requirePatron, async (req, res) => {
    const { month, establishment_id } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month))
        return res.status(400).json({ error: 'month requis (format YYYY-MM)' });
    try {
        const [y, m] = month.split('-').map(Number);
        const firstDay = y + '-' + String(m).padStart(2, '0') + '-01';
        const lastDate = new Date(y, m, 0); // dernier jour du mois
        const lastDay  = y + '-' + String(m).padStart(2, '0') + '-' + String(lastDate.getDate()).padStart(2, '0');

        const query = {
            date: { $gte: firstDay, $lte: lastDay },
            $and: [
                { $or: [{ is_joker: { $ne: true } }, { is_joker: { $exists: false } }] },
                { staff_id: { $ne: '__joker__' } },
            ],
        };
        if (establishment_id) query.establishment_id = establishment_id;

        const shifts = await db.collection('shifts').find(query).toArray();

        // Grouper par staff_id
        const byStaff = {};
        shifts.forEach(s => {
            if (!byStaff[s.staff_id]) byStaff[s.staff_id] = { staff_id: s.staff_id, staff_name: s.staff_name, shifts: [] };
            byStaff[s.staff_id].shifts.push(s);
        });

        // Calculer les stats par staff
        const staffList = await db.collection('staff').find().toArray();
        const staffMap  = {};
        staffList.forEach(s => { staffMap[String(s._id)] = s; });

        const result = Object.values(byStaff).map(entry => {
            const dates    = [...new Set(entry.shifts.map(s => s.date))];
            const planned  = entry.shifts.reduce((a, s) => a + (s.end_time - s.start_time), 0);
            const realShifts    = entry.shifts.filter(s => s.real_start != null && s.real_end != null);
            const realTotal     = realShifts.reduce((a, s) => a + (s.real_end - s.real_start), 0);
            const hasAnyReal    = realShifts.length > 0;
            const allPointed    = realShifts.length === entry.shifts.length;
            const extraShifts   = entry.shifts.filter(s => s.extra === true);
            const extraHours    = extraShifts.reduce((a, s) => {
                const start = s.real_start != null ? s.real_start : s.start_time;
                const end   = s.real_end   != null ? s.real_end   : s.end_time;
                return a + (end - start);
            }, 0);

            const sm = staffMap[entry.staff_id];
            return {
                staff_id:    entry.staff_id,
                staff_name:  sm ? sm.name : entry.staff_name,
                color:       sm ? sm.color : '#888',
                days:        dates.length,
                planned_hours: Math.round(planned * 100) / 100,
                real_hours:    hasAnyReal ? Math.round(realTotal * 100) / 100 : null,
                ecart:         hasAnyReal ? Math.round((realTotal - planned) * 100) / 100 : null,
                all_pointed:   allPointed,
                partial:       hasAnyReal && !allPointed,
                extra_count:   extraShifts.length,
                extra_hours:   Math.round(extraHours * 100) / 100,
                total_shifts:  entry.shifts.length,
            };
        });

        result.sort((a, b) => a.staff_name.localeCompare(b.staff_name));
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Pointage (compte établissement) ──────────────────────────────────────────

// GET responsable de soirée — vérifie si le staff/directeur connecté peut faire le pointage ce soir
// Pour un directeur : retourne tous ses établissements (il a toujours accès)
// Pour un staff : vérifie isResponsablePourSoiree sur chacun de ses shifts du jour
app.get('/api/me/responsable-tonight', checkDB, requireAuth, async (req, res) => {
    const user = req.session.user;
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.json({ isResponsable: false });
    try {
        // Directeur : accès pointage sur ses établissements assignés
        if (user.role === 'directeur') {
            const assigned = user.assigned_establishments || [];
            if (assigned.length === 0) return res.json({ isResponsable: false });
            return res.json({ isResponsable: true, establishments: assigned });
        }

        if (!user.staff_id) return res.json({ isResponsable: false });

        // Staff : chercher ses shifts du jour (les rôles sont sur le profil staff, pas le shift)
        const myShifts = await db.collection('shifts').find({
            staff_id: user.staff_id,
            date,
        }).toArray();

        if (myShifts.length === 0) return res.json({ isResponsable: false });

        // Vérifier que ce staff a bien un rôle 'responsable' dans son profil
        const staffDoc = isValidObjectId(user.staff_id)
            ? await db.collection('staff').findOne({ _id: new ObjectId(user.staff_id) })
            : null;
        const responsableRoles = await db.collection('roles').find({ type: 'responsable' }).toArray();
        const responsableIds   = responsableRoles.map(r => String(r._id));
        const staffRoles       = (staffDoc && staffDoc.roles) || [];
        const isResp = staffRoles.some(r => responsableIds.includes(r));
        if (!isResp) return res.json({ isResponsable: false });

        // Vérifier pour chaque établissement si ce staff est LE responsable de pointage
        const accessibleEstabs = [];
        for (const shift of myShifts) {
            const ok = await isResponsablePourSoiree(user.staff_id, shift.establishment_id, date);
            if (ok) accessibleEstabs.push(shift.establishment_id);
        }

        if (accessibleEstabs.length === 0) return res.json({ isResponsable: false });
        res.json({ isResponsable: true, establishments: accessibleEstabs });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET/PATCH paramètres pointage (heure de bascule jour)
app.get('/api/pointage-settings', checkDB, requireAuth, async (req, res) => {
    try {
        const s = await db.collection('settings').findOne({ key: 'pointage' }) || {};
        res.json({
            cutoff_hour:      s.cutoff_hour      ?? 9,  // fin de fenêtre (défaut 9h)
            cutoff_open_hour: s.cutoff_open_hour ?? 0,  // début de fenêtre (défaut minuit)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/pointage-settings', checkDB, requireAdmin, async (req, res) => {
    const { cutoff_hour, cutoff_open_hour } = req.body;
    if (cutoff_hour == null || cutoff_hour < 0 || cutoff_hour > 23)
        return res.status(400).json({ error: 'cutoff_hour entre 0 et 23 requis' });
    const openHour = cutoff_open_hour != null ? parseInt(cutoff_open_hour) : 0;
    if (openHour < 0 || openHour > 23)
        return res.status(400).json({ error: 'cutoff_open_hour entre 0 et 23 requis' });
    try {
        await db.collection('settings').updateOne(
            { key: 'pointage' },
            { $set: { key: 'pointage', cutoff_hour: parseInt(cutoff_hour), cutoff_open_hour: openHour } },
            { upsert: true }
        );
        res.json({ message: 'Paramètres pointage mis à jour' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET shifts du jour pour l'établissement lié au compte
app.get('/api/pointage/:date', checkDB, requireAuth, async (req, res) => {
    const user = req.session.user;
    // Accessible par le compte établissement ET le patron
    const estabId = user.role === 'etablissement'
        ? user.establishment_id
        : req.query.establishment_id;
    if (!estabId) return res.status(400).json({ error: 'establishment_id requis' });
    try {
        const shifts = await db.collection('shifts')
            .find({ establishment_id: estabId, date: req.params.date })
            .sort({ start_time: 1 }).toArray();
        res.json(shifts);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH désigner le responsable de pointage pour un établissement/date
// Dé-désigne tous les autres responsables du même établissement ce jour
app.patch('/api/shifts/:id/pointage-resp', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { value } = req.body; // true | false
    try {
        const shift = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!shift) return res.status(404).json({ error: 'Shift introuvable' });
        if (!canAccessEstablishment(req.session.user, shift.establishment_id))
            return res.status(403).json({ error: 'Accès refusé' });

        if (value === true) {
            // Retirer pointage_resp de tous les autres responsables du même établissement/date
            await db.collection('shifts').updateMany(
                { establishment_id: shift.establishment_id, date: shift.date, _id: { $ne: new ObjectId(req.params.id) } },
                { $unset: { pointage_resp: '' } }
            );
        }
        await db.collection('shifts').updateOne(
            { _id: new ObjectId(req.params.id) },
            value === true ? { $set: { pointage_resp: true } } : { $unset: { pointage_resp: '' } }
        );
        res.json({ message: 'Responsable pointage mis à jour' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH heures réelles sur un shift existant
app.patch('/api/shifts/:id/pointage', checkDB, requireAuth, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { real_start, real_end } = req.body;
    // Accepter null explicite (effacement) ou valeurs numériques
    const hasStart = req.body.hasOwnProperty('real_start');
    const hasEnd   = req.body.hasOwnProperty('real_end');
    if (!hasStart && !hasEnd) return res.status(400).json({ error: 'real_start ou real_end requis' });
    try {
        const existing = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!existing) return res.status(404).json({ error: 'Shift introuvable' });
        const user = req.session.user;
        if (user.role === 'etablissement' && user.establishment_id !== existing.establishment_id)
            return res.status(403).json({ error: 'Accès refusé' });
        if (user.role !== 'etablissement' && !canAccessEstablishment(user, existing.establishment_id)) {
            // Autoriser le staff responsable de soirée sur cet établissement
            const ok = await isResponsablePourSoiree(user.staff_id, existing.establishment_id, existing.date);
            if (!ok) return res.status(403).json({ error: 'Accès refusé' });
        }
        const update = {};
        if (hasStart) update.real_start = real_start != null ? parseFloat(real_start) : null;
        if (hasEnd)   update.real_end   = real_end   != null ? parseFloat(real_end)   : null;
        await db.collection('shifts').updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
        res.json({ message: 'Heures réelles enregistrées' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST service non planifié (extra)
app.post('/api/shifts/extra', checkDB, requireAuth, async (req, res) => {
    const user = req.session.user;
    const { staff_id, staff_name, date, real_start, real_end, establishment_id } = req.body;
    if (!date || real_start == null || real_end == null)
        return res.status(400).json({ error: 'date, real_start, real_end requis' });
    // Déterminer l'établissement selon le rôle
    const estabId = user.role === 'etablissement' ? user.establishment_id : establishment_id;
    if (!estabId) return res.status(400).json({ error: 'establishment_id requis' });
    if (user.role !== 'etablissement' && !canAccessEstablishment(user, estabId)) {
        const ok = await isResponsablePourSoiree(user.staff_id, estabId, date);
        if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    }
    try {
        // Chercher le profil staff : par staff_id si fourni, sinon par nom exact
        let color = '#95a5a6';
        let resolvedName = staff_name || 'Inconnu';
        let resolvedStaffId = staff_id || null;
        if (staff_id && isValidObjectId(staff_id)) {
            const staffDoc = await db.collection('staff').findOne({ _id: new ObjectId(staff_id) });
            if (staffDoc) { color = staffDoc.color || color; resolvedName = staffDoc.name; }
        } else if (staff_name) {
            // Pas de staff_id — chercher par nom exact (insensible à la casse)
            const staffDoc = await db.collection('staff').findOne({
                name: { $regex: '^' + staff_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' }
            });
            if (staffDoc) {
                color           = staffDoc.color || color;
                resolvedName    = staffDoc.name;
                resolvedStaffId = String(staffDoc._id);
            }
        }
        const shift = {
            staff_id:         resolvedStaffId,
            staff_name:       resolvedName,
            establishment_id: estabId,
            date,
            start_time:       parseFloat(real_start),
            end_time:         parseFloat(real_end),
            real_start:       parseFloat(real_start),
            real_end:         parseFloat(real_end),
            color,
            extra:            true,
            created_at:       new Date(),
        };
        const result = await db.collection('shifts').insertOne(shift);
        res.status(201).json({ ...shift, _id: result.insertedId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Web Push — abonnement ─────────────────────────────────────────────────────

// GET clé publique VAPID (nécessaire côté client pour s'abonner)
app.get('/api/push/vapid-public-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ error: 'Web Push non configuré' });
    res.json({ publicKey: key });
});

// POST enregistrer ou mettre à jour une PushSubscription
app.post('/api/push/subscribe', checkDB, requireAuth, async (req, res) => {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint)
        return res.status(400).json({ error: 'subscription invalide' });
    const userId = req.session.user._id;
    try {
        await db.collection('push_subscriptions').updateOne(
            { user_id: userId, 'subscription.endpoint': subscription.endpoint },
            { $set: { user_id: userId, subscription, updated_at: new Date() } },
            { upsert: true }
        );
        res.json({ message: 'Abonnement enregistré' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE se désabonner
app.delete('/api/push/subscribe', checkDB, requireAuth, async (req, res) => {
    const { endpoint } = req.body;
    const userId = req.session.user._id;
    try {
        await db.collection('push_subscriptions').deleteOne({
            user_id: userId,
            'subscription.endpoint': endpoint,
        });
        res.json({ message: 'Désabonné' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST envoyer une notification test à soi-même (diagnostic)
app.post('/api/push/test', checkDB, requireAuth, async (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)
        return res.status(503).json({ error: 'Web Push non configuré côté serveur (VAPID manquant)' });

    const userId = req.session.user._id;
    try {
        const subs = await db.collection('push_subscriptions').find({ user_id: userId }).toArray();
        if (subs.length === 0)
            return res.status(404).json({ error: 'Aucune subscription trouvée pour ce compte — clique d\'abord sur 🔔' });

        const payload = JSON.stringify({
            title: '🔔 Test Templyo',
            body:  'Les notifications fonctionnent correctement !',
            tag:   'test-push',
            url:   '/planning.html',
        });

        const results = await Promise.allSettled(subs.map(sub => webpush.sendNotification(sub.subscription, payload)));
        const errors  = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);
        const ok      = results.filter(r => r.status === 'fulfilled').length;
        res.json({ sent: ok, errors });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Utilitaire formatage heure shift ─────────────────────────────────────────

function formatShiftTime(h) {
    const hh = Math.floor(h % 24);
    const mm = Math.round((h % 1) * 60);
    return String(hh).padStart(2, '0') + 'h' + (mm > 0 ? String(mm).padStart(2, '0') : '');
}

// "2026-04-14" → "lundi 14 avril" (pour push/notifs)
function formatDateFR(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// "2026-04-14" → "lun. 14 avr." (compact, pour in-app patron)
function formatDateShortFR(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// "2026-04-14" (lundi) → "sem. du 14 avr." (pour notification de publication)
function formatWeekFR(weekStartStr) {
    const d = new Date(weekStartStr + 'T12:00:00');
    return 'sem. du ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}


// ── Last-updated timestamp (polling auto-refresh) ─────────────────────────────

async function touchLastUpdated() {
    try {
        await db.collection('settings').updateOne(
            { key: 'last_updated' },
            { $set: { key: 'last_updated', ts: Date.now() } },
            { upsert: true }
        );
    } catch { /* silencieux — ne jamais bloquer une mutation pour ça */ }
}

// ── Routes notifications in-app ───────────────────────────────────────────────

// GET notifications du patron/directeur connecté (50 dernières)
app.get('/api/notifications', checkDB, requirePatron, async (req, res) => {
    const userId = req.session.user._id;
    try {
        const notifications = await db.collection('notifications')
            .find({ user_id: userId })
            .sort({ created_at: -1 })
            .limit(50)
            .toArray();
        res.json({ notifications });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH marquer toutes les notifications comme lues
app.patch('/api/notifications/read-all', checkDB, requirePatron, async (req, res) => {
    const userId = req.session.user._id;
    try {
        await db.collection('notifications').deleteMany({ user_id: userId });
        res.json({ message: 'Notifications supprimées' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// GET notifications in-app du staff connecté (non lues)
app.get('/api/notifications/mine', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.json({ notifications: [] });
    try {
        const notifications = await db.collection('staff_notifications')
            .find({ staff_id: staffId, read: false })
            .sort({ created_at: -1 })
            .limit(20)
            .toArray();
        res.json({ notifications });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH marquer toutes les notifications staff comme lues
app.patch('/api/notifications/mine/read', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.json({ ok: true });
    try {
        await db.collection('staff_notifications').updateMany(
            { staff_id: staffId, read: false },
            { $set: { read: true } }
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET timestamp dernière modification (polling auto-refresh clients)
app.get('/api/last-updated', checkDB, requireAuth, async (req, res) => {
    try {
        const doc = await db.collection('settings').findOne({ key: 'last_updated' });
        res.json({ ts: doc ? doc.ts : 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Route racine ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    if (!req.session?.user) return res.redirect('/login.html');
    if (req.session.user.role === 'etablissement') return res.redirect('/pointage.html');
    res.redirect('/index.html');
});

// ── Healthcheck ──────────────────────────────────────────────────────────────
// Public — utilisé par Railway (liveness) et monitoring externe.
// Ne révèle aucune info sensible : état base + uptime.
app.get('/health', async (req, res) => {
    let dbOk = false;
    try {
        if (db) { await db.command({ ping: 1 }); dbOk = true; }
    } catch (_) {}
    res.status(dbOk ? 200 : 503).json({
        ok:     dbOk,
        db:     dbOk,
        uptime: Math.round(process.uptime()),
    });
});

// ── Sentry error handler (après toutes les routes) ───────────────────────────
if (Sentry) {
    Sentry.setupExpressErrorHandler(app);
}

// Fallback : log les erreurs non capturées et renvoie 500 générique
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error on', req.method, req.url, ':', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Erreur interne' });
});

// ── Lancement ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 Serveur sur http://localhost:' + PORT);
    connectDB();
});