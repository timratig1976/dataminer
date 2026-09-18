"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Key, Loader2, Sparkles, Globe, CheckCircle2, Trash2, ChevronRight, Sliders, Flame, Search, Zap } from "lucide-react";
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
      titleIcon={<Globe className="w-4 h-4" style={{ color: "var(--orange)" }} />}
    >
      <div className="max-w-2xl mx-auto space-y-5 pb-12">
        {/* ── 1. Eden AI provider card ── */}
        <div
          className="p-5 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4" style={{ color: "var(--orange)" }} />
            <h2 className="font-semibold text-sm" style={{ color: "var(--text-1)" }}>Eden AI (LLM Gateway)</h2>
            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Einziger LLM-Provider — ein Key für alle Modelle</span>
          </div>

          <div
            className="text-xs p-3 leading-relaxed"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border-xs)",
              borderRadius: "var(--rs)",
              color: "var(--text-2)",
            }}
          >
            DataMiner nutzt ausschließlich <b>Eden AI</b> als LLM-Gateway (OpenAI-kompatibel unter <code>/v3</code>).
            Ein einziger API-Key bedient alle Chat- und Reasoning-Modelle (<code>openai/</code>, <code>anthropic/</code>,{" "}
            <code>google/</code>, <code>mistral/</code>, <code>meta/</code> …).
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-2">
            {state?.hasKey && (
              <span className="status-pill status-pill-done">
                <CheckCircle2 className="w-3 h-3" /> Key in DB gespeichert {state.edenApiKeyMasked ? `(${state.edenApiKeyMasked})` : ""}
              </span>
            )}
            {state?.envKeyPresent && (
              <span className="status-pill status-pill-done" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                <Key className="w-3 h-3" /> EDEN_API_KEY in Env (Fallback)
              </span>
            )}
            {!state?.hasKey && !state?.envKeyPresent && (
              <span className="status-pill status-pill-pending">
                Kein Key — LLM-Läufe schlagen fehl, bis du einen setzt
              </span>
            )}
          </div>

          {/* Key input */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
              Eden AI API Key
            </label>
            <input
              type="password"
              value={edenApiKey}
              onChange={(e) => setEdenApiKey(e.target.value)}
              placeholder={state?.hasKey ? `Gespeichert: ${state.edenApiKeyMasked}` : "sk-eden-live-..."}
              className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
                color: "var(--text-1)",
              }}
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              Wird serverseitig AES-verschlüsselt gespeichert.
            </p>
          </div>

          {/* Region */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>Region / Data Residency</label>
            <div className="flex gap-2">
              {(["eu", "us"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setEdenRegion(r)}
                  className="btn-v2"
                  style={{
                    background: edenRegion === r ? "var(--orange-soft)" : "var(--surface)",
                    borderColor: edenRegion === r ? "var(--orange)" : "var(--border)",
                    color: edenRegion === r ? "var(--orange)" : "var(--text-2)",
                    fontWeight: edenRegion === r ? 600 : 400,
                  }}
                >
                  {r === "eu" ? "EU (api.eu.edenai.run)" : "US (api.edenai.run)"}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              EU = Data Residency (gefiltert auf EU-Provider). US = voller Katalog inkl. OpenAI.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
            <button
              onClick={saveEden}
              disabled={savingEden || (!edenApiKey.trim() && edenRegion === state?.edenRegion)}
              className="btn-v2 btn-v2-primary"
            >
              {savingEden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {savedEdenMsg ? "Gespeichert ✓" : "Speichern"}
            </button>
            <button
              onClick={runEdenTest}
              disabled={testingEden}
              className="btn-v2"
            >
              {testingEden ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {testingEden ? "Teste…" : "Verbindung testen"}
            </button>
            {state?.hasKey && (
              <button
                onClick={removeEdenKey}
                disabled={savingEden}
                className="btn-v2 ml-auto"
                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {edenError && <div className="text-xs p-2 rounded" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>{edenError}</div>}

          {edenTestResult && (
            <div
              className="rounded p-3 text-xs space-y-1.5"
              style={{
                background: edenTestResult.ok ? "var(--green-soft)" : "var(--danger-soft)",
                border: `1px solid ${edenTestResult.ok ? "var(--green-mid)" : "var(--danger)"}`,
                color: edenTestResult.ok ? "var(--green)" : "var(--danger)",
              }}
            >
              <div className="font-semibold">
                {edenTestResult.ok ? "✓ Verbindung erfolgreich" : "✗ Verbindung fehlgeschlagen"}
                <span className="font-normal" style={{ color: "var(--text-3)" }}> ({edenTestResult.region.toUpperCase()})</span>
              </div>
              {edenTestResult.error && <div>{edenTestResult.error}</div>}
              {Object.entries(edenTestResult.checks).map(([name, c]) => (
                <div key={name} className="flex items-start gap-2">
                  <span>{c.ok ? "✓" : "✗"}</span>
                  <span style={{ color: "var(--text-1)" }}>
                    {name === "catalog" && <><b>Katalog:</b> {c.ok ? `${c.count} Modelle` : c.error}</>}
                    {name === "chat" && <><b>{`Chat${c.model ? ` (${c.model})` : ""}`}</b>: {c.ok ? `${c.preview || "ok"} · ${c.latencyMs}ms${c.costUsd ? ` · $${Number(c.costUsd).toFixed(6)}` : ""}` : c.error}</>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 2. Firecrawl Scraper & Search ── */}
        <div
          className="p-5 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded flex items-center justify-center"
                style={{ background: "var(--orange-soft)", color: "var(--orange)" }}
              >
                <Flame className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Firecrawl</h3>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Web-Scraper & Web-Search API</p>
              </div>
            </div>

            <div>
              {state?.hasFirecrawlKey ? (
                <span className="status-pill status-pill-done">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.firecrawlApiKeyMasked})
                </span>
              ) : state?.firecrawlEnvPresent ? (
                <span className="status-pill status-pill-done" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                  <Key className="w-3 h-3" /> ENV: FIRECRAWL_API_KEY
                </span>
              ) : (
                <span className="status-pill status-pill-pending">
                  Nicht hinterlegt (Fallback: Eden AI)
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
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
              className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
                color: "var(--text-1)",
              }}
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
            <button
              onClick={saveFirecrawl}
              disabled={savingFirecrawl || !firecrawlApiKey.trim()}
              className="btn-v2 btn-v2-primary"
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
              className="btn-v2"
            >
              {testingFirecrawl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
              {testingFirecrawl ? "Teste Scraper..." : "Scraper testen"}
            </button>

            {state?.hasFirecrawlKey && (
              <button
                onClick={removeFirecrawlKey}
                disabled={savingFirecrawl}
                className="btn-v2 ml-auto"
                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {firecrawlError && <div className="text-xs p-2 rounded" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>{firecrawlError}</div>}

          {firecrawlTestResult && (
            <div
              className="rounded p-2.5 text-xs flex items-center gap-2"
              style={{
                background: firecrawlTestResult.ok ? "var(--green-soft)" : "var(--danger-soft)",
                border: `1px solid ${firecrawlTestResult.ok ? "var(--green-mid)" : "var(--danger)"}`,
                color: firecrawlTestResult.ok ? "var(--green)" : "var(--danger)",
              }}
            >
              <span>{firecrawlTestResult.ok ? "✓" : "✗"}</span>
              {firecrawlTestResult.ok ? (
                <span>Erfolgreich: <em>{firecrawlTestResult.sample}</em> · <span style={{ color: "var(--text-3)" }}>{firecrawlTestResult.note}</span></span>
              ) : (
                <span>{firecrawlTestResult.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── 3. Serper.dev Widget ── */}
        <div
          className="p-5 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded flex items-center justify-center"
                style={{ background: "var(--bg)", color: "var(--text-1)" }}
              >
                <Search className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Serper.dev</h3>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Google Suche + Google Places (2.500 free/Monat)</p>
              </div>
            </div>

            <div>
              {state?.serperApiKeyMasked ? (
                <span className="status-pill status-pill-done">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.serperApiKeyMasked})
                </span>
              ) : state?.serperEnvPresent ? (
                <span className="status-pill status-pill-done" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                  <Key className="w-3 h-3" /> ENV: SERPER_API_KEY
                </span>
              ) : (
                <span className="status-pill status-pill-pending">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
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
              className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
                color: "var(--text-1)",
              }}
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t flex-wrap" style={{ borderColor: "var(--border-xs)" }}>
            <button
              onClick={() => saveSingleSearchKey("serperApiKey", serperApiKey)}
              disabled={savingSearchKey.serper || !serperApiKey.trim()}
              className="btn-v2 btn-v2-primary"
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
              className="btn-v2"
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
              className="btn-v2"
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
                className="btn-v2 ml-auto"
                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
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
                  className="rounded p-2.5 text-xs flex items-center gap-2"
                  style={{
                    background: searchTestResults[tp]!.ok ? "var(--green-soft)" : "var(--danger-soft)",
                    border: `1px solid ${searchTestResults[tp]!.ok ? "var(--green-mid)" : "var(--danger)"}`,
                    color: searchTestResults[tp]!.ok ? "var(--green)" : "var(--danger)",
                  }}
                >
                  <span>{searchTestResults[tp]!.ok ? "✓" : "✗"}</span>
                  {searchTestResults[tp]!.ok ? (
                    <span>
                      {searchTestResults[tp]!.hits} Treffer · <em>{searchTestResults[tp]!.sample}</em> ·{" "}
                      <span style={{ color: "var(--text-3)" }}>{searchTestResults[tp]!.note}</span>
                    </span>
                  ) : (
                    <span>{searchTestResults[tp]!.error}</span>
                  )}
                </div>
              )
          )}
        </div>

        {/* ── 4. SerpApi Widget ── */}
        <div
          className="p-5 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded flex items-center justify-center"
                style={{ background: "var(--green-soft)", color: "var(--green)" }}
              >
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>SerpApi</h3>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Google Maps structured (100 free/Monat)</p>
              </div>
            </div>

            <div>
              {state?.serpApiKeyMasked ? (
                <span className="status-pill status-pill-done">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.serpApiKeyMasked})
                </span>
              ) : state?.serpEnvPresent ? (
                <span className="status-pill status-pill-done" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                  <Key className="w-3 h-3" /> ENV: SERP_API_KEY
                </span>
              ) : (
                <span className="status-pill status-pill-pending">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
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
              className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
                color: "var(--text-1)",
              }}
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
            <button
              onClick={() => saveSingleSearchKey("serpApiKey", serpApiKey)}
              disabled={savingSearchKey.serp || !serpApiKey.trim()}
              className="btn-v2 btn-v2-primary"
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
              className="btn-v2"
            >
              {searchTesting.serp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Testen
            </button>

            {state?.serpApiKeyMasked && (
              <button
                onClick={() => removeSingleSearchKey("serp")}
                disabled={savingSearchKey.serp}
                className="btn-v2 ml-auto"
                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {searchTestResults.serp && (
            <div
              className="rounded p-2.5 text-xs flex items-center gap-2"
              style={{
                background: searchTestResults.serp.ok ? "var(--green-soft)" : "var(--danger-soft)",
                border: `1px solid ${searchTestResults.serp.ok ? "var(--green-mid)" : "var(--danger)"}`,
                color: searchTestResults.serp.ok ? "var(--green)" : "var(--danger)",
              }}
            >
              <span>{searchTestResults.serp.ok ? "✓" : "✗"}</span>
              {searchTestResults.serp.ok ? (
                <span>
                  {searchTestResults.serp.hits} Treffer · <em>{searchTestResults.serp.sample}</em> ·{" "}
                  <span style={{ color: "var(--text-3)" }}>{searchTestResults.serp.note}</span>
                </span>
              ) : (
                <span>{searchTestResults.serp.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── 5. Brave Search Widget ── */}
        <div
          className="p-5 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded flex items-center justify-center"
                style={{ background: "var(--orange-soft)", color: "var(--orange)" }}
              >
                <Search className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Brave Search</h3>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Unabhängiger Web-Search Layer (2.000 free/Monat)</p>
              </div>
            </div>

            <div>
              {state?.braveApiKeyMasked ? (
                <span className="status-pill status-pill-done">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.braveApiKeyMasked})
                </span>
              ) : state?.braveEnvPresent ? (
                <span className="status-pill status-pill-done" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                  <Key className="w-3 h-3" /> ENV: BRAVE_API_KEY
                </span>
              ) : (
                <span className="status-pill status-pill-pending">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
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
              className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
                color: "var(--text-1)",
              }}
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
            <button
              onClick={() => saveSingleSearchKey("braveApiKey", braveApiKey)}
              disabled={savingSearchKey.brave || !braveApiKey.trim()}
              className="btn-v2 btn-v2-primary"
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
              className="btn-v2"
            >
              {searchTesting.brave ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Testen
            </button>

            {state?.braveApiKeyMasked && (
              <button
                onClick={() => removeSingleSearchKey("brave")}
                disabled={savingSearchKey.brave}
                className="btn-v2 ml-auto"
                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Key löschen
              </button>
            )}
          </div>

          {searchTestResults.brave && (
            <div
              className="rounded p-2.5 text-xs flex items-center gap-2"
              style={{
                background: searchTestResults.brave.ok ? "var(--green-soft)" : "var(--danger-soft)",
                border: `1px solid ${searchTestResults.brave.ok ? "var(--green-mid)" : "var(--danger)"}`,
                color: searchTestResults.brave.ok ? "var(--green)" : "var(--danger)",
              }}
            >
              <span>{searchTestResults.brave.ok ? "✓" : "✗"}</span>
              {searchTestResults.brave.ok ? (
                <span>
                  {searchTestResults.brave.hits} Treffer · <em>{searchTestResults.brave.sample}</em> ·{" "}
                  <span style={{ color: "var(--text-3)" }}>{searchTestResults.brave.note}</span>
                </span>
              ) : (
                <span>{searchTestResults.brave.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── 6. Apify Widget ── */}
        <div
          className="p-5 space-y-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded flex items-center justify-center"
                style={{ background: "var(--bg)", color: "var(--text-1)" }}
              >
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Apify</h3>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>Google Maps Scraper Actor (&gt;120 Treffer pro Lauf)</p>
              </div>
            </div>

            <div>
              {state?.apifyApiTokenMasked ? (
                <span className="status-pill status-pill-done">
                  <CheckCircle2 className="w-3 h-3" /> In DB ({state.apifyApiTokenMasked})
                </span>
              ) : state?.apifyEnvPresent ? (
                <span className="status-pill status-pill-done" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
                  <Key className="w-3 h-3" /> ENV: APIFY_API_TOKEN
                </span>
              ) : (
                <span className="status-pill status-pill-pending">
                  Nicht hinterlegt
                </span>
              )}
            </div>
          </div>

          <div className="pt-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1" style={{ color: "var(--text-3)" }}>
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
              className="w-full border rounded px-3 py-1.5 text-xs font-mono focus:outline-none"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg)",
                color: "var(--text-1)",
              }}
            />
          </div>

          <div className="pt-2 flex items-center gap-2 border-t" style={{ borderColor: "var(--border-xs)" }}>
            <button
              onClick={() => saveSingleSearchKey("apifyApiToken", apifyApiToken)}
              disabled={savingSearchKey.apify || !apifyApiToken.trim()}
              className="btn-v2 btn-v2-primary"
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
              className="btn-v2"
            >
              {searchTesting.apify ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Testen
            </button>

            {state?.apifyApiTokenMasked && (
              <button
                onClick={() => removeSingleSearchKey("apify")}
                disabled={savingSearchKey.apify}
                className="btn-v2 ml-auto"
                style={{ color: "var(--danger)", background: "var(--danger-soft)", borderColor: "var(--danger-soft)" }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Token löschen
              </button>
            )}
          </div>

          {searchTestResults.apify && (
            <div
              className="rounded p-2.5 text-xs flex items-center gap-2"
              style={{
                background: searchTestResults.apify.ok ? "var(--green-soft)" : "var(--danger-soft)",
                border: `1px solid ${searchTestResults.apify.ok ? "var(--green-mid)" : "var(--danger)"}`,
                color: searchTestResults.apify.ok ? "var(--green)" : "var(--danger)",
              }}
            >
              <span>{searchTestResults.apify.ok ? "✓" : "✗"}</span>
              {searchTestResults.apify.ok ? (
                <span>
                  {searchTestResults.apify.hits} Treffer · <em>{searchTestResults.apify.sample}</em> ·{" "}
                  <span style={{ color: "var(--text-3)" }}>{searchTestResults.apify.note}</span>
                </span>
              ) : (
                <span>{searchTestResults.apify.error}</span>
              )}
            </div>
          )}
        </div>

        {/* ── Sub-pages Navigation ── */}
        <div
          className="overflow-hidden"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <button
            onClick={() => router.push("/settings/models")}
            className="w-full flex items-center gap-3 px-5 py-3.5 transition-colors text-left cursor-pointer"
            onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <Sliders className="w-4 h-4 flex-shrink-0" style={{ color: "var(--orange)" }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Modell-Auswahl</div>
              <div className="text-[11px]" style={{ color: "var(--text-3)" }}>Modelle anpassen & konfigurieren</div>
            </div>
            <ChevronRight className="w-4 h-4" style={{ color: "var(--text-3)" }} />
          </button>

          <div style={{ height: 1, background: "var(--border-xs)" }} />

          <button
            onClick={() => router.push("/settings/planner")}
            className="w-full flex items-center gap-3 px-5 py-3.5 transition-colors text-left cursor-pointer"
            onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <Sparkles className="w-4 h-4 flex-shrink-0" style={{ color: "var(--orange)" }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Planner Prompt</div>
              <div className="text-[11px]" style={{ color: "var(--text-3)" }}>System-Prompt für automatische Suchschritte bearbeiten & testen</div>
            </div>
            <ChevronRight className="w-4 h-4" style={{ color: "var(--text-3)" }} />
          </button>

          <div style={{ height: 1, background: "var(--border-xs)" }} />

          <button
            onClick={() => router.push("/settings/llm-test")}
            className="w-full flex items-center gap-3 px-5 py-3.5 transition-colors text-left cursor-pointer"
            onMouseEnter={e => e.currentTarget.style.background = "#faf9f7"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <Zap className="w-4 h-4 flex-shrink-0" style={{ color: "var(--orange)" }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>LLM Provider Testing</div>
              <div className="text-[11px]" style={{ color: "var(--text-3)" }}>Modelle auf Erreichbarkeit, Latenz & Kosten prüfen</div>
            </div>
            <ChevronRight className="w-4 h-4" style={{ color: "var(--text-3)" }} />
          </button>
        </div>
      </div>
    </AppShell>
  );
}
