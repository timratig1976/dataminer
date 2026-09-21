import React, { useState, useEffect } from 'react';
import { Link, usePage } from '@inertiajs/react';
import { 
    LayoutDashboard, Database, Settings, Sliders, Zap, Sparkles, Users, User, DatabaseZap, BrainCircuit,
    AlertTriangle, CheckCircle2, RefreshCw, Activity, ChevronLeft, ChevronRight, ShieldAlert, LogOut
} from 'lucide-react';
import { apiFetch } from '../api';

interface SidebarCase {
    id: string;
    name: string;
    rows_count?: number;
}

interface ApiHealthData {
    statuses: Record<string, { configured: boolean; status: string; message: string; limit?: number }>;
    flaws: Array<{ provider: string; status: string; message: string }>;
    has_flaw: boolean;
}

export default function Layout({ 
    children, 
    title,
    actions 
}: { 
    children: React.ReactNode;
    title?: React.ReactNode;
    actions?: React.ReactNode;
}) {
    const { url } = usePage();
    const [recentCases, setRecentCases] = useState<SidebarCase[]>([]);
    const [healthData, setHealthData] = useState<ApiHealthData | null>(null);
    const [showHealthPopover, setShowHealthPopover] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            return localStorage.getItem('dataminer_sidebar_collapsed') === 'true';
        } catch {
            return false;
        }
    });

    const toggleSidebar = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            try {
                localStorage.setItem('dataminer_sidebar_collapsed', String(next));
            } catch {}
            if (next) setShowSettingsMenu(false);
            return next;
        });
    };

    useEffect(() => {
        fetch('/api/cases')
            .then(res => res.ok ? res.json() : [])
            .then(data => {
                if (Array.isArray(data)) {
                    setRecentCases(data.slice(0, 10));
                }
            })
            .catch(() => {});

        // Fetch API quota health
        apiFetch('/api/settings/health')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setHealthData(d); })
            .catch(() => {});
    }, [url]);

    const bottomNav = [
        { href: '/settings', title: 'Einstellungen & Konfiguration', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
        { href: '/settings/users', title: 'Benutzer & Rollen', label: 'Users', icon: <Users className="w-4 h-4" /> },
    ];

    return (
        <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--f)' }}>
            {/* ─ Sidebar (Original Next.js Design) ─ */}
            <nav
                className="flex flex-col shrink-0 transition-all duration-200 relative"
                style={{
                    width: isCollapsed ? 56 : 210,
                    minWidth: isCollapsed ? 56 : 210,
                    background: 'var(--surface)',
                }}
            >
                {/* Logo & Toggle Header (Exact 52px geometric match to topbar) */}
                <div
                    className="flex items-center shrink-0"
                    style={{
                        height: 52,
                        paddingLeft: isCollapsed ? 8 : 16,
                        paddingRight: isCollapsed ? 8 : 12,
                        justifyContent: isCollapsed ? 'center' : 'space-between',
                    }}
                >
                    {isCollapsed ? (
                        <button
                            onClick={toggleSidebar}
                            title="Sidebar ausklappen"
                            className="flex items-center justify-center gap-1.5 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer group"
                        >
                            <div
                                className="w-6 h-6 rounded flex items-center justify-center text-white text-[11px] font-bold shadow-sm shrink-0"
                                style={{ background: 'var(--orange)' }}
                            >
                                D
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-x-0.5" />
                        </button>
                    ) : (
                        <>
                            <Link
                                href="/"
                                className="flex items-center gap-2.5 hover:opacity-85 transition-opacity text-left cursor-pointer overflow-hidden"
                                title="DataMiner"
                            >
                                <div
                                    className="w-6 h-6 rounded flex items-center justify-center text-white text-[11px] font-bold shadow-sm shrink-0"
                                    style={{ background: 'var(--orange)' }}
                                >
                                    D
                                </div>
                                <span className="font-semibold text-[13.5px] tracking-tight truncate" style={{ color: 'var(--text-1)' }}>
                                    DataMiner
                                </span>
                            </Link>
                            <button
                                onClick={toggleSidebar}
                                title="Sidebar einklappen"
                                className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                        </>
                    )}
                </div>

                {/* Section: Main Nav & Cases */}
                <div className="flex-1 overflow-y-auto px-2 py-3 overflow-x-hidden">
                    <div className="flex flex-col gap-1 mb-4">
                        <Link
                            href="/"
                            title="Dashboard"
                            className="w-full flex items-center rounded text-[12.5px] text-left transition-colors cursor-pointer"
                            style={{
                                padding: isCollapsed ? '8px 0' : '6px 10px',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: isCollapsed ? 0 : 8,
                                background: url === '/' ? 'var(--orange-soft)' : 'transparent',
                                color: url === '/' ? 'var(--orange)' : 'var(--text-2)',
                                fontWeight: url === '/' ? 600 : 400,
                            }}
                        >
                            <LayoutDashboard className="w-4 h-4 shrink-0" />
                            {!isCollapsed && <span className="truncate">Dashboard</span>}
                        </Link>

                        <Link
                            href="/cases"
                            title="Alle Cases"
                            className="w-full flex items-center rounded text-[12.5px] text-left transition-colors cursor-pointer"
                            style={{
                                padding: isCollapsed ? '8px 0' : '6px 10px',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: isCollapsed ? 0 : 8,
                                background: url === '/cases' ? 'var(--orange-soft)' : 'transparent',
                                color: url === '/cases' ? 'var(--orange)' : 'var(--text-2)',
                                fontWeight: url === '/cases' ? 600 : 400,
                            }}
                        >
                            <Database className="w-4 h-4 shrink-0" />
                            {!isCollapsed && <span className="truncate">Alle Cases</span>}
                        </Link>

                        <Link
                            href="/raw-imports"
                            title="Raw Data Manager"
                            className="w-full flex items-center rounded text-[12.5px] text-left transition-colors cursor-pointer"
                            style={{
                                padding: isCollapsed ? '8px 0' : '6px 10px',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: isCollapsed ? 0 : 8,
                                background: url.startsWith('/raw-imports') ? 'var(--orange-soft)' : 'transparent',
                                color: url.startsWith('/raw-imports') ? 'var(--orange)' : 'var(--text-2)',
                                fontWeight: url.startsWith('/raw-imports') ? 600 : 400,
                            }}
                        >
                            <DatabaseZap className="w-4 h-4 shrink-0" />
                            {!isCollapsed && <span className="truncate">Raw Data</span>}
                        </Link>

                        <Link
                            href="/monitoring"
                            title="Runner Monitoring"
                            className="w-full flex items-center rounded text-[12.5px] text-left transition-colors cursor-pointer"
                            style={{
                                padding: isCollapsed ? '8px 0' : '6px 10px',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: isCollapsed ? 0 : 8,
                                background: url.startsWith('/monitoring') ? 'var(--orange-soft)' : 'transparent',
                                color: url.startsWith('/monitoring') ? 'var(--orange)' : 'var(--text-2)',
                                fontWeight: url.startsWith('/monitoring') ? 600 : 400,
                            }}
                        >
                            <Activity className="w-4 h-4 shrink-0" />
                            {!isCollapsed && <span className="truncate">Monitoring</span>}
                        </Link>
                    </div>

                    {/* Cases List */}
                    {recentCases.length > 0 && !isCollapsed && (
                        <div>
                            <div
                                className="text-[10px] font-semibold tracking-wider uppercase mb-1.5 px-2"
                                style={{ color: 'var(--text-3)' }}
                            >
                                Cases
                            </div>
                            <div className="flex flex-col gap-1">
                                {recentCases.map((c) => {
                                    const isActive = url === `/cases/${c.id}`;
                                    return (
                                        <Link
                                            key={c.id}
                                            href={`/cases/${c.id}`}
                                            className="px-2 py-1.5 rounded cursor-pointer transition-colors block"
                                            style={{
                                                background: isActive ? 'var(--orange-soft)' : 'transparent',
                                            }}
                                        >
                                            <div
                                                className="text-[12px] font-medium truncate"
                                                style={{ color: isActive ? 'var(--orange)' : 'var(--text-1)' }}
                                                title={c.name}
                                            >
                                                {c.name}
                                            </div>
                                            {typeof c.rows_count === 'number' && (
                                                <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                                                    {c.rows_count.toLocaleString('de-DE')} Zeilen
                                                </div>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Bottom navigation links */}
                <div
                    className={isCollapsed ? "px-2 py-2 flex flex-col items-center shrink-0 relative" : "px-2 pt-2 pb-1 flex flex-col gap-0.5 shrink-0"}
                    style={{ borderTop: '1px solid var(--border-xs)' }}
                >
                    {isCollapsed ? (
                        <>
                            <button
                                type="button"
                                onClick={() => setShowSettingsMenu(prev => !prev)}
                                title="Einstellungen Menü"
                                className="w-10 h-10 flex items-center justify-center rounded-lg transition-all cursor-pointer hover:bg-slate-100"
                                style={{
                                    color: url.startsWith('/settings') ? 'var(--orange)' : 'var(--text-2)',
                                    background: url.startsWith('/settings') || showSettingsMenu ? 'var(--orange-soft)' : 'transparent',
                                    border: (url.startsWith('/settings') || showSettingsMenu) ? '1px solid rgba(234, 88, 12, 0.25)' : '1px solid transparent',
                                }}
                            >
                                <Settings className="w-4 h-4" />
                            </button>

                            {/* Flyout Submenu */}
                            {showSettingsMenu && (
                                <>
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setShowSettingsMenu(false)}
                                    />
                                    <div
                                        className="absolute left-full bottom-2 ml-2 w-56 rounded-xl shadow-xl z-50 p-1.5 flex flex-col gap-0.5 animate-in fade-in slide-in-from-left-2 duration-150"
                                        style={{
                                            background: 'var(--surface)',
                                            border: '1px solid var(--border)',
                                        }}
                                    >
                                        <div
                                            className="text-[10px] font-semibold tracking-wider uppercase px-3 py-1.5"
                                            style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border-xs)' }}
                                        >
                                            Einstellungen
                                        </div>
                                        <div className="flex flex-col gap-0.5 pt-1">
                                            {bottomNav.map((item, idx) => {
                                                const active = url === item.href;
                                                return (
                                                    <Link
                                                        key={idx}
                                                        href={item.href}
                                                        onClick={() => setShowSettingsMenu(false)}
                                                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors cursor-pointer"
                                                        style={{
                                                            color: active ? 'var(--orange)' : 'var(--text-1)',
                                                            background: active ? 'var(--orange-soft)' : 'transparent',
                                                        }}
                                                    >
                                                        <div style={{ color: active ? 'var(--orange)' : 'var(--text-2)' }}>
                                                            {item.icon}
                                                        </div>
                                                        <div className="flex flex-col text-left">
                                                            <span className="leading-tight">{item.label}</span>
                                                            <span className="text-[10px] opacity-60 leading-tight">{item.title}</span>
                                                        </div>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <div
                                className="text-[9.5px] font-semibold tracking-wider uppercase px-2 mb-1"
                                style={{ color: 'var(--text-3)' }}
                            >
                                Administration
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                                {bottomNav.map((item, idx) => {
                                    const active = url === item.href || (item.href === '/settings' && url.startsWith('/settings') && !url.startsWith('/settings/users'));
                                    return (
                                        <Link
                                            key={idx}
                                            href={item.href}
                                            title={item.title}
                                            className="flex items-center gap-2 py-2 px-2.5 rounded-lg transition-all cursor-pointer group"
                                            style={{
                                                color: active ? 'var(--orange)' : 'var(--text-2)',
                                                background: active ? 'var(--orange-soft)' : 'transparent',
                                                border: active ? '1px solid rgba(234, 88, 12, 0.2)' : '1px solid transparent',
                                            }}
                                        >
                                            <div className="transition-transform group-hover:scale-110">
                                                {item.icon}
                                            </div>
                                            <span
                                                className="text-[11px] leading-tight font-medium truncate"
                                                style={{ color: active ? 'var(--orange)' : 'var(--text-1)' }}
                                            >
                                                {item.label}
                                            </span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            </nav>

            {/* ─ Main Content Pane ─ */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Topbar (Exact 52px geometric match to sidebar header) */}
                <header
                    className="px-6 flex items-center justify-between shrink-0"
                    style={{
                        height: 52,
                        background: 'var(--surface)',
                        borderBottom: '1px solid var(--border)',
                    }}
                >
                    <div className="flex items-center gap-2">
                        {title ? (
                            <div className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-1)' }}>
                                {title}
                            </div>
                        ) : (
                            <div className="text-xs text-slate-500 font-medium">
                                DataMiner · High Performance Lead Engine
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        {actions}

                        {/* API Health & Quota Badge */}
                        {healthData && (
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowHealthPopover(p => !p)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer border transition-colors ${
                                        healthData.has_flaw
                                            ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    }`}
                                    title="Status der angebundenen APIs und Restguthaben"
                                >
                                    {healthData.has_flaw ? (
                                        <>
                                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
                                            <span>{healthData.flaws.length} API-Problem{healthData.flaws.length > 1 ? 'e' : ''}</span>
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                            <span>APIs bereit</span>
                                        </>
                                    )}
                                </button>

                                {showHealthPopover && (
                                    <>
                                        <div 
                                            className="fixed inset-0 z-40" 
                                            onClick={() => setShowHealthPopover(false)} 
                                        />
                                        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 p-3.5 text-xs space-y-2.5">
                                            <div className="flex items-center justify-between border-b pb-2">
                                                <span className="font-semibold text-slate-800">API Status & Quotas</span>
                                                <Link 
                                                    href="/settings" 
                                                    onClick={() => setShowHealthPopover(false)}
                                                    className="text-[11px] text-orange-600 hover:underline font-medium"
                                                >
                                                    Keys verwalten →
                                                </Link>
                                            </div>

                                            <div className="space-y-1.5">
                                                {Object.entries(healthData.statuses).map(([prov, item]) => {
                                                    const isErr = item.status === 'exhausted' || item.status === 'error';
                                                    const isOk = item.status === 'ok';
                                                    const nameMap: Record<string, string> = {
                                                        eden: 'Eden AI (LLM)',
                                                        serpapi: 'SerpAPI (Maps)',
                                                        serper: 'Serper.dev (Google)',
                                                        apify: 'Apify (GMB Deep)',
                                                        firecrawl: 'Firecrawl (Scrape)',
                                                    };
                                                    return (
                                                        <div key={prov} className="flex items-start justify-between gap-2 p-1.5 rounded-lg bg-slate-50 border border-slate-100">
                                                            <div>
                                                                <div className="font-medium text-slate-800">{nameMap[prov] || prov}</div>
                                                                <div className={`text-[11px] ${isErr ? 'text-rose-600 font-semibold' : isOk ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                                    {item.message}
                                                                </div>
                                                            </div>
                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                                                                isErr ? 'bg-rose-100 text-rose-700' : isOk ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                                                            }`}>
                                                                {item.status === 'exhausted' ? 'Leer' : item.status === 'error' ? 'Fehler' : item.status === 'ok' ? 'Aktiv' : 'Fehlt'}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {healthData.has_flaw && (
                                                <div className="p-2 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-800 leading-relaxed">
                                                    💡 <strong>Auswirkung:</strong> Wenn SerpAPI oder Apify aufgebraucht sind, greift Google Maps auf Basisergebnisse zurück (weniger Details). Lade Guthaben auf oder nutze Web-Suche.
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="h-4 w-px bg-slate-200" />
                        <Link
                            href="/settings/account"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors border border-slate-200"
                            title="Mein Benutzerkonto & Passwort"
                        >
                            <User className="w-3.5 h-3.5 text-orange-500" />
                            <span>Konto</span>
                        </Link>
                        <Link
                            href="/logout"
                            method="post"
                            as="button"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-red-600 hover:bg-red-50 transition-colors border border-red-200"
                            title="Abmelden"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Abmelden</span>
                        </Link>
                    </div>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-y-auto p-6">
                    {children}
                </main>
            </div>
        </div>
    );
}
