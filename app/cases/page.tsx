"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, ChevronRight, Database, LayoutTemplate, Check, Download, Upload, Loader2 } from "lucide-react";
import type { Case } from "@/lib/types";
import type { ProjectTemplate } from "@/lib/templates";
import AppShell from "@/components/AppShell";

export default function CasesPage() {
  const router = useRouter();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>("standard");

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
      titleIcon={<Database className="w-4 h-4 text-violet-500" />}
      actions={
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cases suchen…"
              className="w-56 pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          {/* Hidden file input for snapshot import */}
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
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {importing ? "Importiert…" : "Snapshot importieren"}
          </button>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-violet-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Neuer Case
          </button>
        </div>
      }
    >
      {/* Import error */}
      {importError && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>❌ Import-Fehler: {importError}</span>
          <button onClick={() => setImportError(null)} className="text-red-400 hover:text-red-600 ml-3">×</button>
        </div>
      )}

      {/* Cases grid */}
      {loading ? (
        <div className="px-4 py-3 text-xs text-gray-400">Lädt…</div>
      ) : loadError ? (
        <div className="px-4 py-3 text-xs text-red-500">Fehler beim Laden: {loadError}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <div className="text-4xl mb-3">📂</div>
          <p className="text-sm">Noch keine Cases. Erstelle deinen ersten.</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700"
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
              className="bg-white border border-gray-200 rounded-xl p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center text-violet-600 text-sm font-bold">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => exportSnapshot(c.id, c.name, e)}
                    title="Als Snapshot exportieren (JSON)"
                    className="p-1 text-gray-400 hover:text-blue-500"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => deleteCase(c.id, e)} className="p-1 text-gray-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="font-medium text-gray-900 text-sm mb-1">{c.name}</div>
              <div className="text-xs text-gray-400 mb-4">
                {c.aiColumns.length} AI-Spalten · {new Date(c.updatedAt).toLocaleDateString("de-DE")}
              </div>
              {runningRuns[c.id] ? (
                <div className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 px-2 py-1 rounded-lg">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  🔄 {runningRuns[c.id].count} Suche{runningRuns[c.id].count === 1 ? "" : "n"} · {runningRuns[c.id].unique.toLocaleString("de-DE")}/{runningRuns[c.id].target.toLocaleString("de-DE")} Leads
                </div>
              ) : null}
              <div className="flex items-center text-xs text-violet-600 font-medium">
                Öffnen <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={(e) => e.target === e.currentTarget && (() => { setCreating(false); setNewName(""); setSelectedTemplateId("standard"); })()}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Neuer Case</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Name</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newName.trim() && createCase()}
                  placeholder="z.B. Heizung Firmen Q1"
                  className={`mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${newName.length > 0 && !newName.trim() ? "border-red-400 bg-red-50" : "border-gray-300"}`}
                />
                {newName.length > 0 && !newName.trim() && (
                  <p className="text-xs text-red-500 mt-1">Name darf nicht nur aus Leerzeichen bestehen</p>
                )}
              </div>

              {/* Template picker */}
              {templates.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide flex items-center gap-1.5">
                    <LayoutTemplate className="w-3 h-3" />
                    Vorlage (optional)
                  </label>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {/* No template option */}
                    <button
                      onClick={() => setSelectedTemplateId(null)}
                      className={`text-left p-3 rounded-lg border text-sm transition-all ${
                        !selectedTemplateId
                          ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-700">Leerer Case</span>
                        {!selectedTemplateId && <Check className="w-4 h-4 text-violet-600" />}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">Spalten manuell hinzufügen</p>
                    </button>

                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => setSelectedTemplateId(tpl.id)}
                        className={`text-left p-3 rounded-lg border text-sm transition-all ${
                          selectedTemplateId === tpl.id
                            ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-700">
                            <span className="mr-1.5">{tpl.icon}</span>
                            {tpl.name}
                          </span>
                          {selectedTemplateId === tpl.id && <Check className="w-4 h-4 text-violet-600" />}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{tpl.description}</p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {tpl.aiColumns.map((col) => (
                            <span key={col.id} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              {col.name}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={createCase} disabled={!newName.trim()} className="flex-1 bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {newName.trim() ? "Erstellen" : "Name eingeben…"}
              </button>
              <button onClick={() => { setCreating(false); setNewName(""); setSelectedTemplateId("standard"); }} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
