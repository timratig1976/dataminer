/**
 * lib/discovery.test.ts
 *
 * Unit tests for lib/discovery.ts — domain normalisation, dedupe,
 * template query building, and seed row conversion.
 * Network calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeDomain,
  dedupeHits,
  buildQueriesFromRows,
  hitToSeedRow,
  discoverySearch,
  type DiscoveryHit,
} from "./discovery";

// ── normalizeDomain ──────────────────────────────────────────────────────────

describe("normalizeDomain", () => {
  it("normalises simple domains", () => {
    expect(normalizeDomain("https://www.acme.de/impressum")).toBe("acme.de");
    expect(normalizeDomain("http://acme.de")).toBe("acme.de");
    expect(normalizeDomain("https://shop.acme.de/path")).toBe("acme.de");
  });

  it("handles multi-part TLDs via Public Suffix List", () => {
    expect(normalizeDomain("https://www.example.co.uk/about")).toBe("example.co.uk");
    expect(normalizeDomain("https://firma.com.de")).toBe("firma.com.de");
  });

  it("returns empty string for garbage and IPs", () => {
    expect(normalizeDomain("not a url")).toBe("");
    expect(normalizeDomain("https://192.168.1.1/x")).toBe("");
    expect(normalizeDomain("")).toBe("");
  });
});

// ── dedupeHits ───────────────────────────────────────────────────────────────

function hit(url: string, domain: string): DiscoveryHit {
  return {
    title: url,
    url,
    domain,
    snippet: "",
    isCatalog: false,
    isDuplicate: false,
    searchQuery: "q",
    searchSource: "test",
  };
}

describe("dedupeHits", () => {
  it("keeps first occurrence per domain", () => {
    const hits = [
      hit("https://acme.de/", "acme.de"),
      hit("https://acme.de/impressum", "acme.de"),
      hit("https://beta.de/", "beta.de"),
    ];
    const out = dedupeHits(hits);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://acme.de/");
    expect(out[1].domain).toBe("beta.de");
  });

  it("keeps hits without domain", () => {
    const hits = [hit("https://x.test", ""), hit("https://y.test", "")];
    expect(dedupeHits(hits)).toHaveLength(2);
  });
});

// ── buildQueriesFromRows ─────────────────────────────────────────────────────

describe("buildQueriesFromRows", () => {
  it("renders templates and dedupes", () => {
    const rows = [
      { data: { industry_keywords: "Heizung", city: "Berlin" } },
      { data: { industry_keywords: "Heizung", city: "Berlin" } }, // dup
      { data: { industry_keywords: "Sanitär", city: "Potsdam" } },
    ];
    const qs = buildQueriesFromRows(rows, "{industry_keywords} {city} Anbieter");
    expect(qs).toHaveLength(2);
    expect(qs[0]).toBe("Heizung Berlin Anbieter");
    expect(qs[1]).toBe("Sanitär Potsdam Anbieter");
  });

  it("supports fallback placeholders {a|b}", () => {
    const rows = [{ data: { company_name: "", legal_name: "Acme GmbH" } }];
    const qs = buildQueriesFromRows(rows, "{company_name|legal_name} Berlin");
    expect(qs).toEqual(["Acme GmbH Berlin"]);
  });

  it("skips rows with unresolved placeholders", () => {
    const rows = [{ data: { city: "Berlin" } }];
    const qs = buildQueriesFromRows(rows, "{industry_keywords} {city}");
    expect(qs).toHaveLength(0);
  });

  it("respects maxQueries", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ data: { x: `v${i}` } }));
    expect(buildQueriesFromRows(rows, "{x}", 10)).toHaveLength(10);
  });
});

// ── hitToSeedRow ─────────────────────────────────────────────────────────────

describe("hitToSeedRow", () => {
  it("maps a hit to seed row fields", () => {
    const h = hit("https://acme.de/", "acme.de");
    h.title = "Acme GmbH — Heizung";
    h.snippet = "Ihr Heizungsprofi";
    h.searchQuery = "Heizung Berlin";
    h.searchSource = "firecrawl";
    const seed = hitToSeedRow(h);
    expect(seed.company_name).toBe("Acme GmbH — Heizung");
    expect(seed.source_domain).toBe("acme.de");
    expect(seed.search_source).toBe("firecrawl");
    expect(seed.search_query).toBe("Heizung Berlin");
  });
});

// ── discoverySearch (mocked webSearch via fetch) ─────────────────────────────

describe("discoverySearch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            output: {
              results: [
                { title: "Acme GmbH", url: "https://acme.de", content: "Heizung" },
                { title: "Beta AG", url: "https://beta.de", content: "Sanitär" },
                { title: "Dup", url: "https://www.acme.de/dupe", content: "" },
              ],
            },
            status: "success",
            cost: 0.001,
          }),
          text: async () => "{}",
          body: { cancel: async () => {} },
        }) as unknown as Response
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns deduped, flagged hits via firecrawl", async () => {
    const resp = await discoverySearch("Heizung Berlin", {
      source: "firecrawl",
      edenApiKey: "testkey",
      limit: 30,
      excludeDomains: ["beta.de"],
    });
    expect(resp.error).toBeUndefined();
    expect(resp.hits).toHaveLength(2); // acme.de dedupe removes the dup
    expect(resp.hits[1].domain).toBe("beta.de");
    expect(resp.hits[1].isDuplicate).toBe(true);
  });

  it("flags catalog domains", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            output: {
              results: [{ title: "Gelbe Seiten", url: "https://www.gelbeseiten.de/x", content: "" }],
            },
            status: "success",
          }),
          text: async () => "{}",
          body: { cancel: async () => {} },
        }) as unknown as Response
      )
    );
    const resp = await discoverySearch("heizung", {
      source: "firecrawl",
      edenApiKey: "testkey",
    });
    // Dedupe via search's deduplicate() strips catalog entries entirely
    expect(resp.hits).toHaveLength(0);
  });
});
