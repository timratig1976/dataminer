import React, { useState, useEffect } from 'react';
import { Link, usePage } from '@inertiajs/react';
import { 
    LayoutDashboard, Database, Settings, Sliders, Zap, Sparkles, Users 
} from 'lucide-react';

interface SidebarCase {
    id: string;
    name: string;
    rows_count?: number;
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

    useEffect(() => {
        fetch('/api/cases')
            .then(res => res.ok ? res.json() : [])
            .then(data => {
                if (Array.isArray(data)) {
                    setRecentCases(data.slice(0, 10));
                }
            })
            .catch(() => {});
    }, [url]);

    const bottomNav = [
        { href: '/settings', title: 'API & Keys', label: 'Keys', icon: <Settings className="w-3.5 h-3.5" /> },
        { href: '/settings/models', title: 'Modell-Auswahl', label: 'Models', icon: <Sliders className="w-3.5 h-3.5" /> },
        { href: '/settings/planner', title: 'Planner Prompt', label: 'Planner', icon: <Sparkles className="w-3.5 h-3.5" /> },
        { href: '/settings/llm-test', title: 'LLM-Testing', label: 'LLM', icon: <Zap className="w-3.5 h-3.5" /> },
        { href: '/settings/users', title: 'Benutzer & Rollen', label: 'Users', icon: <Users className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-1)', fontFamily: 'var(--f)' }}>
            {/* ─ Sidebar (Original Next.js Design) ─ */}
            <nav
                className="flex flex-col shrink-0"
                style={{
                    width: 210,
                    minWidth: 210,
                    background: 'var(--surface)',
                    borderRight: '1px solid var(--border)',
                    padding: '16px 0',
                }}
            >
                {/* Logo */}
                <div className="flex items-center gap-2.5 px-4 pb-3.5" style={{ borderBottom: '1px solid var(--border-xs)' }}>
                    <Link
                        href="/"
                        className="flex items-center gap-2.5 hover:opacity-85 transition-opacity text-left w-full cursor-pointer"
                    >
                        <div
                            className="w-6 h-6 rounded flex items-center justify-center text-white text-[11px] font-bold shadow-sm"
                            style={{ background: 'var(--orange)' }}
                        >
                            D
                        </div>
                        <span className="font-semibold text-[13.5px] tracking-tight" style={{ color: 'var(--text-1)' }}>
                            DataMiner
                        </span>
                    </Link>
                </div>

                {/* Section: Main Nav & Cases */}
                <div className="flex-1 overflow-y-auto px-3.5 py-3">
                    <div className="flex flex-col gap-0.5 mb-4">
                        <Link
                            href="/"
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] text-left transition-colors cursor-pointer"
                            style={{
                                background: url === '/' ? 'var(--orange-soft)' : 'transparent',
                                color: url === '/' ? 'var(--orange)' : 'var(--text-2)',
                                fontWeight: url === '/' ? 600 : 400,
                            }}
                        >
                            <LayoutDashboard className="w-3.5 h-3.5" />
                            <span>Dashboard</span>
                        </Link>

                        <Link
                            href="/cases"
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[12.5px] text-left transition-colors cursor-pointer"
                            style={{
                                background: url === '/cases' ? 'var(--orange-soft)' : 'transparent',
                                color: url === '/cases' ? 'var(--orange)' : 'var(--text-2)',
                                fontWeight: url === '/cases' ? 600 : 400,
                            }}
                        >
                            <Database className="w-3.5 h-3.5" />
                            <span>Alle Cases</span>
                        </Link>
                    </div>

                    {/* Cases List */}
                    {recentCases.length > 0 && (
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

                {/* Bottom icon row */}
                <div
                    className="px-2 pt-2.5 pb-0 flex items-center justify-around"
                    style={{ borderTop: '1px solid var(--border-xs)' }}
                >
                    {bottomNav.map((item, idx) => {
                        const active = url === item.href;
                        return (
                            <Link
                                key={idx}
                                href={item.href}
                                title={item.title}
                                className="flex flex-col items-center gap-0.5 px-1.5 py-1 rounded transition-colors cursor-pointer"
                                style={{
                                    color: active ? 'var(--orange)' : 'var(--text-3)',
                                    background: active ? 'var(--orange-soft)' : 'transparent',
                                }}
                            >
                                {item.icon}
                                <span className="text-[9px] leading-none font-medium mt-0.5">{item.label}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>

            {/* ─ Main Content Pane ─ */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Topbar */}
                <header
                    className="px-6 py-2.5 flex items-center justify-between shrink-0"
                    style={{
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
