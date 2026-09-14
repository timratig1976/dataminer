"use client";

import { useEffect, useState, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Key, Loader2, Trash2, Sparkles, GripVertical, Globe } from "lucide-react";
import type { Case, AiColumn } from "@/lib/types";
import { randomUUID } from "@/lib/utils";

interface ModelGroup {
  provider: string;
  models: string[];
}

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = use(params);
  const router = useRouter();
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [name, setName] = useState("");
  const [edenApiKey, setEdenApiKey] = useState("");
  const [edenApiKeyMasked, setEdenApiKeyMasked] = useState<string | undefined>(undefined);
  const [edenRegion, setEdenRegion] = useState<"eu" | "us">("eu");
  const [saving, setSaving] = useState(false);
  const [editingCol, setEditingCol] = useState<AiColumn | null>(null);

  // ── Eden AI model curation ──
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [edenError, setEdenError] = useState<string | undefined>(undefined);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    region: string;
    checks: Record<string, Record<string, unknown>>;
    error?: string;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/cases/${caseId}`)
      .then((r) => r.json())
      .then((c) => {
        setCaseData(c);
        setName(c.name);
        setEdenApiKey("");
        setEdenApiKeyMasked(c.edenApiKeyMasked);
        setEdenRegion(c.edenRegion ?? "eu");
      });
  }, [caseId]);

  const fetchModels = useCallback(async (region: "eu" | "us") => {
    setModelsLoading(true);
    setEdenError(undefined);
    try {
      const res = await fetch(`/api/llm/models?caseId=${caseId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      const all: string[] = Array.isArray(data?.allModels) ? data.allModels : [];
      const enabled: string[] = Array.isArray(data?.models) ? data.models : [];
      setModelOptions(enabled.length ? enabled : all);

      // Group by provider (Eden models are "provider/model"; direct keys have no slash)
      const groups: Record<string, string[]> = {};
      for (const m of all) {
        const prov = m.includes("/") ? m.split("/")[0] : "direct";
        (groups[prov] ??= []).push(m);
      }
      const g: ModelGroup[] = Object.entries(groups)
        .map(([provider, models]) => ({ provider, models: [...models].sort() }))
        .sort((a, b) => (a.provider === "direct" ? 1 : b.provider === "direct" ? -1 : a.provider.localeCompare(b.provider)));
      setModelGroups(g);

      // Seed selection: existing allowlist if present, else everything
      const allowlist: string[] = Array.isArray(caseData?.modelAllowlist) ? caseData.modelAllowlist : [];
      setSelectedModels(new Set(allowlist.length ? allowlist : all));
      setEdenError(typeof data?.providerErrors?.edenai === "string" ? data.providerErrors.edenai : undefined);
    } catch (e) {
      setEdenError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelsLoading(false);
    }
  }, [caseId, caseData?.modelAllowlist]);

  // Load models once the case is available
  useEffect(() => {
    if (caseData) fetchModels(edenRegion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseData]);

  function toggleModel(m: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  function toggleGroup(provider: string, models: string[]) {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      const allSelected = models.every((m) => next.has(m));
      if (allSelected) models.forEach((m) => next.delete(m));
      else models.forEach((m) => next.add(m));
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        edenApiKey: edenApiKey.trim() || undefined,
        edenRegion,
      }),
    });
    const updated = await res.json();
    setCaseData(updated);
    setEdenApiKey("");
    setEdenApiKeyMasked(updated.edenApiKeyMasked);
    setSaving(false);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/llm/eden-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          apiKey: edenApiKey.trim() || undefined,
          region: edenRegion,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, region: edenRegion, checks: {}, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function saveColumns(cols: AiColumn[]) {
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiColumns: cols }),
    });
    const updated = await res.json();
    setCaseData(updated);
    return updated;
  }

  async function saveColEdit() {
    if (!editingCol || !caseData) return;
    const cols = caseData.aiColumns.map((c) => (c.id === editingCol.id ? editingCol : c));
    await saveColumns(cols);
    setEditingCol(null);
  }

  if (!caseData) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-5 h-5 animate-spin text-violet-500" /></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push(`/cases/${caseId}`)} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-700">{caseData.name}</span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-500">Settings</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Case settings */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">General</h2>
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Case Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>

        {/* Eden AI */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-500" />
            <h2 className="font-semibold text-gray-900">Eden AI</h2>
            <span className="text-xs text-gray-400">LLM gateway + Firecrawl web search</span>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
              <Key className="w-3 h-3" /> Eden AI API Key
            </label>
            <input
              type="password"
              value={edenApiKey}
              onChange={(e) => setEdenApiKey(e.target.value)}
              placeholder={edenApiKeyMasked ? `Gespeichert: ${edenApiKeyMasked}` : "sk-eden-live-..."}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-gray-400 mt-1">Wird serverseitig verschlüsselt gespeichert. Fallback: EDEN_API_KEY via Infisical.</p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Region / Data Residency</label>
            <div className="mt-1 flex gap-2">
              {(["eu", "us"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => { setEdenRegion(r); fetchModels(r); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    edenRegion === r
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {r === "eu" ? "EU (api.eu.edenai.run)" : "US (api.edenai.run)"}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              EU = data residency, filtered to EU-eligible providers (Mistral, Google, AWS…). US = full catalog incl. OpenAI.
              <span className="text-amber-600"> Firecrawl web search/scrape ist nur auf dem US-Endpoint verfügbar.</span>
            </p>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              onClick={runTest}
              disabled={testing || (!edenApiKey.trim() && !edenApiKeyMasked)}
              className="flex items-center gap-2 border border-violet-300 text-violet-700 bg-violet-50 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-violet-100 disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {testing ? "Teste…" : "Verbindung testen"}
            </button>
            <span className="text-xs text-gray-400">Prüft API-Key, Modellkatalog, Chat & Firecrawl.</span>
          </div>

          {testResult && (
            <div className={`rounded-lg border p-3 text-xs space-y-2 ${testResult.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <div className={`font-semibold ${testResult.ok ? "text-green-700" : "text-red-700"}`}>
                {testResult.ok ? "✓ Verbindung erfolgreich" : "✗ Verbindung fehlgeschlagen"}
                <span className="font-normal text-gray-500"> ({testResult.region.toUpperCase()})</span>
              </div>
              {testResult.error && <div className="text-red-700">{testResult.error}</div>}
              {Object.entries(testResult.checks).map(([name, c]) => (
                <div key={name} className="flex items-start gap-2">
                  <span className={c.ok ? "text-green-600" : "text-red-600"}>{c.ok ? "✓" : "✗"}</span>
                  <span className="text-gray-700">
                    {name === "catalog" && <><b>Katalog:</b> {c.ok ? `${c.count} Modelle` : c.error}</>}
                    {name === "chat" && <><b>{`Chat${c.model ? ` (${c.model})` : ""}`}</b>: {c.ok ? `${c.preview || "ok"} · ${c.latencyMs}ms${c.costUsd ? ` · $${Number(c.costUsd).toFixed(6)}` : ""}` : c.error}</>}
                    {name === "firecrawl" && <><b>Firecrawl:</b> {c.ok ? `${c.resultCount} Treffer · ${c.latencyMs}ms` : c.error}</>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Model curation → global settings */}
          <div className="border border-violet-200 bg-violet-50 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="text-lg">🎛</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-violet-900">Modell-Auswahl</div>
              <div className="text-xs text-violet-600 mt-0.5">
                Welche KI-Modelle in allen Cases verfügbar sind, wird in den <strong>globalen Einstellungen</strong> konfiguriert.
              </div>
            </div>
            <a
              href="/settings/models"
              className="shrink-0 text-xs font-medium text-violet-700 border border-violet-300 bg-white px-3 py-1.5 rounded-lg hover:bg-violet-100 transition-colors"
            >
              Zu Einstellungen →
            </a>
          </div>
        </div>

        {/* AI Columns */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">AI Columns</h2>
            <span className="text-xs text-gray-400">{caseData.aiColumns.length} columns</span>
          </div>

          <div className="space-y-2">
            {caseData.aiColumns.map((col) => (
              <div key={col.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                  onClick={() => setEditingCol(editingCol?.id === col.id ? null : { ...col })}
                >
                  <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{col.name}</div>
                    <div className="text-xs text-gray-400 font-mono truncate">→ {col.outputKey}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete "${col.name}"?`)) return;
                      const cols = caseData.aiColumns.filter((c) => c.id !== col.id);
                      saveColumns(cols);
                    }}
                    className="text-gray-300 hover:text-red-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {editingCol?.id === col.id && (
                  <div className="border-t border-gray-100 p-4 space-y-3 bg-gray-50">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500">Name</label>
                        <input
                          value={editingCol.name}
                          onChange={(e) => setEditingCol({ ...editingCol, name: e.target.value })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Output Key</label>
                        <input
                          value={editingCol.outputKey}
                          onChange={(e) => setEditingCol({ ...editingCol, outputKey: e.target.value })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Prompt</label>
                      <textarea
                        value={editingCol.prompt}
                        onChange={(e) => setEditingCol({ ...editingCol, prompt: e.target.value })}
                        rows={5}
                        className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-500">Model</label>
                        <select
                          value={editingCol.model || "gpt-4o-mini"}
                          onChange={(e) => setEditingCol({ ...editingCol, model: e.target.value })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
                        >
                          {(modelOptions.length ? modelOptions : ["gpt-4o-mini"]).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Condition</label>
                        <select
                          value={editingCol.condition || ""}
                          onChange={(e) => setEditingCol({ ...editingCol, condition: (e.target.value || undefined) as AiColumn["condition"] })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
                        >
                          <option value="">Always</option>
                          <option value="require_input">Only if input field present</option>
                          <option value="empty">If output cell empty (no re-run)</option>
                          <option value="not_empty">If output cell has value</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Condition Field</label>
                        <input
                          value={editingCol.conditionField || ""}
                          onChange={(e) => setEditingCol({ ...editingCol, conditionField: e.target.value || undefined })}
                          disabled={!editingCol.condition}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none disabled:opacity-40"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={saveColEdit} className="bg-violet-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-violet-700">Save</button>
                      <button onClick={() => setEditingCol(null)} className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {caseData.aiColumns.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No AI columns yet. Add one from the table view.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
