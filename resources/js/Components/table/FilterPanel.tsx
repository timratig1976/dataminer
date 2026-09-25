"use client";

import React, { useRef, useEffect } from "react";
import { Plus, Trash2, X, Filter } from "lucide-react";
import type { FilterRule, FilterOperator } from "../../hooks/useTableFilter";

interface ColumnOption {
  key: string;
  label: string;
  isAi?: boolean;
}

interface FilterPanelProps {
  columns: ColumnOption[];
  filters: FilterRule[];
  onAddFilter: (colKey?: string) => void;
  onUpdateFilter: (id: string, updates: Partial<FilterRule>) => void;
  onRemoveFilter: (id: string) => void;
  onClearFilters: () => void;
  onClose: () => void;
}

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "contains", label: "enthält" },
  { value: "not_contains", label: "enthält nicht" },
  { value: "equals", label: "ist gleich" },
  { value: "not_equals", label: "ist ungleich" },
  { value: "starts_with", label: "beginnt mit" },
  { value: "ends_with", label: "endet mit" },
  { value: "is_empty", label: "ist leer" },
  { value: "is_not_empty", label: "ist nicht leer" },
  { value: "gt", label: "größer als (>)" },
  { value: "lt", label: "kleiner als (<)" },
];

export function FilterPanel({
  columns,
  filters,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  onClearFilters,
  onClose,
}: FilterPanelProps) {
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
      className="absolute top-full right-0 sm:right-auto sm:left-0 mt-2 z-50 bg-white border border-slate-200 rounded-xl shadow-2xl p-4 w-[90vw] max-w-[560px] text-xs animate-in fade-in select-none"
      style={{ boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)" }}
    >
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800 text-[13px]">
          <Filter className="w-4 h-4 text-orange-500" />
          <span>Filter-Bedingungen</span>
          {filters.length > 0 && (
            <span className="bg-orange-100 text-orange-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {filters.length} aktiv
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

      {filters.length === 0 ? (
        <div className="py-6 text-center text-slate-400 bg-slate-50/50 rounded-lg border border-dashed border-slate-200 mb-3">
          <p className="mb-2">Keine aktiven Filter vorhanden.</p>
          <button
            type="button"
            onClick={() => onAddFilter(columns[0]?.key)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-orange-300 text-slate-700 rounded-lg font-medium shadow-2xs hover:text-orange-600 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-orange-500" />
            <span>Ersten Filter hinzufügen</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2 mb-3 max-h-[300px] overflow-y-auto pr-1">
          {filters.map((filter, idx) => {
            const isValDisabled = filter.operator === "is_empty" || filter.operator === "is_not_empty";

            return (
              <div
                key={filter.id}
                className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200/80"
              >
                <span className="text-[10px] uppercase font-bold text-slate-400 w-11 shrink-0 text-center">
                  {idx === 0 ? "Where" : "And"}
                </span>

                {/* Spalten-Auswahl */}
                <select
                  value={filter.column}
                  onChange={(e) => onUpdateFilter(filter.id, { column: e.target.value })}
                  className="bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-800 font-medium text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none flex-1 min-w-[120px]"
                >
                  <option value="" disabled>Spalte auswählen...</option>
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.isAi ? `✨ ${c.label}` : c.label}
                    </option>
                  ))}
                </select>

                {/* Operator-Auswahl */}
                <select
                  value={filter.operator}
                  onChange={(e) => onUpdateFilter(filter.id, { operator: e.target.value as FilterOperator })}
                  className="bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-800 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none w-[130px] shrink-0"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {/* Wert-Eingabe */}
                {!isValDisabled ? (
                  <input
                    type="text"
                    placeholder="Wert eingeben..."
                    value={filter.value}
                    onChange={(e) => onUpdateFilter(filter.id, { value: e.target.value })}
                    className="bg-white border border-slate-200 rounded-md px-2 py-1 text-slate-800 text-xs focus:ring-1 focus:ring-orange-500 focus:outline-none flex-1 min-w-[100px]"
                  />
                ) : (
                  <div className="flex-1 px-2 py-1 text-[11px] text-slate-400 italic">
                    (Kein Wert erforderlich)
                  </div>
                )}

                {/* Löschen */}
                <button
                  type="button"
                  onClick={() => onRemoveFilter(filter.id)}
                  className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors shrink-0"
                  title="Filter entfernen"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={() => onAddFilter(columns[0]?.key)}
          className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-semibold py-1 px-2 rounded hover:bg-orange-50 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Filter hinzufügen</span>
        </button>

        {filters.length > 0 && (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-rose-600 hover:text-rose-700 font-medium py-1 px-2 rounded hover:bg-rose-50 transition-colors cursor-pointer"
          >
            Alle Filter zurücksetzen
          </button>
        )}
      </div>
    </div>
  );
}
