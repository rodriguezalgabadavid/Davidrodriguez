import { CONFIG, isDemo } from '../config.js';

// Elige el backend: demo local (sin configuración) o Supabase (producción). Ambos cumplen la interfaz
// descrita en docs/ARCHITECTURE.md.
export async function createBackend() {
  if (isDemo()) {
    const { LocalBackend } = await import('./local.js');
    return new LocalBackend();
  }
  const { SupabaseBackend } = await import('./supabase.js');
  return new SupabaseBackend(CONFIG);
}
