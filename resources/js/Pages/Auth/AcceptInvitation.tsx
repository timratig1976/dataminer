import React, { useState } from 'react';
import { Shield, CheckCircle2, Lock, User, ArrowRight } from 'lucide-react';
import { router } from '@inertiajs/react';

interface Props {
    token: string;
    email: string;
    role: string;
}

export default function AcceptInvitation({ token, email, role }: Props) {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password !== passwordConfirmation) {
            setError('Passwörter stimmen nicht überein.');
            return;
        }

        setLoading(true);
        router.post(`/invitations/${token}`, {
            name,
            password,
            password_confirmation: passwordConfirmation,
        }, {
            onError: (errs) => {
                setError(Object.values(errs)[0] as string || 'Fehler beim Annehmen der Einladung.');
                setLoading(false);
            },
            onFinish: () => setLoading(false),
        });
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)', fontFamily: 'var(--f)' }}>
            <div className="max-w-md w-full bg-white rounded-2xl border shadow-lg p-8 space-y-6" style={{ borderColor: 'var(--border)' }}>
                <div className="text-center space-y-2">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white mx-auto shadow-md" style={{ background: 'var(--orange)' }}>
                        <Shield className="w-6 h-6" />
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-slate-900">Einladung annehmen</h1>
                    <p className="text-xs text-slate-500">
                        Du wurdest als <span className="font-semibold text-orange-600">{role}</span> für <span className="font-mono text-slate-700">{email}</span> eingeladen.
                    </p>
                </div>

                {error && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                    <div className="space-y-1">
                        <label className="font-medium text-slate-700">Dein vollständiger Name</label>
                        <div className="relative">
                            <User className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Max Mustermann"
                                className="w-full pl-9 p-2 rounded-lg border focus:outline-orange-500"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="font-medium text-slate-700">Passwort festlegen (mind. 8 Zeichen)</label>
                        <div className="relative">
                            <Lock className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                            <input
                                type="password"
                                required
                                minLength={8}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full pl-9 p-2 rounded-lg border focus:outline-orange-500"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="font-medium text-slate-700">Passwort bestätigen</label>
                        <div className="relative">
                            <Lock className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                            <input
                                type="password"
                                required
                                minLength={8}
                                value={passwordConfirmation}
                                onChange={e => setPasswordConfirmation(e.target.value)}
                                placeholder="••••••••"
                                className="w-full pl-9 p-2 rounded-lg border focus:outline-orange-500"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-v2 btn-v2-primary w-full justify-center py-2.5 text-xs font-semibold"
                    >
                        {loading ? 'Richte Account ein...' : 'Account aktivieren & einloggen'}
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </form>
            </div>
        </div>
    );
}
