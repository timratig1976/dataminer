import React, { useState, useEffect } from 'react';
import AppLayout from '../Layouts/AppLayout';
import { 
    Key, Shield, Globe, CheckCircle2, AlertCircle, Trash2, 
    Save, RefreshCw, Sparkles, Sliders, ExternalLink 
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
    const [settings, setSettings] = useState<SettingsData>(initialSettings);
    
    // Form Inputs
    const [edenApiKey, setEdenApiKey] = useState('');
    const [edenRegion, setEdenRegion] = useState<'eu' | 'us'>(initialSettings.eden_region || 'eu');
    const [serperApiKey, setSerperApiKey] = useState('');
    const [serpApiKey, setSerpApiKey] = useState('');
    const [braveApiKey, setBraveApiKey] = useState('');
    const [firecrawlApiKey, setFirecrawlApiKey] = useState('');
    const [plannerPrompt, setPlannerPrompt] = useState(initialSettings.planner_system_prompt || '');

    // Loading & Feedback
    const [saving, setSaving] = useState(false);
    const [savedMsg, setSavedMsg] = useState(false);
    const [testingProvider, setTestingProvider] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

    const refreshSettings = async () => {
        try {
            const res = await fetch('/api/settings');
            const data = await res.json();
            if (data.settings) {
                setSettings(data.settings);
                setEdenRegion(data.settings.eden_region || 'eu');
                setPlannerPrompt(data.settings.planner_system_prompt || '');
            }
        } catch (e) {
            console.error('Failed to load settings', e);
        }
    };

    const handleSave = async (customPayload?: Record<string, any>) => {
        setSaving(true);
        try {
            const payload: Record<string, any> = customPayload || {};
            if (!customPayload) {
                if (edenApiKey.trim()) payload.eden_api_key = edenApiKey.trim();
                payload.eden_region = edenRegion;
                if (serperApiKey.trim()) payload.serper_api_key = serperApiKey.trim();
                if (serpApiKey.trim()) payload.serp_api_key = serpApiKey.trim();
                if (braveApiKey.trim()) payload.brave_api_key = braveApiKey.trim();
                if (firecrawlApiKey.trim()) payload.firecrawl_api_key = firecrawlApiKey.trim();
                if (plannerPrompt !== settings.planner_system_prompt) {
                    payload.planner_system_prompt = plannerPrompt;
                }
            }

            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                setSavedMsg(true);
                setTimeout(() => setSavedMsg(false), 3000);
                setEdenApiKey('');
                setSerperApiKey('');
                setSerpApiKey('');
                setBraveApiKey('');
                setFirecrawlApiKey('');
                await refreshSettings();
            }
        } catch (e) {
            console.error('Save failed', e);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteKey = async (key: string) => {
        if (!confirm(`Möchtest du den ${key} API-Key wirklich löschen?`)) return;
        try {
            const res = await fetch(`/api/settings?key=${key}`, { method: 'DELETE' });
            if (res.ok) {
                await refreshSettings();
            }
        } catch (e) {
            console.error('Delete key failed', e);
        }
    };

    const handleTestEden = async () => {
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

    const handleTestSearch = async (provider: string, key?: string) => {
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
            <div className="max-w-4xl mx-auto space-y-8 pb-16">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                            <Sliders className="w-6 h-6 text-emerald-400" />
                            Einstellungen & Provider-Keys
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">
                            Verwaltung aller API-Verbindungen für LLM-Extraktion, Google Maps & Web-Recherchen.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        {savedMsg && (
                            <span className="text-xs text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5 animate-in fade-in">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Gespeichert
                            </span>
                        )}
                        <button
                            onClick={() => handleSave()}
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950/50 transition-all cursor-pointer"
                        >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Änderungen speichern
                        </button>
                    </div>
                </div>

                {/* ── 1. EDEN AI SECTION ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-emerald-950/70 border border-emerald-800 text-emerald-400 rounded-xl">
                                <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                                <h2 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                                    Eden AI (LLM Gateway)
                                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-normal">
                                        Primärer KI-Provider
                                    </span>
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Ein einziger Key für alle Modelle (GPT-4o, Claude 3.5, Gemini, Mistral).
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {settings.has_eden_api_key ? (
                                <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800/80 px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Key Aktiv ({settings.edenApiKeyMasked})
                                </span>
                            ) : (
                                <span className="text-xs bg-rose-950 text-rose-400 border border-rose-800/80 px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium">
                                    <AlertCircle className="w-3.5 h-3.5" /> Kein Key konfiguriert
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 space-y-1.5">
                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                Eden AI API Key
                            </label>
                            <div className="relative">
                                <Key className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                                <input
                                    type="password"
                                    value={edenApiKey}
                                    onChange={e => setEdenApiKey(e.target.value)}
                                    placeholder={settings.has_eden_api_key ? `Aktuell: ${settings.edenApiKeyMasked}` : 'sk-eden-...'}
                                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-slate-100 outline-none"
                                />
                            </div>
                            <p className="text-[11px] text-slate-500">Wird mit AES-256 verschlüsselt in PostgreSQL gespeichert.</p>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                                Region
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setEdenRegion('eu')}
                                    className={`py-2 px-3 text-xs rounded-xl border font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                                        edenRegion === 'eu'
                                            ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    🇪🇺 Europa
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEdenRegion('us')}
                                    className={`py-2 px-3 text-xs rounded-xl border font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
                                        edenRegion === 'us'
                                            ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                >
                                    🇺🇸 USA
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/40">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleTestEden}
                                disabled={testingProvider === 'eden'}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                {testingProvider === 'eden' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-emerald-400" />}
                                Eden AI Verbindung testen
                            </button>
                            {settings.has_eden_api_key && (
                                <button
                                    type="button"
                                    onClick={() => handleDeleteKey('eden')}
                                    className="p-1.5 text-rose-400 hover:bg-rose-950/50 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> Key löschen
                                </button>
                            )}
                        </div>

                        {testResults.eden && (
                            <div className={`text-xs px-3 py-1 rounded-lg border flex items-center gap-2 ${
                                testResults.eden.ok
                                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                                    : 'bg-rose-950/60 border-rose-800 text-rose-300'
                            }`}>
                                {testResults.eden.ok ? (
                                    <>
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>Erfolgreich ({testResults.eden.latencyMs}ms) – Response: "{testResults.eden.preview}"</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        <span>Fehler: {testResults.eden.error}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── 2. SEARCH & MAPS APIS ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
                    <div className="border-b border-slate-800/80 pb-4">
                        <h2 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                            <Globe className="w-4 h-4 text-blue-400" />
                            Suchmaschinen & Karten-Provider
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            DataMiner kaskadiert automatisch: SerpAPI → Serper.dev → Brave Search → DuckDuckGo Fallback.
                        </p>
                    </div>

                    {/* Serper.dev */}
                    <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <span className="font-medium text-xs text-slate-200">Serper.dev</span>
                                <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                                    Google Search & Places (Günstig & Schnell)
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {settings.has_serper_api_key && (
                                    <span className="text-[10px] text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded-full">
                                        Aktiv ({settings.serperApiKeyMasked})
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                                <input
                                    type="password"
                                    value={serperApiKey}
                                    onChange={e => setSerperApiKey(e.target.value)}
                                    placeholder={settings.has_serper_api_key ? `Aktuell: ${settings.serperApiKeyMasked}` : 'Serper API Key'}
                                    className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => handleTestSearch('serper', serperApiKey)}
                                disabled={testingProvider === 'serper'}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer"
                            >
                                {testingProvider === 'serper' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Search Test'}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleTestSearch('serper-places', serperApiKey)}
                                disabled={testingProvider === 'serper-places'}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer"
                            >
                                {testingProvider === 'serper-places' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Places Test'}
                            </button>
                        </div>
                        {testResults.serper && (
                            <div className={`text-xs p-2 rounded border ${testResults.serper.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'}`}>
                                {testResults.serper.ok ? `✓ ${testResults.serper.hits} Hits gefunden: "${testResults.serper.sample}"` : `✗ ${testResults.serper.error}`}
                            </div>
                        )}
                        {testResults['serper-places'] && (
                            <div className={`text-xs p-2 rounded border ${testResults['serper-places'].ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'}`}>
                                {testResults['serper-places'].ok ? `✓ Places: "${testResults['serper-places'].sample}"` : `✗ ${testResults['serper-places'].error}`}
                            </div>
                        )}
                    </div>

                    {/* SerpAPI */}
                    <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <span className="font-medium text-xs text-slate-200">SerpAPI</span>
                                <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                                    Vollständige Google Search API
                                </span>
                            </div>
                            {settings.has_serp_api_key && (
                                <span className="text-[10px] text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded-full">
                                    Aktiv ({settings.serpApiKeyMasked})
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                                <input
                                    type="password"
                                    value={serpApiKey}
                                    onChange={e => setSerpApiKey(e.target.value)}
                                    placeholder={settings.has_serp_api_key ? `Aktuell: ${settings.serpApiKeyMasked}` : 'SerpAPI Key'}
                                    className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => handleTestSearch('serp', serpApiKey)}
                                disabled={testingProvider === 'serp'}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer"
                            >
                                {testingProvider === 'serp' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Testen'}
                            </button>
                        </div>
                        {testResults.serp && (
                            <div className={`text-xs p-2 rounded border ${testResults.serp.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'}`}>
                                {testResults.serp.ok ? `✓ ${testResults.serp.hits} Treffer: "${testResults.serp.sample}"` : `✗ ${testResults.serp.error}`}
                            </div>
                        )}
                    </div>

                    {/* Brave Search */}
                    <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <span className="font-medium text-xs text-slate-200">Brave Search</span>
                                <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                                    Datenschutzorientierte Web-Suche
                                </span>
                            </div>
                            {settings.has_brave_api_key && (
                                <span className="text-[10px] text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded-full">
                                    Aktiv ({settings.braveApiKeyMasked})
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                                <input
                                    type="password"
                                    value={braveApiKey}
                                    onChange={e => setBraveApiKey(e.target.value)}
                                    placeholder={settings.has_brave_api_key ? `Aktuell: ${settings.braveApiKeyMasked}` : 'Brave Search API Key'}
                                    className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 rounded-lg pl-8 pr-3 py-1.5 text-xs font-mono text-slate-100 outline-none"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => handleTestSearch('brave', braveApiKey)}
                                disabled={testingProvider === 'brave'}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer"
                            >
                                {testingProvider === 'brave' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Testen'}
                            </button>
                        </div>
                        {testResults.brave && (
                            <div className={`text-xs p-2 rounded border ${testResults.brave.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'}`}>
                                {testResults.brave.ok ? `✓ ${testResults.brave.hits} Treffer: "${testResults.brave.sample}"` : `✗ ${testResults.brave.error}`}
                            </div>
                        )}
                    </div>
                </div>

                {/* ── 3. DISCOVERY PLANNER PROMPT ── */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
                    <div className="border-b border-slate-800/80 pb-4">
                        <h2 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                            <Sliders className="w-4 h-4 text-purple-400" />
                            Planner System-Prompt
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Definiert, wie der KI-Discovery-Agent aus einem Freitext-Ziel strukturierte Suchschritte ableitet.
                        </p>
                    </div>

                    <div>
                        <textarea
                            value={plannerPrompt}
                            onChange={e => setPlannerPrompt(e.target.value)}
                            rows={6}
                            placeholder="Leer lassen für integrierten Standard-Prompt..."
                            className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-xl p-3 text-xs font-mono text-slate-200 outline-none leading-relaxed"
                        />
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
