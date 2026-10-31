import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '/tmp/aleph-regression-validation/node_modules/playwright-core/index.mjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const records = { flow: 'Actual DSH Aleph panel -> native no-project -> refresh/reopen/mobile -> actual project initialization -> native poll update; injected HTTP/network error controls separately identified', browserFallback: 'Browser plugin not available', checks: [], events: [], pageErrors: [], consoleLogs: [], failedResponses: [] };
const save = () => writeFile(config.output, JSON.stringify(records, null, 2));
const check = async (name, condition, kind = 'actual', value) => { records.checks.push({ name, passed: Boolean(condition), kind, value }); await save(); assert.ok(condition, name); console.log(name); };
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true });
let page, mode;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  page = await context.newPage();
  page.on('pageerror', e => records.pageErrors.push(e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) records.consoleLogs.push({ type: m.type(), text: m.text(), location: m.location(), mode: mode?.label ?? 'native' }); });
  page.on('response', r => { if (r.status() >= 400) records.failedResponses.push({ url: r.url(), status: r.status(), mode: mode?.label ?? 'native' }); });
  const log = await readFile(config.root + '/dsh.log', 'utf8');
  const loginUrl = log.match(/dsh web: (http:\/\/\S+)/)?.[1];
  assert.ok(loginUrl);
  await page.goto(loginUrl);
  const next = page.getByText('继续', { exact: true }); await next.waitFor(); await next.click(); await next.waitFor({ state: 'hidden' });
  const close = page.getByRole('button', { name: '关闭', exact: true }); if (await close.isVisible()) await close.click();
  const enter = async () => { await page.getByRole('button', { name: 'Aleph', exact: true }).click(); await page.getByRole('heading', { name: /Aleph Research/ }).waitFor(); };
  await enter();
  const empty = () => page.getByRole('heading', { name: '暂无战役快照', exact: true });
  const error = () => page.getByRole('heading', { name: '无法读取战役快照', exact: true });
  const body = () => page.locator('body').innerText();
  const shot = async label => { const file = config.screenshotPrefix + '-' + label + '.png'; await page.screenshot({ path: config.evidenceDir + '/' + file }); records.events.push({ name: label, screenshot: file, body: await body() }); await save(); };
  await empty().waitFor();
  const raw = await page.evaluate(async () => { const r = await fetch('/api/aleph/snapshot'); return { status: r.status, body: await r.json() }; });
  records.nativeNoProject = raw;
  await check('native server returns no-project HTTP404', raw.status === 404 && raw.body.error.code === 'aleph/no-project');
  await check('native server identifies non-success envelope', raw.body.ok === false);
  await check('page URL belongs to isolated actual Host', new URL(page.url()).origin === config.url);
  await check('actual page title identifies DSH', (await page.title()).includes('DSH'));
  await check('actual panel is meaningful and nonblank', (await body()).includes('Aleph Research'));
  await check('native no-project renders empty title', await empty().isVisible());
  await check('native no-project renders current initialization instruction', (await body()).includes('aleph_init_project'));
  await check('native no-project does not render failure heading', await error().count() === 0);
  await shot('empty-desktop');
  await page.reload(); await enter(); await empty().waitFor();
  await check('reload recovers native empty state', await empty().isVisible());
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
  await check('return control closes the Aleph panel', await empty().count() === 0);
  await enter(); await empty().waitFor();
  await check('reopening panel recovers native empty guidance', (await body()).includes('aleph_init_project'));
  await page.setViewportSize({ width: 390, height: 844 });
  await check('mobile empty heading remains visible', await empty().isVisible());
  await check('mobile empty guidance remains readable', (await body()).includes('aleph_init_project'));
  await check('mobile empty document has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('empty-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/aleph/snapshot', async route => {
    if (!mode) return route.continue();
    if (mode.abort) return route.abort('failed');
    return route.fulfill({ status: mode.status, contentType: mode.raw ? 'text/html' : 'application/json', body: mode.raw ?? JSON.stringify(mode.body) });
  });
  const noProject = { ok: false, error: { code: 'aleph/no-project' } };
  for (const scenario of [
    { label: 'other404', status: 404, body: { ok: false, error: { code: 'other/missing' } } },
    { label: 'missingCode404', status: 404, body: { ok: false } },
    { label: 'unauthorized401', status: 401, body: noProject },
    { label: 'forbidden403', status: 403, body: noProject },
    { label: 'noProject500', status: 500, body: noProject },
    { label: 'html503', status: 503, raw: '<html>unavailable</html>' },
    { label: 'networkAbort', abort: true },
  ]) {
    mode = scenario;
    await error().waitFor({ timeout: 8000 });
    await check(scenario.label + ' renders failure', await error().isVisible() && await empty().count() === 0, 'injected');
    mode = null; await empty().waitFor({ timeout: 8000 });
    await check(scenario.label + ' recovers through actual native response', await empty().isVisible(), 'actual-recovery');
  }
  // Create a real project through registered tool routing, no synthetic success snapshots.
  const bridge = async request => { const r = await fetch(config.url + '/api/aleph-test/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.url }, body: JSON.stringify(request) }); const v = await r.json(); assert.ok(r.ok && v.ok, JSON.stringify(v)); records.events.push({ name: 'actual-tool', request, result: v.result }); return v.result; };
  const parent = await bridge({ action: 'parent', cwd: config.workspace });
  const project = await bridge({ action: 'tool', sessionId: parent.sessionId, name: 'aleph_init_project', args: { workspace: config.workspace } });
  // Public snapshot supplies a display title derived from workspace, while init returns no title.
  const heading = () => page.getByRole('heading', { name: /Aleph Research 项目 ·/ });
  await heading().waitFor({ timeout: 8000 });
  const snapshot = await (await fetch(config.url + '/api/aleph/snapshot')).json();
  await check('registered initializer creates real project record', snapshot.project.id === project.id);
  await check('native successful poll replaces empty page with actual project', await heading().isVisible() && (await body()).includes(project.id) && await empty().count() === 0);
  await check('actual project snapshot remains free of fabricated mission records', snapshot.missions.length === 0);
  await shot('project-desktop');
  mode = { label: 'stale503', status: 503, body: { ok: false } };
  await page.getByText(/正在显示最后一次快照/).waitFor({ timeout: 8000 });
  await check('injected update failure preserves actual project', await heading().isVisible(), 'injected');
  await check('injected update failure explains stale snapshot', (await body()).includes('正在显示最后一次快照'), 'injected');
  await shot('stale-project');
  mode = null;
  await page.getByText(/正在显示最后一次快照/).waitFor({ state: 'hidden', timeout: 8000 });
  await check('actual successful response clears stale warning', await heading().isVisible() && !(await body()).includes('正在显示最后一次快照'));
  mode = { label: 'nativeShapeNoProject', status: 404, body: noProject };
  await empty().waitFor({ timeout: 8000 });
  await check('injected no-project clears previously displayed real project', await heading().count() === 0, 'injected');
  mode = null; await heading().waitFor({ timeout: 8000 });
  await check('actual existing project recovers after no-project control', await heading().isVisible());
  await page.reload(); await enter(); await heading().waitFor();
  await check('reload preserves actual project state from Host', await heading().isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await check('mobile actual project identity remains visible', await heading().isVisible());
  records.mobileProjectOverflow = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
  await shot('project-mobile');
  await check('no framework error overlay exists', await page.locator('vite-error-overlay,nextjs-portal,[data-nextjs-dialog]').count() === 0, 'browser-health');
  await check('no uncaught browser script errors exist', records.pageErrors.length === 0, 'browser-health', records.pageErrors);
  const unexpected = records.consoleLogs.filter(m => !(m.type === 'error' && m.location.url === config.url + '/api/aleph/snapshot' && (m.text.startsWith('Failed to load resource:') || m.text.includes('net::ERR_FAILED'))));
  const failedOther = records.failedResponses.filter(r => r.url !== config.url + '/api/aleph/snapshot');
  records.consoleExplanation = 'Native no-project snapshot returns HTTP404; explicit synthetic HTTP/network controls produce corresponding resource errors. No other console errors/warnings or failed resources are allowed. Synthetic faults are not actual Host outages.';
  await check('console warnings and errors are limited to explained snapshot failures', unexpected.length === 0 && failedOther.length === 0, 'browser-health', { unexpected, failedOther });
  records.effective_points = records.checks.length;
  await save();
} catch (e) {
  records.error = { name: e.name, message: e.message, stack: e.stack };
  if (page) { records.failureBody = await page.locator('body').innerText(); await page.screenshot({ path: config.root + '/failure.png' }); }
  await save(); throw e;
} finally { await browser.close(); }
