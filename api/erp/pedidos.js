/**
 * Serverless function para Vercel
 * Pedidos: GET al ERP /pedidos/prueba (prueba), POST al ERP /pedidos/crear (crear pedido).
 * Requiere token Bearer (hace login automaticamente).
 */

const { fetchWithTimeout, parseJsonResponse, buildUrl } = require('./erp-https');

/**
 * Adapta el payload del cliente al formato que espera el ERP en POST /pedidos/crear.
 * El ERP exige lineas[] (minimo 1). El formulario de test envia articulos[].
 */
function buildCreateOrderPayload(body) {
    const payload = Object.assign({}, body);
    if (Array.isArray(payload.lineas) && payload.lineas.length > 0) {
        return payload;
    }
    if (Array.isArray(payload.articulos) && payload.articulos.length > 0) {
        payload.lineas = payload.articulos.map((a) => ({
            codigo_articulo: a.codigo_articulo || a.codigo,
            unidades: a.unidades != null ? a.unidades : a.cantidad
        }));
    } else {
        payload.lineas = [];
    }
    return payload;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ message: 'Metodo no permitido. Usa GET o POST' });
        return;
    }

    const baseUrl = process.env.ERP_BASE_URL || '';
    const loginPath = process.env.ERP_LOGIN_PATH || '/login';
    const pedidosPruebaPath = '/pedidos/prueba';
    const createOrderPath = process.env.ERP_CREATE_ORDER_PATH || '/pedidos/crear';
    const username = process.env.ERP_USER || '';
    const password = process.env.ERP_PASSWORD || '';
    const timeoutMs = parseInt(process.env.ERP_REQUEST_TIMEOUT_MS || '15000', 10);

    const isPostWithPayload = req.method === 'POST' && req.body && Object.keys(req.body).length > 0;
    const pathToCall = isPostWithPayload ? createOrderPath : pedidosPruebaPath;

    if (!baseUrl || !username || !password) {
        const missing = [];
        if (!baseUrl) missing.push('ERP_BASE_URL');
        if (!username) missing.push('ERP_USER');
        if (!password) missing.push('ERP_PASSWORD');

        res.status(500).json({
            message: 'ERP no esta completamente configurado',
            missing: missing
        });
        return;
    }

    try {
        let token = null;
        const authHeader = req.headers.authorization || req.headers.Authorization || '';
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.body && req.body.token) {
            token = req.body.token;
        } else if (req.query && req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            token = await loginToErp({
                baseUrl,
                loginPath,
                username,
                password,
                timeoutMs
            });
        }

        const url = buildUrl(baseUrl, pathToCall);
        const method = req.method;
        let bodyToSend = req.body;

        if (method === 'POST' && bodyToSend && isPostWithPayload) {
            bodyToSend = buildCreateOrderPayload(bodyToSend);
        }

        const requestOptions = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            }
        };

        if (method === 'POST' && bodyToSend) {
            requestOptions.body = JSON.stringify(bodyToSend);
        }

        const response = await fetchWithTimeout(url, requestOptions, timeoutMs);

        const data = await parseJsonResponse(response);

        if (!response.ok) {
            const statusMessage = data && data.message ? data.message : response.statusText;
            const errorDetails = {
                status: response.status,
                statusText: response.statusText,
                url: url,
                method: method,
                hasPayload: method === 'POST' && req.body ? true : false,
                payloadKeys: method === 'POST' && req.body ? Object.keys(req.body) : [],
                erpResponse: data
            };

            if (response.status === 404) {
                throw new Error(`Endpoint no encontrado (404). El endpoint ${method} ${url} no existe en el ERP. Verifica que el endpoint este disponible o que el metodo sea correcto. Detalles: ${JSON.stringify(errorDetails)}`);
            }

            throw new Error(`ERP pedidos error ${response.status}: ${statusMessage}. Detalles: ${JSON.stringify(errorDetails)}`);
        }

        res.status(200).json({
            success: true,
            message: `Endpoint de pedidos funcionando (${method})`,
            method: method,
            payload: method === 'POST' ? req.body : null,
            data: data,
            url: url,
            tokenUsed: token.substring(0, 20) + '...'
        });
    } catch (error) {
        res.status(502).json({
            success: false,
            message: error.message || 'Error al probar endpoint de pedidos',
            error: error.toString()
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
