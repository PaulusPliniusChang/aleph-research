"""Git worktree and commit helpers.

Researchers edit files in a worktree; the runtime performs git operations on
their behalf.  Mission worktrees live outside the leader workspace.
"""

from __future__ import annotations

from pathlib import Path

from .util import aleph_home, git


def mission_worktree_path(campaign_id: str, mission_id: str) -> Path:
    return aleph_home() / "worktrees" / campaign_id / mission_id


def create_worktree(research_root: Path, dest: Path, ref: str) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        remove_worktree(research_root, dest)
    git(research_root, "worktree", "add", "--detach", str(dest), ref)
    return dest


def remove_worktree(research_root: Path, dest: Path) -> None:
    if not dest.exists():
        return
    git(research_root, "worktree", "remove", "--force", str(dest), check=False)


def head_commit(repo: Path, ref: str = "HEAD") -> str:
    return git(repo, "rev-parse", ref).stdout.strip()


def commit_worktree(worktree: Path, message: str) -> tuple[str, bool]:
    """Commit all changes in a worktree.  Returns (commit, changed)."""
    status = git(worktree, "status", "--porcelain").stdout.strip()
    if not status:
        return head_commit(worktree), False
    git(worktree, "add", "-A")
    git(worktree, "commit", "-m", message)
    return head_commit(worktree), True


def branch_at(repo: Path, branch: str, commit: str) -> None:
    git(repo, "branch", "-f", branch, commit)


def branch_exists(repo: Path, branch: str) -> bool:
    result = git(repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False)
    return result.returncode == 0


def finalize_commit(worktree: Path, base_commit: str, message: str, allow_empty: bool = False) -> tuple[str, bool]:
    """Collapse all researcher work into one commit whose parent is base_commit.

    Any commits created by the researcher are discarded from the worktree HEAD;
    the final tree is committed once, so one researcher owns exactly one commit.
    """
    git(worktree, "add", "-A")
    tree = git(worktree, "write-tree").stdout.strip()
    base_tree = git(worktree, "rev-parse", f"{base_commit}^{{tree}}").stdout.strip()
    if tree == base_tree and not allow_empty:
        return base_commit, False
    git(worktree, "reset", "--soft", base_commit)
    git(worktree, "commit", "--allow-empty", "-m", message)
    return head_commit(worktree), True
