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

    // ── Formatage des heures ──────────────────────────────────────────────────
    // Ces helpers étaient dupliqués (~8 copies) dans script.js / planning.js /
    // pointage.js. Trois familles distinctes, à ne PAS confondre :
    //   - fmtHourOfDay / fmtClock : une HEURE D'HORLOGE (0-24h), bornée à 24h.
    //   - fmtDurationH            : une DURÉE / un CUMUL (peut dépasser 24h,
    //                               peut être négatif), JAMAIS bornée à 24h.

    // Heure d'horloge → "14h" / "14h30". Bornée à 24h (un créneau à 25h donne
    // "01h"). Minutes omises quand pile à l'heure. Badges planning, ticks timeline.
    function fmtHourOfDay(h) {
        if (h == null) return '';
        const norm = h % 24;
        const hh = Math.floor(norm);
        const mm = Math.round((norm - hh) * 60);
        return String(hh).padStart(2, '0') + 'h' + (mm > 0 ? String(mm).padStart(2, '0') : '');
    }

    // Heure d'horloge format ":" → "14:00", null → "--:--". Champs <input type=time>
    // et libellés planifiés du pointage. Affiche toujours les minutes.
    function fmtClock(h) {
        if (h == null) return '--:--';
        const hh = Math.floor(h % 24);
        const mm = Math.round((h % 1) * 60);
        return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }

    // Durée / cumul d'heures → "7h", "37h30", écart "-1h30". NE borne PAS à 24h.
    // opts : { nullText (défaut ''), minus (signe négatif, défaut '-'),
    //          padMinutes (toujours afficher MM, ex. export CSV) }.
    function fmtDurationH(h, opts) {
        opts = opts || {};
        if (h == null) return opts.nullText != null ? opts.nullText : '';
        const sign = h < 0 ? (opts.minus || '-') : '';
        const totalMins = Math.round(Math.abs(h) * 60);
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const body = opts.padMinutes
            ? hrs + 'h' + String(mins).padStart(2, '0')
            : hrs + 'h' + (mins > 0 ? String(mins).padStart(2, '0') : '');
        return sign + body;
    }

    return { shiftEffectiveHours, shiftDurationHours, fmtHourOfDay, fmtClock, fmtDurationH };
});
