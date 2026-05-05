"""
Case management: persistent storage of cases (input, output, logs, settings).
Each case lives in cases/<case_id>/ with:
  - meta.json       – name, created_at, status, settings
  - input.csv       – original uploaded file (normalized)
  - output.csv      – enriched results so far
  - rows.json       – live row state (for resume)
  - run.log         – per-case log output
"""

import json
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import pandas as pd

CASES_DIR = Path("cases")
CASES_DIR.mkdir(exist_ok=True)

logger = logging.getLogger(__name__)


def _case_dir(case_id: str) -> Path:
    return CASES_DIR / case_id


def create_case(name: str, settings: dict) -> str:
    """Create a new case, return its ID."""
    case_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
    d = _case_dir(case_id)
    d.mkdir(parents=True, exist_ok=True)

    meta = {
        "id": case_id,
        "name": name,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "status": "new",
        "total_rows": 0,
        "done_rows": 0,
        "success_rows": 0,
        "settings": settings,
    }
    _write_meta(case_id, meta)

    # Create empty log
    (d / "run.log").write_text("", encoding="utf-8")
    return case_id


def list_cases() -> list[dict]:
    """Return all cases sorted by created_at desc."""
    cases = []
    for p in CASES_DIR.iterdir():
        if p.is_dir():
            meta_path = p / "meta.json"
            if meta_path.exists():
                try:
                    data = json.loads(meta_path.read_text(encoding="utf-8"))
                    # Auto-recover stuck 'running' status from crashed/restarted runs
                    if data.get("status") == "running":
                        data["status"] = "partial"
                        meta_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    cases.append(data)
                except Exception:
                    pass
    return sorted(cases, key=lambda c: c.get("created_at", ""), reverse=True)


def get_case(case_id: str) -> Optional[dict]:
    meta_path = _case_dir(case_id) / "meta.json"
    if not meta_path.exists():
        return None
    return json.loads(meta_path.read_text(encoding="utf-8"))


def _sanitize(obj):
    """Strip newlines/CR from all string values recursively."""
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, str):
        return obj.replace("\n", "").replace("\r", "").strip()
    return obj


def _write_meta(case_id: str, meta: dict):
    meta["updated_at"] = datetime.now().isoformat()
    (_case_dir(case_id) / "meta.json").write_text(
        json.dumps(_sanitize(meta), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def update_meta(case_id: str, **kwargs):
    meta = get_case(case_id) or {}
    meta.update(kwargs)
    _write_meta(case_id, meta)


def save_input(case_id: str, df: pd.DataFrame):
    df.to_csv(_case_dir(case_id) / "input.csv", index=False, encoding="utf-8-sig")
    update_meta(case_id, total_rows=len(df), status="ready")


def save_rows(case_id: str, rows: list[dict]):
    """Persist current row state (for resume after crash/close)."""
    (_case_dir(case_id) / "rows.json").write_text(
        json.dumps(rows, ensure_ascii=False, default=str), encoding="utf-8"
    )
    done   = sum(1 for r in rows if r.get("_status") in ("success", "error", "no_website"))
    success = sum(1 for r in rows if r.get("_status") == "success")
    status = "running" if any(r.get("_status") == "running" for r in rows) \
        else ("done" if done == len(rows) else "partial")
    update_meta(case_id, done_rows=done, success_rows=success, status=status)


def load_rows(case_id: str) -> list[dict]:
    p = _case_dir(case_id) / "rows.json"
    if not p.exists():
        return []
    raw = p.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # "Extra data" → truncate at the error position and retry
        try:
            result = json.loads(raw[:e.pos])
            if isinstance(result, list):
                logger.warning(f"[{case_id}] rows.json repaired (extra data at {e.pos})")
                p.write_text(json.dumps(result, ensure_ascii=False, default=str), encoding="utf-8")
                return result
        except json.JSONDecodeError:
            pass
        logger.error(f"[{case_id}] rows.json unrecoverable: {e}")
        return []


def save_output(case_id: str, rows: list[dict]):
    """Write finished rows as output CSV."""
    done = [r for r in rows if r.get("_status") == "success"]
    if done:
        pd.DataFrame(done).to_csv(
            _case_dir(case_id) / "output.csv", index=False, encoding="utf-8-sig"
        )


def append_log(case_id: str, message: str):
    log_path = _case_dir(case_id) / "run.log"
    ts = datetime.now().strftime("%H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {message}\n")


def read_log(case_id: str) -> str:
    log_path = _case_dir(case_id) / "run.log"
    if not log_path.exists():
        return ""
    return log_path.read_text(encoding="utf-8")


def get_output_csv(case_id: str) -> Optional[bytes]:
    p = _case_dir(case_id) / "output.csv"
    return p.read_bytes() if p.exists() else None


def get_input_csv(case_id: str) -> Optional[bytes]:
    p = _case_dir(case_id) / "input.csv"
    return p.read_bytes() if p.exists() else None


def delete_case(case_id: str):
    import shutil
    shutil.rmtree(_case_dir(case_id), ignore_errors=True)


def get_settings(case_id: str) -> dict:
    meta = get_case(case_id) or {}
    return meta.get("settings", {})


def update_settings(case_id: str, settings: dict):
    meta = get_case(case_id) or {}
    meta["settings"] = {**meta.get("settings", {}), **settings}
    _write_meta(case_id, meta)


STATUS_EMOJI = {
    "new":     "🆕",
    "ready":   "📋",
    "running": "⏳",
    "partial": "◑",
    "done":    "✅",
}
