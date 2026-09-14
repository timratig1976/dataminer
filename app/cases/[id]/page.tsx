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
import { ImportModal } from "@/components/ImportModal";
import { DiscoveryModal } from "@/components/DiscoveryModal";
import { AgentGoalModal } from "@/components/AgentGoalModal";
import AppendModal from "@/components/AppendModal";
import { ColumnHeaderMenu } from "@/components/ColumnHeaderMenu";
import GroupedTableView from "@/components/GroupedTableView";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";
import RunDetailModal from "@/components/case/RunDetailModal";
import EditPromptModal from "@/components/case/EditPromptModal";
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
};

function colLabel(key: string): string {
  return COL_LABELS[key] ?? key;
}


// ── Inline Settings Panel ─────────────────────────────────────────────────────
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
    await saveCols(caseData.aiColumns.map(c => c.id === editingCol.id ? editingCol : c));
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
    await saveCols([...caseData.aiColumns, col]);
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
          <div style={{fontSize:15,fontWeight:700,color:"#111"}}>✨ KI-Spalten ({caseData.aiColumns.length})</div>
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

        {caseData.aiColumns.length === 0 && !addingCol && (
          <div style={{textAlign:"center",padding:"32px 0",color:"#9ca3af",fontSize:13}}>
            Noch keine KI-Spalten. Klicke auf "Neue KI-Spalte" um zu starten.
          </div>
        )}

        <div style={{display:"grid",gap:8}}>
          {caseData.aiColumns.map(col => (
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
  } = useCaseData(caseId);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showAddCol, setShowAddCol] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [showAgentGoal, setShowAgentGoal] = useState(false);
  const [showAppend, setShowAppend] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowId: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<{ id: number; message: string; createdAt: string }[]>([]);
  const [activeTab, setActiveTab] = useState<"Tabelle" | "Quellen" | "Log" | "Export">("Tabelle");
  const [showUpload, setShowUpload] = useState(false);
  const [showPromptCols, setShowPromptCols] = useState(false);
  const [rangeVon, setRangeVon] = useState(1);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [editingPromptCol, setEditingPromptCol] = useState<AiColumn | null>(null);
  const [editingPromptCell, setEditingPromptCell] = useState<{col: AiColumn; row: RowData} | null>(null);
  const [runDetailCell, setRunDetailCell] = useState<{col: AiColumn; row: RowData} | null>(null);
  const [reasoningModal, setReasoningModal] = useState<{content: string; title: string} | null>(null);
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [showRunOptions, setShowRunOptions] = useState(false);
  const [runConfirm, setRunConfirm] = useState<{mode: "all_force" | "empty_only"} | null>(null);

  // Auto-detect grouped view
  const hasColumnGroups = caseData?.aiColumns?.some(c => c.columnGroup);
  // Only show Firmen/Kontakte run-phase buttons for NON-batch columns with explicit groups
  const hasPhaseColumns = caseData?.aiColumns?.some(c => c.columnGroup && !c.tool);
  useEffect(() => {
    if (hasColumnGroups && viewMode === "flat") setViewMode("grouped");
  }, [hasColumnGroups]);

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
    if (showLogs || activeTab === "Log" || activeTab === "Quellen") fetchLogs();
  }, [showLogs, activeTab]);

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

  // Split catalog rows (raw source material) from real data rows
  const catalogRows = rows.filter(r => r.data["is_catalog"] === "true");
  const dataRows = rows.filter(r => r.data["is_catalog"] !== "true");

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

  const tabs = ["Tabelle","Quellen","Log","Export"] as const;

  function tabIcon(t: string): string {
    switch (t) {
      case "Tabelle": return "📋 ";
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

  return (
    <ErrorBoundary>
    {caseContextValue ? (
      <CaseContext.Provider value={caseContextValue}>
    <div style={{display:"flex",height:"100vh",background:"#f9fafb",overflow:"hidden",fontSize:14,color:"#1f2937"}}>

      {/* ════ SIDEBAR ════ */}
      <div style={{width:220,background:"#fff",borderRight:"1px solid #e5e7eb",display:"flex",flexDirection:"column",flexShrink:0}}>
        {/* Logo row */}
        <div style={{padding:"12px 16px",borderBottom:"1px solid #f3f4f6"}}>
          <button onClick={() => router.push("/dashboard")}
            style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",padding:0,width:"100%",textAlign:"left"}}
            onMouseEnter={e=>(e.currentTarget.style.opacity="0.75")}
            onMouseLeave={e=>(e.currentTarget.style.opacity="1")}>
            <div style={{width:24,height:24,background:"#7c3aed",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:12,fontWeight:700,flexShrink:0}}>D</div>
            <span style={{fontWeight:600,fontSize:14,color:"#111827"}}>DataMiner</span>
          </button>
        </div>
        {/* New case */}
        <div style={{padding:"8px 12px",borderBottom:"1px solid #f3f4f6"}}>
          <button onClick={() => router.push("/cases")}
            style={{width:"100%",display:"flex",alignItems:"center",gap:6,padding:"6px 8px",borderRadius:6,border:"none",background:"none",cursor:"pointer",fontSize:13,color:"#4b5563",textAlign:"left"}}
            onMouseEnter={e=>(e.currentTarget.style.background="#f5f3ff",e.currentTarget.style.color="#7c3aed")}
            onMouseLeave={e=>(e.currentTarget.style.background="none",e.currentTarget.style.color="#4b5563")}>
            <Plus style={{width:14,height:14}} /> Neuer Case
          </button>
        </div>
        {/* Case item — active */}
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{margin:"8px 12px",borderRadius:8,background:"#f5f3ff",color:"#111827",padding:"10px 14px",cursor:"pointer",borderLeft:"3px solid #7c3aed"}}>
            <div style={{fontWeight:600,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>📁 {caseData.name}</div>
<div style={{fontSize:11,color:"#6b7280",marginTop:2}}>{dataRows.length} Zeilen{catalogRows.length > 0 ? ` · ${catalogRows.length} Kataloge` : ""} · {new Date(caseData.updatedAt).toLocaleDateString("de-DE")}</div>
          </div>
        </div>
        {/* Bottom icons */}
        <div style={{padding:"10px 12px",borderTop:"1px solid #f3f4f6",display:"flex",alignItems:"center",gap:4}}>
          <button title="API & Region" onClick={() => router.push("/settings")}
            style={{padding:6,borderRadius:6,border:"none",background:"none",cursor:"pointer",color:"#9ca3af",display:"flex",alignItems:"center"}}
            onMouseEnter={e=>(e.currentTarget.style.color="#7c3aed",e.currentTarget.style.background="#f5f3ff")}
            onMouseLeave={e=>(e.currentTarget.style.color="#9ca3af",e.currentTarget.style.background="none")}>
            <Settings style={{width:15,height:15}} />
          </button>
          <button title="Modell-Auswahl" onClick={() => router.push("/settings/models")}
            style={{padding:6,borderRadius:6,border:"none",background:"none",cursor:"pointer",color:"#9ca3af",display:"flex",alignItems:"center"}}
            onMouseEnter={e=>(e.currentTarget.style.color="#7c3aed",e.currentTarget.style.background="#f5f3ff")}
            onMouseLeave={e=>(e.currentTarget.style.color="#9ca3af",e.currentTarget.style.background="none")}>
            <Sliders style={{width:15,height:15}} />
          </button>
        </div>
      </div>

      {/* ════ MAIN ════ */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* ── Case header ── */}
        <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",padding:"16px 28px 0",flexShrink:0}}>
          <div style={{marginBottom:6}}>
            <div style={{fontSize:16,fontWeight:700,color:"#111"}}>
              <InlineCaseName name={caseData.name} onSave={async (newName) => {
                const updated = await updateCase({ name: newName });
                setCaseData(updated);
              }} />
            </div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:2,display:"flex",alignItems:"center",gap:8}}>
              <span>{new Date(caseData.createdAt).toLocaleDateString("de-DE")} · {dataRows.length} Zeilen{catalogRows.length > 0 ? ` + ${catalogRows.length} Kataloge` : ""} · {sourceColumns.length} Quellspalten · {caseData.aiColumns.length} KI-Spalten</span>
              <CostDashboard totals={totals} rowCount={rows.length} colCount={caseData.aiColumns.length} />
            </div>
          </div>
          {/* Tabs */}
          <div style={{display:"flex",gap:0,marginTop:4,alignItems:"center"}}>
            {tabs.map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{padding:"6px 16px",border:"none",borderBottom: activeTab===t ? "2px solid #6d28d9" : "2px solid transparent",background:"none",cursor:"pointer",fontSize:13,fontWeight:500,color: activeTab===t ? "#6d28d9" : "#6b7280",marginBottom:-1}}>
                {tabIcon(t)}{t}
              </button>
            ))}
            {/* View mode toggle — only visible in Tabelle tab when columnGroups exist */}
            {activeTab === "Tabelle" && hasColumnGroups && (
              <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:11,color:"#9ca3af"}}>Ansicht:</span>
                <button
                  onClick={() => setViewMode("flat")}
                  style={{fontSize:11,padding:"2px 8px",borderRadius:4,border:"1px solid",cursor:"pointer",
                    borderColor: viewMode==="flat" ? "#7c3aed" : "#d1d5db",
                    background: viewMode==="flat" ? "#f5f3ff" : "#fff",
                    color: viewMode==="flat" ? "#7c3aed" : "#6b7280"}}
                >📋 Flach</button>
                <button
                  onClick={() => setViewMode("grouped")}
                  style={{fontSize:11,padding:"2px 8px",borderRadius:4,border:"1px solid",cursor:"pointer",
                    borderColor: viewMode==="grouped" ? "#7c3aed" : "#d1d5db",
                    background: viewMode==="grouped" ? "#f5f3ff" : "#fff",
                    color: viewMode==="grouped" ? "#7c3aed" : "#6b7280"}}
                >📂 Gruppiert</button>
              </div>
            )}
          </div>
        </div>

        {/* ══ TAB: TABELLE — shared toolbar + conditional content ══ */}
        {activeTab === "Tabelle" && (<>

          {/* ── Compact toolbar — always visible regardless of view mode ── */}
          <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",flexShrink:0}}>

            {/* Single toolbar row */}
            <div style={{padding:"8px 16px",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>

              {/* ── Daten-Gruppe ── */}
              <span style={{fontSize:10,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>Daten</span>
              <button onClick={() => setShowImport(true)} title="CSV, XLSX oder JSON importieren"
                style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #d1d5db",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:12,color:"#374151"}}>
                <Upload style={{width:11,height:11}} /> Import
              </button>
              <button onClick={() => setShowAppend(true)}
                title="KI-gesteuerte Discovery: Google Search, Maps, Kataloge — Plan erstellen & ausführen, Query-Log sichtbar"
                style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #86efac",borderRadius:5,background:"#f0fdf4",cursor:"pointer",fontSize:12,color:"#166534",fontWeight:500}}>
                🔍 Suchen & Crawlen
              </button>
              <button onClick={() => setShowAgentGoal(true)}
                title="Ziel-basierte Suche: Definiere Anzahl & Ziel, KI plant und führt automatisch mehrere Runden aus"
                style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #fda4af",borderRadius:5,background:"#fff1f2",cursor:"pointer",fontSize:12,color:"#be123c",fontWeight:500}}>
                🎯 Ziel-Suche
              </button>
              {/* Email extrapolation — shown when rows have names but no contact_email */}
              {rows.some(r => r.data["first_name"] && r.data["last_name"] && !r.data["contact_email"]) && (
                <EmailExtrapolateButton caseId={caseId} onDone={refresh} />
              )}
              {/* Catalog deep-crawl — shown when catalog rows exist */}
              {catalogRows.length > 0 && (
                <CatalogDeepCrawlButton caseId={caseId} onDone={refresh} catalogCount={catalogRows.length} />
              )}

              <span style={{width:1,height:16,background:"#e5e7eb",flexShrink:0}}/>

              {/* ── KI-Gruppe ── */}
              <span style={{fontSize:10,color:"#9ca3af",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>KI</span>
              <button onClick={() => setShowAddCol(true)}
                style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",border:"1px solid #c4b5fd",borderRadius:5,background:"#f5f3ff",cursor:"pointer",fontSize:12,color:"#6d28d9"}}>
                <Plus style={{width:11,height:11}} /> Spalte
              </button>

              {/* Divider */}
              <span style={{width:1,height:18,background:"#e5e7eb",flexShrink:0}}/>

              {/* Run buttons */}
              {runningRowIds.size > 0 ? (
                <button onClick={stopAll}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#dc2626",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600}}>
                  ■ Stop ({runningRowIds.size})
                </button>
              ) : (<>
                {hasPhaseColumns ? (<>
                  <button onClick={() => runPhase("company")}
                    style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600}}>
                    <Building2 style={{width:11,height:11}}/> Firmen
                  </button>
                  <button onClick={() => runPhase("contact")}
                    style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#2563eb",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600}}>
                    👤 Kontakte
                  </button>
                </>) : (
                  <div style={{position:"relative"}}>
                    <button onClick={() => setRunConfirm({ mode: "all_force" })}
                      title="KI-Spalten ausführen"
                      style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600}}>
                      ▶ Ausführen
                    </button>
                    {showRunOptions && (
                      <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,padding:"12px 14px",boxShadow:"0 4px 16px rgba(0,0,0,0.12)",zIndex:100,minWidth:200}}>
                        <div style={{fontSize:11,fontWeight:600,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:10}}>Ausführungs-Optionen</div>
                        {/* Option 2: Empty only */}
                        {/* Option 1: All cells (overwrite) */}
                        <button onClick={() => { setShowRunOptions(false); setRunConfirm({ mode: "all_force" }); }}
                          style={{width:"100%",textAlign:"left",padding:"7px 10px",border:"1px solid #e9d5ff",borderRadius:6,background:"#faf5ff",cursor:"pointer",fontSize:12,color:"#6d28d9",marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:14}}>▶</span>
                          <div>
                            <div style={{fontWeight:600}}>Alle Zellen ausführen</div>
                            <div style={{fontSize:10,color:"#9ca3af",marginTop:1}}>Überschreibt vorhandene Werte</div>
                          </div>
                        </button>
                        {/* Option 2: Empty only */}
                        <button onClick={() => { setShowRunOptions(false); setRunConfirm({ mode: "empty_only" }); }}
                          style={{width:"100%",textAlign:"left",padding:"7px 10px",border:"1px solid #e9d5ff",borderRadius:6,background:"#faf5ff",cursor:"pointer",fontSize:12,color:"#6d28d9",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:14}}>◐</span>
                          <div>
                            <div style={{fontWeight:600}}>Nur leere Zellen füllen</div>
                            <div style={{fontSize:10,color:"#9ca3af",marginTop:1}}>Bereits befüllte Werte bleiben unberührt</div>
                          </div>
                        </button>
                        {/* Concurrency slider */}
                        <div style={{padding:"4px 2px"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                            <span style={{fontSize:11,color:"#6b7280",fontWeight:600}}>Parallelität</span>
                            <span style={{fontSize:12,fontFamily:"monospace",color:"#7c3aed",fontWeight:700}}>{concurrency}x</span>
                          </div>
                          <input type="range" min={1} max={20} value={concurrency}
                            onChange={e => setConcurrency(Number(e.target.value))}
                            style={{width:"100%",accentColor:"#7c3aed"}} />
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#9ca3af",marginTop:2}}>
                            <span>1x (seriell)</span>
                            <span>20x (max parallel)</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>)}

              {/* Divider */}
              <span style={{width:1,height:18,background:"#e5e7eb",flexShrink:0}}/>

              {/* Stats pills */}
              <span style={{fontSize:11,color:"#6b7280"}}>{rows.length} Zeilen</span>
              {doneCount > 0 && <span style={{fontSize:11,fontWeight:600,color:"#15803d",background:"#dcfce7",padding:"1px 7px",borderRadius:8}}>✓ {doneCount}</span>}
              {errorCount > 0 && <span style={{fontSize:11,fontWeight:600,color:"#dc2626",background:"#fee2e2",padding:"1px 7px",borderRadius:8}}>✗ {errorCount}</span>}
              {runningRowIds.size > 0 && <span style={{fontSize:11,color:"#d97706",background:"#fef3c7",padding:"1px 7px",borderRadius:8,display:"flex",alignItems:"center",gap:3}}><Loader2 style={{width:9,height:9}} className="animate-spin"/> {runningRowIds.size}</span>}

              {/* Spacer */}
              <div style={{flex:1}}/>

              {/* Reset + export */}
              <button onClick={() => { setSelectedRows(new Set()); setRows(prev => prev.map(r => ({...r,cellStatuses:{},cellErrors:{}}))); }}
                title="Alle Status zurücksetzen"
                style={{padding:"4px 8px",border:"1px solid #d1d5db",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:11,color:"#6b7280"}}>
                ↺ Reset
              </button>
              <button
                title="Doppelte Zeilen (gleiche Domain) entfernen"
                onClick={async () => {
                  const res = await fetch(`/api/cases/${caseId}/dedupe`, { method: "POST" });
                  const d = await res.json();
                  if (d.removed > 0) { refresh(); }
                  else { alert("Keine Duplikate gefunden"); }
                }}
                style={{padding:"4px 8px",border:"1px solid #fecaca",borderRadius:5,background:"#fff",cursor:"pointer",fontSize:11,color:"#dc2626"}}>
                ⊘ Dedupe
              </button>
              <a href={`/api/export?caseId=${caseId}`}
                style={{display:"flex",alignItems:"center",gap:4,padding:"4px 8px",border:"1px solid #d1d5db",borderRadius:5,background:"#fff",fontSize:11,color:"#374151",textDecoration:"none"}}>
                <Download style={{width:11,height:11}}/> CSV
              </a>
            </div>

            {/* Global run error */}
            {globalRunError && (
              <div style={{padding:"6px 16px",background:"#fef2f2",borderTop:"1px solid #fecaca",display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#991b1b"}}>
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

            {/* ── Live Run Status Panel ────────────────────────────────── */}
            {(runningColumnId || runningRowIds.size > 0) && (
              <div style={{padding:"8px 16px",background:"#eff6ff",borderTop:"1px solid #bfdbfe",display:"flex",flexWrap:"wrap",alignItems:"center",gap:10}}>
                {/* Column being processed */}
                {runningColumnId && (() => {
                  const col = caseData.aiColumns.find(c => c.id === runningColumnId);
                  return col ? (
                    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                      <Loader2 style={{width:11,height:11,color:"#2563eb"}} className="animate-spin"/>
                      <span style={{fontWeight:600,color:"#1e40af"}}>Spalte: {col.name}</span>
                      {col.tool === "batch_enrich" && <span style={{fontSize:10,color:"#3b82f6",background:"#dbeafe",padding:"1px 5px",borderRadius:4}}>🚀 Batch-Enrich</span>}
                      {col.tool === "batch_contacts" && <span style={{fontSize:10,color:"#7c3aed",background:"#ede9fe",padding:"1px 5px",borderRadius:4}}>👤 Kontakt-Suche</span>}
                    </div>
                  ) : null;
                })()}
                {/* Row progress */}
                {runningRowIds.size > 0 && (
                  <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#1d4ed8"}}>
                    <span>{runningRowIds.size} Zeilen aktiv</span>
                    {/* Mini progress bar */}
                    {(() => {
                      const col = caseData.aiColumns.find(c => c.id === runningColumnId);
                      if (!col) return null;
                      const done = rows.filter(r => {
                        const s = r.cellStatuses[col.outputKey];
                        return s === "done" || s === "skipped" || s === "error";
                      }).length;
                      const total = rows.length;
                      return (
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          <div style={{width:100,height:5,background:"#bfdbfe",borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",background:"#2563eb",borderRadius:3,transition:"width 0.3s",width:`${(done/total)*100}%`}}/>
                          </div>
                          <span style={{fontSize:11,fontFamily:"monospace",color:"#1e40af"}}>{done}/{total}</span>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {/* Running cells count */}
                {runningCells.size > 0 && (
                  <span style={{fontSize:11,color:"#3b82f6"}}>
                    {runningCells.size} parallel
                  </span>
                )}
                {/* Done / Error counts */}
                {(() => {
                  const col = caseData.aiColumns.find(c => c.id === runningColumnId);
                  if (!col) return null;
                  const doneN = rows.filter(r => r.cellStatuses[col.outputKey] === "done").length;
                  const errN = rows.filter(r => r.cellStatuses[col.outputKey] === "error").length;
                  return (
                    <div style={{display:"flex",gap:6,fontSize:11}}>
                      {doneN > 0 && <span style={{color:"#15803d",fontWeight:600}}>✓ {doneN}</span>}
                      {errN > 0 && <span style={{color:"#dc2626",fontWeight:600}}>✗ {errN}</span>}
                    </div>
                  );
                })()}
                {/* Stop button */}
                <button
                  onClick={() => {
                    const col = caseData.aiColumns.find(c => c.id === runningColumnId);
                    if (col) stopColumn(col);
                  }}
                  style={{marginLeft:"auto",padding:"2px 10px",background:"#dc2626",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
                  ■ Stop
                </button>
              </div>
            )}

            {/* No AI columns warning */}
            {caseData.aiColumns.length === 0 && (
              <div style={{padding:"6px 16px",background:"#fefce8",borderTop:"1px solid #fde68a",display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#92400e"}}>
                ⚠️ Keine KI-Spalten — <button onClick={()=>setShowAddCol(true)} style={{padding:"1px 8px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontSize:11,fontWeight:600}}>+ Spalte hinzufügen</button>
              </div>
            )}
          </div>

          {/* ── CONTENT: Grouped or Flat ── */}
          {viewMode === "grouped" ? (
            <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <GroupedTableView caseId={caseId} />
            </div>
          ) : (<>

          {/* ── TABLE ── */}
          <div style={{flex:1,overflow:"auto",background:"#f9fafb",padding:"16px"}}>
          <div style={{background:"#fff",borderRadius:8,border:"1px solid #e5e7eb",overflow:"hidden",minWidth:"max-content"}}>
            <table style={{borderCollapse:"collapse",fontSize:13,minWidth:"max-content",width:"100%"}}>
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
                        style={{padding:"8px 12px",borderRight:"1px solid #e5e7eb",textAlign:"left",fontWeight:600,fontSize:12,color:"#1f2937",whiteSpace:"nowrap",width: colWidths[key] ?? (key==="company_name"?200:aiCol?180:140),minWidth:80,cursor:"grab",background: isDragOver?"#ede9fe":aiCol?"#f5f3ff":isOrphan?"#f0fdfa":"#f9fafb",borderLeft: isDragOver?"2px solid #7c3aed":undefined,userSelect:"none",position:"relative"}}>
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
                            <span style={{flex:1,color:"#0d9488",fontSize:11,fontWeight:600}}>{colLabel(key)}</span>
                          ) : (
                            <div className="group/hdr" style={{display:"flex",alignItems:"center",gap:4,width:"100%"}}>
                              <span style={{flex:1}}>{colLabel(key)}</span>
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
                      onMouseEnter={e=>(e.currentTarget.style.color="#7c3aed")}
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
                  const totalCols = caseData.aiColumns.length;
                  const statuses = caseData.aiColumns.map(c => row.cellStatuses[c.outputKey] ?? "idle");
                  const errorCount = statuses.filter(s => s === "error").length;
                  const runningCount = statuses.filter(s => s === "running").length;
                  const doneCount = statuses.filter(s => s === "done" || s === "skipped").length;
                  // Robust row state — priority: error > running > completed > partial > pending
                  const rowState: "error" | "running" | "completed" | "partial" | "pending" =
                    errorCount > 0 ? "error"
                    : runningCount > 0 ? "running"
                    : totalCols > 0 && doneCount === totalCols ? "completed"
                    : doneCount > 0 ? "partial"
                    : "pending";
                  const sel = selectedRows.has(row.id);
                  return (
                    <tr key={row.id}
                      style={{background: sel?"#ede9fe":rowState==="running"?"#fefce8":rowState==="error"?"#fef2f2":"#fff",borderBottom:"1px solid #f3f4f6"}}
                      onContextMenu={e => {
                        e.preventDefault();
                        // Simple inline context menu via browser confirm — proper menu would need a portal
                        const choice = window.confirm(
                          `Zeile: ${row.data["company_name"] ?? row.data[sourceColumns[0]] ?? row.id.slice(0,8)}\n\n` +
                          `[OK] = Alle Spalten neu ausführen (überschreibt)\n` +
                          `[Abbrechen] = Nur leere Zellen füllen`
                        );
                        if (choice) {
                          // run all columns for this row — force
                          for (const col of caseData.aiColumns) runCell(row.id, col);
                        } else {
                          // run only empty columns for this row
                          for (const col of caseData.aiColumns) {
                            const val = row.data[col.outputKey];
                            const isEmpty = !val || String(val).trim() === "" || /^notfound$/i.test(String(val));
                            if (isEmpty) runCell(row.id, col);
                          }
                        }
                      }}>
                      <td style={{width:32,padding:"6px 10px",borderRight:"1px solid #f3f4f6"}}>
                        <input type="checkbox" checked={sel}
                          onChange={e => { const s=new Set(selectedRows); e.target.checked?s.add(row.id):s.delete(row.id); setSelectedRows(s); }}
                          style={{width:13,height:13,cursor:"pointer"}} />
                      </td>
                      <td style={{width:36,padding:"6px 8px",borderRight:"1px solid #f3f4f6",color:"#d1d5db",textAlign:"center",fontSize:11}}>{page*pageSize+rowIdx+1}</td>
                      {/* Status badge — fixed, robust 5-state indicator */}
                      <td style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",whiteSpace:"nowrap"}}>
                        {rowState === "error" && (
                          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:600,color:"#dc2626",background:"#fee2e2",padding:"2px 8px",borderRadius:10}} title={`${errorCount} von ${totalCols} Spalten fehlgeschlagen`}>
                            <AlertCircle style={{width:10,height:10}} /> {errorCount} Fehler
                          </span>
                        )}
                        {rowState === "running" && (
                          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#d97706",background:"#fef3c7",padding:"2px 8px",borderRadius:10}}>
                            <Loader2 style={{width:10,height:10}} className="animate-spin" /> Läuft ({doneCount}/{totalCols})
                          </span>
                        )}
                        {rowState === "completed" && (
                          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,fontWeight:600,color:"#15803d",background:"#dcfce7",padding:"2px 8px",borderRadius:10}}>
                            <CheckCircle2 style={{width:10,height:10}} /> Fertig
                          </span>
                        )}
                        {rowState === "partial" && (
                          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#7c3aed",background:"#ede9fe",padding:"2px 8px",borderRadius:10}} title={`${doneCount} von ${totalCols} Spalten fertig`}>
                            ◐ {doneCount}/{totalCols}
                          </span>
                        )}
                        {rowState === "pending" && (
                          <span style={{fontSize:11,color:"#9ca3af"}}>○ Ausstehend</span>
                        )}
                        {/* Source badge */}
                        {(() => {
                          const src = row.data["search_source"] ?? "";
                          const query = row.data["search_query"] ?? "";
                          if (!src) return null;
                          const icon = src.includes("maps") ? "🗺️" : src === "firecrawl" ? "🔥" : src === "linkup" ? "🔗" : src === "serpapi" ? "🔍" : "🌐";
                          const label = src.includes("maps") ? "Maps" : src === "firecrawl" ? "Firecrawl" : src === "linkup" ? "Linkup" : src === "serpapi" ? "SerpApi" : src;
                          return (
                            <span title={`Quelle: ${src}\nQuery: ${query}`}
                              style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:10,color:"#6b7280",background:"#f3f4f6",padding:"1px 5px",borderRadius:6,marginTop:2,cursor:"help",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {icon} {label}
                            </span>
                          );
                        })()}
                        {/* Demote: move row to catalog tab */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await fetch(`/api/rows/${row.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ data: { ...row.data, is_catalog: "true" } }),
                            });
                            refresh();
                          }}
                          title="Als Katalogseite markieren — in Quellen verschieben"
                          style={{border:"none",background:"none",cursor:"pointer",padding:"1px 4px",fontSize:9,color:"#d1d5db",display:"block",marginTop:1}}
                          onMouseEnter={e => (e.currentTarget.style.color = "#6b7280")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#d1d5db")}
                        >
                          📚 Als Katalog
                        </button>
                      </td>
                      {(colOrder.length > 0 ? colOrder : [...sourceColumns,...caseData.aiColumns.map(c=>c.outputKey)]).map(key => {
                        const aiCol = caseData.aiColumns.find(c=>c.outputKey===key);
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
                                minWidth: aiCol.tool==="batch_contacts" ? 220 : 100,
                                verticalAlign: aiCol.tool==="batch_contacts" ? "top" : "middle",
                              }}>
                              {isEd ? <EditInput rowId={row.id} k={aiCol.outputKey} /> : (
                                <div style={{display:"flex",alignItems: aiCol.tool==="batch_contacts" ? "flex-start" : "center",gap:4,minHeight:22,position:"relative"}}>

                                  {/* ── RUNNING ── */}
                                  {status==="running" && <>
                                    <Loader2 style={{width:11,height:11,color:"#d97706",flexShrink:0}} className="animate-spin"/>
                                    <span style={{fontSize:11,color:"#d97706",flex:1}}>läuft…</span>
                                    <span style={{fontSize:10,color:"#f87171",background:"#fee2e2",padding:"1px 5px",borderRadius:4,flexShrink:0}}>■ Stop</span>
                                  </>}

                                  {/* ── IDLE — click to run ── */}
                                  {status==="idle" && (
                                    <span style={{fontSize:11,color:"#c4b5fd",flex:1,display:"flex",alignItems:"center",gap:3}}>
                                      <Play style={{width:9,height:9}}/> Run
                                    </span>
                                  )}

                                  {/* ── SKIPPED ── */}
                                  {status==="skipped" && (
                                    <span style={{fontSize:11,color:"#d1d5db",flex:1}}>—</span>
                                  )}

                                  {/* ── ERROR ── */}
                                  {status==="error" && (
                                    <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,color:"#dc2626",flex:1}} title={err}>
                                      <AlertCircle style={{width:10,height:10,flexShrink:0}}/> {err?.slice(0,40)||"Fehler"}
                                    </span>
                                  )}

                                  {/* ── DONE ── */}
                                  {status==="done" && <>
                                    {notFound && (
                                      <span style={{fontSize:11,color:"#9ca3af",fontStyle:"italic",flex:1}}>—</span>
                                    )}
                                    {isValid && (
                                      <span style={{fontSize:12,fontWeight:600,color:"#6d28d9",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val.slice(2)}</span>
                                    )}
                                    {isInvalid && (
                                      <span style={{fontSize:12,fontWeight:600,color:"#dc2626",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val.slice(2)}</span>
                                    )}
                                    {val && !isValid && !isInvalid && (() => {
                                      // Special rendering for batch_contacts column
                                      const contactsJsonKey = `_contacts_json_${aiCol.outputKey}`;
                                      const contactsRaw = row.data[contactsJsonKey];
                                      if (aiCol.tool === "batch_contacts" && contactsRaw) {
                                        try {
                                          const contacts: Array<{first_name:string|null; last_name:string|null; position:string|null; email:string|null; phone:string|null}> = JSON.parse(contactsRaw);
                                          if (contacts.length > 0) return (
                                            <div style={{flex:1,display:"flex",flexDirection:"column",gap:3,minWidth:0}}>
                                              {contacts.slice(0,3).map((c, i) => (
                                                <div key={i} style={{fontSize:11,lineHeight:1.4,borderBottom: i < contacts.length-1 && i < 2 ? "1px solid #f3f4f6" : "none",paddingBottom: i < contacts.length-1 && i < 2 ? 2 : 0}}>
                                                  <span style={{fontWeight:600,color:"#1e293b"}}>{[c.first_name,c.last_name].filter(Boolean).join(" ")}</span>
                                                  {c.position && <span style={{color:"#9ca3af",marginLeft:4}}>· {c.position}</span>}
                                                  {c.email && <div style={{fontSize:10,color:"#2563eb",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email}</div>}
                                                </div>
                                              ))}
                                              {contacts.length > 3 && <span style={{fontSize:10,color:"#9ca3af"}}>+{contacts.length-3} weitere</span>}
                                            </div>
                                          );
                                        } catch { /* fall through */ }
                                      }
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

                        // ── Contacts aggregation cell ─────────────────────
                        if (key === "contacts" && isSrc) {
                          const d = row.data as Record<string, string|null>;
                          // Build contacts from _contacts_json or flat fields
                          type ContactEntry = {name:string; position:string; email:string; phone:string; extrapolated?:string};
                          const contacts: ContactEntry[] = [];
                          const jsonKey = Object.keys(d).find(k => k.startsWith("_contacts_json_"));
                          if (jsonKey && d[jsonKey]) {
                            try {
                              const parsed = JSON.parse(d[jsonKey]!);
                              if (Array.isArray(parsed)) {
                                parsed.slice(0,3).forEach((c: Record<string,string|null>) => contacts.push({
                                  name: [c.first_name,c.last_name].filter(Boolean).join(" "),
                                  position: c.position ?? "",
                                  email: c.email ?? "",
                                  phone: c.phone ?? "",
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
                              extrapolated: d["email_extrapolated"] ?? "",
                            });
                          }
                          if (contacts.length === 0) return <td key={key} style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",color:"#d1d5db",fontSize:11}}>—</td>;
                          return (
                            <td key={key} style={{padding:"4px 10px",borderRight:"1px solid #f3f4f6",verticalAlign:"top",minWidth:220,maxWidth:300}}>
                              {contacts.map((c, i) => (
                                <div key={i} style={{fontSize:11,lineHeight:1.5,borderBottom:i<contacts.length-1?"1px solid #f3f4f6":undefined,paddingBottom:i<contacts.length-1?3:0,marginBottom:i<contacts.length-1?3:0}}>
                                  <div style={{fontWeight:600,color:"#1e293b"}}>{c.name || "—"}{c.position && <span style={{fontWeight:400,color:"#94a3b8",marginLeft:4}}>· {c.position}</span>}</div>
                                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                    {c.email && <a href={`mailto:${c.email}`} style={{color:"#2563eb",textDecoration:"none",fontSize:10}}>{c.email}</a>}
                                    {!c.email && c.extrapolated && <span style={{color:"#a855f7",fontSize:10}}>⚡ {c.extrapolated}</span>}
                                    {c.phone && <span style={{color:"#6b7280",fontSize:10}}>📞 {c.phone}</span>}
                                  </div>
                                </div>
                              ))}
                            </td>
                          );
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
                                // Domain/URL columns → clickable link
                                const isDomainCol = key === "domain" || key === "source_domain" || key === "source_url" || key === "website";
                                const isUrl = val && (val.startsWith("http") || (isDomainCol && val.includes(".")));
                                const href = isUrl ? (val.startsWith("http") ? val : `https://${val}`) : null;
                                const content = isReasoning ? `🧠 ${val}` : val;
                                const textStyle: React.CSSProperties = {
                                  fontSize:12,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                                  color: isDomainCol && href ? "#2563eb" : isValidated ? (val.startsWith("✗")?"#dc2626":val.startsWith("✓")?"#6d28d9":"#4b5563") : isReasoning?"#7c3aed":key==="company_name"?"#1f2937":"#4b5563",
                                  fontStyle: isReasoning?"italic":undefined,
                                  textDecoration: isDomainCol && href ? "none" : undefined,
                                };
                                return href
                                  ? <a href={href} target="_blank" rel="noopener noreferrer" style={textStyle} title={val} onClick={e => e.stopPropagation()}>{content}</a>
                                  : <span style={textStyle} title={val}>{content}</span>;
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

        </>)} {/* end flat view */}
        </>)} {/* end activeTab === Tabelle */}

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
                  <CatalogDeepCrawlButton caseId={caseId} onDone={refresh} catalogCount={catalogRows.length} />
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
                  <button onClick={() => setShowAppend(true)}
                    style={{padding:"8px 20px",border:"1px solid #86efac",borderRadius:7,background:"#f0fdf4",cursor:"pointer",color:"#166534",fontWeight:600,fontSize:13}}>
                    🔍 Suche starten
                  </button>
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

        {/* ══ TAB: EXPORT ══ */}
        {activeTab === "Export" && (
          <div style={{flex:1,padding:24,display:"flex",flexDirection:"column",gap:16}}>

            {/* CSV export */}
            <div style={{maxWidth:480,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb",padding:24}}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>📊 CSV exportieren</div>
              <div style={{fontSize:13,color:"#6b7280",marginBottom:16}}>{rows.length} Zeilen · {sourceColumns.length + caseData.aiColumns.length} Spalten — nur Datenwerte, kein Setup</div>
              <a href={`/api/export?caseId=${caseId}`}
                style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 20px",background:"#6d28d9",color:"#fff",borderRadius:8,fontSize:13,fontWeight:600,textDecoration:"none"}}>
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



      </div>

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
                  {" · "}{caseData?.aiColumns.length ?? 0} KI-Spalten
                </div>
              </div>
            </div>

            {/* Warning for overwrite mode */}
            {runConfirm.mode === "all_force" && (() => {
              const filledCount = rows.filter(r => caseData?.aiColumns.some(c => r.data[c.outputKey] && r.data[c.outputKey] !== "")).length;
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
        availableFields={[...sourceColumns, ...caseData.aiColumns.map(c=>c.outputKey)]} />}
      {showImport && <ImportModal caseId={caseId} onClose={()=>setShowImport(false)} onImported={()=>{setShowImport(false);refresh();}} />}
      {showDiscovery && <DiscoveryModal caseId={caseId} rows={rows} sourceColumns={sourceColumns} onClose={()=>setShowDiscovery(false)} onImported={()=>{refresh();}} />}
      {showAgentGoal && <AgentGoalModal caseId={caseId} rowsCount={rows.length} onClose={()=>setShowAgentGoal(false)} onImported={()=>{refresh();}} />}
      {showAppend && <AppendModal caseId={caseId} onRowsAdded={(n)=>{if(n>0)refresh();}} onClose={()=>setShowAppend(false)} />}
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
    </CaseContext.Provider>
    ) : (
      <div style={{display:"flex",height:"100vh",alignItems:"center",justifyContent:"center"}}>
        <Loader2 className="animate-spin" style={{width:24,height:24,color:"#7c3aed"}} />
      </div>
    )}
    </ErrorBoundary>
  );
}
