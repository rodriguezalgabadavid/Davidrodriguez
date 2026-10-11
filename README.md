# PadelFit 🎾

App web (PWA) de **preparación física específica para pádel**. Genera sesiones a tu medida, te guía con un temporizador de intervalos y registra tu progreso. Sin dependencias ni servidor: todo se guarda en tu dispositivo y funciona sin conexión.

## Funcionalidades

- **Generador de sesiones**: elige objetivo, nivel, duración (15–60 min) y el material que tienes. Cada sesión incluye calentamiento, bloque principal por rondas y vuelta a la calma.
  - Objetivos: sesión completa, agilidad en pista, potencia y salto, core y golpeo, prevención de lesiones y resistencia de partido.
  - Niveles: iniciación (30s/30s), intermedio (40s/20s) y avanzado (45s/15s).
- **Temporizador guiado**: pantalla completa con cuenta atrás, avisos sonoros y vibración, aviso de "cambia de lado" en ejercicios unilaterales, siguiente ejercicio y pantalla siempre encendida (Wake Lock).
- **Biblioteca de +50 ejercicios** con explicación técnica y por qué te sirve en pista, filtrables por categoría y buscables.
- **Progreso**: racha de días, objetivo semanal, minutos por día de la semana e historial con esfuerzo percibido (RPE 1–10).
- **Instalable y offline**: añádela a la pantalla de inicio del móvil.

## Uso

```bash
npm start        # sirve la app en http://localhost:8080
npm test         # tests unitarios (node:test, sin dependencias)
```

Cualquier servidor estático vale (GitHub Pages, Netlify…). Los módulos ES y el service worker no funcionan abriendo el `index.html` directamente con `file://`.

## Estructura

```
index.html            Shell de la app
css/styles.css        Estilos (modo claro/oscuro, mobile first)
js/data.js            Ejercicios, categorías, niveles y objetivos
js/generator.js       Generación de sesiones y línea de tiempo del temporizador
js/stats.js           Racha, resumen semanal y estadísticas
js/app.js             Vistas, navegación, reproductor y persistencia (localStorage)
sw.js                 Service worker para uso sin conexión
tests/                Tests de generador y estadísticas
```

Para añadir ejercicios basta con ampliar `EXERCISES` en `js/data.js`; el generador los incorpora automáticamente según su categoría, nivel y material.

> Esta app no sustituye el consejo de un preparador físico o fisioterapeuta. Si tienes una lesión, consulta antes de entrenar.
