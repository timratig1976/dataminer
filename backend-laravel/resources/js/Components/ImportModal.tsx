import React, { useState } from 'react';
import { Download, X, FileSpreadsheet, RefreshCw, AlertCircle } from 'lucide-react';

interface Props {
    caseId: string;
    onClose: () => void;
    onImported: () => void;
}

export default function ImportModal({ caseId, onClose, onImported }: Props) {
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file) return;

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('case_id', caseId);
        formData.append('file', file);

        const isXlsx = file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.ods');
        const endpoint = isXlsx ? '/api/import/xlsx' : '/api/import/csv';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Fehler beim Importieren');

            onImported();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Unbekannter Fehler beim Datei-Upload');
            setUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95">
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-950/80 border border-blue-800 text-blue-400 rounded-xl">
                            <FileSpreadsheet className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-sm text-slate-100">Daten importieren</h2>
                            <p className="text-xs text-slate-400">CSV, XLSX, XLS oder ODS Tabelle hochladen</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <form onSubmit={handleUpload} className="p-5 space-y-4">
                    <div className="border-2 border-dashed border-slate-800 hover:border-blue-500/60 rounded-2xl p-6 text-center cursor-pointer bg-slate-950/50">
                        <input
                            type="file"
                            accept=".csv,.xlsx,.xls,.ods,.txt"
                            onChange={e => setFile(e.target.files?.[0] || null)}
                            className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
                            required
                        />
                        <p className="text-[11px] text-slate-500 mt-2">
                            Unterstützt 100k+ Zeilen mit automatischem Chunking.
                        </p>
                    </div>

                    {file && (
                        <div className="text-xs text-slate-300 bg-slate-950 border border-slate-800 p-3 rounded-xl flex items-center justify-between">
                            <span className="truncate font-mono">{file.name}</span>
                            <span className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(1)} KB</span>
                        </div>
                    )}

                    {error && (
                        <div className="text-xs p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
                        >
                            Abbrechen
                        </button>
                        <button
                            type="submit"
                            disabled={uploading || !file}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                        >
                            {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            Importieren
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}