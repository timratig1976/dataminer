"use client";

import { useEffect, useState } from "react";
import { Play, Loader2, CheckCircle2, XCircle, Zap } from "lucide-react";
import AppShell from "@/components/AppShell";

interface SmokeResult {
  model: string;
  ok: boolean;
  latencyMs: number;
  preview?: string;
  error?: string;
}

interface CompareResult {
  model: string;
  ok: boolean;
  score: number;
  latencyMs: number;
  value: string;
  validation: "pass" | "fail";
  validationReason: string;
  error?: string;
}

const DEFAULT_MODELS = [
  "openai/gpt-4o-mini", "openai/gpt-4o",
  "anthropic/claude-3-5-haiku-latest", "anthropic/claude-sonnet-4-5",
  "mistral/mistral-small-latest", "mistral/mistral-large-latest",
  "google/gemini-flash-latest", "google/gemini-pro-latest",
  "meta/llama3.3-70b",
];

export default function LlmTestPage() {

  // ── Smoke Test ────────────────────────────────────────────────────────────
  const [selectedModels, setSelectedModels] = useState<string[]>(DEFAULT_MODELS.slice(0, 4));
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeResults, setSmokeResults] = useState<SmokeResult[]>([]);
  const [smokeError, setSmokeError] = useState<string | null>(null);

  // ── Custom Prompt Test ───────────────────────────────────────────────────
  const [promptText, setPromptText] = useState("Was ist die Hauptstadt von Deutschland? Antworte in einem Wort.");
  const [compareModels, setCompareModels] = useState<string[]>(["openai/gpt-4o-mini", "anthropic/claude-3-5-haiku-latest", "mistral/mistral-small-latest"]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResults, setCompareResults] = useState<CompareResult[]>([]);
  const [compareError, setCompareError] = useState<string | null>(null);

  function toggleModel(m: string, list: string[], setter: (v: string[]) => void, max = 999) {
    if (list.includes(m)) setter(list.filter(x => x !== m));
    else if (list.length < max) setter([...list, m]);
  }

  async function runSmoke() {
    setSmokeLoading(true); setSmokeResults([]); setSmokeError(null);
    try {
      const res = await fetch("/api/llm/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: selectedModels }),
      });
      const data = await res.json();
      if (!res.ok) { setSmokeError(data.error ?? "Fehler"); return; }
      setSmokeResults(Array.isArray(data.results) ? data.results : []);
    } catch (e) { setSmokeError(String(e)); }
    finally { setSmokeLoading(false); }
  }

  async function runCompare() {
    if (!promptText.trim() || compareModels.length === 0) return;
    setCompareLoading(true); setCompareResults([]); setCompareError(null);
    try {
      // Use a simple direct LLM call for each model via smoke endpoint with custom prompt
      const results: CompareResult[] = [];
      await Promise.all(compareModels.map(async (model) => {
        const t0 = Date.now();
        try {
          const res = await fetch("/api/llm/smoke", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ models: [model], prompt: promptText }),
          });
          const data = await res.json();
          const r = data.results?.[0];
          results.push({
            model,
            ok: r?.ok ?? false,
            score: 1,
            latencyMs: r?.latencyMs ?? (Date.now() - t0),
            value: r?.preview ?? "",
            validation: r?.ok ? "pass" : "fail",
            validationReason: r?.ok ? "OK" : (r?.error ?? "Fehler"),
            error: r?.error,
          });
        } catch (e) {
          results.push({ model, ok: false, score: 0, latencyMs: Date.now()-t0, value:"", validation:"fail", validationReason:String(e), error:String(e) });
        }
      }));
      setCompareResults(results.sort((a,b) => a.latencyMs - b.latencyMs));
    } catch (e) { setCompareError(String(e)); }
    finally { setCompareLoading(false); }
  }

  return (
    <AppShell title="LLM-Testing" titleIcon={<Zap className="w-4 h-4" style={{ color: "var(--orange)" }} />}>
      <div className="max-w-3xl mx-auto space-y-5 pb-12">

        {/* ── Smoke Test ── */}
        <div
          className="p-5 space-y-3.5"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-xs" style={{ color: "var(--text-1)" }}>🧪 Smoke Test</h2>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>Testet ob jedes Modell erreichbar ist und antwortet. Kosten: ~$0.00001/Modell.</p>
            </div>
            <button onClick={runSmoke} disabled={smokeLoading || selectedModels.length === 0}
              className="btn-v2 btn-v2-primary">
              {smokeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Play className="w-3.5 h-3.5"/>}
              {smokeLoading ? "Testet…" : `${selectedModels.length} Modelle testen`}
            </button>
          </div>

          {/* Model selection */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Modelle auswählen</div>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_MODELS.map(m => {
                const sel = selectedModels.includes(m);
                const provider = m.split("/")[0];
                return (
                  <button key={m} onClick={() => toggleModel(m, selectedModels, setSelectedModels)}
                    className="px-2.5 py-1 rounded text-xs font-mono border transition-colors cursor-pointer"
                    style={{
                      borderColor: sel ? "var(--orange-mid)" : "var(--border)",
                      background: sel ? "var(--orange-soft)" : "var(--surface)",
                      color: sel ? "var(--orange)" : "var(--text-2)",
                    }}>
                    {sel ? "✓ " : ""}{m.split("/")[1]}
                    <span className="opacity-50 ml-1">{provider}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Results */}
          {smokeError && <p className="text-xs text-red-600">{smokeError}</p>}
          {smokeResults.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Ergebnisse</div>
              {smokeResults.map(r => (
                <div key={r.model} className="flex items-center gap-3 px-3 py-2 rounded border text-xs" style={{ background: "var(--bg)", borderColor: "var(--border-xs)" }}>
                  {r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0"/> : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0"/>}
                  <span className="font-mono text-xs text-gray-700 flex-1">{r.model}</span>
                  <span className={`text-xs font-semibold ${r.ok ? "text-green-600" : "text-red-600"}`}>{r.ok ? "PASS" : "FAIL"}</span>
                  <span className="text-xs text-gray-400 font-mono">{r.latencyMs}ms</span>
                  {r.ok && r.preview && <span className="text-xs text-gray-500 truncate max-w-[160px]">→ {r.preview}</span>}
                  {!r.ok && r.error && <span className="text-xs text-red-500 truncate max-w-[200px]">{r.error}</span>}
                </div>
              ))}
              <div className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
                {smokeResults.filter(r=>r.ok).length}/{smokeResults.length} bestanden ·{" "}
                Ø {Math.round(smokeResults.filter(r=>r.ok).reduce((s,r)=>s+r.latencyMs,0) / Math.max(1, smokeResults.filter(r=>r.ok).length))}ms
              </div>
            </div>
          )}
        </div>

        {/* ── Prompt Compare ── */}
        <div
          className="p-5 space-y-3.5"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-xs" style={{ color: "var(--text-1)" }}>⚡ Modelle vergleichen</h2>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>Gleicher Prompt, verschiedene Modelle — Antwort und Latenz vergleichen.</p>
            </div>
            <button onClick={runCompare} disabled={compareLoading || compareModels.length === 0 || !promptText.trim()}
              className="btn-v2 btn-v2-primary">
              {compareLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Zap className="w-3.5 h-3.5"/>}
              {compareLoading ? "Läuft…" : "Vergleichen"}
            </button>
          </div>

          {/* Prompt input */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-3)" }}>Prompt</label>
            <textarea value={promptText} onChange={e => setPromptText(e.target.value)} rows={3}
              className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none resize-none"
              style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text-1)" }} />
          </div>

          {/* Model selection for compare */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-3)" }}>Modelle (max 5)</div>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_MODELS.map(m => {
                const sel = compareModels.includes(m);
                const disabled = !sel && compareModels.length >= 5;
                return (
                  <button key={m} onClick={() => !disabled && toggleModel(m, compareModels, setCompareModels, 5)}
                    disabled={disabled}
                    className="px-2.5 py-1 rounded text-xs font-mono border transition-colors cursor-pointer"
                    style={{
                      borderColor: sel ? "var(--orange-mid)" : "var(--border)",
                      background: sel ? "var(--orange-soft)" : "var(--surface)",
                      color: sel ? "var(--orange)" : disabled ? "var(--text-3)" : "var(--text-2)",
                    }}>
                    {sel ? "✓ " : ""}{m.split("/")[1]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Results */}
          {compareError && <p className="text-xs text-red-600">{compareError}</p>}
          {compareResults.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Ergebnisse</div>
              {compareResults.map((r, i) => (
                <div key={r.model} className="rounded border p-3 text-xs" style={{ background: r.ok ? "var(--surface)" : "var(--danger-soft)", borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-3">
                    {i === 0 && r.ok && <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded">🏆 Schnellstes</span>}
                    <span className="font-mono text-xs text-gray-700 flex-1">{r.model}</span>
                    <span className={`text-xs font-semibold ${r.ok ? "text-green-600" : "text-red-600"}`}>{r.ok ? "OK" : "FAIL"}</span>
                    <span className="text-xs font-mono text-gray-500">{r.latencyMs}ms</span>
                  </div>
                  {r.ok && r.value && (
                    <div className="mt-2 text-sm text-gray-800 bg-white rounded px-3 py-2 border border-gray-100">
                      {r.value.slice(0, 300)}{r.value.length > 300 ? "…" : ""}
                    </div>
                  )}
                  {!r.ok && r.error && <div className="mt-1 text-xs text-red-600">{r.error}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}
