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

function buildEmailHeadHtml() {
    return (
        '<meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<meta http-equiv="X-UA-Compatible" content="IE=edge">' +
        '<style type="text/css">' +
        'body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}' +
        'table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}' +
        'img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}' +
        '.email-outer{width:100%!important;max-width:100%!important;}' +
        '.email-shell{width:100%!important;max-width:640px!important;margin:0 auto!important;}' +
        '.email-body-pad{padding:20px 16px!important;}' +
        '.email-header-pad{padding:18px 16px!important;}' +
        '.email-product-card{display:block!important;width:100%!important;box-sizing:border-box!important;}' +
        '.email-word-break{word-break:break-word!important;overflow-wrap:anywhere!important;}' +
        '@media only screen and (max-width:620px){' +
        '.email-shell{width:100%!important;max-width:100%!important;border-radius:0!important;margin:0!important;}' +
        '.email-body-pad{padding:16px 12px!important;}' +
        '.email-header-pad{padding:16px 12px!important;}' +
        '.email-hide-mobile{display:none!important;max-height:0!important;overflow:hidden!important;}' +
        '.email-total{font-size:17px!important;}' +
        '}' +
        '</style>'
    );
}

/**
 * Lineas de producto en tarjetas apiladas (legible en movil; evita tablas anchas).
 */
function buildProductLinesHtml(productos) {
    if (!Array.isArray(productos) || productos.length === 0) {
        return '<p style="margin:0;padding:12px 0;color:#64748b;font-size:14px;">Sin lineas de producto</p>';
    }
    return productos.map(function (p) {
        const cantidad = Number(p.cantidad || 0);
        const precioNeto = Number(
            p.precio_neto_unitario != null ? p.precio_neto_unitario : (p.precio_unitario != null ? p.precio_unitario : p.pvp || 0)
        );
        const precioPvp = Number(
            p.pvp_unitario != null ? p.pvp_unitario : precioNeto
        );
        const subtotal = Number(p.subtotal != null ? p.subtotal : cantidad * precioNeto);
        const tieneDescuento = precioPvp > precioNeto + 0.0001;
        const codigo = escapeHtml(p.codigo_producto || p.codigo || '-');
        const descripcion = escapeHtml(p.descripcion_producto || p.descripcion || '');

        const pvpStyle = tieneDescuento
            ? 'font-size:13px;color:#94a3b8;text-align:right;vertical-align:middle;text-decoration:line-through;white-space:nowrap;'
            : 'font-size:13px;color:#64748b;text-align:right;vertical-align:middle;white-space:nowrap;';
        const netoStyle = tieneDescuento
            ? 'font-size:14px;font-weight:bold;color:#0d9488;text-align:right;vertical-align:middle;white-space:nowrap;'
            : 'font-size:14px;font-weight:bold;color:#1e3a5f;text-align:right;vertical-align:middle;white-space:nowrap;';

        return (
            '<div class="email-product-card" style="display:block;width:100%;box-sizing:border-box;margin:0 0 10px 0;padding:12px 14px;background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;">' +
            '<div style="font-family:Consolas,Monaco,monospace;font-size:13px;font-weight:bold;color:#1e3a5f;margin:0 0 6px 0;letter-spacing:0.02em;">' + codigo + '</div>' +
            '<div class="email-word-break" style="font-size:14px;line-height:1.45;color:#334155;margin:0 0 10px 0;word-break:break-word;overflow-wrap:anywhere;">' + descripcion + '</div>' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 8px 0;">' +
            '<tr>' +
            '<td style="padding:2px 0;font-size:13px;color:#64748b;vertical-align:middle;">PVP unit. (sin IVA)</td>' +
            '<td style="padding:2px 0;' + pvpStyle + '">' + formatCurrency(precioPvp) + '</td>' +
            '</tr>' +
            '<tr>' +
            '<td style="padding:2px 0;font-size:13px;color:#64748b;vertical-align:middle;">Precio neto unit.</td>' +
            '<td style="padding:2px 0;' + netoStyle + '">' + formatCurrency(precioNeto) + '</td>' +
            '</tr>' +
            '</table>' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">' +
            '<tr>' +
            '<td style="padding:8px 0 0;border-top:1px solid #e2e8f0;font-size:14px;color:#334155;vertical-align:middle;font-weight:600;">' + cantidad + ' ud.' + (cantidad !== 1 ? 's' : '') + '</td>' +
            '<td style="padding:8px 0 0;border-top:1px solid #e2e8f0;font-size:15px;font-weight:bold;color:#1e3a5f;text-align:right;vertical-align:middle;white-space:nowrap;">' +
            'Importe: ' + formatCurrency(subtotal) +
            '</td>' +
            '</tr>' +
            '</table>' +
            '</div>'
        );
    }).join('');
}

/** @deprecated Usar buildProductLinesHtml (tarjetas movil). */
function buildProductRowsHtml(productos) {
    return buildProductLinesHtml(productos);
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
    const productosHtml = buildProductLinesHtml(data.productos || []);

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
        '<!DOCTYPE html><html lang="es"><head>' + buildEmailHeadHtml() + '</head>' +
        '<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;width:100%;">' +
        '<table role="presentation" class="email-outer" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f1f5f9;">' +
        '<tr><td align="center" style="padding:12px 0;">' +
        '<div class="email-shell" style="max-width:640px;width:100%;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.08);">' +
        '<div class="email-header-pad" style="background:#1e3a5f;color:#ffffff;padding:20px 24px;">' +
        '<h1 style="margin:0;font-size:20px;line-height:1.3;">Confirmacion de pedido</h1>' +
        '<p style="margin:6px 0 0;font-size:14px;opacity:0.9;line-height:1.4;">' + escapeHtml(empresaNombre) + '</p>' +
        '</div>' +
        '<div class="email-body-pad" style="padding:24px;">' +
        '<p style="margin:0 0 16px;font-size:16px;line-height:1.45;">' + getHtmlGreeting(clienteNombre) + '</p>' +
        '<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.45;">Hemos recibido tu pedido correctamente. Resumen:</p>' +
        '<div style="background:#f8fafc;border-radius:6px;padding:14px 16px;margin-bottom:20px;">' +
        '<p class="email-word-break" style="margin:6px 0;font-size:14px;line-height:1.5;word-break:break-word;"><strong>Cliente:</strong> ' + escapeHtml(clienteNombre) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Almacen destino:</strong> ' + escapeHtml(almacen) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Fecha:</strong> ' + escapeHtml(fecha) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;word-break:break-all;"><strong>Codigo pedido:</strong> ' + escapeHtml(codigoQr) + '</p>' +
        pedidoErpBlock +
        operarioBlock +
        '</div>' +
        observacionesBlock +
        '<p style="margin:0 0 10px;font-size:15px;font-weight:bold;color:#1e3a5f;">Productos <span style="font-weight:normal;font-size:13px;color:#64748b;">(importes sin IVA)</span></p>' +
        '<div style="margin-top:4px;">' + productosHtml + '</div>' +
        '<div style="margin-top:20px;padding-top:16px;border-top:2px solid #e2e8f0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">' +
        '<tr><td style="padding:4px 0;font-size:14px;color:#64748b;text-align:right;">Base imponible</td>' +
        '<td style="padding:4px 0;font-size:14px;color:#64748b;text-align:right;width:120px;white-space:nowrap;">' + formatCurrency(totalSinIva) + '</td></tr>' +
        '<tr><td class="email-total" style="padding:8px 0 4px;font-size:18px;font-weight:bold;color:#1e3a5f;text-align:right;">Total (IVA incl. 21%)</td>' +
        '<td class="email-total" style="padding:8px 0 4px;font-size:18px;font-weight:bold;color:#1e3a5f;text-align:right;width:120px;white-space:nowrap;">' + formatCurrency(totalConIva) + '</td></tr>' +
        '<tr><td colspan="2" style="padding:8px 0 0;font-size:13px;color:#64748b;text-align:right;">' +
        (Number(data.total_productos || 0)) + ' unidad(es) en total' +
        '</td></tr>' +
        '</table>' +
        '</div>' +
        '<div style="margin:24px 0 0;padding:14px 16px;background:#f8fafc;border-radius:6px;border-left:4px solid #1e3a5f;">' +
        '<p style="margin:0 0 10px;font-size:13px;color:#334155;line-height:1.55;">' +
        '<strong style="color:#1e3a5f;">Importes orientativos.</strong> Los precios e importes mostrados en este correo tienen caracter informativo y pueden no reflejar las condiciones comerciales definitivas de su cuenta.' +
        '</p>' +
        '<p style="margin:0 0 10px;font-size:13px;color:#334155;line-height:1.55;">' +
        'Si dispone de condiciones mas favorables acordadas con su comercial, el importe se ajustara automaticamente al registrar el pedido en nuestro sistema (ERP).' +
        '</p>' +
        '<p style="margin:0;font-size:13px;color:#64748b;line-height:1.55;">' +
        'Este mensaje es una confirmacion automatica de recepcion del pedido. Le informaremos cuando este listo para recogida o en reparto segun el almacen seleccionado.' +
        '</p>' +
        '</div>' +
        '</div></div>' +
        '</td></tr></table></body></html>'
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
    const productosHtml = buildProductLinesHtml(data.productos || []);

    let observacionesBlock = '';
    if (observaciones) {
        observacionesBlock =
            '<div style="margin:16px 0;padding:12px 14px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;">' +
            '<strong style="color:#991b1b;">Observaciones del pedido</strong><br>' +
            '<span style="white-space:pre-wrap;color:#334155;">' + escapeHtml(observaciones) + '</span>' +
            '</div>';
    }

    return (
        '<!DOCTYPE html><html lang="es"><head>' + buildEmailHeadHtml() + '</head>' +
        '<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;width:100%;">' +
        '<table role="presentation" class="email-outer" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f1f5f9;">' +
        '<tr><td align="center" style="padding:12px 0;">' +
        '<div class="email-shell" style="max-width:640px;width:100%;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(15,23,42,0.08);">' +
        '<div class="email-header-pad" style="background:#991b1b;color:#ffffff;padding:20px 24px;">' +
        '<h1 style="margin:0;font-size:20px;line-height:1.3;">Pedido NO enviado al ERP</h1>' +
        '<p style="margin:6px 0 0;font-size:14px;opacity:0.9;line-height:1.4;">' + escapeHtml(empresaNombre) + '</p>' +
        '</div>' +
        '<div class="email-body-pad" style="padding:24px;">' +
        '<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.45;">Un pedido remoto se ha guardado en la app pero <strong>no ha llegado al ERP</strong>. Revisa el panel de control (Pedidos pendientes de ERP) en scan_client_mobile.</p>' +
        '<div style="background:#fef2f2;border-radius:6px;padding:14px 16px;margin-bottom:20px;">' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Motivo:</strong> ' + escapeHtml(motivoLabel) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Estado:</strong> ' + escapeHtml(motivo) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Carrito ID:</strong> ' + escapeHtml(carritoId) + '</p>' +
        '<p class="email-word-break" style="margin:6px 0;font-size:14px;line-height:1.5;word-break:break-word;"><strong>Cliente:</strong> ' + escapeHtml(clienteNombre) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Almacen:</strong> ' + escapeHtml(almacen) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Fecha:</strong> ' + escapeHtml(fecha) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;word-break:break-all;"><strong>Codigo pedido:</strong> ' + escapeHtml(codigoQr) + '</p>' +
        '<p style="margin:6px 0;font-size:14px;line-height:1.5;"><strong>Total (IVA incl.):</strong> ' + formatCurrency(totalConIva) + '</p>' +
        '</div>' +
        observacionesBlock +
        '<p style="margin:0 0 10px;font-size:15px;font-weight:bold;color:#991b1b;">Productos <span style="font-weight:normal;font-size:13px;color:#64748b;">(importes sin IVA)</span></p>' +
        '<div style="margin-top:4px;">' + productosHtml + '</div>' +
        '</div></div>' +
        '</td></tr></table></body></html>'
    );
}

function normalizeEmpresaAlmacenCode(almacen) {
    if (almacen == null) return '';
    return String(almacen).trim().toUpperCase();
}

function getRemitenteEmail(empresa) {
    const candidates = [
        safeText(empresa && empresa.email),
        safeText(empresa && empresa.smtp_user)
    ];
    for (let i = 0; i < candidates.length; i++) {
        if (isValidEmail(candidates[i])) {
            return candidates[i];
        }
    }
    return null;
}

function buildFromAddress(empresa) {
    const nombre = safeText(empresa && empresa.razon_social) || 'Pedidos BATMAR';
    const email = getRemitenteEmail(empresa);
    if (email) {
        return nombre + ' <' + email + '>';
    }

    const envFrom = safeText(process.env.ORDER_EMAIL_FROM);
    if (envFrom) return envFrom;

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

    if (Array.isArray(options.bcc) && options.bcc.length > 0) {
        mail.bcc = options.bcc.join(', ');
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

    if (Array.isArray(options.bcc) && options.bcc.length > 0) {
        payload.bcc = options.bcc;
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
        throw new Error('Indique Email remitente o Usuario SMTP en Datos de Empresa del almacen destino del pedido');
    }

    const mailOptions = Object.assign({}, options, {
        from: from,
        replyTo: resolveReplyTo(empresa, options.replyTo)
    });

    if (empresa && empresa.smtp_enabled === true) {
        if (!isSmtpConfigured(empresa)) {
            const missing = [];
            if (!safeText(empresa.smtp_host)) missing.push('servidor SMTP');
            if (!safeText(empresa.smtp_user)) missing.push('usuario SMTP');
            if (!safeText(empresa.smtp_password)) missing.push('contrasena SMTP (vuelva a guardarla)');
            throw new Error('SMTP activo pero incompleto en el almacen: ' + missing.join(', '));
        }
        return sendViaSmtp(empresa, mailOptions);
    }
    if (isSmtpConfigured(empresa)) {
        return sendViaSmtp(empresa, mailOptions);
    }
    return sendViaResend(mailOptions);
}

const EMPRESA_ALMACENES_CATALOGO = ['ONTINYENT', 'GANDIA', 'ALZIRA', 'REQUENA'];

function parseAlmacenFromObservaciones(observaciones) {
    const text = safeText(observaciones);
    if (!text) return '';

    const recoger = text.match(/RECOGER\s+EN\s+ALMACEN\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
    if (recoger && recoger[1]) {
        return normalizeEmpresaAlmacenCode(recoger[1]);
    }

    for (let i = 0; i < EMPRESA_ALMACENES_CATALOGO.length; i++) {
        const code = EMPRESA_ALMACENES_CATALOGO[i];
        if (new RegExp('\\b' + code + '\\b', 'i').test(text)) {
            return code;
        }
    }

    return '';
}

/**
 * Resuelve almacen para SMTP/email: carrito.almacen_destino > observaciones (recogida) > almacen_habitual.
 * @param {object|null} carrito
 * @param {object|null} usuario
 * @returns {{ almacen: string, source: string|null }}
 */
function resolveAlmacenDestinoForOrderEmail(carrito, usuario) {
    const fromCarrito = normalizeEmpresaAlmacenCode(carrito && carrito.almacen_destino);
    if (fromCarrito) {
        return { almacen: fromCarrito, source: 'carrito.almacen_destino' };
    }

    const fromObs = parseAlmacenFromObservaciones(carrito && carrito.observaciones);
    if (fromObs) {
        return { almacen: fromObs, source: 'observaciones' };
    }

    const fromHabitual = normalizeEmpresaAlmacenCode(usuario && usuario.almacen_habitual);
    if (fromHabitual) {
        return { almacen: fromHabitual, source: 'usuarios.almacen_habitual' };
    }

    return { almacen: '', source: null };
}

const EMPRESA_ORDER_EMAIL_SELECT =
    'almacen, razon_social, email, email_respuesta, telefono, smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_password, smtp_secure';

async function fetchEmpresaForOrderEmail(supabase, almacen) {
    const almacenBuscado = normalizeEmpresaAlmacenCode(almacen);
    if (!almacenBuscado) {
        return { empresa: null, error: 'almacen_vacio', almacenBuscado: null, detail: null };
    }

    const { data, error } = await supabase
        .from('empresas_por_almacen')
        .select(EMPRESA_ORDER_EMAIL_SELECT)
        .eq('almacen', almacenBuscado)
        .maybeSingle();

    if (error) {
        const detail = error.message || String(error);
        const migrationMissing = /smtp_|email_respuesta|column/i.test(detail);
        return {
            empresa: null,
            error: migrationMissing ? 'migration_missing' : 'db_error',
            almacenBuscado: almacenBuscado,
            detail: detail
        };
    }

    if (!data) {
        return {
            empresa: null,
            error: 'not_found',
            almacenBuscado: almacenBuscado,
            detail: null
        };
    }

    return {
        empresa: data,
        error: null,
        almacenBuscado: almacenBuscado,
        detail: null
    };
}

async function resolveUsuarioOrderEmail(supabase, usuarioId) {
    if (!supabase || usuarioId == null) return null;
    const { data: usuario, error } = await supabase
        .from('usuarios')
        .select('id, tipo, email')
        .eq('id', usuarioId)
        .maybeSingle();
    if (error || !usuario) return null;

    const tipo = safeText(usuario.tipo).toUpperCase();
    if (tipo === 'COMERCIAL') {
        const { data: comercial } = await supabase
            .from('usuarios_comerciales')
            .select('email')
            .eq('usuario_id', usuarioId)
            .maybeSingle();
        const email = comercial && comercial.email ? comercial.email : usuario.email;
        return isValidEmail(email) ? safeText(email) : null;
    }

    return isValidEmail(usuario.email) ? safeText(usuario.email) : null;
}

async function fetchComercialEmailByAsignado(supabase, comercialAsignado) {
    if (comercialAsignado == null) return null;
    const { data, error } = await supabase
        .from('usuarios_comerciales')
        .select('email, nombre')
        .or('id.eq.' + comercialAsignado + ',numero.eq.' + comercialAsignado)
        .limit(1)
        .maybeSingle();
    if (error || !data) return null;
    return isValidEmail(data.email) ? safeText(data.email) : null;
}

async function fetchEncargadosEmailsForComercial(supabase, comercialNumero) {
    if (!supabase || comercialNumero == null) return [];

    const num = parseInt(String(comercialNumero), 10);
    if (!Number.isFinite(num)) return [];

    const { data: rows, error } = await supabase
        .from('comerciales_encargados')
        .select('encargado_usuario_id')
        .eq('comercial_numero', num)
        .eq('activo', true);

    if (error || !rows || rows.length === 0) return [];

    const emails = [];
    for (let i = 0; i < rows.length; i++) {
        const email = await resolveUsuarioOrderEmail(supabase, rows[i].encargado_usuario_id);
        if (email) emails.push(email);
    }
    return emails;
}

function buildOrderRecipientLists(options) {
    const opts = options || {};
    const clienteEmail = safeText(opts.clienteEmail);
    const clienteNorm = clienteEmail.toLowerCase();
    const cc = [];
    const bcc = [];
    const used = new Set();

    if (clienteNorm) {
        used.add(clienteNorm);
    }

    const comercialEmail = safeText(opts.comercialEmail);
    if (isValidEmail(comercialEmail) && comercialEmail.toLowerCase() !== clienteNorm) {
        cc.push(comercialEmail);
        used.add(comercialEmail.toLowerCase());
    }

    const encargadoEmails = Array.isArray(opts.encargadoEmails) ? opts.encargadoEmails : [];
    for (let i = 0; i < encargadoEmails.length; i++) {
        const email = safeText(encargadoEmails[i]);
        const norm = email.toLowerCase();
        if (!isValidEmail(email) || used.has(norm)) continue;
        used.add(norm);
        bcc.push(email);
    }

    return { cc: cc, bcc: bcc };
}

function describeEmailConfigIssue(fetchResult) {
    const result = fetchResult || {};
    const empresa = result.empresa;
    const almacenLabel = result.almacenBuscado || (empresa && empresa.almacen) || '?';

    if (result.error === 'almacen_vacio') {
        return 'No se pudo determinar el almacen del pedido (almacen_destino vacio). Configure almacen habitual del cliente o vuelva a enviar el pedido eligiendo recogida en almacen.';
    }
    if (result.error === 'migration_missing') {
        return 'Faltan columnas SMTP en Supabase. Ejecute migration_empresas_smtp_pedidos.sql y migration_empresas_email_respuesta.sql.';
    }
    if (result.error === 'not_found') {
        return 'No hay Datos de Empresa (SMTP) para el almacen "' + almacenLabel + '". Configure Panel de Control > Datos de Empresa para ese almacen.';
    }
    if (result.error === 'db_error') {
        return 'Error al leer empresa por almacen "' + almacenLabel + '": ' + (result.detail || 'error de base de datos');
    }
    if (!buildFromAddress(empresa)) {
        return 'En Datos de Empresa del almacen "' + almacenLabel + '" indique Email remitente (De:) o Usuario SMTP (ej. noreply@batmar.net).';
    }
    if (empresa && empresa.smtp_enabled === true && !isSmtpConfigured(empresa)) {
        const missing = [];
        if (!safeText(empresa.smtp_host)) missing.push('servidor SMTP');
        if (!safeText(empresa.smtp_user)) missing.push('usuario SMTP');
        if (!safeText(empresa.smtp_password)) missing.push('contrasena SMTP (vuelva a guardarla)');
        return 'SMTP activo en "' + almacenLabel + '" pero faltan: ' + missing.join(', ');
    }
    return null;
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
    describeEmailConfigIssue,
    resolveAlmacenDestinoForOrderEmail,
    normalizeEmpresaAlmacenCode,
    formatDateSpain,
    resolveUsuarioOrderEmail,
    fetchComercialEmailByAsignado,
    fetchEncargadosEmailsForComercial,
    buildOrderRecipientLists
};
