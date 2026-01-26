/**
 * Cliente ERP para Scan as You Shop
 * Maneja autenticacion bearer y envio de pedidos
 */

class ERPClient {
    constructor() {
        this.baseUrl = '';
        this.loginPath = '/login';
        this.createOrderPath = '';
        this.proxyPath = '';
        this.username = '';
        this.password = '';
        this.tokenLifetimeHours = 8;
        this.timeoutMs = 15000;
        this.token = null;
        this.tokenExpiresAt = null;
    }

    /**
     * Inicializa la configuracion del ERP
     */
    initialize() {
        const erpConfig = window.CONFIG && window.CONFIG.ERP ? window.CONFIG.ERP : null;
        if (!erpConfig) {
            return false;
        }

        this.baseUrl = erpConfig.BASE_URL || '';
        this.loginPath = erpConfig.LOGIN_PATH || '/login';
        this.createOrderPath = erpConfig.CREATE_ORDER_PATH || '';
        this.proxyPath = erpConfig.PROXY_PATH || '';
        this.username = erpConfig.USER || '';
        this.password = erpConfig.PASSWORD || '';
        this.tokenLifetimeHours = erpConfig.TOKEN_LIFETIME_HOURS || 8;
        this.timeoutMs = erpConfig.REQUEST_TIMEOUT_MS || 15000;

        this._loadTokenFromStorage();
        return true;
    }

    /**
     * Envia un pedido al ERP usando bearer token
     */
    async createRemoteOrder(payload) {
        if (this.proxyPath) {
            return await this._requestProxy(this.proxyPath, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        }

        if (!this.createOrderPath) {
            throw new Error('ERP no tiene configurado el endpoint de pedidos');
        }

        await this._ensureToken();
        return await this._request(this.createOrderPath, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    }

    async _ensureToken() {
        if (this._isTokenValid()) {
            return;
        }

        await this._login();
    }

    _isTokenValid() {
        if (!this.token || !this.tokenExpiresAt) {
            return false;
        }

        return Date.now() < this.tokenExpiresAt;
    }

    async _login() {
        if (!this.username || !this.password) {
            throw new Error('ERP no tiene usuario o password configurado');
        }

        const response = await this._request(this.loginPath, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                usuario: this.username,
                password: this.password
            }),
            skipAuth: true
        });

        const token = response?.token || response?.access_token || response?.data?.token || null;
        if (!token) {
            throw new Error('No se recibio token del ERP');
        }

        this._saveToken(token);
    }

    async _request(path, options = {}) {
        if (!this.baseUrl) {
            throw new Error('ERP no tiene configurada la base URL');
        }

        const url = this._buildUrl(path);
        const headers = Object.assign({}, options.headers || {});
        if (!options.skipAuth) {
            if (!this.token) {
                throw new Error('Token ERP no disponible');
            }
            headers.Authorization = `Bearer ${this.token}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers,
                body: options.body || null,
                signal: controller.signal
            });

            const responseText = await response.text();
            let data = null;
            try {
                data = responseText ? JSON.parse(responseText) : null;
            } catch (parseError) {
                data = responseText;
            }

            if (!response.ok) {
                const statusMessage = data && data.message ? data.message : response.statusText;
                throw new Error(`ERP error ${response.status}: ${statusMessage}`);
            }

            return data;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async _requestProxy(path, options = {}) {
        const headers = Object.assign({}, options.headers || {});
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(path, {
                method: options.method || 'GET',
                headers,
                body: options.body || null,
                signal: controller.signal
            });

            const responseText = await response.text();
            let data = null;
            try {
                data = responseText ? JSON.parse(responseText) : null;
            } catch (parseError) {
                data = responseText;
            }

            if (!response.ok) {
                const statusMessage = data && data.message ? data.message : response.statusText;
                throw new Error(`ERP error ${response.status}: ${statusMessage}`);
            }

            return data;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    _buildUrl(path) {
        const base = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        return `${base}${cleanPath}`;
    }

    _saveToken(token) {
        this.token = token;
        this.tokenExpiresAt = Date.now() + this.tokenLifetimeHours * 60 * 60 * 1000;
        localStorage.setItem('erp_token', this.token);
        localStorage.setItem('erp_token_expires_at', this.tokenExpiresAt.toString());
    }

    _loadTokenFromStorage() {
        const storedToken = localStorage.getItem('erp_token');
        const storedExpiresAt = localStorage.getItem('erp_token_expires_at');
        if (storedToken && storedExpiresAt) {
            const expiresAt = parseInt(storedExpiresAt, 10);
            if (!Number.isNaN(expiresAt)) {
                this.token = storedToken;
                this.tokenExpiresAt = expiresAt;
            }
        }
    }
}

// Crear instancia global
window.erpClient = new ERPClient();
