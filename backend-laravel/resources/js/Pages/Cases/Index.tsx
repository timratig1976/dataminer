import React, { useState, useRef } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { Link, router } from '@inertiajs/react';
import { Plus, Calendar, Download, Upload, RefreshCw, AlertCircle, Trash2, FolderPlus, X } from 'lucide-react';
import { apiFetch } from '../../api';

interface CaseItem {
    id: string;
    name: string;
    description?: string;
    rows_count: number;
    updated_at: string;
}

interface Props {
    cases: CaseItem[];
}

export default function CasesIndex({ cases: initialCases }: Props) {
    const [cases, setCases] = useState<CaseItem[]>(initialCases);
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('standard');
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [savingCase, setSavingCase] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImportSnapshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImporting(true);
        setImportError(null);

        try {
            const text = await file.text();
            const snap = JSON.parse(text);

            const res = await apiFetch('/api/import/snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(snap),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || data.error || 'Import fehlgeschlagen');

            // Zum neu importierten Case navigieren
            const newCaseId = data.case?.id || snap.case?.id;
            if (newCaseId) {
                router.visit(`/cases/${newCaseId}`);
            } else {
                router.reload();
            }
        } catch (err: any) {
            setImportError(err.message || 'Ungültige Snapshot-JSON-Datei');
            setImporting(false);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleExportSnapshot = (caseId: string, caseName: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const a = document.createElement('a');
        a.href = `/api/export/snapshot?caseId=${caseId}`;
        a.download = `${caseName.replace(/[^a-z0-9]/gi, '_')}_snapshot.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const handleCreateCase = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim()) return;

        setSavingCase(true);
        try {
            const res = await fetch('/api/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName.trim(),
                    description: newDesc.trim() || undefined,
                    template: selectedTemplateId,
                }),
            });

            const data = await res.json();
            if (res.ok && data.id) {
                router.visit(`/cases/${data.id}`);
            }
        } catch (err) {
            console.error('Failed to create case', err);
        } finally {
            setSavingCase(false);
        }
    };

    const handleDeleteCase = async (caseId: string, caseName: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Möchtest du den Case "${caseName}" und alle enthaltenen Zeilen wirklich löschen?`)) {
            return;
        }

        try {
            const res = await fetch(`/api/cases/${caseId}`, { method: 'DELETE' });
            if (res.ok) {
                setCases(prev => prev.filter(c => c.id !== caseId));
            }
        } catch (err) {
            console.error('Delete case failed', err);
        }
    };

    return (
        <AppLayout>
            <div className="max-w-6xl mx-auto space-y-6 pb-16">
                {/* Hidden File Input for Snapshot Upload */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportSnapshot}
                    className="hidden"
                />

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                            Cases
                        </h1>
                        <p className="text-slate-400 text-xs mt-1">
                            Verwalte deine Lead-Recherche-Projekte, Tabellen und JSON-Snapshots.
                        </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={importing}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 hover:border-blue-600/50 text-slate-200 rounded-xl text-xs font-medium cursor-pointer transition-all disabled:opacity-50"
                        >
                            {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" /> : <Upload className="w-3.5 h-3.5 text-blue-400" />}
                            Snapshot importieren
                        </button>

                        <button
                            onClick={() => setCreating(true)}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 cursor-pointer transition-all"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Neuer Case
                        </button>
                    </div>
                </div>

                {importError && (
                    <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{importError}</span>
                    </div>
                )}

                {/* Cases Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {cases.map((c) => (
                        <div
                            key={c.id}
                            onClick={() => router.visit(`/cases/${c.id}`)}
                            className="bg-slate-900 border border-slate-800 hover:border-slate-700 p-5 rounded-2xl transition-all block group relative cursor-pointer shadow-md hover:shadow-xl"
                        >
                            <div className="flex items-start justify-between mb-2">
                                <h3 className="font-semibold text-base text-slate-100 group-hover:text-emerald-400 transition-colors line-clamp-1 pr-2">
                                    {c.name}
                                </h3>
                                <span className="text-[11px] bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded-full font-mono font-medium shrink-0">
                                    {(c.rows_count || 0).toLocaleString('de-DE')} Zeilen
                                </span>
                            </div>

                            <p className="text-xs text-slate-400 mb-5 line-clamp-2 h-8 leading-relaxed">
                                {c.description || 'Keine Beschreibung vorhanden.'}
                            </p>

                            <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 text-[11px] text-slate-500">
                                <span className="flex items-center gap-1.5 font-mono">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {new Date(c.updated_at).toLocaleDateString('de-DE')}
                                </span>

                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => handleExportSnapshot(c.id, c.name, e)}
                                        title="JSON-Snapshot exportieren (Vollständige Sicherung inkl. aller Zeilen & Spalten)"
                                        className="p-1.5 hover:bg-slate-800 hover:text-blue-400 rounded-lg text-slate-400 transition-colors cursor-pointer"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                        onClick={(e) => handleDeleteCase(c.id, c.name, e)}
                                        title="Case löschen"
                                        className="p-1.5 hover:bg-rose-950/50 hover:text-rose-400 rounded-lg text-slate-500 transition-colors cursor-pointer"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Create Case Modal (mit Original Template-Auswahl) */}
                {creating && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
                        <div 
                            className="w-full max-w-lg rounded-xl shadow-2xl p-6 space-y-4 animate-in zoom-in-95"
                            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                        >
                            <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--border-xs)' }}>
                                <div className="flex items-center gap-2.5">
                                    <div 
                                        className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold"
                                        style={{ background: 'var(--orange)' }}
                                    >
                                        <FolderPlus className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Neuen Case anlegen</h3>
                                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Wähle ein Template mit vorkonfigurierten Spalten</p>
                                    </div>
                                </div>
                                <button onClick={() => setCreating(false)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <form onSubmit={handleCreateCase} className="space-y-4">
                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-3)' }}>
                                        Case-Name
                                    </label>
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={e => setNewName(e.target.value)}
                                        placeholder="z.B. Handwerker München & Umland"
                                        className="w-full border rounded px-3 py-1.5 text-xs focus:outline-none"
                                        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
                                        required
                                        autoFocus
                                    />
                                </div>

                                <div>
                                    <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-3)' }}>
                                        Projekt-Template / Spalten-Konfiguration
                                    </label>
                                    <div className="grid grid-cols-1 gap-2">
                                        {[
                                            {
                                                id: 'standard',
                                                name: 'Standard (Empfohlen)',
                                                desc: '19 Spalten (Firmenname, Domain, Telefon, E-Mail, Adresse, Rating, Ansprechpartner) + 2 KI-Aktionen (🏢 Firmendaten & 👤 Entscheider)',
                                                icon: '⚡',
                                            },
                                            {
                                                id: 'vilocal',
                                                name: 'ViLocal Audit (GBP & Google Places)',
                                                desc: '14 Spalten inkl. Google Maps Rating & Reviews + GBP Audit KI-Spalte',
                                                icon: '📍',
                                            },
                                            {
                                                id: 'none',
                                                name: 'Leeres Projekt',
                                                desc: 'Startet ohne vordefinierte Spalten (für manuelle Konfiguration)',
                                                icon: '📄',
                                            }
                                        ].map(t => (
                                            <div
                                                key={t.id}
                                                onClick={() => setSelectedTemplateId(t.id)}
                                                className="p-3 rounded border transition-all cursor-pointer flex items-start gap-3"
                                                style={{
                                                    background: selectedTemplateId === t.id ? 'var(--orange-soft)' : 'var(--bg)',
                                                    borderColor: selectedTemplateId === t.id ? 'var(--orange)' : 'var(--border)',
                                                }}
                                            >
                                                <span className="text-base">{t.icon}</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{t.name}</span>
                                                        {selectedTemplateId === t.id && (
                                                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded" style={{ background: 'var(--orange)', color: '#fff' }}>Aktiv</span>
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--text-2)' }}>{t.desc}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center justify-end gap-2.5 pt-3" style={{ borderTop: '1px solid var(--border-xs)' }}>
                                    <button
                                        type="button"
                                        onClick={() => setCreating(false)}
                                        className="btn-v2"
                                    >
                                        Abbrechen
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingCase || !newName.trim()}
                                        className="btn-v2 btn-v2-primary"
                                    >
                                        {savingCase ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                        Case erstellen
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
