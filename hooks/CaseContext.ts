"use client";

import { createContext, useContext } from "react";
import type { Case, RowData, AiColumn } from "@/lib/types";
import type { CaseTotals } from "@/hooks/useCaseData";

// ── Context shape ─────────────────────────────────────────────────────────────

export interface CaseContextValue {
  caseId: string;
  caseData: Case | null;
  setCaseData: (c: Case) => void;
  rows: RowData[];
  setRows: React.Dispatch<React.SetStateAction<RowData[]>>;
  sourceColumns: string[];
  colOrder: string[];
  setColOrder: React.Dispatch<React.SetStateAction<string[]>>;
  totals: CaseTotals;
  refresh: () => Promise<void>;

  // Convenience helpers used by child components
  updateCase: (patch: Partial<Case> & { aiColumns?: AiColumn[] }) => Promise<Case>;
}

export const CaseContext = createContext<CaseContextValue | null>(null);

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCaseContext(): CaseContextValue {
  const ctx = useContext(CaseContext);
  if (!ctx) throw new Error("useCaseContext must be used inside <CaseContext.Provider>");
  return ctx;
}
