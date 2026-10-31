const stubs = new Map([
  ['@deepseek-ai/dsh-storage-domain', new URL('./stubs/storage-domain.mjs', import.meta.url).href],
  ['@deepseek-ai/dsh-tools', new URL('./stubs/dsh-tools.mjs', import.meta.url).href],
]);

export async function resolve(specifier, context, nextResolve) {
  if (stubs.has(specifier)) return { url: stubs.get(specifier), shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  // Only the explicitly tagged integration-test import shortens this deadline.
  if (url.endsWith('/index-v2.js?evaluation-deadline-test')) {
    const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
    const before = "runEvaluation('bash', ['-lc', project.evalCommand], { cwd: project.evalRoot || project.workspace, env, timeout: 600_000 })";
    const after = before.replace('600_000', '500');
    // Node can compose this hook more than once for a test child.
    if (original.includes(before) && original.split(before).length !== 2) throw new Error('evaluation deadline test adapter did not match exactly once');
    if (!original.includes(before) && original.split(after).length !== 2) throw new Error('evaluation deadline test adapter did not match exactly once');
    return { ...loaded, source: original.replace(before, after).replace("'./evaluation-process.mjs'", "'./evaluation-process.mjs?evaluation-observation-test'") };
  }
  if (url.endsWith('/evaluation-process.mjs?evaluation-observation-test')) {
    const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
    const before = "await readdir('/proc')";
    const after = "await (globalThis.__alephEvaluationProcFault ? Promise.reject(Object.assign(new Error('injected proc observation denial'), { code: 'EACCES' })) : readdir('/proc'))";
    if (!original.includes(before) && original.split(after).length === 2) return loaded;
    if (original.split(before).length !== 2) throw new Error('evaluation observation test adapter did not match exactly once');
    return { ...loaded, source: original.replace(before, after) };
  }
  return loaded;
}
