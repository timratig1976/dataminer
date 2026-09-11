"use client";

import { useState, useCallback } from "react";
import {
  X, Search, Loader2, MapPin, Globe, Ban, Plus, AlertTriangle, Check,
} from "lucide-react";
import { buildQueriesFromRowsPublic } from "@/lib/discovery-client";
import type { RowData } from "@/lib/types";

// ── Types (mirror of server-side shapes, kept local to stay client-safe) ─────

interface DiscoveryHit {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  isCatalog: boolean;
  isDuplicate: boolean;
  searchQuery: string;
  searchSource: string;
}

interface MapsPlace {
  name: string;
  address: string;
  phone: string;
  website: string;
  rating?: number;
  reviews?: number;
  category?: string;
  mapsUrl: string;
}

type DiscoveryMode = "new" | "extend" | "batch";
type SourceOption =
  | "auto"
  | "firecrawl"
  | "serpapi"
  | "brave"
  | "duckduckgo"
  | "scrapling"
  | "maps-serpapi"
  | "maps-scrapling";

const SOURCE_OPTIONS: { value: SourceOption; label: string; icon: "globe" | "map" }[] = [
  { value: "auto", label: "Web — Auto (Fallback-Kette)", icon: "globe" },
  { value: "firecrawl", label: "Web — Firecrawl (Eden AI)", icon: "globe" },
  { value: "serpapi", label: "Web — SerpApi (Google)", icon: "globe" },
  { value: "brave", label: "Web — Brave", icon: "globe" },
  { value: "scrapling", label: "Web — Scrapling (Stealth, free)", icon: "globe" },
  { value: "duckduckgo", label: "Web — DuckDuckGo (free)", icon: "globe" },
  { value: "maps-serpapi", label: "Google Maps — SerpApi (strukturiert)", icon: "map" },
  { value: "maps-scrapling", label: "Google Maps — Scrapling (free)", icon: "map" },
];

interface Props {
  caseId: string;
  rows: RowData[];
  sourceColumns: string[];
  onClose: () => void;
  onImported: () => void;
}

interface PendingHit extends DiscoveryHit {
  selected: boolean;
  place?: MapsPlace;
}

export function DiscoveryModal({ caseId, rows, sourceColumns, onClose, onImported }: Props) {
  const [mode, setMode] = useState<DiscoveryMode>("new");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceOption>("firecrawl");
  const [limit, setLimit] = useState(30);
  const [ll, setLl] = useState("");
  const [template, setTemplate] = useState("");
  const [scrapePages, setScrapePages] = useState(false);
  const [extractNames, setExtractNames] = useState(true);

  // Batch mode state
  const [batchKeyword, setBatchKeyword] = useState("");
  const [batchCities, setBatchCities] = useState("");
  const [batchSource, setBatchSource] = useState<SourceOption>("maps-scrapling");
  const [batchLimit, setBatchLimit] = useState(20);

  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [hits, setHits] = useState<PendingHit[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  const extendQueries = buildQueriesFromRowsPublic(rows, template);

  const doSearch = useCallback(
    async (q: string, src: SourceOption, opts: { extendAll?: boolean } = {}) => {
      setSearching(true);
      setError("");
      setInfo("");
      try {
        const queries = opts.extendAll && extendQueries.length > 0 ? extendQueries : [q];
        let added = 0;
        let flagged = 0;

        for (const oneQuery of queries) {
          const res = await fetch("/api/discovery/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: oneQuery,
              source: src,
              limit,
              caseId,
              ...(ll.trim() ? { ll: ll.trim() } : {}),
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setError(json?.error ?? `HTTP ${res.status}`);
            break;
          }
          if (json.error) setInfo(`Hinweis: ${json.error}`);

          const newHits = (json.hits ?? []) as DiscoveryHit[];
          const places = (json.places ?? []) as MapsPlace[];
          const placeByUrl = new Map(places.map((p) => [p.website || p.mapsUrl, p]));

          setHits((prev) => {
            const seen = new Set(prev.map((h) => h.url));
            const additions = newHits
              .filter((h) => !seen.has(h.url))
              .map((h) => ({
                ...h,
                selected: !h.isCatalog && !h.isDuplicate,
                place: placeByUrl.get(h.url),
              }));
            added += additions.length;
            flagged += additions.filter((h) => h.isDuplicate || h.isCatalog).length;
            return [...prev, ...additions];
          });

          if (queries.length > 1) {
            setInfo(`Query ${queries.indexOf(oneQuery) + 1}/${queries.length} erledigt — ${added} neue Treffer bisher`);
          }
        }
        setInfo(
          queries.length === 1
            ? `${added} neue Treffer${flagged ? `, ${flagged} markiert (Duplikat/Verzeichnis)` : ""}`
            : `${queries.length} Queries abgearbeitet — ${added} neue Treffer${flagged ? `, ${flagged} markiert` : ""}`
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSearching(false);
      }
    },
    [caseId, extendQueries, limit, ll]
  );

  function toggleHit(url: string) {
    setHits((prev) =>
      prev.map((h) => (h.url === url ? { ...h, selected: !h.selected } : h))
    );
  }

  function setAllSelected(sel: boolean, onlySelectable = true) {
    setHits((prev) =>
      prev.map((h) =>
        onlySelectable && (h.isCatalog || h.isDuplicate) ? h : { ...h, selected: sel }
      )
    );
  }

  function removeHits() {
    setHits((prev) => prev.filter((h) => h.selected));
  }

  async function doImport() {
    const accepted = hits.filter((h) => h.selected);
    if (accepted.length === 0) return;
    setImporting(true);
    setError("");
    try {
      const res = await fetch(`/api/cases/${caseId}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hits: accepted.map((h) => ({
            title: h.title,
            url: h.url,
            domain: h.domain,
            snippet: h.snippet,
            isCatalog: h.isCatalog,
            isDuplicate: h.isDuplicate,
            searchQuery: h.searchQuery,
            searchSource: h.searchSource,
          })),
          places: accepted.map((h) => h.place).filter((p): p is MapsPlace => !!p),
          extractNames: extractNames && !source.startsWith("maps"),
          scrapePages,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? `HTTP ${res.status}`);
        return;
      }
      const parts = [`${json.inserted} Leads übernommen`];
      if (json.duplicates) parts.push(`${json.duplicates} Duplikate übersprungen`);
      if (json.extractedNames) parts.push(`${json.extractedNames} Firmennamen extrahiert`);
      if (json.scraped) parts.push(`${json.scraped} Seiten vorgeladen`);
      setInfo(parts.join(", "));
      setHits((prev) => prev.filter((h) => !h.selected));
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = hits.filter((h) => h.selected).length;
  const isMaps = mode === "batch" ? batchSource.startsWith("maps") : source.startsWith("maps");

  // Build batch queries: {city} {keyword} for each city line
  function buildBatchQueries(): string[] {
    const cities = batchCities
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (!batchKeyword.trim() || cities.length === 0) return [];
    return cities.map(city => `${city} ${batchKeyword.trim()}`);
  }

  async function runBatchSearch() {
    const queries = buildBatchQueries();
    if (queries.length === 0) return;
    setSearching(true); setError("");
    let added = 0;
    try {
      for (let i = 0; i < queries.length; i++) {
        const q = queries[i];
        setInfo(`Query ${i + 1}/${queries.length}: ${q}`);
        const res = await fetch("/api/discovery/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            source: batchSource,
            limit: batchLimit,
            caseId,
            ...(ll.trim() ? { ll: ll.trim() } : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok) { setError(json?.error ?? `HTTP ${res.status}`); break; }
        const newHits = (json.hits ?? []) as DiscoveryHit[];
        const places = (json.places ?? []) as MapsPlace[];
        const placeByUrl = new Map(places.map(p => [p.website || p.mapsUrl, p]));
        setHits(prev => {
          const seen = new Set(prev.map(h => h.url));
          const additions = newHits
            .filter(h => !seen.has(h.url))
            .map(h => ({ ...h, selected: !h.isCatalog && !h.isDuplicate, place: placeByUrl.get(h.url) }));
          added += additions.length;
          return [...prev, ...additions];
        });
        if (i < queries.length - 1) {
          await new Promise(r => setTimeout(r, 500)); // polite delay between queries
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
      setInfo(`${queries.length} Suchanfragen abgeschlossen — ${added} neue Treffer`);
    }
  }

  const batchQueryPreview = buildBatchQueries();

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-violet-500" />
            <h3 className="font-semibold text-gray-900">Leads entdecken</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-6 pt-4 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === "new"
                ? "bg-violet-100 text-violet-800"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Neue Suche
          </button>
          <button
            type="button"
            onClick={() => setMode("batch")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === "batch"
                ? "bg-violet-100 text-violet-800"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Batch Städte × Keyword
          </button>
          <button
            type="button"
            onClick={() => setMode("extend")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              mode === "extend"
                ? "bg-violet-100 text-violet-800"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Bestehende erweitern
          </button>
        </div>

        {/* Search bar */}
        <div className="px-6 pt-4 space-y-3 shrink-0">
          {mode === "batch" && (
            /* Batch mode: keyword + cities */
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Keyword (Branche)</label>
                  <input
                    value={batchKeyword}
                    onChange={e => setBatchKeyword(e.target.value)}
                    placeholder="z.B. Heizung Sanitär"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Quelle</label>
                  <select
                    value={batchSource}
                    onChange={e => setBatchSource(e.target.value as SourceOption)}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"
                  >
                    <option value="maps-scrapling">Google Maps — Scrapling (free)</option>
                    <option value="maps-serpapi">Google Maps — SerpApi</option>
                    <option value="scrapling">Google Search — Scrapling (free)</option>
                    <option value="serpapi">Google Search — SerpApi</option>
                    <option value="firecrawl">Web — Firecrawl (Eden AI)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">
                  Städte (eine pro Zeile, Komma oder Semikolon getrennt)
                </label>
                <textarea
                  value={batchCities}
                  onChange={e => setBatchCities(e.target.value)}
                  placeholder={`Berlin\nHamburg\nMünchen\nKöln\nFrankfurt`}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y"
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-600">Limit pro Stadt:</label>
                  <input
                    type="number" min={5} max={100} value={batchLimit}
                    onChange={e => setBatchLimit(Math.max(5, Math.min(100, Number(e.target.value) || 20)))}
                    className="border border-gray-300 rounded-lg px-2 py-1 w-16 text-xs"
                  />
                </div>
                {isMaps && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    Kartenmitte
                    <input value={ll} onChange={e => setLl(e.target.value)} placeholder="52.39,13.06"
                      className="border border-gray-300 rounded-lg px-2 py-1 w-28 text-xs" />
                  </label>
                )}
                <span className="text-xs text-gray-400">
                  {batchQueryPreview.length > 0
                    ? `${batchQueryPreview.length} Queries: ${batchQueryPreview.slice(0, 3).join(" · ")}${batchQueryPreview.length > 3 ? " …" : ""}`
                    : "Keyword + mind. 1 Stadt eingeben"}
                </span>
              </div>
              <button
                onClick={runBatchSearch}
                disabled={searching || batchQueryPreview.length === 0}
                className="w-full bg-violet-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                {searching ? "Suche läuft…" : `${batchQueryPreview.length} Städte durchsuchen`}
              </button>
            </div>
          )}

          {mode === "new" && (
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && query.trim() && !searching && doSearch(query.trim(), source)}
                placeholder={isMaps ? "z. B. Heizung Sanitär Potsdam" : "z. B. Heizung Sanitär Anbieter Potsdam"}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <button
                onClick={() => query.trim() && doSearch(query.trim(), source)}
                disabled={searching || !query.trim()}
                className="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center gap-2 shrink-0"
              >
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Suchen
              </button>
            </div>
          )}

          {mode === "extend" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  placeholder="Query-Template aus Spalten, z. B. {industry_keywords} {city} Anbieter"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
                <button
                  onClick={() => template.trim() && doSearch("", source, { extendAll: true })}
                  disabled={searching || extendQueries.length === 0}
                  className="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center gap-2 shrink-0"
                >
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {extendQueries.length} Queries suchen
                </button>
              </div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {sourceColumns.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTemplate((t) => (t.endsWith(" ") || t === "" ? `${t}{${c}}` : `${t} {${c}}`))}
                    className="text-xs px-2 py-0.5 rounded-md border bg-white border-gray-200 text-gray-600 hover:border-violet-300"
                    title="Platzhalter einfügen"
                  >
                    {"{" + c + "}"}
                  </button>
                ))}
              </div>
              {extendQueries.length > 0 && (
                <div className="text-xs text-gray-500">
                  {extendQueries.length} eindeutige Queries aus {rows.length} Zeilen abgeleitet
                  {" · "}
                  <button
                    type="button"
                    onClick={() => setExpandedRows((r) => ({ ...r, [-1]: !r[-1] }))}
                    className="text-violet-600 hover:text-violet-700"
                  >
                    {expandedRows[-1] ? "verbergen" : "anzeigen"}
                  </button>
                </div>
              )}
              {expandedRows[-1] && (
                <div className="bg-gray-50 rounded-lg p-2 max-h-28 overflow-y-auto text-xs text-gray-600 space-y-0.5">
                  {extendQueries.slice(0, 30).map((q, i) => (
                    <div key={i}>{i + 1}. {q}</div>
                  ))}
                  {extendQueries.length > 30 && <div>… +{extendQueries.length - 30} weitere</div>}
                </div>
              )}
            </div>
          )}

          {/* Options row */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              {isMaps ? <MapPin className="w-3.5 h-3.5 text-gray-400" /> : <Globe className="w-3.5 h-3.5 text-gray-400" />}
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as SourceOption)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              Limit
              <input
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 30)))}
                className="border border-gray-300 rounded-lg px-2 py-1 w-16 text-xs"
              />
            </label>
            {isMaps && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                Kartenmitte (lat,lng)
                <input
                  value={ll}
                  onChange={(e) => setLl(e.target.value)}
                  placeholder="52.39,13.06"
                  className="border border-gray-300 rounded-lg px-2 py-1 w-28 text-xs"
                />
              </label>
            )}
            {!isMaps && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                <input type="checkbox" checked={extractNames} onChange={(e) => setExtractNames(e.target.checked)} className="accent-violet-600" />
                Firmennamen per KI extrahieren
              </label>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer" title="Füllt den Firecrawl-Cache — spart später Kosten bei der Anreicherung (nur mit Eden-Key)">
              <input type="checkbox" checked={scrapePages} onChange={(e) => setScrapePages(e.target.checked)} className="accent-violet-600" />
              Top-Seiten vorab laden
            </label>
          </div>
        </div>

        {/* Status */}
        {(error || info) && (
          <div className={`mx-6 mt-3 text-xs rounded-lg px-3 py-2 shrink-0 ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {error || info}
          </div>
        )}

        {/* Results */}
        <div className="px-6 py-3 overflow-y-auto flex-1 min-h-0">
          {hits.length === 0 && !searching && (
            <div className="text-center text-sm text-gray-400 py-10">
              Noch keine Ergebnisse. Suche starten, um Leads zu finden.
            </div>
          )}
          {hits.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
                <div>
                  {hits.length} Treffer · {selectedCount} ausgewählt ·{" "}
                  {hits.filter((h) => h.isDuplicate).length} Duplikate ·{" "}
                  {hits.filter((h) => h.isCatalog).length} Verzeichnisse
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAllSelected(true)} className="text-violet-600 hover:text-violet-700">Alle</button>
                  <button type="button" onClick={() => setAllSelected(false)} className="text-gray-500 hover:text-gray-700">Keine</button>
                  <button type="button" onClick={removeHits} className="text-red-500 hover:text-red-600" title="Nicht ausgewählte entfernen">
                    <Ban className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {hits.map((h, i) => (
                  <div
                    key={h.url + i}
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                      h.isDuplicate ? "border-amber-200 bg-amber-50/50" :
                      h.isCatalog ? "border-gray-200 bg-gray-50" :
                      "border-gray-200 bg-white hover:border-violet-200"
                    } ${h.selected ? "" : "opacity-60"}`}
                  >
                    <input
                      type="checkbox"
                      checked={h.selected}
                      onChange={() => toggleHit(h.url)}
                      className="accent-violet-600 mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-gray-800 truncate">{h.title || h.domain || h.url}</span>
                        {h.domain && <span className="text-xs text-violet-600 bg-violet-50 rounded px-1.5 py-0.5">{h.domain}</span>}
                        {h.isDuplicate && (
                          <span className="text-xs text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" /> bereits vorhanden
                          </span>
                        )}
                        {h.isCatalog && (
                          <span className="text-xs text-gray-600 bg-gray-200 rounded px-1.5 py-0.5">Verzeichnis</span>
                        )}
                        {h.place?.rating != null && (
                          <span className="text-xs text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">
                            ★ {h.place.rating}{h.place.reviews != null ? ` (${h.place.reviews})` : ""}
                          </span>
                        )}
                        {h.place?.phone && (
                          <span className="text-xs text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">{h.place.phone}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{h.url}</div>
                      {h.snippet && <div className="text-xs text-gray-400 line-clamp-2 mt-0.5">{h.snippet}</div>}
                      <div className="text-[10px] text-gray-300 mt-0.5">via {h.searchSource} · „{h.searchQuery}&quot;</div>
                    </div>
                    {h.selected && <Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />}
                  </div>
                ))}
              </div>
            </>
          )}
          {searching && (
            <div className="text-center text-sm text-gray-400 py-6 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Suche läuft…
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-3 border-t border-gray-100 flex gap-2 shrink-0">
          <button
            onClick={doImport}
            disabled={selectedCount === 0 || importing || searching}
            className="flex-1 bg-violet-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            {importing ? "Übernehme…" : `${selectedCount} Lead${selectedCount === 1 ? "" : "s"} übernehmen`}
          </button>
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
