# Solución para UPSERT en Supabase/PostgreSQL

## 🔴 Problema Identificado

Cuando usas `upsert()` en Supabase/PostgreSQL con datos **idénticos**, PostgreSQL puede **optimizar** y **no ejecutar el UPDATE**, por lo que:

1. ❌ El trigger `BEFORE UPDATE` **no se dispara**
2. ❌ `fecha_actualizacion` **no se actualiza**
3. ❌ La sincronización incremental **no detecta cambios**

### Ejemplo del Problema

```python
# Si haces esto desde Python:
supabase.table('productos').upsert({
    'codigo': '123',
    'descripcion': 'Producto A',  # Mismo valor que antes
    'pvp': 10.50                  # Mismo valor que antes
}).execute()

# PostgreSQL puede optimizar y NO ejecutar el UPDATE
# → El trigger no se dispara
# → fecha_actualizacion NO se actualiza
# → La sincronización incremental NO detecta el "cambio"
```

---

## ✅ Solución Implementada

### 1. Función RPC Personalizada

Se creó `upsert_productos_masivo_con_fecha()` que **SIEMPRE** actualiza `fecha_actualizacion`, incluso si los datos son idénticos.

**Ventajas**:
- ✅ Fuerza la actualización de fecha
- ✅ Funciona con lotes (más eficiente)
- ✅ Compatible con Supabase/PostgreSQL

### 2. Modificación en `supabase_manager.py`

El código ahora usa la función RPC en lugar de `upsert()` directo:

```python
# ANTES (no funciona con datos idénticos):
result = self.client.table('productos').upsert(batch).execute()

# AHORA (siempre actualiza fecha):
result = self.client.rpc(
    'upsert_productos_masivo_con_fecha',
    {'productos_json': batch}
).execute()
```

### 3. Fallback Automático

Si la función RPC no existe, el código hace fallback a `upsert()` normal (con advertencia).

---

## 🚀 Instalación

### Paso 1: Ejecutar Script SQL Actualizado

1. Ve a **Supabase → SQL Editor**
2. Copia y pega el contenido de `migration_sincronizacion_incremental.sql`
3. Ejecuta el script
4. Verifica que no haya errores

**Verificación**:
```sql
-- Verificar que la función existe
SELECT proname FROM pg_proc 
WHERE proname = 'upsert_productos_masivo_con_fecha';

-- Debe devolver 1 fila
```

### Paso 2: El Código Python Ya Está Actualizado

El archivo `src/data/supabase_manager.py` ya usa la función RPC automáticamente.

**No necesitas cambiar `generate_supabase_file.py`** - funciona igual que antes.

---

## 🔍 Cómo Funciona

### Flujo con Función RPC

```
1. Python llama a supabase_manager.subir_datos_completos()
   ↓
2. supabase_manager prepara lotes de productos
   ↓
3. Llama a función RPC: upsert_productos_masivo_con_fecha()
   ↓
4. Función RPC:
   - Verifica si producto existe
   - Si existe: UPDATE con fecha_actualizacion = NOW() (SIEMPRE)
   - Si no existe: INSERT con fechas = NOW()
   ↓
5. fecha_actualizacion se actualiza SIEMPRE
   ↓
6. Sincronización incremental detecta cambios correctamente ✅
```

### Flujo con Fallback (si RPC no existe)

```
1. Python llama a supabase_manager.subir_datos_completos()
   ↓
2. Intenta usar función RPC → Error (no existe)
   ↓
3. Fallback a upsert() normal
   ↓
4. ⚠️ Si datos son idénticos, fecha_actualizacion NO se actualiza
   ↓
5. Sincronización incremental puede NO detectar cambios ❌
```

---

## 🧪 Pruebas

### Test 1: Verificar Función RPC

```sql
-- En Supabase SQL Editor
SELECT * FROM upsert_productos_masivo_con_fecha(
    '[
        {"codigo": "TEST001", "descripcion": "Producto Test", "pvp": 10.50}
    ]'::jsonb
);
```

**Resultado esperado**:
- `accion`: 'INSERT' o 'UPDATE'
- `fecha_actualizacion`: Fecha actual

### Test 2: Verificar que Siempre Actualiza Fecha

```sql
-- 1. Insertar producto
SELECT * FROM upsert_productos_masivo_con_fecha(
    '[{"codigo": "TEST002", "descripcion": "Test", "pvp": 20.0}]'::jsonb
);

-- 2. Esperar 1 segundo

-- 3. Hacer UPSERT con MISMOS datos
SELECT * FROM upsert_productos_masivo_con_fecha(
    '[{"codigo": "TEST002", "descripcion": "Test", "pvp": 20.0}]'::jsonb
);

-- 4. Verificar que fecha_actualizacion cambió
SELECT codigo, fecha_actualizacion FROM productos WHERE codigo = 'TEST002';
```

**Resultado esperado**: `fecha_actualizacion` debe ser diferente (más reciente)

---

## 📊 Comparación

| Método | Actualiza Fecha con Datos Idénticos | Sincronización Incremental |
|--------|-------------------------------------|----------------------------|
| `upsert()` directo | ❌ NO | ❌ NO detecta cambios |
| Función RPC `upsert_productos_masivo_con_fecha()` | ✅ SÍ | ✅ Detecta cambios |

---

## ⚠️ Limitaciones de Supabase/PostgreSQL

### Por qué no funciona con `upsert()` directo

1. **Optimización de PostgreSQL**: Si los datos son idénticos, PostgreSQL puede no ejecutar el UPDATE
2. **Triggers**: Solo se ejecutan si hay un UPDATE real
3. **Performance**: PostgreSQL optimiza para evitar escrituras innecesarias

### Solución

Usar función RPC que **fuerza** la actualización de `fecha_actualizacion` explícitamente:

```sql
UPDATE productos
SET 
    descripcion = v_descripcion,
    pvp = v_pvp,
    fecha_actualizacion = NOW()  -- SIEMPRE actualizar, incluso si datos son iguales
WHERE codigo = v_codigo;
```

---

## 🔧 Troubleshooting

### Error: "function upsert_productos_masivo_con_fecha does not exist"

**Causa**: El script SQL no se ejecutó correctamente.

**Solución**:
1. Verificar que el script se ejecutó sin errores
2. Verificar que la función existe:
   ```sql
   SELECT proname FROM pg_proc 
   WHERE proname = 'upsert_productos_masivo_con_fecha';
   ```
3. Si no existe, ejecutar el script nuevamente

### Sincronización incremental sigue sin funcionar

**Verificar**:
1. ¿La función RPC se está usando?
   - Revisar logs de Python para ver si hay advertencias de fallback
2. ¿Las fechas se están actualizando?
   ```sql
   SELECT codigo, fecha_actualizacion 
   FROM productos 
   WHERE codigo = 'TU_CODIGO_TEST'
   ORDER BY fecha_actualizacion DESC;
   ```
3. ¿La versión local existe?
   - Verificar en consola del navegador: `localStorage.getItem('version_hash_local')`

---

## 📝 Resumen

**Problema**: UPSERT en Supabase no actualiza `fecha_actualizacion` si los datos son idénticos.

**Solución**: Función RPC que **fuerza** la actualización de fecha.

**Implementación**: 
- ✅ Script SQL actualizado (función RPC creada)
- ✅ `supabase_manager.py` modificado (usa función RPC)
- ✅ Fallback automático si RPC no existe

**Resultado**: Sincronización incremental funciona correctamente ✅

---

**Última actualización**: 2025-01-26  
**Versión**: 1.1
