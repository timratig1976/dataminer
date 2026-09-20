import React, { useState } from 'react';
import { Key, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Link } from '@inertiajs/react';
import { apiFetch } from '../../api';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [magicLinkLoading, setMagicLinkLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);

    const handlePasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setStatusMsg(null);
        try {
            const res = await apiFetch('/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (res.ok) {
                setStatusMsg('Link zum Zurücksetzen wurde generiert (siehe Logs/Mail).');
            } else {
                alert(data.message || 'Fehler beim Anfordern.');
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleRequestMagicLink = async () => {
        if (!email) {
            alert('Bitte gib zuerst deine E-Mail ein.');
            return;
        }
        setMagicLinkLoading(true);
        setMagicLinkUrl(null);
        try {
            const res = await apiFetch('/api/auth/magic-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (data.magic_url) {
                setMagicLinkUrl(data.magic_url);
            } else {
                setStatusMsg(data.message || 'Magic Link wurde generiert.');
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setMagicLinkLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)', fontFamily: 'var(--f)' }}>
            <div className="max-w-md w-full bg-white rounded-2xl border shadow-lg p-8 space-y-6" style={{ borderColor: 'var(--border)' }}>
                <div className="text-center space-y-2">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white mx-auto shadow-md" style={{ background: 'var(--orange)' }}>
                        <Key className="w-6 h-6" />
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900">Passwort vergessen?</h1>
                    <p className="text-xs text-slate-500">
                        Gib deine E-Mail ein, um dein Passwort zurückzusetzen oder einen sofortigen Magic Link zu erhalten.
                    </p>
                </div>

                {statusMsg && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        {statusMsg}
                    </div>
                )}

                {magicLinkUrl && (
                    <div className="p-3 bg-orange-50 border border-orange-200 text-orange-900 rounded-lg text-xs space-y-2">
                        <div className="font-semibold">Direkter Magic-Login Link:</div>
                        <a href={magicLinkUrl} className="block p-2 bg-white rounded border font-mono text-[11px] text-orange-700 underline break-all">
                            {magicLinkUrl}
                        </a>
                    </div>
                )}

                <form onSubmit={handlePasswordReset} className="space-y-4 text-xs">
                    <div className="space-y-1">
                        <label className="font-medium text-slate-700">E-Mail-Adresse</label>
                        <div className="relative">
                            <Mail className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="name@firma.de"
                                className="w-full pl-9 p-2 rounded-lg border focus:outline-orange-500"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-v2 btn-v2-primary w-full justify-center py-2.5 text-xs font-semibold"
                    >
                        {loading ? 'Sende Link...' : 'Passwort-Reset-Link anfordern'}
                    </button>

                    <button
                        type="button"
                        onClick={handleRequestMagicLink}
                        disabled={magicLinkLoading}
                        className="btn-v2 w-full justify-center py-2 text-xs"
                    >
                        {magicLinkLoading ? 'Erstelle Magic Link...' : '⚡ Stattdessen Magic Link anfordern'}
                    </button>
                </form>

                <div className="pt-2 text-center border-t" style={{ borderColor: 'var(--border-xs)' }}>
                    <Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700">
                        <ArrowLeft className="w-3 h-3" /> Zurück zum Login
                    </Link>
                </div>
            </div>
        </div>
    );
}
