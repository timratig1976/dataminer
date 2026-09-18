"use client";

import React, { useState, useRef } from "react";
import { Modal, FormField, Input, Textarea } from "@/components/ui/ModalMaster";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanStep {
  id: string;
  type: string;
  label: string;
  query?: string;
  queryTemplate?: string;
  region?: string;
  queries?: string[];
  mapQuery?: string;
  location?: string;
  url?: string;
  extractionPrompt?: string;
  maxPages?: number;
  estimatedHits: number;
  priority: number;
}

interface DiscoveryPlan {
  goal: string;
  steps: PlanStep[];
  estimatedRows: number;
  warnings: string[];
}

interface StepProgress {
  stepId: string;
  added: number;
  skipped: number;
  total: number;
  done: boolean;
  error?: string;
  currentQuery?: string;
}

interface QueryLogEntry {
  query: string;
  stepId: string;
  stepLabel: string;
  status: "running" | "done" | "error";
  found: number;
  source?: string;
  ts: number;
}

export interface AppendModalProps {
  caseId: string;
  onRowsAdded: (count: number) => void;
  onClose: () => void;
  initialTab?: "autopilot" | "search" | "catalog";
  // Agent props when opened in autopilot mode
  rowsCount?: number;
  externalRun?: import("@/hooks/useAgentRun").AgentRunState | null;
  externalRunning?: boolean;
  externalStart?: (goal: import("@/hooks/useAgentRun").AgentGoal) => Promise<void>;
  externalStep?: () => Promise<import("@/hooks/useAgentRun").AgentRunState | null>;
  externalCancel?: () => Promise<void>;
  externalReload?: (runId: string) => Promise<void>;
}

type TabId = "autopilot" | "search" | "catalog";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "autopilot", label: "Autopilot (Ziel-Suche)", icon: "🎯" },
  { id: "search", label: "Manuelle Suche", icon: "🔍" },
  { id: "catalog", label: "Katalog-Scraper", icon: "📋" },
];

import { AgentGoalModal } from "@/components/AgentGoalModal";

// ── Main Component ────────────────────────────────────────────────────────────

export default function AppendModal({
  caseId,
  onRowsAdded,
  onClose,
  initialTab = "autopilot",
  rowsCount = 0,
  externalRun,
  externalRunning,
  externalStart,
  externalStep,
  externalCancel,
  externalReload,
}: AppendModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  return (
    <Modal
      onClose={onClose}
      title="Leads finden & Daten erweitern"
      icon="🔍"
      maxWidth="44rem"
    >
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg)", padding: "0 12px", gap: 6 }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "9px 14px",
                fontSize: 12.5,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "var(--orange)" : "var(--text-2)",
                background: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid var(--orange)" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1,
                transition: "all 0.12s ease",
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === "autopilot" && (
          <div className="-m-6">
            <AgentGoalModal
              caseId={caseId}
              rowsCount={rowsCount}
              onClose={onClose}
              onImported={() => onRowsAdded(1)}
              externalRun={externalRun}
              externalRunning={externalRunning}
              externalStart={externalStart}
              externalStep={externalStep}
              externalCancel={externalCancel}
              externalReload={externalReload}
              embedded
            />
          </div>
        )}
        {activeTab === "search" && (
          <SearchTab caseId={caseId} onRowsAdded={onRowsAdded} />
        )}
        {activeTab === "catalog" && (
          <CatalogTab caseId={caseId} onRowsAdded={onRowsAdded} />
        )}
      </div>
    </Modal>
  );
}

// ── Tab: KI-Plan ──────────────────────────────────────────────────────────────

function AiPlanTab({ caseId, onRowsAdded }: { caseId: string; onRowsAdded: (n: number) => void }) {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<DiscoveryPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Record<string, StepProgress>>({});
  const [queryLog, setQueryLog] = useState<QueryLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [pipelineDone, setPipelineDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const [skipCatalogs, setSkipCatalogs] = useState(false);

  const handlePlan = async () => {
    if (!prompt.trim()) return;
    setPlanning(true);
    setError(null);
    setPlan(null);
    setQueryLog([]);
    setPipelineDone(false);

    try {
      const res = await fetch(`/api/cases/${caseId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Plan-Erstellung fehlgeschlagen"); return; }
      setPlan(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setPlanning(false);
    }
  };

  const handleRun = async () => {
    if (!plan) return;
    setRunning(true);
    setProgress({});
    setPipelineDone(false);
    setError(null);

    // Filter catalog steps if user opted out
    const stepsToRun = skipCatalogs
      ? plan.steps.filter((s) => !s.type.includes("catalog"))
      : plan.steps;
    const planToRun = { ...plan, steps: stepsToRun };

    abortRef.current = new AbortController();

    try {
      const res = await fetch(`/api/cases/${caseId}/append/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planToRun, dedupeField: "domain" }),
        signal: abortRef.current.signal,
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine);
            const stepLabel = plan?.steps.find(s => s.id === event.stepId)?.label ?? event.stepId;

            if (event.type === "step_start") {
              setProgress((p) => ({
                ...p,
                [event.stepId]: { stepId: event.stepId, added: 0, skipped: 0, total: 0, done: false },
              }));
            } else if (event.type === "step_progress") {
              // Add query to log
              if (event.query) {
                setQueryLog(prev => {
                  const existing = prev.findIndex(e => e.query === event.query && e.stepId === event.stepId);
                  if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = { ...updated[existing], status: "running", found: event.found ?? 0 };
                    return updated;
                  }
                  const entry: QueryLogEntry = {
                    query: event.query,
                    stepId: event.stepId,
                    stepLabel,
                    status: "running",
                    found: event.found ?? 0,
                    ts: Date.now(),
                  };
                  return [...prev, entry];
                });
              }
              setProgress((p) => ({
                ...p,
                [event.stepId]: {
                  ...(p[event.stepId] ?? { stepId: event.stepId, added: 0, skipped: 0, total: 0, done: false }),
                  currentQuery: event.query ?? undefined,
                  added: event.found ?? p[event.stepId]?.added ?? 0,
                },
              }));
            } else if (event.type === "step_done") {
              // Mark all queries for this step as done
              setQueryLog(prev => prev.map(e =>
                e.stepId === event.stepId ? { ...e, status: event.error ? "error" : "done" } : e
              ));
              setProgress((p) => ({
                ...p,
                [event.stepId]: { stepId: event.stepId, added: event.added, skipped: event.skipped, total: event.total, done: true, error: event.error },
              }));
            } else if (event.type === "pipeline_done") {
              setPipelineDone(true);
              onRowsAdded(event.totalAdded);
            } else if (event.type === "error") {
              setError(event.message);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const totalAdded = Object.values(progress).reduce((s, p) => s + p.added, 0);
  const totalSkipped = Object.values(progress).reduce((s, p) => s + p.skipped, 0);
  const stepsDone = Object.values(progress).filter((p) => p.done).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="block text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-1.5">Was soll gesucht werden?</label>
        <textarea
          className="w-full border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--orange-soft)] focus:border-[var(--orange)]"
          rows={3}
          placeholder="z.B. Finde alle Heizungsunternehmen in Mecklenburg-Vorpommern"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={running}
        />
        <button
          className="btn-v2 btn-v2-primary mt-2.5 px-4 py-2 text-sm font-medium"
          onClick={handlePlan}
          disabled={!prompt.trim() || planning || running}
        >
          {planning ? <span className="animate-spin">⚙️</span> : "✨"}
          {planning ? "Plan wird erstellt…" : "Plan erstellen"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* Plan viewer */}
      {plan && (
        <div className="flex flex-col gap-3">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-[var(--text-1)]">🎯 {plan.goal}</p>
            {plan.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700 mt-1">⚠ {w}</p>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-[var(--text-1)] cursor-pointer">
            <input
              type="checkbox"
              checked={skipCatalogs}
              onChange={(e) => setSkipCatalogs(e.target.checked)}
              disabled={running}
              className="accent-[var(--orange)]"
            />
            <span>📋 Katalogseiten-Crawling überspringen</span>
          </label>

          <div className="flex flex-col gap-1.5">
            {plan.steps.map((step) => {
              const prog = progress[step.id];
              const isRunning = prog && !prog.done;
              return (
                <div key={step.id} className={`rounded-lg border text-sm overflow-hidden ${
                  prog?.done ? (prog.error ? "bg-red-50 border-red-100" : "bg-green-50 border-green-100") :
                  isRunning ? "bg-[var(--orange-soft)] border-[var(--orange-mid)]" : "bg-[var(--surface)] border-[var(--border)]"
                }`}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="text-base flex-shrink-0">
                      {prog?.done ? (prog.error ? "❌" : "✅") :
                       isRunning ? <span className="animate-spin inline-block">⚙️</span> :
                       step.type === "catalog_scrape" ? "📋" :
                       step.type === "google_maps" ? "🗺️" : "🔍"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[var(--text-1)] font-medium">{step.label}</span>
                      {isRunning && prog.currentQuery && (
                        <div className="text-xs text-[var(--orange)] truncate mt-0.5">↳ {prog.currentQuery}</div>
                      )}
                      {!isRunning && !prog?.done && step.queries && step.queries.length > 1 && (
                        <div className="text-xs text-[var(--text-3)] mt-0.5">{step.queries.length} Suchanfragen (eine pro Stadt)</div>
                      )}
                    </div>
                    <div className="text-xs text-right flex-shrink-0">
                      {prog?.done ? (
                        prog.error ? <span className="text-red-500">Fehler</span> :
                        <span className="text-green-700 font-medium">
                          {prog.added} neu
                          {prog.skipped > 0 && <span className="text-gray-400 ml-1">· {prog.skipped} ⊘</span>}
                        </span>
                      ) : isRunning ? (
                        <span className="text-blue-600 font-medium">{prog.added > 0 ? `${prog.added} gefunden…` : "läuft…"}</span>
                      ) : (
                        <span className="text-gray-400">~{step.estimatedHits}*</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Query Execution Log */}
          {queryLog.length > 0 && (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <button
                onClick={() => setShowLog(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-500 bg-gray-50 hover:bg-gray-100"
              >
                <span>📋 Query-Log ({queryLog.length} Anfragen)</span>
                <span className="flex items-center gap-2">
                  {queryLog.filter(q => q.status === "running").length > 0 && (
                    <span className="text-blue-500 animate-pulse">● läuft</span>
                  )}
                  <span>{showLog ? "▲" : "▼"}</span>
                </span>
              </button>
              {showLog && (
                <div ref={logRef} className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                  {queryLog.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="flex-shrink-0">
                        {entry.status === "running" ? <span className="animate-spin inline-block">⚙️</span> :
                         entry.status === "done" ? "✅" : "❌"}
                      </span>
                      <span className="flex-1 text-gray-700 truncate" title={entry.query}>{entry.query}</span>
                      <span className={`flex-shrink-0 font-medium ${entry.status === "done" && entry.found > 0 ? "text-green-600" : "text-gray-400"}`}>
                        {entry.status === "done" ? `${entry.found} neu` :
                         entry.status === "running" ? "läuft…" : "Fehler"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          {running && plan.steps.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-100 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Schritt {stepsDone}/{plan.steps.length}</span>
                <span>
                  {totalAdded > 0 && <span className="text-green-600 font-medium mr-2">+{totalAdded} neu</span>}
                  {totalSkipped > 0 && <span className="text-gray-400">{totalSkipped} Duplikate ⊘</span>}
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-2 bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${(stepsDone / plan.steps.length) * 100}%` }} />
              </div>
              {Object.values(progress).find(p => !p.done && p.currentQuery)?.currentQuery && (
                <p className="text-xs text-blue-500 truncate">
                  Aktuell: {Object.values(progress).find(p => !p.done && p.currentQuery)?.currentQuery}
                </p>
              )}
            </div>
          )}

          {pipelineDone && (
            <div className="bg-green-50 rounded-lg px-4 py-3 text-sm text-green-800">
              <p className="font-semibold">✅ Fertig! {totalAdded} neue Einträge hinzugefügt</p>
              {totalSkipped > 0 && <p className="text-xs text-green-700 mt-0.5">{totalSkipped} Duplikate automatisch übersprungen (Domain-Deduplizierung)</p>}
              <p className="text-xs text-green-600 mt-1">KI-Spalten jetzt ausführen um die neuen Einträge anzureichern.</p>
            </div>
          )}

          {/* Estimate footnote + dedupe info */}
          {!running && !pipelineDone && (
            <div className="flex items-start gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
              <span className="mt-0.5">ℹ️</span>
              <div className="space-y-0.5">
                <p>* Schätzungen vom KI-Planner (grob). Tatsächlich: 10–30 Treffer/Google-Suche, bis 100 via SerpApi-Pagination, 20–200/Katalogseite</p>
                <p>✓ Deduplizierung automatisch per Domain — keine doppelten Einträge möglich</p>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            {running ? (
              <button
                className="btn-v2"
                style={{ color: "var(--danger)", borderColor: "var(--border)" }}
                onClick={() => abortRef.current?.abort()}
              >
                Abbrechen
              </button>
            ) : !pipelineDone ? (
              <button
                className="btn-v2 btn-v2-primary px-4 py-2 text-sm font-medium"
                onClick={handleRun}
              >
                ▶ Ausführen
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Direkte Suche ─────────────────────────────────────────────────────────

function SearchTab({ caseId, onRowsAdded }: { caseId: string; onRowsAdded: (n: number) => void }) {
  const [queries, setQueries] = useState("");
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number; steps: { query: string; added: number; source?: string; error?: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<"auto" | "maps" | "search" | "combined">("auto");
  const [combinedPrimary, setCombinedPrimary] = useState<"maps" | "search">("maps");

  const handleRun = async () => {
    const qList = queries.split("\n").map((q) => q.trim()).filter(Boolean);
    if (qList.length === 0 && !template.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // Build source param based on selected mode
      let source = "auto";
      let mode = "search";
      if (searchMode === "maps") { source = "maps-serpapi"; mode = "maps"; }
      else if (searchMode === "search") { source = "auto"; mode = "search"; }
      else if (searchMode === "combined") { mode = "combined"; source = combinedPrimary === "maps" ? "maps-serpapi" : "auto"; }

      const res = await fetch(`/api/cases/${caseId}/append`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          queries: qList,
          queryTemplate: template.trim() || undefined,
          source,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Fehler"); return; }
      setResult(data);
      onRowsAdded(data.added);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Search mode selector ── */}
      <div>
        <label className="block text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-2">Such-Quelle</label>
        <div className="flex flex-wrap gap-2">
          {[
            { id: "auto" as const, label: "🔄 Auto", desc: "Beste Quelle automatisch" },
            { id: "maps" as const, label: "🗺️ Nur GMB", desc: "Google Maps Business" },
            { id: "search" as const, label: "🔍 Nur Google", desc: "Web-Suche" },
            { id: "combined" as const, label: "🗺️+🔍 Kombi", desc: "Maps + Web kombiniert" },
          ].map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSearchMode(opt.id)}
              disabled={loading}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-all ${
                searchMode === opt.id
                  ? "border-[var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)] shadow-sm font-semibold"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--orange-mid)] hover:bg-[var(--bg)]"
              }`}
              title={opt.desc}
            >
              <span className="font-semibold text-sm">{opt.label}</span>
              <span className="opacity-75">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Kombi-Einstellungen */}
      {searchMode === "combined" && (
        <div className="bg-[var(--orange-soft)] rounded-lg p-3 border border-[var(--orange-mid)]">
          <span className="text-xs font-semibold text-[var(--orange)]">Primäre Quelle:</span>
          <div className="flex gap-2 mt-1.5">
            <button
              type="button"
              onClick={() => setCombinedPrimary("maps")}
              className={`px-3 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                combinedPrimary === "maps"
                  ? "bg-[var(--orange)] text-white"
                  : "bg-[var(--surface)] text-[var(--orange)] border border-[var(--orange-mid)]"
              }`}
            >
              🗺️ Maps zuerst (strukturierte Daten priorisieren)
            </button>
            <button
              type="button"
              onClick={() => setCombinedPrimary("search")}
              className={`px-3 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                combinedPrimary === "search"
                  ? "bg-[var(--orange)] text-white"
                  : "bg-[var(--surface)] text-[var(--orange)] border border-[var(--orange-mid)]"
              }`}
            >
              🔍 Web zuerst (breitere Abdeckung)
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-1">Suchanfragen (eine pro Zeile)</label>
        <textarea
          className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[var(--orange-soft)] focus:border-[var(--orange)]"
          rows={5}
          placeholder={"Heizungsbauer Rostock\nHeizungsbauer Schwerin\nHaustechnik Greifswald"}
          value={queries}
          onChange={(e) => setQueries(e.target.value)}
          disabled={loading}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-1">
          Region-Template <span className="text-[var(--text-3)] font-normal normal-case">(optional, wird für alle Städte der Region expandiert)</span>
        </label>
        <input
          className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--orange-soft)] focus:border-[var(--orange)]"
          placeholder='z.B. "Heizungsbauer {city} MV" — {city} wird durch alle Städte ersetzt'
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          disabled={loading}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="bg-green-50 rounded-lg px-4 py-3 text-sm text-green-800">
          ✅ {result.added} neue Einträge · {result.skipped} Duplikate
          {result.steps.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.steps.map((s, i) => (
                <span key={i} className="text-xs bg-green-100 px-2 py-0.5 rounded">
                  {s.source && <span className="font-medium text-green-700">{s.source}: </span>}
                  +{s.added}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <button
          className="btn-v2 btn-v2-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
          onClick={handleRun}
          disabled={loading || (!queries.trim() && !template.trim())}
        >
          {loading ? "Suche läuft…" : "▶ Suchen"}
        </button>
      </div>
    </div>
  );
}

// ── Tab: Katalog-Scraping ──────────────────────────────────────────────────────

function CatalogTab({ caseId, onRowsAdded }: { caseId: string; onRowsAdded: (n: number) => void }) {
  const [url, setUrl] = useState("");
  const [extractionPrompt, setExtractionPrompt] = useState("");
  const [maxPages, setMaxPages] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const CATALOG_EXAMPLES = [
    "https://www.gelbeseiten.de/suche/heizungsbauer/rostock",
    "https://www.wlw.de/de/suche?q=heizungsbauer&l=mecklenburg-vorpommern",
    "https://www.11880.com/suche/heizungsbauer/rostock.html",
  ];

  const handleRun = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);

    // Use the AI-guided plan with a single catalog_scrape step
    const plan = {
      goal: `Katalog scrapen: ${url}`,
      steps: [{
        id: "step_1",
        type: "catalog_scrape",
        label: `Scrape: ${new URL(url).hostname}`,
        url,
        extractionPrompt,
        maxPages,
        estimatedHits: maxPages * 30,
        priority: 1,
      }],
      estimatedRows: maxPages * 30,
      warnings: [],
    };

    try {
      const res = await fetch(`/api/cases/${caseId}/append/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, dedupeField: "domain" }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let added = 0, skipped = 0;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const d = line.replace(/^data: /, "").trim();
          if (!d) continue;
          try {
            const ev = JSON.parse(d);
            if (ev.type === "pipeline_done") { added = ev.totalAdded; skipped = ev.totalSkipped; }
            if (ev.type === "error") setError(ev.message);
          } catch { /* skip */ }
        }
      }

      setResult({ added, skipped });
      onRowsAdded(added);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Katalog-URL</label>
        <input
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="https://www.gelbeseiten.de/suche/heizungsbauer/mv"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
        />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {CATALOG_EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="text-xs text-blue-600 hover:underline"
              onClick={() => setUrl(ex)}
            >
              {new URL(ex).hostname}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Was soll extrahiert werden? (optional)</label>
        <input
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder='z.B. "Heizungsunternehmen mit Adresse und Telefon"'
          value={extractionPrompt}
          onChange={(e) => setExtractionPrompt(e.target.value)}
          disabled={loading}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-[var(--text-2)] uppercase tracking-wide mb-1">Max. Seiten</label>
        <input
          type="number"
          min={1}
          max={20}
          className="w-24 border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--orange-soft)] focus:border-[var(--orange)]"
          value={maxPages}
          onChange={(e) => setMaxPages(Number(e.target.value))}
          disabled={loading}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="bg-green-50 rounded-lg px-4 py-3 text-sm text-green-800">
          ✅ {result.added} neue Einträge · {result.skipped} Duplikate
        </div>
      )}
      <div className="flex justify-end">
        <button
          className="btn-v2 btn-v2-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
          onClick={handleRun}
          disabled={loading || !url.trim()}
        >
          {loading ? <span className="flex items-center gap-2"><span className="animate-spin">⚙️</span> Scrape läuft…</span> : "▶ Scrapen"}
        </button>
      </div>
    </div>
  );
}
