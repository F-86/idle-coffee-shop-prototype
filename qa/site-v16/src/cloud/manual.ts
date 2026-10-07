import {decode,type StorageLike} from '../slice/core/persistence';
import {SAVE_KEY} from '../slice/core/persistence';
import {CloudFailure,request,readBranches,summarize,PREFIX as OLD_PREFIX} from './sync';
export const MANUAL_PREFIX='mellow-bean:manual:v3:';
export interface CloudSave{userId:string;raw:string|null;revision:number;updatedAt:number;acceptedRevision?:number}
interface Pending{protocol:3;expectedUser:string;opId:string;revision:number;raw:string}
interface Branch{userId:string;id:string;raw:string|null;baseRaw:string|null;baseRevision:number|null;pending:Pending|null;updatedAt:number;frozen?:boolean}
export class ManualSync{
 readonly userId:string;readonly id=crypto.randomUUID();readonly key:string;private local:Storage;private persisted:string|undefined;branch:Branch;busy=false;
 onChoice:(cloud:CloudSave,local:string|null)=>Promise<'upload'|'download'|'cancel'>=async()=> 'cancel';
 onAdopt:()=>void=()=>{};onMessage:(text:string)=>void=()=>{};
 constructor(userId:string,local:Storage){this.userId=userId;this.local=local;this.key=MANUAL_PREFIX+encodeURIComponent(userId)+':branch:'+this.id;
  const candidates:Branch[]=[];for(let i=0;i<local.length;i++){const key=local.key(i);if(!key?.startsWith(MANUAL_PREFIX+encodeURIComponent(userId)+':branch:'))continue;try{const b=JSON.parse(local.getItem(key)!);if(b.userId===userId&&(b.raw===null||typeof b.raw==='string'))candidates.push(b);}catch{}}
  candidates.reverse().sort((a,b)=>b.updatedAt-a.updatedAt);const previous=candidates[0];
  let raw=previous?.raw??null;
  if(previous?.frozen&&raw){const parsed=decode(raw);if(parsed.ok)raw=JSON.stringify({...parsed.envelope,savedAt:Math.max(Date.now(),parsed.envelope.savedAt),recordChangeTag:crypto.randomUUID()});}
  if(!previous){raw=local.getItem('mellow-bean:authority:v2:'+encodeURIComponent(userId)+':confirmed');if(!raw)raw=readBranches(local,userId)[0]?.raw??null;}
  this.branch={userId,id:this.id,raw,baseRaw:previous?.baseRaw??null,baseRevision:previous?.baseRevision??null,pending:previous?.pending??null,updatedAt:previous?.updatedAt??0};this.commit(this.branch);
 }
 private verify(){if(this.persisted!==undefined&&this.local.getItem(this.key)!==this.persisted)throw Error('本机存档已被其他操作改变，请导出当前副本后刷新');}
 private commit(next:Branch){this.verify();const b={...next,id:this.id,updatedAt:Math.max(Date.now(),next.updatedAt+1)};const text=JSON.stringify(b);this.local.setItem(this.key,text);if(this.local.getItem(this.key)!==text)throw Error('本机存档无法验证');this.persisted=text;this.branch=b;}
 storage():StorageLike{return{getItem:key=>{if(key===SAVE_KEY){this.verify();return this.branch.raw;}return this.local.getItem(MANUAL_PREFIX+encodeURIComponent(this.userId)+':local:'+key);},setItem:(key,value)=>{if(key===SAVE_KEY)this.commit({...this.branch,raw:value});else this.local.setItem(MANUAL_PREFIX+encodeURIComponent(this.userId)+':local:'+key,value);},removeItem:key=>{if(key===SAVE_KEY)this.commit({...this.branch,raw:null});else this.local.removeItem(MANUAL_PREFIX+encodeURIComponent(this.userId)+':local:'+key);}};}
 backup(raw:string|null,label:string){if(raw===null)return;const key=OLD_PREFIX+'backup:'+crypto.randomUUID(),text=JSON.stringify({userId:this.userId,createdAt:Date.now(),label,raw});this.local.setItem(key,text);if(this.local.getItem(key)!==text)throw Error('备份失败，未替换任何进度');}
 private check(cloud:CloudSave){if(cloud.userId!==this.userId)throw new CloudFailure(401,{error:'identity_changed'});if(cloud.raw!==null&&!decode(cloud.raw).ok)throw Error('云端存档版本无法安全读取');}
 private async upload(cloud:CloudSave){
  const raw=this.branch.raw;if(!raw)throw Error('请先保存本机小店');const op:Pending={protocol:3,expectedUser:this.userId,opId:crypto.randomUUID(),revision:cloud.revision,raw};this.commit({...this.branch,pending:op});
  const result=await request('/api/save',op) as unknown as CloudSave;this.check(result);if(result.acceptedRevision===undefined)throw Error('尚未确认同步结果');
  this.commit({...this.branch,baseRaw:op.raw,baseRevision:result.acceptedRevision,pending:null});
  if(result.revision!==result.acceptedRevision)throw new CloudFailure(409,{error:'revision_conflict'});
 }
 private download(cloud:CloudSave){
  if(!cloud.raw)throw Error('云端还没有存档');const parsed=decode(cloud.raw);if(!parsed.ok)throw Error(parsed.message);
  this.backup(this.branch.raw,'下载云端前的本机小店');this.backup(cloud.raw,'下载的云端原始存档');
  // A download is an explicit snapshot replacement, just like portable import.
  // Re-anchor now: never mint the cloud file's age again on repeated downloads.
  const e={...parsed.envelope,state:parsed.envelope.state,offlinePolicyVersion:4,savedAt:Date.now(),saveId:crypto.randomUUID(),revision:1,recordChangeTag:crypto.randomUUID()};
  this.commit({...this.branch,raw:JSON.stringify(e),baseRaw:cloud.raw,baseRevision:cloud.revision,pending:null});this.onAdopt();
 }
 async sync(mode:'sync'|'download'='sync'){
  if(this.busy)return;this.busy=true;
  try{
   this.commit({...this.branch,frozen:true});
   if(this.branch.pending){const op=this.branch.pending;try{const ack=await request('/api/save',op) as unknown as CloudSave;this.check(ack);if(ack.acceptedRevision===undefined)throw Error('同步结果尚未确认');this.commit({...this.branch,baseRaw:op.raw,baseRevision:ack.acceptedRevision,pending:null});}catch(e){if(!(e instanceof CloudFailure)||e.status!==409)throw e;this.commit({...this.branch,pending:null});}}
   for(;;){const cloud=await request('/api/save') as unknown as CloudSave;this.check(cloud);
    if(mode==='sync'&&(cloud.raw===null||this.branch.baseRevision===cloud.revision)){
     if(this.branch.raw===cloud.raw){this.commit({...this.branch,baseRaw:cloud.raw,baseRevision:cloud.revision});this.onMessage('本机和云端已一致');return;}
     try{await this.upload(cloud);this.onMessage('当前本机进度已同步');return;}catch(e){if(e instanceof CloudFailure&&e.status===409)continue;throw e;}
    }
    const answer=await this.onChoice(cloud,this.branch.raw);if(answer==='cancel'){this.onMessage('已保留本机和云端原有进度');return;}
    if(answer==='download'){this.download(cloud);this.onMessage('云端快照已下载到本机，未补发文件期间收益');return;}
    this.backup(this.branch.raw,'覆盖前的本机小店');this.backup(cloud.raw,'覆盖前的云端小店');
    try{await this.upload(cloud);this.onMessage('本机进度已覆盖云端；两份原存档已备份');return;}catch(e){if(e instanceof CloudFailure&&e.status===409)continue;throw e;}
   }
  }catch(e){if(e instanceof CloudFailure&&[400,413,415,422].includes(e.status)&&this.branch.pending){this.commit({...this.branch,pending:null});}this.onMessage(e instanceof CloudFailure&&e.status===401?'登录账户已变化，请刷新后再同步。原本机进度仍保留。':e instanceof CloudFailure&&e.body.message?e.body.message:e instanceof Error?e.message:'同步未完成，本机进度已保留');}
  finally{try{this.commit({...this.branch,frozen:false});}catch{this.onMessage('本机存档写入失败，请导出当前副本');}this.busy=false;}
 }
}
export {summarize};
