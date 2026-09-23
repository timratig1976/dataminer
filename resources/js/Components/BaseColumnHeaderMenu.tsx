import React, { useState, useRef, useEffect } from "react";
import { MoreVertical, Trash2, ArrowUpDown, ShieldAlert, CheckCircle2 } from "lucide-react";

interface Props {
  columnKey: string;
  label: string;
  rowsCount: number;
  filledCount: number;
  isReferencedInPrompts: boolean;
  isSystemCore: boolean;
  onDelete: () => void;
  onSort?: () => void;
}

export function BaseColumnHeaderMenu({
  columnKey,
  label,
  rowsCount,
  filledCount,
  isReferencedInPrompts,
  isSystemCore,
  onDelete,
  onSort
}: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative inline-flex items-center" ref={menuRef}>
      <button
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          setOpen(prev => !prev);
        }}
        className="p-1 rounded hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
        title="Spalten-Optionen"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-lg shadow-xl border z-50 text-xs py-1 animate-in fade-in"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header info */}
          <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border-xs)" }}>
            <div className="font-semibold text-slate-800 truncate">{label}</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">Key: {columnKey}</div>
            <div className="text-[10.5px] text-slate-500 mt-1 flex items-center gap-1.5">
              <span>{filledCount} / {rowsCount} Zeilen befüllt</span>
              {filledCount === 0 ? (
                <span className="text-amber-600 bg-amber-50 px-1 rounded font-medium text-[9.5px]">Leer</span>
              ) : (
                <span className="text-emerald-600 bg-emerald-50 px-1 rounded font-medium text-[9.5px]">Aktiv</span>
              )}
            </div>
          </div>

          {/* Sort option if available */}
          {onSort && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                onSort();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <span>Nach dieser Spalte sortieren</span>
            </button>
          )}

          {/* Flow importance warning */}
          <div className="px-3 py-1.5 text-[10.5px] border-t border-b bg-slate-50" style={{ borderColor: "var(--border-xs)" }}>
            {isSystemCore ? (
              <div className="text-amber-700 flex items-start gap-1">
                <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5 text-amber-600" />
                <span>Kernfeld (Standard-Mapping). Löschen nur empfohlen wenn Duplikat.</span>
              </div>
            ) : isReferencedInPrompts ? (
              <div className="text-blue-700 flex items-start gap-1">
                <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5 text-blue-600" />
                <span>Wird in KI-Prompts mit <code>{`{${columnKey}}`}</code> verwendet!</span>
              </div>
            ) : filledCount === 0 ? (
              <div className="text-slate-500 flex items-start gap-1">
                <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-emerald-600" />
                <span>Spalte ist komplett leer (0 Werte). Kann gefahrlos gelöscht werden.</span>
              </div>
            ) : (
              <div className="text-slate-500">
                Löscht diese Daten aus allen {filledCount} befüllten Zeilen.
              </div>
            )}
          </div>

          {/* Delete action */}
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-rose-600 hover:bg-rose-50 cursor-pointer font-medium"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>Spalte löschen</span>
          </button>
        </div>
      )}
    </div>
  );
}
