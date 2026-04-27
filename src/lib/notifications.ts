// ============================================================
// Notification helper — creates notification records
//
// Schema reality (per F-10): the notifications table has columns
// {id, user_id, title, message, link, ...} — not the {body, type}
// shape that migration 00010 attempted to introduce. See
// supabase/migrations/00040_revert_notifications_body_type.sql for
// the migration-tree reconciliation.
//
// All app code should route through createNotification (or the
// notifyRole / notifyUsers wrappers) rather than calling
// admin.from('notifications').insert() directly. This keeps the
// shape and error-logging consistent and prevents a recurrence of
// the F-10 drift family.
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js';

interface CreateNotificationParams {
  userId: string;
  title: string;
  message?: string;
  link?: string;
}

/**
 * Insert a notification record for a user.
 * Uses the admin (service-role) client so RLS INSERT is allowed.
 * Errors are logged via console.error and swallowed — callers do
 * not need to .error-check.
 */
export async function createNotification(
  supabase: SupabaseClient,
  params: CreateNotificationParams,
) {
  const { error } = await supabase.from('notifications').insert({
    user_id: params.userId,
    title: params.title,
    message: params.message ?? null,
    link: params.link ?? null,
  });
  if (error) {
    console.error('[createNotification] error:', error.message, { userId: params.userId, title: params.title });
  }
}

/**
 * Notify all active users with a given role.
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
