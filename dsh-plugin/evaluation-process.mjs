import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function procStat(raw) {
  // The command name can itself contain spaces and parentheses.
  const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
  return { state: fields[0], group: Number(fields[2]), session: Number(fields[3]), start: fields[19] };
}

async function processStat(pid) {
  try { return procStat(await readFile(`/proc/${pid}/stat`, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}

async function activeMembers(group, leaderStart) {
  // A detached child owns this group/session. Never authorize a signal by cwd.
  if (!Number.isSafeInteger(group) || group <= 1 || group === process.pid) {
    throw new Error('invalid evaluation process group');
  }
  try { process.kill(-group, 0); }
  catch (error) { if (error.code === 'ESRCH') return []; throw error; }
  const leader = await processStat(group);
  if (leader && leaderStart && leader.start !== leaderStart) {
    throw new Error('evaluation process identity changed');
  }
  const members = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const info = await processStat(entry);
    if (!info || info.group !== group) continue;
    if (info.session !== group) throw new Error('evaluation process group ownership is uncertain');
    // Orphan zombies can remain until init reaps them; they execute no code.
    if (!['Z', 'X', 'x'].includes(info.state)) members.push(Number(entry));
  }
  return members;
}

async function stopGroup(group, leaderStart, exited, options) {
  if (!group) return;
  const signal = async name => {
    if ((await activeMembers(group, leaderStart)).length === 0) return;
    try { process.kill(-group, name); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const stopped = async () => exited() && (await activeMembers(group, leaderStart)).length === 0;
  if (await stopped()) return;
  await signal('SIGTERM');
  let deadline = Date.now() + options.graceMs;
  while (Date.now() < deadline) {
    if (await stopped()) return;
    await delay(options.pollMs);
  }
  // The direct child may already have exited; its descendants still need KILL.
  await signal('SIGKILL');
  deadline = Date.now() + options.killWaitMs;
  while (Date.now() < deadline) {
    if (await stopped()) return;
    await delay(options.pollMs);
  }
  if (!await stopped()) throw new Error('evaluation process group did not stop before cleanup deadline');
}

/** Run one evaluator. Ordinary descendants must stay in the owned Linux group. */
export async function runEvaluation(command, args, options = {}) {
  if (process.platform !== 'linux') {
    throw Object.assign(new Error('managed evaluation execution requires Linux process groups and /proc'), {
      code: 'ALEPH_EVALUATION_UNSUPPORTED_PLATFORM', evaluationStopped: true,
    });
  }
  const timeout = options.timeout ?? 600_000;
  const maxBuffer = options.maxBuffer ?? 32 * 1024 * 1024;
  const stopOptions = { graceMs: options.graceMs ?? 500, killWaitMs: options.killWaitMs ?? 2000, pollMs: 20 };
  let child;
  try {
    child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...(options.env ?? {}) },
      detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    error.evaluationStopped = true;
    throw error;
  }
  let didExit = false;
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const closed = new Promise(resolve => child.once('close', resolve));
  let failure = null;
  let exitCode = null;
  let exitSignal = null;
  const output = { stdout: [], stderr: [] };
  const sizes = { stdout: 0, stderr: 0 };
  for (const name of ['stdout', 'stderr']) {
    child[name].on('data', chunk => {
      const remaining = Math.max(0, maxBuffer - sizes[name]);
      if (remaining) output[name].push(chunk.subarray(0, remaining));
      sizes[name] += chunk.length;
      if (sizes[name] > maxBuffer && !failure) {
        failure = Object.assign(new Error(`${name} maxBuffer length exceeded`), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
        finish();
      }
    });
  }
  child.once('error', error => { failure ??= error; didExit = true; finish(); });
  child.once('exit', (code, signal) => { didExit = true; exitCode = code; exitSignal = signal; finish(); });
  const timer = setTimeout(() => {
    failure ??= Object.assign(new Error(`Evaluation timed out after ${timeout}ms: ${command} ${args.join(' ')}`), {
      code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM',
    });
    finish();
  }, timeout);
  // Capture identity while the owned direct process is still alive, if possible.
  let leaderStart;
  let cleanupError;
  try {
    leaderStart = child.pid ? (await processStat(child.pid))?.start : undefined;
    await finished;
    clearTimeout(timer);
    await stopGroup(child.pid, leaderStart, () => didExit, stopOptions);
    // Drain buffered final output after exit without hanging on an escaped pipe.
    await Promise.race([closed, delay(100)]);
  } catch (error) { cleanupError = error; }
  finally {
    clearTimeout(timer);
    // Do not wait on descriptors inherited by an unsupported setsid escape.
    child.stdout.destroy();
    child.stderr.destroy();
  }
  const result = { stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') };
  if (!failure && (exitCode !== 0 || exitSignal)) {
    failure = Object.assign(new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr}`), {
      code: exitCode, signal: exitSignal, killed: Boolean(exitSignal),
    });
  }
  if (cleanupError) {
    throw Object.assign(new Error(`Evaluation processes could not be confirmed stopped: ${cleanupError.message}${failure ? `; original error: ${failure.message}` : ''}`, { cause: failure ?? cleanupError }), {
      code: 'ALEPH_EVALUATION_CLEANUP', evaluationStopped: false, ...result,
      // The owning service blocks retries until this exact group can be confirmed stopped.
      retryCleanup: () => stopGroup(child.pid, leaderStart, () => didExit, stopOptions),
    });
  }
  if (failure) throw Object.assign(failure, result, { evaluationStopped: true });
  return result;
}
