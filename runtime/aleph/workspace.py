"""Leader workspace initialization and mission creation."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import dashboard, db, lfs, sampler
from .util import git, now_iso, write_json

DEFAULT_EXPLORATION = 0.7
DEMO_BRANCHES = {"exp/a": 5, "exp/b": 3, "exp/c": 7}

TOY_EVAL = '''#!/usr/bin/env python3
"""Toy evaluator: compare answer() against the hidden target."""

import importlib.util
import json
import os
import sys

solution_dir = os.environ["ALEPH_SOLUTION_DIR"]
testset_dir = os.environ["ALEPH_TESTSET"]
with open(os.path.join(testset_dir, "hidden.json"), encoding="utf-8") as handle:
    target = json.load(handle)["target"]

path = os.path.join(solution_dir, "solution.py")
spec = importlib.util.spec_from_file_location("aleph_solution", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
value = module.answer()
score = 1.0 / (1.0 + abs(float(value) - float(target)))
print(json.dumps({"score": score, "value": value, "target": target}))
'''

TOY_SOLUTION = '''def answer():
    return {value}
'''


def _git_init(repo: Path, branch: str) -> None:
    if (repo / ".git").exists():
        return
    repo.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["git", "init", "-b", branch], cwd=str(repo), text=True, capture_output=True
    )
    if result.returncode != 0:
        subprocess.run(["git", "init"], cwd=str(repo), check=True, text=True, capture_output=True)
        subprocess.run(
            ["git", "symbolic-ref", "HEAD", f"refs/heads/{branch}"],
            cwd=str(repo),
            check=True,
            text=True,
            capture_output=True,
        )


def _commit(repo: Path, message: str) -> None:
    git(repo, "add", "-A")
    git(repo, "commit", "-m", message)


def _init_research(research: Path) -> None:
    _git_init(research, "initialize")
    lfs.ensure(research)
    (research / "solution.py").write_text(TOY_SOLUTION.format(value=1), encoding="utf-8")
    _commit(research, "initialize contract")
    for branch, value in DEMO_BRANCHES.items():
        git(research, "checkout", "-b", branch, "initialize")
        (research / "solution.py").write_text(TOY_SOLUTION.format(value=value), encoding="utf-8")
        _commit(research, f"candidate {branch}")
    git(research, "checkout", "initialize")
    git(research, "branch", "sota/main", "initialize")


def _init_leader_repo(workspace: Path) -> None:
    _git_init(workspace, "main")
    lfs.ensure(workspace)
    (workspace / ".gitignore").write_text(".aleph/\nresearch/\n__pycache__/\n.venv/\n", encoding="utf-8")
    (workspace / "eval").mkdir(exist_ok=True)
    (workspace / "testsets").mkdir(exist_ok=True)
    (workspace / "eval" / "run_eval.py").write_text(TOY_EVAL, encoding="utf-8")
    write_json(workspace / "testsets" / "hidden.json", {"target": 7})
    git(workspace, "add", ".gitattributes", ".gitignore", "eval", "testsets")
    git(workspace, "commit", "-m", "leader workspace scaffold")


def init_workspace(
    workspace: Path,
    title: str | None = None,
    demo: bool = True,
    force: bool = False,
) -> dict[str, Any]:
    workspace = workspace.expanduser().resolve()
    db_file = db.db_path(workspace)
    if db_file.exists() and not force:
        raise FileExistsError(f"workspace already initialized: {workspace}")
    if force:
        shutil.rmtree(workspace / ".aleph", ignore_errors=True)

    workspace.mkdir(parents=True, exist_ok=True)
    _init_leader_repo(workspace)
    _init_research(workspace / "research")
    (workspace / ".aleph").mkdir(exist_ok=True)
    db.init_db(db_file)

    conn = db.connect(db_file)
    try:
        campaign = db.create_campaign(
            conn,
            workspace,
            title or workspace.name,
            exploration=DEFAULT_EXPLORATION,
        )
        db.upsert_branch(conn, campaign["id"], "initialize", None, None, None, False)
        db.upsert_branch(conn, campaign["id"], "sota/main", "initialize", None, None, False)
        if demo:
            for branch, description in (
                ("exp/a", "candidate a"),
                ("exp/b", "candidate b"),
                ("exp/c", "candidate c"),
            ):
                _enqueue(conn, campaign, branch, description, strategy=None)
    finally:
        conn.close()

    dashboard.write(workspace)
    return {"workspace": str(workspace), "campaign_id": campaign["id"]}


def _enqueue(
    conn,
    campaign: dict[str, Any],
    branch: str,
    description: str,
    strategy: str | None,
    kind: str = "experiment",
) -> dict[str, Any]:
    if strategy in (None, "", "auto"):
        info = sampler.sample(campaign["exploration"], seed=None)
        chosen = info["strategy"]
        db.record_sample(
            conn,
            campaign["id"],
            None,
            campaign["exploration"],
            info["tau"],
            chosen,
            info["probabilities"],
            info["q"],
            info["seed"] or 0,
        )
    else:
        chosen = strategy
    return db.add_mission(
        conn,
        campaign["id"],
        branch=branch,
        description=description,
        strategy=chosen,
        base_branch=sampler.base_branch(chosen, campaign.get("sota_branch")),
        kind=kind,
    )


def add_mission(
    workspace: Path,
    branch: str,
    description: str = "",
    strategy: str | None = None,
    command: str = "",
    eval_command: str = "",
    kind: str = "experiment",
) -> dict[str, Any]:
    research = workspace / "research"
    result = git(research, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False)
    if result.returncode != 0:
        raise ValueError(f"research branch does not exist: {branch}")
    conn = db.connect(db.db_path(workspace))
    try:
        campaign = db.get_campaign(conn)
        if campaign is None:
            raise RuntimeError("workspace has no campaign")
        if strategy not in (None, "", "auto") and strategy not in sampler.STRATEGIES:
            raise ValueError(f"unknown strategy: {strategy}")
        mission = _enqueue(conn, campaign, branch, description, strategy, kind)
        if command:
            db.update_mission(conn, mission["id"], command=command)
        if eval_command:
            db.update_mission(conn, mission["id"], eval_command=eval_command)
        mission = db.get_mission(conn, mission["id"])
    finally:
        conn.close()
    dashboard.write(workspace)
    return mission
