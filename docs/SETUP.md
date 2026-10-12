# Puesta en marcha de PadelFit (Supabase + Stripe)

Esta guía te lleva paso a paso de la app de demostración a una red social de verdad: cuentas de usuario, muro compartido, fotos, comentarios, notificaciones y la suscripción Premium de **19,99 €/mes**.

No hace falta saber programar. Necesitas unos 60–90 minutos, un ordenador y:

- una cuenta en [Supabase](https://supabase.com) (base de datos, usuarios y fotos; tiene plan gratuito),
- una cuenta en [Stripe](https://stripe.com/es) (cobros),
- acceso a este repositorio de GitHub (la app se publica en GitHub Pages).

URL de la app que usaremos en toda la guía:

```
https://rodriguezalgabadavid.github.io/Davidrodriguez/
```

> **Nunca pegues en el código ni en GitHub** la clave `service_role` / "secret" de Supabase ni las claves `sk_...` o `whsec_...` de Stripe. Solo van en los *secrets* de Supabase (paso 6). La clave pública de Supabase (`anon` o `publishable`) sí puede ir en `js/config.js`: está pensada para eso y los datos los protege la seguridad de la base de datos (RLS).

---

## 0. Modo demo: lo que pasa si no configuras nada

Si `js/config.js` no tiene `supabaseUrl` y `supabaseAnonKey`, la app arranca en **modo demo**:

- todo se guarda solo en ese móvil u ordenador (en el navegador),
- hay una comunidad de jugadores **de ejemplo** que te da "¡Vamos!" y comenta,
- el pago Premium es **simulado** (no se cobra nada),
- la app lo indica claramente con la etiqueta "demo"/"ejemplo".

Es perfecto para enseñar la idea o probarla. Para que tus amigos se sigan entre ellos y vean sus partidos, sigue los pasos de abajo.

---

## 1. Crear el proyecto en Supabase

1. Entra en [supabase.com/dashboard](https://supabase.com/dashboard) y pulsa **New project**.
2. Rellena:
   - **Name**: `padelfit`.
   - **Database Password**: genera una y **guárdala** en tu gestor de contraseñas.
   - **Region**: una de la UE (por ejemplo *Central EU (Frankfurt)* o *West EU (Paris/Ireland)*). Así los datos de tus usuarios se quedan en Europa (importante para el RGPD).
3. Pulsa **Create new project** y espera un par de minutos.
4. Apunta el **identificador del proyecto** (*project ref*): son las letras de la URL `https://<proyecto>.supabase.co`. Lo usarás en los pasos 6 y 7.

> En el plan gratuito, Supabase pausa el proyecto si pasa una semana sin uso. Se reactiva desde el panel. Cuando tengas usuarios reales, valora el plan de pago.

## 2. Crear las tablas (ejecutar la migración)

1. En el panel de Supabase abre **SQL Editor** → **New query**.
2. Abre el archivo [`supabase/migrations/001_init.sql`](../supabase/migrations/001_init.sql) de este repositorio, copia **todo** su contenido y pégalo en el editor.
3. Pulsa **Run**. Debe terminar con *Success*. Los avisos (*NOTICE ... does not exist, skipping*) son normales.
4. Comprueba que todo está:
   - **Table Editor**: 11 tablas (`profiles`, `activities`, `kudos`, `comments`, `follows`, `notifications`, `subscriptions`, `challenge_participants`, `plan_progress`, `plan_finishes`, `premium_answers`), todas con el candado de RLS activado.
   - **Storage**: un bucket público llamado `photos` (fotos de hasta 5 MB, JPG/PNG/WebP).
   - **Database → Publications → supabase_realtime**: incluye la tabla `notifications` (la campana se actualiza al momento).

El script se puede volver a ejecutar sin miedo: no borra datos.

Qué deja configurado, en cristiano:

- Cualquier usuario con sesión puede ver perfiles, partidos, fotos y comentarios; cada uno solo crea o borra lo suyo.
- Nadie puede darse Premium a sí mismo: la fecha `premium_until` solo la cambia el webhook de Stripe.
- Las notificaciones ("X te ha dado ¡Vamos!", "X ha comentado", "X te sigue") las crea la base de datos sola.
- Cada usuario solo puede subir fotos dentro de su propia carpeta.

## 3. Configurar el inicio de sesión (enlace mágico por email)

PadelFit no usa contraseñas: el usuario escribe su email y recibe un enlace para entrar.

1. **Authentication → Sign In / Providers → Email**: comprueba que está **activado** (lo está por defecto). Deja activado *Confirm email*.
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://rodriguezalgabadavid.github.io/Davidrodriguez/`
   - **Redirect URLs** → *Add URL*, añade:
     - `https://rodriguezalgabadavid.github.io/Davidrodriguez/**`
     - `http://localhost:8080/**` (para probar en tu ordenador con `npm start`)
3. **Authentication → Emails → Templates** (opcional pero recomendable): traduce al español las plantillas **Magic Link** y **Confirm signup** (la primera vez que alguien entra recibe la de *Confirm signup*). Por ejemplo:
   - Asunto: `Tu enlace para entrar en PadelFit`
   - Cuerpo:
     ```html
     <h2>¡Hola!</h2>
     <p>Toca el botón para entrar en PadelFit:</p>
     <p><a href="{{ .ConfirmationURL }}">Entrar en PadelFit</a></p>
     <p>Si no has pedido este correo, ignóralo.</p>
     ```
4. **Correo propio (SMTP), imprescindible antes de abrirlo a gente**: el servicio de correo que trae Supabase es solo para pruebas (envía muy pocos correos por hora y puede limitarse a las direcciones de tu equipo). Configura un proveedor (Resend, Brevo, Postmark, Amazon SES...) en **Authentication → Emails → SMTP Settings** con un remitente de tu dominio, por ejemplo `hola@tudominio.com`.

## 4. Conectar la app con Supabase (`js/config.js`)

1. En Supabase abre **Project Settings → API Keys** (o el botón **Connect** de la parte de arriba) y copia:
   - la **Project URL**: `https://<proyecto>.supabase.co`
   - la clave pública: la **publishable key** (`sb_publishable_...`) o, en la pestaña de claves *legacy*, la **anon public** (`eyJ...`). Cualquiera de las dos vale.
2. Edita `js/config.js` en GitHub (abre el archivo y pulsa el lápiz) y rellena:

```js
export const CONFIG = {
  supabaseUrl: 'https://<proyecto>.supabase.co',
  supabaseAnonKey: 'sb_publishable_...',      // o la clave anon "eyJ..."
  stripePaymentLink: '',                       // lo rellenas en el paso 5
  stripeCustomerPortal: '',                    // lo rellenas en el paso 5
  premiumPrice: '19,99 €',
  premiumPeriod: 'mes',
  appUrl: 'https://rodriguezalgabadavid.github.io/Davidrodriguez/',
};
```

3. Guarda (*Commit changes*). GitHub Pages vuelve a publicar la app en un par de minutos (la primera vez actívalo en **Settings → Pages → Source: GitHub Actions**).

Desde este momento la app ya no está en modo demo: pedirá tu email, te enviará el enlace y te pedirá nombre, nivel y posición. Ya puedes publicar partidos, subir fotos, seguir a gente, comentar y completar retos. Falta solo el cobro de Premium.

## 5. Stripe: producto, enlace de pago y portal de cliente

Hazlo todo primero en **modo de prueba** (interruptor *Test mode* / *Sandbox* arriba a la derecha en Stripe). No se cobra dinero real.

### 5.1 Crear el producto "PadelFit Premium"

1. **Product catalog → Add product**.
2. **Name**: `PadelFit Premium`. Descripción: `Plan de preparación física personalizado para pádel`.
3. Precio: **Recurring** (recurrente), **19,99 EUR**, **Monthly** (mensual).
4. En las opciones del precio, marca que el precio **incluye impuestos** (*Include tax in price: Yes*): en España, al consumidor final hay que mostrarle el precio con IVA incluido.
5. **Save product**.

### 5.2 Crear el Payment Link (enlace de pago)

1. **Payment Links → New** (o desde el producto, *Create payment link*).
2. Elige el precio de 19,99 €/mes.
3. Pestaña **After payment** → *Don't show confirmation page* → **Redirect customers to your website** y pon:
   ```
   https://rodriguezalgabadavid.github.io/Davidrodriguez/#premium
   ```
   Así, al pagar, el usuario vuelve directamente a la pantalla Premium de la app.
4. Opcional recomendado: en **Options**, activa *Require customers to accept your terms of service* (antes tienes que poner la URL de tus términos en **Settings → Business → Public details**).
5. **Create link** y copia la URL (`https://buy.stripe.com/test_...`). Pégala en `stripePaymentLink` de `js/config.js`.

La app añade sola al enlace `?client_reference_id=<id del usuario>&prefilled_email=<su email>`. Gracias a eso el webhook sabe a quién activar Premium. Por eso **el pago tiene que hacerse desde el botón de la app**, no compartiendo el enlace a mano.

### 5.3 Activar el portal de cliente (gestionar o cancelar)

1. **Settings → Billing → Customer portal**.
2. Activa: *Cancel subscriptions* (mejor *at end of billing period*, cancelar al final del periodo pagado), *Update payment methods* y *Invoice history*.
3. **Save** y, en el apartado *Customer portal link* / *Login link*, pulsa **Activate link** y copia la URL (`https://billing.stripe.com/p/login/test_...`).
4. Pégala en `stripeCustomerPortal` de `js/config.js` y guarda.

## 6. Desplegar la función del webhook en Supabase

La función [`supabase/functions/stripe-webhook/index.ts`](../supabase/functions/stripe-webhook/index.ts) recibe los avisos de Stripe y activa o desactiva Premium. Elige **una** de estas dos formas.

### Opción A: con la terminal (Supabase CLI)

Necesitas [Node.js](https://nodejs.org) instalado. Desde la carpeta del repositorio:

```bash
npx supabase login
npx supabase link --project-ref <proyecto>
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

- `--no-verify-jwt` es **obligatorio**: Stripe no envía la sesión de Supabase; la seguridad la da la firma de Stripe.
- Si te pide Docker, añade `--use-api` al comando de `deploy`.

### Opción B: desde el panel de Supabase (sin terminal)

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: `stripe-webhook` (exactamente así).
3. Borra el código de ejemplo, pega el contenido de `supabase/functions/stripe-webhook/index.ts` y pulsa **Deploy**.
4. En los detalles de la función, desactiva **Verify JWT** / *Enforce JWT verification* y guarda.

La URL de la función es:

```
https://<proyecto>.supabase.co/functions/v1/stripe-webhook
```

Las variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` las pone Supabase automáticamente. Las dos de Stripe las añades en el paso siguiente.

## 7. Webhook de Stripe y claves secretas

### 7.1 Crear el webhook en Stripe

1. En Stripe (modo de prueba): **Developers → Webhooks → Add endpoint** (en el panel nuevo: **Workbench → Webhooks → Add destination**, eventos de *Your account*, tipo *Webhook endpoint*).
2. **Endpoint URL**: `https://<proyecto>.supabase.co/functions/v1/stripe-webhook`
3. **Events**: selecciona exactamente estos cuatro:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
4. Guarda. En la página del webhook, en **Signing secret**, pulsa *Reveal* y copia el valor `whsec_...`.

### 7.2 Guardar las claves en Supabase

Necesitas dos valores:

- `STRIPE_SECRET_KEY`: en Stripe, **Developers → API keys → Secret key** (`sk_test_...` en pruebas).
- `STRIPE_WEBHOOK_SECRET`: el `whsec_...` del paso anterior.

Con la terminal:

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx STRIPE_WEBHOOK_SECRET=whsec_xxx
```

O desde el panel: **Edge Functions → Secrets** (*Manage secrets*) → añade las dos con esos nombres exactos.

No hace falta volver a desplegar la función (si dudas, repite el `deploy`: no pasa nada).

## 8. Probar el pago en modo de prueba

1. Abre la app, entra con tu email y ve a **Entrenar → Premium**.
2. Pulsa el botón de suscribirte. En la página de Stripe usa la tarjeta de prueba:
   - Número: `4242 4242 4242 4242`
   - Caducidad: cualquier fecha futura (p. ej. `12/34`)
   - CVC: cualquier número de 3 cifras; código postal: cualquiera.
   - Para probar la verificación del banco (3D Secure): `4000 0025 0000 3155`.
3. Stripe te devuelve a `.../#premium`. En unos segundos deberías ver Premium activo (si no, recarga).
4. Comprueba que todo ha ido bien:
   - Stripe → tu webhook → **Event deliveries**: los eventos con respuesta **200**.
   - Supabase → **Table Editor → subscriptions**: una fila con `status = active`.
   - Supabase → **Table Editor → profiles**: tu `premium_until` es dentro de un mes.
5. Prueba la cancelación: desde la app (gestionar suscripción → portal de Stripe) cancela. Si cancelas "al final del periodo", sigues siendo Premium hasta esa fecha. Si cancelas la suscripción de inmediato desde el panel de Stripe, `premium_until` pasa a "ahora" y el Premium se acaba al momento.

### Si algo falla

| Síntoma | Causa probable y solución |
|---|---|
| El enlace del email abre `localhost` o una página en blanco | Revisa **Site URL** y **Redirect URLs** (paso 3). |
| No llega el email | Mira en spam. Configura un SMTP propio (paso 3.4); el de Supabase tiene límites muy bajos. |
| El webhook responde **400** | El `STRIPE_WEBHOOK_SECRET` no es el de ese webhook (o mezclas prueba y real). Cópialo de nuevo. |
| El webhook responde **401** | La función se desplegó con verificación JWT. Repite el `deploy` con `--no-verify-jwt` o desactívala en el panel. |
| El webhook responde **500** | Mira **Edge Functions → stripe-webhook → Logs**. Stripe reintentará solo durante unos días. |
| Responde 200 pero no soy Premium | Se pagó sin pasar por el botón de la app (sin `client_reference_id`). Arreglo manual abajo. |
| No se suben fotos | Máximo 5 MB, formatos JPG/PNG/WebP. Comprueba que existe el bucket `photos` (paso 2). |

Arreglo manual de un pago no asociado (en **SQL Editor**):

```sql
-- 1) Busca el id del usuario por su email
select id from auth.users where email = 'persona@ejemplo.com';

-- 2) Asocia la suscripción de Stripe (ids sub_... y cus_... del panel de Stripe)
insert into public.subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status)
values ('<id del paso 1>', 'cus_...', 'sub_...', 'active')
on conflict (user_id) do update
  set stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id;
```

Después, en Stripe, abre el último evento `invoice.paid` de esa suscripción y pulsa **Resend** (reenviar): el webhook actualizará `premium_until`.

## 9. Pasar a cobros reales

Cuando todo funcione en pruebas (y hayas leído la sección siguiente):

1. Completa la activación de tu cuenta de Stripe (datos fiscales y cuenta bancaria).
2. Sal del modo de prueba y repite en **modo real** los pasos 5.1 (producto; Stripe permite copiarlo del modo de prueba), 5.2 (Payment Link), 5.3 (portal) y 7.1 (webhook: tendrá un `whsec_...` nuevo).
3. Actualiza los secrets con las claves reales (`sk_live_...` y el nuevo `whsec_...`) (paso 7.2).
4. Pon en `js/config.js` el Payment Link y el portal reales y guarda.
5. Haz una compra real tú mismo y cancélala para comprobar todo el circuito.

---

## Antes de cobrar de verdad

PadelFit guarda datos personales, fotos e información de entrenamiento, y vende una suscripción a consumidores en la UE. Esto es una lista orientativa, **no es asesoramiento legal**: antes de cobrar, revísalo con una **asesoría** (gestoría fiscal y un abogado o consultor de protección de datos).

**Documentos legales en la app**

- **Aviso legal** (LSSI): quién está detrás (nombre o razón social, NIF, dirección, email de contacto).
- **Política de privacidad** (RGPD y LOPDGDD): qué datos recoges y para qué, base legal, cuánto tiempo los guardas, con quién los compartes (Supabase, Stripe, GitHub, tu proveedor de email), transferencias fuera de la UE, y cómo ejercer los derechos de acceso, rectificación, supresión, portabilidad y oposición (y reclamar ante la AEPD). Ofrece una forma sencilla de **borrar la cuenta**.
- **Términos y condiciones** de uso y de la suscripción: precio con IVA, renovación mensual automática, cómo cancelar (portal de cliente) y qué pasa al cancelar (Premium hasta el final del periodo pagado).
- **Aviso de salud**: los planes no sustituyen a un médico, fisioterapeuta o preparador físico.

**Protección de datos (RGPD)**

- **Fotos**: el bucket `photos` es público (cualquiera con el enlace puede ver la imagen). Dilo claramente al subir. En las fotos salen otras personas: pide que solo se suban con su permiso y cuida especialmente a los menores. Ten un canal para **denunciar contenido** y retíralo rápido (la normativa europea de servicios digitales lo exige a quien aloja contenido de usuarios).
- **Datos de salud**: molestias, lesiones o sensaciones de esfuerzo (por ejemplo en el cuestionario del plan Premium) son **datos de categoría especial**. Necesitan consentimiento **explícito** y separado, pedir solo lo imprescindible y probablemente una evaluación de impacto.
- **Edad mínima**: en España, para consentir el tratamiento de datos hay que tener al menos 14 años.
- Firma o acepta los **contratos de encargado del tratamiento** (DPA) de Supabase, Stripe y el proveedor de email, y lleva un **registro de actividades de tratamiento**.
- **Cookies**: la app solo usa almacenamiento local necesario para funcionar (sesión y preferencias). Si algún día añades analítica o publicidad, necesitarás un banner de consentimiento.

**Suscripción y consumidores**

- **Derecho de desistimiento**: en la UE el consumidor tiene 14 días naturales para desistir de un contrato a distancia. En servicios digitales que empiezan al momento hay que **informarle** y obtener su **solicitud expresa** de empezar ya (por ejemplo con una casilla antes de pagar); si desiste, se le devuelve el importe o la parte proporcional según el caso. Desde junio de 2026 la normativa europea exige además una **función de desistimiento** (un botón) fácil de encontrar para los contratos hechos online. Tu asesoría te dirá cómo aplicarlo.
- **Cancelación** tan fácil como la contratación: el portal de cliente de Stripe lo cubre; enlázalo bien visible.
- Envía **recibo o factura** de cada cobro (Stripe puede enviarlos por email automáticamente).

**Impuestos (IVA)**

- En España el IVA general es del **21 %**: si 19,99 € incluye IVA, a ti te quedan unos **16,52 €** antes de comisiones.
- Si vendes a consumidores de **otros países de la UE**, a partir de 10.000 € al año en esas ventas se aplica el IVA del país del cliente y se declara por la **ventanilla única (OSS)**. Stripe Tax puede calcularlo por ti (tiene coste).
- Date de alta en Hacienda (y como autónomo o sociedad), emite facturas conforme a la normativa española (pregunta por **Verifactu**) y ten en cuenta las **comisiones de Stripe** al fijar el precio (consulta [stripe.com/es/pricing](https://stripe.com/es/pricing)).

**Seguridad**

- Mantén en secreto `service_role`, `sk_live_...` y `whsec_...`. Si alguna se filtra, regenérala en Supabase o Stripe y actualiza los secrets.
- Activa la verificación en dos pasos en GitHub, Supabase y Stripe.
