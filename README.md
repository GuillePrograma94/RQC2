# Scan as You Shop - Aplicación Móvil Cliente

Aplicación móvil PWA para que los clientes escaneen productos mientras compran y finalicen su compra sin hacer cola.

## 🚀 Características

- **📱 PWA (Progressive Web App)**: Instalable como aplicación nativa
- **🛒 Carrito en tiempo real**: Añade productos escaneando códigos
- **📊 Sincronización automática**: Conectado con el sistema de checkout PC
- **💾 Trabajo offline**: Funciona sin conexión una vez sincronizado
- **🔢 Vinculación por QR**: Escanea código QR del PC para iniciar sesión
- **⚡ Rápido y ligero**: Optimizado para móviles
- **🔒 Seguro**: Sesiones temporales con códigos únicos

## 🛠️ Instalación y Configuración

### Requisitos Previos

1. **Supabase configurado**: Debes haber ejecutado los scripts SQL:
   - `setup_supabase.sql` (tablas principales)
   - `setup_scan_as_you_shop.sql` (tablas de carritos)

2. **Servidor web**: Necesitas un servidor web para servir la aplicación:
   - Apache/Nginx con PHP, o
   - Servidor Node.js, o
   - Cualquier hosting estático (Netlify, Vercel, GitHub Pages)

### Paso 1: Configurar Supabase

1. Asegúrate de que las tablas estén creadas en Supabase:
   ```sql
   -- Ejecutar en SQL Editor de Supabase
   -- Ver archivos: setup_supabase.sql y setup_scan_as_you_shop.sql
   ```

2. Obtener credenciales de Supabase:
   - Ve a Settings → API en tu proyecto Supabase
   - Copia la **Project URL** y **anon public key**

### Paso 2: Configurar la Aplicación

La aplicación carga automáticamente la configuración desde el archivo `.env` del proyecto principal.

**Opción A: Usando el mismo .env del proyecto principal**

Si despliegas la PWA en el mismo servidor que el resto del proyecto, no necesitas hacer nada. La aplicación leerá las credenciales desde `config.js`.

**Opción B: Configuración manual**

Edita `config.js` y añade tus credenciales directamente:

```javascript
let CONFIG = {
    SUPABASE_URL: 'https://tu-proyecto.supabase.co',
    SUPABASE_ANON_KEY: 'tu-clave-anonima-aqui',
    // ...
};
```

### Paso 3: Crear Iconos

Necesitas crear iconos para la PWA:

1. **icon-192.png**: Icono de 192×192 píxeles
2. **icon-512.png**: Icono de 512×512 píxeles

Puedes usar herramientas online como:
- https://www.favicon-generator.org/
- https://realfavicongenerator.net/

### Paso 4: Desplegar la Aplicación

#### Opción A: Servidor Web Local

```bash
# Python
cd scan_client_mobile
python -m http.server 8000

# Node.js
npx serve .

# PHP
php -S localhost:8000
```

#### Opción B: Netlify

1. Sube la carpeta `scan_client_mobile/` a un repositorio Git
2. Conecta el repositorio con Netlify
3. Configura las variables de entorno:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. Despliega

#### Opción C: Vercel

Similar a Netlify:
1. Conecta repositorio
2. Configura variables de entorno
3. Despliega

#### Opción D: GitHub Pages

1. Sube a repositorio GitHub
2. Habilita GitHub Pages en Settings
3. Accede desde `https://tu-usuario.github.io/tu-repo`

**⚠️ Nota**: Para GitHub Pages, debes hardcodear las credenciales en `config.js` ya que no soporta variables de entorno del lado del servidor.

## 📱 Uso de la Aplicación

### Para el Cliente

1. **Abrir la aplicación**
   - En el navegador móvil o como PWA instalada

2. **Escanear código QR de la caja**
   - Presiona "📷 Escanear Código QR"
   - Escanea el QR mostrado en el PC de checkout
   - La app se vinculará a esa sesión

3. **Escanear productos**
   - Usa la barra de búsqueda para buscar productos
   - O escanea códigos de barras (requiere cámara)
   - Ajusta cantidades antes de añadir al carrito

4. **Revisar carrito**
   - Toca el icono del carrito (arriba derecha)
   - Revisa productos y cantidades
   - Ajusta o elimina productos si es necesario

5. **Finalizar compra**
   - Presiona "✅ Finalizar Compra"
   - Dirígete a la caja con tu código
   - El empleado confirmará tu compra en el PC

### Para el Personal de la Tienda

1. **Verificar QR funciona**: El código debe ser visible en el PC checkout
2. **Ayudar a clientes**: Si tienen problemas vinculando su móvil
3. **Confirmar compras**: En el PC checkout cuando el cliente llegue

## 🔧 Configuración Avanzada

### Personalizar Tiempos

En `config.js`:

```javascript
const APP_CONFIG = {
    cart: {
        expirationHours: 2,        // Tiempo antes de expirar carrito
        autoSyncInterval: 5000,    // Sincronización automática (ms)
        maxProductsPerCart: 200    // Máximo productos por carrito
    },
    
    search: {
        minSearchLength: 2,        // Mínimo caracteres para buscar
        debounceDelay: 300         // Delay para búsqueda (ms)
    }
};
```

### Personalizar Apariencia

En `manifest.json`:

```json
{
    "name": "Tu Tienda - Scan Shop",
    "short_name": "Scan Shop",
    "theme_color": "#2563eb",
    "background_color": "#ffffff"
}
```

En `styles.css`:

```css
:root {
    --primary-color: #2563eb;    /* Color principal */
    --success-color: #16a34a;    /* Color de éxito */
    --danger-color: #dc2626;     /* Color de peligro */
}
```

## 🚨 Solución de Problemas

### Error de Conexión

```
❌ No se pudo conectar con el servidor
```

**Solución**:
1. Verifica credenciales de Supabase en `config.js`
2. Comprueba conexión a internet
3. Verifica que las tablas existen en Supabase

### No Carga Productos

```
⚠️ Error al sincronizar productos
```

**Solución**:
1. Verifica que hay productos en la tabla `productos`
2. Comprueba permisos de lectura en Supabase
3. Revisa la consola del navegador (F12) para errores

### Código QR No Funciona

```
❌ Código QR inválido o expirado
```

**Solución**:
1. Verifica que el código QR del PC esté activo
2. Comprueba que no hayan pasado 2 horas desde su generación
3. Pide al empleado que genere un nuevo código

### PWA No Se Instala

**Solución**:
1. Asegúrate de servir desde HTTPS (no HTTP)
2. Verifica que `manifest.json` es válido
3. Comprueba que los iconos existen
4. Revisa que el Service Worker se registra correctamente

### Productos No Se Añaden al Carrito

```
❌ Error al añadir al carrito
```

**Solución**:
1. Verifica que escaneaste el QR primero
2. Comprueba conexión a internet
3. Revisa que el carrito no haya expirado
4. Intenta recargar la aplicación

## 🔒 Seguridad y Privacidad

### Datos Almacenados

- **Localmente (IndexedDB)**:
  - Catálogo de productos (para búsquedas offline)
  - Carrito actual
  - Código de sesión

- **En Supabase**:
  - Carritos activos con código QR
  - Productos del carrito (código, cantidad, precio)
  - Estado del carrito (activo/confirmado)

- **No se almacena**:
  - Información personal del cliente
  - Datos de pago
  - Historial de compras

### Códigos de Sesión

- **Únicos**: Cada código es único y verificado
- **Temporales**: Expiran automáticamente en 2 horas
- **Seguros**: 6 dígitos = 1,000,000 de combinaciones

### Privacidad

- No se requiere registro ni login
- No se recopilan datos personales
- Las sesiones son anónimas
- Los carritos se eliminan automáticamente al expirar

## 📊 Estadísticas y Monitoreo

### Ver Estadísticas en Consola

Abre DevTools (F12) y ejecuta:

```javascript
// Estado del carrito
console.log(window.cartManager.getCart());

// Total de productos en almacenamiento local
window.cartManager.db.transaction(['products'], 'readonly')
    .objectStore('products').count().onsuccess = function(e) {
        console.log('Productos en cache:', e.target.result);
    };
```

### Limpiar Datos

Si necesitas limpiar todos los datos locales:

```javascript
// Limpiar carrito
await window.cartManager.clearCart();

// Limpiar cache completo
await caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));

// Limpiar IndexedDB
indexedDB.deleteDatabase('ScanAsYouShop');

// Recargar
location.reload();
```

## 🔄 Actualizaciones

La aplicación se actualiza automáticamente cuando:
1. Se recarga la página (pull to refresh)
2. Se detecta una nueva versión del Service Worker
3. Se reinstala la PWA

Para forzar actualización:
1. Desinstalar PWA
2. Limpiar caché del navegador
3. Reinstalar desde el navegador

## 📞 Soporte Técnico

### Logs de Debug

Para ver logs detallados, abre la consola (F12):

- **Inicialización**: Mensajes de inicio de la app
- **Sincronización**: Estado de sincronización con Supabase
- **Carrito**: Operaciones de añadir/eliminar productos
- **Errores**: Cualquier error que ocurra

### Reportar Problemas

Si encuentras un problema:
1. Abre DevTools (F12)
2. Ve a la pestaña Console
3. Copia los mensajes de error
4. Incluye pasos para reproducir el problema

## 🎨 Personalización

### Cambiar Colores

Edita `styles.css`:

```css
:root {
    --primary-color: #tu-color;
    --primary-dark: #tu-color-oscuro;
    --primary-light: #tu-color-claro;
}
```

### Cambiar Textos

Edita `index.html` y busca los textos a cambiar.

### Cambiar Logo/Iconos

1. Reemplaza `icon-192.png` y `icon-512.png`
2. Actualiza `manifest.json` si cambias nombres

## 📄 Licencia

Este proyecto forma parte del sistema Labels Productos y está bajo la misma licencia.

---

**¿Necesitas ayuda?** Revisa los logs de la consola del navegador (F12) o contacta al administrador del sistema.

