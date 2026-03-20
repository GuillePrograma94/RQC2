/**
 * POST /api/auth/change-password-user
 * Cambia la contraseña de un usuario (tabla usuarios) y la sincroniza con Supabase Auth.
 *
 * Body: { user_id: number, password_actual: string, password_nueva: string }
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

function authEmail(codigoUsuario) {
    const safe = String(codigoUsuario).trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safe}@labels.auth`;
}

async function findAuthUserIdByEmail(supabase, email) {
    const target = String(email || '').trim().toLowerCase();
    if (!target) return null;
    const perPage = 1000;
    const maxPages = 25;
    for (let page = 1; page <= maxPages; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
        if (error) return null;
        const users = data && Array.isArray(data.users) ? data.users : [];
        const existing = users.find(u => (u.email || '').toString().trim().toLowerCase() === target);
        if (existing && existing.id) return existing.id;
        if (users.length < perPage) break;
    }
    return null;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, message: 'Metodo no permitido' });
        return;
    }

    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        res.status(500).json({ success: false, message: 'Configuracion de servidor incompleta' });
        return;
    }

    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {
        res.status(400).json({ success: false, message: 'Body JSON invalido' });
        return;
    }

    const userId = body.user_id != null ? parseInt(body.user_id, 10) : NaN;
    const passwordActual = body.password_actual != null ? String(body.password_actual) : '';
    const passwordNueva = body.password_nueva != null ? String(body.password_nueva) : '';

    if (!Number.isInteger(userId) || userId <= 0 || !passwordActual || !passwordNueva) {
        res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
        return;
    }
    if (passwordNueva.length < 4) {
        res.status(400).json({ success: false, message: 'La nueva contrasena debe tener al menos 4 caracteres' });
        return;
    }

    const supabase = createClient(url, serviceKey);
    const hashActual = hashPassword(passwordActual);
    const hashNueva = hashPassword(passwordNueva);

    const { data: userRow, error: userErr } = await supabase
        .from('usuarios')
        .select('id,codigo_usuario,password_hash,auth_user_id,activo,tipo')
        .eq('id', userId)
        .maybeSingle();

    if (userErr) {
        res.status(500).json({ success: false, message: 'Error al cargar usuario' });
        return;
    }
    if (!userRow || userRow.activo !== true) {
        res.status(404).json({ success: false, message: 'Usuario no encontrado o inactivo' });
        return;
    }
    if (String(userRow.password_hash || '') !== hashActual) {
        res.status(401).json({ success: false, message: 'Contrasena actual incorrecta' });
        return;
    }

    // 1) Actualizar hash en tabla usuarios
    const { error: updErr } = await supabase
        .from('usuarios')
        .update({ password_hash: hashNueva, fecha_actualizacion: new Date().toISOString() })
        .eq('id', userId);
    if (updErr) {
        res.status(500).json({ success: false, message: 'Error al guardar la nueva contrasena' });
        return;
    }

    // 2) Sincronizar Supabase Auth
    const email = authEmail(userRow.codigo_usuario);
    const appMetadata = {
        usuario_id: userId,
        es_administrador: String(userRow.tipo || '').toUpperCase() === 'ADMINISTRADOR',
        es_administracion: String(userRow.tipo || '').toUpperCase() === 'ADMINISTRACION'
    };

    let authUserId = userRow.auth_user_id ? String(userRow.auth_user_id) : null;
    let authSyncOk = false;

    if (authUserId) {
        const { error } = await supabase.auth.admin.updateUserById(authUserId, {
            password: passwordNueva,
            app_metadata: appMetadata
        });
        authSyncOk = !error;
    }

    if (!authSyncOk) {
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
            email,
            password: passwordNueva,
            email_confirm: true,
            app_metadata: appMetadata
        });

        if (!createErr) {
            authUserId = created && (created.user ? created.user.id : created.id) || authUserId;
            authSyncOk = true;
        } else {
            const msg = String(createErr.message || '').toLowerCase();
            if (
                msg.includes('already been registered') ||
                msg.includes('already registered') ||
                (msg.includes('already') && msg.includes('register'))
            ) {
                const existingId = await findAuthUserIdByEmail(supabase, email);
                if (existingId) {
                    const { error: updExistingErr } = await supabase.auth.admin.updateUserById(existingId, {
                        password: passwordNueva,
                        app_metadata: appMetadata
                    });
                    if (!updExistingErr) {
                        authUserId = existingId;
                        authSyncOk = true;
                    }
                }
            }
        }
    }

    if (!authSyncOk) {
        res.status(500).json({ success: false, message: 'Contrasena guardada en BD pero no sincronizada en Auth' });
        return;
    }

    if (authUserId && authUserId !== userRow.auth_user_id) {
        await supabase.from('usuarios').update({ auth_user_id: authUserId }).eq('id', userId);
    }

    res.status(200).json({ success: true, message: 'Contrasena actualizada correctamente' });
};

