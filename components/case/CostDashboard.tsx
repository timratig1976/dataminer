"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import type { CaseTotals } from "@/hooks/useCaseData";

interface CostDashboardProps {
  totals: CaseTotals;
  rowCount: number;
  colCount: number;
}

function fmt(usd: number): string {
  if (usd === 0) return "0,00";
  if (usd < 0.001) return usd.toFixed(5);
  if (usd < 0.01)  return usd.toFixed(4);
  if (usd < 1)     return usd.toFixed(3);
  return usd.toFixed(2);
}

function fmtEur(eur: number): string {
  if (eur === 0) return "0,00";
  if (eur < 0.001) return eur.toFixed(5).replace(".", ",");
  if (eur < 0.01)  return eur.toFixed(4).replace(".", ",");
  if (eur < 1)     return eur.toFixed(3).replace(".", ",");
  return eur.toFixed(2).replace(".", ",");
}

export default function CostDashboard({ totals, rowCount }: CostDashboardProps) {
  const { totalTokens, totalCostUsd, totalCostEur } = totals;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const avgCostPerRow = useMemo(
    () => (rowCount > 0 && totalCostUsd > 0 ? totalCostUsd / rowCount : null),
    [totalCostUsd, rowCount]
  );

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (totalCostUsd === 0 && totalTokens === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Kosten-Details anzeigen"
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "2px 8px", borderRadius: 99,
          border: `1px solid ${open ? "var(--orange)" : "var(--border)"}`,
          background: open ? "var(--orange-soft)" : "var(--surface)",
          cursor: "pointer", fontSize: 11.5, fontWeight: 500,
          color: open ? "var(--orange)" : "var(--text-2)", lineHeight: 1.5,
        }}
      >
        <span style={{ fontSize: 11 }}>💰</span>
        {totalCostEur > 0 ? <>€ {fmtEur(totalCostEur)}</> : <>$ {fmt(totalCostUsd)}</>}
        <span style={{ fontSize: 9, opacity: 0.55, marginLeft: 1 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          background: "var(--surface)", borderRadius: 8,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow)",
          zIndex: 600, minWidth: 230, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Kosten-Übersicht
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {totalCostEur > 0 && <KpiRow label="Gesamt (EUR)" value={`€ ${fmtEur(totalCostEur)}`} color="var(--orange)" bg="var(--orange-soft)" />}
            {totalCostUsd > 0 && <KpiRow label="Gesamt (USD)" value={`$ ${fmt(totalCostUsd)}`} color="#1d4ed8" bg="#eff6ff" />}
            {totalTokens > 0 && <KpiRow label="Tokens" value={totalTokens.toLocaleString("de-DE")} color="var(--text-1)" bg="var(--bg)" />}
            {avgCostPerRow !== null && rowCount > 1 && (
              <KpiRow label={`Ø pro Zeile (${rowCount})`} value={`$ ${fmt(avgCostPerRow)}`} color="var(--green)" bg="var(--green-soft)" />
            )}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 10, lineHeight: 1.4 }}>
            Von Providern erfasste Kosten · EUR ≈ USD × 0,91
          </div>
        </div>
      )}
    </div>
  );
}

function KpiRow({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 12, color: "#6b7280" }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 12, color, background: bg, padding: "1px 8px", borderRadius: 6, fontFamily: "monospace", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}
