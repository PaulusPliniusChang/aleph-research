import tempfile
import unittest
from pathlib import Path

from aleph.util import git
from aleph.worktree import finalize_commit


class FinalizeCommitTest(unittest.TestCase):
    def test_multiple_researcher_commits_collapse_to_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            repo.mkdir()
            git(repo, "init", "-b", "main")
            (repo / "a.txt").write_text("base\n", encoding="utf-8")
            git(repo, "add", "-A")
            git(repo, "commit", "-m", "base")
            base = git(repo, "rev-parse", "HEAD").stdout.strip()

            (repo / "a.txt").write_text("one\n", encoding="utf-8")
            git(repo, "commit", "-am", "researcher one")
            (repo / "a.txt").write_text("two\n", encoding="utf-8")
            git(repo, "commit", "-am", "researcher two")

            message = "mission\n\nHandoff:\nreport\n\nAleph-Mission: m-1"
            commit, changed = finalize_commit(repo, base, message, allow_empty=True)

            self.assertTrue(changed)
            self.assertEqual(git(repo, "rev-parse", f"{commit}^").stdout.strip(), base)
            count = git(repo, "rev-list", "--count", f"{base}..{commit}").stdout.strip()
            self.assertEqual(count, "1")
            body = git(repo, "log", "-1", "--format=%B", commit).stdout
            self.assertIn("Handoff:", body)
            self.assertIn("Aleph-Mission: m-1", body)
            self.assertEqual(git(repo, "show", f"{commit}:a.txt").stdout, "two\n")

    def test_unchanged_tree_can_create_an_empty_handoff_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            repo.mkdir()
            git(repo, "init", "-b", "main")
            (repo / "a.txt").write_text("base\n", encoding="utf-8")
            git(repo, "add", "-A")
            git(repo, "commit", "-m", "base")
            base = git(repo, "rev-parse", "HEAD").stdout.strip()
            commit, changed = finalize_commit(repo, base, "empty handoff", allow_empty=True)
            self.assertTrue(changed)
            self.assertEqual(git(repo, "rev-parse", f"{commit}^").stdout.strip(), base)


if __name__ == "__main__":
    unittest.main()
