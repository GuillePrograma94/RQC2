# Generar Albaran y Generar Pedido (staff tienda)

Flujo para **dependiente** y **administrador** en el carrito de `scan_client_mobile`, ejecutado preferentemente desde **TiendaPC.exe**.

## Roles

| Rol | Generar Pedido (REMOTO) | Generar Albaran (PRESENCIAL) |
|-----|-------------------------|------------------------------|
| Dependiente | Si (Imprimir / sin imprimir) | Si |
| Administrador | Si (Imprimir / sin imprimir) | Si |
| Comercial | Enviar Pedido normal | No |
| Cliente / operario | Enviar Pedido normal | No |

## Botones en el carrito

- **Generar Pedido** (antes "Enviar Pedido"): abre modal con *Imprimir Pedido* y *Generar sin imprimir* (tipo ERP `REMOTO`).
- **Generar Albaran**: abre modal con *Imprimir Albaran* (2 copias sin firma) y *Firmar Albaran* (canvas + 1 copia firmada).

Ambos requieren **cliente representado** (selector de clientes).

## Almacen destino staff

- **Dependiente:** `almacen_tienda` del usuario.
- **Administrador:** `almacen_habitual` del cliente representado (o del admin si no representa).

## TiendaPC.exe

El albaran presencial **solo** funciona con TiendaPC (pywebview + `window.pywebview.api`):

- `check_albaran_pdf_ready`
- `apply_albaran_signature`
- `print_albaran_default(albaran, copies)` — impresora predeterminada Windows

Configuracion: `tienda_config.json` junto al exe (`app_url`, `albaran_pdf_base_path`, `albaran_firma`).

## Supabase

Migraciones (aplicar en SQL Editor):

1. `migration_crear_pedido_presencial_tienda.sql` — RPC `crear_pedido_presencial_tienda`
2. `migration_carrito_albaran_erp.sql` — columna `carritos_clientes.albaran_erp`

## ERP

Payload via proxy existente `/api/erp/pedidos`:

- REMOTO: `tipo: 'REMOTO'` (pedido staff remoto)
- PRESENCIAL: `tipo: 'PRESENCIAL'` (albaran tienda)

Respuesta esperada: `pedido` y `albaran` en el cuerpo (mismo criterio que checkout_pc).

## Matriz de comportamiento

| Accion | Tipo ERP | Supabase RPC | Impresion |
|--------|----------|--------------|-----------|
| Imprimir Pedido | REMOTO | `crear_pedido_remoto` | checkout_pc remoto |
| Generar sin imprimir | REMOTO | `crear_pedido_remoto_sin_imprimir` | ninguna |
| Imprimir Albaran | PRESENCIAL | `crear_pedido_presencial_tienda` | TiendaPC x2 sin firma |
| Firmar Albaran | PRESENCIAL | idem | firma + TiendaPC x1 |
