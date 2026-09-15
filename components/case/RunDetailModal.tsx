"use client";

import { useState, useEffect } from "react";
import { Play, Loader2, CheckCircle, AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import type { AiColumn, RowData, CellStatus } from "@/lib/types";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/lib/model-options";

type Tab = "result" | "sources" | "llm" | "raw" | "reasoning";

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
  const [openAccordion, setOpenAccordion] = useState<Record<string, boolean>>({});
  const [verifyResults, setVerifyResults] = useState<Record<string, {exists:boolean|null;catchAll:boolean|null;code:number;message:string;loading?:boolean}>>({});
  const [verifyAllResults, setVerifyAllResults] = useState<Record<string, {loading:boolean; candidates?: Array<{email:string;pattern:string;confidence:string;exists:boolean|null;catchAll:boolean|null;smtpCode:number;smtpMessage:string}>; bestEmail?:string|null; catchAll?:boolean; verified?:boolean}>>({});

  async function verifyEmail(email: string) {
    setVerifyResults(prev => ({...prev, [email]: {...(prev[email]??{}), loading: true}}));
    try {
      const res = await fetch("/api/verify-email", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({email}) });
      const data = await res.json();
      setVerifyResults(prev => ({...prev, [email]: {...data, loading: false}}));
    } catch (e) {
      setVerifyResults(prev => ({...prev, [email]: {exists:null,catchAll:null,code:0,message:(e as Error).message,loading:false}}));
    }
  }

  async function verifyAllEmails(key: string, firstName: string, lastName: string, domain: string, rowId: string, fieldPrefix: string) {
    setVerifyAllResults(prev => ({...prev, [key]: {loading: true}}));
    try {
      const res = await fetch("/api/verify-email-all", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({firstName, lastName, domain, rowId, fieldPrefix}) });
      const data = await res.json();
      setVerifyAllResults(prev => ({...prev, [key]: {...data, loading: false}}));
    } catch (e) {
      setVerifyAllResults(prev => ({...prev, [key]: {loading: false}}));
    }
  }

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
  const systemPrompt = row.data[`_llm_system_${col.outputKey}`] ?? "";
  const rawResponse  = row.data[`_llm_raw_${col.outputKey}`] ?? "";
  const tokensRaw    = row.data[`_llm_tokens_${col.outputKey}`] ?? "";
  const costRaw      = row.data[`_llm_cost_${col.outputKey}`] ?? "";
  const reasoningVal = row.data[`_reasoning_${col.outputKey}`] ?? "";
  const tokens       = tokensRaw ? (() => { try { return JSON.parse(tokensRaw); } catch { return null; } })() : null;
  const costUsd      = costRaw ? parseFloat(costRaw) : null;

  // Batch metadata
  const batchSources   = row.data[`_batch_sources_${col.outputKey}`] ?? row.data[`_contacts_sources_${col.outputKey}`] ?? "";
  const contactsJson   = row.data[`_contacts_json_${col.outputKey}`] ?? "";
  const sourceUrlsRaw  = row.data[`_contacts_source_urls_${col.outputKey}`] ?? "";
  const batchScrapeErr = row.data[`_batch_scrape_error_${col.outputKey}`] ?? "";
  const batchSearchErr = row.data[`_batch_search_error_${col.outputKey}`] ?? "";
  const batchScrapeMd    = row.data[`_batch_scrape_md_${col.outputKey}`] ?? "";
  const batchImpressumMd  = row.data[`_batch_impressum_md_${col.outputKey}`] ?? row.data[`_contacts_impressum_md_${col.outputKey}`] ?? "";
  const batchSearchSnip   = row.data[`_batch_search_snip_${col.outputKey}`] ?? "";
  const contactsGoogleSnip   = row.data[`_contacts_google_snip_${col.outputKey}`] ?? "";
  const contactsLinkedinSnip = row.data[`_contacts_linkedin_snip_${col.outputKey}`] ?? "";

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
    { id:"reasoning" as Tab, label:"🧠 Reasoning", show:!!reasoningVal },
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
                const cs: Array<{first_name:string|null; last_name:string|null; position:string|null; email:string|null; email_extrapolated?:string|null; phone:string|null; linkedin:string|null; source?:string}> = JSON.parse(contactsJson);
                const companyEmailVal = row.data["company_email"] ?? row.data["email_fallback"] ?? "";
                return (
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>{cs.length} Kontakt{cs.length!==1?"e":""} gefunden</div>
                    <div style={{display:"grid",gap:8}}>
                      {cs.map((c, i) => (
                        <div key={i} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:"10px 14px",background:"#f8fafc"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <div style={{fontWeight:600,fontSize:14,color:"#1e293b"}}>
                              {[c.first_name,c.last_name].filter(Boolean).join(" ") || "—"}
                              {c.position && <span style={{fontWeight:400,color:"#64748b",marginLeft:8,fontSize:12}}>· {c.position}</span>}
                            </div>
                            {c.source && <span style={{fontSize:9,color:"#9ca3af",background:"#f1f5f9",padding:"1px 5px",borderRadius:4,marginLeft:"auto"}}>{c.source}</span>}
                          </div>
                          <div style={{display:"flex",gap:12,fontSize:12,flexWrap:"wrap",alignItems:"center"}}>
                            {c.email
                              ? <a href={`mailto:${c.email}`} style={{color:"#2563eb",textDecoration:"none"}}>✉ {c.email}</a>
                              : c.email_extrapolated
                              ? (() => {
                                  const vr = verifyResults[c.email_extrapolated!];
                                  const badge = vr?.loading ? <span style={{fontSize:9,color:"#9ca3af"}}>⏳</span>
                                    : vr?.catchAll ? <span style={{fontSize:9,color:"#f59e0b",background:"#fef3c7",padding:"1px 4px",borderRadius:3}} title="Catch-all Server">∀</span>
                                    : vr?.exists === true ? <span style={{fontSize:9,color:"#15803d",background:"#dcfce7",padding:"1px 4px",borderRadius:3}} title={vr.message}>✓ gültig</span>
                                    : vr?.exists === false ? <span style={{fontSize:9,color:"#dc2626",background:"#fef2f2",padding:"1px 4px",borderRadius:3}} title={vr.message}>✗ ungültig</span>
                                    : vr ? <span style={{fontSize:9,color:"#9ca3af",background:"#f3f4f6",padding:"1px 4px",borderRadius:3}} title={vr.message}>?</span>
                                    : null;
                                  return (
                                    <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                                      <span style={{color:"#a855f7",fontSize:11}} title="Extrapoliert">⚡ {c.email_extrapolated}</span>
                                      {badge}
                                      {!vr && <button onClick={()=>verifyEmail(c.email_extrapolated!)}
                                        style={{fontSize:9,padding:"1px 6px",border:"1px solid #e2e8f0",borderRadius:4,background:"#f8fafc",cursor:"pointer",color:"#6b7280",lineHeight:1.4}}>
                                        SMTP testen
                                      </button>}
                                    </span>
                                  );
                                })()
                              : <span style={{color:"#d1d5db",fontSize:11,fontStyle:"italic"}}>keine E-Mail</span>}
                            {c.phone && <span style={{color:"#374151"}}>📞 {c.phone}</span>}
                            {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{color:"#0a66c2",textDecoration:"none"}}>💼 LinkedIn ↗</a>}
                          </div>
                          {/* Alle Muster testen Button */}
                          {!c.email && (() => {
                            const domain = (row.data["domain"] ?? row.data["source_domain"] ?? "").replace(/^https?:\/\//,"").replace(/^www\./,"").split("/")[0];
                            const prefix = (col.batchContactsPrefix ?? "contact_") + (i+1);
                            const vKey = `${row.id}_contact_${i}`;
                            const var_ = verifyAllResults[vKey];
                            if (!domain || !c.first_name || !c.last_name) return null;
                            return (
                              <div style={{marginTop:6}}>
                                {!var_ && (
                                  <button onClick={()=>verifyAllEmails(vKey, c.first_name!, c.last_name!, domain, row.id, prefix)}
                                    style={{fontSize:10,padding:"3px 10px",border:"1px solid #c4b5fd",borderRadius:5,background:"#faf5ff",cursor:"pointer",color:"#7c3aed",fontWeight:600}}>
                                    ⚡ Alle Muster testen & verifizieren
                                  </button>
                                )}
                                {var_?.loading && (
                                  <span style={{fontSize:11,color:"#9ca3af",display:"flex",alignItems:"center",gap:4}}>
                                    <span className="animate-spin" style={{display:"inline-block"}}>⏳</span> Teste alle Muster via SMTP…
                                  </span>
                                )}
                                {var_ && !var_.loading && var_.candidates && (
                                  <div style={{marginTop:4,border:"1px solid #e2e8f0",borderRadius:6,overflow:"hidden"}}>
                                    <div style={{padding:"5px 10px",background: var_.verified?"#f0fdf4":var_.catchAll?"#fefce8":"#f8fafc",fontSize:10,fontWeight:600,color: var_.verified?"#15803d":var_.catchAll?"#92400e":"#6b7280",borderBottom:"1px solid #e2e8f0"}}>
                                      {var_.verified ? `✓ Verifiziert: ${var_.bestEmail}` : var_.catchAll ? "∀ Catch-All Server — kein Verify möglich, bester Kandidat: " + var_.bestEmail : "Kein SMTP-Treffer — bester Kandidat: " + (var_.bestEmail ?? "—")}
                                    </div>
                                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                                      <tbody>
                                        {var_.candidates.map((cand, ci) => (
                                          <tr key={ci} style={{borderBottom:"1px solid #f1f5f9",background: cand.exists===true?"#f0fdf4":cand.exists===false?"#fef2f2":"#fff"}}>
                                            <td style={{padding:"4px 8px",fontFamily:"monospace",color: cand.exists===true?"#15803d":cand.exists===false?"#9ca3af":"#6b7280",fontWeight: cand.exists===true?600:400}}>
                                              {cand.exists===true?"✓ ":cand.exists===false?"  ":"? "}{cand.email}
                                            </td>
                                            <td style={{padding:"4px 8px",color:"#9ca3af"}}>{cand.pattern}</td>
                                            <td style={{padding:"4px 8px",color:"#9ca3af",fontFamily:"monospace",fontSize:9}}>{cand.smtpCode>0?cand.smtpCode:""}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                    {companyEmailVal && (
                      <div style={{marginTop:8,padding:"7px 12px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,color:"#6b7280"}}>
                        🏢 Firmen-E-Mail: <a href={`mailto:${companyEmailVal}`} style={{color:"#6b7280"}}>{companyEmailVal}</a>
                      </div>
                    )}
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
            <div style={{marginBottom:14}}>
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

            {/* Source accordions */}
            {(() => {
              type SourceEntry = { id: string; icon: string; label: string; url?: string; content?: string; error?: string };
              const entries: SourceEntry[] = [];
              const srcs = batchSources.split(",").map(s=>s.trim()).filter(Boolean);
              const urls = sourceUrlsRaw ? sourceUrlsRaw.split("\n").filter(Boolean) : [];

              // Website Scrape (nur batch_enrich)
              if (col.tool === "batch_enrich") {
                if (srcs.some(s=>s==="scrape") || batchScrapeMd || batchScrapeErr) {
                  const url = urls.find(u=>!u.includes("linkedin") && !u.includes("google")) ?? (row.data["domain"] ? `https://${row.data["domain"]}` : undefined);
                  entries.push({ id:"scrape", icon:"🔥", label:"Homepage (Firecrawl)", url, content: batchScrapeMd || undefined, error: batchScrapeErr || undefined });
                }
              }
              // Impressum (beide tools)
              const impressumSrc = srcs.find(s=>s.startsWith("impressum:"));
              const impressumContent = batchImpressumMd;
              if (impressumSrc || impressumContent) {
                const path = impressumSrc?.replace("impressum:","") ?? "/impressum";
                const url = row.data["domain"] ? `https://${row.data["domain"]}${path}` : undefined;
                entries.push({ id:"impressum", icon:"🔥", label:`Impressum/Kontakt (${path})`, url, content: impressumContent || undefined });
              }
              // Google-Suche
              if (srcs.some(s=>s==="google"||s==="google_management"||s==="search") || batchSearchSnip || contactsGoogleSnip) {
                entries.push({ id:"google", icon:"🔍", label:"Google-Suche (Entscheider)", content: contactsGoogleSnip || batchSearchSnip || undefined, error: batchSearchErr || undefined });
              }
              // LinkedIn
              if (srcs.some(s=>s==="linkedin") || contactsLinkedinSnip) {
                const liUrls = urls.filter(u=>u.includes("linkedin"));
                entries.push({ id:"linkedin", icon:"💼", label:"LinkedIn-Suche", url: liUrls[0], content: contactsLinkedinSnip || undefined });
              }

              if (entries.length === 0) return <div style={{color:"#9ca3af",fontSize:12,padding:"12px 0"}}>Keine Quelldaten gespeichert — führe die Spalte erneut aus.</div>;

              return (
                <div style={{display:"grid",gap:8}}>
                  {entries.map(entry => {
                    const isOpen = openAccordion[entry.id] ?? false;
                    const hasContent = !!(entry.content || entry.error);
                    return (
                      <div key={entry.id} style={{border:"1px solid #e2e8f0",borderRadius:8,overflow:"hidden"}}>
                        {/* Accordion header */}
                        <button
                          onClick={()=>hasContent && setOpenAccordion(prev=>({...prev,[entry.id]:!prev[entry.id]}))}
                          style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 12px",background:isOpen?"#f1f5f9":"#f8fafc",border:"none",cursor:hasContent?"pointer":"default",textAlign:"left"}}
                        >
                          <span style={{fontSize:16,flexShrink:0}}>{entry.icon}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <span style={{fontSize:12,fontWeight:600,color:"#374151"}}>{entry.label}</span>
                            {entry.url && (
                              <a href={entry.url} target="_blank" rel="noopener noreferrer"
                                onClick={e=>e.stopPropagation()}
                                style={{display:"block",fontSize:11,color:"#2563eb",textDecoration:"none",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}
                                title={entry.url}>
                                {entry.url.replace(/^https?:\/\/(www\.)?/,"")}
                              </a>
                            )}
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                            {entry.error && <span style={{fontSize:10,color:"#dc2626",background:"#fef2f2",padding:"1px 6px",borderRadius:4}}>Fehler</span>}
                            {entry.content && <span style={{fontSize:10,color:"#6b7280",background:"#f3f4f6",padding:"1px 6px",borderRadius:4}}>{entry.content.length > 1000 ? `${(entry.content.length/1000).toFixed(1)}k Zeichen` : `${entry.content.length} Zeichen`}</span>}
                            {hasContent && <span style={{fontSize:12,color:"#9ca3af",transform:isOpen?"rotate(180deg)":"none",transition:"transform 0.15s"}}>▾</span>}
                          </div>
                        </button>
                        {/* Accordion content */}
                        {isOpen && hasContent && (
                          <div style={{borderTop:"1px solid #e2e8f0",background:"#fff"}}>
                            {entry.error && (
                              <div style={{padding:"8px 12px",background:"#fef2f2",fontSize:11,color:"#991b1b"}}>
                                ⚠ {entry.error}
                              </div>
                            )}
                            {entry.content && (
                              <pre style={{margin:0,padding:"12px",fontSize:11,lineHeight:1.6,color:"#374151",fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:400,overflowY:"auto",background:"#fafafa"}}>
                                {entry.content}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Errors (scrape/search) if no accordion found them */}
            {!batchSources && (batchScrapeErr || batchSearchErr) && (
              <div style={{marginTop:8,padding:"8px 12px",background:"#fef9c3",border:"1px solid #fde68a",borderRadius:6,fontSize:11,color:"#92400e"}}>
                <div style={{fontWeight:600,marginBottom:3}}>⚠ Warnungen</div>
                {batchScrapeErr && <div>Scrape: {batchScrapeErr}</div>}
                {batchSearchErr && <div>Suche: {batchSearchErr}</div>}
              </div>
            )}
          </>)}

          {/* ═══ LLM TAB ═══ */}
          {activeTab === "llm" && (<>
            {/* Web search query if configured */}
            {col.useWebSearch && col.searchQuery && (
              <div style={{marginBottom:12,padding:"8px 12px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:6}}>
                <div style={{fontSize:10,fontWeight:700,color:"#1e40af",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>🔍 Web-Suche Query</div>
                <code style={{fontSize:12,color:"#1e3a8a",fontFamily:"monospace"}}>
                  {col.searchQuery.replace(/\{([^}]+)\}/g, (_, k) => {
                    const src = (col.inputMappings ?? {})[k] || k;
                    const v = row.data[src];
                    return v ? `[${v}]` : `{${k}}`;
                  })}
                </code>
                <div style={{fontSize:10,color:"#60a5fa",marginTop:2}}>
                  Evidenz: {col.evidenceMode === "page" ? "Ganze Seiten (Firecrawl)" : col.evidenceMode === "auto" ? "Auto (Snippets → Seiten)" : "Snippets"}
                </div>
              </div>
            )}

            {/* System Prompt accordion */}
            {systemPrompt && (() => {
              const isOpen = openAccordion["sys_prompt"] ?? false;
              return (
                <div style={{marginBottom:10,border:"1px solid #e2e8f0",borderRadius:8,overflow:"hidden"}}>
                  <button onClick={()=>setOpenAccordion(prev=>({...prev,sys_prompt:!prev.sys_prompt}))}
                    style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 12px",background:isOpen?"#faf5ff":"#fafafa",border:"none",cursor:"pointer",textAlign:"left"}}>
                    <span style={{fontSize:14}}>🧠</span>
                    <span style={{flex:1,fontSize:12,fontWeight:600,color:"#374151"}}>System-Prompt (Instruktionen ans LLM)</span>
                    <span style={{fontSize:10,color:"#9ca3af",background:"#f3f4f6",padding:"1px 6px",borderRadius:4,marginRight:4}}>{systemPrompt.length} Zeichen</span>
                    <span style={{fontSize:12,color:"#9ca3af",transform:isOpen?"rotate(180deg)":"none",transition:"transform 0.15s"}}>▾</span>
                  </button>
                  {isOpen && (
                    <pre style={{margin:0,padding:"12px",fontSize:11,background:"#faf5ff",borderTop:"1px solid #e2e8f0",whiteSpace:"pre-wrap",wordBreak:"break-word",lineHeight:1.6,maxHeight:320,overflowY:"auto",color:"#3b0764",fontFamily:"monospace"}}>
                      {systemPrompt}
                    </pre>
                  )}
                </div>
              );
            })()}

            {/* User Prompt */}
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.05em"}}>User-Prompt (gesendet)</div>
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

          {activeTab === "reasoning" && (<>
            {reasoningVal ? (
              <div style={{padding:"4px 0"}}>
                <div style={{fontSize:11,fontWeight:600,color:"#6b7280",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>
                  🧠 LLM-Begründung
                </div>
                <div style={{background:"#faf5ff",border:"1px solid #e9d5ff",borderRadius:8,padding:"12px 14px",fontSize:13,color:"#4c1d95",lineHeight:1.6,fontStyle:"italic"}}>
                  {reasoningVal}
                </div>
                <div style={{marginTop:8,fontSize:11,color:"#9ca3af"}}>
                  Gespeichert als <code style={{background:"#f3f4f6",padding:"1px 5px",borderRadius:3}}>_reasoning_{col.outputKey}</code>
                </div>
              </div>
            ) : (
              <div style={{textAlign:"center",padding:"32px 0",color:"#9ca3af",fontSize:13}}>
                Kein Reasoning vorhanden — Option muss in der Spalten-Konfiguration aktiviert sein.
              </div>
            )}
          </>)}

        </div>
      </div>
    </div>
  );
}
