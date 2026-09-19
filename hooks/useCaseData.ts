"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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
  resetColOrder: () => Promise<void>;
}

export function useCaseData(caseId: string): UseCaseDataReturn {
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [colOrder, setColOrder] = useState<string[]>([]);
  const forceSmartOrderRef = useRef(false);
  const skipNextSaveRef = useRef(false);
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
      const hasBatchContacts = c.aiColumns.some((col: AiColumn) => col.tool === "batch_contact");
      const aiOutputKeys = c.aiColumns.map((col: AiColumn) => col.outputKey);
      const HIDDEN_PATTERNS = [
        /^contact_\d+_/,          // contact_1_first_name, contact_2_email, etc.
        /^email_extrapolated$/,    // shown inside contacts cell, not as own column
        /^email_fallback$/,
        /^company_email$/,
        /^data_quality$/,
        /^is_catalog$/,            // internal flag
        /^profile_source$/,        // social profile meta
        /^profile_url$/,           // social profile meta
        /^search_query$/,          // discovery meta
        /^search_source$/,
        /^source_domain$/,
        /^source_snippet$/,
        /^source_title$/,
        /^source_url$/,
      ];
      // When a batch_contact column exists, hide the flat contact fields that it writes —
      // they are redundant (contact_1_* holds the same data) and clutter the table.
      const BATCH_CONTACTS_FLAT = hasBatchContacts
        ? [/^first_name$/, /^last_name$/, /^position$/, /^contact_email$/, /^contact_phone$/, /^linkedin$/]
        : [];
      const isHidden = (k: string) => {
        // Explicitly allow cache status column
        if (k === "_scrape_cached_ts") return false;
        // Never hide AI output columns — even if their key starts with "_"
        if (aiOutputKeys.includes(k)) return false;
        if (k.startsWith("_")) return true;
        if (HIDDEN_PATTERNS.some(p => p.test(k))) return true;
        if (BATCH_CONTACTS_FLAT.some(p => p.test(k))) return true;
        return false;
      };

      // Collect ALL keys across ALL rows (not just r[0]) so Maps-only fields appear
      const allDataKeysSet = new Set<string>();
      for (const row of r) {
        for (const k of Object.keys(row.data)) allDataKeysSet.add(k);
      }
      const allDataKeys = [...allDataKeysSet].filter((k: string) => !k.startsWith("_"));
      const allVisibleKeys = [...allDataKeysSet].filter((k: string) => !isHidden(k));
      const srcKeys = allVisibleKeys.filter((k: string) => !aiKeys.includes(k) && !allMultiKeys.includes(k));
      const orphanKeys = allVisibleKeys.filter((k: string) => !srcKeys.includes(k) && !aiKeys.includes(k));

      // Discovery meta-columns: all hidden by default, accessible via system fields panel
      const DISCOVERY_META: string[] = [];  // all source_* and search_* are in HIDDEN_PATTERNS now
      const MAPS_DISPLAY = ["maps_rating", "maps_reviews", "category", "maps_url"];
      const metaCols = DISCOVERY_META.filter(k => allDataKeys.includes(k));
      const otherSrcKeys = srcKeys.filter(k => !DISCOVERY_META.includes(k) && !MAPS_DISPLAY.includes(k));
      // Preferred order: non-meta source cols first, then meta cols last (they're reference data)
      const orderedSrcKeys = [...otherSrcKeys, ...metaCols];

      setSourceColumns(orderedSrcKeys);

      // ── Smart default column order ───────────────────────────────────────
      // Status · company_name · domain · batch_company (AI) · company data fields
      // · batch_contact (AI) · other source cols · other AI cols · meta/discovery
      const COMPANY_DATA_FIELDS = [
        "phone", "company_email", "email", "website",
        "industry", "description", "employees", "founded",
        "address", "city", "zip", "state", "country",
      ];
      const IDENTITY_COLS = ["company_name", "Unternehmensname", "city", "Stadt", "zip", "PLZ", "address", "Adresse", "state", "Bundesland", "country", "Land"];

      const batchEnrichCol  = c.aiColumns.find((col: AiColumn) => col.tool === "batch_company");
      const batchContactCol = c.aiColumns.find((col: AiColumn) => col.tool === "batch_contact");
      const otherAiKeys = aiKeys.filter((k: string) => k !== batchEnrichCol?.outputKey && k !== batchContactCol?.outputKey);

      function buildSmartOrder(): string[] {
        // 1. Domain — always first anchor
        const domain = allVisibleKeys.includes("domain") ? ["domain"] : [];
        // 1b. Cache Status — directly after domain
        const cacheCol = allVisibleKeys.includes("_scrape_cached_ts") ? ["_scrape_cached_ts"] : [];
        // 2. Maps display fields — right after domain when present
        const mapsDisplay = MAPS_DISPLAY.filter(k => allVisibleKeys.includes(k));
        // 3. batch_company AI col — runs after domain+maps, fills everything below
        const enrichAi = batchEnrichCol ? [batchEnrichCol.outputKey] : [];
        // 4. company_name + identity cols — placed AFTER enrich
        const nameCol = IDENTITY_COLS.filter(k => allVisibleKeys.includes(k) && k !== "domain");
        // 5. Company data fields (written by batch_company) — skip any already in nameCol
        const nameSet = new Set([...domain, ...cacheCol, ...mapsDisplay, ...nameCol]);
        const companyData = COMPANY_DATA_FIELDS.filter(k => allVisibleKeys.includes(k) && !nameSet.has(k));
        // 6. batch_contact AI col
        const contactAi = batchContactCol ? [batchContactCol.outputKey] : [];
        // 7. Remaining source cols not yet placed
        const placed = new Set([...domain, ...cacheCol, ...mapsDisplay, ...enrichAi, ...nameCol, ...companyData, ...contactAi]);
        const remaining = otherSrcKeys.filter(k => !placed.has(k));
        // 8. Other AI cols · 9. Meta/discovery at end
        const orphanRemaining = orphanKeys.filter(k => !placed.has(k) && !remaining.includes(k));
        // Deduplicate while preserving order
        const seen = new Set<string>();
        return [...domain, ...cacheCol, ...mapsDisplay, ...enrichAi, ...nameCol, ...companyData, ...contactAi, ...remaining, ...otherAiKeys, ...orphanRemaining, ...metaCols]
          .filter(k => { if (seen.has(k)) return false; seen.add(k); return true; });
      }

      setColOrder((prev) => {
        const isForced = forceSmartOrderRef.current;
        const savedOrder: string[] = (!isForced && c.colOrder?.length ? c.colOrder : []).filter((k: string) => !isHidden(k));
        forceSmartOrderRef.current = false; // consume the flag
        const smart = buildSmartOrder();
        // On forced reset: always use smart order, ignore prev + savedOrder
        if (isForced) {
          const existing = new Set(smart);
          const toAdd = allVisibleKeys.filter((k: string) => !existing.has(k) && !isHidden(k));
          return toAdd.length > 0 ? [...smart, ...toAdd] : smart;
        }
        // Normal load: prefer savedOrder → prev → smart
        const base = savedOrder.length > 0 ? savedOrder : prev.length > 0 ? prev.filter((k: string) => !isHidden(k)) : smart;
        const missingAi = aiKeys.filter((k: string) => !base.includes(k));
        const combined = [...base, ...missingAi];
        const existing = new Set(combined);
        const toAdd = allVisibleKeys.filter((k: string) => !existing.has(k) && !isHidden(k));
        return toAdd.length > 0 ? [...combined, ...toAdd] : combined;
      });
    } else if (c.colOrder?.length || c.aiColumns?.length) {
      // No rows yet — still restore the saved colOrder and ensure all AI columns
      // are visible in the empty table
      const aiKeys = (c.aiColumns ?? []).map((col: AiColumn) => col.outputKey);
      const isHidden = (k: string) => {
        if (aiKeys.includes(k)) return false;
        if (k.startsWith("_")) return true;
        return false;
      };
      const base = (c.colOrder ?? []).filter((k: string) => !isHidden(k));
      const missingAi = aiKeys.filter((k: string) => !base.includes(k));
      setColOrder([...base, ...missingAi]);
    }
    setRangeBis(r.length);
    setRangeMax(r.length);
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Debounce-save colOrder to DB
  useEffect(() => {
    if (!colOrder.length) return;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
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
    /** Reset column order to smart default (domain → batch_company → name fields → company data → batch_contact → meta) */
    resetColOrder: async () => {
      // 1. Set flag BEFORE refresh so the setColOrder callback sees it
      forceSmartOrderRef.current = true;
      // 2. Skip the next debounce save (it would re-save the old order)
      skipNextSaveRef.current = true;
      // 3. Clear saved order in DB so refresh doesn't load old order
      await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colOrder: [] }),
      });
      // 4. Wipe React state first so debounce doesn't re-save old order
      setColOrder([]);
      // 5. Small delay to ensure state flush before refresh
      await new Promise(r => setTimeout(r, 50));
      // 6. Refresh — forceSmartOrderRef is true → buildSmartOrder() is used
      await refresh();
    },
  };
}
