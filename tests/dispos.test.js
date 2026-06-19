// CD-06 — chemins critiques de POST /api/dispos (garde congé) + helper pur.
// S'appuie sur le harnais CD-05 : faux `db` en mémoire (app.locals.setTestDb)
// + session simulée par en-tête `x-test-user`. Aucun Mongo, aucune dépendance.

process.env.NODE_ENV       = 'test';
process.env.MONGO_URI      = process.env.MONGO_URI      || 'mongodb://127.0.0.1:27017/templyo_test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'integration-test-secret-0123456789abcdef';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { splitDisposByConges } = require('../lib/utils');
const { makeDb } = require('./helpers/fake-db');
const app = require('../server');

const STAFF_ID = '0123456789abcdef01234567';
const USER = { staff_id: STAFF_ID, name: 'Test Staff' };

let server, base;

before(async () => {
    server = app.listen(0);
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    base = 'http://127.0.0.1:' + server.address().port;
});

after(() => { if (server) server.close(); });

function postDispos(dispos) {
    return fetch(base + '/api/dispos', {
        method:  'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(USER) },
        body:    JSON.stringify({ dispos }),
    });
}

// ── Helper pur splitDisposByConges ────────────────────────────────────────────

test('splitDisposByConges — aucun congé → tout gardé', () => {
    const dispos = [{ date: '2099-01-05' }, { date: '2099-01-06' }];
    const r = splitDisposByConges(dispos, []);
    assert.equal(r.kept.length, 2);
    assert.deepEqual(r.skippedDates, []);
});

test('splitDisposByConges — un congé couvre un jour → ce jour ignoré, reste gardé', () => {
    const dispos = [{ date: '2099-01-05' }, { date: '2099-01-06' }, { date: '2099-01-07' }];
    const conges = [{ start_date: '2099-01-06', end_date: '2099-01-06' }];
    const r = splitDisposByConges(dispos, conges);
    assert.deepEqual(r.kept.map(d => d.date), ['2099-01-05', '2099-01-07']);
    assert.deepEqual(r.skippedDates, ['2099-01-06']);
});

test('splitDisposByConges — bornes incluses + dédoublonnage des dates', () => {
    const dispos = [{ date: '2099-01-05' }, { date: '2099-01-06' }, { date: '2099-01-07' }];
    const conges = [{ start_date: '2099-01-05', end_date: '2099-01-07' }]; // couvre tout
    const r = splitDisposByConges(dispos, conges);
    assert.equal(r.kept.length, 0);
    assert.deepEqual(r.skippedDates, ['2099-01-05', '2099-01-06', '2099-01-07']);
});

// ── Route POST /api/dispos ────────────────────────────────────────────────────

test('saisie fermée (settings.open=false) → 403', async () => {
    app.locals.setTestDb(makeDb({ settings: [{ key: 'dispo', open: false }] }));
    const res = await postDispos([{ date: '2099-01-05', type: 'custom', start_time: 18, end_time: 24 }]);
    assert.equal(res.status, 403);
});

test('jour de congé ignoré, les autres jours sont enregistrés → 201', async () => {
    const db = makeDb({
        settings:       [{ key: 'dispo', open: true, force_open: true }],
        time_off:       [{ staff_id: STAFF_ID, status: 'approved', start_date: '2099-01-06', end_date: '2099-01-06' }],
        availabilities: [],
    });
    app.locals.setTestDb(db);
    const res = await postDispos([
        { date: '2099-01-05', type: 'custom', start_time: 18, end_time: 24 },
        { date: '2099-01-06', type: 'custom', start_time: 18, end_time: 24 }, // congé
        { date: '2099-01-07', type: 'custom', start_time: 18, end_time: 24 },
    ]);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.match(body.message, /congé ignoré/);

    const saved = db.collection('availabilities')._docs.map(d => d.date).sort();
    assert.deepEqual(saved, ['2099-01-05', '2099-01-07']); // PAS le 06
});

test('toute la semaine en congé → 200, rien enregistré', async () => {
    const db = makeDb({
        settings:       [{ key: 'dispo', open: true, force_open: true }],
        time_off:       [{ staff_id: STAFF_ID, status: 'approved', start_date: '2099-01-05', end_date: '2099-01-09' }],
        availabilities: [],
    });
    app.locals.setTestDb(db);
    const res = await postDispos([
        { date: '2099-01-06', type: 'custom', start_time: 18, end_time: 24 },
        { date: '2099-01-07', type: 'custom', start_time: 18, end_time: 24 },
    ]);
    assert.equal(res.status, 200);
    assert.equal(db.collection('availabilities')._docs.length, 0);
});

test('purge d\'une dispo déjà posée sur un jour devenu congé', async () => {
    const db = makeDb({
        settings:       [{ key: 'dispo', open: true, force_open: true }],
        time_off:       [{ staff_id: STAFF_ID, status: 'approved', start_date: '2099-01-06', end_date: '2099-01-06' }],
        // dispo périmée déjà en base sur le jour désormais en congé
        availabilities: [{ staff_id: STAFF_ID, date: '2099-01-06', type: 'custom', status: 'pending' }],
    });
    app.locals.setTestDb(db);
    // On re-soumet le 06 (devenu congé) + un jour valide → le 06 est purgé et non ré-ajouté.
    const res = await postDispos([
        { date: '2099-01-05', type: 'custom', start_time: 18, end_time: 24 },
        { date: '2099-01-06', type: 'custom', start_time: 18, end_time: 24 },
    ]);
    assert.equal(res.status, 201);
    const dates = db.collection('availabilities')._docs.map(d => d.date).sort();
    assert.deepEqual(dates, ['2099-01-05']); // le 06 (congé) a été purgé et non ré-enregistré
});

test('cas nominal sans congé → 201, tous les jours enregistrés', async () => {
    const db = makeDb({
        settings:       [{ key: 'dispo', open: true, force_open: true }],
        time_off:       [],
        availabilities: [],
    });
    app.locals.setTestDb(db);
    const res = await postDispos([
        { date: '2099-01-05', type: 'custom', start_time: 18, end_time: 24 },
        { date: '2099-01-06', type: 'custom', start_time: 18, end_time: 24 },
    ]);
    assert.equal(res.status, 201);
    assert.equal(db.collection('availabilities')._docs.length, 2);
});
