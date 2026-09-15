"use client";

import { useState, useCallback, useEffect } from "react";
import type { Case, RowData, AiColumn } from "@/lib/types";

export interface CaseTotals {
  totalTokens: number;
  totalCostUsd: number;
  totalCostEur: number;
}

export interface UseCaseDataReturn {
  caseData: Case | null;
  setCaseData: React.Dispatch<React.SetStateAction<Case | null>>;
  rows: RowData[];
  setRows: React.Dispatch<React.SetStateAction<RowData[]>>;
  sourceColumns: string[];
  setSourceColumns: React.Dispatch<React.SetStateAction<string[]>>;
  colOrder: string[];
  setColOrder: React.Dispatch<React.SetStateAction<string[]>>;
  rangeBis: number;
  setRangeBis: React.Dispatch<React.SetStateAction<number>>;
  rangeMax: number;
  setRangeMax: React.Dispatch<React.SetStateAction<number>>;
  totals: CaseTotals;
  refresh: () => Promise<void>;
}

export function useCaseData(caseId: string): UseCaseDataReturn {
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [colOrder, setColOrder] = useState<string[]>([]);
  const [rangeBis, setRangeBis] = useState(0);
  const [rangeMax, setRangeMax] = useState(0);

  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch(`/api/cases/${caseId}`).then((x) => x.json()),
      fetch(`/api/rows?caseId=${caseId}`).then((x) => x.json()),
    ]);
    setCaseData(c);
    setRows(r);

    // Clear stuck "running" statuses from previous session
    const stuck = r.filter((row: RowData) =>
      Object.keys(row.cellStatuses).some((k) => row.cellStatuses[k] === "running")
    );
    if (stuck.length > 0) {
      stuck.forEach((row: RowData) => {
        Object.keys(row.cellStatuses).forEach((k) => {
          if (row.cellStatuses[k] === "running") {
            fetch(`/api/rows/${row.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cellStatuses: { ...row.cellStatuses, [k]: "skipped" } }),
            }).catch(console.error);
          }
        });
      });
    }

    if (r.length > 0) {
      const aiKeys = c.aiColumns.map((col: AiColumn) => col.outputKey);
      const allMultiKeys = c.aiColumns.flatMap((col: AiColumn) =>
        (col.multiKeys ?? []).map((mk: { outputKey: string }) => mk.outputKey)
      );

      // Hidden field patterns — stored for export/detail but not shown as table columns
      const HIDDEN_PATTERNS = [
        /^contact_\d+_/,          // contact_1_first_name, contact_2_email, etc.
        /^email_extrapolated$/,    // shown inside contacts cell, not as own column
        /^email_fallback$/,
        /^company_email$/,
        /^data_quality$/,
      ];
      const isHidden = (k: string) => k.startsWith("_") || HIDDEN_PATTERNS.some(p => p.test(k));

      const allDataKeys = Object.keys(r[0].data).filter((k: string) => !k.startsWith("_"));
      const allVisibleKeys = Object.keys(r[0].data).filter((k: string) => !isHidden(k));
      const srcKeys = allVisibleKeys.filter((k: string) => !aiKeys.includes(k) && !allMultiKeys.includes(k));
      const orphanKeys = allVisibleKeys.filter((k: string) => !srcKeys.includes(k) && !aiKeys.includes(k));

      // Discovery meta-columns: always pinned at the start of source columns
      const DISCOVERY_META = ["search_source", "source_url", "source_domain", "search_query", "source_snippet", "source_title"];
      const metaCols = DISCOVERY_META.filter(k => allDataKeys.includes(k));
      const otherSrcKeys = srcKeys.filter(k => !DISCOVERY_META.includes(k));
      // Preferred order: non-meta source cols first, then meta cols last (they're reference data)
      const orderedSrcKeys = [...otherSrcKeys, ...metaCols];

      setSourceColumns(orderedSrcKeys);
      setColOrder((prev) => {
        const savedOrder: string[] = c.colOrder?.length ? c.colOrder : [];
        // Base order: user-data columns first, AI columns next, meta/discovery last
        const base = savedOrder.length > 0 ? savedOrder : [...otherSrcKeys, ...aiKeys, ...orphanKeys, ...metaCols];
        const activeBase = prev.length > 0 ? prev : base;
        const existing = new Set(activeBase);
        const toAdd = allVisibleKeys.filter((k: string) => !existing.has(k));
        return toAdd.length > 0 ? [...activeBase, ...toAdd] : activeBase;
      });
    } else if (c.colOrder?.length) {
      // No rows yet — still restore the saved colOrder so template base columns
      // are visible in the empty table
      setColOrder(c.colOrder);
    }
    setRangeBis(r.length);
    setRangeMax(r.length);
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Debounce-save colOrder to DB
  useEffect(() => {
    if (!colOrder.length) return;
    const t = setTimeout(() => {
      fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colOrder }),
      });
    }, 800);
    return () => clearTimeout(t);
  }, [colOrder, caseId]);

  // Aggregate token + cost totals across all rows
  const totals: CaseTotals = (() => {
    let totalTokens = 0;
    let totalCostUsd = 0;
    let hasEstimatedCosts = false;
    rows.forEach((row) => {
      Object.entries(row.data).forEach(([key, value]) => {
        if (key.startsWith("_llm_tokens_") && typeof value === "string") {
          try {
            const t = JSON.parse(value);
            if (t.total) totalTokens += t.total;
          } catch { /* skip */ }
        }
        if (key.startsWith("_llm_cost_") && typeof value === "string") {
          const c = parseFloat(value);
          if (!isNaN(c)) {
            totalCostUsd += c;
          }
        }
      });
    });
    // EUR using current approximate rate (ECB ~0.91)
    return { totalTokens, totalCostUsd, totalCostEur: totalCostUsd * 0.91 };
  })();

  return {
    caseData, setCaseData,
    rows, setRows,
    sourceColumns, setSourceColumns,
    colOrder, setColOrder,
    rangeBis, setRangeBis,
    rangeMax, setRangeMax,
    totals,
    refresh,
  };
}
