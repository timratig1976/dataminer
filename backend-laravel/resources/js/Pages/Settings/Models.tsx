import React, { useState } from 'react';
import AppLayout from '../../Layouts/AppLayout';
import { Sliders, Save, Plus, X, ChevronUp, ChevronDown, Check, RotateCcw } from 'lucide-react';

const DEFAULT_MODELS = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI", note: "Schnell · günstig · Standard", costPer1kPrompt: "$0.00015", costPer1kOutput: "$0.00060" },
  { id: "openai/gpt-4o", label: "GPT-4o", provider: "OpenAI", note: "Leistungsstark · teurer", costPer1kPrompt: "$0.0025", costPer1kOutput: "$0.010" },
  { id: "anthropic/claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", provider: "Anthropic", note: "Schnell · EU-fähig", costPer1kPrompt: "$0.0010", costPer1kOutput: "$0.0050" },
  { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "Anthropic", note: "Stark · EU-fähig", costPer1kPrompt: "$0.0030", costPer1kOutput: "$0.015" },
  { id: "mistral/mistral-small-latest", label: "Mistral Small", provider: "Mistral", note: "EU-fähig · günstig", costPer1kPrompt: "$0.0002", costPer1kOutput: "$0.0006" },
  { id: "mistral/mistral-large-latest", label: "Mistral Large", provider: "Mistral", note: "EU-fähig · leistungsstark", costPer1kPrompt: "$0.0020", costPer1kOutput: "$0.0060" },
  { id: "google/gemini-flash-latest", label: "Gemini Flash", provider: "Google", note: "Sehr schnell · EU-fähig", costPer1kPrompt: "$0.000075", costPer1kOutput: "$0.0003" },
  { id: "google/gemini-pro-latest", label: "Gemini Pro", provider: "Google", note: "Leistungsstark · EU-fähig", costPer1kPrompt: "$0.00125", costPer1kOutput: "$0.0050" },
  { id: "meta/llama3.3-70b", label: "Llama 3.3 70B", provider: "Meta", note: "Open-Source · günstig", costPer1kPrompt: "$0.0003", costPer1kOutput: "$0.0006" },
  { id: "meta/gpt-oss-120b", label: "GPT OSS 120B", provider: "Meta", note: "Groß · Open-Source", costPer1kPrompt: "$0.0005", costPer1kOutput: "$0.0010" },
];

export default function ModelsSettingsPage({ allowlist: initialAllowlist }: { allowlist: string[] }) {
  const [allowlist, setAllowlist] = useState<string[]>(initialAllowlist?.length > 0 ? initialAllowlist : DEFAULT_MODELS.map(m => m.id));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const saveList = async (list: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_allowlist: list }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error('Failed to save models', e);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => {
    const next = allowlist.includes(id) ? allowlist.filter(m => m !== id) : [...allowlist, id];
    setAllowlist(next);
  };

  const addCustom = () => {
    const m = customInput.trim();
    if (!m || allowlist.includes(m)) return;
    setAllowlist([...allowlist, m]);
    setCustomInput('');
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sliders className="w-5 h-5 text-orange-500" />
              Modell-Auswahl
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Steuere, welche LLMs in den Dropdown-Menüs für KI-Spalten zur Verfügung stehen.
            </p>
          </div>
          <button
            onClick={() => saveList(allowlist)}
            disabled={saving}
            className="btn-v2 btn-v2-primary"
          >
            <Save className="w-3.5 h-3.5" />
            {saved ? 'Gespeichert ✓' : 'Auswahl speichern'}
          </button>
        </div>

        <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid var(--border-xs)' }}>
            <span className="text-xs font-semibold text-slate-700">Verfügbare Modelle ({allowlist.length} aktiv)</span>
            <button
              onClick={() => setAllowlist(DEFAULT_MODELS.map(m => m.id))}
              className="text-[11px] text-orange-600 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Standard wiederherstellen
            </button>
          </div>

          <div className="space-y-2">
            {DEFAULT_MODELS.map(m => {
              const active = allowlist.includes(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className="p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-colors"
                  style={{
                    background: active ? 'var(--orange-soft)' : 'var(--bg)',
                    borderColor: active ? 'var(--orange-mid)' : 'var(--border)',
                  }}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{m.label}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 font-medium">{m.provider}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{m.note} · Prompt: {m.costPer1kPrompt} · Output: {m.costPer1kOutput}</div>
                  </div>
                  <div className={`w-5 h-5 rounded flex items-center justify-center border text-xs ${active ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-300'}`}>
                    {active && <Check className="w-3.5 h-3.5" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom Model Input */}
          <div className="pt-3 flex gap-2" style={{ borderTop: '1px solid var(--border-xs)' }}>
            <input
              type="text"
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              placeholder="Benutzerdefiniertes Modell (z.B. deepseek/deepseek-chat)..."
              className="flex-1 border rounded px-3 py-1.5 text-xs font-mono outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
            <button onClick={addCustom} className="btn-v2">
              <Plus className="w-3.5 h-3.5" /> Hinzufügen
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
