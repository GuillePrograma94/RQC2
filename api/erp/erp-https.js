/**
 * Cliente HTTPS para peticiones al ERP con soporte de CA intermedia (Sectigo).
 * Usa el certificado en certs/sectigo-dv-r36.pem para verificar la cadena SSL
 * cuando el servidor no envia el intermedio.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

let cachedAgent = null;

function getHttpsAgent() {
    if (cachedAgent !== null) {
        return cachedAgent;
    }
    const certPath = path.join(__dirname, 'certs', 'sectigo-dv-r36.pem');
    let certPem = '';
    try {
        certPem = fs.readFileSync(certPath, 'utf8').trim();
    } catch (e) {
        cachedAgent = undefined;
        return undefined;
    }
    if (!certPem || !certPem.includes('-----BEGIN CERTIFICATE-----')) {
        cachedAgent = undefined;
        return undefined;
    }
    cachedAgent = new https.Agent({
        ca: certPem,
        keepAlive: false
    });
    return cachedAgent;
}

/**
 * Realiza una peticion HTTPS al ERP usando el agente con CA intermedia.
 * Devuelve un objeto compatible con parseJsonResponse: { ok, status, statusText, text() }.
 */
function fetchWithTimeout(url, options, timeoutMs) {
    const agent = getHttpsAgent();
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';

    const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: (options && options.method) || 'GET',
        headers: (options && options.headers) || {}
    };

    if (isHttps && agent) {
        requestOptions.agent = agent;
    }

    if (options && options.body) {
        const bodyBuffer = typeof options.body === 'string' ? Buffer.from(options.body, 'utf8') : options.body;
        requestOptions.headers['Content-Length'] = bodyBuffer.length;
    }

    return new Promise((resolve, reject) => {
        const protocol = isHttps ? https : require('http');
        const req = protocol.request(requestOptions, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage || '',
                    text: async () => body
                });
            });
        });

        req.on('error', reject);

        const timeoutId = setTimeout(() => {
            req.destroy();
            reject(new Error('fetch failed'));
        }, timeoutMs);

        req.on('close', () => clearTimeout(timeoutId));

        if (options && options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/**
 * Si no hay agente (cert no configurado), usa fetch nativo como fallback.
 * Las funciones ERP pueden usar este wrapper para intentar primero con CA y luego sin.
 */
async function fetchErpWithTimeout(url, options, timeoutMs) {
    const agent = getHttpsAgent();
    if (agent) {
        return fetchWithTimeout(url, options, timeoutMs);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        const text = await res.text();
        return {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            text: async () => text
        };
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
    } catch (e) {
        return responseText;
    }
}

function buildUrl(baseUrl, pathSuffix) {
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
    return `${base}${cleanPath}`;
}

module.exports = {
    fetchWithTimeout: fetchErpWithTimeout,
    parseJsonResponse,
    buildUrl
};
