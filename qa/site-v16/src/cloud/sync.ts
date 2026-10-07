import { SAVE_KEY, decode, type StorageLike } from '../slice/core/persistence';
export interface CloudSnapshot {userId?:string; raw:string|null;revision:number;updatedAt:number;active:boolean;leaseUntil:number;epoch?:number;serverNow?:number;acceptedRevision?:number}
interface Pending {opId:string;raw:string;revision:number;session:string;epoch:number}
interface Branch {userId:string; raw:string|null;baseRaw:string|null;revision:number;pending:Pending|null;updatedAt:number;session:string}
const PREFIX='mellow-bean:cloud:v1:';
const uuid=()=>crypto.randomUUID();
export class CloudFailure extends Error {status:number;body:any;constructor(status:number,body:any){super(body.error??'network');this.status=status;this.body=body;}}
export async function request(path:string, body?:unknown):Promise<CloudSnapshot> {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  let result;try{result=await response.json();}catch{throw new CloudFailure(response.status,{error:'unexpected_response'});}
  if(!response.ok)throw new CloudFailure(response.status,result);
  if(body && typeof body==='object' && 'expectedUser' in body && result.userId!==body.expectedUser)throw new CloudFailure(401,{error:'identity_changed'});
  return result;
}
export function readBranches(storage:Storage,userId:string):Branch[]{
 const rows:Branch[]=[];
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(PREFIX+'branch:'))continue;
  try{const b=JSON.parse(storage.getItem(key)!);if(!b.archived&&b.updatedAt>Number(storage.getItem(PREFIX+'archived:'+b.session)||0)&&b.userId===userId&&typeof b.session==='string'&&typeof b.raw==='string'&&Number.isSafeInteger(b.revision)&&decode(b.raw).ok)rows.push(b);}catch{}
 }
 return rows.sort((a,b)=>b.updatedAt-a.updatedAt);
}
export function summarize(raw:string|null):string {if(!raw)return '尚未开店';try{const e=JSON.parse(raw);return `¥${(e.state.wallet/100).toFixed(2)} · ${e.state.totalServed} 杯 · ${e.state.paused?'暂停营业':'营业中'}\n${new Date(e.savedAt).toLocaleString()}`;}catch{return '存档需要恢复';}}
export class CloudSync {
 session=uuid(); epoch=0; online=false; blocked=false; busy=false; userId='';
 branch!:Branch; key=''; storage:StorageLike; onStatus:(text:string)=>void=()=>{}; onConflict:()=>void=()=>{};
 private checking=false;private generation=0;private timer:ReturnType<typeof setInterval>|null=null;
 private local:Storage;
 constructor(local:Storage){this.local=local;
  this.storage={getItem:(key)=>key===SAVE_KEY?this.branch.raw:this.local.getItem(this.scoped(key)),setItem:(key,value)=>{
   if(key===SAVE_KEY){if(this.blocked)throw Error('Cloud branch is protected');const parsed=decode(value);if(!parsed.ok)throw Error(parsed.message);this.commit({...this.branch,raw:value});void this.flush();}
   else this.local.setItem(this.scoped(key),value);
  },removeItem:(key)=>{if(key===SAVE_KEY){if(this.blocked)throw Error('Cloud branch is protected');this.commit({...this.branch,raw:null});}else this.local.removeItem(this.scoped(key));}};
 }
 private scoped(key:string){return PREFIX+'local:'+encodeURIComponent(this.userId)+':'+key;}
 commit(next:Branch){const candidate={...next,updatedAt:Date.now()};const text=JSON.stringify(candidate);this.local.setItem(this.key,text);if(this.local.getItem(this.key)!==text)throw Error('无法验证本地备份');this.branch=candidate;}
 persist(){this.commit(this.branch);}
 start(userId:string,cloud:CloudSnapshot,raw:string|null,epoch:number,online=true){
  this.userId=userId;this.epoch=epoch;this.online=online;this.blocked=false;this.generation++;
  this.key=PREFIX+'branch:'+this.session;
  this.branch={userId,raw,baseRaw:cloud.raw,revision:cloud.revision,pending:null,updatedAt:Date.now(),session:this.session};
  this.persist();this.local.setItem(PREFIX+'last-user',userId);
  this.onStatus(online?'云存档已连接':'离线保存在本机');
  if(this.timer)clearInterval(this.timer);this.timer=setInterval(()=>void this.check(),15000);
  window.addEventListener('online',()=>void this.check());
  window.addEventListener('coffee-cloud-retry',()=>void this.check());
 }
 async acquire(cloud:CloudSnapshot,takeover=false){if(cloud.userId&&this.userId&&cloud.userId!==this.userId)throw new CloudFailure(401,{error:'identity_changed'});const expectedUser=this.userId||cloud.userId;if(!expectedUser)throw Error('Missing identity');const result=await request('/api/session',{expectedUser,action:'acquire',revision:cloud.revision,session:this.session,takeover});this.epoch=result.epoch!;return result;}
 async replay(branch:Branch):Promise<Branch>{
  if(!branch.pending)return branch;
  // Replay exact bytes before deciding a revision mismatch: a lost response may
  // already have committed. An old/expired lease does not prevent a true replay.
  const result=await request('/api/save',{...branch.pending,expectedUser:branch.userId});
  if(result.acceptedRevision===undefined)throw Error('Missing save acknowledgement');
  const next={...branch,baseRaw:branch.pending.raw,revision:result.acceptedRevision,pending:null};
  return next;
 }
 async flush(){
  if(this.busy||this.checking||this.blocked||!this.online||!this.branch.raw)return;
  if(this.branch.raw===this.branch.baseRaw&&!this.branch.pending)return;
  this.busy=true;const gen=this.generation;
  try{
   if(!this.branch.pending){this.commit({...this.branch,pending:{opId:uuid(),raw:this.branch.raw,revision:this.branch.revision,session:this.session,epoch:this.epoch}});}
   const op=this.branch.pending!;this.onStatus('正在保存到云端…');
   const result=await request('/api/save',{...op,expectedUser:this.userId});
   if(gen!==this.generation)return;
   if(result.acceptedRevision===undefined)throw Error('Missing save acknowledgement');
   // The successor snapshot stays untouched while this operation is acknowledged.
   if(this.branch.pending?.opId===op.opId){this.commit({...this.branch,baseRaw:op.raw,revision:result.acceptedRevision,pending:null});}
   if(result.revision!==result.acceptedRevision){this.conflict();return;}
   this.onStatus(this.branch.raw===this.branch.baseRaw?'已保存到云端':'本机已保存，等待同步');
  }catch(e){
   if(gen!==this.generation)return;
   if(e instanceof CloudFailure&&[400,401,403,409,423].includes(e.status)){this.conflict();}
   else{this.online=false;this.onStatus('网络未连接 · 进度已保存在本机');}
  }finally{this.busy=false;}
  if(this.online&&!this.blocked&&this.branch.raw!==this.branch.baseRaw)queueMicrotask(()=>void this.flush());
 }
 conflict(){if(this.blocked)return;this.blocked=true;this.online=false;this.generation++;this.onStatus('存档有变化 · 已暂停');window.dispatchEvent(new Event('coffee-cloud-conflict'));this.onConflict();}
 async check(){
  if(this.blocked||this.busy||this.checking)return;
  this.checking=true;const gen=this.generation;let replayFailed=false;
  try{
   const cloud=await request('/api/save');if(cloud.userId!==this.userId){this.conflict();return;}
   if(this.branch.pending){
    try{const ack=await this.replay(this.branch);if(gen!==this.generation)return;this.commit({...this.branch,baseRaw:ack.baseRaw,revision:ack.revision,pending:null});}catch(e){if(!(e instanceof CloudFailure)||e.status!==409)throw e;replayFailed=true;}
   }
   const current=await request('/api/save');
   if(gen!==this.generation)return;
   if(current.userId!==this.userId){this.conflict();return;}
   if(current.revision!==this.branch.revision){this.conflict();return;}
   if(replayFailed){this.commit({...this.branch,pending:null});this.online=false;}
   if(this.online){await request('/api/session',{expectedUser:this.userId,action:'renew',revision:this.branch.revision,session:this.session,epoch:this.epoch});}
   else{await this.acquire(current);}
   if(gen!==this.generation)return;this.online=true;if(!this.blocked&&this.branch.raw===this.branch.baseRaw)this.onStatus('已保存到云端');
  }catch(e){if(e instanceof CloudFailure&&[400,401,403,409,423].includes(e.status))this.conflict();else{this.online=false;this.onStatus('网络未连接 · 进度已保存在本机');}}
  finally{this.checking=false;}
  if(this.online&&!this.blocked)void this.flush();
 }
 backup(raw:string|null,label:string){if(raw===null)return;const key=PREFIX+'backup:'+uuid();const text=JSON.stringify({label,userId:this.userId,createdAt:Date.now(),raw});this.local.setItem(key,text);if(this.local.getItem(key)!==text)throw Error('备份未能验证，未替换存档');}
 stop(){this.blocked=true;this.generation++;if(this.timer)clearInterval(this.timer);}
}
export {PREFIX};
