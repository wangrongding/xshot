# xshot

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.pt-BR.md">Português (Brasil)</a> |
  <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="./public/logo-full.png" alt="xshot" width="360" />
</p>

<p align="center">
  <strong>Una herramienta de capturas de escritorio ligera, residente y cómoda.</strong>
</p>

xshot es una herramienta de capturas de escritorio con captura rápida, selección de ventana/región, anotaciones, captura con desplazamiento, recorte, fijar en pantalla, copiar al portapapeles y guardar. Está pensada para usarse desde la bandeja y con un atajo global.

## Documentación Multilingüe

El README en chino simplificado es la fuente de referencia de la documentación. Cuando cambien las descripciones de funciones, notas de instalación, limitaciones o la hoja de ruta, actualiza primero `README.md` y después sincroniza las versiones en English, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Português (Brasil) y Русский.

## Funciones Principales

- ✅ Admite captura con desplazamiento.
- ✅ Permite fijar capturas como ventanas flotantes siempre visibles.
- ✅ Admite OCR, reconocimiento de códigos QR, traducción de texto y superposición de traducción sobre el texto original.
- ✅ Incluye herramientas de anotación: marcador numerado, flecha, rectángulo, línea, texto, lápiz, borrador y mosaico por área.
- ✅ Admite detección de ventanas al pasar el cursor: mueve el cursor sobre una ventana candidata y haz clic para seleccionarla.
- ✅ Admite marcas de agua visibles y ocultas: las capturas exportadas pueden añadir texto transparente o incrustar una marca detectable en el dominio de frecuencia.

![screenshot/xshot.jpeg](./screenshot/xshot.jpeg)

## Uso

Después de iniciarse, xshot se ejecuta desde la bandeja. Puedes empezar una captura así:

- Pulsa el atajo global predeterminado `Option + X` / `Alt + X`.

## Permisos de Plataforma e Instalación

- Si macOS indica que no puede verificar al desarrollador, abre `Configuración del Sistema` -> `Privacidad y seguridad` y elige `Abrir igualmente`.
- Si la app aún no se abre, ejecuta `xattr -dr com.apple.quarantine /Applications/xshot.app` e inténtalo de nuevo.
- En macOS, la primera captura puede requerir permiso de grabación de pantalla; se recomienda reiniciar la app después de concederlo.
- En macOS, la captura con desplazamiento requiere permiso de accesibilidad para supervisar/filtrar eventos de rueda y permitir que la ventana bajo la selección reciba el desplazamiento.
- El OCR usa macOS Vision; la traducción requiere acceso de red y usa Google Translate de forma predeterminada.
- El interruptor del icono del Dock solo se aplica a macOS.
- La ruta principal de captura actual solo trabaja con la pantalla principal. El soporte multimonitor sigue mejorándose.
- La detección de ventanas al pasar el cursor depende de la enumeración de ventanas del sistema, por lo que algunas ventanas del sistema, capas superpuestas o apps en pantalla completa pueden comportarse de forma distinta.

## Ajustes

- Atajo: haz clic en editar, introduce una nueva combinación de teclas y guarda para aplicarla al instante.
- Restablecer atajo: restaura `Option + X` / `Alt + X`.
- Icono del Dock: en macOS permite controlar si el icono de la app se muestra en el Dock.
- Iniciar al acceder: inicia xshot automáticamente después de iniciar sesión.
- Ubicación de guardado predeterminada: las capturas descargadas se guardan primero en la carpeta indicada; si no se define, se usa Downloads.
- Marca de agua visible: añade texto transparente personalizado al copiar, descargar o fijar una captura; admite esquinas, mosaico horizontal y mosaico diagonal.
- Marca de agua oculta: incrusta texto personalizado al copiar, descargar o fijar una captura. La página de ajustes puede detectar marcas ocultas desde una imagen; si el resultado detectado es largo, se muestra completo al hacer hover solo cuando está truncado.
- Idioma de la interfaz: actualmente admite chino simplificado e English.
- Permisos: en macOS puedes ver el estado de grabación de pantalla y accesibilidad, y abrir directamente el panel correspondiente de Configuración del Sistema.

## Flujo de Captura Actual

- Al iniciar, la app crea y oculta el WebView de captura, y reutiliza esa ventana cuando empieza una captura.
- En macOS, la captura normal usa actualmente `screencapture -x -R <screenshot-window-rect>` del sistema; el resultado se escribe primero como PNG temporal y luego se carga en la capa de edición del frontend.
- En Windows / Linux, la ruta actual captura la pantalla mediante `xcap` y codifica PNG en Rust.
- En macOS, la captura con desplazamiento hace que la ventana de captura sea transparente al ratón y solo deja pasar eventos de rueda hacia abajo. Cada fotograma intenta capturar primero el contenido bajo la ventana de captura con CoreGraphics `CGWindowListCreateImage`; si falla, vuelve a `screencapture -R`.
- La captura larga se une añadiendo nuevas filas según el desplazamiento vertical real entre dos fotogramas. Los desplazamientos pequeños no actualizan el fotograma anterior, lo que evita añadir demasiado contenido por texturas repetidas o fondos blancos.
- Después de generarse, la captura larga entra en la vista de recorte/edición; copiar y guardar exportan el área de recorte actual.
- Fijar una captura escribe el PNG exportado en un directorio temporal y crea una ventana Tauri independiente, sin borde, siempre visible y disponible en todos los espacios para mostrar la imagen.
- Las marcas de agua se aplican solo en la exportación final y cubren copiar, descargar y fijar en pantalla. OCR, reconocimiento QR y traducción siguen usando la selección original para evitar interferencias.
- La ruta principal de marca oculta incrusta bits en pares de coeficientes DCT de luminancia de frecuencia media en bloques 8x8, repite header y cuerpo, y restaura bits por voto mayoritario durante la detección. El payload incluye magic, longitud y checksum; la ruta LSB antigua queda como fallback de compatibilidad para imágenes pequeñas y exportaciones antiguas.
- El OCR usa `VNRecognizeTextRequest` de macOS Vision, priorizando accurate y recurriendo a fast si falla; el reconocimiento de QR usa `VNDetectBarcodesRequest`.
- La traducción la gestiona el backend Rust mediante Google Translate y admite el proxy del sistema. La superposición de traducción genera anotaciones de texto editables y reversibles a partir de las coordenadas OCR block; al hacer clic de nuevo se elimina la superposición generada.
- El flujo de captura conserva registros de tiempo por etapa para localizar latencia en el atajo, la captura de pantalla, la decodificación de imagen y la presentación de ventana.
- ScreenCaptureKit se probó anteriormente, pero la calidad y el beneficio no fueron suficientes, por lo que la ruta principal conserva el fallback estable.

## Desarrollo

Requisitos de Tauri: <https://v2.tauri.app/start/prerequisites/>

Requisitos:

- Node.js
- pnpm
- Rust
- Dependencias de sistema de Tauri v2

Comandos habituales:

```bash
pnpm install       # Instalar dependencias
pnpm dev           # Iniciar entorno de desarrollo Tauri
pnpm dev:web       # Iniciar solo el frontend Vite
pnpm build:web     # Compilar frontend
pnpm build         # Compilar app de escritorio
pnpm tsc           # Comprobación de TypeScript
pnpm format        # Prettier + cargo fmt
```

Estructura del proyecto:

```text
src/                    Frontend React
src/windows/            Ventana de captura
src/logic/              Ajustes, atajos, cursor y otra lógica frontend
src/logic/watermark.ts  Renderizado de marca visible, inserción y detección de marca oculta
src-tauri/              Backend Tauri / Rust
src-tauri/src/lib.rs    Captura, bandeja, portapapeles, registro de comandos de ventana
src-tauri/src/ocr.rs    OCR macOS Vision / reconocimiento QR
src-tauri/src/translation.rs  Servicio de traducción
public/                 Recursos gráficos de la app
```

## Limitaciones Actuales

- El soporte multimonitor sigue incompleto.
- La captura con desplazamiento es actualmente una capacidad centrada en macOS y depende de permisos de grabación de pantalla y accesibilidad; por ahora solo admite unión hacia abajo.
- El OCR es actualmente una capacidad centrada en macOS; la traducción depende de la red y de la disponibilidad de Google Translate.
- Los cambios de propiedades de anotación se aplican al instante, pero todavía no se registran como acciones independientes en la pila de deshacer.
- La marca de agua oculta sirve para trazabilidad y detección ligeras, no como DRM ni prevención de manipulación. La recodificación PNG/JPEG/WebP al mismo tamaño es más robusta que la antigua ruta LSB, pero redimensionado fuerte, recorte, rotación, compresión intensa, filtros o capturas secundarias pueden romper la detección.
- Ajustes avanzados como formato de imagen, opciones de inicio y personalización de barra de herramientas aún no están expuestos.
- La captura de ventana depende de la detección de ventanas candidatas; unas pocas ventanas transparentes, capas del sistema o espacios en pantalla completa pueden no coincidir con precisión.

## Hoja de Ruta

- Completar la captura multimonitor y el mapeo de coordenadas.
- Añadir ajustes de formato y calidad de imagen.
- Integrar los cambios de propiedades de anotación en una pila de deshacer/rehacer más completa.
- Admitir más estilos de anotación y configuración de la barra de herramientas.
- Mejorar paquetes de instalación, flujo de publicación y validación de compatibilidad de plataformas.

## Stack Tecnológico

- Tauri v2
- React 19
- TypeScript
- Vite
- Fabric.js
- lucide-react
- i18next / react-i18next
- xcap / image
- Tauri autostart / dialog / global-shortcut / clipboard-manager / opener plugins
- ai-ins Vite plugin
