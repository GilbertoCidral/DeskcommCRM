"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export type ArchivePipelineResult =
  | { ok: true }
  | { ok: false; error: string };

export async function archivePipeline(pipelineId: string): Promise<ArchivePipelineResult> {
  if (!pipelineId) return { ok: false, error: "ID inválido." };

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

  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id, is_default, organization_id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipeline) return { ok: false, error: "Funil não encontrado." };
  if (pipeline.organization_id !== activeOrg.orgId) return { ok: false, error: "Sem permissão." };
  if (pipeline.is_default) return { ok: false, error: "O funil padrão não pode ser arquivado." };

  const { error } = await supabase
    .from("crm_pipelines")
    .update({ is_archived: true })
    .eq("id", pipelineId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}
