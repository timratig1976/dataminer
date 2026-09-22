import React, { useState, useEffect } from 'react';
import { Head } from '@inertiajs/react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    PhoneCall, RefreshCw, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, 
    UploadCloud, Filter, Check, X, AlertCircle, Play, Eye, Settings2, Database
} from 'lucide-react';

interface ContactItem {
    id: string | number;
    first_name: string;
    last_name: string;
    company_name: string;
    raw_phone: string | null;
    e164_phone: string | null;
    raw_mobile: string | null;
    e164_mobile: string | null;
    needs_update: boolean;
    has_invalid: boolean;
}

export default function ThreeCXSyncPage() {
    // Config states (stored in localStorage for convenience)
    const [pbxUrl, setPbxUrl] = useState(() => localStorage.getItem('3cx_pbx_url') || '');
    const [clientId, setClientId] = useState(() => localStorage.getItem('3cx_client_id') || '');
    const [clientSecret, setClientSecret] = useState(() => localStorage.getItem('3cx_client_secret') || '');
    const [defaultRegion, setDefaultRegion] = useState('DE');
    const [saveCredentials, setSaveCredentials] = useState(true);

    // Operational states
    const [testingConnection, setTestingConnection] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [syncingAll, setSyncingAll] = useState(false);
    const [updatingRowId, setUpdatingRowId] = useState<string | number | null>(null);

    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
    const [contacts, setContacts] = useState<ContactItem[]>([]);
    const [stats, setStats] = useState<{ total: number; needs_update: number; has_invalid: number; already_clean: number } | null>(null);

    // Filter tab
    const [activeTab, setActiveTab] = useState<'all' | 'needs_update' | 'has_invalid' | 'clean'>('needs_update');
    const [searchFilter, setSearchFilter] = useState('');

    const handleSaveConfig = () => {
        if (saveCredentials) {
            localStorage.setItem('3cx_pbx_url', pbxUrl.trim());
            localStorage.setItem('3cx_client_id', clientId.trim());
            localStorage.setItem('3cx_client_secret', clientSecret.trim());
        }
    };

    const handleTestConnection = async () => {
        handleSaveConfig();
        if (!pbxUrl || !clientId || !clientSecret) {
            setStatusMessage({ type: 'error', text: 'Bitte alle 3CX Verbindungsdaten eingeben.' });
            return;
        }

        setTestingConnection(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/3cx/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ pbx_url: pbxUrl, client_id: clientId, client_secret: clientSecret })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Verbindung fehlgeschlagen');
            }
            setStatusMessage({ type: 'success', text: `Verbindung erfolgreich! Token erhalten: ${data.token_preview}` });
        } catch (err: any) {
            setStatusMessage({ type: 'error', text: err.message || 'Verbindungsfehler' });
        } finally {
            setTestingConnection(false);
        }
    };

    const handleFetchContacts = async () => {
        handleSaveConfig();
        if (!pbxUrl || !clientId || !clientSecret) {
            setStatusMessage({ type: 'error', text: 'Bitte 3CX Verbindungsdaten angeben.' });
            return;
        }

        setFetching(true);
        setStatusMessage(null);
        try {
            const res = await fetch('/api/3cx/fetch-contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ 
                    pbx_url: pbxUrl, 
                    client_id: clientId, 
                    client_secret: clientSecret,
                    default_region: defaultRegion
                })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Fehler beim Laden der Kontakte');
            }
            setContacts(data.contacts || []);
            setStats(data.stats || null);
            setStatusMessage({ 
                type: 'success', 
                text: `${data.stats.total} Kontakte geladen. ${data.stats.needs_update} Nummern können zu E.164 formatiert werden.` 
            });
        } catch (err: any) {
            setStatusMessage({ type: 'error', text: err.message || 'Abruf fehlgeschlagen' });
        } finally {
            setFetching(false);
        }
    };

    const handleUpdateSingle = async (c: ContactItem) => {
        setUpdatingRowId(c.id);
        try {
            const res = await fetch('/api/3cx/update-single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    pbx_url: pbxUrl,
                    client_id: clientId,
                    client_secret: clientSecret,
                    contact_id: c.id,
                    phone: c.e164_phone || c.raw_phone,
                    mobile: c.e164_mobile || c.raw_mobile,
                })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Update fehlgeschlagen');
            }

            // Mark as clean in local state
            setContacts(prev => prev.map(item => {
                if (item.id === c.id) {
                    return {
                        ...item,
                        raw_phone: c.e164_phone || item.raw_phone,
                        raw_mobile: c.e164_mobile || item.raw_mobile,
                        needs_update: false,
                    };
                }
                return item;
            }));

            // Update stats
            if (stats) {
                setStats({
                    ...stats,
                    needs_update: Math.max(0, stats.needs_update - 1),
                    already_clean: stats.already_clean + 1,
                });
            }
        } catch (err: any) {
            alert(`Fehler beim Aktualisieren: ${err.message}`);
        } finally {
            setUpdatingRowId(null);
        }
    };

    const handleBatchUpdateAll = async () => {
        const toUpdate = contacts.filter(c => c.needs_update);
        if (toUpdate.length === 0) {
            alert('Keine Kontakte zur Aktualisierung vorhanden.');
            return;
        }

        if (!confirm(`${toUpdate.length} Kontakte in 3CX auf das E.164 Format aktualisieren?`)) {
            return;
        }

        setSyncingAll(true);
        setStatusMessage(null);

        const payloadContacts = toUpdate.map(c => ({
            id: c.id,
            phone: c.e164_phone || c.raw_phone,
            mobile: c.e164_mobile || c.raw_mobile,
        }));

        try {
            const res = await fetch('/api/3cx/batch-update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    pbx_url: pbxUrl,
                    client_id: clientId,
                    client_secret: clientSecret,
                    contacts: payloadContacts,
                })
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Batch-Update fehlgeschlagen');
            }

            setStatusMessage({
                type: 'success',
                text: `Batch-Update abgeschlossen: ${data.success_count} Kontakte erfolgreich in 3CX aktualisiert.${data.failed_count > 0 ? ` (${data.failed_count} fehlgeschlagen)` : ''}`
            });

            // Re-fetch clean status
            handleFetchContacts();
        } catch (err: any) {
            setStatusMessage({ type: 'error', text: err.message || 'Batch-Update fehlgeschlagen' });
        } finally {
            setSyncingAll(false);
        }
    };

    const filteredContacts = contacts.filter(c => {
        if (activeTab === 'needs_update' && !c.needs_update) return false;
        if (activeTab === 'has_invalid' && !c.has_invalid) return false;
        if (activeTab === 'clean' && (c.needs_update || c.has_invalid)) return false;

        if (searchFilter.trim()) {
            const q = searchFilter.toLowerCase();
            const fullName = `${c.first_name} ${c.last_name} ${c.company_name}`.toLowerCase();
            const numbers = `${c.raw_phone} ${c.raw_mobile} ${c.e164_phone} ${c.e164_mobile}`.toLowerCase();
            return fullName.includes(q) || numbers.includes(q);
        }
        return true;
    });

    return (
        <AppLayout
            title={
                <div className="flex items-center gap-2">
                    <PhoneCall className="w-5 h-5 text-indigo-600" />
                    <span>3CX XAPI Telefonnummern-Normalisierung (E.164)</span>
                </div>
            }
            actions={
                <div className="flex items-center gap-2">
                    {stats && stats.needs_update > 0 && (
                        <button
                            onClick={handleBatchUpdateAll}
                            disabled={syncingAll}
                            className="btn-v2 bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs flex items-center gap-1.5"
                        >
                            {syncingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                            <span>Alle {stats.needs_update} zu E.164 synchronisieren</span>
                        </button>
                    )}
                </div>
            }
        >
            <Head title="3CX E.164 Telefonnummern Microservice" />

            <div className="max-w-7xl mx-auto space-y-6">
                {/* ── CARD 1: 3CX OData API Credentials ── */}
                <div className="bg-white rounded-xl border p-5 shadow-xs" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between border-b pb-3 mb-4" style={{ borderColor: 'var(--border-xs)' }}>
                        <div className="flex items-center gap-2">
                            <Settings2 className="w-4 h-4 text-indigo-600" />
                            <h2 className="font-semibold text-sm">3CX XAPI Verbindungsparameter (OAuth2)</h2>
                        </div>
                        <span className="text-[11px] text-slate-500 bg-slate-50 border px-2 py-0.5 rounded">
                            3CX V20+ / XAPI OData v4 REST
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">3CX PBX URL / FQDN</label>
                            <input
                                type="text"
                                placeholder="https://pbx.meinedomain.de"
                                value={pbxUrl}
                                onChange={e => setPbxUrl(e.target.value)}
                                className="w-full text-xs rounded-lg border px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                                style={{ borderColor: 'var(--border)' }}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Client ID (Service Principal)</label>
                            <input
                                type="text"
                                placeholder="z. B. 3cx-data-sync"
                                value={clientId}
                                onChange={e => setClientId(e.target.value)}
                                className="w-full text-xs rounded-lg border px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                                style={{ borderColor: 'var(--border)' }}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Client Secret</label>
                            <input
                                type="password"
                                placeholder="••••••••••••••••"
                                value={clientSecret}
                                onChange={e => setClientSecret(e.target.value)}
                                className="w-full text-xs rounded-lg border px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                                style={{ borderColor: 'var(--border)' }}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Standard-Landesvorwahl</label>
                            <select
                                value={defaultRegion}
                                onChange={e => setDefaultRegion(e.target.value)}
                                className="w-full text-xs rounded-lg border px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden bg-white"
                                style={{ borderColor: 'var(--border)' }}
                            >
                                <option value="DE">Deutschland (+49)</option>
                                <option value="AT">Österreich (+43)</option>
                                <option value="CH">Schweiz (+41)</option>
                                <option value="US">USA / Kanada (+1)</option>
                                <option value="GB">Großbritannien (+44)</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t text-xs" style={{ borderColor: 'var(--border-xs)' }}>
                        <label className="flex items-center gap-2 cursor-pointer text-slate-600 select-none">
                            <input
                                type="checkbox"
                                checked={saveCredentials}
                                onChange={e => setSaveCredentials(e.target.checked)}
                                className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>Verbindungsdaten im Browser-Speicher merken</span>
                        </label>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleTestConnection}
                                disabled={testingConnection}
                                className="btn-v2 hover:bg-slate-100 flex items-center gap-1.5 text-xs"
                            >
                                {testingConnection ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}
                                <span>Verbindung testen</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleFetchContacts}
                                disabled={fetching}
                                className="btn-v2 bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1.5 text-xs font-medium shadow-xs"
                            >
                                {fetching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                                <span>Alle 3CX Kontakte abrufen & prüfen</span>
                            </button>
                        </div>
                    </div>

                    {statusMessage && (
                        <div className={`mt-3 p-3 rounded-lg text-xs flex items-center gap-2 ${
                            statusMessage.type === 'success' 
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                                : statusMessage.type === 'error'
                                ? 'bg-red-50 text-red-800 border border-red-200'
                                : 'bg-blue-50 text-blue-800 border border-blue-200'
                        }`}>
                            {statusMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />}
                            <span>{statusMessage.text}</span>
                        </div>
                    )}
                </div>

                {/* ── CARD 2: Stats & Filter Tabs ── */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div 
                            onClick={() => setActiveTab('all')}
                            className={`p-4 rounded-xl border bg-white cursor-pointer transition-all ${activeTab === 'all' ? 'ring-2 ring-indigo-500 border-transparent shadow-xs' : 'hover:border-slate-300'}`}
                            style={{ borderColor: activeTab === 'all' ? undefined : 'var(--border)' }}
                        >
                            <div className="text-xs text-slate-500 font-medium">Gesamte Kontakte in 3CX</div>
                            <div className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">Aus Adressbuch geladen</div>
                        </div>

                        <div 
                            onClick={() => setActiveTab('needs_update')}
                            className={`p-4 rounded-xl border bg-white cursor-pointer transition-all ${activeTab === 'needs_update' ? 'ring-2 ring-amber-500 border-transparent shadow-xs' : 'hover:border-slate-300'}`}
                            style={{ borderColor: activeTab === 'needs_update' ? undefined : 'var(--border)' }}
                        >
                            <div className="text-xs text-amber-600 font-medium flex items-center justify-between">
                                <span>Zu aktualisieren (E.164)</span>
                                <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-[10px] font-bold">Aktion</span>
                            </div>
                            <div className="text-2xl font-bold text-amber-600 mt-1">{stats.needs_update}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">Gültig, aber nicht E.164 (+49...)</div>
                        </div>

                        <div 
                            onClick={() => setActiveTab('clean')}
                            className={`p-4 rounded-xl border bg-white cursor-pointer transition-all ${activeTab === 'clean' ? 'ring-2 ring-emerald-500 border-transparent shadow-xs' : 'hover:border-slate-300'}`}
                            style={{ borderColor: activeTab === 'clean' ? undefined : 'var(--border)' }}
                        >
                            <div className="text-xs text-emerald-600 font-medium">Bereits korrekt im E.164</div>
                            <div className="text-2xl font-bold text-emerald-600 mt-1">{stats.already_clean}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">Kein Update erforderlich</div>
                        </div>

                        <div 
                            onClick={() => setActiveTab('has_invalid')}
                            className={`p-4 rounded-xl border bg-white cursor-pointer transition-all ${activeTab === 'has_invalid' ? 'ring-2 ring-red-500 border-transparent shadow-xs' : 'hover:border-slate-300'}`}
                            style={{ borderColor: activeTab === 'has_invalid' ? undefined : 'var(--border)' }}
                        >
                            <div className="text-xs text-red-600 font-medium">Ungültig / Unvollständig</div>
                            <div className="text-2xl font-bold text-red-600 mt-1">{stats.has_invalid}</div>
                            <div className="text-[11px] text-slate-400 mt-0.5">Kann nicht geparst werden</div>
                        </div>
                    </div>
                )}

                {/* ── CARD 3: Interactive Table ── */}
                {contacts.length > 0 && (
                    <div className="bg-white rounded-xl border shadow-xs overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                        <div className="p-4 border-b flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-50/50" style={{ borderColor: 'var(--border-xs)' }}>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-700">Zeige {filteredContacts.length} Einträge</span>
                                <span className="text-slate-300">|</span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => setActiveTab('needs_update')}
                                        className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${activeTab === 'needs_update' ? 'bg-amber-100 text-amber-900 font-semibold' : 'text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        Zu aktualisieren ({stats?.needs_update || 0})
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('all')}
                                        className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${activeTab === 'all' ? 'bg-indigo-100 text-indigo-900 font-semibold' : 'text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        Alle ({stats?.total || 0})
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('clean')}
                                        className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${activeTab === 'clean' ? 'bg-emerald-100 text-emerald-900 font-semibold' : 'text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        Korrekt ({stats?.already_clean || 0})
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('has_invalid')}
                                        className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${activeTab === 'has_invalid' ? 'bg-red-100 text-red-900 font-semibold' : 'text-slate-600 hover:bg-slate-200'}`}
                                    >
                                        Ungültig ({stats?.has_invalid || 0})
                                    </button>
                                </div>
                            </div>

                            <input
                                type="text"
                                placeholder="Suchen nach Name, Firma oder Nummer..."
                                value={searchFilter}
                                onChange={e => setSearchFilter(e.target.value)}
                                className="text-xs rounded-lg border px-3 py-1.5 w-72 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden bg-white"
                                style={{ borderColor: 'var(--border)' }}
                            />
                        </div>

                        <div className="overflow-x-auto max-h-[600px]">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-100 text-slate-700 uppercase tracking-wider text-[10px] sticky top-0 z-10 border-b" style={{ borderColor: 'var(--border)' }}>
                                    <tr>
                                        <th className="py-2.5 px-4 font-semibold">Kontakt / Firma</th>
                                        <th className="py-2.5 px-4 font-semibold">Telefon (3CX)</th>
                                        <th className="py-2.5 px-4 font-semibold">Telefon (E.164 Neu)</th>
                                        <th className="py-2.5 px-4 font-semibold">Mobilfunk (3CX)</th>
                                        <th className="py-2.5 px-4 font-semibold">Mobilfunk (E.164 Neu)</th>
                                        <th className="py-2.5 px-4 font-semibold text-right">Aktion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredContacts.map(c => {
                                        const isRowUpdating = updatingRowId === c.id;
                                        return (
                                            <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                                                <td className="py-2.5 px-4">
                                                    <div className="font-medium text-slate-900">
                                                        {c.first_name || c.last_name ? `${c.first_name} ${c.last_name}`.trim() : '–'}
                                                    </div>
                                                    {c.company_name && (
                                                        <div className="text-[11px] text-slate-500">{c.company_name}</div>
                                                    )}
                                                </td>

                                                {/* Phone Old */}
                                                <td className="py-2.5 px-4 font-mono text-[11px] text-slate-700">
                                                    {c.raw_phone || <span className="text-slate-300">–</span>}
                                                </td>

                                                {/* Phone E.164 */}
                                                <td className="py-2.5 px-4">
                                                    {c.e164_phone ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-mono text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                                {c.e164_phone}
                                                            </span>
                                                            {c.raw_phone !== c.e164_phone && (
                                                                <span className="text-[10px] text-amber-600 font-semibold">Neu</span>
                                                            )}
                                                        </div>
                                                    ) : c.raw_phone ? (
                                                        <span className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200 font-medium">
                                                            Ungültiges Format
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300">–</span>
                                                    )}
                                                </td>

                                                {/* Mobile Old */}
                                                <td className="py-2.5 px-4 font-mono text-[11px] text-slate-700">
                                                    {c.raw_mobile || <span className="text-slate-300">–</span>}
                                                </td>

                                                {/* Mobile E.164 */}
                                                <td className="py-2.5 px-4">
                                                    {c.e164_mobile ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="font-mono text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                                                {c.e164_mobile}
                                                            </span>
                                                            {c.raw_mobile !== c.e164_mobile && (
                                                                <span className="text-[10px] text-amber-600 font-semibold">Neu</span>
                                                            )}
                                                        </div>
                                                    ) : c.raw_mobile ? (
                                                        <span className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-200 font-medium">
                                                            Ungültiges Format
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300">–</span>
                                                    )}
                                                </td>

                                                {/* Actions */}
                                                <td className="py-2.5 px-4 text-right">
                                                    {c.needs_update ? (
                                                        <button
                                                            onClick={() => handleUpdateSingle(c)}
                                                            disabled={isRowUpdating}
                                                            className="btn-v2 bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 flex items-center gap-1 ml-auto text-xs py-1 px-2.5"
                                                        >
                                                            {isRowUpdating ? (
                                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                                <Check className="w-3 h-3" />
                                                            )}
                                                            <span>E.164 Speichern</span>
                                                        </button>
                                                    ) : c.has_invalid ? (
                                                        <span className="text-[10px] text-slate-400 italic">Manuell prüfen</span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                                                            <CheckCircle2 className="w-3.5 h-3.5" /> Synchronisiert
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </AppLayout>
    );
}
