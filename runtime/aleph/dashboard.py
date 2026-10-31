"""Dashboard snapshot consumed by the DSH console panel."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from . import db
from .util import aleph_home, atomic_write_text, now_iso, write_json


def pointer_path() -> Path:
    return aleph_home() / "current_workspace"


def set_current_workspace(workspace: Path) -> None:
    atomic_write_text(pointer_path(), str(workspace.resolve()) + "\n")


def get_current_workspace() -> Path | None:
    try:
        value = pointer_path().read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return Path(value) if value else None


def build(workspace: Path, conn) -> dict[str, Any]:
    campaign = db.get_campaign(conn)
    if campaign is None:
        raise RuntimeError("workspace has no campaign")
    rows = db.dashboard_rows(conn, campaign["id"])
    missions = [
        {
            "id": item["id"],
            "status": item["status"],
            "strategy": item["strategy"],
            "branch": item["branch"],
            "score": item["score"],
            "description": item["description"],
            "created_at": item["created_at"],
            "finished_at": item["finished_at"],
        }
        for item in rows["missions"]
    ]
    branches = [
        {
            "name": item["name"],
            "score": item["score"],
            "parent": item["parent"],
            "mission": item["mission_id"],
            "is_sota": bool(item["is_sota"]),
        }
        for item in rows["branches"]
    ]
    return {
        "schema": 1,
        "generated_at": now_iso(),
        "workspace": str(workspace.resolve()),
        "campaign": {
            "id": campaign["id"],
            "title": campaign["title"],
            "status": campaign["status"],
            "exploration": campaign["exploration"],
            "sota_branch": campaign["sota_branch"],
            "sota_score": campaign["sota_score"],
            "budget": campaign["budget"],
            "spent": campaign["spent"],
        },
        "missions": missions,
        "branches": branches,
        "counts": rows["counts"],
    }


def write(workspace: Path) -> dict[str, Any]:
    conn = db.connect(db.db_path(workspace))
    try:
        data = build(workspace, conn)
    finally:
        conn.close()
    write_json(workspace / ".aleph" / "dashboard.json", data)
    set_current_workspace(workspace)
    return data
