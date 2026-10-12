# PadelFit — Guía de diseño

**La esencia de Strava, para el pádel.** Fondo gris claro, tarjetas blancas limpias, datos grandes y legibles, un solo color de marca con energía y nada que distraiga de lo que hiciste en la pista. Elegante por sobriedad, accesible para todas las edades y niveles de vista.

## Identidad

- **Azul de pista** (`--primary`) es la marca: botones principales, pestaña activa, enlaces y barras de progreso.
- **Amarillo bola** (`--accent`) es la celebración: el "¡Vamos!" dado, la racha, los logros conseguidos, la insignia PRO y la fase de trabajo del temporizador. Usarlo poco. Encima siempre texto oscuro (`--on-accent`).
- **La pista** (`.court` en `css/components.css`) es nuestro "mapa": la ilustración de un partido. Se puede reutilizar como cabecera decorativa (bienvenida, Premium) con `--court` y `--court-deep`.
- Todo color sale de los tokens de `css/styles.css`. Nunca colores literales salvo blanco o negro sobre fotos o sobre la pista. Los tokens ya cumplen contraste AA en claro y en oscuro.

## Tipografía

- `--font-body` (Barlow) para todo el texto. Cuerpo a 1rem (16 px). El texto secundario nunca baja de 0.875rem, y las etiquetas en mayúsculas de 0.75rem.
- `--font-display` (Barlow Semi Condensed) para títulos (h1-h3, ya aplicado) y **cifras grandes**: estadísticas, marcadores, contadores, precios y cuenta atrás. Con `font-variant-numeric: tabular-nums` cuando las cifras se alinean.
- Jerarquía al estilo Strava:
  - **etiqueta pequeña gris encima, cifra grande debajo** (`.stats-row`, `.stat-label`, `.stat-value`);
  - secciones con un título de sección (`h2`, 1.3rem) o una `.label` en mayúsculas;
  - pocos pesos: 400, 500, 600 y 700.

## Estructura de pantalla

- La **barra superior** (de `app.js`) ya muestra el título de la pantalla y, en las pantallas secundarias, la flecha de volver. Las vistas **no** repiten el título de la página como `h1` grande ni ponen su propio enlace "← Volver". El `h1` de la página es el de la barra superior: dentro de las vistas se usa `h2` para las secciones (excepción: la bienvenida, que no tiene título arriba).
- Contenido en una columna de máximo 640 px con 16 px de margen lateral (`.view`). Las secciones son tarjetas (`.card`) o listas sin tarjeta separadas por títulos de sección. No meter tarjetas dentro de tarjetas.
- Listas al estilo Strava: filas de al menos 56 px con avatar o icono a la izquierda, texto en dos líneas (nombre en negrita y detalle en gris) y una acción o chevron a la derecha, separadas por una línea fina (`border-bottom: 1px solid var(--border)`).
- La barra inferior mide `--tabbar-h`. Cualquier elemento fijo o pegajoso abajo (botón Publicar, caja de comentario) va por encima con `bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))` y nunca la tapa.

## Componentes base disponibles (`css/styles.css` y `css/components.css`)

- `card`, `row-between`, `stats-row` / `stat-label` / `stat-value`, `label`, `muted`.
- `btn` con las variantes `primary`, `accent`, `ghost`, `danger`, `solid` y `big`; `link`; `actions` (+ `wrap`); `icon-plain` (botón redondo de icono de 44 px); `icon-btn` (temporizador).
- Formularios: `field`, `field-label`, `field-row`, `input`, `hint`, `form-error`, `chips`/`chip` (`on` o `aria-pressed`), `chip-radio`, `segmented` (con `button.on` o `label > input + span`), `switch`, `sets-input`, `score-input`.
- `pill`, `pills`, `tag`, `dot`, `result` (`win`/`loss`/`draw`), `premium-badge`, `progress` (+ `thin`), `banner`, `scoreboard`, `badges`/`badge` (`on`), `avatar` (`sm`/`md`/`lg`), `empty-state` (vía `ui.emptyState`), `loading`, `sheet`, `toast`, `confirm`.
- Tarjeta de actividad (`components.activityCard`) y pista con marcador (`.court`, `.court-board`…): no se tocan desde las áreas.

## Iconos

- `import { icon } from '../icons.js'` → `icon('racket', { size: 20 })`. Son SVG de línea que heredan el color. Nombres en `ICON_NAMES`: home, trophy, plus, dumbbell, user, users, search, bell, racket (el "¡Vamos!"), comment, back, chevron, camera, clock, flame, calendar, sliders, crown, check, close, trash, ball, bolt, target, pin, image, play, pause, next, prev, medal, lock, logout, edit, share, list, info.
- Iconos en la interfaz (botones, cabeceras de sección, metadatos), **no emojis**. Los emojis solo se permiten como "arte" de logros y retos (`badge-icon`, icono de un reto) y en la celebración.
- Un botón con solo icono lleva `aria-label`. Si lleva texto, el icono es decorativo (ya tiene `aria-hidden`).

## Accesibilidad (obligatorio)

- Zonas táctiles de 44×44 px como mínimo. Los botones principales de una pantalla miden 52 px de alto (`btn big`).
- El color nunca es la única señal: victoria y derrota llevan texto, y lo seleccionado lleva peso o borde además de color.
- Foco visible: ya hay `:focus-visible` global; no quitarlo con `outline: none` salvo que se ponga otro igual de visible.
- Todo campo tiene su `<label>`. Los errores van en `role="alert"`. Los botones conmutables llevan `aria-pressed`.
- Las animaciones respetan `prefers-reduced-motion` (la regla global ya las anula; no usar JS para animar).
- Texto que crece al 200 % sin cortarse: nada de alturas fijas en contenedores de texto. Truncar con elipsis solo en nombres largos de una línea, y con el nombre completo en `title`.

## Tono visual

- Bordes de 1 px `--border`, radios `--radius` (tarjetas) y `--radius-sm` (botones y campos), sombra mínima `--shadow`. Sin degradados salvo en la pista y en la cabecera de Premium.
- Mucho aire: 16 px dentro de las tarjetas y 12 px entre bloques.
- Una sola acción principal (`btn primary`) por pantalla. Las demás, secundarias (`btn`) o `ghost`.
