/**
 * Diagnostico controlado de creacion de pedido ERP.
 * POST /api/erp/debug-pedido
 *
 * Body JSON:
 *   payload: objeto del pedido (como app.js o test)
 *   dryRun: true = no llama al ERP, solo muestra que se enviaria
 *   erpCreateOrderPathOverride: opcional "/pedidos/crear" o "/pedidos/crear_tipo"
 *   contractMode: "legacy" | "nuevo" (legacy = sin tipo en JSON; nuevo = con tipo)
 *   erpBaseUrlOverride: URL base alternativa solo para contractMode "nuevo" (ej. https://13.93.125.160:5002/api/tienda/v1)
 *   (El proxy no elimina codigo_usuario_erp ni otros campos del contrato historico)
 */

const {
    fetchWithTimeout,
    parseJsonResponse,
    buildUrl,
    normalizeErpPath,
    normalizeErpBaseUrl
} = require('./erp-https');
const {
    LEGACY_CREATE_PATH,
    TYPED_CREATE_PATH,
    sanitizeErpCreateOrderPayload,
    analyzePayloadDiff
} = require('./erp-payload');

const DEFAULT_NUEVO_ERP_BASE = 'https://13.93.125.160:5002/api/tienda/v1';

function resolveBaseUrlForRequest(body, contractMode, envBaseUrl) {
    const override = (body.erpBaseUrlOverride || '').trim();
    if (contractMode === 'nuevo' && override) {
        return normalizeErpBaseUrl(override);
    }
    return normalizeErpBaseUrl(envBaseUrl || '');
}

function maskSecret(value) {
    if (!value) {
        return null;
    }
    const text = String(value);
    if (text.length <= 4) {
        return '****';
    }
    return '***' + text.slice(-4);
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
        res.status(405).json({ message: 'Metodo no permitido. Usa POST' });
        return;
    }

    const baseUrl = process.env.ERP_BASE_URL || '';
    const loginPath = process.env.ERP_LOGIN_PATH || '/login';
    const envCreateOrderPathRaw = process.env.ERP_CREATE_ORDER_PATH || TYPED_CREATE_PATH;
    const envCreateOrderPath = normalizeErpPath(envCreateOrderPathRaw);
    const username = process.env.ERP_USER || '';
    const password = process.env.ERP_PASSWORD || '';
    const timeoutMs = parseInt(process.env.ERP_REQUEST_TIMEOUT_MS || '15000', 10);

    const body = req.body || {};
    const clientPayload = body.payload != null ? body.payload : body;
    const dryRun = body.dryRun === true;
    const contractMode = (body.contractMode === 'legacy' || body.contractMode === 'nuevo')
        ? body.contractMode
        : (body.legacyMode === true ? 'legacy' : 'nuevo');

    let pathOverrideRaw = (body.erpCreateOrderPathOverride || '').trim();
    if (!pathOverrideRaw) {
        pathOverrideRaw = contractMode === 'legacy' ? LEGACY_CREATE_PATH : TYPED_CREATE_PATH;
    }
    const pathOverride = normalizeErpPath(pathOverrideRaw);

    const pathUsed = pathOverride;
    const baseUrlUsed = resolveBaseUrlForRequest(body, contractMode, baseUrl);
    const erpUrl = baseUrlUsed ? buildUrl(baseUrlUsed, pathUsed) : null;

    const sanitizeOpts = {
        defaultTipo: body.defaultTipo || 'REMOTO',
        contractMode: contractMode
    };

    const analysis = analyzePayloadDiff(clientPayload, sanitizeOpts);

    const sanitizedPayload = sanitizeErpCreateOrderPayload(clientPayload, sanitizeOpts);

    const trace = {
        timestamp: new Date().toISOString(),
        dryRun: dryRun,
        vercelEnv: {
            ERP_BASE_URL: baseUrl || null,
            ERP_BASE_URL_used: baseUrlUsed || null,
            ERP_BASE_URL_override_nuevo: (body.erpBaseUrlOverride || '').trim() || null,
            ERP_LOGIN_PATH: loginPath,
            ERP_CREATE_ORDER_PATH_raw: envCreateOrderPathRaw,
            ERP_CREATE_ORDER_PATH: envCreateOrderPath,
            pathHadBackslash:
                (envCreateOrderPathRaw && String(envCreateOrderPathRaw).includes('\\')) ||
                (pathOverrideRaw && pathOverrideRaw.includes('\\')),
            ERP_USER: username ? maskSecret(username) : null,
            ERP_PASSWORD: password ? '(configurada)' : null,
            ERP_REQUEST_TIMEOUT_MS: timeoutMs
        },
        requestPlan: {
            method: 'POST',
            url: erpUrl,
            pathUsed: pathUsed,
            pathOverrideRaw: pathOverrideRaw || null,
            pathIsLegacyCrear: pathUsed === LEGACY_CREATE_PATH || pathUsed.endsWith('/crear'),
            pathIsCrearTipo: pathUsed === TYPED_CREATE_PATH || pathUsed.endsWith('/crear_tipo'),
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer <token tras login>'
            },
            bodyStringPreview: JSON.stringify(sanitizedPayload, null, 2)
        },
        contractMode: contractMode,
        clientPayload: clientPayload,
        sanitizedPayload: sanitizedPayload,
        analysis: analysis,
        migrationNote: {
            remotoAntes: 'POST ' + LEGACY_CREATE_PATH,
            remotoAhora: 'POST ' + TYPED_CREATE_PATH + ' con el mismo body historico + campo tipo (REMOTO/PRESENCIAL)',
            camposHistoricos: ['codigo_cliente', 'codigo_usuario_erp', 'serie', 'centro_venta', 'referencia', 'observaciones', 'lineas'],
            campoNuevo: 'tipo',
            siErrorSql: 'Reportar al proveedor ERP; no quitar campos en el cliente'
        }
    };

    const missing = [];
    if (!baseUrlUsed) missing.push('ERP_BASE_URL');
    if (!username) missing.push('ERP_USER');
    if (!password) missing.push('ERP_PASSWORD');

    if (missing.length > 0) {
        res.status(500).json({
            success: false,
            message: 'ERP no configurado en Vercel',
            missing: missing,
            trace: trace
        });
        return;
    }

    if (dryRun) {
        res.status(200).json({
            success: true,
            message: 'dryRun: no se llamo al ERP',
            trace: trace
        });
        return;
    }

    try {
        const token = await loginToErp({
            baseUrl: baseUrlUsed,
            loginPath,
            username,
            password,
            timeoutMs
        });

        const erpResult = await sendOrderToErp({
            baseUrl: baseUrlUsed,
            createOrderPath: pathUsed,
            token,
            payload: sanitizedPayload,
            timeoutMs
        });

        res.status(200).json({
            success: true,
            message: 'Pedido enviado al ERP',
            trace: trace,
            erp: {
                httpStatus: erpResult.httpStatus,
                response: erpResult.data
            }
        });
    } catch (error) {
        const details = error.details || null;
        res.status(502).json({
            success: false,
            message: error.message || 'Error al llamar al ERP',
            trace: trace,
            erp: details
        });
    }
};

async function loginToErp({ baseUrl, loginPath, username, password, timeoutMs }) {
    const url = buildUrl(baseUrl, loginPath);
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: username, password })
    }, timeoutMs);

    const data = await parseJsonResponse(response);
    if (!response.ok) {
        const statusMessage = data && data.message ? data.message : response.statusText;
        throw new Error(`ERP login error ${response.status}: ${statusMessage}`);
    }

    const token = data?.token || data?.access_token || data?.data?.token || null;
    if (!token) {
        throw new Error('ERP no devolvio token');
    }

    return token;
}

async function sendOrderToErp({ baseUrl, createOrderPath, token, payload, timeoutMs }) {
    const url = buildUrl(baseUrl, createOrderPath);
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    }, timeoutMs);

    const data = await parseJsonResponse(response);
    if (!response.ok) {
        const statusMessage = data && data.message ? data.message : response.statusText;
        const err = new Error(`ERP order error ${response.status}: ${statusMessage}`);
        err.details = {
            httpStatus: response.status,
            statusText: response.statusText,
            url: url,
            payloadSent: payload,
            payloadKeys: Object.keys(payload),
            erpResponse: data
        };
        throw err;
    }

    return {
        httpStatus: response.status,
        data: data
    };
}
