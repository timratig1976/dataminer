"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Key, Loader2, Sparkles, Globe, CheckCircle2, Trash2, ChevronRight, Sliders } from "lucide-react";
import AppShell from "@/components/AppShell";

interface SettingsState {
  edenApiKeyMasked?: string;
  edenRegion: "eu" | "us";
  hasKey: boolean;
  envKeyPresent: boolean;
  serperApiKeyMasked?: string;
  serpApiKeyMasked?: string;
  braveApiKeyMasked?: string;
  apifyApiTokenMasked?: string;
  serperEnvPresent?: boolean;
  serpEnvPresent?: boolean;
  braveEnvPresent?: boolean;
  apifyEnvPresent?: boolean;
  updatedAt?: string;
}

interface TestResult {
  ok: boolean;
  region: string;
  checks: Record<string, Record<string, unknown>>;
  error?: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [state, setState] = useState<SettingsState | null>(null);
  const [edenApiKey, setEdenApiKey] = useState("");
  const [edenRegion, setEdenRegion] = useState<"eu" | "us">("eu");
  const [serperApiKey, setSerperApiKey] = useState("");
  const [serpApiKey, setSerpApiKey] = useState("");
  const [braveApiKey, setBraveApiKey] = useState("");
  const [apifyApiToken, setApifyApiToken] = useState("");
  const [searchTestResults, setSearchTestResults] = useState<Record<string, { ok: boolean; hits?: number; sample?: string; error?: string; note?: string } | null>>({});
  const [searchTesting, setSearchTesting] = useState<Record<string, boolean>>({});

  async function testSearchKey(provider: string, key: string) {
    setSearchTesting(prev => ({ ...prev, [provider]: true }));
    setSearchTestResults(prev => ({ ...prev, [provider]: null }));
    try {
      const res = await fetch("/api/settings/test-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: key.trim() || undefined }),
      });
      const data = await res.json();
      setSearchTestResults(prev => ({ ...prev, [provider]: data }));
    } catch (e) {
      setSearchTestResults(prev => ({ ...prev, [provider]: { ok: false, error: (e as Error).message } }));
    } finally {
      setSearchTesting(prev => ({ ...prev, [provider]: false }));
    }
  }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  async function load() {
    try {
      const res = await fetch("/api/settings");
      const data = (await res.json()) as SettingsState;
      setState(data);
      setEdenRegion(data.edenRegion);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: SettingsState) => {
        setState(data);
        setEdenRegion(data.edenRegion);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(edenApiKey.trim() ? { edenApiKey: edenApiKey.trim() } : {}),
          edenRegion,
          ...(serperApiKey.trim() ? { serperApiKey: serperApiKey.trim() } : {}),
          ...(serpApiKey.trim() ? { serpApiKey: serpApiKey.trim() } : {}),
          ...(braveApiKey.trim() ? { braveApiKey: braveApiKey.trim() } : {}),
          ...(apifyApiToken.trim() ? { apifyApiToken: apifyApiToken.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setState((prev) => ({
        edenApiKeyMasked: data.edenApiKeyMasked,
        edenRegion: data.edenRegion,
        hasKey: data.hasKey,
        envKeyPresent: prev?.envKeyPresent ?? false,
        updatedAt: data.updatedAt,
      }));
      setEdenApiKey("");
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    setSaving(true);
    try {
      await fetch("/api/settings", { method: "DELETE" });
      await load();
      setEdenApiKey("");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/llm/eden-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: edenApiKey.trim() || undefined,
          region: edenRegion,
        }),
      });
      setTestResult(await res.json());
    } catch (e) {
      setTestResult({ ok: false, region: edenRegion, checks: {}, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <AppShell
      title="Globale Einstellungen"
      titleIcon={<Globe className="w-4 h-4 text-violet-500" />}
    >
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Eden AI provider card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-500" />
            <h2 className="font-semibold text-gray-900">Eden AI</h2>
            <span className="text-xs text-gray-400">Einziger LLM-Provider — ein Key für alle Modelle</span>
          </div>

          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 leading-relaxed">
            DataMiner nutzt ausschließlich <b>Eden AI</b> als LLM-Gateway (OpenAI-kompatibel unter <code>/v3</code>).
            Ein einziger API-Key bedient alle Modelle (<code>openai/</code>, <code>anthropic/</code>,{" "}
            <code>google/</code>, <code>mistral/</code>, <code>meta/</code> …) sowie Firecrawl-Search/Scrape.
            Kein OpenAI-, Cerebras- oder Anthropic-Key mehr nötig.
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-2">
            {state?.hasKey && (
              <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-1">
                <CheckCircle2 className="w-3 h-3" /> Key in DB gespeichert {state.edenApiKeyMasked ? `(${state.edenApiKeyMasked})` : ""}
              </span>
            )}
            {state?.envKeyPresent && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-1">
                <Key className="w-3 h-3" /> EDEN_API_KEY in Env (Fallback)
              </span>
            )}
            {!state?.hasKey && !state?.envKeyPresent && (
              <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1">
                Kein Key — LLM-Läufe schlagen fehl, bis du einen setzt
              </span>
            )}
          </div>

          {/* Key input */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
              <Key className="w-3 h-3" /> Eden AI API Key
            </label>
            <input
              type="password"
              value={edenApiKey}
              onChange={(e) => setEdenApiKey(e.target.value)}
              placeholder={state?.hasKey ? `Gespeichert: ${state.edenApiKeyMasked}` : "sk-eden-live-..."}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Wird serverseitig AES-verschlüsselt gespeichert. Leer lassen + Speichern behält den bestehenden Key.
            </p>
          </div>

          {/* Region */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Region / Data Residency</label>
            <div className="mt-1 flex gap-2">
              {(["eu", "us"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setEdenRegion(r)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    edenRegion === r
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {r === "eu" ? "EU (api.eu.edenai.run)" : "US (api.edenai.run)"}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              EU = Data Residency (gefiltert auf EU-Provider). US = voller Katalog inkl. OpenAI.
              <span className="text-amber-600"> Firecrawl-Search/Scrape nur am US-Endpoint.</span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedMsg ? "Gespeichert ✓" : "Speichern"}
            </button>
            <button
              onClick={runTest}
              disabled={testing}
              className="flex items-center gap-2 border border-violet-300 text-violet-700 bg-violet-50 px-3 py-2 rounded-lg text-sm font-medium hover:bg-violet-100 disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {testing ? "Teste…" : "Verbindung testen"}
            </button>
            {state?.hasKey && (
              <button
                onClick={removeKey}
                disabled={saving}
                className="flex items-center gap-1.5 border border-red-200 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {testResult && (
            <div className={`rounded-lg border p-3 text-xs space-y-2 ${testResult.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <div className={`font-semibold ${testResult.ok ? "text-green-700" : "text-red-700"}`}>
                {testResult.ok ? "✓ Verbindung erfolgreich" : "✗ Verbindung fehlgeschlagen"}
                <span className="font-normal text-gray-500"> ({testResult.region.toUpperCase()})</span>
              </div>
              {testResult.error && <div className="text-red-700">{testResult.error}</div>}
              {Object.entries(testResult.checks).map(([name, c]) => (
                <div key={name} className="flex items-start gap-2">
                  <span className={c.ok ? "text-green-600" : "text-red-600"}>{c.ok ? "✓" : "✗"}</span>
                  <span className="text-gray-700">
                    {name === "catalog" && <><b>Katalog:</b> {c.ok ? `${c.count} Modelle` : c.error}</>}
                    {name === "chat" && <><b>{`Chat${c.model ? ` (${c.model})` : ""}`}</b>: {c.ok ? `${c.preview || "ok"} · ${c.latencyMs}ms${c.costUsd ? ` · $${Number(c.costUsd).toFixed(6)}` : ""}` : c.error}</>}
                    {name === "firecrawl" && <><b>Firecrawl:</b> {c.ok ? `${c.resultCount} Treffer · ${c.latencyMs}ms` : c.error}</>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info: resolution order */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-xs text-gray-500 space-y-1">
          <div className="font-semibold text-gray-700 mb-1">Key-Auflösungsreihenfolge</div>
          <div>1. Case-eigener Eden-Key (falls im Case gesetzt)</div>
          <div>2. Dieser globale Key (verschlüsselt in der DB)</div>
          <div>3. ENV <code className="font-mono">EDEN_API_KEY</code></div>
        </div>

        {/* Search API Keys */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="font-semibold text-gray-700 text-sm flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-500" /> Such-APIs (Web + Maps)
          </div>
          <div className="text-xs text-gray-500">
            Keys werden verschlüsselt in der DB gespeichert. Cascade: DB-Key → ENV-Variable.
          </div>
          {[
            { id: "serper", label: "Serper.dev", val: serperApiKey, set: setSerperApiKey, masked: state?.serperApiKeyMasked, env: state?.serperEnvPresent, placeholder: "sk-…", url: "https://serper.dev", badge: "Empfohlen · 2.500 free/Monat", desc: "Google-Suche + Google Places", testProviders: ["serper", "serper-places"] },
            { id: "serp", label: "SerpApi", val: serpApiKey, set: setSerpApiKey, masked: state?.serpApiKeyMasked, env: state?.serpEnvPresent, placeholder: "…", url: "https://serpapi.com", badge: "100 free/Monat", desc: "Google Maps structured (engine=google_maps)", testProviders: ["serp"] },
            { id: "brave", label: "Brave Search", val: braveApiKey, set: setBraveApiKey, masked: state?.braveApiKeyMasked, env: state?.braveEnvPresent, placeholder: "BSA…", url: "https://brave.com/search/api", badge: "2.000 free/Monat", desc: "Alternativer Web-Search Layer", testProviders: ["brave"] },
            { id: "apify", label: "Apify", val: apifyApiToken, set: setApifyApiToken, masked: state?.apifyApiTokenMasked, env: state?.apifyEnvPresent, placeholder: "apify_api_…", url: "https://console.apify.com/settings/integrations", badge: "$1.50/1000 Places", desc: "Google Maps Scraper Actor — kein Rate-Limit, >120 Ergebnisse", testProviders: ["apify"] },
          ].map(({ id, label, val, set, masked, env, placeholder, url, badge, desc, testProviders }) => (
            <div key={id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-gray-700">{label}</label>
                <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">{badge}</span>
                <span className="text-[10px] text-gray-400">{desc}</span>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline ml-auto">→ Key holen</a>
              </div>
              <div className="flex gap-2 items-center">
                <input
                  type="password"
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  placeholder={masked ? `Gespeichert: ${masked}` : env ? "In ENV gesetzt" : placeholder}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {(masked || env) && (
                  <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${masked ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {masked ? "✓ DB" : "ENV"}
                  </span>
                )}
                {testProviders.map(tp => (
                  <button key={tp} onClick={() => testSearchKey(tp, val)}
                    disabled={searchTesting[tp] || (!val.trim() && !masked && !env)}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap">
                    {searchTesting[tp] ? <Loader2 className="w-3 h-3 animate-spin" /> : "▶"}
                    {tp === "serper-places" ? "Places testen" : "Testen"}
                  </button>
                ))}
              </div>
              {/* Test results */}
              {testProviders.map(tp => searchTestResults[tp] && (
                <div key={tp} className={`text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${searchTestResults[tp]!.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
                  <span>{searchTestResults[tp]!.ok ? "✓" : "✗"}</span>
                  {searchTestResults[tp]!.ok
                    ? <span>{searchTestResults[tp]!.hits} Treffer · <em>{searchTestResults[tp]!.sample}</em> · <span className="text-gray-400">{searchTestResults[tp]!.note}</span></span>
                    : <span>{searchTestResults[tp]!.error}</span>
                  }
                </div>
              ))}
            </div>
          ))}
          <p className="text-[10px] text-gray-400">
            Leer lassen = Wert wird nicht geändert. Leerstellen eingeben + Speichern = Key löschen.
          </p>
          <button
            onClick={save}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savedMsg ? "Gespeichert ✓" : "Such-Keys speichern"}
          </button>
        </div>

        {/* Navigation to sub-pages */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => router.push("/settings/models")}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left border-t border-gray-100"
          >
            <Sliders className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">Modell-Auswahl</div>
              <div className="text-xs text-gray-400">Welche KI-Modelle im Spalten-Editor angeboten werden</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </button>
          <button
            onClick={() => router.push("/settings/llm-test")}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left border-t border-gray-100"
          >
            <Sparkles className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">LLM-Testing</div>
              <div className="text-xs text-gray-400">Smoke Test, Modelle vergleichen, Latenz messen</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </button>
        </div>
      </div>
    </AppShell>
  );
}
