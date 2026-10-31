#!/usr/bin/env python3
"""Launch the selected current project plugin in an isolated, real DSH runtime."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def prepare(source, runtime):
    root = Path(tempfile.mkdtemp(prefix="aleph-project-dsh-"))
    profile = root / "home/profiles/reproduction"
    profile.mkdir(parents=True)
    plugin = root / "plugin"
    shutil.copytree(source / "dsh-plugin", plugin, ignore=shutil.ignore_patterns("node_modules"))
    (plugin / "node_modules").mkdir()
    for name in ["@deepseek-ai", "zod"]:
        (plugin / "node_modules" / name).symlink_to(runtime / "node_modules" / name, target_is_directory=True)
    bridge = root / "bridge"
    bridge.mkdir()
    shutil.copyfile(Path(__file__).with_name("diagnostic-bridge.mjs"), bridge / "index.mjs")
    (bridge / "package.json").write_text(json.dumps({"name": "@local/aleph-test-bridge", "type": "module", "exports": "./index.mjs"}))
    (profile / "package.json").write_text(json.dumps({
        "name": "dsh-profile-reproduction",
        "private": True,
        "dependencies": {
            "@local/dsh-aleph-research": "link:" + str(plugin),
            "@local/aleph-test-bridge": "link:" + str(bridge),
        },
        "dsh": {"profile": {"bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@local/dsh-aleph-research"]}},
    }))
    (profile / "cordis.yml").write_text("[]\n")
    (profile / "cordis.patch.yml").write_text("- insert:\n    - id: aleph-test-bridge\n      name: '@local/aleph-test-bridge'\n")
    local = profile / "node_modules/@local"
    local.mkdir(parents=True)
    (local / "dsh-aleph-research").symlink_to(plugin, target_is_directory=True)
    (local / "aleph-test-bridge").symlink_to(bridge, target_is_directory=True)
    workspace = root / "workspace"
    workspace.mkdir()
    version = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    environment = {"root": str(root), "workspace": str(workspace), "runtime": str(runtime), "source": str(source), "version": version}
    (root / "environment.json").write_text(json.dumps(environment, indent=2))
    return root, workspace, environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Git worktree containing the current project plugin")
    parser.add_argument("--runtime", type=Path, default=Path("/opt/dsh-desktop-linux-bin/resources/app/dsh"))
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    source = args.source.resolve()
    runtime = args.runtime.resolve()
    entry = runtime / "node_modules/@deepseek-ai/dsh/lib/bin.js"
    if not entry.is_file():
        parser.error("DSH runtime entry not found: " + str(entry))
    if not (source / "dsh-plugin/index-v2.js").is_file():
        parser.error("current project plugin not found in --source")
    root, workspace, environment = prepare(source, runtime)
    print(json.dumps(environment), flush=True)
    env = dict(os.environ, DSH_HOME=str(root / "home"))
    # This launcher exercises real registered tools without model calls, so no
    # credentials are copied into the profile or evidence directory.
    result = subprocess.run([
        "node", str(entry), "--profile", "reproduction", "--no-open",
        "--host", "127.0.0.1", "--port", str(args.port),
    ], cwd=workspace, env=env)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
