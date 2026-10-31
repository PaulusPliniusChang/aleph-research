"""Optional case metadata for a leader workspace.

A case file at <workspace>/.aleph/case.json carries paths and environment that
are shared with mission commands and the evaluator. It keeps dataset layouts
out of the generic scheduler.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

CASE_FILE = ".aleph/case.json"


def read_case(workspace: Path) -> dict[str, Any]:
    path = workspace / CASE_FILE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def case_env(workspace: Path) -> dict[str, str]:
    data = read_case(workspace)
    env: dict[str, str] = {"ALEPH_WORKSPACE": str(workspace.resolve())}
    visible = data.get("visible_data")
    if isinstance(visible, str) and visible:
        env["ALEPH_VISIBLE_DATA"] = visible
    case_root = data.get("case_root")
    if isinstance(case_root, str) and case_root:
        env["ALEPH_CASE_ROOT"] = case_root
    extra = data.get("env")
    if isinstance(extra, dict):
        for key, value in extra.items():
            if isinstance(key, str) and isinstance(value, (str, int, float)):
                env[key] = str(value)
    return env
