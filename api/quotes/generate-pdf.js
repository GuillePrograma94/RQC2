const PDFDocument = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');

const PAGE_MARGIN = 48;
const PAGE_BOTTOM_SAFE = 80;
const TABLE_IMG_COL = 36;
const ROW_MIN_H = 36;
const PRODUCT_IMG_BASE = 'https://www.saneamiento-martinez.com/imagenes/articulos/';

/** Paleta documento presupuesto (aspecto profesional / moderno) */
const THEME = {
    accent: '#1e3a5f',
    accentSoft: '#e8eef5',
    text: '#0f172a',
    textMuted: '#64748b',
    textLight: '#94a3b8',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    tableHeaderBg: '#f1f5f9',
    rowStripe: '#fafbfc',
    totalBand: '#f1f5f9',
    totalStrong: '#1e3a5f'
};

function parseRequestBody(req) {
    if (!req || req.body == null) return {};
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body);
        } catch (_) {
            return {};
        }
    }
    return req.body;
}

function toCurrency(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function safeText(value) {
    if (value == null) return '';
    return String(value).trim();
}

function defaultProductImageUrlForCodigo(codigo) {
    const c = safeText(codigo);
    if (!c) return '';
    return PRODUCT_IMG_BASE + c + '_1.JPG';
}

/**
 * @returns {Promise<Buffer|null>}
 */
async function fetchImageBuffer(url) {
    const u = safeText(url);
    if (!u || (!u.startsWith('http://') && !u.startsWith('https://'))) {
        return null;
    }
    try {
        const res = await fetch(u, { redirect: 'follow' });
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);
        if (!buf.length) return null;
        return buf;
    } catch (_) {
        return null;
    }
}

/**
 * Cabecera: logo con la misma altura que la linea del titulo PRESUPUESTO; debajo de N.|Fecha,
 * dos columnas: izquierda nombre+CIF empresa, derecha bloque CLIENTE (alineado a la derecha).
 */
function drawHeader(doc, empresa, presupuesto, logoBuf) {
    const m = PAGE_MARGIN;
    const pageW = doc.page.width;
    const accent = THEME.accent;
    const y0 = m;
    const gapAfterLogo = 10;
    const logoW = 92;

    const textX = logoBuf ? m + logoW + gapAfterLogo : m;
    const textW = pageW - m - textX;

    doc.font('Helvetica-Bold').fontSize(17);
    const titleLineH = doc.heightOfString('PRESUPUESTO', { width: textW, align: 'right' });

    if (logoBuf) {
        try {
            doc.image(logoBuf, m, y0, { width: logoW, height: titleLineH, fit: [logoW, titleLineH] });
        } catch (_) {
            /* empty */
        }
    }

    doc.fillColor(accent).font('Helvetica-Bold').fontSize(17)
        .text('PRESUPUESTO', textX, y0, { width: textW, align: 'right' });
    let y = doc.y + 2;
    doc.fillColor(THEME.textMuted).font('Helvetica').fontSize(8)
        .text(
            'N. ' +
                safeText(presupuesto.numero_presupuesto) +
                '  |  Fecha: ' +
                new Date(presupuesto.fecha || Date.now()).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }),
            textX,
            y,
            { width: textW, align: 'right' }
        );
    const yAfterMeta = doc.y + 4;

    const colGap = 14;
    const lowerW = pageW - 2 * m - colGap;
    const leftColW = lowerW * 0.46;
    const rightColW = lowerW * 0.54;
    const leftColX = m;
    const rightColX = m + leftColW + colGap;

    let yL = yAfterMeta;
    doc.fillColor(THEME.text).font('Helvetica-Bold').fontSize(9)
        .text(safeText(empresa.razon_social || 'BATMAR'), leftColX, yL, { width: leftColW, align: 'left' });
    yL = doc.y + 1;
    const cifE = safeText(empresa.cif ? 'CIF: ' + empresa.cif : '');
    if (cifE) {
        doc.fillColor(THEME.textMuted).font('Helvetica').fontSize(8).text(cifE, leftColX, yL, { width: leftColW });
        yL = doc.y;
    }

    const clienteLines = [];
    const nom = safeText(presupuesto.cliente_nombre);
    if (nom) clienteLines.push(nom);
    const cifC = safeText(presupuesto.cliente_cif ? 'CIF: ' + presupuesto.cliente_cif : '');
    if (cifC) clienteLines.push(cifC);
    const dirC = safeText(presupuesto.cliente_direccion);
    if (dirC) clienteLines.push(dirC);
    const cpPobC = safeText([presupuesto.cliente_cp, presupuesto.cliente_poblacion].filter(Boolean).join(' · '));
    if (cpPobC) clienteLines.push(cpPobC);
    const provC = safeText(presupuesto.cliente_provincia);
    if (provC) clienteLines.push(provC);
    const codC = safeText(presupuesto.cliente_codigo ? 'Cod. cliente: ' + presupuesto.cliente_codigo : '');
    if (codC) clienteLines.push(codC);

    let yR = yAfterMeta;
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(7.5)
        .text('CLIENTE', rightColX, yR, { width: rightColW, align: 'right' });
    yR = doc.y + 1;
    doc.fillColor(THEME.text).font('Helvetica').fontSize(8).lineGap(0.35);
    for (const line of clienteLines) {
        if (!line) continue;
        doc.text(line, rightColX, yR, { width: rightColW, align: 'right' });
        yR = doc.y;
    }

    const leftBottom = yL;
    const rightBottom = yR;
    const blockBottom = Math.max(leftBottom, rightBottom) + 6;
    doc.save();
    doc.moveTo(m, blockBottom).lineTo(pageW - m, blockBottom).strokeColor(THEME.border).lineWidth(0.4).stroke();
    doc.restore();

    return blockBottom + 8;
}

function drawTableHeader(doc, y) {
    const m = PAGE_MARGIN;
    const w = doc.page.width - 2 * m;
    const h = 26;
    doc.save();
    doc.rect(m, y, w, h).fill(THEME.tableHeaderBg);
    doc.moveTo(m, y + h).lineTo(m + w, y + h).strokeColor(THEME.accent).lineWidth(1.25).stroke();
    doc.restore();

    doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(8);
    const x0 = m + 6;
    doc.text('', x0, y + 8, { width: TABLE_IMG_COL });
    doc.text('Codigo', x0 + TABLE_IMG_COL, y + 8, { width: 54 });
    doc.text('Descripcion', x0 + TABLE_IMG_COL + 56, y + 8, { width: 166 });
    doc.text('Ud.', x0 + TABLE_IMG_COL + 226, y + 8, { width: 36, align: 'right' });
    doc.text('P. unit.', x0 + TABLE_IMG_COL + 266, y + 8, { width: 54, align: 'right' });
    doc.text('Dto %', x0 + TABLE_IMG_COL + 324, y + 8, { width: 34, align: 'right' });
    doc.text('Importe', x0 + TABLE_IMG_COL + 362, y + 8, { width: 54, align: 'right' });
}

/**
 * @returns {number} next Y
 */
function drawLine(doc, line, y, thumbBuf, rowIndex) {
    const cantidad = Number(line.cantidad || 0);
    const precio = Number(line.precio_unitario || 0);
    const dto = Number(line.dto_pct || 0);
    const importe = Number(line.importe_linea || 0);

    const m = PAGE_MARGIN;
    const pageW = doc.page.width;
    const w = pageW - 2 * m;
    const x0 = m + 6;
    const thumbSize = 30;
    const rowTop = y;
    const rowPad = 5;

    const cellTop = rowTop + rowPad;
    const descW = 166;

    doc.font('Helvetica').fontSize(8);
    const descH = doc.heightOfString(safeText(line.descripcion) || '-', {
        width: descW,
        lineGap: 0.5,
        ellipsis: true
    });
    const contentH = Math.max(descH + 8, thumbSize + 8, 24);
    const rowH = Math.max(contentH + rowPad * 2, ROW_MIN_H + rowPad);

    if (rowIndex % 2 === 1) {
        doc.save();
        doc.rect(m, rowTop, w, rowH).fill(THEME.rowStripe);
        doc.restore();
    }

    doc.save();
    doc.moveTo(m, rowTop + rowH).lineTo(m + w, rowTop + rowH).strokeColor(THEME.border).lineWidth(0.25).stroke();
    doc.restore();

    const numY = cellTop + Math.max(4, (contentH - 9) / 2);

    if (thumbBuf) {
        try {
            doc.save();
            doc.roundedRect(x0, cellTop + 2, thumbSize, thumbSize, 3).clip();
            doc.image(thumbBuf, x0, cellTop + 2, { width: thumbSize, height: thumbSize, fit: [thumbSize, thumbSize] });
            doc.restore();
            doc.roundedRect(x0, cellTop + 2, thumbSize, thumbSize, 3).strokeColor(THEME.border).lineWidth(0.35).stroke();
        } catch (_) {
            /* empty */
        }
    } else {
        doc.save();
        doc.roundedRect(x0, cellTop + 2, thumbSize, thumbSize, 3).fill('#f1f5f9');
        doc.roundedRect(x0, cellTop + 2, thumbSize, thumbSize, 3).strokeColor(THEME.border).lineWidth(0.35).stroke();
        doc.restore();
    }

    doc.fillColor(THEME.text).font('Helvetica').fontSize(8)
        .text(safeText(line.codigo), x0 + TABLE_IMG_COL, numY, { width: 54 });
    doc.fillColor(THEME.text).font('Helvetica').fontSize(8)
        .text(safeText(line.descripcion), x0 + TABLE_IMG_COL + 56, cellTop + 6, {
            width: descW,
            lineGap: 0.5,
            ellipsis: true
        });
    doc.fillColor(THEME.textMuted).font('Helvetica').fontSize(8)
        .text(cantidad.toFixed(2), x0 + TABLE_IMG_COL + 226, numY, { width: 36, align: 'right' });
    doc.text(toCurrency(precio), x0 + TABLE_IMG_COL + 266, numY, { width: 54, align: 'right' });
    doc.text(dto.toFixed(2), x0 + TABLE_IMG_COL + 324, numY, { width: 34, align: 'right' });
    doc.fillColor(THEME.text).font('Helvetica-Bold').fontSize(8)
        .text(toCurrency(importe), x0 + TABLE_IMG_COL + 362, numY, { width: 54, align: 'right' });

    return rowTop + rowH;
}

function ensureSpace(doc, y, needed) {
    const limit = doc.page.height - PAGE_BOTTOM_SAFE;
    if (y + needed > limit) {
        doc.addPage();
        return PAGE_MARGIN;
    }
    return y;
}

function drawTotalsBlock(doc, y, presupuesto) {
    const m = PAGE_MARGIN;
    const pageW = doc.page.width;
    const colW = 118;
    const labelX = pageW - m - colW - 102;
    const valX = pageW - m - colW;

    doc.save();
    doc.roundedRect(labelX - 10, y, colW + 112, 76, 6).fill(THEME.totalBand);
    doc.roundedRect(labelX - 10, y, colW + 112, 76, 6).strokeColor(THEME.border).lineWidth(0.5).stroke();
    doc.restore();

    let ty = y + 14;
    doc.fillColor(THEME.textMuted).font('Helvetica').fontSize(9);
    doc.text('Subtotal (sin IVA)', labelX, ty, { width: 100, align: 'right' });
    doc.text(toCurrency(presupuesto.subtotal), valX, ty, { width: colW, align: 'right' });
    ty += 16;
    doc.text('IVA 21 %', labelX, ty, { width: 100, align: 'right' });
    doc.text(toCurrency(presupuesto.impuestos), valX, ty, { width: colW, align: 'right' });
    ty += 18;

    doc.save();
    doc.moveTo(labelX - 6, ty).lineTo(valX + colW, ty).strokeColor(THEME.borderStrong).lineWidth(0.75).stroke();
    doc.restore();

    ty += 8;
    doc.fillColor(THEME.totalStrong).font('Helvetica-Bold').fontSize(11.5);
    doc.text('TOTAL', labelX, ty, { width: 100, align: 'right' });
    doc.text(toCurrency(presupuesto.total), valX, ty, { width: colW, align: 'right' });

    return y + 76;
}

function drawFooter(doc, y) {
    const m = PAGE_MARGIN;
    const pageW = doc.page.width;
    const w = pageW - 2 * m;
    const limit = doc.page.height - PAGE_BOTTOM_SAFE;
    let footY = y + 20;
    if (footY > limit - 32) {
        doc.addPage();
        footY = m + 12;
    }
    doc.save();
    doc.moveTo(m, footY).lineTo(m + w, footY).strokeColor(THEME.border).lineWidth(0.5).stroke();
    doc.restore();
    doc.fontSize(7.5).fillColor(THEME.textLight).font('Helvetica')
        .text(
            'Documento generado automaticamente por BATMAR',
            m,
            footY + 8,
            { align: 'center', width: w }
        );
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, message: 'Metodo no permitido' });
        return;
    }

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!supabaseUrl || !serviceKey) {
        res.status(500).json({ success: false, message: 'Configuracion de servidor incompleta' });
        return;
    }

    const body = parseRequestBody(req);
    const presupuestoId = Number(body.presupuesto_id || 0);
    if (!presupuestoId) {
        res.status(400).json({ success: false, message: 'presupuesto_id es obligatorio' });
        return;
    }

    try {
        const supabase = createClient(supabaseUrl, serviceKey);
        const { data: detailRows, error: detailError } = await supabase.rpc('get_presupuesto_detalle', {
            p_presupuesto_id: presupuestoId
        });
        if (detailError) {
            console.error('[quotes/generate-pdf] error get_presupuesto_detalle:', detailError.message || detailError);
            res.status(500).json({ success: false, message: 'No se pudo cargar el presupuesto' });
            return;
        }
        const presupuesto = Array.isArray(detailRows) && detailRows.length ? detailRows[0] : null;
        if (!presupuesto) {
            res.status(404).json({ success: false, message: 'Presupuesto no encontrado' });
            return;
        }

        let empresa = null;
        const almacenCab = presupuesto.almacen_habitual != null ? String(presupuesto.almacen_habitual).trim() : '';
        if (almacenCab) {
            const { data: empPorAlmacen, error: errAlm } = await supabase
                .from('empresas_por_almacen')
                .select('almacen, razon_social, cif, direccion, cp, poblacion, provincia, telefono, email, web, logo_url, condiciones_comerciales')
                .eq('almacen', almacenCab)
                .maybeSingle();
            if (errAlm) {
                console.error('[quotes/generate-pdf] error empresas_por_almacen por almacen:', errAlm.message || errAlm);
            }
            empresa = empPorAlmacen || null;
            if (!empresa) {
                const { data: empUpper, error: errUp } = await supabase
                    .from('empresas_por_almacen')
                    .select('almacen, razon_social, cif, direccion, cp, poblacion, provincia, telefono, email, web, logo_url, condiciones_comerciales')
                    .eq('almacen', almacenCab.toUpperCase())
                    .maybeSingle();
                if (errUp) {
                    console.error('[quotes/generate-pdf] error empresas_por_almacen upper:', errUp.message || errUp);
                }
                empresa = empUpper || null;
            }
        }
        if (!empresa) {
            const { data: empGlobal, error: errGlob } = await supabase
                .from('empresas_por_almacen')
                .select('almacen, razon_social, cif, direccion, cp, poblacion, provincia, telefono, email, web, logo_url, condiciones_comerciales')
                .eq('almacen', 'GLOBAL')
                .maybeSingle();
            if (errGlob) {
                console.error('[quotes/generate-pdf] error empresas_por_almacen GLOBAL:', errGlob.message || errGlob);
            }
            empresa = empGlobal || null;
        }

        const logoBuf = empresa && empresa.logo_url ? await fetchImageBuffer(empresa.logo_url) : null;

        const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('error', (err) => {
            console.error('[quotes/generate-pdf] error pdf stream:', err && err.message ? err.message : err);
        });

        const headerEndY = drawHeader(doc, empresa || {}, presupuesto, logoBuf);
        let y = headerEndY;

        y = ensureSpace(doc, y, 48);
        drawTableHeader(doc, y);
        y += 28;

        const lineas = Array.isArray(presupuesto.lineas) ? presupuesto.lineas : [];
        for (let i = 0; i < lineas.length; i++) {
            const line = lineas[i];
            const urlTry =
                safeText(line.imagen_url) || defaultProductImageUrlForCodigo(line.codigo);
            const thumbBuf = urlTry ? await fetchImageBuffer(urlTry) : null;

            const prevY = y;
            y = ensureSpace(doc, y, ROW_MIN_H + 16);
            if (y === PAGE_MARGIN && prevY !== PAGE_MARGIN) {
                drawTableHeader(doc, y);
                y += 28;
            }
            y = drawLine(doc, line, y, thumbBuf, i);
        }

        y += 14;
        y = ensureSpace(doc, y, 96);
        y = drawTotalsBlock(doc, y, presupuesto);
        y += 8;
        y = ensureSpace(doc, y, 72);

        const condiciones = safeText((empresa && empresa.condiciones_comerciales) || '');
        if (condiciones) {
            y += 4;
            y = ensureSpace(doc, y, 48);
            doc.fillColor(THEME.accent).font('Helvetica-Bold').fontSize(10).text('Condiciones comerciales', PAGE_MARGIN, y);
            y += 14;
            doc.fillColor(THEME.textMuted).font('Helvetica').fontSize(9).lineGap(2)
                .text(condiciones, PAGE_MARGIN, y, {
                    width: doc.page.width - 2 * PAGE_MARGIN
                });
            y = doc.y + 10;
        }

        drawFooter(doc, y);

        doc.end();

        const pdfBuffer = await new Promise((resolve, reject) => {
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
        });

        const fileName = (safeText(presupuesto.numero_presupuesto) || ('presupuesto-' + presupuestoId)) + '.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"');
        res.status(200).send(pdfBuffer);
    } catch (error) {
        console.error('[quotes/generate-pdf] unexpected error:', error && error.message ? error.message : error);
        res.status(500).json({ success: false, message: 'No se pudo generar el PDF' });
    }
};
