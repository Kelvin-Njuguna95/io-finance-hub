import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Build absolute URL from the incoming request so it works on any host
  const loginUrl = new URL("/login", request.nextUrl.origin);

  const response = NextResponse.redirect(loginUrl, { status: 302 });

  // Expire every Supabase cookie the browser may hold
  const cookieStore = request.cookies;
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      response.cookies.delete(cookie.name);
    }
  }

  return response;
}
