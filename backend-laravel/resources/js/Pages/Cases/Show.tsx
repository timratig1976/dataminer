import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    ArrowLeft, Play, Download, Sparkles, RefreshCw, ChevronLeft, 
    ChevronRight, AlertCircle, Plus, Target, Upload, Database, Sliders, 
    Building2, UserCheck, Users, Globe, ExternalLink, Flame, RotateCcw, GripVertical, Search, FileText, CheckCircle2, Clock
} from 'lucide-react';
import { Link } from '@inertiajs/react';
import { AgentGoalModal } from '../../Components/AgentGoalModal';
import { AddColumnModal } from '../../Components/AddColumnModal';
import ImportModal from '../../Components/ImportModal';
import { ExportModal } from '../../Components/ExportModal';
import EditPromptModal from '../../Components/case/EditPromptModal';
import RunDetailModal from '../../Components/case/RunDetailModal';
import { ColumnHeaderMenu } from '../../Components/ColumnHeaderMenu';
import GroupedTableView from '../../Components/GroupedTableView';
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

const COL_LABELS: Record<string, string> = {
    company_name: "Firma",
    contacts: "Kontakt",
    domain: "Domain",
    phone: "Telefon",
    email: "E-Mail",
    company_email: "E-Mail (Firma)",
    contact_email: "E-Mail (Kontakt)",
    address: "Adresse",
    city: "Stadt",
    zip: "PLZ",
    industry: "Branche",
    description: "Beschreibung",
    employees: "Mitarbeiter",
    founded: "Gründungsjahr",
    first_name: "Vorname",
    last_name: "Nachname",
    position: "Position",
    linkedin: "LinkedIn",
    maps_url: "🗺 Maps-Link",
    maps_rating: "★ Rating",
    maps_reviews: "Bewertungen",
    category: "Kategorie",
    _scrape_cached_ts: "⚡ Cache-Status",
};

export default function CaseShow({ case: c }: Props) {
    const [caseData, setCaseData] = useState<CaseDetail>(c);
    const [rows, setRows] = useState<RowItem[]>([]);
    const [total, setTotal] = useState(c.rows_count);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Active Tab & View Mode
    const [activeTab, setActiveTab] = useState<TabType>("Firmen");
    const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');

    // Tab-Specific Data
    const [contactRows, setContactRows] = useState<any[]>([]);
    const [contactRowsLoading, setContactRowsLoading] = useState(false);
    const [agentRuns, setAgentRuns] = useState<any[]>([]);
    const [agentRunsLoading, setAgentRunsLoading] = useState(false);
    const [logs, setLogs] = useState<any[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);

    // Modals
    const [showAgentModal, setShowAgentModal] = useState(false);
    const [showAddColModal, setShowAddColModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [editingCol, setEditingCol] = useState<any | null>(null);
    const [runDetailCell, setRunDetailCell] = useState<{ col: any; row: any } | null>(null);
    const [cacheModalRow, setCacheModalRow] = useState<RowItem | null>(null);
    const [cacheModalEntries, setCacheModalEntries] = useState<Array<{url:string; title?:string; length:number; markdown:string; fetchedAt:string}>>([]);
    const [cacheModalLoading, setCacheModalLoading] = useState(false);

    // Column Management, Visibility & Resizing
    const [showColVisibility, setShowColVisibility] = useState(false);
    const [manuallyHiddenCols, setManuallyHiddenCols] = useState<Set<string>>(new Set());
    const [colOrder, setColOrder] = useState<string[]>(c.col_order || []);
    const [colWidths, setColWidths] = useState<Record<string, number>>({});
    const [dragCol, setDragCol] = useState<string | null>(null);
    const [dragOverCol, setDragOverCol] = useState<string | null>(null);

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
            if (data.col_order && data.col_order.length > 0) {
                setColOrder(data.col_order);
            }
        } catch (e) {
            console.error('Failed to reload case', e);
        }
    };

    useEffect(() => { loadPage(page); }, [page, loadPage]);

    // Tab Data Fetching
    useEffect(() => {
        if (activeTab === "Kontakte") {
            setContactRowsLoading(true);
            apiFetch(`/api/contact-rows?caseId=${caseData.id}`)
                .then(r => r.json())
                .then(d => setContactRows(d.contacts || []))
                .catch(() => setContactRows([]))
                .finally(() => setContactRowsLoading(false));
        } else if (activeTab === "Suchen") {
            setAgentRunsLoading(true);
            apiFetch(`/api/cases/${caseData.id}/agent`)
                .then(r => r.json())
                .then(d => setAgentRuns(Array.isArray(d) ? d : []))
                .catch(() => setAgentRuns([]))
                .finally(() => setAgentRunsLoading(false));
        } else if (activeTab === "Log") {
            setLogsLoading(true);
            apiFetch(`/api/logs?caseId=${caseData.id}&limit=200`)
                .then(r => r.json())
                .then(d => setLogs(Array.isArray(d) ? d : []))
                .catch(() => setLogs([]))
                .finally(() => setLogsLoading(false));
        }
    }, [activeTab, caseData.id]);

    // Handle Drag & Drop Column Reordering
    const handleColDrop = async (targetKey: string) => {
        if (!dragCol || dragCol === targetKey) return;
        const currentOrder = visibleColumns.map(c => c.key);
        const from = currentOrder.indexOf(dragCol);
        const to = currentOrder.indexOf(targetKey);
        if (from === -1 || to === -1) return;

        const next = [...currentOrder];
        next.splice(from, 1);
        next.splice(to, 0, dragCol);

        setColOrder(next);
        setDragCol(null);
        setDragOverCol(null);

        await apiFetch(`/api/cases/${caseData.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ col_order: next }),
        });
    };

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

    // Run entire column
    const runColumn = async (col: any, mode: 'all_force' | 'empty_only' = 'empty_only') => {
        try {
            setStatusMsg(`Spalte "${col.name}" wird an die Worker-Queue übergeben...`);
            const res = await apiFetch('/api/run/column', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caseId: caseData.id,
                    columnId: col.id,
                    runMode: mode,
                }),
            });
            const data = await res.json();
            setStatusMsg(data.message || 'Ausführung gestartet');
            setTimeout(() => setStatusMsg(null), 5000);
            loadPage(page);
        } catch (e: any) {
            alert('Fehler: ' + e.message);
        }
    };

    // Delete column
    const deleteColumn = async (colId: string) => {
        if (!confirm('Diese KI-Spalte wirklich löschen?')) return;
        try {
            await apiFetch(`/api/cases/${caseData.id}/delete-column`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ columnId: colId }),
            });
            refreshCase();
        } catch (e: any) {
            alert('Löschen fehlgeschlagen: ' + e.message);
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

    // Catalog Rows filter for Quellen Tab
    const catalogRows = useMemo(() => {
        return rows.filter(r => r.data['is_catalog'] === 'true' || r.data['is_catalog'] === true);
    }, [rows]);

    // Columns calculation
    const aiColumns = caseData.ai_columns || [];
    const baseCols = caseData.columns && caseData.columns.length > 0 
        ? caseData.columns.map(c => ({ key: c.key, label: c.label, isAi: false }))
        : (rows[0] ? Object.keys(rows[0].data).filter(k => !k.startsWith('_')).map(k => ({ key: k, label: COL_LABELS[k] ?? k, isAi: false })) : []);

    const aiColHeaders = aiColumns.map(c => ({
        key: c.outputKey,
        label: c.name,
        isAi: true,
        colDef: c,
    }));

    const visibleColumns = useMemo(() => {
        const colMap = new Map<string, any>();
        aiColHeaders.forEach(c => colMap.set(c.key, c));
        baseCols.forEach(c => {
            if (!colMap.has(c.key)) colMap.set(c.key, c);
        });

        if (colOrder.length > 0) {
            const ordered: any[] = [];
            colOrder.forEach(k => {
                if (colMap.has(k) && !manuallyHiddenCols.has(k)) {
                    ordered.push(colMap.get(k));
                    colMap.delete(k);
                }
            });
            colMap.forEach((col, k) => {
                if (!manuallyHiddenCols.has(k)) ordered.push(col);
            });
            return ordered;
        }

        return Array.from(colMap.values()).filter(c => !manuallyHiddenCols.has(c.key));
    }, [aiColHeaders, baseCols, colOrder, manuallyHiddenCols]);

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
                    <button onClick={() => setShowExportModal(true)} className="btn-v2">
                        <Download style={{ width: 12, height: 12 }} /> Export
                    </button>

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
                            const count = t === "Firmen" ? total : t === "Kontakte" ? (contactRows.length || undefined) : t === "Quellen" ? (catalogRows.length || undefined) : undefined;
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
                                <div style={{ display: "flex", gap: 1, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--rs)", padding: 2 }}>
                                    <button 
                                        onClick={() => setViewMode("flat")}
                                        style={{
                                            padding: "2px 8px", borderRadius: 3, fontSize: 11, cursor: "pointer", border: "none", transition: "0.1s",
                                            background: viewMode === "flat" ? "var(--surface)" : "transparent",
                                            color: viewMode === "flat" ? "var(--text-1)" : "var(--text-2)",
                                            boxShadow: viewMode === "flat" ? "var(--shadow-sm)" : "none",
                                            fontWeight: viewMode === "flat" ? 600 : 400
                                        }}
                                    >
                                        Flach
                                    </button>
                                    <button 
                                        onClick={() => setViewMode("grouped")}
                                        style={{
                                            padding: "2px 8px", borderRadius: 3, fontSize: 11, cursor: "pointer", border: "none", transition: "0.1s",
                                            background: viewMode === "grouped" ? "var(--surface)" : "transparent",
                                            color: viewMode === "grouped" ? "var(--text-1)" : "var(--text-2)",
                                            boxShadow: viewMode === "grouped" ? "var(--shadow-sm)" : "none",
                                            fontWeight: viewMode === "grouped" ? 600 : 400
                                        }}
                                    >
                                        Gruppiert
                                    </button>
                                </div>

                                <button 
                                    onClick={() => { setRows(prev => prev.map(r => ({ ...r, cell_statuses: {}, cell_errors: {} }))); }}
                                    title="Alle Status zurücksetzen"
                                    className="btn-v2 btn-v2-ghost" 
                                    style={{ padding: "3px 7px", fontSize: 11.5 }}
                                >
                                    Reset
                                </button>

                                {/* Spalten Dropdown Toggle */}
                                <div style={{ position: "relative" }}>
                                    <button
                                        title="Spalten ein-/ausblenden"
                                        onClick={() => setShowColVisibility(v => !v)}
                                        className="btn-v2 btn-v2-ghost" 
                                        style={{ 
                                            padding: "3px 7px", 
                                            fontSize: 11.5, 
                                            borderColor: showColVisibility ? "var(--orange)" : "var(--border)",
                                            color: showColVisibility ? "var(--orange)" : "var(--text-2)",
                                            background: showColVisibility ? "var(--orange-soft)" : "transparent"
                                        }}
                                    >
                                        <Sliders style={{ width: 11, height: 11 }} /> Spalten
                                        {manuallyHiddenCols.size > 0 && (
                                            <span className="badge-v2 badge-v2-orange" style={{ marginLeft: 3 }}>
                                                {manuallyHiddenCols.size}
                                            </span>
                                        )}
                                    </button>

                                    {/* Spalten Visibility Dropdown Panel */}
                                    {showColVisibility && (
                                        <div 
                                            style={{
                                                position: "absolute",
                                                top: "calc(100% + 4px)",
                                                right: 0,
                                                background: "var(--surface)",
                                                border: "1px solid var(--border)",
                                                borderRadius: "var(--r)",
                                                boxShadow: "var(--shadow)",
                                                zIndex: 500,
                                                minWidth: 260,
                                                maxHeight: 460,
                                                overflowY: "auto",
                                                padding: 10,
                                            }}
                                            onMouseLeave={() => setShowColVisibility(false)}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 2px 8px", borderBottom: "1px solid var(--border-xs)", marginBottom: 6 }}>
                                                <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                                    Spalten verwalten
                                                </span>
                                                <div style={{ display: "flex", gap: 6 }}>
                                                    {manuallyHiddenCols.size > 0 && (
                                                        <button 
                                                            onClick={() => setManuallyHiddenCols(new Set())} 
                                                            style={{ border: "none", background: "none", fontSize: 11, color: "var(--orange)", cursor: "pointer", fontWeight: 500 }}
                                                        >
                                                            Alle zeigen
                                                        </button>
                                                    )}
                                                    <button 
                                                        onClick={() => { setColOrder([]); setManuallyHiddenCols(new Set()); setShowColVisibility(false); }} 
                                                        style={{ border: "none", background: "none", fontSize: 11, color: "var(--text-3)", cursor: "pointer" }}
                                                    >
                                                        ↺ Reset
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Source Columns */}
                                            {baseCols.length > 0 && (
                                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", padding: "4px 2px", marginBottom: 2 }}>
                                                    Quelldaten
                                                </div>
                                            )}
                                            {baseCols.map(c => (
                                                <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: "var(--rs)", cursor: "pointer", fontSize: 12, color: "var(--text-1)" }}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={!manuallyHiddenCols.has(c.key)} 
                                                        onChange={() => {
                                                            setManuallyHiddenCols(prev => {
                                                                const next = new Set(prev);
                                                                next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                                                                return next;
                                                            });
                                                        }} 
                                                        style={{ accentColor: "var(--orange)" }}
                                                    />
                                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {c.label}
                                                    </span>
                                                </label>
                                            ))}

                                            {/* AI Columns */}
                                            {aiColumns.length > 0 && (
                                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--green)", textTransform: "uppercase", padding: "8px 2px 2px", marginBottom: 2, borderTop: "1px solid var(--border-xs)", marginTop: 6 }}>
                                                    KI-Spalten
                                                </div>
                                            )}
                                            {aiColumns.map(c => (
                                                <label key={c.outputKey} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: "var(--rs)", cursor: "pointer", fontSize: 12, color: "var(--green)" }}>
                                                    <input 
                                                        type="checkbox" 
                                                        checked={!manuallyHiddenCols.has(c.outputKey)} 
                                                        onChange={() => {
                                                            setManuallyHiddenCols(prev => {
                                                                const next = new Set(prev);
                                                                next.has(c.outputKey) ? next.delete(c.outputKey) : next.add(c.outputKey);
                                                                return next;
                                                            });
                                                        }} 
                                                        style={{ accentColor: "var(--green)" }}
                                                    />
                                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                                                        {c.name}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>

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

                {/* ══ TAB 1: FIRMEN ══ */}
                {activeTab === "Firmen" && viewMode === "grouped" && (
                    <GroupedTableView caseId={caseData.id} />
                )}

                {activeTab === "Firmen" && viewMode === "flat" && (
                    <div className="overflow-x-auto max-h-[72vh]">
                        <table 
                            className="text-left border-collapse text-xs"
                            style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}
                        >
                            <thead 
                                className="sticky top-0 z-10 uppercase tracking-wider font-semibold text-[10.5px]"
                                style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", color: "var(--text-2)" }}
                            >
                                <tr>
                                    <th className="p-2.5 w-10 border-r text-center" style={{ borderColor: "var(--border)" }}>
                                        <input type="checkbox" style={{ accentColor: "var(--orange)" }} />
                                    </th>
                                    <th className="p-2.5 w-10 border-r text-center" style={{ borderColor: "var(--border)" }}>#</th>
                                    {visibleColumns.map(col => {
                                        const isDragOver = dragOverCol === col.key;
                                        const colWidth = colWidths[col.key] ?? (col.key === 'company_name' ? 200 : col.isAi ? 180 : 140);

                                        return (
                                            <th 
                                                key={col.key} 
                                                draggable
                                                onDragStart={() => setDragCol(col.key)}
                                                onDragOver={e => { e.preventDefault(); setDragOverCol(col.key); }}
                                                onDragLeave={() => setDragOverCol(null)}
                                                onDrop={() => handleColDrop(col.key)}
                                                className="p-2 border-r transition-all cursor-grab active:cursor-grabbing select-none relative"
                                                style={{ 
                                                    borderColor: "var(--border)",
                                                    background: isDragOver ? "var(--orange-mid)" : col.isAi ? "var(--orange-soft)" : "inherit",
                                                    color: col.isAi ? "var(--orange)" : "inherit",
                                                    borderLeft: isDragOver ? "2px solid var(--orange)" : undefined,
                                                    width: colWidth,
                                                    minWidth: colWidth,
                                                    maxWidth: colWidth,
                                                }}
                                            >
                                                {/* ↔ Column Resize Handle */}
                                                <div
                                                    className="hover:bg-orange-400 active:bg-orange-600 transition-colors"
                                                    style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 30 }}
                                                    onMouseDown={e => {
                                                        e.stopPropagation(); e.preventDefault();
                                                        const startX = e.clientX;
                                                        const startW = colWidth;
                                                        const onMove = (ev: MouseEvent) => {
                                                            const w = Math.max(60, startW + ev.clientX - startX);
                                                            setColWidths(prev => ({ ...prev, [col.key]: w }));
                                                        };
                                                        const onUp = () => {
                                                            window.removeEventListener("mousemove", onMove);
                                                            window.removeEventListener("mouseup", onUp);
                                                        };
                                                        window.addEventListener("mousemove", onMove);
                                                        window.addEventListener("mouseup", onUp);
                                                    }}
                                                />

                                                <div className="flex items-center gap-1.5 justify-between">
                                                    <div className="flex items-center gap-1 min-w-0">
                                                        <GripVertical className="w-3 h-3 text-slate-400 shrink-0 opacity-40 hover:opacity-100" />
                                                        <span className="truncate font-semibold">{col.label}</span>
                                                    </div>
                                                    {col.isAi && (
                                                        <ColumnHeaderMenu
                                                            column={col.colDef}
                                                            onRunAll={() => runColumn(col.colDef, "all_force")}
                                                            onRunEmptyOnly={() => runColumn(col.colDef, "empty_only")}
                                                            onDelete={() => deleteColumn(col.colDef.id)}
                                                            onEdit={() => setEditingCol(col.colDef)}
                                                        />
                                                    )}
                                                </div>
                                            </th>
                                        );
                                    })}
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
                                                        className={`p-2.5 border-r truncate ${col.isAi ? 'cursor-pointer hover:bg-orange-50/40' : ''}`}
                                                        style={{ 
                                                            borderColor: "var(--border-xs)",
                                                            width: colWidths[col.key] ? `${colWidths[col.key]}px` : undefined,
                                                            maxWidth: colWidths[col.key] ? `${colWidths[col.key]}px` : undefined
                                                        }}
                                                        onClick={() => {
                                                            if (col.isAi) {
                                                                const normalizedRow = {
                                                                    ...r,
                                                                    cellStatuses: r.cell_statuses || (r as any).cellStatuses || {},
                                                                    cellErrors: r.cell_errors || (r as any).cellErrors || {}
                                                                };
                                                                setRunDetailCell({ col: col.colDef, row: normalizedRow as any });
                                                            }
                                                        }}
                                                    >
                                                        {col.key === "_scrape_cached_ts" ? (
                                                            val ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setCacheModalRow(r);
                                                                        setCacheModalLoading(true);
                                                                        const d = r.data["domain"] ?? r.data["source_domain"] ?? "";
                                                                        apiFetch(`/api/cache?domain=${encodeURIComponent(d)}`)
                                                                            .then(res => res.json())
                                                                            .then(data => setCacheModalEntries(data.entries ?? []))
                                                                            .catch(() => setCacheModalEntries([]))
                                                                            .finally(() => setCacheModalLoading(false));
                                                                    }}
                                                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded cursor-pointer hover:bg-emerald-100 transition-colors"
                                                                >
                                                                    ⚡ Gecached ({r.data["_scrape_origin"] || 'db'})
                                                                </button>
                                                            ) : (
                                                                <span className="text-slate-400 italic text-[11px]">—</span>
                                                            )
                                                        ) : col.isAi ? (
                                                            <div 
                                                                className="flex items-center justify-between gap-1.5 group/cell"
                                                                title="Klicken für Prompt, Token, Rohdaten & Rerun"
                                                            >
                                                                <span className="truncate">
                                                                    {isRunning ? (
                                                                        <span className="text-orange-600 font-medium flex items-center gap-1">
                                                                            <RefreshCw className="w-3 h-3 animate-spin" /> läuft...
                                                                        </span>
                                                                    ) : val ? (
                                                                        <span className="ai-chip-v2 font-mono text-[11px] hover:underline">{String(val)}</span>
                                                                    ) : (
                                                                        <span className="text-slate-400 italic text-[11px] hover:text-slate-600">— leer (Klick für Details) —</span>
                                                                    )}
                                                                </span>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        runCell(r.id, col.colDef);
                                                                    }}
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

                {/* ══ TAB 2: KONTAKTE ══ */}
                {activeTab === "Kontakte" && (
                    <div className="flex-1 overflow-auto p-4">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold text-slate-700">
                                {contactRows.length} gefundene Ansprechpartner
                            </span>
                            <button
                                onClick={async () => {
                                    const res = await apiFetch('/api/contact-rows/cleanup', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ caseId: caseData.id }),
                                    });
                                    const data = await res.json();
                                    alert(data.message || 'Kontakte extrahiert');
                                    // Refresh contacts
                                    apiFetch(`/api/contact-rows?caseId=${caseData.id}`).then(r => r.json()).then(d => setContactRows(d.contacts || []));
                                }}
                                className="btn-v2 btn-v2-ai"
                            >
                                ⚡ Aus Firmendaten extrahieren
                            </button>
                        </div>

                        {contactRowsLoading ? (
                            <div className="p-12 text-center text-xs text-slate-400">Lade Kontakte...</div>
                        ) : contactRows.length === 0 ? (
                            <div className="p-12 text-center text-xs text-slate-400">
                                Noch keine Kontakte vorhanden. Führe die Phase "👤 Kontakte" aus oder klicke auf "Aus Firmendaten extrahieren".
                            </div>
                        ) : (
                            <div className="border rounded-lg overflow-hidden shadow-xs" style={{ borderColor: 'var(--border)' }}>
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead className="bg-[#fbfaf8] border-b text-[10.5px] uppercase font-semibold text-slate-600" style={{ borderColor: 'var(--border)' }}>
                                        <tr>
                                            <th className="p-2.5 w-10 border-r">#</th>
                                            <th className="p-2.5 border-r">Name / Ansprechpartner</th>
                                            <th className="p-2.5 border-r">Position</th>
                                            <th className="p-2.5 border-r">E-Mail</th>
                                            <th className="p-2.5 border-r">Telefon</th>
                                            <th className="p-2.5 border-r">LinkedIn</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y" style={{ borderColor: 'var(--border-xs)' }}>
                                        {contactRows.map((c, i) => (
                                            <tr key={c.id || i} className="hover:bg-[#faf9f7]">
                                                <td className="p-2.5 border-r font-mono text-slate-400">{i + 1}</td>
                                                <td className="p-2.5 border-r font-semibold text-slate-900">{c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}</td>
                                                <td className="p-2.5 border-r text-slate-600">{c.position || '—'}</td>
                                                <td className="p-2.5 border-r font-mono text-orange-600">{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td>
                                                <td className="p-2.5 border-r font-mono text-slate-600">{c.phone || '—'}</td>
                                                <td className="p-2.5 border-r text-blue-600">
                                                    {c.linkedin ? <a href={c.linkedin.startsWith('http') ? c.linkedin : `https://${c.linkedin}`} target="_blank" rel="noreferrer">🔗 LinkedIn</a> : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ══ TAB 3: SUCHEN (Agent Discovery Runs) ══ */}
                {activeTab === "Suchen" && (
                    <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-sm text-slate-900">Autonome Discovery-Läufe</h3>
                                <p className="text-xs text-slate-500">Historie aller KI-Recherchen via Google Search & Maps</p>
                            </div>
                            <button onClick={() => setShowAgentModal(true)} className="btn-v2 btn-v2-primary">
                                + Neue Suche starten
                            </button>
                        </div>

                        {agentRunsLoading ? (
                            <div className="p-12 text-center text-xs text-slate-400">Lade Suchen...</div>
                        ) : agentRuns.length === 0 ? (
                            <div className="p-12 text-center text-xs text-slate-400 border rounded-lg bg-slate-50">
                                Bislang keine Discovery-Läufe in diesem Case. Klicke auf "+ Neue Suche starten", um Leads zu finden.
                            </div>
                        ) : (
                            agentRuns.map((run) => (
                                <div key={run.id} className="p-4 rounded-xl border bg-white shadow-xs space-y-2" style={{ borderColor: 'var(--border)' }}>
                                    <div className="flex items-center justify-between">
                                        <div className="font-semibold text-xs text-slate-900 flex items-center gap-2">
                                            <span>🎯 {run.goal}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${run.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-orange-50 text-orange-700 border border-orange-200'}`}>
                                                {run.status}
                                            </span>
                                        </div>
                                        <span className="text-[11px] text-slate-400 font-mono">
                                            {new Date(run.created_at).toLocaleString('de-DE')}
                                        </span>
                                    </div>
                                    <div className="text-xs text-slate-500 flex items-center gap-4">
                                        <span>Schritte: {run.state?.current_step_index || 0} / {run.state?.total_steps || 0}</span>
                                        <span>•</span>
                                        <span>Gefundene Leads: <strong className="text-emerald-600">{run.state?.rows_added || 0}</strong></span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* ══ TAB 4: QUELLEN (Katalogseiten & Deep Crawl) ══ */}
                {activeTab === "Quellen" && (
                    <div className="flex-1 overflow-y-auto p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-sm text-slate-900">📚 Gefundene Kataloge & Verzeichnisse ({catalogRows.length})</h3>
                                <p className="text-xs text-slate-500">Katalog-URLs können für Deep-Crawling genutzt werden, um alle Sub-Firmen einzulesen.</p>
                            </div>
                            <button
                                onClick={async () => {
                                    const res = await apiFetch(`/api/cases/${caseData.id}/deep-crawl-catalogs`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ maxCatalogs: 10 }),
                                    });
                                    const data = await res.json();
                                    alert(data.message || 'Deep Crawl abgeschlossen');
                                    loadPage(page);
                                }}
                                disabled={catalogRows.length === 0}
                                className="btn-v2 btn-v2-primary"
                            >
                                ⚡ Alle Kataloge tiefen-scrapen
                            </button>
                        </div>

                        {catalogRows.length === 0 ? (
                            <div className="p-12 text-center text-xs text-slate-400 border rounded-lg bg-slate-50">
                                Keine Verzeichnis- oder Katalog-URLs in diesem Case vorhanden.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {catalogRows.map((r) => (
                                    <div key={r.id} className="p-3 rounded-lg border bg-white flex items-center justify-between text-xs" style={{ borderColor: 'var(--border)' }}>
                                        <div>
                                            <div className="font-semibold">{r.data['company_name'] || r.data['domain']}</div>
                                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">{r.data['source_url'] || r.data['domain']}</div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const res = await apiFetch(`/api/cases/${caseData.id}/scrape-catalog`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ url: r.data['source_url'] || r.data['domain'] }),
                                                });
                                                const data = await res.json();
                                                alert(data.message || 'Scrape fertig');
                                                loadPage(page);
                                            }}
                                            className="btn-v2"
                                        >
                                            Scrapen
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ══ TAB 5: LOG ══ */}
                {activeTab === "Log" && (
                    <div className="flex-1 overflow-y-auto p-5 space-y-3 font-mono text-xs">
                        <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-xs)' }}>
                            <span className="font-semibold text-slate-700">📜 Case Ausführungsprotokoll</span>
                            <button
                                onClick={async () => {
                                    await apiFetch(`/api/logs?caseId=${caseData.id}`, { method: 'DELETE' });
                                    setLogs([]);
                                }}
                                className="text-[11px] text-rose-600 hover:underline cursor-pointer"
                            >
                                Logs leeren
                            </button>
                        </div>

                        {logsLoading ? (
                            <div className="p-8 text-center text-slate-400">Lade Protokolle...</div>
                        ) : logs.length === 0 ? (
                            <div className="p-8 text-center text-slate-400">Keine Protokolleinträge vorhanden.</div>
                        ) : (
                            <div className="space-y-1.5 bg-slate-950 text-slate-200 p-4 rounded-xl max-h-[65vh] overflow-y-auto">
                                {logs.map((l, i) => (
                                    <div key={l.id || i} className="flex items-start gap-3 text-[11.5px] leading-relaxed">
                                        <span className="text-slate-500 shrink-0">{new Date(l.createdAt).toLocaleTimeString('de-DE')}</span>
                                        <span className="text-emerald-400">▶</span>
                                        <span className="text-slate-300 break-all">{l.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ══ TAB 6: EXPORT ══ */}
                {activeTab === "Export" && (
                    <div className="flex-1 overflow-y-auto p-6 space-y-5">
                        <div className="max-w-md p-5 rounded-xl border bg-white shadow-xs space-y-3" style={{ borderColor: 'var(--border)' }}>
                            <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                                <Download className="w-4 h-4 text-orange-500" />
                                CSV-Tabelle exportieren
                            </h3>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                Lädt alle aktuellen Firmendaten und angereicherten Spalten als kommagetrennte CSV-Datei herunter.
                            </p>
                            <a
                                href={`/api/export?caseId=${caseData.id}`}
                                className="btn-v2 btn-v2-primary inline-flex"
                            >
                                <Download className="w-3.5 h-3.5" />
                                CSV herunterladen ({total} Zeilen)
                            </a>
                        </div>

                        <div className="max-w-md p-5 rounded-xl border bg-white shadow-xs space-y-3" style={{ borderColor: 'var(--border)' }}>
                            <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                                <Database className="w-4 h-4 text-emerald-600" />
                                Vollständiger JSON-Snapshot
                            </h3>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                Sichert den kompletten Case inklusive aller Zeilen, KI-Spalten, Zellstatus und Metadaten in einer portablen JSON-Datei.
                            </p>
                            <a
                                href={`/api/export/snapshot?caseId=${caseData.id}`}
                                className="btn-v2 inline-flex"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Snapshot herunterladen (.json)
                            </a>
                        </div>
                    </div>
                )}

                {/* Pagination (Only on Firmen Tab) */}
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
                    onImported={(count) => { refreshCase(); loadPage(1); }}
                />
            )}

            {showExportModal && (
                <ExportModal
                    caseId={caseData.id}
                    caseData={{
                        ...caseData,
                        aiColumns: (caseData.ai_columns || (caseData as any).aiColumns || [])
                    } as any}
                    sourceColumns={baseCols.map(c => c.key)}
                    colOrder={colOrder}
                    onClose={() => setShowExportModal(false)}
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

            {/* 🔍 RunDetailModal */}
            {runDetailCell && (
                <RunDetailModal
                    col={runDetailCell.col}
                    row={runDetailCell.row}
                    caseId={caseData.id}
                    onClose={() => setRunDetailCell(null)}
                    onRowUpdate={(rowId, patch) => {
                        setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...patch } : r));
                        setRunDetailCell(prev => prev && prev.row.id === rowId ? { ...prev, row: { ...prev.row, ...patch } } : prev);
                    }}
                />
            )}

            {/* ⚡ Cache Inspector Modal */}
            {cacheModalRow && (
                <div 
                    className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in"
                    onClick={() => setCacheModalRow(null)}
                >
                    <div 
                        className="w-full max-w-3xl rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-xs)' }}>
                            <div>
                                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
                                    ⚡ Gecachte Scrape-Daten für {cacheModalRow.data['company_name'] || cacheModalRow.data['domain'] || 'Zeile'}
                                </h3>
                                <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                                    Domain: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-800">{cacheModalRow.data['domain'] || 'keine Domain'}</code> · Kosten dieser Daten: <span className="font-semibold text-emerald-600">$0,00 (aus PostgreSQL scrape_cache)</span>
                                </div>
                            </div>
                            <button onClick={() => setCacheModalRow(null)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                                ✕
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {cacheModalLoading ? (
                                <div className="p-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                                    Lade PostgreSQL Cache-Einträge…
                                </div>
                            ) : cacheModalEntries.length === 0 ? (
                                <div className="p-8 text-center text-xs rounded-lg bg-slate-50 border text-slate-500" style={{ borderColor: 'var(--border-xs)' }}>
                                    Kein direkter PostgreSQL-Cache-Eintrag für diese Domain gefunden.
                                </div>
                            ) : (
                                cacheModalEntries.map((entry, idx) => (
                                    <div key={idx} className="border rounded-lg overflow-hidden shadow-xs" style={{ borderColor: 'var(--border)' }}>
                                        <div className="p-2.5 bg-slate-50 border-b flex items-center justify-between text-xs" style={{ borderColor: 'var(--border-xs)' }}>
                                            <div className="font-mono text-[11px] truncate flex-1 pr-2" style={{ color: 'var(--text-1)' }}>
                                                🔗 {entry.url}
                                            </div>
                                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
                                                ⚡ $0 Re-use (Gecacht: {new Date(entry.fetchedAt).toLocaleDateString('de-DE')})
                                            </span>
                                        </div>
                                        <div className="p-3 bg-white text-[11px] font-mono leading-relaxed overflow-y-auto max-h-56 whitespace-pre-wrap select-text text-slate-700">
                                            {entry.markdown}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
}
