"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Loader2, Building2, User } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

  // Reset expanded state when case changes
  useEffect(() => { setExpandedCompanies(new Set()); }, [caseId]);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rows/grouped?caseId=${caseId}&page=${p}&perPage=${perPage}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      // Reset to collapsed when page changes
      if (p !== page) setExpandedCompanies(new Set());
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
    setExpandedCompanies(new Set(data.companies.map(c => c.companyRow.id)));
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

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: data.companies.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56, // Base height for a collapsed company row
    overscan: 5,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "9px 24px",
        background: "var(--surface)", borderBottom: "1px solid var(--border)", flexShrink: 0,
        fontSize: 12,
      }}>
        <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
          {data.totalCompanies} Firmen · {data.companies.reduce((s, c) => s + 1 + c.contacts.length, 0)} Zeilen gesamt
        </span>
        <span style={{ color: "var(--border)" }}>|</span>
        <button
          onClick={expandAll}
          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--orange)", fontSize: 12, padding: "2px 6px", fontWeight: 500 }}
        >
          Alle aufklappen
        </button>
        <button
          onClick={collapseAll}
          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 12, padding: "2px 6px" }}
        >
          Alle zuklappen
        </button>
      </div>

      {/* Virtualized Table Container */}
      <div ref={parentRef} style={{ flex: 1, overflowY: "auto", overflowX: "auto", background: "var(--bg)", padding: 16 }}>
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const group = data.companies[virtualRow.index];
            return (
              <div
                key={group.companyRow.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <CompanyRow
                  group={group}
                  caseId={caseId}
                  expanded={expandedCompanies.has(group.companyRow.id)}
                  onToggle={() => toggleCompany(group.companyRow.id)}
                  onRefresh={() => fetchPage(page)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Pagination */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "8px 16px", background: "var(--surface)", borderTop: "1px solid var(--border)",
        flexShrink: 0, fontSize: 12,
      }}>
        <button
          disabled={page <= 1}
          onClick={() => setPage(p => Math.max(1, p - 1))}
          style={{ border: "1px solid var(--border)", borderRadius: "var(--rs)", padding: "3px 8px", background: page <= 1 ? "var(--bg)" : "var(--surface)", cursor: page <= 1 ? "not-allowed" : "pointer", color: page <= 1 ? "var(--text-3)" : "var(--text-1)" }}
        >
          ‹ Zurück
        </button>
        <span style={{ color: "var(--text-2)" }}>
          Seite {data.page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage(p => p + 1)}
          style={{ border: "1px solid var(--border)", borderRadius: "var(--rs)", padding: "3px 8px", background: page >= totalPages ? "var(--bg)" : "var(--surface)", cursor: page >= totalPages ? "not-allowed" : "pointer", color: page >= totalPages ? "var(--text-3)" : "var(--text-1)" }}
        >
          Weiter ›
        </button>
      </div>
    </div>
  );
}

// ── Extrapolated Email Badge with SMTP Verify Button ────────────────────────

function ExtrapolatedEmailBadge({ email, confidence, caseId, rowId }: {
  email: string;
  confidence: string;
  caseId: string;
  rowId: string;
}) {
  const [status, setStatus] = useState<"idle" | "checking" | "exists" | "notfound" | "catchall" | "unknown">("idle");

  const pct = confidence === "high" ? "~60%" : confidence === "medium" ? "~30%" : "~10%";
  const statusColor = status === "exists" ? "#15803d" : status === "notfound" ? "#dc2626" : status === "catchall" ? "#d97706" : "#9333ea";
  const statusBg = status === "exists" ? "#dcfce7" : status === "notfound" ? "#fee2e2" : status === "catchall" ? "#fef3c7" : "#f3e8ff";
  const statusIcon = status === "exists" ? "✅" : status === "notfound" ? "❌" : status === "catchall" ? "⚠️" : status === "checking" ? "⏳" : "⚡";
  const tooltip = status === "exists" ? "SMTP bestätigt: Email existiert" :
    status === "notfound" ? "SMTP: Email existiert nicht" :
    status === "catchall" ? "Catch-All Server — kann nicht verifiziert werden" :
    status === "unknown" ? "SMTP Timeout / Server blockt Check" :
    `Geschätzte Email (${confidence} confidence, ${pct} Wahrscheinlichkeit) — klicken zum SMTP-Verify`;

  async function verify() {
    if (status === "checking") return;
    setStatus("checking");
    try {
      const res = await fetch(`/api/cases/${caseId}/extrapolate-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, verify: true }),
      });
      const d = await res.json();
      const vr = d.verifyResults?.[0];
      if (!vr) { setStatus("unknown"); return; }
      if (d.confidence === "high" && vr.exists === true) setStatus("exists");
      else if (vr.exists === false) setStatus("notfound");
      else if (d.note?.includes("Catch-all") || d.note?.includes("catch")) setStatus("catchall");
      else setStatus("unknown");
    } catch { setStatus("unknown"); }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontFamily: "monospace" }}
      onClick={e => e.stopPropagation()}
    >
      {/* Email text */}
      <span style={{
        color: statusColor, background: statusBg,
        padding: "1px 6px", borderRadius: 4,
        border: `1px solid ${status === "exists" ? "#bbf7d0" : status === "notfound" ? "#fecaca" : status === "catchall" ? "#fde68a" : "#e9d5ff"}`,
        display: "inline-flex", alignItems: "center", gap: 3,
      }}>
        <span>{statusIcon}</span>
        {email}
      </span>
      {/* Verify button — only shown before verification */}
      {status === "idle" && (
        <button
          onClick={verify}
          title={`SMTP-Verify: Prüfen ob ${email} existiert`}
          style={{
            fontSize: 10, fontFamily: "sans-serif", fontWeight: 600,
            padding: "1px 7px", borderRadius: 4, border: "1px solid #c4b5fd",
            background: "#f5f3ff", color: "#7c3aed", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 3,
          }}>
          ✓ Verify
        </button>
      )}
      {status === "checking" && (
        <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "sans-serif" }}>checking…</span>
      )}
      {status !== "idle" && status !== "checking" && (
        <span style={{
          fontSize: 9, fontFamily: "sans-serif", color: statusColor,
          background: statusBg, padding: "1px 5px", borderRadius: 3,
        }}>
          {status === "exists" ? "confirmed" : status === "notfound" ? "not found" : status === "catchall" ? "catch-all" : "timeout"}
        </span>
      )}
    </span>
  );
}

// ── Single Company Row ────────────────────────────────────────────────────────

function CompanyRow({ group, expanded, onToggle, caseId, onRefresh }: {
  group: CompanyGroup;
  expanded: boolean;
  onToggle: () => void;
  caseId: string;
  onRefresh?: () => void;
}) {
  const companyData = group.companyRow.data;
  const contactCount = group.contacts.length;
  const columns = Object.keys(companyData).filter(k => !k.startsWith("_"));

  // Check if this company has inline contact data (batch_contacts result)
  const d = companyData as Record<string, string>;
  const hasInlineContacts = !!(
    d["first_name"] || d["last_name"] ||
    Object.keys(d).find(k => k.startsWith("_contacts_json_") && d[k])
  );
  const hasAnyContacts = contactCount > 0 || hasInlineContacts;

  // Separate company vs contact keys visually: company cols first, contact cols second
  const companyCols = columns.filter(k =>
    ["company_name", "website", "phone_company", "phone", "city", "industry", "street", "address"].includes(k)
  );
  const contactCols = columns.filter(k => !companyCols.includes(k));

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Company header row */}
      <div
        onClick={hasAnyContacts ? onToggle : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
          background: companyData["is_catalog"] === "true"
            ? (expanded ? "#fffbeb" : "#fefce8")
            : (expanded ? "var(--orange-soft)" : "var(--surface)"),
          border: `1px solid ${companyData["is_catalog"] === "true" ? "#fde68a" : expanded ? "var(--orange-mid)" : "var(--border)"}`,
          borderRadius: "var(--r)", cursor: hasAnyContacts ? "pointer" : "default",
          transition: "background .15s",
          boxShadow: expanded ? "var(--shadow-sm)" : undefined,
        }}
      >
        {hasAnyContacts
          ? (expanded
              ? <ChevronDown style={{ width: 16, height: 16, color: "var(--orange)", flexShrink: 0 }} />
              : <ChevronRight style={{ width: 16, height: 16, color: "var(--text-3)", flexShrink: 0 }} />)
          : <span style={{ width: 16, flexShrink: 0 }} />
        }
        <Building2 style={{ width: 14, height: 14, color: "var(--orange)", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text-1)" }}>
          {group.companyName || "(ohne Name)"}
        </span>
        {/* Catalog badge */}
        {companyData["is_catalog"] === "true" && (
          <span style={{ fontSize: 10, color: "var(--warn)", background: "var(--warn-soft)", border: "1px solid var(--warn)", padding: "1px 6px", borderRadius: 6, fontWeight: 600, flexShrink: 0 }}>
            📋 Katalog
          </span>
        )}
        {hasAnyContacts && !expanded && (
          <span style={{ fontSize: 11, color: "var(--text-2)", background: "var(--bg)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: "var(--rs)" }}>
            {contactCount > 0 ? `${contactCount} ${contactCount === 1 ? "Kontakt" : "Kontakte"}` : "Kontakt"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* Flag as catalog button */}
        <button
          onClick={async (e) => {
            e.stopPropagation();
            await fetch(`/api/cases/${caseId}/flag-catalog`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rowId: group.companyRow.id, flag: true }),
            });
            onRefresh?.();
          }}
          title="Als Katalogseite markieren \u2014 Domain wird gelernt & in Quellen-Tab verschoben"
          style={{
            border: "1px solid #fde68a", background: "#fffbeb", cursor: "pointer",
            padding: "2px 8px", fontSize: 10, color: "#92400e", borderRadius: 5,
            flexShrink: 0,
          }}
        >
          📚 Katalog
        </button>
        {/* Quick info pills — company columns + domain link */}
        <div style={{ display: "flex", gap: 6, overflow: "hidden", alignItems: "center" }}>
          {/* Domain as clickable link */}
          {(companyData["domain"] || companyData["source_domain"] || companyData["website"]) && (() => {
            const rawDomain = companyData["domain"] || companyData["source_domain"] || companyData["website"] || "";
            const href = rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain}`;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ fontSize: 11, color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap", textDecoration: "none", flexShrink: 0 }}>
                🌐 {rawDomain.replace(/^https?:\/\//, "").replace(/^www\./, "").slice(0, 25)}
              </a>
            );
          })()}
          {companyCols.filter(k => !["website"].includes(k)).map(k => {
            const v = companyData[k];
            if (!v) return null;
            return (
              <span key={k} style={{
                fontSize: 11, color: "#374151", background: "#f3f4f6",
                padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap",
              }}>
                {String(v).length > 25 ? String(v).slice(0, 25) + "…" : v}
              </span>
            );
          })}
        </div>
      </div>

      {/* Contact sub-rows — from separate contact rows OR from inline contact fields on company row */}
      {(() => {
        // Option A: separate contact sub-rows (legacy)
        if (contactCount > 0 && expanded) {
          return (
            <div style={{ marginLeft: 24, marginTop: 4, borderLeft: "2px solid #e5e7eb" }}>
              {group.contacts.map((contact, ci) => (
                <div key={contact.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", background: "#fafafa", borderBottom: ci < contactCount - 1 ? "1px solid #f3f4f6" : undefined }}>
                  <User style={{ width: 12, height: 12, color: "#9ca3af", flexShrink: 0, marginLeft: 12 }} />
                  <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>
                    {[contact.data["first_name"], contact.data["last_name"]].filter(Boolean).join(" ") || "(unbenannt)"}
                  </span>
                  {contact.data["position"] && <span style={{ fontSize: 11, color: "#6b7280" }}>· {contact.data["position"]}</span>}
                  {contact.data["email"] && <span style={{ fontSize: 11, color: "#7c3aed", fontFamily: "monospace" }}>{contact.data["email"]}</span>}
                  {contact.data["phone"] && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: "auto" }}>📞 {contact.data["phone"]}</span>}
                </div>
              ))}
            </div>
          );
        }

        // Option B: inline contact fields on the company row (batch_contacts result)
        // Build contact cards from _contacts_json_* or from first_name/last_name fields
        const d = companyData as Record<string, string>;
        const contactsJsonKey = Object.keys(d).find(k => k.startsWith("_contacts_json_"));
        let inlineContacts: Array<{name: string; position: string; email: string; phone: string; linkedin: string; extrapolated: string}> = [];

        if (contactsJsonKey && d[contactsJsonKey]) {
          try {
            const parsed = JSON.parse(d[contactsJsonKey]);
            if (Array.isArray(parsed)) {
              inlineContacts = parsed.map((c: Record<string, string | null>, i: number) => ({
                name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "",
                position: c.position ?? "",
                email: c.email ?? "",
                phone: c.phone ?? "",
                linkedin: c.linkedin ?? "",
                extrapolated: d[`contact_${i+1}_email_extrapolated`] ?? "",
              })).filter(c => c.name || c.email || c.extrapolated);
            }
          } catch { /* ignore */ }
        } else if (d["first_name"] || d["last_name"]) {
          // Single contact from flat fields
          inlineContacts = [{
            name: [d["first_name"], d["last_name"]].filter(Boolean).join(" "),
            position: d["position"] ?? "",
            email: d["contact_email"] ?? d["email"] ?? "",
            phone: d["contact_phone"] ?? d["phone"] ?? "",
            linkedin: d["linkedin"] ?? "",
            extrapolated: d["email_extrapolated"] ?? "",
          }];
        }

        if (inlineContacts.length === 0) return null;

        // Only show when expanded
        if (!expanded) return null;

        return (
          <div style={{ marginLeft: 24, marginTop: 4, borderLeft: "2px solid #e5e7eb" }}>
            {inlineContacts.map((c, ci) => (
              <div key={ci} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 14px", background: "#fafafa", borderBottom: ci < inlineContacts.length - 1 ? "1px solid #f3f4f6" : undefined }}>
                <User style={{ width: 13, height: 13, color: "#9ca3af", flexShrink: 0, marginLeft: 12, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>{c.name || "(unbenannt)"}</span>
                    {c.position && <span style={{ fontSize: 11, color: "#6b7280" }}>· {c.position}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2, alignItems: "center" }}>
                    {c.email
                      ? <a href={`mailto:${c.email}`} style={{ fontSize: 11, color: "#2563eb", fontFamily: "monospace", textDecoration: "none" }}>{c.email}</a>
                      : c.extrapolated
                      ? <span style={{ fontSize: 11, color: "#a855f7", fontFamily: "monospace" }} title="Extrapoliert — nicht SMTP-verifiziert">⚡ {c.extrapolated}</span>
                      : null}
                    {c.phone && <span style={{ fontSize: 11, color: "#6b7280" }}>📞 {c.phone}</span>}
                    {c.linkedin && (
                      <a href={c.linkedin} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10, color: "#0a66c2", textDecoration: "none" }}>
                        💼 LinkedIn
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {/* Generic company email */}
            {(d["company_email"] || d["email_fallback"]) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "#f8fafc", borderTop: "1px solid #f3f4f6" }}>
                <span style={{ width: 13, marginLeft: 12, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "#9ca3af" }}>🏢 Firma:</span>
                <a href={`mailto:${d["company_email"] || d["email_fallback"]}`}
                  style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace", textDecoration: "none" }}>
                  {d["company_email"] || d["email_fallback"]}
                </a>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}