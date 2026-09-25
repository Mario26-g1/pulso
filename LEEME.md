# Copia Clara 2.2

Escáner de DNI y documentos que funciona dentro del celular. Las fotos, el texto leído y los PDF se procesan en el propio teléfono: no hay servidor, cuentas ni publicidad.

## Qué trae

- **Cámara en vivo** con detección de bordes, captura automática opcional, recuadro guía del DNI horizontal o vertical (recorta solo al capturar) y linterna (si el celular la tiene).
- **Recorte preciso**: detecta el documento, afina las esquinas, **toca el documento para encontrarlo en fondos estampados**, lupa al arrastrar, girar, cambiar el tipo (DNI, A4, Carta, libre).
- **Filtros**: Documento (quita sombras y deja el papel blanco), Original, Color vivo, Grises, Blanco y negro, más brillo y contraste.
- **Historial** guardado en el celular, con opción de no guardar nada.
- **Leer texto (OCR)** en español, sin internet después de la primera vez. Nombra el archivo con el número de DNI.
- **Firmas**: dibuja con el dedo, guarda tus firmas y colócalas en cualquier página.
- **Exportar**: PDF o JPG, calidad Alta, Equilibrada o Liviana (muestra el peso), DNI anverso y reverso en una hoja a tamaño real, marca de agua y PDF con texto buscable.
- **Herramientas**: unir PDF del celular, unir escaneos, leer texto de una foto.

## Actualizar tu repositorio de GitHub (si ya subiste la versión 1)

1. Descomprime el ZIP en tu computadora.
2. Entra a tu repositorio en GitHub y toca **Add file → Upload files**.
3. Abre la carpeta `copia-clara`, selecciona **todo su contenido** (Ctrl + A) y arrástralo a GitHub. Los archivos con el mismo nombre se reemplazan solos.
4. Revisa que en la lista aparezcan rutas como `js/app.js`, `css/app.css` y `vendor/tesseract/lang/spa.traineddata.gz`.
5. Toca **Commit changes**. GitHub Pages publica la nueva versión en 1 o 2 minutos.
6. En el celular, abre la app con internet dos veces: la primera descarga la versión nueva y la segunda ya la usa.

## Publicarla desde cero

1. Crea un repositorio público en GitHub.
2. **Add file → Upload files** y arrastra todo el contenido de la carpeta `copia-clara` (no la carpeta en sí).
3. **Commit changes**.
4. **Settings → Pages → Branch: main, / (root) → Save**.
5. Tu dirección será `https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`.

## Instalar en el celular

- **Android (Chrome):** abre la dirección y toca **Instalar**, o menú ⋮ → **Instalar aplicación**. Al mantener presionado el ícono aparecen accesos directos: «Escanear DNI» y «Escanear documento».
- **iPhone (Safari):** Compartir → **Agregar a inicio**.

La cámara pide permiso la primera vez. Si lo niegas, la app ofrece usar la cámara del celular o la galería.

## Lector de texto sin internet

La primera vez que lees texto, la app descarga el lector en español (unos 6 MB) y lo guarda. Para dejarlo listo antes, entra a **Herramientas → Lector de texto sin internet**, idealmente con Wi-Fi.

## Actualizar el código en el futuro

Si cambias cualquier archivo, abre `sw.js` y sube el número de `VERSION` (por ejemplo, de `'v2.0.0'` a `'v2.0.1'`). Sin ese paso, los celulares siguen usando la versión guardada.

## Archivos

| Carpeta o archivo | Contenido |
|---|---|
| `index.html`, `css/app.css` | Pantallas y estilos |
| `js/app.js` | Navegación, pantallas y flujo de la app |
| `js/geometry.js` | Detección de bordes y enderezado de perspectiva |
| `js/enhance.js` | Filtros: quitar sombras, color, blanco y negro |
| `js/render.js` | De la foto a la página final |
| `js/camera.js` | Cámara en vivo |
| `js/ocr.js` | Lectura de texto y número de DNI |
| `js/pdf.js` | Crear PDF y JPG, unir PDF |
| `js/sign.js` | Firma con el dedo |
| `js/store.js` | Historial guardado en el celular (IndexedDB) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y uso sin internet |
| `vendor/` | jsPDF 2.5.1 (MIT), pdf-lib 1.17.1 (MIT), Tesseract.js 6 (Apache 2.0), datos de idioma español de Tesseract (Apache 2.0), tipografía IBM Plex (SIL OFL) |

## Privacidad

- Ninguna foto ni texto sale del celular. No hay analítica ni rastreo.
- El historial vive en el almacenamiento del navegador de ese celular. **Ajustes → Borrar todos los escaneos y firmas** lo elimina.
- Si desinstalas la app o borras los datos del navegador, se borran los escaneos guardados.
