import { CloudFailure,request } from './sync';
import { SAVE_KEY,decode,type Envelope,type StorageLike } from '../slice/core/persistence';
import type { GameCommand } from './commands';
export interface ServerSnapshot {userId:string;raw:string|null;revision:number;epoch?:number;active:boolean;leaseUntil:number;serverNow?:number;acceptedRevision?:number;result?:{commandApplied:boolean;message:string;remainingMs:number;offlineAmount:number;isNew:boolean}}
interface Pending {expectedUser:string;session:string;epoch:number;revision:number;opId:string;visible:boolean;command:GameCommand}
export class AuthorityClient {
 session=crypto.randomUUID();epoch=0;revision=0;userId='';raw='';envelope!:Envelope;online=false;busy=false;remainingMs=0;isNew=false;holdForReview=false;private lastConfirmedAt=0;
 onSnapshot:()=>void=()=>{};onStatus:(text:string)=>void=()=>{};onLost:()=>void=()=>{};
 private local:Storage;private pending:Pending|null=null;private generation=0;private connecting=false;private connectJob:Promise<ServerSnapshot>|null=null;private timer:ReturnType<typeof setInterval>|null=null;private disposed=false;private presenceDirty=false;
 constructor(local:Storage){this.local=local;}
 get isFresh(){return performance.now()-this.lastConfirmedAt<=5000;}
 get canMutate(){return this.online&&!this.busy&&!this.connecting&&!this.remainingMs&&!document.hidden;}
 private key(suffix:string){return 'mellow-bean:authority:v2:'+encodeURIComponent(this.userId)+':'+suffix;}
 private setPending(op:Pending|null){const key=this.key('pending:'+(op?.opId??this.pending?.opId??''));if(op){const text=JSON.stringify(op);this.local.setItem(key,text);if(this.local.getItem(key)!==text)throw Error('无法验证操作记录，未发送操作');}else this.local.removeItem(key);this.pending=op;}
 private accept(snapshot:ServerSnapshot){
  if(snapshot.revision<this.revision)throw new CloudFailure(409,{error:'stale_response'});
  if(snapshot.userId!==this.userId)throw new CloudFailure(401,{error:'identity_changed'});
  if(!snapshot.raw)throw Error('服务器尚未返回小店');const parsed=decode(snapshot.raw);if(!parsed.ok)throw Error(parsed.message);
  this.lastConfirmedAt=performance.now();this.raw=snapshot.raw;this.envelope=parsed.envelope;this.revision=snapshot.revision;this.remainingMs=snapshot.result?.remainingMs??0;this.isNew||=snapshot.result?.isNew??false;
  try{this.local.setItem(this.key('confirmed'),this.raw);}catch{/* Server authority is durable; local cache is optional. */}
  this.onSnapshot();
 }
 async connect(takeover=false):Promise<ServerSnapshot>{
  if(this.connectJob)return this.connectJob;this.connecting=true;this.holdForReview=false;window.dispatchEvent(new Event("coffee-authority-connecting"));
  const job=this.connectOnce(takeover).finally(()=>{this.connecting=false;this.connectJob=null;});this.connectJob=job;return job;
 }
 private async connectOnce(takeover=false):Promise<ServerSnapshot>{
  while(this.busy)await new Promise(r=>setTimeout(r,20));
  this.generation++;const generation=this.generation;const guard=()=>{if(this.disposed||generation!==this.generation)throw Error('连接已取消');};guard();

  const cloud=await request('/api/save') as ServerSnapshot;guard();if(!cloud.userId)throw Error('请先登录 ChatGPT');
  if(this.userId&&cloud.userId!==this.userId)throw new CloudFailure(401,{error:'identity_changed'});this.userId=cloud.userId;
  // Recover only an existing immutable in-flight command; never resume an offline
  // game branch. A successful replay is acknowledged before a fresh session fence.
  const candidates:Pending[]=[];
  for(let i=0;i<this.local.length;i++){const key=this.local.key(i);if(!key?.startsWith(this.key('pending:')))continue;try{const value=JSON.parse(this.local.getItem(key)!);if(value.expectedUser===this.userId&&typeof value.opId==='string')candidates.push(value);}catch{}}
  const rejected:Pending[]=[];
  for(const pending of candidates){
   try{const result=await request('/api/command',pending) as ServerSnapshot;guard();this.accept(result);this.local.removeItem(this.key('pending:'+pending.opId));}
   catch(e){if(!(e instanceof CloudFailure)||![400,409,410,422].includes(e.status))throw e;rejected.push(pending);}
  }
  const current=await request('/api/save') as ServerSnapshot;guard();if(current.userId!==this.userId)throw new CloudFailure(401,{error:'identity_changed'});
  const lease=await request('/api/session',{expectedUser:this.userId,action:'acquire',session:this.session,revision:current.revision,takeover}) as ServerSnapshot;
  guard();if(lease.userId!==this.userId)throw new CloudFailure(401,{error:'identity_changed'});
  this.epoch=lease.epoch!;this.revision=lease.revision;this.pending=null;for(const rejectedOp of rejected)this.local.removeItem(this.key('pending:'+rejectedOp.opId));this.online=true;
  const result=await this.execute({type:'sync'},true,true);if(!result)throw Error('暂时无法取得服务器进度');
  return {...lease,raw:this.raw,revision:this.revision,result};
 }
 async execute(command:GameCommand,internal=false,connectCommand=false){
  if(this.holdForReview&&command.type==='sync'&&!connectCommand)return null;
  if(this.disposed||this.busy||this.connecting&&!connectCommand||!this.online||(!internal&&!this.canMutate))return null;
  this.busy=true;const generation=this.generation;this.onStatus('正在同步…');
  try{
   const op:Pending={expectedUser:this.userId,session:this.session,epoch:this.epoch,revision:this.revision,opId:crypto.randomUUID(),visible:!document.hidden,command};
   this.setPending(op);const result=await request('/api/command',op) as ServerSnapshot;
   if(generation!==this.generation||this.disposed)return null;this.accept(result);this.setPending(null);this.online=true;this.presenceDirty=op.visible!==!document.hidden;
   this.onStatus(this.remainingMs?`正在核算离线进度 · 剩余 ${Math.ceil(this.remainingMs/60000)} 分钟`:'服务器已同步');
   return result.result??null;
  }catch(e){
   if(generation!==this.generation||this.disposed)return null;
   if(e instanceof CloudFailure&&[400,422].includes(e.status)){this.setPending(null);this.onStatus('操作未通过服务器校验');if(command.type==='sync'){this.online=false;this.onLost();return null;}return {commandApplied:false,message:e.body.message??'操作未通过服务器校验',remainingMs:0,offlineAmount:0,isNew:false};}
   this.online=false;this.onStatus(e instanceof CloudFailure&&[401,409,423].includes(e.status)?'此设备已暂停 · 点此重新连接':'连接中断 · 经营操作已暂停');
   this.onLost();return null;
  }finally{this.busy=false;if(this.presenceDirty&&this.online&&!this.disposed&&!this.connecting)queueMicrotask(()=>void this.execute({type:"sync"},true));}
 }
 async reconnect(){
  if(this.busy||this.disposed)return false;
  try{await this.connect();await this.catchUp();return this.online;}catch{this.online=false;this.onStatus('此设备已暂停 · 点此重新连接');return false;}
 }
 start(){
  if(this.timer)clearInterval(this.timer);
  this.timer=setInterval(()=>{if(document.hidden)return;if(this.online){if(this.holdForReview)void this.maintainLease();else void this.execute({type:'sync'},true);}},2000);
  window.addEventListener('offline',()=>{if(this.disposed)return;this.online=false;this.generation++;this.onStatus('离线 · 经营操作已暂停');this.onLost();});
  window.addEventListener('online',()=>void this.reconnect());
  document.addEventListener('visibilitychange',()=>{this.presenceDirty=true;if(this.online)void this.execute({type:'sync'},true);else if(!document.hidden)void this.reconnect();});
 }
 private async maintainLease(){
  if(this.busy||this.connecting||!this.online||this.disposed)return;this.busy=true;const generation=this.generation;
  try{await request('/api/session',{expectedUser:this.userId,action:'renew',session:this.session,epoch:this.epoch,revision:this.revision});}
  catch{if(generation===this.generation&&!this.disposed){this.online=false;this.onStatus('连接中断，导入预览已暂停');this.onLost();}}
  finally{this.busy=false;}
 }
 async catchUp(){if(this.holdForReview)return;while(this.online&&this.remainingMs&&!this.disposed){if(this.busy||this.connecting){await new Promise(r=>setTimeout(r,50));continue;}await this.execute({type:'sync'},true);await new Promise(r=>setTimeout(r,0));}}
 storage():StorageLike{return {getItem:(key)=>key===SAVE_KEY?this.raw||null:this.local.getItem(this.key('local:'+key)),setItem:(key,value)=>{if(key===SAVE_KEY){if(value!==this.raw)throw Error('进度由服务器管理');}else this.local.setItem(this.key('local:'+key),value);},removeItem:(key)=>{if(key===SAVE_KEY)throw Error('请通过服务器确认新店');this.local.removeItem(this.key('local:'+key));}};}
 backup(raw:string,label:string){const key='mellow-bean:cloud:v1:backup:'+crypto.randomUUID(),text=JSON.stringify({userId:this.userId,createdAt:Date.now(),label,raw});this.local.setItem(key,text);if(this.local.getItem(key)!==text)throw Error('备份未能验证');}
 stop(){this.disposed=true;this.generation++;if(this.timer)clearInterval(this.timer);}
}
