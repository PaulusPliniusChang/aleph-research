#!/usr/bin/env python3
"""Real DSH InfraOptimizer lifecycle with deterministic local model output."""
import argparse
import importlib.util
import json
import os
import re
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
parser.add_argument('--duplicate', action='store_true')
parser.add_argument('--expect-protection', action='store_true')
parser.add_argument('--direct-during-infra', action='store_true')
parser.add_argument('--duplicate-during-runner', action='store_true')
parser.add_argument('--hold-for-recovery', action='store_true')
args = parser.parse_args()
if (args.direct_during_infra or args.duplicate_during_runner or args.hold_for_recovery) and not args.expect_protection:
    parser.error('additional protection scenarios require --expect-protection')
spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch-project.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
runtime = Path('/opt/dsh-desktop-linux-bin/resources/app/dsh')
root, workspace, environment = launcher.prepare(args.source.resolve(), runtime)
bridge_dir = root / 'bridge'
shutil.copyfile(Path(__file__).with_name('diagnostic-bridge.mjs'), bridge_dir / 'diagnostic-bridge.mjs')
shutil.copyfile(Path(__file__).with_name('infra-deterministic-bridge.mjs'), bridge_dir / 'index.mjs')
(bridge_dir / 'node_modules').symlink_to(runtime / 'node_modules', target_is_directory=True)
profile = root / 'home/profiles/reproduction'
patch = profile / 'cordis.patch.yml'
patch.write_text(patch.read_text() + '- id: agent-default-model\n  config:\n    provider: aleph-test\n    model: deterministic\n- id: session-title-llm\n  disabled: true\n')
with socket.socket() as temporary:
    temporary.bind(('127.0.0.1', 0))
    port = temporary.getsockname()[1]
url = 'http://127.0.0.1:' + str(port)
records = {'environment': environment, 'url': url, 'boundary': 'Real DSH sessions, original spawn provider, tools, Git and storage; only model output is a local deterministic LlmAdapter with no network.', 'events': [], 'checks': []}
records['environment']['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
records['environment']['dsh_version'] = json.loads((runtime / 'package.json').read_text())['version']
records['command'] = [sys.executable, *sys.argv]
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


def http(path, body=None, timeout=10):
    request = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json', 'Origin': url})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def bridge(body, timeout=10):
    value = http('/api/aleph-test/bridge', body, timeout)
    event('bridge', {'request': body, 'response': value})
    if not value['ok']:
        raise RuntimeError(value)
    return value['result']


def git(repo, *command):
    return subprocess.check_output(['git', '-C', str(repo), *command], text=True, stderr=subprocess.PIPE).strip()


proc = None
try:
    log = (root / 'dsh.log').open('w')
    proc = subprocess.Popen(['node', str(runtime / 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'reproduction', '--no-open', '--host', '127.0.0.1', '--port', str(port)], cwd=workspace, env=dict(os.environ, DSH_HOME=str(root / 'home')), stdout=log, stderr=subprocess.STDOUT)
    for _ in range(150):
        if proc.poll() is not None:
            raise RuntimeError('isolated DSH exited; inspect local log ' + str(root / 'dsh.log'))
        try:
            state = http('/api/aleph-test/infra-control', {}, timeout=1)
            break
        except (OSError, urllib.error.URLError):
            time.sleep(.1)
    else:
        raise TimeoutError('real DSH deterministic adapter did not register')
    check('deterministic adapter registered before any model call', state['calls'] == [])
    parent = bridge({'action': 'parent', 'cwd': str(workspace)})
    sid = parent['sessionId']

    def tool(name, timeout=10, **kwargs):
        return bridge({'action': 'tool', 'sessionId': sid, 'name': name, 'args': kwargs}, timeout)

    project = tool('aleph_init_project', workspace=str(workspace))
    project_id = project['id']
    repo = Path(project['missionRoot'])
    git(repo, 'switch', '-c', 'mission/infra', 'template')
    mission = repo / 'missions/infra'
    mission.mkdir(parents=True)
    (mission / 'mission.json').write_text(json.dumps({'id': 'infra', 'entrypoint': 'run.sh'}))
    counter = root / 'executions.txt'
    runner_release = root / 'release-runner'
    gate = ('i=0; while [ ! -e \"' + str(runner_release) + '\" ] && [ $i -lt 500 ]; do i=$((i+1)); sleep 0.02; done\n') if args.duplicate_during_runner else ''
    (mission / 'run.sh').write_text('printf "run\\n" >> "' + str(counter) + '"\n' + gate + 'printf completed > "$ALEPH_OUTPUT_DIR/completed.txt"\n')
    git(repo, 'add', '-A')
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'real deterministic infra lifecycle')
    git(repo, 'switch', 'template')
    project = tool('aleph_propose_mission', project_id=project_id, branch='mission/infra')
    mission_id = project['missions'][0]['id']
    tool('aleph_approve_mission', project_id=project_id, mission_id=mission_id)
    project = tool('aleph_form_batch', project_id=project_id)
    batch = project['batches'][0]
    worktree = workspace / '.aleph/infra' / batch['id']
    request = {'action': 'tool', 'sessionId': sid, 'name': 'aleph_run_infra', 'args': {'project_id': project_id, 'batch_id': batch['id']}}
    try:
        bridge(request, timeout=.2)
    except (TimeoutError, socket.timeout):
        event('infra-request-detached-for-observation', request)
    for _ in range(150):
        state = http('/api/aleph-test/infra-control', {})
        if state['error']:
            raise RuntimeError('local deterministic adapter configuration failed: ' + state['error'])
        if state['waiting'] and (worktree / 'scratch/cache/active.txt').exists():
            break
        time.sleep(.1)
    else:
        event('adapter-timeout', state)
        event('projects-at-adapter-timeout', http('/api/aleph/projects'))
        raise TimeoutError('real child failed to execute marker tool and reach controlled pending state')
    before = event('before-duplicate-project', http('/api/aleph/projects'))['projects'][0]
    event('controlled-pending-adapter', state)
    check('local model first requested a real tool call', state['calls'][0].get('toolCall') is not None)
    check('local model reached next generation after tool execution', len(state['calls']) == 2)
    check('real child remains held by controlled model output', state['waiting'])
    check('model adapter has not been released', not state['released'])
    check('real child wrote handoff using actual tool', (worktree / 'ALEPH_HANDOFF.md').read_text() == 'real deterministic infra handoff\n')
    check('real child changed tracked source using actual tool', 'deterministic infra edit' in (worktree / 'missions/infra/run.sh').read_text())
    check('real child wrote nested untracked marker', (worktree / 'scratch/cache/active.txt').read_text() == 'real pending optimizer marker\n')
    check('pending optimizer has actual Git worktree', git(worktree, 'rev-parse', '--show-toplevel') == str(worktree))
    check('pending optimizer leaves batch not completed', before['batches'][0]['status'] not in ['done', 'failed'])
    check('machine remains reserved during optimization', before['machines'][0]['status'] == 'busy')
    infra_agents = [item for item in before['agents'] if item['role'] == 'infra']
    check('exactly one optimizer is recorded before duplicate', len(infra_agents) == 1)
    child_id = infra_agents[0]['childId']
    check('optimizer record contains an actual child session id', bool(child_id))
    check('optimizer record is running', infra_agents[0]['status'] == 'running')
    check('actual optimizer child is resident', bridge({'action': 'live-agents', 'sessionId': child_id})['live'])
    child = event('actual-child-session', bridge({'action': 'inspect', 'sessionId': child_id}))
    check('actual child session has persisted header', child['header'] is not None)
    check('actual child header identifies the same child', child['header']['id'] == child_id)
    check('actual child was created by original subagent lifecycle', child['header']['origin'] == 'subagent')
    check('actual child uses infra preset', child['header']['agentPreset'] == 'aleph-infra')
    check('actual child belongs to the original real parent session', child['header']['parentSession'] == parent['sessionId'])
    if args.hold_for_recovery:
        deadline = time.monotonic() + 2.3
        while time.monotonic() < deadline:
            observed = http('/api/aleph/projects')['projects'][0]
            check('recovery scan preserves active infra batch', observed['batches'][0]['status'] not in ['done', 'failed'])
            check('recovery scan preserves reserved machine', observed['machines'][0]['status'] == 'busy')
            check('recovery scan preserves pending optimizer files', (worktree / 'scratch/cache/active.txt').exists())
            time.sleep(.4)
        event('after-active-infra-recovery-scans', observed)
    branch_tip = git(repo, 'rev-parse', batch['branch'])
    marker_before = (worktree / 'scratch/cache/active.txt').read_text()
    second_error = None
    if args.duplicate or args.direct_during_infra:
        sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']
        check('second request uses a distinct actual parent session', sid != parent['sessionId'])
        try:
            tool('aleph_run_batch' if args.direct_during_infra else 'aleph_run_infra', timeout=2, project_id=project_id, batch_id=batch['id'])
        except (RuntimeError, urllib.error.HTTPError) as error:
            second_error = str(error)
            if isinstance(error, urllib.error.HTTPError):
                second_error += error.read().decode()
        event('second-infra-call', {'error': second_error})
        after = event('after-duplicate-project', http('/api/aleph/projects'))['projects'][0]
        held = http('/api/aleph-test/infra-control', {})
        check('first actual child remains held during second request', held['waiting'] and not held['released'])
        check('first actual child remains resident after second request', bridge({'action': 'live-agents', 'sessionId': child_id})['live'])
        check('duplicate does not start another actual optimizer', len([item for item in after['agents'] if item['role'] == 'infra']) == 1)
        check('duplicate does not advance batch branch while child is pending', git(repo, 'rev-parse', batch['branch']) == branch_tip)
        if args.expect_protection:
            check('duplicate reports active execution before any Git operation', second_error is not None and re.search(r'already.*(?:active|running|started|claimed)|active.*(?:batch|execution|infra)|in.progress|reserved|not forming|not runnable.*running', second_error, re.I) is not None and not re.search(r'worktree add|already registered worktree|fatal:', second_error, re.I))
            check('duplicate does not start premature computation', not counter.exists())
            check('duplicate preserves active worktree directory', worktree.exists())
            check('duplicate preserves handoff bytes', (worktree / 'ALEPH_HANDOFF.md').read_text() == 'real deterministic infra handoff\n')
            check('duplicate preserves tracked optimizer changes', 'deterministic infra edit' in (worktree / 'missions/infra/run.sh').read_text())
            check('duplicate preserves nested optimizer marker', (worktree / 'scratch/cache/active.txt').read_text() == marker_before)
        else:
            check('duplicate reaches stale Git worktree registration error', second_error is not None and 'already registered worktree' in second_error)
            check('duplicate deleted active directory before child finished', not worktree.exists())
            check('duplicate deleted pending handoff', not (worktree / 'ALEPH_HANDOFF.md').exists())
            check('duplicate deleted tracked optimizer edits', not (worktree / 'missions/infra/run.sh').exists())
            check('duplicate deleted nested untracked marker', not (worktree / 'scratch/cache/active.txt').exists())
    event('controlled-release', http('/api/aleph-test/infra-control', {'action': 'release'}))
    if args.duplicate_during_runner:
        for _ in range(150):
            if counter.exists():
                break
            time.sleep(.05)
        check('actual batch runner reaches controlled compute gate', counter.exists())
        running_worktree = workspace / '.aleph/batches' / batch['id']
        running_identity = running_worktree.stat().st_ino
        running_head = git(running_worktree, 'rev-parse', 'HEAD')
        running_script = (running_worktree / 'missions/infra/run.sh').read_text()
        active_compute = event('active-compute-before-duplicates', http('/api/aleph/projects'))['projects'][0]
        check('optimizer has completed before running-phase repeat', active_compute['agents'][0]['status'] == 'done')
        check('batch is running during compute gate', active_compute['batches'][0]['status'] == 'running')
        check('machine remains busy during compute gate', active_compute['machines'][0]['status'] == 'busy')
        sid = bridge({'action': 'parent', 'cwd': str(workspace)})['sessionId']
        check('running-phase repeats use another actual parent', sid != parent['sessionId'])
        for name in ['aleph_run_infra', 'aleph_run_batch']:
            rejection = None
            try:
                tool(name, timeout=2, project_id=project_id, batch_id=batch['id'])
            except (RuntimeError, urllib.error.HTTPError) as error:
                rejection = str(error)
                if isinstance(error, urllib.error.HTTPError):
                    rejection += error.read().decode()
            event('running-phase-repeat', {'tool': name, 'error': rejection})
            check(name + ' reports active execution', rejection is not None and re.search(r'already.*(?:active|running|started|claimed)|active.*(?:batch|execution|infra)|in.progress|reserved|not forming|not runnable.*running', rejection, re.I) is not None)
            check(name + ' fails before Git worktree modification', not re.search(r'worktree add|already registered worktree|fatal:', rejection or '', re.I))
            check(name + ' preserves original running directory identity', running_worktree.stat().st_ino == running_identity)
            check(name + ' preserves running Git identity', git(running_worktree, 'rev-parse', 'HEAD') == running_head)
            check(name + ' preserves original runner script', (running_worktree / 'missions/infra/run.sh').read_text() == running_script)
            check(name + ' keeps one actual computation', len(counter.read_text().splitlines()) == 1)
            snapshot = http('/api/aleph/projects')['projects'][0]
            check(name + ' starts no additional real optimizer', len([item for item in snapshot['agents'] if item['role'] == 'infra']) == 1)
            check(name + ' keeps active machine busy', snapshot['machines'][0]['status'] == 'busy')
        runner_release.write_text('release actual compute\n')
        event('released-actual-runner', str(runner_release))
    for _ in range(150):
        final = http('/api/aleph/projects')['projects'][0]
        final_infra = [item for item in final['agents'] if item['role'] == 'infra']
        if final_infra and final_infra[0]['status'] in ['done', 'failed']:
            if final['batches'][0]['status'] in ['done', 'failed'] or final_infra[0]['status'] == 'failed':
                break
        time.sleep(.1)
    event('final-project', final)
    if args.duplicate and not args.expect_protection:
        check('first optimizer fails after controlled release', final_infra[0]['status'] == 'failed')
        check('failure is explicit in optimizer summary', bool(final_infra[0]['summary']))
        check('batch remains stranded in forming', final['batches'][0]['status'] == 'forming')
        check('machine remains stranded busy', final['machines'][0]['status'] == 'busy')
        check('mission has no delivered result', final['missions'][0]['result_commit'] is None)
        check('batch runner never executes after directory loss', not counter.exists())
        records['reproduced'] = True
    else:
        check('optimizer completes after controlled release', final_infra[0]['status'] == 'done')
        check('batch completes after normal optimizer handoff', final['batches'][0]['status'] == 'done')
        check('mission completes after normal optimizer handoff', final['missions'][0]['status'] == 'done')
        check('machine becomes idle after compute completes', final['machines'][0]['status'] == 'idle')
        check('batch branch contains actual optimizer edit', 'deterministic infra edit' in git(repo, 'show', batch['branch'] + ':missions/infra/run.sh'))
        check('batch branch contains actual handoff', git(repo, 'show', batch['branch'] + ':ALEPH_HANDOFF.md') == 'real deterministic infra handoff')
        check('actual task executes exactly once', len(counter.read_text().splitlines()) == 1)
        check('result commit equals actual mission tip', final['missions'][0]['result_commit'] == git(repo, 'rev-parse', 'mission/infra'))
        check('mission branch contains exactly one result delivery commit', len([subject for subject in git(repo, 'log', '--format=%s', 'mission/infra').splitlines() if subject.startswith('mission result ')]) == 1)
        envelope = json.loads(git(repo, 'show', 'mission/infra:results/infra/result.json'))
        check('delivered envelope identifies batch', envelope['batch_id'] == batch['id'])
        check('delivered envelope identifies mission', envelope['mission_id'] == 'infra')
        check('delivered envelope reports success', envelope['status'] == 'done')
        check('delivered mission has finish time', final['missions'][0]['finished_at'] is not None)
        check('batch has finish time', final['batches'][0]['finished_at'] is not None)
        records['normal_validated'] = True
    print(json.dumps({'output': str(args.output), 'root': str(root), 'checks': len(records['checks']), 'reproduced': records.get('reproduced'), 'normal_validated': records.get('normal_validated')}))
finally:
    if proc is not None and proc.poll() is None:
        if 'runner_release' in locals():
            runner_release.write_text('cleanup release\n')
        try:
            http('/api/aleph-test/infra-control', {'action': 'release'}, timeout=1)
        except Exception:
            pass
        proc.terminate()
        proc.wait(timeout=10)
        event('stopped-isolated-dsh', {'pid': proc.pid, 'returncode': proc.returncode})
    save()
