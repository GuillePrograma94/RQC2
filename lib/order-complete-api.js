/**
 * Marcar pedido como completado por codigo_qr (6 digitos).
 * Misma transicion que checkin_pc / checkout_pc: estado y estado_procesamiento = completado.
 */

function safeText(value) {
    if (value == null) return '';
    return String(value).trim();
}

function parseRequestBody(req) {
    if (!req || req.body == null) return {};
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch (_) {
            return {};
        }
    }
    return req.body;
}

function timingSafeEqual(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    try {
        const crypto = require('crypto');
        return crypto.timingSafeEqual(left, right);
    } catch (_) {
        return left.toString() === right.toString();
    }
}

/**
 * Valida ORDER_COMPLETE_API_KEY (Bearer, X-Api-Key o body api_key).
 */
function validateOrderCompleteApiKey(req, body) {
    const expected = safeText(process.env.ORDER_COMPLETE_API_KEY);
    if (!expected) {
        return { ok: false, status: 500, message: 'ORDER_COMPLETE_API_KEY no configurada en Vercel' };
    }

    const authHeader = safeText(req && req.headers && req.headers.authorization);
    let token = '';
    if (authHeader.toLowerCase().indexOf('bearer ') === 0) {
        token = authHeader.slice(7).trim();
    }
    if (!token && req && req.headers) {
        token = safeText(req.headers['x-api-key'] || req.headers['X-Api-Key']);
    }
    if (!token && body) {
        token = safeText(body.api_key != null ? body.api_key : body.apiKey);
    }

    if (!token || !timingSafeEqual(token, expected)) {
        return { ok: false, status: 401, message: 'API key invalida o ausente' };
    }
    return { ok: true };
}

function normalizeCodigoQr(value) {
    const digits = safeText(value).replace(/\D/g, '');
    if (!/^\d{6}$/.test(digits)) return null;
    return digits;
}

const COMPLETABLE_ESTADOS_PROCESAMIENTO = ['pendiente_erp', 'procesando'];

/**
 * @returns {Promise<{ success: boolean, status?: number, message?: string, carrito?: object, already_completed?: boolean }>}
 */
async function markOrderCompleteByCodigoQr(supabase, codigoQr) {
    const { data: activo, error: selectError } = await supabase
        .from('carritos_clientes')
        .select('id, codigo_qr, estado, estado_procesamiento, tipo_pedido, almacen_destino, pedido_erp, usuario_id, fecha_creacion')
        .eq('codigo_qr', codigoQr)
        .in('estado_procesamiento', COMPLETABLE_ESTADOS_PROCESAMIENTO)
        .not('estado', 'eq', 'cancelado')
        .maybeSingle();

    if (selectError) {
        return { success: false, status: 500, message: 'Error al buscar pedido' };
    }

    if (activo) {
        const { data: updated, error: updateError } = await supabase
            .from('carritos_clientes')
            .update({
                estado: 'completado',
                estado_procesamiento: 'completado'
            })
            .eq('id', activo.id)
            .eq('codigo_qr', codigoQr)
            .in('estado_procesamiento', COMPLETABLE_ESTADOS_PROCESAMIENTO)
            .select('id, codigo_qr, estado, estado_procesamiento, tipo_pedido, almacen_destino, pedido_erp')
            .maybeSingle();

        if (updateError) {
            return { success: false, status: 500, message: 'Error al actualizar pedido' };
        }
        if (updated) {
            return { success: true, carrito: updated, already_completed: false };
        }
    }

    const { data: yaCompletado, error: yaError } = await supabase
        .from('carritos_clientes')
        .select('id, codigo_qr, estado, estado_procesamiento, tipo_pedido, almacen_destino, pedido_erp')
        .eq('codigo_qr', codigoQr)
        .eq('estado', 'completado')
        .eq('estado_procesamiento', 'completado')
        .maybeSingle();

    if (yaError) {
        return { success: false, status: 500, message: 'Error al verificar pedido' };
    }
    if (yaCompletado) {
        return { success: true, carrito: yaCompletado, already_completed: true };
    }

    return {
        success: false,
        status: 404,
        message: 'Pedido no encontrado o no se puede completar (debe estar en pendiente_erp o procesando)'
    };
}

module.exports = {
    safeText,
    parseRequestBody,
    validateOrderCompleteApiKey,
    normalizeCodigoQr,
    markOrderCompleteByCodigoQr,
    COMPLETABLE_ESTADOS_PROCESAMIENTO
};
