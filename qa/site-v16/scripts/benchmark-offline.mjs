import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(s+'.ts',c);throw e;}}});
// Synthetic fixtures only. Optional args: core-directory, comma-separated fixture names, comma-separated wall seconds.
// Node 24: node scripts/benchmark-offline.mjs src/slice/core expanded 60,3600
const root=new URL('../',import.meta.url);
const coreRoot=process.argv[2]?pathToFileURL(resolve(process.argv[2])).href:new URL('src/slice/core',root).href;const {createInitialState,createEngine}=await import(coreRoot+'/engine.ts');
const {addFurniture}=await import(coreRoot+'/layout.ts');
function createFixtures(){
 const initial=createInitialState();const empty=createInitialState();empty.ingredients={beans:0,milk:0};
 function stocked(stored=0){const s=createInitialState();s.wallet+=10000000;s.totalEarned+=10000000;s.paused=true;s.totalServed=40;s.counters[0].brewed=40;const e=createEngine(s);for(let i=0;i<4;i++)e.upgradeWarehouse();e.buyIngredient('beans','fill');e.buyIngredient('milk','fill');e.beginLayoutEdit();const d=e.createLayoutDraft();d.widthSteps=3;d.depthSteps=3;d.expanded=true;for(const[x,z]of[[12,0],[19,0],[26,0],[0,7],[7,7],[14,7],[21,7],[26,14]])addFurniture(d,'counter',x,z);for(const[x,z]of[[-4,1],[-4,8],[0,14],[4,14],[8,14],[12,14],[16,14],[20,14],[0,18],[4,18],[8,18],[12,18],[16,18],[20,18]])addFurniture(d,'table',x,z);for(let i=0;i<stored;i++)addFurniture(d,'table',-4,3).stored=true;const result=e.commitLayout(d);if(!result.ok)throw Error(result.message);e.togglePause();e.advance(50);return e.snapshot();}
 const expanded=stocked(),inventory=stocked(1000),paused=structuredClone(expanded);paused.paused=true;
 assert.deepEqual(expanded,JSON.parse(readFileSync(new URL('tests/fixtures/performance-expanded-v9.json',root),'utf8')),'benchmark seed changed from the frozen v12 fixture');
 return {initial,empty,expanded,inventory,paused};
}
const fixtures=createFixtures();const selected=process.argv[3]?.split(',')??Object.keys(fixtures);const durations=process.argv[4]?.split(',').map(Number)??[60,3600,86400,604800];
for(const name of selected)for(const seconds of durations){const seed=fixtures[name],e=createEngine(seed),start=performance.now();const result=e.applyOffline(seconds,'benchmark-fixed-id');const wallMs=performance.now()-start,snapshot=e.snapshot();const sha=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');console.log(JSON.stringify({name,seconds,wallMs:+wallMs.toFixed(3),served:snapshot.totalServed-seed.totalServed,earned:snapshot.wallet-seed.wallet,remaining:snapshot.ingredients,customers:snapshot.customers.length,elapsed:snapshot.elapsed,hash:sha,accepted:result.accepted}));}
