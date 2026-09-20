import React, { useState, useEffect } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import { 
  BrainCircuit, Plus, CheckCircle2, ShieldAlert, Sparkles, Copy, Save, Trash2, Sliders 
} from 'lucide-react';

interface Prompt {
  id: string;
  name: string;
  description: string | null;
  schema_type: string;
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  max_tokens: number;
  temperature: number;
  max_rows_per_chunk: number;
  is_active: boolean;
  version: number;
  created_at: string;
}

export default function PromptsSettings() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schemaType, setSchemaType] = useState('*');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPromptTemplate, setUserPromptTemplate] = useState('');
  const [model, setModel] = useState('openai/gpt-4o');
  const [maxTokens, setMaxTokens] = useState(4000);
  const [temperature, setTemperature] = useState(0.0);
  const [maxRowsPerChunk, setMaxRowsPerChunk] = useState(10);

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/normalization-prompts');
      if (res.ok) {
        const data: Prompt[] = await res.json();
        setPrompts(data);
        if (data.length > 0 && !selectedPrompt) {
          selectPrompt(data.find((p) => p.is_active) || data[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  const selectPrompt = (p: Prompt) => {
    setSelectedPrompt(p);
    setName(p.name);
    setDescription(p.description || '');
    setSchemaType(p.schema_type);
    setSystemPrompt(p.system_prompt);
    setUserPromptTemplate(p.user_prompt_template);
    setModel(p.model);
    setMaxTokens(p.max_tokens);
    setTemperature(p.temperature);
    setMaxRowsPerChunk(p.max_rows_per_chunk);
    setMessage(null);
  };

  const handleCreateNew = () => {
    setSelectedPrompt(null);
    setName('b2b_contact_split_custom');
    setDescription('Eigener optimierter Normalisierungs-Prompt');
    setSchemaType('*');
    setSystemPrompt(
      "Du bist ein präziser Daten-Normalisierungs-Assistent für B2B-Daten.\n" +
      "Schema-Typ: {{schema_type}}.\n\n" +
      "GOLDENE REGELN — NIEMALS BRECHEN:\n" +
      "1. Kopiere Werte EXAKT wie in den Rohdaten. Ändere keine Schreibweise.\n" +
      "2. Erfinde NIEMALS Werte. Wenn unklar → null zurückgeben.\n" +
      "3. domain: NUR eintragen, wenn explizit vorhanden. Niemals aus Firmennamen raten!\n" +
      "4. Gib JEDE übergebene id zurück.\n\n" +
      "AUSGABE-FORMAT:\n" +
      "[{\"id\":\"...\",\"company_fields\":{...},\"contact_fields\":{...},\"extra\":{...},\"confidence\":0.95,\"notes\":\"...\"}]"
    );
    setUserPromptTemplate("Normalisiere diese {{rows_count}} Zeilen:\n{{rows}}");
    setModel('openai/gpt-4o');
    setMaxTokens(4000);
    setTemperature(0.0);
    setMaxRowsPerChunk(10);
    setMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    const payload = {
      name,
      description,
      schema_type: schemaType,
      system_prompt: systemPrompt,
      user_prompt_template: userPromptTemplate,
      model,
      max_tokens: Number(maxTokens),
      temperature: Number(temperature),
      max_rows_per_chunk: Number(maxRowsPerChunk),
    };

    try {
      // Always store as a new version or new prompt
      const res = await fetch('/api/normalization-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const created: Prompt = await res.json();
        setMessage({ type: 'success', text: `Prompt gespeichert als Version ${created.version}!` });
        await fetchPrompts();
        selectPrompt(created);
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.message || 'Fehler beim Speichern.' });
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || 'Fehler beim Speichern.' });
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      const res = await fetch(`/api/normalization-prompts/${id}/activate`, { method: 'POST' });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Prompt wurde als Standard aktiviert!' });
        await fetchPrompts();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Diesen Prompt wirklich löschen?')) return;
    try {
      const res = await fetch(`/api/normalization-prompts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchPrompts();
      } else {
        const err = await res.json();
        alert(err.error || 'Löschen fehlgeschlagen.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const insertVariable = (variable: string) => {
    setSystemPrompt((prev) => prev + ` {{${variable}}} `);
  };

  return (
    <AppLayout title="KI-Normalisierungs-Prompts">
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="p-2.5 bg-amber-600 text-white rounded-lg shadow-sm">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Normalisierungs-Prompts &amp; Halluzinations-Schutz</h2>
              <p className="text-xs text-gray-600 mt-1 max-w-2xl leading-relaxed">
                Passe hier die System-Prompts an, mit denen Rohdaten (CSV/Excel) strukturiert und getrennt werden.
                Änderungen werden automatisch versioniert. Teste neue Prompts zuerst mit einer 10%-Stichprobe.
              </p>
            </div>
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Prompts List (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Verfügbare Prompts ({prompts.length})
              </h3>
              <button
                onClick={handleCreateNew}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Neuer Prompt</span>
              </button>
            </div>

            {loading ? (
              <div className="text-xs text-gray-400 p-4 text-center">Lade Prompts…</div>
            ) : (
              <div className="space-y-2">
                {prompts.map((p) => {
                  const isSelected = selectedPrompt?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => selectPrompt(p)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-amber-50/40 border-amber-400 shadow-xs'
                          : 'bg-white border-gray-200/80 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-gray-900">{p.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-gray-100 text-gray-600">
                              v{p.version}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
                            {p.description || 'Keine Beschreibung'}
                          </div>
                        </div>

                        {p.is_active ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 shrink-0">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Aktiv
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleActivate(p.id);
                            }}
                            className="text-[10px] text-gray-500 hover:text-amber-700 hover:underline shrink-0"
                          >
                            Aktivieren
                          </button>
                        )}
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                        <span className="font-mono uppercase">{p.schema_type}</span>
                        <span>{p.max_rows_per_chunk} Zeilen/Chunk</span>
                        <span>{p.model.replace('openai/', '')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Prompt Editor (8 cols) */}
          <div className="lg:col-span-8 bg-white border border-gray-200/80 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wider">
                  {selectedPrompt ? `Prompt bearbeiten: ${selectedPrompt.name} (v${selectedPrompt.version})` : 'Neuen Prompt anlegen'}
                </h3>
                <p className="text-[11px] text-gray-400">
                  Speichern erzeugt stets eine neue Version (Revision-Sicherheit).
                </p>
              </div>

              {selectedPrompt && !selectedPrompt.is_active && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleActivate(selectedPrompt.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Als Standard aktivieren</span>
                  </button>
                  <button
                    onClick={() => handleDelete(selectedPrompt.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Löschen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {message && (
              <div
                className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                  message.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                <span>{message.text}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  placeholder="b2b_contact_split"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Schema-Ziel</label>
                <select
                  value={schemaType}
                  onChange={(e) => setSchemaType(e.target.value)}
                  className="w-full text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none bg-white"
                >
                  <option value="*">Alle Schemas (*) — Fallback</option>
                  <option value="contact-first">Contact-Centric (Kontakte zuerst)</option>
                  <option value="company-first">Company-Centric (Firmen zuerst)</option>
                  <option value="mixed">Gemischt (Mixed)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Beschreibung</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                placeholder="Kurzbeschreibung des Zwecks oder der Änderungen"
              />
            </div>

            {/* Variable insertion helper chips */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-700">System-Prompt</label>
                <div className="flex items-center gap-1 text-[11px] text-gray-500">
                  <span className="text-gray-400">Variablen einfügen:</span>
                  <button
                    type="button"
                    onClick={() => insertVariable('schema_type')}
                    className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded font-mono text-[10px] text-gray-700"
                  >
                    schema_type
                  </button>
                  <button
                    type="button"
                    onClick={() => insertVariable('rows_count')}
                    className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded font-mono text-[10px] text-gray-700"
                  >
                    rows_count
                  </button>
                </div>
              </div>

              <textarea
                rows={12}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full text-[11.5px] font-mono leading-relaxed p-3 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-gray-50/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">User-Prompt Template</label>
              <textarea
                rows={2}
                value={userPromptTemplate}
                onChange={(e) => setUserPromptTemplate(e.target.value)}
                className="w-full text-[11.5px] font-mono p-2.5 border border-gray-200 rounded-lg outline-none bg-gray-50/40"
              />
            </div>

            {/* Parameters Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-gray-100">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Modell</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-md bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Zeilen pro Chunk</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxRowsPerChunk}
                  onChange={(e) => setMaxRowsPerChunk(Number(e.target.value))}
                  className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-md bg-white"
                />
                <span className="text-[10px] text-gray-400">Standard: 10 (Sicher)</span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Max Tokens</label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-md bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Temperatur</label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-md bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !name || !systemPrompt}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Wird gespeichert…' : 'Als neue Version speichern'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
