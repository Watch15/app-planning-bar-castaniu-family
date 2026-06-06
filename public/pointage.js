// ── Utilitaires ───────────────────────────────────────────────────────────────

function toDateStr(d) {
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function fmtH(h) {
    if (h == null) return '--:--';
    const hh = Math.floor(h % 24);
    const mm = Math.round((h % 1) * 60);
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// Arrondit une heure (float) au quart d'heure le plus proche
function roundQuarter(h) {
    if (h == null) return null;
    return Math.round(h * 4) / 4;
}

// Recale la valeur d'un <input type="time"> sur le quart d'heure le plus proche
function snapInputToQuarter(input) {
    const v = parseTimeInput(input.value);
    if (v == null) return;
    input.value = fmtH(roundQuarter(v));
}

// Nom court affiché : nickname si défini, sinon prénom (1er mot du nom complet)
function staffDisplayName(staff, fallbackFullName) {
    if (staff && staff.nickname) return staff.nickname;
    const n = ((staff && staff.name) || fallbackFullName || '').trim();
    return n.split(/\s+/)[0] || n || '—';
}

// Normalise une chaîne pour recherche : minuscules + suppression des accents
function normalizeStr(str) {
    if (!str) return '';
    return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function parseTimeInput(val, referenceStart) {
    if (!val) return null;
    const [h, m] = val.split(':').map(Number);
    let result = h + m / 60;
    // Si une heure de référence est fournie et que le résultat est inférieur,
    // on est passé minuit → ajouter 24
    if (referenceStart != null && result < referenceStart) result += 24;
    return result;
}

function ecartLabel(planned, real) {
    if (real == null || planned == null) return null;
    const diff = real - planned;
    if (Math.abs(diff) < 0.01) return { text: '= planifié', cls: 'zero' };
    const mins = Math.round(Math.abs(diff) * 60);
    const h    = Math.floor(mins / 60);
    const m    = mins % 60;
    const str  = (h ? h + 'h' : '') + (m ? String(m).padStart(2,'0') + 'min' : '');
    return diff > 0
        ? { text: '+' + str, cls: 'pos' }
        : { text: '−' + str, cls: 'neg' };
}

let toastTimer;
function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast visible' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 2500);
}

async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
}

// ── Auth ──────────────────────────────────────────────────────────────────────

let currentUser  = null;
let allStaff     = [];
let cutoffHour     = 9; // fin de fenêtre de saisie (ex: 9h)
let cutoffOpenHour = 0; // début de fenêtre de saisie (ex: 22h, 0 = minuit)
let currentEstabId = null; // établissement actif (pointage)

// Calcule la date "active" selon l'heure de bascule
function getActiveDate() {
    const now = new Date();
    if (now.getHours() < cutoffHour) {
        // Avant l'heure de bascule → on est encore "hier"
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        return toDateStr(yesterday);
    }
    return toDateStr(now);
}

let today; // sera défini après chargement du cutoff
let manualDate = false; // patron/directeur : date choisie manuellement (rattrapage)

// Met à jour la bannière de soirée (cutoff ou rattrapage manuel)
function refreshSessionBanner() {
    const old = document.querySelector('.session-banner');
    if (old) old.remove();

    const todayReal = toDateStr(new Date());
    if (today === todayReal && !manualDate) return;

    const d = new Date(today + 'T12:00:00');
    const dateStr = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const dateStrCap = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

    const banner = document.createElement('div');
    banner.className = 'session-banner';

    if (manualDate) {
        banner.style.background    = '#E8F1FF';
        banner.style.borderColor   = '#3B82F6';
        banner.style.color         = '#1E3A8A';
        const verb = today < todayReal ? 'Rattrapage' : (today > todayReal ? 'Anticipation' : 'Sélection manuelle');
        banner.innerHTML =
            '<span class="session-banner-icon">📅</span>' +
            '<span>' + verb + ' : soirée du <b>' + dateStrCap + '</b>.</span>';
    } else {
        const cutoffLabel = String(cutoffHour).padStart(2,'0') + 'h';
        banner.innerHTML =
            '<span class="session-banner-icon">🌙</span>' +
            '<span>Soirée du <b>' + dateStrCap + '</b> — les saisies avant ' + cutoffLabel +
            ' restent rattachées à la veille.</span>';
    }
    const container = document.querySelector('.container');
    container.insertBefore(banner, container.firstChild);
}

// Change la date active (utilisé en init et par le sélecteur date patron/directeur)
function setActiveDate(newDateStr, isManual) {
    today      = newDateStr;
    manualDate = !!isManual;

    const d = new Date(today + 'T12:00:00');
    const dateStr = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    document.getElementById('header-date').textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

    refreshSessionBanner();

    const dateInput = document.getElementById('date-select');
    if (dateInput && dateInput.value !== newDateStr) dateInput.value = newDateStr;
    const btnReset = document.getElementById('btn-reset-date');
    if (btnReset) btnReset.style.display = isManual ? '' : 'none';
}

async function checkAuth() {
    try {
        const res  = await fetch('/auth/me', { credentials: 'include' });
        if (!res.ok) { window.location.href = '/login.html'; return null; }
        const data = await res.json();
        if (!['etablissement', 'patron', 'directeur', 'staff'].includes(data.user?.role)) {
            window.location.href = '/login.html'; return null;
        }
        return data.user;
    } catch { window.location.href = '/login.html'; return null; }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
    currentUser = await checkAuth();
    if (!currentUser) return;

    // ── Bouton retour immédiatement après auth (avant tout fetch) ────────────
    const btnBack = document.getElementById('btn-back');
    if (currentUser.role === 'directeur' || currentUser.role === 'patron') {
        btnBack.href        = '/index.html';
        btnBack.textContent = '← Dashboard';
        btnBack.style.display = '';
    } else if (currentUser.role === 'staff') {
        btnBack.href        = '/planning.html';
        btnBack.textContent = '← Planning';
        btnBack.style.display = '';
    }

    // Charger l'heure de bascule
    try {
        const r = await fetch('/api/pointage-settings', { credentials: 'include' });
        if (r.ok) {
            const s = await r.json();
            cutoffHour     = s.cutoff_hour      ?? 9;
            cutoffOpenHour = s.cutoff_open_hour ?? 0;
        }
    } catch { /* défauts */ }
    setActiveDate(getActiveDate(), false);

    // Charger staff pour l'autocomplete (en parallèle avec les établissements)
    const [staffRes, estabRes] = await Promise.all([
        fetch('/api/staff',          { credentials: 'include' }).catch(() => null),
        fetch('/api/establishments', { credentials: 'include' }).catch(() => null),
    ]);
    if (staffRes && staffRes.ok) allStaff = await staffRes.json();

    // ── Établissement actif selon le rôle ───────────────────────────────────
    const estabParam = new URLSearchParams(location.search).get('estab');

    if (currentUser.role === 'etablissement') {
        currentEstabId = currentUser.establishment_id;
    } else if (currentUser.role === 'staff') {
        // Staff responsable de soirée — ?estab= obligatoire
        if (!estabParam) { window.location.href = '/planning.html'; return; }
        currentEstabId = estabParam;
    } else {
        // Directeur ou patron — ?estab optionnel
        if (estabParam) currentEstabId = estabParam;
    }

    // ── Résolution nom d'établissement + sélecteur multi-établissements ─────
    if (estabRes && estabRes.ok) {
        const allEstabs = await estabRes.json();

        let myEstabs = allEstabs;
        if (currentUser.role === 'directeur') {
            const assigned = currentUser.assigned_establishments || [];
            myEstabs = allEstabs.filter(e => assigned.includes(e.id || String(e._id)));
        } else if (currentUser.role === 'staff' || currentUser.role === 'etablissement') {
            myEstabs = allEstabs.filter(e => (e.id || String(e._id)) === currentEstabId);
        }

        if (myEstabs.length === 0 && currentUser.role !== 'patron') {
            // Directeur sans établissement assigné → retour dashboard
            window.location.href = '/index.html'; return;
        }

        // Établissement courant dans le header
        const active = myEstabs.find(e => (e.id || String(e._id)) === currentEstabId) || myEstabs[0];
        if (active) {
            if (!currentEstabId) currentEstabId = active.id || String(active._id);
            document.getElementById('header-title').textContent = 'Pointage — ' + active.name;
        }

        // Sélecteur multi-établissements (directeur/patron sans ?estab fixé)
        if (myEstabs.length > 1 && !estabParam) {
            const sel = document.getElementById('estab-select');
            const bar = document.getElementById('estab-select-bar');
            myEstabs.forEach(e => {
                const opt       = document.createElement('option');
                opt.value       = e.id || String(e._id);
                opt.textContent = e.name;
                if (opt.value === currentEstabId) opt.selected = true;
                sel.appendChild(opt);
            });
            bar.classList.add('visible');
            sel.addEventListener('change', () => {
                const chosen = myEstabs.find(e => (e.id || String(e._id)) === sel.value);
                currentEstabId  = sel.value;
                document.getElementById('header-title').textContent = 'Pointage — ' + (chosen ? chosen.name : sel.value);
                loadShifts();
                loadRevenue();
            });
        }
    }

    // ── Sélecteur de date pour patron/directeur (saisie d'une soirée passée) ──
    if (currentUser.role === 'patron' || currentUser.role === 'directeur') {
        const bar       = document.getElementById('date-select-bar');
        const dateInput = document.getElementById('date-select');
        const btnReset  = document.getElementById('btn-reset-date');
        dateInput.value = today;
        dateInput.max   = toDateStr(new Date()); // pas de futur par défaut
        bar.classList.add('visible');

        dateInput.addEventListener('change', () => {
            if (!dateInput.value) return;
            const auto = getActiveDate();
            setActiveDate(dateInput.value, dateInput.value !== auto);
            loadShifts();
            loadRevenue();
        });
        btnReset.addEventListener('click', () => {
            setActiveDate(getActiveDate(), false);
            loadShifts();
            loadRevenue();
        });
    }

    await loadShifts();
    initExtraForm();
    initRevenueForm();
    await loadRevenue();
}

// ── CA de la soirée ───────────────────────────────────────────────────────────

async function loadRevenue() {
    if (!currentEstabId) return;
    const input = document.getElementById('revenue-input');
    const fb    = document.getElementById('revenue-feedback');
    if (!input) return;
    try {
        const res  = await fetch('/api/revenue/' + encodeURIComponent(currentEstabId) + '/' + today, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.revenue != null) {
            input.value = data.revenue;
            if (fb) { fb.className = 'revenue-feedback ok'; fb.textContent = '✅ CA déjà enregistré'; }
        } else {
            input.value = '';
            if (fb) { fb.className = 'revenue-feedback'; fb.textContent = ''; }
        }
    } catch { /* silencieux */ }
}

function initRevenueForm() {
    const btn   = document.getElementById('btn-save-revenue');
    const input = document.getElementById('revenue-input');
    const fb    = document.getElementById('revenue-feedback');
    if (!btn || !input) return;
    btn.addEventListener('click', async () => {
        const v = parseFloat(input.value);
        if (Number.isNaN(v) || v < 0) {
            fb.className = 'revenue-feedback error'; fb.textContent = 'Montant invalide';
            return;
        }
        btn.disabled = true;
        const oldLabel = btn.textContent;
        btn.textContent = 'Enregistrement…';
        try {
            const body = { date: today, revenue: v };
            if (currentUser.role !== 'etablissement') body.establishment_id = currentEstabId;
            const res = await fetch('/api/revenue', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            fb.className = 'revenue-feedback ok'; fb.textContent = '✅ CA enregistré';
        } catch (e) {
            fb.className = 'revenue-feedback error'; fb.textContent = e.message || 'Erreur';
        } finally {
            btn.disabled = false;
            btn.textContent = oldLabel;
        }
    });
}

// ── Chargement des shifts ─────────────────────────────────────────────────────

async function loadShifts() {
    const list = document.getElementById('shifts-list');
    list.innerHTML = '<div class="empty-msg">Chargement…</div>';
    try {
        const url = '/api/pointage/' + today +
            (currentUser.role !== 'etablissement' ? '?establishment_id=' + currentEstabId : '');
        const res    = await fetch(url, { credentials: 'include' });
        const shifts = await res.json();
        if (!res.ok) throw new Error(shifts.error);

        // Filtrer les Jokers
        const visible = shifts.filter(s => !s.is_joker && s.staff_id !== '__joker__');

        if (visible.length === 0) {
            list.innerHTML = '<div class="empty-msg">Aucun shift planifié aujourd\'hui</div>';
            return;
        }

        list.innerHTML = '';
        visible.forEach(s => list.appendChild(buildShiftCard(s)));

        window._visibleShifts = visible;
        renderTotalFooter(visible);

    } catch (e) {
        list.innerHTML = '<div class="empty-msg" style="color:var(--danger)">' + e.message + '</div>';
    }
}

// PT-03 : total heures réelles/planifiées du soir
function renderTotalFooter(shifts) {
    const prev = document.getElementById('total-footer');
    if (prev) prev.remove();
    if (!shifts || shifts.length === 0) return;

    let plannedTotal = 0, realTotal = 0, realCount = 0;
    shifts.forEach(s => {
        if (s.end_time != null && s.start_time != null) plannedTotal += (s.end_time - s.start_time);
        if (s.real_start != null && s.real_end != null) {
            realTotal += (s.real_end - s.real_start);
            realCount++;
        }
    });

    const fmt = h => {
        const hh = Math.floor(h);
        const mm = Math.round((h - hh) * 60);
        return hh + 'h' + (mm > 0 ? String(mm).padStart(2,'0') : '');
    };

    const footer = document.createElement('div');
    footer.id = 'total-footer';
    footer.className = 'total-footer';
    footer.innerHTML =
        '<div>' +
            '<div class="total-footer-label">Total de la soirée</div>' +
            '<div class="total-footer-sub">' + realCount + ' / ' + shifts.length + ' shift' + (shifts.length > 1 ? 's' : '') + ' pointé' + (realCount > 1 ? 's' : '') + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
            '<div class="total-footer-value">' + fmt(realTotal) + '</div>' +
            '<div class="total-footer-sub">Planifié ' + fmt(plannedTotal) + '</div>' +
        '</div>';

    const list = document.getElementById('shifts-list');
    list.parentNode.insertBefore(footer, list.nextSibling);
}

// ── Construction d'une carte shift ───────────────────────────────────────────

function buildShiftCard(shift) {
    // Patron et directeur peuvent toujours corriger les heures réelles
    const canEdit = currentUser && (currentUser.role === 'patron' || currentUser.role === 'directeur');

    const card = document.createElement('div');
    const isValidated = shift.real_start != null && shift.real_end != null;
    card.className = 'shift-card' + (shift.extra ? ' extra-card' : (isValidated ? ' validated-card' : ''));
    card.dataset.id = String(shift._id);

    // Heures réelles préremplies : valeur saisie si elle existe, sinon les
    // heures planifiées (arrondies au quart d'heure) servent de base par défaut.
    // Les services hors planning n'ont pas d'heures planifiées → champs vides.
    const realStartVal = shift.real_start != null
        ? fmtH(shift.real_start)
        : (shift.extra || shift.start_time == null ? '' : fmtH(roundQuarter(shift.start_time)));
    const realEndVal   = shift.real_end   != null
        ? fmtH(shift.real_end)
        : (shift.extra || shift.end_time == null ? '' : fmtH(roundQuarter(shift.end_time)));
    // Établissement : si les heures sont déjà saisies, la carte sera verrouillée au chargement
    const lockedOnLoad = !canEdit && isValidated;
    const plannedLabel = fmtH(shift.start_time) + ' → ' + fmtH(shift.end_time);

    const ecartDuree = (() => {
        if (shift.real_start == null || shift.real_end == null) return null;
        const realDur    = shift.real_end   - shift.real_start;
        const plannedDur = shift.end_time   - shift.start_time;
        if (realDur <= 0) return null;
        return ecartLabel(plannedDur, realDur);
    })();

    const _shiftSm          = allStaff.find(s => String(s._id) === String(shift.staff_id));
    const _shiftDisplayName = staffDisplayName(_shiftSm, shift.staff_name);

    card.innerHTML =
        '<div class="shift-header">' +
            '<div class="shift-dot" style="background:' + (shift.color || '#888') + '"></div>' +
            '<div class="shift-name">' + _shiftDisplayName + '</div>' +
            (shift.extra
                ? '<span class="extra-badge">Hors planning</span>'
                : '<span class="shift-planned">' + plannedLabel + '</span>') +
            (isValidated ? '<span class="validated-badge">✓ Validé</span>' : '') +
        '</div>' +
        '<div class="shift-body">' +
            '<div class="time-group">' +
                '<div class="time-label">Début réel</div>' +
                '<input type="time" step="900" class="time-input real-start' + (realStartVal ? ' filled' : '') + '" value="' + realStartVal + '">' +
            '</div>' +
            '<div class="time-group">' +
                '<div class="time-label">Fin réelle</div>' +
                '<input type="time" step="900" class="time-input real-end' + (realEndVal ? ' filled' : '') + '" value="' + realEndVal + '">' +
            '</div>' +
            (ecartDuree ? '<span class="ecart-badge ' + ecartDuree.cls + '">' + ecartDuree.text + '</span>' : '<span class="ecart-badge" style="display:none">—</span>') +
            '<button class="btn-save' + (lockedOnLoad ? ' saved' : '') + '"' + (lockedOnLoad ? ' disabled' : '') + '>' + (lockedOnLoad ? '✓ Enregistré' : (canEdit && isValidated ? 'Mettre à jour' : 'Enregistrer')) + '</button>' +
            (isValidated ? '' : '<button class="btn-delete" type="button">Supprimer</button>') +
        '</div>';

    // Mise à jour de l'écart en temps réel
    const startInput = card.querySelector('.real-start');
    const endInput   = card.querySelector('.real-end');
    const ecartEl    = card.querySelector('.ecart-badge');
    const btnSave    = card.querySelector('.btn-save');

    // Établissement : si déjà validé au chargement, verrouiller immédiatement
    if (lockedOnLoad) {
        startInput.disabled = true;
        endInput.disabled   = true;
    }

    // Patron/directeur : toujours éditable, pas de blocage service en cours
    if (!canEdit && !shift.extra) {
        const now      = new Date();
        const nowHour  = now.getHours();
        const nowFloat = nowHour + now.getMinutes() / 60;

        // Fenêtre de saisie soirée : de cutoffOpenHour (soir) jusqu'à cutoffHour (matin).
        // La fenêtre peut chevaucher minuit (ex : 22h → 09h).
        // cutoffOpenHour = 0 → fenêtre commence à minuit (comportement historique).
        const inClosingWindow = (cutoffOpenHour > 0 && nowHour >= cutoffOpenHour) || nowHour < cutoffHour;

        let serviceFinished = true;

        if (!inClosingWindow) {
            const shiftDate    = shift.date;
            const todayStr     = toDateStr(now);
            const yesterday    = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = toDateStr(yesterday);

            if (shiftDate === todayStr) {
                if (shift.end_time > 24) {
                    serviceFinished = false; // passe minuit, encore en cours dans la soirée
                } else {
                    serviceFinished = nowFloat >= shift.end_time;
                }
            } else if (shiftDate === yesterdayStr && shift.end_time > 24) {
                // Shift d'hier passant minuit — terminé (on n'est plus dans la fenêtre)
                serviceFinished = true;
            }
        }
        // inClosingWindow === true → serviceFinished = true → saisie ouverte

        if (!serviceFinished) {
            startInput.disabled = true;
            endInput.disabled   = true;
            btnSave.disabled    = true;
            const endH = Math.floor(shift.end_time % 24);
            const endM = Math.round((shift.end_time % 1) * 60);
            const endLabel = String(endH).padStart(2,'0') + 'h' + (endM > 0 ? String(endM).padStart(2,'0') : '00');
            const msg = document.createElement('div');
            msg.style.cssText = 'width:100%;font-size:12px;color:var(--warning-text);background:var(--warning-bg);border:1px solid var(--warning);border-radius:6px;padding:6px 10px;margin-top:4px';
            msg.textContent = 'Service en cours jusqu\'à ' + endLabel;
            card.querySelector('.shift-body').appendChild(msg);
        }
    }

    function updateEcart() {
        const rs = parseTimeInput(startInput.value);
        const re = parseTimeInput(endInput.value, rs);
        startInput.classList.toggle('filled', !!startInput.value);
        endInput.classList.toggle('filled',   !!endInput.value);
        if (rs != null && re != null && re > rs) {
            const realDur    = re - rs;
            const plannedDur = shift.end_time - shift.start_time;
            const e = ecartLabel(plannedDur, realDur);
            if (e) { ecartEl.textContent = e.text; ecartEl.className = 'ecart-badge ' + e.cls; ecartEl.style.display = ''; }
        } else {
            ecartEl.style.display = 'none';
        }
    }

    startInput.addEventListener('input', updateEcart);
    endInput.addEventListener('input',   updateEcart);
    // Recaler sur le quart d'heure dès que la valeur est confirmée
    startInput.addEventListener('change', () => { snapInputToQuarter(startInput); updateEcart(); });
    endInput.addEventListener('change',   () => { snapInputToQuarter(endInput);   updateEcart(); });
    // Refléter l'écart des heures préremplies (= planifié par défaut)
    updateEcart();

    btnSave.addEventListener('click', async () => {
        const rs = roundQuarter(parseTimeInput(startInput.value));
        const re = roundQuarter(parseTimeInput(endInput.value, rs));
        if (rs == null && re == null) { showToast('Saisis au moins une heure', true); return; }
        btnSave.disabled = true;
        try {
            const res = await fetch('/api/shifts/' + shift._id + '/pointage', {
                credentials: 'include', method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ real_start: rs, real_end: re }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);

            // Passer la carte en état validé
            card.classList.remove('extra-card');
            card.classList.add('validated-card');
            const hdr = card.querySelector('.shift-header');
            if (hdr && !hdr.querySelector('.validated-badge')) {
                const vBadge = document.createElement('span');
                vBadge.className = 'validated-badge';
                vBadge.textContent = '✓ Validé';
                hdr.appendChild(vBadge);
            }

            shift.real_start = rs;
            shift.real_end   = re;

            if (canEdit) {
                // Patron/directeur : feedback visuel puis on reste éditable
                btnSave.textContent = '✓ Mis à jour';
                btnSave.className   = 'btn-save saved';
                setTimeout(() => {
                    btnSave.textContent = 'Mettre à jour';
                    btnSave.className   = 'btn-save';
                    btnSave.disabled    = false;
                }, 1500);
            } else {
                // Établissement/staff : saisie unique verrouillée
                btnSave.textContent = '✓ Enregistré';
                btnSave.className   = 'btn-save saved';
                startInput.disabled = true;
                endInput.disabled   = true;
            }
            if (window._visibleShifts) renderTotalFooter(window._visibleShifts);
            showToast(shift.staff_name + ' — heures enregistrées');
        } catch (e) {
            showToast(e.message, true);
            btnSave.disabled = false;
        }
    });

    // Suppression d'un shift non pointé (2 clics : Supprimer → Confirmer)
    const btnDelete = card.querySelector('.btn-delete');
    if (btnDelete) {
        let confirmTimer = null;
        const resetBtn = () => {
            btnDelete.classList.remove('confirming');
            btnDelete.textContent = 'Supprimer';
            confirmTimer = null;
        };
        btnDelete.addEventListener('click', async () => {
            if (!btnDelete.classList.contains('confirming')) {
                btnDelete.classList.add('confirming');
                btnDelete.textContent = 'Confirmer ?';
                clearTimeout(confirmTimer);
                confirmTimer = setTimeout(resetBtn, 4000);
                return;
            }
            clearTimeout(confirmTimer);
            btnDelete.disabled = true;
            try {
                const res = await fetch('/api/shifts/' + shift._id + '/pointage', {
                    credentials: 'include', method: 'DELETE',
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error);
                card.remove();
                if (window._visibleShifts) {
                    window._visibleShifts = window._visibleShifts.filter(s => String(s._id) !== String(shift._id));
                    renderTotalFooter(window._visibleShifts);
                    if (window._visibleShifts.length === 0) {
                        document.getElementById('shifts-list').innerHTML =
                            '<div class="empty-msg">Aucun shift planifié aujourd\'hui</div>';
                    }
                }
                showToast(shift.staff_name + ' — shift supprimé');
            } catch (e) {
                showToast(e.message, true);
                btnDelete.disabled = false;
                resetBtn();
            }
        });
    }

    return card;
}

// ── Formulaire service extra ──────────────────────────────────────────────────

function initExtraForm() {
    const searchInput = document.getElementById('extra-staff-search');
    const suggestions = document.getElementById('staff-suggestions');
    const hiddenId    = document.getElementById('extra-staff-id');
    const freeName    = document.getElementById('extra-staff-name-free');

    // Autocomplete staff
    function renderSuggestions(val) {
        hiddenId.value = '';
        freeName.style.display = 'none';

        suggestions.innerHTML = '';

        if (allStaff.length === 0) {
            // Aucun staff chargé — proposer saisie libre directement
            freeName.style.display = '';
            suggestions.style.display = 'none';
            return;
        }

        // Sans saisie : afficher en priorité le staff de l'établissement courant
        let pool = allStaff;
        if (!val && currentEstabId) {
            const estabStaff = allStaff.filter(s => s.venues && s.venues.includes(currentEstabId));
            if (estabStaff.length > 0) pool = estabStaff;
        }

        const matches = val
            ? allStaff.filter(s => normalizeStr(s.name).includes(val)).slice(0, 8)
            : pool.slice(0, 8);

        if (matches.length === 0) {
            // Aucun staff trouvé — proposer le nom libre
            freeName.style.display = '';
            freeName.value = searchInput.value;
            suggestions.style.display = 'none';
            return;
        }

        matches.forEach(s => {
            const item = document.createElement('div');
            item.className = 'staff-suggestion-item';
            const shortName = staffDisplayName(s);
            const showFull  = shortName !== s.name;
            item.innerHTML =
                '<span style="width:10px;height:10px;border-radius:50%;background:' + s.color + ';flex-shrink:0;display:inline-block"></span>' +
                '<span>' + shortName + '</span>' +
                (showFull ? '<span style="color:var(--text-muted);font-size:11px;margin-left:auto">' + s.name + '</span>' : '');
            item.addEventListener('click', () => {
                searchInput.value  = shortName;
                hiddenId.value     = String(s._id);
                freeName.style.display = 'none';
                suggestions.style.display = 'none';
            });
            suggestions.appendChild(item);
        });

        // Option nom libre (seulement si l'utilisateur a tapé quelque chose)
        if (val) {
            const libre = document.createElement('div');
            libre.className = 'staff-suggestion-item';
            libre.style.color = 'var(--text-muted)';
            libre.innerHTML = '<span style="font-size:12px">✏️ Saisir "' + searchInput.value + '" comme nom libre</span>';
            libre.addEventListener('click', () => {
                hiddenId.value = '';
                freeName.style.display = '';
                freeName.value = searchInput.value;
                suggestions.style.display = 'none';
            });
            suggestions.appendChild(libre);
        }

        suggestions.style.display = 'block';
    }

    searchInput.addEventListener('focus', () => {
        renderSuggestions(normalizeStr(searchInput.value).trim());
    });

    searchInput.addEventListener('input', () => {
        renderSuggestions(normalizeStr(searchInput.value).trim());
    });

    // Fermer suggestions au clic extérieur
    document.addEventListener('click', e => {
        if (!e.target.closest('#extra-staff-search') && !e.target.closest('#staff-suggestions'))
            suggestions.style.display = 'none';
    });

    // Recaler les heures du service hors planning sur le quart d'heure
    const extraStart = document.getElementById('extra-real-start');
    const extraEnd   = document.getElementById('extra-real-end');
    extraStart.addEventListener('change', () => snapInputToQuarter(extraStart));
    extraEnd.addEventListener('change',   () => snapInputToQuarter(extraEnd));

    // Bouton enregistrer extra
    document.getElementById('btn-add-extra').addEventListener('click', async () => {
        const staffId   = document.getElementById('extra-staff-id').value || null;
        const staffName = freeName.style.display !== 'none'
            ? freeName.value.trim()
            : searchInput.value.trim();
        const realStart = roundQuarter(parseTimeInput(document.getElementById('extra-real-start').value));
        const realEnd   = roundQuarter(parseTimeInput(document.getElementById('extra-real-end').value, realStart));

        if (!staffName)       { showToast('Nom du staff requis', true);          return; }
        // Avertir si le nom a été tapé sans être sélectionné dans la liste
        if (!staffId && freeName.style.display === 'none' && allStaff.some(s => normalizeStr(s.name) === normalizeStr(staffName))) {
            showToast('Sélectionne "' + staffName + '" dans la liste déroulante', true);
            renderSuggestions(normalizeStr(staffName));
            return;
        }
        if (realStart == null) { showToast('Heure de début requise', true);       return; }
        if (realEnd   == null) { showToast('Heure de fin requise', true);         return; }
        if (realEnd <= realStart) { showToast('Fin doit être après le début', true); return; }

        const btn = document.getElementById('btn-add-extra');
        btn.disabled = true;
        try {
            const res = await fetch('/api/shifts/extra', {
                credentials: 'include', method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    staff_id:        staffId,
                    staff_name:      staffName,
                    date:            today,
                    real_start:      realStart,
                    real_end:        realEnd,
                    establishment_id: currentUser.role !== 'etablissement' ? currentEstabId : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Ajouter la carte du nouveau shift
            document.getElementById('shifts-list').appendChild(buildShiftCard(data));
            if (window._visibleShifts) {
                window._visibleShifts.push(data);
                renderTotalFooter(window._visibleShifts);
            }

            // Reset form
            searchInput.value = '';
            freeName.value    = '';
            freeName.style.display = 'none';
            document.getElementById('extra-real-start').value = '';
            document.getElementById('extra-real-end').value   = '';
            document.getElementById('extra-staff-id').value   = '';
            showToast(staffName + ' — service ajouté');
        } catch (e) {
            showToast(e.message, true);
        } finally {
            btn.disabled = false;
        }
    });
}

init();
