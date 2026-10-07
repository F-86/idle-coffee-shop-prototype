import test from 'node:test';import assert from 'node:assert/strict';import {startQaServer} from './server.mjs';
test('QA server serves the unchanged build, synthetic identity and valid seeds without production access',async()=>{
 const qa=await startQaServer();try{
  const health=await fetch(qa.origin+'/__qa/health').then(r=>r.json());assert.equal(health.sourceCommit,'94c1ba2515e0f34fe64baa98cd932e4a28589849');assert.equal(health.mode,'synthetic-only');
  const document=await fetch(qa.origin+'/?qa=1').then(r=>r.text());assert.match(document,/slice-root/);assert.doesNotMatch(document,/coffee-owner/);
  const identity=await fetch(qa.origin+'/api/identity').then(r=>r.json());assert.equal(identity.authenticated,true);assert.equal(identity.userId,'synthetic-local-qa');assert.equal(qa.sqlite.prepare('SELECT COUNT(*) AS n FROM coffee_saves').get().n,0);
  for(const name of health.scenarios){const response=await fetch(qa.origin+'/__qa/seed?scenario='+name);assert.equal(response.status,200,name);const seed=await response.json();assert.equal(seed.userId,identity.userId);assert.equal(seed.storage.length,1);const branch=JSON.parse(seed.storage[0][1]);assert.equal(branch.frozen,true);assert.deepEqual(JSON.parse(branch.raw).state,seed.state);}
  assert.equal((await fetch(qa.origin+'/__qa/seed?scenario=unknown')).status,400);
  const forbidden=await fetch(qa.origin+'/api/save',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{}'});assert.equal(forbidden.status,403);assert.equal(qa.sqlite.prepare('SELECT COUNT(*) AS n FROM coffee_saves').get().n,0);
  assert.equal((await fetch(qa.origin+'/.openai/hosting.json')).status,404);
 }finally{await qa.close();}
});
