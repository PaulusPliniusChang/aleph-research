#!/usr/bin/env python3
"""Real evaluator and ordinary descendant processes; all records stay outside solution worktree."""
import json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(sys.argv[1]); mode=sys.argv[2]; role=sys.argv[3] if len(sys.argv)>3 else 'entry'
solution=pathlib.Path(os.environ['ALEPH_SOLUTION_DIR'])
def snapshot():
    raw=pathlib.Path('/proc/self/stat').read_text(); fields=raw[raw.rfind(')')+2:].split()
    return dict(pid=os.getpid(),ppid=os.getppid(),pgid=os.getpgid(0),sid=os.getsid(0),start=fields[19],role=role,cwd=os.getcwd(),solution=str(solution),at=time.time_ns(),solutionExists=solution.exists(),inputExists=(solution/'algorithm.txt').exists())
def event(kind,**values):
    with (root/(role+'-events.jsonl')).open('a') as f:f.write(json.dumps(dict(kind=kind,at=time.time_ns(),pid=os.getpid(),**values))+'\n')
def terminate(sig,frame):
    event('signal',signal=sig);sys.exit(128+sig)
signal.signal(signal.SIGTERM,terminate)
(root/(role+'-ready.json')).write_text(json.dumps(snapshot()))
if role=='entry':
    if mode=='success':print(json.dumps({'score':7,'solution':str(solution)}));sys.exit(0)
    if mode=='nonzero':print('controlled evaluation failure',file=sys.stderr);sys.exit(3)
    child=subprocess.Popen([sys.executable,__file__,str(root),mode,'worker'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    event('spawn',child=child.pid);child.wait()
elif role=='worker':
    child=subprocess.Popen([sys.executable,__file__,str(root),mode,'grandchild'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    event('spawn',child=child.pid)
    end=time.monotonic()+20
    while time.monotonic()<end:
        event('heartbeat',solutionExists=solution.exists(),inputExists=(solution/'algorithm.txt').exists());time.sleep(.05)
    child.terminate();child.wait(timeout=2)
else:
    end=time.monotonic()+20
    while time.monotonic()<end:
        event('heartbeat',solutionExists=solution.exists(),inputExists=(solution/'algorithm.txt').exists());time.sleep(.05)
