// Local synthetic QA only. Never deploy this server or trust its test identity outside this origin.
import {createServer} from 'node:http';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,verifySource} from './verify.mjs';
import {scenario,scenarioNames} from './fixtures.mjs';
const {ManualSync}=await import('../src/cloud/manual.ts');
const {LocalSaveRepository}=await import('../src/slice/core/persistence.ts');
class MemoryStorage{values=new Map();get length(){return this.values.size;}key(i){return [...this.values.keys()][i]??null;}getItem(k){return this.values.get(k)??null;}setItem(k,v){this.values.set(k,String(v));}removeItem(k){this.values.delete(k);}}
const identity='synthetic-local-qa';
export async function startQaServer(port=0){
 const provenance=await verifySource();const {default:worker}=await import('../dist/server/index.js');
 const sqlite=new DatabaseSync(':memory:');for(const f of readdirSync(resolve(root,'drizzle')).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(readFileSync(resolve(root,'drizzle',f),'utf8'));
 const DB={prepare(sql){let args=[];return{bind(...v){args=v;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {success:true,meta:sqlite.prepare(sql).run(...args)};}};},async batch(q){sqlite.exec('BEGIN');try{const rows=[];for(const x of q)rows.push(await x.run());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const requests=[];const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
 let origin;
 const server=createServer(async(req,res)=>{try{
  res.setHeader('Cache-Control','no-store');if(req.headers.host!==new URL(origin).host){res.writeHead(400);res.end('Local QA host required');return;}
  const url=new URL(req.url,origin);const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname==='/__qa/health'){json({mode:'synthetic-only',...provenance,scenarios:scenarioNames});return;}
  if(url.pathname==='/__qa/requests'){json(requests);return;}
  if(url.pathname==='/__qa/seed'){
   const name=url.searchParams.get('scenario')??'initial';if(!scenarioNames.includes(name)){json({error:'unknown_scenario'},400);return;}
   const state=scenario(name),memory=new MemoryStorage(),manual=new ManualSync(identity,memory),repository=new LocalSaveRepository(manual.storage());repository.load(Date.now());const saved=repository.save(state,Date.now());if(!saved.ok)throw Error(saved.message);
   const branch=JSON.parse(memory.getItem(manual.key));branch.frozen=true;memory.setItem(manual.key,JSON.stringify(branch));
   json({scenario:name,userId:identity,state,storage:[...memory.values]});return;
  }
  if(url.pathname.startsWith('/api/')){
   if(requests.length<1000)requests.push({method:req.method,path:url.pathname});
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>524288){json({error:'too_large'},413);return;}chunks.push(chunk);}
   const headers=new Headers({'oai-authenticated-user-id':identity});for(const key of ['content-type','origin'])if(typeof req.headers[key]==='string')headers.set(key,req.headers[key]);
   const response=await worker.fetch(new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}),{DB});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const client=resolve(root,'dist/client'),path=resolve(client,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!path.startsWith(client+'/')){res.writeHead(400);res.end();return;}
  const data=readFileSync(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500,{'Content-Type':'text/plain'});res.end(e.code==='ENOENT'?'Not found':'Synthetic QA request failed');}});
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});origin='http://127.0.0.1:'+server.address().port;
 return {origin,requests,sqlite,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sqlite.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.COFFEE_QA_PORT??0);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid local port');const qa=await startQaServer(port);console.log(JSON.stringify({origin:qa.origin,mode:'synthetic-only'}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void qa.close().then(()=>process.exit(0)));
}
