# Análisis: Configurador WC Completo (modelo de datos y flujo)

Objetivo: permitir al cliente elegir un **conjunto** (modelo de WC Completo) y, dentro de ese conjunto, elegir **taza**, **tanque** y **asiento** compatibles; luego poder pedir el conjunto completo o piezas sueltas.

---

## 1. Dominio

- **WC** = Taza + Tanque + Asiento.
- **Conjunto (WC Completo)** = modelo/kit con nombre; agrupa varias **tazas**, varios **tanques** y varios **asientos** que son compatibles entre sí.
- Una misma **taza** puede ser compatible con varios tanques y varios asientos (y puede aparecer en varios conjuntos).
- **Un mismo artículo (producto) puede ser compatible con múltiples conjuntos**: por ejemplo, una taza concreta puede estar en el conjunto "Serie X" y también en "Comfort Plus". La relación es muchos-a-muchos (conjunto ↔ producto) por tipo de pieza.
- La compatibilidad la fijamos **por conjunto**: todo lo que pertenece al mismo conjunto es compatible.

Flujo de uso deseado:
1. Desplegable: **Seleccionar conjunto** (ej. "Serie X", "Comfort Plus").
2. Desplegable: **Taza** (solo las del conjunto).
3. Desplegable: **Tanque** (solo los del conjunto).
4. Desplegable: **Asiento** (solo los del conjunto).
5. Acción: **Pedir todo junto** (taza + tanque + asiento como una o varias líneas) o **piezas sueltas** del conjunto.

Los ítems (taza, tanque, asiento) son **productos** del catálogo actual (`productos`: codigo, descripcion, pvp, etc.). El backend solo añade tablas que relacionan conjuntos con productos y el tipo de pieza.

---

## 2. Opciones de modelo de datos

### Opción A: Conjunto como “contenedor” de opciones (recomendada)

La compatibilidad se define **por conjunto**. Cada conjunto tiene tres listas: tazas, tanques, asientos. Todo lo que está en el mismo conjunto es compatible.

**Tablas:**

| Tabla | Descripción |
|-------|-------------|
| `wc_conjuntos` | Conjuntos (modelos de WC Completo). id, nombre, codigo (opcional), descripcion (opcional), orden (para ordenar en el desplegable), activo. |
| `wc_conjunto_tazas` | Relación muchos-a-muchos conjunto ↔ taza. conjunto_id (FK), producto_id (FK a productos). **Un mismo producto puede aparecer en varios conjuntos** (varias filas con distinto conjunto_id). |
| `wc_conjunto_tanques` | Igual: conjunto_id, producto_id. Un tanque puede pertenecer a varios conjuntos. |
| `wc_conjunto_asientos` | Igual: conjunto_id, producto_id. Un asiento puede pertenecer a varios conjuntos. |

**Ventajas:**
- Fácil de entender y mantener.
- El front solo pide: “dame conjuntos”, “dame tazas/tanques/asientos de este conjunto”.
- Añadir o quitar una pieza de un conjunto es un insert/delete en la tabla correspondiente.
- No hace falta modelar compatibilidad taza↔tanque↔asiento a nivel de productos; el conjunto ya implica “estos son compatibles”.

**Desventajas:**
- Ninguna relevante: que un artículo esté en varios conjuntos es natural (varias filas con el mismo producto_id y distinto conjunto_id).

---

### Opción B: Compatibilidad entre productos (más flexible, más compleja)

Se modelan relaciones del tipo “esta taza es compatible con estos tanques y estos asientos”.

**Tablas (ejemplo):**
- `wc_tazas`: producto_id (FK), nombre_corto (opcional).
- `wc_tanques`: producto_id.
- `wc_asientos`: producto_id.
- `wc_compatibilidad_taza_tanque`: taza_id (producto_id), tanque_id (producto_id).
- `wc_compatibilidad_taza_asiento`: taza_id, asiento_id.
- `wc_conjuntos`: id, nombre, … (opcional: conjuntos como “presets” de una taza+tanque+asiento).

**Ventajas:** Máxima flexibilidad; se puede permitir “elegir taza primero” y luego filtrar tanques/asientos compatibles sin definir conjuntos.

**Desventajas:** Más tablas, más lógica en backend y front, y tu flujo actual es “primero conjunto, luego piezas”, por lo que la complejidad no compensa de inicio.

---

### Opción C: Conjunto = un solo “kit” por conjunto

Cada conjunto tiene **una** taza, **un** tanque y **un** asiento (producto_id para cada uno). No hay elección dentro del conjunto.

**Tabla:** `wc_conjuntos` con columnas: id, nombre, producto_taza_id, producto_tanque_id, producto_asiento_id.

**Ventajas:** Muy simple.

**Desventajas:** No permite “elegir entre varias tazas/tanques/asientos del mismo conjunto”, que es lo que pides.

---

## 3. Recomendación: Opción A

- Encaja con el flujo: desplegable conjunto → desplegables taza / tanque / asiento.
- Pocas tablas y consultas claras.
- Las piezas siguen siendo productos del catálogo; solo añadimos relaciones “pertenece a este conjunto” por tipo.

---

## 4. Modelo detallado (Opción A)

### 4.1 Supuesto sobre `productos`

Se asume que en Supabase existe (o existirá) una tabla **productos** con al menos:
- `id` (PK, por ejemplo UUID o bigint).
- `codigo` (código de artículo, único).
- `descripcion`, `pvp`, etc.

Las tablas WC referencian productos por `producto_id` (FK a `productos.id`). Si en tu sistema el identificador estable es `codigo`, se puede usar `producto_codigo` (VARCHAR) como FK lógica; las consultas seguirían igual. **Un mismo producto puede tener varias filas** (una por cada conjunto en que participa) en `wc_conjunto_tazas`, `wc_conjunto_tanques` o `wc_conjunto_asientos`.

### 4.2 Tablas

```sql
-- Conjuntos (modelos de WC Completo)
CREATE TABLE wc_conjuntos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    codigo TEXT,
    descripcion TEXT,
    orden INT NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tazas disponibles por conjunto (producto = ítem del catálogo)
CREATE TABLE wc_conjunto_tazas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conjunto_id UUID NOT NULL REFERENCES wc_conjuntos(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL,  -- REFERENCES productos(id) si existe
    -- Alternativa si no hay productos.id: producto_codigo TEXT NOT NULL,
    orden INT NOT NULL DEFAULT 0,
    UNIQUE(conjunto_id, producto_id)
);

-- Tanques disponibles por conjunto
CREATE TABLE wc_conjunto_tanques (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conjunto_id UUID NOT NULL REFERENCES wc_conjuntos(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL,
    orden INT NOT NULL DEFAULT 0,
    UNIQUE(conjunto_id, producto_id)
);

-- Asientos disponibles por conjunto
CREATE TABLE wc_conjunto_asientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conjunto_id UUID NOT NULL REFERENCES wc_conjuntos(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL,
    orden INT NOT NULL DEFAULT 0,
    UNIQUE(conjunto_id, producto_id)
);

-- Índices para listar por conjunto
CREATE INDEX idx_wc_ct_conjunto ON wc_conjunto_tazas(conjunto_id);
CREATE INDEX idx_wc_ctan_conjunto ON wc_conjunto_tanques(conjunto_id);
CREATE INDEX idx_wc_ca_conjunto ON wc_conjunto_asientos(conjunto_id);
```

Si en tu base **no** hay `productos.id` y solo usáis `codigo`:
- Sustituir `producto_id UUID` por `producto_codigo TEXT NOT NULL`.
- Mantener `UNIQUE(conjunto_id, producto_codigo)` en cada tabla de partes.
- En las consultas, hacer JOIN con `productos` por `productos.codigo = wc_conjunto_*.producto_codigo`.

### 4.3 Consultas típicas (backend / RPC)

1. **Listar conjuntos** (para el primer desplegable):
   - `SELECT * FROM wc_conjuntos WHERE activo = true ORDER BY orden, nombre`.

2. **Tazas de un conjunto** (con datos de producto para mostrar nombre, precio):
   - `SELECT p.id, p.codigo, p.descripcion, p.pvp FROM wc_conjunto_tazas ct JOIN productos p ON p.id = ct.producto_id WHERE ct.conjunto_id = $1 ORDER BY ct.orden, p.descripcion`.
   - Si usas `producto_codigo`: `JOIN productos p ON p.codigo = ct.producto_codigo`.

3. **Tanques de un conjunto**: misma idea con `wc_conjunto_tanques`.

4. **Asientos de un conjunto**: misma idea con `wc_conjunto_asientos`.

Con eso el front puede rellenar los cuatro desplegables (conjunto, taza, tanque, asiento) y tener los `producto_id`/`codigo` para añadir al carrito.

---

## 5. Flujo en frontend (resumen)

1. **Pantalla Herramientas → WC Completo**  
   - Cargar lista de conjuntos → desplegable “Conjunto”.
2. **Al elegir conjunto**  
   - Cargar tazas, tanques y asientos de ese conjunto → tres desplegables.
3. **Valores por defecto (opcional)**  
   - Si el conjunto tiene una sola taza/tanque/asiento, preseleccionarlos.
4. **Al tener selección completa (conjunto + taza + tanque + asiento)**  
   - Botón tipo “Añadir WC completo al carrito”: añadir 3 líneas (taza, tanque, asiento) con cantidades indicadas (ej. 1 cada una).  
   - Botón tipo “Añadir piezas sueltas” o checkboxes: que el usuario marque qué piezas quiere y cantidades, y se añadan solo esas al carrito.

El carrito sigue usando los mismos productos (mismo `codigo` / `producto_id`) que ya usas hoy; el configurador solo ayuda a elegir qué productos y en qué combinación añadir.

---

## 6. Resumen de tablas a crear (backend)

| Tabla | Uso |
|-------|-----|
| `wc_conjuntos` | Modelos de WC Completo (nombre, codigo, orden, activo). |
| `wc_conjunto_tazas` | Relación conjunto ↔ producto (taza). |
| `wc_conjunto_tanques` | Relación conjunto ↔ producto (tanque). |
| `wc_conjunto_asientos` | Relación conjunto ↔ producto (asiento). |

Referencia a productos: por `producto_id` (FK a `productos.id`) o por `producto_codigo` (FK lógica a `productos.codigo`), según tengáis en vuestra base.

Cuando tengáis definido si en Supabase usáis `productos.id` o solo `productos.codigo`, se puede bajar esto a un `migration_*.sql` concreto y a los endpoints o RPC que expongáis para el scan_client_mobile.

---

## 7. Rol Administrador (acceso a herramientas y configuración WC)

Además de **Cliente** y **Comercial**, se añade el rol **Administrador**. Solo el administrador debe poder acceder a herramientas como la configuración de conjuntos WC (crear/editar/eliminar conjuntos y sus tazas, tanques y asientos).

### 7.1 Dónde vive el administrador

- **Clientes**: tabla `usuarios` (login con `verificar_login_usuario`).
- **Comerciales**: tabla `usuarios_comerciales` (login con `verificar_login_comercial`).
- **Administradores**: misma tabla **`usuarios`**, diferenciados por un **tipo de usuario** (columna `tipo`).

La columna `tipo` en `usuarios` admite los valores que ya existian (`'CLIENTE'`, `'COMERCIAL'`) y se añade `'ADMINISTRADOR'`. Un usuario con `tipo = 'ADMINISTRADOR'` entra con el mismo flujo que un cliente (código + contraseña contra `usuarios`) y el backend devuelve `es_administrador: true` para que el front y las políticas de seguridad lo traten como admin.

### 7.2 Cambios en base de datos

1. **Columna `usuarios.tipo`**  
   - Valores: `'CLIENTE'`, `'COMERCIAL'`, `'ADMINISTRADOR'` (CLIENTE y COMERCIAL ya existian; se añade ADMINISTRADOR).  
   - Por defecto `'CLIENTE'`.  
   - Quien tenga `tipo = 'ADMINISTRADOR'` es el único que puede modificar datos de herramientas (p. ej. WC).

2. **Función `verificar_login_usuario`**  
   - Debe devolver también el `tipo` (o un booleano `es_administrador`) para que el API de login lo incluya en la respuesta y en el JWT (p. ej. en `app_metadata`).

3. **RLS en tablas WC**  
   - **SELECT** en `wc_conjuntos`, `wc_conjunto_tazas`, `wc_conjunto_tanques`, `wc_conjunto_asientos`: permitido a usuarios autenticados (o anon si el configurador es público) para que el configurador pueda leer conjuntos y opciones.  
   - **INSERT / UPDATE / DELETE**: solo si el JWT indica que es administrador (p. ej. `auth.jwt() -> 'app_metadata' ->> 'es_administrador' = 'true'`) o usando **service_role** (panel/API de administración en backend).

### 7.3 Login y JWT (backend / API)

- Tras validar con `verificar_login_usuario`, el API de login debe:
  - Leer `tipo` (o derivar `es_administrador = (tipo = 'ADMINISTRADOR')`) de la fila de `usuarios`.
  - Incluir en la respuesta al cliente: `es_administrador: true/false` (y opcionalmente `tipo`).
  - Al crear o actualizar el usuario en Supabase Auth, escribir en **app_metadata** algo como:  
    `app_metadata: { usuario_id: userId, es_administrador: true }` cuando sea administrador, para que el JWT lleve ese dato y las RLS puedan restringir escritura en tablas WC.

### 7.4 Frontend (scan_client_mobile)

- **Menú**: **Herramientas** se muestra a todos los usuarios autenticados (clientes, comerciales, administradores). Dentro de Herramientas está **WC Completo**, accesible para todos. **Panel de Control** es un botón distinto en el menú, visible solo si `es_administrador === true`; ahí irán las acciones exclusivas del administrador (p. ej. configurar conjuntos WC).
- **Dentro de Herramientas**: **WC Completo** con UX orientada a conversion: pasos 1-4 (Modelo, Taza, Tanque, Asiento); cards con imagen de producto (SKU -> URL imagen), descripcion y PVP; seleccion visual (card seleccionada); resumen con miniaturas y total antes de anadir; datos de producto desde IndexedDB (getProductByCodigo) para descripcion y precio.
- **Dentro de Panel de Control** (solo administrador): **Configurar conjuntos WC** implementado: boton abre lista de conjuntos; Nuevo conjunto / Editar / Eliminar; en detalle se editan nombre, codigo, descripcion, orden, activo y se gestionan tazas, tanques y asientos por codigo de producto (anadir/quitar). CRUD usa Supabase con JWT de admin; RLS restringe escritura a es_administrador.

### 7.5 Resumen de implementación

| Ámbito | Cambio |
|--------|--------|
| **BD** | Columna `usuarios.tipo` ('CLIENTE' \| 'COMERCIAL' \| 'ADMINISTRADOR'); RLS en tablas `wc_*` (lectura amplia, escritura solo admin o service_role). |
| **RPC** | `verificar_login_usuario` devuelve `tipo` o `es_administrador`. |
| **API login** | Respuesta con `es_administrador`; app_metadata del Auth con `es_administrador` para el JWT. |
| **Front** | Herramientas (y WC Completo) visibles para todos; boton Panel de Control solo si es_administrador; dentro del Panel, Configurar conjuntos WC y demas herramientas de admin. |
