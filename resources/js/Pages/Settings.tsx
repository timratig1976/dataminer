import React, { useState, useEffect } from 'react';
import AppLayout from '../Layouts/AppLayout';
import SettingsTabs from '../Components/settings/SettingsTabs';
import { 
    Key, Globe, CheckCircle2, Trash2, 
    Save, RefreshCw, Sparkles, Sliders, Flame, Search, Coins, AlertTriangle
} from 'lucide-react';
import { apiFetch } from '../api';

interface SettingsData {
    eden_region: 'eu' | 'us';
    has_eden_api_key: boolean;
    has_serp_api_key: boolean;
    has_serper_api_key: boolean;
    has_brave_api_key: boolean;
    has_apify_api_token: boolean;
    has_firecrawl_api_key: boolean;
    outbound_proxy_url?: string | null;
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
    const [healthData, setHealthData] = useState<any>(null);
    const [loadingHealth, setLoadingHealth] = useState(false);

    // ── Inputs ──
    const [edenApiKey, setEdenApiKey] = useState('');
    const [edenRegion, setEdenRegion] = useState<'eu' | 'us'>(initialSettings.eden_region || 'eu');
    const [firecrawlApiKey, setFirecrawlApiKey] = useState('');
    const [serperApiKey, setSerperApiKey] = useState('');
    const [serpApiKey, setSerpApiKey] = useState('');
    const [braveApiKey, setBraveApiKey] = useState('');
    const [apifyApiToken, setApifyApiToken] = useState('');

    // ── Async states per key ──
    const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});
    const [savedKeyMsg, setSavedKeyMsg] = useState<Record<string, boolean>>({});
    const [testingProvider, setTestingProvider] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

    const fetchHealth = async () => {
        setLoadingHealth(true);
        try {
            const res = await apiFetch('/api/settings/health');
            if (res.ok) {
                const data = await res.json();
                setHealthData(data);
            }
        } catch (e) {
            console.error('Health check failed', e);
        } finally {
            setLoadingHealth(false);
        }
    };

    useEffect(() => {
        fetchHealth();
    }, []);

    const refreshSettings = async () => {
        try {
            const res = await apiFetch('/api/settings');
            const data = await res.json();
            if (data.settings) {
                setState(data.settings);
            }
            fetchHealth();
        } catch (e) {
            console.error('Failed to reload settings', e);
        }
    };

    const saveIndividualKey = async (keyName: string, payload: Record<string, any>) => {
        setSavingKey(prev => ({ ...prev, [keyName]: true }));
        try {
            const res = await apiFetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                setSavedKeyMsg(prev => ({ ...prev, [keyName]: true }));
                setTimeout(() => setSavedKeyMsg(prev => ({ ...prev, [keyName]: false })), 3000);
                refreshSettings();
                if (keyName === 'eden') setEdenApiKey('');
                if (keyName === 'firecrawl') setFirecrawlApiKey('');
                if (keyName === 'serper') setSerperApiKey('');
                if (keyName === 'serp') setSerpApiKey('');
                if (keyName === 'brave') setBraveApiKey('');
                if (keyName === 'apify') setApifyApiToken('');
            }
        } catch (e: any) {
            alert('Speichern fehlgeschlagen: ' + e.message);
        } finally {
            setSavingKey(prev => ({ ...prev, [keyName]: false }));
        }
    };

    const deleteIndividualKey = async (keyName: string) => {
        if (!confirm(`Möchtest du den ${keyName} API-Key wirklich löschen?`)) return;
        setSavingKey(prev => ({ ...prev, [keyName]: true }));
        try {
            const res = await apiFetch('/api/settings', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: keyName }),
            });
            if (res.ok) {
                await refreshSettings();
                if (keyName === 'eden') setEdenApiKey('');
                if (keyName === 'firecrawl') setFirecrawlApiKey('');
                if (keyName === 'serper') setSerperApiKey('');
                if (keyName === 'serp') setSerpApiKey('');
                if (keyName === 'brave') setBraveApiKey('');
                if (keyName === 'apify') setApifyApiToken('');
            } else {
                const errData = await res.json().catch(() => ({}));
                alert('Löschen fehlgeschlagen: ' + (errData.error || errData.message || res.statusText));
            }
        } catch (e: any) {
            alert('Löschen fehlgeschlagen: ' + e.message);
        } finally {
            setSavingKey(prev => ({ ...prev, [keyName]: false }));
        }
    };

    const testEden = async () => {
        setTestingProvider('eden');
        try {
            const res = await apiFetch('/api/settings/test-eden', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: edenApiKey.trim() || undefined, region: edenRegion }),
            });
            const data = await res.json();
            setTestResults(prev => ({
                ...prev,
                eden: {
                    ...data,
                    ok: Boolean(data?.ok),
                    error: data?.error || data?.message || (!data?.ok ? 'Verbindung fehlgeschlagen' : undefined),
                }
            }));
        } catch (e: any) {
            setTestResults(prev => ({ ...prev, eden: { ok: false, error: e.message || 'Verbindung fehlgeschlagen' } }));
        } finally {
            setTestingProvider(null);
        }
    };

    const testSearchProvider = async (provider: string, key?: string) => {
        setTestingProvider(provider);
        try {
            const res = await apiFetch('/api/settings/test-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, apiKey: key?.trim() || undefined }),
            });
            const data = await res.json();
            setTestResults(prev => ({
                ...prev,
                [provider]: {
                    ...data,
                    ok: Boolean(data?.ok),
                    error: data?.error || data?.message || (!data?.ok ? 'Test fehlgeschlagen' : undefined),
                }
            }));
        } catch (e: any) {
            setTestResults(prev => ({ ...prev, [provider]: { ok: false, error: e.message || 'Test fehlgeschlagen' } }));
        } finally {
            setTestingProvider(null);
        }
    };

    return (
        <AppLayout
            title="Globale Einstellungen"
            subtitle="Verwaltung aller API-Verbindungen (jeder Key wird asynchron separat gespeichert & verschlüsselt)"
        >
            <div className="max-w-4xl mx-auto space-y-5 pb-16">
                <SettingsTabs />

                {/* ── 1. EDEN AI ── */}
                <div 
                    className="p-5 space-y-4"
                    style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r)",
                        boxShadow: "var(--shadow-sm)",
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4" style={{ color: "var(--orange)" }} />
                            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>Eden AI (LLM Gateway)</h2>
                            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Einziger LLM-Provider — ein Key für alle Modelle</span>
                        </div>
                        <div>
                            {state.has_eden_api_key ? (
                                <span className="status-pill status-pill-done">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.edenApiKeyMasked})
                                </span>
                            ) : (
                                <span className="status-pill status-pill-pending">
                                    Nicht hinterlegt
                                </span>
                            )}
                        </div>
                    </div>

                    <div 
                        className="text-xs p-3 leading-relaxed"
                        style={{
                            background: "var(--bg)",
                            border: "1px solid var(--border-xs)",
                            borderRadius: "var(--rs)",
                            color: "var(--text-2)",
                        }}
                    >
                        DataMiner nutzt ausschließlich <b>Eden AI</b> als LLM-Gateway. Ein einziger API-Key bedient alle Chat- und Reasoning-Modelle (<code>openai/</code>, <code>anthropic/</code>, <code>google/</code>, <code>mistral/</code> …).
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
                            Eden AI API Key
                        </label>
                        <input
                            type="password"
                            value={edenApiKey}
                            onChange={e => setEdenApiKey(e.target.value)}
                            placeholder={state.has_eden_api_key ? `Gespeichert: ${state.edenApiKeyMasked}` : 'sk-eden-live-...'}
                            className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                            style={{
                                borderColor: "var(--border)",
                                background: "var(--bg)",
                                color: "var(--text-1)",
                            }}
                        />
                        <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>Wird serverseitig AES-256 verschlüsselt gespeichert.</p>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
                            Region / Data Residency
                        </label>
                        <div className="flex gap-2">
                            {(['eu', 'us'] as const).map(r => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => setEdenRegion(r)}
                                    className="btn-v2"
                                    style={{
                                        background: edenRegion === r ? "var(--orange-soft)" : "var(--surface)",
                                        borderColor: edenRegion === r ? "var(--orange)" : "var(--border)",
                                        color: edenRegion === r ? "var(--orange)" : "var(--text-2)",
                                        fontWeight: edenRegion === r ? 600 : 400,
                                    }}
                                >
                                    {r === 'eu' ? 'EU (api.eu.edenai.run)' : 'US (api.edenai.run)'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('eden', { eden_api_key: edenApiKey.trim() || undefined, eden_region: edenRegion })}
                            disabled={savingKey.eden || (!edenApiKey.trim() && edenRegion === state.eden_region)}
                            className="btn-v2 btn-v2-primary"
                        >
                            {savingKey.eden ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.eden ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={testEden}
                            disabled={testingProvider === 'eden'}
                            className="btn-v2"
                        >
                            {testingProvider === 'eden' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-orange-500" />}
                            Verbindung testen
                        </button>
                        {state.has_eden_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('eden')}
                                className="btn-v2 ml-auto"
                                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {testResults.eden && (
                        <div 
                            className="p-2.5 rounded-md border text-xs flex items-center gap-2"
                            style={{
                                background: testResults.eden.ok ? "var(--green-soft)" : "var(--danger-soft)",
                                borderColor: testResults.eden.ok ? "var(--green-mid)" : "var(--danger)",
                                color: testResults.eden.ok ? "var(--green)" : "var(--danger)",
                            }}
                        >
                            <span>{testResults.eden.ok ? '✓' : '✗'}</span>
                            <span>{testResults.eden.ok ? `Erfolgreich (${testResults.eden.latencyMs}ms): "${testResults.eden.preview}"` : (testResults.eden.error || 'Verbindung fehlgeschlagen')}</span>
                        </div>
                    )}
                </div>

                {/* ── 2. FIRECRAWL ── */}
                <div 
                    className="p-5 space-y-4"
                    style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r)",
                        boxShadow: "var(--shadow-sm)",
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Flame className="w-4 h-4" style={{ color: "var(--orange)" }} />
                            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>Firecrawl</h2>
                            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Web-Scraper & Web-Search API</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {healthData?.statuses?.firecrawl?.credits_remaining !== undefined && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Coins className="w-3 h-3 text-emerald-600" />
                                    {healthData.statuses.firecrawl.credits_remaining} / {healthData.statuses.firecrawl.credits_total} Credits
                                    {healthData.statuses.firecrawl.billing_renewal && ` (bis ${healthData.statuses.firecrawl.billing_renewal})`}
                                </span>
                            )}
                            {state.has_firecrawl_api_key ? (
                                <span className="status-pill status-pill-done">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.firecrawlApiKeyMasked})
                                </span>
                            ) : (
                                <span className="status-pill status-pill-pending">
                                    Nicht hinterlegt (Fallback: Eden AI)
                                </span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
                            Firecrawl API Key
                        </label>
                        <input
                            type="password"
                            value={firecrawlApiKey}
                            onChange={e => setFirecrawlApiKey(e.target.value)}
                            placeholder={state.has_firecrawl_api_key ? `Gespeichert: ${state.firecrawlApiKeyMasked}` : 'fc-...'}
                            className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                            style={{
                                borderColor: "var(--border)",
                                background: "var(--bg)",
                                color: "var(--text-1)",
                            }}
                        />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('firecrawl', { firecrawl_api_key: firecrawlApiKey.trim() || undefined })}
                            disabled={savingKey.firecrawl || !firecrawlApiKey.trim()}
                            className="btn-v2 btn-v2-primary"
                        >
                            {savingKey.firecrawl ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.firecrawl ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('firecrawl', firecrawlApiKey)}
                            disabled={testingProvider === 'firecrawl' || (!firecrawlApiKey.trim() && !state.has_firecrawl_api_key)}
                            className="btn-v2"
                        >
                            {testingProvider === 'firecrawl' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
                            Scraper testen
                        </button>
                        {state.has_firecrawl_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('firecrawl')}
                                className="btn-v2 ml-auto"
                                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {testResults.firecrawl && (
                        <div 
                            className="p-2.5 rounded-md border text-xs flex items-center gap-2"
                            style={{
                                background: testResults.firecrawl.ok ? "var(--green-soft)" : "var(--danger-soft)",
                                borderColor: testResults.firecrawl.ok ? "var(--green-mid)" : "var(--danger)",
                                color: testResults.firecrawl.ok ? "var(--green)" : "var(--danger)",
                            }}
                        >
                            <span>{testResults.firecrawl.ok ? '✓' : '✗'}</span>
                            <span>{testResults.firecrawl.ok ? `Erfolgreich: ${testResults.firecrawl.sample}` : testResults.firecrawl.error}</span>
                        </div>
                    )}
                </div>

                {/* ── 3. SERPER.DEV ── */}
                <div 
                    className="p-5 space-y-4"
                    style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r)",
                        boxShadow: "var(--shadow-sm)",
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Search className="w-4 h-4" style={{ color: "var(--orange)" }} />
                            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>Serper.dev</h2>
                            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Google Suche + Google Places (2.500 free/Monat)</span>
                        </div>
                        <div>
                            {state.has_serper_api_key ? (
                                <span className="status-pill status-pill-done">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.serperApiKeyMasked})
                                </span>
                            ) : (
                                <span className="status-pill status-pill-pending">
                                    Nicht hinterlegt
                                </span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
                            Serper API Key
                        </label>
                        <input
                            type="password"
                            value={serperApiKey}
                            onChange={e => setSerperApiKey(e.target.value)}
                            placeholder={state.has_serper_api_key ? `Gespeichert: ${state.serperApiKeyMasked}` : 'sk-...'}
                            className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                            style={{
                                borderColor: "var(--border)",
                                background: "var(--bg)",
                                color: "var(--text-1)",
                            }}
                        />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('serper', { serper_api_key: serperApiKey.trim() || undefined })}
                            disabled={savingKey.serper || !serperApiKey.trim()}
                            className="btn-v2 btn-v2-primary"
                        >
                            {savingKey.serper ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.serper ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('serper', serperApiKey)}
                            disabled={testingProvider === 'serper' || (!serperApiKey.trim() && !state.has_serper_api_key)}
                            className="btn-v2"
                        >
                            {testingProvider === 'serper' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                            Web-Suche testen
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('serper-places', serperApiKey)}
                            disabled={testingProvider === 'serper-places' || (!serperApiKey.trim() && !state.has_serper_api_key)}
                            className="btn-v2"
                        >
                            {testingProvider === 'serper-places' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <span>📍</span>}
                            Places testen
                        </button>
                        {state.has_serper_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('serper')}
                                className="btn-v2 ml-auto"
                                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {(testResults.serper || testResults['serper-places']) && (
                        <div 
                            className="p-2.5 rounded-md border text-xs flex items-center gap-2"
                            style={{
                                background: (testResults['serper-places'] || testResults.serper).ok ? "var(--green-soft)" : "var(--danger-soft)",
                                borderColor: (testResults['serper-places'] || testResults.serper).ok ? "var(--green-mid)" : "var(--danger)",
                                color: (testResults['serper-places'] || testResults.serper).ok ? "var(--green)" : "var(--danger)",
                            }}
                        >
                            <span>{(testResults['serper-places'] || testResults.serper).ok ? '✓' : '✗'}</span>
                            <span>{(testResults['serper-places'] || testResults.serper).ok ? `Erfolgreich: ${(testResults['serper-places'] || testResults.serper).sample}` : ((testResults['serper-places'] || testResults.serper).error || 'Test fehlgeschlagen')}</span>
                        </div>
                    )}
                </div>

                {/* ── 4. SERPAPI ── */}
                <div 
                    className="p-5 space-y-4"
                    style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r)",
                        boxShadow: "var(--shadow-sm)",
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4" style={{ color: "var(--orange)" }} />
                            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>SerpApi</h2>
                            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Google Maps structured</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {healthData?.statuses?.serpapi?.limit !== undefined && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Coins className="w-3 h-3 text-emerald-600" />
                                    {healthData.statuses.serpapi.limit} Searches übrig
                                </span>
                            )}
                            {state.has_serp_api_key ? (
                                <span className="status-pill status-pill-done">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.serpApiKeyMasked})
                                </span>
                            ) : (
                                <span className="status-pill status-pill-pending">
                                    Nicht hinterlegt
                                </span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
                            SerpApi Key
                        </label>
                        <input
                            type="password"
                            value={serpApiKey}
                            onChange={e => setSerpApiKey(e.target.value)}
                            placeholder={state.has_serp_api_key ? `Gespeichert: ${state.serpApiKeyMasked}` : 'secret...'}
                            className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                            style={{
                                borderColor: "var(--border)",
                                background: "var(--bg)",
                                color: "var(--text-1)",
                            }}
                        />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('serp', { serp_api_key: serpApiKey.trim() || undefined })}
                            disabled={savingKey.serp || !serpApiKey.trim()}
                            className="btn-v2 btn-v2-primary"
                        >
                            {savingKey.serp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.serp ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('serpapi', serpApiKey)}
                            disabled={testingProvider === 'serpapi' || (!serpApiKey.trim() && !state.has_serp_api_key)}
                            className="btn-v2"
                        >
                            {testingProvider === 'serpapi' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                            Testen
                        </button>
                        {state.has_serp_api_key && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('serp')}
                                className="btn-v2 ml-auto"
                                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {(testResults.serpapi || testResults.serp) && (
                        <div 
                            className="p-2.5 rounded-md border text-xs flex items-center gap-2"
                            style={{
                                background: (testResults.serpapi || testResults.serp).ok ? "var(--green-soft)" : "var(--danger-soft)",
                                borderColor: (testResults.serpapi || testResults.serp).ok ? "var(--green-mid)" : "var(--danger)",
                                color: (testResults.serpapi || testResults.serp).ok ? "var(--green)" : "var(--danger)",
                            }}
                        >
                            <span>{(testResults.serpapi || testResults.serp).ok ? '✓' : '✗'}</span>
                            <span>{(testResults.serpapi || testResults.serp).ok ? `Erfolgreich (${(testResults.serpapi || testResults.serp).hits} Treffer): ${(testResults.serpapi || testResults.serp).sample}` : ((testResults.serpapi || testResults.serp).error || 'Test fehlgeschlagen')}</span>
                        </div>
                    )}
                </div>

                {/* ── 5. APIFY ── */}
                <div 
                    className="p-5 space-y-4"
                    style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r)",
                        boxShadow: "var(--shadow-sm)",
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4" style={{ color: "var(--orange)" }} />
                            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>Apify</h2>
                            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Maps Scraper & GBP Profile Enricher</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {healthData?.statuses?.apify?.limit !== undefined && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Coins className="w-3 h-3 text-emerald-600" />
                                    ${Number(healthData.statuses.apify.limit).toFixed(2)} Guthaben
                                </span>
                            )}
                            {state.has_apify_api_token ? (
                                <span className="status-pill status-pill-done">
                                    <CheckCircle2 className="w-3 h-3" /> In DB ({state.apifyApiTokenMasked})
                                </span>
                            ) : (
                                <span className="status-pill status-pill-pending">
                                    Nicht hinterlegt
                                </span>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
                            Apify API Token
                        </label>
                        <input
                            type="password"
                            value={apifyApiToken}
                            onChange={e => setApifyApiToken(e.target.value)}
                            placeholder={state.has_apify_api_token ? `Gespeichert: ${state.apifyApiTokenMasked}` : 'apify_api_...'}
                            className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                            style={{
                                borderColor: "var(--border)",
                                background: "var(--bg)",
                                color: "var(--text-1)",
                            }}
                        />
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
                        <button
                            type="button"
                            onClick={() => saveIndividualKey('apify', { apify_api_token: apifyApiToken.trim() || undefined })}
                            disabled={savingKey.apify || !apifyApiToken.trim()}
                            className="btn-v2 btn-v2-primary"
                        >
                            {savingKey.apify ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            {savedKeyMsg.apify ? 'Gespeichert ✓' : 'Speichern'}
                        </button>
                        <button
                            type="button"
                            onClick={() => testSearchProvider('apify', apifyApiToken)}
                            disabled={testingProvider === 'apify' || (!apifyApiToken.trim() && !state.has_apify_api_token)}
                            className="btn-v2"
                        >
                            {testingProvider === 'apify' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                            Testen
                        </button>
                        {state.has_apify_api_token && (
                            <button
                                type="button"
                                onClick={() => deleteIndividualKey('apify')}
                                className="btn-v2 ml-auto"
                                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Key löschen
                            </button>
                        )}
                    </div>

                    {testResults.apify && (
                        <div 
                            className="p-2.5 rounded-md border text-xs flex items-center gap-2"
                            style={{
                                background: testResults.apify.ok ? "var(--green-soft)" : "var(--danger-soft)",
                                borderColor: testResults.apify.ok ? "var(--green-mid)" : "var(--danger)",
                                color: testResults.apify.ok ? "var(--green)" : "var(--danger)",
                            }}
                        >
                            <span>{testResults.apify.ok ? '✓' : '✗'}</span>
                            <span>{testResults.apify.ok ? `Erfolgreich: ${testResults.apify.sample}` : (testResults.apify.error || 'Test fehlgeschlagen')}</span>
                        </div>
                    )}
                </div>

                {/* ── 6. OUTBOUND PROXY (HETZNER IP-SCHUTZ) ── */}
                <div 
                    className="p-5 space-y-3"
                    style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--r)",
                        boxShadow: "var(--shadow-sm)",
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <Globe className="w-4 h-4 text-emerald-600" />
                            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>Ausgehender Proxy (Hetzner IP-Schutz)</h2>
                            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Schützt den Server vor Rate-Limits & Bot-Blocks</span>
                        </div>
                        <div>
                            {state.outbound_proxy_url ? (
                                <span className="status-pill status-pill-done">
                                    <CheckCircle2 className="w-3 h-3" /> Proxy aktiv
                                </span>
                            ) : (
                                <span className="status-pill status-pill-pending">
                                    Direkte Hetzner-IP (Standard)
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200/60">
                        <p>
                            Wenn du tausende Webseiten prüfst, schützt ein rotierender Proxy (z. B. Smartproxy, Webshare oder BrightData) die Hetzner-Server-IP vor Abuse-Meldungen und Cloudflare-Sperren.
                        </p>
                        <p className="mt-1.5 font-mono text-[11px] text-slate-700">
                            Einstellung in der Server <code>.env</code>: <code>OUTBOUND_PROXY_URL=http://user:pass@proxy.example.com:8080</code>
                        </p>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
