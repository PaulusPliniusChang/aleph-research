#!/usr/bin/env python3
"""Create and launch a real bundled DSH profile with an isolated state directory."""
import json, os, pathlib, shutil, subprocess, tempfile
repo = pathlib.Path(__file__).resolve().parents[3]
runtime = pathlib.Path(os.environ.get('ALEPH_DSH_RUNTIME', '/opt/dsh-desktop-linux-bin/resources/app/dsh'))
root = pathlib.Path(tempfile.mkdtemp(prefix='aleph-dsh-reproduction-'))
profile = root/'home/profiles/reproduction'
profile.mkdir(parents=True)
plugin = root/'plugin'
shutil.copytree(repo/'dsh-plugin', plugin, ignore=shutil.ignore_patterns('node_modules'))
(plugin/'node_modules').mkdir()
(plugin/'node_modules/@deepseek-ai').symlink_to(runtime/'node_modules/@deepseek-ai', target_is_directory=True)
(plugin/'node_modules/zod').symlink_to(runtime/'node_modules/zod', target_is_directory=True)
bridge = root/'bridge'
bridge.mkdir()
shutil.copyfile(pathlib.Path(__file__).with_name('diagnostic-bridge.mjs'), bridge/'index.mjs')
(bridge/'package.json').write_text(json.dumps({'name':'@local/aleph-test-bridge','type':'module','exports':'./index.mjs'}))
(profile/'package.json').write_text(json.dumps({'name':'dsh-profile-reproduction','private':True,'dependencies':{'@local/dsh-aleph-research':'link:'+str(plugin),'@local/aleph-test-bridge':'link:'+str(bridge)},'dsh':{'profile':{'bundles':['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@local/dsh-aleph-research']}}}))
(profile/'cordis.yml').write_text('[]\n')
(profile/'cordis.patch.yml').write_text("- insert:\n    - id: aleph-test-bridge\n      name: '@local/aleph-test-bridge'\n")
local = profile/'node_modules/@local'
local.mkdir(parents=True)
(local/'dsh-aleph-research').symlink_to(plugin, target_is_directory=True)
(local/'aleph-test-bridge').symlink_to(bridge, target_is_directory=True)
credential = pathlib.Path.home()/'.dsh/.credentials.yaml'
if credential.exists():
    shutil.copyfile(credential,root/'home/.credentials.yaml')
    (root/'home/.credentials.yaml').chmod(0o600)
workspace = root/'workspace'
workspace.mkdir()
(root/'environment.json').write_text(json.dumps({'root':str(root),'workspace':str(workspace),'runtime':str(runtime)}))
print(json.dumps({'root':str(root),'workspace':str(workspace)}),flush=True)
env = dict(os.environ,DSH_HOME=str(root/'home'),ALEPH_MAX_PARALLEL='1')
if os.environ.get('ALEPH_DSH_CONTROL_GIT') == '1':
    bindir = root/'bin'
    bindir.mkdir()
    shutil.copyfile(pathlib.Path(__file__).with_name('git'), bindir/'git')
    (bindir/'git').chmod(0o755)
    env['PATH'] = str(bindir)+os.pathsep+env['PATH']
    env['ALEPH_DSH_GIT_GATE'] = str(root/'gate')
subprocess.run(['node',str(runtime/'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','reproduction','--no-open','--host','127.0.0.1','--port','0'],cwd=workspace,env=env,check=True)
