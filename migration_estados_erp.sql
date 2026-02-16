-- Migracion: Estados unificados de pedidos (estado y estado_procesamiento)
-- Segun docs/ESTADOS_PEDIDOS_ESCENARIOS.md
-- estado: activo, enviado, en_preparacion, cancelado, completado
-- estado_procesamiento: pendiente, pendiente_erp, error_erp, procesando, completado

ALTER TABLE carritos_clientes
DROP CONSTRAINT IF EXISTS carritos_clientes_estado_check;

ALTER TABLE carritos_clientes
ADD CONSTRAINT carritos_clientes_estado_check
CHECK (estado IN (
    'activo',
    'enviado',
    'en_preparacion',
    'cancelado',
    'completado'
));

ALTER TABLE carritos_clientes
DROP CONSTRAINT IF EXISTS carritos_clientes_estado_procesamiento_check;

ALTER TABLE carritos_clientes
ADD CONSTRAINT carritos_clientes_estado_procesamiento_check
CHECK (estado_procesamiento IN (
    'pendiente',
    'pendiente_erp',
    'error_erp',
    'procesando',
    'completado'
));

DO $$
BEGIN
    RAISE NOTICE 'Estados actualizados: estado (activo, enviado, en_preparacion, cancelado, completado); estado_procesamiento (pendiente, pendiente_erp, error_erp, procesando, completado)';
END $$;
