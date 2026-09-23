import React, { useState, useEffect } from 'react';
import { Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import EvaluationCard, { EvaluationRun } from '@/Components/EvaluationCard';
import { 
  ArrowLeft, Sparkles, CheckCircle, RefreshCw, UploadCloud, AlertCircle, 
  RotateCcw, ExternalLink, ShieldCheck, HelpCircle, History, Columns, X, Eye, EyeOff
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
  const [viewMode, setViewMode] = useState<'table' | 'compare'>('table');
  const [selectedRawCols, setSelectedRawCols] = useState<string[]>([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Initialisieren aller Spalten aus den Rohdaten der Zeilen
  useEffect(() => {
    if (rows.length > 0 && selectedRawCols.length === 0) {
      const keys = new Set<string>();
      rows.forEach(r => {
        Object.keys(r.raw_data || {}).forEach(k => keys.add(k));
      });
      setSelectedRawCols(Array.from(keys));
    }
  }, [rows]);

  const allAvailableCols = React.useMemo(() => {
    const keys = new Set<string>();
    rows.forEach(r => {
      Object.keys(r.raw_data || {}).forEach(k => keys.add(k));
    });
    return Array.from(keys);
  }, [rows]);

  const removeColumn = (colToRemove: string) => {
    setSelectedRawCols(prev => prev.filter(c => c !== colToRemove));
  };

  const toggleColumn = (col: string) => {
    setSelectedRawCols(prev => 
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const selectAllColumns = () => {
    setSelectedRawCols(allAvailableCols);
  };

  const deselectAllColumns = () => {
    setSelectedRawCols([]);
  };

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

        {/* Data Table */}
        <div className="bg-white border border-gray-200/80 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                Tabellen-Ansicht ({rows.length} Zeilen)
              </h3>
              <div className="flex items-center bg-gray-200/70 p-0.5 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    viewMode === 'table'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  📊 Multi-Spalten Tabelle (Case-Look)
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('compare')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    viewMode === 'compare'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  🔍 Extraktions-Inspektor
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowColumnPicker(!showColumnPicker)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                  showColumnPicker 
                    ? 'bg-amber-50 border-amber-300 text-amber-800' 
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
                title="Spalten konfigurieren"
              >
                <Columns className="w-3.5 h-3.5 text-gray-500" />
                <span>Spalten ({selectedRawCols.length}/{allAvailableCols.length})</span>
              </button>

              <input
                type="text"
                placeholder="In Zeilen suchen..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 w-48 focus:ring-1 focus:ring-amber-500 focus:outline-hidden bg-white"
              />
              <button
                onClick={fetchBatchData}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-md hover:bg-gray-100 transition-colors"
                title="Aktualisieren"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Column Picker Drawer / Popover */}
          {showColumnPicker && (
            <div className="p-3 bg-amber-50/40 border-b border-amber-100/80 text-xs">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                  <Columns className="w-3.5 h-3.5 text-amber-600" />
                  Sichtbare Quell-Spalten anpassen:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllColumns}
                    className="text-[11px] text-amber-700 hover:underline"
                  >
                    Alle auswählen
                  </button>
                  <span className="text-gray-300">•</span>
                  <button
                    type="button"
                    onClick={deselectAllColumns}
                    className="text-[11px] text-gray-500 hover:underline"
                  >
                    Keine
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                {allAvailableCols.map(col => {
                  const active = selectedRawCols.includes(col);
                  return (
                    <button
                      key={col}
                      type="button"
                      onClick={() => toggleColumn(col)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all border flex items-center gap-1 ${
                        active
                          ? 'bg-amber-100 text-amber-900 border-amber-300 shadow-2xs'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 opacity-60'
                      }`}
                    >
                      {col}
                      {active ? (
                        <Eye className="w-2.5 h-2.5 text-amber-700" />
                      ) : (
                        <EyeOff className="w-2.5 h-2.5 text-gray-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode === 'table' ? (
            <div className="overflow-x-auto max-h-[650px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-100/90 text-gray-700 uppercase tracking-wider text-[10px] sticky top-0 z-10 border-b border-gray-200 shadow-2xs">
                  <tr>
                    <th className="py-2.5 px-3 w-12 text-center font-bold">#</th>
                    {selectedRawCols.map(col => (
                      <th key={col} className="py-2.5 px-3 font-semibold border-r border-gray-200/60 whitespace-nowrap group">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[11px]">{col}</span>
                          <button
                            type="button"
                            onClick={() => removeColumn(col)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-red-500 transition-all"
                            title={`Spalte "${col}" ausblenden`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                    ))}
                    {/* Phase 1: Company Columns */}
                    <th className="py-2.5 px-3 font-semibold text-emerald-800 bg-emerald-100/70 border-r border-emerald-200 whitespace-nowrap">
                      🏢 Brand / Firma
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-emerald-800 bg-emerald-50/70 border-r border-emerald-200 whitespace-nowrap">
                      🌐 Domain
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-emerald-800 bg-emerald-50/70 border-r border-emerald-200 whitespace-nowrap">
                      📍 Ort / Land
                    </th>
                    {/* Phase 2: Contact Columns */}
                    <th className="py-2.5 px-3 font-semibold text-indigo-800 bg-indigo-100/70 border-r border-indigo-200 whitespace-nowrap">
                      👤 Ansprechpartner
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-indigo-800 bg-indigo-50/70 border-r border-indigo-200 whitespace-nowrap">
                      💼 Position
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-indigo-800 bg-indigo-50/70 whitespace-nowrap">
                      ✉️ E-Mail / Kontakt
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-sans">
                  {rows
                    .filter(r => {
                      if (!searchQuery.trim()) return true;
                      const q = searchQuery.toLowerCase();
                      const rawVals = Object.values(r.raw_data || {}).join(' ').toLowerCase();
                      return rawVals.includes(q);
                    })
                    .map(row => {
                      const comp = row.normalized_data?.company_fields || {};
                      const cont = row.normalized_data?.contact_fields || {};
                      const hasComp = !!(comp.company_name || comp.brand_name || comp.domain);
                      const hasCont = !!(cont.first_name || cont.last_name || cont.email);
                      return (
                        <tr key={row.id} className="hover:bg-amber-50/20 transition-colors">
                          <td className="py-2 px-3 text-center text-gray-400 font-mono text-[10px]">
                            {row.source_row_index + 1}
                          </td>
                          {selectedRawCols.map(col => {
                            const val = row.raw_data?.[col];
                            const isEmpty = val === null || val === undefined || String(val).trim() === '' || String(val).toLowerCase() === 'null';
                            return (
                              <td key={col} className="py-2 px-3 border-r border-gray-100 max-w-xs truncate text-[11px] text-gray-800">
                                {isEmpty ? <span className="text-gray-300">–</span> : String(val)}
                              </td>
                            );
                          })}
                          
                          {/* Company: Brand / Firma */}
                          <td className="py-2 px-3 border-r border-emerald-100 bg-emerald-50/30 text-[11px]">
                            {hasComp ? (
                              <div className="flex flex-col">
                                <span className="font-semibold text-emerald-950 truncate">
                                  {comp.brand_name || comp.company_name}
                                </span>
                                {comp.legal_form && (
                                  <span className="text-[9px] text-emerald-700 bg-emerald-100/60 rounded px-1 py-0.2 w-fit mt-0.5">
                                    {comp.legal_form}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Company: Domain */}
                          <td className="py-2 px-3 border-r border-emerald-100 bg-emerald-50/30 text-[11px]">
                            {comp.domain ? (
                              <span className="font-mono text-emerald-800 font-medium">
                                {comp.domain}
                              </span>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Company: Ort / Land */}
                          <td className="py-2 px-3 border-r border-emerald-100 bg-emerald-50/30 text-[11px] text-gray-700">
                            {comp.city || comp.country ? (
                              <span>{[comp.zip, comp.city, comp.country].filter(Boolean).join(' ')}</span>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Contact: Person */}
                          <td className="py-2 px-3 border-r border-indigo-100 bg-indigo-50/30 text-[11px]">
                            {hasCont && (cont.first_name || cont.last_name) ? (
                              <div className="font-semibold text-indigo-950 truncate flex items-center gap-1">
                                {cont.salutation && <span className="text-indigo-600 font-normal text-[10px]">{cont.salutation}</span>}
                                <span>{`${cont.first_name || ''} ${cont.last_name || ''}`.trim()}</span>
                              </div>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Contact: Position */}
                          <td className="py-2 px-3 border-r border-indigo-100 bg-indigo-50/30 text-[11px] text-indigo-900 truncate max-w-[140px]">
                            {cont.position || <span className="text-gray-300 italic text-[10px]">–</span>}
                          </td>

                          {/* Contact: Email / Kontakt */}
                          <td className="py-2 px-3 bg-indigo-50/30 text-[11px]">
                            {cont.email || cont.phone_direct ? (
                              <div className="flex flex-col text-[10px]">
                                {cont.email && <span className="text-indigo-700 font-mono">{cont.email}</span>}
                                {cont.phone_direct && <span className="text-gray-500 font-mono">{cont.phone_direct}</span>}
                              </div>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[650px]">
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
          )}
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
