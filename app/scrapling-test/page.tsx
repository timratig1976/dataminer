"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard, Database, Bug, Play, Loader2,
  CheckCircle2, XCircle, Globe, Search, ArrowLeft, Wifi, WifiOff,
} from "lucide-react";
import AppShell from "@/components/AppShell";

type Mode = "search" | "scrape" | "providers";

interface SearchResult { title: string; url: string; snippet: string; }
interface SearchResponse { results: SearchResult[]; query: string; }
interface ScrapeResponse { url: string; text: string; }
interface DebugResponse { query: string; html_snippet: string; page_title: string; all_links: string[]; }
interface ProviderLog {
  provider: string;
  ok: boolean;
  latencyMs: number;
  httpStatus?: number;
  requestUrl?: string;
  raw?: unknown;
  error?: string;
}

const SCRAPLING_URL = "http://127.0.0.1:8001";
const TOKEN = "dev-local-token";

export default function ScraplingTestPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [scrapeText, setScrapeText] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [serviceStatus, setServiceStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const [checkingService, setCheckingService] = useState(false);
  const [debugData, setDebugData] = useState<DebugResponse | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [providerLogs, setProviderLogs] = useState<ProviderLog[] | null>(null);
  const [providerLogsLoading, setProviderLogsLoading] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [maxResults, setMaxResults] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  async function runDebug() {
    if (!query.trim()) return;
    setDebugLoading(true); setDebugData(null); setError(null);
    try {
      const res = await fetch(`${SCRAPLING_URL}/debug/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-token": TOKEN },
        body: JSON.stringify({ query: query.trim(), max_results: maxResults }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDebugData(await res.json());
    } catch (e) { setError((e as Error).message); }
    finally { setDebugLoading(false); }
  }

  async function runProviderLogs() {
    if (!query.trim()) return;
    setProviderLogsLoading(true); setProviderLogs(null); setError(null);
    try {
      const res = await fetch("/api/search/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setProviderLogs(data.logs ?? []);
    } catch (e) { setError((e as Error).message); }
    finally { setProviderLogsLoading(false); }
  }

  async function checkService() {
    setCheckingService(true);
    try {
      const res = await fetch(`${SCRAPLING_URL}/health`, { signal: AbortSignal.timeout(3000) });
      setServiceStatus(res.ok ? "ok" : "down");
    } catch {
      setServiceStatus("down");
    } finally {
      setCheckingService(false);
    }
  }

  async function runSearch(page: number) {
    if (!query.trim()) return;
    setLoading(true); setError(null); setSearchResults(null);
    const t0 = Date.now();
    try {
      const res = await fetch(`${SCRAPLING_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-token": TOKEN },
        body: JSON.stringify({ query: query.trim(), max_results: maxResults, page }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data: SearchResponse = await res.json();
      setSearchResults(data.results);
      setCurrentPage(page);
      setLatencyMs(Date.now() - t0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function goToPage(p: number) {
    if (p < 1 || loading) return;
    runSearch(p);
  }

  async function runScrape() {
    if (!url.trim()) return;
    setLoading(true); setError(null); setScrapeText(null);
    const t0 = Date.now();
    try {
      const res = await fetch(`${SCRAPLING_URL}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-token": TOKEN },
        body: JSON.stringify({ url: url.trim(), wait_for_idle: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data: ScrapeResponse = await res.json();
      setScrapeText(data.text);
      setLatencyMs(Date.now() - t0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell
      title={
        <>
          Scrapling Test <span className="text-xs font-normal ml-1" style={{ color: "var(--text-3)" }}>— Layer 5 Google Bypass</span>
        </>
      }
      titleIcon={<Bug className="w-4 h-4" style={{ color: "var(--orange)" }} />}
      actions={
        <button
          onClick={checkService}
          disabled={checkingService}
          className="btn-v2"
        >
          {checkingService ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
          ) : serviceStatus === "ok" ? (
            <Wifi className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
          ) : serviceStatus === "down" ? (
            <WifiOff className="w-3.5 h-3.5" style={{ color: "var(--danger)" }} />
          ) : (
            <Wifi className="w-3.5 h-3.5 text-gray-400" />
          )}
          <span style={{
            color: serviceStatus === "ok" ? "var(--green)" :
            serviceStatus === "down" ? "var(--danger)" : "var(--text-2)"
          }}>
            {serviceStatus === "ok" ? "Service online" : serviceStatus === "down" ? "Service offline" : "Check service"}
          </span>
        </button>
      }
    >
      <div className="max-w-3xl mx-auto space-y-5 pb-12">

        {/* Info banner */}
        <div
          className="p-3.5 rounded text-xs leading-relaxed"
          style={{
            background: "var(--orange-soft)",
            border: "1px solid var(--orange-mid)",
            color: "var(--orange)",
          }}
        >
          <strong className="font-semibold">Scrapling sidecar</strong> läuft lokal auf <code className="px-1 py-0.5 rounded text-[11px]" style={{ background: "rgba(232,124,62,0.15)" }}>http://127.0.0.1:8001</code>.
          Nutzt <code className="px-1 py-0.5 rounded text-[11px]" style={{ background: "rgba(232,124,62,0.15)" }}>StealthyFetcher</code> mit Chrome-Fingerprint-Spoofing — umgeht Google-Blocking &amp; Cloudflare.
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setMode("search")}
            className="btn-v2"
            style={{
              background: mode === "search" ? "var(--orange-soft)" : "var(--surface)",
              borderColor: mode === "search" ? "var(--orange)" : "var(--border)",
              color: mode === "search" ? "var(--orange)" : "var(--text-2)",
              fontWeight: mode === "search" ? 600 : 400,
            }}
          >
            <Search className="w-3.5 h-3.5" />
            Google Search
          </button>
          <button
            onClick={() => setMode("scrape")}
            className="btn-v2"
            style={{
              background: mode === "scrape" ? "var(--orange-soft)" : "var(--surface)",
              borderColor: mode === "scrape" ? "var(--orange)" : "var(--border)",
              color: mode === "scrape" ? "var(--orange)" : "var(--text-2)",
              fontWeight: mode === "scrape" ? 600 : 400,
            }}
          >
            <Globe className="w-3.5 h-3.5" />
            Page Scrape
          </button>
          <button
            onClick={() => setMode("providers")}
            className="btn-v2"
            style={{
              background: mode === "providers" ? "var(--orange-soft)" : "var(--surface)",
              borderColor: mode === "providers" ? "var(--orange)" : "var(--border)",
              color: mode === "providers" ? "var(--orange)" : "var(--text-2)",
              fontWeight: mode === "providers" ? 600 : 400,
            }}
          >
            <Bug className="w-3.5 h-3.5" />
            Alle Quellen (Logs)
          </button>
        </div>

        {/* Input */}
        <div
          className="p-5 space-y-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {mode === "search" ? (
            <>
              <label className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: "var(--text-3)" }}>Suchanfrage</label>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && runSearch(1)}
                      placeholder="z.B. BASF AG Kontakt Website"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                    <select
                      value={maxResults}
                      onChange={e => setMaxResults(Number(e.target.value))}
                      className="border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                      {[5, 10, 20, 50, 100].map(n => (
                        <option key={n} value={n}>{n} Ergebnisse</option>
                      ))}
                    </select>
                    <button
                      onClick={() => runSearch(1)}
                      disabled={loading || !query.trim()}
                      className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Suchen
                    </button>
                    <button
                      onClick={runDebug}
                      disabled={debugLoading || !query.trim()}
                      title="Debug: zeigt rohen Seiteninhalt"
                      className="flex items-center gap-1.5 border border-gray-200 text-gray-500 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      {debugLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bug className="w-4 h-4" />}
                      Debug
                    </button>
                  </div>
                </>
              ) : mode === "providers" ? (
                <>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Suchanfrage (alle Quellen parallel)</label>
                  <div className="flex gap-2">
                    <input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && runProviderLogs()}
                      placeholder="z.B. Marketingagenturen Rostock"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                    <button
                      onClick={runProviderLogs}
                      disabled={providerLogsLoading || !query.trim()}
                      className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                    >
                      {providerLogsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bug className="w-4 h-4" />}
                      Alle abfragen
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Fragt jede Quelle einzeln ab (kein Fallback) und zeigt die rohe Antwort: Firecrawl/Eden, SerpApi, Brave, DuckDuckGo, Scrapling, Google Maps.
                  </p>
                </>
              ) : (
                <>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">URL</label>
                  <div className="flex gap-2">
                    <input
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && runScrape()}
                      placeholder="https://example.com"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                    />
                    <button
                      onClick={runScrape}
                      disabled={loading || !url.trim()}
                      className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Scrapen
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong>Fehler:</strong> {error}
                  {error.includes("fetch") && (
                    <div className="mt-1 text-xs text-red-500">Service läuft nicht? → <code>npm run scrapling</code></div>
                  )}
                </div>
              </div>
            )}

            {/* Provider Logs (all sources) */}
            {providerLogs !== null && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Provider-Logs — rohe Antworten ({providerLogs.length} Quellen)
                </div>
                {providerLogs.map((log) => {
                  const key = log.provider;
                  const expanded = expandedLog === key;
                  const rawText = typeof log.raw === "string" ? log.raw : JSON.stringify(log.raw, null, 2);
                  return (
                    <div key={key} className={`border rounded-xl overflow-hidden ${log.ok ? "border-green-200" : "border-red-200"}`}>
                      <button
                        onClick={() => setExpandedLog(expanded ? null : key)}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 text-left"
                      >
                        {log.ok ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                        <span className="text-sm font-medium text-gray-800">{log.provider}</span>
                        <span className="text-xs text-gray-400">{log.latencyMs}ms</span>
                        {log.httpStatus !== undefined && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${log.httpStatus < 400 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                            HTTP {log.httpStatus}
                          </span>
                        )}
                        {log.error && <span className="text-xs text-red-600 truncate">{log.error}</span>}
                        <span className="ml-auto text-xs text-gray-400">{expanded ? "▲ zuklappen" : "▼ rohe Antwort"}</span>
                      </button>
                      {expanded && (
                        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 space-y-2">
                          {log.requestUrl && (
                            <div className="text-xs text-gray-500 break-all">
                              <span className="font-medium">Request:</span> <code className="text-[11px]">{log.requestUrl}</code>
                            </div>
                          )}
                          <div>
                            <div className="text-xs font-medium text-gray-500 mb-1">Rohe Antwort:</div>
                            <pre className="text-[11px] text-gray-700 whitespace-pre-wrap break-words max-h-96 overflow-auto font-mono bg-white border border-gray-200 p-2 rounded">
                              {rawText ?? "(leer)"}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Debug Output */}
            {debugData && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Debug — was Google zurückgab</div>
                <div className="bg-white border border-amber-200 rounded-xl p-4 space-y-3">
                  <div><span className="text-xs font-medium text-gray-500">Page title:</span> <span className="text-sm text-gray-800">{debugData.page_title || "(leer)"}</span></div>
                  {debugData.all_links.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-1">Gefundene Links ({debugData.all_links.length}):</div>
                      <ul className="space-y-1">
                        {debugData.all_links.map((l, i) => (
                          <li key={i}><a href={l} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 hover:underline break-all">{l}</a></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">Seitentext (3000 Zeichen):</div>
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words max-h-64 overflow-auto font-mono bg-gray-50 p-2 rounded">{debugData.html_snippet}</pre>
                  </div>
                </div>
              </div>
            )}

            {/* Search Results */}
            {searchResults !== null && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-gray-700">
                    {searchResults.length} Ergebnisse
                  </span>
                  <span className="text-xs text-gray-400">Seite {currentPage}</span>
                  {latencyMs && <span className="text-xs text-gray-400">{latencyMs}ms</span>}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage <= 1 || loading}
                      className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-30"
                    >← Zurück</button>
                    <span className="text-xs text-gray-500 px-2">S. {currentPage}</span>
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={loading || searchResults.length < maxResults}
                      className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-30"
                    >Weiter →</button>
                  </div>
                </div>
                {searchResults.length === 0 ? (
                  <div className="text-sm text-gray-400 bg-white border border-gray-200 rounded-xl p-5 text-center">
                    Keine Ergebnisse — Google hat blockiert oder Scrapling-Service lieferte leere Antwort.
                  </div>
                ) : (
                  searchResults.map((r, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-800">{r.title || "(kein Titel)"}</span>
                        <span className="text-xs text-gray-400 shrink-0">#{i + 1}</span>
                      </div>
                      <a href={r.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-violet-600 hover:underline break-all">
                        {r.url}
                      </a>
                      {r.snippet && <p className="text-xs text-gray-500">{r.snippet}</p>}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Scrape Result */}
            {scrapeText !== null && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-gray-700">
                    {scrapeText.length.toLocaleString("de-DE")} Zeichen gescrapt
                  </span>
                  {latencyMs && <span className="text-xs text-gray-400">{latencyMs}ms</span>}
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words max-h-96 overflow-auto font-mono">
                    {scrapeText.slice(0, 5000)}{scrapeText.length > 5000 ? "\n\n… (gekürzt)" : ""}
                  </pre>
                </div>
              </div>
            )}

          </div>
    </AppShell>
  );
}
