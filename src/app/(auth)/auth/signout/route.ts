import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const cookieStore = await cookies();
  const response = NextResponse.redirect(`${origin}/login`);

  // Create a Supabase client that writes cookie deletions onto the redirect response
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error('Server signOut exception:', error);
  }

  // Belt-and-suspenders: explicitly delete any Supabase auth cookies
  // that might remain (cookie names follow the pattern sb-<ref>-auth-token*)
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token')) {
      response.cookies.set(cookie.name, '', { maxAge: 0, path: '/' });
    }
  }

  return response;
}
