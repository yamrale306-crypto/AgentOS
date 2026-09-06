import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import env from './config.js';
import { unauthorized } from './errors.js';

export const supabaseAdmin: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export async function authenticateBearer(token: string): Promise<User> {
  if (!token) throw unauthorized('Missing bearer token.');
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw unauthorized('Invalid or expired authentication token. Please sign in again.');
  }
  return data.user;
}