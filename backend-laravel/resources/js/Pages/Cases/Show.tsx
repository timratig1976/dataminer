import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    ArrowLeft, Play, Download, Sparkles, RefreshCw, ChevronLeft, 
    ChevronRight, AlertCircle, Plus, Target, Upload, Database, Sliders, 
    CheckCircle2, Building2, UserCheck, Users, Globe, ExternalLink, Flame
} from 'lucide-react';
import { Link } from '@inertiajs/react';
import AgentGoalModal from '../../Components/AgentGoalModal';
import AddColumnModal from '../../Components/AddColumnModal';
import ImportModal from '../../Components/ImportModal';
import EditPromptModal from '../../Components/case/EditPromptModal';
import { apiFetch } from '../../api';

interface CaseDetail {
    id: string;
    name: string;
    description?: string;
    columns?: Array<{ key: string; label: string }>;
    ai_columns?: Array<{ 
        id: string; 
        name: string; 
        outputKey: string; 
        tool: string; 
        model: string; 
        prompt: string;
        columnGroup?: string;
        batchOutputFields?: string[];
    }>;
    col_order?: string[];
    rows_count: number;
}

interface RowItem {
    id: string;
    row_index: number;
    data: Record<string, any>;
    cell_statuses: Record<string, string>;
    cell_errors?: Record<string, string>;
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

    // Active View Tab
    const [activeTab, setActiveTab] = useState<'Firmen' | 'Kontakte' | 'Discovery'>('Firmen');

    // Modals
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [showAddColModal, setShowAddColModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingCol, setEditingCol] = useState<any | null>(null);

    // Execution / Phase states
    const [runningCells, setRunningCells] = useState<Set<string>>(new Set());
    const [runningPhase, setRunningPhase] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const loadPage = useCallback((p: number) => {
        setLoading(true);
        setError(null);
        apiFetch(`/api/rows?caseId=${caseData.id}&limit=${PAGE_SIZE}&page=${p}`)
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
                setError(err.message ?? 'Fehler beim Laden der Zeilen.');
                setLoading(false);
            });
    }, [caseData.id]);

    const refreshCase = async () => {
        try {
            const res = await apiFetch(`/api/cases/${caseData.id}`);
            const data = await res.json();
            setCaseData(data);
        } catch (e) {
            console.error('Failed to reload case', e);
        }
    };

    useEffect(() => { loadPage(page); }, [page, loadPage]);

    // Run single AI cell
    const runCell = async (rowId: string, col: any) => {
        const key = `${rowId}:${col.outputKey}`;
        setRunningCells(prev => new Set(prev).add(key));

        // Optimistically set running in UI
        setRows(prev => prev.map(r => r.id === rowId ? {
            ...r,
            cell_statuses: { ...(r.cell_statuses || {}), [col.outputKey]: 'running' }
        } : r));

        try {
            const res = await apiFetch('/api/run/cell', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caseId: caseData.id,
                    rowId,
                    columnId: col.id,
                }),
            });

            const data = await res.json();
            if (res.ok && data.row) {
                setRows(prev => prev.map(r => r.id === rowId ? data.row : r));
            } else {
                throw new Error(data.error || 'Fehler beim Ausführen der Zelle');
            }
        } catch (err: any) {
            setRows(prev => prev.map(r => r.id === rowId ? {
                ...r,
                cell_statuses: { ...(r.cell_statuses || {}), [col.outputKey]: 'error' },
                cell_errors: { ...(r.cell_errors || {}), [col.outputKey]: err.message }
            } : r));
        } finally {
            setRunningCells(prev => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    // Run complete phase (Firmen = batch_company, Kontakte = batch_contact)
    const runPhase = async (phase: 'company' | 'contact') => {
        const targetCols = (caseData.ai_columns || []).filter(c => 
            phase === 'company' 
                ? (c.tool === 'batch_company' || c.columnGroup === 'company')
                : (c.tool === 'batch_contact' || c.columnGroup === 'contact')
        );

        if (targetCols.length === 0) {
            alert(`Keine KI-Spalte für Phase "${phase}" im Case definiert.`);
            return;
        }

        const col = targetCols[0];
        setRunningPhase(phase);
        setStatusMsg(`Phase "${col.name}" an 8 Queue-Worker übergeben...`);

        try {
            const res = await apiFetch('/api/enrichment/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    case_id: caseData.id,
                    column_id: col.id,
                    tool: col.tool || 'batch_company',
                    chunk_size: 50,
                    run_mode: 'empty_only',
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Dispatch fehlgeschlagen');

            setStatusMsg(`Job gestartet! ${data.dispatched_chunks || 1} Chunks in Verarbeitung.`);
            setTimeout(() => setStatusMsg(null), 6000);
            loadPage(page);
        } catch (err: any) {
            alert(`Fehler: ${err.message}`);
            setStatusMsg(null);
        } finally {
            setRunningPhase(null);
        }
    };

    // Determine columns to display
    const aiColumns = caseData.ai_columns || [];
    const baseCols = caseData.columns && caseData.columns.length > 0 
        ? caseData.columns.map(c => ({ key: c.key, label: c.label, isAi: false }))
        : (rows[0] ? Object.keys(rows[0].data).filter(k => !k.startsWith('_')).map(k => ({ key: k, label: k, isAi: false })) : []);

    const aiColHeaders = aiColumns.map(c => ({
        key: c.outputKey,
        label: c.name,
        isAi: true,
        colDef: c,
    }));

    // Merge columns in sensible order: Domain & AI columns first, then details
    const visibleColumns = useMemo(() => {
        const map = new Map<string, any>();
        // Add AI columns
        aiColHeaders.forEach(c => map.set(c.key, c));
        // Add Base columns
        baseCols.forEach(c => {
            if (!map.has(c.key)) map.set(c.key, c);
        });
        return Array.from(map.values());
    }, [aiColHeaders, baseCols]);

    return (
        <AppLayout
            title={
                <div className="flex items-center gap-3">
                    <Link href="/cases" className="text-slate-400 hover:text-slate-600">
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <span className="font-bold text-base" style={{ color: 'var(--text-1)' }}>{caseData.name}</span>
                    <span className="text-xs text-slate-400 font-mono">({total.toLocaleString('de-DE')} Zeilen)</span>
                </div>
            }
            actions={
                <div className="flex items-center gap-2">
                    {/* Primary Phase Action Buttons (Identisch zu Next.js) */}
                    <button
                        onClick={() => runPhase('company')}
                        disabled={runningPhase !== null}
                        className="btn-v2 btn-v2-primary"
                        title="Phase 1: Firmendaten & Website via Eden AI anreichern"
                    >
                        <Building2 className="w-3.5 h-3.5" />
                        Firmen {runningPhase === 'company' && '...'}
                    </button>

                    <button
                        onClick={() => runPhase('contact')}
                        disabled={runningPhase !== null}
                        className="btn-v2 btn-v2-ai"
                        title="Phase 2: Entscheider & LinkedIn Kontakte suchen"
                    >
                        <UserCheck className="w-3.5 h-3.5" />
                        Kontakte {runningPhase === 'contact' && '...'}
                    </button>

                    <div className="tsep-v2" />

                    <button
                        onClick={() => setShowAgentModal(true)}
                        className="btn-v2"
                        title="Autonomen Discovery-Agenten starten"
                    >
                        <Target className="w-3.5 h-3.5 text-orange-500" />
                        Discovery
                    </button>

                    <button
                        onClick={() => setShowImportModal(true)}
                        className="btn-v2"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        Import
                    </button>

                    <button
                        onClick={() => setShowAddColModal(true)}
                        className="btn-v2"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        + KI-Spalte
                    </button>

                    <a
                        href={`/api/export?caseId=${caseData.id}`}
                        className="btn-v2"
                    >
                        <Download className="w-3.5 h-3.5" />
                        Export
                    </a>
                </div>
            }
        >
            <div className="space-y-4 pb-12">
                {/* Tabs (Firmen, Kontakte, Discovery) */}
                <div className="flex items-center gap-2 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
                    <button
                        onClick={() => setActiveTab('Firmen')}
                        className="btn-v2"
                        style={{
                            background: activeTab === 'Firmen' ? 'var(--orange-soft)' : 'transparent',
                            borderColor: activeTab === 'Firmen' ? 'var(--orange)' : 'transparent',
                            color: activeTab === 'Firmen' ? 'var(--orange)' : 'var(--text-2)',
                            fontWeight: activeTab === 'Firmen' ? 600 : 400,
                        }}
                    >
                        <Building2 className="w-3.5 h-3.5" />
                        Firmen & Leads
                        <span className="badge-v2 badge-v2-orange">{total}</span>
                    </button>

                    <button
                        onClick={() => setActiveTab('Kontakte')}
                        className="btn-v2"
                        style={{
                            background: activeTab === 'Kontakte' ? 'var(--green-soft)' : 'transparent',
                            borderColor: activeTab === 'Kontakte' ? 'var(--green-mid)' : 'transparent',
                            color: activeTab === 'Kontakte' ? 'var(--green)' : 'var(--text-2)',
                            fontWeight: activeTab === 'Kontakte' ? 600 : 400,
                        }}
                    >
                        <Users className="w-3.5 h-3.5" />
                        Ansprechpartner
                    </button>
                </div>

                {/* Status Message */}
                {statusMsg && (
                    <div className="p-3 rounded-lg text-xs flex items-center gap-2 animate-in fade-in" style={{ background: 'var(--green-soft)', border: '1px solid var(--green-mid)', color: 'var(--green)' }}>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{statusMsg}</span>
                    </div>
                )}

                {/* Main Leads Table */}
                <div 
                    className="rounded-xl overflow-hidden shadow-xs"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                    <div className="overflow-x-auto max-h-[72vh]">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead 
                                className="sticky top-0 z-10 uppercase tracking-wider font-semibold text-[11px]"
                                style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}
                            >
                                <tr>
                                    <th className="p-2.5 w-12 border-r text-center" style={{ borderColor: 'var(--border)' }}>#</th>
                                    {visibleColumns.map(col => (
                                        <th 
                                            key={col.key} 
                                            className="p-2.5 border-r min-w-[150px]"
                                            style={{ 
                                                borderColor: 'var(--border)',
                                                background: col.isAi ? 'var(--orange-soft)' : 'inherit',
                                                color: col.isAi ? 'var(--orange)' : 'inherit',
                                            }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span>{col.label}</span>
                                                {col.isAi && (
                                                    <button 
                                                        onClick={() => setEditingCol(col.colDef)}
                                                        title="KI-Prompt & Modell bearbeiten"
                                                        className="hover:opacity-75 p-0.5 cursor-pointer"
                                                    >
                                                        <Sliders className="w-3 h-3 text-orange-500" />
                                                    </button>
                                                )}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y" style={{ borderColor: 'var(--border-xs)' }}>
                                {loading ? (
                                    <tr>
                                        <td colSpan={visibleColumns.length + 1} className="p-12 text-center text-slate-400">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-orange-500" />
                                            Lade Tabellendaten...
                                        </td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={visibleColumns.length + 1} className="p-12 text-center text-rose-600">
                                            <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                                            {error}
                                        </td>
                                    </tr>
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={visibleColumns.length + 1} className="p-12 text-center text-slate-400">
                                            Keine Zeilen im Case vorhanden.
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((r, idx) => (
                                        <tr key={r.id} className="hover:bg-[#faf9f7] transition-colors">
                                            <td className="p-2.5 border-r text-center font-mono text-[10.5px] text-slate-400" style={{ borderColor: 'var(--border-xs)' }}>
                                                {(page - 1) * PAGE_SIZE + idx + 1}
                                            </td>
                                            {visibleColumns.map(col => {
                                                const val = r.data[col.key];
                                                const status = r.cell_statuses?.[col.key];
                                                const isRunning = status === 'running' || runningCells.has(`${r.id}:${col.key}`);

                                                return (
                                                    <td 
                                                        key={col.key} 
                                                        className="p-2.5 border-r truncate max-w-[280px]"
                                                        style={{ borderColor: 'var(--border-xs)' }}
                                                    >
                                                        {col.isAi ? (
                                                            <div className="flex items-center justify-between gap-1.5">
                                                                <span className="truncate">
                                                                    {isRunning ? (
                                                                        <span className="text-orange-600 font-medium flex items-center gap-1">
                                                                            <RefreshCw className="w-3 h-3 animate-spin" /> läuft...
                                                                        </span>
                                                                    ) : val ? (
                                                                        <span className="ai-chip-v2 font-mono text-[11px]">{String(val)}</span>
                                                                    ) : (
                                                                        <span className="text-slate-400 italic text-[11px]">— leer —</span>
                                                                    )}
                                                                </span>
                                                                <button
                                                                    onClick={() => runCell(r.id, col.colDef)}
                                                                    disabled={isRunning}
                                                                    title={`Zelle für ${col.label} einzeln berechnen`}
                                                                    className="btn-v2 p-1 hover:bg-orange-50 border-orange-200 text-orange-600 rounded cursor-pointer shrink-0"
                                                                >
                                                                    <Play className="w-2.5 h-2.5 fill-current" />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span>{val !== null && val !== undefined && String(val).trim() !== '' ? String(val) : '—'}</span>
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

                    {/* Pagination */}
                    {!loading && !error && totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t text-xs text-slate-500" style={{ borderColor: 'var(--border)' }}>
                            <span>
                                Zeile {((page - 1) * PAGE_SIZE + 1).toLocaleString('de-DE')}–{Math.min(page * PAGE_SIZE, total).toLocaleString('de-DE')} von {total.toLocaleString('de-DE')}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="btn-v2"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                                <span>Seite {page} / {totalPages}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                    className="btn-v2"
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
                    onRunStarted={() => { loadPage(1); refreshCase(); }}
                />
            )}

            {showAddColModal && (
                <AddColumnModal
                    caseId={caseData.id}
                    onClose={() => setShowAddColModal(false)}
                    onColumnAdded={() => { refreshCase(); loadPage(page); }}
                />
            )}

            {showImportModal && (
                <ImportModal
                    caseId={caseData.id}
                    onClose={() => setShowImportModal(false)}
                    onImported={() => { refreshCase(); loadPage(1); }}
                />
            )}

            {editingCol && (
                <EditPromptModal
                    col={editingCol}
                    caseId={caseData.id}
                    onSave={(updated) => {
                        const nextCols = (caseData.ai_columns || []).map(c => c.id === updated.id ? updated : c);
                        apiFetch(`/api/cases/${caseData.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ai_columns: nextCols }),
                        }).then(() => {
                            refreshCase();
                            setEditingCol(null);
                        });
                    }}
                    onClose={() => setEditingCol(null)}
                />
            )}
        </AppLayout>
    );
}
