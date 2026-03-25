// ── Constantes ───────────────────────────────────────────────────────────────

const PX_PER_HOUR = 60;
const START_HOUR  = 10;
const END_HOUR    = 26;
const TOTAL_HOURS = END_HOUR - START_HOUR;

const DAY_NAMES_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAY_NAMES_LONG  = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTH_NAMES     = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

// ── État global ──────────────────────────────────────────────────────────────

let currentUser    = null;  // utilisateur connecté
let allStaff       = [];
let currentVenueId    = null;
let confirmedDispos   = []; // dispos confirmées du jour affiché
let allEstablishments = []; // tous les établissements
let currentShiftsWeek = []; // shifts de la semaine pour les couleurs
let currentShifts  = [];
let displayedStaff = [];

let currentWeekStart = getMondayOf(new Date()); // Date du lundi courant
let selectedDate     = toDateStr(new Date());   // "YYYY-MM-DD" du jour sélectionné
let weekSummary      = {};                       // { "YYYY-MM-DD": nbShifts }
let weekFullData     = {};                       // { "YYYY-MM-DD": [shifts...] }
let currentView      = 'day';                    // 'day' | 'week'
let currentSubView   = 'dashboard';              // 'dashboard' | 'agenda'

let activeEl     = null;
let activeAction = null;
let startX, startLeft, startWidth;

let draggedStaff = null;

// Copie de jour
let copyShiftsBuffer = []; // shifts modifiables avant confirmation

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

function getMondayOf(d) {
    const day = d.getDay(); // 0=dim, 1=lun...
    const diff = (day === 0) ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
}

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
    setupWeekNav();
    initViewTabs();
    await Promise.all([loadEstablishments(), loadAllStaff()]);

    loadDisposBadge();
    loadDispoControl();

    const btnDispos = document.getElementById('btn-dispos');
    if (btnDispos) btnDispos.addEventListener('click', openDisposPanel);

    const disposClose = document.getElementById('dispos-modal-close');
    if (disposClose) disposClose.addEventListener('click', () => {
        document.getElementById('dispos-modal').style.display = 'none';
    });

    const btnAccounts = document.getElementById('btn-manage-accounts');
    if (btnAccounts) btnAccounts.addEventListener('click', openAccountsModal);

    const accountsClose = document.getElementById('accounts-modal-close');
    if (accountsClose) accountsClose.addEventListener('click', () => {
        document.getElementById('accounts-modal').style.display = 'none';
    });
}

async function checkAuth() {
    try {
        const res = await fetch('/auth/me', { credentials: 'include' });
        if (res.status === 401) {
            window.location.href = '/login.html';
            return null;
        }
        const data = await res.json();
        return data.user;
    } catch {
        window.location.href = '/login.html';
        return null;
    }
}

function renderUserBadge(user) {
    const badge = document.getElementById('user-badge');
    if (!badge) return;
    badge.textContent = user.name || user.email;
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
        currentWeekStart = getMondayOf(new Date());
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
    renderWeekGrid();
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
    const promises = Array.from({ length: 7 }, (_, i) => {
        const date = toDateStr(addDays(currentWeekStart, i));
        return fetch(`/api/shifts/${currentVenueId}/${date}`)
            .then(r => r.ok ? r.json() : [])
            .then(shifts => ({ date, shifts }))
            .catch(() => ({ date, shifts: [] }));
    });
    const results = await Promise.all(promises);
    weekFullData = {};
    results.forEach(({ date, shifts }) => { weekFullData[date] = shifts; });
}

// ── Résumé semaine depuis l'API ────────────────────────────────────────────────

async function loadWeekSummary() {
    const from = toDateStr(currentWeekStart);
    const to   = toDateStr(addDays(currentWeekStart, 6));
    try {
        const summaryRes = await fetch('/api/week/' + currentVenueId + '?from=' + from + '&to=' + to, { credentials: 'include' });
        weekSummary = await summaryRes.json();
        // Charger les shifts de chaque jour pour avoir les couleurs dans les cards
        const days = Array.from({ length: 7 }, (_, i) => toDateStr(addDays(currentWeekStart, i)));
        const allShifts = await Promise.all(
            days.map(d => fetch('/api/shifts/' + currentVenueId + '/' + d, { credentials: 'include' }).then(r => r.ok ? r.json() : []))
        );
        currentShiftsWeek = allShifts.flat();
    } catch {
        weekSummary = {};
        currentShiftsWeek = [];
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
    try {
        const [shiftsRes, disposRes] = await Promise.all([
            fetch('/api/shifts/' + currentVenueId + '/' + dateStr, { credentials: 'include' }),
            fetch('/api/dispos/confirmed?from=' + dateStr + '&to=' + dateStr, { credentials: 'include' }),
        ]);
        if (shiftsRes.ok) currentShifts   = await shiftsRes.json();
        if (disposRes.ok) confirmedDispos = await disposRes.json();
    } catch { /* silencieux */ }

    buildDisplayedStaff();
    renderTimelineHeader();
    renderBody();
    renderStats();
    document.getElementById('day-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Charger et afficher le bouton Publier pour la semaine courante
    loadPublishButton(dateStr);
}

async function loadPublishButton(dateStr) {
    const weekStart = toDateStr(getMondayOf(parseDate(dateStr)));
    const btn = document.getElementById('btn-publish-week');
    if (!btn) return;
    try {
        const res  = await fetch('/api/publish/' + weekStart, { credentials: 'include' });
        const data = await res.json();
        updatePublishBtn(btn, data.published, weekStart);
    } catch { }
}

function updatePublishBtn(btn, published, weekStart) {
    if (published) {
        btn.textContent       = '✓ Planning publié';
        btn.style.background  = '#eafaf1';
        btn.style.borderColor = '#2ecc71';
        btn.style.color       = '#27ae60';
    } else {
        btn.textContent       = 'Publier la semaine';
        btn.style.background  = '#f0effe';
        btn.style.borderColor = '#7F77DD';
        btn.style.color       = '#534AB7';
    }
    btn.onclick = async () => {
        const newState = !published;
        await fetch('/api/publish/' + weekStart, {
            credentials: 'include', method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ published: newState }),
        });
        published = newState;
        updatePublishBtn(btn, newState, weekStart);
        showToast(newState ? 'Planning publié — le staff peut voir la semaine' : 'Planning dépublié');
    };
}

document.getElementById('day-detail-close').addEventListener('click', () => {
    document.getElementById('day-detail').style.display = 'none';
    selectedDate = null;
    renderWeekGrid();
});

// ── Staff ─────────────────────────────────────────────────────────────────────

async function loadAllStaff() {
    try {
        const res = await fetch('/api/staff');
        allStaff  = await res.json();
    } catch {
        allStaff = [
            { _id: 'julien', name: 'Julien', color: '#3498db' },
            { _id: 'marc',   name: 'Marc',   color: '#9b59b6' },
            { _id: 'sophie', name: 'Sophie', color: '#e67e22' },
        ];
    }
    renderSidebar();
}

function renderSidebar() {
    const list = document.getElementById('staff-list');
    list.innerHTML = '';

    // Trier : staff affecté à l'établissement courant en premier
    const sorted = [...allStaff].sort((a, b) => {
        const aHas = a.venues && a.venues.includes(currentVenueId) ? 0 : 1;
        const bHas = b.venues && b.venues.includes(currentVenueId) ? 0 : 1;
        return aHas - bHas;
    });

    sorted.forEach(staff => {
        const isPref = staff.venues && staff.venues.includes(currentVenueId);
        const card = document.createElement('div');
        card.className       = 'staff-card' + (isPref ? ' staff-pref' : '');
        card.draggable       = true;
        card.dataset.staffId = staff._id;

        card.innerHTML =
            '<span class="staff-dot" style="background:' + staff.color + '"></span>' +
            (isPref ? '<span class="staff-pref-dot" title="Affecté à cet établissement">★</span>' : '') +
            '<span class="staff-info-name">' + staff.name + '</span>' +
            '<div class="color-controls">' +
                '<input type="color" class="color-picker" value="' + staff.color + '" title="Choisir une couleur">' +
                '<button class="btn-auto-color">Auto</button>' +
            '</div>';

        card.addEventListener('dragstart', e => {
            if (e.target.closest('.color-controls')) { e.preventDefault(); return; }
            onSidebarDragStart(e, staff, card);
        });
        card.addEventListener('dragend', () => onSidebarDragEnd(card));

        const picker = card.querySelector('.color-picker');
        picker.addEventListener('change', async e => { e.stopPropagation(); await updateStaffColor(staff, e.target.value, card); });
        picker.addEventListener('mousedown', e => e.stopPropagation());

        const btnAuto = card.querySelector('.btn-auto-color');
        btnAuto.addEventListener('click', async e => {
            e.stopPropagation();
            const autoColor = generateColor(staff.name);
            picker.value = autoColor;
            await updateStaffColor(staff, autoColor, card);
        });
        btnAuto.addEventListener('mousedown', e => e.stopPropagation());

        list.appendChild(card);
    });
}

// ── Établissements ────────────────────────────────────────────────────────────

async function loadEstablishments() {
    try {
        const res  = await fetch('/api/establishments');
        const list = await res.json();
        allEstablishments = list;
        renderTabs(list);
        if (list.length > 0) {
            currentVenueId = list[0].id;
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
        btn.innerHTML  = `${v.name} <span class="badge">${v.type === 'pub' ? 'Pub' : 'Resto'}</span>`;
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.venue-tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            currentVenueId = v.id;
            await refreshWeek();
            if (selectedDate) await loadDayDetail(selectedDate);
        });
        container.appendChild(btn);
    });
}

// ── Planning (réutilisé de la version précédente) ─────────────────────────────

function buildDisplayedStaff() {
    const seen = new Map();
    currentShifts.forEach(s => {
        if (!seen.has(s.staff_id)) {
            seen.set(s.staff_id, { _id: s.staff_id, name: s.staff_name, color: s.color });
        }
    });
    displayedStaff = Array.from(seen.values());
}

function renderTimelineHeader() {
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
    row.className      = 'staff-row';
    row.dataset.staffId = staff._id;

    const label = document.createElement('div');
    label.className = 'row-label';
    label.innerHTML = `
        <span class="row-label-dot" style="background:${staff.color}"></span>
        <span>${staff.name}</span>
        <button class="row-delete" onclick="removeStaffFromDay('${staff._id}')">×</button>`;

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
        .filter(s => s.staff_id === staff._id)
        .forEach(shift => rail.appendChild(createShiftEl(shift)));

    row.appendChild(label);
    row.appendChild(rail);
    return row;
}

function createShiftEl(shift) {
    const el = document.createElement('div');
    el.className    = 'shift';
    el.dataset.id   = shift._id;

    const bgColor   = shift.color || '#3498db';
    const textColor = textColorFor(bgColor);
    el.style.background = bgColor;
    el.style.color      = textColor;

    const left  = (shift.start_time - START_HOUR) * PX_PER_HOUR;
    const width = (shift.end_time   - shift.start_time) * PX_PER_HOUR;
    el.style.left  = Math.max(0, left)  + 'px';
    el.style.width = Math.max(PX_PER_HOUR, width) + 'px';

    const fmt = h => `${Math.floor(h % 24).toString().padStart(2, '0')}:00`;
    el.innerHTML = `
        <div class="resizer left"></div>
        <span class="shift-name">${shift.staff_name}</span>
        <span class="shift-hours">${fmt(shift.start_time)} – ${fmt(shift.end_time)}</span>
        <button class="shift-delete" onclick="deleteShift(event, '${shift._id}', '${shift.staff_id}')">×</button>
        <div class="resizer right"></div>`;

    return el;
}

// ── Drop zone (listener unique) ────────────────────────────────────────────────

function initDropZone() {
    // On s'attache sur .day-detail (conteneur stable, jamais recréé)
    // plutôt que sur #timeline-body qui est vidé/recréé à chaque renderBody()
    const container = document.getElementById('day-detail');

    container.addEventListener('dragover', e => {
        if (!draggedStaff) return;
        const rail = e.target.closest('.row-rail');
        if (rail) {
            e.preventDefault();
            document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
            rail.classList.add('drag-over');
        } else if (e.target.closest('#timeline-body')) {
            // Drop sur le body vide (message "glisse un membre...")
            e.preventDefault();
        }
    });

    container.addEventListener('dragleave', e => {
        if (!container.contains(e.relatedTarget)) {
            document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
        }
    });

    container.addEventListener('drop', async e => {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.row-rail').forEach(r => r.classList.remove('drag-over'));
        document.getElementById('drop-hint').classList.remove('visible');
        if (!draggedStaff) return;

        // S'assurer qu'un jour est sélectionné
        if (!selectedDate) {
            showToast('Sélectionne un jour dans la semaine d\'abord', true);
            return;
        }

        const rail = e.target.closest('.row-rail');
        let startTime, endTime;

        if (rail) {
            const rect = rail.getBoundingClientRect();
            const snappedH = Math.round((e.clientX - rect.left) / PX_PER_HOUR) + START_HOUR;
            startTime = Math.max(START_HOUR, Math.min(snappedH, END_HOUR - 2));
            endTime   = startTime + 2;
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

async function createShift(staff, startTime, endTime) {
    try {
        const res = await fetch('/api/shifts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                staff_id: staff._id, staff_name: staff.name,
                establishment_id: currentVenueId, date: selectedDate,
                start_time: startTime, end_time: endTime,
                color: staff.color,
            }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Erreur création', true); return; }
        if (data.warnings?.length) showConflictAlert(data.warnings, staff.name);

        currentShifts.push(data);

        if (!displayedStaff.find(s => s._id === staff._id)) {
            displayedStaff.push({ _id: staff._id, name: staff.name, color: staff.color });
            renderBody();
        } else {
            const rail = document.querySelector(`.row-rail[data-staff-id="${staff._id}"]`);
            if (rail) rail.appendChild(createShiftEl(data));
        }

        // Mettre à jour le résumé semaine
        weekSummary[selectedDate] = (weekSummary[selectedDate] || 0) + 1;
        renderWeekGrid();
        renderStats();
        showToast(`${staff.name} ajouté`);
    } catch { showToast('Erreur réseau', true); }
}

// ── Supprimer un shift ────────────────────────────────────────────────────────

async function deleteShift(e, shiftId, staffId) {
    e.stopPropagation();
    try {
        await fetch(`/api/shifts/${shiftId}`, { method: 'DELETE' });
        currentShifts = currentShifts.filter(s => String(s._id) !== String(shiftId));

        if (!currentShifts.find(s => s.staff_id === staffId)) {
            displayedStaff = displayedStaff.filter(s => s._id !== staffId);
            renderBody();
        } else {
            document.querySelector(`.shift[data-id="${shiftId}"]`)?.remove();
        }

        weekSummary[selectedDate] = Math.max(0, (weekSummary[selectedDate] || 1) - 1);
        renderWeekGrid();
        renderStats();
        showToast('Shift supprimé');
    } catch { showToast('Erreur suppression', true); }
}

async function removeStaffFromDay(staffId) {
    const toDelete = currentShifts.filter(s => s.staff_id === staffId);
    for (const s of toDelete) await fetch(`/api/shifts/${s._id}`, { method: 'DELETE' });
    currentShifts  = currentShifts.filter(s => s.staff_id !== staffId);
    displayedStaff = displayedStaff.filter(s => s._id !== staffId);
    weekSummary[selectedDate] = Math.max(0, (weekSummary[selectedDate] || toDelete.length) - toDelete.length);
    renderBody();
    renderWeekGrid();
    renderStats();
    showToast('Retiré du planning');
}

// ── Drag & resize shifts ──────────────────────────────────────────────────────

document.addEventListener('mousedown', e => {
    const shiftEl = e.target.closest('.shift');
    if (!shiftEl || e.target.closest('.shift-delete')) return;

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
    const deltaX = e.clientX - startX;
    const snapX  = Math.round(deltaX / PX_PER_HOUR) * PX_PER_HOUR;
    const maxW   = TOTAL_HOURS * PX_PER_HOUR;

    if (activeAction === 'res-right') {
        const newW = startWidth + snapX;
        if (newW >= PX_PER_HOUR && startLeft + newW <= maxW) activeEl.style.width = newW + 'px';
    } else if (activeAction === 'res-left') {
        const newL = startLeft + snapX, newW = startWidth - snapX;
        if (newW >= PX_PER_HOUR && newL >= 0) { activeEl.style.left = newL + 'px'; activeEl.style.width = newW + 'px'; }
    } else {
        const newL = startLeft + snapX;
        if (newL >= 0 && newL + activeEl.offsetWidth <= maxW) activeEl.style.left = newL + 'px';
    }
    updateShiftText(activeEl);
}

async function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    if (!activeEl) return;

    const id        = activeEl.dataset.id;
    const startTime = START_HOUR + activeEl.offsetLeft / PX_PER_HOUR;
    const endTime   = startTime  + activeEl.offsetWidth / PX_PER_HOUR;

    const res  = await fetch(`/api/shifts/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time: startTime, end_time: endTime }),
    });
    const data = await res.json();
    if (data.warnings?.length) {
        const shift = currentShifts.find(s => String(s._id) === String(id));
        showConflictAlert(data.warnings, shift?.staff_name || '');
        activeEl.classList.add('conflict');
    } else {
        activeEl.classList.remove('conflict');
    }

    const idx = currentShifts.findIndex(s => String(s._id) === String(id));
    if (idx !== -1) { currentShifts[idx].start_time = startTime; currentShifts[idx].end_time = endTime; }

    renderStats();
    activeEl = null; activeAction = null;
}

function updateShiftText(el) {
    const display = el.querySelector('.shift-hours');
    if (!display) return;
    const hStart = START_HOUR + el.offsetLeft / PX_PER_HOUR;
    const hEnd   = hStart + el.offsetWidth / PX_PER_HOUR;
    const fmt = h => `${Math.floor(h % 24).toString().padStart(2, '0')}:00`;
    display.textContent = `${fmt(hStart)} – ${fmt(hEnd)}`;
}

// ── Copie de jour ─────────────────────────────────────────────────────────────

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
        const fmt = h => `${Math.floor(h % 24).toString().padStart(2, '0')}:00`;
        const row = document.createElement('div');
        row.className = 'copy-shift-row';
        row.innerHTML = `
            <span class="copy-shift-dot" style="background:${shift.color}"></span>
            <span class="copy-shift-name">${shift.staff_name}</span>
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
                e.target.value = `${Math.floor(val % 24).toString().padStart(2, '0')}:00`;
            } else {
                showToast('Format invalide (ex: 18:00)', true);
            }
        });
    });

    // Grille des 7 jours de la semaine
    const daysGrid = document.getElementById('copy-days-grid');
    daysGrid.innerHTML = '';
    for (let i = 0; i < 7; i++) {
        const date    = addDays(currentWeekStart, i);
        const dateStr = toDateStr(date);
        const btn = document.createElement('button');
        btn.className    = 'copy-day-btn' + (dateStr === selectedDate ? ' source' : '');
        btn.dataset.date = dateStr;
        btn.innerHTML    = `<div>${DAY_NAMES_SHORT[date.getDay()]}</div><div>${date.getDate()}</div>`;
        if (dateStr !== selectedDate) {
            btn.addEventListener('click', () => btn.classList.toggle('selected'));
        }
        daysGrid.appendChild(btn);
    }

    document.getElementById('copy-modal').style.display = 'flex';
}

function parseTimeInput(str) {
    const match = str.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return null;
    const h = parseInt(match[1]);
    if (h < 0 || h > 26) return null;
    return h;
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

    try {
        const res = await fetch('/api/copy-day', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                establishment_id: currentVenueId,
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
    const staffMap = new Map(); // staff_id → { name, color, shifts: {} }
    days.forEach(({ date }) => {
        (weekFullData[date] || []).forEach(shift => {
            if (!staffMap.has(shift.staff_id)) {
                staffMap.set(shift.staff_id, {
                    _id: shift.staff_id, name: shift.staff_name,
                    color: shift.color, shifts: {}
                });
            }
            staffMap.get(shift.staff_id).shifts[date] = shift;
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
    staffMap.forEach(staff => {
        const tr = document.createElement('tr');
        let totalH = 0;

        let row = `<td class="col-staff"><div class="dash-staff-cell">
            <span class="dash-dot" style="background:${staff.color}"></span>
            ${staff.name}
        </div></td>`;

        days.forEach(({ date }) => {
            const shift = staff.shifts[date];
            if (shift) {
                const h = shift.end_time - shift.start_time;
                totalH += h;
                const fmt = v => `${Math.floor(v % 24).toString().padStart(2,'0')}h`;
                const textColor = textColorFor(shift.color);
                row += `<td><span class="dash-shift-pill"
                    style="background:${shift.color};color:${textColor}"
                    onclick="switchToDayView('${date}')"
                    title="Cliquer pour voir ce jour">
                    ${fmt(shift.start_time)}-${fmt(shift.end_time)}
                </span></td>`;
            } else {
                row += `<td><span class="dash-empty">—</span></td>`;
            }
        });

        row += `<td class="dash-total-cell">${totalH.toFixed(0)}h</td>`;
        tr.innerHTML = row;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    // Stats globales
    const allShifts = Object.values(weekFullData).flat();
    const totalHSemaine = allShifts.reduce((a, s) => a + (s.end_time - s.start_time), 0);
    const joursStaffes  = Object.values(weekFullData).filter(arr => arr.length > 0).length;
    const nbStaff       = staffMap.size;

    const stats = document.createElement('div');
    stats.className = 'dashboard-stats';
    [
        { label: 'Heures semaine', value: totalHSemaine.toFixed(0) + 'h' },
        { label: 'Jours staffés',  value: `${joursStaffes} / 7` },
        { label: 'Staff actif',    value: nbStaff },
        { label: 'Moy./personne',  value: nbStaff ? (totalHSemaine / nbStaff).toFixed(1) + 'h' : '—' },
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
        const shifts = weekFullData[date] || [];
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
            const fmt = v => `${Math.floor(v % 24).toString().padStart(2,'0')}h`;
            shifts.forEach(shift => {
                const textColor = textColorFor(shift.color);
                const pill = document.createElement('span');
                pill.className = 'agenda-pill';
                pill.style.background = shift.color + '22'; // fond léger
                pill.innerHTML = `
                    <span class="agenda-pill-dot" style="background:${shift.color}"></span>
                    <span style="color:${shift.color}">${shift.staff_name}</span>
                    <span style="color:#888;font-weight:400">${fmt(shift.start_time)}-${fmt(shift.end_time)}</span>`;
                pills.appendChild(pill);
            });
        }
        row.appendChild(pills);

        // Total heures du jour
        if (!empty) {
            const totalH = shifts.reduce((a, s) => a + (s.end_time - s.start_time), 0);
            const total = document.createElement('span');
            total.className = 'agenda-total';
            total.textContent = totalH.toFixed(0) + 'h';
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

// ── Switcher vers vue jour sur une date précise ───────────────────────────────

function switchToDayView(date) {
    currentView  = 'day';
    selectedDate = date;

    document.querySelectorAll('.view-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.view === 'day');
    });

    applyViewMode();
}

// ── Modale gestion des comptes ────────────────────────────────────────────────

async function openAccountsModal() {
    await renderAccountsList();
    populateStaffSelect();
    document.getElementById('accounts-modal').style.display = 'flex';
}

async function renderAccountsList() {
    const list = document.getElementById('accounts-list');
    list.innerHTML = '<div style="padding:12px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    try {
        const res   = await fetch('/api/users', { credentials: 'include' });
        const users = await res.json();
        if (!res.ok) throw new Error(users.error);
        if (users.length === 0) {
            list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Aucun compte</div>';
            return;
        }
        list.innerHTML = '';
        users.forEach(user => {
            const row    = document.createElement('div');
            row.className = 'staff-manage-row';
            const sm     = allStaff.find(s => String(s._id) === user.staff_id);
            const color  = sm ? sm.color : '#888';
            const isP    = user.role === 'patron';
            const status = isP ? 'Patron' : (user.active ? 'Actif' : 'Invitation envoyée');
            const badge  = isP ? 'linked' : (user.active ? 'linked' : 'unlinked');
            row.innerHTML =
                '<span class="staff-manage-dot" style="background:' + color + '"></span>' +
                '<div class="staff-manage-info" style="flex:1">' +
                    '<div style="font-size:13px;font-weight:600;color:#333">' + (user.name || '—') + '</div>' +
                    '<div style="font-size:12px;color:#999">' + user.email + '</div>' +
                '</div>' +
                '<span class="staff-login-badge ' + badge + '" style="margin-right:8px">' + status + '</span>' +
                '<button class="staff-manage-save" data-action="reset">Reset mdp</button>' +
                '<button class="staff-manage-delete" data-action="delete">×</button>';
            row.querySelector('[data-action="reset"]').addEventListener('click',  () => patronResetPassword(user._id, user.name || user.email));
            row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteAccount(user._id, user.name || user.email));
            list.appendChild(row);
        });
    } catch (e) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + e.message + '</div>';
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
    const btnInvite = document.getElementById('btn-invite-account');
    if (btnInvite) btnInvite.addEventListener('click', async () => {
        const staffId = document.getElementById('new-account-staff')?.value || '';
        const email   = document.getElementById('new-account-email')?.value.trim();
        const role    = document.getElementById('new-account-role')?.value || 'staff';
        if (!email) { showToast('Email requis', true); return; }
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
                body:        JSON.stringify({ email, staff_id: role === 'staff' ? (staffId || null) : null, name, role }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            await renderAccountsList();
            if (data.manual && data.link) {
                const box = document.createElement('div');
                box.style.cssText = 'background:#fff9e6;border:1.5px solid #f39c12;border-radius:8px;padding:12px;margin:10px 0;font-size:12px';
                box.innerHTML =
                    '<div style="font-weight:600;color:#f39c12;margin-bottom:6px">⚠️ Email non envoyé — copie ce lien :</div>' +
                    '<div style="word-break:break-all;color:#555;cursor:pointer;text-decoration:underline" ' +
                    'onclick="navigator.clipboard.writeText(this.dataset.link);showToast(\'Lien copi\u00e9 !\');" data-link="' + data.link + '">' +
                    data.link + '</div>';
                document.getElementById('accounts-list').after(box);
                showToast('Compte créé — envoie le lien manuellement', true);
            } else {
                showToast('Invitation envoyée à ' + email);
            }
            if (document.getElementById('new-account-email')) document.getElementById('new-account-email').value = '';
            if (document.getElementById('new-account-staff')) document.getElementById('new-account-staff').value = '';
        } catch (e) {
            showToast(e.message, true);
        } finally {
            btn.disabled    = false;
            btn.textContent = 'Inviter';
        }
    });
});

async function patronResetPassword(userId, userName) {
    const pwd = prompt('Nouveau mot de passe pour ' + userName + ' (8 car. min) :');
    if (!pwd) return;
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
}

async function deleteAccount(userId, userName) {
    if (!confirm('Supprimer le compte de ' + userName + ' ?')) return;
    try {
        const res  = await fetch('/api/users/' + userId, { credentials: 'include', method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        await renderAccountsList();
        showToast('Compte de ' + userName + ' supprimé');
    } catch (e) { showToast(e.message, true); }
}

// ── Disponibilités — côté patron ──────────────────────────────────────────────

function getMondayOf(d) {
    const day  = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon  = new Date(d);
    mon.setDate(d.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function toDateStr(d)  { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),j=String(d.getDate()).padStart(2,'0'); return y+'-'+m+'-'+j; }

async function loadDisposBadge() {
    try {
        const res = await fetch('/api/dispos/count', { credentials: 'include' });
        if (!res.ok) return;
        const { count } = await res.json();
        const badge = document.getElementById('dispos-badge');
        if (!badge) return;
        badge.textContent   = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    } catch { }
}

async function openDisposPanel() {
    const modal = document.getElementById('dispos-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    await loadDisposList();
}

async function loadDisposList() {
    const list = document.getElementById('dispos-list');
    list.innerHTML = '<div style="padding:16px;text-align:center;color:#ccc;font-size:13px">Chargement…</div>';
    const nextMonday = getMondayOf(addDays(new Date(), 7));
    const from = toDateStr(nextMonday);
    const to   = toDateStr(addDays(nextMonday, 6));
    try {
        const res    = await fetch('/api/dispos/pending?from=' + from + '&to=' + to, { credentials: 'include' });
        const dispos = await res.json();
        if (!res.ok) throw new Error(dispos.error);
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

        Object.entries(byStaff).forEach(([staffId, { name, dispos: staffDispos }]) => {
            const sm    = allStaff.find(s => String(s._id) === staffId);
            const color = sm ? sm.color : '#888';
            const fmt   = h => String(Math.floor(h % 24)).padStart(2, '0') + 'h';

            const card = document.createElement('div');
            card.style.cssText = 'background:var(--color-bg-secondary,#f8f8f8);border:1px solid var(--color-border-secondary,#eee);border-radius:12px;margin:8px 16px;overflow:hidden';

            // Header carte staff
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--color-border-tertiary,#f0f0f0)';
            header.innerHTML =
                '<span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;display:inline-block"></span>' +
                '<div style="flex:1">' +
                    '<div style="font-size:13px;font-weight:700;color:#333">' + name + '</div>' +
                    '<div style="font-size:11px;color:#aaa">' + staffDispos.length + ' jour' + (staffDispos.length > 1 ? 's' : '') + ' disponible' + (staffDispos.length > 1 ? 's' : '') + '</div>' +
                '</div>' +
                '<button class="btn-confirm-all" style="padding:6px 12px;border-radius:8px;border:1.5px solid #2ecc71;background:#eafaf1;color:#27ae60;font-size:12px;font-weight:600;cursor:pointer">✓ Tout confirmer</button>';
            card.appendChild(header);

            // Grille des 7 jours
            const grid = document.createElement('div');
            grid.style.cssText = 'display:flex;gap:6px;padding:10px 14px;overflow-x:auto';

            weekDays.forEach(date => {
                const dispo = staffDispos.find(d => d.date === date);
                const d     = parseDate(date);
                const pill  = document.createElement('div');
                pill.style.cssText = 'min-width:70px;border-radius:8px;padding:8px 6px;text-align:center;border:1.5px solid;flex-shrink:0;' +
                    (dispo
                        ? 'background:white;border-color:#e0e0e0;cursor:pointer'
                        : 'background:#f5f5f5;border-color:#eee;opacity:0.5');

                const typeColor = dispo
                    ? (dispo.type === 'midi' ? '#534AB7' : '#1a1a2e')
                    : '#ccc';

                pill.innerHTML =
                    '<div style="font-size:10px;color:#aaa;margin-bottom:2px">' + DAY_SHORT[d.getDay()] + ' ' + d.getDate() + '</div>' +
                    (dispo
                        ? '<div style="font-size:12px;font-weight:700;color:' + typeColor + '">' + (dispo.type === 'soir' ? 'Soir' : dispo.type === 'midi' ? 'Midi' : 'Perso') + '</div>' +
                          '<div style="font-size:10px;color:#999;margin-top:1px">' + fmt(dispo.start_time) + '→' + fmt(dispo.end_time) + '</div>'
                        : '<div style="font-size:14px;color:#ddd">—</div>');

                if (dispo) {
                    pill.title = 'Cliquer pour confirmer ou refuser';
                    pill.addEventListener('click', () => openConfirmDispo(dispo, pill, card, staffId));

                    // Hover
                    pill.addEventListener('mouseenter', () => { if (!pill.dataset.confirmed) pill.style.borderColor = '#2ecc71'; });
                    pill.addEventListener('mouseleave', () => { if (!pill.dataset.confirmed) pill.style.borderColor = '#e0e0e0'; });
                }

                grid.appendChild(pill);
            });

            card.appendChild(grid);

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
    buildEstablishmentSelect();

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
    document.getElementById('confirm-dispo-cancel').onclick = () => { modal.style.display = 'none'; };
}

function openConfirmDispo(dispo, pill, card, staffId) {
    const modal = document.getElementById('confirm-dispo-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    buildEstablishmentSelect();

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
        if (!confirm('Refuser cette dispo ?')) return;
        modal.style.display = 'none';
        await fetch('/api/dispos/' + dispo._id + '/reject', { credentials: 'include', method: 'PATCH' });
        pill.style.background    = '#fff5f5';
        pill.style.borderColor   = '#e74c3c';
        pill.style.pointerEvents = 'none';
        pill.style.opacity       = '0.5';
        loadDisposBadge();
    };
}

function buildEstablishmentSelect() {
    const select = document.getElementById('confirm-dispo-establishment');
    select.innerHTML = '';
    [
        { id: 'Josy_pub',          name: 'Josy (Pub)' },
        { id: 'Poni_restaurant',   name: 'Poni' },
        { id: 'FanFan_restaurant', name: 'FanFan' },
        { id: 'Caval_restaurant',  name: 'Caval' },
    ].forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id; opt.textContent = e.name;
        select.appendChild(opt);
    });
    if (currentVenueId) select.value = currentVenueId;
}

async function loadDispoControl() {
    try {
        const res      = await fetch('/api/dispo-settings', { credentials: 'include' });
        if (!res.ok) return;
        const settings = await res.json();
        const toggle   = document.getElementById('dispo-toggle');
        const label    = document.getElementById('dispo-toggle-label');
        if (!toggle || !label) return;
        toggle.checked    = settings.open;
        label.textContent = settings.open ? 'Dispos ouvertes' : 'Dispos fermées';
        toggle.onchange   = async () => {
            await fetch('/api/dispo-settings', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ open: toggle.checked }),
            });
            label.textContent = toggle.checked ? 'Dispos ouvertes' : 'Dispos fermées';
            showToast(toggle.checked ? 'Saisie des dispos ouverte' : 'Saisie des dispos fermée');
        };
    } catch { }
}

// ── Modale gestion staff ─────────────────────────────────────────────────────

document.getElementById('btn-manage-staff').addEventListener('click', openStaffModal);
document.getElementById('staff-modal-close').addEventListener('click', () => {
    document.getElementById('staff-modal').style.display = 'none';
});

function openStaffModal() {
    renderStaffManageList();
    document.getElementById('staff-modal').style.display = 'flex';
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

        row.innerHTML =
            '<input type="color" class="staff-manage-color" value="' + staff.color + '" title="Changer la couleur">' +
            '<div class="staff-manage-info">' +
                '<input type="text"  class="staff-manage-name-input"  value="' + staff.name + '"  placeholder="Nom">' +
                '<input type="email" class="staff-manage-email-input" value="' + (staff.email || '') + '" placeholder="email (pour le login futur)">' +
                '<div class="venue-pref-row">' + venueButtons + '</div>' +
            '</div>' +
            '<span class="staff-login-badge ' + (hasLogin ? 'linked' : 'unlinked') + '">' +
                (hasLogin ? 'Login lié' : 'Sans login') +
            '</span>' +
            '<button class="staff-manage-save">Enregistrer</button>' +
            '<button class="staff-manage-delete" title="Supprimer">×</button>';

        // Toggle établissements préférentiels
        row.querySelectorAll('.venue-pref-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('active');
            });
        });

        // Enregistrer
        row.querySelector('.staff-manage-save').addEventListener('click', async () => {
            const newName   = row.querySelector('.staff-manage-name-input').value.trim();
            const newEmail  = row.querySelector('.staff-manage-email-input').value.trim();
            const newColor  = row.querySelector('.staff-manage-color').value;
            const newVenues = Array.from(row.querySelectorAll('.venue-pref-btn.active')).map(b => b.dataset.venue);

            if (!newName) { showToast('Le nom ne peut pas être vide', true); return; }

            // Vérif doublon couleur
            const dup = allStaff.find(s => s.color === newColor && s._id !== staff._id);
            if (dup) { showToast(dup.name + ' utilise déjà cette couleur', true); return; }

            try {
                const res = await fetch('/api/staff/' + staff._id, {
                    method:  'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ name: newName, color: newColor, email: newEmail, venues: newVenues }),
                });
                if (!res.ok) throw new Error((await res.json()).error);

                // Mise à jour locale
                staff.name   = newName;
                staff.color  = newColor;
                staff.email  = newEmail;
                staff.venues = newVenues;

                // Propager sur les shifts visibles
                document.querySelectorAll('.shift').forEach(el => {
                    const sd = currentShifts.find(s => String(s._id) === el.dataset.id);
                    if (sd && sd.staff_id === staff._id) {
                        el.style.background = newColor;
                        el.style.color = textColorFor(newColor);
                        el.querySelector('.shift-name').textContent = newName;
                        sd.color = newColor; sd.staff_name = newName;
                    }
                });

                renderSidebar();
                renderStaffManageList();
                showToast(`${newName} mis à jour`);
            } catch (e) { showToast(e.message || 'Erreur', true); }
        });

        // Supprimer
        row.querySelector('.staff-manage-delete').addEventListener('click', async () => {
            if (!confirm(`Supprimer ${staff.name} ? Tous ses shifts seront supprimés.`)) return;
            try {
                const res = await fetch(`/api/staff/${staff._id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error((await res.json()).error);

                allStaff = allStaff.filter(s => s._id !== staff._id);
                currentShifts  = currentShifts.filter(s => s.staff_id !== staff._id);
                displayedStaff = displayedStaff.filter(s => s._id !== staff._id);

                renderSidebar();
                renderStaffManageList();
                renderBody();
                renderStats();
                showToast(`${staff.name} supprimé`);
            } catch (e) { showToast(e.message || 'Erreur suppression', true); }
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

    const dup = allStaff.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (dup) { showToast(`${name} existe déjà`, true); return; }

    const dupColor = allStaff.find(s => s.color === color);
    if (dupColor) { showToast(`${dupColor.name} utilise déjà cette couleur`, true); return; }

    try {
        const res = await fetch('/api/staff', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name, color, email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        allStaff.push(data);
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

const AUTO_COLORS = [
    '#3498db','#9b59b6','#e67e22','#2ecc71','#e74c3c',
    '#1abc9c','#e91e8c','#f39c12','#16a085','#8e44ad',
    '#d35400','#27ae60','#2980b9','#c0392b','#7f8c8d',
];

function generateColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % AUTO_COLORS.length;
    const used = allStaff.map(s => s.color);
    for (let i = 0; i < AUTO_COLORS.length; i++) {
        const c = AUTO_COLORS[(hash + i) % AUTO_COLORS.length];
        if (!used.includes(c)) return c;
    }
    return AUTO_COLORS[hash];
}

async function updateStaffColor(staff, newColor, card) {
    const duplicate = allStaff.find(s => s.color === newColor && s._id !== staff._id);
    if (duplicate) {
        showToast(`${duplicate.name} utilise déjà cette couleur`, true);
        card.querySelector('.color-picker').value = staff.color;
        return;
    }
    staff.color = newColor;
    card.querySelector('.staff-dot').style.background = newColor;
    const newTextColor = textColorFor(newColor);
    document.querySelectorAll('.shift').forEach(el => {
        const sd = currentShifts.find(s => String(s._id) === el.dataset.id);
        if (sd && sd.staff_id === staff._id) {
            el.style.background = newColor; el.style.color = newTextColor; sd.color = newColor;
        }
    });
    document.querySelectorAll('.row-label-dot').forEach(dot => {
        const row = dot.closest('.staff-row');
        if (row?.dataset.staffId === staff._id) dot.style.background = newColor;
    });
    try {
        await fetch(`/api/staff/${staff._id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: newColor }),
        });
        showToast(`Couleur de ${staff.name} mise à jour`);
    } catch { showToast('Erreur sauvegarde couleur', true); }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function renderStats() {
    const bar = document.getElementById('stats-bar');
    bar.innerHTML = '';
    const totalH  = currentShifts.reduce((a, s) => a + (s.end_time - s.start_time), 0);
    const nbStaff = displayedStaff.length;
    [
        { label: 'Staff planifié',    value: nbStaff,                                        sub: 'ce jour' },
        { label: 'Shifts',            value: currentShifts.length,                           sub: 'ce jour' },
        { label: 'Heures cumulées',   value: totalH.toFixed(0),                              sub: 'h au total' },
        { label: 'Moy. par personne', value: nbStaff ? (totalH / nbStaff).toFixed(1) : '—', sub: 'h / employé' },
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
    el.innerHTML = `⚠️ <strong>${staffName}</strong> — ${warnings.map(w => w.message).join('<br>')}`;
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