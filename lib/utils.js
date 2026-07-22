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

// Normalise un doc settings `publish_<lundi>` en l'ensemble des établissements
// publiés pour cette semaine :
//   'ALL'        → tous les établissements (format legacy `{ published:true }` sans
//                  champ `establishments`, ou `establishments:'ALL'`)
//   Set<estabId> → uniquement ces établissements
//   null         → rien publié manuellement pour cette semaine
function normalizePublishDoc(doc) {
    if (!doc) return null;
    if (doc.establishments === 'ALL') return 'ALL';
    if (Array.isArray(doc.establishments)) return new Set(doc.establishments);
    if (doc.published === true) return 'ALL'; // legacy : publication globale
    return null;
}

// La date `dateStr` est-elle publiée POUR l'établissement `establishmentId` ?
// Vrai si auto-publiée (semaine en cours/passée → tous les établissements) OU si
// l'entrée du lundi de sa semaine vaut 'ALL' ou contient `establishmentId`.
// `publishedWeeks` : Map<lundi 'YYYY-MM-DD', 'ALL' | Set<estabId>> (cf. fetchPublishedWeeks).
// Helper pur partagé par tous les call sites serveur (source unique, R-02).
// Remplace l'ancienne heuristique `|shiftDate - weekMonday| < 8 jours` qui matchait
// à tort une semaine adjacente (un lundi est à 7 j du lundi précédent).
function isDatePublished(dateStr, publishedWeeks, establishmentId, referenceNow) {
    if (isAutoPublished(dateStr, referenceNow)) return true;
    if (!publishedWeeks || typeof publishedWeeks.get !== 'function') return false;
    const wk = toDateStr(weekStart(new Date(dateStr + 'T12:00:00')));
    const entry = publishedWeeks.get(wk);
    if (!entry) return false;
    if (entry === 'ALL') return true;
    return establishmentId != null && entry.has(establishmentId);
}

// Deux plages de dates "YYYY-MM-DD" se chevauchent-elles ? (bornes incluses)
// Comparaison lexicographique : valide car le format ISO est trié comme les dates.
// Utilisé pour empêcher deux congés du même staff de se recouvrir.
function datesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
}

// Le congé `conge` couvre-t-il la date `dateStr` ("YYYY-MM-DD") ? (bornes incluses)
function congeCoversDate(conge, dateStr) {
    if (!conge || !conge.start_date || !conge.end_date) return false;
    return conge.start_date <= dateStr && dateStr <= conge.end_date;
}

// Nombre de jours calendaires du congé `conge` qui tombent dans la fenêtre
// [fromStr, toStr] (bornes incluses, dates "YYYY-MM-DD"). 0 si pas de recouvrement.
// Sert au récap mensuel : compter les jours de congé d'un staff sur le mois.
function congeDaysInRange(conge, fromStr, toStr) {
    if (!conge || !conge.start_date || !conge.end_date) return 0;
    const start = conge.start_date > fromStr ? conge.start_date : fromStr;
    const end   = conge.end_date   < toStr   ? conge.end_date   : toStr;
    if (start > end) return 0;
    const sd = new Date(start + 'T12:00:00');
    const ed = new Date(end + 'T12:00:00');
    return Math.round((ed - sd) / 86400000) + 1;
}

// Sépare une liste de dispos `[{ date, ... }]` selon les congés `[{ start_date,
// end_date }]` (déjà filtrés « non refusés » par l'appelant). Un jour couvert par
// un congé est IGNORÉ (rangé dans skippedDates) plutôt que de faire échouer tout le
// lot. Retourne { kept, skippedDates } — skippedDates = dates uniques triées.
// Source de vérité serveur pour POST /api/dispos (cf. garde congé).
function splitDisposByConges(dispos, conges) {
    const list = Array.isArray(dispos) ? dispos : [];
    const cgs  = Array.isArray(conges) ? conges : [];
    if (!cgs.length) return { kept: list.slice(), skippedDates: [] };
    const onConge = d => cgs.some(c => congeCoversDate(c, d.date));
    const kept = list.filter(d => !onConge(d));
    const skippedDates = [...new Set(list.filter(onConge).map(d => d.date))].sort();
    return { kept, skippedDates };
}

// Le staff est-il en congé sur TOUTE la fenêtre [fromStr, toStr] — chaque jour
// calendaire couvert par au moins un congé (déjà filtré « non refusé » par
// l'appelant) ? Sert à ne pas compter quelqu'un en vacances toute la semaine
// parmi ceux qui doivent envoyer leurs dispos (il est réputé « couvert »).
function isFullRangeOnConge(conges, fromStr, toStr) {
    if (!fromStr || !toStr || fromStr > toStr) return false;
    const cgs = Array.isArray(conges) ? conges : [];
    if (!cgs.length) return false;
    const cur = new Date(fromStr + 'T12:00:00');
    const end = new Date(toStr + 'T12:00:00');
    if (isNaN(cur.getTime()) || isNaN(end.getTime())) return false;
    while (cur <= end) {
        const ds = toDateStr(cur);
        if (!cgs.some(c => congeCoversDate(c, ds))) return false;
        cur.setDate(cur.getDate() + 1);
    }
    return true;
}

// Convertit le taux de charges patronales (%) en multiplicateur sur la masse brute.
// ex. chargeRate=45 → 1.45. Bornes raisonnables : 0–200 %, défaut 45.
function chargeMultiplier(chargeRate) {
    const rate = chargeRate == null ? 45 : chargeRate;
    return 1 + (rate / 100);
}

// ── Absences des directeurs (E-19) — logique pure, testable hors Express/Mongo ──
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Valide une PÉRIODE d'absence (start_date → end_date) déclarée par un directeur.
// end vide → période d'un seul jour. Refuse format invalide, fin avant début,
// période entièrement passée. Retourne { start, end, error }.
function validateOffPeriod(start, endDate, today) {
    const end = endDate || start; // fin vide → période d'un seul jour
    if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end))
        return { start: null, end: null, error: 'Dates invalides (format YYYY-MM-DD)' };
    if (end < start)
        return { start: null, end: null, error: 'La date de fin doit être après la date de début.' };
    if (end < today)
        return { start: null, end: null, error: 'La période doit être à venir.' };
    return { start, end, error: null };
}

// Filtre + enrichit les absences directeur pour un demandeur donné (scope par
// établissement). `metaById` : Map<user_id, { name, estabs }>. `canAccess(viewer,
// estabId)` : prédicat d'accès. Patron/observateur voient tout ; un directeur ne
// voit que les absences des directeurs partageant au moins un de ses établissements.
// Une absence dont le compte n'existe plus (méta absente) est ignorée.
function scopeManagerOff(offs, metaById, viewer, canAccess) {
    const out = [];
    for (const o of offs) {
        const meta = metaById.get(String(o.user_id));
        if (!meta) continue;
        const canSee = viewer.role === 'patron' || viewer.role === 'observateur'
            || meta.estabs.some(e => canAccess(viewer, e));
        if (canSee) out.push({
            _id: o._id, user_id: o.user_id,
            start_date: o.start_date, end_date: o.end_date, type: o.type || 'off',
            note: o.note || '', name: meta.name || o.name || 'Directeur',
            assigned_establishments: meta.estabs,
        });
    }
    return out;
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
    normalizePublishDoc,
    chargeMultiplier,
    datesOverlap,
    congeCoversDate,
    congeDaysInRange,
    splitDisposByConges,
    isFullRangeOnConge,
    validateOffPeriod,
    scopeManagerOff,
};
