export class IdentityFailure extends Error {readonly kind:'signin'|'unavailable';constructor(kind:'signin'|'unavailable'){super(kind);this.kind=kind;}}
export async function readSiteIdentity(fetcher:typeof fetch=fetch):Promise<string>{
 const response=await fetcher('/api/identity',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(response.status===401||response.status===403)throw new IdentityFailure('signin');
 if(!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))throw new IdentityFailure('unavailable');
 const body=await response.json();if(body?.authenticated!==true||typeof body.userId!=='string'||!body.userId.trim()||body.userId.length>512)throw new IdentityFailure('unavailable');
 return body.userId;
}
export type IdentityStatus='loading'|'signin'|'unavailable'|'startup-error'|'ready';
// One attempt per page or explicit Retry. No timers, polling, reconnect hooks,
// cached owner fallback, or access to browser save data before onReady.
export function identityBootstrap(lookup:()=>Promise<string>,onReady:(userId:string)=>Promise<void>,onStatus:(status:IdentityStatus)=>void){
 let inFlight:Promise<void>|null=null,ready=false,failedMount=false;
 return function start():Promise<void>{
  if(ready||failedMount)return Promise.resolve();if(inFlight)return inFlight;
  inFlight=(async()=>{onStatus('loading');try{const userId=await lookup();try{await onReady(userId);}catch{failedMount=true;onStatus('startup-error');return;}ready=true;onStatus('ready');}catch(error){onStatus(error instanceof IdentityFailure?error.kind:'unavailable');}finally{inFlight=null;}})();return inFlight;
 };
}
