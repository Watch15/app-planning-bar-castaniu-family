const { test } = require('node:test');
const assert = require('node:assert');
const { weekStart, currentWeekStart, WEEK_CUTOFF_HOUR } = require('../public/lib/week.js');

// Suite canonique du module isomorphe public/lib/week.js (R-01).
// `lib/utils.js` ré-exporte `weekStart` ; les pages front y délèguent `getMondayOf`.

const ymd = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

test('weekStart : un lundi retourne lui-même, à minuit local', () => {
    const m = weekStart(new Date(2026, 4, 11, 15, 30)); // lundi 11 mai 2026, 15h30
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
    assert.strictEqual(m.getDay(), 1);
    assert.strictEqual(m.getHours(), 0);
    assert.strictEqual(m.getMinutes(), 0);
    assert.strictEqual(m.getSeconds(), 0);
});

test('weekStart : un dimanche recule au lundi précédent (cas piège -6)', () => {
    const m = weekStart(new Date(2026, 4, 17, 23, 59)); // dimanche 17 mai 2026
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
    assert.strictEqual(m.getDay(), 1);
});

test('weekStart : un mercredi recule de 2 jours', () => {
    const m = weekStart(new Date(2026, 4, 13, 10, 0)); // mercredi 13 mai 2026
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
});

test('weekStart : bascule de mois en arrière (mardi 1 sept 2026 → lundi 31 août)', () => {
    const m = weekStart(new Date(2026, 8, 1, 12)); // mardi 1 septembre 2026
    assert.deepStrictEqual(ymd(m), [2026, 8, 31]);
    assert.strictEqual(m.getDay(), 1);
});

test('weekStart : bascule d\'année (jeudi 1 janv 2026 → lundi 29 déc 2025)', () => {
    const m = weekStart(new Date(2026, 0, 1, 8)); // jeudi 1 janvier 2026
    assert.deepStrictEqual(ymd(m), [2025, 12, 29]);
    assert.strictEqual(m.getDay(), 1);
});

test('weekStart : idempotent — weekStart(weekStart(d)) === weekStart(d)', () => {
    const d = new Date(2026, 4, 14, 18, 45); // jeudi
    const once  = weekStart(d);
    const twice = weekStart(once);
    assert.strictEqual(twice.getTime(), once.getTime());
});

test('weekStart : n\'altère pas l\'argument d\'origine (copie défensive)', () => {
    const d = new Date(2026, 4, 14, 18, 45);
    const before = d.getTime();
    weekStart(d);
    assert.strictEqual(d.getTime(), before);
});

test('weekStart : accepte une chaîne ISO locale', () => {
    const m = weekStart('2026-05-13T10:00:00'); // mercredi
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
});

// ── currentWeekStart (cutoff hebdo, défaut 6h) ───────────────────────────────

test('WEEK_CUTOFF_HOUR vaut 6 par défaut', () => {
    assert.strictEqual(WEEK_CUTOFF_HOUR, 6);
});

test('currentWeekStart : lundi 03h (avant cutoff) → semaine PRÉCÉDENTE', () => {
    // lundi 11 mai 2026, 3h → rattaché à dimanche 10 → lundi 4 mai
    const m = currentWeekStart(new Date(2026, 4, 11, 3, 0));
    assert.deepStrictEqual(ymd(m), [2026, 5, 4]);
});

test('currentWeekStart : lundi 06h (au cutoff) → semaine COURANTE', () => {
    const m = currentWeekStart(new Date(2026, 4, 11, 6, 0));
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
});

test('currentWeekStart : lundi 09h → semaine courante', () => {
    const m = currentWeekStart(new Date(2026, 4, 11, 9, 0));
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
});

test('currentWeekStart : mardi 03h (avant cutoff) reste dans la semaine courante', () => {
    // mardi 12 mai 3h → rattaché à lundi 11 → même semaine
    const m = currentWeekStart(new Date(2026, 4, 12, 3, 0));
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
});

test('currentWeekStart : dimanche soir 23h → semaine courante (pas de bascule)', () => {
    const m = currentWeekStart(new Date(2026, 4, 17, 23, 0)); // dimanche 17 mai
    assert.deepStrictEqual(ymd(m), [2026, 5, 11]);
});

test('currentWeekStart : cutoff personnalisé (9h) respecté', () => {
    // lundi 07h avec cutoff 9 → avant cutoff → semaine précédente
    const m = currentWeekStart(new Date(2026, 4, 11, 7, 0), 9);
    assert.deepStrictEqual(ymd(m), [2026, 5, 4]);
});
