/**
 * lib/agent-runner.ts
 * Goal-based discovery agent: Plan → Execute → Observe → Decide loop.
 *
 * Persists state in agent_runs (Postgres) so runs survive server restarts.
 * The client drives the loop by calling executeNextStep repeatedly (like
 * useRunColumns does for cells). No new infra needed — works in Next.js
 * serverless/edge.
 */

import { randomUUID } from "crypto";
import type { AgentGoal, AgentRunState, AgentRunStatus, AgentStepResult } from "./agent-types";
import type { DiscoveryPlan, PlanStep } from "./planner";
import {
  createAgentRun,
  getAgentRun,
  updateAgentRunState,
  getExistingDomains,
  appendDiscoveryRows,
  appendLog,
} from "./db";
import { createDiscoveryPlan, refinePlan } from "./planner";
import { discoverySearch, hitToSeedRow, normalizeDomain } from "./discovery";
import { mapsSearch, placeToSeedExtras, type MapsPlace } from "./maps";
import { edenScrapeUrl, edenChatCompletion } from "./edenai";
import { scrapeCatalog } from "./catalog-scraper";
import { listRows } from "./db";
import { learnCatalogDomains } from "./catalog-registry";
import { isOperationCancelled } from "./operations";

// ── Places Validation Hook ────────────────────────────────────────────────────

/**
 * Validates a batch of Maps places against the goal description using an LLM.
 * Removes irrelevant, implausible, or low-quality entries.
 *
 * Returns the filtered list + a short reason for each rejection (for logging).
 */
export async function validatePlaces(
  places: MapsPlace[],
  goalDescription: string,
  edenApiKey: string,
  model = "openai/gpt-4o-mini"
): Promise<{ valid: MapsPlace[]; rejected: Array<{ name: string; reason: string }> }> {
  if (places.length === 0) return { valid: [], rejected: [] };

  const prompt = `Goal: "${goalDescription}"

Places to validate (${places.length} entries):
${places.map((p, i) => `[${i}] ${p.name} | ${p.category ?? ""} | ${p.address} | ${p.website}`).join("\n")}

For each entry decide: KEEP or REJECT.
REJECT if:
- Wrong industry/category (e.g. goal is "Heizungsbauer" but entry is a supermarket)
- Generic chain/franchise not matching the niche (e.g. OBI, IKEA for craftsmen)
- No real business name (e.g. "Test", empty, or generic placeholder)
- Clearly outside the target geography if a specific region was named

Respond ONLY with compact JSON — no prose:
{ "results": [{"i":0,"keep":true},{"i":1,"keep":false,"reason":"wrong category: restaurant"},...] }`;

  try {
    const resp = await edenChatCompletion({
      apiKey: edenApiKey,
      region: "us",
      model,
      system: "You are a precise B2B data quality validator. Respond only with the requested JSON.",
      prompt,
      maxTokens: 1000,
      temperature: 0,
    });

    const raw = resp.raw?.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim() ?? "";
    const parsed = JSON.parse(raw) as { results: Array<{ i: number; keep: boolean; reason?: string }> };

    const valid: MapsPlace[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];

    for (const r of parsed.results) {
      const place = places[r.i];
      if (!place) continue;
      if (r.keep) {
        valid.push(place);
      } else {
        rejected.push({ name: place.name, reason: r.reason ?? "filtered by validator" });
      }
    }
    // Safety: if LLM returned fewer results than expected, keep unmentioned ones
    const mentionedIndices = new Set(parsed.results.map(r => r.i));
    for (let i = 0; i < places.length; i++) {
      if (!mentionedIndices.has(i)) valid.push(places[i]);
    }
    return { valid, rejected };
  } catch {
    // On any error, return all places unfiltered — validation is best-effort
    return { valid: places, rejected: [] };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function stamp(run: AgentRunState): void {
  run.updatedAt = now();
}

/**
 * Evaluate whether the run should stop (terminal states).
 * Returns the terminal status, or null if we should continue.
 */
export function evaluateStopCondition(run: AgentRunState): AgentRunStatus | null {
  // Target reached?
  if (run.uniqueCount >= run.goal.targetCount) return "completed";

  // Budget exhausted?
  if (run.goal.maxBudgetUsd != null && run.costUsd >= run.goal.maxBudgetUsd) return "budget_exhausted";

  // Wall-clock cap?
  if (run.goal.maxDurationMin != null) {
    const elapsed = (Date.now() - new Date(run.startedAt).getTime()) / 60_000;
    if (elapsed >= run.goal.maxDurationMin) return "budget_exhausted";
  }

  // Safety iteration limit?
  if (run.goal.maxIterations != null && run.iteration >= run.goal.maxIterations) return "budget_exhausted";

  // Diminishing returns check — only stop when genuinely exhausted.
  // Must have executed at least 40% of plan steps AND ≥ 10 steps total before checking.
  const planSteps = run.plan.steps.length;
  const minStepsForDiminish = Math.max(10, Math.ceil(planSteps * 0.4));
  if (run.stepResults.length >= minStepsForDiminish) {
    // Check last 6 steps (not 4) for a better signal
    const recent = run.stepResults.slice(-6);
    const recentInserted = recent.reduce((s, r) => s + r.uniqueInserted, 0);
    const avgPerStep = recentInserted / recent.length;
    // Stop if average new leads per step drops below 3
    if (avgPerStep < 3) {
      run.log.push(`⚠️ Diminishing returns: only ${recentInserted} new leads in last ${recent.length} steps (avg ${avgPerStep.toFixed(1)}/step). Sources exhausted, stopping.`);
      return "completed";
    }
  }

  return null;
}

// ── Start ────────────────────────────────────────────────────────────────────

export interface StartOptions {
  edenApiKey: string;
  model?: string;
  serpApiKey?: string;
  serperApiKey?: string;
  braveApiKey?: string;
  systemPromptOverride?: string | null;
}

export async function startAgentRun(
  caseId: string,
  goal: AgentGoal,
  opts: StartOptions
): Promise<AgentRunState> {
  const { edenApiKey, model, serpApiKey, serperApiKey, braveApiKey, systemPromptOverride } = opts;

  // Generate initial plan
  const plan = await createDiscoveryPlan(goal.description, {
    edenApiKey,
    model: model ?? "openai/gpt-4o-mini",
    serpApiKeyAvailable: !!serpApiKey,
    serperApiKeyAvailable: !!serperApiKey,
    braveApiKeyAvailable: !!braveApiKey,
    edenKeyAvailable: true,
    useMaps: goal.useMaps ?? true,
    systemPromptOverride: systemPromptOverride ?? null,
  });

  const run: AgentRunState = {
    id: randomUUID(),
    caseId,
    goal,
    status: "running",
    iteration: 0,
    plan,
    stepResults: [],
    uniqueCount: 0,
    costUsd: 0,
    startedAt: now(),
    updatedAt: now(),
    log: [`Plan erstellt: ${plan.steps.length} Steps, ~${plan.estimatedRows} geschätzte Treffer`],
  };

  await createAgentRun(run);
  await appendLog(caseId, `🎯 Ziel-Suche gestartet: "${goal.description}" · Ziel: ${goal.targetCount} Unternehmen`);
  return run;
}

// ── Execute a single PlanStep ────────────────────────────────────────────────

export interface StepEnv {
  edenApiKey: string;
  serpApiKey?: string;
  serperApiKey?: string;
  apifyApiToken?: string;
  braveApiKey?: string;
  scraplingUrl?: string;
  scraplingToken?: string;
}

export async function executeNextStep(
  runId: string,
  env: StepEnv,
  cancelKey: string
): Promise<AgentRunState> {
  const run = await getAgentRun(runId);
  if (!run) throw new Error(`AgentRun ${runId} not found`);

  // Check stop conditions first
  const stop = evaluateStopCondition(run);
  if (stop) {
    run.status = stop;
    stamp(run);
    await updateAgentRunState(run);
    return run;
  }

  // Find first unexecuted step (by priority then order)
  const executedIds = new Set(run.stepResults.map((r) => r.stepId));
  const nextStep = run.plan.steps
    .filter((s) => !executedIds.has(s.id))
    .sort((a, b) => a.priority - b.priority || run.plan.steps.indexOf(a) - run.plan.steps.indexOf(b))[0];

  if (!nextStep) {
    // All steps executed — time to replan
    return handleReplan(run, env, cancelKey);
  }

  // Execute
  const stepId = nextStep.id;
  const result = await executePlanStep(nextStep, run, env, cancelKey);

  // Check cancellation
  if (isOperationCancelled(cancelKey)) {
    run.status = "cancelled";
    stamp(run);
    await updateAgentRunState(run);
    return run;
  }

  run.stepResults.push(result);
  run.uniqueCount += result.uniqueInserted;
  run.costUsd += result.costUsd;
  stamp(run);

  // Auto-inject catalog deep-crawl steps for any newly found catalog rows
  // (rows with is_catalog="true" that don't already have a deep-crawl step)
  await injectCatalogDeepCrawlSteps(run);

  // Log
  const logLine = result.error
    ? `⚠️ ${nextStep.label}: ${result.error}`
    : `✓ ${nextStep.label}: +${result.uniqueInserted} neu (${result.hitsFound} Treffer via ${result.source})`;
  run.log.push(logLine);
  if (run.log.length > 200) run.log = run.log.slice(-200);

  // Check stop after step
  const newStop = evaluateStopCondition(run);
  if (newStop) {
    run.status = newStop;
    stamp(run);
    await updateAgentRunState(run);
    await appendLog(run.caseId, `🎯 Ziel-Suche ${newStop}: ${run.uniqueCount}/${run.goal.targetCount} Unternehmen · $${run.costUsd.toFixed(3)}`);
    return run;
  }

  run.status = "running";
  await updateAgentRunState(run);
  return run;
}

// ── Auto-inject catalog deep-crawl steps ────────────────────────────────────

/**
 * Domains that are job/service marketplaces or aggregators — they list
 * service requests, not actual company directories. Deep-crawling them
 * yields 0 real firm URLs. Skip them in catalog_deep_crawl steps.
 */
const NON_SCRAPEAGLE_CATALOG_DOMAINS = new Set([
  "houzz.de", "houzz.com",
  "my-hammer.de", "myhammer.de",
  "blauarbeit.de", "1-2-do.com", "1-2-do.de",
  "homeday.de", "handwerker-vermittlung.de",
  "auftragsboerse.de", "tripadvisor.de", "tripadvisor.com",
  "yelp.de", "yelp.com",
  "gelbeseiten.de",   // paginated but low yield — skip deep crawl, use planned steps
]);

/**
 * For each catalog URL that doesn't yet have a deep-crawl step in the plan,
 * inject a new catalog_deep_crawl step at priority 1.5 (after current step, before next search).
 */
async function injectCatalogDeepCrawlSteps(run: AgentRunState): Promise<void> {
  try {
    const allRows = await listRows(run.caseId);
    const catalogUrls = allRows
      .map(r => (r.data as Record<string, string | null>)["source_url"] ?? "")
      .filter(url => {
        const row = allRows.find(r => (r.data as Record<string, string | null>)["source_url"] === url);
        return row && (row.data as Record<string, string | null>)["is_catalog"] === "true";
      });

    // Find URLs already covered by existing deep-crawl steps
    const existingUrls = new Set(
      run.plan.steps
        .filter(s => s.type === "catalog_deep_crawl")
        .map(s => s.url ?? "")
    );

    const newUrls = catalogUrls.filter(url => {
      if (!url) return false;
      if (existingUrls.has(url)) return false;
      // Skip non-scrapeble aggregator/marketplace domains — they list requests, not firms
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, "");
        if (NON_SCRAPEAGLE_CATALOG_DOMAINS.has(hostname)) return false;
      } catch { /* keep */ }
      return true;
    });
    if (newUrls.length === 0) return;

    // Learn new catalog domains into the persistent registry
    const newDomains = newUrls.map(url => {
      try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
    }).filter(Boolean);
    if (newDomains.length > 0) {
      await learnCatalogDomains(newDomains).catch(() => {}); // non-fatal
    }

    const existingCount = run.plan.steps.length;
    for (let i = 0; i < newUrls.length; i++) {
      const url = newUrls[i];
      let hostname = url;
      try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
      run.plan.steps.push({
        id: `step_crawl_${existingCount + i + 1}`,
        type: "catalog_deep_crawl" as import("./planner").PlanStepType,
        label: `📋 Katalog crawlen: ${hostname}`,
        url,
        maxPages: 5,
        source: "firecrawl",
        estimatedHits: 50,
        priority: 1, // high priority — run before more searches
      });
    }

    if (newUrls.length > 0) {
      run.log.push(`📋 ${newUrls.length} Katalogseite(n) erkannt → Deep-Crawl-Steps eingefügt`);
    }
  } catch { /* non-fatal */ }
}

// ── Execute one PlanStep (maps, search, or catalog scrape) ──────────────────

async function executePlanStep(
  step: PlanStep,
  run: AgentRunState,
  env: StepEnv,
  cancelKey: string
): Promise<AgentStepResult> {
  const t0 = now();
  let hitsFound = 0;
  let uniqueInserted = 0;
  let costUsd = 0;
  let source = step.source ?? "auto";
  let error: string | undefined;

  try {
    const existingDomains = await getExistingDomains(run.caseId);

    if (step.type === "google_maps") {
      // ── Maps step ──
      // Keep mapQuery and location SEPARATE — Serper Places needs them as distinct params
      const mapQuery = step.mapQuery ?? step.label;
      const mapLocation = step.location ?? undefined;
      // Combined for providers that take a single string (SerpApi, Apify, fallback web search)
      const query = mapLocation ? `${mapQuery} ${mapLocation}` : mapQuery;
      const serpApiKey = env.serpApiKey ?? process.env.SERP_API_KEY?.trim();
      const serperApiKey = env.serperApiKey ?? process.env.SERPER_API_KEY?.trim();
      const apifyApiToken = env.apifyApiToken ?? process.env.APIFY_API_TOKEN?.trim();
      const scraplingUrl = env.scraplingUrl ?? process.env.SCRAPLING_URL?.trim();
      const scraplingToken = env.scraplingToken ?? process.env.SCRAPLING_TOKEN?.trim();

      if (!serpApiKey && !serperApiKey && !apifyApiToken && !scraplingUrl) {
        // No Maps provider — fall back to a geo-qualified web search
        const fallbackQuery = step.mapQuery
          ? `${step.mapQuery}${step.location ? ` ${step.location}` : ""}`
          : step.label;
        run.log.push(`⚠️ No Maps provider, falling back to web search: ${fallbackQuery}`);
        const resp = await discoverySearch(fallbackQuery, {
          source: "auto",
          limit: 200,  // always request maximum
          excludeDomains: existingDomains,
          serpApiKey: env.serpApiKey,
          serperApiKey: env.serperApiKey,
          braveApiKey: env.braveApiKey,
          scraplingUrl: env.scraplingUrl,
          scraplingToken: env.scraplingToken,
          edenApiKey: env.edenApiKey,
        });
        hitsFound = resp.hits.length;
        source = `maps-fallback-search (${resp.source})`;
        if (typeof resp.costUsd === "number") costUsd += resp.costUsd;
        if (resp.hits.length > 0) {
          const seeds = resp.hits.map(hitToSeedRow).map((data) => ({
            id: randomUUID(), caseId: run.caseId, rowIndex: 0,
            data: data as Record<string, string>,
            cellStatuses: {}, cellErrors: {}, createdAt: now(), updatedAt: now(),
          }));
          const { inserted } = await appendDiscoveryRows(run.caseId, seeds);
          uniqueInserted = inserted;
        }
        return { stepId: step.id, attemptedAt: t0, hitsFound, uniqueInserted, costUsd, source };
      }

      const resp = await mapsSearch({
        query,
        ll: mapLocation,  // passed separately to Serper Places — key fix for DE coverage
        // Priority: SerpApi > Serper > Apify > Scrapling
        // Apify actor (apify/google-maps-scraper) currently unreliable — skip until validated
        provider: serpApiKey ? "maps-serpapi" : serperApiKey ? "maps-serper" : apifyApiToken ? "maps-apify" : "maps-scrapling",
        limit: 200,
        serpApiKey: serpApiKey ?? undefined,
        serperApiKey: serperApiKey ?? undefined,
        apifyApiToken: apifyApiToken ?? undefined,
        scraplingUrl: scraplingUrl ?? undefined,
        scraplingToken: scraplingToken ?? undefined,
        excludeDomains: existingDomains,
      });

      if (isOperationCancelled(cancelKey)) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "cancelled" };
      }

      hitsFound = resp.places.length;
      source = resp.provider;

      // Fallback: if Maps returns 0 places, try web search instead.
      // Serper Places has limited coverage for niche categories in smaller German cities.
      if (resp.places.length === 0 && (env.serpApiKey || env.serperApiKey || env.braveApiKey)) {
        const fallbackQuery = step.mapQuery
          ? `${step.mapQuery}${step.location ? ` ${step.location}` : ""}`
          : step.label;
        run.log.push(`⚠️ Maps (${resp.provider}) returned 0 places, falling back to web search: ${fallbackQuery}`);
        const webResp = await discoverySearch(fallbackQuery, {
          source: "auto",
          limit: 200,
          excludeDomains: existingDomains,
          serpApiKey: env.serpApiKey,
          serperApiKey: env.serperApiKey,
          braveApiKey: env.braveApiKey,
          scraplingUrl: env.scraplingUrl,
          scraplingToken: env.scraplingToken,
          edenApiKey: env.edenApiKey,
        });
        if (isOperationCancelled(cancelKey)) {
          return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "cancelled" };
        }
        hitsFound = webResp.hits.length;
        source = `maps-fallback-search (${webResp.source})`;
        if (typeof webResp.costUsd === "number") costUsd += webResp.costUsd;
        if (webResp.hits.length > 0) {
          const seeds = webResp.hits.map(hitToSeedRow).map((data) => ({
            id: randomUUID(), caseId: run.caseId, rowIndex: 0,
            data: data as Record<string, string>,
            cellStatuses: {}, cellErrors: {}, createdAt: now(), updatedAt: now(),
          }));
          const { inserted } = await appendDiscoveryRows(run.caseId, seeds);
          uniqueInserted = inserted;
        }
        return { stepId: step.id, attemptedAt: t0, hitsFound, uniqueInserted, costUsd, source };
      }

      if (resp.places.length > 0) {
        // ── Optional LLM validation of places against goal ──
        let placesToInsert = resp.places;
        if (run.goal.validatePlaces && env.edenApiKey) {
          const { valid, rejected } = await validatePlaces(
            resp.places,
            run.goal.description,
            env.edenApiKey,
          );
          if (rejected.length > 0) {
            run.log.push(`🔍 Validator: ${rejected.length} irrelevant entries removed (${rejected.slice(0, 3).map(r => r.name).join(", ")}${rejected.length > 3 ? "…" : ""})`);
          }
          placesToInsert = valid;
        }

        const seeds = placesToInsert.map((p) => {
          const url = p.website || p.mapsUrl;
          const websiteUrl = p.website
            ? (p.website.startsWith("http") ? p.website : `https://${p.website}`)
            : "";
          const domain = websiteUrl ? normalizeDomain(websiteUrl) : "";
          return {
            data: {
              company_name: p.name,
              domain,
              source_url: url,
              source_title: p.name,
              source_snippet: [p.category, p.address].filter(Boolean).join(" · "),
              source_domain: p.website ?? "",
              search_query: query,
              search_source: `google-maps (${resp.provider})`,
              ...placeToSeedExtras(p),
            },
          };
        });
        const { inserted } = await appendDiscoveryRows(
          run.caseId,
          seeds.map((s) => ({
            id: randomUUID(),
            caseId: run.caseId,
            rowIndex: 0,
            data: s.data as Record<string, string>,
            cellStatuses: {},
            cellErrors: {},
            createdAt: now(),
            updatedAt: now(),
          }))
        );
        uniqueInserted = inserted;
      }
    } else if (step.type === "catalog_deep_crawl" as string) {
      // ── Catalog deep crawl (auto-injected for discovered catalog rows) ──
      const url = step.url ?? "";
      if (!url) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "none", error: "No catalog URL" };
      }
      // Skip non-scrapeble aggregator domains — saves time + Firecrawl credits
      try {
        const hostname = new URL(url).hostname.replace(/^www\./, "");
        if (NON_SCRAPEAGLE_CATALOG_DOMAINS.has(hostname)) {
          run.log.push(`⏭ Katalog übersprungen (Vermittlungsplattform, nicht scrapeabel): ${hostname}`);
          return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "skipped" };
        }
      } catch { /* keep */ }
      if (!env.edenApiKey) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "none", error: "No Eden API key" };
      }

      const existingDomainSet = new Set((await getExistingDomains(run.caseId)).map(d => d.toLowerCase()));

      const result = await scrapeCatalog({
        url,
        extractionPrompt: `Firmen, Unternehmen, Betriebe — Name, Website, Telefon, Adresse`,
        followPagination: true,
        maxPages: step.maxPages ?? 5,
        edenApiKey: env.edenApiKey,
      });

      hitsFound = result.entries.length;
      source = "catalog-deep-crawl";

      if (result.entries.length > 0) {
        const rows = result.entries
          .filter(e => {
            if (!e.domain) return true; // keep domainless entries
            if (existingDomainSet.has(e.domain.toLowerCase())) return false;
            existingDomainSet.add(e.domain.toLowerCase());
            return true;
          })
          .map(e => ({
            id: randomUUID(), caseId: run.caseId, rowIndex: 0,
            data: {
              company_name: e.company_name ?? "",
              domain: e.domain ?? "",
              source_url: e.source_url ?? url,
              source_domain: e.domain ?? new URL(url).hostname,
              source_title: e.company_name ?? "",
              source_snippet: e.description ?? "",
              search_query: `catalog:${new URL(url).hostname}`,
              search_source: "catalog-deep-crawl",
              is_catalog: "",
              phone: e.phone ?? "",
              email: e.email ?? "",
              address: e.address ?? "",
              city: e.city ?? "",
              zip: e.zip ?? "",
            } as Record<string, string>,
            cellStatuses: {}, cellErrors: {}, createdAt: now(), updatedAt: now(),
          }));

        const { inserted } = await appendDiscoveryRows(run.caseId, rows);
        uniqueInserted = inserted;
      }

      if (result.errors.length > 0) {
        error = result.errors[0];
      }
    } else if (step.type === "catalog_scrape" || step.type === "directory_search") {
      // ── Catalog / directory scrape ──
      // Strategy: catalogs are LINK EXTRACTORS, not target domains.
      // We scrape the catalog search result page and extract links to the actual
      // company websites. The catalog URL itself is never imported as a lead.
      const url = step.url ?? "";
      if (!url) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "none", error: "No URL for catalog scrape" };
      }

      if (!env.edenApiKey) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "none", error: "No Eden API key for scraping" };
      }

      // Scrape the catalog page (get markdown/links)
      let markdown = "";
      let title: string | undefined;
      try {
        const scrapeResult = await edenScrapeUrl({ apiKey: env.edenApiKey, url });
        markdown = scrapeResult.markdown;
        title = scrapeResult.title;
        if (typeof scrapeResult.costUsd === "number") costUsd += scrapeResult.costUsd;
      } catch (scrapeErr) {
        // Firecrawl unavailable — fall back to web search on the catalog domain
        const fallbackQuery = step.label;
        run.log.push(`⚠️ Catalog scrape failed (${(scrapeErr as Error).message}), falling back to web search: ${fallbackQuery}`);
        const resp = await discoverySearch(fallbackQuery, {
          source: "auto",
          limit: 200,  // always request maximum
          excludeDomains: existingDomains,
          serpApiKey: env.serpApiKey,
          serperApiKey: env.serperApiKey,
          braveApiKey: env.braveApiKey,
          scraplingUrl: env.scraplingUrl,
          scraplingToken: env.scraplingToken,
          edenApiKey: env.edenApiKey,
        });
        hitsFound = resp.hits.length;
        source = `fallback-search (${resp.source})`;
        if (typeof resp.costUsd === "number") costUsd += resp.costUsd;
        if (resp.hits.length > 0) {
          const seeds = resp.hits.map(hitToSeedRow).map((data) => ({
            id: randomUUID(), caseId: run.caseId, rowIndex: 0,
            data: data as Record<string, string>,
            cellStatuses: {}, cellErrors: {}, createdAt: now(), updatedAt: now(),
          }));
          const { inserted } = await appendDiscoveryRows(run.caseId, seeds);
          uniqueInserted = inserted;
        }
        return { stepId: step.id, attemptedAt: t0, hitsFound, uniqueInserted, costUsd, source };
      }

      if (isOperationCancelled(cancelKey)) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd, source: "cancelled" };
      }

      if (markdown) {
        // Extract company entries from catalog markdown using LLM
        const extractionPrompt = step.extractionPrompt ??
          "Extrahiere alle Firmeneinträge aus dieser Katalogseite. Für jeden Eintrag: Firmenname, eigene Website-URL (NICHT die Katalog-Domain selbst, sondern die verlinkte externe Firmenwebsite), Telefon, Adresse. Wenn keine externe Website vorhanden, lasse website leer.";

        const { edenChatCompletion: chatFn } = await import("./edenai");
        const extractResp = await chatFn({
          apiKey: env.edenApiKey,
          region: "us",   // openai/gpt-4o-mini only available on US endpoint
          model: "openai/gpt-4o-mini",
          system: `Du extrahierst strukturierte Firmendaten aus Katalog-Seiten-Markdown.
Antworte NUR mit JSON-Array:
[{"name":"Firma GmbH","website":"https://firma.de","phone":"030 123456","address":"Musterstr. 1, 12345 Berlin"}]
Leeres Array [] wenn keine Einträge gefunden. website="" wenn keine externe Firmenwebsite vorhanden.`,
          prompt: `${extractionPrompt}\n\nKatalog-Seite (${title ?? url}):\n${markdown.slice(0, 8000)}`,
          maxTokens: 2000,
          temperature: 0.1,
        });

        if (typeof extractResp.costUsd === "number") costUsd += extractResp.costUsd;

        let firms: Array<{ name?: string; website?: string; phone?: string; address?: string }> = [];
        try {
          const raw = (extractResp.raw ?? "").trim()
            .replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
          firms = JSON.parse(raw);
        } catch {
          // fallback: import the catalog page itself as a single low-quality entry
          firms = [{ name: title ?? new URL(url).hostname, website: "" }];
        }

        hitsFound = firms.length;

        if (firms.length > 0) {
          const catalogDomain = new URL(url).hostname.replace(/^www\./, "");
          const rows = firms.map((f) => {
            const website = (f.website ?? "").trim();
            // Ignore links pointing back to the catalog domain
            let firmDomain = "";
            try {
              if (website) {
                const d = new URL(website).hostname.replace(/^www\./, "");
                if (!d.includes(catalogDomain)) firmDomain = d;
              }
            } catch { /* ignore malformed urls */ }

            return {
              id: randomUUID(),
              caseId: run.caseId,
              rowIndex: 0,
              data: {
                company_name: f.name ?? "",
                domain: firmDomain,
                source_url: firmDomain ? website : url,
                source_title: f.name ?? "",
                source_snippet: [f.phone, f.address].filter(Boolean).join(" · "),
                source_domain: firmDomain || catalogDomain,
                search_query: step.label,
                search_source: `catalog-scrape (${catalogDomain})`,
                phone: f.phone ?? "",
                address: f.address ?? "",
                // Flag low quality entries that have no own website
                ...(firmDomain ? {} : { data_quality: "catalog-only" }),
              } as Record<string, string>,
              cellStatuses: {},
              cellErrors: {},
              createdAt: now(),
              updatedAt: now(),
            };
          });

          const { inserted } = await appendDiscoveryRows(run.caseId, rows);
          uniqueInserted = inserted;
        }
      }
      source = "catalog-scrape";
    } else {
      // ── Search step (google_search / multi_search) ──
      // multi_search: iterate ALL expanded queries (not just queries[0])
      const queriesToRun: string[] =
        step.type === "multi_search" && step.queries?.length
          ? step.queries
          : step.query
          ? [step.query]
          : step.label
          ? [step.label]
          : [];

      if (queriesToRun.length === 0) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "none", error: "No query" };
      }

      for (const query of queriesToRun) {
        if (isOperationCancelled(cancelKey)) break;

        const resp = await discoverySearch(query, {
          source: (step.source as "auto" | "firecrawl" | "serpapi" | "brave" | "duckduckgo" | "scrapling") ?? "auto",
          limit: 200,  // always request maximum
          excludeDomains: await getExistingDomains(run.caseId), // re-fetch each time to exclude just-inserted
          serpApiKey: env.serpApiKey,
          serperApiKey: env.serperApiKey,
          braveApiKey: env.braveApiKey,
          scraplingUrl: env.scraplingUrl,
          scraplingToken: env.scraplingToken,
          edenApiKey: env.edenApiKey,
          firecrawlDepth: "basic",
        });

        hitsFound += resp.hits.length;
        source = resp.source;
        if (typeof resp.costUsd === "number") costUsd += resp.costUsd;

        if (resp.hits.length > 0) {
          const seeds = resp.hits.map(hitToSeedRow).map((data) => ({
            id: randomUUID(),
            caseId: run.caseId,
            rowIndex: 0,
            data: data as Record<string, string>,
            cellStatuses: {},
            cellErrors: {},
            createdAt: now(),
            updatedAt: now(),
          }));
          const { inserted } = await appendDiscoveryRows(run.caseId, seeds);
          uniqueInserted += inserted;
        }

        // Polite rate-limit between queries within a step
        if (queriesToRun.length > 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }

  return {
    stepId: step.id,
    attemptedAt: t0,
    hitsFound,
    uniqueInserted,
    costUsd,
    source,
    error,
  };
}

// ── Replan: all steps done but target not reached ────────────────────────────

async function handleReplan(
  run: AgentRunState,
  env: StepEnv,
  cancelKey: string
): Promise<AgentRunState> {
  const remaining = run.goal.targetCount - run.uniqueCount;
  if (remaining <= 0) {
    run.status = "completed";
    stamp(run);
    await updateAgentRunState(run);
    return run;
  }

  run.status = "expanding";
  run.iteration++;
  run.log.push(`🔄 Iteration ${run.iteration}: ${run.uniqueCount}/${run.goal.targetCount} erreicht, plane nächste Runde…`);

  // Build step yields
  const stepYields: Record<string, number> = {};
  for (const r of run.stepResults) {
    if (r.stepId && !r.error) stepYields[r.stepId] = r.uniqueInserted;
  }

  try {
    const newPlan = await refinePlan({
      goal: run.goal,
      previousSteps: run.plan.steps,
      stepYields,
      currentUniqueCount: run.uniqueCount,
      edenApiKey: env.edenApiKey,
      model: "openai/gpt-4o-mini",
      serpApiKeyAvailable: !!env.serpApiKey,
      braveApiKeyAvailable: !!env.braveApiKey,
      edenKeyAvailable: true,
    });

    if (isOperationCancelled(cancelKey)) {
      run.status = "cancelled";
      stamp(run);
      await updateAgentRunState(run);
      return run;
    }

    if (newPlan && newPlan.steps.length > 0) {
      run.plan.steps.push(...newPlan.steps);
      run.plan.estimatedRows += newPlan.estimatedRows;
      run.plan.warnings.push(...newPlan.warnings);
      run.log.push(`✓ Replan: ${newPlan.steps.length} neue Steps, +${newPlan.estimatedRows} geschätzte Treffer`);
      run.status = "running";
    } else {
      run.log.push("⚠️ Replan ergab keine neuen Steps — Suche abgeschlossen");
      run.status = "completed";
    }
  } catch (e) {
    run.log.push(`⚠️ Replan fehlgeschlagen: ${(e as Error).message}. Suche abgeschlossen.`);
    run.status = "completed";
  }

  stamp(run);
  await updateAgentRunState(run);
  await appendLog(run.caseId, `🎯 Iteration ${run.iteration}: ${run.uniqueCount}/${run.goal.targetCount} Unternehmen`);
  return run;
}

// ── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelAgentRun(runId: string): Promise<AgentRunState | null> {
  const run = await getAgentRun(runId);
  if (!run) return null;
  run.status = "cancelled";
  stamp(run);
  run.log.push("Abgebrochen durch Benutzer");
  await updateAgentRunState(run);
  await appendLog(run.caseId, `🎯 Ziel-Suche abgebrochen: ${run.uniqueCount}/${run.goal.targetCount} Unternehmen`);
  return run;
}