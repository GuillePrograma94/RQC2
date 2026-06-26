/**
 * Serverless: envia email de confirmacion de pedido remoto al cliente.
 * CC al comercial asignado si tiene email. BCC (CCO) a encargados del comercial.
 *
 * POST { carrito_id: number|string }
 *
 * Variables Vercel:
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * - RESEND_API_KEY
 * - ORDER_EMAIL_FROM (opcional, ej: "Pedidos <pedidos@tudominio.com>")
 * - ORDER_EMAIL_REPLY_TO (opcional)
 */

const { createClient } = require('@supabase/supabase-js');
const {
    safeText,
    isValidEmail,
    buildOrderConfirmationHtml,
    sendOrderEmail,
    fetchEmpresaForOrderEmail,
    describeEmailConfigIssue,
    resolveAlmacenDestinoForOrderEmail,
    fetchComercialEmailByAsignado,
    fetchEncargadosEmailsForComercial,
    buildOrderRecipientLists
} = require('../../lib/order-email');
const { resolveOrderEmailPricing } = require('../../lib/order-pricing-email');

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
        res.status(405).json({
            success: false,
            message: 'Metodo no permitido. Use POST con body JSON { "carrito_id": 123 }'
        });
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

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: carrito, error: carritoError } = await supabase
        .from('carritos_clientes')
        .select(
            'id, usuario_id, almacen_destino, codigo_qr, pedido_erp, observaciones, ' +
            'total_importe, total_productos, fecha_creacion, nombre_operario, tipo_pedido, ' +
            'estado_procesamiento, pedido_erp, email_confirmacion_enviado_at'
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

    if (carrito.email_confirmacion_enviado_at) {
        res.status(200).json({ success: true, skipped: true, reason: 'already_sent' });
        return;
    }

    if (safeText(carrito.estado_procesamiento) !== 'procesando') {
        res.status(200).json({
            success: true,
            skipped: true,
            reason: 'erp_not_success',
            message: 'El pedido no esta confirmado en ERP (estado_procesamiento debe ser procesando)'
        });
        return;
    }

    const { data: usuario, error: usuarioError } = await supabase
        .from('usuarios')
        .select('id, nombre, email, comercial_asignado, almacen_habitual, tarifa, codigo_usuario, grupo_cliente')
        .eq('id', carrito.usuario_id)
        .maybeSingle();

    if (usuarioError || !usuario) {
        res.status(500).json({ success: false, message: 'No se pudo leer el cliente del pedido' });
        return;
    }

    const clienteEmail = safeText(usuario.email);
    if (!isValidEmail(clienteEmail)) {
        res.status(200).json({
            success: true,
            skipped: true,
            reason: 'no_client_email',
            message: 'El cliente no tiene email configurado'
        });
        return;
    }

    const comercialEmail = await fetchComercialEmailByAsignado(supabase, usuario.comercial_asignado);
    const encargadoEmails = usuario.comercial_asignado != null
        ? await fetchEncargadosEmailsForComercial(supabase, usuario.comercial_asignado)
        : [];
    const recipientLists = buildOrderRecipientLists({
        clienteEmail: clienteEmail,
        comercialEmail: comercialEmail,
        encargadoEmails: encargadoEmails
    });
    const almacenResolved = resolveAlmacenDestinoForOrderEmail(carrito, usuario);
    const almacenParaEmail = almacenResolved.almacen;

    if (!safeText(carrito.almacen_destino) && almacenParaEmail) {
        await supabase
            .from('carritos_clientes')
            .update({ almacen_destino: almacenParaEmail })
            .eq('id', carritoId);
        carrito.almacen_destino = almacenParaEmail;
    }

    const empresaFetch = await fetchEmpresaForOrderEmail(supabase, almacenParaEmail);
    const configIssue = describeEmailConfigIssue(empresaFetch);
    if (configIssue) {
        res.status(500).json({
            success: false,
            message: configIssue,
            almacen_destino: safeText(carrito.almacen_destino) || null,
            almacen_resuelto: almacenParaEmail || null,
            almacen_fuente: almacenResolved.source,
            almacen_buscado: empresaFetch.almacenBuscado || null
        });
        return;
    }
    const empresa = empresaFetch.empresa;

    const { data: productos, error: productosError } = await supabase
        .from('productos_carrito')
        .select('codigo_producto, descripcion_producto, cantidad, precio_unitario')
        .eq('carrito_id', carritoId)
        .order('id', { ascending: true });

    if (productosError) {
        res.status(500).json({ success: false, message: 'Error al leer lineas del pedido' });
        return;
    }

    const pricingResolved = await resolveOrderEmailPricing(supabase, usuario, productos || []);

    const emailData = {
        cliente_nombre: usuario.nombre,
        almacen_destino: almacenParaEmail || carrito.almacen_destino,
        codigo_qr: carrito.codigo_qr,
        pedido_erp: carrito.pedido_erp,
        observaciones: carrito.observaciones,
        total_importe: pricingResolved.total_importe,
        total_productos: carrito.total_productos,
        fecha_creacion: carrito.fecha_creacion,
        nombre_operario: carrito.nombre_operario,
        empresa_razon_social: empresa ? empresa.razon_social : null,
        productos: pricingResolved.productos
    };

    const almacenLabel = safeText(almacenParaEmail) || safeText(carrito.almacen_destino) || 'BATMAR';
    const codigoLabel = safeText(carrito.codigo_qr) || String(carritoId);
    const subject = 'Confirmacion de pedido ' + codigoLabel + ' - ' + almacenLabel;
    const html = buildOrderConfirmationHtml(emailData);

    const sendOptions = {
        to: [clienteEmail],
        subject: subject,
        html: html,
        replyTo: empresa ? empresa.email_respuesta : null
    };

    if (recipientLists.cc.length > 0) {
        sendOptions.cc = recipientLists.cc;
    }
    if (recipientLists.bcc.length > 0) {
        sendOptions.bcc = recipientLists.bcc;
    }

    try {
        const sendResult = await sendOrderEmail(empresa, sendOptions);
        const sentAt = new Date().toISOString();
        await supabase
            .from('carritos_clientes')
            .update({ email_confirmacion_enviado_at: sentAt })
            .eq('id', carritoId);

        res.status(200).json({
            success: true,
            sent: true,
            to: clienteEmail,
            cc: sendOptions.cc || [],
            bcc: sendOptions.bcc || [],
            provider_id: sendResult && sendResult.id ? sendResult.id : null
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err && err.message ? err.message : 'Error al enviar email'
        });
    }
};
