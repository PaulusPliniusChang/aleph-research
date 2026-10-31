import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { snapshot } from '../index-v2.js';

// Execute the shipped client functions. Only React's element collector/hooks,
// fetch, and the interval clock are substituted; no browser or DSH is claimed.
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function client() {
  let state;
  let effect;
  let cleanup;
  let interval;
  let response;
  const requests = [];
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) };
    },
    useState(initial) {
      state ??= initial;
      return [state, value => { state = typeof value === 'function' ? value(state) : value; }];
    },
    useEffect(fn) { effect ??= fn; },
  };
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) {
      definition.factory(name => {
        assert.equal(name, 'react');
        return React;
      });
    } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (response instanceof Error) throw response;
      return { status: response.status, ok: response.status >= 200 && response.status < 300,
        json: async () => response.body };
    },
    setInterval(fn, delay) { interval = { fn, delay, cleared: false }; return 1; },
    clearInterval(id) { assert.equal(id, 1); interval.cleared = true; },
  };
  const marker = '    return {\n      name:';
  assert.ok(source.includes(marker), 'client factory boundary exists');
  vm.runInNewContext(source.replace(marker,
    '    window.renderTest = { consoleBody, ConsoleView, dict };\n' + marker), sandbox);
  const api = sandbox.window.renderTest;
  const t = key => api.dict.en[key] ?? key;
  return {
    api, t, requests,
    body: data => api.consoleBody(t, data),
    page: onClose => api.ConsoleView({ t, onClose }),
    async mount(value) {
      response = value;
      cleanup = effect();
      await new Promise(resolve => setImmediate(resolve));
    },
    async poll(value) {
      response = value;
      await interval.fn();
    },
    stop() { cleanup(); },
    get interval() { return interval; },
  };
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap(child => nodes(child, predicate))];
}
function text(tree) {
  if (tree == null || tree === false) return '';
  return typeof tree === 'object' ? tree.children.map(text).join('\n') : String(tree);
}
function agentTable(tree) {
  const [section] = nodes(tree, node => node.type === 'section'
    && node.children.some(child => child?.type === 'h2' && text(child) === 'Orchestration agents'));
  assert.ok(section, 'agent section exists in the full console');
  return section;
}
function record(role, status, id = role) {
  return { role, status, childId: `child-${id}`, branch: `research/${id}`,
    worktree: `/workspace/.aleph/researchers/${id}`, updatedAt: 'invalid-but-visible-date',
    summary: `Summary for ${id}` };
}
function project(agents = []) {
  return { id: 'project-render-test', workspace: '/workspace', researchRoot: '/workspace/research',
    missionRoot: '/workspace/missions', templateBranch: 'template-test', evalCommand: 'python evaluator.py',
    agents, missions: [], batches: [], machines: [{ id: 'machine-render-test', status: 'idle', batchId: null }] };
}
const ok = data => ({ status: 200, body: data });

test('top-level snapshot agents reach every existing table column', async context => {
  const render = client();
  const agents = [record('researcher', 'running'), record('composer', 'done'), record('infra', 'failed')];
  const publicSnapshot = snapshot(project(agents));
  const tree = render.body(publicSnapshot);
  const section = agentTable(tree);
  const content = text(section);
  const point = (name, fn) => context.test(name, fn);
  await point('snapshot has no nested duplicate agent list', () => assert.equal(publicSnapshot.project.agents, undefined));
  for (const agent of agents) {
    await point(`${agent.role} exact child session is visible`, () => assert.ok(content.includes(agent.childId)));
    await point(`${agent.role} role is visible`, () => assert.ok(content.includes(render.t(`role.${agent.role}`))));
    await point(`${agent.role} status is visible`, () => assert.ok(content.includes(render.t(`status.${agent.status}`))));
    await point(`${agent.role} branch is visible`, () => assert.ok(content.includes(agent.branch)));
    await point(`${agent.role} worktree is visible`, () => assert.ok(content.includes(agent.worktree)));
    await point(`${agent.role} update time is visible`, () => assert.ok(content.includes(agent.updatedAt)));
    await point(`${agent.role} independent summary is visible`, () => assert.ok(content.includes(agent.summary)));
  }
  await point('nonempty top-level agents suppress empty guidance', () => assert.ok(!content.includes(render.t('empty.agents'))));
  await point('all existing agent column headers remain present', () => {
    const headers = section.children[1].children[0].children.map(text);
    assert.deepEqual(headers, ['Role', 'Agent status', 'Child session', 'Branch', 'Worktree', 'Updated', 'Summary']);
  });
  await point('render leaves snapshot records unchanged', () => assert.deepEqual(publicSnapshot.agents, agents));
  await point('project identity remains visible', () => assert.ok(text(tree).includes('project-render-test')));
  await point('machine identity remains visible', () => assert.ok(text(tree).includes('machine-render-test')));
  await point('evaluator remains visible', () => assert.ok(text(tree).includes('python evaluator.py')));
});

test('agent routing preserves empty handling and display boundaries', async context => {
  const render = client();
  const section = data => agentTable(render.body(data));
  const content = data => text(section(data));
  const withAgents = agents => ({ ...snapshot(project()), agents });
  const point = (name, fn) => context.test(name, fn);
  for (const [name, agents] of [['empty', []], ['missing', undefined], ['null', null], ['object', {}]]) {
    await point(`${name} top-level list displays empty guidance`, () => assert.ok(content(withAgents(agents)).includes(render.t('empty.agents'))));
  }
  await point('obsolete nested list cannot replace an empty top-level list', () => {
    const data = withAgents([]);
    data.project.agents = [record('infra', 'running', 'obsolete')];
    assert.ok(!content(data).includes('child-obsolete'));
    assert.ok(content(data).includes(render.t('empty.agents')));
  });
  await point('top-level list remains authoritative over contradictory nested data', () => {
    const data = withAgents([record('infra', 'done', 'actual')]);
    data.project.agents = [record('infra', 'running', 'obsolete')];
    assert.ok(content(data).includes('child-actual'));
    assert.ok(!content(data).includes('child-obsolete'));
  });
  await point('long summary is truncated visibly while preserving complete tooltip', () => {
    const summary = 'Summary '.repeat(50);
    const tree = section(withAgents([{ ...record('infra', 'done'), summary }]));
    assert.ok(text(tree).includes(summary.slice(0, 240) + '…'));
    assert.equal(nodes(tree, n => n.props.title === summary).length, 1);
  });
  await point('exactly 240 summary characters remain untruncated', () => {
    const summary = 'x'.repeat(240);
    assert.ok(content(withAgents([{ ...record('infra', 'done'), summary }])).includes(summary));
    assert.ok(!content(withAgents([{ ...record('infra', 'done'), summary }])).includes('…'));
  });
  await point('absent optional fields render placeholders without hiding the child', () => {
    const value = content(withAgents([{ role: 'composer', status: 'running', childId: 'child-minimal' }]));
    assert.ok(value.includes('child-minimal'));
    assert.ok(value.includes('—'));
  });
  await point('unknown status remains visible as unknown', () => {
    assert.ok(content(withAgents([record('infra', 'not-a-status')])).includes('Unknown'));
  });
  await point('only the most recent eight records are displayed in original order', () => {
    const agents = Array.from({ length: 10 }, (_, i) => record('researcher', 'done', `history-${i}`));
    const value = content(withAgents(agents));
    assert.ok(!value.includes('child-history-0'));
    assert.ok(!value.includes('child-history-1'));
    const shown = [...value.matchAll(/child-history-(\d)/g)].map(match => Number(match[1]));
    assert.deepEqual(shown, [2, 3, 4, 5, 6, 7, 8, 9]);
  });
  await point('mission and batch fields remain associated with their own sections', () => {
    const p = project([record('infra', 'running')]);
    p.missions = [{ id: 'mission-visible', status: 'done', branch: 'mission/visible', batchId: 'batch-visible' }];
    p.batches = [{ id: 'batch-visible', status: 'done', branch: 'batch/visible', missionIds: ['mission-visible'], machineId: 'machine-render-test' }];
    const body = text(render.body(snapshot(p)));
    assert.ok(body.includes('mission-visible') && body.includes('mission/visible'));
    assert.ok(body.includes('batch-visible') && body.includes('batch/visible'));
    assert.ok(!content(snapshot(p)).includes('mission-visible'));
  });
});

test('real client polling callbacks refresh the displayed agent records', async context => {
  const render = client();
  let closed = false;
  const page = () => render.page(() => { closed = true; });
  const initial = page();
  const point = (name, fn) => context.test(name, fn);
  await point('initial page shows loading state', () => assert.ok(text(initial).includes(render.t('state.loading'))));
  const agent = record('infra', 'running', 'polling');
  await render.mount(ok(snapshot(project([agent]))));
  await point('poll requests the read-only snapshot endpoint without cached results', () => {
    assert.equal(render.requests[0].url, '/api/aleph/snapshot');
    assert.equal(render.requests[0].options.cache, 'no-store');
    assert.equal(render.requests[0].options.headers.accept, 'application/json');
  });
  await point('client retains the existing two-second poll interval', () => assert.equal(render.interval.delay, 2000));
  await point('successful first poll displays the running child', () => assert.ok(text(agentTable(page())).includes('child-polling')));
  const done = { ...agent, status: 'done', summary: 'Final independent polling summary' };
  await render.poll(ok(snapshot(project([done]))));
  await point('subsequent poll replaces running status with done status', () => {
    const table = text(agentTable(page()));
    assert.ok(table.includes('Done'));
    assert.ok(!table.includes('Running'));
  });
  await point('subsequent poll displays the final summary', () => assert.ok(text(agentTable(page())).includes(done.summary)));
  await render.poll(new Error('temporary connection failure'));
  await point('failed poll retains the last agent records and summary', () => assert.ok(text(agentTable(page())).includes(done.summary)));
  await point('failed poll displays stale-data guidance', () => assert.ok(text(page()).includes(render.t('state.stale'))));
  await render.poll({ status: 404, body: { error: { code: 'aleph/no-project' } } });
  await point('no-project response uses existing empty-project guidance', () => assert.ok(text(page()).includes(render.t('state.empty.title'))));
  await point('no-project response removes prior agent records', () => assert.ok(!text(page()).includes('child-polling')));
  await render.poll(ok(snapshot(project([done]))));
  await point('later successful poll restores actual records', () => assert.ok(text(agentTable(page())).includes(done.summary)));
  await point('back button keeps its existing callback', () => {
    const [button] = nodes(page(), node => node.type === 'button' && text(node) === 'Back to conversation');
    button.props.onClick();
    assert.equal(closed, true);
  });
  render.stop();
  await point('unmount stops the polling interval', () => assert.equal(render.interval.cleared, true));
  const reloaded = client();
  reloaded.page();
  await reloaded.mount(ok(snapshot(project([done]))));
  await point('fresh page instance reconstructs completed records from a new snapshot', () => {
    assert.ok(text(agentTable(reloaded.page())).includes(done.summary));
  });
  reloaded.stop();
});
