/**
 * Diagnostico controlado de creacion de pedido ERP.
 * POST /api/erp/debug-pedido
 *
 * Body JSON:
 *   payload: objeto del pedido (como app.js o test)
 *   dryRun: true = no llama al ERP, solo muestra que se enviaria
 *   erpCreateOrderPathOverride: opcional "/pedidos/crear" o "/pedidos/crear_tipo"
 *   includeLegacyCodigoUsuarioErp: true = no quitar codigo_usuario_erp (reproducir error)
 */

const { fetchWithTimeout, parseJsonResponse, buildUrl, normalizeErpPath } = require('./erp-https');
const {
    LEGACY_CREATE_PATH,
    TYPED_CREATE_PATH,
    sanitizeErpCreateOrderPayload,
    analyzePayloadDiff
} = require('./erp-payload');

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
    const includeLegacy = body.includeLegacyCodigoUsuarioErp === true;
    const pathOverrideRaw = (body.erpCreateOrderPathOverride || '').trim();
    const pathOverride = pathOverrideRaw ? normalizeErpPath(pathOverrideRaw) : '';

    const pathUsed = pathOverride || envCreateOrderPath || TYPED_CREATE_PATH;
    const erpUrl = baseUrl ? buildUrl(baseUrl, pathUsed) : null;

    const analysis = analyzePayloadDiff(clientPayload, {
        defaultTipo: body.defaultTipo || 'REMOTO',
        includeLegacyCodigoUsuarioErp: includeLegacy
    });

    const sanitizedPayload = sanitizeErpCreateOrderPayload(clientPayload, {
        defaultTipo: body.defaultTipo || 'REMOTO',
        includeLegacyCodigoUsuarioErp: includeLegacy
    });

    const trace = {
        timestamp: new Date().toISOString(),
        dryRun: dryRun,
        vercelEnv: {
            ERP_BASE_URL: baseUrl || null,
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
        clientPayload: clientPayload,
        sanitizedPayload: sanitizedPayload,
        analysis: analysis,
        migrationNote: {
            remotoAntes: 'POST ' + LEGACY_CREATE_PATH + ' (6 campos + lineas, sin tipo)',
            remotoAhora: 'POST ' + TYPED_CREATE_PATH + ' (mismo JSON que antes; tipo REMOTO NO va en body hasta que el SP lo soporte)',
            presencial: 'POST ' + TYPED_CREATE_PATH + ' con tipo PRESENCIAL en el body',
            noEnviar: ['codigo_usuario_erp'],
            envOverride: 'ERP_INCLUDE_TIPO_REMOTO=1 fuerza tipo en body para REMOTO'
        }
    };

    const missing = [];
    if (!baseUrl) missing.push('ERP_BASE_URL');
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
            baseUrl,
            loginPath,
            username,
            password,
            timeoutMs
        });

        const erpResult = await sendOrderToErp({
            baseUrl,
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
