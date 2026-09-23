import React, { useState, useEffect } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import SettingsTabs from '../../Components/settings/SettingsTabs';
import { ShieldBan, Search, Plus, Trash2, ArrowUpDown, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '../../api';

interface BlacklistItem {
    id: string;
    domain: string;
    reason: string | null;
    added_by: string;
    hit_count: number;
    created_at: string;
}

export default function BlacklistSettings() {
    const [items, setItems] = useState<BlacklistItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<'domain' | 'hit_count' | 'created_at'>('domain');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

    // Add form state
    const [newDomains, setNewDomains] = useState('');
    const [newReason, setNewReason] = useState('Katalog / Junk');
    const [adding, setAdding] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadItems = async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({
                search,
                sort_by: sortBy,
                sort_dir: sortDir,
                limit: '200',
            });
            const res = await apiFetch(`/api/blacklist?${query.toString()}`);
            const data = await res.json();
            if (res.ok) {
                setItems(data.items || []);
                setTotal(data.total || 0);
            }
        } catch (e: any) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const t = setTimeout(() => {
            loadItems();
        }, 200);
        return () => clearTimeout(t);
    }, [search, sortBy, sortDir]);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newDomains.trim()) return;
        setAdding(true);
        setMsg(null);
        try {
            const res = await apiFetch('/api/blacklist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domains: newDomains,
                    reason: newReason,
                    added_by: 'user',
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setMsg({ type: 'success', text: data.message });
                setNewDomains('');
                loadItems();
            } else {
                setMsg({ type: 'error', text: data.error || 'Fehler beim Hinzufügen.' });
            }
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message });
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (id: string, domainName: string) => {
        if (!confirm(`Domain "${domainName}" wirklich aus der Blacklist entfernen?`)) return;
        try {
            const res = await apiFetch(`/api/blacklist/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setItems(prev => prev.filter(i => i.id !== id));
                setTotal(t => Math.max(0, t - 1));
            }
        } catch (e: any) {
            alert('Löschen fehlgeschlagen: ' + e.message);
        }
    };

    const toggleSort = (field: 'domain' | 'hit_count' | 'created_at') => {
        if (sortBy === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDir('asc');
        }
    };

    return (
        <AppLayout title="Domain-Blacklist (Junk-Schutz)">
            <div className="max-w-5xl mx-auto space-y-6 pb-16">
                <SettingsTabs />

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
                            <ShieldBan className="w-5 h-5 text-rose-500" />
                            Domain-Blacklist & Junk-Filter
                        </h1>
                        <p className="text-xs text-slate-500 mt-1">
                            Blockiert Verzeichnisse, Marktplätze und irrelevante Portale. Wird bei der Discovery und Web-Suche automatisch ignoriert.
                        </p>
                    </div>
                    <div className="text-xs bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg font-mono text-slate-700">
                        {total} blockierte Domains
                    </div>
                </div>

                {/* Add new domain card */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
                        <Plus className="w-4 h-4 text-orange-500" /> Neue Domains hinzufügen
                    </h2>
                    <form onSubmit={handleAdd} className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="md:col-span-2">
                                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                    Domains (kommagetrennt oder eine pro Zeile)
                                </label>
                                <textarea
                                    value={newDomains}
                                    onChange={e => setNewDomains(e.target.value)}
                                    placeholder="z.B. gelbeseiten.de, tripadvisor.de, ebay.de"
                                    rows={2}
                                    className="w-full text-xs font-mono border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                                    Kategorie / Grund
                                </label>
                                <input
                                    type="text"
                                    value={newReason}
                                    onChange={e => setNewReason(e.target.value)}
                                    placeholder="z.B. Branchenkatalog"
                                    className="w-full text-xs border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 mb-2"
                                />
                                <button
                                    type="submit"
                                    disabled={adding || !newDomains.trim()}
                                    className="w-full btn-v2 btn-v2-primary py-2 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    {adding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                    Hinzufügen
                                </button>
                            </div>
                        </div>
                    </form>

                    {msg && (
                        <div className={`mt-3 p-2.5 rounded-lg text-xs flex items-center gap-2 ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                            {msg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
                            <span>{msg.text}</span>
                        </div>
                    )}
                </div>

                {/* Table card */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                    {/* Controls Bar */}
                    <div className="p-3 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/50">
                        <div className="relative flex-1 max-w-sm">
                            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Blacklist durchsuchen..."
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
                            />
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span>Sortierung:</span>
                            <button
                                onClick={() => toggleSort('domain')}
                                className={`px-2.5 py-1 rounded border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${sortBy === 'domain' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                            >
                                Alphabetisch {sortBy === 'domain' && (sortDir === 'asc' ? 'A→Z' : 'Z→A')}
                            </button>
                            <button
                                onClick={() => toggleSort('hit_count')}
                                className={`px-2.5 py-1 rounded border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${sortBy === 'hit_count' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                            >
                                Geblockte Treffer {sortBy === 'hit_count' && (sortDir === 'asc' ? '↑' : '↓')}
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                                <tr>
                                    <th className="py-2.5 px-4 cursor-pointer hover:text-slate-800" onClick={() => toggleSort('domain')}>
                                        <div className="flex items-center gap-1">
                                            Domain <ArrowUpDown className="w-3 h-3" />
                                        </div>
                                    </th>
                                    <th className="py-2.5 px-4">Kategorie / Grund</th>
                                    <th className="py-2.5 px-4">Herkunft</th>
                                    <th className="py-2.5 px-4 text-center cursor-pointer hover:text-slate-800" onClick={() => toggleSort('hit_count')}>
                                        <div className="flex items-center justify-center gap-1">
                                            Hits geblockt <ArrowUpDown className="w-3 h-3" />
                                        </div>
                                    </th>
                                    <th className="py-2.5 px-4 text-right">Aktionen</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-slate-700">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-slate-400">
                                            <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1.5 text-orange-500" />
                                            Lade Blacklist...
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-slate-400">
                                            Keine blockierten Domains gefunden.
                                        </td>
                                    </tr>
                                ) : (
                                    items.map(item => (
                                        <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                                            <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                                                {item.domain}
                                            </td>
                                            <td className="py-2.5 px-4 text-slate-600">
                                                <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10.5px]">
                                                    {item.reason || 'Katalog'}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-4 text-slate-500 text-[11px]">
                                                {item.added_by === 'system' ? 'System-Default' : item.added_by === 'llm' ? 'KI-Erkannt' : 'Benutzer'}
                                            </td>
                                            <td className="py-2.5 px-4 text-center font-mono">
                                                {item.hit_count > 0 ? (
                                                    <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-bold border border-rose-100 text-[10.5px]">
                                                        {item.hit_count}x
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400 text-[11px]">—</span>
                                                )}
                                            </td>
                                            <td className="py-2.5 px-4 text-right">
                                                <button
                                                    onClick={() => handleDelete(item.id, item.domain)}
                                                    className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                                    title="Aus Blacklist entfernen"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
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
