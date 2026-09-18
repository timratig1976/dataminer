"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { Case } from "@/lib/types";
import { isHiddenColumn, buildVisibleColOrder, getColumnLabel } from "@/lib/columns";
import { Modal, SegmentedTabs } from "@/components/ui/ModalMaster";

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
    <Modal
      onClose={onClose}
      title="CSV Export"
      icon="📤"
      maxWidth={520}
      footer={
        <>
          <button
            onClick={onClose}
            disabled={loading}
            className="btn-v2"
            style={{ padding: "7px 14px" }}
          >
            Abbrechen
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || selected.size === 0}
            className="btn-v2 btn-v2-primary"
            style={{ padding: "7px 18px" }}
          >
            {loading ? (
              <>
                <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> Lädt…
              </>
            ) : (
              <>
                <Download style={{ width: 14, height: 14 }} /> Herunterladen
              </>
            )}
          </button>
        </>
      }
    >
      <div style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 14, lineHeight: 1.4 }}>
          Wähle, was exportiert werden soll. Bei Firmen siehst du genau die Spalten, die auch in der Tabelle sichtbar sind.
        </div>

        <SegmentedTabs
          tabs={[
            { id: "companies", label: "Firmen", icon: "🏢" },
            { id: "contacts", label: "Kontakte", icon: "👤" },
          ]}
          activeTab={type}
          onChange={(t) => setType(t as "companies" | "contacts")}
          style={{ marginBottom: 16 }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-1)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Spalten ({selected.size}/{currentAvailable.length})
          </span>
          <button
            type="button"
            onClick={toggleAll}
            style={{
              fontSize: 12,
              color: "var(--orange)",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {selected.size === currentAvailable.length ? "Keine auswählen" : "Alle auswählen"}
          </button>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            maxHeight: 250,
            overflow: "auto",
            padding: "4px 0",
            background: "var(--bg)",
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
                  fontSize: 12.5,
                  color: "var(--text-1)",
                  borderBottom: "1px solid var(--border-xs)",
                  transition: "background 0.1s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggle(key)}
                  style={{ width: 15, height: 15, accentColor: "var(--orange)" }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: isAi ? "monospace" : "inherit" }}>
                  {type === "companies" ? getColumnLabel(key, caseData) : key}
                </span>
                {type === "companies" && isAi && (
                  <span
                    style={{
                      fontSize: 10,
                      background: "var(--green-soft)",
                      color: "var(--green)",
                      border: "1px solid var(--green-mid)",
                      padding: "1px 6px",
                      borderRadius: "var(--rs)",
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
    </Modal>
  );
}
