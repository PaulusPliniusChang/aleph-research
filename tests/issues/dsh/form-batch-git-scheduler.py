#!/usr/bin/python3
"""Run actual Git; delay only the second formBatch template-tip read."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time

control_path = os.environ.get('ALEPH_FORM_GIT_CONTROL')
control = Path(control_path) if control_path else None
args = sys.argv[1:]
record = {'pid': os.getpid(), 'args': args, 'entered': time.monotonic()}
if control is not None and (control / 'armed.json').exists():
    config = json.loads((control / 'armed.json').read_text())
    if args == ['-C', config['repo'], 'rev-parse', 'template']:
        with (control / 'counter').open('a+') as counter:
            fcntl.flock(counter, fcntl.LOCK_EX)
            counter.seek(0)
            ordinal = int(counter.read() or '0') + 1
            counter.seek(0)
            counter.truncate()
            counter.write(str(ordinal))
            counter.flush()
        record['ordinal'] = ordinal
        (control / ('entered-' + str(ordinal) + '.json')).write_text(json.dumps(record))
        if ordinal == 2:
            deadline = time.monotonic() + 30
            while not (control / 'release-second').exists():
                if time.monotonic() > deadline:
                    raise TimeoutError('test scheduling controller did not release second request')
                time.sleep(.01)
            record['released'] = time.monotonic()
result = subprocess.run(['/usr/bin/git', *args], capture_output=True)
record.update({'completed': time.monotonic(), 'returncode': result.returncode,
    'stdout': result.stdout.decode(errors='replace'), 'stderr': result.stderr.decode(errors='replace')})
if control is not None:
    (control / ('git-' + str(os.getpid()) + '.json')).write_text(json.dumps(record))
sys.stdout.buffer.write(result.stdout)
sys.stderr.buffer.write(result.stderr)
raise SystemExit(result.returncode)
