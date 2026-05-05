"""
Web scraping engine: find company website, then scrape relevant pages.
"""

import re
import time
import logging
from urllib.parse import urljoin, urlparse
from typing import Optional

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

IMPRESSION_SLUGS = [
    "impressum", "imprint", "legal", "rechtliches",
    "kontakt", "contact", "ueber-uns", "about", "about-us",
]
PRIVACY_SLUGS = [
    "datenschutz", "datenschutzerklarung", "privacy", "privacy-policy",
    "datenschutzerklaerung",
]
CONTACT_SLUGS = ["kontakt", "contact", "kontaktieren", "get-in-touch"]

TIMEOUT = 7


def _get(url: str, timeout: int = TIMEOUT) -> Optional[requests.Response]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        r.raise_for_status()
        return r
    except Exception as e:
        logger.debug(f"GET {url} failed: {e}")
        return None


def find_website(company_name: str, existing_url: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
    """Return (base_url, strategy) for the company. strategy is one of:
    'provided_url', 'domain_guess', 'duckduckgo', 'bing', or None if not found."""

    # Strategy 0: use provided URL directly
    if existing_url:
        url = existing_url.strip()
        if not url.startswith("http"):
            url = "https://" + url
        r = _get(url)
        if r:
            logger.info(f"[{company_name}] found via provided URL: {r.url}")
            return _base_url(r.url), "provided_url"

    # Strategy 1: guess domain from company name
    guessed = _guess_domain(company_name)
    if guessed:
        logger.info(f"[{company_name}] found via domain guess: {guessed}")
        return guessed, "domain_guess"

    # Strategy 2: Startpage (Google proxy, reliable)
    result = _search_startpage(company_name)
    if result:
        logger.info(f"[{company_name}] found via Startpage: {result}")
        return result, "startpage"

    # Strategy 3: Bing fallback
    result = _search_bing(company_name)
    if result:
        logger.info(f"[{company_name}] found via Bing: {result}")
        return result, "bing"

    logger.warning(f"[{company_name}] no website found after all strategies")
    return None, None


def _name_on_page(html: str, company_name: str) -> bool:
    """Check if a meaningful part of the company name appears in the page HTML."""
    # Build keywords: strip legal form, split into words ≥4 chars
    name = company_name.lower()
    for suffix in [" gmbh", " ag", " ug", " kg", " ohg", " gbr", " e.v.", " ev",
                   " co. kg", " & co", " se", " inc", " ltd", " llc"]:
        name = name.replace(suffix, "")
    keywords = [w for w in re.split(r"[\s\-&]+", name.strip()) if len(w) >= 4]
    if not keywords:
        return True  # can't validate, accept
    html_lower = html.lower()
    # At least half the keywords must appear on page
    hits = sum(1 for kw in keywords if kw in html_lower)
    return hits >= max(1, len(keywords) // 2)


def _guess_domain(company_name: str) -> Optional[str]:
    """Try common domain patterns derived from the company name.
    Validates that the found page actually belongs to the company."""
    import re as _re
    # Normalize: lowercase, remove legal forms, replace spaces with hyphens
    name = company_name.lower().strip()
    for suffix in [" gmbh", " ag", " ug", " kg", " ohg", " gbr", " e.v.", " ev",
                   " co. kg", " & co", " se", " inc", " ltd", " llc"]:
        name = name.replace(suffix, "")
    name = name.strip()
    # Remove special chars, collapse spaces → hyphens
    name = _re.sub(r"[^\w\s-]", "", name)
    name = _re.sub(r"\s+", "-", name).strip("-")
    slug = name.replace(" ", "-")

    # Only try .de and .com with www – keeps it to max 4 requests
    for tld in [".de", ".com"]:
        for variant in [slug, slug.replace("-", "")]:
            if not variant:
                continue
            url = f"https://www.{variant}{tld}"
            r = _get(url, timeout=5)
            if r and r.status_code == 200:
                if _name_on_page(r.text, company_name):
                    logger.debug(f"[{company_name}] domain guess validated: {url}")
                    return _base_url(r.url)
                else:
                    logger.debug(f"[{company_name}] domain guess rejected (name not on page): {url}")
    return None


def _search_startpage(company_name: str) -> Optional[str]:
    """Startpage search (Google proxy, no bot blocking)."""
    SKIP = {"startpage.com", "google.com", "facebook.com", "linkedin.com",
            "wikipedia.org", "xing.com", "instagram.com", "youtube.com",
            "twitter.com", "x.com", "trustpilot.com", "gelbeseiten.de",
            "wlw.de", "companyhouse", "handelsregister"}
    query = f"{company_name} offizielle Website Impressum"
    url   = f"https://www.startpage.com/sp/search?q={requests.utils.quote(query)}&language=deutsch"
    r = _get(url, timeout=14)
    if not r:
        return None

    soup = BeautifulSoup(r.text, "lxml")
    seen = set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.startswith("http"):
            continue
        parsed = urlparse(href)
        domain = parsed.netloc.lower().replace("www.", "")
        if not domain or domain in seen:
            continue
        if any(s in domain for s in SKIP):
            continue
        seen.add(domain)
        base = f"{parsed.scheme}://{parsed.netloc}"
        test = _get(base, timeout=6)
        if test and test.status_code == 200:
            if _name_on_page(test.text, company_name):
                logger.debug(f"[{company_name}] Startpage validated: {base}")
                return _base_url(test.url)
            else:
                logger.debug(f"[{company_name}] Startpage rejected (name mismatch): {base}")
        if len(seen) >= 5:  # check max 5 candidates
            break
    return None


def _search_bing(company_name: str) -> Optional[str]:
    """Bing search – tries multiple result selectors (Bing changes markup often)."""
    SKIP = {"bing.com", "microsoft.com", "google.com", "facebook.com",
            "linkedin.com", "wikipedia.org", "xing.com", "instagram.com",
            "youtube.com", "twitter.com", "x.com", "trustpilot.com",
            "gelbeseiten.de", "wlw.de"}
    query      = f"{company_name} offizielle Website Impressum"
    search_url = f"https://www.bing.com/search?q={requests.utils.quote(query)}&setlang=de"
    r = _get(search_url, timeout=12)
    if not r:
        return None

    soup  = BeautifulSoup(r.text, "lxml")
    seen  = set()
    hrefs = []

    # Collect all external links from the page
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.startswith("http"):
            continue
        parsed = urlparse(href)
        domain = parsed.netloc.lower().replace("www.", "")
        if not domain or domain in seen:
            continue
        if any(s in domain for s in SKIP):
            continue
        seen.add(domain)
        hrefs.append(f"{parsed.scheme}://{parsed.netloc}")

    for base in hrefs[:5]:  # check max 5 candidates
        test = _get(base, timeout=6)
        if test and test.status_code == 200:
            if _name_on_page(test.text, company_name):
                logger.debug(f"[{company_name}] Bing validated: {base}")
                return _base_url(test.url)
    return None


def _base_url(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def _find_page(base: str, slugs: list[str]) -> Optional[str]:
    """Try to find a page by common slug patterns from homepage links first."""
    r = _get(base)
    if not r:
        return None
    soup = BeautifulSoup(r.text, "lxml")

    for a in soup.find_all("a", href=True):
        href = a["href"].lower().rstrip("/")
        for slug in slugs:
            if slug in href:
                full = urljoin(base, a["href"])
                return full

    # Direct URL guesses
    for slug in slugs:
        for ext in ["", ".html", ".htm", ".php"]:
            url = f"{base}/{slug}{ext}"
            test = _get(url)
            if test and test.status_code == 200:
                return url
    return None


def _clean_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "noscript", "svg", "img"]):
        tag.decompose()
    return " ".join(soup.get_text(separator=" ").split())


def scrape_company(base_url: str) -> dict:
    """
    Scrape impressum, privacy and contact pages.
    Returns dict with keys: impressum_text, privacy_text, contact_text,
    homepage_text, social_links.
    """
    result = {
        "impressum_text": "",
        "privacy_text": "",
        "contact_text": "",
        "homepage_text": "",
        "social_links": [],
    }

    # Homepage
    r = _get(base_url)
    if r:
        soup = BeautifulSoup(r.text, "lxml")
        result["homepage_text"] = _clean_text(soup)[:3000]
        result["social_links"] = _extract_social_links(soup, base_url)

    # Impressum
    imp_url = _find_page(base_url, IMPRESSION_SLUGS)
    if imp_url:
        r = _get(imp_url)
        if r:
            result["impressum_text"] = _clean_text(BeautifulSoup(r.text, "lxml"))[:5000]

    # Privacy
    prv_url = _find_page(base_url, PRIVACY_SLUGS)
    if prv_url:
        r = _get(prv_url)
        if r:
            result["privacy_text"] = _clean_text(BeautifulSoup(r.text, "lxml"))[:4000]

    # Contact
    con_url = _find_page(base_url, CONTACT_SLUGS)
    if con_url:
        r = _get(con_url)
        if r:
            result["contact_text"] = _clean_text(BeautifulSoup(r.text, "lxml"))[:3000]

    time.sleep(0.2)  # polite delay
    return result


def _extract_social_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    patterns = ["linkedin", "xing", "twitter", "x.com", "facebook", "instagram", "youtube"]
    found = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].lower()
        for p in patterns:
            if p in href:
                full = urljoin(base_url, a["href"])
                found.add(full)
    return list(found)


# ── Regex extractors (fallback) ───────────────────────────────────────────────

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(
    r"(?:Tel\.?|Telefon|Phone|Fon|☎)?[\s:]*"
    r"(\+?[\d\s\-/().]{7,20})"
)


def regex_extract(text: str) -> dict:
    emails = list(set(EMAIL_RE.findall(text)))
    phones_raw = PHONE_RE.findall(text)
    phones = [p.strip() for p in phones_raw if len(p.strip()) >= 7][:5]

    return {
        "emails": emails[:10],
        "phones": phones,
    }
