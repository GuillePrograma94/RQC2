/**
 * Plantilla y envio de email de confirmacion de pedido remoto.
 * Proveedor: Resend (https://resend.com) via REST.
 */

function safeText(value) {
    if (value == null) return '';
    return String(value).trim();
}

function escapeHtml(value) {
    return safeText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isValidEmail(value) {
    const email = safeText(value);
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatCurrency(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function formatDateSpain(isoDate) {
    if (!isoDate) return '';
    try {
        return new Date(isoDate).toLocaleString('es-ES', {
            timeZone: 'Europe/Madrid',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (_) {
        return safeText(isoDate);
    }
}

function buildProductRowsHtml(productos) {
    if (!Array.isArray(productos) || productos.length === 0) {
        return '<tr><td colspan="4" style="padding:12px;color:#64748b;">Sin lineas de producto</td></tr>';
    }
    return productos.map(function (p) {
        const cantidad = Number(p.cantidad || 0);
        const precio = Number(p.precio_unitario != null ? p.precio_unitario : p.pvp || 0);
        const subtotal = cantidad * precio;
        return (
            '<tr>' +
            '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace;">' + escapeHtml(p.codigo_producto || p.codigo || '-') + '</td>' +
            '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;">' + escapeHtml(p.descripcion_producto || p.descripcion || '') + '</td>' +
            '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:center;">' + cantidad + '</td>' +
            '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">' + formatCurrency(subtotal) + '</td>' +
            '</tr>'
        );
    }).join('');
}

function buildOrderConfirmationHtml(data) {
    const totalSinIva = Number(data.total_importe || 0);
    const totalConIva = totalSinIva * 1.21;
    const empresaNombre = safeText(data.empresa_razon_social) || 'BATMAR';
    const clienteNombre = safeText(data.cliente_nombre) || 'Cliente';
    const almacen = safeText(data.almacen_destino) || '-';
    const codigoQr = safeText(data.codigo_qr) || '-';
    const pedidoErp = safeText(data.pedido_erp);
    const observaciones = safeText(data.observaciones);
    const operario = safeText(data.nombre_operario);
    const fecha = formatDateSpain(data.fecha_creacion);
    const productosHtml = buildProductRowsHtml(data.productos || []);

    let observacionesBlock = '';
    if (observaciones) {
        observacionesBlock =
            '<div style="margin:16px 0;padding:12px 14px;background:#f8fafc;border-left:4px solid #1e3a5f;border-radius:4px;">' +
            '<strong style="color:#1e3a5f;">Observaciones</strong><br>' +
            '<span style="white-space:pre-wrap;color:#334155;">' + escapeHtml(observaciones) + '</span>' +
            '</div>';
    }

    let operarioBlock = '';
    if (operario) {
        operarioBlock =
            '<p style="margin:8px 0 0;color:#64748b;font-size:14px;">Pedido registrado por operario: ' + escapeHtml(operario) + '</p>';
    }

    const pedidoErpBlock = pedidoErp
        ? '<p style="margin:4px 0;"><strong>Pedido ERP:</strong> ' + escapeHtml(pedidoErp) + '</p>'
        : '';

    return (
        '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">' +
        '<div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.08);">' +
        '<div style="background:#1e3a5f;color:#ffffff;padding:20px 24px;">' +
        '<h1 style="margin:0;font-size:20px;">Confirmacion de pedido</h1>' +
        '<p style="margin:6px 0 0;font-size:14px;opacity:0.9;">' + escapeHtml(empresaNombre) + '</p>' +
        '</div>' +
        '<div style="padding:24px;">' +
        '<p style="margin:0 0 16px;font-size:16px;">' + getHtmlGreeting(clienteNombre) + '</p>' +
        '<p style="margin:0 0 16px;color:#334155;">Hemos recibido tu pedido correctamente. Resumen:</p>' +
        '<div style="background:#f8fafc;border-radius:6px;padding:16px;margin-bottom:20px;">' +
        '<p style="margin:4px 0;"><strong>Cliente:</strong> ' + escapeHtml(clienteNombre) + '</p>' +
        '<p style="margin:4px 0;"><strong>Almacen destino:</strong> ' + escapeHtml(almacen) + '</p>' +
        '<p style="margin:4px 0;"><strong>Fecha:</strong> ' + escapeHtml(fecha) + '</p>' +
        '<p style="margin:4px 0;"><strong>Codigo pedido:</strong> ' + escapeHtml(codigoQr) + '</p>' +
        pedidoErpBlock +
        operarioBlock +
        '</div>' +
        observacionesBlock +
        '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:14px;">' +
        '<thead><tr style="background:#e8eef5;">' +
        '<th style="padding:10px;text-align:left;color:#1e3a5f;">Codigo</th>' +
        '<th style="padding:10px;text-align:left;color:#1e3a5f;">Descripcion</th>' +
        '<th style="padding:10px;text-align:center;color:#1e3a5f;">Uds.</th>' +
        '<th style="padding:10px;text-align:right;color:#1e3a5f;">Importe</th>' +
        '</tr></thead>' +
        '<tbody>' + productosHtml + '</tbody>' +
        '</table>' +
        '<div style="margin-top:20px;padding-top:16px;border-top:2px solid #e2e8f0;text-align:right;">' +
        '<p style="margin:4px 0;color:#64748b;">Base imponible: ' + formatCurrency(totalSinIva) + '</p>' +
        '<p style="margin:4px 0;font-size:18px;font-weight:bold;color:#1e3a5f;">Total (IVA incl. 21%): ' + formatCurrency(totalConIva) + '</p>' +
        '<p style="margin:8px 0 0;font-size:13px;color:#64748b;">' +
        (Number(data.total_productos || 0)) + ' unidad(es) en total' +
        '</p>' +
        '</div>' +
        '<p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.5;">' +
        'Este correo es una confirmacion automatica. Te avisaremos cuando el pedido este listo para recoger o en reparto segun el almacen seleccionado.' +
        '</p>' +
        '</div></div></body></html>'
    );
}

function getHtmlGreeting(clienteNombre) {
    return 'Hola <strong>' + escapeHtml(clienteNombre) + '</strong>,';
}

function buildErpFailureAdminHtml(data) {
    const empresaNombre = safeText(data.empresa_razon_social) || 'BATMAR';
    const clienteNombre = safeText(data.cliente_nombre) || 'Cliente';
    const almacen = safeText(data.almacen_destino) || '-';
    const codigoQr = safeText(data.codigo_qr) || '-';
    const carritoId = safeText(data.carrito_id);
    const motivo = safeText(data.motivo) || 'pendiente_erp';
    const motivoLabel = motivo === 'error_erp'
        ? 'Error de validacion / rechazo del ERP'
        : 'Pendiente de envio al ERP (sin conexion o fallo temporal)';
    const fecha = formatDateSpain(data.fecha_creacion);
    const observaciones = safeText(data.observaciones);
    const totalConIva = Number(data.total_importe || 0) * 1.21;
    const productosHtml = buildProductRowsHtml(data.productos || []);

    let observacionesBlock = '';
    if (observaciones) {
        observacionesBlock =
            '<div style="margin:16px 0;padding:12px 14px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;">' +
            '<strong style="color:#991b1b;">Observaciones del pedido</strong><br>' +
            '<span style="white-space:pre-wrap;color:#334155;">' + escapeHtml(observaciones) + '</span>' +
            '</div>';
    }

    return (
        '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">' +
        '<div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.08);">' +
        '<div style="background:#991b1b;color:#ffffff;padding:20px 24px;">' +
        '<h1 style="margin:0;font-size:20px;">Pedido NO enviado al ERP</h1>' +
        '<p style="margin:6px 0 0;font-size:14px;opacity:0.9;">' + escapeHtml(empresaNombre) + '</p>' +
        '</div>' +
        '<div style="padding:24px;">' +
        '<p style="margin:0 0 16px;color:#334155;">Un pedido remoto se ha guardado en la app pero <strong>no ha llegado al ERP</strong>. Revisa el panel de control (Pedidos pendientes de ERP) en scan_client_mobile.</p>' +
        '<div style="background:#fef2f2;border-radius:6px;padding:16px;margin-bottom:20px;">' +
        '<p style="margin:4px 0;"><strong>Motivo:</strong> ' + escapeHtml(motivoLabel) + '</p>' +
        '<p style="margin:4px 0;"><strong>Estado:</strong> ' + escapeHtml(motivo) + '</p>' +
        '<p style="margin:4px 0;"><strong>Carrito ID:</strong> ' + escapeHtml(carritoId) + '</p>' +
        '<p style="margin:4px 0;"><strong>Cliente:</strong> ' + escapeHtml(clienteNombre) + '</p>' +
        '<p style="margin:4px 0;"><strong>Almacen:</strong> ' + escapeHtml(almacen) + '</p>' +
        '<p style="margin:4px 0;"><strong>Fecha:</strong> ' + escapeHtml(fecha) + '</p>' +
        '<p style="margin:4px 0;"><strong>Codigo pedido:</strong> ' + escapeHtml(codigoQr) + '</p>' +
        '<p style="margin:4px 0;"><strong>Total (IVA incl.):</strong> ' + formatCurrency(totalConIva) + '</p>' +
        '</div>' +
        observacionesBlock +
        '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:14px;">' +
        '<thead><tr style="background:#fee2e2;">' +
        '<th style="padding:10px;text-align:left;color:#991b1b;">Codigo</th>' +
        '<th style="padding:10px;text-align:left;color:#991b1b;">Descripcion</th>' +
        '<th style="padding:10px;text-align:center;color:#991b1b;">Uds.</th>' +
        '<th style="padding:10px;text-align:right;color:#991b1b;">Importe</th>' +
        '</tr></thead>' +
        '<tbody>' + productosHtml + '</tbody>' +
        '</table>' +
        '</div></div></body></html>'
    );
}

function buildFromAddress(empresa) {
    const email = safeText(empresa && empresa.email) || safeText(empresa && empresa.smtp_user);
    const nombre = safeText(empresa && empresa.razon_social) || 'Pedidos BATMAR';

    if (isSmtpConfigured(empresa) && isValidEmail(email)) {
        return nombre + ' <' + email + '>';
    }

    const envFrom = safeText(process.env.ORDER_EMAIL_FROM);
    if (envFrom) return envFrom;

    if (isValidEmail(email)) {
        return nombre + ' <' + email + '>';
    }
    return null;
}

/**
 * Reply-To: email_respuesta del almacen > ORDER_EMAIL_REPLY_TO > override > email empresa.
 */
function resolveReplyTo(empresa, overrideReplyTo) {
    const fromAlmacen = safeText(empresa && empresa.email_respuesta);
    if (isValidEmail(fromAlmacen)) return fromAlmacen;

    const fromEnv = safeText(process.env.ORDER_EMAIL_REPLY_TO);
    if (isValidEmail(fromEnv)) return fromEnv;

    const fromOverride = safeText(overrideReplyTo);
    if (isValidEmail(fromOverride)) return fromOverride;

    const fromEmail = safeText(empresa && empresa.email);
    if (isValidEmail(fromEmail)) return fromEmail;

    return null;
}

function isSmtpConfigured(empresa) {
    if (!empresa || empresa.smtp_enabled !== true) return false;
    return !!(safeText(empresa.smtp_host) && safeText(empresa.smtp_user) && safeText(empresa.smtp_password));
}

async function sendViaSmtp(empresa, options) {
    const nodemailer = require('nodemailer');
    const portRaw = parseInt(String(empresa.smtp_port || 587), 10);
    const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587;
    const secure = empresa.smtp_secure === true || port === 465;

    const transporter = nodemailer.createTransport({
        host: safeText(empresa.smtp_host),
        port: port,
        secure: secure,
        auth: {
            user: safeText(empresa.smtp_user),
            pass: safeText(empresa.smtp_password)
        }
    });

    const mail = {
        from: options.from,
        to: options.to,
        subject: options.subject,
        html: options.html
    };

    if (Array.isArray(options.cc) && options.cc.length > 0) {
        mail.cc = options.cc.join(', ');
    }

    const replyTo = resolveReplyTo(empresa, options.replyTo);
    if (replyTo) {
        mail.replyTo = replyTo;
    }

    const info = await transporter.sendMail(mail);
    return { id: info && info.messageId ? info.messageId : null, provider: 'smtp' };
}

async function sendViaResend(options) {
    const apiKey = safeText(process.env.RESEND_API_KEY);
    if (!apiKey) {
        throw new Error('RESEND_API_KEY no configurada en Vercel');
    }

    const payload = {
        from: options.from,
        to: options.to,
        subject: options.subject,
        html: options.html
    };

    if (Array.isArray(options.cc) && options.cc.length > 0) {
        payload.cc = options.cc;
    }

    const replyTo = resolveReplyTo(null, options.replyTo);
    if (replyTo) {
        payload.reply_to = replyTo;
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const body = await response.json().catch(function () {
        return {};
    });

    if (!response.ok) {
        const msg = body && (body.message || body.error) ? (body.message || body.error) : 'Error al enviar email';
        throw new Error(msg);
    }

    return body;
}

/**
 * Envia email de pedido: SMTP del almacen si esta configurado; si no, Resend (RESEND_API_KEY).
 */
async function sendOrderEmail(empresa, options) {
    const from = buildFromAddress(empresa);
    if (!from) {
        throw new Error('Configure SMTP en Datos de Empresa del almacen, email de empresa o ORDER_EMAIL_FROM en Vercel');
    }

    const mailOptions = Object.assign({}, options, {
        from: from,
        replyTo: resolveReplyTo(empresa, options.replyTo)
    });

    if (isSmtpConfigured(empresa)) {
        return sendViaSmtp(empresa, mailOptions);
    }
    return sendViaResend(mailOptions);
}

const EMPRESA_ORDER_EMAIL_SELECT =
    'almacen, razon_social, email, email_respuesta, telefono, smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_password, smtp_secure';

async function fetchEmpresaForOrderEmail(supabase, almacen) {
    if (!almacen) return null;
    const { data, error } = await supabase
        .from('empresas_por_almacen')
        .select(EMPRESA_ORDER_EMAIL_SELECT)
        .eq('almacen', String(almacen).trim())
        .maybeSingle();
    if (error || !data) return null;
    return data;
}

module.exports = {
    safeText,
    isValidEmail,
    buildOrderConfirmationHtml,
    buildErpFailureAdminHtml,
    resolveReplyTo,
    buildFromAddress,
    isSmtpConfigured,
    sendViaResend,
    sendViaSmtp,
    sendOrderEmail,
    fetchEmpresaForOrderEmail,
    formatDateSpain
};
