import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
const {api}=await import('../worker/index.ts');
const {readSiteIdentity,identityBootstrap}=await import('../src/cloud/identity.ts');
const original=readFileSync(new URL('../src/cloud/bootstrap.ts',import.meta.url),'utf8');
class Element{children=[];textContent='';append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}setAttribute(){}addEventListener(){}style={};remove(){this.removed=true;}}
function fixture(fetcher,{mountError=false}={}){
 const root=new Element(),body=new Element();let storageReads=0,mounted=0;const identities=[];
 class Manual{branch={baseRevision:null,raw:null};constructor(user,storage){identities.push(user);assert.ok(storage);}storage(){return{};}}
 const document={body,createElement:()=>new Element(),querySelector:s=>s==='#slice-root'?root:null,querySelectorAll:()=>body.children};
 const source=original.replace(/^import\s[^;]+;\n/gm,'').replace("await import('../slice/main')",'await loadMain()');
 const context={document,location:{pathname:'/shop',search:'?qa=1',reload(){}},ManualSync:Manual,MANUAL_PREFIX:'manual:',PREFIX:'old:',readBranches:()=>[],summarize:()=>'',setManualSync(){},setCloudStorage(){},identityBootstrap,readSiteIdentity:()=>readSiteIdentity(fetcher),loadMain:async()=>{mounted++;if(mountError)throw Error('chunk unavailable');},window:{dispatchEvent(){}},console};
 Object.defineProperty(context,'localStorage',{get(){storageReads++;return{};}});
 runInNewContext(stripTypeScriptTypes(source),context);
 return{root,body,identities,get storageReads(){return storageReads;},get mounted(){return mounted;},async flush(){for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));},retry(){root.children[0].children.find(x=>x.textContent==='重试').onclick();},text(){return root.children.flatMap(x=>x.children.map(c=>c.textContent)).join(' ');}};
}
const reply=user=>new Response(JSON.stringify({authenticated:true,userId:user}),{headers:{'Content-Type':'application/json'}});
test('IDENTITY-001 endpoint uses only trusted header, without database or game reads',async()=>{
 let opened=0;const env={get DB(){opened++;throw Error('D1 must not open');}};
 const good=await api(new Request('https://coffee.test/api/identity?userId=forged',{headers:{'oai-authenticated-user-id':'synthetic-owner'}}),env);assert.equal(good.status,200);assert.deepEqual(await good.json(),{userId:'synthetic-owner',authenticated:true});assert.equal(opened,0);assert.match(good.headers.get('Cache-Control'),/private, no-store/);
 const no=await api(new Request('https://coffee.test/api/identity'),env);assert.equal(no.status,401);assert.deepEqual(await no.json(),{error:'signin_required'});assert.equal(opened,0);
 const post=await api(new Request('https://coffee.test/api/identity',{method:'POST',headers:{'oai-authenticated-user-id':'synthetic-owner'}}),env);assert.equal(post.status,405);assert.equal(opened,0);
});
test('IDENTITY-002 actual bootstrap with static HTML/no meta waits for one identity result before storage or game',async()=>{
 let complete,calls=0;const f=fixture(async(path,options)=>{calls++;assert.equal(path,'/api/identity');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');return new Promise(r=>complete=r);});
 assert.equal(calls,1);assert.equal(f.storageReads,0);assert.equal(f.mounted,0);assert.match(f.text(),/正在打开/);complete(reply('synthetic-owner'));await f.flush();assert.deepEqual(f.identities,['synthetic-owner']);assert.equal(f.storageReads,1);assert.equal(f.mounted,1);assert.equal(calls,1);
});
test('IDENTITY-003 missing login shows safe sign-in/retry and never accesses any local branch',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return new Response('{}',{status:401,headers:{'Content-Type':'application/json'}});});await f.flush();assert.equal(f.storageReads,0);assert.equal(f.mounted,0);assert.match(f.text(),/请登录后/);const link=f.root.children[0].children.find(x=>x.textContent==='使用 ChatGPT 登录');assert.equal(link.target,'_top');assert.equal(link.href,'/signin-with-chatgpt?return_to=%2Fshop%3Fqa%3D1');await f.flush();assert.equal(calls,1);
});
test('IDENTITY-004 invalid HTML, empty user and network errors show recovery rather than uncaught blank page',async()=>{
 for(const fetcher of [async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),async()=>reply(''),async()=>{throw Error('offline');},async()=>new Response('{',{headers:{'Content-Type':'application/json'}})]){const f=fixture(fetcher);await f.flush();assert.equal(f.storageReads,0);assert.equal(f.mounted,0);assert.match(f.text(),/暂时无法确认/);assert.match(f.text(),/重试/);}
});
test('IDENTITY-005 late successful login only retries on explicit click and duplicate clicks are single-flight',async()=>{
 let calls=0,complete;const f=fixture(async()=>{calls++;if(calls===1)return new Response('{}',{status:401,headers:{'Content-Type':'application/json'}});return new Promise(r=>complete=r);});await f.flush();const retry=f.root.children[0].children.find(x=>x.textContent==='重试');retry.onclick();retry.onclick();assert.equal(calls,2);assert.equal(f.storageReads,0);complete(reply('second-verified-owner'));await f.flush();assert.deepEqual(f.identities,['second-verified-owner']);assert.equal(f.mounted,1);assert.equal(calls,2);
});
test('IDENTITY-006 static root contains safe loading content and no embedded owner or startup throw',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/正在打开小店/);assert.doesNotMatch(html,/coffee-owner/);assert.doesNotMatch(original,/if\(!encoded\)throw|小店身份信息缺失/);});

test('IDENTITY-007 failed partial game mount has a distinct terminal gate and cannot mount twice',async()=>{let calls=0,mounts=0;const statuses=[];const start=identityBootstrap(async()=>{calls++;return 'owner';},async()=>{mounts++;throw Error('chunk failed');},s=>statuses.push(s));await start();await start();assert.equal(calls,1);assert.equal(mounts,1);assert.deepEqual(statuses,['loading','startup-error']);assert.match(original,/status==='startup-error'.*\n/);const f=fixture(async()=>reply('owner'),{mountError:true});await f.flush();assert.match(f.text(),/小店暂时未能打开/);assert.match(f.text(),/重新打开小店/);assert.doesNotMatch(f.text(),/重试|使用 ChatGPT 登录/);assert.ok(f.body.children.every(x=>x.removed));});
