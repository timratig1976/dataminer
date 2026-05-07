"""
DataMiner – Multi-Case Streamlit Web-UI
Each case has its own input, output, logs and settings.
"""

import io
import json
import os
import re
import time
import logging
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from pathlib import Path

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from input_handler import load_file, normalize, detect_columns
from pipeline import enrich_row
from custom_steps import run_custom_steps
from extractor import EXTRACTION_FIELDS, SYSTEM_PROMPT
from case_manager import (
    create_case, list_cases, get_case, delete_case,
    save_input, save_rows, load_rows, save_output,
    append_log, read_log, get_output_csv, get_input_csv,
    update_settings, get_settings, update_meta, STATUS_EMOJI,
)

load_dotenv()
logging.basicConfig(level=logging.INFO)

PROMPT_PRESETS_FILE = Path("ai_column_presets.json")


def _default_prompt_presets() -> list[dict]:
    return [
        {
            "enabled": True,
            "name": "Official Domain",
            "target_column": "official_domain",
            "model": "gpt-4o-mini",
            "output_mode": "json",
            "output_key": "domain",
            "overwrite": False,
            "condition_source": "company_name",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": (
                "Find the official primary domain for company '{company_name}'. "
                "If not clearly verifiable from authoritative sources, return notFound with empty domain. "
                "Return strict JSON only: {\"domain\":\"\",\"confidence\":\"high|medium|low|notFound\",\"sourceUrl\":\"\"}."
            ),
        },
        {
            "enabled": True,
            "name": "Domain Confidence",
            "target_column": "domain_confidence",
            "model": "gpt-4o-mini",
            "output_mode": "json",
            "output_key": "confidence",
            "overwrite": False,
            "condition_source": "company_name",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": (
                "Find the official primary domain for company '{company_name}'. "
                "If not clearly verifiable from authoritative sources, return notFound with empty domain. "
                "Return strict JSON only: {\"domain\":\"\",\"confidence\":\"high|medium|low|notFound\",\"sourceUrl\":\"\"}."
            ),
        },
        {
            "enabled": True,
            "name": "Domain Source URL",
            "target_column": "domain_source_url",
            "model": "gpt-4o-mini",
            "output_mode": "json",
            "output_key": "sourceUrl",
            "overwrite": False,
            "condition_source": "company_name",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": (
                "Find the official primary domain for company '{company_name}'. "
                "If not clearly verifiable from authoritative sources, return notFound with empty domain. "
                "Return strict JSON only: {\"domain\":\"\",\"confidence\":\"high|medium|low|notFound\",\"sourceUrl\":\"\"}."
            ),
        },
        {
            "enabled": True,
            "name": "Official Domain Validated",
            "target_column": "official_domain_validated",
            "model": "validator",
            "output_mode": "text",
            "output_key": "",
            "overwrite": False,
            "condition_source": "official_domain",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": "Deterministic validator step: validate official_domain via HTTP reachability + basic company-name match.",
        },
        {
            "enabled": True,
            "name": "Website TLD",
            "target_column": "website_tld",
            "model": "gpt-4o-mini",
            "output_mode": "text",
            "output_key": "",
            "overwrite": False,
            "condition_source": "official_domain",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": "Extract only registrable domain from '{official_domain}'. Return only the domain like example.com.",
        },
        {
            "enabled": True,
            "name": "Industry Keywords",
            "target_column": "industry_keywords",
            "model": "gpt-4o-mini",
            "output_mode": "json",
            "output_key": "keywords",
            "overwrite": False,
            "condition_source": "official_domain",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": (
                "From company website/domain '{official_domain}' and company '{company_name}', "
                "extract industry keywords. Return JSON: {\"keywords\":[\"...\"]}."
            ),
        },
        {
            "enabled": True,
            "name": "Decision Makers JSON",
            "target_column": "decision_makers_json",
            "model": "gpt-4o-mini",
            "output_mode": "json",
            "output_key": "contacts",
            "overwrite": False,
            "condition_source": "official_domain",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": (
                "For company domain '{official_domain}' and company '{company_name}', find key decision makers "
                "(owner, managing director, head of sales/marketing/operations) and return JSON with key 'contacts'."
            ),
        },
        {
            "enabled": True,
            "name": "Social Profiles JSON",
            "target_column": "social_profiles_json",
            "model": "gpt-4o-mini",
            "output_mode": "json",
            "output_key": "",
            "overwrite": False,
            "condition_source": "decision_makers_json",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": (
                "Using company '{company_name}', domain '{official_domain}', and contacts '{decision_makers_json}', "
                "find personal profile URLs for LinkedIn, Xing, X, Instagram, Facebook. Return full JSON object."
            ),
        },
        {
            "enabled": True,
            "name": "Background Check JSON",
            "target_column": "background_check_json",
            "model": "gpt-4o-mini",
            "output_mode": "json",
            "output_key": "",
            "overwrite": False,
            "condition_source": "official_domain",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": (
                "Build an ultra-personalized outreach profile for contact and company '{company_name}' "
                "based on public mentions and social signals. Include source URLs and return full JSON object."
            ),
        },
    ]


def _normalize_step(step: dict) -> dict:
    return {
        "enabled": bool(step.get("enabled", True)),
        "name": str(step.get("name", "")).strip(),
        "target_column": str(step.get("target_column", "")).strip(),
        "model": str(step.get("model", "gpt-4o-mini")).strip() or "gpt-4o-mini",
        "output_mode": str(step.get("output_mode", "text")).strip() or "text",
        "output_key": str(step.get("output_key", "")).strip(),
        "overwrite": bool(step.get("overwrite", False)),
        "condition_source": str(step.get("condition_source", "")).strip(),
        "condition_operator": str(step.get("condition_operator", "is_truthy")).strip() or "is_truthy",
        "condition_value": str(step.get("condition_value", "")).strip(),
        "prompt": str(step.get("prompt", "")),
    }


def _load_prompt_presets() -> list[dict]:
    defaults = [_normalize_step(s) for s in _default_prompt_presets()]

    if not PROMPT_PRESETS_FILE.exists():
        _save_prompt_presets(defaults)
        return defaults

    try:
        data = json.loads(PROMPT_PRESETS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            loaded = [_normalize_step(s) for s in data if isinstance(s, dict)]

            # Migration: ensure all documented standard presets exist
            existing_targets = {
                str(s.get("target_column") or "").strip()
                for s in loaded
            }
            missing = [
                d for d in defaults
                if str(d.get("target_column") or "").strip() not in existing_targets
            ]
            if missing:
                merged = loaded + missing
                _save_prompt_presets(merged)
                return merged

            return loaded
    except Exception:
        _save_prompt_presets(defaults)
        return defaults

    _save_prompt_presets(defaults)
    return defaults


def _save_prompt_presets(steps: list[dict]):
    clean = [_normalize_step(s) for s in steps if isinstance(s, dict)]
    PROMPT_PRESETS_FILE.write_text(
        json.dumps(clean, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _dedupe_target_column(step: dict, existing_steps: list[dict]) -> dict:
    out = deepcopy(step)
    base_target = str(out.get("target_column") or "").strip() or "custom_col"
    existing_targets = {
        str(s.get("target_column") or "").strip()
        for s in existing_steps
    }
    if base_target not in existing_targets:
        out["target_column"] = base_target
        return out

    i = 2
    while f"{base_target}_{i}" in existing_targets:
        i += 1
    out["target_column"] = f"{base_target}_{i}"
    if not str(out.get("name") or "").strip():
        out["name"] = out["target_column"]
    return out


def _add_missing_standard_steps(existing_steps: list[dict], presets: list[dict]) -> tuple[list[dict], int]:
    """Add only missing standard steps by target_column (no duplicates)."""
    updated = list(existing_steps or [])
    existing_targets = {
        str(s.get("target_column") or "").strip()
        for s in updated
    }
    added = 0
    for preset in presets or []:
        normalized = _normalize_step(preset)
        target = str(normalized.get("target_column") or "").strip()
        if not target or target in existing_targets:
            continue
        updated.append(normalized)
        existing_targets.add(target)
        added += 1
    return updated, added

# ── Page config ───────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="DataMiner",
    page_icon="🔍",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Custom CSS ────────────────────────────────────────────────────────────────
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    html, body, [class*="css"], .stApp {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background-color: #f5f6f8;
        color: #1a1a2e;
    }
    .page-title {
        font-size: 1.4rem;
        font-weight: 700;
        color: #1a1a2e;
        margin-bottom: 0.1rem;
    }
    .page-sub { font-size: 0.85rem; color: #666; margin-bottom: 1.2rem; }

    /* Clay-style table */
    .clay-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .clay-table th {
        background: #f0f2f5;
        color: #555;
        font-weight: 600;
        text-transform: uppercase;
        font-size: 0.72rem;
        letter-spacing: 0.04em;
        padding: 6px 10px;
        border-bottom: 1px solid #e2e8f0;
        white-space: nowrap;
    }
    .clay-table td {
        padding: 7px 10px;
        border-bottom: 1px solid #f0f2f5;
        vertical-align: middle;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .clay-table tr:hover td { background: #f8f9ff; }
    .clay-table tr.processing td { background: #fffbeb; }

    /* Status badges */
    .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 0.72rem;
        font-weight: 600;
        white-space: nowrap;
    }
    .badge-pending   { background: #f0f2f5; color: #888; }
    .badge-running   { background: #fef3c7; color: #92400e; }
    .badge-success   { background: #d1fae5; color: #065f46; }
    .badge-error     { background: #fee2e2; color: #991b1b; }
    .badge-no_website{ background: #e0e7ff; color: #3730a3; }

    /* Strategy pill */
    .strat { font-size: 0.7rem; color: #888; }
    .strat-provided_url { color: #2563eb; }
    .strat-domain_guess { color: #059669; }
    .strat-duckduckgo   { color: #d97706; }
    .strat-bing         { color: #7c3aed; }

    /* Scraped page chips */
    .chip {
        display: inline-block;
        background: #e0f2fe;
        color: #0369a1;
        border-radius: 4px;
        padding: 1px 5px;
        font-size: 0.67rem;
        margin-right: 2px;
    }

    div[data-testid="stSidebarContent"] {
        background-color: #fff;
        border-right: 1px solid #e2e8f0;
    }
    .stButton > button { border-radius: 6px; font-weight: 500; }
    .stTabs [data-baseweb="tab"] { font-size: 0.88rem; font-weight: 500; }

    .stat-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 0.8rem 1rem;
        text-align: center;
    }
    .stat-card .number { font-size: 1.6rem; font-weight: 700; color: #1a1a2e; }
    .stat-card .label  { font-size: 0.75rem; color: #888; margin-top: 0.1rem; }
</style>
""", unsafe_allow_html=True)

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown('<div class="page-title">🔍 DataMiner</div>', unsafe_allow_html=True)
st.markdown('<div class="page-sub">Unternehmens-Datenanreicherung via Web-Scraping & KI · Zeile für Zeile</div>', unsafe_allow_html=True)

# ── Session state init ────────────────────────────────────────────────────────
if "active_case_id" not in st.session_state:
    st.session_state["active_case_id"] = None
if "running" not in st.session_state:
    st.session_state["running"] = False
if "stop_requested" not in st.session_state:
    st.session_state["stop_requested"] = False
if "selected_rows" not in st.session_state:
    st.session_state["selected_rows"] = set()
if "run_single_idx" not in st.session_state:
    st.session_state["run_single_idx"] = None


# ════════════════════════════════════════════════════════════════════════════
# Helper: render the live Clay-style table
# ════════════════════════════════════════════════════════════════════════════
STRATEGY_LABELS = {
    "provided_url": ("🔗", "URL"),
    "domain_guess": ("💡", "Domain-Guess"),
    "startpage":    ("🔍", "Startpage"),
    "duckduckgo":   ("🦆", "DuckDuckGo"),
    "bing":         ("🔵", "Bing"),
    None:           ("", "—"),
}
ROW_STATUS_LABELS = {
    "pending":    ("badge-pending",    "Ausstehend"),
    "running":    ("badge-running",    "⏳ Läuft…"),
    "success":    ("badge-success",    "✓ Fertig"),
    "error":      ("badge-error",      "✗ Fehler"),
    "no_website": ("badge-no_website", "Keine Website"),
}

def _v(row, key):
    v = row.get(key)
    return str(v) if v and str(v) not in ("None", "nan", "") else ""


def _row_base(row: dict) -> dict:
    """Keep source columns when resetting rows."""
    base = {
        "company_name": row.get("company_name", ""),
        "input_url": row.get("input_url", ""),
    }
    for k, v in row.items():
        if str(k).startswith("original_"):
            base[k] = v
    return base

def render_table(rows: list, placeholder, selected: set = None, start_idx: int = 0, editable: bool = True):
    """Live HTML table. start_idx = global offset of first row for action links."""
    if not rows:
        return
    if selected is None:
        selected = set()
    header_cols = ["#", "Firma", "Status", "Qualität", "Website", "Strategie",
                   "Email", "Telefon", "Mobil", "Geschäftsführer",
                   "Straße", "PLZ", "Ort", "Branche", "Aktionen"]
    th = "".join(f"<th>{c}</th>" for c in header_cols)
    trs = []
    for i, row in enumerate(rows):
        status = row.get("_status", "pending")
        badge_cls, badge_label = ROW_STATUS_LABELS.get(status, ("badge-pending", status))
        row_cls = "processing" if status == "running" else ""
        strategy = row.get("_search_strategy")
        strat_icon, strat_label = STRATEGY_LABELS.get(strategy, ("", strategy or "—"))
        strat_cls = f"strat-{strategy}" if strategy else "strat"
        scraped = row.get("_scraped_pages", "")
        chips = "".join(
            f'<span class="chip">{p.strip()}</span>'
            for p in str(scraped).split(",")
            if p.strip() and p.strip() != "—"
        ) or '<span style="color:#ccc">—</span>'
        website = _v(row, "_website_found")
        website_html = (
            f'<a href="{website}" target="_blank" style="color:#2563eb;text-decoration:none">'
            f'{website.replace("https://","").replace("http://","")}</a>'
            if website else '<span style="color:#ccc">—</span>'
        )
        email   = _v(row, "email_general") or _v(row, "email_contact")
        phone   = _v(row, "phone")
        mobile  = _v(row, "mobile")
        gf      = _v(row, "managing_director")
        street  = _v(row, "street")
        plz     = _v(row, "zip")
        city    = _v(row, "city")
        industry= _v(row, "industry")
        score   = row.get("_quality_score")
        flags   = row.get("_quality_flags") or []
        if score is None:
            score_html = '<span style="color:#ccc">—</span>'
        elif score >= 70:
            score_html = f'<span style="background:#dcfce7;color:#166534;padding:1px 6px;border-radius:10px;font-size:0.75rem;font-weight:600">{score}%</span>'
        elif score >= 40:
            score_html = f'<span style="background:#fef9c3;color:#854d0e;padding:1px 6px;border-radius:10px;font-size:0.75rem;font-weight:600">{score}%</span>'
        else:
            score_html = f'<span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:10px;font-size:0.75rem;font-weight:600">{score}%</span>'
        err_html = (
            f'<br><small style="color:#991b1b">{str(row.get("_error",""))[:80]}</small>'
            if status == "error" else ""
        )
        dup_html = ' <span style="background:#fde68a;color:#92400e;padding:0 4px;border-radius:4px;font-size:0.7rem">DUP</span>' \
            if row.get("_duplicate") else ""
        global_i = start_idx + i
        actions_html = f'<span style="color:#aaa;font-size:0.72rem">#{global_i+1}</span>'
        trs.append(f"""
        <tr class="{row_cls}">
            <td style="color:#aaa;font-size:0.75rem">{global_i+1}</td>
            <td><strong>{row.get("company_name","")}</strong>{dup_html}{err_html}</td>
            <td><span class="badge {badge_cls}">{badge_label}</span></td>
            <td>{score_html}</td>
            <td>{website_html}</td>
            <td><span class="strat {strat_cls}">{strat_icon} {strat_label}</span></td>
            <td>{email or '<span style="color:#ccc">—</span>'}</td>
            <td style="font-family:monospace;font-size:0.78rem">{phone or '<span style="color:#ccc">—</span>'}</td>
            <td style="font-family:monospace;font-size:0.78rem">{mobile or '<span style="color:#ccc">—</span>'}</td>
            <td>{gf or '<span style="color:#ccc">—</span>'}</td>
            <td style="font-size:0.78rem">{street or '<span style="color:#ccc">—</span>'}</td>
            <td style="font-size:0.78rem">{plz or '<span style="color:#ccc">—</span>'}</td>
            <td>{city or '<span style="color:#ccc">—</span>'}</td>
            <td style="font-size:0.78rem;color:#6366f1">{industry or '<span style="color:#ccc">—</span>'}</td>
            <td style="white-space:nowrap">{actions_html}</td>
        </tr>""")
    html = f"""
    <div style="overflow-x:auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px">
        <table class="clay-table"><thead><tr>{th}</tr></thead>
        <tbody>{"".join(trs)}</tbody></table>
    </div>"""
    placeholder.markdown(html, unsafe_allow_html=True)


def render_editor(rows: list, active_id: str) -> set:
    """Interactive st.data_editor table with checkbox column + pagination. Returns selected indices."""
    import pandas as pd
    STATUS_MAP = {"pending":"○ Ausstehend","running":"⏳ Läuft","success":"✓ Fertig",
                  "error":"✗ Fehler","no_website":"∅ Keine Website"}
    STRAT_MAP  = {"provided_url":"🔗 URL","domain_guess":"💡 Domain",
                  "startpage":"🔍 Startpage","bing":"🔵 Bing",None:""}

    # ── Pagination state ────────────────────────────────────────────
    page_key     = f"page_{active_id}"
    pagesize_key = f"pagesize_{active_id}"
    if page_key     not in st.session_state: st.session_state[page_key]     = 0
    if pagesize_key not in st.session_state: st.session_state[pagesize_key] = 50

    total_rows = len(rows)
    page_size  = st.session_state[pagesize_key]
    total_pages = max(1, (total_rows + page_size - 1) // page_size)
    page        = min(st.session_state[page_key], total_pages - 1)
    st.session_state[page_key] = page

    start = page * page_size
    end   = min(start + page_size, total_rows)
    page_rows = rows[start:end]

    # ── Pagination controls ─────────────────────────────────────────
    pc1, pc2, pc3, pc4, pc5 = st.columns([0.7, 0.7, 1.2, 2.5, 1.2])
    with pc1:
        if st.button("« Zurück", key=f"pg_prev_{active_id}", disabled=page == 0,
                     use_container_width=True):
            st.session_state[page_key] = page - 1
            st.rerun()
    with pc2:
        if st.button("Weiter »", key=f"pg_next_{active_id}",
                     disabled=page >= total_pages - 1, use_container_width=True):
            st.session_state[page_key] = page + 1
            st.rerun()
    with pc3:
        jumped = st.number_input(
            "Seite", min_value=1, max_value=max(total_pages, 1),
            value=page + 1, step=1,
            key=f"pg_num_{active_id}",
            label_visibility="collapsed",
        )
        if int(jumped) - 1 != page:
            st.session_state[page_key] = int(jumped) - 1
            st.rerun()
    with pc4:
        st.caption(f"Seite {page+1} / {total_pages}  ·  Zeilen {start+1}–{end} von {total_rows}")
    with pc5:
        new_ps = st.selectbox(
            "Zeilen/Seite", [25, 50, 100, 200],
            index=[25, 50, 100, 200].index(page_size) if page_size in [25, 50, 100, 200] else 1,
            key=f"pssel_{active_id}",
        )
        if new_ps != page_size:
            st.session_state[pagesize_key] = new_ps
            st.session_state[page_key] = 0
            st.rerun()
    # ── Build DataFrame for current page only ──────────────────────
    selected_global = st.session_state.get("selected_rows", set())
    df = pd.DataFrame([
        {
            "☑":            (start + i) in selected_global,
            "#":            start + i + 1,
            "Firma":        r.get("company_name", ""),
            "Status":       STATUS_MAP.get(r.get("_status"), r.get("_status", "")),
            "Website":      _v(r, "_website_found") or "",
            "Strategie":    STRAT_MAP.get(r.get("_search_strategy"), r.get("_search_strategy") or ""),
            "Gecrawlt":     _v(r, "_scraped_pages"),
            "Methode":      _v(r, "_extraction_method"),
            "Email":        _v(r, "email_general") or _v(r, "email_contact"),
            "Email (Kont.)":_v(r, "email_contact"),
            "Email (DSB)":  _v(r, "email_privacy"),
            "Telefon":      _v(r, "phone"),
            "Mobil":        _v(r, "mobile"),
            "Fax":          _v(r, "fax"),
            "GF":           _v(r, "managing_director"),
            "Straße":       _v(r, "street"),
            "PLZ":          _v(r, "zip"),
            "Ort":          _v(r, "city"),
            "Bundesland":   _v(r, "state"),
            "Land":         _v(r, "country"),
            "Branche":      _v(r, "industry"),
            "Beschreibung": _v(r, "description"),
            "Rechtsform":   _v(r, "legal_form"),
            "HRB":          _v(r, "register_number"),
            "Amtsgericht":  _v(r, "register_court"),
            "USt-IdNr.":    _v(r, "vat_id"),
            "Email-Muster": _v(r, "email_pattern_guess"),
            "LinkedIn":     _v(r, "linkedin"),
            "Xing":         _v(r, "xing"),
            "Twitter":      _v(r, "twitter"),
            "Facebook":     _v(r, "facebook"),
            "Instagram":    _v(r, "instagram"),
            "DSB":          _v(r, "privacy_officer"),
            "DSB Kontakt":  _v(r, "privacy_officer_contact"),
            "LI Firma":     _v(r, "_deep_linkedin_company") or _v(r, "linkedin"),
            "LI GF":        _v(r, "_deep_linkedin_persons"),
            "Xing GF":      _v(r, "_deep_xing_persons"),
            "Handelsreg.":  _v(r, "_deep_handelsregister"),
            "Alt. URLs":    _v(r, "_deep_alternative_urls"),
            "Fehler":       _v(r, "_error"),
            "Qualität %":   r.get("_quality_score"),
            "Konfidenz":    r.get("_confidence_avg"),
            "Validierung":  " | ".join(r.get("_quality_flags") or [])[:120],
            "Duplikat":     r.get("_duplicate", False),
        }
        for i, r in enumerate(page_rows)
    ])
    disabled_cols = [c for c in df.columns if c != "☑"]
    edited = st.data_editor(
        df,
        column_config={
            "☑":             st.column_config.CheckboxColumn("☑", width="small"),
            "#":             st.column_config.NumberColumn("#", width="small"),
            "Firma":         st.column_config.TextColumn("Firma", width="large"),
            "Status":        st.column_config.TextColumn("Status", width="medium"),
            "Website":       st.column_config.LinkColumn("Website", width="medium", display_text=r"https?://(?:www\.)?(.+)"),
            "Strategie":     st.column_config.TextColumn("Strategie", width="small"),
            "Gecrawlt":      st.column_config.TextColumn("Gecrawlt", width="medium"),
            "Methode":       st.column_config.TextColumn("Methode", width="small"),
            "Email":         st.column_config.TextColumn("Email", width="medium"),
            "Email (Kont.)": st.column_config.TextColumn("Email Kontakt", width="medium"),
            "Email (DSB)":   st.column_config.TextColumn("Email DSB", width="medium"),
            "Telefon":       st.column_config.TextColumn("Telefon", width="small"),
            "Mobil":         st.column_config.TextColumn("Mobil", width="small"),
            "Fax":           st.column_config.TextColumn("Fax", width="small"),
            "GF":            st.column_config.TextColumn("Geschäftsführer", width="medium"),
            "Straße":        st.column_config.TextColumn("Straße", width="medium"),
            "PLZ":           st.column_config.TextColumn("PLZ", width="small"),
            "Ort":           st.column_config.TextColumn("Ort", width="small"),
            "Bundesland":    st.column_config.TextColumn("Bundesland", width="small"),
            "Land":          st.column_config.TextColumn("Land", width="small"),
            "Branche":       st.column_config.TextColumn("Branche", width="medium"),
            "Beschreibung":  st.column_config.TextColumn("Beschreibung", width="large"),
            "Rechtsform":    st.column_config.TextColumn("Rechtsform", width="small"),
            "HRB":           st.column_config.TextColumn("HRB", width="small"),
            "Amtsgericht":   st.column_config.TextColumn("Amtsgericht", width="medium"),
            "USt-IdNr.":     st.column_config.TextColumn("USt-IdNr.", width="small"),
            "Email-Muster":  st.column_config.TextColumn("Email-Muster", width="medium"),
            "LinkedIn":      st.column_config.LinkColumn("LinkedIn", width="small", display_text="🔗"),
            "Xing":          st.column_config.LinkColumn("Xing", width="small", display_text="🔗"),
            "Twitter":       st.column_config.LinkColumn("Twitter", width="small", display_text="🔗"),
            "Facebook":      st.column_config.LinkColumn("Facebook", width="small", display_text="🔗"),
            "Instagram":     st.column_config.LinkColumn("Instagram", width="small", display_text="🔗"),
            "DSB":           st.column_config.TextColumn("Datenschutzb.", width="medium"),
            "DSB Kontakt":   st.column_config.TextColumn("DSB Kontakt", width="medium"),
            "LI Firma":      st.column_config.LinkColumn("LI Firma", width="small", display_text="🔗"),
            "LI GF":         st.column_config.TextColumn("LinkedIn GF", width="medium"),
            "Xing GF":       st.column_config.TextColumn("Xing GF", width="medium"),
            "Handelsreg.":   st.column_config.LinkColumn("Handelsreg.", width="small", display_text="🔗"),
            "Alt. URLs":     st.column_config.TextColumn("Alt. URLs", width="medium"),
            "Fehler":        st.column_config.TextColumn("Fehler", width="medium"),
            "Qualität %":    st.column_config.ProgressColumn("Qualität", width="small", min_value=0, max_value=100),
            "Konfidenz":     st.column_config.ProgressColumn("Konfidenz KI", width="small", min_value=0, max_value=1),
            "Validierung":   st.column_config.TextColumn("Validierung", width="large"),
            "Duplikat":      st.column_config.CheckboxColumn("Duplikat", width="small"),
        },
        disabled=disabled_cols,
        use_container_width=True,
        hide_index=True,
        height=80 + len(page_rows) * 36,
        key=f"editor_{active_id}_{page}",
    )
    # Map page-local checked rows back to global indices
    checked_local  = set(edited.index[edited["☑"]].tolist())
    unchecked_local = set(range(len(page_rows))) - checked_local
    new_selected = set(selected_global)
    for local_i in checked_local:
        new_selected.add(start + local_i)
    for local_i in unchecked_local:
        new_selected.discard(start + local_i)
    return new_selected


def _priority_df(rows):
    result_df = pd.DataFrame(rows)
    priority_cols = [
        "company_name", "input_url", "_status", "_website_found",
        "_search_strategy", "_scraped_pages", "_extraction_method",
        "email_general", "email_contact", "email_pattern_guess", "email_patterns_all",
        "phone", "fax", "managing_director", "street", "zip", "city", "country",
        "privacy_officer", "privacy_officer_contact", "email_privacy",
        "linkedin", "xing", "twitter", "facebook", "instagram",
        "legal_form", "register_court", "register_number", "vat_id",
    ]
    existing = [c for c in priority_cols if c in result_df.columns]
    rest = [c for c in result_df.columns if c not in existing]
    return result_df[existing + rest]


# ════════════════════════════════════════════════════════════════════════════
# SIDEBAR – Case list + new case creation
# ════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    st.markdown("### 📁 Cases")

    # New case button
    with st.expander("➕ Neuer Case", expanded=False):
        new_name = st.text_input("Case-Name", placeholder="z.B. Kunde Müller GmbH – Mai 2026")
        new_key  = st.text_input("OpenAI API Key", type="password",
                                 value=os.getenv("OPENAI_API_KEY", ""),
                                 help="Pro Case speicherbar")
        if st.button("Case erstellen", type="primary", use_container_width=True):
            if new_name.strip():
                cid = create_case(new_name.strip(), {"api_key": new_key})
                st.session_state["active_case_id"] = cid
                st.rerun()
            else:
                st.error("Bitte einen Namen eingeben.")

    st.divider()

    cases = list_cases()
    if not cases:
        st.caption("Noch keine Cases vorhanden.")
    else:
        for c in cases:
            emoji = STATUS_EMOJI.get(c.get("status", "new"), "📋")
            done  = c.get("done_rows", 0)
            total = c.get("total_rows", 0)
            label = f"{emoji} {c['name']}"
            sublabel = f"{done}/{total} Zeilen · {c.get('updated_at','')[:10]}"
            is_active = st.session_state["active_case_id"] == c["id"]

            btn_style = "primary" if is_active else "secondary"
            if st.button(label, key=f"case_{c['id']}", use_container_width=True, type=btn_style):
                st.session_state["active_case_id"] = c["id"]
                st.session_state["running"] = False
                st.rerun()
            st.caption(sublabel)

    st.divider()
    # Global API key fallback
    global_key = st.text_input("🔑 Globaler API Key (Fallback)",
                               value=os.getenv("OPENAI_API_KEY", ""),
                               type="password", key="global_api_key")


# ════════════════════════════════════════════════════════════════════════════
# MAIN AREA – only shown when a case is active
# ════════════════════════════════════════════════════════════════════════════
active_id = st.session_state["active_case_id"]

if not active_id:
    st.markdown("""
    <div style="border:2px dashed #e2e8f0;border-radius:10px;padding:4rem;text-align:center;color:#aaa;margin-top:2rem">
        <div style="font-size:3rem">📁</div>
        <div style="font-size:1.1rem;margin-top:0.5rem;font-weight:500">Keinen Case ausgewählt</div>
        <div style="font-size:0.85rem;margin-top:0.3rem">Neuen Case erstellen oder bestehenden auswählen (Sidebar)</div>
    </div>
    """, unsafe_allow_html=True)
    st.stop()

# Load case
case = get_case(active_id)
if not case:
    st.error("Case nicht gefunden.")
    st.stop()

# Case API key (per-case overrides global)
case_settings = get_settings(active_id)
api_key = case_settings.get("api_key") or global_key or os.getenv("OPENAI_API_KEY", "") or None

# Header
st.markdown(
    f'<div class="page-title">{STATUS_EMOJI.get(case["status"],"📋")} {case["name"]}</div>',
    unsafe_allow_html=True,
)
st.markdown(
    f'<div class="page-sub">Erstellt: {case["created_at"][:16].replace("T"," ")} · '
    f'{case.get("done_rows",0)}/{case.get("total_rows",0)} Zeilen · '
    f'Extraktion: {"GPT-4o-mini" if api_key else "Regex-Fallback"}</div>',
    unsafe_allow_html=True,
)

tab_table, tab_settings, tab_log, tab_export = st.tabs(
    ["📋 Tabelle", "⚙️ Einstellungen", "📄 Log", "📥 Export"]
)


# ════════════════════════════════════════════════════════════════════════════
# TAB: Tabelle
# ════════════════════════════════════════════════════════════════════════════
with tab_table:
    rows = load_rows(active_id)
    prompt_presets = _load_prompt_presets()
    preset_names = [p.get("name") or p.get("target_column") or f"Preset {i+1}" for i, p in enumerate(prompt_presets)]
    custom_steps_cfg = case_settings.get("custom_steps")
    if not isinstance(custom_steps_cfg, list):
        custom_steps_cfg = []
    custom_target_cols = []
    for s in custom_steps_cfg:
        col = str(s.get("target_column") or "").strip()
        if col and col not in custom_target_cols:
            custom_target_cols.append(col)

    base_source_cols = sorted({
        str(k) for r in rows for k in r.keys()
        if str(k).startswith("original_")
    })

    # ── Upload (only if no rows yet) ──────────────────────────────────────
    with st.expander("📁 Datei hochladen & Spalten zuordnen",
                     expanded=(len(rows) == 0)):
        uploaded = st.file_uploader("CSV oder Excel", type=["csv","xlsx","xls"],
                                    label_visibility="collapsed",
                                    key=f"upload_{active_id}")
        if uploaded:
            file_bytes = uploaded.read()
            try:
                raw_df = load_file(file_bytes, uploaded.name)
                st.success(f"✓ {len(raw_df)} Zeilen · {len(raw_df.columns)} Spalten")
                detected  = detect_columns(raw_df)
                col_opts  = ["(nicht vorhanden)"] + detected["all_columns"]
                c1, c2 = st.columns(2)
                with c1:
                    auto_name = detected["name_col"]
                    name_col  = st.selectbox("Firmenname-Spalte *", col_opts,
                                             index=col_opts.index(auto_name) if auto_name in col_opts else 0,
                                             key=f"ncol_{active_id}")
                with c2:
                    auto_url = detected["url_col"]
                    url_col  = st.selectbox("Website/URL-Spalte", col_opts,
                                            index=col_opts.index(auto_url) if auto_url in col_opts else 0,
                                            key=f"ucol_{active_id}")
                name_col_val = None if name_col == "(nicht vorhanden)" else name_col
                url_col_val  = None if url_col  == "(nicht vorhanden)" else url_col
                if name_col_val:
                    try:
                        norm = normalize(raw_df, name_col=name_col_val, url_col=url_col_val)
                        if st.button("✓ Übernehmen & Laden", type="primary", key=f"accept_{active_id}"):
                            save_input(active_id, norm)
                            new_rows = [
                                {**r.to_dict(), "_status": "pending"}
                                for _, r in norm.iterrows()
                            ]
                            save_rows(active_id, new_rows)
                            append_log(active_id, f"Input geladen: {len(new_rows)} Zeilen aus '{uploaded.name}'")
                            st.rerun()
                    except ValueError as e:
                        st.error(str(e))
            except ValueError as e:
                st.error(str(e))

        # Base-table importer: rebuild rows from persisted input.csv
        input_csv_bytes = get_input_csv(active_id)
        if input_csv_bytes:
            st.divider()
            st.caption("Basis-Importer: Zeilen aus ursprünglicher Input-Tabelle neu erzeugen")
            if st.button("↺ Aus Basis-Input neu aufbauen", key=f"rebuild_from_input_{active_id}"):
                try:
                    base_df = pd.read_csv(io.BytesIO(input_csv_bytes), dtype=str).fillna("")
                    rebuilt_rows = [
                        {**r.to_dict(), "_status": "pending"}
                        for _, r in base_df.iterrows()
                    ]
                    save_rows(active_id, rebuilt_rows)
                    append_log(active_id, f"Rows aus input.csv neu aufgebaut: {len(rebuilt_rows)} Zeilen")
                    st.success("✓ Rows aus Basis-Input neu aufgebaut")
                    st.rerun()
                except Exception as e:
                    st.error(f"Neuaufbau fehlgeschlagen: {e}")

    if not rows:
        st.markdown("""
        <div style="border:2px dashed #e2e8f0;border-radius:10px;padding:2rem;text-align:center;color:#aaa">
            Noch keine Daten. Datei oben hochladen.
        </div>""", unsafe_allow_html=True)
    else:
        total = len(rows)
        done  = sum(1 for r in rows if r.get("_status") in ("success","error","no_website"))
        succ  = sum(1 for r in rows if r.get("_status") == "success")
        err   = sum(1 for r in rows if r.get("_status") in ("error","no_website"))

        # ── Prompt columns quick-add (Clay-like, direkt in Tabelle) ───────────
        with st.expander("🧩 Prompt-Spalten (direkt in Tabelle)", expanded=False):
            qc1, qc2, qc3 = st.columns([1.3, 1.1, 1.1])
            with qc1:
                quick_target = st.text_input(
                    "Neue Prompt-Zielspalte",
                    value="",
                    placeholder="z.B. website_domain",
                    key=f"quick_target_{active_id}",
                ).strip()
            with qc2:
                quick_model = st.text_input(
                    "LLM-Modell",
                    value="gpt-4o-mini",
                    key=f"quick_model_{active_id}",
                ).strip() or "gpt-4o-mini"
            with qc3:
                add_now = st.button("➕ Als Prompt-Spalte anlegen", key=f"quick_add_step_{active_id}")

            if prompt_presets:
                qpm1, qpm2, qpm3 = st.columns([2.0, 1, 1.2])
                with qpm1:
                    preset_choice = st.selectbox(
                        "Aus Preset hinzufügen",
                        options=list(range(len(prompt_presets))),
                        format_func=lambda i: preset_names[i],
                        key=f"quick_preset_pick_{active_id}",
                    )
                with qpm2:
                    if st.button("📚 Preset-Spalte hinzufügen", key=f"quick_add_preset_{active_id}"):
                        picked = _dedupe_target_column(prompt_presets[preset_choice], custom_steps_cfg)
                        custom_steps_cfg.append(_normalize_step(picked))
                        update_settings(active_id, {"custom_steps": custom_steps_cfg})
                        st.success(f"Preset hinzugefügt: {picked.get('name') or picked.get('target_column')}")
                        st.rerun()
                with qpm3:
                    if st.button("📚 Alle Standards hinzufügen", key=f"quick_add_all_presets_{active_id}"):
                        updated_steps, added_count = _add_missing_standard_steps(custom_steps_cfg, prompt_presets)
                        update_settings(active_id, {"custom_steps": updated_steps})
                        if added_count:
                            st.success(f"{added_count} fehlende Standard-Prompt-Spalten hinzugefügt")
                        else:
                            st.info("Alle Standard-Prompt-Spalten sind bereits im Case vorhanden.")
                        st.rerun()

            if custom_target_cols:
                st.divider()
                d1, d2 = st.columns([2.2, 1])
                with d1:
                    delete_target = st.selectbox(
                        "AI-Spalte aus Tabelle löschen",
                        options=custom_target_cols,
                        key=f"quick_delete_target_{active_id}",
                    )
                with d2:
                    if st.button("🗑 Spalte löschen", key=f"quick_delete_col_{active_id}"):
                        # Remove step definition from case settings
                        updated_steps = [
                            s for s in custom_steps_cfg
                            if str(s.get("target_column") or "").strip() != delete_target
                        ]

                        # Remove column values + debug keys from row data
                        current_rows = load_rows(active_id)
                        delete_prefix = f"_{delete_target}_"
                        cleaned_rows = []
                        for r in current_rows:
                            rr = dict(r)
                            rr.pop(delete_target, None)
                            for k in list(rr.keys()):
                                if str(k).startswith(delete_prefix):
                                    rr.pop(k, None)
                            cleaned_rows.append(rr)
                        save_rows(active_id, cleaned_rows)

                        # Remove column label from saved table order
                        saved_order = case_settings.get("table_column_order")
                        if isinstance(saved_order, list):
                            label = f"🤖 {delete_target}"
                            saved_order = [c for c in saved_order if c not in (delete_target, label)]
                            update_settings(active_id, {
                                "custom_steps": updated_steps,
                                "table_column_order": saved_order,
                            })
                            case_settings["table_column_order"] = saved_order
                        else:
                            update_settings(active_id, {"custom_steps": updated_steps})

                        case_settings["custom_steps"] = updated_steps
                        append_log(active_id, f"AI-Spalte gelöscht: {delete_target}")
                        st.success(f"AI-Spalte '{delete_target}' gelöscht")
                        st.rerun()

            if add_now:
                if not quick_target:
                    st.error("Bitte eine Zielspalte eingeben.")
                elif any((s.get("target_column") or "").strip() == quick_target for s in custom_steps_cfg):
                    st.warning(f"Prompt-Spalte '{quick_target}' existiert bereits.")
                else:
                    custom_steps_cfg.append({
                        "enabled": True,
                        "name": quick_target,
                        "target_column": quick_target,
                        "model": quick_model,
                        "output_mode": "text",
                        "output_key": "",
                        "overwrite": False,
                        "condition_source": "",
                        "condition_operator": "is_truthy",
                        "condition_value": "",
                        "prompt": (
                            "Nutze Firmenname {company_name} und Website {website}. "
                            "Gib nur den Wert für die Zielspalte zurück."
                        ),
                    })
                    update_settings(active_id, {"custom_steps": custom_steps_cfg})
                    st.success(f"Prompt-Spalte '{quick_target}' angelegt. Details in ⚙️ Einstellungen anpassen.")
                    st.rerun()

            if custom_target_cols:
                st.caption("Aktive Prompt-Spalten in Tabelle: " + ", ".join(custom_target_cols))
            else:
                st.caption("Noch keine Prompt-Spalten angelegt.")

        # Stats
        c1,c2,c3,c4 = st.columns(4)
        for col, num, label in [(c1,total,"Gesamt"),(c2,done,"Verarbeitet"),(c3,succ,"✓ Erfolg"),(c4,err,"✗ Fehler")]:
            with col:
                st.markdown(f'<div class="stat-card"><div class="number">{num}</div><div class="label">{label}</div></div>',
                            unsafe_allow_html=True)
        st.markdown("<br>", unsafe_allow_html=True)

        # ── Status counts for pills ──────────────────────────────
        n_pending    = sum(1 for r in rows if r.get("_status") == "pending")
        n_error      = sum(1 for r in rows if r.get("_status") == "error")
        n_nosite     = sum(1 for r in rows if r.get("_status") == "no_website")
        n_success    = sum(1 for r in rows if r.get("_status") == "success")

        # ── Filter row ───────────────────────────────────────────
        st.markdown("""<style>
        div[data-testid="stHorizontalBlock"] .stSelectbox label,
        div[data-testid="stHorizontalBlock"] .stNumberInput label { font-size:0.72rem; color:#888; }
        </style>""", unsafe_allow_html=True)

        f1, f2, f3, f4, f5 = st.columns([2.0, 0.7, 0.7, 0.7, 0.9])
        with f1:
            STATUS_OPTIONS = [
                f"Alle nicht-fertigen ({n_pending+n_error+n_nosite})",
                f"○ Ausstehend ({n_pending})",
                f"✗ Fehler ({n_error})",
                f"∅ Keine Website ({n_nosite})",
                f"✓ Fertig ({n_success})  ⚠ manuell",
            ]
            status_filter = st.selectbox(
                "Status-Filter", STATUS_OPTIONS,
                key=f"sfilt_{active_id}", label_visibility="collapsed",
                help="Welche Zeilen sollen betroffen sein?"
            )
        with f2:
            st.markdown("<div style='font-size:0.72rem;color:#888;margin-bottom:2px'>Von #</div>",
                        unsafe_allow_html=True)
            range_from = st.number_input("Von", min_value=1, max_value=total,
                                         value=1, key=f"rfrom_{active_id}",
                                         label_visibility="collapsed")
        with f3:
            st.markdown("<div style='font-size:0.72rem;color:#888;margin-bottom:2px'>Bis #</div>",
                        unsafe_allow_html=True)
            range_to = st.number_input("Bis", min_value=1, max_value=total,
                                       value=total, key=f"rto_{active_id}",
                                       label_visibility="collapsed")
        with f4:
            st.markdown("<div style='font-size:0.72rem;color:#888;margin-bottom:2px'>Max.</div>",
                        unsafe_allow_html=True)
            limit = st.number_input("Max", min_value=0, max_value=total, value=0,
                                    key=f"limit_{active_id}",
                                    label_visibility="collapsed",
                                    help="0 = alle im Bereich")
        with f5:
            pass  # spacer

        # Compute target indices
        STATUS_FILTER_MAP = {
            f"○ Ausstehend ({n_pending})":            "pending",
            f"✗ Fehler ({n_error})":                  "error",
            f"∅ Keine Website ({n_nosite})":          "no_website",
            f"✓ Fertig ({n_success})  ⚠ manuell":    "success",
        }
        _rf = int(range_from) - 1
        _rt = int(range_to)
        _status_val = STATUS_FILTER_MAP.get(status_filter)  # None = alle nicht-fertigen
        target_indices = [
            i for i in range(_rf, min(_rt, total))
            if (
                _status_val == "success" and rows[i].get("_status") == "success"
            ) or (
                _status_val not in (None, "success")
                and rows[i].get("_status") == _status_val
            ) or (
                _status_val is None
                and rows[i].get("_status") != "success"
            )
        ]
        target_count = len(target_indices)

        # ── Locked execution mode: AI columns only ────────────────────────────
        run_stage = "custom_steps_only"
        if case_settings.get("run_stage") != run_stage:
            update_settings(active_id, {"run_stage": run_stage})
            case_settings["run_stage"] = run_stage
        st.caption("Pipeline-Modus: Nur Prompt-Spalten (ohne System-Prompt)")

        # ── Action buttons ───────────────────────────────────────
        b1, b2, b3, b4 = st.columns([1.8, 1.8, 1.4, 1.0])
        with b1:
            run_all = st.button(
                f"▶ Starten  —  {target_count} Zeilen", type="primary",
                use_container_width=True,
                disabled=st.session_state["running"] or target_count == 0,
                key=f"runall_{active_id}",
                help=f"Verarbeitet {target_count} Zeilen laut Filter+Bereich"
            )
        with b2:
            do_reset_sel = st.button(
                f"↺ Zurücksetzen  —  {target_count} Zeilen",
                use_container_width=True,
                disabled=st.session_state["running"] or target_count == 0,
                key=f"resetsel_{active_id}",
                help="Setzt gefilterte Zeilen auf 'Ausstehend'"
            )
        with b3:
            if st.session_state["running"]:
                if st.button("⏹ Stop", type="secondary", use_container_width=True,
                             key=f"stop_{active_id}"):
                    st.session_state["stop_requested"] = True
                    st.rerun()
            else:
                if st.button("↺ Komplett-Reset", use_container_width=True,
                             key=f"reset_{active_id}",
                             help="Wirklich ALLE Zeilen (inkl. Fertig) auf Ausstehend setzen"):
                    save_rows(active_id, [{**_row_base(r), "_status": "pending"} for r in rows])
                    append_log(active_id, "Kompletter Reset aller Zeilen")
                    st.rerun()
        with b4:
            st.metric("Ziel", target_count, label_visibility="visible")

        # Handle range-reset
        if do_reset_sel and not st.session_state["running"]:
            for i in target_indices:
                rows[i] = {**_row_base(rows[i]), "_status": "pending"}
            save_rows(active_id, rows)
            append_log(active_id, f"{target_count} Zeilen zurückgesetzt")
            st.rerun()

        run_pending = False
        run_selected = False
        workers = case_settings.get("workers", 3)


        # ── AgGrid table ───────────────────────────────────────────
        import pandas as pd
        from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, DataReturnMode, JsCode
        is_running = st.session_state["running"]

        STATUS_LABEL = {
            "pending":    "○ Ausstehend",
            "running":    "⏳ Läuft",
            "success":    "✓ Fertig",
            "error":      "✗ Fehler",
            "no_website": "∅ Keine Website",
        }

        ai_col_labels = {c: f"🤖 {c}" for c in custom_target_cols}
        base_col_labels = {c: f"📥 {c.replace('original_', '')}" for c in base_source_cols}

        def _clean_ai_value(value) -> str:
            txt = "" if value is None else str(value)
            if "ⓘ status=" in txt:
                txt = txt.split("ⓘ status=", 1)[0].strip()
            for icon in ("✅ ", "⏳ ", "⏭ ", "❌ ", "✅", "⏳", "⏭", "❌"):
                while txt.startswith(icon):
                    txt = txt[len(icon):]
            return txt.strip()

        df_ag = pd.DataFrame([{
            "#":          i + 1,
            "_idx":       i,
            "Firma":      r.get("company_name", ""),
            "Input URL":  r.get("input_url") or "",
            "Status":     STATUS_LABEL.get(r.get("_status","pending"), r.get("_status","")),
            "Qualität %": r.get("_quality_score") or 0,
            "Website":    r.get("_website_found") or "",
            "Email":      r.get("email_general") or r.get("email_contact") or "",
            "Telefon":    r.get("phone") or "",
            "GF":         r.get("managing_director") or "",
            "PLZ":        r.get("zip") or "",
            "Ort":        r.get("city") or "",
            "Branche":    r.get("industry") or "",
            **{base_col_labels[col]: (r.get(col) or "") for col in base_source_cols},
            **{ai_col_labels[col]: _clean_ai_value(r.get(col) or "") for col in custom_target_cols},
        } for i, r in enumerate(rows)])

        # Apply saved per-case column order (Clay-like persistence)
        default_visible_cols = [
            "#", "Firma", "Input URL", "Status", "Qualität %", "Website", "Email",
            "Telefon", "GF", "PLZ", "Ort", "Branche",
            *[base_col_labels[c] for c in base_source_cols],
            *[ai_col_labels[c] for c in custom_target_cols],
        ]
        saved_order = case_settings.get("table_column_order")
        if not isinstance(saved_order, list):
            saved_order = []
        visible_order = [c for c in saved_order if c in default_visible_cols]
        visible_order += [c for c in default_visible_cols if c not in visible_order]
        df_ag = df_ag[["_idx", *visible_order]]

        # Status cell color via JS
        status_style = JsCode("""
        function(params) {
            const s = params.value || '';
            if (s.startsWith('✓')) return {'color':'#166534','background':'#dcfce7','fontWeight':'600'};
            if (s.startsWith('✗')) return {'color':'#991b1b','background':'#fee2e2','fontWeight':'600'};
            if (s.startsWith('∅')) return {'color':'#92400e','background':'#fef3c7','fontWeight':'600'};
            if (s.startsWith('⏳')) return {'color':'#1d4ed8','background':'#dbeafe','fontWeight':'600'};
            return {'color':'#6b7280'};
        }""")

        gb = GridOptionsBuilder.from_dataframe(df_ag)
        gb.configure_default_column(resizable=True, sortable=True, filter=True, minWidth=80)
        gb.configure_column("_idx",     hide=True)
        gb.configure_column(
            "#",
            width=90,
            pinned="left",
            checkboxSelection=True,
            headerCheckboxSelection=True,
            headerCheckboxSelectionFilteredOnly=False,
        )
        gb.configure_column("Firma",    width=220, pinned="left", editable=True)
        gb.configure_column("Input URL", width=220, editable=True)
        gb.configure_column("Status",   width=140, cellStyle=status_style)
        gb.configure_column("Qualität %", width=100, type=["numericColumn"])
        gb.configure_column("Website",  width=180, editable=True)
        gb.configure_column("Email",    width=200, editable=True)
        gb.configure_column("Telefon",  width=130, editable=True)
        gb.configure_column("GF",       width=160, editable=True)
        gb.configure_column("PLZ",      width=70, editable=True)
        gb.configure_column("Ort",      width=120, editable=True)
        gb.configure_column("Branche",  width=140, editable=True)
        for base_col in base_source_cols:
            gb.configure_column(base_col_labels[base_col], width=180, editable=True)
        for custom_col in custom_target_cols:
            gb.configure_column(ai_col_labels[custom_col], width=200, editable=True)
        gb.configure_selection("multiple", use_checkbox=True, header_checkbox=True)
        gb.configure_pagination(enabled=True, paginationAutoPageSize=False, paginationPageSize=50)
        gb.configure_grid_options(suppressMovableColumns=False)

        grid_opts = gb.build()

        if not is_running:
            ag_resp = AgGrid(
                df_ag,
                gridOptions=grid_opts,
                height=550,
                update_mode=GridUpdateMode.SELECTION_CHANGED | GridUpdateMode.COLUMN_CHANGED | GridUpdateMode.VALUE_CHANGED,
                data_return_mode=DataReturnMode.FILTERED_AND_SORTED,
                allow_unsafe_jscode=True,
                use_container_width=True,
                theme="alpine",
                key=f"ag_{active_id}",
            )

            # Persist inline edits from grid back into rows
            ag_data = ag_resp.get("data") if isinstance(ag_resp, dict) else getattr(ag_resp, "data", None)
            grid_records = []
            if hasattr(ag_data, "to_dict"):
                grid_records = ag_data.to_dict("records")
            elif isinstance(ag_data, list):
                grid_records = ag_data

            edited_any = False
            for rec in grid_records:
                try:
                    idx = int(rec.get("_idx"))
                except Exception:
                    continue
                if idx < 0 or idx >= len(rows):
                    continue

                current = dict(rows[idx])
                updated = dict(current)
                source_changed = False

                new_company = str(rec.get("Firma", "") or "").strip()
                if new_company != str(current.get("company_name", "") or ""):
                    updated["company_name"] = new_company
                    source_changed = True

                new_input_url = str(rec.get("Input URL", "") or "").strip()
                if new_input_url != str(current.get("input_url", "") or ""):
                    updated["input_url"] = new_input_url
                    source_changed = True

                for base_col in base_source_cols:
                    label = base_col_labels[base_col]
                    new_val = rec.get(label, "")
                    if str(new_val or "") != str(current.get(base_col, "") or ""):
                        updated[base_col] = new_val
                        source_changed = True

                for custom_col in custom_target_cols:
                    label = ai_col_labels[custom_col]
                    new_val = rec.get(label, "")
                    new_val = _clean_ai_value(new_val)
                    if str(new_val or "") != str(current.get(custom_col, "") or ""):
                        updated[custom_col] = new_val

                field_map = {
                    "Website": "_website_found",
                    "Email": "email_general",
                    "Telefon": "phone",
                    "GF": "managing_director",
                    "PLZ": "zip",
                    "Ort": "city",
                    "Branche": "industry",
                }
                for label, key in field_map.items():
                    new_val = rec.get(label, "")
                    if str(new_val or "") != str(current.get(key, "") or ""):
                        updated[key] = new_val
                        source_changed = True

                if source_changed:
                    updated["_status"] = "pending"

                if updated != current:
                    rows[idx] = updated
                    edited_any = True

            if edited_any:
                save_rows(active_id, rows)
                save_output(active_id, rows)
                append_log(active_id, "Inline-Änderungen in Tabelle gespeichert")

            # Column order persistence controls
            col_state = None
            if isinstance(ag_resp, dict):
                col_state = (
                    ag_resp.get("column_state")
                    or ag_resp.get("columns_state")
                    or (ag_resp.get("grid_state") or {}).get("columnState")
                )
            else:
                col_state = (
                    getattr(ag_resp, "column_state", None)
                    or getattr(ag_resp, "columns_state", None)
                )

            co1, co2 = st.columns([1.6, 1.4])
            with co1:
                if st.button("💾 Spaltenreihenfolge speichern", key=f"save_col_order_{active_id}"):
                    if isinstance(col_state, list) and col_state:
                        ordered_cols = [
                            c.get("colId") for c in col_state
                            if c.get("colId") and c.get("colId") != "_idx"
                        ]
                        if ordered_cols:
                            update_settings(active_id, {"table_column_order": ordered_cols})
                            case_settings["table_column_order"] = ordered_cols
                            st.success("✓ Spaltenreihenfolge gespeichert")
                        else:
                            st.warning("Keine Spaltenreihenfolge erkannt.")
                    else:
                        st.warning("Reihenfolge noch nicht verfügbar. Spalten kurz bewegen und erneut speichern.")
            with co2:
                if st.button("↺ Spaltenreihenfolge zurücksetzen", key=f"reset_col_order_{active_id}"):
                    update_settings(active_id, {"table_column_order": []})
                    case_settings["table_column_order"] = []
                    st.rerun()

            # Selected rows → get real indices (handle DataFrame or list)
            sel_raw = ag_resp.selected_rows
            if sel_raw is None:
                sel_indices = []
            elif hasattr(sel_raw, "empty"):  # DataFrame
                sel_indices = [] if sel_raw.empty else sel_raw["_idx"].tolist()
            elif isinstance(sel_raw, list):  # list of dicts
                sel_indices = [r["_idx"] for r in sel_raw if "_idx" in r]
            else:
                sel_indices = []
            sel_count = len(sel_indices)

            # Action bar for selected rows
            if sel_count:
                sa1, sa2, sa3, sa4 = st.columns([1.3, 1.3, 1.3, 2.1])
                with sa1:
                    if st.button(f"▶ Auswahl starten ({sel_count})",
                                 key=f"ag_run_{active_id}", type="primary",
                                 use_container_width=True):
                        for i in sel_indices:
                            rows[i] = {**_row_base(rows[i]), "_status": "pending"}
                        save_rows(active_id, rows)
                        st.session_state["_sel_run_indices"] = sel_indices
                        st.rerun()
                with sa2:
                    if st.button(f"↺ Auswahl reset ({sel_count})",
                                 key=f"ag_rst_{active_id}",
                                 use_container_width=True):
                        for i in sel_indices:
                            rows[i] = {**_row_base(rows[i]), "_status": "pending"}
                        save_rows(active_id, rows)
                        st.rerun()
                with sa3:
                    if st.button(f"🗑 Auswahl löschen ({sel_count})",
                                 key=f"ag_del_{active_id}",
                                 use_container_width=True):
                        for i in sorted(sel_indices, reverse=True):
                            if 0 <= i < len(rows):
                                rows.pop(i)
                        save_rows(active_id, rows)
                        save_output(active_id, rows)
                        update_meta(active_id, total_rows=len(rows))
                        st.session_state["selected_rows"] = set()
                        append_log(active_id, f"{sel_count} Zeilen gelöscht")
                        st.rerun()
                with sa4:
                    names = ", ".join(rows[i]["company_name"] for i in sel_indices[:4])
                    if sel_count > 4: names += f" +{sel_count-4}"
                    st.caption(f"☑ {names}")

        # Run
        single_idx      = st.session_state.get("run_single_idx")
        sel_run_indices = st.session_state.pop("_sel_run_indices", None)
        should_run = run_all or (single_idx is not None) or (sel_run_indices is not None)
        if should_run and not st.session_state["running"]:
            st.session_state["stop_requested"] = False
            st.session_state["running"] = True
            st.session_state["run_single_idx"] = None
            rows = load_rows(active_id)  # fresh

            if single_idx is not None:
                process_indices = [single_idx]
            elif sel_run_indices is not None:
                process_indices = list(sel_run_indices)
            else:
                process_indices = target_indices  # from filter+range
            if limit and limit > 0:
                process_indices = process_indices[:int(limit)]

            prog      = st.progress(0, text="Starte…")
            table_ph  = st.empty()
            rows_lock = Lock()
            completed = [0]
            n_workers = int(workers)

            # Immediate visual feedback before first row completes
            prog.progress(0.0, text=f"0/{len(process_indices)} gestartet · {n_workers} parallel")

            def process_one(idx):
                """Worker: enrich one row, update shared rows list."""
                if st.session_state.get("stop_requested"):
                    return
                row     = rows[idx]
                company = row["company_name"]
                url     = row.get("input_url") or None
                run_stage = "custom_steps_only"

                with rows_lock:
                    rows[idx]["_status"] = "running"
                    save_rows(active_id, rows)
                append_log(active_id, f"Start: {company}")

                known_website = row.get("_website_found") or row.get("website") or None

                if run_stage == "custom_steps_only":
                    enriched = dict(row)
                    enriched["_search_strategy"] = None
                    enriched["_scraped_pages"] = None
                    enriched["_extraction_method"] = "custom_steps_only"
                else:
                    enriched = enrich_row(
                        company,
                        url,
                        api_key=api_key or None,
                        deep=st.session_state.get(f"deep_{active_id}", False),
                        stage=run_stage,
                        known_website=known_website,
                    )

                # Ensure base/source values are present for custom-step conditions/prompts
                enriched["company_name"] = company
                enriched["input_url"] = url or ""
                for k, v in row.items():
                    if str(k).startswith("original_") and k not in enriched:
                        enriched[k] = v

                custom_steps = case_settings.get("custom_steps") or []
                if isinstance(custom_steps, list) and custom_steps:
                    enriched = run_custom_steps(
                        enriched,
                        custom_steps,
                        api_key=api_key or None,
                        log_fn=lambda msg: append_log(active_id, f"{company} | {msg}"),
                    )

                enriched["company_name"] = company
                enriched["input_url"] = url or ""
                enriched["_status"] = "success"

                with rows_lock:
                    rows[idx] = enriched
                    completed[0] += 1
                    save_rows(active_id, rows)
                    save_output(active_id, rows)

                append_log(active_id,
                           f"Done: {company} | status={enriched.get('_status')} | "
                           f"strategy={enriched.get('_search_strategy')} | "
                           f"pages={enriched.get('_scraped_pages')} | "
                           f"method={enriched.get('_extraction_method')}")

            with ThreadPoolExecutor(max_workers=n_workers) as executor:
                futures = {executor.submit(process_one, idx): idx
                           for idx in process_indices}

                for future in as_completed(futures):
                    # Update UI after each completed row
                    with rows_lock:
                        done_now = completed[0]
                        render_table(rows, table_ph)
                        prog.progress(
                            done_now / len(process_indices),
                            text=f"{done_now}/{len(process_indices)} fertig · {n_workers} parallel"
                        )

                    # Check stop after every completion
                    if st.session_state.get("stop_requested"):
                        executor.shutdown(wait=False, cancel_futures=True)
                        append_log(active_id, "⏹ Verarbeitung durch Nutzer gestoppt")
                        with rows_lock:
                            for r in rows:
                                if r.get("_status") == "running":
                                    r["_status"] = "pending"
                            save_rows(active_id, rows)
                        prog.empty()
                        st.session_state["running"] = False
                        st.session_state["stop_requested"] = False
                        update_meta(active_id, status="partial")
                        st.rerun()
                        break

            prog.progress(1.0, text="✅ Fertig!")
            table_ph.empty()
            prog.empty()
            st.session_state["running"] = False
            st.session_state["stop_requested"] = False
            update_meta(active_id, status="done" if done+len(process_indices)==total else "partial")
            st.rerun()


# ════════════════════════════════════════════════════════════════════════════
# TAB: Einstellungen
# ════════════════════════════════════════════════════════════════════════════
with tab_settings:
    st.markdown("#### ⚙️ Verarbeitungsoptionen")
    sv1, sv2 = st.columns(2)
    with sv1:
        s_workers = st.number_input(
            "Parallele Workers", min_value=1, max_value=10,
            value=case_settings.get("workers", 3),
            key=f"workers_{active_id}",
            help="3–5 empfohlen. Mehr = schneller, aber höheres Rate-Limit-Risiko."
        )
        if s_workers != case_settings.get("workers", 3):
            update_settings(active_id, {"workers": s_workers})
    with sv2:
        s_deep = st.toggle(
            "🔍 Deep Analyse", value=case_settings.get("deep", False),
            key=f"deep_{active_id}",
            help="Zusätzliche Suchen: LinkedIn/Xing-Profile (GF), Handelsregister, alternative URLs. Dauert länger."
        )
        if s_deep != case_settings.get("deep", False):
            update_settings(active_id, {"deep": s_deep})

    st.divider()
    st.markdown("#### API & Extraktion")
    c_key = st.text_input("OpenAI API Key für diesen Case",
                          value=case_settings.get("api_key",""),
                          type="password", key=f"casekey_{active_id}")
    if c_key != case_settings.get("api_key",""):
        update_settings(active_id, {"api_key": c_key})
        st.success("✓ Gespeichert")

    st.divider()
    st.markdown("#### 🧩 Prompt-Spalten (Clerk-Ansatz)")
    st.caption("Spalte definieren → Prompt + Modell → Output-Ziel → optionale Bedingung auf Quellspalte.")

    custom_steps = case_settings.get("custom_steps")
    if not isinstance(custom_steps, list):
        custom_steps = []
    prompt_presets = _load_prompt_presets()
    preset_names = [p.get("name") or p.get("target_column") or f"Preset {i+1}" for i, p in enumerate(prompt_presets)]

    st.markdown("##### Preset-Bibliothek")
    pm1, pm2, pm3 = st.columns([2.0, 1, 1.2])
    with pm1:
        if prompt_presets:
            preset_pick_settings = st.selectbox(
                "Preset wählen",
                options=list(range(len(prompt_presets))),
                format_func=lambda i: preset_names[i],
                key=f"preset_pick_settings_{active_id}",
            )
        else:
            preset_pick_settings = None
            st.caption("Noch keine Presets vorhanden.")
    with pm2:
        if prompt_presets and st.button("➕ Preset in Case", key=f"add_preset_settings_{active_id}"):
            picked = _dedupe_target_column(prompt_presets[preset_pick_settings], custom_steps)
            custom_steps.append(_normalize_step(picked))
            update_settings(active_id, {"custom_steps": custom_steps})
            st.success(f"Preset hinzugefügt: {picked.get('name') or picked.get('target_column')}")
            st.rerun()
    with pm3:
        if prompt_presets and st.button("➕ Alle Standards", key=f"add_all_presets_settings_{active_id}"):
            updated_steps, added_count = _add_missing_standard_steps(custom_steps, prompt_presets)
            update_settings(active_id, {"custom_steps": updated_steps})
            if added_count:
                st.success(f"{added_count} fehlende Standard-Prompt-Spalten hinzugefügt")
            else:
                st.info("Alle Standard-Prompt-Spalten sind bereits im Case vorhanden.")
            st.rerun()

    rows_for_columns = load_rows(active_id)
    available_columns = {"", "company_name", "input_url", "website", "_website_found"}
    available_columns.update(EXTRACTION_FIELDS.keys())
    for r in rows_for_columns:
        available_columns.update(r.keys())
    for s in custom_steps:
        col = str(s.get("target_column") or "").strip()
        if col:
            available_columns.add(col)
    available_column_options = [""] + sorted(c for c in available_columns if c)

    if st.button("➕ Prompt-Spalte hinzufügen", key=f"add_cstep_{active_id}"):
        custom_steps.append({
            "enabled": True,
            "name": f"Prompt-Spalte {len(custom_steps)+1}",
            "target_column": f"custom_col_{len(custom_steps)+1}",
            "model": "gpt-4o-mini",
            "output_mode": "text",
            "output_key": "",
            "overwrite": False,
            "condition_source": "",
            "condition_operator": "is_truthy",
            "condition_value": "",
            "prompt": "Nutze diese Daten: {company_name}, {website}. Gib einen kurzen Wert zurück.",
        })
        update_settings(active_id, {"custom_steps": custom_steps})
        st.rerun()

    remove_idx = None
    edited_steps = []
    save_preset_idx = None
    test_step_idx = None
    cond_ops = ["is_truthy", "is_empty", "equals", "not_equals", "contains", "not_contains"]
    out_modes = ["text", "json"]

    for i, step in enumerate(custom_steps):
        step = dict(step)
        title = step.get("name") or f"Prompt-Spalte {i+1}"
        with st.expander(f"{i+1}. {title}", expanded=False):
            r1c1, r1c2, r1c3 = st.columns([2, 1.2, 1])
            with r1c1:
                step["name"] = st.text_input("Name", value=step.get("name", ""), key=f"cstep_name_{active_id}_{i}")
            with r1c2:
                step["target_column"] = st.text_input(
                    "Zielspalte",
                    value=step.get("target_column", ""),
                    key=f"cstep_target_{active_id}_{i}",
                    help="In diese Spalte wird das Ergebnis geschrieben.",
                )
            with r1c3:
                step["enabled"] = st.toggle("Aktiv", value=bool(step.get("enabled", True)), key=f"cstep_enabled_{active_id}_{i}")

            r2c1, r2c2, r2c3 = st.columns([1.2, 1, 1])
            with r2c1:
                step["model"] = st.text_input("LLM-Modell", value=step.get("model", "gpt-4o-mini"), key=f"cstep_model_{active_id}_{i}")
            with r2c2:
                current_mode = step.get("output_mode", "text")
                if current_mode not in out_modes:
                    current_mode = "text"
                step["output_mode"] = st.selectbox(
                    "Output",
                    out_modes,
                    index=out_modes.index(current_mode),
                    key=f"cstep_outmode_{active_id}_{i}",
                )
            with r2c3:
                step["overwrite"] = st.toggle(
                    "Überschreiben",
                    value=bool(step.get("overwrite", False)),
                    key=f"cstep_overwrite_{active_id}_{i}",
                    help="Wenn aus: nur schreiben, wenn Zielspalte leer ist.",
                )

            step["output_key"] = st.text_input(
                "JSON-Key (optional)",
                value=step.get("output_key", ""),
                key=f"cstep_outkey_{active_id}_{i}",
                help="Nur bei JSON-Output: welcher Key ins Zielfeld übernommen wird.",
            )

            st.markdown("**Bedingte Ausführung**")
            c1, c2, c3 = st.columns([1.3, 1.1, 1.3])
            with c1:
                current_source = step.get("condition_source", "") or ""
                if current_source not in available_column_options:
                    available_column_options.append(current_source)
                src_idx = available_column_options.index(current_source)
                step["condition_source"] = st.selectbox(
                    "Quellspalte",
                    options=available_column_options,
                    index=src_idx,
                    key=f"cstep_condsrc_{active_id}_{i}",
                    help="Leer = immer ausführen.",
                    format_func=lambda v: "(immer)" if v == "" else v,
                )
            with c2:
                current_op = step.get("condition_operator", "is_truthy")
                if current_op not in cond_ops:
                    current_op = "is_truthy"
                step["condition_operator"] = st.selectbox(
                    "Operator",
                    cond_ops,
                    index=cond_ops.index(current_op),
                    key=f"cstep_condop_{active_id}_{i}",
                )
            with c3:
                step["condition_value"] = st.text_input(
                    "Vergleichswert",
                    value=step.get("condition_value", ""),
                    key=f"cstep_condval_{active_id}_{i}",
                )

            step["prompt"] = st.text_area(
                "Prompt-Template",
                value=step.get("prompt", ""),
                height=180,
                key=f"cstep_prompt_{active_id}_{i}",
                help="Template-Variablen wie {company_name}, {website}, {original_city} sind erlaubt.",
            )

            if st.button("🗑 Prompt-Spalte entfernen", key=f"cstep_remove_{active_id}_{i}"):
                remove_idx = i

            a1, a2 = st.columns([1, 1])
            with a1:
                if st.button("💾 Als Preset speichern", key=f"cstep_savepreset_{active_id}_{i}"):
                    save_preset_idx = i
            with a2:
                if st.button("🧪 Test auf 1 Beispielzeile", key=f"cstep_test_{active_id}_{i}"):
                    test_step_idx = i

        edited_steps.append(step)

    if remove_idx is not None:
        edited_steps.pop(remove_idx)
        update_settings(active_id, {"custom_steps": edited_steps})
        st.rerun()

    if save_preset_idx is not None and save_preset_idx < len(edited_steps):
        presets = _load_prompt_presets()
        step_to_save = _normalize_step(edited_steps[save_preset_idx])
        presets.append(step_to_save)
        _save_prompt_presets(presets)
        st.success(f"Preset gespeichert: {step_to_save.get('name') or step_to_save.get('target_column')}")

    if test_step_idx is not None and test_step_idx < len(edited_steps):
        sample_rows = load_rows(active_id)
        if sample_rows:
            test_step = _normalize_step(edited_steps[test_step_idx])
            sample = dict(sample_rows[0])
            sample_result = run_custom_steps(
                sample,
                [test_step],
                api_key=api_key or None,
                log_fn=lambda msg: append_log(active_id, f"TEST | {msg}"),
            )
            tc = test_step.get("target_column", "")
            st.info(f"Test-Ergebnis ({tc}): {sample_result.get(tc)}")
            if tc:
                dbg = {
                    "status": sample_result.get(f"_{tc}_status"),
                    "skip_reason": sample_result.get(f"_{tc}_skip_reason"),
                    "error": sample_result.get(f"_{tc}_error"),
                    "prompt": sample_result.get(f"_{tc}_prompt"),
                    "raw": sample_result.get(f"_{tc}_raw"),
                }
                st.json(dbg)
        else:
            st.warning("Keine Zeilen vorhanden für Test.")

    if st.button("💾 Prompt-Spalten speichern", key=f"save_csteps_{active_id}"):
        update_settings(active_id, {"custom_steps": edited_steps})
        case_settings["custom_steps"] = edited_steps
        st.success("✓ Prompt-Spalten gespeichert")

    st.divider()
    st.markdown("#### ⚠️ Case löschen")
    st.caption(f"Case **{case['name']}** inkl. aller Dateien (Input, Output, Log) unwiderruflich löschen.")
    confirm_key = f"confirm_del_{active_id}"
    if confirm_key not in st.session_state:
        st.session_state[confirm_key] = False

    if not st.session_state[confirm_key]:
        if st.button("🗑 Diesen Case löschen", type="secondary", key=f"del_{active_id}"):
            st.session_state[confirm_key] = True
            st.rerun()
    else:
        st.warning(f"⚠️ Sicher? **{case['name']}** wird dauerhaft gelöscht!")
        cd1, cd2 = st.columns(2)
        with cd1:
            if st.button("❌ Ja, löschen", type="primary", key=f"del_confirm_{active_id}"):
                delete_case(active_id)
                st.session_state["active_case_id"] = None
                st.session_state.pop(confirm_key, None)
                st.rerun()
        with cd2:
            if st.button("✓ Abbrechen", key=f"del_cancel_{active_id}"):
                st.session_state[confirm_key] = False
                st.rerun()


# ════════════════════════════════════════════════════════════════════════════
# TAB: Log
# ════════════════════════════════════════════════════════════════════════════
with tab_log:
    st.markdown("#### Verarbeitungs-Log")
    log_text = read_log(active_id)
    if log_text:
        lines = log_text.strip().split("\n")
        st.caption(f"{len(lines)} Log-Einträge")
        st.code("\n".join(lines[-100:]), language=None)
        st.download_button("⬇ Log herunterladen", data=log_text.encode("utf-8"),
                           file_name=f"log_{active_id}.txt", mime="text/plain")
    else:
        st.info("Noch keine Log-Einträge.")

    # Input file download
    st.divider()
    input_csv = get_input_csv(active_id)
    if input_csv:
        st.markdown("#### Input-Datei")
        st.download_button("⬇ Input CSV", data=input_csv,
                           file_name=f"input_{active_id}.csv", mime="text/csv")


# ════════════════════════════════════════════════════════════════════════════
# TAB: Export
# ════════════════════════════════════════════════════════════════════════════
with tab_export:
    rows = load_rows(active_id)
    done_rows = [r for r in rows if r.get("_status") == "success"]

    if not done_rows:
        st.info("Noch keine fertigen Zeilen.")
    else:
        export_all_toggle = st.toggle("Alle Zeilen inkl. Fehler", value=False,
                                      key=f"exptog_{active_id}")
        export_rows = rows if export_all_toggle else done_rows
        result_df = _priority_df(export_rows)

        st.markdown(f"**{len(export_rows)}** Zeilen für Export.")
        st.dataframe(result_df, use_container_width=True, height=300)

        dl1, dl2 = st.columns(2)
        case_slug = case["name"].replace(" ","_")[:30]
        with dl1:
            st.download_button("⬇ CSV",
                               data=result_df.to_csv(index=False).encode("utf-8-sig"),
                               file_name=f"{case_slug}_angereichert.csv",
                               mime="text/csv", use_container_width=True)
        with dl2:
            buf = io.BytesIO()
            with pd.ExcelWriter(buf, engine="openpyxl") as w:
                result_df.to_excel(w, index=False, sheet_name="Angereichert")
            buf.seek(0)
            st.download_button("⬇ Excel", data=buf.getvalue(),
                               file_name=f"{case_slug}_angereichert.xlsx",
                               mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                               use_container_width=True)
