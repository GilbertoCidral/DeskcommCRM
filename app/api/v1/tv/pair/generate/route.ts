import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// GET para compatibilidade máxima com browsers de Smart TV.
export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();

  // Gera código de 6 dígitos único entre os pendentes ativos.
  let code: string | null = null;
  for (let i = 0; i < 5; i++) {
    const candidate = generateCode();
    const { data } = await admin
      .from("tv_pairing_codes")
      .select("id")
      .eq("code", candidate)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!data) { code = candidate; break; }
  }

  if (!code) return fail("conflict", "Não foi possível gerar código único.", 409, { requestId });

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

  const { error } = await admin
    .from("tv_pairing_codes")
    .insert({ code, expires_at: expiresAt.toISOString() });

  if (error) return fail("internal", "Erro ao gerar código.", 500, { requestId });

  return ok({ code }, { requestId });
}
