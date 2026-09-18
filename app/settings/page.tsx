"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Key, Loader2, Sparkles, Globe, CheckCircle2, Trash2, ChevronRight, Sliders, Flame, Search } from "lucide-react";
import AppShell from "@/components/AppShell";

interface SettingsState {
  edenApiKeyMasked?: string;
  edenRegion: "eu" | "us";
  hasKey: boolean;
  envKeyPresent: boolean;
  firecrawlApiKeyMasked?: string;
  hasFirecrawlKey?: boolean;
  firecrawlEnvPresent?: boolean;
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
  const [loading, setLoading] = useState(true);

  // ── Eden AI state ──
  const [edenApiKey, setEdenApiKey] = useState("");
  const [edenRegion, setEdenRegion] = useState<"eu" | "us">("eu");
  const [savingEden, setSavingEden] = useState(false);
  const [savedEdenMsg, setSavedEdenMsg] = useState(false);
  const [testingEden, setTestingEden] = useState(false);
  const [edenTestResult, setEdenTestResult] = useState<TestResult | null>(null);
  const [edenError, setEdenError] = useState<string | undefined>(undefined);

  // ── Firecrawl state ──
  const [firecrawlApiKey, setFirecrawlApiKey] = useState("");
  const [savingFirecrawl, setSavingFirecrawl] = useState(false);
  const [savedFirecrawlMsg, setSavedFirecrawlMsg] = useState(false);
  const [testingFirecrawl, setTestingFirecrawl] = useState(false);
  const [firecrawlTestResult, setFirecrawlTestResult] = useState<{ ok: boolean; hits?: number; sample?: string; error?: string; note?: string } | null>(null);
  const [firecrawlError, setFirecrawlError] = useState<string | undefined>(undefined);

  // ── Search APIs state ──
  const [serperApiKey, setSerperApiKey] = useState("");
  const [serpApiKey, setSerpApiKey] = useState("");
  const [braveApiKey, setBraveApiKey] = useState("");
  const [apifyApiToken, setApifyApiToken] = useState("");
  const [savingSearchKey, setSavingSearchKey] = useState<Record<string, boolean>>({});
  const [savedSearchKeyMsg, setSavedSearchKeyMsg] = useState<Record<string, boolean>>({});
  const [savingAllSearch, setSavingAllSearch] = useState(false);
  const [savedAllSearchMsg, setSavedAllSearchMsg] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);

  const [searchTestResults, setSearchTestResults] = useState<Record<string, { ok: boolean; hits?: number; sample?: string; error?: string; note?: string } | null>>({});
  const [searchTesting, setSearchTesting] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: SettingsState) => {
        setState(data);
        setEdenRegion(data.edenRegion);
      })
      .catch((e) => setEdenError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function patchSettings(patch: Record<string, unknown>) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    setState(data);
    return data;
  }

  async function deleteKey(key: string) {
    const res = await fetch(`/api/settings?key=${key}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    setState(data);
    return data;
  }

  // ── Eden actions ──
  async function saveEden() {
    setSavingEden(true);
    setEdenError(undefined);
    try {
      await patchSettings({
        ...(edenApiKey.trim() ? { edenApiKey: edenApiKey.trim() } : {}),
        edenRegion,
      });
      setEdenApiKey("");
      setSavedEdenMsg(true);
      setTimeout(() => setSavedEdenMsg(false), 2000);
    } catch (e) {
      setEdenError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEden(false);
    }
  }

  async function removeEdenKey() {
    setSavingEden(true);
    setEdenError(undefined);
    try {
      await deleteKey("eden");
      setEdenApiKey("");
    } catch (e) {
      setEdenError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEden(false);
    }
  }

  async function runEdenTest() {
    setTestingEden(true);
    setEdenTestResult(null);
    try {
      const res = await fetch("/api/llm/eden-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: edenApiKey.trim() || undefined,
          region: edenRegion,
        }),
      });
      setEdenTestResult(await res.json());
    } catch (e) {
      setEdenTestResult({ ok: false, region: edenRegion, checks: {}, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestingEden(false);
    }
  }

  // ── Firecrawl actions ──
  async function saveFirecrawl() {
    setSavingFirecrawl(true);
    setFirecrawlError(undefined);
    try {
      await patchSettings({
        firecrawlApiKey: firecrawlApiKey.trim(),
      });
      setFirecrawlApiKey("");
      setSavedFirecrawlMsg(true);
      setTimeout(() => setSavedFirecrawlMsg(false), 2000);
    } catch (e) {
      setFirecrawlError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFirecrawl(false);
    }
  }

  async function removeFirecrawlKey() {
    setSavingFirecrawl(true);
    setFirecrawlError(undefined);
    try {
      await deleteKey("firecrawl");
      setFirecrawlApiKey("");
    } catch (e) {
      setFirecrawlError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFirecrawl(false);
    }
  }

  async function testFirecrawl() {
    setTestingFirecrawl(true);
    setFirecrawlTestResult(null);
    try {
      const res = await fetch("/api/settings/test-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "firecrawl",
          apiKey: firecrawlApiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      setFirecrawlTestResult(data);
    } catch (e) {
      setFirecrawlTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTestingFirecrawl(false);
    }
  }

  // ── Search key actions ──
  async function saveSingleSearchKey(field: "serperApiKey" | "serpApiKey" | "braveApiKey" | "apifyApiToken", value: string) {
    const keyId = field.replace("ApiKey", "").replace("ApiToken", "");
    setSavingSearchKey(prev => ({ ...prev, [keyId]: true }));
    setSearchError(undefined);
    try {
      await patchSettings({ [field]: value.trim() });
      if (field === "serperApiKey") setSerperApiKey("");
      if (field === "serpApiKey") setSerpApiKey("");
      if (field === "braveApiKey") setBraveApiKey("");
      if (field === "apifyApiToken") setApifyApiToken("");
      setSavedSearchKeyMsg(prev => ({ ...prev, [keyId]: true }));
      setTimeout(() => setSavedSearchKeyMsg(prev => ({ ...prev, [keyId]: false })), 2000);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSearchKey(prev => ({ ...prev, [keyId]: false }));
    }
  }

  async function removeSingleSearchKey(keyId: "serper" | "serp" | "brave" | "apify") {
    setSavingSearchKey(prev => ({ ...prev, [keyId]: true }));
    setSearchError(undefined);
    try {
      await deleteKey(keyId);
      if (keyId === "serper") setSerperApiKey("");
      if (keyId === "serp") setSerpApiKey("");
      if (keyId === "brave") setBraveApiKey("");
      if (keyId === "apify") setApifyApiToken("");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSearchKey(prev => ({ ...prev, [keyId]: false }));
    }
  }

  async function saveAllSearchKeys() {
    setSavingAllSearch(true);
    setSearchError(undefined);
    try {
      const patch: Record<string, string> = {};
      if (serperApiKey.trim()) patch.serperApiKey = serperApiKey.trim();
      if (serpApiKey.trim()) patch.serpApiKey = serpApiKey.trim();
      if (braveApiKey.trim()) patch.braveApiKey = braveApiKey.trim();
      if (apifyApiToken.trim()) patch.apifyApiToken = apifyApiToken.trim();

      if (Object.keys(patch).length === 0) {
        setSavedAllSearchMsg(true);
        setTimeout(() => setSavedAllSearchMsg(false), 2000);
        return;
      }

      await patchSettings(patch);
      setSerperApiKey("");
      setSerpApiKey("");
      setBraveApiKey("");
      setApifyApiToken("");
      setSavedAllSearchMsg(true);
      setTimeout(() => setSavedAllSearchMsg(false), 2000);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAllSearch(false);
    }
  }

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
      <div className="max-w-2xl mx-auto space-y-6 pb-12">
        {/* ── 1. Eden AI provider card ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-violet-500" />
            <h2 className="font-semibold text-gray-900">Eden AI (LLM Gateway)</h2>
            <span className="text-xs text-gray-400">Einziger LLM-Provider — ein Key für alle Modelle</span>
          </div>

          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 leading-relaxed">
            DataMiner nutzt ausschließlich <b>Eden AI</b> als LLM-Gateway (OpenAI-kompatibel unter <code>/v3</code>).
            Ein einziger API-Key bedient alle Chat- und Reasoning-Modelle (<code>openai/</code>, <code>anthropic/</code>,{" "}
            <code>google/</code>, <code>mistral/</code>, <code>meta/</code> …).
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
              Wird serverseitig AES-verschlüsselt gespeichert.
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
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={saveEden}
              disabled={savingEden || (!edenApiKey.trim() && edenRegion === state?.edenRegion)}
              className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-2xs"
            >
              {savingEden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedEdenMsg ? "Gespeichert ✓" : "Speichern"}
            </button>
            <button
              onClick={runEdenTest}
              disabled={testingEden}
              className="flex items-center gap-2 border border-violet-300 text-violet-700 bg-violet-50 px-3 py-2 rounded-lg text-sm font-medium hover:bg-violet-100 disabled:opacity-50 transition-colors"
            >
              {testingEden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {testingEden ? "Teste…" : "Verbindung testen"}
            </button>
            {state?.hasKey && (
              <button
                onClick={removeEdenKey}
                disabled={savingEden}
                className="flex items-center gap-1.5 border border-red-200 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 ml-auto transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {edenError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{edenError}</div>}

          {edenTestResult && (
            <div className={`rounded-lg border p-3 text-xs space-y-2 ${edenTestResult.ok ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
              <div className={`font-semibold ${edenTestResult.ok ? "text-green-700" : "text-red-700"}`}>
                {edenTestResult.ok ? "✓ Verbindung erfolgreich" : "✗ Verbindung fehlgeschlagen"}
                <span className="font-normal text-gray-500"> ({edenTestResult.region.toUpperCase()})</span>
              </div>
              {edenTestResult.error && <div className="text-red-700">{edenTestResult.error}</div>}
              {Object.entries(edenTestResult.checks).map(([name, c]) => (
                <div key={name} className="flex items-start gap-2">
                  <span className={c.ok ? "text-green-600" : "text-red-600"}>{c.ok ? "✓" : "✗"}</span>
                  <span className="text-gray-700">
                    {name === "catalog" && <><b>Katalog:</b> {c.ok ? `${c.count} Modelle` : c.error}</>}
                    {name === "chat" && <><b>{`Chat${c.model ? ` (${c.model})` : ""}`}</b>: {c.ok ? `${c.preview || "ok"} · ${c.latencyMs}ms${c.costUsd ? ` · $${Number(c.costUsd).toFixed(6)}` : ""}` : c.error}</>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 2. Firecrawl Scraper & Search ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center border border-orange-100">
                <Flame className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Firecrawl</h3>
                <p className="text-xs text-gray-400">Web-Scraper & Web-Search API</p>
              </div>
            </div>

            {/* Badges */}
            <div>
              {state?.hasFirecrawlKey ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.firecrawlApiKeyMasked})
                </span>
              ) : state?.firecrawlEnvPresent ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 font-medium">
                  <Key className="w-3 h-3" /> ENV: FIRECRAWL_API_KEY
                </span>
              ) : (
                <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                  Nicht hinterlegt (Fallback: Eden AI)
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider block mb-1">
              Firecrawl API Key
            </label>
            <input
              type="password"
              value={firecrawlApiKey}
              onChange={(e) => setFirecrawlApiKey(e.target.value)}
              placeholder={
                state?.hasFirecrawlKey
                  ? `Gespeichert: ${state.firecrawlApiKeyMasked}`
                  : state?.firecrawlEnvPresent
                  ? "In ENV gesetzt (FIRECRAWL_API_KEY)"
                  : "fc-..."
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t border-gray-100">
            <button
              onClick={saveFirecrawl}
              disabled={savingFirecrawl || !firecrawlApiKey.trim()}
              className="flex items-center gap-1.5 bg-orange-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-700 disabled:opacity-40 transition-colors shadow-2xs"
            >
              {savingFirecrawl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedFirecrawlMsg ? "Gespeichert ✓" : "Speichern"}
            </button>

            <button
              onClick={testFirecrawl}
              disabled={
                testingFirecrawl ||
                (!firecrawlApiKey.trim() && !state?.hasFirecrawlKey && !state?.firecrawlEnvPresent)
              }
              className="flex items-center gap-1.5 border border-orange-200 text-orange-700 bg-orange-50 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-orange-100 disabled:opacity-40 transition-colors"
            >
              {testingFirecrawl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
              {testingFirecrawl ? "Teste Scraper..." : "Scraper testen"}
            </button>

            {state?.hasFirecrawlKey && (
              <button
                onClick={removeFirecrawlKey}
                disabled={savingFirecrawl}
                className="flex items-center gap-1 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ml-auto transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {firecrawlError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{firecrawlError}</div>}

          {firecrawlTestResult && (
            <div className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${firecrawlTestResult.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              <span>{firecrawlTestResult.ok ? "✓" : "✗"}</span>
              {firecrawlTestResult.ok ? (
                <span>Erfolgreich: <em>{firecrawlTestResult.sample}</em> · <span className="text-gray-500">{firecrawlTestResult.note}</span></span>
              ) : (
                <span>{firecrawlTestResult.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── 3. Serper.dev Widget ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                <Search className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Serper.dev</h3>
                <p className="text-xs text-gray-400">Google Suche + Google Places (2.500 free/Monat)</p>
              </div>
            </div>

            <div>
              {state?.serperApiKeyMasked ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.serperApiKeyMasked})
                </span>
              ) : state?.serperEnvPresent ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 font-medium">
                  <Key className="w-3 h-3" /> ENV: SERPER_API_KEY
                </span>
              ) : (
                <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider block mb-1">
              Serper API Key
            </label>
            <input
              type="password"
              value={serperApiKey}
              onChange={(e) => setSerperApiKey(e.target.value)}
              placeholder={
                state?.serperApiKeyMasked
                  ? `Gespeichert: ${state.serperApiKeyMasked}`
                  : state?.serperEnvPresent
                  ? "In ENV gesetzt (SERPER_API_KEY)"
                  : "sk-..."
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t border-gray-100 flex-wrap">
            <button
              onClick={() => saveSingleSearchKey("serperApiKey", serperApiKey)}
              disabled={savingSearchKey.serper || !serperApiKey.trim()}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-2xs"
            >
              {savingSearchKey.serper ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedSearchKeyMsg.serper ? "Gespeichert ✓" : "Speichern"}
            </button>

            <button
              onClick={() => testSearchKey("serper", serperApiKey)}
              disabled={
                searchTesting.serper ||
                (!serperApiKey.trim() && !state?.serperApiKeyMasked && !state?.serperEnvPresent)
              }
              className="flex items-center gap-1 border border-gray-200 text-gray-700 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors"
            >
              {searchTesting.serper ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Web-Suche testen
            </button>

            <button
              onClick={() => testSearchKey("serper-places", serperApiKey)}
              disabled={
                searchTesting["serper-places"] ||
                (!serperApiKey.trim() && !state?.serperApiKeyMasked && !state?.serperEnvPresent)
              }
              className="flex items-center gap-1 border border-gray-200 text-gray-700 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors"
            >
              {searchTesting["serper-places"] ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span className="text-xs">📍</span>
              )}
              Places testen
            </button>

            {state?.serperApiKeyMasked && (
              <button
                onClick={() => removeSingleSearchKey("serper")}
                disabled={savingSearchKey.serper}
                className="flex items-center gap-1 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ml-auto transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {["serper", "serper-places"].map(
            (tp) =>
              searchTestResults[tp] && (
                <div
                  key={tp}
                  className={`text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${
                    searchTestResults[tp]!.ok
                      ? "bg-green-50 border border-green-200 text-green-800"
                      : "bg-red-50 border border-red-200 text-red-700"
                  }`}
                >
                  <span>{searchTestResults[tp]!.ok ? "✓" : "✗"}</span>
                  {searchTestResults[tp]!.ok ? (
                    <span>
                      {searchTestResults[tp]!.hits} Treffer · <em>{searchTestResults[tp]!.sample}</em> ·{" "}
                      <span className="text-gray-500">{searchTestResults[tp]!.note}</span>
                    </span>
                  ) : (
                    <span>{searchTestResults[tp]!.error}</span>
                  )}
                </div>
              )
          )}
        </div>

        {/* ── 4. SerpApi Widget ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">SerpApi</h3>
                <p className="text-xs text-gray-400">Google Maps structured (100 free/Monat)</p>
              </div>
            </div>

            <div>
              {state?.serpApiKeyMasked ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.serpApiKeyMasked})
                </span>
              ) : state?.serpEnvPresent ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 font-medium">
                  <Key className="w-3 h-3" /> ENV: SERP_API_KEY
                </span>
              ) : (
                <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider block mb-1">
              SerpApi Key
            </label>
            <input
              type="password"
              value={serpApiKey}
              onChange={(e) => setSerpApiKey(e.target.value)}
              placeholder={
                state?.serpApiKeyMasked
                  ? `Gespeichert: ${state.serpApiKeyMasked}`
                  : state?.serpEnvPresent
                  ? "In ENV gesetzt (SERP_API_KEY)"
                  : "..."
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t border-gray-100">
            <button
              onClick={() => saveSingleSearchKey("serpApiKey", serpApiKey)}
              disabled={savingSearchKey.serp || !serpApiKey.trim()}
              className="flex items-center gap-1.5 bg-emerald-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-2xs"
            >
              {savingSearchKey.serp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedSearchKeyMsg.serp ? "Gespeichert ✓" : "Speichern"}
            </button>

            <button
              onClick={() => testSearchKey("serp", serpApiKey)}
              disabled={
                searchTesting.serp ||
                (!serpApiKey.trim() && !state?.serpApiKeyMasked && !state?.serpEnvPresent)
              }
              className="flex items-center gap-1 border border-gray-200 text-gray-700 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors"
            >
              {searchTesting.serp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Testen
            </button>

            {state?.serpApiKeyMasked && (
              <button
                onClick={() => removeSingleSearchKey("serp")}
                disabled={savingSearchKey.serp}
                className="flex items-center gap-1 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ml-auto transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {searchTestResults.serp && (
            <div
              className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${
                searchTestResults.serp.ok
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              <span>{searchTestResults.serp.ok ? "✓" : "✗"}</span>
              {searchTestResults.serp.ok ? (
                <span>
                  {searchTestResults.serp.hits} Treffer · <em>{searchTestResults.serp.sample}</em> ·{" "}
                  <span className="text-gray-500">{searchTestResults.serp.note}</span>
                </span>
              ) : (
                <span>{searchTestResults.serp.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── 5. Brave Search Widget ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
                <Search className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Brave Search</h3>
                <p className="text-xs text-gray-400">Unabhängiger Web-Search Layer (2.000 free/Monat)</p>
              </div>
            </div>

            <div>
              {state?.braveApiKeyMasked ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.braveApiKeyMasked})
                </span>
              ) : state?.braveEnvPresent ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 font-medium">
                  <Key className="w-3 h-3" /> ENV: BRAVE_API_KEY
                </span>
              ) : (
                <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider block mb-1">
              Brave Search Key
            </label>
            <input
              type="password"
              value={braveApiKey}
              onChange={(e) => setBraveApiKey(e.target.value)}
              placeholder={
                state?.braveApiKeyMasked
                  ? `Gespeichert: ${state.braveApiKeyMasked}`
                  : state?.braveEnvPresent
                  ? "In ENV gesetzt (BRAVE_API_KEY)"
                  : "BSA..."
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t border-gray-100">
            <button
              onClick={() => saveSingleSearchKey("braveApiKey", braveApiKey)}
              disabled={savingSearchKey.brave || !braveApiKey.trim()}
              className="flex items-center gap-1.5 bg-amber-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-40 transition-colors shadow-2xs"
            >
              {savingSearchKey.brave ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedSearchKeyMsg.brave ? "Gespeichert ✓" : "Speichern"}
            </button>

            <button
              onClick={() => testSearchKey("brave", braveApiKey)}
              disabled={
                searchTesting.brave ||
                (!braveApiKey.trim() && !state?.braveApiKeyMasked && !state?.braveEnvPresent)
              }
              className="flex items-center gap-1 border border-gray-200 text-gray-700 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors"
            >
              {searchTesting.brave ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Testen
            </button>

            {state?.braveApiKeyMasked && (
              <button
                onClick={() => removeSingleSearchKey("brave")}
                disabled={savingSearchKey.brave}
                className="flex items-center gap-1 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ml-auto transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {searchTestResults.brave && (
            <div
              className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${
                searchTestResults.brave.ok
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              <span>{searchTestResults.brave.ok ? "✓" : "✗"}</span>
              {searchTestResults.brave.ok ? (
                <span>
                  {searchTestResults.brave.hits} Treffer · <em>{searchTestResults.brave.sample}</em> ·{" "}
                  <span className="text-gray-500">{searchTestResults.brave.note}</span>
                </span>
              ) : (
                <span>{searchTestResults.brave.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── 6. Apify Widget ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-50 text-cyan-600 flex items-center justify-center border border-cyan-100">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Apify</h3>
                <p className="text-xs text-gray-400">Google Maps Scraper Actor (&gt;120 Treffer pro Lauf)</p>
              </div>
            </div>

            <div>
              {state?.apifyApiTokenMasked ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.apifyApiTokenMasked})
                </span>
              ) : state?.apifyEnvPresent ? (
                <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-0.5 font-medium">
                  <Key className="w-3 h-3" /> ENV: APIFY_API_TOKEN
                </span>
              ) : (
                <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider block mb-1">
              Apify API Token
            </label>
            <input
              type="password"
              value={apifyApiToken}
              onChange={(e) => setApifyApiToken(e.target.value)}
              placeholder={
                state?.apifyApiTokenMasked
                  ? `Gespeichert: ${state.apifyApiTokenMasked}`
                  : state?.apifyEnvPresent
                  ? "In ENV gesetzt (APIFY_API_TOKEN)"
                  : "apify_api_..."
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 bg-white"
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t border-gray-100">
            <button
              onClick={() => saveSingleSearchKey("apifyApiToken", apifyApiToken)}
              disabled={savingSearchKey.apify || !apifyApiToken.trim()}
              className="flex items-center gap-1.5 bg-cyan-600 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium hover:bg-cyan-700 disabled:opacity-40 transition-colors shadow-2xs"
            >
              {savingSearchKey.apify ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedSearchKeyMsg.apify ? "Gespeichert ✓" : "Speichern"}
            </button>

            <button
              onClick={() => testSearchKey("apify", apifyApiToken)}
              disabled={
                searchTesting.apify ||
                (!apifyApiToken.trim() && !state?.apifyApiTokenMasked && !state?.apifyEnvPresent)
              }
              className="flex items-center gap-1 border border-gray-200 text-gray-700 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors"
            >
              {searchTesting.apify ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Testen
            </button>

            {state?.apifyApiTokenMasked && (
              <button
                onClick={() => removeSingleSearchKey("apify")}
                disabled={savingSearchKey.apify}
                className="flex items-center gap-1 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ml-auto transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Token löschen
              </button>
            )}
          </div>

          {searchTestResults.apify && (
            <div
              className={`rounded-lg border p-3 text-xs flex items-center gap-2 ${
                searchTestResults.apify.ok
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              <span>{searchTestResults.apify.ok ? "✓" : "✗"}</span>
              {searchTestResults.apify.ok ? (
                <span>
                  {searchTestResults.apify.hits} Treffer · <em>{searchTestResults.apify.sample}</em> ·{" "}
                  <span className="text-gray-500">{searchTestResults.apify.note}</span>
                </span>
              ) : (
                <span>{searchTestResults.apify.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── Sub-pages Navigation ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <button
            onClick={() => router.push("/settings/models")}
            className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
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
            <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-900">LLM Provider Smoke Test</div>
              <div className="text-xs text-gray-400">Teste alle konfigurierten Modelle auf Latenz & Kosten</div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </button>
        </div>
      </div>
    </AppShell>
  );
}
