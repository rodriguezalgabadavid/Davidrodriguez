# PadelFit 🎾

Tu pádel en un solo sitio, al estilo Strava: **registra tus partidos, sigue tus estadísticas y entrena la preparación física específica para pádel**. Es una app web (PWA) sin dependencias: se instala en el móvil, funciona sin conexión y tus datos se guardan en tu dispositivo.

## Funcionalidades

### Muro de actividad
- Partidos, clases técnicas y sesiones de físico en un mismo muro, con resultado, tiempo, esfuerzo y carga.
- Resumen semanal: actividades, horas, carga, partidos ganados/perdidos, comparación con la semana anterior y objetivo semanal.
- Gráfico de minutos por día y tipo de actividad.

### Registro de partidos
- Marcador por sets (incluye súper tie-break), tipo (amistoso, liga, torneo, americana), posición (drive/revés), compañero, rivales y club, con autocompletado de nombres ya usados.
- Esfuerzo percibido (escala de Borg CR-10) y sensaciones.
- Editar y eliminar actividades.

### Estadísticas
- Porcentaje de victorias, racha actual y mejor racha, últimos 5 resultados, sets y juegos a favor/en contra, balance por posición.
- Balance con cada compañero y contra cada rival.
- **Carga de entrenamiento** (minutos × esfuerzo, método sRPE) de las últimas 8 semanas y ratio carga aguda/crónica con aviso de sobrecarga.
- Logros: remontada, rosco, rachas, torneos, sesiones de físico…

### Preparación física
- Generador de sesiones por objetivo (agilidad, potencia, core, prevención, resistencia…), nivel, duración y material disponible.
- Temporizador guiado a pantalla completa con avisos sonoros, vibración y "cambia de lado".
- Biblioteca de más de 50 ejercicios explicados con su aplicación en pista.

### Tus datos
- Copia de seguridad descargable y restaurable (JSON), para no perder el historial o pasarlo a otro móvil.
- Datos de ejemplo para probar la app vacía.

## Uso

```bash
npm start        # sirve la app en http://localhost:8080
npm test         # tests unitarios (node:test, sin dependencias)
```

Abrir `index.html` directamente con `file://` no funciona (módulos ES y service worker necesitan un servidor).

### Publicación en GitHub Pages
El workflow `.github/workflows/pages.yml` ejecuta los tests y publica la app en cada push a la rama principal. Para activarlo una única vez: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Estructura

```
index.html            Shell de la app
css/styles.css        Estilos (modo claro/oscuro, mobile first)
js/app.js             Estado, persistencia (localStorage), navegación y eventos
js/views.js           Vistas: muro, registro, detalle, progreso, entrenar, ejercicios
js/activities.js      Modelo de actividades y partidos (marcador, carga, normalización)
js/stats.js           Estadísticas, carga semanal, ratio agudo/crónico y logros
js/generator.js       Generador de sesiones físicas y línea de tiempo del temporizador
js/player.js          Temporizador de intervalos a pantalla completa
js/data.js            Ejercicios, categorías, niveles y objetivos
js/ui.js              Utilidades de interfaz (formato, diálogos, avisos)
sw.js                 Service worker para uso sin conexión
tests/                Tests de lógica
```

> Esta app no sustituye el consejo de un preparador físico o fisioterapeuta. Si tienes una lesión, consulta antes de entrenar.
