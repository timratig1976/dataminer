import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    ArrowLeft, Play, Download, Sparkles, RefreshCw, ChevronLeft, 
    ChevronRight, AlertCircle, Plus, Target, Upload, Database, Sliders, 
    Building2, UserCheck, Users, Globe, ExternalLink, Flame, RotateCcw
} from 'lucide-react';
import { Link } from '@inertiajs/react';
import { AgentGoalModal } from '../../Components/AgentGoalModal';
import { AddColumnModal } from '../../Components/AddColumnModal';
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
const TABS = ["Firmen", "Kontakte", "Suchen", "Quellen", "Log", "Export"] as const;
type TabType = typeof TABS[number];

export default function CaseShow({ case: c }: Props) {
    const [caseData, setCaseData] = useState<CaseDetail>(c);
    const [rows, setRows] = useState<RowItem[]>([]);
    const [total, setTotal] = useState(c.rows_count);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Active Tab (Exact match to Next.js tabs)
    const [activeTab, setActiveTab] = useState<TabType>("Firmen");

    // Modals
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [showAddColModal, setShowAddColModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingCol, setEditingCol] = useState<any | null>(null);
    const [showColVisibility, setShowColVisibility] = useState(false);
    const [manuallyHiddenCols, setManuallyHiddenCols] = useState<Set<string>>(new Set());

    // Execution states
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
        setStatusMsg(`Phase "${col.name}" an Queue-Worker übergeben...`);

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

    const visibleColumns = useMemo(() => {
        const map = new Map<string, any>();
        aiColHeaders.forEach(c => map.set(c.key, c));
        baseCols.forEach(c => {
            if (!map.has(c.key) && !manuallyHiddenCols.has(c.key)) map.set(c.key, c);
        });
        return Array.from(map.values());
    }, [aiColHeaders, baseCols, manuallyHiddenCols]);

    return (
        <AppLayout
            title={
                <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 font-mono">
                        {total} Zeilen · {baseCols.length} Quellspalten · <span style={{ color: "var(--green)", fontWeight: 500 }}>{aiColumns.length} KI-Spalten</span>
                    </span>
                </div>
            }
            actions={
                <div className="flex items-center gap-2">
                    <button onClick={() => setShowAgentModal(true)} className="btn-v2" style={{ background: "var(--orange-soft)", color: "var(--orange)", borderColor: "var(--orange-mid)", fontWeight: 500 }}>
                        <Target style={{ width: 12, height: 12 }} /> Leads finden & erweitern
                    </button>
                    <button onClick={() => setShowImportModal(true)} className="btn-v2">
                        <Upload style={{ width: 12, height: 12 }} /> Import
                    </button>
                    <a href={`/api/export?caseId=${caseData.id}`} className="btn-v2">
                        <Download style={{ width: 12, height: 12 }} /> Export
                    </a>

                    <div className="tsep-v2" />

                    {/* Primary Run Buttons */}
                    {aiColumns.length > 0 ? (
                        <div style={{ display: "flex", gap: 3 }}>
                            <button onClick={() => runPhase("company")} disabled={runningPhase !== null} className="btn-v2 btn-v2-primary">
                                <Building2 style={{ width: 12, height: 12 }} /> Firmen
                            </button>
                            <button onClick={() => runPhase("contact")} disabled={runningPhase !== null} className="btn-v2 btn-v2-ai">
                                <UserCheck style={{ width: 12, height: 12 }} /> Kontakte
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => setShowAddColModal(true)} className="btn-v2 btn-v2-primary">
                            ▶ Ausführen ▾
                        </button>
                    )}
                </div>
            }
        >
            {/* ── Table Workspace Container (Strict Match to Next.js UI) ── */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--surface)", margin: "0 0 18px", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--shadow)" }}>

                {/* Integrated Sheet Bar (Tabs directly on table) */}
                <div style={{ background: "#fbfaf8", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px", flexShrink: 0, height: 38 }}>
                    
                    {/* Sheet Tabs Left */}
                    <div style={{ display: "flex", alignItems: "flex-end", height: "100%", gap: 2 }}>
                        {TABS.map(t => {
                            const isActive = activeTab === t;
                            const count = t === "Firmen" ? total : undefined;
                            return (
                                <button 
                                    key={t} 
                                    onClick={() => setActiveTab(t)}
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        padding: "0 14px",
                                        height: 37,
                                        fontSize: 12,
                                        cursor: "pointer",
                                        border: "none",
                                        transition: "0.1s",
                                        userSelect: "none",
                                        color: isActive ? "var(--orange)" : "var(--text-2)",
                                        borderBottom: isActive ? "2px solid var(--orange)" : "2px solid transparent",
                                        fontWeight: isActive ? 600 : 400,
                                        background: isActive ? "var(--surface)" : "transparent",
                                        borderTopLeftRadius: isActive ? "var(--rs)" : 0,
                                        borderTopRightRadius: isActive ? "var(--rs)" : 0,
                                        borderLeft: isActive ? "1px solid var(--border-xs)" : "1px solid transparent",
                                        borderRight: isActive ? "1px solid var(--border-xs)" : "1px solid transparent",
                                        marginBottom: -1,
                                    }}
                                >
                                    <span>
                                        {t === "Firmen" ? "🏢 Firmen" : t === "Kontakte" ? "👤 Kontakte" : t === "Suchen" ? "🎯 Suchen" : t === "Quellen" ? "📚 Quellen" : t === "Log" ? "📜 Log" : "📤 Export"}
                                    </span>
                                    {count !== undefined && (
                                        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 8, background: isActive ? "var(--orange-soft)" : "var(--bg)", color: isActive ? "var(--orange)" : "var(--text-3)" }}>
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Table Controls Right */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 4 }}>
                        {activeTab === "Firmen" && (
                            <>
                                <button 
                                    onClick={() => { setRows(prev => prev.map(r => ({ ...r, cell_statuses: {}, cell_errors: {} }))); }}
                                    title="Alle Status zurücksetzen"
                                    className="btn-v2 btn-v2-ghost" 
                                    style={{ padding: "3px 7px", fontSize: 11.5 }}
                                >
                                    Reset
                                </button>

                                <button
                                    title="Spalten ein-/ausblenden"
                                    onClick={() => setShowColVisibility(v => !v)}
                                    className="btn-v2 btn-v2-ghost" 
                                    style={{ padding: "3px 7px", fontSize: 11.5, color: showColVisibility ? "var(--orange)" : "var(--text-2)" }}
                                >
                                    <Sliders style={{ width: 11, height: 11 }} /> Spalten
                                </button>

                                <button 
                                    onClick={() => setShowAddColModal(true)} 
                                    className="btn-v2 btn-v2-ai" 
                                    style={{ padding: "3px 9px", fontSize: 11.5 }}
                                >
                                    <Plus style={{ width: 12, height: 12 }} /> Spalte
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Banner when 0 AI Columns (Strict Match to Next.js UI) */}
                {aiColumns.length === 0 && activeTab === "Firmen" && (
                    <div style={{ background: "#fef9c3", borderBottom: "1px solid #fde68a", padding: "7px 16px", fontSize: 12, color: "#854d0e", display: "flex", alignItems: "center", gap: 8 }}>
                        <span>⚠️ Keine KI-Spalten —</span>
                        <button onClick={() => setShowAddColModal(true)} style={{ padding: "2px 8px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600, fontSize: 11.5 }}>
                            + Spalte hinzufügen
                        </button>
                    </div>
                )}

                {/* Tab: Firmen (Main Table) */}
                {activeTab === "Firmen" && (
                    <div className="overflow-x-auto max-h-[72vh]">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead 
                                className="sticky top-0 z-10 uppercase tracking-wider font-semibold text-[10.5px]"
                                style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", color: "var(--text-2)" }}
                            >
                                <tr>
                                    <th className="p-2.5 w-10 border-r text-center" style={{ borderColor: "var(--border)" }}>
                                        <input type="checkbox" style={{ accentColor: "var(--orange)" }} />
                                    </th>
                                    <th className="p-2.5 w-10 border-r text-center" style={{ borderColor: "var(--border)" }}>#</th>
                                    {visibleColumns.map(col => (
                                        <th 
                                            key={col.key} 
                                            className="p-2.5 border-r min-w-[150px]"
                                            style={{ 
                                                borderColor: "var(--border)",
                                                background: col.isAi ? "var(--orange-soft)" : "inherit",
                                                color: col.isAi ? "var(--orange)" : "inherit",
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
                                    <th className="p-2.5 w-24 text-slate-400 font-normal text-center cursor-pointer hover:bg-slate-100" onClick={() => setShowAddColModal(true)}>
                                        + Spalte
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y" style={{ borderColor: "var(--border-xs)" }}>
                                {loading ? (
                                    <tr>
                                        <td colSpan={visibleColumns.length + 3} className="p-12 text-center text-slate-400">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-orange-500" />
                                            Lade Tabellendaten...
                                        </td>
                                    </tr>
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={visibleColumns.length + 3} className="p-16 text-center text-slate-400 text-xs">
                                            Keine Zeilen. CSV importieren um zu starten.
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((r, idx) => (
                                        <tr key={r.id} className="hover:bg-[#faf9f7] transition-colors">
                                            <td className="p-2.5 border-r text-center" style={{ borderColor: "var(--border-xs)" }}>
                                                <input type="checkbox" style={{ accentColor: "var(--orange)" }} />
                                            </td>
                                            <td className="p-2.5 border-r text-center font-mono text-[10.5px] text-slate-400" style={{ borderColor: "var(--border-xs)" }}>
                                                {(page - 1) * PAGE_SIZE + idx + 1}
                                            </td>
                                            {visibleColumns.map(col => {
                                                const val = r.data[col.key];
                                                const status = r.cell_statuses?.[col.key];
                                                const isRunning = status === "running" || runningCells.has(`${r.id}:${col.key}`);

                                                return (
                                                    <td 
                                                        key={col.key} 
                                                        className="p-2.5 border-r truncate max-w-[280px]"
                                                        style={{ borderColor: "var(--border-xs)" }}
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
                                                                        <span className="text-slate-400 italic text-[11px]">—</span>
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
                                                            <span>{val !== null && val !== undefined && String(val).trim() !== "" ? String(val) : "—"}</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="p-2.5 border-r" style={{ borderColor: "var(--border-xs)" }} />
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Other Tabs Placeholder */}
                {activeTab !== "Firmen" && (
                    <div className="p-16 text-center text-slate-400 text-xs">
                        Ansicht für Tab <strong>{activeTab}</strong> wird geladen...
                    </div>
                )}

                {/* Pagination */}
                {!loading && totalPages > 1 && activeTab === "Firmen" && (
                    <div className="flex items-center justify-between px-4 py-2.5 bg-[#fbfaf8] border-t text-xs text-slate-500" style={{ borderColor: "var(--border)" }}>
                        <span>
                            Zeile {((page - 1) * PAGE_SIZE + 1).toLocaleString("de-DE")}–{Math.min(page * PAGE_SIZE, total).toLocaleString("de-DE")} von {total.toLocaleString("de-DE")}
                        </span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-v2">
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span>Seite {page} / {totalPages}</span>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-v2">
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            {showAgentModal && (
                <AgentGoalModal
                    caseId={caseData.id}
                    rowsCount={total}
                    onClose={() => setShowAgentModal(false)}
                    onImported={() => { loadPage(1); refreshCase(); }}
                />
            )}

            {showAddColModal && (
                <AddColumnModal
                    caseId={caseData.id}
                    onClose={() => setShowAddColModal(false)}
                    onAdded={() => { refreshCase(); loadPage(page); }}
                    availableFields={baseCols.map(c => c.key)}
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
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
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
