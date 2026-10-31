#!/usr/bin/env python3
"""Reproduce ALEPH-01 current machine overbooking in actual isolated DSH."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import shutil
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
control = root / 'control'
control.mkdir()
bin_dir = root / 'bin'
bin_dir.mkdir()
shutil.copyfile(Path(__file__).with_name('form-batch-git-scheduler.py'), bin_dir / 'git')
(bin_dir / 'git').chmod(0o755)
with socket.socket() as temporary:
    temporary.bind(('127.0.0.1', 0))
    port = temporary.getsockname()[1]
url = 'http://127.0.0.1:' + str(port)
environment['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
environment['dsh_version'] = json.loads((runtime / 'package.json').read_text())['version']
records = {'environment': environment, 'command': [sys.executable, *sys.argv], 'events': [], 'checks': [],
    'boundary': 'Real isolated DSH registered tools/storage/Git/runner and shell tasks. Transparent Git wrapper delays only second initial rev-parse template until first composition is persisted. Controlled request interleaving, not natural frequency. No model calls, fake project records or modified product.'}
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


def wait(predicate, label):
    deadline = time.monotonic() + 20
    while not predicate():
        if time.monotonic() > deadline:
            raise TimeoutError('fixture timed out: ' + label)
        time.sleep(.01)


cookie = ''

def http(path, body=None, timeout=40):
    request = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': url, 'Cookie': cookie})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def bridge(body):
    for attempt in range(100):
        try:
            value = http('/api/aleph-test/bridge', body)
            if not value['ok']:
                raise RuntimeError(value)
            return value['result']
        except urllib.error.HTTPError as error:
            if error.code != 404 or attempt == 99:
                raise
            time.sleep(.05)


def git(repo, *command):
    return subprocess.check_output(['/usr/bin/git', '-C', str(repo), *command], text=True).strip()


def request_tool(name, **kwargs):
    request = {'action': 'tool', 'sessionId': sid, 'name': name, 'args': kwargs}
    entered = time.monotonic()
    try:
        response = bridge(request)
        return {'entered': entered, 'completed': time.monotonic(), 'ok': True, 'request': request, 'value': response}
    except urllib.error.HTTPError as error:
        return {'entered': entered, 'completed': time.monotonic(), 'ok': False, 'request': request,
            'http_status': error.code, 'error': error.read().decode()}


def tool(name, **kwargs):
    result = request_tool(name, **kwargs)
    event('tool', result)
    if not result['ok']:
        raise RuntimeError(result)
    return result['value']


proc = None
pool = ThreadPoolExecutor(max_workers=2)
try:
    log = (root / 'dsh.log').open('w')
    command = ['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'reproduction',
        '--no-open', '--host', '127.0.0.1', '--port', str(port)]
    proc = subprocess.Popen(command, cwd=workspace,
        env=dict(os.environ, DSH_HOME=str(root / 'home'), PATH=str(bin_dir) + ':' + os.environ['PATH'],
            ALEPH_FORM_GIT_CONTROL=str(control)), stdout=log, stderr=subprocess.STDOUT)
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
    check('actual DSH project storage is registered', health['storage'] == 'aleph_project')
    sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']

    def public(pid):
        return next(p for p in http('/api/aleph/projects')['projects'] if p['project']['id'] == pid)

    def fixture(label, exit_code=0):
        target = workspace / label
        target.mkdir()
        project = tool('aleph_init_project', workspace=str(target))
        repo = Path(project['missionRoot'])
        pid = project['id']
        check(label + ': one actual machine exists', len(project['machines']) == 1)
        check(label + ': machine starts idle', project['machines'][0]['status'] == 'idle')
        git(repo, 'switch', '-c', 'mission/work', 'template')
        directory = repo / 'missions/work'
        directory.mkdir(parents=True)
        (directory / 'mission.json').write_text(json.dumps({'id': 'work', 'entrypoint': 'run.sh'}))
        counter = root / (label + '-starts.txt')
        (directory / 'run.sh').write_text('printf "%s\\n" "$ALEPH_OUTPUT_DIR" >> "' + str(counter) + '"\n'
            'while [ ! -e "$ALEPH_OUTPUT_DIR/release" ]; do sleep .02; done\n'
            'printf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\nexit ' + str(exit_code) + '\n')
        git(repo, 'add', '-A')
        git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'bounded task ' + label)
        tip = git(repo, 'rev-parse', 'HEAD')
        git(repo, 'switch', 'template')
        proposed = tool('aleph_propose_mission', project_id=pid, branch='mission/work')
        mission = proposed['missions'][0]
        check(label + ': proposal has real caller ownership', mission['ownerSession'] == sid)
        approved = tool('aleph_approve_mission', project_id=pid, mission_id=mission['id'])
        check(label + ': approval persisted', approved['missions'][0]['status'] == 'approved')
        return target, repo, pid, tip, counter

    for label, exit_code in [('success-control', 0), ('failure-control', 7)]:
        target, repo, pid, tip, counter = fixture(label, exit_code)
        formed = tool('aleph_form_batch', project_id=pid)
        batch = formed['batches'][0]
        output = target / '.aleph/batches' / batch['id'] / 'results/work'
        check(label + ': composition reserves machine', formed['machines'][0]['status'] == 'busy')
        check(label + ': machine names formed batch', formed['machines'][0]['batchId'] == batch['id'])
        check(label + ': real batch Git includes mission ancestor', git(repo, 'merge-base', '--is-ancestor', tip, batch['branch']) == '')
        refused = event(label + '-sequential-request', request_tool('aleph_form_batch', project_id=pid))
        check(label + ': reserved machine rejects sequential composition', not refused['ok'] and 'busy' in refused['error'])
        check(label + ': refusal adds no actual batch', len(public(pid)['batches']) == 1)
        running = pool.submit(request_tool, 'aleph_run_batch', project_id=pid, batch_id=batch['id'])
        wait(counter.exists, label + ' actual task start')
        check(label + ': compute actually active', not running.done())
        check(label + ': actual task starts once', len(counter.read_text().splitlines()) == 1)
        current = public(pid)
        check(label + ': actual compute retains machine reservation', current['machines'][0]['status'] == 'busy' and current['machines'][0]['batchId'] == batch['id'])
        refused = event(label + '-active-request', request_tool('aleph_form_batch', project_id=pid))
        check(label + ': active compute rejects new composition', not refused['ok'] and 'busy' in refused['error'])
        (output / 'release').write_text('release')
        completed = event(label + '-run-response', running.result(timeout=40))
        check(label + ': registered run call completes normally', completed['ok'])
        latest = event(label + '-terminal-public', public(pid))
        check(label + ': batch records actual compute outcome', latest['batches'][0]['status'] == ('failed' if exit_code else 'done'))
        check(label + ': terminal task releases machine', latest['machines'][0]['status'] == 'idle')
        check(label + ': terminal task clears owner', latest['machines'][0]['batchId'] is None)

    target, repo, pid, tip, counter = fixture('concurrent')
    (control / 'armed.json').write_text(json.dumps({'repo': str(repo)}))
    first_future = pool.submit(request_tool, 'aleph_form_batch', project_id=pid)
    wait(lambda: (control / 'entered-1.json').exists(), 'first public request reaches actual Git')
    check('first composition remains in progress when second public request begins', not first_future.done())
    second_future = pool.submit(request_tool, 'aleph_form_batch', project_id=pid)
    wait(lambda: second_future.done() or (control / 'entered-2.json').exists(), 'second public request reaches Git or rejects')
    first = event('first-concurrent-response', first_future.result(timeout=40))
    check('first actual public composition succeeds', first['ok'])
    after_first = event('first-persisted-before-second-release', public(pid))
    first_batch = after_first['batches'][0]
    check('first actual persisted batch owns local machine before release', after_first['machines'][0]['batchId'] == first_batch['id'])
    (control / 'release-second').write_text('release')
    second = event('second-concurrent-response', second_future.result(timeout=40))
    check('actual public request lifetimes overlap', second['entered'] < first['completed'])
    if args.expect_protection:
        check('second composition rejects held capacity', not second['ok'] and ('busy' in second['error'] or 'forming' in second['error']))
    else:
        check('defect second composition also succeeds', second['ok'])
        second_entry = json.loads((control / 'entered-2.json').read_text())
        check('both calls entered actual Git before first response', second_entry['entered'] < first['completed'])
    (control / 'armed.json').unlink()
    after_both = event('actual-project-after-both-compositions', public(pid))
    active = [b for b in after_both['batches'] if b['status'] in ['forming', 'running']]
    expected_count = 1 if args.expect_protection else 2
    check('actual unfinished batch count matches observed protected or defective capacity', len(active) == expected_count)
    check('all actual batches target same local machine', all(b['machine_id'] == 'local' for b in active))
    check('actual machine owner names last formed batch', after_both['machines'][0]['batchId'] == active[-1]['id'])
    check('actual mission owner names last formed batch', after_both['missions'][0]['batch_id'] == active[-1]['id'])
    for batch in active:
        check(batch['id'] + ': real batch Git descends from actual mission tip', git(repo, 'merge-base', '--is-ancestor', tip, batch['branch']) == '')
        check(batch['id'] + ': batch records the same actual mission', batch['mission_ids'] == [after_both['missions'][0]['id']])
    executions = []
    for batch in active:
        output = target / '.aleph/batches' / batch['id'] / 'results/work'
        future = pool.submit(request_tool, 'aleph_run_batch', project_id=pid, batch_id=batch['id'])
        executions.append((batch, output, future))
        wait(lambda: counter.exists() and str(output) in counter.read_text().splitlines(), 'actual task starts in distinct batch')
        check(batch['id'] + ': actual task is active before release', not future.done())
    starts = event('simultaneous-task-starts', counter.read_text().splitlines())
    check('actual simultaneous starts match persisted runnable batches', len(starts) == expected_count)
    check('every actual start uses a distinct actual batch worktree', set(starts) == {str(output) for _, output, _ in executions})
    check('actual concurrent tasks remain pending together', all(not future.done() for _, _, future in executions))
    for batch, output, future in executions:
        (output / 'release').write_text('release')
        result = event(batch['id'] + '-run-response', future.result(timeout=40))
        check(batch['id'] + ': actual run tool finishes normally', result['ok'])
    final = event('final-public-project', public(pid))
    check('all actual batch calls reach a terminal batch state', all(b['status'] in ['done','failed'] for b in final['batches']))
    if args.expect_protection:
        check('protected single batch delivers successfully', final['batches'][0]['status']=='done')
    else:
        check('duplicate execution encounters current delivery reference guard', [b['status'] for b in final['batches']]==['done','failed'])
        check('failed duplicate records exact Git expected-reference mismatch', 'but expected' in final['missions'][0]['error'])
        first_result=final['batches'][0]['summary']['missions'][0]['resultCommit']
        check('current delivery guard preserves first report branch commit', git(repo,'rev-parse','mission/work')==first_result)
    check('machine is idle after all actual tasks end', final['machines'][0]['status'] == 'idle')
    git_records = [json.loads(p.read_text()) for p in control.glob('git-*.json')]
    event('actual-git-arguments-and-results', sorted(git_records, key=lambda r: r['entered']))
    refused_updates = [r for r in git_records if r['returncode'] != 0]
    if args.expect_protection:
        check('protected composition has no failed actual Git command', not refused_updates)
    else:
        check('only duplicate report publication is refused by actual Git', len(refused_updates) == 1 and
            'update-ref' in refused_updates[0]['args'] and refused_updates[0]['returncode'] == 128 and
            'but expected' in refused_updates[0]['stderr'])
    records['protection_validated' if args.expect_protection else 'defect_reproduced'] = True
    print(json.dumps({'output': str(args.output), 'root': str(root), 'checks': len(records['checks']),
        'protection_validated': args.expect_protection, 'defect_reproduced': not args.expect_protection}))
finally:
    (control / 'release-second').write_text('release')
    for output in workspace.glob('*/.aleph/batches/*/results/work'):
        (output / 'release').write_text('release')
    pool.shutdown(wait=True)
    if proc is not None and proc.poll() is None:
        proc.terminate()
        proc.wait(timeout=10)
        event('stopped-isolated-dsh', {'pid': proc.pid, 'returncode': proc.returncode, 'pid_exists':Path('/proc/'+str(proc.pid)).exists()})
    save()
