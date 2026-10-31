"""Mission loop: claim, run in a worktree, evaluate, promote."""

from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Any

from . import case, dashboard, db, eval as evaluator, handoff, lfs, observability, sampler
from .util import now_iso, run as run_process
from .worktree import branch_at, create_worktree, finalize_commit, head_commit, mission_worktree_path, remove_worktree


def _log(log_dir: Path, name: str, text: str) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / name).write_text(text or "", encoding="utf-8")


def _prepare_worktree(research: Path, worktree: Path, branch: str, mission_id: str) -> dict[str, int]:
    obs = observability.get()
    with obs.span("aleph.worktree.create", {"aleph.mission.id": mission_id, "aleph.branch": branch}) as span:
        create_worktree(research, worktree, branch)
        cow = lfs.cowify_worktree(worktree)
        span.set_attribute("aleph.lfs.cow.files", cow.get("files", 0))
        span.set_attribute("aleph.lfs.cow.bytes", cow.get("bytes", 0))
        return cow


def _run_researcher(
    worktree: Path,
    command: str,
    workspace: Path,
    mission_id: str,
    extra_env: dict[str, str] | None = None,
) -> Any:
    obs = observability.get()
    started = time.monotonic()
    with obs.span("aleph.researcher.run", {"aleph.mission.id": mission_id}) as span:
        env = case.case_env(workspace)
        if extra_env:
            env.update(extra_env)
        env = obs.inject_env(env)
        result = run_process(["bash", "-lc", command], cwd=worktree, timeout=600, env=env)
        span.set_attribute("aleph.command.exit_code", result.returncode)
        obs.record_histogram(
            "aleph.researcher.duration",
            time.monotonic() - started,
            {"aleph.mission.id": mission_id},
            unit="s",
        )
        return result


def _commit_mission(
    worktree: Path,
    mission: dict[str, Any],
    campaign_id: str,
    base_commit: str,
    report: str,
    trace_id: str | None,
    require_handoff: bool,
) -> tuple[str, bool]:
    message = handoff.commit_message(
        mission["id"],
        mission["description"],
        report,
        campaign_id,
        mission["strategy"],
        base_commit,
        trace_id,
    )
    with observability.get().span(
        "aleph.commit",
        {"aleph.mission.id": mission["id"], "aleph.commit.base": base_commit},
    ) as span:
        commit, changed = finalize_commit(worktree, base_commit, message, allow_empty=require_handoff)
        span.set_attribute("aleph.commit.changed", changed)
        span.set_attribute("aleph.commit.sha", commit)
        return commit, changed


def tick(workspace: Path) -> dict[str, Any] | None:
    workspace = workspace.resolve()
    obs = observability.get()
    started = time.monotonic()
    with obs.span("aleph.mission", {"aleph.workspace": str(workspace)}) as span:
        result = _tick(workspace, span)
        elapsed = time.monotonic() - started
        status = (result or {}).get("status", "empty")
        span.set_attribute("aleph.mission.status", status)
        if result:
            span.set_attribute("aleph.mission.id", result.get("mission", ""))
            span.set_attribute("aleph.mission.branch", result.get("branch", ""))
            if result.get("score") is not None:
                span.set_attribute("aleph.eval.score", float(result["score"]))
            if result.get("trace_id"):
                span.set_attribute("aleph.mission.trace_id", result["trace_id"])
        obs.add_counter("aleph.missions", 1, {"aleph.mission.status": status})
        obs.record_histogram("aleph.mission.duration", elapsed, {"aleph.mission.status": status}, unit="s")
        return result


def _tick(workspace: Path, span: Any) -> dict[str, Any] | None:
    research = workspace / "research"
    conn = db.connect(db.db_path(workspace))
    try:
        campaign = db.get_campaign(conn)
        if campaign is None:
            raise RuntimeError("workspace has no campaign")
        mission = db.claim_next_mission(conn, campaign["id"])
        if mission is None:
            dashboard.write(workspace)
            return None
        span.set_attribute("aleph.campaign.id", campaign["id"])
        span.set_attribute("aleph.mission.id", mission["id"])
        span.set_attribute("aleph.mission.strategy", mission["strategy"])
        span.set_attribute("aleph.branch", mission["branch"])

        started = time.monotonic()
        log_dir = workspace / ".aleph" / "runs" / mission["id"]
        log_dir.mkdir(parents=True, exist_ok=True)
        researcher_home = workspace / ".aleph" / "researchers" / mission["id"]
        researcher_home.mkdir(parents=True, exist_ok=True)
        handoff_path = log_dir / "HANDOFF.md"
        require_handoff = mission.get("kind") == "researcher"
        worktree = mission_worktree_path(campaign["id"], mission["id"])
        summary: dict[str, Any] = {"mission": mission["id"], "branch": mission["branch"]}

        try:
            _prepare_worktree(research, worktree, mission["branch"], mission["id"])
            base_commit = head_commit(worktree)
            if mission["command"]:
                result = _run_researcher(
                    worktree,
                    mission["command"],
                    workspace,
                    mission["id"],
                    {
                        "ALEPH_HANDOFF_PATH": str(handoff_path),
                        "ALEPH_RESEARCHER_HOME": str(researcher_home),
                    },
                )
                _log(log_dir, "command.stdout.log", result.stdout)
                _log(log_dir, "command.stderr.log", result.stderr)
                if result.returncode != 0:
                    raise RuntimeError(f"mission command exited with {result.returncode}")

            report = handoff.read(handoff_path) if require_handoff else ""
            if require_handoff and not report:
                raise RuntimeError("researcher handoff report missing")
            commit, changed = _commit_mission(
                worktree,
                mission,
                campaign["id"],
                base_commit,
                report,
                observability.get().trace_id(),
                require_handoff,
            )
            branch_name = mission["branch"]
            if changed:
                branch_name = f"exp/{campaign['id']}/{mission['id']}"
                branch_at(research, branch_name, commit)

            evaluation = evaluator.evaluate(
                workspace,
                research,
                commit,
                mission["id"],
                mission["eval_command"] or evaluator.DEFAULT_EVAL_COMMAND,
            )
            _log(log_dir, "eval.stdout.log", evaluation.get("stdout", ""))
            _log(log_dir, "eval.stderr.log", evaluation.get("stderr", ""))
            if evaluation.get("error"):
                raise RuntimeError(evaluation["error"])
            evaluation["trace_id"] = observability.get().trace_id()
            score = float(evaluation["score"])
            finished = now_iso()
            db.update_mission(
                conn,
                mission["id"],
                status="done",
                score=score,
                result=evaluation,
                log_dir=str(log_dir),
                commit_sha=commit,
                branch=branch_name,
                finished_at=finished,
            )
            db.update_campaign(conn, campaign["id"], spent=campaign["spent"] + 1.0)
            obs = observability.get()
            obs.record_histogram("aleph.branch.score", score, {"aleph.branch": branch_name})
            obs.record_histogram("aleph.budget.spent", campaign["spent"] + 1.0,
                                 {"aleph.campaign.id": campaign["id"]})
            if isinstance(evaluation.get("rows"), int):
                obs.record_histogram("aleph.eval.rows", int(evaluation["rows"]),
                                     {"aleph.mission.id": mission["id"]})
            try:
                usage = shutil.disk_usage(workspace)
                obs.record_histogram("aleph.disk.used", usage.used, {"aleph.workspace": str(workspace)}, unit="By")
            except OSError:
                pass
            db.upsert_branch(
                conn,
                campaign["id"],
                branch_name,
                mission.get("base_branch") or mission["branch"],
                mission["id"],
                score,
                False,
            )

            campaign = db.get_campaign(conn, campaign["id"])
            if score > campaign["sota_score"]:
                with observability.get().span(
                    "aleph.sota.promote",
                    {"aleph.campaign.id": campaign["id"], "aleph.mission.id": mission["id"], "aleph.score": score},
                ) as promote_span:
                    branch_at(research, "sota/main", commit)
                    db.set_sota(conn, campaign["id"], "sota/main", score)
                    db.upsert_branch(
                        conn, campaign["id"], "sota/main", branch_name, mission["id"], score, True
                    )
                    promote_span.set_attribute("aleph.branch", "sota/main")
                observability.get().add_counter(
                    "aleph.sota.promotions", 1, {"aleph.campaign.id": campaign["id"]}
                )
                summary["promoted"] = True
            summary.update(
                {
                    "status": "done",
                    "score": score,
                    "commit": commit,
                    "branch": branch_name,
                    "sota_branch": db.get_campaign(conn, campaign["id"])["sota_branch"],
                    "seconds": round(time.monotonic() - started, 3),
                    "trace_id": observability.get().trace_id(),
                }
            )
            return summary
        except Exception as exc:  # noqa: BLE001 - one failed mission must not kill the loop
            db.update_mission(
                conn,
                mission["id"],
                status="failed",
                error=str(exc),
                log_dir=str(log_dir),
                finished_at=now_iso(),
            )
            summary.update({"status": "failed", "error": str(exc)})
            return summary
        finally:
            with observability.get().span(
                "aleph.researcher.reclaim",
                {"aleph.mission.id": mission["id"], "aleph.worktree": str(worktree)},
            ) as reclaim_span:
                remove_worktree(research, worktree)
                shutil.rmtree(researcher_home, ignore_errors=True)
                reclaim_span.set_attribute("aleph.reclaimed", True)
            summary["reclaimed"] = True
            dashboard.write(workspace)
    finally:
        conn.close()


def cycle(workspace: Path, rounds: int, command: str, strategy: str | None = None) -> list[dict[str, Any]]:
    """Queue one researcher mission per round from the current SOTA and run it."""
    results: list[dict[str, Any]] = []
    for _ in range(max(0, rounds)):
        conn = db.connect(db.db_path(workspace))
        try:
            campaign = db.get_campaign(conn)
            if campaign is None:
                raise RuntimeError("workspace has no campaign")
            branch = campaign["sota_branch"] or "initialize"
            chosen = strategy if strategy not in (None, "", "auto") else sampler.sample(
                campaign["exploration"]
            )["strategy"]
            mission = db.add_mission(
                conn,
                campaign["id"],
                branch=branch,
                description=f"researcher round: {Path(command).name}",
                strategy=chosen,
                base_branch=branch,
                command=command,
                kind="researcher",
            )
        finally:
            conn.close()
        dashboard.write(workspace)
        result = tick(workspace)
        if result is None:
            break
        results.append(result)
        if result.get("status") != "done":
            break
    return results


def run(workspace: Path, max_missions: int = 10) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for _ in range(max(0, max_missions)):
        item = tick(workspace)
        if item is None:
            break
        results.append(item)
    return results
