const { test } = require('node:test');
const assert = require('node:assert/strict');
const { datesOverlap, congeCoversDate } = require('../lib/utils');

// ── datesOverlap ─────────────────────────────────────────────────────────────

test('datesOverlap détecte un chevauchement franc', () => {
    assert.equal(datesOverlap('2026-06-10', '2026-06-15', '2026-06-12', '2026-06-20'), true);
});

test('datesOverlap détecte une inclusion totale', () => {
    assert.equal(datesOverlap('2026-06-10', '2026-06-30', '2026-06-15', '2026-06-16'), true);
});

test('datesOverlap inclut les bornes (jour de contact)', () => {
    assert.equal(datesOverlap('2026-06-10', '2026-06-15', '2026-06-15', '2026-06-20'), true);
});

test('datesOverlap refuse deux plages disjointes', () => {
    assert.equal(datesOverlap('2026-06-10', '2026-06-15', '2026-06-16', '2026-06-20'), false);
    assert.equal(datesOverlap('2026-06-16', '2026-06-20', '2026-06-10', '2026-06-15'), false);
});

test('datesOverlap fonctionne sur un seul jour', () => {
    assert.equal(datesOverlap('2026-06-10', '2026-06-10', '2026-06-10', '2026-06-10'), true);
    assert.equal(datesOverlap('2026-06-10', '2026-06-10', '2026-06-11', '2026-06-11'), false);
});

// ── congeCoversDate ──────────────────────────────────────────────────────────

test('congeCoversDate couvre une date dans la plage et ses bornes', () => {
    const c = { start_date: '2026-06-10', end_date: '2026-06-15' };
    assert.equal(congeCoversDate(c, '2026-06-12'), true);
    assert.equal(congeCoversDate(c, '2026-06-10'), true);
    assert.equal(congeCoversDate(c, '2026-06-15'), true);
});

test('congeCoversDate exclut une date hors de la plage', () => {
    const c = { start_date: '2026-06-10', end_date: '2026-06-15' };
    assert.equal(congeCoversDate(c, '2026-06-09'), false);
    assert.equal(congeCoversDate(c, '2026-06-16'), false);
});

test('congeCoversDate gère un congé invalide ou vide', () => {
    assert.equal(congeCoversDate(null, '2026-06-12'), false);
    assert.equal(congeCoversDate({}, '2026-06-12'), false);
    assert.equal(congeCoversDate({ start_date: '2026-06-10' }, '2026-06-12'), false);
});
