import type {D1Database} from '@cloudflare/workers-types';
import {database} from './database';
import {decode} from '../src/slice/core/persistence';
interface Env{DB?:D1Database;ASSETS?:{fetch(request:Request):Promise<Response>}}
interface Row{raw:string|null;revision:number;updated_at:number}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(s);
const snapshot=(r:Row|null)=>({raw:r?.raw??null,revision:r?.revision??0,updatedAt:r?.updated_at??0,protocol:3});
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function api(request:Request,env:Env,now=Date.now()):Promise<Response>{
 const user=request.headers.get('oai-authenticated-user-id');if(!user?.trim())return json({error:'signin_required'},401);
 const reply=(body:Record<string,unknown>,status=200)=>json({userId:user,...body},status),url=new URL(request.url);
 // Static assets may bypass the Worker; identity is resolved once via this
 // non-game endpoint. It never opens D1 or reads/writes a shop.
 if(url.pathname==='/api/identity')return request.method==='GET'?reply({authenticated:true}):reply({error:'method_not_allowed'},405);
 // Old open pages must never continue server-owned simulation or lease traffic.
 if(url.pathname==='/api/command'||url.pathname==='/api/session')return reply({error:'manual_sync_required',message:'已改为手动同步，请刷新页面。'},410);
 if(!['/api/save','/api/backups'].includes(url.pathname))return reply({error:'not_found'},404);
 const db=database(env),read=()=>db.prepare('SELECT raw, revision, updated_at FROM coffee_saves WHERE user_id = ?').bind(user).first<Row>();
 if(request.method==='GET'&&url.pathname==='/api/save')return reply({...snapshot(await read()),serverNow:now});
 if(request.method==='GET'&&url.pathname==='/api/backups'){const rows=await db.prepare('SELECT id, raw, reason, created_at AS createdAt FROM coffee_backups WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(user).all();return reply({backups:rows.results});}
 if(request.method!=='POST'||url.pathname!=='/api/save')return reply({error:'method_not_allowed'},405);
 if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({error:'origin_rejected'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'json_required'},415);
 if(Number(request.headers.get('Content-Length'))>600000)return reply({error:'too_large'},413);
 const text=await request.text();if(new TextEncoder().encode(text).length>600000)return reply({error:'too_large'},413);
 let b:any;try{b=JSON.parse(text);}catch{return reply({error:'bad_json'},400);}
 if(b?.expectedUser!==user)return reply({error:'identity_changed'},401);
 if(b.protocol!==3||!uuid(b.opId)||!Number.isSafeInteger(b.revision)||b.revision<0||typeof b.raw!=='string'||new TextEncoder().encode(b.raw).length>262144||Object.keys(b).some(k=>!['protocol','expectedUser','opId','revision','raw'].includes(k)))return reply({error:'invalid_manual_save'},400);
 const parsed=decode(b.raw);if(!parsed.ok)return reply({error:'invalid_save',message:parsed.message},422);
 if(parsed.envelope.savedAt>now+120000)return reply({error:'clock_ahead',message:'设备时间超前，请校准时间后再同步。'},422);
 const digest=await hash(JSON.stringify([3,b.revision,b.raw]));
 const prior=await db.prepare('SELECT hash, revision FROM coffee_operations WHERE user_id = ? AND op_id = ?').bind(user,b.opId).first<{hash:string;revision:number}>();
 if(prior)return prior.hash===digest?reply({acceptedRevision:prior.revision,replayed:true,...snapshot(await read())}):reply({error:'operation_reused'},400);
 await db.batch([
  db.prepare('INSERT INTO coffee_saves (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING').bind(user),
  db.prepare('INSERT INTO coffee_operations (user_id, op_id, hash, revision, created_at, previous_raw) SELECT user_id, ?, ?, revision + 1, ?, raw FROM coffee_saves WHERE user_id = ? AND revision = ? ON CONFLICT(user_id, op_id) DO NOTHING').bind(b.opId,digest,now,user,b.revision),
  db.prepare('INSERT INTO coffee_backups (user_id, id, raw, reason, created_at) SELECT user_id, ?, raw, ?, ? FROM coffee_saves WHERE user_id = ? AND raw IS NOT NULL AND revision = ? AND EXISTS (SELECT 1 FROM coffee_operations WHERE user_id = ? AND op_id = ? AND hash = ? AND revision = coffee_saves.revision + 1) ON CONFLICT(user_id,id) DO NOTHING').bind(b.opId,'manual-sync',now,user,b.revision,user,b.opId,digest),
  db.prepare('UPDATE coffee_saves SET raw = ?, revision = revision + 1, updated_at = ?, protocol = 3, session = NULL, lease_until = 0, online_until = 0, counter_rule_cutover = 0, last_op = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM coffee_operations WHERE user_id = ? AND op_id = ? AND hash = ? AND revision = coffee_saves.revision + 1)').bind(b.raw,now,b.opId,user,b.revision,user,b.opId,digest),
  db.prepare('UPDATE coffee_operations SET previous_raw = NULL WHERE user_id = ? AND revision < (SELECT revision - 16 FROM coffee_saves WHERE user_id = ?)').bind(user,user),
  db.prepare('DELETE FROM coffee_operations WHERE user_id = ? AND revision < (SELECT revision - 1024 FROM coffee_saves WHERE user_id = ?)').bind(user,user),
 ]);
 const current=await read();const accepted=await db.prepare('SELECT hash, revision FROM coffee_operations WHERE user_id = ? AND op_id = ?').bind(user,b.opId).first<{hash:string;revision:number}>();
 if(!accepted)return reply({error:'revision_conflict',...snapshot(current)},409);
 if(accepted.hash!==digest)return reply({error:'operation_reused'},400);
 return reply({acceptedRevision:accepted.revision,...snapshot(current)});
}
export default{async fetch(request:Request,env:Env):Promise<Response>{try{
 if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env);
 const user=request.headers.get('oai-authenticated-user-id');if(!user)return new Response(null,{status:302,headers:{Location:'/signin-with-chatgpt?return_to=%2F','Cache-Control':'no-store'}});
 if(!env.ASSETS)return new Response('Assets unavailable',{status:503});const response=await env.ASSETS.fetch(request);
 if(!response.headers.get('Content-Type')?.includes('text/html'))return response;
 // Stable identity arrives with the ordinary authenticated document, not a game
 // API request. No save is read, simulated or written while opening the page.
 const html=await response.text(),headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');headers.delete('Content-Length');headers.delete('ETag');
 return new Response(html.replace(/<head([^>]*)>/i,`<head$1><meta name="coffee-owner" content="${encodeURIComponent(user)}">`),{status:response.status,headers});
}catch(e){console.error('Coffee sync unavailable',e instanceof Error?e.message:'error');return json({error:'temporarily_unavailable'},503);}}};
