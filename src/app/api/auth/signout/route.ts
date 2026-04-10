import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Clear all Supabase auth cookies
  const response = NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"), {
    status: 302,
  });

  // Delete every sb-* cookie to prevent middleware from re-authenticating
  const cookieNames = ["sb-access-token", "sb-refresh-token"];
  for (const name of cookieNames) {
    response.cookies.delete(name);
  }

  // Also clear cookies that match the Supabase project pattern
  response.headers.append(
    "Set-Cookie",
    "sb-access-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
  );
  response.headers.append(
    "Set-Cookie",
    "sb-refresh-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax"
  );

  return response;
}
