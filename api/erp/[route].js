/**
 * Router ERP (una sola funcion serverless para todas las rutas /api/erp/*).
 * URLs publicas sin cambios: /api/erp/test, /login, /pedidos, /pvp, /create-order, /debug-pedido
 */

const ROUTES = {
    test: () => require('../../lib/erp-handlers/test'),
    login: () => require('../../lib/erp-handlers/login'),
    pedidos: () => require('../../lib/erp-handlers/pedidos'),
    pvp: () => require('../../lib/erp-handlers/pvp'),
    'create-order': () => require('../../lib/erp-handlers/create-order'),
    'debug-pedido': () => require('../../lib/erp-handlers/debug-pedido')
};

module.exports = async (req, res) => {
    const route = String((req.query && req.query.route) || '').toLowerCase();
    const load = ROUTES[route];
    if (!load) {
        res.setHeader('Content-Type', 'application/json');
        res.status(404).json({
            success: false,
            message: 'Ruta ERP no encontrada: ' + (route || '(vacia)')
        });
        return;
    }
    return load()(req, res);
};
