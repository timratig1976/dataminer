import React, { useState, useRef } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { router } from '@inertiajs/react';
import { 
    Plus, Calendar, Download, Upload, RefreshCw, AlertCircle, 
    Trash2, FolderPlus, X, Search, ChevronRight, Database, Loader2 
} from 'lucide-react';
import { apiFetch } from '../../api';

interface CaseItem {
    id: string;
    name: string;
    description?: string;
    ai_columns?: any[];
    rows_count: number;
    updated_at: string;
}

interface Props {
    cases: CaseItem[];
}

export default function CasesIndex({ cases: initialCases }: Props) {
    const [cases, setCases] = useState<CaseItem[]>(initialCases);
    const [search, setSearch] = useState('');
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string>('standard');
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

            if (res.status === 401) {
                window.location.href = '/login';
                return;
            }

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || data.error || 'Import fehlgeschlagen');

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
            const res = await apiFetch('/api/cases', {
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
            const res = await apiFetch(`/api/cases/${caseId}`, { method: 'DELETE' });
            if (res.ok) {
                setCases(prev => prev.filter(c => c.id !== caseId));
            }
        } catch (err) {
            console.error('Delete case failed', err);
        }
    };

    const filtered = cases.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <AppLayout
            title="Alle Cases"
            actions={
                <div className="flex items-center gap-2.5">
                    {/* Search Input */}
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Cases suchen…"
                            className="w-48 pl-8 pr-2.5 py-1 text-xs border rounded focus:outline-none transition-colors"
                            style={{
                                background: "var(--surface)",
                                borderColor: "var(--border)",
                                color: "var(--text-1)",
                            }}
                        />
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleImportSnapshot}
                        className="hidden"
                    />

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                        title="Case aus Snapshot-JSON importieren"
                        className="btn-v2"
                    >
                        {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {importing ? "Importiert…" : "Snapshot"}
                    </button>

                    <button
                        onClick={() => setCreating(true)}
                        className="btn-v2 btn-v2-primary"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Neuer Case
                    </button>
                </div>
            }
        >
            <div className="max-w-6xl mx-auto space-y-6 pb-16">
                {importError && (
                    <div className="p-3 rounded text-xs flex items-center justify-between" style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", color: "var(--danger)" }}>
                        <span>❌ Import-Fehler: {importError}</span>
                        <button onClick={() => setImportError(null)} className="cursor-pointer ml-3">×</button>
                    </div>
                )}

                {/* Cases Grid (1:1 V2 Design) */}
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64" style={{ color: "var(--text-3)" }}>
                        <div className="text-3xl mb-2">📂</div>
                        <p className="text-xs">Keine Cases gefunden.</p>
                        <button
                            onClick={() => setCreating(true)}
                            className="mt-3 btn-v2 btn-v2-primary"
                        >
                            Case erstellen
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filtered.map((c) => (
                            <div
                                key={c.id}
                                onClick={() => router.visit(`/cases/${c.id}`)}
                                className="p-4 cursor-pointer transition-all group rounded-lg"
                                style={{
                                    background: "var(--surface)",
                                    border: "1px solid var(--border)",
                                    boxShadow: "var(--shadow-sm)",
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = "var(--orange-mid)";
                                    e.currentTarget.style.boxShadow = "var(--shadow)";
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = "var(--border)";
                                    e.currentTarget.style.boxShadow = "var(--shadow-sm)";
                                }}
                            >
                                <div className="flex items-start justify-between mb-2.5">
                                    <div
                                        className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
                                        style={{ background: "var(--orange-soft)", color: "var(--orange)" }}
                                    >
                                        {c.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => handleExportSnapshot(c.id, c.name, e)}
                                            title="Als Snapshot exportieren (JSON)"
                                            className="p-1 rounded hover:bg-slate-100 cursor-pointer"
                                            style={{ color: "var(--text-3)" }}
                                        >
                                            <Download className="w-3.5 h-3.5" />
                                        </button>
                                        <button 
                                            onClick={(e) => handleDeleteCase(c.id, c.name, e)} 
                                            title="Case löschen"
                                            className="p-1 rounded hover:bg-rose-50 cursor-pointer" 
                                            style={{ color: "var(--danger)" }}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                <div className="font-semibold text-[13px] mb-1 truncate" style={{ color: "var(--text-1)" }}>
                                    {c.name}
                                </div>

                                <div className="text-[11px] mb-3" style={{ color: "var(--text-3)" }}>
                                    {(c.ai_columns || []).length} KI-Spalten · {new Date(c.updated_at).toLocaleDateString("de-DE")} · {(c.rows_count || 0).toLocaleString("de-DE")} Zeilen
                                </div>

                                <div className="flex items-center text-xs font-medium" style={{ color: "var(--orange)" }}>
                                    Öffnen <ChevronRight className="w-3.5 h-3.5 ml-1" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Create Case Modal (mit Original Template-Auswahl) */}
                {creating && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-xs p-4">
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
