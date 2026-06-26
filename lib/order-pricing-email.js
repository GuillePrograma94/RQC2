/**
 * Calculo de precios efectivos (sin IVA) para emails de confirmacion de pedido.
 * Replica la logica de mejor precio de la app: pacto > tarifa > oferta (si aplica).
 */

function safeText(value) {
    if (value == null) return '';
    return String(value).trim();
}

function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback != null ? fallback : 0);
}

function normalizeDiscountCode(value) {
    const text = safeText(value).toUpperCase();
    if (!text) return '';
    return text.replace(/^0+/, '') || '0';
}

function roundMoney(value) {
    return Math.round(toNumber(value, 0) * 10000) / 10000;
}

function getPactoPct(codigoCliente, clave, pactosMap) {
    const codigoNum = parseInt(String(codigoCliente), 10);
    if (!Number.isFinite(codigoNum) || codigoNum <= 0 || !clave) return null;
    const claveNorm = normalizeDiscountCode(clave);
    let pact = pactosMap.get(clave);
    if (pact == null && claveNorm) pact = pactosMap.get(claveNorm);
    if (pact == null || pact === '') return null;
    const n = Number(pact);
    return Number.isFinite(n) ? n : null;
}

function getTarifaPct(tarifaCodigo, clave, clavesMap) {
    if (!tarifaCodigo || !clave) return null;
    const claveNorm = normalizeDiscountCode(clave);
    let row = clavesMap.get(clave);
    if (!row && claveNorm) row = clavesMap.get(claveNorm);
    if (!row || typeof row !== 'object') return null;
    const tarifaRaw = safeText(tarifaCodigo);
    const tarifaNorm = normalizeDiscountCode(tarifaRaw);
    const pct = row[tarifaRaw] != null ? row[tarifaRaw] : row[tarifaNorm];
    if (pct == null || pct === '') return null;
    const n = Number(pct);
    return Number.isFinite(n) ? n : null;
}

function getDtoPctForProduct(usuario, catalogProduct, clavesMap, pactosMap) {
    if (!catalogProduct) return null;
    const clave = safeText(catalogProduct.clave_descuento);
    if (!clave) return null;
    const codigoCliente = usuario && usuario.codigo_usuario != null
        ? String(usuario.codigo_usuario).split('-')[0].trim()
        : '';
    const pacto = getPactoPct(codigoCliente, clave, pactosMap);
    if (pacto != null) return pacto;
    const tarifa = usuario && usuario.tarifa != null ? safeText(usuario.tarifa) : '';
    if (!tarifa) return null;
    return getTarifaPct(tarifa, clave, clavesMap);
}

function getPvpConTarifa(pvpBase, dtoPct) {
    const base = toNumber(pvpBase, 0);
    if (dtoPct == null) return base;
    return roundMoney(base * (1 - dtoPct / 100));
}

async function fetchCatalogProducts(supabase, codigos) {
    const unique = Array.from(new Set(codigos.map(function (c) {
        return safeText(c).toUpperCase();
    }).filter(Boolean)));
    const map = new Map();
    if (!unique.length) return map;

    const { data, error } = await supabase
        .from('productos')
        .select('codigo, pvp, clave_descuento')
        .in('codigo', unique);

    if (error || !Array.isArray(data)) return map;
    data.forEach(function (row) {
        const code = safeText(row.codigo).toUpperCase();
        if (code) map.set(code, row);
    });
    return map;
}

async function fetchClavesDescuento(supabase, claves) {
    const unique = Array.from(new Set(claves.map(safeText).filter(Boolean)));
    const map = new Map();
    if (!unique.length) return map;

    const { data, error } = await supabase
        .from('claves_descuento')
        .select('clave, tarifas')
        .in('clave', unique);

    if (error || !Array.isArray(data)) return map;
    data.forEach(function (row) {
        const clave = safeText(row.clave);
        if (!clave) return;
        const tarifas = row.tarifas && typeof row.tarifas === 'object' ? row.tarifas : {};
        map.set(clave, tarifas);
        const norm = normalizeDiscountCode(clave);
        if (norm && !map.has(norm)) map.set(norm, tarifas);
    });
    return map;
}

async function fetchPactosCliente(supabase, codigoCliente) {
    const map = new Map();
    const codigoNum = parseInt(String(codigoCliente), 10);
    if (!Number.isFinite(codigoNum) || codigoNum <= 0) return map;

    const { data, error } = await supabase
        .from('pactos_clientes_descuento')
        .select('clave_descuento, descuento_pct')
        .eq('codigo_cliente', codigoNum)
        .eq('activo', true);

    if (error || !Array.isArray(data)) return map;
    data.forEach(function (row) {
        const clave = safeText(row.clave_descuento);
        if (!clave) return;
        map.set(clave, row.descuento_pct);
        const norm = normalizeDiscountCode(clave);
        if (norm && !map.has(norm)) map.set(norm, row.descuento_pct);
    });
    return map;
}

async function fetchOfertasForProduct(supabase, codigoArticulo, grupoCliente) {
    if (!grupoCliente) return [];
    const codigo = safeText(codigoArticulo).toUpperCase();
    if (!codigo) return [];

    const { data: ofertasProducto, error } = await supabase
        .from('ofertas_productos')
        .select(
            'numero_oferta, precio, descuento_oferta, unidades_minimas, unidades_multiplo, ' +
            'ofertas!inner(numero_oferta, tipo_oferta, titulo_descripcion, activa)'
        )
        .eq('codigo_articulo', codigo)
        .eq('ofertas.activa', true);

    if (error || !ofertasProducto || !ofertasProducto.length) return [];

    const { data: ofertasGrupos, error: errorGrupos } = await supabase
        .from('ofertas_grupos_asignaciones')
        .select('numero_oferta, ofertas_grupos!inner(codigo_grupo)')
        .eq('ofertas_grupos.codigo_grupo', String(grupoCliente));

    if (errorGrupos || !ofertasGrupos || !ofertasGrupos.length) return [];

    const numerosGrupo = new Set(ofertasGrupos.map(function (og) { return og.numero_oferta; }));
    return ofertasProducto
        .filter(function (op) { return numerosGrupo.has(op.numero_oferta); })
        .map(function (op) {
            return {
                numero_oferta: op.numero_oferta,
                precio: op.precio,
                descuento_oferta: op.descuento_oferta,
                unidades_minimas: op.unidades_minimas,
                unidades_multiplo: op.unidades_multiplo,
                tipo_oferta: op.ofertas.tipo_oferta,
                titulo_descripcion: op.ofertas.titulo_descripcion
            };
        });
}

async function fetchIntervalos(supabase, numeroOferta) {
    const { data, error } = await supabase
        .from('ofertas_intervalos')
        .select('desde_unidades, hasta_unidades, descuento_porcentaje')
        .eq('numero_oferta', numeroOferta)
        .order('desde_unidades', { ascending: true });
    if (error || !Array.isArray(data)) return [];
    return data;
}

async function fetchLote(supabase, numeroOferta) {
    const { data, error } = await supabase
        .from('ofertas_detalles')
        .select('valor')
        .eq('numero_oferta', numeroOferta)
        .eq('campo', 'unidades_lote')
        .maybeSingle();
    if (error || !data) return null;
    const n = parseInt(String(data.valor), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function verificarOfertaCumplida(oferta, cantidad, lineas, ofertasByCodigo, intervalosCache, loteCache) {
    const tipoOferta = Number(oferta.tipo_oferta);

    if (tipoOferta === 1) {
        const unidadesMinimas = toNumber(oferta.unidades_minimas, 0);
        if (unidadesMinimas <= 0) return { cumplida: false };
        return { cumplida: cantidad >= unidadesMinimas };
    }

    if (tipoOferta === 2) {
        const intervalos = intervalosCache[oferta.numero_oferta] || [];
        if (!intervalos.length) return { cumplida: false };
        let totalUnidades = 0;
        lineas.forEach(function (linea) {
            const cod = safeText(linea.codigo_producto || linea.codigo).toUpperCase();
            const ofertasProd = ofertasByCodigo.get(cod) || [];
            if (ofertasProd.some(function (o) { return o.numero_oferta === oferta.numero_oferta; })) {
                totalUnidades += toNumber(linea.cantidad, 0);
            }
        });
        const intervaloActual = intervalos.find(function (intervalo) {
            return totalUnidades >= intervalo.desde_unidades && totalUnidades <= intervalo.hasta_unidades;
        });
        if (intervaloActual) return { cumplida: true };
        const ultimo = intervalos[intervalos.length - 1];
        return { cumplida: totalUnidades > ultimo.hasta_unidades };
    }

    if (tipoOferta === 3) {
        const unidadesLote = loteCache[oferta.numero_oferta];
        if (!unidadesLote) return { cumplida: false };
        let totalUnidades = 0;
        lineas.forEach(function (linea) {
            const cod = safeText(linea.codigo_producto || linea.codigo).toUpperCase();
            const ofertasProd = ofertasByCodigo.get(cod) || [];
            if (ofertasProd.some(function (o) { return o.numero_oferta === oferta.numero_oferta; })) {
                totalUnidades += toNumber(linea.cantidad, 0);
            }
        });
        return { cumplida: Math.floor(totalUnidades / unidadesLote) > 0 };
    }

    if (tipoOferta === 4) {
        const unidadesMultiplo = toNumber(oferta.unidades_multiplo, 0);
        if (unidadesMultiplo <= 0) return { cumplida: false };
        return { cumplida: cantidad >= unidadesMultiplo };
    }

    return { cumplida: false };
}

function calcularDescuentoOferta(oferta, linea, lineas, ofertasByCodigo, intervalosCache, loteCache) {
    const tipoOferta = Number(oferta.tipo_oferta);
    const cantidad = toNumber(linea.cantidad, 0);

    if (tipoOferta === 1) {
        return { descuento: toNumber(oferta.descuento_oferta, 0), factor: 1.0 };
    }

    if (tipoOferta === 2) {
        const intervalos = intervalosCache[oferta.numero_oferta] || [];
        if (!intervalos.length) return { descuento: 0, factor: 0 };
        let totalUnidades = 0;
        lineas.forEach(function (prod) {
            const cod = safeText(prod.codigo_producto || prod.codigo).toUpperCase();
            const ofertasProd = ofertasByCodigo.get(cod) || [];
            if (ofertasProd.some(function (o) { return o.numero_oferta === oferta.numero_oferta; })) {
                totalUnidades += toNumber(prod.cantidad, 0);
            }
        });
        const intervaloActual = intervalos.find(function (intervalo) {
            return totalUnidades >= intervalo.desde_unidades && totalUnidades <= intervalo.hasta_unidades;
        });
        if (intervaloActual) {
            return { descuento: toNumber(intervaloActual.descuento_porcentaje, 0), factor: 1.0 };
        }
        const ultimo = intervalos[intervalos.length - 1];
        if (totalUnidades > ultimo.hasta_unidades) {
            return { descuento: toNumber(ultimo.descuento_porcentaje, 0), factor: 1.0 };
        }
        return { descuento: 0, factor: 0 };
    }

    if (tipoOferta === 3) {
        const unidadesLote = loteCache[oferta.numero_oferta];
        if (!unidadesLote) return { descuento: 0, factor: 0 };
        let totalUnidades = 0;
        lineas.forEach(function (prod) {
            const cod = safeText(prod.codigo_producto || prod.codigo).toUpperCase();
            const ofertasProd = ofertasByCodigo.get(cod) || [];
            if (ofertasProd.some(function (o) { return o.numero_oferta === oferta.numero_oferta; })) {
                totalUnidades += toNumber(prod.cantidad, 0);
            }
        });
        const lotesCompletos = Math.floor(totalUnidades / unidadesLote);
        const unidadesConDescuento = lotesCompletos * unidadesLote;
        if (lotesCompletos > 0 && totalUnidades > 0) {
            const proporcionProducto = cantidad / totalUnidades;
            const unidadesProductoConDescuento = Math.floor(unidadesConDescuento * proporcionProducto);
            const factorProducto = cantidad > 0 ? unidadesProductoConDescuento / cantidad : 0;
            return { descuento: toNumber(oferta.descuento_oferta, 0), factor: factorProducto };
        }
        return { descuento: 0, factor: 0 };
    }

    if (tipoOferta === 4) {
        const unidadesMultiplo = toNumber(oferta.unidades_multiplo, 0);
        if (unidadesMultiplo <= 0) return { descuento: 0, factor: 0 };
        const multiplosCompletos = Math.floor(cantidad / unidadesMultiplo);
        const unidadesConDescuento = multiplosCompletos * unidadesMultiplo;
        if (multiplosCompletos > 0) {
            return {
                descuento: toNumber(oferta.descuento_oferta, 0),
                factor: cantidad > 0 ? unidadesConDescuento / cantidad : 0
            };
        }
        return { descuento: 0, factor: 0 };
    }

    return { descuento: 0, factor: 0 };
}

function computeLineEffectivePriceSinIva(linea, catalogProduct, usuario, clavesMap, pactosMap, ofertasByCodigo, allLineas, intervalosCache, loteCache) {
    const codigo = safeText(linea.codigo_producto || linea.codigo).toUpperCase();
    const cantidad = toNumber(linea.cantidad, 0);
    const storedPrice = toNumber(linea.precio_unitario, 0);
    const pvpBase = catalogProduct && catalogProduct.pvp != null
        ? toNumber(catalogProduct.pvp, storedPrice)
        : storedPrice;

    const dtoTarifa = getDtoPctForProduct(usuario, catalogProduct, clavesMap, pactosMap);
    const priceDtoTarifa = getPvpConTarifa(pvpBase, dtoTarifa);

    let precioConDescuento = pvpBase;
    let descuentoAplicado = 0;
    let precioNetoOfertaAplicado = false;

    const grupoCliente = usuario && usuario.grupo_cliente != null ? usuario.grupo_cliente : null;
    if (grupoCliente) {
        const ofertas = ofertasByCodigo.get(codigo) || [];
        if (ofertas.length > 0) {
            const ofertaActiva = ofertas[0];
            const resultadoOferta = verificarOfertaCumplida(
                ofertaActiva, cantidad, allLineas, ofertasByCodigo, intervalosCache, loteCache
            );
            if (resultadoOferta.cumplida) {
                const precioNetoOferta = toNumber(ofertaActiva.precio, 0);
                const tipoOfertaNum = Number(ofertaActiva.tipo_oferta);
                const usarPrecioNetoFijo = precioNetoOferta > 0 && tipoOfertaNum !== 2;
                if (usarPrecioNetoFijo) {
                    precioConDescuento = roundMoney(precioNetoOferta);
                    precioNetoOfertaAplicado = true;
                } else {
                    const result = calcularDescuentoOferta(
                        ofertaActiva, linea, allLineas, ofertasByCodigo, intervalosCache, loteCache
                    );
                    if (result.descuento > 0 && result.factor > 0) {
                        descuentoAplicado = result.descuento;
                        if (tipoOfertaNum === 3 || tipoOfertaNum === 4) {
                            const precioConDescuentoTotal = pvpBase * (1 - result.descuento / 100);
                            precioConDescuento = roundMoney(
                                (precioConDescuentoTotal * result.factor) + (pvpBase * (1 - result.factor))
                            );
                        } else {
                            precioConDescuento = roundMoney(pvpBase * (1 - result.descuento / 100));
                        }
                    }
                }
            }
        }
    }

    const tarifaDisponible = dtoTarifa != null && dtoTarifa > 0 && priceDtoTarifa < pvpBase;
    const ofertaDisponible = (descuentoAplicado > 0 || precioNetoOfertaAplicado) && precioConDescuento < pvpBase;
    const usarOferta = ofertaDisponible && (!tarifaDisponible || precioConDescuento <= priceDtoTarifa);
    const usarTarifa = tarifaDisponible && !usarOferta;

    if (usarOferta) return precioConDescuento;
    if (usarTarifa) return priceDtoTarifa;
    return pvpBase;
}

/**
 * Recalcula precios de linea y total sin IVA para el email de confirmacion.
 * @returns {Promise<{ productos: Array, total_importe: number }>}
 */
async function resolveOrderEmailPricing(supabase, usuario, productos) {
    const lineas = Array.isArray(productos) ? productos : [];
    if (!lineas.length) {
        return { productos: [], total_importe: 0 };
    }

    const codigos = lineas.map(function (p) {
        return safeText(p.codigo_producto || p.codigo).toUpperCase();
    }).filter(Boolean);

    const catalogMap = await fetchCatalogProducts(supabase, codigos);
    const clavesNeeded = [];
    catalogMap.forEach(function (prod) {
        const clave = safeText(prod.clave_descuento);
        if (clave) clavesNeeded.push(clave);
    });
    const clavesMap = await fetchClavesDescuento(supabase, clavesNeeded);

    const codigoClientePacto = usuario && usuario.codigo_usuario != null
        ? String(usuario.codigo_usuario).split('-')[0].trim()
        : '';
    const pactosMap = await fetchPactosCliente(supabase, codigoClientePacto);

    const grupoCliente = usuario && usuario.grupo_cliente != null ? usuario.grupo_cliente : null;
    const ofertasByCodigo = new Map();
    const intervalosCache = {};
    const loteCache = {};

    if (grupoCliente) {
        const codigosUnicos = Array.from(new Set(codigos));
        for (let i = 0; i < codigosUnicos.length; i++) {
            const cod = codigosUnicos[i];
            const ofertas = await fetchOfertasForProduct(supabase, cod, grupoCliente);
            if (ofertas.length > 0) {
                ofertasByCodigo.set(cod, ofertas);
                for (let j = 0; j < ofertas.length; j++) {
                    const of = ofertas[j];
                    const tipo = Number(of.tipo_oferta);
                    if (tipo === 2 && intervalosCache[of.numero_oferta] === undefined) {
                        intervalosCache[of.numero_oferta] = await fetchIntervalos(supabase, of.numero_oferta);
                    }
                    if (tipo === 3 && loteCache[of.numero_oferta] === undefined) {
                        loteCache[of.numero_oferta] = await fetchLote(supabase, of.numero_oferta);
                    }
                }
            }
        }
    }

    let totalImporte = 0;
    const productosAjustados = lineas.map(function (linea) {
        const codigo = safeText(linea.codigo_producto || linea.codigo).toUpperCase();
        const catalogProduct = catalogMap.get(codigo) || null;
        const cantidad = toNumber(linea.cantidad, 0);
        const precioEfectivo = computeLineEffectivePriceSinIva(
            linea,
            catalogProduct,
            usuario,
            clavesMap,
            pactosMap,
            ofertasByCodigo,
            lineas,
            intervalosCache,
            loteCache
        );
        const subtotal = roundMoney(precioEfectivo * cantidad);
        totalImporte += subtotal;
        return Object.assign({}, linea, {
            precio_unitario: precioEfectivo,
            subtotal: subtotal
        });
    });

    return {
        productos: productosAjustados,
        total_importe: roundMoney(totalImporte)
    };
}

module.exports = {
    resolveOrderEmailPricing
};
