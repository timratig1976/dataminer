/**
 * lib/planner.ts
 * AI-guided discovery planner.
 *
 * Takes a natural-language prompt and generates a structured DiscoveryPlan
 * consisting of executable steps (google_search, google_maps, catalog_scrape).
 *
 * Token-efficiency:
 *  - German region/city lists are injected from lib/regions.ts (no LLM needed)
 *  - LLM only gets the prompt + available API keys + known catalog patterns
 *  - No case data in planner context (lean prompt)
 *  - System prompt is fixed (cacheable by provider)
 *  - Response: compact JSON only, no prose
 */

import { edenChatCompletion } from "./edenai";
import type { AgentGoal, AgentStepResult } from "./agent-types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlanStepType =
  | "google_search"       // single query
  | "multi_search"        // query × N cities (region expansion)
  | "google_maps"         // maps search in a location
  | "catalog_scrape"      // paginated catalog page (link extractor)
  | "catalog_deep_crawl" // auto-injected: deep crawl a discovered catalog row
  | "directory_search";  // firecrawl restricted to German business directories

export interface PlanStep {
  id: string;
  type: PlanStepType;
  label: string;
  // google_search
  query?: string;
  // multi_search
  queryTemplate?: string;   // "{city} Heizungsbauer"
  region?: string;          // detected region key
  queries?: string[];       // pre-expanded
  // google_maps
  mapQuery?: string;
  location?: string;
  // catalog_scrape
  url?: string;
  extractionPrompt?: string;
  maxPages?: number;
  // shared
  source?: string;          // e.g. "serpapi" | "firecrawl" | "auto"
  estimatedHits: number;
  priority: number;
}

export interface DiscoveryPlan {
  goal: string;
  steps: PlanStep[];
  estimatedRows: number;
  warnings: string[];
}

// ── Known catalog domains ─────────────────────────────────────────────────────

const CATALOG_DOMAINS: Record<string, string> = {
  "gelbeseiten.de": "https://www.gelbeseiten.de/suche/{query}/{region}",
  "wlw.de": "https://www.wlw.de/de/suche?q={query}&l={region}",
  "branchenverzeichnis.de": "https://www.branchenverzeichnis.de/suche/?q={query}&wo={region}",
  "handwerker.de": "https://www.handwerker.de/suche/?q={query}&ort={region}",
  "11880.com": "https://www.11880.com/suche/{query}/{region}.html",
  "meinbezirk.at": "https://www.meinbezirk.at/suche?q={query}",
};

// ── Planner system prompt ─────────────────────────────────────────────────────

/** Exported so the settings UI can display the built-in default prompt. */
export function buildDefaultSystemPrompt(availableKeys: Record<string, boolean>): string {
  return buildSystemPrompt(availableKeys);
}

function buildSystemPrompt(availableKeys: Record<string, boolean>): string {
  const keysInfo = Object.entries(availableKeys)
    .map(([k, v]) => `${k}: ${v ? "✓" : "✗"}`)
    .join(", ");

  return `You are a B2B lead-research planner. You have world-wide geography knowledge.
Given a research goal and a maxResults target, produce a minimal, precise JSON discovery plan.

Available API keys: ${keysInfo}
Known business directories (DE): ${Object.keys(CATALOG_DOMAINS).join(", ")}

═══ STEP TYPES ═══

• google_maps   — PRIMARY source for any business with a physical presence.
                  Returns clean structured data: name, address, phone, website.
                  Fields: mapQuery (search term), location (specific city/area — be PRECISE)
                  estimatedHits: 20–80 per step.
                  Use this first. Cover as much of the target as possible with Maps steps.

• google_search — SECONDARY source. Use when Maps coverage is thin (online-only businesses,
                  rare niche, no fixed location) or to supplement Maps with additional cities.
                  Fields: query (full search string incl. city/area, use local language)
                  estimatedHits: 10–30 per step.
                  Never duplicate a city+niche already covered by a google_maps step.

• catalog_scrape — LAST RESORT only. Use ONLY when:
                   a) Maps + Search clearly cannot reach the maxResults target, AND
                   b) A known structured directory exists for this country/niche.
                   WARNING: Each directory has a unique HTML structure — scraping is fragile
                   and slow. Every catalog site must be scraped individually. Results heavily
                   overlap with Maps (expect 40–70% duplicates). Treat estimatedHits conservatively.
                   Fields: url (directory search result page), extractionPrompt, maxPages
                   estimatedHits: 20–60 per step (after dedup discount).
                   Only use for known DE directories listed above. Skip for non-DE targets.

═══ PLANNING RULES ═══

1. PRIORITY ORDER: google_maps first → google_search to fill gaps → catalog_scrape only as
   last resort when the gap to maxResults cannot be closed by Maps/Search alone.

2. AVOID OVERLAP. Never combine google_maps and catalog_scrape for the same city+niche —
   the duplicates make catalog steps wasteful. If Maps already covers the area well,
   skip catalogs entirely.

3. GEOGRAPHY IS YOUR JOB. You know all cities, districts, and regions worldwide.
   - Specific city → plan steps only for that city (1–3 Maps steps).
   - Region/state/country → create one google_maps step for EVERY significant city in that
     region. Do NOT cherry-pick 3–5 cities. A German state like MV has ~15–20 relevant cities;
     NRW has 50+. Cover them all. Never invent cities that don't exist.

4. RESPECT maxResults STRICTLY.
   - Sum of all estimatedHits MUST be ≤ maxResults × 1.3.
   - If maxResults ≤ 50 → 1–2 steps (Maps only).
   - If maxResults ≤ 200 → 2–5 steps (Maps primary, Search if needed).
   - Only add catalog_scrape if still far short after Maps + Search.

5. HONEST ESTIMATES. If the target realistically cannot be reached (niche industry,
   small city, no broad directory), set estimatedRows to what IS reachable and add a
   warning explaining why, and suggest how to expand (broader region, related terms).

6. Max 20 steps total. No multi_search steps.

Respond ONLY with JSON (no markdown, no prose):
{
  "goal": "Short description of what is being searched",
  "steps": [
    {
      "type": "google_maps|google_search|catalog_scrape",
      "label": "Human-readable step name",
      "mapQuery": "...",         // google_maps only
      "location": "...",         // google_maps only — SPECIFIC city/district
      "query": "...",            // google_search only — full query incl. location
      "url": "...",              // catalog_scrape only
      "extractionPrompt": "...", // catalog_scrape only
      "maxPages": 3,             // catalog_scrape only
      "source": "auto",
      "estimatedHits": 50,
      "priority": 1
    }
  ],
  "estimatedRows": 50,
  "warnings": ["Explain if target cannot be reached and how to fix it"]
}`;
}

// ── Planner call ──────────────────────────────────────────────────────────────

export interface PlannerOptions {
  edenApiKey: string;
  model?: string;
  serpApiKeyAvailable?: boolean;
  serperApiKeyAvailable?: boolean;
  braveApiKeyAvailable?: boolean;
  edenKeyAvailable?: boolean;
  /** Force include google_maps steps even if no Maps key detected */
  useMaps?: boolean;
  /** Source preference: auto, maps (only maps), search (only web), combined (both) */
  sourceMode?: "auto" | "maps" | "search" | "combined";
  /** Hard upper limit on results — passed directly to the LLM planner */
  maxResults?: number;
  /** Custom system prompt from DB settings. Overrides built-in prompt when set. */
  systemPromptOverride?: string | null;
}

export async function createDiscoveryPlan(
  prompt: string,
  options: PlannerOptions
): Promise<DiscoveryPlan> {
  const {
    edenApiKey,
    model = "openai/gpt-4o-mini",
    serpApiKeyAvailable = false,
    serperApiKeyAvailable = false,
    braveApiKeyAvailable = false,
    edenKeyAvailable = true,
    useMaps = true,
    sourceMode = "auto",
    maxResults,
    systemPromptOverride,
  } = options;

  const effectiveUseMaps = sourceMode === "search" ? false : useMaps;
  const mapsAvailable = effectiveUseMaps && (serpApiKeyAvailable || serperApiKeyAvailable);

  const builtInSystemPrompt = buildSystemPrompt({
    serpapi: serpApiKeyAvailable,
    serper: serperApiKeyAvailable,
    google_maps: mapsAvailable,
    brave: braveApiKeyAvailable,
    firecrawl_via_eden: edenKeyAvailable,
  });
  const systemPrompt = systemPromptOverride?.trim() || builtInSystemPrompt;

  let sourceHint = "";
  if (sourceMode === "maps") {
    sourceHint = "\nIMPORTANT: Prioritize google_maps steps for all relevant cities and branches. Only use web search if no maps entry is possible.";
  } else if (sourceMode === "search") {
    sourceHint = "\nIMPORTANT: Do NOT use google_maps steps — use google_search and catalog_scrape only.";
  } else if (sourceMode === "combined") {
    sourceHint = "\nIMPORTANT: Generate a BALANCED plan containing BOTH google_maps steps (structured data) AND google_search steps (broad web coverage).";
  } else if (!effectiveUseMaps) {
    sourceHint = "\nIMPORTANT: Do NOT use google_maps steps — use catalog_scrape and google_search only.";
  } else if (!mapsAvailable) {
    sourceHint = "\nIMPORTANT: No Google Maps API key available. Avoid google_maps steps; use catalog_scrape + google_search instead.";
  }

  const unlimited = !maxResults || maxResults === 0;
  const maxResultsHint = unlimited
    ? `\nmaxResults: UNLIMITED — Cover the full geographic scope of the research goal exhaustively. If a region or state is mentioned, create one google_maps step per city in that region. Do NOT limit yourself to 3–5 cities.`
    : `\nmaxResults: ${maxResults} — The sum of all estimatedHits MUST NOT exceed ${Math.ceil(maxResults * 1.3)}. Plan only as many steps as needed to reach this target.`;

  const resp = await edenChatCompletion({
    apiKey: edenApiKey,
    region: "us",
    model,
    system: systemPrompt,
    prompt: `Research goal: ${prompt}${sourceHint}${maxResultsHint}`,
    maxTokens: 3000,
    temperature: 0.1,
  });

  const raw = resp.raw?.trim() ?? "";
  const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  let plan: DiscoveryPlan;
  try {
    const parsed = JSON.parse(jsonStr);
    plan = {
      goal: String(parsed.goal ?? ""),
      steps: (parsed.steps ?? []).map((s: Record<string, unknown>, i: number) => ({
        id: `step_${i + 1}`,
        type: s.type as PlanStepType,
        label: String(s.label ?? `Step ${i + 1}`),
        query: s.query as string | undefined,
        queryTemplate: s.queryTemplate as string | undefined,
        region: s.region as string | undefined,
        queries: undefined, // will be expanded below
        mapQuery: s.mapQuery as string | undefined,
        location: s.location as string | undefined,
        url: s.url as string | undefined,
        extractionPrompt: s.extractionPrompt as string | undefined,
        maxPages: typeof s.maxPages === "number" ? s.maxPages : 5,
        source: (s.source as string | undefined) ?? "auto",
        estimatedHits: typeof s.estimatedHits === "number" ? s.estimatedHits : 20,
        priority: typeof s.priority === "number" ? s.priority : 3,
      })),
      estimatedRows: typeof parsed.estimatedRows === "number" ? parsed.estimatedRows : 0,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    };
  } catch {
    // Fallback: simple single-query plan
    plan = {
      goal: prompt,
      steps: [{
        id: "step_1",
        type: "google_search",
        label: `Suche: ${prompt.slice(0, 60)}`,
        query: prompt,
        source: "auto",
        estimatedHits: 20,
        priority: 1,
      }],
      estimatedRows: 20,
      warnings: ["LLM Planung fehlgeschlagen — einfacher Fallback-Plan erstellt"],
    };
  }

  // Re-number steps cleanly
  plan.steps = plan.steps.map((step, i) => ({ ...step, id: `step_${i + 1}` }));

  // Recalculate total
  plan.estimatedRows = plan.steps.reduce((s, step) => s + step.estimatedHits, 0);

  return plan;
}

// ── Sub-industry analysis ────────────────────────────────────────────────────

export interface SubIndustrySuggestion {
  mapQuery: string;
  label: string;
  description: string;
  estimatedSize: string;
  selected: boolean;
}

export interface SubIndustryAnalysis {
  isBroadIndustry: boolean;
  suggestions: SubIndustrySuggestion[];
  /** Human-readable geography extracted from the prompt */
  geography?: string;
  /** All cities in the detected region (empty if single city or no region) */
  cities: string[];
}

/**
 * Analyse a research prompt for broad-industry patterns and extract
 * sub-industry suggestions + the full city list for the target region.
 * The LLM is instructed to search for and list ALL cities in the region.
 */
export async function analyseSubIndustries(
  prompt: string,
  edenApiKey: string,
  model: string = "openai/gpt-4o-mini"
): Promise<SubIndustryAnalysis> {
  const resp = await edenChatCompletion({
    apiKey: edenApiKey,
    region: "us",
    model,
    system: `Du bist ein B2B-Recherche-Analyst. Deine Aufgabe: Analysiere ob eine Suchanfrage eine breite Branche umfasst.

Wenn JA: Zerlege in spezifische Sub-Branchen (NUR Branchen-Namen, KEINE Städte im mapQuery). 
Erkenne IMMER die Geographie aus der Anfrage:
- Einzelne Stadt → geography = Stadtname, cities = [Stadtname]
- Region/Bundesland (z.B. "Mecklenburg-Vorpommern", "MV", "Bayern", "NRW") → geography = Regionsname, cities = ALLE Städte dieser Region recherchieren und vollständig aufzählen (15-50 Städte). Keine Stadt auslassen. Städte nur im cities-Array, NICHT in suggestions.mapQuery.
- Gesamtes Land (z.B. "Deutschland") → geography = "Deutschland", cities = [] (zu viele Städte für Liste)

Du hast umfassende Geographiekenntnisse. Liste bei Regionen EXPLIZIT jede einzelne Stadt auf.`,
    prompt: `Analyse: ${prompt}

Gib JSON zurück:
{
  "isBroadIndustry": true/false,
  "geography": "erkannte Region/Stadt oder null",
  "cities": ["Stadt1", "Stadt2", ...] — bei Region: ALLE Städte auflisten. Nur Städtenamen, keine Zusatzinfos,
  "suggestions": [
    {"mapQuery": "Sub-Branche (OHNE Stadt)", "label": "Anzeigename", "description": "kurze Beschreibung", "estimatedSize": "groß|mittel|klein"}
  ]
}

WICHTIG: mapQuery in suggestions enthält NUR die Branche, KEINE Stadt. Städte sind separat im cities-Array.`,
    maxTokens: 2000,
    temperature: 0.1,
  });

  const raw = resp.raw?.trim() ?? "";
  const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      isBroadIndustry: !!parsed.isBroadIndustry,
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((s: Record<string, unknown>) => ({
            mapQuery: String(s.mapQuery ?? ""),
            label: String(s.label ?? s.mapQuery ?? ""),
            description: String(s.description ?? ""),
            estimatedSize: String(s.estimatedSize ?? "mittel"),
            selected: false,
          }))
        : [],
      geography: parsed.geography || undefined,
      cities: Array.isArray(parsed.cities) ? parsed.cities.map(String) : [],
    };
  } catch {
    return { isBroadIndustry: false, suggestions: [], cities: [] };
  }
}

// ── Replan (agent loop: "what next?") ────────────────────────────────────────

export interface ReplanOptions extends PlannerOptions {
  goal: AgentGoal;
  /** Steps already executed in previous iterations (with their yields) */
  previousSteps: PlanStep[];
  /** Yield per executed step (stepId → uniqueInserted) */
  stepYields: Record<string, number>;
  /** Current unique domain count */
  currentUniqueCount: number;
  /** Optional analysis of executed queries to avoid exhausted locations */
  analysis?: {
    exhaustedLocations: string[];
    productiveLocations: string[];
    exhaustedQueryTypes: string[];
        locationYield: Record<string, { queries: number; leads: number }>;
    totalQueries: number;
  };
}

function buildReplanSystemPrompt(availableKeys: Record<string, boolean>): string {
  const keysInfo = Object.entries(availableKeys)
    .map(([k, v]) => `${k}: ${v ? "✓" : "✗"}`)
    .join(", ");

  return `Du bist ein Web-Research-Planer für B2B-Datenrecherche.
Deine Aufgabe: den existierenden Suchplan erweitern, weil das Ziel noch nicht erreicht ist.

Verfügbare API-Keys: ${keysInfo}

Bekannte Kataloge: ${Object.keys(CATALOG_DOMAINS).join(", ")}

═══ PIPELINE-STRATEGIE für Erweiterungsrunden ═══
WICHTIG: Katalogseiten sind LINK-EXTRAKTOREN — wir scrapen die Katalogseite und extrahieren
die verlinkten Firmenwebsites daraus. Nicht die Katalog-URL selbst importieren.

Erweiterungsregeln:
1. NIEMALS einen Ort wiederholen der bereits ≥5x gesucht wurde und kaum neue Leads brachte
2. Priorisiere NEUE Orte: andere Städte, Kreise, Bundesländer die noch nicht abgedeckt sind
3. Variiere Suchbegriffe: Synonyme, Branchenslang, Verbandsnamen, englische Begriffe
4. google_maps für neue Orte (priority 1), multi_search / google_search für neue Begriffe (priority 2)
5. Maximal 10 neue Steps — aber alle mit ANDEREN Orten/Begriffen als bisher

DU MUSST vermeiden:
- Wiederholung derselben Stadt in derselben Iteration
- Allgemeine Begriffe wie "Immobilienmakler" ohne neues Location-Targeting
- Kleine Städte wieder und wieder zu suchen, wenn sie schon erschöpft sind
- Synonym-Spam: Hausverwaltung / Immobilienverwaltung / Wohneigentumsverwaltung im SELBEN Ort

BEISPIEL für gute neue Steps:
- google_maps "Wohnungsgenossenschaften in Magdeburg" location="Magdeburg"
- google_maps "Facility Management in Erfurt" location="Erfurt"
- google_search "Bundesverband Hausverwaltung Mitgliedsfirmen"

BEISPIEL für schlechte Steps (NICHT so machen):
- Wiederholen von "Immobilienmakler in Neubrandenburg" wenn Neubrandenburg schon erschöpft ist
- 10 Steps die alle nur Neubrandenburg abdecken

KRITISCH: Schlage IMMER mindestens 3–5 neue Steps vor, egal wie niedrig der bisherige Ertrag war.
Gib NIEMALS ein leeres steps-Array zurück — das stoppt die Suche vorzeitig.
Wenn bekannte Quellen erschöpft sind, erfinde neue kreative Suchstrategien (andere Synonyme, Nachbarstädte, Verbände, Branchenportale).
Schreibe KEINE Kommentare wie "Sources exhausted" oder "Diminishing returns" in warnings — das ist nicht hilfreich.

Antworte NUR mit JSON:
{
  "steps": [ ... wie üblich, mit allen Feldern (type/label/mapQuery/url/query etc.) ... ],
  "estimatedRows": 150,
  "warnings": []
}`;
}

export async function refinePlan(opts: ReplanOptions): Promise<DiscoveryPlan | null> {
  const {
    goal,
    previousSteps,
    stepYields,
    currentUniqueCount,
    edenApiKey,
    model = "openai/gpt-4o-mini",
    serpApiKeyAvailable = false,
    braveApiKeyAvailable = false,
  } = opts;

  const remaining = Math.max(0, goal.targetCount - currentUniqueCount);
  if (remaining <= 0) return null; // already done

  const { analysis } = opts;

  // Build yield summary — only last 20 executed steps to keep prompt short
  const executedSteps = previousSteps.filter((s) => stepYields[s.id] !== undefined);
  const recentSteps = executedSteps.slice(-20);
  const yieldLines = recentSteps.map((s) => {
    const y = stepYields[s.id];
    const rate = s.estimatedHits > 0 ? (y / s.estimatedHits * 100).toFixed(0) : "?";
    return `- [${s.type}] "${s.label}" → ${y} unique (${rate}% Ertrag)`;
  });

  // Build location/query history from previous steps
  const usedLocations = new Set<string>();
  const usedQueries = new Set<string>();
  for (const s of previousSteps) {
    if (s.location) usedLocations.add(s.location.trim());
    if (s.mapQuery) usedQueries.add(s.mapQuery.trim());
    if (s.query) usedQueries.add(s.query.trim());
  }

  // Prefer the structured analysis if provided, otherwise fall back to step scan
  const overusedLocations = analysis?.exhaustedLocations ?? (() => {
    const locationCount: Record<string, number> = {};
    for (const s of previousSteps) {
      if (s.location) locationCount[s.location] = (locationCount[s.location] ?? 0) + 1;
    }
    return Object.entries(locationCount)
      .filter(([, c]) => c >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([loc, c]) => `${loc} (${c}x)`);
  })();

  const productiveLocations = analysis?.productiveLocations ?? [];
  const exhaustedNote = overusedLocations.length > 0
    ? `\n\nBEREITS ERSCHÖPFTE ORTE (nicht nochmals verwenden — zu wenig neue Leads):\n${overusedLocations.join("\n")}`
    : "";

  const productiveNote = productiveLocations.length > 0
    ? `\n\nPRODUKTIVE ORTE (mehr davon): ${productiveLocations.join(", ")}`
    : "";

  const allLocationsNote = usedLocations.size > 0
    ? `\n\nALLE BEREITS GESUCHTEN ORTE (${usedLocations.size} gesamt): ${[...usedLocations].join(", ")}`
    : "";

  const queryTypeNote = analysis?.exhaustedQueryTypes && analysis.exhaustedQueryTypes.length > 0
    ? `\n\nWENIG ERFOLGREICHE STEP-TYPEN (anderen Typ bevorzugen): ${analysis.exhaustedQueryTypes.join(", ")}`
    : "";

  const yieldSummary = yieldLines.length > 0
    ? `\nErtrag der letzten ${recentSteps.length} Steps:\n${yieldLines.join("\n")}`
    : "";

  const userPrompt = `Ziel: "${goal.description}"
Zielanzahl: ${goal.targetCount} · Bereits gefunden: ${currentUniqueCount} · Noch benötigt: ${remaining}${yieldSummary}${exhaustedNote}${productiveNote}${allLocationsNote}${queryTypeNote}

Schlage NEUE Steps vor — mit ANDEREN Orten und ANDEREN Suchbegriffen als bisher.
Verwende keine Orte die bereits erschöpft sind (≥5 Suchen ohne neue Leads).
Erkunde stattdessen: andere Bundesländer, Kreiszentren, Synonyme, Verbände, Branchenverzeichnisse.`;

  try {
    const resp = await edenChatCompletion({
      apiKey: edenApiKey,
      region: "us",
      model,
      system: buildReplanSystemPrompt({
        serpapi: serpApiKeyAvailable,
        brave: braveApiKeyAvailable,
        firecrawl_via_eden: true,
      }),
      prompt: userPrompt,
      maxTokens: 1200,
      temperature: 0.2,
    });

    const raw = resp.raw?.trim() ?? "";
    const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(jsonStr);

    // Continue step numbering from where we left off
    const baseIdx = previousSteps.length;

    const newSteps: PlanStep[] = (parsed.steps ?? []).map((s: Record<string, unknown>, i: number) => ({
      id: `step_${baseIdx + i + 1}`,
      type: s.type as PlanStepType,
      label: String(s.label ?? `Step ${baseIdx + i + 1}`),
      query: s.query as string | undefined,
      queryTemplate: s.queryTemplate as string | undefined,
      region: s.region as string | undefined,
      queries: undefined,
      mapQuery: s.mapQuery as string | undefined,
      location: s.location as string | undefined,
      url: s.url as string | undefined,
      extractionPrompt: s.extractionPrompt as string | undefined,
      maxPages: typeof s.maxPages === "number" ? s.maxPages : 5,
      source: (s.source as string | undefined) ?? "auto",
      estimatedHits: typeof s.estimatedHits === "number" ? s.estimatedHits : 20,
      priority: typeof s.priority === "number" ? s.priority : 3,
    }));

    return {
      goal: goal.description,
      steps: newSteps.map((step, i) => ({ ...step, id: `step_${baseIdx + i + 1}` })),
      estimatedRows: newSteps.reduce((s, step) => s + step.estimatedHits, 0),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    };
  } catch {
    // Fallback: simple google_search for the goal description
    const baseIdx = previousSteps.length;
    return {
      goal: goal.description,
      steps: [{
        id: `step_${baseIdx + 1}`,
        type: "google_search",
        label: `Erweiterte Suche: ${goal.description.slice(0, 50)}`,
        query: goal.description,
        source: "auto",
        estimatedHits: 20,
        priority: 3,
      }],
      estimatedRows: 20,
      warnings: ["Replan fehlgeschlagen — einfacher Fallback"],
    };
  }
}
