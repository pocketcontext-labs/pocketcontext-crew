#!/usr/bin/env node
// Synthetic hosted email login and MCP consent. The fixture captures mail locally.
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(fileURLToPath(new URL('../ui/package.json',import.meta.url)))('playwright');
const origin='https://knowledge.example.com';
const port=process.env.POCKETCONTEXT_SYNTHETIC_PORT;
const email=process.env.POCKETCONTEXT_SYNTHETIC_EMAIL;
assert(/^\d+$/.test(port) && email?.endsWith('@example.test'));
const browser=await chromium.launch({args:['--no-proxy-server',`--host-resolver-rules=MAP knowledge.example.com 127.0.0.1:${port}`]});
const context=await browser.newContext({viewport:{width:390,height:844},ignoreHTTPSErrors:true});
const problems=[];
let redeemed=0;
context.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/auth-with-otp'))redeemed++});
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.origin===origin)await route.continue();
 else if(u.origin==='https://client.example.com' && u.pathname==='/callback')await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic callback</title>'});
 else {problems.push('unexpected external request');await route.abort()}
});
try{
 const page=await context.newPage();page.on('pageerror',e=>problems.push(e.message));
 await page.goto(origin);
 await page.getByRole('heading',{name:'Log in to Crew',exact:true}).waitFor();
 assert.equal(await page.locator('input[type=password]').count(),0);
 let caller=page;
 const call=async(path,body,token='',form=false)=>caller.evaluate(async({path,body,token,form})=>{
  const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:form?new URLSearchParams(body).toString():JSON.stringify(body)});
  return {status:r.status,data:await r.json()};
 },{path,body,token,form});
 const mode=await call('/api/bundle/auth-mode');
 assert.deepEqual(mode.data,{mode:'email'});
 await page.getByLabel('Email',{exact:true}).fill('unknown@example.com');
 await page.getByRole('button',{name:'Email me a login link',exact:true}).click();
 await page.getByRole('status').filter({hasText:"is the owner's address"}).waitFor();
 const before=await call('/__test/mailbox');assert.equal(before.data.count,0);
 await page.getByRole('button',{name:'Use a different email',exact:true}).click();
 const registered=await call('/oauth/register',{client_name:'Synthetic hosted assistant',redirect_uris:['https://client.example.com/callback'],token_endpoint_auth_method:'none'});
 assert.equal(registered.status,201);
 const verifier=randomBytes(32).toString('base64url');
 const client=registered.data.client_id;
 const params=new URLSearchParams({client_id:client,redirect_uri:'https://client.example.com/callback',response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource:origin+'/mcp',scope:'knowledge',state:'synthetic-state'});
 const authorize=origin+'/oauth/authorize?'+params;
 const consent=await context.newPage();consent.on('pageerror',e=>problems.push(e.message));
 await consent.goto(authorize);
 assert(!await consent.locator('body').innerText().then(t=>t.includes('open --public')),'hosted consent should explain email login');
 assert.equal(await consent.getByRole('button',{name:'Allow access',exact:true}).count(),0);
 await consent.getByRole('link',{name:'Log in',exact:true}).click();
 await consent.waitForURL(origin+'/#/signin?next=**');
 await consent.getByLabel('Email',{exact:true}).fill(email);
 await consent.getByRole('button',{name:'Email me a login link',exact:true}).click();
 await consent.getByRole('heading',{name:'Check your inbox',exact:true}).waitFor();
 let mailbox;
 for(let n=0;n<100;n++){
  mailbox=(await call('/__test/mailbox')).data;
  if(mailbox.count===1)break;
  await new Promise(r=>setTimeout(r,50));
 }
 assert.equal(mailbox.count,1,'one owner login email');
 const link=mailbox.url;assert(link.startsWith(origin+'/#'));
 await page.goto(link);
 await page.getByRole('button',{name:'Continue to Crew',exact:true}).waitFor();
 assert.equal(redeemed,0,'opening a link never consumes OTP');
 assert(!page.url().includes('otp='),'credential removed from address/history');
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'login fits viewport');
 }
 await page.getByRole('button',{name:'Continue to Crew',exact:true}).click();
 // The emailed link opened in another tab still returns to the request.
 await page.waitForURL(authorize);
 assert.equal(redeemed,1);
 assert.equal(await page.evaluate(()=>localStorage.getItem('pocketcontext.crew.login_return')),null,'return target consumed');
 await page.getByRole('button',{name:'Allow access',exact:true}).click();
 await page.waitForURL('https://client.example.com/callback?**');
 caller=consent;
 const callback=new URL(page.url());assert.equal(callback.searchParams.get('state'),'synthetic-state');
 const tokens=await call('/oauth/token',{grant_type:'authorization_code',client_id:client,code:callback.searchParams.get('code'),redirect_uri:'https://client.example.com/callback',code_verifier:verifier,resource:origin+'/mcp'},'',true);
 assert.equal(tokens.status,200);
 assert.equal((await call('/mcp',{},tokens.data.access_token)).status,200);
 const fragment=new URLSearchParams(link.split('?')[1]);
 const replay=await call('/api/collections/users/auth-with-otp',{otpId:fragment.get('otpId'),password:fragment.get('otp')});
 assert.equal(replay.status,400,'used login link rejected');
 assert.deepEqual(problems,[]);
 console.log('ok - hosted email form, unknown email, captured mail, scanner-safe confirmation, OTP replay, responsive login, consent Log in with return from the emailed link, and MCP consent');
}finally{await context.close();await browser.close()}
