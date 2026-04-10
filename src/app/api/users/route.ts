import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-errors';

// Admin client using service role key — only used server-side
function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: Request) {
  // Verify the caller is an authenticated CFO
  // Accept token from Authorization header (since browser client uses localStorage)
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized — no token provided' }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const { data: { user: authUser }, error: authError } = await adminClient.auth.getUser(token);

  if (authError || !authUser) {
    return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
  }

  const { data: callerProfile } = await adminClient
    .from('users')
    .select('role')
    .eq('id', authUser.id)
    .single();

  if (callerProfile?.role !== 'cfo') {
    return NextResponse.json({ error: 'Only CFOs can create users' }, { status: 403 });
  }

  // Parse request body
  const body = await request.json();
  const { email, password, full_name, role, director_tag } = body;

  if (!email || !password || !full_name || !role) {
    return NextResponse.json({ error: 'Email, password, name, and role are required' }, { status: 400 });
  }

  // Password comes as PIN + 'io' (6 chars), validate the PIN part
  if (password.length !== 6 || !/^\d{4}io$/.test(password)) {
    return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
  }

  const validRoles = ['cfo', 'accountant', 'team_leader', 'project_manager'];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();

    // Create auth user with admin API
    const { data: newAuthUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (authError) {
    return NextResponse.json({ error: 'Failed to create authentication user', code: 'AUTH_CREATE_FAILED' }, { status: 400 });
    }

    // Create profile record in public.users
    const { error: profileError } = await adminClient
      .from('users')
      .insert({
        id: newAuthUser.user.id,
        email,
        full_name,
        role,
        director_tag: director_tag || null,
      });

    if (profileError) {
      // Rollback: delete the auth user if profile creation fails
      await adminClient.auth.admin.deleteUser(newAuthUser.user.id);
      return NextResponse.json({ error: 'Failed to create user profile', code: 'PROFILE_CREATE_FAILED' }, { status: 400 });
    }

    // Audit log
    await adminClient.from('audit_logs').insert({
      user_id: authUser.id,
      action: 'user_created',
      table_name: 'users',
      record_id: newAuthUser.user.id,
      new_values: { email, full_name, role, director_tag: director_tag || null },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: newAuthUser.user.id,
        email,
        full_name,
        role,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to create user.', 'USER_CREATE_ERROR');
  }
}
