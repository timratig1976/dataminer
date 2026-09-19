import React, { useState } from 'react';
import { Sparkles, X, Target, RefreshCw, AlertCircle } from 'lucide-react';

interface Props {
    caseId: string;
    onClose: () => void;
    onRunStarted: () => void;
}

export default function AgentGoalModal({ caseId, onClose, onRunStarted }: Props) {
    const [goal, setGoal] = useState('Suche nach SHK Handwerkern und Sanitärbetrieben in München und Umgebung mit Webseite und Ansprechpartnern.');
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleStart = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!goal.trim()) return;

        setStarting(true);
        setError(null);

        try {
            const res = await fetch('/api/agent/runs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ case_id: caseId, goal: goal.trim() }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Fehler beim Starten des Runs');

            onRunStarted();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Unbekannter Fehler');
            setStarting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95">
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-950/80 border border-emerald-800 text-emerald-400 rounded-xl">
                            <Target className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-sm text-slate-100">KI Discovery Agent starten</h2>
                            <p className="text-xs text-slate-400">Autonomes Finden von Unternehmen via Google Maps & Web</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <form onSubmit={handleStart} className="p-5 space-y-4">
                    <div>
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-1.5">
                            Recherche-Ziel / Prompt
                        </label>
                        <textarea
                            value={goal}
                            onChange={e => setGoal(e.target.value)}
                            rows={4}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl p-3 text-xs text-slate-200 outline-none leading-relaxed"
                            placeholder="z.B. Finde alle Dachdeckerbetriebe in Hamburg..."
                            required
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                            Der Discovery-Planner zerlegt dieses Ziel automatisch in Regionen & Maps-Suchbegriffe.
                        </p>
                    </div>

                    {error && (
                        <div className="text-xs p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
                        >
                            Abbrechen
                        </button>
                        <button
                            type="submit"
                            disabled={starting}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                        >
                            {starting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            Recherche starten
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}