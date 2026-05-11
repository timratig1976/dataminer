"use client";

import { Play, Pencil, Trash2, ChevronDown, Sparkles } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { AiColumn } from "@/lib/types";

interface Props {
  column: AiColumn;
  onRunAll: () => void;
  onRunEmptyOnly: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

export function ColumnHeaderMenu({ column, onRunAll, onRunEmptyOnly, onDelete, onEdit }: Props) {
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
    <div ref={ref} className="relative">
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-violet-100 transition-colors group"
      >
        <Sparkles className="w-3 h-3 text-violet-500 shrink-0" />
        <span className="text-xs font-medium text-violet-700 flex-1 truncate">{column.name}</span>
        <ChevronDown className="w-3 h-3 text-violet-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 text-sm">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRunAll(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-gray-700"
          >
            <Play className="w-3.5 h-3.5 text-violet-500" />
            Run column (all forced)
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRunEmptyOnly(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-gray-700"
          >
            <Play className="w-3.5 h-3.5 text-violet-500" />
            Run only empty/notFound
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-gray-700"
          >
            <Pencil className="w-3.5 h-3.5 text-gray-400" />
            Edit prompt
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); if (confirm(`Delete column "${column.name}"?`)) { onDelete(); } setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-50 text-red-500"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete column
          </button>
        </div>
      )}
    </div>
  );
}
