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


| Tabla                  | Descripción                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wc_conjuntos`         | Conjuntos (modelos de WC Completo). id, nombre, codigo (opcional), descripcion (opcional), orden (para ordenar en el desplegable), activo.                                                  |
| `wc_conjunto_tazas`    | Relación muchos-a-muchos conjunto ↔ taza. conjunto_id (FK), producto_id (FK a productos). **Un mismo producto puede aparecer en varios conjuntos** (varias filas con distinto conjunto_id). |
| `wc_conjunto_tanques`  | Igual: conjunto_id, producto_id. Un tanque puede pertenecer a varios conjuntos.                                                                                                             |
| `wc_conjunto_asientos` | Igual: conjunto_id, producto_id. Un asiento puede pertenecer a varios conjuntos.                                                                                                            |


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


| Tabla                  | Uso                                                     |
| ---------------------- | ------------------------------------------------------- |
| `wc_conjuntos`         | Modelos de WC Completo (nombre, codigo, orden, activo). |
| `wc_conjunto_tazas`    | Relación conjunto ↔ producto (taza).                    |
| `wc_conjunto_tanques`  | Relación conjunto ↔ producto (tanque).                  |
| `wc_conjunto_asientos` | Relación conjunto ↔ producto (asiento).                 |


Referencia a productos: por `producto_id` (FK a `productos.id`) o por `producto_codigo` (FK lógica a `productos.codigo`), según tengáis en vuestra base.

Cuando tengáis definido si en Supabase usáis `productos.id` o solo `productos.codigo`, se puede bajar esto a un `migration_*.sql` concreto y a los endpoints o RPC que expongáis para el scan_client_mobile.

---

## 7. Rol Administrador (acceso a herramientas y configuración WC)

Además de **Cliente** y **Comercial**, se añade el rol **Administrador**. Solo el administrador debe poder acceder a herramientas como la configuración de conjuntos WC (crear/editar/eliminar conjuntos y sus tazas, tanques y asientos).

### 7.1 Dónde vive el administrador

- **Clientes**: tabla `usuarios` (login con `verificar_login_usuario`).
- **Comerciales**: tabla `usuarios_comerciales` (login con `verificar_login_comercial`).
- **Administradores**: misma tabla `**usuarios`**, diferenciados por un **tipo de usuario** (columna `tipo`).

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


| Ámbito        | Cambio                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BD**        | Columna `usuarios.tipo` ('CLIENTE' | 'COMERCIAL' | 'ADMINISTRADOR'); RLS en tablas `wc_*` (lectura amplia, escritura solo admin o service_role).                            |
| **RPC**       | `verificar_login_usuario` devuelve `tipo` o `es_administrador`.                                                                                                             |
| **API login** | Respuesta con `es_administrador`; app_metadata del Auth con `es_administrador` para el JWT.                                                                                 |
| **Front**     | Herramientas (y WC Completo) visibles para todos; boton Panel de Control solo si es_administrador; dentro del Panel, Configurar conjuntos WC y demas herramientas de admin. |


---

## 8. Mejoras de usabilidad y datos (muchas opciones, imagenes por grupo, subgrupos)

Analisis de como hacer mas facil de usar el configurador cuando hay muchos conjuntos u opciones, y de las opciones de imagenes por grupo y subgrupos.

### 8.1 Situacion actual

- **Paso 1 (Modelo)**: lista de conjuntos en grid de cards; cada card tiene icono generico (cuadro gris), nombre y descripcion corta. No hay imagen por conjunto.
- **Pasos 2-4 (Taza, Tanque, Asiento)**: cards con imagen de producto (URL por codigo: `saneamiento-martinez.com/.../CODIGO_1.JPG`), descripcion y PVP. Los datos de producto vienen de IndexedDB (`getProductByCodigo`).
- Los grids usan `repeat(auto-fill, minmax(160px/140px, 1fr))`; la pantalla hace scroll natural. Con muchos items la pagina se alarga y puede costar encontrar una opcion concreta.

### 8.2 Hacer mas facil de usar con muchas opciones


| Medida                            | Descripcion                                                                                                                                                                         | Esfuerzo                                     | Recomendacion                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Busqueda / filtro por texto**   | Campo de busqueda encima de cada paso (conjuntos, tazas, tanques, asientos) que filtre en cliente por nombre/descripcion/codigo.                                                    | Bajo (solo front, filtrar array ya cargado). | Muy recomendable cuando hay mas de ~8-10 opciones por paso.                                                          |
| **Desplegable alternativo**       | Ademas de (o en lugar de) grid de cards, ofrecer un `<select>` por paso para elegir por nombre. Util en movil para listas largas.                                                   | Bajo.                                        | Opcion complementaria: modo "lista" vs "grid" o solo select cuando hay mas de N opciones.                            |
| **Scroll por seccion con anclas** | Mantener los 4 pasos pero que cada bloque (conjuntos, tazas, tanques, asientos) tenga `max-height` y scroll interno, o que al elegir conjunto la vista haga scroll suave al paso 2. | Bajo (CSS + scrollIntoView).                 | Recomendable para no tener una pagina infinita.                                                                      |
| **Lazy loading / paginacion**     | Cargar solo los primeros N conjuntos (o productos) y "Ver mas" o scroll infinito.                                                                                                   | Medio (paginacion en Supabase o en cliente). | Considerar si hay decenas de conjuntos o cientos de productos por tipo; si son decenas, filtro suele ser suficiente. |
| **Orden y agrupacion en BD**      | Asegurar que `orden` en `wc_conjuntos` y en las tablas de piezas este bien usado (ya se usa en las consultas). Agrupar conjuntos por "familia" si se introduce subgrupos (ver 8.4). | Bajo (solo datos).                           | Mantener siempre.                                                                                                    |


Implementacion practica sugerida para "muchas opciones":

1. Anadir un input de busqueda encima de cada grid (paso 1 y, al elegir conjunto, pasos 2-4). Filtrar en cliente sobre la lista ya cargada (por `nombre`, `descripcion`, `codigo` segun el paso).
2. Opcional: limitar altura del grid con scroll (por ejemplo `max-height: 280px; overflow-y: auto` en `.wc-completo-grid`) para que la pantalla no sea interminable.
3. Opcional: al seleccionar un conjunto, hacer `scrollIntoView({ behavior: 'smooth' })` del paso "Taza" para guiar al usuario.

### 8.3 Imagenes por grupo (conjunto)

Hoy los **conjuntos** no tienen imagen; solo un icono generico. Las **piezas** (taza/tanque/asiento) ya tienen imagen por codigo de producto (URL externa).

Opciones para tener imagen por conjunto (grupo):


| Opcion                   | Descripcion                                                                                                                                                                                                                                                                   | Pros                                                                               | Contras                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **A. GitHub como CDN**   | Repositorio con carpeta `wc-conjuntos/` y una imagen por conjunto (p. ej. `{conjunto_id}.jpg` o `{codigo}.jpg`). URL tipo `https://raw.githubusercontent.com/ORG/REPO/main/wc-conjuntos/xxx.jpg`. En BD: campo `imagen_url` en `wc_conjuntos` o convencion por `codigo`/`id`. | Versionado con el codigo, sin coste de hosting, facil de actualizar con PR.        | Raw URLs pueden tener limites de ancho de banda/cache; no es un CDN profesional; requiere actualizar repo para cambiar imagen. |
| **B. Supabase Storage**  | Bucket `wc-conjuntos`, un archivo por conjunto. `wc_conjuntos.imagen_url` apunta a la URL publica del Storage.                                                                                                                                                                | Integrado con el proyecto, control de acceso si se necesita, buena disponibilidad. | Requiere subir imagenes desde Panel de Control o script; algo mas de configuracion.                                            |
| **C. URL externa en BD** | Columna `imagen_url` en `wc_conjuntos`; el admin escribe la URL (puede ser GitHub raw, Imgur, su propio servidor, etc.).                                                                                                                                                      | Maxima flexibilidad, sin cambios de infra si ya tienen hosting de imagenes.        | Depende de que el admin rellene URLs correctas.                                                                                |


Recomendacion:

- **Si quereis tener las imagenes en GitHub** (versionadas con el proyecto): usar **Opcion A** con convencion de nombre. Por ejemplo:
  - En el repo: carpeta `scan_client_mobile/assets/wc-conjuntos/` con archivos nombrados por `codigo` del conjunto (ej. `serie-x.jpg`) o por `id` si es estable.
  - Base URL en el front: `https://raw.githubusercontent.com/ORG/LABELSPRODUCTOS/main/scan_client_mobile/assets/wc-conjuntos/` (o la ruta que useis).
  - Si el conjunto tiene `codigo`: imagen = `baseUrl + codigo + '.jpg'` (con fallback a placeholder si falla). Si no tiene codigo, usar `imagen_url` de la BD cuando exista.
- Anadir en `wc_conjuntos` una columna opcional `**imagen_url`** (TEXT, nullable) para poder sobrescribir la convencion (p. ej. enlace a Supabase Storage o a otra URL) sin dejar de soportar la convencion por codigo.

Pasos concretos:

1. **Backend**: migration que anada `imagen_url TEXT` a `wc_conjuntos` (nullable). Actualizar create/update en Supabase (y Panel de Control) para leer/escribir `imagen_url`.
2. **GitHub**: crear carpeta en el repo (ej. `scan_client_mobile/assets/wc-conjuntos/`) y subir una imagen por conjunto con nombre = `codigo` del conjunto (ej. `serie-x.jpg`). Documentar en README o en docs la convencion.
3. **Frontend**: en `renderWcCompletoScreen`, para cada conjunto calcular URL de imagen: si tiene `imagen_url` usarla; si no, `baseUrl + (codigo || id) + '.jpg'`. Mostrar `<img>` en la card del conjunto (sustituyendo o complementando el icono). Manejar `onerror` con placeholder.

### 8.4 Subgrupos de conjuntos

**Idea**: agrupar conjuntos en "familias" (ej. "Serie Clasica", "Serie Moderna") para que en el paso 1 primero se elija familia y luego el conjunto dentro de ella.

**Cuando compensa**: cuando hay muchos conjuntos (por ejemplo mas de 10-15) y tienen una agrupacion logica (marca, linea, tipo). Con pocos conjuntos, un filtro de texto suele ser suficiente.

**Modelo de datos**:

- **Opcion 1 (recomendada)**: tabla `wc_grupos` (id, nombre, orden) y en `wc_conjuntos` anadir `grupo_id` (FK a `wc_grupos`, nullable). Conjuntos con `grupo_id` null se muestran en "Sin grupo" o directamente en la lista principal.
- **Opcion 2**: no crear tabla; usar un prefijo en el nombre o un campo `familia` (TEXT) en `wc_conjuntos` y agrupar en front por ese campo.

Ventaja de Opcion 1: orden explicito de grupos y de conjuntos dentro de grupo; el Panel de Control puede gestionar grupos (CRUD) y asignar conjuntos a grupo. Ventaja de Opcion 2: menos tablas y migraciones; suficiente si la agrupacion es solo visual por texto.

Flujo en frontend con subgrupos (Opcion 1):

1. Cargar grupos (ordenados por `orden`) y conjuntos por grupo.
2. Paso 1: mostrar primero lista de **grupos** (o "Todos" si se quiere). Al elegir grupo, mostrar solo conjuntos de ese grupo en el grid (o en un segundo nivel). Alternativa: mostrar conjuntos agrupados por grupo con un titulo de seccion por grupo.

Implementacion sugerida: introducir subgrupos solo cuando el numero de conjuntos lo justifique (p. ej. > 12-15). Hasta entonces, priorizar busqueda/filtro e imagenes por conjunto.

### 8.5 Resumen de prioridades


| Prioridad | Mejora                               | Accion                                                                                                                         |
| --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Alta      | Imagenes por conjunto                | Anadir `imagen_url` en `wc_conjuntos`; carpeta en repo con imagenes por codigo; front que muestre imagen en card con fallback. |
| Alta      | Usabilidad con muchas opciones       | Filtro de busqueda por paso (conjuntos y, al elegir conjunto, tazas/tanques/asientos); opcional scroll interno o anclas.       |
| Media     | Subgrupos                            | Solo si hay muchos conjuntos; tabla `wc_grupos` + `grupo_id` en `wc_conjuntos` y UI en dos niveles (grupo -> conjunto).        |
| Baja      | Desplegable alternativo / paginacion | Si tras filtro aun se necesita; puede ser modo lista o select para movil.                                                      |

---

## 9. Implementado: filtros por tipo de instalacion, adosado a pared, grid 2 columnas y carpeta assets

### 9.1 Campos en `wc_conjuntos` para filtrar

- **tipo_instalacion** (TEXT, nullable): valores `TANQUE_ALTO`, `TANQUE_BAJO`, `SUSPENDIDO`. Null = sin especificar (aparece con filtro "Todos").
- **adosado_pared** (BOOLEAN, default false): si el conjunto es adosado a pared.

Migracion: `migration_wc_conjuntos_filtros.sql` (en la raiz del proyecto). Ejecutar en Supabase despues de `migration_wc_conjuntos.sql`.

### 9.2 Panel de Control

En el formulario de crear/editar conjunto se anadieron:

- **Tipo de instalacion**: desplegable (Sin especificar, Tanque Alto, Tanque Bajo, Suspendido).
- **Adosado a pared**: checkbox.

Al guardar se persisten en Supabase junto con nombre, codigo, descripcion, orden y activo.

### 9.3 Herramientas WC Completo (paso 1 – Modelo de WC)

- **Grid de conjuntos**: siempre **dos columnas** (`repeat(2, 1fr)`), dos conjuntos por fila para ver mas con menos espacio.
- **Filtros** encima del grid:
  - **Tipo instalacion**: Todos | Tanque Alto | Tanque Bajo | Suspendido.
  - **Adosado a pared**: Todos | Si | No.
- La lista de conjuntos se filtra en cliente segun los valores seleccionados; al cambiar un filtro se re-renderiza solo el grid (sin volver a cargar datos).

### 9.4 Carpeta de imagenes de conjuntos

- **Ruta**: `scan_client_mobile/assets/` y subcarpeta `scan_client_mobile/assets/wc-conjuntos/`.
- Uso previsto: subir imagenes de cada conjunto (nombre = codigo del conjunto, ej. `serie-comfort.jpg`) para mostrarlas en las cards del paso 1 cuando se implemente la carga de imagen por conjunto (seccion 8.3).
- En la carpeta hay un `README.md` con la convencion de nombres.

---

## 10. Detalle de producto: "Parte de conjunto completo"

En la **ventana de añadir al carrito** (modal que se abre al pulsar sobre un articulo escaneado o buscado, antes del overlay con el carousel de imagenes) se muestra, cuando el articulo forma parte de uno o mas conjuntos WC completos:

- **Titulo**: "Parte de conjunto completo".
- **Labels clicables**: uno por cada conjunto (activo) en el que participa el producto (como taza, tanque o asiento). Un mismo articulo puede estar en varios conjuntos; en ese caso se muestran varios labels.

Al pulsar un label se cierra el modal de añadir al carrito, se navega a **Herramientas > WC Completo** y se preselecciona ese conjunto (cargando sus tazas, tanques y asientos).

- **Backend**: `getWcConjuntosByProductoCodigo(productoCodigo)` en `supabase.js` consulta `wc_conjunto_tazas`, `wc_conjunto_tanques` y `wc_conjunto_asientos` por `producto_codigo`, obtiene los `conjunto_id` distintos y devuelve los `wc_conjuntos` activos ordenados.
- **Frontend**: bloque `#addToCartWcConjuntos` en el modal de añadir al carrito (`#addToCartModal`); se rellena en `showAddToCartModal()`; metodo `openWcCompletoWithConjunto(conjuntoId)` para abrir WC Completo con el conjunto preseleccionado.
