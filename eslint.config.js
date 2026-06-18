// Config ESLint (flat) — CD-04.
// Volontairement conservatrice : on n'érige en ERREUR que les « vrais bugs »
// (variables non déclarées, doublons de clés, code mort, await mal placé…).
// Le bruit de style sur un legacy de ~17 000 lignes est laissé en `warn`
// (n'échoue pas la CI) pour resserrer progressivement, sans big-bang.
const js = require('@eslint/js');
const globals = require('globals');

const sharedRules = {
    ...js.configs.recommended.rules,
    'no-empty': ['warn', { allowEmptyCatch: true }], // `catch {}` silencieux assumé
    'no-constant-condition': ['error', { checkLoops: false }],
    // Cosmétique / intentionnel sur ce legacy → warn (n'échoue pas la CI),
    // à resserrer plus tard. Pas des bugs.
    'no-useless-escape': 'warn',           // échappements redondants dans des regex qui marchent
    'no-useless-assignment': 'warn',       // initialiseurs `let x = 0` réécrits dans toutes les branches
    'no-misleading-character-class': 'warn', // strip volontaire de caractères invisibles (lib/utils.js)
};

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'public/vendor/**',   // libs tierces minifiées
            'graphify-out/**',    // graphe généré
        ],
    },

    // ── Code Node (CommonJS) : server, helpers, scripts, tests ────────────────
    {
        files: ['server.js', 'lib/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            ...sharedRules,
            'no-unused-vars': 'warn',
        },
    },

    // ── Code navigateur (servi statique, pas de modules) ──────────────────────
    // Globals partagés entre fichiers via le scope global de la page.
    {
        files: ['public/**/*.js'],
        ignores: ['public/sw.js', 'public/vendor/**'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                Week: 'readonly',          // public/lib/week.js (UMD)
                ShiftHours: 'readonly',    // public/lib/shift-hours.js (UMD)
                XLSX: 'readonly',          // vendor/xlsx
                jspdf: 'readonly',         // vendor/jspdf
                jsPDF: 'readonly',
                html2canvas: 'readonly',   // vendor/html2canvas
                module: 'writable',        // les modules UMD testent `typeof module`
            },
        },
        rules: {
            ...sharedRules,
            // Beaucoup de fonctions sont appelées depuis des handlers onclick="" du
            // HTML → invisibles pour ESLint. On désactive donc no-unused-vars ici
            // pour éviter une avalanche de faux positifs.
            'no-unused-vars': 'off',
        },
    },

    // Globals inter-fichiers, scopés au seul CONSOMMATEUR (pas au définisseur,
    // sinon no-redeclare se déclenche sur la définition).
    {
        // index.html charge script.js + index-init.js → ces fcts viennent de script.js
        files: ['public/index-init.js'],
        languageOptions: { globals: { showToast: 'readonly', loadDisposBadge: 'readonly' } },
    },
    {
        // F-05 (échanges de shifts) DÉSACTIVÉ : ces fcts sont définies dans le bloc
        // commenté de planning.js, réactivées à son décommentage. Les call sites
        // (branches mortes canSwap/isSwapMine) restent inertes au runtime.
        files: ['public/planning.js'],
        languageOptions: { globals: { openSwapModal: 'readonly', cancelMySwap: 'readonly' } },
    },

    // ── Service Worker ────────────────────────────────────────────────────────
    {
        files: ['public/sw.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: { ...globals.serviceworker },
        },
        rules: sharedRules,
    },
];
