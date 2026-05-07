"""
Custom prompt-column runner (Clay/Clerk-like).
Each step can write to a target column and can be conditionally executed.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Optional

import requests
import tldextract

logger = logging.getLogger(__name__)


class SafeDict(dict):
    def __missing__(self, key):
        return ""


def _to_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _truthy(value: Any) -> bool:
    s = _to_text(value).lower()
    if s in ("", "0", "false", "none", "null", "nan", "n/a"):
        return False
    return True


def should_run_step(row: dict, step: dict) -> bool:
    if not step.get("enabled", True):
        return False

    source_col = _to_text(step.get("condition_source"))
    op = _to_text(step.get("condition_operator") or "is_truthy").lower()
    expected = _to_text(step.get("condition_value"))

    if not source_col:
        return True

    actual = _to_text(row.get(source_col))
    actual_low = actual.lower()
    expected_low = expected.lower()

    if op == "equals":
        return actual_low == expected_low
    if op == "not_equals":
        return actual_low != expected_low
    if op == "contains":
        return expected_low in actual_low
    if op == "not_contains":
        return expected_low not in actual_low
    if op == "is_empty":
        return not _truthy(actual)
    # default: is_truthy
    return _truthy(actual)


def _skip_reason(row: dict, step: dict) -> str:
    source_col = _to_text(step.get("condition_source"))
    if not source_col:
        return ""
    op = _to_text(step.get("condition_operator") or "is_truthy")
    expected = _to_text(step.get("condition_value"))
    actual = _to_text(row.get(source_col))
    return f"condition_not_met: {source_col} {op} '{expected}' (actual='{actual}')"


def _render_prompt(template: str, row: dict) -> str:
    text = template or ""

    def repl(match: re.Match) -> str:
        key = match.group(1)
        return _to_text(row.get(key))

    # Replace only simple placeholders like {company_name}; keep other braces literal.
    return re.sub(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", repl, text)


def _call_openai(prompt: str, model: str, api_key: str, json_mode: bool) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=api_key, timeout=60.0, max_retries=1)
    params = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a precise data-enrichment assistant."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "max_tokens": 1200,
    }
    if json_mode:
        params["response_format"] = {"type": "json_object"}

    resp = client.chat.completions.create(**params)
    return (resp.choices[0].message.content or "").strip()


def _company_keywords(company_name: str) -> list[str]:
    name = _to_text(company_name).lower()
    for suffix in [
        " gmbh", " ag", " ug", " kg", " ohg", " gbr", " e.v.", " ev",
        " co. kg", " & co", " se", " inc", " ltd", " llc",
    ]:
        name = name.replace(suffix, "")
    words = [w for w in re.split(r"[\s\-&,./]+", name) if len(w) >= 4]
    return words[:6]


def _normalize_domain(value: str) -> str:
    raw = _to_text(value)
    if not raw:
        return ""
    raw = re.sub(r"^https?://", "", raw, flags=re.I)
    raw = raw.split("/")[0].strip().lower()
    ext = tldextract.extract(raw)
    if not ext.domain or not ext.suffix:
        return ""
    return f"{ext.domain}.{ext.suffix}"


def _validate_domain_candidate(domain: str, company_name: str) -> dict:
    normalized = _normalize_domain(domain)
    if not normalized:
        return {
            "domain": "",
            "confidence": "notFound",
            "sourceUrl": "",
            "valid": False,
            "reason": "invalid_domain_format",
            "brandMatch": False,
        }

    urls = [f"https://{normalized}", f"http://{normalized}"]
    response = None
    last_error = ""
    for url in urls:
        try:
            r = requests.get(url, timeout=12, allow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code < 500:
                response = r
                break
        except Exception as e:
            last_error = str(e)

    if response is None:
        return {
            "domain": "",
            "confidence": "notFound",
            "sourceUrl": "",
            "valid": False,
            "reason": f"unreachable:{last_error[:80]}",
            "brandMatch": False,
        }

    html = (response.text or "")[:200000].lower()
    keywords = _company_keywords(company_name)
    hits = sum(1 for kw in keywords if kw in html)
    brand_match = hits >= 1 if keywords else True

    if not brand_match:
        return {
            "domain": "",
            "confidence": "notFound",
            "sourceUrl": str(response.url or ""),
            "valid": False,
            "reason": "brand_mismatch",
            "brandMatch": False,
        }

    return {
        "domain": normalized,
        "confidence": "high",
        "sourceUrl": str(response.url or ""),
        "valid": True,
        "reason": "ok",
        "brandMatch": True,
    }


def run_custom_steps(
    row: dict,
    steps: list[dict],
    api_key: Optional[str],
    log_fn: Optional[Callable[[str], None]] = None,
) -> dict:
    """Run configured custom steps sequentially and return row with updates."""
    if not steps:
        return row

    result = dict(row)

    for idx, step in enumerate(steps):
        name = _to_text(step.get("name") or f"Step {idx + 1}")
        target_col = _to_text(step.get("target_column"))
        if not target_col:
            continue

        if not should_run_step(result, step):
            reason = _skip_reason(result, step)
            result[f"_{target_col}_status"] = "skipped"
            result[f"_{target_col}_skip_reason"] = reason
            if log_fn:
                log_fn(f"Custom-Step SKIP: {name} → {target_col} | {reason}")
            continue

        overwrite = bool(step.get("overwrite", False))
        if not overwrite and _truthy(result.get(target_col)):
            reason = f"target_not_empty: {target_col}"
            result[f"_{target_col}_status"] = "skipped"
            result[f"_{target_col}_skip_reason"] = reason
            if log_fn:
                log_fn(f"Custom-Step SKIP: {name} → {target_col} | {reason}")
            continue

        prompt_template = _to_text(step.get("prompt"))
        if not prompt_template:
            reason = "missing_prompt"
            result[f"_{target_col}_status"] = "skipped"
            result[f"_{target_col}_skip_reason"] = reason
            if log_fn:
                log_fn(f"Custom-Step SKIP: {name} → {target_col} | {reason}")
            continue

        if not api_key:
            result[f"_{target_col}_status"] = "error"
            result[f"_{target_col}_error"] = "No OpenAI API key"
            if log_fn:
                log_fn(f"Custom-Step ERROR: {name} → {target_col} | no_api_key")
            continue

        model = _to_text(step.get("model") or "gpt-4o-mini")
        output_mode = _to_text(step.get("output_mode") or "text").lower()
        output_key = _to_text(step.get("output_key"))

        result[f"_{target_col}_status"] = "running"
        result[f"_{target_col}_skip_reason"] = ""
        result[f"_{target_col}_error"] = ""

        # Deterministic validator step (no LLM call)
        if target_col == "official_domain_validated":
            source_domain = _to_text(result.get("official_domain") or result.get("Domain"))
            validation = _validate_domain_candidate(source_domain, _to_text(result.get("company_name")))
            result[target_col] = validation.get("domain", "")
            result[f"_{target_col}_raw"] = json.dumps(validation, ensure_ascii=False)
            result[f"_{target_col}_status"] = "ok" if validation.get("valid") else "skipped"
            result[f"_{target_col}_skip_reason"] = "" if validation.get("valid") else validation.get("reason", "validation_failed")
            result[f"_{target_col}_model"] = "deterministic_validator"
            result[f"_{target_col}_step"] = name
            if log_fn:
                log_fn(f"Custom-Step VALIDATOR ({target_col}): {result[f'_{target_col}_raw'][:700]}")
            continue

        prompt = _render_prompt(prompt_template, result)
        result[f"_{target_col}_prompt"] = prompt

        try:
            if log_fn:
                log_fn(f"Custom-Step: {name} → {target_col}")
                log_fn(f"Custom-Step PROMPT ({target_col}): {prompt[:700]}")

            raw = _call_openai(
                prompt=prompt,
                model=model,
                api_key=api_key,
                json_mode=(output_mode == "json"),
            )

            if output_mode == "json":
                parsed = json.loads(raw) if raw else {}
                if output_key:
                    value = parsed.get(output_key)
                elif target_col in parsed:
                    value = parsed.get(target_col)
                else:
                    value = raw
            else:
                value = raw

            result[target_col] = value
            result[f"_{target_col}_model"] = model
            result[f"_{target_col}_step"] = name
            result[f"_{target_col}_raw"] = raw
            result[f"_{target_col}_status"] = "ok"
            result[f"_{target_col}_skip_reason"] = ""

            if log_fn:
                log_fn(f"Custom-Step RAW ({target_col}): {raw[:700]}")
                log_fn(f"Custom-Step RESULT ({target_col}): {str(value)[:300]}")

        except Exception as e:
            logger.warning(f"Custom step failed ({name}): {e}")
            result[f"_{target_col}_status"] = "error"
            result[f"_{target_col}_error"] = str(e)
            if log_fn:
                log_fn(f"Custom-Step ERROR: {name} → {target_col} | {e}")

    return result
