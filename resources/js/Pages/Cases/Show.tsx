import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    ArrowLeft, Play, Download, Sparkles, RefreshCw, ChevronLeft, 
    ChevronRight, AlertCircle, Plus, Target, Upload, Database, Sliders, 
    Building2, UserCheck, Users, Globe, ExternalLink, Flame, RotateCcw, GripVertical, 
    Search, FileText, CheckCircle2, Clock, Trash2, Loader2, Edit2, Check, X, Square, OctagonAlert, ChevronDown
} from 'lucide-react';
import { Link } from '@inertiajs/react';
import { AgentGoalModal } from '../../Components/AgentGoalModal';
import { AddColumnModal } from '../../Components/AddColumnModal';
import ImportModal from '../../Components/ImportModal';
import { ExportModal } from '../../Components/ExportModal';
import EditPromptModal from '../../Components/case/EditPromptModal';
import RunDetailModal from '../../Components/case/RunDetailModal';
import { ColumnHeaderMenu } from '../../Components/ColumnHeaderMenu';
import { BaseColumnHeaderMenu } from '../../Components/BaseColumnHeaderMenu';
import GroupedTableView from '../../Components/GroupedTableView';
import ConfirmDialog from '../../Components/ui/ConfirmDialog';
import CostDashboard from '../../Components/case/CostDashboard';
import DataflowModal from '../../Components/case/DataflowModal';
import { apiFetch } from '../../api';
import { getColumnLabel } from '../../lib/columns';

const CONTACT_CORE_KEYS = [
    "company_name",
    "first_name",
    "last_name",
    "position",
    "email",
    "email_extrapolated",
    "phone",
    "linkedin",
    "domain",
    "city",
    "source",
];

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

const DEFAULT_BASE_KEYS = [
    'company_name',
    'domain',
    'maps_url',
    '_scrape_cached_ts',
    'industry',
    'address',
    'zip',
    'city',
    'phone',
    'company_email',
    'maps_rating',
    'category',
    'maps_reviews',
    'description',
    'employees',
    'founded',
];

export default function CaseShow({ case: c }: Props) {
    const [caseData, setCaseData] = useState<CaseDetail>(c);
    const [rows, setRows] = useState<RowItem[]>([]);
    const [total, setTotal] = useState(c.rows_count);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('dataminer_page_size');
            return saved ? parseInt(saved, 10) : 100;
        } catch {
            return 100;
        }
    });
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
    const [selectedAgentRunId, setSelectedAgentRunId] = useState<string | null>(null);
    const [apiToast, setApiToast] = useState<{ type: 'error' | 'warn' | 'success'; message: string } | null>(null);
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
    const [stoppingProcess, setStoppingProcess] = useState(false);
    const [showRunMenu, setShowRunMenu] = useState(false);

    // Row selection for bulk actions
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

    // Two-Step Confirmation State
    const [confirmDeleteRows, setConfirmDeleteRows] = useState(false);
    const [columnToDelete, setColumnToDelete] = useState<any | null>(null);
    const [dataColumnToDelete, setDataColumnToDelete] = useState<{
        key: string;
        label: string;
        filledCount: number;
        isReferenced: boolean;
        isCore: boolean;
    } | null>(null);

    // Rename case state
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(c.name);
    const [savingName, setSavingName] = useState(false);

    useEffect(() => {
        if (!isEditingName) {
            setEditedName(caseData.name);
        }
    }, [caseData.name, isEditingName]);

    const handleSaveName = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const trimmed = editedName.trim();
        if (!trimmed || trimmed === caseData.name) {
            setIsEditingName(false);
            setEditedName(caseData.name);
            return;
        }

        setSavingName(true);
        try {
            const res = await apiFetch(`/api/cases/${caseData.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmed }),
            });
            if (res.ok) {
                setCaseData(prev => ({ ...prev, name: trimmed }));
                setIsEditingName(false);
            }
        } catch (err) {
            console.error('Failed to update case name', err);
        } finally {
            setSavingName(false);
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const loadPage = useCallback((p: number, silent: boolean = false, currentLimit?: number) => {
        const limitToUse = currentLimit || pageSize;
        if (!silent) {
            setLoading(true);
            setError(null);
        }
        apiFetch(`/api/rows?caseId=${caseData.id}&limit=${limitToUse}&page=${p}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                const incoming: any[] = data.rows ?? [];
                if (!silent) {
                    setRows(incoming);
                } else {
                    setRows(prev => {
                        if (prev.length === 0) return incoming;
                        const map = new Map(incoming.map(r => [r.id, r]));
                        return prev.map(r => {
                            const inc = map.get(r.id);
                            if (!inc) return r;
                            return {
                                ...r,
                                ...inc,
                                data: { ...(r.data || {}), ...(inc.data || {}) },
                                cell_statuses: { ...(r.cell_statuses || {}), ...(inc.cell_statuses || {}) },
                                cell_errors: { ...(r.cell_errors || {}), ...(inc.cell_errors || {}) },
                            };
                        });
                    });
                }
                setTotal(data.total ?? 0);
                if (!silent) setLoading(false);
            })
            .catch(err => {
                if (!silent) {
                    setError(err.message ?? 'Fehler beim Laden der Zeilen.');
                    setLoading(false);
                }
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

    // Live-Polling: While activeTab === "Firmen" and any cell is running (or worker is active), poll quietly every 2.5s
    useEffect(() => {
        if (activeTab !== "Firmen") return;

        const hasRunningRows = rows.some(r => {
            const statuses = Object.values(r.cell_statuses || {});
            return statuses.includes('running');
        });

        // If any cell in this table is running or we have running cells locally, poll every 2.5s
        if (hasRunningRows || runningCells.size > 0 || runningPhase !== null) {
            const timer = setInterval(() => {
                loadPage(page, true);
            }, 2500);
            return () => clearInterval(timer);
        }
    }, [activeTab, rows, runningCells.size, runningPhase, page, loadPage]);

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
            const fetchRuns = () => {
                apiFetch(`/api/cases/${caseData.id}/agent`)
                    .then(r => r.json())
                    .then(d => {
                        const runs = Array.isArray(d) ? d : [];
                        setAgentRuns(runs);
                        // Check if any run stopped due to quota error
                        const quotaRun = runs.find(r => r.state?.error && (
                            r.state.error.includes('Credits aufgebraucht') || 
                            r.state.error.includes('not enough credits')
                        ));
                        if (quotaRun) {
                            setApiToast({
                                type: 'error',
                                message: '🚨 Serper.dev API Credits aufgebraucht! Die Suche wurde gestoppt. Bitte lade Guthaben auf oder hinterlege einen API-Key in den Einstellungen.'
                            });
                        }
                    })
                    .catch(() => setAgentRuns([]))
                    .finally(() => setAgentRunsLoading(false));
            };
            fetchRuns();
            const interval = setInterval(fetchRuns, 4000);
            return () => clearInterval(interval);
        } else if (activeTab === "Log") {
            setLogsLoading(true);
            const fetchLogs = () => {
                apiFetch(`/api/logs?caseId=${caseData.id}&limit=200`)
                    .then(r => r.json())
                    .then(d => setLogs(Array.isArray(d) ? d : []))
                    .catch(() => setLogs([]))
                    .finally(() => setLogsLoading(false));
            };
            fetchLogs();
            const interval = setInterval(fetchLogs, 4000);
            return () => clearInterval(interval);
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
                setRows(prev => prev.map(r => {
                    if (r.id !== rowId) return r;
                    return {
                        ...r,
                        ...data.row,
                        data: { ...(r.data || {}), ...(data.row.data || {}) },
                        cell_statuses: { ...(r.cell_statuses || {}), ...(data.row.cell_statuses || {}) },
                        cell_errors: { ...(r.cell_errors || {}), ...(data.row.cell_errors || {}) },
                    };
                }));
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

    // Run full table (excluding completed rows)
    const runFullTable = async (mode: 'empty_only' | 'all_force' = 'empty_only') => {
        const confirmMsg = mode === 'empty_only'
            ? 'Möchtest du die gesamte Tabelle starten? Alle noch nicht fertigen Zeilen werden angereichert (bereits fertige Zeilen werden übersprungen).'
            : 'Möchtest du die gesamte Tabelle inklusive aller bereits fertigen Zeilen neu anreichern?';
        
        if (!confirm(confirmMsg)) return;

        try {
            setStatusMsg('Tabelle wird an die Worker-Queue übergeben...');
            const res = await apiFetch('/api/run/table', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    caseId: caseData.id,
                    runMode: mode,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Fehler beim Starten der Tabelle');
            setStatusMsg(data.message || 'Ausführung gestartet');
            setTimeout(() => setStatusMsg(null), 6000);
            loadPage(page);
        } catch (e: any) {
            alert('Fehler: ' + e.message);
            setStatusMsg(null);
        }
    };

    // Bulk actions on selected rows
    const deleteSelectedRows = async () => {
        if (selectedRows.size === 0) return;
        try {
            const res = await apiFetch('/api/rows', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [...selectedRows] }),
            });
            if (res.ok) {
                setRows(prev => prev.filter(r => !selectedRows.has(r.id)));
                setSelectedRows(new Set());
                setTotal(prev => Math.max(0, prev - selectedRows.size));
                refreshCase();
            }
        } catch (err: any) {
            alert('Fehler beim Löschen: ' + err.message);
        }
    };

    const runSelectedRows = async () => {
        if (selectedRows.size === 0) return;
        const targetCols = caseData.ai_columns || [];
        if (targetCols.length === 0) {
            alert('Keine KI-Spalten vorhanden.');
            return;
        }

        // Sort columns: run company enrichment (Firmendaten) first so domain/phone are available for contact search
        const sortedCols = [...targetCols].sort((a, b) => {
            const aIsCompany = a.tool === 'batch_company' || a.columnGroup === 'company' ? 0 : 1;
            const bIsCompany = b.tool === 'batch_company' || b.columnGroup === 'company' ? 0 : 1;
            return aIsCompany - bIsCompany;
        });

        for (const rId of selectedRows) {
            for (const col of sortedCols) {
                await runCell(rId, col);
            }
        }
    };

    const dedupeRows = async () => {
        try {
            const res = await apiFetch(`/api/cases/${caseData.id}/dedupe`, { method: 'POST' });
            const d = await res.json();
            if (d.removed > 0) {
                alert(`${d.removed} Duplikate erfolgreich entfernt.`);
                loadPage(1);
                refreshCase();
            } else {
                alert('Keine Duplikate gefunden.');
            }
        } catch (err: any) {
            alert('Fehler beim Deduplizieren: ' + err.message);
        }
    };

    // Hard stop for all processes in this case
    const handleHardStop = async () => {
        if (!confirm('Möchtest du wirklich alle laufenden Hintergrund-Prozesse, Queue-Jobs und KI-Anfragen für diesen Case sofort hart abbrechen?')) {
            return;
        }

        setStoppingProcess(true);
        setStatusMsg('Stoppe alle laufenden Prozesse im Case...');

        try {
            const res = await apiFetch(`/api/cases/${caseData.id}/stop`, { method: 'POST' });
            const data = await res.json();

            // Clear local running states
            setRunningCells(new Set());
            setRunningPhase(null);
            setRows(prev => prev.map(r => {
                const statuses = { ...(r.cell_statuses || {}) };
                Object.keys(statuses).forEach(k => {
                    if (statuses[k] === 'running') statuses[k] = 'idle';
                });
                return { ...r, cell_statuses: statuses };
            }));

            setStatusMsg(data.message || 'Alle Prozesse gestoppt.');
            setTimeout(() => setStatusMsg(null), 5000);
            loadPage(page);
            refreshCase();
        } catch (e: any) {
            alert('Fehler beim Stoppen: ' + e.message);
            setStatusMsg(null);
        } finally {
            setStoppingProcess(false);
        }
    };

    // Delete column (AI column or Data column)
    const deleteColumn = async (colId: string, isDataKey: boolean = false) => {
        try {
            const res = await apiFetch(`/api/cases/${caseData.id}/delete-column`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ columnId: colId, isDataKey }),
            });
            const resData = await res.json();
            if (resData.case) {
                setCaseData(resData.case);
                if (resData.case.col_order) {
                    setColOrder(resData.case.col_order);
                }
            } else {
                setColOrder(prev => prev.filter(k => k !== colId));
            }
            refreshCase();
            setColumnToDelete(null);
            setDataColumnToDelete(null);
            // Optimistically clean rows state for data column
            if (isDataKey) {
                setRows(prev => prev.map(r => {
                    const newData = { ...(r.data || {}) };
                    delete newData[colId];
                    return { ...r, data: newData };
                }));
            }
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
    const aiKeySet = useMemo(() => new Set(aiColumns.map(c => c.outputKey)), [aiColumns]);

    const baseCols = useMemo(() => {
        let keys: string[] = [];
        if (caseData.columns && caseData.columns.length > 0) {
            keys = caseData.columns.map(c => c.key);
        } else if (rows.length > 0) {
            const rowKeySet = new Set<string>();
            rows.slice(0, 20).forEach(r => {
                Object.keys(r.data || {}).forEach(k => {
                    if (!k.startsWith('_') || k === '_scrape_cached_ts') {
                        rowKeySet.add(k);
                    }
                });
            });
            keys = Array.from(rowKeySet);
        }

        // When rows are empty or missing standard keys, populate from colOrder or default template keys
        if (keys.length === 0) {
            if (colOrder && colOrder.length > 0) {
                keys = colOrder.filter(k => !aiKeySet.has(k) && (!k.startsWith('_') || k === '_scrape_cached_ts'));
            } else {
                keys = [...DEFAULT_BASE_KEYS];
            }
        }

        // Include any non-AI keys present in colOrder
        if (colOrder && colOrder.length > 0) {
            colOrder.forEach(k => {
                if (!aiKeySet.has(k) && (!k.startsWith('_') || k === '_scrape_cached_ts') && !keys.includes(k)) {
                    keys.push(k);
                }
            });
        }

        // Always ensure cache status column exists
        if (!keys.includes('_scrape_cached_ts')) {
            const domainIdx = keys.indexOf('domain');
            if (domainIdx !== -1) {
                keys.splice(domainIdx + 1, 0, '_scrape_cached_ts');
            } else {
                keys.unshift('_scrape_cached_ts');
            }
        }

        return keys.map(k => ({
            key: k,
            label: COL_LABELS[k] ?? k,
            isAi: false,
        }));
    }, [caseData.columns, rows, colOrder, aiKeySet]);

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
                if (!manuallyHiddenCols.has(k)) {
                    // Position cache column next to domain if not already in colOrder
                    if (k === '_scrape_cached_ts') {
                        const domainIdx = ordered.findIndex(c => c.key === 'domain');
                        if (domainIdx !== -1) {
                            ordered.splice(domainIdx + 1, 0, col);
                            return;
                        }
                    }
                    ordered.push(col);
                }
            });
            return ordered;
        }

        return Array.from(colMap.values()).filter(c => !manuallyHiddenCols.has(c.key));
    }, [aiColHeaders, baseCols, colOrder, manuallyHiddenCols]);

    // Export Studio state and available columns
    const [exportType, setExportType] = useState<"companies" | "contacts">("companies");
    const [exportSelectedCols, setExportSelectedCols] = useState<Set<string>>(new Set());
    const [exportLoading, setExportLoading] = useState(false);

    const exportCompanyColumns = useMemo(() => {
        const allKeys = new Set([
            ...baseCols.map(c => c.key),
            ...aiColumns.map(c => c.outputKey),
            'company_name', 'domain', 'phone', 'email', 'company_email', 'address', 'city', 'zip', 'industry', 'description'
        ]);
        const base = colOrder.length > 0 ? colOrder : Array.from(allKeys);
        const ordered: string[] = [];
        base.forEach(k => {
            if (allKeys.has(k) && !ordered.includes(k) && !k.startsWith('_contacts_json_') && !k.startsWith('_scrape_')) {
                ordered.push(k);
            }
        });
        allKeys.forEach(k => {
            if (!ordered.includes(k) && !k.startsWith('_contacts_json_') && !k.startsWith('_scrape_')) {
                ordered.push(k);
            }
        });
        return ordered;
    }, [baseCols, aiColumns, colOrder]);

    const exportContactColumns = useMemo(() => {
        const set = new Set(CONTACT_CORE_KEYS);
        contactRows.forEach(c => {
            Object.keys(c.data || {}).forEach(k => {
                if (!k.startsWith('_')) set.add(k);
            });
        });
        return Array.from(set);
    }, [contactRows]);

    useEffect(() => {
        if (exportType === 'companies') {
            setExportSelectedCols(new Set(exportCompanyColumns));
        } else {
            setExportSelectedCols(new Set(exportContactColumns));
        }
    }, [exportType, exportCompanyColumns, exportContactColumns]);

    const toggleExportCol = (key: string) => {
        setExportSelectedCols(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleAllExportCols = () => {
        const currentList = exportType === 'companies' ? exportCompanyColumns : exportContactColumns;
        if (exportSelectedCols.size === currentList.length) {
            setExportSelectedCols(new Set());
        } else {
            setExportSelectedCols(new Set(currentList));
        }
    };

    const handleExportDownload = async () => {
        if (exportSelectedCols.size === 0) return;
        setExportLoading(true);
        const cols = Array.from(exportSelectedCols).join(',');
        const url = `/api/export?caseId=${caseData.id}&type=${exportType}&cols=${encodeURIComponent(cols)}`;
        try {
            const res = await apiFetch(url);
            const blob = await res.blob();
            const safeCaseName = caseData.name.replace(/[^a-z0-9]/gi, '_');
            const filename = exportType === 'contacts' 
                ? `${safeCaseName}_kontakte.csv` 
                : `${safeCaseName}_firmen.csv`;
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e: any) {
            alert('Export fehlgeschlagen: ' + e.message);
        } finally {
            setExportLoading(false);
        }
    };

    return (
        <AppLayout
            title={
                <div className="flex flex-col gap-0.5">
                    {isEditingName ? (
                        <form onSubmit={handleSaveName} className="flex items-center gap-1.5 my-0.5">
                            <input
                                type="text"
                                value={editedName}
                                onChange={(e) => setEditedName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setIsEditingName(false);
                                        setEditedName(caseData.name);
                                    }
                                }}
                                autoFocus
                                disabled={savingName}
                                className="text-base font-bold text-slate-900 tracking-tight px-2 py-0.5 rounded border border-orange-500 ring-2 ring-orange-200 outline-none bg-white min-w-[240px] max-w-[420px]"
                            />
                            <button
                                type="submit"
                                disabled={savingName}
                                title="Speichern"
                                className="p-1 rounded bg-orange-500 hover:bg-orange-600 text-white cursor-pointer shadow-xs transition-colors"
                            >
                                <Check className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsEditingName(false);
                                    setEditedName(caseData.name);
                                }}
                                disabled={savingName}
                                title="Abbrechen"
                                className="p-1 rounded hover:bg-slate-200 text-slate-500 cursor-pointer transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </form>
                    ) : (
                        <div 
                            className="flex items-center gap-2 group cursor-pointer w-fit" 
                            onClick={() => setIsEditingName(true)}
                            title="Klicken zum Umbenennen"
                        >
                            <h1 className="text-base font-bold text-slate-900 tracking-tight group-hover:text-orange-600 transition-colors">
                                {caseData.name}
                            </h1>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsEditingName(true);
                                }}
                                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 opacity-40 group-hover:opacity-100 transition-all cursor-pointer"
                                title="Case umbenennen"
                            >
                                <Edit2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}
                    <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                        <span>{total.toLocaleString('de-DE')} Zeilen</span>
                        {catalogRows.length > 0 && <span>{catalogRows.length.toLocaleString('de-DE')} Kataloge</span>}
                        <span>{baseCols.length} Quellspalten</span>
                        <span style={{ color: "var(--green)", fontWeight: 500 }}>{aiColumns.length} KI-Spalten</span>
                    </div>
                </div>
            }
            actions={
                <div className="flex items-center gap-2">
                    <DataflowModal />
                    <CostDashboard caseId={caseData.id} />
                    <button onClick={() => setShowAgentModal(true)} className="btn-v2 btn-v2-orange-soft" style={{ fontWeight: 500 }}>
                        <Target style={{ width: 12, height: 12 }} /> Leads finden & erweitern
                    </button>
                    <button onClick={() => setShowImportModal(true)} className="btn-v2">
                        <Upload style={{ width: 12, height: 12 }} /> Import
                    </button>
                    <button onClick={() => setActiveTab("Export")} className="btn-v2">
                        <Download style={{ width: 12, height: 12 }} /> Export
                    </button>
                    <button
                        onClick={async () => {
                            const name = prompt("Name für diese Spalten-Vorlage eingeben:", caseData.name + " Vorlage");
                            if (!name || !name.trim()) return;
                            const desc = prompt("Optionale Beschreibung der Vorlage:");
                            try {
                                const res = await apiFetch('/api/templates/from-case', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        case_id: caseData.id,
                                        name: name.trim(),
                                        description: desc?.trim() || undefined,
                                    }),
                                });
                                if (res.ok) {
                                    alert(`Vorlage "${name}" erfolgreich gespeichert! Sie steht ab sofort beim Erstellen neuer Cases zur Verfügung.`);
                                }
                            } catch (e: any) {
                                alert("Fehler beim Speichern: " + e.message);
                            }
                        }}
                        className="btn-v2"
                        title="Aktuelle Spaltenkonfiguration als wiederverwendbares Template sichern"
                    >
                        ⭐ Als Vorlage sichern
                    </button>
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

                                <button 
                                    onClick={dedupeRows}
                                    title="Doppelte Zeilen (gleiche Domain) entfernen"
                                    className="btn-v2 btn-v2-ghost" 
                                    style={{ padding: "3px 7px", fontSize: 11.5 }}
                                >
                                    Dedupe
                                </button>

                                {/* Run Table / Phase Dropdown (Fulltable, Firmendaten first, Kontakte manually) */}
                                <div style={{ position: "relative" }}>
                                    <div style={{ display: "inline-flex", borderRadius: 4, overflow: "hidden", border: "1px solid var(--orange-mid)" }}>
                                        <button
                                            onClick={() => runFullTable('empty_only')}
                                            title="Gesamte Tabelle anreichern (bereits fertige Zeilen werden übersprungen)"
                                            className="btn-v2 btn-v2-ai"
                                            style={{
                                                padding: "3px 10px",
                                                fontSize: 11.5,
                                                fontWeight: 600,
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 5,
                                                borderRadius: 0,
                                                border: "none",
                                                borderRight: "1px solid rgba(255,255,255,0.2)"
                                            }}
                                        >
                                            <Play style={{ width: 11, height: 11, fill: "currentColor" }} />
                                            <span>Tabelle ausführen (offene)</span>
                                        </button>
                                        <button
                                            onClick={() => setShowRunMenu(v => !v)}
                                            title="Weitere Start-Optionen (z. B. nur Firmendaten oder nur Kontakte)"
                                            className="btn-v2 btn-v2-ai"
                                            style={{
                                                padding: "3px 6px",
                                                fontSize: 11.5,
                                                borderRadius: 0,
                                                border: "none"
                                            }}
                                        >
                                            <ChevronDown style={{ width: 12, height: 12 }} />
                                        </button>
                                    </div>

                                    {showRunMenu && (
                                        <div 
                                            style={{
                                                position: "absolute",
                                                top: "calc(100% + 4px)",
                                                right: 0,
                                                width: 250,
                                                background: "var(--surface)",
                                                border: "1px solid var(--border)",
                                                borderRadius: 6,
                                                boxShadow: "var(--shadow-md)",
                                                zIndex: 60,
                                                padding: 4
                                            }}
                                        >
                                            <button
                                                onClick={() => { setShowRunMenu(false); runFullTable('empty_only'); }}
                                                className="w-full text-left px-3 py-2 text-xs rounded hover:bg-slate-50 flex items-start gap-2.5 transition-colors cursor-pointer"
                                            >
                                                <Play className="w-3.5 h-3.5 text-purple-600 mt-0.5 shrink-0" />
                                                <div>
                                                    <div className="font-semibold text-slate-800">Gesamte Tabelle (Alle KI-Spalten)</div>
                                                    <div className="text-[10.5px] text-slate-500">Reichert Firmendaten & Entscheider für alle unfertigen Zeilen an.</div>
                                                </div>
                                            </button>

                                            <div className="h-px bg-slate-100 my-1" />

                                            <button
                                                onClick={() => { setShowRunMenu(false); runPhase('company'); }}
                                                className="w-full text-left px-3 py-2 text-xs rounded hover:bg-slate-50 flex items-start gap-2.5 transition-colors cursor-pointer"
                                            >
                                                <Building2 className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                                                <div>
                                                    <div className="font-semibold text-slate-800">1. Nur Firmendaten (Schnell)</div>
                                                    <div className="text-[10.5px] text-slate-500">Holt erst Domain, Adresse & Telefon für alle Zeilen (ohne zeitaufwendige Kontaktsuche).</div>
                                                </div>
                                            </button>

                                            <button
                                                onClick={() => { setShowRunMenu(false); runPhase('contact'); }}
                                                className="w-full text-left px-3 py-2 text-xs rounded hover:bg-slate-50 flex items-start gap-2.5 transition-colors cursor-pointer"
                                            >
                                                <Users className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                                                <div>
                                                    <div className="font-semibold text-slate-800">2. Nur Entscheider & Kontakte</div>
                                                    <div className="text-[10.5px] text-slate-500">Sucht Geschäftsführer & Impressum für Firmen mit gefundener Domain.</div>
                                                </div>
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Hard Stop Button for entire table process */}
                                <button
                                    onClick={handleHardStop}
                                    disabled={stoppingProcess}
                                    title="Alle laufenden KI-Jobs & Queue-Hintergrundprozesse für diesen Case sofort hart abbrechen"
                                    className="btn-v2"
                                    style={{
                                        padding: "3px 9px",
                                        fontSize: 11.5,
                                        color: "#b91c1c",
                                        background: "#fef2f2",
                                        borderColor: "#fecaca",
                                        fontWeight: 600,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 4
                                    }}
                                >
                                    {stoppingProcess ? (
                                        <RefreshCw style={{ width: 11, height: 11 }} className="animate-spin" />
                                    ) : (
                                        <Square style={{ width: 10, height: 10, fill: "currentColor" }} />
                                    )}
                                    <span>Stop</span>
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
                                            {baseCols.map((c, idx) => (
                                                <div key={c.key} className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-50 text-xs">
                                                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--text-1)", flex: 1, minWidth: 0 }}>
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
                                                    <div className="flex items-center gap-0.5 opacity-60 hover:opacity-100">
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const current = visibleColumns.map(col => col.key);
                                                                const pos = current.indexOf(c.key);
                                                                if (pos > 0) {
                                                                    const next = [...current];
                                                                    const tmp = next[pos - 1];
                                                                    next[pos - 1] = next[pos];
                                                                    next[pos] = tmp;
                                                                    setColOrder(next);
                                                                    await apiFetch(`/api/cases/${caseData.id}`, {
                                                                        method: 'PATCH',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ col_order: next }),
                                                                    });
                                                                }
                                                            }}
                                                            className="p-0.5 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                                                            title="Nach oben verschieben"
                                                        >
                                                            ↑
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const current = visibleColumns.map(col => col.key);
                                                                const pos = current.indexOf(c.key);
                                                                if (pos !== -1 && pos < current.length - 1) {
                                                                    const next = [...current];
                                                                    const tmp = next[pos + 1];
                                                                    next[pos + 1] = next[pos];
                                                                    next[pos] = tmp;
                                                                    setColOrder(next);
                                                                    await apiFetch(`/api/cases/${caseData.id}`, {
                                                                        method: 'PATCH',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ col_order: next }),
                                                                    });
                                                                }
                                                            }}
                                                            className="p-0.5 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                                                            title="Nach unten verschieben"
                                                        >
                                                            ↓
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}

                                            {/* AI Columns */}
                                            {aiColumns.length > 0 && (
                                                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--green)", textTransform: "uppercase", padding: "8px 2px 2px", marginBottom: 2, borderTop: "1px solid var(--border-xs)", marginTop: 6 }}>
                                                    KI-Spalten
                                                </div>
                                            )}
                                            {aiColumns.map((c, idx) => (
                                                <div key={c.outputKey} className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-50 text-xs">
                                                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "var(--green)", flex: 1, minWidth: 0 }}>
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
                                                    <div className="flex items-center gap-0.5 opacity-60 hover:opacity-100">
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const current = visibleColumns.map(col => col.key);
                                                                const pos = current.indexOf(c.outputKey);
                                                                if (pos > 0) {
                                                                    const next = [...current];
                                                                    const tmp = next[pos - 1];
                                                                    next[pos - 1] = next[pos];
                                                                    next[pos] = tmp;
                                                                    setColOrder(next);
                                                                    await apiFetch(`/api/cases/${caseData.id}`, {
                                                                        method: 'PATCH',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ col_order: next }),
                                                                    });
                                                                }
                                                            }}
                                                            className="p-0.5 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                                                            title="Nach oben verschieben"
                                                        >
                                                            ↑
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const current = visibleColumns.map(col => col.key);
                                                                const pos = current.indexOf(c.outputKey);
                                                                if (pos !== -1 && pos < current.length - 1) {
                                                                    const next = [...current];
                                                                    const tmp = next[pos + 1];
                                                                    next[pos + 1] = next[pos];
                                                                    next[pos] = tmp;
                                                                    setColOrder(next);
                                                                    await apiFetch(`/api/cases/${caseData.id}`, {
                                                                        method: 'PATCH',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ col_order: next }),
                                                                    });
                                                                }
                                                            }}
                                                            className="p-0.5 rounded hover:bg-slate-200 text-slate-500 cursor-pointer"
                                                            title="Nach unten verschieben"
                                                        >
                                                            ↓
                                                        </button>
                                                    </div>
                                                </div>
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

                {/* Contextual Selection Bar (Strict Match to Next.js UI) */}
                {activeTab === "Firmen" && selectedRows.size > 0 && (
                    <div 
                        style={{
                            background: "var(--orange-soft)",
                            borderBottom: "1px solid var(--orange-mid)",
                            padding: "6px 16px",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            fontSize: 12,
                            color: "var(--orange)",
                            flexShrink: 0
                        }}
                    >
                        <span style={{ fontWeight: 600 }}>
                            {selectedRows.size} Zeilen ausgewählt
                        </span>
                        <button
                            onClick={runSelectedRows}
                            className="btn-v2"
                            style={{ padding: "2px 8px", fontSize: 11, background: "#fff", borderColor: "var(--orange-mid)", color: "var(--orange)", fontWeight: 500 }}
                        >
                            ▶ Nur diese ausführen
                        </button>
                        <button
                            onClick={dedupeRows}
                            className="btn-v2"
                            style={{ padding: "2px 8px", fontSize: 11, background: "#fff", borderColor: "var(--orange-mid)", color: "var(--orange)", fontWeight: 500 }}
                        >
                            ⊘ Dedupe
                        </button>
                        <button
                            onClick={() => setConfirmDeleteRows(true)}
                            className="btn-v2"
                            style={{ padding: "2px 8px", fontSize: 11, background: "#fff", borderColor: "var(--danger)", color: "var(--danger)", fontWeight: 500 }}
                        >
                            <Trash2 style={{ width: 10, height: 10 }} /> Löschen
                        </button>
                        <button
                            onClick={() => setSelectedRows(new Set())}
                            style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "var(--orange)" }}
                        >
                            ✕ Auswahl aufheben
                        </button>
                    </div>
                )}

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
                                        <input 
                                            type="checkbox" 
                                            checked={rows.length > 0 && selectedRows.size === rows.length}
                                            onChange={() => {
                                                if (selectedRows.size > 0) setSelectedRows(new Set());
                                                else setSelectedRows(new Set(rows.map(r => r.id)));
                                            }}
                                            style={{ accentColor: "var(--orange)" }} 
                                        />
                                    </th>
                                    <th className="p-2.5 w-10 border-r text-center" style={{ borderColor: "var(--border)" }}>#</th>
                                    <th 
                                        className="p-2.5 border-r text-left font-semibold uppercase tracking-wider text-[10.5px] whitespace-nowrap"
                                        style={{ borderColor: "var(--border)", width: 140, minWidth: 140 }}
                                    >
                                        Status
                                    </th>
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

                                                <div className="flex items-center gap-1.5 justify-between w-full">
                                                    <GripVertical className="w-3 h-3 text-slate-400 shrink-0 opacity-40 hover:opacity-100 cursor-grab" />
                                                    {col.isAi ? (
                                                        <ColumnHeaderMenu
                                                            column={col.colDef}
                                                            onRunAll={() => runColumn(col.colDef, "all_force")}
                                                            onRunEmptyOnly={() => runColumn(col.colDef, "empty_only")}
                                                            onDelete={() => setColumnToDelete(col.colDef)}
                                                            onEdit={() => setEditingCol(col.colDef)}
                                                        />
                                                    ) : (() => {
                                                        const filled = rows.filter(r => r.data && r.data[col.key] != null && String(r.data[col.key]).trim() !== "").length;
                                                        const isReferenced = (caseData.ai_columns || []).some(ac => 
                                                            (ac.prompt && ac.prompt.includes(`{${col.key}}`)) ||
                                                            (ac.searchQuery && ac.searchQuery.includes(`{${col.key}}`)) ||
                                                            ac.conditionField === col.key
                                                        );
                                                        const isCore = ['company_name', 'domain', 'phone', 'address', 'city', 'zip'].includes(col.key);

                                                        return (
                                                            <div className="flex items-center justify-between gap-1 w-full min-w-0">
                                                                <span className="truncate font-semibold flex-1">{col.label}</span>
                                                                <BaseColumnHeaderMenu
                                                                    columnKey={col.key}
                                                                    label={col.label}
                                                                    rowsCount={rows.length}
                                                                    filledCount={filled}
                                                                    isReferencedInPrompts={isReferenced}
                                                                    isSystemCore={isCore}
                                                                    onDelete={() => setDataColumnToDelete({
                                                                        key: col.key,
                                                                        label: col.label,
                                                                        filledCount: filled,
                                                                        isReferenced,
                                                                        isCore,
                                                                    })}
                                                                    onSort={() => handleSort(col.key)}
                                                                />
                                                            </div>
                                                        );
                                                    })()}
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
                                        <td colSpan={visibleColumns.length + 4} className="p-12 text-center text-slate-400">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-orange-500" />
                                            Lade Tabellendaten...
                                        </td>
                                    </tr>
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={visibleColumns.length + 4} className="p-0 border-0">
                                            <div 
                                                style={{ 
                                                    position: "sticky", 
                                                    left: 0, 
                                                    width: "min(calc(100vw - 280px), 100%)",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    textAlign: "center",
                                                    padding: "60px 20px"
                                                }}
                                            >
                                                <div 
                                                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-xs"
                                                    style={{ background: "var(--orange-soft)", border: "1px solid var(--orange-mid)" }}
                                                >
                                                    <Building2 className="w-7 h-7 text-orange-600" />
                                                </div>
                                                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                                                    Noch keine Firmen oder Leads in diesem Case
                                                </h3>
                                                <p className="text-xs text-slate-500 mb-6 leading-relaxed max-w-sm">
                                                    Lade eine CSV- oder Excel-Datei mit Domains und Firmendaten hoch, oder starte die automatisierte Maps- & Google-Suche nach Leads.
                                                </p>
                                                <div className="flex items-center gap-3">
                                                    <button
                                                        onClick={() => setShowImportModal(true)}
                                                        className="btn-v2 btn-v2-primary flex items-center gap-2 px-3.5 py-2 text-xs font-medium cursor-pointer shadow-xs hover:shadow"
                                                    >
                                                        <Upload className="w-3.5 h-3.5" />
                                                        CSV / Excel importieren
                                                    </button>
                                                    <button
                                                        onClick={() => setShowAgentModal(true)}
                                                        className="btn-v2 btn-v2-orange-soft flex items-center gap-2 px-3.5 py-2 text-xs font-medium cursor-pointer shadow-xs"
                                                    >
                                                        <Target className="w-3.5 h-3.5" />
                                                        Leads finden & erweitern
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((r, idx) => {
                                        const statuses = aiColumns.map(c => r.cell_statuses?.[c.outputKey] ?? "idle");
                                        const errorCount = statuses.filter(s => s === "error").length;
                                        const runningCount = statuses.filter(s => s === "running" || runningCells.has(`${r.id}:${s}`)).length;
                                        const doneCount = statuses.filter(s => s === "done" || s === "skipped").length;
                                        const totalCols = aiColumns.length;

                                        const rowState: "error" | "running" | "completed" | "partial" | "pending" =
                                            errorCount > 0 ? "error"
                                            : runningCount > 0 ? "running"
                                            : totalCols > 0 && doneCount === totalCols ? "completed"
                                            : doneCount > 0 ? "partial"
                                            : "pending";

                                        const src = r.data["search_source"] ?? "";
                                        const query = r.data["search_query"] ?? "";
                                        const icon = src.includes("maps") ? "🗺️" : src === "firecrawl" ? "🔥" : src === "linkup" ? "🔗" : src === "serpapi" ? "🔍" : "🌐";
                                        const label = src.includes("maps") ? "Maps" : src === "firecrawl" ? "Firecrawl" : src === "linkup" ? "Linkup" : src === "serpapi" ? "SerpApi" : src;

                                        const isSelected = selectedRows.has(r.id);

                                        return (
                                        <tr 
                                            key={r.id} 
                                            className="hover:bg-[#faf9f7] transition-colors"
                                            style={{
                                                background: isSelected ? "var(--orange-soft)" : rowState === "running" ? "#fefce8" : rowState === "error" ? "var(--danger-soft)" : undefined,
                                            }}
                                        >
                                            <td className="p-2.5 border-r text-center" style={{ borderColor: "var(--border-xs)" }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={isSelected}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedRows(prev => {
                                                            const next = new Set(prev);
                                                            next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                                                            return next;
                                                        });
                                                    }}
                                                    style={{ accentColor: "var(--orange)" }} 
                                                />
                                            </td>
                                            <td className="p-2.5 border-r text-center font-mono text-[10.5px] text-slate-400" style={{ borderColor: "var(--border-xs)" }}>
                                                {(page - 1) * pageSize + idx + 1}
                                            </td>
                                            {/* Status Badge & Search Source Pill */}
                                            <td className="p-2.5 border-r whitespace-nowrap" style={{ borderColor: "var(--border-xs)" }}>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {rowState === "error" && (
                                                        <span className="status-pill status-pill-error" title={`${errorCount} von ${totalCols} Spalten fehlgeschlagen`}>
                                                            Fehler
                                                        </span>
                                                    )}
                                                    {rowState === "running" && (
                                                        <span className="status-pill status-pill-pending">
                                                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Läuft
                                                        </span>
                                                    )}
                                                    {rowState === "completed" && (
                                                        <span className="status-pill status-pill-done">
                                                            Fertig
                                                        </span>
                                                    )}
                                                    {rowState === "partial" && (
                                                        <span className="status-pill status-pill-done" style={{ background: "var(--orange-soft)", color: "var(--orange)" }}>
                                                            ◐ {doneCount}/{totalCols}
                                                        </span>
                                                    )}
                                                    {rowState === "pending" && (
                                                        <span className="status-pill status-pill-pending">
                                                            Ausstehend
                                                        </span>
                                                    )}

                                                    {src && (
                                                        <span 
                                                            title={`Quelle: ${src}${query ? `\nQuery: ${query}` : ''}`}
                                                            style={{
                                                                display: "inline-flex",
                                                                alignItems: "center",
                                                                gap: 3,
                                                                fontSize: 10,
                                                                color: "var(--text-2)",
                                                                background: "var(--bg)",
                                                                border: "1px solid var(--border)",
                                                                padding: "1px 5px",
                                                                borderRadius: 4,
                                                                cursor: "help",
                                                                maxWidth: 85,
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                                whiteSpace: "nowrap"
                                                            }}
                                                        >
                                                            {icon} {label}
                                                        </span>
                                                    )}
                                                </div>
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
                                                        ) : col.isAi ? (() => {
                                                            const isBatchCompany = col.colDef.tool === "batch_company";
                                                            const isBatchContact = col.colDef.tool === "batch_contact";
                                                            const hasDomain = !!r.data["domain"];
                                                            const isDone = status === "done";
                                                            const isError = status === "error" || !!r.cell_errors?.[col.key];
                                                            const errorMsg = r.cell_errors?.[col.key] || "Fehler bei der Ausführung";

                                                            if (isRunning) {
                                                                return (
                                                                    <div className="flex items-center gap-1 text-orange-600 font-medium">
                                                                        <RefreshCw className="w-3 h-3 animate-spin" /> läuft...
                                                                    </div>
                                                                );
                                                            }

                                                            // ── Error State (Klickbar für Detail-Fehlermeldung) ──
                                                            if (isError) {
                                                                return (
                                                                    <div 
                                                                        className="flex items-center gap-1 text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded cursor-pointer hover:bg-rose-100 transition-colors"
                                                                        title={`${errorMsg} (Klicken für Details)`}
                                                                    >
                                                                        <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                                                                        <span className="text-[10.5px] font-semibold truncate max-w-[120px]">
                                                                            Fehler: {errorMsg}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            }

                                                            // ── batch_company Rendering ──
                                                            if (isBatchCompany) {
                                                                const fields = col.colDef.batchOutputFields ?? [
                                                                    "company_name","domain","phone","company_email","address","city","zip","industry","description","employees","founded"
                                                                ];
                                                                const filled = fields.filter(f => r.data[f] && String(r.data[f]).trim() !== "");
                                                                
                                                                if (isDone || filled.length > 0) {
                                                                    return (
                                                                        <div className="flex items-center gap-1.5 min-w-0" title="Klicken für Prompt, Token, Rohdaten & Rerun">
                                                                            <span style={{ fontSize: 10.5, fontWeight: 600, color: "#7c3aed", background: "#ede9fe", padding: "1.5px 7px", borderRadius: 4 }}>
                                                                                {filled.length} Felder ✓
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                }

                                                                return (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            if (hasDomain) runCell(r.id, col.colDef);
                                                                        }}
                                                                        style={{
                                                                            fontSize: 10.5,
                                                                            fontWeight: 600,
                                                                            padding: "2px 7px",
                                                                            borderRadius: 4,
                                                                            background: hasDomain ? "#ede9fe" : "#fef3c7",
                                                                            color: hasDomain ? "#7c3aed" : "#b45309",
                                                                            border: "none",
                                                                            cursor: hasDomain ? "pointer" : "default",
                                                                            display: "inline-flex",
                                                                            alignItems: "center",
                                                                            gap: 3
                                                                        }}
                                                                    >
                                                                        {hasDomain ? "▶ Anreichern" : "⚠ Domain fehlt"}
                                                                    </button>
                                                                );
                                                            }

                                                            // ── batch_contact Rendering ──
                                                            if (isBatchContact) {
                                                                const jsonKey = `_contacts_json_${col.key}`;
                                                                let contactCount = 0;
                                                                if (r.data[jsonKey]) {
                                                                    try { contactCount = JSON.parse(r.data[jsonKey]).length; } catch {}
                                                                }
                                                                if (contactCount === 0 && (r.data["first_name"] || r.data["contact_email"])) contactCount = 1;

                                                                if (isDone || contactCount > 0) {
                                                                    return (
                                                                        <div className="flex items-center gap-1.5 min-w-0" title="Klicken für Kontakte & Details">
                                                                            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#7c3aed", background: "#ede9fe", padding: "1.5px 6px", borderRadius: 10 }}>
                                                                                {contactCount}
                                                                            </span>
                                                                            <span className="text-[11px] font-semibold text-slate-800 truncate">
                                                                                {r.data["first_name"] ? `${r.data["first_name"]} ${r.data["last_name"] || ''}` : `${contactCount} Kontakte`}
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                }

                                                                return (
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            runCell(r.id, col.colDef);
                                                                        }}
                                                                        style={{
                                                                            fontSize: 10.5,
                                                                            fontWeight: 600,
                                                                            padding: "2px 7px",
                                                                            borderRadius: 4,
                                                                            background: "#ede9fe",
                                                                            color: "#7c3aed",
                                                                            border: "none",
                                                                            cursor: "pointer",
                                                                            display: "inline-flex",
                                                                            alignItems: "center",
                                                                            gap: 3
                                                                        }}
                                                                    >
                                                                        ▶ Kontakte suchen
                                                                    </button>
                                                                );
                                                            }

                                                            // ── Generic AI Column ──
                                                            if (isError) {
                                                                return (
                                                                    <div 
                                                                        className="flex items-center gap-1 text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded cursor-pointer hover:bg-rose-100 transition-colors"
                                                                        title={`${errorMsg} (Klicken für Details)`}
                                                                    >
                                                                        <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                                                                        <span className="text-[10.5px] font-semibold truncate max-w-[120px]">
                                                                            Fehler: {errorMsg}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            }

                                                            return (
                                                                <div className="flex items-center justify-between gap-1.5 group/cell">
                                                                    <span className="truncate">
                                                                        {val ? (
                                                                            <span className="ai-chip-v2 font-mono text-[11px]">{String(val)}</span>
                                                                        ) : (
                                                                            <span className="text-slate-400 italic text-[11px]">— leer —</span>
                                                                        )}
                                                                    </span>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            runCell(r.id, col.colDef);
                                                                        }}
                                                                        className="btn-v2 p-1 hover:bg-orange-50 border-orange-200 text-orange-600 rounded cursor-pointer shrink-0"
                                                                    >
                                                                        <Play className="w-2.5 h-2.5 fill-current" />
                                                                    </button>
                                                                </div>
                                                            );
                                                        })() : col.key === "maps_url" ? (
                                                            val ? (
                                                                <a 
                                                                    href={String(val)} 
                                                                    target="_blank" 
                                                                    rel="noreferrer"
                                                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-600 hover:text-sky-800 hover:underline bg-sky-50 px-2 py-0.5 rounded border border-sky-200"
                                                                    onClick={e => e.stopPropagation()}
                                                                >
                                                                    🗺 Maps öffnen ↗
                                                                </a>
                                                            ) : (
                                                                <span className="text-slate-300 italic text-[11px]">—</span>
                                                            )
                                                        ) : col.key === "domain" ? (
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                {val ? (
                                                                    <>
                                                                        <img 
                                                                            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(String(val))}&sz=32`} 
                                                                            alt="" 
                                                                            className="w-3.5 h-3.5 rounded-xs shrink-0"
                                                                            onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                                                                        />
                                                                        <a 
                                                                            href={String(val).startsWith("http") ? String(val) : `https://${val}`} 
                                                                            target="_blank" 
                                                                            rel="noreferrer"
                                                                            className="text-blue-600 hover:underline truncate"
                                                                            onClick={e => e.stopPropagation()}
                                                                        >
                                                                            {String(val)}
                                                                        </a>
                                                                        <button
                                                                            onClick={async (e) => {
                                                                                e.stopPropagation();
                                                                                const nextData = { ...r.data, domain: null, _scrape_cached: null, _scrape_cached_ts: null };
                                                                                await apiFetch(`/api/rows/${r.id}`, {
                                                                                    method: "PATCH",
                                                                                    headers: { "Content-Type": "application/json" },
                                                                                    body: JSON.stringify({ data: nextData }),
                                                                                });
                                                                                setRows(prev => prev.map(row => row.id === r.id ? { ...row, data: nextData } : row));
                                                                            }}
                                                                            title="Domain leeren"
                                                                            className="text-slate-300 hover:text-red-500 font-bold px-1 ml-auto text-[11px]"
                                                                        >
                                                                            ✕
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <span className="text-slate-300 italic text-[11px]">— keine Domain —</span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span>{val !== null && val !== undefined && String(val).trim() !== "" ? String(val) : "—"}</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="p-2.5 border-r" style={{ borderColor: "var(--border-xs)" }} />
                                        </tr>
                                        );
                                    })
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
                            <div className="py-16 px-4 text-center flex flex-col items-center">
                                <div 
                                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-xs"
                                    style={{ background: "var(--orange-soft)", border: "1px solid var(--orange-mid)" }}
                                >
                                    <Users className="w-6 h-6 text-orange-600" />
                                </div>
                                <h3 className="text-sm font-semibold text-slate-800 mb-1">
                                    Noch keine Kontakte oder Entscheider
                                </h3>
                                <p className="text-xs text-slate-500 mb-5 max-w-sm">
                                    Sobald Firmendaten vorliegen, kannst du Ansprechpartner automatisch extrahieren oder per KI suchen lassen.
                                </p>
                                <button
                                    onClick={async () => {
                                        const res = await apiFetch('/api/contact-rows/extract', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ caseId: caseData.id }),
                                        });
                                        const data = await res.json();
                                        alert(data.message || 'Kontakte extrahiert');
                                        apiFetch(`/api/contact-rows?caseId=${caseData.id}`).then(r => r.json()).then(d => setContactRows(d.contacts || []));
                                    }}
                                    className="btn-v2 btn-v2-ai flex items-center gap-1.5"
                                >
                                    ⚡ Aus Firmendaten extrahieren
                                </button>
                            </div>
                        ) : (
                            <div className="border rounded-lg overflow-hidden shadow-xs" style={{ borderColor: 'var(--border)' }}>
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead className="bg-[#fbfaf8] border-b text-[10.5px] uppercase font-semibold text-slate-600" style={{ borderColor: 'var(--border)' }}>
                                        <tr>
                                            <th className="p-2.5 w-10 border-r">#</th>
                                            <th className="p-2.5 border-r">Firma</th>
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
                                                <td className="p-2.5 border-r text-slate-800 font-medium">
                                                    {c.company_name || c.data?.company_name || '—'}
                                                    {(c.domain || c.data?.domain) && (
                                                        <div className="text-[10px] text-slate-400 font-mono">{c.domain || c.data?.domain}</div>
                                                    )}
                                                </td>
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
                            <button onClick={() => { setSelectedAgentRunId(null); setShowAgentModal(true); }} className="btn-v2 btn-v2-primary">
                                + Neue Suche starten
                            </button>
                        </div>

                        {agentRunsLoading ? (
                            <div className="p-12 text-center text-xs text-slate-400">Lade Suchen...</div>
                        ) : agentRuns.filter(r => {
                            const steps = r.state?.current_step_index ?? r.current_step_index ?? 0;
                            const added = r.uniqueCount ?? r.state?.rows_added ?? r.state?.uniqueCount ?? 0;
                            if (r.status === 'pending' && steps === 0) return false;
                            if (r.status === 'cancelled' && steps === 0 && added === 0) return false;
                            return true;
                        }).length === 0 ? (
                            <div className="p-12 text-center text-xs text-slate-400 border rounded-lg bg-slate-50">
                                Bislang keine Discovery-Läufe in diesem Case. Klicke auf "+ Neue Suche starten", um Leads zu finden.
                            </div>
                        ) : (
                            agentRuns
                                .filter(r => {
                                    const steps = r.state?.current_step_index ?? r.current_step_index ?? 0;
                                    const added = r.uniqueCount ?? r.state?.rows_added ?? r.state?.uniqueCount ?? 0;
                                    if (r.status === 'pending' && steps === 0) return false;
                                    if (r.status === 'cancelled' && steps === 0 && added === 0) return false;
                                    return true;
                                })
                                .map((run) => {
                                const goalText = typeof run.goal === 'object' && run.goal !== null
                                    ? (run.goal.description || JSON.stringify(run.goal))
                                    : String(run.goal || '–');
                                const targetCount = typeof run.goal === 'object' && run.goal !== null
                                    ? (run.goal.targetCount || 3000)
                                    : (run.targetCount || 3000);
                                const foundCount = run.uniqueCount ?? run.state?.rows_added ?? run.state?.uniqueCount ?? 0;
                                const planSteps = run.plan?.steps ?? run.state?.plan?.steps ?? [];
                                const currentStep = run.state?.current_step_index ?? run.current_step_index ?? 0;
                                const totalSteps = planSteps.length || run.state?.total_steps || 0;
                                const pct = targetCount > 0 ? Math.min(100, Math.round((foundCount / targetCount) * 100)) : 0;
                                const logs = run.logs ?? run.state?.logs ?? [];

                                return (
                                    <div key={run.id} className="p-4 rounded-xl border bg-white shadow-xs space-y-3" style={{ borderColor: 'var(--border)' }}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                                                    <span>🎯 {goalText}</span>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                                        run.status === 'completed'
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : run.status === 'running'
                                                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                            : run.status === 'paused'
                                                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                            : 'bg-orange-50 text-orange-700 border border-orange-200'
                                                    }`}>
                                                        {run.status === 'paused' ? 'Pausiert' : run.status}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1 flex items-center gap-4 flex-wrap">
                                                    <span>Ziel: {targetCount.toLocaleString('de-DE')} Leads</span>
                                                    <span>•</span>
                                                    <span>Gefundene Leads: <strong className="text-emerald-600">{foundCount.toLocaleString('de-DE')}</strong></span>
                                                    <span>•</span>
                                                    <span>Schritte: {currentStep} / {totalSteps}</span>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <span className="text-[11px] text-slate-400 font-mono block">
                                                    {new Date(run.created_at).toLocaleString('de-DE')}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Progress bar */}
                                        <div className="space-y-1">
                                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                <div
                                                    className={`h-full transition-all duration-300 ${run.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-600'}`}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between text-[10px] text-slate-400">
                                                <span>{pct}% erreicht</span>
                                                <span>{foundCount} von {targetCount}</span>
                                            </div>
                                        </div>

                                        {/* Plan steps list (fully scrollable, showing all planned steps) */}
                                        {planSteps.length > 0 && (
                                            <div className="border-t pt-2 space-y-1" style={{ borderColor: 'var(--border)' }}>
                                                <div className="text-[11px] font-medium text-slate-600 flex justify-between">
                                                    <span>Plan ({planSteps.length} Schritte gesamt)</span>
                                                    <span className="text-slate-400">Aktuell: Schritt {Math.min(currentStep + 1, totalSteps)}</span>
                                                </div>
                                                <div className="max-h-72 overflow-y-auto space-y-1 pr-1 font-mono text-[11px] border border-slate-100 rounded-lg p-1.5 bg-slate-50/50">
                                                    {planSteps.map((st: any, idx: number) => {
                                                        const isDone = idx < currentStep;
                                                        const isCur = idx === currentStep && run.status === 'running';
                                                        return (
                                                            <div key={st.id || idx} className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] transition-colors ${
                                                                isDone ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : isCur ? 'bg-blue-50 text-blue-800 font-semibold border border-blue-200' : 'bg-white text-slate-600 border border-slate-100'
                                                            }`}>
                                                                <span className="shrink-0">{isDone ? '✓' : isCur ? '▶' : '○'}</span>
                                                                <span className="text-[10px] text-slate-400 shrink-0 font-mono w-6 text-right">#{idx + 1}</span>
                                                                <span className="uppercase text-[9px] px-1 bg-slate-100 rounded border border-slate-200 shrink-0">{st.type === 'google_maps' ? 'MAPS' : 'WEB'}</span>
                                                                <span className="truncate flex-1 font-medium">{st.label || st.mapQuery || st.query}</span>
                                                                {st.location && (
                                                                    <span className="text-slate-400 text-[10px] shrink-0 truncate max-w-[140px]">{st.location}</span>
                                                                )}
                                                                <span className="text-slate-400 text-[10px] shrink-0">~{st.estimatedHits}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Recent activity log */}
                                        {logs.length > 0 && (
                                            <div className="text-[11px] bg-slate-50 text-slate-700 border border-slate-200 rounded-md p-2.5 font-mono max-h-20 overflow-y-auto">
                                                <div className="text-[10px] text-slate-400 font-medium mb-1">Letzte Aktivität:</div>
                                                {logs.slice(-3).map((l: any, i: number) => (
                                                    <div key={i} className="truncate text-slate-600">
                                                        {typeof l === 'object' && l !== null ? l.message : String(l)}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Actions: Resume, Cancel, Modal */}
                                        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                                            {(run.status === 'cancelled' || run.status === 'paused') && (
                                                <button
                                                    onClick={async () => {
                                                        const res = await apiFetch(`/api/cases/${caseData.id}/agent/${run.id}`, { method: 'PATCH' });
                                                        if (res.ok) {
                                                            setSelectedAgentRunId(run.id);
                                                            setShowAgentModal(true);
                                                        }
                                                    }}
                                                    className="btn-v2 btn-v2-primary text-xs py-1 px-3"
                                                >
                                                    ▶ Fortsetzen
                                                </button>
                                            )}
                                            {run.status === 'running' && (
                                                <button
                                                    onClick={async () => {
                                                        await apiFetch(`/api/cases/${caseData.id}/agent/${run.id}/cancel`, { method: 'POST' });
                                                        const runsRes = await apiFetch(`/api/cases/${caseData.id}/agent`);
                                                        const d = await runsRes.json();
                                                        setAgentRuns(Array.isArray(d) ? d : []);
                                                    }}
                                                    className="btn-v2 text-xs py-1 px-3 bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                                                >
                                                    ■ Stoppen
                                                </button>
                                            )}
                                            <button
                                                onClick={() => {
                                                    setSelectedAgentRunId(run.id);
                                                    setShowAgentModal(true);
                                                }}
                                                className="btn-v2 btn-v2-ghost text-xs py-1 px-3"
                                            >
                                                📊 Im Modal steuern
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
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
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        setLogsLoading(true);
                                        apiFetch(`/api/logs?caseId=${caseData.id}&limit=200`)
                                            .then(r => r.json())
                                            .then(d => setLogs(Array.isArray(d) ? d : []))
                                            .catch(() => setLogs([]))
                                            .finally(() => setLogsLoading(false));
                                    }}
                                    className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                                >
                                    Aktualisieren
                                </button>
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
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl">
                        {/* Interactive Export Studio */}
                        <div className="p-6 rounded-2xl border bg-white shadow-xs space-y-5" style={{ borderColor: 'var(--border)' }}>
                            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: 'var(--border-xs)' }}>
                                <div>
                                    <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                                        <Download className="w-5 h-5 text-orange-500" />
                                        Daten & Spalten vor dem Export anpassen
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Wähle aus, welche Spalten und Datenfelder in die CSV-Tabelle übernommen werden sollen.
                                    </p>
                                </div>

                                {/* Type Switcher */}
                                <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200">
                                    <button
                                        type="button"
                                        onClick={() => setExportType('companies')}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                            exportType === 'companies'
                                                ? 'bg-white text-slate-900 shadow-xs'
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        <Building2 className="w-3.5 h-3.5 text-orange-500" />
                                        Firmen ({total})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setExportType('contacts')}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                            exportType === 'contacts'
                                                ? 'bg-white text-slate-900 shadow-xs'
                                                : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                    >
                                        <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                                        Kontakte ({contactRows.length})
                                    </button>
                                </div>
                            </div>

                            {/* Column Selection Controls */}
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
                                    Ausgewählte Spalten: <span className="text-orange-600 font-bold">{exportSelectedCols.size}</span> von {(exportType === 'companies' ? exportCompanyColumns : exportContactColumns).length}
                                </span>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={toggleAllExportCols}
                                        className="text-orange-600 hover:text-orange-700 font-semibold cursor-pointer text-xs"
                                    >
                                        {exportSelectedCols.size === (exportType === 'companies' ? exportCompanyColumns : exportContactColumns).length
                                            ? "Keine auswählen"
                                            : "Alle auswählen"}
                                    </button>
                                </div>
                            </div>

                            {/* Column Checkboxes Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-[360px] overflow-y-auto p-3 bg-slate-50 border rounded-xl" style={{ borderColor: 'var(--border-xs)' }}>
                                {(exportType === 'companies' ? exportCompanyColumns : exportContactColumns).map(key => {
                                    const isAi = aiColumns.some(c => c.outputKey === key);
                                    const isSelected = exportSelectedCols.has(key);
                                    const label = exportType === 'companies' 
                                        ? getColumnLabel(key, { ...caseData, aiColumns } as any) 
                                        : key;

                                    return (
                                        <label
                                            key={key}
                                            className={`flex items-center gap-2.5 p-2 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                                                isSelected 
                                                    ? 'bg-white border-orange-300 text-slate-900 shadow-2xs font-medium' 
                                                    : 'bg-transparent border-transparent text-slate-400 hover:bg-white/60'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleExportCol(key)}
                                                className="w-4 h-4 rounded text-orange-500 focus:ring-orange-400 accent-orange-500 shrink-0 cursor-pointer"
                                            />
                                            <span className="truncate flex-1" title={label !== key ? `${label} (${key})` : key}>
                                                {label}
                                            </span>
                                            {isAi && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
                                                    KI
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>

                            {/* Action Row with Export Button */}
                            <div className="pt-3 flex flex-wrap items-center justify-between gap-4 border-t" style={{ borderColor: 'var(--border-xs)' }}>
                                <div className="text-xs text-slate-500">
                                    Format: <strong className="text-slate-700">CSV</strong> (UTF-8, Kommagetrennt) &bull; {exportType === 'companies' ? `${total} Zeilen` : `${contactRows.length} Kontakte`}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleExportDownload}
                                    disabled={exportLoading || exportSelectedCols.size === 0}
                                    className="btn-v2 btn-v2-primary py-2 px-5 text-sm font-semibold flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                                >
                                    {exportLoading ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Export wird vorbereitet...
                                        </>
                                    ) : (
                                        <>
                                            <Download className="w-4 h-4" />
                                            CSV exportieren ({exportSelectedCols.size} Spalten)
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* JSON Snapshot Backup */}
                        <div className="p-5 rounded-xl border bg-white shadow-xs space-y-3" style={{ borderColor: 'var(--border)' }}>
                            <h3 className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                                <Database className="w-4 h-4 text-emerald-600" />
                                Vollständiger JSON-Snapshot
                            </h3>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                Sichert den kompletten Case inklusive aller Zeilen, KI-Spalten, Zellstatus und Metadaten in einer portablen JSON-Datei.
                            </p>
                            <a
                                href={`/api/export/snapshot?caseId=${caseData.id}`}
                                className="btn-v2 inline-flex items-center gap-2"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Snapshot herunterladen (.json)
                            </a>
                        </div>
                    </div>
                )}

                {/* Pagination (Only on Firmen Tab) */}
                {!loading && activeTab === "Firmen" && (
                    <div className="flex items-center justify-between px-4 py-2 bg-[#fbfaf8] border-t text-xs text-slate-500" style={{ borderColor: "var(--border)" }}>
                        <div className="flex items-center gap-3">
                            <span>
                                Zeile {total === 0 ? 0 : ((page - 1) * pageSize + 1).toLocaleString("de-DE")}–{Math.min(page * pageSize, total).toLocaleString("de-DE")} von {total.toLocaleString("de-DE")}
                            </span>
                            <div className="flex items-center gap-1.5 pl-3 border-l border-slate-200">
                                <span className="text-[11px] text-slate-400">Zeilen pro Seite:</span>
                                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-0.5">
                                    {[25, 50, 100, 200].map(sz => (
                                        <button
                                            key={sz}
                                            type="button"
                                            onClick={() => {
                                                setPageSize(sz);
                                                setPage(1);
                                                try { localStorage.setItem('dataminer_page_size', String(sz)); } catch {}
                                                loadPage(1, false, sz);
                                            }}
                                            className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                                                pageSize === sz
                                                    ? 'bg-orange-500 text-white font-bold'
                                                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                                            }`}
                                        >
                                            {sz}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-v2" title="Vorherige Seite">
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-medium text-slate-700">Seite {page} / {totalPages}</span>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-v2" title="Nächste Seite">
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Global API Alert / Toast */}
            {apiToast && (
                <div 
                    style={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        zIndex: 9999,
                        maxWidth: 420,
                        backgroundColor: '#fff',
                        borderRadius: 12,
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                        border: '1px solid #fecaca',
                        padding: '14px 16px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                    }}
                >
                    <div style={{ flexShrink: 0, marginTop: 2 }}>
                        <OctagonAlert style={{ width: 18, height: 18, color: '#dc2626' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 2 }}>
                            API-Guthaben aufgebraucht
                        </div>
                        <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.4 }}>
                            {apiToast.message}
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                            <a 
                                href="/settings" 
                                target="_blank"
                                style={{
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    color: '#b91c1c',
                                    textDecoration: 'underline'
                                }}
                            >
                                Zu den Einstellungen →
                            </a>
                        </div>
                    </div>
                    <button 
                        onClick={() => setApiToast(null)}
                        style={{
                            flexShrink: 0,
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            color: '#9ca3af',
                            padding: 2
                        }}
                    >
                        <X style={{ width: 14, height: 14 }} />
                    </button>
                </div>
            )}

            {/* Modals */}
            {showAgentModal && (
                <AgentGoalModal
                    caseId={caseData.id}
                    caseName={caseData.name}
                    initialRunId={selectedAgentRunId ?? undefined}
                    rowsCount={total}
                    onClose={() => {
                        setShowAgentModal(false);
                        setSelectedAgentRunId(null);
                    }}
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
                    cellContext={rows.length > 0 ? {
                        rowId: rows[0].id,
                        value: rows[0].data[editingCol.outputKey] ?? "",
                        status: (rows[0].cell_statuses?.[editingCol.outputKey] || "idle") as any,
                        rowLabel: rows[0].data["company_name"] || rows[0].data["Unternehmen"] || `Zeile #1`,
                        row: rows[0] as any,
                    } : undefined}
                    availableFields={baseCols.map(c => c.key)}
                    onSave={(updated) => {
                        const existing = caseData.ai_columns || (caseData as any).aiColumns || [];
                        const nextCols = existing.map((c: any) => c.id === updated.id ? updated : c);
                        setCaseData(prev => ({
                            ...prev,
                            ai_columns: nextCols,
                            aiColumns: nextCols
                        }));
                        setEditingCol(null);
                        refreshCase();
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

            {/* 🛡️ Two-Step Confirmation Dialog: Row Bulk Deletion */}
            <ConfirmDialog
                isOpen={confirmDeleteRows}
                title={`${selectedRows.size} Zeile(n) unwiderruflich löschen?`}
                message={
                    <span>
                        Du bist dabei, <strong>{selectedRows.size}</strong> ausgewählte Zeile(n) aus dem Projekt <strong>{caseData.name}</strong> dauerhaft zu entfernen. Alle zugehörigen angereicherten Daten und Kontaktdaten werden gelöscht.
                    </span>
                }
                confirmLabel="Ja, Zeilen löschen"
                danger={true}
                requireTextConfirmation={selectedRows.size > 20 ? "LÖSCHEN" : undefined}
                onConfirm={deleteSelectedRows}
                onClose={() => setConfirmDeleteRows(false)}
            />

            {/* 🛡️ Two-Step Confirmation Dialog: Column Deletion */}
            <ConfirmDialog
                isOpen={columnToDelete !== null}
                title={`Spalte "${columnToDelete?.name}" löschen?`}
                message={
                    <span>
                        Möchtest du die KI-Spalte <strong>{columnToDelete?.name}</strong> (Output-Key: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">{columnToDelete?.outputKey}</code>) wirklich entfernen? Alle zugehörigen Zell-Ergebnisse in dieser Spalte gehen verloren.
                    </span>
                }
                confirmLabel="Spalte entfernen"
                danger={true}
                onConfirm={() => columnToDelete && deleteColumn(columnToDelete.id, false)}
                onClose={() => setColumnToDelete(null)}
            />

            {/* 🛡️ Two-Step Confirmation Dialog: Data Column Deletion with Pre-Flight Checking */}
            <ConfirmDialog
                isOpen={dataColumnToDelete !== null}
                title={`Daten-Spalte "${dataColumnToDelete?.label}" löschen?`}
                message={
                    <div className="space-y-2 text-xs">
                        <p>
                            Möchtest du die Spalte <strong>{dataColumnToDelete?.label}</strong> (Feld: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">{dataColumnToDelete?.key}</code>) aus allen Zeilen entfernen?
                        </p>
                        <div className="p-2.5 rounded-lg border bg-slate-50 text-[11.5px] space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-slate-500">Befüllte Zeilen:</span>
                                <span className="font-semibold">{dataColumnToDelete?.filledCount} Zeilen</span>
                            </div>
                            {dataColumnToDelete?.isReferenced && (
                                <div className="text-blue-700 font-medium bg-blue-50 p-1.5 rounded border border-blue-200">
                                    ⚠️ <strong>Achtung:</strong> Dieses Feld wird in mindestens einem KI-Prompt oder einer Bedingung referenziert!
                                </div>
                            )}
                            {dataColumnToDelete?.isCore && (
                                <div className="text-amber-800 font-medium bg-amber-50 p-1.5 rounded border border-amber-200">
                                    ⚠️ <strong>Hinweis:</strong> Dies ist ein Standard-Kernfeld ({dataColumnToDelete?.key}). Das Löschen wird nur empfohlen, falls es sich um ein unerwünschtes Duplikat handelt.
                                </div>
                            )}
                            {dataColumnToDelete?.filledCount === 0 && (
                                <div className="text-emerald-700 font-medium bg-emerald-50 p-1.5 rounded border border-emerald-200">
                                    ✓ Die Spalte ist komplett leer (0 Werte). Das Löschen ist vollkommen sicher.
                                </div>
                            )}
                        </div>
                    </div>
                }
                confirmLabel="Ja, Daten-Spalte löschen"
                danger={true}
                requireTextConfirmation={dataColumnToDelete && dataColumnToDelete.filledCount > 10 ? "LÖSCHEN" : undefined}
                onConfirm={() => dataColumnToDelete && deleteColumn(dataColumnToDelete.key, true)}
                onClose={() => setDataColumnToDelete(null)}
            />

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
                                    Domain: <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-800">{cacheModalRow.data['domain'] || 'keine Domain'}</code>
                                </div>
                            </div>
                            <button onClick={() => setCacheModalRow(null)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
                                ✕
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {/* ── GMB Vorhandene Daten (falls vorhanden) ── */}
                            {(cacheModalRow.data['Quelle'] === 'Google Maps' || cacheModalRow.data['maps_url'] || cacheModalRow.data['maps_rating'] || cacheModalRow.data['Adresse']) && (() => {
                                const gmbRawFields = Object.entries(cacheModalRow.data).filter(([k]) => 
                                    ['Quelle', 'maps_url', 'maps_rating', 'maps_reviews', 'category', 'Kategorie', 'Unternehmen', 'company_name', 'Adresse', 'address', 'phone', 'Telefon', 'Bewertung', 'domain'].includes(k)
                                );
                                const gmbJson = Object.fromEntries(gmbRawFields);

                                return (
                                <div className="border rounded-xl p-3.5 space-y-3 bg-white" style={{ borderColor: 'var(--border)' }}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">📍</span>
                                            <span className="font-semibold text-xs text-slate-800">Google Maps / GMB Daten (aus Discovery)</span>
                                            <span className="text-[10px] bg-slate-100 text-slate-600 font-medium px-2 py-0.5 rounded border" style={{ borderColor: 'var(--border-xs)' }}>
                                                gmb:existing
                                            </span>
                                        </div>
                                        {cacheModalRow.data['maps_url'] && (
                                            <a 
                                                href={cacheModalRow.data['maps_url']} 
                                                target="_blank" 
                                                rel="noreferrer"
                                                className="text-[11px] text-orange-600 hover:text-orange-700 font-medium hover:underline flex items-center gap-1"
                                            >
                                                Auf Maps öffnen ↗
                                            </a>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                        <div className="p-2.5 rounded-lg border bg-slate-50/50" style={{ borderColor: 'var(--border-xs)' }}>
                                            <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Name / Titel</div>
                                            <div className="font-semibold text-slate-800 truncate mt-0.5" title={cacheModalRow.data['Unternehmen'] || cacheModalRow.data['company_name']}>
                                                {cacheModalRow.data['Unternehmen'] || cacheModalRow.data['company_name'] || '—'}
                                            </div>
                                        </div>
                                        <div className="p-2.5 rounded-lg border bg-slate-50/50" style={{ borderColor: 'var(--border-xs)' }}>
                                            <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Adresse (GMB)</div>
                                            <div className="font-semibold text-slate-800 truncate mt-0.5" title={cacheModalRow.data['Adresse'] || cacheModalRow.data['address']}>
                                                {cacheModalRow.data['Adresse'] || cacheModalRow.data['address'] || '—'}
                                            </div>
                                        </div>
                                        <div className="p-2.5 rounded-lg border bg-slate-50/50" style={{ borderColor: 'var(--border-xs)' }}>
                                            <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Telefon</div>
                                            <div className="font-semibold text-slate-800 truncate mt-0.5">
                                                {cacheModalRow.data['phone'] || '—'}
                                            </div>
                                        </div>
                                        <div className="p-2.5 rounded-lg border bg-slate-50/50" style={{ borderColor: 'var(--border-xs)' }}>
                                            <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Bewertung & Typ</div>
                                            <div className="font-semibold text-slate-800 truncate mt-0.5">
                                                ★ {cacheModalRow.data['maps_rating'] || cacheModalRow.data['Bewertung'] || '—'} · {cacheModalRow.data['Kategorie'] || cacheModalRow.data['category'] || 'Ort'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Raw GMB JSON Payload */}
                                    <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border-xs)' }}>
                                        <div className="p-2 bg-slate-50 border-b flex items-center justify-between text-xs" style={{ borderColor: 'var(--border-xs)' }}>
                                            <span className="text-[10.5px] font-mono font-medium text-slate-600">
                                                {'{ }'} Ursprünglicher GMB Datensatz (JSON)
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(JSON.stringify(gmbJson, null, 2));
                                                    alert('GMB Rohdaten in Zwischenablage kopiert!');
                                                }}
                                                className="text-[10.5px] text-orange-600 hover:text-orange-700 hover:underline cursor-pointer font-medium"
                                            >
                                                JSON kopieren
                                            </button>
                                        </div>
                                        <pre className="p-3 bg-white text-slate-700 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-48 whitespace-pre-wrap select-text">
                                            {JSON.stringify(gmbJson, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                                );
                            })()}

                            {/* ── Gecachte Scrape / Impressum Webdaten ── */}
                            <div className="space-y-2">
                                <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                                    <span>🌐</span>
                                    <span>Gecachte Web-Scrapes & Impressum</span>
                                </div>

                                {cacheModalLoading ? (
                                    <div className="p-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                                        <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                                        Lade PostgreSQL Cache-Einträge…
                                    </div>
                                ) : cacheModalEntries.length === 0 ? (
                                    <div className="p-6 text-center text-xs rounded-lg bg-slate-50 border text-slate-500" style={{ borderColor: 'var(--border-xs)' }}>
                                        Keine gecachten Web-Scrapes für diese Domain im Cache vorhanden.
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
                </div>
            )}
        </AppLayout>
    );
}
