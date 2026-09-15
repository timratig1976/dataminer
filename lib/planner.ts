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

function buildSystemPrompt(availableKeys: Record<string, boolean>): string {
  const keysInfo = Object.entries(availableKeys)
    .map(([k, v]) => `${k}: ${v ? "✓ verfügbar" : "✗ nicht verfügbar"}`)
    .join(", ");

  return `Du bist ein Web-Research-Planer für B2B-Datenrecherche.
Erstelle einen optimalen Discovery-Plan als kompaktes JSON.

Verfügbare API-Keys: ${keysInfo}

═══ PIPELINE-STRATEGIE (in dieser Reihenfolge!) ═══

STUFE 1 — DISCOVERY (parallel, so viele Quellen wie möglich):
1a. google_maps  → PRIMARY für lokale Dienstleister (Handwerk, Bau, Energie, Gastronomie etc.)
    - Präziseste Quelle für echte Firmendaten, direkt strukturiert
    - IMMER planen wenn branchenspezifische lokale Suche
    - estimatedHits: 20-80 pro Location-Query
    priority: 1

1b. catalog_scrape → ALS LINK-EXTRAKTOR (NICHT als Zieldomain scrapen!)
    - Katalogseiten wie Gelbe Seiten, WLW, 11880 enthalten Links zu den echten Firmenwebsites
    - Der Scraper extrahiert: Firmenname + verlinkte eigene Website → diese wird als Lead importiert
    - Firmen ohne eigene Website → Katalogeintrag als Fallback, niedrigere Qualität
    - Kataloge decken Coverage-Lücken (Firmen ohne Google-Präsenz)
    - estimatedHits: 20-200 pro Katalog-Seite
    priority: 1

1c. multi_search / google_search → ERGÄNZEND für Long-Tail-Treffer
    - Für Firmen die weder Maps noch Kataloge erfassen
    - multi_search mit {city}-Template wenn Region bekannt
    - estimatedHits: 5-30 pro Query
    priority: 3

═══ ENTSCHEIDUNGSREGELN ═══
1. Region erkannt + lokale Branche → google_maps ZUERST (priority 1), dann Kataloge (priority 1), dann multi_search (priority 3)
2. Kataloge: 2-3 relevante Kataloge einplanen (gelbeseiten.de, wlw.de, 11880.com sind Standard für DE)
3. google_maps: Pro Region mindestens 1 Maps-Step, für große Regionen mehrere Städte als separate Steps
4. google_search / multi_search: Nur als Ergänzung, nicht als primäre Quelle
5. Maximal 15 Steps total
6. estimatedHits realistisch (Maps: 20-80, Katalog: 30-150, Google: 5-25)

Bekannte Kataloge: ${Object.keys(CATALOG_DOMAINS).join(", ")}

Antworte NUR mit JSON (kein Markdown, keine Erklärungen):
{
  "goal": "Kurze Zusammenfassung was gesucht wird",
  "steps": [
    {
      "type": "google_maps|catalog_scrape|multi_search|google_search",
      "label": "Menschenlesbarer Step-Name",
      "query": "...",           // für google_search
      "queryTemplate": "...",   // für multi_search (muss {city} enthalten)
      "region": "mv|nrw|by|...",// für multi_search
      "mapQuery": "...",        // für google_maps
      "location": "...",        // für google_maps (Stadt oder Region)
      "url": "...",             // für catalog_scrape (Katalog-Suchergebnis-URL mit Branche+Region)
      "extractionPrompt": "Extrahiere: Firmenname, Website-URL (eigene Domain, NICHT die Katalog-Domain), Telefon, Adresse", // für catalog_scrape
      "maxPages": 3,            // für catalog_scrape
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

  // Expand multi_search steps: one google_search step per city (visible, cancellable, loggable)
  const expandedSteps: PlanStep[] = [];
  let stepCounter = 0;

  for (const step of plan.steps) {
    if (step.type === "multi_search" && step.queryTemplate) {
      const regionKey = step.region ?? detectedRegion ?? "";
      const cities = getCitiesForRegion(regionKey);
      if (cities.length > 0) {
        // Split into individual google_search steps — one per city
        for (const city of cities) {
          stepCounter++;
          expandedSteps.push({
            id: `step_${stepCounter}`,
            type: "google_search",
            label: `${step.label} — ${city}`,
            query: step.queryTemplate.replace(/\{city\}/g, city),
            source: step.source ?? "auto",
            estimatedHits: 15,
            priority: step.priority,
          });
        }
      } else {
        // No cities for region — downgrade to single search
        stepCounter++;
        expandedSteps.push({
          ...step,
          id: `step_${stepCounter}`,
          type: "google_search",
          query: step.queryTemplate.replace(/\{city\}/g, "").trim(),
        });
      }
    } else {
      stepCounter++;
      expandedSteps.push({ ...step, id: `step_${stepCounter}` });
    }
  }

  plan.steps = expandedSteps;

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
