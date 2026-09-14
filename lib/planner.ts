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
import { detectRegion, getCitiesForRegion, GERMAN_REGIONS } from "./regions";
import type { AgentGoal, AgentStepResult } from "./agent-types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlanStepType =
  | "google_search"       // single query
  | "multi_search"        // query × N cities (region expansion)
  | "google_maps"         // maps search in a location
  | "catalog_scrape"      // paginated catalog page
  | "directory_search";   // firecrawl restricted to German business directories

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

function buildSystemPrompt(availableKeys: Record<string, boolean>): string {
  const keysInfo = Object.entries(availableKeys)
    .map(([k, v]) => `${k}: ${v ? "✓ verfügbar" : "✗ nicht verfügbar"}`)
    .join(", ");

  return `Du bist ein Web-Research-Planer für B2B-Datenrecherche.
Erstelle einen optimalen Crawling-Plan als kompaktes JSON.

Verfügbare API-Keys: ${keysInfo}

Verfügbare Strategien:
- google_search: Einzelne Google-Suchanfrage (bis 30 Treffer)
- multi_search: Template mit {city}-Platzhalter → wird für jede Stadt einer Region expandiert
- google_maps: Lokale Firmensuche via Google Maps (besonders gut für Handwerksbetriebe)
- catalog_scrape: Katalogseite mit Pagination scrapen (gelbeseiten, wlw, 11880, branchenverzeichnis)

Bekannte Kataloge: ${Object.keys(CATALOG_DOMAINS).join(", ")}

Regeln:
1. Wenn Region erkannt → multi_search mit {city}-Template bevorzugen (effizienter als viele Einzel-Queries)
2. Katalog-Scraping vor Google-Search wenn Katalog passend → mehr strukturierte Daten, weniger Queries
3. google_maps immer für lokale Dienstleister (Handwerk, Bau, Energie, etc.) zusätzlich einplanen
4. Maximal 15 Steps im Plan
5. estimatedHits: realistische Schätzung (Google: 5-30, Maps: 10-50, Katalog: 20-200 pro Seite)
6. priority: 1=zuerst (Kataloge), 2=Maps, 3=Google Search (als Ergänzung)

Antworte NUR mit JSON (kein Markdown, keine Erklärungen):
{
  "goal": "Kurze Zusammenfassung was gesucht wird",
  "steps": [
    {
      "type": "multi_search|google_search|google_maps|catalog_scrape",
      "label": "Menschenlesbarer Step-Name",
      "query": "...",           // für google_search
      "queryTemplate": "...",   // für multi_search (muss {city} enthalten)
      "region": "mv|nrw|by|...",// für multi_search
      "mapQuery": "...",        // für google_maps
      "location": "...",        // für google_maps
      "url": "...",             // für catalog_scrape
      "extractionPrompt": "...",// für catalog_scrape
      "maxPages": 5,            // für catalog_scrape
      "source": "auto",
      "estimatedHits": 30,
      "priority": 1
    }
  ],
  "estimatedRows": 150,
  "warnings": []
}`;
}

// ── Planner call ──────────────────────────────────────────────────────────────

export interface PlannerOptions {
  edenApiKey: string;
  model?: string;
  serpApiKeyAvailable?: boolean;
  braveApiKeyAvailable?: boolean;
  edenKeyAvailable?: boolean;
}

export async function createDiscoveryPlan(
  prompt: string,
  options: PlannerOptions
): Promise<DiscoveryPlan> {
  const {
    edenApiKey,
    model = "openai/gpt-4o-mini",
    serpApiKeyAvailable = false,
    braveApiKeyAvailable = false,
    edenKeyAvailable = true,
  } = options;

  // Pre-detect region to inject city list into prompt (saves LLM having to know)
  const detectedRegion = detectRegion(prompt);
  const regionContext = detectedRegion
    ? `\nErkannte Region: "${GERMAN_REGIONS[detectedRegion]?.name}" (Key: "${detectedRegion}")\nStädte: ${getCitiesForRegion(detectedRegion).slice(0, 10).join(", ")} [u.a.]`
    : "";

  const systemPrompt = buildSystemPrompt({
    serpapi: serpApiKeyAvailable,
    brave: braveApiKeyAvailable,
    firecrawl_via_eden: edenKeyAvailable,
  });

  const resp = await edenChatCompletion({
    apiKey: edenApiKey,
    region: "us",   // Planner always uses US — openai/gpt-4o-mini not on EU endpoint
    model,
    system: systemPrompt,
    prompt: `Auftrag: ${prompt}${regionContext}`,
    maxTokens: 1500,
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

  // Expand multi_search steps with city queries
  for (const step of plan.steps) {
    if (step.type === "multi_search" && step.queryTemplate) {
      const regionKey = step.region ?? detectedRegion ?? "";
      const cities = getCitiesForRegion(regionKey);
      if (cities.length > 0) {
        step.queries = cities.map((city) =>
          step.queryTemplate!.replace(/\{city\}/g, city)
        );
        step.estimatedHits = cities.length * 15;
      } else {
        // Downgrade to single search
        step.type = "google_search";
        step.query = step.queryTemplate.replace(/\{city\}/g, "").trim();
      }
    }
  }

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

Entscheidungsregeln:
1. Steps mit hohem Ertrag (unique/estimated > 0.3) → mehr davon (mehr Städte, weitere Kataloge)
2. Steps mit keinem/niedrigem Ertrag → verwerfen, NICHT wiederholen
3. google_maps besonders für lokale Dienstleister (Handwerk, Bau, Energie)
4. Bei breiten Suchen: multi_search mit {city} expandieren
5. Maximal 10 neue Steps vorschlagen
6. estimatedHits realistisch (5-200 je nach Typ)

Antworte NUR mit JSON:
{
  "steps": [ ... wie üblich ... ],
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

    // Expand multi_search steps
    const detectedRegion = goal.region ?? detectRegion(goal.description);
    for (const step of newSteps) {
      if (step.type === "multi_search" && step.queryTemplate) {
        const regionKey = step.region ?? detectedRegion ?? "";
        const cities = getCitiesForRegion(regionKey);
        if (cities.length > 0) {
          step.queries = cities.map((city) =>
            step.queryTemplate!.replace(/\{city\}/g, city)
          );
          step.estimatedHits = cities.length * 15;
        } else {
          step.type = "google_search";
          step.query = step.queryTemplate.replace(/\{city\}/g, "").trim();
        }
      }
    }

    return {
      goal: goal.description,
      steps: newSteps,
      estimatedRows: newSteps.reduce((s, step) => s + step.estimatedHits, 0),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    };
  } catch {
    // Fallback: widen the search with more multi_search variations
    const detectedRegion = goal.region ?? detectRegion(goal.description);
    const cities = getCitiesForRegion(detectedRegion ?? "");
    if (cities.length === 0) return null;

    const baseIdx = previousSteps.length;
    return {
      goal: goal.description,
      steps: [{
        id: `step_${baseIdx + 1}`,
        type: "multi_search",
        label: `Breite Suche: ${goal.description.slice(0, 50)}`,
        queryTemplate: `{city} ${goal.description.replace(/in\s+\w+/i, "").trim()}`,
        region: detectedRegion ?? "",
        queries: cities.map((c) => `${c} ${goal.description.replace(/in\s+\w+/i, "").trim()}`),
        source: "auto",
        estimatedHits: cities.length * 10,
        priority: 3,
      }],
      estimatedRows: cities.length * 10,
      warnings: ["Replan fehlgeschlagen — generischer Fallback"],
    };
  }
}
