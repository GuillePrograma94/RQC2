/**
 * Router auth (una sola funcion serverless para /api/auth/*).
 * URLs publicas sin cambios: /api/auth/login, /api/auth/change-password-user
 */

const ACTIONS = {
    login: () => require('../../lib/auth-handlers/login'),
    'change-password-user': () => require('../../lib/auth-handlers/change-password-user')
};

module.exports = async (req, res) => {
    const action = String((req.query && req.query.action) || '').toLowerCase();
    const load = ACTIONS[action];
    if (!load) {
        res.setHeader('Content-Type', 'application/json');
        res.status(404).json({
            success: false,
            message: 'Accion de auth no encontrada: ' + (action || '(vacia)')
        });
        return;
    }
    return load()(req, res);
};
