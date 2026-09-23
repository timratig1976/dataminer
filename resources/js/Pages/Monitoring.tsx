import React, { useState, useEffect } from 'react';
import AppLayout from '../Layouts/AppLayout';
import { 
    Activity, Play, CheckCircle2, XCircle, Clock, 
    RefreshCw, Zap, DollarSign, Database, ArrowRight, Server, Terminal, AlertCircle
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

interface EnrichmentJobItem {
    id: string;
    case_id: string;
    case_name: string;
    tool: string;
    status: string;
    total_rows: number;
    processed_rows: number;
    failed_rows: number;
    error: string | null;
    created_at: string | null;
    updated_at: string | null;
}

interface CaseLogItem {
    id: number;
    case_id: string;
    case_name: string;
    message: string;
    created_at: string | null;
}

interface WorkerInfo {
    pm2_detected: boolean;
    workers: Array<{
        name: string;
        status: string;
        pid: number | null;
        memory_mb: number;
        cpu_percent: number;
        restarts: number;
    }>;
    queue_driver: string;
    pending_jobs: number;
    failed_jobs: number;
}

export default function MonitoringPage() {
    const [metrics, setMetrics] = useState<RunnerMetric | null>(null);
    const [runs, setRuns] = useState<RunnerItem[]>([]);
    const [jobs, setJobs] = useState<EnrichmentJobItem[]>([]);
    const [logs, setLogs] = useState<CaseLogItem[]>([]);
    const [workerInfo, setWorkerInfo] = useState<WorkerInfo | null>(null);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        try {
            const res = await apiFetch('/api/monitoring/overview');
            const data = await res.json();
            if (data.metrics) setMetrics(data.metrics);
            if (Array.isArray(data.runs)) setRuns(data.runs);
            if (Array.isArray(data.enrichment_jobs)) setJobs(data.enrichment_jobs);
            if (Array.isArray(data.recent_logs)) setLogs(data.recent_logs);
            if (data.worker_info) setWorkerInfo(data.worker_info);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 3000);
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
                            Autonome Runner, Worker-Queues & Live-Logs
                        </h2>
                        <p className="text-xs text-slate-500">
                            Zentrale Übersicht aller Hintergrund-Prozesse, Queue-Jobs und Ausführungs-Logs über alle Cases hinweg.
                        </p>
                    </div>
                </div>

                {/* KPI Cards */}
                {metrics && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl border bg-white shadow-xs space-y-1" style={{ borderColor: 'var(--border)' }}>
                            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Server className="w-3.5 h-3.5 text-blue-500" /> Aktive Prozesse
                            </div>
                            <div className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                                <span>{metrics.running_runs}</span>
                                {metrics.running_runs > 0 ? (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold animate-pulse">in Ausführung</span>
                                ) : (
                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">Leerlauf</span>
                                )}
                            </div>
                            <div className="text-[11px] text-slate-500">
                                {workerInfo?.pm2_detected ? (
                                    <span className="text-emerald-600 font-medium">● PM2 Worker aktiv ({workerInfo.workers.length} Prozesse)</span>
                                ) : (
                                    <span>Queue: {workerInfo?.queue_driver || 'database'} ({workerInfo?.pending_jobs || 0} wartend)</span>
                                )}
                            </div>
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

                {/* Grid: 2 Columns (Left: Jobs & Agent Runs, Right: Real-time Live Log Feed) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Column: Running Queues & Jobs (7 cols) */}
                    <div className="lg:col-span-7 space-y-6">
                        {/* Table / Queue Enrichment Jobs */}
                        <div className="border rounded-xl bg-white shadow-xs overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                                <div className="font-semibold text-sm text-slate-800 flex items-center gap-2">
                                    <Database className="w-4 h-4 text-purple-600" />
                                    Tabellen- & Spalten-Queue-Jobs ({jobs.length})
                                </div>
                            </div>

                            {jobs.length === 0 ? (
                                <div className="p-8 text-center text-xs text-slate-400">Keine Tabellen-Queue-Jobs vorhanden.</div>
                            ) : (
                                <div className="divide-y max-h-96 overflow-y-auto" style={{ borderColor: 'var(--border-xs)' }}>
                                    {jobs.map(j => {
                                        const total = j.total_rows || 1;
                                        const done = j.processed_rows + j.failed_rows;
                                        const pct = Math.min(100, Math.round((done / total) * 100));
                                        const isRunning = j.status === 'running' || j.status === 'queued';
                                        const isCancelled = j.status === 'cancelled';
                                        const isDone = j.status === 'completed';

                                        return (
                                            <div key={j.id} className="p-3.5 hover:bg-slate-50/50 transition-colors space-y-2">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 truncate">
                                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                                            isDone ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                                            isRunning ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse' :
                                                            isCancelled ? 'bg-slate-100 text-slate-600 border border-slate-200' :
                                                            'bg-rose-50 text-rose-700 border border-rose-200'
                                                        }`}>
                                                            {j.status}
                                                        </span>
                                                        <Link href={`/cases/${j.case_id}`} className="font-semibold text-xs text-slate-900 hover:text-orange-600 truncate">
                                                            {j.case_name}
                                                        </Link>
                                                        <span className="text-[10px] font-mono text-slate-400">({j.tool})</span>
                                                    </div>
                                                    <div className="text-right text-xs font-mono font-medium text-slate-600">
                                                        {done} / {j.total_rows} ({pct}%)
                                                    </div>
                                                </div>

                                                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                    <div 
                                                        className={`h-full transition-all duration-300 ${isDone ? 'bg-emerald-500' : isCancelled ? 'bg-slate-400' : 'bg-blue-600'}`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Agent Discovery Runs */}
                        <div className="border rounded-xl bg-white shadow-xs overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                                <div className="font-semibold text-sm text-slate-800 flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-orange-500" />
                                    Agent Discovery-Läufe ({runs.length})
                                </div>
                            </div>

                            {runs.length === 0 ? (
                                <div className="p-8 text-center text-xs text-slate-400">Keine Agent-Discovery-Läufe vorhanden.</div>
                            ) : (
                                <div className="divide-y max-h-96 overflow-y-auto" style={{ borderColor: 'var(--border-xs)' }}>
                                    {runs.map((r) => {
                                        const pct = r.total_steps > 0 ? Math.min(100, Math.round((r.current_step / r.total_steps) * 100)) : 0;
                                        const isRunning = r.status === 'running';
                                        const isDone = r.status === 'completed';

                                        return (
                                            <div key={r.id} className="p-3.5 hover:bg-slate-50/50 transition-colors space-y-2">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                                                isDone ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                                                isRunning ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse' :
                                                                'bg-orange-50 text-orange-700 border border-orange-200'
                                                            }`}>
                                                                {r.status}
                                                            </span>
                                                            <Link href={`/cases/${r.case_id}`} className="font-semibold text-xs text-slate-900 hover:text-orange-600 truncate">
                                                                {r.case_name}
                                                            </Link>
                                                        </div>
                                                        <div className="font-medium text-xs text-slate-800 mt-1 truncate">
                                                            🎯 {r.goal}
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <span className="font-bold text-xs text-emerald-600">+{r.rows_added} Leads</span>
                                                        <div className="text-[10.5px] text-slate-400 font-mono">Schritt {r.current_step}/{r.total_steps}</div>
                                                    </div>
                                                </div>

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

                    {/* Right Column: Live Case Logs Stream (5 cols) */}
                    <div className="lg:col-span-5">
                        <div className="border rounded-xl bg-white shadow-xs overflow-hidden flex flex-col h-[740px]" style={{ borderColor: 'var(--border)' }}>
                            <div className="p-3.5 border-b flex items-center justify-between bg-slate-50/50" style={{ borderColor: 'var(--border)' }}>
                                <div className="font-semibold text-xs text-slate-800 flex items-center gap-2">
                                    <Terminal className="w-4 h-4 text-slate-600" />
                                    Live-Ausführungs-Logs ({logs.length})
                                </div>
                                <span className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-semibold">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                                    Live
                                </span>
                            </div>

                            <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-2 bg-[#0f172a] text-slate-200">
                                {logs.length === 0 ? (
                                    <div className="text-slate-500 text-center py-16">
                                        Noch keine Ausführungs-Logs vorhanden.
                                    </div>
                                ) : (
                                    logs.map(log => {
                                        const isErr = log.message.includes('✗') || log.message.toLowerCase().includes('fehler');
                                        const isOk = log.message.includes('✓');
                                        const isStart = log.message.includes('▶');

                                        return (
                                            <div key={log.id} className="border-b border-slate-800 pb-1.5">
                                                <div className="flex items-center justify-between text-[10px] text-slate-400">
                                                    <span className="text-orange-400 font-semibold">{log.case_name}</span>
                                                    <span>{log.created_at ? new Date(log.created_at).toLocaleTimeString('de-DE') : ''}</span>
                                                </div>
                                                <div className={`mt-0.5 break-all ${
                                                    isErr ? 'text-rose-400 font-semibold' :
                                                    isOk ? 'text-emerald-400' :
                                                    isStart ? 'text-sky-300' :
                                                    'text-slate-300'
                                                }`}>
                                                    {log.message}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
