import React, { useState } from 'react';
import AppLayout from '../Layouts/AppLayout';
import { 
    Key, Globe, CheckCircle2, Trash2, 
    Save, RefreshCw, Sparkles, Sliders, Flame, Search
} from 'lucide-react';

interface SettingsData {
    eden_region: 'eu' | 'us';
    has_eden_api_key: boolean;
    has_serp_api_key: boolean;
    has_serper_api_key: boolean;
    has_brave_api_key: boolean;
    has_apify_api_token: boolean;
    has_firecrawl_api_key: boolean;
    edenApiKeyMasked?: string;
    serperApiKeyMasked?: string;
    serpApiKeyMasked?: string;
    braveApiKeyMasked?: string;
    apifyApiTokenMasked?: string;
    firecrawlApiKeyMasked?: string;
    planner_system_prompt?: string | null;
}

interface TestResult {
    ok: boolean;
    latencyMs?: number;
    preview?: string;
    costUsd?: number;
    hits?: number;
    sample?: string;
    note?: string;
    error?: string;
}

export default function SettingsPage({ settings: initialSettings }: { settings: SettingsData }) {
    const [state, setState] = useState<SettingsData>(initialSettings);

    // ── Inputs ──
    const [edenApiKey, setEdenApiKey] = useState('');
    const [edenRegion, setEdenRegion] = useState<'eu' | 'us'>(initialSettings.eden_region || 'eu');
    const [firecrawlApiKey, setFirecrawlApiKey] = useState('');
    const [serperApiKey, setSerperApiKey] = useState('');
    const [serpApiKey, setSerpApiKey] = useState('');
    const [braveApiKey, setBraveApiKey] = useState('');
    const [apifyApiToken, setApifyApiToken] = useState('');
    const [plannerPrompt, setPlannerPrompt] = useState(initialSettings.planner_system_prompt || '');

    // ── Async states per key ──
    const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});
    const [savedKeyMsg, setSavedKeyMsg] = useState<Record<string, boolean>>({});
    const [testingProvider, setTestingProvider] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

    const refreshSettings = async () => {
        try {
            const res = await fetch('/api/settings');
            const data = await res.json();
            if (data.settings) {
                setState(data.settings);
                setEdenRegion(data.settings.eden_region || 'eu');
                setPlannerPrompt(data.settings.planner_system_prompt || '');
            }
        } catch (e) {
            console.error('Failed to load settings', e);
        }
    };

    // Save individual key asynchronously
    const saveIndividualKey = async (keyName: string, payload: Record<string, any>) => {
        setSavingKey(prev => ({ ...prev, [keyName]: true }));
        try {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                setSavedKeyMsg(prev => ({ ...prev, [keyName]: true }));
                setTimeout(() => setSavedKeyMsg(prev => ({ ...prev, [keyName]: false })), 2000);
                if (keyName === 'eden') setEdenApiKey('');
                if (keyName === 'firecrawl') setFirecrawlApiKey('');
                if (keyName === 'serper') setSerperApiKey('');
                if (keyName === 'serp') setSerpApiKey('');
                if (keyName === 'brave') setBraveApiKey('');
                if (keyName === 'apify') setApifyApiToken('');
                await refreshSettings();
            }
        } catch (e) {
            console.error(`Save ${keyName} failed`, e);
        } finally {
            setSavingKey(prev => ({ ...prev, [keyName]: false }));
        }
    };

    const deleteIndividualKey = async (keyName: string) => {
        if (!confirm(`Möchtest du den ${keyName} API-Key wirklich löschen?`)) return;
        setSavingKey(prev => ({ ...prev, [keyName]: true }));
        try {
            const res = await fetch(`/api/settings?key=${keyName}`, { method: 'DELETE' });
            if (res.ok) {
                await refreshSettings();
            }
        } catch (e) {
            console.error(`Delete ${keyName} failed`, e);
        } finally {
            setSavingKey(prev => ({ ...prev, [keyName]: false }));
        }
    };

    const testEden = async () => {
        setTestingProvider('eden');
        try {
            const res = await fetch('/api/settings/test-eden', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: edenApiKey.trim() || undefined }),
            });
            const data = await res.json();
            setTestResults(prev => ({ ...prev, eden: data }));
        } catch (e: any) {
            setTestResults(prev => ({ ...prev, eden: { ok: false, error: e.message } }));
        } finally {
            setTestingProvider(null);
        }
    };

    const testSearchProvider = async (provider: string, key?: string) => {
        setTestingProvider(provider);
        try {
            const res = await fetch('/api/settings/test-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, apiKey: key?.trim() || undefined }),
            });
            const data = await res.json();
            setTestResults(prev => ({ ...prev, [provider]: data }));
        } catch (e: any) {
            setTestResults(prev => ({ ...prev, [provider]: { ok: false, error: e.message } }));
        } finally {
            setTestingProvider(null);
        }
    };

    return (
        <AppLayout>
            <div className="max-w-3xl mx-auto space-y-6 pb-16">
                <div>
                    <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                        <Sliders className="w-6 h-6 text-orange-400" />
                        Globale Einstellungen
                    </h1>
                    <p className="text-slate-400 text-xs mt-1">
                        Verwaltung aller API-Verbindungen (jeder Key wird asynchron separat gespeichert & verschlüsselt).
                    </p>
                </div>

                {/* ── 1. EDEN AI ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4 text-orange-400" />
                            <h2 className="font-semibold text-sm text-slate-100">Eden AI (LLM Gateway)</h2>
                            <span className="text-[11px] text-slate-400">Einziger LLM-Provider — ein Key für alle Modelle</span>
                        </div>
                        <div>
                            {state.has_eden_api_key ? (
                                <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.edenApiKeyMasked})
                                </span>
                            ) : (
                                <span className="text-xs bg-rose-950 text-rose-400 border border-rose-800 px-2.5 py-0.5 rounded-full">
                                    Nicht hinterlegt
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="text-xs p-3 leading-relaxed bg-slate-950/70 border border-slate-800 rounded-lg text-slate-300">
                        DataMiner nutzt ausschließlich <b>Eden AI</b> als LLM-Gateway. Ein einziger API-Key bedient alle Chat- und Reasoning-Modelle (<code>openai/</code>, <code>anthropic/</code>, <code>google/</code>, <code>mistral/</code> …).
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-400">
                            Eden AI API Key
                        </label>
                        <input
                            type="password"
                            value={edenApiKey}
                            onChange={e => setEdenApiKey(e.target.value)}
                            placeholder={state.has_eden_api_key ? `Gespeichert: ${state.edenApiKeyMasked}` : 'sk-eden-live-...'}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-orange-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">Wird serverseitig AES-256 verschlüsselt gespeichert.</p>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-400">
                            Region / Data Residency
                        </label>
                        <div className="flex gap-2">
                            {(['eu', 'us'] as const).map(r => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => setEdenRegion(r)}
                                    className={`px-3 py-1.5 text-xs rounded-lg border font-medium cursor-pointer ${
                                        edenRegion === r
                                            ? 'bg-orange-950/60 border-orange-600 text-orange-300'
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    {r === 'eu' ? 'EU (api.eu.edenai.run)' : 'US (api.edenai.run)'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-800/80">
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('eden', { eden_api_key: edenApiKey.trim() || undefined, eden_region: edenRegion })}
                            disabled={savingKey.eden || (!edenApiKey.trim() && edenRegion === state.eden_region)}
                            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            {savingKey.eden ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.eden ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={testEden}
                            disabled={testingProvider === 'eden'}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                            {testingProvider === 'eden' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-orange-400" />}
                            Verbindung testen
                        </button>
                        {state.has_eden_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('eden')}
                                className="px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs ml-auto flex items-center gap-1 cursor-pointer"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {testResults.eden && (
                        <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${testResults.eden.ok ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300' : 'bg-rose-950/50 border-rose-800 text-rose-300'}`}>
                            <span>{testResults.eden.ok ? '✓' : '✗'}</span>
                            <span>{testResults.eden.ok ? `Erfolgreich (${testResults.eden.latencyMs}ms): "${testResults.eden.preview}"` : testResults.eden.error}</span>
                        </div>
                    )}
                </div>

                {/* ── 2. FIRECRAWL ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Flame className="w-4 h-4 text-orange-500" />
                            <h3 className="font-semibold text-sm text-slate-100">Firecrawl</h3>
                            <span className="text-[11px] text-slate-400">Web-Scraper & Web-Search API</span>
                        </div>
                        <div>
                            {state.has_firecrawl_api_key ? (
                                <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.firecrawlApiKeyMasked})
                                </span>
                            ) : (
                                <span className="text-xs bg-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full">
                                    Nicht hinterlegt (Fallback: Eden AI)
                                </span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-400">
                            Firecrawl API Key
                        </label>
                        <input
                            type="password"
                            value={firecrawlApiKey}
                            onChange={e => setFirecrawlApiKey(e.target.value)}
                            placeholder={state.has_firecrawl_api_key ? `Gespeichert: ${state.firecrawlApiKeyMasked}` : 'fc-...'}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-orange-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                        />
                    </div>

                    <div className="pt-2 flex items-center gap-2 border-t border-slate-800/80">
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('firecrawl', { firecrawl_api_key: firecrawlApiKey.trim() })}
                            disabled={savingKey.firecrawl || !firecrawlApiKey.trim()}
                            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            {savingKey.firecrawl ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.firecrawl ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('firecrawl', firecrawlApiKey)}
                            disabled={testingProvider === 'firecrawl'}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                            {testingProvider === 'firecrawl' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5 text-orange-400" />}
                            Scraper testen
                        </button>
                        {state.has_firecrawl_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('firecrawl')}
                                className="px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs ml-auto flex items-center gap-1 cursor-pointer"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {testResults.firecrawl && (
                        <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${testResults.firecrawl.ok ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300' : 'bg-rose-950/50 border-rose-800 text-rose-300'}`}>
                            <span>{testResults.firecrawl.ok ? '✓' : '✗'}</span>
                            <span>{testResults.firecrawl.ok ? `Erfolgreich gescrapt: ${testResults.firecrawl.sample}` : testResults.firecrawl.error}</span>
                        </div>
                    )}
                </div>

                {/* ── 3. SERPER.DEV ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Search className="w-4 h-4 text-blue-400" />
                            <h3 className="font-semibold text-sm text-slate-100">Serper.dev</h3>
                            <span className="text-[11px] text-slate-400">Google Suche + Google Places (2.500 free/Monat)</span>
                        </div>
                        <div>
                            {state.has_serper_api_key ? (
                                <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.serperApiKeyMasked})
                                </span>
                            ) : (
                                <span className="text-xs bg-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full">Nicht hinterlegt</span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-400">
                            Serper API Key
                        </label>
                        <input
                            type="password"
                            value={serperApiKey}
                            onChange={e => setSerperApiKey(e.target.value)}
                            placeholder={state.has_serper_api_key ? `Gespeichert: ${state.serperApiKeyMasked}` : 'sk-...'}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                        />
                    </div>

                    <div className="pt-2 flex items-center gap-2 border-t border-slate-800/80 flex-wrap">
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('serper', { serper_api_key: serperApiKey.trim() })}
                            disabled={savingKey.serper || !serperApiKey.trim()}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            {savingKey.serper ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.serper ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('serper', serperApiKey)}
                            disabled={testingProvider === 'serper'}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium cursor-pointer"
                        >
                            Web-Suche testen
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('serper-places', serperApiKey)}
                            disabled={testingProvider === 'serper-places'}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium cursor-pointer"
                        >
                            Places testen
                        </button>
                        {state.has_serper_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('serper')}
                                className="px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs ml-auto flex items-center gap-1 cursor-pointer"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {['serper', 'serper-places'].map(tp => testResults[tp] && (
                        <div key={tp} className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${testResults[tp].ok ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300' : 'bg-rose-950/50 border-rose-800 text-rose-300'}`}>
                            <span>{testResults[tp].ok ? '✓' : '✗'}</span>
                            <span>{testResults[tp].ok ? `${testResults[tp].hits} Treffer · "${testResults[tp].sample}"` : testResults[tp].error}</span>
                        </div>
                    ))}
                </div>

                {/* ── 4. SERPAPI ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4 text-emerald-400" />
                            <h3 className="font-semibold text-sm text-slate-100">SerpApi</h3>
                            <span className="text-[11px] text-slate-400">Google Maps structured (100 free/Monat)</span>
                        </div>
                        <div>
                            {state.has_serp_api_key ? (
                                <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.serpApiKeyMasked})
                                </span>
                            ) : (
                                <span className="text-xs bg-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full">Nicht hinterlegt</span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-400">
                            SerpApi Key
                        </label>
                        <input
                            type="password"
                            value={serpApiKey}
                            onChange={e => setSerpApiKey(e.target.value)}
                            placeholder={state.has_serp_api_key ? `Gespeichert: ${state.serpApiKeyMasked}` : '...'}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                        />
                    </div>

                    <div className="pt-2 flex items-center gap-2 border-t border-slate-800/80">
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('serp', { serp_api_key: serpApiKey.trim() })}
                            disabled={savingKey.serp || !serpApiKey.trim()}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            {savingKey.serp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.serp ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('serp', serpApiKey)}
                            disabled={testingProvider === 'serp'}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium cursor-pointer"
                        >
                            Testen
                        </button>
                        {state.has_serp_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('serp')}
                                className="px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs ml-auto flex items-center gap-1 cursor-pointer"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {testResults.serp && (
                        <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${testResults.serp.ok ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300' : 'bg-rose-950/50 border-rose-800 text-rose-300'}`}>
                            <span>{testResults.serp.ok ? '✓' : '✗'}</span>
                            <span>{testResults.serp.ok ? `${testResults.serp.hits} Treffer · "${testResults.serp.sample}"` : testResults.serp.error}</span>
                        </div>
                    )}
                </div>

                {/* ── 5. BRAVE SEARCH ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Search className="w-4 h-4 text-orange-400" />
                            <h3 className="font-semibold text-sm text-slate-100">Brave Search</h3>
                            <span className="text-[11px] text-slate-400">Unabhängiger Web-Search Layer (2.000 free/Monat)</span>
                        </div>
                        <div>
                            {state.has_brave_api_key ? (
                                <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.braveApiKeyMasked})
                                </span>
                            ) : (
                                <span className="text-xs bg-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full">Nicht hinterlegt</span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-400">
                            Brave Search Key
                        </label>
                        <input
                            type="password"
                            value={braveApiKey}
                            onChange={e => setBraveApiKey(e.target.value)}
                            placeholder={state.has_brave_api_key ? `Gespeichert: ${state.braveApiKeyMasked}` : 'BSA...'}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-orange-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                        />
                    </div>

                    <div className="pt-2 flex items-center gap-2 border-t border-slate-800/80">
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('brave', { brave_api_key: braveApiKey.trim() })}
                            disabled={savingKey.brave || !braveApiKey.trim()}
                            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            {savingKey.brave ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.brave ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('brave', braveApiKey)}
                            disabled={testingProvider === 'brave'}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium cursor-pointer"
                        >
                            Testen
                        </button>
                        {state.has_brave_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('brave')}
                                className="px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs ml-auto flex items-center gap-1 cursor-pointer"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {testResults.brave && (
                        <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${testResults.brave.ok ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300' : 'bg-rose-950/50 border-rose-800 text-rose-300'}`}>
                            <span>{testResults.brave.ok ? '✓' : '✗'}</span>
                            <span>{testResults.brave.ok ? `${testResults.brave.hits} Treffer · "${testResults.brave.sample}"` : testResults.brave.error}</span>
                        </div>
                    )}
                </div>

                {/* ── 6. APIFY ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4 text-violet-400" />
                            <h3 className="font-semibold text-sm text-slate-100">Apify</h3>
                            <span className="text-[11px] text-slate-400">Google Maps Scraper Actor (&gt;120 Treffer pro Lauf)</span>
                        </div>
                        <div>
                            {state.has_apify_api_token ? (
                                <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.apifyApiTokenMasked})
                                </span>
                            ) : (
                                <span className="text-xs bg-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full">Nicht hinterlegt</span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-400">
                            Apify API Token
                        </label>
                        <input
                            type="password"
                            value={apifyApiToken}
                            onChange={e => setApifyApiToken(e.target.value)}
                            placeholder={state.has_apify_api_token ? `Gespeichert: ${state.apifyApiTokenMasked}` : 'apify_api_...'}
                            className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                        />
                    </div>

                    <div className="pt-2 flex items-center gap-2 border-t border-slate-800/80">
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('apify', { apify_api_token: apifyApiToken.trim() })}
                            disabled={savingKey.apify || !apifyApiToken.trim()}
                            className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            {savingKey.apify ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.apify ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('apify', apifyApiToken)}
                            disabled={testingProvider === 'apify'}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium cursor-pointer"
                        >
                            Testen
                        </button>
                        {state.has_apify_api_token && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('apify')}
                                className="px-3 py-1.5 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs ml-auto flex items-center gap-1 cursor-pointer"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Token löschen
                            </button>
                        )}
                    </div>

                    {testResults.apify && (
                        <div className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${testResults.apify.ok ? 'bg-emerald-950/50 border-emerald-800 text-emerald-300' : 'bg-rose-950/50 border-rose-800 text-rose-300'}`}>
                            <span>{testResults.apify.ok ? '✓' : '✗'}</span>
                            <span>{testResults.apify.ok ? `${testResults.apify.sample} · ${testResults.apify.note}` : testResults.apify.error}</span>
                        </div>
                    )}
                </div>

                {/* ── 7. PLANNER SYSTEM-PROMPT ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-semibold text-sm text-slate-100">Planner System-Prompt</h3>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Definiert, wie der KI-Discovery-Agent Freitext-Ziele in strukturierte Suchschritte zerlegt.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('planner', { planner_system_prompt: plannerPrompt })}
                            disabled={savingKey.planner}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                            {savingKey.planner ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.planner ? 'Gespeichert ✓' : 'Prompt speichern'}
                        </button>
                    </div>

                    <textarea
                        value={plannerPrompt}
                        onChange={e => setPlannerPrompt(e.target.value)}
                        rows={5}
                        placeholder="Leer lassen für integrierten Standard-Prompt..."
                        className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-lg p-3 text-xs font-mono text-slate-200 outline-none leading-relaxed"
                    />
                </div>
            </div>
        </AppLayout>
    );
}
