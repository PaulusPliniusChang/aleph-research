#!/usr/bin/env python3
"""Run current budget/strategy contract checks against an isolated actual DSH."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
base = Path(__file__).parent
spec = importlib.util.spec_from_file_location('launcher', base / 'launch-project.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
runtime = Path('/opt/dsh-desktop-linux-bin/resources/app/dsh')
root, workspace, environment = launcher.prepare(args.source.resolve(), runtime)
bridge = root / 'bridge'
(bridge / 'diagnostic-bridge.mjs').write_text((base / 'diagnostic-bridge.mjs').read_text().replace('session.events', 'session.log'))
shutil.copyfile(base / 'migration-context-bridge.mjs', bridge / 'index.mjs')
(bridge / 'node_modules').symlink_to(runtime / 'node_modules', target_is_directory=True)
patch = root / 'home/profiles/reproduction/cordis.patch.yml'
patch.write_text(patch.read_text() + '- id: agent-default-model\n  config:\n    provider: aleph-test\n    model: deterministic\n- id: session-title-llm\n  disabled: true\n')
with socket.socket() as temporary:
    temporary.bind(('127.0.0.1', 0))
    port = temporary.getsockname()[1]
url = 'http://127.0.0.1:' + str(port)
args.output.parent.mkdir(parents=True, exist_ok=True)
config = root / 'contract-config.json'
config.write_text(json.dumps(dict(source=str(args.source.resolve()), root=str(root), workspace=str(workspace), url=url, output=str(args.output.resolve()))))
process = None
result = None
try:
    with (root / 'dsh.log').open('w') as log:
        process = subprocess.Popen(['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'reproduction', '--no-open', '--host', '127.0.0.1', '--port', str(port)], cwd=workspace, env=dict(os.environ, DSH_HOME=str(root / 'home')), stdout=log, stderr=subprocess.STDOUT)
        for _ in range(150):
            if process.poll() is not None:
                raise RuntimeError('DSH exited; inspect ' + str(root / 'dsh.log'))
            try:
                with urllib.request.urlopen(url + '/api/aleph/health', timeout=1):
                    break
            except (OSError, urllib.error.URLError):
                time.sleep(.1)
        else:
            raise TimeoutError('actual Host health route did not register')
        result = subprocess.run(['node', '--test', str(base / 'current-budget-strategy.test.mjs')], env=dict(os.environ, ALEPH_MIGRATION_ACTUAL_CONFIG=str(config)), timeout=90)
finally:
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    report = json.loads(args.output.read_text()) if args.output.exists() else {}
    report['environment'] = environment
    report['host'] = dict(pid=process.pid if process else None, exit=process.poll() if process else None, pid_exists=Path('/proc/' + str(process.pid)).exists() if process else None)
    report['launcher_exit'] = result.returncode if result else None
    args.output.write_text(json.dumps(report, indent=2))
raise SystemExit(result.returncode if result else 1)
