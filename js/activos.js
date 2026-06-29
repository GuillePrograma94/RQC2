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
        document.getElementById('adminActivoGuardarBtn')?.addEventListener('click', () => {
            self.saveAdminActivoForm();
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
        if (!list || list.length === 0) {
            listEl.innerHTML = '<p>No hay activos en esta categoria.</p>';
            return;
        }

        listEl.innerHTML = list.map(a => {
            const asignado = a.asignado_nombre
                ? this._esc(a.asignado_nombre) + ' (' + this._esc(a.asignado_tipo || '') + ' - ' + this._esc(a.asignado_codigo || '') + ')'
                : 'Sin asignar';
            const almacenTxt = a.almacen ? 'Almacen: ' + this._esc(a.almacen) + ' | ' : '';
            const itv = categoria === 'vehiculo' && a.datos && a.datos.fecha_itv
                ? this._formatItvBadge(a.datos.fecha_itv)
                : '';
            return (
                '<button type="button" class="admin-list-item activos-list-item" data-id="' + this._esc(a.id) + '">' +
                '<strong>' + this._esc(a.nombre) + '</strong>' +
                (a.identificador ? ' <span class="activos-list-id">' + this._esc(a.identificador) + '</span>' : '') +
                '<br><span class="activos-list-meta">' + almacenTxt + 'Estado: ' + this._esc(a.estado) + ' | ' + asignado + '</span>' +
                itv +
                '</button>'
            );
        }).join('');

        listEl.querySelectorAll('[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                this.app.showScreenAdmin('activoDetail', id);
            });
        });
    }

    _formatItvBadge(fechaItv) {
        if (!fechaItv) return '';
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const itv = new Date(fechaItv + 'T00:00:00');
        if (isNaN(itv.getTime())) return '';
        const vencida = itv < hoy;
        const cls = vencida ? 'activos-badge-itv-vencida' : 'activos-badge-itv-ok';
        const txt = vencida ? 'ITV vencida' : 'ITV: ' + fechaItv;
        return '<br><span class="activos-badge ' + cls + '">' + this._esc(txt) + '</span>';
    }

    async renderAdminForm(categoria, activoId) {
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
            titleEl.textContent = activoId ? 'Editar activo' : 'Nuevo activo';
        }

        const fieldsEl = document.getElementById('adminActivoFormFields');
        if (!fieldsEl || !cfg) return;

        const datos = (activo && activo.datos) || {};
        const almacenes = await this._loadAlmacenes();
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

        fieldsEl.innerHTML = html;
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
        this.app.showScreenAdmin('activoDetail', id);
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

        let html = '<div class="activos-detail-block">';
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

        if (activo.categoria_codigo === 'vehiculo' && activo.datos && activo.datos.fecha_itv) {
            html += this._formatItvBadge(activo.datos.fecha_itv);
        }

        html += '<p><strong>Asignado a:</strong> ';
        if (asignacion && asignacion.asignado_nombre) {
            html += this._esc(asignacion.asignado_nombre) + ' (' + this._esc(asignacion.asignado_codigo || '') + ')';
        } else {
            html += 'Nadie';
        }
        html += '</p></div>';

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
            byCat[cat].forEach(a => {
                html += '<button type="button" class="btn btn-secondary activos-mis-item" data-id="' + this._esc(a.id) + '">';
                html += this._esc(a.nombre);
                if (a.identificador) html += ' <span class="activos-list-id">(' + this._esc(a.identificador) + ')</span>';
                if (a.almacen) html += '<br><span class="activos-list-meta">Almacen: ' + this._esc(a.almacen) + '</span>';
                html += '</button>';
            });
        });

        listEl.innerHTML = html;
        listEl.querySelectorAll('[data-id]').forEach(btn => {
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

    async renderWorkerDetail() {
        const activo = this._workerActivo;
        const content = document.getElementById('misActivoDetailContent');
        const usoBlock = document.getElementById('misActivoUsoVehiculoBlock');
        if (!content || !activo) return;

        const cfg = this.getCategoriaConfig(activo.categoria_codigo);
        let html = '<h3>' + this._esc(activo.nombre) + '</h3>';
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
        if (activo.categoria_codigo === 'vehiculo' && activo.datos && activo.datos.fecha_itv) {
            html += this._formatItvBadge(activo.datos.fecha_itv);
        }

        const registros = await window.supabaseClient.getActivoRegistros(activo.id, 10);
        if (registros && registros.length > 0) {
            html += '<div class="activos-registros-block"><h4>Mi historial</h4><ul class="activos-registros-list">';
            registros.forEach(r => {
                html += '<li>' + this._esc(r.fecha) + ' - ' + this._esc(this._formatRegistroDatos(r)) + '</li>';
            });
            html += '</ul></div>';
        }

        content.innerHTML = html;

        if (usoBlock) {
            const showUso = activo.categoria_codigo === 'vehiculo' && cfg && cfg.trabajadorPuedeRegistrar;
            usoBlock.style.display = showUso ? '' : 'none';
            if (showUso) {
                const kmEl = document.getElementById('misActivoKmActual');
                if (kmEl && activo.datos && activo.datos.kilometraje_actual != null) {
                    kmEl.placeholder = 'Actual: ' + activo.datos.kilometraje_actual;
                }
            }
        }
    }

    async registerWorkerVehicleUsage() {
        const activo = this._workerActivo;
        if (!activo || activo.categoria_codigo !== 'vehiculo') return;

        const km = parseInt(document.getElementById('misActivoKmActual')?.value, 10);
        const litros = document.getElementById('misActivoLitros')?.value;
        const coste = document.getElementById('misActivoCoste')?.value;

        if (!Number.isFinite(km) || km < 0) {
            window.ui.showToast('Indica el kilometraje actual', 'error');
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
        activo.datos = activo.datos || {};
        activo.datos.kilometraje_actual = km;
        this._workerActivo = activo;
        document.getElementById('misActivoKmActual').value = '';
        document.getElementById('misActivoLitros').value = '';
        document.getElementById('misActivoCoste').value = '';
        this.renderWorkerDetail();
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
                this.renderAdminForm(null, p);
            } else {
                this.renderAdminForm(p, null);
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
