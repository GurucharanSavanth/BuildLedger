import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';import {archiveFormatTest as f} from '../archive.js';
const encoder=new TextEncoder(),decoder=new TextDecoder();
test('Encrypted backup format: bytes survive ZIP round trip; wrong password rejected',async()=>{let plain=encoder.encode('Plinth DWG\0original bytes 12345'),salt=crypto.getRandomValues(new Uint8Array(16)),key=await f.keyFor('very-long-recovery-password',salt);const a=await f.encrypt(plain,key);let zip=f.zipCreate([['header.json',encoder.encode(JSON.stringify({iv:a.iv}))],['objects/file1.enc',a.bytes]]);const entries=f.zipParse(new Uint8Array(await zip.arrayBuffer()));let restored=await f.decrypt(entries.get('objects/file1.enc'),key,a.iv);assert.deepEqual(restored,plain);let other=await f.keyFor('another-correct-length-password',salt);await assert.rejects(()=>f.decrypt(entries.get('objects/file1.enc'),other,a.iv));assert.equal((await f.digest(plain)).length,64)});
test('Archive rejects traversal, corrupted bytes and missing ZIP central directory',async()=>{const content=encoder.encode('hello');assert.throws(()=>f.zipCreate([['../secrets',content]]),/entry names/);const malicious=new Uint8Array(await f.zipCreate([['ok/secret',content]]).arrayBuffer());for(let i=0;i<malicious.length-9;i++)if(decoder.decode(malicious.subarray(i,i+9))==='ok/secret')malicious.set(encoder.encode('../secret'),i);assert.throws(()=>f.zipParse(malicious),/entry names/);const zip=f.zipCreate([['safe.txt',content]]);let bytes=new Uint8Array(await zip.arrayBuffer());const corrupted=new Uint8Array(bytes);corrupted[42]^=1;assert.throws(()=>f.zipParse(corrupted));assert.throws(()=>f.zipParse(new Uint8Array([1,2,3,4])))});

test('ZIP writer enforces the same entry and name limits as the reader',async()=>{
 const entries=Array.from({length:10000},(_,index)=>['entry-'+index,new Uint8Array()]);
 assert.equal(f.zipParse(new Uint8Array(await f.zipCreate(entries).arrayBuffer())).size,10000);
 assert.throws(()=>f.zipCreate([...entries,['too-many',new Uint8Array()]]),/too many entries/);
 assert.throws(()=>f.zipCreate([['duplicate','a'],['duplicate','b']]),/entry names/);
 assert.throws(()=>f.zipCreate([['a'.repeat(65536),'']]),/entry names/);
 const oversized=new Uint8Array();Object.defineProperty(oversized,'length',{value:850*1024*1024});
 assert.throws(()=>f.zipCreate([['large',oversized]]),/850 MB/);
});
