"""
Deep enrichment: additional searches after primary extraction.
Finds LinkedIn/Xing profiles, alternative URLs, Handelsregister entries.
Uses Startpage search with targeted queries.
"""

import logging
import re
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
}
TIMEOUT = 7


def _get(url: str) -> Optional[requests.Response]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        r.raise_for_status()
        return r
    except Exception as e:
        logger.debug(f"GET {url} failed: {e}")
        return None


def _startpage_links(query: str, max_results: int = 8) -> list[str]:
    """Return list of URLs from Startpage for the given query."""
    url = f"https://www.startpage.com/sp/search?q={requests.utils.quote(query)}&language=deutsch"
    r = _get(url)
    if not r:
        return []
    soup  = BeautifulSoup(r.text, "lxml")
    seen  = set()
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.startswith("http"):
            continue
        parsed = urlparse(href)
        domain = parsed.netloc.lower()
        if "startpage" in domain or not domain:
            continue
        if domain not in seen:
            seen.add(domain)
            links.append(href)
        if len(links) >= max_results:
            break
    return links


# ── Individual enrichment probes ─────────────────────────────────────────────

def find_linkedin_company(company_name: str, existing: Optional[str] = None) -> Optional[str]:
    """Find LinkedIn company page URL."""
    if existing and "linkedin.com/company" in existing:
        return existing
    links = _startpage_links(f"site:linkedin.com/company {company_name}")
    for url in links:
        if "linkedin.com/company/" in url.lower():
            return url
    return None


def find_linkedin_person(name: str, company_name: str = "") -> Optional[str]:
    """Find LinkedIn profile for a person (e.g. managing director)."""
    if not name or name.strip() in ("", "None"):
        return None
    query = f'site:linkedin.com/in "{name}"'
    if company_name:
        query += f" {company_name}"
    links = _startpage_links(query)
    for url in links:
        if "linkedin.com/in/" in url.lower():
            return url
    return None


def find_xing_person(name: str, company_name: str = "") -> Optional[str]:
    """Find Xing profile for a person."""
    if not name or name.strip() in ("", "None"):
        return None
    query = f'site:xing.com/profile "{name}"'
    links = _startpage_links(query)
    for url in links:
        if "xing.com/profile/" in url.lower():
            return url
    return None


def find_handelsregister(company_name: str, register_number: Optional[str] = None) -> Optional[str]:
    """Find Handelsregister entry URL."""
    query = f"Handelsregister {company_name}"
    if register_number:
        query += f" {register_number}"
    links = _startpage_links(query + " site:handelsregister.de OR site:unternehmensregister.de")
    for url in links:
        if any(x in url for x in ["handelsregister.de", "unternehmensregister.de"]):
            return url
    # Try direct handelsregister.de
    query2 = f"https://www.handelsregister.de/rp_web/search.do?schlagwoerter={requests.utils.quote(company_name)}"
    return query2


def find_alternative_urls(company_name: str, known_url: Optional[str] = None) -> list[str]:
    """Find alternative/additional URLs (press, review sites, etc.)."""
    SKIP = {"facebook.com", "instagram.com", "twitter.com", "x.com",
            "youtube.com", "startpage.com", "google.com"}
    if known_url:
        known_domain = urlparse(known_url).netloc.lower().replace("www.", "")
        SKIP.add(known_domain)

    query = f"{company_name} offizielle Website"
    links = _startpage_links(query, max_results=10)
    alts  = []
    for url in links:
        domain = urlparse(url).netloc.lower()
        if not any(s in domain for s in SKIP):
            alts.append(url)
        if len(alts) >= 3:
            break
    return alts


# ── Main entry point ──────────────────────────────────────────────────────────

def deep_enrich(result: dict) -> dict:
    """
    Run additional enrichment probes on an already-enriched row.
    Adds fields prefixed with _deep_.
    """
    company_name     = result.get("company_name", "")
    managing_director = result.get("managing_director") or ""
    known_url        = result.get("_website_found") or result.get("website") or ""
    register_number  = result.get("register_number")

    logger.info(f"[{company_name}] Deep enrichment start")

    # 1. LinkedIn company page
    existing_li = result.get("linkedin")
    li_company  = find_linkedin_company(company_name, existing_li)
    if li_company:
        result["linkedin"] = li_company
        logger.info(f"[{company_name}] LinkedIn company: {li_company}")

    # 2. LinkedIn + Xing profiles for each managing director
    directors = [d.strip() for d in re.split(r"[,;/]", managing_director) if d.strip()]
    li_persons   = []
    xing_persons = []
    for director in directors[:3]:  # max 3 directors
        li_p = find_linkedin_person(director, company_name)
        if li_p:
            li_persons.append(f"{director}: {li_p}")
            logger.info(f"[{company_name}] LinkedIn person ({director}): {li_p}")
        xing_p = find_xing_person(director, company_name)
        if xing_p:
            xing_persons.append(f"{director}: {xing_p}")
            logger.info(f"[{company_name}] Xing person ({director}): {xing_p}")

    if li_persons:
        result["_deep_linkedin_persons"] = " | ".join(li_persons)
    if xing_persons:
        result["_deep_xing_persons"] = " | ".join(xing_persons)

    # 3. Handelsregister link
    hr_url = find_handelsregister(company_name, register_number)
    if hr_url:
        result["_deep_handelsregister"] = hr_url
        logger.info(f"[{company_name}] Handelsregister: {hr_url}")

    # 4. Alternative URLs
    alts = find_alternative_urls(company_name, known_url)
    if alts:
        result["_deep_alternative_urls"] = " | ".join(alts)
        logger.info(f"[{company_name}] Alt URLs: {alts}")

    logger.info(f"[{company_name}] Deep enrichment done")
    return result
