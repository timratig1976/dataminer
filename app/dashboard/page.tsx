"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database, Rows3, Sparkles, CheckCircle2, XCircle,
  DollarSign, ArrowRight, Plus, TrendingUp, Loader2,
  LayoutDashboard, Trash2,
} from "lucide-react";
import AppShell from "@/components/AppShell";

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
      className="p-5 flex items-start gap-4"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold leading-tight" style={{ color: "var(--text-1)" }}>{value}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text-2)" }}>{label}</div>
        {sub && <div className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>{sub}</div>}
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

  async function deleteCase(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Case und alle Daten wirklich löschen?")) return;
    await fetch(`/api/cases/${id}`, { method: "DELETE" });
    setStats((prev) => prev ? { ...prev, cases: prev.cases.filter((c) => c.id !== id), totalCases: prev.totalCases - 1 } : prev);
  }

  const completionPct = stats && stats.totalCells > 0
    ? Math.round((stats.doneCells / stats.totalCells) * 100)
    : 0;

  return (
    <AppShell
      title="Dashboard"
      titleIcon={<LayoutDashboard className="w-4 h-4" style={{ color: "var(--orange)" }} />}
      actions={
        <button
          onClick={() => router.push("/cases")}
          className="btn-v2 btn-v2-primary"
        >
          <Plus className="w-3.5 h-3.5" />
          Neuer Case
        </button>
      }
    >
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--orange)" }} />
            </div>
          ) : !stats ? (
            <div className="text-sm text-center mt-20" style={{ color: "var(--text-3)" }}>Fehler beim Laden der Statistiken.</div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-6">

              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={<Database className="w-5 h-5" style={{ color: "var(--orange)" }} />}
                  label="Cases"
                  value={stats.totalCases}
                  color="bg-[#fef3ec]"
                />
                <StatCard
                  icon={<Rows3 className="w-5 h-5 text-blue-600" />}
                  label="Datensätze"
                  value={stats.totalRows.toLocaleString("de-DE")}
                  color="bg-blue-50"
                />
                <StatCard
                  icon={<CheckCircle2 className="w-5 h-5" style={{ color: "var(--green)" }} />}
                  label="Zellen fertig"
                  value={stats.doneCells.toLocaleString("de-DE")}
                  sub={stats.totalCells > 0 ? `${completionPct}% von ${stats.totalCells.toLocaleString("de-DE")}` : undefined}
                  color="bg-[#eef8f3]"
                />
                <StatCard
                  icon={<DollarSign className="w-5 h-5 text-amber-600" />}
                  label="API-Kosten"
                  value={stats.totalCostUsd > 0 ? `$${stats.totalCostUsd.toFixed(4)}` : "—"}
                  sub="Provider erfasst"
                  color="bg-amber-50"
                />
              </div>

              {/* Progress bar */}
              {stats.totalCells > 0 && (
                <div
                  className="p-5"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" style={{ color: "var(--orange)" }} />
                      <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Gesamtfortschritt</span>
                    </div>
                    <span className="text-sm font-bold" style={{ color: "var(--orange)" }}>{completionPct}%</span>
                  </div>
                  <div className="w-full rounded-full h-2" style={{ background: "var(--border-xs)" }}>
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{ width: `${completionPct}%`, background: "var(--orange)" }}
                    />
                  </div>
                  <div className="flex gap-4 mt-3 text-xs" style={{ color: "var(--text-3)" }}>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: "var(--green)" }} />
                      {stats.doneCells} fertig
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: "var(--danger)" }} />
                      {stats.errorCells} Fehler
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: "var(--border)" }} />
                      {stats.totalCells - stats.doneCells - stats.errorCells} offen
                    </span>
                  </div>
                </div>
              )}

              {/* Cases table */}
              <div
                className="overflow-hidden"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border-xs)" }}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" style={{ color: "var(--orange)" }} />
                    <span className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Cases Übersicht</span>
                  </div>
                  <button
                    onClick={() => router.push("/cases")}
                    className="text-xs font-medium flex items-center gap-1 cursor-pointer"
                    style={{ color: "var(--orange)" }}
                  >
                    Alle anzeigen <ArrowRight className="w-3 h-3" />
                  </button>
                </div>

                {stats.cases.length === 0 ? (
                  <div className="text-center py-16" style={{ color: "var(--text-3)" }}>
                    <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Noch keine Cases. <button onClick={() => router.push("/cases")} className="underline cursor-pointer" style={{ color: "var(--orange)" }}>Ersten Case erstellen</button></p>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                        <th className="text-left px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Case</th>
                        <th className="text-right px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Zeilen</th>
                        <th className="text-right px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>KI-Spalten</th>
                        <th className="text-right px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Fertig</th>
                        <th className="text-right px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Fehler</th>
                        <th className="text-right px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Kosten</th>
                        <th className="text-right px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Aktualisiert</th>
                        <th className="px-4 py-2.5" />
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
                            className="cursor-pointer transition-colors"
                            style={{
                              borderBottom: i !== stats.cases.length - 1 ? "1px solid var(--border-xs)" : "none",
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2.5">
                                <div
                                  className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold shrink-0"
                                  style={{ background: "var(--orange-soft)", color: "var(--orange)" }}
                                >
                                  {c.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="font-medium truncate max-w-[200px]" style={{ color: "var(--text-1)" }}>{c.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right" style={{ color: "var(--text-2)" }}>{c.rowCount.toLocaleString("de-DE")}</td>
                            <td className="px-4 py-3 text-right" style={{ color: "var(--green)", fontWeight: 500 }}>{c.aiColumnCount}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <div className="w-14 rounded-full h-1.5" style={{ background: "var(--border-xs)" }}>
                                  <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--green)" }} />
                                </div>
                                <span className="font-mono text-[11px]" style={{ color: "var(--text-2)" }}>{pct}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {c.errorCells > 0 ? (
                                <span className="font-mono text-[11px]" style={{ color: "var(--danger)" }}>{c.errorCells}</span>
                              ) : (
                                <span style={{ color: "var(--text-3)" }}>—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[11px]" style={{ color: "var(--text-2)" }}>
                              {c.costUsd > 0 ? `$${c.costUsd.toFixed(4)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-[11px]" style={{ color: "var(--text-3)" }}>
                              {new Date(c.updatedAt).toLocaleDateString("de-DE")}
                            </td>
                            <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={e => deleteCase(c.id, e)}
                                title="Case löschen"
                                className="p-1 rounded opacity-40 hover:opacity-100 transition-opacity cursor-pointer"
                                style={{ color: "var(--danger)" }}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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
    </AppShell>
  );
}
