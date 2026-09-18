"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, X, Loader2 } from "lucide-react";
import type { Case } from "@/lib/types";
import { isHiddenColumn, buildVisibleColOrder, getColumnLabel } from "@/lib/columns";

interface ExportModalProps {
  caseId: string;
  caseData: Case;
  sourceColumns: string[];
  colOrder: string[];
  onClose: () => void;
}

const CONTACT_CORE = [
  "company_name",
  "first_name",
  "last_name",
  "position",
  "email",
  "email_extrapolated",
  "phone",
  "linkedin",
  "domain",
  "city",
  "source",
];

export function ExportModal({ caseId, caseData, sourceColumns, colOrder, onClose }: ExportModalProps) {
  const [type, setType] = useState<"companies" | "contacts">("companies");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const companiesColumns = useMemo(() => {
    const allKeys = new Set([...sourceColumns, ...caseData.aiColumns.map((c) => c.outputKey)]);
    const base = colOrder.length > 0 ? colOrder : [...allKeys];
    const visible = buildVisibleColOrder(caseData, base as string[]);
    // append any visible keys not in order
    const visibleSet = new Set(visible);
    const rest = [...allKeys].filter((k) => !isHiddenColumn(k, caseData.aiColumns) && !visibleSet.has(k));
    return [...visible, ...rest];
  }, [caseData, sourceColumns, colOrder]);

  useEffect(() => {
    if (type === "companies") {
      setSelected(new Set(companiesColumns));
    } else {
      setSelected(new Set(CONTACT_CORE));
    }
  }, [type, companiesColumns]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    const all = type === "companies" ? companiesColumns : CONTACT_CORE;
    if (selected.size === all.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(all));
    }
  };

  const handleDownload = async () => {
    if (selected.size === 0) return;
    setLoading(true);
    const cols = [...selected].join(",");
    const url = `/api/export?caseId=${caseId}&type=${type}&cols=${encodeURIComponent(cols)}`;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const filename =
        type === "contacts"
          ? `${caseData.name.replace(/[^a-z0-9]/gi, "_")}_contacts.csv`
          : `${caseData.name.replace(/[^a-z0-9]/gi, "_")}.csv`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setLoading(false);
    }
  };

  const currentAvailable = type === "companies" ? companiesColumns : CONTACT_CORE;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 520,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111827" }}>
            📤 CSV Export
          </h2>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "#9ca3af",
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ padding: 20, overflow: "auto" }}>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
            Wähle, was exportiert werden soll. Bei Firmen siehst du genau die Spalten, die auch in der Tabelle sichtbar sind.
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 18,
              background: "#f3f4f6",
              padding: 4,
              borderRadius: 8,
            }}
          >
            {(["companies", "contacts"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  background: type === t ? "#fff" : "transparent",
                  color: type === t ? "#6d28d9" : "#6b7280",
                  boxShadow: type === t ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {t === "companies" ? "🏢 Firmen" : "👤 Kontakte"}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Spalten ({selected.size}/{currentAvailable.length})
            </span>
            <button
              onClick={toggleAll}
              style={{
                fontSize: 12,
                color: "#6d28d9",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {selected.size === currentAvailable.length ? "Keine" : "Alle"}
            </button>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              maxHeight: 240,
              overflow: "auto",
              padding: "8px 0",
            }}
          >
            {currentAvailable.map((key) => {
              const isAi = caseData.aiColumns.some((c) => c.outputKey === key);
              return (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "#374151",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggle(key)}
                    style={{ width: 16, height: 16, accentColor: "#6d28d9" }}
                  />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {type === "companies" ? getColumnLabel(key, caseData) : key}
                  </span>
                  {type === "companies" && isAi && (
                    <span
                      style={{
                        fontSize: 10,
                        background: "#eef2ff",
                        color: "#4338ca",
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontWeight: 600,
                      }}
                    >
                      AI
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: "8px 16px",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
            }}
          >
            Abbrechen
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || selected.size === 0}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 18px",
              border: "none",
              borderRadius: 8,
              background: "#6d28d9",
              color: "#fff",
              cursor: selected.size === 0 ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: selected.size === 0 ? 0.6 : 1,
            }}
          >
            {loading ? (
              <>
                <Loader2 style={{ width: 15, height: 15 }} className="animate-spin" /> Lädt…
              </>
            ) : (
              <>
                <Download style={{ width: 15, height: 15 }} /> Herunterladen
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
