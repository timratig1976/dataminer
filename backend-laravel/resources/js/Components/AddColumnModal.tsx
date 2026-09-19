import React, { useState, useEffect } from 'react';
import { Sparkles, X, Plus, Play, RefreshCw, AlertCircle, Check, ChevronRight } from 'lucide-react';
import { apiFetch } from '../api';

interface Preset {
    name: string;
    outputKey: string;
    model?: string;
    tool?: string;
    outputMode?: 'text' | 'json';
    condition?: string;
    conditionField?: string;
    batchOutputFields?: string[];
    batchContactsMax?: number;
    batchContactsLinkedIn?: boolean;
    batchContactsImpressum?: boolean;
    prompt?: string;
}

interface Props {
    caseId: string;
    onClose: () => void;
    onColumnAdded: () => void;
}

export default function AddColumnModal({ caseId, onClose, onColumnAdded }: Props) {
    const [mode, setMode] = useState<'preset' | 'custom'>('preset');
    const [presets, setPresets] = useState<Preset[]>([]);
    const [loadingPresets, setLoadingPresets] = useState(true);

    // Form inputs
    const [name, setName] = useState('');
    const [outputKey, setOutputKey] = useState('');
    const [prompt, setPrompt] = useState('');
    const [tool, setTool] = useState<string>('ai_enrich');
    const [model, setModel] = useState('openai/gpt-4o-mini');
    const [outputMode, setOutputMode] = useState<'text' | 'json'>('text');
    const [condition, setCondition] = useState('empty');

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        apiFetch('/api/presets')
            .then(res => res.json())
            .then(data => {
                setPresets(Array.isArray(data) ? data : []);
                setLoadingPresets(false);
            })
            .catch(() => setLoadingPresets(false));
    }, []);

    const applyPreset = (p: Preset) => {
        setName(p.name);
        setOutputKey(p.outputKey);
        setPrompt(p.prompt || '');
        setTool(p.tool || 'ai_enrich');
        setModel(p.model || 'openai/gpt-4o-mini');
        setOutputMode(p.outputMode || 'text');
        setCondition(p.condition || 'empty');
        setMode('custom');
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setSaving(true);
        setError(null);

        try {
            const caseRes = await apiFetch(`/api/cases/${caseId}`);
            const caseData = await caseRes.json();

            const existingAiCols = caseData.ai_columns || [];
            const finalKey = outputKey.trim() || name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

            const newCol = {
                id: crypto.randomUUID(),
                name: name.trim(),
                outputKey: finalKey,
                prompt: prompt.trim(),
                tool,
                model,
                outputMode,
                condition,
                conditionField: finalKey,
            };

            const patchRes = await apiFetch(`/api/cases/${caseId}`, {
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
            <div 
                className="w-full max-w-xl rounded-xl shadow-2xl p-6 space-y-5 animate-in zoom-in-95"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
                <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--border-xs)' }}>
                    <div className="flex items-center gap-2.5">
                        <div 
                            className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold"
                            style={{ background: 'var(--green)' }}
                        >
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>KI-Spalte hinzufügen</h2>
                            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Vordefinierte Vorlage wählen oder eigene KI-Aktion definieren</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Mode Switcher */}
                <div className="flex gap-2 p-1 rounded-lg" style={{ background: 'var(--bg)', border: '1px solid var(--border-xs)' }}>
                    <button
                        type="button"
                        onClick={() => setMode('preset')}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-all cursor-pointer ${mode === 'preset' ? 'bg-white shadow-xs font-semibold' : 'text-slate-500'}`}
                        style={{ color: mode === 'preset' ? 'var(--orange)' : undefined }}
                    >
                        ⚡ Vorlagen ({presets.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('custom')}
                        className={`flex-1 py-1.5 text-xs font-medium rounded transition-all cursor-pointer ${mode === 'custom' ? 'bg-white shadow-xs font-semibold' : 'text-slate-500'}`}
                        style={{ color: mode === 'custom' ? 'var(--orange)' : undefined }}
                    >
                        ⚙ Benutzerdefiniert
                    </button>
                </div>

                {/* ── Mode 1: Presets ── */}
                {mode === 'preset' && (
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                        {loadingPresets ? (
                            <div className="p-8 text-center text-xs text-slate-400">Lade Vorlagen...</div>
                        ) : (
                            presets.map((p, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => applyPreset(p)}
                                    className="p-3 rounded-lg border flex items-center justify-between cursor-pointer hover:bg-[#fbfaf8] transition-colors"
                                    style={{ borderColor: 'var(--border)' }}
                                >
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{p.name}</span>
                                            <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                                                {p.outputKey}
                                            </span>
                                            {p.tool && (
                                                <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                                                    {p.tool}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                                            {p.prompt || 'Batch-Enrichment Aktion'}
                                        </p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-400" />
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* ── Mode 2: Custom / Edit ── */}
                {mode === 'custom' && (
                    <form onSubmit={handleSave} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                    Spaltenname
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="z.B. Geschäftsführer"
                                    className="w-full border rounded px-3 py-1.5 text-xs outline-none"
                                    style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                                    required
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                    Ausgabe-Key
                                </label>
                                <input
                                    type="text"
                                    value={outputKey}
                                    onChange={e => setOutputKey(e.target.value)}
                                    placeholder="z.B. gf_name"
                                    className="w-full border rounded px-3 py-1.5 text-xs font-mono outline-none"
                                    style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                    Tool / Ausführung
                                </label>
                                <select
                                    value={tool}
                                    onChange={e => setTool(e.target.value)}
                                    className="w-full border rounded px-3 py-1.5 text-xs outline-none"
                                    style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                                >
                                    <option value="ai_enrich">KI Text Extraktion</option>
                                    <option value="batch_company">batch_company (Firmendaten)</option>
                                    <option value="batch_contact">batch_contact (Entscheider)</option>
                                    <option value="scrape_profile">Impressum Scraper</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                    Modell
                                </label>
                                <select
                                    value={model}
                                    onChange={e => setModel(e.target.value)}
                                    className="w-full border rounded px-3 py-1.5 text-xs font-mono outline-none"
                                    style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                                >
                                    <option value="openai/gpt-4o-mini">openai/gpt-4o-mini</option>
                                    <option value="anthropic/claude-3-5-haiku-latest">claude-3-5-haiku</option>
                                    <option value="mistral/mistral-small-latest">mistral-small</option>
                                    <option value="google/gemini-flash-latest">gemini-flash</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                Prompt
                            </label>
                            <textarea
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                rows={4}
                                placeholder="Extrahiere die gewünschten Informationen aus den Firmendaten..."
                                className="w-full border rounded p-2.5 text-xs font-mono outline-none leading-relaxed"
                                style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                            />
                        </div>

                        {error && (
                            <div className="text-xs p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-600 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-2.5 pt-3" style={{ borderTop: '1px solid var(--border-xs)' }}>
                            <button
                                type="button"
                                onClick={() => setMode('preset')}
                                className="btn-v2"
                            >
                                Zurück zu Vorlagen
                            </button>
                            <button
                                type="submit"
                                disabled={saving || !name.trim()}
                                className="btn-v2 btn-v2-primary"
                            >
                                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                Spalte anlegen
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
