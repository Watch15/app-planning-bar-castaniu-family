document.getElementById('copyright-year').textContent = new Date().getFullYear();

    // Vérifier si déjà connecté
    fetch('/auth/me', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.user) redirectByRole(data.user.role); })
        .catch(() => {});

    // ── Toggle mode ───────────────────────────────────────────────────────────

    function switchMode(mode) {
        hideError();
        document.getElementById('toggle-email-btn').classList.toggle('active', mode === 'email');
        document.getElementById('toggle-phone-btn').classList.toggle('active', mode === 'phone');
        document.getElementById('mode-email').style.display = mode === 'email' ? '' : 'none';
        document.getElementById('mode-phone').style.display = mode === 'phone' ? '' : 'none';
        if (mode === 'email') document.getElementById('email').focus();
        else                  document.getElementById('phone').focus();
    }

    // ── Mode Email ────────────────────────────────────────────────────────────

    document.getElementById('toggle-pw-email').addEventListener('click', () => {
        const pw = document.getElementById('password-email');
        pw.type = pw.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('email').addEventListener('keydown',          e => { if (e.key === 'Enter') loginEmail(); });
    document.getElementById('password-email').addEventListener('keydown', e => { if (e.key === 'Enter') loginEmail(); });
    document.getElementById('btn-login-email').addEventListener('click', loginEmail);

    async function loginEmail() {
        const email    = document.getElementById('email').value.trim();
        const password = document.getElementById('password-email').value;
        if (!email || !password) { showError('Remplis tous les champs.'); return; }
        const btn = document.getElementById('btn-login-email');
        setLoading(btn, true, 'Connexion…');
        hideError();
        try {
            const res  = await fetch('/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) { showError(data.error || 'Erreur de connexion.'); return; }
            redirectByRole(data.user.role);
        } catch { showError('Impossible de contacter le serveur.'); }
        finally { setLoading(btn, false, 'Se connecter'); }
    }

    // Mot de passe oublié — email
    document.getElementById('link-forgot-email').addEventListener('click', e => {
        e.preventDefault();
        const f = document.getElementById('forgot-form-email');
        f.style.display = f.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('btn-reset-email').addEventListener('click', async () => {
        const email = document.getElementById('reset-email').value.trim();
        if (!email) { showError('Saisis ton email.'); return; }
        const btn = document.getElementById('btn-reset-email');
        setLoading(btn, true, 'Envoi…');
        hideError();
        try {
            const res  = await fetch('/auth/forgot-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (data.manual && data.link) {
                document.getElementById('forgot-form-email').innerHTML =
                    '<div style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:8px;padding:12px;font-size:12px">' +
                    '<div style="font-weight:600;color:#92400e;margin-bottom:6px">Email non envoyé — copie ce lien :</div>' +
                    '<div style="word-break:break-all;color:#555;cursor:pointer;text-decoration:underline" ' +
                    'onclick="navigator.clipboard.writeText(this.dataset.link);" data-link="' + data.link + '">' +
                    data.link + '</div></div>';
            } else {
                document.getElementById('forgot-form-email').innerHTML =
                    '<div style="background:#f0fdf4;border:1px solid #a8dfc7;border-radius:8px;padding:12px;font-size:13px;color:#065f46">Si cet email existe, un lien a été envoyé.</div>';
            }
        } catch { showError('Impossible de contacter le serveur.'); }
        finally { setLoading(btn, false, 'Envoyer le lien'); }
    });

    // ── Mode Téléphone ────────────────────────────────────────────────────────

    document.getElementById('toggle-pw-phone').addEventListener('click', () => {
        const pw = document.getElementById('password-phone');
        pw.type = pw.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('phone').addEventListener('keydown',          e => { if (e.key === 'Enter') loginPhone(); });
    document.getElementById('password-phone').addEventListener('keydown', e => { if (e.key === 'Enter') loginPhone(); });
    document.getElementById('btn-login-phone').addEventListener('click', loginPhone);

    async function loginPhone() {
        const phone    = document.getElementById('phone').value.trim();
        const password = document.getElementById('password-phone').value;
        if (!phone || !password) { showError('Remplis tous les champs.'); return; }
        const btn = document.getElementById('btn-login-phone');
        setLoading(btn, true, 'Connexion…');
        hideError();
        try {
            const res  = await fetch('/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ phone, password }),
            });
            const data = await res.json();
            if (!res.ok) { showError(data.error || 'Erreur de connexion.'); return; }
            redirectByRole(data.user.role);
        } catch { showError('Impossible de contacter le serveur.'); }
        finally { setLoading(btn, false, 'Se connecter'); }
    }

    // Mot de passe oublié — téléphone
    document.getElementById('link-forgot-phone').addEventListener('click', e => {
        e.preventDefault();
        const f = document.getElementById('forgot-form-phone');
        f.style.display = f.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('btn-reset-phone').addEventListener('click', async () => {
        const phone = document.getElementById('reset-phone').value.trim();
        if (!phone) { showError('Saisis ton numéro.'); return; }
        const btn = document.getElementById('btn-reset-phone');
        setLoading(btn, true, 'Envoi…');
        hideError();
        try {
            const res  = await fetch('/auth/forgot-password', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone }),
            });
            const data = await res.json();
            if (data.manual && data.link) {
                document.getElementById('forgot-form-phone').innerHTML =
                    '<div style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:8px;padding:12px;font-size:12px">' +
                    '<div style="font-weight:600;color:#92400e;margin-bottom:6px">SMS non envoyé — copie ce lien :</div>' +
                    '<div style="word-break:break-all;color:#555;cursor:pointer;text-decoration:underline" ' +
                    'onclick="navigator.clipboard.writeText(this.dataset.link);" data-link="' + data.link + '">' +
                    data.link + '</div></div>';
            } else {
                document.getElementById('forgot-form-phone').innerHTML =
                    '<div style="background:#f0fdf4;border:1px solid #a8dfc7;border-radius:8px;padding:12px;font-size:13px;color:#065f46">Si ce numéro existe, un SMS a été envoyé.</div>';
            }
        } catch { showError('Impossible de contacter le serveur.'); }
        finally { setLoading(btn, false, 'Envoyer le lien par SMS'); }
    });

    // ── Utilitaires ───────────────────────────────────────────────────────────

    function redirectByRole(role) {
        if (role === 'patron' || role === 'directeur') window.location.href = '/index.html';
        else if (role === 'etablissement')             window.location.href = '/pointage.html';
        else                                           window.location.href = '/planning.html';
    }

    function setLoading(btn, loading, text) {
        btn.disabled  = loading;
        btn.innerHTML = loading ? '<span class="spinner"></span>' + text : text;
    }

    function showError(msg) {
        const el = document.getElementById('error-msg');
        el.textContent = msg;
        el.classList.add('visible');
    }
    function hideError() { document.getElementById('error-msg').classList.remove('visible'); }
