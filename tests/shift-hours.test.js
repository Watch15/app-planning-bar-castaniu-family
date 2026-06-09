const { test } = require('node:test');
const assert = require('node:assert');
const { shiftEffectiveHours, shiftDurationHours, fmtHourOfDay, fmtClock, fmtDurationH } = require('../public/lib/shift-hours.js');

test('pointage complet → heures réelles utilisées', () => {
    const s = { start_time: 18, end_time: 24, real_start: 18.5, real_end: 26 };
    const r = shiftEffectiveHours(s);
    assert.strictEqual(r.start, 18.5);
    assert.strictEqual(r.end, 26);
    assert.strictEqual(r.isReal, true);
    assert.strictEqual(shiftDurationHours(s), 7.5);
});

test('pointage partiel (fin manquante) → planifié, AUCUN mélange réel/planifié', () => {
    const s = { start_time: 18, end_time: 24, real_start: 18.5, real_end: null };
    const r = shiftEffectiveHours(s);
    assert.strictEqual(r.start, 18);   // planifié — surtout pas 18.5
    assert.strictEqual(r.end, 24);
    assert.strictEqual(r.isReal, false);
    assert.strictEqual(shiftDurationHours(s), 6);
});

test('pointage partiel (début manquant) → planifié', () => {
    const s = { start_time: 18, end_time: 24, real_start: null, real_end: 25 };
    const r = shiftEffectiveHours(s);
    assert.strictEqual(r.start, 18);
    assert.strictEqual(r.end, 24);     // planifié — surtout pas 25
    assert.strictEqual(r.isReal, false);
});

test('aucun pointage → heures planifiées', () => {
    const s = { start_time: 17, end_time: 23 };
    const r = shiftEffectiveHours(s);
    assert.strictEqual(r.start, 17);
    assert.strictEqual(r.end, 23);
    assert.strictEqual(r.isReal, false);
    assert.strictEqual(shiftDurationHours(s), 6);
});

test('shift de nuit : réel passant minuit (end > 24)', () => {
    const s = { start_time: 22, end_time: 28, real_start: 22, real_end: 27.5 };
    assert.strictEqual(shiftDurationHours(s), 5.5);
    assert.strictEqual(shiftEffectiveHours(s).isReal, true);
});

test('real_start = 0 (minuit) est bien traité comme une valeur, pas comme absent', () => {
    // 0 != null → ne doit PAS être confondu avec "non pointé"
    const s = { start_time: 23, end_time: 25, real_start: 0, real_end: 2 };
    const r = shiftEffectiveHours(s);
    assert.strictEqual(r.start, 0);
    assert.strictEqual(r.end, 2);
    assert.strictEqual(r.isReal, true);
});

// ── Formatage des heures ──────────────────────────────────────────────────────

test('fmtHourOfDay : heure d’horloge "HHh", minutes omises si pile', () => {
    assert.strictEqual(fmtHourOfDay(14), '14h');
    assert.strictEqual(fmtHourOfDay(14.5), '14h30');
    assert.strictEqual(fmtHourOfDay(9.25), '09h15');
    assert.strictEqual(fmtHourOfDay(0), '00h');
});

test('fmtHourOfDay : bornée à 24h (créneau de nuit)', () => {
    assert.strictEqual(fmtHourOfDay(24), '00h');
    assert.strictEqual(fmtHourOfDay(25.5), '01h30');
    assert.strictEqual(fmtHourOfDay(null), '');
});

test('fmtClock : format ":" du pointage, minutes toujours affichées', () => {
    assert.strictEqual(fmtClock(14), '14:00');
    assert.strictEqual(fmtClock(9.5), '09:30');
    assert.strictEqual(fmtClock(null), '--:--');
    assert.strictEqual(fmtClock(25), '01:00');
});

test('fmtDurationH : cumul non borné à 24h', () => {
    assert.strictEqual(fmtDurationH(7), '7h');
    assert.strictEqual(fmtDurationH(37.5), '37h30');
    assert.strictEqual(fmtDurationH(null), '');
});

test('fmtDurationH : écart négatif avec signe et texte null personnalisés', () => {
    assert.strictEqual(fmtDurationH(-1.5, { nullText: '—', minus: '−' }), '−1h30');
    assert.strictEqual(fmtDurationH(2, { nullText: '—', minus: '−' }), '2h');
    assert.strictEqual(fmtDurationH(null, { nullText: '—', minus: '−' }), '—');
});

test('fmtDurationH : padMinutes force "HHhMM" (export CSV)', () => {
    assert.strictEqual(fmtDurationH(8, { padMinutes: true }), '8h00');
    assert.strictEqual(fmtDurationH(-0.5, { padMinutes: true }), '-0h30');
});
