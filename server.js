require('dotenv').config();
const express    = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const session    = require('express-session');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

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

// ── Mailer ────────────────────────────────────────────────────────────────────

const mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
    },
});

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
                    if (doc.expires < new Date()) {
                        this.destroy(sid, () => {});
                        return cb(null, null);
                    }
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
            )
            .then(() => cb(null))
            .catch(err => cb(err));
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

// ── Middlewares auth ──────────────────────────────────────────────────────────

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

app.post('/auth/set-password', checkDB, async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });
    if (password.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });
    try {
        const user = await db.collection('users').findOne({ invite_token: token });
        if (!user)                           return res.status(404).json({ error: 'Lien invalide' });
        if (user.invite_expires < new Date()) return res.status(410).json({ error: 'Lien expiré (24h)' });
        const hash = await bcrypt.hash(password, 12);
        await db.collection('users').updateOne(
            { invite_token: token },
            { $set: { password_hash: hash, active: true }, $unset: { invite_token: '', invite_expires: '' } }
        );
        res.json({ message: 'Mot de passe créé, tu peux te connecter' });
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

app.post('/api/users', checkDB, requirePatron, async (req, res) => {
    const { email, staff_id, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });
    try {
        const existing = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
        if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.collection('users').insertOne({
            email:          email.toLowerCase().trim(),
            password_hash:  null,
            role:           'staff',
            staff_id:       staff_id || null,
            name:           name || '',
            invite_token:   token,
            invite_expires: expires,
            active:         false,
            created_at:     new Date(),
        });

        if (staff_id) {
            await db.collection('staff').updateOne(
                { _id: new ObjectId(staff_id) },
                { $set: { email: email.toLowerCase().trim() } }
            );
        }

        const link = (process.env.APP_URL || 'http://localhost:3000') + '/set-password.html?token=' + token;

        console.log('Tentative envoi email vers:', email);
        console.log('Gmail user configuré:', process.env.GMAIL_USER ? 'OUI' : 'NON');
        console.log('Gmail pass configuré:', process.env.GMAIL_PASS ? 'OUI' : 'NON');
        
        try {
            await mailer.sendMail({
                from:    '"Planning Bar" <' + process.env.GMAIL_USER + '>',
                to:      email,
                subject: 'Ton accès Planning Bar',
                html:
                    '<p>Bonjour ' + (name || '') + ',</p>' +
                    '<p>Tu as été invité(e) à rejoindre <strong>Planning Bar</strong>.</p>' +
                    '<p><a href="' + link + '" style="background:#1a1a2e;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0">Créer mon mot de passe</a></p>' +
                    '<p style="color:#999;font-size:12px">Ce lien expire dans 24h.</p>',
            });
            console.log('✅ Email envoyé avec succès à', email);
            } catch (mailErr) {
                console.error('❌ Erreur envoi email:', mailErr.message);
                console.error('Code erreur:', mailErr.code);
                // On continue quand même — le compte est créé, le patron peut copier le lien manuellement
                console.log('Lien d\'invitation (à envoyer manuellement):', link);
            }

        res.status(201).json({ message: 'Invitation envoyée à ' + email });
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
            .sort({ start_time: 1 })
            .toArray();
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
        for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1))
            summary[d.toISOString().slice(0, 10)] = 0;
        shifts.forEach(s => { if (summary[s.date] !== undefined) summary[s.date]++; });
        res.json(summary);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET shifts de la semaine pour le staff connecté
// /api/my-shifts?from=2025-06-16&to=2025-06-22
app.get('/api/my-shifts', checkDB, requireAuth, async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
    const staffId = req.session.user.staff_id;
    if (!staffId) return res.status(400).json({ error: 'Aucun profil staff lié à ce compte' });
    try {
        // Shifts du staff sur la période
        const myShifts = await db.collection('shifts').find({
            staff_id: staffId,
            date: { $gte: from, $lte: to }
        }).sort({ date: 1, start_time: 1 }).toArray();

        // Pour chaque jour où ce staff travaille, récupérer les collègues
        const dates = [...new Set(myShifts.map(s => s.date))];
        const colleagueMap = {};
        for (const date of dates) {
            const allShifts = await db.collection('shifts').find({
                date,
                establishment_id: { $in: myShifts.filter(s => s.date === date).map(s => s.establishment_id) },
                staff_id: { $ne: staffId }
            }).toArray();
            colleagueMap[date] = allShifts;
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
            if (newShifts.length > 0) {
                await db.collection('shifts').insertMany(newShifts);
                created += newShifts.length;
            }
        }
        res.json({ message: created + ' shifts copiés sur ' + to_dates.length + ' jour(s)' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Route racine ──────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.redirect(req.session?.user ? '/index.html' : '/login.html');
});

app.get('/planning', (req, res) => {
    res.sendFile('planning.html', { root: 'public' });
});

// ── Lancement ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 Serveur sur http://localhost:' + PORT);
    connectDB();
});