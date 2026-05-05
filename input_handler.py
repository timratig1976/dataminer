"""
Flexible CSV/Excel input normalization.
Detects company name and URL columns regardless of header naming.
"""

import io
import logging
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

# Common column name variants (lowercase) → canonical name
NAME_ALIASES = [
    "firma", "firmenname", "unternehmen", "unternehmensname", "company",
    "company name", "name", "organisation", "organization", "kunde",
    "kundenname", "client", "bezeichnung",
]
URL_ALIASES = [
    "url", "website", "webseite", "homepage", "web", "domain", "link",
    "www", "internet", "site",
]


def _detect_column(df: pd.DataFrame, aliases: list[str]) -> Optional[str]:
    for col in df.columns:
        if col.strip().lower() in aliases:
            return col
    # partial match
    for col in df.columns:
        cl = col.strip().lower()
        for alias in aliases:
            if alias in cl or cl in alias:
                return col
    return None


def load_file(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """Load CSV or Excel from bytes, return raw DataFrame."""
    fn = filename.lower()
    if fn.endswith(".csv"):
        # Try common encodings and separators
        for enc in ["utf-8", "latin-1", "cp1252"]:
            for sep in [",", ";", "\t"]:
                try:
                    df = pd.read_csv(
                        io.BytesIO(file_bytes),
                        encoding=enc,
                        sep=sep,
                        dtype=str,
                    )
                    if len(df.columns) > 1:
                        return df
                except Exception:
                    continue
        raise ValueError("Konnte CSV nicht einlesen. Bitte Trennzeichen und Encoding prüfen.")
    elif fn.endswith((".xlsx", ".xls")):
        return pd.read_excel(io.BytesIO(file_bytes), dtype=str)
    else:
        raise ValueError(f"Nicht unterstütztes Dateiformat: {filename}")


def normalize(df: pd.DataFrame, name_col: Optional[str] = None, url_col: Optional[str] = None) -> pd.DataFrame:
    """
    Return DataFrame with canonical columns: 'company_name', 'input_url'.
    name_col / url_col can be passed explicitly (from UI mapping).
    """
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    if not name_col:
        name_col = _detect_column(df, NAME_ALIASES)
    if not url_col:
        url_col = _detect_column(df, URL_ALIASES)

    if not name_col:
        raise ValueError(
            "Keine Firmenname-Spalte gefunden. Bitte manuell zuordnen.\n"
            f"Verfügbare Spalten: {list(df.columns)}"
        )

    out = pd.DataFrame()
    out["company_name"] = df[name_col].fillna("").str.strip()
    out["input_url"] = df[url_col].fillna("").str.strip() if url_col else ""

    # Keep all original columns for reference
    for col in df.columns:
        if col not in (name_col, url_col):
            out[f"original_{col}"] = df[col]

    out = out[out["company_name"] != ""].reset_index(drop=True)
    return out


def detect_columns(df: pd.DataFrame) -> dict:
    """Return auto-detected column mapping for UI display."""
    return {
        "name_col": _detect_column(df, NAME_ALIASES),
        "url_col": _detect_column(df, URL_ALIASES),
        "all_columns": list(df.columns),
    }
