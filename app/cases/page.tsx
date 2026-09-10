"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, Settings, Eye, ChevronRight, Database } from "lucide-react";
import type { Case } from "@/lib/types";
import AppShell from "@/components/AppShell";

export default function CasesPage() {
  const router = useRouter();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [edenApiKey, setEdenApiKey] = useState("");
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/cases")
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(data)) {
          throw new Error((data && data.error) || `HTTP ${r.status}`);
        }
        setCases(data);
        if (data.length === 1) router.push(`/cases/${data[0].id}`);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function createCase() {
    if (!newName.trim()) return;
    const res = await fetch("/api/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        edenApiKey: edenApiKey.trim() || undefined,
      }),
    });
    const c = await res.json();
    router.push(`/cases/${c.id}`);
  }

  async function deleteCase(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this case and all its data?")) return;
    await fetch(`/api/cases/${id}`, { method: "DELETE" });
    setCases((prev) => prev.filter((c) => c.id !== id));
  }

  const filtered = cases.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <AppShell
      title="Alle Cases"
      titleIcon={<Database className="w-4 h-4 text-violet-500" />}
      actions={
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cases suchen…"
              className="w-56 pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 bg-violet-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-violet-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Neuer Case
          </button>
        </div>
      }
    >
      {/* Cases grid */}
      {loading ? (
        <div className="px-4 py-3 text-xs text-gray-400">Lädt…</div>
      ) : loadError ? (
        <div className="px-4 py-3 text-xs text-red-500">Fehler beim Laden: {loadError}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <div className="text-4xl mb-3">📂</div>
          <p className="text-sm">Noch keine Cases. Erstelle deinen ersten.</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700"
          >
            Case erstellen
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => router.push(`/cases/${c.id}`)}
              className="bg-white border border-gray-200 rounded-xl p-5 cursor-pointer hover:border-violet-300 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center text-violet-600 text-sm font-bold">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); router.push(`/cases/${c.id}/settings`); }} className="p-1 text-gray-400 hover:text-gray-600">
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => deleteCase(c.id, e)} className="p-1 text-gray-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="font-medium text-gray-900 text-sm mb-1">{c.name}</div>
              <div className="text-xs text-gray-400 mb-4">
                {c.aiColumns.length} AI-Spalten · {new Date(c.updatedAt).toLocaleDateString("de-DE")}
              </div>
              <div className="flex items-center text-xs text-violet-600 font-medium">
                Öffnen <ChevronRight className="w-3.5 h-3.5 ml-1" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Neuer Case</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Name</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createCase()}
                  placeholder="z.B. Heizung Firmen Q1"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Eden AI API Key (optional)</label>
                <input
                  value={edenApiKey}
                  onChange={(e) => setEdenApiKey(e.target.value)}
                  placeholder="leer = EDEN_API_KEY aus Env"
                  type="password"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">Ein Key für alle Modelle (Eden AI Gateway). Verschlüsselt gespeichert.</p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={createCase} className="flex-1 bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700">
                Erstellen
              </button>
              <button onClick={() => { setCreating(false); setNewName(""); setEdenApiKey(""); }} className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
