import React, { useState, useEffect } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import SettingsTabs from '../../Components/settings/SettingsTabs';
import { 
    Mail, Palette, Layout, Send, CheckCircle2, AlertCircle, RefreshCw, 
    Save, Sparkles, Sliders, ExternalLink, Eye 
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

interface Template {
    label: string;
    subject: string;
    html: string;
    text: string;
    footer?: string;
    available_placeholders: string[];
}

export default function CommunicationSettings() {
    const [loading, setLoading] = useState(true);
    const [savingBranding, setSavingBranding] = useState(false);
    const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
    const [sendingTest, setSendingTest] = useState(false);
    const [testEmail, setTestEmail] = useState('');
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

    const [templates, setTemplates] = useState<Record<string, Template>>({});
    const [activeTemplateKey, setActiveTemplateKey] = useState<string>('magic_link');
    const [previewHtml, setPreviewHtml] = useState<string>('');
    const [previewLoading, setPreviewLoading] = useState(false);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/communication');
            const data = await res.json();
            if (res.ok) {
                if (data.branding) setBranding(data.branding);
                if (data.templates) setTemplates(data.templates);
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

    // Fetch live preview when activeTemplateKey or branding changes
    const fetchPreview = async (overrideBranding?: Branding, tplKey?: string) => {
        setPreviewLoading(true);
        try {
            const key = tplKey || activeTemplateKey;
            const res = await apiFetch('/api/communication/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    template_key: key,
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
    }, [branding, activeTemplateKey, loading]);

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

    const handleSaveTemplate = async (templateKey: string) => {
        const tpl = templates[templateKey];
        if (!tpl) return;
        setSavingTemplate(templateKey);
        setMessage(null);
        try {
            const res = await apiFetch(`/api/communication/templates/${templateKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subject: tpl.subject,
                    html: tpl.html,
                    text: tpl.text,
                })
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: data.message });
                fetchPreview(branding, templateKey);
            } else {
                setMessage({ type: 'error', text: data.error || 'Fehler beim Speichern' });
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSavingTemplate(null);
        }
    };

    const handleSendTest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!testEmail) return;
        setSendingTest(true);
        setMessage(null);
        try {
            const res = await apiFetch('/api/communication/send-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipient: testEmail,
                    template_key: activeTemplateKey,
                })
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: data.message });
            } else {
                setMessage({ type: 'error', text: data.error || 'Test-Mail konnte nicht gesendet werden.' });
            }
        } catch (err: any) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSendingTest(false);
        }
    };

    return (
        <AppLayout title="E-Mail & Kommunikation">
            <div className="max-w-6xl mx-auto space-y-6">
                <SettingsTabs />

                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
                            <Mail className="w-5 h-5 text-orange-500" />
                            E-Mail Branding & Vorlagen
                        </h1>
                        <p className="text-xs text-slate-500 mt-1">
                            Passe Absender, Farben, Logo und Vorlagen für Einladungen, Passwort-Resets und Magic Links an.
                        </p>
                    </div>

                    {/* Test Email Bar */}
                    <form onSubmit={handleSendTest} className="flex items-center gap-2">
                        <input
                            type="email"
                            required
                            value={testEmail}
                            onChange={e => setTestEmail(e.target.value)}
                            placeholder="deine-email@beispiel.de"
                            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-white"
                        />
                        <button
                            type="submit"
                            disabled={sendingTest || !testEmail}
                            className="btn-v2 btn-v2-primary text-xs flex items-center gap-1.5 py-1.5 px-3 cursor-pointer disabled:opacity-50"
                        >
                            {sendingTest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Test-Mail senden
                        </button>
                    </form>
                </div>

                {message && (
                    <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                        {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                        <span>{message.text}</span>
                    </div>
                )}

                {/* Main 2-Column Area: Editor on Left, Live Preview on Right */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left: Branding & Templates Tabs (7 cols) */}
                    <div className="lg:col-span-7 space-y-6">
                        {/* 1. Global Branding Card */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                                <Palette className="w-4 h-4 text-orange-500" />
                                Globales E-Mail Branding
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
                                        className="w-full border border-slate-200 rounded-lg p-2 focus:outline-orange-500 text-xs"
                                    />
                                </div>

                                <div className="flex justify-end pt-1">
                                    <button
                                        type="submit"
                                        disabled={savingBranding}
                                        className="btn-v2 btn-v2-primary flex items-center gap-1.5 py-1.5 px-4 cursor-pointer"
                                    >
                                        {savingBranding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                        Branding speichern
                                    </button>
                                </div>
                            </form>
                        </div>

                        {/* 2. Templates Editor Card */}
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                                    <Layout className="w-4 h-4 text-orange-500" />
                                    E-Mail Vorlagen anpassen
                                </h2>
                            </div>

                            {/* Template Selector Tabs */}
                            <div className="flex border-b border-slate-100 gap-2">
                                {Object.entries(templates).map(([key, tpl]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => setActiveTemplateKey(key)}
                                        className={`pb-2 px-3 text-xs font-semibold border-b-2 cursor-pointer transition-colors ${activeTemplateKey === key ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                                    >
                                        {tpl.label}
                                    </button>
                                ))}
                            </div>

                            {/* Active Template Form */}
                            {templates[activeTemplateKey] && (() => {
                                const current = templates[activeTemplateKey];
                                return (
                                    <div className="space-y-3 text-xs">
                                        <div>
                                            <label className="block text-[11px] font-medium text-slate-600 mb-1">E-Mail Betreff</label>
                                            <input
                                                type="text"
                                                value={current.subject}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setTemplates(prev => ({
                                                        ...prev,
                                                        [activeTemplateKey]: { ...prev[activeTemplateKey], subject: val }
                                                    }));
                                                }}
                                                className="w-full border border-slate-200 rounded-lg p-2 focus:outline-orange-500 font-medium"
                                                required
                                            />
                                        </div>

                                        <div>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-[11px] font-medium text-slate-600">HTML Inhalt</label>
                                                <div className="text-[10.5px] text-slate-400">
                                                    Verfügbar: {current.available_placeholders.map(p => `{{ ${p} }}`).join(', ')}
                                                </div>
                                            </div>
                                            <textarea
                                                value={current.html}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setTemplates(prev => ({
                                                        ...prev,
                                                        [activeTemplateKey]: { ...prev[activeTemplateKey], html: val }
                                                    }));
                                                }}
                                                rows={7}
                                                className="w-full border border-slate-200 rounded-lg p-2 font-mono text-[11px] focus:outline-orange-500"
                                                required
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-medium text-slate-600 mb-1">Text-Version (Fallback)</label>
                                            <textarea
                                                value={current.text}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setTemplates(prev => ({
                                                        ...prev,
                                                        [activeTemplateKey]: { ...prev[activeTemplateKey], text: val }
                                                    }));
                                                }}
                                                rows={4}
                                                className="w-full border border-slate-200 rounded-lg p-2 font-mono text-[11px] focus:outline-orange-500"
                                                required
                                            />
                                        </div>

                                        <div className="flex justify-end pt-1">
                                            <button
                                                type="button"
                                                disabled={savingTemplate === activeTemplateKey}
                                                onClick={() => handleSaveTemplate(activeTemplateKey)}
                                                className="btn-v2 btn-v2-primary flex items-center gap-1.5 py-1.5 px-4 cursor-pointer"
                                            >
                                                {savingTemplate === activeTemplateKey ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                                Template speichern
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Right: Live Preview Frame (5 cols) */}
                    <div className="lg:col-span-5 flex flex-col space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                                <Eye className="w-4 h-4 text-orange-500" />
                                Live Vorschau ({templates[activeTemplateKey]?.label || 'E-Mail'})
                            </span>
                            {previewLoading && (
                                <span className="text-[11px] text-orange-600 flex items-center gap-1">
                                    <RefreshCw className="w-3 h-3 animate-spin" /> Rendere...
                                </span>
                            )}
                        </div>

                        <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs min-h-[580px] flex flex-col">
                            {previewHtml ? (
                                <iframe
                                    srcDoc={previewHtml}
                                    title="E-Mail Live Vorschau"
                                    className="w-full flex-1 border-0"
                                    style={{ height: '620px' }}
                                />
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">
                                    Lade Vorschau...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </AppLayout>
    );
}
