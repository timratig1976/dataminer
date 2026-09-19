"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, Trash2, ChevronRight, Database, LayoutTemplate, Check, Download, Upload, Loader2 } from "lucide-react";
import type { Case } from "@/lib/types";
import type { ProjectTemplate } from "@/lib/templates";
import AppShell from "@/components/AppShell";

function CasesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>("standard");

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setCreating(true);
    }
  }, [searchParams]);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [runningRuns, setRunningRuns] = useState<Record<string, { count: number; unique: number; target: number }>>({});

  async function exportSnapshot(caseId: string, caseName: string, e: React.MouseEvent) {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = `/api/export/snapshot?caseId=${caseId}`;
    a.download = `${caseName.replace(/[^a-z0-9]/gi, "_")}_snapshot.json`;
    a.click();
  }

  async function handleImport(file: File) {
    setImporting(true);
    setImportError(null);
    try {
      const text = await file.text();
      const snap = JSON.parse(text);
      const res = await fetch("/api/import/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import fehlgeschlagen");
      router.push(`/cases/${data.caseId}`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setImporting(false);
    }
  }

  useEffect(() => {
    fetch("/api/cases")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(data)) {
          throw new Error((data && data.error) || `HTTP ${r.status}`);
        }
        setCases(data);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));

    // Poll for active agent runs across all cases
    const pollRuns = async () => {
      try {
        const res = await fetch("/api/agent/worker");
        const data = await res.json();
        const running: Array<{ id: string; caseId: string; uniqueCount: number; targetCount: number }> = data.running || [];
        const byCase: Record<string, { count: number; unique: number; target: number }> = {};
        for (const r of running) {
          if (!byCase[r.caseId]) {
            byCase[r.caseId] = { count: 0, unique: 0, target: 0 };
          }
          byCase[r.caseId].count++;
          byCase[r.caseId].unique += r.uniqueCount || 0;
          byCase[r.caseId].target += r.targetCount || 0;
        }
        setRunningRuns(byCase);
      } catch {
        // ignore
      }
    };
    pollRuns();
    const t = setInterval(pollRuns, 5000);
    return () => clearInterval(t);
  }, []);

  // Load templates when creating modal opens
  useEffect(() => {
    if (creating && templates.length === 0) {
      fetch("/api/templates")
        .then((r) => r.json())
        .then((data) => setTemplates(data))
        .catch(() => {}); // templates are optional
    }
  }, [creating, templates.length]);

  async function createCase() {
    if (!newName.trim()) return;
    const res = await fetch("/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        template: selectedTemplateId || "none",
      }),
    });
    const c = await res.json();
    router.push(`/cases/${c.id}`);
  }

  async function deleteCase(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this case and all its data?")) return;
    await fetch(`/api/cases/${id}`, { method: "DELETE" });
    setCases((prev) => prev.filter((c) => c.id !== id));
  }

  const filtered = cases.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <AppShell
      title="Alle Cases"
      titleIcon={<Database className="w-4 h-4" style={{ color: "var(--orange)" }} />}
      actions={
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cases suchen…"
              className="w-48 pl-8 pr-2.5 py-1 text-xs border rounded focus:outline-none transition-colors"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border)",
                color: "var(--text-1)",
              }}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="Case aus Snapshot-JSON importieren"
            className="btn-v2"
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {importing ? "Importiert…" : "Snapshot"}
          </button>
          <button
            onClick={() => setCreating(true)}
            className="btn-v2 btn-v2-primary"
          >
            <Plus className="w-3.5 h-3.5" />
            Neuer Case
          </button>
        </div>
      }
    >
      {/* Import error */}
      {importError && (
        <div className="mb-4 p-3 rounded-lg text-xs flex items-center justify-between" style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
          <span>❌ Import-Fehler: {importError}</span>
          <button onClick={() => setImportError(null)} className="cursor-pointer ml-3">×</button>
        </div>
      )}

      {/* Cases grid */}
      {loading ? (
        <div className="py-8 text-xs text-center" style={{ color: "var(--text-3)" }}>Lädt…</div>
      ) : loadError ? (
        <div className="py-8 text-xs text-center" style={{ color: "var(--danger)" }}>Fehler beim Laden: {loadError}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64" style={{ color: "var(--text-3)" }}>
          <div className="text-3xl mb-2">📂</div>
          <p className="text-xs">Noch keine Cases vorhanden.</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-3 btn-v2 btn-v2-primary"
          >
            Case erstellen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => router.push(`/cases/${c.id}`)}
              className="p-4 cursor-pointer transition-all group"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r)",
                boxShadow: "var(--shadow-sm)",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "var(--orange-mid)";
                e.currentTarget.style.boxShadow = "var(--shadow)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.boxShadow = "var(--shadow-sm)";
              }}
            >
              <div className="flex items-start justify-between mb-2.5">
                <div
                  className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
                  style={{ background: "var(--orange-soft)", color: "var(--orange)" }}
                >
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => exportSnapshot(c.id, c.name, e)}
                    title="Als Snapshot exportieren (JSON)"
                    className="p-1 rounded cursor-pointer"
                    style={{ color: "var(--text-3)" }}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => deleteCase(c.id, e)} className="p-1 rounded cursor-pointer" style={{ color: "var(--danger)" }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="font-semibold text-[13px] mb-1 truncate" style={{ color: "var(--text-1)" }}>{c.name}</div>
              <div className="text-[11px] mb-3" style={{ color: "var(--text-3)" }}>
                {c.aiColumns.length} KI-Spalten · {new Date(c.updatedAt).toLocaleDateString("de-DE")}
              </div>
              {runningRuns[c.id] ? (
                <div
                  className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded"
                  style={{ background: "var(--orange-soft)", color: "var(--orange)", border: "1px solid var(--orange-mid)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--orange)" }} />
                  🔄 {runningRuns[c.id].count} Suche{runningRuns[c.id].count === 1 ? "" : "n"} · {runningRuns[c.id].unique.toLocaleString("de-DE")}/{runningRuns[c.id].target.toLocaleString("de-DE")} Leads
                </div>
              ) : null}
              <div className="flex items-center text-xs font-medium" style={{ color: "var(--orange)" }}>
                Öffnen <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50" onClick={(e) => e.target === e.currentTarget && (() => { setCreating(false); setNewName(""); setSelectedTemplateId("standard"); })()}>
          <div
            className="p-5 w-full max-w-lg"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r)",
              boxShadow: "var(--shadow)",
            }}
          >
            <h3 className="text-sm font-semibold mb-3.5" style={{ color: "var(--text-1)" }}>Neuer Case</h3>
            <div className="space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>Name</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newName.trim() && createCase()}
                  placeholder="z.B. Hausbauunternehmen MV"
                  className="w-full border rounded px-3 py-1.5 text-xs focus:outline-none"
                  style={{
                    borderColor: newName.length > 0 && !newName.trim() ? "var(--danger)" : "var(--border)",
                    background: "var(--bg)",
                    color: "var(--text-1)",
                  }}
                />
                {newName.length > 0 && !newName.trim() && (
                  <p className="text-[10.5px] mt-1" style={{ color: "var(--danger)" }}>Name darf nicht nur aus Leerzeichen bestehen</p>
                )}
              </div>

              {/* Template picker */}
              {templates.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 flex items-center gap-1.5" style={{ color: "var(--text-3)" }}>
                    <LayoutTemplate className="w-3 h-3" />
                    Vorlage (optional)
                  </label>
                  <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {/* No template option */}
                    <button
                      onClick={() => setSelectedTemplateId(null)}
                      className="text-left p-2.5 rounded border text-xs transition-all cursor-pointer"
                      style={{
                        borderColor: !selectedTemplateId ? "var(--orange)" : "var(--border)",
                        background: !selectedTemplateId ? "var(--orange-soft)" : "var(--surface)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium" style={{ color: !selectedTemplateId ? "var(--orange)" : "var(--text-1)" }}>Leerer Case</span>
                        {!selectedTemplateId && <Check className="w-3.5 h-3.5" style={{ color: "var(--orange)" }} />}
                      </div>
                      <p className="text-[10.5px] mt-0.5" style={{ color: "var(--text-3)" }}>Spalten manuell hinzufügen</p>
                    </button>

                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => setSelectedTemplateId(tpl.id)}
                        className="text-left p-2.5 rounded border text-xs transition-all cursor-pointer"
                        style={{
                          borderColor: selectedTemplateId === tpl.id ? "var(--orange)" : "var(--border)",
                          background: selectedTemplateId === tpl.id ? "var(--orange-soft)" : "var(--surface)",
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium" style={{ color: selectedTemplateId === tpl.id ? "var(--orange)" : "var(--text-1)" }}>
                            <span className="mr-1.5">{tpl.icon}</span>
                            {tpl.name}
                          </span>
                          {selectedTemplateId === tpl.id && <Check className="w-3.5 h-3.5" style={{ color: "var(--orange)" }} />}
                        </div>
                        <p className="text-[10.5px] mt-0.5" style={{ color: "var(--text-3)" }}>{tpl.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={createCase} disabled={!newName.trim()} className="flex-1 btn-v2 btn-v2-primary justify-center py-2">
                {newName.trim() ? "Erstellen" : "Name eingeben…"}
              </button>
              <button onClick={() => { setCreating(false); setNewName(""); setSelectedTemplateId("standard"); }} className="flex-1 btn-v2 justify-center py-2">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function CasesPage() {
  return (
    <Suspense fallback={null}>
      <CasesView />
    </Suspense>
  );
}
