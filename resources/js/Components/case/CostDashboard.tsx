import React, { useState, useEffect } from 'react';
import { DollarSign, Layers, Zap, ExternalLink, HelpCircle, X } from 'lucide-react';
import { apiFetch } from '../../api';

interface CostBreakdownItem {
    category: string;
    provider: string;
    rate: string;
    calls: number;
    costUsd: number;
}

interface CostResponse {
    totals: {
        totalCostUsd: number;
        totalCostEur: number;
        totalTokens: number;
        totalCalls: number;
    };
    rates: Record<string, { name: string; cost_usd?: number; cost_per_1k_tokens?: number; unit?: string }>;
    breakdown: CostBreakdownItem[];
}

// Helper to format EUR in German notation (e.g. "1,73 €", rounded to at least 0,01 € if > 0)
function formatEur(amountEur: number): string {
    if (amountEur <= 0) return '0,00 €';
    const rounded = Math.max(0.01, Math.round(amountEur * 100) / 100);
    return rounded.toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }) + ' €';
}

function formatUsd(amountUsd: number): string {
    if (amountUsd <= 0) return '$0.00';
    return '$' + amountUsd.toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
    });
}

export default function CostDashboard({ caseId }: { caseId: string }) {
    const [costData, setCostData] = useState<CostResponse | null>(null);
    const [openModal, setOpenModal] = useState(false);

    const loadCosts = async () => {
        try {
            const res = await apiFetch(`/api/cases/${caseId}/costs`);
            if (res.ok) {
                const data = await res.json();
                setCostData(data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        loadCosts();
        const interval = setInterval(loadCosts, 5000);
        return () => clearInterval(interval);
    }, [caseId]);

    if (!costData) return null;

    const usd = costData.totals.totalCostUsd;
    const eur = costData.totals.totalCostEur;

    // Standard conversion factor used across backend: 0.91 EUR per USD
    const eurRate = 0.91;

    return (
        <>
            {/* Topbar Badge Button: Primary in EUR, Secondary USD */}
            <button
                type="button"
                onClick={() => setOpenModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer border transition-colors bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100 shadow-xs"
                title="Detaillierte Kostenaufstellung aller API-Aufrufe (in Euro)"
            >
                <span className="text-sm">💶</span>
                <span>{formatEur(eur)}</span>
                <span className="text-[10.5px] text-emerald-700 font-normal">({formatUsd(usd)})</span>
            </button>

            {/* Detailed Modal */}
            {openModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50/50" style={{ borderColor: 'var(--border)' }}>
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-700 flex items-center justify-center text-lg">
                                    💶
                                </div>
                                <div>
                                    <h3 className="font-bold text-sm text-slate-900">API-Kosten & Aufrufe-Audit</h3>
                                    <p className="text-[11px] text-slate-500">Exakte Abrechnung jedes einzelnen Plattform-Calls in Euro für diesen Case</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setOpenModal(false)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="p-3.5 rounded-xl border bg-slate-50 space-y-1">
                                    <div className="text-[11px] text-slate-500 font-medium">Gesamtkosten (EUR)</div>
                                    <div className="text-xl font-bold text-emerald-700">{formatEur(eur)}</div>
                                    <div className="text-[10px] text-slate-400">≈ {formatUsd(usd)} USD</div>
                                </div>
                                <div className="p-3.5 rounded-xl border bg-slate-50 space-y-1">
                                    <div className="text-[11px] text-slate-500 font-medium">API Aufrufe</div>
                                    <div className="text-xl font-bold text-slate-900">{costData.totals.totalCalls.toLocaleString('de-DE')}</div>
                                    <div className="text-[10px] text-slate-400">Maps, Suche & Scraping</div>
                                </div>
                                <div className="p-3.5 rounded-xl border bg-slate-50 space-y-1">
                                    <div className="text-[11px] text-slate-500 font-medium">LLM Tokenverbrauch</div>
                                    <div className="text-xl font-bold text-slate-900">{costData.totals.totalTokens.toLocaleString('de-DE')}</div>
                                    <div className="text-[10px] text-slate-400">Planung & Extraktion</div>
                                </div>
                            </div>

                            {/* Detailed Table by Provider / Service */}
                            <div>
                                <div className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                                    Verbrauchte Einheiten nach Provider
                                </div>
                                <div className="border rounded-xl overflow-hidden divide-y" style={{ borderColor: 'var(--border)' }}>
                                    {costData.breakdown.map((item, idx) => {
                                        const itemEur = item.costUsd * eurRate;
                                        return (
                                            <div key={idx} className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors text-xs">
                                                <div className="space-y-0.5">
                                                    <div className="font-semibold text-slate-800">{item.category}</div>
                                                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                                                        <span>{item.provider}</span>
                                                        <span>•</span>
                                                        <span className="font-mono text-slate-400">{item.rate}</span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-bold text-slate-900 font-mono">
                                                        {formatEur(itemEur)}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400">
                                                        {item.calls.toLocaleString('de-DE')} Aufrufe ({formatUsd(item.costUsd)})
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Pricing Reference Card */}
                            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                                <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                                    <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                                    <span>Hinterlegte Plattform-Tarife (Referenztabelle)</span>
                                </div>
                                <p className="text-[11px] text-slate-500 leading-relaxed">
                                    Die Kosten werden anhand der exakt registrierten API-Endpunkte in <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">CostTrackerService</code> abgerechnet:
                                </p>
                                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-600 pt-1">
                                    <div>• Serper Places: ~0,001 € / Query</div>
                                    <div>• SerpAPI Maps: ~0,009 € / Query</div>
                                    <div>• Firecrawl Scrape: ~0,004 € / Seite</div>
                                    <div>• GPT-4o-mini: ~0,0003 € / 1k Tokens</div>
                                    <div>• Serper Web: ~0,001 € / Query</div>
                                    <div>• Apify GMB Deep: ~0,004 € / Place</div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-3 border-t bg-slate-50 flex items-center justify-between text-xs" style={{ borderColor: 'var(--border)' }}>
                            <span className="text-slate-500 text-[11px]">Abrechnung erfolgt direkt bei den Providern.</span>
                            <button
                                onClick={() => setOpenModal(false)}
                                className="btn-v2 btn-v2-primary py-1 px-4 text-xs font-semibold"
                            >
                                Schließen
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
