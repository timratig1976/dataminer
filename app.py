"""
DataMiner – Multi-Case Streamlit Web-UI
Each case has its own input, output, logs and settings.
"""

import io
import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from input_handler import load_file, normalize, detect_columns
from pipeline import enrich_row
from extractor import EXTRACTION_FIELDS, SYSTEM_PROMPT
from case_manager import (
    create_case, list_cases, get_case, delete_case,
    save_input, save_rows, load_rows, save_output,
    append_log, read_log, get_output_csv, get_input_csv,
    update_settings, get_settings, update_meta, STATUS_EMOJI,
)

load_dotenv()
logging.basicConfig(level=logging.INFO)

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
                                {"company_name": r["company_name"],
                                 "input_url": r.get("input_url",""),
                                 "_status": "pending"}
                                for _, r in norm.iterrows()
                            ]
                            save_rows(active_id, new_rows)
                            append_log(active_id, f"Input geladen: {len(new_rows)} Zeilen aus '{uploaded.name}'")
                            st.rerun()
                    except ValueError as e:
                        st.error(str(e))
            except ValueError as e:
                st.error(str(e))

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
                    save_rows(active_id, [{"company_name": r["company_name"],
                                           "input_url": r.get("input_url",""),
                                           "_status": "pending"} for r in rows])
                    append_log(active_id, "Kompletter Reset aller Zeilen")
                    st.rerun()
        with b4:
            st.metric("Ziel", target_count, label_visibility="visible")

        # Handle range-reset
        if do_reset_sel and not st.session_state["running"]:
            for i in target_indices:
                rows[i] = {"company_name": rows[i]["company_name"],
                           "input_url": rows[i].get("input_url",""),
                           "_status": "pending"}
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

        df_ag = pd.DataFrame([{
            "#":          i + 1,
            "_idx":       i,
            "Firma":      r.get("company_name", ""),
            "Status":     STATUS_LABEL.get(r.get("_status","pending"), r.get("_status","")),
            "Qualität %": r.get("_quality_score") or 0,
            "Website":    r.get("_website_found") or "",
            "Email":      r.get("email_general") or r.get("email_contact") or "",
            "Telefon":    r.get("phone") or "",
            "GF":         r.get("managing_director") or "",
            "PLZ":        r.get("zip") or "",
            "Ort":        r.get("city") or "",
            "Branche":    r.get("industry") or "",
        } for i, r in enumerate(rows)])

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
        gb.configure_column("#",        width=60,  pinned="left")
        gb.configure_column("Firma",    width=200, pinned="left")
        gb.configure_column("Status",   width=140, cellStyle=status_style)
        gb.configure_column("Qualität %", width=100, type=["numericColumn"])
        gb.configure_column("Website",  width=180)
        gb.configure_column("Email",    width=200)
        gb.configure_column("Telefon",  width=130)
        gb.configure_column("GF",       width=160)
        gb.configure_column("PLZ",      width=70)
        gb.configure_column("Ort",      width=120)
        gb.configure_column("Branche",  width=140)
        gb.configure_selection("multiple", use_checkbox=True, header_checkbox=True)
        gb.configure_pagination(enabled=True, paginationAutoPageSize=False, paginationPageSize=50)
        gb.configure_grid_options(suppressMovableColumns=False, enableRangeSelection=True)

        grid_opts = gb.build()

        if is_running:
            tbl_ph = st.empty()
            render_table(rows, tbl_ph)
        else:
            ag_resp = AgGrid(
                df_ag,
                gridOptions=grid_opts,
                height=550,
                update_mode=GridUpdateMode.SELECTION_CHANGED,
                data_return_mode=DataReturnMode.FILTERED_AND_SORTED,
                allow_unsafe_jscode=True,
                use_container_width=True,
                theme="alpine",
                key=f"ag_{active_id}",
            )

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
                sa1, sa2, sa3 = st.columns([1.5, 1.5, 3])
                with sa1:
                    if st.button(f"▶ Auswahl starten ({sel_count})",
                                 key=f"ag_run_{active_id}", type="primary",
                                 use_container_width=True):
                        for i in sel_indices:
                            rows[i] = {"company_name": rows[i]["company_name"],
                                       "input_url": rows[i].get("input_url",""),
                                       "_status": "pending"}
                        save_rows(active_id, rows)
                        st.session_state["_sel_run_indices"] = sel_indices
                        st.rerun()
                with sa2:
                    if st.button(f"↺ Auswahl reset ({sel_count})",
                                 key=f"ag_rst_{active_id}",
                                 use_container_width=True):
                        for i in sel_indices:
                            rows[i] = {"company_name": rows[i]["company_name"],
                                       "input_url": rows[i].get("input_url",""),
                                       "_status": "pending"}
                        save_rows(active_id, rows)
                        st.rerun()
                with sa3:
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
            rows_lock = Lock()
            completed = [0]
            n_workers = int(workers)

            def process_one(idx):
                """Worker: enrich one row, update shared rows list."""
                if st.session_state.get("stop_requested"):
                    return
                row     = rows[idx]
                company = row["company_name"]
                url     = row.get("input_url") or None

                with rows_lock:
                    rows[idx]["_status"] = "running"
                append_log(active_id, f"Start: {company}")

                enriched = enrich_row(company, url, api_key=api_key or None,
                                      deep=st.session_state.get(f"deep_{active_id}", False))
                enriched["company_name"] = company
                enriched["input_url"]    = url or ""

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
    st.markdown("#### ✏️ System-Prompt")
    st.caption("Zellvariablen: `{impressum}`, `{contact}`, `{homepage}`, `{social_links}`")
    current_prompt = case_settings.get("system_prompt", SYSTEM_PROMPT)
    new_prompt = st.text_area("System-Prompt", value=current_prompt, height=280,
                              key=f"prompt_{active_id}", label_visibility="collapsed")
    if new_prompt != current_prompt:
        update_settings(active_id, {"system_prompt": new_prompt})
        st.success("✓ Prompt gespeichert")

    with st.expander("Verfügbare Variablen"):
        st.markdown("""
        | Variable | Inhalt |
        |----------|--------|
        | `{impressum}` | Text der Impressum-Seite |
        | `{contact}` | Text der Kontakt-Seite |
        | `{homepage}` | Homepage-Text |
        | `{social_links}` | Gefundene Social-Media URLs |
        """)

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
