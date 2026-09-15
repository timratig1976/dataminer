import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import {
  getCase,
  resolveEdenKey,
  getExistingDomains,
  appendDiscoveryRows,
  appendLog,
} from "@/lib/db";
import { discoverySearch, hitToSeedRow, normalizeDomain } from "@/lib/discovery";
import { expandQueryForRegion, detectRegion } from "@/lib/regions";
import { scrapeCatalog } from "@/lib/catalog-scraper";
import type { DiscoveryPlan, PlanStep } from "@/lib/planner";
import type { RowData } from "@/lib/types";

export const runtime = "nodejs";

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ── Append stream route ───────────────────────────────────────────────────────

/**
 * POST /api/cases/[id]/append/stream
 *
 * Body: { plan: DiscoveryPlan, dedupeField?: "domain"|"none", dryRun?: boolean }
 *
 * Returns: text/event-stream with events:
 *   { type: "step_start", stepId, label, stepIndex, stepsTotal }
 *   { type: "step_progress", stepId, found, added, skipped }
 *   { type: "step_done", stepId, added, skipped, total, error? }
 *   { type: "pipeline_done", totalAdded, totalSkipped }
 *   { type: "error", message }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const caseData = await getCase(caseId);
  if (!caseData) {
    return new Response(`data: ${JSON.stringify({ type: "error", message: "Case not found" })}\n\n`, {
      status: 404,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const body = await req.json();
  const plan: DiscoveryPlan = body.plan;
  const dedupeField: string = body.dedupeField ?? "domain";
  const dryRun: boolean = body.dryRun ?? false;

  if (!plan?.steps?.length) {
    return new Response(`data: ${JSON.stringify({ type: "error", message: "No plan steps provided" })}\n\n`, {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const edenApiKey = await resolveEdenKey(caseData);
  const serpApiKey = process.env.SERP_API_KEY;
  const braveApiKey = process.env.BRAVE_API_KEY;
  const scraplingUrl = process.env.SCRAPLING_URL ?? "http://127.0.0.1:8001";

  const existingDomains = dedupeField !== "none" ? await getExistingDomains(caseId) : [];
  const existingSet = new Set(existingDomains.map((d) => d.toLowerCase()));

  const sortedSteps = [...plan.steps].sort((a, b) => a.priority - b.priority);
  let totalAdded = 0;
  let totalSkipped = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const push = (data: unknown) => {
        try { controller.enqueue(new TextEncoder().encode(sseEvent(data))); } catch { /* closed */ }
      };

      // Log plan start
      await appendLog(caseId, `🔍 DISCOVERY PLAN: "${plan.goal}" (${sortedSteps.length} Schritte, ${plan.estimatedRows} erwartet)`);

      for (let i = 0; i < sortedSteps.length; i++) {
        const step = sortedSteps[i];

        push({ type: "step_start", stepId: step.id, label: step.label, stepIndex: i + 1, stepsTotal: sortedSteps.length });

        let stepAdded = 0;
        let stepSkipped = 0;
        let stepError: string | undefined;
        const stepRows: RowData[] = [];

        try {
          if (step.type === "catalog_scrape" && step.url) {
            if (!edenApiKey) throw new Error("No Eden API key");

            const result = await scrapeCatalog({
              url: step.url,
              extractionPrompt: step.extractionPrompt ?? "",
              maxPages: step.maxPages ?? 5,
              edenApiKey,
              onProgress: (page, found) => {
                push({ type: "step_progress", stepId: step.id, page, found });
              },
            });

            for (const entry of result.entries) {
              if (dedupeField === "domain" && entry.domain) {
                const d = entry.domain.toLowerCase();
                if (existingSet.has(d)) { stepSkipped++; continue; }
                existingSet.add(d);
              }
              stepRows.push(entryToRowData(entry, caseId));
              stepAdded++;
            }

            if (result.errors.length) stepError = result.errors.join("; ");

          } else if (step.type === "google_maps" && step.mapQuery) {
            // Maps handled via existing discoverySearch with maps source
            const query = step.location ? `${step.mapQuery} ${step.location}` : step.mapQuery;
            const resp = await discoverySearch(query, {
              source: "maps-serpapi",
              limit: 50,
              excludeDomains: [...existingSet],
              serpApiKey,
              edenApiKey: edenApiKey ?? undefined,
            });
            for (const hit of resp.hits) {
              if (hit.isDuplicate) { stepSkipped++; continue; }
              const row = hitToSeedRow(hit);
              stepRows.push({ id: randomUUID(), caseId, rowIndex: 0, data: row, cellStatuses: {}, cellErrors: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
              if (hit.domain) existingSet.add(hit.domain.toLowerCase());
              stepAdded++;
            }
            if (resp.error) stepError = resp.error;

          } else if (step.type === "directory_search") {
            // Maps-replacement: Firecrawl restricted to German business directories
            // These return structured data: name, address, phone — like Maps but via web search
            const GERMAN_DIRECTORIES = [
              "gelbeseiten.de", "dasoertliche.de", "11880.com",
              "klicktel.de", "stadtbranchenbuch.com", "meinestadt.de",
              "cylex.de", "wlw.de", "firmenabc.com",
            ];
            const query = step.query ?? (step.queryTemplate ?? "").replace(/\{city\}/g, step.location ?? "");
            push({ type: "step_progress", stepId: step.id, query, found: stepAdded });
            await appendLog(caseId, `  🔍 [${step.label}] Directory-Suche: "${query}"`);

            const resp = await discoverySearch(query, {
              source: "firecrawl",
              limit: 200,  // always request maximum
              excludeDomains: [...existingSet],
              edenApiKey: edenApiKey ?? undefined,
            });
            for (const hit of resp.hits) {
              if (hit.isDuplicate) { stepSkipped++; continue; }
              const row = hitToSeedRow(hit);
              stepRows.push({ id: randomUUID(), caseId, rowIndex: 0, data: row, cellStatuses: {}, cellErrors: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
              if (hit.domain) existingSet.add(hit.domain.toLowerCase());
              stepAdded++;
            }
            if (resp.error && !stepError) stepError = resp.error;

          } else {
            // google_search or multi_search
            const queries: string[] = step.type === "multi_search" && step.queries?.length
              ? step.queries
              : step.query ? [step.query] : [];

            if (step.type === "multi_search" && step.queryTemplate && !step.queries?.length) {
              const rk = step.region ?? detectRegion(step.queryTemplate) ?? "";
              const expanded = expandQueryForRegion(step.queryTemplate, rk);
              queries.push(...expanded);
            }

            for (const query of queries) {
              // Signal which query is running right now
              push({ type: "step_progress", stepId: step.id, query, found: stepAdded });
              // Log each query result
              await appendLog(caseId, `  🔍 [${step.label}] Query: "${query}" → ${stepAdded} neu gefunden`);

              const resp = await discoverySearch(query, {
                source: (step.source as never) ?? "auto",
                limit: 200,  // always request maximum
                excludeDomains: [...existingSet],
                serpApiKey,
                braveApiKey,
                edenApiKey: edenApiKey ?? undefined,
                scraplingUrl,
              });

              for (const hit of resp.hits) {
                if (hit.isDuplicate) { stepSkipped++; continue; }
                const row = hitToSeedRow(hit);
                stepRows.push({ id: randomUUID(), caseId, rowIndex: 0, data: row, cellStatuses: {}, cellErrors: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
                if (hit.domain) existingSet.add(hit.domain.toLowerCase());
                stepAdded++;
              }
              if (resp.error && !stepError) stepError = resp.error;
            }
          }

          // Write to DB
          if (!dryRun && stepRows.length > 0) {
            await appendDiscoveryRows(caseId, stepRows);
          }

          totalAdded += stepAdded;
          totalSkipped += stepSkipped;

        } catch (e) {
          stepError = (e as Error).message;
        }

        push({ type: "step_done", stepId: step.id, added: stepAdded, skipped: stepSkipped, total: stepAdded + stepSkipped, error: stepError });
        await appendLog(caseId, `✅ Step ${i+1}/${sortedSteps.length}: "${step.label}" → ${stepAdded} neue Einträge${stepSkipped > 0 ? `, ${stepSkipped} Duplikate` : ""}${stepError ? ` ⚠ ${stepError}` : ""}`);
      }

      push({ type: "pipeline_done", totalAdded, totalSkipped });
      await appendLog(caseId, `🏁 DISCOVERY ABGESCHLOSSEN: ${totalAdded} neue Einträge, ${totalSkipped} Duplikate`);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function entryToRowData(entry: Record<string, string | null>, caseId: string): RowData {
  return {
    id: randomUUID(),
    caseId,
    rowIndex: 0,
    data: Object.fromEntries(Object.entries(entry).filter(([, v]) => v != null)) as Record<string, string>,
    cellStatuses: {},
    cellErrors: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
