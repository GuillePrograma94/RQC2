/**
 * Serverless: alerta por email a usuarios tipo ADMINISTRADOR (no ADMINISTRACION)
 * cuando un pedido remoto no se ha enviado al ERP.
 *
 * POST { carrito_id, motivo?: 'pendiente_erp' | 'error_erp' }
 */

const { createClient } = require('@supabase/supabase-js');
const {
    safeText,
    isValidEmail,
    buildErpFailureAdminHtml,
    buildFromAddress,
    sendOrderEmail,
    fetchEmpresaForOrderEmail
} = require('../../lib/order-email');

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

async function fetchAdministradorEmails(supabase) {
    const { data, error } = await supabase
        .from('usuarios')
        .select('email, nombre')
        .eq('tipo', 'ADMINISTRADOR')
        .eq('activo', true);

    if (error || !Array.isArray(data)) return [];

    const seen = new Set();
    const emails = [];
    data.forEach(function (row) {
        const email = safeText(row && row.email).toLowerCase();
        if (isValidEmail(email) && !seen.has(email)) {
            seen.add(email);
            emails.push(safeText(row.email));
        }
    });
    return emails;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ success: false, message: 'Metodo no permitido' });
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

    const body = parseRequestBody(req);
    const carritoIdRaw = body.carrito_id != null ? body.carrito_id : body.carritoId;
    const carritoId = parseInt(String(carritoIdRaw), 10);
    if (!Number.isFinite(carritoId) || carritoId <= 0) {
        res.status(400).json({ success: false, message: 'carrito_id invalido' });
        return;
    }

    const motivoBody = safeText(body.motivo);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: carrito, error: carritoError } = await supabase
        .from('carritos_clientes')
        .select(
            'id, usuario_id, almacen_destino, codigo_qr, observaciones, ' +
            'total_importe, total_productos, fecha_creacion, tipo_pedido, ' +
            'estado_procesamiento, email_alerta_admin_erp_enviado_at'
        )
        .eq('id', carritoId)
        .maybeSingle();

    if (carritoError) {
        res.status(500).json({ success: false, message: 'Error al leer carrito' });
        return;
    }
    if (!carrito) {
        res.status(404).json({ success: false, message: 'Carrito no encontrado' });
        return;
    }

    if (carrito.tipo_pedido && carrito.tipo_pedido !== 'remoto') {
        res.status(200).json({ success: true, skipped: true, reason: 'not_remote_order' });
        return;
    }

    if (carrito.email_alerta_admin_erp_enviado_at) {
        res.status(200).json({ success: true, skipped: true, reason: 'already_sent' });
        return;
    }

    const estadoProc = safeText(carrito.estado_procesamiento);
    const motivo = motivoBody || estadoProc;
    if (motivo !== 'pendiente_erp' && motivo !== 'error_erp') {
        if (estadoProc !== 'pendiente_erp' && estadoProc !== 'error_erp') {
            res.status(200).json({ success: true, skipped: true, reason: 'erp_not_failed' });
            return;
        }
    }

    const adminEmails = await fetchAdministradorEmails(supabase);
    if (adminEmails.length === 0) {
        res.status(200).json({
            success: true,
            skipped: true,
            reason: 'no_administrador_emails',
            message: 'Ningun usuario ADMINISTRADOR activo tiene email configurado'
        });
        return;
    }

    const { data: usuario, error: usuarioError } = await supabase
        .from('usuarios')
        .select('nombre')
        .eq('id', carrito.usuario_id)
        .maybeSingle();

    if (usuarioError) {
        res.status(500).json({ success: false, message: 'No se pudo leer el cliente del pedido' });
        return;
    }

    const empresa = await fetchEmpresaForOrderEmail(supabase, carrito.almacen_destino);
    if (!buildFromAddress(empresa)) {
        res.status(500).json({
            success: false,
            message: 'Configure SMTP en Datos de Empresa del almacen, email de empresa o ORDER_EMAIL_FROM en Vercel'
        });
        return;
    }

    const { data: productos, error: productosError } = await supabase
        .from('productos_carrito')
        .select('codigo_producto, descripcion_producto, cantidad, precio_unitario')
        .eq('carrito_id', carritoId)
        .order('id', { ascending: true });

    if (productosError) {
        res.status(500).json({ success: false, message: 'Error al leer lineas del pedido' });
        return;
    }

    const motivoFinal = motivo === 'error_erp' ? 'error_erp' : 'pendiente_erp';
    const codigoLabel = safeText(carrito.codigo_qr) || String(carritoId);
    const html = buildErpFailureAdminHtml({
        carrito_id: carritoId,
        cliente_nombre: usuario ? usuario.nombre : '',
        almacen_destino: carrito.almacen_destino,
        codigo_qr: carrito.codigo_qr,
        observaciones: carrito.observaciones,
        total_importe: carrito.total_importe,
        fecha_creacion: carrito.fecha_creacion,
        motivo: motivoFinal,
        empresa_razon_social: empresa ? empresa.razon_social : null,
        productos: productos || []
    });

    const subject = '[ALERTA ERP] Pedido ' + codigoLabel + ' no enviado al ERP';

    try {
        const sendResult = await sendOrderEmail(empresa, {
            to: adminEmails,
            subject: subject,
            html: html,
            replyTo: empresa ? empresa.email_respuesta : null
        });
        const sentAt = new Date().toISOString();
        await supabase
            .from('carritos_clientes')
            .update({ email_alerta_admin_erp_enviado_at: sentAt })
            .eq('id', carritoId);

        res.status(200).json({
            success: true,
            sent: true,
            to: adminEmails,
            motivo: motivoFinal,
            provider_id: sendResult && sendResult.id ? sendResult.id : null
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err && err.message ? err.message : 'Error al enviar email'
        });
    }
};
