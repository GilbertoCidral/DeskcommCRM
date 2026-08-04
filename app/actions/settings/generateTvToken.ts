"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

export type GenerateTvTokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

/**
 * Gera (ou regenera) um token de acesso ao Painel TV.
 * Salvo em organizations.settings.tv_token como hex de 32 chars.
 * Requer role admin no tenant.
 */
export async function generateTvToken(): Promise<GenerateTvTokenResult> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const token = randomBytes(16).toString("hex"); // 32 chars hex — criptograficamente seguro

  const supabase = await createClient();

  // Lê settings atual para merge não-destrutivo.
  const { data: orgRow, error: readErr } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const currentSettings = (orgRow?.settings as Record<string, unknown> | null) ?? {};
  const nextSettings = { ...currentSettings, tv_token: token };

  const { error: updateErr } = await supabase
    .from("organizations")
    .update({ settings: nextSettings })
    .eq("id", activeOrg.orgId);
  if (updateErr) return { ok: false, error: updateErr.message };

  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  await audit({
    action: "org.tv_token_generated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "organization",
    resourceId: activeOrg.orgId,
    requestId,
    ip,
    userAgent,
    metadata: {},
  });

  revalidatePath("/app/settings/tv");
  return { ok: true, token };
}
