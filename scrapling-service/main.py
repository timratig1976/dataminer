"""
scrapling-service/main.py
Lightweight FastAPI wrapper around Scrapling's StealthyFetcher.
Used by Dataminer as Layer 5 (Google / Cloudflare bypass) in search.ts.

Start:  uvicorn main:app --host 127.0.0.1 --port 8001 --reload
"""

import os
import time
import random
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from scrapling.fetchers import StealthyFetcher

app = FastAPI(title="Scrapling Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

API_TOKEN = os.environ.get("SCRAPING_API_TOKEN", "dev-local-token")
PROXY_URL = os.environ.get("PROXY_URL", "")  # optional, leave empty locally


def _auth(token: str) -> None:
    if token != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


def _human_delay() -> None:
    """Random pause between 2–5s to mimic human browsing pace."""
    time.sleep(random.uniform(2.0, 5.0))


# ── /health ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── /scrape ───────────────────────────────────────────────────────────────────

class ScrapeRequest(BaseModel):
    url: HttpUrl
    wait_for_idle: bool = True

class ScrapeResponse(BaseModel):
    url: str
    text: str

@app.post("/scrape", response_model=ScrapeResponse)
def scrape(req: ScrapeRequest, x_api_token: str = Header(...)):
    _auth(x_api_token)
    kwargs = dict(
        headless=True,
        network_idle=req.wait_for_idle,
        google_search=False,
        disable_resources=False,
    )
    if PROXY_URL:
        kwargs["proxy"] = PROXY_URL

    _human_delay()
    page = StealthyFetcher.fetch(str(req.url), **kwargs)
    return ScrapeResponse(url=str(req.url), text=page.get_all_text(separator="\n"))


# ── /search ───────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    max_results: int = 10
    page: int = 1  # 1-based, each page = max_results offset

class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str

class SearchResponse(BaseModel):
    results: list[SearchResult]
    query: str
    page: int
    per_page: int

class SearchDebugResponse(BaseModel):
    query: str
    html_snippet: str
    page_title: str
    all_links: list[str]


def _is_real_url(url: str) -> bool:
    return (
        url.startswith("http")
        and "google.com" not in url
        and "google.de" not in url
        and "googleusercontent" not in url
        and "gstatic.com" not in url
        and "youtube.com" not in url
        and not url.startswith("/")
    )


def _parse_google_page(page, max_results: int) -> list[SearchResult]:
    results: list[SearchResult] = []

    # Strategy 1: classic #search .g cards
    for card in page.css("#search .g, #search [data-sokoban-container], div.g"):
        if len(results) >= max_results:
            break
        a_els = card.css("a[href^='http']")
        h3_els = card.css("h3")
        snippet_els = card.css(".VwiC3b, .lEBKkf, .IsZvec, span[style], .st")
        if not a_els or not h3_els:
            continue
        url = a_els[0].attrib.get("href", "")
        if not _is_real_url(url):
            continue
        results.append(SearchResult(
            title=h3_els[0].text.strip(),
            url=url,
            snippet=snippet_els[0].text.strip() if snippet_els else "",
        ))

    if results:
        return results

    # Strategy 2: any <a href> with an <h3> parent/sibling anywhere on the page
    for h3 in page.css("h3"):
        if len(results) >= max_results:
            break
        parent = h3.parent
        if parent is None:
            continue
        a_els = parent.css("a[href^='http']") or h3.css("a[href^='http']")
        if not a_els:
            # try grandparent
            gp = parent.parent
            if gp:
                a_els = gp.css("a[href^='http']")
        if not a_els:
            continue
        url = a_els[0].attrib.get("href", "")
        if not _is_real_url(url):
            continue
        results.append(SearchResult(
            title=h3.text.strip(),
            url=url,
            snippet="",
        ))

    if results:
        return results

    # Strategy 3: all meaningful external links as last resort
    seen = set()
    for a in page.css("a[href^='http']"):
        if len(results) >= max_results:
            break
        url = a.attrib.get("href", "")
        if not _is_real_url(url) or url in seen:
            continue
        text = a.text.strip() if a.text else ""
        if len(text) < 5:
            continue
        seen.add(url)
        results.append(SearchResult(title=text, url=url, snippet=""))

    return results


@app.post("/search", response_model=SearchResponse)
def search(req: SearchRequest, x_api_token: str = Header(...)):
    _auth(x_api_token)
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Empty query")

    import urllib.parse
    kwargs = dict(
        headless=True,
        network_idle=True,
        google_search=False,
        disable_resources=False,
    )
    if PROXY_URL:
        kwargs["proxy"] = PROXY_URL

    _human_delay()
    encoded = urllib.parse.quote_plus(req.query.strip())
    per_page = min(req.max_results, 100)
    start = (max(req.page, 1) - 1) * per_page  # Google start= offset
    num = min(per_page, 10)  # Google caps at 10 reliably; we fetch multiple pages if needed
    search_url = f"https://www.google.com/search?q={encoded}&hl=de&gl=de&num={num}&start={start}"
    fetched_page = StealthyFetcher.fetch(search_url, **kwargs)
    results = _parse_google_page(fetched_page, per_page)
    return SearchResponse(results=results, query=req.query, page=max(req.page, 1), per_page=per_page)


@app.post("/debug/search", response_model=SearchDebugResponse)
def debug_search(req: SearchRequest, x_api_token: str = Header(...)):
    """Returns raw HTML snippet + all links to diagnose selector issues."""
    _auth(x_api_token)
    import urllib.parse
    kwargs = dict(headless=True, network_idle=True, google_search=False)
    if PROXY_URL:
        kwargs["proxy"] = PROXY_URL

    encoded = urllib.parse.quote_plus(req.query.strip())
    search_url = f"https://www.google.com/search?q={encoded}&hl=de&gl=de&num=10"
    page = StealthyFetcher.fetch(search_url, **kwargs)

    all_links = [
        a.attrib.get("href", "")
        for a in page.css("a[href^='http']")
        if _is_real_url(a.attrib.get("href", ""))
    ][:20]

    title_el = page.css("title")
    page_title = title_el[0].text.strip() if title_el else ""
    html_snippet = page.get_all_text(separator="\n")[:3000]

    return SearchDebugResponse(
        query=req.query,
        html_snippet=html_snippet,
        page_title=page_title,
        all_links=all_links,
    )
