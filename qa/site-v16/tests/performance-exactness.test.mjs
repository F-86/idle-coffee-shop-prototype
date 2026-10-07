import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {registerHooks} from 'node:module';import {Worker} from 'node:worker_threads';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
const {createEngine,createInitialState,STEP_SECONDS,MAX_ELAPSED_SECONDS}=await import('../src/slice/core/engine.ts');
const {initialLayout,addFurniture,occupiedCells,interactionPoint,layoutBounds,inGrid,gridKey,findGridPath,createGridNavigator,layoutCost}=await import('../src/slice/core/layout.ts');
const {LocalSaveRepository,createMemoryStorage,SAVE_KEY,validateState}=await import('../src/slice/core/persistence.ts');
const expanded=JSON.parse(readFileSync(new URL('./fixtures/performance-expanded-v9.json',import.meta.url),'utf8'));
const business=s=>{s=structuredClone(s);delete s.lastOfflineClaimId;delete s.offlineClaimIds;return s;};
const empty=()=>{const s=createInitialState();s.ingredients={beans:0,milk:0};return s;};
function oldPath(layout,from,to,extra=new Set()){
 const obstacles=occupiedCells(layout);for(const i of layout.furniture)if(i.kind==='table'&&!i.stored){const seat=gridKey(interactionPoint(i,'seat'));if(seat!==gridKey(from)&&seat!==gridKey(to))obstacles.add(seat);}
 if(!inGrid(layout,from)||!inGrid(layout,to)||obstacles.has(gridKey(from))||obstacles.has(gridKey(to)))return null;
 const queue=[from],previous=new Map([[gridKey(from),null]]);
 for(let head=0;head<queue.length;head++){const p=queue[head];if(gridKey(p)===gridKey(to)){const path=[];let cursor=p;while(cursor){path.push(cursor);cursor=previous.get(gridKey(cursor));}return path.reverse().slice(1);}
  for(const[dx,dz]of[[0,-1],[1,0],[0,1],[-1,0]]){const q={x:p.x+dx,z:p.z+dz},key=gridKey(q);if(!inGrid(layout,q)||obstacles.has(key)||extra.has(key)||previous.has(key))continue;previous.set(key,p);queue.push(q);}}
 return null;
}
test('PERF-PATH-001 prepared numeric BFS preserves old canonical routes including chairs, blockers and all16 footprints',()=>{
 let seed=18253;const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let w=0;w<4;w++)for(let d=0;d<4;d++){
  const layout=initialLayout();layout.widthSteps=w;layout.depthSteps=d;layout.expanded=w>0;
  for(const[x,z]of[[-4,1],[0,5],[4,6]]){const item=addFurniture(layout,'table',x,z);item.rotation=next(4);}
  const b=layoutBounds(layout),navigate=createGridNavigator(layout),point=()=>({x:b.minX-1+next(b.width+2),z:b.minZ+next(b.depth)});
  for(let i=0;i<120;i++){const from=point(),to=i%10===0?from:point(),blocked=new Set(Array.from({length:next(15)},()=>gridKey(point())));if(i%7===0)blocked.add(gridKey(from));
   assert.deepEqual(navigate(from,to,blocked),oldPath(layout,from,to,blocked));
   blocked.add(gridKey(to));assert.deepEqual(navigate(from,to,blocked),oldPath(layout,from,to,blocked),'mutating a caller blocked Set cannot leave a stale search');
   const bits=new Uint16Array(Math.ceil((b.width+2)*b.depth/16));for(const key of blocked){const[x,z]=key.split(',').map(Number);if(x<b.minX-1||x>b.maxX+1||z<b.minZ||z>b.maxZ)continue;const bit=(z-b.minZ)*(b.width+2)+x-b.minX+1;bits[bit>>4]|=1<<(bit&15);}
   assert.deepEqual(navigate(from,to,{kind:'grid-mask',width:b.width,depth:b.depth,bits}),oldPath(layout,from,to,blocked),'typed traffic mask preserves the Set route and start==target exception');
  }
  assert.equal(navigate({x:.5,z:5},{x:0,z:2}),null);
  assert.equal(navigate({x:0,z:2},{x:0,z:3},{kind:'grid-mask',width:b.width+1,depth:b.depth,bits:new Uint16Array(1)}),null,'another footprint mask fails closed');
 }
 const draft=initialLayout();assert.equal(findGridPath(draft,{x:-7,z:5},{x:5,z:0}),null);draft.furniture[1].stored=true;assert.deepEqual(findGridPath(draft,{x:-7,z:5},{x:5,z:0}),oldPath(draft,{x:-7,z:5},{x:5,z:0}),'public mutable-draft path builds a fresh footprint');
});
test('PERF-OFFLINE-001 inert prefix skipping preserves every field at timer boundaries and near the maximum clock',()=>{
 for(const id of [1,2,3])for(const timer of [0,.123456789,2.549999999,3])for(const elapsed of [0,MAX_ELAPSED_SECONDS-100]){
  const s=empty();s.nextCustomerId=id;s.arrivalTimer=timer;s.elapsed=elapsed;s.inviteCooldown=17.987654321;s.stepCarry=.017;
  const online=createEngine(s),offline=createEngine(s),job=offline.beginOffline(60,'timer-boundary');assert.equal(job.canFastForwardIdle,true);
  let prefix=0;for(const count of [1,7,31,113]){job.advance(count);prefix+=count;online.advance(count*STEP_SECONDS);assert.deepEqual(business(offline.snapshot()),business(online.snapshot()));assert.equal(job.completedSeconds,prefix*.05);}
  const full=createEngine(s);full.advance(48);job.advance(Number.MAX_SAFE_INTEGER);assert.deepEqual(business(offline.snapshot()),business(full.snapshot()));assert.equal(job.canFastForwardIdle,false);
  offline.buyIngredient('beans','batch');full.buyIngredient('beans','batch');offline.advance(40);full.advance(40);assert.deepEqual(business(offline.snapshot()),business(full.snapshot()));
 }
});
test('PERF-OFFLINE-002 eligibility excludes live guests/brews/legacy policies and ignores stored compatible counters',()=>{
 const s=empty();s.ingredients.beans=20;s.counters[0].recipe='latte';s.layout.furniture[1].stored=true;s.counters[1].recipe='espresso';
 const current=createEngine(s),job=current.beginOffline(100,'missing-milk');assert.equal(job.canFastForwardIdle,true);job.advance(Number.MAX_SAFE_INTEGER);assert.equal(current.state.wallet,s.wallet);assert.equal(current.state.ingredients.beans,20);
 for(const policy of [1,2,3]){const e=createEngine(empty()),legacy=e.beginOffline(100,'legacy-'+policy,policy);assert.equal(legacy.canFastForwardIdle,false);legacy.advance(800);assert.ok(e.state.customers.length>0);}
 const active=createEngine(expanded),busy=active.beginOffline(60,'busy');assert.equal(busy.canFastForwardIdle,false);busy.advance(Number.MAX_SAFE_INTEGER);const online=createEngine(expanded);online.advance(48);assert.deepEqual(business(active.snapshot()),business(online.snapshot()));
 const paused=structuredClone(expanded);paused.paused=true;const p=createEngine(paused);p.applyOffline(604800,'paused');assert.deepEqual(business(p.snapshot()),business(paused));
});
test('PERF-OFFLINE-003 maximum-length empty interval completes with exact phase and no income',async()=>{
 const url=new URL('../src/slice/core/engine.ts',import.meta.url).href;
 const script=`const {parentPort,workerData}=require('node:worker_threads');const {registerHooks}=require('node:module');registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(s.startsWith('.')&&!/\\.[a-z]+$/i.test(s))return n(s+'.ts',c);throw e}}});(async()=>{const {createEngine,createInitialState}=await import(workerData);const s=createInitialState();s.ingredients={beans:0,milk:0};s.inviteCooldown=18;const e=createEngine(s),job=e.beginOffline(5000000000,'maximum');if(!job.canFastForwardIdle)throw Error('inert skip missing');job.advance(Number.MAX_SAFE_INTEGER);parentPort.postMessage(e.snapshot());})();`;
 const state=await new Promise((resolve,reject)=>{const worker=new Worker(script,{eval:true,workerData:url});const timer=setTimeout(()=>{void worker.terminate();reject(Error('maximum horizon was not accelerated'));},5000);worker.once('message',s=>{clearTimeout(timer);resolve(s);});worker.once('error',e=>{clearTimeout(timer);reject(e);});});
 assert.equal(state.elapsed,4000000000);assert.equal(state.arrivalTimer,Number(80000000000n%51n)/20);assert.equal(state.inviteCooldown,0);assert.equal(state.totalEarned,0);assert.equal(state.eventSequence,0);assert.equal(state.nextCustomerId,1);assert.equal(state.offlineClaimIds.length,1);
});
function saved(state=empty()){const memory=createMemoryStorage(),repo=new LocalSaveRepository(memory);repo.load(100000);assert.equal(repo.save(state,100000).ok,true);return{memory,repo,raw:memory.getItem(SAVE_KEY)};}
for(const mode of ['success','cancel','abort','throw','conflict'])test(`PERF-OFFLINE-004 accelerated progress ${mode} retains atomic save and cancellation`,async()=>{
 const f=saved(),loaded=f.repo.load(100000+604800000,{deferOffline:true}),controller=new AbortController(),fractions=[];let yields=0,winning=f.raw;
 const result=await f.repo.finishOffline(loaded.pending,{signal:controller.signal,yieldControl:async()=>{yields++;},onProgress:p=>{fractions.push(p.fraction);if(p.fraction===1){if(mode==='cancel')f.repo.cancelOffline(loaded.pending);if(mode==='abort')controller.abort();if(mode==='throw')throw Error('UI canceled');if(mode==='conflict'){winning=JSON.stringify({...JSON.parse(f.raw),recordChangeTag:'synthetic-other-writer'});f.memory.setItem(SAVE_KEY,winning);}}}});
 assert.equal(yields,1);assert.deepEqual(fractions,[0,1]);
 if(mode==='success'){assert.equal(result.status,'loaded');assert.equal(result.state.elapsed,483840);assert.equal(result.state.wallet,1200);const raw=f.memory.getItem(SAVE_KEY);f.repo.load(100000+604800000);assert.equal(f.memory.getItem(SAVE_KEY),raw);}
 else{assert.notEqual(result.status,'loaded');assert.equal(result.offline.accepted,false);assert.equal(f.memory.getItem(SAVE_KEY),winning);}
});
test('PERF-METADATA-001 unchanged HUD inspection neither decodes nor clones the durable game',()=>{
 const f=saved(expanded),parse=JSON.parse;let parses=0;JSON.parse=(raw,...rest)=>{if(raw===f.raw)parses++;return parse(raw,...rest);};
 try{for(let i=0;i<1000;i++)assert.equal(f.repo.inspect().rawText,f.raw);assert.equal(parses,0);const first=f.repo.durableSnapshot();first.state.wallet++;assert.equal(f.repo.durableSnapshot().state.wallet,expanded.wallet);assert.equal(parses,2,'explicit durable reads retain full validation');}finally{JSON.parse=parse;}
});
test('PERF-METADATA-002 raw replacement invalidates backup metadata and preserves fail-closed corrupt/future reads',()=>{
 const f=saved(),base=JSON.parse(f.raw);
 for(const suffix of ['a','b',undefined]){const raw=JSON.stringify({...base,lastImportBackupKey:suffix?`${SAVE_KEY}-import-backup-${suffix}`:undefined});f.memory.setItem(SAVE_KEY,raw);assert.equal(f.repo.load(100000).status,'loaded');assert.equal(f.repo.inspect().importBackupKey,suffix?`${SAVE_KEY}-import-backup-${suffix}`:undefined);}
 for(const raw of ['broken',JSON.stringify({...base,schemaVersion:99,lastImportBackupKey:SAVE_KEY+'-import-backup-future'})]){f.memory.setItem(SAVE_KEY,raw);assert.notEqual(f.repo.load(100000).status,'loaded');assert.equal(f.repo.inspect().importBackupKey,undefined);assert.equal(f.repo.durableSnapshot(),null);assert.equal(f.memory.getItem(SAVE_KEY),raw);}
});
