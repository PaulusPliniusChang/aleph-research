"""Git LFS defaults for research repositories.

Large binary artifacts (model checkpoints, archives) are routed through Git LFS
when the git-lfs executable is available. Small text data and hidden testsets
stay in normal Git objects.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from . import observability

from .util import git

PATTERNS = [
    "*.cbm",
    "*.pt",
    "*.pth",
    "*.ckpt",
    "*.safetensors",
    "*.onnx",
    "*.h5",
    "*.hdf5",
    "*.pkl",
    "*.pickle",
    "*.joblib",
    "*.npz",
    "*.npy",
    "*.parquet",
    "*.arrow",
    "*.feather",
    "*.bin",
    "*.model",
    "*.zip",
    "*.tar",
    "*.tar.gz",
    "*.tgz",
    "*.gz",
    "*.xz",
    "*.zst",
]


def available() -> bool:
    return shutil.which("git-lfs") is not None


def attributes_text() -> str:
    lines = ["# AlephResearch: large binary artifacts are stored with Git LFS."]
    lines += [f"{pattern} filter=lfs diff=lfs merge=lfs -text" for pattern in PATTERNS]
    return "\n".join(lines) + "\n"


def ensure(repo: Path) -> bool:
    """Install local Git LFS and add missing attribute lines. Returns availability."""
    if not available():
        return False
    path = repo / ".gitattributes"
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    missing = []
    for pattern in PATTERNS:
        line = f"{pattern} filter=lfs diff=lfs merge=lfs -text"
        if line not in existing:
            missing.append(line)
    if missing:
        prefix = existing
        if prefix and not prefix.endswith("\n"):
            prefix += "\n"
        if not prefix:
            prefix = "# AlephResearch: large binary artifacts are stored with Git LFS.\n"
        path.write_text(prefix + "\n".join(missing) + "\n", encoding="utf-8")
    git(repo, "lfs", "install", "--local", check=False)
    return True


def cowify_worktree(worktree: Path) -> dict[str, int]:
    """Replace LFS worktree files with CoW reflinks to the local LFS objects."""
    obs = observability.get()
    started = time.monotonic()
    with obs.span("aleph.lfs.cow", {"aleph.worktree": str(worktree)}) as span:
        result = _cowify_worktree(worktree)
        span.set_attribute("aleph.lfs.cow.files", result.get("files", 0))
        span.set_attribute("aleph.lfs.cow.bytes", result.get("bytes", 0))
        obs.add_counter("aleph.lfs.cow.files", result.get("files", 0))
        obs.add_counter("aleph.lfs.cow.bytes", result.get("bytes", 0))
        obs.record_histogram("aleph.lfs.cow.duration", time.monotonic() - started, unit="s")
        return result


def _cowify_worktree(worktree: Path) -> dict[str, int]:
    """Replace LFS worktree files with CoW reflinks to the local LFS objects.

    Git's smudge filter writes a full copy of every LFS object into the
    worktree. On a reflink-capable filesystem the local LFS object can instead
    be shared through a CoW extent, removing that duplicate. The operation is
    best-effort: a failed reflink keeps the already checked-out file.
    """
    if not available():
        return {"files": 0, "bytes": 0}
    result = git(worktree, "lfs", "ls-files", "--json", check=False)
    if result.returncode != 0:
        return {"files": 0, "bytes": 0}
    try:
        payload = json.loads(result.stdout or "{}")
    except ValueError:
        return {"files": 0, "bytes": 0}
    entries = payload.get("files") or []
    common = git(worktree, "rev-parse", "--path-format=absolute", "--git-common-dir", check=False)
    if common.returncode != 0:
        return {"files": 0, "bytes": 0}
    objects = Path(common.stdout.strip()) / "lfs" / "objects"
    cp = shutil.which("cp")
    count = 0
    total = 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        oid = entry.get("oid")
        if not isinstance(name, str) or not isinstance(oid, str) or len(oid) < 4:
            continue
        target = worktree / name
        source = objects / oid[:2] / oid[2:4] / oid
        if not target.is_file() or not source.is_file():
            continue
        if cp is not None:
            temporary = target.with_name(target.name + ".cow-tmp")
            copied = subprocess.run(
                [cp, "--reflink=auto", "--no-preserve=mode,ownership,timestamps", "--", str(source), str(temporary)],
                text=True,
                capture_output=True,
            )
            if copied.returncode == 0:
                try:
                    os.replace(temporary, target)
                    os.chmod(target, 0o644)
                    count += 1
                    total += target.stat().st_size
                finally:
                    if temporary.exists():
                        temporary.unlink()
    return {"files": count, "bytes": total}
