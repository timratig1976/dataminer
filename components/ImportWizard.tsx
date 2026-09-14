"use client";

import React, { useState, useRef, useCallback } from "react";

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
  const fileRef = useRef<HTMLInputElement>(null);

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
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Feld-Zuordnung</p>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Spalte in Datei</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Zuordnung</th>
                    <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium">Konfidenz</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((header) => {
                    const m = preview.mapping[header];
                    const currentMapping = mapping[header] ?? m?.canonicalKey ?? header;
                    return (
                      <tr key={header} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{header}</td>
                        <td className="px-3 py-2">
                          <select
                            className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
                            value={currentMapping}
                            onChange={(e) => setMapping((prev) => ({ ...prev, [header]: e.target.value }))}
                          >
                            {Object.entries(CANONICAL_LABELS).map(([k, label]) => (
                              <option key={k} value={k}>{label} ({k})</option>
                            ))}
                            <option value={header.toLowerCase().replace(/[^a-z0-9]+/g, "_")}>
                              {header} (original)
                            </option>
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
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              onClick={() => { setStep("upload"); setFile(null); setPreview(null); }}
            >
              Zurück
            </button>
            <button
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
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
          <p className="text-sm text-gray-600">Importiere Daten…</p>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && importResult && (
        <div className="text-center py-6 flex flex-col items-center gap-3">
          <div className="text-4xl">✅</div>
          <p className="font-semibold text-gray-800">{importResult.imported} Zeilen importiert</p>
          {importResult.skipped > 0 && (
            <p className="text-sm text-gray-500">{importResult.skipped} Duplikate übersprungen</p>
          )}
          <button
            className="mt-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            onClick={onClose}
          >
            Fertig
          </button>
        </div>
      )}
    </div>
  );
}
