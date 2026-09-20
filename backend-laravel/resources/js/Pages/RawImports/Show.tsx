import React, { useState, useEffect } from 'react';
import { Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import EvaluationCard, { EvaluationRun } from '@/Components/EvaluationCard';
import { 
  ArrowLeft, Sparkles, CheckCircle, RefreshCw, UploadCloud, AlertCircle, 
  RotateCcw, ExternalLink, ShieldCheck, HelpCircle, History
} from 'lucide-react';

interface BatchDetailProps {
  batchId: string;
}

interface Batch {
  id: string;
  label: string;
  case_id: string | null;
  status: 'pending' | 'normalizing' | 'normalized' | 'promoted' | 'error';
  total_rows: number;
  normalized_rows: number;
  promoted_rows: number;
  schema_type: string | null;
  case?: { id: string; name: string };
}

interface RawRow {
  id: string;
  source_row_index: number;
  raw_data: Record<string, any>;
  normalized_data: {
    company_fields?: Record<string, any>;
    contact_fields?: Record<string, any>;
    extra?: Record<string, any>;
  } | null;
  status: string;
  confidence_score: number | null;
  ai_notes: string | null;
}

interface CaseItem {
  id: string;
  name: string;
}

export default function RawImportsShow({ batchId }: BatchDetailProps) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [stats, setStats] = useState({ conf_low: 0, conf_mid: 0, conf_high: 0 });
  const [loading, setLoading] = useState(true);
  const [normalizing, setNormalizing] = useState(false);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [samplePercent, setSamplePercent] = useState<number>(10);
  const [latestEvalRun, setLatestEvalRun] = useState<EvaluationRun | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);

  const fetchBatchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}`);
      if (res.ok) {
        const data = await res.json();
        setBatch(data.batch);
        setRows(data.rows.data || []);
        setStats(data.stats || { conf_low: 0, conf_mid: 0, conf_high: 0 });
        if (data.batch.case_id) {
          setSelectedCaseId(data.batch.case_id);
        }
      }

      // Load latest evaluation run if any
      const evalRes = await fetch(`/api/raw-imports/${batchId}/evaluations`);
      if (evalRes.ok) {
        const evals: EvaluationRun[] = await evalRes.json();
        if (evals.length > 0) {
          setLatestEvalRun(evals[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatchData();
    fetch('/api/cases')
      .then((r) => (r.ok ? r.json() : []))
      .then((c) => {
        if (Array.isArray(c)) {
          setCases(c);
          if (!selectedCaseId && c.length > 0) setSelectedCaseId(c[0].id);
        }
      })
      .catch(() => {});
  }, [batchId]);

  const handleNormalize = async (pct: number) => {
    // If it's a sample run (< 100%), run via evaluate endpoint to get full quality report & hallucination check
    if (pct < 100) {
      setEvalLoading(true);
      try {
        const res = await fetch(`/api/raw-imports/${batchId}/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sample_percent: pct }),
        });
        if (res.ok) {
          const data = await res.json();
          setLatestEvalRun(data.run);
          await fetchBatchData();
        }
      } catch (e) {
        console.error(e);
      } finally {
        setEvalLoading(false);
      }
      return;
    }

    setNormalizing(true);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}/normalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_percent: pct }),
      });
      if (res.ok) {
        await fetchBatchData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setNormalizing(false);
    }
  };

  const handlePromote = async () => {
    if (!selectedCaseId) {
      alert('Bitte wähle einen Case aus.');
      return;
    }
    setPromoteLoading(true);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: selectedCaseId,
          import_companies: true,
          import_contacts: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowPromoteModal(false);
        await fetchBatchData();
        alert(data.message || 'Erfolgreich übertragen!');
      } else {
        alert(data.message || 'Fehler beim Übertragen.');
      }
    } catch (e) {
      console.error(e);
      alert('Fehler beim Übertragen.');
    } finally {
      setPromoteLoading(false);
    }
  };

  const handleRollback = async () => {
    if (!confirm('Möchtest du die übertragenen Firmen und Kontakte aus dem Case wieder entfernen?')) return;
    setRollbackLoading(true);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}/rollback`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchBatchData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRollbackLoading(false);
    }
  };

  if (loading && !batch) {
    return (
      <AppLayout title="Batch Details">
        <div className="p-8 text-center text-xs text-gray-400">Lade Batch-Details…</div>
      </AppLayout>
    );
  }

  if (!batch) {
    return (
      <AppLayout title="Batch nicht gefunden">
        <div className="p-8 text-center space-y-2">
          <p className="text-sm text-gray-600">Batch existiert nicht.</p>
          <Link href="/raw-imports" className="text-xs text-amber-600 underline">
            Zurück zur Übersicht
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title={`Batch: ${batch.label}`}
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/raw-imports"
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Zurück</span>
          </Link>
        </div>
      }
    >
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Top Control Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Batch Info */}
          <div className="bg-white border border-gray-200/80 rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Batch Info
              </div>
              <h2 className="text-sm font-semibold text-gray-900 truncate" title={batch.label}>
                {batch.label}
              </h2>
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                <span>{batch.total_rows.toLocaleString()} Rohzeilen</span>
                <span>•</span>
                <span className="font-mono text-[11px] uppercase bg-gray-100 px-1.5 py-0.5 rounded">
                  {batch.schema_type || 'Unbekannt'}
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
              <span className="text-gray-500">Status:</span>
              <span className="font-medium text-gray-800 capitalize">{batch.status}</span>
            </div>
          </div>

          {/* Card 2: AI Normalization Engine */}
          <div className="bg-white border border-gray-200/80 rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>KI-Normalisierung</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                Trennt Personen von Firmen, korrigiert Formatierungen &amp; ordnet Felder strukturiert zu.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={samplePercent}
                  onChange={(e) => setSamplePercent(Number(e.target.value))}
                  className="text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none"
                  disabled={normalizing}
                >
                  <option value={10}>10% Test-Stichprobe</option>
                  <option value={25}>25% Stichprobe</option>
                  <option value={50}>50% Stichprobe</option>
                  <option value={100}>100% (Alle Zeilen)</option>
                </select>

                <button
                  onClick={() => handleNormalize(samplePercent)}
                  disabled={normalizing}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{normalizing ? 'Analysiert…' : 'Starten'}</span>
                </button>
              </div>

              <div className="text-[10px] text-gray-400 text-right">
                Normalisiert: {batch.normalized_rows} / {batch.total_rows}
              </div>
            </div>
          </div>

          {/* Card 3: Promotion / Transfer */}
          <div className="bg-white border border-gray-200/80 rounded-xl p-4 shadow-sm flex flex-col justify-between">
            <div>
              <div className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>In Case übertragen</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">
                Schreibt Firmen in die Firmen-Tabelle und Kontakte verknüpft in die Kontakt-Tabelle deines Cases.
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2">
              {batch.status === 'promoted' ? (
                <div className="w-full flex items-center justify-between">
                  <span className="text-xs text-purple-700 font-medium">
                    ✓ Übertragen ({batch.promoted_rows})
                  </span>
                  <button
                    onClick={handleRollback}
                    disabled={rollbackLoading}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 border border-red-200 rounded transition-colors"
                    title="Übertragung rückgängig machen"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{rollbackLoading ? 'Löscht…' : 'Rollback'}</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowPromoteModal(true)}
                  disabled={batch.normalized_rows === 0}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Jetzt in Case übertragen</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Evaluation Card (Shown after sample run) */}
        <EvaluationCard
          run={latestEvalRun}
          loading={evalLoading}
          onOpenPromptEditor={() => router.visit('/settings/prompts')}
          onRunFullNormalize={() => handleNormalize(100)}
          fullNormalizeLoading={normalizing}
        />

        {/* Confidence Stats Indicator */}
        {batch.normalized_rows > 0 && (
          <div className="bg-white border border-gray-200/80 rounded-xl p-3.5 shadow-sm flex items-center gap-6 text-xs">
            <span className="font-semibold text-gray-700 text-[11px] uppercase tracking-wider">
              Konfidenz-Verteilung:
            </span>
            <div className="flex items-center gap-1.5 text-green-700">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
              <span>Hoch (&gt;85%): {stats.conf_high}</span>
            </div>
            <div className="flex items-center gap-1.5 text-amber-700">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
              <span>Mittel (60-85%): {stats.conf_mid}</span>
            </div>
            <div className="flex items-center gap-1.5 text-red-700">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
              <span>Prüfung nötig (&lt;60%): {stats.conf_low}</span>
            </div>
          </div>
        )}

        {/* Side-by-Side Data Table */}
        <div className="bg-white border border-gray-200/80 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Datensatz-Vorschau ({rows.length} geladene Zeilen)
            </h3>
            <button
              onClick={fetchBatchData}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-md transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100 text-[11px] font-medium text-gray-500">
                  <th className="py-2 px-3 w-12 text-center">#</th>
                  <th className="py-2 px-3 w-1/3 border-r border-gray-100">
                    Unveränderte Rohdaten (Original CSV)
                  </th>
                  <th className="py-2 px-3 w-1/3 border-r border-gray-100">
                    Extrahierte Firmendaten (Company)
                  </th>
                  <th className="py-2 px-3 w-1/3">Extrahierte Kontaktdaten (Person)</th>
                  <th className="py-2 px-2 text-right">Konfidenz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  const conf = row.confidence_score;
                  const isLowConf = conf !== null && conf < 0.6;
                  const comp = row.normalized_data?.company_fields || {};
                  const cont = row.normalized_data?.contact_fields || {};

                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-gray-50/60 transition-colors ${
                        isLowConf ? 'bg-red-50/20 border-l-2 border-red-500' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center text-gray-400 font-mono text-[10px]">
                        {row.source_row_index + 1}
                      </td>

                      {/* Raw Data */}
                      <td className="py-2.5 px-3 border-r border-gray-100 bg-gray-50/30">
                        <div className="space-y-0.5 max-h-24 overflow-y-auto font-mono text-[10px] text-gray-600">
                          {Object.entries(row.raw_data || {}).map(([k, v]) => (
                            <div key={k} className="truncate">
                              <span className="text-gray-400 font-medium">{k}:</span> {String(v)}
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Extracted Company Data */}
                      <td className="py-2.5 px-3 border-r border-gray-100">
                        {row.normalized_data ? (
                          <div className="space-y-0.5 max-h-24 overflow-y-auto text-[11px]">
                            {comp.company_name && (
                              <div className="font-semibold text-gray-900 truncate">
                                🏢 {comp.company_name}
                              </div>
                            )}
                            {comp.domain && (
                              <div className="text-blue-600 truncate">🌐 {comp.domain}</div>
                            )}
                            {(comp.city || comp.zip) && (
                              <div className="text-gray-500 text-[10px] truncate">
                                📍 {comp.zip} {comp.city}
                              </div>
                            )}
                            {comp.phone && (
                              <div className="text-gray-500 text-[10px] truncate">📞 {comp.phone}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-[10px] italic">Noch nicht normalisiert</span>
                        )}
                      </td>

                      {/* Extracted Contact Data */}
                      <td className="py-2.5 px-3">
                        {row.normalized_data ? (
                          <div className="space-y-0.5 max-h-24 overflow-y-auto text-[11px]">
                            {(cont.first_name || cont.last_name) && (
                              <div className="font-semibold text-gray-900 truncate">
                                👤 {cont.first_name} {cont.last_name}
                              </div>
                            )}
                            {cont.position && (
                              <div className="text-gray-500 text-[10px] truncate">
                                💼 {cont.position}
                              </div>
                            )}
                            {cont.email && (
                              <div className="text-purple-600 truncate text-[10px]">
                                ✉️ {cont.email}
                              </div>
                            )}
                            {cont.phone_direct && (
                              <div className="text-gray-500 text-[10px] truncate">
                                📱 {cont.phone_direct}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-[10px] italic">Noch nicht normalisiert</span>
                        )}
                      </td>

                      {/* Confidence badge */}
                      <td className="py-2.5 px-2 text-right">
                        {conf !== null ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                              conf >= 0.85
                                ? 'bg-green-100 text-green-800'
                                : conf >= 0.6
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {(conf * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-gray-300 text-[10px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Promote Modal */}
      {showPromoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-gray-100 p-5 space-y-4">
            <h3 className="font-semibold text-sm text-gray-900">In Case übertragen</h3>
            <p className="text-xs text-gray-600">
              Wähle den Ziel-Case aus. Normalisierte Firmen werden in die Haupttabelle eingetragen,
              Kontakte werden automatisch als Kontaktpersonen verknüpft.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Ziel-Case</label>
              <select
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none"
                value={selectedCaseId}
                onChange={(e) => setSelectedCaseId(e.target.value)}
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPromoteModal(false)}
                className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handlePromote}
                disabled={promoteLoading || !selectedCaseId}
                className="px-4 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50"
              >
                {promoteLoading ? 'Wird übertragen…' : 'Übertragen starten'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
