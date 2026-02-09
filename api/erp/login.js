/**
 * Serverless function para Vercel
 * Prueba el login con el ERP usando POST /api/tienda/v1/login
 */

const { fetchWithTimeout, parseJsonResponse, buildUrl } = require('./erp-https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ message: 'Metodo no permitido' });
        return;
    }

    const baseUrl = process.env.ERP_BASE_URL || '';
    const loginPath = process.env.ERP_LOGIN_PATH || '/login';
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
            throw new Error('ERP no devolvio token en la respuesta');
        }

        res.status(200).json({
            success: true,
            message: 'Login exitoso',
            token: token,
            tokenLength: token.length,
            fullResponse: data,
            note: 'Token valido por 8 horas'
        });
    } catch (error) {
        res.status(502).json({ 
            success: false,
            message: error.message || 'Error al hacer login en ERP',
            error: error.toString()
        });
    }
};
