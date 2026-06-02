# Desplegar en Vercel - RQC Scan as You Shop

## Pasos para desplegar

### 1. Preparar el repositorio

Ya tienes tu código en GitHub: `https://github.com/GuillePrograma94/RQC.git`

✅ Asegúrate de hacer commit y push de los últimos cambios:

```bash
git add .
git commit -m "Configurar para Vercel"
git push origin main
```

### 2. Conectar con Vercel

1. **Ve a Vercel**: https://vercel.com
2. **Inicia sesión** con tu cuenta de GitHub
3. **Importa el proyecto**:
   - Click en "Add New..." → "Project"
   - Selecciona tu repositorio `RQC`
   - Click en "Import"

### 3. Configurar el proyecto

En la pantalla de configuración:

**Framework Preset**: Other (o None)

**Root Directory**: 
- Deja en blanco o pon `.` (punto)
- O si Vercel detecta múltiples carpetas, selecciona `scan_client_mobile`

**Build Settings**:
- Build Command: (dejar vacío o poner `echo "Static site"`)
- Output Directory: `.` (punto)
- Install Command: (dejar vacío)

### 4. **MUY IMPORTANTE**: Configurar Variables de Entorno

En la sección **Environment Variables**, añade:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Tu URL de Supabase (ej: `https://xxxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Tu clave anónima de Supabase |

Variables para ERP (no se exponen al frontend):

**URL del ERP**: La API del ERP funciona en HTTPS en el puerto 5002. Usa siempre `https://` en `ERP_BASE_URL`.

Endpoints del ERP:
- `POST /api/tienda/v1/login` - Obtener token
- `GET /api/tienda/v1/test` - Probar conectividad
- `POST /api/tienda/v1/pedidos/crear_tipo` - Crear pedido (serie, centro_venta, tipo REMOTO/PRESENCIAL, lineas, etc.)
- `GET /api/tienda/v1/pedidos/prueba` - Probar pedidos (con token)
- `GET /api/tienda/v1/articulos/pvp?codigo=XXX` - Obtener PVP (con token)

| Key | Value | Estado |
|-----|-------|--------|
| `ERP_BASE_URL` | Base URL del ERP en HTTPS (ej: `https://api.saneamiento-martinez.com:5002/api/tienda/v1`) | Requerido |
| `ERP_LOGIN_PATH` | Ruta de login del ERP: `/login` | Requerido |
| `ERP_CREATE_ORDER_PATH` | Ruta de crear pedido: `/pedidos/crear_tipo` | Requerido |
| `ERP_USER` | Usuario del ERP con el que la API hace login (ej: `APP_TIENDA` en produccion). El ERP mostrara este usuario como "quien creo el pedido". | Requerido |
| `ERP_PASSWORD` | Contraseña del ERP | Requerido |
| `ERP_REQUEST_TIMEOUT_MS` | Timeout en ms (ej: `15000`) | Opcional |

Variable opcional para el frontend:

| Key | Value |
|-----|-------|
| `ERP_PROXY_PATH` | Endpoint proxy del ERP en el mismo origen (default en codigo: `/api/erp/pedidos`; ver `scan_client_mobile/api/config.js`) |

Para obtener tus credenciales:
1. Ve a tu proyecto en https://supabase.com
2. Settings → API
3. Copia "Project URL" y "anon public key"

**⚠️ IMPORTANTE**: Marca estas variables para todos los entornos (Production, Preview, Development)

### 5. Deploy

Click en **"Deploy"** y espera a que termine.

### 6. Verificar

Una vez desplegado:
1. Vercel te dará una URL (ej: `https://rqc.vercel.app`)
2. Abre esa URL en tu navegador móvil
3. Verifica que no hay errores en la consola (F12)
4. Intenta escanear un código QR de prueba

### 7. Instalar como PWA (Opcional)

En tu móvil:
1. Abre la URL en Safari (iOS) o Chrome (Android)
2. Safari: Compartir → "Añadir a pantalla de inicio"
3. Chrome: Menú → "Añadir a pantalla de inicio"

## Problemas Comunes

### Error: "ERP login error 403: Forbidden" o 502 al crear pedido

**Causa**: La API en Vercel hace el login al ERP con las variables de entorno `ERP_USER` y `ERP_PASSWORD`. Si has cambiado el usuario del ERP para producción (o la URL del ERP), esas credenciales deben estar actualizadas **en Vercel**, no solo en tu entorno local.

**Solución**:
1. Entra en [Vercel](https://vercel.com) → tu proyecto (ej. **rqc-2**) → **Settings** → **Environment Variables**.
2. Actualiza:
   - **`ERP_USER`**: usuario del ERP de **producción**.
   - **`ERP_PASSWORD`**: contraseña del ERP de producción.
   - Si el ERP de producción usa otra URL o rutas: **`ERP_BASE_URL`**, **`ERP_LOGIN_PATH`**, **`ERP_CREATE_ORDER_PATH`**.
3. Guarda los cambios.
4. **Redeploy**: en **Deployments** → menú (⋯) del último deployment → **Redeploy**. Así la función serverless (`/api/erp/pedidos`) usará las nuevas variables en la siguiente petición.

La app móvil **no** envía usuario/contraseña del ERP; quien hace el login es la API en Vercel leyendo `ERP_USER` y `ERP_PASSWORD`. El ERP suele mostrar como "usuario que creó el pedido" el usuario con el que se obtuvo el token (es decir, el valor de `ERP_USER` en Vercel). Si en el ERP aparece TIENDA_PRU en vez de APP_TIENDA, es porque en Vercel sigue configurado `ERP_USER=TIENDA_PRU`; actualiza a `APP_TIENDA` y redeploy. Por eso el cambio solo tiene efecto cuando actualizas esas variables en el proyecto de Vercel y vuelves a desplegar.

### Error: "No se pudo cargar configuración"

**Causa**: Variables de entorno no configuradas

**Solución**:
1. Ve a tu proyecto en Vercel
2. Settings → Environment Variables
3. Añade `SUPABASE_URL` y `SUPABASE_ANON_KEY`
4. Redeploy: Deployments → ... (menú) → Redeploy

### Error: CORS

**Causa**: Configuración de CORS incorrecta

**Solución**: Ya está configurado en `vercel.json`

### La función `/api/config` no responde

**Causa**: Vercel no está ejecutando la función serverless

**Solución**:
1. Verifica que `api/config.js` existe
2. Verifica que `vercel.json` está en la raíz
3. Redeploy el proyecto

## Actualizar el Proyecto

Cuando hagas cambios:

```bash
git add .
git commit -m "Descripción de cambios"
git push origin main
```

Vercel detectará automáticamente el push y redesplegará.

## Dominios Personalizados

Para usar tu propio dominio:
1. Ve a tu proyecto en Vercel
2. Settings → Domains
3. Añade tu dominio
4. Configura los registros DNS según las instrucciones

## Probar Endpoints del ERP

Una vez desplegado, puedes probar los endpoints del ERP de dos formas:

### Opción 1: Panel de Pruebas (Recomendado)

Abre en tu navegador la página de pruebas:
```
https://tu-proyecto.vercel.app/test-erp.html
```

Esta página te permite:
- ✅ Probar todos los endpoints con botones
- ✅ Ver las respuestas formateadas
- ✅ Hacer POST requests sin problemas
- ✅ Ver el token obtenido del login
- ✅ Probar todos los endpoints en secuencia

**Ventajas**: Interfaz visual, fácil de usar, muestra resultados claros.

### Opción 2: Endpoints Directos

También puedes probar los endpoints directamente:

### 1. Probar Conectividad (Test)
**Endpoint**: `GET https://tu-proyecto.vercel.app/api/erp/test`

Prueba si el ERP está accesible. Solo requiere `ERP_BASE_URL`.

**Ejemplo con curl**:
```bash
curl https://tu-proyecto.vercel.app/api/erp/test
```

### 2. Probar Login
**Endpoint**: `POST https://tu-proyecto.vercel.app/api/erp/login`

Prueba el login y obtiene el token. Requiere `ERP_BASE_URL`, `ERP_USER`, `ERP_PASSWORD`.

**Ejemplo con curl**:
```bash
curl -X POST https://tu-proyecto.vercel.app/api/erp/login
```

**Respuesta esperada**:
```json
{
  "success": true,
  "message": "Login exitoso",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenLength": 200,
  "note": "Token valido por 8 horas"
}
```

### 3. Probar Endpoint de Pedidos
**Endpoint**: `GET https://tu-proyecto.vercel.app/api/erp/pedidos`

Prueba el endpoint `GET /api/tienda/v1/pedidos/prueba`. Hace login automáticamente.

**Ejemplo con curl**:
```bash
curl https://tu-proyecto.vercel.app/api/erp/pedidos
```

### 4. Probar Endpoint de PVP
**Endpoint**: `GET https://tu-proyecto.vercel.app/api/erp/pvp?codigo=0004223500340`

Prueba el endpoint `GET /api/tienda/v1/articulos/pvp`. Hace login automáticamente.

**Parámetros**:
- `codigo` (query): Código del artículo (default: `0004223500340`)

**Ejemplo con curl**:
```bash
curl "https://tu-proyecto.vercel.app/api/erp/pvp?codigo=0004223500340"
```

### Orden Recomendado de Pruebas

1. **Primero**: Prueba `/api/erp/test` para verificar conectividad
2. **Segundo**: Prueba `/api/erp/login` para verificar credenciales
3. **Tercero**: Prueba `/api/erp/pedidos` para verificar token Bearer
4. **Cuarto**: Prueba `/api/erp/pvp` para verificar endpoint de artículos

### Probar desde el Navegador

También puedes probar directamente en el navegador (solo GET):
- `https://tu-proyecto.vercel.app/api/erp/test`
- `https://tu-proyecto.vercel.app/api/erp/pedidos`
- `https://tu-proyecto.vercel.app/api/erp/pvp?codigo=0004223500340`

## Logs y Debugging

Ver logs en tiempo real:
1. Ve a tu proyecto en Vercel
2. Deployments → (último deployment)
3. Functions → `/api/config`, `/api/erp/test`, `/api/erp/login`, `/api/erp/pedidos`, `/api/erp/pvp`
4. Revisa los logs

### Depurar error de conexion ERP (funciona por URL pero no desde Vercel)

Si la URL del ERP responde en el navegador (ej: `https://api.tudominio.com:5002/api/tienda/v1/test`) pero `/api/erp/test` en Vercel devuelve 502:

1. **Ver la respuesta de error**: Llama a `GET https://tu-proyecto.vercel.app/api/erp/test` y abre la respuesta JSON. Incluye un objeto `debug` con:
   - `urlAttempted`: URL que esta usando Vercel (comprueba que sea la correcta).
   - `baseUrlFromEnv`: Valor de `ERP_BASE_URL` (comprueba que no tenga espacios, que sea `https://...` y que no incluya `/test` al final).
   - `errorCode` / `errorMessage`: motivo del fallo.

2. **Comprobar variable en Vercel**: En Settings → Environment Variables, `ERP_BASE_URL` debe ser exactamente la base **sin** `/test`, por ejemplo:
   - Correcto: `https://api.saneamiento-martinez.com:5002/api/tienda/v1`
   - Incorrecto: `https://api.saneamiento-martinez.com:5002/api/tienda/v1/test` (el endpoint anade `/test`).

3. **Error de certificado SSL**: Si en `debug.errorCode` o en el mensaje aparece algo como `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `certificate has expired` o `self signed certificate`, el servidor ERP usa un certificado que Node.js (en Vercel) no acepta. Soluciones:
   - Que el ERP use un certificado SSL valido (ej: Let's Encrypt) para ese dominio y puerto.
   - Si es entorno interno y no puedes cambiar el certificado, se puede desactivar la verificacion SSL solo para esa peticion (no recomendado en produccion); en ese caso se puede anadir una opcion con variable de entorno.

4. **Redeploy**: Despues de cambiar cualquier variable de entorno, haz un nuevo deploy para que las funciones usen el valor actualizado.

## Alternativa: Configuración Manual (sin serverless)

Si prefieres no usar la función serverless, puedes hardcodear las credenciales:

1. Edita `config.js`:
```javascript
SUPABASE_URL: 'https://tu-proyecto.supabase.co',
SUPABASE_ANON_KEY: 'tu-anon-key-aqui',
```

2. Deploy normalmente

⚠️ **NO recomendado si el repositorio es público**, ya que las credenciales quedarán expuestas.

## Soporte

Si tienes problemas:
- Revisa los logs en Vercel
- Revisa la consola del navegador (F12)
- Verifica que las variables de entorno están configuradas
- Consulta la documentación de Vercel: https://vercel.com/docs

