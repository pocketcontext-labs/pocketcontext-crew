// Run against a newly launched simulator: node tests/grok_simulator_browser.mjs STATE
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const state = process.argv[2];
assert.ok(state && existsSync(path.join(state, '.crew-grok-rehearsal')), 'Pass a dedicated simulator state directory');
const db = path.resolve(state, 'project/pocketcontext.db');
const mailbox = process.env.CREW_SIM_TEST_MAILBOX;
const binary = path.resolve(process.env.CREW_SIM_TEST_BINARY || 'bin/pocketcontext-crew');
const cliEnv = mailbox ? {
  ...process.env, HOME: path.resolve(state, 'home'), XDG_CACHE_HOME: path.resolve(state, 'cache'),
  XDG_CONFIG_HOME: path.resolve(state, 'config'), XDG_STATE_HOME: path.resolve(state, 'state'),
} : process.env;
const crew = (...args) => JSON.parse(execFileSync(binary, ['--db', db, ...args], { encoding: 'utf8', env: cliEnv }));
const read = (collection, extra = {}) => crew('read', JSON.stringify({collection, ...extra}));
const config = () => read('webhook_configs').items.find(row => row.scope === 'global');
assert.ok(!config().agent, 'Start with an unconfigured rehearsal instance');
// Supplying the fixture mailbox selects the hosted mobile rehearsal. Both test
// domains resolve to the local TLS proxy. The CLI still addresses the marked DB.
const simulator = mailbox ? 'https://sim-mobile.example.test' : 'http://127.0.0.1:57991';
const readerOrigin = mailbox ? 'https://crew-mobile.example.test' : 'http://127.0.0.1:57990';
const browser = await chromium.launch({args: mailbox ? [
  '--no-proxy-server',
  '--host-resolver-rules=MAP crew-mobile.example.test 127.0.0.1:58443, MAP sim-mobile.example.test 127.0.0.1:58443',
] : []});
const context = await browser.newContext(mailbox ? {
  viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true,
} : {});
const reader = await context.newPage();
const chats = await context.newPage();
const latestMail = () => existsSync(mailbox) ? readFileSync(mailbox, 'utf8') : '';
async function nextCode(previous) {
  let code;
  await until('synthetic owner email', () => {
    const body = latestMail();
    if (body !== previous) code = body.match(/(?:^|\n)(\d{6})\s+is your PocketContext sign-in code/m)?.[1];
    return !!code;
  });
  return code;
}
async function message(role, text) {
  const pane = chats.getByRole('region', {name: role});
  await pane.getByRole('textbox').fill(text);
  await pane.getByRole('button', {name: 'Send message'}).click();
}
async function until(description, condition) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    const error = chats.locator('li[data-source="error"]').first();
    if (await error.count()) throw new Error(await error.innerText());
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error('Timed out waiting for ' + description);
}
async function step(name) {
  const box = reader.getByRole('region', {name, exact:true});
  const toggle = box.getByRole('heading').first().getByRole('button');
  await until('expanded ' + name, async () => {
    await toggle.evaluate(button => {
      if (button.getAttribute('aria-expanded') === 'false') button.click();
    });
    return box.locator('.crew-setup-body').isVisible();
  });
  return box;
}
async function prompt(box, label) {
  const button = box.getByRole('button', {name: label, exact:true});
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  return button.locator('../..').locator('pre.crew-copy-prompt').last().innerText();
}
async function openWizard() {
  await reader.goto(readerOrigin + '/#/connect?section=integration');
  // Only a fresh configuration needs an explicit click. After selection,
  // Crew opens the wizard as soon as the saved configuration loads.
  await reader.getByRole('button', {name:'Set up automatic wake-ups'}).click();
  await reader.getByRole('heading', {name:'Grok setup'}).waitFor();
}
async function refreshWizard() {
  // Navigate once and wait for Crew to apply the saved configuration.
  // A second navigation can briefly expose the initial setup button again.
  await reader.reload();
  await reader.getByRole('heading', {name:'Grok setup'}).waitFor();
  await reader.getByText('Loading integration…', {exact:true}).waitFor({state:'hidden'});
}
try {
  if (mailbox) {
    const before = latestMail();
    await chats.goto(simulator);
    await chats.getByLabel('Owner email', {exact:true}).fill('owner@example.test');
    const mailRequested = chats.waitForResponse(response => new URL(response.url()).pathname === '/_gateway/request');
    await chats.getByRole('button', {name:'Email me a code',exact:true}).click();
    assert.equal((await mailRequested).status(), 200, 'gateway accepted fixture email and requested OTP');
    await chats.getByLabel('Email code', {exact:true}).waitFor();
    await chats.getByLabel('Email code', {exact:true}).fill(await nextCode(before));
    await chats.getByRole('button', {name:'Sign in',exact:true}).click();
    await chats.waitForURL(simulator + '/');
  } else {
    const signIn = crew('open','--no-browser').signInLink;
    assert.equal(new URL(signIn).origin, readerOrigin);
    await reader.goto(signIn);
    await reader.getByRole('button',{name:'Sign out'}).waitFor();
  }
  if (!mailbox) await chats.goto(simulator);
  for (const name of ['Local dispatcher','Local specialist']) {
    await message(name, read('session', {agent:name}).prompt);
  }
  await until('two initialized chats', async () => (await chats.getByText(/Joined as Local/).count()) === 2);
  await openWizard();
  const choose = await step('Choose your dispatcher');
  await choose.getByLabel('Crew dispatcher', {exact:true}).selectOption({label:'Local dispatcher'});
  await until('dispatcher selection', () => !!config().agent);
  await choose.getByLabel('Dispatch path').selectOption('parent_bridge');
  await until('parent bridge selection', () => config().dispatch_mode === 'parent_bridge');
  const prepare = await step('Prepare Grok');
  await message('Local dispatcher', await prompt(prepare,'Read setup prompt'));
  await until('routine sync', () => config().sync_status === 'verified');
  await prepare.getByText("Can't use a group? Paste into each bot's own chat").click();
  const authorization = await prompt(prepare,'Read bot authorization prompt');
  if (mailbox) assert.ok(authorization.includes(readerOrigin + '/mcp through our shared MCP connection'));
  for (const role of ['Local dispatcher','Local specialist']) await message(role, authorization);
  await until('two authorizations', async () => (await chats.getByText(/Owner authorized this participant/).count()) === 2);
  // The simulator updated the config in another browser. Reload its current revision.
  await refreshWizard();
  await chats.getByText('Webhook credentials', {exact:true}).click();
  const credentials = await step('Enter webhook credentials');
  await credentials.getByLabel('Webhook URL', {exact:true}).fill(await chats.locator('#url').inputValue());
  await credentials.getByLabel('Webhook secret', {exact:true}).fill(await chats.locator('#secret').inputValue());
  const savedCredentials = reader.waitForResponse(r => r.url().endsWith('/api/crew/write') && r.request().postDataJSON()?.action === 'webhook.credentials.update');
  await credentials.getByRole('button',{name:'Save credentials'}).click();
  assert.equal((await savedCredentials).status(),200,'receiver accepted by development server');
  await until('saved credentials', () => config().secret_configured);
  await refreshWizard();
  const verify = await step('Verify the connection');
  await verify.getByLabel('Test recipient').selectOption({label:'Local specialist'});
  await verify.getByRole('button',{name:'Send test'}).click();
  await until('specialist diagnostic', () => config().setup?.can_enable);
  assert.equal(config().enabled,false);
  await refreshWizard();
  const enable = await step('Enable future notifications');
  await enable.getByRole('button',{name:'Enable delivery'}).click({timeout:60_000});
  await until('delivery', () => config().enabled);
  await refreshWizard();
  await reader.getByRole('button',{name:'Review setup',exact:true}).click();
  const routing = await step('Verify task routing (optional)');
  await message('Local dispatcher', await prompt(routing,'Read routing test prompt'));
  await until('both completed executions', () => {
    const executions = read('webhook_executions').items;
    const complete = executions.filter(row => row.state === 'completed');
    return complete.some(row=>row.agent===config().agent) && complete.some(row=>row.agent!==config().agent);
  });
  if (mailbox) {
    for (const page of [chats, reader]) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        'The rehearsal fits the mobile viewport');
    }
  }
  console.log('Six setup steps passed with dispatcher self-work and a specialist handoff.');
} catch (error) {
  console.error('Wizard:', await reader.locator('.crew-setup-step').evaluateAll(steps => steps.map(s => [s.getAttribute('aria-label'), s.querySelector('button')?.getAttribute('aria-expanded')])));
  throw error;
} finally {
  await browser.close();
}
