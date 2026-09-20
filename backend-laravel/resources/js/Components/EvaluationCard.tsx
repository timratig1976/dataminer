import React, { useState } from 'react';
import { 
  Sparkles, CheckCircle, AlertTriangle, ChevronDown, ChevronUp, ExternalLink, ArrowRight, ShieldCheck 
} from 'lucide-react';

export interface EvaluationRun {
  id: string;
  import_batch_id: string;
  sample_percent: number;
  rows_processed: number;
  rows_normalized: number;
  rows_error: number;
  avg_confidence: number | null;
  conf_high_count: number;
  conf_mid_count: number;
  conf_low_count: number;
  hallucination_flags: Array<{
    row_id: string;
    row_index: number;
    field: string;
    invented_value: string;
  }>;
  duration_ms: number | null;
  created_at: string;
  prompt?: {
    id: string;
    name: string;
    version: number;
  };
}

interface EvaluationCardProps {
  run: EvaluationRun | null;
  loading: boolean;
  onOpenPromptEditor: () => void;
  onRunFullNormalize: () => void;
  fullNormalizeLoading: boolean;
}

export default function EvaluationCard({
  run,
  loading,
  onOpenPromptEditor,
  onRunFullNormalize,
  fullNormalizeLoading,
}: EvaluationCardProps) {
  const [showFlags, setShowFlags] = useState(false);

  if (loading) {
    return (
      <div className="bg-amber-50/40 border border-amber-200 rounded-xl p-5 text-center space-y-2">
        <Sparkles className="w-5 h-5 mx-auto text-amber-600 animate-spin" />
        <p className="text-xs text-amber-800 font-medium">10%-Evaluation läuft…</p>
        <p className="text-[11px] text-amber-600">Stichprobe wird analysiert und auf Halluzinationen geprüft.</p>
      </div>
    );
  }

  if (!run) return null;

  const total = run.rows_processed || 1;
  const highPct = Math.round((run.conf_high_count / total) * 100);
  const midPct = Math.round((run.conf_mid_count / total) * 100);
  const lowPct = Math.round((run.conf_low_count / total) * 100);
  const hasHallucinations = (run.hallucination_flags || []).length > 0;

  return (
    <div className="bg-white border border-gray-200/90 rounded-xl shadow-xs overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
        <div className="flex items-center gap-2">
          <span className="p-1.5 bg-amber-100 text-amber-700 rounded-md">
            <Sparkles className="w-4 h-4" />
          </span>
          <div>
            <h4 className="text-xs font-semibold text-gray-900">
              Evaluation-Ergebnis ({run.sample_percent}% Stichprobe — {run.rows_processed} Zeilen)
            </h4>
            <p className="text-[11px] text-gray-500">
              Verwendeter Prompt: <span className="font-medium text-gray-700">{run.prompt?.name || 'Standard'} (v{run.prompt?.version || '2'})</span>
              {run.duration_ms && ` • Dauer: ${(run.duration_ms / 1000).toFixed(1)}s`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenPromptEditor}
            className="px-2.5 py-1 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors"
          >
            Prompt anpassen
          </button>
          <button
            onClick={onRunFullNormalize}
            disabled={fullNormalizeLoading}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md shadow-xs transition-colors disabled:opacity-50"
          >
            <span>{fullNormalizeLoading ? 'Läuft…' : 'Alle 100% normalisieren'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Score & Distribution Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
            <div className="text-[10px] text-gray-400 uppercase font-medium">Ø Konfidenz</div>
            <div className="text-lg font-bold text-gray-900 mt-0.5">
              {run.avg_confidence ? `${(run.avg_confidence * 100).toFixed(1)}%` : '—'}
            </div>
            <div className="text-[10px] text-gray-500 mt-1">
              {run.avg_confidence && run.avg_confidence >= 0.8 ? '✓ Sehr gute Qualität' : '⚠ Prompt nachbessern empfohlen'}
            </div>
          </div>

          <div className="p-3 bg-green-50/50 rounded-lg border border-green-100">
            <div className="text-[10px] text-green-700 uppercase font-medium">Hohe Konfidenz (≥75%)</div>
            <div className="text-lg font-bold text-green-800 mt-0.5">{run.conf_high_count} Zeilen</div>
            <div className="text-[10px] text-green-600 mt-1">{highPct}% der Stichprobe</div>
          </div>

          <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
            <div className="text-[10px] text-amber-700 uppercase font-medium">Mittlere Konfidenz</div>
            <div className="text-lg font-bold text-amber-800 mt-0.5">{run.conf_mid_count} Zeilen</div>
            <div className="text-[10px] text-amber-600 mt-1">{midPct}% (60% - 75%)</div>
          </div>

          <div className={`p-3 rounded-lg border ${hasHallucinations ? 'bg-red-50/60 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
            <div className={`text-[10px] uppercase font-medium ${hasHallucinations ? 'text-red-700' : 'text-gray-400'}`}>
              Halluzinations-Verdacht
            </div>
            <div className={`text-lg font-bold mt-0.5 ${hasHallucinations ? 'text-red-700' : 'text-gray-700'}`}>
              {run.hallucination_flags?.length || 0} Felder
            </div>
            <div className={`text-[10px] mt-1 ${hasHallucinations ? 'text-red-600' : 'text-gray-500'}`}>
              {hasHallucinations ? '⚠ Wert nicht in Rohdaten gefunden!' : '✓ Keine erfundenen Werte'}
            </div>
          </div>
        </div>

        {/* Hallucination Inspection Dropdown */}
        {hasHallucinations && (
          <div className="border border-red-200 rounded-lg overflow-hidden bg-red-50/20">
            <button
              onClick={() => setShowFlags(!showFlags)}
              className="w-full flex items-center justify-between px-3.5 py-2 text-xs text-red-800 font-medium hover:bg-red-50/50 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                <span>{run.hallucination_flags.length} geflaggte Felder ansehen (Werte ohne Entsprechung in den Rohdaten)</span>
              </div>
              {showFlags ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showFlags && (
              <div className="p-3 border-t border-red-100 bg-white max-h-48 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-100">
                      <th className="pb-1">Zeile</th>
                      <th className="pb-1">Feld</th>
                      <th className="pb-1">Extrahierter / Erfundener Wert</th>
                      <th className="pb-1">Hinweis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {run.hallucination_flags.map((flag, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="py-1 font-mono text-gray-500">#{flag.row_index}</td>
                        <td className="py-1 font-medium text-gray-800">{flag.field}</td>
                        <td className="py-1 font-mono text-red-600 max-w-[200px] truncate">
                          "{flag.invented_value}"
                        </td>
                        <td className="py-1 text-gray-400 text-[10px]">
                          Nicht in den Eingabedaten dieser Zeile enthalten
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
