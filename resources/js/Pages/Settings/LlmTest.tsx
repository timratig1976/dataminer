import React, { useState } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import SettingsTabs from '../../Components/settings/SettingsTabs';
import { Zap, Play, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

const DEFAULT_MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "anthropic/claude-3-5-haiku-latest",
  "mistral/mistral-small-latest",
  "google/gemini-flash-latest",
];

export default function LlmTestPage() {
  const [selectedModels, setSelectedModels] = useState<string[]>(DEFAULT_MODELS.slice(0, 3));
  const [prompt, setPrompt] = useState('Was ist die Hauptstadt von Deutschland? Antworte in einem Wort.');
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const toggle = (m: string) => {
    setSelectedModels(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  const handleRun = async () => {
    setTesting(true);
    setResults([]);
    try {
      const items: any[] = [];
      for (const model of selectedModels) {
        const t0 = Date.now();
        try {
          const res = await fetch('/api/settings/test-eden', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt }),
          });
          const data = await res.json();
          items.push({
            model,
            ok: data.ok,
            latencyMs: Date.now() - t0,
            preview: data.preview || data.error || 'Keine Antwort',
          });
        } catch (e: any) {
          items.push({ model, ok: false, latencyMs: Date.now() - t0, preview: e.message });
        }
      }
      setResults(items);
    } finally {
      setTesting(false);
    }
  };

  return (
    <AppLayout title="LLM Playground & Testing">
      <div className="max-w-4xl mx-auto space-y-6 pb-16">
        <SettingsTabs />

        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <Zap className="w-5 h-5 text-amber-500" />
            LLM Provider Testing
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Prüfe die verschiedenen Modelle auf Latenz, Verfügbarkeit und Antwortqualität.
          </p>
        </div>

        <div className="p-5 rounded-xl space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div>
            <span className="text-xs font-semibold text-slate-700 block mb-2">Modelle auswählen</span>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_MODELS.map(m => {
                const active = selectedModels.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggle(m)}
                    className="btn-v2"
                    style={{
                      background: active ? 'var(--orange-soft)' : 'var(--bg)',
                      borderColor: active ? 'var(--orange)' : 'var(--border)',
                      color: active ? 'var(--orange)' : 'var(--text-1)',
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-700 block mb-1">Test-Prompt</span>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={2}
              className="w-full border rounded p-2 text-xs outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
          </div>

          <button
            onClick={handleRun}
            disabled={testing || selectedModels.length === 0}
            className="btn-v2 btn-v2-primary"
          >
            {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Testlauf starten ({selectedModels.length} Modelle)
          </button>
        </div>

        {results.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700">Ergebnisse</h3>
            {results.map(r => (
              <div
                key={r.model}
                className="p-3 rounded-lg border flex items-center justify-between text-xs"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div>
                  <div className="font-semibold">{r.model}</div>
                  <div className="text-slate-500 mt-0.5">"{r.preview}"</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-400">{r.latencyMs}ms</span>
                  {r.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-rose-500" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
