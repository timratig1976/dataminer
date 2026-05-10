"use client";

import { useEffect, useRef, useState } from "react";
import { X, Sparkles, Type, Hash } from "lucide-react";
import type { AiColumn, Case } from "@/lib/types";

const randomUUID = () => globalThis.crypto.randomUUID();

interface Props {
  caseId: string;
  onClose: () => void;
  onAdded: (updated: Case) => void;
  availableFields?: string[];
}

const CONDITIONS = [
  { value: "", label: "Immer ausführen" },
  { value: "require_input", label: "Nur wenn Eingabefeld vorhanden" },
  { value: "empty", label: "Nur wenn Ausgabefeld leer (kein Re-Run)" },
  { value: "not_empty", label: "Nur wenn Ausgabefeld befüllt" },
];

const MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"];

type ColType = "ai" | "text" | "number";

export function AddColumnModal({ caseId, onClose, onAdded, availableFields = [] }: Props) {
  const [presets, setPresets] = useState<Omit<AiColumn, "id">[]>([]);
  const [colType, setColType] = useState<ColType>("ai");
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [name, setName] = useState("");
  const [outputKey, setOutputKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [condition, setCondition] = useState("");
  const [conditionField, setConditionField] = useState("");
  const [outputMode, setOutputMode] = useState<"text" | "json">("text");
  const [jsonKey, setJsonKey] = useState("");
  const [saving, setSaving] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/presets").then((r) => r.json()).then(setPresets);
  }, []);

  function applyPreset(p: Omit<AiColumn, "id">) {
    setName(p.name);
    setOutputKey(p.outputKey);
    setPrompt(p.prompt);
    setModel(p.model || "gpt-4o-mini");
    setCondition(p.condition || "");
    setConditionField(p.conditionField || "");
    setOutputMode(p.outputMode || "text");
    setJsonKey(p.jsonKey || "");
    setMode("custom");
  }

  const isPlain = colType === "text" || colType === "number";
  const canSave = name.trim() !== "" && outputKey.trim() !== "" && (isPlain || prompt.trim() !== "");

  async function save() {
    if (!canSave) return;
    setSaving(true);

    if (colType === "text" || colType === "number") {
      // Add plain column to all rows
      await fetch(`/api/cases/${caseId}/add-column`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: outputKey.trim() }),
      });
      // Return updated case (no change to aiColumns)
      const updated = await fetch(`/api/cases/${caseId}`).then(r => r.json());
      setSaving(false);
      onAdded(updated);
      return;
    }

    if (!prompt.trim()) { setSaving(false); return; }
    const newCol: AiColumn = {
      id: randomUUID(),
      name: name.trim(),
      outputKey: outputKey.trim(),
      prompt: prompt.trim(),
      model,
      outputMode,
      jsonKey: outputMode === "json" ? jsonKey.trim() || undefined : undefined,
      condition: (condition || undefined) as AiColumn["condition"],
      conditionField: conditionField || undefined,
    };
    const caseRes = await fetch(`/api/cases/${caseId}`).then((r) => r.json());
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiColumns: [...(caseRes.aiColumns || []), newCol] }),
    });
    const updated = await res.json();
    setSaving(false);
    onAdded(updated);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-green-600" />
            <h3 className="font-semibold text-gray-900">Spalte hinzufügen</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Column type */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Spaltentyp</div>
            <div className="flex gap-2">
              {(["ai", "text", "number"] as ColType[]).map(t => (
                <button key={t} onClick={() => { setColType(t); }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${colType === t ? "border-green-500 bg-green-50 text-green-700" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                  {t === "ai" && <Sparkles className="w-3.5 h-3.5" />}
                  {t === "text" && <Type className="w-3.5 h-3.5" />}
                  {t === "number" && <Hash className="w-3.5 h-3.5" />}
                  {t === "ai" ? "KI-Spalte" : t === "text" ? "Text" : "Zahl"}
                </button>
              ))}
            </div>
          </div>

          {/* Plain column: name + key only */}
          {isPlain && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Spaltenname</label>
                <input value={name}
                  onChange={e => { setName(e.target.value); if (!outputKey) setOutputKey(e.target.value.toLowerCase().replace(/\s+/g, "_")); }}
                  placeholder={colType === "number" ? "z.B. Mitarbeiter" : "z.B. Notizen"}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Feldname (Key)</label>
                <input value={outputKey} onChange={e => setOutputKey(e.target.value)}
                  placeholder={colType === "number" ? "z.B. employees" : "z.B. notes"}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
          )}

          {/* AI column */}
          {colType === "ai" && (
            <>
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
                <button onClick={() => setMode("preset")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === "preset" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                  Aus Vorlage
                </button>
                <button onClick={() => setMode("custom")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === "custom" ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
                  Eigener Prompt
                </button>
              </div>

              {mode === "preset" ? (
                <div className="grid grid-cols-2 gap-2">
                  {presets.map((p) => (
                    <button key={p.outputKey} onClick={() => applyPreset(p)}
                      className="text-left border border-gray-200 rounded-xl p-3 hover:border-green-300 hover:bg-green-50 transition-colors">
                      <div className="font-medium text-sm text-gray-900">{p.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">→ {p.outputKey}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Spaltenname</label>
                      <input value={name} onChange={e => setName(e.target.value)} placeholder="z.B. Website"
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Output Key</label>
                      <input value={outputKey} onChange={e => setOutputKey(e.target.value)} placeholder="z.B. website"
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Prompt</label>
                    <p className="text-xs text-gray-400 mt-0.5 mb-1">Platzhalter: &#123;company_name&#125;, &#123;website&#125; usw.</p>
                    <textarea ref={promptRef} value={prompt} onChange={e => setPrompt(e.target.value)} rows={6}
                      placeholder="Find the official website domain for {company_name}..."
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y" />
                    {availableFields.length > 0 && (() => {
                      const used = [...new Set((prompt.match(/\{([^}]+)\}/g)||[]).map(m=>m.slice(1,-1).trim()))];
                      const matched = used.filter(p => availableFields.includes(p));
                      const unmatched = used.filter(p => !availableFields.includes(p));
                      return (
                        <div style={{marginTop:6,display:"grid",gap:5}}>
                          {(matched.length > 0 || unmatched.length > 0) && (
                            <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                              {matched.map(p => <span key={p} style={{fontSize:11,padding:"1px 7px",borderRadius:4,background:"#dcfce7",color:"#15803d",fontFamily:"monospace"}}>{`{${p}}`} ✓</span>)}
                              {unmatched.map(p => <span key={p} style={{fontSize:11,padding:"1px 7px",borderRadius:4,background:"#fee2e2",color:"#dc2626",fontFamily:"monospace"}}>{`{${p}}`} ✗</span>)}
                            </div>
                          )}
                          <div style={{display:"flex",flexWrap:"wrap",gap:3,alignItems:"center"}}>
                            <span style={{fontSize:11,color:"#6b7280"}}>Verfügbare Felder:</span>
                            {availableFields.map(f => {
                              const inPrompt = prompt.includes(`{${f}}`);
                              return (
                                <button key={f} type="button"
                                  onClick={() => {
                                    const ta = promptRef.current;
                                    if (!ta) return;
                                    const start = ta.selectionStart ?? prompt.length;
                                    const end = ta.selectionEnd ?? prompt.length;
                                    const ins = `{${f}}`;
                                    const next = prompt.slice(0, start) + ins + prompt.slice(end);
                                    setPrompt(next);
                                    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + ins.length, start + ins.length); }, 0);
                                  }}
                                  style={{fontSize:11,padding:"1px 7px",borderRadius:4,border:"1px solid",fontFamily:"monospace",cursor:"pointer",
                                    background: inPrompt ? "#f0fdf4" : "#f9fafb",
                                    borderColor: inPrompt ? "#86efac" : "#e5e7eb",
                                    color: inPrompt ? "#15803d" : "#374151"}}>
                                  {`{${f}}`}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Output-Modus</label>
                      <select value={outputMode} onChange={e => setOutputMode(e.target.value as "text" | "json")}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        <option value="text">Text</option>
                        <option value="json">JSON — Key extrahieren</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">JSON Key</label>
                      <input value={jsonKey} onChange={e => setJsonKey(e.target.value)} placeholder="z.B. domain"
                        disabled={outputMode !== "json"}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-40" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Modell</label>
                      <select value={model} onChange={e => setModel(e.target.value)}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        {MODELS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Bedingung</label>
                      <select value={condition} onChange={e => setCondition(e.target.value)}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Bedingungsfeld</label>
                      <input value={conditionField} onChange={e => setConditionField(e.target.value)}
                        placeholder="z.B. company_name" disabled={!condition}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-40" />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button onClick={save} disabled={saving || !canSave}
            className="flex-1 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40">
            {saving ? "Wird hinzugefügt…" : "Spalte hinzufügen"}
          </button>
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
