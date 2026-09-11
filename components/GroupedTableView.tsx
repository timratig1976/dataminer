"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, Loader2, Building2, User } from "lucide-react";
import type { GroupedRowsResponse, CompanyGroup } from "@/lib/types";

interface Props {
  caseId: string;
  /** Group key: which field to group by */
  groupKey?: string;
}

export default function GroupedTableView({ caseId, groupKey = "company_name" }: Props) {
  const [data, setData] = useState<GroupedRowsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [loading, setLoading] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rows/grouped?caseId=${caseId}&page=${p}&perPage=${perPage}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [caseId, perPage]);

  useEffect(() => { fetchPage(page); }, [fetchPage, page]);

  function toggleCompany(name: string) {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function expandAll() {
    if (!data) return;
    setExpandedCompanies(new Set(data.companies.map(c => c.companyName)));
  }

  function collapseAll() {
    setExpandedCompanies(new Set());
  }

  if (loading && !data) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, color: "#9ca3af" }}>
        <Loader2 style={{ width: 20, height: 20 }} className="animate-spin" />
        <span style={{ marginLeft: 8, fontSize: 13 }}>Gruppiere Daten…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: "#dc2626", fontSize: 13 }}>
        Fehler beim Laden: {error}
      </div>
    );
  }

  if (!data || data.companies.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
        Keine Daten zum Gruppieren. Bitte CSV importieren.
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.totalCompanies / perPage));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
        background: "#fff", borderBottom: "1px solid #e5e7eb", flexShrink: 0,
        fontSize: 12,
      }}>
        <span style={{ fontWeight: 600, color: "#374151" }}>
          {data.totalCompanies} Firmen · {data.companies.reduce((s, c) => s + 1 + c.contacts.length, 0)} Zeilen gesamt
        </span>
        <span style={{ color: "#d1d5db" }}>|</span>
        <button
          onClick={expandAll}
          style={{ border: "none", background: "none", cursor: "pointer", color: "#7c3aed", fontSize: 12, padding: "2px 6px" }}
        >
          Alle aufklappen
        </button>
        <button
          onClick={collapseAll}
          style={{ border: "none", background: "none", cursor: "pointer", color: "#6b7280", fontSize: 12, padding: "2px 6px" }}
        >
          Alle zuklappen
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", background: "#f9fafb", padding: 8 }}>
        {data.companies.map(group => (
          <CompanyRow
            key={group.companyName}
            group={group}
            expanded={expandedCompanies.has(group.companyName)}
            onToggle={() => toggleCompany(group.companyName)}
          />
        ))}
      </div>

      {/* Pagination */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "8px 16px", background: "#fff", borderTop: "1px solid #e5e7eb",
        flexShrink: 0, fontSize: 12,
      }}>
        <button
          disabled={page <= 1}
          onClick={() => setPage(p => Math.max(1, p - 1))}
          style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "3px 8px", background: page <= 1 ? "#f3f4f6" : "#fff", cursor: page <= 1 ? "not-allowed" : "pointer", color: page <= 1 ? "#d1d5db" : "#374151" }}
        >
          ‹ Zurück
        </button>
        <span style={{ color: "#6b7280" }}>
          Seite {data.page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage(p => p + 1)}
          style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "3px 8px", background: page >= totalPages ? "#f3f4f6" : "#fff", cursor: page >= totalPages ? "not-allowed" : "pointer", color: page >= totalPages ? "#d1d5db" : "#374151" }}
        >
          Weiter ›
        </button>
      </div>
    </div>
  );
}

// ── Single Company Row ────────────────────────────────────────────────────────

function CompanyRow({ group, expanded, onToggle }: {
  group: CompanyGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const companyData = group.companyRow.data;
  const contactCount = group.contacts.length;
  const columns = Object.keys(companyData).filter(k => !k.startsWith("_"));

  // Separate company vs contact keys visually: company cols first, contact cols second
  const companyCols = columns.filter(k =>
    ["company_name", "website", "phone_company", "phone", "city", "industry", "street", "address"].includes(k)
  );
  const contactCols = columns.filter(k => !companyCols.includes(k));

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Company header row */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
          background: expanded ? "#ede9fe" : "#fff",
          border: `1px solid ${expanded ? "#c4b5fd" : "#e5e7eb"}`,
          borderRadius: 8, cursor: "pointer",
          transition: "background .15s",
          boxShadow: expanded ? "0 1px 3px rgba(124,58,237,0.1)" : undefined,
        }}
      >
        {expanded
          ? <ChevronDown style={{ width: 16, height: 16, color: "#7c3aed", flexShrink: 0 }} />
          : <ChevronRight style={{ width: 16, height: 16, color: "#9ca3af", flexShrink: 0 }} />
        }
        <Building2 style={{ width: 14, height: 14, color: "#7c3aed", flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>
          {group.companyName || "(ohne Name)"}
        </span>
        {contactCount > 0 && (
          <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", padding: "1px 6px", borderRadius: 8 }}>
            {contactCount} {contactCount === 1 ? "Kontakt" : "Kontakte"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Quick info pills — company columns */}
        <div style={{ display: "flex", gap: 6, overflow: "hidden" }}>
          {companyCols.map(k => {
            const v = companyData[k];
            if (!v) return null;
            return (
              <span key={k} style={{
                fontSize: 11, color: "#374151", background: "#f3f4f6",
                padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap",
              }}>
                {String(v).length > 30 ? String(v).slice(0, 30) + "…" : v}
              </span>
            );
          })}
        </div>
      </div>

      {/* Contact sub-rows */}
      {expanded && contactCount > 0 && (
        <div style={{ marginLeft: 24, marginTop: 4, borderLeft: "2px solid #e5e7eb" }}>
          {group.contacts.map((contact, ci) => (
            <div
              key={contact.id}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 14px", background: "#fafafa",
                borderBottom: ci < contactCount - 1 ? "1px solid #f3f4f6" : undefined,
                marginBottom: ci === contactCount - 1 ? 4 : 0,
              }}
            >
              <User style={{ width: 12, height: 12, color: "#9ca3af", flexShrink: 0, marginLeft: 12 }} />
              <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>
                {[contact.data["first_name"], contact.data["last_name"]].filter(Boolean).join(" ") || "(unbenannt)"}
              </span>
              {contact.data["position"] && (
                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  · {contact.data["position"]}
                </span>
              )}
              {contact.data["email"] && (
                <span style={{ fontSize: 11, color: "#7c3aed", fontFamily: "monospace" }}>
                  {contact.data["email"]}
                </span>
              )}
              {contact.data["phone"] && (
                <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>
                  📞 {contact.data["phone"]}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}