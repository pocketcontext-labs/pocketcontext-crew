// Run against a newly launched simulator: node tests/grok_simulator_browser.mjs STATE
import { chromium } from '../ui/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const state = process.argv[2];
assert.ok(state && existsSync(path.join(state, '.crew-grok-rehearsal')), 'Pass a dedicated simulator state directory');
const db = path.resolve(state, 'project/pocketcontext.db');
const binary = path.resolve('bin/pocketcontext-crew');
const crew = (...args) => JSON.parse(execFileSync(binary, ['--db', db, ...args], { encoding: 'utf8' }));
const read = (collection, extra = {}) => crew('read', JSON.stringify({collection, ...extra}));
const config = () => read('webhook_configs').items.find(row => row.scope === 'global');
assert.ok(!config().agent, 'Start with an unconfigured rehearsal instance');
const browser = await chromium.launch({headless: true});
const reader = await browser.newPage();
const chats = await browser.newPage();
const simulator = 'http://127.0.0.1:57991';
const readerOrigin = 'http://127.0.0.1:57990';
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
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
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
  const signIn = crew('open','--no-browser').signInLink;
  assert.equal(new URL(signIn).origin, readerOrigin);
  await reader.goto(signIn);
  await reader.getByRole('button',{name:'Sign out'}).waitFor();
  await chats.goto(simulator);
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
  for (const role of ['Local dispatcher','Local specialist']) await message(role, authorization);
  await until('two authorizations', async () => (await chats.getByText(/Owner authorized this participant/).count()) === 2);
  // The simulator updated the config in another browser. Reload its current revision.
  await refreshWizard();
  const credentials = await step('Enter webhook credentials');
  await chats.getByText('Webhook credentials', {exact:true}).click();
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
  console.log('Six setup steps passed with dispatcher self-work and a specialist handoff.');
} catch (error) {
  console.error('Wizard:', await reader.locator('.crew-setup-step').evaluateAll(steps => steps.map(s => [s.getAttribute('aria-label'), s.querySelector('button')?.getAttribute('aria-expanded')])));
  throw error;
} finally {
  await browser.close();
}
