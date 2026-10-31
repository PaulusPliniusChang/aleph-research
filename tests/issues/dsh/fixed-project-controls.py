#!/usr/bin/env python3
"""Independent actual DSH acceptance for project controls and Infra preparation exclusion."""
import argparse,importlib.util,json,os,shutil,socket,subprocess,sys,time,urllib.request
from pathlib import Path
import yaml
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
s=importlib.util.spec_from_file_location('launcher',Path(__file__).with_name('launch-project.py'));launcher=importlib.util.module_from_spec(s);s.loader.exec_module(launcher)
runtime=Path('/opt/dsh-desktop-linux-bin/resources/app/dsh');root,workspace,environment=launcher.prepare(a.source.resolve(),runtime)
bridge=root/'bridge';shutil.copyfile(Path(__file__).with_name('diagnostic-bridge.mjs'),bridge/'diagnostic-bridge.mjs');shutil.copyfile(Path(__file__).with_name('controls-deterministic-bridge.mjs'),bridge/'index.mjs');(bridge/'node_modules').symlink_to(runtime/'node_modules',target_is_directory=True)
# Installed DSH requires an explicit subagent transport in the Composer preset.
# This isolated runtime setting enables the unchanged Composer source to mount.
# Model routing remains the single global default inherited by actual children.
plugin_patch=root/'plugin/cordis.patch.yml';patch=yaml.safe_load(plugin_patch.read_text());configured=[]
for op in patch:
 for row in op.get('insert',[]):
  if row.get('name')=='@deepseek-ai/dsh-agent-preset':
   for plugin in row['config']['plugins']:
    if plugin.get('name')=='@deepseek-ai/dsh-tool-subagent':
     plugin.setdefault('config',{})['provider']='spawn';configured.append(row['config']['id'])
plugin_patch.write_text(yaml.safe_dump(patch,sort_keys=False,allow_unicode=True))
p=root/'home/profiles/reproduction/cordis.patch.yml';p.write_text(p.read_text()+'- id: agent-default-model\n  config:\n    provider: aleph-test\n    model: deterministic\n- id: session-title-llm\n  disabled: true\n')
gate=root/'git-gate';gate.mkdir();b=root/'bin';b.mkdir();(b/'git').symlink_to(Path(__file__).with_name('infra-preparation-git-scheduler.py').resolve())
with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
url=f'http://127.0.0.1:{port}';out=root/'probe.json';cfg=root/'config.json';cfg.write_text(json.dumps({'source':str(a.source.resolve()),'root':str(root),'workspace':str(workspace),'url':url,'output':str(out)}))
e=dict(os.environ,DSH_HOME=str(root/'home'),PATH=str(b)+':'+os.environ['PATH'],ALEPH_INFRA_PREPARATION_GATE=str(gate),ALEPH_FIXED_CONTROLS_CONFIG=str(cfg))
environment['dirty']=subprocess.check_output(['git','-C',str(a.source),'status','--porcelain','--untracked-files=all'],text=True)
r={'environment':environment,'url':url,'command':[sys.executable,*sys.argv],'configured_subagent_transport_presets':configured,'boundary':'Original product copied into isolated installed DSH; global default model uses the local deterministic adapter; Composer tool-subagent transport is explicitly spawn to match this installed DSH required configuration. Real activations, model Bash/Host tool calls, activation receipt disposal, Git, persistent storage and Python compute. Exact first Infra worktree-add response scheduled after real Git success. No product JavaScript source or deadline edits; isolated preset configuration adaptation disclosed.','events':[]}
a.output.parent.mkdir(parents=True,exist_ok=True);log=(root/'dsh.log').open('w');proc=None
command=['node',str(runtime/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','reproduction','--no-open','--host','127.0.0.1','--port',str(port)]
def ready(path):
 for _ in range(150):
  if proc.poll() is not None:raise RuntimeError('Host exited; '+str(root/'dsh.log'))
  try:
   with urllib.request.urlopen(url+path,timeout=1) as response:return json.load(response)
  except OSError:time.sleep(.1)
 raise TimeoutError('Host ready')
try:
 proc=subprocess.Popen(command,cwd=workspace,env=e,stdout=log,stderr=subprocess.STDOUT);health=ready('/api/aleph/health');r['events'].append({'name':'host-ready','health':health});print(json.dumps({'phase':'host-ready','root':str(root),'url':url}),flush=True)
 result=subprocess.run(['node','--test',str(Path(__file__).with_name('fixed-project-controls.test.mjs'))],env=e)
 if out.exists():r['probe']=json.loads(out.read_text())
 r['probe_exit']=result.returncode
 if result.returncode:raise RuntimeError('Actual controls acceptance did not complete; original report retained')
 before=ready('/api/aleph/projects')['projects'];r['before_restart']=before
 proc.terminate();proc.wait(timeout=8);r['events'].append({'name':'host-stopped-for-restart','pid':proc.pid,'pid_exists':Path('/proc/'+str(proc.pid)).exists()})
 proc=subprocess.Popen(command,cwd=workspace,env=e,stdout=log,stderr=subprocess.STDOUT);after=ready('/api/aleph/projects')['projects'];r['after_restart']=after;r['restart_checks']=[]
 for old in before:
  new=next(x for x in after if x['project']['id']==old['project']['id'])
  for label,ok in [('terminal project status persists',new['project']['status']==old['project']['status']),('mission terminal states persist',[(x['id'],x['status'],x['result_commit']) for x in new['missions']]==[(x['id'],x['status'],x['result_commit']) for x in old['missions']]),('machine state and exact batch ownership persist',new['machines']==old['machines'])]:
   r['restart_checks'].append({'project':new['project']['id'],'name':label,'passed':ok});assert ok,label
finally:
 if proc is not None:
  proc.terminate()
  try:proc.wait(timeout=8)
  except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
  r['events'].append({'name':'isolated-host-stopped','pid':proc.pid,'exit':proc.poll(),'pid_exists':Path('/proc/'+str(proc.pid)).exists()})
 log.close();a.output.write_text(json.dumps(r,indent=2))
