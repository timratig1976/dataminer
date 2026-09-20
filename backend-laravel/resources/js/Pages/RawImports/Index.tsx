import React, { useState, useEffect } from 'react';
import { Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import RawUploadModal from '@/Components/RawUploadModal';
import { 
  DatabaseZap, Plus, Sparkles, ArrowRight, Trash2, CheckCircle2, Clock, AlertTriangle, RefreshCw
} from 'lucide-react';

interface Batch {
  id: string;
  label: string;
  case_id: string | null;
  status: 'pending' | 'normalizing' | 'normalized' | 'promoted' | 'error';
  total_rows: number;
  normalized_rows: number;
  promoted_rows: number;
  schema_type: string | null;
  created_at: string;
  case?: { id: string; name: string };
}

export default function RawImportsIndex() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [normalizingId, setNormalizingId] = useState<string | null>(null);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/raw-imports');
      if (res.ok) {
        const data = await res.json();
        setBatches(data.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  const handleNormalize = async (batchId: string, samplePercent: number = 10) => {
    setNormalizingId(batchId);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}/normalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_percent: samplePercent }),
      });
      if (res.ok) {
        await fetchBatches();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setNormalizingId(null);
    }
  };

  const handleDelete = async (batchId: string) => {
    if (!confirm('Diesen Batch und alle zugehörigen Rohdaten wirklich löschen?')) return;
    try {
      const res = await fetch(`/api/raw-imports/${batchId}`, { method: 'DELETE' });
      if (res.ok) {
        setBatches((prev) => prev.filter((b) => b.id !== batchId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getStatusBadge = (b: Batch) => {
    switch (b.status) {
      case 'promoted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            <CheckCircle2 className="w-3 h-3" /> In Case übertragen ({b.promoted_rows})
          </span>
        );
      case 'normalized':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-50 text-green-700 border border-green-200">
            <CheckCircle2 className="w-3 h-3" /> Normalisiert ({b.normalized_rows}/{b.total_rows})
          </span>
        );
      case 'normalizing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" /> KI analysiert…
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
            <AlertTriangle className="w-3 h-3" /> Fehler
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-50 text-gray-600 border border-gray-200">
            <Clock className="w-3 h-3" /> Rohdaten bereit
          </span>
        );
    }
  };

  return (
    <AppLayout
      title="Raw Data Manager"
      actions={
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Neuer Batch Upload</span>
        </button>
      }
    >
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header Intro */}
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="p-2.5 bg-amber-600 text-white rounded-lg shadow-sm">
              <DatabaseZap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Rohdaten Staging &amp; KI-Transformation</h2>
              <p className="text-xs text-gray-600 mt-1 max-w-2xl leading-relaxed">
                Lade unstrukturierte Kontakt- oder Firmendateien (CSV/Excel) hier hoch. Deine Originaldaten bleiben stets unverändert gespeichert. 
                Die KI trennt Personen von Firmen, strukturiert Spalten und bereitet die Datensätze für deine Cases vor.
              </p>
            </div>
          </div>
        </div>

        {/* Batches Table */}
        <div className="bg-white border border-gray-200/80 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Import-Batches ({batches.length})
            </h3>
            <button
              onClick={fetchBatches}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-md transition-colors"
              title="Aktualisieren"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-gray-400">Lade Batches…</div>
          ) : batches.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <DatabaseZap className="w-8 h-8 mx-auto text-gray-300" />
              <p className="text-xs text-gray-500 font-medium">Noch keine Rohdaten-Batches vorhanden.</p>
              <button
                onClick={() => setShowUpload(true)}
                className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors"
              >
                Ersten Batch hochladen
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50/60 border-b border-gray-100 text-[11px] font-medium text-gray-500">
                    <th className="py-2.5 px-4">Batch Label</th>
                    <th className="py-2.5 px-4">Datum</th>
                    <th className="py-2.5 px-4">Zeilen</th>
                    <th className="py-2.5 px-4">Erkanntes Schema</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {batches.map((b) => {
                    const isNormalizing = normalizingId === b.id || b.status === 'normalizing';
                    return (
                      <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-medium text-gray-900">
                          <Link
                            href={`/raw-imports/${b.id}`}
                            className="hover:text-amber-600 transition-colors flex items-center gap-1.5"
                          >
                            <span>{b.label}</span>
                            <ArrowRight className="w-3 h-3 text-gray-400" />
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-gray-500">
                          {new Date(b.created_at).toLocaleDateString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3 px-4 text-gray-700 font-mono text-[11px]">
                          {b.total_rows.toLocaleString('de-DE')} Zeilen
                        </td>
                        <td className="py-3 px-4">
                          {b.schema_type ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-gray-100 text-gray-700">
                              {b.schema_type}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">{getStatusBadge(b)}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {b.status === 'pending' && (
                              <button
                                onClick={() => handleNormalize(b.id, 10)}
                                disabled={isNormalizing}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors disabled:opacity-50"
                                title="10% Test-Stichprobe normalisieren"
                              >
                                <Sparkles className="w-3 h-3" />
                                <span>{isNormalizing ? 'Analysiert…' : '10% Test-KI'}</span>
                              </button>
                            )}
                            <Link
                              href={`/raw-imports/${b.id}`}
                              className="px-2.5 py-1 text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                            >
                              Details
                            </Link>
                            <button
                              onClick={() => handleDelete(b.id)}
                              className="p-1 text-gray-400 hover:text-red-600 rounded-md transition-colors"
                              title="Löschen"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
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

      {showUpload && (
        <RawUploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={(newBatchId) => {
            setShowUpload(false);
            router.visit(`/raw-imports/${newBatchId}`);
          }}
        />
      )}
    </AppLayout>
  );
}
