#!/usr/bin/env python3
"""Observe post-composition mission branch updates during actual DSH result delivery."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import shlex
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
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
with socket.socket() as temporary:
    temporary.bind(('127.0.0.1', 0))
    port = temporary.getsockname()[1]
url = 'http://127.0.0.1:' + str(port)
records = {'environment': environment, 'url': url, 'events': [], 'checks': []}
environment['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
environment['dsh_version'] = json.loads((runtime / 'package.json').read_text())['version']
records['command'] = [sys.executable, *sys.argv]
records['boundary'] = ('Original isolated DSH registered tools, parent session, persistent storage, real mission Git branches, actual batch runner and shell tasks. Diagnostic bridge invokes tools without models. File gate only pauses actual task for real post-composition branch modification. No Git substitution or product source edits. Existing pre-composition evidence unchanged.')
args.output.parent.mkdir(parents=True, exist_ok=True)


def save():
    args.output.write_text(json.dumps(records, indent=2))


def event(name, value):
    records['events'].append({'name': name, 'monotonic': time.monotonic(), 'value': value})
    save()
    return value


def check(name, predicate):
    records['checks'].append({'name': name, 'passed': bool(predicate)})
    save()
    if not predicate:
        raise AssertionError(name)


def http(path, body=None, timeout=30):
    request = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': url})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def bridge(body):
    for attempt in range(100):
        try:
            value = http('/api/aleph-test/bridge', body)
            break
        except urllib.error.HTTPError as error:
            if error.code != 404 or attempt == 99:
                raise
            time.sleep(.05)
    event('bridge', {'request': body, 'response': value})
    if not value['ok']:
        raise RuntimeError(value)
    return value['result']


def git(repo, *command):
    return subprocess.check_output(['git', '-C', str(repo), *command], text=True).strip()


def commit(repo, message):
    git(repo, 'add', '-A')
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message)
    return git(repo, 'rev-parse', 'HEAD')


def ancestor(repo, before, after):
    result = subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', before, after], capture_output=True, text=True)
    if result.returncode not in [0, 1]:
        raise RuntimeError(result.stderr)
    return result.returncode == 0


proc = None
try:
    log = (root / 'dsh.log').open('w')
    proc = subprocess.Popen(['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'reproduction',
        '--no-open', '--host', '127.0.0.1', '--port', str(port)], cwd=workspace,
        env=dict(os.environ, DSH_HOME=str(root / 'home')), stdout=log, stderr=subprocess.STDOUT)
    for _ in range(150):
        if proc.poll() is not None:
            raise RuntimeError('DSH exited; inspect ' + str(root / 'dsh.log'))
        try:
            health = http('/api/aleph/health', timeout=1)
            break
        except (OSError, urllib.error.URLError):
            time.sleep(.1)
    else:
        raise TimeoutError('real DSH startup timeout')
    check('actual project storage is registered', health['storage'] == 'aleph_project')
    sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']

    def tool(name, **kwargs):
        return bridge({'action': 'tool', 'sessionId': sid, 'name': name, 'args': kwargs})

    for scope in ['unchanged', 'before-run', 'during-run', 'checked-out']:
        directory = workspace / scope
        directory.mkdir()
        gate = root / (scope + '-gate')
        gate.mkdir()
        project = tool('aleph_init_project', workspace=str(directory))
        pid = project['id']
        repo = Path(project['missionRoot'])
        branch = 'mission/train'
        git(repo, 'switch', '-c', branch, 'template')
        mission_dir = repo / 'missions/train'
        mission_dir.mkdir(parents=True)
        (mission_dir / 'mission.json').write_text(json.dumps({'id': 'train', 'entrypoint': 'run.sh'}))
        (mission_dir / 'source.txt').write_text('source-original\n')
        (mission_dir / 'run.sh').write_text('cat source.txt > ' + shlex.quote(str(gate / 'runtime-source.txt')) + '\n'
            'git rev-parse HEAD > ' + shlex.quote(str(gate / 'runtime-head.txt')) + '\n'
            'printf run >> ' + shlex.quote(str(gate / 'executions.txt')) + '\n'
            'touch ' + shlex.quote(str(gate / 'ready')) + '\n'
            'for n in $(seq 1 1500); do test -f ' + shlex.quote(str(gate / 'release')) + ' && break; sleep .01; done\n'
            'test -f ' + shlex.quote(str(gate / 'release')) + ' || exit 71\n'
            'printf complete > "$ALEPH_OUTPUT_DIR/completed.txt"\n')
        captured = commit(repo, 'initial task code')
        git(repo, 'switch', 'template')
        proposed = tool('aleph_propose_mission', project_id=pid, branch=branch)
        mission_id = proposed['missions'][0]['id']
        tool('aleph_approve_mission', project_id=pid, mission_id=mission_id)
        formed = tool('aleph_form_batch', project_id=pid)
        batch = formed['batches'][0]
        batch_tip = git(repo, 'rev-parse', batch['branch'])
        event(scope + '-formed', formed)
        check(scope + ': proposal belongs to actual parent session', proposed['missions'][0]['ownerSession'] == sid)
        check(scope + ': composition captures original task commit', formed['missions'][0]['preBatchTip'] == captured)
        check(scope + ': actual batch descends from captured task', ancestor(repo, captured, batch_tip))
        check(scope + ': actual machine is reserved for this batch', formed['machines'][0]['batchId'] == batch['id'])

        def advance():
            git(repo, 'switch', branch)
            (mission_dir / 'source.txt').write_text('source-revised\n')
            tip = commit(repo, 'researcher correction after composition')
            if scope != 'checked-out':
                git(repo, 'switch', 'template')
            return tip

        advanced = advance() if scope in ['before-run', 'checked-out'] else None
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(tool, 'aleph_run_batch', project_id=pid, batch_id=batch['id'])
            try:
                deadline = time.monotonic() + 10
                while not (gate / 'ready').exists():
                    if pending.done():
                        pending.result()
                        raise RuntimeError('task ended before writing ready marker')
                    if time.monotonic() > deadline:
                        raise TimeoutError('actual task startup timeout')
                    time.sleep(.02)
                if scope == 'during-run':
                    advanced = advance()
                before_delivery = git(repo, 'rev-parse', branch)
            finally:
                (gate / 'release').write_text('release')
            finished = pending.result()
        mission = finished['missions'][0]
        final_batch = finished['batches'][0]
        tip = git(repo, 'rev-parse', branch)
        branch_source = git(repo, 'show', branch + ':missions/train/source.txt')
        public = next(p for p in http('/api/aleph/projects')['projects'] if p['project']['id'] == pid)
        event(scope + '-delivered', {'captured': captured, 'advanced': advanced, 'beforeDelivery': before_delivery,
            'branchTip': tip, 'branchSource': branch_source, 'branchLog': git(repo, 'log', '--format=%H', branch),
            'resultParent': git(repo, 'rev-parse', mission['resultCommit'] + '^'), 'finished': finished, 'public': public})
        check(scope + ': actual shell ran original task source', (gate / 'runtime-source.txt').read_text().strip() == 'source-original')
        check(scope + ': actual shell ran composed batch commit', (gate / 'runtime-head.txt').read_text().strip() == batch_tip)
        check(scope + ': actual task ran exactly once', (gate / 'executions.txt').read_text() == 'run')
        check(scope + ': actual machine returns idle', finished['machines'][0]['status'] == 'idle')
        check(scope + ': actual machine releases batch ownership', finished['machines'][0]['batchId'] is None)
        check(scope + ': persistent baseline remains original', mission['preBatchTip'] == captured)
        check(scope + ': public outcome matches persistent task', public['missions'][0]['status'] == mission['status'])
        check(scope + ': delivered result is a real Git commit', git(repo, 'cat-file', '-t', mission['resultCommit']) == 'commit')
        envelope = json.loads(git(repo, 'show', mission['resultCommit'] + ':results/train/result.json'))
        check(scope + ': result envelope identifies task and batch', envelope['mission_id'] == 'train' and envelope['batch_id'] == batch['id'])
        check(scope + ': result commit descends from original task', ancestor(repo, captured, mission['resultCommit']))
        if advanced:
            check(scope + ': later task change is genuinely distinct', advanced != captured)
            check(scope + ': actual branch contained change before delivery', before_delivery == advanced)
            check(scope + ': later commit object remains recoverable by id', git(repo, 'cat-file', '-t', advanced) == 'commit')
        if scope in ['before-run', 'during-run']:
            check('defect ' + scope + ': delivery silently reports task done', mission['status'] == 'done' and mission['error'] is None)
            check('defect ' + scope + ': batch silently reports done', final_batch['status'] == 'done')
            check('defect ' + scope + ': later commit exits mission branch history', not ancestor(repo, advanced, tip))
            check('defect ' + scope + ': branch file resets to original source', branch_source == 'source-original')
            check('defect ' + scope + ': branch points at old-base result', tip == mission['resultCommit'] and git(repo, 'rev-parse', tip + '^') == captured)
        elif scope == 'checked-out':
            check('control checked-out: Git refuses update explicitly', mission['status'] == 'failed' and bool(mission['error']))
            check('control checked-out: actual Git error explains checked-out branch', 'checked out' in mission['error'] or 'used by worktree' in mission['error'])
            check('control checked-out: branch remains exact newer tip', tip == advanced)
            check('control checked-out: later file remains revised', branch_source == 'source-revised')
            check('control checked-out: batch records delivery failure', final_batch['status'] == 'failed')
        else:
            check('control unchanged: task completes successfully', mission['status'] == 'done')
            check('control unchanged: branch contains actual result commit', tip == mission['resultCommit'])
            check('control unchanged: source stays original', branch_source == 'source-original')
    records['defect_reproduced'] = True
except Exception as error:
    event('error', {'type': type(error).__name__, 'message': str(error)})
    raise
finally:
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    event('isolated-dsh-stopped', {'pid': proc.pid if proc else None, 'exit': proc.poll() if proc else None,
        'pid_exists': Path('/proc/' + str(proc.pid)).exists() if proc else None})
    log.close()
    save()
print(json.dumps({'output': str(args.output), 'checks': len(records['checks']), 'passed': sum(c['passed'] for c in records['checks'])}))


