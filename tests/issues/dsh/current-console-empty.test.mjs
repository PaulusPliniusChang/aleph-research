import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const source = resolve(process.env.ALEPH_CURRENT_SOURCE || '/home/paulus-chang/项目/aleph');
const code = readFileSync(join(source, 'dsh-plugin/client.js'), 'utf8');
const project = { project: { id: 'p-current-empty-control', title: 'Actual contract control', status: 'running' }, missions: [], batches: [], machines: [], agents: [], git: [] };
const response = (status, body, invalid = false) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (invalid) throw new Error('invalid JSON'); return body; } });
const noProject = { ok: false, error: { code: 'aleph/no-project' } };
const observations = [];
function harness() {
  let state, effect, interval, cleanup, answer, request, updates = 0, cleared = false;
  const React = { createElement: (type, props, ...children) => ({ type, props, children: children.flat(Infinity) }),
    useState(initial) { state ??= initial; return [state, value => { state = typeof value === 'function' ? value(state) : value; updates++; }]; },
    useEffect(fn) { effect = fn; } };
  const context = { fetch: async (...args) => { request = args; if (answer instanceof Error) throw answer; return answer; },
    setInterval: (fn, ms) => { interval = { fn, ms }; return 17; }, clearInterval: id => { cleared = id === 17; },
    window: { __ModuleLoader__: { load(def) { def.factory(name => { assert.equal(name, 'react'); return React; }); } } } };
  vm.runInNewContext(code.replace('    return {\n      name:', '    window.testApi = { useSnapshot, ConsoleView, dict };\n    return {\n      name:'), context);
  const api = context.window.testApi;
  api.useSnapshot();
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const text = node => node == null || node === false ? '' : typeof node === 'object' ? (typeof node.type === 'function' ? text(node.type(node.props)) : node.children.map(text).join('\n')) : String(node);
  return { get state() { return state; }, get updates() { return updates; }, get cleared() { return cleared; }, get request() { return request; }, get interval() { return interval; },
    async start(next) { answer = next; cleanup = effect(); await flush(); },
    async poll(next) { answer = next; await interval.fn(); await flush(); },
    stop() { cleanup(); },
    render(language = 'zh') { return text(api.ConsoleView({ t: key => api.dict[language][key] ?? key, onClose() {} })); },
    async stopDuringRequest() { let release; answer = { status: 200, ok: true, json: () => new Promise(resolve => { release = resolve; }) }; const pending = interval.fn(); await flush(); cleanup(); release(project); await pending; await flush(); },
  };
}
test('current #1 no-project snapshot contract', async t => {
  const point = async (name, fn) => t.test(name, async () => { await fn(); observations.push({ name, passed: true }); });
  const h = harness();
  await point('initial state renders loading before request', () => assert.match(h.render(), /正在加载战役快照/));
  await h.start(response(404, noProject));
  await point('native no-project 404 becomes empty', () => assert.equal(h.state.phase, 'empty'));
  await point('native no-project clears snapshot', () => assert.equal(h.state.snapshot, null));
  await point('native empty records correct error identity', () => assert.equal(h.state.error.code, 'aleph/no-project'));
  await point('native empty has successful fetch timestamp', () => assert.equal(typeof h.state.fetchedAt, 'number'));
  await point('Chinese empty title is rendered', () => assert.match(h.render(), /暂无战役快照/));
  await point('Chinese empty guidance names current initializer', () => assert.match(h.render(), /aleph_init_project/));
  await point('English empty guidance describes current project', () => assert.match(h.render('en'), /No project yet/));
  await point('empty state does not render failure heading', () => assert.doesNotMatch(h.render(), /无法读取战役快照/));
  await point('poll requests current snapshot endpoint', () => assert.equal(h.request[0], '/api/aleph/snapshot'));
  await point('poll bypasses HTTP cache', () => assert.equal(h.request[1].cache, 'no-store'));
  await point('poll explicitly accepts JSON', () => assert.equal(h.request[1].headers.accept, 'application/json'));
  await point('poll continues at two second interval', () => assert.equal(h.interval.ms, 2000));
  for (const [label, answer] of [
    ['unrelated 404', response(404, { ok: false, error: { code: 'other/missing' } })],
    ['missing code 404', response(404, { ok: false })],
    ['unauthorized', response(401, noProject)], ['forbidden', response(403, noProject)],
    ['server failure with no-project code', response(500, noProject)],
    ['unavailable server', response(503, { ok: false })],
    ['unparseable failing response', response(503, null, true)],
    ['network interruption', new Error('connection refused')],
  ]) await point(label + ' renders failure rather than native empty', async () => {
    const failing = harness(); await failing.start(answer); assert.equal(failing.state.phase, 'error');
    assert.match(failing.render(), /无法读取战役快照/); assert.doesNotMatch(failing.render(), /暂无战役快照/);
  });
  await h.poll(response(200, project));
  await point('successful poll replaces empty phase with ready', () => assert.equal(h.state.phase, 'ready'));
  await point('successful poll displays current project title', () => assert.match(h.render(), /Actual contract control/));
  await point('successful poll clears no-project marker', () => assert.equal(h.state.error, null));
  const fetchedAt = h.state.fetchedAt;
  await h.poll(response(503, {}));
  await point('failed update retains ready phase', () => assert.equal(h.state.phase, 'ready'));
  await point('failed update preserves exact prior snapshot', () => assert.equal(h.state.snapshot, project));
  await point('failed update preserves successful timestamp', () => assert.equal(h.state.fetchedAt, fetchedAt));
  await point('failed update renders stale warning', () => assert.match(h.render(), /正在显示最后一次快照/));
  await point('failed update retains visible project identity', () => assert.match(h.render(), /Actual contract control/));
  await h.poll(response(200, project));
  await point('subsequent success clears stale warning', () => assert.doesNotMatch(h.render(), /正在显示最后一次快照/));
  await h.poll(response(404, noProject));
  await point('native no-project clears previously ready snapshot', () => assert.equal(h.state.snapshot, null));
  await point('native no-project removes prior project title', () => assert.doesNotMatch(h.render(), /Actual contract control/));
  await point('native no-project restores creation guidance', () => assert.match(h.render(), /aleph_init_project/));
  await h.poll(new Error('offline'));
  await point('network error after empty becomes failure', () => assert.equal(h.state.phase, 'error'));
  await h.poll(response(404, noProject));
  await point('native response recovers failure without reload', () => assert.equal(h.state.phase, 'empty'));
  const count = h.updates;
  await h.stopDuringRequest();
  await point('unmount clears actual scheduled timer', () => assert.equal(h.cleared, true));
  await point('late pending response does not update unmounted view', () => assert.equal(h.updates, count));
  if (process.env.ALEPH_EMPTY_OBSERVATIONS) writeFileSync(process.env.ALEPH_EMPTY_OBSERVATIONS, JSON.stringify({ source, source_sha: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), boundary: 'Actual existing client hook and complete ConsoleView in isolated VM; React hooks, fetch, interval and virtual element tree replaced. No actual DSH/browser claim; actual rendered validation separately.', effective_points: observations.length, observations }, null, 2));
});
