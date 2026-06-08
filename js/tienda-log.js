/**
 * Panel de diagnostico TiendaPC: logs web + backend Python (pywebview.api).
 */
(function (global) {
    const MAX_ENTRIES = 300;
    const POLL_MS = 2000;
    const entries = [];
    let pythonLogIndex = 0;
    let pollTimer = null;
    let panelEnabled = true;
    let errorCount = 0;
    let modalOpen = false;
    let uiReady = false;

    function formatTime(date) {
        const d = date || new Date();
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        const s = String(d.getSeconds()).padStart(2, '0');
        return h + ':' + m + ':' + s;
    }

    function getApi() {
        return global.pywebview && global.pywebview.api ? global.pywebview.api : null;
    }

    function isTiendaPc() {
        const api = getApi();
        return !!(api && typeof api.get_tienda_logs === 'function');
    }

    function append(level, message, source) {
        const levelNorm = (level || 'info').toLowerCase();
        const entry = {
            ts: formatTime(),
            level: levelNorm,
            source: source || 'web',
            message: String(message || '')
        };
        entries.push(entry);
        if (entries.length > MAX_ENTRIES) {
            entries.shift();
        }
        if (levelNorm === 'error') {
            errorCount += 1;
            updateFabBadge();
        }
        if (modalOpen) {
            renderLogList();
        }
    }

    function mergePythonEntries(batch) {
        if (!batch || !batch.entries || !batch.entries.length) {
            if (batch && batch.next_index != null) {
                pythonLogIndex = batch.next_index;
            }
            return;
        }
        batch.entries.forEach(function (e) {
            entries.push({
                ts: e.ts || formatTime(),
                level: (e.level || 'info').toLowerCase(),
                source: e.source || 'tiendapc',
                message: String(e.message || '')
            });
            if ((e.level || '').toLowerCase() === 'error') {
                errorCount += 1;
            }
        });
        while (entries.length > MAX_ENTRIES) {
            entries.shift();
        }
        pythonLogIndex = batch.next_index != null ? batch.next_index : entries.length;
        updateFabBadge();
        if (modalOpen) {
            renderLogList();
        }
    }

    async function pollPythonLogs() {
        if (!isTiendaPc()) {
            return;
        }
        const api = getApi();
        try {
            const batch = await api.get_tienda_logs(pythonLogIndex);
            mergePythonEntries(batch);
        } catch (e) {
            append('warn', 'No se pudieron leer logs del PC: ' + (e.message || String(e)), 'tienda-log');
        }
    }

    function startPolling() {
        if (pollTimer) {
            return;
        }
        void pollPythonLogs();
        pollTimer = setInterval(function () {
            void pollPythonLogs();
        }, POLL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function renderLogList() {
        const listEl = document.getElementById('tiendaLogList');
        if (!listEl) {
            return;
        }
        if (!entries.length) {
            listEl.innerHTML = '<div class="tienda-log-empty">Sin entradas todavia. Los pasos del albaran y errores apareceran aqui.</div>';
            return;
        }
        const html = entries.slice().reverse().map(function (e) {
            const level = e.level || 'info';
            const src = e.source || '';
            const msg = escapeHtml(e.message || '');
            return (
                '<div class="tienda-log-line tienda-log-line--' + level + '">' +
                '<span class="tienda-log-ts">' + escapeHtml(e.ts || '') + '</span>' +
                '<span class="tienda-log-src">' + escapeHtml(src) + '</span>' +
                '<span class="tienda-log-msg">' + msg + '</span>' +
                '</div>'
            );
        }).join('');
        listEl.innerHTML = html;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildPlainTextLog() {
        return entries.map(function (e) {
            return (e.ts || '') + ' [' + (e.level || 'info') + '] [' + (e.source || '') + '] ' + (e.message || '');
        }).join('\n');
    }

    function updateFabBadge() {
        const fab = document.getElementById('tiendaLogFab');
        const badge = document.getElementById('tiendaLogFabBadge');
        if (!fab || !badge) {
            return;
        }
        if (errorCount > 0) {
            badge.textContent = errorCount > 99 ? '99+' : String(errorCount);
            badge.style.display = 'inline-flex';
            fab.classList.add('tienda-log-fab--has-errors');
        } else {
            badge.style.display = 'none';
            fab.classList.remove('tienda-log-fab--has-errors');
        }
    }

    function openPanel() {
        const modal = document.getElementById('tiendaLogModal');
        if (!modal) {
            return;
        }
        modalOpen = true;
        modal.style.display = 'flex';
        renderLogList();
        void pollPythonLogs();
        errorCount = 0;
        updateFabBadge();
    }

    function closePanel() {
        const modal = document.getElementById('tiendaLogModal');
        if (modal) {
            modal.style.display = 'none';
        }
        modalOpen = false;
    }

    async function clearLogs() {
        entries.length = 0;
        errorCount = 0;
        pythonLogIndex = 0;
        updateFabBadge();
        renderLogList();
        const api = getApi();
        if (api && api.clear_tienda_logs) {
            try {
                await api.clear_tienda_logs();
            } catch (e) {
                append('warn', 'No se pudo limpiar log del PC: ' + (e.message || String(e)), 'tienda-log');
            }
        }
        append('info', 'Log limpiado', 'tienda-log');
    }

    function copyLogs() {
        const text = buildPlainTextLog();
        if (!text) {
            append('warn', 'No hay lineas para copiar', 'tienda-log');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                append('ok', 'Log copiado al portapapeles', 'tienda-log');
            }).catch(function () {
                append('warn', 'No se pudo copiar al portapapeles', 'tienda-log');
            });
        } else {
            append('warn', 'Portapapeles no disponible en este navegador', 'tienda-log');
        }
    }

    function updateUiVisibility() {
        const fab = document.getElementById('tiendaLogFab');
        const menuBtn = document.getElementById('tiendaDiagnosticoBtn');
        const show = isTiendaPc() && panelEnabled;
        if (fab) {
            fab.style.display = show ? 'flex' : 'none';
        }
        if (menuBtn) {
            menuBtn.style.display = show ? '' : 'none';
        }
    }

    function bindUi() {
        if (uiReady) {
            return;
        }
        uiReady = true;

        const fab = document.getElementById('tiendaLogFab');
        const closeBtn = document.getElementById('tiendaLogCloseBtn');
        const clearBtn = document.getElementById('tiendaLogClearBtn');
        const copyBtn = document.getElementById('tiendaLogCopyBtn');
        const overlay = document.getElementById('tiendaLogModalOverlay');
        const menuBtn = document.getElementById('tiendaDiagnosticoBtn');

        if (fab) {
            fab.addEventListener('click', openPanel);
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', closePanel);
        }
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                void clearLogs();
            });
        }
        if (copyBtn) {
            copyBtn.addEventListener('click', copyLogs);
        }
        if (overlay) {
            overlay.addEventListener('click', closePanel);
        }
        if (menuBtn) {
            menuBtn.addEventListener('click', function () {
                if (global.app && typeof global.app.closeMenu === 'function') {
                    global.app.closeMenu();
                }
                openPanel();
            });
        }
    }

    async function loadPanelConfig() {
        const api = getApi();
        if (!api || !api.get_tienda_log_panel_enabled) {
            panelEnabled = true;
            return;
        }
        try {
            const cfg = await api.get_tienda_log_panel_enabled();
            panelEnabled = !(cfg && cfg.enabled === false);
        } catch (e) {
            panelEnabled = true;
        }
    }

    async function init() {
        bindUi();
        if (!isTiendaPc()) {
            updateUiVisibility();
            return;
        }
        await loadPanelConfig();
        updateUiVisibility();
        append('info', 'TiendaPC conectado. Panel de diagnostico activo.', 'tienda-log');
        startPolling();
    }

    function onPywebviewReady() {
        void init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindUi);
    } else {
        bindUi();
    }

    if (isTiendaPc()) {
        void init();
    } else {
        global.addEventListener('pywebviewready', onPywebviewReady);
    }

    global.TiendaLog = {
        append: append,
        info: function (msg, source) { append('info', msg, source); },
        warn: function (msg, source) { append('warn', msg, source); },
        error: function (msg, source) { append('error', msg, source); },
        ok: function (msg, source) { append('ok', msg, source); },
        openPanel: openPanel,
        closePanel: closePanel,
        refreshVisibility: updateUiVisibility,
        isAvailable: isTiendaPc
    };
})(window);
