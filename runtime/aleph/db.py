"""SQLite state store for the first runtime version.

The runtime keeps a single SQLite file per leader workspace.  Every CLI
operation opens a short connection; WAL mode and BEGIN IMMEDIATE keep the
claim path safe when a human runs two commands at the same time.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .util import now_iso

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  root TEXT NOT NULL,
  exploration REAL NOT NULL DEFAULT 0.7,
  sota_branch TEXT,
  sota_score REAL NOT NULL DEFAULT -999999.0,
  budget REAL NOT NULL DEFAULT 100.0,
  spent REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'experiment',
  strategy TEXT NOT NULL DEFAULT 'L1',
  base_branch TEXT,
  branch TEXT NOT NULL,
  command TEXT NOT NULL DEFAULT '',
  eval_command TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  score REAL,
  result_json TEXT,
  log_dir TEXT,
  commit_sha TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS branches (
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent TEXT,
  mission_id TEXT,
  score REAL,
  is_sota INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, name)
);

CREATE TABLE IF NOT EXISTS strategy_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  mission_id TEXT,
  exploration REAL NOT NULL,
  tau REAL NOT NULL,
  strategy TEXT NOT NULL,
  probabilities_json TEXT NOT NULL,
  q_json TEXT NOT NULL,
  seed INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
"""


def db_path(workspace: Path) -> Path:
    return workspace / ".aleph" / "state.sqlite"


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(path: Path) -> None:
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        row = conn.execute("SELECT version FROM schema_version").fetchone()
        if row is None:
            conn.execute("INSERT INTO schema_version(version) VALUES (?)", (SCHEMA_VERSION,))
        conn.commit()
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def create_campaign(
    conn: sqlite3.Connection,
    root: Path,
    title: str,
    exploration: float = 0.7,
    budget: float = 100.0,
    campaign_id: str | None = None,
) -> dict[str, Any]:
    cid = campaign_id or new_id("c")
    stamp = now_iso()
    conn.execute(
        "INSERT INTO campaigns(id, title, root, exploration, budget, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (cid, title, str(root), exploration, budget, stamp, stamp),
    )
    conn.commit()
    return get_campaign(conn, cid)


def get_campaign(conn: sqlite3.Connection, campaign_id: str | None = None) -> dict[str, Any] | None:
    if campaign_id:
        row = conn.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
    else:
        row = conn.execute("SELECT * FROM campaigns ORDER BY created_at LIMIT 1").fetchone()
    return dict(row) if row else None


def update_campaign(conn: sqlite3.Connection, campaign_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = now_iso()
    columns = ", ".join(f"{key} = ?" for key in fields)
    conn.execute(f"UPDATE campaigns SET {columns} WHERE id = ?", (*fields.values(), campaign_id))
    conn.commit()


def add_mission(
    conn: sqlite3.Connection,
    campaign_id: str,
    branch: str,
    description: str = "",
    strategy: str = "L1",
    base_branch: str | None = None,
    command: str = "",
    eval_command: str = "",
    kind: str = "experiment",
) -> dict[str, Any]:
    mid = new_id("m")
    stamp = now_iso()
    conn.execute(
        "INSERT INTO missions(id, campaign_id, description, kind, strategy, base_branch, branch, "
        "command, eval_command, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (mid, campaign_id, description, kind, strategy, base_branch, branch, command, eval_command, stamp),
    )
    conn.commit()
    return get_mission(conn, mid)


def get_mission(conn: sqlite3.Connection, mission_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM missions WHERE id = ?", (mission_id,)).fetchone()
    return dict(row) if row else None


def list_missions(conn: sqlite3.Connection, campaign_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM missions WHERE campaign_id = ? ORDER BY created_at, rowid",
        (campaign_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def claim_next_mission(conn: sqlite3.Connection, campaign_id: str) -> dict[str, Any] | None:
    with transaction(conn):
        row = conn.execute(
            "SELECT * FROM missions WHERE campaign_id = ? AND status = 'queued' "
            "ORDER BY created_at, rowid LIMIT 1",
            (campaign_id,),
        ).fetchone()
        if row is None:
            return None
        stamp = now_iso()
        conn.execute(
            "UPDATE missions SET status = 'running', started_at = ? WHERE id = ?",
            (stamp, row["id"]),
        )
        mission = dict(row)
        mission["status"] = "running"
        mission["started_at"] = stamp
        return mission


def update_mission(conn: sqlite3.Connection, mission_id: str, **fields: Any) -> None:
    if not fields:
        return
    if "result" in fields:
        fields["result_json"] = json.dumps(fields.pop("result"), ensure_ascii=False)
    columns = ", ".join(f"{key} = ?" for key in fields)
    conn.execute(f"UPDATE missions SET {columns} WHERE id = ?", (*fields.values(), mission_id))
    conn.commit()


def upsert_branch(
    conn: sqlite3.Connection,
    campaign_id: str,
    name: str,
    parent: str | None,
    mission_id: str | None,
    score: float | None,
    is_sota: bool,
) -> None:
    conn.execute(
        "INSERT INTO branches(campaign_id, name, parent, mission_id, score, is_sota, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(campaign_id, name) DO UPDATE SET "
        "parent = excluded.parent, mission_id = excluded.mission_id, score = excluded.score, "
        "is_sota = excluded.is_sota, updated_at = excluded.updated_at",
        (campaign_id, name, parent, mission_id, score, 1 if is_sota else 0, now_iso()),
    )
    conn.commit()


def set_sota(conn: sqlite3.Connection, campaign_id: str, branch: str, score: float) -> None:
    conn.execute("UPDATE campaigns SET sota_branch = ?, sota_score = ?, updated_at = ? WHERE id = ?",
                 (branch, score, now_iso(), campaign_id))
    conn.execute("UPDATE branches SET is_sota = 0 WHERE campaign_id = ?", (campaign_id,))
    conn.execute(
        "INSERT INTO branches(campaign_id, name, is_sota, updated_at) VALUES (?, ?, 1, ?) "
        "ON CONFLICT(campaign_id, name) DO UPDATE SET is_sota = 1, updated_at = excluded.updated_at",
        (campaign_id, branch, now_iso()),
    )
    conn.commit()


def record_sample(
    conn: sqlite3.Connection,
    campaign_id: str,
    mission_id: str | None,
    exploration: float,
    tau: float,
    strategy: str,
    probabilities: dict[str, float],
    q: dict[str, float],
    seed: int,
) -> None:
    conn.execute(
        "INSERT INTO strategy_samples(campaign_id, mission_id, exploration, tau, strategy, "
        "probabilities_json, q_json, seed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            campaign_id,
            mission_id,
            exploration,
            tau,
            strategy,
            json.dumps(probabilities, ensure_ascii=False),
            json.dumps(q, ensure_ascii=False),
            seed,
            now_iso(),
        ),
    )
    conn.commit()


def list_branches(conn: sqlite3.Connection, campaign_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM branches WHERE campaign_id = ? ORDER BY is_sota DESC, updated_at DESC",
        (campaign_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def dashboard_rows(conn: sqlite3.Connection, campaign_id: str) -> dict[str, Any]:
    missions = list_missions(conn, campaign_id)
    branches = list_branches(conn, campaign_id)
    counts = {key: 0 for key in ("queued", "running", "done", "failed")}
    for mission in missions:
        counts[mission["status"]] = counts.get(mission["status"], 0) + 1
    return {"missions": missions, "branches": branches, "counts": counts}
