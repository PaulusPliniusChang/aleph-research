/** Test-only adapter: shorten only the existing Aleph evaluation execFile deadline. */
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {appendFileSync} from 'node:fs';
const original=cp.execFile;
function adapt(args) {
  if(args[0]==='bash' && Array.isArray(args[1]) && args[1][0]==='-lc' && args[2]?.timeout===600_000 && args[1][1].includes('aleph-timeout-probe.py')) {
    const changed=[...args]; changed[2]={...args[2], timeout:1200};
    if(process.env.ALEPH_TIMEOUT_ADAPTER_LOG) appendFileSync(process.env.ALEPH_TIMEOUT_ADAPTER_LOG, JSON.stringify({pid:process.pid,at:Date.now(),file:args[0],args:args[1],cwd:args[2].cwd,originalTimeout:600000,adaptedTimeout:1200})+'\n');
    return changed;
  }
  return args;
}
function adapted(...args) {return original(...adapt(args));}
adapted[promisify.custom]=(...args)=>original[promisify.custom](...adapt(args));
cp.execFile=adapted; syncBuiltinESMExports();
