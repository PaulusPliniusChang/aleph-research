#!/usr/bin/env python3
"""Launch an actual DSH instance for fixed select-best worktree acceptance."""
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
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch-project.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
runtime = Path('/opt/dsh-desktop-linux-bin/resources/app/dsh')
root, workspace, environment = launcher.prepare(args.source.resolve(), runtime)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
url = f'http://127.0.0.1:{port}'
args.output.parent.mkdir(parents=True, exist_ok=True)
environment['source_commit'] = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
environment['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
records = {'environment': environment, 'url': url, 'command': [sys.executable, *sys.argv],
           'boundary': 'Real DSH sessions, registered init/evaluation tools, persistent storage, Git linked worktrees, actual Python scoring and authenticated select-best HTTP. No model calls, product edits or deadline adaptation.', 'events': []}
config = root / 'browser-config.json'
probe_output = root / 'probe-observations.json'
config.write_text(json.dumps({'source':str(args.source.resolve()),'root':str(root),'workspace':str(workspace),'url':url,'output':str(probe_output)}))
probe_env = dict(os.environ, DSH_HOME=str(root / 'home'), ALEPH_FIXED_SELECT_ACTUAL_CONFIG=str(config))
log = (root / 'dsh.log').open('w')
proc = subprocess.Popen(['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    '--profile', 'reproduction', '--no-open', '--host', '127.0.0.1', '--port', str(port)],
    cwd=workspace, env=probe_env, stdout=log, stderr=subprocess.STDOUT)
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
    result = subprocess.run(['node', '--test', str(Path(__file__).with_name('fixed-select-best.test.mjs'))],env=probe_env)
    if probe_output.exists():
        records['probe'] = json.loads(probe_output.read_text())
    records['probe_exit'] = result.returncode
    if result.returncode:
        raise RuntimeError('actual process observation failed; inspect saved evidence')
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
