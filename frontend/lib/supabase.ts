import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function getSupabaseBrowser() {
  return createBrowserClient(
    supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    supabaseKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  );
}