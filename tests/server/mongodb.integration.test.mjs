import test from 'node:test';import assert from 'node:assert/strict';
import {uid,emptyState,summary} from '../../finance.js';import {sha256} from '../../server/core.mjs';
const URI=process.env.TEST_MONGODB_URI;
test('LIVE MongoDB replica-set: typed docs, atomic cost, original-byte storage, deletion and revision conflict',{skip:!URI&&'Set TEST_MONGODB_URI to a disposable MongoDB replica set to run'},async()=>{
 const {MongoStore}=await import('../../server/mongo-store.mjs');const dbName='buildledger_it_'+uid().replaceAll('-','');const store=new MongoStore(URI,dbName);await store.start();
 try{
 const empty=await store.read();assert.equal(empty.rev,0);
 const id=uid(),file=Buffer.from('%PDF-1.7\nReal checksum-backed source.');const sha=sha256(file);
 const upload=await store.startUpload({id,sha256:sha,size:file.length,type:'application/pdf',name:'Plinth Plan.pdf'});
 await store.putChunk(upload.uploadId,0,file);await store.finishUpload(upload.uploadId);
 const st=structuredClone(empty);st.rev=1;st.files.push({id,name:'Plinth Plan.pdf',sha256:sha,size:file.length,type:'application/pdf',status:'Approved for construction',revision:'R1'});
 const k=uid();let first=await store.commit({expectedRev:0,state:st,newFiles:[{id,uploadId:upload.uploadId}],removeFiles:[],key:k});assert.equal(first.rev,1);
 assert.equal((await store.commit({expectedRev:0,state:st,newFiles:[{id,uploadId:upload.uploadId}],removeFiles:[],key:k})).rev,1,'Idempotent replay did not produce original result');
 let stored=await store.read();assert.equal(stored.files.length,1);assert.equal(stored.rev,1);
 let bytes=[];for await(const b of store.fileStream(id))bytes.push(b);assert.deepEqual(Buffer.concat(bytes),file);
 await assert.rejects(()=>store.commit({expectedRev:0,state:st,newFiles:[],removeFiles:[],key:uid()}),/changed|revision|conflict/i);
 let modified=structuredClone(stored);modified.rev=2;modified.files=[];modified.audit.push({id:uid(),type:'file_delete',description:'Removed source drawing',at:new Date().toISOString()});
 await store.commit({expectedRev:1,state:modified,removeFiles:[id],newFiles:[],key:uid()});
 assert.equal((await store.read()).files.length,0);assert.equal(await store.asset(id),null);
 assert.equal(await store.chunks.countDocuments({uploadId:upload.uploadId}),0,'Deleted binary chunks remain');
 }finally{await store.client.db(dbName).dropDatabase().catch(()=>{});await store.close()}
});
