require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const session = require('express-session');
const crypto  = require('crypto');

const app = express();
app.use(express.json());

const allowedOrigin = process.env.NODE_ENV === 'production'
    ? process.env.APP_URL
    : true;
app.use(cors({ origin: allowedOrigin, credentials: true }));

// ── Utilitaires sécurité ──────────────────────────────────────────────────────

function isValidObjectId(id) {
    return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

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
            from:    'Planning Bar <onboarding@resend.dev>',
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

function normalizePhone(raw) {
    // Supprime espaces, tirets, points — conserve + et chiffres
    let p = String(raw).replace(/[\s\-\.]/g, '');
    // France : 06... ou 07... → +336... / +337...
    if (/^0[67]/.test(p)) p = '+33' + p.slice(1);
    // Déjà au format international
    if (!/^\+/.test(p)) p = '+' + p;
    return p;
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
        secret:            process.env.SESSION_SECRET || 'planning-bar-secret-change-me',
        resave:            false,
        saveUninitialized: false,
        store:             new CustomMongoStore(),
        cookie: {
            httpOnly: true,
            secure:   process.env.NODE_ENV === 'production',
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
        if (phone) {
            const normalized = normalizePhone(phone);
            user = await db.collection('users').findOne({ phone: normalized });
            if (!user || !user.password_hash) return res.status(401).json({ error: 'Numéro ou mot de passe incorrect' });
            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) return res.status(401).json({ error: 'Numéro ou mot de passe incorrect' });
        } else {
            user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
            if (!user || !user.password_hash) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }
        req.session.user = {
            _id:                     String(user._id),
            email:                   user.email  || null,
            phone:                   user.phone  || null,
            role:                    user.role,
            staff_id:                user.staff_id || null,
            name:                    user.name || '',
            assigned_establishments: user.assigned_establishments || [],
            establishment_id:        user.establishment_id || null,
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

        const link = (process.env.APP_URL || 'http://localhost:3000') + '/set-password.html?token=' + token + '&mode=reset';

        // ── Envoi par SMS si compte téléphone ──────────────────────────────────
        if (phone) {
            let manual = false;
            try {
                await sendSMS(normalizePhone(phone), 'Planning Bar — Réinitialise ton mot de passe : ' + link + ' (expire dans 1h)');
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
        // Directeur : ne voit pas les comptes patron ni les autres directeurs
        if (req.session.user.role === 'directeur') {
            return res.json(users.filter(u => u.role === 'staff' || String(u._id) === req.session.user._id));
        }        res.json(users);
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
                email:                   null,
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
            const link = (process.env.APP_URL || 'http://localhost:3000') + '/set-password.html?token=' + token;
            let smsSent = true;
            try {
                await sendSMS(normalizedPhone, 'Planning Bar — Bienvenue ' + (name || '') + ' ! Crée ton mot de passe : ' + link);
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
                { $set: { email: email.toLowerCase().trim(), ...(normalizedPhone && { phone: normalizedPhone }) } }
            );
        }

        const link = (process.env.APP_URL || 'http://localhost:3000') + '/set-password.html?token=' + token;
        const html =
            '<p>Bonjour ' + (name || '') + ',</p>' +
            '<p>Tu as été invité(e) à rejoindre <strong>Planning Bar</strong>.</p>' +
            '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
            '<p style="color:#999;font-size:12px">Ce lien expire dans 24h.</p>';

        let manual = false;
        try {
            await sendEmail(email, 'Ton accès Planning Bar', html);
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

    const results = { created: [], skipped: [], failed: [] };

    for (const entry of entries) {
        const name  = (entry.name  || '').trim();
        const email = (entry.email || '').trim().toLowerCase() || null;
        const phone = (entry.phone || '').trim() || null;

        if (!name)            { results.failed.push({ entry, reason: 'Nom manquant' }); continue; }
        if (!email && !phone) { results.failed.push({ entry, reason: 'Email ou téléphone requis' }); continue; }

        try {
            if (email) {
                const ex = await db.collection('users').findOne({ email });
                if (ex) { results.skipped.push({ name, reason: 'Email déjà utilisé : ' + email }); continue; }
            }
            let normalizedPhone = null;
            if (phone) {
                normalizedPhone = normalizePhone(phone);
                const ex = await db.collection('users').findOne({ phone: normalizedPhone });
                if (ex) { results.skipped.push({ name, reason: 'Numéro déjà utilisé : ' + normalizedPhone }); continue; }
            }

            const token   = crypto.randomBytes(32).toString('hex');
            const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            // Créer le profil staff (couleur aléatoire parmi une palette)
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
                email, phone: normalizedPhone, password_hash: null, role: 'staff',
                staff_id: staffId, assigned_establishments: [],
                name, invite_token: hashToken(token), invite_expires: expires,
                active: false, created_at: new Date(),
            });

            const link = (process.env.APP_URL || 'http://localhost:3000') + '/set-password.html?token=' + token;
            let sent = false;

            if (normalizedPhone) {
                try {
                    await sendSMS(normalizedPhone, 'Planning Bar — Bienvenue ' + name + ' ! Crée ton mot de passe : ' + link);
                    sent = true;
                } catch (e) { console.error('Bulk SMS erreur ' + name + ':', e.message); }
            }
            if (email && !sent) {
                const html = '<p>Bonjour ' + name + ',</p><p>Tu as été invité(e) à rejoindre <strong>Planning Bar</strong>.</p>' +
                    '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
                    '<p style="color:#999;font-size:12px">Ce lien expire dans 7 jours.</p>';
                try { await sendEmail(email, 'Ton accès Planning Bar', html); sent = true; }
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

app.patch('/api/staff/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { color, name, email, venues, can_submit_dispos, groups } = req.body;
    if (!color && !name && email === undefined && venues === undefined && can_submit_dispos === undefined && req.body.roles === undefined && groups === undefined && req.body.name_color === undefined)
        return res.status(400).json({ error: 'color, name, email, venues, roles, groups, name_color ou can_submit_dispos requis' });
    try {
        const update = {};
        if (color)                           update.color             = color;
        if (name)                            update.name              = name;
        if (email !== undefined)             update.email             = email;
        if (venues !== undefined)            update.venues            = venues;
        if (req.body.roles !== undefined)    update.roles             = req.body.roles;
        if (can_submit_dispos !== undefined) update.can_submit_dispos = !!can_submit_dispos;
        if (groups !== undefined)            update.groups            = Array.isArray(groups) ? groups : [];
        if (req.body.name_color !== undefined) update.name_color      = req.body.name_color || null;
        const result = await db.collection('staff').updateOne(
            { _id: new ObjectId(req.params.id) }, { $set: update }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Staff introuvable' });
        if (color) await db.collection('shifts').updateMany({ staff_id: req.params.id }, { $set: { color } });
        if (name)  await db.collection('shifts').updateMany({ staff_id: req.params.id }, { $set: { staff_name: name } });
        res.json({ message: 'Staff mis à jour', updated: update });
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
        let allowedEstabIds = null;
        if (staffGroups.length > 0) {
            const groupEstabs = await db.collection('establishments').find({
                groups: { $in: staffGroups }
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
    const { staff_id, staff_name, establishment_id, date, start_time, end_time, color, is_joker } = req.body;
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
        };
        const result = await db.collection('shifts').insertOne(shift);
        res.status(201).json({ ...shift, _id: result.insertedId, warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/shifts/:id', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { start_time, end_time, staff_id, staff_name, color, is_joker } = req.body;
    const assigningStaff = staff_id !== undefined;
    if (!assigningStaff && start_time == null && end_time == null)
        return res.status(400).json({ error: 'start_time, end_time ou staff_id requis' });
    try {
        const existing = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!existing) return res.status(404).json({ error: 'Shift introuvable' });
        if (!canAccessEstablishment(req.session.user, existing.establishment_id))
            return res.status(403).json({ error: 'Accès refusé à cet établissement' });

        const newStart  = start_time != null ? parseFloat(start_time) : existing.start_time;
        const newEnd    = end_time   != null ? parseFloat(end_time)   : existing.end_time;
        if (newEnd <= newStart) return res.status(400).json({ error: 'end_time > start_time requis' });

        const updateFields = { start_time: newStart, end_time: newEnd };

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
        res.json({ message: 'Shift mis à jour', warnings });
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
            const newShifts = shifts.map(({ _id, ...rest }) => ({ ...rest, date }));
            if (newShifts.length > 0) { await db.collection('shifts').insertMany(newShifts); created += newShifts.length; }
        }
        res.json({ message: created + ' shifts copiés sur ' + to_dates.length + ' jour(s)' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Disponibilités ────────────────────────────────────────────────────────────

app.get('/api/dispo-settings', checkDB, requireAuth, async (req, res) => {
    try {
        const settings = await db.collection('settings').findOne({ key: 'dispo' }) || { open: true, message: null };
        const now    = new Date();
        const day    = now.getDay();
        const diff   = day <= 5 ? 5 - day : 5 - day + 7;
        const friday = new Date(now);
        friday.setDate(now.getDate() + diff);
        friday.setHours(13, 0, 0, 0);
        const forceOpen = !!settings.force_open;
        const customDeadline = settings.custom_deadline || null;
        const effectiveDeadline = customDeadline ? new Date(customDeadline) : friday;
        const effectiveDeadlinePassed = now > effectiveDeadline;

        // Vérifier si ce staff a le droit d'envoyer des dispos
        let staffCanSubmit = true;
        const staffId = req.session.user.staff_id;
        if (staffId && isValidObjectId(staffId)) {
            const staffDoc = await db.collection('staff').findOne({ _id: new ObjectId(staffId) });
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
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/dispo-settings', checkDB, requirePatron, async (req, res) => {
    const { open, message, force_open, custom_deadline } = req.body;
    try {
        const update = { key: 'dispo', open: !!open, message: message || null, force_open: !!force_open };
        if (custom_deadline !== undefined) update.custom_deadline = custom_deadline || null;
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

app.post('/api/dispos', checkDB, requireAuth, async (req, res) => {
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié' });
    // Vérifier que ce staff a le droit de soumettre des dispos
    const staffDoc = await db.collection('staff').findOne({ _id: new ObjectId(staffId) });
    if (staffDoc && staffDoc.can_submit_dispos === false)
        return res.status(403).json({ error: 'Tu n\'es pas autorisé à envoyer des disponibilités.' });
    const settings = await db.collection('settings').findOne({ key: 'dispo' }) || { open: true };
    const now = new Date();
    const day = now.getDay();
    const diff = day <= 5 ? 5 - day : 5 - day + 7;
    const friday = new Date(now);
    friday.setDate(now.getDate() + diff);
    friday.setHours(13, 0, 0, 0);
    if (!settings.open) return res.status(403).json({ error: 'La saisie des disponibilités est fermée.' });
    const effectiveFriday = settings.custom_deadline ? new Date(settings.custom_deadline) : friday;
    if (!settings.force_open && now > effectiveFriday)
        return res.status(403).json({ error: 'La deadline est passée.' });
    const { dispos } = req.body;
    if (!Array.isArray(dispos) || dispos.length === 0) return res.status(400).json({ error: 'Aucune disponibilité fournie' });
    try {
        const dates = dispos.map(d => d.date);
        await db.collection('availabilities').deleteMany({ staff_id: staffId, date: { $in: dates }, status: 'pending' });
        const docs = dispos.map(d => ({
            staff_id: staffId, staff_name: req.session.user.name || '',
            date: d.date, type: d.type || 'custom',
            start_time: parseFloat(d.start_time), end_time: parseFloat(d.end_time),
            note: d.note || '', status: 'pending', created_at: new Date(),
        }));
        await db.collection('availabilities').insertMany(docs);
        res.status(201).json({ message: docs.length + ' disponibilité(s) enregistrée(s)' });
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/dispos/:id/reject', checkDB, requirePatron, async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    try {
        const result = await db.collection('availabilities').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'rejected' } });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Dispo introuvable' });
        res.json({ message: 'Dispo refusée' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Publication du planning ───────────────────────────────────────────────────

// GET statut publication d'une semaine
app.get('/api/publish/:weekStart', checkDB, requireAuth, async (req, res) => {
    try {
        const pub = await db.collection('settings').findOne({ key: 'publish_' + req.params.weekStart });
        res.json({ published: !!(pub && pub.published) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH publier/dépublier une semaine (patron)
app.patch('/api/publish/:weekStart', checkDB, requirePatron, async (req, res) => {
    const { published } = req.body;
    try {
        await db.collection('settings').updateOne(
            { key: 'publish_' + req.params.weekStart },
            { $set: { key: 'publish_' + req.params.weekStart, published: !!published, updated_at: new Date() } },
            { upsert: true }
        );
        res.json({ message: published ? 'Planning publié' : 'Planning dépublié' });
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

// GET/PATCH paramètres pointage (heure de bascule jour)
app.get('/api/pointage-settings', checkDB, requireAuth, async (req, res) => {
    try {
        const s = await db.collection('settings').findOne({ key: 'pointage' }) || {};
        res.json({ cutoff_hour: s.cutoff_hour ?? 9 }); // défaut 9h
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/pointage-settings', checkDB, requireAdmin, async (req, res) => {
    const { cutoff_hour } = req.body;
    if (cutoff_hour == null || cutoff_hour < 0 || cutoff_hour > 23)
        return res.status(400).json({ error: 'cutoff_hour entre 0 et 23 requis' });
    try {
        await db.collection('settings').updateOne(
            { key: 'pointage' },
            { $set: { key: 'pointage', cutoff_hour: parseInt(cutoff_hour) } },
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
        if (user.role !== 'etablissement' && !canAccessEstablishment(user, existing.establishment_id))
            return res.status(403).json({ error: 'Accès refusé' });
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
    if (user.role !== 'etablissement' && !canAccessEstablishment(user, estabId))
        return res.status(403).json({ error: 'Accès refusé' });
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

// ── Route racine ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    if (!req.session?.user) return res.redirect('/login.html');
    if (req.session.user.role === 'etablissement') return res.redirect('/pointage.html');
    res.redirect('/index.html');
});

// ── Lancement ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 Serveur sur http://localhost:' + PORT);
    connectDB();
});