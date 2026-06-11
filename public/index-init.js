// Glue UI spécifique à index.html (drawer mobile, FAB staff, sync badge dispos).
// Externalisé du HTML pour préparer une CSP sans unsafe-inline sur script-src.
// Ces fonctions restent globales (appelées par des onclick= dans index.html).

// ── Drawer mobile ─────────────────────────────────────────────────────────────
function openMobileDrawer() {
    syncDrawerDispoToggle();
    document.getElementById('mobile-drawer').classList.add('open');
    document.getElementById('mobile-drawer-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeMobileDrawer() {
    document.getElementById('mobile-drawer').classList.remove('open');
    document.getElementById('mobile-drawer-overlay').classList.remove('open');
    document.body.style.overflow = '';
}

// ── Dispo toggle dans le drawer ───────────────────────────────────────────────
function syncDrawerDispoToggle() {
    const mainToggle = document.getElementById('dispo-toggle');
    const check      = document.getElementById('drawer-dispo-check');
    const label      = document.getElementById('drawer-dispo-state-label');
    const track      = document.getElementById('drawer-dispo-track');
    const thumb      = document.getElementById('drawer-dispo-thumb');
    if (!mainToggle || !check) return;
    const on = mainToggle.checked;
    check.checked = on;
    if (label) label.textContent = on ? '✅ Dispos ouvertes' : '🔒 Dispos fermées';
    if (track) track.style.background = on ? '#10b981' : '#d0d0d0';
    if (thumb) thumb.style.transform   = on ? 'translateX(20px)' : '';
}

function openDispoSettingsMobile() {
    closeMobileDrawer();
    const panel = document.getElementById('dispo-advanced-panel');
    if (!panel || !panel.innerHTML.trim()) {
        if (typeof showToast === 'function') showToast('Paramètres non chargés — réessaie');
        return;
    }
    if (!panel._movedToBody) {
        document.body.appendChild(panel);
        panel._movedToBody = true;
    }
    // Délai pour laisser l'événement click du bouton se propager jusqu'au document
    // avant d'afficher le panneau — sinon le handler global de loadDispoControl
    // masque immédiatement le panneau qu'on vient d'ouvrir.
    setTimeout(() => {
        panel.style.cssText = 'display:block;position:fixed;top:60px;left:16px;right:16px;min-width:auto;z-index:600;background:white;color:var(--text-primary);border:1.5px solid #e8eaed;border-radius:12px;padding:16px;box-shadow:0 8px 32px rgba(0,0,0,0.18);overflow-y:auto;max-height:calc(100vh - 80px)';
        setTimeout(() => {
            function _hidePanel(e) {
                if (!panel.contains(e.target)) {
                    panel.style.display = 'none';
                    document.removeEventListener('click', _hidePanel);
                }
            }
            document.addEventListener('click', _hidePanel);
        }, 80);
    }, 50);
}

// ── FAB staff (bottom sheet) ──────────────────────────────────────────────────
function toggleStaffBar() {
    const bar = document.getElementById('staff-bar-container');
    if (!bar) return;
    const isOpen = bar.classList.contains('open');
    if (isOpen) {
        _closeStaffBar();
    } else {
        _openStaffBar();
    }
}

function _openStaffBar() {
    const bar = document.getElementById('staff-bar-container');
    const fab = document.getElementById('fab-staff');
    if (!bar) return;
    bar.classList.add('open');
    fab.textContent = '✕';
}

function _closeStaffBar() {
    const bar = document.getElementById('staff-bar-container');
    const fab = document.getElementById('fab-staff');
    if (!bar) return;
    bar.classList.remove('open');
    fab.textContent = '＋';
    const ov = document.getElementById('staff-bar-overlay');
    if (ov) ov.style.display = 'none';
}

// ── Synchroniser le badge dispos dans le drawer ───────────────────────────────
const _origLoadDisposBadge = typeof loadDisposBadge !== 'undefined' ? loadDisposBadge : null;
window.addEventListener('load', () => {
    // Patcher loadDisposBadge pour synchroniser le drawer badge aussi
    const drawerBadge = document.getElementById('drawer-dispos-badge');
    const mainBadge   = document.getElementById('dispos-badge');
    if (drawerBadge && mainBadge) {
        const observer = new MutationObserver(() => {
            drawerBadge.textContent   = mainBadge.textContent;
            drawerBadge.style.display = mainBadge.style.display;
        });
        observer.observe(mainBadge, { attributes: true, childList: true, subtree: true, characterData: true });
    }

    // Lier le toggle du drawer au toggle principal dispo
    const drawerCheck = document.getElementById('drawer-dispo-check');
    const mainToggle  = document.getElementById('dispo-toggle');
    if (drawerCheck && mainToggle) {
        drawerCheck.addEventListener('change', () => {
            if (drawerCheck.checked !== mainToggle.checked) {
                mainToggle.click();
            }
            syncDrawerDispoToggle();
        });
        // Écouter les changements sur le toggle principal pour garder le drawer à jour
        mainToggle.addEventListener('change', () => syncDrawerDispoToggle());
    }

    // Sync initial après chargement des données dispo
    setTimeout(syncDrawerDispoToggle, 600);
});
