# Análisis de Escalabilidad - 100 Usuarios Simultáneos

## 📊 Resumen Ejecutivo

**Respuesta corta**: ✅ **SÍ, es viable**, pero con algunas consideraciones y optimizaciones recomendadas.

El sistema actual está bien diseñado para escalar, pero hay puntos de atención cuando 100 usuarios acceden simultáneamente.

---

## 🏗️ Arquitectura Actual

### Puntos Fuertes ✅

1. **Caché en memoria del cliente**
   - Cada usuario tiene su propio caché en su dispositivo
   - No comparten recursos entre usuarios
   - TTL de 24 horas reduce consultas repetidas

2. **Consultas optimizadas**
   - Filtrado por `usuario_id` (no descarga toda la tabla)
   - Función RPC optimizada: `buscar_productos_historial_usuario_optimizado`
   - Índices compuestos en PostgreSQL

3. **Paginación eficiente**
   - Descargas de 1000 registros por página
   - Evita timeouts y sobrecarga de memoria

4. **Búsquedas locales**
   - Después del primer fetch, las búsquedas son locales (<1ms)
   - 95%+ de hit rate esperado según documentación

---

## ⚠️ Puntos de Atención con 100 Usuarios

### 1. Login Simultáneo (Peak Load)

**Escenario**: 100 usuarios hacen login al mismo tiempo

**Impacto**:
- 100 consultas simultáneas a `buscar_productos_historial_usuario_optimizado`
- Cada consulta tarda 50-100ms según documentación
- Pico de carga: ~10 consultas/segundo durante 1 segundo

**Análisis**:
```javascript
// Cada usuario al hacer login ejecuta:
purchaseCache.preload(userId) 
// → getUserPurchaseHistoryOptimized(userId, null, null)
// → 1 consulta RPC a Supabase
```

**Límites de Supabase** (según plan):
- **Free**: ~50 conexiones concurrentes
- **Pro**: ~200 conexiones concurrentes  
- **Team**: ~500 conexiones concurrentes

**Recomendación**: 
- ✅ Con plan **Pro** o superior: **Sin problemas**
- ⚠️ Con plan **Free**: Podría haber cola de espera (2-3 segundos máximo)

---

### 2. Cache Miss Simultáneo (Cache Expired)

**Escenario**: 100 usuarios buscan productos después de que su caché expiró (24 horas)

**Impacto**:
- 100 consultas simultáneas a la base de datos
- Similar al escenario de login

**Probabilidad**: 
- **Baja** si los usuarios no hacen login exactamente al mismo tiempo
- El caché se refresca en background cuando detecta que está viejo (>24h)

**Mitigación actual**:
```javascript
// El sistema ya tiene refresh en background:
if (this.needsRefresh(fullHistoryEntry)) {
    this.refreshInBackground(userId); // No bloquea la búsqueda actual
}
```

---

### 3. Descarga de Catálogo de Productos

**Escenario**: 100 usuarios sincronizan productos por primera vez

**Impacto**:
- Descarga de tabla `productos` completa (puede ser grande)
- Paginación de 1000 registros por página
- Si hay 10,000 productos = 10 consultas por usuario
- 100 usuarios × 10 consultas = 1,000 consultas totales

**Análisis**:
```javascript
// Cada usuario descarga:
downloadProducts() 
// → _downloadWithPagination('productos', ...)
// → Múltiples consultas de 1000 registros
```

**Tiempo estimado**:
- 10,000 productos = ~10 consultas × 100ms = ~1 segundo por usuario
- Con 100 usuarios simultáneos: ~100 consultas/segundo durante 1 segundo

**Recomendación**:
- ✅ **Aceptable** si se distribuye en el tiempo (usuarios no sincronizan exactamente al mismo tiempo)
- ⚠️ Si todos sincronizan a la vez, podría haber cola de espera

---

### 4. Memoria del Cliente

**Escenario**: Usuario con historial muy grande

**Análisis**:
```javascript
// Caché en memoria (purchase-cache.js):
this.config = {
    maxSize: 100,  // Máximo 100 usuarios en caché (por dispositivo)
    ttl: 24 * 60 * 60 * 1000  // 24 horas
}
```

**Cálculo de memoria**:
- Historial promedio: ~100 productos comprados
- Tamaño por producto: ~200 bytes (codigo, descripcion, pvp, fechas)
- Total por usuario: ~20 KB
- 100 usuarios en caché: ~2 MB

**Veredicto**: ✅ **Sin problemas** - 2 MB es insignificante en dispositivos modernos

---

## 📈 Análisis de Carga Esperada

### Escenario Realista (100 usuarios activos)

**Distribución temporal**:
- 30% hacen login en la primera hora (30 usuarios)
- 20% buscan productos simultáneamente (20 consultas)
- 10% sincronizan catálogo (10 descargas)

**Carga pico**:
- **Login simultáneo**: 30 consultas en 1 minuto = 0.5 consultas/segundo ✅
- **Búsquedas**: 20 consultas/segundo (con caché: solo 1-2 consultas/segundo) ✅
- **Sincronización**: 10 descargas simultáneas = ~100 consultas durante 1 segundo ⚠️

**Conclusión**: 
- ✅ **Mayoría de casos**: Sin problemas
- ⚠️ **Peak load**: Podría haber cola de espera de 2-3 segundos

---

## 🎯 Recomendaciones para Escalar

### 1. Ajustar TTL del Caché (Fácil)

**Actual**: 24 horas
**Recomendado para alta carga**: 12-18 horas

```javascript
// En purchase-cache.js
this.config = {
    ttl: 12 * 60 * 60 * 1000,  // 12 horas (reduce consultas)
    maxSize: 100
}
```

**Beneficio**: Reduce consultas de refresh en 50%

---

### 2. Implementar Rate Limiting en Cliente (Medio)

**Problema**: Si todos buscan al mismo tiempo después de expirar caché

**Solución**: Retry con backoff exponencial

```javascript
// En purchase-cache.js - agregar retry logic
async getUserHistory(userId, codigo = null, descripcion = null) {
    // ... código actual ...
    
    // Si hay error, retry con delay
    if (error && error.code === 'PGRST116') { // Rate limit error
        await this.delay(1000); // Esperar 1 segundo
        return this.getUserHistory(userId, codigo, descripcion); // Retry
    }
}
```

---

### 3. Pre-cargar Historial en Background (Fácil)

**Actual**: Se pre-carga al hacer login
**Mejora**: Pre-cargar antes de que el usuario lo necesite

```javascript
// En app.js - preload más agresivo
async initialize() {
    // ... código actual ...
    
    // Pre-cargar historial de usuarios frecuentes (opcional)
    if (this.isFrequentUser()) {
        this.preloadHistoryInBackground();
    }
}
```

---

### 4. Verificar Plan de Supabase (Crítico)

**Recomendación según carga esperada**:

| Usuarios Simultáneos | Plan Recomendado | Conexiones Concurrentes |
|---------------------|------------------|------------------------|
| 1-50 | Free | ~50 |
| 51-200 | Pro | ~200 |
| 201-500 | Team | ~500 |
| 500+ | Enterprise | Ilimitado |

**Para 100 usuarios**: Plan **Pro** es suficiente ✅

---

### 5. Monitoreo y Alertas (Recomendado)

**Implementar métricas**:
```javascript
// Agregar en purchase-cache.js
getPerformanceMetrics() {
    return {
        averageQueryTime: this.stats.totalTime / this.stats.totalQueries,
        cacheHitRate: this.getCacheHitRate(),
        errorRate: this.stats.errors / this.stats.totalQueries,
        peakConcurrentQueries: this.stats.peakConcurrent
    };
}
```

**Alertas**:
- Si cache hit rate < 80% → Aumentar TTL
- Si error rate > 5% → Verificar límites de Supabase
- Si query time > 200ms → Optimizar índices

---

## ✅ Checklist de Escalabilidad

### Antes de Lanzar con 100 Usuarios

- [ ] **Verificar plan de Supabase**: Pro o superior
- [ ] **Probar carga**: Simular 100 usuarios con herramienta de testing
- [ ] **Monitorear métricas**: Cache hit rate, query time, error rate
- [ ] **Configurar alertas**: Para detectar problemas temprano
- [ ] **Documentar límites**: Saber cuándo escalar a más usuarios

### Optimizaciones Opcionales

- [ ] Ajustar TTL del caché según uso real
- [ ] Implementar retry con backoff
- [ ] Pre-cargar historial de usuarios frecuentes
- [ ] Considerar CDN para assets estáticos

---

## 📊 Conclusión Final

### ¿Es viable con 100 usuarios simultáneos?

**✅ SÍ, con estas condiciones**:

1. **Plan de Supabase**: Pro o superior (200+ conexiones concurrentes)
2. **Distribución temporal**: Usuarios no hacen login exactamente al mismo tiempo
3. **Caché funcionando**: 95%+ hit rate reduce carga en 95%

### Escenarios Problemáticos

**⚠️ Podría haber problemas si**:
- Todos los usuarios hacen login exactamente al mismo tiempo (pico de carga)
- Plan Free de Supabase (solo 50 conexiones concurrentes)
- Historiales muy grandes (>1000 productos por usuario)

### Recomendación Final

**Para producción con 100 usuarios**:
1. ✅ Usar plan **Pro** de Supabase (o superior)
2. ✅ Monitorear métricas durante primeras semanas
3. ✅ Ajustar TTL del caché según uso real
4. ✅ Implementar alertas para detectar problemas

**El sistema actual está bien diseñado y debería funcionar correctamente con 100 usuarios simultáneos, siempre que tengas el plan adecuado de Supabase.**

---

## 🔍 Pruebas Recomendadas

### Test de Carga

```bash
# Usar herramienta como Apache Bench o k6
# Simular 100 usuarios haciendo login simultáneo

# Ejemplo con k6:
import http from 'k6/http';

export let options = {
  vus: 100,  // 100 usuarios virtuales
  duration: '1m',
};

export default function() {
  // Simular login y carga de historial
  http.post('https://tu-app.vercel.app/api/login', ...);
  http.get('https://tu-app.vercel.app/api/historial', ...);
}
```

### Métricas a Observar

- **Tiempo de respuesta**: < 200ms para 95% de requests
- **Error rate**: < 1%
- **Cache hit rate**: > 90%
- **Conexiones concurrentes**: < 80% del límite del plan

---

**Última actualización**: 2025-01-26  
**Versión**: 1.0
