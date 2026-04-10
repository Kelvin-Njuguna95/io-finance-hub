import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Server signOut error:', error);
    }
  } catch (error) {
    console.error('Server signOut exception:', error);
  }

  return NextResponse.redirect(`${origin}/login`);
}
