// Utilitaires purs — pas de dépendance sur Express, Mongo ou le réseau.
// Faciles à tester de manière isolée.

const crypto = require('crypto');

function isValidObjectId(id) {
    return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Normalise un numéro au format international (+33…). Accepte 06/07 FR,
// espaces, tirets, points. Garantit un seul '+' en tête.
function normalizePhone(raw) {
    let p = String(raw).replace(/[\s\-\.]/g, '');
    if (/^0[67]/.test(p)) p = '+33' + p.slice(1);
    if (!/^\+/.test(p)) p = '+' + p;
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

module.exports = {
    isValidObjectId,
    hashToken,
    normalizePhone,
    computeActiveDate,
    toDateStr,
};
