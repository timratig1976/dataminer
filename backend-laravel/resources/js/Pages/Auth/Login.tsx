import React, { useState } from 'react';
import { useForm } from '@inertiajs/react';
import { Database, Lock, Mail } from 'lucide-react';

export default function Login() {
    const { data, setData, post, processing, errors } = useForm({
        email: 'admin@dataminer.local',
        password: 'password',
        remember: true,
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        post('/login');
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
                    <div
                        className="w-10 h-10 rounded flex items-center justify-center text-white text-base font-bold shadow-sm mb-3"
                        style={{ background: "var(--orange)" }}
                    >
                        D
                    </div>
                    <h1 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>DataMiner 100k</h1>
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
                        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-3)" }}>
                            Passwort
                        </label>
                        <div className="relative">
                            <Lock className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-3)" }} />
                            <input
                                type="password"
                                value={data.password}
                                onChange={(e) => setData('password', e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs rounded border focus:outline-none transition-colors"
                                style={{
                                    background: "var(--bg)",
                                    borderColor: "var(--border)",
                                    color: "var(--text-1)",
                                }}
                                required
                            />
                        </div>
                        {errors.password && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{errors.password}</div>}
                    </div>

                    <button
                        type="submit"
                        disabled={processing}
                        className="w-full btn-v2 btn-v2-primary justify-center py-2 text-xs font-semibold cursor-pointer mt-2"
                    >
                        {processing ? 'Anmelden...' : 'Anmelden'}
                    </button>
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
