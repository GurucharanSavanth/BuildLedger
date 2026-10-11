import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyState,uid,changeEntry} from '../../finance.js';

// Run the real Mongo store methods with collection contracts, without requiring a live replica set.
const source=await readFile(new URL('../../server/mongo-store.mjs',import.meta.url),'utf8');
const code=source.replace("import {MongoClient,Binary} from 'mongodb';",'class MongoClient{};class Binary{};').replace(/from '((?:\.\.?\/)[^']+)'/g,(_,file)=>`from '${new URL(file,new URL('../../server/mongo-store.mjs',import.meta.url)).href}'`);
const {MongoStore}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

function fakeStore(){
 const store=Object.create(MongoStore.prototype),operations=new Map();let state=emptyState();
 store.client={startSession:()=>({withTransaction:async fn=>fn(),endSession:async()=>{}})};
 store.read=async()=>structuredClone(state);
 store.operations={findOne:async({key})=>operations.get(key),insertOne:async value=>operations.set(value.key,value)};
 store.states={findOne:async()=>({rev:state.rev}),updateOne:async(filter,update)=>{if(filter.rev!==state.rev)return {matchedCount:0};Object.assign(state,update.$set);return {matchedCount:1}}};
 store.records={
  replaceOne:async(filter,value)=>{const list=state[value.kind],index=list.findIndex(r=>r.id===value.recordId);if(index>=0)list[index]=structuredClone(value.doc);else list.push(structuredClone(value.doc))},
  deleteOne:async({kind,recordId})=>{state[kind]=state[kind].filter(r=>r.id!==recordId)},
  deleteMany:async({kind})=>{state[kind]=[]}
 };
 return store;
}

test('Mongo typed replay returns original response before rebuilding state; changed payload conflicts',async()=>{
 const store=fakeStore(),record={id:uid(),vendor:'A',title:'Cement',total:10000,date:'2026-10-11'},key=uid();
 const first=await store.postDomain('bill',record,[],key);
 assert.deepEqual(await store.postDomain('bill',record,[],key),first);
 const state=await store.read();assert.equal(state.bills.length,1);assert.equal(state.audit.length,1);assert.equal(state.rev,1);
 await assert.rejects(()=>store.postDomain('bill',{...record,total:11000},[],key),/different data/);
});

test('Mongo audited deletion removes typed records and retains the audit trail',async()=>{
 const store=fakeStore(),record={id:uid(),vendor:'A',title:'Cement',total:10000,date:'2026-10-11'};
 await store.postDomain('bill',record,[],uid());
 const next=await store.read();changeEntry(next,'bill',record.id);next.rev++;
 await store.commit({expectedRev:1,state:next,key:uid()});
 const saved=await store.read();assert.equal(saved.bills.length,0);assert.equal(saved.audit.length,2);assert.equal(saved.audit[1].changes[0].before.total,10000);
});
