/**
 * Serverless function para Vercel
 * Crea pedidos en ERP via POST al endpoint configurado en ERP_CREATE_ORDER_PATH.
 * Ejemplo: ERP_CREATE_ORDER_PATH=/pedidos/crear -> https://.../api/tienda/v1/pedidos/crear
 * Reenvia el body del POST (serie, centro_venta, lineas, etc.) con Bearer token.
 *
 * Comprobacion anti-duplicados: antes de enviar al ERP se consulta la tabla
 * erp_referencias_comprobacion. Si la referencia (ej: RQC/312-995618) ya existe,
 * no se llama a la API del ERP y se devuelve el pedido_erp ya registrado.
 */

const { fetchWithTimeout, parseJsonResponse, buildUrl } = require('./erp-https');
const { createClient } = require('@supabase/supabase-js');

/**
 * Adapta el payload al formato del ERP: exige lineas[] (minimo 1).
 * Si el cliente envia articulos[], se mapean a lineas[].
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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
    const createOrderPath = process.env.ERP_CREATE_ORDER_PATH || '';
    const username = process.env.ERP_USER || '';
    const password = process.env.ERP_PASSWORD || '';
    const timeoutMs = parseInt(process.env.ERP_REQUEST_TIMEOUT_MS || '15000', 10);

    if (!baseUrl || !createOrderPath || !username || !password) {
        const missing = [];
        if (!baseUrl) missing.push('ERP_BASE_URL');
        if (!createOrderPath) missing.push('ERP_CREATE_ORDER_PATH');
        if (!username) missing.push('ERP_USER');
        if (!password) missing.push('ERP_PASSWORD');
        
        res.status(500).json({
            message: 'ERP no esta completamente configurado. Configura en Vercel: Settings -> Environment Variables',
            missing: missing
        });
        return;
    }

    try {
        const payload = buildCreateOrderPayload(req.body || {});

        // Comprobacion anti-duplicados: si la referencia ya se envio al ERP, devolver pedido_erp sin llamar a la API
        const referencia = payload.referencia || '';
        if (referencia) {
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (supabaseUrl && supabaseKey) {
                const supabase = createClient(supabaseUrl, supabaseKey);
                const { data: row, error } = await supabase
                    .from('erp_referencias_comprobacion')
                    .select('pedido_erp')
                    .eq('referencia', referencia)
                    .maybeSingle();
                if (!error && row && row.pedido_erp) {
                    res.status(200).json({ pedido: row.pedido_erp });
                    return;
                }
            }
        }

        const token = await loginToErp({
            baseUrl,
            loginPath,
            username,
            password,
            timeoutMs
        });

        const orderResponse = await sendOrderToErp({
            baseUrl,
            createOrderPath,
            token,
            payload,
            timeoutMs
        });

        // Registrar referencia + pedido_erp para evitar reenviar el mismo pedido en el futuro
        const pedidoErp = orderResponse && (orderResponse.pedido || (orderResponse.data && orderResponse.data.pedido));
        if (referencia && pedidoErp) {
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
            if (supabaseUrl && supabaseKey) {
                try {
                    const supabase = createClient(supabaseUrl, supabaseKey);
                    await supabase.from('erp_referencias_comprobacion').insert({
                        referencia,
                        pedido_erp: String(pedidoErp)
                    });
                } catch (insertErr) {
                    console.error('Error al registrar referencia ERP:', insertErr);
                }
            }
        }

        res.status(200).json(orderResponse);
    } catch (error) {
        res.status(502).json({ message: error.message || 'Error en ERP' });
    }
};

async function loginToErp({ baseUrl, loginPath, username, password, timeoutMs }) {
    const response = await fetchWithTimeout(buildUrl(baseUrl, loginPath), {
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
    const response = await fetchWithTimeout(buildUrl(baseUrl, createOrderPath), {
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
        throw new Error(`ERP order error ${response.status}: ${statusMessage}`);
    }

    return data;
}
