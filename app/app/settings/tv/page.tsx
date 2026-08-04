import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { TvSettingsClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function TvSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();

  const settings = ((orgRow?.settings as Record<string, unknown> | null) ?? {}) as {
    tv_commission_rate?: number;
    tv_investments?: Array<{ id: string; month: string; amount: number }>;
  };

  const commissionRate = settings.tv_commission_rate ?? 0.2;
  const investments = settings.tv_investments ?? [];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Painel TV</h1>
        <p className="text-sm text-muted-foreground">
          Configure comissão e investimentos para o painel de performance.
        </p>
      </header>
      <TvSettingsClient
        commissionRate={commissionRate}
        investments={investments}
      />
    </div>
  );
}
