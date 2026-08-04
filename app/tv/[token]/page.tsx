/**
 * /tv/[token] — Painel TV público do vendedor.
 *
 * Rota pública: não exige cookie de sessão. O token no path é o segredo.
 * Usa admin client para validar o token e carregar os dados iniciais.
 * O client component faz polling a cada 60s em /api/v1/tv/[token].
 */
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { TvDashboard } from "./TvDashboard";

export const dynamic = "force-dynamic";

interface PageCtx {
  params: Promise<{ token: string }>;
}

export default async function TvPage({ params }: PageCtx) {
  const { token } = await params;

  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  // Valida que o token existe no banco — admin client bypassa RLS com filtro manual.
  const admin = createAdminClient();
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id")
    .filter("settings->>tv_token", "eq", token)
    .maybeSingle();

  if (!orgRow) notFound();

  // initialData=null: o client component faz o fetch assim que monta.
  // Evita HTTP self-call que falha dentro do container Docker.
  return <TvDashboard token={token} initialData={null} />;
}
