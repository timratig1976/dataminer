"use client";

import React, { useState, useRef, useEffect } from "react";
import { Maximize2, Copy, Check, ExternalLink } from "lucide-react";

interface CellExpandProps {
  value: any;
  columnKey: string;
  isAi?: boolean;
  children: React.ReactNode;
}

export function CellExpand({ value, columnKey, isAi, children }: CellExpandProps) {
  const [showPopover, setShowPopover] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const valStr = value == null ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  const isLong = valStr.length > 35 || valStr.includes("\n");
  const isUrl = typeof valStr === "string" && (valStr.startsWith("http://") || valStr.startsWith("https://") || (columnKey === "domain" && valStr.includes(".")));

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
      }
    }
    if (showPopover) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPopover]);

  const copyToClipboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(valStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      ref={triggerRef}
      className="group/cell relative flex items-center justify-between w-full h-full min-w-0"
    >
      <div className="truncate flex-1 min-w-0 pr-1">{children}</div>

      {isLong && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowPopover((v) => !v);
          }}
          className="opacity-0 group-hover/cell:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-opacity shrink-0 cursor-pointer"
          title="Zelleninhalt vergrößern"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      )}

      {showPopover && (
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full mt-1.5 z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs w-[320px] max-w-[80vw] select-text animate-in fade-in"
          style={{
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.12), 0 8px 10px -6px rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-100">
            <span className="font-semibold text-slate-700 text-[11px] truncate">
              {columnKey}
            </span>
            <div className="flex items-center gap-1">
              {isUrl && (
                <a
                  href={valStr.startsWith("http") ? valStr : `https://${valStr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                  title="Link im neuen Tab öffnen"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button
                type="button"
                onClick={copyToClipboard}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                title="In Zwischenablage kopieren"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto text-slate-800 whitespace-pre-wrap break-words font-sans text-[11.5px] leading-relaxed bg-slate-50/60 p-2 rounded border border-slate-100">
            {valStr}
          </div>
        </div>
      )}
    </div>
  );
}
