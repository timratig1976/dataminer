"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Play, Upload, Trash2, Settings, Save, Sparkles,
  Loader2, CheckCircle2, XCircle, SkipForward, Zap,
  Download, ScrollText, ChevronLeft, ChevronRight, GripVertical,
  Database, Info, CheckCircle, AlertCircle
} from "lucide-react";
import type { Case, RowData, AiColumn, CellStatus } from "@/lib/types";
import { AddColumnModal } from "@/components/AddColumnModal";
import { ImportModal } from "@/components/ImportModal";
import { ColumnHeaderMenu } from "@/components/ColumnHeaderMenu";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";

// ── Run Detail Modal ──────────────────────────────────────────────────────────
function RunDetailModal({ col, row: initialRow, caseId, onClose, onRowUpdate }: {
  col: AiColumn;
  row: RowData;
  caseId: string;
  onClose: () => void;
  onRowUpdate: (rowId: string, patch: Partial<RowData>) => void;
}) {
  const [row, setRow] = useState(initialRow);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string|null>(null);
  const [compareModels, setCompareModels] = useState<string[]>([col.model || "gpt-4o-mini"]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<Array<{ model: string; provider: "openai" | "cerebras" | "anthropic"; ok: boolean; score: number; latencyMs: number; value: string; validation: "pass" | "fail"; validationReason: string; error?: string }>>([]);
  const [recommendedModel, setRecommendedModel] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([...DEFAULT_MODEL_OPTIONS]);
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [smokeResults, setSmokeResults] = useState<Array<{ model: string; provider: "openai" | "cerebras" | "anthropic"; ok: boolean; latencyMs: number; preview?: string; error?: string }>>([]);

  const multiKeys = col.multiKeys ?? [];
  const extraOutputKeys = col.validateDomain
    ? [...multiKeys.map(mk => mk.outputKey), "domain_validated"]
    : multiKeys.map(mk => mk.outputKey);
  const allOutputKeys = extraOutputKeys.length > 0 ? extraOutputKeys : [col.outputKey];

  const savedStatus = row.cellStatuses[col.outputKey] ?? "idle";
  const err = row.cellErrors[col.outputKey];
  // All meta stored in row data with _ prefix
  const rawResponse   = row.data[`_llm_raw_${col.outputKey}`] ?? "";
  const exactPrompt   = row.data[`_llm_prompt_${col.outputKey}`] ?? "";
  const tokensRaw     = row.data[`_llm_tokens_${col.outputKey}`] ?? "";
  const costRaw       = row.data[`_llm_cost_${col.outputKey}`] ?? "";
  const tokens        = tokensRaw ? (() => { try { return JSON.parse(tokensRaw); } catch { return null; } })() : null;
  const costUsd       = costRaw ? parseFloat(costRaw) : null;
  const companyName   = row.data["company_name"] ?? row.data["Unternehmensname"] ?? row.data["Name"] ?? "";
  const requiredFields = col.requiredFields ?? [];
  const inputMappings = col.inputMappings ?? {};
  const placeholderKeys = Array.from(new Set(
    (col.prompt.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) ?? [])
      .map(m => m.slice(1, -1).trim())
  ));

  // Fallback rendered prompt (before first run)
  const previewPrompt = col.prompt.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    const sourceKey = inputMappings[key] || key;
    const v = row.data[sourceKey];
    return (v != null && String(v).trim() !== "") ? String(v) : `{${key}}`;
  });

  useEffect(() => {
    fetch(`/api/llm/models?caseId=${caseId}`)
      .then((r) => r.json())
      .then((data) => {
        const next = Array.isArray(data?.models) ? data.models : [];
        setModelOptions(mergeModelOptions(next));
      })
      .catch(() => {
        setModelOptions([...DEFAULT_MODEL_OPTIONS]);
      });
  }, [caseId]);

  async function handleRun() {
    if (running) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/run/cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, rowId: row.id, columnId: col.id }),
      });
      const result = await res.json();
      if (result.error || !res.ok) { setRunError(result.error ?? "Unbekannter Fehler"); return; }
      const extraData   = result.multiValues ?? {};
      const metaData: Record<string,string> = {};
      if (result.rawResponse)   metaData[`_llm_raw_${col.outputKey}`]    = result.rawResponse;
      if (result.renderedPrompt) metaData[`_llm_prompt_${col.outputKey}`] = result.renderedPrompt;
      if (result.tokens)        metaData[`_llm_tokens_${col.outputKey}`]  = JSON.stringify(result.tokens);
      if (result.costUsd != null) metaData[`_llm_cost_${col.outputKey}`] = String(result.costUsd);
      const newData     = { ...row.data, [col.outputKey]: result.value ?? "", ...extraData, ...metaData };
      const newStatuses = { ...row.cellStatuses, [col.outputKey]: "done" as CellStatus };
      for (const k of Object.keys(extraData)) newStatuses[k] = "done";
      const updated = { ...row, data: newData, cellStatuses: newStatuses };
      setRow(updated);
      onRowUpdate(row.id, { data: newData, cellStatuses: newStatuses });
    } catch (e: any) {
      setRunError(e.message ?? "Netzwerkfehler");
    } finally {
      setRunning(false);
    }
  }

  async function runSmokeTest() {
    if (compareModels.length === 0) return;
    setSmokeLoading(true);
    setSmokeError(null);
    setSmokeResults([]);
    try {
      const res = await fetch("/api/llm/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          models: compareModels,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSmokeError(data.error ?? "Smoke test failed");
        return;
      }
      setSmokeResults(Array.isArray(data.results) ? data.results : []);
    } catch (error: unknown) {
      setSmokeError(error instanceof Error ? error.message : String(error));
    } finally {
      setSmokeLoading(false);
    }
  }

  function toggleCompareModel(model: string) {
    setCompareModels((prev) => {
      if (prev.includes(model)) return prev.filter((m) => m !== model);
      if (prev.length >= 3) return prev;
      return [...prev, model];
    });
  }

  async function runModelCompare() {
    if (compareModels.length === 0) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareResults([]);
    setRecommendedModel(null);
    try {
      const res = await fetch("/api/llm/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          rowId: row.id,
          column: col,
          models: compareModels,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompareError(data.error ?? "Model comparison failed");
        return;
      }
      const results = Array.isArray(data.results) ? data.results : [];
      setCompareResults(results);
      if (typeof data.recommendedModel === "string") {
        setRecommendedModel(data.recommendedModel);
      }
    } catch (error: unknown) {
      setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      setCompareLoading(false);
    }
  }

  const box: React.CSSProperties = { border:"1px solid #e2e8f0", borderRadius:8, overflow:"hidden" };
  const boxHdr: React.CSSProperties = { fontSize:10, fontWeight:700, color:"#64748b", padding:"6px 14px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0", textTransform:"uppercase", letterSpacing:"0.07em" };
  const pre: React.CSSProperties = { margin:0, padding:"11px 14px", fontSize:11, whiteSpace:"pre-wrap", wordBreak:"break-all", lineHeight:1.7, fontFamily:"monospace", maxHeight:220, overflowY:"auto" };

  const hasRun = savedStatus === "done" || savedStatus === "error";

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#fff",borderRadius:12,width:"min(760px,96vw)",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 28px 80px rgba(0,0,0,0.28)"}}>

        {/* Header */}
        <div style={{padding:"13px 18px",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <Sparkles style={{width:14,height:14,color:"#16a34a",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <span style={{fontWeight:700,fontSize:13,color:"#111"}}>{col.name}</span>
            {companyName && <span style={{fontSize:12,color:"#9ca3af",marginLeft:8}}>— {companyName}</span>}
            <span style={{fontSize:11,color:"#d1d5db",marginLeft:8}}>{col.model ?? "gpt-4o-mini"}</span>
          </div>
          <button onClick={handleRun} disabled={running}
            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 14px",background:running?"#86efac":"#16a34a",color:"#fff",border:"none",borderRadius:6,cursor:running?"not-allowed":"pointer",fontSize:12,fontWeight:600,flexShrink:0}}>
            {running ? <Loader2 style={{width:11,height:11}} className="animate-spin"/> : <Play style={{width:11,height:11}}/>}
            {running ? "Läuft…" : "Ausführen"}
          </button>
          <button onClick={runModelCompare} disabled={compareLoading || compareModels.length === 0}
            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",background:compareLoading?"#93c5fd":"#2563eb",color:"#fff",border:"none",borderRadius:6,cursor:compareLoading?"not-allowed":"pointer",fontSize:12,fontWeight:600,flexShrink:0}}>
            {compareLoading ? <Loader2 style={{width:11,height:11}} className="animate-spin"/> : <Zap style={{width:11,height:11}}/>}
            {compareLoading ? "Teste…" : "3 Modelle testen"}
          </button>
          <button onClick={runSmokeTest} disabled={smokeLoading || compareModels.length === 0}
            style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",background:smokeLoading?"#c4b5fd":"#7c3aed",color:"#fff",border:"none",borderRadius:6,cursor:smokeLoading?"not-allowed":"pointer",fontSize:12,fontWeight:600,flexShrink:0}}>
            {smokeLoading ? <Loader2 style={{width:11,height:11}} className="animate-spin"/> : <CheckCircle2 style={{width:11,height:11}}/>}
            {smokeLoading ? "Smoke…" : "Smoke Test"}
          </button>
          <button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",fontSize:20,color:"#9ca3af",lineHeight:1,padding:"0 4px"}}>×</button>
        </div>

        <div style={{overflowY:"auto",padding:"14px 18px",display:"flex",flexDirection:"column",gap:10}}>

          {/* Status row */}
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {running && <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,color:"#d97706",background:"#fef3c7",padding:"3px 10px",borderRadius:10,fontWeight:600}}><Loader2 style={{width:10,height:10}} className="animate-spin"/> Läuft…</span>}
            {!running && savedStatus==="done"    && <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,color:"#059669",background:"#d1fae5",padding:"3px 10px",borderRadius:10,fontWeight:600}}><CheckCircle style={{width:10,height:10}}/> Fertig</span>}
            {!running && savedStatus==="error"   && <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,color:"#dc2626",background:"#fef2f2",padding:"3px 10px",borderRadius:10,fontWeight:600}}><AlertCircle style={{width:10,height:10}}/> Fehler</span>}
            {!running && savedStatus==="idle"    && <span style={{fontSize:12,color:"#9ca3af"}}>○ Noch nicht ausgeführt</span>}
            {!running && savedStatus==="skipped" && <span style={{fontSize:12,color:"#9ca3af",background:"#f3f4f6",padding:"3px 10px",borderRadius:10}}>⏭ Übersprungen</span>}
            {/* tokens + cost badges */}
            {tokens && <>
              <span style={{fontSize:11,color:"#6366f1",background:"#eef2ff",padding:"2px 8px",borderRadius:8,fontFamily:"monospace"}}>↑{tokens.prompt} ↓{tokens.completion} = {tokens.total} tok</span>
              {costUsd != null && <span style={{fontSize:11,color:"#0369a1",background:"#e0f2fe",padding:"2px 8px",borderRadius:8,fontFamily:"monospace"}}>${costUsd.toFixed(5)}</span>}
            </>}
            {runError && <span style={{fontSize:12,color:"#dc2626"}}>{runError}</span>}
          </div>

          <div style={{border:"1px solid #dbeafe",background:"#f8fbff",borderRadius:8,padding:10,display:"grid",gap:8}}>
            <div style={{fontSize:11,fontWeight:600,color:"#1e3a8a",textTransform:"uppercase",letterSpacing:"0.05em"}}>Model Compare</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {mergeModelOptions(compareModels, modelOptions).map((m) => {
                const selected = compareModels.includes(m);
                const disabled = !selected && compareModels.length >= 3;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleCompareModel(m)}
                    disabled={disabled}
                    style={{
                      fontSize:11,
                      padding:"3px 8px",
                      borderRadius:999,
                      border:"1px solid",
                      cursor:disabled?"not-allowed":"pointer",
                      opacity:disabled?0.5:1,
                      fontFamily:"monospace",
                      background:selected?"#dbeafe":"#fff",
                      borderColor:selected?"#93c5fd":"#d1d5db",
                      color:selected?"#1d4ed8":"#374151",
                    }}
                  >
                    {selected ? "✓ " : ""}{m}
                  </button>
                );
              })}
            </div>
            {compareError && <div style={{fontSize:12,color:"#dc2626"}}>{compareError}</div>}
            {recommendedModel && (
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#065f46",background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:6,padding:"6px 8px"}}>
                <span>Empfohlen: <strong style={{fontFamily:"monospace"}}>{recommendedModel}</strong></span>
              </div>
            )}
            {compareResults.length > 0 && !recommendedModel && (
              <div style={{fontSize:12,color:"#92400e",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"6px 8px"}}>
                Kein Modell hat die automatische Validierung bestanden.
              </div>
            )}
            {compareResults.length > 0 && (
              <div style={{display:"grid",gap:6}}>
                {compareResults.map((r) => (
                  <div key={r.model} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"7px 8px",background:"#fff"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#6b7280"}}>
                      <span style={{fontFamily:"monospace",fontWeight:600,color:"#111827"}}>{r.model}</span>
                      <span>· {r.provider}</span>
                      <span>· score {r.score}</span>
                      <span>· {r.validation}</span>
                      <span>· {r.latencyMs}ms</span>
                      <span style={{marginLeft:"auto",color:r.ok?"#059669":"#dc2626",fontWeight:600}}>{r.ok ? "OK" : "FAIL"}</span>
                    </div>
                    <div style={{fontSize:11,color:r.validation==="pass"?"#166534":"#b45309",marginTop:3}}>Validation: {r.validationReason}</div>
                    <div style={{fontSize:12,color:r.ok?"#1f2937":"#991b1b",marginTop:4,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{r.ok ? (r.value || "(empty)") : (r.error || r.validationReason || "Unknown error")}</div>
                  </div>
                ))}
              </div>
            )}
            {(smokeError || smokeResults.length > 0) && (
              <div style={{marginTop:6,borderTop:"1px dashed #bfdbfe",paddingTop:8,display:"grid",gap:6}}>
                <div style={{fontSize:11,fontWeight:600,color:"#4c1d95",textTransform:"uppercase",letterSpacing:"0.05em"}}>Smoke Results</div>
                {smokeError && <div style={{fontSize:12,color:"#dc2626"}}>{smokeError}</div>}
                {smokeResults.map((r) => (
                  <div key={`smoke-${r.model}`} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:"6px 8px"}}>
                    <span style={{fontFamily:"monospace",fontWeight:600,color:"#111827"}}>{r.model}</span>
                    <span style={{color:"#6b7280"}}>· {r.provider}</span>
                    <span style={{color:"#6b7280"}}>· {r.latencyMs}ms</span>
                    <span style={{marginLeft:"auto",color:r.ok?"#059669":"#dc2626",fontWeight:700}}>{r.ok ? "PASS" : "FAIL"}</span>
                    <span style={{color:r.ok?"#166534":"#991b1b"}}>{r.ok ? (r.preview || "ok") : (r.error || "error")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Output fields */}
          {(hasRun || running) && (
            <div style={box}>
              <div style={boxHdr}>Output</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <tbody>
                  {allOutputKeys.map(k => {
                    const v = row.data[k] ?? "";
                    const isValid = v.startsWith("✓"), isInvalid = v.startsWith("✗");
                    return (
                      <tr key={k} style={{borderBottom:"1px solid #f1f5f9"}}>
                        <td style={{padding:"6px 14px",fontFamily:"monospace",color:"#94a3b8",whiteSpace:"nowrap",width:180,fontSize:11,verticalAlign:"top"}}>{k}</td>
                        <td style={{padding:"6px 14px",wordBreak:"break-all",lineHeight:1.6,color:isInvalid?"#dc2626":isValid?"#15803d":"#1e293b",fontWeight:(isValid||isInvalid)?600:400}}>
                          {running && !v ? <span style={{color:"#d1d5db",fontStyle:"italic"}}>wird berechnet…</span> : v || <span style={{color:"#cbd5e1",fontStyle:"italic"}}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Error detail */}
          {err && !running && (
            <div style={{...box,border:"1px solid #fecaca"}}>
              <div style={{...boxHdr,color:"#dc2626",background:"#fef2f2",borderBottom:"1px solid #fecaca"}}>Fehler</div>
              <pre style={{...pre,color:"#991b1b"}}>{err}</pre>
            </div>
          )}

          {/* Raw LLM response */}
          {rawResponse && (
            <div style={box}>
              <div style={{...boxHdr,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span>LLM Response (raw)</span>
                {tokens && <span style={{fontSize:10,color:"#94a3b8",fontFamily:"monospace",textTransform:"none",letterSpacing:0}}>{tokens.completion} completion tokens</span>}
              </div>
              <pre style={{...pre,color:"#1e293b",background:"#fff"}}>{rawResponse}</pre>
            </div>
          )}

          {/* Exact prompt sent */}
          <div style={box}>
            <div style={{...boxHdr,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>Prompt (gesendet an LLM)</span>
              {tokens && <span style={{fontSize:10,color:"#94a3b8",fontFamily:"monospace",textTransform:"none",letterSpacing:0}}>{tokens.prompt} prompt tokens</span>}
            </div>
            <pre style={{...pre,color:"#374151",background:"#fafafa"}}>{exactPrompt || previewPrompt}</pre>
          </div>

          {/* Input variables */}
          <div style={box}>
            <div style={boxHdr}>Input-Variablen</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <tbody>
                {placeholderKeys.map(k => {
                  const sourceKey = inputMappings[k] || k;
                  const mappedValue = row.data[sourceKey];
                  const isRequired = requiredFields.includes(k);
                  const isMissing = String(mappedValue ?? "").trim() === "";
                  return (
                    <tr key={k} style={{borderBottom:"1px solid #f1f5f9"}}>
                      <td style={{padding:"5px 14px",fontFamily:"monospace",color:"#94a3b8",whiteSpace:"nowrap",width:280}}>
                        {k}
                        {sourceKey !== k ? <span style={{color:"#64748b"}}> ← {sourceKey}</span> : null}
                        {isRequired ? <span style={{marginLeft:8,color:isMissing?"#dc2626":"#15803d",fontFamily:"inherit"}}>{isMissing ? "(required, missing)" : "(required)"}</span> : null}
                      </td>
                      <td style={{padding:"5px 14px",color: mappedValue ? "#1e293b" : "#d1d5db",fontStyle: mappedValue ? "normal" : "italic"}}>
                        {mappedValue ?? "(not provided)"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Edit Prompt Modal ─────────────────────────────────────────────────────────
function EditPromptModal({ col, caseId, onSave, onClose, cellContext, onRunCell, onOpenRunDetail, availableFields }: {
  col: AiColumn; caseId: string;
  onSave: (updated: AiColumn) => void;
  onClose: () => void;
  cellContext?: { rowId: string; value: string; status: CellStatus; error?: string; rowLabel?: string; multiValues?: Record<string,string> };
  onRunCell?: () => void;
  onOpenRunDetail?: () => void;
  availableFields?: string[];
}) {
  const [draft, setDraft] = useState<AiColumn>({...col});
  const [saving, setSaving] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>([col.model || "gpt-4o-mini"]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<Array<{ model: string; provider: "openai" | "cerebras" | "anthropic"; ok: boolean; score: number; latencyMs: number; value: string; validation: "pass" | "fail"; validationReason: string; error?: string }>>([]);
  const [recommendedModel, setRecommendedModel] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([...DEFAULT_MODEL_OPTIONS]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const requiredFields = draft.requiredFields ?? [];

  useEffect(() => {
    fetch(`/api/llm/models?caseId=${caseId}`)
      .then((r) => r.json())
      .then((data) => {
        const next = Array.isArray(data?.models) ? data.models : [];
        setModelOptions(mergeModelOptions(next));
      })
      .catch(() => {
        setModelOptions([...DEFAULT_MODEL_OPTIONS]);
      });
  }, [caseId]);

  function insertPlaceholder(field: string) {
    const ta = promptRef.current;
    const placeholder = `{${field}}`;

    if (!ta) {
      setDraft((d) => ({ ...d, prompt: d.prompt + placeholder }));
      return;
    }

    const start = ta.selectionStart ?? draft.prompt.length;
    const end = ta.selectionEnd ?? draft.prompt.length;
    const scrollTop = ta.scrollTop;
    const next = draft.prompt.slice(0, start) + placeholder + draft.prompt.slice(end);
    const nextCursor = start + placeholder.length;

    setDraft((d) => ({ ...d, prompt: next }));
    requestAnimationFrame(() => {
      const el = promptRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(nextCursor, nextCursor);
      el.scrollTop = scrollTop;
    });
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/cases/${caseId}`);
    const c: Case = await res.json();
    const updated = c.aiColumns.map(a => a.id === draft.id ? draft : a);
    const r2 = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ aiColumns: updated }),
    });
    const saved = await r2.json();
    onSave(saved.aiColumns.find((a: AiColumn) => a.id === draft.id) ?? draft);
    setSaving(false);
  }

  function toggleCompareModel(model: string) {
    setCompareModels((prev) => {
      if (prev.includes(model)) return prev.filter((m) => m !== model);
      if (prev.length >= 3) return prev;
      return [...prev, model];
    });
  }

  async function runModelCompare() {
    if (!cellContext?.rowId || compareModels.length === 0) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareResults([]);
    setRecommendedModel(null);
    try {
      const res = await fetch("/api/llm/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          rowId: cellContext.rowId,
          column: draft,
          models: compareModels,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompareError(data.error ?? "Model comparison failed");
        return;
      }
      const results = Array.isArray(data.results) ? data.results : [];
      setCompareResults(results);
      if (typeof data.recommendedModel === "string") {
        setRecommendedModel(data.recommendedModel);
        setDraft((d) => ({ ...d, model: data.recommendedModel }));
      }
    } catch (error: unknown) {
      setCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      setCompareLoading(false);
    }
  }

  const inp: React.CSSProperties = {width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"7px 10px",fontSize:13,outline:"none",background:"#fff",fontFamily:"inherit"};
  const lbl: React.CSSProperties = {display:"block",fontSize:11,fontWeight:600,color:"#6b7280",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#fff",borderRadius:12,width:"min(1080px,98vw)",maxHeight:"96vh",minHeight:"78vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Sparkles style={{width:16,height:16,color:"#16a34a"}} />
            <span style={{fontWeight:700,fontSize:15}}>KI-Spalte bearbeiten</span>
            <span style={{fontSize:12,color:"#9ca3af",fontFamily:"monospace"}}>→ {col.outputKey}</span>
          </div>
          <button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",fontSize:18,color:"#9ca3af",lineHeight:1}}>×</button>
        </div>

        {/* Body */}
        <div style={{overflowY:"auto",padding:"20px",display:"grid",gap:16}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div><label style={lbl}>Spaltenname</label>
              <input style={inp} value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} />
            </div>
            <div><label style={lbl}>Output Key</label>
              <input style={{...inp,fontFamily:"monospace"}} value={draft.outputKey} onChange={e=>setDraft(d=>({...d,outputKey:e.target.value}))} />
            </div>
          </div>

          <div>
            <label style={lbl}>Prompt</label>
            <textarea ref={promptRef} style={{...inp,fontFamily:"monospace",fontSize:12,minHeight:260,resize:"vertical",lineHeight:1.6}}
              value={draft.prompt}
              onChange={e=>{
                const scroll = promptRef.current?.scrollTop ?? 0;
                const selStart = e.target.selectionStart;
                const selEnd = e.target.selectionEnd;
                setDraft(d=>({...d,prompt:e.target.value}));
                requestAnimationFrame(()=>{
                  if(!promptRef.current) return;
                  promptRef.current.scrollTop = scroll;
                  promptRef.current.setSelectionRange(selStart, selEnd);
                });
              }} />
            {/* Placeholder analysis */}
            {availableFields && availableFields.length > 0 && (() => {
              const used = [...new Set((draft.prompt.match(/\{([^}]+)\}/g)||[]).map(m=>m.slice(1,-1).trim()))];
              const matched = used.filter(p=>availableFields.includes(p));
              const unmatched = used.filter(p=>!availableFields.includes(p));
              return (
                <div style={{marginTop:6,display:"grid",gap:6}}>
                  {/* used placeholders status */}
                  {used.length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
                      <span style={{fontSize:11,color:"#6b7280",marginRight:2}}>Im Prompt:</span>
                      {matched.map(p=>(
                        <span key={p} style={{fontSize:11,background:"#dcfce7",color:"#15803d",padding:"2px 7px",borderRadius:10,fontFamily:"monospace"}} title="Spalte gefunden ✓">{"{"+p+"}"} ✓</span>
                      ))}
                      {unmatched.map(p=>(
                        <span key={p} style={{fontSize:11,background:"#fef2f2",color:"#dc2626",padding:"2px 7px",borderRadius:10,fontFamily:"monospace"}} title="Spalte nicht gefunden!">{"{"+p+"}"} ✗</span>
                      ))}
                    </div>
                  )}
                  {/* available field chips */}
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
                    <span style={{fontSize:11,color:"#6b7280",marginRight:2}}>Verfügbare Felder:</span>
                    {availableFields.map(f=>{
                      const inPrompt = draft.prompt.includes("{"+f+"}");
                      return (
                        <button key={f} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>insertPlaceholder(f)}
                        style={{fontSize:11,padding:"2px 7px",borderRadius:10,fontFamily:"monospace",border:"1px solid",cursor:"pointer",
                          background: inPrompt?"#f0fdf4":"#f9fafb",
                          color: inPrompt?"#15803d":"#374151",
                          borderColor: inPrompt?"#86efac":"#d1d5db"}
                        } title={inPrompt?"Bereits verwendet — klicken zum Einfügen":"Klicken zum Einfügen"}>
                          {"{"+f+"}"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {requiredFields.length > 0 && availableFields && availableFields.length > 0 && (
              <div style={{marginTop:10,border:"1px solid #fde68a",background:"#fffbeb",borderRadius:8,padding:10}}>
                <div style={{fontSize:11,fontWeight:600,color:"#92400e",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Pflicht-Mapping</div>
                <div style={{display:"grid",gap:6}}>
                  {requiredFields.map((field) => {
                    const current = draft.inputMappings?.[field] || "";
                    return (
                      <div key={field} style={{display:"grid",gridTemplateColumns:"180px 1fr",gap:8,alignItems:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:12,color:"#374151"}}>{`{${field}}`}</span>
                        <select
                          style={{...inp,fontFamily:"monospace",padding:"6px 10px"}}
                          value={current}
                          onChange={e=>setDraft(d=>({
                            ...d,
                            inputMappings: {
                              ...(d.inputMappings || {}),
                              [field]: e.target.value,
                            },
                          }))}
                        >
                          <option value="">Feld wählen…</option>
                          {availableFields.map((sourceField) => (
                            <option key={sourceField} value={sourceField}>{sourceField}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Web Search — inline under prompt ── */}
            <div style={{marginTop:8,border:"1px solid #bfdbfe",borderRadius:8,overflow:"hidden"}}>
              {/* Toggle header */}
              <button type="button"
                onClick={() => setDraft(d => ({
                  ...d,
                  useWebSearch: d.useWebSearch ? undefined : true,
                  searchQuery: d.useWebSearch ? undefined : d.searchQuery,
                }))}
                style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:draft.useWebSearch?"#dbeafe":"#f0f9ff",border:"none",cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:13}}>{draft.useWebSearch ? "🔍" : "🔍"}</span>
                <span style={{fontSize:11,fontWeight:700,color:draft.useWebSearch?"#1e40af":"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",flex:1}}>
                  Web-Suche vor LLM
                </span>
                <span style={{fontSize:11,padding:"1px 8px",borderRadius:10,background:draft.useWebSearch?"#2563eb":"#e2e8f0",color:draft.useWebSearch?"#fff":"#64748b",fontWeight:600}}>
                  {draft.useWebSearch ? "AN" : "AUS"}
                </span>
              </button>

              {draft.useWebSearch && (
                <div style={{padding:"10px 10px 12px",background:"#eff6ff",display:"grid",gap:8}}>
                  {/* Search query input */}
                  <div>
                    <label style={{...lbl,color:"#1d4ed8",marginBottom:3}}>Suchanfrage-Template</label>
                    <input style={{...inp,fontFamily:"monospace",fontSize:12,borderColor:"#93c5fd"}}
                      value={draft.searchQuery || ""}
                      onChange={e => setDraft(d => ({...d, searchQuery: e.target.value || undefined}))}
                      placeholder="z.B. {company_name} offizieller Webauftritt" />
                  </div>

                  {/* Field chips for search query */}
                  {availableFields && availableFields.length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
                      <span style={{fontSize:11,color:"#6b7280",marginRight:2}}>Felder:</span>
                      {availableFields.map(f => {
                        const inQuery = (draft.searchQuery || "").includes("{"+f+"}");
                        return (
                          <button key={f} type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => setDraft(d => ({...d, searchQuery: (d.searchQuery || "") + "{"+f+"}"}))}
                            style={{fontSize:11,padding:"2px 7px",borderRadius:10,fontFamily:"monospace",border:"1px solid",cursor:"pointer",
                              background:inQuery?"#dbeafe":"#f9fafb",
                              color:inQuery?"#1d4ed8":"#374151",
                              borderColor:inQuery?"#93c5fd":"#d1d5db"}}>
                            {"{"+f+"}"}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Max results + layer */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div>
                      <label style={{...lbl,color:"#1d4ed8",marginBottom:3}}>Max. Ergebnisse</label>
                      <input type="number" min={1} max={10}
                        style={{...inp,borderColor:"#93c5fd"}}
                        value={draft.searchMaxResults ?? 5}
                        onChange={e => setDraft(d => ({...d, searchMaxResults: Math.max(1, Math.min(10, Number(e.target.value)))}))} />
                    </div>
                    <div>
                      <label style={{...lbl,color:"#1d4ed8",marginBottom:3}}>Layer</label>
                      <select style={{...inp,borderColor:"#93c5fd"}}
                        value={draft.searchForceLayer || ""}
                        onChange={e => setDraft(d => ({...d, searchForceLayer: (e.target.value || undefined) as typeof d.searchForceLayer}))}>
                        <option value="">Auto (SerpAPI → Brave → DDG → Playwright)</option>
                        <option value="serpapi">Nur SerpAPI</option>
                        <option value="brave">Nur Brave Search</option>
                        <option value="duckduckgo">Nur DuckDuckGo</option>
                        <option value="playwright">Nur Playwright</option>
                      </select>
                    </div>
                  </div>

                  <div style={{fontSize:11,color:"#3b82f6",lineHeight:1.5}}>
                    Die Suchergebnisse werden automatisch als Kontext <strong>vor deinem Prompt</strong> eingefügt. Nutze Platzhalter wie <code style={{background:"#dbeafe",padding:"0 4px",borderRadius:3}}>{"{company_name}"}</code> um zeilenspezifische Suchen zu bauen.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Reasoning capture ── */}
          <div style={{border:"1px solid #e9d5ff",borderRadius:8,overflow:"hidden"}}>
            <button type="button"
              onClick={() => setDraft(d => ({...d, captureReasoning: d.captureReasoning ? undefined : true}))}
              style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:draft.captureReasoning?"#f3e8ff":"#faf5ff",border:"none",cursor:"pointer",textAlign:"left"}}>
              <span style={{fontSize:13}}>🧠</span>
              <span style={{fontSize:11,fontWeight:700,color:draft.captureReasoning?"#6b21a8":"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em",flex:1}}>
                Reasoning erfassen
              </span>
              <span style={{fontSize:11,padding:"1px 8px",borderRadius:10,background:draft.captureReasoning?"#7c3aed":"#e2e8f0",color:draft.captureReasoning?"#fff":"#64748b",fontWeight:600}}>
                {draft.captureReasoning ? "AN" : "AUS"}
              </span>
            </button>
            {draft.captureReasoning && (
              <div style={{padding:"8px 10px",background:"#faf5ff",fontSize:11,color:"#7c3aed",lineHeight:1.5}}>
                Das LLM gibt eine kurze Begründung seiner Antwort zurück (welche Quelle, warum, was abgelehnt). Wird als <code style={{background:"#ede9fe",padding:"0 4px",borderRadius:3}}>_reasoning_{draft.outputKey}</code> in der Zeile gespeichert.
              </div>
            )}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <div><label style={lbl}>Modell</label>
              <select style={inp} value={draft.model||"gpt-4o-mini"} onChange={e=>setDraft(d=>({...d,model:e.target.value}))}>
                {mergeModelOptions([draft.model || "gpt-4o-mini"], modelOptions).map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Output-Modus</label>
              <select style={inp} value={draft.outputMode||"text"} onChange={e=>setDraft(d=>({...d,outputMode:e.target.value as "text"|"json"}))}>
                <option value="text">Text</option><option value="json">JSON (Key extrahieren)</option>
              </select>
            </div>
            {draft.outputMode==="json" && (
              <div><label style={lbl}>JSON Key</label>
                <input style={{...inp,fontFamily:"monospace"}} value={draft.jsonKey||""} onChange={e=>setDraft(d=>({...d,jsonKey:e.target.value}))} placeholder="z.B. url" />
              </div>
            )}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div><label style={lbl}>Bedingung</label>
              <select style={inp} value={draft.condition||""} onChange={e=>{
                const nextCondition = e.target.value as AiColumn["condition"] | "";
                setDraft(d=>({
                  ...d,
                  condition: nextCondition || undefined,
                  conditionField: nextCondition ? d.conditionField : undefined,
                }));
              }}>
                <option value="">Immer ausführen</option>
                <option value="require_input">Nur wenn Eingabefeld vorhanden</option>
                <option value="empty">Nur wenn Ausgabefeld leer (kein Re-Run)</option>
                <option value="not_empty">Nur wenn Ausgabefeld befüllt</option>
              </select>
            </div>
            {draft.condition && (
              <div><label style={lbl}>Bedingungsfeld</label>
                {availableFields && availableFields.length > 0 ? (
                  <select style={{...inp,fontFamily:"monospace"}} value={draft.conditionField||""} onChange={e=>setDraft(d=>({...d,conditionField:e.target.value||undefined}))}>
                    <option value="">Feld wählen…</option>
                    {availableFields.map((field) => (
                      <option key={field} value={field}>{field}</option>
                    ))}
                  </select>
                ) : (
                  <input style={{...inp,fontFamily:"monospace"}} value={draft.conditionField||""} onChange={e=>setDraft(d=>({...d,conditionField:e.target.value||undefined}))} placeholder="Feldname" />
                )}
              </div>
            )}
          </div>

          {cellContext && (
            <div style={{border:"1px solid #dbeafe",background:"#f8fbff",borderRadius:8,padding:12,display:"grid",gap:10}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"#1e3a8a"}}>Model Compare</div>
                  <div style={{fontSize:11,color:"#64748b"}}>Wähle bis zu 3 Modelle für denselben Prompt und diese Zeile.</div>
                </div>
                <button
                  type="button"
                  onClick={runModelCompare}
                  disabled={compareLoading || compareModels.length === 0}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#2563eb",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,opacity:compareLoading?0.6:1}}
                >
                  {compareLoading ? <Loader2 style={{width:12,height:12}} className="animate-spin" /> : <Zap style={{width:12,height:12}} />}
                  {compareLoading ? "Teste…" : "3 Modelle testen"}
                </button>
              </div>

              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {mergeModelOptions(compareModels, modelOptions).map((m) => {
                  const selected = compareModels.includes(m);
                  const disabled = !selected && compareModels.length >= 3;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleCompareModel(m)}
                      disabled={disabled}
                      style={{
                        fontSize:11,
                        padding:"3px 8px",
                        borderRadius:999,
                        border:"1px solid",
                        cursor:disabled?"not-allowed":"pointer",
                        opacity:disabled?0.5:1,
                        fontFamily:"monospace",
                        background:selected?"#dbeafe":"#fff",
                        borderColor:selected?"#93c5fd":"#d1d5db",
                        color:selected?"#1d4ed8":"#374151",
                      }}
                    >
                      {selected ? "✓ " : ""}{m}
                    </button>
                  );
                })}
              </div>

              {compareError && <div style={{fontSize:12,color:"#dc2626"}}>{compareError}</div>}

              {recommendedModel && (
                <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#065f46",background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:6,padding:"6px 8px"}}>
                  <span>Automatisch übernommen: <strong style={{fontFamily:"monospace"}}>{recommendedModel}</strong></span>
                </div>
              )}

              {compareResults.length > 0 && (
                <div style={{display:"grid",gap:6}}>
                  {compareResults.map((r) => (
                    <div key={r.model} style={{border:"1px solid #e5e7eb",borderRadius:6,padding:"7px 8px",background:"#fff"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#6b7280"}}>
                        <span style={{fontFamily:"monospace",fontWeight:600,color:"#111827"}}>{r.model}</span>
                        <span>· {r.provider}</span>
                        <span>· score {r.score}</span>
                        <span>· {r.validation}</span>
                        <span>· {r.latencyMs}ms</span>
                        <span style={{marginLeft:"auto",color:r.ok?"#059669":"#dc2626",fontWeight:600}}>{r.ok ? "OK" : "FAIL"}</span>
                      </div>
                      <div style={{fontSize:11,color:r.validation==="pass"?"#166534":"#b45309",marginTop:3}}>Validation: {r.validationReason}</div>
                      <div style={{fontSize:12,color:r.ok?"#1f2937":"#991b1b",marginTop:4,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{r.ok ? (r.value || "(empty)") : (r.error || "Unknown error")}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cell log/error section */}
        {cellContext && (
          <div style={{margin:"0 20px 0",borderTop:"1px solid #e5e7eb",paddingTop:16}}>
            <div style={{fontSize:11,fontWeight:600,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>
              Zellen-Log{cellContext.rowLabel ? ` — ${cellContext.rowLabel}` : ""}
            </div>
            {/* Status badge */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              {cellContext.status==="error" && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#dc2626",background:"#fef2f2",padding:"3px 10px",borderRadius:10,fontWeight:600}}>✗ Fehler</span>}
              {cellContext.status==="done" && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#059669",background:"#d1fae5",padding:"3px 10px",borderRadius:10,fontWeight:600}}>✓ Fertig</span>}
              {cellContext.status==="running" && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#d97706",background:"#fef3c7",padding:"3px 10px",borderRadius:10,fontWeight:600}}><Loader2 style={{width:10,height:10}} className="animate-spin" /> Läuft</span>}
              {cellContext.status==="idle" && <span style={{fontSize:11,color:"#9ca3af"}}>○ Noch nicht ausgeführt</span>}
              {cellContext.status==="skipped" && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#9ca3af",background:"#f3f4f6",padding:"3px 10px",borderRadius:10}}>⏭ Übersprungen</span>}
              {onRunCell && (
                <button onClick={()=>{onRunCell();}}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#16a34a",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600,marginLeft:"auto"}}>
                  <Play style={{width:11,height:11}} /> Jetzt ausführen
                </button>
              )}
              {onOpenRunDetail && (
                <button onClick={onOpenRunDetail}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#2563eb",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600}}>
                  <Info style={{width:11,height:11}} /> Run + Detail-Log
                </button>
              )}
            </div>
            {cellContext.error && (
              <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:600,color:"#dc2626",marginBottom:4}}>Fehlermeldung</div>
                <pre style={{fontSize:12,color:"#991b1b",margin:0,whiteSpace:"pre-wrap",wordBreak:"break-all",fontFamily:"monospace",lineHeight:1.5}}>{cellContext.error}</pre>
              </div>
            )}
            {cellContext.status==="done" && (cellContext.value || cellContext.multiValues) && (
              <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:6,overflow:"hidden"}}>
                <div style={{fontSize:11,fontWeight:600,color:"#475569",padding:"7px 12px",borderBottom:"1px solid #e2e8f0",background:"#f1f5f9",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                  Output
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <tbody>
                    {cellContext.multiValues
                      ? Object.entries(cellContext.multiValues).map(([k, v]) => (
                          <tr key={k} style={{borderBottom:"1px solid #f1f5f9"}}>
                            <td style={{padding:"6px 12px",fontFamily:"monospace",color:"#64748b",whiteSpace:"nowrap",width:180,verticalAlign:"top"}}>{k}</td>
                            <td style={{padding:"6px 12px",color:v.startsWith("✗")?"#dc2626":v.startsWith("✓")?"#15803d":"#1e293b",wordBreak:"break-all",lineHeight:1.5}}>{v||<span style={{color:"#cbd5e1",fontStyle:"italic"}}>empty</span>}</td>
                          </tr>
                        ))
                      : (
                          <tr>
                            <td style={{padding:"6px 12px",fontFamily:"monospace",color:"#64748b",whiteSpace:"nowrap",width:180}}>{col.outputKey}</td>
                            <td style={{padding:"6px 12px",color:"#1e293b",wordBreak:"break-all"}}>{cellContext.value}</td>
                          </tr>
                        )
                    }
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{padding:"14px 20px",borderTop:"1px solid #e5e7eb",display:"flex",alignItems:"center",gap:8,marginTop:16}}>
          <button onClick={save} disabled={saving}
            style={{display:"flex",alignItems:"center",gap:6,padding:"8px 20px",background:"#16a34a",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,opacity:saving?.6:1}}>
            {saving ? <Loader2 style={{width:13,height:13}} className="animate-spin" /> : <Save style={{width:13,height:13}} />}
            Speichern
          </button>
          <button onClick={onClose} style={{padding:"7px 16px",border:"1px solid #d1d5db",borderRadius:6,background:"#fff",cursor:"pointer",fontSize:13,color:"#374151"}}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline Settings Panel ─────────────────────────────────────────────────────
function SettingsPanel({ caseId, onCaseUpdated }: { caseId: string; onCaseUpdated: (c: Case) => void }) {
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState<string | undefined>(undefined);
  const [cerebrasApiKey, setCerebrasApiKey] = useState("");
  const [cerebrasApiKeyMasked, setCerebrasApiKeyMasked] = useState<string | undefined>(undefined);
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicApiKeyMasked, setAnthropicApiKeyMasked] = useState<string | undefined>(undefined);
  const [modelCatalog, setModelCatalog] = useState<string[]>([]);
  const [enabledModels, setEnabledModels] = useState<string[]>([]);
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsSavedMsg, setModelsSavedMsg] = useState(false);
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [smokeResults, setSmokeResults] = useState<Array<{ model: string; provider: "openai" | "cerebras" | "anthropic"; ok: boolean; latencyMs: number; preview?: string; error?: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [editingCol, setEditingCol] = useState<AiColumn | null>(null);
  const [addingCol, setAddingCol] = useState(false);
  const [newCol, setNewCol] = useState<Partial<AiColumn>>({});

  useEffect(() => {
    fetch(`/api/cases/${caseId}`).then(r => r.json()).then((c: Case) => {
      setCaseData(c); setName(c.name);
      setApiKey(""); setApiKeyMasked(c.apiKeyMasked);
      setCerebrasApiKey(""); setCerebrasApiKeyMasked(c.cerebrasApiKeyMasked);
      setAnthropicApiKey(""); setAnthropicApiKeyMasked(c.anthropicApiKeyMasked);
    });
  }, [caseId]);

  useEffect(() => {
    fetch(`/api/llm/models?caseId=${caseId}`)
      .then(r => r.json())
      .then((data) => {
        const allModels = Array.isArray(data?.allModels) ? data.allModels : (Array.isArray(data?.models) ? data.models : []);
        const nextEnabled = Array.isArray(data?.enabledModels) ? data.enabledModels : [];
        setModelCatalog(allModels);
        setEnabledModels(nextEnabled.length > 0 ? nextEnabled : allModels);
      })
      .catch(() => {
        setModelCatalog([...DEFAULT_MODEL_OPTIONS]);
        setEnabledModels([...DEFAULT_MODEL_OPTIONS]);
      });
  }, [caseId]);

  async function saveMeta() {
    setSaving(true);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        apiKey: apiKey.trim() || undefined,
        cerebrasApiKey: cerebrasApiKey.trim() || undefined,
        anthropicApiKey: anthropicApiKey.trim() || undefined,
      }),
    });
    const updated = await res.json();
    setCaseData(updated);
    onCaseUpdated(updated);
    setApiKey("");
    setCerebrasApiKey("");
    setAnthropicApiKey("");
    setApiKeyMasked(updated.apiKeyMasked);
    setCerebrasApiKeyMasked(updated.cerebrasApiKeyMasked);
    setAnthropicApiKeyMasked(updated.anthropicApiKeyMasked);
    setSaving(false); setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000);
  }

  function toggleEnabledModel(model: string) {
    setEnabledModels((prev) => prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]);
  }

  async function saveModelAllowlist() {
    setModelsSaving(true);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelAllowlist: enabledModels }),
    });
    const updated = await res.json();
    setCaseData(updated);
    onCaseUpdated(updated);
    setModelsSaving(false);
    setModelsSavedMsg(true);
    setTimeout(() => setModelsSavedMsg(false), 2000);
  }

  async function runSettingsSmoke() {
    const models = enabledModels.length > 0 ? enabledModels : modelCatalog;
    if (models.length === 0) return;
    setSmokeLoading(true);
    setSmokeError(null);
    setSmokeResults([]);
    try {
      const res = await fetch("/api/llm/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, models }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSmokeError(data.error ?? "Smoke test failed");
        return;
      }
      setSmokeResults(Array.isArray(data.results) ? data.results : []);
    } catch (e: unknown) {
      setSmokeError(e instanceof Error ? e.message : String(e));
    } finally {
      setSmokeLoading(false);
    }
  }

  async function saveCols(cols: AiColumn[]) {
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiColumns: cols }),
    });
    const updated = await res.json();
    setCaseData(updated); onCaseUpdated(updated); return updated;
  }

  async function saveColEdit() {
    if (!editingCol || !caseData) return;
    await saveCols(caseData.aiColumns.map(c => c.id === editingCol.id ? editingCol : c));
    setEditingCol(null);
  }

  async function addCol() {
    if (!caseData || !newCol.name || !newCol.prompt || !newCol.outputKey) return;
    const col: AiColumn = {
      id: crypto.randomUUID(), name: newCol.name, prompt: newCol.prompt,
      outputKey: newCol.outputKey, model: newCol.model || "gpt-4o-mini",
      outputMode: newCol.outputMode as "text"|"json"|undefined,
      jsonKey: newCol.jsonKey, condition: newCol.condition, conditionField: newCol.conditionField,
    };
    await saveCols([...caseData.aiColumns, col]);
    setAddingCol(false); setNewCol({});
  }

  if (!caseData) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}><Loader2 className="animate-spin" style={{width:20,height:20,color:"#16a34a"}} /></div>;

  const inp: React.CSSProperties = {width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"6px 10px",fontSize:13,outline:"none",background:"#fff"};
  const lbl: React.CSSProperties = {display:"block",fontSize:11,fontWeight:600,color:"#6b7280",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"};
  const card: React.CSSProperties = {background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,padding:"20px 24px",marginBottom:16};
  const btn = (bg: string, fg = "#fff"): React.CSSProperties => ({display:"inline-flex",alignItems:"center",gap:6,padding:"6px 14px",background:bg,color:fg,border:bg==="#fff"?"1px solid #d1d5db":"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600});

  function ColForm({ col, onChange }: { col: Partial<AiColumn>; onChange: (c: Partial<AiColumn>) => void }) {
    return (
      <div style={{display:"grid",gap:12}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={lbl}>Spaltenname</label><input style={inp} value={col.name||""} onChange={e=>onChange({...col,name:e.target.value})} placeholder="z.B. Website" /></div>
          <div><label style={lbl}>Output Key</label><input style={{...inp,fontFamily:"monospace"}} value={col.outputKey||""} onChange={e=>onChange({...col,outputKey:e.target.value})} placeholder="z.B. website" /></div>
        </div>
        <div>
          <label style={lbl}>Prompt</label>
          <textarea style={{...inp,fontFamily:"monospace",fontSize:12,minHeight:100,resize:"vertical"}} value={col.prompt||""} onChange={e=>onChange({...col,prompt:e.target.value})}
            placeholder="Schreibe den Prompt. Verwende {company_name} etc. als Platzhalter." />
          <div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>Platzhalter: {"{company_name}"}, {"{website}"} usw.</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          <div><label style={lbl}>Modell</label>
            <select style={inp} value={col.model||"gpt-4o-mini"} onChange={e=>onChange({...col,model:e.target.value})}>
              <option>gpt-4o-mini</option><option>gpt-4o</option><option>gpt-4-turbo</option><option>llama3.1-8b</option><option>llama3.3-70b</option><option>qwen-3-32b</option><option>gpt-oss-120b</option><option>gpt-oss-20b</option><option>zai-glm-4.7</option><option>glm-5.1</option><option>deepseek-v3.2</option><option>kimi-k2.6</option><option>minimax-m2</option><option>mistral-large-3</option><option>claude-3-5-haiku-20241022</option><option>claude-3-5-sonnet-20241022</option><option>claude-3-7-sonnet-20250219</option>
            </select>
          </div>
          <div><label style={lbl}>Output-Modus</label>
            <select style={inp} value={col.outputMode||"text"} onChange={e=>onChange({...col,outputMode:e.target.value as "text"|"json"})}>
              <option value="text">Text</option><option value="json">JSON (Key extrahieren)</option>
            </select>
          </div>
          {col.outputMode==="json" && (
            <div><label style={lbl}>JSON Key</label><input style={{...inp,fontFamily:"monospace"}} value={col.jsonKey||""} onChange={e=>onChange({...col,jsonKey:e.target.value})} placeholder="z.B. url" /></div>
          )}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={lbl}>Bedingung</label>
            <select style={inp} value={col.condition||""} onChange={e=>onChange({...col,condition:e.target.value as AiColumn["condition"]||undefined})}>
              <option value="">Immer ausführen</option>
              <option value="require_input">Nur wenn Eingabefeld vorhanden</option>
              <option value="empty">Nur wenn Ausgabefeld leer (kein Re-Run)</option>
              <option value="not_empty">Nur wenn Ausgabefeld befüllt</option>
            </select>
          </div>
          {col.condition && (
            <div><label style={lbl}>Bedingungsfeld</label><input style={{...inp,fontFamily:"monospace"}} value={col.conditionField||""} onChange={e=>onChange({...col,conditionField:e.target.value||undefined})} placeholder="Feldname" /></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{flex:1,overflowY:"auto",padding:"24px 32px",background:"#f1f3f5"}}>

      {/* General */}
      <div style={card}>
        <div style={{fontSize:15,fontWeight:700,color:"#111",marginBottom:16}}>⚙️ Allgemein</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          <div><label style={lbl}>Case-Name</label><input style={inp} value={name} onChange={e=>setName(e.target.value)} /></div>
          <div>
            <label style={lbl}>OpenAI API Key</label>
            <input style={{...inp,fontFamily:"monospace"}} type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={apiKeyMasked ? `Gespeichert: ${apiKeyMasked}` : "sk-..."} />
            <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Wird serverseitig verschlüsselt gespeichert. Empfohlen: OPENAI_API_KEY via Infisical als Fallback.</div>
          </div>
          <div>
            <label style={lbl}>Cerebras API Key</label>
            <input style={{...inp,fontFamily:"monospace"}} type="password" value={cerebrasApiKey} onChange={e=>setCerebrasApiKey(e.target.value)} placeholder={cerebrasApiKeyMasked ? `Gespeichert: ${cerebrasApiKeyMasked}` : "csk-..."} />
            <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Für Modelle wie llama3.x/qwen via Cerebras. Fallback: CEREBRAS_API_KEY via Infisical.</div>
          </div>
          <div>
            <label style={lbl}>Anthropic API Key</label>
            <input style={{...inp,fontFamily:"monospace"}} type="password" value={anthropicApiKey} onChange={e=>setAnthropicApiKey(e.target.value)} placeholder={anthropicApiKeyMasked ? `Gespeichert: ${anthropicApiKeyMasked}` : "sk-ant-..."} />
            <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Für Claude Modelle. Fallback: ANTHROPIC_API_KEY via Infisical.</div>
          </div>
        </div>
        <button style={btn("#16a34a")} onClick={saveMeta} disabled={saving}>
          {saving ? <Loader2 style={{width:12,height:12}} className="animate-spin" /> : <Save style={{width:12,height:12}} />}
          {savedMsg ? "✓ Gespeichert!" : "Speichern"}
        </button>
      </div>

      <div style={card}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{fontSize:15,fontWeight:700,color:"#111"}}>🧪 Overall Model Settings</div>
          <div style={{display:"flex",gap:8}}>
            <button style={btn("#2563eb")} onClick={runSettingsSmoke} disabled={smokeLoading || modelCatalog.length===0}>
              {smokeLoading ? <Loader2 style={{width:12,height:12}} className="animate-spin" /> : <Zap style={{width:12,height:12}} />}
              {smokeLoading ? "Smoke läuft…" : "Smoke Test"}
            </button>
            <button style={btn("#16a34a")} onClick={saveModelAllowlist} disabled={modelsSaving || modelCatalog.length===0}>
              {modelsSaving ? <Loader2 style={{width:12,height:12}} className="animate-spin" /> : <Save style={{width:12,height:12}} />}
              {modelsSavedMsg ? "✓ Gespeichert" : "Modelle anwenden"}
            </button>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <button style={btn("#fff", "#374151")} onClick={()=>setEnabledModels([...modelCatalog])}>Alle auswählen</button>
          <button style={btn("#fff", "#374151")} onClick={()=>setEnabledModels([])}>Alle abwählen</button>
          <span style={{fontSize:12,color:"#6b7280",display:"inline-flex",alignItems:"center"}}>{enabledModels.length} / {modelCatalog.length} aktiv</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8}}>
          {modelCatalog.map((m) => {
            const selected = enabledModels.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleEnabledModel(m)}
                style={{
                  textAlign:"left",
                  fontSize:12,
                  padding:"6px 8px",
                  borderRadius:6,
                  border:"1px solid",
                  fontFamily:"monospace",
                  cursor:"pointer",
                  background:selected?"#dcfce7":"#fff",
                  borderColor:selected?"#86efac":"#d1d5db",
                  color:selected?"#166534":"#374151",
                }}
              >
                {selected ? "✓ " : "○ "}{m}
              </button>
            );
          })}
        </div>
        {smokeError && <div style={{marginTop:10,fontSize:12,color:"#dc2626"}}>{smokeError}</div>}
        {smokeResults.length > 0 && (
          <div style={{marginTop:12,display:"grid",gap:6}}>
            {smokeResults.map((r) => (
              <div key={`settings-smoke-${r.model}`} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:"6px 8px"}}>
                <span style={{fontFamily:"monospace",fontWeight:600,color:"#111827"}}>{r.model}</span>
                <span style={{color:"#6b7280"}}>· {r.provider}</span>
                <span style={{color:"#6b7280"}}>· {r.latencyMs}ms</span>
                <span style={{marginLeft:"auto",color:r.ok?"#059669":"#dc2626",fontWeight:700}}>{r.ok ? "PASS" : "FAIL"}</span>
                <span style={{color:r.ok?"#166534":"#991b1b"}}>{r.ok ? (r.preview || "ok") : (r.error || "error")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Columns */}
      <div style={card}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:700,color:"#111"}}>✨ KI-Spalten ({caseData.aiColumns.length})</div>
          <button style={btn("#16a34a")} onClick={()=>{setAddingCol(true);setNewCol({model:"gpt-4o-mini",outputMode:"text"});}}>
            <Plus style={{width:12,height:12}} /> Neue KI-Spalte
          </button>
        </div>

        {/* Add form */}
        {addingCol && (
          <div style={{border:"2px solid #16a34a",borderRadius:8,padding:16,marginBottom:16,background:"#f0fdf4"}}>
            <div style={{fontSize:13,fontWeight:600,color:"#15803d",marginBottom:12}}>➕ Neue Spalte</div>
            <ColForm col={newCol} onChange={setNewCol} />
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button style={btn("#16a34a")} onClick={addCol}>Hinzufügen</button>
              <button style={btn("#fff","#374151")} onClick={()=>{setAddingCol(false);setNewCol({});}}>Abbrechen</button>
            </div>
          </div>
        )}

        {caseData.aiColumns.length === 0 && !addingCol && (
          <div style={{textAlign:"center",padding:"32px 0",color:"#9ca3af",fontSize:13}}>
            Noch keine KI-Spalten. Klicke auf "Neue KI-Spalte" um zu starten.
          </div>
        )}

        <div style={{display:"grid",gap:8}}>
          {caseData.aiColumns.map(col => (
            <div key={col.id} style={{border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",background:editingCol?.id===col.id?"#f0fdf4":"#fff"}}
                onClick={()=>setEditingCol(editingCol?.id===col.id ? null : {...col})}>
                <Sparkles style={{width:14,height:14,color:"#16a34a",flexShrink:0}} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,color:"#111"}}>{col.name}</div>
                  <div style={{fontSize:11,color:"#9ca3af",fontFamily:"monospace",marginTop:1}}>
                    → {col.outputKey} · {col.model||"gpt-4o-mini"} · {col.outputMode||"text"}
                    {col.condition ? ` · wenn ${col.condition}` : ""}
                  </div>
                </div>
                <span style={{fontSize:11,color:"#9ca3af"}}>{editingCol?.id===col.id?"▲":"▼"}</span>
                <button onClick={e=>{e.stopPropagation();if(!confirm(`"${col.name}" löschen?`))return;saveCols(caseData.aiColumns.filter(c=>c.id!==col.id));}}
                  style={{padding:4,border:"none",background:"none",cursor:"pointer",color:"#d1d5db"}}
                  onMouseEnter={e=>(e.currentTarget.style.color="#dc2626")}
                  onMouseLeave={e=>(e.currentTarget.style.color="#d1d5db")}>
                  <Trash2 style={{width:13,height:13}} />
                </button>
              </div>
              {editingCol?.id===col.id && (
                <div style={{borderTop:"1px solid #e5e7eb",padding:16,background:"#fafafa"}}>
                  <ColForm col={editingCol} onChange={c=>setEditingCol(c as AiColumn)} />
                  <div style={{display:"flex",gap:8,marginTop:12}}>
                    <button style={btn("#16a34a")} onClick={saveColEdit}>Speichern</button>
                    <button style={btn("#fff","#374151")} onClick={()=>setEditingCol(null)}>Abbrechen</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CellStatusIcon({ status }: { status: CellStatus }) {
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />;
  if (status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
  if (status === "error") return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  if (status === "skipped") return <SkipForward className="w-3.5 h-3.5 text-gray-400 shrink-0" />;
  return null;
}

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = use(params);
  const router = useRouter();

  const [caseData, setCaseData] = useState<Case | null>(null);
  const [rows, setRows] = useState<RowData[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showAddCol, setShowAddCol] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [runningCells, setRunningCells] = useState<Set<string>>(new Set()); // "rowId:colId"
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<{ id: number; message: string; createdAt: string }[]>([]);
  const [activeTab, setActiveTab] = useState<"Tabelle" | "Einstellungen" | "Log" | "Export">("Tabelle");
  const [showUpload, setShowUpload] = useState(false);
  const [showPromptCols, setShowPromptCols] = useState(false);
  const [rangeVon, setRangeVon] = useState(1);
  const [rangeBis, setRangeBis] = useState<number>(0);
  const [rangeMax, setRangeMax] = useState(0);
  const [colOrder, setColOrder] = useState<string[]>([]);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [editingPromptCol, setEditingPromptCol] = useState<AiColumn | null>(null);
  const [editingPromptCell, setEditingPromptCell] = useState<{col: AiColumn; row: RowData} | null>(null);
  const [runDetailCell, setRunDetailCell] = useState<{col: AiColumn; row: RowData} | null>(null);
  const [sequentialMode, setSequentialMode] = useState(false);
  const [reasoningModal, setReasoningModal] = useState<{content: string; title: string} | null>(null);
  const [abortControllers, setAbortControllers] = useState<Record<string, AbortController>>({});
  const [runningColumnId, setRunningColumnId] = useState<string | null>(null);
  const [runningRowIds, setRunningRowIds] = useState<Set<string>>(new Set());
  const [operationIds, setOperationIds] = useState<Record<string, string>>({});
  const [runningCellTimestamps, setRunningCellTimestamps] = useState<Record<string, number>>({});

  // Calculate total tokens and costs across all rows
  const calculateTotals = useCallback(() => {
    let totalTokens = 0;
    let totalCostUsd = 0;

    rows.forEach(row => {
      Object.entries(row.data).forEach(([key, value]) => {
        if (key.startsWith('_llm_tokens_') && typeof value === 'string') {
          try {
            const tokens = JSON.parse(value);
            if (tokens.total) {
              totalTokens += tokens.total;
            }
          } catch {
            // Ignore parse errors
          }
        }
        if (key.startsWith('_llm_cost_') && typeof value === 'string') {
          const cost = parseFloat(value);
          if (!isNaN(cost)) {
            totalCostUsd += cost;
          }
        }
      });
    });

    // Convert USD to Euro (approximate rate: 1 USD = 0.92 EUR)
    const usdToEurRate = 0.92;
    const totalCostEur = totalCostUsd * usdToEurRate;

    return { totalTokens, totalCostUsd, totalCostEur };
  }, [rows]);

  const totals = calculateTotals();

  // Cleanup stuck running cells (only clean up cells running > 10 min or completed)
  useEffect(() => {
    // Only start cleanup if there are running cells
    if (runningCells.size === 0) return;

    const timeout = setTimeout(() => {
      const now = Date.now();
      const maxRunTime = 10 * 60 * 1000; // 10 minutes

      setRunningCells(prev => {
        const cleaned = new Set<string>();
        const newTimestamps: Record<string, number> = {};

        prev.forEach(key => {
          const [rowId, colId] = key.split(':');
          const row = rows.find(r => r.id === rowId);
          const startTime = runningCellTimestamps[key];

          if (row) {
            const col = caseData?.aiColumns.find(c => c.id === colId);
            if (col) {
              const status = row.cellStatuses[col.outputKey];
              const isRunningTooLong = startTime && (now - startTime > maxRunTime);
              
              // Remove if: not actually running, or running too long
              if (status !== 'running' || isRunningTooLong) {
                console.log('Cleaning up stuck running cell:', key, 'actual status:', status);
              } else {
                cleaned.add(key);
                newTimestamps[key] = startTime || now;
              }
            }
          }
        });

        setRunningCellTimestamps(newTimestamps);
        return cleaned;
      });
    }, 30000); // Check after 30 seconds

    return () => clearTimeout(timeout);
  }, [runningCells.size, rows, caseData?.aiColumns, runningCellTimestamps]);

  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch(`/api/cases/${caseId}`).then((x) => x.json()),
      fetch(`/api/rows?caseId=${caseId}`).then((x) => x.json()),
    ]);
    setCaseData(c);
    setRows(r);
    
    // Clear any stuck "running" statuses from previous session
    const rowsWithStuckStatus = r.filter((row: RowData) => 
      Object.keys(row.cellStatuses).some(key => row.cellStatuses[key] === 'running')
    );
    
    if (rowsWithStuckStatus.length > 0) {
      console.log('Clearing stuck running statuses from previous session:', rowsWithStuckStatus.length);
      rowsWithStuckStatus.forEach((row: RowData) => {
        Object.keys(row.cellStatuses).forEach(key => {
          if (row.cellStatuses[key] === 'running') {
            // Update the row in the database to clear the running status
            fetch(`/api/rows/${row.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                cellStatuses: { ...row.cellStatuses, [key]: 'skipped' }
              }),
            }).catch(console.error);
          }
        });
      });
    }
    
    if (r.length > 0) {
      const aiKeys = c.aiColumns.map((col: AiColumn) => col.outputKey);
      // all multiKey sub-outputs (e.g. domain_confidence, domain_validated) written to row data
      const allMultiKeys = c.aiColumns.flatMap((col: AiColumn) => (col.multiKeys ?? []).map((mk: {outputKey: string}) => mk.outputKey));
      const allDataKeys = Object.keys(r[0].data).filter(k => !k.startsWith("_"));
      const srcKeys = allDataKeys.filter(k => !aiKeys.includes(k) && !allMultiKeys.includes(k));
      // orphan = in data and is a multiKey sub-output OR unknown key (e.g. domain_validated from validateDomain)
      const orphanKeys = allDataKeys.filter(k => !srcKeys.includes(k) && !aiKeys.includes(k));
      setSourceColumns(srcKeys);
      setColOrder(prev => {
        // Use DB-saved order as base; only fall back to derived order if nothing saved
        const savedOrder: string[] = c.colOrder?.length ? c.colOrder : [];
        const base = savedOrder.length > 0 ? savedOrder : [...srcKeys, ...aiKeys, ...orphanKeys];
        // If we already have a local order (user reordered mid-session), keep it but append new keys
        const activeBase = prev.length > 0 ? prev : base;
        const existing = new Set(activeBase);
        const toAdd = allDataKeys.filter(k => !existing.has(k));
        return toAdd.length > 0 ? [...activeBase, ...toAdd] : activeBase;
      });
    }
    setRangeBis(r.length);
    setRangeMax(r.length);
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Debounce-save colOrder to DB whenever it changes
  useEffect(() => {
    if (!colOrder.length) return;
    const t = setTimeout(() => {
      fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colOrder }),
      });
    }, 800);
    return () => clearTimeout(t);
  }, [colOrder, caseId]);

  async function fetchLogs() {
    const data = await fetch(`/api/logs?caseId=${caseId}&limit=300`).then((r) => r.json());
    setLogs(data);
  }

  useEffect(() => {
    if (showLogs || activeTab === "Log") fetchLogs();
  }, [showLogs, activeTab]);

  // ── Cell editing ──────────────────────────────────────────────────────────
  function startEdit(rowId: string, key: string, current: string) {
    setEditingCell({ rowId, key });
    setEditValue(current ?? "");
  }

  async function commitEdit() {
    if (!editingCell) return;
    const { rowId, key } = editingCell;
    setRows((prev) =>
      prev.map((r) => r.id === rowId ? { ...r, data: { ...r.data, [key]: editValue } } : r)
    );
    setEditingCell(null);
    await fetch(`/api/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { ...rows.find((r) => r.id === rowId)!.data, [key]: editValue } }),
    });
  }

  // ── Run single cell ───────────────────────────────────────────────────────
  async function runCell(rowId: string, col: AiColumn) {
    const key = `${rowId}:${col.id}`;
    const abortController = new AbortController();
    setAbortControllers(prev => ({ ...prev, [key]: abortController }));
    setRunningCells((prev) => new Set(prev).add(key));
    setRunningCellTimestamps(prev => ({ ...prev, [key]: Date.now() }));
    setRows((prev) =>
      prev.map((r) => r.id === rowId
        ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } }
        : r)
    );
    try {
      const res = await fetch("/api/run/cell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, rowId, columnId: col.id }),
        signal: abortController.signal,
      });
      const result = await res.json();
      if (result.operationId) {
        setOperationIds(prev => ({ ...prev, [key]: result.operationId }));
      }
      try {
        setRows((prev) =>
          prev.map((r) => {
            if (r.id !== rowId) return r;
            const extraData = result.multiValues ?? {};
            const extraStatuses: Record<string,string> = {};
            for (const k of Object.keys(extraData)) extraStatuses[k] = result.status ?? "done";
            const metaData: Record<string, string> = {};
            const metaPrefix = `_llm_`;
            for (const [key, val] of Object.entries(result as Record<string, unknown>)) {
              if (key.startsWith(metaPrefix) && typeof val === "string") {
                metaData[key] = val;
              }
            }
            return {
              ...r,
              data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey], ...extraData, ...metaData },
              cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status ?? (res.ok ? "done" : "error"), ...extraStatuses },
              cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors,
            };
          })
        );
      } catch (error) {
        console.error('Error updating row status:', error);
      }
      if (result.multiValues) {
        const newKeys = Object.keys(result.multiValues);
        setColOrder(prev => {
          const existing = new Set(prev);
          const toAdd = newKeys.filter(k => !existing.has(k));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    } finally {
      setRunningCells((prev) => { const s = new Set(prev); s.delete(key); return s; });
      setAbortControllers(prev => { const { [key]: _, ...rest } = prev; return rest; });
      setRunningCellTimestamps(prev => { const { [key]: _, ...rest } = prev; return rest; });
      setOperationIds(prev => { const { [key]: _, ...rest } = prev; return rest; });
    }
  }

  function stopCell(rowId: string, col: AiColumn) {
    const key = `${rowId}:${col.id}`;
    const opId = operationIds[key];

    // Call server-side cancellation endpoint
    if (opId) {
      fetch(`/api/run/cell?operationId=${opId}`, { method: 'DELETE' }).catch(console.error);
    }

    // Abort local fetch request
    const controller = abortControllers[key];
    if (controller) {
      controller.abort();
      setAbortControllers(prev => { const { [key]: _, ...rest } = prev; return rest; });
    }
    // Always update UI state even if controller not found
    setRunningCells((prev) => { const s = new Set(prev); s.delete(key); return s; });
    setOperationIds(prev => { const { [key]: _, ...rest } = prev; return rest; });
    setRunningCellTimestamps(prev => { const { [key]: _, ...rest } = prev; return rest; });
    setRows((prev) =>
      prev.map((r) => r.id === rowId
        ? {
            ...r,
            cellStatuses: { ...r.cellStatuses, [col.outputKey]: "skipped" },
            data: {
              ...r.data,
              [col.outputKey]: "", // Clear the main output
              [`_reasoning_${col.outputKey}`]: "", // Clear reasoning
            },
          }
        : r)
    );
  }

  // ── Run entire column ─────────────────────────────────────────────────────
  async function runColumn(col: AiColumn, runMode: "all_force" | "empty_only" = "all_force") {
    const key = `col:${col.id}`;
    const abortController = new AbortController();
    setAbortControllers(prev => ({ ...prev, [key]: abortController }));
    setRunningColumnId(col.id);

    const targetIds = selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id);
    const targetRows = runMode === "empty_only"
      ? rows.filter((r) => targetIds.includes(r.id) && (() => {
          const raw = r.data[col.outputKey];
          const text = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
          return text === "" || /^notfound$/i.test(text);
        })())
      : rows.filter((r) => targetIds.includes(r.id));
    const runIds = targetRows.map((r) => r.id);

    // Optimistically mark targeted rows as running
    setRows((prev) =>
      prev.map((r) =>
        runIds.includes(r.id)
          ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } }
          : r
      )
    );
    try {
      const res = await fetch("/api/run/column", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, columnId: col.id, rowIds: targetIds, runMode, concurrency: sequentialMode ? 1 : 5 }),
        signal: abortController.signal,
      });
      const json = await res.json();
      const results = json.results;
      if (json.operationId) {
        setOperationIds(prev => ({ ...prev, [key]: json.operationId }));
      }
      setRows((prev) =>
        prev.map((r) => {
          const result = results?.[r.id];
          if (!result) return r;
          const extraData = result.multiValues ?? {};
          const metaData = result.metaData ?? {};
          const extraStatuses: Record<string,string> = {};
          for (const k of Object.keys(extraData)) extraStatuses[k] = result.status ?? "done";
          return {
            ...r,
            data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey], ...extraData, ...metaData },
            cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status, ...extraStatuses },
            cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors,
          };
        })
      );
    } finally {
      setAbortControllers(prev => { const { [key]: _, ...rest } = prev; return rest; });
      setRunningColumnId(null);
      setOperationIds(prev => { const { [key]: _, ...rest } = prev; return rest; });
    }
  }

  function stopColumn(col: AiColumn) {
    const key = `col:${col.id}`;
    const opId = operationIds[key];

    // Call server-side cancellation endpoint
    if (opId) {
      fetch(`/api/run/column?operationId=${opId}`, { method: 'DELETE' }).catch(console.error);
    }

    const controller = abortControllers[key];
    if (controller) {
      controller.abort();
      setAbortControllers(prev => { const { [key]: _, ...rest } = prev; return rest; });
    }
    setOperationIds(prev => { const { [key]: _, ...rest } = prev; return rest; });
    setRunningColumnId(null);
  }

  // ── Run all columns for selected rows ─────────────────────────────────────
  async function runSelectedRows() {
    if (!caseData) return;
    if (caseData.aiColumns.length === 0) {
      alert("Keine KI-Spalten konfiguriert. Bitte zuerst eine Prompt-Spalte hinzufügen.");
      return;
    }
    const key = `rows:${Date.now()}`;
    const abortController = new AbortController();
    setAbortControllers(prev => ({ ...prev, [key]: abortController }));
    setRunningRowIds(new Set(selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id)));

    const targetIds = selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id);
    try {
      for (const col of caseData.aiColumns) {
        setRows((prev) =>
          prev.map((r) =>
            targetIds.includes(r.id)
              ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } }
              : r
          )
        );
        const res = await fetch("/api/run/column", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, columnId: col.id, rowIds: targetIds, concurrency: sequentialMode ? 1 : 5 }),
          signal: abortController.signal,
        });
        const json = await res.json();
        const results = json.results;
        if (json.operationId) {
          setOperationIds(prev => ({ ...prev, [key]: json.operationId }));
        }
        setRows((prev) =>
          prev.map((r) => {
            const result = results?.[r.id];
            if (!result) return r;
            const extraData = result.multiValues ?? {};
            const extraStatuses: Record<string,string> = {};
            for (const k of Object.keys(extraData)) extraStatuses[k] = result.status ?? "done";
            return {
              ...r,
              data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey], ...extraData },
              cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status, ...extraStatuses },
              cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors,
            };
          })
        );
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        // Canceled
      } else {
        throw error;
      }
    } finally {
      setAbortControllers(prev => { const { [key]: _, ...rest } = prev; return rest; });
      setOperationIds(prev => { const { [key]: _, ...rest } = prev; return rest; });
      setRunningRowIds(new Set());
    }
  }

  function stopSelectedRows() {
    const key = Object.keys(abortControllers).find(k => k.startsWith('rows:'));
    const opId = key ? operationIds[key] : undefined;

    // Call server-side cancellation endpoint
    if (opId) {
      fetch(`/api/run/column?operationId=${opId}`, { method: 'DELETE' }).catch(console.error);
    }

    if (key) {
      const controller = abortControllers[key];
      if (controller) {
        controller.abort();
        setAbortControllers(prev => { const { [key]: _, ...rest } = prev; return rest; });
      }
    }
    if (opId && key) {
      setOperationIds(prev => { const { [key]: _, ...rest } = prev; return rest; });
    }
    setRunningRowIds(new Set());
  }

  // ── Delete rows ───────────────────────────────────────────────────────────
  async function deleteSelectedRows() {
    if (selectedRows.size === 0 || !confirm(`Delete ${selectedRows.size} row(s)?`)) return;
    await Promise.all([...selectedRows].map((id) => fetch(`/api/rows/${id}`, { method: "DELETE" })));
    setRows((prev) => prev.filter((r) => !selectedRows.has(r.id)));
    setSelectedRows(new Set());
  }

  // ── Delete column ─────────────────────────────────────────────────────────
  async function handleColDrop(targetKey: string) {
    if (!dragCol || dragCol === targetKey || !caseData) return;
    const order = colOrder.length > 0 ? colOrder : [
      ...sourceColumns, ...caseData.aiColumns.map(c => c.outputKey)
    ];
    const from = order.indexOf(dragCol);
    const to = order.indexOf(targetKey);
    if (from === -1 || to === -1) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, dragCol);
    setColOrder(next);
    setDragCol(null);
    setDragOverCol(null);
    await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnOrder: next }),
    });
  }

  async function deleteSourceColumn(key: string) {
    if (!confirm(`Spalte "${key}" löschen? Alle Werte in dieser Spalte gehen verloren.`)) return;
    await fetch(`/api/cases/${caseId}/delete-column`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ key }),
    });
    setSourceColumns(prev => prev.filter(k => k !== key));
    setColOrder(prev => prev.filter(k => k !== key));
    setRows(prev => prev.map(r => {
      const d = {...r.data}; delete d[key];
      return {...r, data: d};
    }));
  }

  async function deleteColumn(colId: string) {
    if (!caseData) return;
    const updated = caseData.aiColumns.filter((c) => c.id !== colId);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiColumns: updated }),
    });
    setCaseData(await res.json());
  }

  if (!caseData) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
        <Loader2 style={{width:20,height:20,color:"#7c3aed"}} className="animate-spin" />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const allSelected = rows.length > 0 && selectedRows.size === rows.length;
  const doneCount = rows.filter((r) => Object.values(r.cellStatuses).some((s) => s === "done")).length;
  const errorCount = rows.filter((r) => Object.values(r.cellStatuses).some((s) => s === "error")).length;
  const processedCount = rows.filter((r) => Object.values(r.cellStatuses).some((s) => s === "done" || s === "error")).length;
  const runTarget = rows.length - doneCount;
  const selCount = selectedRows.size > 0 ? selectedRows.size : rows.length;

  // shared cell editor
  function EditInput({ rowId, k }: { rowId: string; k: string }) {
    return (
      <input autoFocus value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
        style={{width:"100%",fontSize:13,border:"1px solid #16a34a",borderRadius:3,padding:"1px 4px",outline:"none"}} />
    );
  }

  const tabs = ["Tabelle","Einstellungen","Log","Export"] as const;

  return (
    <div style={{display:"flex",height:"100vh",background:"#f1f3f5",overflow:"hidden",fontFamily:"'Source Sans Pro',ui-sans-serif,system-ui,-apple-system,sans-serif",fontSize:14,color:"#1f2937"}}>

      {/* ════ SIDEBAR ════ */}
      <div style={{width:220,background:"#2d3748",borderRight:"1px solid #1a202c",display:"flex",flexDirection:"column",flexShrink:0}}>
        {/* Logo row */}
        <div style={{padding:"16px 18px 14px",borderBottom:"1px solid #3d4a5c"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
            <Database style={{width:18,height:18,color:"#68d391",flexShrink:0}} />
            <span style={{fontWeight:700,fontSize:15,color:"#f7fafc"}}>DataMiner</span>
          </div>
        </div>
        {/* New case */}
        <div style={{padding:"10px 12px",borderBottom:"1px solid #3d4a5c"}}>
          <button onClick={() => router.push("/cases")}
            style={{width:"100%",display:"flex",alignItems:"center",gap:6,padding:"8px 12px",borderRadius:6,border:"none",background:"#4a5568",cursor:"pointer",fontSize:13,color:"#e2e8f0",textAlign:"left"}}
            onMouseEnter={e=>(e.currentTarget.style.background="#68d391",e.currentTarget.style.color="#1a202c")}
            onMouseLeave={e=>(e.currentTarget.style.background="#4a5568",e.currentTarget.style.color="#e2e8f0")}>
            <Plus style={{width:14,height:14}} /> Neuer Case
          </button>
        </div>
        {/* Case item — active */}
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{margin:"8px 12px",borderRadius:6,background:"#3d4a5c",color:"#f7fafc",padding:"10px 14px",cursor:"pointer",borderLeft:"3px solid #68d391"}}>
            <div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>📁 {caseData.name}</div>
            <div style={{fontSize:11,opacity:0.8,marginTop:2}}>{rows.length} Zeilen · {new Date(caseData.updatedAt).toLocaleDateString("de-DE")}</div>
          </div>
        </div>
        {/* API key */}
        <div style={{padding:"12px 18px",borderTop:"1px solid #3d4a5c",fontSize:11,color:"#718096",display:"flex",alignItems:"center",gap:4}}>
          🔑 Global API Key (Fallback)
          <Settings style={{width:12,height:12,marginLeft:"auto",cursor:"pointer",color:"#9ca3af"}} onClick={() => router.push(`/cases/${caseId}/settings`)} />
        </div>
      </div>

      {/* ════ MAIN ════ */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* ── Case header ── */}
        <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",padding:"16px 28px 0",flexShrink:0}}>
          <div style={{marginBottom:6}}>
            <div style={{fontSize:16,fontWeight:700,color:"#111"}}>{caseData.name}</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:2,display:"flex",alignItems:"center",gap:8}}>
              <span>{new Date(caseData.createdAt).toLocaleDateString("de-DE")} · {rows.length} Zeilen · {sourceColumns.length} Quellspalten · {caseData.aiColumns.length} KI-Spalten</span>
              {totals.totalTokens > 0 && (
                <span style={{background:"#f0fdf4",color:"#15803d",padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:600}}>
                  🧠 {totals.totalTokens.toLocaleString()} tokens
                </span>
              )}
              {totals.totalCostEur > 0 && (
                <span style={{background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:600}}>
                  💰 €{totals.totalCostEur.toFixed(2)}
                </span>
              )}
            </div>
          </div>
          {/* Tabs */}
          <div style={{display:"flex",gap:0,marginTop:4}}>
            {tabs.map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{padding:"6px 16px",border:"none",borderBottom: activeTab===t ? "2px solid #15803d" : "2px solid transparent",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color: activeTab===t ? "#15803d" : "#6b7280",marginBottom:-1}}>
                {t==="Tabelle"?"📋 ":t==="Einstellungen"?"⚙️ ":t==="Log"?"📜 ":"📤 "}{t}
              </button>
            ))}
          </div>
        </div>

        {/* ══ TAB: TABELLE ══ */}
        {activeTab === "Tabelle" && (<>

          {/* Expanders + stats panel */}
          <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",flexShrink:0}}>

            {/* Expander 1 */}
            <div style={{borderBottom:"1px solid #f3f4f6"}}>
              <button onClick={() => setShowUpload(v=>!v)}
                style={{width:"100%",padding:"8px 16px",display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#374151",textAlign:"left"}}>
                <span style={{fontSize:10,color:"#9ca3af"}}>{showUpload?"▼":"▶"}</span>
                📂 Daten hochladen &amp; Spalten zuordnen
              </button>
              {showUpload && (
                <div style={{padding:"0 24px 10px",display:"flex",gap:8}}>
                  <button onClick={() => setShowImport(true)}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",border:"1px solid #d1d5db",borderRadius:6,background:"#fff",cursor:"pointer",fontSize:12,color:"#374151"}}>
                    <Upload style={{width:13,height:13}} /> CSV importieren
                  </button>
                </div>
              )}
            </div>

            {/* Expander 2 */}
            <div style={{borderBottom:"1px solid #f3f4f6"}}>
              <button onClick={() => {
                if (showPromptCols) {
                  setShowAddCol(true);
                  return;
                }
                setShowPromptCols(true);
              }}
                style={{width:"100%",padding:"8px 16px",display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#374151",textAlign:"left"}}>
                <span style={{fontSize:10,color:"#9ca3af"}}>{showPromptCols?"▼":"▶"}</span>
                ✨ Prompt-Spalten (direkt in Tabelle)
              </button>
              {showPromptCols && (
                <div style={{padding:"0 24px 10px",display:"flex",gap:8}}>
                  <button onClick={() => setShowAddCol(true)}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",border:"1px solid #86efac",borderRadius:6,background:"#f0fdf4",cursor:"pointer",fontSize:12,color:"#15803d"}}>
                    <Plus style={{width:13,height:13}} /> Prompt-Spalte hinzufügen
                  </button>
                  <a href={`/api/export?caseId=${caseId}`}
                    style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",border:"1px solid #d1d5db",borderRadius:6,background:"#fff",fontSize:12,color:"#374151",textDecoration:"none"}}>
                    <Download style={{width:13,height:13}} /> Export
                  </a>
                </div>
              )}
            </div>

            {/* Stats row */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:"1px solid #f3f4f6"}}>
              {[
                {n:rows.length,l:"Gesamt",c:"#111827"},
                {n:processedCount,l:"Verarbeitet",c:"#6b7280"},
                {n:doneCount,l:"✓ Fertig",c:"#059669"},
                {n:errorCount,l:"✗ Fehler",c:"#dc2626"},
              ].map((s,i) => (
                <div key={i} style={{textAlign:"center",padding:"12px 0",borderRight: i<3 ? "1px solid #f3f4f6" : "none"}}>
                  <div style={{fontSize:32,fontWeight:700,lineHeight:1,color:s.c}}>{s.n}</div>
                  <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Filter + range row */}
            <div style={{padding:"6px 16px",display:"flex",alignItems:"center",gap:12,borderBottom:"1px solid #f3f4f6",flexWrap:"wrap"}}>
              <select style={{fontSize:12,border:"1px solid #d1d5db",borderRadius:5,padding:"3px 8px",color:"#374151",background:"#fff"}}>
                <option>Alle nicht-fertigen ({rows.length - doneCount})</option>
                <option>Alle</option>
                <option>Nur Fertige</option>
                <option>Nur Fehler</option>
              </select>
              {(["Von","Bis","Max"] as const).map((lbl,i) => {
                const val = i===0?rangeVon:i===1?rangeBis:rangeMax;
                const set = i===0?setRangeVon:i===1?setRangeBis:setRangeMax;
                return (
                  <div key={lbl} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:"#6b7280"}}>
                    <span>{lbl}</span>
                    <button onClick={()=>set(v=>Math.max(0,v-1))} style={{width:20,height:20,border:"1px solid #d1d5db",borderRadius:4,background:"#fff",cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                    <input value={val} onChange={e=>set(Number(e.target.value))} style={{width:lbl==="Bis"?52:40,textAlign:"center",border:"1px solid #d1d5db",borderRadius:4,padding:"2px 4px",fontSize:12}} />
                    <button onClick={()=>set(v=>v+1)} style={{width:20,height:20,border:"1px solid #d1d5db",borderRadius:4,background:"#fff",cursor:"pointer",fontSize:12,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                  </div>
                );
              })}
            </div>

            {/* Pipeline label */}
            <div style={{padding:"3px 16px",fontSize:11,color:"#9ca3af",borderBottom:"1px solid #f3f4f6"}}>
              Pipeline-Modus: Nur Prompt-Spalten (ohne System-Prompt)
            </div>

            {/* No AI columns warning */}
            {caseData.aiColumns.length === 0 && (
              <div style={{padding:"8px 16px",background:"#fefce8",borderBottom:"1px solid #fde68a",display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#92400e"}}>
                ⚠️ Keine KI-Spalten vorhanden — bitte zuerst eine
                <button onClick={()=>setShowAddCol(true)}
                  style={{padding:"2px 10px",background:"#16a34a",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontSize:12,fontWeight:600}}>
                  + Prompt-Spalte hinzufügen
                </button>
              </div>
            )}

            {/* Big run buttons row */}
            <div style={{padding:"8px 16px",display:"flex",alignItems:"center",gap:8}}>
              {runningRowIds.size > 0 ? (
                <button onClick={stopSelectedRows}
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"5px 14px",background:"#dc2626",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600}}
                >
                  X Stop — {runningRowIds.size} Zeilen
                </button>
              ) : (
                <button onClick={runSelectedRows}
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"5px 14px",background:"#16a34a",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600}}
                >
                  ▶ Starten — {selCount} Zeilen
                </button>
              )}
              <button
                onClick={() => setSequentialMode(prev => !prev)}
                title={sequentialMode ? "Sequenziell: 1 Zeile gleichzeitig" : "Parallel: 5 Zeilen gleichzeitig"}
                style={{padding:"4px 10px",border:`1px solid ${sequentialMode ? "#7c3aed" : "#d1d5db"}`,borderRadius:5,background:sequentialMode ? "#f5f3ff" : "#fff",cursor:"pointer",fontSize:12,color:sequentialMode ? "#7c3aed" : "#374151",fontWeight:sequentialMode?600:400}}
              >
                {sequentialMode ? "⏩ Sequenziell" : "⚡ Parallel"}
              </button>
              <button onClick={() => setSelectedRows(new Set())}
                style={{padding:"4px 10px",border:"1px solid #d1d5db",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:12,color:"#374151"}}>
                ↺ Zurücksetzen — {rows.length} Zeilen
              </button>
              <button onClick={() => { setSelectedRows(new Set()); setRows(prev => prev.map(r => ({...r,cellStatuses:{},cellErrors:{}}))); }}
                style={{padding:"4px 10px",border:"1px solid #d1d5db",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:12,color:"#374151"}}>
                ↺ Komplett-Reset
              </button>
            </div>
          </div>

          {/* ── TABLE ── */}
          <div style={{flex:1,overflowY:"auto",overflowX:"auto",background:"#f1f3f5",padding:"16px"}}>
          <div style={{background:"#fff",borderRadius:8,border:"1px solid #e5e7eb",overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:"max-content"}}>
              <thead style={{position:"sticky",top:0,zIndex:20}}>
                <tr style={{background:"#f9fafb",borderBottom:"1px solid #e5e7eb"}}>
                  <th style={{width:32,padding:"6px 8px",borderRight:"1px solid #e5e7eb"}}>
                    <input type="checkbox" checked={allSelected}
                      onChange={e => setSelectedRows(e.target.checked ? new Set(rows.map(r=>r.id)) : new Set())}
                      style={{width:13,height:13,cursor:"pointer"}} />
                  </th>
                  <th style={{width:36,padding:"6px 6px",borderRight:"1px solid #e5e7eb",color:"#9ca3af",fontWeight:400,fontSize:12,textAlign:"center"}}>▼ #</th>
                  {/* Status col — fixed */}
                  <th style={{padding:"8px 12px",borderRight:"1px solid #e5e7eb",textAlign:"left",fontWeight:600,fontSize:12,color:"#1f2937",whiteSpace:"nowrap",minWidth:90}}>
                    Status
                  </th>
                  {(colOrder.length > 0 ? colOrder : [...sourceColumns,...caseData.aiColumns.map(c=>c.outputKey)]).map(key => {
                    const aiCol = caseData.aiColumns.find(c=>c.outputKey===key);
                    const isSrc = sourceColumns.includes(key);
                    const isOrphan = !isSrc && !aiCol;
                    const isDragOver = dragOverCol === key;
                    return (
                      <th key={key}
                        draggable
                        onDragStart={()=>setDragCol(key)}
                        onDragOver={e=>{e.preventDefault();setDragOverCol(key);}}
                        onDragLeave={()=>setDragOverCol(null)}
                        onDrop={()=>handleColDrop(key)}
                        style={{padding:"8px 12px",borderRight:"1px solid #e5e7eb",textAlign:"left",fontWeight:600,fontSize:12,color:"#1f2937",whiteSpace:"nowrap",width: colWidths[key] ?? (key==="company_name"?200:aiCol?180:140),minWidth:80,cursor:"grab",background: isDragOver?"#dcfce7":aiCol?"#f0fdf4":isOrphan?"#f0fdfa":"#f9fafb",borderLeft: isDragOver?"2px solid #16a34a":undefined,userSelect:"none",position:"relative"}}>
                        {/* resize handle */}
                        <div
                          style={{position:"absolute",right:0,top:0,bottom:0,width:6,cursor:"col-resize",zIndex:10}}
                          onMouseDown={e=>{
                            e.stopPropagation(); e.preventDefault();
                            const startX = e.clientX;
                            const startW = colWidths[key] ?? (key==="company_name"?200:aiCol?180:140);
                            const onMove = (ev: MouseEvent) => {
                              const w = Math.max(80, startW + ev.clientX - startX);
                              setColWidths(prev=>({...prev,[key]:w}));
                            };
                            const onUp = () => { window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp); };
                            window.addEventListener("mousemove",onMove);
                            window.addEventListener("mouseup",onUp);
                          }}
                        />
                        <div style={{display:"flex",alignItems:"center",gap:4,overflow:aiCol?"visible":"hidden"}}>
                          <GripVertical style={{width:10,height:10,color:"#9ca3af",flexShrink:0}} />
                          {aiCol ? (
                            <ColumnHeaderMenu
                              column={aiCol}
                              onRunAll={() => runColumn(aiCol, "all_force")}
                              onRunEmptyOnly={() => runColumn(aiCol, "empty_only")}
                              onDelete={() => deleteColumn(aiCol.id)}
                              onEdit={() => setEditingPromptCol({ ...aiCol })}
                              onStop={() => stopColumn(aiCol)}
                              isRunning={runningColumnId === aiCol.id}
                            />
                          ) : isOrphan ? (
                            <span style={{flex:1,color:"#0d9488",fontSize:11,fontWeight:600}}>{key}</span>
                          ) : (
                            <div className="group/hdr" style={{display:"flex",alignItems:"center",gap:4,width:"100%"}}>
                              <span style={{flex:1}}>{key==="company_name"?"Firma":key}</span>
                              <button
                                onClick={e=>{e.stopPropagation();deleteSourceColumn(key);}}
                                className="opacity-0 group-hover/hdr:opacity-100"
                                style={{border:"none",background:"none",cursor:"pointer",padding:"1px 3px",color:"#9ca3af",transition:"opacity .15s",flexShrink:0}}
                                title={`Spalte "${key}" löschen`}>
                                <Trash2 style={{width:11,height:11}} />
                              </button>
                            </div>
                          )}
                        </div>
                      </th>
                    );
                  })}
                  <th onClick={()=>setShowAddCol(true)} style={{padding:"8px 12px",background:"#f9fafb",minWidth:100,cursor:"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();setShowAddCol(true);}}
                      style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:"#9ca3af",border:"none",background:"none",cursor:"pointer",whiteSpace:"nowrap"}}
                      onMouseEnter={e=>(e.currentTarget.style.color="#16a34a")}
                      onMouseLeave={e=>(e.currentTarget.style.color="#9ca3af")}>
                      <Plus style={{width:13,height:13}} /> Spalte
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={sourceColumns.length + caseData.aiColumns.length + 4}
                    style={{textAlign:"center",padding:"48px 0",color:"#9ca3af",fontSize:13}}>
                    Keine Zeilen. CSV importieren um zu starten.
                  </td></tr>
                ) : pageRows.map((row, rowIdx) => {
                  const rowDone = Object.values(row.cellStatuses).some(s=>s==="done");
                  const rowRunning = Object.values(row.cellStatuses).some(s=>s==="running");
                  const sel = selectedRows.has(row.id);
                  return (
                    <tr key={row.id} style={{background: sel?"#dcfce7":rowRunning?"#fefce8":"#fff",borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{width:32,padding:"6px 10px",borderRight:"1px solid #f3f4f6"}}>
                        <input type="checkbox" checked={sel}
                          onChange={e => { const s=new Set(selectedRows); e.target.checked?s.add(row.id):s.delete(row.id); setSelectedRows(s); }}
                          style={{width:13,height:13,cursor:"pointer"}} />
                      </td>
                      <td style={{width:36,padding:"6px 8px",borderRight:"1px solid #f3f4f6",color:"#d1d5db",textAlign:"center",fontSize:11}}>{page*pageSize+rowIdx+1}</td>
                      {/* Status badge — fixed */}
                      <td style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",whiteSpace:"nowrap"}}>
                        {rowRunning
                          ? <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#d97706",background:"#fef3c7",padding:"2px 8px",borderRadius:10}}>
                              <Loader2 style={{width:10,height:10}} className="animate-spin" /> Läuft
                            </span>
                          : rowDone
                            ? <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#059669",background:"#d1fae5",padding:"2px 8px",borderRadius:10}}>
                                ✓ Fertig
                              </span>
                            : <span style={{fontSize:11,color:"#9ca3af"}}>○ Ausstehend</span>}
                      </td>
                      {(colOrder.length > 0 ? colOrder : [...sourceColumns,...caseData.aiColumns.map(c=>c.outputKey)]).map(key => {
                        const aiCol = caseData.aiColumns.find(c=>c.outputKey===key);
                        const isSrc = sourceColumns.includes(key);
                        if (aiCol) {
                          const status: CellStatus = row.cellStatuses[aiCol.outputKey]??"idle";
                          const val = row.data[aiCol.outputKey]??"";
                          const err = row.cellErrors[aiCol.outputKey];
                          const isEd = editingCell?.rowId===row.id && editingCell.key===aiCol.outputKey;
                          return (
                            <td key={key} style={{padding:"5px 10px",borderRight:"1px solid #f3f4f6",background:status==="error"?"#fef2f2":undefined}} className="group/cell" onDoubleClick={()=>startEdit(row.id,aiCol.outputKey,val)}>
                              {isEd ? <EditInput rowId={row.id} k={aiCol.outputKey} /> : (
                                <div style={{display:"flex",alignItems:"center",gap:5,minHeight:24}}>
                                  {/* running spinner */}
                                  {status==="running" && <Loader2 style={{width:12,height:12,color:"#d97706",flexShrink:0}} className="animate-spin"/>}

                                  {(() => {
                                    const hasRun = status==="done"||status==="error"||status==="skipped";
                                    const notFound = status==="done" && !val;
                                    const isValid = val.startsWith("✓");
                                    const isInvalid = val.startsWith("✗");

                                    return (
                                      <>
                                        {/* idle — show run button on hover */}
                                        {status==="idle" && (
                                          <button onClick={()=>runCell(row.id,aiCol)}
                                            className="opacity-0 group-hover/cell:opacity-100"
                                            style={{display:"flex",alignItems:"center",gap:3,fontSize:11,color:"#16a34a",border:"none",background:"none",cursor:"pointer",transition:"opacity .15s",padding:0,flex:1}}>
                                            <Play style={{width:10,height:10}}/> Run
                                          </button>
                                        )}

                                        {/* skipped */}
                                        {status==="skipped" && (
                                          <span style={{fontSize:11,color:"#9ca3af",flex:1}}>⏭</span>
                                        )}

                                        {/* error */}
                                        {status==="error" && (
                                          <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,color:"#dc2626",flex:1}} title={err}>
                                            <AlertCircle style={{width:11,height:11,flexShrink:0}}/> {err?.slice(0,30)||"Fehler"}
                                          </span>
                                        )}

                                        {/* done but nothing found */}
                                        {notFound && (
                                          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#9ca3af",background:"#f3f4f6",padding:"2px 8px",borderRadius:6,flex:1}}>
                                            <XCircle style={{width:10,height:10,flexShrink:0,color:"#d1d5db"}}/>
                                            <span style={{fontStyle:"italic"}}>nicht gefunden</span>
                                          </span>
                                        )}

                                        {/* valid domain */}
                                        {isValid && (
                                          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:600,color:"#15803d",background:"#dcfce7",padding:"2px 8px",borderRadius:6,flex:1,minWidth:0,overflow:"hidden"}}>
                                            <CheckCircle style={{width:10,height:10,flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val.slice(2)}</span>
                                          </span>
                                        )}

                                        {/* invalid domain */}
                                        {isInvalid && (
                                          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:600,color:"#dc2626",background:"#fee2e2",padding:"2px 8px",borderRadius:6,flex:1,minWidth:0,overflow:"hidden"}}>
                                            <XCircle style={{width:10,height:10,flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val.slice(2)}</span>
                                          </span>
                                        )}

                                        {/* plain value */}
                                        {val && !isValid && !isInvalid && status!=="error" && status!=="skipped" && (
                                          <span style={{fontSize:12,color:"#1f2937",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val}</span>
                                        )}

                                        {/* action buttons — always visible after run, hover-only when idle */}
                                        <div style={{display:"flex",alignItems:"center",gap:1,flexShrink:0}}>
                                          {status === "running" ? (
                                            <button onClick={e=>{e.stopPropagation();stopCell(row.id,aiCol);}}
                                              style={{border:"none",background:"none",cursor:"pointer",padding:"2px",color:"#dc2626",display:"flex"}} title="Stop">
                                              <XCircle style={{width:9,height:9}}/>
                                            </button>
                                          ) : (
                                            <button onClick={e=>{e.stopPropagation();runCell(row.id,aiCol);}}
                                              className={hasRun ? undefined : "opacity-0 group-hover/cell:opacity-100"}
                                              style={{border:"none",background:"none",cursor:"pointer",padding:"2px",color:"#d1d5db",display:"flex",transition:"opacity .15s"}} title="Erneut ausführen">
                                              <Play style={{width:9,height:9}}/>
                                            </button>
                                          )}
                                          {/* Info always visible after run */}
                                          <button onClick={e=>{e.stopPropagation();setRunDetailCell({col:aiCol,row});}}
                                            className={hasRun ? undefined : "opacity-0 group-hover/cell:opacity-100"}
                                            style={{border:"none",background:"none",cursor:"pointer",padding:"2px",display:"flex",transition:"opacity .15s",
                                              color: notFound?"#f59e0b": hasRun?"#60a5fa":"#d1d5db"}} title="Details anzeigen">
                                            <Info style={{width:10,height:10}}/>
                                          </button>
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              )}
                            </td>
                          );
                        }
                        const val = row.data[key]??"";
                        const isEd = editingCell?.rowId===row.id && editingCell.key===key;
                        const isValidated = !isSrc && !aiCol; // orphan multiKey output
                        const isReasoning = key.startsWith("_reasoning_");
                        return (
                          <td key={key} style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",maxWidth:200,
                            background: isValidated ? (val.startsWith("✗")?"#fef2f2":val.startsWith("✓")?"#f0fdf4":undefined) : undefined,
                            cursor: isReasoning && val ? "pointer" : undefined
                          }} onDoubleClick={()=>startEdit(row.id,key,val)} onClick={() => {
                            if (isReasoning && val) {
                              setReasoningModal({ content: val, title: key.replace("_reasoning_", "") });
                            }
                          }}>
                            {isEd ? <EditInput rowId={row.id} k={key} /> :
                              <span style={{fontSize:12,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                                color: isValidated ? (val.startsWith("✗")?"#dc2626":val.startsWith("✓")?"#15803d":"#4b5563") : isReasoning?"#7c3aed":key==="company_name"?"#1f2937":"#4b5563",
                                fontStyle: isReasoning?"italic":undefined
                              }} title={val}>{isReasoning ? `🧠 ${val}` : val}</span>}
                          </td>
                        );
                      })}
                      <td style={{minWidth:80}} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div></div>

          {/* Pagination */}
          <div style={{background:"#fff",borderTop:"1px solid #e5e7eb",padding:"4px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,fontSize:12,color:"#6b7280"}}>
            <span>Page Size: <select style={{fontSize:12,border:"1px solid #d1d5db",borderRadius:4,padding:"1px 4px"}}><option>50</option><option>100</option></select></span>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
                style={{padding:"2px 8px",border:"1px solid #d1d5db",borderRadius:4,background:"#fff",cursor:"pointer",opacity:page===0?.4:1}}>‹</button>
              <span>{rows.length>0?`${page*pageSize+1} to ${Math.min((page+1)*pageSize,rows.length)} of ${rows.length}`:"-"}</span>
              <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
                style={{padding:"2px 8px",border:"1px solid #d1d5db",borderRadius:4,background:"#fff",cursor:"pointer",opacity:page>=totalPages-1?.4:1}}>›</button>
              <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1}
                style={{padding:"2px 8px",border:"1px solid #d1d5db",borderRadius:4,background:"#fff",cursor:"pointer",opacity:page>=totalPages-1?.4:1}}>»</button>
            </div>
            <span>Page {page+1} of {totalPages}</span>
          </div>

        </>)}

        {/* ══ TAB: LOG ══ */}
        {activeTab === "Log" && (
          <div style={{flex:1,background:"#0f172a",color:"#94a3b8",fontFamily:"monospace",fontSize:12,overflowY:"auto",padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontWeight:600,color:"#cbd5e1"}}>Activity Log — {caseData.name}</span>
              <button onClick={async()=>{ await fetch(`/api/logs?caseId=${caseId}`,{method:"DELETE"}); setLogs([]); }}
                style={{fontSize:11,color:"#64748b",border:"1px solid #334155",borderRadius:4,padding:"2px 8px",background:"none",cursor:"pointer"}}>
                Logs löschen
              </button>
            </div>
            {logs.length===0
              ? <span style={{color:"#475569"}}>Noch keine Logs.</span>
              : logs.map(l => (
                <div key={l.id} style={{lineHeight:1.6,padding:"1px 4px",borderRadius:3}}>
                  <span style={{color:"#475569",marginRight:10,userSelect:"none"}}>{new Date(l.createdAt).toLocaleTimeString("de-DE")}</span>
                  {l.message}
                </div>
              ))}
          </div>
        )}

        {/* ══ TAB: EXPORT ══ */}
        {activeTab === "Export" && (
          <div style={{flex:1,padding:24,display:"flex",flexDirection:"column",gap:16}}>

            {/* CSV export */}
            <div style={{maxWidth:480,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb",padding:24}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>📊 CSV exportieren</div>
              <div style={{fontSize:13,color:"#6b7280",marginBottom:16}}>{rows.length} Zeilen · {sourceColumns.length + caseData.aiColumns.length} Spalten — nur Datenwerte, kein Setup</div>
              <a href={`/api/export?caseId=${caseId}`}
                style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 20px",background:"#15803d",color:"#fff",borderRadius:8,fontSize:13,fontWeight:600,textDecoration:"none"}}>
                <Download style={{width:15,height:15}} /> CSV herunterladen
              </a>
            </div>

            {/* Full snapshot export */}
            <div style={{maxWidth:480,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb",padding:24}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>💾 Vollständiger Snapshot</div>
              <div style={{fontSize:13,color:"#6b7280",marginBottom:16}}>Exportiert alle Zeilen <strong>und</strong> die komplette Spalten-Konfiguration (Prompts, Web-Search-Einstellungen usw.) als JSON. Kann auf einem anderen PC wiederhergestellt werden.</div>
              <a href={`/api/export/snapshot?caseId=${caseId}`}
                style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 20px",background:"#1d4ed8",color:"#fff",borderRadius:8,fontSize:13,fontWeight:600,textDecoration:"none"}}>
                <Download style={{width:15,height:15}} /> Snapshot herunterladen (.json)
              </a>
            </div>

            {/* Snapshot import/restore */}
            <div style={{maxWidth:480,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb",padding:24}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>📥 Snapshot wiederherstellen</div>
              <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>Lade eine <code style={{background:"#f3f4f6",padding:"1px 5px",borderRadius:4}}>*_snapshot.json</code>-Datei hoch — es wird ein neuer Case mit allen Zeilen und der Konfiguration angelegt.</div>
              <label style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 20px",background:"#7c3aed",color:"#fff",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                <Upload style={{width:15,height:15}} /> Snapshot importieren
                <input type="file" accept=".json,application/json" style={{display:"none"}} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const snap = JSON.parse(text);
                    const res = await fetch("/api/import/snapshot", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(snap) });
                    const data = await res.json();
                    if (!res.ok) { alert("Fehler: " + (data.error ?? "Unbekannt")); return; }
                    if (confirm(`✅ ${data.imported} Zeilen importiert. Zum neuen Case wechseln?`)) {
                      window.location.href = `/cases/${data.caseId}`;
                    }
                  } catch (err) {
                    alert("Ungültige Snapshot-Datei: " + String(err));
                  }
                  e.target.value = "";
                }} />
              </label>
            </div>

          </div>
        )}

        {/* ══ TAB: EINSTELLUNGEN ══ */}
        {activeTab === "Einstellungen" && (
          <SettingsPanel caseId={caseId} onCaseUpdated={setCaseData} />
        )}

      </div>

      {showAddCol && <AddColumnModal caseId={caseId} onClose={()=>setShowAddCol(false)} onAdded={(u:Case)=>{
        setCaseData(u);
        setColOrder(prev => {
          const existing = new Set(prev);
          const newKeys = u.aiColumns.map((c:AiColumn)=>c.outputKey).filter((k:string)=>!existing.has(k));
          return newKeys.length > 0 ? [...prev, ...newKeys] : prev;
        });
        setShowAddCol(false);
      }}
        availableFields={[...sourceColumns, ...caseData.aiColumns.map(c=>c.outputKey)]} />}
      {showImport && <ImportModal caseId={caseId} onClose={()=>setShowImport(false)} onImported={()=>{setShowImport(false);refresh();}} />}
      {(editingPromptCol || editingPromptCell) && caseData && (
        <EditPromptModal
          col={editingPromptCell?.col ?? editingPromptCol!}
          caseId={caseId}
          onSave={(updated) => {
            setCaseData(prev => prev ? {...prev, aiColumns: prev.aiColumns.map(c => c.id===updated.id ? updated : c)} : prev);
          }}
          onClose={() => { setEditingPromptCol(null); setEditingPromptCell(null); }}
          cellContext={editingPromptCell ? (() => {
            const col = editingPromptCell.col;
            const row = editingPromptCell.row;
            const multiKeys = col.multiKeys ?? [];
            const extraKey = col.validateDomain ? [...multiKeys.map(mk=>mk.outputKey), "domain_validated"] : multiKeys.map(mk=>mk.outputKey);
            const multiValues = extraKey.length > 0
              ? Object.fromEntries(extraKey.map(k => [k, row.data[k] ?? ""]))
              : undefined;
            return {
              rowId: row.id,
              value: row.data[col.outputKey] ?? "",
              status: row.cellStatuses[col.outputKey] ?? "idle",
              error: row.cellErrors[col.outputKey],
              rowLabel: row.data["company_name"] ?? row.data["Unternehmensname"] ?? row.data["Name"] ?? row.data["name"] ?? row.id.slice(0,8),
              multiValues,
            };
          })() : undefined}
          onRunCell={editingPromptCell ? () => runCell(editingPromptCell.row.id, editingPromptCell.col) : undefined}
          onOpenRunDetail={editingPromptCell ? () => {
            setRunDetailCell({ col: editingPromptCell.col, row: editingPromptCell.row });
            setEditingPromptCol(null);
            setEditingPromptCell(null);
          } : undefined}
          availableFields={[
            ...sourceColumns,
            ...caseData.aiColumns.filter(c => c.id !== (editingPromptCell?.col.id ?? editingPromptCol?.id)).map(c => c.outputKey),
          ]}
        />
      )}
      {runDetailCell && (
        <RunDetailModal
          col={runDetailCell.col}
          row={runDetailCell.row}
          caseId={caseId}
          onClose={()=>setRunDetailCell(null)}
          onRowUpdate={(rowId, patch) => {
            setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...patch } : r));
            // keep modal in sync if still open
            setRunDetailCell(prev => prev && prev.row.id === rowId ? { ...prev, row: { ...prev.row, ...patch } } : prev);
          }}
        />
      )}
      {reasoningModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50}}>
          <div style={{background:"#fff",borderRadius:12,padding:24,maxWidth:600,width:"90%",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <h3 style={{fontSize:16,fontWeight:700,color:"#1f2937",margin:0}}>🧠 Reasoning: {reasoningModal.title}</h3>
              <button onClick={()=>setReasoningModal(null)} style={{border:"none",background:"none",cursor:"pointer",padding:4,color:"#9ca3af"}}>
                <XCircle style={{width:20,height:20}} />
              </button>
            </div>
            <div style={{flex:1,overflowY:"auto",background:"#f9fafb",borderRadius:8,padding:16,fontSize:13,lineHeight:1.6,color:"#374151",whiteSpace:"pre-wrap"}}>
              {reasoningModal.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
