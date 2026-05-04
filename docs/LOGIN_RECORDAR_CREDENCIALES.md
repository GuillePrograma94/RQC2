# Recordar usuario y contrasena en el login (gate)

## Motivacion

En iOS Safari, las **PWA instaladas en pantalla de inicio no comparten el llavero**
con el navegador, por lo que el autofill nativo del usuario/contrasena no funciona
ni aparece el dialogo "Guardar contrasena". Ademas, al usar `e.preventDefault()` en
el submit (login por JS contra `api/auth/login`), Safari tampoco dispara el guardado.

Para resolverlo se anade un check **"Recordar usuario y contrasena"** en el gate
que persiste las credenciales en `localStorage` del propio dispositivo.

## Donde vive el codigo

- HTML del gate: `scan_client_mobile/index.html` (formulario `#gateLoginForm`,
  checkbox `#gateRememberMe` y caja visual `.gate-remember-box`).
- Estilos del check: bloque `.gate-remember*` en `scan_client_mobile/styles.css`.
  El control nativo va invisible encima de una caja dibujada en CSS, con
  `appearance: none` y `-webkit-appearance: none` para que iOS/Android no pinten
  el checkbox del sistema (cuadrado blanco al pulsar). Estado marcado: fondo
  verde claro (`#bbf7d0`), borde `#22c55e` y tick SVG verde (`#15803d`) para que
  quede muy claro que "Recordar" esta activo.
- Logica: clase `ScanAsYouShopApp` en `scan_client_mobile/js/app.js`:
  - `setupGateScreen()` llama a `prefillRememberedCredentials()` al inicializar.
  - `showLanding()` tambien re-precarga (cubre logout / sesion expirada).
  - `handleLogin()` llama a `persistRememberedCredentials(codigo, password)` solo
    tras un login con exito (no se guardan credenciales invalidas).

## Clave de almacenamiento

```
localStorage[ "scan_remember_credentials" ] = JSON.stringify({ codigo, password })
```

La constante esta expuesta como `ScanAsYouShopApp.REMEMBER_CREDS_KEY` para que
cualquier cleanup explicito pueda referenciarla.

## Comportamiento

| Evento | Que ocurre con las credenciales recordadas |
| --- | --- |
| Login con exito y check **activo** | Se guardan `codigo` y `password` en `localStorage`. |
| Login con exito y check **inactivo** | Se elimina la clave del `localStorage`. |
| Login con error | No se modifica el `localStorage` (evita borrar lo bueno por un typo). |
| Logout (`logout()`) | **No** se borran. Asi al volver a entrar se prerellenan otra vez. |
| Sesion expirada (`handleSessionExpired()`) | **No** se borran. Mismo motivo. |
| Carga inicial / mostrar gate | `prefillRememberedCredentials()` rellena los campos y marca el check si hay datos validos. Si no hay datos, deja el check **activado por defecto** para fomentar el opt-in. |

## Compatibilidad y limitaciones

- Funciona igual en titulares, operarios, comerciales, dependientes y administracion
  porque actua sobre los inputs `#gateCodigo` y `#gatePassword`, no sobre el tipo de
  usuario.
- En PWA iOS la unica forma fiable de recordar credenciales es esta (no hay acceso al
  llavero), por eso se usa `localStorage` y no la Credential Management API.
- Si el dispositivo es compartido, el usuario puede desmarcar el check y al siguiente
  login con exito se borraran las credenciales guardadas.
- Para limpiar manualmente desde devtools o servicio:
  `localStorage.removeItem('scan_remember_credentials')`.

## Build / despliegue

`build.js` copia `index.html`, `styles.css` y `js/` hacia `public/` durante el build
de Vercel. **Solo hay que editar los archivos raiz**; no se debe tocar `public/`
manualmente.
