/**
 * Normalizacion del body para POST /pedidos/crear_tipo (contrato ERP oficial).
 * Compartido por pedidos.js, create-order.js y debug-pedido.js.
 */

const ERP_CREATE_ORDER_ALLOWED_KEYS = [
    'codigo_cliente',
    'serie',
    'centro_venta',
    'referencia',
    'observaciones',
    'tipo',
    'lineas'
];

const LEGACY_CREATE_PATH = '/pedidos/crear';
const TYPED_CREATE_PATH = '/pedidos/crear_tipo';

/**
 * El SP dbo.vs_app_pedidos_crea_pedidos (sin actualizar) no admite el parametro tipo.
 * REMOTO: usar URL /pedidos/crear_tipo sin campo tipo en el JSON (mismo body que /pedidos/crear).
 * PRESENCIAL: incluir tipo en el body (Postman ERP).
 * Override: ERP_INCLUDE_TIPO_REMOTO=1 fuerza enviar tipo tambien en REMOTO.
 */
function shouldSendTipoInBody(tipo, options) {
    const opts = options || {};
    if (opts.forceIncludeTipo === true) {
        return true;
    }
    if (opts.forceOmitTipo === true) {
        return false;
    }
    const envForce = process.env.ERP_INCLUDE_TIPO_REMOTO;
    if (envForce === '1' || envForce === 'true') {
        return true;
    }
    return tipo === 'PRESENCIAL';
}

function buildCreateOrderPayload(body) {
    const payload = Object.assign({}, body || {});
    if (Array.isArray(payload.lineas) && payload.lineas.length > 0) {
        return payload;
    }
    if (Array.isArray(payload.articulos) && payload.articulos.length > 0) {
        payload.lineas = payload.articulos.map((a) => ({
            codigo_articulo: a.codigo_articulo || a.codigo,
            unidades: a.unidades != null ? a.unidades : a.cantidad
        }));
    } else if (!Array.isArray(payload.lineas)) {
        payload.lineas = [];
    }
    return payload;
}

function sanitizeErpCreateOrderPayload(body, options) {
    const opts = options || {};
    const raw = buildCreateOrderPayload(body);
    let codigoCliente = raw.codigo_cliente;
    if (codigoCliente === undefined || codigoCliente === null || codigoCliente === '') {
        codigoCliente = raw.codigo_usuario_erp;
    }

    const tipoRaw = (raw.tipo != null ? String(raw.tipo) : (opts.defaultTipo || 'REMOTO')).trim().toUpperCase();
    const tipo = tipoRaw === 'PRESENCIAL' ? 'PRESENCIAL' : 'REMOTO';

    const payload = {
        codigo_cliente: codigoCliente,
        serie: raw.serie,
        centro_venta: raw.centro_venta,
        referencia: raw.referencia,
        observaciones: raw.observaciones != null ? String(raw.observaciones) : '',
        lineas: raw.lineas || []
    };

    if (shouldSendTipoInBody(tipo, opts)) {
        payload.tipo = tipo;
    }

    if (opts.includeLegacyCodigoUsuarioErp && raw.codigo_usuario_erp != null && raw.codigo_usuario_erp !== '') {
        payload.codigo_usuario_erp = raw.codigo_usuario_erp;
    }

    return payload;
}

function analyzePayloadDiff(body, options) {
    const opts = options || {};
    const clientBody = body || {};
    const afterMapArticulos = buildCreateOrderPayload(clientBody);
    const sanitizedBody = sanitizeErpCreateOrderPayload(clientBody, opts);

    const clientKeys = Object.keys(clientBody);
    const afterMapKeys = Object.keys(afterMapArticulos);
    const sanitizedKeys = Object.keys(sanitizedBody);

    const extraKeysInClient = clientKeys.filter((key) => {
        return key !== 'articulos' && !ERP_CREATE_ORDER_ALLOWED_KEYS.includes(key);
    });

    const strippedKeys = afterMapKeys.filter((key) => !sanitizedKeys.includes(key));
    const warnings = [];

    if (clientBody.codigo_usuario_erp != null && clientBody.codigo_usuario_erp !== '') {
        if (opts.includeLegacyCodigoUsuarioErp) {
            warnings.push('codigo_usuario_erp incluido a proposito (modo reproduccion error 8144).');
        } else {
            warnings.push('codigo_usuario_erp se elimina al reenviar (duplica codigo_cliente; provoca error SQL 8144).');
        }
    }
    const tipoLogico = (clientBody.tipo != null ? String(clientBody.tipo) : (opts.defaultTipo || 'REMOTO')).trim().toUpperCase();
    const tipoNorm = tipoLogico === 'PRESENCIAL' ? 'PRESENCIAL' : 'REMOTO';
    if (!clientBody.tipo) {
        warnings.push('tipo no venia en el body del cliente; se asume REMOTO por defecto.');
    }
    if (tipoNorm === 'REMOTO' && clientBody.tipo && !sanitizedBody.tipo) {
        warnings.push(
            'tipo REMOTO omitido en el JSON enviado al ERP (el SP vs_app_pedidos_crea_pedidos no lo admite). ' +
            'Se usa solo la URL /pedidos/crear_tipo. PRESENCIAL si lleva tipo en el body.'
        );
    }
    if (Array.isArray(clientBody.articulos) && clientBody.articulos.length > 0) {
        warnings.push('articulos[] se convierte a lineas[] antes de llamar al ERP.');
    }
    if (!sanitizedBody.codigo_cliente) {
        warnings.push('codigo_cliente vacio: el ERP puede rechazar el pedido.');
    }
    if (!Array.isArray(sanitizedBody.lineas) || sanitizedBody.lineas.length === 0) {
        warnings.push('lineas[] vacio: el ERP exige al menos una linea.');
    }

    return {
        allowedKeys: ERP_CREATE_ORDER_ALLOWED_KEYS,
        clientKeys: clientKeys,
        afterMapArticulosKeys: afterMapKeys,
        sanitizedKeys: sanitizedKeys,
        extraKeysInClient: extraKeysInClient,
        strippedKeys: strippedKeys,
        sanitizedBody: sanitizedBody,
        warnings: warnings,
        tipoLogico: tipoNorm,
        tipoEnBodyEnviado: sanitizedBody.tipo || null
    };
}

module.exports = {
    ERP_CREATE_ORDER_ALLOWED_KEYS,
    LEGACY_CREATE_PATH,
    TYPED_CREATE_PATH,
    shouldSendTipoInBody,
    buildCreateOrderPayload,
    sanitizeErpCreateOrderPayload,
    analyzePayloadDiff
};
