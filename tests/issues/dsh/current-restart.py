#!/usr/bin/env python3
"""Reproduce ALEPH-05 with real registered DSH tools and a bounded batch."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--expect-recovery', action='store_true', help='validate repaired behavior rather than reproduce the baseline defect')
parser.add_argument('--restart-live', action='store_true', help='restart the real DSH host while the orphan task is still executing')
args = parser.parse_args()
if args.restart_live and not args.expect_recovery:
    parser.error('--restart-live requires --expect-recovery')
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
records['environment']['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
records['environment']['dsh_version'] = json.loads((runtime / 'package.json').read_text())['version']
records['command'] = [sys.executable, *sys.argv]
records['boundary'] = 'Real DSH host, registered tools, storage, actual Git, runner and task processes; deterministic shell workload, no model invocation.'
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


def bridge(body, timeout=30):
    for attempt in range(100):
        try:
            value = http('/api/aleph-test/bridge', body, timeout)
            break
        except urllib.error.HTTPError as error:
            # The product health route may register before the separate
            # diagnostic plugin has finished loading in the real DSH host.
            if error.code != 404 or attempt == 99:
                raise
            time.sleep(.05)
    event('bridge', {'request': body, 'response': value})
    if not value['ok']:
        raise RuntimeError(value)
    return value['result']


def git(repo, *command):
    return subprocess.check_output(['git', '-C', str(repo), *command], text=True).strip()


def processes():
    output = []
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            command = (path / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace').strip()
            cwd = (path / 'cwd').resolve()
            status = (path / 'status').read_text()
            ppid = int(next(line.split()[1] for line in status.splitlines() if line.startswith('PPid:')))
        except (FileNotFoundError, PermissionError, ProcessLookupError, StopIteration):
            continue
        if str(root) in command or str(cwd).startswith(str(root)):
            output.append({'pid': int(path.name), 'ppid': ppid, 'command': command, 'cwd': str(cwd)})
    return output


def start(label):
    log = (root / (label + '.log')).open('w')
    command = ['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'reproduction', '--no-open', '--host', '127.0.0.1', '--port', str(port)]
    proc = subprocess.Popen(command, cwd=workspace, env=dict(os.environ, DSH_HOME=str(root / 'home')), stdout=log, stderr=subprocess.STDOUT)
    for _ in range(150):
        if proc.poll() is not None:
            raise RuntimeError('isolated DSH exited; inspect local ' + str(root / (label + '.log')))
        try:
            health = http('/api/aleph/health', timeout=1)
            event(label, {'pid': proc.pid, 'health': health})
            return proc
        except (OSError, urllib.error.URLError):
            time.sleep(.1)
    raise TimeoutError('isolated DSH startup timed out')


proc = None
try:
    proc = start('initial-start')
    check('real DSH current plugin health', http('/api/aleph/health')['storage'] == 'aleph_project')
    parent = bridge({'action': 'parent', 'cwd': str(workspace)})
    sid = parent['sessionId']

    def tool(name, **kwargs):
        return bridge({'action': 'tool', 'sessionId': sid, 'name': name, 'args': kwargs})

    project = tool('aleph_init_project', workspace=str(workspace), eval_command='printf \'{"score":1}\\n\'')
    pid = project['id']
    repo = Path(project['missionRoot'])
    check('new project has no missions', project['missions'] == [])
    check('new project has no batches', project['batches'] == [])
    check('new project machine is idle', project['machines'][0]['status'] == 'idle')
    git(repo, 'switch', '-c', 'mission/restart', 'template')
    mission_dir = repo / 'missions/restart'
    mission_dir.mkdir(parents=True)
    (mission_dir / 'mission.json').write_text(json.dumps({'id': 'restart', 'entrypoint': 'run.sh'}))
    counter = root / 'execution-count.txt'
    (mission_dir / 'run.sh').write_text('printf "run\\n" >> "' + str(counter) + '"\nprintf "%s\\n" "$$" > "$ALEPH_OUTPUT_DIR/task.pid"\nprintf started > "$ALEPH_OUTPUT_DIR/started.txt"\nsleep ' + ('8' if args.restart_live else '4') + '\nprintf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\n')
    git(repo, 'add', '-A')
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'bounded restart reproduction')
    git(repo, 'switch', 'template')
    project = tool('aleph_propose_mission', project_id=pid, branch='mission/restart')
    mission = project['missions'][0]
    check('mission proposal is persisted', mission['status'] == 'proposed')
    check('proposal belongs to actual DSH parent session', mission['ownerSession'] == sid)
    approved = tool('aleph_approve_mission', project_id=pid, mission_id=mission['id'])
    check('leader approval is persisted', approved['missions'][0]['status'] == 'approved')
    project = tool('aleph_form_batch', project_id=pid)
    batch = project['batches'][0]
    check('new batch reserves local machine', project['machines'][0]['batchId'] == batch['id'])
    check('mission belongs to formed batch', project['missions'][0]['batchId'] == batch['id'])
    check('mission pre-batch commit matches actual branch', project['missions'][0]['preBatchTip'] == git(repo, 'rev-parse', 'mission/restart'))
    worktree = workspace / '.aleph/batches' / batch['id']
    result_dir = worktree / 'results/restart'
    request = {'action': 'tool', 'sessionId': sid, 'name': 'aleph_run_batch', 'args': {'project_id': pid, 'batch_id': batch['id']}}
    try:
        bridge(request, timeout=.2)
    except (TimeoutError, socket.timeout):
        event('request-detached-for-process-kill', {'request': request})
    for _ in range(100):
        if (result_dir / 'started.txt').exists():
            break
        time.sleep(.02)
    check('bounded real task started', (result_dir / 'started.txt').read_text() == 'started')
    event('before-crash-processes', processes())
    before = event('before-crash-projects', http('/api/aleph/projects'))['projects'][0]
    check('running command has a busy persisted machine', before['machines'][0]['status'] == 'busy')
    check('running command has expected durable batch state', before['batches'][0]['status'] == ('running' if args.expect_recovery else 'forming'))
    check('running command has expected durable mission state', before['missions'][0]['status'] == ('running' if args.expect_recovery else 'batched'))
    event('task-pid', int((result_dir / 'task.pid').read_text()))
    event('pre-crash-worktree-registration', git(repo, 'worktree', 'list', '--porcelain'))
    environment_bytes = Path('/proc', str(proc.pid), 'environ').read_bytes().split(b'\0')
    check('kill target has this exact isolated DSH_HOME', ('DSH_HOME=' + str(root / 'home')).encode() in environment_bytes)
    proc.kill()
    proc.wait(timeout=5)
    check('only selected host exited by SIGKILL', proc.returncode == -signal.SIGKILL)
    event('host-killed', {'pid': proc.pid, 'returncode': proc.returncode})
    event('immediately-after-crash-processes', processes())
    if args.restart_live:
        proc = start('same-home-live-restart')
        live = event('live-restart-project', http('/api/aleph/projects'))['projects'][0]
        check('live restart keeps machine busy', live['machines'][0]['status'] == 'busy')
        check('live restart keeps unfinished batch running', live['batches'][0]['status'] == 'running')
        check('live restart does not deliver result prematurely', live['missions'][0]['result_commit'] is None)
        check('live restart does not advance mission branch', git(repo, 'rev-parse', 'mission/restart') == project['missions'][0]['preBatchTip'])
        check('live restart retains active output worktree', (result_dir / 'started.txt').exists())
        check('live restart does not launch second task', len(counter.read_text().splitlines()) == 1)
        check('actual orphan compute remains visible', any('run.sh' in item['command'] or 'batch_runner.py' in item['command'] for item in processes()))
    for _ in range(100):
        if (result_dir / 'result.json').exists():
            break
        time.sleep(.1)
    check('bounded task completed after parent DSH death', (result_dir / 'completed.txt').read_text() == 'completed')
    completed = json.loads((result_dir / 'result.json').read_text())
    check('actual runner wrote successful result', completed['status'] == 'done' and completed['exit_code'] == 0)
    check('runner envelope identifies expected mission', completed['mission_id'] == 'restart')
    check('runner created batch summary after host death', (worktree / 'results/batch.json').exists())
    event('orphan-runner-completion', {'envelope': completed, 'processes': processes()})
    event('mission-tip-before-restart', git(repo, 'rev-parse', 'mission/restart'))
    if not args.restart_live:
        proc = start('same-home-restart')
    for _ in range(30):
        latest = http('/api/aleph/projects')['projects'][0]
        time.sleep(.1)
    event('post-restart-project', latest)
    check('same project identity persisted across actual DSH restart', latest['project']['id'] == pid)
    check('same mission persisted across actual DSH restart', latest['missions'][0]['id'] == mission['id'])
    check('same batch persisted across actual DSH restart', latest['batches'][0]['id'] == batch['id'])
    check('owner session persisted across actual DSH restart', latest['missions'][0]['owner_session'] == sid)
    if args.expect_recovery:
        check('interrupted batch reaches done after compute completion', latest['batches'][0]['status'] == 'done')
        check('interrupted mission reaches done after compute completion', latest['missions'][0]['status'] == 'done')
        check('machine becomes idle after actual compute exits', latest['machines'][0]['status'] == 'idle')
        check('machine reservation is released', latest['machines'][0]['batchId'] is None)
        tip = git(repo, 'rev-parse', 'mission/restart')
        result_commit = latest['missions'][0]['result_commit']
        check('completed result is delivered to actual mission tip', result_commit == tip)
        check('mission has terminal timestamp', latest['missions'][0]['finished_at'] is not None)
        check('batch has terminal timestamp', latest['batches'][0]['finished_at'] is not None)
        check('successful recovery records no mission error', latest['missions'][0]['error'] is None)
        check('actual mission branch advanced once', tip != project['missions'][0]['preBatchTip'])
        delivered = json.loads(git(repo, 'show', 'mission/restart:results/restart/result.json'))
        check('Git result envelope identifies same batch', delivered['batch_id'] == batch['id'])
        check('Git result envelope identifies same mission', delivered['mission_id'] == 'restart')
        check('Git result envelope records successful task', delivered['status'] == 'done')
        check('real task executed exactly once', len(counter.read_text().splitlines()) == 1)
        sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']
        try:
            tool('aleph_run_batch', project_id=pid, batch_id=batch['id'])
            retry_error = None
        except (RuntimeError, urllib.error.HTTPError) as error:
            retry_error = str(error)
        event('recovery-retry-result', retry_error)
        retried = http('/api/aleph/projects')['projects'][0]
        check('explicit retry preserves terminal batch', retried['batches'][0]['status'] == 'done')
        check('explicit retry preserves terminal mission', retried['missions'][0]['status'] == 'done')
        check('explicit retry preserves idle machine', retried['machines'][0]['status'] == 'idle')
        check('explicit retry preserves result commit', retried['missions'][0]['result_commit'] == result_commit)
        check('explicit retry preserves actual mission branch', git(repo, 'rev-parse', 'mission/restart') == tip)
        check('explicit retry never reruns task', len(counter.read_text().splitlines()) == 1)
        check('explicit retry retains delivered Git result', json.loads(git(repo, 'show', 'mission/restart:results/restart/result.json')) == delivered)
        proc.terminate()
        proc.wait(timeout=10)
        proc = start('second-same-home-restart')
        again = http('/api/aleph/projects')['projects'][0]
        check('second restart keeps batch done', again['batches'][0]['status'] == 'done')
        check('second restart keeps mission done', again['missions'][0]['status'] == 'done')
        check('second restart keeps machine idle', again['machines'][0]['status'] == 'idle')
        check('second restart keeps commit identity', again['missions'][0]['result_commit'] == result_commit)
        check('second restart does not advance branch', git(repo, 'rev-parse', 'mission/restart') == tip)
        check('second restart does not rerun compute', len(counter.read_text().splitlines()) == 1)
        records['recovery_validated'] = True
        print(json.dumps({'output': str(args.output), 'root': str(root), 'recovery_validated': True, 'checks': len(records['checks'])}))
        raise SystemExit(0)
    check('interrupted batch still forming after task completed', latest['batches'][0]['status'] == 'forming')
    check('mission still batched after task completed', latest['missions'][0]['status'] == 'batched')
    check('machine still busy after actual task completion', latest['machines'][0]['status'] == 'busy')
    check('result not delivered to mission branch', latest['missions'][0]['result_commit'] is None)
    check('mission lacks terminal timestamp after restart', latest['missions'][0]['finished_at'] is None)
    check('batch lacks terminal timestamp after restart', latest['batches'][0]['finished_at'] is None)
    check('restart records no explicit mission interruption error', latest['missions'][0]['error'] is None)
    check('mission branch not changed', git(repo, 'rev-parse', 'mission/restart') == mission['preBatchTip'] if mission.get('preBatchTip') else git(repo, 'rev-parse', 'mission/restart') == project['missions'][0]['preBatchTip'])
    event('post-restart-processes', processes())
    event('post-restart-worktree-registration', git(repo, 'worktree', 'list', '--porcelain'))
    check('completed result remains only in stale execution worktree', (result_dir / 'result.json').exists())
    sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']
    try:
        tool('aleph_run_batch', project_id=pid, batch_id=batch['id'])
        retry_error = None
    except urllib.error.HTTPError as error:
        retry_error = json.loads(error.read())
    event('retry-result', retry_error)
    check('retry fails due to stale registered worktree', retry_error is not None and 'already registered worktree' in json.dumps(retry_error))
    check('failed retry removed only copy of completed result', not (result_dir / 'result.json').exists())
    retried = event('post-retry-projects', http('/api/aleph/projects'))['projects'][0]
    check('failed retry leaves machine busy', retried['machines'][0]['status'] == 'busy')
    check('failed retry leaves batch forming', retried['batches'][0]['status'] == 'forming')
    check('failed retry leaves mission batched', retried['missions'][0]['status'] == 'batched')
    records['reproduced'] = True
    print(json.dumps({'output': str(args.output), 'root': str(root), 'reproduced': True, 'checks': len(records['checks'])}))
finally:
    if proc is not None and proc.poll() is None:
        proc.terminate()
        proc.wait(timeout=10)
        event('stopped-final-isolated-dsh', {'pid': proc.pid, 'returncode': proc.returncode})
    save()
