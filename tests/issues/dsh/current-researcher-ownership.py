#!/usr/bin/env python3
"""Observe researcher record ownership using original real DSH child sessions."""
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
bridge_dir = root / 'bridge'
shutil.copyfile(Path(__file__).with_name('diagnostic-bridge.mjs'), bridge_dir / 'diagnostic-bridge.mjs')
shutil.copyfile(Path(__file__).with_name('researcher-deterministic-bridge.mjs'), bridge_dir / 'index.mjs')
(bridge_dir / 'node_modules').symlink_to(runtime / 'node_modules', target_is_directory=True)
patch = root / 'home/profiles/reproduction/cordis.patch.yml'
patch.write_text(patch.read_text() + '- id: agent-default-model\n  config:\n    provider: aleph-test\n    model: deterministic\n- id: session-title-llm\n  disabled: true\n')
with socket.socket() as temporary:
    temporary.bind(('127.0.0.1', 0))
    port = temporary.getsockname()[1]
url = 'http://127.0.0.1:' + str(port)
environment['dirty'] = subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain', '--untracked-files=no'], text=True)
environment['dsh_version'] = json.loads((runtime / 'package.json').read_text())['version']
records = {'environment': environment, 'command': [sys.executable, *sys.argv], 'events': [], 'checks': [],
    'boundary': 'Actual DSH parent/child sessions, original spawn provider, registered tools, persistent projects, Git initialization and actual bash. Only model responses/wait timing use local deterministic LlmAdapter. Two real success lifecycles; activation rejection callback separately covered by automatic adapter, not claimed here. No external model or credentials.'}
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


def http(path, body=None, timeout=10):
    request = urllib.request.Request(url + path, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Origin': url})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def wait(predicate, label):
    deadline = time.monotonic() + 20
    while not predicate():
        if time.monotonic() > deadline:
            raise TimeoutError('fixture timeout: ' + label)
        time.sleep(.05)


def bridge(body):
    value = http('/api/aleph-test/bridge', body)
    if not value['ok']:
        raise RuntimeError(value)
    return event('bridge', {'request': body, 'result': value['result']})['result']


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
            initial = http('/api/aleph-test/researcher-control', {}, timeout=1)
            break
        except (OSError, urllib.error.URLError):
            time.sleep(.1)
    else:
        raise TimeoutError('real DSH researcher control did not register')
    check('real DSH deterministic adapter starts without child calls', initial['states'] == [])
    parent = bridge({'action': 'parent', 'cwd': str(workspace)})
    sid = parent['sessionId']

    def tool(name, **kwargs):
        return bridge({'action': 'tool', 'sessionId': sid, 'name': name, 'args': kwargs})

    def control(**kwargs):
        return http('/api/aleph-test/researcher-control', dict(parentId=sid, **kwargs))

    project = tool('aleph_init_project', workspace=str(workspace))
    pid = project['id']

    def public():
        return next(p for p in http('/api/aleph/projects')['projects'] if p['project']['id'] == pid)

    check('project initially has no agent records', public()['agents'] == [])
    one = tool('aleph_run_researcher', project_id=pid)
    two = tool('aleph_run_researcher', project_id=pid)
    check('real researcher calls have distinct child identities', one['childId'] != two['childId'])
    wait(lambda: len(control()['states']) == 2 and all(s['waiting'] for s in control()['states']), 'both actual researchers independently waiting after bash')
    before = event('before-release-project', public())
    held = event('both-actual-children-waiting', control())
    check('registered status contains both real researcher records', len(before['agents']) == 2)
    for index, call in enumerate([one, two], 1):
        child = call['childId']
        record = next(a for a in before['agents'] if a['childId'] == child)
        state = next(s for s in held['states'] if s['sessionId'] == child)
        check(f'child{index}: actual project records running', record['status'] == 'running')
        check(f'child{index}: actual project has no terminal summary', record['summary'] is None)
        check(f'child{index}: actual model independently waiting', state['waiting'] and not state['released'])
        check(f'child{index}: actual agent is live', state['live'])
        check(f'child{index}: actual model executed tool before second generation', state['calls'] == 2 and 'toolCall' in state)
        marker = Path(project['researchRoot']) / ('researcher-' + child + '.txt')
        check(f'child{index}: actual bash wrote marker in research repository', marker.exists() and marker.read_text().strip() == project['researchRoot'])
        inspected = bridge({'action': 'inspect', 'sessionId': child})
        event('child' + str(index) + '-actual-header', inspected['header'])
        check(f'child{index}: session is a real subagent', inspected['header'].get('origin') == 'subagent')
        # Parent/preset identity is stored in catalog metadata; inspect exact fields below.
    event('release-first', control(action='release', sessionId=one['childId']))
    wait(lambda: next(a for a in public()['agents'] if a['childId'] == one['childId'])['status'] == 'done', 'first actual callback persisted')
    after_first = event('after-first-project', public())
    child_states = event('after-first-actual-children', control())
    first_record = next(a for a in after_first['agents'] if a['childId'] == one['childId'])
    second_record = next(a for a in after_first['agents'] if a['childId'] == two['childId'])
    second_actual = next(s for s in child_states['states'] if s['sessionId'] == two['childId'])
    first_summary = 'Distinct researcher result for ' + one['childId']
    second_summary = 'Distinct researcher result for ' + two['childId']
    check('first real activation records successful completion', first_record['status'] == 'done')
    check('first real activation records distinct emitted summary', first_record['summary'] == first_summary)
    check('second real child remains independently blocked', second_actual['waiting'] and not second_actual['released'])
    check('second real child remains live after first completes', second_actual['live'])
    check('second real child has not emitted a terminal result', second_actual['emittedSummary'] is None)
    if args.expect_protection:
        check('second persistent record remains running', second_record['status'] == 'running')
        check('second persistent summary remains empty', second_record['summary'] is None)
    else:
        check('defect: second pending child is prematurely recorded done', second_record['status'] == 'done')
        check('defect: first summary overwrites second pending record', second_record['summary'] == first_summary)
    queried = event('registered-status-after-first', tool('aleph_status', project_id=pid))
    check('registered status exposes actual stored second-child state', next(a for a in queried[0]['agents'] if a['childId'] == two['childId']) == second_record)
    event('release-second', control(action='release', sessionId=two['childId']))
    wait(lambda: next(s for s in control()['states'] if s['sessionId'] == two['childId'])['emittedSummary'] == second_summary, 'second actual distinct output')
    # Wait for actual Agent to settle, then allow callback storage microtasks to flush.
    wait(lambda: next(s for s in control()['states'] if s['sessionId'] == two['childId'])['agentStatus'] == 'idle', 'second actual agent idle')
    time.sleep(.1)
    final = event('final-actual-project', public())
    final_control = event('final-actual-children', control())
    last = next(a for a in final['agents'] if a['childId'] == two['childId'])
    check('second real model emitted its distinct final summary', next(s for s in final_control['states'] if s['sessionId'] == two['childId'])['emittedSummary'] == second_summary)
    check('second real session finished waiting', not next(s for s in final_control['states'] if s['sessionId'] == two['childId'])['waiting'])
    check('first persistent result remains unchanged', next(a for a in final['agents'] if a['childId'] == one['childId']) == first_record)
    check('no extra researcher records appear', len(final['agents']) == 2)
    if args.expect_protection:
        check('later real callback records own summary', last['status'] == 'done' and last['summary'] == second_summary)
    else:
        check('defect: later real callback leaves overwritten summary unrepaired', last['status'] == 'done' and last['summary'] == first_summary)
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
