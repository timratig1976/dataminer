import React, { useState } from 'react';
import { useForm, Link, usePage } from '@inertiajs/react';
import { Database, Lock, Mail, Key, Sparkles, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../../api';

export default function Login() {
    const { props } = usePage<{ branding?: { company_name: string; logo_url: string; logo_icon_url: string; primary_color: string } }>();
    const branding = props.branding;

    const { data, setData, post, processing, errors } = useForm({
        email: 'admin@dataminer.local',
        password: 'password',
        remember: true,
    });

    const [showPassword, setShowPassword] = useState(false);
    const [magicLinkLoading, setMagicLinkLoading] = useState(false);
    const [magicLinkSent, setMagicLinkSent] = useState(false);
    const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        post('/login');
    };

    const handleMagicLink = async () => {
        if (!data.email) {
            alert('Bitte gib zuerst deine E-Mail-Adresse ein.');
            return;
        }
        setMagicLinkLoading(true);
        setMagicLinkUrl(null);
        try {
            const res = await apiFetch('/api/auth/magic-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: data.email }),
            });
            const resData = await res.json();
            if (resData.magic_url) {
                setMagicLinkUrl(resData.magic_url);
            }
            setMagicLinkSent(true);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setMagicLinkLoading(false);
        }
    };

    return (
        <div 
            className="min-h-screen flex items-center justify-center p-6"
            style={{ background: "var(--bg)", fontFamily: "var(--f)" }}
        >
            <div 
                className="w-full max-w-sm p-6 shadow-sm"
                style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r)",
                }}
            >
                {/* Logo & Title */}
                <div className="flex flex-col items-center mb-6">
                    {branding?.logo_url ? (
                        <img
                            src={branding.logo_url}
                            alt={branding.company_name || 'Logo'}
                            className="h-10 max-w-[200px] object-contain mb-3"
                        />
                    ) : (
                        <div
                            className="w-10 h-10 rounded flex items-center justify-center text-white text-base font-bold shadow-sm mb-3"
                            style={{ background: branding?.primary_color || "var(--orange)" }}
                        >
                            {(branding?.company_name || 'D').charAt(0).toUpperCase()}
                        </div>
                    )}
                    <h1 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
                        {branding?.company_name || 'DataMiner'} 100k
                    </h1>
                    <p className="text-xs" style={{ color: "var(--text-3)" }}>High-Performance Lead Engine</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>
                            E-Mail
                        </label>
                        <div className="relative">
                            <Mail className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-3)" }} />
                            <input
                                type="email"
                                value={data.email}
                                onChange={(e) => setData('email', e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs rounded border focus:outline-none transition-colors"
                                style={{
                                    background: "var(--bg)",
                                    borderColor: "var(--border)",
                                    color: "var(--text-1)",
                                }}
                                required
                            />
                        </div>
                        {errors.email && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{errors.email}</div>}
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                                Passwort
                            </label>
                            <Link href="/forgot-password" className="text-[11px] text-orange-600 hover:text-orange-700">
                                Passwort vergessen?
                            </Link>
                        </div>
                        <div className="relative">
                            <Lock className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-3)" }} />
                            <input
                                type={showPassword ? "text" : "password"}
                                value={data.password}
                                onChange={(e) => setData('password', e.target.value)}
                                className="w-full pl-8 pr-9 py-1.5 text-xs rounded border focus:outline-none transition-colors"
                                style={{
                                    background: "var(--bg)",
                                    borderColor: "var(--border)",
                                    color: "var(--text-1)",
                                }}
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(v => !v)}
                                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                                tabIndex={-1}
                                title={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                            >
                                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                        {errors.password && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{errors.password}</div>}
                    </div>

                    <button
                        type="submit"
                        disabled={processing}
                        className="w-full btn-v2 btn-v2-primary justify-center py-2 text-xs font-semibold cursor-pointer mt-2"
                    >
                        {processing ? 'Anmelden...' : 'Anmelden mit Passwort'}
                    </button>

                    <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-slate-200"></div>
                        <span className="flex-shrink mx-2 text-[10.5px] text-slate-400 uppercase">oder</span>
                        <div className="flex-grow border-t border-slate-200"></div>
                    </div>

                    <button
                        type="button"
                        onClick={handleMagicLink}
                        disabled={magicLinkLoading}
                        className="w-full btn-v2 justify-center py-1.5 text-xs font-medium cursor-pointer"
                    >
                        <Key className="w-3 h-3 text-orange-500" />
                        {magicLinkLoading ? 'Sende Magic Link...' : 'Magic Link anfordern (ohne PW)'}
                    </button>

                    {magicLinkSent && (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-xs space-y-1">
                            <div className="font-semibold">Magic Link angefordert!</div>
                            {magicLinkUrl ? (
                                <a href={magicLinkUrl} className="block p-1.5 bg-white border rounded font-mono text-[10.5px] text-emerald-700 underline break-all">
                                    {magicLinkUrl}
                                </a>
                            ) : (
                                <p className="text-[11px] text-emerald-700">Bitte prüfe deine E-Mails oder Server-Logs.</p>
                            )}
                        </div>
                    )}
                </form>

                <div 
                    className="mt-5 pt-3 border-t text-center text-[11px]"
                    style={{ borderColor: "var(--border-xs)", color: "var(--text-3)" }}
                >
                    Standard: <span style={{ color: "var(--text-1)" }}>admin@dataminer.local</span> / <span style={{ color: "var(--text-1)" }}>password</span>
                </div>
            </div>
        </div>
    );
}
