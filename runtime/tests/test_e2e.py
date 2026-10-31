import os
import tempfile
import unittest
from pathlib import Path

from aleph import dashboard, scheduler, workspace
from aleph.util import git


class EndToEndTest(unittest.TestCase):
    def test_toy_campaign_promotes_best_branch(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ALEPH_HOME"] = str(Path(tmp) / "home")
            ws = Path(tmp) / "leader"
            info = workspace.init_workspace(ws)
            self.assertTrue((ws / ".aleph" / "state.sqlite").exists())
            self.assertTrue((ws / ".aleph" / "dashboard.json").exists())
            self.assertEqual(info["campaign_id"][0], "c")

            results = scheduler.run(ws, 3)
            self.assertEqual(len(results), 3)
            self.assertTrue(all(item["status"] == "done" for item in results))

            data = dashboard.write(ws)
            self.assertEqual(data["campaign"]["sota_branch"], "sota/main")
            self.assertAlmostEqual(data["campaign"]["sota_score"], 1.0)
            self.assertEqual(data["counts"]["done"], 3)
            self.assertEqual(data["counts"]["queued"], 0)

            research = ws / "research"
            sota = git(research, "rev-parse", "sota/main").stdout.strip()
            best = git(research, "rev-parse", "exp/c").stdout.strip()
            self.assertEqual(sota, best)

    def test_add_mission_and_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ALEPH_HOME"] = str(Path(tmp) / "home")
            ws = Path(tmp) / "leader"
            workspace.init_workspace(ws, demo=False)
            mission = workspace.add_mission(ws, "exp/a", "manual candidate", strategy="L1")
            self.assertEqual(mission["strategy"], "L1")
            result = scheduler.tick(ws)
            self.assertEqual(result["status"], "done")
            data = dashboard.write(ws)
            self.assertEqual(data["counts"]["done"], 1)


    def test_researcher_change_is_committed_by_leader_side(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ALEPH_HOME"] = str(Path(tmp) / "home")
            ws = Path(tmp) / "leader"
            workspace.init_workspace(ws, demo=False)
            mission = workspace.add_mission(
                ws,
                "initialize",
                "edit solution",
                strategy="L1",
                command="printf 'def answer():\\n    return 7\\n' > solution.py",
            )
            result = scheduler.tick(ws)
            self.assertEqual(result["status"], "done")
            self.assertAlmostEqual(result["score"], 1.0)
            self.assertNotEqual(result["branch"], "exp/a")
            research = ws / "research"
            self.assertEqual(git(research, "rev-parse", "sota/main").stdout.strip(), result["commit"])


    def test_cycle_queues_and_runs_a_mission(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ALEPH_HOME"] = str(Path(tmp) / "home")
            ws = Path(tmp) / "leader"
            workspace.init_workspace(ws, demo=False)
            command = (
                "python3 -c 'import os,pathlib; "
                "pathlib.Path(os.environ[\"ALEPH_HANDOFF_PATH\"]).write_text(\"handoff report\")'"
            )
            results = scheduler.cycle(ws, 1, command)
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["status"], "done")
            data = dashboard.write(ws)
            self.assertEqual(data["counts"]["done"], 1)
            branch = results[0]["branch"]
            message = git(ws / "research", "log", "-1", "--format=%B", branch).stdout
            self.assertIn("Handoff:", message)
            self.assertIn("Aleph-Mission:", message)


    def test_researcher_commits_are_squashed_only_after_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["ALEPH_HOME"] = str(Path(tmp) / "home")
            ws = Path(tmp) / "leader"
            workspace.init_workspace(ws, demo=False)
            research_script = Path(tmp) / "research.sh"
            research_script.write_text(
                """#!/usr/bin/env bash
set -euo pipefail
printf 'def answer():\\n    return 7\\n' > solution.py
git add solution.py
git -c user.name=T -c user.email=t@t commit -m step-one
printf 'def answer():\\n    return 5\\n' > solution.py
git add solution.py
git -c user.name=T -c user.email=t@t commit -m step-two
python3 -c 'import os,pathlib; pathlib.Path(os.environ["ALEPH_HANDOFF_PATH"]).write_text("handoff after research")'
""",
                encoding="utf-8",
            )
            results = scheduler.cycle(ws, 1, f"bash {research_script}")
            self.assertEqual(results[0]["status"], "done")
            branch = results[0]["branch"]
            research = ws / "research"
            base = git(research, "rev-parse", "initialize").stdout.strip()
            self.assertEqual(
                git(research, "rev-list", "--count", f"{base}..{branch}").stdout.strip(), "1"
            )
            self.assertEqual(git(research, "rev-parse", f"{branch}^").stdout.strip(), base)
            message = git(research, "log", "-1", "--format=%B", branch).stdout
            self.assertIn("Handoff:", message)
            self.assertIn("handoff after research", message)


if __name__ == "__main__":
    unittest.main()
