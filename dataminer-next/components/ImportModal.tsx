"use client";

import { useState, useRef } from "react";
import { X, Upload, FileText, Loader2 } from "lucide-react";
import Papa from "papaparse";

interface Props {
  caseId: string;
  onClose: () => void;
  onImported: () => void;
}

export function ImportModal({ caseId, onClose, onImported }: Props) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data);
        setHeaders(result.meta.fields ?? []);
      },
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function doImport() {
    if (rows.length === 0) return;
    setImporting(true);
    await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, rows }),
    });
    setImporting(false);
    onImported();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-violet-500" />
            <h3 className="font-semibold text-gray-900">Import CSV</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-colors"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {fileName ? (
              <div className="flex items-center justify-center gap-2 text-violet-600">
                <FileText className="w-5 h-5" />
                <span className="font-medium text-sm">{fileName}</span>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Drop a CSV here or click to browse</p>
              </>
            )}
          </div>

          {headers.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs font-medium text-gray-500 mb-2">
                {rows.length} rows · {headers.length} columns detected
              </div>
              <div className="flex flex-wrap gap-1">
                {headers.map((h) => (
                  <span key={h} className="bg-white border border-gray-200 text-xs text-gray-600 px-2 py-0.5 rounded-md">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button
            onClick={doImport}
            disabled={rows.length === 0 || importing}
            className="flex-1 bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            {importing ? "Importing…" : `Import ${rows.length} rows`}
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
