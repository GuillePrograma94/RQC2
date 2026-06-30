/**
 * Gestion de activos de empresa (mobiliario).
 * Registro extensible de categorias; UI admin (ADMINISTRACION) y usuarios asignados (DEPENDIENTE/COMERCIAL/ADMINISTRADOR).
 */

const ACTIVOS_CATEGORIAS = {
    vehiculo: {
        codigo: 'vehiculo',
        nombre: 'Vehiculos',
        identificadorLabel: 'Matricula',
        adminFields: [
            { key: 'modelo', label: 'Modelo', type: 'text' },
            { key: 'kilometraje_actual', label: 'Kilometraje actual', type: 'number', required: true },
            { key: 'fecha_itv', label: 'Fecha ITV', type: 'date' }
        ],
        trabajadorPuedeRegistrar: true,
        eventoTipo: 'uso_vehiculo'
    },
    impresora: {
        codigo: 'impresora',
        nombre: 'Impresoras',
        identificadorLabel: 'Nombre / ubicacion',
        adminFields: [
            { key: 'modelo', label: 'Modelo', type: 'text' },
            { key: 'localizacion', label: 'Localizacion', type: 'text' },
            { key: 'contador_paginas', label: 'Contador paginas', type: 'number' },
            { key: 'tipo_tinta', label: 'Tipo tinta', type: 'text' }
        ],
        trabajadorPuedeRegistrar: false,
        eventoTipo: 'evento_impresora',
        eventoLabels: {
            compteur: 'Actualizar contador',
            toner: 'Cambio toner',
            maintenance: 'Mantenimiento',
            panne: 'Averia',
            reparation: 'Reparacion'
        }
    },
    ordenador: {
        codigo: 'ordenador',
        nombre: 'Ordenadores',
        identificadorLabel: 'Numero de serie',
        adminFields: [
            { key: 'modelo', label: 'Modelo', type: 'text' },
            { key: 'procesador', label: 'Procesador', type: 'text' },
            { key: 'ram_gb', label: 'RAM (GB)', type: 'number' },
            { key: 'almacenamiento', label: 'Almacenamiento', type: 'text' }
        ],
        trabajadorPuedeRegistrar: false,
        eventoTipo: 'evento_ordenador',
        eventoLabels: {
            maintenance: 'Mantenimiento',
            panne: 'Averia',
            reparation: 'Reparacion',
            mise_a_jour: 'Actualizacion'
        }
    },
    telefono: {
        codigo: 'telefono',
        nombre: 'Telefonos',
        identificadorLabel: 'IMEI / numero',
        adminFields: [
            { key: 'modelo', label: 'Modelo', type: 'text' },
            { key: 'imei', label: 'IMEI', type: 'text' },
            { key: 'operador', label: 'Operador', type: 'text' },
            { key: 'numero_linea', label: 'Numero de linea', type: 'text' }
        ],
        trabajadorPuedeRegistrar: false,
        eventoTipo: 'evento_telefono',
        eventoLabels: {
            maintenance: 'Mantenimiento',
            panne: 'Averia',
            reparation: 'Reparacion',
            cambio_linea: 'Cambio de linea'
        }
    }
};

class ActivosManager {
    constructor(app) {
        this.app = app;
        this._adminCategoria = null;
        this._adminActivoId = null;
        this._workerActivo = null;
        this._trabajadoresCache = null;
        this._almacenesCache = null;
        this._initialized = false;
        this._vehiculoImagenPending = '';
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this._bindAdminEvents();
        this._bindWorkerEvents();
    }

    getCategoriaConfig(codigo) {
        return ACTIVOS_CATEGORIAS[codigo] || null;
    }

    _esc(s) {
        if (s == null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _bindAdminEvents() {
        const self = this;
        document.getElementById('adminVerActivosBtn')?.addEventListener('click', () => {
            self.app.showScreenAdmin('activosHub');
        });
        document.getElementById('adminActivosHubBackBtn')?.addEventListener('click', () => {
            self.app.showScreenAdmin('inicio');
            self.app.updateActiveNavAdmin('inicio');
        });
        document.getElementById('adminActivosListBackBtn')?.addEventListener('click', () => {
            self.app.showScreenAdmin('activosHub');
        });
        document.getElementById('adminActivoFormBackBtn')?.addEventListener('click', () => {
            if (self._adminCategoria) {
                self.app.showScreenAdmin('activosList', self._adminCategoria);
            } else {
                self.app.showScreenAdmin('activosHub');
            }
        });
        document.getElementById('adminActivoDetailBackBtn')?.addEventListener('click', () => {
            if (self._adminCategoria) {
                self.app.showScreenAdmin('activosList', self._adminCategoria);
            } else {
                self.app.showScreenAdmin('activosHub');
            }
        });
        document.getElementById('adminActivosNuevoBtn')?.addEventListener('click', () => {
            self._adminActivoId = null;
            self.app.showScreenAdmin('activoForm', self._adminCategoria);
        });
        document.getElementById('adminActivosSeguroBtn')?.addEventListener('click', () => {
            self.openAdminSeguroModal();
        });
        document.getElementById('adminActivosTalleresBtn')?.addEventListener('click', () => {
            self.openAdminTalleresModal();
        });
        document.getElementById('adminActivosSeguroModalClose')?.addEventListener('click', () => {
            self.closeAdminSeguroModal();
        });
        document.getElementById('adminActivosSeguroModalOverlay')?.addEventListener('click', () => {
            self.closeAdminSeguroModal();
        });
        document.getElementById('adminActivosSeguroAddBtn')?.addEventListener('click', () => {
            self.addAdminSeguroRow();
        });
        document.getElementById('adminActivosSeguroGuardarBtn')?.addEventListener('click', () => {
            self.saveAdminSeguroModal();
        });
        document.getElementById('adminActivosTalleresModalClose')?.addEventListener('click', () => {
            self.closeAdminTalleresModal();
        });
        document.getElementById('adminActivosTalleresModalOverlay')?.addEventListener('click', () => {
            self.closeAdminTalleresModal();
        });
        document.getElementById('adminActivosTalleresAlmacen')?.addEventListener('change', () => {
            self._onTalleresAlmacenChange();
        });
        document.getElementById('adminActivosTalleresAddBtn')?.addEventListener('click', () => {
            self.addAdminTallerRow();
        });
        document.getElementById('adminActivosTalleresGuardarBtn')?.addEventListener('click', () => {
            self.saveAdminTalleresModal();
        });
        document.getElementById('adminActivoGuardarBtn')?.addEventListener('click', () => {
            self.saveAdminActivoForm();
        });
        document.getElementById('adminActivoEliminarBtn')?.addEventListener('click', () => {
            self.deleteAdminActivoForm();
        });
        document.getElementById('adminActivoAsignarBtn')?.addEventListener('click', () => {
            self.assignFromDetail();
        });
        document.getElementById('adminActivoDesasignarBtn')?.addEventListener('click', () => {
            self.desasignarFromDetail();
        });
        document.getElementById('adminActivoEventoBtn')?.addEventListener('click', () => {
            self.registerAdminEvento();
        });
    }

    _bindWorkerEvents() {
        const self = this;
        document.getElementById('herramientaMisActivosBtn')?.addEventListener('click', () => {
            self.app.showScreen('misActivos');
        });
        document.getElementById('misActivosBackBtn')?.addEventListener('click', () => {
            self.app.showScreen('herramientas');
        });
        document.getElementById('misActivoDetailBackBtn')?.addEventListener('click', () => {
            self.app.showScreen('misActivos');
        });
        document.getElementById('misActivoUsoVehiculoBtn')?.addEventListener('click', () => {
            self.registerWorkerVehicleUsage();
        });
        document.getElementById('activosRegistroModalClose')?.addEventListener('click', () => {
            self.closeWorkerRegistroModal();
        });
        document.getElementById('activosRegistroModalOverlay')?.addEventListener('click', () => {
            self.closeWorkerRegistroModal();
        });
        document.getElementById('activosRegistroModalCancelBtn')?.addEventListener('click', () => {
            self.closeWorkerRegistroModal();
        });
    }

    async loadAdminActivosCard() {
        const el = document.getElementById('adminActivosCount');
        if (!el) return;
        el.textContent = '...';
        const conteos = await window.supabaseClient.getActivosConteosCategorias();
        const total = (conteos || []).reduce((sum, c) => sum + (Number(c.total) || 0), 0);
        el.textContent = String(total);
    }

    async renderAdminHub() {
        const listEl = document.getElementById('adminActivosHubList');
        if (!listEl) return;
        listEl.innerHTML = '<p>Cargando...</p>';
        const conteos = await window.supabaseClient.getActivosConteosCategorias();
        if (!conteos || conteos.length === 0) {
            listEl.innerHTML = '<p>No hay categorias de activos configuradas.</p>';
            return;
        }
        listEl.innerHTML = conteos.map(c => {
            const cfg = this.getCategoriaConfig(c.codigo);
            const label = cfg ? cfg.nombre : c.nombre;
            return (
                '<button type="button" class="activos-hub-card admin-list-item" data-categoria="' + this._esc(c.codigo) + '">' +
                '<span class="activos-hub-card-title">' + this._esc(label) + '</span>' +
                '<span class="activos-hub-card-meta">' + this._esc(String(c.total || 0)) + ' activos, ' +
                this._esc(String(c.asignados || 0)) + ' asignados</span>' +
                '</button>'
            );
        }).join('');

        listEl.querySelectorAll('[data-categoria]').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.getAttribute('data-categoria');
                this.app.showScreenAdmin('activosList', cat);
            });
        });
    }

    async renderAdminList(categoria) {
        this._adminCategoria = categoria;
        const cfg = this.getCategoriaConfig(categoria);
        const titleEl = document.getElementById('adminActivosListTitle');
        if (titleEl) titleEl.textContent = cfg ? cfg.nombre : categoria;

        const listEl = document.getElementById('adminActivosList');
        if (!listEl) return;
        listEl.innerHTML = '<p>Cargando...</p>';

        const list = await window.supabaseClient.getActivosPorCategoria(categoria);
        const esVehiculos = categoria === 'vehiculo';
        const seguroBtn = document.getElementById('adminActivosSeguroBtn');
        const talleresBtn = document.getElementById('adminActivosTalleresBtn');
        if (seguroBtn) seguroBtn.style.display = esVehiculos ? '' : 'none';
        if (talleresBtn) talleresBtn.style.display = esVehiculos ? '' : 'none';

        if (!list || list.length === 0) {
            listEl.classList.remove('activos-vehiculos-grid', 'activos-admin-vehiculos-list');
            listEl.innerHTML = '<p>No hay activos en esta categoria.</p>';
            return;
        }

        listEl.classList.remove('activos-admin-vehiculos-list');
        listEl.classList.toggle('activos-vehiculos-grid', esVehiculos);

        if (esVehiculos) {
            const usosHoy = await Promise.all(
                list.map(a => window.supabaseClient.getActivoUsoVehiculoHoy(a.id))
            );
            list.forEach((a, i) => { a.uso_hoy = usosHoy[i]; });
        }

        listEl.innerHTML = list.map(a => {
            if (esVehiculos) return this._renderVehiculoFichaListItem(a);
            const asignado = a.asignado_nombre
                ? this._esc(a.asignado_nombre) + ' (' + this._esc(a.asignado_tipo || '') + ' - ' + this._esc(a.asignado_codigo || '') + ')'
                : 'Sin asignar';
            const almacenTxt = a.almacen ? 'Almacen: ' + this._esc(a.almacen) + ' | ' : '';
            return (
                '<button type="button" class="admin-list-item activos-list-item" data-id="' + this._esc(a.id) + '">' +
                '<strong>' + this._esc(a.nombre) + '</strong>' +
                (a.identificador ? ' <span class="activos-list-id">' + this._esc(a.identificador) + '</span>' : '') +
                '<br><span class="activos-list-meta">' + almacenTxt + 'Estado: ' + this._esc(a.estado) + ' | ' + asignado + '</span>' +
                '</button>'
            );
        }).join('');

        listEl.querySelectorAll('[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (esVehiculos) {
                    this.app.showScreenAdmin('activoForm', id);
                } else {
                    this.app.showScreenAdmin('activoDetail', id);
                }
            });
        });
    }

    _formatFechaDdMmAa(fecha) {
        if (!fecha) return '';
        const s = String(fecha).slice(0, 10);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return s;
        return m[3] + '/' + m[2] + '/' + m[1].slice(-2);
    }

    _formatItvBadge(fechaItv) {
        if (!fechaItv) return '';
        const vencida = this._isItvVencida(fechaItv);
        const cls = vencida ? 'activos-badge-itv-vencida' : 'activos-badge-itv-ok';
        const fechaTxt = this._formatFechaDdMmAa(fechaItv);
        const txt = vencida ? 'ITV VENCIDA' : 'ITV: ' + fechaTxt;
        return '<span class="activos-badge ' + cls + '">' + this._esc(txt) + '</span>';
    }

    _isItvVencida(fechaItv) {
        if (!fechaItv) return false;
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const itv = new Date(fechaItv + 'T00:00:00');
        if (isNaN(itv.getTime())) return false;
        return itv < hoy;
    }

    _isVehiculoEnTaller(estado) {
        const st = String(estado || '').toLowerCase();
        return st === 'mantenimiento' || st === 'averia';
    }

    _getVehiculoDisponibilidadBadge(activo) {
        const datos = (activo && activo.datos) || {};
        const itvVencida = this._isItvVencida(datos.fecha_itv);
        const enTaller = this._isVehiculoEnTaller(activo && activo.estado);
        if (itvVencida || enTaller) {
            return { label: 'NO DISPONIBLE', className: 'activos-vehiculo-badge-no-disponible' };
        }
        if (activo && activo.asignado_nombre) {
            return { label: 'OK', className: 'activos-vehiculo-badge-ok' };
        }
        return { label: 'DISPONIBLE', className: 'activos-vehiculo-badge-disponible' };
    }

    _getVehiculoImagenPlaceholder() {
        return 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#9370DB"/><stop offset="100%" stop-color="#7851A9"/>' +
            '</linearGradient></defs>' +
            '<rect width="320" height="200" fill="url(#g)"/>' +
            '<g fill="#fff" opacity="0.92" transform="translate(78,58)">' +
            '<rect x="18" y="44" width="148" height="44" rx="10"/>' +
            '<rect x="34" y="24" width="88" height="34" rx="8"/>' +
            '<circle cx="44" cy="92" r="16"/><circle cx="140" cy="92" r="16"/>' +
            '</g></svg>'
        );
    }

    _getVehiculoImagenUrl(datos) {
        const url = datos && datos.imagen_url;
        return (url && String(url).trim()) ? String(url).trim() : this._getVehiculoImagenPlaceholder();
    }

    _formatUsoHoyValor(val, opts) {
        if (val == null || val === '') return '—';
        const n = Number(val);
        if (!Number.isFinite(n)) return '—';
        const decimals = opts && opts.decimals != null ? opts.decimals : 0;
        return n.toLocaleString('es-ES', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    _renderVehiculoUsoHoyStats(usoHoy, compact, variant) {
        const km = this._formatUsoHoyValor(usoHoy && usoHoy.km_dia != null ? usoHoy.km_dia : null, { decimals: 0 });
        const litros = this._formatUsoHoyValor(usoHoy && usoHoy.litros != null ? usoHoy.litros : null, { decimals: 1 });
        const costeRaw = usoHoy && usoHoy.coste != null ? usoHoy.coste : null;
        const coste = costeRaw != null && costeRaw !== ''
            ? this._formatUsoHoyValor(costeRaw, { decimals: 2 })
            : '—';
        const costeAdmin = coste !== '—' ? coste + ' €' : '—';

        if (variant === 'worker') {
            return (
                '<div class="activos-hoy-worker">' +
                '<div class="activos-hoy-worker-head">' +
                '<span class="activos-hoy-worker-badge">Hoy</span>' +
                '</div>' +
                '<div class="activos-hoy-worker-grid">' +
                '<div class="activos-hoy-worker-stat">' +
                '<span class="activos-hoy-worker-label">Km del dia</span>' +
                '<span class="activos-hoy-worker-value">' + this._esc(km) + (km !== '—' ? ' <small>km</small>' : '') + '</span>' +
                '</div>' +
                '<div class="activos-hoy-worker-stat">' +
                '<span class="activos-hoy-worker-label">Litros</span>' +
                '<span class="activos-hoy-worker-value">' + this._esc(litros) + (litros !== '—' ? ' <small>L</small>' : '') + '</span>' +
                '</div>' +
                '<div class="activos-hoy-worker-stat">' +
                '<span class="activos-hoy-worker-label">Coste</span>' +
                '<span class="activos-hoy-worker-value">' + this._esc(coste) + '</span>' +
                '</div>' +
                '</div></div>'
            );
        }

        if (variant === 'admin-pretty') {
            const inner =
                '<div class="activos-admin-hoy-grid">' +
                '<div class="activos-admin-hoy-stat">' +
                '<span class="activos-admin-hoy-label">Km del dia</span>' +
                '<span class="activos-admin-hoy-value">' + this._esc(km) + (km !== '—' ? ' <small>km</small>' : '') + '</span>' +
                '</div>' +
                '<div class="activos-admin-hoy-stat">' +
                '<span class="activos-admin-hoy-label">Litros</span>' +
                '<span class="activos-admin-hoy-value">' + this._esc(litros) + (litros !== '—' ? ' <small>L</small>' : '') + '</span>' +
                '</div>' +
                '<div class="activos-admin-hoy-stat">' +
                '<span class="activos-admin-hoy-label">Coste</span>' +
                '<span class="activos-admin-hoy-value">' + this._esc(costeAdmin) + '</span>' +
                '</div>' +
                '</div>';
            return this._renderAdminVehiculoPanel('Hoy', inner);
        }

        const cls = compact ? ' activos-vehiculo-uso-hoy--compact' : ' admin-detail-completar';
        const title = compact
            ? '<div class="activos-vehiculo-uso-hoy-title">Hoy</div>'
            : '<h4 class="admin-detail-completar-title">Hoy</h4>';
        return (
            '<div class="activos-vehiculo-uso-hoy' + cls + '">' +
            title +
            '<div class="activos-vehiculo-uso-hoy-grid">' +
            '<div class="activos-vehiculo-uso-hoy-item">' +
            '<span class="activos-vehiculo-uso-hoy-label">Kilometraje del dia</span>' +
            '<span class="activos-vehiculo-uso-hoy-value">' + this._esc(km) + (km !== '—' ? ' km' : '') + '</span>' +
            '</div>' +
            '<div class="activos-vehiculo-uso-hoy-item">' +
            '<span class="activos-vehiculo-uso-hoy-label">Litros del repostaje hoy</span>' +
            '<span class="activos-vehiculo-uso-hoy-value">' + this._esc(litros) + (litros !== '—' ? ' L' : '') + '</span>' +
            '</div>' +
            '<div class="activos-vehiculo-uso-hoy-item">' +
            '<span class="activos-vehiculo-uso-hoy-label">Coste del repostaje hoy</span>' +
            '<span class="activos-vehiculo-uso-hoy-value">' + this._esc(costeAdmin) + '</span>' +
            '</div>' +
            '</div></div>'
        );
    }

    _renderVehiculoFichaInner(a, options) {
        const opts = options || {};
        const workerView = !!opts.workerView;
        const showAsignado = opts.showAsignado !== false;
        const usoCompact = opts.usoCompact !== false;
        const usoVariant = opts.usoVariant || null;
        const showUsoHoy = opts.showUsoHoy !== false;
        const badgeSource = workerView
            ? { estado: a.estado, datos: a.datos || {}, asignado_nombre: 'asignado' }
            : a;
        const badge = this._getVehiculoDisponibilidadBadge(badgeSource);
        const datos = a.datos || {};
        const modelo = datos.modelo ? this._esc(datos.modelo) : '';
        const almacen = a.almacen ? this._esc(a.almacen) : '';
        const metaParts = [modelo, almacen].filter(Boolean);
        const asignado = a.asignado_nombre
            ? this._esc(a.asignado_nombre)
            : 'Sin asignar';
        const kmActual = datos.kilometraje_actual != null
            ? '<span class="activos-vehiculo-ficha-km-actual">' + this._formatUsoHoyValor(datos.kilometraje_actual, { decimals: 0 }) + ' km</span>'
            : '';
        const imgSrc = this._esc(this._getVehiculoImagenUrl(datos));
        let inner = '';
        inner += '<div class="activos-vehiculo-ficha-img-wrap">';
        inner += '<img class="activos-vehiculo-ficha-img" src="' + imgSrc + '" alt="" loading="lazy">';
        inner += '<span class="activos-vehiculo-ficha-badge ' + badge.className + '">' + this._esc(badge.label) + '</span>';
        inner += '</div>';
        inner += '<div class="activos-vehiculo-ficha-body">';
        inner += '<span class="activos-vehiculo-ficha-nombre">' + this._esc(a.nombre) + '</span>';
        if (a.identificador) {
            inner += '<span class="activos-vehiculo-ficha-matricula">' + this._esc(a.identificador) + '</span>';
        }
        if (metaParts.length) {
            inner += '<span class="activos-vehiculo-ficha-meta">' + metaParts.join(' · ') + '</span>';
        }
        inner += kmActual;
        if (showAsignado) {
            inner += '<span class="activos-vehiculo-ficha-asignado">' + asignado + '</span>';
        }
        if (showUsoHoy && a.uso_hoy !== undefined) {
            inner += this._renderVehiculoUsoHoyStats(a.uso_hoy, usoCompact, usoVariant);
        }
        if (opts.showRegistroBtn) {
            inner += '<button type="button" id="misActivoRegistroOpenBtn" class="btn btn-primary activos-worker-registro-btn">Registrar datos del dia</button>';
        }
        if (datos.fecha_itv) {
            inner += '<span class="activos-vehiculo-ficha-itv">' + this._formatItvBadge(datos.fecha_itv) + '</span>';
        }
        inner += '</div>';
        return inner;
    }

    _renderVehiculoFichaCard(a, options) {
        const opts = options || {};
        const inner = this._renderVehiculoFichaInner(a, opts);
        if (opts.static) {
            let cls = 'activos-vehiculo-ficha activos-vehiculo-ficha--static';
            if (opts.detail) cls += ' activos-vehiculo-ficha--detail';
            return '<div class="' + cls + '">' + inner + '</div>';
        }
        return (
            '<button type="button" class="activos-vehiculo-ficha" data-id="' + this._esc(a.id) + '">' +
            inner +
            '</button>'
        );
    }

    _renderVehiculoFichaListItem(a) {
        return this._renderVehiculoFichaCard(a, { usoCompact: true, showAsignado: true });
    }

    _renderWorkerCollapsible(title, meta, bodyHtml, extraClass) {
        let cls = 'activos-historial-collapsible activos-worker-collapsible';
        if (extraClass) cls += ' ' + extraClass;
        return (
            '<details class="' + cls + '">' +
            '<summary class="activos-historial-collapsible-summary">' +
            '<span class="activos-historial-collapsible-title">' + this._esc(title) + '</span>' +
            (meta != null && meta !== ''
                ? '<span class="activos-historial-collapsible-meta">' + this._esc(meta) + '</span>'
                : '') +
            '</summary>' +
            '<div class="activos-worker-collapsible-body">' + bodyHtml + '</div>' +
            '</details>'
        );
    }

    _renderAdminVehiculoPanel(title, bodyHtml, opts) {
        const options = opts || {};
        const collapsible = !!options.collapsible;
        const panelId = options.panelId || '';
        const extraClass = options.extraClass ? ' ' + options.extraClass : '';
        const inner = '<div class="activos-admin-block-body">' + bodyHtml + '</div>';
        if (collapsible) {
            return (
                '<details class="activos-admin-block activos-admin-block--collapsible' + extraClass + '"' +
                (panelId ? ' id="' + panelId + '"' : '') + '>' +
                '<summary class="activos-admin-block-summary">' +
                '<span class="activos-admin-block-title">' + this._esc(title) + '</span>' +
                '<span class="activos-admin-block-chevron" aria-hidden="true"></span>' +
                '</summary>' +
                inner +
                '</details>'
            );
        }
        return (
            '<section class="activos-admin-block' + extraClass + '"' + (panelId ? ' id="' + panelId + '"' : '') + '>' +
            '<header class="activos-admin-block-header">' +
            '<h4 class="activos-admin-block-title">' + this._esc(title) + '</h4>' +
            '</header>' +
            inner +
            '</section>'
        );
    }

    async _loadActivosVehiculoConfig() {
        if (typeof window.supabaseClient.getActivosVehiculoConfig !== 'function') {
            return { seguro_contactos: [], talleres_por_almacen: {} };
        }
        const cfg = await window.supabaseClient.getActivosVehiculoConfig();
        return cfg || { seguro_contactos: [], talleres_por_almacen: {} };
    }

    _normalizeSeguroContactosList(raw) {
        if (!Array.isArray(raw)) return [];
        return raw.filter(c => c && (c.nombre || c.telefono));
    }

    _getTalleresReferenciaFromConfig(config, almacen) {
        const map = (config && config.talleres_por_almacen) || {};
        const cod = String(almacen || '').trim().toUpperCase();
        const list = map[cod] || map[almacen] || [];
        return Array.isArray(list) ? list.filter(t => t && (t.nombre || t.telefono || t.direccion)) : [];
    }

    _renderWorkerContactList(contactos) {
        if (!contactos || contactos.length === 0) {
            return '<p class="activos-worker-extra-empty">Sin contactos configurados.</p>';
        }
        return '<ul class="activos-worker-extra-list">' + contactos.map(c => (
            '<li class="activos-worker-extra-contact">' +
            '<span class="activos-worker-extra-contact-name">' + this._esc(c.nombre || 'Contacto') + '</span>' +
            (c.telefono
                ? '<a class="activos-worker-extra-contact-tel" href="tel:' + this._esc(String(c.telefono).replace(/\s/g, '')) + '">' + this._esc(c.telefono) + '</a>'
                : '') +
            '</li>'
        )).join('') + '</ul>';
    }

    _renderWorkerTalleresList(talleres) {
        if (!talleres || talleres.length === 0) {
            return '<p class="activos-worker-extra-empty">Sin talleres de referencia para este almacen.</p>';
        }
        return '<ul class="activos-worker-talleres-list">' + talleres.map(t => (
            '<li class="activos-worker-extra-taller">' +
            '<p class="activos-worker-extra-taller-name">' + this._esc(t.nombre || 'Taller') + '</p>' +
            (t.telefono
                ? '<a class="activos-worker-extra-contact-tel" href="tel:' + this._esc(String(t.telefono).replace(/\s/g, '')) + '">' + this._esc(t.telefono) + '</a>'
                : '') +
            (t.direccion ? '<p class="activos-worker-extra-taller-dir">' + this._esc(t.direccion) + '</p>' : '') +
            '</li>'
        )).join('') + '</ul>';
    }

    _renderVehiculoWorkerHistorialTable(registros) {
        let bodyHtml;
        if (!registros || registros.length === 0) {
            bodyHtml = '<tr><td colspan="5" class="activos-vehiculo-historial-empty">Sin registros</td></tr>';
        } else {
            bodyHtml = registros.map(r => {
                const d = r.datos || {};
                const esUso = r.tipo === 'uso_vehiculo';
                const kmDia = esUso ? this._formatUsoHoyValor(d.km_dia, { decimals: 0 }) : '—';
                const litros = esUso ? this._formatUsoHoyValor(d.litros, { decimals: 1 }) : '—';
                const coste = esUso && d.coste != null && d.coste !== ''
                    ? this._formatUsoHoyValor(d.coste, { decimals: 2 })
                    : '—';
                const kmActualCol = esUso && d.km_actual != null
                    ? this._formatUsoHoyValor(d.km_actual, { decimals: 0 })
                    : '—';
                return (
                    '<tr>' +
                    '<td>' + this._esc(this._formatFechaDdMmAa(r.fecha)) + '</td>' +
                    '<td>' + kmDia + '</td>' +
                    '<td>' + litros + '</td>' +
                    '<td>' + coste + '</td>' +
                    '<td>' + kmActualCol + '</td>' +
                    '</tr>'
                );
            }).join('');
        }
        const tableHtml =
            '<div class="activos-vehiculo-historial-table-wrap">' +
            '<table class="activos-vehiculo-historial-table">' +
            '<thead><tr>' +
            '<th>Fecha</th><th>Km dia</th><th>Litros</th><th>Coste</th><th>Km actual</th>' +
            '</tr></thead>' +
            '<tbody>' + bodyHtml + '</tbody>' +
            '</table></div>';
        const count = (registros && registros.length) ? registros.length : 0;
        const countLabel = count === 1 ? '1 registro' : count + ' registros';
        return this._renderWorkerCollapsible('Mi historial', countLabel, tableHtml, 'activos-worker-historial');
    }

    _renderWorkerVehiculoExtras(seguroContactos, talleres, almacen) {
        const contactos = this._normalizeSeguroContactosList(seguroContactos);
        const tallerList = Array.isArray(talleres) ? talleres : [];
        let html = '';
        html += this._renderWorkerCollapsible(
            'Detalles del seguro',
            contactos.length + ' contacto(s)',
            this._renderWorkerContactList(contactos),
            'activos-worker-extra'
        );
        html += this._renderWorkerCollapsible(
            'Talleres de referencia',
            almacen || '',
            this._renderWorkerTalleresList(tallerList),
            'activos-worker-extra'
        );
        return '<div class="activos-worker-extras">' + html + '</div>';
    }

    _renderVehiculoFormAsignacionInline(asignacion, trabajadores) {
        let selHtml = '<option value="">-- Seleccionar trabajador --</option>';
        (trabajadores || []).forEach(t => {
            const selected = asignacion && asignacion.auth_uid === t.auth_uid ? ' selected' : '';
            selHtml += '<option value="' + this._esc(t.auth_uid) + '" data-usuario-id="' + (t.usuario_id || '') + '" data-comercial-id="' + (t.comercial_id || '') + '"' + selected + '>';
            selHtml += this._esc(t.nombre) + ' (' + this._esc(t.tipo) + ' - ' + this._esc(t.codigo) + ')';
            selHtml += '</option>';
        });
        return (
            '<div class="admin-solicitud-field activos-vehiculo-form-asignacion-field">' +
            '<label for="activoFormTrabajadorSelect">Usuario asignado</label>' +
            '<select id="activoFormTrabajadorSelect">' + selHtml + '</select>' +
            '</div>' +
            '<div class="activos-vehiculo-form-asignacion-actions">' +
            '<button type="button" id="activoFormAsignarBtn" class="btn btn-primary btn-sm">Asignar</button>' +
            '<button type="button" id="activoFormDesasignarBtn" class="btn btn-secondary btn-sm">Quitar</button>' +
            '</div>'
        );
    }

    _renderVehiculoFormField(f, datos) {
        const val = datos[f.key] != null ? datos[f.key] : '';
        let html = '<div class="admin-solicitud-field"><label for="activoForm_' + f.key + '">' + this._esc(f.label) + '</label>';
        if (f.type === 'number') {
            html += '<input type="number" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + ' min="0">';
        } else {
            html += '<input type="' + (f.type || 'text') + '" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + '>';
        }
        html += '</div>';
        return html;
    }

    _resolveRegistroUsuario(registro, trabajadores) {
        const uid = registro && registro.auth_uid;
        if (!uid) return '—';
        const t = (trabajadores || []).find(x => x.auth_uid === uid);
        if (t) return t.nombre || t.codigo || '—';
        return 'Administracion';
    }

    _renderVehiculoHistorialTable(registros, trabajadores) {
        let bodyHtml;
        if (!registros || registros.length === 0) {
            bodyHtml = '<tr><td colspan="6" class="activos-vehiculo-historial-empty">Sin registros</td></tr>';
        } else {
            bodyHtml = registros.map((r, idx) => {
                const d = r.datos || {};
                const esUso = r.tipo === 'uso_vehiculo';
                const kmDia = esUso ? this._formatUsoHoyValor(d.km_dia, { decimals: 0 }) : '—';
                const litros = esUso ? this._formatUsoHoyValor(d.litros, { decimals: 1 }) : '—';
                const coste = esUso && d.coste != null && d.coste !== ''
                    ? this._formatUsoHoyValor(d.coste, { decimals: 2 }) + ' €'
                    : '—';
                const detalle = esUso
                    ? 'Km actual: ' + (d.km_actual != null ? this._formatUsoHoyValor(d.km_actual, { decimals: 0 }) : '—')
                    : this._esc(this._formatRegistroDatos(r));
                const usuario = this._esc(this._resolveRegistroUsuario(r, trabajadores));
                const fecha = this._esc(this._formatFechaDdMmAa(r.fecha));
                const searchText = [fecha, usuario, kmDia, litros, coste, detalle].join(' ').toLowerCase();
                return (
                    '<tr data-historial-row data-search="' + this._esc(searchText) + '">' +
                    '<td>' + fecha + '</td>' +
                    '<td>' + usuario + '</td>' +
                    '<td>' + kmDia + '</td>' +
                    '<td>' + litros + '</td>' +
                    '<td>' + coste + '</td>' +
                    '<td>' + detalle + '</td>' +
                    '</tr>'
                );
            }).join('');
        }
        const inner =
            '<div class="activos-admin-historial-search-wrap">' +
            '<input type="search" id="activoFormHistorialSearch" class="activos-admin-historial-search" placeholder="Buscar en historial..." autocomplete="off">' +
            '</div>' +
            '<div class="activos-vehiculo-historial-table-wrap">' +
            '<table class="activos-vehiculo-historial-table" id="activoFormHistorialTable">' +
            '<thead><tr>' +
            '<th>Fecha</th><th>Usuario</th><th>Km dia</th><th>Litros</th><th>Coste</th><th>Detalle</th>' +
            '</tr></thead>' +
            '<tbody id="activoFormHistorialTbody">' + bodyHtml + '</tbody>' +
            '</table></div>';
        return this._renderAdminVehiculoPanel('Historial', inner, {
            collapsible: true,
            panelId: 'activoFormHistorialPanel',
            extraClass: 'activos-admin-block--historial'
        });
    }

    _bindAdminHistorialSearch() {
        const input = document.getElementById('activoFormHistorialSearch');
        const tbody = document.getElementById('activoFormHistorialTbody');
        if (!input || !tbody) return;
        input.addEventListener('input', () => {
            const q = (input.value || '').trim().toLowerCase();
            tbody.querySelectorAll('tr[data-historial-row]').forEach(tr => {
                const hay = (tr.getAttribute('data-search') || '').includes(q);
                tr.style.display = hay ? '' : 'none';
            });
        });
    }

    _bindVehiculoFormAsignacion(activoId) {
        const self = this;
        document.getElementById('activoFormAsignarBtn')?.addEventListener('click', () => {
            self.assignFromForm(activoId);
        });
        document.getElementById('activoFormDesasignarBtn')?.addEventListener('click', () => {
            self.desasignarFromForm(activoId);
        });
    }

    async assignFromForm(activoId) {
        const sel = document.getElementById('activoFormTrabajadorSelect');
        if (!sel || !activoId) return;
        const authUid = sel.value;
        if (!authUid) {
            window.ui.showToast('Selecciona un trabajador', 'error');
            return;
        }
        const opt = sel.options[sel.selectedIndex];
        const result = await window.supabaseClient.asignarActivoTrabajador(
            activoId,
            authUid,
            opt.getAttribute('data-usuario-id') ? parseInt(opt.getAttribute('data-usuario-id'), 10) : null,
            opt.getAttribute('data-comercial-id') ? parseInt(opt.getAttribute('data-comercial-id'), 10) : null
        );
        if (!result.success) {
            window.ui.showToast(result.message || 'Error al asignar', 'error');
            return;
        }
        window.ui.showToast('Trabajador asignado', 'success');
        this._trabajadoresCache = null;
        await this.renderAdminForm('vehiculo', activoId);
    }

    async desasignarFromForm(activoId) {
        if (!activoId) return;
        const result = await window.supabaseClient.desasignarActivo(activoId);
        if (!result.success) {
            window.ui.showToast(result.message || 'Error al desasignar', 'error');
            return;
        }
        window.ui.showToast('Asignacion eliminada', 'success');
        await this.renderAdminForm('vehiculo', activoId);
    }

    _renderVehiculoImagenField(datos) {
        const imgUrl = this._getVehiculoImagenUrl(datos);
        const hasCustom = !!(datos && datos.imagen_url);
        this._vehiculoImagenPending = hasCustom ? String(datos.imagen_url) : '';
        return (
            '<div class="activos-vehiculo-form-media-inner">' +
            '<div class="activos-vehiculo-imagen-preview-wrap">' +
            '<img id="activoFormImagenPreview" class="activos-vehiculo-imagen-preview" src="' + this._esc(imgUrl) + '" alt="Vista previa del vehiculo">' +
            '</div>' +
            '<div class="activos-vehiculo-imagen-actions">' +
            '<button type="button" id="activoFormImagenBtn" class="btn btn-secondary btn-sm">Elegir imagen</button>' +
            '<button type="button" id="activoFormImagenQuitar" class="btn btn-secondary btn-sm"' + (hasCustom ? '' : ' style="display:none"') + '>Quitar</button>' +
            '<input type="file" id="activoFormImagenFile" accept="image/*" hidden>' +
            '<input type="hidden" id="activoFormImagenUrl" value="">' +
            '</div>' +
            '</div>'
        );
    }

    _buildVehiculoFormFieldsHtml(activo, cfg, datos, almacenes, opts) {
        const options = opts || {};
        const kmField = (cfg.adminFields || []).find(f => f.key === 'kilometraje_actual');
        const itvField = (cfg.adminFields || []).find(f => f.key === 'fecha_itv');
        let html = '';
        html += '<div class="admin-solicitud-field"><label for="activoFormAlmacen">Almacen</label>';
        html += '<select id="activoFormAlmacen" required>';
        html += '<option value="">-- Seleccionar almacen --</option>';
        (almacenes || []).forEach(al => {
            const cod = al.almacen || al;
            const label = typeof al === 'object' ? (al.almacen + (al.razon_social ? ' - ' + al.razon_social : '')) : cod;
            const selected = activo && activo.almacen === cod ? ' selected' : '';
            html += '<option value="' + this._esc(cod) + '"' + selected + '>' + this._esc(label) + '</option>';
        });
        html += '</select></div>';
        html += '<div class="admin-solicitud-field activos-vehiculo-form-field-full"><label for="activoFormNombre">Nombre</label>';
        html += '<input type="text" id="activoFormNombre" required value="' + this._esc(activo ? activo.nombre : '') + '"></div>';
        html += '<div class="admin-solicitud-field"><label for="activoFormIdentificador">' + this._esc(cfg.identificadorLabel) + '</label>';
        html += '<input type="text" id="activoFormIdentificador" value="' + this._esc(activo ? activo.identificador : '') + '"></div>';
        html += '<div class="admin-solicitud-field"><label for="activoFormEstado">Estado</label>';
        html += '<select id="activoFormEstado">';
        ['activo', 'inactivo', 'mantenimiento', 'averia'].forEach(st => {
            const sel = activo && activo.estado === st ? ' selected' : (!activo && st === 'activo' ? ' selected' : '');
            html += '<option value="' + st + '"' + sel + '>' + st + '</option>';
        });
        html += '</select></div>';
        (cfg.adminFields || []).forEach(f => {
            if (f.key === 'kilometraje_actual' || f.key === 'fecha_itv') return;
            html += this._renderVehiculoFormField(f, datos);
        });
        html += '<div class="activos-vehiculo-form-metrics-block activos-vehiculo-form-field-full">';
        if (kmField) {
            html += '<div class="activos-vehiculo-form-km">' + this._renderVehiculoFormField(kmField, datos) + '</div>';
        }
        if (itvField) {
            html += '<div class="activos-vehiculo-form-itv">' + this._renderVehiculoFormField(itvField, datos) + '</div>';
        }
        if (options.showAsignacion) {
            html += '<div class="activos-vehiculo-form-asignacion">' +
                this._renderVehiculoFormAsignacionInline(options.asignacion, options.trabajadores) +
                '</div>';
        }
        html += '</div>';
        return html;
    }

    _bindVehiculoImagenForm() {
        const preview = document.getElementById('activoFormImagenPreview');
        const fileInput = document.getElementById('activoFormImagenFile');
        const hidden = document.getElementById('activoFormImagenUrl');
        const pickBtn = document.getElementById('activoFormImagenBtn');
        const removeBtn = document.getElementById('activoFormImagenQuitar');
        if (!preview || !fileInput || !hidden) return;

        pickBtn?.addEventListener('click', () => fileInput.click());
        removeBtn?.addEventListener('click', () => {
            hidden.value = '';
            this._vehiculoImagenPending = '';
            preview.src = this._getVehiculoImagenPlaceholder();
            if (removeBtn) removeBtn.style.display = 'none';
        });
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            if (!file.type || !file.type.startsWith('image/')) {
                window.ui.showToast('Selecciona un archivo de imagen', 'error');
                fileInput.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result;
                const url = typeof dataUrl === 'string' ? dataUrl : '';
                hidden.value = '';
                this._vehiculoImagenPending = url;
                preview.src = url || this._getVehiculoImagenPlaceholder();
                if (removeBtn) removeBtn.style.display = url ? '' : 'none';
            };
            reader.readAsDataURL(file);
        });
    }

    _readVehiculoImagenFromForm() {
        const hidden = document.getElementById('activoFormImagenUrl');
        if (hidden && hidden.value.trim()) return hidden.value.trim();
        if (this._vehiculoImagenPending) return this._vehiculoImagenPending;
        return null;
    }

    _bindVehiculoDetailImagen(activoId) {
        const pickBtn = document.getElementById('adminActivoVehiculoImagenBtn');
        const fileInput = document.getElementById('adminActivoVehiculoImagenFile');
        const removeBtn = document.getElementById('adminActivoVehiculoImagenQuitar');
        if (!pickBtn || !fileInput) return;

        const self = this;
        pickBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            if (!file.type || !file.type.startsWith('image/')) {
                window.ui.showToast('Selecciona un archivo de imagen', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = async () => {
                const dataUrl = typeof reader.result === 'string' ? reader.result : '';
                if (!dataUrl) return;
                const result = await window.supabaseClient.patchActivoDatos(activoId, { imagen_url: dataUrl });
                if (!result.success) {
                    window.ui.showToast(result.message || 'Error al guardar la imagen', 'error');
                    return;
                }
                window.ui.showToast('Foto actualizada', 'success');
                self.renderAdminDetail(activoId);
            };
            reader.readAsDataURL(file);
        });
        removeBtn?.addEventListener('click', async () => {
            const activo = await window.supabaseClient.getActivoById(activoId);
            if (!activo) return;
            const datos = Object.assign({}, activo.datos || {});
            delete datos.imagen_url;
            const result = await window.supabaseClient.updateActivo(activoId, { datos });
            if (!result.success) {
                window.ui.showToast(result.message || 'Error al quitar la imagen', 'error');
                return;
            }
            window.ui.showToast('Foto eliminada', 'success');
            self.renderAdminDetail(activoId);
        });
    }

    _renderVehiculoDetailHeader(activo, asignacion, usoHoy) {
        const datos = activo.datos || {};
        const listLike = {
            estado: activo.estado,
            datos: datos,
            asignado_nombre: asignacion && asignacion.asignado_nombre ? asignacion.asignado_nombre : null
        };
        const badge = this._getVehiculoDisponibilidadBadge(listLike);
        const imgSrc = this._esc(this._getVehiculoImagenUrl(datos));
        const hasCustomImg = !!(datos.imagen_url);
        let html = '<div class="activos-vehiculo-detail-card">';
        html += '<div class="activos-vehiculo-detail-img-wrap">';
        html += '<img class="activos-vehiculo-detail-img" src="' + imgSrc + '" alt="">';
        html += '<span class="activos-vehiculo-ficha-badge ' + badge.className + '">' + this._esc(badge.label) + '</span>';
        html += '<div class="activos-vehiculo-detail-img-actions">';
        html += '<button type="button" id="adminActivoVehiculoImagenBtn" class="btn btn-secondary btn-sm">Cambiar foto</button>';
        if (hasCustomImg) {
            html += '<button type="button" id="adminActivoVehiculoImagenQuitar" class="btn btn-secondary btn-sm">Quitar</button>';
        }
        html += '<input type="file" id="adminActivoVehiculoImagenFile" accept="image/*" hidden>';
        html += '</div></div>';
        html += '<div class="activos-vehiculo-detail-body">';
        html += '<h3 class="activos-vehiculo-detail-nombre">' + this._esc(activo.nombre) + '</h3>';
        if (activo.identificador) {
            html += '<p class="activos-vehiculo-detail-matricula">' + this._esc(activo.identificador) + '</p>';
        }
        if (datos.modelo) html += '<p class="activos-vehiculo-detail-modelo">' + this._esc(datos.modelo) + '</p>';
        html += '<div class="activos-vehiculo-detail-chips">';
        html += '<span class="activos-vehiculo-chip">Estado: ' + this._esc(activo.estado) + '</span>';
        if (activo.almacen) html += '<span class="activos-vehiculo-chip">Almacen: ' + this._esc(activo.almacen) + '</span>';
        if (datos.kilometraje_actual != null) {
            html += '<span class="activos-vehiculo-chip">' + this._esc(String(datos.kilometraje_actual)) + ' km</span>';
        }
        if (datos.fecha_itv) html += '<span class="activos-vehiculo-chip">' + this._formatItvBadge(datos.fecha_itv) + '</span>';
        html += '</div>';
        html += '<p class="activos-vehiculo-detail-asignado"><strong>Asignado a:</strong> ';
        html += asignacion && asignacion.asignado_nombre
            ? this._esc(asignacion.asignado_nombre) + ' (' + this._esc(asignacion.asignado_codigo || '') + ')'
            : 'Nadie';
        html += '</p>';
        html += this._renderVehiculoUsoHoyStats(usoHoy, false);
        html += '</div></div>';
        return html;
    }

    async renderAdminForm(categoria, activoId) {
        const fieldsEl = document.getElementById('adminActivoFormFields');
        const extraEl = document.getElementById('adminActivoFormVehiculoExtra');
        if (fieldsEl) fieldsEl.innerHTML = '<p>Cargando formulario...</p>';
        if (extraEl) {
            extraEl.innerHTML = '';
            extraEl.style.display = 'none';
        }

        try {
        let activo = null;
        if (activoId) {
            activo = await window.supabaseClient.getActivoById(activoId);
            if (activo) categoria = activo.categoria_codigo;
        }
        this._adminCategoria = categoria;
        this._adminActivoId = activoId || null;

        const cfg = this.getCategoriaConfig(categoria);
        const titleEl = document.getElementById('adminActivoFormTitle');
        if (titleEl) {
            if (activoId && categoria === 'vehiculo') {
                titleEl.textContent = 'Editar vehiculo';
            } else {
                titleEl.textContent = activoId ? 'Editar activo' : 'Nuevo activo';
            }
        }

        if (!fieldsEl || !cfg) {
            if (fieldsEl) {
                fieldsEl.innerHTML = '<p class="activos-form-error">No se pudo cargar el formulario. Vuelve a la lista e intentalo de nuevo.</p>';
            }
            return;
        }

        if (activoId && !activo) {
            fieldsEl.innerHTML = '<p class="activos-form-error">Vehiculo no encontrado.</p>';
            return;
        }

        const datos = (activo && activo.datos) || {};
        const almacenes = await this._loadAlmacenes();
        let asignacion = null;
        let trabajadores = null;
        if (categoria === 'vehiculo' && activoId) {
            [asignacion, trabajadores] = await Promise.all([
                window.supabaseClient.getActivoAsignacionActiva(activoId),
                this._loadTrabajadores()
            ]);
        }
        let html = '';
        if (categoria === 'vehiculo') {
            const fieldsHtml = this._buildVehiculoFormFieldsHtml(activo, cfg, datos, almacenes, {
                showAsignacion: !!activoId,
                asignacion,
                trabajadores
            });
            html +=
                '<div class="activos-vehiculo-form-card">' +
                '<div class="activos-vehiculo-form-media">' + this._renderVehiculoImagenField(datos) + '</div>' +
                '<div class="activos-vehiculo-form-fields">' + fieldsHtml + '</div>' +
                '</div>';
        } else {
            html += '<div class="admin-solicitud-field"><label for="activoFormAlmacen">Almacen</label>';
            html += '<select id="activoFormAlmacen" required>';
            html += '<option value="">-- Seleccionar almacen --</option>';
            (almacenes || []).forEach(al => {
                const cod = al.almacen || al;
                const label = typeof al === 'object' ? (al.almacen + (al.razon_social ? ' - ' + al.razon_social : '')) : cod;
                const selected = activo && activo.almacen === cod ? ' selected' : '';
                html += '<option value="' + this._esc(cod) + '"' + selected + '>' + this._esc(label) + '</option>';
            });
            html += '</select></div>';
            html += '<div class="admin-solicitud-field"><label for="activoFormNombre">Nombre</label>';
            html += '<input type="text" id="activoFormNombre" required value="' + this._esc(activo ? activo.nombre : '') + '"></div>';
            html += '<div class="admin-solicitud-field"><label for="activoFormIdentificador">' + this._esc(cfg.identificadorLabel) + '</label>';
            html += '<input type="text" id="activoFormIdentificador" value="' + this._esc(activo ? activo.identificador : '') + '"></div>';
            html += '<div class="admin-solicitud-field"><label for="activoFormEstado">Estado</label>';
            html += '<select id="activoFormEstado">';
            ['activo', 'inactivo', 'mantenimiento', 'averia'].forEach(st => {
                const sel = activo && activo.estado === st ? ' selected' : (!activo && st === 'activo' ? ' selected' : '');
                html += '<option value="' + st + '"' + sel + '>' + st + '</option>';
            });
            html += '</select></div>';
            cfg.adminFields.forEach(f => {
                const val = datos[f.key] != null ? datos[f.key] : '';
                html += '<div class="admin-solicitud-field"><label for="activoForm_' + f.key + '">' + this._esc(f.label) + '</label>';
                if (f.type === 'number') {
                    html += '<input type="number" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + ' min="0">';
                } else {
                    html += '<input type="' + (f.type || 'text') + '" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + '>';
                }
                html += '</div>';
            });
        }

        fieldsEl.innerHTML = html;
        if (categoria === 'vehiculo') {
            fieldsEl.classList.add('activos-vehiculo-form-wrap');
            this._bindVehiculoImagenForm();
            if (activoId) {
                this._bindVehiculoFormAsignacion(activoId);
            }
        } else {
            fieldsEl.classList.remove('activos-vehiculo-form-wrap');
        }

        const deleteBtn = document.getElementById('adminActivoEliminarBtn');
        if (deleteBtn) {
            deleteBtn.style.display = (categoria === 'vehiculo' && activoId) ? '' : 'none';
        }

        if (extraEl) {
            if (categoria === 'vehiculo' && activoId) {
                const [registros, usoHoy] = await Promise.all([
                    window.supabaseClient.getActivoRegistros(activoId, 30),
                    window.supabaseClient.getActivoUsoVehiculoHoy(activoId)
                ]);
                let extraHtml = this._renderVehiculoUsoHoyStats(usoHoy, false, 'admin-pretty');
                extraHtml += this._renderVehiculoHistorialTable(registros, trabajadores);
                extraEl.innerHTML = extraHtml;
                extraEl.style.display = 'block';
                this._bindAdminHistorialSearch();
            } else {
                extraEl.innerHTML = '';
                extraEl.style.display = 'none';
            }
        }
        } catch (err) {
            console.error('renderAdminForm:', err);
            if (fieldsEl) {
                fieldsEl.innerHTML = '<p class="activos-form-error">Error al cargar el formulario. Recarga la pagina (Ctrl+F5).</p>';
            }
        }
    }

    async deleteAdminActivoForm() {
        const categoria = this._adminCategoria;
        const activoId = this._adminActivoId;
        if (categoria !== 'vehiculo' || !activoId) return;

        const nombre = (document.getElementById('activoFormNombre')?.value || '').trim();
        const msg = nombre
            ? '¿Eliminar el vehiculo "' + nombre + '"? Esta accion no se puede deshacer.'
            : '¿Eliminar este vehiculo? Esta accion no se puede deshacer.';
        if (!window.confirm(msg)) return;

        const result = await window.supabaseClient.deleteActivo(activoId);
        if (!result.success) {
            window.ui.showToast(result.message || 'Error al eliminar', 'error');
            return;
        }

        window.ui.showToast('Vehiculo eliminado', 'success');
        this._adminActivoId = null;
        this.app.showScreenAdmin('activosList', categoria);
    }

    async saveAdminActivoForm() {
        const categoria = this._adminCategoria;
        const cfg = this.getCategoriaConfig(categoria);
        if (!cfg) return;

        const nombre = (document.getElementById('activoFormNombre')?.value || '').trim();
        if (!nombre) {
            window.ui.showToast('El nombre es obligatorio', 'error');
            return;
        }

        const identificador = (document.getElementById('activoFormIdentificador')?.value || '').trim() || null;
        const estado = document.getElementById('activoFormEstado')?.value || 'activo';
        const almacen = (document.getElementById('activoFormAlmacen')?.value || '').trim();
        if (!almacen) {
            window.ui.showToast('Selecciona un almacen', 'error');
            return;
        }
        const datos = {};
        cfg.adminFields.forEach(f => {
            const el = document.getElementById('activoForm_' + f.key);
            if (!el) return;
            let v = el.value;
            if (f.type === 'number' && v !== '') {
                v = parseInt(v, 10);
                if (!Number.isFinite(v)) v = 0;
            }
            if (v !== '' && v != null) datos[f.key] = v;
        });
        if (categoria === 'vehiculo') {
            const imagenUrl = this._readVehiculoImagenFromForm();
            if (imagenUrl) datos.imagen_url = imagenUrl;
            else delete datos.imagen_url;
        }

        const payload = {
            categoria_codigo: categoria,
            nombre,
            identificador,
            estado,
            almacen,
            datos
        };

        let result;
        if (this._adminActivoId) {
            result = await window.supabaseClient.updateActivo(this._adminActivoId, payload);
        } else {
            result = await window.supabaseClient.createActivo(payload);
        }

        if (!result.success) {
            window.ui.showToast(result.message || 'Error al guardar', 'error');
            return;
        }

        window.ui.showToast('Activo guardado', 'success');
        const id = this._adminActivoId || result.id;
        if (categoria === 'vehiculo') {
            this.app.showScreenAdmin('activosList', categoria);
        } else {
            this.app.showScreenAdmin('activoDetail', id);
        }
    }

    async renderAdminDetail(activoId) {
        this._adminActivoId = activoId;
        const content = document.getElementById('adminActivoDetailContent');
        if (!content) return;
        content.innerHTML = '<p>Cargando...</p>';

        const activo = await window.supabaseClient.getActivoById(activoId);
        if (!activo) {
            content.innerHTML = '<p>Activo no encontrado.</p>';
            return;
        }

        this._adminCategoria = activo.categoria_codigo;
        const cfg = this.getCategoriaConfig(activo.categoria_codigo);
        const asignacion = await window.supabaseClient.getActivoAsignacionActiva(activoId);
        const registros = await window.supabaseClient.getActivoRegistros(activoId, 15);
        const usoHoy = activo.categoria_codigo === 'vehiculo'
            ? await window.supabaseClient.getActivoUsoVehiculoHoy(activoId)
            : null;

        let html = '';
        if (activo.categoria_codigo === 'vehiculo') {
            html += this._renderVehiculoDetailHeader(activo, asignacion, usoHoy);
            html += '<div class="activos-detail-block activos-vehiculo-detail-extra">';
            if (cfg && activo.datos) {
                cfg.adminFields.forEach(f => {
                    if (activo.datos[f.key] != null && activo.datos[f.key] !== '' && f.key !== 'modelo') {
                        html += '<p><strong>' + this._esc(f.label) + ':</strong> ' + this._esc(activo.datos[f.key]) + '</p>';
                    }
                });
            }
            html += '</div>';
        } else {
            html += '<div class="activos-detail-block">';
            html += '<h3>' + this._esc(activo.nombre) + '</h3>';
            if (activo.identificador) html += '<p><strong>' + this._esc(cfg ? cfg.identificadorLabel : 'ID') + ':</strong> ' + this._esc(activo.identificador) + '</p>';
            html += '<p><strong>Estado:</strong> ' + this._esc(activo.estado) + '</p>';
            if (activo.almacen) {
                html += '<p><strong>Almacen:</strong> ' + this._esc(activo.almacen) + '</p>';
            }
            if (cfg && activo.datos) {
                cfg.adminFields.forEach(f => {
                    if (activo.datos[f.key] != null && activo.datos[f.key] !== '') {
                        html += '<p><strong>' + this._esc(f.label) + ':</strong> ' + this._esc(activo.datos[f.key]) + '</p>';
                    }
                });
            }
            html += '<p><strong>Asignado a:</strong> ';
            if (asignacion && asignacion.asignado_nombre) {
                html += this._esc(asignacion.asignado_nombre) + ' (' + this._esc(asignacion.asignado_codigo || '') + ')';
            } else {
                html += 'Nadie';
            }
            html += '</p></div>';
        }

        html += '<div class="admin-detail-actions activos-detail-actions">';
        html += '<button type="button" id="adminActivoEditarInlineBtn" class="btn btn-secondary">Editar</button>';
        html += '</div>';

        const assignBlock = document.getElementById('adminActivoAsignacionBlock');
        if (assignBlock) {
            const trabajadores = await this._loadTrabajadores();
            let selHtml = '<option value="">-- Seleccionar trabajador --</option>';
            (trabajadores || []).forEach(t => {
                const selected = asignacion && asignacion.auth_uid === t.auth_uid ? ' selected' : '';
                selHtml += '<option value="' + this._esc(t.auth_uid) + '" data-usuario-id="' + (t.usuario_id || '') + '" data-comercial-id="' + (t.comercial_id || '') + '"' + selected + '>';
                selHtml += this._esc(t.nombre) + ' (' + this._esc(t.tipo) + ' - ' + this._esc(t.codigo) + ')';
                selHtml += '</option>';
            });
            const sel = assignBlock.querySelector('#adminActivoTrabajadorSelect');
            if (sel) sel.innerHTML = selHtml;
        }

        const eventoBlock = document.getElementById('adminActivoEventoBlock');
        if (eventoBlock && cfg && cfg.eventoLabels && activo.categoria_codigo !== 'vehiculo') {
            eventoBlock.style.display = '';
            const tipoSel = document.getElementById('adminActivoEventoTipo');
            if (tipoSel) {
                tipoSel.innerHTML = Object.keys(cfg.eventoLabels).map(k =>
                    '<option value="' + k + '">' + this._esc(cfg.eventoLabels[k]) + '</option>'
                ).join('');
            }
            const contadorField = eventoBlock.querySelector('.activos-evento-contador-field');
            if (contadorField) {
                contadorField.style.display = activo.categoria_codigo === 'impresora' ? '' : 'none';
            }
        } else if (eventoBlock) {
            eventoBlock.style.display = activo.categoria_codigo === 'vehiculo' ? 'none' : '';
        }

        if (registros && registros.length > 0) {
            html += '<div class="activos-registros-block"><h4>Historial reciente</h4><ul class="activos-registros-list">';
            registros.forEach(r => {
                html += '<li><span class="activos-reg-fecha">' + this._esc(r.fecha) + '</span> ';
                html += '<span class="activos-reg-tipo">' + this._esc(r.tipo) + '</span> ';
                html += '<span class="activos-reg-datos">' + this._esc(this._formatRegistroDatos(r)) + '</span></li>';
            });
            html += '</ul></div>';
        }

        content.innerHTML = html;
        if (activo.categoria_codigo === 'vehiculo') {
            this._bindVehiculoDetailImagen(activoId);
        }
        document.getElementById('adminActivoEditarInlineBtn')?.addEventListener('click', () => {
            this.app.showScreenAdmin('activoForm', activoId);
        });
    }

    _formatRegistroDatos(r) {
        const d = r.datos || {};
        if (r.tipo === 'uso_vehiculo') {
            return 'Km dia: ' + (d.km_dia != null ? d.km_dia : '-') + ', Km actual: ' + (d.km_actual != null ? d.km_actual : '-');
        }
        if (d.descripcion) return d.descripcion;
        if (d.contador_paginas != null) return 'Paginas: ' + d.contador_paginas;
        return JSON.stringify(d);
    }

    _renderAdminSeguroRow(contact, index) {
        const c = contact || {};
        return (
            '<div class="activos-config-row" data-seguro-row="' + index + '">' +
            '<div class="admin-solicitud-field"><label>Nombre</label>' +
            '<input type="text" class="activos-seguro-nombre" value="' + this._esc(c.nombre || '') + '"></div>' +
            '<div class="admin-solicitud-field"><label>Telefono</label>' +
            '<input type="tel" class="activos-seguro-telefono" value="' + this._esc(c.telefono || '') + '"></div>' +
            '<button type="button" class="btn btn-secondary btn-sm activos-config-row-remove" data-remove-seguro>Quitar</button>' +
            '</div>'
        );
    }

    _renderAdminTallerRow(taller, index) {
        const t = taller || {};
        return (
            '<div class="activos-config-row activos-config-row-taller" data-taller-row="' + index + '">' +
            '<div class="admin-solicitud-field"><label>Nombre</label>' +
            '<input type="text" class="activos-taller-nombre" value="' + this._esc(t.nombre || '') + '"></div>' +
            '<div class="admin-solicitud-field"><label>Telefono</label>' +
            '<input type="tel" class="activos-taller-telefono" value="' + this._esc(t.telefono || '') + '"></div>' +
            '<div class="admin-solicitud-field admin-solicitud-field-full"><label>Direccion</label>' +
            '<input type="text" class="activos-taller-direccion" value="' + this._esc(t.direccion || '') + '"></div>' +
            '<button type="button" class="btn btn-secondary btn-sm activos-config-row-remove" data-remove-taller>Quitar</button>' +
            '</div>'
        );
    }

    async openAdminSeguroModal() {
        const modal = document.getElementById('adminActivosSeguroModal');
        const listEl = document.getElementById('adminActivosSeguroList');
        if (!modal || !listEl) return;
        const cfg = await this._loadActivosVehiculoConfig();
        this._seguroModalDraft = this._normalizeSeguroContactosList(cfg.seguro_contactos);
        if (this._seguroModalDraft.length === 0) this._seguroModalDraft.push({ nombre: '', telefono: '' });
        this._renderAdminSeguroModalList();
        modal.style.display = '';
    }

    closeAdminSeguroModal() {
        const modal = document.getElementById('adminActivosSeguroModal');
        if (modal) modal.style.display = 'none';
    }

    _renderAdminSeguroModalList() {
        const listEl = document.getElementById('adminActivosSeguroList');
        if (!listEl) return;
        const rows = (this._seguroModalDraft || []).map((c, i) => this._renderAdminSeguroRow(c, i)).join('');
        listEl.innerHTML = rows;
        listEl.querySelectorAll('[data-remove-seguro]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('[data-seguro-row]');
                const idx = parseInt(row.getAttribute('data-seguro-row'), 10);
                this._syncSeguroModalFromDom();
                if (this._seguroModalDraft.length > 1) {
                    this._seguroModalDraft.splice(idx, 1);
                } else {
                    this._seguroModalDraft[0] = { nombre: '', telefono: '' };
                }
                this._renderAdminSeguroModalList();
            });
        });
    }

    _syncSeguroModalFromDom() {
        const listEl = document.getElementById('adminActivosSeguroList');
        if (!listEl) return;
        this._seguroModalDraft = [];
        listEl.querySelectorAll('[data-seguro-row]').forEach(row => {
            const nombre = (row.querySelector('.activos-seguro-nombre')?.value || '').trim();
            const telefono = (row.querySelector('.activos-seguro-telefono')?.value || '').trim();
            this._seguroModalDraft.push({ nombre, telefono });
        });
    }

    addAdminSeguroRow() {
        this._syncSeguroModalFromDom();
        this._seguroModalDraft.push({ nombre: '', telefono: '' });
        this._renderAdminSeguroModalList();
    }

    async saveAdminSeguroModal() {
        this._syncSeguroModalFromDom();
        const contactos = this._seguroModalDraft.filter(c => c.nombre || c.telefono);
        const cfg = await this._loadActivosVehiculoConfig();
        const result = await window.supabaseClient.saveActivosVehiculoConfig({
            seguro_contactos: contactos,
            talleres_por_almacen: cfg.talleres_por_almacen || {}
        });
        if (!result.success) {
            window.ui.showToast(result.message || 'Error al guardar contactos', 'error');
            return;
        }
        window.ui.showToast('Contactos de seguro guardados', 'success');
        this.closeAdminSeguroModal();
    }

    async openAdminTalleresModal() {
        const modal = document.getElementById('adminActivosTalleresModal');
        const sel = document.getElementById('adminActivosTalleresAlmacen');
        if (!modal || !sel) return;
        const [cfg, almacenes] = await Promise.all([
            this._loadActivosVehiculoConfig(),
            this._loadAlmacenes()
        ]);
        this._talleresModalConfig = JSON.parse(JSON.stringify(cfg.talleres_por_almacen || {}));
        sel.innerHTML = (almacenes || []).map(a => {
            const cod = a.almacen || a;
            return '<option value="' + this._esc(cod) + '">' + this._esc(cod) + '</option>';
        }).join('');
        this._talleresModalAlmacenActivo = sel.value || '';
        this._renderAdminTalleresModalList();
        modal.style.display = '';
    }

    _onTalleresAlmacenChange() {
        this._persistTalleresModalDomToConfig(this._talleresModalAlmacenActivo);
        const sel = document.getElementById('adminActivosTalleresAlmacen');
        this._talleresModalAlmacenActivo = sel ? sel.value : '';
        this._renderAdminTalleresModalList();
    }

    _persistTalleresModalDomToConfig(cod) {
        if (!cod) return;
        const listEl = document.getElementById('adminActivosTalleresList');
        if (!listEl || !listEl.querySelector('[data-taller-row]')) return;
        const list = [];
        listEl.querySelectorAll('[data-taller-row]').forEach(row => {
            list.push({
                nombre: (row.querySelector('.activos-taller-nombre')?.value || '').trim(),
                telefono: (row.querySelector('.activos-taller-telefono')?.value || '').trim(),
                direccion: (row.querySelector('.activos-taller-direccion')?.value || '').trim()
            });
        });
        if (!this._talleresModalConfig) this._talleresModalConfig = {};
        this._talleresModalConfig[String(cod).trim().toUpperCase()] = list;
    }

    _renderAdminTalleresModalList() {
        const listEl = document.getElementById('adminActivosTalleresList');
        if (!listEl) return;
        const cod = String(this._talleresModalAlmacenActivo || this._getTalleresModalAlmacen() || '').trim().toUpperCase();
        const list = (this._talleresModalConfig && this._talleresModalConfig[cod]) || [];
        const draft = list.length ? list : [{ nombre: '', telefono: '', direccion: '' }];
        listEl.innerHTML = draft.map((t, i) => this._renderAdminTallerRow(t, i)).join('');
        listEl.querySelectorAll('[data-remove-taller]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('[data-taller-row]');
                const idx = parseInt(row.getAttribute('data-taller-row'), 10);
                this._persistTalleresModalDomToConfig(cod);
                const current = this._talleresModalConfig[cod] || [];
                if (current.length > 1) {
                    current.splice(idx, 1);
                } else {
                    this._talleresModalConfig[cod] = [{ nombre: '', telefono: '', direccion: '' }];
                }
                this._renderAdminTalleresModalList();
            });
        });
    }

    addAdminTallerRow() {
        const cod = String(this._talleresModalAlmacenActivo || this._getTalleresModalAlmacen() || '').trim().toUpperCase();
        if (!cod) return;
        this._persistTalleresModalDomToConfig(cod);
        if (!this._talleresModalConfig[cod]) this._talleresModalConfig[cod] = [];
        this._talleresModalConfig[cod].push({ nombre: '', telefono: '', direccion: '' });
        this._renderAdminTalleresModalList();
    }

    async saveAdminTalleresModal() {
        this._persistTalleresModalDomToConfig(this._talleresModalAlmacenActivo);
        const cfg = await this._loadActivosVehiculoConfig();
        const cleaned = {};
        Object.keys(this._talleresModalConfig || {}).forEach(cod => {
            const list = (this._talleresModalConfig[cod] || []).filter(t => t.nombre || t.telefono || t.direccion);
            if (list.length) cleaned[cod] = list;
        });
        const result = await window.supabaseClient.saveActivosVehiculoConfig({
            seguro_contactos: cfg.seguro_contactos || [],
            talleres_por_almacen: cleaned
        });
        if (!result.success) {
            window.ui.showToast(result.message || 'Error al guardar talleres', 'error');
            return;
        }
        window.ui.showToast('Talleres guardados', 'success');
        this.closeAdminTalleresModal();
    }

    closeAdminTalleresModal() {
        const modal = document.getElementById('adminActivosTalleresModal');
        if (modal) modal.style.display = 'none';
    }

    _getTalleresModalAlmacen() {
        return (document.getElementById('adminActivosTalleresAlmacen')?.value || '').trim().toUpperCase();
    }

    openWorkerRegistroModal() {
        const modal = document.getElementById('activosRegistroModal');
        if (modal) modal.style.display = '';
    }

    closeWorkerRegistroModal() {
        const modal = document.getElementById('activosRegistroModal');
        if (modal) modal.style.display = 'none';
    }

    async _loadAlmacenes() {
        if (this._almacenesCache) return this._almacenesCache;
        this._almacenesCache = await window.supabaseClient.getEmpresasPorAlmacen();
        return this._almacenesCache;
    }

    async _loadTrabajadores() {
        if (this._trabajadoresCache) return this._trabajadoresCache;
        this._trabajadoresCache = await window.supabaseClient.getActivosTrabajadoresAsignables();
        return this._trabajadoresCache;
    }

    async assignFromDetail() {
        const activoId = this._adminActivoId;
        const sel = document.getElementById('adminActivoTrabajadorSelect');
        if (!sel || !activoId) return;
        const authUid = sel.value;
        if (!authUid) {
            window.ui.showToast('Selecciona un trabajador', 'error');
            return;
        }
        const opt = sel.options[sel.selectedIndex];
        const usuarioId = opt.getAttribute('data-usuario-id');
        const comercialId = opt.getAttribute('data-comercial-id');
        const result = await window.supabaseClient.asignarActivoTrabajador(
            activoId,
            authUid,
            usuarioId ? parseInt(usuarioId, 10) : null,
            comercialId ? parseInt(comercialId, 10) : null
        );
        if (!result.success) {
            window.ui.showToast(result.message || 'Error al asignar', 'error');
            return;
        }
        window.ui.showToast('Trabajador asignado', 'success');
        this._trabajadoresCache = null;
        this.renderAdminDetail(activoId);
    }

    async desasignarFromDetail() {
        const activoId = this._adminActivoId;
        if (!activoId) return;
        const result = await window.supabaseClient.desasignarActivo(activoId);
        if (!result.success) {
            window.ui.showToast(result.message || 'Error al desasignar', 'error');
            return;
        }
        window.ui.showToast('Asignacion eliminada', 'success');
        this.renderAdminDetail(activoId);
    }

    async registerAdminEvento() {
        const activoId = this._adminActivoId;
        const cfg = this.getCategoriaConfig(this._adminCategoria);
        if (!activoId || !cfg || cfg.codigo === 'vehiculo') return;

        const tipoEvento = document.getElementById('adminActivoEventoTipo')?.value || 'maintenance';
        const descripcion = (document.getElementById('adminActivoEventoDesc')?.value || '').trim();
        const contador = document.getElementById('adminActivoEventoContador')?.value;

        const datos = { subtipo: tipoEvento, descripcion: descripcion || null };
        if (contador !== '' && contador != null) {
            datos.contador_paginas = parseInt(contador, 10);
        }

        const result = await window.supabaseClient.registrarActivoEvento(
            activoId,
            cfg.eventoTipo,
            datos
        );

        if (!result.success) {
            window.ui.showToast(result.message || 'Error al registrar evento', 'error');
            return;
        }

        if (cfg.codigo === 'impresora' && datos.contador_paginas != null) {
            await window.supabaseClient.patchActivoDatos(activoId, { contador_paginas: datos.contador_paginas });
        }

        window.ui.showToast('Evento registrado', 'success');
        document.getElementById('adminActivoEventoDesc').value = '';
        if (document.getElementById('adminActivoEventoContador')) {
            document.getElementById('adminActivoEventoContador').value = '';
        }
        this.renderAdminDetail(activoId);
    }

    updateWorkerVisibility(currentUser) {
        const btn = document.getElementById('herramientaMisActivosBtn');
        if (!btn) return;
        const show = currentUser && (
            currentUser.is_dependiente ||
            currentUser.is_comercial ||
            currentUser.is_administrador
        );
        btn.style.display = show ? '' : 'none';
    }

    async renderMisActivos() {
        const listEl = document.getElementById('misActivosList');
        if (!listEl) return;
        listEl.innerHTML = '<p>Cargando...</p>';

        const list = await window.supabaseClient.getMisActivos();
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p>No tienes activos asignados.</p>';
            return;
        }

        const vehiculos = list.filter(a => a.categoria_codigo === 'vehiculo');

        const byCat = {};
        list.forEach(a => {
            const k = a.categoria_codigo;
            if (!byCat[k]) byCat[k] = [];
            byCat[k].push(a);
        });

        let html = '';
        Object.keys(byCat).forEach(cat => {
            const cfg = this.getCategoriaConfig(cat);
            html += '<h3 class="activos-mis-cat-title">' + this._esc(cfg ? cfg.nombre : cat) + '</h3>';
            if (cat === 'vehiculo') {
                html += '<div class="activos-mis-vehiculos-grid">';
                byCat[cat].forEach(a => {
                    html += this._renderVehiculoFichaCard(a, {
                        workerView: true,
                        showAsignado: false,
                        showUsoHoy: false,
                        usoCompact: true
                    });
                });
                html += '</div>';
            } else {
                byCat[cat].forEach(a => {
                    html += '<button type="button" class="btn btn-secondary activos-mis-item" data-id="' + this._esc(a.id) + '">';
                    html += this._esc(a.nombre);
                    if (a.identificador) html += ' <span class="activos-list-id">(' + this._esc(a.identificador) + ')</span>';
                    if (a.almacen) html += '<br><span class="activos-list-meta">Almacen: ' + this._esc(a.almacen) + '</span>';
                    html += '</button>';
                });
            }
        });

        listEl.innerHTML = html;
        listEl.querySelectorAll('.activos-vehiculo-ficha[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const activo = list.find(x => x.id === id);
                if (activo) {
                    this._workerActivo = activo;
                    this.app.showScreen('misActivoDetail');
                }
            });
        });
        listEl.querySelectorAll('.activos-mis-item[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const activo = list.find(x => x.id === id);
                if (activo) {
                    this._workerActivo = activo;
                    this.app.showScreen('misActivoDetail');
                }
            });
        });
    }

    _populateUsoVehiculoForm(activo, usoHoy) {
        const kmEl = document.getElementById('misActivoKmActual');
        const litrosEl = document.getElementById('misActivoLitros');
        const costeEl = document.getElementById('misActivoCoste');
        if (!kmEl) return;

        const kmVehiculo = activo && activo.datos && activo.datos.kilometraje_actual != null
            ? activo.datos.kilometraje_actual
            : null;

        kmEl.value = '';
        if (litrosEl) {
            litrosEl.value = (usoHoy && usoHoy.litros != null && usoHoy.litros !== '') ? String(usoHoy.litros) : '';
        }
        if (costeEl) {
            costeEl.value = (usoHoy && usoHoy.coste != null && usoHoy.coste !== '') ? String(usoHoy.coste) : '';
        }

        if (kmVehiculo != null) {
            kmEl.placeholder = 'Min. ' + kmVehiculo + ' km';
            kmEl.min = String(kmVehiculo);
        } else {
            kmEl.placeholder = 'Lectura del cuentakilometros';
            kmEl.removeAttribute('min');
        }
    }

    async renderWorkerDetail() {
        const activoBase = this._workerActivo;
        const content = document.getElementById('misActivoDetailContent');
        const titleEl = document.querySelector('#misActivoDetailScreen .profile-title');
        if (!content || !activoBase) return;

        content.innerHTML = '<p>Cargando...</p>';

        const activo = await window.supabaseClient.getActivoById(activoBase.id) || activoBase;
        this._workerActivo = activo;
        const cfg = this.getCategoriaConfig(activo.categoria_codigo);

        if (titleEl) {
            titleEl.textContent = activo.categoria_codigo === 'vehiculo' ? 'Mi vehiculo' : 'Detalle activo';
        }

        if (activo.categoria_codigo === 'vehiculo') {
            const [usoHoy, registros, vehiculoConfig] = await Promise.all([
                window.supabaseClient.getActivoUsoVehiculoHoy(activo.id),
                window.supabaseClient.getActivoRegistros(activo.id, 15),
                this._loadActivosVehiculoConfig()
            ]);
            const talleres = this._getTalleresReferenciaFromConfig(vehiculoConfig, activo.almacen);
            const seguroContactos = vehiculoConfig.seguro_contactos || [];
            activo.uso_hoy = usoHoy;
            const showUso = cfg && cfg.trabajadorPuedeRegistrar;
            let html = '<div class="activos-worker-vehiculo-detail">';
            html += this._renderVehiculoFichaCard(activo, {
                static: true,
                detail: true,
                workerView: true,
                showAsignado: false,
                showUsoHoy: true,
                showRegistroBtn: showUso,
                usoCompact: false,
                usoVariant: 'worker'
            });
            html += this._renderWorkerVehiculoExtras(seguroContactos, talleres, activo.almacen);
            html += this._renderVehiculoWorkerHistorialTable(registros);
            html += '</div>';
            content.innerHTML = html;

            if (showUso) {
                this._populateUsoVehiculoForm(activo, usoHoy);
                document.getElementById('misActivoRegistroOpenBtn')?.addEventListener('click', () => {
                    this.openWorkerRegistroModal();
                });
            }
            return;
        }

        let html = '<div class="activos-worker-activo-detail">';
        html += '<h3>' + this._esc(activo.nombre) + '</h3>';
        if (activo.identificador) {
            html += '<p><strong>' + this._esc(cfg ? cfg.identificadorLabel : 'ID') + ':</strong> ' + this._esc(activo.identificador) + '</p>';
        }
        if (activo.almacen) {
            html += '<p><strong>Almacen:</strong> ' + this._esc(activo.almacen) + '</p>';
        }
        if (cfg && activo.datos) {
            cfg.adminFields.forEach(f => {
                if (activo.datos[f.key] != null && activo.datos[f.key] !== '') {
                    html += '<p><strong>' + this._esc(f.label) + ':</strong> ' + this._esc(activo.datos[f.key]) + '</p>';
                }
            });
        }
        const registros = await window.supabaseClient.getActivoRegistros(activo.id, 10);
        if (registros && registros.length > 0) {
            html += '<div class="activos-registros-block"><h4>Mi historial</h4><ul class="activos-registros-list">';
            registros.forEach(r => {
                html += '<li>' + this._esc(r.fecha) + ' - ' + this._esc(this._formatRegistroDatos(r)) + '</li>';
            });
            html += '</ul></div>';
        }
        html += '</div>';
        content.innerHTML = html;
    }

    async registerWorkerVehicleUsage() {
        const activo = this._workerActivo;
        if (!activo || activo.categoria_codigo !== 'vehiculo') return;

        const km = parseInt(document.getElementById('misActivoKmActual')?.value, 10);
        const litros = document.getElementById('misActivoLitros')?.value;
        const coste = document.getElementById('misActivoCoste')?.value;

        const kmMin = activo.datos && activo.datos.kilometraje_actual != null
            ? activo.datos.kilometraje_actual
            : 0;
        if (!Number.isFinite(km) || km < kmMin) {
            window.ui.showToast(
                kmMin > 0
                    ? 'El kilometraje debe ser al menos ' + kmMin + ' km'
                    : 'Indica el kilometraje actual',
                'error'
            );
            return;
        }

        const result = await window.supabaseClient.registrarUsoVehiculo(
            activo.id,
            km,
            litros !== '' ? parseFloat(litros) : null,
            coste !== '' ? parseFloat(coste) : null
        );

        if (!result.success) {
            window.ui.showToast(result.message || 'Error al registrar', 'error');
            return;
        }

        window.ui.showToast('Uso del dia registrado', 'success');
        this.closeWorkerRegistroModal();
        await this.renderWorkerDetail();
    }

    onShowScreenAdmin(screenName, param) {
        if (screenName === 'activosHub') {
            this.renderAdminHub();
        } else if (screenName === 'activosList' && param) {
            this.renderAdminList(param);
        } else if (screenName === 'activoForm') {
            const p = param;
            const isUuid = p && /^[0-9a-f-]{36}$/i.test(String(p));
            if (isUuid) {
                void this.renderAdminForm(null, p);
            } else {
                void this.renderAdminForm(p, null);
            }
        } else if (screenName === 'activoDetail' && param) {
            this.renderAdminDetail(param);
        }
    }

    onShowScreen(screenName) {
        if (screenName === 'misActivos') {
            this.renderMisActivos();
        } else if (screenName === 'misActivoDetail') {
            this.renderWorkerDetail();
        }
    }
}

window.ActivosManager = ActivosManager;
