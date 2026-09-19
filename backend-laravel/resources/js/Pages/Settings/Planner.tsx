import React, { useState } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { Sparkles, Save, RotateCcw, Play, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export default function PlannerSettingsPage({ plannerPrompt: initialPrompt }: { plannerPrompt?: string }) {
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testGoal, setTestGoal] = useState('Hausbauunternehmen Rostock');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planner_system_prompt: prompt }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error('Failed to save planner prompt', e);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/agent/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: 'preview', goal: testGoal, preview_only: true }),
      });
      // Fallback: rufe den Test direkt über den Planner ab
      const data = await res.json();
      setTestResult(data);
    } catch (e: any) {
      setTestResult({ error: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              Planner Prompt
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              System-Prompt zur automatischen Ableitung von Suchschritten aus Freitext-Zielen.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-v2 btn-v2-primary"
          >
            <Save className="w-3.5 h-3.5" />
            {saved ? 'Gespeichert ✓' : 'Prompt speichern'}
          </button>
        </div>

        <div className="p-5 rounded-xl space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--border-xs)' }}>
            <span className="text-xs font-semibold text-slate-700">System Prompt Editor</span>
            <button
              onClick={() => setPrompt('')}
              className="text-[11px] text-slate-500 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Standard-Prompt verwenden
            </button>
          </div>

          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={10}
            placeholder="Leer lassen für den integrierten deutschen Standard-Prompt..."
            className="w-full border rounded p-3 text-xs font-mono outline-none leading-relaxed"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-1)' }}
          />
        </div>

        {/* Live Test */}
        <div className="p-5 rounded-xl space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold text-slate-700 block">Prompt-Verhalten testen</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={testGoal}
              onChange={e => setTestGoal(e.target.value)}
              placeholder="Test-Ziel eingeben..."
              className="flex-1 border rounded px-3 py-1.5 text-xs outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
            <button onClick={handleTest} disabled={testing || !testGoal.trim()} className="btn-v2">
              {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-purple-500" />}
              Plan generieren
            </button>
          </div>

          {testResult && (
            <div className="p-3 rounded border text-xs font-mono bg-slate-50 overflow-x-auto max-h-60">
              <pre>{JSON.stringify(testResult, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
