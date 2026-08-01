"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export type CreatePipelineResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createPipeline(input: {
  name: string;
  slug: string;
}): Promise<CreatePipelineResult> {
  const name = input.name?.trim();
  const slug = input.slug?.trim().toLowerCase();

  if (!name || name.length < 2) return { ok: false, error: "Nome muito curto." };
  if (!slug || !/^[a-z0-9_-]{2,40}$/.test(slug)) {
    return { ok: false, error: "Slug inválido (use letras minúsculas, números, - ou _)." };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "Não autenticado." };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "Organização não encontrada." };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  const { data: existing } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("slug", slug)
    .maybeSingle();

  if (existing) return { ok: false, error: "Já existe um funil com esse slug." };

  const { data: last } = await supabase
    .from("crm_pipelines")
    .select("position")
    .eq("organization_id", activeOrg.orgId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = ((last?.position as number) ?? 0) + 1000;

  const { data, error } = await supabase
    .from("crm_pipelines")
    .insert({ organization_id: activeOrg.orgId, name, slug, position })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  // Cria 3 etapas padrão para o novo funil
  await supabase.from("crm_stages").insert([
    { organization_id: activeOrg.orgId, pipeline_id: data.id, name: "Novo", slug: "novo", position: 1000, is_won: false, is_lost: false },
    { organization_id: activeOrg.orgId, pipeline_id: data.id, name: "Em andamento", slug: "em-andamento", position: 2000, is_won: false, is_lost: false },
    { organization_id: activeOrg.orgId, pipeline_id: data.id, name: "Fechado", slug: "fechado", position: 3000, is_won: true, is_lost: false },
  ]);

  await audit({
    action: "pipeline.created",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "pipeline",
    resourceId: data.id,
    requestId,
    metadata: { name, slug },
  });

  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true, id: data.id };
}
