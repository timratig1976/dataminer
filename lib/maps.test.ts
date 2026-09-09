/**
 * lib/maps.test.ts
 *
 * Unit tests for lib/maps.ts — SerpApi parsing and placesToHits conversion.
 * Network calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapsSearchViaSerpApi, placesToHits, placeToSeedExtras, type MapsPlace } from "./maps";

const SERP_MAPS_RESPONSE = {
  local_results: [
    {
      title: "Meier Heizungsbau GmbH",
      address: "Hauptstraße 1, 14467 Potsdam",
      phone: "0331 123456",
      website: "https://www.meier-heizung.de",
      rating: 4.8,
      reviews: 120,
      category: "Heizungsinstallateur",
      link: "https://maps.google.com/?cid=123",
    },
    {
      title: "Schulz Sanitär",
      address: "Berliner Str. 5, 14467 Potsdam",
      phone: "+49 331 999",
      website: "", // no website
      rating: 4.1,
      reviews: 30,
      link: "https://maps.google.com/?cid=456",
    },
  ],
};

describe("mapsSearchViaSerpApi", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("engine=google_maps");
        return {
          ok: true,
          status: 200,
          json: async () => SERP_MAPS_RESPONSE,
          text: async () => JSON.stringify(SERP_MAPS_RESPONSE),
          body: { cancel: async () => {} },
        } as unknown as Response;
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("maps SerpApi local_results to places", async () => {
    const places = await mapsSearchViaSerpApi({
      query: "Heizung Potsdam",
      serpApiKey: "k",
      limit: 20,
    });
    expect(places).toHaveLength(2);
    expect(places[0].name).toBe("Meier Heizungsbau GmbH");
    expect(places[0].website).toBe("https://www.meier-heizung.de");
    expect(places[0].rating).toBe(4.8);
    // Second place has no website — mapsUrl must be set
    expect(places[1].website).toBe("");
    expect(places[1].mapsUrl).toContain("cid=456");
  });

  it("throws on missing API key", async () => {
    await expect(
      mapsSearchViaSerpApi({ query: "x", serpApiKey: "", limit: 5 })
    ).rejects.toThrow(/SERP_API_KEY/);
  });

  it("throws on empty query", async () => {
    await expect(
      mapsSearchViaSerpApi({ query: "  ", serpApiKey: "k" })
    ).rejects.toThrow(/empty query/);
  });
});

describe("placesToHits", () => {
  it("prefers website as canonical URL and flags duplicates", () => {
    const places: MapsPlace[] = [
      { name: "A", address: "", phone: "", website: "https://same.de", mapsUrl: "https://maps.google.com/a", rating: 4.5, reviews: 10 },
      { name: "B (Filiale)", address: "", phone: "", website: "https://same.de/filiale", mapsUrl: "https://maps.google.com/b" },
    ];
    const hits = placesToHits(places, "q", "maps-serpapi");
    expect(hits).toHaveLength(2);
    expect(hits[0].domain).toBe("same.de");
    expect(hits[0].isDuplicate).toBe(false);
    // Second place shares the domain → flagged
    expect(hits[1].isDuplicate).toBe(true);
    expect(hits[0].snippet).toContain("★ 4.5");
  });

  it("respects excludeDomains", () => {
    const places: MapsPlace[] = [
      { name: "A", address: "", phone: "", website: "https://known.de", mapsUrl: "" },
    ];
    const hits = placesToHits(places, "q", "maps-serpapi", ["known.de"]);
    expect(hits[0].isDuplicate).toBe(true);
  });
});

describe("placeToSeedExtras", () => {
  it("serialises structured fields", () => {
    const extras = placeToSeedExtras({
      name: "A", address: "X-Str. 1", phone: "123", website: "", mapsUrl: "https://maps/x",
      rating: 4.2, reviews: 7, category: "Sanitär",
    });
    expect(extras).toEqual({
      address: "X-Str. 1",
      phone: "123",
      maps_url: "https://maps/x",
      maps_rating: "4.2",
      maps_reviews: "7",
      category: "Sanitär",
    });
  });
});
