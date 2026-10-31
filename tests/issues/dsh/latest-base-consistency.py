#!/usr/bin/env python3
"""Check ALEPH-06 against actual current DSH tools and Git result parents."""
import argparse
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
records['boundary'] = ('Real isolated DSH host, registered tools, persistent storage, Git merges and actual shell runner; '
    'diagnostic bridge invokes the registered tools without model calls. Independent missions advance before composition '
    '(alpha after proposal, beta after approval). No global SOTA inheritance requirement or post-composition branch mutation.')
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


cookie = ''


def http(path, body=None, timeout=30):
    request = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': url, 'Cookie': cookie})
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


proc = None
try:
    log = (root / 'dsh.log').open('w')
    command = ['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'reproduction',
        '--no-open', '--host', '127.0.0.1', '--port', str(port)]
    proc = subprocess.Popen(command, cwd=workspace, env=dict(os.environ, DSH_HOME=str(root / 'home')),
        stdout=log, stderr=subprocess.STDOUT)
    for _ in range(150):
        if proc.poll() is not None:
            raise RuntimeError('isolated DSH exited; inspect local ' + str(root / 'dsh.log'))
        try:
            health = http('/api/aleph/health', timeout=1)
            break
        except (OSError, urllib.error.URLError):
            time.sleep(.1)
    else:
        raise TimeoutError('isolated DSH startup timed out')
    login = (root / 'dsh.log').read_text().split('dsh web: ')[-1].split()[0]
    no_redirect = urllib.request.build_opener(type('NoRedirect', (urllib.request.HTTPRedirectHandler,), {'redirect_request': lambda *a: None})())
    try:
        no_redirect.open(login)
        raise AssertionError('expected login redirect')
    except urllib.error.HTTPError as response:
        assert response.code == 303
        cookie = response.headers['Set-Cookie'].split(';')[0]
    event('authenticated-host', {'origin': url, 'cookie_present': bool(cookie)})
    check('real DSH current project storage is registered', health['storage'] == 'aleph_project')
    sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']

    def tool(name, **kwargs):
        return bridge({'action': 'tool', 'sessionId': sid, 'name': name, 'args': kwargs})

    project = tool('aleph_init_project', workspace=str(workspace))
    pid = project['id']
    repo = Path(project['missionRoot'])
    template = git(repo, 'rev-parse', 'template')
    check('new project has no missions', project['missions'] == [])
    check('new project has no batches', project['batches'] == [])
    check('new project machine starts idle', project['machines'][0]['status'] == 'idle')
    missions = []
    for name in ['alpha', 'beta']:
        branch = 'mission/' + name
        git(repo, 'switch', '-c', branch, 'template')
        directory = repo / 'missions' / name
        directory.mkdir(parents=True)
        (directory / 'mission.json').write_text(json.dumps({'id': name, 'entrypoint': 'run.sh'}))
        (directory / 'source.txt').write_text(name + '-initial\n')
        (directory / 'run.sh').write_text(
            'git rev-parse HEAD > "' + str(root / (name + '-runtime-head.txt')) + '"\n'
            'cat source.txt > "' + str(root / (name + '-runtime-source.txt')) + '"\n'
            'printf "run\\n" >> "' + str(root / (name + '-executions.txt')) + '"\n'
            'printf complete > "$ALEPH_OUTPUT_DIR/completed.txt"\n')
        initial = commit(repo, 'initial mission ' + name)
        git(repo, 'switch', 'template')
        proposed = tool('aleph_propose_mission', project_id=pid, branch=branch)
        mission = proposed['missions'][-1]
        check(name + ' proposal records actual branch', mission['branch'] == branch)
        check(name + ' proposal has no premature captured baseline', mission['preBatchTip'] is None)
        check(name + ' proposal belongs to real DSH parent session', mission['ownerSession'] == sid)
        check(name + ' proposal starts proposed', mission['status'] == 'proposed')
        if name == 'beta':
            approved = tool('aleph_approve_mission', project_id=pid, mission_id=mission['id'])
            check(name + ' approval before advance is persisted', approved['missions'][-1]['status'] == 'approved')
        git(repo, 'switch', branch)
        expected_source = name + ('-after-proposal' if name == 'alpha' else '-after-approval')
        (repo / 'missions' / name / 'source.txt').write_text(expected_source + '\n')
        expected_tip = commit(repo, 'legitimate branch advance ' + name)
        git(repo, 'switch', 'template')
        check(name + ' source advance creates a distinct Git commit', expected_tip != initial)
        if name == 'alpha':
            approved = tool('aleph_approve_mission', project_id=pid, mission_id=mission['id'])
            check(name + ' approval after advance is persisted', approved['missions'][-1]['status'] == 'approved')
        missions.append({'name': name, 'branch': branch, 'id': mission['id'], 'initial': initial,
            'expected_tip': expected_tip, 'expected_source': expected_source})
    formed = tool('aleph_form_batch', project_id=pid)
    batch = formed['batches'][0]
    batch_tip = git(repo, 'rev-parse', batch['branch'])
    formed_public = event('formed-public-projects', http('/api/aleph/projects'))['projects'][0]
    check('batch records actual template baseline', batch['baseTip'] == template)
    check('batch includes both independent mission identities', batch['missionIds'] == [m['id'] for m in missions])
    check('batch reserves the actual machine', formed['machines'][0]['batchId'] == batch['id'])
    for m in missions:
        name = m['name']
        record = next(item for item in formed['missions'] if item['id'] == m['id'])
        visible = next(item for item in formed_public['missions'] if item['id'] == m['id'])
        check(name + ' composition captures latest actual branch tip', record['preBatchTip'] == m['expected_tip'])
        check(name + ' public captured baseline matches actual tip', visible['pre_batch_tip'] == m['expected_tip'])
        check(name + ' actual composed Git ancestry includes captured tip', git(repo, 'merge-base', '--is-ancestor', m['expected_tip'], batch_tip) == '')
        check(name + ' composed source includes legitimate precomposition advance', git(repo, 'show', batch_tip + ':missions/' + name + '/source.txt') == m['expected_source'])
        check(name + ' actual mission branch remains at captured tip before execution', git(repo, 'rev-parse', m['branch']) == m['expected_tip'])
    finished = tool('aleph_run_batch', project_id=pid, batch_id=batch['id'])
    public = event('finished-public-projects', http('/api/aleph/projects'))['projects'][0]
    check('batch finishes successfully', finished['batches'][0]['status'] == 'done')
    check('public batch reaches done', public['batches'][0]['status'] == 'done')
    check('actual machine is released', finished['machines'][0]['status'] == 'idle')
    check('machine reservation is cleared', finished['machines'][0]['batchId'] is None)
    for m in missions:
        name = m['name']
        record = next(item for item in finished['missions'] if item['id'] == m['id'])
        visible = next(item for item in public['missions'] if item['id'] == m['id'])
        parent = git(repo, 'rev-parse', record['resultCommit'] + '^')
        envelope = json.loads(git(repo, 'show', record['resultCommit'] + ':results/' + name + '/result.json'))
        event(name + '-delivery', {'mission': m, 'record': record, 'parent': parent, 'envelope': envelope, 'batch_tip': batch_tip})
        check(name + ' actual runner executes composed batch commit', (root / (name + '-runtime-head.txt')).read_text().strip() == batch_tip)
        check(name + ' actual runner reads advanced source', (root / (name + '-runtime-source.txt')).read_text().strip() == m['expected_source'])
        check(name + ' delivered commit parent equals recorded preBatchTip', parent == record['preBatchTip'])
        check(name + ' stored baseline remains actual precomposition tip', record['preBatchTip'] == m['expected_tip'])
        check(name + ' resultCommit equals actual delivered mission tip', record['resultCommit'] == git(repo, 'rev-parse', m['branch']))
        check(name + ' public result_commit equals actual delivered commit', visible['result_commit'] == record['resultCommit'])
        check(name + ' delivered branch retains captured source', git(repo, 'show', m['branch'] + ':missions/' + name + '/source.txt') == m['expected_source'])
        check(name + ' delivery adds only own artifacts and result envelope',
            git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', record['resultCommit']).splitlines() ==
            ['results/' + name + '/' + item for item in ['completed.txt', 'result.json', 'run.log']])
        check(name + ' envelope identifies own mission', envelope['mission_id'] == name)
        check(name + ' envelope identifies actual batch', envelope['batch_id'] == batch['id'])
        check(name + ' real computation succeeded', envelope['status'] == 'done' and envelope['exit_code'] == 0)
        check(name + ' actual task executes once', (root / (name + '-executions.txt')).read_text().splitlines() == ['run'])
        check(name + ' mission reaches done', record['status'] == 'done')
        check(name + ' public mission reaches done', visible['status'] == 'done')
    records['current_scope_validated'] = True
    print(json.dumps({'output': str(args.output), 'root': str(root), 'checks': len(records['checks']), 'current_scope_validated': True}))
finally:
    if proc is not None and proc.poll() is None:
        proc.terminate()
        proc.wait(timeout=10)
        event('stopped-isolated-dsh', {'pid': proc.pid, 'returncode': proc.returncode,
            'pid_exists': Path('/proc/' + str(proc.pid)).exists()})
    save()
