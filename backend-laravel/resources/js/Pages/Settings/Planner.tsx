import React, { useState, useEffect, useRef } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { apiFetch } from '../../api';
import {
  Sparkles, Save, RotateCcw, Play, RefreshCw, CheckCircle2,
  Map, Globe, Search, FileSearch, AlertTriangle, Info, XCircle
} from 'lucide-react';

interface PlanStep {
  id: string;
  type: string;
  label: string;
  mapQuery?: string;
  location?: string;
  query?: string;
  url?: string;
  estimatedHits: number;
  priority: number;
}

interface DiscoveryPlan {
  goal: string;
  steps: PlanStep[];
  estimatedRows: number;
  warnings: string[];
}

interface TestResult {
  plan?: DiscoveryPlan;
  latencyMs?: number;
  usedOverride?: boolean;
  error?: string;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  google_maps: <Map className="w-3.5 h-3.5 text-violet-500" />,
  google_search: <Search className="w-3.5 h-3.5 text-blue-500" />,
  catalog_scrape: <FileSearch className="w-3.5 h-3.5 text-green-500" />,
  directory_search: <Globe className="w-3.5 h-3.5 text-orange-500" />,
};

export default function PlannerSettingsPage({
  plannerPrompt: initialPrompt,
  defaultPrompt: initialDefaultPrompt,
}: {
  plannerPrompt?: string | null;
  defaultPrompt?: string;
}) {
  const [defaultPrompt, setDefaultPrompt] = useState<string>(initialDefaultPrompt || '');
  const [savedOverride, setSavedOverride] = useState<string | null>(initialPrompt || null);
  const [editorValue, setEditorValue] = useState<string>(initialPrompt || initialDefaultPrompt || '');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  // Live Test
  const [testPrompt, setTestPrompt] = useState('Hausbauunternehmen Rostock');
  const [maxResults, setMaxResults] = useState(50);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (!initialDefaultPrompt) {
      apiFetch('/api/settings/test-planner')
        .then(r => r.json())
        .then(d => {
          if (d.defaultPrompt) {
            setDefaultPrompt(d.defaultPrompt);
            if (!initialPrompt) {
              setEditorValue(d.defaultPrompt);
            }
          }
          if (d.currentOverride) {
            setSavedOverride(d.currentOverride);
            setEditorValue(d.currentOverride);
          }
        })
        .catch(() => {});
    }
  }, [initialDefaultPrompt, initialPrompt]);

  const isOverrideActive = defaultPrompt
    ? editorValue.trim() !== defaultPrompt.trim() && editorValue.trim().length > 0
    : editorValue.trim().length > 0;

  const handleEditorChange = (val: string) => {
    setEditorValue(val);
    setIsDirty(true);
  };

  const handleReset = () => {
    setEditorValue(savedOverride || defaultPrompt);
    setIsDirty(false);
  };

  const handleClearOverride = () => {
    setEditorValue(defaultPrompt);
    setIsDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const isCustom = editorValue.trim() && editorValue.trim() !== defaultPrompt.trim();
      const payloadPrompt = isCustom ? editorValue.trim() : null;

      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planner_system_prompt: payloadPrompt }),
      });

      if (res.ok) {
        setSavedOverride(payloadPrompt);
        setIsDirty(false);
        setSavedMsg(true);
        setTimeout(() => setSavedMsg(false), 2000);
      } else {
        const err = await res.json().catch(() => ({}));
        alert('Speichern fehlgeschlagen: ' + (err.error || res.statusText));
      }
    } catch (e: any) {
      alert('Speichern fehlgeschlagen: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testPrompt.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/settings/test-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: testPrompt.trim(),
          maxResults,
          systemPrompt: isOverrideActive ? editorValue.trim() : null,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e: any) {
      setTestResult({ error: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppLayout
      title="Planner Prompt"
      subtitle="System-Prompt zur automatischen Ableitung von Suchschritten aus Freitext-Zielen"
    >
      <div className="max-w-5xl mx-auto space-y-5 pb-16">
        {/* Info Banner */}
        <div
          className="flex items-start gap-3 p-3.5 rounded-lg text-xs leading-relaxed"
          style={{
            background: 'var(--orange-soft)',
            border: '1px solid var(--orange-mid)',
            color: 'var(--orange)',
          }}
        >
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold text-xs">Custom Planner System Prompt</p>
            <p style={{ color: 'var(--text-2)' }}>
              System-Prompt für die automatische Recherche-Planung überschreiben. Leer lassen für den Standard.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left 2/3: Editor */}
          <div className="lg:col-span-2 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
                  System Prompt
                </span>
                {isOverrideActive ? (
                  <span className="status-pill" style={{ background: 'var(--orange-soft)', color: 'var(--orange)' }}>
                    • Custom Override
                  </span>
                ) : (
                  <span className="status-pill" style={{ background: 'var(--bg)', color: 'var(--text-3)' }}>
                    • Standard
                  </span>
                )}
              </div>
            </div>

            <textarea
              value={editorValue}
              onChange={e => handleEditorChange(e.target.value)}
              placeholder="Prompt laden..."
              className="w-full h-[540px] font-mono text-xs leading-relaxed p-3.5 resize-none focus:outline-none"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r)',
                color: 'var(--text-1)',
              }}
              spellCheck={false}
            />

            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {isOverrideActive
                ? `${editorValue.length} Zeichen · Eigener Prompt aktiv`
                : 'Entspricht dem integrierten Standard'}
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="btn-v2 btn-v2-primary"
              >
                {saving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : savedMsg ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {savedMsg ? 'Gespeichert ✓' : 'Speichern'}
              </button>
              {isDirty && (
                <button onClick={handleReset} className="btn-v2">
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              )}
              {isOverrideActive && (
                <button
                  onClick={handleClearOverride}
                  className="btn-v2"
                  style={{ color: 'var(--danger)' }}
                >
                  Auf Default zurück
                </button>
              )}
            </div>
          </div>

          {/* Right 1/3: Live Test */}
          <div className="lg:col-span-1 space-y-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
              Live Test
            </span>

            <div
              className="p-4 space-y-3"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div>
                <label className="text-[11px] mb-1 block font-medium" style={{ color: 'var(--text-2)' }}>
                  Such-Ziel
                </label>
                <input
                  type="text"
                  value={testPrompt}
                  onChange={e => setTestPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTest()}
                  placeholder="z.B. Hausbauunternehmen Rostock"
                  className="w-full px-2.5 py-1.5 text-xs border rounded focus:outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[11px] mb-1 block font-medium" style={{ color: 'var(--text-2)' }}>
                    Max Treffer
                  </label>
                  <input
                    type="number"
                    value={maxResults}
                    onChange={e => setMaxResults(Number(e.target.value))}
                    min={10}
                    max={5000}
                    className="w-full px-2.5 py-1.5 text-xs border rounded focus:outline-none"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
                  />
                </div>
                <div className="pt-4">
                  <button
                    onClick={handleTest}
                    disabled={testing || !testPrompt.trim()}
                    className="btn-v2 btn-v2-primary"
                  >
                    {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    Test
                  </button>
                </div>
              </div>

              <div
                className="text-[11px] p-2 rounded flex items-center gap-1.5"
                style={{
                  background: isOverrideActive ? 'var(--orange-soft)' : 'var(--warn-soft)',
                  color: isOverrideActive ? 'var(--orange)' : 'var(--warn)',
                }}
              >
                <AlertTriangle className="w-3 h-3 shrink-0" />
                {isOverrideActive ? 'Testet mit Custom-Prompt' : 'Testet mit Default-Prompt'}
              </div>
            </div>

            {/* Test Results */}
            {testing && (
              <div className="flex items-center gap-2 text-xs py-3" style={{ color: 'var(--text-3)' }}>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Plane Schritte via KI...
              </div>
            )}

            {testResult && !testing && (
              <div className="space-y-2.5">
                {testResult.error ? (
                  <div
                    className="flex items-start gap-2 p-2.5 rounded text-xs"
                    style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                  >
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {testResult.error}
                  </div>
                ) : testResult.plan ? (
                  <>
                    <div
                      className="flex items-center gap-2.5 p-3 rounded text-xs"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--green)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                          {testResult.plan.goal}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {testResult.plan.steps.length} Steps · ~{testResult.plan.estimatedRows} Zeilen · {testResult.latencyMs}ms
                        </p>
                      </div>
                    </div>

                    {testResult.plan.warnings && testResult.plan.warnings.length > 0 && (
                      <div className="space-y-1">
                        {testResult.plan.warnings.map((w, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded"
                            style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            {w}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Step list */}
                    <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                      {testResult.plan.steps.map(step => (
                        <div
                          key={step.id}
                          className="p-2 rounded border text-xs space-y-1"
                          style={{
                            background: 'var(--surface)',
                            borderColor: 'var(--border)',
                          }}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="flex items-center gap-1.5 font-medium truncate" style={{ color: 'var(--text-1)' }}>
                              {STEP_ICONS[step.type] || <Search className="w-3.5 h-3.5 text-slate-400" />}
                              <span className="truncate">{step.label}</span>
                            </span>
                            <span className="text-[10px] shrink-0 px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--bg)', color: 'var(--text-3)' }}>
                              ~{step.estimatedHits}
                            </span>
                          </div>
                          {(step.location || step.query || step.mapQuery) && (
                            <p className="text-[11px] truncate font-mono" style={{ color: 'var(--text-3)' }}>
                              {step.location ? `📍 ${step.location}: ` : ''}
                              {step.mapQuery || step.query || step.url}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
