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
import { detectRegion, getCitiesForRegion } from "./regions";
import type { AgentGoal, AgentStepResult } from "./agent-types";

// ── Sub-industry analysis ─────────────────────────────────────────────────────

export interface SubIndustryAnalysis {
  isBroadIndustry: boolean;
  /** Top-level industry label detected (e.g. "Produktion", "Handwerk") */
  detectedIndustry?: string;
  /** LLM-suggested sub-industries with estimated relevance */
  suggestions: SubIndustrySuggestion[];
  /** The geography extracted from the prompt */
  geography?: string;
}

export interface SubIndustrySuggestion {
  /** Specific German trade/profession term for Maps search (e.g. "Maschinenbau") */
  mapQuery: string;
  /** Human-readable label */
  label: string;
  /** Short description of what this covers */
  description: string;
  /** LLM-estimated number of businesses in Germany for this category */
  estimatedSize: "klein" | "mittel" | "groß";
  /** Whether pre-selected by default */
  selected: boolean;
}

/**
 * Analyse a research prompt and return sub-industry suggestions when the
 * prompt contains a broad industry umbrella term.
 * Returns quickly (1 LLM call, ~500 tokens).
 */
export async function analyseSubIndustries(
  prompt: string,
  edenApiKey: string,
  model = "openai/gpt-4o-mini"
): Promise<SubIndustryAnalysis> {
  const resp = await edenChatCompletion({
    apiKey: edenApiKey,
    region: "us",
    model,
    system: `Du bist ein B2B-Marktforschungs-Experte für Deutschland. Analysiere Suchanfragen und erkenne ob ein breiter Branchenbegriff verwendet wird.

Antworte NUR mit JSON:
{
  "isBroadIndustry": true/false,
  "detectedIndustry": "erkannter Oberbegriff oder null",
  "geography": "erkannte Region oder null",
  "suggestions": [
    {
      "mapQuery": "Spezifischer Suchbegriff für Google Maps (DE)",
      "label": "Lesbare Bezeichnung",
      "description": "Was genau ist darunter zu verstehen (1 Satz)",
      "estimatedSize": "klein|mittel|groß",
      "selected": true/false
    }
  ]
}

Regeln:
- isBroadIndustry=true wenn der Begriff eine Oberkategorie ist die viele verschiedene Betriebstypen umfasst
- Immer spezifische, auf Google Maps suchbare deutsche Fachbegriffe als mapQuery
- mapQuery NUR der Fachbegriff selbst, KEINE Region/Stadt darin (z.B. "Maschinenbau" NICHT "Maschinenbau Bayern")
- selected=true für die 5-8 relevantesten Sub-Branchen, false für Nischen
- estimatedSize: groß=viele Betriebe in DE (>10k), mittel=1k-10k, klein=<1k
- Maximal 12 Vorschläge, mindestens 6 wenn isBroadIndustry=true
- Wenn NICHT breit: leeres suggestions-Array, isBroadIndustry=false`,
    prompt: `Analysiere: "${prompt}"`,
    maxTokens: 800,
    temperature: 0.1,
  });

  try {
    const raw = resp.raw?.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim() ?? "";
    const parsed = JSON.parse(raw) as SubIndustryAnalysis;
    return {
      isBroadIndustry: parsed.isBroadIndustry ?? false,
      detectedIndustry: parsed.detectedIndustry ?? undefined,
      geography: parsed.geography ?? undefined,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch {
    return { isBroadIndustry: false, suggestions: [] };
  }
}

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
   Classify the user's target scope BEFORE planning:
   - If the target is a SINGLE CITY (e.g. "Rostock", "München", "Hamburg") →
     plan steps ONLY for that city. NEVER expand to neighboring or nearby cities,
     even if maxResults cannot be reached. Geography must NOT be inflated to hit a number.
     If the city cannot yield enough results, output an honest estimatedRows and a warning.
   - If the target is a REGION / STATE / COUNTRY (e.g. "Mecklenburg-Vorpommern", "Bayern",
     "Deutschland") → create one google_maps step for EVERY significant city in that region.
     Do NOT cherry-pick 3–5 cities. A German state like MV has ~15–20 relevant cities;
     NRW has 50+. Cover them all. Never invent cities that don't exist.

   ⚠ NEVER add cities to a single-city target just to reach maxResults. That is wrong.
     It is always better to warn than to silently change the geographic scope.

4. RESPECT maxResults STRICTLY.
   - Sum of all estimatedHits MUST be ≤ maxResults × 1.3.
   - If maxResults ≤ 50 → 1–2 steps (Maps only).
   - If maxResults ≤ 200 → 2–5 steps (Maps primary, Search if needed).
   - Only add catalog_scrape if still far short after Maps + Search.

5. HONEST ESTIMATES. If the target realistically cannot be reached (niche industry,
   small city, no broad directory), set estimatedRows to what IS reachable and add a
   warning explaining why, and suggest how to expand (broader region, related terms).

6. BROAD INDUSTRY TERMS → SPLIT INTO SUB-INDUSTRIES.
   If the research goal uses a broad industry umbrella (e.g. "Produktion", "Industrie",
   "Handwerk", "Dienstleistung", "IT", "Handel"), YOU MUST split it into specific
   sub-industries and create separate google_maps steps for each sub-industry × city.
   
   Examples of broad → specific splits:
   - "Produktion" → Maschinenbau, Metallverarbeitung, Kunststoffverarbeitung, Lebensmittelproduktion, Holzverarbeitung, Druckerei, Textilproduktion
   - "Handwerk" → Elektriker, Klempner/Sanitär, Schreiner/Tischler, Maler, Dachdecker, Kfz-Werkstatt, Bäcker, Fleischer
   - "IT" → Softwareentwicklung, IT-Dienstleister, Webdesign, IT-Sicherheit, Cloud-Services
   - "Dienstleistung" → Steuerberater, Rechtsanwalt, Unternehmensberatung, Personalvermittlung, Marketingagentur
   - "Handel" → Großhandel, Einzelhandel, Onlinehandel, Importeur, Distributor
   
   For each sub-industry, use the SPECIFIC German trade term as mapQuery (e.g. "Maschinenbau",
   not "Produktion"). This is critical — Maps searches for the specific category, not the umbrella.
   
   ⚠ NEVER use broad umbrella terms like "Produktionsunternehmen", "Industrieunternehmen",
   "Handwerksbetrieb" as mapQuery — these return random mixed results. Always use the specific
   trade/profession term.

7. Max 20 steps total. No multi_search steps.

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
    maxResults,
    systemPromptOverride,
  } = options;

  // Maps runs via Eden AI (mapsSearch uses edenai.ts internally) — no separate SerpApi/Serper key needed.
  // Only disable Maps when the caller explicitly sets useMaps=false.
  const mapsAvailable = useMaps && edenKeyAvailable;

  const builtInSystemPrompt = buildSystemPrompt({
    serpapi: serpApiKeyAvailable,
    serper: serperApiKeyAvailable,
    google_maps: mapsAvailable,
    brave: braveApiKeyAvailable,
    firecrawl_via_eden: edenKeyAvailable,
  });
  const systemPrompt = systemPromptOverride?.trim() || builtInSystemPrompt;

  const mapsHint = !useMaps
    ? "\nIMPORTANT: Do NOT use google_maps steps — use catalog_scrape and google_search only."
    : !mapsAvailable
    ? "\nIMPORTANT: No Google Maps API key available. Avoid google_maps steps; use catalog_scrape + google_search instead."
    : "";

  const unlimited = !maxResults || maxResults === 0;
  const maxResultsHint = unlimited
    ? `\nmaxResults: UNLIMITED — Cover the full geographic scope of the research goal exhaustively. If a region or state is mentioned, create one google_maps step per city in that region. Do NOT limit yourself to 3–5 cities.`
    : `\nmaxResults: ${maxResults} — The sum of all estimatedHits MUST NOT exceed ${Math.ceil(maxResults * 1.3)}. Plan only as many steps as needed to reach this target.`;

  // Detect broad industry terms and inject an explicit sub-industry expansion hint
  const BROAD_INDUSTRY_MAP: Record<string, string[]> = {
    "produktion": ["Maschinenbau", "Metallverarbeitung", "Kunststoffverarbeitung", "Lebensmittelproduktion", "Holzverarbeitung", "Druckerei", "Textilproduktion", "Elektronikhersteller"],
    "industrie": ["Maschinenbau", "Anlagenbau", "Metallverarbeitung", "Chemieindustrie", "Elektroindustrie", "Automobilzulieferer", "Logistik"],
    "handwerk": ["Elektriker", "Sanitär Heizung Klima", "Schreiner Tischler", "Maler Lackierer", "Dachdecker", "Kfz-Werkstatt", "Bäckerei", "Fleischerei"],
    "it": ["Softwareentwicklung", "IT-Dienstleister", "Webdesign Agentur", "IT-Sicherheit", "Cloud Services", "Datenbankentwicklung"],
    "dienstleistung": ["Steuerberater", "Rechtsanwalt", "Unternehmensberatung", "Personalvermittlung", "Marketingagentur", "Buchführung Buchhaltung"],
    "handel": ["Großhandel", "Einzelhandel", "Onlinehandel", "Importeur Exporteur", "Distributionslogistik"],
    "bau": ["Hochbau Bauunternehmen", "Tiefbau", "Straßenbau", "Trockenbau", "Fassadenbau", "Innenausbau", "Abbruchunternehmen"],
  };

  const promptLower = prompt.toLowerCase();
  let industryHint = "";
  for (const [broad, subIndustries] of Object.entries(BROAD_INDUSTRY_MAP)) {
    if (promptLower.includes(broad)) {
      industryHint = `\n\n⚠ CRITICAL: "${broad}" is a BROAD industry term. You MUST split it into specific sub-industries as separate google_maps steps. Use these specific mapQuery terms: ${subIndustries.map(s => `"${s}"`).join(", ")}. NEVER use "${broad}" as mapQuery — use the specific terms above. Create separate steps for each sub-industry × city combination.`;
      break;
    }
  }

  // Inject known city list when a German region is detected — LLM can't know all cities
  let regionHint = "";
  const detectedRegion = detectRegion(prompt);
  if (detectedRegion) {
    const cities = getCitiesForRegion(detectedRegion);
    if (cities.length > 0) {
      regionHint = `\n\nKNOWN CITIES in this region (use ALL of them across steps, not just the largest): ${cities.join(", ")}. Each city must appear in at least one google_maps step.`;
    }
  }

  const resp = await edenChatCompletion({
    apiKey: edenApiKey,
    region: "us",
    model,
    system: systemPrompt,
    prompt: `Research goal: ${prompt}${mapsHint}${maxResultsHint}${industryHint}${regionHint}`,
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

  // Guard: if LLM returned an empty steps array (happens when it can't interpret
  // a vague prompt or has no enabled tools), inject a minimal fallback step so
  // the agent always has something to execute.
  if (plan.steps.length === 0) {
    plan.steps = [{
      id: "step_1",
      type: "google_search",
      label: `Suche: ${prompt.slice(0, 60)}`,
      query: prompt,
      source: "auto",
      estimatedHits: 20,
      priority: 1,
    }];
    plan.estimatedRows = 20;
    plan.warnings = [
      ...plan.warnings,
      "Keine spezifischen Schritte vom Planer generiert — generischer Fallback-Schritt eingefügt.",
    ];
  }

  // Re-number steps cleanly
  plan.steps = plan.steps.map((step, i) => ({ ...step, id: `step_${i + 1}` }));

  // Recalculate total
  plan.estimatedRows = plan.steps.reduce((s, step) => s + step.estimatedHits, 0);

  return plan;
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
1. google_maps zuerst (priority 1): Wenn noch nicht alle Städte/Stadtteile abgedeckt, weitere Maps-Steps
2. catalog_scrape (priority 1): Weitere Katalog-Seiten (andere Kataloge oder nächste Seiten)
   - extractionPrompt: "Extrahiere Firmenname + eigene Website-URL (NICHT Katalog-Domain), Telefon, Adresse"
3. Steps mit hohem Ertrag (>30%) → mehr davon (mehr Städte, weitere Kataloge)
4. Steps mit null/niedrigem Ertrag (<5%) → NICHT wiederholen, anderen Typ versuchen
5. multi_search / google_search nur als letzte Ergänzung (priority 3)
6. Maximal 10 neue Steps vorschlagen

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

  // Build yield summary for the LLM
  const yieldLines = previousSteps
    .filter((s) => stepYields[s.id] !== undefined)
    .map((s) => {
      const y = stepYields[s.id];
      const rate = s.estimatedHits > 0 ? (y / s.estimatedHits * 100).toFixed(0) : "?";
      return `- [${s.type}] "${s.label}" → ${y} unique / ${s.estimatedHits} estimated (${rate}% Ertrag)`;
    });

  const yieldSummary = yieldLines.length > 0
    ? `\nErtrag der letzten Steps:\n${yieldLines.join("\n")}`
    : "";

  const userPrompt = `Ziel: "${goal.description}"
Zielanzahl: ${goal.targetCount} · Bereits gefunden: ${currentUniqueCount} · Noch benötigt: ${remaining}${yieldSummary}

Erweitere den Plan um neue Steps, um die verbleibenden ${remaining} Unternehmen zu finden.`;

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
