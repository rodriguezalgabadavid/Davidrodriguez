# PadelFit — Arquitectura (v3: red social)

PadelFit es una red social de pádel al estilo Strava: publicas partidos y entrenos (con foto), tus amigos te dan "¡Vamos!" y comentan, completas retos y logros, y entrenas con planes de preparación física (generales gratis, personalizado Premium a 19,99 €/mes).

App web sin build (HTML + módulos ES + CSS), mobile first, en español (tú). Dos backends intercambiables con la **misma interfaz**:

- **Demo** (`js/backend/local.js`): todo en `localStorage`, con una comunidad de ejemplo y pago simulado. Se usa cuando `js/config.js` no tiene Supabase configurado. Todo lo de ejemplo se marca en la UI como "ejemplo/demo".
- **Live** (`js/backend/supabase.js`): Supabase (Auth por enlace mágico, Postgres con RLS, Storage para fotos, Realtime para notificaciones) + Stripe Payment Links para Premium (webhook en una Edge Function).

## Principios de producto (obligatorios para la UI)

1. **Sencilla**: una acción principal por pantalla, textos cortos, botones grandes (≥ 44 px). Publicar un partido debe llevar < 15 segundos: tipo → ¿ganaste? → (opcional) resultado, foto, texto → Publicar. Lo demás va dentro de "Más detalles" (`<details>`).
2. **Hook (bucle de enganche)**:
   - *Disparador*: notificaciones (campana con contador), reto activo visible en el muro, racha semanal en riesgo ("Juega antes del domingo para mantener tu racha").
   - *Acción*: publicar en un toque (botón ＋ central).
   - *Recompensa variable*: "¡Vamos!" (kudos) y comentarios de amigos, logros desbloqueados, progreso de retos, pantalla de celebración tras publicar.
   - *Inversión*: racha de semanas, planes por completar, retos mensuales, perfil con estadísticas y logros.
3. **Social primero**: el muro muestra tus actividades y las de la gente que sigues; si sigues a pocos, sugiere jugadores.
4. **Honestidad**: en modo demo, la comunidad, las interacciones automáticas y el pago son simulados y se indica claramente.

## Navegación

Hash routing (`#ruta`). Los parámetros (p. ej. `id`) **no** van en el hash: se guardan en memoria (`ctx.params`). Una ruta con parámetros obligatorios sin ellos (recarga) redirige a `inicio`.

| Ruta | Archivo | Pestaña | Parámetros |
|---|---|---|---|
| `inicio` | `js/views/feed.js` | inicio | — |
| `actividad` | `js/views/activity.js` | inicio | `{ id }` |
| `notificaciones` | `js/views/notifications.js` | — | — |
| `buscar` | `js/views/search.js` | — | — |
| `publicar` | `js/views/publish.js` | publicar | `{ type? }` |
| `bienvenida` | `js/views/onboarding.js` | (sin tabbar) | — |
| `retos` | `js/views/challenges.js` | retos | — |
| `perfil` | `js/views/profile.js` | perfil | `{ id? }` (sin id = yo) |
| `ajustes` | `js/views/settings.js` | perfil | — |
| `entrenar` | `js/views/train.js` | entrenar | — |
| `ejercicios` | `js/views/exercises.js` | entrenar | — |
| `premium` | `js/views/premium.js` | entrenar | — |

Barra inferior (5): Inicio · Retos · ＋ (publicar) · Entrenar · Perfil. Cabecera: marca, botón buscar jugadores (`data-route="buscar"`), campana (`data-route="notificaciones"`) con contador `#notif-count`.

Si `backend.getAuthState()` no es `'ready'`, la app fuerza la ruta `bienvenida` y oculta la barra inferior.

## Contrato de vistas

Cada archivo de `js/views/` exporta por defecto:

```js
export default {
  route: 'inicio',
  tab: 'inicio',              // pestaña resaltada ('inicio'|'retos'|'publicar'|'entrenar'|'perfil'|null)
  async render(ctx) { return '<section>…</section>'; },   // HTML string (escapar SIEMPRE datos con escapeHtml)
  mount(root, ctx) {},        // opcional: tras insertar el HTML (listeners no delegables, foco, etc.)
  unmount() {},               // opcional: al salir de la vista (limpiar timers)
  actions: {                  // opcional
    // clic en [data-action="nombre"] dentro de la vista → actions.nombre(el, ctx, event)
    // envío de <form data-submit="nombre"> → actions.nombre(form, ctx, event)  (preventDefault ya hecho)
    // [data-input="nombre"] → evento 'input';  [data-change="nombre"] → evento 'change'
  },
};
```

La app (`js/app.js`) hace la delegación de eventos. Busca primero en `view.actions` y después en `globalActions` (de `js/components.js`). Navegación declarativa: cualquier elemento con `data-route="ruta"` navega; los atributos `data-param-*` se convierten en parámetros (`data-param-id="x"` → `{ id: 'x' }`).

### `ctx`

```js
{
  backend,            // instancia del backend (interfaz más abajo)
  me,                 // Profile del usuario actual (o null en 'bienvenida')
  params,             // parámetros de la ruta actual
  now,                // Date del render
  settings,           // { sound: bool, weeklyGoal: number } (preferencias locales)
  saveSettings(),     // persiste settings en localStorage
  navigate(route, params = {}),
  back(),             // vuelve atrás (o a 'inicio')
  rerender(),         // vuelve a renderizar la vista actual
  refreshMe(),        // Promise: recarga ctx.me desde el backend
  refreshBadge(),     // Promise: recarga el contador de notificaciones
  startSession(session, { onSave }),   // abre el temporizador (js/player.js); onSave({ title, focus, level, seconds, rpe })
  cache,              // objeto libre para memoizar datos entre renders de una misma vista
}
```

## Utilidades compartidas (ya existen; importar, no duplicar)

- `js/ui.js`: `escapeHtml`, `formatDuration(seconds)`, `formatHours(minutes)`, `formatWhen(date, now)`, `timeAgo(date, now)`, `toLocalInput(date)`, `askConfirm(msg, label, onYes)`, `toast(msg)`, `avatar(profileMin, size = 'md'|'sm'|'lg')`, `premiumBadge(profile)`, `emptyState({ icon, title, text, action })`, `sheet(html) → { el, close }` (hoja inferior modal), `loading()`.
- `js/photos.js`: `resizeImage(file, { maxSize = 1280, quality = 0.8 }) → Promise<Blob>`, `blobToDataUrl(blob) → Promise<string>`.
- `js/config.js`: `CONFIG` (`supabaseUrl`, `supabaseAnonKey`, `stripePaymentLink`, `stripeCustomerPortal`, `premiumPrice: '19,99 €'`, `premiumPeriod: 'mes'`, `appUrl`), `isDemo()`.
- `js/data.js` (ejercicios, `CATEGORIES`, `LEVELS`, `FOCUSES`, `EQUIPMENT`, `getExercise`), `js/generator.js` (`generateSession`, `buildTimeline`, `timelineDuration`, `formatTime`), `js/player.js` (usar vía `ctx.startSession`).

## Modelos (objetos JS que devuelve el backend)

```ts
ProfileMin = { id: string, name: string, avatarUrl: string|null, isPremium: boolean, demo?: true }

Profile = ProfileMin & {
  level: 1|2|3, position: 'drive'|'reves'|null, club: string, bio: string, createdAt: ISO,
  followersCount: number, followingCount: number, followedByMe: boolean, isMe: boolean,
}

Activity = {
  id: string, userId: string, author: ProfileMin, isMine: boolean,
  type: 'partido'|'clase'|'entreno',
  date: ISO,                 // cuándo se jugó/entrenó
  seconds: number,           // duración
  rpe: number|null,          // esfuerzo 1-10
  won: boolean|null,         // solo partido; null = sin resultado/empate
  sets: [number, number][],  // solo partido; [] si no se apuntó el marcador
  matchKind: 'amistoso'|'liga'|'torneo'|'americana'|null,
  partner: string, rivals: string[], club: string,
  title: string,             // '' = título automático (activityTitle)
  text: string,              // texto del post
  photoUrl: string|null,
  plan: { planId: string, sessionKey: string }|null,   // si viene de un plan
  focus: string|null,        // objetivo de la sesión de físico (FOCUSES)
  kudosCount: number, kudoedByMe: boolean, commentsCount: number,
  createdAt: ISO,
}

ActivityInput = campos editables de Activity: { type, date, seconds, rpe, won, sets, matchKind, partner, rivals, club, title, text, plan, focus }

Comment = { id, activityId, author: ProfileMin, text: string, createdAt: ISO, isMine: boolean }

Notification = { id, kind: 'kudos'|'comment'|'follow', actor: ProfileMin, activityId: string|null, preview: string, read: boolean, createdAt: ISO }

PlanState = { planId: string|null, startedAt: ISO|null, completed: { [sessionKey]: ISO }, finished: { planId: string, finishedAt: ISO }[] }

Subscription = { active: boolean, renewsAt: ISO|null, willRenew: boolean, paymentIssue: boolean, manageable: boolean, simulated: boolean }
// willRenew: no se ha cancelado para final de periodo. paymentIssue: cobro fallido (past_due), Premium sigue hasta el fin de periodo.
// manageable: tiene una suscripción viva en Stripe → se gestiona en el portal, nunca se ofrece pagar otra.
```

## Interfaz del backend

Todos los métodos son `async`. Los errores se lanzan como `Error` con un mensaje en español apto para mostrar al usuario.

```js
mode                                   // 'demo' | 'live'
init()                                 // conecta/carga datos; idempotente
getAuthState()                         // 'signed-out' | 'needs-profile' | 'ready'   (demo: nunca 'signed-out')
signInWithEmail(email)                 // live: envía enlace mágico + código de 6 cifras. demo: lanza Error
verifyEmailCode(email, code)           // live: entra con el código (app instalada en iPhone). demo: lanza Error
createProfile({ name, level, position, club })   // crea el perfil del usuario actual → Profile
getMe()                                // Profile | null
updateMe(patch)                        // patch ⊆ { name, level, position, club, bio } → Profile
signOut()                              // demo: borra la cuenta demo local
onAuthChange(cb)                       // cb(authState) cuando cambia la sesión

getProfile(userId)                     // Profile | null
searchPlayers(query)                   // ProfileMin[] (máx. 20, sin incluirme)
suggestedPlayers()                     // Profile[] (máx. 8, que aún no sigo)
follow(userId) / unfollow(userId)
getFollowing(userId) / getFollowers(userId)   // ProfileMin[]

getFeed({ before?, beforeId?, limit = 20 })   // Activity[] mías + de quien sigo, por (date, id) desc, anteriores al cursor (before, beforeId) = fecha e id de la última actividad cargada
getUserActivities(userId, { before?, beforeId?, limit = 20 })
getActivity(id)                        // Activity | null
getMyActivities()                      // Activity[] todas las mías (para estadísticas, retos y logros)
getCircleActivities({ from, to })      // Activity[] mías + de quien sigo con from <= date < to (rankings)
createActivity(input, photoBlob|null)  // → Activity
deleteActivity(id)

toggleKudos(activityId)                // → { kudoedByMe, kudosCount }
getKudoers(activityId)                 // ProfileMin[]
getComments(activityId)                // Comment[] (más antiguos primero)
addComment(activityId, text)           // → Comment  (1-500 caracteres)
deleteComment(commentId)

getNotifications({ limit = 50 })       // Notification[] (más recientes primero)
getUnreadCount()                       // number
markNotificationsRead()
subscribe(cb)                          // cb({ type: 'notification' | 'feed' }); devuelve función para cancelar

getJoinedChallenges()                  // string[] de instanceId (p. ej. 'partidos-mes:2026-10')
joinChallenge(instanceId) / leaveChallenge(instanceId)

getPlanState()                         // PlanState
startPlan(planId)                      // → PlanState (reinicia el progreso de ese plan)
completePlanSession(sessionKey, sessionKeys)     // → PlanState; sessionKeys = claves de las sesiones del plan actual; si están todas hechas, pasa a finished y planId = null
abandonPlan()                          // → PlanState

getSubscription()                      // Subscription
startCheckout()                        // live: redirige a Stripe Payment Link. demo: activa Premium simulado 30 días
checkoutPending() / clearCheckoutPending()   // live: ¿se volvió de pagar hace < 15 min? (esperar al webhook en vez de mostrar el paywall)
manageSubscription()                   // live: abre el portal de cliente de Stripe. demo: cancela el simulado
getPremiumAnswers() / savePremiumAnswers(answers)   // cuestionario del plan personalizado (privado)
```

Modo demo, interacciones simuladas: tras `createActivity`, 2-3 jugadores de ejemplo que sigues dan "¡Vamos!" y a veces uno comenta, en los siguientes 5-40 s. Se guardan como pendientes con `dueAt`, para que se apliquen aunque se recargue la página, y generan notificaciones y llaman a `subscribe`.

## Esquema de datos (Supabase)

Tablas (`supabase/migrations/001_init.sql`), todas con RLS:

- `profiles(id uuid pk → auth.users, name, avatar_url, level smallint 1-3, position 'drive'|'reves'|null, club, bio, premium_until timestamptz, active_plan_id text, active_plan_started_at timestamptz, created_at)`. Lectura: usuarios autenticados. Escritura: solo el propio perfil y **solo** las columnas `name, level, position, club, bio, active_plan_id, active_plan_started_at` (privilegios por columna; `avatar_url` no, hasta que haya subida de avatar). Empezar el plan `premium` exige Premium (trigger). `premium_until` solo lo cambia el webhook (service role). `isPremium = premium_until > now()`.
- `subscriptions(stripe_subscription_id pk, user_id, stripe_customer_id, status, current_period_end, cancel_at_period_end, updated_at)`: una fila por suscripción de Stripe. Lectura: el propio usuario. Escritura: solo service role. `premium_until` = fin de periodo más lejano de sus suscripciones `active`/`trialing`/`past_due`.
- `activities(id uuid, user_id, type, played_at, duration_seconds, rpe, won, sets jsonb, match_kind, partner, rivals text[], club, title, body, photo_path, plan_id, plan_session, focus, created_at)`. Lectura: autenticados. Insertar y borrar: el dueño.
- `kudos(activity_id, user_id, created_at, pk(activity_id, user_id))`, `comments(id, activity_id, user_id, body 1-500, created_at)`, `follows(follower_id, following_id, created_at, pk, follower≠following)`.
- `notifications(id, user_id destinatario, actor_id, kind, activity_id, preview, read, created_at)`. Las crean triggers `security definer` al insertar kudos, comments o follows (nunca para uno mismo). El destinatario solo puede leerlas y marcar `read`.
- `challenge_participants(user_id, challenge_id, joined_at)`, `plan_progress(user_id, plan_id, session_key, completed_at)`, `plan_finishes(user_id, plan_id, finished_at)`, `premium_answers(user_id pk, answers jsonb, updated_at)`: solo el propio usuario. Guardar respuestas del cuestionario y progreso del plan `premium` exige Premium (`is_premium()` en RLS).
- Storage: bucket público `photos`. Solo se sube o borra dentro de la carpeta `<uid>/`.

Mapeo de columnas a modelo: `played_at→date`, `duration_seconds→seconds`, `body→text`, `photo_path→photoUrl` (URL pública), `match_kind→matchKind`, `plan_id/plan_session→plan`.

Stripe: Payment Link de 19,99 €/mes. La app añade `?client_reference_id=<uid>&prefilled_email=<email>`. La Edge Function `stripe-webhook` verifica la firma y actualiza `subscriptions` y `profiles.premium_until` con `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` e `invoice.paid`.

## Lógica pura (con tests en `tests/`)

- `js/activities.js`: `ACTIVITY_TYPES`, `MATCH_KINDS`, `POSITIONS`, `parseSets(rows)`, `matchOutcome(sets)`, `formatScore(sets)`, `sessionLoad(a)`, `activityTitle(a)`, `normalizeActivityInput(input) → ActivityInput`, `fromLegacy(list) → ActivityInput[]` (datos guardados por v1/v2), `knownNames(activities)`.
- `js/stats.js`: `weeklyStreak(activities, now)`, `weekSummary`, `matchStats(activities)` (usa `won` explícito si no hay sets), `weeklyLoad`, `loadRatio`, `ACHIEVEMENTS`, `achievements(activities, { completedChallenges = [], finishedPlans = [] })`, `newlyUnlocked(before, after)`.
- `js/challenges.js`: `CHALLENGES`, `periodRange(period, now)`, `rangeFromInstanceId(instanceId)`, `instanceId(challenge, now)`, `challengeProgress(challenge, myActivities, now)`, `leaderboard(challenge, circleActivities, now)`, `completedChallenges(joinedIds, myActivities)`, `currentChallenges(now)`.
- `js/plans.js`: `PLANS`, `getPlan(planId)`, `planSessions(plan)`, `sessionForPlan(planSession)`, `planProgress(plan, planState)`, `nextPlanSession(plan, planState)`, `PREMIUM_QUESTIONS`, `personalizedPlan(answers, myActivities, now)` (devuelve un objeto con la misma forma que un plan, con `id: 'premium'`).

## Estilos

`css/styles.css` contiene los tokens (colores con modo claro/oscuro) y los componentes base: `card`, `btn` (`primary`, `big`, `ghost`, `danger`), `chip(s)`, `chip-radio`, `segmented`, `field`, `field-label`, `input`, `hint`, `muted`, `pill`, `label`, `progress`, `row-between`, `actions`, `link`, `banner`, `toast`, `confirm`, `result` (`win`/`loss`/`draw`), `scoreboard`, `metrics`, `badges`/`badge`, `type-badge`, temporizador (`player`…). Cada área añade su CSS en su propio archivo (`css/social.css`, `css/publish.css`, `css/train.css`, `css/profile.css`) con clases **prefijadas** por área (`feed-`, `post-`, `train-`, `prof-`, `ch-`…), usando solo tokens (`var(--…)`): nunca colores literales salvo sobre fotos.
