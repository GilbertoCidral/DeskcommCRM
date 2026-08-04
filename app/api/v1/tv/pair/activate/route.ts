import { type NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Vercel injeta x-forwarded-host/proto com o host público real.
// req.nextUrl.host pode ser 0.0.0.0 internamente, então usamos os headers.
function publicOrigin(req: NextRequest): string {
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ||
    req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

// Chamado pelo server component /tv/par quando o código está confirmado.
// Seta o cookie tv_token (só Route Handler pode setar cookie com redirect).
export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");

  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.redirect(new URL("/tv/par", publicOrigin(req)));
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("tv_pairing_codes")
    .select("access_token")
    .eq("code", code)
    .eq("status", "confirmed")
    .gt("token_expires_at", new Date().toISOString())
    .maybeSingle();

  if (!data?.access_token) {
    return NextResponse.redirect(new URL("/tv/par", publicOrigin(req)));
  }

  const res = NextResponse.redirect(new URL("/tv", publicOrigin(req)));
  res.cookies.set("tv_token", data.access_token as string, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}
