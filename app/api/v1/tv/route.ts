import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const VALID_WINDOWS = [6, 12, 24, 36, 60] as const;
type WindowMonths = (typeof VALID_WINDOWS)[number];

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();

  // Auth: sessão normal (browser autenticado) OU tv_token (TV pareada).
  let orgId: string | null = null;

  const authUser = await loadAuthUser();
  if (authUser) {
    const activeOrg = await resolveActiveOrg(authUser);
    if (activeOrg) orgId = activeOrg.orgId;
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
  const windowMonths: WindowMonths = (VALID_WINDOWS as readonly number[]).includes(raw)
    ? (raw as WindowMonths)
    : 6;

  const { data: orgRow } = await admin
    .from("organizations")
    .select("display_name, settings")
    .eq("id", orgId)
    .maybeSingle();

  if (!orgRow) return fail("resource_not_found", "Org não encontrada.", 404, { requestId });

  const orgSettings = (orgRow.settings as Record<string, unknown>) ?? {};
  const commissionRate =
    typeof orgSettings.tv_commission_rate === "number" ? orgSettings.tv_commission_rate : 0;

  const investmentsArr =
    (orgSettings.tv_investments as Array<{ id: string; month: string; amount: number }> | null) ?? [];

  const investmentByMonth = new Map<string, number>();
  for (const inv of investmentsArr) {
    investmentByMonth.set(inv.month, (investmentByMonth.get(inv.month) ?? 0) + inv.amount);
  }

  // Pipeline padrão da org.
  const { data: pipelineRaw } = await admin
    .from("crm_pipelines")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .order("is_default", { ascending: false })
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const pipeline = pipelineRaw as { id: string; name: string } | null;
  const pipelineId = pipeline?.id ?? null;

  const { data: stagesRaw } = pipelineId
    ? await admin
        .from("crm_stages")
        .select("id, name, position, color, is_won, is_lost")
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipelineId)
        .eq("is_archived", false)
        .order("position")
    : { data: [] };

  type StageRow = {
    id: string;
    name: string;
    position: number;
    color: string | null;
    is_won: boolean;
    is_lost: boolean;
  };

  const stages = (stagesRaw ?? []) as StageRow[];

  const { data: openLeadsRaw } = pipelineId
    ? await admin
        .from("crm_leads")
        .select("stage_id")
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipelineId)
        .eq("status", "open")
    : { data: [] };

  const countByStage = new Map<string, number>();
  for (const l of (openLeadsRaw ?? []) as Array<{ stage_id: string }>) {
    countByStage.set(l.stage_id, (countByStage.get(l.stage_id) ?? 0) + 1);
  }

  const funnelStages = stages
    .filter((s) => !s.is_won && !s.is_lost)
    .map((s) => ({ ...s, open_count: countByStage.get(s.id) ?? 0 }));

  const lostStageIds = stages.filter((s) => s.is_lost).map((s) => s.id);
  const { data: lostLeadsRaw } =
    lostStageIds.length > 0 && pipelineId
      ? await admin
          .from("crm_leads")
          .select("stage_id")
          .eq("organization_id", orgId)
          .eq("pipeline_id", pipelineId)
          .eq("status", "lost")
      : { data: [] };

  const lostCountByStage = new Map<string, number>();
  for (const l of (lostLeadsRaw ?? []) as Array<{ stage_id: string }>) {
    lostCountByStage.set(l.stage_id, (lostCountByStage.get(l.stage_id) ?? 0) + 1);
  }
  const lostStages = stages
    .filter((s) => s.is_lost)
    .map((s) => ({ name: s.name, count: lostCountByStage.get(s.id) ?? 0 }))
    .filter((s) => s.count > 0);

  // Histórico mensal: últimos windowMonths meses.
  const now = new Date();
  const histStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (windowMonths - 1), 1),
  );

  const [{ data: createdRaw }, { data: wonRaw }] = await Promise.all([
    admin
      .from("crm_leads")
      .select("created_at")
      .eq("organization_id", orgId)
      .gte("created_at", histStart.toISOString()),
    admin
      .from("crm_leads")
      .select("closed_at, value_cents")
      .eq("organization_id", orgId)
      .eq("status", "won")
      .gte("closed_at", histStart.toISOString()),
  ]);

  const monthKeys: string[] = [];
  for (let i = -(windowMonths - 1); i <= 0; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    monthKeys.push(monthKey(d));
  }

  type Bucket = { leads_created: number; leads_won: number; value_won_cents: number };
  const buckets = new Map<string, Bucket>(
    monthKeys.map((k) => [k, { leads_created: 0, leads_won: 0, value_won_cents: 0 }]),
  );

  for (const r of (createdRaw ?? []) as Array<{ created_at: string }>) {
    const mk = r.created_at.slice(0, 7);
    const b = buckets.get(mk);
    if (b) b.leads_created++;
  }

  for (const r of (wonRaw ?? []) as Array<{
    closed_at: string | null;
    value_cents: number | null;
  }>) {
    if (!r.closed_at) continue;
    const mk = r.closed_at.slice(0, 7);
    const b = buckets.get(mk);
    if (b) {
      b.leads_won++;
      b.value_won_cents += r.value_cents ?? 0;
    }
  }

  const monthly = monthKeys.map((mk) => {
    const b = buckets.get(mk)!;
    const investment = investmentByMonth.get(mk) ?? 0;
    const commission = Math.round((b.value_won_cents / 100) * commissionRate * 100) / 100;
    return {
      month: mk,
      leads_created: b.leads_created,
      leads_won: b.leads_won,
      value_won_cents: b.value_won_cents,
      investment,
      commission,
    };
  });

  const currMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const currMk = monthKey(now);

  const [{ count: leadsOpen }, { count: leadsThisMonth }, { data: wonThisMonthRaw }] =
    await Promise.all([
      admin
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "open"),
      admin
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte("created_at", currMonthStart.toISOString()),
      admin
        .from("crm_leads")
        .select("value_cents")
        .eq("organization_id", orgId)
        .eq("status", "won")
        .gte("closed_at", currMonthStart.toISOString()),
    ]);

  const wonThisMonth = (wonThisMonthRaw ?? []) as Array<{ value_cents: number | null }>;
  const salesThisMonth = wonThisMonth.length;
  const valueWonCentsThisMonth = wonThisMonth.reduce((s, r) => s + (r.value_cents ?? 0), 0);

  const meetingStageIds = stages.filter((s) => /reuni/i.test(s.name)).map((s) => s.id);
  let meetingsThisMonth = 0;
  if (meetingStageIds.length > 0 && pipelineId) {
    const { count: mc } = await admin
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .in("stage_id", meetingStageIds)
      .eq("status", "open");
    meetingsThisMonth = mc ?? 0;
  }

  const currMonthEntry = monthly.find((m) => m.month === currMk);
  const commissionThisMonth =
    currMonthEntry?.commission ??
    Math.round((valueWonCentsThisMonth / 100) * commissionRate * 100) / 100;

  return ok(
    {
      org_name: orgRow.display_name as string,
      pipeline_name: pipeline?.name ?? null,
      funnel_stages: funnelStages,
      lost_stages: lostStages,
      kpis: {
        leads_open: leadsOpen ?? 0,
        leads_this_month: leadsThisMonth ?? 0,
        sales_this_month: salesThisMonth,
        value_won_cents_this_month: valueWonCentsThisMonth,
        meetings_this_month: meetingsThisMonth,
        commission_this_month: commissionThisMonth,
      },
      monthly,
      commission_rate: commissionRate,
    },
    { requestId },
  );
}
