// ── Constantes ───────────────────────────────────────────────────────────────

let START_HOUR  = 10;  // borne visuelle (heure entière, début du rail)
let END_HOUR    = 26;  // borne visuelle (heure entière, fin du rail)
let TOTAL_HOURS = END_HOUR - START_HOUR;
let OPEN_TIME   = 10;  // ouverture réelle (décimal, ex. 9.5 = 09:30) — clamp placement
let CLOSE_TIME  = 26;  // fermeture réelle (décimal, ex. 26 = 02:00) — clamp placement

// PX_PER_HOUR : 60px/h sur tous les écrans — SNAP = 15px (entier, élimine les pixels fractionnaires sur mobile)
function getPxPerHour() {
    return 60;
}
// Alias constant pour la compatibilité — recalculé à chaque action drag/resize
let PX_PER_HOUR = 60;
function refreshPxPerHour() { PX_PER_HOUR = getPxPerHour(); }

// ── Heures dynamiques selon l'établissement ───────────────────────────────────

function applyVenueHours(venueId) {
    const venue = allEstablishments.find(e => e.id === venueId || String(e._id) === venueId);
    if (!venue || !venue.open_time || !venue.close_time) {
        START_HOUR = 10; END_HOUR = 26;
        OPEN_TIME  = 10; CLOSE_TIME = 26;
    } else {
        const parseHM = s => { const [h, m] = s.split(':').map(Number); return h + m / 60; };
        let open  = parseHM(venue.open_time);
        let close = parseHM(venue.close_time);
        if (close <= open) close += 24; // fermeture après minuit
        START_HOUR = Math.floor(open);   // borne visuelle arrondie à l'heure basse
        END_HOUR   = Math.ceil(close);   // borne visuelle arrondie à l'heure haute
        OPEN_TIME  = open;               // heure exacte d'ouverture (clamp placement)
        CLOSE_TIME = close;              // heure exacte de fermeture (clamp placement)
    }
    TOTAL_HOURS = END_HOUR - START_HOUR;
}

const DAY_NAMES_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAY_NAMES_LONG  = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTH_NAMES     = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

// ── État global ──────────────────────────────────────────────────────────────

let currentUser    = null;  // utilisateur connecté
let allStaff       = [];
let staffDisplayNames = new Map(); // _id → prénom court (avec initiale si doublon)

function buildStaffDisplayNames() {
    staffDisplayNames = new Map();

    // Les membres avec un surnom l'utilisent directement
    const withoutNickname = [];
    for (const s of allStaff) {
        if (s.nickname) {
            staffDisplayNames.set(s._id, s.nickname);
        } else {
            withoutNickname.push(s);
        }
    }

    // Grouper par prénom pour les membres sans surnom
    const byFirstName = new Map();
    for (const s of withoutNickname) {
        const parts = s.name.trim().split(/\s+/);
        const fn = parts[0];
        if (!byFirstName.has(fn)) byFirstName.set(fn, []);
        byFirstName.get(fn).push({ id: s._id, lastName: parts.slice(1).join(' ') });
    }

    for (const [fn, group] of byFirstName) {
        if (group.length === 1 || group.every(g => !g.lastName)) {
            // Prénom unique ou pas de nom → prénom seul
            for (const g of group) staffDisplayNames.set(g.id, fn);
        } else {
            // Trouver le préfixe minimal du nom qui distingue chaque personne
            const lastNames = group.map(g => g.lastName.toUpperCase());
            let len = 1;
            while (len <= Math.max(...lastNames.map(n => n.length))) {
                const prefixes = lastNames.map(n => n.slice(0, len));
                if (new Set(prefixes).size === group.length) break;
                len++;
            }
            for (let i = 0; i < group.length; i++) {
                const prefix = group[i].lastName.slice(0, len);
                staffDisplayNames.set(group[i].id,
                    prefix ? fn + ' ' + prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase() + '.' : fn
                );
            }
        }
    }
}

function displayName(staffId, fallbackName) {
    if (staffDisplayNames.has(staffId)) return staffDisplayNames.get(staffId);
    const n = (fallbackName || '').trim();
    return n.split(/\s+/)[0] || n;
}

function normalizeStr(str) {
    if (!str) return '';
    return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Joker — slot non attribué ─────────────────────────────────────────────────
const JOKER_STAFF = {
    _id:   '__joker__',
    name:  'Joker',
    color: '#95a5a6',
    isJoker: true,
};
let currentVenueId    = null;
let currentGroup      = null; // groupe actif ('Bar', 'Cuisine', null = Tous)
let allGroups         = []; // groupes disponibles
let confirmedDispos   = []; // dispos confirmées du jour affiché
let dayLeaves         = []; // congés approuvés couvrant le jour affiché
let dayLeaveStaffIds  = new Set(); // staff_id (string) en congé le jour affiché
let allEstablishments = []; // tous les établissements
let allRoles          = []; // rôles créés par le patron
let currentShiftsWeek = []; // shifts de la semaine pour les couleurs
let currentShifts  = [];
let displayedStaff = [];

let currentWeekStart = Week.currentWeekStart(new Date()); // Lundi courant (cutoff 6h)
let selectedDate     = toDateStr(new Date());   // "YYYY-MM-DD" du jour sélectionné
let weekSummary      = {};                       // { "YYYY-MM-DD": nbShifts }
let weekFullData     = {};                       // { "YYYY-MM-DD": [shifts...] }
let currentView      = 'day';                    // 'day' | 'week'
let currentSubView   = 'dashboard';              // 'dashboard' | 'agenda'

let activeEl     = null;
let activeAction = null;
let startX, startLeft, startWidth;
let _shiftWasDragged = false; // bloque le click après un drag/resize mouse

let draggedStaff = null;

// ── État tap-to-place mobile ──────────────────────────────────────────────────
let _tapSelectedStaff = null; // staff sélectionné via tap mobile

function isMobileDevice() {
    return window.innerWidth < 768;
}

// Copie de jour
let copyShiftsBuffer = []; // shifts modifiables avant confirmation

// ── Modales utilitaires (remplacent confirm/prompt natifs — bloqués PWA iOS) ──

function showConfirm(message, onConfirm, onCancel) {
    const mob = window.innerWidth < 768;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:' + (mob ? 'flex-end' : 'center') + ';justify-content:center;padding:' + (mob ? '0' : '20px');
    overlay.innerHTML =
        '<div style="background:white;border-radius:' + (mob ? '20px 20px 0 0' : '14px') + ';padding:' + (mob ? '24px 24px max(20px,env(safe-area-inset-bottom))' : '24px') + ';max-width:' + (mob ? '100%' : '380px') + ';width:100%;box-shadow:0 -4px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:14px;color:#1a1a2e;line-height:1.5;margin-bottom:20px">' + message + '</p>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_mc" style="padding:10px 18px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:14px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_mo" style="padding:10px 18px;border-radius:8px;border:none;background:#e74c3c;color:white;font-size:14px;font-weight:600;cursor:pointer">Confirmer</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);
    overlay.querySelector('#_mo').addEventListener('click', () => { close(); onConfirm(); });
    overlay.querySelector('#_mc').addEventListener('click', () => { close(); if (onCancel) onCancel(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { close(); if (onCancel) onCancel(); } });
}

function showPrompt(message, placeholder, onConfirm) {
    const mob = window.innerWidth < 768;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:' + (mob ? 'flex-end' : 'center') + ';justify-content:center;padding:' + (mob ? '0' : '20px');
    overlay.innerHTML =
        '<div style="background:white;border-radius:' + (mob ? '20px 20px 0 0' : '14px') + ';padding:' + (mob ? '24px 24px max(20px,env(safe-area-inset-bottom))' : '24px') + ';max-width:' + (mob ? '100%' : '380px') + ';width:100%;box-shadow:0 -4px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:14px;color:#1a1a2e;margin-bottom:12px">' + message + '</p>' +
            '<input id="_pi" type="password" placeholder="' + placeholder + '" style="width:100%;padding:11px 14px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:16px;outline:none;margin-bottom:16px;box-sizing:border-box">' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_pc" style="padding:10px 18px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:14px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_po" style="padding:10px 18px;border-radius:8px;border:none;background:#1a1a2e;color:white;font-size:14px;font-weight:600;cursor:pointer">Valider</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#_pi');
    const close = () => document.body.removeChild(overlay);
    input.focus();
    const submit = () => { const v = input.value; close(); if (v) onConfirm(v); };
    overlay.querySelector('#_po').addEventListener('click', submit);
    overlay.querySelector('#_pc').addEventListener('click', close);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
}

function showTextPrompt(message, placeholder, onConfirm) {
    const mob = window.innerWidth < 768;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:' + (mob ? 'flex-end' : 'center') + ';justify-content:center;padding:' + (mob ? '0' : '20px');
    overlay.innerHTML =
        '<div style="background:white;border-radius:' + (mob ? '20px 20px 0 0' : '14px') + ';padding:' + (mob ? '24px 24px max(20px,env(safe-area-inset-bottom))' : '24px') + ';max-width:' + (mob ? '100%' : '380px') + ';width:100%;box-shadow:0 -4px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:14px;color:#1a1a2e;margin-bottom:12px">' + message + '</p>' +
            '<input id="_ti" type="text" placeholder="' + placeholder + '" style="width:100%;padding:11px 14px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:16px;outline:none;margin-bottom:16px;box-sizing:border-box">' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_tc" style="padding:10px 18px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:14px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_to" style="padding:10px 18px;border-radius:8px;border:none;background:#1a1a2e;color:white;font-size:14px;font-weight:600;cursor:pointer">Valider</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#_ti');
    const close = () => document.body.removeChild(overlay);
    input.focus();
    const submit = () => { const v = input.value.trim(); close(); if (v) onConfirm(v); };
    overlay.querySelector('#_to').addEventListener('click', submit);
    overlay.querySelector('#_tc').addEventListener('click', close);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); });
}

function showNotePrompt(title, defaultVal, onConfirm) {
    const mob = window.innerWidth < 768;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:' + (mob ? 'flex-end' : 'center') + ';justify-content:center;padding:' + (mob ? '0' : '20px');
    overlay.innerHTML =
        '<div style="background:white;border-radius:' + (mob ? '20px 20px 0 0' : '14px') + ';padding:' + (mob ? '24px 24px max(20px,env(safe-area-inset-bottom))' : '24px') + ';max-width:' + (mob ? '100%' : '420px') + ';width:100%;box-shadow:0 -4px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:14px;font-weight:600;color:#1a1a2e;margin-bottom:12px">' + title + '</p>' +
            '<textarea id="_np" placeholder="Ex: S\'occuper de la caisse, arriver 30 min avant…" rows="3" style="width:100%;padding:11px 14px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:16px;font-family:inherit;outline:none;resize:none;margin-bottom:16px;box-sizing:border-box;line-height:1.5">' + (defaultVal || '') + '</textarea>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                (defaultVal ? '<button id="_nd" style="padding:10px 14px;border-radius:8px;border:1px solid #fca5a5;background:white;font-size:13px;cursor:pointer;color:#ef4444;margin-right:auto">Effacer</button>' : '') +
                '<button id="_nc" style="padding:10px 18px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:14px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_no" style="padding:10px 18px;border-radius:8px;border:none;background:#1a1a2e;color:white;font-size:14px;font-weight:600;cursor:pointer">Enregistrer</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#_np');
    const close    = () => document.body.removeChild(overlay);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    overlay.querySelector('#_no').addEventListener('click', () => { close(); onConfirm(textarea.value.trim()); });
    overlay.querySelector('#_nc').addEventListener('click', close);
    if (defaultVal) overlay.querySelector('#_nd').addEventListener('click', () => { close(); onConfirm(''); });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// ── Utilitaires date ──────────────────────────────────────────────────────────

// Parseur de date YYYY-MM-DD sans décalage timezone
function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const j = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + j;
}

// Lundi de la semaine — délègue au module partagé/testé (public/lib/week.js, R-01).
// Chargé via <script src="/lib/week.js"> avant script.js dans index.html.
function getMondayOf(d) { return Week.weekStart(d); }

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

function formatDateLong(d) {
    return `${DAY_NAMES_LONG[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateShort(d) {
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}.`;
}

function isToday(dateStr) {
    return dateStr === toDateStr(new Date());
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
    const me = await checkAuth();
    if (!me) return;

    currentUser = me;
    renderUserBadge(me);
    renderDateDisplay();

    initDropZone();
    initTimelineBodyTap();
    setupWeekNav();
    initViewTabs();
    await Promise.all([loadEstablishments(), loadAllStaff(), loadRoles(), loadGroups()]);

    loadDisposBadge();
    loadCongesBadge();
    loadDisposKpi();
    // loadSwapsBadge(); // F-05 désactivé
    loadNotifBadge();
    _notifPollTimer = setInterval(() => { loadNotifBadge(); /* loadSwapsBadge(); */ }, 30000);
    startAutoRefresh();
    initNotifListeners();
    loadDispoControl();
    initStaffSearch();

    const btnDispos = document.getElementById('btn-dispos');
    if (btnDispos) btnDispos.addEventListener('click', openDisposPanel);

    const congesSearch = document.getElementById('conges-search');
    if (congesSearch) congesSearch.addEventListener('input', renderCongesListPatron);
    document.querySelectorAll('.conge-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            _congesFilter = chip.dataset.filter;
            document.querySelectorAll('.conge-filter-chip').forEach(c => {
                const active = c.dataset.filter === _congesFilter;
                c.style.borderColor      = active ? 'var(--accent)' : 'var(--light-border)';
                c.style.background        = active ? 'var(--accent-subtle)' : 'white';
                c.style.color             = active ? 'var(--accent)' : 'var(--text-secondary)';
            });
            renderCongesListPatron();
        });
    });

    // F-05 échanges désactivé
    // const btnSwaps = document.getElementById('btn-swaps');
    // if (btnSwaps) btnSwaps.addEventListener('click', openSwapsPanel);
    // const swapsClose = document.getElementById('swaps-modal-close');
    // if (swapsClose) swapsClose.addEventListener('click', () => {
    //     document.getElementById('swaps-modal').style.display = 'none';
    // });

    // Onglets dans la modale dispos
    const disposTabList     = document.getElementById('dispos-tab-btn-list');
    const disposTabNotes    = document.getElementById('dispos-tab-btn-notes');
    const disposTabReassign = document.getElementById('dispos-tab-btn-reassign');
    const disposTabReminder = document.getElementById('dispos-tab-btn-reminder');
    if (disposTabList)     disposTabList.addEventListener('click', () => switchDisposTab('list'));
    if (disposTabNotes)    disposTabNotes.addEventListener('click', () => switchDisposTab('notes'));
    if (disposTabReassign) disposTabReassign.addEventListener('click', () => switchDisposTab('reassign'));
    if (disposTabReminder) disposTabReminder.addEventListener('click', () => switchDisposTab('reminder'));
    const disposTabModify = document.getElementById('dispos-tab-btn-modify');
    if (disposTabModify) disposTabModify.addEventListener('click', () => switchDisposTab('modify'));
    const disposTabConges = document.getElementById('dispos-tab-btn-conges');
    if (disposTabConges) disposTabConges.addEventListener('click', () => switchDisposTab('conges'));
    const staffNotesPrev = document.getElementById('staff-notes-prev');
    if (staffNotesPrev) staffNotesPrev.addEventListener('click', () => {
        if (!staffNotesWeekStart) return;
        staffNotesWeekStart = addDays(staffNotesWeekStart, -7);
        renderStaffNotesWeekLabel();
        loadStaffNotesList(toDateStr(staffNotesWeekStart));
    });
    const staffNotesNext = document.getElementById('staff-notes-next');
    if (staffNotesNext) staffNotesNext.addEventListener('click', () => {
        if (!staffNotesWeekStart) return;
        staffNotesWeekStart = addDays(staffNotesWeekStart, 7);
        renderStaffNotesWeekLabel();
        loadStaffNotesList(toDateStr(staffNotesWeekStart));
    });
    const staffNotesSearch = document.getElementById('staff-notes-search');
    if (staffNotesSearch) staffNotesSearch.addEventListener('input', renderStaffNotesList);

    // Boutons export semaine
    const btnExportCsv       = document.getElementById('btn-export-csv');
    const btnPrintDashboard  = document.getElementById('btn-print-dashboard');
    const btnPrintGantt      = document.getElementById('btn-print-gantt');
    if (btnExportCsv)      btnExportCsv.addEventListener('click', exportWeekCSV);
    if (btnPrintDashboard) btnPrintDashboard.addEventListener('click', saveDashboardPdf);
    if (btnPrintGantt)     btnPrintGantt.addEventListener('click', generatePrintGantt);
    // Synchroniser visibilité boutons impression avec le sous-onglet actif
    document.querySelectorAll('.week-sub-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const isDash = btn.dataset.sub === 'dashboard';
            const isGantt = btn.dataset.sub === 'gantt';
            if (btnPrintDashboard) btnPrintDashboard.style.display = isDash  ? '' : 'none';
            if (btnPrintGantt)     btnPrintGantt.style.display     = isGantt ? '' : 'none';
        });
    });

    const btnRecap = document.getElementById('btn-recap');
    if (btnRecap) btnRecap.addEventListener('click', openRecapModal);

    const btnRevenue = document.getElementById('btn-revenue');
    if (btnRevenue) btnRevenue.addEventListener('click', openRevenueModal);
    const revenueClose = document.getElementById('revenue-modal-close');
    if (revenueClose) revenueClose.addEventListener('click', () => {
        document.getElementById('revenue-modal').style.display = 'none';
    });
    const revenueSave = document.getElementById('revenue-modal-save');
    if (revenueSave) revenueSave.addEventListener('click', saveRevenueFromModal);
    const revenueDate  = document.getElementById('revenue-modal-date');
    const revenueEstab = document.getElementById('revenue-modal-estab');
    if (revenueDate)  revenueDate.addEventListener('change', prefillRevenueModal);
    if (revenueEstab) revenueEstab.addEventListener('change', prefillRevenueModal);

    const btnRefresh = document.getElementById('btn-refresh-day');
    if (btnRefresh) btnRefresh.addEventListener('click', async () => {
        if (selectedDate) {
            await loadDayDetail(selectedDate);
            showToast('Planning rechargé');
        }
    });

    const disposClose = document.getElementById('dispos-modal-close');
    if (disposClose) disposClose.addEventListener('click', () => {
        document.getElementById('dispos-modal').style.display = 'none';
    });

    const confirmDispoClose = document.getElementById('confirm-dispo-close');
    if (confirmDispoClose) confirmDispoClose.addEventListener('click', () => {
        document.getElementById('confirm-dispo-modal').style.display = 'none';
    });

    const btnSendRappel = document.getElementById('btn-send-rappel');
    if (btnSendRappel) btnSendRappel.addEventListener('click', sendRappelDispos);

    // Dropdown menu utilisateur (avatar)
    const userMenuTrigger  = document.getElementById('user-menu-trigger');
    const userMenuDropdown = document.getElementById('user-menu-dropdown');
    if (userMenuTrigger && userMenuDropdown) {
        userMenuTrigger.addEventListener('click', e => {
            e.stopPropagation();
            userMenuDropdown.classList.toggle('open');
        });
        document.addEventListener('click', () => userMenuDropdown.classList.remove('open'));
    }

    // Synchronise le header des heures avec le scroll horizontal de la timeline
    const timelineScroll = document.getElementById('timeline-scroll');
    if (timelineScroll) timelineScroll.addEventListener('scroll', () => {
        const hdr = document.getElementById('timeline-header');
        if (hdr) hdr.style.transform = `translateX(-${timelineScroll.scrollLeft}px)`;
    }, { passive: true });

    const btnEstab = document.getElementById('btn-manage-establishments');
    if (btnEstab) {
        if (currentUser.role !== 'patron') {
            btnEstab.style.display = 'none';
        }
        // Le listener est déjà attaché via DOMContentLoaded
    }

    const btnAccounts = document.getElementById('btn-manage-accounts');
    if (btnAccounts) btnAccounts.addEventListener('click', openAccountsModal);

    const accountsTabActive  = document.getElementById('accounts-tab-btn-active');
    const accountsTabPending = document.getElementById('accounts-tab-btn-pending');
    if (accountsTabActive)  accountsTabActive.addEventListener('click',  () => switchAccountsTab('active'));
    if (accountsTabPending) accountsTabPending.addEventListener('click', () => switchAccountsTab('pending'));

    const accountsClose = document.getElementById('accounts-modal-close');
    if (accountsClose) accountsClose.addEventListener('click', () => {
        document.getElementById('accounts-modal').style.display = 'none';
    });

    const btnImportCsv = document.getElementById('btn-import-csv');
    if (btnImportCsv) btnImportCsv.addEventListener('click', openCsvImportModal);

    const btnBulkNames = document.getElementById('btn-bulk-staff-names');
    if (btnBulkNames) btnBulkNames.addEventListener('click', openBulkStaffNamesModal);

    const btnBulkRates = document.getElementById('btn-bulk-staff-rates');
    if (btnBulkRates) btnBulkRates.addEventListener('click', openBulkStaffRatesModal);
}

async function checkAuth() {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch('/auth/me', { credentials: 'include' });
            if (res.status === 401) { window.location.href = '/login.html'; return null; }
            if (!res.ok) { if (attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; } break; }
            const data = await res.json();
            // Redirections selon le rôle
            if (data.user?.role === 'staff')        { window.location.href = '/planning.html'; return null; }
            if (data.user?.role === 'etablissement') { window.location.href = '/pointage.html'; return null; }
            // patron et directeur sont autorisés
            if (data.user?.role !== 'patron' && data.user?.role !== 'directeur') {
                window.location.href = '/login.html'; return null;
            }
            return data.user;
        } catch {
            if (attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; }
            return null;
        }
    }
    window.location.href = '/login.html';
    return null;
}

function renderUserBadge(user) {
    const badge  = document.getElementById('user-badge');
    const avatar = document.getElementById('user-avatar');
    const fullName  = user.name || user.email || '';
    const firstName = fullName.split(' ')[0];
    const roleLabel = user.role === 'patron' ? ' · Patron' : ' · Directeur';
    if (badge)  badge.textContent  = firstName + roleLabel;
    if (avatar) avatar.textContent = firstName.charAt(0).toUpperCase();
    // Brand mobile (header-left) — affiche le rôle en sous-texte
    const mobSub = document.getElementById('mobile-brand-sub');
    if (mobSub) mobSub.textContent = user.role === 'patron' ? 'Patron · ' + firstName : 'Directeur · ' + firstName;
}

function renderDateDisplay() {
    const opts = { weekday: 'long', day: 'numeric', month: 'long' };
    document.getElementById('date-display').textContent =
        new Date().toLocaleDateString('fr-FR', opts);
}

// ── Navigation semaine ────────────────────────────────────────────────────────

function setupWeekNav() {
    document.getElementById('prev-week').addEventListener('click', () => {
        currentWeekStart = addDays(currentWeekStart, -7);
        refreshWeek();
    });
    document.getElementById('next-week').addEventListener('click', () => {
        currentWeekStart = addDays(currentWeekStart, 7);
        refreshWeek();
    });
    document.getElementById('btn-today').addEventListener('click', () => {
        currentWeekStart = Week.currentWeekStart(new Date());
        selectedDate = toDateStr(new Date());
        refreshWeek();
    });
}

function initViewTabs() {
    // Onglets Jour / Semaine
    document.querySelectorAll('.view-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            currentView = btn.dataset.view;
            document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyViewMode();
        });
    });

    // Sous-onglets Tableau / Agenda
    document.querySelectorAll('.week-sub-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            currentSubView = btn.dataset.sub;
            document.querySelectorAll('.week-sub-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('week-dashboard').style.display = currentSubView === 'dashboard' ? '' : 'none';
            document.getElementById('week-agenda').style.display    = currentSubView === 'agenda'    ? '' : 'none';
            document.getElementById('week-gantt').style.display     = currentSubView === 'gantt'     ? '' : 'none';
            if (currentSubView === 'gantt') renderWeekGantt();
            // Repositionne la vue pour que le sticky header ne masque pas la première ligne
            const weekFull = document.getElementById('week-full');
            if (weekFull) {
                const top = weekFull.getBoundingClientRect().top + window.pageYOffset - 52;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });
}

function applyViewMode() {
    const weekGrid   = document.getElementById('week-grid');
    const weekFull   = document.getElementById('week-full');
    const dayDetail  = document.getElementById('day-detail');
    const staffBar   = document.querySelector('.staff-bar');

    if (currentView === 'day') {
        weekGrid.style.display  = '';
        weekFull.style.display  = 'none';
        staffBar.style.display  = '';
        // Rouvrir le jour sélectionné si on revient en vue jour
        if (selectedDate) loadDayDetail(selectedDate);
    } else {
        weekGrid.style.display  = 'none';
        dayDetail.style.display = 'none';
        weekFull.style.display  = '';
        staffBar.style.display  = 'none';
        renderWeekFull();
    }
}

function renderWeekLabel() {
    const end = addDays(currentWeekStart, 6);
    const s = currentWeekStart;
    const e = end;
    document.getElementById('week-label').textContent =
        `Lun ${s.getDate()} ${MONTH_NAMES[s.getMonth()]} – Dim ${e.getDate()} ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`;
}

async function refreshWeek() {
    if (!currentVenueId) return;
    renderWeekLabel();
    await loadWeekSummary();
    await loadWeekFullData();
    // Construire currentShiftsWeek depuis weekFullData (déjà chargé, 0 fetch supplémentaire)
    currentShiftsWeek = Object.values(weekFullData).flat();
    renderSidebar(); // Mettre à jour l'ordre staff APRÈS que currentVenueId est à jour
    renderWeekGrid();
    loadDisposKpi(); // KPI dispos suit la semaine affichée
    if (currentView === 'week') {
        renderWeekFull();
    } else {
        const weekDates = Array.from({ length: 7 }, (_, i) => toDateStr(addDays(currentWeekStart, i)));
        if (weekDates.includes(selectedDate)) {
            await loadDayDetail(selectedDate);
        }
    }
}

async function loadWeekFullData() {
    const from = toDateStr(currentWeekStart);
    const to   = toDateStr(addDays(currentWeekStart, 6));
    try {
        const res = await fetch(
            `/api/week-full/${currentVenueId}?from=${from}&to=${to}`,
            { credentials: 'include' }
        );
        if (res.ok) {
            weekFullData = await res.json();
        } else {
            throw new Error('week-full failed');
        }
    } catch {
        // Fallback : 7 appels individuels si la route n'est pas encore disponible
        const promises = Array.from({ length: 7 }, (_, i) => {
            const date = toDateStr(addDays(currentWeekStart, i));
            return fetch(`/api/shifts/${currentVenueId}/${date}`, { credentials: 'include' })
                .then(r => r.ok ? r.json() : [])
                .then(shifts => ({ date, shifts }))
                .catch(() => ({ date, shifts: [] }));
        });
        const results = await Promise.all(promises);
        weekFullData = {};
        results.forEach(({ date, shifts }) => { weekFullData[date] = shifts; });
    }
}

// ── Résumé semaine depuis l'API ────────────────────────────────────────────────

async function loadWeekSummary() {
    const from = toDateStr(currentWeekStart);
    const to   = toDateStr(addDays(currentWeekStart, 6));
    try {
        const summaryRes = await fetch('/api/week/' + currentVenueId + '?from=' + from + '&to=' + to, { credentials: 'include' });
        weekSummary = await summaryRes.json();
        // Les shifts couleur seront pris depuis weekFullData après son chargement
    } catch {
        weekSummary = {};
    }
}

// ── Grille semaine ────────────────────────────────────────────────────────────

function renderWeekGrid() {
    const grid = document.getElementById('week-grid');
    grid.innerHTML = '';

    for (let i = 0; i < 7; i++) {
        const date    = addDays(currentWeekStart, i);
        const dateStr = toDateStr(date);
        const count   = weekSummary[dateStr] ?? 0;
        const empty   = count === 0;
        const today   = isToday(dateStr);
        const sel     = dateStr === selectedDate;

        const card = document.createElement('div');
        card.className = 'day-card'
            + (today ? ' today' : '')
            + (empty ? ' empty' : '')
            + (sel   ? ' selected' : '');
        card.dataset.date = dateStr;

        // En-tête
        const header = document.createElement('div');
        header.className = 'day-card-header';
        header.innerHTML = `
            <span class="day-name">${DAY_NAMES_SHORT[date.getDay()]}</span>
            <span class="day-num">${date.getDate()}</span>`;
        card.appendChild(header);

        // Corps
        const body = document.createElement('div');
        body.className = 'day-card-body';

        if (empty) {
            body.innerHTML = '<div class="day-empty-label">Vide</div>';
        } else {
            const shiftsForDay = currentShiftsWeek.filter(s => s.date === dateStr);
            if (shiftsForDay.length > 0) {
                const seen = new Set();
                const dots = shiftsForDay
                    .filter(s => { if (seen.has(s.staff_id)) return false; seen.add(s.staff_id); return true; })
                    .slice(0, 6)
                    .map(s => {
                        const sm = allStaff.find(st => String(st._id) === s.staff_id);
                        const color = sm ? sm.color : (s.color || '#888');
                        return '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';display:inline-block;flex-shrink:0"></span>';
                    }).join('');
                body.innerHTML =
                    '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">' + dots + '</div>' +
                    '<div class="day-shift-count">' + count + ' shift' + (count > 1 ? 's' : '') + '</div>';
            } else {
                body.innerHTML = '<div class="day-shift-count">' + count + ' shift' + (count > 1 ? 's' : '') + '</div>';
            }
        }

        card.appendChild(body);

        card.addEventListener('click', async () => {
            selectedDate = dateStr;
            renderWeekGrid(); // refresh sélection visuelle
            await loadDayDetail(dateStr);
        });

        grid.appendChild(card);
    }
}

// ── Détail d'un jour ──────────────────────────────────────────────────────────

async function loadDayDetail(dateStr) {
    selectedDate = dateStr;
    const date = parseDate(dateStr);

    document.getElementById('day-detail-title').textContent =
        formatDateLong(date);
    document.getElementById('day-detail').style.display = 'block';

    currentShifts  = [];
    confirmedDispos = [];
    dayLeaves = [];
    dayLeaveStaffIds = new Set();
    try {
        const [shiftsRes, disposRes, congesRes] = await Promise.all([
            fetch('/api/shifts/' + currentVenueId + '/' + dateStr, { credentials: 'include' }),
            fetch('/api/dispos/confirmed?from=' + dateStr + '&to=' + dateStr, { credentials: 'include' }),
            fetch('/api/conges?from=' + dateStr + '&to=' + dateStr + '&status=approved', { credentials: 'include' }),
        ]);
        if (shiftsRes.ok) currentShifts   = await shiftsRes.json();
        if (disposRes.ok) confirmedDispos = await disposRes.json();
        if (congesRes.ok) {
            dayLeaves = await congesRes.json();
            dayLeaveStaffIds = new Set(dayLeaves.map(c => String(c.staff_id)));
        }
    } catch { /* silencieux */ }

    renderSidebar(); // refléter les congés du jour dans la sidebar
    buildDisplayedStaff();
    extendDisplayForRealHours();
    renderTimelineHeader();
    renderBody();
    renderStats();

    // Bouton refresh : visible uniquement si le jour est aujourd'hui ou passé
    const btnRefresh = document.getElementById('btn-refresh-day');
    if (btnRefresh) {
        const todayStr = toDateStr(new Date());
        btnRefresh.style.display = (dateStr <= todayStr) ? '' : 'none';
    }

    document.getElementById('day-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Charger et afficher le bouton Publier pour la semaine courante
    loadPublishButton(dateStr);
}

async function loadPublishButton(dateStr) {
    // Le weekStart à publier = la semaine AFFICHÉE dans la timeline
    // Le staff consulte getMondayOf(addDays(new Date(), 7)) = semaine suivante
    // Pour qu'ils se correspondent, on publie la semaine affichée telle quelle
    const weekStart = toDateStr(getMondayOf(parseDate(dateStr)));
    const btn = document.getElementById('btn-publish-week');
    if (!btn) return;

    // Calculer si c'est la semaine prochaine par rapport à aujourd'hui
    const todayMonday   = toDateStr(getMondayOf(new Date()));
    const nextMonday    = toDateStr(addDays(getMondayOf(new Date()), 7));
    const isNextWeek    = weekStart === nextMonday;
    const isCurrentWeek = weekStart === todayMonday;
    const isPastWeek    = weekStart < todayMonday;

    // Label contextuel sur le bouton
    btn.dataset.weekStart = weekStart;
    btn.dataset.weekLabel = isNextWeek    ? 'Semaine prochaine'
                          : isCurrentWeek ? 'Semaine en cours'
                          : isPastWeek    ? 'Semaine passée'
                          : 'Semaine à venir';

    try {
        const res  = await fetch('/api/publish/' + weekStart, { credentials: 'include' });
        const data = await res.json();
        renderPublishControl(btn, data, weekStart);
    } catch { }
}

// Établissements visibles côté patron (filtrés par le groupe courant s'il est actif).
function _publishEstabs() {
    return currentGroup
        ? allEstablishments.filter(e => (e.groups || []).includes(currentGroup))
        : allEstablishments.slice();
}

function renderPublishControl(btn, data, weekStart) {
    const estabs = _publishEstabs();
    const auto   = !!data.auto;
    // Ensemble publié courant → Set d'ids. 'ALL'/auto = tous les établissements visibles.
    const pubSet = (auto || data.establishments === 'ALL')
        ? new Set(estabs.map(e => e.id))
        : new Set(Array.isArray(data.establishments) ? data.establishments : []);
    btn.dataset.auto = auto ? '1' : '';
    updatePublishBtnLabel(btn, pubSet.size, estabs.length);
    btn.onclick = (ev) => {
        ev.stopPropagation();
        openPublishPopover(btn, weekStart, estabs, pubSet, auto);
    };
}

function updatePublishBtnLabel(btn, nPublished, total) {
    const label = btn.dataset.weekLabel || 'la semaine';
    const nextMonday = toDateStr(addDays(getMondayOf(new Date()), 7));
    const isNextWeek = btn.dataset.weekStart === nextMonday;
    btn.title = '';
    if (total > 0 && nPublished >= total) {
        btn.textContent = '✓ Publié — ' + label;
        btn.style.background = '#d1fae5'; btn.style.borderColor = '#10b981'; btn.style.color = '#065f46';
    } else if (nPublished > 0) {
        btn.textContent = 'Publié ' + nPublished + '/' + total + ' — ' + label;
        btn.style.background = '#fef3c7'; btn.style.borderColor = '#f59e0b'; btn.style.color = '#92400e';
    } else {
        btn.textContent = 'Publier — ' + label;
        btn.style.background  = isNextWeek ? '#f0effe' : '#fff8ec';
        btn.style.borderColor = isNextWeek ? '#6C63FF' : '#f59e0b';
        btn.style.color       = isNextWeek ? '#534AB7' : '#92400e';
        btn.title = isNextWeek ? '' : 'Le staff consulte la semaine prochaine — navigue sur la semaine du ' + nextMonday + ' pour la leur publier';
    }
}

// Modale de publication par établissement — alignée sur la DA (cf. openChangeRoleModal).
function openPublishPopover(btn, weekStart, estabs, pubSet, auto) {
    document.getElementById('_publish-overlay')?.remove();
    if (auto) { showToast('Cette semaine est publiée automatiquement'); return; }
    // Un seul établissement → bascule directe tout/rien (pas de modale).
    if (estabs.length <= 1) {
        patchPublish(weekStart, pubSet.size === 0 ? 'ALL' : [], btn, estabs.length);
        return;
    }

    const nextMonday = toDateStr(addDays(getMondayOf(new Date()), 7));
    const isNextWeek = weekStart === nextMonday;
    const sel = new Set(pubSet); // copie locale modifiable

    const overlay = document.createElement('div');
    overlay.id = '_publish-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

    const rows = () => estabs.map(e => {
        const on = sel.has(e.id);
        return '<button class="_pub-row" data-id="' + e.id + '" style="' +
            'width:100%;display:flex;align-items:center;gap:10px;text-align:left;padding:11px 13px;margin-bottom:7px;cursor:pointer;font-family:inherit;' +
            'border-radius:10px;border:1.5px solid ' + (on ? '#10b981' : '#e8eaed') + ';background:' + (on ? '#ecfdf5' : '#fff') + ';transition:all .12s">' +
            '<span style="width:18px;height:18px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;' +
                'border:1.5px solid ' + (on ? '#10b981' : '#cfd4dc') + ';background:' + (on ? '#10b981' : '#fff') + ';color:#fff">' + (on ? '✓' : '') + '</span>' +
            '<span style="flex:1;font-size:13px;font-weight:600;color:' + (on ? '#065f46' : '#1a1a2e') + '">' + escapeHtml(e.name || e.id) + '</span>' +
            '<span style="font-size:11px;font-weight:600;color:' + (on ? '#10b981' : '#b8bdc7') + '">' + (on ? 'Publié' : 'Masqué') + '</span>' +
        '</button>';
    }).join('');

    const persist = () => {
        const arr = [...sel];
        patchPublish(weekStart, arr.length === estabs.length ? 'ALL' : arr, btn, estabs.length);
    };

    const draw = () => {
        overlay.innerHTML =
            '<div id="_pubcard" style="background:#fff;border-radius:14px;padding:22px;max-width:400px;width:100%;box-shadow:var(--shadow-xl);font-family:var(--font)">' +
                '<p style="font-size:15px;font-weight:700;color:#1a1a2e;margin-bottom:3px">Publier le planning</p>' +
                '<p style="font-size:12px;color:#8892a4;margin-bottom:14px">' + (btn.dataset.weekLabel || '') + ' · semaine du ' + weekStart + '</p>' +
                (isNextWeek ? '' : '<div style="font-size:11px;color:#92400e;background:#fef3c7;border-radius:8px;padding:9px 11px;margin-bottom:14px">⚠️ Le staff consulte la <b>semaine prochaine</b> (' + nextMonday + ').</div>') +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px">' +
                    '<span style="font-size:11px;font-weight:600;color:#8892a4;text-transform:uppercase;letter-spacing:.4px">Établissements</span>' +
                    '<div style="display:flex;gap:6px">' +
                        '<button id="_pub-all"  style="padding:4px 11px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid #e8eaed;background:#fff;color:#534AB7;cursor:pointer;font-family:inherit">Tout</button>' +
                        '<button id="_pub-none" style="padding:4px 11px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid #e8eaed;background:#fff;color:#8892a4;cursor:pointer;font-family:inherit">Aucun</button>' +
                    '</div>' +
                '</div>' +
                rows() +
                '<button id="_pub-done" style="width:100%;margin-top:13px;padding:11px;border-radius:8px;border:none;background:#1a1a2e;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Terminé</button>' +
            '</div>';
        overlay.querySelector('#_pubcard').addEventListener('click', ev => ev.stopPropagation());
        overlay.querySelectorAll('._pub-row').forEach(r => r.addEventListener('click', () => {
            const id = r.dataset.id;
            if (sel.has(id)) sel.delete(id); else sel.add(id);
            persist(); draw();
        }));
        overlay.querySelector('#_pub-all').addEventListener('click', () => { estabs.forEach(e => sel.add(e.id)); persist(); draw(); });
        overlay.querySelector('#_pub-none').addEventListener('click', () => { sel.clear(); persist(); draw(); });
        overlay.querySelector('#_pub-done').addEventListener('click', () => overlay.remove());
    };

    overlay.addEventListener('click', () => overlay.remove()); // clic hors carte = fermer
    document.body.appendChild(overlay);
    draw();
}

async function patchPublish(weekStart, establishments, btn, total) {
    try {
        const res = await fetch('/api/publish/' + weekStart, {
            credentials: 'include', method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ establishments }),
        });
        if (!res.ok) { showToast('Erreur lors de la publication', true); return; }
        const data = await res.json();
        const n = establishments === 'ALL' ? total : establishments.length;
        updatePublishBtnLabel(btn, n, total);
        showToast(data.message || 'Mis à jour');
    } catch { showToast('Erreur lors de la publication', true); }
}

document.getElementById('day-detail-close').addEventListener('click', () => {
    document.getElementById('day-detail').style.display = 'none';
    selectedDate = null;
    renderWeekGrid();
});

// ── Staff ─────────────────────────────────────────────────────────────────────

async function loadAllStaff() {
    try {
        const res = await fetch('/api/staff', { credentials: 'include' });
        allStaff  = await res.json();
    } catch {
        allStaff = [
            { _id: 'julien', name: 'Julien', color: '#3498db' },
            { _id: 'marc',   name: 'Marc',   color: '#9b59b6' },
            { _id: 'sophie', name: 'Sophie', color: '#e67e22' },
        ];
    }
    buildStaffDisplayNames();
    renderSidebar();
}

let _staffFilterRole = ''; // filtre rôle actif


function buildRoleFilters() {
    const container = document.getElementById('staff-role-filters');
    if (!container) return;
    // Ne reconstruire que si les rôles ont changé
    const currentCount = container.querySelectorAll('[data-role]').length - 1; // -1 pour "Tous"
    if (currentCount === allRoles.length) return;

    container.innerHTML = '<button class="role-filter-btn active" data-role="">Tous</button>';
    allRoles.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'role-filter-btn' + (r.type === 'responsable' ? ' responsable' : '');
        btn.dataset.role = String(r._id);
        btn.textContent  = r.name;
        if (_staffFilterRole === String(r._id)) btn.classList.add('active');
        btn.addEventListener('click', () => {
            _staffFilterRole = btn.dataset.role;
            container.querySelectorAll('.role-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderSidebar();
        });
        container.appendChild(btn);
    });

    // Listener "Tous"
    container.querySelector('[data-role=""]').addEventListener('click', function() {
        _staffFilterRole = '';
        container.querySelectorAll('.role-filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        renderSidebar();
    });
}

// Listener recherche — attaché une seule fois dans init()
function initStaffSearch() {
    const input = document.getElementById('staff-search');
    if (input) input.addEventListener('input', () => renderSidebar());
}

function renderSidebar() {
    const list = document.getElementById('staff-list');
    if (!list) return;
    list.innerHTML = '';

    // Construire les filtres rôles si pas encore fait
    buildRoleFilters();

    // Trier : staff affecté à l'établissement courant en premier, puis alphabétique
    let sorted = [...allStaff].sort((a, b) => {
        const aHas = a.venues && a.venues.includes(currentVenueId) ? 0 : 1;
        const bHas = b.venues && b.venues.includes(currentVenueId) ? 0 : 1;
        if (aHas !== bHas) return aHas - bHas;
        return a.name.localeCompare(b.name, 'fr');
    });

    const searchVal = normalizeStr(document.getElementById('staff-search')?.value || '').trim();

    // Filtrage + tri par pertinence si recherche active
    if (searchVal) {
        // Garder uniquement ceux qui contiennent la recherche
        sorted = sorted.filter(s => normalizeStr(s.name).includes(searchVal));
        // Trier : commence par la recherche en premier, contient ensuite
        sorted.sort((a, b) => {
            const aStarts = normalizeStr(a.name).startsWith(searchVal) ? 0 : 1;
            const bStarts = normalizeStr(b.name).startsWith(searchVal) ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
            return a.name.localeCompare(b.name, 'fr');
        });
    }

    sorted.forEach(staff => {
        // Filtrage par groupe actif
        if (currentGroup) {
            const staffGroups = staff.groups || [];
            if (staffGroups.length > 0 && !staffGroups.includes(currentGroup)) return;
        }
        const isPref = staff.venues && staff.venues.includes(currentVenueId);

        // Trouver le rôle responsable de ce staff (affichage prioritaire)
        const staffRoleIds = staff.roles || [];
        const responsableRole = allRoles.find(r => r.type === 'responsable' && staffRoleIds.includes(String(r._id)));
        const firstRole = responsableRole || allRoles.find(r => staffRoleIds.includes(String(r._id)));

        // Filtrage par rôle (le filtre searchVal est déjà appliqué avant le forEach)
        if (_staffFilterRole && !staffRoleIds.includes(_staffFilterRole)) return;

        const onLeave = dayLeaveStaffIds.has(String(staff._id));

        const card = document.createElement('div');
        card.className       = 'staff-card' + (isPref ? ' staff-pref' : '') + (onLeave ? ' staff-card-onleave' : '');
        card.draggable       = true;
        card.dataset.staffId = staff._id;
        card.dataset.name    = staff.name.toLowerCase();
        card.dataset.roles   = staffRoleIds.join(',');
        if (onLeave) card.title = staff.name + ' est en congé ce jour';

        card.innerHTML =
            (isPref ? '<span class="staff-pref-dot" title="Affecté à cet établissement">★</span>' : '') +
            '<span class="staff-dot" style="background:' + staff.color + '"></span>' +
            '<span class="staff-info-name"' + (staff.name_color ? ' style="color:' + staff.name_color + '"' : '') + '>' + displayName(staff._id, staff.name) + '</span>' +
            (onLeave ? '<span class="staff-leave-badge" title="En congé ce jour">🌴 Congé</span>' : '') +
            (firstRole
                ? '<span class="staff-role-badge ' + firstRole.type + '">' + firstRole.name + '</span>'
                : '') +
            '<div class="color-controls">' +
                '<input type="color" class="color-picker" value="' + staff.color + '" title="Couleur du shift">' +
                '<input type="color" class="color-picker font-color-picker" value="' + (staff.name_color || staff.color) + '" title="Couleur du texte" style="opacity:0.65">' +
                '<button class="btn-auto-color">Auto</button>' +
            '</div>';

        applyCardNameContrast(card, staff.color, staff.name_color);

        card.addEventListener('dragstart', e => {
            if (e.target.closest('.color-controls')) { e.preventDefault(); return; }
            onSidebarDragStart(e, staff, card);
        });
        card.addEventListener('dragend', () => onSidebarDragEnd(card));

        // ── Tap-to-place (mobile) ─────────────────────────────────────────────
        card.addEventListener('touchend', e => {
            if (e.target.closest('.color-controls')) return;
            e.preventDefault();
            if (!isMobileDevice()) return;
            tapSelectStaff(staff, card);
        }, { passive: false });

        const picker = card.querySelector('.color-picker');
        picker.addEventListener('change', async e => { e.stopPropagation(); await updateStaffColor(staff, e.target.value, card); });
        picker.addEventListener('mousedown', e => e.stopPropagation());

        const fontPicker = card.querySelector('.font-color-picker');
        fontPicker.addEventListener('change', async e => {
            e.stopPropagation();
            const newNameColor = e.target.value !== staff.color ? e.target.value : null;
            try {
                const res = await fetch('/api/staff/' + staff._id, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name_color: newNameColor }),
                });
                if (!res.ok) throw new Error((await res.json()).error);
                staff.name_color = newNameColor;
                const nameEl = card.querySelector('.staff-info-name');
                if (nameEl) nameEl.style.color = newNameColor || '';
                applyCardNameContrast(card, staff.color, newNameColor);
                document.querySelectorAll('.shift').forEach(el => {
                    const sd = currentShifts.find(s => String(s._id) === el.dataset.id);
                    if (sd && sd.staff_id === staff._id) {
                        el.style.color = newNameColor || textColorFor(sd.color || '#3498db');
                    }
                });
            } catch (err) { showToast(err.message, true); }
        });
        fontPicker.addEventListener('mousedown', e => e.stopPropagation());

        const btnAuto = card.querySelector('.btn-auto-color');
        btnAuto.addEventListener('click', async e => {
            e.stopPropagation();
            const autoColor = generateColor(staff.name);
            picker.value = autoColor;
            // Réinitialise aussi la couleur de police custom
            if (staff.name_color) {
                try {
                    const res = await fetch('/api/staff/' + staff._id, {
                        method: 'PATCH', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name_color: null }),
                    });
                    if (!res.ok) throw new Error((await res.json()).error);
                    staff.name_color = null;
                    const nameEl = card.querySelector('.staff-info-name');
                    if (nameEl) nameEl.style.color = '';
                    fontPicker.value = autoColor;
                    document.querySelectorAll('.shift').forEach(el => {
                        const sd = currentShifts.find(s => String(s._id) === el.dataset.id);
                        if (sd && sd.staff_id === staff._id) el.style.color = textColorFor(sd.color || '#3498db');
                    });
                } catch (err) { showToast(err.message, true); }
            }
            await updateStaffColor(staff, autoColor, card);
        });
        btnAuto.addEventListener('mousedown', e => e.stopPropagation());

        list.appendChild(card);
    });

    // ── Carte Joker (toujours en bas de la sidebar) ───────────────────────────
    const jokerCard = document.createElement('div');
    jokerCard.className = 'staff-card staff-card-joker';
    jokerCard.draggable = true;
    jokerCard.dataset.staffId = '__joker__';
    jokerCard.title = 'Joker : créneau ouvert sans staff désigné. Glisse-le sur la timeline pour créer un créneau à pourvoir (motif rayé). Tu pourras ensuite l’ouvrir aux candidatures du staff.';
    jokerCard.innerHTML =
        '<span class="joker-icon">?</span>' +
        '<span class="staff-info-name">Joker</span>' +
        '<span class="staff-role-badge joker">Non désigné</span>';

    jokerCard.addEventListener('dragstart', e => {
        const joker = {
            _id:     '__joker__',
            name:    'Joker',
            color:   '#95a5a6',
            isJoker: true,
        };
        onSidebarDragStart(e, joker, jokerCard);
    });
    jokerCard.addEventListener('dragend', () => onSidebarDragEnd(jokerCard));

    // ── Tap-to-place Joker (mobile) ───────────────────────────────────────────
    jokerCard.addEventListener('touchend', e => {
        e.preventDefault();
        if (!isMobileDevice()) return;
        tapSelectStaff({ _id: '__joker__', name: 'Joker', color: '#95a5a6', isJoker: true }, jokerCard);
    }, { passive: false });
    list.appendChild(jokerCard);
}

// ── Établissements ────────────────────────────────────────────────────────────

async function loadRoles() {
    try {
        const res = await fetch('/api/roles', { credentials: 'include' });
        if (res.ok) allRoles = await res.json();
    } catch { allRoles = []; }
}

async function loadGroups() {
    try {
        const res = await fetch('/api/groups', { credentials: 'include' });
        if (res.ok) allGroups = await res.json();
    } catch { allGroups = []; }
    renderGroupFilter();
}

function renderGroupFilter() {
    // Injecter le sélecteur de groupe dans la venue-bar si plusieurs groupes existent
    let container = document.getElementById('group-filter-bar');
    if (allGroups.length === 0) {
        if (container) container.style.display = 'none';
        return;
    }
    if (!container) {
        container = document.createElement('div');
        container.id = 'group-filter-bar';
        container.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 16px;background:#f8f8f8;border-bottom:1px solid #eee;flex-wrap:wrap';
        // Insérer après la venue-bar
        const venueBar = document.querySelector('.venue-bar');
        if (venueBar) venueBar.after(container);
        else return;
    }
    container.style.display = '';
    container.innerHTML = '<span style="font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.4px;flex-shrink:0">Groupe ·</span>';

    const groups = [null, ...allGroups]; // null = Tous
    groups.forEach(g => {
        const isActive = g === currentGroup;
        const pill = document.createElement('div');
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:3px';

        const btn = document.createElement('button');
        btn.textContent = g || 'Tous';
        btn.style.cssText = 'padding:4px 12px;border-radius:20px;border:1.5px solid ' +
            (isActive ? '#1a1a2e' : '#e0e0e0') + ';background:' +
            (isActive ? '#1a1a2e' : 'white') + ';color:' +
            (isActive ? 'white' : '#555') + ';font-size:12px;font-weight:' +
            (isActive ? '600' : '400') + ';cursor:pointer';
        btn.addEventListener('click', async () => {
            currentGroup = g;
            renderGroupFilter();
            const filtered = currentGroup
                ? allEstablishments.filter(e => (e.groups || []).includes(currentGroup))
                : allEstablishments;
            renderTabs(filtered);
            if (filtered.length > 0) {
                const keepCurrent = filtered.some(e => e.id === currentVenueId);
                if (!keepCurrent) {
                    currentVenueId = filtered[0].id;
                }
                applyVenueHours(currentVenueId);
                // Mettre à jour le tab actif visuellement
                document.querySelectorAll('.venue-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.id === currentVenueId);
                });
            }
            await refreshWeek();
            if (selectedDate) await loadDayDetail(selectedDate);
            renderSidebar();
        });
        pill.appendChild(btn);

        // Bouton × pour supprimer le groupe (admin uniquement, pas sur "Tous")
        if (g && currentUser && currentUser.role === 'patron') {
            const del = document.createElement('button');
            del.textContent = '×';
            del.title = 'Supprimer le groupe ' + g;
            del.style.cssText = 'padding:0 4px;border:none;background:none;color:#bbb;font-size:13px;cursor:pointer;line-height:1';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                showConfirm(
                    'Supprimer le groupe <strong>' + g + '</strong> ?<br><span style="font-size:12px;color:#888">Il sera retiré de tous les établissements et membres du staff.</span>',
                    async () => {
                        try {
                            const r = await fetch('/api/groups/' + encodeURIComponent(g), {
                                credentials: 'include', method: 'DELETE',
                            });
                            const d = await r.json();
                            if (!r.ok) throw new Error(d.error);
                            if (currentGroup === g) currentGroup = null;
                            // Recharger établissements et staff pour refléter la suppression
                            await Promise.all([loadEstablishments(), loadAllStaff()]);
                            await loadGroups();
                            showToast('Groupe "' + g + '" supprimé');
                        } catch (err) { showToast(err.message, true); }
                    }
                );
            });
            pill.appendChild(del);
        }

        container.appendChild(pill);
    });
}

async function loadEstablishments() {
    try {
        const res  = await fetch('/api/establishments', { credentials: 'include' });
        const list = await res.json();
        // Normaliser : garantir que chaque établissement a un champ .id utilisable
        const normalized = list.map(e => ({ ...e, id: e.id || String(e._id) }));
        allEstablishments = normalized;
        renderTabs(normalized);
        if (normalized.length > 0) {
            currentVenueId = normalized[0].id;
            applyVenueHours(normalized[0].id);
            renderWeekLabel();
            await refreshWeek();
            // Ouvrir automatiquement le jour courant
            await loadDayDetail(toDateStr(new Date()));
        }
    } catch {
        const fallback = [
            { id: 'Josy_pub',          name: 'Josy',   type: 'pub' },
            { id: 'Poni_restaurant',   name: 'Poni',   type: 'restaurant' },
            { id: 'FanFan_restaurant', name: 'FanFan', type: 'restaurant' },
            { id: 'Caval_restaurant',  name: 'Caval',  type: 'restaurant' },
        ];
        allEstablishments = fallback;
        renderTabs(fallback);
        currentVenueId = fallback[0].id;
        applyVenueHours(fallback[0].id);
        renderWeekLabel();
        await refreshWeek();
        await loadDayDetail(toDateStr(new Date()));
    }
}

function renderTabs(list) {
    const container = document.getElementById('venue-tabs');
    container.innerHTML = '';
    list.forEach((v, i) => {
        const btn = document.createElement('button');
        btn.className  = 'venue-tab' + (i === 0 ? ' active' : '');
        btn.dataset.id = v.id;
        btn.innerHTML  = `${escapeHtml(v.name)} <span class="badge">${v.type === 'pub' ? 'Pub' : 'Resto'}</span>`;
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.venue-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            currentVenueId = v.id;
            applyVenueHours(v.id);
            renderSidebar(); // Mettre à jour immédiatement l'ordre staff
            await refreshWeek();
            if (selectedDate) await loadDayDetail(selectedDate);
        });
        container.appendChild(btn);
    });
}

// ── Planning (réutilisé de la version précédente) ─────────────────────────────

function extendDisplayForRealHours() {
    // Étend START_HOUR / END_HOUR / TOTAL_HOURS si des heures réelles dépassent les bornes visuelles.
    // Appelée après buildDisplayedStaff() et avant renderTimelineHeader().
    // OPEN_TIME / CLOSE_TIME / snap ne sont PAS modifiés.
    // applyVenueHours() remet les valeurs d'origine au prochain changement de jour/venue.
    let minStart = START_HOUR;
    let maxEnd   = END_HOUR;
    currentShifts.forEach(s => {
        if (s.real_start != null && s.real_start < minStart) minStart = s.real_start;
        if (s.real_end   != null && s.real_end   > maxEnd)   maxEnd   = s.real_end;
    });
    if (minStart < START_HOUR) START_HOUR  = Math.floor(minStart);
    if (maxEnd   > END_HOUR)   END_HOUR    = Math.ceil(maxEnd + 0.5);
    TOTAL_HOURS = END_HOUR - START_HOUR;
}

// Filtre groupe : renvoie true si le staff appartient au groupe actif
// ou n'a aucun groupe (toujours visible). Les Jokers sont également toujours visibles.
function staffMatchesCurrentGroup(staffId) {
    if (!currentGroup) return true;
    if (!staffId || staffId === '__joker__') return true;
    const staff = allStaff.find(s => String(s._id) === String(staffId));
    if (!staff) return true;
    const groups = staff.groups || [];
    return groups.length === 0 || groups.includes(currentGroup);
}

function buildDisplayedStaff() {
    const seen = new Map();
    currentShifts.forEach(s => {
        if (s.is_joker || s.staff_id === '__joker__') {
            // Chaque shift Joker = une ligne distincte (clé = shift _id)
            const rowId = String(s._id);
            seen.set(rowId, { _id: rowId, name: s.staff_name, color: s.color || '#95a5a6', isJoker: true });
        } else if (!seen.has(s.staff_id)) {
            if (!staffMatchesCurrentGroup(s.staff_id)) return;
            seen.set(s.staff_id, { _id: s.staff_id, name: s.staff_name, color: s.color });
        }
    });
    displayedStaff = Array.from(seen.values());
}

function renderTimelineHeader() {
    refreshPxPerHour();
    const hdr = document.getElementById('timeline-header');
    hdr.innerHTML = '';
    for (let h = START_HOUR; h <= END_HOUR; h++) {
        const cell = document.createElement('div');
        cell.className   = 'tl-hour';
        cell.textContent = (h < 24 ? h : h - 24) + 'h';
        hdr.appendChild(cell);
    }
    hdr.style.width = (TOTAL_HOURS + 1) * PX_PER_HOUR + 'px';
}

function renderBody() {
    const body = document.getElementById('timeline-body');
    body.innerHTML = '';

    if (displayedStaff.length === 0) {
        body.innerHTML = `<div class="empty-rail">Glisse un membre du staff depuis la liste ci-dessous</div>`;
        return;
    }

    displayedStaff.forEach(staff => body.appendChild(createStaffRow(staff)));
    renderStats();
}

function createStaffRow(staff) {
    const row = document.createElement('div');
    row.className      = 'staff-row' + (staff.isJoker ? ' staff-row-joker' : '');
    row.dataset.staffId = staff._id;

    const label = document.createElement('div');
    label.className = 'row-label';
    label.innerHTML = staff.isJoker
        ? `<span class="joker-dot">?</span>
           <span style="font-style:italic;color:#888">${escapeHtml(staff.name)}</span>
           <button class="row-delete" onclick="removeStaffFromDay('${escapeHtml(staff._id)}')">×</button>`
        : `<span class="row-label-dot" style="background:${escapeHtml(staff.color)}"></span>
           <span>${escapeHtml(displayName(staff._id, staff.name))}</span>
           <button class="row-delete" onclick="removeStaffFromDay('${escapeHtml(staff._id)}')">×</button>`;

    const rail = document.createElement('div');
    rail.className      = 'row-rail';
    rail.dataset.staffId = staff._id;
    rail.style.width    = (TOTAL_HOURS + 1) * PX_PER_HOUR + 'px';

    // Dispos confirmées en fond (semi-transparent)
    confirmedDispos
        .filter(d => d.staff_id === String(staff._id))
        .forEach(dispo => {
            const bg = document.createElement('div');
            bg.className = 'dispo-bg';
            const left  = (dispo.start_time - START_HOUR) * PX_PER_HOUR;
            const width = (dispo.end_time - dispo.start_time) * PX_PER_HOUR;
            bg.style.left   = Math.max(0, left) + 'px';
            bg.style.width  = Math.max(PX_PER_HOUR, width) + 'px';
            bg.style.background = (staff.color || '#3498db') + '33'; // 20% opacité
            bg.style.borderTop  = '2px dashed ' + (staff.color || '#3498db') + '88';
            bg.title = 'Dispo confirmée : ' + Math.floor(dispo.start_time % 24) + 'h → ' + Math.floor(dispo.end_time % 24) + 'h';
            rail.appendChild(bg);
        });

    currentShifts
        .filter(s => {
            if (staff.isJoker) {
                // La ligne Joker est identifiée par l'_id du shift (pas staff_id)
                return String(s._id) === staff._id;
            }
            return s.staff_id === staff._id;
        })
        .forEach(shift => rail.appendChild(createShiftEl(shift)));

    // ── Tap-to-place sur le rail (mobile) ─────────────────────────────────────
    rail.addEventListener('touchend', async e => {
        if (!isMobileDevice() || !_tapSelectedStaff) return;
        // Ignorer si le tap est sur un shift existant
        if (e.target.closest('.shift')) return;
        e.preventDefault();
        const touch    = e.changedTouches[0];
        const scroller = document.getElementById('timeline-scroll');
        const scrollLeft = scroller ? scroller.scrollLeft : 0;
        const rect     = rail.getBoundingClientRect();
        const rawH     = (touch.clientX - rect.left + scrollLeft) / PX_PER_HOUR;
        const snappedH = Math.round(rawH * 4) / 4 + START_HOUR;
        const startTime = Math.max(OPEN_TIME, Math.min(snappedH, CLOSE_TIME - 0.25));
        const endTime   = Math.min(startTime + 2, CLOSE_TIME);
        const staff     = _tapSelectedStaff;
        clearTapSelection();
        await createShift(staff, startTime, endTime);
    }, { passive: false });

    row.appendChild(label);
    row.appendChild(rail);

    // Total heures du jour pour ce staff
    const staffShifts = currentShifts.filter(s => {
        if (staff.isJoker) return String(s._id) === staff._id;
        return s.staff_id === staff._id;
    });
    const totalH = staffShifts.reduce((acc, s) => {
        const ds = s.real_start != null ? s.real_start : s.start_time;
        const de = s.real_end   != null ? s.real_end   : s.end_time;
        return acc + (de - ds);
    }, 0);
    const totalEl = document.createElement('div');
    totalEl.className = 'row-total';
    if (totalH > 0) {
        const hrs  = Math.floor(totalH);
        const mins = Math.round((totalH - hrs) * 60);
        totalEl.textContent = mins > 0 ? hrs + 'h' + String(mins).padStart(2,'00') : hrs + 'h';
    } else {
        totalEl.textContent = '—';
    }
    row.appendChild(totalEl);

    return row;
}

function createShiftEl(shift) {
    const el = document.createElement('div');
    el.className  = 'shift' + (shift.is_joker || shift.staff_id === '__joker__' ? ' shift-joker' : '');
    el.dataset.id = shift._id;

    const bgColor   = shift.color || '#3498db';
    const textColor = shiftTextColor(shift);
    if (shift.is_joker || shift.staff_id === '__joker__') {
        el.style.background = 'repeating-linear-gradient(45deg, #bdc3c7, #bdc3c7 4px, #ecf0f1 4px, #ecf0f1 10px)';
        el.style.color      = '#555';
        el.style.border     = '1.5px dashed #95a5a6';
    } else {
        el.style.background = bgColor;
        el.style.color      = textColor;
    }

    const fmt = h => `${Math.floor(h % 24).toString().padStart(2,'0')}h${String(Math.round((h%1)*60)).padStart(2,'0')}`;

    // Si heures réelles disponibles → positionner et afficher selon le réel
    const hasReal     = shift.real_start != null && shift.real_end != null;
    const displayStart = hasReal ? shift.real_start : shift.start_time;
    const displayEnd   = hasReal ? shift.real_end   : shift.end_time;

    const left  = (displayStart - START_HOUR) * PX_PER_HOUR;
    const width = (displayEnd   - displayStart) * PX_PER_HOUR;
    el.style.left  = Math.max(0, left)  + 'px';
    el.style.width = Math.max(PX_PER_HOUR, width) + 'px';

    // Badge "réel" + indication heures planifiées en sous-titre si différent
    const realBadge = hasReal
        ? `<span class="shift-real-badge" title="Planifié : ${fmt(shift.start_time)} – ${fmt(shift.end_time)}">réel</span>`
        : '';

    // Bouton 👑 responsable pointage — uniquement si le staff a un rôle responsable
    const staffMember    = allStaff.find(s => String(s._id) === String(shift.staff_id));
    const staffRoleIds   = (staffMember && staffMember.roles) || [];
    const isResp         = allRoles.some(r => r.type === 'responsable' && staffRoleIds.includes(String(r._id)));
    const respBtn        = isResp
        ? `<button class="shift-resp-btn${shift.pointage_resp ? ' active' : ''}" title="Responsable pointage">👑</button>`
        : '';

    const isJoker       = shift.is_joker || shift.staff_id === '__joker__';
    const noteText      = isJoker && shift.note
        ? `<span class="shift-note-text">${shift.note.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`
        : '';
    const jokerOpenBadge = isJoker && shift.joker_open
        ? `<span class="joker-open-badge">📢 Ouvert</span>`
        : '';
    if (isJoker && shift.note) el.classList.add('has-note');

    el.innerHTML = `
        <div class="resizer left"></div>
        <span class="shift-name">${escapeHtml(displayName(shift.staff_id, shift.staff_name))}</span>
        <span class="shift-hours">${fmt(displayStart)} – ${fmt(displayEnd)}</span>
        ${realBadge}
        ${noteText}
        ${jokerOpenBadge}
        ${respBtn}
        <button class="shift-delete" onclick="deleteShift(event, '${escapeHtml(String(shift._id))}', '${escapeHtml(String(shift.staff_id))}')">×</button>
        <div class="resizer right"></div>`;

    // Clic sur un Joker → modale patron (note + toggle + candidatures)
    if (isJoker) {
        el.style.cursor = 'pointer';
        el.title = 'Créneau Joker (motif rayé) — créneau à pourvoir. Clic pour ouvrir aux candidatures du staff ou assigner directement.';
        el.addEventListener('click', e => {
            if (e.target.closest('.resizer') || e.target.closest('.shift-delete')) return;
            if (_shiftWasDragged) { _shiftWasDragged = false; return; }
            openJokerModal(shift, el);
        });
    }

    // Clic → modale horaires (mobile : édition planifié | desktop : heures réelles)
    if (!shift.is_joker && shift.staff_id !== '__joker__') {
        el.addEventListener('click', e => {
            if (e.target.closest('.resizer') || e.target.closest('.shift-delete') || e.target.closest('.shift-resp-btn')) return;
            if (_shiftWasDragged) { _shiftWasDragged = false; return; } // ignorer le click après un drag/resize
            if (isMobileDevice()) {
                openMobileShiftEditModal(shift);
            } else {
                openRealHoursModal(shift, el);
            }
        });
    }

    // Bouton 👑 — désigner/retirer responsable pointage
    if (isResp) {
        const btn = el.querySelector('.shift-resp-btn');
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const newVal = !(shift.pointage_resp === true);
            try {
                const r = await fetch('/api/shifts/' + shift._id + '/pointage-resp', {
                    credentials: 'include', method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: newVal }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error);
                shift.pointage_resp = newVal;
                btn.classList.toggle('active', newVal);
                // Plusieurs responsables peuvent coexister sur la même soirée (matin + soir, etc.)
                showToast(newVal ? shift.staff_name + ' — responsable pointage 👑' : 'Désignation retirée');
            } catch (err) { showToast(err.message, true); }
        });
    }

    return el;
}

// ── Modale édition horaires planifiés (mobile) ───────────────────────────────

function openMobileShiftEditModal(shift) {
    const fmt = h => h == null ? '' : String(Math.floor(h % 24)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');

    // Désignation responsable de soirée (uniquement si le staff a un rôle responsable)
    const _staffMember  = allStaff.find(s => String(s._id) === String(shift.staff_id));
    const _staffRoleIds = (_staffMember && _staffMember.roles) || [];
    const _isResp       = allRoles.some(r => r.type === 'responsable' && _staffRoleIds.includes(String(r._id)));

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:flex-end;justify-content:center';

    const inp = 'width:100%;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:18px;font-weight:600;outline:none;color:#1a1a2e;background:#fafbfc;font-family:inherit';
    const lbl = 'font-size:10px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px';
    const grp = 'flex:1;min-width:0';
    const row = 'display:flex;gap:10px';
    const iconBtn = 'width:36px;height:36px;border-radius:9px;border:1px solid #e0e0e0;background:white;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0;font-family:inherit';
    const respRowHtml = _isResp
        ? ('<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid ' + (shift.pointage_resp ? '#f0c040' : '#e0e0e0') + ';border-radius:12px;margin-bottom:14px;background:' + (shift.pointage_resp ? '#fff8e0' : 'white') + '">' +
              '<span style="font-size:18px;line-height:1">👑</span>' +
              '<span style="font-size:13px;font-weight:600;color:#1a1a2e;flex:1">Responsable de la soirée</span>' +
              '<button id="_ms-resp-toggle" type="button" style="padding:7px 16px;border-radius:20px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;min-width:64px;background:' + (shift.pointage_resp ? '#f0c040' : '#e0e0e0') + ';color:' + (shift.pointage_resp ? '#1a1a2e' : '#666') + '">' + (shift.pointage_resp ? 'Oui' : 'Non') + '</button>' +
          '</div>')
        : '';
    overlay.innerHTML =
        '<div style="background:white;border-radius:18px 18px 0 0;padding:14px 16px max(16px,env(safe-area-inset-bottom));width:100%;max-width:480px;box-shadow:0 -4px 32px rgba(0,0,0,0.18);max-height:88vh;overflow-y:auto">' +
            '<div style="width:36px;height:4px;background:#e0e0e0;border-radius:2px;margin:0 auto 14px"></div>' +
            // Header avec actions icônes
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
                '<span style="width:11px;height:11px;border-radius:50%;background:' + (shift.color || '#888') + ';flex-shrink:0;display:inline-block"></span>' +
                '<span style="font-size:15px;font-weight:700;color:#1a1a2e;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + shift.staff_name + '</span>' +
                '<button id="_ms-replace" title="Remplacer" style="' + iconBtn + ';color:#27ae60;border-color:#a7e0c0">↔</button>' +
                '<button id="_ms-copy"    title="Transférer" style="' + iconBtn + ';color:#6C63FF;border-color:#c5beff">→</button>' +
                '<button id="_ms-delete"  title="Supprimer"  style="' + iconBtn + ';color:#e74c3c;border-color:#f5c6c6">🗑</button>' +
            '</div>' +
            // Section planifié
            '<div style="' + lbl + '">Horaires planifiés</div>' +
            '<div style="' + row + ';margin-bottom:16px">' +
                '<div style="' + grp + '"><div style="font-size:10px;color:#aaa;font-weight:600;margin-bottom:4px">Début</div><input id="_ms-start" type="time" value="' + fmt(shift.start_time) + '" style="' + inp + '"></div>' +
                '<div style="' + grp + '"><div style="font-size:10px;color:#aaa;font-weight:600;margin-bottom:4px">Fin</div><input id="_ms-end" type="time" value="' + fmt(shift.end_time) + '" style="' + inp + '"></div>' +
            '</div>' +
            // Section réelles (mise en valeur)
            '<div style="background:#f8f9ff;border:1px solid #e5e3ff;border-radius:12px;padding:12px;margin-bottom:18px">' +
                '<div style="' + lbl + ';color:#6C63FF">⏱ Heures réelles</div>' +
                '<div style="' + row + '">' +
                    '<div style="' + grp + '"><div style="font-size:10px;color:#888;font-weight:600;margin-bottom:4px">Début réel</div><input id="_ms-real-start" type="time" value="' + fmt(shift.real_start) + '" style="' + inp + ';background:white"></div>' +
                    '<div style="' + grp + '"><div style="font-size:10px;color:#888;font-weight:600;margin-bottom:4px">Fin réelle</div><input id="_ms-real-end" type="time" value="' + fmt(shift.real_end) + '" style="' + inp + ';background:white"></div>' +
                '</div>' +
            '</div>' +
            respRowHtml +
            // Actions principales
            '<div style="display:flex;gap:10px">' +
                '<button id="_ms-cancel" style="padding:13px 16px;border-radius:10px;border:1px solid #e0e0e0;background:white;font-size:14px;cursor:pointer;color:#555;flex:1;font-family:inherit">Annuler</button>' +
                '<button id="_ms-save"   style="padding:13px 16px;border-radius:10px;border:none;background:#6C63FF;color:white;font-size:14px;font-weight:600;cursor:pointer;flex:1.4;font-family:inherit;box-shadow:0 2px 8px rgba(108,99,255,0.30)">Enregistrer</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);

    overlay.querySelector('#_ms-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_ms-delete').addEventListener('click', () => {
        close();
        deleteShift(new Event('click'), String(shift._id), shift.staff_id);
    });

    overlay.querySelector('#_ms-replace').addEventListener('click', () => { close(); openReplaceStaffModal(shift); });

    const msCopyBtn = overlay.querySelector('#_ms-copy');
    if (allEstablishments.length <= 1) msCopyBtn.style.display = 'none';
    msCopyBtn.addEventListener('click', () => { close(); openTransferShiftModal(shift); });

    // Toggle responsable de la soirée (PATCH immédiat, indépendant du bouton Enregistrer)
    const respToggleBtn = overlay.querySelector('#_ms-resp-toggle');
    if (respToggleBtn) {
        respToggleBtn.addEventListener('click', async () => {
            const newVal = !(shift.pointage_resp === true);
            respToggleBtn.disabled = true;
            try {
                const r = await fetch('/api/shifts/' + shift._id + '/pointage-resp', {
                    credentials: 'include', method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: newVal }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error);
                shift.pointage_resp = newVal;
                // MAJ visuelle du toggle et de son conteneur
                respToggleBtn.textContent = newVal ? 'Oui' : 'Non';
                respToggleBtn.style.background = newVal ? '#f0c040' : '#e0e0e0';
                respToggleBtn.style.color      = newVal ? '#1a1a2e' : '#666';
                const wrap = respToggleBtn.parentElement;
                if (wrap) {
                    wrap.style.background    = newVal ? '#fff8e0' : 'white';
                    wrap.style.borderColor   = newVal ? '#f0c040' : '#e0e0e0';
                }
                // MAJ couronne sur la barre du shift sans recharger
                const shiftEl = document.querySelector('.shift[data-id="' + shift._id + '"] .shift-resp-btn');
                if (shiftEl) shiftEl.classList.toggle('active', newVal);
                showToast(newVal ? shift.staff_name + ' — responsable pointage 👑' : 'Désignation retirée');
            } catch (err) {
                showToast(err.message || 'Erreur', true);
            } finally {
                respToggleBtn.disabled = false;
            }
        });
    }

    overlay.querySelector('#_ms-save').addEventListener('click', async () => {
        const parseT = v => {
            if (!v) return null;
            const [hh, mm] = v.split(':').map(Number);
            let h = hh + mm / 60;
            if (h < START_HOUR) h += 24;
            return h;
        };
        const parseReal = (v, ref) => {
            if (!v) return null;
            const [hh, mm] = v.split(':').map(Number);
            let h = hh + mm / 60;
            if (ref != null && h < ref) h += 24;
            return h;
        };
        const newStart = parseT(overlay.querySelector('#_ms-start').value);
        const newEnd   = parseT(overlay.querySelector('#_ms-end').value);
        if (newStart == null || newEnd == null) { showToast('Horaires invalides', true); return; }
        if (newEnd <= newStart) { showToast('La fin doit être après le début', true); return; }

        const rs = parseReal(overlay.querySelector('#_ms-real-start').value, null);
        const re = parseReal(overlay.querySelector('#_ms-real-end').value, rs);
        const hasReal = rs != null || re != null;

        const btn = overlay.querySelector('#_ms-save');
        btn.disabled    = true;
        btn.textContent = '…';
        try {
            const res  = await fetch('/api/shifts/' + shift._id, {
                method: 'PATCH', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start_time: newStart, end_time: newEnd }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            if (data.warnings?.length) showConflictAlert(data.warnings, shift.staff_name);

            if (hasReal) {
                const r2 = await fetch('/api/shifts/' + shift._id + '/pointage', {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ real_start: rs, real_end: re }),
                });
                if (!r2.ok) { const d2 = await r2.json(); throw new Error(d2.error); }
                shift.real_start = rs;
                shift.real_end   = re;
            }

            // Mettre à jour en mémoire
            const idx = currentShifts.findIndex(s => String(s._id) === String(shift._id));
            if (idx !== -1) {
                currentShifts[idx].start_time = newStart;
                currentShifts[idx].end_time   = newEnd;
                if (hasReal) { currentShifts[idx].real_start = rs; currentShifts[idx].real_end = re; }
            }
            if (weekFullData[selectedDate]) {
                const wIdx = weekFullData[selectedDate].findIndex(s => String(s._id) === String(shift._id));
                if (wIdx !== -1) {
                    weekFullData[selectedDate][wIdx].start_time = newStart;
                    weekFullData[selectedDate][wIdx].end_time   = newEnd;
                    if (hasReal) { weekFullData[selectedDate][wIdx].real_start = rs; weekFullData[selectedDate][wIdx].real_end = re; }
                }
            }
            currentShiftsWeek = Object.values(weekFullData).flat();
            close();
            renderBody();
            renderStats();
            showToast('Horaires mis à jour');
        } catch (err) { showToast(err.message || 'Erreur', true); btn.disabled = false; btn.textContent = 'Enregistrer'; }
    });
}

// ── Modale transfert d'un shift vers un autre établissement ──────────────────

function openTransferShiftModal(shift) {
    const fmt = h => h == null ? '' : String(Math.floor(h % 24)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');

    const venueOptions = allEstablishments
        .filter(e => e.id !== shift.establishment_id)
        .map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`)
        .join('');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';

    overlay.innerHTML =
        '<div style="background:white;border-radius:14px;padding:24px;max-width:340px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
                '<span style="width:10px;height:10px;border-radius:50%;background:' + (shift.color || '#888') + ';flex-shrink:0;display:inline-block"></span>' +
                '<p style="font-size:14px;font-weight:700;color:#1a1a2e">' + escapeHtml(displayName(shift.staff_id, shift.staff_name)) + '</p>' +
                '<span style="font-size:12px;color:#aaa;margin-left:auto">' + fmt(shift.start_time) + ' → ' + fmt(shift.end_time) + '</span>' +
            '</div>' +
            '<div style="margin-bottom:14px">' +
                '<div style="font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Établissement cible</div>' +
                '<select id="_cs-venue" style="width:100%;padding:9px 10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:13px;color:#1a1a2e;background:#f8f8f8">' + venueOptions + '</select>' +
            '</div>' +
            '<div style="margin-bottom:18px">' +
                '<div style="font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Date cible</div>' +
                '<input id="_cs-date" type="date" value="' + shift.date + '" style="width:100%;padding:9px 10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:13px;color:#1a1a2e;background:#f8f8f8">' +
            '</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_cs-cancel"  style="padding:8px 16px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:13px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_cs-confirm" style="padding:8px 16px;border-radius:8px;border:none;background:#1a1a2e;color:white;font-size:13px;font-weight:600;cursor:pointer">Transférer</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);

    overlay.querySelector('#_cs-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_cs-confirm').addEventListener('click', async () => {
        const targetEstabId = overlay.querySelector('#_cs-venue').value;
        const targetDate    = overlay.querySelector('#_cs-date').value;
        if (!targetEstabId || !targetDate) { showToast('Champs manquants', true); return; }

        const btn = overlay.querySelector('#_cs-confirm');
        btn.disabled    = true;
        btn.textContent = 'Transfert…';

        try {
            const res = await fetch('/api/shifts/' + shift._id + '/transfer', {
                method: 'PATCH', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ establishment_id: targetEstabId, date: targetDate }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const s = currentShifts.find(s => String(s._id) === String(shift._id));
            if (s) { s.establishment_id = targetEstabId; s.date = targetDate; }
            const targetName = allEstablishments.find(e => e.id === targetEstabId)?.name || targetEstabId;
            close();
            showToast('Shift transféré vers ' + targetName);
            await refreshWeek();
        } catch (err) {
            showToast(err.message || 'Erreur', true);
            btn.disabled    = false;
            btn.textContent = 'Transférer';
        }
    });
}

// ── Modale remplacement d'un staff sur un shift ───────────────────────────────

function openReplaceStaffModal(shift) {
    const staffOptions = allStaff
        .filter(s => String(s._id) !== String(shift.staff_id))
        .map(s => `<option value="${escapeHtml(String(s._id))}" data-color="${escapeHtml(s.color || '#888')}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
        .join('');

    if (!staffOptions) { showToast('Aucun autre membre disponible', true); return; }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';

    overlay.innerHTML =
        '<div style="background:white;border-radius:14px;padding:24px;max-width:340px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:4px">Remplacer</p>' +
            '<p style="font-size:12px;color:#aaa;margin-bottom:16px">' + escapeHtml(displayName(shift.staff_id, shift.staff_name)) + ' → choisir le remplaçant</p>' +
            '<div style="margin-bottom:20px">' +
                '<select id="_rep-staff" style="width:100%;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:13px;color:#1a1a2e;background:#f8f8f8">' +
                    '<option value="">— Sélectionner —</option>' + staffOptions +
                '</select>' +
            '</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_rep-cancel"  style="padding:8px 16px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:13px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_rep-confirm" style="padding:8px 16px;border-radius:8px;border:none;background:#27ae60;color:white;font-size:13px;font-weight:600;cursor:pointer">Remplacer</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);

    overlay.querySelector('#_rep-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_rep-confirm').addEventListener('click', async () => {
        const sel = overlay.querySelector('#_rep-staff');
        const newStaffId = sel.value;
        if (!newStaffId) { showToast('Sélectionne un remplaçant', true); return; }
        const opt = sel.options[sel.selectedIndex];
        const newName  = opt.dataset.name;
        const newColor = opt.dataset.color;

        const btn = overlay.querySelector('#_rep-confirm');
        btn.disabled    = true;
        btn.textContent = 'En cours…';

        try {
            const res = await fetch('/api/shifts/' + shift._id, {
                method: 'PATCH', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staff_id: newStaffId, staff_name: newName, color: newColor }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const s = currentShifts.find(s => String(s._id) === String(shift._id));
            if (s) { s.staff_id = newStaffId; s.staff_name = newName; s.color = newColor; }
            close();
            showToast(newName + ' remplace ' + shift.staff_name);
            await refreshWeek();
        } catch (err) {
            showToast(err.message || 'Erreur', true);
            btn.disabled    = false;
            btn.textContent = 'Remplacer';
        }
    });
}

// ── Modale heures réelles (côté patron) ──────────────────────────────────────


function openRealHoursModal(shift, shiftEl) {
    const fmt     = h => h == null ? '' : String(Math.floor(h % 24)).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
    const fmtDisp = h => h == null ? '—' : String(Math.floor(h % 24)).padStart(2, '0') + 'h' + String(Math.round((h % 1) * 60)).padStart(2, '0');

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

    const iconBtn = 'width:30px;height:30px;border-radius:7px;border:1px solid #e0e0e0;background:white;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1;transition:all 0.15s';
    overlay.innerHTML =
        '<div style="background:white;border-radius:14px;padding:20px 22px;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
            // Header : nom + actions secondaires à droite
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
                '<span style="width:10px;height:10px;border-radius:50%;background:' + (shift.color || '#888') + ';flex-shrink:0;display:inline-block"></span>' +
                '<p style="font-size:14px;font-weight:700;color:#1a1a2e;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + shift.staff_name + '</p>' +
                '<button id="_rh-replace" title="Remplacer le staff" style="' + iconBtn + ';color:#27ae60;border-color:#a7e0c0">↔</button>' +
                '<button id="_rh-copy"    title="Transférer vers un autre établissement" style="' + iconBtn + ';color:#6C63FF;border-color:#c5beff">→</button>' +
            '</div>' +
            '<p style="font-size:12px;color:#888;margin-bottom:18px;padding-left:18px">Planifié : <strong style="color:#555">' + fmtDisp(shift.start_time) + ' → ' + fmtDisp(shift.end_time) + '</strong></p>' +
            // Section heures réelles
            '<div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Heures réelles</div>' +
            '<div id="_rh-time-row" style="display:flex;gap:10px;margin-bottom:10px">' +
                '<div style="flex:1;min-width:0">' +
                    '<div style="font-size:10px;color:#aaa;font-weight:600;margin-bottom:4px">Début</div>' +
                    '<input id="_rh-start" type="time" value="' + fmt(shift.real_start) + '" style="width:100%;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:16px;font-weight:600;outline:none;background:#fafbfc;color:#1a1a2e">' +
                '</div>' +
                '<div style="flex:1;min-width:0">' +
                    '<div style="font-size:10px;color:#aaa;font-weight:600;margin-bottom:4px">Fin</div>' +
                    '<input id="_rh-end" type="time" value="' + fmt(shift.real_end) + '" style="width:100%;padding:10px 12px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:16px;font-weight:600;outline:none;background:#fafbfc;color:#1a1a2e">' +
                '</div>' +
            '</div>' +
            '<div id="_rh-ecart" style="text-align:center;font-size:12px;color:#aaa;min-height:18px;margin-bottom:18px;font-weight:600"></div>' +
            // Actions principales : effacer (gauche) + annuler + enregistrer (droite)
            '<div style="display:flex;gap:8px;align-items:center">' +
                '<button id="_rh-clear"  style="padding:9px 14px;border-radius:8px;border:none;background:transparent;font-size:12px;cursor:pointer;color:#e74c3c;text-decoration:underline">Effacer</button>' +
                '<div style="flex:1"></div>' +
                '<button id="_rh-cancel" style="padding:10px 18px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:13px;cursor:pointer;color:#555;font-family:inherit">Annuler</button>' +
                '<button id="_rh-save"   style="padding:10px 22px;border-radius:8px;border:none;background:#6C63FF;color:white;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(108,99,255,0.30)">Enregistrer</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);

    // Augmenter l'écart et la taille en portrait mobile
    if (window.innerWidth <= 600 && window.innerHeight > window.innerWidth) {
        const row = overlay.querySelector('#_rh-time-row');
        row.style.gap = '20px';
        row.style.paddingRight = '8px';
        row.querySelectorAll('div[style*="flex:1"]').forEach(g => { g.style.minWidth = '0'; });
        row.querySelectorAll('input[type="time"]').forEach(i => { i.style.fontSize = '18px'; });
    }

    const startInput = overlay.querySelector('#_rh-start');
    const endInput   = overlay.querySelector('#_rh-end');
    const ecartEl    = overlay.querySelector('#_rh-ecart');

    // Blocage si service pas terminé (sauf extra)
    if (!shift.extra) {
        const now = new Date();
        const nowFloat = now.getHours() + now.getMinutes() / 60;
        const shiftDate = shift.date || selectedDate;
        const todayStr  = toDateStr(now);
        let serviceFinished = true;
        if (shiftDate === todayStr) {
            if (shift.end_time > 24) {
                serviceFinished = false;
            } else {
                serviceFinished = nowFloat >= shift.end_time;
            }
        } else if (shiftDate > todayStr) {
            serviceFinished = false;
        } else {
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            if (toDateStr(yesterday) === shiftDate && shift.end_time > 24) {
                serviceFinished = nowFloat >= (shift.end_time - 24);
            }
        }
        if (!serviceFinished) {
            startInput.disabled = true;
            endInput.disabled   = true;
            overlay.querySelector('#_rh-save').disabled = true;
            overlay.querySelector('#_rh-save').style.background = '#ccc';
            overlay.querySelector('#_rh-clear').disabled = true;
            const endH = Math.floor(shift.end_time % 24);
            const endM = Math.round((shift.end_time % 1) * 60);
            const endLabel = String(endH).padStart(2,'0') + 'h' + (endM > 0 ? String(endM).padStart(2,'0') : '00');
            ecartEl.textContent = 'Service en cours jusqu\'à ' + endLabel;
            ecartEl.style.color = '#f39c12';
        }
    }

    function parseT(val, ref) {
        if (!val) return null;
        const [h, m] = val.split(':').map(Number);
        let r = h + m / 60;
        if (ref != null && r < ref) r += 24;
        return r;
    }

    function updateEcart() {
        const rs = parseT(startInput.value);
        const re = parseT(endInput.value, rs);
        if (rs != null && re != null && re > rs) {
            const realDur    = re - rs;
            const plannedDur = shift.end_time - shift.start_time;
            const diff = realDur - plannedDur;
            if (Math.abs(diff) < 0.01) { ecartEl.textContent = '= planifié'; ecartEl.style.color = '#27ae60'; }
            else {
                const mins = Math.round(Math.abs(diff) * 60);
                const h = Math.floor(mins / 60), m = mins % 60;
                const str = (h ? h + 'h' : '') + (m ? String(m).padStart(2,'0') + 'min' : '');
                ecartEl.textContent = diff > 0 ? '+' + str + ' vs planifié' : '−' + str + ' vs planifié';
                ecartEl.style.color = diff > 0 ? '#d68910' : '#c0392b';
            }
        } else { ecartEl.textContent = ''; }
    }

    startInput.addEventListener('input', updateEcart);
    endInput.addEventListener('input',   updateEcart);
    updateEcart();

    overlay.querySelector('#_rh-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_rh-replace').addEventListener('click', () => { close(); openReplaceStaffModal(shift); });

    const rhCopyBtn = overlay.querySelector('#_rh-copy');
    if (allEstablishments.length <= 1) rhCopyBtn.style.display = 'none';
    rhCopyBtn.addEventListener('click', () => { close(); openTransferShiftModal(shift); });

    overlay.querySelector('#_rh-clear').addEventListener('click', async () => {
        try {
            await fetch('/api/shifts/' + shift._id + '/pointage', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ real_start: null, real_end: null }),
            });
            shift.real_start = null; shift.real_end = null;
            close();
            showToast('Heures réelles effacées');
            if (selectedDate) await loadDayDetail(selectedDate);
        } catch (e) { showToast(e.message, true); }
    });

    overlay.querySelector('#_rh-save').addEventListener('click', async () => {
        const rs = parseT(startInput.value);
        const re = parseT(endInput.value, rs);
        if (rs == null && re == null) { showToast('Saisis au moins une heure', true); return; }
        try {
            const r = await fetch('/api/shifts/' + shift._id + '/pointage', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ real_start: rs, real_end: re }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            shift.real_start = rs; shift.real_end = re;
            // Recharger le jour pour repositionner tous les shifts
            close();
            showToast(shift.staff_name + ' — heures réelles enregistrées');
            if (selectedDate) await loadDayDetail(selectedDate);
        } catch (e) { showToast(e.message, true); }
    });
}

// ── Drop zone (listener unique) ────────────────────────────────────────────────

function initDropZone() {
    // On s'attache sur .day-detail (conteneur stable, jamais recréé)
    // plutôt que sur #timeline-body qui est vidé/recréé à chaque renderBody()
    const container = document.getElementById('day-detail');

    container.addEventListener('dragover', e => {
        if (!draggedStaff) return;
        // Survol d'un shift Joker par un vrai staff → highlight d'assignation
        const jokerShift = e.target.closest('.shift-joker');
        if (jokerShift && !draggedStaff.isJoker) {
            e.preventDefault();
            document.querySelectorAll('.shift-joker').forEach(s => s.classList.remove('joker-target'));
            document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
            jokerShift.classList.add('joker-target');
            return;
        }
        document.querySelectorAll('.shift-joker').forEach(s => s.classList.remove('joker-target'));
        const rail = e.target.closest('.row-rail');
        if (rail) {
            e.preventDefault();
            document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
            rail.classList.add('drag-over');
        } else if (e.target.closest('#timeline-body')) {
            e.preventDefault();
        }
    });

    container.addEventListener('dragleave', e => {
        if (!container.contains(e.relatedTarget)) {
            document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
            document.querySelectorAll('.shift-joker').forEach(s => s.classList.remove('joker-target'));
        }
    });

    container.addEventListener('drop', async e => {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
        document.querySelectorAll('.shift-joker').forEach(s => s.classList.remove('joker-target'));
        document.getElementById('drop-hint').classList.remove('visible');
        if (!draggedStaff) return;

        if (!selectedDate) {
            showToast('Sélectionne un jour dans la semaine d\'abord', true);
            return;
        }

        // Drop sur un shift Joker existant → assignation du staff
        const jokerShift = e.target.closest('.shift-joker');
        if (jokerShift && !draggedStaff.isJoker) {
            await assignStaffToJoker(draggedStaff, jokerShift);
            return;
        }

        const rail = e.target.closest('.row-rail');
        let startTime, endTime;

        if (rail) {
            const rect = rail.getBoundingClientRect();
            const rawH     = (e.clientX - rect.left) / PX_PER_HOUR;
            const snappedH = Math.round(rawH * 4) / 4 + START_HOUR; // snap 15 min
            startTime = Math.max(OPEN_TIME, Math.min(snappedH, CLOSE_TIME - 0.25));
            endTime   = Math.min(startTime + 2, CLOSE_TIME);
        } else {
            startTime = 18; endTime = 20;
        }

        await createShift(draggedStaff, startTime, endTime);
    });
}

function onSidebarDragStart(e, staff, card) {
    draggedStaff = staff;
    card.classList.add('dragging');
    document.getElementById('drop-hint').classList.add('visible');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', staff._id);
}

function onSidebarDragEnd(card) {
    card.classList.remove('dragging');
    draggedStaff = null;
    document.getElementById('drop-hint').classList.remove('visible');
    document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
}

// ── Créer un shift ────────────────────────────────────────────────────────────

let _createShiftPending = false; // anti-doublon drop

// ── Assigner un staff à un shift Joker ───────────────────────────────────────

async function assignStaffToJoker(staff, jokerEl) {
    const shiftId = jokerEl.dataset.id;
    const shift   = currentShifts.find(s => String(s._id) === shiftId);
    if (!shift) { showToast('Shift introuvable', true); return; }

    // Trouver la vraie couleur du staff depuis allStaff
    const staffMember = allStaff.find(s => String(s._id) === String(staff._id));
    const staffColor  = staffMember ? staffMember.color : (staff.color || '#3498db');

    try {
        const res = await fetch(`/api/shifts/${shiftId}`, {
            method:      'PATCH',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                staff_id:   String(staff._id),
                staff_name: staff.name,
                color:      staffColor,
                is_joker:   false,
                start_time: shift.start_time,
                end_time:   shift.end_time,
            }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Erreur', true); return; }

        // Mettre à jour currentShifts en mémoire
        shift.staff_id   = String(staff._id);
        shift.staff_name = staff.name;
        shift.color      = staffColor;
        shift.is_joker   = false;

        // Retrouver la ligne Joker dans displayedStaff
        // La ligne Joker a _id = shiftId (voir buildDisplayedStaff)
        const jokerRowIdx = displayedStaff.findIndex(s => s.isJoker && s._id === shiftId);
        if (jokerRowIdx !== -1) {
            // Remplacer la ligne Joker par la ligne du vrai staff
            const existingRow = displayedStaff.find(s => s._id === String(staff._id) && !s.isJoker);
            if (existingRow) {
                // Le staff a déjà une ligne — retirer la ligne Joker
                displayedStaff.splice(jokerRowIdx, 1);
            } else {
                // Transformer la ligne Joker en ligne staff réelle
                displayedStaff[jokerRowIdx] = {
                    _id:   String(staff._id),
                    name:  staff.name,
                    color: staffColor,
                };
            }
        }

        // Mettre à jour weekFullData aussi
        if (weekFullData[selectedDate]) {
            const wIdx = weekFullData[selectedDate].findIndex(s => String(s._id) === shiftId);
            if (wIdx !== -1) {
                weekFullData[selectedDate][wIdx].staff_id   = String(staff._id);
                weekFullData[selectedDate][wIdx].staff_name = staff.name;
                weekFullData[selectedDate][wIdx].color      = staffColor;
                weekFullData[selectedDate][wIdx].is_joker   = false;
            }
        }
        currentShiftsWeek = Object.values(weekFullData).flat();

        if (data.warnings?.length) showConflictAlert(data.warnings, staff.name);

        // Re-rendre la timeline
        renderBody();
        renderWeekGrid();
        renderStats();
        showToast(staff.name + ' assigné au shift Joker');
    } catch { showToast('Erreur réseau', true); }
}

// ── Modale patron Joker : note + toggle open + candidatures ──────────────────

async function openJokerModal(shift, el) {
    if (window._jokerPollTimer) { clearInterval(window._jokerPollTimer); window._jokerPollTimer = null; }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
    const box = document.createElement('div');
    box.style.cssText = 'background:white;border-radius:14px;padding:20px;max-width:400px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18);max-height:88vh;overflow-y:auto';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() {
        if (window._jokerPollTimer) { clearInterval(window._jokerPollTimer); window._jokerPollTimer = null; }
        overlay.remove();
    }
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const fmtH = ShiftHours.fmtHourOfDay;

    function renderCandidatesList() {
        const cList = box.querySelector('#_jk-candidates');
        if (!cList) return;
        const candidates = (shift.joker_candidates || []).slice().sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
        if (candidates.length === 0) {
            cList.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:8px 0">Aucune candidature pour l\'instant</p>';
            return;
        }
        cList.innerHTML = candidates.map(c => {
            const t = new Date(c.submitted_at);
            const timeStr = String(t.getHours()).padStart(2, '0') + 'h' + String(t.getMinutes()).padStart(2, '0');
            return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f5f5f5">' +
                '<span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(c.staff_color || '#888') + ';flex-shrink:0;display:inline-block"></span>' +
                '<span style="flex:1;font-size:13px;font-weight:600;color:#1a1a2e">' + escapeHtml(c.staff_name || '?') + '</span>' +
                '<span style="font-size:11px;color:#aaa">à ' + timeStr + '</span>' +
                '<button class="btn-assign-cand" data-staff-id="' + escapeHtml(c.staff_id) + '" data-staff-name="' + escapeHtml(c.staff_name || '') + '" data-staff-color="' + escapeHtml(c.staff_color || '#888') + '" style="background:#534AB7;color:white;border:none;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer">Assigner</button>' +
                '</div>';
        }).join('');
        cList.querySelectorAll('.btn-assign-cand').forEach(btn => {
            btn.addEventListener('click', async () => {
                const fakeEl  = { dataset: { id: String(shift._id) } };
                const staffObj = { _id: btn.dataset.staffId, name: btn.dataset.staffName, color: btn.dataset.staffColor };
                await assignStaffToJoker(staffObj, fakeEl);
                close();
            });
        });
    }

    function buildBox() {
        const isOpen = !!shift.joker_open;
        box.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
                '<span style="font-size:15px;font-weight:700;color:#1a1a2e">⚡ Créneau Joker</span>' +
                '<button id="_jk-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#aaa;line-height:1">&times;</button>' +
            '</div>' +
            '<div style="font-size:13px;color:#888;margin-bottom:16px">' + fmtH(shift.start_time) + ' – ' + fmtH(shift.end_time) + '</div>' +
            '<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:12px;background:' + (isOpen ? '#f0effe' : '#f8f8f8') + ';border-radius:10px;border:1.5px solid ' + (isOpen ? '#534AB7' : '#e0e0e0') + ';margin-bottom:14px;user-select:none">' +
                '<input type="checkbox" id="_jk-toggle" ' + (isOpen ? 'checked' : '') + ' style="width:16px;height:16px;accent-color:#534AB7;cursor:pointer">' +
                '<div><div style="font-size:13px;font-weight:600;color:#1a1a2e">📢 Proposer au staff</div>' +
                '<div style="font-size:11px;color:#888;margin-top:2px">Notifie le staff et ouvre les candidatures</div></div>' +
            '</label>' +
            (isOpen
                ? '<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Candidatures</div><div id="_jk-candidates"></div></div>'
                : '') +
            '<div style="margin-bottom:14px">' +
                '<div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Note</div>' +
                '<textarea id="_jk-note" style="width:100%;height:72px;border:1.5px solid #e0e0e0;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box" placeholder="Note sur ce créneau…">' + escapeHtml(shift.note || '') + '</textarea>' +
            '</div>' +
            '<div style="display:flex;justify-content:flex-end">' +
                '<button id="_jk-save" style="background:#534AB7;color:white;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer">Enregistrer note</button>' +
            '</div>';

        box.querySelector('#_jk-close').addEventListener('click', close);

        if (isOpen) renderCandidatesList();

        box.querySelector('#_jk-toggle').addEventListener('change', async (ev) => {
            const open = ev.target.checked;
            ev.target.disabled = true;
            try {
                const r = await fetch('/api/shifts/' + shift._id + '/joker-open', {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ open }),
                });
                if (!r.ok) {
                    let msg = 'Erreur ' + r.status;
                    try { const j = await r.json(); msg = j.error || msg; } catch {}
                    throw new Error(msg);
                }
                shift.joker_open = open;
                if (!open) shift.joker_candidates = [];
                // Mettre à jour le badge sur le bloc timeline
                const shiftEl2 = document.querySelector('.shift[data-id="' + shift._id + '"]');
                if (shiftEl2) {
                    const badge = shiftEl2.querySelector('.joker-open-badge');
                    if (open && !badge) {
                        const b = document.createElement('span');
                        b.className = 'joker-open-badge';
                        b.textContent = '📢 Ouvert';
                        shiftEl2.querySelector('.shift-hours').after(b);
                    } else if (!open && badge) { badge.remove(); }
                }
                showToast(open ? 'Notification envoyée au staff !' : 'Propositions désactivées');
                close();
                openJokerModal(shift, el);
            } catch (err) { showToast(err.message || 'Erreur', true); ev.target.checked = !open; ev.target.disabled = false; }
        });

        box.querySelector('#_jk-save').addEventListener('click', async () => {
            const note = box.querySelector('#_jk-note').value;
            try {
                const r = await fetch('/api/shifts/' + shift._id, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note }),
                });
                if (!r.ok) throw new Error((await r.json()).error);
                shift.note = note;
                const noteSpan = el.querySelector('.shift-note-text');
                if (note) {
                    const safe = note.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    if (noteSpan) noteSpan.innerHTML = safe;
                    else {
                        const span = document.createElement('span');
                        span.className = 'shift-note-text';
                        span.innerHTML = safe;
                        el.querySelector('.shift-hours').after(span);
                    }
                    el.classList.add('has-note');
                } else {
                    if (noteSpan) noteSpan.remove();
                    el.classList.remove('has-note');
                }
                showToast(note ? 'Note enregistrée' : 'Note effacée');
            } catch (err) { showToast(err.message || 'Erreur', true); }
        });
    }

    buildBox();

    // Polling 30s si ouvert — rafraîchir la liste des candidatures
    if (shift.joker_open) {
        window._jokerPollTimer = setInterval(async () => {
            if (!document.body.contains(overlay)) {
                clearInterval(window._jokerPollTimer); window._jokerPollTimer = null; return;
            }
            try {
                const r = await fetch('/api/shifts/' + shift._id, { credentials: 'include' });
                if (r.ok) {
                    const fresh = await r.json();
                    shift.joker_candidates = fresh.joker_candidates || [];
                    renderCandidatesList();
                }
            } catch { /* silencieux */ }
        }, 30000);
    }
}

// ── Note sur un shift Joker ───────────────────────────────────────────────────

async function openJokerNoteModal(shift, el) {
    showNotePrompt(
        '📝 Note sur ce créneau Joker',
        shift.note || '',
        async (note) => {
            try {
                const res = await fetch('/api/shifts/' + shift._id, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note }),
                });
                if (!res.ok) { showToast('Erreur lors de la sauvegarde', true); return; }
                shift.note = note;
                // Mettre à jour le texte note dans le DOM sans re-rendre tout le shift
                const existing = el.querySelector('.shift-note-text');
                if (note) {
                    const safe = note.replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    if (existing) { existing.innerHTML = safe; }
                    else {
                        const span = document.createElement('span');
                        span.className   = 'shift-note-text';
                        span.innerHTML   = safe;
                        el.querySelector('.shift-hours').after(span);
                    }
                    el.classList.add('has-note');
                } else {
                    if (existing) existing.remove();
                    el.classList.remove('has-note');
                }
                showToast(note ? 'Note enregistrée' : 'Note effacée');
            } catch { showToast('Erreur réseau', true); }
        }
    );
}

async function createShift(staff, startTime, endTime) {
    if (_createShiftPending) return;
    _createShiftPending = true;
    try {
        // Pour un Joker : staff_id = '__joker__', nom unique (Joker 1, Joker 2…)
        const staffId   = staff.isJoker ? '__joker__' : staff._id;

        // Blocage congé : confirmation requise avant d'assigner un staff en congé ce jour
        if (staffId !== '__joker__' && dayLeaveStaffIds.has(String(staffId))) {
            const proceed = await new Promise(resolve => {
                showConfirm(
                    '🌴 <strong>' + staff.name + '</strong> est en congé ce jour. L\'assigner quand même ?',
                    () => resolve(true), () => resolve(false));
            });
            if (!proceed) return;
        }

        // Avertissement non bloquant si jour de repos
        if (staffId !== '__joker__') {
            const staffMem = allStaff.find(s => String(s._id) === String(staffId));
            if (staffMem?.rest_days?.length) {
                const d = new Date(selectedDate + 'T12:00:00');
                if (staffMem.rest_days.includes(d.getDay())) {
                    showToast('⚠️ ' + staff.name + ' est en repos ce jour', true);
                }
            }
        }
        const staffName = staff.name; // déjà "Joker 1", "Joker 2"... ou le vrai nom
        const res = await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                staff_id: staffId, staff_name: staffName,
                establishment_id: currentVenueId, date: selectedDate,
                start_time: startTime, end_time: endTime,
                color: staff.color,
                is_joker: !!staff.isJoker,
            }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Erreur création', true); return; }
        if (data.warnings?.length) showConflictAlert(data.warnings, staff.name);

        currentShifts.push(data);

        if (staff.isJoker) {
            // Chaque Joker a une ligne dédiée identifiée par son shift_id
            data._joker_row_id = String(data._id);
            const jokerStaff = { _id: data._joker_row_id, name: staffName, color: staff.color, isJoker: true };
            displayedStaff.push(jokerStaff);
            renderBody();
        } else if (!displayedStaff.find(s => s._id === staff._id)) {
            displayedStaff.push({ _id: staff._id, name: staff.name, color: staff.color });
            renderBody();
        } else {
            const rail = document.querySelector(`.row-rail[data-staff-id="${staff._id}"]`);
            if (rail) rail.appendChild(createShiftEl(data));
        }

        // Mettre à jour le résumé semaine ET weekFullData
        weekSummary[selectedDate] = (weekSummary[selectedDate] || 0) + 1;
        if (!weekFullData[selectedDate]) weekFullData[selectedDate] = [];
        weekFullData[selectedDate].push(data);
        currentShiftsWeek = Object.values(weekFullData).flat();
        renderWeekGrid();
        renderStats();
        showToast(`${staff.name} ajouté`);
    } catch { showToast('Erreur réseau', true); }
    finally { _createShiftPending = false; }
}

// ── Supprimer un shift ────────────────────────────────────────────────────────

async function deleteShift(e, shiftId, staffId) {
    e.stopPropagation();
    try {
        await fetch(`/api/shifts/${shiftId}`, { method: 'DELETE', credentials: 'include' });
        currentShifts = currentShifts.filter(s => String(s._id) !== String(shiftId));

        // ── FIX : pour un Joker, la ligne displayedStaff a _id = shiftId
        const isJokerRow = staffId === '__joker__';
        const rowId      = isJokerRow ? shiftId : staffId;

        if (isJokerRow || !currentShifts.find(s => s.staff_id === staffId)) {
            displayedStaff = displayedStaff.filter(s => s._id !== rowId);
            renderBody();
        } else {
            document.querySelector(`.shift[data-id="${shiftId}"]`)?.remove();
        }

        weekSummary[selectedDate] = Math.max(0, (weekSummary[selectedDate] || 1) - 1);
        if (weekFullData[selectedDate]) {
            weekFullData[selectedDate] = weekFullData[selectedDate].filter(s => String(s._id) !== String(shiftId));
        }
        currentShiftsWeek = Object.values(weekFullData).flat();
        renderWeekGrid();
        renderStats();
        showToast('Shift supprimé');
    } catch { showToast('Erreur suppression', true); }
}

async function removeStaffFromDay(rowId) {
    // Pour un Joker, rowId = _id du shift. Pour le staff normal, rowId = staff_id.
    const isJokerRow = displayedStaff.find(s => s._id === rowId && s.isJoker);
    let toDelete;
    if (isJokerRow) {
        // Supprimer uniquement le shift dont l'_id correspond
        toDelete = currentShifts.filter(s => String(s._id) === rowId);
    } else {
        toDelete = currentShifts.filter(s => s.staff_id === rowId);
    }
    for (const s of toDelete) await fetch(`/api/shifts/${s._id}`, { method: 'DELETE', credentials: 'include' });
    if (isJokerRow) {
        currentShifts  = currentShifts.filter(s => String(s._id) !== rowId);
    } else {
        currentShifts  = currentShifts.filter(s => s.staff_id !== rowId);
    }
    displayedStaff = displayedStaff.filter(s => s._id !== rowId);
    weekSummary[selectedDate] = Math.max(0, (weekSummary[selectedDate] || toDelete.length) - toDelete.length);
    if (weekFullData[selectedDate]) {
        weekFullData[selectedDate] = weekFullData[selectedDate].filter(s =>
            isJokerRow ? String(s._id) !== rowId : s.staff_id !== rowId
        );
    }
    currentShiftsWeek = Object.values(weekFullData).flat();
    renderBody();
    renderWeekGrid();
    renderStats();
    showToast('Retiré du planning');
}

// ── Drag & resize shifts ──────────────────────────────────────────────────────

document.addEventListener('mousedown', e => {
    if (_touchActive) return; // ignore les mousedown synthétiques émis après touchstart sur Android
    const shiftEl = e.target.closest('.shift');
    if (!shiftEl || e.target.closest('.shift-delete') || e.target.closest('.shift-resp-btn')) return;
    refreshPxPerHour();

    _shiftWasDragged = false; // réinitialiser au début de chaque interaction
    activeEl   = shiftEl;
    startX     = e.clientX;
    startLeft  = activeEl.offsetLeft;
    startWidth = activeEl.offsetWidth;

    const isLeft  = e.target.closest('.resizer.left');
    const isRight = e.target.closest('.resizer.right');
    activeAction = isLeft ? 'res-left' : isRight ? 'res-right' : 'drag';

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    e.preventDefault();
});

function onMove(e) {
    if (!activeEl) return;
    _shiftWasDragged = true; // un mouvement réel a eu lieu → bloquer le click suivant
    const deltaX = e.clientX - startX;
    const SNAP   = PX_PER_HOUR / 4; // 15 minutes
    const snapX  = Math.round(deltaX / SNAP) * SNAP;
    const maxW   = TOTAL_HOURS * PX_PER_HOUR;

    const minL = (OPEN_TIME - START_HOUR) * PX_PER_HOUR; // borne gauche = heure d'ouverture

    if (activeAction === 'res-right') {
        const newW = startWidth + snapX;
        if (newW >= PX_PER_HOUR / 4 && startLeft + newW <= maxW) activeEl.style.width = newW + 'px';
    } else if (activeAction === 'res-left') {
        const newL = startLeft + snapX, newW = startWidth - snapX;
        if (newW >= PX_PER_HOUR / 4 && newL >= minL) { activeEl.style.left = newL + 'px'; activeEl.style.width = newW + 'px'; }
    } else {
        const newL = startLeft + snapX;
        if (newL >= minL && newL + activeEl.offsetWidth <= maxW) activeEl.style.left = newL + 'px';
    }
    updateShiftText(activeEl);
}

async function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    if (!activeEl) return;

    // Anti-doublon : ignorer si un save est déjà en cours sur cet élément
    if (activeEl.dataset.saving) { activeEl = null; activeAction = null; return; }
    activeEl.dataset.saving = '1';
    activeEl.style.opacity  = '0.6';

    const el        = activeEl; // capturer avant reset
    const id        = el.dataset.id;
    // Arrondi au quart d'heure — on travaille en quarts entiers pour éviter les erreurs flottantes
    const snapH      = PX_PER_HOUR / 4;
    const startQuart = Math.round(el.offsetLeft / snapH);
    const widthQuart = Math.round(el.offsetWidth / snapH);
    const startTime  = START_HOUR + startQuart / 4;
    const endTime    = START_HOUR + (startQuart + widthQuart) / 4;

    activeEl = null; activeAction = null;

    try {
        const res  = await fetch(`/api/shifts/${id}`, {
            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_time: startTime, end_time: endTime }),
        });
        const data = await res.json();
        if (data.warnings?.length) {
            const shift = currentShifts.find(s => String(s._id) === String(id));
            showConflictAlert(data.warnings, shift?.staff_name || '');
            el.classList.add('conflict');
        } else {
            el.classList.remove('conflict');
        }
        const idx = currentShifts.findIndex(s => String(s._id) === String(id));
        if (idx !== -1) { 
            currentShifts[idx].start_time = startTime; 
            currentShifts[idx].end_time = endTime; 
            // ── FIX : synchroniser weekFullData
            if (weekFullData[selectedDate]) {
                const wIdx = weekFullData[selectedDate].findIndex(s => String(s._id) === String(id));
                if (wIdx !== -1) {
                    weekFullData[selectedDate][wIdx].start_time = startTime;
                    weekFullData[selectedDate][wIdx].end_time   = endTime;
                }
            }
            currentShiftsWeek = Object.values(weekFullData).flat();
        }
        renderStats();
    } finally {
        el.style.opacity   = '';
        delete el.dataset.saving;
    }
}

// ── Touch events — resize & drag shifts ──────────────────────────────────────

let _touchScrollLeft = 0; // scrollLeft du conteneur au moment du touchstart
let _touchActive     = false; // bloque mousedown pendant un drag touch (évite double-déclenchement Android)
let _touchStartX     = 0;
let _touchStartY     = 0;
let _touchIntent     = null; // 'drag' | 'scroll' | null
const DRAG_THRESHOLD   = 8;  // px horizontal avant déclenchement drag
const SCROLL_THRESHOLD = 8;  // px vertical avant déclenchement scroll

document.addEventListener('touchstart', onTouchStart, { passive: false });
document.addEventListener('touchmove',  onTouchMove,  { passive: false });
document.addEventListener('touchend',   onTouchEnd);

function onTouchStart(e) {
    const shiftEl = e.target.closest('.shift');
    if (!shiftEl || e.target.closest('.shift-delete')) return;

    _touchActive     = true;
    _shiftWasDragged = false;
    refreshPxPerHour();
    const touch = e.touches[0];

    const scroller = document.getElementById('timeline-scroll');
    _touchScrollLeft = scroller ? scroller.scrollLeft : 0;

    activeEl     = shiftEl;
    startX       = touch.clientX;
    startLeft    = activeEl.offsetLeft;
    startWidth   = activeEl.offsetWidth;

    _touchStartX = touch.clientX;
    _touchStartY = touch.clientY;
    _touchIntent = null;

    const isLeft  = e.target.closest('.resizer.left');
    const isRight = e.target.closest('.resizer.right');
    activeAction  = isLeft ? 'res-left' : isRight ? 'res-right' : 'drag';

    // Resize : geste forcément horizontal, on déclenche le drag immédiatement
    if (isLeft || isRight) _touchIntent = 'drag';
}

function onTouchMove(e) {
    if (!activeEl) return;
    const touch = e.touches[0];

    // Détermine l'intention au premier mouvement significatif
    if (_touchIntent === null) {
        const deltaX = Math.abs(touch.clientX - _touchStartX);
        const deltaY = Math.abs(touch.clientY - _touchStartY);

        if (deltaX > DRAG_THRESHOLD && deltaX > deltaY) {
            _touchIntent = 'drag';
        } else if (deltaY > SCROLL_THRESHOLD && deltaY > deltaX) {
            _touchIntent = 'scroll';
            activeEl = null;
            activeAction = null;
            _touchActive = false;
            return; // laisser le scroll natif prendre la main
        } else {
            return; // intention pas encore décidée
        }
    }

    if (_touchIntent === 'scroll') return;

    if (_touchIntent === 'drag') {
        e.preventDefault();
        // Corriger le clientX avec le scroll courant du conteneur
        const scroller = document.getElementById('timeline-scroll');
        const scrollDelta = scroller ? (scroller.scrollLeft - _touchScrollLeft) : 0;
        onMove({ clientX: touch.clientX - scrollDelta });
    }
}

function onTouchEnd() {
    _touchIntent = null;
    _touchActive = false;
    if (!activeEl) return;

    if (!_shiftWasDragged) {
        // Simple tap sans mouvement → ouvrir la modale d'édition (le click natif est bloqué par preventDefault)
        const el = activeEl;
        activeEl = null;
        activeAction = null;
        el.click();
        return;
    }

    // Snap final : forcer left et width à des multiples de PX_PER_HOUR/4
    const SNAP = PX_PER_HOUR / 4;
    const snappedLeft  = Math.round(activeEl.offsetLeft  / SNAP) * SNAP;
    const snappedWidth = Math.max(SNAP, Math.round(activeEl.offsetWidth / SNAP) * SNAP);
    const maxW = TOTAL_HOURS * PX_PER_HOUR;
    const minL = (OPEN_TIME - START_HOUR) * PX_PER_HOUR;
    if (snappedLeft >= minL && snappedLeft + snappedWidth <= maxW) {
        activeEl.style.left  = snappedLeft  + 'px';
        activeEl.style.width = snappedWidth + 'px';
        updateShiftText(activeEl);
    }
    onUp();
}

function updateShiftText(el) {
    const display = el.querySelector('.shift-hours');
    if (!display) return;
    const hStart = START_HOUR + el.offsetLeft / PX_PER_HOUR;
    const hEnd   = hStart + el.offsetWidth / PX_PER_HOUR;
    const fmt = h => `${Math.floor(h % 24).toString().padStart(2, '0')}h${String(Math.round((h%1)*60)).padStart(2,'0')}`;
    display.textContent = `${fmt(hStart)} – ${fmt(hEnd)}`;
}

// ── Tap-to-place — sélection staff mobile ────────────────────────────────────

function tapSelectStaff(staff, card) {
    // Deuxième tap sur la même carte → désélection
    if (_tapSelectedStaff && _tapSelectedStaff._id === staff._id) {
        clearTapSelection();
        return;
    }

    // Désélectionner l'ancien si différent
    clearTapSelection();

    _tapSelectedStaff = staff;

    // Feedback visuel sur la carte
    card.classList.add('staff-tap-selected');

    // Afficher le bandeau
    showTapBanner(staff.name, staff.color);
}

function clearTapSelection() {
    _tapSelectedStaff = null;
    document.querySelectorAll('.staff-tap-selected').forEach(el => el.classList.remove('staff-tap-selected'));
    hideTapBanner();
}

function showTapBanner(name, color) {
    let banner = document.getElementById('tap-place-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'tap-place-banner';
        document.body.appendChild(banner);
    }
    banner.innerHTML =
        '<span style="width:10px;height:10px;border-radius:50%;background:' + (color || '#888') + ';flex-shrink:0;display:inline-block"></span>' +
        '<span style="flex:1"><strong>' + name + '</strong> — Tape sur une ligne pour placer</span>' +
        '<button id="tap-place-cancel" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;flex-shrink:0">✕</button>';
    banner.style.display = 'flex';
    banner.querySelector('#tap-place-cancel').addEventListener('click', clearTapSelection);
}

function hideTapBanner() {
    const banner = document.getElementById('tap-place-banner');
    if (banner) banner.style.display = 'none';
}

// ── Tap sur la zone vide du timeline-body (aucune ligne existante) ─────────────

function initTimelineBodyTap() {
    const body = document.getElementById('timeline-body');
    if (!body) return;

    body.addEventListener('touchend', async e => {
        if (!isMobileDevice() || !_tapSelectedStaff) return;
        // Ne traiter que si le tap est directement sur le body ou sur .empty-rail (timeline vide)
        // Pas sur un shift existant
        if (e.target.closest('.shift')) return;
        // Autoriser : body direct, empty-rail, row-rail
        const rail = e.target.closest('.row-rail');
        const isBody = !rail && (e.target === body || e.target.closest('.empty-rail'));
        if (!rail && !isBody) return;
        e.preventDefault();

        let startTime = 18, endTime = 20;

        if (rail) {
            // Calculer la position du tap dans le rail, en tenant compte du scroll
            const scroller = document.getElementById('timeline-scroll');
            const scrollLeft = scroller ? scroller.scrollLeft : 0;
            const touch = e.changedTouches[0];
            const rect  = rail.getBoundingClientRect();
            const rawH  = (touch.clientX - rect.left + scrollLeft) / PX_PER_HOUR;
            // snap 15 min
            const snapped = Math.round(rawH * 4) / 4 + START_HOUR;
            startTime = Math.max(OPEN_TIME, Math.min(snapped, CLOSE_TIME - 0.25));
            endTime   = Math.min(startTime + 2, CLOSE_TIME);
        }

        const staff = _tapSelectedStaff;
        clearTapSelection();
        await createShift(staff, startTime, endTime);
    }, { passive: false });
}


document.getElementById('btn-copy-day').addEventListener('click', () => {
    if (!currentShifts.length) { showToast('Aucun shift à copier', true); return; }
    openCopyModal();
});

function openCopyModal() {
    // Copie profonde des shifts pour édition
    copyShiftsBuffer = currentShifts.map(s => ({ ...s }));

    // Prévisualisation éditable
    const preview = document.getElementById('copy-shifts-preview');
    preview.innerHTML = '';
    copyShiftsBuffer.forEach((shift, idx) => {
        const fmt = h => `${Math.floor(h % 24).toString().padStart(2, '0')}:${String(Math.round((h%1)*60)).padStart(2,'0')}`;
        const row = document.createElement('div');
        row.className = 'copy-shift-row';
        row.innerHTML = `
            <span class="copy-shift-dot" style="background:${shift.color}"></span>
            <span class="copy-shift-name">${escapeHtml(displayName(shift.staff_id, shift.staff_name))}</span>
            <div class="copy-shift-time">
                <input class="copy-time-input" type="text" value="${fmt(shift.start_time)}" data-idx="${idx}" data-field="start">
                <span class="copy-shift-sep">→</span>
                <input class="copy-time-input" type="text" value="${fmt(shift.end_time)}" data-idx="${idx}" data-field="end">
            </div>`;
        preview.appendChild(row);
    });

    // Inputs → mise à jour buffer
    preview.querySelectorAll('.copy-time-input').forEach(input => {
        input.addEventListener('change', e => {
            const idx   = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            const val   = parseTimeInput(e.target.value);
            if (val !== null) {
                if (field === 'start') copyShiftsBuffer[idx].start_time = val;
                else                   copyShiftsBuffer[idx].end_time   = val;
                const rh = Math.floor(val % 24);
                const rm = Math.round((val % 1) * 60);
                e.target.value = `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}`;
            } else {
                showToast('Format invalide (ex: 18:00)', true);
            }
        });
    });

    // Sélecteur d'établissement cible
    const venueRow = document.getElementById('copy-target-venue-row');
    const venueSelect = document.getElementById('copy-target-venue');
    if (allEstablishments.length > 1) {
        venueSelect.innerHTML = allEstablishments.map(e =>
            `<option value="${e.id}"${e.id === currentVenueId ? ' selected' : ''}>${escapeHtml(e.name)}</option>`
        ).join('');
        venueRow.style.display = '';
    } else {
        venueRow.style.display = 'none';
    }

    // Grille des jours — semaine courante + semaine suivante
    const daysGrid = document.getElementById('copy-days-grid');
    daysGrid.innerHTML = '';

    const nextWeekStart = addDays(currentWeekStart, 7);

    [
        { label: 'Cette semaine',    weekStart: currentWeekStart },
        { label: 'Semaine suivante', weekStart: nextWeekStart    },
    ].forEach(({ label, weekStart }) => {
        const section = document.createElement('div');
        section.className = 'copy-week-section';

        const sectionLabel = document.createElement('div');
        sectionLabel.className = 'copy-week-label';
        sectionLabel.textContent = label;
        section.appendChild(sectionLabel);

        const grid = document.createElement('div');
        grid.className = 'copy-week-grid';

        for (let i = 0; i < 7; i++) {
            const date    = addDays(weekStart, i);
            const dateStr = toDateStr(date);
            const btn = document.createElement('button');
            btn.className    = 'copy-day-btn' + (dateStr === selectedDate ? ' source' : '');
            btn.dataset.date = dateStr;
            btn.innerHTML    = `<div>${DAY_NAMES_SHORT[date.getDay()]}</div><div>${date.getDate()}</div>`;
            if (dateStr !== selectedDate) {
                btn.addEventListener('click', () => btn.classList.toggle('selected'));
            }
            grid.appendChild(btn);
        }
        section.appendChild(grid);
        daysGrid.appendChild(section);
    });

    document.getElementById('copy-modal').style.display = 'flex';
}

function parseTimeInput(str) {
    const match = str.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return null;
    const h = parseInt(match[1]);
    const m = match[2] ? parseInt(match[2]) : 0;
    if (h < 0 || h > 26) return null;
    return h + m / 60;
}

document.getElementById('copy-modal-close').addEventListener('click',  closeCopyModal);
document.getElementById('copy-modal-cancel').addEventListener('click', closeCopyModal);

function closeCopyModal() {
    document.getElementById('copy-modal').style.display = 'none';
}

document.getElementById('copy-modal-confirm').addEventListener('click', async () => {
    const targetDates = Array.from(
        document.querySelectorAll('.copy-day-btn.selected')
    ).map(btn => btn.dataset.date);

    if (!targetDates.length) { showToast('Sélectionne au moins un jour cible', true); return; }

    const targetVenueId = document.getElementById('copy-target-venue').value || currentVenueId;

    try {
        const res = await fetch('/api/copy-day', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                establishment_id: targetVenueId,
                to_dates: targetDates,
                shifts: copyShiftsBuffer,
            }),
        });
        const data = await res.json();
        closeCopyModal();
        showToast(data.message || 'Copie effectuée');
        await refreshWeek();
    } catch { showToast('Erreur lors de la copie', true); }
});

// ── Vue semaine complète ─────────────────────────────────────────────────────

function renderWeekFull() {
    renderDashboard();
    renderAgenda();
    if (currentSubView === 'gantt') renderWeekGantt();
}

// ── Tableau de bord (lignes staff × colonnes jour) ────────────────────────────

function renderDashboard() {
    const wrap = document.getElementById('week-dashboard');
    wrap.innerHTML = '';

    const days = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(currentWeekStart, i);
        return { date: toDateStr(d), d };
    });

    // Construire la liste de staff présent cette semaine
    // shifts[date] est un tableau pour supporter plusieurs shifts le même jour
    const staffMap = new Map(); // staff_id → { name, color, shifts: { date: [shift, ...] } }
    days.forEach(({ date }) => {
        (weekFullData[date] || []).forEach(shift => {
            if (!staffMatchesCurrentGroup(shift.staff_id)) return;
            if (!staffMap.has(shift.staff_id)) {
                staffMap.set(shift.staff_id, {
                    _id: shift.staff_id, name: shift.staff_name,
                    color: shift.color, shifts: {}
                });
            }
            const entry = staffMap.get(shift.staff_id);
            if (!entry.shifts[date]) entry.shifts[date] = [];
            entry.shifts[date].push(shift);
        });
    });

    // Si aucun shift cette semaine
    if (staffMap.size === 0) {
        wrap.innerHTML = '<div style="padding:32px;text-align:center;color:#ccc;font-size:13px">Aucun shift cette semaine</div>';
        return;
    }

    const container = document.createElement('div');
    container.className = 'dashboard-wrap';

    const table = document.createElement('table');
    table.className = 'dashboard-table';

    // Header
    const thead = document.createElement('thead');
    let hRow = '<tr><th class="col-staff">Staff</th>';
    days.forEach(({ date, d }) => {
        const today = isToday(date);
        hRow += `<th class="${today ? 'col-today' : ''}">${DAY_NAMES_SHORT[d.getDay()]}<br>${d.getDate()}</th>`;
    });
    hRow += '<th>Total</th></tr>';
    thead.innerHTML = hRow;
    table.appendChild(thead);

    // Corps
    const tbody = document.createElement('tbody');
    const fmtD = v => {
        const hh = Math.floor(v % 24).toString().padStart(2,'0');
        const mm = Math.round((v % 1) * 60);
        return hh + 'h' + (mm > 0 ? String(mm).padStart(2,'0') : '');
    };
    const dayTotals = {};
    let accTotalH = 0;
    let accNbStaff = 0;
    staffMap.forEach(staff => {
        const tr = document.createElement('tr');
        let totalH = 0;
        if (staff._id !== '__joker__') accNbStaff++;

        let row = `<td class="col-staff"><div class="dash-staff-cell">
            <span class="dash-dot" style="background:${staff.color}"></span>
            ${displayName(staff._id, staff.name)}
        </div></td>`;

        days.forEach(({ date }) => {
            const dayShifts = staff.shifts[date];
            if (dayShifts && dayShifts.length) {
                let dayH = 0;
                dayShifts.forEach(s => {
                    const ds = s.real_start != null ? s.real_start : s.start_time;
                    const de = s.real_end   != null ? s.real_end   : s.end_time;
                    dayH += de - ds;
                });
                totalH += dayH;
                dayTotals[date] = (dayTotals[date] || 0) + dayH;

                const pillsHtml = dayShifts.map(shift => {
                    const dispStart = shift.real_start != null ? shift.real_start : shift.start_time;
                    const dispEnd   = shift.real_end   != null ? shift.real_end   : shift.end_time;
                    const hasReal   = shift.real_start != null && shift.real_end != null;
                    const textColor = shiftTextColor(shift);
                    return `<span class="dash-shift-pill"
                        style="background:${shift.color};color:${textColor}"
                        onclick="switchToDayView('${date}')"
                        title="${hasReal ? 'Réel — ' : 'Planifié — '}Cliquer pour voir ce jour">
                        ${fmtD(dispStart)}-${fmtD(dispEnd)}
                    </span>`;
                }).join('');

                const dayTotalHtml = dayShifts.length > 1
                    ? `<span class="dash-day-total">${fmtD(dayH)}</span>`
                    : '';

                row += `<td><div class="dash-cell-multi">${pillsHtml}${dayTotalHtml}</div></td>`;
            } else {
                row += `<td><span class="dash-empty">—</span></td>`;
            }
        });

        const fmtTotal = h => {
            const totalMins = Math.round(h * 60);
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            return mins > 0 ? hrs + 'h' + String(mins).padStart(2,'0') : hrs + 'h';
        };
        row += `<td class="dash-total-cell">${fmtTotal(totalH)}</td>`;
        tr.innerHTML = row;
        tbody.appendChild(tr);
        if (staff._id !== '__joker__') accTotalH += totalH;
    });
    table.appendChild(tbody);

    // Ligne total heures par soirée
    const _fmtDayH = h => {
        const totalMins = Math.round(h * 60);
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return hrs + 'h' + (mins > 0 ? String(mins).padStart(2,'0') : '');
    };
    const tfoot = document.createElement('tfoot');
    let tfRow = '<tr><td class="col-staff" style="font-size:11px;font-weight:700;color:var(--text-secondary);border-top:2px solid var(--light-border)">Total soirée</td>';
    days.forEach(({ date }) => {
        const h = dayTotals[date] || 0;
        tfRow += '<td style="font-weight:700;font-size:12px;color:var(--accent);border-top:2px solid var(--light-border)">' + (h > 0 ? _fmtDayH(h) : '—') + '</td>';
    });
    tfRow += '<td style="border-top:2px solid var(--light-border)"></td></tr>';
    tfoot.innerHTML = tfRow;
    table.appendChild(tfoot);

    container.appendChild(table);

    // totalHSemaine et nbStaff sont accumulés pendant le rendu du tableau
    // → garantit par construction que la moyenne correspond aux totaux affichés.
    const totalHSemaine = accTotalH;
    const nbStaff = accNbStaff;
    const joursStaffes = Object.values(weekFullData).filter(arr => arr.length > 0).length;

    const fmtTotalH = h => {
        const totalMins = Math.round(h * 60);
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        return mins > 0 ? hrs + 'h' + String(mins).padStart(2,'0') : hrs + 'h';
    };
    const stats = document.createElement('div');
    stats.className = 'dashboard-stats';
    [
        { label: 'Heures semaine', value: fmtTotalH(totalHSemaine) },
        { label: 'Jours staffés',  value: `${joursStaffes} / 7` },
        { label: 'Staff actif',    value: nbStaff },
        { label: 'Moy./personne',  value: nbStaff ? fmtTotalH(totalHSemaine / nbStaff) : '—' },
    ].forEach(({ label, value }) => {
        stats.innerHTML += `<div class="dashboard-stat">
            <div class="dashboard-stat-label">${label}</div>
            <div class="dashboard-stat-value">${value}</div>
        </div>`;
    });
    container.appendChild(stats);
    wrap.appendChild(container);
}

// ── Agenda semaine ────────────────────────────────────────────────────────────

function renderAgenda() {
    const wrap = document.getElementById('week-agenda');
    wrap.innerHTML = '';

    const agendaWrap = document.createElement('div');
    agendaWrap.className = 'agenda-wrap';

    for (let i = 0; i < 7; i++) {
        const date = toDateStr(addDays(currentWeekStart, i));
        const d    = addDays(currentWeekStart, i);
        const shifts = (weekFullData[date] || []).filter(s => staffMatchesCurrentGroup(s.staff_id));
        const today  = isToday(date);
        const empty  = shifts.length === 0;

        const row = document.createElement('div');
        row.className = 'agenda-row' + (today ? ' today' : '') + (empty ? ' empty' : '');

        // Label jour
        const label = document.createElement('div');
        label.className = 'agenda-day-label';
        label.innerHTML = `
            <div class="agenda-day-name">${DAY_NAMES_SHORT[d.getDay()]}</div>
            <div class="agenda-day-num">${d.getDate()}</div>`;
        row.appendChild(label);

        // Pills
        const pills = document.createElement('div');
        pills.className = 'agenda-pills';

        if (empty) {
            pills.innerHTML = '<span class="agenda-empty-label">Aucun shift planifié</span>';
        } else {
            const fmtA = v => {
                const hh = Math.floor(v % 24).toString().padStart(2,'0');
                const mm = Math.round((v % 1) * 60);
                return hh + 'h' + (mm > 0 ? String(mm).padStart(2,'0') : '');
            };
            shifts.forEach(shift => {
                const staff     = allStaff.find(s => String(s._id) === String(shift.staff_id));
                const nameColor = (staff && staff.name_color) ? staff.name_color : shift.color;
                const dispStart = shift.real_start != null ? shift.real_start : shift.start_time;
                const dispEnd   = shift.real_end   != null ? shift.real_end   : shift.end_time;
                const pill = document.createElement('span');
                pill.className = 'agenda-pill';
                pill.style.background = shift.color + '22';
                pill.innerHTML = `
                    <span class="agenda-pill-dot" style="background:${escapeHtml(shift.color)}"></span>
                    <span style="color:${escapeHtml(nameColor)}">${escapeHtml(displayName(shift.staff_id, shift.staff_name))}</span>
                    <span style="color:#888;font-weight:400">${fmtA(dispStart)}-${fmtA(dispEnd)}</span>`;
                pills.appendChild(pill);
            });
        }
        row.appendChild(pills);

        if (!empty) {
            const totalH = shifts.reduce((a, s) => {
                const start = s.real_start != null ? s.real_start : s.start_time;
                const end   = s.real_end   != null ? s.real_end   : s.end_time;
                return a + (end - start);
            }, 0);
            const total = document.createElement('span');
            total.className = 'agenda-total';
            const hrs  = Math.floor(totalH);
            const mins = Math.round((totalH - hrs) * 60);
            total.textContent = mins > 0 ? hrs + 'h' + String(mins).padStart(2,'0') : hrs + 'h';
            row.appendChild(total);
        }

        // Clic → passer en vue jour sur cette date
        if (!empty) {
            row.addEventListener('click', () => switchToDayView(date));
            row.title = 'Cliquer pour voir le planning de ce jour';
            row.style.cursor = 'pointer';
        }

        agendaWrap.appendChild(row);
    }

    wrap.appendChild(agendaWrap);
}

// ── Vue Gantt semaine ─────────────────────────────────────────────────────────

function renderWeekGantt() {
    const wrap = document.getElementById('week-gantt');
    wrap.innerHTML = '';

    const fmtH = ShiftHours.fmtHourOfDay;
    const fmtRange = (s, e) => fmtH(s) + ' → ' + fmtH(e);

    // ── Bornes dynamiques ─────────────────────────────────────────────────────
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < 7; i++) {
        const date = toDateStr(addDays(currentWeekStart, i));
        for (const s of (weekFullData[date] || [])) {
            if (!staffMatchesCurrentGroup(s.staff_id)) continue;
            const sH = s.real_start != null ? s.real_start : s.start_time;
            const eH = s.real_end   != null ? s.real_end   : s.end_time;
            if (sH != null && isFinite(sH)) minH = Math.min(minH, sH);
            if (eH != null && isFinite(eH)) maxH = Math.max(maxH, eH);
        }
    }
    if (!isFinite(minH) || !isFinite(maxH)) { minH = 10; maxH = 26; }

    const OPEN_H  = Math.max(0,  Math.floor(minH) - 1);
    const CLOSE_H = Math.min(30, Math.ceil(maxH)  + 1);
    const RANGE   = CLOSE_H - OPEN_H || 1;
    const pctLeft  = h     => ((h - OPEN_H) / RANGE * 100).toFixed(3) + '%';
    const pctWidth = (s,e) => ((e - s)       / RANGE * 100).toFixed(3) + '%';

    wrap.style.setProperty('--gantt-tick-pct', (1 / RANGE * 100).toFixed(3) + '%');

    // ── Axe ───────────────────────────────────────────────────────────────────
    const axisRow = document.createElement('div');
    axisRow.className = 'gantt-axis';
    const axisEmpty = document.createElement('div');
    axisEmpty.className = 'gantt-axis-empty';
    const axisTrack = document.createElement('div');
    axisTrack.className = 'gantt-axis-track';
    for (let h = OPEN_H; h <= CLOSE_H; h++) {
        const isMajor    = h % 2 === 0;
        const isMidnight = h === 24;
        const tick = document.createElement('span');
        tick.className = 'gantt-tick' + (isMajor ? ' major' : '') + (isMidnight ? ' midnight' : '');
        tick.style.left  = pctLeft(h);
        tick.textContent = isMajor ? fmtH(h) : '';
        axisTrack.appendChild(tick);
    }
    axisRow.appendChild(axisEmpty);
    axisRow.appendChild(axisTrack);
    wrap.appendChild(axisRow);

    // ── Collecte staff unique pour la légende ─────────────────────────────────
    const staffMap = new Map();
    for (let i = 0; i < 7; i++) {
        const date = toDateStr(addDays(currentWeekStart, i));
        for (const s of (weekFullData[date] || [])) {
            if (!staffMatchesCurrentGroup(s.staff_id)) continue;
            const isJoker = s.is_joker || s.staff_id === '__joker__';
            const key = isJoker ? '__joker__' : String(s.staff_id);
            const sH = s.real_start != null ? s.real_start : s.start_time;
            const eH = s.real_end   != null ? s.real_end   : s.end_time;
            const dur = (sH != null && eH != null) ? Math.max(0, eH - sH) : 0;
            if (!staffMap.has(key)) staffMap.set(key, { name: isJoker ? 'Joker' : displayName(s.staff_id, s.staff_name), color: s.color || '#3498db', isJoker, totalH: 0 });
            staffMap.get(key).totalH += dur;
        }
    }

    // ── Stack 7 jours ─────────────────────────────────────────────────────────
    const stack = document.createElement('div');
    stack.className = 'gantt-stack';

    for (let i = 0; i < 7; i++) {
        const d    = addDays(currentWeekStart, i);
        const date = toDateStr(d);
        const dayN = d.getDay();
        const isWE = dayN === 0 || dayN === 6;
        const shifts = (weekFullData[date] || [])
            .filter(s => staffMatchesCurrentGroup(s.staff_id))
            .slice()
            .sort((a, b) => (a.start_time || 0) - (b.start_time || 0));

        const dayH = shifts.reduce((acc, s) => {
            const sH = s.real_start != null ? s.real_start : s.start_time;
            const eH = s.real_end   != null ? s.real_end   : s.end_time;
            return acc + ((sH != null && eH != null) ? Math.max(0, eH - sH) : 0);
        }, 0);
        const dh = Math.floor(dayH), dm = Math.round((dayH - dh) * 60);
        const hoursStr = dm === 0 ? dh + 'h' : dh + 'h' + String(dm).padStart(2, '0');

        const dayDiv = document.createElement('div');
        dayDiv.className = 'gantt-day' + (isWE ? ' weekend' : '');

        const tag = document.createElement('div');
        tag.className = 'gantt-day-tag';
        tag.innerHTML =
            '<div class="gantt-day-name">' + DAY_NAMES_SHORT[dayN] + '.</div>' +
            '<div class="gantt-day-num">'  + d.getDate() + '</div>' +
            '<div class="gantt-day-meta">' + (shifts.length ? shifts.length + ' shift' + (shifts.length > 1 ? 's' : '') + ' · ' + hoursStr : 'Repos') + '</div>';

        const rail = document.createElement('div');
        rail.className = 'gantt-day-rail';

        if (shifts.length === 0) {
            const empty = document.createElement('div');
            empty.className   = 'gantt-empty';
            empty.textContent = 'Aucun shift';
            rail.appendChild(empty);
        } else {
            const laneStack = document.createElement('div');
            laneStack.className = 'gantt-lane-stack';

            const staffRows = new Map();
            shifts.forEach(shift => {
                const isJoker = shift.is_joker || shift.staff_id === '__joker__';
                const key = isJoker ? '__joker__' + shift._id : String(shift.staff_id);
                if (!staffRows.has(key)) staffRows.set(key, { isJoker, shift, bars: [] });
                const sH = shift.real_start != null ? shift.real_start : shift.start_time;
                const eH = shift.real_end   != null ? shift.real_end   : shift.end_time;
                const clampS = Math.max(sH, OPEN_H);
                const clampE = Math.min(eH, CLOSE_H);
                if (clampS < clampE) staffRows.get(key).bars.push({ shift, sH, eH, clampS, clampE });
            });

            staffRows.forEach(({ isJoker, shift: firstShift, bars }) => {
                if (bars.length === 0) return;
                const lane = document.createElement('div');
                lane.className = 'gantt-lane';
                bars.forEach(({ shift, sH, eH, clampS, clampE }) => {
                    const block = document.createElement('div');
                    block.className = 'gantt-block' + (isJoker ? ' joker' : '');
                    block.style.left  = pctLeft(clampS);
                    block.style.width = pctWidth(clampS, clampE);
                    if (!isJoker) {
                        block.style.background = shift.color || '#3498db';
                        block.style.color = textColorFor(shift.color || '#3498db');
                    }
                    const name = isJoker ? 'Joker' : displayName(firstShift.staff_id, firstShift.staff_name);
                    const showWhen = (clampE - clampS) >= 1.5;
                    block.innerHTML =
                        '<span class="gantt-block-who">' + name + '</span>' +
                        (showWhen ? '<span class="gantt-block-when">' + fmtRange(sH, eH) + '</span>' : '');
                    block.addEventListener('click', () => switchToDayView(date));
                    lane.appendChild(block);
                });
                laneStack.appendChild(lane);
            });
            rail.appendChild(laneStack);
        }

        dayDiv.appendChild(tag);
        dayDiv.appendChild(rail);
        stack.appendChild(dayDiv);
    }
    wrap.appendChild(stack);

    // ── Légende ───────────────────────────────────────────────────────────────
    if (staffMap.size > 0) {
        const legendBar = document.createElement('div');
        legendBar.className = 'gantt-legend-bar';
        const legend = document.createElement('div');
        legend.className = 'gantt-legend';
        staffMap.forEach(({ name, color, isJoker, totalH }) => {
            const dh = Math.floor(totalH), dm = Math.round((totalH - dh) * 60);
            const tStr = dm === 0 ? dh + 'h' : dh + 'h' + String(dm).padStart(2, '0');
            const item = document.createElement('div');
            item.className = 'gantt-legend-item';
            item.innerHTML =
                '<span class="gantt-legend-swatch' + (isJoker ? ' joker' : '') + '"' +
                (isJoker ? '' : ' style="background:' + color + '"') + '></span>' +
                name + '<span class="gantt-legend-meta">· ' + tStr + '</span>';
            legend.appendChild(item);
        });
        legendBar.appendChild(legend);
        wrap.appendChild(legendBar);
    }
}

// ── Switcher vers vue jour sur une date précise ───────────────────────────────

function switchToDayView(date) {
    currentView  = 'day';
    selectedDate = date;

    document.querySelectorAll('.view-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.view === 'day');
    });

    applyViewMode();
}

// ── Modale gestion établissements ────────────────────────────────────────────

async function openEstablishmentsModal() {
    try {
        await renderEstablishmentsList();
        document.getElementById('establishments-modal').style.display = 'flex';
        // Listener ajout (une seule fois)
        const btn = document.getElementById('btn-add-establishment');
        if (btn && !btn._bound) {
            btn._bound = true;
            btn.addEventListener('click', addEstablishment);
        }
    } catch (e) { showToast('Erreur ouverture établissements : ' + e.message, true); }
}

// ── Modale compte établissement (pointage) ────────────────────────────────────

async function openCompteEtabModal(estab) {
    // Vérifier si un compte existe déjà pour cet établissement
    let existingAccount = null;
    try {
        const res   = await fetch('/api/users', { credentials: 'include' });
        const users = await res.json();
        existingAccount = users.find(u => u.role === 'etablissement' && u.establishment_id === (estab.id || String(estab._id)));
    } catch { /* silencieux */ }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

    overlay.innerHTML =
        '<div style="background:white;border-radius:14px;padding:24px;max-width:400px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:4px">Compte pointage</p>' +
            '<p style="font-size:13px;color:#888;margin-bottom:16px">' + estab.name + '</p>' +
            (existingAccount
                ? '<div style="background:#eafaf1;border:1px solid #2ecc71;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:13px;color:#27ae60">' +
                  '✓ Compte existant : <strong>' + existingAccount.email + '</strong>' +
                  '</div>'
                : '<div style="background:#f8f8f8;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:13px;color:#888">' +
                  'Aucun compte pointage — créez-en un ci-dessous.' +
                  '</div>') +
            (!existingAccount
                ? '<div style="margin-bottom:16px">' +
                  '<div style="font-size:11px;color:#aaa;margin-bottom:6px">Email du compte</div>' +
                  '<input id="_cetab-email" type="email" placeholder="email@exemple.com" style="width:100%;padding:9px 12px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:13px;outline:none">' +
                  '</div>'
                : '') +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_cetab-cancel" style="padding:8px 16px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:13px;cursor:pointer;color:#555">Fermer</button>' +
                (!existingAccount
                    ? '<button id="_cetab-create" style="padding:8px 16px;border-radius:8px;border:none;background:#534AB7;color:white;font-size:13px;font-weight:600;cursor:pointer">Créer le compte</button>'
                    : '') +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);

    overlay.querySelector('#_cetab-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const createBtn = overlay.querySelector('#_cetab-create');
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            const email = overlay.querySelector('#_cetab-email').value.trim();
            if (!email) { showToast('Email requis', true); return; }
            createBtn.disabled    = true;
            createBtn.textContent = 'Création…';
            try {
                const res = await fetch('/api/users', {
                    credentials: 'include', method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        role:             'etablissement',
                        establishment_id: estab.id || String(estab._id),
                        name:             estab.name,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                close();
                if (data.manual && data.link) {
                    showToast('Compte créé — lien : ' + data.link, false);
                    // Afficher le lien dans un toast long
                    setTimeout(() => {
                        const box = document.createElement('div');
                        box.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:white;border:1.5px solid #f39c12;border-radius:10px;padding:14px 16px;max-width:380px;width:90%;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.12);font-size:12px';
                        box.innerHTML =
                            '<div style="font-weight:700;color:#f39c12;margin-bottom:6px">⚠️ Email non envoyé — lien d\'activation :</div>' +
                            '<div style="word-break:break-all;color:#555;cursor:pointer;text-decoration:underline" onclick="navigator.clipboard.writeText(\'' + data.link + '\');showToast(\'Lien copié !\')">' + data.link + '</div>' +
                            '<div style="text-align:right;margin-top:8px"><button onclick="this.closest(\'div\').parentNode.remove()" style="border:none;background:none;color:#aaa;cursor:pointer;font-size:12px">Fermer</button></div>';
                        document.body.appendChild(box);
                    }, 300);
                } else {
                    showToast('Compte pointage créé pour ' + estab.name);
                }
            } catch (err) {
                showToast(err.message, true);
                createBtn.disabled    = false;
                createBtn.textContent = 'Créer le compte';
            }
        });
    }
}

async function renderEstablishmentsList() {
    const list = document.getElementById('establishments-list');
    list.innerHTML = '<div style="padding:12px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    try {
        const res    = await fetch('/api/establishments', { credentials: 'include' });
        const estabs = await res.json();
        if (!res.ok) throw new Error(estabs.error);
        if (estabs.length === 0) {
            list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Aucun établissement</div>';
            return;
        }
        list.innerHTML = '';
        estabs.forEach(e => {
            const row = document.createElement('div');
            row.className = 'staff-manage-row';
            const typeLabel = e.type === 'bar' ? 'Bar' : 'Restaurant';
            const hours = (e.open_time && e.close_time)
                ? e.open_time + ' – ' + e.close_time
                : (e.open_time || e.close_time || '—');
            const estabGroups = e.groups || [];
            const groupChipsEstab = allGroups.length
                ? '<div style="margin-top:4px"><div style="font-size:10px;color:#aaa;margin-bottom:3px">Groupes</div>' +
                  '<div style="display:flex;flex-wrap:wrap;gap:3px">' +
                  allGroups.map(g =>
                      '<button type="button" class="estab-group-btn' + (estabGroups.includes(g) ? ' active' : '') + '" ' +
                      'data-group="' + escapeHtml(g) + '" style="padding:2px 8px;border-radius:20px;border:1.5px solid ' +
                      (estabGroups.includes(g) ? '#534AB7' : '#e0e0e0') + ';background:' +
                      (estabGroups.includes(g) ? '#f0effe' : 'white') + ';color:' +
                      (estabGroups.includes(g) ? '#534AB7' : '#888') + ';font-size:11px;cursor:pointer">' + escapeHtml(g) + '</button>'
                  ).join('') + '</div>' +
                  // Champ texte pour créer un nouveau groupe
                  '<input type="text" class="estab-new-group-input" placeholder="+ nouveau groupe" style="margin-top:4px;font-size:11px;border:1px solid #e0e0e0;border-radius:6px;padding:3px 7px;width:100%">' +
                  '</div>'
                : '<input type="text" class="estab-new-group-input" placeholder="Groupe (ex: Bar)" style="margin-top:4px;font-size:11px;border:1px solid #e0e0e0;border-radius:6px;padding:3px 7px;width:100%">';

            row.innerHTML =
                '<div class="staff-manage-info" style="flex:1;gap:6px">' +
                    '<input type="text" class="estab-name-input" value="' + escapeHtml(e.name) + '" style="font-size:13px;font-weight:600;border:1px solid #e0e0e0;border-radius:6px;padding:5px 8px;width:100%">' +
                    '<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">' +
                        '<select class="estab-type-select" style="font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;flex:0.8">' +
                            '<option value="bar"' +        (e.type === 'bar'        ? ' selected' : '') + '>Bar</option>' +
                            '<option value="restaurant"' + (e.type === 'restaurant' ? ' selected' : '') + '>Restaurant</option>' +
                        '</select>' +
                        '<label style="display:flex;flex-direction:column;gap:2px;flex:1;font-size:10px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.3px">Ouverture' +
                            '<input type="time" class="estab-open-input"  value="' + escapeHtml(e.open_time  || '') + '" style="font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-weight:400;text-transform:none;letter-spacing:0;color:#1a1a2e">' +
                        '</label>' +
                        '<label style="display:flex;flex-direction:column;gap:2px;flex:1;font-size:10px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.3px">Fermeture' +
                            '<input type="time" class="estab-close-input" value="' + escapeHtml(e.close_time || '') + '" style="font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-weight:400;text-transform:none;letter-spacing:0;color:#1a1a2e">' +
                        '</label>' +
                    '</div>' +
                    groupChipsEstab +
                '</div>' +
                '<button class="staff-manage-save"  data-action="save">Enregistrer</button>' +
                '<button class="staff-manage-save"  data-action="compte" style="background:#f0effe;border-color:#7F77DD;color:#534AB7" title="Créer/voir compte pointage">Compte</button>' +
                '<button class="staff-manage-delete" data-action="delete" title="Supprimer">×</button>';

            // Toggle groupes établissement
            row.querySelectorAll('.estab-group-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    btn.classList.toggle('active');
                    const isActive = btn.classList.contains('active');
                    btn.style.borderColor = isActive ? '#534AB7' : '#e0e0e0';
                    btn.style.background  = isActive ? '#f0effe' : 'white';
                    btn.style.color       = isActive ? '#534AB7' : '#888';
                });
            });

            row.querySelector('[data-action="save"]').addEventListener('click', async () => {
                const name       = row.querySelector('.estab-name-input').value.trim();
                const type       = row.querySelector('.estab-type-select').value;
                const open_time  = row.querySelector('.estab-open-input').value  || null;
                const close_time = row.querySelector('.estab-close-input').value || null;
                // Groupes : chips actives + éventuel nouveau groupe saisi
                const activeGroups = Array.from(row.querySelectorAll('.estab-group-btn.active')).map(b => b.dataset.group);
                const newGroupRaw  = row.querySelector('.estab-new-group-input')?.value.trim();
                const newGroupList = newGroupRaw ? newGroupRaw.split(',').map(g => g.trim()).filter(Boolean) : [];
                const groups = [...new Set([...activeGroups, ...newGroupList])];
                if (!name) { showToast('Le nom ne peut pas être vide', true); return; }
                try {
                    const r = await fetch('/api/establishments/' + e._id, {
                        credentials: 'include', method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, type, open_time, close_time, groups }),
                    });
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.error);
                    const idx = allEstablishments.findIndex(x => String(x._id) === String(e._id) || x.id === e.id);
                    if (idx !== -1) {
                        allEstablishments[idx].name       = name;
                        allEstablishments[idx].type       = type;
                        allEstablishments[idx].open_time  = open_time;
                        allEstablishments[idx].close_time = close_time;
                        allEstablishments[idx].groups     = groups;
                    }
                    await loadGroups();
                    renderTabs(currentGroup ? allEstablishments.filter(x => (x.groups || []).includes(currentGroup)) : allEstablishments);
                    await renderEstablishmentsList();
                    showToast(name + ' mis à jour');
                } catch (err) { showToast(err.message, true); }
            });

            row.querySelector('[data-action="compte"]').addEventListener('click', () => openCompteEtabModal(e));

            row.querySelector('[data-action="delete"]').addEventListener('click', () => {
                showConfirm(
                    'Supprimer <strong>' + e.name + '</strong> ?<br><span style="color:#e74c3c;font-size:12px">Tous les shifts de cet établissement seront supprimés.</span>',
                    async () => {
                        try {
                            const r = await fetch('/api/establishments/' + e._id, { credentials: 'include', method: 'DELETE' });
                            const d = await r.json();
                            if (!r.ok) throw new Error(d.error);
                            allEstablishments = allEstablishments.filter(x => String(x._id) !== String(e._id) && x.id !== e.id);
                            renderTabs(allEstablishments);
                            await renderEstablishmentsList();
                            showToast(e.name + ' supprimé');
                        } catch (err) { showToast(err.message, true); }
                    }
                );
            });

            list.appendChild(row);
        });
    } catch (err) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + err.message + '</div>';
    }
}

async function addEstablishment() {
    const name       = document.getElementById('new-estab-name').value.trim();
    const type       = document.getElementById('new-estab-type').value;
    const open_time  = document.getElementById('new-estab-open').value   || null;
    const close_time = document.getElementById('new-estab-close').value  || null;
    const groupRaw   = document.getElementById('new-estab-group')?.value.trim() || '';
    const groups     = groupRaw ? groupRaw.split(',').map(g => g.trim()).filter(Boolean) : [];
    if (!name) { showToast('Le nom est obligatoire', true); return; }
    try {
        const res  = await fetch('/api/establishments', {
            credentials: 'include', method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, type, open_time, close_time, groups }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        allEstablishments.push(data);
        await loadGroups();
        renderTabs(currentGroup ? allEstablishments.filter(x => (x.groups || []).includes(currentGroup)) : allEstablishments);
        await renderEstablishmentsList();
        // Reset form
        document.getElementById('new-estab-name').value  = '';
        document.getElementById('new-estab-open').value  = '';
        document.getElementById('new-estab-close').value = '';
        const groupInput = document.getElementById('new-estab-group');
        if (groupInput) groupInput.value = '';
        showToast(name + ' ajouté');
    } catch (e) { showToast(e.message, true); }
}

// ── Modale gestion des comptes ────────────────────────────────────────────────

async function openAccountsModal() {
    switchAccountsTab('active');
    await renderAccountsList();
    populateStaffSelect();
    populateBarsCheckboxes();
    // Cacher la section bars au départ (rôle par défaut = staff)
    const barsRow = document.getElementById('new-account-bars-row');
    if (barsRow) barsRow.style.display = 'none';
    document.getElementById('accounts-modal').style.display = 'flex';
}

function switchAccountsTab(tab) {
    const isPending = tab === 'pending';
    const tabActive  = document.getElementById('accounts-tab-active');
    const tabPending = document.getElementById('accounts-tab-pending');
    if (tabActive)  tabActive.style.display  = isPending ? 'none' : '';
    if (tabPending) tabPending.style.display = isPending ? '' : 'none';

    const btnActive  = document.getElementById('accounts-tab-btn-active');
    const btnPending = document.getElementById('accounts-tab-btn-pending');
    if (btnActive) {
        btnActive.style.borderBottomColor = isPending ? 'transparent' : 'var(--accent)';
        btnActive.style.color             = isPending ? 'var(--text-secondary)' : 'var(--accent)';
        btnActive.style.fontWeight        = isPending ? '500' : '600';
    }
    if (btnPending) {
        btnPending.style.borderBottomColor = isPending ? 'var(--accent)' : 'transparent';
        btnPending.style.color             = isPending ? 'var(--accent)' : 'var(--text-secondary)';
        btnPending.style.fontWeight        = isPending ? '600' : '500';
    }
    if (isPending) renderPendingInvites();
}

function _updatePendingBadge(count) {
    const badge = document.getElementById('pending-tab-badge');
    if (!badge) return;
    badge.textContent   = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

function populateBarsCheckboxes() {
    const container = document.getElementById('new-account-bars-list');
    if (!container) return;
    // Uniquement visible pour les admins
    if (currentUser.role !== 'patron') {
        const row = document.getElementById('new-account-bars-row');
        if (row) row.style.display = 'none';
        // Masquer l'option Patron bar du select si non-admin
        const opt = document.querySelector('#new-account-role option[value="patron"]');
        if (opt) opt.style.display = 'none';
        return;
    }
    container.innerHTML = '';
    allEstablishments.forEach(e => {
        const estabId = e.id || String(e._id);
        const label   = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;color:#333;cursor:pointer;padding:4px 8px;border:1px solid #e0e0e0;border-radius:6px;background:white';
        label.innerHTML = '<input type="checkbox" value="' + estabId + '" style="cursor:pointer"> ' + e.name;
        container.appendChild(label);
    });
}

async function renderAccountsList() {
    const list = document.getElementById('accounts-list');
    list.innerHTML = '<div style="padding:12px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    try {
        const res       = await fetch('/api/users', { credentials: 'include' });
        const allUsers  = await res.json();
        if (!res.ok) throw new Error(allUsers.error);
        const pending = allUsers.filter(u => u.active === false);
        const users   = allUsers.filter(u => u.active !== false);
        _updatePendingBadge(pending.length);
        if (users.length === 0) {
            list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Aucun compte actif</div>';
            return;
        }
        list.innerHTML = '';
        users.forEach(user => {
            const row    = document.createElement('div');
            row.className = 'staff-manage-row';
            const sm     = allStaff.find(s => String(s._id) === user.staff_id);
            const color  = sm ? sm.color : '#888';
            const isAdmin = user.role === 'patron';
            const isP    = user.role === 'directeur';
            const isEtab = user.role === 'etablissement';
            let statusLabel, statusBadge;
            if (isAdmin)     { statusLabel = 'Patron';        statusBadge = 'linked'; }
            else if (isP)    { statusLabel = 'Directeur';     statusBadge = 'linked'; }
            else if (isEtab) { statusLabel = 'Établissement'; statusBadge = 'linked'; }
            else             { statusLabel = user.active ? 'Actif' : 'Invitation envoyée'; statusBadge = user.active ? 'linked' : 'unlinked'; }

            const phoneRaw = user.phone || '';
            const phoneDisplay = (() => {
                if (!phoneRaw) return '';
                if (/^\+33\d{9}$/.test(phoneRaw))
                    return '+33 ' + phoneRaw[3] + ' ' + phoneRaw.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ');
                return phoneRaw;
            })();
            const coordsParts = [
                user.email    ? '📧 ' + escapeHtml(user.email)        : '',
                phoneDisplay  ? '📱 ' + escapeHtml(phoneDisplay)       : '',
            ].filter(Boolean);
            const coordsHtml = coordsParts.length ? coordsParts.join('<br>') : '—';

            row.innerHTML =
                '<span class="staff-manage-dot" style="background:' + escapeHtml(color) + '"></span>' +
                '<div class="staff-manage-info" style="flex:1">' +
                    '<div style="font-size:13px;font-weight:600;color:#333">' + escapeHtml(user.name || '—') + '</div>' +
                    '<div style="font-size:12px;color:#999">' + coordsHtml + '</div>' +
                '</div>' +
                '<span class="staff-login-badge ' + statusBadge + '" style="margin-right:8px">' + escapeHtml(statusLabel) + '</span>' +
                (currentUser.role === 'patron' && String(user._id) !== currentUser._id
                    ? '<button class="staff-manage-save" data-action="change-role" style="background:#fff9e6;border-color:#f39c12;color:#d68910">Rôle</button>'
                    : '') +
                (isP && currentUser.role === 'patron'
                    ? '<button class="staff-manage-save" data-action="assign-bars" style="background:#f0effe;border-color:#7F77DD;color:#534AB7">Bars</button>'
                    : '') +
                '<button class="staff-manage-save" data-action="reset">Reset mdp</button>' +
                '<button class="staff-manage-delete" data-action="delete">×</button>';
            row.querySelector('[data-action="reset"]').addEventListener('click',  () => patronResetPassword(user._id, user.name || user.email));
            row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteAccount(user._id, user.name || user.email));
            if (currentUser.role === 'patron' && String(user._id) !== currentUser._id) {
                row.querySelector('[data-action="change-role"]').addEventListener('click', () => openChangeRoleModal(user));
            }
            if (isP && currentUser.role === 'patron') {
                row.querySelector('[data-action="assign-bars"]').addEventListener('click', () => openAssignBarsModal(user));
            }
            list.appendChild(row);
        });
        // Garder la liste des invitations en attente synchronisée si l'onglet est ouvert
        const pendingTab = document.getElementById('accounts-tab-pending');
        if (pendingTab && pendingTab.style.display !== 'none') renderPendingInvites();
    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + e.message + '</div>';
    }
}

async function renderPendingInvites() {
    const list = document.getElementById('accounts-pending-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:12px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    try {
        const res      = await fetch('/api/users', { credentials: 'include' });
        const allUsers = await res.json();
        if (!res.ok) throw new Error(allUsers.error);
        const pending  = allUsers.filter(u => u.active === false);
        _updatePendingBadge(pending.length);
        if (pending.length === 0) {
            list.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">✅ Aucune invitation en attente</div>';
            return;
        }
        list.innerHTML = '';

        const counter = document.createElement('div');
        counter.style.cssText = 'padding:8px 16px;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--light-border)';
        counter.textContent = pending.length + ' invitation' + (pending.length > 1 ? 's' : '') + ' non activée' + (pending.length > 1 ? 's' : '');
        list.appendChild(counter);

        const MONTHS = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
        pending.forEach(user => {
            const sm    = allStaff.find(s => String(s._id) === user.staff_id);
            const color = sm ? sm.color : '#888';

            const phoneRaw = user.phone || '';
            const phoneDisplay = (() => {
                if (!phoneRaw) return '';
                if (/^\+33\d{9}$/.test(phoneRaw))
                    return '+33 ' + phoneRaw[3] + ' ' + phoneRaw.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ');
                return phoneRaw;
            })();

            const createdLabel = (() => {
                if (!user.created_at) return '';
                const d = new Date(user.created_at);
                if (isNaN(d.getTime())) return '';
                return 'invité le ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
            })();

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--light-border);flex-wrap:wrap';

            const dot = '<span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(color) + ';flex-shrink:0;display:inline-block"></span>';

            const nameBlock =
                '<div style="flex:1;min-width:140px">' +
                    '<div style="font-size:13px;font-weight:600;color:var(--text-primary)">' + escapeHtml(user.name || '—') + '</div>' +
                    (createdLabel ? '<div style="font-size:11px;color:#aaa;margin-top:2px">' + createdLabel + '</div>' : '') +
                '</div>';

            const contactBits = [];
            if (user.email) {
                contactBits.push(
                    '<div style="display:flex;align-items:center;gap:4px">' +
                    '<span style="font-size:12px;color:var(--text-secondary)">📧 ' + escapeHtml(user.email) + '</span>' +
                    '<button class="btn-copy-email" title="Copier l\'email" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:var(--text-secondary);font-size:13px">📋</button>' +
                    '</div>'
                );
            }
            if (phoneDisplay) {
                contactBits.push(
                    '<div style="display:flex;align-items:center;gap:4px">' +
                    '<span style="font-size:12px;color:var(--text-secondary)">📱 ' + escapeHtml(phoneDisplay) + '</span>' +
                    '<button class="btn-copy-phone" title="Copier le numéro" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:var(--text-secondary);font-size:13px">📋</button>' +
                    '</div>'
                );
            }
            const contactBlock = '<div style="display:flex;flex-direction:column;gap:3px;min-width:0">' + (contactBits.join('') || '<span style="font-size:11px;color:#ccc;font-style:italic">pas de contact</span>') + '</div>';

            const linkBtn =
                '<button class="btn-copy-invite-link" style="padding:6px 12px;border-radius:6px;border:1.5px solid var(--accent);background:#f0effe;color:var(--accent);font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;white-space:nowrap">🔗 Copier le lien</button>';

            row.innerHTML = dot + nameBlock + contactBlock + linkBtn;

            const emailBtn = row.querySelector('.btn-copy-email');
            if (emailBtn) emailBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(user.email).then(() => showToast('Email copié'));
            });
            const phoneBtn = row.querySelector('.btn-copy-phone');
            if (phoneBtn) phoneBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(user.phone).then(() => showToast('Numéro copié'));
            });
            const linkBtnEl = row.querySelector('.btn-copy-invite-link');
            linkBtnEl.addEventListener('click', async () => {
                linkBtnEl.disabled    = true;
                const original        = linkBtnEl.textContent;
                linkBtnEl.textContent = '…';
                try {
                    const r = await fetch('/api/users/' + user._id + '/invite-link', { method: 'POST', credentials: 'include' });
                    const data = await r.json();
                    if (!r.ok) throw new Error(data.error);
                    await navigator.clipboard.writeText(data.link);
                    showToast('Lien d\'activation copié');
                } catch (err) {
                    showToast(err.message || 'Erreur', true);
                } finally {
                    linkBtnEl.disabled    = false;
                    linkBtnEl.textContent = original;
                }
            });

            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + escapeHtml(e.message || 'Erreur') + '</div>';
    }
}

function populateStaffSelect() {
    const select = document.getElementById('new-account-staff');
    if (!select) return;
    select.innerHTML = '<option value="">— Lier à un membre du staff —</option>';
    allStaff.forEach(s => {
        const opt       = document.createElement('option');
        opt.value       = String(s._id);
        opt.textContent = s.name;
        select.appendChild(opt);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Bouton gestion établissements
    const btnEstab = document.getElementById('btn-manage-establishments');
    if (btnEstab) btnEstab.addEventListener('click', () => openEstablishmentsModal());

    const estabClose = document.getElementById('establishments-modal-close');
    if (estabClose) estabClose.addEventListener('click', () => {
        document.getElementById('establishments-modal').style.display = 'none';
    });

    // Afficher/masquer le select de bars selon le rôle sélectionné (admin uniquement)
    const roleSelect = document.getElementById('new-account-role');
    const barsRow    = document.getElementById('new-account-bars-row');
    if (roleSelect && barsRow) {
        roleSelect.addEventListener('change', () => {
            barsRow.style.display = roleSelect.value === 'directeur' ? '' : 'none';
        });
    }

    const btnInvite = document.getElementById('btn-invite-account');
    if (btnInvite) btnInvite.addEventListener('click', async () => {
        const staffId = document.getElementById('new-account-staff')?.value || '';
        const email   = document.getElementById('new-account-email')?.value.trim();
        const phone   = document.getElementById('new-account-phone')?.value.trim();
        const role    = document.getElementById('new-account-role')?.value || 'staff';
        if (!email && !phone) { showToast('Email ou numéro de téléphone requis', true); return; }

        // Récupérer les établissements cochés si invitation patron
        let assignedEstablishments = [];
        if (role === 'directeur' && barsRow) {
            assignedEstablishments = Array.from(barsRow.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
        }

        const sm   = allStaff.find(s => String(s._id) === staffId);
        const name = sm ? sm.name : '';
        const btn  = btnInvite;
        btn.disabled    = true;
        btn.textContent = 'Envoi…';
        try {
            const res  = await fetch('/api/users', {
                credentials: 'include',
                method:      'POST',
                headers:     { 'Content-Type': 'application/json' },
                body:        JSON.stringify({ email: email || undefined, phone: phone || undefined, staff_id: role === 'staff' ? (staffId || null) : null, name, role, assigned_establishments: assignedEstablishments }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            await renderAccountsList();
            if (data.manual && data.link) {
                // Email ou SMS non envoyé — afficher le lien à copier
                const via = (phone && !email) ? 'SMS non envoyé' : 'Email non envoyé';
                const box = document.createElement('div');
                box.style.cssText = 'background:#fff9e6;border:1.5px solid #f39c12;border-radius:10px;padding:14px;margin:12px 0;font-size:12px';
                box.innerHTML =
                    '<div style="font-weight:600;color:#f39c12;margin-bottom:8px">⚠️ ' + via + ' — envoie ce lien manuellement :</div>' +
                    '<div style="background:white;border:1px solid #f0e0b0;border-radius:7px;padding:8px 10px;word-break:break-all;font-size:11px;color:#555;margin-bottom:8px">' + data.link + '</div>' +
                    '<button onclick="navigator.clipboard.writeText(\'' + data.link + '\');showToast(\'Lien copié !\')" ' +
                    'style="background:#f39c12;color:white;border:none;border-radius:7px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;width:100%">📋 Copier le lien</button>';
                document.getElementById('accounts-list').after(box);
                showToast('Compte créé — envoie le lien manuellement', true);
            } else if (phone && !email) {
                showToast('Compte créé, SMS envoyé au ' + phone);
            } else {
                showToast('Invitation envoyée à ' + email);
            }
            if (document.getElementById('new-account-email'))  document.getElementById('new-account-email').value  = '';
            if (document.getElementById('new-account-phone'))  document.getElementById('new-account-phone').value  = '';
            if (document.getElementById('new-account-staff'))  document.getElementById('new-account-staff').value  = '';
            // Décocher toutes les cases bars
            if (barsRow) barsRow.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
        } catch (e) {
            showToast(e.message, true);
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Inviter';
        }
    });
});

// ── Modale changement de rôle ─────────────────────────────────────────────────

function openChangeRoleModal(user) {
    const currentRole = user.role;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

    const roles = [
        { value: 'patron',    label: 'Patron',    desc: 'Accès total à tous les bars' },
        { value: 'directeur', label: 'Directeur', desc: 'Accès limité aux bars assignés' },
        { value: 'staff',     label: 'Staff',     desc: 'Accès lecture seule au planning' },
    ];

    const btns = roles.map(r =>
        '<button class="role-choice-btn" data-role="' + r.value + '" style="' +
            'width:100%;text-align:left;padding:10px 14px;border-radius:8px;border:1.5px solid ' +
            (currentRole === r.value ? '#534AB7' : '#e0e0e0') + ';background:' +
            (currentRole === r.value ? '#f0effe' : 'white') + ';margin-bottom:8px;cursor:pointer">' +
            '<div style="font-size:13px;font-weight:600;color:' + (currentRole === r.value ? '#534AB7' : '#333') + '">' + r.label + '</div>' +
            '<div style="font-size:11px;color:#aaa;margin-top:2px">' + r.desc + '</div>' +
        '</button>'
    ).join('');

    // Section bars assignés (visible si on choisit directeur)
    const barsCheckboxes = allEstablishments.map(e => {
        const estabId = e.id || String(e._id);
        const checked = (user.assigned_establishments || []).includes(estabId) ? 'checked' : '';
        return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#333;padding:4px 8px;border:1px solid #e0e0e0;border-radius:6px;background:white;cursor:pointer">' +
            '<input type="checkbox" value="' + estabId + '" ' + checked + ' style="cursor:pointer"> ' + e.name +
            '</label>';
    }).join('');

    overlay.innerHTML =
        '<div style="background:white;border-radius:14px;padding:24px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:4px">Changer le rôle</p>' +
            '<p style="font-size:13px;color:#888;margin-bottom:16px">' + (user.name || user.email) + '</p>' +
            btns +
            '<div id="_bars-section" style="display:' + (currentRole === 'directeur' ? '' : 'none') + ';margin:8px 0 16px;padding:10px 12px;background:#f8f8f8;border-radius:8px;border:1px solid #eee">' +
                '<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Bars assignés</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:6px">' + (barsCheckboxes || '<span style="font-size:12px;color:#ccc">Aucun établissement</span>') + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_rccancel" style="padding:8px 16px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:13px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_rcsave"   style="padding:8px 16px;border-radius:8px;border:none;background:#1a1a2e;color:white;font-size:13px;font-weight:600;cursor:pointer">Enregistrer</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);

    let selectedRole = currentRole;
    const barsSection = overlay.querySelector('#_bars-section');

    // Sélection du rôle
    overlay.querySelectorAll('.role-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedRole = btn.dataset.role;
            overlay.querySelectorAll('.role-choice-btn').forEach(b => {
                const active = b.dataset.role === selectedRole;
                b.style.borderColor = active ? '#534AB7' : '#e0e0e0';
                b.style.background  = active ? '#f0effe' : 'white';
                b.querySelector('div').style.color = active ? '#534AB7' : '#333';
            });
            barsSection.style.display = selectedRole === 'directeur' ? '' : 'none';
        });
    });

    overlay.querySelector('#_rccancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_rcsave').addEventListener('click', async () => {
        const assignedBars = selectedRole === 'directeur'
            ? Array.from(overlay.querySelectorAll('#_bars-section input:checked')).map(cb => cb.value)
            : [];
        try {
            const res = await fetch('/api/users/' + user._id + '/role', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: selectedRole, assigned_establishments: assignedBars }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            close();
            await renderAccountsList();
            showToast('Rôle de ' + (user.name || user.email) + ' mis à jour');
        } catch (e) { showToast(e.message, true); }
    });
}

// ── Modale assignation des bars à un patron ───────────────────────────────────

function openAssignBarsModal(user) {
    const assigned = user.assigned_establishments || [];
    const overlay  = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

    const checkboxes = allEstablishments.map(e => {
        const estabId = e.id || String(e._id);
        const checked = assigned.includes(estabId) ? 'checked' : '';
        return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#333;padding:6px 0;cursor:pointer">' +
            '<input type="checkbox" value="' + estabId + '" ' + checked + ' style="width:15px;height:15px;cursor:pointer">' +
            e.name + (e.type ? ' <span style="font-size:11px;color:#aaa">(' + (e.type === 'pub' ? 'Pub' : 'Resto') + ')</span>' : '') +
            '</label>';
    }).join('');

    overlay.innerHTML =
        '<div style="background:white;border-radius:14px;padding:24px;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
            '<p style="font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:4px">Bars assignés à</p>' +
            '<p style="font-size:13px;color:#888;margin-bottom:16px">' + (user.name || user.email) + '</p>' +
            '<div style="margin-bottom:20px">' + (checkboxes || '<p style="color:#ccc;font-size:13px">Aucun établissement</p>') + '</div>' +
            '<div style="display:flex;gap:8px;justify-content:flex-end">' +
                '<button id="_abcancel" style="padding:8px 16px;border-radius:8px;border:1px solid #e0e0e0;background:white;font-size:13px;cursor:pointer;color:#555">Annuler</button>' +
                '<button id="_absave"   style="padding:8px 16px;border-radius:8px;border:none;background:#1a1a2e;color:white;font-size:13px;font-weight:600;cursor:pointer">Enregistrer</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(overlay);
    const close = () => document.body.removeChild(overlay);

    overlay.querySelector('#_abcancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#_absave').addEventListener('click', async () => {
        const selected = Array.from(overlay.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
        try {
            const res = await fetch('/api/users/' + user._id + '/establishments', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assigned_establishments: selected }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            close();
            showToast('Accès mis à jour pour ' + (user.name || user.email));
        } catch (e) { showToast(e.message, true); }
    });
}
async function patronResetPassword(userId, userName) {
    showPrompt('Nouveau mot de passe pour ' + userName, '8 caractères minimum', async (pwd) => {
        if (pwd.length < 8) { showToast('Minimum 8 caractères', true); return; }
        try {
            const res = await fetch('/api/users/' + userId + '/reset-password', {
                credentials: 'include',
                method:      'PATCH',
                headers:     { 'Content-Type': 'application/json' },
                body:        JSON.stringify({ password: pwd }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            showToast('Mot de passe de ' + userName + ' mis à jour');
        } catch (e) { showToast(e.message, true); }
    });
}

async function deleteAccount(userId, userName) {
    showConfirm('Supprimer le compte de <strong>' + userName + '</strong> ?', async () => {
        try {
            const res  = await fetch('/api/users/' + userId, { credentials: 'include', method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            await renderAccountsList();
            showToast('Compte de ' + userName + ' supprimé');
        } catch (e) { showToast(e.message, true); }
    });
}

// ── Récap mensuel ────────────────────────────────────────────────────────────

// ── Modale CA (saisie d'un CA en retard) ─────────────────────────────────────

function openRevenueModal() {
    const modal = document.getElementById('revenue-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Peupler les établissements
    const sel = document.getElementById('revenue-modal-estab');
    if (sel.children.length === 0) {
        allEstablishments.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id; opt.textContent = e.name;
            sel.appendChild(opt);
        });
    }
    // Masquer le sélecteur s'il n'y a qu'un seul établissement
    const row = document.getElementById('revenue-modal-estab-row');
    if (row) row.style.display = allEstablishments.length > 1 ? '' : 'none';
    if (currentVenueId) sel.value = currentVenueId;

    // Date par défaut : hier (CA saisi avec un jour de retard typiquement)
    const dateInput = document.getElementById('revenue-modal-date');
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const ystr = yesterday.getFullYear() + '-' +
        String(yesterday.getMonth() + 1).padStart(2, '0') + '-' +
        String(yesterday.getDate()).padStart(2, '0');
    dateInput.value = ystr;
    // Limite future : aujourd'hui (pas de CA dans le futur)
    const tstr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    dateInput.max = tstr;

    // Reset feedback + input
    const fb = document.getElementById('revenue-modal-feedback');
    if (fb) { fb.style.display = 'none'; fb.textContent = ''; }
    document.getElementById('revenue-modal-input').value = '';

    prefillRevenueModal();
}

async function prefillRevenueModal() {
    const date  = document.getElementById('revenue-modal-date').value;
    const estab = document.getElementById('revenue-modal-estab').value;
    const input = document.getElementById('revenue-modal-input');
    const hint  = document.getElementById('revenue-modal-hint');
    if (!date || !estab) return;
    try {
        const res = await fetch('/api/revenue/' + encodeURIComponent(estab) + '/' + date, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.revenue != null) {
            input.value = data.revenue;
            if (hint) { hint.style.display = 'block'; hint.textContent = '✏️ Un CA existe déjà pour ce jour, vous pouvez le corriger.'; }
        } else {
            input.value = '';
            if (hint) { hint.style.display = 'none'; hint.textContent = ''; }
        }
    } catch { /* silencieux */ }
}

async function saveRevenueFromModal() {
    const date  = document.getElementById('revenue-modal-date').value;
    const estab = document.getElementById('revenue-modal-estab').value;
    const v     = parseFloat(document.getElementById('revenue-modal-input').value);
    const fb    = document.getElementById('revenue-modal-feedback');
    const btn   = document.getElementById('revenue-modal-save');
    if (!date)  { fb.style.color = 'var(--danger)'; fb.style.display = 'block'; fb.textContent = 'Date requise'; return; }
    if (!estab) { fb.style.color = 'var(--danger)'; fb.style.display = 'block'; fb.textContent = 'Établissement requis'; return; }
    if (Number.isNaN(v) || v < 0) { fb.style.color = 'var(--danger)'; fb.style.display = 'block'; fb.textContent = 'Montant invalide'; return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Enregistrement…';
    try {
        const res = await fetch('/api/revenue', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, establishment_id: estab, revenue: v }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        fb.style.color = 'var(--success-text)'; fb.style.display = 'block'; fb.textContent = '✅ CA enregistré';
        showToast('CA enregistré pour le ' + date);
        setTimeout(() => {
            document.getElementById('revenue-modal').style.display = 'none';
        }, 800);
    } catch (e) {
        fb.style.color = 'var(--danger)'; fb.style.display = 'block'; fb.textContent = e.message || 'Erreur';
    } finally {
        btn.disabled = false; btn.textContent = old;
    }
}

function openRecapModal() {
    const modal = document.getElementById('recap-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Peupler le sélecteur mois (12 derniers mois + mois en cours)
    const monthSelect = document.getElementById('recap-month');
    if (monthSelect.children.length === 0) {
        const now = new Date();
        for (let i = 0; i < 13; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            const label = MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
            if (i === 0) opt.selected = true;
            monthSelect.appendChild(opt);
        }
    }

    // Peupler le sélecteur établissement
    const estabSelect = document.getElementById('recap-estab');
    if (estabSelect.children.length <= 1) {
        allEstablishments.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = e.name;
            estabSelect.appendChild(opt);
        });
    }

    // Listener charger (une seule fois)
    const btnLoad = document.getElementById('recap-load');
    if (!btnLoad._bound) {
        btnLoad._bound = true;
        btnLoad.addEventListener('click', loadRecapData);
    }

    // Listener imprimer
    const btnPrint = document.getElementById('recap-print');
    if (!btnPrint._bound) {
        btnPrint._bound = true;
        btnPrint.addEventListener('click', () => window.print());
    }

    // Listener export Excel
    const btnXlsx = document.getElementById('recap-export-csv');
    if (btnXlsx && !btnXlsx._bound) {
        btnXlsx._bound = true;
        btnXlsx.addEventListener('click', exportRecapXlsx);
    }

    // Listener fermer
    const btnClose = document.getElementById('recap-modal-close');
    if (!btnClose._bound) {
        btnClose._bound = true;
        btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    }

    // Charger les données du mois en cours
    loadRecapData();
}

let _recapLastData = null;
let _recapLastMeta = null;

async function loadRecapData() {
    const month = document.getElementById('recap-month').value;
    const estabId = document.getElementById('recap-estab').value;
    const content = document.getElementById('recap-content');
    content.innerHTML = '<div style="padding:24px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    _recapLastData = null;
    _recapLastMeta = null;

    try {
        let url = '/api/recap-mensuel?month=' + month;
        if (estabId) url += '&establishment_id=' + encodeURIComponent(estabId);
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        _recapLastData = data;
        const estabSel = document.getElementById('recap-estab');
        const estabLabel = estabId ? (estabSel.options[estabSel.selectedIndex]?.textContent || '') : 'Tous';
        _recapLastMeta = { month, estabLabel };

        if (data.length === 0) {
            content.innerHTML = '<div style="padding:24px;text-align:center;color:#ccc;font-size:13px">Aucun shift ce mois-ci</div>';
            return;
        }

        const fmtH = h => ShiftHours.fmtDurationH(h, { nullText: '—', minus: '−' });

        let totalPlanned = 0, totalReal = 0, totalDays = 0, totalConge = 0;
        let hasAnyReal = false;

        // Colonnes par établissement (uniquement quand on n'a pas filtré sur un seul)
        const showByEstab = !estabId;
        const estabCols = [];
        if (showByEstab) {
            const seen = new Map();
            data.forEach(s => {
                (s.by_establishment || []).forEach(b => {
                    if (!seen.has(b.establishment_id))
                        seen.set(b.establishment_id, { id: b.establishment_id, name: b.establishment_name });
                });
            });
            estabCols.push(...Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)));
        }

        let tableHTML = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:560px">';
        tableHTML += '<thead>';
        if (estabCols.length) {
            // En-tête groupé : un bloc "détail planifié" + un bloc "détail réel"
            tableHTML += '<tr style="background:#f8f8f8">' +
                '<th rowspan="2" style="text-align:left;padding:8px 10px;vertical-align:bottom;border-bottom:2px solid #e0e0e0">Nom</th>' +
                '<th colspan="' + estabCols.length + '" style="text-align:center;padding:6px;border-bottom:1px solid #e0e0e0;border-left:2px solid #e0e0e0;color:#555">Détail planifié</th>' +
                '<th colspan="' + estabCols.length + '" style="text-align:center;padding:6px;border-bottom:1px solid #e0e0e0;border-left:2px solid #e0e0e0;color:#2980b9">Détail réel</th>' +
                '<th rowspan="2" style="text-align:center;padding:8px 6px;vertical-align:bottom;border-bottom:2px solid #e0e0e0;border-left:2px solid #e0e0e0">Jours</th>' +
                '<th rowspan="2" style="text-align:center;padding:8px 6px;vertical-align:bottom;border-bottom:2px solid #e0e0e0" title="Jours de congé validés">🌴 Congés</th>' +
                '<th rowspan="2" style="text-align:center;padding:8px 6px;vertical-align:bottom;border-bottom:2px solid #e0e0e0">H. planifiées</th>' +
                '<th rowspan="2" style="text-align:center;padding:8px 6px;vertical-align:bottom;border-bottom:2px solid #e0e0e0">H. réelles</th>' +
                '<th rowspan="2" style="text-align:center;padding:8px 6px;vertical-align:bottom;border-bottom:2px solid #e0e0e0">Écart</th>' +
                '</tr>';
            tableHTML += '<tr style="background:#f8f8f8;border-bottom:2px solid #e0e0e0">';
            estabCols.forEach((e, i) => {
                tableHTML += '<th style="text-align:center;padding:8px 6px;white-space:nowrap' + (i === 0 ? ';border-left:2px solid #e0e0e0' : '') + '" title="' + escapeHtml(e.name) + '">' + escapeHtml(e.name) + '</th>';
            });
            estabCols.forEach((e, i) => {
                tableHTML += '<th style="text-align:center;padding:8px 6px;white-space:nowrap;color:#2980b9' + (i === 0 ? ';border-left:2px solid #e0e0e0' : '') + '" title="' + escapeHtml(e.name) + '">' + escapeHtml(e.name) + '</th>';
            });
            tableHTML += '</tr>';
        } else {
            tableHTML += '<tr style="background:#f8f8f8;border-bottom:2px solid #e0e0e0">' +
                '<th style="text-align:left;padding:8px 10px">Nom</th>' +
                '<th style="text-align:center;padding:8px 6px">Jours</th>' +
                '<th style="text-align:center;padding:8px 6px" title="Jours de congé validés">🌴 Congés</th>' +
                '<th style="text-align:center;padding:8px 6px">H. planifiées</th>' +
                '<th style="text-align:center;padding:8px 6px">H. réelles</th>' +
                '<th style="text-align:center;padding:8px 6px">Écart</th>' +
                '</tr>';
        }
        tableHTML += '</thead><tbody>';

        const estabPlannedTotals = estabCols.map(() => 0);
        const estabRealTotals    = estabCols.map(() => 0);

        data.forEach(s => {
            totalPlanned += s.planned_hours;
            totalDays    += s.days;
            if (s.real_hours != null) { totalReal += s.real_hours; hasAnyReal = true; }

            const ecartStr = s.ecart != null
                ? (s.ecart > 0 ? '<span style="color:#d68910">+' + fmtH(s.ecart) + '</span>' : s.ecart < 0 ? '<span style="color:#c0392b">' + fmtH(s.ecart) + '</span>' : '<span style="color:#27ae60">=</span>')
                : '—';

            const realStr = s.real_hours != null
                ? fmtH(s.real_hours) + (s.partial ? ' <span class="badge badge--warning" title="Certains shifts non pointés">partiel</span>' : '')
                : '—';

            // Ventilation par établissement (maps pour lookup rapide)
            const byEstabPlanned = {};
            const byEstabReal    = {};
            (s.by_establishment || []).forEach(b => {
                byEstabPlanned[b.establishment_id] = b.planned_hours;
                byEstabReal[b.establishment_id]    = b.real_hours;
            });

            tableHTML += '<tr style="border-bottom:1px solid #f0f0f0">' +
                '<td style="padding:8px 10px;display:flex;align-items:center;gap:6px">' +
                    '<span style="width:8px;height:8px;border-radius:50%;background:' + s.color + ';flex-shrink:0;display:inline-block"></span>' +
                    '<span style="font-weight:600">' + escapeHtml(s.staff_name) + '</span>' +
                '</td>';
            estabCols.forEach((e, i) => {
                const h = byEstabPlanned[e.id];
                if (h != null) estabPlannedTotals[i] += h;
                tableHTML += '<td style="text-align:center;padding:8px 6px' + (i === 0 ? ';border-left:2px solid #e0e0e0' : '') + '">' + (h != null ? fmtH(h) : '') + '</td>';
            });
            estabCols.forEach((e, i) => {
                const h = byEstabReal[e.id];
                if (h != null) estabRealTotals[i] += h;
                tableHTML += '<td style="text-align:center;padding:8px 6px;color:#2980b9' + (i === 0 ? ';border-left:2px solid #e0e0e0' : '') + '">' + (h != null ? fmtH(h) : '') + '</td>';
            });
            totalConge += s.conge_days || 0;
            const congeStr = s.conge_days > 0
                ? '<span style="color:#10b981;font-weight:600">' + s.conge_days + ' j</span>'
                : '<span style="color:#ccc">—</span>';
            tableHTML +=
                '<td style="text-align:center;padding:8px 6px;border-left:2px solid #e0e0e0">' + s.days + '</td>' +
                '<td style="text-align:center;padding:8px 6px">' + congeStr + '</td>' +
                '<td style="text-align:center;padding:8px 6px">' + fmtH(s.planned_hours) + '</td>' +
                '<td style="text-align:center;padding:8px 6px">' + realStr + '</td>' +
                '<td style="text-align:center;padding:8px 6px">' + ecartStr + '</td>' +
                '</tr>';
        });

        // Ligne total
        const totalEcart = hasAnyReal ? totalReal - totalPlanned : null;
        const totalEcartStr = totalEcart != null
            ? (totalEcart > 0 ? '<span style="color:#d68910">+' + fmtH(totalEcart) + '</span>' : totalEcart < 0 ? '<span style="color:#c0392b">' + fmtH(totalEcart) + '</span>' : '<span style="color:#27ae60">=</span>')
            : '—';

        tableHTML += '<tr style="border-top:2px solid #e0e0e0;font-weight:700;background:#f8f8f8">' +
            '<td style="padding:8px 10px">Total (' + data.length + ' staff)</td>';
        estabPlannedTotals.forEach((t, i) => {
            tableHTML += '<td style="text-align:center;padding:8px 6px' + (i === 0 ? ';border-left:2px solid #e0e0e0' : '') + '">' + (t > 0 ? fmtH(t) : '—') + '</td>';
        });
        estabRealTotals.forEach((t, i) => {
            tableHTML += '<td style="text-align:center;padding:8px 6px;color:#2980b9' + (i === 0 ? ';border-left:2px solid #e0e0e0' : '') + '">' + (t > 0 ? fmtH(t) : '—') + '</td>';
        });
        tableHTML +=
            '<td style="text-align:center;padding:8px 6px;border-left:2px solid #e0e0e0">' + totalDays + '</td>' +
            '<td style="text-align:center;padding:8px 6px">' + (totalConge > 0 ? totalConge + ' j' : '—') + '</td>' +
            '<td style="text-align:center;padding:8px 6px">' + fmtH(totalPlanned) + '</td>' +
            '<td style="text-align:center;padding:8px 6px">' + (hasAnyReal ? fmtH(totalReal) : '—') + '</td>' +
            '<td style="text-align:center;padding:8px 6px">' + totalEcartStr + '</td>' +
            '</tr>';

        tableHTML += '</tbody></table></div>';
        content.innerHTML = tableHTML;

    } catch (e) {
        content.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + e.message + '</div>';
    }
}

function exportRecapXlsx() {
    if (!_recapLastData || _recapLastData.length === 0) {
        showToast('Aucune donn\u00E9e \u00E0 exporter', true);
        return;
    }
    if (!window.XLSX) {
        showToast('Biblioth\u00E8que Excel non charg\u00E9e', true);
        return;
    }
    const fmtH = h => ShiftHours.fmtDurationH(h, { nullText: '', minus: '-', padMinutes: true });
    const { month, estabLabel } = _recapLastMeta || {};
    const filteredOnEstab = estabLabel && estabLabel !== 'Tous';

    // Colonnes par \u00E9tablissement uniquement si on n'a pas filtr\u00E9 sur un seul
    const estabCols = [];
    if (!filteredOnEstab) {
        const seen = new Map();
        _recapLastData.forEach(s => {
            (s.by_establishment || []).forEach(b => {
                if (!seen.has(b.establishment_id))
                    seen.set(b.establishment_id, { id: b.establishment_id, name: b.establishment_name });
            });
        });
        estabCols.push(...Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)));
    }

    const header = ['Nom']
        .concat(estabCols.map(e => 'Plan. ' + e.name))
        .concat(estabCols.map(e => 'R\u00E9el ' + e.name))
        .concat(['Jours', 'Cong\u00E9s (j)', 'Heures planifi\u00E9es', 'Heures r\u00E9elles', '\u00C9cart', 'Partiel']);

    const rows = [
        ['R\u00E9capitulatif mensuel ' + (month || ''), '\u00C9tablissement : ' + (estabLabel || 'Tous')],
        [],
        header,
    ];

    let totalPlanned = 0, totalReal = 0, totalDays = 0, totalConge = 0, hasAnyReal = false;
    const estabPlannedTotals = estabCols.map(() => 0);
    const estabRealTotals    = estabCols.map(() => 0);

    _recapLastData.forEach(s => {
        totalPlanned += s.planned_hours;
        totalDays    += s.days;
        totalConge   += s.conge_days || 0;
        if (s.real_hours != null) { totalReal += s.real_hours; hasAnyReal = true; }

        const byEstabPlanned = {};
        const byEstabReal    = {};
        (s.by_establishment || []).forEach(b => {
            byEstabPlanned[b.establishment_id] = b.planned_hours;
            byEstabReal[b.establishment_id]    = b.real_hours;
        });

        const row = [s.staff_name];
        estabCols.forEach((e, i) => {
            const h = byEstabPlanned[e.id];
            if (h != null) estabPlannedTotals[i] += h;
            row.push(h != null ? fmtH(h) : '');
        });
        estabCols.forEach((e, i) => {
            const h = byEstabReal[e.id];
            if (h != null) estabRealTotals[i] += h;
            row.push(h != null ? fmtH(h) : '');
        });
        row.push(
            s.days,
            s.conge_days > 0 ? s.conge_days : '',
            fmtH(s.planned_hours),
            s.real_hours != null ? fmtH(s.real_hours) : '',
            s.ecart != null ? fmtH(s.ecart) : '',
            s.partial ? 'oui' : ''
        );
        rows.push(row);
    });

    const totalEcart = hasAnyReal ? totalReal - totalPlanned : null;
    const totalRow = ['Total (' + _recapLastData.length + ' staff)'];
    estabPlannedTotals.forEach(t => totalRow.push(t > 0 ? fmtH(t) : ''));
    estabRealTotals.forEach(t => totalRow.push(t > 0 ? fmtH(t) : ''));
    totalRow.push(
        totalDays,
        totalConge > 0 ? totalConge : '',
        fmtH(totalPlanned),
        hasAnyReal ? fmtH(totalReal) : '',
        totalEcart != null ? fmtH(totalEcart) : '',
        ''
    );
    rows.push(totalRow);

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Largeurs auto : on prend le plus large entre l'en-t\u00EAte et le contenu
    ws['!cols'] = header.map((h, ci) => {
        let max = String(h || '').length + 2;
        for (let ri = 3; ri < rows.length; ri++) {
            const v = rows[ri][ci];
            if (v != null) max = Math.max(max, String(v).length + 2);
        }
        return { wch: Math.min(Math.max(max, 8), 32) };
    });

    const wb = XLSX.utils.book_new();
    const sheetName = ('R\u00E9cap ' + (month || '')).slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const safeEstab = (estabLabel || 'tous').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    XLSX.writeFile(wb, 'recap-' + (month || 'mois') + '-' + safeEstab + '.xlsx');
}

/* ── Échanges de shifts — côté patron (F-05) — DÉSACTIVÉ ────────────────────

async function loadSwapsBadge() {
    try {
        const res = await fetch('/api/shift-swaps/count', { credentials: 'include' });
        if (!res.ok) return;
        const { count } = await res.json();
        const badge        = document.getElementById('swaps-badge');
        const drawerBadge  = document.getElementById('drawer-swaps-badge');
        [badge, drawerBadge].forEach(el => {
            if (!el) return;
            el.textContent = count;
            el.style.display = count > 0 ? 'flex' : 'none';
        });
    } catch {}
}

async function openSwapsPanel() {
    const modal = document.getElementById('swaps-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    await loadSwapsList();
}

function _fmtSwapTime(h) {
    if (h == null) return '';
    // Les heures >= 24 représentent le lendemain (nuit tardive) — on wrap sur 00-23.
    const normalized = ((h % 24) + 24) % 24;
    const hrs = Math.floor(normalized);
    const mins = Math.round((normalized - hrs) * 60);
    return String(hrs).padStart(2, '0') + 'h' + String(mins).padStart(2, '0');
}

function _estabName(id) {
    const e = allEstablishments.find(x => x.id === id || String(x._id) === id);
    return e ? e.name : (id || '—');
}

function _fmtSwapDateFR(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const mois  = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
    return jours[date.getDay()] + ' ' + d + ' ' + mois[m - 1];
}

async function loadSwapsList() {
    const list = document.getElementById('swaps-list');
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    try {
        const res = await fetch('/api/shift-swaps/pending', { credentials: 'include' });
        const swaps = await res.json();
        if (!res.ok) throw new Error(swaps.error || 'Erreur');
        if (swaps.length === 0) {
            list.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">Aucune demande d\'échange en attente</div>';
            return;
        }
        list.innerHTML = '';
        swaps.forEach(s => list.appendChild(_renderSwapCard(s)));
    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + (e.message || 'Erreur') + '</div>';
    }
}

function _renderSwapCard(swap) {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--color-bg-secondary,#f8f8f8);border:1px solid var(--color-border-secondary,#eee);border-radius:12px;margin:10px 14px;padding:12px 14px';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:12px;color:#888;margin-bottom:8px';
    const when = swap.created_at ? new Date(swap.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    header.textContent = 'Demandé le ' + when;
    card.appendChild(header);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:stretch;flex-wrap:wrap';

    const makeSide = (title, staffName, date, st, et, estabId) => {
        const div = document.createElement('div');
        div.style.cssText = 'flex:1;min-width:200px;background:white;border:1px solid #eee;border-radius:8px;padding:10px 12px';
        div.innerHTML =
            '<div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">' + escapeHtml(title) + '</div>' +
            '<div style="font-weight:700;font-size:14px;color:#222">' + (staffName ? escapeHtml(staffName) : '—') + '</div>' +
            '<div style="font-size:12px;color:#555;margin-top:4px">' + _fmtSwapDateFR(date) + ' · ' + _fmtSwapTime(st) + ' → ' + _fmtSwapTime(et) + '</div>' +
            '<div style="font-size:11px;color:#888;margin-top:2px">' + escapeHtml(_estabName(estabId)) + '</div>';
        return div;
    };

    row.appendChild(makeSide('Proposé par', swap.from_staff_name, swap.from_date, swap.from_start_time, swap.from_end_time, swap.from_establishment_id));

    const arrow = document.createElement('div');
    arrow.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:20px;color:#534AB7;padding:0 4px';
    arrow.textContent = '⇄';
    row.appendChild(arrow);

    row.appendChild(makeSide('Contre', swap.to_staff_name, swap.to_date, swap.to_start_time, swap.to_end_time, swap.to_establishment_id));
    card.appendChild(row);

    if (swap.note) {
        const note = document.createElement('div');
        note.style.cssText = 'margin-top:10px;padding:8px 10px;background:#fff8e1;border-left:3px solid #f39c12;border-radius:4px;font-size:12px;color:#555';
        note.textContent = '« ' + swap.note + ' »';
        card.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end';
    const btnReject = document.createElement('button');
    btnReject.textContent = '✗ Refuser';
    btnReject.style.cssText = 'padding:7px 14px;border-radius:8px;border:1.5px solid #e74c3c;background:#fdecec;color:#c0392b;font-size:12px;font-weight:600;cursor:pointer';
    btnReject.addEventListener('click', () => _decideSwap(swap._id, 'reject', card));
    const btnApprove = document.createElement('button');
    btnApprove.textContent = '✓ Approuver';
    btnApprove.style.cssText = 'padding:7px 14px;border-radius:8px;border:none;background:#27ae60;color:white;font-size:12px;font-weight:600;cursor:pointer';
    btnApprove.addEventListener('click', () => _decideSwap(swap._id, 'approve', card));
    actions.appendChild(btnReject);
    actions.appendChild(btnApprove);
    card.appendChild(actions);

    return card;
}

async function _decideSwap(swapId, action, card) {
    let reason = '';
    if (action === 'reject') {
        reason = prompt('Raison du refus (optionnel) :') || '';
        if (reason === null) return;
    } else {
        if (!confirm('Valider cet échange ? Les deux shifts seront inversés.')) return;
    }
    try {
        const res = await fetch('/api/shift-swaps/' + swapId + '/' + action, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action === 'reject' ? { reason } : {}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
        showToast(data.message || (action === 'approve' ? 'Échange approuvé' : 'Échange refusé'));
        card.remove();
        loadSwapsBadge();
        // Rafraîchir la vue planning si on est sur la journée concernée
        try { if (selectedDate) await loadDayDetail(selectedDate); } catch {}
        // Si plus aucune carte, remettre le message vide
        const list = document.getElementById('swaps-list');
        if (list && list.children.length === 0) {
            list.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">Aucune demande d\'échange en attente</div>';
        }
    } catch (e) {
        showToast(e.message || 'Erreur', true);
    }
}

─────────────────────────────────────────────────────────────────────────── */

// ── Disponibilités — côté patron ──────────────────────────────────────────────

async function loadDisposBadge() {
    try {
        // Le bouton « Dispos » est le hub absences : pastille = dispos + congés en attente
        const [dispRes, congRes] = await Promise.all([
            fetch('/api/dispos/count', { credentials: 'include' }),
            fetch('/api/conges/pending-count', { credentials: 'include' }),
        ]);
        let count = 0;
        if (dispRes.ok) count += (await dispRes.json()).count || 0;
        if (congRes.ok) count += (await congRes.json()).count || 0;
        const badge = document.getElementById('dispos-badge');
        if (!badge) return;
        badge.textContent   = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    } catch { }
}

// ── KPI complétion des dispos (carte vue planning) ───────────────────────────

function _kpiProgressBar(sent, total, big) {
    const pct = total > 0 ? Math.round((sent / total) * 100) : 0;
    const color = total === 0 ? '#cbd5e1' : (pct >= 100 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444');
    const h = big ? 10 : 7;
    return '<div style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;height:' + h + 'px;background:#eef0f4;border-radius:6px;overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:6px;transition:width .3s"></div>' +
        '</div>' +
        '<span style="font-size:' + (big ? '13' : '12') + 'px;font-weight:700;color:#1a1a2e;white-space:nowrap">' + sent + '/' + total + '</span>' +
    '</div>';
}

let _kpiData = null;          // dernière réponse /api/dispos/kpi
let _kpiMissingOpen = false;  // liste des non-envoyeurs dépliée ?

async function loadDisposKpi() {
    const card = document.getElementById('dispos-kpi-card');
    if (!card) return;
    try {
        // Suit la semaine AFFICHÉE dans le planning (currentWeekStart)
        const from = toDateStr(currentWeekStart);
        const to   = toDateStr(addDays(currentWeekStart, 6));
        const res  = await fetch('/api/dispos/kpi?from=' + from + '&to=' + to, { credentials: 'include' });
        if (!res.ok) { card.style.display = 'none'; return; }
        const data = await res.json();
        if (!data.authorized) { card.style.display = 'none'; return; }
        _kpiData = data;
        renderDisposKpiCard();
    } catch { card.style.display = 'none'; }
}

function renderDisposKpiCard() {
    const card = document.getElementById('dispos-kpi-card');
    if (!card || !_kpiData) return;
    const data = _kpiData;
    const o    = data.overall || { sent: 0, total: 0 };
    const pct  = o.total > 0 ? Math.round((o.sent / o.total) * 100) : 0;
    const missing = data.missing || [];
    const weekLabel = 'semaine du ' + currentWeekStart.getDate() + ' ' + MONTH_NAMES[currentWeekStart.getMonth()];

    let html = '<div style="background:var(--light-card,#fff);border:1px solid var(--light-border,#e8eaed);border-radius:14px;padding:14px 16px;margin:0 0 12px">';
    // En-tête cliquable
    html += '<div id="dispos-kpi-toggle" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;cursor:pointer" title="Voir qui n\'a pas envoyé">' +
            '<span style="font-size:13px;font-weight:700;color:var(--text-primary,#1a1a2e)">🗓️ Dispos envoyées — ' + weekLabel + '</span>' +
            '<span style="font-size:12px;color:var(--text-secondary,#777);white-space:nowrap">' + pct + '% ' + (_kpiMissingOpen ? '▾' : '▸') + '</span>' +
        '</div>' +
        _kpiProgressBar(o.sent, o.total, true);
    const bars = (data.by_establishment || []).filter(b => b.total > 0 || b.sent > 0);
    if (bars.length) {
        html += '<div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">';
        bars.forEach(b => {
            html += '<div style="display:flex;align-items:center;gap:10px">' +
                '<span style="flex:0 0 96px;font-size:12px;color:var(--text-secondary,#777);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtml(b.establishment_name) + '">' + escapeHtml(b.establishment_name) + '</span>' +
                '<div style="flex:1">' + _kpiProgressBar(b.sent, b.total, false) + '</div>' +
            '</div>';
        });
        html += '</div>';
    }
    // Liste dépliable des staff sans dispo
    if (_kpiMissingOpen) {
        html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--light-border,#e8eaed)">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-secondary,#777);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px">Pas encore envoyé (' + missing.length + ')</div>';
        if (!missing.length) {
            html += '<div style="font-size:13px;color:#10b981;font-weight:600">✅ Tout le monde a envoyé ses dispos</div>';
        } else {
            html += '<div style="display:flex;flex-direction:column;gap:6px">';
            missing.forEach(m => {
                const estabs = (m.establishments || []).length ? ' <span style="color:#aaa">· ' + escapeHtml(m.establishments.join(', ')) + '</span>' : '';
                html += '<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-primary,#1a1a2e)">' +
                    '<span style="width:8px;height:8px;border-radius:50%;background:' + escapeHtml(m.color || '#888') + ';flex-shrink:0;display:inline-block"></span>' +
                    '<span style="font-weight:600">' + escapeHtml(m.name) + '</span>' + estabs +
                '</div>';
            });
            html += '</div>';
        }
        html += '</div>';
    }
    html += '</div>';
    card.innerHTML = html;
    card.style.display = '';

    const toggle = document.getElementById('dispos-kpi-toggle');
    if (toggle) toggle.addEventListener('click', () => {
        _kpiMissingOpen = !_kpiMissingOpen;
        renderDisposKpiCard();
    });
}

// ── Congés / vacances — côté patron (onglet de la modale Dispos) ─────────────

let _congesFilter = 'all';            // all | pending | approved
let _congesAll    = [];               // congés à venir (cache, tous statuts)
const _congesCollapsedMonths = new Set(); // clés 'YYYY-MM' repliées

const _CONGE_STATUS_PATRON = {
    pending:  { icon: '⏳', cls: 'badge--warning', label: 'En attente' },
    approved: { icon: '✓',  cls: 'badge--success', label: 'Validé' },
    rejected: { icon: '✗',  cls: 'badge--danger',  label: 'Refusé' },
};

const _MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function _fmtCongeDateFr(iso) {
    const MONTHS = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
    const [, m, d] = iso.split('-').map(Number);
    return d + ' ' + MONTHS[m - 1];
}

// Badge de l'onglet Congés (demandes en attente). La pastille header est gérée
// par loadDisposBadge() qui agrège dispos + congés.
async function loadCongesBadge() {
    try {
        const res = await fetch('/api/conges/pending-count', { credentials: 'include' });
        if (!res.ok) return;
        const { count } = await res.json();
        const badge = document.getElementById('conges-tab-badge');
        if (!badge) return;
        badge.textContent   = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    } catch { }
}

async function loadCongesList() {
    const list = document.getElementById('conges-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;font-size:13px">Chargement…</div>';
    try {
        const today = toDateStr(new Date());
        const res = await fetch('/api/conges?from=' + today, { credentials: 'include' });
        if (!res.ok) throw new Error();
        _congesAll = await res.json();
        renderCongesListPatron();
    } catch {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:#c0392b;font-size:13px">Erreur de chargement.</div>';
    }
}

function renderCongesListPatron() {
    const list = document.getElementById('conges-list');
    if (!list) return;
    const search = normalizeStr(document.getElementById('conges-search')?.value || '').trim();
    let rows = _congesAll.slice();
    if (_congesFilter !== 'all') rows = rows.filter(c => c.status === _congesFilter);
    if (search) rows = rows.filter(c => normalizeStr(c.staff_name || '').includes(search));

    if (!rows.length) {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:#999;font-size:13px">Aucun congé à afficher.</div>';
        return;
    }

    // Regrouper par mois (clé 'YYYY-MM'), tri chronologique
    const groups = new Map();
    rows.sort((a, b) => a.start_date.localeCompare(b.start_date));
    rows.forEach(c => {
        const key = c.start_date.slice(0, 7);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    });

    list.innerHTML = '';
    [...groups.keys()].sort().forEach(key => {
        const [y, m] = key.split('-').map(Number);
        const collapsed = _congesCollapsedMonths.has(key);
        const items = groups.get(key);

        const header = document.createElement('button');
        header.style.cssText = 'width:100%;text-align:left;background:var(--light-bg);border:none;border-bottom:1px solid var(--light-border);padding:8px 16px;font-size:12px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.4px;cursor:pointer;display:flex;align-items:center;gap:6px';
        header.innerHTML = '<span style="display:inline-block;width:10px">' + (collapsed ? '▸' : '▾') + '</span>' +
            _MONTHS_FR[m - 1] + ' ' + y + ' <span style="color:#aaa;font-weight:600">(' + items.length + ')</span>';
        header.addEventListener('click', () => {
            if (_congesCollapsedMonths.has(key)) _congesCollapsedMonths.delete(key);
            else _congesCollapsedMonths.add(key);
            renderCongesListPatron();
        });
        list.appendChild(header);
        if (collapsed) return;

        items.forEach(c => list.appendChild(_buildCongeRow(c)));
    });
}

function _buildCongeRow(c) {
    const st = _CONGE_STATUS_PATRON[c.status] || _CONGE_STATUS_PATRON.pending;
    const range = _fmtCongeDateFr(c.start_date) + (c.start_date === c.end_date ? '' : ' → ' + _fmtCongeDateFr(c.end_date));
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px 16px;border-bottom:1px solid var(--light-border);display:flex;align-items:center;gap:8px';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    info.innerHTML =
        '<div style="font-weight:600;color:var(--text-primary);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(c.staff_name || '?') + '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🌴 ' + range + (c.mode === 'info' ? ' · info' : '') + (c.reason ? ' · ' + escapeHtml(c.reason) : '') + '</div>';
    row.appendChild(info);

    if (c.status === 'pending') {
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0';
        const approve = document.createElement('button');
        approve.textContent = '✓';
        approve.title = 'Valider';
        approve.style.cssText = 'width:30px;height:30px;border-radius:8px;border:none;background:#10b981;color:white;font-size:15px;font-weight:700;cursor:pointer';
        approve.addEventListener('click', () => decideConge(c._id, 'approved'));
        const reject = document.createElement('button');
        reject.textContent = '✗';
        reject.title = 'Refuser';
        reject.style.cssText = 'width:30px;height:30px;border-radius:8px;border:1px solid var(--danger);background:white;color:var(--danger);font-size:15px;font-weight:700;cursor:pointer';
        reject.addEventListener('click', () => decideConge(c._id, 'rejected'));
        actions.appendChild(approve);
        actions.appendChild(reject);
        row.appendChild(actions);
    } else {
        const badge = document.createElement('span');
        badge.className = 'badge ' + st.cls;
        badge.style.flexShrink = '0';
        badge.textContent = st.icon + ' ' + st.label;
        row.appendChild(badge);
    }
    return row;
}

async function decideConge(id, decision) {
    try {
        const res  = await fetch('/api/conges/' + id + '/decision', {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast(data.message);
        // MAJ optimiste du cache puis re-render (garde le scroll/repli)
        const c = _congesAll.find(x => String(x._id) === String(id));
        if (c) c.status = decision;
        renderCongesListPatron();
        loadCongesBadge();
        loadDisposBadge();
        if (selectedDate) loadDayDetail(selectedDate);
    } catch (e) { showToast(e.message || 'Erreur', true); }
}

let _reassignCount = 0;

function _reassignDateRange() {
    const today = new Date();
    const from  = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const nextMonday = getMondayOf(addDays(new Date(), 7));
    const to = toDateStr(addDays(nextMonday, 6));
    return { from, to };
}

function _updateReassignBadge(count) {
    _reassignCount = count;
    const badge = document.getElementById('reassign-tab-badge');
    if (!badge) return;
    badge.textContent   = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

async function loadReassignBadge() {
    const { from, to } = _reassignDateRange();
    try {
        const res = await fetch('/api/dispos/non-affectees?from=' + from + '&to=' + to, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        _updateReassignBadge(data.length);
    } catch { }
}

async function loadNonAffectees() {
    const list = document.getElementById('dispos-reassign-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    const { from, to } = _reassignDateRange();
    const DAY_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const MONTHS   = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sep.', 'oct.', 'nov.', 'déc.'];
    const fmtH = ShiftHours.fmtHourOfDay;
    const slotOrder = dispo => {
        if (dispo.type === 'midi') return [0, 0];
        if (dispo.type === 'soir') return [1, 0];
        return [2, Number(dispo.start_time) || 0];
    };
    try {
        const res = await fetch('/api/dispos/non-affectees?from=' + from + '&to=' + to, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        _updateReassignBadge(data.length);
        if (data.length === 0) {
            list.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">✅ Aucune disponibilité confirmée sans shift</div>';
            return;
        }
        list.innerHTML = '';

        // Grouper par date
        const byDate = {};
        data.forEach(d => {
            if (!byDate[d.date]) byDate[d.date] = [];
            byDate[d.date].push(d);
        });

        // Trier les dates croissantes, puis les dispos midi → soir → custom (par start_time)
        const sortedDates = Object.keys(byDate).sort();
        sortedDates.forEach(dateStr => {
            const dispos = byDate[dateStr].sort((a, b) => {
                const oa = slotOrder(a), ob = slotOrder(b);
                return oa[0] - ob[0] || oa[1] - ob[1];
            });
            const d         = parseDate(dateStr);
            const dateLabel = DAY_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];

            const card = document.createElement('div');
            card.style.cssText = 'background:#fff;border:1px solid #eee;border-radius:10px;margin:8px 16px;overflow:hidden';

            // En-tête repliable
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #f0f0f0;cursor:pointer;user-select:none';
            header.innerHTML =
                '<span class="na-card-chevron" style="font-size:11px;color:#888;flex-shrink:0;transition:transform 0.15s;display:inline-block;width:12px;text-align:center">▾</span>' +
                '<span style="font-size:13px;font-weight:700;color:#333;flex:1;text-transform:capitalize">' + dateLabel + '</span>' +
                '<span class="na-card-count" style="font-size:11px;color:#aaa">' + dispos.length + ' à recréer</span>';
            card.appendChild(header);

            // Conteneur des lignes (une par shift)
            const rows = document.createElement('div');
            rows.className = 'na-card-body';
            card.appendChild(rows);

            header.addEventListener('click', () => {
                const collapsed     = rows.style.display === 'none';
                rows.style.display  = collapsed ? '' : 'none';
                const chev          = header.querySelector('.na-card-chevron');
                if (chev) chev.style.transform = collapsed ? '' : 'rotate(-90deg)';
            });

            dispos.forEach(dispo => {
                const dispoLabel = dispo.type === 'soir' ? 'Soir'
                    : dispo.type === 'midi' ? 'Midi'
                    : (fmtH(dispo.start_time) + '–' + fmtH(dispo.end_time));

                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid #f9f9f9';
                row.innerHTML =
                    '<span style="width:10px;height:10px;border-radius:50%;background:' + dispo.staff_color + ';flex-shrink:0;display:inline-block"></span>' +
                    '<span style="font-size:12px;font-weight:600;color:#444;flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(dispo.staff_name) + '</span>' +
                    '<span style="font-size:12px;color:#bbb;flex-shrink:0">·</span>' +
                    '<span style="font-size:12px;color:#888;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(dispo.establishment_name) + '</span>' +
                    '<span style="font-size:12px;color:#bbb;flex-shrink:0">·</span>' +
                    '<span style="font-size:12px;font-weight:600;color:#444;flex-shrink:0">' + dispoLabel + '</span>' +
                    '<button class="btn-na-recreate" style="padding:4px 10px;border-radius:6px;border:1.5px solid var(--accent);background:#f0effe;color:var(--accent);font-size:11px;font-weight:600;cursor:pointer;flex-shrink:0;white-space:nowrap">Recréer</button>' +
                    '<button class="btn-na-ignore" style="width:24px;height:24px;border-radius:6px;border:1px solid #e0e0e0;background:#f5f5f5;color:#aaa;font-size:15px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;line-height:1;font-family:inherit">×</button>';

                row.querySelector('.btn-na-recreate').addEventListener('click', () => _recreateShiftFromDispo(dispo, row, card));
                row.querySelector('.btn-na-ignore').addEventListener('click', () => _ignoreNonAffectee(dispo._id, row, card));
                rows.appendChild(row);
            });

            list.appendChild(card);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + (e.message || 'Erreur') + '</div>';
    }
}

function _nonAffecteesAfterRemove(row, card) {
    row.remove();
    _reassignCount = Math.max(0, _reassignCount - 1);
    _updateReassignBadge(_reassignCount);
    // Mettre à jour ou supprimer la carte si plus aucune ligne
    const remaining = card.querySelectorAll('.btn-na-recreate').length;
    if (remaining === 0) {
        card.remove();
        const list = document.getElementById('dispos-reassign-list');
        if (list && list.children.length === 0)
            list.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">✅ Aucune disponibilité confirmée sans shift</div>';
    } else {
        const countEl = card.querySelector('.na-card-count');
        if (countEl) countEl.textContent = remaining + ' à recréer';
    }
}

async function _recreateShiftFromDispo(dispo, row, card) {
    const btn = row.querySelector('.btn-na-recreate');
    btn.disabled    = true;
    btn.textContent = 'Création…';
    try {
        const res = await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                staff_id:         dispo.staff_id,
                staff_name:       dispo.staff_name,
                establishment_id: dispo.establishment_id,
                date:             dispo.date,
                start_time:       dispo.start_time,
                end_time:         dispo.end_time,
                color:            dispo.staff_color,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        _nonAffecteesAfterRemove(row, card);
        showToast('Shift recréé pour ' + dispo.staff_name);
    } catch (e) {
        showToast(e.message || 'Erreur', true);
        btn.disabled    = false;
        btn.textContent = 'Recréer';
    }
}

async function _ignoreNonAffectee(dispoId, row, card) {
    try {
        const res = await fetch('/api/dispos/' + dispoId + '/ignore', { method: 'PATCH', credentials: 'include' });
        if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
        _nonAffecteesAfterRemove(row, card);
    } catch (e) {
        showToast(e.message || 'Erreur', true);
    }
}

async function _isWeekPublished(weekStartStr) {
    const res = await fetch('/api/publish/' + weekStartStr, { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    // Nouvelle forme patron : { auto, establishments } ; rétro-compat : { published }.
    return !!(data.published || data.auto
        || data.establishments === 'ALL'
        || (Array.isArray(data.establishments) && data.establishments.length > 0));
}

// Même logique que _disposWeekStart côté serveur : semaine suivante.
function _reminderResolveWeek() {
    return getMondayOf(addDays(new Date(), 7));
}

function _renderReminderWeekLabel(weekStart) {
    const label = document.getElementById('reminder-week-label');
    if (!label || !weekStart) return;
    const MONTHS = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
    const end = addDays(weekStart, 6);
    const startStr = weekStart.getDate() + ' ' + MONTHS[weekStart.getMonth()];
    const endStr   = end.getDate() + ' ' + MONTHS[end.getMonth()] + ' ' + end.getFullYear();
    label.textContent = 'Semaine du ' + startStr + ' au ' + endStr;
}

async function loadReminderBadge() {
    try {
        const weekStart = _reminderResolveWeek();
        const from = toDateStr(weekStart);
        const to   = toDateStr(addDays(weekStart, 6));
        const res = await fetch('/api/dispos/sans-dispo?from=' + from + '&to=' + to, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const badge = document.getElementById('reminder-tab-badge');
        if (!badge) return;
        badge.textContent   = data.length;
        badge.style.display = data.length > 0 ? 'inline-flex' : 'none';
    } catch { }
}

async function loadReminderTab() {
    const list = document.getElementById('dispos-reminder-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    try {
        const weekStart = _reminderResolveWeek();
        _renderReminderWeekLabel(weekStart);
        const from = toDateStr(weekStart);
        const to   = toDateStr(addDays(weekStart, 6));
        const res = await fetch('/api/dispos/sans-dispo?from=' + from + '&to=' + to, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const badge = document.getElementById('reminder-tab-badge');
        if (badge) { badge.textContent = data.length; badge.style.display = data.length > 0 ? 'inline-flex' : 'none'; }

        if (data.length === 0) {
            list.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">✅ Tout le monde a envoyé ses dispos pour cette semaine</div>';
            return;
        }

        list.innerHTML = '';
        // Compteur
        const counter = document.createElement('div');
        counter.style.cssText = 'padding:8px 16px;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--light-border)';
        counter.textContent = data.length + ' personne' + (data.length > 1 ? 's' : '') + ' sans disponibilité';
        list.appendChild(counter);

        // Une ligne par staff
        const _reminderChecked = {};
        data.forEach(staff => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--light-border)';

            const dot = '<span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(staff.color) + ';flex-shrink:0;display:inline-block"></span>';
            const name = '<span style="flex:1;font-size:13px;font-weight:600;color:var(--text-primary)">' + escapeHtml(staff.name) + '</span>';

            let phoneHtml = '';
            if (staff.phone) {
                phoneHtml =
                    '<span style="font-size:12px;color:var(--text-secondary);white-space:nowrap">' + escapeHtml(staff.phone) + '</span>' +
                    '<button title="Copier" style="background:none;border:none;cursor:pointer;padding:2px 4px;color:var(--text-secondary);font-size:14px;flex-shrink:0" ' +
                    'onclick="navigator.clipboard.writeText(\'' + escapeHtml(staff.phone).replace(/'/g, "\\'") + '\').then(()=>showToast(\'Copié\'))">📋</button>';
            } else {
                phoneHtml = '<span style="font-size:11px;color:#ccc;font-style:italic">pas de tél.</span>';
            }

            const cbId = 'reminder-cb-' + staff.id;
            const cbHtml =
                '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap;flex-shrink:0">' +
                '<input type="checkbox" id="' + cbId + '" style="width:15px;height:15px;accent-color:var(--success);cursor:pointer">' +
                '<span style="font-size:11px;color:var(--text-secondary)">rappelé</span></label>';

            const reopenId = 'reopen-btn-' + staff.id;
            const reopenHtml =
                '<button id="' + reopenId + '" ' +
                'style="background:none;border:1px solid var(--accent);border-radius:6px;cursor:pointer;' +
                'padding:3px 8px;color:var(--accent);font-size:11px;flex-shrink:0;white-space:nowrap" ' +
                'onclick="(async()=>{' +
                    'this.disabled=true;this.textContent=\'🔒 Rouvert\';' +
                    'this.style.opacity=\'0.5\';this.style.cursor=\'default\';' +
                    'await fetch(\'/api/dispo-settings/force-open-staff\',' +
                    '{method:\'PATCH\',credentials:\'include\',' +
                    'headers:{\'Content-Type\':\'application/json\'},' +
                    'body:JSON.stringify({staff_id:\'' + escapeHtml(staff.id) + '\',action:\'add\'})})' +
                '})()">🔓 Rouvrir</button>';

            row.innerHTML = dot + name + phoneHtml + cbHtml + reopenHtml;

            // Barrer le nom quand coché
            row.querySelector('#' + cbId).addEventListener('change', function() {
                const nameEl = row.querySelector('span[style*="font-weight:600"]');
                if (nameEl) nameEl.style.textDecoration = this.checked ? 'line-through' : '';
                row.style.opacity = this.checked ? '0.45' : '1';
            });

            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + escapeHtml(e.message || 'Erreur') + '</div>';
    }
}

function _renderModifyWeekLabel(weekStart) {
    const label = document.getElementById('modify-week-label');
    if (!label || !weekStart) return;
    const MONTHS = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
    const end = addDays(weekStart, 6);
    const startStr = weekStart.getDate() + ' ' + MONTHS[weekStart.getMonth()];
    const endStr   = end.getDate() + ' ' + MONTHS[end.getMonth()] + ' ' + end.getFullYear();
    label.textContent = 'Semaine du ' + startStr + ' au ' + endStr;
}

async function loadModifyTab() {
    const list = document.getElementById('dispos-modify-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    try {
        const weekStart = _reminderResolveWeek();
        _renderModifyWeekLabel(weekStart);
        const from = toDateStr(weekStart);
        const to   = toDateStr(addDays(weekStart, 6));
        const res = await fetch('/api/dispos/with-dispo?from=' + from + '&to=' + to, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.length === 0) {
            list.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">Aucun staff n\'a envoyé de dispos pour cette semaine</div>';
            return;
        }

        list.innerHTML = '';
        const counter = document.createElement('div');
        counter.style.cssText = 'padding:8px 16px;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--light-border)';
        counter.textContent = data.length + ' personne' + (data.length > 1 ? 's' : '') + ' avec dispos envoyées';
        list.appendChild(counter);

        data.forEach(staff => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--light-border)';

            const dot = '<span style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(staff.color) + ';flex-shrink:0;display:inline-block"></span>';
            const name = '<span style="flex:1;font-size:13px;font-weight:600;color:var(--text-primary)">' + escapeHtml(staff.name) + '</span>';
            const countBadge = '<span style="font-size:11px;color:var(--text-secondary);background:var(--light-bg);border:1px solid var(--light-border);border-radius:10px;padding:2px 8px;flex-shrink:0">' + staff.count + ' dispo' + (staff.count > 1 ? 's' : '') + '</span>';

            const btnId = 'modify-btn-' + staff.id;
            const btnLabel = staff.reopened ? '🔒 Rouvert' : '🔓 Rouvrir';
            const btnDisabled = staff.reopened ? 'disabled' : '';
            const btnStyle = staff.reopened
                ? 'background:none;border:1px solid var(--light-border);border-radius:6px;cursor:default;padding:3px 8px;color:var(--text-secondary);font-size:11px;flex-shrink:0;white-space:nowrap;opacity:0.5'
                : 'background:none;border:1px solid var(--accent);border-radius:6px;cursor:pointer;padding:3px 8px;color:var(--accent);font-size:11px;flex-shrink:0;white-space:nowrap';

            const btnHtml = '<button id="' + btnId + '" type="button" ' + btnDisabled + ' style="' + btnStyle + '">' + btnLabel + '</button>';
            row.innerHTML = dot + name + countBadge + btnHtml;
            list.appendChild(row);

            if (staff.reopened) return;

            const btn = row.querySelector('#' + btnId);
            let confirming = false;
            let timer = null;
            btn.addEventListener('click', async () => {
                if (!confirming) {
                    confirming = true;
                    btn.textContent = '⚠️ Confirmer suppression';
                    btn.style.background = '#ef4444';
                    btn.style.color = 'white';
                    btn.style.borderColor = '#ef4444';
                    timer = setTimeout(() => {
                        confirming = false;
                        btn.textContent = '🔓 Rouvrir';
                        btn.style.background = 'none';
                        btn.style.color = 'var(--accent)';
                        btn.style.borderColor = 'var(--accent)';
                    }, 4000);
                    return;
                }
                clearTimeout(timer);
                btn.disabled = true;
                btn.textContent = 'Suppression…';
                try {
                    const r = await fetch('/api/dispos/reopen-for-correction', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ staff_id: staff.id, from, to }),
                    });
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.error);
                    btn.textContent = '🔒 Rouvert';
                    btn.style.background = 'none';
                    btn.style.color = 'var(--text-secondary)';
                    btn.style.borderColor = 'var(--light-border)';
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'default';
                    const countEl = row.querySelector('span[style*="border-radius:10px"]');
                    if (countEl) countEl.textContent = '0 dispo';
                    if (typeof showToast === 'function') showToast('Dispos supprimées, ' + staff.name + ' peut resoumettre');
                } catch (e) {
                    btn.disabled = false;
                    btn.textContent = '🔓 Rouvrir';
                    btn.style.background = 'none';
                    btn.style.color = 'var(--accent)';
                    btn.style.borderColor = 'var(--accent)';
                    if (typeof showToast === 'function') showToast('Erreur : ' + (e.message || 'inconnue'));
                }
            });
        });
    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + escapeHtml(e.message || 'Erreur') + '</div>';
    }
}

function switchDisposTab(tab) {
    const isNotes    = tab === 'notes';
    const isReassign = tab === 'reassign';
    const isReminder = tab === 'reminder';
    const isModify   = tab === 'modify';
    const isConges   = tab === 'conges';
    const isList     = !isNotes && !isReassign && !isReminder && !isModify && !isConges;

    document.getElementById('dispos-tab-list').style.display  = isList ? '' : 'none';
    document.getElementById('dispos-tab-notes').style.display = isNotes ? '' : 'none';
    const tabReassign = document.getElementById('dispos-tab-reassign');
    if (tabReassign) tabReassign.style.display = isReassign ? '' : 'none';
    const tabReminder = document.getElementById('dispos-tab-reminder');
    if (tabReminder) tabReminder.style.display = isReminder ? '' : 'none';
    const tabModify = document.getElementById('dispos-tab-modify');
    if (tabModify) tabModify.style.display = isModify ? '' : 'none';
    const tabConges = document.getElementById('dispos-tab-conges');
    if (tabConges) tabConges.style.display = isConges ? '' : 'none';

    const btnList     = document.getElementById('dispos-tab-btn-list');
    const btnNotes    = document.getElementById('dispos-tab-btn-notes');
    const btnReassign = document.getElementById('dispos-tab-btn-reassign');
    const btnReminder = document.getElementById('dispos-tab-btn-reminder');
    const btnModify   = document.getElementById('dispos-tab-btn-modify');
    const btnConges   = document.getElementById('dispos-tab-btn-conges');
    if (btnList) {
        btnList.style.borderBottomColor = isList ? 'var(--accent)' : 'transparent';
        btnList.style.color             = isList ? 'var(--accent)' : 'var(--text-secondary)';
        btnList.style.fontWeight        = isList ? '600' : '500';
    }
    if (btnNotes) {
        btnNotes.style.borderBottomColor = isNotes ? 'var(--accent)' : 'transparent';
        btnNotes.style.color             = isNotes ? 'var(--accent)' : 'var(--text-secondary)';
        btnNotes.style.fontWeight        = isNotes ? '600' : '500';
    }
    if (btnReassign) {
        btnReassign.style.borderBottomColor = isReassign ? 'var(--accent)' : 'transparent';
        btnReassign.style.color             = isReassign ? 'var(--accent)' : 'var(--text-secondary)';
        btnReassign.style.fontWeight        = isReassign ? '600' : '500';
    }
    if (btnReminder) {
        btnReminder.style.borderBottomColor = isReminder ? 'var(--accent)' : 'transparent';
        btnReminder.style.color             = isReminder ? 'var(--accent)' : 'var(--text-secondary)';
        btnReminder.style.fontWeight        = isReminder ? '600' : '500';
    }
    if (btnModify) {
        btnModify.style.borderBottomColor = isModify ? 'var(--accent)' : 'transparent';
        btnModify.style.color             = isModify ? 'var(--accent)' : 'var(--text-secondary)';
        btnModify.style.fontWeight        = isModify ? '600' : '500';
    }
    if (btnConges) {
        btnConges.style.borderBottomColor = isConges ? 'var(--accent)' : 'transparent';
        btnConges.style.color             = isConges ? 'var(--accent)' : 'var(--text-secondary)';
        btnConges.style.fontWeight        = isConges ? '600' : '500';
    }
    if (isConges) loadCongesList();
    if (isNotes) {
        staffNotesWeekStart = getMondayOf(addDays(new Date(), 7));
        const srch = document.getElementById('staff-notes-search');
        if (srch) srch.value = '';
        renderStaffNotesWeekLabel();
        loadStaffNotesList(toDateStr(staffNotesWeekStart));
    }
    if (isReassign) loadNonAffectees();
    if (isReminder) loadReminderTab();
    if (isModify)   loadModifyTab();
}

async function openDisposPanel() {
    const modal = document.getElementById('dispos-modal');
    if (!modal) return;
    switchDisposTab('list');
    modal.style.display = 'flex';
    await loadDisposList();
    loadReassignBadge();
    loadReminderBadge();
    loadCongesBadge();
}

async function sendRappelDispos() {
    const btn      = document.getElementById('btn-send-rappel');
    const feedback = document.getElementById('rappel-feedback');
    const msg      = document.getElementById('rappel-message').value.trim();
    btn.disabled    = true;
    btn.textContent = 'Envoi…';
    if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; feedback.style.color = '#27ae60'; }
    const week_start = toDateStr(getMondayOf(addDays(new Date(), 7)));
    try {
        const res  = await fetch('/api/dispos/rappel', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week_start, message: msg || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (feedback) {
            feedback.textContent    = data.sent === 0
                ? 'Tout le staff a déjà soumis ses dispos'
                : 'Rappel envoyé à ' + data.sent + ' membre' + (data.sent > 1 ? 's' : '');
            feedback.style.display  = '';
        }
    } catch (e) {
        if (feedback) {
            feedback.textContent   = e.message;
            feedback.style.color   = '#e74c3c';
            feedback.style.display = '';
        }
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Envoyer un rappel';
    }
}

async function loadDisposList() {
    const list = document.getElementById('dispos-list');
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    const nextMonday = getMondayOf(addDays(new Date(), 7));
    const from = toDateStr(nextMonday);
    const to   = toDateStr(addDays(nextMonday, 6));
    try {
        const [res, notesRes] = await Promise.all([
            fetch('/api/dispos/pending?from=' + from + '&to=' + to, { credentials: 'include' }),
            fetch('/api/dispos/week-notes?week_start=' + from, { credentials: 'include' }),
        ]);
        const dispos = await res.json();
        if (!res.ok) throw new Error(dispos.error);
        const weekNotes = notesRes.ok ? await notesRes.json() : [];
        const noteByStaff = {};
        weekNotes.forEach(n => { noteByStaff[n.staff_id] = n.week_note; });

        if (dispos.length === 0) {
            list.innerHTML = '<div style="padding:24px;text-align:center;color:#ccc;font-size:13px">Aucune disponibilité en attente</div>';
            return;
        }

        // Grouper par staff_id
        const byStaff = {};
        dispos.forEach(d => {
            if (!byStaff[d.staff_id]) byStaff[d.staff_id] = { name: d.staff_name, dispos: [] };
            byStaff[d.staff_id].dispos.push(d);
        });

        list.innerHTML = '';

        // Semaine : lun → dim
        const weekDays = [];
        for (let i = 0; i < 7; i++) weekDays.push(toDateStr(addDays(nextMonday, i)));
        const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

        // Un directeur voit en priorité les staff rattachés à ses établissements
        const dirEstabs = (currentUser && currentUser.role === 'directeur')
            ? (currentUser.assigned_establishments || [])
            : [];
        const isMyStaff = (staffId) => {
            if (dirEstabs.length === 0) return false;
            const sm = allStaff.find(s => String(s._id) === String(staffId));
            return !!(sm && sm.venues && sm.venues.some(v => dirEstabs.includes(v)));
        };

        const staffEntries = Object.entries(byStaff);
        if (dirEstabs.length) {
            staffEntries.sort((a, b) =>
                (isMyStaff(a[0]) ? 0 : 1) - (isMyStaff(b[0]) ? 0 : 1) || a[1].name.localeCompare(b[1].name));
        }

        let shownMine = false, shownOthers = false;
        staffEntries.forEach(([staffId, { name, dispos: staffDispos }]) => {
            const sm    = allStaff.find(s => String(s._id) === staffId);
            const color = sm ? sm.color : '#888';
            const mine  = isMyStaff(staffId);

            // En-têtes de section pour un directeur : "Mon staff" puis "Autres"
            if (dirEstabs.length && mine && !shownMine) {
                shownMine = true;
                const sec = document.createElement('div');
                sec.style.cssText = 'margin:14px 16px 8px;padding:9px 14px;background:#fff7e6;border:1.5px solid var(--warning,#f59e0b);border-radius:10px;font-size:15px;font-weight:800;color:#b45309;display:flex;align-items:center;gap:8px';
                sec.innerHTML = '<span style="font-size:17px;color:var(--warning,#f59e0b)">★</span> Staff de mon établissement';
                list.appendChild(sec);
            }
            if (dirEstabs.length && !mine && shownMine && !shownOthers) {
                shownOthers = true;
                const sec = document.createElement('div');
                sec.style.cssText = 'margin:20px 16px 6px;padding:0 4px;font-size:12px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.5px';
                sec.textContent = 'Autres';
                list.appendChild(sec);
            }
            const fmt   = h => String(Math.floor(h % 24)).padStart(2, '0') + 'h' + (Math.round((h%1)*60) > 0 ? String(Math.round((h%1)*60)).padStart(2,'0') : '');

            const availCount = staffDispos.filter(d => d.type !== 'off').length;
            const offCount   = staffDispos.length - availCount;
            const subLabel   = availCount > 0
                ? availCount + ' jour' + (availCount > 1 ? 's' : '') + ' dispo' + (availCount > 1 ? 's' : '') + (offCount > 0 ? ' · ' + offCount + ' indispo' : '')
                : 'Indisponible' + (offCount > 1 ? ' (' + offCount + ' jours)' : '');

            const card = document.createElement('div');
            card.style.cssText = 'border-radius:12px;margin:8px 16px;overflow:hidden;' +
                (mine
                    ? 'background:#fffdf5;border:1px solid var(--warning,#f59e0b)'
                    : 'background:var(--color-bg-secondary,#f8f8f8);border:1px solid var(--color-border-secondary,#eee)');

            // Header carte staff
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--color-border-tertiary,#f0f0f0)';
            header.innerHTML =
                '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;display:inline-block"></span>' +
                '<div style="flex:1">' +
                    '<div style="font-size:13px;font-weight:700;color:#333">' +
                        (mine ? '<span class="staff-pref-dot" title="Affecté à ton établissement" style="margin-right:4px">★</span>' : '') +
                        name +
                    '</div>' +
                    '<div style="font-size:11px;color:#aaa">' + subLabel + '</div>' +
                '</div>' +
                '<button class="btn-confirm-all" style="padding:6px 12px;border-radius:8px;border:1.5px solid #2ecc71;background:#eafaf1;color:#27ae60;font-size:12px;font-weight:600;cursor:pointer">✓ Tout confirmer</button>';
            card.appendChild(header);

            // Grille des 7 jours
            const grid = document.createElement('div');
            grid.style.cssText = 'display:flex;gap:6px;padding:10px 14px;overflow-x:auto';

            weekDays.forEach(date => {
                const dispo = staffDispos.find(d => d.date === date);
                const isOff = dispo && dispo.type === 'off';
                const d     = parseDate(date);
                const pill  = document.createElement('div');
                pill.style.cssText = 'min-width:70px;border-radius:8px;padding:8px 6px;text-align:center;border:1.5px solid;flex-shrink:0;' +
                    (!dispo
                        ? 'background:#f5f5f5;border-color:#eee;opacity:0.5'
                        : isOff
                            ? 'background:#fdf0f0;border-color:#f5c6c6;cursor:pointer'
                            : 'background:white;border-color:#e0e0e0;cursor:pointer');

                const typeColor = !dispo
                    ? '#ccc'
                    : isOff ? '#e74c3c'
                    : (dispo.type === 'midi' ? '#534AB7' : '#1a1a2e');

                pill.innerHTML =
                    '<div style="font-size:10px;color:#aaa;margin-bottom:2px">' + DAY_SHORT[d.getDay()] + ' ' + d.getDate() + '</div>' +
                    (!dispo
                        ? '<div style="font-size:14px;color:#ddd">—</div>'
                        : isOff
                            ? '<div style="font-size:12px;font-weight:700;color:' + typeColor + '">Indispo</div>' +
                              (dispo.note ? '<div style="font-size:9px;color:#f39c12;margin-top:2px">✎ note</div>' : '')
                            : '<div style="font-size:12px;font-weight:700;color:' + typeColor + '">' + (dispo.type === 'soir' ? 'Soir' : dispo.type === 'midi' ? 'Midi' : 'Perso') + '</div>' +
                              '<div style="font-size:10px;color:#999;margin-top:1px">' + fmt(dispo.start_time) + '→' + fmt(dispo.end_time) + '</div>' +
                              (dispo.note ? '<div style="font-size:9px;color:#f39c12;margin-top:2px">✎ note</div>' : ''));

                if (dispo && isOff) {
                    pill.title = 'Indisponible — cliquer pour acquitter';
                    pill.addEventListener('click', () => acknowledgeOffDispo(dispo, pill));
                } else if (dispo) {
                    pill.title = 'Cliquer pour confirmer ou refuser';
                    pill.addEventListener('click', () => openConfirmDispo(dispo, pill, card, staffId));

                    // Hover
                    pill.addEventListener('mouseenter', () => { if (!pill.dataset.confirmed) pill.style.borderColor = '#2ecc71'; });
                    pill.addEventListener('mouseleave', () => { if (!pill.dataset.confirmed) pill.style.borderColor = '#e0e0e0'; });
                }

                grid.appendChild(pill);
            });

            card.appendChild(grid);

            // Note globale semaine
            const weekNote = noteByStaff[staffId];
            if (weekNote) {
                const noteEl = document.createElement('div');
                noteEl.style.cssText = 'padding:8px 14px 12px;border-top:1px solid #f0f0f0;display:flex;align-items:flex-start;gap:8px';
                noteEl.innerHTML =
                    '<span style="font-size:13px;flex-shrink:0">✎</span>' +
                    '<div>' +
                        '<div style="font-size:10px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Note semaine</div>' +
                        '<div style="font-size:12px;color:#555;line-height:1.4">' + escapeHtml(weekNote) + '</div>' +
                    '</div>';
                card.appendChild(noteEl);
            }

            // Bouton "Tout confirmer"
            header.querySelector('.btn-confirm-all').addEventListener('click', () => {
                confirmAllForStaff(staffDispos, card);
            });

            list.appendChild(card);
        });

    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + e.message + '</div>';
    }
}

async function confirmAllForStaff(dispos, card) {
    // Ouvrir la modale de confirmation avec l'établissement, puis confirmer tout
    const modal  = document.getElementById('confirm-dispo-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    buildEstablishmentSelect(dispos[0]?.staff_id);

    document.getElementById('confirm-dispo-btn').onclick = async () => {
        const establishmentId = document.getElementById('confirm-dispo-establishment').value;
        const createShift     = document.getElementById('confirm-create-shift').checked;
        modal.style.display   = 'none';

        let confirmed = 0;
        for (const dispo of dispos) {
            try {
                await fetch('/api/dispos/' + dispo._id + '/confirm', {
                    credentials: 'include', method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ establishment_id: establishmentId, create_shift: createShift }),
                });
                confirmed++;
            } catch { }
        }
        card.remove();
        loadDisposBadge();
        if (createShift) await refreshWeek();
        showToast(confirmed + ' dispo(s) confirmée(s)');
    };
    document.getElementById('confirm-dispo-cancel').onclick = () => {
        modal.style.display = 'none';
        showConfirm('Refuser toutes les dispos de ce membre ?', async () => {
            let refused = 0;
            for (const dispo of dispos) {
                try {
                    await fetch('/api/dispos/' + dispo._id + '/reject', { credentials: 'include', method: 'PATCH' });
                    refused++;
                } catch { }
            }
            card.remove();
            loadDisposBadge();
            showToast(refused + ' dispo(s) refusée(s)');
        });
    };
}

function openConfirmDispo(dispo, pill, card, staffId) {
    const modal = document.getElementById('confirm-dispo-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    buildEstablishmentSelect(staffId || dispo.staff_id);

    const noteEl = document.getElementById('confirm-dispo-note');
    if (noteEl) {
        if (dispo.note && dispo.note.trim()) {
            noteEl.textContent = '"' + dispo.note.trim() + '"';
            noteEl.style.display = 'block';
        } else {
            noteEl.style.display = 'none';
        }
    }

    document.getElementById('confirm-dispo-btn').onclick = async () => {
        const establishmentId = document.getElementById('confirm-dispo-establishment').value;
        const createShift     = document.getElementById('confirm-create-shift').checked;
        try {
            const res = await fetch('/api/dispos/' + dispo._id + '/confirm', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ establishment_id: establishmentId, create_shift: createShift }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            modal.style.display = 'none';
            // Marquer la pill comme confirmée
            pill.style.background    = '#eafaf1';
            pill.style.borderColor   = '#2ecc71';
            pill.dataset.confirmed   = '1';
            pill.style.cursor        = 'default';
            pill.style.pointerEvents = 'none';
            loadDisposBadge();
            if (createShift) await refreshWeek();
            showToast(data.message);
        } catch (e) { showToast(e.message, true); }
    };

    // Bouton refus
    document.getElementById('confirm-dispo-cancel').onclick = async () => {
        showConfirm('Refuser cette disponibilité ?', async () => {
            modal.style.display = 'none';
            await fetch('/api/dispos/' + dispo._id + '/reject', { credentials: 'include', method: 'PATCH' });
            pill.style.background    = '#fff5f5';
            pill.style.borderColor   = '#e74c3c';
            pill.style.pointerEvents = 'none';
            pill.style.opacity       = '0.5';
            loadDisposBadge();
        });
    };
}

// Une indispo n'a rien à confirmer : un simple clic l'acquitte (sans établissement ni shift)
async function acknowledgeOffDispo(dispo, pill) {
    try {
        const res = await fetch('/api/dispos/' + dispo._id + '/confirm', {
            credentials: 'include', method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        pill.dataset.confirmed   = '1';
        pill.style.opacity       = '0.55';
        pill.style.cursor        = 'default';
        pill.style.pointerEvents = 'none';
        loadDisposBadge();
        showToast(data.message);
    } catch (e) { showToast(e.message, true); }
}

// ── Notes staff — côté patron ─────────────────────────────────────────────────

let staffNotesWeekStart = null;

function renderStaffNotesWeekLabel() {
    const label = document.getElementById('staff-notes-week-label');
    if (!label || !staffNotesWeekStart) return;
    const from = staffNotesWeekStart;
    const to   = addDays(staffNotesWeekStart, 6);
    label.textContent = 'Sem. ' + formatDateShort(from) + ' – ' + formatDateShort(to);
}

let _staffNotesData = [];

async function loadStaffNotesList(weekStart) {
    const list = document.getElementById('staff-notes-list');
    if (!list) return;
    list.innerHTML = '<div style=”padding:16px;text-align:center;color:#ccc;font-size:13px”>Chargement…</div>';
    try {
        const res  = await fetch('/api/dispos/notes?week_start=' + weekStart, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        _staffNotesData = data;
        renderStaffNotesList();
    } catch (e) {
        _staffNotesData = [];
        list.innerHTML = '<div style=”padding:16px;text-align:center;color:#e74c3c;font-size:13px”>' + escapeHtml(e.message) + '</div>';
    }
}

function renderStaffNotesList() {
    const list = document.getElementById('staff-notes-list');
    if (!list) return;

    const searchInput = document.getElementById('staff-notes-search');
    const query = searchInput ? normalizeStr(searchInput.value.trim()) : '';
    const filtered = query
        ? _staffNotesData.filter(e => normalizeStr(e.name).includes(query))
        : _staffNotesData;

    list.innerHTML = '';

    if (_staffNotesData.length === 0) {
        list.innerHTML = '<div style=”padding:28px;text-align:center;color:#ccc;font-size:13px”>Aucune note pour cette semaine</div>';
        return;
    }
    if (filtered.length === 0) {
        list.innerHTML = '<div style=”padding:20px;text-align:center;color:#ccc;font-size:13px”>Aucun résultat</div>';
        return;
    }

    const statusMap = {
        confirmed: { icon: '✅', label: 'Acceptées',  bg: '#eafaf1', color: '#27ae60' },
        rejected:  { icon: '❌', label: 'Refusées',   bg: '#fff5f5', color: '#e74c3c' },
        pending:   { icon: '⏳', label: 'En attente', bg: '#fff8e1', color: '#d68910' },
        mixed:     { icon: '↕',  label: 'Mixte',      bg: '#f0f0f0', color: '#555'    },
    };

    filtered.forEach(entry => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid var(--light-border)';

        const dot = document.createElement('div');
        dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:' + (entry.color || '#95a5a6') + ';flex-shrink:0;margin-top:4px';
        row.appendChild(dot);

        const content = document.createElement('div');
        content.style.cssText = 'flex:1;min-width:0';

        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px';
        nameEl.textContent = entry.name;
        content.appendChild(nameEl);

        // Note globale semaine
        if (entry.week_note) {
            const wn = document.createElement('div');
            wn.style.cssText = 'font-size:12px;color:#555;line-height:1.4;margin-bottom:3px';
            wn.innerHTML = '<span style=”color:#999;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.3px”>Semaine</span> <span style=”font-style:italic”>”' + escapeHtml(entry.week_note) + '”</span>';
            content.appendChild(wn);
        }

        // Notes par jour
        if (entry.day_notes && entry.day_notes.length > 0) {
            entry.day_notes.forEach(dn => {
                const dayName = DAY_NAMES_LONG[parseDate(dn.date).getDay()];
                const dn_el = document.createElement('div');
                dn_el.style.cssText = 'font-size:12px;color:#555;line-height:1.4;margin-bottom:3px';
                dn_el.innerHTML = '<span style=”color:#999;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.3px”>' + escapeHtml(dayName) + '</span> <span style=”font-style:italic”>”' + escapeHtml(dn.note) + '”</span>';
                content.appendChild(dn_el);
            });
        }

        if (entry.dispo_status) {
            const s = statusMap[entry.dispo_status] || statusMap.pending;
            const badge = document.createElement('span');
            badge.style.cssText = 'display:inline-block;margin-top:5px;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600;background:' + s.bg + ';color:' + s.color;
            badge.textContent = s.icon + ' Dispos : ' + s.label;
            content.appendChild(badge);
        }

        row.appendChild(content);
        list.appendChild(row);
    });
}

function buildEstablishmentSelect(staffId) {
    const select = document.getElementById('confirm-dispo-establishment');
    select.innerHTML = '';

    // Établissements préférés du staff (champ staff.venues)
    const staff = staffId ? allStaff.find(s => String(s._id) === String(staffId)) : null;
    const preferredIds = (staff && Array.isArray(staff.venues)) ? staff.venues : [];

    const preferred = [];
    const others    = [];
    allEstablishments.forEach(e => {
        if (preferredIds.includes(e.id)) preferred.push(e);
        else others.push(e);
    });
    const sortByName = (a, b) => a.name.localeCompare(b.name, 'fr');
    preferred.sort(sortByName);
    others.sort(sortByName);

    const makeOpt = (e, star) => {
        const opt = document.createElement('option');
        opt.value       = e.id;
        opt.textContent = (star ? '★ ' : '') + e.name + (e.type ? ' (' + (e.type === 'pub' ? 'Pub' : 'Resto') + ')' : '');
        return opt;
    };
    preferred.forEach(e => select.appendChild(makeOpt(e, true)));
    if (preferred.length && others.length) {
        const sep = document.createElement('option');
        sep.disabled    = true;
        sep.textContent = '──────────';
        select.appendChild(sep);
    }
    others.forEach(e => select.appendChild(makeOpt(e, false)));

    // Sélection par défaut : 1er préféré (ordre alpha), sinon établissement courant
    if (preferred.length > 0)      select.value = preferred[0].id;
    else if (currentVenueId)       select.value = currentVenueId;
}

async function loadDispoControl() {
    try {
        const [dispoRes, pointageRes] = await Promise.all([
            fetch('/api/dispo-settings',   { credentials: 'include' }),
            fetch('/api/pointage-settings', { credentials: 'include' }),
        ]);
        if (!dispoRes.ok) return;
        const settings      = await dispoRes.json();
        const ptSettings      = pointageRes.ok ? await pointageRes.json() : { cutoff_hour: 9, cutoff_open_hour: 0 };
        const cutoffHourVal     = ptSettings.cutoff_hour      ?? 9;
        const cutoffOpenHourVal = ptSettings.cutoff_open_hour ?? 0;

        const toggle = document.getElementById('dispo-toggle');
        const label  = document.getElementById('dispo-toggle-label');
        if (!toggle || !label) return;
        // Ouverture par établissement : settings.open_venues = 'ALL' | [ids].
        const venuesAll    = settings.open_venues === 'ALL';
        const openVenueSet = new Set(Array.isArray(settings.open_venues) ? settings.open_venues : []);
        const anyOpen      = venuesAll || openVenueSet.size > 0;
        const multiEstab   = allEstablishments.length > 1;
        toggle.checked = anyOpen;

        function syncToggleUI(on) {
            label.textContent = on ? 'Dispos ouvertes' : 'Saisie dispos';
            const track = document.getElementById('dispo-toggle-track');
            const thumb = document.getElementById('dispo-toggle-thumb');
            if (track) track.style.background = on ? 'var(--success)' : 'var(--dark-border)';
            if (thumb) thumb.style.transform   = on ? 'translateX(14px)' : 'translateX(0)';
        }
        syncToggleUI(anyOpen);

        const panel = document.getElementById('dispo-advanced-panel');
        if (!panel) return;
        let cdDay = '', cdTime = '13:00';
        if (settings.custom_deadline) {
            const cd = new Date(settings.custom_deadline);
            cdDay  = String(cd.getDay());
            cdTime = String(cd.getHours()).padStart(2,'0') + ':' + (cd.getMinutes() < 30 ? '00' : '30');
        }
        const openDayVal = settings.open_day !== null && settings.open_day !== undefined ? String(settings.open_day) : '';
        const dayOpts = [['1','Lundi'],['2','Mardi'],['3','Mercredi'],['4','Jeudi'],['5','Vendredi'],['6','Samedi'],['0','Dimanche']]
            .map(([v,l]) => '<option value="' + v + '"' + (cdDay === v ? ' selected' : '') + '>' + l + '</option>').join('');
        const openDayOpts = [['1','Lundi'],['2','Mardi'],['3','Mercredi'],['4','Jeudi'],['5','Vendredi'],['6','Samedi'],['0','Dimanche']]
            .map(([v,l]) => '<option value="' + v + '"' + (openDayVal === v ? ' selected' : '') + '>' + l + '</option>').join('');
        let tOpts = '';
        for (let h = 10; h < 27; h++) {
            for (const m of [0, 30]) {
                const rh = h % 24;
                const val = String(rh).padStart(2,'0') + ':' + (m === 0 ? '00' : '30');
                const lbl = String(rh).padStart(2,'0') + 'h' + (m === 0 ? '00' : '30');
                tOpts += '<option value="' + val + '"' + (cdTime === val ? ' selected' : '') + '>' + lbl + '</option>';
            }
        }
        // Options fin de fenêtre pointage (0h → 12h)
        let cutoffOpts = '';
        for (let h = 0; h <= 12; h++) {
            cutoffOpts += '<option value="' + h + '"' + (cutoffHourVal === h ? ' selected' : '') + '>' + String(h).padStart(2,'0') + 'h00</option>';
        }
        // Options début de fenêtre pointage (0h = minuit, 16h → 23h)
        let cutoffOpenOpts = '<option value="0"' + (cutoffOpenHourVal === 0 ? ' selected' : '') + '>Minuit (00h)</option>';
        for (let h = 16; h <= 23; h++) {
            cutoffOpenOpts += '<option value="' + h + '"' + (cutoffOpenHourVal === h ? ' selected' : '') + '>' + h + 'h00</option>';
        }

        // Saisie ouverte par établissement (affiché uniquement en multi-établissement).
        const venuesSection = multiEstab
            ? '<div style="margin-bottom:10px;border-top:1px solid #f0f0f0;padding-top:10px">' +
                  '<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Établissements — saisie ouverte</div>' +
                  '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
                      allEstablishments.map(e =>
                          '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#333;padding:5px 9px;border:1px solid #e8eaed;border-radius:8px;background:#fff;cursor:pointer">' +
                              '<input type="checkbox" class="_dispo-venue" value="' + e.id + '"' + ((venuesAll || openVenueSet.has(e.id)) ? ' checked' : '') + ' style="cursor:pointer;accent-color:#6C63FF"> ' + escapeHtml(e.name || e.id) +
                          '</label>').join('') +
                  '</div>' +
                  '<div style="font-size:10px;color:#bbb;margin-top:6px">Un staff peut saisir si au moins un de ses établissements est coché</div>' +
              '</div>'
            : '';

        panel.innerHTML =
            '<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Paramètres dispos</div>' +
            '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;margin-bottom:8px;cursor:pointer">' +
                '<input type="checkbox" id="dispo-force-open"' + (settings.force_open ? ' checked' : '') + '>' +
                'Ignorer deadline (urgence)' +
            '</label>' +
            '<div style="margin-bottom:10px">' +
                '<div style="font-size:11px;color:#aaa;margin-bottom:4px">Deadline personnalisée</div>' +
                '<div style="display:flex;gap:6px">' +
                    '<select id="dispo-deadline-day" style="flex:1;font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px">' +
                        '<option value="">— Jour —</option>' + dayOpts +
                    '</select>' +
                    '<select id="dispo-deadline-time" style="flex:1;font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px">' +
                        tOpts +
                    '</select>' +
                '</div>' +
                '<div style="font-size:10px;color:#bbb;margin-top:3px">Laisser jour vide = vendredi 13h auto</div>' +
            '</div>' +
            '<div style="margin-bottom:10px;border-top:1px solid #f0f0f0;padding-top:10px">' +
                '<div style="font-size:11px;color:#aaa;margin-bottom:4px">Rappel auto — ouverture des dispos</div>' +
                '<select id="dispo-open-day" style="width:100%;font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px">' +
                    '<option value="">— Désactivé —</option>' + openDayOpts +
                '</select>' +
                '<div style="font-size:10px;color:#bbb;margin-top:3px">Jour où le rappel d\'ouverture est envoyé à 10h</div>' +
            '</div>' +
            venuesSection +
            '<div style="margin-bottom:10px;border-top:1px solid #f0f0f0;padding-top:10px">' +
                '<div style="font-size:11px;color:#aaa;margin-bottom:6px">Fenêtre de saisie pointage</div>' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                    '<span style="font-size:11px;color:#666">De</span>' +
                    '<select id="pointage-cutoff-open" style="font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px">' +
                        cutoffOpenOpts +
                    '</select>' +
                    '<span style="font-size:11px;color:#666">jusqu\'à</span>' +
                    '<select id="pointage-cutoff" style="font-size:12px;border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px">' +
                        cutoffOpts +
                    '</select>' +
                    '<span style="font-size:10px;color:#bbb">le lendemain</span>' +
                '</div>' +
            '</div>' +
            '<button id="dispo-save-advanced" style="width:100%;padding:6px;background:#1a1a2e;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer">Enregistrer</button>';

        const settingsBtn = document.getElementById('dispo-settings-btn');
        if (settingsBtn) {
            settingsBtn.onclick = (e) => {
                e.stopPropagation();
                panel.style.display = panel.style.display === 'none' ? '' : 'none';
            };
        }
        document.addEventListener('click', () => { panel.style.display = 'none'; });
        panel.addEventListener('click', e => e.stopPropagation());

        document.getElementById('dispo-save-advanced').addEventListener('click', async () => {
            const forceOpen   = document.getElementById('dispo-force-open').checked;
            const dayVal      = document.getElementById('dispo-deadline-day').value;
            const timeVal     = document.getElementById('dispo-deadline-time').value || '13:00';
            const cutoffVal     = parseInt(document.getElementById('pointage-cutoff').value);
            const cutoffOpenVal = parseInt(document.getElementById('pointage-cutoff-open').value);
            let customDeadline = null;
            if (dayVal !== '') {
                const [hh, mm] = timeVal.split(':').map(Number);
                const now    = new Date();
                const target = new Date(now);
                const diff   = (parseInt(dayVal) - now.getDay() + 7) % 7;
                target.setDate(now.getDate() + diff);
                target.setHours(hh, mm, 0, 0);
                // Format local "YYYY-MM-DDTHH:MM:00" — voir architecture.md §3.1
                // (toISOString() interdit : en UTC+2, 00h local = 22h UTC → shift de jour)
                const pad = n => String(n).padStart(2, '0');
                customDeadline = target.getFullYear() + '-' +
                    pad(target.getMonth() + 1) + '-' +
                    pad(target.getDate()) + 'T' +
                    pad(target.getHours()) + ':' +
                    pad(target.getMinutes()) + ':00';
            }
            // Multi-établissement → open_venues depuis les cases ; sinon raccourci global.
            let dispoBody;
            if (multiEstab) {
                const checkedVenues = [...document.querySelectorAll('._dispo-venue:checked')].map(c => c.value);
                const openVenuesOut = checkedVenues.length === allEstablishments.length ? 'ALL' : checkedVenues;
                dispoBody = { open_venues: openVenuesOut, force_open: forceOpen, custom_deadline: customDeadline, open_day: document.getElementById('dispo-open-day').value };
                toggle.checked = checkedVenues.length > 0;
                syncToggleUI(checkedVenues.length > 0);
            } else {
                dispoBody = { open: toggle.checked, force_open: forceOpen, custom_deadline: customDeadline, open_day: document.getElementById('dispo-open-day').value };
            }
            await Promise.all([
                fetch('/api/dispo-settings', {
                    credentials: 'include', method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dispoBody),
                }),
                fetch('/api/pointage-settings', {
                    credentials: 'include', method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cutoff_hour: cutoffVal, cutoff_open_hour: cutoffOpenVal }),
                }),
            ]);
            panel.style.display = 'none';
            showToast('Paramètres enregistrés');
        });

        toggle.onchange = async () => {
            const on = toggle.checked;
            // Raccourci tout/rien : ouvre ou ferme TOUS les établissements.
            await fetch('/api/dispo-settings', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ open_venues: on ? 'ALL' : [] }),
            });
            syncToggleUI(on);
            document.querySelectorAll('._dispo-venue').forEach(c => { c.checked = on; });
            showToast(on
                ? (multiEstab ? 'Saisie ouverte (tous les établissements)' : 'Saisie des dispos ouverte')
                : 'Saisie des dispos fermée');
        };
    } catch { }
}

// ── Modale gestion staff ─────────────────────────────────────────────────────

document.getElementById('btn-manage-staff').addEventListener('click', openStaffModal);
document.getElementById('staff-modal-close').addEventListener('click', () => {
    document.getElementById('staff-modal').style.display = 'none';
});


// ── Onglet Rôles ─────────────────────────────────────────────────────────────

function renderRolesList() {
    const list = document.getElementById('roles-manage-list');
    if (!list) return;
    list.innerHTML = '';

    if (allRoles.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:#ccc;font-size:13px;padding:16px 0">Aucun rôle créé</p>';
    } else {
        allRoles.forEach(role => {
            const row = document.createElement('div');
            row.className = 'role-manage-row';
            row.innerHTML =
                '<span class="role-type-badge ' + role.type + '">' +
                    (role.type === 'responsable' ? 'Responsable' : 'Informatif') +
                '</span>' +
                '<span style="flex:1;font-size:13px;font-weight:600;color:#333">' + escapeHtml(role.name) + '</span>' +
                '<button class="staff-manage-delete" data-id="' + escapeHtml(role._id) + '">×</button>';
            row.querySelector('.staff-manage-delete').addEventListener('click', () => {
                showConfirm('Supprimer le rôle <strong>' + escapeHtml(role.name) + '</strong> ?', async () => {
                    try {
                        const res = await fetch('/api/roles/' + role._id, { credentials: 'include', method: 'DELETE' });
                        if (!res.ok) throw new Error((await res.json()).error);
                        await loadRoles();
                        renderRolesList();
                        renderStaffManageList();
                        showToast('Rôle supprimé');
                    } catch (e) { showToast(e.message, true); }
                });
            });
            list.appendChild(row);
        });
    }

    // Listener bouton créer rôle
    const btnAdd = document.getElementById('btn-add-role');
    if (btnAdd && !btnAdd._bound) {
        btnAdd._bound = true;
        btnAdd.addEventListener('click', async () => {
            const name = document.getElementById('new-role-name').value.trim();
            const type = document.getElementById('new-role-type').value;
            if (!name) { showToast('Nom requis', true); return; }
            try {
                const res = await fetch('/api/roles', {
                    credentials: 'include', method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, type }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                document.getElementById('new-role-name').value = '';
                await loadRoles();
                renderRolesList();
                renderStaffManageList();
                buildRoleFilters();
                showToast('Rôle "' + name + '" créé');
            } catch (e) { showToast(e.message, true); }
        });
    }
}

function openStaffModal() {
    // Init onglets (une seule fois)
    document.querySelectorAll('.staff-modal-tab').forEach(btn => {
        if (btn._tabBound) return;
        btn._tabBound = true;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.staff-modal-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            const staffTab = document.getElementById('staff-tab-staff');
            const rolesTab = document.getElementById('staff-tab-roles');
            const reposTab = document.getElementById('staff-tab-repos');
            if (staffTab) staffTab.style.display = tab === 'staff' ? '' : 'none';
            if (rolesTab) rolesTab.style.display  = tab === 'roles' ? '' : 'none';
            if (reposTab) reposTab.style.display  = tab === 'repos' ? '' : 'none';
            if (tab === 'roles') renderRolesList();
            if (tab === 'repos') renderRestDaysTab();
        });
    });
    // Revenir sur l'onglet Membres
    document.querySelectorAll('.staff-modal-tab').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="staff"]')?.classList.add('active');
    const staffTab = document.getElementById('staff-tab-staff');
    const rolesTab = document.getElementById('staff-tab-roles');
    const reposTab = document.getElementById('staff-tab-repos');
    if (staffTab) staffTab.style.display = '';
    if (rolesTab) rolesTab.style.display  = 'none';
    if (reposTab) reposTab.style.display  = 'none';
    renderStaffManageList();
    document.getElementById('staff-modal').style.display = 'flex';
}

function renderRestDaysTab() {
    const container = document.getElementById('rest-days-list');
    if (!container) return;
    container.innerHTML = '';

    const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 600;
    const REST_LABELS = portrait
        ? ['L', 'M', 'M', 'J', 'V', 'S', 'D']
        : ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const REST_VALUES = [1, 2, 3, 4, 5, 6, 0];
    const colW  = portrait ? '28px' : '44px';
    const pad   = portrait ? '5px 8px' : '7px 14px';
    const hpad  = portrait ? '6px 8px 4px' : '8px 14px 6px';
    const COL   = '1fr repeat(7,' + colW + ')';
    const cbSz  = portrait ? '14px' : '16px';
    const nameFz = portrait ? '12px' : '13px';

    // En-tête sticky
    const header = document.createElement('div');
    header.style.cssText = 'display:grid;grid-template-columns:' + COL + ';gap:0 2px;align-items:center;padding:' + hpad + ';border-bottom:2px solid #ececec;font-size:10px;font-weight:600;color:#aaa;position:sticky;top:0;background:#fff;z-index:1;';
    header.innerHTML = '<span>Membre</span>' +
        REST_LABELS.map(l => '<span style="text-align:center">' + escapeHtml(l) + '</span>').join('');
    container.appendChild(header);

    // Une ligne par staff avec checkboxes
    allStaff.forEach(staff => {
        const restDays = staff.rest_days || [];
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:' + COL + ';gap:0 2px;align-items:center;padding:' + pad + ';border-bottom:1px solid #f5f5f5;';

        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'font-size:' + nameFz + ';font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameEl.title = staff.name;
        nameEl.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + escapeHtml(staff.color) + ';margin-right:5px;vertical-align:middle;flex-shrink:0"></span>' + escapeHtml(staff.name);
        row.appendChild(nameEl);

        REST_VALUES.forEach(dayVal => {
            const cell = document.createElement('div');
            cell.style.cssText = 'display:flex;justify-content:center;align-items:center;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.dataset.day = String(dayVal);
            cb.className = 'rest-day-tab-cb';
            cb.checked = restDays.includes(dayVal);
            cb.style.cssText = 'width:' + cbSz + ';height:' + cbSz + ';accent-color:#e74c3c;cursor:pointer;';
            cell.appendChild(cb);
            row.appendChild(cell);
        });

        container.appendChild(row);
    });

    // Bouton "Tout enregistrer"
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;padding:12px 14px 6px;';
    const saveAll = document.createElement('button');
    saveAll.type = 'button';
    saveAll.textContent = 'Enregistrer';
    saveAll.style.cssText = 'font-size:12px;padding:6px 18px;border-radius:8px;border:none;background:var(--accent);color:white;cursor:pointer;font-weight:600;';
    saveAll.addEventListener('click', async () => {
        let ok = 0, fail = 0;
        const rowEls = Array.from(container.children).slice(1, -1); // skip header and footer
        const promises = allStaff.map((s, i) => {
            const rowEl = rowEls[i];
            if (!rowEl) return Promise.resolve();
            const newRestDays = Array.from(rowEl.querySelectorAll('.rest-day-tab-cb'))
                .filter(cb => cb.checked).map(cb => parseInt(cb.dataset.day));
            return fetch('/api/staff/' + s._id, {
                method: 'PATCH', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rest_days: newRestDays }),
            }).then(res => {
                if (!res.ok) return res.json().then(d => { fail++; });
                s.rest_days = newRestDays;
                ok++;
            }).catch(() => { fail++; });
        });
        await Promise.all(promises);
        showToast(ok + ' membre(s) mis à jour' + (fail ? ', ' + fail + ' erreur(s)' : ''), fail > 0);
    });
    footer.appendChild(saveAll);
    container.appendChild(footer);
}

function renderRolesHeader() {
    const container = document.getElementById('roles-header');
    if (!container) return;
    container.innerHTML = '';

    if (allRoles.length === 0) {
        container.innerHTML =
            '<div style="font-size:12px;color:#bbb;padding:4px 0">Aucun rôle créé. Utilise le bouton "+ Rôle" sur une fiche staff.</div>';
        return;
    }

    allRoles.forEach(role => {
        const chip = document.createElement('div');
        chip.className = 'role-chip';
        chip.innerHTML =
            '<span class="role-chip-dot ' + role.type + '"></span>' +
            '<span class="role-chip-name">' + role.name + '</span>' +
            '<span class="role-chip-type">' + (role.type === 'responsable' ? 'Resp.' : 'Info') + '</span>' +
            '<button class="role-chip-del" data-id="' + role._id + '" title="Supprimer">×</button>';

        chip.querySelector('.role-chip-del').addEventListener('click', () => {
            showConfirm('Supprimer le rôle <strong>' + role.name + '</strong> ? Il sera retiré de tous les employés.', async () => {
                try {
                    const res = await fetch('/api/roles/' + role._id, {
                        credentials: 'include', method: 'DELETE'
                    });
                    if (!res.ok) throw new Error((await res.json()).error);
                    await loadRoles();
                    allStaff.forEach(s => {
                        if (s.roles) s.roles = s.roles.filter(r => r !== String(role._id));
                    });
                    renderRolesHeader();
                    renderStaffManageList();
                    showToast('Rôle "' + role.name + '" supprimé');
                } catch (e) { showToast(e.message, true); }
            });
        });

        container.appendChild(chip);
    });

    // Bouton créer un rôle dans le header
    const btnNew = document.createElement('button');
    btnNew.className   = 'btn-new-role';
    btnNew.textContent = '+ Nouveau rôle';
    btnNew.addEventListener('click', () => {
        showTextPrompt('Nom du nouveau rôle', 'ex : Manager, Barman…', (name) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
            overlay.innerHTML =
                '<div style="background:white;border-radius:14px;padding:24px;max-width:360px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
                    '<p style="font-size:14px;color:#1a1a2e;margin-bottom:16px">Type du rôle <strong>' + name + '</strong> :</p>' +
                    '<div style="display:flex;gap:8px">' +
                        '<button id="_rt" style="flex:1;padding:10px;border-radius:8px;border:1.5px solid #534AB7;background:#f0effe;color:#534AB7;font-size:13px;font-weight:600;cursor:pointer">Responsable</button>' +
                        '<button id="_ri" style="flex:1;padding:10px;border-radius:8px;border:1px solid #e0e0e0;background:white;color:#555;font-size:13px;cursor:pointer">Informatif</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);
            const close = () => document.body.removeChild(overlay);
            const createRole = async (type) => {
                close();
                try {
                    const res = await fetch('/api/roles', {
                        credentials: 'include', method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name.trim(), type }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    await loadRoles();
                    renderRolesHeader();
                    renderStaffManageList();
                    showToast('Rôle "' + name + '" créé');
                } catch (e) { showToast(e.message, true); }
            };
            overlay.querySelector('#_rt').addEventListener('click', () => createRole('responsable'));
            overlay.querySelector('#_ri').addEventListener('click', () => createRole('informatif'));
            overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        });
    });
    container.appendChild(btnNew);
}

function renderStaffManageList() {
    const list = document.getElementById('staff-manage-list');
    list.innerHTML = '';

    if (allStaff.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:#ccc;font-size:13px;padding:16px 0">Aucun membre du staff</p>';
        return;
    }

    allStaff.forEach(staff => {
        const row = document.createElement('div');
        row.className = 'staff-manage-row';

        const hasLogin = !!staff.email;

        // Boutons établissements préférentiels
        const staffVenues = staff.venues || [];
        const venueButtons = allEstablishments.map(e =>
            '<button class="venue-pref-btn' + (staffVenues.includes(e.id) ? ' active' : '') + '" data-venue="' + e.id + '" title="' + e.name + '">' + e.name + '</button>'
        ).join('');

        // Rôles : badges cliquables groupés par type, sans bouton création
        const staffRoles = staff.roles || [];
        const responsableRoles = allRoles.filter(r => r.type === 'responsable');
        const informatifRoles  = allRoles.filter(r => r.type === 'informatif');

        const makeRoleBadges = (roles, type) => roles.map(r =>
            '<button class="role-assign-btn ' + type + (staffRoles.includes(String(r._id)) ? ' active' : '') +
            '" data-role="' + r._id + '" type="button">' + r.name + '</button>'
        ).join('');

        const rolesHTML = allRoles.length === 0
            ? '<span style="font-size:11px;color:#ccc;font-style:italic">Aucun rôle — créez-en dans l\'onglet Rôles</span>'
            : (responsableRoles.length
                ? '<div class="role-assign-group">' +
                    '<span class="role-assign-label responsable">Responsable</span>' +
                    makeRoleBadges(responsableRoles, 'responsable') +
                  '</div>'
                : '') +
              (informatifRoles.length
                ? '<div class="role-assign-group">' +
                    '<span class="role-assign-label informatif">Informatif</span>' +
                    makeRoleBadges(informatifRoles, 'informatif') +
                  '</div>'
                : '');

        const canSubmit    = staff.can_submit_dispos !== false; // true par défaut
        const congeModes   = ['both', 'request', 'info'].includes(staff.conge_modes) ? staff.conge_modes : 'both';
        const staffGroups  = staff.groups || [];
        // Chips groupes disponibles
        const groupChips = allGroups.length
            ? '<div style="margin-top:6px"><div style="font-size:11px;color:#aaa;margin-bottom:4px">Groupes</div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
              allGroups.map(g =>
                  '<button type="button" class="staff-group-btn' + (staffGroups.includes(g) ? ' active' : '') + '" ' +
                  'data-group="' + escapeHtml(g) + '" style="padding:3px 10px;border-radius:20px;border:1.5px solid ' +
                  (staffGroups.includes(g) ? '#534AB7' : '#e0e0e0') + ';background:' +
                  (staffGroups.includes(g) ? '#f0effe' : 'white') + ';color:' +
                  (staffGroups.includes(g) ? '#534AB7' : '#888') + ';font-size:11px;cursor:pointer">' + escapeHtml(g) + '</button>'
              ).join('') + '</div></div>'
            : '';


        row.innerHTML =
            '<input type="color" class="staff-manage-color" value="' + escapeHtml(staff.color) + '" title="Changer la couleur">' +
            '<div class="staff-manage-info">' +
                '<input type="text" class="staff-manage-name-input"     value="' + escapeHtml(staff.name) + '" placeholder="Nom">' +
                '<input type="text" class="staff-manage-nickname-input" value="' + escapeHtml(staff.nickname || '') + '" placeholder="Surnom affiché sur le planning (optionnel)">' +
                '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
                    '<span style="font-size:11px;color:#aaa">Couleur nom :</span>' +
                    '<input type="color" class="staff-manage-name-color" value="' + escapeHtml(staff.name_color || staff.color) + '" title="Couleur du nom">' +
                    '<button type="button" class="staff-name-color-reset" style="font-size:10px;color:#bbb;border:1px solid #e0e0e0;background:white;border-radius:4px;padding:2px 6px;cursor:pointer" title="Utiliser la couleur du shift">Reset</button>' +
                '</div>' +
                (function () {
                    // Deux modes mutuellement exclusifs : taux horaire OU forfait fixe par shift.
                    const isFixedMode = staff.fixed_rate != null;
                    const hRate = staff.hourly_rate != null ? staff.hourly_rate : '';
                    const fRate = staff.fixed_rate  != null ? staff.fixed_rate  : '';
                    return '<div class="staff-rate-block" data-mode="' + (isFixedMode ? 'fixed' : 'hourly') + '" style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">' +
                        '<span style="font-size:11px;color:#aaa">Rémunération :</span>' +
                        '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#555;cursor:pointer">' +
                            '<input type="radio" name="rate-mode-' + staff._id + '" class="staff-rate-mode" value="hourly" ' + (isFixedMode ? '' : 'checked') + '> Horaire' +
                        '</label>' +
                        '<label style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#555;cursor:pointer">' +
                            '<input type="radio" name="rate-mode-' + staff._id + '" class="staff-rate-mode" value="fixed" ' + (isFixedMode ? 'checked' : '') + '> Forfait' +
                        '</label>' +
                        '<span class="staff-rate-input-wrap" data-for="hourly" style="display:' + (isFixedMode ? 'none' : 'inline-flex') + ';align-items:center;gap:4px">' +
                            '<input type="number" step="0.01" min="0" class="staff-manage-hourly-rate" value="' + hRate + '" placeholder="12.50" style="width:80px;padding:3px 6px;border:1px solid #e0e0e0;border-radius:4px;font-size:12px;font-family:inherit">' +
                            '<span style="font-size:11px;color:#aaa">€/h brut</span>' +
                        '</span>' +
                        '<span class="staff-rate-input-wrap" data-for="fixed" style="display:' + (isFixedMode ? 'inline-flex' : 'none') + ';align-items:center;gap:4px">' +
                            '<input type="number" step="0.01" min="0" class="staff-manage-fixed-rate" value="' + fRate + '" placeholder="80" style="width:80px;padding:3px 6px;border:1px solid #e0e0e0;border-radius:4px;font-size:12px;font-family:inherit">' +
                            '<span style="font-size:11px;color:#aaa">€ / shift brut</span>' +
                        '</span>' +
                    '</div>';
                })() +
                '<div class="venue-pref-row">' + venueButtons + '</div>' +
                '<div class="role-assign-section">' + rolesHTML + '</div>' +
                groupChips +
                '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#888;margin-top:6px;cursor:pointer">' +
                    '<input type="checkbox" class="staff-can-submit" ' + (canSubmit ? 'checked' : '') + '>' +
                    'Peut envoyer ses dispos' +
                '</label>' +
                '<div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">' +
                    '<span style="font-size:11px;color:#aaa">🌴 Congés autorisés :</span>' +
                    '<select class="staff-conge-modes" style="font-size:11px;padding:3px 6px;border:1px solid #e0e0e0;border-radius:4px;font-family:inherit;color:#555">' +
                        '<option value="both"'    + (congeModes === 'both'    ? ' selected' : '') + '>Les deux</option>' +
                        '<option value="request"' + (congeModes === 'request' ? ' selected' : '') + '>Demande au patron</option>' +
                        '<option value="info"'    + (congeModes === 'info'    ? ' selected' : '') + '>Informatif</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<button class="staff-manage-save">Enregistrer</button>' +
            '<button class="staff-manage-delete" title="Supprimer">×</button>';

        // Reset name_color
        const resetNameColor = row.querySelector('.staff-name-color-reset');
        if (resetNameColor) {
            resetNameColor.addEventListener('click', () => {
                const colorInput = row.querySelector('.staff-manage-name-color');
                colorInput.value = row.querySelector('.staff-manage-color').value;
            });
        }

        // Toggle groupes
        row.querySelectorAll('.staff-group-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
                const isActive = btn.classList.contains('active');
                btn.style.borderColor = isActive ? '#534AB7' : '#e0e0e0';
                btn.style.background  = isActive ? '#f0effe' : 'white';
                btn.style.color       = isActive ? '#534AB7' : '#888';
            });
        });

        // Toggle mode rémunération (horaire / forfait) : affiche le champ pertinent
        row.querySelectorAll('.staff-rate-mode').forEach(radio => {
            radio.addEventListener('change', () => {
                const mode = radio.value;
                const block = row.querySelector('.staff-rate-block');
                if (block) block.dataset.mode = mode;
                row.querySelectorAll('.staff-rate-input-wrap').forEach(w => {
                    w.style.display = (w.dataset.for === mode) ? 'inline-flex' : 'none';
                });
            });
        });

        // Toggle établissements préférentiels
        row.querySelectorAll('.venue-pref-btn').forEach(btn => {
            btn.addEventListener('click', () => btn.classList.toggle('active'));
        });

        // Toggle rôles
        row.querySelectorAll('.role-assign-btn').forEach(btn => {
            btn.addEventListener('click', () => btn.classList.toggle('active'));
        });

        // (suppression des rôles déplacée dans l'onglet Rôles)
        row.querySelectorAll('.btn-delete-role').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const roleId   = btn.dataset.roleId;
                const roleName = btn.dataset.roleName;
                showConfirm('Supprimer le rôle <strong>' + roleName + '</strong> pour tous les membres du staff ?', async () => {
                    try {
                        const res = await fetch('/api/roles/' + roleId, { credentials: 'include', method: 'DELETE' });
                        if (!res.ok) throw new Error((await res.json()).error);
                        await loadRoles();
                        await loadAllStaff();
                        renderStaffManageList();
                        showToast('Rôle "' + roleName + '" supprimé');
                    } catch (e) { showToast(e.message, true); }
                });
            });
        });

        // Rôles gérés dans l'onglet dédié

        // Enregistrer
        row.querySelector('.staff-manage-save').addEventListener('click', async () => {
            const newName       = row.querySelector('.staff-manage-name-input').value.trim();
            const newNickname   = row.querySelector('.staff-manage-nickname-input').value.trim() || null;
            const newColor      = row.querySelector('.staff-manage-color').value;
            const newNameColor  = row.querySelector('.staff-manage-name-color')?.value || null;
            const newVenues     = Array.from(row.querySelectorAll('.venue-pref-btn.active')).map(b => b.dataset.venue);
            const newRoles      = Array.from(row.querySelectorAll('.role-assign-btn.active')).map(b => b.dataset.role);
            const newCanSubmit  = row.querySelector('.staff-can-submit').checked;
            const newCongeModes = row.querySelector('.staff-conge-modes')?.value || 'both';
            const newGroups     = Array.from(row.querySelectorAll('.staff-group-btn.active')).map(b => b.dataset.group);
            const rateMode = row.querySelector('.staff-rate-mode:checked')?.value || 'hourly';
            const hRaw = row.querySelector('.staff-manage-hourly-rate')?.value;
            const fRaw = row.querySelector('.staff-manage-fixed-rate')?.value;
            // Mode actif → on envoie la valeur saisie ; l'autre champ est forcé null
            // côté client pour rester explicite (le serveur applique aussi la mutual exclusion).
            const newHourlyRate = rateMode === 'hourly' && hRaw !== '' && hRaw != null ? parseFloat(hRaw) : null;
            const newFixedRate  = rateMode === 'fixed'  && fRaw !== '' && fRaw != null ? parseFloat(fRaw) : null;

            if (!newName) { showToast('Le nom ne peut pas être vide', true); return; }

            // Déterminer si name_color est différent de color (sinon null = reset)
            const effectiveNameColor = newNameColor && newNameColor !== newColor ? newNameColor : null;

            try {
                const res = await fetch('/api/staff/' + staff._id, {
                    method:      'PATCH',
                    credentials: 'include',
                    headers:     { 'Content-Type': 'application/json' },
                    body:        JSON.stringify({ name: newName, color: newColor, venues: newVenues, roles: newRoles, can_submit_dispos: newCanSubmit, conge_modes: newCongeModes, groups: newGroups, name_color: effectiveNameColor, nickname: newNickname, hourly_rate: newHourlyRate, fixed_rate: newFixedRate }),
                });
                if (!res.ok) throw new Error((await res.json()).error);

                staff.name              = newName;
                staff.nickname          = newNickname;
                staff.color             = newColor;
                staff.venues            = newVenues;
                staff.roles             = newRoles;
                staff.can_submit_dispos = newCanSubmit;
                staff.conge_modes       = newCongeModes;
                staff.groups            = newGroups;
                staff.name_color = effectiveNameColor;
                staff.hourly_rate = newHourlyRate;
                staff.fixed_rate  = newFixedRate;

                buildStaffDisplayNames();

                // Propager sur les shifts visibles
                document.querySelectorAll('.shift').forEach(el => {
                    const sd = currentShifts.find(s => String(s._id) === el.dataset.id);
                    if (sd && sd.staff_id === staff._id) {
                        el.style.background = newColor;
                        el.style.color = textColorFor(newColor);
                        el.querySelector('.shift-name').textContent = displayName(staff._id, newName);
                        sd.color = newColor; sd.staff_name = newName;
                    }
                });

                renderSidebar();
                renderStaffManageList();
                showToast(`${newName} mis à jour`);
            } catch (e) { showToast(e.message || 'Erreur', true); }
        });

        // Supprimer
        row.querySelector('.staff-manage-delete').addEventListener('click', () => {
            showConfirm('Supprimer <strong>' + staff.name + '</strong> ? Tous ses shifts seront supprimés.', async () => {
                try {
                    const res = await fetch('/api/staff/' + staff._id, { method: 'DELETE', credentials: 'include' });
                    if (!res.ok) throw new Error((await res.json()).error);

                    allStaff = allStaff.filter(s => s._id !== staff._id);
                    buildStaffDisplayNames();
                    currentShifts  = currentShifts.filter(s => s.staff_id !== staff._id);
                    displayedStaff = displayedStaff.filter(s => s._id !== staff._id);

                    renderSidebar();
                    renderStaffManageList();
                    renderBody();
                    renderStats();
                    showToast(staff.name + ' supprimé');
                } catch (e) { showToast(e.message || 'Erreur suppression', true); }
            });
        });

        list.appendChild(row);
    });
}

// Ajouter un nouveau membre
document.getElementById('btn-add-staff').addEventListener('click', async () => {
    const nameInput  = document.getElementById('new-staff-name');
    const emailInput = document.getElementById('new-staff-email');
    const colorInput = document.getElementById('new-staff-color');

    const name  = nameInput.value.trim();
    const email = emailInput.value.trim();
    const color = colorInput.value;

    if (!name) { showToast('Le prénom est obligatoire', true); nameInput.focus(); return; }

    try {
        const res = await fetch('/api/staff', {
            method:  'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name, color, email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        allStaff.push(data);
        buildStaffDisplayNames();
        renderSidebar();
        renderStaffManageList();

        // Reset form + nouvelle couleur auto pour le prochain
        nameInput.value  = '';
        emailInput.value = '';
        colorInput.value = generateColor('');
        showToast(`${name} ajouté au staff`);
    } catch (e) { showToast(e.message || 'Erreur ajout', true); }
});

// ── Couleurs ──────────────────────────────────────────────────────────────────

function textColorFor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#1a1a2e' : '#ffffff';
}

// Applique un fond teinté sur la carte staff quand name_color est trop claire pour le blanc.
// Réutilise textColorFor : si la police est "lisible sur fond sombre" → elle est claire → fond blanc KO.
function applyCardNameContrast(card, staffColor, nameColor) {
    if (nameColor && textColorFor(nameColor) === '#1a1a2e') {
        const r = parseInt(staffColor.slice(1, 3), 16);
        const g = parseInt(staffColor.slice(3, 5), 16);
        const b = parseInt(staffColor.slice(5, 7), 16);
        card.style.background = `rgba(${r},${g},${b},0.75)`;
    } else {
        card.style.background = '';
    }
}

// Couleur de la police à utiliser sur un shift :
// — si le staff a défini une couleur de texte personnalisée (name_color), on l'applique,
// — sinon on choisit noir ou blanc automatiquement selon le contraste avec la couleur de fond.
function shiftTextColor(shift) {
    if (!shift) return '#1a1a2e';
    if (shift.is_joker || shift.staff_id === '__joker__') return '#555';
    const staff = allStaff.find(s => String(s._id) === String(shift.staff_id));
    if (staff && staff.name_color) return staff.name_color;
    return textColorFor(shift.color || '#3498db');
}

const AUTO_COLORS = [
    '#3498db','#9b59b6','#e67e22','#2ecc71','#e74c3c',
    '#1abc9c','#e91e8c','#f39c12','#16a085','#8e44ad',
    '#d35400','#27ae60','#2980b9','#c0392b','#7f8c8d',
];

function generateColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % AUTO_COLORS.length;
    return AUTO_COLORS[hash];
}

async function updateStaffColor(staff, newColor, card) {
    staff.color = newColor;
    card.querySelector('.staff-dot').style.background = newColor;
    applyCardNameContrast(card, newColor, staff.name_color);
    // Synchroniser la valeur du font-color-picker si pas de couleur texte custom
    if (!staff.name_color) {
        const fp = card.querySelector('.font-color-picker');
        if (fp) fp.value = newColor;
    }
    const fallbackText = textColorFor(newColor);
    document.querySelectorAll('.shift').forEach(el => {
        const sd = currentShifts.find(s => String(s._id) === el.dataset.id);
        if (sd && sd.staff_id === staff._id) {
            sd.color = newColor;
            el.style.background = newColor;
            el.style.color = staff.name_color || fallbackText;
        }
    });
    document.querySelectorAll('.row-label-dot').forEach(dot => {
        const row = dot.closest('.staff-row');
        if (row?.dataset.staffId === staff._id) dot.style.background = newColor;
    });
    try {
        await fetch(`/api/staff/${staff._id}`, {
            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: newColor }),
        });
        showToast(`Couleur de ${staff.name} mise à jour`);
    } catch { showToast('Erreur sauvegarde couleur', true); }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function renderStats() {
    const bar = document.getElementById('stats-bar');
    bar.innerHTML = '';
    // Jokers = shifts non encore assignés à une personne. On les exclut des
    // heures cumulées ET du nombre de staff pour que « Moy. par personne »
    // reflète bien les personnes réellement planifiées.
    const isJokerShift = s => s.is_joker || s.staff_id === '__joker__';
    // On restreint au même périmètre que displayedStaff (filtre groupe inclus)
    // pour que la moyenne soit mathématiquement cohérente avec les heures cumulées.
    const displayedStaffIds = new Set(
        displayedStaff.filter(s => !s.isJoker).map(s => String(s._id))
    );
    const realShifts = currentShifts.filter(s =>
        !isJokerShift(s) && displayedStaffIds.has(String(s.staff_id))
    );
    const totalH = realShifts.reduce((a, s) => {
        const start = s.real_start != null ? s.real_start : s.start_time;
        const end   = s.real_end   != null ? s.real_end   : s.end_time;
        return a + (end - start);
    }, 0);
    const nbStaff = displayedStaffIds.size;
    const fmtH = h => ShiftHours.fmtDurationH(h);
    [
        { label: 'Staff planifié',    value: nbStaff,                                          sub: 'ce jour' },
        { label: 'Shifts',            value: currentShifts.length,                             sub: 'ce jour' },
        { label: 'Heures cumulées',   value: fmtH(totalH),                                     sub: 'au total' },
        { label: 'Moy. par personne', value: nbStaff ? fmtH(totalH / nbStaff) : '—',          sub: 'h / employé' },
    ].forEach(({ label, value, sub }) => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub}</div>`;
        bar.appendChild(card);
    });
}

// ── Toasts ────────────────────────────────────────────────────────────────────

let toastTimer, conflictTimer;

function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = 'visible' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = '', 2500);
}

function showConflictAlert(warnings, staffName) {
    const el = document.getElementById('conflict-toast');
    el.innerHTML = `⚠️ <strong>${escapeHtml(staffName)}</strong> — ${warnings.map(w => escapeHtml(w.message)).join('<br>')}`;
    el.classList.add('visible');
    clearTimeout(conflictTimer);
    conflictTimer = setTimeout(() => el.classList.remove('visible'), 5000);
}

// ── Logout ───────────────────────────────────────────────────────────────────

async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
}

// ── Démarrage ─────────────────────────────────────────────────────────────────

init();
// ── Création en masse de profils staff depuis une liste de noms ───────────────

function openBulkStaffNamesModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
        <div style="background:white;border-radius:14px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2)">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0">
                <span style="font-size:16px;font-weight:700;color:#1a1a2e">Créer des profils staff</span>
                <button id="_bs-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#aaa;line-height:1">&times;</button>
            </div>
            <div style="padding:16px 20px">
                <div style="background:#f8f8f8;border-radius:8px;padding:12px 14px;font-size:12px;color:#555;margin-bottom:14px;line-height:1.6">
                    Un nom par ligne. Crée uniquement le profil (couleur auto) — aucun compte, aucun email, aucun SMS.<br>
                    Pour envoyer une invitation plus tard, utilise <strong>🔑 Comptes → ⬆ Import CSV</strong>.
                </div>
                <textarea id="_bs-input" placeholder="Marie Dupont&#10;Jean Martin&#10;Sophie Leroy"
                    style="width:100%;height:180px;border:1.5px solid #e0e0e0;border-radius:10px;padding:10px 12px;font-size:13px;font-family:monospace;resize:vertical;outline:none;box-sizing:border-box"></textarea>
                <div id="_bs-preview" style="margin-top:14px"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
                    <button id="_bs-confirm" style="background:#27ae60;color:white;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer">Créer les profils</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_bs-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#_bs-confirm').addEventListener('click', async () => {
        const raw   = overlay.querySelector('#_bs-input').value;
        const names = raw.split('\n').map(l => l.trim()).filter(Boolean);
        if (!names.length) { showToast('Saisis au moins un nom', true); return; }

        const btn = overlay.querySelector('#_bs-confirm');
        btn.disabled = true;
        btn.textContent = 'Création…';

        try {
            const res  = await fetch('/api/staff/bulk', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ names }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            if (Array.isArray(data.created) && data.created.length) {
                allStaff.push(...data.created);
                buildStaffDisplayNames();
                renderSidebar();
                renderStaffManageList();
            }

            const preview = overlay.querySelector('#_bs-preview');
            let html = '';
            if (data.created.length) {
                html += '<div style="background:#f0fdf4;border:1.5px solid #27ae60;border-radius:10px;padding:12px;margin-bottom:8px;font-size:12px;color:#1a5e3c">' +
                    '<strong>✅ ' + data.created.length + ' profil(s) créé(s)</strong><br>' +
                    data.created.map(s => s.name).join(', ') + '</div>';
            }
            if (data.skipped.length) {
                html += '<div style="background:#fff9e6;border:1px solid #f0c040;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:11px;color:#7d6000">' +
                    '<strong>' + data.skipped.length + ' ignoré(s) :</strong><br>' +
                    data.skipped.map(s => s.name + ' — ' + s.reason).join('<br>') + '</div>';
            }
            if (data.failed.length) {
                html += '<div style="background:#fff5f5;border:1px solid #f5c6c6;border-radius:8px;padding:10px 12px;font-size:11px;color:#c0392b">' +
                    '<strong>' + data.failed.length + ' erreur(s) :</strong><br>' +
                    data.failed.map(f => (f.name || '?') + ' — ' + f.reason).join('<br>') + '</div>';
            }
            preview.innerHTML = html;
            overlay.querySelector('#_bs-input').value = '';
            btn.textContent = 'Fermer';
            btn.disabled = false;
            btn.onclick = () => overlay.remove();
        } catch (e) {
            showToast(e.message || 'Erreur création', true);
            btn.disabled = false;
            btn.textContent = 'Créer les profils';
        }
    });
}

// ── Import taux horaires (CSV : prenom nom;taux) ─────────────────────────────

function openBulkStaffRatesModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
        <div style="background:white;border-radius:14px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2)">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0">
                <span style="font-size:16px;font-weight:700;color:#1a1a2e">💶 Importer les taux</span>
                <button id="_br-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#aaa;line-height:1">&times;</button>
            </div>
            <div style="padding:16px 20px">
                <div style="background:#f0effe;border:1px solid #c5beff;border-radius:8px;padding:12px 14px;font-size:12px;color:#534AB7;margin-bottom:14px;line-height:1.6">
                    Format : <strong>Prénom Nom;taux horaire;forfait journée</strong> — une ligne par staff.<br>
                    <strong>Exactement un</strong> des deux montants doit être renseigné (les deux modes sont exclusifs).<br>
                    Exemples : <code style="background:#fff;padding:1px 4px;border-radius:3px">Marie Dupont;12.50;</code> (horaire) · <code style="background:#fff;padding:1px 4px;border-radius:3px">Jean Martin;;80</code> (forfait).<br>
                    Le séparateur est <code style="background:#fff;padding:1px 4px;border-radius:3px">;</code>. Les montants acceptent point ou virgule. Insensible aux accents / casse.
                </div>
                <textarea id="_br-input" placeholder="Marie Dupont;12.50;&#10;Jean Martin;11;&#10;Sophie Leroy;;80&#10;Luc Petit;;90"
                    style="width:100%;height:200px;border:1.5px solid #e0e0e0;border-radius:10px;padding:10px 12px;font-size:13px;font-family:monospace;resize:vertical;outline:none;box-sizing:border-box"></textarea>
                <div id="_br-preview" style="margin-top:14px"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
                    <button id="_br-confirm" style="background:var(--accent);color:white;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer">Appliquer les taux</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_br-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#_br-confirm').addEventListener('click', async () => {
        const raw   = overlay.querySelector('#_br-input').value;
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) { showToast('Saisis au moins une ligne', true); return; }

        // Index des staff par nom normalisé
        const byNormName = {};
        allStaff.forEach(s => { byNormName[normalizeStr(s.name).trim()] = s; });

        const updates = [];   // { staff, rate, mode: 'hourly'|'fixed', name }
        const skipped = [];   // { line, reason }

        // Format : Nom;taux_horaire;forfait — exactement un des deux rempli.
        // Backwards-compat : 2 colonnes (Nom;taux) = horaire.
        // Fallback : si aucun `;`, on tente la dernière virgule (ancien format 1 colonne, horaire).
        lines.forEach(line => {
            let parts;
            if (line.indexOf(';') >= 0) {
                parts = line.split(';').map(p => p.trim());
            } else {
                const lastComma = line.lastIndexOf(',');
                if (lastComma < 0) { skipped.push({ line, reason: 'pas de taux' }); return; }
                parts = [line.slice(0, lastComma).trim(), line.slice(lastComma + 1).trim()];
            }

            const rawName  = parts[0] || '';
            const rawHourly = (parts[1] || '').trim();
            const rawFixed  = (parts[2] || '').trim();

            if (!rawName) { skipped.push({ line, reason: 'nom vide' }); return; }
            if (!rawHourly && !rawFixed) { skipped.push({ line, reason: 'pas de taux' }); return; }
            if (rawHourly && rawFixed)   { skipped.push({ line, reason: 'choisis horaire OU forfait (pas les deux)' }); return; }

            const mode = rawHourly ? 'hourly' : 'fixed';
            const rate = parseFloat((rawHourly || rawFixed).replace(',', '.'));
            if (Number.isNaN(rate) || rate < 0) { skipped.push({ line, reason: 'montant invalide' }); return; }

            const staff = byNormName[normalizeStr(rawName).trim()];
            if (!staff) { skipped.push({ line, reason: 'staff introuvable' }); return; }
            updates.push({ staff, rate, mode, name: staff.name });
        });

        if (updates.length === 0) {
            const prev = overlay.querySelector('#_br-preview');
            prev.innerHTML = '<div style="background:#fff5f5;border:1px solid #f5c6c6;border-radius:8px;padding:10px 12px;font-size:11px;color:#c0392b">' +
                '<strong>Aucune ligne exploitable.</strong><br>' +
                skipped.map(s => s.line + ' — ' + s.reason).join('<br>') + '</div>';
            return;
        }

        const btn = overlay.querySelector('#_br-confirm');
        btn.disabled = true;
        btn.textContent = 'Application…';

        const applied = []; const failed = [];
        for (const u of updates) {
            try {
                // Mode horaire → on envoie hourly_rate (le serveur force fixed_rate à null via mutual exclusion)
                // Mode forfait → on envoie fixed_rate (le serveur force hourly_rate à null).
                // On envoie quand même explicitement l'autre champ à null côté client pour
                // que l'intent soit limpide dans les logs.
                const payload = u.mode === 'fixed'
                    ? { hourly_rate: null, fixed_rate: u.rate }
                    : { hourly_rate: u.rate, fixed_rate: null };
                const res = await fetch('/api/staff/' + u.staff._id, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(payload),
                });
                if (!res.ok) throw new Error((await res.json()).error || 'Erreur');
                if (u.mode === 'fixed') {
                    u.staff.fixed_rate  = u.rate;
                    u.staff.hourly_rate = null;
                } else {
                    u.staff.hourly_rate = u.rate;
                    u.staff.fixed_rate  = null;
                }
                applied.push(u);
            } catch (e) {
                failed.push({ name: u.name, reason: e.message });
            }
        }

        // Rafraîchir la liste staff
        renderStaffManageList();

        const preview = overlay.querySelector('#_br-preview');
        let html = '';
        if (applied.length) {
            html += '<div style="background:#f0fdf4;border:1.5px solid #27ae60;border-radius:10px;padding:12px;margin-bottom:8px;font-size:12px;color:#1a5e3c">' +
                '<strong>✅ ' + applied.length + ' taux appliqué(s)</strong><br>' +
                applied.map(u => u.name + ' → ' + u.rate.toFixed(2).replace('.', ',') + ' ' + (u.mode === 'fixed' ? '€/shift' : '€/h')).join('<br>') + '</div>';
        }
        if (skipped.length) {
            html += '<div style="background:#fff9e6;border:1px solid #f0c040;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:11px;color:#7d6000">' +
                '<strong>' + skipped.length + ' ligne(s) ignorée(s) :</strong><br>' +
                skipped.map(s => s.line + ' — ' + s.reason).join('<br>') + '</div>';
        }
        if (failed.length) {
            html += '<div style="background:#fff5f5;border:1px solid #f5c6c6;border-radius:8px;padding:10px 12px;font-size:11px;color:#c0392b">' +
                '<strong>' + failed.length + ' erreur(s) :</strong><br>' +
                failed.map(f => f.name + ' — ' + f.reason).join('<br>') + '</div>';
        }
        preview.innerHTML = html;
        overlay.querySelector('#_br-input').value = '';
        btn.textContent = 'Fermer';
        btn.disabled = false;
        btn.onclick = () => overlay.remove();

        showToast(applied.length + ' taux mis à jour');
    });
}

// ── Import CSV comptes staff ──────────────────────────────────────────────────

function openCsvImportModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML = `
        <div style="background:white;border-radius:14px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2)">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0">
                <span style="font-size:16px;font-weight:700;color:#1a1a2e">Importer des comptes staff</span>
                <button id="_csv-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#aaa;line-height:1">&times;</button>
            </div>

            <div style="padding:16px 20px">
                <!-- Instructions -->
                <div style="background:#f8f8f8;border-radius:8px;padding:12px 14px;font-size:12px;color:#555;margin-bottom:14px;line-height:1.6">
                    <strong>Format CSV accepté :</strong> une ligne par personne, séparateur <code>,</code> ou <code>;</code><br>
                    Colonnes : <code>nom</code> ; <code>email ou téléphone</code> ; <code>surnom (optionnel)</code><br>
                    Exemple : <code>Sébastien Garcia;s.garcia@mail.com;Seb G.</code>
                    <div style="margin-top:8px;display:flex;gap:8px">
                        <button id="_csv-dl-template" style="background:#1a1a2e;color:white;border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer">⬇ Télécharger le modèle</button>
                    </div>
                </div>

                <!-- Zone de saisie / collage -->
                <textarea id="_csv-input" placeholder="Colle ton CSV ici ou saisis les lignes manuellement&#10;Exemple :&#10;Sébastien Garcia;s.garcia@mail.com;Seb G.&#10;Louise Dupont;+33612345678;Loulou&#10;Thomas Martin;t.martin@mail.com"
                    style="width:100%;height:140px;border:1.5px solid #e0e0e0;border-radius:10px;padding:10px 12px;font-size:13px;font-family:monospace;resize:vertical;outline:none;box-sizing:border-box"></textarea>

                <!-- Bouton charger un fichier -->
                <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
                    <label style="background:#f0f0f0;border:1.5px solid #ddd;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;color:#555;cursor:pointer">
                        📁 Charger un fichier CSV
                        <input type="file" id="_csv-file" accept=".csv,.txt" style="display:none">
                    </label>
                    <span id="_csv-file-name" style="font-size:12px;color:#aaa"></span>
                </div>

                <!-- Aperçu -->
                <div id="_csv-preview" style="margin-top:14px"></div>

                <!-- Actions -->
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
                    <button id="_csv-parse" style="background:#534AB7;color:white;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer">Analyser</button>
                    <button id="_csv-confirm" style="background:#27ae60;color:white;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;display:none">Créer les comptes</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    let parsedEntries = [];

    // Fermeture
    overlay.querySelector('#_csv-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Télécharger le modèle
    overlay.querySelector('#_csv-dl-template').addEventListener('click', () => {
        const content = 'nom;email ou telephone;surnom\nSébastien Garcia;s.garcia@mail.com;Seb G.\nLouise Dupont;+33612345678;Loulou\nThomas Martin;t.martin@mail.com;\n';
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'modele-import-staff.csv';
        a.click(); URL.revokeObjectURL(url);
    });

    // Charger un fichier
    overlay.querySelector('#_csv-file').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        overlay.querySelector('#_csv-file-name').textContent = file.name;
        const reader = new FileReader();
        reader.onload = ev => {
            overlay.querySelector('#_csv-input').value = ev.target.result;
        };
        reader.readAsText(file, 'UTF-8');
    });

    // Parser le CSV
    overlay.querySelector('#_csv-parse').addEventListener('click', () => {
        const raw = overlay.querySelector('#_csv-input').value.trim();
        if (!raw) { showToast('Colle du contenu CSV d\'abord', true); return; }

        parsedEntries = [];
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
        const errors = [];

        // Détecter si la première ligne est un header
        const firstLower = lines[0].toLowerCase();
        const startIdx   = (firstLower.includes('nom') || firstLower.includes('name') || firstLower.includes('telephone') || firstLower.includes('email')) ? 1 : 0;

        for (let i = startIdx; i < lines.length; i++) {
            const line = lines[i];
            // Accepter , ou ;
            const sep  = line.includes(';') ? ';' : ',';
            const cols  = line.split(sep).map(c => c.trim());

            const name  = cols[0] || '';
            const col1  = cols[1] || '';
            const col2  = cols[2] || '';

            if (!name) { errors.push('Ligne ' + (i + 1) + ' : nom manquant'); continue; }

            // col1 = téléphone ou email selon le contenu
            // col2 = téléphone/email supplémentaire OU surnom si ce n'est pas un contact
            let phone = '', email = '';
            const isContact = v => v && (v.includes('@') || /^[\d\s\+\-\.]{6,}$/.test(v));
            [col1, col2].forEach(v => {
                if (!v) return;
                if (v.includes('@')) email = v;
                else if (/^[\d\s\+\-\.]{6,}$/.test(v)) phone = v;
            });

            // Si col2 n'est pas un contact, c'est un surnom
            const nickname = (col2 && !isContact(col2)) ? col2 : undefined;

            if (!phone && !email) { errors.push('Ligne ' + (i + 1) + ' (' + name + ') : téléphone ou email requis'); continue; }
            parsedEntries.push({ name, phone: phone || undefined, email: email || undefined, nickname });
        }

        // Afficher l'aperçu
        const preview = overlay.querySelector('#_csv-preview');
        let html = '';

        if (parsedEntries.length) {
            html += '<div style="font-size:12px;font-weight:600;color:#555;margin-bottom:6px">' + parsedEntries.length + ' compte(s) à créer :</div>';
            html += '<div style="max-height:200px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:8px">';
            parsedEntries.forEach((e, i) => {
                html += '<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;' + (i % 2 ? 'background:#f8f8f8' : '') + ';font-size:12px">' +
                    '<span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + e.name + '</span>' +
                    '<span style="color:#888;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (e.phone || '') + '</span>' +
                    '<span style="color:#888;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (e.email || '') + '</span>' +
                    '<span style="color:#534AB7;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic">' + (e.nickname || '') + '</span>' +
                    '</div>';
            });
            html += '</div>';
        }

        if (errors.length) {
            html += '<div style="margin-top:10px;background:#fff5f5;border:1px solid #f5c6c6;border-radius:8px;padding:10px 12px;font-size:11px;color:#c0392b">' +
                '<strong>' + errors.length + ' ligne(s) ignorée(s) :</strong><br>' + errors.join('<br>') + '</div>';
        }

        preview.innerHTML = html;
        overlay.querySelector('#_csv-confirm').style.display = parsedEntries.length ? '' : 'none';
    });

    // Créer les comptes
    overlay.querySelector('#_csv-confirm').addEventListener('click', async () => {
        if (!parsedEntries.length) return;
        const btn = overlay.querySelector('#_csv-confirm');
        btn.disabled = true;
        btn.textContent = 'Création…';

        try {
            const res  = await fetch('/api/users/bulk', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries: parsedEntries }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Afficher le rapport
            const preview = overlay.querySelector('#_csv-preview');
            let html = '';

            if (data.created.length) {
                const nbSent    = data.created.filter(c => c.sent).length;
                const nbManual  = data.created.filter(c => !c.sent).length;
                html += '<div style="background:#f0fdf4;border:1.5px solid #27ae60;border-radius:10px;padding:14px;margin-bottom:10px">' +
                    '<div style="font-weight:700;color:#27ae60;margin-bottom:8px">✅ ' + data.created.length + ' compte(s) créé(s)' +
                    (nbSent   ? ' — ' + nbSent   + ' SMS/email envoyé(s)' : '') +
                    (nbManual ? ' — ' + nbManual + ' lien(s) à envoyer manuellement' : '') + '</div>';

                // Liens manuels si SMS échoué
                const manuals = data.created.filter(c => !c.sent);
                if (manuals.length) {
                    html += '<div style="font-size:11px;font-weight:600;color:#555;margin-bottom:6px">Liens à envoyer manuellement :</div>';
                    manuals.forEach(c => {
                        html += '<div style="margin-bottom:6px;padding:6px 8px;background:white;border-radius:6px;font-size:11px">' +
                            '<strong>' + c.name + '</strong> ' + (c.phone || c.email || '') + '<br>' +
                            '<span style="word-break:break-all;color:#555">' + c.link + '</span>' +
                            '<button onclick="navigator.clipboard.writeText(\'' + c.link + '\');showToast(\'Lien copié !\')" ' +
                            'style="margin-left:6px;background:#f39c12;color:white;border:none;border-radius:5px;padding:2px 8px;font-size:10px;cursor:pointer">Copier</button>' +
                            '</div>';
                    });
                }
                html += '</div>';
            }

            if (data.updated && data.updated.length) {
                const nbSent = data.updated.filter(u => u.sent).length;
                html += '<div style="background:#eff6ff;border:1.5px solid #3b82f6;border-radius:10px;padding:12px;margin-bottom:10px">' +
                    '<div style="font-weight:700;color:#1d4ed8;margin-bottom:8px">✏️ ' + data.updated.length + ' compte(s) mis à jour' +
                    (nbSent ? ' — ' + nbSent + ' invitation(s) renvoyée(s)' : '') + '</div>';
                data.updated.forEach(u => {
                    html += '<div style="font-size:11px;color:#1e3a8a;margin-bottom:4px">' +
                        '<strong>' + u.name + '</strong> — ajouté : ' + (u.added || []).join(', ') + '</div>';
                    if (u.link && !u.sent) {
                        html += '<div style="margin-bottom:6px;padding:6px 8px;background:white;border-radius:6px;font-size:11px">' +
                            '<span style="word-break:break-all;color:#555">' + u.link + '</span>' +
                            '<button onclick="navigator.clipboard.writeText(\'' + u.link + '\');showToast(\'Lien copié !\')" ' +
                            'style="margin-left:6px;background:#f39c12;color:white;border:none;border-radius:5px;padding:2px 8px;font-size:10px;cursor:pointer">Copier</button>' +
                            '</div>';
                    }
                });
                html += '</div>';
            }

            if (data.skipped.length) {
                html += '<div style="background:#fff9e6;border:1px solid #f0c040;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:11px;color:#7d6000">' +
                    '<strong>' + data.skipped.length + ' ignoré(s) :</strong><br>' +
                    data.skipped.map(s => s.name + ' — ' + s.reason).join('<br>') + '</div>';
            }

            if (data.failed.length) {
                html += '<div style="background:#fff5f5;border:1px solid #f5c6c6;border-radius:8px;padding:10px 12px;font-size:11px;color:#c0392b">' +
                    '<strong>' + data.failed.length + ' erreur(s) :</strong><br>' +
                    data.failed.map(f => (f.entry?.name || '?') + ' — ' + f.reason).join('<br>') + '</div>';
            }

            preview.innerHTML = html;
            btn.style.display = 'none';
            overlay.querySelector('#_csv-parse').style.display = 'none';
            await renderAccountsList();
        } catch (e) {
            showToast(e.message, true);
            btn.disabled = false;
            btn.textContent = 'Créer les comptes';
        }
    });
}

// ── Auto-refresh polling (patron/directeur) ───────────────────────────────────

let _lastUpdatedTs  = 0;
let _pollRefreshTimer = null;

async function startAutoRefresh() {
    // Initialiser le timestamp de référence sans déclencher de refresh immédiat
    try {
        const res = await fetch('/api/last-updated', { credentials: 'include' });
        if (res.ok) { const d = await res.json(); _lastUpdatedTs = d.ts || 0; }
    } catch { /* silencieux */ }

    // Poll toutes les 60 secondes
    _pollRefreshTimer = setInterval(async () => {
        try {
            const res = await fetch('/api/last-updated', { credentials: 'include' });
            if (!res.ok) return;
            const { ts } = await res.json();
            if (ts && ts !== _lastUpdatedTs) {
                _lastUpdatedTs = ts;
                await silentRefresh();
            }
        } catch { /* silencieux */ }
    }, 30000);
}

async function silentRefresh() {
    try { await refreshWeek(); } catch { /* silencieux */ }
    try { await loadAllStaff(); } catch { /* silencieux */ }
    try { loadDisposBadge(); } catch { /* silencieux */ }
    try { loadCongesBadge(); } catch { /* silencieux */ }
    try { loadNotifBadge(); } catch { /* silencieux */ }
    // loadDisposKpi() est déjà appelé par refreshWeek() ci-dessus
}

// ── Notifications patron/directeur ────────────────────────────────────────────

let _notifPollTimer = null;

async function loadNotifBadge() {
    try {
        const res  = await fetch('/api/notifications', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const unread = (data.notifications || []).filter(n => !n.read).length;
        const badge  = document.getElementById('notif-badge');
        if (!badge) return;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.toggle('visible', unread > 0);
    } catch { /* silencieux */ }
}

async function openNotifPanel() {
    const modal = document.getElementById('notif-modal');
    const list  = document.getElementById('notif-list');
    if (!modal || !list) return;
    modal.style.display = 'flex';
    list.innerHTML = '<div style="padding:20px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';

    try {
        const res  = await fetch('/api/notifications', { credentials: 'include' });
        const data = await res.json();
        const notifs = data.notifications || [];

        if (notifs.length === 0) {
            list.innerHTML = '<div class="notif-empty">Aucune activité récente</div>';
        } else {
            list.innerHTML = notifs.map(n => {
                const date = new Date(n.created_at);
                const timeAgo = formatTimeAgo(date);
                const msg = n.message || '';
                // Icône selon le contenu du message
                let icon = '📢';
                if (/dispo|disponib/i.test(msg))      icon = '📋';
                else if (/pointage|heure|saisie/i.test(msg)) icon = '⏱';
                else if (/publié|planning/i.test(msg)) icon = '📅';
                else if (/extra|hors planning/i.test(msg)) icon = '➕';
                else if (/connexion|login/i.test(msg)) icon = '🔑';
                return '<div class="notif-item' + (n.read ? '' : ' unread') + '">' +
                    '<div class="notif-icon">' + icon + '</div>' +
                    '<div class="notif-text">' +
                        '<div class="notif-msg">' + escapeHtml(msg) + '</div>' +
                        '<div class="notif-time">' + timeAgo + '</div>' +
                    '</div>' +
                    (!n.read ? '<div class="notif-dot"></div>' : '') +
                '</div>';
            }).join('');
        }

        // Supprimer les notifications lues et vider le badge
        await fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'include' });
        const badge = document.getElementById('notif-badge');
        if (badge) { badge.textContent = '0'; badge.classList.remove('visible'); }

    } catch (e) {
        list.innerHTML = '<div class="notif-empty" style="color:#e74c3c">' + escapeHtml(e.message) + '</div>';
    }
}

function formatTimeAgo(date) {
    const diffMs  = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)  return 'à l\'instant';
    if (diffMin < 60) return 'il y a ' + diffMin + ' min';
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24)   return 'il y a ' + diffH + 'h';
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7)    return 'il y a ' + diffD + 'j';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// listeners modale notifs — attachés dans initNotifListeners()

function initNotifListeners() {
    const closeBtn = document.getElementById('notif-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => {
        document.getElementById('notif-modal').style.display = 'none';
    });

    const markAll = document.getElementById('notif-mark-all-read');
    if (markAll) markAll.addEventListener('click', async () => {
        await fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'include' });
        // Vider le badge
        const badge = document.getElementById('notif-badge');
        if (badge) { badge.textContent = '0'; badge.classList.remove('visible'); }
        // Vider la liste affichée
        const list = document.getElementById('notif-list');
        if (list) list.innerHTML = '<div class="notif-empty">Aucune activité récente</div>';
    });

    // Fermer en cliquant en dehors
    const overlay = document.getElementById('notif-modal');
    if (overlay) overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
}

// ── Exports planning ──────────────────────────────────────────────────────────

function exportWeekCSV() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
    const fmtD = v => {
        const hh = Math.floor(v % 24).toString().padStart(2, '0');
        const mm = Math.round((v % 1) * 60);
        return hh + 'h' + (mm > 0 ? String(mm).padStart(2, '0') : '');
    };
    const estabName = id => {
        const e = allEstablishments.find(e => e.id === id || String(e._id) === id);
        return e ? e.name : '';
    };

    const staffMap = new Map();
    days.forEach(d => {
        const date = toDateStr(d);
        (weekFullData[date] || []).forEach(shift => {
            if (shift.is_joker || shift.staff_id === '__joker__') return;
            if (!staffMap.has(shift.staff_id)) staffMap.set(shift.staff_id, { _id: shift.staff_id, name: shift.staff_name, shifts: {} });
            const entry = staffMap.get(shift.staff_id);
            if (!entry.shifts[date]) entry.shifts[date] = [];
            entry.shifts[date].push(shift);
        });
    });

    const header = ['﻿Staff', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Total heures'];
    const rows = [header.join(';')];

    staffMap.forEach(({ name, shifts }) => {
        let maxPerDay = 1;
        days.forEach(d => {
            const cnt = (shifts[toDateStr(d)] || []).length;
            if (cnt > maxPerDay) maxPerDay = cnt;
        });

        let totalMins = 0;
        days.forEach(d => {
            (shifts[toDateStr(d)] || []).forEach(s => {
                const ds = s.real_start != null ? s.real_start : s.start_time;
                const de = s.real_end   != null ? s.real_end   : s.end_time;
                totalMins += Math.round((de - ds) * 60);
            });
        });
        const totalStr = Math.floor(totalMins / 60) + 'h' + (totalMins % 60 > 0 ? String(totalMins % 60).padStart(2, '0') : '');

        for (let row = 0; row < maxPerDay; row++) {
            const cols = [row === 0 ? name : ''];
            days.forEach(d => {
                const dayShifts = shifts[toDateStr(d)] || [];
                if (row < dayShifts.length) {
                    const s = dayShifts[row];
                    const ds = s.real_start != null ? s.real_start : s.start_time;
                    const de = s.real_end   != null ? s.real_end   : s.end_time;
                    const en = estabName(s.establishment_id);
                    cols.push(fmtD(ds) + ' – ' + fmtD(de) + (en ? ' (' + en + ')' : ''));
                } else {
                    cols.push('');
                }
            });
            cols.push(row === 0 ? totalStr : '');
            rows.push(cols.join(';'));
        }
    });

    const blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'planning-semaine-' + toDateStr(currentWeekStart) + '.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveDashboardPdf() {
    if (!window.jspdf || !window.html2canvas) {
        showToast('Bibliothèque PDF non chargée', true);
        return;
    }

    const days = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(currentWeekStart, i);
        return { date: toDateStr(d), d };
    });
    const fmtD = v => {
        const hh = Math.floor(v % 24).toString().padStart(2, '0');
        const mm = Math.round((v % 1) * 60);
        return hh + 'h' + (mm > 0 ? String(mm).padStart(2, '0') : '');
    };

    const staffMap = new Map();
    days.forEach(({ date }) => {
        (weekFullData[date] || []).forEach(shift => {
            if (!staffMatchesCurrentGroup(shift.staff_id)) return;
            if (!staffMap.has(shift.staff_id))
                staffMap.set(shift.staff_id, { _id: shift.staff_id, name: shift.staff_name, color: shift.color, shifts: {} });
            const entry = staffMap.get(shift.staff_id);
            if (!entry.shifts[date]) entry.shifts[date] = [];
            entry.shifts[date].push(shift);
        });
    });

    // Densité adaptative : plus on a de staff, plus on compacte
    const staffCount = staffMap.size;
    const dense = staffCount > 15;
    const xDense = staffCount > 25;
    const rowPad      = xDense ? '2px 6px' : (dense ? '3px 7px' : '6px 10px');
    const cellPad     = xDense ? '1px 3px' : (dense ? '2px 4px' : '4px 6px');
    const pillPad     = xDense ? '0 4px'   : (dense ? '1px 4px' : '2px 5px');
    const pillFont    = xDense ? '9px'     : (dense ? '9.5px'   : '10px');
    const pillMargin  = xDense ? '1px'     : '2px';
    const rowFont     = xDense ? '10px'    : (dense ? '11px'    : '12px');
    const headPad     = dense  ? '4px 6px' : '6px 8px';

    let thead = '<tr style="background:#f0f0f0"><th style="padding:' + rowPad + ';text-align:left;border:1px solid #ddd">Staff</th>';
    days.forEach(({ d }) => {
        thead += '<th style="padding:' + headPad + ';text-align:center;border:1px solid #ddd;min-width:60px">' +
            DAY_NAMES_SHORT[d.getDay()] + '<br>' + d.getDate() + '</th>';
    });
    thead += '</tr>';

    let tbody = '';
    staffMap.forEach(staff => {
        let row = '<tr><td style="padding:' + rowPad + ';border:1px solid #ddd;white-space:nowrap">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + staff.color + ';margin-right:5px"></span>' +
            escapeHtml(displayName(staff._id, staff.name)) + '</td>';
        days.forEach(({ date }) => {
            const dayShifts = staff.shifts[date];
            if (dayShifts && dayShifts.length) {
                const pills = dayShifts.map(s => {
                    const ds = s.real_start != null ? s.real_start : s.start_time;
                    const de = s.real_end   != null ? s.real_end   : s.end_time;
                    const tc = textColorFor(s.color || '#3498db');
                    return '<div style="background:' + s.color + ';color:' + tc + ';border-radius:4px;padding:' + pillPad + ';font-size:' + pillFont + ';margin-bottom:' + pillMargin + ';line-height:1.25">' +
                        escapeHtml(fmtD(ds)) + '–' + escapeHtml(fmtD(de)) + '</div>';
                }).join('');
                row += '<td style="padding:' + cellPad + ';border:1px solid #ddd">' + pills + '</td>';
            } else {
                row += '<td style="padding:' + cellPad + ';border:1px solid #ddd;color:#bbb;text-align:center">—</td>';
            }
        });
        row += '</tr>';
        tbody += row;
    });

    const from  = currentWeekStart;
    const to    = addDays(currentWeekStart, 6);
    const fmtDay = d => d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
    const weekLabel = 'Semaine du ' + fmtDay(from) + ' au ' + fmtDay(to) + ' ' + to.getFullYear();
    const estab     = allEstablishments.find(e => String(e._id) === String(currentVenueId) || e.id === currentVenueId);
    const venueName = estab ? estab.name : 'Mon établissement';

    // Largeur source : tunée pour A4 portrait (194mm utile)
    //   ≤15 staff (non-dense)  → 840 : ratio source confortable, pas surchargé
    //   16-25 (dense)          → 980 : équilibre entre densité et lisibilité
    //   26+ (xDense)           → 650 : container plus étroit pour matcher le
    //                            ratio portrait (~0.69) avec une grande hauteur
    //                            source — réduit l'espace blanc en bas de page
    //                            (~40 % de waste → ~10 % à 26 staff)
    const containerWidth = xDense ? 650 : (dense ? 980 : 840);
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + containerWidth + 'px;background:#fff;padding:20px 24px;font-family:Arial,sans-serif;font-size:' + rowFont + ';color:#1a1a2e';
    container.innerHTML =
        '<header style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:2px solid #1a1a2e;margin-bottom:14px">' +
            '<div style="display:flex;align-items:center;gap:11px">' +
                '<div style="width:32px;height:32px;border-radius:8px;background:#6C63FF;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px">T</div>' +
                '<div><div style="font-size:13px;font-weight:700">Templyo</div>' +
                '<div style="font-size:9.5px;color:#8892a4;text-transform:uppercase;letter-spacing:1.2px;font-weight:600">Planning bar &amp; resto</div></div>' +
            '</div>' +
            '<div style="text-align:center;flex:1;padding:0 20px">' +
                '<div style="font-size:19px;font-weight:700;letter-spacing:-.5px">' + escapeHtml(venueName) + '</div>' +
                '<div style="font-size:11.5px;color:#4a4f63;font-weight:500;margin-top:2px">' + weekLabel + ' · Tableau de bord</div>' +
            '</div>' +
            '<div><span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #6C63FF;border-radius:14px;color:#6C63FF;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">Semaine</span></div>' +
        '</header>' +
        '<table style="width:100%;border-collapse:collapse;table-layout:fixed">' +
        '<thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
    document.body.appendChild(container);

    try {
        const canvas = await window.html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 8;
        const availW = pageW - margin * 2;
        const availH = pageH - margin * 2;

        // Toujours une seule page : on prend le plus petit ratio pour faire tenir
        const ratio = Math.min(availW / canvas.width, availH / canvas.height);
        const drawW = canvas.width * ratio;
        const drawH = canvas.height * ratio;
        const x = (pageW - drawW) / 2;
        const y = margin;
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, drawW, drawH);
        doc.save('planning-' + toDateStr(currentWeekStart) + '.pdf');
    } catch (err) {
        console.error(err);
        showToast('Erreur lors de la génération du PDF', true);
    } finally {
        document.body.removeChild(container);
    }
}

function generatePrintGantt() {
    const wrap    = document.getElementById('week-gantt');
    const stackEl = wrap ? wrap.querySelector('.gantt-stack') : null;
    if (!stackEl) { showToast('Affiche d\'abord l\'onglet Gantt', true); return; }

    const tickPct   = wrap.style.getPropertyValue('--gantt-tick-pct') || '6.25%';
    const axisEl    = wrap.querySelector('.gantt-axis');
    const legendEl  = wrap.querySelector('.gantt-legend-bar');
    const estab     = allEstablishments.find(e => String(e._id) === String(currentVenueId) || e.id === currentVenueId);
    const venueName = estab ? estab.name : 'Mon établissement';
    const from      = currentWeekStart;
    const to        = addDays(currentWeekStart, 6);
    const fmtD      = d => d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
    const weekLabel = 'Semaine du ' + fmtD(from) + ' au ' + fmtD(to) + ' ' + to.getFullYear();
    const today     = new Date();
    const todayStr  = today.getDate() + ' ' + MONTH_NAMES[today.getMonth()] + ' ' + today.getFullYear();

    const css =
        '@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap\');' +
        ':root{--gantt-tick-pct:' + tickPct + '}' +
        '*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
        'html,body{font-family:\'Inter\',system-ui,sans-serif;color:#1a1a2e;background:#d9dde6;-webkit-font-smoothing:antialiased}' +
        'body{display:flex;justify-content:center;padding:28px 0;min-height:100vh}' +
        '.page{width:1123px;background:#fff;box-shadow:0 18px 50px rgba(15,15,26,.18);padding:24px 36px 18px;display:flex;flex-direction:column}' +
        // En-tête
        '.head{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:2px solid #1a1a2e;margin-bottom:10px}' +
        '.brand{display:flex;align-items:center;gap:11px}' +
        '.brand-mark{width:32px;height:32px;border-radius:8px;background:#6C63FF;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:15px;box-shadow:0 4px 10px rgba(108,99,255,.32)}' +
        '.brand-name{font-size:13px;font-weight:700}' +
        '.brand-tag{font-size:9.5px;color:#8892a4;text-transform:uppercase;letter-spacing:1.2px;font-weight:600}' +
        '.head-center{text-align:center;flex:1;padding:0 20px}' +
        '.venue-name{font-size:19px;font-weight:700;letter-spacing:-.5px}' +
        '.week-lbl{font-size:11.5px;color:#4a4f63;font-weight:500;margin-top:2px}' +
        '.view-tag{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid #6C63FF;border-radius:14px;color:#6C63FF;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase}' +
        '.view-tag::before{content:\'\';width:6px;height:6px;border-radius:50%;background:#6C63FF}' +
        // Axe
        '.gantt-axis{display:grid;grid-template-columns:76px 1fr;margin-bottom:4px}' +
        '.gantt-axis-empty{border-right:1px solid #e6e8ee}' +
        '.gantt-axis-track{position:relative;height:22px;padding:0 0 0 14px;border-bottom:1px solid #e6e8ee}' +
        '.gantt-tick{position:absolute;top:0;bottom:0;border-left:1px solid #f0f2f6;padding-left:4px;font-size:9px;font-weight:600;color:#8892a4;display:flex;align-items:center;white-space:nowrap;line-height:1}' +
        '.gantt-tick.major{border-left-color:#e6e8ee;color:#4a4f63;font-weight:700}' +
        '.gantt-tick.midnight{color:#6C63FF}' +
        // Stack
        '.gantt-stack{display:flex;flex-direction:column}' +
        '.gantt-day{display:grid;grid-template-columns:76px 1fr;align-items:stretch;min-height:44px}' +
        '.gantt-day+.gantt-day{border-top:1px solid #f0f2f6}' +
        '.gantt-day.weekend .gantt-day-name,.gantt-day.weekend .gantt-day-num{color:#6C63FF}' +
        '.gantt-day-tag{padding:8px 8px 6px 0;border-right:1px solid #e6e8ee;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px}' +
        '.gantt-day-name{font-size:9.5px;font-weight:700;color:#8892a4;text-transform:uppercase;letter-spacing:.9px}' +
        '.gantt-day-num{font-size:18px;font-weight:700;color:#1a1a2e;line-height:1;letter-spacing:-.5px}' +
        '.gantt-day-meta{font-size:9px;font-weight:500;color:#8892a4;margin-top:3px}' +
        '.gantt-day-rail{position:relative;padding:6px 0 6px 14px;overflow:hidden}' +
        '.gantt-day-rail::before{content:\'\';position:absolute;left:14px;right:6px;top:0;bottom:0;background-image:repeating-linear-gradient(to right,#e6e8ee 0,#e6e8ee 1px,transparent 1px,transparent var(--gantt-tick-pct,6.25%));pointer-events:none}' +
        '.gantt-lane-stack{position:relative;z-index:1;display:flex;flex-direction:column;gap:3px}' +
        '.gantt-lane{height:13px;position:relative}' +
        '.gantt-block{position:absolute;height:13px;border-radius:3px;display:flex;align-items:center;padding:0 6px;font-size:9px;font-weight:600;color:#fff;overflow:hidden;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.12);line-height:1}' +
        '.gantt-block-who{font-weight:700;margin-right:4px}' +
        '.gantt-block-when{opacity:.9;font-weight:500;font-size:8.5px}' +
        '.gantt-block.joker{background:repeating-linear-gradient(45deg,#cdd1da 0 4px,#e3e6ed 4px 8px)!important;color:#4a4f63;border:1px dashed #9ca3af}' +
        '.gantt-empty{font-size:11px;color:#ccc;padding:8px 0}' +
        // Légende
        '.gantt-legend-bar{margin-top:8px;padding-top:8px;border-top:1px solid #e6e8ee;display:flex;align-items:center;gap:18px;flex-wrap:wrap}' +
        '.gantt-legend{display:flex;align-items:center;gap:16px;flex-wrap:wrap}' +
        '.gantt-legend-item{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#1a1a2e}' +
        '.gantt-legend-swatch{width:14px;height:10px;border-radius:2px;flex-shrink:0}' +
        '.gantt-legend-swatch.joker{background:repeating-linear-gradient(45deg,#cdd1da 0 3px,#e3e6ed 3px 6px)!important;border:1px dashed #9ca3af}' +
        '.gantt-legend-meta{font-size:9.5px;color:#8892a4;font-weight:500;margin-left:2px}' +
        // Bas de page
        '.legalbar{margin-top:6px;padding-top:6px;border-top:1px dashed #e8eaee;display:flex;justify-content:space-between;align-items:center;font-size:9px;color:#8892a4;font-weight:500;letter-spacing:.4px}' +
        '.gantt-block-when{display:none}' +
        '.gantt-legend-meta{display:none}' +
        '@media print{body{background:#fff;padding:0}.page{box-shadow:none}@page{size:A4 landscape;margin:0}}';

    const html =
        '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
        '<title>Gantt · ' + venueName + '</title>' +
        '<style>' + css + '</style></head><body>' +
        '<div class="page">' +
        '<header class="head">' +
            '<div class="brand">' +
                '<div class="brand-mark">T</div>' +
                '<div><div class="brand-name">Templyo</div><div class="brand-tag">Planning bar &amp; resto</div></div>' +
            '</div>' +
            '<div class="head-center">' +
                '<div class="venue-name">' + venueName + '</div>' +
                '<div class="week-lbl">' + weekLabel + ' · Vue chronologique</div>' +
            '</div>' +
            '<div><span class="view-tag">Gantt</span></div>' +
        '</header>' +
        (axisEl ? axisEl.outerHTML : '') +
        stackEl.outerHTML +
        (legendEl ? legendEl.outerHTML : '') +
        '<div class="legalbar">' +
            '<div>Document généré par Templyo · templyo.com</div>' +
            '<div>' + venueName + ' · ' + weekLabel + '</div>' +
            '<div>Généré le ' + todayStr + '</div>' +
        '</div>' +
        '</div>' +
        '<script>window.onload=function(){window.print()};<\/script>' +
        '</body></html>';

    const w = window.open('', '_blank');
    if (!w) { showToast('Autorise les popups pour imprimer', true); return; }
    w.document.write(html);
    w.document.close();
}