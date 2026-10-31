import { spawn } from 'node:child_process';
import { readFile, rename, writeFile, access } from 'node:fs/promises';

const [receiptPath, executionId, command, ...args] = process.argv.slice(2);
const raw = await readFile('/proc/self/stat', 'utf8');
const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
const record = { executionId, pid: process.pid, group: Number(fields[2]), session: Number(fields[3]),
  start: fields[19], boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
const pending = receiptPath + '.pending';
await writeFile(pending, JSON.stringify(record), { flag: 'wx' });
await rename(pending, receiptPath);
const parentPid = process.ppid;
const deadline = Date.now() + 5000;
let allowed = false;
while (Date.now() < deadline && process.ppid === parentPid && parentPid !== 1) {
  try { await access(receiptPath + '.stop'); process.exit(125); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await access(receiptPath + '.go'); allowed = true; break; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await new Promise(resolve => setTimeout(resolve, 10));
}
if (!allowed) process.exit(125);
try { await access(receiptPath + '.stop'); process.exit(125); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const child = spawn(command, args, { stdio: 'inherit' });
child.once('error', error => { console.error(error.message); process.exitCode = error.code === 'ENOENT' ? 127 : 1; });
child.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
