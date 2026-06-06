// Utilitaires purs — pas de dépendance sur Express, Mongo ou le réseau.
// Faciles à tester de manière isolée.

const crypto = require('crypto');

function isValidObjectId(id) {
    return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizePhone(raw) {
    if (raw == null) return null;

    // 1. Supprimer les caract\u00E8res invisibles Unicode
    let p = String(raw)
        .replace(/[\u00A0\u200B\u200C\u200D\u2011\uFEFF]/g, '')
        .trim();

    // 2. "+33(0)6..." \u2192 "+336..."  avant de supprimer les parenth\u00E8ses
    p = p.replace(/\+(\d{1,3})\(0\)/g, '+$1');

    // 3. Supprimer espaces, tirets, points, parenth\u00E8ses
    p = p.replace(/[\s\-.()]/g, '');

    // 4. "0033..." \u2192 "+33..."  (pr\u00E9fixe international double-z\u00E9ro)
    if (/^00/.test(p)) p = '+' + p.slice(2);

    // 5. "06..." / "07..." \u2192 "+336..." / "+337..."
    if (/^0[67]/.test(p)) p = '+33' + p.slice(1);

    // 6. Pas de "+" \u2192 ajouter
    if (!/^\+/.test(p)) p = '+' + p;

    // 7. Valider E.164
    if (!/^\+[1-9]\d{7,14}$/.test(p)) {
        console.error('[normalizePhone] format invalide :', String(raw).slice(0, 40), '\u2192', p);
        return null;
    }

    return p;
}

// Date active = la "session" en cours (règle cutoff_hour).
// Avant cutoff_hour du matin, on considère qu'on est encore sur la session
// de la veille (gestion des shifts de nuit qui se terminent après minuit).
//   ex. cutoffHour = 9 : à 2h du matin le 12 avril → date active = 11 avril
// Retourne une Date locale (minuit de la date active).
function computeActiveDate(now, cutoffHour) {
    const d = new Date(now);
    if (d.getHours() < cutoffHour) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
}

// Formate une Date en "YYYY-MM-DD" en utilisant l'heure locale.
// NE JAMAIS utiliser toISOString() — il convertit en UTC et peut décaler d'un jour.
function toDateStr(date) {
    const pad = n => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

// Lundi (à minuit local) de la semaine contenant `date`.
// Source unique partagée avec le front : voir public/lib/week.js + tests/week.test.js (R-01).
// Ré-exporté tel quel pour ne pas changer les call sites serveur (disposWeekStart,
// isAutoPublished, routes) ni les imports existants.
const { weekStart, currentWeekStart, WEEK_CUTOFF_HOUR } = require('../public/lib/week.js');

// Le lundi de la semaine ciblée pour la saisie des disponibilités.
// Toujours la semaine suivante (now + 7 jours, recalé au lundi).
// Si appelé un lundi → retourne le lundi de N+1 (pas N).
function disposWeekStart(now) {
    const d7 = new Date(now);
    d7.setDate(d7.getDate() + 7);
    return weekStart(d7);
}

// La semaine en cours et toutes les semaines passées sont auto-publiées.
// Une semaine future requiert un flag `settings: publish_<weekStart>` en base.
// `referenceNow` est injectable pour faciliter les tests.
function isAutoPublished(shiftDateStr, referenceNow) {
    const ref       = referenceNow || new Date();
    const shiftWeek = weekStart(new Date(shiftDateStr + 'T12:00:00'));
    const refWeek   = weekStart(ref);
    return shiftWeek <= refWeek;
}

// La date `dateStr` appartient-elle à une semaine PUBLIÉE ?
// Vrai si auto-publiée (semaine en cours/passée) OU si le lundi de sa semaine
// figure dans `publishedWeeks` (Set de 'YYYY-MM-DD' = lundis publiés par le patron).
// Helper pur partagé par tous les call sites serveur (source unique, R-02).
// Remplace l'ancienne heuristique `|shiftDate - weekMonday| < 8 jours` qui matchait
// à tort une semaine adjacente (un lundi est à 7 j du lundi précédent).
function isDatePublished(dateStr, publishedWeeks, referenceNow) {
    if (isAutoPublished(dateStr, referenceNow)) return true;
    if (!publishedWeeks || typeof publishedWeeks.has !== 'function') return false;
    const wk = toDateStr(weekStart(new Date(dateStr + 'T12:00:00')));
    return publishedWeeks.has(wk);
}

// Convertit le taux de charges patronales (%) en multiplicateur sur la masse brute.
// ex. chargeRate=45 → 1.45. Bornes raisonnables : 0–200 %, défaut 45.
function chargeMultiplier(chargeRate) {
    const rate = chargeRate == null ? 45 : chargeRate;
    return 1 + (rate / 100);
}

module.exports = {
    isValidObjectId,
    hashToken,
    normalizePhone,
    computeActiveDate,
    toDateStr,
    weekStart,
    currentWeekStart,
    WEEK_CUTOFF_HOUR,
    disposWeekStart,
    isAutoPublished,
    isDatePublished,
    chargeMultiplier,
};
