/**
 * Serveur de dev local : fichiers statiques + routes /api/* (sans Vercel CLI).
 * Charge .env.local si present (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2'
};

function loadEnvLocal() {
    const envPath = path.join(ROOT, '.env.local');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(function (line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eq = trimmed.indexOf('=');
        if (eq === -1) return;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    });
}

function createVercelRes(nodeRes) {
    let statusCode = 200;
    const res = {
        setHeader(name, value) {
            nodeRes.setHeader(name, value);
            return res;
        },
        status(code) {
            statusCode = code;
            return res;
        },
        json(body) {
            if (!nodeRes.headersSent) {
                nodeRes.statusCode = statusCode;
                nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                nodeRes.end(JSON.stringify(body));
            }
        },
        end(body) {
            if (!nodeRes.headersSent) {
                nodeRes.statusCode = statusCode;
                nodeRes.end(body == null ? '' : body);
            }
        }
    };
    return res;
}

async function readRequestBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) return undefined;
    const raw = Buffer.concat(chunks).toString('utf8');
    try {
        return JSON.parse(raw);
    } catch (e) {
        return raw;
    }
}

function buildApiRequest(nodeReq, url) {
    const query = {};
    url.searchParams.forEach(function (value, key) {
        query[key] = value;
    });
    return {
        method: nodeReq.method,
        url: url.pathname + url.search,
        headers: nodeReq.headers,
        query: query,
        body: undefined
    };
}

async function handleApi(nodeReq, nodeRes, url) {
    const pathname = url.pathname;

    if (nodeReq.method === 'OPTIONS') {
        nodeRes.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        });
        nodeRes.end();
        return;
    }

    let handlerPath = null;
    let query = buildApiRequest(nodeReq, url).query;

    if (pathname === '/api/config.js') {
        handlerPath = path.join(ROOT, 'api', 'config.js');
    } else if (pathname.startsWith('/api/auth/')) {
        const action = pathname.slice('/api/auth/'.length).replace(/\/+$/, '');
        if (action) {
            handlerPath = path.join(ROOT, 'api', 'auth', '[action].js');
            query = Object.assign({}, query, { action: action });
        }
    }

    if (!handlerPath || !fs.existsSync(handlerPath)) {
        nodeRes.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        nodeRes.end(JSON.stringify({ success: false, message: 'API non trouvee: ' + pathname }));
        return;
    }

    try {
        delete require.cache[require.resolve(handlerPath)];
        const handler = require(handlerPath);
        const vercelReq = buildApiRequest(nodeReq, url);
        vercelReq.query = query;
        if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
            vercelReq.body = await readRequestBody(nodeReq);
        }
        const vercelRes = createVercelRes(nodeRes);
        await handler(vercelReq, vercelRes);
        if (!nodeRes.headersSent) {
            nodeRes.statusCode = 200;
            nodeRes.end();
        }
    } catch (err) {
        console.error('[dev-server] API error', pathname, err);
        if (!nodeRes.headersSent) {
            nodeRes.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            nodeRes.end(JSON.stringify({ success: false, message: String(err.message || err) }));
        }
    }
}

function serveStatic(nodeReq, nodeRes, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) {
        nodeRes.writeHead(403);
        nodeRes.end('Forbidden');
        return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        nodeRes.writeHead(404);
        nodeRes.end('Not found');
        return;
    }
    const ext = path.extname(filePath).toLowerCase();
    nodeRes.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(nodeRes);
}

loadEnvLocal();

const server = http.createServer(async function (nodeReq, nodeRes) {
    const url = new URL(nodeReq.url, 'http://127.0.0.1:' + PORT);
    if (url.pathname.startsWith('/api/')) {
        await handleApi(nodeReq, nodeRes, url);
        return;
    }
    serveStatic(nodeReq, nodeRes, url);
});

server.listen(PORT, function () {
    console.log('');
    console.log('  BATMAR dev server');
    console.log('  Local:   http://localhost:' + PORT);
    console.log('  Reseau:  http://127.0.0.1:' + PORT);
    console.log('');
    console.log('  API /api/* active. Copiez .env.example vers .env.local pour le login.');
    console.log('  Demo activos (sans API): http://localhost:' + PORT + '/?activosDemo=1');
    console.log('');
});
