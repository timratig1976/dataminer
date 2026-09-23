import React, { useState, useEffect } from 'react';
import { Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import EvaluationCard, { EvaluationRun } from '@/Components/EvaluationCard';
import { 
  ArrowLeft, Sparkles, CheckCircle, RefreshCw, UploadCloud, AlertCircle, 
  RotateCcw, ExternalLink, ShieldCheck, HelpCircle, History, Columns, X, Eye, EyeOff,
  GripVertical, PlusCircle, Bot, Loader2, Phone, Hash, Settings, Terminal,
  ChevronLeft, ChevronRight
} from 'lucide-react';

interface BatchDetailProps {
  batchId: string;
}

interface ExecutionLog {
  timestamp: string;
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  message: string;
  context?: Record<string, any>;
}

interface ActivePrompt {
  id: string;
  name: string;
  version: number;
  description: string;
  model: string;
  system_prompt: string;
  user_prompt_template: string;
  temperature: number;
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
  const [includeCustomColsInPromote, setIncludeCustomColsInPromote] = useState(true);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [createNewCaseMode, setCreateNewCaseMode] = useState<boolean>(false);
  const [newCaseName, setNewCaseName] = useState<string>('');
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [activePrompt, setActivePrompt] = useState<ActivePrompt | null>(null);
  const [showPromptDetails, setShowPromptDetails] = useState(false);
  const [samplePercent, setSamplePercent] = useState<number>(10);
  const [evalLoading, setEvalLoading] = useState(false);
  const [latestEvalRun, setLatestEvalRun] = useState<EvaluationRun | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'compare' | 'logs'>('table');
  const [selectedRawCols, setSelectedRawCols] = useState<string[]>([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<{ col: string; startX: number; startWidth: number } | null>(null);

  // Pagination State (identisch zu den Cases)
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [paginationData, setPaginationData] = useState<{
    total: number;
    from: number;
    to: number;
    last_page: number;
  }>({ total: 0, from: 0, to: 0, last_page: 1 });

  // AI Column Generator Modal State
  const [showAiColModal, setShowAiColModal] = useState(false);
  const [aiColName, setAiColName] = useState('');
  const [aiColPrompt, setAiColPrompt] = useState('');
  const [aiColLoading, setAiColLoading] = useState(false);

  // Prompt Editor Modal State
  const [showPromptEditModal, setShowPromptEditModal] = useState(false);
  const [promptEditSystem, setPromptEditSystem] = useState('');
  const [promptEditModel, setPromptEditModel] = useState('openai/gpt-4o');
  const [promptEditTemp, setPromptEditTemp] = useState(0.0);
  const [savingPrompt, setSavingPrompt] = useState(false);

  // Live / Persistent Log Console State
  const [showLogDrawer, setShowLogDrawer] = useState(false);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Helper for priority sorting of raw columns (Company info first, then Contact, then extra)
  const sortRawColumnsLogically = (cols: string[]) => {
    const priorityScore = (colName: string): number => {
      const k = colName.toLowerCase();
      if (k.includes('firma') || k.includes('company') || k.includes('name') || k.includes('unternehmensname')) return 10;
      if (k.includes('website') || k.includes('domain') || k.includes('web') || k.includes('url')) return 20;
      if (k.includes('ort') || k.includes('stadt') || k.includes('city') || k.includes('plz')) return 30;
      if (k.includes('telefon') || k.includes('phone') || k.includes('tel')) return 40;
      if (k.includes('ansprechpartner') || k.includes('kontakt') || k.includes('vorname') || k.includes('nachname')) return 50;
      if (k.includes('position') || k.includes('rolle') || k.includes('funktion')) return 60;
      if (k.includes('email') || k.includes('mail')) return 70;
      return 100;
    };
    return [...cols].sort((a, b) => priorityScore(a) - priorityScore(b));
  };

  // Initialisieren aller Spalten aus den Rohdaten der Zeilen mit logischer Sortierung
  useEffect(() => {
    if (rows.length > 0 && selectedRawCols.length === 0) {
      const keys = new Set<string>();
      rows.forEach(r => {
        Object.keys(r.raw_data || {}).forEach(k => keys.add(k));
      });
      setSelectedRawCols(sortRawColumnsLogically(Array.from(keys)));
    }
  }, [rows]);

  // Handle Drag & Drop reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedColIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedColIndex === null || draggedColIndex === index) return;
    const updated = [...selectedRawCols];
    const [moved] = updated.splice(draggedColIndex, 1);
    updated.splice(index, 0, moved);
    setDraggedColIndex(index);
    setSelectedRawCols(updated);
  };

  const handleDragEnd = () => {
    setDraggedColIndex(null);
  };

  // Handle Column Resizing
  const handleResizeStart = (e: React.MouseEvent, colKey: string, currentWidth = 140) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingCol({
      col: colKey,
      startX: e.clientX,
      startWidth: columnWidths[colKey] || currentWidth,
    });
  };

  useEffect(() => {
    if (!resizingCol) return;
    const onMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizingCol.startX;
      const newWidth = Math.max(60, resizingCol.startWidth + diff);
      setColumnWidths(prev => ({ ...prev, [resizingCol.col]: newWidth }));
    };
    const onMouseUp = () => setResizingCol(null);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizingCol]);

  const allAvailableCols = React.useMemo(() => {
    const keys = new Set<string>();
    rows.forEach(r => {
      Object.keys(r.raw_data || {}).forEach(k => keys.add(k));
    });
    return Array.from(keys);
  }, [rows]);

  // Detected AI columns in normalized_data.extra
  const aiColumns = React.useMemo(() => {
    const keys = new Set<string>();
    rows.forEach(r => {
      const extra = r.normalized_data?.extra || {};
      Object.keys(extra).forEach(k => keys.add(k));
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

  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/raw-imports/${batchId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchBatchData = async (targetPage = page, targetPageSize = pageSize) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}?page=${targetPage}&per_page=${targetPageSize}`);
      if (res.ok) {
        const data = await res.json();
        setBatch(data.batch);
        setRows(data.rows.data || []);
        setPaginationData({
          total: data.rows.total ?? data.batch.total_rows ?? 0,
          from: data.rows.from ?? 1,
          to: data.rows.to ?? (data.rows.data?.length || 0),
          last_page: data.rows.last_page ?? 1,
        });
        setActivePrompt(data.active_prompt || null);
        setStats(data.stats || { conf_low: 0, conf_mid: 0, conf_high: 0 });
        if (data.batch.case_id) {
          setSelectedCaseId(data.batch.case_id);
        }
      }

      await fetchLogs();

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
    fetchBatchData(page, pageSize);
  }, [page, pageSize]);

  useEffect(() => {
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
        body: JSON.stringify({ sample_percent: pct, force: true }),
      });
      const data = await res.json();
      if (res.ok) {
        // Starte Live-Polling unabhängig von queued Flag bis Status nicht mehr 'normalizing' ist
        const pollInterval = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/raw-imports/${batchId}`);
            if (pollRes.ok) {
              const pollData = await pollRes.json();
              setBatch(pollData.batch);
              await fetchLogs();
              if (pollData.batch.status !== 'normalizing') {
                clearInterval(pollInterval);
                setNormalizing(false);
                await fetchBatchData();
              }
            }
          } catch (err) {
            console.error(err);
          }
        }, 2000);
      } else {
        alert(data.message || 'Fehler beim Starten der Normalisierung.');
        setNormalizing(false);
      }
    } catch (e) {
      console.error(e);
      alert('Netzwerkfehler beim Starten der Normalisierung.');
      setNormalizing(false);
    }
  };

  const handlePromote = async () => {
    let targetCaseId = selectedCaseId;

    setPromoteLoading(true);
    try {
      // If user wants to create a brand new case directly from this batch:
      if (createNewCaseMode) {
        if (!newCaseName.trim()) {
          alert('Bitte gib einen Namen für den neuen Case ein.');
          setPromoteLoading(false);
          return;
        }

        const createRes = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newCaseName.trim(),
            template: 'standard',
          }),
        });

        if (!createRes.ok) {
          alert('Fehler beim Erstellen des neuen Cases.');
          setPromoteLoading(false);
          return;
        }

        const createdCase = await createRes.json();
        targetCaseId = createdCase.id;
      }

      if (!targetCaseId) {
        alert('Bitte wähle einen Case aus oder erstelle einen neuen.');
        setPromoteLoading(false);
        return;
      }

      const res = await fetch(`/api/raw-imports/${batchId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: targetCaseId,
          import_companies: true,
          import_contacts: true,
          included_raw_columns: includeCustomColsInPromote ? selectedRawCols : [],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowPromoteModal(false);
        await fetchBatchData();
        alert(data.message || 'Erfolgreich übertragen!');
        // Direkt zum Case weiterleiten, falls neu erstellt
        if (createNewCaseMode && targetCaseId) {
          router.visit(`/cases/${targetCaseId}`);
        }
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

  const openPromptEditorModal = async () => {
    if (activePrompt) {
      setPromptEditSystem(activePrompt.system_prompt || '');
      setPromptEditModel(activePrompt.model || 'openai/gpt-4o');
      setPromptEditTemp(activePrompt.temperature ?? 0.0);
      setShowPromptEditModal(true);
      return;
    }

    // Fallback: If not yet loaded, fetch active prompt from api
    try {
      const res = await fetch('/api/normalization-prompts');
      if (res.ok) {
        const list: ActivePrompt[] = await res.json();
        const active = list.find(p => p.id) || null;
        if (active) {
          setActivePrompt(active);
          setPromptEditSystem(active.system_prompt || '');
          setPromptEditModel(active.model || 'openai/gpt-4o');
          setPromptEditTemp(active.temperature ?? 0.0);
        }
      }
    } catch (e) {
      console.error(e);
    }
    setShowPromptEditModal(true);
  };

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault();

    setSavingPrompt(true);
    try {
      const promptId = activePrompt?.id;
      const url = promptId ? `/api/normalization-prompts/${promptId}` : '/api/normalization-prompts';
      const method = promptId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: activePrompt?.name || 'b2b_contact_split_custom',
          schema_type: batch?.schema_type || '*',
          system_prompt: promptEditSystem,
          user_prompt_template: activePrompt?.user_prompt_template || 'Normalisiere diese Zeilen:\n{{rows}}',
          model: promptEditModel,
          temperature: promptEditTemp,
          is_active: true,
        }),
      });

      if (res.ok) {
        setShowPromptEditModal(false);
        await fetchBatchData();
        alert('Prompt erfolgreich aktualisiert! Du kannst nun eine neue 10%-Test-Stichprobe starten.');
      } else {
        alert('Fehler beim Speichern des Prompts.');
      }
    } catch (err) {
      console.error(err);
      alert('Netzwerkfehler beim Speichern des Prompts.');
    } finally {
      setSavingPrompt(false);
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

  const handleAddAiColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiColName.trim() || !aiColPrompt.trim()) {
      alert('Bitte Spaltennamen und Prompt ausfüllen.');
      return;
    }

    setAiColLoading(true);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}/ai-column`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          column_name: aiColName.trim(),
          prompt: aiColPrompt.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setShowAiColModal(false);
        setAiColName('');
        setAiColPrompt('');
        await fetchBatchData();
        alert(data.message || 'KI-Spalte erfolgreich berechnet!');
      } else {
        alert(data.message || 'Fehler beim Erstellen der KI-Spalte.');
      }
    } catch (err) {
      console.error(err);
      alert('Netzwerkfehler beim Erstellen der KI-Spalte.');
    } finally {
      setAiColLoading(false);
    }
  };

  const handleFormatColumnE164 = async (columnName: string) => {
    if (!confirm(`Möchtest du alle Telefonnummern der Spalte "${columnName}" nach E.164 (z. B. +49...) formatieren?`)) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/raw-imports/${batchId}/format-e164`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column: columnName }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchBatchData();
        alert(data.message);
      } else {
        alert(data.message || 'Fehler bei der E.164 Formatierung.');
      }
    } catch (e) {
      console.error(e);
      alert('Netzwerkfehler bei der E.164 Formatierung.');
    } finally {
      setLoading(false);
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
      <div className="p-4 md:p-6 w-full max-w-[1700px] mx-auto space-y-4">
        {/* Consolidated Solid KI-Normalisierungs-Panel (Clean 1-Row Bar) */}
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-3.5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="p-1.5 bg-gray-100 text-gray-700 rounded-md shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold text-gray-900">
                  KI-Normalisierung
                </h2>
                <span className="font-mono text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                  {batch.total_rows.toLocaleString()} Zeilen • {batch.schema_type || 'MIXED'}
                </span>
                {activePrompt && (
                  <span className="font-mono text-[10px] text-gray-400">
                    ({activePrompt.name} • {activePrompt.model || 'gpt-4o'})
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500">
                Trennt Personen von Firmen, isoliert die Kern-Domain &amp; strukturiert Felder.
              </p>
            </div>
          </div>

          {/* Controls: Dropdown + 1 Ausführen Button + Settings Gear */}
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={samplePercent}
              onChange={(e) => setSamplePercent(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none font-medium text-gray-700 shadow-2xs"
              disabled={normalizing}
            >
              <option value={10}>10% Test-Stichprobe</option>
              <option value={100}>100% Alle Zeilen</option>
            </select>

            <button
              onClick={() => handleNormalize(samplePercent)}
              disabled={normalizing}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium shadow-2xs transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Sparkles className={`w-3.5 h-3.5 text-amber-100 ${normalizing ? 'animate-spin' : ''}`} />
              <span>{normalizing ? 'Wird ausgeführt…' : 'Ausführen'}</span>
            </button>

            <button
              type="button"
              onClick={openPromptEditorModal}
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-200 rounded-lg shadow-2xs transition-colors"
              title="Prompt & Modell-Einstellungen bearbeiten"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Progress Bar during active run */}
        {normalizing && batch.total_rows > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-3.5 shadow-2xs space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-gray-800 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin" />
                <span>Normalisierung läuft im Hintergrund…</span>
              </span>
              <span className="font-mono text-gray-600">
                {batch.normalized_rows.toLocaleString('de-DE')} / {batch.total_rows.toLocaleString('de-DE')} Zeilen ({Math.round((batch.normalized_rows / batch.total_rows) * 100)}%)
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-amber-600 h-2 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(2, Math.round((batch.normalized_rows / batch.total_rows) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Evaluation Card (Shown after sample run) */}
        <EvaluationCard
          run={latestEvalRun}
          loading={evalLoading}
          onOpenPromptEditor={openPromptEditorModal}
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
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Tabellen-Ansicht ({rows.length} Zeilen)
                </h3>
                {batch.normalized_rows > 0 && batch.normalized_rows < batch.total_rows && (
                  <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-200">
                    🧪 10% Test-Vorschau ({batch.normalized_rows} von {batch.total_rows})
                  </span>
                )}
                {batch.normalized_rows > 0 && batch.normalized_rows >= batch.total_rows && (
                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                    ⚡ 100% Alle Zeilen verarbeitet
                  </span>
                )}
              </div>
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
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('logs');
                    fetchLogs();
                  }}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    viewMode === 'logs'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  📜 Logs ({logs.length})
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAiColModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium transition-colors shadow-2xs"
                title="Neue KI-Spalte für den Batch berechnen"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>+ KI-Spalte</span>
              </button>

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

          {viewMode === 'table' && (
            <div className="overflow-x-auto max-h-[720px] select-none">
              <table className="w-full text-left border-collapse text-xs table-fixed">
                <thead className="bg-gray-100/95 text-gray-700 uppercase tracking-wider text-[10px] sticky top-0 z-10 border-b border-gray-200 shadow-2xs">
                  <tr>
                    <th className="py-2.5 px-3 w-12 text-center font-bold shrink-0">#</th>
                    
                    {/* Raw columns - Draggable & Resizable */}
                    {selectedRawCols.map((col, idx) => {
                      const width = columnWidths[col] || 150;
                      const isPhoneCol = col.toLowerCase().includes('telefon') || col.toLowerCase().includes('phone') || col.toLowerCase().includes('tel') || col.toLowerCase().includes('mobil');
                      return (
                        <th
                          key={col}
                          draggable
                          onDragStart={(e) => handleDragStart(e, idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDragEnd={handleDragEnd}
                          style={{ width: `${width}px`, minWidth: '70px' }}
                          className={`py-2.5 px-2.5 font-semibold border-r border-gray-200/80 whitespace-nowrap group relative cursor-grab active:cursor-grabbing transition-colors ${
                            draggedColIndex === idx ? 'bg-amber-100/80 ring-2 ring-amber-400' : 'hover:bg-gray-200/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1 min-w-0">
                              <GripVertical className="w-3 h-3 text-gray-400 opacity-40 group-hover:opacity-100 shrink-0" />
                              <span className="font-mono text-[11px] truncate text-gray-800" title={col}>
                                {col}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {isPhoneCol && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleFormatColumnE164(col);
                                  }}
                                  className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors border border-emerald-200"
                                  title={`Telefonnummern in "${col}" nach E.164 (+49...) formatieren`}
                                >
                                  <Phone className="w-2.5 h-2.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeColumn(col);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-300 text-gray-400 hover:text-red-600 transition-all shrink-0"
                                title={`Spalte "${col}" ausblenden`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          {/* Resizer handle */}
                          <div
                            onMouseDown={(e) => handleResizeStart(e, col, width)}
                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-amber-500 transition-colors z-20"
                            title="Spaltenbreite anpassen"
                          />
                        </th>
                      );
                    })}

                    {/* Phase 1: Company Columns */}
                    <th 
                      style={{ width: columnWidths['__comp_brand'] || 190 }}
                      className="py-2.5 px-3 font-semibold text-gray-900 bg-gray-50 border-r border-gray-200 whitespace-nowrap relative group"
                    >
                      <span>🏢 Brand / Firma</span>
                      <div
                        onMouseDown={(e) => handleResizeStart(e, '__comp_brand', 190)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-400 transition-colors z-20"
                      />
                    </th>
                    <th 
                      style={{ width: columnWidths['__comp_domain'] || 170 }}
                      className="py-2.5 px-3 font-semibold text-gray-900 bg-gray-50 border-r border-gray-200 whitespace-nowrap relative group"
                    >
                      <span>🌐 Domain</span>
                      <div
                        onMouseDown={(e) => handleResizeStart(e, '__comp_domain', 170)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-400 transition-colors z-20"
                      />
                    </th>
                    <th 
                      style={{ width: columnWidths['__comp_loc'] || 140 }}
                      className="py-2.5 px-3 font-semibold text-gray-900 bg-gray-50 border-r border-gray-200 whitespace-nowrap relative group"
                    >
                      <span>📍 Ort / Land</span>
                      <div
                        onMouseDown={(e) => handleResizeStart(e, '__comp_loc', 140)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-400 transition-colors z-20"
                      />
                    </th>

                    {/* Phase 2: Contact Columns */}
                    <th 
                      style={{ width: columnWidths['__cont_name'] || 170 }}
                      className="py-2.5 px-3 font-semibold text-gray-900 bg-gray-50 border-r border-gray-200 whitespace-nowrap relative group"
                    >
                      <span>👤 Ansprechpartner</span>
                      <div
                        onMouseDown={(e) => handleResizeStart(e, '__cont_name', 170)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-400 transition-colors z-20"
                      />
                    </th>
                    <th 
                      style={{ width: columnWidths['__cont_pos'] || 150 }}
                      className="py-2.5 px-3 font-semibold text-gray-900 bg-gray-50 border-r border-gray-200 whitespace-nowrap relative group"
                    >
                      <span>💼 Position</span>
                      <div
                        onMouseDown={(e) => handleResizeStart(e, '__cont_pos', 150)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-400 transition-colors z-20"
                      />
                    </th>
                    <th 
                      style={{ width: columnWidths['__cont_email'] || 180 }}
                      className="py-2.5 px-3 font-semibold text-gray-900 bg-gray-50 border-r border-gray-200 whitespace-nowrap relative group"
                    >
                      <span>✉️ E-Mail / Kontakt</span>
                      <div
                        onMouseDown={(e) => handleResizeStart(e, '__cont_email', 180)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-400 transition-colors z-20"
                      />
                    </th>

                    {/* Phase 3: Dynamic AI Columns */}
                    {aiColumns.map(aiCol => (
                      <th
                        key={aiCol}
                        style={{ width: columnWidths[aiCol] || 160 }}
                        className="py-2.5 px-3 font-semibold text-gray-900 bg-gray-50 border-r border-gray-200 whitespace-nowrap relative group"
                      >
                        <div className="flex items-center gap-1">
                          <Bot className="w-3 h-3 text-gray-500" />
                          <span className="truncate">{aiCol}</span>
                        </div>
                        <div
                          onMouseDown={(e) => handleResizeStart(e, aiCol, 160)}
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-gray-400 transition-colors z-20"
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-sans select-text">
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
                      const extra = row.normalized_data?.extra || {};
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
                          <td className="py-2 px-3 border-r border-gray-100 text-[11px]">
                            {hasComp ? (
                              <div className="flex flex-col">
                                <span className="font-semibold text-gray-900 truncate">
                                  {comp.brand_name || comp.company_name}
                                </span>
                                {comp.legal_form && (
                                  <span className="text-[9px] text-gray-500 bg-gray-100 rounded px-1 py-0.2 w-fit mt-0.5">
                                    {comp.legal_form}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Company: Domain (Anklickbar in neuem Tab) */}
                          <td className="py-2 px-3 border-r border-gray-100 text-[11px]">
                            {comp.domain ? (
                              <a
                                href={comp.domain.startsWith('http') ? comp.domain : `https://${comp.domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-blue-600 hover:text-blue-800 hover:underline font-medium group"
                                title={`Website ${comp.domain} in neuem Tab öffnen`}
                              >
                                <span>{comp.domain}</span>
                                <ExternalLink className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100" />
                              </a>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Company: Ort / Land */}
                          <td className="py-2 px-3 border-r border-gray-100 text-[11px] text-gray-700">
                            {comp.city || comp.country ? (
                              <span>{[comp.zip, comp.city, comp.country].filter(Boolean).join(' ')}</span>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Contact: Person */}
                          <td className="py-2 px-3 border-r border-gray-100 text-[11px]">
                            {hasCont && (cont.first_name || cont.last_name) ? (
                              <div className="font-semibold text-gray-900 truncate flex items-center gap-1">
                                {cont.salutation && <span className="text-gray-500 font-normal text-[10px]">{cont.salutation}</span>}
                                <span>{`${cont.first_name || ''} ${cont.last_name || ''}`.trim()}</span>
                              </div>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Contact: Position */}
                          <td className="py-2 px-3 border-r border-gray-100 text-[11px] text-gray-700 truncate max-w-[140px]">
                            {cont.position || <span className="text-gray-300 italic text-[10px]">–</span>}
                          </td>

                          {/* Contact: Email / Kontakt */}
                          <td className="py-2 px-3 border-r border-gray-100 text-[11px]">
                            {cont.email || cont.phone_direct ? (
                              <div className="flex flex-col text-[10px]">
                                {cont.email && <span className="text-gray-700 font-mono">{cont.email}</span>}
                                {cont.phone_direct && <span className="text-gray-500 font-mono">{cont.phone_direct}</span>}
                              </div>
                            ) : (
                              <span className="text-gray-300 italic text-[10px]">–</span>
                            )}
                          </td>

                          {/* Dynamic AI Column Values */}
                          {aiColumns.map(aiCol => {
                            const val = extra[aiCol];
                            return (
                              <td key={aiCol} className="py-2 px-3 border-r border-gray-100 text-[11px] text-gray-900 max-w-xs truncate font-medium">
                                {val !== undefined && val !== null && String(val).trim() !== '' ? (
                                  <span>{String(val)}</span>
                                ) : (
                                  <span className="text-gray-300 italic text-[10px]">–</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {viewMode === 'compare' && (
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
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${
                              conf >= 0.85
                                ? 'bg-gray-100 text-gray-900 border-gray-300'
                                : conf >= 0.6
                                ? 'bg-gray-50 text-gray-700 border-gray-200'
                                : 'bg-red-50 text-red-700 border-red-200'
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

          {viewMode === 'logs' && (
            /* ══ TAB 3: LOGS (1:1 Design wie in den Cases) ══ */
            <div className="p-5 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                <span className="font-semibold text-slate-700">📜 Batch Ausführungsprotokoll</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={fetchLogs}
                    className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                  >
                    Aktualisieren
                  </button>
                </div>
              </div>

              {logs.length === 0 ? (
                <div className="p-8 text-center text-slate-400">Keine Protokolleinträge vorhanden.</div>
              ) : (
                <div className="space-y-1.5 bg-slate-950 text-slate-200 p-4 rounded-xl max-h-[60vh] overflow-y-auto">
                  {logs.map((l, i) => (
                    <div key={i} className="flex items-start gap-3 text-[11.5px] leading-relaxed">
                      <span className="text-slate-500 shrink-0 font-mono">
                        {new Date(l.timestamp).toLocaleTimeString('de-DE')}
                      </span>
                      <span className={
                        l.level === 'ERROR' ? 'text-red-400' :
                        l.level === 'WARN' ? 'text-amber-400' :
                        'text-emerald-400'
                      }>
                        ▶
                      </span>
                      <span className="text-slate-300 break-all flex-1">
                        {l.message}
                        {l.context && Object.keys(l.context).length > 0 && (
                          <span className="text-slate-500 text-[10px] ml-2 font-mono">
                            {JSON.stringify(l.context)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pagination Footer (Exakt wie in den Cases) */}
          {paginationData.total > 0 && viewMode !== 'logs' && (
            <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-2.5 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 gap-2">
              <div className="flex items-center gap-2">
                <span>
                  Zeile {paginationData.from.toLocaleString('de-DE')}–{paginationData.to.toLocaleString('de-DE')} von {paginationData.total.toLocaleString('de-DE')} Datenzeilen
                </span>
                <span className="text-gray-300">•</span>
                <div className="flex items-center gap-1">
                  <span>Pro Seite:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      const newSize = Number(e.target.value);
                      setPageSize(newSize);
                      setPage(1);
                    }}
                    className="border border-gray-200 rounded px-1.5 py-0.5 bg-white text-xs outline-none"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-medium text-gray-700">
                  Seite {page} / {Math.max(1, paginationData.last_page)}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(paginationData.last_page, p + 1))}
                  disabled={page >= paginationData.last_page}
                  className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Transfer to Case Footer Bar (Clean & Structured below Table) */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-gray-900">Transfer in Dataminer Case</span>
              <span className="text-gray-400">•</span>
              <span className="text-xs text-gray-500">
                Erzeugt eine saubere Haupttabelle für Firmen und verknüpft Kontakte als Ansprechpartner.
              </span>
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Normalisiert: {batch.normalized_rows} von {batch.total_rows} Zeilen bereit
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {batch.status === 'promoted' ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-gray-900 bg-gray-100 px-2.5 py-1 rounded-md border border-gray-200">
                  ✓ In Case übertragen ({batch.promoted_rows})
                </span>
                <button
                  onClick={handleRollback}
                  disabled={rollbackLoading}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 hover:text-red-600 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
                  title="Übertragung rückgängig machen"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{rollbackLoading ? 'Löscht…' : 'Rollback'}</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowPromoteModal(true)}
                disabled={batch.normalized_rows === 0}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium shadow-2xs transition-colors disabled:opacity-40"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>In Case übertragen</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Promote Modal */}
      {showPromoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-gray-100 p-5 space-y-4">
            <h3 className="font-semibold text-sm text-gray-900">In Case übertragen</h3>
            <p className="text-xs text-gray-600">
              Erzeugt einen sauberen Case: Firmen landen in der Haupttabelle, Kontakte werden automatisch als verknüpfte Ansprechpartner angelegt.
            </p>

            {/* Switch Mode: Existing Case vs Create New Case */}
            <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setCreateNewCaseMode(false)}
                className={`flex-1 py-1 text-center font-medium rounded-md transition-all ${
                  !createNewCaseMode ? 'bg-white shadow-2xs text-gray-900' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                In bestehenden Case
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreateNewCaseMode(true);
                  if (!newCaseName && batch) setNewCaseName(`Import: ${batch.label}`);
                }}
                className={`flex-1 py-1 text-center font-medium rounded-md transition-all ${
                  createNewCaseMode ? 'bg-white shadow-2xs text-gray-900' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                + Neuen Case erstellen
              </button>
            </div>

            {createNewCaseMode ? (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name des neuen Cases</label>
                <input
                  type="text"
                  required
                  placeholder="z. B. B2B Leads München Q4"
                  value={newCaseName}
                  onChange={(e) => setNewCaseName(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Ziel-Case auswählen</label>
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
            )}

            {/* Column Inclusion Control */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-800">
                <input
                  type="checkbox"
                  checked={includeCustomColsInPromote}
                  onChange={(e) => setIncludeCustomColsInPromote(e.target.checked)}
                  className="rounded text-amber-600 focus:ring-amber-500"
                />
                <span>Aktuell sichtbare Roh-/Zusatzspalten in Case übernehmen ({selectedRawCols.length})</span>
              </label>
              <p className="text-[11px] text-gray-500 pl-5">
                {includeCustomColsInPromote 
                  ? `Übernimmt: ${selectedRawCols.join(', ')}`
                  : 'Es werden nur die bereinigten Standardfelder (Firma & Kontakt) übertragen.'}
              </p>
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
                disabled={promoteLoading || (!createNewCaseMode && !selectedCaseId)}
                className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
              >
                {promoteLoading ? 'Wird übertragen…' : createNewCaseMode ? 'Case erstellen & übertragen' : 'Übertragen starten'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Column Generator Modal */}
      {showAiColModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-gray-100 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2 text-purple-700 font-semibold text-sm">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span>Neue KI-Spalte berechnen</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAiColModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddAiColumn} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Spaltenname (z. B. "Branche KI", "Lead-Score", "Unternehmensgröße")
                </label>
                <input
                  type="text"
                  required
                  placeholder="z. B. Lead-Prio"
                  value={aiColName}
                  onChange={(e) => setAiColName(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-1 focus:ring-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  KI-Prompt / Anweisung an das Sprachmodell
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="z. B. Bestimme anhand der Firma und Position, ob es sich um einen B2B-Entscheider handelt (Ja/Nein/Unklar)."
                  value={aiColPrompt}
                  onChange={(e) => setAiColPrompt(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-1 focus:ring-purple-500 outline-none font-sans"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Das Modell analysiert Firma, Website, E-Mail und Position und erzeugt für jede Zeile den exakten Spaltenwert.
                </p>
              </div>

              {/* Schnellauswahl / Presets */}
              <div>
                <span className="text-[11px] font-medium text-gray-500 block mb-1.5">Oder Vorlage wählen:</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAiColName('B2B-Branche');
                      setAiColPrompt('Klassifiziere das Unternehmen in eine präzise Branche (max. 3 Wörter).');
                    }}
                    className="text-[10px] px-2 py-1 bg-gray-100 hover:bg-purple-50 hover:text-purple-700 rounded-md text-gray-600 transition-colors"
                  >
                    🏷️ B2B-Branche
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAiColName('Lead-Score');
                      setAiColPrompt('Bewerte den Lead auf einer Skala von A (Top B2B Target) bis C basierend auf Firma und Kontakt.');
                    }}
                    className="text-[10px] px-2 py-1 bg-gray-100 hover:bg-purple-50 hover:text-purple-700 rounded-md text-gray-600 transition-colors"
                  >
                    ⭐ Lead-Score (A/B/C)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAiColName('Kurzzusammenfassung');
                      setAiColPrompt('Formuliere einen kurzen Satz über die Tätigkeit des Unternehmens.');
                    }}
                    className="text-[10px] px-2 py-1 bg-gray-100 hover:bg-purple-50 hover:text-purple-700 rounded-md text-gray-600 transition-colors"
                  >
                    📝 Zusammenfassung
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAiColModal(false)}
                  disabled={aiColLoading}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={aiColLoading}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {aiColLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Berechne Spalte…</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Spalte jetzt generieren</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Normalization Prompt Direct Editor Modal */}
      {showPromptEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 md:p-8">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] border border-gray-200 p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-semibold text-sm text-gray-900">
                  KI-Normalisierungs-Prompt anpassen {activePrompt ? `(${activePrompt.name})` : ''}
                </h3>
                <p className="text-xs text-gray-500">
                  Steuert, wie Firmennamen bereinigt, Domains extrahiert und Kontakte getrennt werden.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPromptEditModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePrompt} className="flex-1 flex flex-col space-y-4 py-3 overflow-hidden">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">KI-Modell</label>
                  <select
                    value={promptEditModel}
                    onChange={(e) => setPromptEditModel(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none"
                  >
                    <option value="openai/gpt-4o">openai/gpt-4o (Sehr präzise)</option>
                    <option value="openai/gpt-4o-mini">openai/gpt-4o-mini (Schnell & kostengünstig)</option>
                    <option value="anthropic/claude-3-5-sonnet">anthropic/claude-3-5-sonnet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Temperatur
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={promptEditTemp}
                    onChange={(e) => setPromptEditTemp(parseFloat(e.target.value) || 0)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  System-Prompt &amp; Extraktions-Regeln
                </label>
                <textarea
                  rows={16}
                  required
                  value={promptEditSystem}
                  onChange={(e) => setPromptEditSystem(e.target.value)}
                  className="w-full flex-1 min-h-[350px] text-xs font-mono border border-gray-200 rounded-xl p-3.5 bg-gray-50 focus:bg-white outline-none leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowPromptEditModal(false)}
                  disabled={savingPrompt}
                  className="px-4 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={savingPrompt}
                  className="px-5 py-2 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
                >
                  {savingPrompt ? 'Speichert…' : 'Prompt speichern & anwenden'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
