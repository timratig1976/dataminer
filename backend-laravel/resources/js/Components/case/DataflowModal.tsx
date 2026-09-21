import React, { useState } from 'react';
import { 
    HelpCircle, X, Search, MapPin, Globe, Cpu, UserCheck, 
    ArrowRight, CheckCircle2, ShieldCheck, Database, Zap
} from 'lucide-react';

export default function DataflowModal() {
    const [open, setOpen] = useState(false);

    return (
        <>
            {/* Info Icon Button on Case View */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="btn-v2 btn-v2-ghost flex items-center gap-1.5 text-xs py-1 px-2.5 text-slate-600 hover:text-orange-600 border border-slate-200 shadow-xs"
                title="Datenflow & Architektur: Wie Daten gesucht, validiert und angereichert werden"
            >
                <HelpCircle className="w-3.5 h-3.5 text-orange-500" />
                <span>Datenflow</span>
            </button>

            {/* Modal */}
            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
                    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        {/* Header */}
                        <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50/50" style={{ borderColor: 'var(--border)' }}>
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-orange-500/10 text-orange-600 flex items-center justify-center font-bold text-sm">
                                    🔄
                                </div>
                                <div>
                                    <h3 className="font-bold text-sm text-slate-900">DataMiner 100k — Exakter Datenflow & Pipeline</h3>
                                    <p className="text-[11px] text-slate-500">Von der Benutzeranfrage zum vollständigen, verifizierten B2B-Datensatz</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setOpen(false)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto text-xs leading-relaxed text-slate-700">
                            {/* Pipeline Stages */}
                            <div className="space-y-4">
                                {/* Step 1 */}
                                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-bold text-sm text-blue-900">
                                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs">1</span>
                                            <span>Autonome Planung (PlannerService & Sub-Industries)</span>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[10px] font-bold">LLM: GPT-4o-mini / Mistral (~$0.0004)</span>
                                    </div>
                                    <p>
                                        <strong>Was passiert:</strong> Die natürliche Spracheingabe (z. B. <em>„Tourismus in MV“</em>) wird analysiert. Der Planner zerlegt das Ziel in geographische Cluster (alle Städte/Landkreise) und spezifische Nischen (Hotels, Gasthöfe, Pensionen, Ferienwohnungen).
                                    </p>
                                    <div className="text-[11px] text-blue-800 font-medium">
                                        Output: Ein strukturierter <code>DiscoveryPlan</code> mit 20–50 Einzelschritten inklusive Prioritäten und geschätzten Treffern.
                                    </div>
                                </div>

                                {/* Step 2 */}
                                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-bold text-sm text-emerald-900">
                                            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">2</span>
                                            <span>Autonome Background-Discovery (Queue-Runner)</span>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold">Maps: $0.0010 | SerpAPI: $0.0100</span>
                                    </div>
                                    <p>
                                        <strong>Was passiert:</strong> Der Queue-Job <code>ProcessAgentDiscoveryRun</code> arbeitet die Schritte unabhängig vom Browser ab.
                                    </p>
                                    <ul className="list-disc pl-4 space-y-1 text-[11px]">
                                        <li><strong>Priorität 1 — Serper /maps:</strong> Durchsucht Google Maps direkt und extrahiert Firmenname, Adresse, Telefon, Website, Rating, Reviews, Kategorie und den direkten Google Maps CID-Link.</li>
                                        <li><strong>Deduplizierung:</strong> Existiert eine Domain bereits im Case, wird sie verworfen.</li>
                                        <li><strong>Web-Fallback:</strong> Liefert ein Ort 0 Treffer, schaltet das System auf Google Web-Suche um.</li>
                                    </ul>
                                </div>

                                {/* Step 3 */}
                                <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-bold text-sm text-amber-900">
                                            <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-xs">3</span>
                                            <span>Web-Recherche & Domain-Finding (bei fehlender Website)</span>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[10px] font-bold">Serper: $0.0010 / Query</span>
                                    </div>
                                    <p>
                                        <strong>Was passiert:</strong> Besitzt ein Google Maps Eintrag keine hinterlegte Website, startet <code>BatchEnrichService</code> einen gezielten Web-Search nach <code>"{'{'}company{'}'} {'{'}address{'}'} Impressum Website"</code>, filtert Verzeichnisse (TripAdvisor, GelbeSeiten) aus und ermittelt die echte Domain.
                                    </p>
                                </div>

                                {/* Step 4 */}
                                <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-bold text-sm text-purple-900">
                                            <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs">4</span>
                                            <span>Live-Scraping & Cache-First Schutz</span>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-mono text-[10px] font-bold">Firecrawl: $0.0040 | Cache: $0.0000</span>
                                    </div>
                                    <p>
                                        <strong>Was passiert:</strong> Die Homepage und das Impressum werden via Firecrawl / Scrapling eingelesen. Der Inhalt wird als Markdown bereinigt (Cookie-Banner, Menüs und Footer werden entfernt) und in <code>scrape_cache</code> gespeichert (7 Tage gültig). Folgeabfragen kosten 0 Credits.
                                    </p>
                                </div>

                                {/* Step 5 */}
                                <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/40 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 font-bold text-sm text-rose-900">
                                            <span className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs">5</span>
                                            <span>KI-Synthese & Entscheider-Extraktion</span>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-mono text-[10px] font-bold">LLM: $0.0003 pro 1k Tokens</span>
                                    </div>
                                    <p>
                                        <strong>Was passiert:</strong> Das LLM (GPT-4o-mini via Eden AI) extrahiert aus dem Impressum und der Seite:
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-white p-2.5 rounded-lg border border-rose-100">
                                        <div>• Firmenname & Rechtsform</div>
                                        <div>• Allgemeine Firmen-Email (info@...)</div>
                                        <div>• Geschäftsführer / Inhaber</div>
                                        <div>• Personalisierte Email des GF</div>
                                        <div>• Mitarbeiterzahl & Branche</div>
                                        <div>• LinkedIn Profil des Entscheiders</div>
                                    </div>
                                </div>
                            </div>

                            {/* Cost Summary & Safety */}
                            <div className="p-4 rounded-xl bg-slate-900 text-slate-200 space-y-2">
                                <div className="font-bold text-white flex items-center gap-1.5 text-xs">
                                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                    <span>Kosteneffizienz & Sicherheit im 100k-Betrieb</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 text-slate-300">
                                    <div>• <strong>Discovery:</strong> 1.000 Leads finden ≈ $1,00</div>
                                    <div>• <strong>Enrichment:</strong> 1.000 Web-Scrapes ≈ $4,00</div>
                                    <div>• <strong>Entscheider:</strong> 1.000 GF-Lookups ≈ $1,50</div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-3 border-t bg-slate-50 flex items-center justify-between text-xs" style={{ borderColor: 'var(--border)' }}>
                            <span className="text-slate-500 text-[11px]">Alle Prozesse laufen asynchron über PostgreSQL-Queues.</span>
                            <button
                                onClick={() => setOpenModal(false)}
                                className="btn-v2 btn-v2-primary py-1 px-4 text-xs font-semibold cursor-pointer"
                            >
                                Verstanden
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
