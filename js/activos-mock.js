/**
 * Base de datos factice (mock) + LOGIN DE DEMO para la funcion ACTIVOS.
 *
 * Objetivo: poder trabajar el diseno de las pantallas de activos en local
 * sin tocar Supabase ni necesitar credenciales reales.
 *
 * --- LOGINS DE DEMO ---
 *   Administracion (panel Activos) :
 *       Codigo : DEMO    Contrasena : DEMO
 *   Trabajador (tienda > Herramientas > Mis activos) :
 *       Codigo : USER    Contrasena : USER
 *
 *   Solo en local o con ?activosDemo=1 en la URL (?activosDemo=user para USER).
 *
 * --- Base de datos factice ---
 *   Se activa automaticamente con el login de demo. Tambien puedes activarla
 *   suelta con ?activosMock=1 (o localStorage.setItem('ACTIVOS_MOCK','1')).
 */
(function () {
    'use strict';

    const DEMO_CODE = 'DEMO';
    const DEMO_PASS = 'DEMO';
    const USER_CODE = 'USER';
    const USER_PASS = 'USER';
    const FAKE_LATENCY_MS = 120; // latencia simulada de "red"; 0 = instantaneo

    // ------------------------------------------------------------------
    // Deteccion de activacion
    // ------------------------------------------------------------------

    function param(name) {
        try { return new URLSearchParams(window.location.search || '').get(name); }
        catch (e) { return null; }
    }

    function isLocalEnv() {
        const h = (window.location.hostname || '').toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '' ||
            h.endsWith('.local') || window.location.protocol === 'file:';
    }

    function demoLoginEnabled() {
        const p = param('activosDemo');
        if (p === '1' || p === 'true' || p === '') return true;
        if (p === '0' || p === 'false') return false;
        try { if (localStorage.getItem('ACTIVOS_DEMO') === '1') return true; } catch (e) {}
        return isLocalEnv();
    }

    function mockEnabled() {
        const p = param('activosMock');
        if (p === '1' || p === 'true' || p === '') { try { localStorage.setItem('ACTIVOS_MOCK', '1'); } catch (e) {} return true; }
        if (p === '0' || p === 'false') { try { localStorage.setItem('ACTIVOS_MOCK', '0'); } catch (e) {} return false; }
        try {
            if (localStorage.getItem('ACTIVOS_MOCK') === '1') return true;
            if (localStorage.getItem('ACTIVOS_MOCK') === '0') return false;
        } catch (e) {}
        return false;
    }

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    function delay(value) {
        if (!FAKE_LATENCY_MS) return Promise.resolve(value);
        return new Promise(resolve => setTimeout(() => resolve(value), FAKE_LATENCY_MS));
    }

    function uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function hoy(offsetDias) {
        const d = new Date();
        if (offsetDias) d.setDate(d.getDate() + offsetDias);
        return d.toISOString().slice(0, 10);
    }

    // ------------------------------------------------------------------
    // Datos factices en memoria
    // ------------------------------------------------------------------

    const almacenes = [
        { almacen: 'CENTRAL', razon_social: 'Batmar Central S.L.', cif: 'B00000001' },
        { almacen: 'NORTE', razon_social: 'Batmar Norte S.L.', cif: 'B00000002' },
        { almacen: 'SUR', razon_social: 'Batmar Sur S.L.', cif: 'B00000003' }
    ];

    const activosVehiculoConfig = {
        seguro_contactos: [
            { nombre: 'Asistencia en carretera', telefono: '900 100 200' },
            { nombre: 'Gestor de siniestros', telefono: '962 800 900' },
            { nombre: 'Urgencias 24h', telefono: '900 300 400' }
        ],
        talleres_por_almacen: {
            CENTRAL: [
                {
                    nombre: 'Taller AutoBat Central',
                    telefono: '962 111 222',
                    direccion: 'Pol. Ind. Central, C/ Motor 12, Valencia'
                },
                {
                    nombre: 'Mecanica Rapida CV',
                    telefono: '962 111 333',
                    direccion: 'Av. del Puerto 8, Valencia'
                }
            ],
            NORTE: [
                {
                    nombre: 'Garage Norte Express',
                    telefono: '963 333 444',
                    direccion: 'Av. del Transporte 45, Castellon'
                }
            ],
            SUR: [
                {
                    nombre: 'Taller Sur Mecanica',
                    telefono: '965 555 666',
                    direccion: 'C/ Industria 8, Alicante'
                },
                {
                    nombre: 'AutoSur Reparaciones',
                    telefono: '965 555 777',
                    direccion: 'Pol. Elche Parque, Alicante'
                }
            ]
        }
    };

    const trabajadores = [
        { auth_uid: 'uid-ana', usuario_id: 101, comercial_id: null, nombre: 'Ana Garcia', tipo: 'DEPENDIENTE', codigo: 'DEP-01' },
        { auth_uid: 'uid-luis', usuario_id: null, comercial_id: 201, nombre: 'Luis Perez', tipo: 'COMERCIAL', codigo: 'COM-07' },
        { auth_uid: 'uid-marta', usuario_id: 102, comercial_id: null, nombre: 'Marta Ruiz', tipo: 'ADMINISTRADOR', codigo: 'ADM-02' },
        { auth_uid: 'uid-jose', usuario_id: null, comercial_id: 202, nombre: 'Jose Lopez', tipo: 'COMERCIAL', codigo: 'COM-12' }
    ];

    // Usuario "actual" para getMisActivos (vista trabajador). Cambialo para probar.
    const MI_AUTH_UID = 'uid-ana';

    const activos = [
        {
            id: uuid(), categoria_codigo: 'vehiculo', nombre: 'Furgoneta reparto 1',
            identificador: '1234 ABC', estado: 'activo', almacen: 'CENTRAL',
            datos: {
                modelo: 'Renault Kangoo', kilometraje_actual: 84500, fecha_itv: hoy(45),
                imagen_url: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=480&q=80&auto=format&fit=crop'
            }
        },
        {
            id: uuid(), categoria_codigo: 'vehiculo', nombre: 'Furgoneta reparto 2',
            identificador: '5678 DEF', estado: 'mantenimiento', almacen: 'NORTE',
            datos: {
                modelo: 'Citroen Berlingo', kilometraje_actual: 132000, fecha_itv: hoy(-10),
                imagen_url: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=480&q=80&auto=format&fit=crop'
            }
        },
        {
            id: uuid(), categoria_codigo: 'vehiculo', nombre: 'Coche comercial',
            identificador: '9012 GHI', estado: 'activo', almacen: 'SUR',
            datos: {
                modelo: 'Seat Leon', kilometraje_actual: 41000, fecha_itv: hoy(200),
                imagen_url: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=480&q=80&auto=format&fit=crop'
            }
        },
        {
            id: uuid(), categoria_codigo: 'impresora', nombre: 'Impresora oficina',
            identificador: null, estado: 'activo', almacen: 'CENTRAL',
            datos: {
                modelo: 'HP LaserJet Pro', localizacion: 'Recepcion', tipo_tinta: 'Toner negro',
                fecha_compra: '2023-05-12', factura_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
                factura_nombre: 'Factura HP LaserJet.pdf'
            }
        },
        {
            id: uuid(), categoria_codigo: 'impresora', nombre: 'Plotter almacen',
            identificador: null, estado: 'averia', almacen: 'NORTE',
            datos: { modelo: 'Epson SureColor', localizacion: 'Nave 2', tipo_tinta: 'Tinta color', fecha_compra: '2022-11-03' }
        },
        {
            id: uuid(), categoria_codigo: 'ordenador', nombre: 'PC administracion',
            identificador: 'SN-AB12-CD34', estado: 'activo', almacen: 'CENTRAL',
            datos: {
                modelo: 'Dell OptiPlex', procesador: 'Intel i5', ram_gb: 16, almacenamiento: '512 GB SSD',
                sistema_operativo: 'Windows 11 Pro', garantia_fecha_fin: '2026-06-01',
                fecha_compra: '2024-01-15', factura_url: null, factura_nombre: null,
                licencias: [
                    { id: 'lic-demo-excel', nombre: 'Microsoft Excel', fecha_fin: '2026-01-10' },
                    { id: 'lic-demo-office', nombre: 'Microsoft 365', fecha_fin: '2026-01-10' }
                ]
            }
        },
        {
            id: uuid(), categoria_codigo: 'ordenador', nombre: 'Portatil comercial',
            identificador: 'SN-EF56-GH78', estado: 'activo', almacen: 'SUR',
            datos: { modelo: 'Lenovo ThinkPad', procesador: 'Intel i7', ram_gb: 32, almacenamiento: '1 TB SSD' }
        },
        {
            id: uuid(), categoria_codigo: 'telefono', nombre: 'Movil comercial',
            identificador: '356938035643809', estado: 'activo', almacen: 'SUR',
            datos: { modelo: 'Samsung Galaxy A54', imei: '356938035643809', operador: 'Movistar', numero_linea: '600112233' }
        }
    ];

    const asignaciones = [
        { id: uuid(), activo_id: activos[0].id, auth_uid: 'uid-ana', usuario_id: 101, comercial_id: null, fecha_desde: hoy(-30), activa: true },
        { id: uuid(), activo_id: activos[2].id, auth_uid: 'uid-luis', usuario_id: null, comercial_id: 201, fecha_desde: hoy(-12), activa: true },
        { id: uuid(), activo_id: activos[5].id, auth_uid: 'uid-ana', usuario_id: 101, comercial_id: null, fecha_desde: hoy(-8), activa: true },
        { id: uuid(), activo_id: activos[6].id, auth_uid: 'uid-luis', usuario_id: null, comercial_id: 201, fecha_desde: hoy(-5), activa: true },
        { id: uuid(), activo_id: activos[7].id, auth_uid: 'uid-ana', usuario_id: 101, comercial_id: null, fecha_desde: hoy(-3), activa: true }
    ];

    const registros = [
        { id: uuid(), activo_id: activos[0].id, auth_uid: 'uid-ana', tipo: 'uso_vehiculo', datos: { km_inicio_dia: 84413, km_dia: 87, km_actual: 84500, km_anterior: 84413, litros: 42.5, coste: 63.75 }, fecha: hoy(0), created_at: new Date().toISOString() },
        { id: uuid(), activo_id: activos[0].id, auth_uid: 'uid-ana', tipo: 'uso_vehiculo', datos: { km_dia: 120, km_actual: 84413, litros: 35, coste: 52.4 }, fecha: hoy(-1), created_at: new Date().toISOString() },
        { id: uuid(), activo_id: activos[0].id, auth_uid: 'uid-luis', tipo: 'uso_vehiculo', datos: { km_dia: 95, km_actual: 84380, litros: 30, coste: 44.1 }, fecha: hoy(-2), created_at: new Date().toISOString() },
        { id: uuid(), activo_id: activos[3].id, auth_uid: 'uid-marta', tipo: 'evento_impresora', datos: { subtipo: 'toner', descripcion: 'Cambio de toner negro' }, fecha: hoy(-7), created_at: new Date().toISOString() },
        { id: uuid(), activo_id: activos[4].id, auth_uid: 'uid-jose', tipo: 'evento_impresora', datos: { subtipo: 'panne', descripcion: 'Atasco de papel recurrente' }, fecha: hoy(-4), created_at: new Date().toISOString() },
        { id: uuid(), activo_id: activos[5].id, auth_uid: 'uid-ana', tipo: 'evento_ordenador', datos: { subtipo: 'maintenance', descripcion: 'Actualizacion de seguridad Windows' }, fecha: hoy(-14), created_at: new Date().toISOString() },
        { id: uuid(), activo_id: activos[5].id, auth_uid: 'uid-ana', tipo: 'evento_ordenador', datos: { subtipo: 'mise_a_jour', descripcion: 'Instalacion Microsoft 365' }, fecha: hoy(-2), created_at: new Date().toISOString() }
    ];

    // ------------------------------------------------------------------
    // Helpers de datos
    // ------------------------------------------------------------------

    function nombreCategoria(codigo) {
        const cfg = (window.ACTIVOS_CATEGORIAS && window.ACTIVOS_CATEGORIAS[codigo]) || null;
        if (cfg) return cfg.nombre;
        const map = { vehiculo: 'Vehiculos', impresora: 'Impresoras', ordenador: 'Ordenadores', telefono: 'Telefonos' };
        return map[codigo] || codigo;
    }
    function asignacionDe(activoId) { return asignaciones.find(a => a.activo_id === activoId && a.activa) || null; }
    function trabajadorDe(authUid) { return trabajadores.find(t => t.auth_uid === authUid) || null; }

    // ------------------------------------------------------------------
    // Implementacion mock de los metodos de supabaseClient (activos)
    // ------------------------------------------------------------------

    const mock = {
        async getActivosConteosCategorias() {
            const codigos = Array.from(new Set(activos.map(a => a.categoria_codigo)));
            return delay(codigos.map(codigo => {
                const enCat = activos.filter(a => a.categoria_codigo === codigo);
                return { codigo, nombre: nombreCategoria(codigo), total: enCat.length, asignados: enCat.filter(a => !!asignacionDe(a.id)).length };
            }));
        },
        async getActivosTrabajadoresAsignables() { return delay(trabajadores.map(t => ({ ...t }))); },
        async getActivosPorCategoria(categoria) {
            return delay(activos.filter(a => a.categoria_codigo === categoria).map(a => {
                const asig = asignacionDe(a.id);
                const t = asig ? trabajadorDe(asig.auth_uid) : null;
                return {
                    id: a.id, nombre: a.nombre, identificador: a.identificador, estado: a.estado, almacen: a.almacen,
                    asignado_nombre: t ? t.nombre : null, asignado_tipo: t ? t.tipo : null, asignado_codigo: t ? t.codigo : null,
                    datos: a.datos
                };
            }));
        },
        async getMisActivos() {
            const misIds = asignaciones.filter(a => a.activa && a.auth_uid === MI_AUTH_UID).map(a => a.activo_id);
            return delay(activos.filter(a => misIds.indexOf(a.id) !== -1).map(a => ({
                id: a.id, categoria_codigo: a.categoria_codigo, nombre: a.nombre,
                identificador: a.identificador, estado: a.estado, almacen: a.almacen, datos: a.datos
            })));
        },
        async getActivoById(id) {
            const a = activos.find(x => x.id === id);
            return delay(a ? JSON.parse(JSON.stringify(a)) : null);
        },
        async createActivo(payload) {
            const nuevo = {
                id: uuid(), categoria_codigo: payload.categoria_codigo, nombre: payload.nombre,
                identificador: payload.identificador || null, estado: payload.estado || 'activo',
                almacen: payload.almacen || null, datos: payload.datos || {}
            };
            activos.push(nuevo);
            return delay({ success: true, id: nuevo.id });
        },
        async updateActivo(id, payload) {
            const a = activos.find(x => x.id === id);
            if (!a) return delay({ success: false, message: 'Activo no encontrado' });
            Object.assign(a, payload);
            return delay({ success: true, id });
        },
        async deleteActivo(id) {
            const idx = activos.findIndex(x => x.id === id);
            if (idx === -1) return delay({ success: false, message: 'Activo no encontrado' });
            activos.splice(idx, 1);
            for (let i = asignaciones.length - 1; i >= 0; i--) {
                if (asignaciones[i].activo_id === id) asignaciones.splice(i, 1);
            }
            for (let i = registros.length - 1; i >= 0; i--) {
                if (registros[i].activo_id === id) registros.splice(i, 1);
            }
            return delay({ success: true });
        },
        async patchActivoDatos(id, patch) {
            const a = activos.find(x => x.id === id);
            if (!a) return delay({ success: false, message: 'Activo no encontrado' });
            a.datos = Object.assign({}, a.datos || {}, patch);
            return delay({ success: true, id });
        },
        async getActivoAsignacionActiva(activoId) {
            const asig = asignacionDe(activoId);
            if (!asig) return delay(null);
            const t = trabajadorDe(asig.auth_uid);
            return delay({
                id: asig.id, auth_uid: asig.auth_uid, usuario_id: asig.usuario_id, comercial_id: asig.comercial_id,
                fecha_desde: asig.fecha_desde, asignado_nombre: t ? t.nombre : null, asignado_codigo: t ? t.codigo : null
            });
        },
        async asignarActivoTrabajador(activoId, authUid, usuarioId, comercialId) {
            asignaciones.forEach(a => { if (a.activo_id === activoId) a.activa = false; });
            asignaciones.push({ id: uuid(), activo_id: activoId, auth_uid: authUid, usuario_id: usuarioId || null, comercial_id: comercialId || null, fecha_desde: hoy(0), activa: true });
            return delay({ success: true });
        },
        async desasignarActivo(activoId) {
            asignaciones.forEach(a => { if (a.activo_id === activoId) a.activa = false; });
            return delay({ success: true });
        },
        async getActivoRegistros(activoId, limit) {
            return delay(registros.filter(r => r.activo_id === activoId)
                .sort((x, y) => (y.fecha || '').localeCompare(x.fecha || ''))
                .slice(0, limit || 20)
                .map(r => ({ id: r.id, tipo: r.tipo, datos: r.datos, fecha: r.fecha, created_at: r.created_at, auth_uid: r.auth_uid })));
        },
        async getActivoUsoVehiculoHoy(activoId) {
            const fechaHoy = hoy(0);
            const reg = registros.find(r =>
                r.activo_id === activoId && r.tipo === 'uso_vehiculo' && r.fecha === fechaHoy
            );
            if (!reg || !reg.datos) return delay(null);
            const d = reg.datos;
            return delay({
                km_dia: d.km_dia != null ? d.km_dia : null,
                km_actual: d.km_actual != null ? d.km_actual : null,
                km_inicio_dia: d.km_inicio_dia != null ? d.km_inicio_dia : (d.km_anterior != null ? d.km_anterior : null),
                litros: d.litros != null ? d.litros : null,
                coste: d.coste != null ? d.coste : null,
                fecha: reg.fecha
            });
        },
        async registrarUsoVehiculo(activoId, kmActual, litros, coste) {
            const a = activos.find(x => x.id === activoId);
            const kmStored = a && a.datos ? (a.datos.kilometraje_actual || 0) : 0;
            const fechaHoy = hoy(0);
            const existente = registros.find(r =>
                r.activo_id === activoId && r.tipo === 'uso_vehiculo' && r.fecha === fechaHoy
            );
            let kmInicioDia;
            if (existente && existente.datos) {
                const d = existente.datos;
                kmInicioDia = d.km_inicio_dia != null ? d.km_inicio_dia : (d.km_anterior != null ? d.km_anterior : kmStored);
                if (kmActual < kmStored) {
                    return delay({ success: false, message: 'El kilometraje no puede ser inferior al ultimo registrado hoy (' + kmStored + ')' });
                }
            } else {
                kmInicioDia = kmStored;
                if (kmActual < kmInicioDia) {
                    return delay({ success: false, message: 'El kilometraje no puede ser inferior al actual (' + kmInicioDia + ')' });
                }
            }
            const kmDia = Math.max(0, kmActual - kmInicioDia);
            const datosReg = {
                km_inicio_dia: kmInicioDia,
                km_dia: kmDia,
                km_actual: kmActual,
                km_anterior: kmInicioDia,
                litros,
                coste
            };
            if (existente) {
                existente.datos = datosReg;
                existente.auth_uid = MI_AUTH_UID;
                existente.created_at = new Date().toISOString();
            } else {
                registros.push({
                    id: uuid(),
                    activo_id: activoId,
                    auth_uid: MI_AUTH_UID,
                    tipo: 'uso_vehiculo',
                    datos: datosReg,
                    fecha: fechaHoy,
                    created_at: new Date().toISOString()
                });
            }
            if (a) { a.datos = a.datos || {}; a.datos.kilometraje_actual = kmActual; }
            return delay({ success: true });
        },
        async registrarActivoEvento(activoId, tipo, datos) {
            registros.push({ id: uuid(), activo_id: activoId, tipo, datos: datos || {}, fecha: hoy(0), created_at: new Date().toISOString() });
            return delay({ success: true, id: uuid() });
        }
    };

    // ------------------------------------------------------------------
    // Aplicar el mock sobre window.supabaseClient
    // ------------------------------------------------------------------

    let aplicado = false;
    function aplicarMock() {
        const c = window.supabaseClient;
        if (!c) return false;
        Object.keys(mock).forEach(k => { c[k] = mock[k].bind(c); });
        c.getEmpresasPorAlmacen = async function () {
            return delay(almacenes.map(a => ({ ...a })));
        };
        c.getActivosVehiculoConfig = async function () {
            return delay({
                seguro_contactos: activosVehiculoConfig.seguro_contactos.map(x => ({ ...x })),
                talleres_por_almacen: JSON.parse(JSON.stringify(activosVehiculoConfig.talleres_por_almacen || {}))
            });
        };
        c.saveActivosVehiculoConfig = async function (config) {
            if (!config || typeof config !== 'object') {
                return delay({ success: false, message: 'Config invalida' });
            }
            if (Array.isArray(config.seguro_contactos)) {
                activosVehiculoConfig.seguro_contactos = config.seguro_contactos.map(c => ({
                    nombre: c && c.nombre ? String(c.nombre).trim() : '',
                    telefono: c && c.telefono ? String(c.telefono).trim() : ''
                })).filter(c => c.nombre || c.telefono);
            }
            if (config.talleres_por_almacen && typeof config.talleres_por_almacen === 'object') {
                activosVehiculoConfig.talleres_por_almacen = {};
                Object.keys(config.talleres_por_almacen).forEach(cod => {
                    const list = config.talleres_por_almacen[cod];
                    if (!Array.isArray(list)) return;
                    activosVehiculoConfig.talleres_por_almacen[cod] = list.map(t => ({
                        nombre: t && t.nombre ? String(t.nombre).trim() : '',
                        telefono: t && t.telefono ? String(t.telefono).trim() : '',
                        direccion: t && t.direccion ? String(t.direccion).trim() : ''
                    })).filter(t => t.nombre || t.telefono || t.direccion);
                });
            }
            return delay({ success: true });
        };
        if (!aplicado) {
            aplicado = true;
            console.info('[activos-mock] Base de datos factice ACTIVA (' + activos.length + ' activos de ejemplo).');
        }
        return true;
    }

    // ------------------------------------------------------------------
    // Login de demo
    // ------------------------------------------------------------------

    function construirUsuarioDemo() {
        return {
            user_id: 101,
            user_name: 'Demo Administracion',
            codigo_usuario: DEMO_CODE,
            grupo_cliente: null,
            tarifa: null,
            codigo_usuario_titular: null,
            almacen_habitual: 'CENTRAL',
            is_operario: false,
            nombre_operario: null,
            nombre_titular: 'Demo Administracion',
            tipo: 'ADMINISTRACION',
            is_comercial: false,
            is_dependiente: false,
            is_administrador: false,
            is_administracion: true,
            almacen_tienda: null,
            comercial_id: null,
            comercial_numero: null
        };
    }

    function construirUsuarioDemoTrabajador() {
        return {
            user_id: 101,
            user_name: 'Ana Garcia (demo)',
            codigo_usuario: USER_CODE,
            grupo_cliente: null,
            tarifa: null,
            codigo_usuario_titular: null,
            almacen_habitual: 'CENTRAL',
            is_operario: false,
            nombre_operario: null,
            nombre_titular: 'Ana Garcia',
            tipo: 'DEPENDIENTE',
            is_comercial: false,
            is_dependiente: true,
            is_administrador: false,
            is_administracion: false,
            almacen_tienda: 'CENTRAL',
            comercial_id: null,
            comercial_numero: null
        };
    }

    async function entrarComoDemo(app) {
        aplicarMock();
        app.currentUser = construirUsuarioDemo();
        try { app.loadPricingPreferenceForUser && app.loadPricingPreferenceForUser(app.currentUser); } catch (e) {}
        try { app.loadIvaPreferenceForUser && app.loadIvaPreferenceForUser(app.currentUser); } catch (e) {}

        try { app.hideLanding && app.hideLanding(); } catch (e) {}
        try { app.hideLoginModal && app.hideLoginModal(); } catch (e) {}
        try { app.closeMenu && app.closeMenu(); } catch (e) {}
        try { app.updateUserUI && app.updateUserUI(); } catch (e) {}

        const tiendaEl = document.getElementById('appContainerTienda');
        const adminEl = document.getElementById('appContainerAdministracion');
        if (tiendaEl) tiendaEl.style.display = 'none';
        if (adminEl) adminEl.style.display = 'block';
        document.body.classList.remove('gate-visible');
        document.body.classList.add('admin-panel-visible');

        await app.initializeAppAdministracion();
        // Ir directamente a la seccion de Activos para iterar el diseno.
        try {
            await app.showScreenAdmin('activosHub');
            app.updateActiveNavAdmin('inicio');
        } catch (e) {}

        try { window.ui && window.ui.showToast && window.ui.showToast('Modo demo Activos', 'success'); } catch (e) {}
        try { window.ui && window.ui.hideLoading && window.ui.hideLoading(); } catch (e) {}
        console.info('[activos-mock] Login de demo OK (panel Administracion > Activos).');
    }

    async function entrarComoDemoTrabajador(app) {
        aplicarMock();
        app.currentUser = construirUsuarioDemoTrabajador();
        try { app.loadPricingPreferenceForUser && app.loadPricingPreferenceForUser(app.currentUser); } catch (e) {}
        try { app.loadIvaPreferenceForUser && app.loadIvaPreferenceForUser(app.currentUser); } catch (e) {}

        try { app.hideLanding && app.hideLanding(); } catch (e) {}
        try { app.hideLoginModal && app.hideLoginModal(); } catch (e) {}
        try { app.closeMenu && app.closeMenu(); } catch (e) {}

        const tiendaEl = document.getElementById('appContainerTienda');
        const adminEl = document.getElementById('appContainerAdministracion');
        if (tiendaEl) tiendaEl.style.display = '';
        if (adminEl) adminEl.style.display = 'none';
        document.body.classList.remove('gate-visible');
        document.body.classList.remove('admin-panel-visible');

        if (!app.activosManager && window.ActivosManager) {
            app.activosManager = new window.ActivosManager(app);
            app.activosManager.init();
        } else if (app.activosManager) {
            app.activosManager.updateWorkerVisibility(app.currentUser);
        }

        if (!app.isInitialized) {
            try { window.scannerManager && window.scannerManager.initialize(); } catch (e) {}
            app.setupScreens();
            app.isInitialized = true;
        } else if (app.activosManager) {
            app.activosManager.updateWorkerVisibility(app.currentUser);
        }

        try { app.updateUserUI && app.updateUserUI(); } catch (e) {}
        try { app.saveUserSession && app.saveUserSession(app.currentUser, null); } catch (e) {}

        try {
            app.showScreen('herramientas');
            app.updateActiveNav && app.updateActiveNav('herramientas');
        } catch (e) {}

        try { window.ui && window.ui.showToast && window.ui.showToast('Modo demo trabajador (Mis activos)', 'success'); } catch (e) {}
        try { window.ui && window.ui.hideLoading && window.ui.hideLoading(); } catch (e) {}
        console.info('[activos-mock] Login de demo OK (tienda > Herramientas > Mis activos).');
    }

    function resolverCuentaDemo(codigo, password) {
        const c = String(codigo || '').trim().toUpperCase();
        const p = String(password || '').trim().toUpperCase();
        if (c === DEMO_CODE && p === DEMO_PASS) {
            return { enter: entrarComoDemo, label: 'administracion' };
        }
        if (c === USER_CODE && p === USER_PASS) {
            return { enter: entrarComoDemoTrabajador, label: 'trabajador' };
        }
        return null;
    }

    function esCredencialDemo(codigo, password) {
        return !!resolverCuentaDemo(codigo, password);
    }

    function instalarLoginDemo() {
        const app = window.app;
        if (!app || typeof app.handleLogin !== 'function' || app.__activosDemoInstalled) return false;
        const original = app.handleLogin.bind(app);
        app.handleLogin = async function (e) {
            const codigo = (document.getElementById('gateCodigo') || {}).value || '';
            const password = (document.getElementById('gatePassword') || {}).value || '';
            const cuenta = resolverCuentaDemo(codigo, password);
            if (cuenta) {
                if (e && e.preventDefault) e.preventDefault();
                await cuenta.enter(app);
                return;
            }
            return original(e);
        };
        app.__activosDemoInstalled = true;
        console.info('[activos-mock] Logins de demo: DEMO/DEMO (admin) | USER/USER (trabajador)');
        return true;
    }

    // ------------------------------------------------------------------
    // Arranque
    // ------------------------------------------------------------------

    // Exponer API por si se quiere usar desde consola.
    window.ActivosMock = { apply: aplicarMock, loginDemo: function () { return entrarComoDemo(window.app); }, isApplied: function () { return aplicado; } };

    // 1) Si el mock suelto esta activado, aplicarlo ya (en cuanto exista el cliente).
    if (mockEnabled()) {
        if (!aplicarMock()) {
            let n = 0; const t = setInterval(() => { n++; if (aplicarMock() || n > 50) clearInterval(t); }, 50);
        }
    }

    // 2) Instalar el login de demo (solo local / con flag).
    if (demoLoginEnabled()) {
        const tryInstall = () => instalarLoginDemo();
        if (!tryInstall()) {
            let n = 0; const t = setInterval(() => { n++; if (tryInstall() || n > 100) clearInterval(t); }, 50);
        }
        // Auto-login: ?activosDemo=1 (admin) o ?activosDemo=user (trabajador)
        const demoParam = param('activosDemo');
        if (demoParam === '1' || demoParam === '' || demoParam === 'true' || demoParam === 'user') {
            const runAutoLogin = async () => {
                if (!window.app) return false;
                const esUser = demoParam === 'user';
                await (esUser ? entrarComoDemoTrabajador(window.app) : entrarComoDemo(window.app));
                return true;
            };
            const boot = () => {
                if (!window.app) return false;
                void runAutoLogin();
                return true;
            };
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                if (!window.app) { let n = 0; const t = setInterval(() => { n++; if (boot() || n > 100) clearInterval(t); }, 50); }
                else void runAutoLogin();
            } else {
                window.addEventListener('DOMContentLoaded', () => {
                    if (!window.app) { let n = 0; const t = setInterval(() => { n++; if (boot() || n > 100) clearInterval(t); }, 50); }
                    else void runAutoLogin();
                });
            }
        }
    }
})();
