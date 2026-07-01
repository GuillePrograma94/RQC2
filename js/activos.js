/**
 * Gestion de activos de empresa (mobiliario).
 * Registro extensible de categorias; UI admin (ADMINISTRACION) y usuarios asignados (DEPENDIENTE/COMERCIAL/ADMINISTRADOR).
 */

const ACTIVOS_CATEGORIAS = {
    vehiculo: {
        codigo: 'vehiculo',
        nombre: 'Vehiculos',
        hubIcon: '🚐',
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
        hubIcon: '🖨️',
        identificadorLabel: 'Nombre / ubicacion',
        adminFields: [
            { key: 'modelo', label: 'Modelo', type: 'text' },
            { key: 'localizacion', label: 'Localizacion', type: 'text' },
            { key: 'tipo_tinta', label: 'Tipo tinta', type: 'text' }
        ],
        trabajadorPuedeRegistrar: false,
        eventoTipo: 'evento_impresora',
        eventoLabels: {
            toner: 'Cambio toner',
            maintenance: 'Mantenimiento',
            panne: 'Averia',
            reparation: 'Reparacion'
        }
    },
    ordenador: {
        codigo: 'ordenador',
        nombre: 'Ordenadores',
        hubIcon: '💻',
        identificadorLabel: 'Numero de serie',
        adminFields: [
            { key: 'modelo', label: 'Modelo', type: 'text' }
        ],
        techFields: [
            { key: 'procesador', label: 'Procesador', type: 'text' },
            { key: 'ram_gb', label: 'RAM (GB)', type: 'number' },
            { key: 'almacenamiento', label: 'Almacenamiento', type: 'text' },
            { key: 'sistema_operativo', label: 'Sistema operativo', type: 'text' },
            { key: 'garantia_fecha_fin', label: 'Garantia (fecha fin)', type: 'date' }
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
        hubIcon: '📱',
        identificadorLabel: 'IMEI',
        adminFields: [
            { key: 'modelo', label: 'Modelo', type: 'text' },
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
        this._ordenadorLicenciasDraft = [];
        this._ordenadorFacturaPending = '';
        this._ordenadorFacturaNombrePending = '';
        this._impresoraFacturaPending = '';
        this._impresoraFacturaNombrePending = '';
    }

    _newLicenciaId() {
        return 'lic-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
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
        document.getElementById('adminActivosOrdenadorLicenciasModalClose')?.addEventListener('click', () => {
            self.closeAdminOrdenadorLicenciasModal();
        });
        document.getElementById('adminActivosOrdenadorLicenciasModalOverlay')?.addEventListener('click', () => {
            self.closeAdminOrdenadorLicenciasModal();
        });
        document.getElementById('adminActivosOrdenadorLicenciasAddBtn')?.addEventListener('click', () => {
            self.addAdminOrdenadorLicenciaRow();
        });
        document.getElementById('adminActivosOrdenadorLicenciasGuardarBtn')?.addEventListener('click', () => {
            self.saveAdminOrdenadorLicenciasModal();
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
        document.getElementById('activoFormEventoBtn')?.addEventListener('click', () => {
            self.registerAdminEvento();
        });
        document.getElementById('activoFormOrdenadorEventoBtn')?.addEventListener('click', () => {
            self.registerAdminEvento();
        });
        document.getElementById('activoFormImpresoraEventoBtn')?.addEventListener('click', () => {
            self.registerAdminEvento();
        });
        document.getElementById('adminActivosVehiculosSearch')?.addEventListener('input', (e) => {
            self._filterAdminActivosList((e.target && e.target.value ? e.target.value : '').trim().toLowerCase());
        });
        document.getElementById('adminActivosHubSearch')?.addEventListener('input', () => {
            self.renderAdminHub();
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

    _getCategoriaIcon(codigo) {
        const cfg = this.getCategoriaConfig(codigo);
        if (cfg && cfg.hubIcon) return cfg.hubIcon;
        const map = { vehiculo: '🚐', impresora: '🖨️', ordenador: '💻', telefono: '📱' };
        return map[codigo] || '📦';
    }

    _buildActivoGlobalSearchText(a) {
        const cat = a.categoria_codigo || '';
        const datos = (a && a.datos) || {};
        const parts = [
            a && a.nombre,
            a && a.identificador,
            a && a.almacen,
            a && a.estado,
            a && a.asignado_nombre,
            a && a.asignado_codigo,
            cat
        ];
        if (cat === 'vehiculo') {
            parts.push(datos.modelo, datos.kilometraje_actual, datos.fecha_itv);
        } else if (cat === 'telefono') {
            parts.push(datos.modelo, datos.operador, datos.numero_linea);
        } else if (cat === 'ordenador') {
            const licencias = Array.isArray(datos.licencias) ? datos.licencias : [];
            parts.push(
                datos.modelo, datos.procesador, datos.ram_gb, datos.almacenamiento,
                datos.sistema_operativo, datos.garantia_fecha_fin, datos.fecha_compra, datos.factura_nombre,
                licencias.map(l => [l.nombre, l.fecha_fin].filter(Boolean).join(' ')).join(' ')
            );
        } else {
            Object.keys(datos).forEach(k => parts.push(datos[k]));
        }
        return parts.filter(v => v != null && v !== '').join(' ').toLowerCase();
    }

    async _searchActivosGlobal(query) {
        const q = (query || '').trim().toLowerCase();
        if (!q) return [];
        if (window.supabaseClient.getActivosBusquedaGlobal) {
            return window.supabaseClient.getActivosBusquedaGlobal(q);
        }
        const conteos = await window.supabaseClient.getActivosConteosCategorias();
        const results = [];
        for (const c of (conteos || [])) {
            const list = await window.supabaseClient.getActivosPorCategoria(c.codigo);
            (list || []).forEach(a => {
                const item = Object.assign({ categoria_codigo: c.codigo }, a);
                if (this._buildActivoGlobalSearchText(item).includes(q)) {
                    results.push(item);
                }
            });
        }
        return results;
    }

    async _renderAdminHubSearchResults(listEl, query) {
        const results = await this._searchActivosGlobal(query);
        if (!results.length) {
            listEl.innerHTML = '<p class="activos-hub-search-empty">Ningun activo coincide con la busqueda.</p>';
            return;
        }
        listEl.innerHTML = results.map(a => {
            const cat = a.categoria_codigo || '';
            const cfg = this.getCategoriaConfig(cat);
            const catLabel = cfg ? cfg.nombre : cat;
            const icon = this._getCategoriaIcon(cat);
            const metaParts = [catLabel];
            if (a.identificador) metaParts.push(a.identificador);
            if (a.almacen) metaParts.push(a.almacen);
            if (a.asignado_nombre) metaParts.push(a.asignado_nombre);
            const badgeHtml = this._renderDisponibilidadBadgeHtml(a, {
                extraClass: 'activos-hub-search-badge',
                checkItv: cat === 'vehiculo'
            });
            return (
                '<button type="button" class="activos-hub-search-item admin-list-item" data-id="' + this._esc(a.id) + '" data-categoria="' + this._esc(cat) + '">' +
                '<span class="activos-hub-card-icon" aria-hidden="true">' + icon + '</span>' +
                '<span class="activos-hub-search-item-body">' +
                '<span class="activos-hub-search-item-head">' +
                '<span class="activos-hub-card-title">' + this._esc(a.nombre) + '</span>' +
                badgeHtml +
                '</span>' +
                '<span class="activos-hub-card-meta">' + this._esc(metaParts.join(' · ')) + '</span>' +
                '</span></button>'
            );
        }).join('');

        listEl.querySelectorAll('.activos-hub-search-item[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const cat = btn.getAttribute('data-categoria');
                if (cat === 'vehiculo' || cat === 'telefono' || cat === 'ordenador' || cat === 'impresora') {
                    this.app.showScreenAdmin('activoForm', id);
                } else {
                    this.app.showScreenAdmin('activoDetail', id);
                }
            });
        });
    }

    async renderAdminHub() {
        const listEl = document.getElementById('adminActivosHubList');
        if (!listEl) return;
        const searchInput = document.getElementById('adminActivosHubSearch');
        const query = (searchInput && searchInput.value ? searchInput.value : '').trim().toLowerCase();

        if (query) {
            listEl.innerHTML = '<p>Buscando...</p>';
            await this._renderAdminHubSearchResults(listEl, query);
            return;
        }

        listEl.innerHTML = '<p>Cargando...</p>';
        const conteos = await window.supabaseClient.getActivosConteosCategorias();
        if (!conteos || conteos.length === 0) {
            listEl.innerHTML = '<p>No hay categorias de activos configuradas.</p>';
            return;
        }
        listEl.innerHTML = conteos.map(c => {
            const cfg = this.getCategoriaConfig(c.codigo);
            const label = cfg ? cfg.nombre : c.nombre;
            const icon = this._getCategoriaIcon(c.codigo);
            return (
                '<button type="button" class="activos-hub-card admin-list-item" data-categoria="' + this._esc(c.codigo) + '">' +
                '<span class="activos-hub-card-icon" aria-hidden="true">' + icon + '</span>' +
                '<span class="activos-hub-card-body">' +
                '<span class="activos-hub-card-title">' + this._esc(label) + '</span>' +
                '<span class="activos-hub-card-meta">' + this._esc(String(c.total || 0)) + ' activos, ' +
                this._esc(String(c.asignados || 0)) + ' asignados</span>' +
                '</span></button>'
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
        const searchWrap = document.getElementById('adminActivosVehiculosSearchWrap');
        const searchInput = document.getElementById('adminActivosVehiculosSearch');
        const esVehiculos = categoria === 'vehiculo';
        const esTelefonos = categoria === 'telefono';
        const esOrdenadores = categoria === 'ordenador';
        const esImpresoras = categoria === 'impresora';
        if (!listEl) return;
        if (searchWrap) searchWrap.style.display = 'none';
        if (searchInput) searchInput.value = '';
        const searchEmptyEl = document.getElementById('adminActivosVehiculosSearchEmpty');
        if (searchEmptyEl) searchEmptyEl.style.display = 'none';
        listEl.innerHTML = '<p>Cargando...</p>';

        const list = await window.supabaseClient.getActivosPorCategoria(categoria);
        const seguroBtn = document.getElementById('adminActivosSeguroBtn');
        const talleresBtn = document.getElementById('adminActivosTalleresBtn');
        if (seguroBtn) seguroBtn.style.display = esVehiculos ? '' : 'none';
        if (talleresBtn) talleresBtn.style.display = esVehiculos ? '' : 'none';

        if (!list || list.length === 0) {
            listEl.classList.remove('activos-vehiculos-grid', 'activos-admin-vehiculos-list', 'activos-admin-telefonos-list', 'activos-admin-ordenadores-list', 'activos-admin-impresoras-list');
            listEl.innerHTML = '<p>No hay activos en esta categoria.</p>';
            return;
        }

        if (searchWrap && (esVehiculos || esTelefonos || esOrdenadores || esImpresoras)) {
            searchWrap.style.display = '';
            if (searchInput) {
                if (esTelefonos) searchInput.placeholder = 'Buscar telefono...';
                else if (esOrdenadores) searchInput.placeholder = 'Buscar ordenador...';
                else if (esImpresoras) searchInput.placeholder = 'Buscar impresora...';
                else searchInput.placeholder = 'Buscar vehiculo...';
            }
        }

        listEl.classList.remove('activos-admin-vehiculos-list');
        listEl.classList.toggle('activos-vehiculos-grid', esVehiculos);
        listEl.classList.toggle('activos-admin-telefonos-list', esTelefonos);
        listEl.classList.toggle('activos-admin-ordenadores-list', esOrdenadores);
        listEl.classList.toggle('activos-admin-impresoras-list', esImpresoras);

        if (esVehiculos) {
            const usosHoy = await Promise.all(
                list.map(a => window.supabaseClient.getActivoUsoVehiculoHoy(a.id))
            );
            list.forEach((a, i) => { a.uso_hoy = usosHoy[i]; });
        }

        listEl.innerHTML = list.map(a => {
            if (esVehiculos) {
                return this._renderVehiculoFichaListItem(a, {
                    dataSearch: this._buildVehiculoAdminSearchText(a)
                });
            }
            if (esTelefonos) {
                return this._renderTelefonoBandItem(a, {
                    admin: true,
                    dataSearch: this._buildTelefonoAdminSearchText(a)
                });
            }
            if (esOrdenadores) {
                return this._renderOrdenadorBandItem(a, {
                    admin: true,
                    dataSearch: this._buildOrdenadorAdminSearchText(a)
                });
            }
            if (esImpresoras) {
                return this._renderImpresoraBandItem(a, {
                    admin: true,
                    dataSearch: this._buildImpresoraAdminSearchText(a)
                });
            }
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

        listEl.querySelectorAll('.activos-ordenador-band-open[data-id], .activos-vehiculo-ficha[data-id], .activos-telefono-band[data-id], .activos-impresora-band[data-id], button.admin-list-item.activos-list-item[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                if (esVehiculos || esTelefonos || esOrdenadores || esImpresoras) {
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

    _getActivoDisponibilidadBadge(activo) {
        const enTaller = this._isVehiculoEnTaller(activo && activo.estado);
        const inactivo = String((activo && activo.estado) || '').toLowerCase() === 'inactivo';
        if (enTaller || inactivo) {
            return { label: 'NO DISPONIBLE', className: 'activos-vehiculo-badge-no-disponible' };
        }
        if (activo && activo.asignado_nombre) {
            return { label: 'OK', className: 'activos-vehiculo-badge-ok' };
        }
        return { label: 'DISPONIBLE', className: 'activos-vehiculo-badge-disponible' };
    }

    _getVehiculoDisponibilidadBadge(activo) {
        const datos = (activo && activo.datos) || {};
        if (this._isItvVencida(datos.fecha_itv)) {
            return { label: 'NO DISPONIBLE', className: 'activos-vehiculo-badge-no-disponible' };
        }
        return this._getActivoDisponibilidadBadge(activo);
    }

    _badgeSourceFromActivo(activo, asignacion, workerView) {
        const src = {
            estado: activo && activo.estado,
            datos: (activo && activo.datos) || {},
            asignado_nombre: (activo && activo.asignado_nombre) || (asignacion && asignacion.asignado_nombre) || null
        };
        if (workerView) {
            src.asignado_nombre = src.asignado_nombre || 'asignado';
        }
        return src;
    }

    _renderDisponibilidadBadgeHtml(activo, opts) {
        const options = opts || {};
        const source = options.badgeSource || activo;
        if (!source) return '';
        const badge = options.checkItv
            ? this._getVehiculoDisponibilidadBadge(source)
            : this._getActivoDisponibilidadBadge(source);
        const extra = options.extraClass ? ' ' + options.extraClass : '';
        return '<span class="activos-vehiculo-ficha-badge ' + badge.className + extra + '">' + this._esc(badge.label) + '</span>';
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
            '<button type="button" class="activos-vehiculo-ficha" data-id="' + this._esc(a.id) + '"' +
            (opts.dataSearch ? ' data-search="' + this._esc(opts.dataSearch) + '"' : '') + '>' +
            inner +
            '</button>'
        );
    }

    _buildVehiculoAdminSearchText(a) {
        const datos = (a && a.datos) || {};
        return [
            a && a.nombre,
            a && a.identificador,
            a && a.almacen,
            datos.modelo,
            a && a.asignado_nombre,
            a && a.asignado_codigo,
            a && a.asignado_tipo,
            a && a.estado,
            datos.kilometraje_actual,
            datos.fecha_itv
        ].filter(v => v != null && v !== '').join(' ').toLowerCase();
    }

    _buildTelefonoAdminSearchText(a) {
        const datos = (a && a.datos) || {};
        return [
            a && a.nombre,
            a && a.identificador,
            a && a.almacen,
            datos.modelo,
            datos.operador,
            datos.numero_linea,
            a && a.asignado_nombre,
            a && a.asignado_codigo,
            a && a.asignado_tipo,
            a && a.estado
        ].filter(v => v != null && v !== '').join(' ').toLowerCase();
    }

    _buildOrdenadorAdminSearchText(a) {
        const datos = (a && a.datos) || {};
        const licencias = Array.isArray(datos.licencias) ? datos.licencias : [];
        const licenciaText = licencias.map(l => [l.nombre, l.fecha_fin].filter(Boolean).join(' ')).join(' ');
        return [
            a && a.nombre,
            a && a.identificador,
            a && a.almacen,
            datos.modelo,
            datos.procesador,
            datos.ram_gb,
            datos.almacenamiento,
            datos.sistema_operativo,
            datos.garantia_fecha_fin,
            datos.fecha_compra,
            datos.factura_nombre,
            licenciaText,
            a && a.asignado_nombre,
            a && a.asignado_codigo,
            a && a.asignado_tipo,
            a && a.estado
        ].filter(v => v != null && v !== '').join(' ').toLowerCase();
    }

    _buildImpresoraAdminSearchText(a) {
        const datos = (a && a.datos) || {};
        return [
            a && a.nombre,
            a && a.identificador,
            a && a.almacen,
            datos.modelo,
            datos.localizacion,
            datos.tipo_tinta,
            datos.fecha_compra,
            datos.factura_nombre,
            a && a.asignado_nombre,
            a && a.asignado_codigo,
            a && a.asignado_tipo,
            a && a.estado
        ].filter(v => v != null && v !== '').join(' ').toLowerCase();
    }

    _filterAdminActivosList(query) {
        const listEl = document.getElementById('adminActivosList');
        if (!listEl) return;
        const cat = this._adminCategoria;
        let selector = '.activos-vehiculo-ficha[data-search]';
        let emptyMsg = 'Ningun vehiculo coincide con la busqueda.';
        if (cat === 'telefono') {
            selector = '.activos-telefono-band[data-search]';
            emptyMsg = 'Ningun telefono coincide con la busqueda.';
        } else if (cat === 'ordenador') {
            selector = '.activos-ordenador-band[data-search]';
            emptyMsg = 'Ningun ordenador coincide con la busqueda.';
        } else if (cat === 'impresora') {
            selector = '.activos-impresora-band[data-search]';
            emptyMsg = 'Ninguna impresora coincide con la busqueda.';
        }
        const items = listEl.querySelectorAll(selector);
        let visible = 0;
        items.forEach(el => {
            const hay = !query || (el.getAttribute('data-search') || '').includes(query);
            el.style.display = hay ? '' : 'none';
            if (hay) visible += 1;
        });
        let emptyEl = document.getElementById('adminActivosVehiculosSearchEmpty');
        if (query && visible === 0 && items.length > 0) {
            if (!emptyEl) {
                emptyEl = document.createElement('p');
                emptyEl.id = 'adminActivosVehiculosSearchEmpty';
                emptyEl.className = 'activos-admin-vehiculos-search-empty';
                listEl.insertAdjacentElement('afterend', emptyEl);
            }
            emptyEl.textContent = emptyMsg;
            emptyEl.style.display = '';
        } else if (emptyEl) {
            emptyEl.style.display = 'none';
        }
    }

    _filterAdminVehiculosList(query) {
        this._filterAdminActivosList(query);
    }

    _renderVehiculoFichaListItem(a, options) {
        const opts = options || {};
        return this._renderVehiculoFichaCard(a, {
            usoCompact: true,
            showAsignado: true,
            dataSearch: opts.dataSearch
        });
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

    _buildMapsSearchUrl(query) {
        const q = String(query || '').trim();
        if (!q) return '';
        return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    }

    _renderWorkerTelefonoLink(telefono, className) {
        if (!telefono) return '';
        const tel = String(telefono).replace(/\s/g, '');
        const cls = className || 'activos-worker-extra-contact-tel';
        return '<a class="' + cls + '" href="tel:' + this._esc(tel) + '">' + this._esc(telefono) + '</a>';
    }

    _renderWorkerTallerDireccion(direccion) {
        if (!direccion) return '';
        const mapsUrl = this._buildMapsSearchUrl(direccion);
        return (
            '<p class="activos-worker-extra-taller-dir">' +
            '<a class="activos-worker-extra-address-link" href="' + this._esc(mapsUrl) + '" target="_blank" rel="noopener noreferrer">' + this._esc(direccion) + '</a>' +
            '</p>'
        );
    }

    _renderWorkerContactList(contactos) {
        if (!contactos || contactos.length === 0) {
            return '<p class="activos-worker-extra-empty">Sin contactos configurados.</p>';
        }
        return '<ul class="activos-worker-extra-list">' + contactos.map(c => (
            '<li class="activos-worker-extra-contact">' +
            '<span class="activos-worker-extra-contact-name">' + this._esc(c.nombre || 'Contacto') + '</span>' +
            this._renderWorkerTelefonoLink(c.telefono) +
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
            this._renderWorkerTelefonoLink(t.telefono) +
            this._renderWorkerTallerDireccion(t.direccion) +
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
            '<th title="Fecha">Fecha</th>' +
            '<th title="Kilometros del dia">Km</th>' +
            '<th title="Litros">L</th>' +
            '<th title="Coste (EUR)">€</th>' +
            '<th title="Kilometraje actual">Km+</th>' +
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
        let selHtml = '<option value="">-- Sin asignar --</option>';
        (trabajadores || []).forEach(t => {
            const selected = asignacion && asignacion.auth_uid === t.auth_uid ? ' selected' : '';
            selHtml += '<option value="' + this._esc(t.auth_uid) + '" data-usuario-id="' + (t.usuario_id || '') + '" data-comercial-id="' + (t.comercial_id || '') + '"' + selected + '>';
            selHtml += this._esc(t.nombre) + ' (' + this._esc(t.tipo) + ' - ' + this._esc(t.codigo) + ')';
            selHtml += '</option>';
        });
        return (
            '<div class="admin-solicitud-field admin-solicitud-field-full">' +
            '<label for="activoFormTrabajadorSelect">Usuario asignado</label>' +
            '<select id="activoFormTrabajadorSelect">' + selHtml + '</select>' +
            '</div>'
        );
    }

    async _syncVehiculoFormAsignacion(activoId) {
        const sel = document.getElementById('activoFormTrabajadorSelect');
        if (!sel || !activoId) {
            return { success: true };
        }
        const authUid = (sel.value || '').trim();
        if (!authUid) {
            return window.supabaseClient.desasignarActivo(activoId);
        }
        const opt = sel.options[sel.selectedIndex];
        return window.supabaseClient.asignarActivoTrabajador(
            activoId,
            authUid,
            opt.getAttribute('data-usuario-id') ? parseInt(opt.getAttribute('data-usuario-id'), 10) : null,
            opt.getAttribute('data-comercial-id') ? parseInt(opt.getAttribute('data-comercial-id'), 10) : null
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

    _bindAdminHistorialSearch(searchInputId, tbodyId) {
        const input = document.getElementById(searchInputId || 'activoFormHistorialSearch');
        const tbody = document.getElementById(tbodyId || 'activoFormHistorialTbody');
        if (!input || !tbody) return;
        input.addEventListener('input', () => {
            const q = (input.value || '').trim().toLowerCase();
            tbody.querySelectorAll('tr[data-historial-row]').forEach(tr => {
                const hay = (tr.getAttribute('data-search') || '').includes(q);
                tr.style.display = hay ? '' : 'none';
            });
        });
    }

    _resolveEventoSubtipoLabel(cfg, subtipo) {
        if (!subtipo) return '—';
        if (cfg && cfg.eventoLabels && cfg.eventoLabels[subtipo]) {
            return cfg.eventoLabels[subtipo];
        }
        return String(subtipo);
    }

    _renderEventoHistorialTable(registros, trabajadores, cfg, opts) {
        const options = opts || {};
        let bodyHtml;
        if (!registros || registros.length === 0) {
            bodyHtml = '<tr><td colspan="4" class="activos-vehiculo-historial-empty">Sin registros</td></tr>';
        } else {
            bodyHtml = registros.map(r => {
                const d = r.datos || {};
                const fecha = this._esc(this._formatFechaDdMmAa(r.fecha));
                const usuario = this._esc(this._resolveRegistroUsuario(r, trabajadores));
                const tipo = this._esc(this._resolveEventoSubtipoLabel(cfg, d.subtipo || r.tipo));
                const detalle = this._esc(this._formatEventoRegistroDetalle(r));
                const searchText = [fecha, usuario, tipo, detalle].join(' ').toLowerCase();
                return (
                    '<tr data-historial-row data-search="' + this._esc(searchText) + '">' +
                    '<td>' + fecha + '</td>' +
                    '<td>' + usuario + '</td>' +
                    '<td>' + tipo + '</td>' +
                    '<td>' + detalle + '</td>' +
                    '</tr>'
                );
            }).join('');
        }

        const tableHtml =
            '<div class="activos-vehiculo-historial-table-wrap">' +
            '<table class="activos-vehiculo-historial-table">' +
            '<thead><tr>' +
            '<th>Fecha</th><th>Usuario</th><th>Tipo</th><th>Detalle</th>' +
            '</tr></thead>' +
            '<tbody' + (options.tbodyId ? ' id="' + options.tbodyId + '"' : '') + '>' + bodyHtml + '</tbody>' +
            '</table></div>';

        if (options.variant === 'admin') {
            const inner =
                '<div class="activos-admin-historial-search-wrap">' +
                '<input type="search" id="' + this._esc(options.searchInputId || 'activoFormTelefonoHistorialSearch') + '" class="activos-admin-historial-search" placeholder="Buscar en historial..." autocomplete="off">' +
                '</div>' +
                tableHtml;
            return this._renderAdminVehiculoPanel('Historial', inner, {
                collapsible: true,
                panelId: options.panelId || 'activoFormTelefonoHistorialPanel',
                extraClass: 'activos-admin-block--historial'
            });
        }

        const count = (registros && registros.length) ? registros.length : 0;
        const countLabel = count === 1 ? '1 registro' : count + ' registros';
        return this._renderWorkerCollapsible('Mi historial', countLabel, tableHtml, 'activos-worker-historial');
    }

    _renderWorkerTelefonoDetail(activo, cfg, registros) {
        const datos = activo.datos || {};
        let fieldsHtml = '';
        if (activo.identificador) {
            fieldsHtml += this._renderActivoDetailReadonlyField(cfg ? cfg.identificadorLabel : 'IMEI', activo.identificador);
        }
        if (datos.modelo) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Modelo', datos.modelo);
        }
        if (activo.almacen) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Almacen', activo.almacen);
        }
        if (datos.operador) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Operador', datos.operador);
        }
        if (datos.numero_linea) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Numero de linea', datos.numero_linea, { telLink: true });
        }

        return (
            '<div class="activos-worker-telefono-detail">' +
            '<div class="activos-worker-telefono-card">' +
            '<div class="activos-worker-telefono-card-head">' +
            '<h3 class="activos-worker-telefono-title">' + this._esc(activo.nombre) + '</h3>' +
            this._renderDisponibilidadBadgeHtml(null, {
                badgeSource: this._badgeSourceFromActivo(activo, null, true),
                extraClass: 'activos-activo-band-badge'
            }) +
            '</div>' +
            '<div class="activos-worker-telefono-fields">' + fieldsHtml + '</div>' +
            '</div>' +
            this._renderEventoHistorialTable(registros, null, cfg, { variant: 'worker' }) +
            '</div>'
        );
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
        const modeloField = (cfg.adminFields || []).find(f => f.key === 'modelo');
        let html = '';

        html += '<div class="admin-solicitud-field"><label for="activoFormNombre">Nombre</label>';
        html += '<input type="text" id="activoFormNombre" required value="' + this._esc(activo ? activo.nombre : '') + '"></div>';
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
        html += '<div class="admin-solicitud-field"><label for="activoFormIdentificador">' + this._esc(cfg.identificadorLabel) + '</label>';
        html += '<input type="text" id="activoFormIdentificador" value="' + this._esc(activo ? activo.identificador : '') + '"></div>';
        if (modeloField) {
            html += this._renderVehiculoFormField(modeloField, datos);
        }
        html += '<div class="admin-solicitud-field"><label for="activoFormEstado">Estado</label>';
        html += '<select id="activoFormEstado">';
        ['activo', 'inactivo', 'mantenimiento', 'averia'].forEach(st => {
            const sel = activo && activo.estado === st ? ' selected' : (!activo && st === 'activo' ? ' selected' : '');
            html += '<option value="' + st + '"' + sel + '>' + st + '</option>';
        });
        html += '</select></div>';
        if (options.showAsignacion) {
            html += this._renderVehiculoFormAsignacionInline(options.asignacion, options.trabajadores);
        }
        if (kmField) {
            html += this._renderVehiculoFormField(kmField, datos);
        }
        if (itvField) {
            html += this._renderVehiculoFormField(itvField, datos);
        }

        return html;
    }

    _renderTelefonoVisual(activo, opts) {
        const options = opts || {};
        const datos = activo.datos || {};
        const modelo = datos.modelo ? String(datos.modelo) : '';
        const linea = datos.numero_linea || activo.identificador || '';
        const variant = options.variant || 'ficha';
        const badgeHtml = this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(activo, options.asignacion, options.workerView)
        });
        return (
            '<div class="activos-telefono-visual activos-telefono-visual--' + variant + '">' +
            badgeHtml +
            '<div class="activos-telefono-device" aria-hidden="true">' +
            '<span class="activos-telefono-device-notch"></span>' +
            '<span class="activos-telefono-device-screen">' +
            (linea ? '<span class="activos-telefono-device-linea">' + this._esc(linea) + '</span>' : '') +
            '<span class="activos-telefono-device-modelo">' + this._esc(modelo || activo.nombre || 'Telefono') + '</span>' +
            '</span></div></div>'
        );
    }

    _renderTelefonoBandChip(label, value, chipOpts) {
        if (value == null || value === '') return '';
        const options = chipOpts || {};
        let valueHtml = this._esc(value);
        if (options.telLink) {
            const tel = String(value).replace(/\s/g, '');
            valueHtml = '<a class="activos-telefono-band-tel" href="tel:' + this._esc(tel) + '">' + this._esc(value) + '</a>';
        }
        return (
            '<span class="activos-telefono-band-chip">' +
            '<span class="activos-telefono-band-chip-label">' + this._esc(label) + '</span>' +
            '<span class="activos-telefono-band-chip-value">' + valueHtml + '</span>' +
            '</span>'
        );
    }

    _renderTelefonoBandItem(a, opts) {
        const options = opts || {};
        const datos = a.datos || {};
        const badgeHtml = this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(a, null, options.worker),
            extraClass: 'activos-activo-band-badge'
        });
        const subtitleParts = [];
        if (datos.modelo) subtitleParts.push(this._esc(datos.modelo));
        if (datos.operador) subtitleParts.push(this._esc(datos.operador));

        let chipsHtml = '';
        chipsHtml += this._renderTelefonoBandChip('IMEI', a.identificador);
        chipsHtml += this._renderTelefonoBandChip('Linea', datos.numero_linea, { telLink: true });
        chipsHtml += this._renderTelefonoBandChip('Almacen', a.almacen);
        if (options.admin && a.asignado_nombre) {
            const asignadoTxt = a.asignado_codigo
                ? a.asignado_nombre + ' (' + a.asignado_codigo + ')'
                : a.asignado_nombre;
            chipsHtml += this._renderTelefonoBandChip('Asignado', asignadoTxt);
        }

        const searchAttr = options.dataSearch != null
            ? ' data-search="' + this._esc(options.dataSearch) + '"'
            : '';

        const baseClass = options.admin
            ? 'admin-list-item activos-list-item activos-telefono-band'
            : 'activos-telefono-band activos-mis-item';

        return (
            '<button type="button" class="' + baseClass + '" data-id="' + this._esc(a.id) + '"' + searchAttr + '>' +
            '<span class="activos-telefono-band-head">' +
            '<span class="activos-telefono-band-title-block">' +
            '<strong class="activos-telefono-band-nombre">' + this._esc(a.nombre) + '</strong>' +
            (subtitleParts.length ? '<span class="activos-telefono-band-subtitle">' + subtitleParts.join(' · ') + '</span>' : '') +
            '</span>' +
            badgeHtml +
            '</span>' +
            (chipsHtml ? '<span class="activos-telefono-band-details">' + chipsHtml + '</span>' : '') +
            '</button>'
        );
    }

    _renderImpresoraBandChip(label, value) {
        if (value == null || value === '') return '';
        return (
            '<span class="activos-telefono-band-chip">' +
            '<span class="activos-telefono-band-chip-label">' + this._esc(label) + '</span>' +
            '<span class="activos-telefono-band-chip-value">' + this._esc(value) + '</span>' +
            '</span>'
        );
    }

    _renderActivoCompraBandHtml(datos) {
        const d = datos || {};
        let inner = '';
        if (d.fecha_compra) {
            inner += '<span class="activos-ordenador-band-compra-fecha">Compra: ' + this._esc(this._formatFechaDdMmAa(d.fecha_compra)) + '</span>';
        }
        if (d.factura_url) {
            inner += (inner ? ' · ' : '') +
                '<a class="activos-ordenador-factura-link" href="' + this._esc(d.factura_url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' +
                this._esc(d.factura_nombre || 'Factura PDF') + '</a>';
        }
        return inner ? '<span class="activos-ordenador-band-compra">' + inner + '</span>' : '';
    }

    _renderImpresoraBandItem(a, opts) {
        const options = opts || {};
        const datos = a.datos || {};
        const badgeHtml = this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(a, null, options.worker),
            extraClass: 'activos-activo-band-badge'
        });
        const subtitleParts = [];
        if (datos.modelo) subtitleParts.push(this._esc(datos.modelo));
        if (datos.localizacion) subtitleParts.push(this._esc(datos.localizacion));

        let chipsHtml = '';
        chipsHtml += this._renderImpresoraBandChip('Almacen', a.almacen);
        if (datos.tipo_tinta) chipsHtml += this._renderImpresoraBandChip('Tinta', datos.tipo_tinta);

        const compraHtml = this._renderActivoCompraBandHtml(datos);

        const searchAttr = options.dataSearch != null
            ? ' data-search="' + this._esc(options.dataSearch) + '"'
            : '';

        const baseClass = options.admin
            ? 'admin-list-item activos-list-item activos-telefono-band activos-impresora-band'
            : 'activos-telefono-band activos-impresora-band activos-mis-item';

        return (
            '<button type="button" class="' + baseClass + '" data-id="' + this._esc(a.id) + '"' + searchAttr + '>' +
            '<span class="activos-telefono-band-head">' +
            '<span class="activos-telefono-band-title-block">' +
            '<strong class="activos-telefono-band-nombre">' + this._esc(a.nombre) + '</strong>' +
            (subtitleParts.length ? '<span class="activos-telefono-band-subtitle">' + subtitleParts.join(' · ') + '</span>' : '') +
            '</span>' +
            badgeHtml +
            '</span>' +
            (chipsHtml ? '<span class="activos-telefono-band-details">' + chipsHtml + '</span>' : '') +
            compraHtml +
            '</button>'
        );
    }

    _renderOrdenadorVisual(activo, opts) {
        const options = opts || {};
        const datos = activo.datos || {};
        const modelo = datos.modelo ? String(datos.modelo) : '';
        const serie = activo.identificador || '';
        const variant = options.variant || 'ficha';
        const badgeHtml = this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(activo, options.asignacion, options.workerView)
        });
        return (
            '<div class="activos-ordenador-visual activos-ordenador-visual--' + variant + '">' +
            badgeHtml +
            '<div class="activos-ordenador-device" aria-hidden="true">' +
            '<div class="activos-ordenador-device-screen">' +
            (modelo ? '<span class="activos-ordenador-device-modelo">' + this._esc(modelo) + '</span>' : '') +
            (serie ? '<span class="activos-ordenador-device-serie">' + this._esc(serie) + '</span>' : '') +
            '</div>' +
            '<div class="activos-ordenador-device-base"></div>' +
            '</div></div>'
        );
    }

    _renderOrdenadorBandItem(a, opts) {
        const options = opts || {};
        const datos = a.datos || {};
        const badgeHtml = this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(a, null, options.worker),
            extraClass: 'activos-activo-band-badge'
        });
        const asignadoTxt = a.asignado_nombre
            ? (a.asignado_codigo ? a.asignado_nombre + ' (' + a.asignado_codigo + ')' : a.asignado_nombre)
            : 'Sin asignar';
        const mainParts = [a.nombre, datos.modelo];
        if (!options.worker) {
            mainParts.push(asignadoTxt);
        }
        const mainLine = mainParts.filter(v => v != null && v !== '').map(p => this._esc(p)).join(' <span class="activos-ordenador-band-sep">/</span> ');

        const compraHtml = this._renderActivoCompraBandHtml(datos);

        const licencias = Array.isArray(datos.licencias) ? datos.licencias.filter(l => l && (l.nombre || l.fecha_fin)) : [];
        const licenciasPanel = this._renderOrdenadorLicenciasCollapsible(licencias, { variant: 'band' });

        const cfg = this.getCategoriaConfig('ordenador');
        const techPanel = this._renderOrdenadorDetalleTecnicoCollapsible(a, cfg, datos, { variant: 'band' });

        const searchAttr = options.dataSearch != null
            ? ' data-search="' + this._esc(options.dataSearch) + '"'
            : '';

        const openBtnClass = options.admin
            ? 'activos-ordenador-band-open admin-list-item activos-list-item'
            : 'activos-ordenador-band-open activos-mis-item';

        return (
            '<div class="activos-ordenador-band"' + searchAttr + '>' +
            '<button type="button" class="' + openBtnClass + '" data-id="' + this._esc(a.id) + '">' +
            '<span class="activos-ordenador-band-head">' +
            '<span class="activos-ordenador-band-mainline">' + mainLine + '</span>' +
            badgeHtml +
            '</span>' +
            compraHtml +
            '</button>' +
            licenciasPanel +
            techPanel +
            '</div>'
        );
    }

    _isLicenciaVencida(fechaFin) {
        if (!fechaFin) return false;
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const fin = new Date(fechaFin + 'T00:00:00');
        if (isNaN(fin.getTime())) return false;
        return fin < hoy;
    }

    _renderOrdenadorLicenciasCollapsible(licencias, opts) {
        const options = opts || {};
        const list = Array.isArray(licencias) ? licencias : [];
        const count = list.length;
        const countLabel = count === 1 ? '1 licencia' : count + ' licencias';
        let bodyHtml;
        if (!count) {
            bodyHtml = '<p class="activos-ordenador-licencias-empty">Sin licencias registradas.</p>';
        } else {
            bodyHtml = '<ul class="activos-ordenador-licencias-band-list">' + list.map(l => {
                const vencida = this._isLicenciaVencida(l.fecha_fin);
                let meta = '';
                if (l.fecha_fin) meta = 'Fin: ' + this._esc(this._formatFechaDdMmAa(l.fecha_fin));
                return (
                    '<li class="activos-ordenador-licencias-band-item' + (vencida ? ' activos-ordenador-licencia-row--vencida' : '') + '">' +
                    '<span class="activos-ordenador-licencias-band-nombre">' + this._esc(l.nombre || 'Licencia') + '</span>' +
                    (meta ? '<span class="activos-ordenador-licencias-band-meta">' + meta + '</span>' : '') +
                    '</li>'
                );
            }).join('') + '</ul>';
        }
        const panelClass = options.variant === 'band'
            ? 'activos-ordenador-band-panel activos-ordenador-licencias-panel'
            : 'activos-worker-collapsible activos-ordenador-licencias-panel';
        return (
            '<details class="' + panelClass + '" onclick="event.stopPropagation()">' +
            '<summary>Licencias <span class="activos-ordenador-panel-count">(' + this._esc(countLabel) + ')</span></summary>' +
            '<div class="activos-ordenador-panel-body">' + bodyHtml + '</div>' +
            '</details>'
        );
    }

    _renderOrdenadorDetalleTecnicoCollapsible(activo, cfg, datos, opts) {
        const options = opts || {};
        const d = datos || {};
        const rows = [];
        if (activo && activo.identificador) {
            rows.push({ label: cfg ? cfg.identificadorLabel : 'Numero de serie', value: activo.identificador });
        }
        (cfg && cfg.techFields ? cfg.techFields : []).forEach(f => {
            const v = d[f.key];
            if (v == null || v === '') return;
            let display = String(v);
            if (f.type === 'date') display = this._formatFechaDdMmAa(v);
            else if (f.key === 'ram_gb') display = v + ' GB';
            rows.push({ label: f.label, value: display });
        });
        if (!rows.length) return '';
        const gridHtml = rows.map(r =>
            '<div class="activos-ordenador-tech-row">' +
            '<span class="activos-ordenador-tech-label">' + this._esc(r.label) + '</span>' +
            '<span class="activos-ordenador-tech-value">' + this._esc(r.value) + '</span>' +
            '</div>'
        ).join('');
        const panelClass = options.variant === 'band'
            ? 'activos-ordenador-band-panel activos-ordenador-tech-panel'
            : 'activos-worker-collapsible activos-ordenador-tech-panel';
        return (
            '<details class="' + panelClass + '"' + (options.variant === 'band' ? ' onclick="event.stopPropagation()"' : '') + '>' +
            '<summary>Detalles tecnicos</summary>' +
            '<div class="activos-ordenador-panel-body activos-ordenador-tech-grid">' + gridHtml + '</div>' +
            '</details>'
        );
    }

    _buildOrdenadorFormFieldsHtml(activo, cfg, datos, almacenes, opts) {
        const options = opts || {};
        const d = datos || {};
        let html = '';

        html += '<div class="activos-ordenador-form-section">';
        html += '<h4 class="admin-detail-completar-title">Datos generales</h4>';
        html += '<div class="admin-solicitud-fields activos-ordenador-form-general">';
        html += '<div class="admin-solicitud-field"><label for="activoFormNombre">Nombre</label>';
        html += '<input type="text" id="activoFormNombre" required value="' + this._esc(activo ? activo.nombre : '') + '"></div>';
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
        (cfg.adminFields || []).forEach(f => {
            const val = d[f.key] != null ? d[f.key] : '';
            html += '<div class="admin-solicitud-field"><label for="activoForm_' + f.key + '">' + this._esc(f.label) + '</label>';
            html += '<input type="' + (f.type || 'text') + '" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + '>';
            html += '</div>';
        });
        html += '<div class="admin-solicitud-field"><label for="activoFormEstado">Estado</label>';
        html += '<select id="activoFormEstado">';
        ['activo', 'inactivo', 'mantenimiento', 'averia'].forEach(st => {
            const sel = activo && activo.estado === st ? ' selected' : (!activo && st === 'activo' ? ' selected' : '');
            html += '<option value="' + st + '"' + sel + '>' + st + '</option>';
        });
        html += '</select></div>';
        if (options.showAsignacion) {
            html += this._renderVehiculoFormAsignacionInline(options.asignacion, options.trabajadores);
        }
        html += '</div></div>';

        html += '<div class="activos-ordenador-form-section activos-ordenador-compra-section">';
        html += '<h4 class="admin-detail-completar-title">Compra del ordenador</h4>';
        html += '<div class="admin-solicitud-fields">';
        html += '<div class="admin-solicitud-field"><label for="activoFormOrdenadorFechaCompra">Fecha de compra</label>';
        html += '<input type="date" id="activoFormOrdenadorFechaCompra" value="' + this._esc(d.fecha_compra || '') + '"></div>';
        html += this._renderOrdenadorFacturaField(d);
        html += '</div></div>';

        html += '<div class="activos-ordenador-form-section activos-ordenador-licencias-section">';
        html += '<div class="activos-ordenador-licencias-form-head">';
        html += '<h4 class="admin-detail-completar-title">Licencias de software</h4>';
        html += '<button type="button" id="activoFormLicenciasBtn" class="btn btn-secondary btn-sm">Gestionar licencias</button>';
        html += '</div>';
        html += '<div id="activoFormLicenciasSummary" class="activos-ordenador-licencias-form-summary"></div>';
        html += '</div>';

        html += '<div class="activos-ordenador-form-section activos-ordenador-tech-section">';
        html += '<h4 class="admin-detail-completar-title">Detalles tecnicos</h4>';
        html += '<div class="admin-solicitud-fields activos-ordenador-form-tech">';
        html += '<div class="admin-solicitud-field"><label for="activoFormIdentificador">' + this._esc(cfg.identificadorLabel) + '</label>';
        html += '<input type="text" id="activoFormIdentificador" value="' + this._esc(activo ? activo.identificador : '') + '"></div>';
        (cfg.techFields || []).forEach(f => {
            const val = d[f.key] != null ? d[f.key] : '';
            html += '<div class="admin-solicitud-field"><label for="activoForm_' + f.key + '">' + this._esc(f.label) + '</label>';
            if (f.type === 'number') {
                html += '<input type="number" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + ' min="0">';
            } else if (f.type === 'date') {
                html += '<input type="date" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + '>';
            } else {
                html += '<input type="' + (f.type || 'text') + '" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + '>';
            }
            html += '</div>';
        });
        html += '</div></div>';

        return html;
    }

    _renderOrdenadorFacturaField(datos) {
        const d = datos || {};
        const hasFactura = !!(d.factura_url);
        return (
            '<div class="admin-solicitud-field activos-ordenador-factura-field">' +
            '<label>Factura PDF (ordenador)</label>' +
            '<input type="hidden" id="activoFormOrdenadorFacturaUrl" value="' + this._esc(hasFactura ? d.factura_url : '') + '">' +
            '<div class="activos-ordenador-factura-actions">' +
            (hasFactura
                ? '<a id="activoFormOrdenadorFacturaLink" class="activos-ordenador-factura-link" href="' + this._esc(d.factura_url) + '" target="_blank" rel="noopener">' + this._esc(d.factura_nombre || 'Ver factura PDF') + '</a>'
                : '<span id="activoFormOrdenadorFacturaEmpty" class="activos-ordenador-factura-empty">Sin factura</span>') +
            '<button type="button" id="activoFormOrdenadorFacturaBtn" class="btn btn-secondary btn-sm">Subir PDF</button>' +
            '<button type="button" id="activoFormOrdenadorFacturaQuitar" class="btn btn-secondary btn-sm"' + (hasFactura ? '' : ' style="display:none"') + '>Quitar</button>' +
            '<input type="file" id="activoFormOrdenadorFacturaFile" accept="application/pdf,.pdf" hidden>' +
            '</div></div>'
        );
    }

    _syncOrdenadorFacturaUi() {
        const hidden = document.getElementById('activoFormOrdenadorFacturaUrl');
        const removeBtn = document.getElementById('activoFormOrdenadorFacturaQuitar');
        const actions = document.querySelector('.activos-ordenador-factura-actions');
        const url = this._ordenadorFacturaPending || (hidden && hidden.value) || '';
        let link = document.getElementById('activoFormOrdenadorFacturaLink');
        let empty = document.getElementById('activoFormOrdenadorFacturaEmpty');
        if (url) {
            if (!link && actions) {
                if (empty) empty.remove();
                link = document.createElement('a');
                link.id = 'activoFormOrdenadorFacturaLink';
                link.className = 'activos-ordenador-factura-link';
                link.target = '_blank';
                link.rel = 'noopener';
                actions.insertBefore(link, actions.firstChild);
            }
            if (link) {
                link.href = url;
                link.textContent = this._ordenadorFacturaNombrePending || link.textContent || 'Ver factura PDF';
            }
            if (removeBtn) removeBtn.style.display = '';
        } else {
            if (link) link.remove();
            if (!empty && actions) {
                empty = document.createElement('span');
                empty.id = 'activoFormOrdenadorFacturaEmpty';
                empty.className = 'activos-ordenador-factura-empty';
                empty.textContent = 'Sin factura';
                actions.insertBefore(empty, actions.firstChild);
            }
            if (removeBtn) removeBtn.style.display = 'none';
        }
    }

    _bindOrdenadorFacturaForm(datos) {
        const pickBtn = document.getElementById('activoFormOrdenadorFacturaBtn');
        const fileInput = document.getElementById('activoFormOrdenadorFacturaFile');
        const removeBtn = document.getElementById('activoFormOrdenadorFacturaQuitar');
        const hidden = document.getElementById('activoFormOrdenadorFacturaUrl');
        if (!pickBtn || pickBtn.dataset.bound === '1') {
            this._syncOrdenadorFacturaUi();
            return;
        }
        pickBtn.dataset.bound = '1';
        this._ordenadorFacturaPending = '';
        this._ordenadorFacturaNombrePending = (datos && datos.factura_nombre) || '';
        pickBtn.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
            if (!isPdf) {
                window.ui.showToast('Selecciona un archivo PDF', 'error');
                return;
            }
            if (file.size > 8 * 1024 * 1024) {
                window.ui.showToast('El PDF no puede superar 8 MB', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = typeof reader.result === 'string' ? reader.result : '';
                if (!dataUrl) return;
                this._ordenadorFacturaPending = dataUrl;
                this._ordenadorFacturaNombrePending = file.name || 'factura.pdf';
                if (hidden) hidden.value = '';
                this._syncOrdenadorFacturaUi();
            };
            reader.readAsDataURL(file);
        });
        removeBtn?.addEventListener('click', () => {
            this._ordenadorFacturaPending = '';
            this._ordenadorFacturaNombrePending = '';
            if (hidden) hidden.value = '';
            this._syncOrdenadorFacturaUi();
        });
        this._syncOrdenadorFacturaUi();
    }

    _readOrdenadorFacturaFromForm() {
        const hidden = document.getElementById('activoFormOrdenadorFacturaUrl');
        const url = this._ordenadorFacturaPending || (hidden && hidden.value) || '';
        if (!url) return null;
        const link = document.getElementById('activoFormOrdenadorFacturaLink');
        return {
            url,
            nombre: this._ordenadorFacturaNombrePending || (link && link.textContent ? link.textContent.trim() : '') || 'factura.pdf'
        };
    }

    _renderImpresoraFacturaField(datos) {
        const d = datos || {};
        const hasFactura = !!(d.factura_url);
        return (
            '<div class="admin-solicitud-field activos-ordenador-factura-field">' +
            '<label>Factura PDF (impresora)</label>' +
            '<input type="hidden" id="activoFormImpresoraFacturaUrl" value="' + this._esc(hasFactura ? d.factura_url : '') + '">' +
            '<div class="activos-ordenador-factura-actions">' +
            (hasFactura
                ? '<a id="activoFormImpresoraFacturaLink" class="activos-ordenador-factura-link" href="' + this._esc(d.factura_url) + '" target="_blank" rel="noopener">' + this._esc(d.factura_nombre || 'Ver factura PDF') + '</a>'
                : '<span id="activoFormImpresoraFacturaEmpty" class="activos-ordenador-factura-empty">Sin factura</span>') +
            '<button type="button" id="activoFormImpresoraFacturaBtn" class="btn btn-secondary btn-sm">Subir PDF</button>' +
            '<button type="button" id="activoFormImpresoraFacturaQuitar" class="btn btn-secondary btn-sm"' + (hasFactura ? '' : ' style="display:none"') + '>Quitar</button>' +
            '<input type="file" id="activoFormImpresoraFacturaFile" accept="application/pdf,.pdf" hidden>' +
            '</div></div>'
        );
    }

    _syncImpresoraFacturaUi() {
        const hidden = document.getElementById('activoFormImpresoraFacturaUrl');
        const removeBtn = document.getElementById('activoFormImpresoraFacturaQuitar');
        const actions = document.getElementById('activoFormImpresoraFacturaBtn')?.closest('.activos-ordenador-factura-actions');
        const url = this._impresoraFacturaPending || (hidden && hidden.value) || '';
        let link = document.getElementById('activoFormImpresoraFacturaLink');
        let empty = document.getElementById('activoFormImpresoraFacturaEmpty');
        if (url) {
            if (!link && actions) {
                if (empty) empty.remove();
                link = document.createElement('a');
                link.id = 'activoFormImpresoraFacturaLink';
                link.className = 'activos-ordenador-factura-link';
                link.target = '_blank';
                link.rel = 'noopener';
                actions.insertBefore(link, actions.firstChild);
            }
            if (link) {
                link.href = url;
                link.textContent = this._impresoraFacturaNombrePending || link.textContent || 'Ver factura PDF';
            }
            if (removeBtn) removeBtn.style.display = '';
        } else {
            if (link) link.remove();
            if (!empty && actions) {
                empty = document.createElement('span');
                empty.id = 'activoFormImpresoraFacturaEmpty';
                empty.className = 'activos-ordenador-factura-empty';
                empty.textContent = 'Sin factura';
                actions.insertBefore(empty, actions.firstChild);
            }
            if (removeBtn) removeBtn.style.display = 'none';
        }
    }

    _bindImpresoraFacturaForm(datos) {
        const pickBtn = document.getElementById('activoFormImpresoraFacturaBtn');
        const fileInput = document.getElementById('activoFormImpresoraFacturaFile');
        const removeBtn = document.getElementById('activoFormImpresoraFacturaQuitar');
        const hidden = document.getElementById('activoFormImpresoraFacturaUrl');
        if (!pickBtn || pickBtn.dataset.bound === '1') {
            this._syncImpresoraFacturaUi();
            return;
        }
        pickBtn.dataset.bound = '1';
        this._impresoraFacturaPending = '';
        this._impresoraFacturaNombrePending = (datos && datos.factura_nombre) || '';
        pickBtn.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
            if (!isPdf) {
                window.ui.showToast('Selecciona un archivo PDF', 'error');
                return;
            }
            if (file.size > 8 * 1024 * 1024) {
                window.ui.showToast('El PDF no puede superar 8 MB', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = typeof reader.result === 'string' ? reader.result : '';
                if (!dataUrl) return;
                this._impresoraFacturaPending = dataUrl;
                this._impresoraFacturaNombrePending = file.name || 'factura.pdf';
                if (hidden) hidden.value = '';
                this._syncImpresoraFacturaUi();
            };
            reader.readAsDataURL(file);
        });
        removeBtn?.addEventListener('click', () => {
            this._impresoraFacturaPending = '';
            this._impresoraFacturaNombrePending = '';
            if (hidden) hidden.value = '';
            this._syncImpresoraFacturaUi();
        });
        this._syncImpresoraFacturaUi();
    }

    _readImpresoraFacturaFromForm() {
        const hidden = document.getElementById('activoFormImpresoraFacturaUrl');
        const url = this._impresoraFacturaPending || (hidden && hidden.value) || '';
        if (!url) return null;
        const link = document.getElementById('activoFormImpresoraFacturaLink');
        return {
            url,
            nombre: this._impresoraFacturaNombrePending || (link && link.textContent ? link.textContent.trim() : '') || 'factura.pdf'
        };
    }

    _normalizeOrdenadorLicencias(list) {
        return (Array.isArray(list) ? list : []).map(l => ({
            id: (l && l.id) ? l.id : this._newLicenciaId(),
            nombre: (l && l.nombre) ? String(l.nombre) : '',
            fecha_fin: (l && l.fecha_fin) ? String(l.fecha_fin) : ''
        }));
    }

    _renderOrdenadorLicenciasFormSummary() {
        const el = document.getElementById('activoFormLicenciasSummary');
        if (!el) return;
        const licencias = (this._ordenadorLicenciasDraft || []).filter(l => l.nombre || l.fecha_fin);
        if (!licencias.length) {
            el.innerHTML = '<p class="activos-ordenador-licencias-empty">Sin licencias registradas. Pulsa «Gestionar licencias».</p>';
            return;
        }
        el.innerHTML = '<ul class="activos-ordenador-licencias-summary-list">' + licencias.map(l => {
            const vencida = this._isLicenciaVencida(l.fecha_fin);
            let meta = l.fecha_fin ? 'Fin: ' + this._esc(this._formatFechaDdMmAa(l.fecha_fin)) : '';
            return (
                '<li class="activos-ordenador-licencias-summary-item' + (vencida ? ' activos-ordenador-licencia-row--vencida' : '') + '">' +
                '<span class="activos-ordenador-licencias-summary-nombre">' + this._esc(l.nombre || 'Licencia') + '</span>' +
                (meta ? '<span class="activos-ordenador-licencias-summary-meta">' + meta + '</span>' : '') +
                '</li>'
            );
        }).join('') + '</ul>';
    }

    _renderAdminOrdenadorLicenciaModalRow(lic, index) {
        const l = lic || {};
        const vencida = this._isLicenciaVencida(l.fecha_fin);
        return (
            '<div class="activos-config-row activos-ordenador-licencia-modal-row' + (vencida ? ' activos-ordenador-licencia-row--vencida' : '') + '" data-licencia-row="' + index + '">' +
            '<div class="admin-solicitud-field"><label>Nombre</label>' +
            '<input type="text" class="activos-ordenador-licencia-nombre" value="' + this._esc(l.nombre || '') + '" placeholder="Ej. Microsoft Excel"></div>' +
            '<div class="admin-solicitud-field"><label>Fecha fin</label>' +
            '<input type="date" class="activos-ordenador-licencia-fecha-fin" value="' + this._esc(l.fecha_fin || '') + '"></div>' +
            '<button type="button" class="btn btn-secondary btn-sm activos-config-row-remove" data-remove-licencia>Quitar</button>' +
            '</div>'
        );
    }

    openAdminOrdenadorLicenciasModal() {
        const modal = document.getElementById('adminActivosOrdenadorLicenciasModal');
        const listEl = document.getElementById('adminActivosOrdenadorLicenciasList');
        if (!modal || !listEl) return;
        const draft = this._normalizeOrdenadorLicencias(this._ordenadorLicenciasDraft);
        this._ordenadorLicenciasModalDraft = draft.length ? draft.map(l => ({ ...l })) : [{ id: this._newLicenciaId(), nombre: '', fecha_fin: '' }];
        this._renderAdminOrdenadorLicenciasModalList();
        modal.style.display = '';
    }

    closeAdminOrdenadorLicenciasModal() {
        const modal = document.getElementById('adminActivosOrdenadorLicenciasModal');
        if (modal) modal.style.display = 'none';
    }

    _renderAdminOrdenadorLicenciasModalList() {
        const listEl = document.getElementById('adminActivosOrdenadorLicenciasList');
        if (!listEl) return;
        const rows = (this._ordenadorLicenciasModalDraft || []).map((l, i) => this._renderAdminOrdenadorLicenciaModalRow(l, i)).join('');
        listEl.innerHTML = rows;
        listEl.querySelectorAll('[data-remove-licencia]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('[data-licencia-row]');
                const idx = parseInt(row.getAttribute('data-licencia-row'), 10);
                this._syncOrdenadorLicenciasModalFromDom();
                if (this._ordenadorLicenciasModalDraft.length > 1) {
                    this._ordenadorLicenciasModalDraft.splice(idx, 1);
                } else {
                    this._ordenadorLicenciasModalDraft[0] = { id: this._newLicenciaId(), nombre: '', fecha_fin: '' };
                }
                this._renderAdminOrdenadorLicenciasModalList();
            });
        });
        listEl.querySelectorAll('.activos-ordenador-licencia-fecha-fin').forEach(input => {
            input.addEventListener('change', () => {
                const row = input.closest('.activos-ordenador-licencia-modal-row');
                if (row) row.classList.toggle('activos-ordenador-licencia-row--vencida', this._isLicenciaVencida(input.value));
            });
        });
    }

    _syncOrdenadorLicenciasModalFromDom() {
        const listEl = document.getElementById('adminActivosOrdenadorLicenciasList');
        if (!listEl) return;
        const prev = this._ordenadorLicenciasModalDraft || [];
        const next = [];
        listEl.querySelectorAll('[data-licencia-row]').forEach((row, i) => {
            const old = prev[i] || {};
            const id = old.id || this._newLicenciaId();
            const nombre = (row.querySelector('.activos-ordenador-licencia-nombre')?.value || '').trim();
            const fechaFin = row.querySelector('.activos-ordenador-licencia-fecha-fin')?.value || '';
            next.push({ id, nombre, fecha_fin: fechaFin });
        });
        this._ordenadorLicenciasModalDraft = next;
    }

    addAdminOrdenadorLicenciaRow() {
        this._syncOrdenadorLicenciasModalFromDom();
        this._ordenadorLicenciasModalDraft.push({ id: this._newLicenciaId(), nombre: '', fecha_fin: '' });
        this._renderAdminOrdenadorLicenciasModalList();
    }

    saveAdminOrdenadorLicenciasModal() {
        this._syncOrdenadorLicenciasModalFromDom();
        this._ordenadorLicenciasDraft = this._ordenadorLicenciasModalDraft
            .filter(l => l.nombre || l.fecha_fin)
            .map(l => ({
                id: l.id || this._newLicenciaId(),
                nombre: l.nombre || '',
                fecha_fin: l.fecha_fin || ''
            }));
        this._renderOrdenadorLicenciasFormSummary();
        this.closeAdminOrdenadorLicenciasModal();
    }

    _bindOrdenadorFormExtras() {
        const licBtn = document.getElementById('activoFormLicenciasBtn');
        if (licBtn && licBtn.dataset.bound !== '1') {
            licBtn.dataset.bound = '1';
            licBtn.addEventListener('click', () => this.openAdminOrdenadorLicenciasModal());
        }
    }

    _renderWorkerOrdenadorMetaChip(label, value, opts) {
        const options = opts || {};
        if (value == null || value === '') return '';
        let valueHtml;
        if (options.pdfLink) {
            valueHtml = '<a class="activos-worker-ordenador-chip-link" href="' + this._esc(options.pdfLink) + '" target="_blank" rel="noopener">' + this._esc(value) + '</a>';
        } else {
            valueHtml = '<span class="activos-worker-ordenador-chip-value">' + this._esc(value) + '</span>';
        }
        return (
            '<div class="activos-worker-ordenador-chip' + (options.pdfLink ? ' activos-worker-ordenador-chip--action' : '') + '">' +
            '<span class="activos-worker-ordenador-chip-label">' + this._esc(label) + '</span>' +
            valueHtml +
            '</div>'
        );
    }

    _renderWorkerOrdenadorDetail(activo, cfg, registros) {
        const datos = activo.datos || {};
        const badgeHtml = this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(activo, null, true),
            extraClass: 'activos-activo-band-badge activos-worker-ordenador-badge'
        });

        let metaHtml = '';
        if (datos.fecha_compra) {
            metaHtml += this._renderWorkerOrdenadorMetaChip('Fecha de compra', this._formatFechaDdMmAa(datos.fecha_compra));
        }
        if (datos.factura_url) {
            metaHtml += this._renderWorkerOrdenadorMetaChip('Factura', datos.factura_nombre || 'Ver PDF', { pdfLink: datos.factura_url });
        }
        if (activo.almacen) {
            metaHtml += this._renderWorkerOrdenadorMetaChip('Almacen', activo.almacen);
        }
        if (datos.sistema_operativo) {
            metaHtml += this._renderWorkerOrdenadorMetaChip('Sistema operativo', datos.sistema_operativo);
        }

        const licencias = Array.isArray(datos.licencias) ? datos.licencias.filter(l => l && (l.nombre || l.fecha_fin)) : [];
        const licenciasPanel = this._renderOrdenadorLicenciasCollapsible(licencias, { variant: 'worker' });
        const techPanel = this._renderOrdenadorDetalleTecnicoCollapsible(activo, cfg, datos, { variant: 'worker' });

        return (
            '<div class="activos-worker-ordenador-detail">' +
            '<div class="activos-worker-ordenador-card">' +
            '<div class="activos-worker-ordenador-hero">' +
            '<span class="activos-worker-ordenador-hero-icon" aria-hidden="true">💻</span>' +
            '<div class="activos-worker-ordenador-hero-body">' +
            '<div class="activos-worker-ordenador-card-head">' +
            '<h3 class="activos-worker-ordenador-title">' + this._esc(activo.nombre) + '</h3>' +
            badgeHtml +
            '</div>' +
            (datos.modelo ? '<p class="activos-worker-ordenador-modelo">' + this._esc(datos.modelo) + '</p>' : '') +
            (activo.identificador
                ? '<p class="activos-worker-ordenador-serie"><span class="activos-worker-ordenador-serie-label">' +
                this._esc(cfg ? cfg.identificadorLabel : 'Numero de serie') + '</span> ' +
                this._esc(activo.identificador) + '</p>'
                : '') +
            '</div></div>' +
            (metaHtml ? '<div class="activos-worker-ordenador-meta">' + metaHtml + '</div>' : '') +
            '</div>' +
            licenciasPanel +
            techPanel +
            this._renderEventoHistorialTable(registros, null, cfg, { variant: 'worker' }) +
            '</div>'
        );
    }

    _renderActivoDetailReadonlyField(label, value, opts) {
        const options = opts || {};
        if (value == null || value === '') return '';
        let valueHtml;
        if (options.estadoBadge) {
            valueHtml = this._renderDisponibilidadBadgeHtml(null, {
                badgeSource: options.badgeSource || { estado: value, asignado_nombre: options.asignadoNombre || null }
            });
        } else if (options.telLink) {
            const tel = String(value).replace(/\s/g, '');
            valueHtml = '<a class="activos-activo-detail-tel" href="tel:' + this._esc(tel) + '">' + this._esc(value) + '</a>';
        } else if (options.pdfLink) {
            valueHtml = '<a class="activos-ordenador-factura-link" href="' + this._esc(options.pdfLink) + '" target="_blank" rel="noopener">' + this._esc(value) + '</a>';
        } else {
            valueHtml = this._esc(value);
        }
        return (
            '<div class="activos-activo-detail-field">' +
            '<span class="activos-activo-detail-label">' + this._esc(label) + '</span>' +
            '<div class="activos-activo-detail-value">' + valueHtml + '</div>' +
            '</div>'
        );
    }

    _formatTelefonoAsignadoText(asignacion) {
        if (asignacion && asignacion.asignado_nombre) {
            return asignacion.asignado_nombre + (asignacion.asignado_codigo ? ' (' + asignacion.asignado_codigo + ')' : '');
        }
        return 'Sin asignar';
    }

    _renderImpresoraVisual(activo, opts) {
        const options = opts || {};
        const datos = (activo && activo.datos) || {};
        const modelo = datos.modelo || (activo && activo.nombre) || 'Impresora';
        const ubicacion = datos.localizacion || '';
        const variant = options.variant || 'ficha';
        const badgeHtml = this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(activo, options.asignacion, options.workerView)
        });
        return (
            '<div class="activos-impresora-visual activos-impresora-visual--' + variant + '">' +
            badgeHtml +
            '<div class="activos-impresora-device" aria-hidden="true">' +
            '<span class="activos-impresora-device-icon">🖨️</span>' +
            '<span class="activos-impresora-device-modelo">' + this._esc(modelo) + '</span>' +
            (ubicacion ? '<span class="activos-impresora-device-ubicacion">' + this._esc(ubicacion) + '</span>' : '') +
            '</div></div>'
        );
    }

    _buildImpresoraFormFieldsHtml(activo, cfg, datos, almacenes) {
        const d = datos || {};
        let html = '';

        html += '<div class="activos-ordenador-form-section">';
        html += '<h4 class="admin-detail-completar-title">Datos generales</h4>';
        html += '<div class="admin-solicitud-fields activos-ordenador-form-general">';
        html += '<div class="admin-solicitud-field"><label for="activoFormNombre">Nombre</label>';
        html += '<input type="text" id="activoFormNombre" required value="' + this._esc(activo ? activo.nombre : '') + '"></div>';
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
        (cfg.adminFields || []).forEach(f => {
            const val = d[f.key] != null ? d[f.key] : '';
            html += '<div class="admin-solicitud-field"><label for="activoForm_' + f.key + '">' + this._esc(f.label) + '</label>';
            html += '<input type="' + (f.type || 'text') + '" id="activoForm_' + f.key + '" value="' + this._esc(val) + '"' + (f.required ? ' required' : '') + '>';
            html += '</div>';
        });
        html += '<div class="admin-solicitud-field"><label for="activoFormEstado">Estado</label>';
        html += '<select id="activoFormEstado">';
        ['activo', 'inactivo', 'mantenimiento', 'averia'].forEach(st => {
            const sel = activo && activo.estado === st ? ' selected' : (!activo && st === 'activo' ? ' selected' : '');
            html += '<option value="' + st + '"' + sel + '>' + st + '</option>';
        });
        html += '</select></div>';
        html += '</div></div>';

        html += '<div class="activos-ordenador-form-section activos-ordenador-compra-section">';
        html += '<h4 class="admin-detail-completar-title">Compra de la impresora</h4>';
        html += '<div class="admin-solicitud-fields">';
        html += '<div class="admin-solicitud-field"><label for="activoFormImpresoraFechaCompra">Fecha de compra</label>';
        html += '<input type="date" id="activoFormImpresoraFechaCompra" value="' + this._esc(d.fecha_compra || '') + '"></div>';
        html += this._renderImpresoraFacturaField(d);
        html += '</div></div>';

        return html;
    }

    _buildTelefonoFormFieldsHtml(activo, cfg, datos, almacenes, opts) {
        const options = opts || {};
        const modeloField = (cfg.adminFields || []).find(f => f.key === 'modelo');
        const operadorField = (cfg.adminFields || []).find(f => f.key === 'operador');
        const lineaField = (cfg.adminFields || []).find(f => f.key === 'numero_linea');
        let html = '';

        html += '<div class="admin-solicitud-field"><label for="activoFormNombre">Nombre</label>';
        html += '<input type="text" id="activoFormNombre" required value="' + this._esc(activo ? activo.nombre : '') + '"></div>';
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
        html += '<div class="admin-solicitud-field"><label for="activoFormIdentificador">' + this._esc(cfg.identificadorLabel) + '</label>';
        html += '<input type="text" id="activoFormIdentificador" value="' + this._esc(activo ? activo.identificador : '') + '"></div>';
        if (modeloField) {
            html += this._renderVehiculoFormField(modeloField, datos);
        }
        html += '<div class="admin-solicitud-field"><label for="activoFormEstado">Estado</label>';
        html += '<select id="activoFormEstado">';
        ['activo', 'inactivo', 'mantenimiento', 'averia'].forEach(st => {
            const sel = activo && activo.estado === st ? ' selected' : (!activo && st === 'activo' ? ' selected' : '');
            html += '<option value="' + st + '"' + sel + '>' + st + '</option>';
        });
        html += '</select></div>';
        if (options.showAsignacion) {
            html += this._renderVehiculoFormAsignacionInline(options.asignacion, options.trabajadores);
        }
        if (operadorField) {
            html += this._renderVehiculoFormField(operadorField, datos);
        }
        if (lineaField) {
            html += this._renderVehiculoFormField(lineaField, datos);
        }

        return html;
    }

    _buildTelefonoDetailFieldsHtml(activo, cfg, asignacion) {
        const datos = activo.datos || {};
        const modeloField = (cfg.adminFields || []).find(f => f.key === 'modelo');
        const operadorField = (cfg.adminFields || []).find(f => f.key === 'operador');
        const lineaField = (cfg.adminFields || []).find(f => f.key === 'numero_linea');
        let html = '';

        html += this._renderActivoDetailReadonlyField('Nombre', activo.nombre);
        html += this._renderActivoDetailReadonlyField('Almacen', activo.almacen);
        html += this._renderActivoDetailReadonlyField(cfg.identificadorLabel, activo.identificador);
        if (modeloField) {
            html += this._renderActivoDetailReadonlyField(modeloField.label, datos.modelo);
        }
        html += this._renderActivoDetailReadonlyField('Estado', activo.estado, {
            estadoBadge: true,
            badgeSource: this._badgeSourceFromActivo(activo, asignacion, false)
        });
        if (operadorField) {
            html += this._renderActivoDetailReadonlyField(operadorField.label, datos.operador);
        }
        if (lineaField) {
            html += this._renderActivoDetailReadonlyField(lineaField.label, datos.numero_linea, { telLink: true });
        }

        return html;
    }

    _renderWorkerImpresoraDetail(activo, cfg, registros) {
        const datos = activo.datos || {};
        let fieldsHtml = '';
        if (datos.modelo) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Modelo', datos.modelo);
        }
        if (activo.almacen) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Almacen', activo.almacen);
        }
        if (datos.localizacion) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Localizacion', datos.localizacion);
        }
        if (datos.tipo_tinta) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Tipo tinta', datos.tipo_tinta);
        }
        if (datos.fecha_compra) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Fecha de compra', this._formatFechaDdMmAa(datos.fecha_compra));
        }
        if (datos.factura_url) {
            fieldsHtml += this._renderActivoDetailReadonlyField('Factura', datos.factura_nombre || 'Ver PDF', { pdfLink: datos.factura_url });
        }

        return (
            '<div class="activos-worker-telefono-detail activos-worker-impresora-detail">' +
            '<div class="activos-worker-telefono-card">' +
            '<div class="activos-worker-telefono-card-head">' +
            '<h3 class="activos-worker-telefono-title">' + this._esc(activo.nombre) + '</h3>' +
            this._renderDisponibilidadBadgeHtml(null, {
                badgeSource: this._badgeSourceFromActivo(activo, null, true),
                extraClass: 'activos-activo-band-badge'
            }) +
            '</div>' +
            '<div class="activos-worker-telefono-fields">' + fieldsHtml + '</div>' +
            '</div>' +
            this._renderEventoHistorialTable(registros, null, cfg, { variant: 'worker' }) +
            '</div>'
        );
    }

    _renderImpresoraDetailCard(activo, asignacion, cfg) {
        const datos = activo.datos || {};
        let fieldsHtml = '';
        fieldsHtml += this._renderActivoDetailReadonlyField('Nombre', activo.nombre);
        fieldsHtml += this._renderActivoDetailReadonlyField('Almacen', activo.almacen);
        fieldsHtml += this._renderActivoDetailReadonlyField('Modelo', datos.modelo);
        fieldsHtml += this._renderActivoDetailReadonlyField('Localizacion', datos.localizacion);
        fieldsHtml += this._renderActivoDetailReadonlyField('Tipo tinta', datos.tipo_tinta);

        return (
            '<div class="activos-impresora-detail-card">' +
            '<div class="activos-impresora-detail-head">' +
            '<h3 class="activos-impresora-detail-title">' + this._esc(activo.nombre) + '</h3>' +
            this._renderDisponibilidadBadgeHtml(null, {
                badgeSource: this._badgeSourceFromActivo(activo, asignacion, false),
                extraClass: 'activos-activo-band-badge'
            }) +
            '</div>' +
            '<div class="activos-telefono-form-fields">' + fieldsHtml + '</div>' +
            '</div>'
        );
    }

    _renderTelefonoDetailCard(activo, asignacion, cfg) {
        return (
            '<div class="activos-telefono-form-card">' +
            '<div class="activos-telefono-form-media">' + this._renderTelefonoVisual(activo, { variant: 'detail', asignacion }) + '</div>' +
            '<div class="activos-telefono-form-fields">' + this._buildTelefonoDetailFieldsHtml(activo, cfg, asignacion) + '</div>' +
            '</div>'
        );
    }

    _configureAdminFormEventoBlock(cfg, categoria) {
        let blockId;
        let tipoId;
        let showContador = false;
        if (categoria === 'ordenador') {
            blockId = 'adminActivoFormOrdenadorEventoBlock';
            tipoId = 'activoFormOrdenadorEventoTipo';
        } else if (categoria === 'impresora') {
            blockId = 'adminActivoFormImpresoraEventoBlock';
            tipoId = 'activoFormImpresoraEventoTipo';
        } else {
            blockId = 'adminActivoFormEventoBlock';
            tipoId = 'activoFormEventoTipo';
        }
        const block = document.getElementById(blockId);
        const tipoSel = document.getElementById(tipoId);
        const contadorField = block?.querySelector('.activos-evento-contador-field');
        if (!block || !tipoSel || !cfg || !cfg.eventoLabels) return;
        const eventoKeys = Object.keys(cfg.eventoLabels).filter(k => !(categoria === 'impresora' && k === 'compteur'));
        tipoSel.innerHTML = eventoKeys.map(k =>
            '<option value="' + k + '">' + this._esc(cfg.eventoLabels[k]) + '</option>'
        ).join('');
        if (contadorField) {
            contadorField.style.display = showContador ? '' : 'none';
        }
    }

    _getAdminEventoFormElements() {
        if (this._adminCategoria === 'ordenador') {
            return {
                tipo: document.getElementById('activoFormOrdenadorEventoTipo'),
                descripcion: document.getElementById('activoFormOrdenadorEventoDesc'),
                contador: document.getElementById('activoFormOrdenadorEventoContador')
            };
        }
        if (this._adminCategoria === 'impresora') {
            return {
                tipo: document.getElementById('activoFormImpresoraEventoTipo'),
                descripcion: document.getElementById('activoFormImpresoraEventoDesc'),
                contador: null
            };
        }
        if (this._adminCategoria === 'telefono') {
            return {
                tipo: document.getElementById('activoFormEventoTipo'),
                descripcion: document.getElementById('activoFormEventoDesc'),
                contador: document.getElementById('activoFormEventoContador')
            };
        }
        return {
            tipo: document.getElementById('adminActivoEventoTipo'),
            descripcion: document.getElementById('adminActivoEventoDesc'),
            contador: document.getElementById('adminActivoEventoContador')
        };
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
        const telefonoExtraEl = document.getElementById('adminActivoFormTelefonoExtra');
        const telefonoHistorialEl = document.getElementById('adminActivoFormTelefonoHistorial');
        const ordenadorExtraEl = document.getElementById('adminActivoFormOrdenadorExtra');
        const ordenadorHistorialEl = document.getElementById('adminActivoFormOrdenadorHistorial');
        const impresoraExtraEl = document.getElementById('adminActivoFormImpresoraExtra');
        const impresoraHistorialEl = document.getElementById('adminActivoFormImpresoraHistorial');
        this._ordenadorLicenciasDraft = [];
        this._ordenadorFacturaPending = '';
        this._ordenadorFacturaNombrePending = '';
        this._impresoraFacturaPending = '';
        this._impresoraFacturaNombrePending = '';
        if (fieldsEl) fieldsEl.innerHTML = '<p>Cargando formulario...</p>';
        if (extraEl) {
            extraEl.innerHTML = '';
            extraEl.style.display = 'none';
        }
        if (telefonoExtraEl) {
            telefonoExtraEl.style.display = 'none';
        }
        if (telefonoHistorialEl) {
            telefonoHistorialEl.innerHTML = '';
        }
        if (ordenadorExtraEl) {
            ordenadorExtraEl.style.display = 'none';
        }
        if (ordenadorHistorialEl) {
            ordenadorHistorialEl.innerHTML = '';
        }
        if (impresoraExtraEl) {
            impresoraExtraEl.style.display = 'none';
        }
        if (impresoraHistorialEl) {
            impresoraHistorialEl.innerHTML = '';
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
            } else if (activoId && categoria === 'telefono') {
                titleEl.textContent = 'Editar telefono';
            } else if (!activoId && categoria === 'telefono') {
                titleEl.textContent = 'Nuevo telefono';
            } else if (activoId && categoria === 'ordenador') {
                titleEl.textContent = 'Editar ordenador';
            } else if (!activoId && categoria === 'ordenador') {
                titleEl.textContent = 'Nuevo ordenador';
            } else if (activoId && categoria === 'impresora') {
                titleEl.textContent = 'Editar impresora';
            } else if (!activoId && categoria === 'impresora') {
                titleEl.textContent = 'Nueva impresora';
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
        if ((categoria === 'vehiculo' || categoria === 'telefono' || categoria === 'ordenador') && activoId) {
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
        } else if (categoria === 'telefono') {
            const fieldsHtml = this._buildTelefonoFormFieldsHtml(activo, cfg, datos, almacenes, {
                showAsignacion: !!activoId,
                asignacion,
                trabajadores
            });
            html +=
                '<div class="activos-telefono-form-card">' +
                '<div class="activos-telefono-form-media">' + this._renderTelefonoVisual(activo || { nombre: '', estado: 'activo', datos: {} }, { variant: 'form', asignacion }) + '</div>' +
                '<div class="activos-telefono-form-fields">' + fieldsHtml + '</div>' +
                '</div>';
        } else if (categoria === 'ordenador') {
            this._ordenadorLicenciasDraft = this._normalizeOrdenadorLicencias(datos.licencias);
            this._ordenadorFacturaPending = '';
            this._ordenadorFacturaNombrePending = datos.factura_nombre || '';
            const fieldsHtml = this._buildOrdenadorFormFieldsHtml(activo, cfg, datos, almacenes, {
                showAsignacion: !!activoId,
                asignacion,
                trabajadores
            });
            html +=
                '<div class="activos-ordenador-form-card">' +
                '<div class="activos-ordenador-form-fields">' + fieldsHtml + '</div>' +
                '</div>';
        } else if (categoria === 'impresora') {
            this._impresoraFacturaPending = '';
            this._impresoraFacturaNombrePending = datos.factura_nombre || '';
            const fieldsHtml = this._buildImpresoraFormFieldsHtml(activo, cfg, datos, almacenes);
            html +=
                '<div class="activos-ordenador-form-card">' +
                '<div class="activos-ordenador-form-fields">' + fieldsHtml + '</div>' +
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
            fieldsEl.classList.remove('activos-telefono-form-wrap', 'activos-ordenador-form-wrap', 'activos-impresora-form-wrap');
            this._bindVehiculoImagenForm();
        } else if (categoria === 'telefono') {
            fieldsEl.classList.add('activos-telefono-form-wrap');
            fieldsEl.classList.remove('activos-vehiculo-form-wrap', 'activos-ordenador-form-wrap', 'activos-impresora-form-wrap');
        } else if (categoria === 'ordenador') {
            fieldsEl.classList.add('activos-ordenador-form-wrap');
            fieldsEl.classList.remove('activos-vehiculo-form-wrap', 'activos-telefono-form-wrap', 'activos-impresora-form-wrap');
            this._bindOrdenadorFacturaForm(datos);
            this._renderOrdenadorLicenciasFormSummary();
            this._bindOrdenadorFormExtras();
        } else if (categoria === 'impresora') {
            fieldsEl.classList.add('activos-impresora-form-wrap');
            fieldsEl.classList.remove('activos-vehiculo-form-wrap', 'activos-telefono-form-wrap', 'activos-ordenador-form-wrap');
            this._bindImpresoraFacturaForm(datos);
        } else {
            fieldsEl.classList.remove('activos-vehiculo-form-wrap', 'activos-telefono-form-wrap', 'activos-ordenador-form-wrap', 'activos-impresora-form-wrap');
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

        if (telefonoExtraEl) {
            if (categoria === 'telefono' && activoId) {
                const registros = await window.supabaseClient.getActivoRegistros(activoId, 30);
                if (telefonoHistorialEl) {
                    telefonoHistorialEl.innerHTML = this._renderEventoHistorialTable(registros, trabajadores, cfg, {
                        variant: 'admin',
                        searchInputId: 'activoFormTelefonoHistorialSearch',
                        tbodyId: 'activoFormTelefonoHistorialTbody',
                        panelId: 'activoFormTelefonoHistorialPanel'
                    });
                }
                telefonoExtraEl.style.display = 'block';
                this._configureAdminFormEventoBlock(cfg, categoria);
                this._bindAdminHistorialSearch('activoFormTelefonoHistorialSearch', 'activoFormTelefonoHistorialTbody');
            } else {
                telefonoExtraEl.style.display = 'none';
            }
        }
        if (ordenadorExtraEl) {
            if (categoria === 'ordenador') {
                if (activoId) {
                    const registros = await window.supabaseClient.getActivoRegistros(activoId, 30);
                    if (ordenadorHistorialEl) {
                        ordenadorHistorialEl.innerHTML = this._renderEventoHistorialTable(registros, trabajadores, cfg, {
                            variant: 'admin',
                            searchInputId: 'activoFormOrdenadorHistorialSearch',
                            tbodyId: 'activoFormOrdenadorHistorialTbody',
                            panelId: 'activoFormOrdenadorHistorialPanel'
                        });
                    }
                    this._configureAdminFormEventoBlock(cfg, categoria);
                    this._bindAdminHistorialSearch('activoFormOrdenadorHistorialSearch', 'activoFormOrdenadorHistorialTbody');
                } else if (ordenadorHistorialEl) {
                    ordenadorHistorialEl.innerHTML = '';
                }
                const ordenadorEventoBlock = document.getElementById('adminActivoFormOrdenadorEventoBlock');
                if (ordenadorEventoBlock) {
                    ordenadorEventoBlock.style.display = activoId ? '' : 'none';
                }
                ordenadorExtraEl.style.display = 'block';
            } else {
                ordenadorExtraEl.style.display = 'none';
            }
        }
        if (impresoraExtraEl) {
            if (categoria === 'impresora') {
                if (activoId) {
                    const registros = await window.supabaseClient.getActivoRegistros(activoId, 30);
                    if (impresoraHistorialEl) {
                        impresoraHistorialEl.innerHTML = this._renderEventoHistorialTable(registros, trabajadores, cfg, {
                            variant: 'admin',
                            searchInputId: 'activoFormImpresoraHistorialSearch',
                            tbodyId: 'activoFormImpresoraHistorialTbody',
                            panelId: 'activoFormImpresoraHistorialPanel'
                        });
                    }
                    this._configureAdminFormEventoBlock(cfg, categoria);
                    this._bindAdminHistorialSearch('activoFormImpresoraHistorialSearch', 'activoFormImpresoraHistorialTbody');
                } else if (impresoraHistorialEl) {
                    impresoraHistorialEl.innerHTML = '';
                }
                const impresoraEventoBlock = document.getElementById('adminActivoFormImpresoraEventoBlock');
                if (impresoraEventoBlock) {
                    impresoraEventoBlock.style.display = activoId ? '' : 'none';
                }
                impresoraExtraEl.style.display = 'block';
            } else {
                impresoraExtraEl.style.display = 'none';
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

        const identificador = categoria === 'impresora'
            ? null
            : ((document.getElementById('activoFormIdentificador')?.value || '').trim() || null);
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
        if (categoria === 'ordenador') {
            (cfg.techFields || []).forEach(f => {
                const el = document.getElementById('activoForm_' + f.key);
                if (!el) return;
                let v = el.value;
                if (f.type === 'number' && v !== '') {
                    v = parseInt(v, 10);
                    if (!Number.isFinite(v)) v = 0;
                }
                if (v !== '' && v != null) datos[f.key] = v;
            });
            const fechaCompra = (document.getElementById('activoFormOrdenadorFechaCompra')?.value || '').trim();
            if (fechaCompra) datos.fecha_compra = fechaCompra;
            else delete datos.fecha_compra;
            const factura = this._readOrdenadorFacturaFromForm();
            if (factura && factura.url) {
                datos.factura_url = factura.url;
                datos.factura_nombre = factura.nombre;
            } else {
                delete datos.factura_url;
                delete datos.factura_nombre;
            }
            datos.licencias = (this._ordenadorLicenciasDraft || [])
                .filter(l => l.nombre || l.fecha_fin)
                .map(l => ({
                    id: l.id || this._newLicenciaId(),
                    nombre: l.nombre || null,
                    fecha_fin: l.fecha_fin || null
                }));
        }
        if (categoria === 'impresora') {
            const fechaCompra = (document.getElementById('activoFormImpresoraFechaCompra')?.value || '').trim();
            if (fechaCompra) datos.fecha_compra = fechaCompra;
            else delete datos.fecha_compra;
            const factura = this._readImpresoraFacturaFromForm();
            if (factura && factura.url) {
                datos.factura_url = factura.url;
                datos.factura_nombre = factura.nombre;
            } else {
                delete datos.factura_url;
                delete datos.factura_nombre;
            }
            delete datos.contador_paginas;
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

        const id = this._adminActivoId || result.id;
        if ((categoria === 'vehiculo' || categoria === 'telefono' || categoria === 'ordenador') && id) {
            const assignResult = await this._syncVehiculoFormAsignacion(id);
            if (!assignResult.success) {
                window.ui.showToast(assignResult.message || 'Error al guardar asignacion', 'error');
                return;
            }
            this._trabajadoresCache = null;
        }

        window.ui.showToast('Activo guardado', 'success');
        if (categoria === 'vehiculo' || categoria === 'telefono' || categoria === 'ordenador' || categoria === 'impresora') {
            this.app.showScreenAdmin('activosList', categoria);
        } else {
            this.app.showScreenAdmin('activoDetail', id);
        }
    }

    async renderAdminDetail(activoId) {
        this._adminActivoId = activoId;
        const activoPreview = await window.supabaseClient.getActivoById(activoId);
        if (activoPreview && (activoPreview.categoria_codigo === 'telefono' || activoPreview.categoria_codigo === 'ordenador' || activoPreview.categoria_codigo === 'impresora')) {
            this.app.showScreenAdmin('activoForm', activoId);
            return;
        }

        const content = document.getElementById('adminActivoDetailContent');
        if (!content) return;
        content.innerHTML = '<p>Cargando...</p>';

        const activo = activoPreview;
        if (!activo) {
            content.innerHTML = '<p>Activo no encontrado.</p>';
            return;
        }

        this._adminCategoria = activo.categoria_codigo;
        const cfg = this.getCategoriaConfig(activo.categoria_codigo);
        const detailTitleEl = document.querySelector('#adminActivoDetailScreen .screen-header > h2');
        if (detailTitleEl) {
            detailTitleEl.textContent = activo.categoria_codigo === 'telefono' ? 'Detalle telefono' : 'Detalle activo';
        }
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
        } else if (activo.categoria_codigo === 'telefono') {
            html += this._renderTelefonoDetailCard(activo, asignacion, cfg);
        } else if (activo.categoria_codigo === 'impresora') {
            html += this._renderImpresoraDetailCard(activo, asignacion, cfg);
        } else {
            html += '<div class="activos-detail-block">';
            html += '<div class="activos-impresora-detail-head">';
            html += '<h3>' + this._esc(activo.nombre) + '</h3>';
            html += this._renderDisponibilidadBadgeHtml(null, {
                badgeSource: this._badgeSourceFromActivo(activo, asignacion, false),
                extraClass: 'activos-activo-band-badge'
            });
            html += '</div>';
            if (activo.identificador) html += '<p><strong>' + this._esc(cfg ? cfg.identificadorLabel : 'ID') + ':</strong> ' + this._esc(activo.identificador) + '</p>';
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
                const eventoKeys = Object.keys(cfg.eventoLabels).filter(k => !(activo.categoria_codigo === 'impresora' && k === 'compteur'));
                tipoSel.innerHTML = eventoKeys.map(k =>
                    '<option value="' + k + '">' + this._esc(cfg.eventoLabels[k]) + '</option>'
                ).join('');
            }
            const contadorField = eventoBlock.querySelector('.activos-evento-contador-field');
            if (contadorField) {
                contadorField.style.display = 'none';
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

    _formatEventoRegistroDetalle(r) {
        const d = r.datos || {};
        if (d.descripcion) return d.descripcion;
        if (d.contador_paginas != null) return 'Paginas: ' + d.contador_paginas;
        if (r.tipo === 'uso_vehiculo') {
            return this._formatRegistroDatos(r);
        }
        return '—';
    }

    _formatRegistroDatos(r, cfg) {
        const d = r.datos || {};
        if (r.tipo === 'uso_vehiculo') {
            return 'Km dia: ' + (d.km_dia != null ? d.km_dia : '-') + ', Km actual: ' + (d.km_actual != null ? d.km_actual : '-');
        }
        const parts = [];
        if (d.subtipo) {
            parts.push(this._resolveEventoSubtipoLabel(cfg, d.subtipo));
        }
        if (d.descripcion) parts.push(d.descripcion);
        if (parts.length) return parts.join(' — ');
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
        if (modal) modal.style.display = 'flex';
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

        const fields = this._getAdminEventoFormElements();
        const tipoEvento = fields.tipo?.value || 'maintenance';
        const descripcion = (fields.descripcion?.value || '').trim();
        const contador = fields.contador?.value;

        const datos = { subtipo: tipoEvento, descripcion: descripcion || null };

        const result = await window.supabaseClient.registrarActivoEvento(
            activoId,
            cfg.eventoTipo,
            datos
        );

        if (!result.success) {
            window.ui.showToast(result.message || 'Error al registrar evento', 'error');
            return;
        }

        window.ui.showToast('Evento registrado', 'success');
        if (fields.descripcion) fields.descripcion.value = '';
        if (fields.contador) fields.contador.value = '';
        if (cfg.codigo === 'telefono') {
            this.renderAdminForm('telefono', activoId);
        } else if (cfg.codigo === 'ordenador') {
            this.renderAdminForm('ordenador', activoId);
        } else if (cfg.codigo === 'impresora') {
            this.renderAdminForm('impresora', activoId);
        } else {
            this.renderAdminDetail(activoId);
        }
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

        const list = (await window.supabaseClient.getMisActivos()).filter(a => a.categoria_codigo !== 'impresora');
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
            } else if (cat === 'telefono') {
                byCat[cat].forEach(a => {
                    html += this._renderTelefonoBandItem(a, { worker: true });
                });
            } else if (cat === 'ordenador') {
                byCat[cat].forEach(a => {
                    html += this._renderOrdenadorBandItem(a, { worker: true });
                });
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
        listEl.querySelectorAll('.activos-telefono-band[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const activo = list.find(x => x.id === id);
                if (activo) {
                    this._workerActivo = activo;
                    this.app.showScreen('misActivoDetail');
                }
            });
        });
        listEl.querySelectorAll('.activos-ordenador-band[data-id], .activos-ordenador-band-open[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const activo = list.find(x => x.id === id);
                if (activo) {
                    this._workerActivo = activo;
                    this.app.showScreen('misActivoDetail');
                }
            });
        });
        listEl.querySelectorAll('.activos-impresora-band[data-id]').forEach(btn => {
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
            if (activo.categoria_codigo === 'vehiculo') {
                titleEl.textContent = 'Mi vehiculo';
            } else if (activo.categoria_codigo === 'telefono') {
                titleEl.textContent = 'Mi telefono';
            } else if (activo.categoria_codigo === 'ordenador') {
                titleEl.textContent = 'Mi ordenador';
            } else {
                titleEl.textContent = 'Detalle activo';
            }
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

        if (activo.categoria_codigo === 'telefono') {
            const registros = await window.supabaseClient.getActivoRegistros(activo.id, 15);
            content.innerHTML = this._renderWorkerTelefonoDetail(activo, cfg, registros);
            return;
        }

        if (activo.categoria_codigo === 'ordenador') {
            const registros = await window.supabaseClient.getActivoRegistros(activo.id, 15);
            content.innerHTML = this._renderWorkerOrdenadorDetail(activo, cfg, registros);
            return;
        }

        if (activo.categoria_codigo === 'impresora') {
            const registros = await window.supabaseClient.getActivoRegistros(activo.id, 15);
            content.innerHTML = this._renderWorkerImpresoraDetail(activo, cfg, registros);
            return;
        }

        let html = '<div class="activos-worker-activo-detail">';
        html += '<div class="activos-impresora-detail-head">';
        html += '<h3>' + this._esc(activo.nombre) + '</h3>';
        html += this._renderDisponibilidadBadgeHtml(null, {
            badgeSource: this._badgeSourceFromActivo(activo, null, true),
            extraClass: 'activos-activo-band-badge'
        });
        html += '</div>';
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
