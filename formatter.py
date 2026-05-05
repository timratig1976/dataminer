"""
Post-processing: format phone numbers (E.164), derive email patterns.
"""

import re
from typing import Optional


# ── Phone → E.164 ────────────────────────────────────────────────────────────

def format_phone_e164(raw: Optional[str], default_country: str = "DE") -> Optional[str]:
    """Best-effort conversion of a raw phone string to E.164 format."""
    if not raw:
        return None
    # Strip everything except digits and leading +
    digits = re.sub(r"[^\d+]", "", raw.strip())
    if not digits:
        return None

    # Already E.164
    if digits.startswith("+") and len(digits) >= 8:
        return digits

    # Remove leading zeros
    digits = digits.lstrip("0")

    COUNTRY_CODES = {
        "DE": "49",
        "AT": "43",
        "CH": "41",
        "LU": "352",
    }
    cc = COUNTRY_CODES.get(default_country, "49")

    # If starts with country code already
    if digits.startswith(cc):
        return "+" + digits

    return "+" + cc + digits


# ── Email pattern derivation ──────────────────────────────────────────────────

def _clean_name_part(s: str) -> str:
    """Normalize a name part for use in email: lowercase, remove umlauts, strip."""
    s = s.lower().strip()
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def derive_email_patterns(
    managing_director: Optional[str],
    domain: Optional[str],
    existing_email: Optional[str] = None,
) -> dict:
    """
    Given a GF name and domain, derive likely email patterns.
    Also infers separator style (. vs -) from existing email if available.
    Returns dict with keys: email_pattern_guess, email_patterns_all
    """
    if not domain or not managing_director:
        return {"email_pattern_guess": None, "email_patterns_all": None}

    # Extract clean domain (strip scheme, www, path)
    domain_clean = re.sub(r"^https?://", "", domain)
    domain_clean = re.sub(r"^www\.", "", domain_clean)
    domain_clean = domain_clean.split("/")[0].strip()

    if not domain_clean:
        return {"email_pattern_guess": None, "email_patterns_all": None}

    # Parse name: handle "Vorname Nachname", "Nachname, Vorname", multiple names (comma sep)
    names = [n.strip() for n in managing_director.split(",") if n.strip()]
    if not names:
        return {"email_pattern_guess": None, "email_patterns_all": None}

    # Use first name found
    first_person = names[0]
    parts = first_person.split()
    if len(parts) < 2:
        return {"email_pattern_guess": None, "email_patterns_all": None}

    vorname = _clean_name_part(parts[0])
    nachname = _clean_name_part(parts[-1])
    v_initial = vorname[0] if vorname else ""

    # Infer separator from existing email
    sep = "."
    if existing_email:
        local = existing_email.split("@")[0]
        if "-" in local:
            sep = "-"
        elif "." in local:
            sep = "."

    patterns = [
        f"{vorname}{sep}{nachname}@{domain_clean}",
        f"{v_initial}{sep}{nachname}@{domain_clean}",
        f"{nachname}{sep}{vorname}@{domain_clean}",
        f"{v_initial}{nachname}@{domain_clean}",
        f"{vorname}@{domain_clean}",
        f"{nachname}@{domain_clean}",
    ]
    # Deduplicate preserving order
    seen = set()
    unique = []
    for p in patterns:
        if p not in seen:
            seen.add(p)
            unique.append(p)

    return {
        "email_pattern_guess": unique[0],
        "email_patterns_all": " | ".join(unique),
    }


def format_row(row: dict) -> dict:
    """Apply all formatting to a result row in-place."""
    # Phone E.164
    for field in ("phone", "fax"):
        if row.get(field):
            row[field] = format_phone_e164(row[field]) or row[field]

    # Email patterns
    patterns = derive_email_patterns(
        managing_director=row.get("managing_director"),
        domain=row.get("_website_found") or row.get("website"),
        existing_email=row.get("email_general") or row.get("email_contact"),
    )
    row.update(patterns)
    return row
