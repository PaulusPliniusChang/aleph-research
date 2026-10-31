#!/usr/bin/python3
"""Delay the first real infra worktree-add response after successful Git execution."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

args = sys.argv[1:]
gate = Path(os.environ['ALEPH_INFRA_PREPARATION_GATE'])
config = json.loads((gate / 'armed.json').read_text()) if (gate / 'armed.json').exists() else None
matching = config and args == ['-C', config['repo'], 'worktree', 'add', '--detach', config['worktree'], config['branch']]
ordinal = None
if matching:
    with (gate / 'counter').open('a+') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.seek(0)
        ordinal = int(stream.read() or '0') + 1
        stream.seek(0)
        stream.truncate()
        stream.write(str(ordinal))
        stream.flush()
result = subprocess.run(['/usr/bin/git', *args], capture_output=True)
if matching:
    record = {'args': args, 'ordinal': ordinal, 'returncode': result.returncode,
              'stdout': result.stdout.decode(errors='replace'), 'stderr': result.stderr.decode(errors='replace'),
              'git_completed_at': time.time()}
    (gate / f'worktree-add-{ordinal}.json').write_text(json.dumps(record))
    if ordinal == 1 and result.returncode == 0:
        deadline = time.monotonic() + 25
        while not (gate / 'release-first').exists():
            if time.monotonic() > deadline:
                raise TimeoutError('infra preparation scheduling gate was not released')
            time.sleep(.01)
        record['response_released_at'] = time.time()
        (gate / f'worktree-add-{ordinal}.json').write_text(json.dumps(record))
sys.stdout.buffer.write(result.stdout)
sys.stderr.buffer.write(result.stderr)
raise SystemExit(result.returncode)
