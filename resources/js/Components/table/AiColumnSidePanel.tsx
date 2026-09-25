import { apiFetch } from "@/api";
"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Loader2,
  Save,
  Sparkles,
  Zap,
  Info,
  X,
  Maximize2,
  Minimize2,
  AlertTriangle,
  Code2,
  Sliders,
  Check,
  Plus,
  Trash2,
  Layers,
  ChevronRight,
} from "lucide-react";
import type { AiColumn, CellStatus } from "../../types";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "../../types/model-options";

export const COMMON_OUTPUT_FIELDS: { key: string; label: string; desc: string; category: "core" | "extended" | "contacts" }[] = [
  { key: "domain", label: "Website/Domain", desc: "Offizielle Domain der Firma", category: "core" },
  { key: "phone", label: "Telefon", desc: "Zentrale Telefonnummer", category: "core" },
  { key: "company_email", label: "Firmen-E-Mail", desc: "Allgemeine Kontakt-E-Mail", category: "core" },
  { key: "address", label: "Adresse", desc: "Straße & Hausnummer", category: "core" },
  { key: "city", label: "Stadt", desc: "Hauptsitz / Ort", category: "core" },
  { key: "zip", label: "PLZ", desc: "Postleitzahl", category: "core" },
  { key: "industry", label: "Branche", desc: "Konkrete Branche / Tätigkeitsfeld", category: "extended" },
  { key: "description", label: "Beschreibung", desc: "1-2 Sätze was die Firma anbietet", category: "extended" },
  { key: "employees", label: "Mitarbeiterzahl", desc: "Ungefähre Mitarbeitergröße", category: "extended" },
  { key: "founded", label: "Gründungsjahr", desc: "Jahr der Gründung", category: "extended" },
  { key: "first_name", label: "Vorname Entscheider", desc: "Geschäftsführer/Inhaber", category: "contacts" },
  { key: "last_name", label: "Nachname Entscheider", desc: "Geschäftsführer/Inhaber", category: "contacts" },
  { key: "position", label: "Position", desc: "z.B. Geschäftsführer / CEO", category: "contacts" },
  { key: "contact_email", label: "Direkte E-Mail", desc: "Persönliche Entscheider-E-Mail", category: "contacts" },
  { key: "linkedin", label: "LinkedIn Profil", desc: "LinkedIn URL der Firma oder Person", category: "contacts" },
];

export const PRESET_SETS: { id: string; name: string; desc: string; tool: AiColumn["tool"]; fields: string[]; prompt: string }[] = [
  {
    id: "batch_firmendaten",
    name: "🚀 Firmendaten-Paket (Basis)",
    desc: "Recherchiert Domain, Telefon, E-Mail, Adresse & PLZ/Stadt automatisch per Web-Crawl.",
    tool: "batch_company",
    fields: ["domain", "phone", "company_email", "address", "city", "zip"],
    prompt: "",
  },
  {
    id: "batch_firmendaten_extended",
    name: "🏢 Firmendaten erweitert (inkl. Branche & Größe)",
    desc: "Recherchiert Firmendaten plus Branche, Firmenbeschreibung, Mitarbeiterzahl & Gründungsjahr.",
    tool: "batch_company",
    fields: ["domain", "phone", "company_email", "address", "city", "zip", "industry", "description", "employees", "founded"],
    prompt: "",
  },
  {
    id: "batch_kontakte",
    name: "👤 Entscheider & Kontakte",
    desc: "Durchsucht Impressum & Web nach Geschäftsführern, Position & direkten E-Mails.",
    tool: "batch_contact",
    fields: ["first_name", "last_name", "position", "contact_email", "company_email", "linkedin"],
    prompt: "",
  },
  {
    id: "wz2008_industry",
    name: "🏷️ Branchen-Klassifikation (WZ 2008 / NACE)",
    desc: "Ordnet Unternehmen in die amtliche WZ 2008 Systematik ein (WZ-Code, WZ-Name, Hauptbranche & Tags).",
    tool: undefined,
    fields: ["industry_primary", "wz_code", "wz_name", "industry_tags", "b2b_b2c"],
    prompt: `Du bist Experte für die Klassifikation von Unternehmen nach dem amtlichen deutschen System "WZ 2008" (NACE Rev. 2).
Analysiere die Website-Inhalte von {company_name} ({domain}).

Antworte NUR mit JSON:
{
  "industry_primary": "Verständliche Hauptkategorie (z.B. IT & Software, Maschinenbau, Handwerk, Gastgewerbe)",
  "wz_code": "Exakter WZ 2008 Code (z.B. 62.01, 43.22, 55.10)",
  "wz_name": "Offizielle Bezeichnung des Wirtschaftszweigs",
  "industry_tags": "3-5 konkrete Angebotsschwerpunkte, kommagetrennt",
  "b2b_b2c": "B2B | B2C | Hybrid"
}`,
  },
  {
    id: "custom_ai",
    name: "✨ Individuelle KI-Recherche",
    desc: "Freier Prompt mit beliebigen Ausgabefeldern.",
    tool: undefined,
    fields: [],
    prompt: "",
  },
];

interface AiColumnSidePanelProps {
  col: AiColumn;
  caseId: string;
  onSave: (updated: AiColumn) => void;
  onClose: () => void;
  cellContext?: {
    rowId: string;
    value: string;
    status: CellStatus;
    error?: string;
    rowLabel?: string;
    multiValues?: Record<string, string>;
  };
  onRunCell?: () => void;
  onOpenRunDetail?: () => void;
  availableFields?: string[];
}

export function AiColumnSidePanel({
  col,
  caseId,
  onSave,
  onClose,
  cellContext,
  onRunCell,
  onOpenRunDetail,
  availableFields = [],
}: AiColumnSidePanelProps) {
  const [activeTab, setActiveTab] = useState<"configure" | "generate">("configure");
  const [draft, setDraft] = useState<AiColumn>({
    ...col,
    prompt: col.prompt ?? "",
    batchOutputFields: col.batchOutputFields ?? (col.tool === "batch_company" ? ["domain", "phone", "company_email", "address", "city", "zip", "industry", "description"] : []),
  });
  const [saving, setSaving] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([...DEFAULT_MODEL_OPTIONS]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [aiGenerateGoal, setAiGenerateGoal] = useState("");
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [newCustomOutputField, setNewCustomOutputField] = useState("");

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const isBatch = draft.tool === "batch_company" || draft.tool === "batch_contact";

  const applyPresetSet = (p: typeof PRESET_SETS[number]) => {
    setDraft((d) => ({
      ...d,
      name: d.name === "Neue KI-Spalte" || !d.name ? p.name : d.name,
      tool: p.tool,
      batchOutputFields: p.fields,
      prompt: p.prompt || d.prompt,
    }));
  };

  const toggleOutputField = (fieldKey: string) => {
    setDraft((d) => {
      const current = d.batchOutputFields || [];
      if (current.includes(fieldKey)) {
        return { ...d, batchOutputFields: current.filter((k) => k !== fieldKey) };
      } else {
        return { ...d, batchOutputFields: [...current, fieldKey] };
      }
    });
  };

  const addCustomOutputField = () => {
    const cleanKey = newCustomOutputField.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!cleanKey) return;
    setDraft((d) => {
      const current = d.batchOutputFields || [];
      if (current.includes(cleanKey)) return d;
      return { ...d, batchOutputFields: [...current, cleanKey] };
    });
    setNewCustomOutputField("");
  };

  useEffect(() => {
    apiFetch(`/api/llm/models?caseId=${caseId}`)
      .then((r) => r.json())
      .then((data) => {
        const next = Array.isArray(data?.models) ? data.models : [];
        setModelOptions(mergeModelOptions(next));
      })
      .catch(() => {});
  }, [caseId]);

  const insertFieldRef = (field: string) => {
    const placeholder = `{${field}}`;
    if (!promptRef.current) {
      setDraft((d) => ({ ...d, prompt: (d.prompt || "") + ` ${placeholder}` }));
      return;
    }
    const start = promptRef.current.selectionStart;
    const end = promptRef.current.selectionEnd;
    const prev = draft.prompt || "";
    const next = prev.substring(0, start) + placeholder + prev.substring(end);
    setDraft((d) => ({ ...d, prompt: next }));
    setTimeout(() => {
      if (promptRef.current) {
        promptRef.current.selectionStart = start + placeholder.length;
        promptRef.current.selectionEnd = start + placeholder.length;
        promptRef.current.focus();
      }
    }, 0);
  };

  const handleGeneratePromptWithAI = async () => {
    if (!aiGenerateGoal.trim()) return;
    setIsGeneratingPrompt(true);

    try {
      const res = await apiFetch(`/api/cases/${caseId}/generate-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: aiGenerateGoal,
          availableFields,
          outputKey: draft.outputKey,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.prompt) {
          setDraft((d) => ({ ...d, prompt: data.prompt }));
          setActiveTab("configure");
        }
      } else {
        // Fallback Client Prompt Generator
        const generated = `Analysiere die verfügbaren Daten (z. B. {company_name}, {domain}).
Finde präzise Informationen zu folgendem Ziel:
"${aiGenerateGoal}"

Antworte kurz und präzise als Klartext oder kurzes JSON.`;
        setDraft((d) => ({ ...d, prompt: generated }));
        setActiveTab("configure");
      }
    } catch {
      // Fallback
      const generated = `Finde für {company_name} folgende Information: ${aiGenerateGoal}.`;
      setDraft((d) => ({ ...d, prompt: generated }));
      setActiveTab("configure");
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`fixed top-0 right-0 h-full bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col transition-all duration-200 select-none ${
        isExpanded ? "w-[750px] max-w-full" : "w-[480px] max-w-[90vw]"
      }`}
      style={{
        boxShadow: "-10px 0 30px -10px rgba(0,0,0,0.15)",
      }}
    >
      {/* HEADER (Clay Style) */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-orange-100 text-orange-600 rounded-lg shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-slate-800 text-sm truncate flex items-center gap-1.5">
              <span>{draft.name || "KI-Spalte bearbeiten"}</span>
            </div>
            <div className="text-[10.5px] text-slate-400 font-mono truncate">
              Key: {draft.outputKey}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200/60 transition-colors"
            title={isExpanded ? "Verkleinern" : "Vergrößern"}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-200/60 transition-colors"
            title="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* TABS (Generate vs Configure wie bei Clay) */}
      <div className="flex border-b border-slate-200 px-4 pt-1 bg-white">
        <button
          type="button"
          onClick={() => setActiveTab("configure")}
          className={`py-2 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === "configure"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Konfiguration
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("generate")}
          className={`py-2 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
            activeTab === "generate"
              ? "border-orange-500 text-orange-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Sparkles className="w-3 h-3" />
          <span>Mit KI generieren</span>
        </button>
      </div>

      {/* CONTENT BODY */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {activeTab === "generate" ? (
          /* GENERATE TAB (Clay AI Builder) */
          <div className="space-y-4">
            <div className="bg-orange-50/60 border border-orange-200/80 p-3 rounded-xl text-orange-950">
              <h4 className="font-semibold text-xs mb-1 flex items-center gap-1.5 text-orange-900">
                <Sparkles className="w-3.5 h-3.5 text-orange-600" />
                Was soll die KI für diese Spalte recherchieren?
              </h4>
              <p className="text-[11px] text-slate-600">
                Beschreibe dein Ziel in einfachen Worten. Das System formuliert den Prompt automatisch
                und fügt passende Spalten-Referenzen ein.
              </p>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1 text-xs">
                Ziel-Beschreibung:
              </label>
              <textarea
                rows={4}
                value={aiGenerateGoal}
                onChange={(e) => setAiGenerateGoal(e.target.value)}
                placeholder="Z. B. Finde heraus, ob das Unternehmen ein B2B- oder B2C-Geschäftsmodell hat und wer der verantwortliche Ansprechpartner ist..."
                className="w-full p-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-orange-500 bg-white shadow-2xs text-xs"
              />
            </div>

            <button
              type="button"
              onClick={handleGeneratePromptWithAI}
              disabled={isGeneratingPrompt || !aiGenerateGoal.trim()}
              className="w-full py-2 px-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg shadow-2xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isGeneratingPrompt ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Prompt wird generiert...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Prompt & Konfiguration generieren</span>
                </>
              )}
            </button>
          </div>
        ) : (
          /* CONFIGURE TAB */
          <div className="space-y-4">
            {/* Clay Style: Presets Schnell-Auswahl */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-orange-500" />
                  <span>Spalten-Paket / Vorlage:</span>
                </span>
                <span className="text-[10px] text-slate-400">Clay Presets</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {PRESET_SETS.map((p) => {
                  const isSelected = draft.tool === p.tool && (!p.fields.length || (draft.batchOutputFields && draft.batchOutputFields.length === p.fields.length));
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPresetSet(p)}
                      className={`text-left p-2 rounded-lg border transition-all flex items-start justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? "bg-orange-50/70 border-orange-300 text-orange-950 font-medium"
                          : "bg-white border-slate-200 hover:border-slate-300 text-slate-700"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold flex items-center gap-1">
                          <span>{p.name}</span>
                        </div>
                        <div className="text-[10.5px] text-slate-500 line-clamp-1">{p.desc}</div>
                      </div>
                      {p.fields.length > 0 && (
                        <span className="text-[9.5px] bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono shrink-0">
                          {p.fields.length} Felder
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Spalten-Name */}
            <div>
              <label className="block font-medium text-slate-700 mb-1">Spalten-Titel (Name):</label>
              <input
                type="text"
                value={draft.name || ""}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-orange-500 bg-white"
              />
            </div>

            {/* Clay Style: DEFINE OUTPUTS (Ausgabe-Felder definieren) */}
            <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <h4 className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-orange-500" />
                    <span>Ausgabespalten definieren (Define Outputs)</span>
                  </h4>
                  <p className="text-[10.5px] text-slate-500">
                    Diese Spalten werden mit den extrahierten Daten befüllt.
                  </p>
                </div>
                <span className="text-[10px] font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                  {(draft.batchOutputFields || []).length} aktiv
                </span>
              </div>

              {/* Checkboxen für Standard-Felder */}
              <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                {COMMON_OUTPUT_FIELDS.map((f) => {
                  const isChecked = (draft.batchOutputFields || []).includes(f.key);
                  const alreadyInTable = availableFields.includes(f.key);

                  return (
                    <label
                      key={f.key}
                      className={`flex items-center justify-between p-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                        isChecked ? "bg-orange-50/50 text-slate-900" : "hover:bg-slate-50 text-slate-600"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleOutputField(f.key)}
                          className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                        />
                        <span className="font-medium truncate">{f.label}</span>
                        <span className="text-[10px] text-slate-400 font-mono">({f.key})</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {alreadyInTable ? (
                          <span className="text-[9px] bg-slate-100 text-slate-500 border border-slate-200 px-1 rounded">
                            Bereits in Tabelle
                          </span>
                        ) : (
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1 rounded font-medium">
                            + Neue Spalte
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Benutzerdefiniertes Ausgabefeld hinzufügen */}
              <div className="pt-2 border-t border-slate-100 flex gap-1.5 items-center">
                <input
                  type="text"
                  placeholder="Z. B. branch_category oder umsatz"
                  value={newCustomOutputField}
                  onChange={(e) => setNewCustomOutputField(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomOutputField();
                    }
                  }}
                  className="px-2 py-1 border border-slate-200 rounded text-xs flex-1 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
                <button
                  type="button"
                  onClick={addCustomOutputField}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded text-xs transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Hinzufügen</span>
                </button>
              </div>
            </div>

            {/* Model-Auswahl */}
            <div>
              <label className="block font-medium text-slate-700 mb-1">KI-Modell:</label>
              <select
                value={draft.model || "openai/gpt-4o-mini"}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-1 focus:ring-orange-500 bg-white"
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Prompt Editor mit Spalten-Pills */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-slate-700">Prompt (optional bei Batch-Spalten):</label>
                <span className="text-[10px] text-slate-400">Verwende {'{Feld}'} für Referenzen</span>
              </div>

              {/* Spalten-Pills zur schnellen Insertion */}
              {availableFields.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2 max-h-20 overflow-y-auto p-1.5 bg-slate-50 border border-slate-100 rounded-lg">
                  {availableFields.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => insertFieldRef(f)}
                      className="px-1.5 py-0.5 bg-white border border-slate-200 hover:border-orange-300 hover:bg-orange-50 text-slate-700 rounded text-[10px] font-mono transition-colors"
                      title={`Feld {${f}} einfügen`}
                    >
                      +{f}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                ref={promptRef}
                rows={isExpanded ? 10 : 6}
                value={draft.prompt || ""}
                onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                className="w-full p-2.5 border border-slate-200 rounded-lg text-slate-800 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-orange-500 bg-white shadow-2xs leading-relaxed"
                placeholder="Schreibe deinen Prompt hier..."
              />
            </div>

            {/* Run-Settings (Clay Style) */}
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-3">
              <h4 className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                Ausführungs-Einstellungen (Run Settings)
              </h4>

              {/* Auto-Run Toggle */}
              <label className="flex items-center justify-between cursor-pointer p-1.5 rounded-lg hover:bg-white transition-colors">
                <div>
                  <div className="font-medium text-slate-800">Auto-Run (automatisch ausführen)</div>
                  <div className="text-[10.5px] text-slate-500">
                    Wird automatisch ausgeführt, wenn die Bedingungen erfüllt sind
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.autoRun !== false}
                  onChange={(e) => setDraft((d) => ({ ...d, autoRun: e.target.checked }))}
                  className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                />
              </label>

              {/* Bedingung */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  Bedingung (optional):
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={draft.conditionField || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, conditionField: e.target.value || undefined }))}
                    className="p-1.5 bg-white border border-slate-200 rounded text-xs"
                  >
                    <option value="">Keine Bedingung</option>
                    {availableFields.map((f) => (
                      <option key={f} value={f}>
                        Feld: {f}
                      </option>
                    ))}
                  </select>

                  <select
                    value={draft.conditionOperator || "not_empty"}
                    onChange={(e) => setDraft((d) => ({ ...d, conditionOperator: e.target.value as any }))}
                    className="p-1.5 bg-white border border-slate-200 rounded text-xs"
                    disabled={!draft.conditionField}
                  >
                    <option value="not_empty">ist befüllt</option>
                    <option value="empty">ist leer</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Test Cell Context Action */}
            {cellContext && (
              <div className="border border-orange-200 bg-orange-50/40 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-orange-950 text-xs">Aktive Zelle testen:</span>
                  <span className="text-[10.5px] font-mono text-slate-500">
                    {cellContext.rowLabel || `Zeile #${cellContext.rowId}`}
                  </span>
                </div>
                <div className="flex gap-2">
                  {onRunCell && (
                    <button
                      type="button"
                      onClick={onRunCell}
                      className="px-2.5 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded font-semibold flex items-center gap-1 shadow-2xs"
                    >
                      <Play className="w-3 h-3 fill-white" />
                      <span>Diese Zelle ausführen</span>
                    </button>
                  )}
                  {onOpenRunDetail && (
                    <button
                      type="button"
                      onClick={onOpenRunDetail}
                      className="px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded font-medium"
                    >
                      Debug-Log öffnen
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FOOTER ACTIONS */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium rounded-lg transition-colors cursor-pointer"
        >
          Abbrechen
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Speichern...</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>Speichern</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
