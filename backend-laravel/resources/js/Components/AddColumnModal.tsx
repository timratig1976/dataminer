"use client";

import { useEffect, useId, useState } from "react";
import { Sparkles, Type, Hash } from "lucide-react";
import type { AiColumn, Case } from "@/types";
import { DEFAULT_MODEL_OPTIONS, mergeModelOptions } from "@/types/model-options";
import { Modal, FormField, Input, Select, Textarea } from "@/Components/ui/ModalMaster";

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

type ColType = "ai" | "text" | "number";

export function AddColumnModal({ caseId, onClose, onAdded, availableFields = [] }: Props) {
  const [presets, setPresets] = useState<Omit<AiColumn, "id">[]>([]);
  const [colType, setColType] = useState<ColType>("ai");
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [name, setName] = useState("");
  const [outputKey, setOutputKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL_OPTIONS[0] as string);
  const [condition, setCondition] = useState("");
  const [conditionField, setConditionField] = useState("");
  const [outputMode, setOutputMode] = useState<"text" | "json">("text");
  const [jsonKey, setJsonKey] = useState("");
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [inputMappings, setInputMappings] = useState<Record<string, string>>({});
  const [modelOptions, setModelOptions] = useState<string[]>([...DEFAULT_MODEL_OPTIONS]);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMaxResults, setSearchMaxResults] = useState(5);
  const [searchForceLayer, setSearchForceLayer] = useState<"" | "serpapi" | "duckduckgo" | "playwright">("" );
  const [evidenceMode, setEvidenceMode] = useState<"snippet" | "page" | "auto">("snippet");
  const [captureReasoning, setCaptureReasoning] = useState(false);
  const [crawlSources, setCrawlSources] = useState<Array<"domain"|"maps_details"|"maps_reviews">>([]);
  const [crawlReviewsMax, setCrawlReviewsMax] = useState(10);
  // Batch enrichment fields
  const [batchTool, setBatchTool] = useState<string | undefined>(undefined);
  const [batchOutputFields, setBatchOutputFields] = useState<string[]>([]);
  const [batchSearchContacts, setBatchSearchContacts] = useState(true);
  // batch_contacts config
  const [contactsMax, setContactsMax] = useState(3);
  const [contactsLinkedIn, setContactsLinkedIn] = useState(true);
  const [contactsImpressum, setContactsImpressum] = useState(true);
  const [saving, setSaving] = useState(false);
  const promptTextareaId = useId();

  useEffect(() => {
    fetch("/api/presets").then((r) => r.json()).then(setPresets);
  }, []);

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

  function applyPreset(p: Omit<AiColumn, "id">) {
    setMode("custom");
    setName(p.name);
    setOutputKey(p.outputKey);
    setPrompt(p.prompt);
    setModel(p.model || "openai/gpt-4o-mini");
    setCondition(p.condition || "");
    setConditionField(p.conditionField || "");
    setOutputMode(p.outputMode || "text");
    setJsonKey(p.jsonKey || "");
    setEvidenceMode(p.evidenceMode || "snippet");
    setBatchTool((p as { tool?: string }).tool || undefined);
    setBatchOutputFields(((p as { batchOutputFields?: string[] }).batchOutputFields) ?? []);
    setBatchSearchContacts(((p as { batchSearchContacts?: boolean }).batchSearchContacts) ?? true);
    setContactsMax((p as { batchContactsMax?: number }).batchContactsMax ?? 3);
    setContactsLinkedIn((p as { batchContactsLinkedIn?: boolean }).batchContactsLinkedIn ?? true);
    setContactsImpressum((p as { batchContactsImpressum?: boolean }).batchContactsImpressum ?? true);
    setCrawlSources((p as { crawlSources?: Array<"domain"|"maps_details"|"maps_reviews"> }).crawlSources ?? []);
    setCrawlReviewsMax((p as { crawlReviewsMax?: number }).crawlReviewsMax ?? 10);
    const nextRequired = p.requiredFields || [];
    setRequiredFields(nextRequired);
    const nextMappings: Record<string, string> = {};
    nextRequired.forEach((field) => {
      const presetMapping = p.inputMappings?.[field];
      if (presetMapping && availableFields.includes(presetMapping)) {
        nextMappings[field] = presetMapping;
      } else if (availableFields.includes(field)) {
        nextMappings[field] = field;
      } else {
        nextMappings[field] = "";
      }
    });
    setInputMappings(nextMappings);
  }

  // Default batch system prompts (mirrored from lib/batch-enrich.ts for preview)
  function getDefaultBatchEnrichPrompt() {
    const fields = batchOutputFields.length > 0 ? batchOutputFields
      : ["company_name","domain","phone","email","city","zip","industry","description","first_name","last_name","position","linkedin"];
    const fieldLines = fields.map(f => `  "${f}": "..."`).join(",\n");
    return `Du bist ein präziser Daten-Extraktions-Agent für Unternehmensprofile.
Analysiere die gegebenen Quellen (Website-Inhalt, Suchergebnisse) und extrahiere strukturierte Unternehmensdaten.

Antworte NUR mit JSON (kein Markdown, keine Erklärungen):
{
${fieldLines}
}

Regeln:
- Fehlende Felder: null (NICHT weglassen, NICHT raten)
- domain: nur Basis-Domain ohne http/https/www (z.B. "example.de")
- phone: internationales Format wenn möglich (z.B. "+49 381 454000")
- industry: kurze präzise Beschreibung
- description: 1-2 Sätze was das Unternehmen macht
- Ansprechpartner: nur wenn klar erkennbar`;
  }

  function getDefaultBatchContactsPrompt() {
    return `Du bist ein Kontaktdaten-Extraktions-Agent.
Analysiere Impressum, LinkedIn-Profile und Google-Suchergebnisse.

Antworte NUR mit JSON:
{
  "first_name": "Vorname des Ansprechpartners",
  "last_name": "Nachname",
  "position": "Position/Titel",
  "contact_email": "direkte Email (NICHT info@ oder kontakt@)",
  "contact_phone": "direkte Telefonnummer",
  "linkedin": "LinkedIn-Profil-URL"
}

Regeln:
- NUR persönliche Emails, keine generischen (info@, kontakt@, mail@)
- Bei mehreren Kontakten: Geschäftsführer/Inhaber bevorzugen`;
  }

  const [showBatchPrompt, setShowBatchPrompt] = useState(false);

  const isBatch = batchTool === "batch_enrich" || batchTool === "batch_contacts";
  const isPlacesSummary = batchTool === "places_summary";
  const isGmbCheck = batchTool === "gmb_check";
  const isPlain = colType === "text" || colType === "number";
  const hasMissingRequiredMappings = colType === "ai" && requiredFields.some((field) => !(inputMappings[field] || "").trim());
  const canSave = name.trim() !== "" && outputKey.trim() !== "" && (isPlain || isBatch || isPlacesSummary || isGmbCheck || prompt.trim() !== "") && !hasMissingRequiredMappings;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      if (colType === "text" || colType === "number") {
        const r = await fetch(`/api/cases/${caseId}/add-column`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: outputKey.trim() }),
        });
        if (!r.ok) throw new Error(`add-column failed: ${r.status} ${await r.text()}`);
        const updated = await fetch(`/api/cases/${caseId}`).then(r => r.json());
        onAdded(updated);
        return;
      }

      if (!prompt.trim() && !batchTool) return;
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
        requiredFields: requiredFields.length > 0 ? requiredFields : undefined,
        inputMappings: requiredFields.length > 0
          ? Object.fromEntries(requiredFields
              .map((field) => [field, (inputMappings[field] || "").trim()])
              .filter(([, mapped]) => mapped !== ""))
          : undefined,
        useWebSearch: useWebSearch || undefined,
        searchQuery: useWebSearch && searchQuery.trim() ? searchQuery.trim() : undefined,
        searchMaxResults: useWebSearch ? searchMaxResults : undefined,
        searchForceLayer: useWebSearch && searchForceLayer ? searchForceLayer : undefined,
        evidenceMode: useWebSearch && evidenceMode !== "snippet" ? evidenceMode : undefined,
        captureReasoning: captureReasoning || undefined,
        crawlSources: crawlSources.length > 0 ? crawlSources : undefined,
        crawlReviewsMax: crawlSources.includes("maps_reviews") ? crawlReviewsMax : undefined,
        // Batch enrichment fields
        ...(batchTool ? {
          tool: batchTool as AiColumn["tool"],
          batchOutputFields: batchOutputFields.length > 0 ? batchOutputFields : undefined,
          batchSearchContacts: batchSearchContacts || undefined,
          ...(batchTool === "batch_contacts" ? {
            batchContactsMax: contactsMax,
            batchContactsLinkedIn: contactsLinkedIn,
            batchContactsImpressum: contactsImpressum,
          } : {}),
        } : {}),
      };
      const caseRes = await fetch(`/api/cases/${caseId}`).then((r) => r.json());
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiColumns: [...(caseRes.aiColumns || []), newCol] }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
      const updated = await res.json();
      onAdded(updated);
    } catch (err) {
      console.error("[AddColumnModal] save error:", err);
      alert(`Fehler beim Speichern: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Spalte hinzufügen"
      icon={<Sparkles style={{ width: 15, height: 15 }} />}
      maxWidth="1060px"
      footer={
        <>
          <button onClick={onClose} className="btn-v2" style={{ padding: "7px 16px" }}>
            Abbrechen
          </button>
          <button
            onClick={save}
            disabled={saving || !canSave}
            className="btn-v2 btn-v2-primary"
            style={{ padding: "7px 20px" }}
          >
            {saving ? "Wird hinzugefügt…" : "Spalte hinzufügen"}
          </button>
        </>
      }
    >
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Primary type selection */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Spaltentyp wählen
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* Batch column */}
            <button
              type="button"
              onClick={() => { setColType("ai"); setBatchTool("batch_enrich"); setMode("preset"); }}
              className={`flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${colType === "ai" && isBatch ? "border-[var(--orange)] bg-[var(--orange-soft)] shadow-sm" : "border-[var(--border)] hover:border-[var(--orange-mid)] hover:bg-[var(--bg)]"}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">🚀</span>
                <span className="font-semibold text-sm text-[var(--text-1)]">Batch-Spalte</span>
              </div>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Scrapt Website & sucht Kontakte — 1 Aufruf füllt <strong>viele Felder</strong> gleichzeitig. Ideal für Firmendaten & Entscheider.
              </p>
              <div className="flex gap-1 flex-wrap mt-1">
                <span className="text-[10px] bg-[var(--surface)] text-[var(--orange)] border border-[var(--orange-mid)] px-2 py-0.5 rounded-full font-medium">Firmendaten</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--orange)] border border-[var(--orange-mid)] px-2 py-0.5 rounded-full font-medium">Entscheider</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--orange)] border border-[var(--orange-mid)] px-2 py-0.5 rounded-full font-medium">Multi-Feld</span>
              </div>
            </button>

            {/* Places summary column */}
            <button
              type="button"
              onClick={() => { setColType("ai"); setBatchTool("places_summary"); setMode("preset"); }}
              className={`flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${colType === "ai" && batchTool === "places_summary" ? "border-sky-500 bg-sky-50/60 shadow-sm" : "border-[var(--border)] hover:border-sky-300 hover:bg-[var(--bg)]"}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">📍</span>
                <span className="font-semibold text-sm text-[var(--text-1)]">Places-Auswertung</span>
              </div>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Wertet Maps-Daten aus dem Row aus — Adresse, Telefon, Kategorie, Rating. Per Prompt zu <strong>Fließtext oder JSON</strong>.
              </p>
              <div className="flex gap-1 flex-wrap mt-1">
                <span className="text-[10px] bg-[var(--surface)] text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full font-medium">Kein Scraping</span>
                <span className="text-[10px] bg-[var(--surface)] text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full font-medium">Maps-Daten</span>
                <span className="text-[10px] bg-[var(--surface)] text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full font-medium">Fließtext/JSON</span>
              </div>
            </button>

            {/* GMB Check column */}
            <button
              type="button"
              onClick={() => { setColType("ai"); setBatchTool("gmb_check"); setMode("preset"); if (!name) { setName("GMB Check"); setOutputKey("gmb_status"); } }}
              className={`flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${colType === "ai" && batchTool === "gmb_check" ? "border-[var(--green)] bg-[var(--green-soft)] shadow-sm" : "border-[var(--border)] hover:border-[var(--green-mid)] hover:bg-[var(--bg)]"}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">🗺️</span>
                <span className="font-semibold text-sm text-[var(--text-1)]">GMB Check</span>
              </div>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Prüft via Google Places, ob ein Maps-Profil existiert. Ergebnis: <strong>Kein Eintrag</strong>, <strong>Vorhanden</strong> oder <strong>Unbeansprucht</strong>.
              </p>
              <div className="flex gap-1 flex-wrap mt-1">
                <span className="text-[10px] bg-[var(--surface)] text-[var(--green)] border border-[var(--green-mid)] px-2 py-0.5 rounded-full font-medium">Google Places</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--green)] border border-[var(--green-mid)] px-2 py-0.5 rounded-full font-medium">Kein LLM</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--green)] border border-[var(--green-mid)] px-2 py-0.5 rounded-full font-medium">1 Feld</span>
              </div>
            </button>

            {/* AI column */}
            <button
              type="button"
              onClick={() => { setColType("ai"); setBatchTool(undefined); setMode("preset"); }}
              className={`flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${colType === "ai" && !isBatch && batchTool !== "places_summary" ? "border-[var(--green)] bg-[var(--green-soft)] shadow-sm" : "border-[var(--border)] hover:border-[var(--green-mid)] hover:bg-[var(--bg)]"}`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[var(--green)]" />
                <span className="font-semibold text-sm text-[var(--text-1)]">KI-Spalte</span>
              </div>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Eigener Prompt pro Zeile — liefert <strong>einen Wert</strong>. Optional mit Web-Suche. Frei konfigurierbar.
              </p>
              <div className="flex gap-1 flex-wrap mt-1">
                <span className="text-[10px] bg-[var(--surface)] text-[var(--green)] border border-[var(--green-mid)] px-2 py-0.5 rounded-full font-medium">Freier Prompt</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--green)] border border-[var(--green-mid)] px-2 py-0.5 rounded-full font-medium">Web-Suche</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--green)] border border-[var(--green-mid)] px-2 py-0.5 rounded-full font-medium">1 Feld</span>
              </div>
            </button>

            {/* Data column */}
            <button
              type="button"
              onClick={() => { setColType("text"); setBatchTool(undefined); }}
              className={`flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all cursor-pointer ${isPlain ? "border-zinc-400 bg-zinc-100/60 shadow-sm" : "border-[var(--border)] hover:border-zinc-300 hover:bg-[var(--bg)]"}`}
            >
              <div className="flex items-center gap-2">
                <Type className="w-5 h-5 text-[var(--text-2)]" />
                <span className="font-semibold text-sm text-[var(--text-1)]">Datenspalte</span>
              </div>
              <p className="text-xs text-[var(--text-2)] leading-relaxed">
                Leere Spalte für manuelle Eingabe oder als Ziel für Batch-Felder (Text oder Zahl).
              </p>
              <div className="flex gap-1 flex-wrap mt-1">
                <span className="text-[10px] bg-[var(--surface)] text-[var(--text-2)] border border-[var(--border)] px-2 py-0.5 rounded-full font-medium">Text</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--text-2)] border border-[var(--border)] px-2 py-0.5 rounded-full font-medium">Zahl</span>
                <span className="text-[10px] bg-[var(--surface)] text-[var(--text-2)] border border-[var(--border)] px-2 py-0.5 rounded-full font-medium">Manuell</span>
              </div>
            </button>
          </div>
        </div>

        {/* Data column subtype + inputs */}
        {isPlain && (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["text", "number"] as ColType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setColType(t)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-medium cursor-pointer transition-colors ${colType === t ? "border-[var(--orange)] bg-[var(--orange-soft)] text-[var(--orange)]" : "border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--bg)]"}`}
                >
                  {t === "text" ? <><Type className="w-3 h-3" /> Text</> : <><Hash className="w-3 h-3" /> Zahl</>}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Spaltenname">
                <Input
                  value={name}
                  onChange={e => { setName(e.target.value); if (!outputKey) setOutputKey(e.target.value.toLowerCase().replace(/\s+/g, "_")); }}
                  placeholder={colType === "number" ? "z.B. Mitarbeiter" : "z.B. Notizen"}
                />
              </FormField>
              <FormField label="Feldname (Key)">
                <Input
                  mono
                  value={outputKey}
                  onChange={e => setOutputKey(e.target.value)}
                  placeholder={colType === "number" ? "z.B. employees" : "z.B. notes"}
                />
              </FormField>
            </div>
          </div>
        )}

        {/* Name + key for AI cols */}
        {colType === "ai" && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Spaltenname">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="z.B. Website"
              />
            </FormField>
            <FormField label="Output Key">
              <Input
                mono
                value={outputKey}
                onChange={e => setOutputKey(e.target.value)}
                placeholder="z.B. website"
              />
            </FormField>
          </div>
        )}

        {/* AI column config */}
        {colType === "ai" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-3 items-end">
              <div className="flex gap-1 bg-[var(--bg)] border border-[var(--border)] p-1 rounded-md w-fit">
                <button
                  type="button"
                  onClick={() => setMode("preset")}
                  className={`px-3 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${mode === "preset" ? "bg-[var(--surface)] shadow-sm text-[var(--orange)] font-semibold" : "text-[var(--text-2)] hover:text-[var(--text-1)]"}`}
                >
                  {isBatch ? "Batch-Preset" : "Aus Vorlage"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("custom")}
                  className={`px-3 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${mode === "custom" ? "bg-[var(--surface)] shadow-sm text-[var(--orange)] font-semibold" : "text-[var(--text-2)] hover:text-[var(--text-1)]"}`}
                >
                  {isBatch ? "Anpassen" : "Eigener Prompt"}
                </button>
              </div>
              <FormField label="Modell">
                <Select value={model} onChange={e => setModel(e.target.value)}>
                  {mergeModelOptions([model], modelOptions).map(m => <option key={m}>{m}</option>)}
                </Select>
              </FormField>
            </div>

            {mode === "preset" ? (
              <div className="grid grid-cols-2 gap-2.5">
                {presets.map((p) => (
                  <button
                    key={p.outputKey}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="text-left border border-[var(--border)] rounded-xl p-3 hover:border-[var(--orange-mid)] hover:bg-[var(--orange-soft)] transition-colors cursor-pointer"
                  >
                    <div className="font-medium text-sm text-[var(--text-1)]">{p.name}</div>
                    <div className="text-xs text-[var(--text-3)] font-mono mt-0.5">→ {p.outputKey}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Places summary config */}
                {isPlacesSummary && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📍</span>
                      <div>
                        <div className="font-semibold text-sky-900 text-sm">Places-Auswertung</div>
                        <div className="text-xs text-sky-600">Liest Adresse, Telefon, Kategorie, Rating aus dem Row — kein Scraping nötig</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-sky-700 mb-1">Ausgabe-Format</div>
                      <div className="flex gap-2">
                        {(["text", "json"] as const).map(m => (
                          <button key={m} type="button" onClick={() => setOutputMode(m)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${outputMode === m ? "border-sky-500 bg-sky-100 text-sky-800" : "border-gray-200 text-gray-500 hover:border-sky-300"}`}>
                            {m === "text" ? "📝 Fließtext" : "{ } JSON"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <FormField label="Prompt / Aufgabe" hint="Leer lassen für Standard-Auswertung. Verfügbare Felder: address, phone, category, maps_rating, maps_reviews, city, zip">
                      <Textarea
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        rows={3}
                        placeholder={outputMode === "json"
                          ? 'z.B. "Extrahiere PLZ, Stadt und Telefon als JSON: {plz, city, phone}"'
                          : 'z.B. "Schreibe ein 2-Satz Firmenprofil auf Deutsch"'}
                      />
                    </FormField>
                    <div className="text-xs text-sky-700 bg-sky-100 rounded-lg p-2">
                      <strong>Ausgabe-Felder:</strong> {outputMode === "json" ? `${outputKey || "places_data"} → JSON-Objekt` : `${outputKey || "places_summary"} → Fließtext`}
                    </div>
                  </div>
                )}

                  {/* Batch contacts config */}
                  {batchTool === "batch_contacts" && (
                    <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">👤</span>
                        <div>
                          <div className="font-semibold text-blue-900 text-sm">Kontakt-Suche — Impressum + LinkedIn + Google</div>
                          <div className="text-xs text-blue-600">Scrapt /impressum, sucht auf LinkedIn und Google → findet Geschäftsführer, Inhaber, direkte Kontaktdaten</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs font-semibold text-blue-700 mb-1">Max. Kontakte</div>
                          <input type="number" min={1} max={5} value={contactsMax}
                            onChange={e => setContactsMax(Math.max(1, Math.min(5, Number(e.target.value))))}
                            className="w-full border border-blue-200 rounded-lg px-3 py-1.5 text-sm" />
                        </div>
                        <div className="flex flex-col gap-2 pt-1">
                          <label className="flex items-center gap-2 cursor-pointer text-sm text-blue-800">
                            <input type="checkbox" checked={contactsImpressum} onChange={e => setContactsImpressum(e.target.checked)} className="accent-blue-600" />
                            /impressum scrapen
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer text-sm text-blue-800">
                            <input type="checkbox" checked={contactsLinkedIn} onChange={e => setContactsLinkedIn(e.target.checked)} className="accent-blue-600" />
                            LinkedIn durchsuchen
                          </label>
                        </div>
                      </div>

                      <div className="bg-white/60 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                        <div><strong>Schreibt direkt in:</strong></div>
                        <div className="font-mono ml-2">first_name, last_name, position → Primärkontakt</div>
                        <div className="font-mono ml-2">contact_email, contact_phone, linkedin → Direkte Kontaktdaten</div>
                        <div className="font-mono ml-2">contact_1_*, contact_2_*, contact_3_* → Alle Kontakte indiziert</div>
                        <div className="mt-1 text-blue-500">💡 Generische Emails (info@, kontakt@) werden ignoriert — nur persönliche Emails werden gespeichert.</div>
                      </div>
                    </div>
                  )}

                  {/* GMB Check config */}
                  {batchTool === "gmb_check" && (
                    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🗺️</span>
                        <div>
                          <div className="font-semibold text-emerald-900 text-sm">GMB Check — Google Maps Profil prüfen</div>
                          <div className="text-xs text-emerald-700">Sucht über Google Places API nach dem Firmeneintrag und gibt den Status zurück.</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                          { label: "Kein Eintrag", desc: "Keine Ergebnisse gefunden", color: "bg-red-100 text-red-700 border-red-200" },
                          { label: "Vorhanden", desc: "Eintrag mit Website", color: "bg-green-100 text-green-700 border-green-200" },
                          { label: "Unbeansprucht", desc: "Eintrag ohne Website", color: "bg-amber-100 text-amber-700 border-amber-200" },
                        ].map(s => (
                          <div key={s.label} className={`rounded-lg border p-2 ${s.color}`}>
                            <div className="font-semibold text-xs">{s.label}</div>
                            <div className="text-[10px] mt-0.5 opacity-80">{s.desc}</div>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-emerald-700 bg-white rounded-lg border border-emerald-200 p-2">
                        <strong>Benötigte Felder:</strong> <code className="font-mono">company_name</code> + optional <code className="font-mono">city</code> / <code className="font-mono">domain</code><br />
                        <strong>API:</strong> <code className="font-mono">GOOGLE_PLACES_API_KEY</code> (bevorzugt) oder <code className="font-mono">SERP_API_KEY</code> als Fallback
                      </div>
                    </div>
                  )}

                  {/* Batch enrichment config — shown when preset is batch_enrich */}
                  {batchTool === "batch_enrich" && (
                    <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🚀</span>
                        <div>
                          <div className="font-semibold text-violet-900 text-sm">Batch Enrichment — 1 Crawl → alle Felder</div>
                          <div className="text-xs text-violet-600">Scrapt die Domain der Zeile + optional Kontaktsuche → 1 LLM-Call schreibt alle Felder gleichzeitig</div>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-violet-700 uppercase mb-1.5">Ziel-Felder (werden beschrieben)</div>
                        <div className="text-xs text-violet-600 mb-2">
                          Diese Keys müssen als Spalten existieren. Tipp: lege erst die Textspalten an, dann dieses Preset.
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {["company_name","domain","phone","email","city","zip","industry","description","first_name","last_name","position","linkedin"].map(f => {
                            const active = batchOutputFields.includes(f);
                            const exists = availableFields.includes(f);
                            return (
                              <button key={f} type="button"
                                onClick={() => setBatchOutputFields(prev =>
                                  prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
                                )}
                                className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                                  active
                                    ? exists
                                      ? "bg-green-100 border-green-300 text-green-800"
                                      : "bg-amber-100 border-amber-300 text-amber-800"
                                    : "bg-white border-gray-200 text-gray-400"
                                }`}
                                title={active && !exists ? "⚠ Spalte existiert noch nicht — lege sie zuerst an" : ""}
                              >
                                {active && exists ? "✓ " : active && !exists ? "⚠ " : ""}{f}
                              </button>
                            );
                          })}
                        </div>
                        {batchOutputFields.some(f => !availableFields.includes(f)) && (
                          <p className="text-xs text-amber-600 mt-1.5">
                            ⚠ Gelbe Felder sind noch keine Spalten — sie werden trotzdem befüllt, aber nicht als eigenständige Spalten angezeigt bis du sie anlegst.
                          </p>
                        )}
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer text-sm text-violet-800">
                        <input type="checkbox" checked={batchSearchContacts}
                          onChange={e => setBatchSearchContacts(e.target.checked)}
                          className="accent-violet-600" />
                        Kontaktsuche (LinkedIn / Impressum) — findet Vorname, Nachname, Position
                      </label>

                      <div className="bg-white/60 rounded-lg p-3 text-xs text-violet-700 space-y-0.5">
                        <div>💡 <strong>Empfehlung:</strong> Lege zuerst alle Zielfelder als <strong>Text-Spalten</strong> an:</div>
                        <div className="font-mono ml-4">domain, phone, email, city, industry, first_name, last_name, position</div>
                        <div>Dann dieses Preset hinzufügen → einmal „Alle ausführen" → fertig.</div>
                      </div>
                    </div>
                  )}

                  {/* Prompt — for batch tools show default preview; for normal tools show editable textarea */}
                  {isBatch ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">System-Prompt</label>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setShowBatchPrompt(v => !v)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100">
                            {showBatchPrompt ? "▲ Verstecken" : "▼ Standard anzeigen"}
                          </button>
                          {prompt.trim() && (
                            <button type="button" onClick={() => setPrompt("")}
                              className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100">
                              ↺ Standard wiederherstellen
                            </button>
                          )}
                        </div>
                      </div>
                      {prompt.trim() ? (
                        <div className="space-y-1">
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">✏️ Eigener Prompt aktiv — überschreibt den Standard</div>
                          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={8}
                            className="w-full border border-amber-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y" />
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">✓ Standard-Prompt wird verwendet — klicke auf den Prompt zum Anpassen</div>
                          {showBatchPrompt && (
                            <textarea
                              readOnly
                              value={batchTool === "batch_contacts" ? getDefaultBatchContactsPrompt() : getDefaultBatchEnrichPrompt()}
                              rows={12}
                              onClick={e => { setPrompt((e.target as HTMLTextAreaElement).value); }}
                              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono bg-gray-50 text-gray-500 resize-y cursor-pointer hover:border-green-300"
                              title="Klicken zum Übernehmen und Bearbeiten" />
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                  <div>
                    <p className="text-xs text-gray-400 mt-0.5 mb-1">Platzhalter: &#123;company_name&#125;, &#123;website&#125; usw.</p>
                    <textarea id={promptTextareaId} value={prompt} onChange={e => setPrompt(e.target.value)} rows={12}
                      placeholder="Find the official website domain for {company_name}..."
                      className="mt-1 w-full min-h-[320px] border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y" />
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
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    const ta = document.getElementById(promptTextareaId) as HTMLTextAreaElement | null;
                                    const placeholder = `{${f}}`;
                                    if (!ta) { setPrompt((prev) => prev + placeholder); return; }
                                    const start = ta.selectionStart ?? prompt.length;
                                    const end = ta.selectionEnd ?? prompt.length;
                                    const scrollTop = ta.scrollTop;
                                    const next = prompt.slice(0, start) + placeholder + prompt.slice(end);
                                    const nextCursor = start + placeholder.length;
                                    setPrompt(next);
                                    requestAnimationFrame(() => {
                                      const el = document.getElementById(promptTextareaId) as HTMLTextAreaElement | null;
                                      if (!el) return;
                                      el.focus({ preventScroll: true });
                                      el.setSelectionRange(nextCursor, nextCursor);
                                      el.scrollTop = scrollTop;
                                    });
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

                    {/* ── Web Search — inline under prompt ── */}
                    <div className="mt-2 border border-blue-200 rounded-lg overflow-hidden">
                      <button type="button"
                        onClick={() => { setUseWebSearch(v => !v); if (useWebSearch) setSearchQuery(""); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left border-none cursor-pointer"
                        style={{background: useWebSearch ? "#dbeafe" : "#f0f9ff"}}>
                        <span className="text-sm">🔍</span>
                        <span className="text-[11px] font-bold uppercase tracking-wide flex-1"
                          style={{color: useWebSearch ? "#1e40af" : "#64748b"}}>Web-Suche vor LLM</span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{background: useWebSearch ? "#2563eb" : "#e2e8f0", color: useWebSearch ? "#fff" : "#64748b"}}>
                          {useWebSearch ? "AN" : "AUS"}
                        </span>
                      </button>
                      {useWebSearch && (
                        <div className="p-3 bg-blue-50 grid gap-2">
                          <div>
                            <label className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Suchanfrage-Template</label>
                            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                              placeholder="z.B. {company_name} offizieller Webauftritt"
                              className="mt-1 w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>
                          {availableFields.length > 0 && (
                            <div className="flex flex-wrap gap-1 items-center">
                              <span className="text-[11px] text-gray-500">Felder:</span>
                              {availableFields.map(f => {
                                const inQuery = searchQuery.includes(`{${f}}`);
                                return (
                                  <button key={f} type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => setSearchQuery(q => q + `{${f}}`)}
                                    className="text-[11px] px-1.5 py-0.5 rounded font-mono border cursor-pointer"
                                    style={{
                                      background: inQuery ? "#dbeafe" : "#f9fafb",
                                      borderColor: inQuery ? "#93c5fd" : "#e5e7eb",
                                      color: inQuery ? "#1d4ed8" : "#374151",
                                    }}>
                                    {`{${f}}`}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Max. Ergebnisse</label>
                              <input type="number" min={1} max={10} value={searchMaxResults}
                                onChange={e => setSearchMaxResults(Math.max(1, Math.min(10, Number(e.target.value))))}
                                className="mt-1 w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Layer</label>
                              <select value={searchForceLayer} onChange={e => setSearchForceLayer(e.target.value as typeof searchForceLayer)}
                                className="mt-1 w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="">Auto (SerpAPI → DDG → Playwright)</option>
                                <option value="serpapi">Nur SerpAPI</option>
                                <option value="duckduckgo">Nur DuckDuckGo</option>
                                <option value="playwright">Nur Playwright</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Evidenz-Tiefe (Firecrawl)</label>
                            <select value={evidenceMode} onChange={e => setEvidenceMode(e.target.value as typeof evidenceMode)}
                              className="mt-1 w-full border border-blue-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                              <option value="snippet">Snippets (schnell, günstig)</option>
                              <option value="page">Ganze Seiten lesen (Firecrawl-Scrape)</option>
                              <option value="auto">Auto: erst Snippets, bei leerer Antwort Seiten lesen</option>
                            </select>
                          </div>
                          <p className="text-[11px] text-blue-600 leading-relaxed">
                            Suchergebnisse werden als Kontext <strong>vor deinem Prompt</strong> eingefügt. Platzhalter wie <code className="bg-blue-100 px-1 rounded">{"{company_name}"}</code> erzeugen zeilenspezifische Suchen.
                            <br />
                            <span className="text-blue-500">„Ganze Seiten" lädt die Top-2 Treffer per Firecrawl als Markdown ins Prompt — nötig für Infos, die nicht im Snippet stehen (Impressum, Adresse, Gründungsjahr …). Benötigt Eden-AI-Key. +1–3s pro Zeile.</span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* ── Reasoning capture ── */}
                  <div className="border border-purple-200 rounded-lg overflow-hidden">
                    <button type="button"
                      onClick={() => setCaptureReasoning(v => !v)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left border-none cursor-pointer"
                      style={{background: captureReasoning ? "#f3e8ff" : "#faf5ff"}}>
                      <span className="text-sm">🧠</span>
                      <span className="text-[11px] font-bold uppercase tracking-wide flex-1"
                        style={{color: captureReasoning ? "#6b21a8" : "#94a3b8"}}>Reasoning erfassen</span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                        style={{background: captureReasoning ? "#7c3aed" : "#e2e8f0", color: captureReasoning ? "#fff" : "#64748b"}}>
                        {captureReasoning ? "AN" : "AUS"}
                      </span>
                    </button>
                    {captureReasoning && (
                      <div className="px-3 py-2 text-[11px] text-purple-700" style={{background:"#faf5ff"}}>
                        LLM gibt eine kurze Begründung zurück (welche Quelle, warum, was abgelehnt). Gespeichert als <code className="bg-purple-100 px-1 rounded">_reasoning_{outputKey || "…"}</code>.
                      </div>
                    )}
                  </div>

                  {/* ── Crawl Sources ── */}
                  <div className="border border-orange-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-1.5 flex items-center gap-2" style={{background:"#fff7ed"}}>
                      <span className="text-sm">🕷</span>
                      <span className="text-[11px] font-bold uppercase tracking-wide text-orange-700 flex-1">Crawl-Quellen vor LLM</span>
                      <span className="text-[10px] text-orange-500">Optional — Apify + SerpAPI Kosten</span>
                    </div>
                    <div className="p-3 flex flex-col gap-2" style={{background:"#fffbf5"}}>
                      {(["domain", "maps_details", "maps_reviews"] as const).map(src => {
                        const labels: Record<string, string> = {
                          domain: "🌐 Website scrapen (domain-Feld)",
                          maps_details: "📍 Google Maps Details (Apify) — Öffnungszeiten, Fotos, Posts",
                          maps_reviews: "⭐ Google Maps Reviews (SerpAPI) — letzte Bewertungen + Inhaber-Antworten",
                        };
                        const active = crawlSources.includes(src);
                        return (
                          <label key={src} className="flex items-center gap-2 cursor-pointer text-[12px] text-gray-700">
                            <input type="checkbox" checked={active}
                              onChange={() => setCrawlSources(prev => active ? prev.filter(s => s !== src) : [...prev, src])}
                              style={{accentColor:"#ea580c"}}/>
                            {labels[src]}
                          </label>
                        );
                      })}
                      {crawlSources.includes("maps_reviews") && (
                        <div className="flex items-center gap-2 mt-1">
                          <label className="text-[11px] text-orange-700">Max. Reviews:</label>
                          <input type="number" min={3} max={20} value={crawlReviewsMax}
                            onChange={e => setCrawlReviewsMax(Number(e.target.value))}
                            className="w-16 border border-orange-300 rounded px-2 py-1 text-sm"/>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Output mode + JSON key */}
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

                  {/* Condition + Bindungsfeld */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Bedingung</label>
                      <select value={condition} onChange={e => { setCondition(e.target.value); if (!e.target.value) setConditionField(""); }}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                        {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Bindungsfeld</label>
                      <p className="text-[10px] text-gray-400 mt-0.5 mb-1">
                        Welches Tabellenfeld wird für die Bedingung geprüft? (z.B. "domain" → läuft nur wenn domain vorhanden/leer ist)
                      </p>
                      {availableFields.length > 0 ? (
                        <select value={conditionField} onChange={e => setConditionField(e.target.value)} disabled={!condition}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-40">
                          <option value="">= Ausgabefeld selbst ({outputKey || "…"})</option>
                          {availableFields.map((field) => (
                            <option key={field} value={field}>{field}</option>
                          ))}
                        </select>
                      ) : (
                        <input value={conditionField} onChange={e => setConditionField(e.target.value)}
                          placeholder={`Leer = prüft Ausgabefeld (${outputKey || "…"}) selbst`} disabled={!condition}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-40" />
                      )}
                    </div>
                  </div>

                  {/* Required field mappings */}
                  {requiredFields.length > 0 && (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                      <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide mb-2">Pflicht-Mapping</div>
                      <div className="grid gap-2">
                        {requiredFields.map((field) => (
                          <div key={field} className="grid grid-cols-[180px_1fr] items-center gap-2">
                            <span className="text-xs text-gray-700 font-mono">{`{${field}}`}</span>
                            <select
                              value={inputMappings[field] || ""}
                              onChange={(e) => setInputMappings((prev) => ({ ...prev, [field]: e.target.value }))}
                              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-green-500">
                              <option value="">Feld wählen…</option>
                              {availableFields.map((sourceField) => (
                                <option key={sourceField} value={sourceField}>{sourceField}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                      {hasMissingRequiredMappings && (
                        <div className="mt-2 text-xs text-amber-700">Bitte alle Pflichtfelder mappen, sonst wird der Prompt nicht ausgeführt.</div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </>
          )}
      </div>
    </Modal>
  );
}
