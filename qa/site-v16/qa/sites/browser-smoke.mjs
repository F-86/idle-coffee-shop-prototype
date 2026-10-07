// Synthetic local QA only. This server must never be included in Worker output.
import {createServer} from 'node:http';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
import worker from '../../dist/server/index.js';
const sqlite=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')))sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
const DB={prepare(sql){let args=[];return{bind(...v){args=v;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {success:true,meta:sqlite.prepare(sql).run(...args)}}};},async batch(q){sqlite.exec('BEGIN');try{const r=[];for(const x of q)r.push(await x.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const requests=[],identityRequests=[];
const server=createServer(async(req,res)=>{try{const origin='http://127.0.0.1:'+server.address().port;const body=[];for await(const c of req)body.push(c);if(req.url.startsWith('/api/identity'))identityRequests.push(req.url);if(req.url.startsWith('/api/')&&!req.url.startsWith('/api/identity'))requests.push({method:req.method,path:req.url});if(!req.url.startsWith('/api/')){const path=new URL(req.url,origin).pathname;const file=resolve('dist/client','.'+(path==='/'?'/index.html':path));if(!file.startsWith(resolve('dist/client')+'/'))throw Error('bad path');res.setHeader('content-type',types[extname(file)]??'application/octet-stream');res.end(readFileSync(file));return;}const request=new Request(origin+req.url,{method:req.method,headers:{...req.headers,'oai-authenticated-user-id':'synthetic-browser-user'},body:req.method==='POST'?Buffer.concat(body):undefined});const result=await worker.fetch(request,{DB,ASSETS:{async fetch(r){const path=new URL(r.url).pathname;const file=resolve('dist/client','.'+(path==='/'?'/index.html':path));if(!file.startsWith(resolve('dist/client')+'/'))throw Error('bad path');return new Response(readFileSync(file),{headers:{'content-type':types[extname(file)]??'application/octet-stream'}});}}});res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.arrayBuffer().then(x=>Buffer.from(x)));}catch(e){res.statusCode=500;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
// Use the consumer's already-verified normal browser path; no test-only renderer flags.
const browser=await chromium.launch({executablePath:process.env.COFFEE_CHROMIUM||'/usr/bin/chromium',headless:true});
const report={checks:[],errors:[]};
try{
 const a=await browser.newContext({viewport:{width:1440,height:900}});const p=await a.newPage();p.on('pageerror',e=>report.errors.push(e.message));
 await p.goto(origin+'/?qa=1');await p.waitForSelector('#coffee-canvas',{timeout:30000});await p.waitForFunction(()=>window.__coffeeSliceDebug?.readState());
 if(await p.locator('#guide-skip').isVisible())await p.locator('#guide-skip').click();
 await p.locator('#business-toggle').click();await p.waitForFunction(()=>window.__coffeeSliceDebug.readState().paused);await p.waitForFunction(()=>window.__coffeeSliceDebug.readState().customers.length===0,undefined,{timeout:60000});await p.waitForTimeout(3000);assert.equal(requests.length,0);assert.equal(identityRequests.length,1);
 report.checks.push('Desktop WebGL and local pause work with zero startup/idle game API requests');
 const zoomBefore=await p.evaluate(()=>window.__coffeeSliceDebug.readCameraZoom());await p.mouse.move(720,450);await p.mouse.wheel(0,-260);await p.waitForFunction(z=>window.__coffeeSliceDebug.readCameraZoom()>z,zoomBefore);
 report.checks.push('Actual canvas wheel changes bounded camera zoom');
 await p.locator('.cloud-status').click();await p.waitForFunction(()=>document.querySelector('.cloud-status').disabled===false);assert.equal(requests.length,2);assert.deepEqual(requests.map(x=>x.method),['GET','POST']);
 const first=JSON.parse(sqlite.prepare('SELECT raw FROM coffee_saves').get().raw).state;
 mkdirSync('qa/sites/evidence',{recursive:true});await p.screenshot({path:'qa/sites/evidence/desktop.png'});
 const b=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});const q=await b.newPage();q.on('pageerror',e=>report.errors.push(e.message));
 await q.goto(origin+'/?qa=1');await q.waitForSelector('#coffee-canvas');await q.waitForFunction(()=>window.__coffeeSliceDebug?.readState());if(await q.locator('#guide-skip').isVisible())await q.locator('#guide-skip').click();assert.equal(requests.length,2);
 await q.locator('#settings').click();await q.locator('#save-files').click();await q.getByRole('button',{name:'下载云存档',exact:true}).click();await q.getByRole('button',{name:'下载云端覆盖本机',exact:true}).click();await q.waitForFunction(()=>document.querySelector('.cloud-status').disabled===false);
 const second=await q.evaluate(()=>window.__coffeeSliceDebug.readState());assert.equal(second.paused,true);assert.equal(second.wallet,first.wallet);assert.deepEqual(second.ingredients,first.ingredients);assert.deepEqual(second.counters,first.counters);
 assert.equal(identityRequests.length,2);report.checks.push('Independent mobile browser context downloads snapshot only after explicit choice; wallet/stock/levels preserved');
 const beforeIdle=requests.length;await q.waitForTimeout(3000);await q.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});await q.waitForTimeout(1000);assert.equal(requests.length,beforeIdle);
 await q.locator('#dock-coffee').click();assert.equal(await q.locator('#coffee-upgrade').count(),0);assert.equal(await q.locator('#coffee-level').count(),0);await q.locator('#dialog-close').click();
 await q.screenshot({path:'qa/sites/evidence/mobile.png'});assert.equal(await q.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await p.locator('.cloud-status').click();await p.waitForFunction(()=>document.querySelector('.cloud-status').disabled===false);const revision=sqlite.prepare('SELECT revision FROM coffee_saves').get().revision;
 await q.locator('.cloud-status').click();await q.getByRole('button',{name:'取消',exact:true}).click();await q.waitForFunction(()=>document.querySelector('.cloud-status').disabled===false);assert.equal(sqlite.prepare('SELECT revision FROM coffee_saves').get().revision,revision);
 await q.locator('.cloud-status').click();await q.getByRole('button',{name:'上传本机覆盖云端',exact:true}).click();await q.waitForFunction(()=>document.querySelector('.cloud-status').disabled===false);assert.equal(sqlite.prepare('SELECT revision FROM coffee_saves').get().revision,revision+1);assert.ok(sqlite.prepare('SELECT COUNT(*) AS n FROM coffee_backups').get().n>=2);
 report.checks.push('Stale device gets explicit conflict; cancel leaves cloud unchanged; confirmed upload increments once with backup');
 report.checks.push('Idle/reconnect emit no game API requests; fixed recipes have no upgrade controls; 390px has no horizontal overflow');
 // Actual DOM input on the mobile-sized context, backed by the real local game.
 const requestsBeforeFurniture=requests.length;
 const ownedBefore=await q.evaluate(()=>window.__coffeeSliceDebug.readState());
 await q.locator('#dock-furniture').click();await q.locator('#buy-table').click();
 const card=q.locator('[data-catalog-key="group-table"]');const box=await card.boundingBox();assert.ok(box);await q.mouse.move(box.x+box.width/2,box.y+box.height/2);await q.mouse.down();await q.keyboard.press('Escape');await q.mouse.up();
 let draft=await q.evaluate(()=>window.__coffeeSliceDebug.readRenovation().draft);assert.equal(draft.furniture.filter(x=>x.kind==='table').length,1);assert.equal(draft.furniture.find(x=>x.kind==='table').stored,true,'canceled pre-drag press cannot place pending stock');
 await card.click();draft=await q.evaluate(()=>window.__coffeeSliceDebug.readRenovation().draft);assert.equal(draft.furniture.find(x=>x.kind==='table').stored,false,'fresh click still places intentionally');await q.locator('#renovation-cancel').click();
 let owned=await q.evaluate(()=>window.__coffeeSliceDebug.readState());assert.equal(owned.wallet,ownedBefore.wallet);assert.deepEqual(owned.layout,ownedBefore.layout);
 await q.locator('#dock-furniture').click();await q.locator('#buy-table').click();await q.locator('#renovation-apply').click();owned=await q.evaluate(()=>window.__coffeeSliceDebug.readState());assert.equal(owned.wallet,ownedBefore.wallet-600);const table=owned.layout.furniture.find(x=>x.kind==='table');assert.equal(table.stored,true);
 await q.reload();await q.waitForFunction(()=>window.__coffeeSliceDebug?.readState());await q.locator('#dock-furniture').click();assert.equal(await q.locator('#buy-table').count(),1);await q.locator('[data-catalog-key="group-table"]').click();await q.locator('#renovation-apply').click();owned=await q.evaluate(()=>window.__coffeeSliceDebug.readState());assert.equal(owned.wallet,ownedBefore.wallet-600);assert.equal(owned.layout.furniture.find(x=>x.id===table.id).stored,false);assert.equal(requests.length,requestsBeforeFurniture);assert.equal(identityRequests.length,3);
 await q.screenshot({path:'qa/sites/evidence/mobile-owned-table.png'});report.checks.push('Real pointer-down/Escape/release cannot place stock; fresh placement works; cancel is free; purchased stored table survives reload and restores without a second charge or game API request');
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report));writeFileSync('qa/sites/evidence/report.json',JSON.stringify(report,null,2));
}finally{await browser.close();server.close();}
