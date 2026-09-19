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
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
                <div className="flex flex-col items-center mb-8">
                    <div className="p-3 bg-emerald-950/80 border border-emerald-800 text-emerald-400 rounded-xl mb-3">
                        <Database className="w-8 h-8" />
                    </div>
                    <h1 className="text-xl font-bold">DataMiner 100k</h1>
                    <p className="text-xs text-slate-400">Laravel High-Performance Lead Engine</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                            E-Mail
                        </label>
                        <div className="relative">
                            <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                            <input
                                type="email"
                                value={data.email}
                                onChange={(e) => setData('email', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-sm rounded-lg pl-9 pr-3 py-2 text-slate-100 outline-none"
                                required
                            />
                        </div>
                        {errors.email && <div className="text-rose-400 text-xs mt-1">{errors.email}</div>}
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                            Passwort
                        </label>
                        <div className="relative">
                            <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                            <input
                                type="password"
                                value={data.password}
                                onChange={(e) => setData('password', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-sm rounded-lg pl-9 pr-3 py-2 text-slate-100 outline-none"
                                required
                            />
                        </div>
                        {errors.password && <div className="text-rose-400 text-xs mt-1">{errors.password}</div>}
                    </div>

                    <button
                        type="submit"
                        disabled={processing}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors mt-2"
                    >
                        {processing ? 'Anmelden...' : 'Anmelden'}
                    </button>
                </form>

                <div className="mt-6 pt-4 border-t border-slate-800/60 text-center text-xs text-slate-500">
                    Standard-Login: <span className="text-slate-300">admin@dataminer.local</span> / <span className="text-slate-300">password</span>
                </div>
            </div>
        </div>
    );
}
