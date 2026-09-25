import React, { useState, useEffect } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import SettingsTabs from '@/Components/settings/SettingsTabs';
import { apiFetch } from '@/api';
import {
    Sparkles, Plus, CheckCircle2, ShieldAlert, Copy, Save, Trash2,
    Sliders, Tag, Code, HelpCircle, Layers, ArrowRight, RefreshCw,
    Check, AlertCircle
} from 'lucide-react';

interface Preset {
    id: string;
    name: string;
    outputKey: string;
    prompt?: string;
    model?: string;
    outputMode?: 'text' | 'json';
    jsonKey?: string;
    condition?: string;
    conditionField?: string;
    tool?: string;
    description?: string;
    tags?: string[];
    isBuiltIn?: boolean;
    created_at?: string;
    updated_at?: string;
}

const CONDITIONS = [
    { value: '', label: 'Immer ausführen' },
    { value: 'require_input', label: 'Nur wenn Eingabefeld vorhanden' },
    { value: 'empty', label: 'Nur wenn Ausgabefeld leer (kein Re-Run)' },
    { value: 'not_empty', label: 'Nur wenn Ausgabefeld befüllt' },
];

export default function ColumnTemplatesSettings() {
    const [builtInPresets, setBuiltInPresets] = useState<Preset[]>([]);
    const [customPresets, setCustomPresets] = useState<Preset[]>([]);
    const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
    const [isCreatingNew, setIsCreatingNew] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Form fields
    const [name, setName] = useState('');
    const [outputKey, setOutputKey] = useState('');
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('openai/gpt-4o-mini');
    const [outputMode, setOutputMode] = useState<'text' | 'json'>('text');
    const [jsonKey, setJsonKey] = useState('');
    const [condition, setCondition] = useState('');
    const [conditionField, setConditionField] = useState('');
    const [description, setDescription] = useState('');

    const fetchPresets = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/presets/all');
            if (res.ok) {
                const data = await res.json();
                setBuiltInPresets(data.builtIn || []);
                setCustomPresets(data.custom || []);
                
                // Select first preset if none selected
                if (!selectedPreset && !isCreatingNew) {
                    const first = (data.custom && data.custom.length > 0) ? data.custom[0] : (data.builtIn ? data.builtIn[0] : null);
                    if (first) selectPreset(first);
                }
            }
        } catch (e: any) {
            console.error(e);
            setMessage({ type: 'error', text: 'Fehler beim Laden der Vorlagen: ' + e.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPresets();
    }, []);

    const selectPreset = (p: Preset) => {
        setSelectedPreset(p);
        setIsCreatingNew(false);
        setName(p.name || '');
        setOutputKey(p.outputKey || '');
        setPrompt(p.prompt || '');
        setModel(p.model || 'openai/gpt-4o-mini');
        setOutputMode(p.outputMode || 'text');
        setJsonKey(p.jsonKey || '');
        setCondition(p.condition || '');
        setConditionField(p.conditionField || '');
        setDescription(p.description || '');
        setMessage(null);
    };

    const handleStartCreate = (basePreset?: Preset) => {
        setSelectedPreset(null);
        setIsCreatingNew(true);
        if (basePreset) {
            setName(`${basePreset.name} (Kopie)`);
            setOutputKey(`${basePreset.outputKey}_custom`);
            setPrompt(basePreset.prompt || '');
            setModel(basePreset.model || 'openai/gpt-4o-mini');
            setOutputMode(basePreset.outputMode || 'text');
            setJsonKey(basePreset.jsonKey || '');
            setCondition(basePreset.condition || '');
            setConditionField(basePreset.conditionField || '');
            setDescription(basePreset.description ? `Basierend auf: ${basePreset.description}` : '');
        } else {
            setName('Neue KI-Spalte');
            setOutputKey('custom_field');
            setPrompt('Extrahiere die gewünschten Informationen für {company_name}...');
            setModel('openai/gpt-4o-mini');
            setOutputMode('text');
            setJsonKey('');
            setCondition('require_input');
            setConditionField('company_name');
            setDescription('');
        }
        setMessage(null);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !outputKey.trim()) {
            setMessage({ type: 'error', text: 'Name und Ausgabeschlüssel (Key) sind Pflichtfelder.' });
            return;
        }

        setSaving(true);
        setMessage(null);

        const payload = {
            name: name.trim(),
            outputKey: outputKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
            prompt: prompt.trim(),
            model: model.trim(),
            outputMode,
            jsonKey: outputMode === 'json' ? jsonKey.trim() : null,
            condition: condition || null,
            conditionField: condition ? conditionField.trim() : null,
            description: description.trim() || null,
        };

        try {
            let res: Response;
            if (isCreatingNew || !selectedPreset || selectedPreset.isBuiltIn) {
                // Create new custom preset
                res = await apiFetch('/api/presets/custom', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else {
                // Update existing custom preset
                res = await apiFetch(`/api/presets/custom/${selectedPreset.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            }

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen');

            setMessage({ type: 'success', text: isCreatingNew ? 'Vorlage erfolgreich erstellt!' : 'Änderungen gespeichert!' });
            await fetchPresets();
            setSelectedPreset(data);
            setIsCreatingNew(false);
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (preset: Preset) => {
        if (preset.isBuiltIn) return;
        if (!confirm(`Vorlage "${preset.name}" wirklich löschen?`)) return;

        try {
            const res = await apiFetch(`/api/presets/custom/${preset.id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Löschen fehlgeschlagen');

            setMessage({ type: 'success', text: 'Vorlage gelöscht.' });
            if (selectedPreset?.id === preset.id) {
                setSelectedPreset(null);
            }
            await fetchPresets();
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        }
    };

    return (
        <AppLayout title="KI-Spalten Vorlagen">
            <div className="max-w-6xl mx-auto py-6 px-4">
                <SettingsTabs />

                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-600" />
                            KI-Spalten Vorlagen & Presets
                        </h1>
                        <p className="text-xs text-slate-500 mt-1">
                            Verwalte vordefinierte Prompts, LLM-Parameter und Bedingungen für neue Spalten im Tabellen-Grid.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => handleStartCreate()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Neue Vorlage</span>
                    </button>
                </div>

                {message && (
                    <div
                        className={`mb-5 p-3 rounded-lg text-xs flex items-center gap-2 ${
                            message.type === 'success'
                                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                                : 'bg-rose-50 border border-rose-200 text-rose-800'
                        }`}
                    >
                        {message.type === 'success' ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        ) : (
                            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                        )}
                        <span>{message.text}</span>
                    </div>
                )}

                <div className="grid grid-cols-12 gap-6 items-start">
                    {/* LEFT: Sidebar / Preset List */}
                    <div className="col-span-12 md:col-span-4 space-y-4">
                        {/* Custom Presets Card */}
                        <div className="bg-white border border-slate-200 rounded-lg p-3">
                            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    Eigene Vorlagen ({customPresets.length})
                                </span>
                            </div>

                            {loading ? (
                                <div className="py-6 text-center text-xs text-slate-400">Lade Vorlagen...</div>
                            ) : customPresets.length === 0 ? (
                                <div className="py-4 text-center text-xs text-slate-400">
                                    Noch keine eigenen Vorlagen. Du kannst eine Standard-Vorlage duplizieren oder oben neu erstellen.
                                </div>
                            ) : (
                                <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                                    {customPresets.map((p) => {
                                        const isSelected = selectedPreset?.id === p.id && !isCreatingNew;
                                        return (
                                            <div
                                                key={p.id}
                                                onClick={() => selectPreset(p)}
                                                className={`flex items-center justify-between p-2 rounded-md text-xs cursor-pointer transition-colors ${
                                                    isSelected
                                                        ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 font-semibold'
                                                        : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                                                }`}
                                            >
                                                <div className="min-w-0 pr-2">
                                                    <div className="truncate">{p.name}</div>
                                                    <div className="text-[10px] text-slate-400 font-mono truncate">
                                                        {p.outputKey}
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDelete(p);
                                                    }}
                                                    className="p-1 text-slate-300 hover:text-rose-600 rounded transition-colors"
                                                    title="Löschen"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Built-in Standards Card */}
                        <div className="bg-white border border-slate-200 rounded-lg p-3">
                            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    System-Standards ({builtInPresets.length})
                                </span>
                            </div>

                            <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                                {builtInPresets.map((p) => {
                                    const isSelected = selectedPreset?.id === p.id && !isCreatingNew;
                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => selectPreset(p)}
                                            className={`flex items-center justify-between p-2 rounded-md text-xs cursor-pointer transition-colors ${
                                                isSelected
                                                    ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 font-semibold'
                                                    : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                                            }`}
                                        >
                                            <div className="min-w-0 pr-2">
                                                <div className="truncate flex items-center gap-1.5">
                                                    <span>{p.name}</span>
                                                    {p.tool && (
                                                        <span className="text-[9.5px] px-1 py-0.2 bg-slate-100 text-slate-600 rounded">
                                                            Tool
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-mono truncate">
                                                    {p.outputKey}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleStartCreate(p);
                                                }}
                                                className="p-1 text-slate-400 hover:text-indigo-600 rounded text-[10px] flex items-center gap-1 font-sans"
                                                title="Als Basis duplizieren"
                                            >
                                                <Copy className="w-3 h-3" />
                                                <span>Kopie</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: Editor Panel */}
                    <div className="col-span-12 md:col-span-8 bg-white border border-slate-200 rounded-lg p-5">
                        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                            <div>
                                <h2 className="text-sm font-bold text-slate-900">
                                    {isCreatingNew
                                        ? '✨ Neue Vorlage anlegen'
                                        : selectedPreset?.isBuiltIn
                                        ? `🔒 Standard-Vorlage: ${selectedPreset.name}`
                                        : `✏️ Vorlage bearbeiten: ${selectedPreset?.name || ''}`}
                                </h2>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    {selectedPreset?.isBuiltIn
                                        ? 'System-Vorlagen sind schreibgeschützt. Klicke auf "Als Kopie bearbeiten", um Anpassungen zu speichern.'
                                        : 'Definiere Prompt-Instruktionen, Ausgabetyp und Vorbedingungen.'}
                                </p>
                            </div>

                            {selectedPreset?.isBuiltIn && !isCreatingNew && (
                                <button
                                    type="button"
                                    onClick={() => handleStartCreate(selectedPreset)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-md transition-colors cursor-pointer"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Als eigene Vorlage duplizieren</span>
                                </button>
                            )}
                        </div>

                        <form onSubmit={handleSave} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Anzeigename
                                    </label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="z.B. Offizielle Domain finden"
                                        disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                        className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Ausgabeschlüssel (Spalten-Key)
                                    </label>
                                    <input
                                        type="text"
                                        value={outputKey}
                                        onChange={(e) => setOutputKey(e.target.value)}
                                        placeholder="z.B. official_domain"
                                        disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                        className="w-full text-xs px-2.5 py-1.5 font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Beschreibung / Zweck
                                </label>
                                <input
                                    type="text"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Kurze Erklärung, wofür diese Spalte dient..."
                                    disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                    className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Standard-Modell
                                    </label>
                                    <select
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                        className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50"
                                    >
                                        <option value="openai/gpt-4o-mini">OpenAI: GPT-4o Mini (Standard, schnell)</option>
                                        <option value="openai/gpt-4o">OpenAI: GPT-4o (Sehr präzise)</option>
                                        <option value="anthropic/claude-3-5-sonnet">Anthropic: Claude 3.5 Sonnet</option>
                                        <option value="google/gemini-2.0-flash">Google: Gemini 2.0 Flash</option>
                                        <option value="deepseek/deepseek-chat">DeepSeek V3</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Ausgabe-Format
                                    </label>
                                    <select
                                        value={outputMode}
                                        onChange={(e) => setOutputMode(e.target.value as 'text' | 'json')}
                                        disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                        className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50"
                                    >
                                        <option value="text">Reiner Text (Einzelwert)</option>
                                        <option value="json">Strukturiertes JSON (Extrahieren über JSON-Key)</option>
                                    </select>
                                </div>
                            </div>

                            {outputMode === 'json' && (
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        JSON-Pfad / Key
                                    </label>
                                    <input
                                        type="text"
                                        value={jsonKey}
                                        onChange={(e) => setJsonKey(e.target.value)}
                                        placeholder="z.B. domain oder keywords"
                                        disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                        className="w-full text-xs px-2.5 py-1.5 font-mono border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
                                    />
                                    <span className="text-[10.5px] text-slate-400 mt-1 block">
                                        Der Wert dieses Feldes wird nach der LLM-Antwort in die Spalte geschrieben.
                                    </span>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50/70 border border-slate-200 rounded-md">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Ausführungs-Bedingung
                                    </label>
                                    <select
                                        value={condition}
                                        onChange={(e) => setCondition(e.target.value)}
                                        disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                        className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
                                    >
                                        {CONDITIONS.map((c) => (
                                            <option key={c.value} value={c.value}>
                                                {c.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                                        Bedingungs-Feld
                                    </label>
                                    <input
                                        type="text"
                                        value={conditionField}
                                        onChange={(e) => setConditionField(e.target.value)}
                                        placeholder="z.B. company_name oder domain"
                                        disabled={selectedPreset?.isBuiltIn && !isCreatingNew || !condition}
                                        className="w-full text-xs px-2.5 py-1.5 font-mono border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="block text-xs font-semibold text-slate-700">
                                        Prompt-Vorlage / Instruktionen
                                    </label>
                                    <span className="text-[10px] text-slate-400">
                                        Verwende Platzhalter wie <code className="text-indigo-600 font-mono">{'{company_name}'}</code>, <code className="text-indigo-600 font-mono">{'{domain}'}</code>
                                    </span>
                                </div>
                                <textarea
                                    rows={6}
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="Finde die offizielle primäre Domain für das gegebene Unternehmen..."
                                    disabled={selectedPreset?.isBuiltIn && !isCreatingNew}
                                    className="w-full text-xs p-2.5 font-mono border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-600"
                                />
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                                <div>
                                    {isCreatingNew && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsCreatingNew(false);
                                                if (customPresets.length > 0) selectPreset(customPresets[0]);
                                                else if (builtInPresets.length > 0) selectPreset(builtInPresets[0]);
                                            }}
                                            className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                                        >
                                            Abbrechen
                                        </button>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    {(!selectedPreset?.isBuiltIn || isCreatingNew) && (
                                        <button
                                            type="submit"
                                            disabled={saving}
                                            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-md text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                                        >
                                            {saving ? (
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Save className="w-3.5 h-3.5" />
                                            )}
                                            <span>{isCreatingNew ? 'Vorlage erstellen' : 'Änderungen speichern'}</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
