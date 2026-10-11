import {MongoClient,Binary} from 'mongodb';
import {createHash,randomUUID} from 'node:crypto';
import {CHUNK_SIZE,MAX_FILE_SIZE,sha256,validId,checkState,matchFile,failure,startupState} from './core.mjs';
import {validateFileMutation} from './invariants.mjs';
import {appendDomain} from './domain.mjs';
import {validateRecordChanges} from '../finance.js';

// MongoDB must be a replica set (single-node replica set also works) for ACID state+file commits.
export class MongoStore {
 constructor(uri,dbname='buildledger'){this.client=new MongoClient(uri,{maxPoolSize:20,retryWrites:true});this.name=dbname}
 async start(){await this.client.connect();this.db=this.client.db(this.name);this.states=this.db.collection('projects');this.records=this.db.collection('records');this.assets=this.db.collection('assets');this.chunks=this.db.collection('fileChunks');this.uploads=this.db.collection('uploads');this.operations=this.db.collection('operations');
  await Promise.all([this.records.createIndex({projectId:1,kind:1,recordId:1},{unique:true}),this.assets.createIndex({id:1},{unique:true}),this.uploads.createIndex({createdAt:1},{expireAfterSeconds:2*24*3600}),this.chunks.createIndex({uploadId:1,index:1},{unique:true}),this.operations.createIndex({key:1},{unique:true})]);
  await this.states.updateOne({_id:'single-owner'},{$setOnInsert:{project:startupState().project,settings:startupState().settings,schema:1,rev:0}},{upsert:true});
 }
 async close(){await this.client.close()}
 async health(){try{const pong=await this.db.command({ping:1},{maxTimeMS:2500});return Boolean(pong?.ok===1)}catch{return false}}
 async read(session=null){if(!session){const s=this.client.startSession();let result;try{await s.withTransaction(async()=>{result=await this.read(s)},{readConcern:{level:'snapshot'}});return result}finally{await s.endSession()}}const p=await this.states.findOne({_id:'single-owner'},session?{session}:{});const rows=await this.records.find({projectId:'single-owner'},session?{session}:{}).sort({position:1}).toArray();const st={schema:p?.schema??1,project:p?.project||startupState().project,settings:p?.settings||startupState().settings,rev:p?.rev??0,bills:[],payments:[],allocations:[],plans:[],contracts:[],entries:[],files:[],audit:[]};for(const r of rows){if(Array.isArray(st[r.kind]))st[r.kind].push(r.doc)}return st}
 async startUpload(meta){if(!meta||!validId(meta.id)||typeof meta.sha256!=='string'||!/^[a-f0-9]{64}$/.test(meta.sha256)||!Number.isSafeInteger(meta.size)||meta.size<0||meta.size>MAX_FILE_SIZE)throw failure(400,'Invalid upload metadata');
 const uploadId=randomUUID(),numChunks=Math.ceil(meta.size/CHUNK_SIZE);await this.uploads.insertOne({_id:uploadId,fileId:meta.id,sha256:meta.sha256,size:meta.size,type:String(meta.type||'application/octet-stream').slice(0,180),name:String(meta.name||'document').slice(0,180),numChunks,verified:false,createdAt:new Date()});return {uploadId,chunkBytes:CHUNK_SIZE,numChunks};}
 async putChunk(uploadId,n,bytes){const up=await this.uploads.findOne({_id:uploadId});if(!up||up.verified)throw failure(404,'Upload expired or complete');if(!Number.isSafeInteger(n)||n<0||n>=up.numChunks)throw failure(400,'Invalid upload chunk');const expected=n===up.numChunks-1?up.size-n*CHUNK_SIZE:CHUNK_SIZE;if(bytes.length!==expected)throw failure(400,'Unexpected chunk size');const h=sha256(bytes);const found=await this.chunks.findOne({uploadId,index:n});if(found){if(found.sha256!==h)throw failure(409,'Chunk already exists with different content');return;}await this.chunks.insertOne({uploadId,index:n,sha256:h,data:new Binary(bytes),createdAt:new Date()});}
 async finishUpload(uploadId){const u=await this.uploads.findOne({_id:uploadId});if(!u)throw failure(404,'Upload not found');if(u.verified)return {verified:true};let count=0,size=0;const hash=createHash('sha256');for await(const ch of this.chunks.find({uploadId}).sort({index:1})){if(ch.index!==count++)throw failure(422,'Missing upload chunk');const buffer=Buffer.from(ch.data.buffer);size+=buffer.byteLength;hash.update(buffer)}if(count!==u.numChunks||size!==u.size||hash.digest('hex')!==u.sha256)throw failure(422,'Upload failed checksum verification');await this.uploads.updateOne({_id:uploadId},{$set:{verified:true}});return {verified:true};}
 async postDomain(type,record,allocations=[],key){
  if(!validId(key))throw failure(400,'Invalid idempotency key');
  const canonical={op:'typed-record',type,record,allocations};
  const digest=sha256(Buffer.from(JSON.stringify(canonical)));
  const prior=await this.operations.findOne({key});
  if(prior){if(prior.digest!==digest)throw failure(409,'Idempotency key reused with different data');return prior.response}
  return this.commit({key},canonical);
 }
 async commit({expectedRev,state,newFiles=[],removeFiles=[],key,replace=false},canonical=null){
 if(!validId(key))throw failure(400,'Invalid idempotency key');if(!canonical){try{checkState(state)}catch(e){throw failure(422,e.message,'VALIDATION_ERROR')}
 if(!Number.isSafeInteger(expectedRev)||expectedRev<0)throw failure(400,'Invalid expected revision');if(state.rev!==expectedRev+1)throw failure(422,'Invalid revision increment');}
 const staged=new Set(newFiles.map(f=>f.uploadId));if(staged.size!==newFiles.length)throw failure(422,'Repeated upload in one operation');
 const digest=sha256(Buffer.from(JSON.stringify(canonical??{expectedRev,state,newFiles,removeFiles,replace})));
 const session=this.client.startSession();let result;
 try{await session.withTransaction(async()=>{
  let prev=await this.operations.findOne({key},{session});if(prev){if(prev.digest!==digest)throw failure(409,'Idempotency key was reused with different content');result=prev.response;return;}
  if(canonical){const old=await this.read(session);expectedRev=old.rev;state=appendDomain(old,canonical.type,canonical.record,canonical.allocations)}
  const curr=await this.states.findOne({_id:'single-owner'},{session});if((curr?.rev??0)!==expectedRev)throw failure(409,'Project changed in another tab/device. Reload before saving.','VERSION_CONFLICT');
  const uploaded=[];for(const f of newFiles){if(!validId(f.id))throw failure(422,'Invalid file identifier');const meta=state.files.find(x=>x.id===f.id);const up=await this.uploads.findOne({_id:f.uploadId},{session});if(!up||!up.verified||!matchFile(meta,{id:up.fileId,sha256:up.sha256,size:up.size,type:up.type}))throw failure(422,'Missing or mismatched file upload');uploaded.push({...up,uploadId:f.uploadId});}
  const previous=await this.read(session);validateFileMutation(previous,state,newFiles,removeFiles,replace);try{validateRecordChanges(previous,state,replace)}catch(e){throw failure(422,e.message,'VALIDATION_ERROR')}const newById=new Set(uploaded.map(x=>x.fileId));const removed=new Set(removeFiles);
  if(removed.size!==removeFiles.length)throw failure(422,'Duplicate removed file ID');
  let old=previous.files||[];let oldIds=new Set(old.map(f=>f.id));let desired=new Set(state.files.map(f=>f.id));
  for(const f of old){if(!desired.has(f.id)&&!removed.has(f.id)&&!replace)throw failure(422,'Removed document needs an explicit delete action');}
  for(const f of state.files){if(!oldIds.has(f.id)&&!newById.has(f.id))throw failure(422,'New document has no uploaded original');}
  for(const f of uploaded){if(oldIds.has(f.fileId)&&!replace)throw failure(409,'File ID already exists; use a new revision');}
  // Remove original bytes transactionally so a deleted document is not merely hidden.
  const deleting=replace?old.map(f=>f.id):removeFiles;
  if(deleting.length){const priorAssets=await this.assets.find({id:{$in:deleting}},{session}).toArray();const oldUploads=priorAssets.map(x=>x.uploadId);await this.assets.deleteMany({id:{$in:deleting}},{session});if(oldUploads.length){await this.chunks.deleteMany({uploadId:{$in:oldUploads}},{session});await this.uploads.deleteMany({_id:{$in:oldUploads}},{session});}}
  if(uploaded.length)await this.assets.insertMany(uploaded.map(f=>({id:f.fileId,uploadId:f.uploadId,sha256:f.sha256,size:f.size,type:f.type,name:f.name,createdAt:new Date()})),{session});
  // Each kind has its own MongoDB documents. Prevent silent edits or deletion of posted finance sources.
  const kinds=['bills','payments','allocations','plans','contracts','entries','files','audit'];
  for(const kind of kinds){
   const originals=new Map(previous[kind].map(x=>[x.id,x]));const desired=new Map(state[kind].map(x=>[x.id,x]));
   if(replace)await this.records.deleteMany({projectId:'single-owner',kind},{session});
   const oldIdsForKind=new Set(originals.keys());
   for(const [position,doc] of state[kind].entries()){
    if(!replace&&oldIdsForKind.has(doc.id)&&JSON.stringify(originals.get(doc.id))===JSON.stringify(doc))continue;
    await this.records.replaceOne({projectId:'single-owner',kind,recordId:doc.id},{projectId:'single-owner',kind,recordId:doc.id,position,doc},{upsert:true,session});
   }
   if(!replace)for(const [id] of originals)if(!desired.has(id))await this.records.deleteOne({projectId:'single-owner',kind,recordId:id},{session});
  }
  const write=await this.states.updateOne({_id:'single-owner',rev:expectedRev},{$set:{project:state.project,settings:state.settings,schema:state.schema,rev:state.rev}},{session});if(write.matchedCount!==1)throw failure(409,'Another write was saved first. Reload and try again.','VERSION_CONFLICT');
  result={ok:true,rev:state.rev};await this.operations.insertOne({key,digest,response:result,createdAt:new Date()},{session});
 },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
 return result;
 }finally{await session.endSession()}
 }
 async asset(id){if(!validId(id))return null;return this.assets.findOne({id})}
 async *fileStream(id){let meta=await this.asset(id);if(!meta)throw failure(404,'File does not exist');let hash=createHash('sha256'),size=0,i=0;for await(const ch of this.chunks.find({uploadId:meta.uploadId}).sort({index:1})){if(ch.index!==i++)throw failure(500,'Missing original file chunk');const buf=Buffer.from(ch.data.buffer);hash.update(buf);size+=buf.length;yield buf;}if(meta.size!==size||meta.sha256!==hash.digest('hex'))throw failure(500,'Original file checksum mismatch');}
 async removeOrphans(){// Clean expired staged uploads only; active originals are always protected.
  const cutoff=new Date(Date.now()-3*24*3600*1000);
  const oldIds=await this.chunks.distinct('uploadId',{createdAt:{$lt:cutoff}});
  if(!oldIds.length)return 0;
  const live=new Set(await this.assets.distinct('uploadId',{uploadId:{$in:oldIds}}));
  let cleared=0;for(const id of oldIds){if(!live.has(id)){let r=await this.chunks.deleteMany({uploadId:id});cleared+=r.deletedCount;await this.uploads.deleteOne({_id:id})}}return cleared;
 }
}
