import React from 'react';
import AppLayout from '../Layouts/AppLayout';
import { Key, Shield, Globe } from 'lucide-react';

interface Props {
    settings: {
        eden_region: string;
        has_eden_api_key: boolean;
        has_serp_api_key: boolean;
        has_serper_api_key: boolean;
        has_brave_api_key: boolean;
        has_firecrawl_api_key: boolean;
    };
}

export default function SettingsPage({ settings }: Props) {
    return (
        <AppLayout>
            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-bold">Einstellungen & API Keys</h1>
                    <p className="text-slate-400 text-sm">Konfiguration für EdenAI, Google Search & Maps APIs</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800/60 overflow-hidden">
                    <div className="p-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Key className="w-5 h-5 text-emerald-400" />
                            <div>
                                <div className="font-medium text-sm">EdenAI API Key</div>
                                <div className="text-xs text-slate-400">Verwendet für LLM-Extraktion & Scrape-Engine</div>
                            </div>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full border ${settings.has_eden_api_key ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-rose-950 text-rose-400 border-rose-800'}`}>
                            {settings.has_eden_api_key ? 'Aktiviert' : 'Fehlt'}
                        </span>
                    </div>

                    <div className="p-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Globe className="w-5 h-5 text-blue-400" />
                            <div>
                                <div className="font-medium text-sm">SerpAPI Key</div>
                                <div className="text-xs text-slate-400">Google Search & Maps Abfragen</div>
                            </div>
                        </div>
                        <span className={`text-xs px-2.5 py-1 rounded-full border ${settings.has_serp_api_key ? 'bg-emerald-950 text-emerald-400 border-emerald-800' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                            {settings.has_serp_api_key ? 'Aktiviert' : 'Optional'}
                        </span>
                    </div>

                    <div className="p-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Shield className="w-5 h-5 text-purple-400" />
                            <div>
                                <div className="font-medium text-sm">EdenAI Region</div>
                                <div className="text-xs text-slate-400">Aktiver Endpunkt-Standort</div>
                            </div>
                        </div>
                        <span className="text-xs bg-slate-800 text-slate-300 px-3 py-1 rounded uppercase font-mono font-bold">
                            {settings.eden_region || 'US'}
                        </span>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
