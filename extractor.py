"""
Data extraction engine: OpenAI GPT-4o with regex fallback.
Extracts structured company information from scraped text.
"""

import json
import logging
import os
from typing import Optional

from dotenv import load_dotenv

from scraper import regex_extract

load_dotenv()

logger = logging.getLogger(__name__)

EXTRACTION_FIELDS = {
    "company_name": "Offizieller Unternehmensname",
    "legal_form": "Rechtsform (GmbH, AG, UG, ...)",
    "street": "Straße und Hausnummer",
    "zip": "Postleitzahl",
    "city": "Stadt",
    "state": "Bundesland",
    "country": "Land (Deutschland, Österreich, Schweiz, ...)",
    "phone": "Telefonnummer (Hauptnummer, Festnetz)",
    "mobile": "Mobilnummer / Handynummer (beginnt mit 015x, 016x, 017x)",
    "fax": "Faxnummer",
    "email_general": "Allgemeine E-Mail Adresse",
    "email_contact": "Kontakt-E-Mail",
    "email_privacy": "Datenschutz-E-Mail (DSB)",
    "managing_director": "Geschäftsführer / Vorstand (Namen, kommagetrennt)",
    "privacy_officer": "Datenschutzbeauftragter Name",
    "privacy_officer_contact": "Datenschutzbeauftragter Kontakt",
    "register_court": "Registergericht",
    "register_number": "Handelsregisternummer (HRB/HRA ...)",
    "vat_id": "USt-IdNr.",
    "linkedin": "LinkedIn URL",
    "xing": "Xing URL",
    "twitter": "Twitter/X URL",
    "facebook": "Facebook URL",
    "instagram": "Instagram URL",
    "website": "Website URL",
    "industry": "Branche / Tätigkeitsbereich (kurz, z.B. 'Heizungsbau', 'IT-Dienstleistungen')",
    "description": "Kurzbeschreibung des Unternehmens (1-2 Sätze)",
}

SYSTEM_PROMPT = """Du bist ein Datenextraktion-Assistent.
Extrahiere aus dem Firmen-Webseiteninhalt die angegebenen Felder.
Antworte NUR mit einem validen JSON-Objekt.
Für jedes Feld gib ZWEI Werte zurück:
  "<feld>": <wert oder null>
  "<feld>_confidence": <0.0-1.0>  (1.0 = sehr sicher, 0.0 = geraten/nicht gefunden)
Keine Erklärungen, nur JSON."""

USER_PROMPT_TEMPLATE = """Extrahiere folgende Felder aus dem Text:

{fields_list}

TEXT:
---
IMPRESSUM:
{impressum}

KONTAKTSEITE:
{contact}

HOMEPAGE:
{homepage}

SOCIAL LINKS GEFUNDEN:
{social_links}
---

Antworte nur mit JSON."""


def _build_prompt(scraped: dict) -> str:
    fields_list = "\n".join(
        f"- {key}: {desc}" for key, desc in EXTRACTION_FIELDS.items()
    )
    return USER_PROMPT_TEMPLATE.format(
        fields_list=fields_list,
        impressum=scraped.get("impressum_text", "")[:3000],
        contact=scraped.get("contact_text", "")[:2000],
        homepage=scraped.get("homepage_text", "")[:1500],
        social_links=", ".join(scraped.get("social_links", [])),
    )


def extract_with_openai(scraped: dict, api_key: Optional[str] = None,
                        system_prompt: Optional[str] = None) -> dict:
    """Use GPT-4o-mini to extract structured data from scraped text."""
    try:
        from openai import OpenAI

        key = api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise ValueError("No OpenAI API key provided")

        client = OpenAI(api_key=key)
        user_prompt = _build_prompt(scraped)
        sys_prompt  = system_prompt or SYSTEM_PROMPT

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
            max_tokens=2500,
        )
        raw = response.choices[0].message.content
        data = json.loads(raw)
        # Separate confidence scores from field values
        conf = {}
        clean = {}
        for k, v in data.items():
            if k.endswith("_confidence"):
                conf[k] = v
            else:
                clean[k] = v
        clean["_extraction_method"] = "openai"
        clean["_prompt_system"]     = sys_prompt
        clean["_prompt_user"]       = user_prompt
        clean["_confidence"]        = conf  # dict of field->score
        # Overall confidence = mean of filled fields
        scores = [v for v in conf.values() if isinstance(v, (int, float))]
        clean["_confidence_avg"]    = round(sum(scores)/len(scores), 2) if scores else None
        return clean

    except Exception as e:
        logger.warning(f"OpenAI extraction failed: {e} – falling back to regex")
        result = extract_with_regex(scraped)
        result["_prompt_system"] = system_prompt or SYSTEM_PROMPT
        result["_prompt_user"]   = _build_prompt(scraped)
        return result


def extract_with_regex(scraped: dict) -> dict:
    """Fallback: regex-based extraction."""
    combined = " ".join([
        scraped.get("impressum_text", ""),
        scraped.get("contact_text", ""),
        scraped.get("homepage_text", ""),
    ])
    rx = regex_extract(combined)

    result = {k: None for k in EXTRACTION_FIELDS}
    result["_extraction_method"] = "regex"

    emails = rx.get("emails", [])
    if emails:
        result["email_general"] = emails[0]
        if len(emails) > 1:
            result["email_contact"] = emails[1]
        for e in emails:
            if "datenschutz" in e or "privacy" in e or "dpo" in e:
                result["email_privacy"] = e

    phones = rx.get("phones", [])
    if phones:
        result["phone"] = phones[0]

    # Social links from scraper
    for link in scraped.get("social_links", []):
        ll = link.lower()
        if "linkedin" in ll:
            result["linkedin"] = link
        elif "xing" in ll:
            result["xing"] = link
        elif "twitter" in ll or "x.com" in ll:
            result["twitter"] = link
        elif "facebook" in ll:
            result["facebook"] = link
        elif "instagram" in ll:
            result["instagram"] = link

    return result


def extract(scraped: dict, api_key: Optional[str] = None,
            system_prompt: Optional[str] = None) -> dict:
    """Main entry point: try OpenAI, fallback to regex."""
    key = api_key or os.getenv("OPENAI_API_KEY")
    if key:
        return extract_with_openai(scraped, api_key=key, system_prompt=system_prompt)
    result = extract_with_regex(scraped)
    result["_prompt_system"] = system_prompt or SYSTEM_PROMPT
    result["_prompt_user"]   = _build_prompt(scraped)
    return result
