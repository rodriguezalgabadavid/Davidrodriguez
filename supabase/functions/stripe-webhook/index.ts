// Webhook de Stripe → Supabase: mantiene al día la suscripción Premium (19,99 €/mes).
//
// Qué hace: verifica la firma de Stripe y, con la clave service role (la única que puede escribir
// premium_until), guarda la suscripción en `subscriptions` y fija `profiles.premium_until`.
// La app considera Premium a quien tiene premium_until > now().
//
// Despliegue (ver docs/SETUP.md):
//   supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase functions deploy stripe-webhook --no-verify-jwt
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY las pone Supabase automáticamente.

import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});
// Deno no tiene el crypto de Node: la firma se comprueba con Web Crypto (de ahí el "Async").
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Estados de Stripe que dan acceso Premium.
const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // 1. Verificar la firma con el cuerpo en bruto (antes de parsear nada).
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error('falta la cabecera stripe-signature');
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    console.error('Firma de Stripe no válida:', errorMessage(err));
    return new Response('Bad signature', { status: 400 });
  }

  // 2. Procesar el evento.
  try {
    await handleEvent(event);
  } catch (err) {
    // Error temporal (Stripe o la base de datos no responden): con 500 Stripe reintenta más tarde.
    console.error(`Error procesando ${event.type} (${event.id}):`, errorMessage(err));
    return new Response('Webhook handler failed', { status: 500 });
  }
  return Response.json({ received: true });
});

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    // Pago completado en el Payment Link. La app añade ?client_reference_id=<uid de Supabase>.
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const subscriptionId = idOf(session.subscription);
      if (!userId || !UUID.test(userId) || !subscriptionId) {
        console.warn(`Checkout ${session.id} sin client_reference_id válido o sin suscripción: se ignora.`);
        return;
      }
      await syncSubscription(userId, subscriptionId);
      return;
    }

    // Renovación, cancelación programada, impago o baja definitiva.
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await syncKnownSubscription(subscription.id);
      return;
    }

    // Cobro mensual correcto: alarga premium_until hasta el nuevo fin de periodo.
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice & {
        parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
      };
      // Versiones antiguas de la API: invoice.subscription. Desde 2025: invoice.parent.subscription_details.
      const subscriptionId = idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
      if (subscriptionId) await syncKnownSubscription(subscriptionId);
      return;
    }

    default:
      console.log(`Evento no usado, se ignora: ${event.type}`);
  }
}

// Eventos sin client_reference_id: el usuario se busca por el id de la suscripción.
async function syncKnownSubscription(subscriptionId: string) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // Puede llegar antes que checkout.session.completed, que es quien la registra: no pasa nada.
    console.warn(`Suscripción ${subscriptionId} aún sin usuario asociado: se ignora.`);
    return;
  }
  await syncSubscription(data.user_id, subscriptionId);
}

// Lee el estado actual en Stripe (así da igual el orden en que lleguen los eventos) y lo guarda.
async function syncSubscription(userId: string, subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const now = new Date().toISOString();
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
  // Activa (aunque esté programada su cancelación): Premium hasta el final del periodo pagado.
  // Cancelada, impagada o incompleta: Premium termina ya.
  const premiumUntil = ACTIVE_STATUSES.has(subscription.status) ? periodEnd : now;

  const { error: subscriptionError } = await supabase.from('subscriptions').upsert({
    user_id: userId,
    stripe_customer_id: idOf(subscription.customer),
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: periodEnd,
    updated_at: now,
  });
  if (subscriptionError?.code === '23503') {
    // El uid no existe en auth.users: reintentar no lo arreglará.
    console.warn(`Usuario ${userId} no existe: suscripción ${subscription.id} sin asociar.`);
    return;
  }
  if (subscriptionError) throw subscriptionError;

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ premium_until: premiumUntil })
    .eq('id', userId);
  if (profileError) throw profileError;

  console.log(`Usuario ${userId}: suscripción ${subscription.status}, premium_until=${premiumUntil}`);
}

// Stripe devuelve unas veces el id y otras el objeto expandido.
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
