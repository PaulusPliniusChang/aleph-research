import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class CliTest(unittest.TestCase):
    def test_cli_init_tick_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env["ALEPH_HOME"] = str(Path(tmp) / "home")
            env["PYTHONPATH"] = str(ROOT / "runtime")
            ws = Path(tmp) / "leader"

            def call(*args):
                result = subprocess.run(
                    [sys.executable, "-m", "aleph.cli", *args],
                    cwd=str(ROOT),
                    env=env,
                    text=True,
                    capture_output=True,
                    timeout=120,
                )
                if result.returncode != 0:
                    raise AssertionError(result.stderr)
                return result.stdout

            init = json.loads(call("init", str(ws), "--json"))
            self.assertTrue(Path(init["workspace"]).exists())
            call("tick", "--workspace", str(ws), "--json")
            status = json.loads(call("status", "--workspace", str(ws), "--json"))
            self.assertEqual(status["counts"]["done"], 1)
            self.assertEqual(status["schema"], 1)


if __name__ == "__main__":
    unittest.main()
