import React, { useState, useEffect } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    User, Lock, Key, Shield, CheckCircle2, AlertCircle, Copy, Save, LogOut, Eye, EyeOff 
} from 'lucide-react';
import { apiFetch } from '../../api';
import { router } from '@inertiajs/react';

export default function AccountSettings() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [roles, setRoles] = useState<string[]>([]);
    const [createdAt, setCreatedAt] = useState('');
    const [loading, setLoading] = useState(true);

    // Profile form
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

    // Password form
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [passwordSaving, setPasswordSaving] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

    // Self-service magic link
    const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);
    const [magicLinkLoading, setMagicLinkLoading] = useState(false);

    useEffect(() => {
        apiFetch('/api/user/profile')
            .then(r => r.json())
            .then(data => {
                if (data.user) {
                    setName(data.user.name);
                    setEmail(data.user.email);
                    setRoles(data.user.roles || []);
                    setCreatedAt(data.user.created_at);
                }
            })
            .finally(() => setLoading(false));
    }, []);

    const handleProfileUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setProfileSaving(true);
        setProfileSuccess(null);
        try {
            const res = await apiFetch('/api/user/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email }),
            });
            const data = await res.json();
            if (res.ok) {
                setProfileSuccess('Profildaten erfolgreich aktualisiert');
                setTimeout(() => setProfileSuccess(null), 4000);
            } else {
                alert(data.message || 'Fehler beim Aktualisieren');
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setProfileSaving(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setPasswordSuccess(null);

        if (newPassword !== newPasswordConfirmation) {
            setPasswordError('Das neue Passwort und die Bestätigung stimmen nicht überein.');
            return;
        }

        setPasswordSaving(true);
        try {
            const res = await apiFetch('/api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_password: currentPassword,
                    password: newPassword,
                    password_confirmation: newPasswordConfirmation,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setPasswordSuccess('Passwort erfolgreich geändert.');
                setCurrentPassword('');
                setNewPassword('');
                setNewPasswordConfirmation('');
                setTimeout(() => setPasswordSuccess(null), 4000);
            } else {
                setPasswordError(data.error || data.message || 'Fehler beim Ändern des Passworts.');
            }
        } catch (err: any) {
            setPasswordError(err.message);
        } finally {
            setPasswordSaving(false);
        }
    };

    const handleCreateSelfMagicLink = async () => {
        setMagicLinkLoading(true);
        setMagicLinkUrl(null);
        try {
            const res = await apiFetch('/api/user/magic-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await res.json();
            if (data.magic_url) {
                setMagicLinkUrl(data.magic_url);
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setMagicLinkLoading(false);
        }
    };

    const handleLogout = () => {
        router.post('/logout');
    };

    return (
        <AppLayout
            title="Mein Benutzerkonto"
            subtitle="Persönliche Profileinstellungen, Passwort-Self-Service und Magic Link"
            actions={
                <button onClick={handleLogout} className="btn-v2 text-red-600 border-red-200 hover:bg-red-50">
                    <LogOut className="w-3.5 h-3.5" /> Abmelden
                </button>
            }
        >
            <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
                {/* ── CARD 1: Profilinformationen ── */}
                <div className="bg-white rounded-xl border shadow-xs p-6 space-y-4" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border-xs)' }}>
                        <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-orange-500" />
                            <h2 className="font-semibold text-sm">Persönliche Daten</h2>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-400">Rolle:</span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                                <Shield className="w-3 h-3" /> {roles.join(', ') || 'Viewer'}
                            </span>
                        </div>
                    </div>

                    {profileSuccess && (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            {profileSuccess}
                        </div>
                    )}

                    <form onSubmit={handleProfileUpdate} className="space-y-4 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">Name</label>
                                <input
                                    type="text"
                                    required
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full p-2 rounded-lg border focus:outline-orange-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">E-Mail</label>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    className="w-full p-2 rounded-lg border focus:outline-orange-500"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end pt-1">
                            <button
                                type="submit"
                                disabled={profileSaving}
                                className="btn-v2 btn-v2-primary"
                            >
                                <Save className="w-3.5 h-3.5" />
                                {profileSaving ? 'Speichere...' : 'Profil speichern'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* ── CARD 2: Passwort ändern ── */}
                <div className="bg-white rounded-xl border shadow-xs p-6 space-y-4" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--border-xs)' }}>
                        <Lock className="w-4 h-4 text-orange-500" />
                        <h2 className="font-semibold text-sm">Passwort ändern (Self-Service)</h2>
                    </div>

                    {passwordSuccess && (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            {passwordSuccess}
                        </div>
                    )}

                    {passwordError && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                            {passwordError}
                        </div>
                    )}

                    <form onSubmit={handlePasswordChange} className="space-y-4 text-xs">
                        <div className="space-y-1 max-w-md">
                            <label className="font-medium text-slate-700">Aktuelles Passwort</label>
                            <div className="relative">
                                <input
                                    type={showCurrentPassword ? "text" : "password"}
                                    required
                                    value={currentPassword}
                                    onChange={e => setCurrentPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full p-2 pr-9 rounded-lg border focus:outline-orange-500 font-mono text-xs"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowCurrentPassword(v => !v)}
                                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                                    tabIndex={-1}
                                    title={showCurrentPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                                >
                                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">Neues Passwort (mind. 8 Zeichen)</label>
                                <div className="relative">
                                    <input
                                        type={showNewPassword ? "text" : "password"}
                                        required
                                        minLength={8}
                                        value={newPassword}
                                        onChange={e => setNewPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full p-2 pr-9 rounded-lg border focus:outline-orange-500 font-mono text-xs"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(v => !v)}
                                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                                        tabIndex={-1}
                                        title={showNewPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                                    >
                                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">Neues Passwort bestätigen</label>
                                <div className="relative">
                                    <input
                                        type={showNewPassword ? "text" : "password"}
                                        required
                                        minLength={8}
                                        value={newPasswordConfirmation}
                                        onChange={e => setNewPasswordConfirmation(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full p-2 pr-9 rounded-lg border focus:outline-orange-500 font-mono text-xs"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(v => !v)}
                                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                                        tabIndex={-1}
                                        title={showNewPassword ? "Passwort verbergen" : "Passwort anzeigen"}
                                    >
                                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-1">
                            <button
                                type="submit"
                                disabled={passwordSaving}
                                className="btn-v2 btn-v2-primary"
                            >
                                <Lock className="w-3.5 h-3.5" />
                                {passwordSaving ? 'Ändere Passwort...' : 'Passwort aktualisieren'}
                            </button>
                        </div>
                    </form>
                </div>

                {/* ── CARD 3: Sofortiger Magic Link Generator ── */}
                <div className="bg-white rounded-xl border shadow-xs p-6 space-y-4" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--border-xs)' }}>
                        <Key className="w-4 h-4 text-orange-500" />
                        <h2 className="font-semibold text-sm">Persönlicher Magic Login Link</h2>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed">
                        Erstelle einen sicheren Einmal-Link für dein Konto. Damit kannst du dich auf einem anderen Gerät (z. B. Smartphone oder Tablet) sofort ohne Passwort einloggen.
                    </p>

                    {magicLinkUrl && (
                        <div className="p-3 bg-orange-50 border border-orange-200 text-orange-950 rounded-lg text-xs space-y-2">
                            <div className="font-semibold">Dein generierter Einmal-Link (30 Minuten gültig):</div>
                            <div className="p-2 bg-white rounded border font-mono text-[11px] break-all text-orange-800">
                                {magicLinkUrl}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(magicLinkUrl);
                                    alert('Link kopiert!');
                                }}
                                className="btn-v2 btn-v2-primary inline-flex items-center gap-1.5 text-xs"
                            >
                                <Copy className="w-3.5 h-3.5" /> Link kopieren
                            </button>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={handleCreateSelfMagicLink}
                        disabled={magicLinkLoading}
                        className="btn-v2"
                    >
                        <Key className="w-3.5 h-3.5 text-orange-500" />
                        {magicLinkLoading ? 'Generiere Link...' : 'Neuen Magic Link für mich erstellen'}
                    </button>
                </div>
            </div>
        </AppLayout>
    );
}
