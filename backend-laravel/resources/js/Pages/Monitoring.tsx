import React, { useState, useEffect } from 'react';
import AppLayout from '../Layouts/AppLayout';
import { 
    Activity, Play, CheckCircle2, XCircle, Clock, 
    RefreshCw, Zap, DollarSign, Database, ArrowRight, Server
} from 'lucide-react';
import { Link } from '@inertiajs/react';
import { apiFetch } from '../api';

interface RunnerMetric {
    total_cases: number;
    total_runs: number;
    running_runs: number;
    completed_runs: number;
    total_rows_discovered: number;
    total_cost_usd: number;
    total_tokens: number;
}

interface RunnerItem {
    id: string;
    case_id: string;
    case_name: string;
    goal: string;
    target_count: number;
    status: string;
    current_step: number;
    total_steps: number;
    rows_added: number;
    cost_usd: number;
    tokens: number;
    last_log: string | null;
    started_at: string | null;
    updated_at: string | null;
}

export default function MonitoringPage() {
    const [metrics, setMetrics] = useState<RunnerMetric | null>(null);
    const [runs, setRuns] = useState<RunnerItem[]>([]);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        try {
            const res = await apiFetch('/api/monitoring/overview');
            const data = await res.json();
            if (data.metrics) setMetrics(data.metrics);
            if (Array.isArray(data.runs)) setRuns(data.runs);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 4000);
        return () => clearInterval(interval);
    }, []);

    return (
        <AppLayout
            title="Queue & Runner Live-Monitoring"
            actions={
                <button
                    onClick={loadData}
                    className="btn-v2 btn-v2-ghost flex items-center gap-1.5 text-xs py-1 px-2.5"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>Aktualisieren</span>
                </button>
            }
        >
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header overview */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            <Activity className="w-5 h-5 text-orange-500 animate-pulse" />
                            Autonome Runner & Queue-Status
                        </h2>
                        <p className="text-xs text-slate-500">
                            Zentrale Übersicht aller Hintergrund-Suchläufe über alle Cases hinweg.
                        </p>
                    </div>
                </div>

                {/* KPI Cards */}
                {metrics && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl border bg-white shadow-xs space-y-1" style={{ borderColor: 'var(--border)' }}>
                            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Server className="w-3.5 h-3.5 text-blue-500" /> Aktive Runner
                            </div>
                            <div className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                                <span>{metrics.running_runs}</span>
                                {metrics.running_runs > 0 && (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">läuft</span>
                                )}
                            </div>
                            <div className="text-[11px] text-slate-500">{metrics.completed_runs} erfolgreich beendet</div>
                        </div>

                        <div className="p-4 rounded-xl border bg-white shadow-xs space-y-1" style={{ borderColor: 'var(--border)' }}>
                            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Database className="w-3.5 h-3.5 text-emerald-500" /> Gefundene Leads
                            </div>
                            <div className="text-2xl font-bold text-emerald-600">
                                {metrics.total_rows_discovered.toLocaleString('de-DE')}
                            </div>
                            <div className="text-[11px] text-slate-500">über alle Discovery-Läufe</div>
                        </div>

                        <div className="p-4 rounded-xl border bg-white shadow-xs space-y-1" style={{ borderColor: 'var(--border)' }}>
                            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <DollarSign className="w-3.5 h-3.5 text-amber-500" /> Gesamtkosten
                            </div>
                            <div className="text-2xl font-bold text-slate-900">
                                ${metrics.total_cost_usd.toFixed(4)}
                            </div>
                            <div className="text-[11px] text-slate-500">LLM & Search APIs</div>
                        </div>

                        <div className="p-4 rounded-xl border bg-white shadow-xs space-y-1" style={{ borderColor: 'var(--border)' }}>
                            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Zap className="w-3.5 h-3.5 text-indigo-500" /> Verbrauchte Tokens
                            </div>
                            <div className="text-2xl font-bold text-slate-900">
                                {metrics.total_tokens.toLocaleString('de-DE')}
                            </div>
                            <div className="text-[11px] text-slate-500">in Planungs- & LLM-Aufrufen</div>
                        </div>
                    </div>
                )}

                {/* Runs Table / Cards */}
                <div className="border rounded-xl bg-white shadow-xs overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                    <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                        <div className="font-semibold text-sm text-slate-800">Alle Agent-Discovery-Läufe</div>
                        <div className="text-xs text-slate-400">{runs.length} Läufe insgesamt</div>
                    </div>

                    {loading ? (
                        <div className="p-12 text-center text-xs text-slate-400">Lade Runner-Status...</div>
                    ) : runs.length === 0 ? (
                        <div className="p-12 text-center text-xs text-slate-400">Noch keine Runner gestartet.</div>
                    ) : (
                        <div className="divide-y" style={{ borderColor: 'var(--border-xs)' }}>
                            {runs.map((r) => {
                                const pct = r.total_steps > 0 ? Math.min(100, Math.round((r.current_step / r.total_steps) * 100)) : 0;
                                const isRunning = r.status === 'running';
                                const isDone = r.status === 'completed';

                                return (
                                    <div key={r.id} className="p-4 hover:bg-slate-50/50 transition-colors space-y-3">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                                        isDone ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                                        isRunning ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse' :
                                                        'bg-orange-50 text-orange-700 border border-orange-200'
                                                    }`}>
                                                        {r.status}
                                                    </span>
                                                    <Link 
                                                        href={`/cases/${r.case_id}`} 
                                                        className="font-semibold text-xs text-slate-900 hover:text-orange-600 transition-colors flex items-center gap-1 truncate"
                                                    >
                                                        <span>{r.case_name}</span>
                                                        <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                                                    </Link>
                                                </div>
                                                <div className="font-medium text-sm text-slate-800 mt-1">
                                                    🎯 {r.goal}
                                                </div>
                                                {r.last_log && (
                                                    <div className="text-[11px] text-slate-500 font-mono mt-1 truncate max-w-2xl bg-slate-100 px-2 py-0.5 rounded">
                                                        {r.last_log}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="text-right shrink-0">
                                                <div className="font-bold text-sm text-emerald-600">
                                                    +{r.rows_added} Leads
                                                </div>
                                                <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                                    Schritt {r.current_step} / {r.total_steps} ({pct}%)
                                                </div>
                                                <div className="text-[10px] text-slate-400 mt-1">
                                                    {r.updated_at ? new Date(r.updated_at).toLocaleTimeString('de-DE') : ''}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Progress Bar */}
                                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                            <div 
                                                className={`h-full transition-all duration-300 ${isDone ? 'bg-emerald-500' : 'bg-blue-600'}`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}
