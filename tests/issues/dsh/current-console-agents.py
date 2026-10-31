#!/usr/bin/env python3
"""Launch an actual DSH instance for console agent browser observations."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--expect-protection', action='store_true')
parser.add_argument('--screenshot-prefix', default='16-current')
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch-project.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
runtime = Path('/opt/dsh-desktop-linux-bin/resources/app/dsh')
root, workspace, environment = launcher.prepare(args.source.resolve(), runtime)
bridge = root / 'bridge'
shutil.copyfile(Path(__file__).with_name('diagnostic-bridge.mjs'), bridge / 'diagnostic-bridge.mjs')
shutil.copyfile(Path(__file__).with_name('researcher-deterministic-bridge.mjs'), bridge / 'index.mjs')
(bridge / 'node_modules').symlink_to(runtime / 'node_modules', target_is_directory=True)
patch = root / 'home/profiles/reproduction/cordis.patch.yml'
patch.write_text(patch.read_text() + '- id: agent-default-model\n  config:\n    provider: aleph-test\n    model: deterministic\n- id: session-title-llm\n  disabled: true\n')
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
url = f'http://127.0.0.1:{port}'
args.output.parent.mkdir(parents=True, exist_ok=True)
environment['source_commit'] = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
environment['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
records = {'environment': environment, 'url': url, 'command': [sys.executable, *sys.argv],
           'browser_fallback': 'Browser plugin not available', 'events': []}
config = root / 'browser-config.json'
config.write_text(json.dumps({'root': str(root), 'workspace': str(workspace), 'url': url,
                             'output': str(args.output.resolve()), 'evidenceDir': str(args.output.resolve().parent),
                             'expectProtection': args.expect_protection, 'screenshotPrefix': args.screenshot_prefix}))
log = (root / 'dsh.log').open('w')
proc = subprocess.Popen(['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 'reproduction', '--no-open', '--host', '127.0.0.1', '--port', str(port)],
    cwd=workspace, env=dict(os.environ, DSH_HOME=str(root / 'home')), stdout=log, stderr=subprocess.STDOUT)
try:
    for _ in range(150):
        if proc.poll() is not None:
            raise RuntimeError('isolated DSH exited: ' + str(root / 'dsh.log'))
        try:
            with urllib.request.urlopen(url + '/api/aleph/health', timeout=1) as response:
                health = json.load(response)
            break
        except OSError:
            time.sleep(.1)
    else:
        raise TimeoutError('DSH startup')
    records['events'].append({'name': 'actual-host-ready', 'health': health})
    print(json.dumps({'phase': 'actual-host-ready', 'root': str(root), 'url': url}), flush=True)
    result = subprocess.run(['node', str(Path(__file__).with_name('console-agents-browser.mjs')), str(config)])
    if args.output.exists():
        records['browser'] = json.loads(args.output.read_text())
    records['browser_exit'] = result.returncode
    if result.returncode:
        raise RuntimeError('browser observation failed; inspect saved evidence')
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    records['events'].append({'name': 'isolated-host-stopped', 'pid': proc.pid,
                             'exit': proc.poll(), 'pid_exists': Path(f'/proc/{proc.pid}').exists()})
    log.close()
    args.output.write_text(json.dumps(records, indent=2))
