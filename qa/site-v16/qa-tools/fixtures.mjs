import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
const {createInitialState,createEngine}=await import('../src/slice/core/engine.ts');
const {addFurniture,interactionPoint}=await import('../src/slice/core/layout.ts');
const {validateState}=await import('../src/slice/core/persistence.ts');
export const scenarioNames=['initial','partial-expansion','maximum-expansion','counter-wait','seat-wait','brewing-level14'];
function until(engine,predicate){for(let i=0;i<4000;i++){if(predicate(engine.state))return engine.snapshot();engine.advance(.05);}throw Error('Synthetic scenario did not converge');}
export function scenario(name){
 let state;
 if(name==='initial'){state=createInitialState();state.paused=true;}
 else if(name==='partial-expansion'||name==='maximum-expansion'){
  const seed=createInitialState();seed.wallet+=1000000;seed.totalEarned+=1000000;seed.totalServed=40;seed.counters[0].brewed=40;seed.paused=true;
  const e=createEngine(seed);e.beginLayoutEdit();const draft=e.createLayoutDraft();draft.widthSteps=3;draft.depthSteps=name==='maximum-expansion'?3:2;draft.expanded=true;const result=e.commitLayout(draft);if(!result.ok)throw Error(result.message);state=e.snapshot();
 }else if(name==='counter-wait'){
  const e=createEngine();e.togglePause();e.beginLayoutEdit();const draft=e.createLayoutDraft();draft.furniture[1].rotation=2;if(!e.commitLayout(draft).ok)throw Error('Counter fixture failed');e.togglePause();const point=interactionPoint(draft.furniture[1],'service');
  state=until(e,s=>s.customers.some(c=>c.counterId==='counter-b'&&c.phase==='leaving'&&!c.nav?.length&&c.x===point.x&&c.z===point.z));
 }else if(name==='seat-wait'){
  const e=createEngine();e.togglePause();e.beginLayoutEdit();const draft=e.createLayoutDraft(),table=addFurniture(draft,'table',-4,4);table.rotation=2;if(!e.commitLayout(draft).ok)throw Error('Seat fixture failed');e.togglePause();const point=interactionPoint(table,'seat');
  state=until(e,s=>s.customers.some(c=>c.phase==='leaving'&&!c.nav?.length&&c.x===point.x&&c.z===point.z));
 }else if(name==='brewing-level14'){
  const seed=createInitialState();seed.wallet+=1000000;seed.totalEarned+=1000000;const e=createEngine(seed);for(let i=1;i<14;i++)if(!e.upgrade('counter-a'))throw Error('Upgrade fixture failed');e.invite();e.togglePause();state=until(e,s=>!!s.counters[0].brew);
 }else throw Error('Unknown synthetic scenario');
 const checked=validateState(state);if(!checked.ok)throw Error(name+': '+checked.message);return state;
}
