/**
 * GET /api/v1/tv/[token]
 *
 * Endpoint público de dados para o Painel TV do vendedor. Autenticado pelo
 * token de path (gerado em /app/settings/tv), nunca por cookie de sessão.
 *
 * Fluxo de segurança:
 *  1. Valida formato do token (32 hex chars) — rejeita qualquer outra coisa.
 *  2. Busca a org pelo token com admin client (bypassa RLS) + filtro manual.
 *  3. Todos os queries subsequentes filtram organization_id explicitamente.
 *     O token nunca sai da response — a org e seus dados é que são devolvidos.
 *
 * Rate limiting deliberadamente omitido no MVP: o token é o segredo, a rota
 * é read-only, e o polling esperado é 1 req/min de 1 IP fixo (TV). Adicionar
 * Upstash se uso se ampliar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ token: string }>;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { token } = await ctx.params;

  // 32 hex chars — qualquer coisa diferente é inválida sem consulta ao banco.
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return fail("resource_not_found", "Painel não encontrado.", 404, { requestId });
  }

  const admin = createAdminClient();

  // Busca org pelo token: admin client + filter manual (bypassa RLS com segurança).
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("id, display_name, status, settings")
    .filter("settings->>tv_token", "eq", token)
    .eq("status", "active")
    .maybeSingle();

  if (orgErr) return fail("internal_error", orgErr.message, 500, { requestId });
  if (!orgRow) return fail("resource_not_found", "Painel não encontrado.", 404, { requestId });

  const orgId = orgRow.id as string;
  const orgSettings = (orgRow.settings as Record<string, unknown>) ?? {};
  const commissionRate =
    typeof orgSettings.tv_commission_rate === "number" ? orgSettings.tv_commission_rate : 0;
  const monthlyInvestments =
    (orgSettings.tv_monthly_investments as Record<string, number> | null) ?? {};

  // Pipeline padrão da org (admin client — filtro manual obrigatório).
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

  // Estágios do pipeline.
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

  // Leads abertos por estágio (para o funil).
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

  // Funil: estágios não-terminais, em ordem.
  const funnelStages = stages
    .filter((s) => !s.is_won && !s.is_lost)
    .map((s) => ({ ...s, open_count: countByStage.get(s.id) ?? 0 }));

  // Estágios de perda com contagem de leads perdidos.
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

  // Histórico mensal: últimos 7 meses (criação de leads + fechamentos).
  const now = new Date();
  const histStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, 1));

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

  // Gera chaves dos últimos 7 meses em ordem.
  const monthKeys: string[] = [];
  for (let i = -6; i <= 0; i++) {
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
    const investment = monthlyInvestments[mk] ?? 0;
    const commission = Math.round((b.value_won_cents / 100) * commissionRate * 100) / 100;
    return { month: mk, leads_created: b.leads_created, leads_won: b.leads_won, value_won_cents: b.value_won_cents, investment, commission };
  });

  // KPIs do mês corrente.
  const currMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const currMk = monthKey(now);

  const [
    { count: leadsOpen },
    { count: leadsThisMonth },
    { data: wonThisMonthRaw },
  ] = await Promise.all([
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

  // Reuniões: leads em estágios com "reuni" no nome (open, mês corrente).
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
