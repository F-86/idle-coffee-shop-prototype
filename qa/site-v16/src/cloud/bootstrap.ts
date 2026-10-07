import {ManualSync,summarize,MANUAL_PREFIX} from './manual';
import {request,readBranches,PREFIX} from './sync';
import {decode} from '../slice/core/persistence';
import {setManualSync,setCloudStorage} from './bridge';
import './cloud.css';
import {identityBootstrap,readSiteIdentity,type IdentityStatus} from './identity';
function identityGate(status:IdentityStatus){
 if(status==='ready')return;
 const gate=document.createElement('section');gate.className='identity-gate';gate.setAttribute('role','status');
 const title=document.createElement('h1');title.textContent=status==='startup-error'?'小店暂时未能打开':status==='loading'?'正在打开小店…':status==='signin'?'请登录后打开小店':'暂时无法确认登录状态';
 const note=document.createElement('p');note.textContent=status==='startup-error'?'请重新打开页面，无需清除浏览器存档。':status==='loading'?'正在确认当前账户。':status==='signin'?'登录后才能读取这个账户的小店。原有存档保持不变。':'原有存档保持不变，请检查网络后重试。';gate.append(title,note);
 if(status==='startup-error'){document.querySelectorAll('.cloud-status,.manual-sync-dialog').forEach(node=>node.remove());const reload=document.createElement('button');reload.textContent='重新打开小店';reload.onclick=()=>location.reload();gate.append(reload);}
 else if(status!=='loading'){
  const retry=document.createElement('button');retry.textContent='重试';retry.onclick=()=>void start();gate.append(retry);
  const login=document.createElement('a');login.textContent='使用 ChatGPT 登录';const path=location.pathname.startsWith('/')&&!location.pathname.startsWith('//')?location.pathname+location.search:'/';login.href='/signin-with-chatgpt?return_to='+encodeURIComponent(path);login.target='_top';gate.append(login);
 }
 document.querySelector('#slice-root')?.replaceChildren(gate);
}
async function mountGame(userId:string){
let manual:ManualSync;
try{manual=new ManualSync(userId,localStorage);}catch(error){
 const gate=document.createElement('section');gate.style.cssText='max-width:34rem;margin:10vh auto;padding:2rem;background:#fff6e9;color:#3d3025;border-radius:1rem';const title=document.createElement('h1');title.textContent='本机存档暂时无法写入';const note=document.createElement('p');note.textContent='原有进度没有被替换。请先导出可读取的备份，再检查浏览器存储空间或权限并刷新。';gate.append(title,note);
 try{const owner=userId;let count=0;for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i)!;const value=localStorage.getItem(key);if(!value)continue;let raw:string|null=null;if(key==='mellow-bean:authority:v2:'+encodeURIComponent(owner)+':confirmed')raw=value;else if(key.startsWith(MANUAL_PREFIX)||key.startsWith(PREFIX)){try{const b=JSON.parse(value);if(b.userId===owner&&typeof b.raw==='string')raw=b.raw;}catch{}}if(raw){const snapshot=raw,b=document.createElement('button');b.textContent='导出本机备份 '+(++count);b.onclick=()=>void exportBackup(snapshot);gate.append(b);}}}catch{}
 const retry=document.createElement('button');retry.textContent='重新打开小店';retry.onclick=()=>location.reload();gate.append(retry);document.querySelector('#slice-root')?.replaceChildren(gate);return;
}
setManualSync(manual);setCloudStorage(manual.storage());
const shell=document.createElement('dialog');shell.className='manual-sync-dialog';shell.setAttribute('aria-label','手动同步选择');document.body.append(shell);
manual.onChoice=(cloud,raw)=>{shell.replaceChildren();const h=document.createElement('h2');h.textContent='请选择要保留的进度';const p=document.createElement('p');p.style.whiteSpace='pre-line';p.textContent=`本机\n${summarize(raw)}\n\n云端\n${summarize(cloud.raw)}\n\n不会合并金币；覆盖或下载前会备份。下载只取快照，不补发云端文件期间收益。`;shell.append(h,p);
 return new Promise(resolve=>{const finish=(value:'upload'|'download'|'cancel')=>{shell.close();resolve(value);};for(const[label,value]of[['上传本机覆盖云端','upload'],['下载云端覆盖本机','download'],['取消','cancel']]as const){const b=document.createElement('button');b.textContent=label;b.disabled=value==='download'&&!cloud.raw;b.onclick=()=>finish(value);shell.append(b);}shell.oncancel=e=>{e.preventDefault();finish('cancel');};shell.showModal();});};
const button=document.createElement('button');button.className='cloud-status';button.textContent='☁ 同步';button.setAttribute('aria-label','手动同步当前进度到云端');button.onclick=()=>window.dispatchEvent(new CustomEvent('coffee-manual-sync',{detail:{mode:'sync'}}));document.body.append(button);
manual.onMessage=text=>window.dispatchEvent(new CustomEvent('coffee-manual-message',{detail:text}));
await import('../slice/main');
const download=document.createElement('button');download.textContent='下载云存档';download.className='secondary-button';download.onclick=()=>window.dispatchEvent(new CustomEvent('coffee-manual-sync',{detail:{mode:'download'}}));document.querySelector('#files-panel')?.append(download);
async function exportBackup(raw:string){const parsed=decode(raw);if(!parsed.ok)return;const {createPortableSave,overviewOf}=await import('../slice/core/portableSave');const e=parsed.envelope;const file=await createPortableSave({gameSchemaVersion:1,economyVersion:e.state.economyVersion,offlinePolicyVersion:4,saveId:e.saveId??crypto.randomUUID(),revision:e.revision??1,savedAt:e.savedAt,exportedAt:Date.now(),overview:overviewOf(e.state),state:e.state});const a=document.createElement('a'),url=URL.createObjectURL(new Blob([file.text],{type:'application/json'}));a.href=url;a.download='mellow-bean-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const backups=document.createElement('details');backups.className='quiet-details';const title=document.createElement('summary');title.textContent='旧版与同步前备份';backups.append(title);const list=document.createElement('div');list.className='settings-grid';backups.append(list);
backups.addEventListener('toggle',()=>{if(!backups.open)return;list.replaceChildren();const rows=readBranches(localStorage,manual.userId).filter(b=>b.raw).map(b=>({label:'旧版本机进度',raw:b.raw!,createdAt:b.updatedAt}));for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(MANUAL_PREFIX+encodeURIComponent(manual.userId)+':branch:')&&key!==manual.key){try{const b=JSON.parse(localStorage.getItem(key)!);if(b.userId===manual.userId&&typeof b.raw==='string')rows.push({label:'其他标签页／旧会话的本机进度',raw:b.raw,createdAt:b.updatedAt});}catch{}}if(!key?.startsWith(PREFIX+'backup:'))continue;try{const b=JSON.parse(localStorage.getItem(key)!);if(b.userId===manual.userId&&typeof b.raw==='string')rows.push(b);}catch{}}rows.sort((a,b)=>b.createdAt-a.createdAt);for(const row of rows){const b=document.createElement('button');b.textContent=`${row.label} · ${new Date(row.createdAt).toLocaleString()}`;b.onclick=()=>void exportBackup(row.raw);list.append(b);}const remote=document.createElement('button');remote.textContent='下载云端历史备份';remote.onclick=async()=>{remote.disabled=true;try{const r=await request('/api/backups') as unknown as {userId:string;backups:{raw:string;createdAt:number}[]};if(r.userId!==manual.userId)throw Error('账户已变化');for(const b of r.backups){const item=document.createElement('button');item.textContent=`云端备份 · ${new Date(b.createdAt).toLocaleString()}`;item.onclick=()=>void exportBackup(b.raw);list.append(item);}}catch{manual.onMessage('暂时无法读取云端备份');}finally{remote.disabled=false;}};list.append(remote);});document.querySelector('#files-panel')?.append(backups);

// A local-only read tool never triggers a game API request.
const context=(document as Document&{modelContext?:{registerTool:(tool:unknown)=>Promise<void>}}).modelContext;
if(context?.registerTool)void Promise.resolve(context.registerTool({name:'read_coffee_save_status',title:'读取本机小店状态',description:'只读取本机快照和上次手动同步版本，不请求服务器或推进时间。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw Error('No parameters accepted');return{mode:'manual',revision:manual.branch.baseRevision,syncing:manual.busy,summary:summarize(manual.branch.raw)};}})).catch(()=>{});

}
const start=identityBootstrap(readSiteIdentity,mountGame,identityGate);
void start();
