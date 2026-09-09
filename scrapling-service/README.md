# Scrapling Service

Local Python sidecar for Dataminer. Provides stealth scraping + Google bypass via Scrapling's `StealthyFetcher`.

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/scrapling install  # downloads Playwright browsers (~500MB)
```

## Run

```bash
SCRAPING_API_TOKEN=dev-local-token .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SCRAPING_API_TOKEN` | Yes | Shared secret between Next.js and this service |
| `PROXY_URL` | No (prod only) | e.g. `http://user:pass@proxy.evomi.com:1000` |

## Endpoints

- `GET /health` — liveness check
- `POST /scrape` — fetch a URL stealthily, returns full page text
- `POST /search` — Google search bypassing bot detection
- `POST /maps/search` — Google Maps local results (name, address, phone, website, rating). Scrolls the results feed to load up to `max_results` (≤100). Free alternative to the SerpApi Maps engine.

All endpoints require `x-api-token: <SCRAPLING_API_TOKEN>` header.

`POST /maps/search` body: `{ "query": "Heizung Potsdam", "max_results": 20, "ll": "52.39,13.06" }` (`ll` optional).
