# Gestion de activos de empresa

## Descripcion

Modulo para gestionar el mobiliario y equipamiento de la empresa (vehiculos, impresoras, ordenadores, telefonos, etc.). Inspirado en [Flora/APP_GESTION](../../Flora/APP_GESTION), adaptado a **scan_client_mobile** con Supabase y el login existente.

| Rol | Acceso |
|-----|--------|
| **ADMINISTRACION** | Panel Administracion: CRUD de activos, asignacion a trabajadores, eventos de mantenimiento |
| **DEPENDIENTE / COMERCIAL** | Herramientas > Mis activos: ver asignaciones y registrar uso diario del vehiculo |
| **ADMINISTRADOR** | Sin acceso (distinto de Administracion) |
| **CLIENTE** | Sin acceso (RLS) |

## Modelo de datos

### Tablas

| Tabla | Proposito |
|-------|-----------|
| `activos_categorias` | Catalogo extensible de tipos (`vehiculo`, `impresora`, `ordenador`, `telefono`) |
| `activos` | Ficha maestra: `nombre`, `identificador`, `estado`, `datos` (JSONB) |
| `activos_asignaciones` | Vinculo trabajador (`auth_uid`) con activo |
| `activos_registros` | Historial: uso diario vehiculo, eventos impresora/ordenador/telefono |

### Campos JSONB `datos` por categoria

**vehiculo**: `modelo`, `kilometraje_actual`, `fecha_itv`

**impresora**: `modelo`, `localizacion`, `contador_paginas`, `tipo_tinta`

**ordenador**: `modelo`, `numero_serie`, `procesador`, `ram_gb`, `almacenamiento`

**telefono**: `modelo`, `imei`, `operador`, `numero_linea`

## Migraciones

Ejecutar en Supabase SQL Editor en este orden:

1. `migration_activos_empresa_core.sql` — tablas, RLS, seed categorias, RPCs base
2. `migration_activos_vehiculo_rpc.sql` — uso vehiculo, eventos, listado admin

## Storage

Bucket **`activos-ficheros`** para facturas y adjuntos (crear manualmente en Dashboard > Storage, como `solicitudes-articulos-fotos`).

## RPCs principales

| RPC | Quien | Descripcion |
|-----|-------|-------------|
| `activos_get_conteos_categorias` | ADMINISTRACION | Conteos para hub admin |
| `activos_get_trabajadores_asignables` | ADMINISTRACION | DEPENDIENTE + COMERCIAL con auth |
| `activos_listar_por_categoria` | ADMINISTRACION | Listado con asignacion |
| `activos_asignar_trabajador` | ADMINISTRACION | Asignar / reasignar |
| `activos_desasignar` | ADMINISTRACION | Quitar asignacion |
| `activos_get_mis_activos` | Trabajador | Activos del JWT actual |
| `activos_registrar_uso_vehiculo` | Trabajador asignado / ADMINISTRACION | Km, litros, coste del dia |
| `activos_registrar_evento` | ADMINISTRACION | Eventos impresora/ordenador/telefono |

## Frontend

| Archivo | Rol |
|---------|-----|
| `js/activos.js` | Registro de categorias, UI admin y trabajador |
| `js/supabase.js` | Seccion `// --- Activos empresa ---` |
| `js/app.js` | Hooks en `initializeAppAdministracion`, `showScreen`, `showScreenAdmin` |
| `index.html` | Pantallas `#adminActivos*` y `#misActivos*` |
| `styles.css` | Clases `.activos-*` |

### Navegacion admin

Inicio Administracion > tarjeta **Activos de empresa** > hub por categoria > listado > detalle/formulario.

### Navegacion trabajador

Menu > Herramientas > **Mis activos** > detalle por categoria.

## Anadir una categoria nueva

1. `INSERT` en `activos_categorias` con `config` JSONB.
2. Registrar la categoria en `ACTIVOS_CATEGORIAS` dentro de `js/activos.js` (campos de formulario admin, pantalla trabajador).
3. Opcional: RPC especifica si la logica no cabe en `activos_registrar_evento`.

No es necesario alterar las tablas nucleo.

## Referencia Flora

Reglas de negocio detalladas (ITV, taller, journals multi-usuario): ver documentacion en `Flora/APP_GESTION/docs/`. El MVP de scan_client_mobile simplifica el modulo vehiculos a un registro diario por trabajador asignado.

## Relacion con Panel Administracion

Ver tambien [PANEL_ADMINISTRACION.md](PANEL_ADMINISTRACION.md).
