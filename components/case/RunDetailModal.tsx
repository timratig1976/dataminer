"use client";

import { useState, useEffect } from "react";
import { Play, Loader2, CheckCircle, AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import type { AiColumn, RowData, CellStatus } from "@/lib/types";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";

type Tab = "result" | "sources" | "llm" | "raw";

export default function RunDetailModal({ col, row: initialRow, caseId, onClose, onRowUpdate }: {
  col: AiColumn;
  row: RowData;
  caseId: string;
  onClose: () => void;
  onRowUpdate: (rowId: string, patch: Partial<RowData>) => void;
}) {
  const [row, setRow] = useState(initialRow);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string|null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("result");

  const isBatchTool = col.tool === "batch_enrich" || col.tool === "batch_contacts";
  const multiKeys = col.multiKeys ?? [];
  const extraOutputKeys = col.validateDomain
    ? [...multiKeys.map(mk => mk.outputKey), "domain_validated"]
    : multiKeys.map(mk => mk.outputKey);
  const allOutputKeys = extraOutputKeys.length > 0 ? extraOutputKeys : [col.outputKey];

  const savedStatus = row.cellStatuses[col.outputKey] ?? "idle";
  const err = row.cellErrors[col.outputKey];

  // LLM metadata
  const exactPrompt  = row.data[`_llm_prompt_${col.outputKey}`] ?? "";
  const rawResponse  = row.data[`_llm_raw_${col.outputKey}`] ?? "";
  const tokensRaw    = row.data[`_llm_tokens_${col.outputKey}`] ?? "";
  const costRaw      = row.data[`_llm_cost_${col.outputKey}`] ?? "";
  const tokens       = tokensRaw ? (() => { try { return JSON.parse(tokensRaw); } catch { return null; } })() : null;
  const costUsd      = costRaw ? parseFloat(costRaw) : null;

  // Batch metadata
  const batchSources  = row.data[`_batch_sources_${col.outputKey}`] ?? row.data[`_contacts_sources_${col.outputKey}`] ?? "";
  const contactsJson  = row.data[`_contacts_json_${col.outputKey}`] ?? "";
  const sourceUrlsRaw = row.data[`_contacts_source_urls_${col.outputKey}`] ?? "";
  const batchScrapeErr = row.data[`_batch_scrape_error_${col.outputKey}`] ?? "";
  const batchSearchErr = row.data[`_batch_search_error_${col.outputKey}`] ?? "";

  const companyName = row.data["company_name"] ?? row.data["Unternehmensname"] ?? "";
  const inputMappings = col.inputMappings ?? {};
  const requiredFields = col.requiredFields ?? [];
  const placeholderKeys = Array.from(new Set(
    (col.prompt.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) ?? []).map(m => m.slice(1,-1).trim())
  ));
  const previewPrompt = col.prompt.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, k) => {
    const src = inputMappings[k.trim()] || k.trim();
    const v = row.data[src];
    return (v != null && String(v).trim()) ? String(v) : `{${k}}`;
  });

  // Batch-written fields grouped nicely
  const batchFields = isBatchTool
    ? Object.entries(row.data).filter(([k, v]) =>
        !k.startsWith("_") && v && v !== "" &&
        (col.tool === "batch_enrich"
          ? ["company_name","domain","phone","email","city","zip","industry","description"].includes(k)
          : ["contacts","contact_email","contact_phone","linkedin","first_name","last_name","position"].includes(k)))
    : [];

  const allContactFields = Object.entries(row.data)
    .filter(([k, v]) => (k.startsWith("contact_") || k === "contacts") && v && v !== "" && !k.startsWith("_"))
    .sort(([a],[b]) => a.localeCompare(b));

  async function handleRun() {
    if (running) return;
    setRunning(true); setRunError(null);
    try {
      const res = await fetch("/api/run/cell", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({caseId, rowId:row.id, columnId:col.id}) });
      const result = await res.json();
      if (result.error || !res.ok) { setRunError(result.error ?? "Fehler"); return; }
      const extraData = result.multiValues ?? {};
      const metaData: Record<string,string> = {};
      if (result.rawResponse)    metaData[`_llm_raw_${col.outputKey}`]    = result.rawResponse;
      if (result.renderedPrompt) metaData[`_llm_prompt_${col.outputKey}`] = result.renderedPrompt;
      if (result.tokens)         metaData[`_llm_tokens_${col.outputKey}`] = JSON.stringify(result.tokens);
      if (result.costUsd != null) metaData[`_llm_cost_${col.outputKey}`]  = String(result.costUsd);
      const newData = { ...row.data, [col.outputKey]: result.value ?? "", ...extraData, ...metaData };
      const newStatuses = { ...row.cellStatuses, [col.outputKey]: "done" as CellStatus };
      for (const k of Object.keys(extraData)) newStatuses[k] = "done";
      const updated = { ...row, data: newData, cellStatuses: newStatuses };
      setRow(updated);
      onRowUpdate(row.id, { data: newData, cellStatuses: newStatuses });
    } catch (e: unknown) { setRunError((e as Error).message ?? "Netzwerkfehler"); }
    finally { setRunning(false); }
  }

  const hasRun = savedStatus === "done" || savedStatus === "error";
  const s = { fontFamily:"monospace" } as React.CSSProperties;

  // Tab definitions
  const TABS: { id: Tab; label: string; show: boolean }[] = [
    { id:"result"  as Tab, label:"📊 Ergebnis",  show:true },
    { id:"sources" as Tab, label:"🔍 Quellen",   show:isBatchTool },
    { id:"llm"     as Tab, label:"🤖 LLM-Call",  show:!!(exactPrompt || previewPrompt) },
    { id:"raw"     as Tab, label:"{ } Rohdaten", show:!!(rawResponse || allContactFields.length > 0) },
  ].filter(t => t.show) as { id: Tab; label: string; show: boolean }[];

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#fff",borderRadius:12,width:"min(720px,96vw)",maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 28px 80px rgba(0,0,0,0.28)"}}>

        {/* ── Header ── */}
        <div style={{padding:"12px 16px",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <Sparkles style={{width:14,height:14,color:"#7c3aed",flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <span style={{fontWeight:700,fontSize:13,color:"#111"}}>{col.name}</span>
            {companyName && <span style={{fontSize:12,color:"#9ca3af",marginLeft:8}}>— {companyName}</span>}
          </div>
          {/* Status + cost */}
          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            {running && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#d97706",background:"#fef3c7",padding:"2px 8px",borderRadius:8}}><Loader2 style={{width:10,height:10}} className="animate-spin"/> Läuft…</span>}
            {!running && savedStatus==="done"    && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#15803d",background:"#dcfce7",padding:"2px 8px",borderRadius:8}}><CheckCircle2 style={{width:10,height:10}}/> Fertig</span>}
            {!running && savedStatus==="error"   && <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#dc2626",background:"#fef2f2",padding:"2px 8px",borderRadius:8}}><AlertCircle style={{width:10,height:10}}/> Fehler</span>}
            {!running && savedStatus==="skipped" && <span style={{fontSize:11,color:"#9ca3af",background:"#f3f4f6",padding:"2px 8px",borderRadius:8}}>⏭ Übersprungen</span>}
            {tokens && <span style={{fontSize:10,color:"#6366f1",background:"#eef2ff",padding:"2px 7px",borderRadius:6,fontFamily:"monospace"}}>{tokens.total} tok</span>}
            {costUsd != null && <span style={{fontSize:10,color:"#0369a1",background:"#e0f2fe",padding:"2px 7px",borderRadius:6,fontFamily:"monospace"}}>${costUsd.toFixed(5)}</span>}
          </div>
          <button onClick={handleRun} disabled={running}
            style={{display:"flex",alignItems:"center",gap:4,padding:"4px 12px",background:running?"#c4b5fd":"#7c3aed",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:600,flexShrink:0}}>
            {running ? <Loader2 style={{width:10,height:10}} className="animate-spin"/> : <Play style={{width:10,height:10}}/>}
            {running ? "Läuft" : "Run"}
          </button>
          <button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",fontSize:18,color:"#9ca3af",lineHeight:1,padding:"0 2px"}}>×</button>
        </div>

        {/* ── Tabs ── */}
        <div style={{display:"flex",borderBottom:"1px solid #e5e7eb",background:"#fafafa",flexShrink:0}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              style={{padding:"8px 16px",border:"none",borderBottom: activeTab===t.id ? "2px solid #7c3aed" : "2px solid transparent",background:"none",cursor:"pointer",fontSize:12,fontWeight:500,color: activeTab===t.id ? "#7c3aed" : "#6b7280",transition:"all 0.1s",marginBottom:-1}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div style={{flex:1,overflowY:"auto",padding:"16px"}}>

          {/* ═══ RESULT TAB ═══ */}
          {activeTab === "result" && (<>
            {err && <div style={{marginBottom:10,padding:"8px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,fontSize:12,color:"#991b1b"}}>{err}</div>}
            {runError && <div style={{marginBottom:10,padding:"8px 12px",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,fontSize:12,color:"#dc2626"}}>{runError}</div>}

            {/* Batch contacts — cards */}
            {col.tool === "batch_contacts" && contactsJson && (() => {
              try {
                const cs: Array<{first_name:string|null; last_name:string|null; position:string|null; email:string|null; phone:string|null; linkedin:string|null}> = JSON.parse(contactsJson);
                return (
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>{cs.length} Kontakt{cs.length!==1?"e":""} gefunden</div>
                    <div style={{display:"grid",gap:8}}>
                      {cs.map((c, i) => (
                        <div key={i} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 14px",background:"#f8fafc"}}>
                          <div style={{fontWeight:600,fontSize:14,color:"#1e293b"}}>
                            {[c.first_name,c.last_name].filter(Boolean).join(" ") || "—"}
                            {c.position && <span style={{fontWeight:400,color:"#64748b",marginLeft:8,fontSize:12}}>· {c.position}</span>}
                          </div>
                          <div style={{display:"flex",gap:14,marginTop:6,fontSize:12,flexWrap:"wrap"}}>
                            {c.email && <a href={`mailto:${c.email}`} style={{color:"#2563eb",textDecoration:"none"}}>✉ {c.email}</a>}
                            {c.phone && <span style={{color:"#374151"}}>📞 {c.phone}</span>}
                            {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{color:"#0a66c2",textDecoration:"none"}}>💼 LinkedIn ↗</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              } catch { return null; }
            })()}

            {/* Batch enrich — output fields */}
            {col.tool === "batch_enrich" && batchFields.length > 0 && (
              <div>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Angereicherte Felder</div>
                <div style={{border:"1px solid #e2e8f0",borderRadius:8,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <tbody>
                      {batchFields.map(([k,v]) => (
                        <tr key={k} style={{borderBottom:"1px solid #f1f5f9"}}>
                          <td style={{padding:"7px 12px",color:"#94a3b8",width:140,fontFamily:"monospace",fontSize:11}}>{k}</td>
                          <td style={{padding:"7px 12px",color:"#1e293b",wordBreak:"break-all"}}>{String(v).slice(0,200)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Standard output */}
            {!isBatchTool && (hasRun || running) && (
              <div style={{border:"1px solid #e2e8f0",borderRadius:8,overflow:"hidden"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",padding:"6px 12px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",textTransform:"uppercase",letterSpacing:"0.07em"}}>Output</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <tbody>
                    {allOutputKeys.map(k => {
                      const v = row.data[k] ?? "";
                      return (
                        <tr key={k} style={{borderBottom:"1px solid #f1f5f9"}}>
                          <td style={{padding:"7px 12px",color:"#94a3b8",width:180,fontFamily:"monospace",fontSize:11}}>{k}</td>
                          <td style={{padding:"7px 12px",color:v.startsWith("✗")?"#dc2626":v.startsWith("✓")?"#6d28d9":"#1e293b",wordBreak:"break-all"}}>
                            {running && !v ? <span style={{color:"#d1d5db",fontStyle:"italic"}}>läuft…</span> : v || <span style={{color:"#cbd5e1",fontStyle:"italic"}}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!hasRun && !running && !contactsJson && <div style={{textAlign:"center",padding:"32px 0",color:"#9ca3af",fontSize:13}}>Noch nicht ausgeführt — klicke „Run"</div>}
          </>)}

          {/* ═══ SOURCES TAB ═══ */}
          {activeTab === "sources" && (<>
            {/* Input */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Input</div>
              <div style={{display:"grid",gap:3}}>
                {[["Firma", row.data["company_name"]], ["Domain", row.data["domain"] ?? row.data["source_domain"]], ["Stadt", row.data["city"]]].filter(([,v])=>v).map(([k,v])=>(
                  <div key={k as string} style={{display:"flex",gap:12,fontSize:12}}>
                    <span style={{color:"#94a3b8",width:60,flexShrink:0}}>{k}</span>
                    <span style={{color:"#1e293b",fontFamily:"monospace"}}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sources + URLs */}
            {batchSources && (
              <div style={{marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Genutzte Quellen</div>
                <div style={{display:"grid",gap:6}}>
                  {(() => {
                    const srcs = batchSources.split(",").filter(s=>s.trim());
                    const urls = sourceUrlsRaw ? sourceUrlsRaw.split("\n").filter(Boolean) : [];
                    return srcs.map((s, i) => {
                      const label = s.trim();
                      const icon = label==="scrape"?"🌐":label==="impressum"?"📄":label==="google_management"?"🔍":label==="linkedin"?"💼":"📎";
                      const name = label==="scrape"?"Website-Scrape":label==="impressum"?"Impressum":label==="google_management"?"Google (Entscheider-Suche)":label==="linkedin"?"LinkedIn":label;
                      const url = urls[i];
                      return (
                        <div key={label} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:"#f8fafc",borderRadius:6,border:"1px solid #e2e8f0"}}>
                          <span style={{fontSize:14}}>{icon}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>{name}</div>
                            {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"#2563eb",textDecoration:"none",fontFamily:"monospace",display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={url}>{url.split("://").slice(1).join("://").slice(0,60)}{url.length>63?"…":""}</a>}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Errors */}
            {(batchScrapeErr || batchSearchErr) && (
              <div style={{padding:"8px 12px",background:"#fef9c3",border:"1px solid #fde68a",borderRadius:6,fontSize:11,color:"#92400e"}}>
                <div style={{fontWeight:600,marginBottom:3}}>⚠ Warnungen</div>
                {batchScrapeErr && <div>Scrape: {batchScrapeErr}</div>}
                {batchSearchErr && <div>Suche: {batchSearchErr}</div>}
              </div>
            )}
          </>)}

          {/* ═══ LLM TAB ═══ */}
          {activeTab === "llm" && (<>
            {/* Prompt */}
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em"}}>Prompt (gesendet)</div>
                {tokens && <span style={{fontSize:10,color:"#94a3b8",fontFamily:"monospace"}}>{tokens.prompt ?? "?"} prompt tokens</span>}
              </div>
              <pre style={{margin:0,padding:"10px 12px",fontSize:11,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:6,whiteSpace:"pre-wrap",wordBreak:"break-all",lineHeight:1.6,maxHeight:280,overflowY:"auto"}}>
                {exactPrompt || previewPrompt || "(Noch kein Run — Prompt-Vorschau)"}
              </pre>
            </div>

            {/* Input variables */}
            {placeholderKeys.length > 0 && (
              <div>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Input-Variablen</div>
                <div style={{border:"1px solid #e2e8f0",borderRadius:6,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <tbody>
                      {placeholderKeys.map(k => {
                        const src = inputMappings[k] || k;
                        const val = row.data[src];
                        const missing = !val || String(val).trim()==="";
                        const required = requiredFields.includes(k);
                        return (
                          <tr key={k} style={{borderBottom:"1px solid #f1f5f9"}}>
                            <td style={{padding:"5px 12px",color:"#94a3b8",width:200,fontFamily:"monospace"}}>
                              {`{${k}}`}{src!==k && <span style={{color:"#64748b"}}> ← {src}</span>}
                              {required && <span style={{marginLeft:6,color:missing?"#dc2626":"#6d28d9",fontSize:10}}>{missing?"(fehlt!)":"(pflicht)"}</span>}
                            </td>
                            <td style={{padding:"5px 12px",color:val?"#1e293b":"#d1d5db",fontStyle:val?"normal":"italic"}}>{val ?? "(nicht vorhanden)"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>)}

          {/* ═══ RAW DATA TAB ═══ */}
          {activeTab === "raw" && (<>
            {/* LLM raw response */}
            {rawResponse && (
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em"}}>LLM Response (raw)</div>
                  {tokens && <span style={{fontSize:10,color:"#94a3b8",fontFamily:"monospace"}}>{tokens.completion ?? "?"} completion tokens</span>}
                </div>
                <pre style={{margin:0,padding:"10px 12px",fontSize:11,background:"#fafff4",border:"1px solid #bbf7d0",borderRadius:6,whiteSpace:"pre-wrap",wordBreak:"break-all",lineHeight:1.6,maxHeight:240,overflowY:"auto",color:"#14532d"}}>
                  {(()=>{try{return JSON.stringify(JSON.parse(rawResponse),null,2);}catch{return rawResponse;}})()}
                </pre>
              </div>
            )}

            {/* All contact fields */}
            {allContactFields.length > 0 && (
              <div>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>Alle Kontaktfelder in der Zeile</div>
                <div style={{border:"1px solid #e2e8f0",borderRadius:6,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <tbody>
                      {allContactFields.map(([k,v])=>(
                        <tr key={k} style={{borderBottom:"1px solid #f1f5f9"}}>
                          <td style={{padding:"4px 12px",color:"#94a3b8",width:180,fontFamily:"monospace",fontSize:10}}>{k}</td>
                          <td style={{padding:"4px 12px",color:"#1e293b",wordBreak:"break-all"}}>{String(v).slice(0,120)}{String(v).length>120?"…":""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!rawResponse && allContactFields.length===0 && <div style={{textAlign:"center",padding:"32px 0",color:"#9ca3af",fontSize:13}}>Kein Raw-Output vorhanden (noch nicht ausgeführt)</div>}
          </>)}

        </div>
      </div>
    </div>
  );
}
