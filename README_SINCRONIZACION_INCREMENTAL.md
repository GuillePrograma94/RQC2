# Sincronización Incremental de Productos

## 📋 Resumen

Este sistema permite sincronizar solo los productos que han cambiado desde la última versión, en lugar de descargar toda la tabla. Esto reduce significativamente el tiempo de descarga y el uso de ancho de banda.

### Beneficios

- ⚡ **Velocidad**: De minutos a segundos (95-99% más rápido)
- 📉 **Ancho de banda**: Reduce transferencia en 95-99%
- 🎯 **Experiencia**: Actualizaciones casi instantáneas
- 💾 **Eficiencia**: Solo descarga lo que cambió

---

## 🚀 Instalación

### Paso 1: Ejecutar Script SQL en Supabase

1. Abre el **SQL Editor** en tu proyecto de Supabase
2. Copia y pega el contenido de `migration_sincronizacion_incremental.sql`
3. Ejecuta el script
4. Verifica que no haya errores

**Verificación**:
```sql
-- Verificar que las funciones existen
SELECT proname FROM pg_proc 
WHERE proname IN (
    'obtener_productos_modificados',
    'obtener_codigos_secundarios_modificados',
    'obtener_estadisticas_cambios'
);

-- Debe devolver 3 filas
```

### Paso 2: El código JavaScript ya está actualizado

Los archivos ya incluyen:
- ✅ `js/supabase.js` - Métodos de sincronización incremental
- ✅ `js/cart.js` - Métodos de actualización incremental
- ✅ `js/app.js` - Lógica para usar incremental cuando sea posible

**No se requiere acción adicional** - el sistema detecta automáticamente cuándo usar sincronización incremental.

---

## 🔄 Cómo Funciona

### Flujo Automático

```
1. Usuario abre la app
   ↓
2. Sistema verifica si hay actualizaciones (comparando hashes)
   ↓
3. Si hay versión local:
   ├─ Obtiene estadísticas de cambios
   ├─ Si hay < 1000 cambios → Sincronización INCREMENTAL ⚡
   └─ Si hay ≥ 1000 cambios → Sincronización COMPLETA 📦
   ↓
4. Si NO hay versión local:
   └─ Primera sincronización → Sincronización COMPLETA 📦
   ↓
5. Aplica cambios (incremental) o reemplaza todo (completa)
   ↓
6. Actualiza versión local
```

### Ejemplo Real

**Escenario**: 10,000 productos en total, solo 5 cambiaron

**Antes (Sincronización completa)**:
- Descarga: ~10,000 productos × 200 bytes = ~2 MB
- Tiempo: ~30-60 segundos
- Operación: Limpiar todo + Insertar todo

**Ahora (Sincronización incremental)**:
- Descarga: ~5 productos × 200 bytes = ~1 KB
- Tiempo: ~0.5-1 segundo
- Operación: Actualizar 5 productos existentes

**Mejora**: **99.95% más rápido** ⚡

---

## 📊 Funciones SQL Creadas

### 1. `obtener_productos_modificados(version_hash)`

Devuelve solo productos modificados/agregados desde una versión específica.

**Parámetros**:
- `p_version_hash_local`: Hash de la versión local del cliente

**Retorna**:
- `codigo`: Código del producto
- `descripcion`: Descripción
- `pvp`: Precio
- `fecha_actualizacion`: Fecha de última modificación
- `accion`: 'INSERT' (nuevo) o 'UPDATE' (modificado)

**Ejemplo**:
```sql
SELECT * FROM obtener_productos_modificados('abc123def456');
```

### 2. `obtener_codigos_secundarios_modificados(version_hash)`

Similar a la anterior, pero para códigos secundarios (EAN).

### 3. `obtener_estadisticas_cambios(version_hash)`

Devuelve estadísticas de cuántos cambios hay desde una versión.

**Retorna**:
- `productos_modificados`: Productos actualizados
- `productos_nuevos`: Productos nuevos
- `codigos_modificados`: Códigos actualizados
- `codigos_nuevos`: Códigos nuevos
- `total_cambios`: Total de cambios

**Ejemplo**:
```sql
SELECT * FROM obtener_estadisticas_cambios('abc123def456');
-- Resultado:
-- productos_modificados: 2
-- productos_nuevos: 3
-- codigos_modificados: 1
-- codigos_nuevos: 0
-- total_cambios: 6
```

---

## ⚙️ Configuración

### Umbral de Cambios

El sistema usa sincronización incremental si hay **menos de 1000 cambios**. Si hay más, usa sincronización completa (más eficiente para muchos cambios).

**Modificar umbral** (en `js/app.js`):
```javascript
// Línea ~650
if (totalCambios > 0 && totalCambios < 1000) {  // Cambiar 1000 por otro valor
    useIncremental = true;
}
```

**Recomendaciones**:
- **< 500 cambios**: Incremental siempre
- **500-2000 cambios**: Depende del tamaño de productos
- **> 2000 cambios**: Completa (más eficiente)

---

## 🧪 Pruebas

### Test Manual

1. **Primera sincronización** (sin versión local):
   ```javascript
   // En consola del navegador
   window.app.syncProductsInBackground();
   // Debe usar sincronización completa
   ```

2. **Sincronización incremental** (con versión local):
   ```javascript
   // Hacer un cambio pequeño en Supabase (actualizar 1 producto)
   // Luego sincronizar
   window.app.syncProductsInBackground();
   // Debe usar sincronización incremental
   ```

3. **Verificar estadísticas**:
   ```javascript
   const versionHash = localStorage.getItem('version_hash_local');
   const stats = await window.supabaseClient.getChangeStatistics(versionHash);
   console.log(stats);
   ```

### Test de Rendimiento

**Antes de cambios**:
- Tiempo de sincronización: ~30-60 segundos
- Datos transferidos: ~2-5 MB

**Después de cambios**:
- Tiempo de sincronización: ~0.5-2 segundos (si hay pocos cambios)
- Datos transferidos: ~1-10 KB (si hay pocos cambios)

---

## 🐛 Troubleshooting

### Problema: `total_cambios = 0` pero el hash cambió

**Síntoma**: 
- El hash de versión cambió (nueva versión en Supabase)
- Pero `obtener_estadisticas_cambios` retorna `total_cambios = 0`
- El sistema hace descarga completa en lugar de incremental

**Causa**:
- Los productos fueron modificados pero `fecha_actualizacion` NO se actualizó
- Esto ocurre cuando se usa UPSERT normal en lugar de la función RPC `upsert_productos_masivo_con_fecha`
- O cuando la función RPC falló y se usó el fallback

**Solución**:
1. Verifica que la función RPC existe en Supabase:
   ```sql
   SELECT proname FROM pg_proc WHERE proname = 'upsert_productos_masivo_con_fecha';
   ```
   Si no existe, ejecuta `migration_sincronizacion_incremental.sql`

2. Verifica que `generate_supabase_file.py` use la función RPC:
   - Debe llamar a `self.client.rpc('upsert_productos_masivo_con_fecha', ...)`
   - NO debe usar `self.client.table('productos').upsert(...)` directamente

3. Si usaste UPSERT normal antes, los productos modificados no tienen `fecha_actualizacion` actualizada.
   - La próxima vez que subas datos, usa la función RPC
   - O ejecuta este SQL para actualizar manualmente:
     ```sql
     UPDATE productos SET fecha_actualizacion = NOW() WHERE codigo IN (...);
     ```

4. Usa el script de verificación:
   ```bash
   python scan_client_mobile/verificar_funcion_rpc.py
   ```

---

### Error: "function obtener_productos_modificados does not exist"

**Causa**: El script SQL no se ejecutó correctamente.

**Solución**:
1. Verificar que el script se ejecutó sin errores
2. Verificar que las funciones existen:
   ```sql
   SELECT proname FROM pg_proc 
   WHERE proname LIKE 'obtener_%modificados%';
   ```
3. Si no existen, ejecutar el script nuevamente

---

### Siempre usa sincronización completa

**Causa**: No hay versión local guardada o las estadísticas fallan.

**Solución**:
1. Verificar que existe `version_hash_local` en localStorage:
   ```javascript
   localStorage.getItem('version_hash_local');
   ```
2. Si no existe, hacer una sincronización completa primero
3. Verificar logs de consola para errores

---

### Sincronización incremental lenta

**Causa**: Hay muchos cambios (cerca del umbral de 1000).

**Solución**:
- Es normal si hay > 500 cambios
- Considerar aumentar el umbral si tus actualizaciones suelen tener muchos cambios
- O reducir el umbral si quieres forzar incremental más a menudo

---

## 📈 Monitoreo

### Métricas a Observar

1. **Tiempo de sincronización**:
   - Incremental: < 2 segundos
   - Completa: 30-60 segundos

2. **Datos transferidos**:
   - Incremental: < 100 KB (típicamente)
   - Completa: 2-5 MB

3. **Frecuencia de uso**:
   - Verificar en logs cuántas veces se usa incremental vs completa

### Logs en Consola

El sistema muestra logs claros:
```
⚡ Sincronización incremental: 6 cambios detectados
   - Productos: 3 nuevos, 2 modificados
   - Códigos: 0 nuevos, 1 modificado
✅ Cambios aplicados: 5 productos, 1 códigos
```

---

## 🔄 Compatibilidad

### Versiones Anteriores

- ✅ **Compatible**: El sistema funciona con versiones anteriores
- ✅ **Fallback automático**: Si falla incremental, usa completa
- ✅ **Sin breaking changes**: No afecta funcionalidad existente

### Primera Sincronización

- Siempre usa sincronización **completa** (no hay versión local)
- Después de la primera, usa **incremental** cuando sea posible

---

## 📚 Referencias

### Archivos Modificados

- `migration_sincronizacion_incremental.sql` - Funciones SQL
- `js/supabase.js` - Métodos de descarga incremental
- `js/cart.js` - Métodos de actualización incremental
- `js/app.js` - Lógica de decisión incremental vs completa

### Funciones Relacionadas

- `verificarActualizacionNecesaria()` - Detecta si hay cambios
- `downloadProducts()` - Descarga completa (fallback)
- `downloadProductsIncremental()` - Descarga incremental
- `updateProductsIncremental()` - Aplica cambios sin limpiar

---

## ✅ Checklist de Implementación

- [ ] Script SQL ejecutado en Supabase
- [ ] Funciones verificadas (3 funciones creadas)
- [ ] Índices creados (4 índices nuevos)
- [ ] Primera sincronización completa realizada
- [ ] Test de sincronización incremental exitoso
- [ ] Logs verificados en consola
- [ ] Rendimiento mejorado confirmado

---

**Última actualización**: 2025-01-26  
**Versión**: 1.0  
**Autor**: Sistema de Sincronización Incremental
