"use client";

import { Play, Pencil, Trash2, ChevronDown, XCircle, Loader2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { AiColumn } from "@/lib/types";

interface Props {
  column: AiColumn;
  onRunAll: () => void;
  onRunEmptyOnly: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onStop?: () => void;
  isRunning?: boolean;
}

export function ColumnHeaderMenu({ column, onRunAll, onRunEmptyOnly, onDelete, onEdit, onStop, isRunning }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} className="relative flex items-center justify-between w-full">
      <div className="flex items-center gap-1.5 min-w-0 pr-1">
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: isRunning ? "var(--orange)" : "var(--green)" }}
        />
        <span
          className="text-[11.5px] font-semibold truncate"
          style={{ color: "var(--green)" }}
          title={column.name}
        >
          {column.name}
        </span>
      </div>

      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-4 h-4 rounded flex items-center justify-center cursor-pointer transition-colors opacity-60 hover:opacity-100 shrink-0"
        style={{
          color: "var(--green)",
          background: open ? "var(--green-mid)" : "transparent",
        }}
        title="Spalten-Optionen"
      >
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 min-w-[200px] rounded-md shadow-md z-50 py-1 text-xs"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow)",
          }}
        >
          {isRunning && onStop && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onStop(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors"
              style={{ color: "var(--danger)", background: "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--danger-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Spalte stoppen</span>
            </button>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors"
            style={{ color: "var(--text-1)", background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Pencil className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-3)" }} />
            <span>Prompt bearbeiten</span>
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRunEmptyOnly(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors"
            style={{ color: "var(--text-1)", background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Play className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--green)" }} />
            <span>Nur leere Zellen füllen</span>
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRunAll(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors"
            style={{ color: "var(--text-1)", background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Play className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--orange)" }} />
            <span>Alle ausführen (überschreiben)</span>
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Spalte "${column.name}" löschen?`)) { onDelete(); }
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors"
            style={{ color: "var(--danger)", background: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--danger-soft)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>Spalte löschen</span>
          </button>
        </div>
      )}
    </div>
  );
}
