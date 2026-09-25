"use client";

import React, { useRef, useEffect } from "react";
import { Plus, Trash2, X, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { SortRule } from "../../hooks/useTableSort";

interface ColumnOption {
  key: string;
  label: string;
  isAi?: boolean;
}

interface SortPanelProps {
  columns: ColumnOption[];
  sortRules: SortRule[];
  onAddSort: (colKey?: string) => void;
  onUpdateSort: (index: number, updates: Partial<SortRule>) => void;
  onRemoveSort: (index: number) => void;
  onClearSort: () => void;
  onClose: () => void;
}

export function SortPanel({
  columns,
  sortRules,
  onAddSort,
  onUpdateSort,
  onRemoveSort,
  onClearSort,
  onClose,
}: SortPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 sm:right-auto sm:left-0 mt-2 z-50 bg-white border border-slate-200 rounded-xl shadow-2xl p-4 w-[90vw] max-w-[440px] text-xs animate-in fade-in select-none"
      style={{ boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)" }}
    >
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800 text-[13px]">
          <ArrowUpDown className="w-4 h-4 text-orange-500" />
          <span>Sortierung</span>
          {sortRules.length > 0 && (
            <span className="bg-orange-100 text-orange-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {sortRules.length} aktiv
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {sortRules.length === 0 ? (
        <div className="py-6 text-center text-slate-400 bg-slate-50/50 rounded-lg border border-dashed border-slate-200 mb-3">
          <p className="mb-2">Keine aktive Sortierung festgelegt.</p>
          <button
            type="button"
            onClick={() => onAddSort(columns[0]?.key)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-orange-300 text-slate-700 rounded-lg font-medium shadow-2xs hover:text-orange-600 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-orange-500" />
            <span>Erste Sortierregel hinzufügen</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2 mb-3 max-h-[300px] overflow-y-auto pr-1">
          {sortRules.map((rule, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200/80"
            >
              <span className="text-[10px] uppercase font-bold text-slate-400 w-11 shrink-0 text-center">
                {idx === 0 ? "1st" : `${idx + 1}th`}
              </span>

              {/* Spalten-Auswahl */}
              <select
                value={rule.column}
                onChange={(e) => onUpdateSort(idx, { column: e.target.value })}
                className="bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-800 font-medium text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none flex-1 min-w-[140px]"
              >
                <option value="" disabled>Spalte wählen...</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.isAi ? `✨ ${c.label}` : c.label}
                  </option>
                ))}
              </select>

              {/* Richtung */}
              <div className="flex border border-slate-200 rounded-md overflow-hidden bg-white shrink-0">
                <button
                  type="button"
                  onClick={() => onUpdateSort(idx, { direction: "asc" })}
                  className={`px-2 py-1 flex items-center gap-1 transition-colors ${
                    rule.direction === "asc"
                      ? "bg-orange-500 text-white font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  title="Aufsteigend (A bis Z / 1 bis 9)"
                >
                  <ArrowUp className="w-3 h-3" />
                  <span>A → Z</span>
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSort(idx, { direction: "desc" })}
                  className={`px-2 py-1 flex items-center gap-1 transition-colors border-l border-slate-200 ${
                    rule.direction === "desc"
                      ? "bg-orange-500 text-white font-semibold"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                  title="Absteigend (Z bis A / 9 bis 1)"
                >
                  <ArrowDown className="w-3 h-3" />
                  <span>Z → A</span>
                </button>
              </div>

              {/* Löschen */}
              <button
                type="button"
                onClick={() => onRemoveSort(idx)}
                className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors shrink-0"
                title="Sortierregel entfernen"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={() => onAddSort(columns[0]?.key)}
          className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-semibold py-1 px-2 rounded hover:bg-orange-50 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Weiteres Sortierfeld</span>
        </button>

        {sortRules.length > 0 && (
          <button
            type="button"
            onClick={onClearSort}
            className="text-rose-600 hover:text-rose-700 font-medium py-1 px-2 rounded hover:bg-rose-50 transition-colors cursor-pointer"
          >
            Sortierung zurücksetzen
          </button>
        )}
      </div>
    </div>
  );
}
