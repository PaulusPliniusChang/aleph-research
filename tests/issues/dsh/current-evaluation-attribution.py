#!/usr/bin/env python3
"""Observe evaluation source/report attribution through real DSH tools and Git."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--expect-protection', action='store_true')
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch-project.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
runtime = Path('/opt/dsh-desktop-linux-bin/resources/app/dsh')
root, workspace, environment = launcher.prepare(args.source.resolve(), runtime)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
url = 'http://127.0.0.1:' + str(port)
environment['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
environment['dsh_version'] = json.loads((runtime / 'package.json').read_text())['version']
records = {'environment': environment, 'command': [sys.executable, *sys.argv], 'events': [], 'checks': [],
    'boundary': 'Original isolated DSH registered tools, real parent session, persistent storage, research Git branches, detached evaluation worktrees, and actual Python evaluator. Diagnostic bridge invokes tools without models. Evaluator waits on a release file to allow real branch switch/advance. No source edits, mocked Git, or external model.'}
args.output.parent.mkdir(parents=True, exist_ok=True)


def save():
    args.output.write_text(json.dumps(records, indent=2))


def event(name, value):
    records['events'].append({'name': name, 'monotonic': time.monotonic(), 'value': value})
    save()
    return value


def check(name, condition):
    records['checks'].append({'name': name, 'passed': bool(condition)})
    save()
    if not condition:
        raise AssertionError(name)


def http(path, body=None, timeout=30):
    request = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': url})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def bridge(body):
    value = http('/api/aleph-test/bridge', body)
    if not value['ok']:
        raise RuntimeError(value)
    return value['result']


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


def commit(repo, message):
    git(repo, 'add', '-A')
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', message)
    return git(repo, 'rev-parse', 'HEAD')


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
        raise TimeoutError('DSH startup timeout')
    check('real project storage is registered', health['storage'] == 'aleph_project')
    for _ in range(100):
        try:
            sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']
            break
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            time.sleep(.05)
    else:
        raise TimeoutError('diagnostic bridge startup timeout')
    event('real-parent-session', bridge({'action': 'inspect', 'sessionId': sid}))

    def tool(name, **kwargs):
        return bridge({'action': 'tool', 'sessionId': sid, 'name': name, 'args': kwargs})

    for scope in ['stable', 'switch', 'advance']:
        directory = workspace / scope
        directory.mkdir()
        gate = root / (scope + '-gate')
        gate.mkdir()
        script = gate / 'evaluate.py'
        script.write_text("import json,os,pathlib,time\nroot=pathlib.Path(" + repr(str(gate)) + ")\n"
            "algorithm=pathlib.Path('algorithm.txt').read_text().strip()\n"
            "(root/'ready.json').write_text(json.dumps({'algorithm':algorithm,'cwd':os.getcwd(),'solution':os.environ['ALEPH_SOLUTION_DIR']}))\n"
            "deadline=time.monotonic()+15\nwhile not (root/'release').exists():\n"
            " if time.monotonic()>deadline:raise RuntimeError('fixture release timeout')\n time.sleep(.01)\n"
            "print(json.dumps({'score':11 if algorithm=='algorithm-a' else 29,'algorithm':algorithm}))\n")
        project = tool('aleph_init_project', workspace=str(directory), eval_command='python3 ' + shlex.quote(str(script)))
        pid = project['id']
        repo = Path(project['researchRoot'])
        git(repo, 'switch', '-c', 'research/a')
        (repo / 'algorithm.txt').write_text('algorithm-a\n')
        captured = commit(repo, 'algorithm a')
        git(repo, 'switch', '-c', 'research/b')
        (repo / 'algorithm.txt').write_text('algorithm-b\n')
        other = commit(repo, 'algorithm b')
        git(repo, 'switch', 'research/a')
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(tool, 'aleph_evaluate', project_id=pid)
            try:
                deadline = time.monotonic() + 10
                while not (gate / 'ready.json').exists():
                    if pending.done():
                        pending.result()
                        raise RuntimeError('evaluation ended before ready')
                    if time.monotonic() > deadline:
                        raise TimeoutError('actual evaluator startup timeout')
                    time.sleep(.02)
                evaluated = event(scope + '-actual-evaluation', json.loads((gate / 'ready.json').read_text()))
                check(scope + ': actual evaluator reads algorithm a', evaluated['algorithm'] == 'algorithm-a')
                check(scope + ': actual evaluator uses solution directory', evaluated['cwd'] == evaluated['solution'])
                check(scope + ': actual worktree is independently detached', git(evaluated['cwd'], 'rev-parse', '--abbrev-ref', 'HEAD') == 'HEAD')
                check(scope + ': actual worktree points to captured code', git(evaluated['cwd'], 'rev-parse', 'HEAD') == captured)
                check(scope + ': actual shared repo initially on research a', git(repo, 'branch', '--show-current') == 'research/a')
                advanced = None
                if scope == 'switch':
                    git(repo, 'switch', 'research/b')
                if scope == 'advance':
                    (repo / 'algorithm.txt').write_text('algorithm-a-revised\n')
                    advanced = commit(repo, 'new research during old evaluation')
            finally:
                (gate / 'release').write_text('release')
            result = pending.result()
        tip = result['researchCommit']
        parent = git(repo, 'rev-parse', tip + '^')
        algorithm = git(repo, 'show', tip + ':algorithm.txt')
        report = git(repo, 'show', '-s', '--format=%B', tip)
        public = next(p for p in http('/api/aleph/projects')['projects'] if p['project']['id'] == pid)
        event(scope + '-final-report', {'captured': captured, 'other': other, 'advanced': advanced, 'evaluated': evaluated,
            'result': result, 'parent': parent, 'returnedAlgorithm': algorithm, 'report': report, 'public': public})
        check(scope + ': tool returns successful result', result['status'] == 'done' and result['projectId'] == pid)
        check(scope + ': real evaluator score belongs to algorithm a', result['score'] == 11)
        check(scope + ': actual stdout identifies algorithm a', json.loads(result['stdout'])['algorithm'] == 'algorithm-a')
        check(scope + ': successful evaluation has no stderr', result['stderr'] == '')
        check(scope + ': returned object is a real Git commit', git(repo, 'cat-file', '-t', tip) == 'commit')
        check(scope + ': report records matching numeric score', 'Aleph-Evaluation: 11' in report)
        check(scope + ': report identifies evaluated algorithm a', '"algorithm": "algorithm-a"' in report)
        check(scope + ': evaluation worktree is cleaned', not Path(evaluated['cwd']).exists())
        check(scope + ': actual worktree registration is cleaned', evaluated['cwd'] not in git(repo, 'worktree', 'list', '--porcelain'))
        check(scope + ': real project still has no compute missions', public['missions'] == [])
        if args.expect_protection:
            check(scope + ': protected report parent matches actual evaluated code', parent == captured)
            check(scope + ': protected report tree contains evaluated algorithm', algorithm == 'algorithm-a')
            check(scope + ': original evaluated commit is explicitly returned', result['evaluatedCommit'] == captured)
            check(scope + ': report identifies exact evaluated commit', 'Aleph-Research-Commit: ' + captured in report)
            check(scope + ': durable evaluation reference resolves to returned report', git(repo, 'rev-parse', result['evaluationRef']) == tip)
            check(scope + ': unrelated branch remains at original algorithm b', git(repo, 'rev-parse', 'research/b') == other)
            if scope == 'switch':
                check('protected switch: evaluated original branch receives its own report', git(repo, 'rev-parse', 'research/a') == tip)
                check('protected switch: shared repository stays on unrelated branch', git(repo, 'branch', '--show-current') == 'research/b')
                check('protected switch: unrelated working algorithm remains b', (repo / 'algorithm.txt').read_text().strip() == 'algorithm-b')
                check('protected switch: conditional original branch update succeeds', result['researchBranchUpdated'] is True)
            elif scope == 'advance':
                check('protected advance: original branch retains exact new tip', git(repo, 'rev-parse', 'research/a') == advanced)
                check('protected advance: new source remains reachable', git(repo, 'merge-base', '--is-ancestor', advanced, 'research/a') == '')
                check('protected advance: current file keeps newer algorithm', (repo / 'algorithm.txt').read_text().strip() == 'algorithm-a-revised')
                check('protected advance: branch update is explicitly declined', result['researchBranchUpdated'] is False)
            else:
                check('protected stable: original branch advances to its own report', git(repo, 'rev-parse', 'research/a') == tip)
                check('protected stable: successful conditional branch update is returned', result['researchBranchUpdated'] is True)
        elif scope == 'stable':
            check('stable: report parent matches evaluated code', parent == captured)
            check('stable: report tree contains evaluated algorithm', algorithm == 'algorithm-a')
            check('stable: unrelated branch remains unchanged', git(repo, 'rev-parse', 'research/b') == other)
        elif scope == 'switch':
            check('defect switch: report parent is other algorithm commit', parent == other and parent != captured)
            check('defect switch: returned report tree contains algorithm b', algorithm == 'algorithm-b')
            check('defect switch: unrelated branch receives algorithm a report', git(repo, 'rev-parse', 'research/b') == tip and tip != other)
            check('defect switch: original evaluated branch receives no report', git(repo, 'rev-parse', 'research/a') == captured)
        else:
            check('defect advance: report parent is revised untested code', parent == advanced and parent != captured)
            check('defect advance: report tree contains revised untested algorithm', algorithm == 'algorithm-a-revised')
            check('advance: new code remains reachable', git(repo, 'merge-base', '--is-ancestor', advanced, 'research/a') == '')
    records['defect_reproduced'] = not args.expect_protection
    records['protection_validated'] = args.expect_protection
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
