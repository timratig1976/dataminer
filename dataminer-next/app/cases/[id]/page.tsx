"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Plus, Play, Upload, Trash2, Settings, Save, Sparkles,
  Loader2, CheckCircle2, XCircle, SkipForward, Zap,
  Download, ScrollText, ChevronLeft, ChevronRight, GripVertical,
  Database
} from "lucide-react";
import type { Case, RowData, AiColumn, CellStatus } from "@/lib/types";
import { AddColumnModal } from "@/components/AddColumnModal";
import { ImportModal } from "@/components/ImportModal";
import { ColumnHeaderMenu } from "@/components/ColumnHeaderMenu";

// ── Edit Prompt Modal ─────────────────────────────────────────────────────────
function EditPromptModal({ col, caseId, onSave, onClose, cellContext, onRunCell, availableFields }: {
  col: AiColumn; caseId: string;
  onSave: (updated: AiColumn) => void;
  onClose: () => void;
  cellContext?: { rowId: string; value: string; status: CellStatus; error?: string; rowLabel?: string };
  onRunCell?: () => void;
  availableFields?: string[];
}) {
  const [draft, setDraft] = useState<AiColumn>({...col});
  const [saving, setSaving] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

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
    onClose();
  }

  const inp: React.CSSProperties = {width:"100%",border:"1px solid #d1d5db",borderRadius:6,padding:"7px 10px",fontSize:13,outline:"none",background:"#fff",fontFamily:"inherit"};
  const lbl: React.CSSProperties = {display:"block",fontSize:11,fontWeight:600,color:"#6b7280",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em"};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#fff",borderRadius:12,width:"min(680px,96vw)",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
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
            <textarea ref={promptRef} style={{...inp,fontFamily:"monospace",fontSize:12,minHeight:140,resize:"vertical",lineHeight:1.6}}
              value={draft.prompt} onChange={e=>setDraft(d=>({...d,prompt:e.target.value}))} />
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
                        <button key={f} onClick={()=>{
                          const ta = promptRef.current;
                          const placeholder = "{"+f+"}";
                          if (ta) {
                            const start = ta.selectionStart ?? draft.prompt.length;
                            const end = ta.selectionEnd ?? draft.prompt.length;
                            const next = draft.prompt.slice(0,start)+placeholder+draft.prompt.slice(end);
                            setDraft(d=>({...d,prompt:next}));
                            setTimeout(()=>{ ta.focus(); ta.setSelectionRange(start+placeholder.length,start+placeholder.length); },0);
                          } else {
                            setDraft(d=>({...d,prompt:d.prompt+placeholder}));
                          }
                        }}
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
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <div><label style={lbl}>Modell</label>
              <select style={inp} value={draft.model||"gpt-4o-mini"} onChange={e=>setDraft(d=>({...d,model:e.target.value}))}>
                <option>gpt-4o-mini</option><option>gpt-4o</option><option>gpt-4-turbo</option>
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
              <select style={inp} value={draft.condition||""} onChange={e=>setDraft(d=>({...d,condition:e.target.value as AiColumn["condition"]||undefined}))}>
                <option value="">Immer ausführen</option>
                <option value="require_input">Nur wenn Eingabefeld vorhanden</option>
                <option value="empty">Nur wenn Ausgabefeld leer (kein Re-Run)</option>
                <option value="not_empty">Nur wenn Ausgabefeld befüllt</option>
              </select>
            </div>
            {draft.condition && (
              <div><label style={lbl}>Bedingungsfeld</label>
                <input style={{...inp,fontFamily:"monospace"}} value={draft.conditionField||""} onChange={e=>setDraft(d=>({...d,conditionField:e.target.value||undefined}))} placeholder="Feldname" />
              </div>
            )}
          </div>
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
                <button onClick={()=>{onRunCell();onClose();}}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#16a34a",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600,marginLeft:"auto"}}>
                  <Play style={{width:11,height:11}} /> Jetzt ausführen
                </button>
              )}
            </div>
            {cellContext.error && (
              <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:600,color:"#dc2626",marginBottom:4}}>Fehlermeldung</div>
                <pre style={{fontSize:12,color:"#991b1b",margin:0,whiteSpace:"pre-wrap",wordBreak:"break-all",fontFamily:"monospace",lineHeight:1.5}}>{cellContext.error}</pre>
              </div>
            )}
            {cellContext.value && cellContext.status==="done" && (
              <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:6,padding:"10px 12px"}}>
                <div style={{fontSize:11,fontWeight:600,color:"#15803d",marginBottom:4}}>Ergebnis</div>
                <pre style={{fontSize:12,color:"#1f2937",margin:0,whiteSpace:"pre-wrap",wordBreak:"break-all",fontFamily:"monospace",lineHeight:1.5}}>{cellContext.value}</pre>
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
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [editingCol, setEditingCol] = useState<AiColumn | null>(null);
  const [addingCol, setAddingCol] = useState(false);
  const [newCol, setNewCol] = useState<Partial<AiColumn>>({});

  useEffect(() => {
    fetch(`/api/cases/${caseId}`).then(r => r.json()).then((c: Case) => {
      setCaseData(c); setName(c.name); setApiKey(c.apiKey || "");
    });
  }, [caseId]);

  async function saveMeta() {
    setSaving(true);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), apiKey: apiKey.trim() || undefined }),
    });
    const updated = await res.json();
    setCaseData(updated); onCaseUpdated(updated);
    setSaving(false); setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000);
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
              <option>gpt-4o-mini</option><option>gpt-4o</option><option>gpt-4-turbo</option>
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
            <input style={{...inp,fontFamily:"monospace"}} type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-..." />
            <div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Lokal in SQLite gespeichert. Fallback: OPENAI_API_KEY Env-Variable.</div>
          </div>
        </div>
        <button style={btn("#16a34a")} onClick={saveMeta} disabled={saving}>
          {saving ? <Loader2 style={{width:12,height:12}} className="animate-spin" /> : <Save style={{width:12,height:12}} />}
          {savedMsg ? "✓ Gespeichert!" : "Speichern"}
        </button>
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
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [editingPromptCol, setEditingPromptCol] = useState<AiColumn | null>(null);
  const [editingPromptCell, setEditingPromptCell] = useState<{col: AiColumn; row: RowData} | null>(null);

  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch(`/api/cases/${caseId}`).then((x) => x.json()),
      fetch(`/api/rows?caseId=${caseId}`).then((x) => x.json()),
    ]);
    setCaseData(c);
    setRows(r);
    if (r.length > 0) {
      const keys = Object.keys(r[0].data).filter(
        (k) => !k.startsWith("_") && !c.aiColumns.some((col: AiColumn) => col.outputKey === k)
      );
      setSourceColumns(keys);
      setColOrder(prev => {
        if (prev.length > 0) return prev;
        return [...keys, ...c.aiColumns.map((col: AiColumn) => col.outputKey)];
      });
    }
    setRangeBis(r.length);
    setRangeMax(r.length);
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

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
    setRunningCells((prev) => new Set(prev).add(key));
    setRows((prev) =>
      prev.map((r) => r.id === rowId
        ? { ...r, cellStatuses: { ...r.cellStatuses, [col.outputKey]: "running" } }
        : r)
    );
    const res = await fetch("/api/run/cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, rowId, columnId: col.id }),
    });
    const result = await res.json();
    setRows((prev) =>
      prev.map((r) => r.id === rowId
        ? {
            ...r,
            data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey] },
            cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status ?? (res.ok ? "done" : "error") },
            cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors,
          }
        : r)
    );
    setRunningCells((prev) => { const s = new Set(prev); s.delete(key); return s; });
  }

  // ── Run entire column ─────────────────────────────────────────────────────
  async function runColumn(col: AiColumn) {
    const targetIds = selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id);
    // Optimistically mark all as running
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
      body: JSON.stringify({ caseId, columnId: col.id, rowIds: targetIds }),
    });
    const { results } = await res.json();
    setRows((prev) =>
      prev.map((r) => {
        const result = results?.[r.id];
        if (!result) return r;
        return {
          ...r,
          data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey] },
          cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status },
          cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors,
        };
      })
    );
  }

  // ── Run all columns for selected rows ─────────────────────────────────────
  async function runSelectedRows() {
    if (!caseData) return;
    if (caseData.aiColumns.length === 0) {
      alert("Keine KI-Spalten konfiguriert. Bitte zuerst eine Prompt-Spalte hinzufügen.");
      return;
    }
    const targetIds = selectedRows.size > 0 ? [...selectedRows] : rows.map((r) => r.id);
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
        body: JSON.stringify({ caseId, columnId: col.id, rowIds: targetIds }),
      });
      const { results } = await res.json();
      setRows((prev) =>
        prev.map((r) => {
          const result = results?.[r.id];
          if (!result) return r;
          return {
            ...r,
            data: { ...r.data, [col.outputKey]: result.value ?? r.data[col.outputKey] },
            cellStatuses: { ...r.cellStatuses, [col.outputKey]: result.status },
            cellErrors: result.error ? { ...r.cellErrors, [col.outputKey]: result.error } : r.cellErrors,
          };
        })
      );
    }
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
            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>
              {new Date(caseData.createdAt).toLocaleDateString("de-DE")} · {rows.length} Zeilen · {sourceColumns.length} Quellspalten · {caseData.aiColumns.length} KI-Spalten
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
              <button onClick={() => setShowPromptCols(v=>!v)}
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
              <button onClick={runSelectedRows}
                style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"5px 14px",background:"#16a34a",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600}}
              >
                ▶ Starten — {selCount} Zeilen
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
                    if (!isSrc && !aiCol) return null;
                    const isDragOver = dragOverCol === key;
                    return (
                      <th key={key}
                        draggable
                        onDragStart={()=>setDragCol(key)}
                        onDragOver={e=>{e.preventDefault();setDragOverCol(key);}}
                        onDragLeave={()=>setDragOverCol(null)}
                        onDrop={()=>handleColDrop(key)}
                        style={{padding:"8px 12px",borderRight:"1px solid #e5e7eb",textAlign:"left",fontWeight:600,fontSize:12,color:"#1f2937",whiteSpace:"nowrap",minWidth: key==="company_name"?160:aiCol?160:110,cursor:"grab",background: isDragOver?"#dcfce7":aiCol?"#f0fdf4":"#f9fafb",borderLeft: isDragOver?"2px solid #16a34a":undefined,userSelect:"none"}}>
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <GripVertical style={{width:10,height:10,color:"#9ca3af",flexShrink:0}} />
                          {aiCol ? (
                            <ColumnHeaderMenu column={aiCol} onRun={()=>runColumn(aiCol)} onDelete={()=>deleteColumn(aiCol.id)} onEdit={()=>setEditingPromptCol({...aiCol})} />
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
                  <th style={{padding:"8px 12px",background:"#f9fafb",minWidth:100}}>
                    <button onClick={()=>setShowAddCol(true)}
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
                        if (!isSrc && !aiCol) return null;
                        if (aiCol) {
                          const status: CellStatus = row.cellStatuses[aiCol.outputKey]??"idle";
                          const val = row.data[aiCol.outputKey]??"";
                          const err = row.cellErrors[aiCol.outputKey];
                          const isEd = editingCell?.rowId===row.id && editingCell.key===aiCol.outputKey;
                          return (
                            <td key={key} style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",maxWidth:200,background:status==="error"?"#fef2f2":undefined}} className="group/cell" onDoubleClick={()=>startEdit(row.id,aiCol.outputKey,val)}>
                              {isEd ? <EditInput rowId={row.id} k={aiCol.outputKey} /> : (
                                <div style={{display:"flex",alignItems:"center",gap:4,minHeight:22}}>
                                  <CellStatusIcon status={status} />
                                  {(status==="idle"||(!val&&status!=="running"&&status!=="error"&&status!=="skipped")) ? (
                                    <button onClick={()=>runCell(row.id,aiCol)}
                                      className="opacity-0 group-hover/cell:opacity-100"
                                      style={{display:"flex",alignItems:"center",gap:3,fontSize:11,color:"#16a34a",border:"none",background:"none",cursor:"pointer",transition:"opacity .15s"}}>
                                      <Play style={{width:10,height:10}} /> Run
                                    </button>
                                  ) : (
                                    <>
                                      <span style={{fontSize:12,color:status==="error"?"#dc2626":status==="skipped"?"#9ca3af":"#1f2937",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}} title={err||val}>
                                        {status==="error" ? (err || "Fehler") : status==="skipped" ? `⏭ ${val||"übersprungen"}` : val}
                                      </span>
                                      <button onClick={()=>runCell(row.id,aiCol)} className="opacity-0 group-hover/cell:opacity-100"
                                        style={{color:"#d1d5db",border:"none",background:"none",cursor:"pointer",flexShrink:0,transition:"opacity .15s"}} title="Erneut ausführen">
                                        <Play style={{width:10,height:10}} />
                                      </button>
                                    </>
                                  )}
                                  <button onClick={e=>{e.stopPropagation();setEditingPromptCell({col:aiCol,row});}}
                                    className="opacity-0 group-hover/cell:opacity-100"
                                    style={{color:"#9ca3af",border:"none",background:"none",cursor:"pointer",flexShrink:0,transition:"opacity .15s",padding:"0 2px"}} title="Prompt & Log">
                                    <Settings style={{width:10,height:10}} />
                                  </button>
                                </div>
                              )}
                            </td>
                          );
                        }
                        const val = row.data[key]??"";
                        const isEd = editingCell?.rowId===row.id && editingCell.key===key;
                        return (
                          <td key={key} style={{padding:"6px 12px",borderRight:"1px solid #f3f4f6",maxWidth:200}} onDoubleClick={()=>startEdit(row.id,key,val)}>
                            {isEd ? <EditInput rowId={row.id} k={key} /> :
                              <span style={{fontSize:12,color:key==="company_name"?"#1f2937":"#4b5563",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val}</span>}
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
          <div style={{flex:1,padding:24}}>
            <div style={{maxWidth:400,background:"#fff",borderRadius:10,border:"1px solid #e5e7eb",padding:24}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>📤 Export</div>
              <div style={{fontSize:13,color:"#6b7280",marginBottom:16}}>{rows.length} Zeilen · {sourceColumns.length + caseData.aiColumns.length} Spalten</div>
              <a href={`/api/export?caseId=${caseId}`}
                style={{display:"inline-flex",alignItems:"center",gap:8,padding:"8px 20px",background:"#15803d",color:"#fff",borderRadius:8,fontSize:13,fontWeight:600,textDecoration:"none"}}>
                <Download style={{width:15,height:15}} /> CSV herunterladen
              </a>
            </div>
          </div>
        )}

        {/* ══ TAB: EINSTELLUNGEN ══ */}
        {activeTab === "Einstellungen" && (
          <SettingsPanel caseId={caseId} onCaseUpdated={setCaseData} />
        )}

      </div>

      {showAddCol && <AddColumnModal caseId={caseId} onClose={()=>setShowAddCol(false)} onAdded={(u:Case)=>{setCaseData(u);setShowAddCol(false);}} />}
      {showImport && <ImportModal caseId={caseId} onClose={()=>setShowImport(false)} onImported={()=>{setShowImport(false);refresh();}} />}
      {(editingPromptCol || editingPromptCell) && caseData && (
        <EditPromptModal
          col={editingPromptCell?.col ?? editingPromptCol!}
          caseId={caseId}
          onSave={(updated) => {
            setCaseData(prev => prev ? {...prev, aiColumns: prev.aiColumns.map(c => c.id===updated.id ? updated : c)} : prev);
          }}
          onClose={() => { setEditingPromptCol(null); setEditingPromptCell(null); }}
          cellContext={editingPromptCell ? {
            rowId: editingPromptCell.row.id,
            value: editingPromptCell.row.data[editingPromptCell.col.outputKey] ?? "",
            status: editingPromptCell.row.cellStatuses[editingPromptCell.col.outputKey] ?? "idle",
            error: editingPromptCell.row.cellErrors[editingPromptCell.col.outputKey],
            rowLabel: editingPromptCell.row.data["company_name"] ?? editingPromptCell.row.id,
          } : undefined}
          onRunCell={editingPromptCell ? () => runCell(editingPromptCell.row.id, editingPromptCell.col) : undefined}
          availableFields={[
            ...sourceColumns,
            ...caseData.aiColumns.filter(c => c.id !== (editingPromptCell?.col.id ?? editingPromptCol?.id)).map(c => c.outputKey),
          ]}
        />
      )}
    </div>
  );
}
