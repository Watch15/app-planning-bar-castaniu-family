// Premier test d'intégration de routes — démarre l'app Express sur un port
// éphémère et tape les routes via HTTP (fetch natif). Aucune dépendance ajoutée,
// AUCUNE base de données : on cible des routes qui répondent SANS Mongo
// (401 sans session, 503 si la base est absente via le middleware checkDB).
//
// Prérequis (D-82) : server.js exporte `app` et n'écoute/ne se connecte que
// lorsqu'il est lancé directement (`require.main === module`).

// Variables d'env sûres AVANT le require — `dotenv.config()` (dans server.js) ne
// réécrit pas les vars déjà définies. Évite le hard-crash prod et toute connexion
// à la vraie base (connectDB n'est de toute façon jamais appelé en require).
process.env.NODE_ENV     = 'test';
process.env.MONGO_URI     = process.env.MONGO_URI     || 'mongodb://127.0.0.1:27017/templyo_test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'integration-test-secret-0123456789abcdef';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

let server, base;

before(async () => {
    server = app.listen(0); // port éphémère
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

after(() => { if (server) server.close(); });

test('GET /auth/me sans session → 401 JSON', async () => {
    const res = await fetch(base + '/auth/me');
    assert.equal(res.status, 401);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    const body = await res.json();
    assert.equal(body.error, 'Non authentifié');
});

test('GET /api/establishments sans base → 503 (middleware checkDB)', async () => {
    const res = await fetch(base + '/api/establishments');
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'Base de données non disponible');
});

// Anti-injection NoSQL : un opérateur Mongo passé en query (`?from[$gt]=x`) est
// parsé en objet par qs → rejeté en 400 AVANT d'atteindre la moindre requête.
test('query param objet ($gt) → 400 (anti-injection NoSQL)', async () => {
    const res = await fetch(base + '/api/establishments?' + encodeURIComponent('from[$gt]') + '=2020');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Paramètre de requête invalide');
});

// Contre-épreuve : un query param scalaire normal n'est PAS bloqué par le
// middleware (il poursuit jusqu'à checkDB → 503 sans base).
test('query param scalaire normal → traverse le middleware anti-injection', async () => {
    const res = await fetch(base + '/api/establishments?from=2020-01-01');
    assert.equal(res.status, 503);
});

// Absences directeur (E-19) : les routes sont montées (503 via checkDB sans base,
// et non 404 — preuve du bon chemin + méthode). L'auth requireDirecteur passe
// APRÈS checkDB, donc sans base on obtient bien 503.
test('GET /api/me/manager-off est montée (→ 503 sans base)', async () => {
    const res = await fetch(base + '/api/me/manager-off');
    assert.equal(res.status, 503);
});
test('POST /api/me/manager-off est montée (→ 503 sans base)', async () => {
    const res = await fetch(base + '/api/me/manager-off', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dates: ['2026-08-01'] }),
    });
    assert.equal(res.status, 503);
});
test('DELETE /api/me/manager-off/:date est montée (→ 503 sans base)', async () => {
    const res = await fetch(base + '/api/me/manager-off/2026-08-01', { method: 'DELETE' });
    assert.equal(res.status, 503);
});
test('GET /api/managers-off est montée (→ 503 sans base)', async () => {
    const res = await fetch(base + '/api/managers-off');
    assert.equal(res.status, 503);
});
