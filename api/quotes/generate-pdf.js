const PDFDocument = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');

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

function drawHeader(doc, empresa, presupuesto) {
    doc.fontSize(20).font('Helvetica-Bold').text('PRESUPUESTO', { align: 'right' });
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica')
        .text('Numero: ' + safeText(presupuesto.numero_presupuesto), { align: 'right' })
        .text('Fecha: ' + new Date(presupuesto.fecha || Date.now()).toLocaleDateString('es-ES'), { align: 'right' });

    doc.moveTo(40, 95).lineTo(555, 95).strokeColor('#CFCFCF').stroke();

    doc.fillColor('#000000');
    doc.fontSize(12).font('Helvetica-Bold').text(safeText(empresa.razon_social || 'BATMAR'));
    doc.fontSize(10).font('Helvetica')
        .text(safeText(empresa.cif ? ('CIF: ' + empresa.cif) : ''))
        .text(safeText(empresa.direccion))
        .text(safeText([empresa.cp, empresa.poblacion].filter(Boolean).join(' ')))
        .text(safeText(empresa.provincia))
        .text(safeText(empresa.telefono ? ('Tel: ' + empresa.telefono) : ''))
        .text(safeText(empresa.email ? ('Email: ' + empresa.email) : ''))
        .text(safeText(empresa.web || ''));
}

function drawClientBox(doc, presupuesto) {
    const startY = 170;
    doc.roundedRect(40, startY, 515, 110, 6).strokeColor('#DADADA').stroke();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000').text('Cliente', 52, startY + 12);
    doc.fontSize(10).font('Helvetica')
        .text(safeText(presupuesto.cliente_nombre), 52, startY + 32)
        .text(safeText(presupuesto.cliente_cif ? ('CIF: ' + presupuesto.cliente_cif) : ''), 52)
        .text(safeText(presupuesto.cliente_direccion), 52)
        .text(safeText([presupuesto.cliente_cp, presupuesto.cliente_poblacion].filter(Boolean).join(' ')), 52)
        .text(safeText(presupuesto.cliente_provincia), 52)
        .text(safeText(presupuesto.cliente_codigo ? ('Codigo cliente: ' + presupuesto.cliente_codigo) : ''), 52);
}

function drawTableHeader(doc, y) {
    doc.rect(40, y, 515, 24).fill('#F4F4F4');
    doc.fillColor('#000000').fontSize(9).font('Helvetica-Bold');
    doc.text('Codigo', 46, y + 7, { width: 70 });
    doc.text('Descripcion', 120, y + 7, { width: 205 });
    doc.text('Cant.', 330, y + 7, { width: 45, align: 'right' });
    doc.text('Precio', 380, y + 7, { width: 70, align: 'right' });
    doc.text('Dto%', 455, y + 7, { width: 40, align: 'right' });
    doc.text('Importe', 498, y + 7, { width: 52, align: 'right' });
}

function drawLine(doc, line, y) {
    const cantidad = Number(line.cantidad || 0);
    const precio = Number(line.precio_unitario || 0);
    const dto = Number(line.dto_pct || 0);
    const importe = Number(line.importe_linea || 0);

    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(safeText(line.codigo), 46, y, { width: 70 });
    doc.text(safeText(line.descripcion), 120, y, { width: 205, ellipsis: true });
    doc.text(cantidad.toFixed(2), 330, y, { width: 45, align: 'right' });
    doc.text(toCurrency(precio), 380, y, { width: 70, align: 'right' });
    doc.text(dto.toFixed(2), 455, y, { width: 40, align: 'right' });
    doc.text(toCurrency(importe), 498, y, { width: 52, align: 'right' });
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

        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('error', (err) => {
            console.error('[quotes/generate-pdf] error pdf stream:', err && err.message ? err.message : err);
        });

        drawHeader(doc, empresa || {}, presupuesto);
        drawClientBox(doc, presupuesto);

        let y = 300;
        drawTableHeader(doc, y);
        y += 32;

        const lineas = Array.isArray(presupuesto.lineas) ? presupuesto.lineas : [];
        for (let i = 0; i < lineas.length; i++) {
            if (y > 740) {
                doc.addPage();
                y = 40;
                drawTableHeader(doc, y);
                y += 32;
            }
            drawLine(doc, lineas[i], y);
            y += 22;
        }

        y += 10;
        doc.moveTo(330, y).lineTo(555, y).strokeColor('#DADADA').stroke();
        y += 10;
        doc.fontSize(10).font('Helvetica').fillColor('#000000')
            .text('Subtotal:', 390, y, { width: 90, align: 'right' })
            .text(toCurrency(presupuesto.subtotal), 485, y, { width: 70, align: 'right' });
        y += 16;
        doc.text('IVA (21%):', 390, y, { width: 90, align: 'right' })
            .text(toCurrency(presupuesto.impuestos), 485, y, { width: 70, align: 'right' });
        y += 18;
        doc.font('Helvetica-Bold').fontSize(11)
            .text('TOTAL:', 390, y, { width: 90, align: 'right' })
            .text(toCurrency(presupuesto.total), 485, y, { width: 70, align: 'right' });

        const condiciones = safeText((empresa && empresa.condiciones_comerciales) || '');
        if (condiciones) {
            y += 36;
            doc.fontSize(10).font('Helvetica-Bold').text('Condiciones comerciales', 40, y);
            y += 16;
            doc.fontSize(9).font('Helvetica').text(condiciones, 40, y, { width: 515 });
        }

        doc.fontSize(8).fillColor('#444444')
            .text('Documento generado automaticamente por BATMAR', 40, 810, { align: 'center', width: 515 });

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
