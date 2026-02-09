/**
 * Serverless function para Vercel
 * Retorna la configuración de Supabase desde variables de entorno
 */

module.exports = (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // Manejar OPTIONS para CORS
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Obtener credenciales desde variables de entorno de Vercel
    const config = {
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
        ERP_PROXY_PATH: process.env.ERP_PROXY_PATH || '/api/erp/pedidos'
    };

    // Log para debugging (solo en desarrollo)
    if (process.env.NODE_ENV !== 'production') {
        console.log('Config API llamada:', {
            hasUrl: !!config.SUPABASE_URL,
            hasKey: !!config.SUPABASE_ANON_KEY
        });
    }

    res.status(200).json(config);
};

