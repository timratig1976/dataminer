"use client";

import { useEffect, useState } from "react";
import { Plus, X, ChevronUp, ChevronDown, RotateCcw, Check, Info, Search, Sliders } from "lucide-react";
import AppShell from "@/components/AppShell";

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

const FIRECRAWL_COSTS = [
  { name: "Web-Suche (basic)", desc: "1–10 Ergebnisse", costPerCall: "$0.001/Ergebnis" },
  { name: "Web-Suche (deep)", desc: "Mehr Ergebnisse, Seiten scrapen", costPerCall: "$0.003/Ergebnis" },
  { name: "Seite scrapen", desc: "Einzelne URL → Markdown", costPerCall: "$0.001–0.003/Seite" },
  { name: "Katalog scrapen", desc: "Paginierte Katalogseite", costPerCall: "$0.002–0.005/Seite" },
];

const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "bg-green-100 text-green-700",
  Anthropic: "bg-orange-100 text-orange-700",
  Mistral: "bg-blue-100 text-blue-700",
  Google: "bg-yellow-100 text-yellow-700",
  Meta: "bg-purple-100 text-purple-700",
};

export default function ModelsSettingsPage() {
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setAllowlist(d.modelAllowlist ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save(list: string[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAllowlist: list }),
      });
      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggle(modelId: string) {
    const next = allowlist.includes(modelId)
      ? allowlist.filter((m) => m !== modelId)
      : [...allowlist, modelId];
    setAllowlist(next);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...allowlist];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setAllowlist(next);
  }

  function moveDown(idx: number) {
    if (idx >= allowlist.length - 1) return;
    const next = [...allowlist];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setAllowlist(next);
  }

  function addCustom() {
    const m = customInput.trim();
    if (!m || allowlist.includes(m)) return;
    setAllowlist([...allowlist, m]);
    setCustomInput("");
  }

  function resetToDefault() {
    setAllowlist(DEFAULT_MODELS.map((m) => m.id));
  }

  if (loading) return (
    <AppShell title="Modell-Auswahl" titleIcon={<Sliders className="w-4 h-4" style={{ color: "var(--orange)" }} />}>
      <div className="flex items-center justify-center h-64 text-xs" style={{ color: "var(--text-3)" }}>Laden…</div>
    </AppShell>
  );

  return (
    <AppShell title="Modell-Auswahl" titleIcon={<Sliders className="w-4 h-4" style={{ color: "var(--orange)" }} />}>
      <div className="max-w-2xl mx-auto space-y-5 pb-12">

        {/* Info card */}
        <div
          className="p-5 text-xs space-y-2"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
            color: "var(--text-2)",
          }}
        >
          <p className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>🎛 Globale Modell-Curation</p>
          <p>
            Hier legst du fest, welche KI-Modelle in <b>allen Cases</b> zur Auswahl stehen — beim Erstellen und Bearbeiten von KI-Spalten.
            Diese Liste gilt <b>systemweit</b>; einzelne Cases erben sie automatisch.
          </p>
          <p style={{ color: "var(--text-3)" }}>
            Leere Liste = alle Default-Modelle werden überall angezeigt. Format: <code>provider/modell-id</code> (Eden AI, z.B. <code>openai/gpt-4o-mini</code>).
          </p>
        </div>

        {/* Available models (toggle) */}
        <div
          className="p-5 space-y-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Verfügbare Modelle</p>
          <div className="space-y-2">
            {DEFAULT_MODELS.map((m) => {
              const active = allowlist.length === 0 || allowlist.includes(m.id);
              return (
                <label
                  key={m.id}
                  className="flex items-center gap-3 p-2.5 rounded border cursor-pointer transition-colors"
                  style={{
                    borderColor: active ? "var(--orange-mid)" : "var(--border-xs)",
                    background: active ? "var(--orange-soft)" : "var(--surface)",
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ accentColor: "var(--orange)" }}
                    checked={active}
                    onChange={() => {
                      if (allowlist.length === 0) {
                        setAllowlist(DEFAULT_MODELS.map((x) => x.id).filter((id) => id !== m.id));
                      } else {
                        toggle(m.id);
                      }
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs" style={{ color: "var(--text-1)" }}>{m.label}</span>
                      <span className="text-[10.5px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-700">
                        {m.provider}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono mt-0.5" style={{ color: "var(--text-3)" }}>{m.id}</div>
                    <div className="text-[11px] flex items-center gap-3 flex-wrap mt-0.5" style={{ color: "var(--text-2)" }}>
                      <span>{m.note}</span>
                      <span style={{ color: "var(--orange)", fontWeight: 500 }} title="pro 1K Input-Tokens">{m.costPer1kPrompt} / 1K in</span>
                      <span style={{ color: "var(--green)", fontWeight: 500 }} title="pro 1K Output-Tokens">{m.costPer1kOutput} / 1K out</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Active allowlist with ordering */}
        {allowlist.length > 0 && (
          <div
            className="p-5 space-y-3"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>Reihenfolge (Dropdown-Sortierung)</p>
            <div className="space-y-1.5">
              {allowlist.map((modelId, idx) => {
                const def = DEFAULT_MODELS.find((m) => m.id === modelId);
                return (
                  <div key={modelId} className="flex items-center gap-2 px-3 py-1.5 rounded border" style={{ background: "var(--bg)", borderColor: "var(--border-xs)" }}>
                    <span className="text-xs w-5 text-center" style={{ color: "var(--text-3)" }}>{idx + 1}</span>
                    <span className="flex-1 text-xs font-mono truncate" style={{ color: "var(--text-1)" }}>{def?.label ?? modelId}</span>
                    {def && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">
                        {def.provider}
                      </span>
                    )}
                    <div className="flex gap-1">
                      <button onClick={() => moveUp(idx)} disabled={idx === 0} className="p-1 rounded cursor-pointer disabled:opacity-30">
                        <ChevronUp className="w-3 h-3 text-gray-500" />
                      </button>
                      <button onClick={() => moveDown(idx)} disabled={idx >= allowlist.length - 1} className="p-1 rounded cursor-pointer disabled:opacity-30">
                        <ChevronDown className="w-3 h-3 text-gray-500" />
                      </button>
                      <button onClick={() => setAllowlist(allowlist.filter((_, i) => i !== idx))} className="p-1 rounded cursor-pointer hover:text-red-600 text-gray-400">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom model input */}
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
                style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text-1)" }}
                placeholder='Eigenes Modell, z.B. "openai/o3-mini"'
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
              />
              <button
                onClick={addCustom}
                disabled={!customInput.trim()}
                className="btn-v2"
              >
                <Plus className="w-3.5 h-3.5" /> Hinzufügen
              </button>
            </div>
          </div>
        )}

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => save(allowlist)}
            disabled={saving}
            className="btn-v2 btn-v2-primary"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : null}
            {saved ? "Gespeichert ✓" : saving ? "Speichern…" : "Einstellungen speichern"}
          </button>
          <button
            onClick={resetToDefault}
            className="btn-v2"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Auf Standard zurücksetzen
          </button>
        </div>

        {error && <div className="text-xs p-2 rounded" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>{error}</div>}
      </div>
    </AppShell>
  );
                <Plus className="w-3.5 h-3.5" /> Hinzufügen
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        {/* ── Firecrawl / Scraping-Kosten ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-500" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Scraping & Discovery (Firecrawl via Eden AI)</p>
          </div>
          <p className="text-xs text-gray-400">
            Diese Kosten fallen bei Web-Suche, Seiten-Scraping und Katalog-Crawling an — unabhängig vom gewählten LLM-Modell.
            Firecrawl ist nur auf dem <b>US-Endpunkt</b> verfügbar.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {FIRECRAWL_COSTS.map((fc) => (
              <div key={fc.name} className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                <div className="text-sm font-medium text-gray-800">{fc.name}</div>
                <div className="text-xs text-gray-500">{fc.desc}</div>
                <div className="text-xs font-semibold text-amber-700 mt-1">{fc.costPerCall}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => save(allowlist)}
            disabled={saving}
            className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : null}
            {saving ? "Speichern…" : saved ? "Gespeichert ✓" : "Speichern"}
          </button>
          <button
            onClick={() => { resetToDefault(); }}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-lg text-sm hover:bg-gray-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Zurücksetzen
          </button>
        </div>

        {/* Preview */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vorschau — aktive Modelle im Dropdown</p>
          <div className="flex flex-wrap gap-1.5">
            {effectiveList.map((id) => {
              const def = DEFAULT_MODELS.find((m) => m.id === id);
              return (
                <span key={id} className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
                  {def?.label ?? id}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
