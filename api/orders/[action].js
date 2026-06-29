/**
 * Router pedidos/emails (una sola funcion serverless para /api/orders/*).
 * URLs publicas sin cambios: complete, send-confirmation-email, send-erp-failure-alert
 */

const ACTIONS = {
    complete: () => require('../../lib/orders-handlers/complete'),
    'send-confirmation-email': () => require('../../lib/orders-handlers/send-confirmation-email'),
    'send-erp-failure-alert': () => require('../../lib/orders-handlers/send-erp-failure-alert')
};

module.exports = async (req, res) => {
    const action = String((req.query && req.query.action) || '').toLowerCase();
    const load = ACTIONS[action];
    if (!load) {
        res.setHeader('Content-Type', 'application/json');
        res.status(404).json({
            success: false,
            message: 'Accion de pedidos no encontrada: ' + (action || '(vacia)')
        });
        return;
    }
    return load()(req, res);
};
