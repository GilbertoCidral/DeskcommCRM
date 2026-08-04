import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const code = req.nextUrl.searchParams.get("code");

  if (!code || !/^\d{6}$/.test(code)) {
    return fail("validation_failed", "Código inválido.", 400, { requestId });
  }

  const admin = createAdminClient();

  const { data } = await admin
    .from("tv_pairing_codes")
    .select("status, access_token, expires_at")
    .eq("code", code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return ok({ status: "expired" }, { requestId });

  if (data.status === "confirmed") {
    return ok({ status: "confirmed", access_token: data.access_token }, { requestId });
  }

  if (data.status === "pending") {
    if (new Date(data.expires_at as string) < new Date()) {
      return ok({ status: "expired" }, { requestId });
    }
    return ok({ status: "pending" }, { requestId });
  }

  return ok({ status: "expired" }, { requestId });
}
