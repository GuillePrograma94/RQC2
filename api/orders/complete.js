/**
 * Marca un pedido de venta como completado por codigo_qr (6 digitos).
 *
 * POST /api/orders/complete
 * Body JSON: { "codigo_qr": "123456" }
 *
 * Autenticacion obligatoria (ORDER_COMPLETE_API_KEY en Vercel):
 * - Authorization: Bearer <clave>
 * - X-Api-Key: <clave>
 *
 * Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORDER_COMPLETE_API_KEY
 */

const { createClient } = require('@supabase/supabase-js');
const {
    parseRequestBody,
    validateOrderCompleteApiKey,
    normalizeCodigoQr,
    markOrderCompleteByCodigoQr
} = require('../../lib/order-complete-api');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({
            success: false,
            message: 'Metodo no permitido. Use POST con body JSON { "codigo_qr": "123456" }'
        });
        return;
    }

    const body = parseRequestBody(req);
    const auth = validateOrderCompleteApiKey(req);
    if (!auth.ok) {
        res.status(auth.status || 401).json({ success: false, message: auth.message });
        return;
    }

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl || !supabaseKey) {
        res.status(500).json({
            success: false,
            message: 'Supabase no configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'
        });
        return;
    }

    const codigoQrRaw = body.codigo_qr != null ? body.codigo_qr : body.codigoQr;
    const codigoQr = normalizeCodigoQr(codigoQrRaw);
    if (!codigoQr) {
        res.status(400).json({
            success: false,
            message: 'codigo_qr invalido: debe ser exactamente 6 digitos'
        });
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = await markOrderCompleteByCodigoQr(supabase, codigoQr);

    if (!result.success) {
        res.status(result.status || 400).json({
            success: false,
            message: result.message || 'No se pudo completar el pedido',
            codigo_qr: codigoQr
        });
        return;
    }

    const carrito = result.carrito || {};
    res.status(200).json({
        success: true,
        completed: !result.already_completed,
        already_completed: !!result.already_completed,
        codigo_qr: codigoQr,
        carrito_id: carrito.id != null ? carrito.id : null,
        estado: carrito.estado || 'completado',
        estado_procesamiento: carrito.estado_procesamiento || 'completado',
        tipo_pedido: carrito.tipo_pedido || null,
        almacen_destino: carrito.almacen_destino || null,
        pedido_erp: carrito.pedido_erp || null
    });
};
