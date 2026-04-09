import type { SupabaseClient } from '@supabase/supabase-js';

export async function getRedFlags(supabase: SupabaseClient, resolved: boolean, limit?: number) {
  let query = supabase
    .from('red_flags')
    .select('*')
    .eq('is_resolved', resolved)
    .order('created_at', { ascending: false });

  if (typeof limit === 'number') {
    query = query.limit(limit);
  }

  return query;
}

export async function getActiveRedFlags(supabase: SupabaseClient, limit?: number) {
  return getRedFlags(supabase, false, limit);
}
