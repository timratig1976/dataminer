import { apiFetch } from "@/api";
"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Loader2, Save, Sparkles, Zap, Info } from "lucide-react";
import type { AiColumn, CellStatus, Case } from "../../types";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "../../types/model-options";
import { Modal, FormField, Input, Select, Textarea } from "../ui/ModalMaster";

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
  const [draft, setDraft] = useState<AiColumn>({
    ...col,
    prompt: col.prompt ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [compareModels, setCompareModels] = useState<string[]>([col.model || "openai/gpt-4o-mini"]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [compareResults, setCompareResults] = useState<Array<{ model: string; provider: string; ok: boolean; score: number; latencyMs: number; value: string; validation: "pass" | "fail"; validationReason: string; error?: string }>>([]);
  const [recommendedModel, setRecommendedModel] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([...DEFAULT_MODEL_OPTIONS]);
  const [stepTestResults, setStepTestResults] = useState<Record<string, {
    loading?: boolean;
    renderedQuery?: string;
    latencyMs?: number;
    results?: Array<{ title: string; url: string; snippet: string }>;
    pageMarkdownSample?: string | null;
    error?: string;
  }>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const requiredFields = draft.requiredFields ?? [];

  const isBatch = draft.tool === "batch_company" || draft.tool === "batch_contact";

  /** Build the default batch system prompt for display/reset */
  function getDefaultBatchPrompt(): string {
    if (draft.tool === "batch_contact") {
      return `Du bist ein Kontaktdaten-Extraktions-Agent. Finde Entscheider (Geschäftsführer, Inhaber, CEO) des Unternehmens.

Antworte NUR mit JSON (kein Markdown, keine Erklärungen):
{
  "contacts": [
    {
      "first_name": "Vorname",
      "last_name": "Nachname",
      "position": "Geschäftsführer / Inhaber / CEO",
      "email": "persönliche oder direkte E-Mail (keine allgemeinen info@)",
      "phone": "direkte Durchwahl oder Mobilnummer",
      "linkedin": null
    }
  ],
  "company_email": "allgemeine Firmen-E-Mail (z.B. info@...)"
}

Regeln:
- Nur reale Personen als Entscheider identifizieren (keine Platzhalter)
- Wenn kein Name erkennbar ist: first_name und last_name als null belassen`;
    }

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
    apiFetch(`/api/llm/models?caseId=${caseId}`)
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
    try {
      const res = await apiFetch(`/api/cases/${caseId}`);
      const c = await res.json();
      const existingCols = (c.aiColumns || c.ai_columns || []) as AiColumn[];
      const updated = existingCols.map(a => a.id === draft.id ? draft : a);
      const r2 = await apiFetch(`/api/cases/${caseId}`, {
        method: "PATCH", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ ai_columns: updated, aiColumns: updated }),
      });
      const saved = await r2.json();
      const savedCols = (saved.aiColumns || saved.ai_columns || []) as AiColumn[];
      onSave(savedCols.find((a: AiColumn) => a.id === draft.id) ?? draft);
    } catch (err: any) {
      alert("Fehler beim Speichern: " + err.message);
    } finally {
      setSaving(false);
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
    if (!cellContext?.rowId || compareModels.length === 0) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareResults([]);
    setRecommendedModel(null);
    try {
      const res = await apiFetch("/api/llm/compare", {
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

  const inp: React.CSSProperties = {
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: "var(--r)",
    padding: "7px 10px",
    fontSize: 13,
    outline: "none",
    background: "#fff",
    fontFamily: "inherit",
    color: "var(--text-1)",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };
  const lbl: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-2)",
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <Modal
      onClose={onClose}
      title="KI-Spalte bearbeiten"
      badge={
        <span
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            padding: "1px 6px",
            borderRadius: "var(--rs)",
            color: "var(--text-2)",
          }}
        >
          {col.outputKey}
        </span>
      }
      icon={<Sparkles style={{ width: 15, height: 15 }} />}
      maxWidth="min(1060px, 96vw)"
      maxHeight="92vh"
      footer={
        <>
          <button onClick={onClose} className="btn-v2" style={{ padding: "7px 16px" }}>
            Abbrechen
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="btn-v2 btn-v2-primary"
            style={{ padding: "7px 20px" }}
          >
            {saving ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> : <Save style={{ width: 13, height: 13 }} />}
            Speichern
          </button>
        </>
      }
    >
      <div style={{ padding: "20px 24px", display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <FormField label="Spaltenname">
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </FormField>
          <FormField label="Output Key">
            <Input
              mono
              value={draft.outputKey}
              onChange={(e) => setDraft((d) => ({ ...d, outputKey: e.target.value }))}
            />
          </FormField>
        </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label style={{ ...lbl, marginBottom: 0 }}>Prompt</label>
              {isBatch && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, prompt: "" }))}
                    disabled={!draft.prompt.trim()}
                    className="btn-v2"
                    style={{ fontSize: 11, padding: "3px 9px", opacity: draft.prompt.trim() ? 1 : 0.4 }}
                    title="Eigenen Prompt löschen → Standard wird wieder verwendet"
                  >
                    ↺ Standard
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, prompt: getDefaultBatchPrompt() }))}
                    className="btn-v2"
                    style={{
                      fontSize: 11,
                      padding: "3px 9px",
                      borderColor: "var(--orange-mid)",
                      background: "var(--orange-soft)",
                      color: "var(--orange)",
                      fontWeight: 600,
                    }}
                    title="Standard-Prompt laden und bearbeiten"
                  >
                    ✏️ Standard laden & bearbeiten
                  </button>
                </div>
              )}
            </div>
            {isBatch && !draft.prompt.trim() && (
              <div
                style={{
                  marginBottom: 8,
                  padding: "8px 12px",
                  background: "var(--orange-soft)",
                  border: "1px solid var(--orange-mid)",
                  borderRadius: "var(--r)",
                  fontSize: 11.5,
                  color: "#9a4411",
                  cursor: "pointer",
                }}
                onClick={() => setDraft((d) => ({ ...d, prompt: getDefaultBatchPrompt() }))}
              >
                ℹ️ <strong>Leer = Standard-Prompt wird verwendet.</strong> Klicke hier oder „Standard laden" um ihn zu sehen und zu bearbeiten.
              </div>
            )}
            <textarea
              ref={promptRef}
              style={{
                ...inp,
                fontFamily: "monospace",
                fontSize: 12,
                minHeight: 250,
                resize: "vertical",
                lineHeight: 1.6,
                background: "var(--bg)",
              }}
              value={draft.prompt}
              placeholder={isBatch ? getDefaultBatchPrompt() : ""}
              onChange={(e) => {
                const scroll = promptRef.current?.scrollTop ?? 0;
                const selStart = e.target.selectionStart;
                const selEnd = e.target.selectionEnd;
                setDraft((d) => ({ ...d, prompt: e.target.value }));
                requestAnimationFrame(() => {
                  if (!promptRef.current) return;
                  promptRef.current.scrollTop = scroll;
                  promptRef.current.setSelectionRange(selStart, selEnd);
                });
              }}
            />
            {/* Placeholder analysis */}
            {availableFields && availableFields.length > 0 && (() => {
              const used = [...new Set((draft.prompt.match(/\{([^}]+)\}/g)||[]).map(m=>m.slice(1,-1).trim()))];
              const matched = used.filter(p=>availableFields.includes(p));
              const unmatched = used.filter(p=>!availableFields.includes(p));
              return (
                <div style={{marginTop:8,display:"grid",gap:6}}>
                  {/* used placeholders status */}
                  {used.length > 0 && (
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
                      <span style={{fontSize:11,fontWeight:500,color:"var(--text-2)",marginRight:2}}>Im Prompt:</span>
                      {matched.map(p=>(
                        <span key={p} style={{fontSize:11,background:"var(--green-soft)",color:"var(--green)",border:"1px solid var(--green-mid)",padding:"2px 8px",borderRadius:"var(--rs)",fontFamily:"monospace"}} title="Spalte gefunden ✓">{"{"+p+"}"} ✓</span>
                      ))}
                      {unmatched.map(p=>(
                        <span key={p} style={{fontSize:11,background:"var(--danger-soft)",color:"var(--danger)",border:"1px solid #fecaca",padding:"2px 8px",borderRadius:"var(--rs)",fontFamily:"monospace"}} title="Spalte nicht gefunden!">{"{"+p+"}"} ✗</span>
                      ))}
                    </div>
                  )}
                  {/* available field chips */}
                  <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
                    <span style={{fontSize:11,fontWeight:500,color:"var(--text-2)",marginRight:2}}>Verfügbare Felder:</span>
                    {availableFields.map(f=>{
                      const inPrompt = draft.prompt.includes("{"+f+"}");
                      return (
                        <button key={f} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>insertPlaceholder(f)}
                        style={{fontSize:11,padding:"2px 8px",borderRadius:"var(--rs)",fontFamily:"monospace",border:"1px solid",cursor:"pointer",
                          background: inPrompt?"var(--orange-soft)":"var(--surface)",
                          color: inPrompt?"var(--orange)":"var(--text-1)",
                          borderColor: inPrompt?"var(--orange-mid)":"var(--border)"}
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
              <div style={{marginTop:12,border:"1px solid var(--warn)",background:"var(--warn-soft)",borderRadius:"var(--r)",padding:12}}>
                <div style={{fontSize:11,fontWeight:600,color:"var(--warn)",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Pflicht-Mapping</div>
                <div style={{display:"grid",gap:8}}>
                  {requiredFields.map((field) => {
                    const current = draft.inputMappings?.[field] || "";
                    return (
                      <div key={field} style={{display:"grid",gridTemplateColumns:"180px 1fr",gap:10,alignItems:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:12,color:"var(--text-1)"}}>{`{${field}}`}</span>
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

            {/* ── Web Search & Multi-Crawl Pipeline ── */}
            <div style={{marginTop:16,border:"1px solid var(--border)",borderRadius:"var(--r)",overflow:"hidden",boxShadow:"0 1px 2px rgba(0,0,0,0.03)"}}>
              {/* Toggle header */}
              <button type="button"
                onClick={() => setDraft(d => {
                  const willEnable = !d.useWebSearch;
                  const initialSteps = willEnable && (!d.searchSteps || d.searchSteps.length === 0)
                    ? [{ id: "step_1", label: "Web-Suche / Impressum", query: d.searchQuery?.trim() || "{company_name} {city}", mode: "search" as const, depth: "snippet" as const, maxResults: 3 }]
                    : d.searchSteps;
                  return {
                    ...d,
                    useWebSearch: willEnable ? true : undefined,
                    searchSteps: initialSteps,
                    searchQuery: willEnable ? (d.searchQuery?.trim() || "{company_name} {city}") : undefined,
                  };
                })}
                style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:draft.useWebSearch?"var(--orange-soft)":"var(--bg)",border:"none",cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:13}}>🔍</span>
                <span style={{fontSize:11.5,fontWeight:600,color:draft.useWebSearch?"var(--orange)":"var(--text-2)",textTransform:"uppercase",letterSpacing:"0.04em",flex:1}}>
                  Web-Suche & Crawls vor LLM
                </span>
                <span style={{fontSize:11,padding:"2px 8px",borderRadius:"var(--rs)",background:draft.useWebSearch?"var(--orange)":"var(--border)",color:draft.useWebSearch?"#fff":"var(--text-2)",fontWeight:600}}>
                  {draft.useWebSearch ? "AN" : "AUS"}
                </span>
              </button>

              {draft.useWebSearch && (
                <div style={{padding:"14px 16px",background:"var(--surface)",borderTop:"1px solid var(--border)",display:"grid",gap:14}}>
                  {/* Presets Toolbar */}
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:10.5,fontWeight:600,color:"var(--text-3)",textTransform:"uppercase"}}>+ Schnell-Schritt hinzufügen:</span>
                    <button type="button"
                      onClick={() => {
                        const newStep = { id: `step_${Date.now()}`, label: "Impressum-Crawl", query: "{company_name} {city} Impressum", mode: "search" as const, depth: "page" as const, maxResults: 3 };
                        setDraft(d => ({ ...d, searchSteps: [...(d.searchSteps || []), newStep] }));
                      }}
                      style={{fontSize:10.5,padding:"3px 8px",borderRadius:"var(--rs)",background:"#fff",border:"1px solid var(--border)",color:"var(--text-1)",cursor:"pointer",fontWeight:500}}>
                      📄 Impressum
                    </button>
                    <button type="button"
                      onClick={() => {
                        const newStep = { id: `step_${Date.now()}`, label: "LinkedIn Entscheider", query: "\"{company_name}\" Geschäftsführer site:linkedin.com/in", mode: "search" as const, depth: "snippet" as const, maxResults: 3 };
                        setDraft(d => ({ ...d, searchSteps: [...(d.searchSteps || []), newStep] }));
                      }}
                      style={{fontSize:10.5,padding:"3px 8px",borderRadius:"var(--rs)",background:"#fff",border:"1px solid var(--border)",color:"var(--text-1)",cursor:"pointer",fontWeight:500}}>
                      💼 LinkedIn
                    </button>
                    <button type="button"
                      onClick={() => {
                        const newStep = { id: `step_${Date.now()}`, label: "Google Maps Treffer", query: "{company_name} {city}", mode: "maps" as const, depth: "snippet" as const, maxResults: 3 };
                        setDraft(d => ({ ...d, searchSteps: [...(d.searchSteps || []), newStep] }));
                      }}
                      style={{fontSize:10.5,padding:"3px 8px",borderRadius:"var(--rs)",background:"#fff",border:"1px solid var(--border)",color:"var(--text-1)",cursor:"pointer",fontWeight:500}}>
                      📍 Maps
                    </button>
                    <button type="button"
                      onClick={() => {
                        const newStep = { id: `step_${Date.now()}`, label: "Website Scrape", query: "{domain}", mode: "scrape_url" as const, depth: "page" as const, maxResults: 1 };
                        setDraft(d => ({ ...d, searchSteps: [...(d.searchSteps || []), newStep] }));
                      }}
                      style={{fontSize:10.5,padding:"3px 8px",borderRadius:"var(--rs)",background:"#fff",border:"1px solid var(--border)",color:"var(--text-1)",cursor:"pointer",fontWeight:500}}>
                      🌐 Website ({'{domain}'})
                    </button>
                  </div>

                  {/* Multiple Crawl Steps Cards */}
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {(draft.searchSteps && draft.searchSteps.length > 0 ? draft.searchSteps : [{
                      id: "step_1", label: "Web-Suche", query: draft.searchQuery || "{company_name} {city}", mode: "search" as const, depth: (draft.evidenceMode === "page" ? "page" : "snippet") as const, maxResults: draft.searchMaxResults || 3
                    }]).map((step, idx) => (
                      <div key={step.id || idx} style={{border:"1px solid var(--border)",borderRadius:"var(--r)",background:"#fff",padding:10,display:"grid",gap:8}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:10.5,fontWeight:700,background:"var(--orange-soft)",color:"var(--orange)",padding:"1px 6px",borderRadius:4}}>
                              #{idx + 1}
                            </span>
                            <input
                              value={step.label || `Schritt ${idx + 1}`}
                              onChange={e => {
                                const val = e.target.value;
                                setDraft(d => ({
                                  ...d,
                                  searchSteps: (d.searchSteps || []).map((s, i) => i === idx ? { ...s, label: val } : s)
                                }));
                              }}
                              style={{border:"none",fontWeight:600,fontSize:11.5,color:"var(--text-1)",background:"transparent",outline:"none",padding:0}}
                            />
                          </div>

                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            {/* Live Test Step Button */}
                            <button
                              type="button"
                              disabled={stepTestResults[step.id || String(idx)]?.loading}
                              onClick={async () => {
                                const stepKey = step.id || String(idx);
                                setStepTestResults(prev => ({ ...prev, [stepKey]: { loading: true } }));
                                try {
                                  const sampleRow = cellContext?.row?.data || {};
                                  const res = await apiFetch("/api/run/test-step", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      query: step.query,
                                      mode: step.mode,
                                      depth: step.depth,
                                      maxResults: step.maxResults,
                                      sampleData: sampleRow,
                                    })
                                  });
                                  const data = await res.json();
                                  if (data.ok) {
                                    setStepTestResults(prev => ({
                                      ...prev,
                                      [stepKey]: {
                                        loading: false,
                                        renderedQuery: data.renderedQuery,
                                        latencyMs: data.latencyMs,
                                        results: data.results || [],
                                        pageMarkdownSample: data.pageMarkdownSample,
                                      }
                                    }));
                                  } else {
                                    setStepTestResults(prev => ({
                                      ...prev,
                                      [stepKey]: { loading: false, error: data.error || "Fehler beim Schritt-Test" }
                                    }));
                                  }
                                } catch (err: any) {
                                  setStepTestResults(prev => ({
                                    ...prev,
                                    [stepKey]: { loading: false, error: err.message }
                                  }));
                                }
                              }}
                              style={{fontSize:10.5,padding:"3px 9px",borderRadius:4,background:"var(--orange-soft)",color:"var(--orange)",border:"1px solid var(--orange-mid)",cursor:"pointer",fontWeight:600}}>
                              {stepTestResults[step.id || String(idx)]?.loading ? "⏳ Testet…" : "▶ Schritt probetesten"}
                            </button>

                            {(draft.searchSteps || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDraft(d => ({ ...d, searchSteps: (d.searchSteps || []).filter((_, i) => i !== idx) }));
                                }}
                                style={{fontSize:11,color:"var(--danger)",background:"none",border:"none",cursor:"pointer",padding:"2px 4px"}}>
                                ✕
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Query Input */}
                        <div>
                          <input
                            value={step.query}
                            onChange={e => {
                              const val = e.target.value;
                              setDraft(d => ({
                                ...d,
                                searchSteps: (d.searchSteps || []).map((s, i) => i === idx ? { ...s, query: val } : s)
                              }));
                            }}
                            placeholder="z.B. {company_name} Impressum"
                            style={{...inp,fontFamily:"monospace",fontSize:11.5,padding:"5px 8px"}}
                          />
                        </div>

                        {/* Config Row: Mode & Depth */}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 90px",gap:8}}>
                          <div>
                            <select
                              value={step.mode}
                              onChange={e => {
                                const val = e.target.value as any;
                                setDraft(d => ({
                                  ...d,
                                  searchSteps: (d.searchSteps || []).map((s, i) => i === idx ? { ...s, mode: val } : s)
                                }));
                              }}
                              style={{...inp,fontSize:11,padding:"4px 6px"}}>
                              <option value="search">🌐 Google Web-Suche</option>
                              <option value="scrape_url">🕷 Direkte URL scrapen</option>
                              <option value="maps">📍 Google Maps Suche</option>
                            </select>
                          </div>

                          <div>
                            <select
                              value={step.depth}
                              onChange={e => {
                                const val = e.target.value as any;
                                setDraft(d => ({
                                  ...d,
                                  searchSteps: (d.searchSteps || []).map((s, i) => i === idx ? { ...s, depth: val } : s)
                                }));
                              }}
                              style={{...inp,fontSize:11,padding:"4px 6px"}}>
                              <option value="snippet">Snippets (schnell, günstig)</option>
                              <option value="page">Ganze Seite crawlen (Markdown)</option>
                            </select>
                          </div>

                          <div>
                            <select
                              value={step.maxResults || 3}
                              onChange={e => {
                                const val = Number(e.target.value);
                                setDraft(d => ({
                                  ...d,
                                  searchSteps: (d.searchSteps || []).map((s, i) => i === idx ? { ...s, maxResults: val } : s)
                                }));
                              }}
                              style={{...inp,fontSize:11,padding:"4px 6px"}}>
                              <option value={1}>1 Treffer</option>
                              <option value={3}>3 Treffer</option>
                              <option value={5}>5 Treffer</option>
                              <option value={10}>10 Treffer</option>
                            </select>
                          </div>
                        </div>

                        {/* Inline Rich Test Results Preview */}
                        {(() => {
                          const testRes = stepTestResults[step.id || String(idx)];
                          if (!testRes || testRes.loading) return null;

                          if (testRes.error) {
                            return (
                              <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"8px 10px",fontSize:11,color:"#dc2626"}}>
                                <strong>Fehler beim Schritt-Test:</strong> {testRes.error}
                              </div>
                            );
                          }

                          return (
                            <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:6,padding:"9px 11px",display:"grid",gap:6}}>
                              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:11}}>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <span style={{color:"#16a34a",fontWeight:700}}>✓ {testRes.results?.length ?? 0} Treffer gefunden</span>
                                  <span style={{color:"#94a3b8"}}>({testRes.latencyMs}ms)</span>
                                </div>
                                <span style={{fontFamily:"monospace",color:"#475569",fontSize:10.5,background:"#fff",padding:"1px 6px",borderRadius:4,border:"1px solid #cbd5e1"}}>
                                  Query: "{testRes.renderedQuery}"
                                </span>
                              </div>

                              {/* Hit Cards */}
                              <div style={{display:"grid",gap:4,maxHeight:220,overflowY:"auto"}}>
                                {testRes.results && testRes.results.length > 0 ? (
                                  testRes.results.map((hit, hIdx) => (
                                    <div key={hIdx} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:5,padding:"6px 8px",display:"grid",gap:2}}>
                                      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:6}}>
                                        <div style={{fontWeight:600,fontSize:11.5,color:"#0f172a",wordBreak:"break-word"}}>{hit.title || "Ohne Titel"}</div>
                                        {hit.url && (
                                          <a href={hit.url} target="_blank" rel="noreferrer" style={{fontSize:10.5,color:"#2563eb",textDecoration:"none",flexShrink:0}}>
                                            Link ↗
                                          </a>
                                        )}
                                      </div>
                                      <div style={{fontSize:10,color:"#64748b",fontFamily:"monospace",wordBreak:"break-all"}}>{hit.url}</div>
                                      {hit.snippet && (
                                        <div style={{fontSize:11,color:"#334155",lineHeight:1.35}}>{hit.snippet}</div>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  <div style={{fontSize:11,color:"#94a3b8",fontStyle:"italic"}}>Keine Ergebnisse für diese Suchanfrage.</div>
                                )}
                              </div>

                              {/* Scraped Markdown snippet if page depth */}
                              {testRes.pageMarkdownSample && (
                                <div style={{marginTop:4,borderTop:"1px solid #e2e8f0",paddingTop:4}}>
                                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",marginBottom:2}}>
                                    📄 Gecrawlter Seiteninhalt (Auszug für LLM):
                                  </div>
                                  <pre style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:4,padding:6,fontSize:10,fontFamily:"monospace",maxHeight:100,overflowY:"auto",whiteSpace:"pre-wrap",margin:0,color:"#334155"}}>
                                    {testRes.pageMarkdownSample}
                                  </pre>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>

                  {/* Add Step Button */}
                  <button
                    type="button"
                    onClick={() => {
                      const newStep = {
                        id: `step_${Date.now()}`,
                        label: `Recherche-Schritt ${(draft.searchSteps?.length || 1) + 1}`,
                        query: "{company_name}",
                        mode: "search" as const,
                        depth: "snippet" as const,
                        maxResults: 3,
                      };
                      setDraft(d => ({ ...d, searchSteps: [...(d.searchSteps || []), newStep] }));
                    }}
                    style={{padding:"6px 12px",borderRadius:"var(--rs)",border:"1px dashed var(--border)",background:"#fff",fontSize:11.5,fontWeight:600,color:"var(--orange)",cursor:"pointer",textAlign:"center"}}>
                    + Weiteren Recherche-Schritt hinzufügen
                  </button>

                  <div style={{fontSize:11.5,color:"var(--text-2)",lineHeight:1.5,background:"var(--bg)",padding:10,borderRadius:"var(--rs)",border:"1px solid var(--border)"}}>
                    Die Ergebnisse aller aktiven Recherche-Schritte werden als strukturierte Blöcke <strong>vor deinem Prompt</strong> in den Kontext eingefügt.
                  </div>
                </div>
              )}
            </div>

          {/* ── Reasoning capture ── */}
          <div style={{marginTop:12,border:"1px solid var(--border)",borderRadius:"var(--r)",overflow:"hidden",boxShadow:"0 1px 2px rgba(0,0,0,0.03)"}}>
            <button type="button"
              onClick={() => setDraft(d => ({...d, captureReasoning: d.captureReasoning ? undefined : true}))}
              style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:draft.captureReasoning?"var(--green-soft)":"var(--bg)",border:"none",cursor:"pointer",textAlign:"left"}}>
              <span style={{fontSize:13}}>🧠</span>
              <span style={{fontSize:11.5,fontWeight:600,color:draft.captureReasoning?"var(--green)":"var(--text-2)",textTransform:"uppercase",letterSpacing:"0.04em",flex:1}}>
                Reasoning erfassen
              </span>
              <span style={{fontSize:11,padding:"2px 8px",borderRadius:"var(--rs)",background:draft.captureReasoning?"var(--green)":"var(--border)",color:draft.captureReasoning?"#fff":"var(--text-2)",fontWeight:600}}>
                {draft.captureReasoning ? "AN" : "AUS"}
              </span>
            </button>
            {draft.captureReasoning && (
              <div style={{padding:"12px 16px",background:"var(--surface)",borderTop:"1px solid var(--border)",fontSize:11.5,color:"var(--text-2)",lineHeight:1.5}}>
                Das LLM gibt eine kurze Begründung seiner Antwort zurück (welche Quelle, warum, was abgelehnt). Wird als <code style={{background:"var(--bg)",padding:"1px 5px",borderRadius:3,border:"1px solid var(--border)",fontFamily:"monospace"}}>_reasoning_{draft.outputKey}</code> in der Zeile gespeichert.
              </div>
            )}
          </div>

          <div style={{marginTop:20,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
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
        </div>
      </div>
    </Modal>
  );
}


