// Lundi de la semaine — logique partagée navigateur (front) / Node (serveur + tests).
// Source UNIQUE de `weekStart` : `lib/utils.js` la ré-exporte (serveur), et les pages
// front (`planning.html`, `performance.html`, `script.js`) y délèguent leur `getMondayOf`.
// Chargé dans le navigateur via <script src="/lib/week.js"> (expose `window.Week`),
// et `require()`-able côté Node.
//
// Convention : semaine du lundi au dimanche. Dimanche → recule de 6 jours.
// Retourne une **Date locale à minuit** (00:00:00.000) et n'altère JAMAIS l'argument.
// La normalisation à minuit évite toute dérive d'heure (ex. DST) lors des `±N jours`.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();          // Node / CommonJS (serveur, tests)
    } else {
        root.Week = factory();               // Navigateur → window.Week
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function weekStart(date) {
        const d   = new Date(date);          // copie défensive : n'altère pas l'argument
        const day = d.getDay();              // 0 = dimanche … 6 = samedi
        d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // Heure de bascule de la semaine « opérationnelle ». La plupart des fermetures
    // se terminent vers 2h : avant cette heure le lundi, on est encore sur la soirée
    // (donc la semaine) précédente. Constante unique → ajustable simplement plus tard
    // (ou branchable sur un réglage en passant `cutoffHour`).
    const WEEK_CUTOFF_HOUR = 6;

    // Lundi de la semaine « en cours » à l'instant `now`, en tenant compte du cutoff :
    // avant `cutoffHour` (défaut 6h), on rattache l'instant à la veille avant de
    // calculer le lundi. Ne change la semaine QUE dans la fenêtre lundi 00:00–cutoff.
    // À n'utiliser que pour « quelle semaine est-on MAINTENANT » — pas pour mapper une
    // date calendaire à sa semaine (utiliser `weekStart` pour ça).
    function currentWeekStart(now, cutoffHour) {
        const cutoff = (cutoffHour == null) ? WEEK_CUTOFF_HOUR : cutoffHour;
        const d = (now == null) ? new Date() : new Date(now);
        if (d.getHours() < cutoff) d.setDate(d.getDate() - 1);
        return weekStart(d);
    }

    return { weekStart, currentWeekStart, WEEK_CUTOFF_HOUR };
});
