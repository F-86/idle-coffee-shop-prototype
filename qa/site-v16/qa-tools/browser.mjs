// Screenshots and browser checks use fresh local contexts, never a user profile.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {root} from './verify.mjs';
import {startQaServer} from './server.mjs';
import {scenarioNames} from './fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.COFFEE_PLAYWRIGHT_MODULE||'playwright');
const selected=process.argv.slice(2);for(const name of selected)if(!scenarioNames.includes(name))throw Error('Unknown scenario: '+name);
const scenarios=selected.length?selected:scenarioNames,output=resolve(root,'qa-tools/evidence');await mkdir(output,{recursive:true});
const qa=await startQaServer();let browser;const report={sourceCommit:'94c1ba2515e0f34fe64baa98cd932e4a28589849',mode:'synthetic-local-browser',results:[],errors:[]};
try{
 browser=await chromium.launch({headless:true,...(process.env.COFFEE_CHROMIUM?{executablePath:process.env.COFFEE_CHROMIUM}:{})});
 for(const scenario of scenarios)for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const seed=await fetch(qa.origin+'/__qa/seed?scenario='+scenario).then(r=>r.json()),context=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'block'});
  try{
   await context.route('**/*',route=>new URL(route.request().url()).origin===qa.origin?route.continue():route.abort());
   await context.addInitScript(({origin,storage})=>{if(location.origin!==origin||sessionStorage.getItem('coffee-qa-seeded'))return;if(localStorage.length)throw Error('Expected fresh synthetic storage');for(const[key,value]of storage)localStorage.setItem(key,value);sessionStorage.setItem('coffee-qa-seeded','1');},{origin:qa.origin,storage:seed.storage});
   const page=await context.newPage();page.on('pageerror',error=>report.errors.push({scenario,message:error.message}));const requestStart=qa.requests.length;
   await page.goto(qa.origin+'/?qa=1',{waitUntil:'load'});await page.waitForFunction(()=>window.__coffeeSliceDebug?.readState(),undefined,{timeout:30000});
   if(await page.locator('#guide-skip').isVisible())await page.locator('#guide-skip').click();
   await page.waitForFunction(()=>window.__coffeeSliceDebug.readRenderStats()?.renderedFrames>1);
   const file=`${scenario}-${viewport.width}x${viewport.height}.png`;await page.screenshot({path:resolve(output,file),fullPage:true});
   const snapshot=await page.evaluate(()=>({state:window.__coffeeSliceDebug.readState(),render:window.__coffeeSliceDebug.readRenderStats(),overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.equal(snapshot.overflow,false);assert.ok(snapshot.render.renderedFrames>1);const requests=qa.requests.slice(requestStart);assert.equal(requests.filter(x=>x.path==='/api/identity').length,1);assert.equal(requests.filter(x=>x.path!=='/api/identity').length,0);
   report.results.push({scenario,viewport,screenshot:file,render:snapshot.render,customers:snapshot.state.customers.map(({id,phase,x,z,counterId,seatId})=>({id,phase,x,z,counterId,seatId})),identityRequests:1,gameRequests:0,pixelInspection:'REQUIRED: inspect the PNG; a successful screenshot is not visual acceptance'});
  }finally{await context.close();}
 }
 assert.equal(report.errors.length,0,'browser page errors');
}finally{await browser?.close();await qa.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({output,scenarios:report.results.length,pageErrors:report.errors.length}));
