"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  X, Target, Loader2, CheckCircle2, XCircle, SkipForward, Circle,
  AlertTriangle, TrendingUp, DollarSign, Clock, Globe, MapPin, List, Search,
  Play, Pause, Trash2, Pencil,
} from "lucide-react";
import { useAgentRun, type AgentGoal, type AgentRunState, type AgentRunStatus } from "@/hooks/useAgentRun";

interface Props {
  caseId: string;
  rowsCount: number;
  onClose: () => void;
  onImported: () => void;
  // Optional: externally managed run state (lifted to parent page)
  externalRun?: AgentRunState | null;
  externalRunning?: boolean;
  externalStart?: (goal: AgentGoal) => Promise<void>;
  externalStep?: () => Promise<AgentRunState | null>;
  externalCancel?: () => Promise<void>;
  externalReload?: (runId: string) => Promise<void>;
}

const TERMINAL_STATUSES = new Set(["completed", "budget_exhausted", "cancelled", "failed"]);

function statusLabel(status: string): string {
  switch (status) {
    case "planning": return "Planung";
    case "running": return "Läuft";
    case "evaluating": return "Auswertung";
    case "expanding": return "Such-Erweiterung";
    case "completed": return "Abgeschlossen";
    case "budget_exhausted": return "Budget/Limit erreicht";
    case "cancelled": return "Abgebrochen";
    case "failed": return "Fehlgeschlagen";
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "bg-emerald-100 text-emerald-800";
    case "running":
    case "expanding": return "bg-blue-100 text-blue-800";
    case "budget_exhausted": return "bg-amber-100 text-amber-800";
    case "cancelled": return "bg-gray-200 text-gray-600";
    case "failed": return "bg-red-100 text-red-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

function stepIcon(result: { uniqueInserted: number; error?: string }): React.ReactNode {
  if (result.error) return <XCircle className="w-3.5 h-3.5 text-red-500" />;
  if (result.uniqueInserted === 0) return <SkipForward className="w-3.5 h-3.5 text-gray-400" />;
  return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
}

function planStepTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case "google_maps": return <MapPin className="w-3 h-3 text-sky-500" />;
    case "catalog_scrape":
    case "catalog_deep_crawl":
    case "directory_search": return <List className="w-3 h-3 text-amber-500" />;
    case "multi_search": return <Globe className="w-3 h-3 text-violet-500" />;
    default: return <Search className="w-3 h-3 text-gray-500" />;
  }
}

function planStepTypeLabel(type: string): string {
  switch (type) {
    case "google_maps": return "Maps";
    case "google_search": return "Google";
    case "multi_search": return "Multi";
    case "catalog_scrape": return "Katalog";
    case "catalog_deep_crawl": return "Deep Crawl";
    case "directory_search": return "Verzeichnis";
    default: return type;
  }
}

export function AgentGoalModal({ caseId, rowsCount, onClose, onImported, externalRun, externalRunning, externalStart, externalStep, externalCancel, externalReload }: Props) {
  // ── Goal form state ──
  const [description, setDescription] = useState("");
  const [targetCount, setTargetCount] = useState(3000);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState("");
  const [maxDurationMin, setMaxDurationMin] = useState("");
  const [maxIterations, setMaxIterations] = useState("");
  const [useMaps, setUseMaps] = useState(true);

  // ── Agent run hook — only used when no external state provided ──
  const hasExternal = externalRun !== undefined;
  const internalHook = useAgentRun(hasExternal ? "__disabled__" : caseId);
  const run = hasExternal ? externalRun : internalHook.run;
  const running = externalRunning !== undefined ? externalRunning : internalHook.running;
  const start = externalStart ?? internalHook.start;
  const step = externalStep ?? internalHook.step;
  const cancel = externalCancel ?? internalHook.cancel;
  const reload = externalReload ?? internalHook.reload;
  const error = internalHook.error;
  const stepLoopRef = useRef(false);
  const importedRef = useRef(false);

  // ── Pause / plan-review state ──
  const [paused, setPaused] = useState(true); // start paused — user must click "Starten"
  const [extraContext, setExtraContext] = useState(""); // additional user input for the search
  const [editingStep, setEditingStep] = useState<string | null>(null); // stepId being edited
  const [editValue, setEditValue] = useState("");
  const [deletedStepIds, setDeletedStepIds] = useState<Set<string>>(new Set());

  const isRunning = running && run !== null && !TERMINAL_STATUSES.has(run.status) && !paused;
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);

  useEffect(() => {
    // Skip internal prefill when page manages the run state
    if (hasExternal) return;
    fetch(`/api/cases/${caseId}/agent`)
      .then((r) => r.ok ? r.json() : [])
      .then((runs: Array<{ id: string; status: string; goal?: { description?: string; targetCount?: number } }>) => {
        if (!Array.isArray(runs) || runs.length === 0) return;
        // Resume an actively running run
        const active = runs.find((r) => !TERMINAL_STATUSES.has(r.status));
        if (active) {
          reloadRef.current(active.id);
        }
        // Always pre-fill form from the most recent run's goal
        const last = runs[0];
        if (last?.goal?.description) {
          setDescription(last.goal.description);
          if (last.goal.targetCount) setTargetCount(last.goal.targetCount);
        }
      })
      .catch(() => {});
  }, [caseId]); // stable — reloadRef holds latest reload without being a dep

  // Step loop: call step() repeatedly while run is not terminal
  // Pre-fill form fields from the loaded run so "Neue Suche" works immediately
  useEffect(() => {
    if (run && !description) {
      setDescription(run.goal.description);
      setTargetCount(run.goal.targetCount);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]); // only when a new run is loaded

  useEffect(() => {
    // Only run internal step loop when NOT using external state (page-level loop)
    if (externalRun !== undefined) return;
    if (!running || !run || TERMINAL_STATUSES.has(run.status) || paused) {
      stepLoopRef.current = false;
      return;
    }
    if (stepLoopRef.current) return;
    stepLoopRef.current = true;
    let active = true;
    async function loop() {
      while (active && stepLoopRef.current) {
        const state = await step();
        if (!active) break;
        if (!importedRef.current && state && state.uniqueCount > 0) {
          importedRef.current = true;
          onImported();
        }
        if (!state || TERMINAL_STATUSES.has(state.status)) {
          stepLoopRef.current = false;
          if (state) onImported();
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    loop();
    return () => { active = false; stepLoopRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, paused, externalRun]);

  const handlePlan = async () => {
    if (!description.trim()) return;
    importedRef.current = false;
    setPaused(true); // stay paused — show plan first, user clicks Starten
    setDeletedStepIds(new Set());
    const goal: AgentGoal = {
      description: extraContext.trim()
        ? `${description.trim()}\n\nZusätzlicher Kontext: ${extraContext.trim()}`
        : description.trim(),
      targetCount,
    };
    if (maxBudgetUsd.trim()) goal.maxBudgetUsd = Number(maxBudgetUsd);
    if (maxDurationMin.trim()) goal.maxDurationMin = Number(maxDurationMin);
    if (maxIterations.trim()) goal.maxIterations = Number(maxIterations);
    goal.useMaps = useMaps;
    await start(goal);
  };

  const handleStart = () => {
    setPaused(false); // kick off the step loop
  };

  const handlePause = () => {
    setPaused(true);
  };

  const handleDeleteStep = (stepId: string) => {
    setDeletedStepIds(prev => new Set([...prev, stepId]));
  };

  const handleEditStep = (stepId: string, currentQuery: string) => {
    setEditingStep(stepId);
    setEditValue(currentQuery);
  };

  const handleSaveEdit = () => {
    // We can't mutate run.plan directly (server state), but we track edits locally
    // For now just close edit — full edit support would require a PATCH endpoint
    setEditingStep(null);
  };

  const handleCancel = async () => {
    await cancel();
  };

  const progressPct = run
    ? Math.min(100, Math.round((run.uniqueCount / run.goal.targetCount) * 100))
    : 0;

  const elapsedMin = run
    ? Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60_000)
    : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-rose-500" />
            <h3 className="font-semibold text-gray-900">Ziel-basierte Suche</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!run ? (
          /* ── Goal form ── */
          <div className="px-6 py-5 space-y-4 flex-1">
            <p className="text-sm text-gray-500">
              Beschreibe, welche Unternehmen du finden möchtest. Die KI plant und führt die Suche automatisch
              in mehreren Runden aus, bis das Ziel erreicht ist.
            </p>

            {error && (
              <div className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
                ❌ {error}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Was suchst du?
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && description.trim() && handleStart()}
                placeholder="z.B. Handwerksbetriebe Heizung/Sanitär in NRW"
                className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 ${description.length > 0 && !description.trim() ? "border-red-400 bg-red-50" : "border-gray-300"}`}
                disabled={isRunning}
                autoFocus
              />
              {description.length > 0 && !description.trim() && (
                <p className="text-xs text-red-500 mt-1">Bitte eine Beschreibung eingeben</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Zielanzahl
                </label>
                <input
                  type="number"
                  min={10}
                  max={100000}
                  value={targetCount}
                  onChange={(e) => setTargetCount(Math.max(10, Number(e.target.value) || 100))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  disabled={isRunning}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Max. Budget ($)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={maxBudgetUsd}
                  onChange={(e) => setMaxBudgetUsd(e.target.value)}
                  placeholder="optional"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  disabled={isRunning}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Max. Dauer (Minuten)
                </label>
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={maxDurationMin}
                  onChange={(e) => setMaxDurationMin(e.target.value)}
                  placeholder="optional"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  disabled={isRunning}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Max. Iterationen
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(e.target.value)}
                  placeholder="default: 10"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                  disabled={isRunning}
                />
              </div>
            </div>

            {/* Sources toggle */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">Datenquellen</label>
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  type="button"
                  onClick={() => setUseMaps(v => !v)}
                  disabled={isRunning}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    useMaps
                      ? "bg-sky-50 border-sky-300 text-sky-700"
                      : "bg-gray-50 border-gray-200 text-gray-400"
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Google Maps / Places
                  <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                    useMaps ? "bg-sky-200 text-sky-800" : "bg-gray-200 text-gray-500"
                  }`}>{useMaps ? "AN" : "AUS"}</span>
                </button>
                <span className="text-[10px] text-gray-400">
                  Immer: 📄 Kataloge · 🔍 Web-Suche
                </span>
              </div>
            </div>

            {/* Extra context input */}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Zusätzliche Hinweise <span className="text-gray-400 font-normal">(optional, z.B. "nur NRW", "Hausbau", "mind. 10 MA")</span>
              </label>
              <input
                value={extraContext}
                onChange={e => setExtraContext(e.target.value)}
                placeholder="Weitere Details oder Einschränkungen für die Suche…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                disabled={running && !TERMINAL_STATUSES.has(run?.status ?? "")}
              />
            </div>

            <button
              onClick={handlePlan}
              disabled={!description.trim() || (running && !TERMINAL_STATUSES.has(run?.status ?? ""))}
              className="w-full bg-rose-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {running && paused ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              {running && paused ? "Plane Suche…" : !description.trim() ? "Beschreibung eingeben…" : "Ziel-Suche planen"}
            </button>
          </div>
        ) : (
          /* ── Progress view ── */
          <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
            {/* Goal header */}
            <div>
              <div className="text-sm font-medium text-gray-800 line-clamp-1">
                &ldquo;{run.goal.description}&rdquo;
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${statusColor(run.status)}`}>
                  {statusLabel(run.status)}
                </span>
                <span className="text-xs text-gray-400">
                  Iteration {run.iteration}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-gray-700">
                  {run.uniqueCount.toLocaleString("de-DE")} / {run.goal.targetCount.toLocaleString("de-DE")}
                </span>
                <span className="text-xs text-gray-400">{progressPct}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-rose-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Plan steps overview */}
            {run.plan && run.plan.steps && run.plan.steps.length > 0 && (
              <div>
                {/* Coverage gap warning */}
                {run.plan.estimatedRows < run.goal.targetCount * 0.6 && (
                  <div className="mb-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                      <span>⚠️</span>
                      <span>Nur ~{run.plan.estimatedRows.toLocaleString("de-DE")} von {run.goal.targetCount.toLocaleString("de-DE")} Ziel-Ergebnissen erreichbar</span>
                    </div>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      Die verfügbaren Quellen reichen für dieses Ziel nicht aus — der Suchbereich ist wahrscheinlich zu eng (einzelne Stadt oder seltene Branche).
                    </p>
                    <p className="text-xs text-amber-800 font-medium">💡 Tipps für mehr Ergebnisse:</p>
                    <ul className="text-xs text-amber-700 pl-3 list-disc space-y-0.5">
                      <li>Region erweitern — z. B. Bundesland statt einzelner Stadt</li>
                      <li>Verwandte Begriffe ergänzen — z. B. „Bauunternehmen" zusätzlich</li>
                      <li>Mehrere Städte angeben — z. B. „Rostock, Schwerin, Greifswald"</li>
                    </ul>
                  </div>
                )}
                <div className="text-xs font-medium text-gray-600 mb-2 flex items-center justify-between">
                  <span>Plan — {run.plan.steps.filter(s => !deletedStepIds.has(s.id)).length} Steps, ~{run.plan.estimatedRows.toLocaleString("de-DE")} geschätzte Treffer</span>
                  {paused && run.stepResults.length === 0 && (
                    <span className="text-[10px] text-gray-400">Klick auf 🗑 zum Entfernen eines Steps</span>
                  )}
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {run.plan.steps.map((s) => {
                    const executed = run.stepResults.find((r) => r.stepId === s.id);
                    const isDone = !!executed;
                    const isError = !!executed?.error;
                    const isSkipped = executed && executed.uniqueInserted === 0;
                    const isDeleted = deletedStepIds.has(s.id);
                    if (isDeleted) return null;
                    const sourceLabel = s.source === "auto" ? "Auto" : s.source ?? "Auto";
                    const sourceBadgeColor = s.type === "google_maps"
                      ? "bg-sky-100 text-sky-700"
                      : s.type.includes("catalog") || s.type === "directory_search"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-violet-100 text-violet-700";
                    return (
                      <div
                        key={s.id}
                        className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
                          isError ? "bg-red-50" : isSkipped ? "bg-gray-50" : isDone ? "bg-emerald-50" : paused ? "bg-gray-50 border border-gray-200" : "bg-violet-50"
                        }`}
                      >
                        {isError ? (
                          <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                        ) : isSkipped ? (
                          <SkipForward className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
                        ) : isDone ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                        ) : (
                          <Circle className="w-3.5 h-3.5 text-violet-300 mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {planStepTypeIcon(s.type)}
                            <span className={`text-xs font-medium uppercase ${isDone ? "text-emerald-600" : "text-violet-600"}`}>
                              {planStepTypeLabel(s.type)}
                            </span>
                            {/* Source badge */}
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${sourceBadgeColor}`}>
                              {sourceLabel}
                            </span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-700 truncate font-medium">{s.label}</span>
                          </div>
                          <div className="text-gray-400 mt-0.5">
                            {editingStep === s.id ? (
                              <div className="flex gap-1 mt-1">
                                <input
                                  value={editValue}
                                  onChange={e => setEditValue(e.target.value)}
                                  className="flex-1 border border-violet-300 rounded px-2 py-0.5 text-xs focus:outline-none"
                                  autoFocus
                                />
                                <button onClick={handleSaveEdit} className="text-emerald-600 hover:text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setEditingStep(null)} className="text-gray-400 hover:text-gray-600">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              s.query || s.mapQuery || s.url
                                ? <span className="truncate block">{s.query || s.mapQuery || s.url}</span>
                                : s.queryTemplate
                                ? (
                                  <span className="truncate block">
                                    {s.queryTemplate}
                                    {s.queries && s.queries.length > 0 && (
                                      <span className="ml-1 text-violet-400">
                                        × {s.queries.length} Städte
                                      </span>
                                    )}
                                  </span>
                                )
                                : <span>—</span>
                            )}
                          </div>
                          {/* Show first few expanded city queries for multi_search */}
                          {s.type === "multi_search" && s.queries && s.queries.length > 0 && (
                            <div className="text-gray-400 mt-0.5 text-[10px] leading-relaxed">
                              {s.queries.slice(0, 5).join(" · ")}
                              {s.queries.length > 5 && <span className="text-gray-300"> +{s.queries.length - 5} weitere</span>}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-gray-400">~{s.estimatedHits} Treffer</span>
                            {executed && (
                              <span className={isError ? "text-red-500" : "text-emerald-600"}>
                                {isError ? `❌ ${executed.error}` : `✓ +${executed.uniqueInserted} neu`}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Delete/Edit actions (only when paused and step not yet executed) */}
                        {paused && !isDone && (
                          <div className="flex gap-1 shrink-0 mt-0.5">
                            <button
                              onClick={() => handleEditStep(s.id, s.query || s.mapQuery || s.queryTemplate || "")}
                              className="text-gray-300 hover:text-violet-500"
                              title="Query bearbeiten"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteStep(s.id)}
                              className="text-gray-300 hover:text-red-500"
                              title="Step entfernen"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Warnings from planner */}
            {run.plan && run.plan.warnings && run.plan.warnings.length > 0 && (
              <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{run.plan.warnings[0]}</span>
              </div>
            )}

            {/* Cost & time */}
            <div className="flex flex-wrap items-center gap-3">
              {run.costUsd > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 rounded px-2 py-1">
                  <DollarSign className="w-3 h-3" /> $ {run.costUsd.toFixed(4)}
                  {run.goal.maxBudgetUsd != null ? ` / $${run.goal.maxBudgetUsd.toFixed(2)}` : ""}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 rounded px-2 py-1">
                <Clock className="w-3 h-3" /> {elapsedMin} min
                {run.goal.maxDurationMin != null ? ` / ${run.goal.maxDurationMin} min` : ""}
              </span>
              <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 rounded px-2 py-1">
                <TrendingUp className="w-3 h-3" /> {run.log[run.log.length - 1] ?? `${run.stepResults.length} Steps ausgeführt`}
              </span>
            </div>

            {/* Recently executed steps */}
            {run.stepResults.length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-600 mb-2">
                  Ausgeführte Steps ({run.stepResults.length})
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {run.stepResults.slice().reverse().map((r, i) => (
                    <div
                      key={r.stepId}
                      className="flex items-start gap-2 text-xs rounded px-2 py-1.5 bg-gray-50"
                    >
                      {stepIcon(r)}
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-700 truncate">
                          Step {r.stepId.replace("step_", "")}
                          {r.error ? `: ${r.error}` : ` · +${r.uniqueInserted} neu von ${r.hitsFound} Treffern`}
                        </div>
                        <div className="text-gray-400">
                          via {r.source} · {new Date(r.attemptedAt).toLocaleTimeString("de-DE")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Log (compact) */}
            {run.log.length > 1 && (
              <div>
                <div className="text-xs font-medium text-gray-600 mb-1">Log</div>
                <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto font-mono">
                  {run.log.slice(-15).map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2 flex-wrap">
              {running && !TERMINAL_STATUSES.has(run.status) ? (
                paused ? (
                  /* PAUSED — show Start + Cancel */
                  <>
                    <button
                      onClick={handleStart}
                      disabled={run.plan?.steps?.filter(s => !deletedStepIds.has(s.id)).length === 0}
                      className="flex-1 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      Starten
                    </button>
                    <button
                      onClick={handleCancel}
                      className="bg-gray-100 text-gray-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center justify-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Verwerfen
                    </button>
                  </>
                ) : (
                  /* RUNNING — show Pause + Stop */
                  <>
                    <button
                      onClick={handlePause}
                      className="flex-1 bg-amber-500 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-600 flex items-center justify-center gap-2"
                    >
                      <Pause className="w-4 h-4" />
                      Pausieren
                    </button>
                    <button
                      onClick={handleCancel}
                      className="bg-gray-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 flex items-center justify-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Stoppen
                    </button>
                  </>
                )
              ) : (
                /* TERMINAL — show Done + New Search */
                <>
                  <button
                    onClick={() => {
                      onImported();
                      onClose();
                    }}
                    className="flex-1 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Fertig · {run.uniqueCount.toLocaleString("de-DE")} Leads
                  </button>
                  <button
                    onClick={handlePlan}
                    disabled={!description.trim()}
                    className="flex-1 bg-rose-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <Target className="w-4 h-4" />
                    Neue Suche
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}