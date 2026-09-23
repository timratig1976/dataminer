import React from 'react';
import { Link, usePage } from '@inertiajs/react';
import { Key, Sliders, ShieldAlert, Sparkles, Zap, BrainCircuit, Palette } from 'lucide-react';

export default function SettingsTabs() {
    const { url } = usePage();

    const tabs = [
        { href: '/settings', label: 'API & Keys', icon: <Key className="w-3.5 h-3.5" /> },
        { href: '/settings/communication', label: 'Globales Branding', icon: <Palette className="w-3.5 h-3.5" /> },
        { href: '/settings/models', label: 'Modell-Auswahl', icon: <Sliders className="w-3.5 h-3.5" /> },
        { href: '/settings/blacklist', label: 'Domain-Blacklist', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
        { href: '/settings/prompts', label: 'Normalisierung', icon: <BrainCircuit className="w-3.5 h-3.5" /> },
        { href: '/settings/planner', label: 'Planner Prompt', icon: <Sparkles className="w-3.5 h-3.5" /> },
        { href: '/settings/llm-test', label: 'LLM Playground', icon: <Zap className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="flex items-center gap-1 border-b pb-px mb-6 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            {tabs.map((tab) => {
                const active = url === tab.href;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-t-lg transition-colors cursor-pointer border-b-2 -mb-px whitespace-nowrap ${
                            active
                                ? 'border-orange-500 text-orange-600 bg-orange-50/50 font-semibold'
                                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </Link>
                );
            })}
        </div>
    );
}
