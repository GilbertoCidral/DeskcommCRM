"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

const tvConfigSchema = z.object({
  commission_rate: z.number().min(0).max(1),
  monthly_investments: z.record(
    z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
    z.number().min(0),
  ),
});

export type TvConfigInput = z.infer<typeof tvConfigSchema>;
export type SaveTvConfigResult = { ok: true } | { ok: false; error: string };

/**
 * Salva configurações do Painel TV (taxa de comissão + investimentos mensais).
 * Merge não-destrutivo em organizations.settings — preserva tv_token e outros campos.
 * Requer role admin no tenant.
 */
export async function saveTvConfig(input: TvConfigInput): Promise<SaveTvConfigResult> {
  const parsed = tvConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "validation_failed" };

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };

  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const supabase = await createClient();

  const { data: orgRow, error: readErr } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const currentSettings = (orgRow?.settings as Record<string, unknown> | null) ?? {};
  const nextSettings = {
    ...currentSettings,
    tv_commission_rate: parsed.data.commission_rate,
    tv_monthly_investments: parsed.data.monthly_investments,
  };

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
    action: "org.tv_config_updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "organization",
    resourceId: activeOrg.orgId,
    requestId,
    ip,
    userAgent,
    metadata: { commission_rate: parsed.data.commission_rate },
  });

  revalidatePath("/app/settings/tv");
  return { ok: true };
}
