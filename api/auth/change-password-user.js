/**
 * POST /api/auth/change-password-user
 * Cambia la contraseña de un usuario (tabla usuarios) y la sincroniza con Supabase Auth.
 *
 * Body: { codigo_usuario?: string, user_id?: number, password_actual: string, password_nueva: string }
 * Estándar: usar siempre codigo_usuario (dato real que introduce el usuario).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

function toAuthPassword(password) {
    const raw = String(password == null ? '' : password);
    // Supabase Auth exige >= 6. Regla funcional de app: 4+.
    return raw.length >= 6 ? raw : (raw + '__BM');
}

function safeErrMsg(err) {
    if (!err) return null;
    const msg = err.message || err.code || String(err);
    return String(msg || '').substring(0, 220) || null;
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

    const codigoUsuario = body.codigo_usuario != null ? String(body.codigo_usuario).trim() : '';
    const userId = body.user_id != null ? parseInt(body.user_id, 10) : NaN;
    const passwordActual = body.password_actual != null ? String(body.password_actual) : '';
    const passwordNueva = body.password_nueva != null ? String(body.password_nueva) : '';

    if (!codigoUsuario && (!Number.isInteger(userId) || userId <= 0) || !passwordActual || !passwordNueva) {
        res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
        return;
    }
    if (passwordNueva.length < 4) {
        res.status(400).json({ success: false, message: 'La nueva contraseña debe tener al menos 4 caracteres' });
        return;
    }

    const supabase = createClient(url, serviceKey);
    const hashActual = hashPassword(passwordActual);
    const hashNueva = hashPassword(passwordNueva);
    const authPasswordNueva = toAuthPassword(passwordNueva);

    let userQuery = supabase
        .from('usuarios')
        .select('id,codigo_usuario,password_hash,auth_user_id,activo,tipo,almacen_habitual,almacen_tienda');

    if (codigoUsuario) {
        userQuery = userQuery.eq('codigo_usuario', codigoUsuario);
    } else {
        userQuery = userQuery.eq('id', userId);
    }

    const { data: userRow, error: userErr } = await userQuery.maybeSingle();

    if (userErr) {
        res.status(500).json({ success: false, message: 'Error al cargar usuario' });
        return;
    }
    if (!userRow || userRow.activo !== true) {
        res.status(404).json({ success: false, message: 'Usuario no encontrado o inactivo' });
        return;
    }
    if (Number.isInteger(userId) && userId > 0 && userRow.id !== userId) {
        res.status(409).json({
            success: false,
            message: 'Inconsistencia entre codigo_usuario y user_id; no se aplica cambio por seguridad'
        });
        return;
    }
    if (String(userRow.password_hash || '') !== hashActual) {
        res.status(401).json({ success: false, message: 'Contrasena actual incorrecta' });
        return;
    }

    // 1) Actualizar hash en tabla usuarios
    const oldHash = String(userRow.password_hash || '');
    const { error: updErr } = await supabase
        .from('usuarios')
        .update({ password_hash: hashNueva, fecha_actualizacion: new Date().toISOString() })
        .eq('id', userRow.id);
    if (updErr) {
        res.status(500).json({ success: false, message: 'Error al guardar la nueva contrasena' });
        return;
    }

    // 2) Sincronizar Supabase Auth
    const email = authEmail(userRow.codigo_usuario);
    const tipoTitular = String(userRow.tipo || '').toUpperCase();
    const appMetadata = {
        usuario_id: userRow.id,
        es_administrador: tipoTitular === 'ADMINISTRADOR',
        es_administracion: tipoTitular === 'ADMINISTRACION',
        es_dependiente: tipoTitular === 'DEPENDIENTE',
        almacen_habitual: userRow.almacen_habitual != null ? String(userRow.almacen_habitual).trim() : null,
        almacen_tienda: userRow.almacen_tienda != null ? String(userRow.almacen_tienda).trim() : null
    };

    let authUserId = userRow.auth_user_id ? String(userRow.auth_user_id) : null;
    let authSyncOk = false;
    let authSyncErr = null;

    if (authUserId) {
        const { error } = await supabase.auth.admin.updateUserById(authUserId, {
            password: authPasswordNueva,
            app_metadata: appMetadata
        });
        authSyncOk = !error;
        if (error) authSyncErr = safeErrMsg(error);
    }

    if (!authSyncOk) {
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
            email,
            password: authPasswordNueva,
            email_confirm: true,
            app_metadata: appMetadata
        });

        if (!createErr) {
            authUserId = created && (created.user ? created.user.id : created.id) || authUserId;
            authSyncOk = true;
        } else {
            authSyncErr = safeErrMsg(createErr);
            const msg = String(createErr.message || '').toLowerCase();
            if (
                msg.includes('already been registered') ||
                msg.includes('already registered') ||
                (msg.includes('already') && msg.includes('register'))
            ) {
                const existingId = await findAuthUserIdByEmail(supabase, email);
                if (existingId) {
                    const { error: updExistingErr } = await supabase.auth.admin.updateUserById(existingId, {
                        password: authPasswordNueva,
                        app_metadata: appMetadata
                    });
                    if (!updExistingErr) {
                        authUserId = existingId;
                        authSyncOk = true;
                        authSyncErr = null;
                    } else {
                        authSyncErr = safeErrMsg(updExistingErr);
                    }
                } else {
                    authSyncErr = authSyncErr || 'No se pudo localizar usuario auth existente por email';
                }
            }
        }
    }

    if (!authSyncOk) {
        // Rollback para evitar inconsistencia: sin Auth sync, no persistimos cambio en BD.
        await supabase
            .from('usuarios')
            .update({ password_hash: oldHash, fecha_actualizacion: new Date().toISOString() })
            .eq('id', userRow.id);
        res.status(500).json({
            success: false,
            message: 'No se pudo sincronizar la contrasena en Auth; cambio revertido',
            detail: authSyncErr
        });
        return;
    }

    if (authUserId && authUserId !== userRow.auth_user_id) {
        await supabase.from('usuarios').update({ auth_user_id: authUserId }).eq('id', userRow.id);
    }

    res.status(200).json({ success: true, message: 'Contrasena actualizada correctamente' });
};

