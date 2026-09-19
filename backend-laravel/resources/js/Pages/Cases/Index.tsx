import React from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { Link } from '@inertiajs/react';
import { Plus, Database, Calendar } from 'lucide-react';

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

export default function CasesIndex({ cases }: Props) {
    return (
        <AppLayout>
            <div className="max-w-6xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">Cases</h1>
                        <p className="text-slate-400 text-sm">Verwalte deine Recherche-Projekte & Tabellen</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {cases.map((c) => (
                        <Link
                            key={c.id}
                            href={`/cases/${c.id}`}
                            className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 p-5 rounded-xl transition-all block group"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <h3 className="font-semibold text-lg text-slate-100 group-hover:text-emerald-400 transition-colors">
                                    {c.name}
                                </h3>
                                <span className="text-xs bg-emerald-950/80 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                                    {(c.rows_count || 0).toLocaleString('de-DE')} Zeilen
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mb-4 line-clamp-2">
                                {c.description || 'Keine Beschreibung vorhanden.'}
                            </p>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-3 border-t border-slate-800/60">
                                <Calendar className="w-3.5 h-3.5" />
                                {new Date(c.updated_at).toLocaleDateString('de-DE')}
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </AppLayout>
    );
}
