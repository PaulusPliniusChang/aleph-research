import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {chromium} from '/tmp/aleph-regression-validation/node_modules/playwright-core/index.mjs';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const repaired = Boolean(config.expectProtection);
const records = {flow: 'Actual DSH console -> initialize project -> observe real agent records',
  browserFallback: 'Browser plugin not available', checks: [], pageErrors: [], consoleLogs: [], failedResponses: [], events: []};
const save = () => writeFile(config.output, JSON.stringify(records, null, 2));
const check = async (name, condition, value) => {
  records.checks.push({name, passed: Boolean(condition), value}); await save();
  assert.ok(condition, name); console.log(name);
};
const browser = await chromium.launch({executablePath: '/opt/google/chrome/chrome', headless: true});
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'zh-CN'});
  const page = await context.newPage();
  page.on('pageerror', e => records.pageErrors.push(e.message));
  page.on('console', m => {if (['error', 'warning'].includes(m.type())) records.consoleLogs.push({type:m.type(), text:m.text(), location:m.location()});});
  page.on('response',r=>{if(r.status()>=400)records.failedResponses.push({url:r.url(),status:r.status()});});
  const log = await readFile(config.root + '/dsh.log', 'utf8');
  const url = log.match(/dsh web: (http:\/\/\S+)/)?.[1];
  assert.ok(url, 'actual DSH login URL exists');
  await page.goto(url);
  const next = page.getByText('继续', {exact:true});
  await next.waitFor({state:'visible', timeout:15000});
  await next.click();
  await next.waitFor({state:'hidden'});
  const close = page.getByRole('button', {name:'关闭', exact:true});
  if (await close.isVisible()) await close.click();
  await page.getByRole('button', {name:'Aleph', exact:true}).click({timeout:15000});
  await page.getByRole('heading', {name:/Aleph Research/}).waitFor();
  await check('actual page has DSH identity', (await page.title()).includes('DSH'));
  await check('actual console is not blank', (await page.locator('body').innerText()).includes('Aleph Research'));
  const screenshot = async label => {
    const file = `${config.screenshotPrefix || '16-current'}-${label}.png`;
    await page.screenshot({path:config.evidenceDir + '/' + file});
    records.events.push({name:label, screenshot:file, body:await page.locator('body').innerText()});
    await save();
  };
  const http = async (path, body) => {
    const response = await fetch(config.url + path, {method:body === undefined ? 'GET' : 'POST',
      headers:{'Content-Type':'application/json', Origin:config.url}, body:body === undefined ? undefined : JSON.stringify(body)});
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  const bridge = async body => {const v = await http('/api/aleph-test/bridge', body); assert.ok(v.ok); records.events.push({name:'actual-bridge', request:body, result:v.result}); return v.result;};
  const wait = async (predicate, label) => {const deadline=Date.now()+15000; while (!await predicate()) {if(Date.now()>deadline) throw new Error('wait: '+label); await new Promise(resolve=>setTimeout(resolve,100));}};
  await wait(async()=> (await page.locator('body').innerText()).includes('暂无战役快照'), 'actual no-project empty state');
  await check('current upstream no-project console shows empty state', (await page.locator('body').innerText()).includes('暂无战役快照'));
  await screenshot('no-project-desktop');
  const parent = await bridge({action:'parent', cwd:config.workspace});
  const tool = (name,args) => bridge({action:'tool',sessionId:parent.sessionId,name,args});
  const project = await tool('aleph_init_project',{workspace:config.workspace});
  const pid=project.id;
  const snapshot = async()=> {const v=await http('/api/aleph/snapshot'); assert.equal(v.project.id,pid); return v;};
  let publicSnapshot = await snapshot();
  await check('real new project has empty top-level agent list', publicSnapshot.agents.length===0);
  await check('real project metadata has no nested agent list', publicSnapshot.project.agents===undefined);
  await page.getByRole('heading',{name:'编排 agent',exact:true}).waitFor();
  let section=()=>page.locator('section').filter({has:page.getByRole('heading',{name:'编排 agent',exact:true})});
  await check('real empty agent list is shown as empty', (await section().innerText()).includes('尚未运行 Composer 或 InfraOptimizer。'));
  await screenshot('project-empty-desktop');
  const run=await tool('aleph_run_researcher',{project_id:pid});
  const control=body=>http('/api/aleph-test/researcher-control',{parentId:parent.sessionId,...body});
  await wait(async()=> (await control({})).states.some(s=>s.sessionId===run.childId && s.waiting), 'real child waits after actual bash');
  const child=(await control({})).states.find(s=>s.sessionId===run.childId);
  records.events.push({name:'actual-child-running',state:child,run});
  await check('real researcher child is live', child.live && child.agentStatus !== 'idle');
  await check('real researcher invoked actual bash before waiting', child.calls===2 && child.toolCall.name==='bash');
  const marker=await readFile(run.worktree+'/researcher-'+run.childId+'.txt','utf8');
  await check('actual bash ran in researcher owned worktree', marker.trim()===run.worktree, marker.trim());
  publicSnapshot=await snapshot();
  records.events.push({name:'running-public-snapshot',snapshot:publicSnapshot});
  let agent=publicSnapshot.agents.find(a=>a.childId===run.childId);
  await check('public actual running record belongs to child', agent?.status==='running' && agent.role==='researcher');
  await check('public running record has no summary', agent.summary===null);
  await wait(async()=> {const txt=await page.locator('body').innerText();return txt.includes(pid);}, 'project polling updates actual project');
  // Wait for a completed page-owned poll carrying the actual child, without request interception.
  await page.waitForResponse(async response=> {
    if(!response.url().endsWith('/api/aleph/snapshot') || response.status()!==200) return false;
    try {return (await response.json()).agents?.some(a=>a.childId===run.childId && a.status==='running');} catch {return false;}
  },{timeout:7000});
  await check(repaired ? 'running child is rendered in agent section' : 'defect: running child is absent from rendered agent section', (await section().innerText()).includes(run.childId) === repaired);
  await check(repaired ? 'nonempty running API list replaces empty guidance' : 'defect: nonempty running API list is rendered as empty', (await section().innerText()).includes('尚未运行 Composer 或 InfraOptimizer。') !== repaired);
  await screenshot('running-desktop');
  await page.setViewportSize({width:390,height:844});
  await check('mobile console retains project identity', (await page.locator('body').innerText()).includes(pid));
  await check(repaired ? 'mobile running child is rendered without empty guidance' : 'defect: mobile running agent section is also empty', repaired ? !(await section().innerText()).includes('尚未运行 Composer 或 InfraOptimizer。') && (await section().innerText()).includes(run.childId) : (await section().innerText()).includes('尚未运行 Composer 或 InfraOptimizer。') && !(await section().innerText()).includes(run.childId));
  await screenshot('running-mobile');
  await control({action:'release',sessionId:run.childId});
  await wait(async()=> (await snapshot()).agents.some(a=>a.childId===run.childId && a.status==='done'), 'actual completion callback');
  const expected='Distinct researcher result for '+run.childId;
  publicSnapshot=await snapshot();
  records.events.push({name:'done-public-snapshot',snapshot:publicSnapshot});
  agent=publicSnapshot.agents.find(a=>a.childId===run.childId);
  await check('actual completion API has correct child summary', agent.status==='done' && agent.summary===expected);
  await page.waitForResponse(async response=> {
    if(!response.url().endsWith('/api/aleph/snapshot') || response.status()!==200) return false;
    try {return (await response.json()).agents?.some(a=>a.childId===run.childId && a.status==='done');} catch {return false;}
  },{timeout:7000});
  await check(repaired ? 'real completion summary appears after page poll' : 'defect: real completion summary remains absent after page poll', (await section().innerText()).includes(expected) === repaired);
  await screenshot('done-mobile');
  await page.setViewportSize({width:1440,height:1000});
  await check(repaired ? 'desktop completed record replaces empty guidance' : 'defect: desktop done section still uses empty guidance', (await section().innerText()).includes('尚未运行 Composer 或 InfraOptimizer。') !== repaired);
  await screenshot('done-desktop');
  await page.reload();
  await page.getByRole('button',{name:'Aleph',exact:true}).click();
  await page.getByRole('heading',{name:'编排 agent',exact:true}).waitFor();
  await check(repaired ? 'reload recovers persisted child and summary' : 'defect: reload cannot recover persisted record', repaired ? (await section().innerText()).includes(run.childId) && (await section().innerText()).includes(expected) && !(await section().innerText()).includes('尚未运行 Composer 或 InfraOptimizer。') : (await section().innerText()).includes('尚未运行 Composer 或 InfraOptimizer。') && !(await section().innerText()).includes(run.childId));
  await screenshot('reloaded-desktop');
  await check('actual persisted backend record survives reload', (await snapshot()).agents.find(a=>a.childId===run.childId)?.summary===expected);
  await check('no framework error overlay is present', await page.locator('vite-error-overlay,nextjs-portal,[data-nextjs-dialog]').count() === 0);
  await check('no uncaught page error is present', records.pageErrors.length === 0, records.pageErrors);
  const unexpectedResponses=records.failedResponses.filter(r=>!(r.status===404 && r.url===config.url+'/api/aleph/snapshot'));
  const unexpectedConsole=records.consoleLogs.filter(m=>!(m.type==='error' && m.text==='Failed to load resource: the server responded with a status of 404 (Not Found)' && m.location?.url===config.url+'/api/aleph/snapshot'));
  records.expectedConsoleExplanation='The actual no-project control returns HTTP 404 aleph/no-project. Chromium reports that request in console; current upstream correctly renders the empty state. All other errors/warnings fail the check.';
  await check('browser console contains only expected no-project HTTP 404', unexpectedConsole.length===0 && unexpectedResponses.length===0,{unexpectedConsole,unexpectedResponses});
  records.defect_reproduced=!repaired;
  records.repair_accepted=repaired;
  await save();
  await save();
} catch (error) {
  try {records.failureBody = await (await browser.contexts()[0].pages()[0]).locator('body').innerText(); await browser.contexts()[0].pages()[0].screenshot({path:config.root + '/failure.png'});} catch {}
  records.error = {name:error.name, message:error.message, stack:error.stack};
  await save(); throw error;
} finally {await browser.close();}
