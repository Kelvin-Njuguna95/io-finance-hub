// ============================================================
// Shared admin (service-role) Supabase client and auth helpers
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client with the service-role key.
 * Bypasses RLS — use only in API routes, never on the client.
 */
export function createAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export type AuthError = { error: { message: string; status: number } };
export type AuthSuccess = { user: /* // */ any; profile: /* // */ any; admin: SupabaseClient };

/**
 * Extract the auth token from a request, verify it, and return the
 * Supabase auth user together with the matching `users` table profile.
 *
 * Returns `{ user, profile, admin }` or `{ error: { message, status } }`.
 * Check with `'error' in result` to discriminate.
 */
export async function getAuthUserProfile(
  request: Request,
): Promise<AuthError | AuthSuccess> {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) {
    return { error: { message: 'Unauthorized', status: 401 } };
  }

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) {
    return { error: { message: 'Unauthorized', status: 401 } };
  }

  const { data: profile } = await admin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return { error: { message: 'User not found', status: 404 } };
  }

  return { user, profile, admin };
}

/**
 * Assert that the user profile has one of the allowed roles.
 * Returns a structured 403 error object when the check fails, or `null`
 * when the role is allowed.
 */
export function assertRole(
  profile: { role: string },
  allowedRoles: string[],
): { message: string; status: 403 } | null {
  if (!allowedRoles.includes(profile.role)) {
    return { message: 'Not authorized for this action', status: 403 };
  }
  return null;
}

/**
 * Query `month_closures` and return a structured error when the month
 * is `closed` or `locked`. Returns `null` when the month is safe to
 * write to (status is `open`, `under_review`, or no record exists).
 *
 * This matches the existing guard in `cfo-revert/route.ts`.
 */
export async function assertMonthOpen(
  admin: SupabaseClient,
  yearMonth: string,
): Promise<{ message: string; status: 400 } | null> {
  const { data: monthClosure } = await admin
    .from('month_closures')
    .select('status')
    .eq('year_month', yearMonth)
    .single();

  if (monthClosure?.status === 'closed' || monthClosure?.status === 'locked') {
    return {
      message: `Month ${yearMonth} is ${monthClosure.status}. ${
        monthClosure.status === 'locked'
          ? 'Reopen the month first.'
          : 'The month must be reopened before changes can be made.'
      }`,
      status: 400,
    };
  }

  return null;
}
