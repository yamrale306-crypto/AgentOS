import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;

  const url =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_URL) ||
    (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
    (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_SUPABASE_URL ||
    localStorage.getItem('agentos_supabase_url') ||
    '';

  const anonKey =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) ||
    (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_SUPABASE_ANON_KEY ||
    localStorage.getItem('agentos_supabase_anon_key') ||
    '';

  if (!url || !anonKey) {
    return null;
  }

  if (!cachedClient) {
    try {
      cachedClient = createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      });
    } catch (e) {
      console.warn('Failed to initialize Supabase client:', e);
      return null;
    }
  }

  return cachedClient;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseBrowser());
}
