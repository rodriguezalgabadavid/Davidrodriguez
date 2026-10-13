# PadelFit 🎾

**La red social del pádel**, al estilo Strava: comparte tus partidos y entrenos con foto, recibe "¡Vamos!" y comentarios de tus amigos, completa retos y logros, y prepárate físicamente con planes específicos para pádel. Los planes generales son gratis; el **plan personalizado Premium** cuesta 19,99 €/mes.

App web (PWA) sin paso de compilación ni dependencias: HTML, módulos ES y CSS. Se instala en el móvil desde el navegador.

**Diseño**: la esencia de Strava llevada al pádel. Azul de pista como color de marca, amarillo bola para lo que se celebra, tipografía Barlow (alojada en la app) e iconos propios. Contraste AA en modo claro y oscuro, y auditoría automática WCAG 2.1 AA sin incidencias. Detalles en [docs/DESIGN.md](docs/DESIGN.md).

## Qué tiene

- **Muro social**: tus actividades y las de la gente que sigues, con resultado, foto, texto, "¡Vamos!" y comentarios. Sugerencias de jugadores a los que seguir.
- **Publicar en segundos**: partido, entreno o clase → ¿victoria o derrota? → foto y texto opcionales. Marcador por sets, compañero, rivales, club, duración y esfuerzo dentro de "Más detalles".
- **El enganche**: racha de semanas seguidas, retos semanales y mensuales con ranking entre amigos, logros, notificaciones y una celebración al publicar con lo que has desbloqueado.
- **Entrenar**: planes generales gratuitos (primeros pasos, pretemporada, piernas explosivas, hombro sano, tercer set), sesiones rápidas y una biblioteca de más de 50 ejercicios, con temporizador guiado.
- **Premium (19,99 €/mes)**: un cuestionario (objetivo, días, minutos, nivel, molestias, material y partidos por semana) genera un plan de 4 semanas que se adapta a tus molestias y a tu carga de partidos. Pago y gestión con Stripe.
- **Perfil**: estadísticas (racha, partidos ganados y perdidos, horas), logros, compañeros y actividades. Ajustes de perfil, preferencias y suscripción.

## Modo demo y modo real

- **Demo** (por defecto, sin configurar nada): todo se guarda en el dispositivo, con una comunidad de jugadores **de ejemplo** que reaccionan a lo que publicas y un pago Premium **simulado** (no se cobra nada). Todo lo de ejemplo se marca como tal en la app.
- **Real**: cuentas con enlace mágico o código por email, base de datos y fotos en **Supabase**, y cobro con **Stripe**. Paso a paso en [docs/SETUP.md](docs/SETUP.md).

## Uso

```bash
npm start        # sirve la app en http://localhost:8080
npm test         # tests de la lógica y del backend demo (node:test, sin dependencias)
```

Hace falta un servidor: abrir `index.html` con doble clic (`file://`) no funciona.

**GitHub Pages**: el workflow `.github/workflows/pages.yml` pasa los tests y publica la app en cada push a la rama principal. Para activarlo una vez: *Settings → Pages → Build and deployment → Source: GitHub Actions*. Hasta entonces el paso de publicar se salta con un aviso.

## Estructura

```
index.html                 Shell de la app (cabecera, barra inferior, temporizador)
js/app.js                  Router por hash con historial, delegación de eventos y contexto de las vistas
js/views/                  Una vista por pantalla (muro, actividad, publicar, retos, entrenar, premium, perfil…)
js/components.js           Tarjeta de actividad y acciones globales (¡Vamos!, seguir…)
js/backend/local.js        Backend demo (localStorage + comunidad de ejemplo en demo-data.js)
js/backend/supabase.js     Backend real (Supabase + Stripe Payment Links)
js/activities.js           Modelo de actividad, marcador, saneado de datos
js/stats.js                Rachas, resúmenes, carga de entrenamiento y logros
js/challenges.js           Retos semanales y mensuales y rankings
js/plans.js                Planes generales y plan personalizado Premium
js/generator.js, data.js   Generador de sesiones de físico y biblioteca de ejercicios
js/player.js               Temporizador de intervalos a pantalla completa
supabase/migrations/       Esquema SQL con RLS, triggers de notificaciones y Storage
supabase/functions/        Webhook de Stripe (Edge Function)
docs/ARCHITECTURE.md       Contratos entre módulos: vistas, backend, modelos y esquema
docs/SETUP.md              Cómo poner en marcha Supabase, Stripe y GitHub Pages
docs/DESIGN.md             Guía de diseño: identidad, tipografía, componentes y accesibilidad
tests/                     Tests (node --test)
```

> PadelFit no sustituye el consejo de un preparador físico o fisioterapeuta. Si tienes una lesión, consulta antes de entrenar.
