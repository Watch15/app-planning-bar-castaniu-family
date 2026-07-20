// Absences des directeurs (E-19) — logique pure de lib/utils.js (modèle période)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateOffPeriod, scopeManagerOff } = require('../lib/utils');

const TODAY = '2026-07-20';

// ── validateOffPeriod ─────────────────────────────────────────────────────────

test('validateOffPeriod accepte une période future valide', () => {
    const r = validateOffPeriod('2026-07-25', '2026-07-30', TODAY);
    assert.equal(r.error, null);
    assert.equal(r.start, '2026-07-25');
    assert.equal(r.end, '2026-07-30');
});

test('validateOffPeriod : fin vide → période d\'un seul jour', () => {
    const r = validateOffPeriod('2026-07-25', '', TODAY);
    assert.equal(r.error, null);
    assert.equal(r.start, '2026-07-25');
    assert.equal(r.end, '2026-07-25');
});

test('validateOffPeriod : fin undefined → période d\'un seul jour', () => {
    const r = validateOffPeriod('2026-07-25', undefined, TODAY);
    assert.equal(r.end, '2026-07-25');
});

test('validateOffPeriod accepte une période commençant aujourd\'hui', () => {
    const r = validateOffPeriod(TODAY, TODAY, TODAY);
    assert.equal(r.error, null);
});

test('validateOffPeriod : période en cours (début passé, fin future) reste valide', () => {
    const r = validateOffPeriod('2026-07-18', '2026-07-25', TODAY);
    assert.equal(r.error, null); // fin ≥ aujourd'hui
});

test('validateOffPeriod rejette une fin avant le début', () => {
    const r = validateOffPeriod('2026-07-30', '2026-07-25', TODAY);
    assert.match(r.error, /fin doit être après/);
});

test('validateOffPeriod rejette une période entièrement passée', () => {
    const r = validateOffPeriod('2026-07-10', '2026-07-15', TODAY);
    assert.match(r.error, /à venir/);
});

test('validateOffPeriod rejette un format invalide', () => {
    assert.match(validateOffPeriod('25/07/2026', '2026-07-30', TODAY).error, /YYYY-MM-DD/);
    assert.match(validateOffPeriod('2026-07-25', '2026-7-5', TODAY).error, /YYYY-MM-DD/);
    assert.match(validateOffPeriod('', '', TODAY).error, /YYYY-MM-DD/);
});

// ── scopeManagerOff ───────────────────────────────────────────────────────────

const offs = [
    { _id: 'o1', user_id: 'U1', start_date: '2026-07-25', end_date: '2026-07-28', type: 'off', note: '' }, // dir bars e1,e2
    { _id: 'o2', user_id: 'U2', start_date: '2026-07-26', end_date: '2026-07-26', type: 'off', note: 'x' }, // dir bar e3
    { _id: 'o3', user_id: 'U3', start_date: '2026-07-27', end_date: '2026-07-27', type: 'off', note: '' }, // compte supprimé
];
const metaById = new Map([
    ['U1', { name: 'Alice', estabs: ['e1', 'e2'] }],
    ['U2', { name: 'Bob',   estabs: ['e3'] }],
    // U3 absent volontairement (compte supprimé)
]);
const canAccess = (viewer, estabId) => (viewer.assigned_establishments || []).includes(estabId);
const names = arr => arr.map(o => o.name).sort();

test('scopeManagerOff : patron voit toutes les absences (comptes existants)', () => {
    assert.deepEqual(names(scopeManagerOff(offs, metaById, { role: 'patron' }, canAccess)), ['Alice', 'Bob']);
});

test('scopeManagerOff : observateur voit tout aussi', () => {
    assert.deepEqual(names(scopeManagerOff(offs, metaById, { role: 'observateur' }, canAccess)), ['Alice', 'Bob']);
});

test('scopeManagerOff : directeur ne voit que les collègues partageant un établissement', () => {
    const r = scopeManagerOff(offs, metaById, { role: 'directeur', assigned_establishments: ['e2'] }, canAccess);
    assert.deepEqual(names(r), ['Alice']); // e2 ∈ {e1,e2} ; pas Bob (e3)
});

test('scopeManagerOff : directeur sans établissement commun ne voit personne', () => {
    const r = scopeManagerOff(offs, metaById, { role: 'directeur', assigned_establishments: ['e9'] }, canAccess);
    assert.deepEqual(r, []);
});

test('scopeManagerOff : absence d\'un compte supprimé est ignorée', () => {
    const r = scopeManagerOff(offs, metaById, { role: 'patron' }, canAccess);
    assert.equal(r.find(o => o.user_id === 'U3'), undefined);
});

test('scopeManagerOff : conserve start_date/end_date et enrichit le nom', () => {
    const r = scopeManagerOff([offs[0]], metaById, { role: 'patron' }, canAccess);
    assert.equal(r[0].name, 'Alice');
    assert.equal(r[0].start_date, '2026-07-25');
    assert.equal(r[0].end_date, '2026-07-28');
    assert.equal(r[0].type, 'off');
    assert.deepEqual(r[0].assigned_establishments, ['e1', 'e2']);
});
