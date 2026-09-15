"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Loader2, Save, Sparkles, Zap, Info } from "lucide-react";
import type { AiColumn, CellStatus, Case } from "@/lib/types";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";

// Client-safe copies (avoid importing lib/batch-enrich which pulls in playwright)
const BATCH_FIELDS = [
  "company_name", "domain", "phone", "email", "address", "city", "zip",
  "industry", "description", "employees", "founded", "first_name",
  "last_name", "position", "linkedin",
] as const;

const BATCH_FIELD_LABELS: Record<string, string> = {
  company_name: "Firmenname",
  domain: "Domain/Website",
  phone: "Telefon",
  email: "E-Mail",
  address: "Adresse",
  city: "Stadt",
  zip: "PLZ",
  industry: "Branche",
  description: "Beschreibung",
  employees: "Mitarbeiterzahl",
  founded: "Gründungsjahr",
  first_name: "Vorname (Ansprechpartner)",
  last_name: "Nachname (Ansprechpartner)",
  position: "Position (Ansprechpartner)",
  linkedin: "LinkedIn-Profil",
};

export default function EditPromptModal({ col, caseId, onSave, onClose, cellContext, onRunCell, onOpenRunDetail, availableFields }: {
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
  const [compareModels, setCompareModels] = useState<string[]>([col.model || "openai/gpt-4o-mini"]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<Array<{ model: string; provider: string; ok: boolean; score: number; latencyMs: number; value: string; validation: "pass" | "fail"; validationReason: string; error?: string }>>([]);
  const [recommendedModel, setRecommendedModel] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([...DEFAULT_MODEL_OPTIONS]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const requiredFields = draft.requiredFields ?? [];

  const isBatch = draft.tool === "batch_enrich" || draft.tool === "batch_contacts";

  /** Build the default batch system prompt for display/reset */
  function getDefaultBatchPrompt(): string {
    const fields = draft.batchOutputFields ?? [...BATCH_FIELDS];
    const fieldList = fields
      .map((f) => `  "${f}": "${BATCH_FIELD_LABELS[f] ?? f}"`)
      .join(",\n");
    return `Du bist ein präziser Daten-Extraktions-Agent für Unternehmensprofile.
Analysiere die gegebenen Quellen (Website-Inhalt, Suchergebnisse) und extrahiere strukturierte Unternehmensdaten.

Antworte NUR mit JSON (kein Markdown, keine Erklärungen):
{
${fieldList}
}

Regeln:
- Fehlende Felder: null (NICHT weglassen, NICHT raten)
- domain: nur Basis-Domain ohne http/https/www (z.B. "example.de")
- phone: internationales Format wenn möglich (z.B. "+49 381 454000")
- industry: kurze präzise Beschreibung (z.B. "Heizungs-, Sanitär- und Klimatechnik")
- description: 1-2 Sätze was das Unternehmen macht
- Ansprechpartner: nur wenn Name/Position klar erkennbar (kein Raten)
- Wenn mehrere Telefonnummern: die primäre Kontaktnummer`;
  }

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
            <Sparkles style={{width:16,height:16,color:"#7c3aed"}} />
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
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <label style={{...lbl,marginBottom:0}}>Prompt</label>
              {isBatch && (
                <div style={{display:"flex",gap:6}}>
                  <button
                    type="button"
                    onClick={() => setDraft(d => ({...d, prompt: ""}))}
                    disabled={!draft.prompt.trim()}
                    style={{fontSize:11,padding:"2px 10px",borderRadius:6,border:"1px solid #d1d5db",background:"#f9fafb",cursor:"pointer",color:"#374151",fontFamily:"inherit",opacity:draft.prompt.trim()?1:0.4}}
                    title="Eigenen Prompt löschen → Standard wird wieder verwendet"
                  >
                    ↺ Standard
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(d => ({...d, prompt: getDefaultBatchPrompt()}))}
                    style={{fontSize:11,padding:"2px 10px",borderRadius:6,border:"1px solid #7c3aed",background:"#f5f3ff",cursor:"pointer",color:"#7c3aed",fontFamily:"inherit"}}
                    title="Standard-Prompt laden und bearbeiten"
                  >
                    ✏️ Standard laden & bearbeiten
                  </button>
                </div>
              )}
            </div>
            {isBatch && !draft.prompt.trim() && (
              <div style={{marginBottom:6,padding:"8px 10px",background:"#f0f9ff",border:"1px solid #bfdbfe",borderRadius:6,fontSize:11,color:"#1e40af",cursor:"pointer"}}
                onClick={() => setDraft(d => ({...d, prompt: getDefaultBatchPrompt()}))}>
                ℹ️ <strong>Leer = Standard-Prompt wird verwendet.</strong> Klicke hier oder „Standard laden" um ihn zu sehen und zu bearbeiten.
              </div>
            )}
            <textarea ref={promptRef} style={{...inp,fontFamily:"monospace",fontSize:12,minHeight:260,resize:"vertical",lineHeight:1.6}}
              value={draft.prompt}
              placeholder={isBatch ? getDefaultBatchPrompt() : ""}
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
                        <span key={p} style={{fontSize:11,background:"#ede9fe",color:"#6d28d9",padding:"2px 7px",borderRadius:10,fontFamily:"monospace"}} title="Spalte gefunden ✓">{"{"+p+"}"} ✓</span>
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
                          background: inPrompt?"#f5f3ff":"#f9fafb",
                          color: inPrompt?"#6d28d9":"#374151",
                          borderColor: inPrompt?"#c4b5fd":"#d1d5db"}
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

                  <div>
                    <label style={{...lbl,color:"#1d4ed8",marginBottom:3}}>Evidenz-Tiefe (Firecrawl)</label>
                    <select style={{...inp,borderColor:"#93c5fd"}}
                      value={draft.evidenceMode || "snippet"}
                      onChange={e => setDraft(d => ({...d, evidenceMode: (e.target.value === "snippet" ? undefined : e.target.value) as typeof d.evidenceMode}))}>
                      <option value="snippet">Snippets (schnell, günstig)</option>
                      <option value="page">Ganze Seiten lesen (Firecrawl-Scrape)</option>
                      <option value="auto">Auto: erst Snippets, bei leerer Antwort Seiten lesen</option>
                    </select>
                  </div>

                  <div style={{fontSize:11,color:"#3b82f6",lineHeight:1.5}}>
                    Die Suchergebnisse werden automatisch als Kontext <strong>vor deinem Prompt</strong> eingefügt. Nutze Platzhalter wie <code style={{background:"#dbeafe",padding:"0 4px",borderRadius:3}}>{"{company_name}"}</code> um zeilenspezifische Suchen zu bauen.
                    <br />
                    <span style={{color:"#60a5fa"}}>„Ganze Seiten" lädt die Top-2 Treffer per Firecrawl als Markdown ins Prompt — für Infos, die nicht im Snippet stehen (Impressum, Adresse, Gründungsjahr …). Benötigt Eden-AI-Key, +1–3s pro Zeile.</span>
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
              <select style={inp} value={draft.model||"openai/gpt-4o-mini"} onChange={e=>setDraft(d=>({...d,model:e.target.value}))}>
                {mergeModelOptions([draft.model || "openai/gpt-4o-mini"], modelOptions).map((m) => <option key={m}>{m}</option>)}
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
                        <span style={{marginLeft:"auto",color:r.ok?"#7c3aed":"#dc2626",fontWeight:600}}>{r.ok ? "OK" : "FAIL"}</span>
                      </div>
                      <div style={{fontSize:11,color:r.validation==="pass"?"#5b21b6":"#b45309",marginTop:3}}>Validation: {r.validationReason}</div>
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
              {cellContext.status==="done" && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#7c3aed",background:"#ddd6fe",padding:"3px 10px",borderRadius:10,fontWeight:600}}>✓ Fertig</span>}
              {cellContext.status==="running" && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#d97706",background:"#fef3c7",padding:"3px 10px",borderRadius:10,fontWeight:600}}><Loader2 style={{width:10,height:10}} className="animate-spin" /> Läuft</span>}
              {cellContext.status==="idle" && <span style={{fontSize:11,color:"#9ca3af"}}>○ Noch nicht ausgeführt</span>}
              {cellContext.status==="skipped" && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#9ca3af",background:"#f3f4f6",padding:"3px 10px",borderRadius:10}}>⏭ Übersprungen</span>}
              {onRunCell && (
                <button onClick={()=>{onRunCell();}}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"4px 12px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:5,cursor:"pointer",fontSize:12,fontWeight:600,marginLeft:"auto"}}>
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
                            <td style={{padding:"6px 12px",color:v.startsWith("✗")?"#dc2626":v.startsWith("✓")?"#6d28d9":"#1e293b",wordBreak:"break-all",lineHeight:1.5}}>{v||<span style={{color:"#cbd5e1",fontStyle:"italic"}}>empty</span>}</td>
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
            style={{display:"flex",alignItems:"center",gap:6,padding:"8px 20px",background:"#7c3aed",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:600,opacity:saving?.6:1}}>
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


