"use client";

import React, { useState } from "react";
import {
  Play,
  ChevronDown,
  Square,
  RefreshCw,
  Sliders,
  Filter,
  ArrowUpDown,
  Search,
  X,
  Sparkles,
  Columns3,
  ListFilter,
  Layers,
  Building2,
  Users,
  MoreHorizontal,
  Trash2,
  CopyCheck,
  RotateCcw,
} from "lucide-react";
import { FilterPanel } from "./FilterPanel";
import { SortPanel } from "./SortPanel";
import type { FilterRule } from "../../hooks/useTableFilter";
import type { SortRule } from "../../hooks/useTableSort";

interface ColumnOption {
  key: string;
  label: string;
  isAi?: boolean;
}

interface TableToolbarProps {
  // Counts
  totalRows: number;
  filteredRowsCount: number;
  totalColumnsCount: number;
  visibleColumnsCount: number;

  // View modes
  viewMode: "flat" | "grouped";
  onViewModeChange: (mode: "flat" | "grouped") => void;

  // Search & Filters
  searchQuery: string;
  onSearchChange: (val: string) => void;
  filters: FilterRule[];
  onAddFilter: (colKey?: string) => void;
  onUpdateFilter: (id: string, updates: Partial<FilterRule>) => void;
  onRemoveFilter: (id: string) => void;
  onClearFilters: () => void;

  // Sorting
  sortRules: SortRule[];
  onAddSort: (colKey?: string) => void;
  onUpdateSort: (index: number, updates: Partial<SortRule>) => void;
  onRemoveSort: (index: number) => void;
  onClearSort: () => void;

  // Columns & Options
  columns: ColumnOption[];
  onToggleColVisibility: () => void;
  isColVisibilityOpen: boolean;
  hiddenColsCount: number;

  // AI & Table Actions
  onRunFullTable: (mode: "all_force" | "empty_only") => void;
  onRunPhase: (phase: "company" | "contact") => void;
  onHardStop: () => void;
  stoppingProcess: boolean;
  onResetStatus: () => void;
  onDedupe: () => void;
  onCleanJunk: () => void;
  onAddColumn: () => void;

  // Relevance
  relevanceStats?: any;
  atypicCount: number;
  onOpenRelevanceModal: () => void;
  onOpenRelevanceSettings: () => void;
  onCancelRelevanceJob: () => void;
}

export function TableToolbar({
  totalRows,
  filteredRowsCount,
  totalColumnsCount,
  visibleColumnsCount,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  filters,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  onClearFilters,
  sortRules,
  onAddSort,
  onUpdateSort,
  onRemoveSort,
  onClearSort,
  columns,
  onToggleColVisibility,
  isColVisibilityOpen,
  hiddenColsCount,
  onRunFullTable,
  onRunPhase,
  onHardStop,
  stoppingProcess,
  onResetStatus,
  onDedupe,
  onCleanJunk,
  onAddColumn,
  relevanceStats,
  atypicCount,
  onOpenRelevanceModal,
  onOpenRelevanceSettings,
  onCancelRelevanceJob,
}: TableToolbarProps) {
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showSortPanel, setShowSortPanel] = useState(false);
  const [showRunMenu, setShowRunMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const hasActiveFilters = filters.length > 0 || searchQuery.trim().length > 0;
  const hasActiveSort = sortRules.length > 0;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b select-none"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        minHeight: 46,
      }}
    >
      {/* LEFT: Clay Counters, View Mode, Filter & Sort Triggers */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Clay Style: Counters */}
        <div className="hidden lg:flex items-center gap-2.5 text-[11px] font-medium text-slate-500 bg-slate-100/70 border border-slate-200/80 px-2.5 py-1 rounded-md">
          <div className="flex items-center gap-1">
            <Columns3 className="w-3.5 h-3.5 text-slate-400" />
            <span>
              <strong className="text-slate-800">{visibleColumnsCount}</strong>/{totalColumnsCount} Spalten
            </span>
          </div>
          <span className="text-slate-300">·</span>
          <div className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>
              <strong className="text-slate-800">{filteredRowsCount}</strong>/{totalRows} Zeilen
            </span>
          </div>
        </div>

        {/* View Mode Toggle (Flach / Gruppiert) */}
        <div className="flex bg-slate-100/90 border border-slate-200 p-0.5 rounded-md text-[11px]">
          <button
            type="button"
            onClick={() => onViewModeChange("flat")}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              viewMode === "flat"
                ? "bg-white text-slate-900 font-semibold shadow-2xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Flach
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("grouped")}
            className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
              viewMode === "grouped"
                ? "bg-white text-slate-900 font-semibold shadow-2xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            Gruppiert
          </button>
        </div>

        {/* Filter Popover Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowFilterPanel((v) => !v);
              setShowSortPanel(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded-md border transition-all cursor-pointer font-medium ${
              hasActiveFilters || showFilterPanel
                ? "bg-orange-50 border-orange-300 text-orange-700 shadow-2xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
            title="Filter-Bedingungen definieren"
          >
            <Filter className={`w-3.5 h-3.5 ${hasActiveFilters ? "text-orange-600" : "text-slate-400"}`} />
            <span>Filter</span>
            {filters.length > 0 && (
              <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 rounded-full">
                {filters.length}
              </span>
            )}
          </button>

          {showFilterPanel && (
            <FilterPanel
              columns={columns}
              filters={filters}
              onAddFilter={onAddFilter}
              onUpdateFilter={onUpdateFilter}
              onRemoveFilter={onRemoveFilter}
              onClearFilters={onClearFilters}
              onClose={() => setShowFilterPanel(false)}
            />
          )}
        </div>

        {/* Sort Popover Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowSortPanel((v) => !v);
              setShowFilterPanel(false);
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded-md border transition-all cursor-pointer font-medium ${
              hasActiveSort || showSortPanel
                ? "bg-orange-50 border-orange-300 text-orange-700 shadow-2xs"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            }`}
            title="Sortier-Reihenfolge festlegen"
          >
            <ArrowUpDown className={`w-3.5 h-3.5 ${hasActiveSort ? "text-orange-600" : "text-slate-400"}`} />
            <span>Sortieren</span>
            {sortRules.length > 0 && (
              <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 rounded-full">
                {sortRules.length}
              </span>
            )}
          </button>

          {showSortPanel && (
            <SortPanel
              columns={columns}
              sortRules={sortRules}
              onAddSort={onAddSort}
              onUpdateSort={onUpdateSort}
              onRemoveSort={onRemoveSort}
              onClearSort={onClearSort}
              onClose={() => setShowSortPanel(false)}
            />
          )}
        </div>

        {/* Spalten-Sichtbarkeit */}
        <button
          type="button"
          onClick={onToggleColVisibility}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded-md border transition-all cursor-pointer font-medium ${
            isColVisibilityOpen || hiddenColsCount > 0
              ? "bg-slate-100 border-slate-300 text-slate-800"
              : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
          }`}
          title="Spalten ein-/ausblenden"
        >
          <Sliders className="w-3.5 h-3.5 text-slate-400" />
          <span>Spalten</span>
          {hiddenColsCount > 0 && (
            <span className="bg-slate-200 text-slate-700 text-[10px] font-bold px-1.5 rounded-full">
              {hiddenColsCount} verborgen
            </span>
          )}
        </button>

        {/* Global Search Input */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 pointer-events-none" />
          <input
            type="text"
            placeholder="In Tabelle suchen..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-7 pr-6 py-1 bg-white border border-slate-200 rounded-md text-[11.5px] text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-500 w-36 sm:w-48 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-1.5 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* RIGHT: Actions (Run, Stop, Tools, Relevance, More) */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Active Relevance Job indicator (if running) */}
        {relevanceStats?.status === "running" && (
          <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-md text-[11px] text-indigo-700">
            <span className="animate-spin">⚙️</span>
            <span>{relevanceStats.progress.percentage}%</span>
            <button
              type="button"
              onClick={onCancelRelevanceJob}
              className="text-rose-600 hover:text-rose-800 font-bold ml-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* 3-Dots More Menu (Reset, Dedupe, Junk, Relevanz) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowMoreMenu((v) => !v);
              setShowRunMenu(false);
            }}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11.5px] rounded-md border transition-colors cursor-pointer ${
              showMoreMenu
                ? "bg-slate-100 border-slate-300 text-slate-800 font-medium"
                : "bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
            title="Weitere Aktionen (Reset, Dedupe, Junk, Relevanz)"
          >
            <MoreHorizontal className="w-4 h-4 text-slate-500" />
            <span className="text-[11px]">Mehr</span>
          </button>

          {showMoreMenu && (
            <div
              className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1 text-xs animate-in fade-in"
              onClick={() => setShowMoreMenu(false)}
            >
              <button
                type="button"
                onClick={onOpenRelevanceSettings}
                className="w-full text-left px-3 py-2 hover:bg-indigo-50/60 text-slate-800 flex items-center gap-2.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-800">Relevanz-Filter</div>
                  <div className="text-[10px] text-slate-500">Zielkunden vs. Kataloge prüfen</div>
                </div>
              </button>

              <button
                type="button"
                onClick={onDedupe}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800 flex items-center gap-2.5 border-t border-slate-100 cursor-pointer"
              >
                <CopyCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-800">Deduplizieren</div>
                  <div className="text-[10px] text-slate-500">Doppelte Domains/Zeilen entfernen</div>
                </div>
              </button>

              <button
                type="button"
                onClick={onCleanJunk}
                className="w-full text-left px-3 py-2 hover:bg-rose-50/60 text-rose-700 flex items-center gap-2.5 border-t border-slate-100 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <div>
                  <div className="font-semibold text-rose-700">Junk bereinigen</div>
                  <div className="text-[10px] text-rose-600/80">Verzeichnisse & Redaktion löschen</div>
                </div>
              </button>

              <button
                type="button"
                onClick={onResetStatus}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2.5 border-t border-slate-100 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div>
                  <div className="font-semibold">Status zurücksetzen</div>
                  <div className="text-[10px] text-slate-500">Zell-Status für diesen View leeren</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Run Full Table Menu */}
        <div className="relative">
          <div className="inline-flex rounded-md overflow-hidden border border-emerald-600 bg-emerald-600 text-white shadow-2xs">
            <button
              type="button"
              onClick={() => onRunFullTable("empty_only")}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[11.5px] font-semibold hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              <Play className="w-3 h-3 fill-white" />
              <span>Tabelle ausführen</span>
            </button>
            <button
              type="button"
              onClick={() => setShowRunMenu((v) => !v)}
              className="px-1.5 py-1 border-l border-emerald-500 hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          {showRunMenu && (
            <div
              className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1 text-xs animate-in fade-in"
              onClick={() => setShowRunMenu(false)}
            >
              <button
                type="button"
                onClick={() => onRunFullTable("empty_only")}
                className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-slate-800 flex items-start gap-2"
              >
                <Play className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">Nur offene Zeilen</div>
                  <div className="text-[10px] text-slate-500">Überspringt bereits fertige Zeilen</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onRunFullTable("all_force")}
                className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-slate-800 flex items-start gap-2 border-t border-slate-100"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">Alle Zeilen neu ausführen</div>
                  <div className="text-[10px] text-slate-500">Erzwingt Neuanreicherung aller Zellen</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onRunPhase("company")}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800 flex items-start gap-2 border-t border-slate-100"
              >
                <Building2 className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">1. Nur Firmendaten</div>
                  <div className="text-[10px] text-slate-500">Domain, Adresse & Telefon zuerst</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onRunPhase("contact")}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-800 flex items-start gap-2"
              >
                <Users className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">2. Nur Entscheider & Kontakte</div>
                  <div className="text-[10px] text-slate-500">Geschäftsführer & Impressum</div>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Hard Stop */}
        <button
          type="button"
          onClick={onHardStop}
          disabled={stoppingProcess}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-medium text-rose-600 bg-white border border-rose-300 hover:bg-rose-50 hover:border-rose-400 rounded-md transition-colors cursor-pointer"
          title="Alle laufenden Prozesse für diesen Case abbrechen"
        >
          {stoppingProcess ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Square className="w-3 h-3 fill-current text-rose-500" />
          )}
          <span>Stop</span>
        </button>

        {/* + Spalte Button */}
        <button
          type="button"
          onClick={onAddColumn}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-medium text-slate-600 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-800 rounded-md transition-colors cursor-pointer"
        >
          <span>+ Spalte</span>
        </button>
      </div>
    </div>
  );
}
