/**
 * lib/apollo.test.ts
 *
 * Unit tests for lib/apollo.ts — REST adapter mapping, cache behaviour,
 * budget guard. DB module is mocked; no real network or SQLite access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock lib/db (apollo_cache) ───────────────────────────────────────────────

const cache = new Map<string, unknown>();
vi.mock("./db", () => ({
  getApolloCache: (key: string) => cache.get(key) ?? null,
  setApolloCache: (key: string, payload: unknown) => cache.set(key, payload),
}));

import {
  RestApolloAdapter,
  ApolloBudget,
  ApolloBudgetError,
  lookupApolloContacts,
} from "./apollo";

const PEOPLE_RESPONSE = {
  people: [
    {
      id: "p1",
      first_name: "Max",
      last_name: "Meier",
      title: "Geschäftsführer",
      linkedin_url: "https://linkedin.com/in/maxmeier",
      email_status: "verified",
      city: "Berlin",
      country: "DE",
      organization: { name: "Acme GmbH", primary_domain: "acme.de" },
    },
    { id: "", first_name: "Ghost", last_name: "" }, // filtered — no id
  ],
  pagination: { total_entries: 1 },
};

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status,
      json: async () => body,
      body: { cancel: async () => {} },
    }) as unknown as Response)
  );
}

describe("RestApolloAdapter.searchPeople", () => {
  beforeEach(() => {
    cache.clear();
    process.env.APOLLO_API_KEY = "test-key";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("maps and filters people from the mixed search endpoint", async () => {
    mockFetch(PEOPLE_RESPONSE);
    const adapter = new RestApolloAdapter();
    const contacts = await adapter.searchPeople({ domain: "acme.de", limit: 5 });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Max Meier");
    expect(contacts[0].title).toBe("Geschäftsführer");
    expect(contacts[0].emailStatus).toBe("verified");
    expect(contacts[0].matchedDomain).toBe("acme.de");
  });

  it("throws when API key is missing", async () => {
    delete process.env.APOLLO_API_KEY;
    const adapter = new RestApolloAdapter();
    await expect(adapter.searchPeople({ companyName: "Acme" })).rejects.toThrow(/APOLLO_API_KEY/);
  });

  it("throws on non-OK response", async () => {
    mockFetch({ error: "denied" }, false, 403);
    const adapter = new RestApolloAdapter();
    await expect(adapter.searchPeople({ companyName: "Acme" })).rejects.toThrow(/HTTP 403/);
  });
});

describe("ApolloBudget", () => {
  it("throws once the budget is exhausted", () => {
    const budget = new ApolloBudget(2);
    budget.consume();
    budget.consume();
    expect(() => budget.consume()).toThrow(ApolloBudgetError);
  });

  it("tracks stats", () => {
    const budget = new ApolloBudget(10);
    budget.consume();
    budget.recordCacheHit();
    expect(budget.stats()).toEqual({ lookups: 1, cacheHits: 1, budget: 10 });
  });
});

describe("lookupApolloContacts", () => {
  beforeEach(() => {
    cache.clear();
    process.env.APOLLO_API_KEY = "test-key";
    process.env.APOLLO_TRANSPORT = "rest";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("caches results and serves cache hits without API call", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => PEOPLE_RESPONSE,
      body: { cancel: async () => {} },
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const budget = new ApolloBudget(10);
    const first = await lookupApolloContacts({ domain: "acme.de" }, budget);
    expect(first.fromCache).toBe(false);
    expect(first.contacts).toHaveLength(1);

    const second = await lookupApolloContacts({ domain: "acme.de" }, budget);
    expect(second.fromCache).toBe(true);
    expect(second.transport).toBe("cache");
    // only one real API call for two lookups
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(budget.stats().cacheHits).toBe(1);
    expect(budget.stats().lookups).toBe(1);
  });

  it("caches empty results too (no repeated misses)", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ people: [] }),
      body: { cancel: async () => {} },
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);

    await lookupApolloContacts({ domain: "nothing.de" });
    const second = await lookupApolloContacts({ domain: "nothing.de" });
    expect(second.fromCache).toBe(true);
    expect(second.contacts).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("respects the budget across repeated lookups", async () => {
    mockFetch(PEOPLE_RESPONSE);
    const budget = new ApolloBudget(1);
    await lookupApolloContacts({ domain: "a.de" }, budget); // consumes budget
    // different query → cache miss → budget exhausted
    await expect(lookupApolloContacts({ domain: "b.de" }, budget)).rejects.toThrow(ApolloBudgetError);
  });
});
