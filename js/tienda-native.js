/**
 * Puente JS hacia TiendaPC.exe (pywebview.api) para albaranes presenciales.
 */
(function (global) {
    const ALBARAN_PDF_POLL_MS = 1500;
    const ALBARAN_PDF_MAX_WAIT_MS = 90000;

    function getApi() {
        return global.pywebview && global.pywebview.api ? global.pywebview.api : null;
    }

    function isAvailable() {
        const api = getApi();
        return !!(api && typeof api.check_albaran_pdf_ready === 'function');
    }

    async function whenReady() {
        if (isAvailable()) {
            return true;
        }
        return new Promise((resolve) => {
            const deadline = Date.now() + 15000;
            const onReady = () => {
                if (isAvailable()) {
                    global.removeEventListener('pywebviewready', onReady);
                    resolve(true);
                }
            };
            global.addEventListener('pywebviewready', onReady);
            const tick = () => {
                if (isAvailable()) {
                    global.removeEventListener('pywebviewready', onReady);
                    resolve(true);
                    return;
                }
                if (Date.now() >= deadline) {
                    global.removeEventListener('pywebviewready', onReady);
                    resolve(false);
                    return;
                }
                setTimeout(tick, 200);
            };
            tick();
        });
    }

    function tiendaLog(level, message, source) {
        if (global.TiendaLog && typeof global.TiendaLog.append === 'function') {
            global.TiendaLog.append(level, message, source || 'tienda-native');
        }
    }

    async function checkAlbaranPdfReady(albaran) {
        const api = getApi();
        if (!api || !api.check_albaran_pdf_ready) {
            return { ready: false, message: 'API no disponible' };
        }
        try {
            return await api.check_albaran_pdf_ready(albaran);
        } catch (e) {
            tiendaLog('error', 'check_albaran_pdf_ready: ' + (e.message || String(e)), 'pdf');
            return { ready: false, message: e.message || String(e) };
        }
    }

    async function waitForAlbaranPdfReady(albaran) {
        tiendaLog('info', 'Esperando PDF del albaran ' + albaran + ' en UNC...', 'pdf');
        const deadline = Date.now() + ALBARAN_PDF_MAX_WAIT_MS;
        while (Date.now() < deadline) {
            const check = await checkAlbaranPdfReady(albaran);
            if (check && check.ready) {
                tiendaLog('ok', 'PDF listo: ' + (check.path || albaran), 'pdf');
                return true;
            }
            await new Promise((r) => setTimeout(r, ALBARAN_PDF_POLL_MS));
        }
        tiendaLog('error', 'Timeout esperando PDF del albaran ' + albaran, 'pdf');
        return false;
    }

    async function getSignaturePadOptions() {
        const api = getApi();
        if (!api || !api.get_signature_pad_options) {
            return {
                tabletMode: true,
                tabletMapToCanvas: true,
                fillContainer: true,
                tabletMapRoot: 'albaranSignaturePadWrapper'
            };
        }
        try {
            return await api.get_signature_pad_options();
        } catch (e) {
            console.warn('TiendaNative.getSignaturePadOptions:', e);
            return {
                tabletMode: true,
                tabletMapToCanvas: true,
                fillContainer: true,
                tabletMapRoot: 'albaranSignaturePadWrapper'
            };
        }
    }

    async function applyAlbaranSignature(albaran, signatureDataUrl) {
        const api = getApi();
        if (!api || !api.apply_albaran_signature) {
            tiendaLog('error', 'apply_albaran_signature no disponible', 'firma');
            return { success: false, message: 'apply_albaran_signature no disponible' };
        }
        tiendaLog('info', 'Guardando firma en albaran ' + albaran + '...', 'firma');
        try {
            const result = await api.apply_albaran_signature(albaran, signatureDataUrl);
            if (result && result.success === true) {
                tiendaLog(
                    'ok',
                    'Firma guardada (' + (result.elapsed_ms != null ? result.elapsed_ms + ' ms' : 'ok') + ')',
                    'firma'
                );
            } else {
                tiendaLog('error', (result && result.message) || 'No se pudo guardar la firma', 'firma');
            }
            return result;
        } catch (e) {
            tiendaLog('error', 'apply_albaran_signature: ' + (e.message || String(e)), 'firma');
            return { success: false, message: e.message || String(e) };
        }
    }

    async function sendModulaPedido(payload) {
        const api = getApi();
        if (!api || !api.send_modula_pedido) {
            tiendaLog('error', 'send_modula_pedido no disponible', 'modula');
            return { success: false, message: 'send_modula_pedido no disponible' };
        }
        const almacen = payload && payload.almacen ? payload.almacen : '';
        const albaran = payload && payload.albaran ? payload.albaran : '';
        const numLineas = payload && Array.isArray(payload.lineas) ? payload.lineas.length : 0;
        tiendaLog(
            'info',
            'Enviando pedido Modula (' + almacen + '): albaran ' + albaran + ', ' + numLineas + ' lineas',
            'modula'
        );
        try {
            const result = await api.send_modula_pedido(payload);
            if (result && result.success === true) {
                tiendaLog('ok', result.message || 'Pedido Modula enviado', 'modula');
            } else {
                tiendaLog('error', (result && result.message) || 'Error al enviar a Modula', 'modula');
            }
            return result;
        } catch (e) {
            tiendaLog('error', 'send_modula_pedido: ' + (e.message || String(e)), 'modula');
            return { success: false, message: e.message || String(e) };
        }
    }

    async function printAlbaran(albaran, options) {
        const opts = options || {};
        const copies = opts.copies != null ? Number(opts.copies) : 1;
        const api = getApi();
        if (!api || !api.print_albaran_default) {
            tiendaLog('error', 'print_albaran_default no disponible', 'impresion');
            return { success: false, message: 'print_albaran_default no disponible' };
        }
        tiendaLog('info', 'Imprimiendo albaran ' + albaran + ' (' + copies + ' copias)...', 'impresion');
        try {
            const result = await api.print_albaran_default(albaran, copies);
            if (result && result.success === true) {
                tiendaLog('ok', 'Impresion completada (' + copies + ' copias)', 'impresion');
            } else {
                tiendaLog('error', (result && result.message) || 'Error al imprimir', 'impresion');
            }
            return result;
        } catch (e) {
            tiendaLog('error', 'print_albaran_default: ' + (e.message || String(e)), 'impresion');
            return { success: false, message: e.message || String(e) };
        }
    }

    /**
     * Borra sesion y credenciales al cerrar TiendaPC (PC compartido entre trabajadores).
     * No toca version_hash_local, stock ni IndexedDB del catalogo.
     */
    function clearAccessDataOnExit() {
        try {
            localStorage.removeItem('current_user');
            localStorage.removeItem('current_session');
            localStorage.removeItem('scan_remember_credentials');
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k.indexOf('sb-') === 0 && k.indexOf('auth') !== -1) {
                    keysToRemove.push(k);
                }
            }
            keysToRemove.forEach(function (k) {
                localStorage.removeItem(k);
            });
        } catch (e) {
            console.warn('TiendaNative.clearAccessDataOnExit:', e);
        }
        try {
            if (window.supabaseClient && typeof window.supabaseClient.signOutAuth === 'function') {
                window.supabaseClient.signOutAuth().catch(function () {});
            }
        } catch (e2) {
            console.warn('TiendaNative signOutAuth al cerrar:', e2);
        }
    }

    function registerAccessCleanupOnExit() {
        if (!isAvailable()) {
            return;
        }
        if (global.__tiendaAccessCleanupRegistered) {
            return;
        }
        global.__tiendaAccessCleanupRegistered = true;
        global.addEventListener('beforeunload', function () {
            clearAccessDataOnExit();
        });
        global.addEventListener('pagehide', function () {
            clearAccessDataOnExit();
        });
    }

    if (isAvailable()) {
        registerAccessCleanupOnExit();
    } else {
        global.addEventListener('pywebviewready', function () {
            registerAccessCleanupOnExit();
        });
    }

    global.TiendaNative = {
        isAvailable,
        whenReady,
        checkAlbaranPdfReady,
        waitForAlbaranPdfReady,
        getSignaturePadOptions,
        applyAlbaranSignature,
        sendModulaPedido,
        printAlbaran,
        clearAccessDataOnExit
    };
})(window);
