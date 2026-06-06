// ── Constantes ────────────────────────────────────────────────────────────────

const DAY_NAMES  = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_NAMES = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];

// ── Utilitaires ───────────────────────────────────────────────────────────────

function textColorFor(hex) {
    if (!hex || hex.length < 7) return '#1a1a2e';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#1a1a2e' : '#ffffff';
}

function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const j = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + j;
}

// Lundi de la semaine — délègue au module partagé/testé (public/lib/week.js, R-01).
function getMondayOf(d) { return Week.weekStart(d); }

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

function fmtHour(h) {
    const hh = Math.floor(h % 24);
    const mm = Math.round((h % 1) * 60);
    return String(hh).padStart(2, '0') + 'h' + (mm > 0 ? String(mm).padStart(2, '0') : '');
}

function fmtDuration(h) {
    const total = h;
    const hrs   = Math.floor(total);
    const mins  = Math.round((total - hrs) * 60);
    return mins > 0 ? hrs + 'h' + String(mins).padStart(2, '0') : hrs + 'h';
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth() {
    // Retry une fois pour éviter les faux-positifs réseau au démarrage PWA
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch('/auth/me', { credentials: 'include' });
            if (res.status === 401) { window.location.href = '/login.html'; return null; }
            if (!res.ok) { if (attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; } break; }
            const data = await res.json();
            // Patron + directeur → index.html, établissement → pointage.html
            if (data.user?.role === 'patron')       { window.location.href = '/index.html';   return null; }
            if (data.user?.role === 'directeur')    { window.location.href = '/index.html';   return null; }
            if (data.user?.role === 'etablissement') { window.location.href = '/pointage.html'; return null; }
            return data.user;
        } catch {
            if (attempt === 0) { await new Promise(r => setTimeout(r, 800)); continue; }
            // Après retry, si réseau vraiment indisponible : rester sur la page sans rediriger
            // (le SW sert la page en cache, on ne veut pas boucler)
            return null;
        }
    }
    window.location.href = '/login.html';
    return null;
}

async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
}

// ── Init ──────────────────────────────────────────────────────────────────────

let allStaff = [];
let allEstablishments = [];
let currentUser = null;
let _statsPeriod = 'week';            // 'week' ou 'month'
let _lastWeekData = null;             // { shifts } pour switch instantané
let _lastMonthData = null;            // { shifts } pour le mois

async function init() {
    const user = await checkAuth();
    if (!user) return;

    // Seul le staff et directeur ont accès à cette page
    if (user.role === 'patron') {
        window.location.href = '/index.html'; return;
    }
    if (user.role === 'etablissement') {
        window.location.href = '/pointage.html'; return;
    }

    currentUser = user;
    document.getElementById('greeting-name').textContent = 'Bonjour ' + ((user.name || '').split(' ')[0]) + ' !';
    const av = document.getElementById('staff-avatar');
    if (av) av.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();

    initTabs();
    initStatsToggle();
    initCalSync();

    // Charger le staff et les établissements
    try {
        const [staffRes, estabRes] = await Promise.all([
            fetch('/api/staff', { credentials: 'include' }),
            fetch('/api/establishments', { credentials: 'include' }),
        ]);
        if (staffRes.ok) allStaff          = await staffRes.json();
        if (estabRes.ok) allEstablishments = await estabRes.json();
    } catch { allStaff = []; allEstablishments = []; }

    // Charger les dispos quand on clique sur l'onglet
    document.querySelector('[data-tab="dispos"]').addEventListener('click', () => {
        loadDisposTab();
    });

    document.querySelector('[data-tab="historique"]').addEventListener('click', () => {
        loadHistoriqueWeek();
    });

    // Vérifier les droits dispos + groupes du staff en parallèle
    try {
        const sRes = await fetch('/api/dispo-settings', { credentials: 'include' });
        if (sRes.ok) {
            const s = await sRes.json();
            if (s.staffCanSubmit === false) {
                const tabDispos  = document.getElementById('tab-dispos');
                const viewDispos = document.getElementById('view-dispos');
                if (tabDispos)  tabDispos.style.display  = 'none';
                if (viewDispos) viewDispos.style.display = 'none';
            }
        }
    } catch { /* silencieux */ }

    // Semaine en cours
    const monday = Week.currentWeekStart(new Date());
    const sunday = addDays(monday, 6);
    const from   = toDateStr(monday);
    const to     = toDateStr(sunday);

    document.getElementById('header-week').textContent =
        'Semaine du ' + monday.getDate() + ' ' + MONTH_NAMES[monday.getMonth()] +
        ' au ' + sunday.getDate() + ' ' + MONTH_NAMES[sunday.getMonth()];

    window._currentPlan = { from, to, user };
    await loadPlanning(from, to, user);
    startStaffAutoRefresh(from, to, user);

    setTimeout(loadStaffNotifs, 500);
    setInterval(loadStaffNotifs, 90000); // re-check toutes les 90s (shifts debounced 60s)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        loadStaffNotifs();
        // P-08 : rafraîchir le bloc « 📢 Créneau disponible » au retour au premier
        // plan — le patron peut avoir ouvert un Joker pendant l'absence
        const cur = window._currentPlan;
        if (cur && cur.from && cur.to && document.getElementById('open-jokers-section')) {
            renderOpenJokers(cur.from, cur.to, 'open-jokers-section');
        }
    });

    // Vérifier si le staff est responsable de soirée ce soir → onglet Pointage
    // Avant l'heure de bascule (ex: 9h) on considère encore la date "d'hier" pour
    // que le responsable puisse pointer le lendemain matin.
    try {
        let cutoffH = 9;
        try {
            const cr = await fetch('/api/pointage-settings', { credentials: 'include' });
            if (cr.ok) { const cs = await cr.json(); cutoffH = cs.cutoff_hour ?? 9; }
        } catch { /* défaut */ }
        const now = new Date();
        const refDate = new Date(now);
        if (now.getHours() < cutoffH) refDate.setDate(now.getDate() - 1);
        const todayStr = toDateStr(refDate);
        const respRes  = await fetch('/api/me/responsable-tonight?date=' + todayStr, { credentials: 'include' });
        if (respRes.ok) {
            const resp = await respRes.json();
            if (resp.isResponsable && resp.establishments && resp.establishments.length > 0) {
                const tabBar = document.querySelector('.tabs-bar');
                // Un onglet par établissement (en général 1, mais directeur peut en avoir plusieurs)
                resp.establishments.forEach(estabId => {
                    const link    = document.createElement('a');
                    link.href      = '/pointage.html?estab=' + encodeURIComponent(estabId);
                    link.className = 'btn-pointage-tab';
                    link.textContent = '⏱ Pointage';
                    tabBar.appendChild(link);
                });
            }
        }
    } catch { /* silencieux */ }

    // ── Onglet « Mon équipe » pour les responsables (semaine en cours) ───
    // Re-fetch à chaque entrée (clic + visibilitychange) pour refléter les
    // modifs patron pendant l'absence de l'utilisateur, et recalcule monday/
    // todayStr à chaque rendu (corrige le badge « Aujourd hui » après minuit).
    try {
        const respMondayInit = Week.currentWeekStart(new Date());
        const initFrom = toDateStr(respMondayInit);
        const initTo   = toDateStr(addDays(respMondayInit, 6));
        const rRes     = await fetch('/api/me/responsable-week?from=' + initFrom + '&to=' + initTo, { credentials: 'include' });
        if (rRes.ok) {
            const initData = await rRes.json();
            if (initData.authorized && initData.days) {
                const viewResp = document.createElement('div');
                viewResp.id            = 'view-resp-dashboard';
                viewResp.style.display = 'none';
                document.getElementById('view-planning').after(viewResp);

                const tabBar  = document.querySelector('.tabs-bar');
                const tabResp = document.createElement('button');
                tabResp.className   = 'tab-btn';
                tabResp.dataset.tab = 'resp-dashboard';
                tabResp.innerHTML   = '<span class="tab-full">👥 Mon équipe</span><span class="tab-short">Équipe</span>';
                const disposTab = tabBar.querySelector('[data-tab="dispos"]');
                tabBar.insertBefore(tabResp, disposTab || null);
                initTabs();

                // Mémoriser ensemble la dernière donnée ET son monday pour éviter
                // qu'un rendu de fallback (avant le re-fetch) utilise un monday
                // décalé de la semaine couverte par lastData (cas semaine N→N+1).
                let lastData     = initData;
                let lastMonday   = respMondayInit;
                let lastRendered = false;

                const refreshResp = async () => {
                    const monday = Week.currentWeekStart(new Date());
                    const from   = toDateStr(monday);
                    const to     = toDateStr(addDays(monday, 6));
                    try {
                        const r = await fetch('/api/me/responsable-week?from=' + from + '&to=' + to, { credentials: 'include' });
                        if (!r.ok) return;
                        const data = await r.json();
                        if (!data.authorized) {
                            tabResp.style.display = 'none';
                            viewResp.innerHTML = '';
                            return;
                        }
                        lastData   = data;
                        lastMonday = monday;
                        renderResponsableDashboard(data.days, viewResp, monday);
                        lastRendered = true;
                    } catch { /* silencieux */ }
                };

                tabResp.addEventListener('click', () => {
                    if (!lastRendered) {
                        renderResponsableDashboard(lastData.days, viewResp, lastMonday);
                        lastRendered = true;
                    }
                    refreshResp();
                });

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState !== 'visible') return;
                    if (!tabResp.classList.contains('active')) return;
                    refreshResp();
                });
            }
        }
    } catch { /* silencieux */ }

    // Vérifier si la semaine suivante est publiée
    const nextMonday = getMondayOf(addDays(new Date(), 7));
    const nextWeekStart = toDateStr(nextMonday);
    try {
        const pubRes  = await fetch('/api/publish/' + nextWeekStart, { credentials: 'include' });
        const pubData = await pubRes.json();
        if (pubData.published) {
            // Créer la vue semaine suivante (avant l'onglet pour que showTab la trouve)
            const viewNext = document.createElement('div');
            viewNext.id            = 'view-next-week';
            viewNext.style.display = 'none';
            document.getElementById('view-dispos').after(viewNext);

            // Ajouter l'onglet et rebinder initTabs
            const tabBar  = document.querySelector('.tabs-bar');
            const tabNext = document.createElement('button');
            tabNext.className   = 'tab-btn';
            tabNext.dataset.tab = 'next-week';
            tabNext.innerHTML = '<span class="tab-full">Semaine prochaine ✨</span><span class="tab-short">Semaine pro</span>';
            const histTab = tabBar.querySelector('[data-tab="historique"]');
            tabBar.insertBefore(tabNext, histTab || null);
            initTabs(); // rebind pour inclure le nouvel onglet

            // Charger le contenu au premier clic
            tabNext.addEventListener('click', async () => {
                if (viewNext.dataset.loaded) return;
                viewNext.innerHTML = '<div style="padding:20px;text-align:center;color:#ccc">Chargement…</div>';
                const nextSunday = addDays(nextMonday, 6);
                const nFrom = toDateStr(nextMonday);
                const nTo   = toDateStr(nextSunday);

                try {
                    const res  = await fetch('/api/my-shifts?from=' + nFrom + '&to=' + nTo, { credentials: 'include' });
                    const data = await res.json();

                    viewNext.innerHTML = '';
                    const tempStats = document.createElement('div');
                    tempStats.className = 'week-stats';
                    const tempJokers = document.createElement('div');
                    tempJokers.id = 'open-jokers-section-next';
                    const tempList  = document.createElement('div');
                    tempList.className  = 'days-list';
                    viewNext.appendChild(tempStats);
                    viewNext.appendChild(tempJokers);
                    viewNext.appendChild(tempList);

                    const myShifts2 = data.shifts.filter(s => !s.is_joker && s.staff_id !== '__joker__');
                    const jokers2   = data.shifts.filter(s =>  s.is_joker || s.staff_id === '__joker__');
                    renderStatsInto(myShifts2, tempStats);
                    renderDaysInto(nFrom, myShifts2, data.colleagues, tempList, jokers2);
                    renderOpenJokers(nFrom, nTo, 'open-jokers-section-next');
                    viewNext.dataset.loaded = '1';
                } catch (e) {
                    viewNext.innerHTML = '<div style="padding:20px;text-align:center;color:#e74c3c">' + e.message + '</div>';
                }
            });
        } else {
            // Semaine pas encore publiée — afficher un message discret
            const msgEl = document.createElement('div');
            msgEl.style.cssText = 'padding:16px 20px;font-size:13px;color:#bbb;text-align:center';
            msgEl.textContent = 'Le planning de la semaine prochaine n’est pas encore disponible.';
            document.getElementById('view-planning').appendChild(msgEl);
        }
    } catch { }
}

// ── Jokers ouverts — affichage staff ─────────────────────────────────────────

async function renderOpenJokers(from, to, containerId) {
    const section = document.getElementById(containerId);
    if (!section) return;
    try {
        const res = await fetch('/api/shifts/joker-ouverts', { credentials: 'include' });
        if (!res.ok) return;
        const jokers = await res.json();
        // Filtrer à la plage de dates de la semaine visible
        const weekJokers = jokers
            .filter(j => j.date >= from && j.date <= to)
            .sort((a, b) => a.date === b.date ? a.start_time - b.start_time : a.date.localeCompare(b.date));
        if (weekJokers.length === 0) { section.innerHTML = ''; return; }

        const itemsHtml = weekJokers.map(j => {
            const d         = new Date(j.date + 'T12:00:00');
            const dayLabel  = DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
            const startFmt  = fmtHour(j.start_time);
            const endFmt    = fmtHour(j.end_time);
            const applied   = !!j.has_applied;
            const estabName = j.establishment_name || j.establishment_id || '';
            const safeEstab = estabName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return '<div class="open-joker-item">' +
                '<div class="open-joker-date">' + dayLabel +
                    '<small>' + startFmt + ' à ' + endFmt +
                        (safeEstab ? ' · <span class="open-joker-estab">' + safeEstab + '</span>' : '') +
                    '</small>' +
                '</div>' +
                '<button class="btn-je-suis-dispo' + (applied ? ' applied' : '') + '" data-id="' + j._id + '"' + (applied ? ' disabled' : '') + '>' +
                    (applied ? '✅ Envoyée' : 'Je suis dispo') +
                '</button>' +
            '</div>';
        }).join('');

        section.innerHTML =
            '<div class="open-joker-card">' +
                '<div class="open-joker-header">📢 Créneaux disponibles · ' + weekJokers.length + '</div>' +
                itemsHtml +
            '</div>';

        section.querySelectorAll('.btn-je-suis-dispo:not([disabled])').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                btn.disabled = true;
                try {
                    const r = await fetch('/api/shifts/' + id + '/joker-candidature', {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                    });
                    const data = await r.json();
                    if (!r.ok) throw new Error(data.error);
                    btn.textContent = '✅ Disponibilité envoyée';
                    btn.classList.add('applied');
                    showSwapToast('✅ Ta disponibilité   a été envoyée !');
                } catch (e) {
                    btn.disabled = false;
                    showSwapToast(e.message || 'Erreur', true);
                }
            });
        });
    } catch { /* silencieux */ }
}

// ── Chargement ────────────────────────────────────────────────────────────────

async function loadPlanning(from, to, user) {
    const list = document.getElementById('days-list');

    try {
        const res = await fetch('/api/my-shifts?from=' + from + '&to=' + to, { credentials: 'include' });

        // Vérifier que la réponse est bien du JSON
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            // Le serveur a renvoyé du HTML → session expirée ou erreur serveur
            if (res.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            throw new Error('Erreur serveur (' + res.status + ')');
        }

        const data = await res.json();

        if (!res.ok) {
            // Cas spécifique : compte non lié à un profil staff
            if (data.error && data.error.includes('profil staff')) {
                list.innerHTML =
                    '<div class="empty-week">' +
                        '<div class="empty-week-icon">⚠️</div>' +
                        '<div class="empty-week-text">Compte non configuré</div>' +
                        '<div class="empty-week-sub">Ton compte n est pas encore lié à un profil staff.<br>Contacte ton responsable.</div>' +
                    '</div>';
                return;
            }
            throw new Error(data.error || 'Erreur inconnue');
        }

        const myShifts = data.shifts.filter(s => !s.is_joker && s.staff_id !== '__joker__');
        const jokers   = data.shifts.filter(s =>  s.is_joker || s.staff_id === '__joker__');
        // await loadMyPendingSwaps(); // F-05 désactivé
        _lastWeekData = { shifts: myShifts };
        if (_statsPeriod === 'week') {
            renderStats(myShifts);
        } else {
            // L'utilisateur a basculé sur Mois — on l'a déjà rendu, rien à faire ici
            loadMonthRecap();
        }
        renderDays(from, myShifts, data.colleagues, jokers);
        renderOpenJokers(from, to, 'open-jokers-section');

    } catch (e) {
        list.innerHTML = '<div class="state-msg error">' + e.message + '</div>';
    }
}

// ── Stats semaine ─────────────────────────────────────────────────────────────

function renderStats(shifts) {
    const el = document.getElementById('week-stats');
    if (el) renderStatsInto(shifts, el);
}

function renderStatsInto(shifts, el) {
    const nbShifts = shifts.length;
    // Utiliser les heures réelles si disponibles, sinon planifiées
    const totalH = shifts.reduce((a, s) => {
        const { start, end } = shiftEffectiveHours(s);
        return a + (end - start);
    }, 0);
    const nbJours = new Set(shifts.map(s => s.date)).size;

    el.style.display = '';
    el.innerHTML =
        statCard(nbJours,             'Jours',  '') +
        statCard(nbShifts,            'Shifts', '') +
        statCard(fmtDuration(totalH), 'Heures', '');

    // Répartition par établissement (si > 1)
    const prev = el.nextElementSibling;
    if (prev && prev.classList && prev.classList.contains('estab-hours-bar')) prev.remove();

    const byEstab = {};
    shifts.forEach(s => {
        const { start, end } = shiftEffectiveHours(s);
        if (!byEstab[s.establishment_id]) byEstab[s.establishment_id] = { total: 0 };
        byEstab[s.establishment_id].total += (end - start);
    });
    const estabIds = Object.keys(byEstab);
    if (estabIds.length > 1) {
        const bar = document.createElement('div');
        bar.className = 'estab-hours-bar';
        estabIds.forEach(id => {
            const { total } = byEstab[id];
            bar.innerHTML +=
                '<div class="estab-hours-chip">' +
                    '<span>' + formatEstablishment(id) + '</span>' +
                    '<span style="font-weight:700;color:var(--text-primary);margin-left:4px">' + fmtDuration(total) + '</span>' +
                '</div>';
        });
        el.after(bar);
    }
}

function statCard(value, label, extra) {
    return '<div class="stat-card"><div>' +
        '<div class="stat-value">' + value + '</div>' +
        '<div class="stat-label">' + label + '</div>' +
        (extra || '') +
    '</div></div>';
}

// ── Toggle Semaine / Mois ─────────────────────────────────────────────────────

function initStatsToggle() {
    const wrap = document.getElementById('stats-toggle');
    if (!wrap) return;
    wrap.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const period = btn.dataset.period;
            if (period === _statsPeriod) return;
            _statsPeriod = period;
            wrap.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.period === period));
            applyStatsPeriod();
        });
    });
}

function applyStatsPeriod() {
    const sub = document.getElementById('greeting-sub');
    if (_statsPeriod === 'week') {
        if (sub) sub.textContent = 'Voici ton planning de la semaine';
        if (_lastWeekData) renderStats(_lastWeekData.shifts);
        return;
    }
    const now = new Date();
    if (sub) sub.textContent = 'Récap de ' + MONTH_NAMES_LONG_HIST[now.getMonth()] + ' ' + now.getFullYear();
    if (_lastMonthData) {
        renderMonthStats(_lastMonthData.shifts);
    } else {
        loadMonthRecap();
    }
}

// ── Récap mensuel ─────────────────────────────────────────────────────────────

async function loadMonthRecap() {
    const el = document.getElementById('week-stats');
    if (!el) return;
    el.innerHTML = '<div class="state-msg" style="grid-column:1/-1">Chargement…</div>';

    const now    = new Date();
    const y      = now.getFullYear();
    const m      = now.getMonth();
    const first  = new Date(y, m, 1);
    const last   = new Date(y, m + 1, 0);

    const monthFrom = toDateStr(first);
    const monthTo   = toDateStr(last);

    try {
        const res = await fetch('/api/my-shifts?from=' + monthFrom + '&to=' + monthTo, { credentials: 'include' });

        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('Erreur serveur (' + res.status + ')');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

        const myShifts = (data.shifts || []).filter(s => !s.is_joker && s.staff_id !== '__joker__');

        _lastMonthData = { shifts: myShifts };
        if (_statsPeriod === 'month') renderMonthStats(myShifts);
    } catch (e) {
        el.innerHTML = '<div class="state-msg error" style="grid-column:1/-1">' + e.message + '</div>';
    }
}

function renderMonthStats(shifts) {
    const el = document.getElementById('week-stats');
    if (!el) return;

    const nbShifts = shifts.length;
    const totalH = shifts.reduce((a, s) => {
        const { start, end } = shiftEffectiveHours(s);
        return a + (end - start);
    }, 0);
    const nbJours = new Set(shifts.map(s => s.date)).size;

    el.style.display = '';
    el.innerHTML =
        statCard(nbJours,             'Jours',  '') +
        statCard(nbShifts,            'Shifts', '') +
        statCard(fmtDuration(totalH), 'Heures', '');

    // Répartition par établissement
    const next = el.nextElementSibling;
    if (next && next.classList && next.classList.contains('estab-hours-bar')) next.remove();

    const byEstab = {};
    shifts.forEach(s => {
        const { start, end } = shiftEffectiveHours(s);
        if (!byEstab[s.establishment_id]) byEstab[s.establishment_id] = { total: 0 };
        byEstab[s.establishment_id].total += (end - start);
    });
    const estabIds = Object.keys(byEstab);
    if (estabIds.length > 1) {
        const bar = document.createElement('div');
        bar.className = 'estab-hours-bar';
        estabIds.forEach(id => {
            const { total } = byEstab[id];
            bar.innerHTML +=
                '<div class="estab-hours-chip">' +
                    '<span>' + formatEstablishment(id) + '</span>' +
                    '<span style="font-weight:700;color:var(--text-primary);margin-left:4px">' + fmtDuration(total) + '</span>' +
                '</div>';
        });
        el.after(bar);
    }
}

// ── Rendu des jours ───────────────────────────────────────────────────────────

function renderDays(from, shifts, colleagues, jokers) {
    const list = document.getElementById('days-list');
    renderDaysInto(from, shifts, colleagues, list, jokers || []);
}

function renderDaysInto(from, shifts, colleagues, list, jokers) {
    jokers = jokers || [];
    const today  = toDateStr(new Date());
    const [fy, fm, fd] = from.split('-').map(Number);
    const monday = new Date(fy, fm - 1, fd, 0, 0, 0, 0);

    if (shifts.length === 0) {
        list.innerHTML =
            '<div class="empty-week">' +
                '<div class="empty-week-icon">📅</div>' +
                '<div class="empty-week-text">Aucun shift cette semaine</div>' +
                '<div class="empty-week-sub">Reviens plus tard ou contacte ton responsable</div>' +
            '</div>';
        return;
    }

    list.innerHTML = '';

    // Séparer jours avec shifts et jours repos
    const restDays = [];

    for (let i = 0; i < 7; i++) {
        const date      = toDateStr(addDays(monday, i));
        const d         = addDays(monday, i);
        const dayShifts = shifts.filter(s => s.date === date);
        const isToday   = date === today;

        if (dayShifts.length === 0) {
            // Accumuler les jours de repos
            restDays.push({ d, isToday });

            // Flush si c'est le dernier jour ou si le prochain a un shift
            const nextDate = toDateStr(addDays(monday, i + 1));
            const nextHasShift = i < 6 && shifts.some(s => s.date === nextDate);
            const isLast = i === 6;

            if ((nextHasShift || isLast) && restDays.length > 0) {
                // Afficher les jours repos accumulés
                if (restDays.length === 1 && restDays[0].isToday) {
                    // Aujourd'hui sans shift — carte pleine avec "Aujourd'hui"
                    const rc = document.createElement('div');
                    rc.className = 'day-card today';
                    rc.innerHTML =
                        '<div class="day-header">' +
                            '<div class="day-date-block">' +
                                '<div class="day-weekday" style="color:#534AB7">' + DAY_NAMES[restDays[0].d.getDay()] + '</div>' +
                                '<div class="day-num" style="color:#534AB7">' + restDays[0].d.getDate() + '</div>' +
                            '</div>' +
                            '<div class="day-divider"></div>' +
                            '<div class="day-header-info">' +
                                '<span class="today-chip">Aujourd hui</span>' +
                                '<div class="day-duration" style="margin-top:2px">Repos</div>' +
                            '</div>' +
                        '</div>';
                    list.appendChild(rc);
                } else {
                    const grid = document.createElement('div');
                    grid.className = 'rest-grid';
                    restDays.forEach(r => {
                        const rc = document.createElement('div');
                        rc.className = 'rest-card' + (r.isToday ? ' today' : '');
                        if (r.isToday) rc.style.cssText = 'background:white;border:2px solid #534AB7;border-radius:10px;opacity:1;padding:10px 8px;text-align:center';
                        rc.innerHTML =
                            '<div class="rest-weekday" style="' + (r.isToday ? 'color:#534AB7' : '') + '">' + DAY_NAMES[r.d.getDay()] + '</div>' +
                            '<div class="rest-num"    style="' + (r.isToday ? 'color:#534AB7' : '') + '">' + r.d.getDate() + '</div>';
                        grid.appendChild(rc);
                    });
                    list.appendChild(grid);
                }
                restDays.length = 0;
            }
            continue;
        }

        // Jour avec shift(s)
        const firstShift = dayShifts[0];
        const sm = allStaff ? allStaff.find(s => String(s._id) === firstShift.staff_id) : null;
        const staffColor = sm ? sm.color : (firstShift.color || '#534AB7');

        // Heures réelles si disponibles ET jour passé
        const isPast      = date < today;
        const hasReal     = firstShift.real_start != null && firstShift.real_end != null;
        const showReal    = isPast && hasReal;
        const dispStart   = showReal ? firstShift.real_start : firstShift.start_time;
        const dispEnd     = showReal ? firstShift.real_end   : firstShift.end_time;
        const durLabel    = showReal
            ? fmtDuration(firstShift.real_end - firstShift.real_start) + ' réel'
            : fmtDuration(firstShift.end_time - firstShift.start_time) + ' de service';
        const realBadge   = showReal
            ? ' <span class="badge badge--success">réel</span>'
            : (isPast && !hasReal ? ' <span class="badge badge--warning">non pointé</span>' : '');

        const card = document.createElement('div');
        card.className = 'day-card has-shift' + (isToday ? ' today' : '');
        if (!isToday) card.style.borderLeftColor = staffColor;

        // F-05 échanges désactivé
        // const pendingSwap = (window._myPendingSwaps || []).find(sw =>
        //     sw.status === 'pending' && (sw.from_shift_id === firstShift._id || sw.to_shift_id === firstShift._id));
        // const isSwapMine  = pendingSwap && pendingSwap.from_staff_id === String(firstShift.staff_id);
        // const canSwap     = !isPast && !pendingSwap && firstShift.staff_id !== '__joker__';
        // const swapBadge   = pendingSwap ? ' <span class="badge badge--warning">⇄ en attente</span>' : '';
        const pendingSwap = null;
        const isSwapMine  = false;
        const canSwap     = false;
        const swapBadge   = '';

        // En-tête
        const header = document.createElement('div');
        header.className = 'day-header';
        if (canSwap) header.style.cursor = 'pointer';
        header.innerHTML =
            '<div class="day-date-block">' +
                '<div class="day-weekday">' + DAY_NAMES[d.getDay()] + '</div>' +
                '<div class="day-num">' + d.getDate() + '</div>' +
            '</div>' +
            '<div class="day-divider"></div>' +
            '<div class="day-header-info">' +
                '<div class="day-establishment">' + formatEstablishment(firstShift.establishment_id) + '</div>' +
                '<div class="day-duration">' + durLabel + swapBadge + '</div>' +
            '</div>' +
            (isToday ? '<span class="today-chip">Aujourd hui</span>' : '') +
            '<span class="shift-hours-badge">' + fmtHour(dispStart) + ' → ' + fmtHour(dispEnd) + realBadge + '</span>';
        if (canSwap) {
            header.addEventListener('click', () => openSwapModal(firstShift));
        } else if (isSwapMine) {
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => cancelMySwap(pendingSwap._id));
        }
        card.appendChild(header);

        // Collègues du 1er shift + shifts supplémentaires
        dayShifts.forEach((shift, idx) => {
            const dayColleagues = (colleagues[date] || []).filter(c => c.establishment_id === shift.establishment_id);
            const dayJokers     = jokers.filter(j => j.date === date && j.establishment_id === shift.establishment_id);
            const allColleagues = [...dayColleagues, ...dayJokers];

            // Si même établissement que le shift principal (idx=0), ne pas ré-afficher les collègues
            const sameEstabAsFirst = idx > 0 && shift.establishment_id === firstShift.establishment_id;

            const colleaguesHtml = (!sameEstabAsFirst && allColleagues.length > 0)
                ? '<div class="colleagues-row"><span class="colleagues-lbl">Collègues</span>' +
                    allColleagues.map(c => {
                        const sm2      = allStaff.find(s => String(s._id) === c.staff_id);
                        const nc       = sm2 && sm2.name_color ? sm2.name_color : '';
                        const dotColor = c.is_joker ? '#95a5a6' : (c.color || '#888');
                        const ns       = nc ? ' style="color:' + nc + '"' : '';
                        const needsBg  = nc && textColorFor(nc) === '#1a1a2e';
                        const pillBg   = needsBg ? ' style="background:' + dotColor + 'BF;cursor:pointer"' : ' style="cursor:pointer"';
                        const _cn      = c.is_joker ? 'Joker' : (sm2 && sm2.nickname ? sm2.nickname : (c.staff_name || '').split(' ')[0]);
                        const fullName = c.is_joker ? 'Joker (créneau ouvert)' : (c.staff_name || _cn);
                        const dataAttr = ' data-pill-name="' + _esc(fullName) +
                                         '" data-pill-start="' + (c.start_time != null ? c.start_time : '') +
                                         '" data-pill-end="' + (c.end_time != null ? c.end_time : '') +
                                         '" data-pill-color="' + dotColor + '"';
                        return '<span class="colleague-pill"' + pillBg + dataAttr + '><span class="colleague-dot" style="background:' + dotColor + '"></span><span' + ns + '>' + _cn + '</span></span>';
                    }).join('') + '</div>'
                : '';

            if (idx === 0) {
                // Collègues du shift principal sous le header
                if (colleaguesHtml) {
                    const block = document.createElement('div');
                    block.className = 'shift-block';
                    block.innerHTML = colleaguesHtml;
                    card.appendChild(block);
                }
            } else {
                // Shift supplémentaire — ligne visuelle dédiée
                const sHasReal    = shift.real_start != null && shift.real_end != null;
                const sShowReal   = isPast && sHasReal;
                const sDispStart  = sShowReal ? shift.real_start : shift.start_time;
                const sDispEnd    = sShowReal ? shift.real_end   : shift.end_time;
                const sDurLabel   = sShowReal
                    ? fmtDuration(shift.real_end - shift.real_start) + ' réel'
                    : fmtDuration(shift.end_time - shift.start_time) + ' de service';
                const sRealBadge  = sShowReal
                    ? ' <span class="badge badge--success">réel</span>'
                    : (isPast && !sHasReal ? ' <span class="badge badge--warning">non pointé</span>' : '');
                const sColor      = shift.color || '#888';

                const row = document.createElement('div');
                row.className = 'extra-shift-row';
                row.innerHTML =
                    '<div class="extra-shift-header">' +
                        '<div class="extra-shift-bar" style="background:' + sColor + '"></div>' +
                        '<div class="extra-shift-info">' +
                            '<div class="extra-shift-name">' + formatEstablishment(shift.establishment_id) + '</div>' +
                            '<div class="extra-shift-duration">' + sDurLabel + '</div>' +
                        '</div>' +
                        '<span class="extra-shift-badge">' + fmtHour(sDispStart) + ' → ' + fmtHour(sDispEnd) + sRealBadge + '</span>' +
                    '</div>' +
                    (colleaguesHtml ? '<div class="extra-shift-colleagues">' + colleaguesHtml + '</div>' : '');
                card.appendChild(row);
            }
        });

        list.appendChild(card);
    }
}

// ── Formatage nom établissement ───────────────────────────────────────────────

function formatEstablishment(id) {
    const estab = allEstablishments.find(e => e.id === id || String(e._id) === String(id));
    return estab ? estab.name : id;
}

// ── Tableau de bord du responsable ────────────────────────────────────────────

// Système de noms cohérent avec le tableau de bord patron (script.js:47) :
// nickname si défini, sinon prénom, avec désambiguïsation par initiale du nom
// quand plusieurs staff partagent le même prénom (« Sébastien G. » vs « Sébastien M. »).
function buildTeamDisplayNames(allShifts) {
    const isJoker = s => s.is_joker || s.staff_id === '__joker__';
    const uniq = new Map();
    allShifts.forEach(s => {
        if (isJoker(s) || !s.staff_id) return;
        if (!uniq.has(String(s.staff_id))) {
            uniq.set(String(s.staff_id), { id: String(s.staff_id), name: s.staff_name || '', nickname: s.nickname || null });
        }
    });

    const map = new Map();
    const withoutNickname = [];
    for (const s of uniq.values()) {
        if (s.nickname) map.set(s.id, s.nickname);
        else            withoutNickname.push(s);
    }

    const byFirstName = new Map();
    for (const s of withoutNickname) {
        const parts = s.name.trim().split(/\s+/);
        const fn    = parts[0] || s.name;
        if (!byFirstName.has(fn)) byFirstName.set(fn, []);
        byFirstName.get(fn).push({ id: s.id, lastName: parts.slice(1).join(' ') });
    }

    for (const [fn, group] of byFirstName) {
        if (group.length === 1 || group.every(g => !g.lastName)) {
            for (const g of group) map.set(g.id, fn);
        } else {
            const lastNames = group.map(g => g.lastName.toUpperCase());
            let len = 1;
            while (len <= Math.max(...lastNames.map(n => n.length))) {
                const prefixes = lastNames.map(n => n.slice(0, len));
                if (new Set(prefixes).size === group.length) break;
                len++;
            }
            for (let i = 0; i < group.length; i++) {
                const prefix = group[i].lastName.slice(0, len);
                map.set(group[i].id,
                    prefix ? fn + ' ' + prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase() + '.' : fn
                );
            }
        }
    }
    return map;
}

function renderResponsableDashboard(days, container, monday) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isJoker = s => s.is_joker || s.staff_id === '__joker__';
    container.innerHTML = '';

    // Map staff_id → nom court désambigué, à partir de tous les shifts de la semaine
    const allShifts = Object.values(days).flat();
    const nameMap   = buildTeamDisplayNames(allShifts);
    const shortName = (id, fallback) => nameMap.get(String(id)) || (fallback || '').trim().split(/\s+/)[0] || fallback || '';

    const todayStr = toDateStr(new Date());
    const myStaffId = (window._currentPlan && window._currentPlan.user && window._currentPlan.user.staff_id) || null;

    const weekDates = Array.from({ length: 7 }, (_, i) => ({
        date: toDateStr(addDays(monday, i)),
        d:    addDays(monday, i),
    })).filter(({ date }) => (days[date] || []).length > 0);

    if (weekDates.length === 0) {
        container.innerHTML = '<div style="padding:32px;text-align:center;color:#aaa;font-size:13px">Aucune soirée cette semaine</div>';
        return;
    }

    const intro = document.createElement('div');
    intro.style.cssText = 'padding:16px 20px 8px;font-size:13px;color:#888;line-height:1.4';
    intro.innerHTML = 'Équipe présente sur tes soirées de travail cette semaine. Tape un coéquipier pour l’appeler.';
    container.appendChild(intro);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:0 12px 24px;display:flex;flex-direction:column;gap:12px';

    weekDates.forEach(({ date, d }) => {
        const dayShifts = days[date].slice().sort((a, b) => {
            if (a.establishment_id !== b.establishment_id)
                return String(a.establishment_id).localeCompare(String(b.establishment_id));
            return a.start_time - b.start_time;
        });
        const isToday = date === todayStr;
        const isPast  = date < todayStr;

        // Séparer équipe vs jokers ouverts (les Jokers fermés sont des placeholders
        // patron au cas où, pas des créneaux à pourvoir — on les masque côté staff)
        const team   = dayShifts.filter(s => !isJoker(s));
        const jokers = dayShifts.filter(s => isJoker(s) && s.joker_open === true);

        const byEstab = new Map();
        team.forEach(s => {
            if (!byEstab.has(s.establishment_id)) byEstab.set(s.establishment_id, []);
            byEstab.get(s.establishment_id).push(s);
        });
        const multiEstab = byEstab.size > 1;
        const headerEstab = (!multiEstab && team.length > 0) ? team[0].establishment_id : (jokers[0] && jokers[0].establishment_id);

        // Pill style pour le nom d'établissement (renforce l'identifiant visuel
        // sans inventer de couleur par estab — convention absente du reste de l'app)
        const estabPill = id => '<span style="display:inline-flex;align-items:center;font-size:11px;font-weight:600;color:#534AB7;background:rgba(108,99,255,0.08);padding:3px 9px;border-radius:8px;border:1px solid rgba(108,99,255,0.18);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis">' + esc(formatEstablishment(id)) + '</span>';

        const card = document.createElement('div');
        card.style.cssText =
            'background:#fff;border-radius:12px;padding:14px 14px 12px;' +
            'box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04);' +
            (isToday ? 'border-left:3px solid var(--accent,#6C63FF);' : 'border-left:3px solid transparent;') +
            (isPast  ? 'opacity:0.62;' : '');

        const dayLabel = DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()];
        let html =
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
                '<div style="font-weight:700;font-size:15px;color:' + (isToday ? 'var(--accent,#6C63FF)' : '#1a1a2e') + ';letter-spacing:-0.2px">' + dayLabel + '</div>' +
                (isToday
                    ? '<span style="font-size:10px;font-weight:700;color:#fff;background:var(--accent,#6C63FF);padding:3px 8px;border-radius:8px;letter-spacing:0.3px">Aujourd hui</span>'
                    : (headerEstab && !multiEstab ? estabPill(headerEstab) : '')) +
            '</div>';

        byEstab.forEach((shiftList, estabId) => {
            if (multiEstab) {
                html += '<div style="margin:10px 0 6px">' + estabPill(estabId) + '</div>';
            }
            // Fusionner les shifts du même staff dans le même bar et la même soirée
            // (ex. coupure 18-22h + 23-3h) → un seul row avec horaires joints
            const byStaff = new Map();
            shiftList.forEach(s => {
                const key = String(s.staff_id);
                if (!byStaff.has(key)) {
                    byStaff.set(key, {
                        staff_id:   s.staff_id,
                        staff_name: s.staff_name,
                        color:      s.color,
                        phone:      s.phone,
                        is_resp:    !!s.pointage_resp,
                        slots:      [],
                    });
                }
                const entry = byStaff.get(key);
                const slotHasReal = s.real_start != null && s.real_end != null;
                entry.slots.push({
                    st: slotHasReal ? s.real_start : s.start_time,
                    en: slotHasReal ? s.real_end   : s.end_time,
                });
                if (s.pointage_resp) entry.is_resp = true;
            });
            // Tri par premier créneau
            const merged = [...byStaff.values()].map(e => {
                e.slots.sort((a, b) => a.st - b.st);
                return e;
            }).sort((a, b) => a.slots[0].st - b.slots[0].st);

            html += '<div style="display:flex;flex-direction:column;gap:5px">';
            merged.forEach(m => {
                const isMe   = myStaffId && String(m.staff_id) === String(myStaffId);
                const phone  = m.phone || '';
                const canCall = !isMe && phone;
                const display = shortName(m.staff_id, m.staff_name);
                const rowAttrs = canCall
                    ? ' data-phone="' + esc(phone) + '" data-name="' + esc(display) + '" role="button" tabindex="0"'
                    : '';
                const cursor   = canCall ? 'cursor:pointer;' : '';
                const bg       = isMe ? 'rgba(108,99,255,0.07)' : '#f4f5f8';
                const hours    = m.slots.map(s => fmtHour(s.st) + ' → ' + fmtHour(s.en)).join(', ');
                html +=
                    '<div class="resp-team-row"' + rowAttrs + ' style="' + cursor +
                        'display:flex;align-items:center;gap:10px;padding:10px;background:' + bg + ';border-radius:8px;min-height:44px">' +
                        '<span style="width:10px;height:10px;border-radius:50%;background:' + (m.color || '#888') + ';flex-shrink:0"></span>' +
                        '<span style="flex:1;font-weight:600;font-size:13px;color:#1a1a2e;display:flex;align-items:center;gap:6px;min-width:0">' +
                            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(display) + '</span>' +
                            (m.is_resp ? '<span title="Responsable de la soirée" style="font-size:12px;flex-shrink:0">👑</span>' : '') +
                        '</span>' +
                        '<span style="font-size:13px;font-weight:600;color:#1a1a2e;font-variant-numeric:tabular-nums;white-space:nowrap">' + hours + '</span>' +
                        (canCall ? '<span style="font-size:11px;color:#8892a4;flex-shrink:0;margin-left:2px">▾</span>' : '') +
                    '</div>';
            });
            html += '</div>';
        });

        if (jokers.length > 0) {
            html += '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #e8eaed">' +
                '<div style="font-size:10px;font-weight:700;color:#8892a4;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">' +
                    '📢 Créneau' + (jokers.length > 1 ? 'x' : '') + ' à pourvoir' +
                '</div>' +
                '<div style="display:flex;flex-direction:column;gap:5px">';
            jokers.forEach(s => {
                const estabName = multiEstab ? ' · ' + esc(formatEstablishment(s.establishment_id)) : '';
                html +=
                    '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(108,99,255,0.05);border:1px dashed rgba(108,99,255,0.35);border-radius:8px">' +
                        '<span style="width:10px;height:10px;border-radius:50%;background:rgba(108,99,255,0.55);flex-shrink:0"></span>' +
                        '<span style="flex:1;font-weight:600;font-size:13px;color:#534AB7">Joker' + estabName + '</span>' +
                        '<span style="font-size:13px;font-weight:600;color:#534AB7;font-variant-numeric:tabular-nums;white-space:nowrap">' + fmtHour(s.start_time) + ' → ' + fmtHour(s.end_time) + '</span>' +
                    '</div>';
            });
            html += '</div></div>';
        }

        card.innerHTML = html;
        wrap.appendChild(card);
    });

    // Tap-to-contact : ouvre une modale d'actions (Appeler / SMS) sur les rows avec phone
    wrap.addEventListener('click', (ev) => {
        const row = ev.target.closest && ev.target.closest('.resp-team-row[data-phone]');
        if (!row) return;
        openContactSheet(row.dataset.name, row.dataset.phone);
    });

    container.appendChild(wrap);
}

function openContactSheet(name, phone) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const existing = document.getElementById('resp-contact-sheet');
    if (existing) existing.remove();

    const sheet = document.createElement('div');
    sheet.id = 'resp-contact-sheet';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0);transition:background 0.18s ease';
    sheet.innerHTML =
        '<div class="resp-contact-panel" style="background:#fff;width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:16px 18px 20px;box-shadow:0 -4px 24px rgba(0,0,0,0.13);transform:translateY(100%);transition:transform 0.22s cubic-bezier(0.32,0.72,0,1)">' +
            '<div style="width:36px;height:4px;background:#d0d0d0;border-radius:2px;margin:0 auto 14px"></div>' +
            '<div style="font-weight:700;font-size:15px;color:#1a1a2e;text-align:center;margin-bottom:2px">' + esc(name) + '</div>' +
            '<div style="font-size:13px;color:#8892a4;text-align:center;margin-bottom:16px;font-variant-numeric:tabular-nums">' + esc(phone) + '</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<a href="tel:' + esc(phone) + '" class="resp-contact-act" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;background:var(--accent,#6C63FF);color:#fff;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;min-height:48px">📞 Appeler</a>' +
                '<a href="sms:' + esc(phone) + '" class="resp-contact-act" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;background:#f4f5f8;color:#1a1a2e;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;min-height:48px">💬 Envoyer un SMS</a>' +
                '<button type="button" class="resp-contact-cancel" style="padding:12px;background:transparent;color:#8892a4;border:none;border-radius:12px;font-weight:600;font-size:13px;min-height:44px;cursor:pointer">Annuler</button>' +
            '</div>' +
        '</div>';

    const panel = sheet.querySelector('.resp-contact-panel');
    const close = () => {
        sheet.style.background = 'rgba(0,0,0,0)';
        panel.style.transform = 'translateY(100%)';
        setTimeout(() => sheet.remove(), 220);
    };
    sheet.addEventListener('click', (ev) => { if (ev.target === sheet) close(); });
    sheet.querySelector('.resp-contact-cancel').addEventListener('click', close);
    sheet.querySelectorAll('.resp-contact-act').forEach(el => el.addEventListener('click', () => setTimeout(close, 100)));
    document.body.appendChild(sheet);
    requestAnimationFrame(() => {
        sheet.style.background = 'rgba(0,0,0,0.45)';
        panel.style.transform   = 'translateY(0)';
    });
}

// ── Navigation onglets ───────────────────────────────────────────────────────

function showTab(tab) {
    // Cacher toutes les vues connues
    const views = ['view-planning', 'view-dispos', 'view-next-week', 'view-historique', 'view-resp-dashboard'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    // Afficher la bonne vue
    const target = document.getElementById('view-' + tab);
    if (target) target.style.display = '';
    // Mettre à jour les onglets
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
}

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn._tabBound) return;
        btn._tabBound = true;
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            showTab(btn.dataset.tab);
        });
    });
}

// ⚠️ Fonctionnalité agenda iCal DÉSACTIVÉE (D-83) — pas encore assez fiable pour la prod.
// Doit rester aligné avec le flag serveur CALENDAR_ENABLED (server.js). Pour réactiver :
// passer ce flag à true ET réactiver côté serveur.
const CALENDAR_ENABLED = false;

// Carte « Ajouter à mon agenda » : récupère l'URL d'abonnement iCal et propose
// les raccourcis Apple (webcal) / Google + copie manuelle pour Outlook/autres.
function initCalSync() {
    const card   = document.getElementById('cal-sync-card');
    const toggle = document.getElementById('cal-sync-toggle');
    const body   = document.getElementById('cal-sync-body');
    if (!card || !toggle || !body) return;
    // Fonctionnalité désactivée → on masque la carte entièrement (D-83).
    if (!CALENDAR_ENABLED) { card.style.display = 'none'; return; }
    // C-01 : sans profil staff lié (ex. directeur), aucun flux agenda perso possible
    // (l'API /api/calendar-url renverrait 400) → on masque la carte au lieu d'afficher une erreur.
    if (!currentUser || !currentUser.staff_id) { card.style.display = 'none'; return; }
    if (toggle._bound) return;
    toggle._bound = true;
    let loaded = false;

    toggle.addEventListener('click', async () => {
        const isOpen = body.style.display !== 'none';
        if (isOpen) { body.style.display = 'none'; toggle.textContent = 'Configurer'; return; }
        body.style.display = '';
        toggle.textContent = 'Masquer';
        if (loaded) return;

        body.innerHTML = '<div class="cal-sync-help">Chargement…</div>';
        try {
            const r = await fetch('/api/calendar-url', { credentials: 'include' });
            if (!r.ok) throw new Error('indisponible');
            const { url, webcal } = await r.json();
            const googleUrl = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(url);

            body.innerHTML =
                '<div class="cal-sync-actions">' +
                    '<a class="cal-sync-btn cal-sync-btn--primary" href="' + webcal + '">🍎 Apple / iPhone</a>' +
                    '<a class="cal-sync-btn" href="' + googleUrl + '" target="_blank" rel="noopener">📆 Google Agenda</a>' +
                '</div>' +
                '<div class="cal-sync-url-row">' +
                    '<input class="cal-sync-url" id="cal-sync-url-input" readonly value="' + url + '">' +
                    '<button type="button" class="cal-sync-btn" id="cal-sync-copy" style="flex:0 0 auto;min-width:0">Copier</button>' +
                '</div>' +
                '<div class="cal-sync-help">' +
                    '<b>Une seule fois :</b> sur iPhone/Mac, touche « Apple » et confirme l\'abonnement. ' +
                    'Sur Android/PC, ouvre « Google Agenda », ou copie l\'URL et colle-la dans ton appli ' +
                    '(Outlook : « Ajouter un agenda » → « S\'abonner à partir du web »). ' +
                    'Ton agenda se mettra ensuite à jour <b>automatiquement</b>.' +
                '</div>';

            const copyBtn = document.getElementById('cal-sync-copy');
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(url);
                } catch {
                    const i = document.getElementById('cal-sync-url-input');
                    i.select(); document.execCommand('copy');
                }
                copyBtn.textContent = 'Copié ✓';
                setTimeout(() => { copyBtn.textContent = 'Copier'; }, 1500);
            });
            loaded = true;
        } catch {
            body.innerHTML = '<div class="cal-sync-help">Impossible de générer le lien pour le moment. Réessaie plus tard.</div>';
        }
    });
}

// ── Historique shifts passés ──────────────────────────────────────────────────

const DAY_NAMES_LONG_HIST = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const MONTH_NAMES_LONG_HIST = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

let _histOffset = 1;   // 1 = semaine -1, 5 = semaine -5 (max)
const _histCache = {};

async function loadHistoriqueWeek() {
    const navEl = document.getElementById('hist-nav');
    const wrap  = document.getElementById('hist-content');
    if (!navEl || !wrap) return;

    const todayMonday = Week.currentWeekStart(new Date());
    const weekMonday  = addDays(todayMonday, -7 * _histOffset);
    const weekSunday  = addDays(weekMonday, 6);
    const weekKey     = toDateStr(weekMonday);

    const fmtD = d => d.getDate() + ' ' + MONTH_NAMES_LONG_HIST[d.getMonth()];

    navEl.innerHTML =
        '<button class="hist-nav-btn" id="hist-btn-prev"' + (_histOffset >= 5 ? ' disabled' : '') + '>← Précédente</button>' +
        '<span class="hist-nav-week">Semaine du ' + fmtD(weekMonday) + '<br>au ' + fmtD(weekSunday) + ' ' + weekSunday.getFullYear() + '</span>' +
        '<button class="hist-nav-btn" id="hist-btn-next"' + (_histOffset <= 1 ? ' disabled' : '') + '>Suivante →</button>';

    document.getElementById('hist-btn-prev').addEventListener('click', () => { _histOffset++; loadHistoriqueWeek(); });
    document.getElementById('hist-btn-next').addEventListener('click', () => { _histOffset--; loadHistoriqueWeek(); });

    if (_histCache[weekKey]) { renderHistoriqueWeek(wrap, _histCache[weekKey].data); return; }

    wrap.innerHTML = '<div class="hist-loading">Chargement…</div>';

    try {
        const r = await fetch('/api/my-shifts?from=' + weekKey + '&to=' + toDateStr(weekSunday), { credentials: 'include' });
        const data = r.ok ? await r.json() : { shifts: [] };

        _histCache[weekKey] = { data };
        renderHistoriqueWeek(wrap, data);
    } catch {
        wrap.innerHTML = '<div class="hist-loading">Erreur de chargement.</div>';
    }
}

// Heures effectives d'un shift (réel si pointage complet, sinon planifié).
// Logique extraite et testée : public/lib/shift-hours.js + tests/shift-hours.test.js
// (module chargé via <script src="/lib/shift-hours.js"> juste avant ce bloc).
function shiftEffectiveHours(s) { return ShiftHours.shiftEffectiveHours(s); }

function buildHistStatsHtml(shifts) {
    const nbShifts = shifts.length;
    const totalH = shifts.reduce((a, s) => {
        const { start, end } = shiftEffectiveHours(s);
        return a + (end - start);
    }, 0);
    const nbJours = new Set(shifts.map(s => s.date)).size;

    let html = '<div class="week-stats" style="padding:12px 0 4px">' +
        statCard(nbJours,             'Jours',  '') +
        statCard(nbShifts,            'Shifts', '') +
        statCard(fmtDuration(totalH), 'Heures', '') +
    '</div>';

    // Répartition par établissement (si > 1)
    const byEstab = {};
    shifts.forEach(s => {
        const { start, end } = shiftEffectiveHours(s);
        if (!byEstab[s.establishment_id]) byEstab[s.establishment_id] = { total: 0 };
        byEstab[s.establishment_id].total += (end - start);
    });
    const estabIds = Object.keys(byEstab);
    if (estabIds.length > 1) {
        html += '<div class="estab-hours-bar" style="padding:0 0 12px">';
        estabIds.forEach(id => {
            const { total } = byEstab[id];
            html +=
                '<div class="estab-hours-chip">' +
                    '<span>' + formatEstablishment(id) + '</span>' +
                    '<span style="font-weight:700;color:var(--text-primary);margin-left:4px">' + fmtDuration(total) + '</span>' +
                '</div>';
        });
        html += '</div>';
    }
    return html;
}

function renderHistoriqueWeek(wrap, data) {
    const shifts = (data.shifts || [])
        .filter(s => !s.is_joker && s.staff_id !== '__joker__')
        .slice().sort((a, b) =>
            a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start_time || 0) - (b.start_time || 0)
        );
    wrap.innerHTML = buildHistStatsHtml(shifts);

    if (shifts.length === 0) {
        wrap.insertAdjacentHTML('beforeend', '<div class="hist-empty">Aucun shift cette semaine.</div>');
        return;
    }

    // Grouper par date
    const byDate = new Map();
    shifts.forEach(s => {
        if (!byDate.has(s.date)) byDate.set(s.date, []);
        byDate.get(s.date).push(s);
    });

    const shiftDur = s => {
        const { start, end } = shiftEffectiveHours(s);
        const dur = end - start;
        const dh = Math.floor(dur), dm = Math.round((dur - dh) * 60);
        return dh + 'h' + (dm > 0 ? String(dm).padStart(2, '0') : '');
    };

    const list = document.createElement('div');
    list.className = 'hist-list';

    byDate.forEach((dayShifts, dateStr) => {
        const first = dayShifts[0];
        const [sy, sm, sd] = dateStr.split('-').map(Number);
        const d = new Date(sy, sm - 1, sd);
        const color = first.color || '#534AB7';

        const card = document.createElement('div');
        card.className = 'hist-card';
        card.style.borderLeftColor = color;

        const firstHours = shiftEffectiveHours(first);

        // Premier shift — en-tête de la carte
        let html =
            '<div class="hist-card-header">' +
                '<div class="hist-date-block">' +
                    '<div class="hist-weekday">' + DAY_NAMES_LONG_HIST[d.getDay()].slice(0, 3).toUpperCase() + '</div>' +
                    '<div class="hist-day-num">' + d.getDate() + '</div>' +
                '</div>' +
                '<div class="hist-vdivider"></div>' +
                '<div class="hist-card-info">' +
                    '<div class="hist-card-estab">' + formatEstablishment(first.establishment_id) + '</div>' +
                    '<div class="hist-card-sub">' + shiftDur(first) + '</div>' +
                '</div>' +
                '<span class="hist-hours-badge">' + fmtHour(firstHours.start) + ' – ' + fmtHour(firstHours.end) + '</span>' +
            '</div>';

        // Shifts supplémentaires du même jour
        for (let i = 1; i < dayShifts.length; i++) {
            const s = dayShifts[i];
            const c = s.color || '#534AB7';
            const sHours = shiftEffectiveHours(s);
            html +=
                '<div class="hist-extra-row">' +
                    '<span class="hist-extra-dot" style="background:' + c + '"></span>' +
                    '<span class="hist-extra-estab">' + formatEstablishment(s.establishment_id) + '</span>' +
                    '<span class="hist-extra-dur">' + shiftDur(s) + '</span>' +
                    '<span class="hist-hours-badge hist-hours-badge--sm">' + fmtHour(sHours.start) + ' – ' + fmtHour(sHours.end) + '</span>' +
                '</div>';
        }

        card.innerHTML = html;
        list.appendChild(card);
    });

    wrap.appendChild(list);
}

// ── Disponibilités ────────────────────────────────────────────────────────────

const DISPO_TYPES = {
    soir:   { label: 'Soir',   start: 16, end: 26 },
    midi:   { label: 'Midi',   start: 10, end: 17 },
    custom: { label: 'Horaires précis', start: null, end: null },
    off:    { label: 'Indisponible', start: null, end: null },
};

let dispoSettings  = null;
let dispoSelections = {}; // { "2025-06-23": { type, start_time, end_time, note } }

async function loadDisposTab() {
    // Charger les paramètres
    const sRes = await fetch('/api/dispo-settings', { credentials: 'include' });
    dispoSettings = await sRes.json();

    const statusEl = document.getElementById('dispos-status');
    const formEl   = document.getElementById('dispos-form');
    const btnSubmit = document.getElementById('btn-submit-dispos');

    // Deadline
    const deadline = new Date(dispoSettings.deadline);
    const fmtDate  = deadline.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

    if (!dispoSettings.canSubmit) {
        statusEl.textContent   = dispoSettings.deadlinePassed
            ? 'Deadline dépassée le ' + fmtDate + '.'
            : 'Saisie fermée par le responsable.';
        statusEl.style.color   = '#e74c3c';
        formEl.innerHTML       = '<div style="padding:20px 0;text-align:center;color:#ccc;font-size:14px">La saisie des disponibilités n\'est pas disponible pour le moment.</div>';
        btnSubmit.disabled     = true;
        btnSubmit.style.background = '#ccc';
        return;
    }

    statusEl.textContent = dispoSettings.force_open
        ? '🔓 Saisie ouverte en urgence par le responsable'
        : 'Deadline : ' + fmtDate;
    statusEl.style.color = dispoSettings.force_open ? '#27ae60' : '#aaa';

    // Semaine suivante
    const nextMonday = getMondayOf(addDays(new Date(), 7));

    // Charger les dispos existantes
    const from = toDateStr(nextMonday);
    const to   = toDateStr(addDays(nextMonday, 6));
    const dRes = await fetch('/api/dispos/mine?from=' + from + '&to=' + to, { credentials: 'include' });
    const existingDispos = dRes.ok ? await dRes.json() : [];

    // Pré-remplir les sélections
    dispoSelections = {};
    existingDispos.forEach(d => {
        dispoSelections[d.date] = { type: d.type, start_time: d.start_time, end_time: d.end_time, note: d.note || '' };
    });

    // Vérifier si des dispos ont déjà été soumises (pending ou confirmed)
    const alreadySubmitted = existingDispos.some(d => d.status === 'pending' || d.status === 'confirmed');

    // Jours de repos à masquer
    const restDays = dispoSettings.rest_days || [];

    // Pré-remplir depuis la semaine précédente si aucune dispo soumise
    if (!alreadySubmitted && existingDispos.length === 0) {
        const pRes = await fetch('/api/dispos/previous?week_start=' + from, { credentials: 'include' });
        if (pRes.ok) {
            const prevDispos = await pRes.json();
            prevDispos.forEach(p => {
                const [py, pm, pd] = p.date.split('-').map(Number);
                const curDate    = addDays(new Date(py, pm - 1, pd), 7);
                const curDateStr = toDateStr(curDate);
                if (!restDays.includes(curDate.getDay())) {
                    dispoSelections[curDateStr] = { type: p.type, start_time: p.start_time, end_time: p.end_time, note: p.note || '' };
                }
            });
        }
    }

    // Générer les cartes (jours de repos en lecture seule)
    formEl.innerHTML = '';
    for (let i = 0; i < 7; i++) {
        const d    = addDays(nextMonday, i);
        const date = toDateStr(d);
        if (restDays.includes(d.getDay())) {
            formEl.appendChild(createRestDayCard(d));
        } else {
            formEl.appendChild(createDispoCard(date, d));
        }
    }

    // Si déjà soumises → lecture seule
    if (alreadySubmitted) {
        formEl.querySelectorAll('.dispo-type-btn, .dispo-time-input, .dispo-note-input').forEach(el => {
            el.disabled = true;
            el.style.opacity = '0.6';
            el.style.cursor  = 'not-allowed';
            el.style.pointerEvents = 'none';
        });
        const notice = document.createElement('div');
        notice.style.cssText = 'background:#fff8e1;border:1px solid #f9c74f;border-radius:10px;padding:12px 16px;font-size:13px;color:#7a5c00;margin-bottom:4px;line-height:1.5;';
        notice.textContent = 'Tes disponibilités ont déjà été envoyées. Contacte ton responsable pour toute modification.';
        formEl.insertBefore(notice, formEl.firstChild);
        btnSubmit.style.display = 'none';
    }

    // Bloc note globale semaine
    const weekStart = toDateStr(nextMonday);
    const noteBlock = document.createElement('div');
    noteBlock.className = 'week-note-block';
    noteBlock.innerHTML =
        '<div class="week-note-label">Note pour la semaine</div>' +
        '<textarea id="weekNoteInput" class="week-note-textarea" maxlength="200" placeholder="Ex : Dispo mardi au besoin…"></textarea>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">' +
            '<span id="weekNoteCount" style="font-size:11px;color:var(--text-muted)">0 / 200</span>' +
            '<button id="saveWeekNote" class="week-note-save">Enregistrer la note</button>' +
        '</div>';
    formEl.appendChild(noteBlock);

    // Charger la note existante
    const nRes = await fetch('/api/dispos/week-note?week_start=' + weekStart, { credentials: 'include' });
    if (nRes.ok) {
        const nData = await nRes.json();
        const ta = document.getElementById('weekNoteInput');
        ta.value = nData.week_note || '';
        document.getElementById('weekNoteCount').textContent = ta.value.length + ' / 200';
    }

    document.getElementById('weekNoteInput').addEventListener('input', e => {
        document.getElementById('weekNoteCount').textContent = e.target.value.length + ' / 200';
    });

    document.getElementById('saveWeekNote').addEventListener('click', async () => {
        const note = document.getElementById('weekNoteInput').value;
        const btn  = document.getElementById('saveWeekNote');
        btn.disabled    = true;
        btn.textContent = 'Enregistrement…';
        try {
            const r = await fetch('/api/dispos/week-note', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ week_start: weekStart, week_note: note }),
            });
            if (!r.ok) throw new Error((await r.json()).error);
            btn.textContent = '✓ Enregistré';
            setTimeout(() => { btn.disabled = false; btn.textContent = 'Enregistrer la note'; }, 2000);
        } catch (err) {
            btn.disabled    = false;
            btn.textContent = 'Enregistrer la note';
            alert(err.message || 'Erreur');
        }
    });

    btnSubmit.replaceWith(btnSubmit.cloneNode(true));
    document.getElementById('btn-submit-dispos').addEventListener('click', submitDispos);
}

function createDispoCard(date, d) {
    const sel  = dispoSelections[date] || { type: null };
    const card = document.createElement('div');
    card.className = 'dispo-card';

    const fmt = h => String(Math.floor(h % 24)).padStart(2, '0') + 'h';

    // Labels avec horaires affichés directement
    const BTN_CONFIG = {
        soir:   { label: 'Soir',        sub: '16h → 02h', col: '#1a1a2e' },
        midi:   { label: 'Midi',        sub: '10h → 17h', col: '#534AB7' },
        custom: { label: 'Personnalisé', sub: 'horaires libres', col: '#2ecc71' },
        off:    { label: 'Indispo',     sub: null,           col: '#888' },
    };

    const isSelected = sel.type !== null;

    card.innerHTML =
        '<div class="dispo-day-header">' +
            '<div class="dispo-day-name">' + DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + '</div>' +
            (isSelected && sel.type !== 'off'
                ? '<div class="dispo-day-selected">' +
                    (sel.type === 'custom' && sel.start_time
                        ? fmt(sel.start_time) + ' → ' + fmt(sel.end_time)
                        : BTN_CONFIG[sel.type].sub) +
                  '</div>'
                : '') +
        '</div>' +
        '<div class="dispo-body">' +
            '<div class="dispo-type-row">' +
                ['soir', 'midi', 'custom', 'off'].map(type => {
                    const cfg    = BTN_CONFIG[type];
                    const active = sel.type === type ? ' selected-' + type : '';
                    return '<button class="dispo-type-btn' + active + '" data-date="' + date + '" data-type="' + type + '">' +
                        '<span class="dispo-btn-label">' + cfg.label + '</span>' +
                        (cfg.sub ? '<span class="dispo-btn-sub">' + cfg.sub + '</span>' : '') +
                    '</button>';
                }).join('') +
            '</div>' +
            '<div class="dispo-custom-row' + (sel.type === 'custom' ? ' visible' : '') + '" id="custom-' + date + '">' +
                '<input class="dispo-time-input" id="start-' + date + '" type="text" inputmode="numeric" placeholder="10" value="' + (sel.start_time ? fmt(sel.start_time) : '') + '">' +
                '<span style="color:#aaa;flex-shrink:0">→</span>' +
                '<input class="dispo-time-input" id="end-' + date + '" type="text" inputmode="numeric" placeholder="18" value="' + (sel.end_time ? fmt(sel.end_time) : '') + '">' +
            '</div>' +
            '<textarea class="dispo-note-input" id="note-' + date + '" placeholder="Note optionnelle..." rows="1">' + (sel.note || '') + '</textarea>' +
        '</div>';

    // Listeners boutons type
    card.querySelectorAll('.dispo-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const date = btn.dataset.date;

            card.querySelectorAll('.dispo-type-btn').forEach(b => { b.className = 'dispo-type-btn'; });
            btn.classList.add('selected-' + type);

            const customRow = document.getElementById('custom-' + date);
            customRow.classList.toggle('visible', type === 'custom');

            if (type === 'off') {
                dispoSelections[date] = { type: 'off', start_time: null, end_time: null, note: '' };
            } else if (type === 'custom') {
                dispoSelections[date] = { type: 'custom', start_time: null, end_time: null, note: '' };
            } else {
                dispoSelections[date] = {
                    type,
                    start_time: DISPO_TYPES[type].start,
                    end_time:   DISPO_TYPES[type].end,
                    note: '',
                };
            }

            // Mettre à jour le résumé dans le header de la carte
            const headerSel = card.querySelector('.dispo-day-selected');
            const cfg = BTN_CONFIG[type];
            if (type !== 'off' && cfg.sub) {
                if (headerSel) {
                    headerSel.textContent = cfg.sub;
                } else {
                    const dn = card.querySelector('.dispo-day-name');
                    const sp = document.createElement('div');
                    sp.className = 'dispo-day-selected';
                    sp.textContent = cfg.sub;
                    dn.after(sp);
                }
            } else if (headerSel) {
                headerSel.remove();
            }
        });
    });

    return card;
}

function createRestDayCard(d) {
    const card = document.createElement('div');
    card.className = 'dispo-card dispo-card-rest';
    card.innerHTML =
        '<div class="dispo-day-header">' +
            '<div class="dispo-day-name">' + DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + '</div>' +
            '<span class="dispo-rest-badge">Repos</span>' +
        '</div>';
    return card;
}

async function submitDispos() {
    const btn    = document.getElementById('btn-submit-dispos');
    btn.disabled = true;
    btn.textContent = 'Envoi…';

    const dispos = [];
    const nextMonday = getMondayOf(addDays(new Date(), 7));

    for (let i = 0; i < 7; i++) {
        const date = toDateStr(addDays(nextMonday, i));
        const sel  = dispoSelections[date];
        if (!sel || sel.type === null) continue; // jour non renseigné → ignoré (off = indispo, on l'enregistre)

        // Horaires précis : lire les champs
        let start = sel.start_time;
        let end   = sel.end_time;
        if (sel.type === 'custom') {
            const parseDispoTime = v => {
                if (!v) return null;
                v = v.trim().toLowerCase();
                let h = 0, m = 0;
                if (v.includes('h')) {
                    const parts = v.split('h');
                    h = parseInt(parts[0], 10) || 0;
                    m = parseInt(parts[1], 10) || 0;
                } else if (v.includes(':')) {
                    const parts = v.split(':');
                    h = parseInt(parts[0], 10) || 0;
                    m = parseInt(parts[1], 10) || 0;
                } else {
                    h = parseInt(v, 10) || 0;
                }
                return h + m / 60;
            };
            const startVal = document.getElementById('start-' + date)?.value;
            const endVal   = document.getElementById('end-'   + date)?.value;
            start = parseDispoTime(startVal);
            end   = parseDispoTime(endVal);
            if (start == null || end == null) {
                showMsg('Horaires invalides pour le ' + date, 'error');
                btn.disabled    = false;
                btn.textContent = 'Envoyer mes dispos';
                return;
            }
            // Fin après minuit (ex: début 16h, fin 02h → 26h)
            if (end <= start) end += 24;
        }

        const note = document.getElementById('note-' + date)?.value || '';
        dispos.push({ date, type: sel.type, start_time: start, end_time: end, note });
    }

    if (dispos.length === 0) {
        showMsg('Sélectionne au moins un jour.', 'error');
        btn.disabled    = false;
        btn.textContent = 'Envoyer mes dispos';
        return;
    }

    try {
        const res  = await fetch('/api/dispos', {
            credentials: 'include',
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            body:        JSON.stringify({ dispos }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showMsg(data.message, 'success');
        btn.textContent = 'Dispos envoyées ✓';
    } catch (e) {
        showMsg(e.message, 'error');
        btn.disabled    = false;
        btn.textContent = 'Envoyer mes dispos';
    }
}

// ── Notifications in-app (toasts) ────────────────────────────────────────────

const _NOTIF_CFG = {
    'planning-publie': { color: '#6C63FF', icon: '📅' },
    'shift-modifie':   { color: '#f59e0b', icon: '✏️' },
    'rappel-dispo':    { color: '#ef4444', icon: '⏰' },
    'dispo-traitee':   { color: '#10b981', icon: '✅' },
};

let _notifQueue    = [];
let _activeToasts  = 0;
const _MAX_TOASTS  = 3;
const _shownNotifs = new Set(); // évite les doublons entre appels successifs

async function loadStaffNotifs() {
    try {
        const res = await fetch('/api/notifications/mine', { credentials: 'include' });
        if (!res.ok) return;
        const { notifications } = await res.json();
        if (!notifications || !notifications.length) return;
        const newOnes = notifications.filter(n => !_shownNotifs.has(String(n._id)));
        if (!newOnes.length) return;
        newOnes.forEach(n => { _shownNotifs.add(String(n._id)); _notifQueue.push(n); });
        fetch('/api/notifications/mine/read', { method: 'PATCH', credentials: 'include' });
        _drainNotifQueue();
    } catch { /* silencieux */ }
}

function _drainNotifQueue() {
    while (_activeToasts < _MAX_TOASTS && _notifQueue.length > 0) {
        _showNotifToast(_notifQueue.shift());
    }
}

function _showNotifToast(notif) {
    const container = document.getElementById('notif-toast-container');
    if (!container) return;

    const cfg   = _NOTIF_CFG[notif.type] || { color: '#6C63FF', icon: '🔔' };
    const toast = document.createElement('div');
    toast.className = 'notif-toast';
    toast.style.borderLeftColor = cfg.color;
    toast.innerHTML =
        '<div class="notif-toast-icon">' + cfg.icon + '</div>' +
        '<div class="notif-toast-content">' +
            '<div class="notif-toast-title">' + _esc(notif.title) + '</div>' +
            '<div class="notif-toast-body">'  + _esc(notif.body)  + '</div>' +
        '</div>' +
        '<span class="notif-toast-close" role="button" aria-label="Fermer">✕</span>';

    _activeToasts++;
    container.appendChild(toast);

    toast.addEventListener('click', e => {
        if (e.target.classList.contains('notif-toast-close')) return;
        const url = notif.url || '';
        if (url.includes('#dispos')) {
            const t = document.querySelector('[data-tab="dispos"]');
            if (t) t.click();
        } else {
            const t = document.querySelector('[data-tab="planning"]');
            if (t) t.click();
        }
        _dismissToast(toast);
    });

    toast.querySelector('.notif-toast-close').addEventListener('click', e => {
        e.stopPropagation();
        _dismissToast(toast);
    });

    const timer = setTimeout(() => _dismissToast(toast), 5000);
    toast._notifTimer = timer;
}

function _dismissToast(toast) {
    clearTimeout(toast._notifTimer);
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => {
        toast.remove();
        _activeToasts = Math.max(0, _activeToasts - 1);
        _drainNotifQueue();
    }, { once: true });
}

function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// P-01 : taper une pastille collègue révèle nom complet + horaires en mini-toast
// (sur mobile, le `title` HTML est inopérant ; sur desktop il reste utilisable
// au hover et le tap fonctionne aussi).
document.addEventListener('click', (ev) => {
    const pill = ev.target.closest && ev.target.closest('.colleague-pill[data-pill-name]');
    if (!pill) return;
    const name  = pill.dataset.pillName  || '';
    const st    = parseFloat(pill.dataset.pillStart);
    const en    = parseFloat(pill.dataset.pillEnd);
    const color = pill.dataset.pillColor || '#888';
    const hours = (!Number.isNaN(st) && !Number.isNaN(en)) ? (fmtHour(st) + ' → ' + fmtHour(en)) : '';
    _showColleagueToast(name, hours, color);
});

let _colleagueToastTimer = null;
function _showColleagueToast(name, hours, color) {
    const existing = document.getElementById('colleague-toast');
    if (existing) existing.remove();
    if (_colleagueToastTimer) { clearTimeout(_colleagueToastTimer); _colleagueToastTimer = null; }

    const toast = document.createElement('div');
    toast.id = 'colleague-toast';
    toast.style.cssText =
        'position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));' +
        'transform:translate(-50%,20px);' +
        'background:#1a1a2e;color:#fff;padding:10px 14px;border-radius:12px;' +
        'font-size:13px;font-weight:600;display:flex;align-items:center;gap:10px;' +
        'box-shadow:0 6px 20px rgba(0,0,0,0.25);max-width:calc(100% - 32px);' +
        'z-index:9999;opacity:0;transition:opacity 0.18s ease,transform 0.22s cubic-bezier(0.32,0.72,0,1);' +
        'pointer-events:none';
    toast.innerHTML =
        '<span style="width:10px;height:10px;border-radius:50%;background:' + _esc(color) + ';flex-shrink:0"></span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(name) + '</span>' +
        (hours ? '<span style="font-weight:500;opacity:0.75;font-variant-numeric:tabular-nums;white-space:nowrap">' + hours + '</span>' : '');
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity   = '1';
        toast.style.transform = 'translate(-50%,0)';
    });
    _colleagueToastTimer = setTimeout(() => {
        toast.style.opacity   = '0';
        toast.style.transform = 'translate(-50%,20px)';
        setTimeout(() => toast.remove(), 220);
    }, 2400);
}

function showMsg(text, type) {
    const existing = document.getElementById('dispo-msg');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'dispo-msg';
    el.style.cssText = 'margin:0 20px 12px;padding:10px 14px;border-radius:8px;font-size:13px;' +
        (type === 'error'
            ? 'background:#fff5f5;border:1px solid #f5c6c6;color:#c0392b;'
            : 'background:#f0faf5;border:1px solid #a8dfc7;color:#1a7a4a;');
    el.textContent = text;
    document.getElementById('dispos-form').before(el);
}


// ── Web Push — abonnement ─────────────────────────────────────────────────────

let _pushSubscription = null;

// Convertit une clé VAPID base64url en Uint8Array pour le navigateur
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function initPushButton() {
    const btn = document.getElementById('btn-notif');
    if (!btn) return;

    // Masquer le bouton si Push non supporté
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
        btn.style.display = 'none';
        return;
    }

    // Vérifier la permission actuelle
    if (Notification.permission === 'denied') {
        btn.classList.add('denied');
        btn.title = 'Notifications bloquées dans les réglages du navigateur';
        return;
    }

    // Vérifier si déjà abonné
    try {
        const reg = await navigator.serviceWorker.ready;
        _pushSubscription = await reg.pushManager.getSubscription();
        if (_pushSubscription) {
            btn.classList.add('active');
            btn.title = 'Notifications activées — cliquer pour désactiver';
            const lbl = document.getElementById('btn-notif-label');
            if (lbl) lbl.textContent = 'Activé';
        }
    } catch { /* silencieux */ }
}

async function togglePushSubscription() {
    const btn = document.getElementById('btn-notif');
    if (!btn || btn.classList.contains('denied')) return;

    if (_pushSubscription) {
        // ── Désabonnement ──
        try {
            await _pushSubscription.unsubscribe();
            await fetch('/api/push/subscribe', {
                method:      'DELETE',
                credentials: 'include',
                headers:     { 'Content-Type': 'application/json' },
                body:        JSON.stringify({ endpoint: _pushSubscription.endpoint }),
            });
            _pushSubscription = null;
            btn.classList.remove('active');
            btn.title = 'Activer les notifications';
            const lbl = document.getElementById('btn-notif-label');
            if (lbl) lbl.textContent = 'Notifs';
        } catch (e) {
            console.error('Erreur désabonnement push:', e);
        }
        return;
    }

    // ── Abonnement ──
    try {
        // Récupérer la clé publique VAPID
        const keyRes = await fetch('/api/push/vapid-public-key', { credentials: 'include' });
        if (!keyRes.ok) {
            const err = await keyRes.json().catch(() => ({}));
            _showNotifToast({ type: 'rappel-dispo', title: 'Push non configuré', body: err.error || 'Clé VAPID manquante côté serveur', url: '/planning.html' });
            return;
        }
        const { publicKey } = await keyRes.json();

        // Demander la permission
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            if (perm === 'denied') {
                btn.classList.add('denied');
                btn.title = 'Notifications bloquées dans les réglages du navigateur';
                _showNotifToast({ type: 'rappel-dispo', title: 'Notifications bloquées', body: 'Autorise les notifications dans les réglages de ton navigateur', url: '/planning.html' });
            }
            return;
        }

        const reg = await navigator.serviceWorker.ready;
        _pushSubscription = await reg.pushManager.subscribe({
            userVisibleOnly:      true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        // Envoyer la subscription au serveur
        const subRes = await fetch('/api/push/subscribe', {
            method:      'POST',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/json' },
            body:        JSON.stringify({ subscription: _pushSubscription.toJSON() }),
        });
        if (subRes.ok) {
            btn.classList.add('active');
            btn.title = 'Notifications activées — cliquer pour désactiver';
            const lbl = document.getElementById('btn-notif-label');
            if (lbl) lbl.textContent = 'Activé';
            _showNotifToast({ type: 'planning-publie', title: 'Notifications activées ✅', body: 'Tu recevras les alertes planning sur cet appareil', url: '/planning.html' });
        } else {
            const err = await subRes.json().catch(() => ({}));
            _showNotifToast({ type: 'rappel-dispo', title: 'Erreur d\'enregistrement', body: err.error || 'Impossible d\'enregistrer la subscription', url: '/planning.html' });
        }
    } catch (e) {
        console.error('Erreur abonnement push:', e);
        _showNotifToast({ type: 'rappel-dispo', title: 'Erreur push', body: e.message || 'Impossible d\'activer les notifications', url: '/planning.html' });
    }
}



// ── Auto-refresh polling (staff) ─────────────────────────────────────────────

let _staffLastTs = 0;
let _staffPollTimer = null;

async function startStaffAutoRefresh(from, to, user) {
    // Capturer le timestamp initial
    try {
        const res = await fetch('/api/last-updated', { credentials: 'include' });
        if (res.ok) { const d = await res.json(); _staffLastTs = d.ts || 0; }
    } catch { /* silencieux */ }

    _staffPollTimer = setInterval(async () => {
        try {
            const res = await fetch('/api/last-updated', { credentials: 'include' });
            if (!res.ok) return;
            const { ts } = await res.json();
            if (ts && ts !== _staffLastTs) {
                _staffLastTs = ts;
                // Recharger silencieusement le planning affiché
                await loadPlanning(from, to, user);
                // Si la vue "semaine prochaine" était chargée, la marquer à recharger
                const viewNext = document.getElementById('view-next-week');
                if (viewNext) delete viewNext.dataset.loaded;
            }
        } catch { /* silencieux */ }
    }, 30000);
}

/* ── Échanges de shifts (F-05) — DÉSACTIVÉ ───────────────────────────────────

window._myPendingSwaps = [];

function showSwapToast(msg, isError) {
    const el = document.getElementById('swap-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = isError ? '#c0392b' : '#1a1a2e';
    el.style.display = 'block';
    clearTimeout(window._swapToastT);
    window._swapToastT = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

async function loadMyPendingSwaps() {
    try {
        const res = await fetch('/api/shift-swaps/mine', { credentials: 'include' });
        if (!res.ok) { window._myPendingSwaps = []; return; }
        window._myPendingSwaps = await res.json();
    } catch { window._myPendingSwaps = []; }
}

let _swapSource = null;
let _swapTarget = null;

async function openSwapModal(shift) {
    _swapSource = shift;
    _swapTarget = null;
    const modal = document.getElementById('swap-modal');
    modal.style.display = 'flex';

    const src = document.getElementById('swap-source');
    src.innerHTML =
        '<div style="font-size:10px;color:#534AB7;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:4px">Votre shift</div>' +
        '<div style="font-weight:700;font-size:14px;color:#1a1a2e">' + _fmtSwapDate(shift.date) + ' · ' + fmtHour(shift.start_time) + ' → ' + fmtHour(shift.end_time) + '</div>' +
        '<div style="font-size:12px;color:#555;margin-top:2px">' + formatEstablishment(shift.establishment_id) + '</div>';

    document.getElementById('swap-note').value = '';
    const btn = document.getElementById('swap-submit');
    btn.disabled = true; btn.style.opacity = '0.5';

    // Charger les shifts échangeables (4 semaines glissantes depuis aujourd'hui)
    const targets = document.getElementById('swap-targets');
    targets.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;font-size:13px">Chargement…</div>';
    try {
        const today = new Date();
        const from = toDateStr(today);
        const to   = toDateStr(addDays(today, 28));
        const res  = await fetch('/api/shifts-for-swap?from=' + from + '&to=' + to, { credentials: 'include' });
        const list = await res.json();
        if (!res.ok) throw new Error(list.error || 'Erreur');
        // Exclure le shift source
        const eligible = list.filter(s => s._id !== shift._id);
        if (eligible.length === 0) {
            targets.innerHTML = '<div style="padding:24px;text-align:center;color:#aaa;font-size:13px">Aucun shift collègue échangeable dans les 4 prochaines semaines</div>';
            return;
        }
        targets.innerHTML = '';
        eligible.forEach(t => {
            const item = document.createElement('div');
            item.style.cssText = 'border:1.5px solid #e8eaed;border-radius:10px;padding:10px 12px;cursor:pointer;transition:all 0.15s;background:white';
            const _tSm   = allStaff.find(s => String(s._id) === t.staff_id);
            const _tName = _tSm ? (_tSm.nickname || (t.staff_name || '').split(' ')[0]) : (t.staff_name ? t.staff_name.split(' ')[0] : '—');
            item.innerHTML =
                '<div style="display:flex;align-items:center;gap:8px">' +
                    '<span style="width:10px;height:10px;border-radius:50%;background:' + (t.color || '#888') + ';flex-shrink:0"></span>' +
                    '<div style="flex:1;min-width:0">' +
                        '<div style="font-weight:700;font-size:13px;color:#1a1a2e">' + _tName + '</div>' +
                        '<div style="font-size:12px;color:#555">' + _fmtSwapDate(t.date) + ' · ' + fmtHour(t.start_time) + ' → ' + fmtHour(t.end_time) + '</div>' +
                        '<div style="font-size:11px;color:#888">' + formatEstablishment(t.establishment_id) + '</div>' +
                    '</div>' +
                '</div>';
            item.addEventListener('click', () => {
                _swapTarget = t;
                [...targets.children].forEach(c => { c.style.borderColor = '#e8eaed'; c.style.background = 'white'; });
                item.style.borderColor = '#534AB7';
                item.style.background  = '#eef2ff';
                const b = document.getElementById('swap-submit');
                b.disabled = false; b.style.opacity = '1';
            });
            targets.appendChild(item);
        });
    } catch (e) {
        targets.innerHTML = '<div style="padding:16px;text-align:center;color:#e74c3c;font-size:13px">' + (e.message || 'Erreur') + '</div>';
    }
}

function closeSwapModal() {
    const modal = document.getElementById('swap-modal');
    if (modal) modal.style.display = 'none';
    _swapSource = null;
    _swapTarget = null;
}

async function submitSwap() {
    if (!_swapSource || !_swapTarget) return;
    const btn = document.getElementById('swap-submit');
    btn.disabled = true; btn.textContent = 'Envoi…';
    try {
        const note = document.getElementById('swap-note').value.trim();
        const res = await fetch('/api/shift-swaps', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_shift_id: _swapSource._id, to_shift_id: _swapTarget._id, note }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
        showSwapToast('Demande envoyée au patron');
        closeSwapModal();
        await loadMyPendingSwaps();
        const p = window._currentPlan;
        if (p) await loadPlanning(p.from, p.to, p.user);
    } catch (e) {
        showSwapToast(e.message || 'Erreur', true);
        btn.disabled = false;
    } finally {
        btn.textContent = 'Envoyer la demande';
    }
}

async function cancelMySwap(swapId) {
    if (!confirm('Annuler votre demande d\'échange ?')) return;
    try {
        const res = await fetch('/api/shift-swaps/' + swapId, { method: 'DELETE', credentials: 'include' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
        showSwapToast('Demande annulée');
        await loadMyPendingSwaps();
        const p = window._currentPlan;
        if (p) await loadPlanning(p.from, p.to, p.user);
    } catch (e) {
        showSwapToast(e.message || 'Erreur', true);
    }
}

function _fmtSwapDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return DAY_NAMES[date.getDay()] + ' ' + d + ' ' + MONTH_NAMES[m - 1];
}

document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('swap-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeSwapModal);
    const submit = document.getElementById('swap-submit');
    if (submit) submit.addEventListener('click', submitSwap);
    const overlay = document.getElementById('swap-modal');
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closeSwapModal(); });
});

─────────────────────────────────────────────────────────────────────────── */

// ── Démarrage ─────────────────────────────────────────────────────────────────

init().then(() => initPushButton());
