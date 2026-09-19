"use client";

import { useEffect, useState, useCallback, use, useRef, useContext } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Play, Upload, Trash2, Settings, Save, Sparkles,
  Loader2, CheckCircle2, XCircle, SkipForward, Zap,
  Download, ScrollText, ChevronLeft, ChevronRight, GripVertical,
  Database, Info, CheckCircle, AlertCircle, Search, MapPin, Building2, Gauge, Sliders
} from "lucide-react";
import type { Case, RowData, AiColumn, CellStatus } from "@/lib/types";
import { AddColumnModal } from "@/components/AddColumnModal";
import { AgentGoalModal } from "@/components/AgentGoalModal";
import { useAgentRun } from "@/hooks/useAgentRun";
import AppendModal from "@/components/AppendModal";
import ImportModal from "@/components/ImportModal";
import { ColumnHeaderMenu } from "@/components/ColumnHeaderMenu";
import GroupedTableView from "@/components/GroupedTableView";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";
import RunDetailModal from "@/components/case/RunDetailModal";
import EditPromptModal from "@/components/case/EditPromptModal";
import { ExportModal } from "@/components/ExportModal";
import CostDashboard from "@/components/case/CostDashboard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useCaseData } from "@/hooks/useCaseData";
import { useRunColumns } from "@/hooks/useRunColumns";
import { CaseContext } from "@/hooks/CaseContext";

/** Human-readable label for a column key (client-safe, no server imports) */
const COL_LABELS: Record<string, string> = {
  company_name: "Firma",
  contacts: "Kontakt",
  domain: "Domain",
  phone: "Telefon",
  email: "E-Mail",
  company_email: "E-Mail (Firma)",
  contact_email: "E-Mail (Kontakt)",
  address: "Adresse",
  city: "Stadt",
  zip: "PLZ",
  industry: "Branche",
  description: "Beschreibung",
  employees: "Mitarbeiter",
  founded: "Gründungsjahr",
  first_name: "Vorname",
  last_name: "Nachname",
  position: "Position",
  linkedin: "LinkedIn",
  // Maps / Places fields
  maps_url: "🗺 Maps-Link",
  maps_rating: "★ Rating",
  maps_reviews: "Bewertungen",
  category: "Kategorie",
  _scrape_cached_ts: "⚡ Cache-Status",
  // Batch AI columns
  _batch_firmendaten: "🏢 Firmendaten",
  _batch_kontakte: "👤 Entscheider",
  _batch_status: "Anreicherung",
};

/** Strip leading emoji + trim for compact display in column header */
function shortColName(name: string): string {
  return name.replace(/^[\p{Emoji}\s]+/u, "").trim();
}


// ── Inline Settings Panel ─────────────────────────────────────────────────────
function colLabel(key: string): string {
  return COL_LABELS[key] ?? key;
}

function SettingsPanel({ caseId, onCaseUpdated }: { caseId: string; onCaseUpdated: (c: Case) => void }) {
  // Use shared context — avoids re-fetching case data that CasePage already has
  const ctx = useContext(CaseContext);
  const [caseData, setCaseDataLocal] = useState<Case | null>(ctx?.caseData ?? null);
  const [name, setName] = useState(ctx?.caseData?.name ?? "");
  const [edenApiKey, setEdenApiKey] = useState("");
  const [edenApiKeyMasked, setEdenApiKeyMasked] = useState<string | undefined>(ctx?.caseData?.edenApiKeyMasked);
  const [modelCatalog, setModelCatalog] = useState<string[]>([]);
  const [enabledModels, setEnabledModels] = useState<string[]>([]);
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsSavedMsg, setModelsSavedMsg] = useState(false);
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [smokeResults, setSmokeResults] = useState<Array<{ model: string; provider: string; ok: boolean; latencyMs: number; preview?: string; error?: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [editingCol, setEditingCol] = useState<AiColumn | null>(null);
  const [addingCol, setAddingCol] = useState(false);
  const [newCol, setNewCol] = useState<Partial<AiColumn>>({});

  // Sync from context when it updates (no separate fetch needed)
  useEffect(() => {
    if (ctx?.caseData) {
      setCaseDataLocal(ctx.caseData);
      setName(ctx.caseData.name);
      setEdenApiKeyMasked(ctx.caseData.edenApiKeyMasked);
    } else {
      // Fallback: fetch if context not available
      fetch(`/api/cases/${caseId}`).then(r => r.json()).then((c: Case) => {
        setCaseDataLocal(c); setName(c.name);
        setEdenApiKey(""); setEdenApiKeyMasked(c.edenApiKeyMasked);
      });
    }
  }, [caseId, ctx?.caseData?.updatedAt]);

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
    const updated = ctx?.updateCase
      ? await ctx.updateCase({ name: name.trim(), edenApiKey: edenApiKey.trim() || undefined })
      : await fetch(`/api/cases/${caseId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), edenApiKey: edenApiKey.trim() || undefined }),
        }).then(r => r.json());
    setCaseDataLocal(updated);
    onCaseUpdated(updated);
    setEdenApiKey("");
    setEdenApiKeyMasked(updated.edenApiKeyMasked);
    setSaving(false); setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000);
  }

  function toggleEnabledModel(model: string) {
    setEnabledModels((prev) => prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]);
  }

  async function saveModelAllowlist() {
    setModelsSaving(true);
    const updated = ctx?.updateCase
      ? await ctx.updateCase({ modelAllowlist: enabledModels })
      : await fetch(`/api/cases/${caseId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelAllowlist: enabledModels }),
        }).then(r => r.json());
    setCaseDataLocal(updated);
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
    setCaseDataLocal(updated); onCaseUpdated(updated); return updated;
  }

  async function saveColEdit() {
    if (!editingCol || !caseData) return;
    await saveCols((caseData?.aiColumns ?? []).map(c => c.id === editingCol.id ? editingCol : c));
    setEditingCol(null);
  }

  async function addCol() {
    if (!caseData || !newCol.name || !newCol.prompt || !newCol.outputKey) return;
    const col: AiColumn = {
      id: crypto.randomUUID(), name: newCol.name, prompt: newCol.prompt,
      outputKey: newCol.outputKey, model: newCol.model || "openai/gpt-4o-mini",
      outputMode: newCol.outputMode as "text"|"json"|undefined,
      jsonKey: newCol.jsonKey, condition: newCol.condition, conditionField: newCol.conditionField,
    };
    await saveCols([...(caseData?.aiColumns ?? []), col]);
    setAddingCol(false); setNewCol({});
  }

  if (!caseData) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}><Loader2 className="animate-spin" style={{width:20,height:20,color:"#7c3aed"}} /></div>;

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
            <select style={inp} value={col.model||"openai/gpt-4o-mini"} onChange={e=>onChange({...col,model:e.target.value})}>
              {DEFAULT_MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
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
    <div style={{flex:1,overflowY:"auto",padding:"24px 32px",background:"#f9fafb"}}>

      {/* General */}
      <div style={card}>
        <div style={{fontSize:15,fontWeight:700,color:"#111",marginBottom:16}}>⚙️ Allgemein</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          <div><label style={lbl}>Case-Name</label><input style={inp} value={name} onChange={e=>setName(e.target.value)} /></div>
          <div>
            <label style={lbl}>Eden AI API Key (einziger LLM-Provider)</label>
            <input style={{...inp,fontFamily:"monospace"}} type="password" value={edenApiKey} onChange={e=>setEdenApiKey(e.target.value)} placeholder={edenApiKeyMasked ? `Gespeichert: ${edenApiKeyMasked}` : "leer = EDEN_API_KEY aus Env"} />
            <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Ein Key für alle Modelle (openai/, anthropic/, google/, mistral/, meta/…). Optional — sonst greift EDEN_API_KEY via Infisical. Wird serverseitig verschlüsselt gespeichert.</div>
          </div>
        </div>
        <button style={btn("#7c3aed")} onClick={saveMeta} disabled={saving}>
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
          </div>
        </div>
        {/* Model curation is global — link to /settings/models */}
        <a href="/settings/models"
          style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",border:"1px solid #e9d5ff",borderRadius:8,background:"#f5f3ff",textDecoration:"none",color:"#6d28d9",marginBottom:10}}>
          <Sliders style={{width:16,height:16,flexShrink:0}} />
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:600}}>Globale Modell-Curation</div>
            <div style={{fontSize:11,color:"#7c3aed",marginTop:1}}>Welche Modelle in allen Cases angeboten werden — in den globalen Einstellungen konfigurieren</div>
          </div>
          <span style={{fontSize:12,color:"#a78bfa"}}>→</span>
        </a>
        <div style={{fontSize:11,color:"#9ca3af"}}>
          Aktive Modelle aus globalem Katalog: <strong style={{color:"#6d28d9"}}>{enabledModels.length > 0 ? enabledModels.length : modelCatalog.length}</strong>
        </div>
        {smokeError && <div style={{marginTop:10,fontSize:12,color:"#dc2626"}}>{smokeError}</div>}
        {smokeResults.length > 0 && (
          <div style={{marginTop:12,display:"grid",gap:6}}>
            {smokeResults.map((r) => (
              <div key={`settings-smoke-${r.model}`} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:"6px 8px"}}>
                <span style={{fontFamily:"monospace",fontWeight:600,color:"#111827"}}>{r.model}</span>
                <span style={{color:"#6b7280"}}>· {r.provider}</span>
                <span style={{color:"#6b7280"}}>· {r.latencyMs}ms</span>
                <span style={{marginLeft:"auto",color:r.ok?"#7c3aed":"#dc2626",fontWeight:700}}>{r.ok ? "PASS" : "FAIL"}</span>
                <span style={{color:r.ok?"#5b21b6":"#991b1b"}}>{r.ok ? (r.preview || "ok") : (r.error || "error")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Columns */}
      <div style={card}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:700,color:"#111"}}>✨ KI-Spalten ({(caseData?.aiColumns ?? []).length})</div>
          <button style={btn("#7c3aed")} onClick={()=>{setAddingCol(true);setNewCol({model:"openai/gpt-4o-mini",outputMode:"text"});}}>
            <Plus style={{width:12,height:12}} /> Neue KI-Spalte
          </button>
        </div>

        {/* Add form */}
        {addingCol && (
          <div style={{border:"2px solid #7c3aed",borderRadius:8,padding:16,marginBottom:16,background:"#f5f3ff"}}>
            <div style={{fontSize:13,fontWeight:600,color:"#6d28d9",marginBottom:12}}>➕ Neue Spalte</div>
            <ColForm col={newCol} onChange={setNewCol} />
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button style={btn("#7c3aed")} onClick={addCol}>Hinzufügen</button>
              <button style={btn("#fff","#374151")} onClick={()=>{setAddingCol(false);setNewCol({});}}>Abbrechen</button>
            </div>
          </div>
        )}

        {(caseData?.aiColumns ?? []).length === 0 && !addingCol && (
          <div style={{textAlign:"center",padding:"32px 0",color:"#9ca3af",fontSize:13}}>
            Noch keine KI-Spalten. Klicke auf "Neue KI-Spalte" um zu starten.
          </div>
        )}

        <div style={{display:"grid",gap:8}}>
          {(caseData?.aiColumns ?? []).map(col => (
            <div key={col.id} style={{border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",background:editingCol?.id===col.id?"#f5f3ff":"#fff"}}
                onClick={()=>setEditingCol(editingCol?.id===col.id ? null : {...col})}>
                <Sparkles style={{width:14,height:14,color:"#7c3aed",flexShrink:0}} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:600,fontSize:13,color:"#111"}}>{col.name}</div>
                  <div style={{fontSize:11,color:"#9ca3af",fontFamily:"monospace",marginTop:1}}>
                    → {col.outputKey} · {col.model||"openai/gpt-4o-mini"} · {col.outputMode||"text"}
                    {col.condition ? ` · wenn ${col.condition}` : ""}
                  </div>
                </div>
                <span style={{fontSize:11,color:"#9ca3af"}}>{editingCol?.id===col.id?"▲":"▼"}</span>
                <button onClick={e=>{e.stopPropagation();if(!confirm(`"${col.name}" löschen?`))return;saveCols((caseData?.aiColumns ?? []).filter(c=>c.id!==col.id));}}
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
                    <button style={btn("#7c3aed")} onClick={saveColEdit}>Speichern</button>
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

function EmailExtrapolateButton({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [stats, setStats] = useState({ processed: 0, confirmed: 0, total: 0, catchAll: 0 });
  const [learned, setLearned] = useState<string[]>([]);

  async function run(verify: boolean) {
    setState("running");
    setStats({ processed: 0, confirmed: 0, total: 0, catchAll: 0 });
    try {
      const res = await fetch(`/api/cases/${caseId}/extrapolate-email/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verify, concurrency: 6, timeoutMs: 5000 }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          const d = line.replace(/^data: /, "").trim();
          if (!d) continue;
          try {
            const ev = JSON.parse(d);
            if (ev.type === "learned") setLearned(ev.patterns ?? []);
            if (ev.type === "start") setStats(s => ({ ...s, total: ev.total }));
            if (ev.type === "progress") setStats(s => ({
              ...s,
              processed: s.processed + 1,
              confirmed: s.confirmed + (ev.status === "confirmed" ? 1 : 0),
              catchAll: s.catchAll + (ev.status === "catchall" ? 1 : 0),
            }));
            if (ev.type === "done") { onDone(); setState("done"); }
          } catch { /* skip */ }
        }
      }
    } catch { setState("idle"); }
  }

  if (state === "idle" || state === "done") return (
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <button onClick={() => run(false)}
        title="Email-Adressen aus Kontaktnamen + Domain ableiten (ohne SMTP-Check)"
        style={{display:"flex",alignItems:"center",gap:4,padding:"4px 9px",border:"1px solid #c4b5fd",borderRadius:5,background:"#f5f3ff",cursor:"pointer",fontSize:12,color:"#7c3aed"}}>
        ⚡ Emails
      </button>
      <button onClick={() => run(true)}
        title="Emails ableiten + SMTP-Verify (langsamer, ~30s)"
        style={{padding:"4px 6px",border:"1px solid #c4b5fd",borderRadius:5,background:"#f5f3ff",cursor:"pointer",fontSize:10,color:"#7c3aed"}}>
        +✓
      </button>
    </div>
  );

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 9px",border:"1px solid #c4b5fd",borderRadius:5,background:"#f5f3ff",fontSize:11,color:"#7c3aed"}}>
      <Loader2 style={{width:10,height:10}} className="animate-spin"/>
      {stats.processed}/{stats.total}
      {stats.confirmed > 0 && <span style={{color:"#15803d",fontWeight:600}}>✓{stats.confirmed}</span>}
      {learned.length > 0 && <span style={{fontSize:9,color:"#a78bfa"}}>{learned[0]}</span>}
    </div>
  );
}

function ReflagCatalogsButton({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<{ flagged: number; promoted: number; learnedDomains: string[] } | null>(null);

  async function run() {
    setState("running");
    try {
      const res = await fetch(`/api/cases/${caseId}/reflag-catalogs`, { method: "POST" });
      const data = await res.json();
      setResult(data);
      setState("done");
      onDone();
    } catch { setState("idle"); }
  }

  if (state === "running") return (
    <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #d1d5db",borderRadius:5,background:"#f9fafb",fontSize:12,color:"#6b7280"}}>
      <Loader2 style={{width:10,height:10}} className="animate-spin"/> Prüfe Rows…
    </div>
  );

  if (state === "done" && result) return (
    <button onClick={() => setState("idle")}
      title={result.learnedDomains.length > 0 ? `Gelernt: ${result.learnedDomains.join(", ")}` : ""}
      style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #bbf7d0",borderRadius:5,background:"#f0fdf4",cursor:"pointer",fontSize:12,color:"#166534"}}>
      ✓ {result.flagged} geflaggt{result.learnedDomains.length > 0 ? ` · ${result.learnedDomains.length} gelernt` : ""}
    </button>
  );

  return (
    <button onClick={run}
      title="Alle Rows prüfen — bekannte Katalogseiten als solche markieren und in den Quellen-Tab verschieben"
      style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #d1d5db",borderRadius:5,background:"#f9fafb",cursor:"pointer",fontSize:12,color:"#374151",fontWeight:500}}>
      🔍 Kataloge erkennen
    </button>
  );
}

function CatalogDeepCrawlButton({ caseId, onDone, catalogCount }: { caseId: string; onDone: () => void; catalogCount: number }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [stats, setStats] = useState({ done: 0, total: 0, added: 0 });
  const [currentCatalog, setCurrentCatalog] = useState("");

  async function run() {
    setState("running");
    setStats({ done: 0, total: catalogCount, added: 0 });
    try {
      const res = await fetch(`/api/cases/${caseId}/deep-crawl-catalogs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPagesPerCatalog: 3, dryRun: false }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          const d = line.replace(/^data: /, "").trim();
          if (!d) continue;
          try {
            const ev = JSON.parse(d);
            if (ev.type === "catalog_start") { setCurrentCatalog(ev.name?.slice(0, 30) ?? ""); }
            if (ev.type === "catalog_done") { setStats(s => ({ ...s, done: s.done + 1, added: s.added + (ev.added ?? 0) })); }
            if (ev.type === "done") { onDone(); setState("done"); }
          } catch { /* skip */ }
        }
      }
    } catch { setState("idle"); }
  }

  const catalogLabel = `📋 Kataloge scrapen (${catalogCount})`;

  if (state === "idle" || state === "done") return (
    <button onClick={run}
      title={`${catalogCount} gefundene Katalogseiten scrapen — extrahiert alle dort gelisteten Firmen`}
      style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #fde68a",borderRadius:5,background:"#fefce8",cursor:"pointer",fontSize:12,color:"#854d0e",fontWeight:500}}>
      {state === "done" ? `✓ ${stats.added} Firmen` : catalogLabel}
    </button>
  );

  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 9px",border:"1px solid #fde68a",borderRadius:5,background:"#fefce8",fontSize:11,color:"#854d0e"}}>
      <Loader2 style={{width:10,height:10}} className="animate-spin"/>
      {stats.done}/{stats.total} · {currentCatalog}
    </div>
  );
}

function ResolveDomainButton({ caseId, onDone, count }: { caseId: string; onDone: () => void; count: number }) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [stats, setStats] = useState({ processed: 0, resolved: 0, enriched: 0, total: 0 });
  const [currentName, setCurrentName] = useState("");

  async function run() {
    setState("running");
    setStats({ processed: 0, resolved: 0, enriched: 0, total: count });
    setCurrentName("");
    try {
      const res = await fetch(`/api/cases/${caseId}/resolve-domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 500 }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n"); buffer = lines.pop() ?? "";
        for (const line of lines) {
          const d = line.replace(/^data: /, "").trim();
          if (!d) continue;
          try {
            const ev = JSON.parse(d);
            if (ev.type === "start") setStats(s => ({ ...s, total: ev.total }));
            if (ev.type === "scraping") setCurrentName(ev.name?.slice(0, 25) ?? "");
            if (ev.type === "batch_done") setStats(s => ({
              ...s,
              processed: ev.processed,
              resolved: ev.resolved,
              enriched: ev.enriched ?? s.enriched,
            }));
            if (ev.type === "done") {
              onDone();
              setState("done");
              setStats(s => ({ ...s, resolved: ev.resolved, enriched: ev.enriched ?? s.enriched }));
            }
          } catch { /* skip */ }
        }
      }
    } catch { setState("idle"); }
  }

  if (state === "running") return (
    <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #a5f3fc",borderRadius:5,background:"#ecfeff",fontSize:11,color:"#0e7490"}}>
      <Loader2 style={{width:10,height:10}} className="animate-spin"/>
      <span>{stats.processed}/{stats.total}</span>
      {stats.resolved > 0 && <span style={{color:"#0f766e",fontWeight:600}}>·  {stats.resolved} Domains</span>}
      {stats.enriched > 0 && <span style={{color:"#7c3aed",fontWeight:600}}>· {stats.enriched} Profile</span>}
      {currentName && <span style={{color:"#6b7280",maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>· {currentName}</span>}
    </div>
  );

  if (state === "done") return (
    <button onClick={() => setState("idle")}
      style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #a7f3d0",borderRadius:5,background:"#ecfdf5",cursor:"pointer",fontSize:12,color:"#065f46",fontWeight:500}}>
      ✓ {stats.resolved} Domains{stats.enriched > 0 ? ` · ${stats.enriched} Profile` : ""}
    </button>
  );

  return (
    <button onClick={run}
      title={`${count} Firmen ohne Website:\n1. Web-Suche nach eigener Domain\n2. Katalog-Profilseite scrapen (Telefon, Adresse, Email)`}
      style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #a5f3fc",borderRadius:5,background:"#ecfeff",cursor:"pointer",fontSize:12,color:"#0e7490",fontWeight:500}}>
      🔗 Kontakte vervollständigen ({count})
    </button>
  );
}

function CatalogScrapeButton({ url, caseId, onScraped }: { url: string; caseId: string; onScraped: () => void }) {  const [scraping, setScraping] = useState(false);
  const [result, setResult] = useState<{added: number; pages: number} | null>(null);
  return (
    <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2,flexWrap:"wrap"}}>
      <span style={{fontSize:10,color:"#b45309",background:"#fef3c7",border:"1px solid #fde68a",padding:"1px 6px",borderRadius:6,fontWeight:600}}>
        📋 Katalog
      </span>
      <button
        onClick={async (e) => {
          e.stopPropagation();
          if (scraping || result) return;
          setScraping(true);
          try {
            const res = await fetch(`/api/cases/${caseId}/scrape-catalog`, {
              method: "POST",
              headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ url, maxPages: 5 }),
            });
            const d = await res.json();
            setResult({ added: d.added ?? 0, pages: d.pagesScraped ?? 1 });
            if ((d.added ?? 0) > 0) onScraped();
          } catch { setResult({ added: -1, pages: 0 }); }
          finally { setScraping(false); }
        }}
        title={result ? `${result.added} Firmen von ${result.pages} Seiten` : "Firmenliste von dieser Katalogseite extrahieren"}
        style={{fontSize:10,
          color: result ? (result.added > 0 ? "#15803d" : "#6b7280") : "#1d4ed8",
          background: result ? (result.added > 0 ? "#dcfce7" : "#f3f4f6") : "#eff6ff",
          border:`1px solid ${result ? (result.added > 0 ? "#bbf7d0" : "#d1d5db") : "#bfdbfe"}`,
          padding:"1px 7px",borderRadius:6,cursor: result ? "default" : "pointer",fontWeight:600,
          display:"flex",alignItems:"center",gap:3,opacity:scraping?0.6:1}}>
        {scraping ? "⚙️ Scrape…" : result ? (result.added > 0 ? `✓ ${result.added} Firmen` : "0 gefunden") : "↓ Firmen extrahieren"}
      </button>
    </div>
  );
}

// ── Inline editable case name ───────────────────────────────────────────────
function InlineCaseName({ name, onSave }: { name: string; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setValue(name); }, [name]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) { setEditing(false); setValue(name); return; }
    setSaving(true);
    await onSave(trimmed);
    setSaving(false);
    setEditing(false);
  }

  if (!editing) return (
    <span
      onClick={() => setEditing(true)}
      style={{ cursor: "pointer", borderBottom: "1px dashed transparent", transition: "border-color .15s" }}
      onMouseEnter={e => (e.currentTarget.style.borderBottomColor = "#d1d5db")}
      onMouseLeave={e => (e.currentTarget.style.borderBottomColor = "transparent")}
      title="Klicken zum Umbenennen"
    >{name}</span>
  );

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setValue(name); setEditing(false); } }}
      disabled={saving}
      style={{ fontSize: 16, fontWeight: 700, color: "#111", border: "none", borderBottom: "2px solid #7c3aed", outline: "none", background: "transparent", padding: 0, width: `${Math.max(value.length * 10, 120)}px` }}
    />
  );
}

// ── Agent Runs Tab ────────────────────────────────────────────────────────────

interface AgentRunItem {
  id: string;
  goal: string;
  status: string;
  targetCount: number;
  uniqueCount: number;
  startedAt: string;
}

const AGENT_RUN_TERMINAL = new Set(["completed", "budget_exhausted", "cancelled", "failed"]);

function agentRunStatusLabel(s: string) {
  switch (s) {
    case "running": return { label: "Läuft", color: "#1d4ed8", bg: "#eff6ff" };
    case "planning": return { label: "Plant…", color: "#7c3aed", bg: "#f5f3ff" };
    case "completed": return { label: "Abgeschlossen", color: "#166534", bg: "#f0fdf4" };
    case "budget_exhausted": return { label: "Limit erreicht", color: "#92400e", bg: "#fffbeb" };
    case "cancelled": return { label: "Abgebrochen", color: "#6b7280", bg: "#f9fafb" };
    case "failed": return { label: "Fehler", color: "#991b1b", bg: "#fef2f2" };
    default: return { label: s, color: "#6b7280", bg: "#f9fafb" };
  }
}

function AgentRunRow({ run, isActive, activeRunUniqueCount, onOpenModal, onNewSearch, onReload, onReloadAndOpen, onReloadRun, caseId }: {
  run: AgentRunItem;
  isActive: boolean;
  activeRunUniqueCount: number;
  onOpenModal: () => void;
  onNewSearch: () => void;
  onReload: () => void;
  onReloadAndOpen: (runId: string) => void;
  onReloadRun: (runId: string) => void;
  caseId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [runLog, setRunLog] = useState<string[]>([]);
  const [runPlan, setRunPlan] = useState<Array<{id:string;type:string;mapQuery?:string;query?:string;queryTemplate?:string;location?:string;label?:string;estimatedHits:number;queries?:string[]}>>([]);
  const [stepResults, setStepResults] = useState<Array<{stepId:string;uniqueInserted:number;error?:string}>>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // ── Erweitern-Formular ────────────────────────────────────────────────────
  const [showExtend, setShowExtend] = useState(false);
  const [extendContext, setExtendContext] = useState("");
  const [extending, setExtending] = useState(false);
  const [extendResult, setExtendResult] = useState<{steps: number} | null>(null);
  const [extendError, setExtendError] = useState<string|null>(null);

  const { label, color, bg } = agentRunStatusLabel(run.status);
  const isTerminal = AGENT_RUN_TERMINAL.has(run.status);
  const displayCount = isActive ? activeRunUniqueCount : run.uniqueCount;
  const pct = run.targetCount > 0 ? Math.min(100, Math.round((displayCount / run.targetCount) * 100)) : 0;

  const fetchLog = useCallback(async () => {
    const data = await fetch(`/api/cases/${caseId}/agent/${run.id}`).then(r => r.ok ? r.json() : null);
    setRunLog(data?.log ?? []);
    setRunPlan(data?.plan?.steps ?? []);
    setStepResults(data?.stepResults ?? []);
  }, [caseId, run.id]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await fetch(`/api/cases/${caseId}/agent/${run.id}`, { method: "PUT" });
      onReload();
    } catch { /* ignore */ }
    setCancelling(false);
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      await fetch(`/api/cases/${caseId}/agent/${run.id}`, { method: "PATCH" });
      onReload();
      onReloadRun(run.id); // start step loop without opening modal
    } catch { /* ignore */ }
    setResuming(false);
  };

  const handleExtend = async () => {
    if (!extendContext.trim()) return;
    setExtending(true);
    setExtendError(null);
    setExtendResult(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/agent/${run.id}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: extendContext.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setExtendResult({ steps: data.newSteps });
      setExtendContext("");
      // Reload run list + start step loop in background (no modal)
      onReload();
      onReloadRun(run.id);
      // Give the user a moment to see the success message, then close
      setTimeout(() => { setShowExtend(false); setExtendResult(null); }, 2500);
    } catch (e) {
      setExtendError((e as Error).message);
    }
    setExtending(false);
  };

  const toggleLog = async () => {
    if (!expanded && runLog.length === 0) {
      setLogLoading(true);
      await fetchLog();
      setLogLoading(false);
    }
    setExpanded(e => !e);
  };

  // Re-fetch log while run is active and expanded
  useEffect(() => {
    if (!isActive || !expanded) return;
    fetchLog();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, activeRunUniqueCount]);

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: `1px solid ${isActive ? "#bfdbfe" : showExtend ? "#a5b4fc" : "#e2e8f0"}`, overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {run.goal || "–"}
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 99, background: bg, color, whiteSpace: "nowrap", flexShrink: 0 }}>
              {isActive && !isTerminal && <span style={{ display: "inline-block", marginRight: 3 }}>⏳</span>}
              {label}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>🕐 {new Date(run.startedAt).toLocaleString("de-DE")}</span>
            <span>🎯 Ziel: {run.targetCount.toLocaleString("de-DE")}</span>
            <span style={{ fontWeight: 600, color: displayCount > 0 ? "#166534" : "#6b7280" }}>
              ✅ {displayCount.toLocaleString("de-DE")} Leads
            </span>
          </div>
          <div style={{ marginTop: 8, height: 4, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: isTerminal ? "#22c55e" : "#3b82f6", borderRadius: 99, transition: "width 0.5s" }} />
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>{pct}%</div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {isActive && !isTerminal ? (
            <button onClick={onOpenModal}
              style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #bfdbfe", borderRadius: 6, background: "#eff6ff", cursor: "pointer", color: "#1d4ed8", fontWeight: 600 }}>
              Öffnen
            </button>
          ) : null}
          <button onClick={toggleLog}
            style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: 6, background: expanded ? "#f1f5f9" : "#fff", cursor: "pointer", color: "#374151" }}>
            {expanded ? "▲ Details" : "▼ Details"}
          </button>
        </div>
      </div>

      {/* Expandable plan + log */}
      {expanded && (
        <div style={{ borderTop: "1px solid #f1f5f9", padding: "10px 14px", maxHeight: 360, overflowY: "auto" }}>
          {/* Plan steps — compact single-line */}
          {runPlan.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                📋 {runPlan.length} Steps · ~{runPlan.reduce((s,st) => s + (st.estimatedHits||0), 0)} geschätzte Treffer
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {runPlan.map(s => {
                  const executed = stepResults.find(r => r.stepId === s.id);
                  const isDone = !!executed;
                  const isErr = !!executed?.error;
                  const typeShort = s.type === "google_maps" ? "MAPS" : s.type === "google_search" ? "WEB" : s.type?.includes("catalog") ? "KAT" : "SRC";
                  return (
                    <div key={s.id} style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 4, padding: "1px 4px", borderRadius: 3, background: isErr ? "#fef2f2" : isDone ? "#f0fdf4" : "#f8fafc" }}>
                      <span style={{ color: isErr ? "#ef4444" : isDone ? "#22c55e" : "#cbd5e1", fontSize: 8 }}>{isErr ? "✕" : isDone ? "✓" : "○"}</span>
                      <span style={{ color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", fontSize: 9 }}>{typeShort}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#334155" }}>
                        {s.mapQuery && s.location ? `${s.mapQuery} · ${s.location}` : s.mapQuery || s.query || s.queryTemplate || s.label || "–"}
                      </span>
                      <span style={{ color: "#94a3b8", fontSize: 9, flexShrink: 0 }}>~{s.estimatedHits}</span>
                      {executed && <span style={{ color: isErr ? "#ef4444" : "#166534", fontSize: 9, flexShrink: 0 }}>{isErr ? "❌" : `+${executed.uniqueInserted}`}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Log */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>📜 Log</div>
            <div style={{ background: "#0f172a", padding: "8px 10px", borderRadius: 6, maxHeight: 180, overflowY: "auto", fontFamily: "monospace", fontSize: 10 }}>
              {logLoading ? (
                <span style={{ color: "#475569" }}>Lade…</span>
              ) : runLog.length === 0 ? (
                <span style={{ color: "#475569" }}>Keine Log-Einträge.</span>
              ) : runLog.map((line, i) => (
                <div key={i} style={{ lineHeight: 1.5, color: line.startsWith("✓") ? "#86efac" : line.startsWith("⚠") ? "#fbbf24" : line.startsWith("🔄") ? "#93c5fd" : "#94a3b8" }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Erweitern-Formular ── */}
      {showExtend && (
        <div style={{ borderTop: "1px solid #e0e7ff", background: "#f5f3ff", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#5b21b6" }}>➕ Suche erweitern</div>
          <div style={{ fontSize: 11, color: "#7c3aed", lineHeight: 1.5 }}>
            Beschreibe was noch gesucht werden soll — die KI plant neue Schritte und startet sie automatisch.
          </div>
          <textarea
            value={extendContext}
            onChange={e => setExtendContext(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleExtend(); }}
            placeholder={`z. B. "Noch alle Städte in MV abdecken die fehlen" oder "Zusätzlich nach Hausverwaltungen suchen"`}
            rows={3}
            autoFocus
            style={{ fontSize: 12, padding: "8px 10px", border: "1px solid #c4b5fd", borderRadius: 8, background: "#fff", resize: "vertical", fontFamily: "inherit", color: "#1e293b", lineHeight: 1.5 }}
          />
          {extendResult && (
            <div style={{ fontSize: 11, color: "#166534", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 10px" }}>
              ✓ {extendResult.steps} neue Steps geplant — Suche läuft im Hintergrund.
            </div>
          )}
          {extendError && <div style={{ fontSize: 11, color: "#ef4444" }}>⚠ {extendError}</div>}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#a78bfa", flex: 1 }}>⌘↵ zum Absenden</span>
            <button onClick={() => { setShowExtend(false); setExtendContext(""); setExtendError(null); setExtendResult(null); }}
              style={{ fontSize: 11, padding: "5px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#374151" }}>
              Schließen
            </button>
            <button onClick={handleExtend} disabled={extending || !extendContext.trim()}
              style={{ fontSize: 11, padding: "5px 14px", border: "1px solid #7c3aed", borderRadius: 6, background: extending ? "#ede9fe" : "#7c3aed", cursor: extending ? "default" : "pointer", color: extending ? "#7c3aed" : "#fff", fontWeight: 600, opacity: !extendContext.trim() ? 0.5 : 1, display: "flex", alignItems: "center", gap: 5 }}>
              {extending ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Plane…</> : "🤖 KI planen & starten"}
            </button>
          </div>
        </div>
      )}

      {/* Actions row */}
      <div style={{ borderTop: "1px solid #f1f5f9", padding: "8px 16px", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {isTerminal && (
          <button onClick={handleResume} disabled={resuming}
            style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #c4b5fd", borderRadius: 6, background: "#f5f3ff", cursor: "pointer", color: "#7c3aed", fontWeight: 600 }}>
            {resuming ? "…" : "▶ Fortsetzen"}
          </button>
        )}
        {isActive && !isTerminal && (
          <button onClick={handleCancel} disabled={cancelling}
            style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #fca5a5", borderRadius: 6, background: "#fef2f2", cursor: cancelling ? "default" : "pointer", color: "#dc2626", fontWeight: 600 }}>
            {cancelling ? "…" : "■ Stoppen"}
          </button>
        )}
        <button
          onClick={() => { setShowExtend(e => !e); }}
          style={{ fontSize: 11, padding: "4px 12px", border: `1px solid ${showExtend ? "#7c3aed" : "#c4b5fd"}`, borderRadius: 6, background: showExtend ? "#ede9fe" : "#f5f3ff", cursor: "pointer", color: "#7c3aed", fontWeight: 600 }}
          title="KI plant und startet neue Suchschritte">
          ➕ Erweitern
        </button>
        {isActive && !isTerminal ? (
          <button onClick={onOpenModal}
            style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #bfdbfe", borderRadius: 6, background: "#eff6ff", cursor: "pointer", color: "#1d4ed8", fontWeight: 600 }}>
            📊 Öffnen
          </button>
        ) : null}
        <button onClick={toggleLog}
          style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: expanded ? "#f1f5f9" : "#fff", cursor: "pointer", color: "#374151" }}>
          {expanded ? "▲ Details" : "▼ Details"}
        </button>
      </div>
    </div>
  );
}

function AgentRunsTab({ caseId, onOpenModal, onNewSearch, onReloadAndOpen, onReloadRun, activeRunId, activeRunStatus, activeRunUniqueCount, activeRunning }: {
  caseId: string;
  onOpenModal: () => void;
  onNewSearch: () => void;
  onReloadAndOpen: (runId: string) => void;
  onReloadRun: (runId: string) => void;
  activeRunId: string | null;
  activeRunStatus: string | null;
  activeRunUniqueCount: number;
  activeRunning: boolean;
}) {
  const [runs, setRuns] = useState<AgentRunItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await fetch(`/api/cases/${caseId}/agent`).then(r => r.ok ? r.json() : []);
    const runs: AgentRunItem[] = Array.isArray(data) ? data : [];

    // Auto-cancel stale "running" runs: no active hook + older than 5 min
    const now = Date.now();
    for (const r of runs) {
      if (r.status === "running" && r.id !== activeRunId) {
        const age = now - new Date(r.startedAt).getTime();
        if (age > 5 * 60 * 1000) {
          await fetch(`/api/cases/${caseId}/agent/${r.id}`, { method: "PUT" }).catch(() => {});
          r.status = "cancelled";
        }
      }
    }

    setRuns(runs);
    setLoading(false);
  }, [caseId, activeRunId]);

  useEffect(() => { load(); }, [load]);

  // Refresh while a run is active
  useEffect(() => {
    if (!activeRunning) { load(); return; }
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [activeRunning, load]);

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 13 }}>
      Lade…
    </div>
  );

  if (runs.length === 0) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div style={{ fontSize: 48 }}>🎯</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b" }}>Noch keine Ziel-Suchen</div>
      <div style={{ fontSize: 13, color: "#64748b" }}>Starte eine Ziel-Suche um automatisch Leads zu sammeln.</div>
      <button onClick={onOpenModal}
        style={{ padding: "8px 20px", border: "1px solid #fda4af", borderRadius: 7, background: "#fff1f2", cursor: "pointer", color: "#be123c", fontWeight: 600, fontSize: 13 }}>
        🎯 Neue Ziel-Suche
      </button>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "#f8fafc", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {runs.length} Ziel-Suche{runs.length !== 1 ? "n" : ""}
        </div>
        <button onClick={onNewSearch}
          style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #fda4af", borderRadius: 6, background: "#fff1f2", cursor: "pointer", color: "#be123c", fontWeight: 600 }}>
          + Neue Suche
        </button>
      </div>

      {runs.map(run => (
        <AgentRunRow
          key={run.id}
          run={run}
          caseId={caseId}
          isActive={run.id === activeRunId}
          activeRunUniqueCount={activeRunUniqueCount}
          onOpenModal={onOpenModal}
          onNewSearch={onNewSearch}
          onReload={load}
          onReloadAndOpen={onReloadAndOpen}
          onReloadRun={onReloadRun}
        />
      ))}
    </div>
  );
}

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = use(params);
  const router = useRouter();

  // ── Data & columns ────────────────────────────────────────────────────────
  const {
    caseData, setCaseData,
    rows, setRows,
    sourceColumns, setSourceColumns,
    colOrder, setColOrder,
    rangeBis, setRangeBis,
    rangeMax, setRangeMax,
    totals,
    refresh,
    resetColOrder,
  } = useCaseData(caseId);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showAddCol, setShowAddCol] = useState(false);
  const [showAppend, setShowAppend] = useState(false);
  const [appendTab, setAppendTab] = useState<"autopilot" | "search" | "catalog">("autopilot");
  const [showImport, setShowImport] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<{ id: number; message: string; createdAt: string }[]>([]);
  const [activeTab, setActiveTab] = useState<"Firmen" | "Kontakte" | "Suchen" | "Quellen" | "Log" | "Export">("Firmen");
  const [contactRowsData, setContactRowsData] = useState<Array<Record<string,string|null>>>([]);
  const [contactRowsLoading, setContactRowsLoading] = useState(false);
  const [contactRowsLoaded, setContactRowsLoaded] = useState(false);
  const [contactCleanupRunning, setContactCleanupRunning] = useState(false);
  const [contactCleanupResult, setContactCleanupResult] = useState<{inserted:number;updated:number;rowsCleaned:number}|null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showPromptCols, setShowPromptCols] = useState(false);
  const [rangeVon, setRangeVon] = useState(1);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [manuallyHiddenCols, setManuallyHiddenCols] = useState<Set<string>>(new Set());
  const [showColVisibility, setShowColVisibility] = useState(false);
  const [showSystemCols, setShowSystemCols] = useState(false);
  const [editingPromptCol, setEditingPromptCol] = useState<AiColumn | null>(null);
  const [editingPromptCell, setEditingPromptCell] = useState<{col: AiColumn; row: RowData} | null>(null);
  const [runDetailCell, setRunDetailCell] = useState<{col: AiColumn; row: RowData} | null>(null);
  const [reasoningModal, setReasoningModal] = useState<{content: string; title: string} | null>(null);
  const [cacheModalRow, setCacheModalRow] = useState<RowData | null>(null);
  const [cacheModalEntries, setCacheModalEntries] = useState<Array<{url:string; title?:string; length:number; markdown:string; fetchedAt:string}>>([]);
  const [cacheModalLoading, setCacheModalLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [showRunOptions, setShowRunOptions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [runConfirm, setRunConfirm] = useState<{mode: "all_force" | "empty_only"} | null>(null);

  // ── Agent goal run — lifted to page so it survives modal close & page reload ──
  const agentHook = useAgentRun(caseId);
  const agentStepLoopRef = useRef(false);
  const agentImportedRef = useRef(false);
  const AGENT_TERMINAL = new Set(["completed", "budget_exhausted", "cancelled", "failed"]);

  // ── Key status check for agent goal search ──
  const [agentKeyStatus, setAgentKeyStatus] = useState<{ anySearchConfigured?: boolean } | null>(null);
  useEffect(() => {
    fetch(`/api/cases/${caseId}/agent/check-keys`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setAgentKeyStatus(data); })
      .catch(() => {});
  }, [caseId]);

  // Auto-resume: on mount, check DB for an active run and resume the step loop
  useEffect(() => {
    fetch(`/api/cases/${caseId}/agent`)
      .then(r => r.ok ? r.json() : [])
      .then((runs: Array<{ id: string; status: string }>) => {
        if (!Array.isArray(runs)) return;
        const active = runs.find(r => !AGENT_TERMINAL.has(r.status));
        if (active) agentHook.reload(active.id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Step loop — runs at page level, independent of modal visibility
  useEffect(() => {
    const { run, running } = agentHook;
    if (!running || !run || AGENT_TERMINAL.has(run.status)) {
      agentStepLoopRef.current = false;
      return;
    }
    if (agentStepLoopRef.current) return;
    agentStepLoopRef.current = true;

    // Heartbeat: let the global worker know this run is being driven by this tab
    const heartbeatKey = run ? `agentLoop:${run.id}` : null;
    const writeHeartbeat = () => {
      if (heartbeatKey) localStorage.setItem(heartbeatKey, Date.now().toString());
    };
    writeHeartbeat();
    const heartbeatInterval = setInterval(writeHeartbeat, 1000);

    let active = true;
    async function loop() {
      while (active && agentStepLoopRef.current) {
        const state = await agentHook.step();
        if (!active) break;
        if (!agentImportedRef.current && state && state.uniqueCount > 0) {
          agentImportedRef.current = true;
          refresh();
        }
        if (!state || AGENT_TERMINAL.has(state.status)) {
          agentStepLoopRef.current = false;
          if (state) refresh();
          return;
        }
        await new Promise(r => setTimeout(r, 400));
      }
    }
    loop();
    return () => {
      active = false;
      agentStepLoopRef.current = false;
      clearInterval(heartbeatInterval);
      if (heartbeatKey) localStorage.removeItem(heartbeatKey);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentHook.running]);

  // Auto-detect grouped view
  const hasColumnGroups = caseData?.aiColumns?.some(c => c.columnGroup);
  // Only show Firmen/Kontakte run-phase buttons for NON-batch columns with explicit groups
  const hasPhaseColumns = caseData?.aiColumns?.some(c => c.columnGroup && !c.tool);

  // ── Run logic (via hook) ──────────────────────────────────────────────────
  const {
    runningCells, runningColumnId, runningRowIds,
    globalRunError, setGlobalRunError,
    concurrency, setConcurrency,
    sequentialMode, setSequentialMode,
    runCell, stopCell,
    runColumn, stopColumn,
    runPhase, runSelectedRows,
    stopAll,
  } = useRunColumns(caseId, caseData, rows, setRows, selectedRows, setColOrder);

  // ── Logs ──────────────────────────────────────────────────────────────────
  async function fetchLogs() {
    const data = await fetch(`/api/logs?caseId=${caseId}&limit=300`).then((r) => r.json());
    setLogs(data);
  }
  useEffect(() => {
    if (showLogs || activeTab === "Log" || activeTab === "Quellen" || activeTab === "Suchen") fetchLogs();
  }, [showLogs, activeTab]);

  // ── Contact rows fetch ────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== "Kontakte") return;
    setContactRowsLoading(true);
    fetch(`/api/contact-rows?caseId=${caseId}`)
      .then(r => r.json())
      .then(d => { setContactRowsData((d.contacts ?? []).map((c: {data: Record<string,string|null>}) => c.data)); setContactRowsLoaded(true); })
      .catch(() => {})
      .finally(() => setContactRowsLoading(false));
  }, [activeTab, caseId]);

  // ── Cell inline editing ───────────────────────────────────────────────────
  function startEdit(rowId: string, key: string, current: string) {
    setEditingCell({ rowId, key });
    setEditValue(current ?? "");
  }
  async function commitEdit() {
    if (!editingCell) return;
    const { rowId, key } = editingCell;
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, data: { ...r.data, [key]: editValue } } : r));
    setEditingCell(null);
    await fetch(`/api/rows/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { ...rows.find((r) => r.id === rowId)!.data, [key]: editValue } }),
    });
  }

  // ── Stop all selected rows ────────────────────────────────────────────────
  function stopSelectedRows() { setSelectedRows(new Set()); }


  async function deleteSelectedRows() {
    if (selectedRows.size === 0 || !confirm(`Delete ${selectedRows.size} row(s)?`)) return;
    const ids = [...selectedRows];
    const res = await fetch(`/api/rows`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    if (data.ok) {
      setRows((prev) => prev.filter((r) => !selectedRows.has(r.id)));
      setSelectedRows(new Set());
      // Reload contacts if any were cascade-deleted
      if (data.contactsDeleted > 0) {
        setContactRowsLoaded(false);
        fetch(`/api/contact-rows?caseId=${caseId}`)
          .then(r => r.json())
          .then(d => {
            setContactRowsData((d.contacts ?? []).map((c: { data: Record<string, string | null> }) => c.data));
            setContactRowsLoaded(true);
          });
      }
    }
  }

  // ── Delete column ─────────────────────────────────────────────────────────
  async function handleColDrop(targetKey: string) {
    if (!dragCol || dragCol === targetKey || !caseData) return;
    const order = colOrder.length > 0 ? colOrder : [
      ...sourceColumns, ...(caseData?.aiColumns ?? []).map(c => c.outputKey)
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
    const updated = (caseData?.aiColumns ?? []).filter((c) => c.id !== colId);
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

  // Split catalog rows (raw source material) from real data rows
  const catalogRows = rows.filter(r => r.data["is_catalog"] === "true");
  const baseDataRows = rows.filter(r => r.data["is_catalog"] !== "true");
  const dataRows = sortBy
    ? [...baseDataRows].sort((a, b) => {
        const av = ((a.data[sortBy] ?? "") as string).toLowerCase();
        const bv = ((b.data[sortBy] ?? "") as string).toLowerCase();
        // Numeric sort when both values look like numbers
        const an = parseFloat(av), bn = parseFloat(bv);
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv, "de");
        return sortDir === "asc" ? cmp : -cmp;
      })
    : baseDataRows;

  const totalPages = Math.max(1, Math.ceil(dataRows.length / pageSize));
  const pageRows = dataRows.slice(page * pageSize, (page + 1) * pageSize);
  const allSelected = dataRows.length > 0 && selectedRows.size === dataRows.length;
  const doneCount = dataRows.filter((r) => Object.values(r.cellStatuses).some((s) => s === "done")).length;
  const errorCount = dataRows.filter((r) => Object.values(r.cellStatuses).some((s) => s === "error")).length;
  const processedCount = dataRows.filter((r) => Object.values(r.cellStatuses).some((s) => s === "done" || s === "error")).length;
  const runTarget = dataRows.length - doneCount;
  const selCount = selectedRows.size > 0 ? selectedRows.size : dataRows.length;

  // shared cell editor
  function EditInput({ rowId, k }: { rowId: string; k: string }) {
    return (
      <input autoFocus value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
        style={{width:"100%",fontSize:13,border:"1px solid #7c3aed",borderRadius:3,padding:"1px 4px",outline:"none"}} />
    );
  }

  // ── Shared updateCase helper (used by SettingsPanel + AddColumnModal) ────
  const updateCase = async (patch: Record<string, unknown>): Promise<Case> => {
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated: Case = await res.json();
    setCaseData(updated);
    return updated;
  };

  const tabs = ["Firmen","Kontakte","Suchen","Quellen","Log","Export"] as const;

  function tabIcon(t: string): string {
    switch (t) {
      case "Firmen": return "📋 ";
      case "Kontakte": return "👤 ";
      case "Suchen": return "🎯 ";
      case "Quellen": return "🔍 ";
      case "Log": return "📜 ";
      case "Export": return "📤 ";
      default: return "";
    }
  }

  // Build context value once so child components can consume it
  const caseContextValue = caseData ? {
    caseId,
    caseData,
    setCaseData: (c: Case) => setCaseData(c),
    rows,
    setRows,
    sourceColumns,
    colOrder,
    setColOrder,
    totals,
    refresh,
    updateCase,
  } : null;

  // ── Hidden-column filter: fields written by batch_contact should not appear as own columns ──
  const BATCH_CONTACTS_FLAT_KEYS = new Set(["first_name", "last_name", "position", "contact_email", "contact_phone", "linkedin", "email_extrapolated", "email_fallback"]);
  const hasBatchContactsCol = caseData?.aiColumns?.some(c => c.tool === "batch_contact") ?? false;
  const aiOutputKeySet = new Set(caseData?.aiColumns?.map(c => c.outputKey) ?? []);
  const isHiddenCol = (key: string): boolean => {
    // Explicitly allow cache status column
    if (key === "_scrape_cached_ts") return false;
    // Never hide AI output columns — even if their outputKey starts with "_"
    if (aiOutputKeySet.has(key)) return false;
    if (key.startsWith("_")) return true;
    if (/^contact_\d+_/.test(key)) return true;
    if (/^(is_catalog|data_quality|email_fallback|email_extrapolated|company_email|profile_source|profile_url|search_query|search_source|source_domain|source_snippet|source_title|source_url)$/.test(key)) return true;
    if (hasBatchContactsCol && BATCH_CONTACTS_FLAT_KEYS.has(key)) return true;
    return false;
  };
  const visibleColOrder = (() => {
    const seen = new Set<string>();
    const aiKeys = (caseData?.aiColumns ?? []).map(c => c.outputKey);
    const base = colOrder.filter(k => !isHiddenCol(k) && !manuallyHiddenCols.has(k));
    
    // Ensure all AI columns from caseData are present in visible columns!
    const missingAi = aiKeys.filter(k => !base.includes(k) && !manuallyHiddenCols.has(k));
    let merged = [...base];
    for (const aiKey of missingAi) {
      const col = caseData?.aiColumns?.find(c => c.outputKey === aiKey);
      if (col?.tool === "batch_company") {
        const domainIdx = merged.indexOf("domain");
        if (domainIdx !== -1) {
          merged.splice(domainIdx + 1, 0, aiKey);
        } else {
          merged.unshift(aiKey);
        }
      } else if (col?.tool === "batch_contact") {
        const emailIdx = merged.indexOf("email");
        if (emailIdx !== -1) {
          merged.splice(emailIdx + 1, 0, aiKey);
        } else {
          merged.push(aiKey);
        }
      } else {
        merged.push(aiKey);
      }
    }

    return merged.filter(k => !seen.has(k) && seen.add(k));
  })();

  return (
    <ErrorBoundary>
    {caseContextValue ? (
      <CaseContext.Provider value={caseContextValue}>
    <div style={{display:"flex",height:"100vh",background:"var(--bg)",overflow:"hidden",fontSize:13,color:"var(--text-1)",fontFamily:"var(--f)"}}>

      {/* ════ SIDEBAR ════ */}
      <div style={{width:210,minWidth:210,background:"var(--surface)",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0,padding:"16px 0"}}>
        {/* Logo row */}
        <div style={{padding:"0 16px 14px",borderBottom:"1px solid var(--border-xs)"}}>
          <button onClick={() => router.push("/dashboard")}
            style={{display:"flex",alignItems:"center",gap:9,background:"none",border:"none",cursor:"pointer",padding:0,width:"100%",textAlign:"left"}}
            onMouseEnter={e=>(e.currentTarget.style.opacity="0.85")}
            onMouseLeave={e=>(e.currentTarget.style.opacity="1")}>
            <div style={{width:26,height:26,background:"var(--orange)",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,fontWeight:700,flexShrink:0}}>D</div>
            <span style={{fontWeight:600,fontSize:13.5,letterSpacing:"-0.3px",color:"var(--text-1)"}}>DataMiner</span>
          </button>
        </div>

        {/* Section: Main Nav & Case Info */}
        <div style={{padding:"14px 14px 6px",flex:1,overflowY:"auto"}}>
          <div style={{display:"flex",flexDirection:"column",gap:2,marginBottom:12}}>
            <button onClick={() => router.push("/dashboard")}
              style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"5px 8px",borderRadius:"var(--rs)",border:"none",background:"transparent",cursor:"pointer",fontSize:12,color:"var(--text-2)",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--bg)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <Database style={{width:13,height:13,color:"var(--text-3)"}} /> Dashboard
            </button>
            <button onClick={() => router.push("/cases")}
              style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"5px 8px",borderRadius:"var(--rs)",border:"none",background:"transparent",cursor:"pointer",fontSize:12,color:"var(--text-2)",textAlign:"left"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--bg)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <Database style={{width:13,height:13,color:"var(--text-3)"}} /> Alle Cases
            </button>
          </div>

          <div style={{fontSize:10,fontWeight:600,letterSpacing:"0.07em",textTransform:"uppercase",color:"var(--text-3)",marginBottom:6,paddingLeft:4}}>
            Aktueller Case
          </div>
          {/* Active Case Row */}
          <div style={{padding:"7px 9px",borderRadius:"var(--rs)",background:"var(--orange-soft)",cursor:"pointer"}}>
            <div style={{fontWeight:600,fontSize:12.5,color:"var(--orange)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={caseData.name}>
              {caseData.name}
            </div>
            <div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>
              {dataRows.length} Zeilen{catalogRows.length > 0 ? ` · ${catalogRows.length} Kataloge` : ""}
            </div>
          </div>
        </div>

        {/* Bottom icons */}
        <div style={{padding:"8px 12px 0",borderTop:"1px solid var(--border-xs)",display:"flex",alignItems:"center",justifyContent:"space-around"}}>
          <button title="API & Region" onClick={() => router.push("/settings")}
            style={{padding:6,borderRadius:4,border:"none",background:"none",cursor:"pointer",color:"var(--text-3)",display:"flex",alignItems:"center"}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--orange)";e.currentTarget.style.background="var(--orange-soft)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="var(--text-3)";e.currentTarget.style.background="none";}}>
            <Settings style={{width:15,height:15}} />
          </button>
          <button title="Modell-Auswahl" onClick={() => router.push("/settings/models")}
            style={{padding:6,borderRadius:4,border:"none",background:"none",cursor:"pointer",color:"var(--text-3)",display:"flex",alignItems:"center"}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--orange)";e.currentTarget.style.background="var(--orange-soft)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="var(--text-3)";e.currentTarget.style.background="none";}}>
            <Sliders style={{width:15,height:15}} />
          </button>
          <button title="Planner Prompt" onClick={() => router.push("/settings/planner")}
            style={{padding:6,borderRadius:4,border:"none",background:"none",cursor:"pointer",color:"var(--text-3)",display:"flex",alignItems:"center"}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--orange)";e.currentTarget.style.background="var(--orange-soft)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="var(--text-3)";e.currentTarget.style.background="none";}}>
            <Sparkles style={{width:15,height:15}} />
          </button>
          <button title="LLM-Testing" onClick={() => router.push("/settings/llm-test")}
            style={{padding:6,borderRadius:4,border:"none",background:"none",cursor:"pointer",color:"var(--text-3)",display:"flex",alignItems:"center"}}
            onMouseEnter={e=>{e.currentTarget.style.color="var(--orange)";e.currentTarget.style.background="var(--orange-soft)";}}
            onMouseLeave={e=>{e.currentTarget.style.color="var(--text-3)";e.currentTarget.style.background="none";}}>
            <Zap style={{width:15,height:15}} />
          </button>
        </div>
      </div>

      {/* ════ MAIN ════ */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg)"}}>

        {/* ── Global Case Header (Topbar) ── */}
        <div style={{background:"var(--surface)",borderBottom:"1px solid var(--border)",padding:"10px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <div style={{fontSize:15,fontWeight:600,letterSpacing:"-0.3px",color:"var(--text-1)"}}>
              <InlineCaseName name={caseData.name} onSave={async (newName) => {
                const updated = await updateCase({ name: newName });
                setCaseData(updated);
              }} />
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12,fontSize:11.5,color:"var(--text-3)",flexWrap:"wrap"}}>
              <span>{dataRows.length} Zeilen</span>
              {catalogRows.length > 0 && <span>{catalogRows.length} Kataloge</span>}
              <span>{sourceColumns.length} Quellspalten</span>
              <span style={{color:"var(--green)",fontWeight:500}}>{(caseData?.aiColumns ?? []).length} KI-Spalten</span>
              <CostDashboard totals={totals} rowCount={rows.length} colCount={(caseData?.aiColumns ?? []).length} />
            </div>
          </div>

          {/* Global Workflow Actions on the Right */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <button onClick={() => { setAppendTab("autopilot"); setShowAppend(true); }}
              title="Leads finden & Daten erweitern: Autopilot (Ziel-Suche), Manuelle Suche oder Katalog-Scraper"
              className="btn-v2"
              style={{background:"var(--orange-soft)",color:"var(--orange)",borderColor:"var(--orange-mid)",fontWeight:600}}>
              🎯 Leads finden &amp; erweitern {agentKeyStatus && !agentKeyStatus.anySearchConfigured && <span title="Keine Such-API-Keys konfiguriert" style={{fontSize:11,marginLeft:2}}>⚠️</span>}
            </button>

            {agentHook.running && !showAppend && agentHook.run && !AGENT_TERMINAL.has(agentHook.run.status) && (
              <button onClick={() => { setAppendTab("autopilot"); setShowAppend(true); }}
                title="Autopilot läuft — klicken zum Öffnen"
                className="btn-v2"
                style={{background:"var(--orange-soft)",color:"var(--orange)",borderColor:"var(--orange-mid)",fontWeight:600}}>
                <Loader2 style={{width:12,height:12}} className="animate-spin" />
                {agentHook.run.uniqueCount} Ergebnisse · läuft…
              </button>
            )}

            {rows.some(r => r.data["first_name"] && r.data["last_name"] && !r.data["contact_email"]) && (
              <EmailExtrapolateButton caseId={caseId} onDone={refresh} />
            )}

            {catalogRows.length > 0 && (
              <CatalogDeepCrawlButton caseId={caseId} onDone={refresh} catalogCount={catalogRows.length} />
            )}

            {baseDataRows.some(r => !(r.data["domain"] ?? "").trim() && !String(r.data["search_source"] ?? "").startsWith("maps")) && (
              <ResolveDomainButton caseId={caseId} onDone={refresh} count={baseDataRows.filter(r => !(r.data["domain"] ?? "").trim() && !String(r.data["search_source"] ?? "").startsWith("maps")).length} />
            )}

            <button onClick={() => setShowImport(true)} title="CSV, XLSX oder JSON importieren" className="btn-v2">
              <Upload style={{width:12,height:12}} /> Import
            </button>

            <button onClick={() => setShowExport(true)} title="CSV oder Snapshot exportieren" className="btn-v2">
              <Download style={{width:12,height:12}} /> Export
            </button>

            <div className="tsep-v2" />

            {/* Run primary action */}
            {runningRowIds.size > 0 ? (
              <button onClick={stopAll}
                className="btn-v2"
                style={{background:"var(--danger)",color:"#fff",borderColor:"var(--danger)",fontWeight:600}}>
                ■ Stop ({runningRowIds.size})
              </button>
            ) : (<>
              {hasPhaseColumns ? (<>
                <button onClick={() => runPhase("company")} className="btn-v2 btn-v2-primary">
                  <Building2 style={{width:12,height:12}}/> Firmen
                </button>
                <button onClick={() => runPhase("contact")} className="btn-v2 btn-v2-ai">
                  👤 Kontakte
                </button>
              </>) : (
                <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                  <div style={{display:"flex",borderRadius:"var(--rs)",overflow:"hidden"}}>
                    <button onClick={() => setRunConfirm({ mode: "empty_only" })}
                      title="Nur leere Zellen füllen (bereits befüllte werden übersprungen)"
                      className="btn-v2 btn-v2-primary"
                      style={{borderRadius:"var(--rs) 0 0 var(--rs)",borderRight:"1px solid rgba(255,255,255,0.25)"}}>
                      ▶ Ausführen
                    </button>
                    <button onClick={() => setShowRunOptions(v => !v)}
                      title="Ausführungs-Optionen öffnen"
                      className="btn-v2 btn-v2-primary"
                      style={{borderRadius:"0 var(--rs) var(--rs) 0",padding:"5px 7px",fontSize:11}}>
                      ▾
                    </button>
                  </div>
                  {showRunOptions && (
                    <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"12px 14px",boxShadow:"var(--shadow)",zIndex:100,minWidth:220}}>
                      <div style={{fontSize:10.5,fontWeight:600,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:10}}>Ausführungs-Optionen</div>
                      <button onClick={() => { setShowRunOptions(false); setRunConfirm({ mode: "empty_only" }); }}
                        style={{width:"100%",textAlign:"left",padding:"7px 10px",border:"1px solid var(--border)",borderRadius:"var(--rs)",background:"var(--bg)",cursor:"pointer",fontSize:12,color:"var(--text-1)",marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:14,color:"var(--orange)"}}>◐</span>
                        <div>
                          <div style={{fontWeight:600}}>Nur leere Zellen füllen</div>
                          <div style={{fontSize:10.5,color:"var(--text-3)",marginTop:1}}>Überspringt bereits befüllte Zeilen</div>
                        </div>
                      </button>
                      <button onClick={() => { setShowRunOptions(false); setRunConfirm({ mode: "all_force" }); }}
                        style={{width:"100%",textAlign:"left",padding:"7px 10px",border:"1px solid var(--danger-soft)",borderRadius:"var(--rs)",background:"var(--danger-soft)",cursor:"pointer",fontSize:12,color:"var(--danger)",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:14}}>⚡</span>
                        <div>
                          <div style={{fontWeight:600}}>Alle Zellen neu ausführen</div>
                          <div style={{fontSize:10.5,color:"var(--text-3)",marginTop:1}}>Überschreibt auch vorhandene Werte</div>
                        </div>
                      </button>
                      <div style={{padding:"6px 2px 2px",borderTop:"1px solid var(--border-xs)",marginTop:6}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                          <span style={{fontSize:11,color:"var(--text-2)",fontWeight:600}}>Parallelität</span>
                          <span style={{fontSize:12,fontFamily:"monospace",color:"var(--orange)",fontWeight:700}}>{concurrency}x</span>
                        </div>
                        <input type="range" min={1} max={20} value={concurrency}
                          onChange={e => setConcurrency(Number(e.target.value))}
                          style={{width:"100%",accentColor:"var(--orange)"}} />
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text-3)",marginTop:2}}>
                          <span>1x</span>
                          <span>20x max</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>)}
          </div>
        </div>

        {/* ── Table Workspace Container ── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--surface)",margin:"14px 20px 18px",border:"1px solid var(--border)",borderRadius:"var(--r)",boxShadow:"var(--shadow)"}}>

          {/* Integrated Sheet Bar (Tabs directly on table) */}
          <div style={{background:"#fbfaf8",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 8px",flexShrink:0,height:38}}>
            {/* Sheet Tabs Left */}
            <div style={{display:"flex",alignItems:"flex-end",height:"100%",gap:2}}>
              {tabs.map(t => {
                const isActive = activeTab === t;
                const count = t === "Firmen" ? dataRows.length : t === "Kontakte" ? (contactRowsData.length || undefined) : t === "Quellen" ? (catalogRows.length || undefined) : undefined;
                return (
                  <button key={t} onClick={() => setActiveTab(t)}
                    style={{
                      display:"inline-flex",alignItems:"center",gap:6,padding:"0 14px",height:37,fontSize:12,cursor:"pointer",border:"none",transition:"0.1s",userSelect:"none",
                      color: isActive ? "var(--orange)" : "var(--text-2)",
                      borderBottom: isActive ? "2px solid var(--orange)" : "2px solid transparent",
                      fontWeight: isActive ? 600 : 400,
                      background: isActive ? "var(--surface)" : "transparent",
                      borderTopLeftRadius: isActive ? "var(--rs)" : 0,
                      borderTopRightRadius: isActive ? "var(--rs)" : 0,
                      borderLeft: isActive ? "1px solid var(--border-xs)" : "1px solid transparent",
                      borderRight: isActive ? "1px solid var(--border-xs)" : "1px solid transparent",
                      marginBottom: -1,
                    }}>
                    <span>{t === "Firmen" ? "🏢 Firmen" : t === "Kontakte" ? "👤 Kontakte" : t === "Suchen" ? "🎯 Suchen" : t === "Quellen" ? "📚 Quellen" : t === "Log" ? "📜 Log" : "📤 Export"}</span>
                    {count !== undefined && (
                      <span style={{fontSize:10,fontWeight:600,padding:"1px 5px",borderRadius:8,background: isActive ? "var(--orange-soft)" : "var(--bg)",color: isActive ? "var(--orange)" : "var(--text-3)"}}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Table / Sheet Controls Right */}
            <div style={{display:"flex",alignItems:"center",gap:6,paddingRight:4}}>
              {activeTab === "Firmen" && (<>
                {hasColumnGroups && (
                  <div style={{display:"flex",gap:1,background:"var(--bg)",border:"1px solid var(--border)",borderRadius:"var(--rs)",padding:2}}>
                    <button onClick={() => setViewMode("flat")}
                      style={{padding:"2px 8px",borderRadius:3,fontSize:11,cursor:"pointer",border:"none",transition:"0.1s",
                        background: viewMode==="flat" ? "var(--surface)" : "transparent",
                        color: viewMode==="flat" ? "var(--text-1)" : "var(--text-2)",
                        boxShadow: viewMode==="flat" ? "var(--shadow-sm)" : "none",
                        fontWeight: viewMode==="flat" ? 600 : 400}}>
                      Flach
                    </button>
                    <button onClick={() => setViewMode("grouped")}
                      style={{padding:"2px 8px",borderRadius:3,fontSize:11,cursor:"pointer",border:"none",transition:"0.1s",
                        background: viewMode==="grouped" ? "var(--surface)" : "transparent",
                        color: viewMode==="grouped" ? "var(--text-1)" : "var(--text-2)",
                        boxShadow: viewMode==="grouped" ? "var(--shadow-sm)" : "none",
                        fontWeight: viewMode==="grouped" ? 600 : 400}}>
                      Gruppiert
                    </button>
                  </div>
                )}
                <button onClick={() => { setSelectedRows(new Set()); setRows(prev => prev.map(r => ({...r,cellStatuses:{},cellErrors:{}}))); }}
                  title="Alle Status zurücksetzen"
                  className="btn-v2 btn-v2-ghost" style={{padding:"3px 7px",fontSize:11.5}}>
                  Reset
                </button>
                <button
                  title="Doppelte Zeilen (gleiche Domain) entfernen"
                  onClick={async () => {
                    const res = await fetch(`/api/cases/${caseId}/dedupe`, { method: "POST" });
                    const d = await res.json();
                    if (d.removed > 0) { refresh(); }
                    else { alert("Keine Duplikate gefunden"); }
                  }}
                  className="btn-v2 btn-v2-ghost" style={{padding:"3px 7px",fontSize:11.5}}>
                  Dedupe
                </button>
                {/* Column visibility toggle */}
                <div style={{position:"relative"}}>
                  <button onClick={() => setShowColVisibility(v => !v)}
                    title="Spalten ein-/ausblenden"
                    className="btn-v2 btn-v2-ghost" style={{padding:"3px 7px",fontSize:11.5,color: showColVisibility ? "var(--orange)" : "var(--text-2)"}}>
                    <Sliders style={{width:11,height:11}}/> Spalten {manuallyHiddenCols.size > 0 && <span className="badge-v2 badge-v2-orange">{manuallyHiddenCols.size}</span>}
                  </button>
                  {showColVisibility && (() => {
                    const allCols = colOrder.filter(k => !isHiddenCol(k));
                    const srcCols = allCols.filter(k => !(caseData?.aiColumns ?? []).some(c => c.outputKey === k));
                    const aiCols = allCols.filter(k => (caseData?.aiColumns ?? []).some(c => c.outputKey === k));
                    const toggle = (k: string) => setManuallyHiddenCols(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

                    return (
                      <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r)",boxShadow:"var(--shadow)",zIndex:500,minWidth:250,maxHeight:460,overflowY:"auto",padding:10}}
                        onMouseLeave={() => setShowColVisibility(false)}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"2px 2px 8px",borderBottom:"1px solid var(--border-xs)",marginBottom:6}}>
                          <span style={{fontSize:10.5,fontWeight:600,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Spalten</span>
                          <div style={{display:"flex",gap:6}}>
                            {manuallyHiddenCols.size > 0 && <button onClick={()=>setManuallyHiddenCols(new Set())} style={{border:"none",background:"none",fontSize:11,color:"var(--orange)",cursor:"pointer",fontWeight:500}}>Alle zeigen</button>}
                            <button onClick={()=>{resetColOrder();setShowColVisibility(false);}} style={{border:"none",background:"none",fontSize:11,color:"var(--text-3)",cursor:"pointer"}}>↺ Reset</button>
                          </div>
                        </div>

                        {/* Source cols */}
                        {srcCols.length > 0 && <div style={{fontSize:10,fontWeight:600,color:"var(--text-3)",textTransform:"uppercase",padding:"4px 2px",marginBottom:2}}>Quelldaten</div>}
                        {srcCols.map(k => (
                          <label key={k} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 6px",borderRadius:"var(--rs)",cursor:"pointer",fontSize:12,color:"var(--text-1)"}}>
                            <input type="checkbox" checked={!manuallyHiddenCols.has(k)} onChange={()=>toggle(k)} style={{accentColor:"var(--orange)"}}/>
                            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{COL_LABELS[k] ?? k}</span>
                          </label>
                        ))}

                        {/* AI cols */}
                        {aiCols.length > 0 && <div style={{fontSize:10,fontWeight:600,color:"var(--green)",textTransform:"uppercase",padding:"8px 2px 2px",marginBottom:2,borderTop:"1px solid var(--border-xs)",marginTop:6}}>KI-Spalten</div>}
                        {aiCols.map(k => {
                          const col = (caseData?.aiColumns ?? []).find(c => c.outputKey === k);
                          return (
                            <label key={k} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 6px",borderRadius:"var(--rs)",cursor:"pointer",fontSize:12,color:"var(--green)"}}>
                              <input type="checkbox" checked={!manuallyHiddenCols.has(k)} onChange={()=>toggle(k)} style={{accentColor:"var(--green)"}}/>
                              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{col?.name ?? k}</span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
                <button onClick={() => setShowAddCol(true)} className="btn-v2 btn-v2-ai" style={{padding:"3px 9px",fontSize:11.5}}>
                  <Plus style={{width:12,height:12}} /> Spalte
                </button>
              </>)}
            </div>
          </div>

          {/* Contextual Selection Bar */}
          {activeTab === "Firmen" && selectedRows.size > 0 && (
            <div style={{background:"var(--orange-soft)",borderBottom:"1px solid var(--orange-mid)",padding:"6px 16px",display:"flex",alignItems:"center",gap:10,fontSize:12,color:"var(--orange)",flexShrink:0}}>
              <span style={{fontWeight:600}}>{selectedRows.size} Zeilen ausgewählt</span>
              <button onClick={() => setRunConfirm({ mode: "empty_only" })} className="btn-v2" style={{padding:"2px 8px",fontSize:11,background:"#fff",borderColor:"var(--orange-mid)",color:"var(--orange)",fontWeight:500}}>
                ▶ Nur diese ausführen
              </button>
              <button
                onClick={async () => {
                  const res = await fetch(`/api/cases/${caseId}/dedupe`, { method: "POST" });
                  const d = await res.json();
                  if (d.removed > 0) { refresh(); }
                  else { alert("Keine Duplikate gefunden"); }
                }}
                className="btn-v2" style={{padding:"2px 8px",fontSize:11,background:"#fff",borderColor:"var(--orange-mid)",color:"var(--orange)",fontWeight:500}}>
                ⊘ Dedupe
              </button>
              <button onClick={deleteSelectedRows} className="btn-v2" style={{padding:"2px 8px",fontSize:11,background:"#fff",borderColor:"var(--danger)",color:"var(--danger)",fontWeight:500}}>
                <Trash2 style={{width:10,height:10}}/> Löschen
              </button>
              <button onClick={() => setSelectedRows(new Set())} style={{marginLeft:"auto",border:"none",background:"none",cursor:"pointer",fontSize:11,color:"var(--orange)"}}>
                ✕ Auswahl aufheben
              </button>
            </div>
          )}

          {/* Global run error */}
          {globalRunError && (
            <div style={{padding:"6px 16px",background:"#fef2f2",borderBottom:"1px solid #fecaca",display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#991b1b"}}>
              <AlertCircle style={{width:13,height:13,flexShrink:0}} />
              <span style={{flex:1}}>{globalRunError}</span>
              <button onClick={()=>router.push(`/cases/${caseId}/settings`)}
                style={{padding:"1px 8px",background:"#dc2626",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>
                Einstellungen
              </button>
              <button onClick={()=>setGlobalRunError(null)}
                style={{border:"none",background:"none",cursor:"pointer",color:"#991b1b",fontSize:15,lineHeight:1}}>×</button>
            </div>
          )}

          {/* Live Run Status Panel */}
          {(runningColumnId || runningRowIds.size > 0) && (
            <div style={{padding:"8px 16px",background:"#eff6ff",borderBottom:"1px solid #bfdbfe",display:"flex",flexWrap:"wrap",alignItems:"center",gap:10}}>
              {runningColumnId && (() => {
                const col = (caseData?.aiColumns ?? []).find(c => c.id === runningColumnId);
                return col ? (
                  <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                    <Loader2 style={{width:11,height:11,color:"#2563eb"}} className="animate-spin"/>
                    <span style={{fontWeight:600,color:"#1e40af"}}>Spalte: {col.name}</span>
                  </div>
                ) : null;
              })()}
              {runningRowIds.size > 0 && (
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#1d4ed8"}}>
                  <span>{runningRowIds.size} Zeilen aktiv</span>
                </div>
              )}
              {runningCells.size > 0 && (
                <span style={{fontSize:11,color:"#3b82f6"}}>
                  {runningCells.size} parallel
                </span>
              )}
              <button
                onClick={() => {
                  const col = (caseData?.aiColumns ?? []).find(c => c.id === runningColumnId);
                  if (col) stopColumn(col);
                }}
                style={{marginLeft:"auto",padding:"2px 10px",background:"#dc2626",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600}}>
                ■ Stop
              </button>
            </div>
          )}

          {/* No AI columns warning */}
          {activeTab === "Firmen" && (caseData?.aiColumns ?? []).length === 0 && (
            <div style={{padding:"6px 16px",background:"#fefce8",borderBottom:"1px solid #fde68a",display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#92400e"}}>
              ⚠️ Keine KI-Spalten — <button onClick={()=>setShowAddCol(true)} style={{padding:"1px 8px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>+ Spalte hinzufügen</button>
            </div>
          )}

          {/* ── CONTENT: Grouped or Flat ── */}
          {activeTab === "Firmen" && (<>
          {viewMode === "grouped" ? (
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <GroupedTableView caseId={caseId} />
            </div>
          ) : (<>

          {/* ── TABLE ── */}
          <div style={{flex:1,overflow:"auto",background:"var(--bg)",position:"relative"}}>
          <div style={{padding:"12px 16px",minWidth:"max-content"}}>
            <table className="case-detail-table" style={{borderCollapse:"collapse",fontSize:12.5,minWidth:"max-content",width:"100%",background:"var(--surface)"}}>
              <thead style={{position:"sticky",top:0,zIndex:20,background:"var(--surface)"}}>
                <tr style={{background:"var(--surface)",borderBottom:"1px solid var(--border)"}}>
                  <th style={{width:34,padding:"0 11px",height:34,borderBottom:"1px solid var(--border)",background:"var(--surface)"}}>
                    <input type="checkbox" checked={allSelected}
                      ref={el => { if (el) el.indeterminate = selectedRows.size > 0 && !allSelected; }}
                      onChange={() => {
                        if (selectedRows.size > 0) {
                          setSelectedRows(new Set());
                        } else {
                          setSelectedRows(new Set(dataRows.map(r => r.id)));
                        }
                      }}
                      style={{width:13,height:13,cursor:"pointer",accentColor:"var(--orange)"}} />
                  </th>
                  <th style={{width:32,padding:"0 6px",height:34,borderBottom:"1px solid var(--border)",color:"var(--text-3)",fontWeight:500,fontSize:11,textAlign:"center"}}>#</th>
                  {/* Status col */}
                  <th style={{padding:"0 11px",height:34,borderBottom:"1px solid var(--border)",textAlign:"left",fontWeight:600,fontSize:10.5,letterSpacing:"0.05em",textTransform:"uppercase",color:"var(--text-3)",whiteSpace:"nowrap",minWidth:90}}>
                    Status
                  </th>
                  {(visibleColOrder.length > 0 ? visibleColOrder : [...sourceColumns,...(caseData?.aiColumns ?? []).map(c=>c.outputKey)].filter(k=>!isHiddenCol(k))).map(key => {
                    const aiCol = (caseData?.aiColumns ?? []).find(c=>c.outputKey===key);
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
                        style={{
                          padding:"0 11px",
                          height:34,
                          borderBottom: aiCol ? "1px solid var(--green-mid)" : "1px solid var(--border)",
                          textAlign:"left",
                          fontWeight:600,
                          fontSize:10.5,
                          letterSpacing:"0.05em",
                          textTransform:"uppercase",
                          color: aiCol ? "var(--green)" : "var(--text-3)",
                          whiteSpace:"nowrap",
                          width: colWidths[key] ?? (key==="company_name"?200:aiCol?180:140),
                          minWidth:80,
                          cursor:"grab",
                          background: isDragOver ? "var(--orange-mid)" : aiCol ? "var(--green-soft)" : "var(--surface)",
                          borderLeft: isDragOver ? "2px solid var(--orange)" : undefined,
                          userSelect:"none",
                          position:"relative",
                        }}>
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
                          <GripVertical style={{width:10,height:10,color:"var(--text-3)",flexShrink:0}} />
                          {aiCol ? (
                            <ColumnHeaderMenu
                              column={{...aiCol, name: COL_LABELS[aiCol.outputKey] ?? shortColName(aiCol.name)}}
                              onRunAll={() => runColumn(aiCol, "all_force")}
                              onRunEmptyOnly={() => runColumn(aiCol, "empty_only")}
                              onDelete={() => deleteColumn(aiCol.id)}
                              onEdit={() => setEditingPromptCol({ ...aiCol })}
                              onStop={() => stopColumn(aiCol)}
                              isRunning={runningColumnId === aiCol.id}
                              sortBy={sortBy}
                              sortDir={sortDir}
                              onSort={() => {
                                if (sortBy === aiCol.outputKey) {
                                  setSortDir(d => d === "asc" ? "desc" : "asc");
                                } else {
                                  setSortBy(aiCol.outputKey);
                                  setSortDir("asc");
                                }
                              }}
                            />
                          ) : isOrphan ? (
                            <div className="group/hdr" style={{display:"flex",alignItems:"center",gap:4,width:"100%"}}>
                              <span style={{flex:1,color:"var(--green)",fontSize:11,fontWeight:600}}>{colLabel(key)}</span>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (sortBy === key) {
                                    setSortDir(d => d === "asc" ? "desc" : "asc");
                                  } else {
                                    setSortBy(key);
                                    setSortDir("asc");
                                  }
                                }}
                                title={`Nach ${colLabel(key)} sortieren`}
                                style={{
                                  border:"none",
                                  background: sortBy === key ? "var(--orange-soft)" : "none",
                                  borderRadius:3,
                                  cursor:"pointer",
                                  padding:"1px 4px",
                                  color: sortBy === key ? "var(--orange)" : "var(--text-3)",
                                  flexShrink:0,
                                  fontSize:10.5,
                                  fontWeight:700,
                                }}
                                className={sortBy === key ? "" : "opacity-0 group-hover/hdr:opacity-100"}>
                                {sortBy === key ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
                              </button>
                            </div>
                          ) : (
                            <div className="group/hdr" style={{display:"flex",alignItems:"center",gap:4,width:"100%"}}>
                              <span style={{flex:1}}>{colLabel(key)}</span>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (sortBy === key) {
                                    setSortDir(d => d === "asc" ? "desc" : "asc");
                                  } else {
                                    setSortBy(key);
                                    setSortDir("asc");
                                  }
                                }}
                                title={`Nach ${colLabel(key)} sortieren`}
                                style={{
                                  border:"none",
                                  background: sortBy === key ? "var(--orange-soft)" : "none",
                                  borderRadius:3,
                                  cursor:"pointer",
                                  padding:"1px 4px",
                                  color: sortBy === key ? "var(--orange)" : "var(--text-3)",
                                  flexShrink:0,
                                  fontSize:10.5,
                                  fontWeight:700,
                                }}
                                className={sortBy === key ? "" : "opacity-0 group-hover/hdr:opacity-100"}>
                                {sortBy === key ? (sortDir === "asc" ? "↑" : "↓") : "⇅"}
                              </button>
                              <button
                                onClick={e=>{e.stopPropagation();deleteSourceColumn(key);}}
                                className="opacity-0 group-hover/hdr:opacity-100"
                                style={{border:"none",background:"none",cursor:"pointer",padding:"1px 3px",color:"var(--text-3)",transition:"opacity .15s",flexShrink:0}}
                                title={`Spalte "${key}" löschen`}>
                                <Trash2 style={{width:11,height:11}} />
                              </button>
                            </div>
                          )}
                        </div>
                      </th>
                    );
                  })}
                  <th onClick={()=>setShowAddCol(true)} style={{padding:"0 11px",height:34,background:"var(--surface)",borderBottom:"1px solid var(--border)",minWidth:90,cursor:"pointer"}}>
                    <button onClick={(e)=>{e.stopPropagation();setShowAddCol(true);}}
                      style={{display:"flex",alignItems:"center",gap:4,fontSize:11.5,color:"var(--text-3)",border:"none",background:"none",cursor:"pointer",whiteSpace:"nowrap"}}
                      onMouseEnter={e=>(e.currentTarget.style.color="var(--orange)")}
                      onMouseLeave={e=>(e.currentTarget.style.color="var(--text-3)")}>
                      <Plus style={{width:12,height:12}} /> Spalte
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={sourceColumns.length + (caseData?.aiColumns ?? []).length + 4}
                    style={{textAlign:"center",padding:"48px 0",color:"var(--text-3)",fontSize:13}}>
                    Keine Zeilen. CSV importieren um zu starten.
                  </td></tr>
                ) : pageRows.map((row, rowIdx) => {
                  const totalCols = (caseData?.aiColumns ?? []).length;
                  const statuses = (caseData?.aiColumns ?? []).map(c => row.cellStatuses[c.outputKey] ?? "idle");
                  const errorCount = statuses.filter(s => s === "error").length;
                  const runningCount = statuses.filter(s => s === "running").length;
                  const doneCount = statuses.filter(s => s === "done" || s === "skipped").length;
                  const rowState: "error" | "running" | "completed" | "partial" | "pending" =
                    errorCount > 0 ? "error"
                    : runningCount > 0 ? "running"
                    : totalCols > 0 && doneCount === totalCols ? "completed"
                    : doneCount > 0 ? "partial"
                    : "pending";
                  const sel = selectedRows.has(row.id);
                  return (
                    <tr key={row.id}
                      style={{
                        background: sel ? "var(--orange-soft)" : rowState==="running" ? "#fefce8" : rowState==="error" ? "var(--danger-soft)" : "var(--surface)",
                        borderBottom:"1px solid var(--border-xs)",
                      }}
                      onMouseEnter={e => {
                        if (!sel && rowState !== "running" && rowState !== "error") {
                          e.currentTarget.style.background = "#faf9f7";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!sel && rowState !== "running" && rowState !== "error") {
                          e.currentTarget.style.background = "var(--surface)";
                        }
                      }}
                      onContextMenu={e => {
                        e.preventDefault();
                        const choice = window.confirm(
                          `Zeile: ${row.data["company_name"] ?? row.data[sourceColumns[0]] ?? row.id.slice(0,8)}\n\n` +
                          `[OK] = Alle Spalten neu ausführen (überschreibt)\n` +
                          `[Abbrechen] = Nur leere Zellen füllen`
                        );
                        if (choice) {
                          for (const col of (caseData?.aiColumns ?? [])) runCell(row.id, col);
                        } else {
                          for (const col of (caseData?.aiColumns ?? [])) {
                            const val = row.data[col.outputKey];
                            const isEmpty = !val || String(val).trim() === "" || /^notfound$/i.test(String(val));
                            if (isEmpty) runCell(row.id, col);
                          }
                        }
                      }}>
                      <td style={{width:34,padding:"0 11px",height:42,borderBottom:"1px solid var(--border-xs)"}}>
                        <input type="checkbox" checked={sel}
                          onChange={e => { const s=new Set(selectedRows); e.target.checked?s.add(row.id):s.delete(row.id); setSelectedRows(s); }}
                          style={{width:13,height:13,cursor:"pointer",accentColor:"var(--orange)"}} />
                      </td>
                      <td style={{width:32,padding:"0 6px",height:42,borderBottom:"1px solid var(--border-xs)",color:"var(--text-3)",textAlign:"center",fontSize:11}}>{page*pageSize+rowIdx+1}</td>
                      {/* Status badge */}
                      <td style={{padding:"0 11px",height:42,borderBottom:"1px solid var(--border-xs)",whiteSpace:"nowrap"}}>
                        {rowState === "error" && (
                          <span className="status-pill status-pill-error" title={`${errorCount} von ${totalCols} Spalten fehlgeschlagen`}>
                            Fehler
                          </span>
                        )}
                        {rowState === "running" && (
                          <span className="status-pill status-pill-pending">
                            <Loader2 style={{width:9,height:9}} className="animate-spin" /> Läuft
                          </span>
                        )}
                        {rowState === "completed" && (
                          <span className="status-pill status-pill-done">
                            Fertig
                          </span>
                        )}
                        {rowState === "partial" && (
                          <span className="status-pill status-pill-done" style={{background:"var(--orange-soft)",color:"var(--orange)"}}>
                            ◐ {doneCount}/{totalCols}
                          </span>
                        )}
                        {rowState === "pending" && (
                          <span className="status-pill status-pill-pending">
                            Ausstehend
                          </span>
                        )}
                        {(() => {
                          const src = row.data["search_source"] ?? "";
                          const query = row.data["search_query"] ?? "";
                          if (!src) return null;
                          const icon = src.includes("maps") ? "🗺️" : src === "firecrawl" ? "🔥" : src === "linkup" ? "🔗" : src === "serpapi" ? "🔍" : "🌐";
                          const label = src.includes("maps") ? "Maps" : src === "firecrawl" ? "Firecrawl" : src === "linkup" ? "Linkup" : src === "serpapi" ? "SerpApi" : src;
                          return (
                            <span title={`Quelle: ${src}\nQuery: ${query}`}
                              style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:10,color:"var(--text-2)",background:"var(--bg)",border:"1px solid var(--border)",padding:"1px 5px",borderRadius:4,marginLeft:6,cursor:"help",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {icon} {label}
                            </span>
                          );
                        })()}
                      </td>
                      {(visibleColOrder.length > 0 ? visibleColOrder : [...sourceColumns,...(caseData?.aiColumns ?? []).map(c=>c.outputKey)].filter(k=>!isHiddenCol(k))).map(key => {
                        const aiCol = (caseData?.aiColumns ?? []).find(c=>c.outputKey===key);
                        const isSrc = sourceColumns.includes(key);
                        if (aiCol) {
                          const col = aiCol; // narrow for closure
                          const status: CellStatus = row.cellStatuses[col.outputKey]??"idle";
                          const val = row.data[col.outputKey]??"";
                          const err = row.cellErrors[col.outputKey];
                          const isEd = editingCell?.rowId===row.id && editingCell.key===col.outputKey;
                          const hasRun = status==="done"||status==="error"||status==="skipped";
                          const notFound = status==="done" && !val;
                          const isValid = val.startsWith("✓");
                          const isInvalid = val.startsWith("✗");
                          // Primary click action depends on state
                          function handleCellClick(e: React.MouseEvent) {
                            e.stopPropagation();
                            if (status === "running") { stopCell(row.id, col); return; }
                            if (status === "idle") { runCell(row.id, col); return; }
                            setRunDetailCell({col, row}); // done/error/skipped → show details
                          }
                          return (
                            <td key={key}
                              onClick={handleCellClick}
                              onDoubleClick={()=>startEdit(row.id,aiCol.outputKey,val)}
                              title={status==="idle"?"Klicken zum Ausführen":status==="running"?"Klicken zum Stoppen":status==="error"?err:"Klicken für Details"}
                              className="group/cell"
                              style={{
                                padding:"5px 10px",
                                borderRight:"1px solid #f3f4f6",
                                cursor: status==="idle" ? "pointer" : "default",
                                background: status==="error"?"#fef2f2": status==="idle"?"":undefined,
                                minWidth: aiCol.tool==="batch_contact" ? 160 : 100,
                                verticalAlign: "middle",
                              }}>
                              {isEd ? <EditInput rowId={row.id} k={aiCol.outputKey} /> : (
                                <div style={{display:"flex",alignItems: aiCol.tool==="batch_contact" ? "flex-start" : "center",gap:4,minHeight:22,position:"relative"}}>

                                  {/* ── RUNNING ── */}
                                  {status==="running" && <>
                                    <Loader2 style={{width:11,height:11,color:"#d97706",flexShrink:0}} className="animate-spin"/>
                                    <span style={{fontSize:11,color:"#d97706",flex:1}}>läuft…</span>
                                    <span style={{fontSize:10,color:"#f87171",background:"#fee2e2",padding:"1px 5px",borderRadius:4,flexShrink:0}}>■ Stop</span>
                                  </>}

                                  {/* ── IDLE — click to run ── */}
                                  {status==="idle" && (() => {
                                    const isBatch = col.tool === "batch_company" || col.tool === "batch_contact";
                                    const hasInput = !!(row.data["domain"] || row.data["company_name"]);
                                    const label = col.tool==="batch_company"
                                      ? (row.data["domain"] ? "Anreichern" : "Domain fehlt")
                                      : col.tool==="batch_contact"
                                      ? (hasInput ? "Kontakte suchen" : "Name/Domain fehlt")
                                      : "Run";
                                    const noInput = isBatch && !hasInput;
                                    return (
                                      <span style={{fontSize:10,flex:1,display:"flex",alignItems:"center",gap:3,overflow:"hidden",
                                        color: noInput ? "#f59e0b" : isBatch ? "#7c3aed" : "#c4b5fd"}}>
                                        {isBatch
                                          ? <span style={{background: noInput?"#fef3c7":"#ede9fe",padding:"1px 6px",borderRadius:4,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                              {noInput ? "⚠ " : "▶ "}{label}
                                            </span>
                                          : <><Play style={{width:9,height:9,flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span></>
                                        }
                                      </span>
                                    );
                                  })()}

                                  {/* ── SKIPPED ── */}
                                  {status==="skipped" && (() => {
                                    const isBatch = col.tool === "batch_company" || col.tool === "batch_contact";
                                    if (!val || val === "") {
                                      // batch tools: only show run button if truly no data yet
                                      if (isBatch) {
                                        const d = row.data as Record<string, string|null>;
                                        const hasData = col.tool === "batch_company"
                                          ? (col.batchOutputFields ?? ["company_name","domain","phone","company_email","city","industry"]).some(f => d[f] && d[f] !== "")
                                          : !!(d[`_contacts_json_${col.outputKey}`] || d[`${col.batchContactsPrefix ?? "contact_"}1_first_name`]);
                                        if (hasData) {
                                          // data exists in sibling fields — show summary instead
                                          if (col.tool === "batch_company") {
                                            const filled = (col.batchOutputFields ?? ["company_name","domain","phone","company_email","city","zip","industry","description"]).filter(f => d[f] && d[f] !== "");
                                            return <span style={{fontSize:10,color:"#7c3aed",background:"#ede9fe",padding:"1px 5px",borderRadius:4,fontWeight:600}}>{filled.length} Felder ✓</span>;
                                          }
                                          return <span style={{fontSize:11,color:"#9ca3af",flex:1}}>✓</span>;
                                        }
                                        const hasInput = !!(row.data["domain"] || row.data["company_name"]);
                                        const label = col.tool==="batch_company" ? "Anreichern" : "Kontakte suchen";
                                        return (
                                          <span style={{fontSize:10,flex:1,display:"flex",alignItems:"center",gap:3,color:"#7c3aed"}}>
                                            <span style={{background:"#ede9fe",padding:"1px 6px",borderRadius:4,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",opacity:hasInput?1:0.5}}>
                                              ▶ {label}
                                            </span>
                                          </span>
                                        );
                                      }
                                      return <span style={{fontSize:11,color:"#d1d5db",flex:1}} title="Übersprungen — Bedingung nicht erfüllt">—</span>;
                                    }
                                    return (
                                      <span style={{fontSize:11,color:"#9ca3af",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={`Übersprungen (Bedingung) · Wert: ${val}`}>
                                        {col.tool === "batch_contact" ? (() => {
                                          // Show compact badge even in skipped state
                                          const d = row.data as Record<string, string|null>;
                                          const jsonKey = `_contacts_json_${col.outputKey}`;
                                          let contacts: Array<{first_name:string|null;last_name:string|null;position:string|null;email:string|null}> = [];
                                          if (d[jsonKey]) { try { contacts = JSON.parse(d[jsonKey]!); } catch { /* ignore */ } }
                                          if (contacts.length === 0) return <>{val.split("\n")[0].slice(0,40)}{val.includes("\n") ? " …" : ""}</>;
                                          const primary = contacts[0];
                                          const name = [primary.first_name, primary.last_name].filter(Boolean).join(" ");
                                          return (
                                            <div style={{flex:1,display:"flex",alignItems:"center",gap:5,minWidth:0,overflow:"hidden"}}>
                                              <span style={{flexShrink:0,fontSize:10,fontWeight:700,color:"#7c3aed",background:"#ede9fe",padding:"1px 6px",borderRadius:10,lineHeight:1.6}}>{contacts.length}</span>
                                              <span style={{fontSize:11,fontWeight:600,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
                                              {contacts.length > 1 && <span style={{flexShrink:0,fontSize:10,color:"#9ca3af"}}>+{contacts.length-1}</span>}
                                            </div>
                                          );
                                        })() : <>{val.split("\n")[0].slice(0,40)}{val.includes("\n") ? " …" : ""}</>}
                                      </span>
                                    );
                                  })()}

                                  {/* ── ERROR ── */}
                                  {status==="error" && (
                                    <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,color:"#dc2626",flex:1}} title={err}>
                                      <AlertCircle style={{width:10,height:10,flexShrink:0}}/> {err?.slice(0,40)||"Fehler"}
                                    </span>
                                  )}

                                  {/* ── DONE ── */}
                                  {status==="done" && <>
                                    {/* batch_contact: compact badge — click cell to see full details in modal */}
                                    {aiCol.tool==="batch_contact" && (() => {
                                      const contactsJsonKey = `_contacts_json_${aiCol.outputKey}`;
                                      const contactsRaw = row.data[contactsJsonKey];
                                      const d = row.data as Record<string, string|null>;
                                      const prefix = aiCol.batchContactsPrefix ?? "contact_";
                                      type FC = {first_name:string|null;last_name:string|null;position:string|null;email:string|null;phone:string|null;linkedin:string|null};
                                      let contacts: FC[] = [];
                                      if (contactsRaw) {
                                        try { contacts = JSON.parse(contactsRaw); } catch { /* ignore */ }
                                      }
                                      if (contacts.length === 0) {
                                        for (let n = 1; n <= 5; n++) {
                                          const fn = d[`${prefix}${n}_first_name`];
                                          const ln = d[`${prefix}${n}_last_name`];
                                          if (!fn && !ln) break;
                                          contacts.push({ first_name: fn??null, last_name: ln??null, position: d[`${prefix}${n}_position`]??null, email: d[`${prefix}${n}_email`]??null, phone: d[`${prefix}${n}_phone`]??null, linkedin: d[`${prefix}${n}_linkedin`]??null });
                                        }
                                        if (contacts.length === 0 && (d["first_name"] || d["last_name"])) {
                                          contacts.push({ first_name: d["first_name"]??null, last_name: d["last_name"]??null, position: d["position"]??null, email: d["contact_email"]??d["email"]??null, phone: d["contact_phone"]??d["phone"]??null, linkedin: d["linkedin"]??null });
                                        }
                                      }
                                      const companyEmail = d["company_email"] ?? d["email_fallback"] ?? "";
                                      if (contacts.length === 0 && !companyEmail) {
                                        return <span style={{fontSize:11,color:"#9ca3af",fontStyle:"italic",flex:1}}>—</span>;
                                      }
                                      const primary = contacts[0];
                                      const primaryName = primary ? [primary.first_name, primary.last_name].filter(Boolean).join(" ") : "";
                                      const primaryEmail = primary?.email || d[`${prefix}1_email_extrapolated`] || d["email_extrapolated"] || "";
                                      const hasEmail = !!(primary?.email);
                                      const hasExtrapolated = !hasEmail && !!primaryEmail;
                                      return (
                                        <div style={{flex:1,display:"flex",alignItems:"center",gap:5,minWidth:0,overflow:"hidden"}}>
                                          {/* count badge */}
                                          <span style={{flexShrink:0,fontSize:10,fontWeight:700,color:"#7c3aed",background:"#ede9fe",padding:"1px 6px",borderRadius:10,lineHeight:1.6}}>
                                            {contacts.length}
                                          </span>
                                          <div style={{minWidth:0,flex:1,overflow:"hidden"}}>
                                            {primaryName && (
                                              <div style={{fontSize:11,fontWeight:600,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                                {primaryName}
                                              </div>
                                            )}
                                            {primaryEmail && (
                                              <div style={{fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color: hasExtrapolated ? "#a855f7" : "#2563eb"}}>
                                                {hasExtrapolated ? "⚡ " : ""}{primaryEmail}
                                              </div>
                                            )}
                                            {!primaryName && companyEmail && (
                                              <div style={{fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🏢 {companyEmail}</div>
                                            )}
                                          </div>
                                          {contacts.length > 1 && (
                                            <span style={{flexShrink:0,fontSize:10,color:"#9ca3af"}}>+{contacts.length-1}</span>
                                          )}
                                        </div>
                                      );
                                    })()}
                                    {aiCol.tool!=="batch_contact" && notFound && (
                                      <span style={{fontSize:11,color:"#9ca3af",fontStyle:"italic",flex:1}}>—</span>
                                    )}
                                    {aiCol.tool!=="batch_contact" && isValid && (
                                      <span style={{fontSize:12,fontWeight:600,color:"#6d28d9",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val.slice(2)}</span>
                                    )}
                                    {aiCol.tool!=="batch_contact" && isInvalid && (
                                      <span style={{fontSize:12,fontWeight:600,color:"#dc2626",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val.slice(2)}</span>
                                    )}
                                    {aiCol.tool!=="batch_contact" && val && !isValid && !isInvalid && (() => {
                                      const isBatchEnrich = aiCol.tool === "batch_company";
                                      const isBatchContacts = false; // handled above

                                      // ── batch_company: show filled field count + key values ──
                                      if (isBatchEnrich) {
                                        const d = row.data as Record<string, string | null>;
                                        const enrichedFields = (aiCol.batchOutputFields ?? ["company_name","domain","phone","company_email","city","industry","description"])
                                          .filter(f => d[f] && d[f] !== "");
                                        const keyVals = [d["phone"], d["company_email"] || d["city"]].filter(Boolean) as string[];
                                        return (
                                          <div style={{flex:1,minWidth:0}}>
                                            <div style={{display:"flex",alignItems:"center",gap:4}}>
                                              <span style={{fontSize:10,fontWeight:600,color:"#7c3aed",background:"#ede9fe",padding:"1px 5px",borderRadius:4,flexShrink:0}}>
                                                {enrichedFields.length} Felder
                                              </span>
                                              {keyVals[0] && <span style={{fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{keyVals[0]}</span>}
                                            </div>
                                            {d["industry"] && <div style={{fontSize:10,color:"#9ca3af",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>{d["industry"]}</div>}
                                          </div>
                                        );
                                      }

                                      // ── JSON audit col (vilocal_audit etc.) ──
                                      if (col.outputMode === "json" && val.trimStart().startsWith("{")) {
                                        try {
                                          const j = JSON.parse(val);
                                          const score = j.score as number | undefined;
                                          const priority = j.priority as string | undefined;
                                          const isChain = j.is_chain as boolean | undefined;
                                          const chainCount = j.chain_location_count as number | undefined;
                                          const pitchHook = j.pitch_hook as string | undefined;
                                          const missingCount = Array.isArray(j.missing) ? (j.missing as unknown[]).length : 0;
                                          const prioColor = priority === "hoch" ? "#dc2626" : priority === "mittel" ? "#d97706" : "#16a34a";
                                          return (
                                            <div style={{flex:1,display:"flex",flexDirection:"column",gap:2,minWidth:0}} title={pitchHook}>
                                              <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap"}}>
                                                {score != null && <span style={{fontSize:10,fontWeight:700,background:score>=7?"#dcfce7":score>=5?"#fef9c3":"#fee2e2",color:score>=7?"#166534":score>=5?"#854d0e":"#991b1b",padding:"1px 5px",borderRadius:4,flexShrink:0}}>⭐ {score}/10</span>}
                                                {priority && <span style={{fontSize:10,fontWeight:600,color:prioColor,background:priority==="hoch"?"#fef2f2":priority==="mittel"?"#fffbeb":"#f0fdf4",padding:"1px 5px",borderRadius:4,flexShrink:0}}>{priority}</span>}
                                                {isChain && <span style={{fontSize:10,background:"#eff6ff",color:"#1d4ed8",padding:"1px 5px",borderRadius:4,flexShrink:0}}>🔗 {chainCount ?? "?"}{j.chain_location_count_plus ? "+" : ""}</span>}
                                                {missingCount > 0 && <span style={{fontSize:10,color:"#92400e",background:"#fffbeb",padding:"1px 5px",borderRadius:4,flexShrink:0}}>⚠ {missingCount}</span>}
                                              </div>
                                              {pitchHook && <span style={{fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pitchHook}</span>}
                                            </div>
                                          );
                                        } catch { /* fall through to normal render */ }
                                      }

                                      // ── gmb_check: colored status badge ──
                                      if (aiCol.tool === "gmb_check") {
                                        const cfg =
                                          val === "Kein Eintrag"   ? { bg: "#fee2e2", color: "#991b1b", icon: "✗" } :
                                          val === "Vorhanden"       ? { bg: "#dcfce7", color: "#166534", icon: "✓" } :
                                          val === "Unbeansprucht"   ? { bg: "#fef9c3", color: "#854d0e", icon: "⚠" } :
                                          null;
                                        if (cfg) {
                                          return (
                                            <span style={{fontSize:11,fontWeight:600,background:cfg.bg,color:cfg.color,padding:"1px 7px",borderRadius:99,flexShrink:0}} title={val}>
                                              {cfg.icon} {val}
                                            </span>
                                          );
                                        }
                                      }

                                      // ── normal AI col ──
                                      return <span style={{fontSize:12,color:"#1f2937",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val}</span>;
                                    })()}
                                    {/* Re-run icon — only visible on hover */}
                                    <button
                                      onClick={e=>{e.stopPropagation();runCell(row.id,aiCol);}}
                                      className="opacity-0 group-hover/cell:opacity-100"
                                      style={{border:"none",background:"none",cursor:"pointer",padding:"2px 3px",color:"#9ca3af",display:"flex",transition:"opacity .15s",flexShrink:0}}
                                      title="Erneut ausführen">
                                      <Play style={{width:8,height:8}}/>
                                    </button>
                                  </>}

                                </div>
                              )}
                            </td>
                          );
                        }
                        const val = row.data[key]??"";
                        const isEd = editingCell?.rowId===row.id && editingCell.key===key;
                        const isValidated = !isSrc && !aiCol;
                        const isReasoning = key.startsWith("_reasoning_");

                        // ── Maps rating compact cell ──────────────────────
                        if (key === "maps_rating" && val) {
                          const rating = parseFloat(val);
                          const reviews = row.data["maps_reviews"] ?? "";
                          return (
                            <td key={key} style={{padding:"5px 10px",borderRight:"1px solid #f3f4f6",whiteSpace:"nowrap"}}>
                              <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12,fontWeight:600,color:"#b45309"}}>
                                <span style={{color:"#f59e0b"}}>★</span> {rating.toFixed(1)}
                                {reviews && <span style={{fontWeight:400,color:"#9ca3af",fontSize:11}}>({reviews})</span>}
                              </span>
                            </td>
                          );
                        }
                        // ── Maps reviews — hidden if rating is shown ──────
                        if (key === "maps_reviews") {
                          // reviews are shown inline in maps_rating cell — skip separate cell only if rating exists
                          if (row.data["maps_rating"]) return <td key={key} style={{padding:"5px 10px",borderRight:"1px solid #f3f4f6",maxWidth:80}}><span style={{fontSize:11,color:"#9ca3af"}}>{val}</span></td>;
                        }
                        // ── Category badge ────────────────────────────────
                        if (key === "category" && val) {
                          return (
                            <td key={key} style={{padding:"5px 10px",borderRight:"1px solid #f3f4f6"}}>
                              <span style={{fontSize:11,color:"#0369a1",background:"#e0f2fe",padding:"1px 7px",borderRadius:99,whiteSpace:"nowrap"}}>{val}</span>
                            </td>
                          );
                        }

                        // ── Cache Timestamp / Status Cell ────────────────
                        if (key === "_scrape_cached_ts") {
                          const cached = row.data["_scrape_cached"] === "true" || !!row.data["_scrape_cached_ts"];
                          const ts = val ? new Date(val).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "";
                          const date = val ? new Date(val).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "";
                          return (
                            <td key={key} style={{padding:"5px 10px",borderRight:"1px solid #f3f4f6",whiteSpace:"nowrap"}}>
                              {cached ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCacheModalRow(row);
                                    setCacheModalLoading(true);
                                    const d = row.data["domain"] ?? row.data["source_domain"] ?? "";
                                    fetch(`/api/cache?domain=${encodeURIComponent(d)}`)
                                      .then(r => r.json())
                                      .then(data => setCacheModalEntries(data.entries ?? []))
                                      .catch(() => setCacheModalEntries([]))
                                      .finally(() => setCacheModalLoading(false));
                                  }}
                                  style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#15803d",background:"#dcfce7",border:"1px solid #bbf7d0",padding:"2px 8px",borderRadius:4,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}
                                  onMouseEnter={e => { e.currentTarget.style.background = "#bbf7d0"; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = "#dcfce7"; }}
                                  title={`Klicken für alle Cache-Details (${date} um ${ts} Uhr)`}
                                >
                                  ⚡ Gecached {ts ? `(${ts})` : ""} 🔍
                                </button>
                              ) : (
                                <span style={{fontSize:11,color:"#9ca3af"}} title="Noch kein Web-Scrape im lokalen Cache">—</span>
                              )}
                            </td>
                          );
                        }

                        // ── Contacts aggregation cell ─────────────────────
                        // Matches both the "contacts" source col and batch_contact AI cols (e.g. _batch_kontakte)
                        const isContactsCell = key === "contacts" && isSrc;
                        if (isContactsCell) {
                          const d = row.data as Record<string, string|null>;
                          type ContactEntry = {name:string; position:string; email:string; phone:string; linkedin:string; extrapolated?:string};
                          const contacts: ContactEntry[] = [];
                          const jsonKey = Object.keys(d).find(k => k.startsWith("_contacts_json_"));
                          if (jsonKey && d[jsonKey]) {
                            try {
                              const parsed = JSON.parse(d[jsonKey]!);
                              if (Array.isArray(parsed)) {
                                parsed.slice(0,3).forEach((c: Record<string,string|null>, i: number) => contacts.push({
                                  name: [c.first_name,c.last_name].filter(Boolean).join(" "),
                                  position: c.position ?? "",
                                  email: c.email ?? "",
                                  phone: c.phone ?? "",
                                  linkedin: c.linkedin ?? "",
                                  extrapolated: d[`contact_${i+1}_email_extrapolated`] ?? "",
                                }));
                              }
                            } catch { /* ignore */ }
                          }
                          if (contacts.length === 0 && (d["first_name"] || d["last_name"])) {
                            contacts.push({
                              name: [d["first_name"],d["last_name"]].filter(Boolean).join(" "),
                              position: d["position"] ?? "",
                              email: d["contact_email"] ?? d["email"] ?? "",
                              phone: d["contact_phone"] ?? d["phone"] ?? "",
                              linkedin: d["linkedin"] ?? "",
                              extrapolated: d["email_extrapolated"] ?? "",
                            });
                          }
                          const companyEmail = d["company_email"] ?? "";
                          const emailFallback = d["email_fallback"] ?? "";
                          if (contacts.length === 0 && !companyEmail && !emailFallback) return <td key={key} style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",color:"#d1d5db",fontSize:11}}>—</td>;
                          return (
                            <td key={key} style={{padding:"4px 10px",borderRight:"1px solid #f3f4f6",verticalAlign:"top",minWidth:240,maxWidth:340}}>
                              {contacts.map((c, i) => (
                                <div key={i} style={{fontSize:11,lineHeight:1.6,borderBottom:i<contacts.length-1?"1px solid #f3f4f6":undefined,paddingBottom:i<contacts.length-1?4:0,marginBottom:i<contacts.length-1?4:0}}>
                                  {/* Name + Position */}
                                  <div style={{fontWeight:600,color:"#1e293b"}}>
                                    {c.name || "—"}
                                    {c.position && <span style={{fontWeight:400,color:"#6b7280",marginLeft:4,fontSize:10}}>· {c.position}</span>}
                                  </div>
                                  {/* Email row */}
                                  <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                                    {c.email
                                      ? <a href={`mailto:${c.email}`} style={{color:"#2563eb",textDecoration:"none",fontSize:10,fontFamily:"monospace"}}>{c.email}</a>
                                      : c.extrapolated
                                      ? <span style={{color:"#a855f7",fontSize:10,fontFamily:"monospace"}} title="Extrapoliert — nicht SMTP-verifiziert">⚡ {c.extrapolated}</span>
                                      : null}
                                    {c.phone && <span style={{color:"#6b7280",fontSize:10}}>📞 {c.phone}</span>}
                                    {c.linkedin && (
                                      <a href={c.linkedin} target="_blank" rel="noopener noreferrer"
                                        style={{color:"#0a66c2",fontSize:10,textDecoration:"none"}} title={c.linkedin}>
                                        💼 LinkedIn
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {/* Generic company email */}
                              {(companyEmail || emailFallback) && (
                                <div style={{fontSize:10,color:"#9ca3af",marginTop:contacts.length?4:0,borderTop:contacts.length?"1px solid #f3f4f6":undefined,paddingTop:contacts.length?3:0}}>
                                  <span style={{color:"#6b7280"}}>🏢 Firma: </span>
                                  <a href={`mailto:${companyEmail||emailFallback}`} style={{color:"#6b7280",fontSize:10,fontFamily:"monospace"}}>{companyEmail||emailFallback}</a>
                                </div>
                              )}
                            </td>
                          );
                        }
                        // ── JSON audit columns (vilocal_audit etc.) ──────
                        if ((caseData?.aiColumns ?? []).find(c=>c.outputKey===key)?.outputMode === "json" && val?.trimStart().startsWith("{")) {
                          try {
                            const j = JSON.parse(val);
                            const score = j.score as number | undefined;
                            const priority = j.priority as string | undefined;
                            const isChain = j.is_chain as boolean | undefined;
                            const chainCount = j.chain_location_count as number | undefined;
                            const pitchHook = j.pitch_hook as string | undefined;
                            const missingCount = Array.isArray(j.missing) ? j.missing.length : 0;
                            const prioColor = priority === "hoch" ? "#dc2626" : priority === "mittel" ? "#d97706" : "#16a34a";
                            return (
                              <td key={key} style={{padding:"5px 10px",borderRight:"1px solid #f3f4f6",minWidth:180,maxWidth:260}} onDoubleClick={()=>startEdit(row.id,key,val)}>
                                <div style={{display:"flex",flexDirection:"column",gap:2}} title={pitchHook}>
                                  <div style={{display:"flex",gap:3,alignItems:"center",flexWrap:"wrap"}}>
                                    {score != null && <span style={{fontSize:10,fontWeight:700,background:score>=7?"#dcfce7":score>=5?"#fef9c3":"#fee2e2",color:score>=7?"#166534":score>=5?"#854d0e":"#991b1b",padding:"1px 5px",borderRadius:4}}>⭐ {score}/10</span>}
                                    {priority && <span style={{fontSize:10,fontWeight:600,color:prioColor,background:priority==="hoch"?"#fef2f2":priority==="mittel"?"#fffbeb":"#f0fdf4",padding:"1px 5px",borderRadius:4}}>{priority}</span>}
                                    {isChain && <span style={{fontSize:10,background:"#eff6ff",color:"#1d4ed8",padding:"1px 5px",borderRadius:4}}>🔗 {chainCount ?? "?"}</span>}
                                    {missingCount > 0 && <span style={{fontSize:10,color:"#92400e",background:"#fffbeb",padding:"1px 5px",borderRadius:4}}>⚠ {missingCount}</span>}
                                  </div>
                                  {pitchHook && <span style={{fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block",maxWidth:240}}>{pitchHook}</span>}
                                </div>
                              </td>
                            );
                          } catch { /* fall through */ }
                        }
                        return (
                          <td key={key} style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",maxWidth:200,
                            background: isValidated ? (val.startsWith("✗")?"#fef2f2":val.startsWith("✓")?"#f5f3ff":undefined) : undefined,
                            cursor: isReasoning && val ? "pointer" : undefined
                          }} onDoubleClick={()=>startEdit(row.id,key,val)} onClick={() => {
                            if (isReasoning && val) {
                              setReasoningModal({ content: val, title: key.replace("_reasoning_", "") });
                            }
                          }}>
                            {isEd ? <EditInput rowId={row.id} k={key} /> :
                              (() => {
                                // E-Mail column: show company_email/email_fallback as grey fallback if email is empty
                                const isEmailCol = key === "email";
                                const fallbackEmail = isEmailCol && !val
                                  ? ((row.data as Record<string,string|null>)["company_email"] ?? (row.data as Record<string,string|null>)["email_fallback"] ?? "")
                                  : "";
                                const displayVal = val || fallbackEmail;
                                // Domain/URL columns → clickable link
                                const isDomainCol = key === "domain" || key === "source_domain" || key === "source_url" || key === "website" || key === "maps_url" || key === "linkedin";
                                // Fix place_id URLs for maps_url — convert to proper search URL
                                const rawHrefVal = displayVal && (displayVal.startsWith("http") || (isDomainCol && displayVal.includes("."))) ? displayVal : null;
                                let href = rawHrefVal ? (rawHrefVal.startsWith("http") ? rawHrefVal : `https://${rawHrefVal}`) : null;
                                if (href && key === "maps_url") {
                                  const placeIdMatch = href.match(/place_id[=:](\d+)/);
                                  if (placeIdMatch) {
                                    const rowCompany = row.data["company_name"] ?? row.data["Unternehmensname"] ?? "";
                                    const rowCity = row.data["city"] ?? row.data["Stadt"] ?? "";
                                    const q = [rowCompany, rowCity].filter(Boolean).join(" ");
                                    href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&query_place_id=${placeIdMatch[1]}`;
                                  }
                                }
                                const isUrl = !!href;
                                // ── JSON AI column: render as structured pills ──
                                const aiColDef = (caseData?.aiColumns ?? []).find(c => c.outputKey === key);
                                const trimmedVal = displayVal?.trimStart() ?? "";
                                const isJsonAudit = (aiColDef?.outputMode === "json" || trimmedVal.includes('"score"')) && trimmedVal.startsWith("{");
                                if (isJsonAudit) {
                                  try {
                                    const j = JSON.parse(displayVal);
                                    const score = j.score;
                                    const priority = j.priority as string | undefined;
                                    const isChain = j.is_chain;
                                    const chainCount = j.chain_location_count;
                                    const pitchHook = j.pitch_hook as string | undefined;
                                    const missing = Array.isArray(j.missing) ? j.missing.length : 0;
                                    const prioColor = priority === "hoch" ? "#dc2626" : priority === "mittel" ? "#d97706" : "#16a34a";
                                    return <div style={{display:"flex",flexDirection:"column",gap:2,padding:"2px 0"}} title={pitchHook}>
                                      <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
                                        {score != null && <span style={{fontSize:10,fontWeight:600,background:score>=7?"#dcfce7":score>=5?"#fef9c3":"#fee2e2",color:score>=7?"#166534":score>=5?"#854d0e":"#991b1b",padding:"1px 5px",borderRadius:4}}>⭐ {score}/10</span>}
                                        {priority && <span style={{fontSize:10,fontWeight:600,color:prioColor,background:priority==="hoch"?"#fef2f2":priority==="mittel"?"#fffbeb":"#f0fdf4",padding:"1px 5px",borderRadius:4}}>{priority}</span>}
                                        {isChain && <span style={{fontSize:10,background:"#eff6ff",color:"#1d4ed8",padding:"1px 5px",borderRadius:4}}>🔗 {chainCount ?? "?"} Standorte</span>}
                                        {missing > 0 && <span style={{fontSize:10,color:"#92400e",background:"#fffbeb",padding:"1px 5px",borderRadius:4}}>⚠ {missing} fehlt</span>}
                                      </div>
                                      {pitchHook && <span style={{fontSize:10,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:280}}>{pitchHook}</span>}
                                    </div>;
                                  } catch { /* fall through to normal render */ }
                                }
                                const content = isReasoning ? `🧠 ${displayVal}` : displayVal;
                                const isFallback = isEmailCol && !val && !!fallbackEmail;
                                const textStyle: React.CSSProperties = {
                                  fontSize:12,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                                  color: isDomainCol && href ? "#2563eb" : isValidated ? (val.startsWith("✗")?"#dc2626":val.startsWith("✓")?"#6d28d9":"#4b5563") : isReasoning?"#7c3aed":key==="company_name"?"#1f2937":"#4b5563",
                                  fontStyle: isReasoning?"italic":undefined,
                                  textDecoration: isDomainCol && href ? "none" : undefined,
                                };
                                return href
                                  ? <div style={{display:"flex",alignItems:"center",gap:4}}>
                                      {isDomainCol && key === "domain" && (
                                        <button
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            await fetch(`/api/cases/${caseId}/flag-catalog`, {
                                              method: "POST",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ rowId: row.id, flag: true }),
                                            });
                                            refresh();
                                          }}
                                          title="Als Katalogseite markieren — Domain wird gelernt & in Quellen-Tab verschoben"
                                          style={{border:"1px solid #fde68a",background:"#fffbeb",cursor:"pointer",padding:"1px 4px",fontSize:9,color:"#92400e",borderRadius:3,flexShrink:0,lineHeight:1}}
                                        >📚</button>
                                      )}
                                      <a href={href} target="_blank" rel="noopener noreferrer" style={{...textStyle,flex:1}} title={isFallback?`Firmen-E-Mail (Fallback): ${displayVal}`:displayVal} onClick={e => e.stopPropagation()}>{content}</a>
                                      {isDomainCol && (
                                        <button
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            const newData = { ...(row.data as Record<string,string|null>) };
                                            newData[key] = null;
                                            if (key === "domain") {
                                              // Also clear row cache flags so user sees cache is cleared for this row
                                              delete newData["_scrape_cached"];
                                              delete newData["_scrape_cached_ts"];
                                              delete newData["_batch_scrape_md"];
                                              delete newData["_batch_impressum_md"];
                                            }
                                            await fetch(`/api/rows/${row.id}`, {
                                              method: "PATCH",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ data: newData }),
                                            });
                                            setRows(prev => prev.map(r => r.id === row.id ? { ...r, data: newData } : r));
                                          }}
                                          title="Wert löschen"
                                          style={{border:"none",background:"none",cursor:"pointer",padding:"0 2px",fontSize:11,color:"#d1d5db",flexShrink:0,lineHeight:1}}
                                          onMouseEnter={e => (e.currentTarget.style.color = "#dc2626")}
                                          onMouseLeave={e => (e.currentTarget.style.color = "#d1d5db")}
                                        >✕</button>
                                      )}
                                    </div>
                                  : <span style={textStyle} title={isFallback?`Firmen-E-Mail (Fallback): ${displayVal}`:displayVal}>{content}{isFallback && <span style={{fontSize:9,marginLeft:3,color:"#d1d5db"}}>🏢</span>}</span>;
                              })()}
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
          <div style={{background:"var(--surface)",borderTop:"1px solid var(--border)",padding:"6px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,fontSize:11.5,color:"var(--text-2)"}}>
            <span style={{display:"flex",alignItems:"center",gap:6}}>
              Page Size:
              <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}}
                style={{fontSize:11.5,border:"1px solid var(--border)",borderRadius:"var(--rs)",padding:"2px 6px",background:"var(--bg)",color:"var(--text-1)"}}>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </span>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
                className="btn-v2 btn-v2-ghost" style={{padding:"2px 8px",fontSize:11,opacity:page===0?.4:1}}>‹</button>
              <span style={{fontFamily:"monospace",fontSize:11,color:"var(--text-2)"}}>
                {dataRows.length>0?`${page*pageSize+1} bis ${Math.min((page+1)*pageSize,dataRows.length)} von ${dataRows.length}`:"-"}
              </span>
              <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
                className="btn-v2 btn-v2-ghost" style={{padding:"2px 8px",fontSize:11,opacity:page>=totalPages-1?.4:1}}>›</button>
              <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1}
                className="btn-v2 btn-v2-ghost" style={{padding:"2px 8px",fontSize:11,opacity:page>=totalPages-1?.4:1}}>»</button>
            </div>
            <span>Seite {page+1} von {totalPages}</span>
          </div>

        </>)} {/* end flat view */}
        </>)} {/* end activeTab === Tabelle */}

        {/* ══ TAB: SUCHEN — Agent-Runs History ══ */}
        {activeTab === "Suchen" && (
          <AgentRunsTab
            caseId={caseId}
            onOpenModal={() => { setAppendTab("autopilot"); setShowAppend(true); }}
            onNewSearch={() => { agentHook.reset(); setAppendTab("autopilot"); setShowAppend(true); }}
            onReloadAndOpen={async (runId) => { await agentHook.reload(runId); setAppendTab("autopilot"); setShowAppend(true); }}
            onReloadRun={(runId) => { agentHook.reload(runId); }}
            activeRunId={agentHook.run?.id ?? null}
            activeRunStatus={agentHook.run?.status ?? null}
            activeRunUniqueCount={agentHook.run?.uniqueCount ?? 0}
            activeRunning={agentHook.running}
          />
        )}

        {/* ══ TAB: QUELLEN — Plan/Queries + Katalogseiten ══ */}
        {activeTab === "Quellen" && (
          <div style={{flex:1,overflowY:"auto",background:"#f8fafc",padding:"16px",display:"flex",flexDirection:"column",gap:16}}>

            {/* ── Katalogseiten (Rohmaterial zum Scrapen) ── */}
            {catalogRows.length > 0 && (
              <div style={{background:"#fff",borderRadius:10,border:"1px solid #fbbf24",overflow:"hidden"}}>
                <div style={{padding:"12px 16px",background:"#fffbeb",borderBottom:"1px solid #fde68a",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:18}}>📚</span>
                    <div>
                      <div style={{fontWeight:700,fontSize:13,color:"#92400e"}}>{catalogRows.length} Katalogseiten</div>
                      <div style={{fontSize:11,color:"#a16207"}}>Keine echten Leads — Rohmaterial zum Scrapen und Extrahieren</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <ReflagCatalogsButton caseId={caseId} onDone={refresh} />
                    <CatalogDeepCrawlButton caseId={caseId} onDone={refresh} catalogCount={catalogRows.length} />
                  </div>
                </div>
                <div style={{padding:"8px 12px",maxHeight:300,overflowY:"auto"}}>
                  <div style={{display:"grid",gap:4}}>
                    {catalogRows.map((row, i) => {
                      const toggleCatalog = async () => {
                        const newData = { ...row.data };
                        delete newData.is_catalog; // remove flag = promote to data row
                        await fetch(`/api/rows/${row.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ data: newData }),
                        });
                        refresh();
                      };
                      return (
                      <div key={row.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 8px",borderRadius:6,background:i%2===0?"#fafafa":"#fff",fontSize:12}}>
                        <span style={{color:"#9ca3af",fontSize:10,minWidth:20}}>{i+1}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {row.data["source_title"] || row.data["company_name"] || row.data["source_url"]}
                          </div>
                          <div style={{fontSize:10,color:"#9ca3af",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {row.data["source_url"]} · {row.data["search_source"]}
                          </div>
                        </div>
                        <button onClick={toggleCatalog} title="Als Lead übernehmen — in Tabelle verschieben"
                          style={{border:"1px solid #d1d5db",borderRadius:5,background:"#fff",cursor:"pointer",padding:"2px 8px",fontSize:11,color:"#374151",whiteSpace:"nowrap"}}>
                          ✅ Als Lead
                        </button>
                        <CatalogScrapeButton url={row.data["source_url"] ?? ""} caseId={caseId} onScraped={refresh} />
                      </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Discovery-Plan & Query-Log ── */}
            {(() => {
              const planLogs = logs.filter(l =>
                l.message.startsWith("🔍 DISCOVERY PLAN") ||
                l.message.startsWith("✅ Step") ||
                l.message.startsWith("🏁 DISCOVERY") ||
                l.message.startsWith("  🔍") ||
                l.message.startsWith("🔗 DEEP CRAWL") ||
                l.message.startsWith("  📋")
              );
              const planStarts = logs.filter(l => l.message.startsWith("🔍 DISCOVERY PLAN:"));

              if (planLogs.length === 0 && catalogRows.length === 0) return (
                <div style={{textAlign:"center",padding:"48px 0"}}>
                  <div style={{fontSize:48,marginBottom:12}}>🔍</div>
                  <div style={{fontSize:15,fontWeight:600,color:"#1e293b",marginBottom:6}}>Noch keine Quellen vorhanden</div>
                  <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>Starte eine Discovery-Suche um Queries und Katalogseiten zu sammeln.</div>
                  <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                    <button onClick={() => setShowAppend(true)}
                      style={{padding:"8px 20px",border:"1px solid #86efac",borderRadius:7,background:"#f0fdf4",cursor:"pointer",color:"#166534",fontWeight:600,fontSize:13}}>
                      🔍 Suche starten
                    </button>
                    <ReflagCatalogsButton caseId={caseId} onDone={refresh} />
                  </div>
                </div>
              );

              if (planLogs.length === 0) return null;

              // Group logs by plan run
              const runs: Array<{plan: typeof logs[0]; queries: typeof logs; steps: typeof logs; done: typeof logs[0]|null}> = [];
              let currentRun: typeof runs[0] | null = null;

              for (const l of planLogs) {
                if (l.message.startsWith("🔍 DISCOVERY PLAN")) {
                  currentRun = { plan: l, queries: [], steps: [], done: null };
                  runs.push(currentRun);
                } else if (currentRun) {
                  if (l.message.startsWith("🏁")) currentRun.done = l;
                  else if (l.message.startsWith("✅ Step")) currentRun.steps.push(l);
                  else if (l.message.startsWith("  🔍")) currentRun.queries.push(l);
                }
              }

              return (
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em"}}>
                      {planStarts.length} Discovery-Läufe · {planLogs.length} Log-Einträge
                    </div>
                    <button onClick={() => setShowAppend(true)}
                      style={{fontSize:11,padding:"4px 12px",border:"1px solid #86efac",borderRadius:6,background:"#f0fdf4",cursor:"pointer",color:"#166534",fontWeight:600}}>
                      + Neue Suche
                    </button>
                  </div>

                  {runs.reverse().map((run, ri) => {
                    const planMsg = run.plan.message.replace("🔍 DISCOVERY PLAN: ", "");
                    const totalFound = run.queries.reduce((s, q) => {
                      const m = q.message.match(/→ (\d+) neu/);
                      return s + (m ? parseInt(m[1]) : 0);
                    }, 0);
                    const isDone = !!run.done;

                    return (
                      <div key={ri} style={{background:"#fff",borderRadius:10,border:"1px solid #e2e8f0",overflow:"hidden"}}>
                        <div style={{padding:"12px 16px",background:isDone?"#f0fdf4":"#eff6ff",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"flex-start",gap:10}}>
                          <span style={{fontSize:18}}>{isDone?"✅":"⏳"}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:700,fontSize:13,color:"#1e293b",marginBottom:2}}>{planMsg}</div>
                            <div style={{fontSize:11,color:"#64748b",display:"flex",gap:12,flexWrap:"wrap"}}>
                              <span>🕐 {new Date(run.plan.createdAt).toLocaleString("de-DE")}</span>
                              <span>📊 {run.queries.length} Queries</span>
                              {totalFound > 0 && <span style={{color:"#15803d",fontWeight:600}}>✓ {totalFound} neue Einträge</span>}
                            </div>
                          </div>
                        </div>

                        {run.steps.length > 0 && (
                          <div style={{padding:"8px 16px",borderBottom:"1px solid #f1f5f9",background:"#fafafa",display:"flex",flexWrap:"wrap",gap:6}}>
                            {run.steps.map((s, si) => {
                              const m = s.message.match(/Step \d+\/\d+: "([^"]+)" → (\d+) neue/);
                              const added = m ? parseInt(m[2]) : 0;
                              return (
                                <span key={si} style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:added>0?"#dcfce7":"#f3f4f6",color:added>0?"#15803d":"#6b7280",fontWeight:added>0?600:400}}>
                                  {m?.[1]?.slice(0,30) ?? s.message.slice(0,30)} · {added>0?`+${added}`:0}
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {run.queries.length > 0 && (
                          <div style={{padding:"8px 16px",maxHeight:200,overflowY:"auto"}}>
                            <div style={{fontSize:10,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>
                              Alle {run.queries.length} Queries
                            </div>
                            <div style={{display:"grid",gap:2}}>
                              {run.queries.map((q, qi) => {
                                const m = q.message.match(/Query: "([^"]+)" → (\d+)/);
                                const found = m ? parseInt(m[2]) : 0;
                                return (
                                  <div key={qi} style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
                                    <span style={{color:found>0?"#15803d":"#9ca3af",fontWeight:found>0?600:400,minWidth:30,textAlign:"right"}}>{found>0?`+${found}`:"0"}</span>
                                    <span style={{color:"#374151",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m?.[1] ?? q.message}</span>
                                    <span style={{fontSize:10,color:"#94a3b8",fontFamily:"monospace"}}>{new Date(q.createdAt).toLocaleTimeString("de-DE")}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

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
              : logs.map(l => {
                const isDisc = l.message.startsWith("🔍") || l.message.startsWith("✅") || l.message.startsWith("🏁");
                return (
                  <div key={l.id} style={{lineHeight:1.6,padding:"1px 4px",borderRadius:3,color: isDisc ? "#38bdf8" : "#94a3b8"}}>
                    <span style={{color:"#475569",marginRight:10,userSelect:"none"}}>{new Date(l.createdAt).toLocaleTimeString("de-DE")}</span>
                    {l.message}
                  </div>
                );
              })}
          </div>
        )}

        {/* ══ TAB: KONTAKTE ══ */}
        {activeTab === "Kontakte" && (
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg)"}}>
            {/* Header bar */}
            <div style={{padding:"10px 24px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:10,flexShrink:0,background:"var(--surface)"}}>
              <span style={{fontWeight:600,fontSize:14,color:"var(--text-1)"}}>👤 Kontakte</span>
              {contactRowsLoaded && (
                <span style={{fontSize:12,color:"var(--text-3)"}}>{contactRowsData.length} Einträge</span>
              )}
              <div style={{marginLeft:"auto",display:"flex",gap:8}}>
                <button
                  onClick={async () => {
                    if (!confirm("Kontakte aus Firmen-Zeilen extrahieren und Firmen-Zeilen bereinigen (alle Kontakt-Felder entfernen)?")) return;
                    setContactCleanupRunning(true);
                    setContactCleanupResult(null);
                    try {
                      const res = await fetch("/api/contact-rows/cleanup", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ caseId }) });
                      const d = await res.json();
                      setContactCleanupResult(d);
                      const cr = await fetch(`/api/contact-rows?caseId=${caseId}`).then(r=>r.json());
                      setContactRowsData((cr.contacts ?? []).map((c:{data:Record<string,string|null>})=>c.data));
                    } finally { setContactCleanupRunning(false); }
                  }}
                  disabled={contactCleanupRunning}
                  className="btn-v2"
                  style={{color:"var(--warn)",background:"var(--warn-soft)",borderColor:"var(--warn)"}}>
                  {contactCleanupRunning ? <><Loader2 style={{width:10,height:10}} className="animate-spin"/> Läuft…</> : "⚡ Extrahieren & bereinigen"}
                </button>
                <button
                  onClick={() => { setContactRowsLoaded(false); setContactRowsLoading(true); fetch(`/api/contact-rows?caseId=${caseId}`).then(r=>r.json()).then(d=>{setContactRowsData((d.contacts??[]).map((c:{data:Record<string,string|null>})=>c.data));setContactRowsLoaded(true);}).finally(()=>setContactRowsLoading(false)); }}
                  className="btn-v2">
                  🔄 Aktualisieren
                </button>
                <a href={`/api/export?caseId=${caseId}&type=contacts`}
                  className="btn-v2 btn-v2-primary"
                  style={{textDecoration:"none"}}>
                  ⬇ CSV
                </a>
              </div>
            </div>

            {contactCleanupResult && (
              <div style={{padding:"8px 24px",background:"var(--green-soft)",borderBottom:"1px solid var(--green-mid)",fontSize:12,color:"var(--green)",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                ✅ <strong>{contactCleanupResult.inserted} neue</strong> Kontakte eingefügt · <strong>{contactCleanupResult.updated}</strong> aktualisiert · <strong>{contactCleanupResult.rowsCleaned}</strong> Firmen-Zeilen bereinigt
                <button onClick={()=>setContactCleanupResult(null)} style={{marginLeft:"auto",border:"none",background:"none",cursor:"pointer",color:"var(--green)",fontSize:14}}>×</button>
              </div>
            )}

            {contactRowsLoading && (
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:"var(--text-3)"}}>
                <Loader2 style={{width:16,height:16}} className="animate-spin"/> Lade Kontakte…
              </div>
            )}

            {!contactRowsLoading && contactRowsLoaded && contactRowsData.length === 0 && (
              <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,color:"var(--text-3)"}}>
                <span style={{fontSize:32}}>👤</span>
                <div style={{fontWeight:600,fontSize:14,color:"var(--text-2)"}}>Noch keine Kontakte</div>
                <div style={{fontSize:12,color:"var(--text-3)",textAlign:"center",maxWidth:340}}>
                  Kontakte werden automatisch hier gespeichert, wenn du eine <strong>Entscheider</strong>-Spalte ausführst.
                </div>
              </div>
            )}

            {!contactRowsLoading && contactRowsData.length > 0 && (() => {
              const CONTACT_COLS = ["company_name","first_name","last_name","position","email","email_extrapolated","phone","linkedin","domain","city","source"];
              const extraCols = contactRowsData.length > 0
                ? [...new Set(contactRowsData.flatMap(d => Object.keys(d)).filter(k => !k.startsWith("_") && !CONTACT_COLS.includes(k)))]
                : [];
              const allCols = [...CONTACT_COLS, ...extraCols].filter(k =>
                contactRowsData.some(d => d[k] != null && d[k] !== "")
              );
              const COL_LABEL: Record<string,string> = {
                company_name:"Firma", first_name:"Vorname", last_name:"Nachname",
                position:"Position", email:"E-Mail", email_extrapolated:"E-Mail (extrapoliert)",
                phone:"Telefon", linkedin:"LinkedIn", domain:"Domain", city:"Stadt", source:"Quelle",
              };
              return (
                <div style={{flex:1,overflow:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,background:"var(--surface)"}}>
                    <thead>
                      <tr style={{background:"var(--surface)",position:"sticky",top:0,zIndex:10}}>
                        <th style={{padding:"0 11px",height:34,borderBottom:"1px solid var(--border)",textAlign:"left",fontWeight:600,color:"var(--text-3)",whiteSpace:"nowrap",width:34,fontSize:10.5,textTransform:"uppercase"}}>#</th>
                        {allCols.map(k => (
                          <th key={k} style={{padding:"0 11px",height:34,borderBottom:"1px solid var(--border)",textAlign:"left",fontWeight:600,color: ["first_name","last_name","position"].includes(k) ? "var(--green)" : "var(--text-3)",whiteSpace:"nowrap",fontSize:10.5,textTransform:"uppercase",background: ["first_name","last_name","position"].includes(k) ? "var(--green-soft)" : "var(--surface)"}}>
                            {COL_LABEL[k] ?? k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contactRowsData.map((row, i) => (
                        <tr key={i} style={{borderBottom:"1px solid var(--border-xs)",height:42}}
                          onMouseEnter={e=>(e.currentTarget.style.background="#faf9f7")}
                          onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                          <td style={{padding:"0 11px",color:"var(--text-3)",fontFamily:"monospace",fontSize:11}}>{i+1}</td>
                          {allCols.map(k => {
                            const v = row[k];
                            const isEmpty = !v || v === "";
                            const isEmail = k === "email" && !isEmpty;
                            const isExtrapolated = k === "email_extrapolated" && !isEmpty;
                            const isLinkedIn = k === "linkedin" && !isEmpty;
                            return (
                              <td key={k} style={{padding:"0 11px",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {isEmpty ? <span style={{color:"var(--text-3)"}}>—</span>
                                  : isEmail ? <a href={`mailto:${v}`} style={{color:"var(--orange)",textDecoration:"none"}} title={v!}>{v}</a>
                                  : isExtrapolated ? <span style={{color:"var(--green)",fontWeight:500}} title={v!}>⚡ {v}</span>
                                  : isLinkedIn ? <a href={v!.startsWith("http")?v!:`https://${v}`} target="_blank" rel="noreferrer" style={{color:"#0a66c2",textDecoration:"none"}} title={v!}>🔗 LinkedIn</a>
                                  : <span title={v!}>{v}</span>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══ TAB: EXPORT ══ */}
        {activeTab === "Export" && (
          <div style={{flex:1,padding:24,display:"flex",flexDirection:"column",gap:16,background:"var(--bg)",overflowY:"auto"}}>

            {/* CSV export */}
            <div style={{maxWidth:480,background:"var(--surface)",borderRadius:"var(--r)",border:"1px solid var(--border)",boxShadow:"var(--shadow-sm)",padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:"var(--text-1)",marginBottom:4}}>📊 CSV exportieren</div>
              <div style={{fontSize:12,color:"var(--text-2)",marginBottom:14}}>{rows.length} Zeilen · {sourceColumns.length + (caseData?.aiColumns ?? []).length} Spalten — wähle Export-Modus und Spalten aus.</div>
              <button onClick={() => setShowExport(true)} className="btn-v2 btn-v2-primary">
                <Download style={{width:14,height:14}} /> CSV exportieren
              </button>
            </div>

            {/* Full snapshot export */}
            <div style={{maxWidth:480,background:"var(--surface)",borderRadius:"var(--r)",border:"1px solid var(--border)",boxShadow:"var(--shadow-sm)",padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:"var(--text-1)",marginBottom:4}}>💾 Vollständiger Snapshot</div>
              <div style={{fontSize:12,color:"var(--text-2)",marginBottom:14}}>Exportiert alle Zeilen und Konfiguration als JSON zum Backup oder Transfer.</div>
              <a href={`/api/export/snapshot?caseId=${caseId}`} className="btn-v2" style={{textDecoration:"none",color:"var(--text-1)"}}>
                <Download style={{width:14,height:14}} /> Snapshot herunterladen (.json)
              </a>
            </div>

            {/* Snapshot import/restore */}
            <div style={{maxWidth:480,background:"var(--surface)",borderRadius:"var(--r)",border:"1px solid var(--border)",boxShadow:"var(--shadow-sm)",padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:"var(--text-1)",marginBottom:4}}>📥 Snapshot wiederherstellen</div>
              <div style={{fontSize:12,color:"var(--text-2)",marginBottom:12}}>Lade eine Snapshot-JSON hoch um einen neuen Case wiederherzustellen.</div>
              <label className="btn-v2 btn-v2-primary" style={{cursor:"pointer",display:"inline-flex"}}>
                <Upload style={{width:14,height:14}} /> Snapshot importieren
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

        </div> {/* end Table Workspace Container */}
      </div>   {/* end MAIN */}

      {/* ── Run Confirmation Modal ── */}
      {runConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={() => setRunConfirm(null)}>
          <div style={{background:"#fff",borderRadius:12,padding:"28px 32px",maxWidth:420,width:"90%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}
            onClick={e => e.stopPropagation()}>
            {/* Icon + Title */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
              <div style={{width:40,height:40,background:runConfirm.mode==="all_force"?"#fef3c7":"#ede9fe",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>
                {runConfirm.mode==="all_force" ? "⚡" : "◐"}
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:15,color:"#111"}}>
                  {runConfirm.mode==="all_force" ? "Alle Zellen ausführen?" : "Nur leere Zellen füllen?"}
                </div>
                <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>
                  {selectedRows.size > 0 ? `${selectedRows.size} ausgewählte Zeilen` : `${rows.length} Zeilen`}
                  {selectedRows.size > 0 && (
                    <button
                      onClick={() => setSelectedRows(new Set())}
                      style={{marginLeft:8,padding:"1px 7px",fontSize:11,border:"1px solid #d1d5db",borderRadius:4,background:"#f9fafb",cursor:"pointer",color:"#6b7280"}}>
                      ✕ Auswahl aufheben
                    </button>
                  )}
                  {sortBy && (
                    <span style={{marginLeft:8,fontSize:11,color:"#7c3aed"}}>
                      {sortDir === "asc" ? "↑" : "↓"} {sortBy === "company_name" ? "Firma" : "Domain"}
                      <button onClick={() => setSortBy(null)}
                        style={{marginLeft:4,border:"none",background:"none",cursor:"pointer",color:"#9ca3af",padding:0,fontSize:11}}>
                        ✕
                      </button>
                    </span>
                  )}
                  {" · "}{caseData?.aiColumns?.length ?? 0} KI-Spalten
                </div>
              </div>
            </div>

            {/* Warning for overwrite mode */}
            {runConfirm.mode === "all_force" && (() => {
              const filledCount = rows.filter(r => caseData?.aiColumns?.some(c => r.data[c.outputKey] && r.data[c.outputKey] !== "")).length;
              return filledCount > 0 ? (
                <div style={{background:"#fef9c3",border:"1px solid #fde68a",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#92400e",marginBottom:16}}>
                  ⚠ <strong>{filledCount} Zeilen</strong> haben bereits Werte — diese werden überschrieben.
                </div>
              ) : null;
            })()}

            {runConfirm.mode === "empty_only" && (
              <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#166534",marginBottom:16}}>
                ✓ Bereits befüllte Zellen bleiben unberührt.
              </div>
            )}

            {/* Estimated cost */}
            <div style={{fontSize:11,color:"#9ca3af",marginBottom:20}}>
              Parallelität: {concurrency}x · Schätzung: {Math.ceil((selectedRows.size > 0 ? selectedRows.size : rows.length) / concurrency)} Batches
            </div>

            {/* Actions */}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={() => setRunConfirm(null)}
                style={{padding:"8px 18px",border:"1px solid #d1d5db",borderRadius:7,background:"#fff",cursor:"pointer",fontSize:13,color:"#374151",fontWeight:500}}>
                Abbrechen
              </button>
              <button onClick={() => { const m = runConfirm.mode; setRunConfirm(null); runSelectedRows(m); }}
                style={{padding:"8px 20px",border:"none",borderRadius:7,background:runConfirm.mode==="all_force"?"#7c3aed":"#059669",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                {runConfirm.mode==="all_force" ? "⚡ Alle ausführen" : "◐ Nur Leere füllen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCol && <AddColumnModal caseId={caseId} onClose={()=>setShowAddCol(false)} onAdded={(u:Case)=>{
        setCaseData(u);
        setColOrder(prev => {
          const existing = new Set(prev);
          const newKeys = u.aiColumns.map((c:AiColumn)=>c.outputKey).filter((k:string)=>!existing.has(k));
          return newKeys.length > 0 ? [...prev, ...newKeys] : prev;
        });
        setShowAddCol(false);
      }}
        availableFields={[...sourceColumns, ...(caseData?.aiColumns ?? []).map(c=>c.outputKey)]} />}
      {showAppend && (
        <AppendModal
          caseId={caseId}
          initialTab={appendTab}
          rowsCount={rows.length}
          externalRun={agentHook.run}
          externalRunning={agentHook.running}
          externalStart={agentHook.start}
          externalStep={agentHook.step}
          externalCancel={agentHook.cancel}
          externalReload={agentHook.reload}
          onRowsAdded={(n)=>{if(n>0)refresh();}}
          onClose={()=>setShowAppend(false)}
        />
      )}
      {showExport && <ExportModal caseId={caseId} caseData={caseData} sourceColumns={sourceColumns} colOrder={colOrder} onClose={()=>setShowExport(false)} />}
      {showImport && <ImportModal caseId={caseId} onImported={()=>{setShowImport(false);refresh();}} onClose={()=>setShowImport(false)} />}
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
            ...(caseData?.aiColumns ?? []).filter(c => c.id !== (editingPromptCell?.col.id ?? editingPromptCol?.id)).map(c => c.outputKey),
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
      {cacheModalRow && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,padding:16}}
          onClick={() => setCacheModalRow(null)}>
          <div style={{background:"#fff",borderRadius:12,width:"100%",maxWidth:800,maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}
            onClick={e => e.stopPropagation()}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <h3 style={{fontSize:16,fontWeight:700,color:"#111827",margin:0,display:"flex",alignItems:"center",gap:6}}>
                  ⚡ Gecachte Scrape-Daten für {cacheModalRow.data["company_name"] || cacheModalRow.data["domain"] || "Zeile"}
                </h3>
                <div style={{fontSize:11.5,color:"#6b7280",marginTop:2}}>
                  Domain: <code style={{background:"#f3f4f6",padding:"1px 6px",borderRadius:4,fontFamily:"monospace"}}>{cacheModalRow.data["domain"] || "keine Domain"}</code> · Kosten dieser Daten: $0,00 (aus PostgreSQL scrape_cache)
                </div>
              </div>
              <button onClick={() => setCacheModalRow(null)} style={{border:"none",background:"none",cursor:"pointer",padding:4,color:"#9ca3af",borderRadius:6}}>
                <XCircle style={{width:20,height:20}} />
              </button>
            </div>

            <div style={{flex:1,overflowY:"auto",padding:20,display:"flex",flexDirection:"column",gap:16}}>
              {cacheModalLoading ? (
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:40,gap:8,color:"#6b7280"}}>
                  <Loader2 className="animate-spin" style={{width:18,height:18,color:"#15803d"}} /> Lade Cache-Einträge…
                </div>
              ) : cacheModalEntries.length === 0 ? (
                <div style={{padding:24,background:"#f9fafb",borderRadius:8,textAlign:"center",color:"#6b7280",fontSize:13}}>
                  Kein direkter PostgreSQL-Cache-Eintrag für diese Domain gefunden.
                  {cacheModalRow.data["_batch_scrape_md"] && (
                    <div style={{marginTop:12,textAlign:"left"}}>
                      <div style={{fontWeight:600,color:"#374151",marginBottom:4}}>In dieser Zeile gespeicherter Homepage-Scrape:</div>
                      <pre style={{fontSize:11,background:"#fff",border:"1px solid #e5e7eb",padding:10,borderRadius:6,maxHeight:240,overflow:"auto",whiteSpace:"pre-wrap"}}>
                        {cacheModalRow.data["_batch_scrape_md"]}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                cacheModalEntries.map((entry, idx) => (
                  <div key={idx} style={{border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden"}}>
                    <div style={{padding:"10px 14px",background:"#f8fafc",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontWeight:600,fontSize:12.5,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          🔗 {entry.url}
                        </div>
                        <div style={{fontSize:10.5,color:"#64748b",marginTop:1}}>
                          {entry.title ? `Titel: "${entry.title}" · ` : ""}Größe: {Math.round(entry.length / 1024 * 10) / 10} KB · Gecached am: {new Date(entry.fetchedAt).toLocaleString("de-DE")}
                        </div>
                      </div>
                      <span style={{fontSize:11,fontWeight:600,color:"#15803d",background:"#dcfce7",border:"1px solid #bbf7d0",padding:"1px 7px",borderRadius:99}}>
                        ⚡ $0 Re-use
                      </span>
                    </div>
                    <div style={{maxHeight:240,overflowY:"auto",padding:12,background:"#fff",fontSize:11.5,lineHeight:1.6,color:"#334155",fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                      {entry.markdown}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
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
    <StickyTableStyles />
    </CaseContext.Provider>
  ) : (
    <div style={{display:"flex",height:"100vh",alignItems:"center",justifyContent:"center"}}>
      <Loader2 className="animate-spin" style={{width:24,height:24,color:"#7c3aed"}} />
    </div>
  )}
  </ErrorBoundary>
);
}

function StickyTableStyles() {
  return (
    <style jsx global>{`
      .case-detail-table thead th {
        background-color: #f9fafb !important;
      }
    `}</style>
  );
}
