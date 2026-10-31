#!/usr/bin/env python3
"""Supervise one batch and retain its outcome independently of the DSH process."""

import datetime
import json
import os
import pathlib
import subprocess
import sys


state_path = pathlib.Path(sys.argv[1])
execution_id = sys.argv[2]


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save(value):
    temporary = state_path.with_name(state_path.name + ".tmp")
    with temporary.open("w") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, state_path)


try:
    process_stat = pathlib.Path("/proc/self/stat").read_text()
    start_ticks = process_stat[process_stat.rfind(")") + 2:].split()[19]
except OSError:
    start_ticks = None

state = {
    "id": execution_id,
    "pid": os.getpid(),
    "startTicks": start_ticks,
    "cwd": os.getcwd(),
    "status": "running",
    "startedAt": timestamp(),
}
save(state)
try:
    with state_path.with_suffix(".log").open("ab", buffering=0) as log:
        outcome = subprocess.run(
            [sys.executable, "batch_runner.py"],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
        )
    state["exitCode"] = outcome.returncode
except Exception as error:
    state["exitCode"] = None
    state["error"] = str(error)
state["status"] = "finished"
state["finishedAt"] = timestamp()
save(state)
