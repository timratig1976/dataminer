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
    <AppShell title="Planner Prompt" titleIcon={<Sparkles className="w-4 h-4 text-violet-500" />}>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header info */}
        <div className="flex items-start gap-3 p-4 bg-violet-50 border border-violet-100 rounded-xl">
          <Info className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
          <div className="text-sm text-violet-800 space-y-1">
            <p className="font-medium">Custom Planner System Prompt</p>
            <p className="text-violet-600">
              Override the built-in LLM instruction for discovery planning. Leave empty to use the default.
              The active prompt is used for all new agent runs and manual plan generation.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Left 2/3: Editor */}
          <div className="col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800">System Prompt</span>
                {isOverrideActive ? (
                  <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Override aktiv</span>
                ) : (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Built-in Default</span>
                )}
              </div>
            </div>

            <textarea
              value={editorValue}
              onChange={(e) => handleEditorChange(e.target.value)}
              placeholder="Loading…"
              className="w-full h-[520px] font-mono text-xs leading-relaxed bg-white text-gray-900 caret-gray-900 border border-gray-200 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
              spellCheck={false}
            />

            <p className="text-xs text-gray-400">
              {isOverrideActive
                ? `${editorValue.length} chars · Override active — this replaces the built-in prompt`
                : "Matches built-in default — no override stored"}
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isDirty
                    ? "bg-violet-600 text-white hover:bg-violet-700"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : savedMsg ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {savedMsg ? "Gespeichert" : "Speichern"}
              </button>
              {isDirty && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
              {isOverrideActive && (
                <button
                  onClick={handleClearOverride}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Auf Default zurück
                </button>
              )}
            </div>
          </div>

          {/* Right 1/3: Test panel */}
          <div className="col-span-1 space-y-3">
            <span className="text-sm font-semibold text-gray-800">Live Test</span>

            <div className="space-y-2.5">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Research Goal</label>
                <input
                  type="text"
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTest()}
                  placeholder="e.g. Hausbauunternehmen Rostock"
                  className="w-full px-3 py-2 text-sm text-gray-900 caret-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Max Results</label>
                  <input
                    type="number"
                    value={maxResults}
                    onChange={(e) => setMaxResults(Number(e.target.value))}
                    min={10}
                    max={5000}
                    className="w-full px-3 py-2 text-sm text-gray-900 caret-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
                <div className="pt-5">
                  <button
                    onClick={handleTest}
                    disabled={testing || !testPrompt.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                  >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Test
                  </button>
                </div>
              </div>

              {!isOverrideActive && (
                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Testing with built-in default (no override active)
                </div>
              )}
            </div>

            {/* Results */}
            {testing && (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                <Loader2 className="w-4 h-4 animate-spin" />
                Planning…
              </div>
            )}

            {testResult && !testing && (
              <div className="space-y-3">
                {testResult.error ? (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    {testResult.error}
                  </div>
                ) : testResult.plan ? (
                  <>
                    {/* Summary bar */}
                    <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-xl text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate">{testResult.plan.goal}</p>
                        <p className="text-xs text-gray-500">
                          {testResult.plan.steps.length} Steps · ~{testResult.plan.estimatedRows} estimated rows · {testResult.latencyMs}ms
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
