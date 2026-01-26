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

**NOTA IMPORTANTE**: El endpoint de crear pedido aún no está disponible en el ERP. 
Los endpoints disponibles actualmente son solo para pruebas:
- `POST /api/tienda/v1/login` - Obtener token
- `GET /api/tienda/v1/test` - Probar conectividad
- `GET /api/tienda/v1/pedidos/prueba` - Probar pedidos (con token)
- `GET /api/tienda/v1/articulos/pvp?codigo=XXX` - Obtener PVP (con token)

Cuando el endpoint de crear pedido esté listo, solo necesitarás configurar `ERP_CREATE_ORDER_PATH`.

| Key | Value | Estado |
|-----|-------|--------|
| `ERP_BASE_URL` | Base URL del ERP (ej: `http://IP:PUERTO/api/tienda/v1`) | Requerido |
| `ERP_LOGIN_PATH` | Ruta de login del ERP: `/login` | Requerido |
| `ERP_CREATE_ORDER_PATH` | Ruta de creación de pedidos (aún no disponible) | Opcional por ahora |
| `ERP_USER` | Usuario del ERP (ej: `TIENDA_PRU`) | Requerido |
| `ERP_PASSWORD` | Contraseña del ERP | Requerido |
| `ERP_REQUEST_TIMEOUT_MS` | Timeout en ms (ej: `15000`) | Opcional |

Variable opcional para el frontend:

| Key | Value |
|-----|-------|
| `ERP_PROXY_PATH` | Endpoint proxy del ERP (default: `/api/erp/create-order`) |

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

Una vez desplegado, puedes probar los endpoints del ERP que están disponibles:

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
**Endpoint**: `GET https://tu-proyecto.vercel.app/api/erp/pedidos-prueba`

Prueba el endpoint `GET /api/tienda/v1/pedidos/prueba`. Hace login automáticamente.

**Ejemplo con curl**:
```bash
curl https://tu-proyecto.vercel.app/api/erp/pedidos-prueba
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
3. **Tercero**: Prueba `/api/erp/pedidos-prueba` para verificar token Bearer
4. **Cuarto**: Prueba `/api/erp/pvp` para verificar endpoint de artículos

### Probar desde el Navegador

También puedes probar directamente en el navegador (solo GET):
- `https://tu-proyecto.vercel.app/api/erp/test`
- `https://tu-proyecto.vercel.app/api/erp/pedidos-prueba`
- `https://tu-proyecto.vercel.app/api/erp/pvp?codigo=0004223500340`

## Logs y Debugging

Ver logs en tiempo real:
1. Ve a tu proyecto en Vercel
2. Deployments → (último deployment)
3. Functions → `/api/config`, `/api/erp/test`, `/api/erp/login`, `/api/erp/pedidos-prueba`, `/api/erp/pvp`
4. Revisa los logs

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

