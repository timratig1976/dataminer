import React from 'react';
import AppLayout from '../Layouts/AppLayout';
import { Link } from '@inertiajs/react';
import { Layers, Database, Sparkles, ArrowRight } from 'lucide-react';

interface CaseItem {
    id: string;
    name: string;
    description?: string;
    rows_count: number;
    updated_at: string;
}

interface Props {
    cases: CaseItem[];
}

export default function Dashboard({ cases }: Props) {
    const totalRows = cases.reduce((sum, c) => sum + (c.rows_count || 0), 0);

    return (
        <AppLayout>
            <div className="max-w-6xl mx-auto space-y-8">
                <div>
                    <h1 className="text-2xl font-bold">Dashboard</h1>
                    <p className="text-slate-400 text-sm">Übersicht über Lead-Generierung & 100k-Skalierung</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
                        <div className="p-3 bg-emerald-950 text-emerald-400 border border-emerald-900 rounded-lg">
                            <Database className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold">{totalRows.toLocaleString('de-DE')}</div>
                            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Datensätze Gesamt</div>
                        </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
                        <div className="p-3 bg-blue-950 text-blue-400 border border-blue-900 rounded-lg">
                            <Layers className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold">{cases.length}</div>
                            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Aktive Cases</div>
                        </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
                        <div className="p-3 bg-purple-950 text-purple-400 border border-purple-900 rounded-lg">
                            <Sparkles className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="text-2xl font-bold">100k+</div>
                            <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Queue Power</div>
                        </div>
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                        <h2 className="font-semibold text-base">Aktuelle Cases</h2>
                        <Link href="/cases" className="text-xs text-emerald-400 hover:underline flex items-center gap-1">
                            Alle ansehen <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                    </div>
                    <div className="divide-y divide-slate-800/60">
                        {cases.map((c) => (
                            <Link
                                key={c.id}
                                href={`/cases/${c.id}`}
                                className="px-6 py-4 flex items-center justify-between hover:bg-slate-800/40 transition-colors"
                            >
                                <div>
                                    <div className="font-medium text-slate-100">{c.name}</div>
                                    <div className="text-xs text-slate-400">{c.description || 'Keine Beschreibung'}</div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full border border-slate-700">
                                        {(c.rows_count || 0).toLocaleString('de-DE')} Zeilen
                                    </span>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
