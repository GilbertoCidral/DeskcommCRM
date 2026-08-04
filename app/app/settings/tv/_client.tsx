"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateTvToken } from "@/app/actions/settings/generateTvToken";
import { saveTvConfig } from "@/app/actions/settings/saveTvConfig";

const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

function monthLabel(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_NAMES[parseInt(m!) - 1]} ${y}`;
}

interface Props {
  token: string | null;
  commissionRate: number;
  monthlyInvestments: Record<string, number>;
  monthKeys: string[];
}

export function TvSettingsClient({ token: initialToken, commissionRate: initialRate, monthlyInvestments: initialInvs, monthKeys }: Props) {
  const [token, setToken] = useState(initialToken);
  const [rate, setRate] = useState(String(Math.round(initialRate * 100)));
  const [investments, setInvestments] = useState<Record<string, string>>(
    Object.fromEntries(monthKeys.map((k) => [k, initialInvs[k] !== undefined ? String(initialInvs[k]) : ""])),
  );
  const [isPendingToken, startToken] = useTransition();
  const [isPendingConfig, startConfig] = useTransition();

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const tvUrl = token ? `${appUrl}/tv/${token}` : null;

  function handleGenerateToken() {
    startToken(async () => {
      const r = await generateTvToken();
      if (r.ok) {
        setToken(r.token);
        toast.success("Link gerado com sucesso.");
      } else {
        toast.error(`Erro: ${r.error}`);
      }
    });
  }

  function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    const rateNum = parseFloat(rate.replace(",", ".")) / 100;
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 1) {
      toast.error("Taxa inválida. Use um valor entre 0 e 100.");
      return;
    }
    const invMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(investments)) {
      const n = parseFloat(v.replace(",", "."));
      if (!isNaN(n) && n > 0) invMap[k] = n;
    }
    startConfig(async () => {
      const r = await saveTvConfig({ commission_rate: rateNum, monthly_investments: invMap });
      if (r.ok) toast.success("Configurações salvas.");
      else toast.error(`Erro: ${r.error}`);
    });
  }

  function copyUrl() {
    if (!tvUrl) return;
    navigator.clipboard.writeText(tvUrl).then(() => toast.success("Link copiado!"));
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* Link TV */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">Link do Painel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            O link é secreto — quem tiver a URL pode ver o painel sem fazer login.
          </p>
        </div>

        {tvUrl ? (
          <div className="flex items-center gap-2">
            <Input readOnly value={tvUrl} className="font-mono text-sm" />
            <Button type="button" variant="outline" onClick={copyUrl} className="shrink-0">
              Copiar
            </Button>
            <a href={tvUrl} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline" className="shrink-0">
                Abrir
              </Button>
            </a>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">Nenhum link gerado ainda.</p>
        )}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant={token ? "destructive" : "default"}
            onClick={handleGenerateToken}
            disabled={isPendingToken}
          >
            {isPendingToken ? "Gerando…" : token ? "Regenerar link (invalida o atual)" : "Gerar link"}
          </Button>
          {token && (
            <p className="text-xs text-muted-foreground">
              Regenerar cria um novo link — o link anterior para de funcionar imediatamente.
            </p>
          )}
        </div>
      </Card>

      {/* Configurações */}
      <Card className="p-6">
        <form onSubmit={handleSaveConfig} className="space-y-5">
          <div>
            <h2 className="text-base font-semibold">Configurações de Performance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Comissão e investimento mensal. Comissão = valor fechado × taxa.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rate">Taxa de comissão (%)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="rate"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Ex.: 20 = 20% do valor dos negócios fechados.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Investimento mensal (R$)</Label>
            <p className="text-xs text-muted-foreground">
              Custo de marketing / aquisição por mês. Usado para calcular ROI e CPL.
            </p>
            <div className="divide-y rounded-md border">
              {monthKeys.map((mk) => (
                <div key={mk} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-20 shrink-0 text-sm font-medium">{monthLabel(mk)}</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={investments[mk] ?? ""}
                    onChange={(e) => setInvestments((prev) => ({ ...prev, [mk]: e.target.value }))}
                    className="h-8 w-32 text-sm"
                  />
                  <span className="text-sm text-muted-foreground">R$</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPendingConfig}>
              {isPendingConfig ? "Salvando…" : "Salvar configurações"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
