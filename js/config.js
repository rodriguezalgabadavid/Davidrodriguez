// Configuración de servicios externos. Si Supabase no está configurado, la app funciona en modo demo
// (todo en este dispositivo, con una comunidad y un pago de ejemplo). Ver docs/SETUP.md.

export const CONFIG = {
  supabaseUrl: '',          // p. ej. https://xxxx.supabase.co
  supabaseAnonKey: '',      // clave pública "anon" del proyecto
  stripePaymentLink: '',    // Payment Link de la suscripción Premium (https://buy.stripe.com/...)
  stripeCustomerPortal: '', // enlace al portal de cliente de Stripe para gestionar o cancelar
  premiumPrice: '19,99 €',
  premiumPeriod: 'mes',
  appUrl: '',               // URL pública de la app (para el enlace mágico); vacío = la actual
};

export function isDemo() {
  return !CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey;
}
