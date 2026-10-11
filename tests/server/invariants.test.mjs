import test from 'node:test';
import assert from 'node:assert/strict';
import {uid,emptyState,checkNewPayment} from '../../finance.js';
import {validateFileMutation} from '../../server/invariants.mjs';
import {checkState} from '../../server/core.mjs';
const file=(id)=>({id,name:'approved-column-plan.pdf',sha256:'a'.repeat(64),size:100,type:'application/pdf'});
test('File deletion removes metadata and bytes together; cannot orphan visible files',()=>{
 const id=uid(),old=emptyState(),newer=emptyState();old.files=[file(id)];newer.files=[file(id)];
 assert.throws(()=>validateFileMutation(old,newer,[],[id]),/cannot keep/);
 newer.files=[];assert.equal(validateFileMutation(old,newer,[],[id]),true);
 assert.throws(()=>validateFileMutation(old,newer,[],[]),/explicitly deleted/);
 assert.throws(()=>validateFileMutation(old,newer,[],[uid()]),/unknown document/);
});
test('File content and MIME are immutable except via a new uploaded revision',()=>{
 const id=uid(),old=emptyState(),newer=emptyState();old.files=[file(id)];newer.files=[{...file(id),name:'New display name',status:'Reviewed'}];
 assert.equal(validateFileMutation(old,newer),true);
 for(const field of ['sha256','size','type']){
  const changed=structuredClone(newer);changed.files[0][field]=field==='size'?101:'different';
  assert.throws(()=>validateFileMutation(old,changed),/cannot change/);
 }
 const f2=file(uid());newer.files.push(f2);
 assert.throws(()=>validateFileMutation(old,newer),/no verified original/);
 assert.equal(validateFileMutation(old,newer,[{id:f2.id,uploadId:uid()}]),true);
});
test('Payment linked to an engineer instalment rejects unrelated vendor',()=>{
 const s=emptyState(),planId=uid();s.plans.push({id:planId,vendor:'Engineer A',title:'Milestone 2',due:'2026-10-20',amount:300000});
 const p={id:uid(),amount:100000,vendor:'Other Vendor',planId};
 assert.throws(()=>checkNewPayment(s,p,null),/recipient does not match/);
 s.payments=[p];assert.throws(()=>checkState(s),/recipient differs/);
 p.vendor='Engineer A';assert.equal(checkState(s),true);
});
