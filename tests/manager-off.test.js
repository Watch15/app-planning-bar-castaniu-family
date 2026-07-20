// Absences des directeurs (E-19) — logique pure de lib/utils.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanOffDates, scopeManagerOff } = require('../lib/utils');

const TODAY = '2026-07-20';

// ── cleanOffDates ─────────────────────────────────────────────────────────────

test('cleanOffDates accepte un tableau de jours futurs valides', () => {
    const r = cleanOffDates(['2026-07-25', '2026-08-01'], TODAY);
    assert.equal(r.error, null);
    assert.deepEqual(r.clean, ['2026-07-25', '2026-08-01']);
});

test('cleanOffDates accepte une date unique (string)', () => {
    const r = cleanOffDates('2026-07-25', TODAY);
    assert.equal(r.error, null);
    assert.deepEqual(r.clean, ['2026-07-25']);
});

test('cleanOffDates déduplique', () => {
    const r = cleanOffDates(['2026-07-25', '2026-07-25'], TODAY);
    assert.deepEqual(r.clean, ['2026-07-25']);
});

test('cleanOffDates inclut aujourd\'hui (borne = à venir)', () => {
    const r = cleanOffDates([TODAY], TODAY);
    assert.equal(r.error, null);
    assert.deepEqual(r.clean, [TODAY]);
});

test('cleanOffDates rejette un jour passé', () => {
    const r = cleanOffDates(['2026-07-19'], TODAY);
    assert.match(r.error, /à venir/);
    assert.deepEqual(r.clean, []);
});

test('cleanOffDates rejette un format invalide', () => {
    assert.match(cleanOffDates(['25/07/2026'], TODAY).error, /YYYY-MM-DD/);
    assert.match(cleanOffDates(['2026-7-5'], TODAY).error, /YYYY-MM-DD/);
});

test('cleanOffDates rejette une liste vide / absente', () => {
    assert.match(cleanOffDates([], TODAY).error, /Aucune date/);
    assert.match(cleanOffDates(null, TODAY).error, /Aucune date/);
    assert.match(cleanOffDates(undefined, TODAY).error, /Aucune date/);
});

test('cleanOffDates : un seul jour passé dans le lot rejette tout le lot', () => {
    const r = cleanOffDates(['2026-07-25', '2026-07-01'], TODAY);
    assert.match(r.error, /à venir/);
    assert.deepEqual(r.clean, []);
});

// ── scopeManagerOff ───────────────────────────────────────────────────────────

const offs = [
    { _id: 'o1', user_id: 'U1', date: '2026-07-25', type: 'off', note: '' }, // dir bars e1,e2
    { _id: 'o2', user_id: 'U2', date: '2026-07-26', type: 'off', note: 'x' }, // dir bar e3
    { _id: 'o3', user_id: 'U3', date: '2026-07-27', type: 'off', note: '' }, // compte supprimé
];
const metaById = new Map([
    ['U1', { name: 'Alice', estabs: ['e1', 'e2'] }],
    ['U2', { name: 'Bob',   estabs: ['e3'] }],
    // U3 absent volontairement (compte supprimé)
]);
const canAccess = (viewer, estabId) => (viewer.assigned_establishments || []).includes(estabId);
const names = arr => arr.map(o => o.name).sort();

test('scopeManagerOff : patron voit toutes les absences (comptes existants)', () => {
    const r = scopeManagerOff(offs, metaById, { role: 'patron' }, canAccess);
    assert.deepEqual(names(r), ['Alice', 'Bob']);
});

test('scopeManagerOff : observateur voit tout aussi', () => {
    const r = scopeManagerOff(offs, metaById, { role: 'observateur' }, canAccess);
    assert.deepEqual(names(r), ['Alice', 'Bob']);
});

test('scopeManagerOff : directeur ne voit que les collègues partageant un établissement', () => {
    const viewer = { role: 'directeur', assigned_establishments: ['e2'] };
    const r = scopeManagerOff(offs, metaById, viewer, canAccess);
    assert.deepEqual(names(r), ['Alice']); // e2 ∈ {e1,e2} ; pas Bob (e3)
});

test('scopeManagerOff : directeur sans établissement commun ne voit personne', () => {
    const viewer = { role: 'directeur', assigned_establishments: ['e9'] };
    const r = scopeManagerOff(offs, metaById, viewer, canAccess);
    assert.deepEqual(r, []);
});

test('scopeManagerOff : absence d\'un compte supprimé est ignorée', () => {
    const r = scopeManagerOff(offs, metaById, { role: 'patron' }, canAccess);
    assert.equal(r.find(o => o.user_id === 'U3'), undefined);
});

test('scopeManagerOff : enrichit avec le nom courant et un type off par défaut', () => {
    const r = scopeManagerOff([{ _id: 'o1', user_id: 'U1', date: '2026-07-25' }], metaById, { role: 'patron' }, canAccess);
    assert.equal(r[0].name, 'Alice');
    assert.equal(r[0].type, 'off');
    assert.deepEqual(r[0].assigned_establishments, ['e1', 'e2']);
});
