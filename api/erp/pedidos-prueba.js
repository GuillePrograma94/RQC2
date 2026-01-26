/**
 * Serverless function para Vercel
 * Prueba el endpoint de pedidos usando GET /api/tienda/v1/pedidos/prueba
 * Requiere token Bearer (hace login automaticamente)
 */

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).json({ message: 'Metodo no permitido' });
        return;
    }

    const baseUrl = process.env.ERP_BASE_URL || '';
    const loginPath = process.env.ERP_LOGIN_PATH || '/login';
    const pedidosPath = '/pedidos/prueba';
    const username = process.env.ERP_USER || '';
    const password = process.env.ERP_PASSWORD || '';
    const timeoutMs = parseInt(process.env.ERP_REQUEST_TIMEOUT_MS || '15000', 10);

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
        const token = await loginToErp({
            baseUrl,
            loginPath,
            username,
            password,
            timeoutMs
        });

        const url = buildUrl(baseUrl, pedidosPath);
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            }
        }, timeoutMs);

        const data = await parseJsonResponse(response);
        
        if (!response.ok) {
            const statusMessage = data && data.message ? data.message : response.statusText;
            throw new Error(`ERP pedidos error ${response.status}: ${statusMessage}`);
        }

        res.status(200).json({
            success: true,
            message: 'Endpoint de pedidos funcionando',
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

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function parseJsonResponse(response) {
    const responseText = await response.text();
    if (!responseText) {
        return null;
    }
    try {
        return JSON.parse(responseText);
    } catch (error) {
        return responseText;
    }
}

function buildUrl(baseUrl, path) {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
}
