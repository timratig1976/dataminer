import React, { useEffect, useState } from 'react';
import { router } from '@inertiajs/react';
import AppLayout from '../Layouts/AppLayout';
import {
  Database, Rows3, Sparkles, CheckCircle2,
  DollarSign, ArrowRight, Plus, Loader2, LayoutDashboard, Trash2
} from 'lucide-react';

interface CaseStat {
  id: string;
  name: string;
  rowCount: number;
  aiColumnCount: number;
  doneCells: number;
  errorCells: number;
  costUsd: number;
  updatedAt: string;
}

interface Stats {
  totalCases: number;
  totalRows: number;
  totalCells: number;
  doneCells: number;
  errorCells: number;
  totalCostUsd: number;
  cases: CaseStat[];
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div
      className="p-5 flex items-start gap-4 rounded-xl shadow-xs"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold leading-tight" style={{ color: 'var(--text-1)' }}>{value}</div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{label}</div>
        {sub && <div className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((data) => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const deleteCase = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Case und alle Daten wirklich löschen?')) return;
    await fetch(`/api/cases/${id}`, { method: 'DELETE' });
    setStats((prev) => prev ? { ...prev, cases: prev.cases.filter((c) => c.id !== id), totalCases: prev.totalCases - 1 } : prev);
  };

  const completionPct = stats && stats.totalCells > 0
    ? Math.round((stats.doneCells / stats.totalCells) * 100)
    : 0;

  return (
    <AppLayout
      title="Dashboard"
      actions={
        <button
          onClick={() => router.visit('/cases')}
          className="btn-v2 btn-v2-primary"
        >
          <Plus className="w-3.5 h-3.5" />
          Neuer Case
        </button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--orange)' }} />
        </div>
      ) : !stats ? (
        <div className="text-sm text-center mt-20" style={{ color: 'var(--text-3)' }}>Fehler beim Laden der Statistiken.</div>
      ) : (
        <div className="max-w-5xl mx-auto space-y-6 pb-12">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={<Database className="w-5 h-5" style={{ color: 'var(--orange)' }} />}
              label="Cases"
              value={stats.totalCases}
              color="bg-[#fef3ec]"
            />
            <StatCard
              icon={<Rows3 className="w-5 h-5 text-blue-600" />}
              label="Datensätze"
              value={stats.totalRows.toLocaleString('de-DE')}
              color="bg-blue-50"
            />
            <StatCard
              icon={<Sparkles className="w-5 h-5" style={{ color: 'var(--green)' }} />}
              label="KI-Anreicherungen"
              value={stats.doneCells.toLocaleString('de-DE')}
              sub={stats.totalCells > 0 ? `${completionPct}% abgeschlossen` : undefined}
              color="bg-[#eef8f3]"
            />
            <StatCard
              icon={<DollarSign className="w-5 h-5 text-emerald-600" />}
              label="LLM-Kosten gesamt"
              value={`$${stats.totalCostUsd.toFixed(4)}`}
              color="bg-emerald-50"
            />
          </div>

          {/* Cases Table */}
          <div
            className="rounded-xl overflow-hidden shadow-xs"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-xs)' }}>
              <div>
                <h2 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Alle Cases</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Recherche-Projekte und Fortschritt</p>
              </div>
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--border-xs)' }}>
              {stats.cases.length === 0 ? (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--text-3)' }}>
                  Noch keine Cases vorhanden. Klicke auf "Neuer Case", um zu starten.
                </div>
              ) : (
                stats.cases.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => router.visit(`/cases/${c.id}`)}
                    className="p-4 flex items-center justify-between hover:bg-[#faf9f7] cursor-pointer transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm text-slate-900">{c.name}</div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                        <span>{c.rowCount.toLocaleString('de-DE')} Zeilen</span>
                        <span>•</span>
                        <span>{c.aiColumnCount} KI-Spalten</span>
                        <span>•</span>
                        <span>{new Date(c.updatedAt).toLocaleDateString('de-DE')}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => deleteCase(c.id, e)}
                        className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
