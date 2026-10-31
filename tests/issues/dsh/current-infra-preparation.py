#!/usr/bin/env python3
"""Verify the current InfraOptimizer preparation race with actual DSH services."""
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
bridge = root / 'bridge'
shutil.copyfile(Path(__file__).with_name('diagnostic-bridge.mjs'), bridge / 'diagnostic-bridge.mjs')
shutil.copyfile(Path(__file__).with_name('infra-deterministic-bridge.mjs'), bridge / 'index.mjs')
(bridge / 'node_modules').symlink_to(runtime / 'node_modules', target_is_directory=True)
patch = root / 'home/profiles/reproduction/cordis.patch.yml'
patch.write_text(patch.read_text() + '- id: agent-default-model\n  config:\n    provider: aleph-test\n    model: deterministic\n- id: session-title-llm\n  disabled: true\n')
gate = root / 'scheduling'
gate.mkdir()
(gate / 'bin').mkdir()
(gate / 'bin/git').symlink_to(Path(__file__).with_name('infra-preparation-git-scheduler.py').resolve())
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
url = f'http://127.0.0.1:{port}'
config = root / 'probe-config.json'
probe_output = root / 'probe-output.json'
config.write_text(json.dumps({'source':str(args.source.resolve()),'workspace':str(workspace),'url':url,'output':str(probe_output)}))
env = dict(os.environ, DSH_HOME=str(root / 'home'), PATH=str(gate / 'bin')+':'+os.environ['PATH'], ALEPH_INFRA_PREPARATION_GATE=str(gate), ALEPH_INFRA_PREPARATION_ACTUAL_CONFIG=str(config))
records = {'environment': environment, 'command':[sys.executable,*sys.argv], 'boundary':'Actual DSH registered tools, storage, sessions, real Git and filesystem. Exact first infra worktree-add response delayed after real Git creation. No source changes; local deterministic model configured. Inspect first activation outcome before claiming a real optimizer model ran.', 'events':[]}
args.output.parent.mkdir(parents=True,exist_ok=True)
log = (root / 'dsh.log').open('w')
proc = subprocess.Popen(['node',str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','reproduction','--no-open','--host','127.0.0.1','--port',str(port)],cwd=workspace,env=env,stdout=log,stderr=subprocess.STDOUT)
try:
    for _ in range(150):
        if proc.poll() is not None: raise RuntimeError('Host exited '+str(root))
        try:
            with urllib.request.urlopen(url+'/api/aleph/health',timeout=1) as response: health=json.load(response)
            break
        except OSError: time.sleep(.1)
    else: raise TimeoutError('Host startup')
    records['events'].append({'name':'host-ready','health':health})
    print(json.dumps({'phase':'host-ready','root':str(root),'url':url}),flush=True)
    result=subprocess.run(['node','--test',str(Path(__file__).with_name('current-infra-preparation.test.mjs'))],env=env,timeout=45)
    records['probe_exit']=result.returncode
    if result.returncode: raise RuntimeError('Actual observations failed')
finally:
    (gate/'release-first').write_text('cleanup\n')
    if probe_output.exists(): records['probe']=json.loads(probe_output.read_text())
    records['scheduler']=[json.loads(p.read_text()) for p in sorted(gate.glob('worktree-add-*.json'))]
    proc.terminate()
    try: proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill();proc.wait(timeout=5)
    records['events'].append({'name':'host-stopped','pid':proc.pid,'exit':proc.poll(),'pid_exists':Path(f'/proc/{proc.pid}').exists()})
    log.close()
    args.output.write_text(json.dumps(records,indent=2))
