"""Leader-side evaluation of a submitted commit."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from . import case, lfs, observability
from .util import run
from .worktree import create_worktree, remove_worktree

DEFAULT_EVAL_COMMAND = "python3 eval/run_eval.py"


def parse_score(stdout: str) -> dict[str, Any]:
    """Return the last JSON object line that carries a numeric score."""
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            payload = json.loads(line)
        except ValueError:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("score"), (int, float)):
            return payload
    raise ValueError("evaluation did not emit a JSON object with a numeric score")


def evaluate(
    workspace: Path,
    research_root: Path,
    commit: str,
    mission_id: str,
    eval_command: str = "",
    timeout: int = 180,
) -> dict[str, Any]:
    """Check out the commit inside the leader workspace and run the evaluator."""
    obs = observability.get()
    with obs.span(
        "aleph.evaluate",
        {"aleph.mission.id": mission_id, "aleph.commit": commit, "aleph.eval.command": eval_command or DEFAULT_EVAL_COMMAND},
    ) as span:
        payload = _evaluate(workspace, research_root, commit, mission_id, eval_command, timeout)
        if payload.get("error"):
            span.set_attribute("aleph.eval.error", str(payload["error"]))
        else:
            score = payload.get("score")
            if isinstance(score, (int, float)):
                span.set_attribute("aleph.eval.score", float(score))
                obs.record_histogram("aleph.eval.score", float(score), {"aleph.mission.id": mission_id})
            rows = payload.get("rows")
            if isinstance(rows, int):
                span.set_attribute("aleph.eval.rows", rows)
        return payload


def _evaluate(
    workspace: Path,
    research_root: Path,
    commit: str,
    mission_id: str,
    eval_command: str = "",
    timeout: int = 180,
) -> dict[str, Any]:
    command = (eval_command or DEFAULT_EVAL_COMMAND).strip()
    eval_root = workspace / ".aleph" / "evals" / mission_id
    checkout = eval_root / "repo"
    if eval_root.exists():
        shutil.rmtree(eval_root)
    create_worktree(research_root, checkout, commit)
    lfs.cowify_worktree(checkout)
    env = {
        "ALEPH_SOLUTION_DIR": str(checkout),
        "ALEPH_TESTSET": str(workspace / "testsets"),
        "ALEPH_SUBMISSION": commit,
        "PYTHONPATH": str(checkout),
    }
    env.update(case.case_env(workspace))
    env = observability.get().inject_env(env)
    try:
        result = run(["bash", "-lc", command], cwd=workspace, timeout=timeout, env=env)
        payload: dict[str, Any] = {
            "command": command,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
        }
        if result.returncode != 0:
            payload["error"] = f"evaluator exited with {result.returncode}"
            return payload
        try:
            parsed = parse_score(result.stdout)
        except ValueError as exc:
            payload["error"] = str(exc)
            return payload
        payload.update(parsed)
        return payload
    finally:
        remove_worktree(research_root, checkout)
        shutil.rmtree(eval_root, ignore_errors=True)
