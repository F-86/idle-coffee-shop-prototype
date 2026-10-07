import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
const {createEngine,createInitialState,counterPrice,counterBrewSeconds}=await import('../src/slice/core/engine.ts');
const {validateState,decode}=await import('../src/slice/core/persistence.ts');
const {createPortableSave,parsePortableSave,overviewOf}=await import('../src/slice/core/portableSave.ts');
const {transition}=await import('../worker/game.ts');
const uuid=()=>crypto.randomUUID();
function envelope(state,savedAt=0){return JSON.stringify({schemaVersion:1,offlinePolicyVersion:4,savedAt,recordChangeTag:uuid(),saveId:uuid(),revision:1,state});}
const business=raw=>{const state=JSON.parse(raw).state;delete state.lastOfflineClaimId;delete state.offlineClaimIds;return state;};
test('COUNTER-002 every ID uses identical recipe and level price/time with no affinity',()=>{
 for(const recipe of ['espresso','latte'])for(let level=1;level<=20;level++)for(let coffee=1;coffee<=10;coffee++)for(const id of ['counter-a','counter-b','counter-c','counter-d']){
  assert.equal(counterPrice(recipe,level,id,coffee),counterPrice(recipe,level,'counter-a',coffee));assert.equal(counterBrewSeconds(recipe,level,id,coffee),counterBrewSeconds(recipe,level,'counter-a',coffee));
 }
});
test('COUNTER-003 v5 migration preserves stock, paid progression, IDs and in-flight old cup snapshots',()=>{
 const initial=createInitialState();initial.counters.forEach(c=>{c.level=2;c.recipe='latte';});initial.coffeeLevels.latte=4;
 const old=createEngine(initial,undefined,{legacyCounterBonuses:true,legacyCoffeeLevels:true});while(!old.state.counters[1].brew)old.advance(.05);
 assert.equal(old.state.counters[1].brew.price,342,'full legacy expression rounds once, never343');
 const legacy=old.snapshot();legacy.economyVersion=5;legacy.ingredients={beans:0,milk:0};const before=structuredClone(legacy);const result=validateState(legacy);assert.equal(result.ok,true);assert.equal(result.state.economyVersion, 9);assert.deepEqual(result.state.ingredients,{beans:0,milk:0});assert.deepEqual(result.state.counters,legacy.counters);assert.deepEqual(legacy,before);
 const current=createEngine(result.state),price=legacy.counters[1].brew.price,served=[];for(let i=0;i<3000;i++){current.advance(.05);served.push(...current.drainEvents().filter(e=>e.type==='served'&&e.counterId==='counter-b'));}
 assert.equal(served.length,1);assert.equal(served[0].amount,price);assert.deepEqual(current.state.ingredients,{beans:0,milk:0});
});
test('COUNTER-004 file5 keeps exact original integrity and stock; new writes use file6',async()=>{
 const state=createInitialState();state.economyVersion=5;state.ingredients={beans:0,milk:7};state.counters[1].level=9;
 const payload={gameSchemaVersion:1,economyVersion:5,offlinePolicyVersion:4,saveId:'legacy-stock-file',revision:9,savedAt:0,exportedAt:1,overview:overviewOf(state),state};const payloadText=JSON.stringify(payload);const text=JSON.stringify({format:'mellow-bean-portable-save',formatVersion:5,payloadText,integrity:{algorithm:'SHA-256',sha256:createHash('sha256').update(payloadText).digest('hex')}});
 const parsed=await parsePortableSave(text);assert.equal(parsed.ok,true);assert.equal(parsed.file.text,text);assert.equal(parsed.file.payload.economyVersion, 9);assert.deepEqual(parsed.file.payload.state.ingredients,{beans:0,milk:7});assert.equal(parsed.file.payload.state.counters[1].level,9);
 const written=await createPortableSave(parsed.file.payload);assert.equal(JSON.parse(written.text).formatVersion, 9);assert.equal((await parsePortableSave(written.text)).ok,true);
});
test('COUNTER-005 interrupted server migration fixes the old cutoff and preserves every owed interval exactly once',async()=>{
 const initial=createInitialState();initial.ingredients={beans:120,milk:80};initial.counters.forEach(c=>{c.recipe='latte';c.level=2;});initial.coffeeLevels.latte=4;initial.economyVersion=5;
 const firstEndpoint=300100,laterEndpoint=601100;
 const first=await transition(envelope(initial),0,0,firstEndpoint,{type:'sync'},false,uuid());assert.equal(first.remainingMs,100);assert.equal(first.ruleCutoverAt,firstEndpoint);assert.equal(JSON.parse(first.raw).state.economyVersion, 9);
 let result=first;do{result=await transition(result.raw,0,0,laterEndpoint,{type:'sync'},false,uuid(),result.ruleCutoverAt,result.coffeeCutoverAt);}while(result.remainingMs);
 const legacy=createEngine(initial,undefined,{legacyCounterBonuses:true,legacyCoffeeLevels:true});legacy.applyOffline(firstEndpoint/1000,'legacy-owed',4);const current=createEngine(legacy.snapshot());current.applyOffline((laterEndpoint-firstEndpoint)/1000,'current-owed',4);
 assert.deepEqual(business(result.raw),business(envelope(current.snapshot(),laterEndpoint)));assert.equal(result.ruleCutoverAt,0);assert.equal(JSON.parse(result.raw).savedAt,laterEndpoint);
 const again=await transition(result.raw,0,0,laterEndpoint,{type:'sync'},false,uuid());assert.deepEqual(business(again.raw),business(result.raw));assert.equal(decode(again.raw).ok,true);
});
