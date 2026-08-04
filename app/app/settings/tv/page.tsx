import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { TvSettingsClient } from "./_client";

export const dynamic = "force-dynamic";

function buildMonthKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = -6; i <= 0; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

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
    tv_token?: string;
    tv_commission_rate?: number;
    tv_monthly_investments?: Record<string, number>;
  };

  const token = settings.tv_token ?? null;
  const commissionRate = settings.tv_commission_rate ?? 0.2;
  const monthlyInvestments = settings.tv_monthly_investments ?? {};
  const monthKeys = buildMonthKeys();

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Painel TV</h1>
        <p className="text-sm text-muted-foreground">
          Link secreto para exibir performance em TV. Gere o link e compartilhe com o vendedor.
        </p>
      </header>
      <TvSettingsClient
        token={token}
        commissionRate={commissionRate}
        monthlyInvestments={monthlyInvestments}
        monthKeys={monthKeys}
      />
    </div>
  );
}
