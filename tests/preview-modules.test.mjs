import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewServer} from '../dev-server.mjs';

test('local preview serves every transitive application module and rejects private paths',async()=>{
 const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,visited=new Set();
 try{
  async function module(name){if(visited.has(name))return;visited.add(name);const response=await fetch(base+'/'+name);assert.equal(response.status,200,name);assert.match(response.headers.get('content-type'),/javascript/);const source=await response.text();for(const match of source.matchAll(/\bfrom\s*['"]\.\/([^'"]+)['"]/g))await module(match[1])}
  await module('app.js');assert.ok(visited.has('project-export.js'));
  for(const name of ['.env','server/sqlite-store.mjs','package.json','../MEMORY.md'])assert.equal((await fetch(base+'/'+name)).status,404,name);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
