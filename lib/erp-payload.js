/**
 * Preparacion del body para POST /pedidos/crear_tipo.
 * Regla: mismo JSON que antes de la migracion + campo tipo + URL crear_tipo.
 * No se eliminan campos del cliente (p. ej. codigo_usuario_erp). Si el ERP falla, se reporta al proveedor de la API.
 */

const ERP_CREATE_ORDER_ALLOWED_KEYS = [
    'codigo_cliente',
    'codigo_usuario_erp',
    'serie',
    'centro_venta',
    'referencia',
    'observaciones',
    'tipo',
    'lineas'
];

const LEGACY_CREATE_PATH = '/pedidos/crear';
const TYPED_CREATE_PATH = '/pedidos/crear_tipo';

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

/**
 * Alinea el pedido al contrato crear_tipo sin quitar campos criticos.
 * Solo normaliza: articulos->lineas, tipo por defecto, codigo_usuario_erp si falta pero hay codigo_cliente.
 */
function isLegacyContract(opts) {
    const options = opts || {};
    return options.legacyMode === true || options.contractMode === 'legacy';
}

/**
 * Orden de claves del JSON enviado al ERP (insertion order en JSON.stringify).
 * Ejemplo proveedor: observaciones, tipo, lineas (tipo ANTES de lineas).
 */
function buildOrderedErpPayload(fields, legacy) {
    const ordered = {
        codigo_cliente: fields.codigo_cliente,
        codigo_usuario_erp: fields.codigo_usuario_erp,
        serie: fields.serie,
        centro_venta: fields.centro_venta,
        referencia: fields.referencia,
        observaciones: fields.observaciones
    };
    if (!legacy) {
        ordered.tipo = fields.tipo;
    }
    ordered.lineas = fields.lineas;
    return ordered;
}

function sanitizeErpCreateOrderPayload(body, options) {
    const opts = options || {};
    const raw = buildCreateOrderPayload(body);
    const legacy = isLegacyContract(opts);

    let codigoCliente = raw.codigo_cliente;
    if (codigoCliente === undefined || codigoCliente === null || codigoCliente === '') {
        codigoCliente = raw.codigo_usuario_erp;
    }

    let codigoUsuarioErp = raw.codigo_usuario_erp;
    if (codigoUsuarioErp === undefined || codigoUsuarioErp === null || codigoUsuarioErp === '') {
        codigoUsuarioErp = codigoCliente;
    }

    let tipo = null;
    if (!legacy) {
        const tipoRaw = (raw.tipo != null ? String(raw.tipo) : (opts.defaultTipo || 'REMOTO')).trim().toUpperCase();
        tipo = tipoRaw === 'PRESENCIAL' ? 'PRESENCIAL' : 'REMOTO';
    }

    return buildOrderedErpPayload({
        codigo_cliente: codigoCliente,
        codigo_usuario_erp: codigoUsuarioErp,
        serie: raw.serie,
        centro_venta: raw.centro_venta,
        referencia: raw.referencia,
        observaciones: raw.observaciones != null ? String(raw.observaciones) : '',
        tipo: tipo,
        lineas: raw.lineas || []
    }, legacy);
}

function analyzePayloadDiff(body, options) {
    const opts = options || {};
    const clientBody = body || {};
    const afterMapArticulos = buildCreateOrderPayload(clientBody);
    const sanitizedBody = sanitizeErpCreateOrderPayload(clientBody, opts);

    const clientKeys = Object.keys(clientBody);
    const sanitizedKeys = Object.keys(sanitizedBody);

    const extraKeysInClient = clientKeys.filter((key) => {
        return key !== 'articulos' && !ERP_CREATE_ORDER_ALLOWED_KEYS.includes(key);
    });

    const strippedKeys = clientKeys.filter((key) => {
        return key !== 'articulos' && afterMapArticulos[key] !== undefined && sanitizedBody[key] === undefined;
    });

    const warnings = [];

    if (Array.isArray(clientBody.articulos) && clientBody.articulos.length > 0) {
        warnings.push('articulos[] se convierte a lineas[] antes de llamar al ERP.');
    }
    const legacy = isLegacyContract(opts);
    if (legacy) {
        warnings.push('Contrato LEGACY: POST /pedidos/crear sin campo tipo en el JSON enviado al ERP.');
    } else if (!clientBody.tipo) {
        warnings.push('tipo no venia en el body del cliente; el proxy usa REMOTO por defecto.');
    }
    if (!sanitizedBody.codigo_cliente && !sanitizedBody.codigo_usuario_erp) {
        warnings.push('codigo_cliente y codigo_usuario_erp vacios: el ERP puede rechazar el pedido.');
    }
    if (!Array.isArray(sanitizedBody.lineas) || sanitizedBody.lineas.length === 0) {
        warnings.push('lineas[] vacio: el ERP exige al menos una linea.');
    }
    if (extraKeysInClient.length > 0) {
        warnings.push('Claves extra en el cliente no reenviadas al ERP: ' + extraKeysInClient.join(', '));
    }
    if (strippedKeys.length > 0) {
        warnings.push('Claves del cliente omitidas en el envio: ' + strippedKeys.join(', '));
    }
    if (!legacy) {
        warnings.push('Orden JSON al ERP: codigo_cliente, codigo_usuario_erp, serie, centro_venta, referencia, observaciones, tipo, lineas (tipo antes de lineas, como ejemplo ERP).');
    }

    return {
        allowedKeys: ERP_CREATE_ORDER_ALLOWED_KEYS,
        clientKeys: clientKeys,
        sanitizedKeys: sanitizedKeys,
        extraKeysInClient: extraKeysInClient,
        strippedKeys: strippedKeys,
        sanitizedBody: sanitizedBody,
        warnings: warnings,
        contractMode: legacy ? 'legacy' : 'nuevo',
        tipoLogico: sanitizedBody.tipo || null,
        policy: legacy
            ? 'Legacy: mismo body historico, URL /pedidos/crear, sin tipo'
            : 'Nuevo: body historico + tipo, URL /pedidos/crear_tipo'
    };
}

module.exports = {
    ERP_CREATE_ORDER_ALLOWED_KEYS,
    LEGACY_CREATE_PATH,
    TYPED_CREATE_PATH,
    isLegacyContract,
    buildCreateOrderPayload,
    buildOrderedErpPayload,
    sanitizeErpCreateOrderPayload,
    analyzePayloadDiff
};
