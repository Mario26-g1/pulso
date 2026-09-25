# Copia Clara

Escáner de DNI y documentos que funciona dentro del celular. Las fotos no se suben a ningún servidor: todo el recorte, los filtros y el PDF se hacen en el propio teléfono.

## Publicarla gratis en GitHub Pages (15 minutos, sin usar comandos)

1. Crea una cuenta gratis en https://github.com si no tienes una.
2. Arriba a la derecha toca **+** y luego **New repository**.
   - Nombre: `copia-clara`
   - Marca **Public** (GitHub Pages gratis necesita repositorio público; el código no contiene datos de nadie).
   - Toca **Create repository**.
3. En la página del repositorio nuevo, toca **uploading an existing file**.
4. Descomprime el ZIP en tu computadora y **arrastra todo el contenido de la carpeta `copia-clara`** (no la carpeta en sí): `index.html`, `manifest.webmanifest`, `sw.js`, `LEEME.md` y las carpetas `icons` y `vendor`.
5. Toca **Commit changes**.
6. Ve a **Settings → Pages**. En *Branch* elige `main` y carpeta `/ (root)`, y toca **Save**.
7. Espera 1 o 2 minutos y recarga esa misma página. Aparecerá tu dirección, por ejemplo:
   `https://TU-USUARIO.github.io/copia-clara/`

Esa es la dirección que compartes con tus compañeros.

## Instalarla en el celular

- **Android (Chrome):** abre la dirección. Aparece el aviso «Instalar» dentro de la app o en el menú ⋮ → **Instalar aplicación**.
- **iPhone (Safari):** abre la dirección, toca **Compartir** y elige **Agregar a inicio**.

Después de abrirla una vez con internet, funciona sin conexión.

## Actualizarla

1. Sube los archivos cambiados al repositorio (se reemplazan).
2. Abre `sw.js` y cambia `const VERSION = 'v1';` a `'v2'`, `'v3'`, etc. Sin este paso, los celulares siguen usando la versión guardada.
3. Los celulares toman la versión nueva la segunda vez que abren la app con internet.

## Qué hay en cada archivo

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Toda la app: interfaz, recorte, filtros y PDF |
| `manifest.webmanifest` | Nombre, ícono y colores al instalarla |
| `sw.js` | Guarda la app en el celular para usarla sin internet |
| `vendor/jspdf.umd.min.js` | Librería que genera el PDF (jsPDF 2.5.1, licencia MIT) |
| `vendor/fonts/` | Tipografía IBM Plex (licencia SIL Open Font) |
| `icons/` | Íconos de la app |

## Privacidad

- Ninguna foto sale del celular. No hay servidor, base de datos ni analítica.
- Al cerrar la app no queda nada guardado, salvo los archivos que tú descargues.
- GitHub solo entrega los archivos de la app, igual que cualquier página web.
