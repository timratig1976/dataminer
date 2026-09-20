import { apiFetch } from "@/api";
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Target, Loader2, CheckCircle2, XCircle, SkipForward, Circle,
  AlertTriangle, TrendingUp, DollarSign, Clock, MapPin,
  Play, Pause, Trash2, Pencil,
} from "lucide-react";
import { useAgentRun, type AgentGoal, type AgentRunState, type AgentRunStatus } from "@/hooks/useAgentRun";
import { Modal, FormField, Input, Callout } from "@/Components/ui/ModalMaster";

interface Props {
  caseId: string;
  rowsCount: number;
  onClose: () => void;
  onImported: () => void;
  embedded?: boolean;
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

// ── Agent run hook — only used when no external state provided ──

export function AgentGoalModal({ caseId, rowsCount, onClose, onImported, externalRun, externalRunning, externalStart, externalStep, externalCancel, externalReload, embedded }: Props) {
  // ── Goal form state ──
  const [description, setDescription] = useState("");
  const [targetCount, setTargetCount] = useState(3000);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState("");
  const [maxDurationMin, setMaxDurationMin] = useState("");
  const [maxIterations, setMaxIterations] = useState("");
  const [useMaps, setUseMaps] = useState(true);
  const [sourceMode, setSourceMode] = useState<"auto" | "maps" | "search" | "combined">("auto");
  const [showCostDetails, setShowCostDetails] = useState(false);

  // ── Sub-industry selection state ──
  type SubSuggestion = { mapQuery: string; label: string; description: string; estimatedSize: string; selected: boolean };
  type SubBranchNode = SubSuggestion & {
    /** Children loaded via drill-down */
    children?: SubBranchNode[];
    /** Whether this node is currently loading children */
    loadingChildren?: boolean;
    /** Whether children are expanded/visible */
    expanded?: boolean;
  };
  const [subIndustryScreen, setSubIndustryScreen] = useState(false);
  const [subIndustryLoading, setSubIndustryLoading] = useState(false);
  const [subSuggestions, setSubSuggestions] = useState<SubBranchNode[]>([]);
  const [subGeography, setSubGeography] = useState<string | undefined>();
  const [subCities, setSubCities] = useState<string[]>([]);
  const [subSelectedCities, setSubSelectedCities] = useState<Set<string>>(new Set());
  const [subCustomCitiesInput, setSubCustomCitiesInput] = useState("");
  const [subCustomInput, setSubCustomInput] = useState("");

  // Drill-down: load sub-branches for a specific branch
  const handleDrillDown = async (path: number[]) => {
    // Mark as loading
    setSubSuggestions(prev => {
      const next = structuredClone(prev) as SubBranchNode[];
      let node: SubBranchNode = next[path[0]];
      for (let i = 1; i < path.length; i++) node = node.children![path[i]];
      if (node.expanded && node.children?.length) { node.expanded = false; return next; }
      node.loadingChildren = true;
      node.expanded = true;
      return next;
    });

    // Find the node label/mapQuery
    let targetNode: SubBranchNode = subSuggestions[path[0]];
    for (let i = 1; i < path.length; i++) targetNode = targetNode.children![path[i]];
    const parentLabel = targetNode.label;
    const parentQuery = targetNode.mapQuery;

    try {
      const res = await apiFetch(`/api/cases/${caseId}/sub-industries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `Sub-Branchen von: ${parentQuery} (Oberbegriff: ${parentLabel})${subGeography ? ` in ${subGeography}` : ""}` }),
      });
      if (res.ok) {
        const analysis = await res.json();
        const children: SubBranchNode[] = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
        setSubSuggestions(prev => {
          const next = structuredClone(prev) as SubBranchNode[];
          let node: SubBranchNode = next[path[0]];
          for (let i = 1; i < path.length; i++) node = node.children![path[i]];
          node.loadingChildren = false;
          node.children = children;
          node.expanded = true;
          return next;
        });
        return;
      }
    } catch { /* ignore */ }

    // On error clear loading
    setSubSuggestions(prev => {
      const next = structuredClone(prev) as SubBranchNode[];
      let node: SubBranchNode = next[path[0]];
      for (let i = 1; i < path.length; i++) node = node.children![path[i]];
      node.loadingChildren = false;
      return next;
    });
  };

  // Toggle selection at a path — deselecting a parent also deselects all children
  const setSelectedRecursive = (node: SubBranchNode, value: boolean) => {
    node.selected = value;
    if (node.children) node.children.forEach(c => setSelectedRecursive(c, value));
  };
  const toggleAtPath = (path: number[]) => {
    setSubSuggestions(prev => {
      const next = structuredClone(prev) as SubBranchNode[];
      let node: SubBranchNode = next[path[0]];
      for (let i = 1; i < path.length; i++) node = node.children![path[i]];
      const newVal = !node.selected;
      setSelectedRecursive(node, newVal);
      return next;
    });
  };

  // Collect all selected nodes (flat, including children)
  const collectSelected = (nodes: SubBranchNode[]): { mapQuery: string; label: string }[] => {
    const result: { mapQuery: string; label: string }[] = [];
    for (const n of nodes) {
      if (n.selected) result.push({ mapQuery: n.mapQuery, label: n.label });
      if (n.children) result.push(...collectSelected(n.children));
    }
    return result;
  };

  // ── Agent run hook — only used when no external state provided ──
  const hasExternal = externalRun !== undefined;
  const internalHook = useAgentRun(hasExternal ? "__disabled__" : caseId);
  const run = hasExternal ? externalRun : internalHook.run;
  const running = externalRunning !== undefined ? externalRunning : internalHook.running;
  const start = externalStart ?? internalHook.start;
  const step = externalStep ?? internalHook.step;
  const cancel = externalCancel ?? internalHook.cancel;
  const reset = internalHook.reset;
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

  // ── Key status check ──
  const [keyStatus, setKeyStatus] = useState<{ anySearchConfigured?: boolean; serperConfigured?: boolean; serpApiConfigured?: boolean; braveConfigured?: boolean; apifyConfigured?: boolean } | null>(null);

  useEffect(() => {
    if (caseId === "__disabled__") return;
    apiFetch(`/api/cases/${caseId}/agent/check-keys`)
      .then(r => r.ok ? r.json() : null)
      .then(data => data ? setKeyStatus(data) : null)
      .catch(() => {});
  }, [caseId]);

  const isRunning = running && run !== null && !TERMINAL_STATUSES.has(run.status) && !paused;
  const reloadRef = useRef(reload);
  useEffect(() => { reloadRef.current = reload; }, [reload]);

  useEffect(() => {
    // Skip internal prefill when page manages the run state
    if (hasExternal) return;
    apiFetch(`/api/cases/${caseId}/agent`)
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

    // Check if the prompt needs sub-industry analysis first
    setSubIndustryLoading(true);
    try {
      const res = await apiFetch(`/api/cases/${caseId}/sub-industries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: description.trim() }),
      });
      if (res.ok) {
        const analysis = await res.json();
        if (analysis.isBroadIndustry && analysis.suggestions?.length > 0) {
          setSubSuggestions(analysis.suggestions);
          setSubGeography(analysis.geography);
          setSubCities(analysis.cities ?? []);
          // Pre-select all cities by default
          setSubSelectedCities(new Set(analysis.cities ?? []));
          setSubCustomCitiesInput("");
          setSubCustomInput("");
          setSubIndustryLoading(false);
          setSubIndustryScreen(true);
          return;
        }
      }
    } catch { /* ignore — proceed without sub-industry screen */ }
    setSubIndustryLoading(false);
    await _startPlan(description.trim());
  };

  const _startPlan = async (finalDescription: string) => {
    importedRef.current = false;
    setPaused(true);
    setDeletedStepIds(new Set());
    const goal: AgentGoal = {
      description: extraContext.trim()
        ? `${finalDescription}\n\nZusätzlicher Kontext: ${extraContext.trim()}`
        : finalDescription,
      targetCount,
    };
    if (maxBudgetUsd.trim()) goal.maxBudgetUsd = Number(maxBudgetUsd);
    if (maxDurationMin.trim()) goal.maxDurationMin = Number(maxDurationMin);
    if (maxIterations.trim()) goal.maxIterations = Number(maxIterations);
    goal.useMaps = sourceMode === "search" ? false : useMaps;
    goal.sourceMode = sourceMode;
    await start(goal);
  };

  const handleSubIndustryConfirm = async () => {
    const selectedNodes = collectSelected(subSuggestions);
    const selected = selectedNodes.map(s => {
      let q = s.mapQuery.trim();
      if (subGeography && q.toLowerCase().includes(subGeography.toLowerCase())) {
        q = q.replace(new RegExp(`\\s*${subGeography}\\s*`, "gi"), "").trim();
      }
      return q;
    }).filter(Boolean);
    const custom = subCustomInput.split(",").map(s => s.trim()).filter(Boolean);
    const allBranches = [...selected, ...custom];
    if (allBranches.length === 0) return;

    // Collect selected cities
    const customCities = subCustomCitiesInput.split(",").map(s => s.trim()).filter(Boolean);
    const allCities = [...subSelectedCities, ...customCities];
    const citiesList = allCities.join(", ");

    const branchList = allBranches.map(b => `"${b}"`).join(", ");
    const finalDescription = citiesList
      ? `Sub-Branchen: ${branchList}. Städte: ${citiesList}. Für jede Branche und jede Stadt separate google_maps Steps erstellen mit mapQuery=Branche und location=Stadt.`
      : `Sub-Branchen: ${branchList}. Für jede Branche in der erkannten Region separate google_maps Steps erstellen. Städte selbst recherchieren und vollständig abdecken.`;
    setSubIndustryScreen(false);
    await _startPlan(finalDescription);
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

  const handleDiscard = async () => {
    // Cancel on server if still active, then close modal
    if (run && !TERMINAL_STATUSES.has(run.status)) {
      await cancel();
    }
    reset();
    setPaused(true);
    setDeletedStepIds(new Set());
    onClose();
  };

  const handleNewSearch = () => {
    // Reset to empty form — user must enter a new description
    reset();
    setDescription("");
    setTargetCount(3000);
    setMaxBudgetUsd("");
    setMaxDurationMin("");
    setMaxIterations("");
    setExtraContext("");
    setPaused(true);
    setDeletedStepIds(new Set());
  };

  // When closing the modal while a plan is shown but not yet started (paused),
  // cancel the run so it doesn't get auto-resumed on next open.
  const handleClose = async () => {
    if (run && !TERMINAL_STATUSES.has(run.status) && paused) {
      await cancel();
      reset();
    }
    onClose();
  };

  const progressPct = run
    ? Math.min(100, Math.round((run.uniqueCount / run.goal.targetCount) * 100))
    : 0;

  const elapsedMin = run
    ? Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60_000)
    : 0;

  const content = (
    <div>
      {!run ? (
        subIndustryScreen ? (
          /* ── Sub-industry selection screen ── */
          <div className="px-6 py-5 flex-1 overflow-y-auto space-y-4">
              <div>
                <div className="text-sm font-semibold text-gray-800 mb-1">
                  🏭 Welche Sub-Branchen sollen gesucht werden?
                </div>
                <div className="text-xs text-gray-500">
                  Dein Begriff umfasst mehrere Branchen. Wähle aus, in welchen{subGeography ? <> in <strong>{subGeography}</strong></> : ""} die KI suchen soll. Klicke auf <span className="font-medium">▶</span> um tiefer in eine Branche einzutauchen.
                </div>
              </div>

              {/* Hierarchical suggestion chips */}
              {(() => {
                type NodeProps = { node: SubBranchNode; path: number[]; depth: number };
                function BranchNode({ node, path, depth }: NodeProps): React.ReactNode {
                  const indentPx = depth * 16;
                  const hasChildren = node.children && node.children.length > 0;
                  const selectedCount = node.children ? collectSelected(node.children).length : 0;
                  return (
                    <div>
                      <div
                        style={{ marginLeft: indentPx }}
                        className={`flex items-center gap-1.5 rounded-xl border-2 px-3 py-2 transition-all ${
                          node.selected
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        {/* Select checkbox area */}
                        <button
                          className="flex-1 text-left flex items-center gap-2 min-w-0 cursor-pointer"
                          onClick={() => toggleAtPath(path)}
                        >
                          <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${
                            node.selected ? "border-emerald-500 bg-emerald-500" : "border-gray-300"
                          }`}>
                            {node.selected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <span className="text-xs font-semibold text-gray-800 truncate">{node.label}</span>
                          {hasChildren && selectedCount > 0 && (
                            <span className="shrink-0 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
                              +{selectedCount}
                            </span>
                          )}
                          <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto ${
                            node.estimatedSize === "groß" ? "bg-emerald-100 text-emerald-700" :
                            node.estimatedSize === "mittel" ? "bg-blue-100 text-blue-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>
                            {node.estimatedSize === "groß" ? "↑↑" : node.estimatedSize === "mittel" ? "↑" : "~"}
                          </span>
                        </button>
                        {/* Drill-down button */}
                        <button
                          title="Sub-Branchen laden"
                          onClick={() => handleDrillDown(path)}
                          className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                            node.expanded
                              ? "bg-violet-100 text-violet-600"
                              : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          }`}
                        >
                          {node.loadingChildren
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : node.expanded && hasChildren
                            ? <span className="text-[10px] font-bold">▼</span>
                            : <span className="text-[10px] font-bold">▶</span>
                          }
                        </button>
                      </div>
                      {/* Children */}
                      {node.expanded && hasChildren && (
                        <div className="mt-1 space-y-1">
                          {node.children!.map((child, ci) => (
                            <BranchNode key={ci} node={child} path={[...path, ci]} depth={depth + 1} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="space-y-1.5">
                    {subSuggestions.map((s, i) => (
                      <BranchNode key={i} node={s} path={[i]} depth={0} />
                    ))}
                  </div>
                );
              })()}

              {/* Select all / none */}
              <div className="flex gap-2 items-center">
                <button onClick={() => setSubSuggestions(p => p.map(s => ({ ...s, selected: true })))}
                  className="text-xs text-gray-500 hover:text-gray-700 underline cursor-pointer">Alle auswählen</button>
                <span className="text-gray-300">·</span>
                <button onClick={() => setSubSuggestions(p => p.map(s => ({ ...s, selected: false })))}
                  className="text-xs text-gray-500 hover:text-gray-700 underline cursor-pointer">Keine</button>
                <span className="text-gray-400 ml-auto text-xs">
                  {collectSelected(subSuggestions).length} ausgewählt
                </span>
              </div>

              {/* Custom addition */}
              <FormField label="Eigene Branchen ergänzen" hint="(kommagetrennt)">
                <Input
                  value={subCustomInput}
                  onChange={e => setSubCustomInput(e.target.value)}
                  placeholder="z.B. Schreinerei, Glaserei, Dachdeckerei"
                />
              </FormField>

              {/* City selection */}
              {subCities.length > 0 && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <label className="text-xs font-semibold text-[var(--text-1)] mb-2 block">
                    🏙️ Städte ({subSelectedCities.size}/{subCities.length} ausgewählt)
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto mb-2">
                    {subCities.map(city => {
                      const isSelected = subSelectedCities.has(city);
                      return (
                        <button
                          key={city}
                          type="button"
                          onClick={() => {
                            setSubSelectedCities(prev => {
                              const next = new Set(prev);
                              isSelected ? next.delete(city) : next.add(city);
                              return next;
                            });
                          }}
                          className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-[var(--orange)] text-white border-[var(--orange)]"
                              : "bg-[var(--surface)] text-[var(--text-2)] border-[var(--border)] hover:border-[var(--orange-mid)]"
                          }`}
                        >
                          {city}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setSubSelectedCities(new Set(subCities))}
                      className="text-xs text-[var(--orange)] hover:underline cursor-pointer">Alle</button>
                    <span className="text-gray-300">·</span>
                    <button onClick={() => setSubSelectedCities(new Set())}
                      className="text-xs text-gray-400 hover:text-gray-600 underline cursor-pointer">Keine</button>
                  </div>
                </div>
              )}

              {/* Custom cities */}
              <FormField label="Weitere Städte ergänzen" hint="(kommagetrennt)">
                <Input
                  value={subCustomCitiesInput}
                  onChange={e => setSubCustomCitiesInput(e.target.value)}
                  placeholder="z.B. Bad Doberan, Teterow, Grimmen"
                />
              </FormField>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSubIndustryScreen(false)}
                  className="btn-v2"
                >
                  ← Zurück
                </button>
                <button
                  type="button"
                  onClick={handleSubIndustryConfirm}
                  disabled={collectSelected(subSuggestions).length === 0 && !subCustomInput.trim()}
                  className="btn-v2 btn-v2-primary flex-1 justify-center py-2"
                >
                  <Target className="w-4 h-4" />
                  Plan erstellen ({collectSelected(subSuggestions).length + subCustomInput.split(",").filter(s => s.trim()).length} Branchen)
                </button>
              </div>
            </div>
          ) : (
          /* ── Goal form ── */
          <div className="px-6 py-5 space-y-4 flex-1">
            <p className="text-sm text-[var(--text-2)]">
              Beschreibe, welche Unternehmen du finden möchtest. Die KI plant und führt die Suche automatisch
              in mehreren Runden aus, bis das Ziel erreicht ist.
            </p>

            {/* Key status warning */}
            {keyStatus && !keyStatus.anySearchConfigured && (
              <Callout
                type="warn"
                title="Keine Such-API-Keys konfiguriert"
                action={<a href="/settings" className="underline font-medium" target="_blank">→ Globale Einstellungen öffnen</a>}
              >
                Die Ziel-Suche braucht mindestens einen Web-Search-Key (Serper, SerpApi oder Brave).
              </Callout>
            )}

            {error && (
              <Callout type="error" title="Fehler aufgetreten">
                {error}
              </Callout>
            )}

            <FormField
              label="Was suchst du?"
              error={description.length > 0 && !description.trim() ? "Bitte eine Beschreibung eingeben" : undefined}
            >
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && description.trim() && handleStart()}
                placeholder="z.B. Handwerksbetriebe Heizung/Sanitär in NRW"
                disabled={isRunning}
                autoFocus
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Zielanzahl">
                <Input
                  type="number"
                  min={10}
                  max={100000}
                  value={targetCount}
                  onChange={(e) => setTargetCount(Math.max(10, Number(e.target.value) || 100))}
                  disabled={isRunning}
                />
              </FormField>
              <FormField label="Max. Budget ($)">
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={maxBudgetUsd}
                  onChange={(e) => setMaxBudgetUsd(e.target.value)}
                  placeholder="optional"
                  disabled={isRunning}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Max. Dauer (Minuten)">
                <Input
                  type="number"
                  min={1}
                  max={480}
                  value={maxDurationMin}
                  onChange={(e) => setMaxDurationMin(e.target.value)}
                  placeholder="optional"
                  disabled={isRunning}
                />
              </FormField>
              <FormField label="Max. Iterationen">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(e.target.value)}
                  placeholder="default: 10"
                  disabled={isRunning}
                />
              </FormField>
            </div>

            {/* Sources selector */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Such-Quelle
              </div>
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
                    onClick={() => {
                      setSourceMode(opt.id);
                      if (opt.id === "search") setUseMaps(false);
                      else setUseMaps(true);
                    }}
                    disabled={isRunning}
                    className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-all ${
                      sourceMode === opt.id
                        ? "border-[var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)] shadow-sm font-semibold"
                        : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--orange-mid)] hover:bg-[var(--bg)]"
                    }`}
                    title={opt.desc}
                  >
                    <span className="font-semibold text-sm">{opt.label}</span>
                    <span className="opacity-75 text-[11px]">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Cost estimate — compact chip with tooltip ── */}
            {(() => {
              const n = targetCount;
              const discovery = n * 0.003;
              const enrich    = n * 0.00036;
              const contacts  = n * 0.00113;
              const maps      = (sourceMode !== "search" && useMaps) ? n * 0.002 : 0;
              const total     = discovery + enrich + contacts + maps;
              const totalEur  = total * 0.91;
              const fmtU = (v: number) => v < 0.01 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(1);
              const fmtE = (v: number) => (v < 0.01 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(1)).replace(".", ",");
              return (
                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-2)" }}>Geschätzte Kosten:</span>
                  <button
                    type="button"
                    onClick={() => setShowCostDetails(v => !v)}
                    style={{ fontSize: 12, fontWeight: 700, color: "var(--orange)", background: showCostDetails ? "var(--orange-mid)" : "var(--orange-soft)", border: "1px solid var(--orange-mid)", padding: "2px 10px", borderRadius: 99, fontFamily: "monospace", cursor: "pointer" }}
                  >
                    ~€{fmtE(totalEur)} <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
                  </button>
                  {showCostDetails && (
                    <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--shadow)", zIndex: 999, minWidth: 230, padding: "12px 14px" }}
                      onMouseLeave={() => setShowCostDetails(false)}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Kosten für {n.toLocaleString("de-DE")} Firmen</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "5px 16px", fontSize: 12 }}>
                        <span style={{ color: "var(--text-2)" }}>🔍 Discovery</span>
                        <span style={{ fontWeight: 600, fontFamily: "monospace", textAlign: "right" }}>${fmtU(discovery)}</span>
                        {sourceMode !== "search" && useMaps && <><span style={{ color: "var(--text-2)" }}>📍 Google Maps</span><span style={{ fontWeight: 600, fontFamily: "monospace", textAlign: "right" }}>${fmtU(maps)}</span></>}
                        <span style={{ color: "var(--text-2)" }}>🏢 Firmen-LLM</span>
                        <span style={{ fontWeight: 600, fontFamily: "monospace", textAlign: "right" }}>${fmtU(enrich)}</span>
                        <span style={{ color: "var(--text-2)" }}>👤 Entscheider-LLM</span>
                        <span style={{ fontWeight: 600, fontFamily: "monospace", textAlign: "right" }}>${fmtU(contacts)}</span>
                      </div>
                      <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>gpt-4o-mini · Ø echte Runs</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: "var(--orange)" }}>~${fmtU(total)}</span>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 12, color: "var(--orange)", background: "var(--orange-soft)", padding: "0 6px", borderRadius: 4 }}>~€{fmtE(totalEur)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Extra context input */}
            <FormField label="Zusätzliche Hinweise" hint="(optional, z.B. &quot;nur NRW&quot;, &quot;Hausbau&quot;, &quot;mind. 10 MA&quot;)">
              <Input
                value={extraContext}
                onChange={e => setExtraContext(e.target.value)}
                placeholder="Weitere Details oder Einschränkungen für die Suche…"
                disabled={isRunning}
              />
            </FormField>

            <button
              type="button"
              onClick={handlePlan}
              disabled={!description.trim() || subIndustryLoading || isRunning || Boolean(keyStatus && !keyStatus.anySearchConfigured)}
              className="btn-v2 btn-v2-primary w-full py-2.5 justify-center text-sm font-medium"
            >
              {subIndustryLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : running && paused ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              {subIndustryLoading ? "Analysiere Branche…" : running && paused ? "Plane Suche…" : !description.trim() ? "Beschreibung eingeben…" : keyStatus && !keyStatus.anySearchConfigured ? "Keine Such-API-Keys konfiguriert" : "Ziel-Suche planen"}
            </button>
          </div>
          ) /* end sub-industry / form ternary */
        ) : (
          /* ── Progress view ── */
          <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
            {/* Goal header — compact single row */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
              {/* Row 1: Ziel + Status */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900 truncate flex-1 min-w-0">
                  {run.goal.description}
                </span>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 shrink-0 ${statusColor(run.status)}`}>
                  {statusLabel(run.status)}
                </span>
                {run.iteration > 0 && (
                  <span className="text-xs text-gray-400 shrink-0">Iteration {run.iteration}</span>
                )}
              </div>
              {/* Row 2: Progress */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">
                    <span className="font-bold text-gray-800 text-sm">{run.uniqueCount.toLocaleString("de-DE")}</span>
                    <span className="text-gray-400"> / {run.goal.targetCount.toLocaleString("de-DE")} Leads</span>
                  </span>
                  <span className="text-xs font-medium text-gray-500">{progressPct}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${TERMINAL_STATUSES.has(run.status) && run.uniqueCount > 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Plan steps overview */}
            {run.plan && run.plan.steps && run.plan.steps.length > 0 && (
              <div>
                {/* Coverage gap warning — compact single line */}
                {run.plan.estimatedRows < run.goal.targetCount * 0.6 && (
                  <div className="mb-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold">Nur ~{run.plan.estimatedRows.toLocaleString("de-DE")} von {run.goal.targetCount.toLocaleString("de-DE")} erreichbar. </span>
                      <span className="text-amber-600">Suchbereich zu eng — Region erweitern oder verwandte Begriffe ergänzen.</span>
                    </div>
                  </div>
                )}
                <div className="text-xs font-medium text-gray-600 mb-1.5 flex items-center justify-between">
                  <span>Plan — {run.plan.steps.filter(s => !deletedStepIds.has(s.id)).length} Steps, ~{run.plan.estimatedRows.toLocaleString("de-DE")} geschätzte Treffer</span>
                  {paused && run.stepResults.length === 0 && (
                    <span className="text-[10px] text-gray-400">Klick auf 🗑 zum Entfernen</span>
                  )}
                </div>
                <div className="space-y-0.5 max-h-56 overflow-y-auto">
                  {run.plan.steps.map((s) => {
                    const executed = run.stepResults.find((r) => r.stepId === s.id);
                    const isDone = !!executed;
                    const isError = !!executed?.error;
                    const isSkipped = executed && executed.uniqueInserted === 0;
                    const isDeleted = deletedStepIds.has(s.id);
                    if (isDeleted) return null;
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
                          isError ? "bg-red-50" : isSkipped ? "bg-gray-50" : isDone ? "bg-emerald-50" : "bg-gray-50"
                        }`}
                        title={`${s.type === "google_maps" ? `${s.mapQuery} in ${s.location}` : s.query ?? s.url ?? s.label} · ~${s.estimatedHits} Treffer · Quelle: ${s.source ?? "auto"}`}
                      >
                        {isError ? (
                          <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                        ) : isSkipped ? (
                          <SkipForward className="w-3 h-3 text-gray-300 shrink-0" />
                        ) : isDone ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        ) : (
                          <Circle className="w-3 h-3 text-gray-300 shrink-0" />
                        )}
                        <span className={`text-[10px] font-semibold uppercase shrink-0 ${isDone ? "text-emerald-600" : s.type === "google_maps" ? "text-sky-600" : s.type.includes("catalog") ? "text-amber-600" : "text-gray-500"}`}>
                          {s.type === "google_maps" ? "MAPS" : s.type === "google_search" ? "WEB" : s.type.includes("catalog") ? "KAT" : "SRC"}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-gray-700">
                          {s.mapQuery && s.location
                            ? `${s.mapQuery} · ${s.location}`
                            : s.mapQuery || s.query || s.url || s.label}
                        </span>
                        {s.queries && s.queries.length > 0 && (
                          <span className="text-gray-400 shrink-0 text-[10px]">×{s.queries.length} Städte</span>
                        )}
                        <span className="text-gray-400 shrink-0 text-[10px]">~{s.estimatedHits}</span>
                        {executed && (
                          <span className={`shrink-0 text-[10px] ${isError ? "text-red-500" : "text-emerald-600"}`}>
                            {isError ? "❌" : `+${executed.uniqueInserted}`}
                          </span>
                        )}
                        {/* Delete/Edit actions (only when paused and step not yet executed) */}
                        {paused && !isDone && (
                          <div className="flex gap-0.5 shrink-0">
                            <button
                              onClick={() => handleEditStep(s.id, s.query || s.mapQuery || s.queryTemplate || "")}
                              className="text-gray-300 hover:text-gray-600"
                              title="Query bearbeiten"
                            >
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteStep(s.id)}
                              className="text-gray-300 hover:text-red-400"
                              title="Step entfernen"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
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
                      className="btn-v2 btn-v2-primary flex-1 py-2 text-sm font-medium disabled:opacity-40 justify-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      Starten
                    </button>
                    <button
                      onClick={handleDiscard}
                      className="btn-v2 py-2 text-sm font-medium justify-center gap-2"
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
                      className="btn-v2 flex-1 py-2 text-sm font-medium justify-center gap-2"
                      style={{ background: "var(--warn-soft)", borderColor: "var(--warn)", color: "var(--warn)" }}
                    >
                      <Pause className="w-4 h-4" />
                      Pausieren
                    </button>
                    <button
                      onClick={handleCancel}
                      className="btn-v2 py-2 text-sm font-medium justify-center gap-2"
                    >
                      <XCircle className="w-4 h-4" />
                      Stoppen
                    </button>
                  </>
                )
              ) : (
                /* TERMINAL — show Done + Resume + New Search */
                <>
                  <button
                    onClick={() => {
                      onImported();
                      onClose();
                    }}
                    className="btn-v2 btn-v2-primary flex-1 py-2 text-sm font-medium justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {run.uniqueCount > 0
                      ? `Fertig · ${run.uniqueCount.toLocaleString("de-DE")} neue Leads`
                      : "Schließen"}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/api/cases/${caseId}/agent/${run.id}`, { method: "PATCH" });
                        if (res.ok) {
                          setPaused(false);
                        }
                      } catch { /* ignore */ }
                    }}
                    className="btn-v2 py-2 text-sm font-medium justify-center gap-2"
                    style={{ background: "var(--orange-soft)", borderColor: "var(--orange-mid)", color: "var(--orange)" }}
                    title="Existierenden Plan fortsetzen — fehlgeschlagene Steps wiederholen"
                  >
                    <Play className="w-4 h-4" />
                    Fortsetzen
                  </button>
                  <button
                    onClick={handleNewSearch}
                    className="btn-v2 flex-1 py-2 text-sm font-medium justify-center gap-2"
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
  );

  if (embedded) {
    return content;
  }

  return (
    <Modal
      onClose={handleClose}
      title="Ziel-basierte Suche"
      icon={<Target className="w-4 h-4" />}
      maxWidth="42rem"
    >
      {content}
    </Modal>
  );
}