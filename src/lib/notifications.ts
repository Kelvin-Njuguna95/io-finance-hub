// ============================================================
// Notification helper — creates notification records
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js';

interface CreateNotificationParams {
  userId: string;
  title: string;
  body?: string;
  type: string;
  entityType?: string;
  entityId?: string;
  projectId?: string;
  link?: string;
}

/**
 * Insert a notification record for a user.
 * Uses the admin (service-role) client so RLS INSERT is allowed.
 */
export async function createNotification(
  supabase: SupabaseClient,
  params: CreateNotificationParams,
) {
  const { error } = await supabase.from('notifications').insert({
    user_id: params.userId,
    title: params.title,
    body: params.body || null,
    type: params.type,
    entity_type: params.entityType || null,
    entity_id: params.entityId || null,
    project_id: params.projectId || null,
    link: params.link || null,
  });
  if (error) {
    console.error('[createNotification] error:', error.message);
  }
}

/**
 * Notify all users with a given role.
 */
export async function notifyRole(
  supabase: SupabaseClient,
  role: string,
  params: Omit<CreateNotificationParams, 'userId'>,
) {
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .eq('role', role)
    .eq('is_active', true);

  for (const u of users || []) {
    await createNotification(supabase, { ...params, userId: u.id });
  }
}

/**
 * Notify a specific list of user IDs.
 */
export async function notifyUsers(
  supabase: SupabaseClient,
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>,
) {
  for (const uid of userIds) {
    await createNotification(supabase, { ...params, userId: uid });
  }
}
