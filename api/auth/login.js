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
        res.status(500).json({ success: false, message: 'Error al verificar credenciales' });
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
            res.status(500).json({ success: false, message: 'Error al obtener comercial' });
            return;
        }
        const authUserIdCom = comRow && comRow.auth_user_id ? comRow.auth_user_id : null;
        if (!authUserIdCom) {
            const { data: created, error: createError } = await supabase.auth.admin.createUser({
                email: emailComercial,
                password,
                email_confirm: true,
                app_metadata: { comercial_id: com.comercial_id, es_comercial: true }
            });
            if (createError) {
                if (createError.message && createError.message.includes('already been registered')) {
                    const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
                    const existing = listData?.users?.find(u => u.email === emailComercial);
                    if (existing) {
                        await supabase.from('usuarios_comerciales')
                            .update({ auth_user_id: existing.id })
                            .eq('id', com.comercial_id);
                    }
                } else {
                    res.status(500).json({ success: false, message: 'Error al crear sesion de auth' });
                    return;
                }
            } else if (created && (created.user ? created.user.id : created.id)) {
                const uid = created.user ? created.user.id : created.id;
                await supabase.from('usuarios_comerciales')
                    .update({ auth_user_id: uid })
                    .eq('id', com.comercial_id);
            }
        } else {
            try {
                await supabase.auth.admin.updateUserById(authUserIdCom, { password });
            } catch (_) {}
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
            es_comercial: true,
            comercial_id: com.comercial_id,
            comercial_numero: com.numero
        });
    }

    const userId = row.user_id;
    const email = authEmail(codigoUsuario);
    const esOperario = !!row.es_operario;

    if (esOperario) {
        // Operario: crear/actualizar usuario de Auth propio (email 84845-01@labels.auth) y guardar en usuarios_operarios
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
            res.status(500).json({ success: false, message: 'Error al obtener operario' });
            return;
        }

        const authUserId = opRow && opRow.auth_user_id ? opRow.auth_user_id : null;

        if (!authUserId) {
            const { data: created, error: createError } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                app_metadata: { usuario_id: userId, es_operario: true }
            });

            if (createError) {
                if (createError.message && createError.message.includes('already been registered')) {
                    const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
                    const existing = listData?.users?.find(u => u.email === email);
                    if (existing) {
                        await supabase.from('usuarios_operarios')
                            .update({ auth_user_id: existing.id })
                            .eq('usuario_id', userId)
                            .eq('codigo_operario', codigoOperario);
                    }
                } else {
                    res.status(500).json({ success: false, message: 'Error al crear sesion de auth' });
                    return;
                }
            } else if (created && (created.user ? created.user.id : created.id)) {
                const uid = created.user ? created.user.id : created.id;
                await supabase.from('usuarios_operarios')
                    .update({ auth_user_id: uid })
                    .eq('usuario_id', userId)
                    .eq('codigo_operario', codigoOperario);
            }
        } else {
            try {
                await supabase.auth.admin.updateUserById(authUserId, { password });
            } catch (_) {
                // Ignorar si falla actualizar password (ej. mismo valor)
            }
        }
    } else {
        // Titular: crear/actualizar usuario de Auth en usuarios.auth_user_id (comportamiento original)
        const { data: userRow, error: userError } = await supabase
            .from('usuarios')
            .select('auth_user_id')
            .eq('id', userId)
            .single();

        if (userError && userError.code !== 'PGRST116') {
            res.status(500).json({ success: false, message: 'Error al obtener usuario' });
            return;
        }

        const authUserId = userRow && userRow.auth_user_id ? userRow.auth_user_id : null;

        if (!authUserId) {
            const { data: created, error: createError } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                app_metadata: { usuario_id: userId }
            });

            if (createError) {
                if (createError.message && createError.message.includes('already been registered')) {
                    const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
                    const existing = listData?.users?.find(u => u.email === email);
                    if (existing) {
                        await supabase.from('usuarios').update({ auth_user_id: existing.id }).eq('id', userId);
                    }
                } else {
                    res.status(500).json({ success: false, message: 'Error al crear sesion de auth' });
                    return;
                }
            } else if (created && (created.user ? created.user.id : created.id)) {
                const uid = created.user ? created.user.id : created.id;
                await supabase.from('usuarios').update({ auth_user_id: uid }).eq('id', userId);
            }
        } else {
            try {
                await supabase.auth.admin.updateUserById(authUserId, { password });
            } catch (_) {
                // Ignorar si falla actualizar password (ej. mismo valor)
            }
        }
    }

    const tipo = (row.tipo && String(row.tipo).toUpperCase()) || 'CLIENTE';

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
        es_comercial: tipo === 'COMERCIAL'
    });
};
