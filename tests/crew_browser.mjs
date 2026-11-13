import { chromium } from '../ui/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
const base = process.env.CREW_TEST_URL;
if(!base || !new URL(base).hostname.match(/^(127\.0\.0\.1|localhost)$/)) throw new Error('Synthetic loopback server required');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],outside=[],writeActions=[];
let syntheticOwnerAuth="";
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().endsWith('/api/crew/write')){try{writeActions.push(r.postDataJSON()?.action);syntheticOwnerAuth=r.headers().authorization||syntheticOwnerAuth;}catch{}}});
page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))outside.push(new URL(r.url()).origin);});
const dialog=()=>page.getByRole('dialog');
const close=()=>dialog().getByRole('button',{name:'Close dialog'}).click();
const saved=async()=>{await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();await page.getByRole('dialog').waitFor({state:'hidden'});};
const snap=async name=>{if(process.env.CREW_SCREENSHOTS) await page.screenshot({path:path.join(process.env.CREW_SCREENSHOTS,name+'.png'),fullPage:true});};
const snapView=async name=>{if(process.env.CREW_SCREENSHOTS) await page.screenshot({path:path.join(process.env.CREW_SCREENSHOTS,name+'.png')});};
// Exact label matching sees a textarea's own text, so match the label's span.
const noteBody=()=>dialog().getByLabel('Note',{exact:true});
const edit=()=>dialog().getByRole('tab',{name:'Edit',exact:true}).click();
try {
 await page.goto(base);
 await page.getByLabel('Password',{exact:true}).fill(process.env.CREW_TEST_PASSWORD);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('heading',{name:'Get started',exact:true}).waitFor();
 await snap('crew-home-new');
 await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();
 await page.waitForURL('**/#/tasks');
 await page.getByRole('heading',{name:'Tasks',exact:true}).waitFor();
 await page.getByRole('button',{name:'Set up starter crew'}).click();
 await page.getByText('Your five starter agents and their buckets are ready.').waitFor();
 await page.getByRole('navigation').getByRole('link',{name:'Notes',exact:true}).click();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Notes'}).waitFor();
 assert.equal(await page.locator('.crew-bucket-card').count(),5);
 await page.getByRole('button',{name:'New note'}).click();
 await dialog().getByLabel('Title',{exact:true}).fill('Synthetic launch voice');
 await dialog().getByLabel('Bucket',{exact:true}).selectOption({label:'NETWORK'});
 await noteBody().fill('Write plainly for independent founders.');
 await dialog().getByRole('button',{name:'Save note'}).click();await saved();
 // Notes: no page search; a bucket card filters the notes, Edit is its own button, and the address keeps filter and sort.
 assert.equal(await page.getByRole('searchbox',{name:'Search memory'}).count(),0,'no page search on memory');
 const bucketCard=name=>page.locator('.crew-buckets').getByRole('button',{name:new RegExp('^'+name+' ')});
 await bucketCard('NETWORK').click();
 await page.waitForFunction(()=>/^#\/notes\?bucket=[a-z0-9]{15}$/.test(location.hash));
 assert.equal(await bucketCard('NETWORK').getAttribute('aria-pressed'),'true');
 await page.waitForFunction(()=>{const e=[...document.querySelectorAll('.crew-note-card .crew-eyebrow')];return e.length===2&&e.every(x=>x.textContent==='NETWORK');});
 await page.getByRole('combobox',{name:'Sort notes'}).selectOption('title');
 await page.waitForFunction(()=>/&sort=title$/.test(location.hash));
 const filteredMemory=page.url();
 await page.reload();
 await page.locator('.crew-buckets').getByRole('button',{name:/^NETWORK /,pressed:true}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.crew-note-card').length===2);
 assert.equal(page.url(),filteredMemory,'reload keeps the Notes address');
 assert.equal(await page.getByRole('combobox',{name:'Sort notes'}).inputValue(),'title');
 assert.equal(await page.getByRole('combobox',{name:'Filter by bucket'}).locator('option:checked').innerText(),'NETWORK');
 await snap('crew-memory-filtered');
 await bucketCard('NETWORK').click();
 await page.waitForFunction(()=>location.hash==='#/notes?sort=title');
 await page.getByRole('combobox',{name:'Sort notes'}).selectOption('updated');
 await page.waitForFunction(()=>location.hash==='#/notes'&&document.querySelectorAll('.crew-note-card').length===6);
 await page.getByRole('button',{name:'Edit bucket NETWORK'}).click();
 await page.getByRole('dialog',{name:'Edit bucket'}).waitFor();
 await close();await dialog().waitFor({state:'hidden'});
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 await edit();
 assert.equal(await dialog().getByRole('button',{name:'Save note'}).isDisabled(),true,'Save waits for a change');
 await noteBody().fill('Use concrete examples and short sentences.');
 assert.equal(await dialog().getByRole('button',{name:'Save note'}).evaluate(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true,'Save is on screen after an edit');
 await dialog().getByLabel('Reason for change',{exact:true}).fill('Synthetic refinement');
 await dialog().getByRole('button',{name:'Save note'}).click();await saved();
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 await dialog().getByRole('button',{name:'History'}).click();
 const original=dialog().locator('.crew-version').filter({has:page.locator('summary').filter({hasText:/Revision 1 ·/})});
 await original.locator('summary').first().click();
 await original.getByRole('button',{name:'Restore as new revision'}).click();await saved();
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 assert.equal(await dialog().locator('.crew-prose').innerText(),'Write plainly for independent founders.');
 await dialog().getByRole('button',{name:'Archive note'}).click();await saved();
 assert.equal(await page.getByRole('button',{name:/Synthetic launch voice/}).count(),0);
 await page.getByRole('link',{name:'Archive',exact:true}).click();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Archive'}).waitFor();
 await page.getByRole('tab',{name:/^Notes \(/}).click();
 await page.waitForURL('**/#/archive?tab=notes');
 await page.getByRole('searchbox',{name:'Search archived notes by title'}).fill('launch voice');
 await page.locator('.crew-archive-row').filter({hasText:'Synthetic launch voice'}).getByText(/^Archived today at .+ · /).waitFor();
 await page.locator('.crew-archive-row').filter({hasText:'Synthetic launch voice'}).getByRole('button',{name:'Restore Synthetic launch voice'}).click();
 await page.getByText('Restored. Prior approvals were not reactivated.').waitFor();
 await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:'New task'}).click();
 await dialog().getByLabel('Title',{exact:true}).fill('Synthetic launch post');
 await dialog().getByLabel('Description',{exact:true}).fill('Introduce our product in our voice.');
 await dialog().getByLabel('Assigned agent',{exact:true}).selectOption({label:'Network'});
 const labels=dialog().getByLabel('Labels',{exact:true});
 await labels.fill('Network');await labels.press('Enter');
 await labels.fill('Launch,');
 await dialog().getByRole('button',{name:'Remove label Network'}).waitFor();
 await dialog().getByRole('button',{name:'Remove label Launch'}).waitFor();
 await dialog().getByLabel('Draft for review',{exact:true}).fill('A synthetic draft for the owner to publish manually.');
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 await page.getByRole('button',{name:/Synthetic launch post/}).click();
 await dialog().getByRole('button',{name:'Send draft for approval'}).click();await saved();
 await page.locator('.crew-human').filter({hasText:'Human'}).waitFor();
 await snap('crew-board-desktop');
 await page.getByRole('link',{name:/^Approvals/}).click();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Approvals'}).waitFor();
 const reviewCard=page.getByRole('button',{name:'Review draft: Synthetic launch post'});
 assert.equal(await reviewCard.locator('a, button, input, select, textarea').count(),0,'the Approvals card holds no other controls');
 await reviewCard.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');
 assert.equal(await reviewCard.evaluate(e=>e===document.activeElement&&e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none'),true,'the Approvals card shows keyboard focus');
 await snapView('crew-approvals-focus-1440');await page.keyboard.press('Enter');
 assert.equal(await dialog().locator('.crew-draft-snapshot').innerText(),'A synthetic draft for the owner to publish manually.');
 await dialog().getByLabel('Decision note').fill('Ready for manual publishing.');
 await dialog().getByRole('button',{name:'Approve draft',exact:true}).click();await saved();
 await page.getByRole('heading',{name:'Nothing waiting for your review'}).waitFor();
 await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Tasks'}).waitFor();
 assert.equal(await page.locator('.crew-column').filter({has:page.getByRole('heading',{name:/In progress/})}).locator('.crew-task-card').count(),1);
 await page.getByRole('button',{name:/Synthetic launch post/}).click();
 const taskDialogHeight=()=>dialog().evaluate(d=>Math.round(d.getBoundingClientRect().height));
 const editHeight=await taskDialogHeight();
 await dialog().getByRole('tab',{name:'Reviews'}).click();
 assert.equal(await taskDialogHeight(),editHeight,'Reviews tab keeps the dialog height');
 await dialog().getByRole('tab',{name:'Activity'}).click();
 assert.equal(await taskDialogHeight(),editHeight,'Activity tab keeps the dialog height');
 // Comments (0.24.0): only comments, with the box; the address follows the tab.
 await dialog().getByRole('tab',{name:/^Comments/}).click();
 assert.equal(await taskDialogHeight(),editHeight,'Comments tab keeps the dialog height');
 await page.waitForFunction(()=>location.hash.endsWith('?tab=comments'));
 await dialog().getByLabel('Add a comment').fill('Owner completed the external action manually.');
 await dialog().getByRole('button',{name:'Add comment',exact:true}).click();
 await dialog().getByText('Owner completed the external action manually.',{exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('dialog [role=tab]')].some(t=>t.textContent==='Comments1'),null,{timeout:5000}).catch(async()=>assert.fail('the tab counts comments: '+await dialog().getByRole('tablist',{name:'Record views'}).innerText()));
 await page.reload();
 await dialog().getByRole('list',{name:'Comments'}).getByText('Owner completed the external action manually.',{exact:true}).waitFor();
 await dialog().getByRole('tab',{name:'Activity'}).click();
 await dialog().locator('.crew-timeline strong').filter({hasText:/^Comment$/}).first().waitFor();
 assert.equal(await dialog().getByText('task.comment',{exact:true}).count(),0,'Activity uses plain labels');
 await dialog().getByRole('tablist',{name:'Record views'}).getByRole('tab',{name:'Edit',exact:true}).click();
 // Status has the standard help, which explains why Needs review can't be picked; focus shows the hint.
 await dialog().getByRole('button',{name:'What do the statuses mean?',exact:true}).click();
 assert.match(await dialog().locator('.crew-help-popover').innerText(),/Pick any status except Needs review/);
 await page.keyboard.press('Escape');await dialog().locator('.crew-help-popover').waitFor({state:'hidden'});
 assert.equal(await dialog().count(),1,'Escape closes the help, not the task');
 await dialog().getByLabel('Status',{exact:true}).focus();
 await dialog().getByText('Needs review is set by requesting approval for a saved draft, not by hand.',{exact:true}).waitFor();
 await dialog().getByLabel('Status',{exact:true}).selectOption('done');
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 assert.equal(await page.locator('.crew-column').filter({has:page.getByRole('heading',{name:/Done/})}).locator('.crew-task-card').count(),1);
 // Related is one component: link a task from a note's Read view; the task lists the note under Linked from.
 await page.getByRole('navigation').getByRole('link',{name:'Notes',exact:true}).click();
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 {const related=dialog().getByRole('group',{name:'Related'});
 await related.getByText('No related items',{exact:true}).waitFor();
 await related.getByRole('button',{name:'What are related tasks and notes?'}).waitFor();
 await related.getByLabel('Link a task or note').fill('launch post');
 await related.getByRole('button',{name:'Task Synthetic launch post',exact:true}).click();
 await related.getByRole('button',{name:'Remove Synthetic launch post',exact:true}).waitFor();
 await dialog().getByRole('button',{name:'Save note',exact:true}).click();await saved();}
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 await dialog().getByRole('group',{name:'Related'}).getByRole('list',{name:'Links'}).getByRole('link',{name:'Synthetic launch post'}).waitFor();
 await close();await dialog().waitFor({state:'hidden'});
 await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:/Synthetic launch post/}).click();
 await dialog().getByRole('group',{name:'Related'}).getByRole('list',{name:'Linked from'}).getByRole('link',{name:'Synthetic launch voice'}).waitFor();
 await close();await dialog().waitFor({state:'hidden'});
 // Global search: live grouped results, keyboard choice, the results page, reload and Back.
 const searchBox=page.getByRole('combobox',{name:'Search Crew'});
 const results=page.getByRole('listbox',{name:'Search results'});
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 await page.keyboard.press('/');
 assert.equal(await searchBox.evaluate(e=>e===document.activeElement),true,'/ focuses search');
 await searchBox.pressSequentially('synthetic laun',{delay:15});
 await results.getByRole('group',{name:'Tasks'}).getByRole('option',{name:/Synthetic launch post/}).waitFor();
 await results.getByRole('group',{name:'Notes'}).getByRole('option',{name:/Synthetic launch voice/}).waitFor();
 assert.ok(await results.locator('mark').count()>0,'matches are highlighted');
 assert.equal(await results.locator('script,img').count(),0);
 await snapView('crew-search-popup-1440');
 await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await dialog().waitFor();
 assert.match(page.url(),/#\/tasks\/synthetic-launch-post-[a-z0-9]{15}$/,'a task result opens at its path');
 await close();await dialog().waitFor({state:'hidden'});
 await page.waitForURL('**/#/tasks');
 await searchBox.fill('netw');
 await results.getByRole('group',{name:'Agents'}).getByRole('option',{name:/Network/}).click();
 await page.getByRole('dialog',{name:'Edit agent'}).waitFor();
 await close();await dialog().waitFor({state:'hidden'});
 await searchBox.fill('synthetic');
 await results.getByRole('option',{name:/See all results/}).waitFor();
 await searchBox.press('Enter');
 await page.waitForURL('**/#/search?q=synthetic');
 const allResults=page.getByRole('list',{name:'Tasks and notes'});
 await allResults.getByRole('button',{name:/Synthetic launch voice/}).waitFor();
 await allResults.getByRole('button',{name:/Synthetic launch post/}).waitFor();
 assert.match(await page.title(),/^Search/);
 await page.reload();
 await allResults.getByRole('button',{name:/Synthetic launch voice/}).waitFor();
 assert.equal(await searchBox.inputValue(),'synthetic','reload keeps the query');
 await page.getByRole('checkbox',{name:'Include archived'}).check();
 await page.getByText('No archived tasks or notes match.').waitFor();
 await snap('crew-search-page-1440');
 await allResults.getByRole('button',{name:/Synthetic launch voice/}).click();
 await dialog().getByRole('heading',{name:'Synthetic launch voice'}).waitFor();
 await close();await dialog().waitFor({state:'hidden'});
 await page.waitForURL('**/#/search?q=synthetic');
 await page.evaluate(()=>{location.hash='#/search?q=a&x=1';});
 await page.getByText(/This search address isn't complete/).waitFor();
 await page.goBack();
 await page.waitForURL('**/#/search?q=synthetic');
 await allResults.getByRole('button',{name:/Synthetic launch voice/}).waitFor();
 // Phones: an icon beside Refresh opens the field over the logo row.
 await page.setViewportSize({width:390,height:844});
 const searchToggle=page.getByRole('button',{name:'Search',exact:true});
 assert.equal(await searchToggle.isVisible(),true,'search icon at 390');
 assert.equal(await searchBox.isVisible(),false,'field closed at 390');
 assert.equal(await page.getByRole('navigation').getByRole('link').count(),7,'seven phone menu items');
 const [toggleBox,refreshBox]=[await searchToggle.boundingBox(),await page.getByRole('button',{name:'Refresh',exact:true}).boundingBox()];
 assert.ok(toggleBox.x+toggleBox.width<=refreshBox.x&&Math.abs(toggleBox.y-refreshBox.y)<2,'search icon sits beside Refresh');
 await snap('crew-search-page-390');
 assert.equal(await overflow(),false,'search page overflow at 390');
 await searchToggle.click();
 await searchBox.waitFor({state:'visible'});
 assert.equal(await searchBox.evaluate(e=>e===document.activeElement&&getComputedStyle(e).fontSize),'16px','focused 16px phone field');
 await searchBox.fill('');
 await searchBox.pressSequentially('voice',{delay:15});
 await results.getByRole('option',{name:/Synthetic launch voice/}).waitFor();
 const popup=await page.locator('.crew-search-popup').boundingBox();
 assert.ok(popup.x>=0&&popup.x+popup.width<=390,'results fit at 390');
 assert.equal(await overflow(),false,'search results overflow at 390');
 await snapView('crew-search-popup-390');
 await page.keyboard.press('Escape');
 await results.waitFor({state:'hidden'});
 await page.keyboard.press('Escape');
 await searchBox.waitFor({state:'hidden'});
 assert.equal(await searchToggle.evaluate(e=>e===document.activeElement),true,'focus returns to the icon');
 await page.setViewportSize({width:1440,height:1000});
 // Bridge setup is configuration only: viewing/selecting never sends a probe.
 await page.getByRole('link',{name:'Connect an agent',exact:true}).click();
 await page.getByRole('heading',{name:'Connect an agent',exact:true,level:1}).waitFor();
 await page.getByText('./pocketcontext-crew skill',{exact:true}).waitFor();
 assert.equal(await page.getByText('/mcp').count(),0,'Install without a domain shows an MCP address');
 assert.equal(await page.getByRole('region',{name:'Connected apps'}).count(),0);
 await page.getByRole('button',{name:'Set up automatic wake-ups',exact:true}).click();
 const integration=page.getByRole('region',{name:'Grok Bot integration'});
 await integration.getByRole('combobox',{name:'Crew dispatcher',exact:true}).selectOption({label:'Build'});
 await page.getByText('Dispatcher changed. Connect its routine before enabling delivery.',{exact:true}).waitFor();
 await integration.getByRole('combobox',{name:'Dispatch path',exact:true}).selectOption('parent_bridge');
 await page.getByText('Dispatch path changed. Apply the current instructions and test again. Credentials were preserved.',{exact:true}).waitFor();
 // The select re-renders from the saved integration just after the toast appears.
 await page.waitForFunction(()=>[...document.querySelectorAll('select')].some(s=>s.value==='parent_bridge'),undefined,{timeout:5000});
 assert.equal(await integration.getByRole('combobox',{name:'Dispatch path',exact:true}).inputValue(),'parent_bridge');
 // One step at a time: close the dispatcher step just used, leaving only the first incomplete one.
 await integration.getByRole('button',{name:/Choose your dispatcher/}).click();
 await integration.getByRole('button',{name:'Copy setup prompt',exact:true}).waitFor();
 assert.equal(await integration.getByLabel('Connection test progress').count(),0,'Future steps show titles only');
 await snap('crew-parent-bridge-setup');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'Connect horizontal overflow at 390');
 await snap('crew-parent-bridge-setup-390');
 await page.setViewportSize({width:1440,height:1000});
 await integration.getByRole('button',{name:/Verify the connection/}).click();
 await integration.getByLabel('Connection test progress').waitFor();
 assert.equal(await integration.getByRole('button',{name:'Send test',exact:true}).isDisabled(),true);
 await integration.getByRole('button',{name:/Enable future notifications/}).click();
 assert.equal(await integration.getByRole('button',{name:'Enable delivery',exact:true}).isDisabled(),true);
 assert.equal(writeActions.includes('webhook.test'),false,'Setup controls unexpectedly sent a test');
 // Bot mappings: no placeholder reads as a name; a display name is saved as bot_name.
 await integration.getByText('Advanced settings and recovery',{exact:true}).click();
 const learnMapping=integration.getByRole('form',{name:'Learn routing'});
 await learnMapping.waitFor();
 assert.equal(await integration.getByText(/^(Grok Bot reference|Connected Grok Bot)$/).count(),0,'no placeholder bot names');
 await learnMapping.getByLabel('Grok Bot reference for Learn').fill('synthetic-learn-bot-reference-0001');
 await learnMapping.getByLabel('Bot display name for Learn (optional)').fill('Synthetic Learn Grok');
 const mappingWrite=page.waitForRequest(r=>r.url().endsWith('/api/crew/write')&&r.postDataJSON()?.action==='webhook.mapping.update');
 await learnMapping.getByRole('button',{name:'Save Learn mapping'}).click();
 assert.equal((await mappingWrite).postDataJSON().data.bot_name,'Synthetic Learn Grok');
 await learnMapping.locator('p').filter({hasText:'Synthetic Learn Grok'}).waitFor();
 await learnMapping.scrollIntoViewIfNeeded();
 await snapView('crew-bot-mapping-card');
 // Wake rules sit outside Advanced with recommended values and one Save; Reset only fills the form.
 const wakeRules=integration.getByRole('form',{name:'Wake rules'});
 assert.equal(await wakeRules.evaluate(f=>!!f.closest('details')),false,'wake rules outside Advanced');
 assert.equal(await wakeRules.getByRole('button',{name:'Reset to recommended'}).isDisabled(),true,'new installs use the recommended rules');
 assert.equal(await wakeRules.getByRole('button',{name:'Save wake rules'}).isDisabled(),true);
 const wakeWrites=writeActions.length;
 await wakeRules.getByRole('checkbox',{name:/^Owner comment/}).check();
 await wakeRules.getByText(/^Saving changed wake rules/).waitFor();
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`Wake rules horizontal overflow at ${width}`);
  if(process.env.CREW_SCREENSHOTS) await wakeRules.screenshot({path:path.join(process.env.CREW_SCREENSHOTS,'crew-wake-rules-'+width+'.png')});
 }
 await page.setViewportSize({width:1440,height:1000});
 await wakeRules.getByRole('button',{name:'Reset to recommended'}).click();
 assert.equal(await wakeRules.getByRole('checkbox',{name:/^Owner comment/}).isChecked(),false);
 assert.equal(await wakeRules.getByText(/^Saving changed wake rules/).count(),0);
 assert.equal(writeActions.length,wakeWrites,'Wake rules changed nothing before Save');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});
  for(const name of ['Home','Tasks','Notes','Approvals','Agents','Archive']){
   await page.getByRole('navigation').getByRole('link',{name:new RegExp('^'+name)}).click();
   await page.locator('nav a[aria-current=page]').filter({hasText:name}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`${name} horizontal overflow at ${width}`);
   if(name==='Tasks') {
    const searchWidth=await page.getByRole('searchbox',{name:'Search tasks',exact:true}).evaluate(e=>e.getBoundingClientRect().width);
    assert.ok(searchWidth>=200,`task search stays usable at ${width}: ${searchWidth}`);
    assert.equal(await page.locator('.crew-toolbar > select').evaluateAll(selects=>selects.every(e=>getComputedStyle(e).flexShrink==='0')),true,'filters wrap rather than shrink their labels');
   }
  }
  await page.getByRole('navigation').getByRole('link',{name:'Home',exact:true}).click();await page.getByRole('heading',{name:'Needs you',exact:true}).waitFor();await snap('crew-home-'+width);
  // A status tile filters to exactly its tasks and focuses that column.
  // The one-shot column query is consumed; the status filter remains. Back returns Home.
  await page.getByRole('link',{name:/^\d+ Done, show on the Tasks board$/}).click();
  await page.waitForURL(u=>u.hash==='#/tasks?status=done');
  await page.waitForFunction(()=>{const c=document.activeElement;if(!c?.matches('.crew-column')||!c.textContent.startsWith('Done'))return false;const r=c.getBoundingClientRect();return r.top>=0&&r.top<innerHeight&&r.left>=0&&r.right<=innerWidth;});
  assert.equal(await page.locator('.crew-column').count(),4,`all columns at ${width}`);
  await page.waitForTimeout(250);await snapView('crew-board-column-'+width);
  await page.locator('.crew-column-highlight').waitFor({state:'detached'});
  await page.goBack();await page.getByRole('heading',{name:'Needs you',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>location.hash),'#/');
  if(width<1440){
   // Help opens on tap, stays on screen, and the Guide is reachable from Home.
   await page.getByRole('button',{name:'What is Home?',exact:true}).click();
   const pop=page.locator('.crew-help-popover');await pop.waitFor();
   const box=await pop.boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=width,`help popover fits at ${width}`);
   const tap=await page.getByRole('button',{name:'What is Home?',exact:true}).boundingBox();
   assert.ok(tap.width>=32&&tap.height>=32,'help tap target');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`help overflow at ${width}`);
   await snapView('crew-help-popover-'+width);
   await page.keyboard.press('Escape');await pop.waitFor({state:'hidden'});
   await page.getByRole('link',{name:'Read how it works'}).click();
   await page.waitForURL('**/#/guide');
   await page.getByRole('heading',{name:'How Crew works',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`Guide overflow at ${width}`);
   await snap('crew-guide-'+width);
   await page.getByRole('navigation').getByRole('link',{name:'Home',exact:true}).click();await page.getByRole('heading',{name:'Needs you',exact:true}).waitFor();
  }
  await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();await page.locator('nav a[aria-current=page]').filter({hasText:'Tasks'}).waitFor();await snap('crew-board-'+width);
  assert.equal(await page.locator('button:visible').filter({hasText:/^Sign out$/}).count(),1,`one Sign out at ${width}`);
  assert.equal(await page.getByRole('button',{name:'Refresh',exact:true}).isVisible(),true,`Refresh at ${width}`);
  assert.equal(await page.locator('.crew-topbar > span').isVisible(),width>680,`top bar at ${width}`);
 }
 // Phone sheets: reading first, edit second, Save pinned once something changed.
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('navigation').getByRole('link',{name:'Notes',exact:true}).click();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Notes'}).waitFor();
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 await dialog().getByRole('heading',{name:'Synthetic launch voice'}).waitFor();
 const sheet=await dialog().boundingBox();
 assert.deepEqual([sheet.x,sheet.y,sheet.width,sheet.height],[0,0,390,844],'overlay fills the phone screen');
 assert.equal(await dialog().getByRole('button',{name:'Copy link'}).evaluate(e=>e===document.activeElement),false,'Copy link is not focused');
 await snapView('crew-note-read-390');
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:1280,height:800});
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 await dialog().getByRole('tab',{name:'Edit',exact:true}).waitFor();
 await snapView('crew-note-read-desktop');
 const noteHeight=await dialog().evaluate(d=>Math.round(d.getBoundingClientRect().height));
 await edit();
 assert.equal(await dialog().evaluate(d=>Math.round(d.getBoundingClientRect().height)),noteHeight,'Edit keeps the note dialog height');
 await dialog().getByRole('tab',{name:'Read',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 await dialog().getByRole('tab',{name:'Edit',exact:true}).waitFor();
 await edit();
 const noteField=noteBody();
 assert.equal(await dialog().getByRole('button',{name:'Save note'}).isDisabled(),true,'Save waits for an edit');
 await noteField.fill(Array.from({length:60},(_,i)=>`Synthetic line ${i+1}`).join('\n'));
 const save=await dialog().getByRole('button',{name:'Save note'}).boundingBox();
 assert.ok(save.y+save.height<=844&&save.y>700,'Save stays pinned to the bottom of the sheet');
 assert.equal(await noteField.evaluate(e=>e.scrollHeight<=e.clientHeight+1),true,'the note field grows instead of scrolling');
 await dialog().getByLabel('Reason for change',{exact:true}).waitFor();
 await snapView('crew-note-edit-390');
 // Help inside a dialog: no dirty state change, Escape closes only the popover.
 await dialog().getByRole('button',{name:'Why give a reason for change?',exact:true}).click();
 await dialog().locator('.crew-help-popover').waitFor();
 await page.keyboard.press('Escape');
 await dialog().locator('.crew-help-popover').waitFor({state:'hidden'});
 assert.equal(await dialog().isVisible(),true,'Escape on help keeps the dialog');
 page.once('dialog',d=>d.accept());
 await close();
 await dialog().waitFor({state:'hidden'});
 await page.setViewportSize({width:1440,height:900});
 // A bookmarked deep link lands on its section after reload; unknown topics show the top.
 await page.evaluate(()=>{location.hash='#/guide/bucket';});
 await page.reload();
 await page.locator('#guide-bucket.current').waitFor();
 await page.waitForFunction(()=>{const r=document.getElementById('guide-bucket').getBoundingClientRect();return r.top>=-1&&r.top<window.innerHeight/2;});
 assert.ok(await page.evaluate(()=>window.scrollY>200),'deep link scrolled to its section');
 await page.evaluate(()=>{location.hash='#/guide/not-a-topic';});
 await page.locator('#guide-bucket.current').waitFor({state:'detached'});
 await page.getByRole('heading',{name:'How Crew works',exact:true}).waitFor();
 await page.waitForFunction(()=>window.scrollY<5);
 await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Tasks'}).waitFor();
 await page.getByRole('button',{name:/New task/}).click();
 await page.getByRole('dialog').waitFor();
 await page.mouse.click(5,5);
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:/New task/}).click();
 await page.getByRole('dialog').locator('input').first().fill('Unsaved synthetic title');
 page.once('dialog',d=>d.dismiss());
 await page.mouse.click(5,5);
 await page.waitForTimeout(100);
 assert.equal(await page.getByRole('dialog').isVisible(),true,'declining keeps the edits');
 page.once('dialog',d=>d.accept());
 await page.mouse.click(5,5);
 await page.getByRole('dialog').waitFor({state:'hidden'});
 const currentPage=()=>page.locator('nav a[aria-current=page]').innerText();
 await page.getByRole('navigation').getByRole('link',{name:'Agents',exact:true}).click();
 await page.waitForURL('**/#/agents');
 await page.reload();
 await page.locator('nav a[aria-current=page]').waitFor();
 assert.match(await currentPage(),/Agents/,'reload keeps the page');
 assert.match(await page.title(),/^Agents/);
 await page.getByRole('navigation').getByRole('link',{name:'Archive',exact:true}).click();
 await page.waitForURL('**/#/archive');
 await page.goBack();
 await page.waitForURL('**/#/agents');
 assert.match(await currentPage(),/Agents/,'Back returns to the page');
 await page.getByRole('navigation').getByRole('link',{name:'Notes',exact:true}).click();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Notes'}).waitFor();
 await page.getByRole('button',{name:/Synthetic launch voice/}).click();
 assert.equal(await dialog().locator('.crew-prose').innerText(),'Write plainly for independent founders.');await close();
 await page.setViewportSize({width:1280,height:800});
 await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:'New task'}).click();
 await dialog().getByLabel('Title',{exact:true}).fill('Synthetic long description');
 await dialog().getByLabel('Description',{exact:true}).fill(Array.from({length:40},(_,i)=>`Synthetic line ${i+1}`).join('\n'));
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 await page.getByRole('button',{name:/Synthetic long description/}).click();
 await dialog().getByRole('tablist',{name:'Description view'}).getByRole('tab',{name:'Edit',exact:true}).click();
 assert.equal(await dialog().getByLabel('Description',{exact:true}).evaluate(e=>e.scrollHeight<=e.clientHeight+2&&e.clientHeight>300),true,'a saved description opens at full height in Edit');
 await page.keyboard.press('Escape');
 await dialog().waitFor({state:'hidden'});
 // Agent filter: the assignment select lists agents with counts; the address keeps it across reload.
 const assignment=page.getByRole('combobox',{name:'Filter by assignment'});
 const cards=n=>page.waitForFunction(n=>document.querySelectorAll('.crew-task-card').length===n,n);
 await cards(2);
 await page.waitForFunction(()=>[...document.querySelectorAll('select[aria-label="Filter by assignment"] option')].some(o=>o.textContent==='Network (1)'));
 await assignment.selectOption({label:'Network (1)'});
 await page.waitForFunction(()=>/^#\/tasks\?agent=[a-z0-9]{15}$/.test(location.hash));
 await cards(1);
 const filteredBoard=page.url();
 await page.reload();
 await page.waitForFunction(()=>{const s=document.querySelector('select[aria-label="Filter by assignment"]');return s&&s.selectedOptions[0]?.textContent==='Network (1)';});
 await cards(1);
 assert.equal(page.url(),filteredBoard,'reload keeps the board filter');
 assert.equal(await page.locator('.crew-column').filter({has:page.getByRole('heading',{name:/Done/})}).locator('h2 span').innerText(),'1','column counts follow the filter');
 await snap('crew-board-agent-filter');
 await page.getByRole('button',{name:'Clear all',exact:true}).click();
 await page.waitForFunction(()=>location.hash==='#/tasks');
 await cards(2);
 // The assigned agent in a card footer filters by that agent without opening the card.
 await page.locator('.crew-task-card footer').getByRole('button',{name:'Filter by agent Network',exact:true}).click();
 await page.waitForFunction(()=>/^#\/tasks\?agent=[a-z0-9]{15}$/.test(location.hash));
 await cards(1);
 assert.equal(await dialog().count(),0,'clicking the card agent does not open the task');
 assert.equal(await assignment.locator('option:checked').innerText(),'Network (1)','the card agent and the assignment select share one filter');
 await page.getByRole('button',{name:'Clear all',exact:true}).click();
 await page.waitForFunction(()=>location.hash==='#/tasks');
 await cards(2);
 // Labels are independent keyboard controls; filtering combines with assignment and survives history/reload.
 await page.getByRole('button',{name:/Synthetic long description/}).click();
 const labelsInput=dialog().getByRole('combobox',{name:'Labels',exact:true});
 // Suggestions float over the form (0.24.0) and Escape closes only them.
 {const field=dialog().locator('.crew-labels-field');const before=await field.evaluate(e=>e.getBoundingClientRect().height);
 await labelsInput.fill('n');await dialog().getByRole('listbox').waitFor();
 assert.equal(await field.evaluate(e=>e.getBoundingClientRect().height),before,'label suggestions do not push the form');
 await labelsInput.press('Escape');await dialog().getByRole('listbox').waitFor({state:'hidden'});
 assert.equal(await dialog().count(),1,'Escape closes the suggestions, not the dialog');
 await labelsInput.fill('');}
 await labelsInput.fill('Synthetic-board');await labelsInput.press('Enter');
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 // Hovered filter chips tint and keep their text plain (no link underline).
 {const chip=page.getByRole('button',{name:'Filter by label Synthetic-board',exact:true});await chip.hover();
 assert.deepEqual(await chip.evaluate(e=>{const c=getComputedStyle(e);return {line:c.textDecorationLine,cursor:c.cursor,tint:c.boxShadow!=='none'};}),{line:'none',cursor:'pointer',tint:true},'a hovered chip is tinted, not underlined');}
 await page.getByRole('button',{name:'Filter by label Synthetic-board',exact:true}).focus();
 await page.keyboard.press('Enter');
 await cards(1);
 assert.equal(await dialog().count(),0,'label activation does not open the card');
 await page.waitForFunction(()=>location.hash==='#/tasks?label=Synthetic-board');
 await page.reload();await cards(1);
 // Panel filters show as removable chips and are counted on the one Filters button.
 await page.getByRole('button',{name:'Remove filter Label Synthetic-board',exact:true}).waitFor();
 const filtersButton=page.getByRole('button',{name:/^Filters/});
 assert.equal(await filtersButton.innerText(),'Filters · 1');
 await filtersButton.click();
 const filtersPanel=page.getByRole('group',{name:'Task filters'});
 assert.equal(await filtersPanel.getByRole('combobox',{name:'Filter by label'}).inputValue(),'synthetic-board');
 assert.equal(await filtersPanel.getByRole('combobox',{name:'Sort tasks'}).count(),0,'Sort is not a filter');
 assert.equal(await page.getByRole('combobox',{name:'Sort tasks'}).inputValue(),'updated');
 await page.keyboard.press('Escape');
 await filtersPanel.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Clear all',exact:true}).click();await cards(2);
 assert.equal(await filtersButton.innerText(),'Filters');
 await page.goBack();await cards(1);
 await page.goForward();await cards(2);
 // At 1024 the toolbar is one row: search, agent filter, Sort and Filters, nothing else.
 await page.setViewportSize({width:1024,height:800});
 const toolbar=await page.locator('.crew-toolbar').evaluate(t=>({
  controls:[...t.querySelectorAll('input,select,button')].filter(e=>e.offsetParent!==null).map(e=>e.getAttribute('aria-label')||e.textContent.trim()),
  oneRow:(r=>r.every(x=>x.top<r[0].bottom&&x.bottom>r[0].top))([...t.children].map(c=>c.getBoundingClientRect())),
 }));
 assert.deepEqual(toolbar,{controls:['Search tasks','Filter by assignment','Sort tasks','Filters'],oneRow:true},'one toolbar row at 1024');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'no horizontal scroll at 1024');
 await filtersButton.click();
 assert.equal(await filtersPanel.evaluate(p=>{const r=p.getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth;}),true,'Filters panel fits at 1024');
 await snap('crew-board-filters-1024');
 await page.getByRole('heading',{name:'Tasks',exact:true}).click();
 await filtersPanel.waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:844});
 await filtersButton.click();
 assert.equal(await filtersPanel.evaluate(p=>{const r=p.getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth;}),true,'Filters panel fits at phone width');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'board filters fit at phone width');
 await snap('crew-board-filters-390');
 await page.keyboard.press('Escape');
 // Sort stays a labelled toolbar control at phone width, outside Filters.
 const sortTasks=page.getByRole('combobox',{name:'Sort tasks'});
 assert.equal(await sortTasks.isVisible(),true,'Sort is visible at phone width');
 await sortTasks.selectOption('held');
 await page.waitForFunction(()=>location.hash==='#/tasks?sort=held');
 assert.equal(await filtersButton.innerText(),'Filters','sort is not counted as a filter');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,'sort fits at phone width');
 await sortTasks.selectOption('updated');
 await page.waitForFunction(()=>location.hash==='#/tasks');
 await page.setViewportSize({width:1280,height:800});
 // Won't do puts a card in the Done column; releases are plain labels (0.23.0): no release field, filter, header or token.
 await page.getByRole('button',{name:/Synthetic long description/}).click();
 await dialog().getByLabel('Status',{exact:true}).selectOption('wont_do');
 assert.equal(await dialog().getByLabel('Release',{exact:true}).count(),0,'no Release field');
 const releaseLabels=dialog().getByRole('combobox',{name:'Labels',exact:true});
 await releaseLabels.fill('release-0.19.0');await releaseLabels.press('Enter');
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 const doneColumn=page.locator('.crew-column').filter({has:page.getByRole('heading',{name:/Done/})});
 const dropped=doneColumn.getByRole('button',{name:/Synthetic long description/});
 await dropped.getByText("Won't do",{exact:true}).waitFor();
 // Every filter chip on a card filters: Won't do filters by status, not opening the card.
 await dropped.getByRole('button',{name:"Filter by status Won't do",exact:true}).click();
 await page.waitForFunction(()=>location.hash==='#/tasks?status=wont_do');
 assert.equal(await dialog().count(),0,'a status chip does not open the card');
 await page.getByRole('button',{name:"Remove filter Status Won't do",exact:true}).click();
 await page.waitForFunction(()=>location.hash==='#/tasks');
 assert.equal(await dropped.getByText(/Shipped in/).count(),0);
 assert.equal(await doneColumn.getByRole('group').count(),0,'Done is a plain list');
 await filtersButton.click();
 assert.equal(await filtersPanel.getByRole('combobox',{name:'Filter by release'}).count(),0);
 await page.keyboard.press('Escape');
 await dropped.getByRole('button',{name:'Filter by label release-0.19.0',exact:true}).click();
 await page.waitForFunction(()=>location.hash==='#/tasks?label=release-0.19.0');
 await cards(1);
 const releaseChip=page.getByRole('button',{name:'Remove filter Label release-0.19.0',exact:true});
 await releaseChip.waitFor();
 await snap('crew-board-release-label');
 // A 0.22.0 release link opens as its label.
 await page.evaluate(()=>{location.hash='#/tasks?release=0.19.0';});
 await page.reload();
 await releaseChip.waitFor();
 await cards(1);
 await releaseChip.click();
 await page.waitForFunction(()=>location.hash==='#/tasks');
 await cards(2);
 // release: in the search is plain text; label: filters and Enter makes it a chip.
 const taskSearch=page.getByRole('searchbox',{name:'Search tasks'});
 await taskSearch.fill('label:release-0.19.0');
 await cards(1);
 assert.equal(await page.evaluate(()=>location.hash),'#/tasks');
 await taskSearch.press('Enter');
 await page.waitForFunction(()=>location.hash==='#/tasks?label=release-0.19.0');
 await releaseChip.waitFor();
 assert.equal(await taskSearch.inputValue(),'');
 await page.getByRole('button',{name:'Clear all',exact:true}).click();
 await page.waitForFunction(()=>location.hash==='#/tasks');
 await cards(2);
 await page.getByRole('button',{name:/Synthetic long description/}).click();
 await dialog().getByLabel('Status',{exact:true}).selectOption('todo');
 await dialog().getByRole('button',{name:'Remove label release-0.19.0',exact:true}).click();
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 // Old page addresses redirect in place, keeping the query, on navigation and on load.
 await assignment.selectOption({label:'Network (1)'});
 await page.waitForFunction(()=>/^#\/tasks\?agent=[a-z0-9]{15}$/.test(location.hash));
 const agentQuery=await page.evaluate(()=>location.hash.split('?')[1]);
 await page.getByRole('navigation').getByRole('link',{name:'Agents',exact:true}).click();
 await page.waitForURL('**/#/agents');
 await page.evaluate(q=>{location.hash='#/team?'+q;},agentQuery);
 await page.waitForFunction(q=>location.hash==='#/tasks?'+q,agentQuery);
 await page.locator('nav a[aria-current=page]').filter({hasText:'Tasks'}).waitFor();
 await cards(1);
 // The redirect replaced the old address: Back goes straight to the previous page.
 await page.goBack();
 await page.waitForURL('**/#/agents');
 await page.goForward();
 await page.waitForFunction(q=>location.hash==='#/tasks?'+q,agentQuery);
 await cards(1);
 await page.evaluate(()=>history.replaceState(null,'','#/memory?sort=title'));
 await page.reload();
 await page.waitForFunction(()=>location.hash==='#/notes?sort=title');
 await page.locator('nav a[aria-current=page]').filter({hasText:'Notes'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('select[aria-label="Sort notes"]')?.value==='title');
 await page.waitForFunction(()=>document.querySelectorAll('.crew-note-card').length>0);
 await snap('crew-notes-1280');
 await page.evaluate(q=>history.replaceState(null,'','#/team?'+q),agentQuery);
 await page.reload();
 await page.waitForFunction(q=>location.hash==='#/tasks?'+q,agentQuery);
 await page.locator('nav a[aria-current=page]').filter({hasText:'Tasks'}).waitFor();
 await cards(1);
 // A task opened from the filtered board closes back to it; its link opens over the board.
 await page.getByRole('button',{name:/Synthetic launch post/}).click();
 await dialog().waitFor();
 await page.waitForFunction(()=>/^#\/tasks\/synthetic-launch-post-[a-z0-9]{15}$/.test(location.hash));
 const taskPath=await page.evaluate(()=>location.hash);
 await close();await dialog().waitFor({state:'hidden'});
 await page.waitForFunction(q=>location.hash==='#/tasks?'+q,agentQuery);
 await cards(1);
 await page.evaluate(p=>history.replaceState(null,'',p),taskPath);
 await page.reload();
 await dialog().waitFor();
 await page.locator('nav a[aria-current=page]').filter({hasText:'Tasks'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.crew-heading h1')?.textContent==='Tasks'&&document.querySelectorAll('.crew-column .crew-task-card').length===2);
 assert.equal(page.url().endsWith(taskPath),true,'the task link keeps its address');
 await snapView('crew-task-over-board-1280');
 await close();await dialog().waitFor({state:'hidden'});
 await page.waitForFunction(()=>location.hash==='#/tasks');
 await cards(2);
 // A long agent brief opens at full height (capped, with a scrollbar), and its card clamps to whole lines.
 await page.getByRole('navigation').getByRole('link',{name:'Agents',exact:true}).click();
 await page.waitForURL('**/#/agents');
 await page.locator('.crew-agent-card').filter({hasText:'Network'}).click();
 const longBrief=Array.from({length:45},(_,i)=>`Synthetic brief line ${i+1}`).join('\n');
 const briefEdit=()=>dialog().getByRole('tablist',{name:'Agent brief view'}).getByRole('tab',{name:'Edit',exact:true});
 await briefEdit().click();
 await dialog().getByLabel('Agent brief',{exact:true}).fill(longBrief);
 await dialog().getByRole('button',{name:'Save agent'}).click();await saved();
 const networkCard=page.locator('.crew-agent-card').filter({hasText:'Network'});
 assert.equal(await networkCard.locator('p').evaluate(p=>{const s=getComputedStyle(p),line=parseFloat(s.lineHeight);return s.whiteSpace==='pre-line'&&p.clientHeight<=line*7+1&&Math.abs(p.clientHeight/line-Math.round(p.clientHeight/line))<0.05&&p.scrollHeight>p.clientHeight;}),true,'the agent card clamps its brief to whole lines');
 // One paragraph (single line breaks) reads as one, as Markdown renders it.
 assert.equal(await networkCard.locator('p').getAttribute('title'),longBrief.replace(/\n/g,' '),'the card keeps the full brief on hover');
 await snapView('crew-agents-1280');
 await networkCard.click();
 // A filled-in brief opens in Read (rendered Markdown); Edit shows the source.
 await dialog().locator('.crew-md-preview').getByText('Synthetic brief line 1',{exact:false}).first().waitFor();
 await briefEdit().click();
 const briefField=dialog().getByLabel('Agent brief',{exact:true});
 assert.equal(await briefField.inputValue(),longBrief);
 // The field re-measures once the dialog has laid out (ResizeObserver), so wait for it.
 await page.waitForFunction(e=>e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY==='auto'&&e.offsetHeight>=Math.floor(innerHeight*0.7)-2,await briefField.elementHandle(),{timeout:5000}).catch(()=>{});
 {const m=await briefField.evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight,oh:e.offsetHeight,ih:innerHeight,oy:getComputedStyle(e).overflowY,mh:getComputedStyle(e).maxHeight,h:e.style.height,lh:getComputedStyle(e).lineHeight,font:getComputedStyle(e).fontFamily}));
 assert.ok(m.sh>m.ch&&m.oy==='auto'&&m.oh>=Math.floor(m.ih*0.7)-2,'a long agent brief opens at the cap with a scrollbar: '+JSON.stringify(m));}
 await snapView('crew-agent-brief-1280');
 await close();await dialog().waitFor({state:'hidden'});
 // A manually started agent's full session instructions open in their own
 // dialog: nothing overlaps them, other cards keep their height and the page
 // never scrolls sideways (they used to spill behind the neighbouring cards).
 await page.getByRole('button',{name:/New agent/}).click();
 await dialog().getByLabel('Name',{exact:true}).fill('synthetic-repo');
 await dialog().getByRole('radio',{name:'I start it myself (no webhook)'}).check();
 await dialog().getByRole('button',{name:'Save agent'}).click();await saved();
 const pageOverflows=()=>page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 // One click copies; a toast confirms, and View opens the instructions.
 const startButton=page.getByRole('button',{name:'Copy prompt for a coding agent as synthetic-repo'});
 const toast=page.locator('.crew-toast');
 const showInstructions={click:async()=>{
  await startButton.click();
  await toast.getByText('Copied the session prompt for synthetic-repo.').waitFor();
  await toast.getByRole('button',{name:'View'}).click();
  await toast.waitFor({state:'hidden'});
 }};
 await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base}).catch(()=>{});
 {const tile=page.locator('.crew-agent-tile').filter({has:startButton});const before=await tile.evaluate(e=>e.getBoundingClientRect().height);
 // The first click also opens the guide dialog with the copied prompt
 // (0.26.0): the card keeps its height, the prompt is shown in full without a
 // text area, Escape and × close it, and "Don't show this again" is saved on
 // the server, so it holds after a reload; ? opens it again.
 const otherTile=page.locator('.crew-agent-tile').filter({has:networkCard});
 assert.equal(await tile.evaluate(e=>e.getBoundingClientRect().height),await otherTile.evaluate(e=>e.getBoundingClientRect().height),'agent cards in a row keep equal height');
 await startButton.click();
 await toast.getByText('Copied the session prompt for synthetic-repo. Paste it into a new session in your coding agent.').waitFor();
 const guide=page.getByRole('dialog',{name:'Start a coding session as synthetic-repo'});
 await guide.getByText('Open your coding agent.').waitFor();
 assert.equal(await tile.evaluate(e=>e.getBoundingClientRect().height),before,'the guide never changes the card');
 assert.equal(await guide.locator('textarea').count(),0,'no text area in the guide');
 const promptBox=guide.getByLabel('Session prompt for synthetic-repo',{exact:true});
 assert.match(await promptBox.innerText(),/synthetic-repo/);
 assert.equal(await promptBox.evaluate(p=>p.scrollHeight<=p.clientHeight+1&&p.scrollWidth<=p.clientWidth+1),true,'the whole prompt is visible without scrolling');
 assert.equal(await guide.evaluate(d=>{const b=d.getBoundingClientRect();return d.contains(document.elementFromPoint(b.left+b.width/2,b.top+20));}),true,'the guide is on top');
 await snapView('crew-session-guide-1280');
 await page.keyboard.press('Escape');await guide.waitFor({state:'hidden'});
 await tile.getByRole('button',{name:'How to start a session as synthetic-repo'}).click();
 await guide.getByRole('button',{name:'Close'}).click();await guide.waitFor({state:'hidden'});
 await startButton.click();await guide.waitFor();
 await guide.getByRole('checkbox',{name:"Don't show this again"}).check();
 for(let i=0;i<50&&!writeActions.includes('settings.update');i++) await page.waitForTimeout(100);
 assert.ok(writeActions.includes('settings.update'),'the guide preference is saved on the server');
 await guide.getByRole('button',{name:'Got it'}).click();
 await guide.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Copy prompt for a coding agent as synthetic-repo','focus returns to the button');
 await toast.getByRole('button',{name:'Dismiss'}).click();await toast.waitFor({state:'hidden'});
 // Saved on the server, not in this browser.
 await page.evaluate(()=>localStorage.removeItem('pocketcontext.crew.session_guide_off'));
 await page.reload();await startButton.waitFor();
 await page.waitForTimeout(300);
 await startButton.click();
 await toast.getByText('Copied the session prompt for synthetic-repo.').waitFor();
 assert.equal(await guide.count(),0,'the guide stays off after a reload');
 assert.equal(await tile.evaluate(e=>e.getBoundingClientRect().height),before,'nothing stays on the card after Start a session');
 assert.equal(await tile.getByText(/Codex|Claude Code|Show full instructions/).count(),0,'no tool names or extra links on the card');
 await toast.getByRole('button',{name:'Dismiss'}).click();await toast.waitFor({state:'hidden'});}
 for(const width of [1024,1280,1440]){
  await page.setViewportSize({width,height:900});
  const networkHeight=await networkCard.evaluate(e=>e.getBoundingClientRect().height);
  assert.equal(await pageOverflows(),false,`Agents horizontal overflow at ${width}`);
  await showInstructions.click();
  const instructions=page.getByRole('dialog',{name:'Session instructions for synthetic-repo'});
  await instructions.getByRole('heading',{name:'1. Session name'}).waitFor();
  assert.equal(await instructions.evaluate(d=>{const b=d.getBoundingClientRect();const top=document.elementFromPoint(b.left+b.width/2,b.top+Math.min(b.height/2,200));return d.contains(top);}),true,`the instructions are on top at ${width}`);
  assert.equal(await instructions.evaluate(d=>d.scrollWidth<=d.clientWidth+1),true,`no sideways scroll in the instructions at ${width}`);
  assert.equal(await instructions.locator('pre').first().evaluate(p=>p.scrollWidth>p.clientWidth&&getComputedStyle(p).overflowX==='auto'),true,`the shell command scrolls in its own box at ${width}`);
  assert.equal(await pageOverflows(),false,`Agents horizontal overflow with instructions at ${width}`);
  if(width===1024) await snapView('crew-session-instructions-1024');
  await instructions.getByRole('button',{name:'Close dialog'}).click();
  await instructions.waitFor({state:'hidden'});
  assert.equal(await networkCard.evaluate(e=>e.getBoundingClientRect().height),networkHeight,`other cards keep their height at ${width}`);
  assert.equal(await page.getByRole('button',{name:'Copy prompt for a coding agent as synthetic-repo'}).evaluate(b=>!!b.closest('.crew-agent-tile')),true,'Start a session stays in its tile');
 }
 // Session instructions are saved in Crew: edit by hand, restore from history,
 // restore the default and copy prompts. The clipboard is captured in the page.
 {
  await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>{window.__copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied.push(t);}}});});
  const lastCopied=()=>page.evaluate(()=>window.__copied.at(-1));
  const readSession=async()=>(await page.request.post(base+'/api/crew/read',{headers:{Authorization:syntheticOwnerAuth},data:{collection:'session',agent:'synthetic-repo'}})).json();
  await showInstructions.click();
  const box=page.getByRole('dialog',{name:'Session instructions for synthetic-repo'});
  await box.getByText('These instructions are saved in Crew, not in the code. Edit them by hand, or ask an agent to rewrite them.').waitFor();
  await box.getByText('Built-in default · not edited yet').waitFor();
  assert.equal(await box.getByRole('button',{name:'Restore default'}).isDisabled(),true,'Restore default is off for the default');
  await box.getByRole('button',{name:'Rewrite with an agent'}).click();
  await box.getByRole('button',{name:'Rewrite prompt copied'}).waitFor();
  const rewrite=await lastCopied();
  assert.ok(rewrite.startsWith('Rewrite the Crew session instructions for agent "synthetic-repo" (revision 0).')&&rewrite.includes('expected_revision 0')&&rewrite.includes('session.update'),rewrite);
  await box.getByRole('button',{name:'Edit',exact:true}).click();
  const field=box.getByLabel(/Session instructions/);
  assert.ok((await field.inputValue()).includes('## 1. Session name'),'the editor opens on the current body');
  await field.fill('# Synthetic browser instructions\n\nWork on **one** synthetic task.');
  await box.getByRole('button',{name:'Save',exact:true}).click();
  await box.getByText(/^Revision 1 · edited by owner, /).waitFor();
  await box.getByRole('heading',{name:'Synthetic browser instructions'}).waitFor();
  await box.getByRole('heading',{name:'Agent brief'}).waitFor();
  if(process.env.CREW_SCREENSHOTS) await snapView('crew-session-instructions-edited');
  await box.getByRole('button',{name:'Restore default'}).click();
  await box.getByText(/^Revision 2 · edited by owner, .* · built-in default$/).waitFor();
  await box.getByRole('heading',{name:'1. Session name'}).waitFor();
  await box.getByRole('button',{name:'History'}).click();
  await box.getByText(/^Revision 1 · owner · /).waitFor();
  assert.equal(await box.getByRole('button',{name:'Restore revision 2'}).count(),0,'the current revision has no Restore');
  await box.getByRole('button',{name:'Restore revision 1'}).click();
  await box.getByText(/^Revision 3 · edited by owner, /).waitFor();
  await box.getByRole('heading',{name:'Synthetic browser instructions'}).waitFor();
  const latest=await readSession();
  assert.equal(latest.revision,3,'the session reads the restored revision');
  assert.equal(latest.body,'# Synthetic browser instructions\n\nWork on **one** synthetic task.');
  await box.getByRole('button',{name:'Copy prompt',exact:true}).click();
  await box.getByRole('button',{name:'Prompt copied',exact:true}).waitFor();
  assert.equal(await lastCopied(),latest.prompt,'Copy prompt copies the session prompt');
  // Reopening shows the latest revision, and the rewrite prompt follows it.
  await box.getByRole('button',{name:'Close dialog'}).click();
  await box.waitFor({state:'hidden'});
  await showInstructions.click();
  await box.getByText(/^Revision 3 · edited by owner, /).waitFor();
  await box.getByRole('button',{name:'Rewrite with an agent'}).click();
  await box.getByRole('button',{name:'Rewrite prompt copied'}).waitFor();
  assert.ok((await lastCopied()).includes('(revision 3)'),'the rewrite prompt names the latest revision');
  await box.getByRole('button',{name:'Close dialog'}).click();
  await box.waitFor({state:'hidden'});
  assert.ok(writeActions.filter(a=>a==='session.update').length===3,'three session.update writes: '+writeActions.join(','));
 }
 // Home offers the same one-click start for manual agents only (0.24.0), on a phone too.
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:844});
  await page.getByRole(width<700?'banner':'navigation').waitFor().catch(()=>{});
  await page.goto(base+'/#/');
  const row=page.getByRole('region',{name:'Start a session'});
  const homeStart=row.getByRole('button',{name:'Copy prompt for a coding agent as synthetic-repo'});
  assert.equal(await homeStart.innerText(),'Copy prompt for a coding agent');
  await row.getByText('Agent',{exact:true}).waitFor();
  assert.equal(await row.getByRole('button',{name:/^Copy prompt for a coding agent as /}).count(),1,'only manual agents appear on Home');
  await row.getByRole('button',{name:'How to start a session as synthetic-repo'}).click();
  const homeGuide=page.getByRole('dialog',{name:'Start a coding session as synthetic-repo'});
  await homeGuide.waitFor();
  if(width===390){
   const box=await homeGuide.boundingBox();
   assert.ok(box.x>=12&&box.x+box.width<=390-12,'the guide fits a phone with margins: '+JSON.stringify(box));
   assert.equal(await homeGuide.getByLabel('Session prompt for synthetic-repo',{exact:true}).evaluate(p=>p.scrollWidth<=p.clientWidth+1),true,'the prompt wraps on a phone');
   await snapView('crew-session-guide-390');
  }
  await page.keyboard.press('Escape');
  await homeGuide.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`Home overflow at ${width}`);
  await homeStart.click();
  await page.locator('.crew-toast').getByText('Copied the session prompt for synthetic-repo.').waitFor();
  await page.locator('.crew-toast').getByRole('button',{name:'Dismiss'}).click();
 }
 await page.setViewportSize({width:1280,height:800});
 // Search boxes draw one focus ring, on the box, never a second one on the field inside.
 await page.getByRole('navigation').getByRole('link',{name:'Tasks',exact:true}).click();
 await page.waitForURL('**/#/tasks');
 for(const [box,field] of [['.crew-global-field','.crew-global-field input'],['.crew-search','.crew-search input']]){
  await page.locator(field).first().focus();
  assert.equal(await page.locator(field).first().evaluate(e=>getComputedStyle(e).boxShadow),'none',`${field} draws no ring of its own`);
  assert.notEqual(await page.locator(box).first().evaluate(e=>getComputedStyle(e).boxShadow),'none',`${box} shows focus`);
 }
 await snapView('crew-search-focus-1280');
 await page.locator('.crew-search input').first().blur();
 // Attachments: a New task with two pasted screenshots (synthetic PNGs drawn
 // in the page) staged inline, created in one request; inline images, the
 // lightbox and the card thumbnail at 1440 and 390.
 const pasteShots=async(locator,shots)=>locator.evaluate(async(el,shots)=>{
  const dt=new DataTransfer();
  for(const [w,h,color] of shots){
   const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
   g.fillStyle=color;g.fillRect(0,0,w,h);g.fillStyle='#fff';g.font='48px sans-serif';g.fillText(`${w}x${h}`,30,80);
   const blob=await new Promise(r=>c.toBlob(r,'image/png'));
   dt.items.add(new File([blob],'image.png',{type:'image/png'}));
  }
  el.focus();el.setSelectionRange(el.value.length,el.value.length);
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
 },shots);
 const allLoaded=async selector=>page.waitForFunction(s=>{const i=[...document.querySelectorAll(s)];return i.length>0&&i.every(x=>x.complete&&x.naturalWidth>0);},selector,{timeout:15000});
 await page.getByRole('button',{name:'New task'}).click();
 await dialog().getByLabel('Title',{exact:true}).fill('Synthetic crash with screenshots');
 const desc=dialog().getByLabel('Description',{exact:true});
 await desc.fill('Steps:\n1. Open the editor\n');
 await pasteShots(desc,[[1200,700,'#2f6f4f']]);
 await page.waitForFunction(()=>/attachment:new-1\)$/.test(document.activeElement?.value||''));
 await desc.press('End');await desc.type('\n2. Press save\n');
 await pasteShots(desc,[[700,1000,'#8a4b2d']]);
 const descValue=await desc.inputValue();
 assert.match(descValue,/^Steps:\n1\. Open the editor\n!\[[^\]]+\]\(attachment:new-1\)\n2\. Press save\n!\[[^\]]+\]\(attachment:new-2\)$/,'pasted references land at the caret: '+JSON.stringify(descValue));
 assert.match(descValue,/!\[screenshot-\d{4}-\d{2}-\d{2}-1\.png\]\(attachment:new-1\)[\s\S]*!\[screenshot-\d{4}-\d{2}-\d{2}-2\.png\]\(attachment:new-2\)/,'two staged placeholders');
 await allLoaded('.crew-dialog .crew-file-tile-preview img');
 assert.equal(await dialog().locator('.crew-file-tile-preview img').count(),2,'two staged thumbnails');
 await dialog().getByRole('tablist',{name:'Description view'}).getByRole('tab',{name:'Read'}).click();
 await allLoaded('.crew-dialog .crew-inline-image img');
 assert.ok((await dialog().locator('.crew-inline-image img').first().getAttribute('src')).startsWith('blob:'),'staged previews are local');
 await snapView('attachments-new-task-staged-1440');
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 const card=page.locator('.crew-task-card').filter({hasText:'Synthetic crash with screenshots'});
 await allLoaded('.crew-task-card .crew-card-thumb img');
 assert.match(await card.locator('.crew-card-thumb img').getAttribute('src'),/thumb=320x0/);
 const thumbBox=await card.locator('.crew-card-thumb').boundingBox();
 assert.ok(thumbBox&&thumbBox.height>=90&&thumbBox.height<=100,'fixed-size card thumbnail');
 await snapView('attachments-board-thumbnail-1440');
 await card.click();
 await allLoaded('.crew-dialog .crew-inline-image img');
 const inline=dialog().locator('.crew-inline-image img');
 assert.equal(await inline.count(),2,'two inline images');
 assert.match(await inline.first().getAttribute('src'),/thumb=1600x0&token=/);
 assert.equal(await inline.first().getAttribute('width'),'1200');
 assert.equal(await inline.first().getAttribute('height'),'700');
 await allLoaded('.crew-dialog .crew-file-tile-preview img');
 await snapView('attachments-task-inline-1440');
 await dialog().locator('.crew-attachments').scrollIntoViewIfNeeded();
 await snapView('attachments-task-files-1440');
 await dialog().getByRole('button',{name:/^Open image: screenshot-.*-1\.png$/}).click();
 const viewer=page.getByRole('dialog',{name:'Image viewer'});
 await viewer.waitFor();
 await allLoaded('.crew-lightbox-stage img');
 assert.doesNotMatch(await viewer.locator('.crew-lightbox-stage img').getAttribute('src'),/thumb=/,'the lightbox shows the original');
 await page.keyboard.press('ArrowRight');
 await page.waitForFunction(()=>/-2\.png$/.test(document.querySelector('.crew-lightbox-stage img')?.alt||''));
 await allLoaded('.crew-lightbox-stage img');
 await snapView('attachments-lightbox-1440');
 // Download saves the original file under its own name in one click.
 {const name=await viewer.locator('.crew-lightbox-stage img').getAttribute('alt');
 const [file]=await Promise.all([page.waitForEvent('download'),viewer.getByRole('button',{name:`Download ${name}`}).click()]);
 assert.equal(file.suggestedFilename(),name,'the viewer downloads the original name');}
 await page.keyboard.press('Escape');
 await viewer.waitFor({state:'hidden'});
 assert.equal(await page.getByRole('dialog').count(),1,'Escape closes only the viewer');
 // Phone width: the dialog, inline images and lightbox fit without sideways scrolling.
 await page.setViewportSize({width:390,height:844});
 await allLoaded('.crew-dialog .crew-inline-image img');
 assert.equal(await dialog().evaluate(d=>d.scrollWidth<=d.clientWidth+1),true,'no sideways scroll at 390');
 const inlineWidth=await inline.first().evaluate(i=>i.getBoundingClientRect().width);
 assert.ok(inlineWidth<=390,'inline image fits the phone');
 await snapView('attachments-task-inline-390');
 await dialog().locator('.crew-attachments').scrollIntoViewIfNeeded();
 await snapView('attachments-task-files-390');
 await dialog().getByRole('button',{name:/^Open image: screenshot-.*-2\.png$/}).click();
 await viewer.waitFor();await allLoaded('.crew-lightbox-stage img');
 const shown=await viewer.locator('.crew-lightbox-stage img').boundingBox();
 assert.ok(shown&&shown.width<=390&&shown.height<=844,'lightbox image fits the phone');
 await snapView('attachments-lightbox-390');
 await viewer.getByRole('button',{name:'Close image viewer'}).click();
 await viewer.waitFor({state:'hidden'});
 await close();await dialog().waitFor({state:'hidden'});
 await allLoaded('.crew-task-card .crew-card-thumb img');
 await snapView('attachments-board-thumbnail-390');
 await page.setViewportSize({width:1440,height:1000});
 // File previews: a synthetic log, CSV, PDF (with JavaScript actions that must
 // never run), WebM and WAV on the same task, previewed at 1440 and 390;
 // pdf.js loads only when a PDF opens.
 const scripts=[],cspErrors=[],jsDialogs=[];
 page.on('request',r=>{if(r.resourceType()==='script'||/\/assets\/.*\.js$/.test(r.url()))scripts.push(r.url());});
 page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy|Refused to/i.test(m.text()))cspErrors.push(m.text());});
 page.on('dialog',d=>{jsDialogs.push(d.message());void d.dismiss();});
 const pdfFile=()=>{
  const objects=[
   '<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R /Names << /JavaScript << /Names [(t) 6 0 R] >> >> >>',
   '<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>',
   '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /AA << /O 6 0 R >> >>',
   null,
   '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
   "<< /S /JavaScript /JS (document.title='pdf script ran'; app.alert('pdf script ran');) >>",
   '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
   null,
  ];
  const stream=text=>{const s=`BT /F1 28 Tf 72 700 Td (${text}) Tj ET\n0.2 0.45 0.3 rg 72 400 300 200 re f\n`;return `<< /Length ${s.length} >>\nstream\n${s}endstream`;};
  objects[3]=stream('Synthetic PDF page 1');objects[7]=stream('Synthetic PDF page 2');
  let out='%PDF-1.4\n';const offsets=[];
  objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=out.length;
  out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
  out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out,'latin1');
 };
 const wavFile=()=>{
  const rate=8000,samples=rate/2,data=Buffer.alloc(samples*2);
  for(let i=0;i<samples;i++)data.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*8000),i*2);
  const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+data.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);
  h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(data.length,40);
  return Buffer.concat([h,data]);
 };
 // A short WebM recorded from a canvas in the page (skipped without MediaRecorder).
 const webm=await page.evaluate(async()=>{
  if(typeof MediaRecorder!=='function'||!MediaRecorder.isTypeSupported('video/webm;codecs=vp8'))return '';
  const c=document.createElement('canvas');c.width=160;c.height=120;const g=c.getContext('2d');
  const rec=new MediaRecorder(c.captureStream(15),{mimeType:'video/webm;codecs=vp8'});const parts=[];
  rec.ondataavailable=e=>parts.push(e.data);rec.start(100);let i=0;
  const timer=setInterval(()=>{g.fillStyle=`hsl(${i++*40},60%,45%)`;g.fillRect(0,0,160,120);},60);
  await new Promise(r=>setTimeout(r,900));clearInterval(timer);await new Promise(r=>{rec.onstop=r;rec.stop();});
  const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);
 });
 const csvLines=['id,name,comment'];
 csvLines.push('1,"Doe, Jane","said ""hi"""');
 for(let i=2;i<=650;i++)csvLines.push(`${i},Person ${i},note ${i}`);
 const files=[
  {name:'server.log',mimeType:'text/plain',buffer:Buffer.from(Array.from({length:80},(_,i)=>`2026-11-11T10:${String(i%60).padStart(2,'0')}:00Z INFO synthetic worker ${i} handled request /api/example?with=a-very-long-query-string-that-should-wrap-in-the-preview-when-wrapping-is-on`).join('\n')+'\n')},
  {name:'people.csv',mimeType:'text/csv',buffer:Buffer.from(csvLines.join('\r\n')+'\r\n')},
  {name:'spec.pdf',mimeType:'application/pdf',buffer:pdfFile()},
  {name:'tone.wav',mimeType:'audio/wav',buffer:wavFile()},
  ...(webm?[{name:'clip.webm',mimeType:'video/webm',buffer:Buffer.from(webm,'base64')}]:[]),
 ];
 const taskDialog=page.locator('.crew-dialog');
 await card.click();await taskDialog.waitFor();
 const titleBefore=await page.title();
 // Inline images stay within 70% of the screen height, and the reserved box
 // keeps the image's own ratio (the 700x1000 portrait is narrowed, not cut).
 await allLoaded('.crew-dialog .crew-inline-image img');
 const boxes=await taskDialog.locator('.crew-inline-image .crew-image-box').evaluateAll(els=>els.map(e=>{const b=e.getBoundingClientRect(),i=e.querySelector('img').getBoundingClientRect(),img=e.querySelector('img');return {w:b.width,h:b.height,iw:i.width,ih:i.height,ratio:img.naturalWidth/img.naturalHeight,vh:innerHeight};}));
 for(const b of boxes){
  assert.ok(b.h<=b.vh*0.7+1,'inline image height is capped: '+JSON.stringify(b));
  assert.ok(Math.abs(b.w-b.iw)<2&&Math.abs(b.h-b.ih)<2&&Math.abs(b.w/b.h-b.ratio)<0.02,'the reserved box matches the capped image: '+JSON.stringify(b));
 }
 assert.ok(boxes.some(b=>Math.abs(b.h-b.vh*0.7)<2),'the portrait screenshot is capped at 70vh: '+JSON.stringify(boxes));
 await taskDialog.locator('input[type=file]').setInputFiles(files);
 for(const f of files) await taskDialog.getByRole('button',{name:`Open ${f.name}`,exact:true}).waitFor({timeout:20000});
 assert.equal(scripts.some(u=>/\/assets\/pdf-/.test(u)),false,'pdf.js is not loaded before a PDF opens');
 const preview=page.getByRole('dialog',{name:/^File: /});
 const openFile=async name=>{await taskDialog.getByRole('button',{name:`Open ${name}`,exact:true}).click();await preview.waitFor();};
 const closePreview=async()=>{await page.keyboard.press('Escape');await preview.waitFor({state:'hidden'});};
 const previewFits=async label=>{const b=await preview.boundingBox();const vw=page.viewportSize().width;assert.ok(b&&b.x>=0&&b.x+b.width<=vw+1,`${label}: the preview fits the width`);assert.equal(await preview.evaluate(d=>d.scrollWidth<=d.clientWidth+1),true,`${label}: no sideways scroll in the dialog`);};
 // Text log.
 await openFile('server.log');
 await preview.locator('pre').filter({hasText:'synthetic worker 79'}).waitFor();
 assert.equal(await preview.getByRole('button',{name:'Wrap lines'}).getAttribute('aria-pressed'),'true');
 await previewFits('log 1440');await snapView('preview-log-1440');
 await closePreview();
 assert.equal(await page.getByRole('dialog').count(),1,'Escape closes only the preview');
 // CSV.
 await openFile('people.csv');
 await preview.getByText('Showing first 500 of 650 rows.').waitFor();
 assert.equal(await preview.locator('tbody tr').count(),500,'500 rows shown');
 assert.equal(await preview.getByRole('cell',{name:'said "hi"',exact:true}).count(),1,'quoted CSV field');
 await preview.locator('.crew-table-scroll').evaluate(e=>{e.scrollTop=600;});
 const headTop=await preview.locator('thead th').first().boundingBox(),scrollTop=await preview.locator('.crew-table-scroll').boundingBox();
 assert.ok(Math.abs(headTop.y-scrollTop.y)<3,'the header row stays on top');
 await previewFits('csv 1440');await snapView('preview-csv-1440');
 await closePreview();
 // PDF: lazy pdf.js chunk and same-origin worker; its JavaScript never runs.
 await openFile('spec.pdf');
 await preview.getByText('Page 1 of 2').waitFor({timeout:20000});
 await page.waitForFunction(()=>{const s=document.querySelector('.crew-pdf-stage');const c=document.querySelector('.crew-pdf-page');return s?.getAttribute('aria-busy')==='false'&&c&&c.width>0;},null,{timeout:20000});
 const inked=await preview.locator('canvas.crew-pdf-page').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<200)n++;return n;});
 assert.ok(inked>1000,'the PDF page is drawn: '+inked);
 const worker=scripts.find(u=>/\/assets\/pdf-worker-[A-Za-z0-9_-]+\.js$/.test(u));
 assert.ok(worker&&worker.startsWith(base),'the pdf.js worker is a same-origin asset: '+scripts.filter(u=>/pdf/.test(u)).join(' '));
 assert.ok(scripts.some(u=>/\/assets\/pdf-[A-Za-z0-9_-]+\.js$/.test(u)&&!/worker/.test(u)),'pdf.js is a lazily loaded chunk');
 const canvasBox=await preview.locator('canvas.crew-pdf-page').boundingBox(),stageBox=await preview.locator('.crew-pdf-stage').boundingBox();
 assert.ok(canvasBox.width<=stageBox.width&&canvasBox.width>=stageBox.width-40,'fit width by default');
 await previewFits('pdf 1440');await snapView('preview-pdf-1440');
 await preview.getByRole('button',{name:'Next page'}).click();
 await preview.getByText('Page 2 of 2').waitFor();
 await preview.getByRole('button',{name:'Zoom in'}).click();
 await page.waitForFunction(()=>document.querySelector('.crew-pdf-stage')?.getAttribute('aria-busy')==='false');
 assert.equal(await preview.locator('iframe, object, embed').count(),0,'no frames or plug-ins');
 await snapView('preview-pdf-page2-zoom-1440');
 await closePreview();
 assert.equal(await page.title(),titleBefore,'PDF JavaScript did not run (title)');
 assert.deepEqual(jsDialogs,[],'PDF JavaScript did not run (dialogs)');
 // Media players.
 await openFile('tone.wav');
 await page.waitForFunction(()=>{const a=document.querySelector('.crew-file-preview audio');return a&&a.readyState>=1&&a.duration>0.4;},null,{timeout:15000});
 await snapView('preview-audio-1440');
 await closePreview();
 if(webm){
  await openFile('clip.webm');
  await page.waitForFunction(()=>{const v=document.querySelector('.crew-file-preview video');return v&&v.readyState>=1&&v.videoWidth===160;},null,{timeout:15000});
  await snapView('preview-video-1440');
  await closePreview();
 }
 // Phone width: full-screen previews.
 await page.setViewportSize({width:390,height:844});
 for(const [name,ready,shot] of [['server.log','pre','preview-log-390'],['people.csv','table','preview-csv-390'],['spec.pdf','canvas.crew-pdf-page','preview-pdf-390']]){
  await openFile(name);
  await preview.locator(ready).waitFor();
  if(name==='spec.pdf') await page.waitForFunction(()=>document.querySelector('.crew-pdf-stage')?.getAttribute('aria-busy')==='false'&&document.querySelector('.crew-pdf-page')?.width>0,null,{timeout:20000});
  const b=await preview.boundingBox();
  assert.deepEqual([b.x,b.y,b.width,b.height],[0,0,390,844],`${name}: the preview fills the phone screen`);
  await previewFits(name+' 390');
  if(name==='spec.pdf'){const c=await preview.locator('canvas.crew-pdf-page').boundingBox();assert.ok(c.width<=390,'the PDF fits the phone width');}
  await snapView(shot);
  await closePreview();
 }
 await page.setViewportSize({width:1440,height:1000});
 await close();await dialog().waitFor({state:'hidden'});
 assert.deepEqual(cspErrors,[],'No Content Security Policy violations');
 assert.doesNotMatch(await page.title(),/pdf script ran/,'PDF JavaScript did not run');
 // One-time upload link: the owner creates it in a task dialog; a signed-out
 // phone opens it, sends two screenshots in one request, and the task shows
 // them. The token never appears in a request URL, a credential or storage,
 // and the used link refuses a second visit.
 await page.goto(base+'/#/tasks');
 await page.getByRole('button',{name:'New task'}).click();
 await dialog().getByLabel('Title',{exact:true}).fill('Synthetic phone upload');
 await dialog().getByRole('button',{name:'Save task'}).click();await saved();
 const phoneCard=page.locator('.crew-task-card').filter({hasText:'Synthetic phone upload'});
 await phoneCard.click();
 await dialog().getByRole('button',{name:'Get upload link'}).click();
 const linkBox=dialog().locator('.crew-upload-link-box');
 await linkBox.waitFor();
 const uploadAddress=(await linkBox.locator('code').innerText()).trim();
 assert.match(uploadAddress,/^http:\/\/[^/]+\/#\/upload\/[A-Za-z0-9]{43}$/,'upload address');
 const uploadToken=uploadAddress.split('/').pop();
 assert.equal(await linkBox.getByRole('link',{name:'Manage upload links'}).getAttribute('href'),'#/connect?section=files');
 await linkBox.scrollIntoViewIfNeeded();
 await snapView('upload-link-created-1440');
 await close();await dialog().waitFor({state:'hidden'});
 const phone=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const guest=await phone.newPage();
 const guestUrls=[],guestAuth=[],uploads=[];
 guest.on('pageerror',e=>errors.push('guest: '+e.message));
 guest.on('request',r=>{guestUrls.push(r.url());if(r.headers().authorization)guestAuth.push(r.url());if(r.url().endsWith('/api/crew/upload-link/upload'))uploads.push(r.url());});
 const guestSnap=async name=>{if(process.env.CREW_SCREENSHOTS) await guest.screenshot({path:path.join(process.env.CREW_SCREENSHOTS,name+'.png'),fullPage:true});};
 const guestFits=async w=>assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no sideways scroll at '+w);
 await guest.goto(uploadAddress);
 await guest.getByRole('heading',{name:'Add screenshots to: Synthetic phone upload'}).waitFor();
 assert.equal(await guest.getByLabel('Password',{exact:true}).count(),0,'no sign-in on the upload page');
 await guestFits(390);await guestSnap('upload-page-empty-390');
 const shotsBase64=await guest.evaluate(async()=>{
  const out=[];
  for(const [w,h,color] of [[900,1600,'#2d5f8a'],[1170,2532,'#7a3d6b']]){
   const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
   g.fillStyle=color;g.fillRect(0,0,w,h);g.fillStyle='#fff';g.font='64px sans-serif';g.fillText('phone '+w+'x'+h,40,120);
   out.push(c.toDataURL('image/png').split(',')[1]);
  }
  return out;
 });
 await guest.locator('#upload-input').setInputFiles(shotsBase64.map((b,i)=>({name:`phone-${i+1}.png`,mimeType:'image/png',buffer:Buffer.from(b,'base64')})));
 await guest.waitForFunction(()=>{const i=[...document.querySelectorAll('.upload-staged img')];return i.length===2&&i.every(x=>x.complete&&x.naturalWidth>0);});
 assert.equal(await guest.getByRole('list',{name:'Files to send'}).getByRole('listitem').count(),2);
 await guestFits(390);await guestSnap('upload-page-staged-390');
 await guest.setViewportSize({width:320,height:700});
 await guestFits(320);await guestSnap('upload-page-staged-320');
 await guest.setViewportSize({width:390,height:844});
 await guest.getByRole('button',{name:'Send 2 files'}).click();
 await guest.getByRole('heading',{name:'Done'}).waitFor();
 assert.equal(uploads.length,1,'one upload request for the batch');
 assert.equal(await guest.getByRole('list',{name:'Upload results'}).getByText('Saved').count(),2);
 assert.equal(await guest.getByRole('button',{name:/^Send/}).count(),0,'no second send');
 await guestSnap('upload-page-done-390');
 assert.ok(guestUrls.every(u=>!u.includes(uploadToken)||u===uploadAddress),'the token is never in a request URL');
 assert.deepEqual(guestAuth,[],'the upload page sends no credentials');
 assert.equal(await guest.evaluate(t=>JSON.stringify({...localStorage,...sessionStorage}).includes(t),uploadToken),false,'the token is not stored');
 await guest.reload();
 await guest.getByRole('heading',{name:'Upload link unavailable'}).waitFor();
 await guest.getByText('This link has expired or was already used. Ask for a new one.').waitFor();
 await guestSnap('upload-page-used-390');
 await phone.close();
 await phoneCard.click();
 await page.waitForFunction(()=>document.querySelectorAll('.crew-dialog .crew-file-tile-preview img').length===2);
 await allLoaded('.crew-dialog .crew-file-tile-preview img');
 await dialog().locator('.crew-attachments').scrollIntoViewIfNeeded();
 await snapView('upload-link-task-files-1440');
 await close();await dialog().waitFor({state:'hidden'});
 // File settings on the Connect page (Manage upload links' address): focused
 // once, then the address drops the section; usage, limit and the used link.
 await page.goto(base+'/#/connect?section=files');
 const fileSettings=page.getByRole('region',{name:'Files'});
 await page.waitForFunction(()=>document.activeElement?.id==='crew-file-settings');
 await page.waitForFunction(()=>location.hash==='#/connect');
 await fileSettings.getByText(/ of 5\.0 GB used$/).waitFor();
 await fileSettings.getByText(/^Recent used, expired or revoked links/).click();
 const recentLinks=fileSettings.getByRole('list',{name:'Recent upload links'});
 await recentLinks.getByRole('link',{name:'Synthetic phone upload'}).waitFor();
 assert.match(await recentLinks.innerText(),/Used · .* 2\/10 files/);
 assert.equal((await fileSettings.innerText()).includes(uploadToken),false,'settings never show a token');
 await fileSettings.scrollIntoViewIfNeeded();
 await snapView('file-settings-1440');
 await page.setViewportSize({width:390,height:844});
 await fileSettings.scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'settings fit at 390');
 await snapView('file-settings-390');
 await page.setViewportSize({width:1440,height:1000});
 // Compact claims keep full attribution available, without repeated Ready/assignee chips.
 const boardWrite=async(action,data,id,revision)=>{
  const response=await page.request.post(base+'/api/crew/write',{headers:{Authorization:syntheticOwnerAuth},data:{action,data,id,expected_revision:revision,reported_agent:'Synthetic · Codex · browser/1 · abcdef12'}});
  assert.equal(response.ok(),true,`synthetic ${action}`);return response.json();
 };
 const boardAgent=await boardWrite('agent.create',{name:'Synthetic-board-agent',kind:'external'});
 const boardTask=await boardWrite('task.create',{title:'Synthetic compact claim',assigned_agent:boardAgent.id,readiness:'ready',labels:['Synthetic-board-agent','Synthetic-board','Bug']});
 await boardWrite('task.claim',{assigned_agent:boardAgent.id},boardTask.id,boardTask.revision);
 await page.goto(base+'/#/tasks?label=synthetic-board');
 const claimCard=page.locator('.crew-task-card').filter({hasText:'Synthetic compact claim'});
 await claimCard.waitFor();
 assert.equal(await claimCard.getByText('Ready',{exact:true}).count(),0);
 assert.equal(await claimCard.getByRole('button',{name:'Filter by label Synthetic-board-agent'}).count(),0);
 const claimChip=claimCard.locator('.crew-claim-chip');
 assert.match(await claimChip.innerText(),/^Codex · (1h 59m|2h 0m) left$/);
 assert.match(await claimChip.getAttribute('title'),/Synthetic · Codex · browser\/1 · abcdef12.*Started.*Until/);
 await claimCard.click();await dialog().waitFor();
 await dialog().locator('.crew-claim-details').waitFor();
 assert.match(await dialog().locator('.crew-claim-details').innerText(),/browser\/1/);
 await close();await dialog().waitFor({state:'hidden'});
 // Every Home tile opens exactly the number it counted, including old Done and stale holds.
 for(const name of ['To do','In progress','Needs review','Done','on hold over 3 days']){
  await page.goto(base+'/#/');
  const tile=page.getByRole('link',{name:new RegExp('^\\d+ '+name+', show')});
  await tile.waitFor();const count=Number(await tile.locator('b').innerText());
  await tile.click();await page.getByRole('heading',{name:'Tasks',exact:true}).waitFor();
  await cards(count);
  await page.getByRole('button',{name:name==='on hold over 3 days'?'Remove filter On hold · over 3 days':'Remove filter Status '+name,exact:true}).waitFor();
  assert.equal(await page.locator('.crew-filter-count').innerText(),`${count} ${count===1?'task':'tasks'}`,`${name} tile count matches the board`);
 }
 // Review evidence and structured alternatives: only the frozen images, exact decisions.
 const reviewTask=await boardWrite('task.create',{title:'Synthetic review alternatives',draft:'Hook\nProblem\nSolution\n![First](attachment:new-1)\n![Second](attachment:new-2)',files:shotsBase64.map((content_base64,i)=>({name:`review-${i+1}.png`,content_base64}))});
 const reviewOptions=[{key:'a-linkedin',label:'Draft A · LinkedIn',body:'LinkedIn A'},{key:'a-x',label:'Draft A · X',body:'X A'},{key:'b-linkedin',label:'Draft B · LinkedIn',body:'LinkedIn B'},{key:'b-x',label:'Draft B · X',body:'X B'}];
 await boardWrite('review.request',{options:reviewOptions},reviewTask.id,reviewTask.revision);
 await page.goto(base+'/#/approvals');
 await page.getByRole('button',{name:'Review draft: Synthetic review alternatives'}).click();
 await dialog().getByRole('region',{name:'Files submitted for review'}).waitFor();
 const reviewTiles=dialog().getByRole('region',{name:'Files submitted for review'}).locator('.crew-file-tile');
 await allLoaded('.crew-dialog .crew-file-tiles img');
 assert.equal(await reviewTiles.count(),2,'each snapshot file appears once');
 assert.equal(await dialog().getByRole('region',{name:'Files submitted for review'}).locator('img').count(),2,'both snapshot images are visible');
 {const boxes=await reviewTiles.evaluateAll(t=>t.map(e=>{const b=e.getBoundingClientRect();return [Math.round(b.width),Math.round(b.height),Math.round(b.top)];}));
 assert.ok(boxes.every(b=>b[0]===boxes[0][0]&&b[1]===boxes[0][1]&&b[2]===boxes[0][2]),'equal tiles in one row: '+JSON.stringify(boxes));
 assert.ok(boxes[0][1]<=190,'a tile row stays short: '+JSON.stringify(boxes));}
 await snapView('review-file-tiles-1440');
 assert.equal(await dialog().locator('.crew-draft-snapshot p').first().evaluate(p=>getComputedStyle(p).whiteSpace),'pre-wrap','review line breaks are preserved');
 const optionApproval=dialog().getByRole('button',{name:'Approve selected options'});
 assert.equal(await optionApproval.isDisabled(),true,'undecided options cannot be approved');
 for(const option of reviewOptions) await dialog().getByRole('region',{name:option.label,exact:true}).getByRole('radio',{name:option.key.startsWith('a-')?'Approve':'Reject',exact:true}).check();
 await dialog().getByLabel('Note for Draft A · X (optional)').fill('Use this option');
 await optionApproval.click();await saved();
 await page.goto(base+'/#/tasks/'+reviewTask.id);
 await dialog().getByRole('tab',{name:'Activity',exact:true}).click();
 await dialog().getByText('Approved: Draft A · LinkedIn, Draft A · X; Rejected: Draft B · LinkedIn, Draft B · X',{exact:true}).waitFor();
 await dialog().getByRole('tab',{name:'Reviews',exact:true}).click();
 await dialog().getByText('Approved: Draft A · LinkedIn, Draft A · X; Rejected: Draft B · LinkedIn, Draft B · X',{exact:true}).waitFor();
 await close();await dialog().waitFor({state:'hidden'});
 // HTML attachments open in a sandboxed preview (0.26.0): the page's own
 // scripts and links work, but it cannot reach Crew, the network, the top
 // window, new windows or forms, in the frame or in a new tab.
 {
 const hostile=`<!doctype html><html><head><title>Synthetic hostile page</title></head><body>
<button id="press" onclick="this.textContent='pressed'">press</button><a id="jump" href="#below">jump</a><p id="below">below</p>
<form id="post" method="post" action="/api/crew/write"><input name="action" value="task.create"></form>
<pre id="out">running</pre><script>
const out=[];const probe=(name,fn)=>{try{const v=fn();out.push(name+':'+(v===undefined||v===null||v===''?'empty':'open'));}catch(e){out.push(name+':blocked');}};
probe('cookie',()=>document.cookie);
probe('localStorage',()=>localStorage.length+1);
probe('parent',()=>parent.document.title);
probe('top',()=>{if(window===top)return '';top.location.href='/#/hacked';return 'x';});
probe('open',()=>window.open('about:blank'));
probe('form',()=>{document.getElementById('post').submit();return '';});
Promise.all([fetch('/api/crew/read',{method:'POST',body:'{}'}).then(()=>'apiFetch:open',()=>'apiFetch:blocked'),
 fetch('https://example.com/').then(()=>'netFetch:open',()=>'netFetch:blocked')]).then(r=>{out.push(...r);out.push('origin:'+self.origin);document.getElementById('out').textContent=out.join(' ');});
</script></body></html>`;
 const htmlTask=await boardWrite('task.create',{title:'Synthetic HTML prototype',files:[{name:'hostile.html',content_base64:Buffer.from(hostile).toString('base64')}]});
 const crewRequests=[];const watchCrew=r=>{if(r.url().startsWith(base+'/api/')&&!/attachment(-preview)?\b/.test(r.url()))crewRequests.push(r.url());};
 await page.goto(base+'/#/tasks/'+htmlTask.id);await page.reload();
 await dialog().getByRole('button',{name:'Open hostile.html'}).click();
 const viewer=page.getByRole('dialog',{name:'File: hostile.html'});
 await viewer.getByText('Preview runs isolated from Crew').waitFor();
 const frameEl=viewer.locator('iframe[title="Preview of hostile.html"]');
 assert.equal(await frameEl.getAttribute('sandbox'),'allow-scripts','only allow-scripts');
 page.on('request',watchCrew);
 const writesBefore=writeActions.length;const urlBefore=page.url();
 const frame=page.frameLocator('iframe[title="Preview of hostile.html"]');
 await frame.locator('#out').filter({hasText:'origin:'}).waitFor();
 const results=await frame.locator('#out').innerText();
 for(const probe of ['cookie:blocked','localStorage:blocked','parent:blocked','top:blocked','open:empty','apiFetch:blocked','netFetch:blocked','origin:null'])
  assert.ok(results.includes(probe),`sandboxed preview: ${probe} in ${results}`);
 // Its own scripts and links work inside the frame.
 await frame.locator('#press').click();await frame.getByText('pressed').waitFor();
 await frame.locator('#jump').click();
 await page.waitForTimeout(300);
 assert.equal(page.url(),urlBefore,'the preview never navigates Crew');
 assert.equal(writeActions.length,writesBefore,'the preview writes nothing');
 assert.deepEqual(crewRequests,[],'the preview calls no Crew API');
 await viewer.getByRole('button',{name:'Mobile'}).click();
 assert.equal(Math.round(await frameEl.evaluate(f=>f.getBoundingClientRect().width)),390,'mobile width');
 await snapView('html-preview-1440');
 // Open in new tab keeps the sandbox.
 const tabUrl=await viewer.getByRole('link',{name:'Open in new tab'}).getAttribute('href');
 const tab=await browser.newPage();
 await tab.goto(base+tabUrl);
 assert.deepEqual(await tab.evaluate(()=>{let storage='open';try{localStorage.length;}catch{storage='blocked';}return [self.origin,storage];}),['null','blocked'],'a new tab is sandboxed too');
 await tab.locator('#out').filter({hasText:'origin:null'}).waitFor();
 await tab.close();
 page.off('request',watchCrew);
 await viewer.getByRole('button',{name:'Close file preview'}).click();
 await close();await dialog().waitFor({state:'hidden'});
 }
 // Legacy snapshots can contain local paths; simulate only their read response.
 const legacyTask=await boardWrite('task.create',{title:'Synthetic legacy missing image',draft:'Legacy draft'});
 const legacyReview=await boardWrite('review.request',{},legacyTask.id,legacyTask.revision);
 await page.route('**/api/crew/read',async route=>{
  const response=await route.fetch();const body=await response.json();
  if(Array.isArray(body.items)) for(const row of body.items) if(row.id===legacyReview.id) row.draft='/workspace/unattached.png';
  await route.fulfill({response,json:body});
 });
 await page.goto(base+'/#/approvals');
 await page.getByRole('button',{name:'Review draft: Synthetic legacy missing image'}).click();
 await dialog().getByRole('alert').filter({hasText:"This draft mentions files that aren't attached to Crew"}).waitFor();
 await close();await dialog().waitFor({state:'hidden'});
 await page.unroute('**/api/crew/read');
 // Artifacts: Share as artifact from a note, publish on Shared, read the link signed out, snapshot, replace, revoke.
 const shareBucket=await boardWrite('bucket.create',{name:'SHARE',purpose:'Synthetic artifacts'});
 const shareNote=await boardWrite('note.create',{bucket:shareBucket.id,title:'Synthetic partner pricing',body:'Plans start at **10**.\n\n![chart](attachment:new-1)\n\n[board](#/tasks)',files:[{name:'chart.png',content_base64:shotsBase64[0]}]});
 await page.goto(base+'/#/notes/'+shareNote.id);await page.reload();
 await dialog().getByRole('button',{name:'Share as artifact'}).click();
 await page.waitForFunction(()=>/^#\/shared\/[a-z0-9]{15}$/.test(location.hash));
 const artifactCard=page.locator('.crew-artifact-focused');
 await artifactCard.getByRole('heading',{name:'Synthetic partner pricing'}).waitFor();
 await artifactCard.getByText('Anyone with this link can view it until you revoke it or it expires.').waitFor();
 const artifactId=(await page.evaluate(()=>location.hash)).split('/').pop();
 await artifactCard.getByRole('button',{name:'Publish',exact:true}).click();
 const artifactLinkBox=artifactCard.getByRole('textbox',{name:/^Link to /});
 await artifactLinkBox.waitFor();
 const artifactLink=await artifactLinkBox.inputValue();
 assert.match(artifactLink,/\/a\/[A-Za-z0-9]{32}$/,'a 32-character token link');
 await snap('crew-shared');
 // Open shows the public page in a new tab and is not counted as a recipient view.
 await artifactCard.getByText('0 views').waitFor();
 const [ownerTab]=await Promise.all([page.context().waitForEvent('page'),artifactCard.getByRole('link',{name:/^Open .* in a new tab$/}).click()]);
 await ownerTab.waitForLoadState();
 assert.equal(ownerTab.url(),artifactLink);
 await ownerTab.getByRole('heading',{name:'Synthetic partner pricing'}).waitFor();
 await ownerTab.close();
 await page.reload();
 await artifactCard.getByText('0 views').waitFor();
 const visitor=await browser.newContext({viewport:{width:390,height:844}});
 const visitorPage=await visitor.newPage();
 const visitorRequests=[];visitorPage.on('request',r=>visitorRequests.push(r.url()));
 const shared=await visitorPage.goto(artifactLink);
 assert.equal(shared.status(),200);
 assert.equal(shared.headers()['referrer-policy'],'no-referrer');
 assert.match(shared.headers()['x-robots-tag'],/noindex/);
 await visitorPage.getByRole('heading',{name:'Synthetic partner pricing'}).waitFor();
 await visitorPage.waitForFunction(()=>{const i=[...document.images];return i.length===1&&i[0].complete&&i[0].naturalWidth>0;});
 assert.equal(await visitorPage.locator('a').count(),0,'no links back into Crew');
 assert.equal(await visitorPage.locator('script').count(),0,'no script on the public page');
 assert.equal(await visitorPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'public page fits a phone');
 assert.ok(visitorRequests.every(u=>u.includes('/a/')),'the public page loads only its own files');
 if(process.env.CREW_SCREENSHOTS) await visitorPage.screenshot({path:path.join(process.env.CREW_SCREENSHOTS,'crew-artifact-public-390.png'),fullPage:true});
 await boardWrite('note.update',{body:'Changed after sharing'},shareNote.id,shareNote.revision);
 await visitorPage.reload();await visitorPage.getByText('Plans start at').waitFor();
 assert.equal(await visitorPage.getByText('Changed after sharing').count(),0,'source edits never change the page');
 await artifactCard.getByRole('button',{name:'Edit draft'}).click();
 await artifactCard.getByRole('textbox',{name:'Artifact page',exact:true}).fill('Plans start at 12.');
 await artifactCard.getByRole('button',{name:'Save draft'}).click();
 await artifactCard.getByText('Changes not live').waitFor();
 await visitorPage.reload();await visitorPage.getByText('Plans start at 10.').waitFor();
 await artifactCard.getByRole('button',{name:'Update content (same link)'}).click();
 await artifactCard.getByText('Changes not live').waitFor({state:'hidden'});
 assert.equal(await artifactCard.getByRole('textbox',{name:/^Link to /}).inputValue(),artifactLink,'replace keeps the link');
 await visitorPage.reload();await visitorPage.getByText('Plans start at 12.').waitFor();
 // A live card shows expiry and last opened; Set expiry saves a date.
 await artifactCard.getByText(/no expiry/).waitFor();await artifactCard.getByText(/last opened/).waitFor();
 await artifactCard.getByRole('button',{name:'Set expiry'}).click();
 await artifactCard.getByRole('combobox',{name:'Link expires'}).selectOption('30');
 await artifactCard.getByRole('button',{name:'Save expiry'}).click();
 await artifactCard.getByText(/expires /).waitFor();
 // An update draft from a bot: "Update of", then Replace keeps the link.
 await boardWrite('artifact.create',{title:'Synthetic partner pricing, revised',body:'Plans start at 15.',replaces:artifactId});
 await page.goto(base+'/#/shared');await page.reload();
 const updateCard=page.locator('.crew-artifact').filter({hasText:'Update of:'});
 await updateCard.getByText('Update of:').waitFor();
 await updateCard.getByRole('button',{name:'Publish',exact:true}).click();
 await updateCard.getByRole('button',{name:"Replace the existing link's content"}).click();
 await updateCard.waitFor({state:'detached'});
 await visitorPage.reload();await visitorPage.getByText('Plans start at 15.').waitFor();
 await page.goto(base+'/#/shared/'+artifactId);await page.reload();
 assert.equal(await artifactCard.getByRole('textbox',{name:/^Link to /}).inputValue(),artifactLink,'an update draft keeps the link');
 // The PDF check's listener dismisses every dialog; Revoke needs its confirm accepted.
 page.removeAllListeners('dialog');page.once('dialog',d=>d.accept());
 await artifactCard.getByRole('button',{name:'Revoke'}).click();
 await artifactCard.getByText('Revoked',{exact:true}).waitFor();
 const gone=await visitorPage.reload();
 assert.equal(gone.status(),404,'a revoked link answers 404');
 assert.equal((await gone.text()).trim(),'This link is no longer available.');
 // Archive a revoked link: hidden by default, shown under the Archived filter kept in the address.
 await artifactCard.getByRole('button',{name:'Archive'}).click();
 await artifactCard.getByText('Archived',{exact:true}).waitFor();
 await page.goto(base+'/#/shared');await page.reload();
 const archivedCard=page.locator('.crew-artifact').filter({hasText:'Synthetic partner pricing, revised'});
 await page.getByRole('button',{name:/^Drafts/}).waitFor();
 assert.equal(await archivedCard.count(),0,'archived artifacts are hidden by default');
 await page.getByRole('button',{name:/^Archived/}).click();
 await archivedCard.first().waitFor();
 assert.equal(await page.evaluate(()=>location.hash),'#/shared?show=drafts,live,archived');
 await page.reload();await archivedCard.first().getByRole('button',{name:'Restore'}).waitFor();
 await snap('crew-shared-archived');
 await visitor.close();
 await page.locator('button:visible').filter({hasText:/^Sign out$/}).click();
 await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 assert.equal(await page.locator('.crew-app').count(),0);
 assert.deepEqual(errors,[],'Browser errors');assert.deepEqual(outside,[],'Unexpected external requests');
 console.log('Crew browser workflow passed: sign-in, starter crew, notes/history/restore/archive, task/review/manual-completion, Notes and Tasks filters, old-address redirects, task link over the board, session instructions dialog 1024/1280/1440 with hand edit, history restore, restore default and copied prompts, global search 1440/390, responsive 1440/390/320, attachments (pasted screenshots, inline images, lightbox, card thumbnail) 1440/390, file previews (log, CSV, PDF with inert JavaScript, audio, video) 1440/390, one-time upload link from a signed-out phone 390/320, file settings, artifacts (share, publish, signed-out phone view 390, snapshot, replace, expiry, update draft, revoke, archive, filters), logout.');
}catch(error){ console.error('Synthetic browser page:', (await page.locator('body').innerText()).slice(0,2500)); await snap('crew-failure'); throw error; }finally{await browser.close();}
