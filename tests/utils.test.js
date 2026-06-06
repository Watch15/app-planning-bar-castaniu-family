const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    isValidObjectId,
    hashToken,
    normalizePhone,
    computeActiveDate,
    toDateStr,
    weekStart,
    disposWeekStart,
    isAutoPublished,
    isDatePublished,
    chargeMultiplier,
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

test('normalizePhone supprime les espaces insécables (NBSP U+00A0)', () => {
    const nbsp = String.fromCharCode(160);
    assert.equal(normalizePhone('+33' + nbsp + '6' + nbsp + '12' + nbsp + '34' + nbsp + '56' + nbsp + '78'), '+33612345678');
});

test('normalizePhone supprime les Zero Width Spaces (U+200B)', () => {
    const zws = String.fromCharCode(0x200B);
    assert.equal(normalizePhone('06' + zws + '12345678'), '+33612345678');
});

test('normalizePhone supprime les tirets insécables (U+2011)', () => {
    const nbHyphen = String.fromCharCode(0x2011);
    assert.equal(normalizePhone('06' + nbHyphen + '12' + nbHyphen + '34' + nbHyphen + '56' + nbHyphen + '78'), '+33612345678');
});

test('normalizePhone gère un mix WhatsApp (NBSP + espaces + tirets)', () => {
    const nbsp = String.fromCharCode(160);
    assert.equal(normalizePhone('+33' + nbsp + '6 12-34.56' + nbsp + '78'), '+33612345678');
});

test('normalizePhone gère "+33 6 12 34 56 78" (format iOS contacts)', () => {
    assert.equal(normalizePhone('+33 6 12 34 56 78'), '+33612345678');
});

test('normalizePhone gère "0033..." (préfixe international double-zéro)', () => {
    assert.equal(normalizePhone('0033612345678'), '+33612345678');
});

test('normalizePhone gère "+33(0)6..." (format copié depuis certains annuaires)', () => {
    assert.equal(normalizePhone('+33(0)612345678'), '+33612345678');
});

test('normalizePhone retourne null pour un numéro invalide', () => {
    assert.equal(normalizePhone('12345'), null);
    assert.equal(normalizePhone('abcdef'), null);
    assert.equal(normalizePhone(''), null);
});

test('normalizePhone retourne null pour null/undefined', () => {
    assert.equal(normalizePhone(null), null);
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

// ── weekStart ────────────────────────────────────────────────────────────────

test('weekStart : un lundi retourne lui-même (à minuit local)', () => {
    // 11 mai 2026 = lundi
    const monday = weekStart(new Date(2026, 4, 11, 15, 30));
    assert.equal(toDateStr(monday), '2026-05-11');
    assert.equal(monday.getHours(), 0);
});

test('weekStart : un dimanche recule au lundi précédent (cas piège)', () => {
    // 17 mai 2026 = dimanche → lundi de la semaine = 11 mai
    const monday = weekStart(new Date(2026, 4, 17, 23, 59));
    assert.equal(toDateStr(monday), '2026-05-11');
});

test('weekStart : un mercredi recule de 2 jours', () => {
    // 13 mai 2026 = mercredi → lundi = 11 mai
    const monday = weekStart(new Date(2026, 4, 13, 10, 0));
    assert.equal(toDateStr(monday), '2026-05-11');
});

test('weekStart : bascule entre mois fonctionne', () => {
    // 2 juin 2026 = mardi → lundi = 1er juin
    assert.equal(toDateStr(weekStart(new Date(2026, 5, 2))), '2026-06-01');
    // 1er janvier 2026 = jeudi → lundi = 29 décembre 2025
    assert.equal(toDateStr(weekStart(new Date(2026, 0, 1))), '2025-12-29');
});

// ── disposWeekStart ──────────────────────────────────────────────────────────

test('disposWeekStart : un mercredi → lundi de la semaine suivante', () => {
    // 13 mai 2026 mercredi → +7j = 20 mai mercredi → lundi semaine = 18 mai
    const target = disposWeekStart(new Date(2026, 4, 13, 10, 0));
    assert.equal(toDateStr(target), '2026-05-18');
});

test('disposWeekStart : un lundi → lundi de la semaine N+1 (pas N)', () => {
    // 11 mai 2026 lundi → +7j = 18 mai lundi → lundi semaine = 18 mai (N+1)
    const target = disposWeekStart(new Date(2026, 4, 11, 9, 0));
    assert.equal(toDateStr(target), '2026-05-18');
});

test('disposWeekStart : un dimanche → lundi de la semaine N+1', () => {
    // 17 mai 2026 dimanche → +7j = 24 mai dimanche → lundi semaine = 18 mai
    const target = disposWeekStart(new Date(2026, 4, 17, 23, 0));
    assert.equal(toDateStr(target), '2026-05-18');
});

// ── isAutoPublished ──────────────────────────────────────────────────────────

test('isAutoPublished : semaine en cours = true', () => {
    const now = new Date(2026, 4, 13);  // mercredi 13 mai
    assert.equal(isAutoPublished('2026-05-15', now), true); // vendredi même semaine
    assert.equal(isAutoPublished('2026-05-11', now), true); // lundi même semaine
});

test('isAutoPublished : semaine passée = true', () => {
    const now = new Date(2026, 4, 13);
    assert.equal(isAutoPublished('2026-05-04', now), true);  // semaine précédente
    assert.equal(isAutoPublished('2025-12-31', now), true);  // bien plus ancien
});

test('isAutoPublished : semaine future = false', () => {
    const now = new Date(2026, 4, 13);
    assert.equal(isAutoPublished('2026-05-18', now), false); // lundi semaine suivante
    assert.equal(isAutoPublished('2026-06-01', now), false); // mois suivant
});

// ── isDatePublished ──────────────────────────────────────────────────────────

test('isDatePublished : semaine en cours/passée = true même avec set vide', () => {
    const now = new Date(2026, 4, 13);            // mercredi 13 mai
    assert.equal(isDatePublished('2026-05-15', new Set(), now), true); // cette semaine
    assert.equal(isDatePublished('2026-05-04', new Set(), now), true); // semaine passée
});

test('isDatePublished : semaine future NON publiée = false', () => {
    const now = new Date(2026, 4, 13);
    assert.equal(isDatePublished('2026-05-25', new Set(), now), false);
});

test('isDatePublished : semaine future publiée (lundi dans le set) = true', () => {
    const now = new Date(2026, 4, 13);
    const pub = new Set(['2026-05-25']);          // lundi 25 mai publié
    assert.equal(isDatePublished('2026-05-25', pub, now), true); // le lundi lui-même
    assert.equal(isDatePublished('2026-05-27', pub, now), true); // mercredi de la même semaine
});

test('isDatePublished : NE matche PAS une semaine adjacente publiée (fix heuristique 8j)', () => {
    const now = new Date(2026, 4, 13);
    // Semaine du 18 mai publiée, mais le shift est dans la semaine du 25 (non publiée).
    // L'ancienne heuristique |25 mai - 18 mai| = 7j < 8j renvoyait true à tort.
    const pub = new Set(['2026-05-18']);
    assert.equal(isDatePublished('2026-05-25', pub, now), false);
});

test('isDatePublished : set absent/invalide + semaine future = false (pas de crash)', () => {
    const now = new Date(2026, 4, 13);
    assert.equal(isDatePublished('2026-05-25', null, now), false);
    assert.equal(isDatePublished('2026-05-25', undefined, now), false);
});

// ── chargeMultiplier ─────────────────────────────────────────────────────────

test('chargeMultiplier : taux 45 % → 1.45', () => {
    assert.equal(chargeMultiplier(45), 1.45);
});

test('chargeMultiplier : taux 0 % → 1 (pas de markup)', () => {
    assert.equal(chargeMultiplier(0), 1);
});

test('chargeMultiplier : null/undefined → défaut 45 %', () => {
    assert.equal(chargeMultiplier(null), 1.45);
    assert.equal(chargeMultiplier(undefined), 1.45);
});

test('chargeMultiplier : taux 100 % → 2', () => {
    assert.equal(chargeMultiplier(100), 2);
});
