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

## Logs y Debugging

Ver logs en tiempo real:
1. Ve a tu proyecto en Vercel
2. Deployments → (último deployment)
3. Functions → `/api/config`
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

