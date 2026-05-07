"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Key, Loader2, Trash2, Sparkles, GripVertical } from "lucide-react";
import type { Case, AiColumn } from "@/lib/types";
import { randomUUID } from "@/lib/utils";

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = use(params);
  const router = useRouter();
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingCol, setEditingCol] = useState<AiColumn | null>(null);

  useEffect(() => {
    fetch(`/api/cases/${caseId}`)
      .then((r) => r.json())
      .then((c) => {
        setCaseData(c);
        setName(c.name);
        setApiKey(c.apiKey || "");
      });
  }, [caseId]);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), apiKey: apiKey.trim() || undefined }),
    });
    setCaseData(await res.json());
    setSaving(false);
  }

  async function saveColumns(cols: AiColumn[]) {
    const res = await fetch(`/api/cases/${caseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiColumns: cols }),
    });
    const updated = await res.json();
    setCaseData(updated);
    return updated;
  }

  async function saveColEdit() {
    if (!editingCol || !caseData) return;
    const cols = caseData.aiColumns.map((c) => (c.id === editingCol.id ? editingCol : c));
    await saveColumns(cols);
    setEditingCol(null);
  }

  if (!caseData) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-5 h-5 animate-spin text-violet-500" /></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push(`/cases/${caseId}`)} className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-700">{caseData.name}</span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-500">Settings</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        {/* Case settings */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">General</h2>
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Case Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
              <Key className="w-3 h-3" /> OpenAI API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-gray-400 mt-1">Stored locally in SQLite. Falls back to OPENAI_API_KEY env var.</p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>

        {/* AI Columns */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">AI Columns</h2>
            <span className="text-xs text-gray-400">{caseData.aiColumns.length} columns</span>
          </div>

          <div className="space-y-2">
            {caseData.aiColumns.map((col) => (
              <div key={col.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                  onClick={() => setEditingCol(editingCol?.id === col.id ? null : { ...col })}
                >
                  <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{col.name}</div>
                    <div className="text-xs text-gray-400 font-mono truncate">→ {col.outputKey}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete "${col.name}"?`)) return;
                      const cols = caseData.aiColumns.filter((c) => c.id !== col.id);
                      saveColumns(cols);
                    }}
                    className="text-gray-300 hover:text-red-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {editingCol?.id === col.id && (
                  <div className="border-t border-gray-100 p-4 space-y-3 bg-gray-50">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-500">Name</label>
                        <input
                          value={editingCol.name}
                          onChange={(e) => setEditingCol({ ...editingCol, name: e.target.value })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Output Key</label>
                        <input
                          value={editingCol.outputKey}
                          onChange={(e) => setEditingCol({ ...editingCol, outputKey: e.target.value })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Prompt</label>
                      <textarea
                        value={editingCol.prompt}
                        onChange={(e) => setEditingCol({ ...editingCol, prompt: e.target.value })}
                        rows={5}
                        className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-500">Model</label>
                        <select
                          value={editingCol.model || "gpt-4o-mini"}
                          onChange={(e) => setEditingCol({ ...editingCol, model: e.target.value })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
                        >
                          <option>gpt-4o-mini</option>
                          <option>gpt-4o</option>
                          <option>gpt-4-turbo</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Condition</label>
                        <select
                          value={editingCol.condition || ""}
                          onChange={(e) => setEditingCol({ ...editingCol, condition: (e.target.value || undefined) as AiColumn["condition"] })}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none"
                        >
                          <option value="">Always</option>
                          <option value="require_input">Only if input field present</option>
                          <option value="empty">If output cell empty (no re-run)</option>
                          <option value="not_empty">If output cell has value</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Condition Field</label>
                        <input
                          value={editingCol.conditionField || ""}
                          onChange={(e) => setEditingCol({ ...editingCol, conditionField: e.target.value || undefined })}
                          disabled={!editingCol.condition}
                          className="mt-1 w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none disabled:opacity-40"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={saveColEdit} className="bg-violet-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-violet-700">Save</button>
                      <button onClick={() => setEditingCol(null)} className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {caseData.aiColumns.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">No AI columns yet. Add one from the table view.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
