# Vista PC y uso en escritorio

La web app esta pensada para movil pero es util tambien en PC. A partir de **1024px** de ancho de ventana se aplican estilos de escritorio.

## Comportamiento en PC (min-width: 1024px)

- **Cabecera y cuerpo a ancho completo**: El header y el area de contenido ocupan todo el ancho de la pantalla (de lado a lado), sin columnas centradas.
- **Barra de navegacion inferior mas grande**: La barra de botones (Caja, Buscar, Carrito, Escanear) es mas alta (100px), con iconos y etiquetas mas grandes para uso con raton en escritorio.
- **Login (gate)**: El formulario de entrada puede ser un poco mas ancho (420px) y el titulo algo mas grande.
- **Menu lateral**: El sidebar del menu tiene 360px de ancho en desktop.

## Breakpoints en `styles.css`

- **768px**: Tablet; app centrada con max-width 480px.
- **1024px**: Desktop; cabecera y cuerpo a ancho completo; barra de navegacion mas alta y botones mas grandes.

No se requiere cambio de codigo JS: la misma app responde al ancho de la ventana.
