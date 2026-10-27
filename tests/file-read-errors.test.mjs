import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {uid} from '../finance.js';

test('original file reads distinguish missing bytes from authentication, server and transport failures',async()=>{
 const original=globalThis.fetch;
 const source=(await readFile(new URL('../db.js',import.meta.url),'utf8')).replace("from './finance.js'",`from '${new URL('../finance.js',import.meta.url).href}'`);
 const db=await import('data:text/javascript;base64,'+Buffer.from(source+`\nexport function setTestMode(){mode='remote'}\n// ${uid()}`).toString('base64'));
 db.setTestMode();
 try{
  const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  for(const [status,message] of [[404,'missing'],[401,'Sign in required'],[503,'Storage unavailable']]){
   globalThis.fetch=async path=>String(path)==='/api/v1/projects'?json({items:[{id:'test-project',name:'Test project'}]}):String(path).startsWith('/api/v1/state?')?json({rev:1,project:{name:'Test project',budget:0},files:[{id:'file',name:'invoice.txt'}]}):json({message},status);
   if(status===404){assert.equal(await db.readFile('file','test-project'),undefined);await assert.rejects(()=>db.readSnapshot('test-project'),/Required original file is missing: invoice.txt/)}
   else{await assert.rejects(()=>db.readFile('file','test-project'),error=>error.status===status&&error.message===message);await assert.rejects(()=>db.readSnapshot('test-project'),error=>error.status===status)}
  }
  globalThis.fetch=async()=>{throw Error('Connection interrupted')};
  await assert.rejects(()=>db.readFile('file','test-project'),/Connection interrupted/);
 }finally{globalThis.fetch=original}
});
