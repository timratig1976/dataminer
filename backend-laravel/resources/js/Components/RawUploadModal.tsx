import React, { useState, useRef } from 'react';
import { UploadCloud, X, AlertCircle } from 'lucide-react';

interface RawUploadModalProps {
  onClose: () => void;
  onSuccess: (batchId: string) => void;
}

export default function RawUploadModal({ onClose, onSuccess }: RawUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) {
      setFile(f);
      if (!label) setLabel(f.name);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!label) setLabel(f.name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);

    const fd = new FormData();
    fd.append('file', file);
    if (label) fd.append('label', label);

    try {
      const res = await fetch('/api/raw-imports', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
        body: fd,
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`Server antwortete nicht mit JSON (${res.status}): ${text.substring(0, 120)}`);
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Upload fehlgeschlagen');
      }
      onSuccess(data.batch_id);
    } catch (err: any) {
      setError(err.message || 'Fehler beim Hochladen.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="font-semibold text-gray-900 text-sm">Rohdaten-Batch hochladen</h3>
          <button onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Batch Bezeichnung (optional)</label>
            <input
              type="text"
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
              placeholder="z.B. Hotelkontakte Bayern 2026"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              dragging ? 'border-amber-500 bg-amber-50/50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
            }`}
          >
            <UploadCloud className="w-8 h-8 mx-auto text-gray-400 mb-2" />
            <p className="text-xs font-medium text-gray-700">
              {file ? file.name : 'CSV, XLSX oder ODS Datei hierher ziehen'}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              {file ? `${(file.size / 1024).toFixed(1)} KB` : 'oder klicken zum Auswählen'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.ods"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          <div className="text-[11px] text-gray-400 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
            💡 <strong>Hinweis:</strong> Die Rohdaten werden unveränderlich in der Staging-Tabelle gespeichert. Die KI analysiert Struktur und teilt Firmen und Kontakte auf Wunsch auf.
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!file || loading}
              className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
            >
              {loading ? 'Wird hochgeladen…' : 'Batch importieren'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
