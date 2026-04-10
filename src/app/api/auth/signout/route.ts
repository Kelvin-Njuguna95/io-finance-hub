import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

async function signOutAndRedirect(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const loginUrl = new URL("/login", request.nextUrl.origin);
  const response = NextResponse.redirect(loginUrl, { status: 302 });

  // Expire every Supabase cookie the browser may hold
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      response.cookies.delete(cookie.name);
    }
  }

  return response;
}

// Support both POST (fetch) and GET (direct navigation)
export async function POST(request: NextRequest) {
  return signOutAndRedirect(request);
}

export async function GET(request: NextRequest) {
  return signOutAndRedirect(request);
}
