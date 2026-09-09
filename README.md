This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

### Run with Infisical secrets

If you use Infisical, configure these secret names in your Infisical project/environment:

- `OPENAI_API_KEY`
- `CEREBRAS_API_KEY`
- `API_KEY_ENCRYPTION_KEY`

Then run:

```bash
npm run dev:infisical
```

If this is a new machine/session, login and link first:

```bash
infisical login
infisical init
```

### LLM smoke test

Use this route to quickly validate model availability + key wiring (OpenAI/Cerebras):

```bash
curl -s http://localhost:3000/api/llm/smoke | jq
```

Optional: test with a specific case (uses case-level keys first, env fallback otherwise):

```bash
curl -s -X POST http://localhost:3000/api/llm/smoke \
  -H 'Content-Type: application/json' \
  -d '{"caseId":"<CASE_ID>"}' | jq
```

### Compare up to 3 models for one task

The prompt editor can compare up to 3 models on the same row and suggest a recommended model.
There is also an API route:

```bash
curl -s -X POST http://localhost:3000/api/llm/compare \
  -H 'Content-Type: application/json' \
  -d '{"caseId":"<CASE_ID>","rowId":"<ROW_ID>","column":{"id":"tmp","name":"Test","prompt":"Return the official domain for {company_name}","outputKey":"official_domain","model":"gpt-4o-mini"},"models":["gpt-4o-mini","llama3.3-70b","gpt-oss-120b"]}' | jq
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### Lead Discovery (Web + Google Maps)

The **"Leads entdecken"** button (under *Daten hochladen & Spalten zuordnen* in a case) opens an interactive discovery panel. It follows a *load many results first, enrich later* workflow:

1. Pick a source — Web (Firecrawl/Eden, SerpApi, Brave, DuckDuckGo, Scrapling) or **Google Maps** (SerpApi structured, or free Scrapling stealth scrape).
2. Search up to 100 results per query. Duplicates (domain already in the case) and directories (gelbeseiten etc.) are flagged automatically.
3. Tick the leads you want, then **übernehmen** → they are appended as rows with seed fields (`company_name`, `source_url`, `source_domain`, `source_title`, `source_snippet`, `search_query`, `search_source`). Maps hits additionally carry `address`, `phone`, `maps_rating`, `maps_reviews`, `category`.
4. Optionally pre-scrape top pages into the cache (needs an Eden key) so later enrichment doesn't re-pay Firecrawl.

Two discovery modes:
- **Neue Suche** — a single query.
- **Bestehende erweitern** — build queries from existing rows via a template (e.g. `{industry_keywords} {city} Anbieter`, with `{a|b}` fallbacks), so you can grow a table of companies iteratively.

Endpoints:
```bash
# Preview search (writes nothing). source: auto|firecrawl|serpapi|brave|duckduckgo|scrapling|maps-serpapi|maps-scrapling
curl -s -X POST http://localhost:3000/api/discovery/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"Heizung Potsdam","source":"firecrawl","limit":30,"caseId":"<CASE_ID>"}' | jq

# Append accepted leads to a case (extendQueries runs a batch server-side)
curl -s -X POST http://localhost:3000/api/cases/<CASE_ID>/discover \
  -H 'Content-Type: application/json' \
  -d '{"hits":[...],"extractNames":true,"scrapePages":false}' | jq
```

Google Maps via the free Scraper needs the sidecar running (`npm run scrapling`) — it exposes `POST /maps/search`.

### Apollo.io contacts (MCP)

Add the **"Apollo Contacts"** preset column. It is a deterministic tool column (no LLM): for each row it looks up decision makers by `company_name` + `official_domain` via Apollo.io.

- Transport is MCP-first (`@thevgergroup/apollo-io-mcp` spawned as a stdio child) with automatic **REST fallback** if the MCP server can't start. Force with `APOLLO_TRANSPORT=rest`.
- Only the **0-credit search** endpoint is used — no reveal/enrich — and results are cached 30 days in SQLite, so re-runs are free.
- A per-run budget guard (`APOLLO_MAX_LOOKUPS_RUN`) stops runaway lookups.

```bash
# transport health + tools list
curl -s http://localhost:3000/api/apollo/smoke | jq
# transport health + a real test search
curl -s -X POST http://localhost:3000/api/apollo/smoke \
  -H 'Content-Type: application/json' \
  -d '{"domain":"apollo.io","limit":3}' | jq
```

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
