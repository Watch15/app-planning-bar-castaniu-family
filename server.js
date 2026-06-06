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
const {
    isValidObjectId, hashToken, normalizePhone,
    weekStart, currentWeekStart, disposWeekStart, isAutoPublished, isDatePublished, chargeMultiplier,
    toDateStr,
} = require('./lib/utils');

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

// Dev local : génère un secret aléatoire au boot si non défini, plutôt qu'une
// constante connue. Les sessions ne survivent pas au restart — comportement
// volontaire pour forcer la définition d'un .env en dev sérieux.
const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.warn('⚠️  SESSION_SECRET non défini — clé aléatoire générée. Les sessions seront perdues au prochain restart.');
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
// Nettoyage toutes les heures pour éviter les fuites mémoire.
// .unref() : ce timer de fond ne doit pas, à lui seul, maintenir le process en vie
// (sinon `require('./server')` en test empêcherait Node de quitter).
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimitMap) { if (now > v.resetAt) rateLimitMap.delete(k); }
}, 60 * 60 * 1000).unref();
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
        // Index unique pour daily_revenue (un CA par établissement et par date)
        db.collection('daily_revenue').createIndex(
            { establishment_id: 1, date: 1 },
            { unique: true }
        ).catch(e => console.warn('⚠️ Index daily_revenue:', e.message));
        // Index lookup notifications staff (find by staff_id + sort created_at desc, limit 20)
        db.collection('staff_notifications').createIndex(
            { staff_id: 1, created_at: -1 }
        ).catch(e => console.warn('⚠️ Index staff_notifications:', e.message));
        // TTL 30 jours sur notifications + staff_notifications (évite collection qui grossit infiniment)
        db.collection('notifications').createIndex(
            { created_at: 1 },
            { expireAfterSeconds: 30 * 24 * 60 * 60 }
        ).catch(e => console.warn('⚠️ TTL notifications:', e.message));
        db.collection('staff_notifications').createIndex(
            { created_at: 1 },
            { expireAfterSeconds: 30 * 24 * 60 * 60 }
        ).catch(e => console.warn('⚠️ TTL staff_notifications:', e.message));
        scheduleDailyAt10();
        cleanupOldJokers();
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
// Wrappers vers lib/utils.js (testés). Conservés pour compatibilité avec les
// nombreux callsites historiques (`_weekStart`, `_disposWeekStart`, `_isAutoPublished`).

const _weekStart       = weekStart;
const _isAutoPublished = isAutoPublished;

// Ensemble des lundis ('YYYY-MM-DD') des semaines explicitement publiées par le patron.
// Source unique pour les call sites « ce shift est-il sur une semaine publiée ? »
// (à combiner avec isDatePublished, qui gère l'auto-publication). R-02.
async function fetchPublishedWeeks() {
    if (!db) return new Set();
    const docs = await db.collection('settings')
        .find({ key: { $regex: '^publish_' }, published: true }, { projection: { key: 1 } })
        .toArray();
    return new Set(docs.map(p => p.key.replace('publish_', '')));
}

// ── Rappels automatiques dispos ───────────────────────────────────────────────

const _disposWeekStart = disposWeekStart;

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

        // Guard 1 : la semaine cible (weekStart = N+2 le lundi, N+1 les autres jours)
        // doit être publiée. La semaine en cours et les passées sont auto-publiées.
        if (!_isAutoPublished(weekStart)) {
            const pub = await db.collection('settings').findOne({ key: 'publish_' + weekStart });
            if (!pub || !pub.published) {
                console.log('⏭️  Rappels dispos ignorés : semaine cible du', weekStart, 'non publiée');
                return;
            }
        }
        // Guard 2 : la semaine EN COURS (= N+1 quand on est lundi N+1) doit avoir été
        // publiée EXPLICITEMENT par le patron (doc publish_<weekStart> en base).
        // Sans ça, le cycle est rompu et on ne sollicite pas N+2.
        // Note : on by-pass _isAutoPublished et on lit la base directement, car le patron
        // peut très bien ne pas avoir cliqué « Publier » même pour la semaine en cours.
        const currentWeekStr = dateStr(_weekStart(now));
        if (currentWeekStr !== weekStart) {
            const currentPub = await db.collection('settings').findOne({ key: 'publish_' + currentWeekStr });
            if (!currentPub || !currentPub.published) {
                console.log('⏭️  Rappels dispos ignorés : semaine en cours du', currentWeekStr, 'non publiée par le patron');
                return;
            }
        }

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
        // Dédup double : (1) ne part qu'une fois par weekStart cible, (2) skip si
        // des dispos existent déjà pour la semaine (dispos déjà collectées/traitées).
        const openDay = settings.open_day;
        if (openDay !== null && openDay !== undefined && todayDay === openDay && settings.notif_sent_open_week !== weekStart) {
            const existingDispos = await db.collection('availabilities').countDocuments({
                date: { $gte: weekStart, $lte: weekEnd },
                type: { $ne: 'week_note' },
            });
            if (existingDispos > 0) {
                // Dispos déjà collectées pour cette semaine — marquer comme envoyé pour ne plus rechecker
                await db.collection('settings').updateOne({ key: 'dispo' }, { $set: { notif_sent_open_week: weekStart } });
                console.log('⏭️  Notif ouverture skip : dispos déjà existantes pour', weekStart, '(', existingDispos, 'enregistrées)');
            } else {
                const allStaff = await db.collection('staff').find({ can_submit_dispos: true }).toArray();
                const ids = allStaff.map(s => String(s._id));
                await sendPushToStaff(ids, {
                    title:   'Templyo — Dispos ouvertes',
                    body:    '📅 Les disponibilités sont ouvertes ! Envoie les tiennes avant le ' + deadlineFmt,
                    tag:     'rappel-dispo',
                    url:     '/planning.html#dispos',
                    actions: [{ action: 'envoyer', title: 'Envoyer mes dispos' }],
                });
                await db.collection('settings').updateOne({ key: 'dispo' }, { $set: { notif_sent_open_week: weekStart, notif_sent_open: now } });
                console.log('✅ Rappel ouverture dispos → semaine du', weekStart, '→', ids.length, 'membres');
            }
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

async function cleanupOldJokers() {
    if (!db) return;
    try {
        const now  = new Date();
        const day  = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const mon  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        const pad  = n => String(n).padStart(2, '0');
        const mondayStr = mon.getFullYear() + '-' + pad(mon.getMonth() + 1) + '-' + pad(mon.getDate());
        const result = await db.collection('shifts').deleteMany({ is_joker: true, date: { $lt: mondayStr } });
        if (result.deletedCount > 0) console.log('🧹 Jokers expirés supprimés :', result.deletedCount);
    } catch (e) { console.error('❌ cleanupOldJokers error:', e.message); }
}

// Purge toutes les dispos dès qu'on passe à une semaine suivante : une fois la
// semaine entièrement écoulée, ses disponibilités n'ont plus de valeur (le shift
// confirmé reste la source de vérité). On supprime aussi bien les dispos datées
// (champ `date`) que les notes de semaine (type 'week_note', rattachées à un
// `week_start`).
async function cleanupPastDispos() {
    if (!db) return;
    try {
        const now  = new Date();
        const day  = now.getDay();
        const diff = day === 0 ? -6 : 1 - day; // lundi de la semaine en cours
        const mon  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        const pad  = n => String(n).padStart(2, '0');
        const mondayStr = mon.getFullYear() + '-' + pad(mon.getMonth() + 1) + '-' + pad(mon.getDate());
        const result = await db.collection('availabilities').deleteMany({
            $or: [
                { date:       { $lt: mondayStr } }, // dispos des semaines déjà passées
                { week_start: { $lt: mondayStr } }, // notes de semaine passées
            ],
        });
        if (result.deletedCount > 0) console.log('🧹 Dispos des semaines passées purgées :', result.deletedCount);

        // Purge aussi les notifications liées aux dispos devenues périmées
        // (uniquement les types « rappel dispo » — on ne touche pas aux autres notifs).
        const notifPatron = await db.collection('notifications').deleteMany({
            type: 'rappel_dispo', week_start: { $lt: mondayStr },
        });
        const notifStaff = await db.collection('staff_notifications').deleteMany({
            type: 'rappel-dispo', created_at: { $lt: mon },
        });
        const totalNotifs = notifPatron.deletedCount + notifStaff.deletedCount;
        if (totalNotifs > 0) console.log('🧹 Notifications dispos périmées purgées :', totalNotifs);
    } catch (e) { console.error('❌ cleanupPastDispos error:', e.message); }
}

function scheduleDailyAt10() {
    const now   = new Date();
    const next10 = new Date(now);
    next10.setHours(10, 0, 0, 0);
    if (next10 <= now) next10.setDate(next10.getDate() + 1);
    const msUntil10 = next10 - now;
    setTimeout(() => {
        checkDispoRappels();
        cleanupOldJokers();
        cleanupPastDispos();
        setInterval(checkDispoRappels, 24 * 60 * 60 * 1000);
        setInterval(cleanupOldJokers, 24 * 60 * 60 * 1000);
        setInterval(cleanupPastDispos, 24 * 60 * 60 * 1000);
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

// Durée de vie d'une session. Avec `rolling: true`, ce délai est renouvelé à
// chaque visite → l'utilisateur n'est déconnecté qu'après cette durée d'inactivité.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

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
            const expires = new Date(Date.now() + SESSION_TTL_MS);
            db.collection('sessions').updateOne(
                { sid },
                { $set: { sid, session: sessionData, expires } },
                { upsert: true }
            ).then(() => cb(null)).catch(err => cb(err));
        }

        // Appelé par express-session (rolling) quand la session est inchangée :
        // fait glisser l'expiration en base sans réécrire toutes les données.
        touch(sid, sessionData, cb) {
            if (!db) return cb && cb(null);
            const expires = new Date(Date.now() + SESSION_TTL_MS);
            db.collection('sessions').updateOne(
                { sid },
                { $set: { expires } }
            ).then(() => cb && cb(null)).catch(err => cb && cb(err));
        }

        destroy(sid, cb) {
            if (!db) return cb && cb(null);
            db.collection('sessions').deleteOne({ sid })
                .then(() => cb && cb(null))
                .catch(err => cb && cb(err));
        }
    }

    app.use(session({
        secret:            SESSION_SECRET,
        resave:            false,
        saveUninitialized: false,
        rolling:           true, // renouvelle cookie + expiration à chaque réponse
        store:             new CustomMongoStore(),
        cookie: {
            httpOnly: true,
            secure:   process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge:   SESSION_TTL_MS,
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

// Vérifie si un staff est un responsable de pointage pour un établissement à une date donnée.
// Les rôles sont portés par le profil staff, pas par le shift.
// Règle : parmi les shifts de cet établissement/date dont le staff a un rôle 'responsable',
//         tous ceux avec pointage_resp:true peuvent faire le pointage (plusieurs autorisés,
//         ex : 1 matin + 1 soir). Si aucun n'est explicitement désigné, personne n'a accès.
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

    // Le staff fait-il partie des désignés pointage_resp ce jour-là ?
    const designated = responsableShifts.filter(s => s.pointage_resp === true);
    if (designated.length === 0) return false;
    return designated.some(s => String(s.staff_id) === String(staffId));
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
        // Token toujours hashé en base (SHA-256). Tout token en clair antérieur à la migration
        // est de fait expiré (TTL 24h sur les invitations), donc plus de fallback en clair.
        const user = await db.collection('users').findOne({ invite_token: hashToken(token) });
        if (!user)                            return res.status(404).json({ error: 'Lien invalide' });
        if (user.invite_expires < new Date()) return res.status(410).json({ error: 'Lien expiré (24h)' });
        if (user.password_hash)               return res.status(409).json({ error: 'Compte déjà activé, utilise la connexion' });
        const hash = await bcrypt.hash(password, 12);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { password_hash: hash, active: true }, $unset: { invite_token: '', invite_expires: '' } }
        );
        res.json({ message: 'Mot de passe créé, tu peux te connecter' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// Reset mot de passe via token (lien email)
app.patch('/auth/reset-password', checkDB, async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });
    if (password.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });
    try {
        // Token toujours hashé en base (SHA-256). Tout token en clair antérieur à la migration
        // est de fait expiré (TTL 1h sur les resets), donc plus de fallback en clair.
        const user = await db.collection('users').findOne({ reset_token: hashToken(token) });
        if (!user)                           return res.status(404).json({ error: 'Lien invalide' });
        if (user.reset_expires < new Date()) return res.status(410).json({ error: 'Lien expiré (1h)' });
        const hash = await bcrypt.hash(password, 12);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { password_hash: hash, active: true }, $unset: { reset_token: '', reset_expires: '' } }
        );
        res.json({ message: 'Mot de passe mis à jour, tu peux te connecter' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// ── Comptes utilisateurs ──────────────────────────────────────────────────────

app.get('/api/users', checkDB, requirePatron, async (req, res) => {
    try {
        const users = await db.collection('users')
            .find({}, { projection: { password_hash: 0, invite_token: 0 } })
            .toArray();

        // Enrichir depuis staff (source de vérité) : nom à jour + téléphone de repli.
        // Garantit qu'une correction de nom dans l'onglet Staff se reflète ici,
        // y compris pour les comptes créés AVANT la correction (pas de re-saisie requise).
        const staffLinked = users.filter(u => u.staff_id && isValidObjectId(u.staff_id));
        if (staffLinked.length > 0) {
            const ids = [...new Set(staffLinked.map(u => u.staff_id))];
            const staffDocs = await db.collection('staff')
                .find({ _id: { $in: ids.map(id => new ObjectId(id)) } }, { projection: { name: 1, phone: 1 } })
                .toArray();
            const staffMap = {};
            staffDocs.forEach(s => { staffMap[String(s._id)] = s; });
            users.forEach(u => {
                const s = u.staff_id && staffMap[u.staff_id];
                if (!s) return;
                if (s.name)              u.name  = s.name;   // nom de référence = staff
                if (!u.phone && s.phone) u.phone = s.phone;
            });
        }

        // Directeur : ne voit pas les comptes patron ni les autres directeurs
        if (req.session.user.role === 'directeur') {
            return res.json(users.filter(u => u.role === 'staff' || String(u._id) === req.session.user._id));
        }
        res.json(users);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
            // Si le staff a déjà un compte (ex: email), juste ajouter le téléphone sans créer ni envoyer
            if (staff_id && isValidObjectId(staff_id)) {
                const linked = await db.collection('users').findOne({ staff_id });
                if (linked) {
                    if (!linked.phone) {
                        await db.collection('users').updateOne({ _id: linked._id }, { $set: { phone: normalizedPhone } });
                        await db.collection('staff').updateOne({ _id: new ObjectId(staff_id) }, { $set: { phone: normalizedPhone } });
                    }
                    return res.status(200).json({ message: 'Téléphone ajouté au compte existant. Aucun message envoyé.' });
                }
            }

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
                await sendSMS(normalizedPhone, 'Templyo - Bonjour ' + (name ? name.trim().split(' ')[0] : '') + ' !\n' + link);
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
            '<p>Bonjour ' + (name ? name.trim().split(' ')[0] : '') + ',</p>' +
            '<p>Tu as été invité(e) à rejoindre <strong>Templyo</strong>.</p>' +
            '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
            '<p style="color:#999;font-size:12px">Ce lien expire dans 24h.</p>';

        let emailOk = true, smsOk = true;
        try {
            await sendEmail(email, 'Ton accès Templyo', html);
            console.log('✅ Email envoyé à', email);
        } catch (mailErr) {
            console.error('❌ Erreur envoi email:', mailErr.message);
            emailOk = false;
        }

        if (normalizedPhone) {
            try {
                await sendSMS(normalizedPhone, 'Templyo - Bonjour ' + (name ? name.trim().split(' ')[0] : '') + ' !\n' + link);
                console.log('✅ SMS envoyé à', normalizedPhone);
            } catch (smsErr) {
                console.error('❌ SMS bienvenue non envoyé:', smsErr.message);
                smsOk = false;
            }
        }

        const manual = !emailOk;
        res.status(201).json({
            message: emailOk
                ? 'Invitation envoyée à ' + email + (normalizedPhone ? ' et par SMS' : '')
                : 'Compte créé mais email non envoyé.' + (!smsOk && normalizedPhone ? ' SMS non envoyé.' : ''),
            ...(manual && { link, manual: true }),
        });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// Régénère un lien d'activation pour un compte non activé (sans envoi automatique)
app.post('/api/users/:id/invite-link', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.params.id) });
        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
        if (user.active) return res.status(400).json({ error: 'Compte déjà activé' });
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { invite_token: hashToken(token), invite_expires: expires } }
        );
        res.json({ link: appUrl() + '/set-password.html?token=' + token, expires_at: expires });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.delete('/api/users/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const result = await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ message: 'Compte supprimé' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
                if (email           && !existingStaff.email)    staffUpdate.email    = email;
                if (normalizedPhone && !existingStaff.phone)    staffUpdate.phone    = normalizedPhone;
                if (entry.nickname  && !existingStaff.nickname) staffUpdate.nickname = entry.nickname;
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
                nickname: entry.nickname || null,
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
    catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// ── Groupes ───────────────────────────────────────────────────────────────────

// Retourne la liste des groupes distincts (depuis establishments + staff)
app.get('/api/groups', checkDB, requireAuth, async (req, res) => {
    try {
        const estabG = await db.collection('establishments').distinct('groups');
        const staffG = await db.collection('staff').distinct('groups');
        const all = [...new Set([...estabG, ...staffG].flat())].filter(Boolean).sort();
        res.json(all);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// ── Staff ─────────────────────────────────────────────────────────────────────

app.get('/api/staff', checkDB, requireAuth, async (req, res) => {
    try { res.json(await db.collection('staff').find().toArray()); }
    catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.post('/api/staff', checkDB, requirePatron, async (req, res) => {
    const { name, color, email } = req.body;
    if (!name) return res.status(400).json({ error: 'name requis' });
    try {
        const doc    = { name, color: color || '#3498db', email: email || '' };
        const result = await db.collection('staff').insertOne(doc);
        res.status(201).json({ ...doc, _id: result.insertedId });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    const { color, name, email, venues, can_submit_dispos, groups, rest_days, hourly_rate, fixed_rate } = req.body;
    if (!color && !name && email === undefined && venues === undefined && can_submit_dispos === undefined && req.body.roles === undefined && groups === undefined && req.body.name_color === undefined && rest_days === undefined && req.body.nickname === undefined && hourly_rate === undefined && fixed_rate === undefined)
        return res.status(400).json({ error: 'color, name, email, venues, roles, groups, name_color, nickname, can_submit_dispos, hourly_rate, fixed_rate ou rest_days requis' });
    try {
        const update = {};
        if (color)                             update.color             = color;
        if (name)                              update.name              = name;
        if (email !== undefined)               update.email             = email;
        if (venues !== undefined)              update.venues            = venues;
        if (req.body.roles !== undefined)      update.roles             = req.body.roles;
        if (can_submit_dispos !== undefined)   update.can_submit_dispos = !!can_submit_dispos;
        if (groups !== undefined)              update.groups            = Array.isArray(groups) ? groups : [];
        if (Array.isArray(rest_days))          update.rest_days         = rest_days.map(Number).filter(n => n >= 0 && n <= 6);
        if (req.body.name_color !== undefined) update.name_color        = req.body.name_color || null;
        if (req.body.nickname   !== undefined) update.nickname          = req.body.nickname   || null;
        if (hourly_rate !== undefined) {
            if (hourly_rate === null || hourly_rate === '') update.hourly_rate = null;
            else {
                const n = parseFloat(hourly_rate);
                if (Number.isNaN(n) || n < 0) return res.status(400).json({ error: 'hourly_rate doit être un nombre positif' });
                update.hourly_rate = n;
            }
        }
        if (fixed_rate !== undefined) {
            if (fixed_rate === null || fixed_rate === '') update.fixed_rate = null;
            else {
                const n = parseFloat(fixed_rate);
                if (Number.isNaN(n) || n < 0) return res.status(400).json({ error: 'fixed_rate doit être un nombre positif' });
                update.fixed_rate = n;
            }
        }
        // Mutual exclusion (Option A) : un seul mode actif à la fois.
        // Si l'un est défini à une valeur non-null, l'autre est forcé à null —
        // y compris si l'appelant ne l'a pas envoyé (ex. bulk import taux horaires).
        if (update.hourly_rate != null && update.fixed_rate === undefined) update.fixed_rate  = null;
        if (update.fixed_rate  != null && update.hourly_rate === undefined) update.hourly_rate = null;
        const result = await db.collection('staff').updateOne(
            { _id: new ObjectId(req.params.id) }, { $set: update }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Staff introuvable' });
        if (color) await db.collection('shifts').updateMany({ staff_id: req.params.id }, { $set: { color } });
        if (name) {
            // Propager la correction de nom à toutes les copies dénormalisées
            // (shifts, compte(s) lié(s), disponibilités) → cohérence partout.
            await db.collection('shifts').updateMany({ staff_id: req.params.id }, { $set: { staff_name: name } });
            await db.collection('users').updateMany({ staff_id: req.params.id }, { $set: { name } });
            await db.collection('availabilities').updateMany({ staff_id: req.params.id }, { $set: { staff_name: name } });
        }
        res.json({ message: 'Staff mis à jour', updated: update });
        touchLastUpdated();
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.delete('/api/staff/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        await db.collection('shifts').deleteMany({ staff_id: req.params.id });
        const result = await db.collection('staff').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Staff introuvable' });
        res.json({ message: 'Staff supprimé' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// ── Shifts — lecture ──────────────────────────────────────────────────────────

app.get('/api/shifts/:establishmentId/:date', checkDB, requireAuth, async (req, res) => {
    try {
        const shifts = await db.collection('shifts')
            .find({ establishment_id: req.params.establishmentId, date: req.params.date })
            .sort({ start_time: 1 }).toArray();
        res.json(shifts);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// ── Flux iCal (abonnement agenda) ──────────────────────────────────────────────
// Permet au staff d'ajouter son planning à Google Agenda / Apple Calendrier /
// Outlook via une URL d'abonnement. L'agenda se rafraîchit tout seul → plus besoin
// de se connecter pour consulter ses horaires.

function icsEscape(str) {
    return String(str == null ? '' : str)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

// (date 'YYYY-MM-DD' + heure flottante, ex 18.5 ou 26 pour 2h du matin) → horodatage
// local "YYYYMMDDTHHMMSS" à interpréter avec TZID=Europe/Paris. Gère le passage minuit
// (heure ≥ 24 → jour suivant) par arithmétique entière, sans dépendre du fuseau serveur.
function icsLocalDateTime(dateStr, hoursFloat) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const totalMin  = Math.round(hoursFloat * 60);
    const dayOffset = Math.floor(totalMin / 1440);
    const rem       = ((totalMin % 1440) + 1440) % 1440;
    const hh = Math.floor(rem / 60), mm = rem % 60;
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCDate(base.getUTCDate() + dayOffset);
    const pad = n => String(n).padStart(2, '0');
    return base.getUTCFullYear() + pad(base.getUTCMonth() + 1) + pad(base.getUTCDate())
        + 'T' + pad(hh) + pad(mm) + '00';
}

const ICS_VTIMEZONE = [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Paris',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
    'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
    'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
].join('\r\n');

function buildShiftsIcs(shifts, estabMap) {
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
    const dtstamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate())
        + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Templyo//Planning//FR',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Mes shifts — Templyo',
        'X-WR-TIMEZONE:Europe/Paris',
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        ICS_VTIMEZONE,
    ];

    shifts.forEach(s => {
        const estab = estabMap[s.establishment_id] || {};
        const title = estab.name || 'Shift';
        lines.push('BEGIN:VEVENT');
        lines.push('UID:shift-' + String(s._id) + '@templyo');
        lines.push('DTSTAMP:' + dtstamp);
        lines.push('DTSTART;TZID=Europe/Paris:' + icsLocalDateTime(s.date, s.start_time));
        lines.push('DTEND;TZID=Europe/Paris:'   + icsLocalDateTime(s.date, s.end_time));
        lines.push('SUMMARY:' + icsEscape(title));
        if (estab.name) lines.push('LOCATION:' + icsEscape(estab.name));
        lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
}

// ⚠️ Fonctionnalité agenda iCal DÉSACTIVÉE (D-83) — pas encore assez fiable pour la
// prod (synchro iCal non temps réel : un changement met jusqu'à ~1 h à se propager).
// Le code est conservé. Pour réactiver : passer CALENDAR_ENABLED à true (ou définir
// la variable d'env CALENDAR_ENABLED=true) ET le flag client dans public/planning.js.
const CALENDAR_ENABLED = process.env.CALENDAR_ENABLED === 'true';

// URL d'abonnement agenda du staff connecté (génère le token au 1er appel)
app.get('/api/calendar-url', checkDB, requireAuth, async (req, res) => {
    if (!CALENDAR_ENABLED) return res.status(404).json({ error: 'Fonctionnalité indisponible' });
    const userId = req.session.user._id;
    if (!req.session.user.staff_id) return res.status(400).json({ error: 'Aucun profil staff lié à ce compte' });
    try {
        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        let token = user && user.calendar_token;
        if (!token) {
            token = require('crypto').randomBytes(24).toString('hex');
            await db.collection('users').updateOne({ _id: new ObjectId(userId) }, { $set: { calendar_token: token } });
        }
        // Domaine public : PUBLIC_BASE_URL (override dédié calendrier) > APP_URL
        // (déjà utilisée pour les liens email/SMS) > hôte de la requête (zéro-config
        // sur Railway). Préfixe https:// garanti car la conversion webcal:// en dépend.
        let base = process.env.PUBLIC_BASE_URL || process.env.APP_URL || (req.protocol + '://' + req.get('host'));
        if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
        base = base.replace(/\/+$/, '');
        const httpUrl = base + '/api/calendar/' + token + '.ics';
        res.json({ url: httpUrl, webcal: httpUrl.replace(/^https?:/, 'webcal:') });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// Flux iCal public — le token tient lieu d'authentification (lecture seule).
// Expose les shifts du staff de la semaine en cours et des semaines futures PUBLIÉES.
app.get('/api/calendar/:token([a-f0-9]+).ics', checkDB, async (req, res) => {
    if (!CALENDAR_ENABLED) return res.status(404).send('Not found');
    try {
        const user = await db.collection('users').findOne({ calendar_token: req.params.token });
        if (!user || !user.staff_id) return res.status(404).send('Calendrier introuvable');
        const staffId = user.staff_id;

        // Filtrage par groupes (cohérent avec /api/my-shifts)
        const staffDoc = isValidObjectId(staffId)
            ? await db.collection('staff').findOne({ _id: new ObjectId(staffId) })
            : null;
        const staffGroups = staffDoc?.groups || [];
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

        const fromStr = toDateStr(currentWeekStart(new Date())); // lundi de la semaine en cours (cutoff 6h)
        const query = { staff_id: staffId, date: { $gte: fromStr } };
        if (allowedEstabIds) query.establishment_id = { $in: allowedEstabIds };
        const rawShifts = await db.collection('shifts').find(query).sort({ date: 1, start_time: 1 }).toArray();

        // Ne garder que les shifts des semaines publiées (auto pour la semaine en cours,
        // flag publish_<weekStart> pour les futures) et exclure les Jokers.
        const publishedWeeks = await fetchPublishedWeeks();
        const visible = rawShifts.filter(s =>
            !s.is_joker && s.staff_id !== '__joker__' && isDatePublished(s.date, publishedWeeks)
        );

        const estabIds = [...new Set(visible.map(s => s.establishment_id))];
        const estabs = estabIds.length
            ? await db.collection('establishments').find({ id: { $in: estabIds } }).toArray()
            : [];
        const estabMap = {};
        estabs.forEach(e => { estabMap[e.id] = e; });

        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Cache-Control', 'no-cache, max-age=0');
        res.send(buildShiftsIcs(visible, estabMap));
    } catch (e) {
        console.error('[' + req.method + ' ' + req.path + ']', e);
        res.status(500).send('Erreur interne');
    }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
                try {
                    const isPublished = isDatePublished(date, await fetchPublishedWeeks());
                    if (isPublished) {
                        const estabDoc  = await db.collection('establishments').findOne({ id: establishment_id }) || {};
                        const estabName = estabDoc.name || establishment_id;
                        // B-10 : pas de push si le shift est dans le passé
                        if (date >= toDateStr(new Date())) {
                            await sendPushToStaff([staff_id], {
                                title:   '✅ Nouveau shift — ' + estabName,
                                body:    'Tu es planifié(e) ' + formatDateFR(date) + ' · ' + formatShiftTime(parseFloat(start_time)) + ' → ' + formatShiftTime(parseFloat(end_time)),
                                tag:     'planning-publie',
                                url:     '/planning.html',
                                actions: [{ action: 'voir', title: 'Voir mon planning' }],
                            });
                        }
                        // In-app patron
                        await createNotifForPatrons(
                            establishment_id,
                            'shift_added',
                            '➕ ' + (staff_name || 'Un membre') + ' — ' + formatDateShortFR(date) + ' · ' + formatShiftTime(parseFloat(start_time)) + '→' + formatShiftTime(parseFloat(end_time)),
                            { date, shift_id: String(result.insertedId) }
                        );
                    }
                } catch (e) { console.error('[POST /api/shifts notif]', e); }
            })();
        }

        res.status(201).json({ ...shift, _id: result.insertedId, warnings });
        touchLastUpdated();
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// Transférer un shift vers un autre établissement / une autre date
app.patch('/api/shifts/:id/transfer', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { establishment_id, date } = req.body;
    if (!establishment_id || !date) return res.status(400).json({ error: 'establishment_id et date requis' });
    try {
        const shift = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!shift) return res.status(404).json({ error: 'Shift introuvable' });

        await db.collection('shifts').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { establishment_id, date } }
        );

        // Notification push au staff concerné — B-10 : pas de push si nouvelle date dans le passé
        if (shift.staff_id && shift.staff_id !== '__joker__' && date >= toDateStr(new Date())) {
            const estabDoc  = await db.collection('establishments').findOne({ id: establishment_id }) || {};
            const estabName = estabDoc.name || establishment_id;
            await sendPushToStaff([shift.staff_id], {
                title: '🔄 Shift transféré — ' + estabName,
                body:  'Ton shift du ' + formatDateFR(date) + ' (' + formatShiftTime(shift.start_time) + ' → ' + formatShiftTime(shift.end_time) + ') a été transféré.',
                tag:   'shift-transfere',
                url:   '/planning.html',
            });
        }

        touchLastUpdated();
        res.json({ message: 'Shift transféré' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// PATCH — Patron : ouvrir/fermer un Joker aux candidatures (route spécifique AVANT la générique /:id)
app.patch('/api/shifts/:id/joker-open', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { open } = req.body;
    if (typeof open !== 'boolean') return res.status(400).json({ error: 'open (boolean) requis' });
    try {
        const shift = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!shift) return res.status(404).json({ error: 'Shift introuvable' });
        if (!shift.is_joker && shift.staff_id !== '__joker__') return res.status(400).json({ error: 'Ce shift n\'est pas un Joker' });
        if (!canAccessEstablishment(req.session.user, shift.establishment_id)) return res.status(403).json({ error: 'Accès refusé' });

        if (open) {
            await db.collection('shifts').updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { joker_open: true } }
            );
            // B-10 : pas de push si le shift Joker est dans le passé
            const estabStaff = await db.collection('staff').find({ venues: shift.establishment_id }).toArray();
            const staffIds   = estabStaff.map(s => String(s._id));
            if (staffIds.length && shift.date >= toDateStr(new Date())) {
                const body = 'Un créneau est ouvert ' + formatDateFR(shift.date) + ' ' +
                    formatShiftTime(shift.start_time) + '–' + formatShiftTime(shift.end_time) + '. Tu es disponible ?';
                await sendPushToStaff(staffIds, {
                    title: 'Templyo — Créneau disponible',
                    body,
                    tag:   'joker-ouvert-' + String(shift._id),
                    url:   '/planning.html',
                });
            }
        } else {
            await db.collection('shifts').updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { joker_open: false, joker_candidates: [] } }
            );
        }
        res.json({ message: 'Joker mis à jour' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
            // Fermer les candidatures si le joker était ouvert
            if (existing.is_joker) {
                updateFields.joker_open       = false;
                updateFields.joker_candidates = [];
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
                    // B-10 : pas de push si le shift est dans le passé
                    if (capturedDate < toDateStr(new Date())) return;
                    const isPublished = isDatePublished(capturedDate, await fetchPublishedWeeks());
                    if (!isPublished) return;
                    // Relire les horaires finaux depuis la base (après tous les resizes)
                    const finalShift = await db.collection('shifts').findOne({ _id: existing._id });
                    const fS = finalShift ? finalShift.start_time : newS;
                    const fE = finalShift ? finalShift.end_time   : newE;
                    const estabDoc = await db.collection('establishments').findOne({ id: capturedEstab }) || {};
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
                    const isPublished = isDatePublished(existing.date, await fetchPublishedWeeks());
                    if (!isPublished) return;
                    const estabDoc  = await db.collection('establishments').findOne({ id: existing.establishment_id }) || {};
                    const estabName = estabDoc.name || existing.establishment_id;
                    // B-10 : pas de push si le shift annulé était dans le passé
                    if (existing.date >= toDateStr(new Date())) {
                        await sendPushToStaff([existing.staff_id], {
                            title:   '❌ Shift annulé — ' + estabName,
                            body:    'Ton shift du ' + formatDateFR(existing.date) + ' (' + formatShiftTime(existing.start_time) + ' → ' + formatShiftTime(existing.end_time) + ') a été annulé.',
                            tag:     'shift-modifie',
                            url:     '/planning.html',
                            actions: [{ action: 'voir', title: 'Voir les changements' }],
                        });
                    }
                    await createNotifForPatrons(
                        existing.establishment_id,
                        'shift_deleted',
                        '❌ ' + (existing.staff_name || 'Un membre') + ' — ' + formatDateShortFR(existing.date) + ' · shift supprimé',
                        { date: existing.date }
                    );
                } catch (e) { console.error('[DELETE /api/shifts/:id notif]', e); }
            })();
        }
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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

        // Format local YYYY-MM-DDTHH:MM:SS (sans Z) — évite toISOString() qui retourne UTC
        // et provoque un décalage d'heure côté client si serveur/client sont en TZ différents.
        // Convention architecture.md §3.1.
        const _pad = n => String(n).padStart(2, '0');
        const deadlineLocalIso =
            effectiveDeadline.getFullYear() + '-' +
            _pad(effectiveDeadline.getMonth() + 1) + '-' +
            _pad(effectiveDeadline.getDate()) + 'T' +
            _pad(effectiveDeadline.getHours()) + ':' +
            _pad(effectiveDeadline.getMinutes()) + ':' +
            _pad(effectiveDeadline.getSeconds());

        const forceOpenStaff = Array.isArray(settings.force_open_staff) ? settings.force_open_staff : [];
        const staffForceOpen = staffId ? forceOpenStaff.includes(staffId) : false;
        res.json({
            open: settings.open,
            message: settings.message,
            deadline: deadlineLocalIso,
            deadlinePassed: effectiveDeadlinePassed,
            canSubmit: staffCanSubmit && settings.open && (!effectiveDeadlinePassed || forceOpen || staffForceOpen),
            staffCanSubmit,
            force_open: forceOpen,
            force_open_staff: forceOpenStaff,
            custom_deadline: customDeadline,
            open_day: settings.open_day ?? null,
            rest_days: staffDoc ? (staffDoc.rest_days || []) : [],
        });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.patch('/api/dispo-settings/force-open-staff', checkDB, requirePatron, async (req, res) => {
    const { staff_id, action } = req.body;
    if (!staff_id || !['add', 'remove'].includes(action))
        return res.status(400).json({ error: 'staff_id et action (add|remove) requis' });
    try {
        const op = action === 'add'
            ? { $addToSet: { force_open_staff: staff_id } }
            : { $pull:     { force_open_staff: staff_id } };
        await db.collection('settings').updateOne(
            { key: 'dispo' },
            op,
            { upsert: true }
        );
        res.json({ message: 'OK' });
    } catch (e) { console.error('[PATCH /api/dispo-settings/force-open-staff]', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/dispos/mine', checkDB, requireAuth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié' });
    try {
        const dispos = await db.collection('availabilities').find({ staff_id: staffId, date: { $gte: from, $lte: to } }).toArray();
        res.json(dispos);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/dispos/week-notes', checkDB, requirePatron, async (req, res) => {
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start requis' });
    try {
        const docs = await db.collection('availabilities').find({ week_start, type: 'week_note' }).toArray();
        res.json(docs.map(d => ({ staff_id: d.staff_id, week_note: d.week_note })));
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/dispos/week-note', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    const { week_start } = req.query;
    if (!week_start) return res.status(400).json({ error: 'week_start requis' });
    if (!staffId) return res.json({ week_note: '' });
    try {
        const doc = await db.collection('availabilities').findOne({ staff_id: staffId, week_start, type: 'week_note' });
        res.json({ week_note: doc ? doc.week_note : '' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    const forceOpenStaff = Array.isArray(settings.force_open_staff) ? settings.force_open_staff : [];
    const staffForceOpen = forceOpenStaff.includes(staffId);
    if (!settings.force_open && !staffForceOpen && now > effectiveDeadline)
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
                    start_time: d.start_time != null ? parseFloat(d.start_time) : null,
                    end_time:   d.end_time   != null ? parseFloat(d.end_time)   : null,
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
        if (staffForceOpen) {
            db.collection('settings').updateOne(
                { key: 'dispo' },
                { $pull: { force_open_staff: staffId } }
            ).catch(e => console.error('[force_open_staff cleanup]', e));
        }
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/dispos/pending', checkDB, requirePatron, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        const dispos = await db.collection('availabilities').find({ date: { $gte: from, $lte: to }, status: 'pending' }).sort({ date: 1, start_time: 1 }).toArray();
        res.json(dispos);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/dispos/count', checkDB, requirePatron, async (req, res) => {
    try {
        const count = await db.collection('availabilities').countDocuments({ status: 'pending' });
        res.json({ count });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/dispos/non-affectees', checkDB, requirePatron, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        const dispos = await db.collection('availabilities').find({
            date: { $gte: from, $lte: to },
            status: 'confirmed',
            type: { $nin: ['week_note', 'off'] },
        }).sort({ date: 1 }).toArray();

        if (dispos.length === 0) return res.json([]);

        // Récupérer les shifts correspondants en une passe
        const staffIds = [...new Set(dispos.map(d => d.staff_id))];
        const dates    = [...new Set(dispos.map(d => d.date))];
        const existingShifts = await db.collection('shifts').find({
            staff_id: { $in: staffIds },
            date:     { $in: dates },
        }).toArray();

        // Enrichir : staff color + nom établissement
        const validIds   = staffIds.filter(id => isValidObjectId(id));
        const staffDocs  = validIds.length
            ? await db.collection('staff').find({ _id: { $in: validIds.map(id => new ObjectId(id)) } }).toArray()
            : [];
        const staffMap   = {};
        staffDocs.forEach(s => { staffMap[String(s._id)] = s; });

        const estabIds  = [...new Set(dispos.map(d => d.establishment_id))];
        const estabDocs = await db.collection('establishments').find({ id: { $in: estabIds } }).toArray();
        const estabMap  = {};
        estabDocs.forEach(e => { estabMap[e.id] = e; });

        const results = [];
        for (const dispo of dispos) {
            const hasShift = existingShifts.some(s =>
                s.staff_id === dispo.staff_id &&
                s.date     === dispo.date
            );
            if (!hasShift) {
                const staffDoc = staffMap[dispo.staff_id] || {};
                const estabDoc = estabMap[dispo.establishment_id] || {};
                results.push({
                    ...dispo,
                    staff_color:        staffDoc.color || '#888',
                    staff_name:         staffDoc.name  || dispo.staff_name || '',
                    establishment_name: estabDoc.name  || dispo.establishment_id,
                });
            }
        }
        res.json(results);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// Staff actifs sans dispo soumise pour une période donnée
app.get('/api/dispos/sans-dispo', checkDB, requirePatron, async (req, res) => {
    const { establishment_id, from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        // Uniquement les comptes staff avec login actif (mot de passe défini)
        const activeUsers = await db.collection('users').find(
            { role: 'staff', active: true, staff_id: { $ne: null } },
            { projection: { staff_id: 1 } }
        ).toArray();
        const activeStaffIds = activeUsers.map(u => u.staff_id).filter(Boolean);
        if (activeStaffIds.length === 0) return res.json([]);

        const validActiveIds = activeStaffIds.filter(id => isValidObjectId(id));
        const staffQuery = {
            _id: { $in: validActiveIds.map(id => new ObjectId(id)) },
            can_submit_dispos: true,
        };
        if (establishment_id) staffQuery.venues = establishment_id;

        const allStaff = await db.collection('staff').find(staffQuery, {
            projection: { name: 1, color: 1, phone: 1 }
        }).toArray();
        if (allStaff.length === 0) return res.json([]);

        const staffIds = allStaff.map(s => String(s._id));
        const dispos = await db.collection('availabilities').find({
            staff_id: { $in: staffIds },
            date: { $gte: from, $lte: to },
            type: { $ne: 'week_note' },
        }, { projection: { staff_id: 1 } }).toArray();

        const withDispo = new Set(dispos.map(d => d.staff_id));
        const result = allStaff
            .filter(s => !withDispo.has(String(s._id)))
            .map(s => ({ id: String(s._id), name: s.name, color: s.color || '#888', phone: s.phone || '' }));
        res.json(result);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.get('/api/dispos/with-dispo', checkDB, requirePatron, async (req, res) => {
    const { establishment_id, from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        const dispos = await db.collection('availabilities').find({
            date: { $gte: from, $lte: to },
            type: { $ne: 'week_note' },
        }, { projection: { staff_id: 1 } }).toArray();
        if (dispos.length === 0) return res.json([]);

        const countByStaff = new Map();
        dispos.forEach(d => { countByStaff.set(d.staff_id, (countByStaff.get(d.staff_id) || 0) + 1); });

        const staffIds = Array.from(countByStaff.keys()).filter(id => isValidObjectId(id));
        if (staffIds.length === 0) return res.json([]);

        const staffQuery = { _id: { $in: staffIds.map(id => new ObjectId(id)) } };
        if (establishment_id) staffQuery.venues = establishment_id;

        const allStaff = await db.collection('staff').find(staffQuery, {
            projection: { name: 1, color: 1, phone: 1 }
        }).toArray();

        const settings = await db.collection('settings').findOne({ key: 'dispo' }) || {};
        const forceOpenStaff = Array.isArray(settings.force_open_staff) ? settings.force_open_staff : [];
        const reopenedSet = new Set(forceOpenStaff);

        const result = allStaff
            .map(s => ({
                id: String(s._id),
                name: s.name,
                color: s.color || '#888',
                phone: s.phone || '',
                count: countByStaff.get(String(s._id)) || 0,
                reopened: reopenedSet.has(String(s._id)),
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        res.json(result);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.post('/api/dispos/reopen-for-correction', checkDB, requirePatron, async (req, res) => {
    const { staff_id, from, to } = req.body;
    if (!staff_id || !from || !to)
        return res.status(400).json({ error: 'staff_id, from et to requis' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
        return res.status(400).json({ error: 'from/to invalides (YYYY-MM-DD)' });
    try {
        const del = await db.collection('availabilities').deleteMany({
            staff_id,
            date: { $gte: from, $lte: to },
            type: { $ne: 'week_note' },
        });
        await db.collection('settings').updateOne(
            { key: 'dispo' },
            { $addToSet: { force_open_staff: staff_id } },
            { upsert: true }
        );
        res.json({ message: 'OK', deleted: del.deletedCount });
        touchLastUpdated();
    } catch (e) { console.error('[POST /api/dispos/reopen-for-correction]', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.patch('/api/dispos/:id/confirm', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { establishment_id, create_shift } = req.body;
    try {
        const dispo = await db.collection('availabilities').findOne({ _id: new ObjectId(req.params.id) });
        if (!dispo) return res.status(404).json({ error: 'Dispo introuvable' });
        const isOff = dispo.type === 'off';
        // Une indispo n'est qu'informative : pas d'établissement ni de shift
        if (!isOff && !establishment_id) return res.status(400).json({ error: 'establishment_id requis' });
        const setFields = { status: 'confirmed' };
        if (!isOff) setFields.establishment_id = establishment_id;
        await db.collection('availabilities').updateOne({ _id: new ObjectId(req.params.id) }, { $set: setFields });
        if (create_shift && !isOff) {
            const staffMember = await db.collection('staff').findOne({ _id: new ObjectId(dispo.staff_id) });
            await db.collection('shifts').insertOne({
                staff_id: dispo.staff_id, staff_name: dispo.staff_name,
                establishment_id, date: dispo.date,
                start_time: dispo.start_time, end_time: dispo.end_time,
                color: staffMember?.color || '#3498db',
            });
        }
        res.json({ message: isOff ? 'Indisponibilité confirmée' : ('Dispo confirmée' + (create_shift ? ' et shift créé' : '')) });
        touchLastUpdated();
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.patch('/api/dispos/:id/ignore', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const result = await db.collection('availabilities').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'ignored' } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Dispo introuvable' });
        res.json({ message: 'Dispo ignorée' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});
*/

// ── Joker ouvert — système de candidature ────────────────────────────────────

// GET — Jokers ouverts aux candidatures (staff connecté)
app.get('/api/shifts/joker-ouverts', checkDB, requireAuth, async (req, res) => {
    const { establishment_id } = req.query;
    const staffId = req.session.user.staff_id || null;
    try {
        const query = {
            joker_open: true,
            $or: [{ is_joker: true }, { staff_id: '__joker__' }],
        };
        if (establishment_id) query.establishment_id = establishment_id;
        const shifts = await db.collection('shifts').find(query, {
            projection: { _id: 1, date: 1, start_time: 1, end_time: 1, establishment_id: 1, joker_candidates: 1 }
        }).toArray();
        // Résoudre les noms d'établissements en une requête batch
        const estabIds = [...new Set(shifts.map(s => s.establishment_id).filter(Boolean))];
        const estabDocs = estabIds.length
            ? await db.collection('establishments').find({ id: { $in: estabIds } }).toArray()
            : [];
        const estabNameById = {};
        estabDocs.forEach(e => { estabNameById[e.id] = e.name || e.id; });
        const result = shifts.map(s => ({
            _id:                s._id,
            date:               s.date,
            start_time:         s.start_time,
            end_time:           s.end_time,
            establishment_id:   s.establishment_id,
            establishment_name: estabNameById[s.establishment_id] || s.establishment_id,
            has_applied:        staffId ? (s.joker_candidates || []).some(c => c.staff_id === staffId) : false,
        }));
        res.json(result);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// GET — Patron : lire un shift complet (pour rafraîchir les candidatures)
app.get('/api/shifts/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const shift = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!shift) return res.status(404).json({ error: 'Shift introuvable' });
        if (!canAccessEstablishment(req.session.user, shift.establishment_id)) return res.status(403).json({ error: 'Accès refusé' });
        res.json(shift);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// POST — Staff : postuler à un Joker ouvert
app.post('/api/shifts/:id/joker-candidature', checkDB, requireAuth, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const user = req.session.user;
    if (!user.staff_id) return res.status(403).json({ error: 'Réservé au staff connecté' });
    try {
        const staffDoc = await db.collection('staff').findOne({ _id: new ObjectId(user.staff_id) });

        // Atomique : on push uniquement si Joker ouvert ET staff pas déjà candidat.
        // Évite race condition au double-tap (deux candidatures simultanées).
        const updated = await db.collection('shifts').findOneAndUpdate(
            {
                _id: new ObjectId(req.params.id),
                $or: [{ is_joker: true }, { staff_id: '__joker__' }],
                joker_open: true,
                'joker_candidates.staff_id': { $ne: user.staff_id },
            },
            {
                $push: { joker_candidates: {
                    staff_id:     user.staff_id,
                    staff_name:   staffDoc ? staffDoc.name : (user.name || ''),
                    staff_color:  staffDoc ? staffDoc.color : '#3498db',
                    submitted_at: new Date(),
                }},
            },
            { returnDocument: 'before' }
        );

        if (updated) return res.json({ message: 'Candidature envoyée' });

        // Le filter n'a rien matché — distinguer la cause pour un message clair
        const shift = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!shift)                                            return res.status(404).json({ error: 'Shift introuvable' });
        if (!shift.is_joker && shift.staff_id !== '__joker__') return res.status(400).json({ error: 'Ce shift n\'est pas un Joker' });
        if (!shift.joker_open)                                 return res.status(403).json({ error: 'Ce Joker n\'est pas ouvert aux candidatures' });
        return res.status(409).json({ error: 'Candidature déjà envoyée' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

/* ── Suite du bloc échanges de shifts (F-05) — DÉSACTIVÉ ─────────────────────

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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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

            // B-10 : ne notifier que les staff ayant au moins un shift dans la semaine
            // dont la date est >= aujourd'hui (les semaines passées ne déclenchent rien).
            const today = toDateStr(new Date());
            const lowerBound = weekStart > today ? weekStart : today;
            db.collection('shifts').distinct('staff_id', {
                date: { $gte: lowerBound, $lte: weekEnd },
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// GET dispos confirmées pour une semaine (affichage fond planning patron)
app.get('/api/dispos/confirmed', checkDB, requirePatron, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    try {
        const dispos = await db.collection('availabilities').find({
            date:   { $gte: from, $lte: to },
            status: 'confirmed',
            type:   { $ne: 'off' },
        }).toArray();
        res.json(dispos);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// ── Rôles ─────────────────────────────────────────────────────────────────────

app.get('/api/roles', checkDB, requireAuth, async (req, res) => {
    try {
        const roles = await db.collection('roles').find().sort({ type: 1, name: 1 }).toArray();
        res.json(roles);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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

        // Charger les établissements pour les noms dans la ventilation.
        // Les shifts référencent le champ custom `id` (pas `_id`).
        const estabList = await db.collection('establishments').find().toArray();
        const estabMap  = {};
        estabList.forEach(e => { estabMap[String(e.id)] = e; });

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

            // Ventilation des heures par établissement : planifiées ET réelles
            const estabHours = {};
            entry.shifts.forEach(s => {
                const eid = String(s.establishment_id || '');
                if (!estabHours[eid]) estabHours[eid] = { planned: 0, real: 0, hasReal: false };
                estabHours[eid].planned += (s.end_time - s.start_time);
                if (s.real_start != null && s.real_end != null) {
                    estabHours[eid].real += (s.real_end - s.real_start);
                    estabHours[eid].hasReal = true;
                }
            });
            const by_establishment = Object.entries(estabHours).map(([eid, h]) => ({
                establishment_id:   eid,
                establishment_name: estabMap[eid] ? estabMap[eid].name : '—',
                planned_hours:      Math.round(h.planned * 100) / 100,
                real_hours:         h.hasReal ? Math.round(h.real * 100) / 100 : null,
            })).sort((a, b) => a.establishment_name.localeCompare(b.establishment_name));

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
                by_establishment,
            };
        });

        result.sort((a, b) => a.staff_name.localeCompare(b.staff_name));
        res.json(result);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// Tableau de bord du responsable : pour chaque (date, établissement) où le staff
// porteur d'un rôle 'responsable' travaille, renvoyer tous les shifts de l'équipe
// (collègues compris), groupés par date. Pas de filtre pointage_resp — un
// responsable voit l'équipe sur toutes ses soirées de travail.
app.get('/api/me/responsable-week', checkDB, requireAuth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
        return res.status(400).json({ error: 'from et to requis (YYYY-MM-DD)' });
    const user = req.session.user;
    if (!user.staff_id) return res.json({ authorized: false, days: {} });
    try {
        // Mes shifts sur la période
        const myShifts = await db.collection('shifts').find({
            staff_id: user.staff_id,
            date: { $gte: from, $lte: to },
        }).toArray();
        if (myShifts.length === 0) return res.json({ authorized: false, days: {} });

        // Vérifier qu'il a au moins un rôle de type 'responsable'
        const staffDoc = isValidObjectId(user.staff_id)
            ? await db.collection('staff').findOne({ _id: new ObjectId(user.staff_id) })
            : null;
        const responsableRoles = await db.collection('roles').find({ type: 'responsable' }).toArray();
        const responsableIds   = responsableRoles.map(r => String(r._id));
        const staffRoles       = (staffDoc && staffDoc.roles) || [];
        if (!staffRoles.some(r => responsableIds.includes(r))) {
            return res.json({ authorized: false, days: {} });
        }

        // Distinct (date, establishment_id) où ce staff travaille
        const seen = new Set();
        const pairs = [];
        for (const s of myShifts) {
            const key = s.date + '|' + s.establishment_id;
            if (seen.has(key)) continue;
            seen.add(key);
            pairs.push({ date: s.date, establishment_id: s.establishment_id });
        }
        if (pairs.length === 0) return res.json({ authorized: false, days: {} });

        // Tous les shifts de l'équipe sur ces (date, établissement)
        const teamShifts = await db.collection('shifts').find({
            $or: pairs.map(p => ({ date: p.date, establishment_id: p.establishment_id })),
        }).sort({ date: 1, start_time: 1 }).toArray();

        // Augmenter chaque shift avec téléphone + nickname du staff (contact +
        // affichage cohérent avec le tableau de bord patron : nickname si défini,
        // sinon prénom + désambiguïsation côté client)
        const staffIds = [...new Set(teamShifts
            .map(s => s.staff_id)
            .filter(id => id && id !== '__joker__' && isValidObjectId(id)))];
        const staffDocs = staffIds.length
            ? await db.collection('staff').find(
                { _id: { $in: staffIds.map(id => new ObjectId(id)) } },
                { projection: { phone: 1, nickname: 1 } }
            ).toArray()
            : [];
        const staffMeta = new Map(staffDocs.map(s => [String(s._id), { phone: s.phone || null, nickname: s.nickname || null }]));
        teamShifts.forEach(s => {
            const meta = staffMeta.get(String(s.staff_id)) || {};
            s.phone    = meta.phone    || null;
            s.nickname = meta.nickname || null;
        });

        // Groupé par date (chaque jour de la période initialisé même si vide)
        const byDate = {};
        for (let d = new Date(from + 'T12:00:00'); d <= new Date(to + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
            const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
            byDate[key] = [];
        }
        teamShifts.forEach(s => { if (byDate[s.date] !== undefined) byDate[s.date].push(s); });
        res.json({ authorized: true, days: byDate });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// ── Pilotage économique : CA + performance ───────────────────────────────────

// POST CA d'une soirée (établissement, directeur, patron)
app.post('/api/revenue', checkDB, requireAuth, async (req, res) => {
    const user = req.session.user;
    const { date, revenue } = req.body;
    const establishment_id = user.role === 'etablissement' ? user.establishment_id : req.body.establishment_id;
    if (!date || !establishment_id) return res.status(400).json({ error: 'date et establishment_id requis' });
    const rev = parseFloat(revenue);
    if (Number.isNaN(rev) || rev < 0) return res.status(400).json({ error: 'revenue doit être un nombre positif' });
    if (user.role !== 'etablissement' && !canAccessEstablishment(user, establishment_id))
        return res.status(403).json({ error: 'Accès refusé' });
    try {
        await db.collection('daily_revenue').updateOne(
            { establishment_id, date },
            {
                $set:         { revenue: rev, created_by: String(user._id), updated_at: new Date() },
                $setOnInsert: { establishment_id, date, created_at: new Date() },
            },
            { upsert: true }
        );
        res.json({ message: 'CA enregistré' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// GET le CA d'un établissement à une date (pour pré-remplir le champ)
app.get('/api/revenue/:establishmentId/:date', checkDB, requireAuth, async (req, res) => {
    const user = req.session.user;
    const { establishmentId, date } = req.params;
    if (user.role === 'etablissement' && user.establishment_id !== establishmentId)
        return res.status(403).json({ error: 'Accès refusé' });
    if (user.role !== 'etablissement' && !canAccessEstablishment(user, establishmentId))
        return res.status(403).json({ error: 'Accès refusé' });
    try {
        const doc = await db.collection('daily_revenue').findOne({ establishment_id: establishmentId, date });
        res.json({ revenue: doc ? doc.revenue : null });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// GET performance (CA + masse salariale + coeff) — patron/directeur
app.get('/api/performance', checkDB, requirePatron, async (req, res) => {
    const { establishment_id, from, to } = req.query;
    if (!establishment_id) return res.status(400).json({ error: 'establishment_id requis' });
    if (!canAccessEstablishment(req.session.user, establishment_id))
        return res.status(403).json({ error: 'Accès refusé' });
    try {
        const revQuery = { establishment_id };
        if (from || to) {
            revQuery.date = {};
            if (from) revQuery.date.$gte = from;
            if (to)   revQuery.date.$lte = to;
        }
        const revenues = await db.collection('daily_revenue').find(revQuery).toArray();
        if (revenues.length === 0) return res.json([]);

        const perfSettings = await db.collection('settings').findOne({ key: 'performance' }) || {};
        const chargeMult = chargeMultiplier(perfSettings.charge_rate);

        const dates = revenues.map(r => r.date);
        const shifts = await db.collection('shifts').find({
            establishment_id,
            date: { $in: dates },
            real_start: { $ne: null },
            real_end:   { $ne: null },
        }).toArray();

        // Charger les staff pour fallback taux horaire si snapshot absent
        const staffIds = [...new Set(shifts.map(s => s.staff_id).filter(id => id && id !== '__joker__' && isValidObjectId(id)))];
        const staffDocs = staffIds.length
            ? await db.collection('staff').find({ _id: { $in: staffIds.map(id => new ObjectId(id)) } }).toArray()
            : [];
        const staffMap = {};
        staffDocs.forEach(s => { staffMap[String(s._id)] = s; });

        // Grouper shifts par date
        const shiftsByDate = {};
        shifts.forEach(s => {
            if (!shiftsByDate[s.date]) shiftsByDate[s.date] = [];
            shiftsByDate[s.date].push(s);
        });

        const results = revenues.map(r => {
            const dayShifts = shiftsByDate[r.date] || [];
            let wage_bill_gross = 0;
            const staff_detail = [];

            dayShifts.forEach(s => {
                // Exclure les jokers : créneaux ouverts non affectés à un staff réel
                // (convention architecture.md §3 : is_joker || staff_id === '__joker__')
                if (s.is_joker || s.staff_id === '__joker__') return;
                const hours = (s.real_end - s.real_start);
                const staffDoc = staffMap[String(s.staff_id)];
                // Calcul wage : priorité snapshot (figé au pointage) > profil staff live.
                // Deux modes mutuellement exclusifs : forfait par shift OU taux horaire.
                let wage = 0;
                let rate = null;
                let is_fixed = false;
                if (s.fixed_rate_snapshot != null) {
                    wage = s.fixed_rate_snapshot;
                    rate = s.fixed_rate_snapshot;
                    is_fixed = true;
                } else if (s.hourly_rate_snapshot != null) {
                    wage = hours * s.hourly_rate_snapshot;
                    rate = s.hourly_rate_snapshot;
                } else if (staffDoc) {
                    if (staffDoc.fixed_rate != null) {
                        wage = staffDoc.fixed_rate;
                        rate = staffDoc.fixed_rate;
                        is_fixed = true;
                    } else if (staffDoc.hourly_rate != null) {
                        wage = hours * staffDoc.hourly_rate;
                        rate = staffDoc.hourly_rate;
                    }
                }
                wage_bill_gross += wage;
                staff_detail.push({
                    staff_name:   s.staff_name || (staffDoc && staffDoc.name) || 'Inconnu',
                    hours_worked: Math.round(hours * 100) / 100,
                    hourly_rate:  is_fixed ? null : rate,
                    fixed_rate:   is_fixed ? rate : null,
                    is_fixed,
                    wage_gross:   Math.round(wage * 100) / 100,
                    wage_charged: Math.round(wage * chargeMult * 100) / 100,
                });
            });

            const wage_bill_charged = wage_bill_gross * chargeMult;
            const coeff_gross   = r.revenue > 0 ? (wage_bill_gross   / r.revenue) * 100 : 0;
            const coeff_charged = r.revenue > 0 ? (wage_bill_charged / r.revenue) * 100 : 0;

            return {
                date:              r.date,
                revenue:           r.revenue,
                wage_bill_gross:   Math.round(wage_bill_gross   * 100) / 100,
                wage_bill_charged: Math.round(wage_bill_charged * 100) / 100,
                coeff_gross:       Math.round(coeff_gross   * 10) / 10,
                coeff_charged:     Math.round(coeff_charged * 10) / 10,
                staff_detail,
            };
        }).sort((a, b) => a.date < b.date ? 1 : -1);

        res.json(results);
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// GET/PATCH objectifs performance (coefficient cible)
app.get('/api/performance-settings', checkDB, requireAuth, async (req, res) => {
    try {
        const s = await db.collection('settings').findOne({ key: 'performance' }) || {};
        res.json({
            target_gross:   s.target_gross   ?? 30,
            target_charged: s.target_charged ?? 43,
            charge_rate:    s.charge_rate    ?? 45,
        });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

app.patch('/api/performance-settings', checkDB, requirePatron, async (req, res) => {
    const { target_gross, target_charged, charge_rate } = req.body;
    const update = { key: 'performance' };
    // Bornes raisonnables : 0–100 % pour les objectifs coeff, 0–200 % pour le taux de charges
    if (target_gross != null) {
        const v = parseFloat(target_gross);
        if (Number.isNaN(v) || v < 0 || v > 100) return res.status(400).json({ error: 'target_gross doit être entre 0 et 100' });
        update.target_gross = v;
    }
    if (target_charged != null) {
        const v = parseFloat(target_charged);
        if (Number.isNaN(v) || v < 0 || v > 100) return res.status(400).json({ error: 'target_charged doit être entre 0 et 100' });
        update.target_charged = v;
    }
    if (charge_rate != null) {
        const v = parseFloat(charge_rate);
        if (Number.isNaN(v) || v < 0 || v > 200) return res.status(400).json({ error: 'charge_rate doit être entre 0 et 200' });
        update.charge_rate = v;
    }
    try {
        await db.collection('settings').updateOne(
            { key: 'performance' },
            { $set: update },
            { upsert: true }
        );
        res.json({ message: 'Paramètres mis à jour' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// GET/PATCH paramètres pointage (heure de bascule jour)
app.get('/api/pointage-settings', checkDB, requireAuth, async (req, res) => {
    try {
        const s = await db.collection('settings').findOne({ key: 'pointage' }) || {};
        res.json({
            cutoff_hour:      s.cutoff_hour      ?? 9,  // fin de fenêtre (défaut 9h)
            cutoff_open_hour: s.cutoff_open_hour ?? 0,  // début de fenêtre (défaut minuit)
        });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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

        // Plusieurs responsables peuvent coexister sur le même établissement/date
        // (ex : 1 responsable matin + 1 responsable soir).
        await db.collection('shifts').updateOne(
            { _id: new ObjectId(req.params.id) },
            value === true ? { $set: { pointage_resp: true } } : { $unset: { pointage_resp: '' } }
        );
        res.json({ message: 'Responsable pointage mis à jour' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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

        // Snapshot du taux au premier pointage (si pas encore figé).
        // Capture le MODE actif (horaire OU forfait) ET la valeur — évite qu'un
        // changement de mode/taux rétroactif n'affecte les soirées passées.
        if (existing.hourly_rate_snapshot === undefined && existing.fixed_rate_snapshot === undefined
            && existing.staff_id && existing.staff_id !== '__joker__' && isValidObjectId(existing.staff_id)) {
            const staffDoc = await db.collection('staff').findOne({ _id: new ObjectId(existing.staff_id) });
            if (staffDoc) {
                if (staffDoc.fixed_rate != null) {
                    update.fixed_rate_snapshot  = staffDoc.fixed_rate;
                    update.hourly_rate_snapshot = null;
                } else {
                    update.hourly_rate_snapshot = staffDoc.hourly_rate != null ? staffDoc.hourly_rate : null;
                    update.fixed_rate_snapshot  = null;
                }
            }
        }

        await db.collection('shifts').updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
        res.json({ message: 'Heures réelles enregistrées' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// DELETE shift non pointé (depuis l'écran Pointage).
// Auth identique au PATCH pointage : établissement, patron/directeur, responsable de soirée.
// Refus si le shift a déjà des heures réelles saisies.
app.delete('/api/shifts/:id/pointage', checkDB, requireAuth, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const existing = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!existing) return res.status(404).json({ error: 'Shift introuvable' });
        const user = req.session.user;
        if (user.role === 'etablissement' && user.establishment_id !== existing.establishment_id)
            return res.status(403).json({ error: 'Accès refusé' });
        if (user.role !== 'etablissement' && !canAccessEstablishment(user, existing.establishment_id)) {
            const ok = await isResponsablePourSoiree(user.staff_id, existing.establishment_id, existing.date);
            if (!ok) return res.status(403).json({ error: 'Accès refusé' });
        }
        if (existing.real_start != null || existing.real_end != null)
            return res.status(409).json({ error: 'Shift déjà pointé, suppression interdite' });

        await db.collection('shifts').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ message: 'Shift supprimé' });
        touchLastUpdated();
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// PATCH marquer toutes les notifications comme lues
app.patch('/api/notifications/read-all', checkDB, requirePatron, async (req, res) => {
    const userId = req.session.user._id;
    try {
        await db.collection('notifications').deleteMany({ user_id: userId });
        res.json({ message: 'Notifications supprimées' });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
});

// GET timestamp dernière modification (polling auto-refresh clients)
app.get('/api/last-updated', checkDB, requireAuth, async (req, res) => {
    try {
        const doc = await db.collection('settings').findOne({ key: 'last_updated' });
        res.json({ ts: doc ? doc.ts : 0 });
    } catch (e) { console.error('[' + req.method + ' ' + req.path + ']', e); res.status(500).json({ error: 'Erreur interne' }); }
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

// N'écoute / ne se connecte à Mongo QUE si lancé directement (`node server.js`).
// Quand server.js est `require()` (tests d'intégration), on exporte l'app sans
// démarrer le serveur ni ouvrir de connexion — le test l'écoute sur un port éphémère.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log('🚀 Serveur sur http://localhost:' + PORT);
        connectDB();
    });
}

module.exports = app;
