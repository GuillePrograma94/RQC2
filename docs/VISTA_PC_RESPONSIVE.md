# Vista PC y uso en escritorio

La web app esta pensada para movil pero es util tambien en PC. A partir de **1024px** de ancho de ventana se aplican estilos de escritorio.

## Comportamiento en PC (min-width: 1024px)

- **Contenedor centrado**: Header, area de contenido y navegacion inferior se limitan a **960px** de ancho maximo y se centran en la pantalla. El resto del fondo mantiene el color morado de la app.
- **Contenido mas ancho que en tablet**: En tablet (768px) el ancho maximo es 480px; en PC pasa a 960px para aprovechar la pantalla (carrito, listas, busqueda, caja).
- **Zonas de lectura**: Busqueda, checkout y lista de pedidos tienen un ancho maximo interno (560px / 720px) para que las lineas no sean demasiado largas y se lea bien.
- **Login (gate)**: El formulario de entrada puede ser un poco mas ancho (420px) y el titulo algo mas grande.
- **Modales**: Los modales (almacen, observaciones, enviar en ruta, etc.) se limitan a 480px en desktop para no estirarse en pantallas grandes.
- **Menu lateral**: El sidebar del menu tiene 360px de ancho en desktop.

## Breakpoints en `styles.css`

- **768px**: Tablet; app centrada con max-width 480px.
- **1024px**: Desktop; app centrada con max-width 960px y ajustes de padding y tipografia.

No se requiere cambio de codigo JS: la misma app responde al ancho de la ventana.
