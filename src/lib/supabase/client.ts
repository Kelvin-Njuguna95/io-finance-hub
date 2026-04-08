import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function createClient(): SupabaseClient<any, 'public', any> {
  if (client) return client;
  client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return client;
}
