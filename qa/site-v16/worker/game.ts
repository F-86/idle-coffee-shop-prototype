import {isCounterId} from '../src/slice/core/furnitureIds';
import { createEngine, createInitialState } from '../src/slice/core/engine';
import { decode, validateState, type Envelope } from '../src/slice/core/persistence';
import { parsePortableSave } from '../src/slice/core/portableSave';
import type { GameCommand } from '../src/cloud/commands';
export const PRESENCE_MS=8000, MAX_CATCHUP_MS=300000;
export interface Transition {raw:string;remainingMs:number;commandApplied:boolean;message:string;onlineUntil:number;isNew:boolean;offlineAmount:number;ruleCutoverAt:number;coffeeCutoverAt:number}
export function validCommand(value:any):value is GameCommand {
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.type!=='string')return false;
 const keys:Record<string,string[]>={sync:['type'],'set-pause':['type','paused'],invite:['type'],'upgrade-counter':['type','counterId'],'set-recipe':['type','counterId','recipe'],'buy-ingredient':['type','ingredient','mode','expectedCost','expectedQuantity'],'commit-layout':['type','layout'],'dismiss-migration':['type'],import:['type','fileText','confirm'],reset:['type','confirm']};
 const allowed=keys[value.type];if(!allowed||Object.keys(value).some(k=>!allowed.includes(k))||allowed.some(k=>!(k in value)))return false;
 const recipe=(x:unknown)=>x==='espresso'||x==='latte',counter=isCounterId;
 switch(value.type){case'set-pause':return typeof value.paused==='boolean';case'upgrade-counter':return counter(value.counterId);case'set-recipe':return counter(value.counterId)&&recipe(value.recipe);case'buy-ingredient':return ['beans','milk'].includes(value.ingredient)&&['one','batch','fill'].includes(value.mode)&&Number.isSafeInteger(value.expectedCost)&&value.expectedCost>=0&&Number.isSafeInteger(value.expectedQuantity)&&value.expectedQuantity>=0;case'commit-layout':return !!value.layout&&typeof value.layout==='object'&&JSON.stringify(value.layout).length<65536;case'import':return value.confirm===true&&typeof value.fileText==='string'&&new TextEncoder().encode(value.fileText).length<=262144;case'reset':return value.confirm===true;default:return true;}
}
export async function transition(raw:string|null,onlineUntil:number,oldLeaseUntil:number,now:number,command:GameCommand,visible:boolean,opId:string,storedCutover=0,storedCoffeeCutover=0):Promise<Transition>{
 const parsed=raw===null?null:decode(raw);if(parsed&&!parsed.ok)throw Error('unsupported_saved_state');
 const prior=parsed?.ok?parsed.envelope:null;
 const start=prior?.savedAt??now,isNew=!prior;
 const sourceVersion=raw===null?7:JSON.parse(raw).state.economyVersion;
 if(sourceVersion<5)throw Error('unsupported_legacy_cloud_state');
 const cutover=storedCutover>start?storedCutover:sourceVersion===5?Math.max(start,now):0;
 const coffeeCutover=storedCoffeeCutover>start?storedCoffeeCutover:sourceVersion<=6?Math.max(start,now):0;
 let engine=createEngine(prior?.state??createInitialState(),undefined,{legacyCounterBonuses:cutover>start,legacyCoffeeLevels:coffeeCutover>start});let anchor=start,offlineAmount=0;
 // Explicit replacement does not convert file age into rewards. Previous raw is
 // backed up by the same D1 CAS transaction before it installs this state.
 if(command.type==='import'||command.type==='reset'){
  if(command.type==='import'){
   const imported=await parsePortableSave(command.fileText);if(!imported.ok)throw Error('invalid_import: '+imported.message);
   engine=createEngine(imported.file.payload.state);
  }else engine=createEngine(createInitialState());
  const e:Envelope={schemaVersion:1,saveId:crypto.randomUUID(),revision:1,offlinePolicyVersion:4,savedAt:Math.max(now,start),recordChangeTag:opId,state:engine.snapshot()};
  return {raw:JSON.stringify(e),remainingMs:0,commandApplied:true,message:command.type==='import'?'已备份并导入云端小店':'新店已在服务器建立',onlineUntil:visible?now+PRESENCE_MS:0,isNew:command.type==='reset',offlineAmount:0,ruleCutoverAt:0,coffeeCutoverAt:0};
 }
 const onlineEnd=Math.max(start,Math.min(now,onlineUntil,oldLeaseUntil));
 const end=Math.max(start,Math.min(now,start+MAX_CATCHUP_MS));
 const boundaries=[...new Set([start,end,Math.min(end,Math.max(start,onlineEnd)),Math.min(end,Math.max(start,cutover)),Math.min(end,Math.max(start,coffeeCutover))])].sort((a,b)=>a-b);
 for(let i=1;i<boundaries.length;i++){
  const segmentStart=boundaries[i-1],segmentEnd=boundaries[i];if(segmentEnd<=segmentStart)continue;
  engine=createEngine(engine.snapshot(),undefined,{legacyCounterBonuses:cutover>segmentStart,legacyCoffeeLevels:coffeeCutover>segmentStart});
  if(segmentStart<onlineEnd){engine.advance((segmentEnd-segmentStart)/1000);anchor=segmentEnd;}
  else if(engine.state.paused){anchor=now;break;}
  else{const before=engine.state.wallet;const job=engine.beginOffline((segmentEnd-segmentStart)/1000,`server:${opId}:${i}`,4);if(!job.accepted)throw Error('simulation_limit');job.advance(Number.MAX_SAFE_INTEGER);if(!job.done)throw Error('simulation_incomplete');offlineAmount+=engine.state.wallet-before;anchor=segmentEnd;}
 }
 if(now===start)anchor=now;
 const remainingMs=Math.max(0,now-anchor);
 let applied=false,message=remainingMs?'正在核算离线经营…':'已同步';
 if(!remainingMs){
  switch(command.type){
   case'sync':applied=true;break;
   case'set-pause':if(engine.state.paused!==command.paused)engine.togglePause();applied=true;message=command.paused?'已暂停接待新客':'小店恢复营业';break;
   case'invite':applied=engine.invite();message=applied?'客人正走进小店':'暂时无法招客';break;
   case'upgrade-counter':applied=engine.upgrade(command.counterId);message=applied?'柜台已升级':'余额不足或已达上限';break;
   case'set-recipe':applied=engine.setRecipe(command.counterId,command.recipe);message=applied?'下一杯开始使用新配方':'配方未改变';break;
   case'buy-ingredient':{const q=engine.ingredientQuote(command.ingredient,command.mode);if(q.cost!==command.expectedCost||q.quantity!==command.expectedQuantity){message='库存刚有变化，请核对新价格再购买';break;}applied=engine.buyIngredient(command.ingredient,command.mode);message=applied?'原料已入库':'余额不足或库存已满';break;}
   case'commit-layout':{if(!engine.beginLayoutEdit()||engine.layoutEditStatus()!=='ready'){message='请先暂停，等客人离店后再完成布置';break;}const result=engine.commitLayout(command.layout);applied=result.ok;message=result.message;break;}
   case'dismiss-migration':delete engine.state.doorMigrationNotice;applied=true;break;
  }
 }
 const checked=validateState(engine.snapshot());if(!checked.ok)throw Error('invalid_transition: '+checked.message);
 const e:Envelope={schemaVersion:1,saveId:prior?.saveId??crypto.randomUUID(),revision:(prior?.revision??0)+1,offlinePolicyVersion:4,savedAt:anchor,recordChangeTag:opId,state:checked.state,importedFileHashes:prior?.importedFileHashes};
 return {raw:JSON.stringify(e),remainingMs,commandApplied:applied,message,onlineUntil:remainingMs?onlineUntil:visible?now+PRESENCE_MS:0,isNew,offlineAmount,ruleCutoverAt:anchor<cutover?cutover:0,coffeeCutoverAt:anchor<coffeeCutover?coffeeCutover:0};
}
