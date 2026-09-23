import React, { useState, useEffect } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { 
    Users, UserPlus, Shield, Key, Mail, Trash2, Edit2, CheckCircle2, 
    RefreshCw, Copy, Activity, Eye, EyeOff, Save, Send, AlertCircle
} from 'lucide-react';
import { apiFetch } from '../../api';
import HtmlEditor from '../../Components/settings/HtmlEditor';

interface UserItem {
    id: number;
    name: string;
    email: string;
    email_verified_at: string | null;
    roles: string[];
    created_at: string;
}

interface InvitationItem {
    id: string;
    email: string;
    role: string;
    token: string;
    expires_at: string;
    created_at: string;
}

interface AuditItem {
    id: string;
    action: string;
    ip_address: string;
    user?: { id: number; name: string; email: string };
    details?: any;
    created_at: string;
}

interface Template {
    label: string;
    subject: string;
    html: string;
    text: string;
    footer?: string;
    available_placeholders: string[];
}

export default function UsersSettings() {
    const [subTab, setSubTab] = useState<'users' | 'templates'>('users');
    const [users, setUsers] = useState<UserItem[]>([]);
    const [invitations, setInvitations] = useState<InvitationItem[]>([]);
    const [audits, setAudits] = useState<AuditItem[]>([]);
    const [roles, setRoles] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    // Invite Modal / Form
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('Editor');
    const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);

    // Direct Create User Modal
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createName, setCreateName] = useState('');
    const [createEmail, setCreateEmail] = useState('');
    const [createRole, setCreateRole] = useState('Editor');
    const [createPassword, setCreatePassword] = useState('');
    const [showCreatePassword, setShowCreatePassword] = useState(false);
    const [createdUserNotice, setCreatedUserNotice] = useState<string | null>(null);

    // Edit Role State
    const [editingUser, setEditingUser] = useState<UserItem | null>(null);
    const [editRole, setEditRole] = useState('Editor');

    // Magic link generate dialog
    const [magicLinkEmail, setMagicLinkEmail] = useState('');
    const [generatedMagicLink, setGeneratedMagicLink] = useState<string | null>(null);
    const [magicLinkLoading, setMagicLinkLoading] = useState(false);

    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    // Email Templates State
    const [templates, setTemplates] = useState<Record<string, Template>>({});
    const [activeTemplateKey, setActiveTemplateKey] = useState<string>('invitation');
    const [previewHtml, setPreviewHtml] = useState<string>('');
    const [previewLoading, setPreviewLoading] = useState(false);
    const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
    const [testEmail, setTestEmail] = useState('');
    const [sendingTest, setSendingTest] = useState(false);
    const [templateAlert, setTemplateAlert] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [brandingData, setBrandingData] = useState<any>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/admin/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data.users || []);
                setInvitations(data.invitations || []);
                setAudits(data.audits || []);
                setRoles(data.roles || ['Super-Admin', 'Editor', 'Viewer']);
            }
        } catch (err) {
            console.error('Fehler beim Laden der Benutzer:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadTemplates = async () => {
        try {
            const res = await apiFetch('/api/communication');
            if (res.ok) {
                const data = await res.json();
                if (data.templates) setTemplates(data.templates);
                if (data.branding) setBrandingData(data.branding);
            }
        } catch (err) {
            console.error('Fehler beim Laden der Templates:', err);
        }
    };

    const fetchPreview = async (tplKey?: string) => {
        setPreviewLoading(true);
        try {
            const key = tplKey || activeTemplateKey;
            const res = await apiFetch('/api/communication/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    template_key: key,
                    branding: brandingData,
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
        loadData();
        loadTemplates();
    }, []);

    useEffect(() => {
        if (subTab === 'templates') {
            const t = setTimeout(() => {
                fetchPreview();
            }, 300);
            return () => clearTimeout(t);
        }
    }, [subTab, activeTemplateKey]);

    const handleSaveTemplate = async (templateKey: string) => {
        const tpl = templates[templateKey];
        if (!tpl) return;
        setSavingTemplate(templateKey);
        setTemplateAlert(null);
        try {
            const res = await apiFetch(`/api/communication/templates/${templateKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subject: tpl.subject,
                    html: tpl.html,
                    text: tpl.text,
                    footer: tpl.footer || '',
                })
            });
            const data = await res.json();
            if (res.ok) {
                setTemplateAlert({ type: 'success', text: data.message });
                fetchPreview(templateKey);
            } else {
                setTemplateAlert({ type: 'error', text: data.error || 'Fehler beim Speichern' });
            }
        } catch (err: any) {
            setTemplateAlert({ type: 'error', text: err.message });
        } finally {
            setSavingTemplate(null);
        }
    };

    const handleSendTest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!testEmail) return;
        setSendingTest(true);
        setTemplateAlert(null);
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
                setTemplateAlert({ type: 'success', text: data.message });
            } else {
                setTemplateAlert({ type: 'error', text: data.error || 'Test-Mail konnte nicht gesendet werden.' });
            }
        } catch (err: any) {
            setTemplateAlert({ type: 'error', text: err.message });
        } finally {
            setSendingTest(false);
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await apiFetch('/api/admin/invitations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
            });
            const data = await res.json();
            if (res.ok) {
                setCreatedInviteUrl(data.invite_url);
                setInviteEmail('');
                loadData();
            } else {
                alert(data.error || 'Fehler beim Senden der Einladung');
            }
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await apiFetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: createName,
                    email: createEmail,
                    role: createRole,
                    password: createPassword || undefined,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setCreatedUserNotice(data.temporary_password ? `Passwort: ${data.temporary_password}` : 'Benutzer erstellt');
                setCreateName('');
                setCreateEmail('');
                setCreatePassword('');
                loadData();
            } else {
                alert(data.error || 'Fehler beim Erstellen');
            }
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleRoleUpdate = async (userId: number, newRole: string) => {
        try {
            const res = await apiFetch(`/api/admin/users/${userId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole }),
            });
            if (res.ok) {
                setStatusMsg('Rolle erfolgreich aktualisiert');
                setTimeout(() => setStatusMsg(null), 3000);
                loadData();
                setEditingUser(null);
            }
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleDeleteUser = async (user: UserItem) => {
        if (!confirm(`Benutzer ${user.name} (${user.email}) wirklich löschen?`)) return;
        try {
            const res = await apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
            if (res.ok) {
                loadData();
            } else {
                const data = await res.json();
                alert(data.error || 'Fehler beim Löschen');
            }
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleRevokeInvite = async (id: string) => {
        try {
            await apiFetch(`/api/admin/invitations/${id}`, { method: 'DELETE' });
            loadData();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleGenerateMagicLink = async (email: string) => {
        setMagicLinkLoading(true);
        setMagicLinkEmail(email);
        setGeneratedMagicLink(null);
        try {
            const res = await apiFetch('/api/auth/magic-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (data.magic_url) {
                setGeneratedMagicLink(data.magic_url);
            } else {
                alert(data.message || 'Magic Link angefordert');
            }
        } catch (err: any) {
            alert(err.message);
        } finally {
            setMagicLinkLoading(false);
        }
    };

    return (
        <AppLayout
            title="Benutzerverwaltung & Vorlagen"
            subtitle="Verwalte Teammitglieder, Einladungen, Rollen und systemweite Transaktions-E-Mail-Vorlagen"
            actions={
                subTab === 'users' ? (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setShowInviteModal(true); setCreatedInviteUrl(null); }}
                            className="btn-v2 btn-v2-primary"
                        >
                            <Mail className="w-3.5 h-3.5" />
                            Benutzer einladen
                        </button>
                        <button
                            onClick={() => { setShowCreateModal(true); setCreatedUserNotice(null); }}
                            className="btn-v2"
                        >
                            <UserPlus className="w-3.5 h-3.5" />
                            Direkt anlegen
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSendTest} className="flex items-center gap-2">
                        <input
                            type="email"
                            required
                            value={testEmail}
                            onChange={e => setTestEmail(e.target.value)}
                            placeholder="deine-email@beispiel.de"
                            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-500/20 bg-white"
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
                )
            }
        >
            {/* Sub-Tabs: 1. Benutzer & Rollen | 2. E-Mail-Vorlagen */}
            <div style={{ background: "#fbfaf8", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", flexShrink: 0, height: 38 }}>
                <div style={{ display: "flex", alignItems: "flex-end", height: "100%", gap: 2 }}>
                    {[
                        { id: 'users', label: '👤 Benutzer & Rollen', count: users.length },
                        { id: 'templates', label: '✉️ E-Mail-Vorlagen', count: Object.keys(templates).length || undefined },
                    ].map(t => {
                        const isActive = subTab === t.id;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setSubTab(t.id as any)}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "0 14px",
                                    height: 37,
                                    fontSize: 12,
                                    cursor: "pointer",
                                    border: "none",
                                    transition: "0.1s",
                                    userSelect: "none",
                                    color: isActive ? "var(--orange)" : "var(--text-2)",
                                    borderBottom: isActive ? "2px solid var(--orange)" : "2px solid transparent",
                                    fontWeight: isActive ? 600 : 400,
                                    background: isActive ? "var(--surface)" : "transparent",
                                    borderTopLeftRadius: isActive ? "var(--rs)" : 0,
                                    borderTopRightRadius: isActive ? "var(--rs)" : 0,
                                    borderLeft: isActive ? "1px solid var(--border-xs)" : "1px solid transparent",
                                    borderRight: isActive ? "1px solid var(--border-xs)" : "1px solid transparent",
                                    marginBottom: -1,
                                }}
                            >
                                <span>{t.label}</span>
                                {t.count !== undefined && (
                                    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 8, background: isActive ? "var(--orange-soft)" : "var(--bg)", color: isActive ? "var(--orange)" : "var(--text-3)" }}>
                                        {t.count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-6xl">
                {/* ══════════════════════════════════════════════════════════════ */}
                {/* TAB 1: USERS & ROLES                                           */}
                {/* ══════════════════════════════════════════════════════════════ */}
                {subTab === 'users' && (
                    <>
                        {statusMsg && (
                            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                {statusMsg}
                            </div>
                        )}

                        {/* ── SECTION 1: Active Users ── */}
                        <div className="bg-white rounded-xl border shadow-xs overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-xs)' }}>
                                <div className="flex items-center gap-2">
                                    <Users className="w-4 h-4 text-orange-500" />
                                    <h2 className="font-semibold text-sm">Aktive Benutzer ({users.length})</h2>
                                </div>
                                <button onClick={loadData} className="btn-v2 p-1.5" title="Aktualisieren">
                                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-orange-500' : ''}`} />
                                </button>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="bg-[#fbfaf8] border-b text-[10.5px] uppercase font-semibold text-slate-500" style={{ borderColor: 'var(--border-xs)' }}>
                                        <tr>
                                            <th className="p-3">Name</th>
                                            <th className="p-3">E-Mail</th>
                                            <th className="p-3">Rolle</th>
                                            <th className="p-3">Registriert am</th>
                                            <th className="p-3 text-right">Aktionen</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y" style={{ borderColor: 'var(--border-xs)' }}>
                                        {loading && users.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="p-8 text-center text-slate-400">
                                                    Lade Benutzer...
                                                </td>
                                            </tr>
                                        ) : users.map(u => {
                                            const role = u.roles[0] || 'Viewer';
                                            const isSuperAdmin = role === 'Super-Admin';
                                            return (
                                                <tr key={u.id} className="hover:bg-[#faf9f7] transition-colors">
                                                    <td className="p-3 font-semibold text-slate-900">{u.name}</td>
                                                    <td className="p-3 font-mono text-slate-600">{u.email}</td>
                                                    <td className="p-3">
                                                        <span 
                                                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                                                            style={{
                                                                background: isSuperAdmin ? 'var(--orange-soft)' : 'var(--bg)',
                                                                color: isSuperAdmin ? 'var(--orange)' : 'var(--text-1)',
                                                                border: `1px solid ${isSuperAdmin ? 'var(--orange-mid)' : 'var(--border)'}`
                                                            }}
                                                        >
                                                            <Shield className="w-3 h-3" />
                                                            {role}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-slate-400 font-mono text-[11px]">
                                                        {new Date(u.created_at).toLocaleDateString('de-DE')}
                                                    </td>
                                                    <td className="p-3 text-right space-x-1.5">
                                                        <button
                                                            onClick={() => handleGenerateMagicLink(u.email)}
                                                            className="btn-v2 p-1 px-2 text-[11px]"
                                                            title="Magic Link generieren"
                                                        >
                                                            <Key className="w-3 h-3" /> Magic Link
                                                        </button>
                                                        <button
                                                            onClick={() => { setEditingUser(u); setEditRole(role); }}
                                                            className="btn-v2 p-1 px-2 text-[11px]"
                                                            title="Rolle ändern"
                                                        >
                                                            <Edit2 className="w-3 h-3" /> Rolle
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(u)}
                                                            className="btn-v2 p-1 px-2 text-[11px] text-red-600 hover:bg-red-50 border-red-200"
                                                            title="Löschen"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* ── SECTION 2: Open Invitations ── */}
                        {invitations.length > 0 && (
                            <div className="bg-white rounded-xl border shadow-xs overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                                <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-xs)' }}>
                                    <div className="flex items-center gap-2">
                                        <Mail className="w-4 h-4 text-emerald-600" />
                                        <h2 className="font-semibold text-sm">Ausstehende Einladungen ({invitations.length})</h2>
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead className="bg-[#fbfaf8] border-b text-[10.5px] uppercase font-semibold text-slate-500" style={{ borderColor: 'var(--border-xs)' }}>
                                            <tr>
                                                <th className="p-3">E-Mail</th>
                                                <th className="p-3">Vorgesehene Rolle</th>
                                                <th className="p-3">Gültig bis</th>
                                                <th className="p-3 text-right">Aktionen</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y" style={{ borderColor: 'var(--border-xs)' }}>
                                            {invitations.map(inv => (
                                                <tr key={inv.id} className="hover:bg-[#faf9f7] transition-colors">
                                                    <td className="p-3 font-mono text-slate-800">{inv.email}</td>
                                                    <td className="p-3">
                                                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 border text-slate-700">
                                                            {inv.role}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 text-slate-400 font-mono text-[11px]">
                                                        {new Date(inv.expires_at).toLocaleString('de-DE')}
                                                    </td>
                                                    <td className="p-3 text-right space-x-1.5">
                                                        <button
                                                            onClick={() => {
                                                                const url = `${window.location.origin}/invitations/${inv.token}`;
                                                                navigator.clipboard.writeText(url);
                                                                alert('Einladungslink in Zwischenablage kopiert!');
                                                            }}
                                                            className="btn-v2 p-1 px-2 text-[11px]"
                                                            title="Link kopieren"
                                                        >
                                                            <Copy className="w-3 h-3" /> Link kopieren
                                                        </button>
                                                        <button
                                                            onClick={() => handleRevokeInvite(inv.id)}
                                                            className="btn-v2 p-1 px-2 text-[11px] text-red-600 hover:bg-red-50"
                                                            title="Widerrufen"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* ── SECTION 3: Audit Activity Log ── */}
                        <div className="bg-white rounded-xl border shadow-xs overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-xs)' }}>
                                <div className="flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-purple-600" />
                                    <h2 className="font-semibold text-sm">Sicherheits- & Audit-Log (letzte 50 Aktionen)</h2>
                                </div>
                            </div>

                            <div className="divide-y max-h-72 overflow-y-auto text-xs font-mono" style={{ borderColor: 'var(--border-xs)' }}>
                                {audits.length === 0 ? (
                                    <div className="p-6 text-center text-slate-400">Keine Audit-Einträge vorhanden.</div>
                                ) : audits.map(a => (
                                    <div key={a.id} className="p-3 hover:bg-[#faf9f7] flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[11px] font-bold text-slate-800 uppercase px-1.5 py-0.5 rounded bg-slate-100 border">
                                                {a.action}
                                            </span>
                                            <span className="text-slate-600">
                                                {a.user ? `${a.user.name} (${a.user.email})` : 'System / Gast'}
                                            </span>
                                            {a.details && (
                                                <span className="text-slate-400 text-[10.5px]">
                                                    {JSON.stringify(a.details)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-slate-400 text-[10.5px]">
                                            {new Date(a.created_at).toLocaleString('de-DE')} · IP: {a.ip_address || '127.0.0.1'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}

                {/* ══════════════════════════════════════════════════════════════ */}
                {/* TAB 2: EMAIL TEMPLATES (CONNECTED WITH USER MANAGEMENT)        */}
                {/* ══════════════════════════════════════════════════════════════ */}
                {subTab === 'templates' && (
                    <div className="space-y-6">
                        {templateAlert && (
                            <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${templateAlert.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                                {templateAlert.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                                <span>{templateAlert.text}</span>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                            {/* Left: Templates List & Editors (7 cols) */}
                            <div className="lg:col-span-7 space-y-5">
                                {Object.entries(templates).map(([key, current]) => {
                                    const isFocused = activeTemplateKey === key;
                                    const isSaving = savingTemplate === key;

                                    return (
                                        <div
                                            key={key}
                                            onClick={() => { if (activeTemplateKey !== key) setActiveTemplateKey(key); }}
                                            className={`bg-white rounded-xl border p-5 shadow-xs transition-all ${
                                                isFocused
                                                    ? 'border-orange-500 ring-2 ring-orange-500/10'
                                                    : 'border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                                                        isFocused ? 'bg-orange-50 text-orange-600 border border-orange-200' : 'bg-slate-100 text-slate-600'
                                                    }`}>
                                                        ✉️
                                                    </div>
                                                    <div>
                                                        <h3 className="font-bold text-xs text-slate-800">{current.label}</h3>
                                                        <span className="text-[10.5px] font-mono text-slate-400">Key: {key}</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setActiveTemplateKey(key);
                                                            fetchPreview(key);
                                                        }}
                                                        className={`px-2.5 py-1 text-[11px] rounded-lg border font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                                                            isFocused
                                                                ? 'bg-orange-50 border-orange-200 text-orange-700'
                                                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                                        }`}
                                                    >
                                                        <Eye className="w-3 h-3" />
                                                        <span>Vorschau</span>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        disabled={isSaving}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSaveTemplate(key);
                                                        }}
                                                        className="btn-v2 btn-v2-primary text-[11px] flex items-center gap-1.5 py-1 px-3.5 cursor-pointer"
                                                    >
                                                        {isSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                                        <span>Speichern</span>
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="space-y-3 text-xs pt-1">
                                                <div>
                                                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Betreffzeile</label>
                                                    <input
                                                        type="text"
                                                        value={current.subject}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            setTemplates(prev => ({
                                                                ...prev,
                                                                [key]: { ...prev[key], subject: val }
                                                            }));
                                                        }}
                                                        className="w-full border border-slate-200 rounded-lg p-2 focus:outline-orange-500 font-medium bg-slate-50/50 focus:bg-white"
                                                        required
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">E-Mail Inhalt (Visuell formatieren oder HTML-Code)</label>
                                                    <HtmlEditor
                                                        html={current.html}
                                                        availablePlaceholders={current.available_placeholders}
                                                        onChange={val => {
                                                            setTemplates(prev => ({
                                                                ...prev,
                                                                [key]: { ...prev[key], html: val }
                                                            }));
                                                        }}
                                                        rows={7}
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Vorlagen-Footer (optional)</label>
                                                    <textarea
                                                        value={current.footer || ''}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            setTemplates(prev => ({
                                                                ...prev,
                                                                [key]: { ...prev[key], footer: val }
                                                            }));
                                                        }}
                                                        placeholder="Leer lassen für globalen Branding-Footer"
                                                        rows={2}
                                                        className="w-full border border-slate-200 rounded-lg p-2 font-mono text-[11px] focus:outline-orange-500 bg-slate-50/50 focus:bg-white"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Text-Version (Fallback)</label>
                                                    <textarea
                                                        value={current.text}
                                                        onChange={e => {
                                                            const val = e.target.value;
                                                            setTemplates(prev => ({
                                                                ...prev,
                                                                [key]: { ...prev[key], text: val }
                                                            }));
                                                        }}
                                                        rows={3}
                                                        className="w-full border border-slate-200 rounded-lg p-2 font-mono text-[11px] focus:outline-orange-500 bg-slate-50/50 focus:bg-white"
                                                        required
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Right: Live Preview Frame (5 cols sticky) */}
                            <div className="lg:col-span-5 flex flex-col space-y-2 lg:sticky lg:top-0 self-start">
                                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
                                    {previewHtml ? (
                                        <iframe
                                            srcDoc={previewHtml}
                                            title="E-Mail Live Vorschau"
                                            className="w-full border-0"
                                            style={{ height: '720px', overflow: 'hidden' }}
                                        />
                                    ) : (
                                        <div className="flex items-center justify-center text-slate-400 text-xs h-[400px]">
                                            Lade Vorschau...
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 pt-1">
                                    <Eye className="w-3.5 h-3.5 text-orange-500" />
                                    <span className="font-medium text-slate-700">Live Vorschau ({templates[activeTemplateKey]?.label || 'E-Mail'})</span>
                                    {previewLoading && (
                                        <span className="text-[11px] text-orange-600 flex items-center gap-1 ml-1">
                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ── MODAL: Invite User ── */}
            {showInviteModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs">
                    <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border space-y-4" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-base flex items-center gap-2">
                                <Mail className="w-4 h-4 text-orange-500" /> Neues Teammitglied einladen
                            </h3>
                            <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>

                        {createdInviteUrl ? (
                            <div className="space-y-3">
                                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-xs space-y-1">
                                    <div className="font-semibold">Einladungslink erfolgreich erstellt!</div>
                                    <div className="break-all font-mono text-[11px] p-2 bg-white rounded border">
                                        {createdInviteUrl}
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(createdInviteUrl);
                                        alert('Link kopiert!');
                                    }}
                                    className="btn-v2 btn-v2-primary w-full justify-center"
                                >
                                    <Copy className="w-3.5 h-3.5" /> Link in Zwischenablage kopieren
                                </button>
                            </div>
                        ) : (
                            <form onSubmit={handleInvite} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-slate-700">E-Mail-Adresse</label>
                                    <input
                                        type="email"
                                        required
                                        value={inviteEmail}
                                        onChange={e => setInviteEmail(e.target.value)}
                                        placeholder="kollege@firma.de"
                                        className="w-full text-xs p-2 rounded border focus:outline-orange-500"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-medium text-slate-700">Rolle</label>
                                    <select
                                        value={inviteRole}
                                        onChange={e => setInviteRole(e.target.value)}
                                        className="w-full text-xs p-2 rounded border bg-white focus:outline-orange-500"
                                    >
                                        <option value="Super-Admin">Super-Admin (Voller Zugriff & Einstellungen)</option>
                                        <option value="Editor">Editor (Darf Cases, KI-Spalten & Suchen ausführen)</option>
                                        <option value="Viewer">Viewer (Nur Lesezugriff)</option>
                                    </select>
                                </div>

                                <div className="flex justify-end gap-2 pt-2">
                                    <button type="button" onClick={() => setShowInviteModal(false)} className="btn-v2">Abbrechen</button>
                                    <button type="submit" className="btn-v2 btn-v2-primary">Einladungslink erzeugen</button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* ── MODAL: Direct Create User ── */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs">
                    <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border space-y-4" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-base flex items-center gap-2">
                                <UserPlus className="w-4 h-4 text-orange-500" /> Benutzer direkt erstellen
                            </h3>
                            <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>

                        {createdUserNotice && (
                            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded text-xs">
                                {createdUserNotice}
                            </div>
                        )}

                        <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">Vollständiger Name</label>
                                <input
                                    type="text"
                                    required
                                    value={createName}
                                    onChange={e => setCreateName(e.target.value)}
                                    placeholder="Max Mustermann"
                                    className="w-full p-2 rounded border focus:outline-orange-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">E-Mail</label>
                                <input
                                    type="email"
                                    required
                                    value={createEmail}
                                    onChange={e => setCreateEmail(e.target.value)}
                                    placeholder="max@firma.de"
                                    className="w-full p-2 rounded border focus:outline-orange-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">Rolle</label>
                                <select
                                    value={createRole}
                                    onChange={e => setCreateRole(e.target.value)}
                                    className="w-full p-2 rounded border bg-white focus:outline-orange-500"
                                >
                                    <option value="Super-Admin">Super-Admin</option>
                                    <option value="Editor">Editor</option>
                                    <option value="Viewer">Viewer</option>
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="font-medium text-slate-700">Initiales Passwort (optional, sonst Zufalls-PW)</label>
                                <div className="relative">
                                    <input
                                        type={showCreatePassword ? "text" : "password"}
                                        value={createPassword}
                                        onChange={e => setCreatePassword(e.target.value)}
                                        placeholder="mindestens 8 Zeichen"
                                        className="w-full p-2 pr-9 rounded border focus:outline-orange-500 font-mono text-xs"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCreatePassword(v => !v)}
                                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                                        tabIndex={-1}
                                        title={showCreatePassword ? "Passwort verbergen" : "Passwort anzeigen"}
                                    >
                                        {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-v2">Abbrechen</button>
                                <button type="submit" className="btn-v2 btn-v2-primary">Benutzer anlegen</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── MODAL: Edit Role ── */}
            {editingUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs">
                    <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-xl border space-y-4" style={{ borderColor: 'var(--border)' }}>
                        <h3 className="font-bold text-sm">Rolle ändern für {editingUser.name}</h3>
                        <div className="space-y-2 text-xs">
                            <label className="font-medium text-slate-700">Neue Rolle zuweisen</label>
                            <select
                                value={editRole}
                                onChange={e => setEditRole(e.target.value)}
                                className="w-full p-2 rounded border bg-white focus:outline-orange-500"
                            >
                                <option value="Super-Admin">Super-Admin</option>
                                <option value="Editor">Editor</option>
                                <option value="Viewer">Viewer</option>
                            </select>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setEditingUser(null)} className="btn-v2">Abbrechen</button>
                            <button onClick={() => handleRoleUpdate(editingUser.id, editRole)} className="btn-v2 btn-v2-primary">Speichern</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── MODAL: Magic Link Generated ── */}
            {generatedMagicLink && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs">
                    <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border space-y-4" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center justify-between">
                            <h3 className="font-bold text-base flex items-center gap-2">
                                <Key className="w-4 h-4 text-orange-500" /> Einmaliger Magic Login Link
                            </h3>
                            <button onClick={() => setGeneratedMagicLink(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                        <p className="text-xs text-slate-500">
                            Dieser Link ermöglicht {magicLinkEmail} den sofortigen Login ohne Passwort (gültig für 15 Minuten):
                        </p>
                        <div className="p-3 bg-slate-50 rounded border text-xs font-mono break-all text-slate-800">
                            {generatedMagicLink}
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(generatedMagicLink);
                                    alert('Magic Link kopiert!');
                                    setGeneratedMagicLink(null);
                                }}
                                className="btn-v2 btn-v2-primary"
                            >
                                <Copy className="w-3.5 h-3.5" /> Kopieren & Schließen
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
}
