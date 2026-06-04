// Heures effectives d'un shift — logique partagée navigateur (planning.html) /
// Node (tests). Chargé dans le navigateur via <script src="/lib/shift-hours.js">
// (expose `window.ShiftHours`), et `require()`-able côté Node pour les tests.
//
// Règle métier : on prend les heures RÉELLES (issues du pointage) UNIQUEMENT si le
// pointage est complet — début ET fin saisis — sinon on retombe sur les heures
// PLANIFIÉES. Tester real_start / real_end séparément mélangerait une heure réelle
// avec une heure planifiée → durée fausse (bug historique corrigé ici une fois pour
// toutes et couvert par tests/shift-hours.test.js).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();          // Node / CommonJS (tests, serveur)
    } else {
        root.ShiftHours = factory();         // Navigateur → window.ShiftHours
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Retourne { start, end, isReal } : les heures à utiliser pour l'affichage et
    // les calculs de durée, et un booléen indiquant si ce sont les heures réelles.
    function shiftEffectiveHours(s) {
        const hasReal = s.real_start != null && s.real_end != null;
        return {
            start:  hasReal ? s.real_start : s.start_time,
            end:    hasReal ? s.real_end   : s.end_time,
            isReal: hasReal,
        };
    }

    // Durée effective du shift en heures (réel si complet, sinon planifié).
    function shiftDurationHours(s) {
        const { start, end } = shiftEffectiveHours(s);
        if (start == null || end == null) return 0;
        return end - start;
    }

    return { shiftEffectiveHours, shiftDurationHours };
});
