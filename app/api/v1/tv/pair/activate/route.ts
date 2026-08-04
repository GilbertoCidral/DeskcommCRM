import { type NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Chamado pelo server component /tv/par quando o código está confirmado.
// Seta o cookie tv_token (só Route Handler pode setar cookie com redirect).
export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");

  if (!code || !/^\d{6}$/.test(code)) {
    const back = req.nextUrl.clone();
    back.pathname = "/tv/par";
    back.search = "";
    return NextResponse.redirect(back);
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
    const back = req.nextUrl.clone();
    back.pathname = "/tv/par";
    back.search = "";
    return NextResponse.redirect(back);
  }

  // nextUrl preserva o host público (req.url pode ter 0.0.0.0 internamente).
  const dest = req.nextUrl.clone();
  dest.pathname = "/tv";
  dest.search = "";
  const res = NextResponse.redirect(dest);
  res.cookies.set("tv_token", data.access_token as string, {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}
