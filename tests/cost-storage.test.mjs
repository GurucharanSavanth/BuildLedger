import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {emptyState,uid,makeBill,changeEntry} from '../finance.js';
import {changeCostCategory} from '../cost-catalog.js';
import {packSnapshot,unpackSnapshot} from '../archive.js';
import {SqliteStore} from '../server/sqlite-store.mjs';
import {createHttpApp} from '../server/http.mjs';
import {sha256} from '../server/core.mjs';

function fixture(){
 const s=emptyState();s.bills.push(makeBill({title:'Mixed invoice',vendor:'Site Supplier',date:'2026-10-11',work:'',place:'',extras:1,lines:[
  {label:'Wire',mode:'amount',directAmountPaise:10000,costHeadId:'cost-03',costSubheadId:'cost-03-07',costNature:'Material',work:'Electrical'},
  {label:'Plumbing labour',mode:'calculated',qty:'2',rate:'100',unitId:'bathroom',multiplier:'1.5',costHeadId:'cost-04',costSubheadId:'cost-04-01',costNature:'Labour',work:'Plumbing'}
 ]}));return s;
}

test('classified SQLite restart and API cost/stage reports reconcile',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'buildledger-v8-storage-')),db=path.join(dir,'ledger.sqlite');let store=new SqliteStore(db),server;
 try{
  await store.start();const s=fixture();changeCostCategory(s,'cost-03',{label:'Electrical renamed'});s.rev=1;
  await store.commit({expectedRev:0,state:s,key:uid()});await store.close();store=new SqliteStore(db);await store.start();
  const saved=await store.read();assert.deepEqual(saved,s);
  server=createHttpApp({store,host:'127.0.0.1',storeMode:'sqlite',authMode:'local'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  async function get(url){const response=await fetch(base+url);assert.equal(response.status,200,url);return response.json()}
  const heads=await get('/api/v1/analytics/costs?by=head'),nature=await get('/api/v1/analytics/costs?by=nature');
  for(const report of [heads,nature]){assert.equal(report.totalPaise,40001);assert.equal(report.values.reduce((n,r)=>n+r.amountPaise,0),40001)}
  assert.ok(heads.values.some(r=>r.name==='Electrical renamed'));assert.ok(nature.values.some(r=>r.name==='Labour'));
  assert.equal((await get('/api/v1/analytics/hierarchy')).total,40001);
  const root=await get('/api/v1/analytics/cost-hierarchy');assert.equal(root.total,40001);
  const leaf=await get('/api/v1/analytics/cost-hierarchy?level=cost-03&level=cost-03-07&level=legacy-detail');assert.equal(leaf.entries[0].billId,s.bills[0].id);
  const catalog=await get('/api/v1/catalog/cost-heads');assert.ok(JSON.stringify(catalog).includes('Electrical renamed'));
 }finally{if(server)await new Promise(r=>server.close(r));await store.close();await rm(dir,{recursive:true,force:true})}
});

test('encrypted backup preserves custom catalog, audited reclassification and original attachment bytes',async()=>{
 const s=fixture();changeCostCategory(s,null,{label:'Custom head'});changeCostCategory(s,'cost-03',{active:false});
 s.contracts.push({id:uid(),title:'Quoted labour',vendor:'Builder',amount:5775000,costHeadId:'cost-16',costSubheadId:'cost-16-01',calculation:{mode:'calculated',qty:'100',rate:'38500',unitId:'sq100',quantityUnitId:'sqft',multiplier:'1.5'}});
 const bill=s.bills[0],lines=structuredClone(bill.lines);lines[0].costNature='Transport';changeEntry(s,'bill',bill.id,{lines});
 const bytes=Buffer.from('%PDF-1.4\noriginal classified invoice bytes\n'),id=uid();s.files.push({id,name:'invoice.pdf',size:bytes.length,type:'application/pdf',sha256:sha256(bytes)});
 const backup=await packSnapshot(s,[{id,blob:new Blob([bytes],{type:'application/pdf'})}],'v8-recovery-password');
 const restored=await unpackSnapshot(backup,'v8-recovery-password');assert.deepEqual(restored.state,s);assert.equal(restored.assets.length,1);assert.deepEqual(Buffer.from(await restored.assets[0].blob.arrayBuffer()),bytes);
});

test('legacy encrypted backup without cost catalog or classification restores unchanged',async()=>{
 const s=emptyState();delete s.settings.costCatalog;s.bills=[{id:uid(),title:'Historical bill',vendor:'Legacy',date:'2020-01-01',total:12345,lines:[]}];
 const restored=await unpackSnapshot(await packSnapshot(s,[],'legacy-recovery-password'),'legacy-recovery-password');
 assert.deepEqual(restored.state,s);assert.equal(restored.state.settings.costCatalog,undefined);assert.equal(restored.state.bills[0].costHeadId,undefined);
});
