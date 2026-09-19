import React from 'react';
import { Link } from '@inertiajs/react';
import { Database, FolderKanban, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';

interface Props {
    children: React.ReactNode;
}

export default function Layout({ children }: Props) {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
            <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <Link href="/" className="flex items-center gap-2 font-bold text-lg text-emerald-400">
                        <Database className="w-5 h-5 text-emerald-400" />
                        <span>DataMiner <span className="text-xs bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 px-1.5 py-0.5 rounded">100k</span></span>
                    </Link>
                    <nav className="flex items-center gap-4 text-sm font-medium">
                        <Link href="/cases" className="text-slate-300 hover:text-white flex items-center gap-1.5">
                            <FolderKanban className="w-4 h-4" /> Cases
                        </Link>
                        <Link href="/settings" className="text-slate-300 hover:text-white flex items-center gap-1.5">
                            <SettingsIcon className="w-4 h-4" /> Settings
                        </Link>
                    </nav>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1 text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-2 py-1 rounded">
                        <ShieldCheck className="w-3.5 h-3.5" /> Laravel Sanctum
                    </span>
                </div>
            </header>
            <main className="flex-1 p-6">
                {children}
            </main>
        </div>
    );
}
