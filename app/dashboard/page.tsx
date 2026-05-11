"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database, Rows3, Sparkles, CheckCircle2, XCircle,
  DollarSign, ArrowRight, Plus, TrendingUp, Loader2,
  LayoutDashboard,
} from "lucide-react";

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
    <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold text-gray-900 leading-tight">{value}</div>
        <div className="text-sm text-gray-500 mt-0.5">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const completionPct = stats && stats.totalCells > 0
    ? Math.round((stats.doneCells / stats.totalCells) * 100)
    : 0;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-violet-600 rounded flex items-center justify-center text-white text-xs font-bold">D</div>
            <span className="font-semibold text-gray-900 text-sm">DataMiner</span>
          </div>
        </div>
        <nav className="flex-1 py-2">
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-violet-700 bg-violet-50 rounded-none text-left"
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => router.push("/cases")}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 text-left"
          >
            <Database className="w-4 h-4" />
            Alle Cases
          </button>
        </nav>
        <div className="px-3 py-2 border-t border-gray-100">
          <div className="text-[11px] text-gray-400">🔑 Global API Key (Fallback)</div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-violet-500" />
            <span className="text-sm font-semibold text-gray-800">Dashboard</span>
          </div>
          <button
            onClick={() => router.push("/cases")}
            className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-violet-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Neuer Case
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            </div>
          ) : !stats ? (
            <div className="text-sm text-gray-400 text-center mt-20">Fehler beim Laden der Statistiken.</div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-8">

              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={<Database className="w-5 h-5 text-violet-600" />}
                  label="Cases"
                  value={stats.totalCases}
                  color="bg-violet-50"
                />
                <StatCard
                  icon={<Rows3 className="w-5 h-5 text-blue-600" />}
                  label="Datensätze"
                  value={stats.totalRows.toLocaleString("de-DE")}
                  color="bg-blue-50"
                />
                <StatCard
                  icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
                  label="Zellen fertig"
                  value={stats.doneCells.toLocaleString("de-DE")}
                  sub={stats.totalCells > 0 ? `${completionPct}% von ${stats.totalCells.toLocaleString("de-DE")}` : undefined}
                  color="bg-green-50"
                />
                <StatCard
                  icon={<DollarSign className="w-5 h-5 text-amber-600" />}
                  label="API-Kosten"
                  value={stats.totalCostUsd > 0 ? `$${stats.totalCostUsd.toFixed(4)}` : "—"}
                  sub="OpenAI (geschätzt)"
                  color="bg-amber-50"
                />
              </div>

              {/* Progress bar */}
              {stats.totalCells > 0 && (
                <div className="bg-white border border-gray-200 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-violet-500" />
                      <span className="text-sm font-semibold text-gray-800">Gesamtfortschritt</span>
                    </div>
                    <span className="text-sm font-bold text-violet-600">{completionPct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2.5">
                    <div
                      className="bg-violet-500 h-2.5 rounded-full transition-all"
                      style={{ width: `${completionPct}%` }}
                    />
                  </div>
                  <div className="flex gap-4 mt-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                      {stats.doneCells} fertig
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                      {stats.errorCells} Fehler
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
                      {stats.totalCells - stats.doneCells - stats.errorCells} offen
                    </span>
                  </div>
                </div>
              )}

              {/* Cases table */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-500" />
                    <span className="text-sm font-semibold text-gray-800">Cases Übersicht</span>
                  </div>
                  <button
                    onClick={() => router.push("/cases")}
                    className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"
                  >
                    Alle anzeigen <ArrowRight className="w-3 h-3" />
                  </button>
                </div>

                {stats.cases.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Noch keine Cases. <button onClick={() => router.push("/cases")} className="text-violet-600 underline">Ersten Case erstellen</button></p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Case</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Zeilen</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">KI-Spalten</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Fertig</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Fehler</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Kosten</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Aktualisiert</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {stats.cases.map((c, i) => {
                        const total = c.rowCount * c.aiColumnCount;
                        const pct = total > 0 ? Math.round((c.doneCells / total) * 100) : 0;
                        return (
                          <tr
                            key={c.id}
                            onClick={() => router.push(`/cases/${c.id}`)}
                            className={`cursor-pointer hover:bg-violet-50 transition-colors ${i !== stats.cases.length - 1 ? "border-b border-gray-100" : ""}`}
                          >
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center text-violet-600 text-xs font-bold shrink-0">
                                  {c.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="font-medium text-gray-900 truncate max-w-[180px]">{c.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right text-gray-600">{c.rowCount.toLocaleString("de-DE")}</td>
                            <td className="px-4 py-3.5 text-right text-gray-600">{c.aiColumnCount}</td>
                            <td className="px-4 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="w-16 bg-gray-100 rounded-full h-1.5">
                                  <div className="bg-green-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-gray-600 text-xs w-8">{pct}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              {c.errorCells > 0
                                ? <span className="text-red-500 font-medium">{c.errorCells}</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3.5 text-right text-gray-500 font-mono text-xs">
                              {c.costUsd > 0 ? `$${c.costUsd.toFixed(4)}` : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3.5 text-right text-gray-400 text-xs">
                              {new Date(c.updatedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "short" })}
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <ArrowRight className="w-3.5 h-3.5 text-gray-300 ml-auto" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
