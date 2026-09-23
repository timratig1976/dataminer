import React, { useState, useEffect } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import SettingsTabs from '../../Components/settings/SettingsTabs';
import { 
    Palette, CheckCircle2, AlertCircle, RefreshCw, 
    Save, Eye, Upload
} from 'lucide-react';
import { apiFetch } from '../../api';

interface Branding {
    company_name: string;
    from_name: string;
    logo_url: string;
    logo_icon_url?: string;
    primary_color: string;
    background_color: string;
    card_color: string;
    text_color: string;
    link_color: string;
    font_family: string;
    button_radius: string;
    footer_text: string;
}

export default function CommunicationSettings() {
    const [loading, setLoading] = useState(true);
    const [savingBranding, setSavingBranding] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoIconFile, setLogoIconFile] = useState<File | null>(null);

    const [branding, setBranding] = useState<Branding>({
        company_name: 'DataMiner',
        from_name: 'DataMiner',
        logo_url: '',
        logo_icon_url: '',
        primary_color: '#ea580c',
        background_color: '#f8fafc',
        card_color: '#ffffff',
        text_color: '#1e293b',
        link_color: '#ea580c',
        font_family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        button_radius: '8px',
        footer_text: 'Automatische Nachricht aus DataMiner B2B Platform.',
    });

    const [previewHtml, setPreviewHtml] = useState<string>('');
    const [previewLoading, setPreviewLoading] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/communication');
            const data = await res.json();
            if (res.ok && data.branding) {
                setBranding(data.branding);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const fetchPreview = async (overrideBranding?: Branding) => {
        setPreviewLoading(true);
        try {
            const res = await apiFetch('/api/communication/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    template_key: 'welcome',
                    branding: overrideBranding || branding,
                })
            });
            const data = await res.json();
            if (res.ok && data.html) {
                setPreviewHtml(data.html);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setPreviewLoading(false);
        }
    };

    useEffect(() => {
        if (!loading) {
            const t = setTimeout(() => {
                fetchPreview();
            }, 300);
            return () => clearTimeout(t);
        }
    }, [branding, loading]);

    const handleSaveBranding = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingBranding(true);
        setMessage(null);
        try {
            let res;
            if (logoFile || logoIconFile) {
                const formData = new FormData();
                Object.entries(branding).forEach(([k, v]) => formData.append(k, String(v || '')));
                if (logoFile) formData.append('logo_file', logoFile);
                if (logoIconFile) formData.append('logo_icon_file', logoIconFile);
                res = await apiFetch('/api/communication/branding', {
                    method: 'POST',
                    body: formData,
                });
            } else {
                res = await apiFetch('/api/communication/branding', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(branding)
                });
            }
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: data.message });
                if (data.branding) {
                    setBranding(b => ({
                        ...b,
                        logo_url: data.branding.logo_url ?? b.logo_url,
                        logo_icon_url: data.branding.logo_icon_url ?? b.logo_icon_url,
                    }));
                }
                setLogoFile(null);
                setLogoIconFile(null);
                fetchPreview(data.branding);
            } else {
                setMessage({ type: 'error', text: data.error || 'Fehler beim Speichern' });
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSavingBranding(false);
        }
    };

    return (
        <AppLayout title="Globales Branding & Design">
            <div className="max-w-6xl mx-auto space-y-6">
                <SettingsTabs />

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
                            <Palette className="w-5 h-5 text-orange-500" />
                            Globales Branding & Design
                        </h1>
                        <p className="text-xs text-slate-500 mt-1">
                            Definiere Firmennamen, Absender, Logos für Vollansicht und Sidebar-Icon sowie globale Farbwelten.
                        </p>
                    </div>
                </div>

                {message && (
                    <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                        {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                        <span>{message.text}</span>
                    </div>
                )}

                {/* Main 2-Column Area: Branding Form on Left, Live Brand Preview on Right */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Branding Form (7 cols) */}
                    <div className="lg:col-span-7">
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                                <Palette className="w-4 h-4 text-orange-500" />
                                Branding-Konfiguration
                            </h2>

                            <form onSubmit={handleSaveBranding} className="space-y-4 text-xs">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Firmenname</label>
                                        <input
                                            type="text"
                                            value={branding.company_name}
                                            onChange={e => setBranding(b => ({ ...b, company_name: e.target.value }))}
                                            className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-orange-500"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Absendername (From Name)</label>
                                        <input
                                            type="text"
                                            value={branding.from_name}
                                            onChange={e => setBranding(b => ({ ...b, from_name: e.target.value }))}
                                            className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-orange-500"
                                            required
                                        />
                                    </div>
                                </div>

                                {/* 1. Haupt-Logo (mit Text für Header & E-Mails) */}
                                <div className="space-y-2 p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-[11px] font-semibold text-slate-700">1. Haupt-Logo (mit Text für Header & E-Mails)</label>
                                        <span className="text-[10px] text-slate-400">Volles Logo</span>
                                    </div>
                                    
                                    {branding.logo_url && (
                                        <div className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200">
                                            <img src={branding.logo_url} alt="Haupt-Logo" className="max-h-10 max-w-[160px] object-contain" />
                                            <button
                                                type="button"
                                                onClick={() => setBranding(b => ({ ...b, logo_url: '' }))}
                                                className="text-[11px] text-rose-600 hover:underline cursor-pointer ml-auto"
                                            >
                                                Entfernen
                                            </button>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                        <div>
                                            <span className="text-[10px] text-slate-500 block mb-1">Datei hochladen:</span>
                                            <input
                                                type="file"
                                                accept=".png,.jpg,.jpeg,.webp,.svg,image/*"
                                                onChange={e => {
                                                    const f = e.target.files?.[0];
                                                    if (f) setLogoFile(f);
                                                }}
                                                className="w-full text-xs text-slate-600 file:mr-2.5 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 cursor-pointer"
                                            />
                                        </div>

                                        <div>
                                            <span className="text-[10px] text-slate-500 block mb-1">Oder Bild-URL:</span>
                                            <input
                                                type="url"
                                                value={branding.logo_url}
                                                onChange={e => setBranding(b => ({ ...b, logo_url: e.target.value }))}
                                                placeholder="https://.../logo-full.png"
                                                className="w-full border border-slate-200 rounded-lg p-2 focus:outline-orange-500 font-mono text-[11px] bg-white"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 2. Kompaktes Icon-Logo (ohne Text für eingeklappte Sidebar) */}
                                <div className="space-y-2 p-3 bg-slate-50/70 border border-slate-200/80 rounded-xl">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-[11px] font-semibold text-slate-700">2. Icon-Logo (Kompakt / Quadratisch für eingeklappte Navigation)</label>
                                        <span className="text-[10px] text-slate-400">Favicon / Minified</span>
                                    </div>
                                    
                                    {branding.logo_icon_url && (
                                        <div className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200">
                                            <img src={branding.logo_icon_url} alt="Icon-Logo" className="w-8 h-8 object-contain" />
                                            <button
                                                type="button"
                                                onClick={() => setBranding(b => ({ ...b, logo_icon_url: '' }))}
                                                className="text-[11px] text-rose-600 hover:underline cursor-pointer ml-auto"
                                            >
                                                Entfernen
                                            </button>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                        <div>
                                            <span className="text-[10px] text-slate-500 block mb-1">Datei hochladen:</span>
                                            <input
                                                type="file"
                                                accept=".png,.jpg,.jpeg,.webp,.svg,image/*"
                                                onChange={e => {
                                                    const f = e.target.files?.[0];
                                                    if (f) setLogoIconFile(f);
                                                }}
                                                className="w-full text-xs text-slate-600 file:mr-2.5 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 cursor-pointer"
                                            />
                                        </div>

                                        <div>
                                            <span className="text-[10px] text-slate-500 block mb-1">Oder Bild-URL:</span>
                                            <input
                                                type="url"
                                                value={branding.logo_icon_url || ''}
                                                onChange={e => setBranding(b => ({ ...b, logo_icon_url: e.target.value }))}
                                                placeholder="https://.../icon.png"
                                                className="w-full border border-slate-200 rounded-lg p-2 focus:outline-orange-500 font-mono text-[11px] bg-white"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Primärfarbe</label>
                                        <div className="flex gap-2 items-center">
                                            <input
                                                type="color"
                                                value={branding.primary_color}
                                                onChange={e => setBranding(b => ({ ...b, primary_color: e.target.value, link_color: e.target.value }))}
                                                className="w-8 h-8 rounded border border-slate-200 cursor-pointer p-0.5"
                                            />
                                            <input
                                                type="text"
                                                value={branding.primary_color}
                                                onChange={e => setBranding(b => ({ ...b, primary_color: e.target.value, link_color: e.target.value }))}
                                                className="w-full border border-slate-200 rounded-lg p-2 font-mono text-[11px]"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Hintergrund</label>
                                        <div className="flex gap-2 items-center">
                                            <input
                                                type="color"
                                                value={branding.background_color}
                                                onChange={e => setBranding(b => ({ ...b, background_color: e.target.value }))}
                                                className="w-8 h-8 rounded border border-slate-200 cursor-pointer p-0.5"
                                            />
                                            <input
                                                type="text"
                                                value={branding.background_color}
                                                onChange={e => setBranding(b => ({ ...b, background_color: e.target.value }))}
                                                className="w-full border border-slate-200 rounded-lg p-2 font-mono text-[11px]"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 mb-1">Button-Radius</label>
                                        <input
                                            type="text"
                                            value={branding.button_radius}
                                            onChange={e => setBranding(b => ({ ...b, button_radius: e.target.value }))}
                                            placeholder="8px"
                                            className="w-full border border-slate-200 rounded-lg p-2 font-mono text-[11px]"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-medium text-slate-600 mb-1">Footer-Text (Rechtliches & Abmelden)</label>
                                    <textarea
                                        value={branding.footer_text}
                                        onChange={e => setBranding(b => ({ ...b, footer_text: e.target.value }))}
                                        rows={2}
                                        className="w-full border border-slate-200 rounded-lg p-2.5 focus:outline-orange-500 text-xs"
                                    />
                                </div>

                                <div className="flex justify-end pt-1">
                                    <button
                                        type="submit"
                                        disabled={savingBranding}
                                        className="btn-v2 btn-v2-primary flex items-center gap-1.5 py-2 px-4 cursor-pointer"
                                    >
                                        {savingBranding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                        Branding speichern
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>

                    {/* Right: Live Preview Frame (5 cols sticky) */}
                    <div className="lg:col-span-5 flex flex-col space-y-2 lg:sticky lg:top-0 self-start">
                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs min-h-[580px] flex flex-col">
                            {previewHtml ? (
                                <iframe
                                    srcDoc={previewHtml}
                                    title="Branding Live Vorschau"
                                    className="w-full flex-1 border-0"
                                    style={{ height: "620px" }}
                                />
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                                    Lade Vorschau...
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 pt-1">
                            <Eye className="w-3.5 h-3.5 text-orange-500" />
                            <span className="font-medium text-slate-700">Live Branding-Vorschau</span>
                            {previewLoading && (
                                <span className="text-[11px] text-orange-600 flex items-center gap-1 ml-1">
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
