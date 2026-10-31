import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const { snapshot } = await import(pathToFileURL(join(source, 'dsh-plugin/index-v2.js')));
let api;
const createElement = (type, props, ...children) => ({ type, props, children: children.flat(Infinity) });
const client = readFileSync(join(source, 'dsh-plugin/client.js'), 'utf8');
// Expose existing closed-over render functions only inside this isolated VM.
const sandbox = { window: { __ModuleLoader__: { load(def) {
  def.factory(name => { if (name !== 'react') throw new Error(name); return { createElement }; });
} } } };
vm.runInNewContext(client.replace('    return {\n      name:', '    window.testApi = { consoleBody, agentSection, dict };\n    return {\n      name:'), sandbox);
api = sandbox.window.testApi;
assert.ok(api, 'fixture exposes existing render functions');
const t = key => api.dict.en[key] ?? key;
const text = node => node == null || node === false ? '' : typeof node === 'object' ? node.children.map(text).join('\n') : String(node);
const leaves = node => node == null || node === false ? [] : typeof node === 'object' ? node.children.flatMap(leaves) : [String(node)];
const section = tree => {
  if (tree?.type === 'section' && tree.children.some(n => n?.type === 'h2' && text(n) === t('section.agents'))) return tree;
  for (const child of tree?.children ?? []) { if (child && typeof child === 'object') { const found = section(child); if (found) return found; } }
};
const project = agents => ({ id: 'project-visible-01', workspace: '/real/workspace', researchRoot: '/real/workspace/research', missionRoot: '/real/workspace/missions', templateBranch: 'template', evalCommand: 'python eval.py', agents, missions: [], batches: [], machines: [{ id: 'machine-visible-01', status: 'idle', kind: 'local', batchId: null }] });
const record = (role, status, id = role) => ({ role, status, childId: 'child-' + id, branch: 'research/' + id, updatedAt: '2026-10-31T01:02:03Z', summary: 'Independent summary ' + id });
const render = p => { const data = snapshot(p); const tree = api.consoleBody(t, data); return { data, body: text(tree), agents: text(section(tree)), agentLeaves: leaves(section(tree)) }; };

test('ALEPH-16 actual snapshot projection reaches existing console agent render', async testContext => {
  const observations = [];
  const point = async (name, fn) => testContext.test(name, fn);
  for (const [role, status] of [['researcher', 'running'], ['composer', 'done'], ['infra', 'failed']]) {
    const agent = record(role, status); const result = render(project([agent])); observations.push({ scope: role, agent, ...result });
    await point(role + ': backend snapshot retains independent full record', () => assert.deepEqual(result.data.agents, [agent]));
    await point(role + ': project metadata does not contain duplicate agent list', () => assert.equal(result.data.project.agents, undefined));
    await point(role + ': console shows actual role', () => assert.ok(result.agentLeaves.includes(t('role.' + role))));
    await point(role + ': console shows actual state', () => assert.ok(result.agents.includes(t('status.' + status))));
    await point(role + ': console shows actual child session', () => assert.ok(result.agents.includes(agent.childId)));
    await point(role + ': console shows research branch', () => assert.ok(result.agents.includes(agent.branch)));
    await point(role + ': console shows independent summary', () => assert.ok(result.agents.includes(agent.summary)));
    await point(role + ': nonempty records suppress empty-list guidance', () => assert.ok(!result.agents.includes(t('empty.agents'))));
  }
  const empty = render(project([]));
  await point('empty control: empty list displays agent guidance', () => assert.ok(empty.agents.includes(t('empty.agents'))));
  await point('empty control: project identity remains displayed', () => assert.ok(empty.body.includes('project-visible-01')));
  await point('empty control: machine identity remains displayed', () => assert.ok(empty.body.includes('machine-visible-01')));
  await point('empty control: evaluator remains displayed', () => assert.ok(empty.body.includes('python eval.py')));
  const missing = project(undefined); delete missing.agents;
  await point('missing optional records: snapshot supplies empty array', () => assert.deepEqual(snapshot(missing).agents, []));
  await point('missing optional records: console renders guidance without crash', () => assert.ok(render(missing).agents.includes(t('empty.agents'))));
  const agents = [record('researcher', 'running', 'first'), record('infra', 'done', 'second')];
  const multiple = render(project(agents)); observations.push({ scope: 'multiple', ...multiple });
  await point('independent records: first session is displayed', () => assert.ok(multiple.agents.includes('child-first')));
  await point('independent records: second session is displayed', () => assert.ok(multiple.agents.includes('child-second')));
  await point('independent records: both distinct summaries remain available', () => assert.ok(agents.every(a => multiple.agents.includes(a.summary))));
  const current = record('infra', 'running', 'transition');
  const running = render(project([current])); const done = render(project([{ ...current, status: 'done', summary: 'Final transition summary' }]));
  await point('subsequent snapshot: running record is visible before finish', () => assert.ok(running.agents.includes('child-transition')));
  await point('subsequent snapshot: final summary becomes visible', () => assert.ok(done.agents.includes('Final transition summary')));
  await point('subsequent snapshot: transition never reports empty list', () => assert.ok(!running.agents.includes(t('empty.agents')) && !done.agents.includes(t('empty.agents'))));
  // Direct table controls distinguish field-routing errors from a broken table.
  const direct = a => text(api.agentSection(t, { agents: a }));
  await point('table control: actual child identity renders when supplied correctly', () => assert.ok(direct([current]).includes(current.childId)));
  await point('table control: long summary is visibly truncated', () => assert.ok(direct([{ ...current, summary: 'x'.repeat(300) }]).includes('x'.repeat(240) + '…')));
  await point('table control: absent summary displays placeholder', () => assert.ok(direct([{ ...current, summary: null }]).includes('—')));
  const many = Array.from({ length: 9 }, (_, i) => record('researcher', 'done', 'history-' + i));
  await point('table control: oldest ninth record is omitted by existing display limit', () => assert.ok(!direct(many).includes('child-history-0')));
  await point('table control: most recent record remains visible', () => assert.ok(direct(many).includes('child-history-8')));
  if (process.env.ALEPH_CONSOLE_AGENT_OBSERVATIONS) writeFileSync(process.env.ALEPH_CONSOLE_AGENT_OBSERVATIONS, JSON.stringify({
    source, source_sha: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    boundary: 'Actual backend snapshot serializer and complete existing consoleBody/agentSection evaluated inside VM. React createElement replaced by a structural virtual-tree collector; project/agent states are explicit fixtures, no browser or DSH is claimed. Actual rendered DSH verification is separate.', observations,
  }, null, 2));
});
