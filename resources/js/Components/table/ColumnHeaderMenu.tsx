"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Filter,
  EyeOff,
  Pin,
  Trash2,
  Pencil,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Play,
  RotateCw,
  Loader2,
  Check,
} from "lucide-react";
import type { AiColumn } from "../types";

export interface EnhancedColumnMenuProps {
  columnKey: string;
  label: string;
  isAi?: boolean;
  aiColDef?: AiColumn;
  isRunning?: boolean;
  isPinned?: boolean;
  sortDirection?: "asc" | "desc" | null;
  onSort?: (dir: "asc" | "desc") => void;
  onFilterByColumn?: () => void;
  onRename?: (newLabel: string) => void;
  onInsertLeft?: () => void;
  onInsertRight?: () => void;
  onPinToggle?: () => void;
  onHide?: () => void;
  onDelete?: () => void;
  onEditAi?: () => void;
  onRunAllAi?: () => void;
  onRunEmptyAi?: () => void;
}

export function EnhancedColumnHeaderMenu({
  columnKey,
  label,
  isAi,
  aiColDef,
  isRunning,
  isPinned,
  sortDirection,
  onSort,
  onFilterByColumn,
  onRename,
  onInsertLeft,
  onInsertRight,
  onPinToggle,
  onHide,
  onDelete,
  onEditAi,
  onRunAllAi,
  onRunEmptyAi,
}: EnhancedColumnMenuProps) {
  const [open, setOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [tempLabel, setTempLabel] = useState(label);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTempLabel(label);
  }, [label]);

  useEffect(() => {
    if (isRenaming) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isRenaming]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setIsRenaming(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const submitRename = () => {
    if (tempLabel.trim() && tempLabel !== label && onRename) {
      onRename(tempLabel.trim());
    }
    setIsRenaming(false);
    setOpen(false);
  };

  return (
    <div className="relative inline-flex items-center min-w-0" ref={menuRef}>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
          open
            ? "bg-orange-100 text-orange-600"
            : "text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
        }`}
        title="Spalten-Menü"
      >
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin text-orange-500" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 w-56 rounded-lg shadow-xl border z-50 text-[11.5px] py-1 bg-white border-slate-200 animate-in fade-in select-none"
          style={{ boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header info / Inline rename */}
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/70">
            {isRenaming ? (
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  value={tempLabel}
                  onChange={(e) => setTempLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename();
                    if (e.key === "Escape") {
                      setIsRenaming(false);
                      setTempLabel(label);
                    }
                  }}
                  className="w-full text-xs font-semibold px-1.5 py-0.5 border border-orange-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 bg-white"
                />
                <button
                  type="button"
                  onClick={submitRename}
                  className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-1">
                <div className="font-semibold text-slate-800 truncate" title={label}>
                  {label}
                </div>
                {onRename && (
                  <button
                    type="button"
                    onClick={() => setIsRenaming(true)}
                    className="text-slate-400 hover:text-slate-600 p-0.5 rounded hover:bg-slate-200/50"
                    title="Umbenennen"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
              {isAi ? "KI-Spalte" : `Feld: ${columnKey}`}
            </div>
          </div>

          {/* AI Run Actions (if AI column) */}
          {isAi && (
            <div className="py-1 border-b border-slate-100 bg-orange-50/30">
              {onRunEmptyAi && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRunEmptyAi();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-orange-950 hover:bg-orange-100/70 cursor-pointer font-medium"
                >
                  <Play className="w-3 h-3 text-orange-600 fill-orange-600" />
                  <span>Nur leere Zeilen anreichern</span>
                </button>
              )}
              {onRunAllAi && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRunAllAi();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-orange-50 cursor-pointer"
                >
                  <RotateCw className="w-3 h-3 text-slate-400" />
                  <span>Alle Zeilen neu anreichern</span>
                </button>
              )}
              {onEditAi && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEditAi();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-orange-500" />
                  <span>KI-Konfiguration öffnen</span>
                </button>
              )}
            </div>
          )}

          {/* Sort Actions */}
          <div className="py-1 border-b border-slate-100">
            {onSort && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onSort("asc");
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 cursor-pointer ${
                    sortDirection === "asc" ? "text-orange-600 font-semibold bg-orange-50/50" : "text-slate-700"
                  }`}
                >
                  <ArrowUp className="w-3.5 h-3.5 text-slate-400" />
                  <span>Sortieren A → Z</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSort("desc");
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 cursor-pointer ${
                    sortDirection === "desc" ? "text-orange-600 font-semibold bg-orange-50/50" : "text-slate-700"
                  }`}
                >
                  <ArrowDown className="w-3.5 h-3.5 text-slate-400" />
                  <span>Sortieren Z → A</span>
                </button>
              </>
            )}

            {onFilterByColumn && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onFilterByColumn();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span>Nach dieser Spalte filtern</span>
              </button>
            )}
          </div>

          {/* Insert Left / Right */}
          {(onInsertLeft || onInsertRight) && (
            <div className="py-1 border-b border-slate-100">
              {onInsertLeft && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onInsertLeft();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                  <span>Spalte links einfügen</span>
                </button>
              )}
              {onInsertRight && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onInsertRight();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  <span>Spalte rechts einfügen</span>
                </button>
              )}
            </div>
          )}

          {/* Pin & Hide */}
          <div className="py-1 border-b border-slate-100">
            {onPinToggle && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPinToggle();
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 cursor-pointer ${
                  isPinned ? "text-orange-600 font-medium" : "text-slate-700"
                }`}
              >
                <Pin className="w-3.5 h-3.5 text-slate-400" />
                <span>{isPinned ? "Fixierung aufheben" : "Spalte links fixieren (Pin)"}</span>
              </button>
            )}
            {onHide && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onHide();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                <span>Spalte ausblenden</span>
              </button>
            )}
          </div>

          {/* Delete Action */}
          {onDelete && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 cursor-pointer font-medium"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                <span>Spalte löschen</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
