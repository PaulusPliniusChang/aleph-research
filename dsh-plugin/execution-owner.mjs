import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

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
    throw new Error('invalid execution process group');
  }
  try { process.kill(-group, 0); }
  catch (error) { if (error.code === 'ESRCH') return []; throw error; }
  const leader = await processStat(group);
  if (leader && leaderStart && leader.start !== leaderStart) {
    throw new Error('execution process identity changed');
  }
  const members = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const info = await processStat(entry);
    if (!info || info.group !== group) continue;
    if (info.session !== group) throw new Error('execution process group ownership is uncertain');
    // Orphan zombies can remain until init reaps them; they execute no code.
    if (!['Z', 'X', 'x'].includes(info.state)) members.push(Number(entry));
  }
  return members;
}

export async function stopGroup(group, leaderStart, exited, options) {
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
  if (!await stopped()) throw new Error('execution process group did not stop before cleanup deadline');
}

/** Run one batch command. Ordinary descendants must stay in the owned Linux group. */
export async function runOwnedCommand(command, args, options = {}) {
  if (process.platform !== 'linux') {
    throw Object.assign(new Error('managed execution requires Linux process groups and /proc'), {
      code: 'ALEPH_EXECUTION_UNSUPPORTED_PLATFORM', executionStopped: true,
    });
  }
  if (!options.receiptPath || !options.executionId) throw new Error('execution receipt path and identity are required');
  if (options.signal?.aborted) throw Object.assign(new Error('execution cancelled before startup'), { code: 'ALEPH_CANCELLED', executionStopped: true });
  await mkdir(dirname(options.receiptPath), { recursive: true });
  const timeout = options.timeout ?? 300_000;
  const maxBuffer = options.maxBuffer ?? 32 * 1024 * 1024;
  const stopOptions = { graceMs: options.graceMs ?? 500, killWaitMs: options.killWaitMs ?? 2000, pollMs: 20 };
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL('./execution-launcher.mjs', import.meta.url)), options.receiptPath, options.executionId, command, ...args], { cwd: options.cwd, env: { ...process.env, ...(options.env ?? {}) },
      detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    error.executionStopped = true;
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
    failure ??= Object.assign(new Error(`Execution timed out after ${timeout}ms: ${command} ${args.join(' ')}`), {
      code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM',
    });
    finish();
  }, timeout);
  const cancelled = () => {
    failure ??= Object.assign(new Error('execution cancelled by operator'), { code: 'ALEPH_CANCELLED' });
    finish();
  };
  options.signal?.addEventListener('abort', cancelled, { once: true });
  if (options.signal?.aborted) cancelled();
  // The launcher writes identity before any user computation and waits for go.
  let leaderStart;
  let cleanupError;
  try {
    leaderStart = child.pid ? (await processStat(child.pid))?.start : undefined;
    while (!didExit && !failure) {
      let receipt;
      try { receipt = JSON.parse(await readFile(options.receiptPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (receipt) {
        if (receipt.pid !== child.pid || receipt.start !== leaderStart || receipt.executionId !== options.executionId) throw new Error('execution launch receipt identity mismatch');
        await writeFile(options.receiptPath + '.go', 'go', { flag: 'wx' });
        break;
      }
      await delay(10);
    }
    await finished;
    clearTimeout(timer);
    await stopGroup(child.pid, leaderStart, () => didExit, stopOptions);
    // Drain buffered final output after exit without hanging on an escaped pipe.
    await Promise.race([closed, delay(100)]);
  } catch (error) {
    failure ??= error;
    try { await stopGroup(child.pid, leaderStart, () => didExit, stopOptions); }
    catch (stopError) { cleanupError = stopError; }
  }
  finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancelled);
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
    throw Object.assign(new Error(`Execution processes could not be confirmed stopped: ${cleanupError.message}${failure ? `; original error: ${failure.message}` : ''}`, { cause: failure ?? cleanupError }), {
      code: 'ALEPH_EXECUTION_CLEANUP', executionStopped: false, ...result,
      // The owning service blocks retries until this exact group can be confirmed stopped.
      retryCleanup: () => stopGroup(child.pid, leaderStart, () => didExit, stopOptions),
    });
  }
  if (failure) throw Object.assign(failure, result, { executionStopped: true });
  return result;
}

/** Observe an owned command after restart without signalling or writing fences. */
export async function observeRecordedExecution(receiptPath, executionId) {
  let record;
  try { record = JSON.parse(await readFile(receiptPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await readFile(receiptPath + '.go'); }
    catch (goError) {
      // A delayed launcher still needs the departed Host's admission. It cannot
      // start user computation merely by publishing its receipt afterwards.
      if (goError.code === 'ENOENT') return { active: false, neverAdmitted: true };
      throw goError;
    }
    throw new Error('execution go fence exists without ownership receipt');
  }
  if (!executionId || record.executionId !== executionId) throw new Error('execution receipt belongs to another execution');
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (record.boot !== boot) return { active: false, previousBoot: true };
  if (record.pid !== record.group || record.session !== record.group || !record.start) throw new Error('invalid execution ownership receipt');
  const info = await processStat(record.pid);
  if (info && info.start !== record.start) throw new Error('execution process identity changed after restart');
  return { active: (await activeMembers(record.group, record.start)).length > 0 };
}

/** Stop only a durable, identity-verified group after explicit cancellation. */
export async function stopRecordedExecution(receiptPath, executionId) {
  // A stop fence survives a missing receipt and also blocks a delayed launcher.
  // A go file without its receipt is inconsistent and cannot authorize cleanup.
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath + '.stop', 'stop');
  let record;
  try { record = JSON.parse(await readFile(receiptPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await readFile(receiptPath + '.go'); }
    catch (goError) {
      if (goError.code === 'ENOENT') return { stopped: true, neverAdmitted: true };
      throw goError;
    }
    throw new Error('execution go fence exists without ownership receipt');
  }
  if (!executionId || record.executionId !== executionId) throw new Error('execution receipt belongs to another execution');
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  if (record.boot !== boot) return { stopped: true, previousBoot: true };
  if (record.pid !== record.group || record.session !== record.group || !record.start) throw new Error('invalid execution ownership receipt');
  const info = await processStat(record.pid);
  if (info && info.start !== record.start) throw new Error('execution process identity changed after restart');
  await stopGroup(record.group, record.start, () => true, { graceMs: 500, killWaitMs: 2000, pollMs: 20 });
  return { stopped: true };
}
