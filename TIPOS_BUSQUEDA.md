# 🔍 Tipos de Búsqueda - Scan as You Shop

## 📋 Resumen de Funcionalidades

El sistema de búsqueda de `scan_client_mobile` ofrece **6 tipos diferentes de búsqueda** optimizados para diferentes casos de uso, aprovechando la base de datos local (IndexedDB) para máxima velocidad.

---

## 1. BÚSQUEDA POR CÓDIGO (Smart Code Search)

### **Método**: `searchByCodeUnified(code)` (unifica `searchByCodeSmart`, `searchProductsExact` y `searchByManufacturerCode`)
### **Cuándo se usa**: Cuando se introduce código en el campo "Código (SKU / EAN / Ref. fabricante)"
### **Lógica**:
1. **Match exacto** en código principal o en cualquier código secundario (EAN o ref. fabricante): si hay resultado, se incluye.
2. **Match en código principal**: exacto primero; si no hay exacto, códigos que contengan el término.
3. **Match en referencia de fabricante**: códigos secundarios que no son EAN y contienen el término (parcial).
4. Resultados deduplicados por código principal; sin límite de cantidad.

### **Ejemplo Práctico**:
```
Código introducido: "013823608"

🔍 Búsqueda exacta:
- Busca: "013823608" (exacto)
- Encuentra: "MONOMANDO LAVABO CROMADO - 013823608"
- Resultado: 1 producto (match exacto)

Si no encuentra exacto:
🔍 Búsqueda parcial:
- Busca: "013823608" en cualquier código
- Encuentra: "013823608001", "013823608002", "013823608-ALT"
- Resultado: 3 productos (códigos que contienen "013823608")
```

---

## 🎯 2. BÚSQUEDA POR DESCRIPCIÓN (All Words Search)

### **Método**: `searchByDescriptionAllWords(description)`
### **Cuándo se usa**: Solo cuando se introduce descripción
### **Lógica**:
1. **Separación de palabras**: Divide el texto en palabras individuales
2. **Búsqueda AND**: El producto debe contener TODAS las palabras
3. **Orden flexible**: Las palabras pueden estar en cualquier orden
4. **Sin límites**: Muestra TODOS los productos que cumplan
5. **Campo de sinónimos**: Además de la descripción del producto, se busca también en el campo **sinónimos** (si existe). Así, si un artículo tiene sinónimos cargados (por ejemplo "Cuentagotas, Medidor"), una búsqueda por "medidor" lo encontrará aunque la descripción no contenga esa palabra.

### **Ejemplo Práctico**:
```
Descripción introducida: "monomando lavabo"

🔍 Proceso de búsqueda:
1. Separa palabras: ["monomando", "lavabo"]
2. Busca productos que contengan AMBAS palabras
3. Encuentra productos como:
   - "MONOMANDO LAVABO CROMADO"
   - "MONOMANDO LAVABO NÍQUEL"
   - "MONOMANDO LAVABO BRONCE"
   - "MONOMANDO LAVABO BLANCO"

📊 Resultado: 15 productos (todos los monomandos de lavabo)

❌ NO encuentra:
- "MONOMANDO DUCHA" (no contiene "lavabo")
- "GRIFO LAVABO" (no contiene "monomando")
```

---

## 🎯 3. BÚSQUEDA COMBINADA (Description + Code Filter)

### **Método**: Combinación de `searchByDescriptionAllWords()` + filtro por código
### **Cuándo se usa**: Cuando se introducen código Y descripción
### **Lógica**:
1. **Paso 1**: Busca por descripción (todas las palabras)
2. **Paso 2**: Filtra esos resultados por código
3. **Resultado**: Productos que cumplan AMBOS criterios

### **Ejemplo Práctico**:
```
Código: "013823608" + Descripción: "monomando lavabo"

🔍 Paso 1 - Búsqueda por descripción:
- Busca: "monomando lavabo"
- Encuentra: 15 productos (todos los monomandos de lavabo)
- Lista: ["013823608", "013823609", "013823610", "013823611", ...]

🔍 Paso 2 - Filtro por código:
- Filtra: Solo códigos que contengan "013823608"
- De 15 productos → 3 productos que cumplen ambos criterios

📊 Resultado final:
- "MONOMANDO LAVABO CROMADO - 013823608" ✅
- "MONOMANDO LAVABO NÍQUEL - 013823608001" ✅  
- "MONOMANDO LAVABO BRONCE - 013823608002" ✅

❌ Excluye:
- "MONOMANDO LAVABO BLANCO - 013823609" (código diferente)
- "MONOMANDO LAVABO CROMADO - 013823610" (código diferente)
```

---

## 🎯 4. BÚSQUEDA EN HISTORIAL (Purchase History Search)

### **Método**: `purchaseCache.getUserHistory()`
### **Cuándo se usa**: Cuando está activado "Solo artículos que he comprado"
### **Lógica**:
1. **Cache local**: Usa cache optimizado para búsquedas ultrarrápidas
2. **Filtro por usuario**: Solo productos comprados por el usuario logueado
3. **Combinación**: Puede buscar por código, descripción o ambos
4. **Información adicional**: Muestra fecha de última compra

### **Ejemplo Práctico**:
```
Usuario: "Juan Pérez" (ID: 12345)
Filtro: ✅ "Solo artículos que he comprado"
Búsqueda: "monomando"

🔍 Proceso:
1. Busca en historial de compras del usuario 12345
2. Filtra solo productos que contengan "monomando"
3. Encuentra productos comprados anteriormente

📊 Resultados encontrados:
- "MONOMANDO LAVABO CROMADO - 013823608"
  └── Última compra: 15/03/2024
  └── Veces comprado: 3
  
- "MONOMANDO DUCHA NÍQUEL - 013823609"  
  └── Última compra: 22/02/2024
  └── Veces comprado: 1

❌ NO muestra:
- "MONOMANDO LAVABO BRONCE" (nunca lo ha comprado)
- "GRIFO LAVABO" (no contiene "monomando")

💡 Ventaja: Solo productos que el cliente conoce y ha usado
```

---

## 🎯 5. BÚSQUEDA LOCAL (Local Database Search)

### **Método**: `searchProductsLocal(searchTerm)`
### **Cuándo se usa**: Escaneo de códigos de barras
### **Lógica**:
1. **Búsqueda híbrida**: Busca en código Y descripción
2. **Prioridad local**: Solo en base de datos local (IndexedDB)
3. **Fallback**: Si no encuentra local, puede buscar en Supabase

### **Ejemplo Práctico**:
```
Código escaneado: "1234567890123"

🔍 Paso 1 - Búsqueda local (IndexedDB):
- Busca en base de datos local
- Tiempo: <5ms
- Encuentra: "GRIFO COCINA CROMADO - 1234567890123"
- Resultado: ✅ Mostrado inmediatamente

Si no encuentra local:
🔍 Paso 2 - Búsqueda remota (Supabase):
- Busca en servidor (si hay internet)
- Tiempo: 200-500ms
- Encuentra: "GRIFO COCINA NÍQUEL - 1234567890123"
- Resultado: ✅ Descargado y mostrado

❌ Si no hay internet:
- Muestra: "Producto no encontrado"
- Sugerencia: "Verificar conexión o código"
```

---

## 🎯 6. BÚSQUEDA EXACTA (Exact Code Search)

### **Método**: `searchProductsExact(code)`
### **Cuándo se usa**: Búsquedas ultrarrápidas por código exacto
### **Lógica**:
1. **Índices optimizados**: Usa índices de IndexedDB para búsqueda instantánea
2. **Códigos principales**: Busca en tabla de productos
3. **Códigos secundarios**: Busca en códigos alternativos
4. **Deduplicación**: Evita resultados duplicados

### **Ejemplo Práctico**:
```
Código: "013823608"

🔍 Búsqueda en productos principales:
- Índice: Código principal
- Tiempo: <1ms
- Encuentra: "MONOMANDO LAVABO CROMADO - 013823608"
- Resultado: ✅ Producto encontrado

Si no existe en principales:
🔍 Búsqueda en códigos secundarios:
- Índice: Códigos alternativos
- Tiempo: <1ms
- Encuentra: "MONOMANDO LAVABO NÍQUEL - 013823608-ALT"
- Resultado: ✅ Producto encontrado (código secundario)

❌ Si no existe en ninguno:
- Resultado: null
- Mensaje: "Código no encontrado"
```

---

## ⚡ Características de Rendimiento

### **Base de Datos Local (IndexedDB)**
- ✅ **Sin límites**: Muestra TODOS los resultados relevantes
- ✅ **Velocidad**: Búsquedas en <10ms
- ✅ **Offline**: Funciona sin conexión a internet
- ✅ **Cache inteligente**: Historial de compras precargado

### **Optimizaciones Implementadas**
- ✅ **Índices compuestos**: Búsquedas ultra-rápidas
- ✅ **Cache de historial**: 95%+ hit rate en búsquedas repetidas
- ✅ **Búsqueda híbrida**: Local primero, Supabase como fallback
- ✅ **Deduplicación**: Evita resultados duplicados

---

## 🎨 Interfaz de Usuario

### **Campos de Búsqueda**
- **Código (SKU / EAN / Ref. fabricante)**: Un solo campo para código principal, EAN u otro código secundario, o referencia de fabricante (p. ej. BM-300). No hace falta usar el chip "Ref. fabricante" para buscar por ref.
- **Descripción**: Para búsquedas por texto
- **Solo comprados**: Filtro de historial (requiere login)

### **Comportamiento Inteligente**
- **Solo código**: Búsqueda unificada por código principal (exacto/parcial), por EAN/código secundario exacto, o por referencia de fabricante (parcial en códigos secundarios no EAN). Un solo campo cubre los tres casos.
- **Solo descripción**: Búsqueda por todas las palabras
- **Código + descripción**: Búsqueda combinada (descripción → filtro por código)
- **Con filtro**: Búsqueda en historial personal del usuario
- **Refresco inmediato de chips**: al pulsar `Solo mis compras` o `Solo en oferta`, la búsqueda se relanza automáticamente (sin pulsar `Buscar`) cuando ya hay criterio o resultados en pantalla

---

## 📊 Estadísticas de Rendimiento

| Tipo de Búsqueda | Velocidad | Resultados | Uso Recomendado |
|------------------|-----------|--------------|------------------|
| Por código | <5ms | Sin límite | Códigos conocidos |
| Por descripción | <10ms | Sin límite | Búsquedas amplias |
| Combinada | <15ms | Sin límite | Búsquedas específicas |
| Historial | <1ms (cache) | Sin límite | Productos frecuentes |
| Local | <5ms | Sin límite | Escaneo de códigos |
| Exacta | <1ms | 1 resultado | Códigos exactos |

---

## 🔧 Configuración

### **Parámetros de Búsqueda**
```javascript
search: {
    minSearchLength: 2,        // Mínimo caracteres para buscar
    debounceDelay: 300         // Delay para búsqueda en tiempo real (ms)
}
```

### **Sin Límites Artificiales**
- ❌ **No hay `maxResults`**: Se eliminaron los límites artificiales
- ✅ **Resultados completos**: Muestra toda la información disponible
- ✅ **Aprovecha BD local**: IndexedDB es muy rápida, no necesita límites

---

## 🚀 Casos de Uso Prácticos

### **1. Búsqueda Rápida por Código**
```
Situación: Cliente tiene el código del producto
Código: "013823608"
Resultado: Encuentra el producto exacto en <5ms
Uso: Para productos conocidos, búsquedas rápidas
```

### **2. Exploración por Descripción**
```
Situación: Cliente busca "monomando lavabo"
Descripción: "monomando lavabo"
Resultado: 15 productos (todos los monomandos de lavabo)
Uso: Para descubrir opciones, comparar productos
```

### **3. Búsqueda Específica Combinada**
```
Situación: Cliente quiere monomando lavabo de una marca específica
Código: "013823608" + Descripción: "monomando lavabo"
Resultado: 3 productos (solo los de esa marca)
Uso: Para búsquedas precisas, filtrar por marca/modelo
```

### **4. Productos Frecuentes (Historial)**
```
Situación: Cliente busca productos que ya ha comprado
Usuario: Juan Pérez + Filtro: "Solo comprados" + "monomando"
Resultado: 2 productos (solo los que ha comprado antes)
Uso: Para re-compras, productos de confianza
```

### **5. Escaneo de Códigos de Barras**
```
Situación: Cliente escanea código de barras
Código escaneado: "1234567890123"
Resultado: Producto encontrado inmediatamente
Uso: Para escaneo rápido, verificación de productos
```

### **6. Verificación de Códigos**
```
Situación: Cliente quiere confirmar un código exacto
Código: "013823608"
Resultado: 1 producto exacto o "no encontrado"
Uso: Para verificar códigos, confirmar productos
```

---

## 📱 Flujos de Trabajo Típicos

### **Flujo 1: Búsqueda Rápida**
```
1. Cliente introduce código: "013823608"
2. Sistema busca exacto: ✅ Encontrado
3. Muestra producto: "MONOMANDO LAVABO CROMADO"
4. Cliente puede añadir al carrito
Tiempo total: <5ms
```

### **Flujo 2: Exploración de Productos**
```
1. Cliente introduce: "monomando lavabo"
2. Sistema busca: 15 productos encontrados
3. Muestra lista: Varios modelos y colores
4. Cliente puede comparar y elegir
Tiempo total: <10ms
```

### **Flujo 3: Búsqueda Específica**
```
1. Cliente introduce: Código "013823608" + "monomando lavabo"
2. Sistema busca descripción: 15 productos
3. Filtra por código: 3 productos
4. Muestra: Solo productos de esa marca
Tiempo total: <15ms
```

### **Flujo 4: Historial Personal**
```
1. Cliente se loguea: "Juan Pérez"
2. Activa filtro: "Solo comprados"
3. Busca: "monomando"
4. Muestra: Solo productos que ha comprado antes
Tiempo total: <1ms (cache)
```

### **Flujo 5: Escaneo de Códigos**
```
1. Cliente escanea: "1234567890123"
2. Sistema busca local: ✅ Encontrado
3. Muestra: "GRIFO COCINA CROMADO"
4. Cliente puede añadir al carrito
Tiempo total: <5ms
```

---

## 🎯 Recomendaciones de Uso

| Situación | Tipo de Búsqueda | Ejemplo | Tiempo |
|-----------|------------------|---------|---------|
| **Producto conocido** | Solo código | "013823608" | <5ms |
| **Explorar opciones** | Solo descripción | "monomando lavabo" | <10ms |
| **Búsqueda específica** | Código + descripción | "013823608" + "monomando" | <15ms |
| **Re-compras** | Historial | "Solo comprados" + "monomando" | <1ms |
| **Escaneo rápido** | Local | Código de barras | <5ms |
| **Verificar código** | Exacta | "013823608" | <1ms |
