import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    ArrowLeft, Play, Download, Sparkles, RefreshCw, ChevronLeft, 
    ChevronRight, AlertCircle, Plus, Target, Upload, Database, Sliders, CheckCircle2 
} from 'lucide-react';
import { Link } from '@inertiajs/react';
import AgentGoalModal from '../../Components/AgentGoalModal';
import AddColumnModal from '../../Components/AddColumnModal';
import ImportModal from '../../Components/ImportModal';

interface CaseDetail {
    id: string;
    name: string;
    description?: string;
    columns?: Array<{ key: string; label: string }>;
    ai_columns?: Array<{ id: string; name: string; outputKey: string; tool: string; model: string; prompt: string }>;
    rows_count: number;
}

interface RowItem {
    id: string;
    row_index: number;
    data: Record<string, any>;
    cell_statuses: Record<string, string>;
}

interface Props {
    case: CaseDetail;
}

const PAGE_SIZE = 100;

export default function CaseShow({ case: c }: Props) {
    const [caseData, setCaseData] = useState<CaseDetail>(c);
    const [rows, setRows] = useState<RowItem[]>([]);
    const [total, setTotal] = useState(c.rows_count);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Modals
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [showAddColModal, setShowAddColModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [enriching, setEnriching] = useState(false);
    const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const loadPage = useCallback((p: number) => {
        setLoading(true);
        setError(null);
        fetch(`/api/rows?caseId=${caseData.id}&limit=${PAGE_SIZE}&page=${p}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                setRows(data.rows ?? []);
                setTotal(data.total ?? 0);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message ?? 'Unbekannter Fehler beim Laden der Zeilen.');
                setLoading(false);
            });
    }, [caseData.id]);

    const refreshCase = async () => {
        try {
            const res = await fetch(`/api/cases/${caseData.id}`);
            const data = await res.json();
            setCaseData(data);
        } catch (e) {
            console.error('Failed to reload case', e);
        }
    };

    useEffect(() => { loadPage(page); }, [page, loadPage]);

    const handleStartEnrichment = async () => {
        if (!caseData.ai_columns || caseData.ai_columns.length === 0) {
            alert('Bitte lege zuerst mindestens eine KI-Spalte über "+ KI-Spalte" an.');
            setShowAddColModal(true);
            return;
        }

        setEnriching(true);
        setEnrichMsg('Enrichment-Jobs werden an die 8 Worker-Queues übergeben...');

        try {
            const targetCol = caseData.ai_columns[0];
            const res = await fetch('/api/enrichment/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    case_id: caseData.id,
                    column_id: targetCol.id,
                    tool: targetCol.tool || 'ai_enrich',
                    chunk_size: 50,
                    run_mode: 'empty_only',
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Fehler beim Dispatchen');

            setEnrichMsg(`Job erfolgreich gestartet (${data.dispatched_chunks || 1} Chunks gequeued).`);
            setTimeout(() => setEnrichMsg(null), 5000);
        } catch (err: any) {
            alert(`Fehler: ${err.message}`);
            setEnrichMsg(null);
        } finally {
            setEnriching(false);
        }
    };

    const columns = caseData.columns && caseData.columns.length > 0
        ? caseData.columns
        : (rows[0] ? Object.keys(rows[0].data).map(k => ({ key: k, label: k })) : []);

    return (
        <AppLayout>
            <div className="space-y-6 pb-12">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/cases" className="p-2 bg-slate-900 border border-slate-800 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                                {caseData.name}
                                {caseData.ai_columns && caseData.ai_columns.length > 0 && (
                                    <span className="text-[10px] bg-purple-950 text-purple-400 border border-purple-800 px-2 py-0.5 rounded-full font-medium">
                                        {caseData.ai_columns.length} KI-Spalten
                                    </span>
                                )}
                            </h1>
                            <p className="text-xs text-slate-400">{total.toLocaleString('de-DE')} Zeilen • {caseData.description || 'Keine Beschreibung'}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                        {/* Discovery Agent Button */}
                        <button
                            onClick={() => setShowAgentModal(true)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 hover:border-emerald-600/50 text-slate-200 rounded-xl text-xs font-medium cursor-pointer"
                        >
                            <Target className="w-3.5 h-3.5 text-emerald-400" />
                            Agent Discovery
                        </button>

                        {/* Import Button */}
                        <button
                            onClick={() => setShowImportModal(true)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 hover:border-blue-600/50 text-slate-200 rounded-xl text-xs font-medium cursor-pointer"
                        >
                            <Upload className="w-3.5 h-3.5 text-blue-400" />
                            Import (CSV/XLSX)
                        </button>

                        {/* Add AI Column Button */}
                        <button
                            onClick={() => setShowAddColModal(true)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 hover:border-purple-600/50 text-slate-200 rounded-xl text-xs font-medium cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5 text-purple-400" />
                            + KI-Spalte
                        </button>

                        {/* Start 100k Enrichment Button */}
                        <button
                            onClick={handleStartEnrichment}
                            disabled={enriching}
                            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 cursor-pointer"
                        >
                            {enriching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            100k Enrichment
                        </button>

                        {/* Export Button */}
                        <a
                            href={`/api/export?caseId=${caseData.id}`}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-medium"
                        >
                            <Download className="w-3.5 h-3.5" /> Export
                        </a>
                    </div>
                </div>

                {/* Enrichment Status Notification */}
                {enrichMsg && (
                    <div className="bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs px-4 py-2.5 rounded-xl flex items-center gap-2 animate-in fade-in">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{enrichMsg}</span>
                    </div>
                )}

                {/* Table View */}
                <div className="border border-slate-800 bg-slate-900 rounded-2xl overflow-hidden shadow-xl">
                    <div className="overflow-x-auto max-h-[70vh]">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-slate-950 sticky top-0 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold z-10">
                                <tr>
                                    <th className="p-3 w-12 border-r border-slate-800/60 text-center">#</th>
                                    {columns.map(col => (
                                        <th key={col.key} className="p-3 border-r border-slate-800/60 min-w-[160px]">
                                            {col.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/40 text-slate-200">
                                {loading ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-12 text-center text-slate-500">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-400" />
                                            Lade Tabellendaten...
                                        </td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-12 text-center text-rose-400">
                                            <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                                            Fehler: {error}
                                            <button onClick={() => loadPage(page)} className="ml-3 underline hover:text-rose-300">Erneut versuchen</button>
                                        </td>
                                    </tr>
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-12 text-center text-slate-500">
                                            Keine Zeilen vorhanden. Nutze "Agent Discovery" oder "Import", um Leads hinzuzufügen.
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((r, idx) => (
                                        <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                                            <td className="p-3 border-r border-slate-800/60 text-slate-500 font-mono text-[10px] text-center">
                                                {(page - 1) * PAGE_SIZE + idx + 1}
                                            </td>
                                            {columns.map(col => {
                                                const val = r.data[col.key];
                                                const status = r.cell_statuses?.[col.key];
                                                return (
                                                    <td key={col.key} className="p-3 border-r border-slate-800/60 truncate max-w-[280px]">
                                                        {status === 'running' ? (
                                                            <span className="text-amber-400 flex items-center gap-1 font-mono text-[11px]">
                                                                <RefreshCw className="w-3 h-3 animate-spin" /> läuft...
                                                            </span>
                                                        ) : val !== null && val !== undefined && String(val).trim() !== '' ? (
                                                            <span>{String(val)}</span>
                                                        ) : (
                                                            <span className="text-slate-600">—</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Footer */}
                    {!loading && !error && totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 bg-slate-950/80 text-xs text-slate-400">
                            <span>
                                Zeile {((page - 1) * PAGE_SIZE + 1).toLocaleString('de-DE')}–{Math.min(page * PAGE_SIZE, total).toLocaleString('de-DE')} von {total.toLocaleString('de-DE')}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                                <span>Seite {page} / {totalPages}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                    className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            {showAgentModal && (
                <AgentGoalModal
                    caseId={caseData.id}
                    onClose={() => setShowAgentModal(false)}
                    onRunStarted={() => {
                        loadPage(1);
                        refreshCase();
                    }}
                />
            )}

            {showAddColModal && (
                <AddColumnModal
                    caseId={caseData.id}
                    onClose={() => setShowAddColModal(false)}
                    onColumnAdded={() => {
                        refreshCase();
                        loadPage(page);
                    }}
                />
            )}

            {showImportModal && (
                <ImportModal
                    caseId={caseData.id}
                    onClose={() => setShowImportModal(false)}
                    onImported={() => {
                        refreshCase();
                        loadPage(1);
                    }}
                />
            )}
        </AppLayout>
    );
}
