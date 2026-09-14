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
import { discoverySearch, hitToSeedRow } from "./discovery";
import { mapsSearch, placeToSeedExtras } from "./maps";
import { edenScrapeUrl } from "./edenai";
import { isOperationCancelled } from "./operations";

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

  // Diminishing returns check — last 2 iterations averaged < 5% yield over remaining delta
  if (run.stepResults.length >= 4) {
    const recent = run.stepResults.slice(-4);
    const recentInserted = recent.reduce((s, r) => s + r.uniqueInserted, 0);
    const remaining = run.goal.targetCount - run.uniqueCount;
    if (remaining > 0 && recentInserted / remaining < 0.05) {
      // Very slow progress — stop with warning
      run.log.push(`⚠️ Diminishing returns: only ${recentInserted} new leads in last iteration(s) for ${remaining} remaining. Stopping.`);
      return "completed"; // partial success
    }
  }

  return null;
}

// ── Start ────────────────────────────────────────────────────────────────────

export interface StartOptions {
  edenApiKey: string;
  model?: string;
  serpApiKey?: string;
  braveApiKey?: string;
}

export async function startAgentRun(
  caseId: string,
  goal: AgentGoal,
  opts: StartOptions
): Promise<AgentRunState> {
  const { edenApiKey, model, serpApiKey, braveApiKey } = opts;

  // Generate initial plan
  const plan = await createDiscoveryPlan(goal.description, {
    edenApiKey,
    model: model ?? "openai/gpt-4o-mini",
    serpApiKeyAvailable: !!serpApiKey,
    braveApiKeyAvailable: !!braveApiKey,
    edenKeyAvailable: true,
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
      const query = step.mapQuery || step.label;
      const serpApiKey = env.serpApiKey ?? process.env.SERP_API_KEY?.trim();
      const scraplingUrl = env.scraplingUrl ?? process.env.SCRAPLING_URL?.trim();
      const scraplingToken = env.scraplingToken ?? process.env.SCRAPLING_TOKEN?.trim();

      if (!serpApiKey && !scraplingUrl) {
        return {
          stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0,
          costUsd: 0, source: "none",
          error: "No Maps provider available (missing SERP_API_KEY & SCRAPLING_URL)",
        };
      }

      const resp = await mapsSearch({
        query,
        provider: serpApiKey ? "maps-serpapi" : "maps-scrapling",
        limit: 30,
        ll: step.location,
        serpApiKey: serpApiKey ?? undefined,
        scraplingUrl: scraplingUrl ?? undefined,
        scraplingToken: scraplingToken ?? undefined,
        excludeDomains: existingDomains,
      });

      if (isOperationCancelled(cancelKey)) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "cancelled" };
      }

      hitsFound = resp.places.length;
      source = resp.provider;

      if (resp.places.length > 0) {
        const seeds = resp.places.map((p) => {
          const url = p.website || p.mapsUrl;
          return {
            data: {
              company_name: p.name,
              domain: "", // filled by appendDiscoveryRows
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
    } else if (step.type === "catalog_scrape" || step.type === "directory_search") {
      // ── Catalog / directory scrape ──
      const url = step.url ?? "";
      if (!url) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "none", error: "No URL for catalog scrape" };
      }

      if (!env.edenApiKey) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd: 0, source: "none", error: "No Eden API key for scraping" };
      }

      // edenScrapeUrl costs ~$0.002 per page (Firecrawl)
      const { markdown, title } = await edenScrapeUrl({ apiKey: env.edenApiKey, url });
      costUsd += 0.002;

      if (isOperationCancelled(cancelKey)) {
        return { stepId: step.id, attemptedAt: t0, hitsFound: 0, uniqueInserted: 0, costUsd, source: "cancelled" };
      }

      if (markdown) {
        hitsFound = 1;
        const { inserted } = await appendDiscoveryRows(
          run.caseId,
          [{
            id: randomUUID(),
            caseId: run.caseId,
            rowIndex: 0,
            data: {
              company_name: title ?? new URL(url).hostname,
              domain: "",
              source_url: url,
              source_title: title ?? "",
              source_snippet: (markdown ?? "").slice(0, 500),
              source_domain: new URL(url).hostname,
              search_query: step.label,
              search_source: "catalog-scrape",
              is_catalog: "true",
            },
            cellStatuses: {},
            cellErrors: {},
            createdAt: now(),
            updatedAt: now(),
          }]
        );
        uniqueInserted = inserted;
      }
      source = "firecrawl";
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
          limit: 30,
          excludeDomains: await getExistingDomains(run.caseId), // re-fetch each time to exclude just-inserted
          serpApiKey: env.serpApiKey,
          braveApiKey: env.braveApiKey,
          scraplingUrl: env.scraplingUrl,
          scraplingToken: env.scraplingToken,
          edenApiKey: env.edenApiKey,
          firecrawlDepth: "deep",
        });

        hitsFound += resp.hits.length;
        source = resp.source;
        if (resp.source === "firecrawl") costUsd += 0.004;

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