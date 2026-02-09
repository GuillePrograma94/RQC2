/**
 * Opciones y mapeos para el payload de pedidos al ERP.
 * Solo se permiten los valores definidos para serie y centro_venta.
 *
 * Reglas:
 * - centro_venta: lo determina el almacen habitual del cliente.
 * - serie: lo determina el almacen al que el cliente envia el pedido (destino).
 */

var ERP_PEDIDO_OPCIONES = (function () {
    'use strict';

    var SERIES_VALIDAS = ['BT7', 'SM1', '002', '008'];
    var CENTROS_VENTA_VALIDOS = ['1', '2', '7', '8'];

    /**
     * Mapeo: almacen (destino del pedido) -> serie ERP
     */
    var ALMACEN_A_SERIE = {
        ONTINYENT: 'BT7',
        GANDIA: 'SM1',
        ALZIRA: '008',
        REQUENA: '002'
    };

    /**
     * Mapeo: almacen (habitual del cliente) -> centro_venta ERP
     */
    var ALMACEN_A_CENTRO_VENTA = {
        ONTINYENT: '7',
        GANDIA: '1',
        ALZIRA: '8',
        REQUENA: '2'
    };

    function getSeriePorAlmacenDestino(almacenDestino) {
        var key = (almacenDestino || '').toUpperCase().trim();
        return ALMACEN_A_SERIE[key] || SERIES_VALIDAS[0];
    }

    function getCentroVentaPorAlmacenHabitual(almacenHabitual) {
        var key = (almacenHabitual || '').toUpperCase().trim();
        return ALMACEN_A_CENTRO_VENTA[key] || CENTROS_VENTA_VALIDOS[0];
    }

    /**
     * Obtiene serie y centro_venta para el payload del ERP.
     * @param {string} almacenDestino - Almacen al que se envia el pedido (determina serie)
     * @param {string} almacenHabitual - Almacen habitual del cliente (determina centro_venta)
     * @returns {{ serie: string, centro_venta: string }}
     */
    function getSerieYCentroVenta(almacenDestino, almacenHabitual) {
        return {
            serie: getSeriePorAlmacenDestino(almacenDestino),
            centro_venta: getCentroVentaPorAlmacenHabitual(almacenHabitual)
        };
    }

    return {
        SERIES_VALIDAS: SERIES_VALIDAS,
        CENTROS_VENTA_VALIDOS: CENTROS_VENTA_VALIDOS,
        ALMACEN_A_SERIE: ALMACEN_A_SERIE,
        ALMACEN_A_CENTRO_VENTA: ALMACEN_A_CENTRO_VENTA,
        getSeriePorAlmacenDestino: getSeriePorAlmacenDestino,
        getCentroVentaPorAlmacenHabitual: getCentroVentaPorAlmacenHabitual,
        getSerieYCentroVenta: getSerieYCentroVenta
    };
})();
