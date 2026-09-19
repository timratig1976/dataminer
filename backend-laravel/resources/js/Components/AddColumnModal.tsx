import React, { useState } from 'react';
import { Sparkles, X, Plus, AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
    caseId: string;
    onClose: () => void;
    onColumnAdded: () => void;
}

export default function AddColumnModal({ caseId, onClose, onColumnAdded }: Props) {
    const [name, setName] = useState('');
    const [prompt, setPrompt] = useState('Extrahiere die offizielle Telefonnummer und E-Mail-Adresse des Betriebs.');
    const [tool, setTool] = useState<'ai_enrich' | 'scrape_profile' | 'batch_contact'>('ai_enrich');
    const [model, setModel] = useState('openai/gpt-4o-mini');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setSaving(true);
        setError(null);

        try {
            // Case abrufen um bestehende AI-Columns zu erweitern
            const caseRes = await fetch(`/api/cases/${caseId}`);
            const caseData = await caseRes.json();

            const existingAiCols = caseData.ai_columns || [];
            const outputKey = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

            const newCol = {
                id: crypto.randomUUID(),
                name: name.trim(),
                outputKey,
                prompt: prompt.trim(),
                tool,
                model,
            };

            const patchRes = await fetch(`/api/cases/${caseId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ai_columns: [...existingAiCols, newCol],
                }),
            });

            if (!patchRes.ok) {
                const errData = await patchRes.json();
                throw new Error(errData.message || 'Fehler beim Speichern der Spalte');
            }

            onColumnAdded();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Unbekannter Fehler');
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95">
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-950/80 border border-purple-800 text-purple-400 rounded-xl">
                            <Plus className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-sm text-slate-100">Neue KI-Anreicherungs-Spalte</h2>
                            <p className="text-xs text-slate-400">Automatische Datenextraktion via LLM & Web-Scraping</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <form onSubmit={handleSave} className="p-5 space-y-4">
                    <div>
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
                            Spaltenname
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="z.B. Geschäftsführer / Inhaber"
                            className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
                                Methode / Tool
                            </label>
                            <select
                                value={tool}
                                onChange={e => setTool(e.target.value as any)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                            >
                                <option value="ai_enrich">KI Text Extraktion</option>
                                <option value="scrape_profile">Impressum & Kontakt Scrape</option>
                                <option value="batch_contact">Ansprechpartner Suche</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
                                LLM Modell
                            </label>
                            <select
                                value={model}
                                onChange={e => setModel(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none font-mono"
                            >
                                <option value="openai/gpt-4o-mini">openai/gpt-4o-mini</option>
                                <option value="anthropic/claude-3-5-sonnet">claude-3-5-sonnet</option>
                                <option value="mistral/mistral-small-latest">mistral-small</option>
                                <option value="google/gemini-flash-latest">gemini-flash</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
                            Extraktions-Prompt
                        </label>
                        <textarea
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            rows={3}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-xl p-3 text-xs text-slate-200 outline-none leading-relaxed"
                            required
                        />
                    </div>

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
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                        >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Spalte anlegen
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}