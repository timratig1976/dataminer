"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  X, Target, Loader2, CheckCircle2, XCircle, SkipForward,
  AlertTriangle, TrendingUp, DollarSign, Clock,
} from "lucide-react";
import { useAgentRun, type AgentGoal, type AgentRunState } from "@/hooks/useAgentRun";

interface Props {
  caseId: string;
  rowsCount: number;
  onClose: () => void;
  onImported: () => void;
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

export function AgentGoalModal({ caseId, rowsCount, onClose, onImported }: Props) {
  // ── Goal form state ──
  const [description, setDescription] = useState("");
  const [targetCount, setTargetCount] = useState(3000);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState("");
  const [maxDurationMin, setMaxDurationMin] = useState("");
  const [maxIterations, setMaxIterations] = useState("");

  // ── Agent run hook ──
  const { run, running, error, start, step, cancel, reload } = useAgentRun(caseId);
  const stepLoopRef = useRef(false);
  const importedRef = useRef(false);

  const isRunning = running && run !== null && !TERMINAL_STATUSES.has(run.status);
  useEffect(() => {
    fetch(`/api/cases/${caseId}/agent`)
      .then((r) => r.json())
      .then((runs) => {
        if (Array.isArray(runs) && runs.length > 0) {
          const active = runs.find((r: { status: string }) => !TERMINAL_STATUSES.has(r.status));
          if (active) {
            reload(active.id);
          }
        }
      })
      .catch(() => {});
  }, [caseId, reload]);

  // Step loop: call step() repeatedly while run is not terminal
  useEffect(() => {
    if (!running || !run || TERMINAL_STATUSES.has(run.status)) {
      stepLoopRef.current = false;
      return;
    }
    // Guard: only one concurrent loop per mount (important for React Strict Mode double-invoke)
    if (stepLoopRef.current) return;
    stepLoopRef.current = true;

    let active = true;
    const loopRun = run; // capture snapshot so effect cleanup matches
    async function loop() {
      while (active && stepLoopRef.current) {
        const state = await step();
        if (!active) break; // effect was cleaned up during await
        // Trigger row refresh when any rows are added
        if (!importedRef.current && state && state.uniqueCount > 0) {
          importedRef.current = true;
          onImported();
        }
        if (!state || TERMINAL_STATUSES.has(state.status)) {
          stepLoopRef.current = false;
          if (state) onImported();
          return;
        }
        // Polite pause between steps
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    loop();

    return () => {
      active = false;
      stepLoopRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]); // only re-run when running toggles, not on every state update

  const handleStart = async () => {
    if (!description.trim()) return;
    importedRef.current = false;
    const goal: AgentGoal = {
      description: description.trim(),
      targetCount,
    };
    if (maxBudgetUsd.trim()) goal.maxBudgetUsd = Number(maxBudgetUsd);
    if (maxDurationMin.trim()) goal.maxDurationMin = Number(maxDurationMin);
    if (maxIterations.trim()) goal.maxIterations = Number(maxIterations);
    await start(goal);
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

            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Was suchst du?
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStart()}
                placeholder="z.B. Handwerksbetriebe Heizung/Sanitär in NRW"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
                disabled={isRunning}
                autoFocus
              />
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

            <button
              onClick={handleStart}
              disabled={!description.trim() || isRunning}
              className="w-full bg-rose-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-rose-700 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Target className="w-4 h-4" />
              Ziel-Suche starten
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
            <div className="flex gap-2 pt-2">
              {isRunning ? (
                <button
                  onClick={handleCancel}
                  className="flex-1 bg-gray-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 flex items-center justify-center gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  Abbrechen
                </button>
              ) : (
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
                    onClick={handleStart}
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