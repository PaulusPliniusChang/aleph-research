import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../dsh-plugin/client.js', import.meta.url), 'utf8');
const noCampaign = { ok: false, error: { code: 'aleph/no-campaign' } };
const noProject = { ok: false, error: { code: 'aleph/no-project' } };
const snapshot = { project: { id: 'p-test', title: 'Snapshot regression', status: 'running' }, missions: [] };
const json = (status, body) => new Response(JSON.stringify(body), { status });

// Load the complete client through its public module/slot registration. Only
// React hooks, DSH client services, fetch and the interval clock are replaced.
// Real browser rendering and DSH persistence are covered by integration checks.
function fixture(t, initial) {
  let state;
  let effect;
  let cleanup;
  let interval;
  let cleared = false;
  let page;
  let dictionaries;
  let nextResponse = initial;
  let plugin;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initialState) {
      state ??= initialState;
      return [state, (next) => { state = typeof next === 'function' ? next(state) : next; }];
    },
    useEffect(callback) { effect ??= callback; },
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(module) { plugin = module.factory(() => React); } } },
    fetch: async () => {
      if (nextResponse instanceof Error) throw nextResponse;
      return nextResponse;
    },
    setInterval(callback, delay) {
      assert.equal(delay, 2000);
      interval = callback;
      return 42;
    },
    clearInterval(id) { assert.equal(id, 42); cleared = true; },
    Date, Error,
  });
  plugin.apply({
    effect(callback) { callback(); },
    locale: {
      register(namespace, dict) { dictionaries = dict; },
      bind: () => (key) => dictionaries.en[key] ?? key,
    },
    layout: { selectPanel() {} },
    slots: {
      inject(slot, callback) { callback(); return () => {}; },
      register(descriptor, component) {
        if (descriptor.name === 'main') page = component;
        return () => {};
      },
    },
  });
  function render() {
    const element = page();
    return element.type(element.props);
  }
  function text(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    if (Array.isArray(node)) return node.map(text).join(' ');
    return text(node.children);
  }
  render();
  cleanup = effect();
  t.after(() => cleanup());
  return {
    get state() { return state; },
    get cleared() { return cleared; },
    text: () => text(render()),
    settle: () => setImmediate(),
    async poll(response) { nextResponse = response; await interval(); },
    unmount: () => cleanup(),
  };
}

test('404 with no-campaign displays the existing empty state and creation guidance', async (t) => {
  const f = fixture(t, json(404, noCampaign));
  await f.settle();
  assert.equal(f.state.phase, 'empty');
  assert.equal(f.state.error.code, 'aleph/no-campaign');
  assert.equal(f.state.snapshot, null);
  assert.match(f.text(), /No campaign snapshot yet/);
  assert.match(f.text(), /aleph_init_project/);
  assert.doesNotMatch(f.text(), /Cannot read the campaign snapshot/);
});

test('404 with no-project displays the empty state and project initialization guidance', async (t) => {
  const f = fixture(t, json(404, noProject));
  await f.settle();
  assert.equal(f.state.phase, 'empty');
  assert.equal(f.state.error.code, 'aleph/no-project');
  assert.equal(f.state.snapshot, null);
  assert.match(f.text(), /aleph_init_project/);
  assert.doesNotMatch(f.text(), /Cannot read the campaign snapshot/);
});

test('200 with a campaign displays the campaign', async (t) => {
  const f = fixture(t, json(200, snapshot));
  await f.settle();
  assert.equal(f.state.phase, 'ready');
  assert.equal(f.state.error, null);
  assert.match(f.text(), /Snapshot regression/);
});

for (const [name, response] of [
  ['a different 404', () => json(404, { ok: false, error: { code: 'other/not-found' } })],
  ['404 without an error body', () => json(404, {})],
  ['404 without ok:false', () => json(404, { error: noCampaign.error })],
  ['401 unauthorized', () => json(401, { ok: false })],
  ['403 forbidden', () => json(403, { ok: false })],
  ['500 even with the no-campaign code', () => json(500, noCampaign)],
  ['500 even with the no-project code', () => json(500, noProject)],
  ['503 with an HTML body', () => new Response('<h1>Unavailable</h1>', { status: 503 })],
  ['200 with malformed JSON', () => new Response('{invalid', { status: 200 })],
  ['200 with a different application error', () => json(200, { ok: false, error: { code: 'aleph/storage-failed' } })],
  ['200 with the no-campaign error', () => json(200, noCampaign)],
  ['200 with the no-project error', () => json(200, noProject)],
  ['200 with an unspecified application error', () => json(200, { ok: false })],
  ['a network failure', () => new Error('Network unavailable')],
]) {
  test(`${name} displays a failure rather than an empty state`, async (t) => {
    const f = fixture(t, response());
    await f.settle();
    assert.equal(f.state.phase, 'error');
    assert.equal(f.state.snapshot, null);
    assert.match(f.text(), /Cannot read the campaign snapshot/);
    assert.doesNotMatch(f.text(), /No campaign snapshot yet/);
  });
}

test('empty state becomes a campaign on the next poll without reloading', async (t) => {
  const f = fixture(t, json(404, noCampaign));
  await f.settle();
  await f.poll(json(200, snapshot));
  assert.equal(f.state.phase, 'ready');
  assert.equal(f.state.error, null);
  assert.match(f.text(), /Snapshot regression/);
});

test('a genuine failure after the empty state displays the error', async (t) => {
  const f = fixture(t, json(404, noCampaign));
  await f.settle();
  await f.poll(json(500, { ok: false }));
  assert.equal(f.state.phase, 'error');
  assert.match(f.text(), /HTTP 500/);
});

test('an error recovers to either empty or ready on the next poll', async (t) => {
  const f = fixture(t, new Error('Network unavailable'));
  await f.settle();
  assert.equal(f.state.phase, 'error');
  await f.poll(json(404, noCampaign));
  assert.equal(f.state.phase, 'empty');
  await f.poll(new Error('Network unavailable'));
  assert.equal(f.state.phase, 'error');
  await f.poll(json(200, snapshot));
  assert.equal(f.state.phase, 'ready');
  assert.equal(f.state.error, null);
});

test('a failed poll retains the last campaign and clears the warning on recovery', async (t) => {
  const f = fixture(t, json(200, snapshot));
  await f.settle();
  const previous = f.state.snapshot;
  const fetchedAt = f.state.fetchedAt;
  await f.poll(json(503, { ok: false }));
  assert.equal(f.state.phase, 'ready');
  assert.equal(f.state.snapshot, previous);
  assert.equal(f.state.fetchedAt, fetchedAt);
  assert.match(f.text(), /Showing the last snapshot/);
  assert.match(f.text(), /Snapshot regression/);
  await f.poll(json(200, snapshot));
  assert.equal(f.state.error, null);
  assert.doesNotMatch(f.text(), /Showing the last snapshot/);
});

test('no-campaign clears a previously displayed campaign and stale warning', async (t) => {
  const f = fixture(t, json(200, snapshot));
  await f.settle();
  await f.poll(new Error('Network unavailable'));
  await f.poll(json(404, noCampaign));
  assert.equal(f.state.phase, 'empty');
  assert.equal(f.state.snapshot, null);
  assert.doesNotMatch(f.text(), /Snapshot regression|Showing the last snapshot/);
});

test('unmount clears polling and ignores a late response', async (t) => {
  let resolveBody;
  const f = fixture(t, { status: 200, ok: true, json: () => new Promise((resolve) => { resolveBody = resolve; }) });
  await f.settle();
  f.unmount();
  assert.equal(f.cleared, true);
  resolveBody(snapshot);
  await f.settle();
  assert.equal(f.state.phase, 'loading');
});
