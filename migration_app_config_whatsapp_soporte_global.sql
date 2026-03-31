-- Configuracion global de la app para soporte tecnico.
-- El WhatsApp de soporte no depende de empresa ni de almacen.

CREATE TABLE IF NOT EXISTS app_config_global (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    whatsapp_soporte_errores TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config_global (id, whatsapp_soporte_errores)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

