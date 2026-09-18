import { describe, it, expect, vi, beforeEach } from "vitest";
import { findImpressumLink, hasSufficientContactInfo, batchEnrichRow } from "./batch-enrich";
import * as db from "./db";
import * as edenai from "./edenai";

vi.mock("./db", () => ({
  getCachedScrape: vi.fn(),
  setCachedScrape: vi.fn(),
}));

vi.mock("./edenai", () => ({
  edenScrapeUrl: vi.fn(),
  edenChatCompletion: vi.fn(),
}));

vi.mock("./search", () => ({
  webSearch: vi.fn().mockResolvedValue({ results: [] }),
}));

describe("Batch Enrichment P0 Cost & IP Protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasSufficientContactInfo", () => {
    it("detects when email and phone/address are already present on homepage", () => {
      const sample = `
        # Dachdeckerei Schmidt
        Wir sind Ihr Partner für Dächer in Hamburg.
        Kontakt: Telefon 040 12345678
        E-Mail: info@schmidt-dach.de
        Geschäftsführer: Hans Schmidt
      `;
      expect(hasSufficientContactInfo(sample)).toBe(true);
    });

    it("returns false if email is missing", () => {
      const sample = `
        # Dachdeckerei Schmidt
        Telefon: 040 12345678
        Geschäftsführer: Hans Schmidt
      `;
      expect(hasSufficientContactInfo(sample)).toBe(false);
    });

    it("returns false if only text without contact info is present", () => {
      expect(hasSufficientContactInfo("Herzlich Willkommen auf unserer Seite.")).toBe(false);
    });
  });

  describe("findImpressumLink", () => {
    it("extracts Markdown impressum link with highest score", () => {
      const md = `
        [Home](/)
        [Leistungen](/leistungen)
        [Kontakt](/kontakt)
        [Impressum](/ueber-uns/impressum)
      `;
      const link = findImpressumLink(md, "https://schmidt-dach.de");
      expect(link).toBe("https://schmidt-dach.de/ueber-uns/impressum");
    });

    it("extracts HTML impressum link", () => {
      const html = `<p>Rechtliches: <a href="/rechtliches/impressum">Impressum</a></p>`;
      const link = findImpressumLink(html, "https://schmidt-dach.de");
      expect(link).toBe("https://schmidt-dach.de/rechtliches/impressum");
    });

    it("ignores external links like social media", () => {
      const md = `[Impressum](https://facebook.com/impressum)`;
      const link = findImpressumLink(md, "https://schmidt-dach.de");
      expect(link).toBeUndefined();
    });
  });

  describe("batchEnrichRow Request Elimination & Caching", () => {
    it("makes ONLY 1 scrape request when homepage has full contact info (0 blind impressum calls)", async () => {
      vi.mocked(db.getCachedScrape).mockResolvedValue(null);
      vi.mocked(edenai.edenScrapeUrl).mockResolvedValueOnce({
        markdown: `
          # Dachdeckerei Schmidt
          Telefon: +49 40 12345678
          E-Mail: info@schmidt-dach.de
          Geschäftsführer: Hans Schmidt
        `,
        title: "Dachdeckerei Schmidt",
      });
      vi.mocked(edenai.edenChatCompletion).mockResolvedValue({
        content: JSON.stringify({
          company_name: "Dachdeckerei Schmidt",
          phone: "+49 40 12345678",
          company_email: "info@schmidt-dach.de",
        }),
        raw: JSON.stringify({
          company_name: "Dachdeckerei Schmidt",
          phone: "+49 40 12345678",
          company_email: "info@schmidt-dach.de",
        }),
      });

      const res = await batchEnrichRow(
        { domain: "schmidt-dach.de", company_name: "Dachdeckerei Schmidt" },
        { edenApiKey: "test-eden-key", firecrawlApiKey: "fc-test" }
      );

      // Verify ONLY 1 scrape call was made (no blind /impressum, /kontakt, /about calls!)
      expect(edenai.edenScrapeUrl).toHaveBeenCalledTimes(1);
      expect(edenai.edenScrapeUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://schmidt-dach.de",
          directFirecrawlApiKey: "fc-test",
        })
      );

      // Verify it was saved to Postgres scrape_cache!
      expect(db.setCachedScrape).toHaveBeenCalledWith(
        "https://schmidt-dach.de",
        expect.stringContaining("Dachdeckerei Schmidt"),
        "Dachdeckerei Schmidt"
      );

      expect(res.fields.company_email).toBe("info@schmidt-dach.de");
    });

    it("scrapes at most 1 targeted impressum page if homepage lacks email", async () => {
      vi.mocked(db.getCachedScrape).mockResolvedValue(null);
      // Homepage response lacks email, but has link to /impressum-rechtliches
      vi.mocked(edenai.edenScrapeUrl).mockResolvedValueOnce({
        markdown: `
          # Dachdeckerei Schmidt
          Willkommen auf unserer Seite.
          [Zum Impressum](/impressum-rechtliches)
        `,
        title: "Home",
      });

      // Targeted impressum scrape response
      vi.mocked(edenai.edenScrapeUrl).mockResolvedValueOnce({
        markdown: `
          # Impressum
          Dachdeckerei Schmidt GmbH
          E-Mail: kontakt@schmidt-dach.de
          Geschäftsführer: Hans Schmidt
        `,
        title: "Impressum",
      });

      vi.mocked(edenai.edenChatCompletion).mockResolvedValue({
        content: JSON.stringify({
          company_email: "kontakt@schmidt-dach.de",
        }),
        raw: JSON.stringify({
          company_email: "kontakt@schmidt-dach.de",
        }),
      });

      await batchEnrichRow(
        { domain: "schmidt-dach.de", company_name: "Dachdeckerei Schmidt" },
        { edenApiKey: "test-eden-key", firecrawlApiKey: "fc-test" }
      );

      // Total scrapes = exactly 2 (homepage + 1 targeted impressum). Zero blind 6-path attempts!
      expect(edenai.edenScrapeUrl).toHaveBeenCalledTimes(2);
      expect(edenai.edenScrapeUrl).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          url: "https://schmidt-dach.de/impressum-rechtliches",
          directFirecrawlApiKey: "fc-test",
        })
      );

      // Both should be cached
      expect(db.setCachedScrape).toHaveBeenCalledTimes(2);
    });

    it("uses Postgres scrape_cache without making any network calls if cached", async () => {
      vi.mocked(db.getCachedScrape).mockResolvedValue({
        markdown: `
          # Dachdeckerei Schmidt
          Telefon: +49 40 12345678
          E-Mail: info@schmidt-dach.de
        `,
        title: "Cached Home",
      });
      vi.mocked(edenai.edenChatCompletion).mockResolvedValue({
        content: JSON.stringify({ company_email: "info@schmidt-dach.de" }),
        raw: JSON.stringify({ company_email: "info@schmidt-dach.de" }),
      });

      await batchEnrichRow(
        { domain: "schmidt-dach.de", company_name: "Dachdeckerei Schmidt" },
        { edenApiKey: "test-eden-key", firecrawlApiKey: "fc-test" }
      );

      // Zero network scrapes!
      expect(edenai.edenScrapeUrl).toHaveBeenCalledTimes(0);
    });
  });
});
