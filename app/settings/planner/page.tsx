"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Save, RotateCcw, Play, Loader2, CheckCircle2, XCircle,
  Map, Globe, Search, FileSearch,
  Sparkles, AlertTriangle, Info
} from "lucide-react";
import AppShell from "@/components/AppShell";

interface PlanStep {
  id: string;
  type: string;
  label: string;
  mapQuery?: string;
  location?: string;
  query?: string;
  url?: string;
  estimatedHits: number;
  priority: number;
}

interface DiscoveryPlan {
  goal: string;
  steps: PlanStep[];
  estimatedRows: number;
  warnings: string[];
}

interface TestResult {
  plan?: DiscoveryPlan;
  latencyMs?: number;
  usedOverride?: boolean;
  error?: string;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  google_maps: <Map className="w-3.5 h-3.5 text-violet-500" />,
  google_search: <Search className="w-3.5 h-3.5 text-blue-500" />,
  catalog_scrape: <FileSearch className="w-3.5 h-3.5 text-green-500" />,
  directory_search: <Globe className="w-3.5 h-3.5 text-orange-500" />,
};

export default function PlannerSettingsPage() {
  const [defaultPrompt, setDefaultPrompt] = useState<string>("");
  const [savedOverride, setSavedOverride] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  // Test
  const [testPrompt, setTestPrompt] = useState("Hausbauunternehmen Rostock");
  const [maxResults, setMaxResults] = useState(50);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Active override = content differs from the built-in default (or default not loaded yet)
  const isOverrideActive = defaultPrompt ? editorValue.trim() !== defaultPrompt.trim() && editorValue.trim().length > 0 : editorValue.trim().length > 0;
  const initializedRef = useRef(false);

  // Load default prompt + current override (run once only)
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    fetch("/api/settings/test-planner")
      .then((r) => r.json())
      .then((d) => {
        const def = d.defaultPrompt ?? "";
        setDefaultPrompt(def);
        const override = d.currentOverride ?? null;
        setSavedOverride(override);
        // Always pre-populate with override if set, otherwise with default so user can edit directly
        setEditorValue((prev) => (prev === "" ? (override ?? def) : prev));
      })
      .catch(() => {});
  }, []);

  function handleEditorChange(val: string) {
    setEditorValue(val);
    setIsDirty(true);
  }

  function handleReset() {
    setEditorValue(savedOverride ?? "");
    setIsDirty(false);
  }

  function handleClearOverride() {
    setEditorValue(defaultPrompt);
    setIsDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // If editor matches default, save null (no override)
          plannerSystemPrompt: (editorValue.trim() && editorValue.trim() !== defaultPrompt.trim()) ? editorValue.trim() : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedOverride(editorValue.trim() || null);
      setIsDirty(false);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch (e) {
      alert("Save failed: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const handleTest = useCallback(async () => {
    if (!testPrompt.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: testPrompt.trim(),
          maxResults,
          // Pass the current editor value as live override (even if unsaved)
          systemPrompt: editorValue.trim() || null,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }, [testPrompt, maxResults, editorValue]);


  return (
    <AppShell title="Planner Prompt" titleIcon={<Sparkles className="w-4 h-4" style={{ color: "var(--orange)" }} />}>
      <div className="max-w-5xl mx-auto space-y-5 pb-12">

        {/* Header info */}
        <div
          className="flex items-start gap-3 p-3.5 rounded text-xs leading-relaxed"
          style={{
            background: "var(--orange-soft)",
            border: "1px solid var(--orange-mid)",
            color: "var(--orange)",
          }}
        >
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold text-xs">Custom Planner System Prompt</p>
            <p style={{ color: "var(--text-2)" }}>
              System-Prompt für die automatische Recherche-Planung überschreiben. Leer lassen für den Standard.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {/* Left 2/3: Editor */}
          <div className="col-span-2 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>System Prompt</span>
                {isOverrideActive ? (
                  <span className="status-pill status-pill-done" style={{ background: "var(--orange-soft)", color: "var(--orange)" }}>Override aktiv</span>
                ) : (
                  <span className="status-pill status-pill-done" style={{ background: "var(--bg)", color: "var(--text-3)" }}>Standard</span>
                )}
              </div>
            </div>

            <textarea
              value={editorValue}
              onChange={(e) => handleEditorChange(e.target.value)}
              placeholder="Laden…"
              className="w-full h-[500px] font-mono text-xs leading-relaxed p-3.5 resize-none focus:outline-none"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r)",
                color: "var(--text-1)",
              }}
              spellCheck={false}
            />

            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              {isOverrideActive
                ? `${editorValue.length} Zeichen · Eigener Prompt aktiv`
                : "Entspricht dem integrierten Standard"}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="btn-v2 btn-v2-primary"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedMsg ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {savedMsg ? "Gespeichert" : "Speichern"}
              </button>
              {isDirty && (
                <button
                  onClick={handleReset}
                  className="btn-v2"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              )}
              {isOverrideActive && (
                <button
                  onClick={handleClearOverride}
                  className="btn-v2"
                  style={{ color: "var(--danger)" }}
                >
                  Auf Default zurück
                </button>
              )}
            </div>
          </div>

          {/* Right 1/3: Test panel */}
          <div className="col-span-1 space-y-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Live Test</span>

            <div
              className="p-3.5 space-y-2.5"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div>
                <label className="text-[11px] mb-1 block font-medium" style={{ color: "var(--text-2)" }}>Such-Ziel</label>
                <input
                  type="text"
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTest()}
                  placeholder="z.B. Hausbauunternehmen Rostock"
                  className="w-full px-2.5 py-1.5 text-xs border rounded focus:outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text-1)" }}
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[11px] mb-1 block font-medium" style={{ color: "var(--text-2)" }}>Max Treffer</label>
                  <input
                    type="number"
                    value={maxResults}
                    onChange={(e) => setMaxResults(Number(e.target.value))}
                    min={10}
                    max={5000}
                    className="w-full px-2.5 py-1.5 text-xs border rounded focus:outline-none"
                    style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text-1)" }}
                  />
                </div>
                <div className="pt-4">
                  <button
                    onClick={handleTest}
                    disabled={testing || !testPrompt.trim()}
                    className="btn-v2 btn-v2-primary"
                  >
                    {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Test
                  </button>
                </div>
              </div>

              {!isOverrideActive && (
                <div className="text-[11px] p-2 rounded flex items-center gap-1.5" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Testet mit Default-Prompt
                </div>
              )}
            </div>

            {/* Results */}
            {testing && (
              <div className="flex items-center gap-2 text-xs py-3" style={{ color: "var(--text-3)" }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Plane…
              </div>
            )}

            {testResult && !testing && (
              <div className="space-y-2.5">
                {testResult.error ? (
                  <div className="flex items-start gap-2 p-2.5 rounded text-xs" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {testResult.error}
                  </div>
                ) : testResult.plan ? (
                  <>
                    <div
                      className="flex items-center gap-2.5 p-3 rounded text-xs"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "var(--green)" }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate" style={{ color: "var(--text-1)" }}>{testResult.plan.goal}</p>
                        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                          {testResult.plan.steps.length} Steps · ~{testResult.plan.estimatedRows} Zeilen · {testResult.latencyMs}ms
                        </p>
                      </div>
                    </div>

                    {/* Coverage gap warning */}
                    {testResult.plan.estimatedRows < maxResults * 0.6 && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Only ~{testResult.plan.estimatedRows} of {maxResults} requested results reachable
                        </div>
                        <p className="text-xs text-amber-700 leading-relaxed">
                          The planner found all available sources for this query, but they are estimated to return far fewer results than your target.
                          This usually means the search is too narrow — either the location is too specific (single city) or the industry niche has limited online presence.
                        </p>
                        <p className="text-xs font-medium text-amber-800">
                          💡 To get more results, try:
                        </p>
                        <ul className="text-xs text-amber-700 space-y-0.5 pl-3 list-disc">
                          <li>Broaden the location — e.g. use a state/region instead of a single city</li>
                          <li>Add related search terms — e.g. "Bauunternehmen" in addition to "Hausbauunternehmen"</li>
                          <li>Search across multiple cities explicitly — e.g. "Rostock, Schwerin, Greifswald"</li>
                        </ul>
                      </div>
                    )}

                    {testResult.plan.warnings.length > 0 && (
                      <div className="space-y-1">
                        {testResult.plan.warnings.map((w, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {w}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Step list */}
                    <div className="space-y-1 max-h-[340px] overflow-y-auto pr-1">
                      {testResult.plan.steps.map((step) => {
                        return (
                          <div key={step.id} className="border border-gray-100 rounded-lg bg-white">
                            <div className="px-3 py-2 space-y-1">
                              <div className="flex items-center gap-2">
                                {STEP_ICONS[step.type] ?? <Globe className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                                <span className="font-medium text-gray-700 flex-1 text-xs">{step.label}</span>
                                <span className="text-violet-600 font-semibold text-xs shrink-0">~{step.estimatedHits} results</span>
                              </div>
                              <div className="pl-5 flex flex-wrap gap-x-3 gap-y-0.5">
                                {step.mapQuery && (
                                  <span className="text-xs text-gray-500"><span className="font-medium text-gray-600">mapQuery:</span> {step.mapQuery}</span>
                                )}
                                {step.location && (
                                  <span className="text-xs text-gray-500"><span className="font-medium text-gray-600">location:</span> {step.location}</span>
                                )}
                                {step.query && (
                                  <span className="text-xs text-gray-500"><span className="font-medium text-gray-600">query:</span> {step.query}</span>
                                )}
                                {step.url && (
                                  <span className="text-xs text-gray-500 break-all"><span className="font-medium text-gray-600">url:</span> {step.url}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
