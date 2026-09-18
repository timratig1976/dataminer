"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";

interface MappingResult {
  originalKey: string;
  canonicalKey: string;
  confidence: "exact" | "alias" | "fuzzy" | "fallback";
  label: string;
}

interface PreviewResponse {
  format: string;
  rowCount: number;
  headers: string[];
  mapping: Record<string, MappingResult>;
  previewRows: Record<string, string | null>[];
  duplicateCount: number;
}

interface ImportWizardProps {
  caseId: string;
  onImported: (count: number) => void;
  onClose: () => void;
}

const CANONICAL_LABELS: Record<string, string> = {
  company_name: "Firmenname",
  domain: "Domain/Website",
  phone: "Telefon",
  email: "E-Mail",
  contact_name: "Ansprechpartner",
  address: "Adresse",
  city: "Stadt",
  zip: "PLZ",
  state: "Bundesland",
  country: "Land",
  linkedin: "LinkedIn",
  xing: "Xing",
  industry: "Branche",
  description: "Beschreibung",
  employees: "Mitarbeiter",
  revenue: "Umsatz",
  founded: "Gründungsjahr",
  first_name: "Vorname",
  last_name: "Nachname",
  position: "Position",
  source_url: "Quelle",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  exact: "text-green-600",
  alias: "text-blue-600",
  fuzzy: "text-yellow-600",
  fallback: "text-gray-400",
};

export default function ImportWizard({ caseId, onImported, onClose }: ImportWizardProps) {
  const [step, setStep] = useState<"upload" | "mapping" | "importing" | "done">("upload");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dedupeField, setDedupeField] = useState<"domain" | "none">("domain");
  const [skipDupes, setSkipDupes] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [existingColumns, setExistingColumns] = useState<string[]>([]);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmUsed, setLlmUsed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch existing case columns on mount
  useEffect(() => {
    fetch(`/api/cases/${caseId}`)
      .then((r) => r.json())
      .then((c) => {
        const cols: string[] = [];
        // colOrder has base column keys; aiColumns have outputKeys
        if (Array.isArray(c.colOrder)) cols.push(...c.colOrder);
        if (Array.isArray(c.aiColumns)) c.aiColumns.forEach((col: { outputKey: string }) => cols.push(col.outputKey));
        setExistingColumns([...new Set(cols)].filter((k) => !k.startsWith("_")));
      })
      .catch(() => {});
  }, [caseId]);

  // ── LLM mapping suggestion ───────────────────────────────────────────────

  const suggestLlmMapping = useCallback(async () => {
    if (!preview) return;
    setLlmLoading(true);
    try {
      const res = await fetch("/api/import/llm-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          headers: preview.headers,
          sampleRows: preview.previewRows,
          existingColumns,
        }),
      });
      const data = await res.json();
      if (res.ok && data.mapping) {
        setMapping((prev) => {
          const next = { ...prev };
          for (const [header, suggested] of Object.entries(data.mapping)) {
            if (typeof suggested === "string" && suggested.trim()) {
              next[header] = suggested;
            }
          }
          return next;
        });
        setLlmUsed(true);
      }
    } catch {
      // LLM mapping is optional — deterministic mapping still works
    } finally {
      setLlmLoading(false);
    }
  }, [caseId, preview, existingColumns]);

  // ── File handling ────────────────────────────────────────────────────────

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setError(null);
    setLoading(true);

    const fd = new FormData();
    fd.append("file", f);
    fd.append("caseId", caseId);

    try {
      const res = await fetch("/api/import/preview", { method: "POST", body: fd });
      const data: PreviewResponse = await res.json();
      if (!res.ok) { setError((data as { error?: string }).error ?? "Preview fehlgeschlagen"); return; }

      setPreview(data);
      // Initialize mapping from auto-detected
      const m: Record<string, string> = {};
      for (const [k, v] of Object.entries(data.mapping)) {
        m[k] = v.canonicalKey;
      }
      setMapping(m);
      setStep("mapping");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── Import ───────────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!file) return;
    setStep("importing");
    setError(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("caseId", caseId);
    fd.append("fieldMapping", JSON.stringify(mapping));
    fd.append("dedupeField", dedupeField);
    fd.append("skipDupes", skipDupes ? "true" : "false");

    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Import fehlgeschlagen"); setStep("mapping"); return; }
      setImportResult(data);
      setStep("done");
      onImported(data.imported);
    } catch (e) {
      setError(String(e));
      setStep("mapping");
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Step: Upload */}
      {step === "upload" && (
        <div>
          <div
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div className="text-3xl mb-2">📂</div>
            <p className="text-sm font-medium text-gray-700">CSV, XLSX oder JSON hierher ziehen</p>
            <p className="text-xs text-gray-400 mt-1">oder klicken zum Auswählen</p>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".csv,.xlsx,.xls,.json,.tsv,.txt"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
          {loading && <p className="text-sm text-center text-gray-500 mt-2">Datei wird analysiert…</p>}
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </div>
      )}

      {/* Step: Field Mapping */}
      {step === "mapping" && preview && (
        <div className="flex flex-col gap-4">
          {/* Stats bar */}
          <div className="flex items-center gap-4 text-sm bg-gray-50 rounded-lg px-3 py-2">
            <span className="font-medium">{file?.name}</span>
            <span className="text-gray-500">{preview.rowCount} Zeilen</span>
            <span className="text-gray-500 uppercase text-xs">{preview.format}</span>
            {preview.duplicateCount > 0 && (
              <span className="text-amber-600">⚠ {preview.duplicateCount} Duplikate erkannt</span>
            )}
          </div>

          {/* Field mapping table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase">Feld-Zuordnung</p>
              <button
                onClick={suggestLlmMapping}
                disabled={llmLoading}
                className="flex items-center gap-1.5 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-2.5 py-1.5 hover:bg-violet-100 disabled:opacity-50 transition-colors"
              >
                {llmLoading ? (
                  <>
                    <span className="animate-spin inline-block">⚙️</span> KI analysiert…
                  </>
                ) : llmUsed ? (
                  <>✓ KI-Vorschlag angewendet</>
                ) : (
                  <>✨ KI-Mapping vorschlagen</>
                )}
              </button>
            </div>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Spalte in Datei</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Beispiel</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Zuordnung</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Konfidenz</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((header) => {
                    const m = preview.mapping[header];
                    const currentMapping = mapping[header] ?? m?.canonicalKey ?? header;
                    const sampleValue = preview.previewRows[0]?.[header] ?? "";
                    return (
                      <tr key={header} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-gray-700 max-w-[140px] truncate" title={header}>{header}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 max-w-[120px] truncate" title={sampleValue}>
                          {sampleValue ? `"${sampleValue.slice(0, 40)}${sampleValue.length > 40 ? "…" : ""}"` : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className="text-sm border border-gray-200 rounded px-2 py-1 bg-white max-w-[200px]"
                            value={currentMapping}
                            onChange={(e) => setMapping((prev) => ({ ...prev, [header]: e.target.value }))}
                          >
                            <optgroup label="Kanonische Felder">
                              {Object.entries(CANONICAL_LABELS).map(([k, label]) => (
                                <option key={k} value={k}>{label} ({k})</option>
                              ))}
                            </optgroup>
                            {existingColumns.length > 0 && (
                              <optgroup label="Bestehende Spalten">
                                {existingColumns.map((k) => (
                                  <option key={k} value={k}>{CANONICAL_LABELS[k] ?? k} (vorhanden)</option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="Sonstige">
                              <option value={header.toLowerCase().replace(/[^a-z0-9]+/g, "_")}>
                                {header} (original beibehalten)
                              </option>
                            </optgroup>
                          </select>
                        </td>
                        <td className={`px-3 py-2 text-xs ${CONFIDENCE_COLORS[m?.confidence ?? "fallback"]}`}>
                          {m?.confidence === "exact" ? "✓ Exakt" :
                           m?.confidence === "alias" ? "✓ Alias" :
                           m?.confidence === "fuzzy" ? "~ Fuzzy" : "– Manuell"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Preview rows */}
          {preview.previewRows.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Vorschau (erste {preview.previewRows.length} Zeilen)</p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {preview.headers.slice(0, 6).map((h) => (
                        <th key={h} className="text-left px-2 py-1 text-gray-500 font-medium truncate max-w-[120px]">
                          {CANONICAL_LABELS[mapping[h]] ?? mapping[h] ?? h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {preview.headers.slice(0, 6).map((h) => (
                          <td key={h} className="px-2 py-1 text-gray-700 truncate max-w-[120px]">
                            {row[h] ?? <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dedupe options */}
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipDupes}
                onChange={(e) => setSkipDupes(e.target.checked)}
                className="rounded"
              />
              <span>Duplikate überspringen nach:</span>
            </label>
            <select
              className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
              value={dedupeField}
              onChange={(e) => setDedupeField(e.target.value as "domain" | "none")}
              disabled={!skipDupes}
            >
              <option value="domain">Domain/Website</option>
              <option value="none">Kein Dedupe</option>
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              className="btn-v2"
              onClick={() => { setStep("upload"); setFile(null); setPreview(null); }}
            >
              Zurück
            </button>
            <button
              className="btn-v2 btn-v2-primary px-4 py-2 text-sm font-medium"
              onClick={handleImport}
            >
              {preview.rowCount} Zeilen importieren
            </button>
          </div>
        </div>
      )}

      {/* Step: Importing */}
      {step === "importing" && (
        <div className="text-center py-8">
          <div className="text-3xl mb-3 animate-spin inline-block">⚙️</div>
          <p className="text-sm text-[var(--text-2)]">Importiere Daten…</p>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && importResult && (
        <div className="text-center py-6 flex flex-col items-center gap-3">
          <div className="text-4xl">✅</div>
          <p className="font-semibold text-[var(--text-1)]">{importResult.imported} Zeilen importiert</p>
          {importResult.skipped > 0 && (
            <p className="text-sm text-[var(--text-3)]">{importResult.skipped} Duplikate übersprungen</p>
          )}
          <button
            className="btn-v2 btn-v2-primary mt-2 px-5 py-2 text-sm font-medium"
            onClick={onClose}
          >
            Fertig
          </button>
        </div>
      )}
    </div>
  );
}
