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

    async function checkAlbaranPdfReady(albaran) {
        const api = getApi();
        if (!api || !api.check_albaran_pdf_ready) {
            return { ready: false, message: 'API no disponible' };
        }
        try {
            return await api.check_albaran_pdf_ready(albaran);
        } catch (e) {
            return { ready: false, message: e.message || String(e) };
        }
    }

    async function waitForAlbaranPdfReady(albaran) {
        const deadline = Date.now() + ALBARAN_PDF_MAX_WAIT_MS;
        while (Date.now() < deadline) {
            const check = await checkAlbaranPdfReady(albaran);
            if (check && check.ready) {
                return true;
            }
            await new Promise((r) => setTimeout(r, ALBARAN_PDF_POLL_MS));
        }
        return false;
    }

    async function applyAlbaranSignature(albaran, signatureDataUrl) {
        const api = getApi();
        if (!api || !api.apply_albaran_signature) {
            return { success: false, message: 'apply_albaran_signature no disponible' };
        }
        try {
            return await api.apply_albaran_signature(albaran, signatureDataUrl);
        } catch (e) {
            return { success: false, message: e.message || String(e) };
        }
    }

    async function printAlbaran(albaran, options) {
        const opts = options || {};
        const copies = opts.copies != null ? Number(opts.copies) : 1;
        const api = getApi();
        if (!api || !api.print_albaran_default) {
            return { success: false, message: 'print_albaran_default no disponible' };
        }
        try {
            return await api.print_albaran_default(albaran, copies);
        } catch (e) {
            return { success: false, message: e.message || String(e) };
        }
    }

    global.TiendaNative = {
        isAvailable,
        whenReady,
        checkAlbaranPdfReady,
        waitForAlbaranPdfReady,
        applyAlbaranSignature,
        printAlbaran
    };
})(window);
