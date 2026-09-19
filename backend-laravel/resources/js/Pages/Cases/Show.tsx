import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { ArrowLeft, Play, Download, Sparkles, RefreshCw, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { Link } from '@inertiajs/react';

interface CaseDetail {
    id: string;
    name: string;
    description?: string;
    columns?: Array<{ key: string; label: string }>;
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
    const [rows, setRows] = useState<RowItem[]>([]);
    const [total, setTotal] = useState(c.rows_count);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const loadPage = useCallback((p: number) => {
        setLoading(true);
        setError(null);
        fetch(`/api/rows?caseId=${c.id}&limit=${PAGE_SIZE}&page=${p}`)
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
    }, [c.id]);

    useEffect(() => { loadPage(page); }, [page, loadPage]);

    const columns = c.columns && c.columns.length > 0
        ? c.columns
        : (rows[0] ? Object.keys(rows[0].data).map(k => ({ key: k, label: k })) : []);

    return (
        <AppLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/cases" className="p-2 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold">{c.name}</h1>
                            <p className="text-xs text-slate-400">{total.toLocaleString('de-DE')} Zeilen</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
                            <Sparkles className="w-3.5 h-3.5" /> 100k Enrichment starten
                        </button>
                        <a
                            href={`/api/export?caseId=${c.id}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-medium"
                        >
                            <Download className="w-3.5 h-3.5" /> CSV Export
                        </a>
                    </div>
                </div>

                <div className="border border-slate-800 bg-slate-900 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto max-h-[70vh]">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-slate-950/80 sticky top-0 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                                <tr>
                                    <th className="p-3 w-12 border-r border-slate-800/60">#</th>
                                    {columns.map(col => (
                                        <th key={col.key} className="p-3 border-r border-slate-800/60 min-w-[150px]">
                                            {col.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/40 text-slate-200">
                                {loading ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-8 text-center text-slate-500">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                                            Lade Tabellendaten...
                                        </td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-8 text-center text-red-400">
                                            <AlertCircle className="w-5 h-5 mx-auto mb-2" />
                                            Fehler: {error}
                                            <button onClick={() => loadPage(page)} className="ml-3 underline hover:text-red-300">Erneut versuchen</button>
                                        </td>
                                    </tr>
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-8 text-center text-slate-500">
                                            Keine Zeilen vorhanden.
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((r, idx) => (
                                        <tr key={r.id} className="hover:bg-slate-800/30">
                                            <td className="p-3 border-r border-slate-800/60 text-slate-500 font-mono text-[10px]">
                                                {(page - 1) * PAGE_SIZE + idx + 1}
                                            </td>
                                            {columns.map(col => (
                                                <td key={col.key} className="p-3 border-r border-slate-800/60 truncate max-w-[300px]">
                                                    {r.data[col.key] !== null && r.data[col.key] !== undefined ? String(r.data[col.key]) : '—'}
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Footer */}
                    {!loading && !error && totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 bg-slate-950/60 text-xs text-slate-400">
                            <span>
                                Zeile {((page - 1) * PAGE_SIZE + 1).toLocaleString('de-DE')}–{Math.min(page * PAGE_SIZE, total).toLocaleString('de-DE')} von {total.toLocaleString('de-DE')}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                                <span>Seite {page} / {totalPages}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}

interface CaseDetail {
    id: string;
    name: string;
    description?: string;
    columns?: Array<{ key: string; label: string }>;
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

export default function CaseShow({ case: c }: Props) {
    const [rows, setRows] = useState<RowItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/rows?caseId=${c.id}&limit=50`)
            .then(res => res.json())
            .then(data => {
                const list = Array.isArray(data) ? data : (data.rows || []);
                setRows(list);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [c.id]);

    const columns = c.columns && c.columns.length > 0 
        ? c.columns 
        : (rows[0] ? Object.keys(rows[0].data).map(k => ({ key: k, label: k })) : []);

    return (
        <AppLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/cases" className="p-2 bg-slate-900 border border-slate-800 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold">{c.name}</h1>
                            <p className="text-xs text-slate-400">{c.rows_count.toLocaleString('de-DE')} Zeilen</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold">
                            <Sparkles className="w-3.5 h-3.5" /> 100k Enrichment starten
                        </button>
                        <a 
                            href={`/api/export?caseId=${c.id}`} 
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-medium"
                        >
                            <Download className="w-3.5 h-3.5" /> CSV Export
                        </a>
                    </div>
                </div>

                <div className="border border-slate-800 bg-slate-900 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto max-h-[70vh]">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-slate-950/80 sticky top-0 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                                <tr>
                                    <th className="p-3 w-12 border-r border-slate-800/60">#</th>
                                    {columns.map(col => (
                                        <th key={col.key} className="p-3 border-r border-slate-800/60 min-w-[150px]">
                                            {col.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/40 text-slate-200">
                                {loading ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-8 text-center text-slate-500">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                                            Lade Tabellendaten...
                                        </td>
                                    </tr>
                                ) : rows.length === 0 ? (
                                    <tr>
                                        <td colSpan={columns.length + 1} className="p-8 text-center text-slate-500">
                                            Keine Zeilen vorhanden.
                                        </td>
                                    </tr>
                                ) : (
                                    rows.map((r, idx) => (
                                        <tr key={r.id} className="hover:bg-slate-800/30">
                                            <td className="p-3 border-r border-slate-800/60 text-slate-500 font-mono text-[10px]">
                                                {idx + 1}
                                            </td>
                                            {columns.map(col => (
                                                <td key={col.key} className="p-3 border-r border-slate-800/60 truncate max-w-[300px]">
                                                    {r.data[col.key] !== null && r.data[col.key] !== undefined ? String(r.data[col.key]) : '—'}
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
