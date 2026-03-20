/**
 * POST /api/auth/login
 * Verifica credenciales con public.usuarios y crea/actualiza el usuario en Supabase Auth.
 * Devuelve perfil + email para que el cliente haga signInWithPassword y obtenga JWT con app_metadata.usuario_id.
 *
 * Body: { codigo_usuario: string, password: string }
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

function authEmailComercial(numero) {
    const safe = String(numero).trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    return `comercial_${safe}@labels.auth`;
}

function logError(label, err) {
    const msg = err && (err.message || err.code || String(err));
    console.error('[login] ' + label + ':', msg || err);
}

function safeErrorDetail(err) {
    if (!err) return null;
    const m = err.message || err.code || (typeof err === 'string' ? err : null);
    return m ? String(m).substring(0, 200) : null;
}

async function findAuthUserIdByEmail(supabase, email) {
    try {
        const target = String(email || '').trim().toLowerCase();
        if (!target) return null;
        const perPage = 1000;
        const maxPages = 25; // 25k usuarios auth como techo de seguridad
        for (let page = 1; page <= maxPages; page++) {
            const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
            if (error) {
                logError('auth.admin.listUsers', error);
                return null;
            }
            const users = data && Array.isArray(data.users) ? data.users : [];
            const existing = users.find(u => (u.email || '').toString().trim().toLowerCase() === target);
            if (existing && existing.id) return existing.id;
            if (users.length < perPage) break;
        }
        return null;
    } catch (e) {
        logError('findAuthUserIdByEmail', e);
        return null;
    }
}

async function syncAuthUserCredentials(supabase, options) {
    const email = options && options.email ? String(options.email).trim() : '';
    const password = options && options.password ? String(options.password) : '';
    const appMetadata = (options && options.appMetadata) || {};
    const initialAuthUserId = options && options.authUserId ? String(options.authUserId) : null;
    const onLinked = options && typeof options.onLinked === 'function' ? options.onLinked : null;
    const label = options && options.label ? String(options.label) : 'auth sync';

    if (!email || !password) {
        return { ok: false, message: 'Email o password vacios en sincronizacion de auth' };
    }

    async function linkUserId(uid) {
        if (!uid || !onLinked) return;
        try {
            await onLinked(uid);
        } catch (e) {
            logError(label + ' onLinked', e);
        }
    }

    if (initialAuthUserId) {
        const { error: updateError } = await supabase.auth.admin.updateUserById(initialAuthUserId, {
            password,
            app_metadata: appMetadata
        });
        if (!updateError) {
            await linkUserId(initialAuthUserId);
            return { ok: true, authUserId: initialAuthUserId };
        }
        logError(label + ' updateUserById inicial', updateError);
    }

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata
    });

    if (!createError) {
        const uid = created && (created.user ? created.user.id : created.id);
        if (uid) await linkUserId(uid);
        return { ok: true, authUserId: uid || null };
    }

    const createMsg = createError && createError.message ? String(createError.message) : '';
    const alreadyRegistered = createMsg.toLowerCase().includes('already been registered');
    if (!alreadyRegistered) {
        logError(label + ' createUser', createError);
        return { ok: false, message: createMsg || 'Error al crear usuario auth' };
    }

    const existingId = await findAuthUserIdByEmail(supabase, email);
    if (!existingId) {
        return { ok: false, message: 'No se pudo localizar usuario auth existente por email' };
    }

    const { error: updateExistingError } = await supabase.auth.admin.updateUserById(existingId, {
        password,
        app_metadata: appMetadata
    });
    if (updateExistingError) {
        logError(label + ' updateUserById existente', updateExistingError);
        return {
            ok: false,
            message: (updateExistingError && updateExistingError.message) || 'No se pudo actualizar password en auth'
        };
    }

    await linkUserId(existingId);
    return { ok: true, authUserId: existingId };
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
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch (_) {
        res.status(400).json({ success: false, message: 'Body JSON invalido' });
        return;
    }

    const codigoUsuario = body.codigo_usuario;
    const password = body.password;
    if (!codigoUsuario || !password) {
        res.status(400).json({ success: false, message: 'Faltan codigo_usuario o password' });
        return;
    }

    const supabase = createClient(url, serviceKey);
    const passwordHash = hashPassword(password);

    const { data: rpcData, error: rpcError } = await supabase.rpc('verificar_login_usuario', {
        p_codigo_usuario: codigoUsuario.trim(),
        p_password_hash: passwordHash
    });

    if (rpcError) {
        logError('verificar_login_usuario RPC', rpcError);
        res.status(500).json({
            success: false,
            message: 'Error al verificar credenciales',
            detail: safeErrorDetail(rpcError)
        });
        return;
    }

    let row = Array.isArray(rpcData) && rpcData.length > 0 ? rpcData[0] : null;

    if (!row || !row.success || row.user_id == null) {
        // Intentar login como comercial (numero + password)
        const { data: comData, error: comError } = await supabase.rpc('verificar_login_comercial', {
            p_numero: String(codigoUsuario).trim(),
            p_password_hash: passwordHash
        });
        if (comError || !comData || !Array.isArray(comData) || comData.length === 0 || !comData[0].success) {
            res.status(401).json({ success: false, message: 'Usuario o contrasena incorrectos' });
            return;
        }
        const com = comData[0];
        const emailComercial = authEmailComercial(com.numero);
        const { data: comRow, error: comAuthError } = await supabase
            .from('usuarios_comerciales')
            .select('auth_user_id')
            .eq('id', com.comercial_id)
            .single();

        if (comAuthError && comAuthError.code !== 'PGRST116') {
            logError('usuarios_comerciales select', comAuthError);
            res.status(500).json({
                success: false,
                message: 'Error al obtener comercial',
                detail: safeErrorDetail(comAuthError)
            });
            return;
        }
        const authUserIdCom = comRow && comRow.auth_user_id ? comRow.auth_user_id : null;
        const syncCom = await syncAuthUserCredentials(supabase, {
            email: emailComercial,
            password,
            appMetadata: { comercial_id: com.comercial_id, es_comercial: true },
            authUserId: authUserIdCom,
            label: 'comercial auth sync',
            onLinked: async function (uid) {
                await supabase.from('usuarios_comerciales')
                    .update({ auth_user_id: uid })
                    .eq('id', com.comercial_id);
            }
        });
        if (!syncCom.ok) {
            res.status(500).json({
                success: false,
                message: 'Error al sincronizar sesion de auth',
                detail: String(syncCom.message || '').substring(0, 200) || null
            });
            return;
        }
        return res.status(200).json({
            success: true,
            email: emailComercial,
            user_id: null,
            user_name: com.nombre || '',
            codigo_usuario: String(com.numero),
            grupo_cliente: null,
            almacen_habitual: null,
            es_operario: false,
            nombre_operario: null,
            codigo_usuario_titular: null,
            nombre_titular: null,
            tipo: 'COMERCIAL',
            es_comercial: true,
            es_dependiente: false,
            almacen_tienda: null,
            comercial_id: com.comercial_id,
            comercial_numero: com.numero
        });
    }

    const userId = row.user_id;
    const email = authEmail(codigoUsuario);
    const esOperario = !!row.es_operario;

    if (esOperario) {
        // Operario: crear/actualizar usuario de Auth propio (email 84845-01@labels.auth) y guardar en usuarios_operarios
        const tipoTitular = (row.tipo && String(row.tipo).toUpperCase()) || 'CLIENTE';
        const esAdministrador = tipoTitular === 'ADMINISTRADOR';

        const parts = codigoUsuario.trim().split('-');
        const codigoOperario = parts.length > 1 ? String(parts[1]).trim() : null;
        if (!codigoOperario) {
            res.status(500).json({ success: false, message: 'Codigo de operario invalido' });
            return;
        }

        const { data: opRow, error: opError } = await supabase
            .from('usuarios_operarios')
            .select('auth_user_id')
            .eq('usuario_id', userId)
            .eq('codigo_operario', codigoOperario)
            .maybeSingle();

        if (opError) {
            logError('usuarios_operarios select', opError);
            res.status(500).json({
                success: false,
                message: 'Error al obtener operario',
                detail: safeErrorDetail(opError)
            });
            return;
        }

        const authUserId = opRow && opRow.auth_user_id ? opRow.auth_user_id : null;

        const syncOperario = await syncAuthUserCredentials(supabase, {
            email,
            password,
            appMetadata: { usuario_id: userId, es_operario: true, es_administrador: esAdministrador },
            authUserId: authUserId,
            label: 'operario auth sync',
            onLinked: async function (uid) {
                await supabase.from('usuarios_operarios')
                    .update({ auth_user_id: uid })
                    .eq('usuario_id', userId)
                    .eq('codigo_operario', codigoOperario);
            }
        });
        if (!syncOperario.ok) {
            res.status(500).json({
                success: false,
                message: 'Error al sincronizar sesion de auth',
                detail: String(syncOperario.message || '').substring(0, 200) || null
            });
            return;
        }
    } else {
        // Titular: crear/actualizar usuario de Auth en usuarios.auth_user_id (comportamiento original)
        const tipo = (row.tipo && String(row.tipo).toUpperCase()) || 'CLIENTE';
        const esAdministrador = tipo === 'ADMINISTRADOR';
        const esAdministracion = tipo === 'ADMINISTRACION';

        const { data: userRow, error: userError } = await supabase
            .from('usuarios')
            .select('auth_user_id')
            .eq('id', userId)
            .single();

        if (userError && userError.code !== 'PGRST116') {
            logError('usuarios select auth_user_id', userError);
            res.status(500).json({
                success: false,
                message: 'Error al obtener usuario',
                detail: safeErrorDetail(userError)
            });
            return;
        }

        const authUserId = userRow && userRow.auth_user_id ? userRow.auth_user_id : null;

        const syncTitular = await syncAuthUserCredentials(supabase, {
            email,
            password,
            appMetadata: { usuario_id: userId, es_administrador: esAdministrador, es_administracion: esAdministracion },
            authUserId: authUserId,
            label: 'titular auth sync',
            onLinked: async function (uid) {
                await supabase.from('usuarios').update({ auth_user_id: uid }).eq('id', userId);
            }
        });
        if (!syncTitular.ok) {
            res.status(500).json({
                success: false,
                message: 'Error al sincronizar sesion de auth',
                detail: String(syncTitular.message || '').substring(0, 200) || null
            });
            return;
        }
    }

    const tipo = (row.tipo && String(row.tipo).toUpperCase()) || 'CLIENTE';
    const esDependiente = tipo === 'DEPENDIENTE';

    res.status(200).json({
        success: true,
        email,
        user_id: userId,
        user_name: row.user_name || '',
        codigo_usuario: codigoUsuario.trim(),
        grupo_cliente: row.grupo_cliente ?? null,
        almacen_habitual: row.almacen_habitual ?? null,
        es_operario: !!row.es_operario,
        nombre_operario: row.nombre_operario || null,
        codigo_usuario_titular: row.codigo_usuario_titular || null,
        nombre_titular: row.nombre_titular || null,
        tipo: tipo,
        es_comercial: tipo === 'COMERCIAL',
        es_dependiente: esDependiente,
        almacen_tienda: row.almacen_tienda || null,
        es_administrador: tipo === 'ADMINISTRADOR',
        es_administracion: tipo === 'ADMINISTRACION'
    });
};
