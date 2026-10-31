#!/usr/bin/env python3
"""Exercise actual DSH; no replacement services or researcher completion mocks."""
import argparse, json, pathlib, subprocess, time, urllib.request
parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--root', type=pathlib.Path, required=True)
parser.add_argument('--scenario', choices=['concurrency','race','continuation','restart-prepare','restart-observe','inspect'], required=True)
args = parser.parse_args()
root = args.root.resolve()
records = []
output = root / ('exercise-' + args.scenario + '.json')
def record(label, value):
    records.append({'label':label, 'value':value})
    output.write_text(json.dumps(records, indent=2))
    return value

def bridge(body):
    request = urllib.request.Request(args.url.rstrip('/')+'/api/aleph-test/bridge', data=json.dumps(body).encode(), headers={'Content-Type':'application/json','Origin':args.url.rstrip('/')})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    if result.get('ok') is not True: raise RuntimeError(result)
    record('bridge', {'request':body, 'response':result})
    return result['result']

def snapshots():
    with urllib.request.urlopen(args.url.rstrip('/')+'/api/aleph/campaigns', timeout=30) as response:
        return json.load(response)['campaigns']

if args.scenario == 'restart-observe':
    identity=json.loads((root/'restart-exercise-identity.json').read_text())
    snap=next(s for s in snapshots() if s['campaign']['id']==identity['campaignId'])
    live=bridge({'action':'live-agents','sessionId':identity['childId']})
    record('post-restart-snapshot',snap)
    record('child-live',live)
    assert snap['counts']['running']==1 and live['live'] is False
    print('Reproduced: task remains running while researcher is absent.')
    raise SystemExit(0)

workspace = root/('exercise-workspace-'+args.scenario+'-'+str(time.time_ns()))
workspace.mkdir()
parent=bridge({'action':'parent','cwd':str(workspace)})
session=parent['sessionId']
def tool(name, **kwargs):
    return bridge({'action':'tool','sessionId':session,'name':name,'args':kwargs})

evaluator = "printf '{\"score\":30,\"rows\":1000,\"diagnostic\":\"real-dsh-detail\"}\\n'"
if args.scenario=='race':
    evaluator="python3 -c 'import json,os,pathlib;print(json.dumps({\"score\":int((pathlib.Path(os.environ[\"ALEPH_SOLUTION_DIR\"])/\"score.txt\").read_text())}))'"
campaign=tool('aleph_start_campaign',title='Actual DSH '+args.scenario,eval_command=evaluator)
cid=campaign['id']
def status():
    return tool('aleph_status',campaign_id=cid)[0]
def wait_until(predicate, seconds=100):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        value=predicate()
        if value:return value
        time.sleep(.5)
    raise TimeoutError('Expected actual DSH event not observed')

if args.scenario=='concurrency':
    tool('aleph_compose_batch',campaign_id=cid,count=2,brief='Run bash sleep 30. Then write ALEPH_HANDOFF.md and finish. Keep running until sleep completes.')
    tool('aleph_run_next',campaign_id=cid)
    tool('aleph_run_next',campaign_id=cid)
    snap=status()
    assert snap['campaign']['max_parallel']==1 and snap['counts']['running']==2
    print('Reproduced: parallel limit 1, running researchers 2.')
elif args.scenario=='race':
    gate=root/'gate';gate.mkdir(exist_ok=True)
    for marker in ['low-blocked','release-low','high-written']:
        (gate/marker).unlink(missing_ok=True)
    for score in [10,20]:
        tool('aleph_enqueue_mission',campaign_id=cid,strategy='L0',description=f'Write score.txt containing exactly {score}. Write ALEPH_HANDOFF.md with a concise summary. Finish immediately. No experiments required.')
    tool('aleph_run_next',campaign_id=cid)
    wait_until(lambda:(gate/'low-blocked').exists())
    tool('aleph_run_next',campaign_id=cid)
    wait_until(lambda:(gate/'high-written').exists())
    (gate/'release-low').touch()
    wait_until(lambda:status()['counts']['done']==2)
    time.sleep(1)
    snap=status()
    actual=subprocess.check_output(['/usr/bin/git','-C',str(workspace/'research'),'show','sota/main:score.txt'],text=True).strip()
    record('actual-sota-score-file',actual)
    record('git-write-order',(gate/'events.log').read_text())
    assert snap['campaign']['sota_score']==20 and actual=='10'
    print('Reproduced: saved best score 20, actual branch code scores 10.')
elif args.scenario=='continuation':
    tool('aleph_compose_batch',campaign_id=cid,count=2,brief='Write result.txt containing verified and ALEPH_HANDOFF.md containing REAL_DSH_REPORT_DETAIL. Finish immediately; no experiments required.')
    tool('aleph_run_available',campaign_id=cid)
    wait_until(lambda:status()['counts']['done']==1)
    for _ in range(3):time.sleep(30)
    snap=status()
    assert snap['counts']=={'queued':1,'running':0,'done':1,'failed':0}
    record('actual-tool-definitions',bridge({'action':'tool-definitions','sessionId':session}))
    print('Reproduced: queue remains idle 90 seconds after task completion. Report fields and controls are recorded for review.')
elif args.scenario=='restart-prepare':
    tool('aleph_enqueue_mission',campaign_id=cid,description='Run bash sleep 120. Afterwards write ALEPH_HANDOFF.md and finish. Do not finish before sleep completes.')
    task=tool('aleph_run_next',campaign_id=cid)
    (root/'restart-exercise-identity.json').write_text(json.dumps(task))
    print('Task dispatched. Terminate and restart this isolated DSH with the same DSH_HOME, then run restart-observe.')
else:
    record('actual-tool-definitions',bridge({'action':'tool-definitions','sessionId':session}))
print('Evidence:',output)
