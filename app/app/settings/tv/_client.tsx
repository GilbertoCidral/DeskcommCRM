"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTvConfig } from "@/app/actions/settings/saveTvConfig";

const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2019 }, (_, i) => 2020 + i).reverse();

interface InvestmentEntry {
  id: string;
  month: string; // "YYYY-MM"
  amount: number;
}

interface Props {
  commissionRate: number;
  investments: InvestmentEntry[];
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseMonthYear(month: string): { year: string; mon: string } {
  const [y, m] = month.split("-");
  return { year: y ?? String(CURRENT_YEAR), mon: m ?? "01" };
}

export function TvSettingsClient({ commissionRate: initialRate, investments: initialInvs }: Props) {
  const [rate, setRate] = useState(String(Math.round(initialRate * 100)));
  const [entries, setEntries] = useState<Array<{ id: string; year: string; mon: string; amount: string }>>(
    initialInvs.map((inv) => {
      const { year, mon } = parseMonthYear(inv.month);
      return { id: inv.id, year, mon, amount: String(inv.amount) };
    }),
  );
  const [isPending, startTransition] = useTransition();

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      { id: newId(), year: String(CURRENT_YEAR), mon: String(new Date().getMonth() + 1).padStart(2, "0"), amount: "" },
    ]);
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function updateEntry(id: string, field: "year" | "mon" | "amount", value: string) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();

    const rateNum = parseFloat(rate.replace(",", ".")) / 100;
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 1) {
      toast.error("Taxa inválida. Use um valor entre 0 e 100.");
      return;
    }

    const investments = entries
      .map((e) => {
        const amount = parseFloat(e.amount.replace(",", "."));
        return { id: e.id, month: `${e.year}-${e.mon}`, amount: isNaN(amount) ? 0 : amount };
      })
      .filter((inv) => inv.amount > 0);

    startTransition(async () => {
      const r = await saveTvConfig({ commission_rate: rateNum, investments });
      if (r.ok) toast.success("Configurações salvas.");
      else toast.error(`Erro: ${r.error}`);
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {/* Botão de acesso ao painel */}
      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Painel TV</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Abra em tela cheia na TV para exibir a performance em tempo real.
          </p>
        </div>
        <a href="/app/tv" target="_blank" rel="noopener noreferrer">
          <Button type="button">Abrir painel ↗</Button>
        </a>
      </Card>

      {/* Configurações */}
      <Card className="p-6">
        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <h2 className="text-base font-semibold">Configurações de Performance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Comissão e histórico de investimento mensal. Comissão = valor fechado × taxa.
            </p>
          </div>

          {/* Taxa de comissão */}
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
            <p className="text-xs text-muted-foreground">Ex.: 20 = 20% do valor dos negócios fechados.</p>
          </div>

          {/* Lista de investimentos */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>Investimento mensal (R$)</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Custo de marketing por mês. Usado para calcular ROI e CPL.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addEntry}>
                + Adicionar mês
              </Button>
            </div>

            {entries.length === 0 ? (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                Nenhum investimento cadastrado. Clique em &ldquo;+ Adicionar mês&rdquo; para começar.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {entries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 px-3 py-2">
                    <select
                      aria-label="Mês"
                      value={entry.mon}
                      onChange={(e) => updateEntry(entry.id, "mon", e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {MONTH_NAMES.map((name, i) => (
                        <option key={name} value={String(i + 1).padStart(2, "0")}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Ano"
                      value={entry.year}
                      onChange={(e) => updateEntry(entry.id, "year", e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {YEAR_OPTIONS.map((y) => (
                        <option key={y} value={String(y)}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0,00"
                      value={entry.amount}
                      onChange={(e) => updateEntry(entry.id, "amount", e.target.value)}
                      className="h-8 w-32 text-sm"
                      aria-label="Valor"
                    />
                    <span className="shrink-0 text-sm text-muted-foreground">R$</span>
                    <button
                      type="button"
                      onClick={() => removeEntry(entry.id)}
                      className="ml-auto shrink-0 text-sm text-muted-foreground hover:text-destructive"
                      aria-label="Remover"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando…" : "Salvar configurações"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
