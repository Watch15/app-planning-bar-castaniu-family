    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');
    const mode   = params.get('mode'); // 'reset' ou null (invitation)
    const isReset = mode === 'reset';

    // Adapter le titre selon le mode
    if (isReset) {
        document.querySelector('#page-title').textContent    = 'Nouveau mot de passe';
        document.querySelector('#page-subtitle').textContent = 'Choisis un nouveau mot de passe pour ton compte.';
        document.getElementById('btn-submit').textContent    = 'Mettre à jour';
        document.getElementById('logo-sub').textContent      = 'Réinitialisation du mot de passe';
    }

    document.getElementById('copyright-year').textContent = new Date().getFullYear();

    if (!token) {
        showMsg('Lien invalide ou expiré. Demande un nouveau lien depuis la page de connexion.', 'error');
        const btn = document.getElementById('btn-submit');
        btn.textContent = '← Retour à la connexion';
        // Masquer les champs : plus rien à remplir
        document.querySelectorAll('.field').forEach(f => f.style.display = 'none');
    } else {
        document.getElementById('rgpd-staff-notice').style.display = '';
    }

    document.getElementById('btn-submit').addEventListener('click', async () => {
        if (!token) { window.location.href = '/login.html'; return; }
        const password = document.getElementById('password').value;
        const confirm  = document.getElementById('confirm').value;

        if (password.length < 8) { showMsg('8 caractères minimum.', 'error'); return; }
        if (password !== confirm) { showMsg('Les mots de passe ne correspondent pas.', 'error'); return; }

        const btn = document.getElementById('btn-submit');
        btn.disabled    = true;
        btn.textContent = 'Mise à jour…';

        const route  = isReset ? '/auth/reset-password' : '/auth/set-password';
        const method = isReset ? 'PATCH' : 'POST';

        try {
            const res  = await fetch(route, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ token, password }),
            });
            const data = await res.json();

            if (!res.ok) {
                showMsg(data.error || 'Erreur.', 'error');
                btn.disabled    = false;
                btn.textContent = isReset ? 'Mettre à jour' : 'Activer mon compte';
                return;
            }

            showMsg(isReset ? 'Mot de passe mis à jour ! Redirection…' : 'Compte activé ! Redirection…', 'success');
            setTimeout(() => window.location.href = '/login.html', 2000);
        } catch {
            showMsg('Impossible de contacter le serveur.', 'error');
            btn.disabled    = false;
            btn.textContent = isReset ? 'Mettre à jour' : 'Activer mon compte';
        }
    });

    function showMsg(text, type) {
        const el = document.getElementById('msg');
        el.textContent = text;
        el.className   = 'msg ' + type + ' visible';
    }

    function toggleEye(inputId, btn) {
        const input = document.getElementById(inputId);
        const show  = input.type === 'password';
        input.type  = show ? 'text' : 'password';
        btn.style.opacity = show ? '1' : '0.45';
    }
