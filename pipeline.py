"""
Enrichment pipeline: orchestrates scraping + extraction per company row.
"""

import logging
import traceback
from typing import Optional, Callable

import pandas as pd

from scraper import find_website, scrape_company
from extractor import extract, EXTRACTION_FIELDS
from formatter import format_row
from enricher import deep_enrich
from validator import validate_row, check_duplicates

logger = logging.getLogger(__name__)


def enrich_row(
    company_name: str,
    input_url: Optional[str],
    api_key: Optional[str] = None,
    deep: bool = False,
) -> dict:
    """Process a single company. Returns flat dict of enriched fields."""
    result = {k: None for k in EXTRACTION_FIELDS}
    result["_status"] = "pending"
    result["_website_found"] = None
    result["_search_strategy"] = None
    result["_scraped_pages"] = None
    result["_extraction_method"] = None
    result["_error"]            = None
    result["email_pattern_guess"] = None
    result["email_patterns_all"] = None
    result["_quality_score"]     = None
    result["_quality_flags"]     = None
    result["_validation"]        = None
    result["_confidence_avg"]    = None

    try:
        # Step 1: Find website
        logger.info(f"[{company_name}] Searching for website...")
        base_url, strategy = find_website(company_name, input_url or None)
        if not base_url:
            logger.warning(f"[{company_name}] No website found")
            result["_status"] = "no_website"
            return result

        result["_search_strategy"] = strategy

        logger.info(f"[{company_name}] Website found: {base_url}")
        result["_website_found"] = base_url
        result["website"] = base_url

        # Step 2: Scrape pages
        logger.info(f"[{company_name}] Scraping pages...")
        scraped = scrape_company(base_url)
        scraped_pages = []
        if scraped.get("impressum_text"): scraped_pages.append("Impressum")
        if scraped.get("contact_text"):   scraped_pages.append("Kontakt")
        if scraped.get("privacy_text"):   scraped_pages.append("Datenschutz")
        result["_scraped_pages"] = ", ".join(scraped_pages) if scraped_pages else "—"
        logger.info(f"[{company_name}] Scraped: {scraped_pages}")

        # Step 3: Extract structured data
        logger.info(f"[{company_name}] Extracting data...")
        extracted = extract(scraped, api_key=api_key)
        result.update(extracted)

        # Step 4: Format (E.164 phone, email patterns)
        result = format_row(result)

        # Step 5: Validate fields
        validation = validate_row(result)
        result.update(validation)
        logger.info(f"[{company_name}] Quality score: {result['_quality_score']} | flags: {result['_quality_flags']}")

        # Step 6 (optional): Deep enrichment
        if deep:
            logger.info(f"[{company_name}] Running deep enrichment...")
            result = deep_enrich(result)

        result["_status"] = "success"
        logger.info(f"[{company_name}] Done (method={extracted.get('_extraction_method')})")

    except Exception as e:
        logger.error(f"Error enriching '{company_name}': {e}")
        result["_status"] = "error"
        result["_error"] = str(e)

    return result


def run_pipeline(
    df: pd.DataFrame,
    api_key: Optional[str] = None,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> pd.DataFrame:
    """
    Enrich all rows in df (must have 'company_name' and 'input_url' columns).
    progress_callback(current, total, company_name) called per row.
    Returns enriched DataFrame.
    """
    total = len(df)
    results = []

    for i, row in df.iterrows():
        company = str(row.get("company_name", "")).strip()
        url = str(row.get("input_url", "")).strip() or None

        if progress_callback:
            progress_callback(i + 1, total, company)

        enriched = enrich_row(company, url, api_key=api_key)
        # Merge original row data with enriched data
        merged = {**row.to_dict(), **enriched}
        results.append(merged)

    return pd.DataFrame(results)
