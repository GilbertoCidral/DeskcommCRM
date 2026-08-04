import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Sem "use client" — servidor gera o código e renderiza o HTML completo.
// O browser da TV só precisa recarregar a página a cada 3s (location.href).
// Zero dependência de fetch, React hydration ou async/await no cliente.

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createCode(admin: ReturnType<typeof createAdminClient>): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const candidate = randomCode();
    const { data } = await admin
      .from("tv_pairing_codes")
      .select("id")
      .eq("code", candidate)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!data) {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const { error } = await admin
        .from("tv_pairing_codes")
        .insert({ code: candidate, expires_at: expiresAt.toISOString() });
      if (!error) return candidate;
    }
  }
  return null;
}

interface Props {
  searchParams: Promise<{ code?: string }>;
}

export default async function TvPairPage({ searchParams }: Props) {
  const params = await searchParams;
  const admin = createAdminClient();
  let code: string | null = null;
  let errorMsg: string | null = null;

  if (params.code && /^\d{6}$/.test(params.code)) {
    const { data: row } = await admin
      .from("tv_pairing_codes")
      .select("status, expires_at")
      .eq("code", params.code)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (row?.status === "confirmed") {
      // Código confirmado — ativa sessão via route handler que seta o cookie.
      redirect(`/api/v1/tv/pair/activate?code=${params.code}`);
    }

    if (row?.status === "pending" && new Date(row.expires_at as string) > new Date()) {
      code = params.code;
    } else {
      code = await createCode(admin);
    }
  } else {
    code = await createCode(admin);
  }

  if (!code) {
    errorMsg = "Não foi possível gerar o código. Recarregue a página.";
  }

  const displayCode = code ? `${code.slice(0, 3)} ${code.slice(3)}` : null;
  const refreshUrl = code ? `/tv/par?code=${code}` : "/tv/par";
  // Recarrega a cada 3s — funciona em qualquer browser, sem fetch ou async.
  const script = `setTimeout(function(){location.href='${refreshUrl}';},3000);`;

  return (
    <>
      <div style={{
        minHeight: "100vh",
        background: "#faf9f6",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial, sans-serif",
        color: "#1c1a16",
        padding: "24px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>&#128250;</div>

        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>
          Conectar ao CRM
        </h1>
        <p style={{ fontSize: 15, color: "#5d594f", margin: "0 0 40px", maxWidth: 340, lineHeight: 1.5 }}>
          No celular ou computador já logado, abra o painel TV e clique em{" "}
          <strong>Conectar TV</strong>, depois digite o código abaixo.
        </p>

        <div style={{
          background: "#fff",
          border: "2px solid #e7e3da",
          borderRadius: 20,
          padding: "36px 52px",
          minWidth: 260,
          boxShadow: "0 4px 24px rgba(0,0,0,.06)",
        }}>
          {errorMsg ? (
            <div style={{ color: "#a94a3c", fontSize: 15 }}>{errorMsg}</div>
          ) : (
            <>
              <div style={{
                fontSize: 62,
                fontWeight: 900,
                letterSpacing: "0.14em",
                color: "#1c1a16",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}>
                {displayCode}
              </div>
              <div style={{ marginTop: 14, fontSize: 13, color: "#5d594f" }}>
                Código válido por 10 minutos
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 20, fontSize: 13, color: "#9b9591" }}>
          Atualizando automaticamente…
        </div>
      </div>

      {/* Plain JS — funciona em qualquer browser de TV */}
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
