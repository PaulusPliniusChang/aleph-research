"""Command line interface for the first AlephResearch runtime."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from . import dashboard, db, observability, scheduler, workspace as ws


def _workspace(args: argparse.Namespace) -> Path:
    if args.workspace:
        return Path(args.workspace).expanduser().resolve()
    current = dashboard.get_current_workspace()
    if current is None:
        raise SystemExit("no workspace; pass --workspace or run `aleph init <path>`")
    return current


def _print(data: Any, as_json: bool) -> None:
    if as_json or not isinstance(data, str):
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(data)


def cmd_init(args: argparse.Namespace) -> int:
    result = ws.init_workspace(
        Path(args.workspace_arg),
        title=args.title,
        demo=not args.no_demo,
        force=args.force,
    )
    _print(result, args.json)
    return 0


def cmd_mission_add(args: argparse.Namespace) -> int:
    result = ws.add_mission(
        _workspace(args),
        branch=args.branch,
        description=args.description,
        strategy=args.strategy,
        command=args.command,
        eval_command=args.eval_command,
        kind=args.kind,
    )
    _print(result, args.json)
    return 0


def cmd_mission_list(args: argparse.Namespace) -> int:
    ws_path = _workspace(args)
    conn = db.connect(db.db_path(ws_path))
    try:
        campaign = db.get_campaign(conn)
        if campaign is None:
            raise SystemExit("workspace has no campaign")
        missions = db.list_missions(conn, campaign["id"])
    finally:
        conn.close()
    _print(missions, args.json)
    return 0


def cmd_tick(args: argparse.Namespace) -> int:
    result = scheduler.tick(_workspace(args))
    _print(result, args.json if result is not None else True)
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    results = scheduler.run(_workspace(args), args.max)
    _print(results, args.json)
    return 0


def cmd_cycle(args: argparse.Namespace) -> int:
    results = scheduler.cycle(_workspace(args), args.rounds, args.command, args.strategy)
    _print(results, args.json)
    return 0


def cmd_telemetry(args: argparse.Namespace) -> int:
    _print(observability.get().status(), args.json)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    ws_path = _workspace(args)
    data = dashboard.write(ws_path)
    if args.json:
        _print(data, True)
        return 0
    campaign = data["campaign"]
    print(f"workspace  {data['workspace']}")
    print(f"campaign   {campaign['title']} ({campaign['id']})")
    print(f"SOTA       {campaign['sota_branch'] or '-'}  score={campaign['sota_score']:.4f}")
    print(f"exploration {campaign['exploration']}")
    print("missions:")
    for mission in data["missions"]:
        score = "-" if mission["score"] is None else f"{mission['score']:.4f}"
        print(f"  {mission['id']}  {mission['status']:<8} {mission['strategy']:<3} "
              f"{mission['branch']:<24} score={score}  {mission['description']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aleph", description="AlephResearch runtime")
    parser.add_argument("--workspace", help="leader workspace path")
    parser.add_argument("--json", action="store_true", help="print JSON")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="create a leader workspace")
    init.add_argument("workspace_arg", metavar="PATH")
    init.add_argument("--title")
    init.add_argument("--no-demo", action="store_true")
    init.add_argument("--force", action="store_true")
    init.set_defaults(func=cmd_init)

    mission = sub.add_parser("mission", help="mission commands")
    mission_sub = mission.add_subparsers(dest="mission_command", required=True)
    add = mission_sub.add_parser("add", help="enqueue a mission")
    add.add_argument("--branch", required=True)
    add.add_argument("--description", default="")
    add.add_argument("--strategy", choices=["auto", *[s for s in ("L0", "L1", "L2", "L3")]])
    add.add_argument("--command", default="")
    add.add_argument("--eval-command", default="")
    add.add_argument("--kind", choices=["experiment", "researcher"], default="experiment")
    add.set_defaults(func=cmd_mission_add)
    listing = mission_sub.add_parser("list", help="list missions")
    listing.set_defaults(func=cmd_mission_list)

    tick = sub.add_parser("tick", help="run one scheduling step")
    tick.set_defaults(func=cmd_tick)

    cycle = sub.add_parser("cycle", help="queue researcher missions and run them")
    cycle.add_argument("--rounds", type=int, default=1)
    cycle.add_argument("--command", required=True)
    cycle.add_argument("--strategy", choices=["auto", "L0", "L1", "L2", "L3"])
    cycle.set_defaults(func=cmd_cycle)

    run = sub.add_parser("run", help="run missions until the queue is empty")
    run.add_argument("--max", type=int, default=10)
    run.set_defaults(func=cmd_run)

    status = sub.add_parser("status", help="show campaign status")
    status.set_defaults(func=cmd_status)

    telemetry = sub.add_parser("telemetry", help="show the telemetry configuration")
    telemetry.set_defaults(func=cmd_telemetry)
    return parser


def _normalize_globals(argv: list[str]) -> list[str]:
    """Allow `--json` and `--workspace` after the subcommand as well."""
    globals_: list[str] = []
    rest: list[str] = []
    index = 0
    while index < len(argv):
        item = argv[index]
        if item == "--json":
            globals_.append(item)
            index += 1
            continue
        if item == "--workspace" and index + 1 < len(argv):
            globals_.extend([item, argv[index + 1]])
            index += 2
            continue
        if item.startswith("--workspace="):
            globals_.append(item)
            index += 1
            continue
        rest.append(item)
        index += 1
    return globals_ + rest


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    raw = list(sys.argv[1:] if argv is None else argv)
    args = parser.parse_args(_normalize_globals(raw))
    obs = observability.get()
    command = getattr(args, "command", "")
    attributes = {"aleph.command": command}
    if getattr(args, "workspace", None):
        attributes["aleph.workspace"] = str(Path(args.workspace).expanduser().resolve())
    with obs.span("aleph.cli", attributes) as span:
        try:
            result = args.func(args)
            obs.add_counter("aleph.cli.invocations", 1, {"aleph.command": command})
            return result
        except (FileNotFoundError, FileExistsError, ValueError, RuntimeError) as exc:
            span.record_exception(exc)
            obs.mark_error(span, str(exc))
            print(f"aleph: {exc}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
