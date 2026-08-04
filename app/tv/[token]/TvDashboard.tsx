"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface TvFunnelStage {
  id: string;
  name: string;
  position: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  open_count: number;
}

export interface TvMonthly {
  month: string; // "YYYY-MM"
  leads_created: number;
  leads_won: number;
  value_won_cents: number;
  investment: number; // BRL
  commission: number; // BRL
}

export interface TvKpis {
  leads_open: number;
  leads_this_month: number;
  sales_this_month: number;
  value_won_cents_this_month: number;
  meetings_this_month: number;
  commission_this_month: number;
}

export interface TvData {
  org_name: string;
  pipeline_name: string | null;
  funnel_stages: TvFunnelStage[];
  lost_stages: Array<{ name: string; count: number }>;
  kpis: TvKpis;
  monthly: TvMonthly[];
  commission_rate: number;
}

// ---------------------------------------------------------------------------
// Constantes de design — mesmas do design system CRM (sage palette)
// ---------------------------------------------------------------------------

const C = {
  bg: "#faf9f6",
  surface: "#ffffff",
  elevated: "#f5f3ee",
  text: "#1c1a16",
  muted: "#5d594f",
  border: "#e7e3da",
  accent: "#506d48",
  accentSoft: "#e4ebe0",
  success: "#5a8a5f",
  warning: "#b07a2b",
  error: "#a94a3c",
} as const;

const BELTS = [
  { name: "Branca",   color: "#d7d3d3", goal: 0 },
  { name: "Cinza",    color: "#9b9797", goal: 1000 },
  { name: "Azul",     color: "#3b6ea5", goal: 3000 },
  { name: "Amarela",  color: "#c9a227", goal: 5000 },
  { name: "Laranja",  color: "#c4661f", goal: 10000 },
  { name: "Verde",    color: "#4a7c4e", goal: 15000 },
  { name: "Roxo",     color: "#6b4f8c", goal: 20000 },
  { name: "Marrom",   color: "#6b4a2e", goal: 25000 },
  { name: "Preta",    color: "#2d2b2b", goal: 30000 },
  { name: "Coral",    color: "#c95b52", goal: 50000 },
  { name: "Lendária", color: "#506d48", goal: 100000 },
] as const;

const CHART_ORDER = ["growth", "conversion", "leads_vs_sales", "roi"] as const;
type ChartType = (typeof CHART_ORDER)[number];

const CHART_META: Record<ChartType, { title: string; legend: Array<{ label: string; color: string }> }> = {
  growth:        { title: "Comissão vs Investimento",       legend: [{ label: "Comissão", color: C.accent }, { label: "Investimento", color: "#a8a398" }] },
  conversion:    { title: "Conversão por Etapa do Funil",   legend: [{ label: "≥70% bom", color: C.success }, { label: "40–70%", color: C.warning }, { label: "<40% baixo", color: C.error }] },
  leads_vs_sales:{ title: "Leads Captados vs Vendas/Mês",   legend: [{ label: "Leads", color: "rgba(80,109,72,.45)" }, { label: "Vendas", color: C.accent }] },
  roi:           { title: "ROI Mensal (%)",                 legend: [{ label: "ROI %", color: C.accent }] },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBRL(n: number): string {
  if (n === 0) return "R$0";
  if (n >= 1000) return `R$${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `R$${n.toFixed(0)}`;
}
function fmtBRLFull(n: number): string {
  return `R$${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function monthLabel(mk: string): string {
  const [, m] = mk.split("-");
  return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(m!) - 1]!;
}
function pad(n: number): string { return String(n).padStart(2, "0"); }

// Bezier suavizado (Catmull-Rom → cúbico)
function smoothPath(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>) {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  if (pts.length < 3) { if (pts.length > 1) ctx.lineTo(pts[1]!.x, pts[1]!.y); return; }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

interface Props {
  token: string;
  initialData: TvData;
}

export function TvDashboard({ token, initialData }: Props) {
  const [data, setData] = useState<TvData>(initialData);
  const [now, setNow] = useState(() => new Date());
  const [activeChart, setActiveChart] = useState<ChartType>("growth");
  const [countdown, setCountdown] = useState(10);
  const [autoPlay, setAutoPlay] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  // Relógio
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Polling de dados a cada 60s
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/tv/${token}`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { data: TvData };
          if (json.data) setData(json.data);
        }
      } catch {
        // Silencioso — mantém dados anteriores se offline
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [token]);

  // Ciclo automático de gráficos
  useEffect(() => {
    const id = setInterval(() => {
      if (!autoPlay) return;
      setCountdown((c) => {
        if (c <= 1) {
          setActiveChart((cur) => {
            const idx = CHART_ORDER.indexOf(cur);
            return CHART_ORDER[(idx + 1) % CHART_ORDER.length]!;
          });
          return 10;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [autoPlay]);

  // Animação e renderização do canvas
  const animate = useCallback((chartType: ChartType, chartData: TvData) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const dur = 750;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      drawChart(canvasRef.current, chartType, chartData, ease);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    animate(activeChart, data);
  }, [activeChart, data, animate]);

  // Resize
  useEffect(() => {
    const onResize = () => drawChart(canvasRef.current, activeChart, data, 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeChart, data]);

  const nextChart = useCallback(() => {
    setActiveChart((cur) => {
      const idx = CHART_ORDER.indexOf(cur);
      return CHART_ORDER[(idx + 1) % CHART_ORDER.length]!;
    });
    setCountdown(10);
  }, []);

  // Valores derivados
  const meta = CHART_META[activeChart];
  const com = data.kpis.commission_this_month;
  let beltIdx = 0;
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (com >= BELTS[i]!.goal) { beltIdx = i; break; }
  }
  const belt = BELTS[beltIdx]!;
  const nextBelt = BELTS[Math.min(beltIdx + 1, BELTS.length - 1)]!;
  const beltRange = nextBelt.goal - belt.goal;
  const beltPct = beltRange > 0 ? Math.min(((com - belt.goal) / beltRange) * 100, 100) : 100;

  const days = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const inv = data.monthly.at(-1)?.investment ?? 0;
  const leads = data.kpis.leads_this_month;
  const sales = data.kpis.sales_this_month;
  const cpl = leads > 0 && inv > 0 ? fmtBRLFull(inv / leads) : "—";
  const cac = sales > 0 && inv > 0 ? fmtBRLFull(inv / sales) : "—";
  const roi = inv > 0 ? `${Math.round(((com - inv) / inv) * 100)}%` : "—";
  const convPct = leads > 0 ? `${Math.round((sales / leads) * 100)}%` : "—";

  // Funil SVG
  const fStages = data.funnel_stages;
  const totalStages = fStages.length;
  const sliceH = totalStages > 0 ? 100 / totalStages : 100;
  const startW = 94;
  const endW = 58;
  const stepW = totalStages > 1 ? (startW - endW) / (totalStages - 1) : 0;
  const widths = fStages.map((_, i) => startW - i * stepW);

  function funnelPolygon(i: number) {
    const y0 = i * sliceH, y1 = (i + 1) * sliceH;
    const w0 = widths[i] ?? endW, w1 = widths[i + 1] ?? (endW - stepW);
    const l0 = (100 - w0) / 2, r0 = 100 - l0;
    const l1 = (100 - w1) / 2, r1 = 100 - l1;
    return `${l0.toFixed(2)},${y0.toFixed(2)} ${r0.toFixed(2)},${y0.toFixed(2)} ${r1.toFixed(2)},${y1.toFixed(2)} ${l1.toFixed(2)},${y1.toFixed(2)}`;
  }

  const stageColors = [
    "rgba(80,109,72,.18)", "rgba(80,109,72,.32)", "rgba(80,109,72,.46)",
    "rgba(80,109,72,.60)", "rgba(80,109,72,.74)", C.accent,
  ];

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        display: "grid",
        gridTemplateRows: "64px auto 1fr",
        background: C.bg,
        color: C.text,
        fontFamily: "var(--font-atkinson, system-ui, sans-serif)",
      }}
    >
      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: C.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16 }}>
            {data.org_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Painel do Vendedor</div>
            <div style={{ fontSize: 11, color: C.muted }}>{data.org_name} · Performance em Tempo Real</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.success, animation: "pulse 2s infinite" }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>{timeStr}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{dateStr}</div>
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, padding: "14px 24px", background: C.bg }}>
        {[
          { label: "Comissão / Mês", value: fmtBRL(com), raw: com },
          { label: "Valor Fechado", value: fmtBRL(data.kpis.value_won_cents_this_month / 100), raw: data.kpis.value_won_cents_this_month },
          { label: "Leads no Funil", value: String(data.kpis.leads_open), raw: data.kpis.leads_open },
          { label: "Reuniões", value: String(data.kpis.meetings_this_month), raw: data.kpis.meetings_this_month },
          { label: "Vendas", value: String(data.kpis.sales_this_month), raw: data.kpis.sales_this_month },
        ].map((kpi) => (
          <div key={kpi.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(20,18,14,.05)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted }}>{kpi.label}</div>
            <div style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* ── MAIN GRID ── */}
      <div style={{ display: "grid", gridTemplateColumns: "34% 1fr 26%", gap: 12, padding: "0 24px 16px", overflow: "hidden", minHeight: 0 }}>

        {/* ── FUNIL ── */}
        <div style={{ display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(20,18,14,.05)", overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: "12px 16px 8px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            {data.pipeline_name ?? "Funil de Vendas"}
          </div>
          {fStages.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>
              Nenhum estágio configurado
            </div>
          ) : (
            <>
              <div style={{ flex: 1, display: "flex", gap: 8, padding: "6px 16px", minHeight: 0, overflow: "hidden" }}>
                {/* SVG trapézio */}
                <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}>
                    {fStages.map((s, i) => (
                      <polygon
                        key={s.id}
                        points={funnelPolygon(i)}
                        fill={stageColors[Math.min(i, stageColors.length - 1)] ?? C.accentSoft}
                        stroke={C.bg}
                        strokeWidth="0.5"
                      />
                    ))}
                  </svg>
                  {/* Labels sobrepostos */}
                  {fStages.map((s, i) => {
                    const isDeep = i >= 3;
                    return (
                      <div
                        key={s.id}
                        style={{
                          position: "absolute",
                          left: 0, right: 0,
                          top: `${i * sliceH}%`,
                          height: `${sliceH}%`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 13, color: isDeep ? "#fff" : C.text, whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(0,0,0,.2)" }}>
                          {s.name}
                        </span>
                        <span style={{ fontWeight: 800, fontSize: 18, color: isDeep ? "#fff" : C.text, fontVariantNumeric: "tabular-nums", textShadow: "0 1px 2px rgba(0,0,0,.2)" }}>
                          {s.open_count}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* Taxas de conversão */}
                <div style={{ width: 54, position: "relative", flexShrink: 0 }}>
                  {fStages.map((s, i) => {
                    const prev = fStages[i - 1];
                    const rate = prev && prev.open_count > 0 ? Math.round((s.open_count / prev.open_count) * 100) : null;
                    return (
                      <div
                        key={s.id}
                        style={{
                          position: "absolute", left: 0, right: 0,
                          top: `${i * sliceH}%`,
                          height: `${sliceH}%`,
                          display: "flex", alignItems: "center",
                          fontSize: 10, color: C.muted, whiteSpace: "nowrap",
                        }}
                      >
                        {i === 0 ? "topo" : rate !== null ? `${rate}% conv` : "—"}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Perdidos */}
              {data.lost_stages.length > 0 && (
                <div style={{ display: "flex", gap: 10, padding: "10px 16px 14px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
                  {data.lost_stages.map((ls) => (
                    <div key={ls.name} style={{ flex: 1, background: "rgba(169,74,60,.08)", border: "1px solid rgba(169,74,60,.2)", borderRadius: 4, padding: "10px 16px", fontSize: 13, color: C.error }}>
                      {ls.name}
                      <span style={{ display: "block", fontSize: 22, fontWeight: 700, marginTop: 3 }}>{ls.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── GRÁFICO ── */}
        <div style={{ display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(20,18,14,.05)", overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: "12px 16px 8px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            {meta.title}
          </div>
          <div style={{ flex: 1, padding: "12px 16px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8, flexShrink: 0 }}>
              {/* Legenda */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {meta.legend.map((lg) => (
                  <div key={lg.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.muted }}>
                    <div style={{ width: 12, height: 3, borderRadius: 2, background: lg.color, flexShrink: 0 }} />
                    {lg.label}
                  </div>
                ))}
              </div>
              {/* Controles de ciclo */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {autoPlay ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
                    <span>próximo em</span>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", background: C.accentSoft, color: C.accent, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {countdown}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={nextChart}
                    style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted, background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 9px", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Trocar gráfico
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAutoPlay((a) => !a)}
                  title="Modo apresentação"
                  style={{ width: 26, height: 26, borderRadius: "50%", border: `1px solid ${C.border}`, background: C.surface, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, color: C.text, flexShrink: 0 }}
                >
                  {autoPlay ? "⏸" : "▶"}
                </button>
              </div>
            </div>
            <canvas ref={canvasRef} style={{ flex: 1, width: "100%", display: "block" }} />
          </div>
        </div>

        {/* ── DIREITA ── */}
        <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", minHeight: 0, gap: 10, paddingRight: 6 }}>
          {/* Belt */}
          <div style={{ flexShrink: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(20,18,14,.05)", padding: "12px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ width: 11, height: 11, borderRadius: "50%", background: belt.color, flexShrink: 0, display: "inline-block" }} />
                <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {belt.name} → {nextBelt.name}
                </span>
              </div>
              <span style={{ fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>
                {fmtBRL(com)} / {fmtBRL(nextBelt.goal)}
              </span>
            </div>
            <div style={{ height: 6, background: C.elevated, borderRadius: 4, overflow: "hidden", marginTop: 7 }}>
              <div style={{ height: "100%", background: C.accent, width: `${beltPct}%`, transition: "width 0.5s ease" }} />
            </div>
          </div>

          {/* Métricas derivadas */}
          {[
            { label: "CPL", value: cpl },
            { label: "CAC", value: cac },
            { label: "ROI", value: roi },
            { label: "Conversão", value: convPct },
          ].map((m) => (
            <div key={m.label} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 1px 2px rgba(20,18,14,.05)", padding: "10px 16px" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
                {m.label === "CPL" ? "📊" : m.label === "CAC" ? "👤" : m.label === "ROI" ? "📈" : "✅"}
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.25 }}>{m.value}</div>
              </div>
            </div>
          ))}

          {/* Histórico mensal */}
          <div style={{ flex: 1, minHeight: 200, display: "flex", flexDirection: "column", overflow: "hidden", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(20,18,14,.05)" }}>
            <div style={{ padding: "12px 18px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.muted }}>Histórico</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 14px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    {["Mês","Invest.","Leads","Vendas","Comiss."].map((h) => (
                      <th key={h} style={{ textAlign: "left", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.03em", color: C.muted, padding: "7px 4px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.surface }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...data.monthly].reverse().map((m) => {
                    const now2 = new Date();
                    const currMk = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}`;
                    const isCurr = m.month === currMk;
                    return (
                      <tr key={m.month} style={{ background: isCurr ? C.accentSoft : "transparent" }}>
                        <td style={{ padding: "5px 4px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, color: isCurr ? C.accent : C.text, whiteSpace: "nowrap" }}>
                          {monthLabel(m.month)}/{m.month.slice(2, 4)}{isCurr ? " ●" : ""}
                        </td>
                        <td style={{ padding: "5px 4px", borderBottom: `1px solid ${C.border}` }}>
                          {m.investment > 0 ? `R$${m.investment.toFixed(0)}` : "—"}
                        </td>
                        <td style={{ padding: "5px 4px", borderBottom: `1px solid ${C.border}` }}>{m.leads_created}</td>
                        <td style={{ padding: "5px 4px", borderBottom: `1px solid ${C.border}` }}>{m.leads_won}</td>
                        <td style={{ padding: "5px 4px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, color: C.accent }}>
                          {m.commission > 0 ? fmtBRLFull(m.commission) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Renderização canvas
// ---------------------------------------------------------------------------

function drawChart(
  canvas: HTMLCanvasElement | null,
  chart: ChartType,
  data: TvData,
  progress: number,
) {
  if (!canvas) return;
  const par = canvas.parentElement;
  if (!par) return;
  const w = Math.max(par.offsetWidth - 4, 100);
  const h = Math.max(par.offsetHeight - 34, 80);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  if (chart === "growth")        drawGrowth(ctx, w, h, progress, data);
  else if (chart === "conversion")     drawConversion(ctx, w, h, progress, data);
  else if (chart === "leads_vs_sales") drawLeadsVsSales(ctx, w, h, progress, data);
  else if (chart === "roi")            drawROI(ctx, w, h, progress, data);
}

// ── Chart 1: Comissão vs Investimento ──
function drawGrowth(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number, data: TvData) {
  const pts = data.monthly;
  const coms = pts.map((m) => m.commission);
  const invs = pts.map((m) => m.investment);
  const pL = 58, pR = 16, pT = 28, pB = 30;
  const pw = w - pL - pR, ph = h - pT - pB, n = pts.length;
  const maxV = Math.max(...coms, ...invs, 1);
  const sx = n > 1 ? pw / (n - 1) : pw;
  const tx = (i: number) => pL + i * sx;
  const ty = (v: number) => pT + ph * (1 - v / maxV);

  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pT + (ph / 4) * g;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(w - pR, y); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = "12px system-ui"; ctx.textAlign = "right";
    ctx.fillText(fmtBRL(maxV * (1 - g / 4)), pL - 8, y + 4);
  }

  const comPts = coms.map((v, i) => ({ x: tx(i), y: ty(v) }));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pL + pw * progress, h); ctx.clip();

  const grad = ctx.createLinearGradient(0, pT, 0, pT + ph);
  grad.addColorStop(0, "rgba(80,109,72,.18)"); grad.addColorStop(1, "rgba(80,109,72,0)");
  ctx.beginPath(); smoothPath(ctx, comPts);
  ctx.lineTo(tx(n - 1), pT + ph); ctx.lineTo(pL, pT + ph); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.save(); ctx.shadowColor = "rgba(80,109,72,.40)"; ctx.shadowBlur = 10;
  ctx.beginPath(); smoothPath(ctx, comPts);
  ctx.strokeStyle = C.accent; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); ctx.restore();

  ctx.beginPath(); ctx.strokeStyle = "#a8a398"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  invs.forEach((v, i) => { i === 0 ? ctx.moveTo(tx(i), ty(v)) : ctx.lineTo(tx(i), ty(v)); });
  ctx.stroke(); ctx.setLineDash([]);

  comPts.forEach(({ x, y }, i) => {
    const last = i === n - 1;
    if (last) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fillStyle = "rgba(80,109,72,.14)"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(x, y, last ? 6 : 5, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
  });
  ctx.restore();

  if (progress >= 0.98) {
    ctx.font = "bold 12px system-ui"; ctx.textAlign = "center";
    let lastY = -Infinity;
    coms.forEach((v, i) => {
      if (v <= 0) return;
      let ly = ty(v) - 14;
      if (ly < pT + 8) ly = ty(v) + 22;
      else if (Math.abs(ly - lastY) < 18 && i > 0) ly = ty(v) + 22;
      ctx.fillStyle = "#3d5c37"; ctx.fillText(fmtBRL(v), tx(i), ly); lastY = ly;
    });
  }

  ctx.fillStyle = C.muted; ctx.font = "12px system-ui"; ctx.textAlign = "center";
  pts.forEach((m, i) => ctx.fillText(monthLabel(m.month), tx(i), h - 10));
}

// ── Chart 2: Conversão por Etapa ──
function drawConversion(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number, data: TvData) {
  const stages = data.funnel_stages;
  if (stages.length < 2) {
    ctx.fillStyle = C.muted; ctx.font = "14px system-ui"; ctx.textAlign = "center";
    ctx.fillText("Dados insuficientes para exibir conversão.", w / 2, h / 2);
    return;
  }
  const transitions = stages.slice(1).map((s, i) => {
    const prev = stages[i]!;
    const rate = prev.open_count > 0 ? Math.min(Math.round((s.open_count / prev.open_count) * 100), 100) : 0;
    const label = `${prev.name.split(" ")[0]} → ${s.name.split(" ")[0]}`;
    const color = rate >= 70 ? C.success : rate >= 40 ? C.warning : C.error;
    return { label, rate, color };
  });

  const n = transitions.length;
  const pL = 140, pR = 54, pT = 16, pB = 20, pw = w - pL - pR, ph = h - pT - pB;
  const rowH = ph / n, barH = Math.min(rowH * 0.48, 30);

  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pL + pw, pT); ctx.lineTo(pL + pw, pT + ph); ctx.stroke();
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(pL + pw * 0.5, pT); ctx.lineTo(pL + pw * 0.5, pT + ph); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.muted; ctx.font = "10px system-ui"; ctx.textAlign = "center";
  ctx.fillText("50%", pL + pw * 0.5, pT + ph + 14); ctx.fillText("100%", pL + pw, pT + ph + 14);

  transitions.forEach(({ label, rate, color }, i) => {
    const y = pT + i * rowH + (rowH - barH) / 2;
    const barW = pw * (rate / 100) * progress;
    const rr = 4;

    ctx.fillStyle = C.elevated;
    ctx.beginPath();
    ctx.roundRect(pL, y, pw, barH, rr);
    ctx.fill();

    if (barW > 0) {
      ctx.fillStyle = color; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.roundRect(pL, y, barW, barH, rr); ctx.fill(); ctx.globalAlpha = 1;
    }

    ctx.fillStyle = C.text; ctx.font = "bold 11px system-ui"; ctx.textAlign = "right";
    ctx.fillText(label, pL - 8, y + barH / 2 + 4);

    if (progress >= 0.5) {
      ctx.fillStyle = color; ctx.font = "bold 13px system-ui"; ctx.textAlign = "left";
      ctx.fillText(`${rate}%`, pL + pw + 8, y + barH / 2 + 4);
    }
  });
}

// ── Chart 3: Leads vs Vendas por Mês ──
function drawLeadsVsSales(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number, data: TvData) {
  const pts = data.monthly;
  const leads = pts.map((m) => m.leads_created);
  const sales = pts.map((m) => m.leads_won);
  const n = pts.length;
  const maxV = Math.max(...leads, ...sales, 1);
  const pL = 44, pR = 16, pT = 28, pB = 30, pw = w - pL - pR, ph = h - pT - pB;
  const slotW = pw / n, barW = (slotW * 0.4) - 2;

  const ticks = Math.min(maxV, 5);
  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  for (let g = 0; g <= ticks; g++) {
    const val = Math.round(maxV * (g / ticks));
    const y = pT + ph * (1 - g / ticks);
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(w - pR, y); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = "12px system-ui"; ctx.textAlign = "right";
    ctx.fillText(String(val), pL - 6, y + 4);
  }

  pts.forEach((m, i) => {
    const cx = pL + i * slotW + slotW / 2;
    const lx = cx - barW - 1, sx = cx + 1;
    const rr = 4;

    const lH = Math.max((leads[i]! / maxV) * ph * progress, 2);
    const ly = pT + ph - lH;
    ctx.fillStyle = "rgba(80,109,72,.45)";
    ctx.beginPath(); ctx.roundRect(lx, ly, barW, lH, [rr, rr, 0, 0]); ctx.fill();

    if (sales[i]! > 0) {
      const sH = Math.max((sales[i]! / maxV) * ph * progress, 2);
      const sy = pT + ph - sH;
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.roundRect(sx, sy, barW, sH, [rr, rr, 0, 0]); ctx.fill();
    }

    if (progress >= 0.9) {
      ctx.font = "bold 11px system-ui"; ctx.textAlign = "center";
      if (leads[i]! > 0) { ctx.fillStyle = C.muted; ctx.fillText(String(leads[i]), lx + barW / 2, ly - 5); }
      if (sales[i]! > 0) {
        const sH2 = (sales[i]! / maxV) * ph * progress;
        ctx.fillStyle = "#3d5c37"; ctx.fillText(String(sales[i]), sx + barW / 2, pT + ph - sH2 - 5);
      }
    }

    ctx.fillStyle = C.muted; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText(monthLabel(m.month), cx, h - 10);
  });
}

// ── Chart 4: ROI Mensal ──
function drawROI(ctx: CanvasRenderingContext2D, w: number, h: number, progress: number, data: TvData) {
  const pts = data.monthly;
  const rois = pts.map((m) => {
    if (m.investment <= 0) return null;
    return Math.round(((m.commission - m.investment) / m.investment) * 100);
  });
  const valid = rois.filter((v): v is number => v !== null);
  if (valid.length === 0) {
    ctx.fillStyle = C.muted; ctx.font = "14px system-ui"; ctx.textAlign = "center";
    ctx.fillText("Configure investimento mensal nas configurações do Painel TV.", w / 2, h / 2);
    return;
  }

  const pL = 62, pR = 16, pT = 28, pB = 30, pw = w - pL - pR, ph = h - pT - pB, n = pts.length;
  const maxV = Math.max(...valid, 100);
  const sx = n > 1 ? pw / (n - 1) : pw;
  const tx = (i: number) => pL + i * sx;
  const ty = (v: number) => pT + ph * (1 - v / maxV);

  ctx.strokeStyle = C.border; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pT + (ph / 4) * g;
    ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(w - pR, y); ctx.stroke();
    ctx.fillStyle = C.muted; ctx.font = "12px system-ui"; ctx.textAlign = "right";
    ctx.fillText(`${Math.round(maxV * (1 - g / 4))}%`, pL - 8, y + 4);
  }

  // Agrupa pontos válidos em segmentos contíguos
  const segments: Array<Array<{ x: number; y: number; v: number }>> = [];
  let seg: Array<{ x: number; y: number; v: number }> = [];
  rois.forEach((v, i) => {
    if (v !== null) seg.push({ x: tx(i), y: ty(v), v });
    else if (seg.length > 0) { segments.push(seg); seg = []; }
  });
  if (seg.length > 0) segments.push(seg);

  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pL + pw * progress, h); ctx.clip();

  segments.forEach((s) => {
    if (s.length === 0) return;
    const grad = ctx.createLinearGradient(0, pT, 0, pT + ph);
    grad.addColorStop(0, "rgba(80,109,72,.16)"); grad.addColorStop(1, "rgba(80,109,72,0)");
    ctx.beginPath(); smoothPath(ctx, s);
    ctx.lineTo(s[s.length - 1]!.x, pT + ph); ctx.lineTo(s[0]!.x, pT + ph); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.save(); ctx.shadowColor = "rgba(80,109,72,.35)"; ctx.shadowBlur = 8;
    ctx.beginPath(); smoothPath(ctx, s);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); ctx.restore();

    s.forEach(({ x, y }, si) => {
      const last = si === s.length - 1;
      if (last) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fillStyle = "rgba(80,109,72,.12)"; ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, last ? 6 : 5, 0, Math.PI * 2); ctx.fillStyle = C.accent; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.bg; ctx.stroke();
    });
  });
  ctx.restore();

  if (progress >= 0.98) {
    ctx.font = "bold 12px system-ui"; ctx.textAlign = "center";
    let lastY = -Infinity;
    rois.forEach((v, i) => {
      if (v === null) return;
      let ly = ty(v) - 14;
      if (ly < pT + 8) ly = ty(v) + 22;
      else if (Math.abs(ly - lastY) < 18) ly = ty(v) + 22;
      ctx.fillStyle = "#3d5c37"; ctx.fillText(`${v}%`, tx(i), ly); lastY = ly;
    });
  }

  ctx.fillStyle = C.muted; ctx.font = "12px system-ui"; ctx.textAlign = "center";
  pts.forEach((m, i) => ctx.fillText(monthLabel(m.month), tx(i), h - 10));
}
