"""Real ordinary descendants. Observations live outside the solution worktree."""
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

root = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
role = sys.argv[3] if len(sys.argv) > 3 else 'entry'
solution = pathlib.Path(os.environ.get('ALEPH_SOLUTION_DIR', root))

def event(kind, **extra):
    with (root / (role + '.jsonl')).open('a') as stream:
        stream.write(json.dumps(dict(kind=kind, pid=os.getpid(), at=time.time_ns(),
                                    solutionExists=solution.exists(), **extra)) + '\n')

def terminate(number, frame):
    event('signal', signal=number)
    if mode == 'ignore-entry' and role == 'entry':
        return
    if mode == 'ignore-grandchild' and role == 'grandchild':
        return
    sys.exit(128 + number)

signal.signal(signal.SIGTERM, terminate)
fields = pathlib.Path('/proc/self/stat').read_text().split(')')[-1].split()
(root / (role + '.json')).write_text(json.dumps(dict(pid=os.getpid(), ppid=os.getppid(),
    pgid=os.getpgid(0), sid=os.getsid(0), start=fields[19], cwd=os.getcwd(), solution=str(solution))))

if role == 'entry' and mode == 'success':
    print(json.dumps(dict(score=17, text='评估成功')))
    print('evaluation warning', file=sys.stderr)
    sys.exit(0)
if role == 'entry' and mode == 'failure':
    print('controlled evaluation failure', file=sys.stderr)
    sys.exit(7)
if role == 'entry' and mode == 'overflow':
    print('x' * 16384, flush=True)

child = None
if mode not in ['direct', 'overflow'] and role != 'grandchild':
    next_role = 'worker' if role == 'entry' else 'grandchild'
    child = subprocess.Popen([sys.executable, __file__, str(root), mode, next_role],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if role == 'entry' and mode in ['background-success', 'background-failure']:
    deadline = time.monotonic() + 5
    while not (root / 'grandchild.json').exists():
        if time.monotonic() > deadline:
            raise RuntimeError('descendants did not become ready')
        time.sleep(.01)
    if mode == 'background-failure':
        print('background evaluation failure', file=sys.stderr)
        sys.exit(9)
    print(json.dumps(dict(score=19)))
    sys.exit(0)

deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    event('heartbeat')
    time.sleep(.02)
if child:
    child.terminate()
