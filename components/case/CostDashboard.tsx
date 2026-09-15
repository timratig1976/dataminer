"use client";

import { useMemo } from "react";
import type { CaseTotals } from "@/hooks/useCaseData";

interface CostDashboardProps {
  totals: CaseTotals;
  rowCount: number;
  colCount: number;
}

/**
 * Compact cost + token summary shown in the Case header.
 * Shows: total tokens · USD cost · EUR cost · avg cost per row
 */
export default function CostDashboard({ totals, rowCount, colCount }: CostDashboardProps) {
  const { totalTokens, totalCostUsd, totalCostEur } = totals;

  const avgCostPerRow = useMemo(
    () => (rowCount > 0 && totalCostUsd > 0 ? totalCostUsd / rowCount : null),
    [totalCostUsd, rowCount]
  );

  if (totalTokens === 0 && totalCostUsd === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {totalTokens > 0 && (
        <span style={{
          background: "#f5f3ff", color: "#6d28d9",
          padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          🧠 {totalTokens.toLocaleString("de-DE")} tok
        </span>
      )}
      {totalCostUsd > 0 && (
        <span title="Von Eden AI gemeldete Kosten (inkl. 5,5% Plattformgebühr). Tokens ohne Prompt/Completion-Aufteilung können nicht rückwärts gerechnet werden." style={{
          background: "#eff6ff", color: "#1d4ed8",
          padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
          display: "inline-flex", alignItems: "center", gap: 4, cursor: "help",
        }}>
          $ {totalCostUsd < 0.01 ? totalCostUsd.toFixed(5) : totalCostUsd.toFixed(3)}
        </span>
      )}
      {totalCostEur > 0 && (
        <span title="Umrechnung bei aktuellem EUR/USD-Kurs (~0.91)" style={{
          background: "#fef3c7", color: "#92400e",
          padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "help",
        }}>
          € {totalCostEur < 0.01 ? totalCostEur.toFixed(5) : totalCostEur.toFixed(3)}
        </span>
      )}
      {avgCostPerRow !== null && rowCount > 1 && (
        <span style={{
          background: "#f0fdf4", color: "#166534",
          padding: "2px 8px", borderRadius: 4, fontSize: 11,
          display: "inline-flex", alignItems: "center", gap: 3,
        }}>
          ∅ ${avgCostPerRow < 0.001 ? avgCostPerRow.toFixed(6) : avgCostPerRow.toFixed(4)}/Zeile
        </span>
      )}
    </div>
  );
}
