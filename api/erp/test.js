/**
 * Serverless function para Vercel
 * Prueba la conectividad con el ERP usando GET /api/tienda/v1/test
 */

const { fetchWithTimeout, parseJsonResponse, buildUrl } = require('./erp-https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    const testPath = '/test';
    const timeoutMs = parseInt(process.env.ERP_REQUEST_TIMEOUT_MS || '15000', 10);

    if (!baseUrl) {
        res.status(500).json({ 
            message: 'ERP_BASE_URL no esta configurado',
            note: 'Configura ERP_BASE_URL en Vercel Environment Variables'
        });
        return;
    }

    const url = buildUrl(baseUrl, testPath);

    try {
        const response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        }, timeoutMs);

        const data = await parseJsonResponse(response);
        if (!response.ok) {
            const statusMessage = data && data.message ? data.message : response.statusText;
            throw new Error(`ERP test error ${response.status}: ${statusMessage}`);
        }

        res.status(200).json({
            success: true,
            message: 'Conexion con ERP exitosa',
            data: data,
            url: url
        });
    } catch (error) {
        const debug = {
            urlAttempted: url,
            baseUrlFromEnv: baseUrl || '(vacio)',
            errorName: error.name,
            errorCode: error.code || null,
            errorMessage: error.message
        };
        if (error.cause) {
            debug.errorCause = String(error.cause);
        }
        res.status(502).json({
            success: false,
            message: error.message || 'Error al conectar con ERP',
            error: error.toString(),
            debug: debug
        });
    }
};
