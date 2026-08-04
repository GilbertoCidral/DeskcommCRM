import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Não autenticado.", 401, { requestId });

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden", "Tenant inativo.", 403, { requestId });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed", "Código inválido.", 400, { requestId });

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: row } = await admin
    .from("tv_pairing_codes")
    .select("id")
    .eq("code", parsed.data.code)
    .eq("status", "pending")
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return fail("resource_not_found", "Código inválido ou expirado.", 404, { requestId });

  const accessToken = randomUUID();
  const tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 ano

  const { error } = await admin
    .from("tv_pairing_codes")
    .update({
      status: "confirmed",
      organization_id: activeOrg.orgId,
      user_id: authUser.id,
      access_token: accessToken,
      token_expires_at: tokenExpiresAt.toISOString(),
    })
    .eq("id", row.id);

  if (error) return fail("internal", "Erro ao confirmar código.", 500, { requestId });

  return ok({ confirmed: true }, { requestId });
}
