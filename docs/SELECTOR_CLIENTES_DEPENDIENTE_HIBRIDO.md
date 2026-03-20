# Selector de clientes para dependientes: estrategia híbrida local + Supabase

## Objetivo

En scan_client_mobile, el dependiente puede representar a cualquier cliente de su tienda. Cargar todos los clientes (A-Z) con un límite de 1000 no escala y no prioriza a los más usados. Este documento describe la estrategia para:

- **Velocidad local**: mostrar al instante los clientes que el dependiente más usa.
- **Cantidad en Supabase**: poder buscar cualquier cliente por texto (nombre, código, alias, población) sin límite de 1000.

## Implementación

- **Migración**: `migration_dependiente_cliente_uso.sql` (tabla `dependiente_cliente_uso` + 3 RPCs). Ejecutar en el SQL Editor de Supabase.
- **Frontend**: `js/supabase.js` (getClientesDependientePorFrecuencia, buscarClientesDependiente, registrarRepresentacionDependiente) y `js/app.js` (selector por frecuencia y búsqueda remota solo para dependientes; comerciales sin cambios).

## Limitaciones actuales (antes del cambio)

- `get_clientes_dependiente` devuelve todos los clientes del almacén del dependiente ordenados por `u.nombre` (A-Z). Sin límite en la función, pero en la práctica Supabase/cliente puede limitar resultados.
- El filtro actual es **solo en memoria**: si no hemos traído al cliente en esa carga, no aparece aunque exista en BD.
- No hay registro en BD de "este dependiente representó a este cliente", por lo que no se puede ordenar por uso sin añadir una tabla de uso.

## Enfoque híbrido

### 1. Backend (Supabase)

- **Tabla de uso**  
  `dependiente_cliente_uso (dependiente_user_id, cliente_user_id, veces_representado, ultima_representacion)`.  
  Un registro por par dependiente–cliente; al elegir "representar a X" se hace upsert: incrementar `veces_representado` y actualizar `ultima_representacion`.

- **RPC 1 – Lista por frecuencia (para cache local)**  
  `get_clientes_dependiente_por_frecuencia(p_dependiente_user_id, p_limit)`.  
  Misma base que clientes del dependiente (almacén, activos), LEFT JOIN con `dependiente_cliente_uso`, orden:  
  `veces_representado DESC NULLS LAST, ultima_representacion DESC NULLS LAST, nombre`.  
  LIMIT `p_limit` (ej. 200).  
  Uso: rellenar la "lista rápida" que se guarda en local.

- **RPC 2 – Búsqueda por texto (global)**  
  `buscar_clientes_dependiente(p_dependiente_user_id, p_query, p_limit)`.  
  El dependiente debe estar activo en `usuarios_dependientes`, pero la búsqueda se hace contra **todos los clientes activos** (no limitada al almacén de su tienda). **Cada palabra** de `p_query` (separada por espacios) debe aparecer en al menos uno de: nombre, código, alias, población (ILIKE por palabra). Ejemplos: "rafa olcina", "olci rafa" o "ol lli rafa" encuentran "JOSE RAFAEL OLCINA LLIN". Mismo orden por frecuencia y nombre, LIMIT (ej. 100).  
  Uso: cuando el usuario escribe en el buscador, consultar solo contra Supabase.

- **RPC 3 – Registrar representación**  
  `registrar_representacion_dependiente(p_dependiente_user_id, p_cliente_user_id)`.  
  Upsert en `dependiente_cliente_uso`: incrementar contador y poner `ultima_representacion = NOW()`.  
  Llamada al seleccionar un cliente (fire-and-forget desde la app).

### 2. Frontend (app)

- **Solo para dependientes** (comerciales siguen con su flujo actual).

- **Al abrir la pantalla "Representar a un cliente"**  
  - Llamar a `get_clientes_dependiente_por_frecuencia(dependiente_id, 200)` y guardar el resultado en memoria (y opcionalmente en IndexedDB con clave por `dependiente_user_id` y TTL, p. ej. 1–24 h).  
  - Mostrar esa lista de inmediato como "clientes frecuentes" (sin esperar a escribir en el buscador).  
  - Ventaja: primera pantalla rápida y ya ordenada de más a menos habitual.

- **Buscador (número, nombre, población)**  
  - Si el campo de búsqueda está **vacío**: mostrar solo la lista de frecuentes (la de memoria/IndexedDB).  
  - Si el usuario **escribe**: debounce ~300 ms y llamar a `buscar_clientes_dependiente(dependiente_id, query, 100)`.  
  - Mostrar los resultados de la búsqueda remota (sustituyen o se fusionan con los frecuentes según UX; recomendación: con texto escrito mostrar solo resultados de búsqueda para no confundir).  
  - Ventaja: se puede encontrar a **cualquier** cliente activo de la base de datos, aunque pertenezca a otro almacén.

- **Al seleccionar un cliente**  
  - Llamar a `registrar_representacion_dependiente(dependiente_id, cliente_id)` en segundo plano (no bloquear navegación).  
  - Seguir con el flujo actual: guardar en sesión, ir al carrito, etc.

### 3. Resumen de ventajas

| Aspecto | Cómo se resuelve |
|--------|-------------------|
| Velocidad | Lista de frecuentes en memoria (y opcional IndexedDB); primera carga con una sola RPC acotada (ej. 200). |
| Cantidad | Búsqueda bajo demanda en Supabase; sin límite global de 1000 en la lista inicial. |
| Orden útil | Más habituales primero (tabla de uso + RPCs ordenados por frecuencia y última representación). |
| Consistencia | La tabla de uso se actualiza en cada selección; el ranking se calcula siempre en el servidor. |

## Documentos relacionados

- `migration_dependiente_cliente_uso.sql`: tabla de uso y RPCs por frecuencia/búsqueda/registro.
- `migration_dependientes_tienda.sql`: definición de `get_clientes_dependiente` (sin uso, se mantiene por compatibilidad).
- `FLUJO_CODIGO_CLIENTE_AL_ENVIAR_PEDIDO.md`: flujo de representación y envío de pedido.
