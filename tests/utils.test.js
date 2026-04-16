const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    isValidObjectId,
    hashToken,
    normalizePhone,
    computeActiveDate,
    toDateStr,
} = require('../lib/utils');

// ── isValidObjectId ──────────────────────────────────────────────────────────

test('isValidObjectId accepte un ObjectId hexadécimal de 24 caractères', () => {
    assert.equal(isValidObjectId('507f1f77bcf86cd799439011'), true);
    assert.equal(isValidObjectId('AAAAAAAAAAAAAAAAAAAAAAAA'), true);
});

test('isValidObjectId refuse les tailles incorrectes', () => {
    assert.equal(isValidObjectId(''), false);
    assert.equal(isValidObjectId('507f1f77bcf86cd79943901'),   false);
    assert.equal(isValidObjectId('507f1f77bcf86cd7994390111'), false);
});

test('isValidObjectId refuse les caractères non hexadécimaux', () => {
    assert.equal(isValidObjectId('507f1f77bcf86cd79943901Z'), false);
    assert.equal(isValidObjectId('zzzzzzzzzzzzzzzzzzzzzzzz'), false);
});

test('isValidObjectId refuse les types non-string', () => {
    assert.equal(isValidObjectId(null), false);
    assert.equal(isValidObjectId(undefined), false);
    assert.equal(isValidObjectId(12345), false);
    assert.equal(isValidObjectId({}), false);
});

// ── hashToken ────────────────────────────────────────────────────────────────

test('hashToken produit un SHA-256 de 64 caractères hex', () => {
    const h = hashToken('abc');
    assert.match(h, /^[a-f0-9]{64}$/);
});

test('hashToken est déterministe', () => {
    assert.equal(hashToken('hello'), hashToken('hello'));
});

test('hashToken donne des sorties différentes pour des entrées différentes', () => {
    assert.notEqual(hashToken('foo'), hashToken('bar'));
});

// ── normalizePhone ───────────────────────────────────────────────────────────

test('normalizePhone transforme 06... en +336...', () => {
    assert.equal(normalizePhone('0612345678'), '+33612345678');
});

test('normalizePhone transforme 07... en +337...', () => {
    assert.equal(normalizePhone('0712345678'), '+33712345678');
});

test('normalizePhone supprime espaces, tirets et points', () => {
    assert.equal(normalizePhone('06 12 34 56 78'),  '+33612345678');
    assert.equal(normalizePhone('06-12-34-56-78'),  '+33612345678');
    assert.equal(normalizePhone('06.12.34.56.78'),  '+33612345678');
});

test('normalizePhone conserve un numéro déjà international', () => {
    assert.equal(normalizePhone('+33612345678'), '+33612345678');
    assert.equal(normalizePhone('+14155551234'), '+14155551234');
});

test('normalizePhone ajoute + devant un numéro non préfixé non-FR', () => {
    assert.equal(normalizePhone('14155551234'), '+14155551234');
});

// ── computeActiveDate ────────────────────────────────────────────────────────

test('computeActiveDate : heure >= cutoff → date du jour', () => {
    const now = new Date(2026, 3, 12, 15, 30); // 12 avril 15h30
    const active = computeActiveDate(now, 9);
    assert.equal(active.getDate(), 12);
    assert.equal(active.getMonth(), 3);
    assert.equal(active.getHours(), 0);
});

test('computeActiveDate : heure < cutoff → date de la veille', () => {
    const now = new Date(2026, 3, 12, 2, 30); // 12 avril 2h30 du matin
    const active = computeActiveDate(now, 9);
    assert.equal(active.getDate(), 11);
    assert.equal(active.getMonth(), 3);
    assert.equal(active.getHours(), 0);
});

test('computeActiveDate : pile à cutoff → date du jour', () => {
    const now = new Date(2026, 3, 12, 9, 0); // 12 avril 9h00
    const active = computeActiveDate(now, 9);
    assert.equal(active.getDate(), 12);
});

test('computeActiveDate gère le passage au mois précédent', () => {
    const now = new Date(2026, 3, 1, 3, 0); // 1er avril 3h du matin
    const active = computeActiveDate(now, 9);
    assert.equal(active.getDate(), 31);
    assert.equal(active.getMonth(), 2); // mars
});

test('computeActiveDate gère le passage à l\'année précédente', () => {
    const now = new Date(2026, 0, 1, 5, 0); // 1er janvier 5h
    const active = computeActiveDate(now, 9);
    assert.equal(active.getDate(), 31);
    assert.equal(active.getMonth(), 11); // décembre
    assert.equal(active.getFullYear(), 2025);
});

test('computeActiveDate : cutoff 0 → jamais de bascule sur la veille', () => {
    const now = new Date(2026, 3, 12, 0, 0);
    const active = computeActiveDate(now, 0);
    assert.equal(active.getDate(), 12);
});

// ── toDateStr ────────────────────────────────────────────────────────────────

test('toDateStr formate en YYYY-MM-DD avec zéros de padding', () => {
    assert.equal(toDateStr(new Date(2026, 0, 1)),  '2026-01-01');
    assert.equal(toDateStr(new Date(2026, 11, 31)), '2026-12-31');
    assert.equal(toDateStr(new Date(2026, 3, 7)),   '2026-04-07');
});

test('toDateStr utilise l\'heure locale (pas UTC)', () => {
    // 23h59 local ne doit PAS basculer au lendemain UTC
    const d = new Date(2026, 3, 12, 23, 59, 59);
    assert.equal(toDateStr(d), '2026-04-12');
});
