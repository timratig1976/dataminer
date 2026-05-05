"""
Data validation: automatic field-level checks + duplicate detection.
Returns _validation dict with per-field issues and an overall quality score.
"""

import re
from typing import Optional
from urllib.parse import urlparse


# ── Field validators ──────────────────────────────────────────────────────────

def _check_email(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', value.strip()):
        return "Ungültiges Email-Format"
    return None


def _check_phone(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    digits = re.sub(r'\D', '', value)
    if len(digits) < 6:
        return "Zu kurz"
    if not value.startswith('+'):
        return "Kein E.164-Prefix (+)"
    return None


def _check_url(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = urlparse(value)
        if parsed.scheme not in ('http', 'https'):
            return "Kein http/https Schema"
        if not parsed.netloc:
            return "Keine Domain"
    except Exception:
        return "Ungültige URL"
    return None


def _check_domain_match(email: Optional[str], website: Optional[str]) -> Optional[str]:
    """Check if email domain matches the company website domain."""
    if not email or not website:
        return None
    try:
        email_domain = email.split('@')[-1].lower().strip()
        site_domain  = urlparse(website).netloc.lower().replace('www.', '')
        if email_domain and site_domain and email_domain != site_domain:
            return f"Email-Domain '{email_domain}' ≠ Website '{site_domain}'"
    except Exception:
        pass
    return None


def _check_vat(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    # German VAT: DE + 9 digits
    if re.match(r'^DE\d{9}$', value.strip().upper()):
        return None
    return "Format erwartet: DE123456789"


def _check_zip(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    clean = value.strip()
    if re.match(r'^\d{5}$', clean):
        return None
    if re.match(r'^\d{4,6}$', clean):
        return None
    return "Ungewöhnliches PLZ-Format"


FIELD_VALIDATORS = {
    "email_general":         _check_email,
    "email_contact":         _check_email,
    "email_privacy":         _check_email,
    "phone":                 _check_phone,
    "fax":                   _check_phone,
    "linkedin":              _check_url,
    "xing":                  _check_url,
    "twitter":               _check_url,
    "facebook":              _check_url,
    "instagram":             _check_url,
    "vat_id":                _check_vat,
    "zip":                   _check_zip,
}


def validate_row(row: dict) -> dict:
    """
    Run all validators on a result row.
    Returns dict with:
      _validation: {field: error_msg}  – empty = all OK
      _quality_score: 0–100
      _quality_flags: list of human-readable issues
    """
    issues = {}

    # Per-field validators
    for field, validator in FIELD_VALIDATORS.items():
        val = row.get(field)
        if val and str(val) not in ('None', 'nan', ''):
            err = validator(str(val))
            if err:
                issues[field] = err

    # Cross-field: email domain vs website
    website = row.get('_website_found') or row.get('website')
    for email_field in ('email_general', 'email_contact'):
        email_val = row.get(email_field)
        if email_val and str(email_val) not in ('None', 'nan', ''):
            err = _check_domain_match(str(email_val), website)
            if err:
                issues[f"{email_field}_domain"] = err

    # Quality score: based on filled key fields
    key_fields = [
        'email_general', 'phone', 'managing_director',
        'street', 'city', 'zip', 'website',
    ]
    bonus_fields = [
        'legal_form', 'register_number', 'vat_id',
        'linkedin', 'email_privacy',
    ]
    filled_key   = sum(1 for f in key_fields   if row.get(f) and str(row.get(f)) not in ('None','nan',''))
    filled_bonus = sum(1 for f in bonus_fields if row.get(f) and str(row.get(f)) not in ('None','nan',''))
    penalty      = len([k for k in issues if not k.endswith('_domain')])

    base_score = int((filled_key / len(key_fields)) * 70)
    bonus_score = int((filled_bonus / len(bonus_fields)) * 20)
    penalty_score = min(30, penalty * 10)
    score = max(0, min(100, base_score + bonus_score - penalty_score))

    flags = []
    for field, msg in issues.items():
        label = field.replace('_domain', ' Domain').replace('_', ' ').title()
        flags.append(f"{label}: {msg}")

    return {
        '_validation':    issues,
        '_quality_score': score,
        '_quality_flags': flags,
    }


def check_duplicates(all_rows: list[dict]) -> list[dict]:
    """
    Mark duplicate rows (same email or same website).
    Adds _duplicate: True/False to each row.
    """
    seen_emails   = {}
    seen_websites = {}

    for i, row in enumerate(all_rows):
        row['_duplicate'] = False

        email = row.get('email_general') or row.get('email_contact')
        if email and str(email) not in ('None', 'nan', ''):
            email = str(email).lower().strip()
            if email in seen_emails:
                row['_duplicate'] = True
                all_rows[seen_emails[email]]['_duplicate'] = True
            else:
                seen_emails[email] = i

        website = row.get('_website_found') or row.get('website')
        if website and str(website) not in ('None', 'nan', ''):
            website = str(website).lower().strip().rstrip('/')
            if website in seen_websites:
                row['_duplicate'] = True
                all_rows[seen_websites[website]]['_duplicate'] = True
            else:
                seen_websites[website] = i

    return all_rows
