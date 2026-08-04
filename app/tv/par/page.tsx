"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PollStatus = "generating" | "waiting" | "confirmed" | "expired";

const C = {
  bg: "#faf9f6",
  text: "#1c1a16",
  muted: "#5d594f",
  border: "#e7e3da",
  accent: "#506d48",
  accentSoft: "#e4ebe0",
  success: "#5a8a5f",
  error: "#a94a3c",
} as const;

export default function TvPairPage() {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<PollStatus>("generating");
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutos
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  function startTimer() {
    setTimeLeft(600);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current!);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  }

  async function generate() {
    setStatus("generating");
    setCode(null);
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);

    const res = await fetch("/api/v1/tv/pair/generate", { method: "POST" });
    if (!res.ok) { setStatus("expired"); setCode(null); return; }
    const json = (await res.json()) as { data: { code: string } };
    setCode(json.data.code);
    setStatus("waiting");
    startTimer();
  }

  useEffect(() => {
    void generate();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!code || status !== "waiting") return;

    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/v1/tv/pair/poll?code=${code}`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        data: { status: string; access_token?: string };
      };

      if (json.data.status === "confirmed" && json.data.access_token) {
        clearInterval(pollRef.current!);
        clearInterval(timerRef.current!);
        setStatus("confirmed");
        document.cookie = `tv_token=${json.data.access_token}; path=/; max-age=${365 * 24 * 60 * 60}; samesite=lax`;
        setTimeout(() => router.push("/tv"), 1800);
      } else if (json.data.status === "expired") {
        clearInterval(pollRef.current!);
        setStatus("expired");
      }
    }, 2000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [code, status, router]);

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");

  // Formata código: "482 751"
  const displayCode = code ? `${code.slice(0, 3)} ${code.slice(3)}` : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: C.bg,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, -apple-system, sans-serif",
      color: C.text,
      padding: 24,
      gap: 0,
    }}>

      {/* Ícone */}
      <div style={{ fontSize: 64, marginBottom: 24 }}>📺</div>

      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, textAlign: "center" }}>
        Conectar ao CRM
      </h1>
      <p style={{ fontSize: 16, color: C.muted, marginTop: 8, textAlign: "center", maxWidth: 340 }}>
        No celular ou computador já logado, abra o painel e clique em{" "}
        <strong>Conectar TV</strong>, depois digite o código abaixo.
      </p>

      {/* Código */}
      <div style={{
        marginTop: 40,
        background: "#fff",
        border: `2px solid ${status === "confirmed" ? C.success : C.border}`,
        borderRadius: 20,
        padding: "36px 52px",
        textAlign: "center",
        minWidth: 260,
        boxShadow: "0 4px 24px rgba(0,0,0,.06)",
        transition: "border-color 0.3s",
      }}>
        {status === "generating" && (
          <div style={{ color: C.muted, fontSize: 18 }}>Gerando código…</div>
        )}
        {(status === "waiting" || status === "confirmed") && displayCode && (
          <>
            <div style={{
              fontSize: 62,
              fontWeight: 900,
              letterSpacing: "0.12em",
              fontVariantNumeric: "tabular-nums",
              color: status === "confirmed" ? C.success : C.text,
              lineHeight: 1,
            }}>
              {displayCode}
            </div>
            {status === "waiting" && (
              <div style={{ marginTop: 14, fontSize: 13, color: C.muted }}>
                Expira em <strong style={{ fontVariantNumeric: "tabular-nums" }}>{mins}:{secs}</strong>
              </div>
            )}
            {status === "confirmed" && (
              <div style={{ marginTop: 14, fontSize: 16, color: C.success, fontWeight: 700 }}>
                TV conectada! Abrindo painel…
              </div>
            )}
          </>
        )}
        {status === "expired" && (
          <div style={{ color: C.error, fontSize: 15, lineHeight: 1.5 }}>
            Não foi possível gerar o código.<br />
            <span style={{ fontSize: 12, color: C.muted }}>Tente gerar um novo abaixo.</span>
          </div>
        )}
      </div>

      {/* Botão de gerar novo código */}
      {(status === "expired" || status === "waiting") && (
        <button
          type="button"
          onClick={() => void generate()}
          style={{
            marginTop: 24,
            padding: "10px 24px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: "#fff",
            color: C.muted,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {status === "expired" ? "Gerar novo código" : "Gerar outro código"}
        </button>
      )}

      {/* Spinner de aguardando */}
      {status === "waiting" && (
        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 13 }}>
          <div style={{
            width: 14, height: 14, borderRadius: "50%",
            border: `2px solid ${C.accentSoft}`,
            borderTopColor: C.accent,
            animation: "spin 0.9s linear infinite",
          }} />
          Aguardando confirmação no celular…
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
