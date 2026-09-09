/**
 * lib/apollo.ts
 * Apollo.io contact lookup behind a transport-abstracted adapter.
 *
 * Transports (selected via APOLLO_TRANSPORT env, default "mcp"):
 *   - mcp:  spawns the community MCP server (@thevgergroup/apollo-io-mcp)
 *           as a stdio child process and calls its `apollo_search_people` tool.
 *   - rest: direct POST https://api.apollo.io/api/v1/mixed_people/search
 *           (same credentials, zero extra processes — fallback when MCP fails).
 *
 * Credit safety:
 *   - Only SEARCH endpoints are used (0 credits). Enrich/reveal is never called.
 *   - Results cached 30 days in SQLite (apollo_cache) — re-runs are free.
 *   - In-memory rate limiter (default 2 req/s) + per-run budget guard.
 */

import { getApolloCache, setApolloCache } from "./db";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApolloContact {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  organisation?: string;
  linkedinUrl?: string;
  emailStatus?: string;      // "verified" | "guessed" | "unavailable" | ""
  city?: string;
  country?: string;
  seniority?: string;
  matchedDomain?: string;
}

export interface ApolloPeopleQuery {
  companyName?: string;
  domain?: string;
  /** Title keywords, e.g. ["Geschäftsführer", "Managing Director"] */
  titles?: string[];
  limit?: number;
}

export interface ApolloAdapter {
  readonly transport: "mcp" | "rest";
  searchPeople(q: ApolloPeopleQuery): Promise<ApolloContact[]>;
  smoke(): Promise<{ ok: boolean; transport: string; tools?: string[]; error?: string }>;
  shutdown(): Promise<void>;
}

export class ApolloBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApolloBudgetError";
  }
}

// ── Config helpers ───────────────────────────────────────────────────────────

function apolloApiKey(): string {
  return process.env.APOLLO_API_KEY?.trim() ?? "";
}

function preferredTransport(): "mcp" | "rest" {
  const t = process.env.APOLLO_TRANSPORT?.trim().toLowerCase();
  return t === "rest" ? "rest" : "mcp";
}

function maxLookupsPerRun(): number {
  const n = Number(process.env.APOLLO_MAX_LOOKUPS_RUN ?? 500);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

// ── Rate limiter (shared, in-memory) ─────────────────────────────────────────

class RateLimiter {
  private queue: Promise<void> = Promise.resolve();
  constructor(private minIntervalMs: number) {}
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => fn());
    this.queue = run
      .catch(() => {})
      .then(() => new Promise((r) => setTimeout(r, this.minIntervalMs)));
    return run;
  }
}

const limiter = new RateLimiter(Number(process.env.APOLLO_MIN_INTERVAL_MS ?? 500));

// ── Budget guard (per column run) ────────────────────────────────────────────

export class ApolloBudget {
  private count = 0;
  private cacheHits = 0;
  constructor(private max = maxLookupsPerRun()) {}
  /** Throws ApolloBudgetError when the budget is exhausted. */
  consume(): void {
    if (this.count >= this.max) {
      throw new ApolloBudgetError(
        `Apollo lookup budget exhausted (${this.count}/${this.max}) — set APOLLO_MAX_LOOKUPS_RUN to raise it`
      );
    }
    this.count++;
  }
  recordCacheHit(): void {
    this.cacheHits++;
  }
  stats(): { lookups: number; cacheHits: number; budget: number } {
    return { lookups: this.count, cacheHits: this.cacheHits, budget: this.max };
  }
}

// ── REST adapter ─────────────────────────────────────────────────────────────

function mapRestPeople(raw: any[]): ApolloContact[] {
  return (raw ?? [])
    .map((p) => ({
      id: String(p.id ?? ""),
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || String(p.name ?? ""),
      firstName: p.first_name ?? undefined,
      lastName: p.last_name ?? undefined,
      title: p.title ?? undefined,
      organisation: p.organization?.name ?? undefined,
      linkedinUrl: p.linkedin_url ?? undefined,
      emailStatus: p.email_status ?? undefined,
      city: p.city ?? undefined,
      country: p.country ?? undefined,
      seniority: p.seniority ?? undefined,
      matchedDomain: p.organization?.primary_domain ?? undefined,
    }))
    .filter((c) => c.name && c.id);
}

export class RestApolloAdapter implements ApolloAdapter {
  readonly transport = "rest" as const;

  async searchPeople(q: ApolloPeopleQuery): Promise<ApolloContact[]> {
    const key = apolloApiKey();
    if (!key) throw new Error("missing APOLLO_API_KEY");

    const body: Record<string, unknown> = {
      page: 1,
      per_page: Math.max(1, Math.min(q.limit ?? 10, 25)),
      q_keywords: q.companyName || undefined,
    };
    if (q.domain) body.q_organization_primary_domains = [q.domain];
    if (q.titles && q.titles.length > 0) body.person_titles = q.titles;

    const res = await limiter.schedule(() =>
      fetch("https://api.apollo.io/api/v1/mixed_people/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": key,
          Cache: "no-cache",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
    );

    if (!res.ok) {
      try { await res.body?.cancel(); } catch {}
      throw new Error(`Apollo people search HTTP ${res.status}`);
    }
    const json = (await res.json()) as { people?: any[] };
    return mapRestPeople(json.people ?? []);
  }

  async smoke() {
    try {
      const res = await limiter.schedule(() =>
        fetch("https://api.apollo.io/api/v1/auth/health", {
          method: "POST",
          headers: { "X-Api-Key": apolloApiKey(), Cache: "no-cache" },
          signal: AbortSignal.timeout(15_000),
        })
      );
      const json: any = res.ok ? await res.json() : {};
      return {
        ok: res.ok,
        transport: "rest",
        ...(res.ok
          ? { tools: [`credits available: ${json?.credit_info?.credits ?? "?"}`] }
          : { error: `HTTP ${res.status}` }),
      };
    } catch (e) {
      return { ok: false, transport: "rest", error: (e as Error).message };
    }
  }

  async shutdown() {}
}

// ── MCP adapter (stdio child process) ────────────────────────────────────────

type McpClientModule = typeof import("@modelcontextprotocol/sdk/client/index.js");

export class McpApolloAdapter implements ApolloAdapter {
  readonly transport = "mcp" as const;
  private clientPromise: Promise<{ client: any; tools: string[] }> | null = null;
  private lastTools: string[] = [];

  private async getClient(): Promise<{ client: any; tools: string[] }> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((e) => {
        this.clientPromise = null; // allow retry on next call
        throw e;
      });
    }
    return this.clientPromise;
  }

  private async connect(): Promise<{ client: any; tools: string[] }> {
    const key = apolloApiKey();
    if (!key) throw new Error("missing APOLLO_API_KEY");

    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js") as Promise<McpClientModule>,
      import("@modelcontextprotocol/sdk/client/stdio.js"),
    ]);

    const cmd = process.env.APOLLO_MCP_COMMAND ?? "npx";
    const args = (process.env.APOLLO_MCP_ARGS ?? "-y @thevgergroup/apollo-io-mcp@latest").split(/\s+/).filter(Boolean);

    const transport = new StdioClientTransport({
      command: cmd,
      args,
      env: { ...process.env, APOLLO_API_KEY: key } as Record<string, string>,
      stderr: "pipe",
    });

    const client = new Client({ name: "dataminer", version: "0.1.0" });
    await client.connect(transport);

    const list = await client.listTools();
    const tools = (list.tools ?? []).map((t: { name: string }) => t.name);
    this.lastTools = tools;
    return { client, tools };
  }

  private pickTool(tools: string[]): string {
    const candidates = [
      "apollo_search_people",
      "search_people",
      "people_search",
      "apollo-io-mcp_people_search",
    ];
    for (const c of candidates) if (tools.includes(c)) return c;
    const fuzzy = tools.find((t) => /people.*search|search.*people/i.test(t));
    if (fuzzy) return fuzzy;
    throw new Error(`Apollo MCP: no people-search tool found (available: ${tools.join(", ") || "none"})`);
  }

  async searchPeople(q: ApolloPeopleQuery): Promise<ApolloContact[]> {
    const { client, tools } = await this.getClient();
    const tool = this.pickTool(tools);

    const args: Record<string, unknown> = {
      per_page: Math.max(1, Math.min(q.limit ?? 10, 25)),
    };
    if (q.companyName) {
      args.q_organization_names = [q.companyName];
      args.q_keywords = q.companyName;
    }
    if (q.domain) args.q_organization_primary_domains = [q.domain];
    if (q.titles && q.titles.length > 0) args.person_titles = q.titles.join(",");

    const result = await limiter.schedule(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("Apollo MCP tool call timeout (30s)")), 30_000);
      try {
        return await client.callTool({ name: tool, arguments: args }, undefined, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    });

    // MCP tool results come back as content blocks; the Apollo server returns JSON text
    const text = (result?.content ?? [])
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text ?? "")
      .join("\n");

    return parseMcpPeopleJson(text);
  }

  async smoke() {
    try {
      const { tools } = await this.getClient();
      return { ok: true, transport: "mcp", tools };
    } catch (e) {
      return { ok: false, transport: "mcp", error: (e as Error).message, tools: this.lastTools };
    }
  }

  async shutdown() {
    if (!this.clientPromise) return;
    try {
      const { client } = await this.clientPromise;
      await client.close();
    } catch { /* already dead */ }
    this.clientPromise = null;
    this.lastTools = [];
  }
}

function parseMcpPeopleJson(text: string): ApolloContact[] {
  if (!text.trim()) return [];
  // The server may wrap the payload; try direct parse first, then regex-extract JSON
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}\s*$/);
    if (!match) return [];
    try {
      json = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  const people = json?.people ?? json?.results ?? json?.data ?? (Array.isArray(json) ? json : []);
  return mapRestPeople(Array.isArray(people) ? people : []);
}

// ── Adapter manager (lazy singleton with MCP→REST fallback) ─────────────────

let cachedAdapter: ApolloAdapter | null = null;

export async function getApolloAdapter(): Promise<ApolloAdapter> {
  if (cachedAdapter) return cachedAdapter;

  if (preferredTransport() === "rest") {
    cachedAdapter = new RestApolloAdapter();
    return cachedAdapter;
  }

  // MCP first — fall back to REST permanently if the child process cannot start
  const mcp = new McpApolloAdapter();
  const smoke = await mcp.smoke();
  if (smoke.ok) {
    cachedAdapter = mcp;
    return cachedAdapter;
  }
  console.warn(`[apollo] MCP transport failed (${smoke.error}), falling back to REST`);
  await mcp.shutdown();
  cachedAdapter = new RestApolloAdapter();
  return cachedAdapter;
}

export async function shutdownApolloAdapter(): Promise<void> {
  if (cachedAdapter) {
    await cachedAdapter.shutdown();
    cachedAdapter = null;
  }
}

// ── High-level: cached people search for the column tool ─────────────────────

export interface ApolloLookupResult {
  contacts: ApolloContact[];
  fromCache: boolean;
  transport: string;
  queryKey: string;
}

export function apolloCacheKey(q: ApolloPeopleQuery): string {
  return [q.companyName ?? "", q.domain ?? "", (q.titles ?? []).join(","), q.limit ?? 10]
    .join("|")
    .toLowerCase();
}

/**
 * Search contacts for a company with 30-day caching and budget accounting.
 * Budget is consumed only on real API calls (cache hits are free).
 */
export async function lookupApolloContacts(
  q: ApolloPeopleQuery,
  budget?: ApolloBudget
): Promise<ApolloLookupResult> {
  const key = apolloCacheKey(q);
  const cached = getApolloCache(key);
  if (Array.isArray(cached)) {
    budget?.recordCacheHit();
    return { contacts: cached as ApolloContact[], fromCache: true, transport: "cache", queryKey: key };
  }

  budget?.consume(); // throws ApolloBudgetError when exhausted
  const adapter = await getApolloAdapter();
  const contacts = await adapter.searchPeople(q);

  // Cache even empty results — repeated misses for the same company shouldn't re-hit the API
  setApolloCache(key, contacts);
  return { contacts, fromCache: false, transport: adapter.transport, queryKey: key };
}
