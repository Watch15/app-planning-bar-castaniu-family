require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const session = require('express-session');
const crypto  = require('crypto');

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static('public'));

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

function requirePatron(req, res, next) {
    if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.session.user.role !== 'patron') return res.status(403).json({ error: 'Accès réservé au patron' });
    next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/auth/login', checkDB, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    try {
        const user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
        if (!user || !user.password_hash) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        req.session.user = {
            _id:      String(user._id),
            email:    user.email,
            role:     user.role,
            staff_id: user.staff_id || null,
            name:     user.name || '',
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
        const user = await db.collection('users').findOne({ invite_token: token });
        if (!user)                            return res.status(404).json({ error: 'Lien invalide' });
        if (user.invite_expires < new Date()) return res.status(410).json({ error: 'Lien expiré (24h)' });
        const hash = await bcrypt.hash(password, 12);
        await db.collection('users').updateOne(
            { invite_token: token },
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
        const user = await db.collection('users').findOne({ reset_token: token });
        if (!user)                           return res.status(404).json({ error: 'Lien invalide' });
        if (user.reset_expires < new Date()) return res.status(410).json({ error: 'Lien expiré (1h)' });
        const hash = await bcrypt.hash(password, 12);
        await db.collection('users').updateOne(
            { reset_token: token },
            { $set: { password_hash: hash }, $unset: { reset_token: '', reset_expires: '' } }
        );
        res.json({ message: 'Mot de passe mis à jour, tu peux te connecter' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mot de passe oublié — envoi email reset
app.post('/auth/forgot-password', checkDB, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });
    try {
        const user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
        if (!user) return res.json({ message: 'Si cet email existe, un lien a été envoyé.' });

        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { reset_token: token, reset_expires: expires } }
        );

        const link = (process.env.APP_URL || 'http://localhost:3000') + '/set-password.html?token=' + token + '&mode=reset';
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
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Inviter un utilisateur (staff ou patron)
app.post('/api/users', checkDB, requirePatron, async (req, res) => {
    const { email, staff_id, name, role } = req.body;
    const userRole = role === 'patron' ? 'patron' : 'staff';
    if (!email) return res.status(400).json({ error: 'Email requis' });
    try {
        const existing = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
        if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.collection('users').insertOne({
            email:          email.toLowerCase().trim(),
            password_hash:  null,
            role:           userRole,
            staff_id:       userRole === 'staff' ? (staff_id || null) : null,
            name:           name || '',
            invite_token:   token,
            invite_expires: expires,
            active:         false,
            created_at:     new Date(),
        });

        if (staff_id && userRole === 'staff') {
            await db.collection('staff').updateOne(
                { _id: new ObjectId(staff_id) },
                { $set: { email: email.toLowerCase().trim() } }
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
            // Ne pas supprimer le compte — retourner le lien pour envoi manuel
        }

        res.status(201).json({
            message: manual ? 'Compte créé mais email non envoyé.' : 'Invitation envoyée à ' + email,
            ...(manual && { link, manual: true }),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset mot de passe par le patron
app.patch('/api/users/:id/reset-password', checkDB, requirePatron, async (req, res) => {
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
    try {
        const result = await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
        res.json({ message: 'Compte supprimé' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Établissements ────────────────────────────────────────────────────────────

app.get('/api/establishments', checkDB, requireAuth, async (req, res) => {
    try { res.json(await db.collection('establishments').find().toArray()); }
    catch (e) { res.status(500).json({ error: e.message }); }
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
    const { color, name, email } = req.body;
    if (!color && !name && email === undefined) return res.status(400).json({ error: 'color, name ou email requis' });
    try {
        const update = {};
        if (color)               update.color = color;
        if (name)                update.name  = name;
        if (email !== undefined) update.email = email;
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
        const myShifts = await db.collection('shifts').find({
            staff_id: staffId, date: { $gte: from, $lte: to }
        }).sort({ date: 1, start_time: 1 }).toArray();

        const dates = [...new Set(myShifts.map(s => s.date))];
        const colleagueMap = {};
        for (const date of dates) {
            colleagueMap[date] = await db.collection('shifts').find({
                date,
                establishment_id: { $in: myShifts.filter(s => s.date === date).map(s => s.establishment_id) },
                staff_id: { $ne: staffId }
            }).toArray();
        }
        res.json({ shifts: myShifts, colleagues: colleagueMap });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shifts — écriture ─────────────────────────────────────────────────────────

app.post('/api/shifts', checkDB, requirePatron, async (req, res) => {
    const { staff_id, staff_name, establishment_id, date, start_time, end_time, color } = req.body;
    if (!staff_id || !establishment_id || !date || start_time == null || end_time == null)
        return res.status(400).json({ error: 'staff_id, establishment_id, date, start_time, end_time requis' });
    if (end_time <= start_time) return res.status(400).json({ error: 'end_time > start_time requis' });
    try {
        const conflicts = await db.collection('shifts').find({
            staff_id, date, establishment_id: { $ne: establishment_id }
        }).toArray();
        const warnings = [];
        for (const s of conflicts) {
            const gap = Math.min(Math.abs(start_time - s.end_time), Math.abs(s.start_time - end_time));
            if (start_time < s.end_time && end_time > s.start_time)
                warnings.push({ type: 'overlap', message: 'Chevauchement avec ' + s.establishment_id });
            else if (gap < 1)
                warnings.push({ type: 'gap', message: 'Seulement ' + Math.round(gap * 60) + ' min de coupure avec ' + s.establishment_id });
        }
        const shift  = { staff_id, staff_name: staff_name || '', establishment_id, date, start_time: parseFloat(start_time), end_time: parseFloat(end_time), color: color || '#3498db' };
        const result = await db.collection('shifts').insertOne(shift);
        res.status(201).json({ ...shift, _id: result.insertedId, warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/shifts/:id', checkDB, requirePatron, async (req, res) => {
    const { start_time, end_time } = req.body;
    if (start_time == null && end_time == null) return res.status(400).json({ error: 'start_time ou end_time requis' });
    try {
        const existing = await db.collection('shifts').findOne({ _id: new ObjectId(req.params.id) });
        if (!existing) return res.status(404).json({ error: 'Shift introuvable' });
        const newStart = start_time != null ? parseFloat(start_time) : existing.start_time;
        const newEnd   = end_time   != null ? parseFloat(end_time)   : existing.end_time;
        if (newEnd <= newStart) return res.status(400).json({ error: 'end_time > start_time requis' });
        const conflicts = await db.collection('shifts').find({
            staff_id: existing.staff_id, date: existing.date,
            establishment_id: { $ne: existing.establishment_id },
            _id: { $ne: new ObjectId(req.params.id) }
        }).toArray();
        const warnings = [];
        for (const s of conflicts) {
            const gap = Math.min(Math.abs(newStart - s.end_time), Math.abs(s.start_time - newEnd));
            if (newStart < s.end_time && newEnd > s.start_time)
                warnings.push({ type: 'overlap', message: 'Chevauchement avec ' + s.establishment_id });
            else if (gap < 1)
                warnings.push({ type: 'gap', message: Math.round(gap * 60) + ' min de coupure avec ' + s.establishment_id });
        }
        await db.collection('shifts').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { start_time: newStart, end_time: newEnd } }
        );
        res.json({ message: 'Shift mis à jour', warnings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/shifts/:id', checkDB, requirePatron, async (req, res) => {
    try {
        const result = await db.collection('shifts').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Shift introuvable' });
        res.json({ message: 'Shift supprimé' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/copy-day', checkDB, requirePatron, async (req, res) => {
    const { establishment_id, to_dates, shifts } = req.body;
    if (!establishment_id || !to_dates?.length || !shifts?.length)
        return res.status(400).json({ error: 'establishment_id, to_dates, shifts requis' });
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
        const deadlinePassed = now > friday;
        res.json({ open: settings.open, message: settings.message, deadline: friday.toISOString(), deadlinePassed, canSubmit: settings.open && !deadlinePassed });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/dispo-settings', checkDB, requirePatron, async (req, res) => {
    const { open, message } = req.body;
    try {
        await db.collection('settings').updateOne(
            { key: 'dispo' },
            { $set: { key: 'dispo', open: !!open, message: message || null } },
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
    const settings = await db.collection('settings').findOne({ key: 'dispo' }) || { open: true };
    const now = new Date();
    const day = now.getDay();
    const diff = day <= 5 ? 5 - day : 5 - day + 7;
    const friday = new Date(now);
    friday.setDate(now.getDate() + diff);
    friday.setHours(13, 0, 0, 0);
    if (!settings.open) return res.status(403).json({ error: 'La saisie des disponibilités est fermée.' });
    if (now > friday)   return res.status(403).json({ error: 'La deadline est passée (vendredi 13h).' });
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

// ── Route racine ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.redirect(req.session?.user ? '/index.html' : '/login.html');
});

// ── Lancement ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 Serveur sur http://localhost:' + PORT);
    connectDB();
});