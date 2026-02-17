# Vista PC y uso en escritorio

La web app esta pensada para movil pero es util tambien en PC. A partir de **1024px** de ancho de ventana se aplican estilos de escritorio.

## Comportamiento en PC (min-width: 1024px)

- **Cabecera y fondo a ancho completo**: El header y el fondo de la app ocupan todo el ancho de la pantalla.
- **Contenido limitado y centrado**: El cuerpo (listas, formularios, carrito, etc.) tiene un ancho maximo de 900px y esta centrado, para que no llegue a los bordes de la pantalla y se lea bien.
- **Barra de navegacion inferior mas grande**: La barra de botones (Caja, Buscar, Carrito, Escanear) es mas alta (100px), con iconos y etiquetas mas grandes para uso con raton en escritorio.
- **Menu lateral**: El sidebar tiene 360px de ancho y, cuando esta cerrado, queda completamente fuera de vista (no se ve ningun borde a la derecha).
- **Login (gate)**: El formulario de entrada puede ser un poco mas ancho (420px) y el titulo algo mas grande.

## Breakpoints en `styles.css`

- **768px**: Tablet; app centrada con max-width 480px.
- **1024px**: Desktop; cabecera y cuerpo a ancho completo; barra de navegacion mas alta y botones mas grandes.

No se requiere cambio de codigo JS: la misma app responde al ancho de la ventana.
