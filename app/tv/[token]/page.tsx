/**
 * /tv/[token] — Painel TV público do vendedor.
 *
 * Rota pública: não exige cookie de sessão. O token no path é o segredo.
 * Usa admin client para validar o token e carregar os dados iniciais.
 * O client component faz polling a cada 60s em /api/v1/tv/[token].
 */
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { TvDashboard, type TvData } from "./TvDashboard";

export const dynamic = "force-dynamic";
// Sem revalidate — dados são frescos via polling no client.

interface PageCtx {
  params: Promise<{ token: string }>;
}

async function fetchTvData(token: string): Promise<TvData | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/v1/tv/${token}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data: TvData };
  return json.data ?? null;
}

export default async function TvPage({ params }: PageCtx) {
  const { token } = await params;

  // Valida formato antes de qualquer fetch.
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  // Verifica existência do token via admin client (sem repassar para o client).
  const admin = createAdminClient();
  const { data: orgRow } = await admin
    .from("organizations")
    .select("id")
    .filter("settings->>tv_token", "eq", token)
    .eq("status", "active")
    .maybeSingle();

  if (!orgRow) notFound();

  // Carrega dados iniciais para SSR (evita tela vazia na primeira renderização).
  const initialData = await fetchTvData(token);
  if (!initialData) notFound();

  return (
    <TvDashboard token={token} initialData={initialData} />
  );
}
