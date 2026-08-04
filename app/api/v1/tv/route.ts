import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTvData, TV_VALID_WINDOWS, type TvWindowMonths } from "@/lib/tv/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();

  // Auth: sessão normal (browser autenticado) OU tv_token (TV pareada).
  let orgId: string | null = null;

  try {
    const authUser = await loadAuthUser();
    if (authUser) {
      const activeOrg = await resolveActiveOrg(authUser);
      if (activeOrg) orgId = activeOrg.orgId;
    }
  } catch {
    // loadAuthUser pode lançar se não há sessão Supabase — ignora, tenta tv_token.
  }

  if (!orgId) {
    const cookieStore = await cookies();
    const tvToken = cookieStore.get("tv_token")?.value;
    if (tvToken) {
      const { data: pairRow } = await admin
        .from("tv_pairing_codes")
        .select("organization_id")
        .eq("access_token", tvToken)
        .eq("status", "confirmed")
        .gt("token_expires_at", new Date().toISOString())
        .maybeSingle();
      if (pairRow?.organization_id) orgId = pairRow.organization_id as string;
    }
  }

  if (!orgId) return fail("unauthenticated", "Não autenticado.", 401, { requestId });

  const raw = Number(req.nextUrl.searchParams.get("window") ?? "6");
  const windowMonths: TvWindowMonths = (TV_VALID_WINDOWS as readonly number[]).includes(raw)
    ? (raw as TvWindowMonths)
    : 6;

  const tvData = await fetchTvData(orgId, windowMonths);
  if (!tvData) return fail("resource_not_found", "Org não encontrada.", 404, { requestId });

  return ok(tvData, { requestId });
}
