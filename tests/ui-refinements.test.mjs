import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as finance from '../finance.js';
import * as hierarchy from '../hierarchy.js';
import * as catalog from '../cost-catalog.js';
import * as analytics from '../cost-analytics.js';

const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n').replace(/start\(\);\s*$/,'');
function harness(state=finance.emptyState()){
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',hidden:true,querySelector:()=>({focus(){}})});return elements.get(id)};
 const context=vm.createContext({...finance,...hierarchy,...catalog,...analytics,structuredClone,fixture:state,document:{getElementById:element,activeElement:null},hasPendingWrite:()=>false,ownerAuthentication:()=>false,FormData:class{constructor(form){this.values=form.values}entries(){return Object.entries(this.values)}}});
 vm.runInContext(source,context);vm.runInContext('state=fixture',context);
 return {context,element,run:code=>vm.runInContext(code,context)};
}
const bill=(id,head=null)=>({id,title:'Site supplies',vendor:'Supplier',date:'2026-10-11',recordedAt:'2026-10-11T10:00:00Z',invoice:'INV-123',total:10000,lines:[{label:'Copper wire',place:'Kitchen',work:'Ground floor',substage:'Wiring',costHeadId:head,mode:'amount',directAmountPaise:10000,value:10000}]});

test('zero-project actions preserve safe settings and block project-dependent navigation',async()=>{
 const h=harness();
 for(const action of ['new-plan','calendar','import-files','export-csv']){
  h.context.event={target:{closest:selector=>selector.includes('[data-action]')?{dataset:{action}}:null}};
  await h.run('actionClick(event)');
  assert.equal(h.run('route'),'home');assert.equal(h.run('flow'),null);
  assert.match(h.element('modal-inner').innerHTML,/Create a project before using BuildLedger/);
  assert.match(h.element('modal-inner').innerHTML,/data-action="new-project"[^>]*>Create Project/);
 }
 assert.match(h.run('settings()'),/Developer: Gurucharan S\./);
 assert.match(h.run('backupUI()'),/Create a project before using BuildLedger/);
 h.context.event={target:{closest:selector=>selector==='[data-action]'||selector.includes(',')?{dataset:{action:'new-project'}}:null}};
 await h.run('actionClick(event)');assert.match(h.element('modal-inner').innerHTML,/data-form="project-create"/);
});

test('owner sign-out revokes the session and removes displayed ledger state',async()=>{
 const state=finance.emptyState();state.entries=[{id:'private',title:'Private note'}];const h=harness(state);let signedOut=0,locked=0;
 h.context.ownerAuthentication=()=>true;h.context.logoutRemote=async()=>{signedOut++};h.context.clearInterval=()=>{};
 h.context.confirm=()=>true;h.run("selectedProject='private-project';showSignIn=()=>{locked=true}");
 assert.match(h.run('settings()'),/data-action="sign-out"/);
 h.context.event={target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'sign-out'}}:null}};
 await h.run('actionClick(event)');locked=h.context.locked;
 assert.equal(signedOut,1);assert.equal(locked,true);assert.equal(h.run('selectedProject'),null);
 assert.equal(h.run('state.entries.length'),0);assert.equal(h.element('rail-nav').innerHTML,'');
});

test('sign-out from another tab locks and clears the current ledger',()=>{
 const state=finance.emptyState();state.entries=[{id:'private',title:'Private note'}];const h=harness(state);let channel;
 h.context.ownerAuthentication=()=>true;h.context.clearInterval=()=>{};
 h.context.document.addEventListener=()=>{};h.element('modal').addEventListener=()=>{};
 h.context.BroadcastChannel=class{constructor(){channel=this}};
 h.run("selectedProject='private-project';showSignIn=()=>{};registerListeners()");
 channel.onmessage({data:{signedOut:true}});
 assert.equal(h.run('sessionLocked'),true);assert.equal(h.run('state.entries.length'),0);
 assert.equal(h.run('selectedProject'),null);assert.equal(h.element('rail-nav').innerHTML,'');
});

test('editing retains the opening record after an inline category refresh',async()=>{
 const state=finance.emptyState();state.entries=[{id:'note',kind:'note',title:'Old',date:'2026-10-25',notes:'Old notes'}];
 const h=harness(state),form={dataset:{kind:'note',id:'note',projectId:'project'},values:{title:'Old',date:'2026-10-25',work:'',notes:'Old notes'}};
 h.element('modal-inner').querySelector=selector=>selector==='[data-form="edit-entry"]'?form:{focus(){}};
 h.context.commit=async change=>change(state);h.run("selectedProject='project';editEntryForm('note','note')");
 state.entries[0]={...state.entries[0],title:'Corrected',notes:'New evidence'};
 h.context.form=form;await assert.rejects(()=>h.run('saveEntryEdit(form)'),/entry changed/i);
 assert.equal(state.entries[0].title,'Corrected');assert.equal(state.entries[0].notes,'New evidence');
});

test('payment choices and CSV use indexed balances with exact amounts',async()=>{
 const state=finance.emptyState();state.bills=[bill('bill')];
 state.plans=[{id:'plan',title:'Stage',vendor:'Supplier',amount:10000,due:'2026-12-01'}];
 state.payments=[{id:'payment',vendor:'Supplier',amount:5000,planId:'plan',date:'2026-10-11'}];
 state.allocations=[{id:'allocation',billId:'bill',paymentId:'payment',amount:5000}];
 const h=harness(state);h.context.dueForBill=()=>{throw Error('Unexpected repeated bill scan')};h.context.dueForPlan=()=>{throw Error('Unexpected repeated plan scan')};
 h.context.Blob=Blob;let exported;h.context.downloadBlob=blob=>{exported=blob};h.run("flow='payment';selectedProject='project'");
 const html=h.run('formPage()');assert.match(html,/Due ₹50/);assert.match(html,/₹50 remaining/);
 h.run('csv()');const csv=await exported.text();assert.match(csv,/"50\.00"/);assert.match(csv,/"100\.00"/);
});

test('project dialogs cannot disclose late pre-logout responses after owner sign-out',async()=>{
 for(const action of ['projects','edit-project','prepare-project-delete']){
  const h=harness();let release;h.context.listProjects=()=>new Promise(resolve=>{release=resolve});
  h.context.activeProjectId=async()=>'private-project';h.context.projectDeletionSummary=async()=>({recordCount:1,attachmentCount:0,attachmentBytes:0});
  h.context.logoutRemote=async()=>{};h.context.clearInterval=()=>{};h.context.confirm=()=>true;
  h.run("selectedProject='private-project';showSignIn=()=>{}");
  const event=key=>({target:{closest:selector=>selector==='[data-action]'?{dataset:{action:key,id:'private-project'}}:null}});
  h.context.event=event(action);const loading=h.run('actionClick(event)');
  h.context.event=event('sign-out');await h.run('actionClick(event)');
  release([{id:'private-project',name:'Private project name',budget:12345,rev:0}]);await loading;
  assert.equal(h.element('modal').hidden,true,action);assert.equal(h.element('modal-inner').innerHTML,'',action);
  assert.equal(h.run('selectedProject'),null,action);
 }
});

test('late failed saves retain recovery data without exposing it on the locked page',async()=>{
 const h=harness();let rejectSave,banners=0;h.context.modify=()=>new Promise((resolve,reject)=>{rejectSave=reject});
 h.context.hasPendingWrite=()=>true;h.context.logoutRemote=async()=>{};h.context.clearInterval=()=>{};h.context.confirm=()=>true;
 h.run("selectedProject='private-project';showSignIn=()=>{};showPendingSave=()=>{bannerCount++}");h.context.bannerCount=0;
 const saving=h.run('commit(()=>{})'),rejected=assert.rejects(saving,error=>error.code==='SAVE_UNCERTAIN');
 h.context.event={target:{closest:selector=>selector==='[data-action]'?{dataset:{action:'sign-out'}}:null}};
 await h.run('actionClick(event)');rejectSave(Object.assign(Error('Private retained save'),{code:'SAVE_UNCERTAIN'}));await rejected;
 banners=h.context.bannerCount;assert.equal(banners,0);assert.equal(h.run('sessionLocked'),true);
 assert.equal(h.context.hasPendingWrite(),true,'Signing out must preserve the durable unresolved save');
});

test('activity searches invoice, line descriptions, locations and categories with independent settlement filters',()=>{
 const s=finance.emptyState();s.bills=[bill('open','cost-03'),bill('settled','cost-05'),bill('legacy')];
 s.payments=[{id:'paid',vendor:'Supplier',amount:10000,date:'2026-10-11'}];s.allocations=[{id:'a',paymentId:'paid',billId:'settled',amount:10000}];
 s.plans=[{id:'overdue',title:'Engineer',vendor:'Supplier',due:'2000-01-01',amount:10000},{id:'cancelled',title:'Cancelled',due:'2000-01-01',amount:10000,cancelled:true}];
 const h=harness(s),ids=()=>Array.from(h.run('filteredActivity().map(e=>e.id)'));
 h.run("activityFilter='bill';activityHead='cost-03'");assert.deepEqual(ids(),['open']);
 for(const query of ['INV-123','Copper wire','Kitchen','Electrical','Wiring']){h.context.query=query;h.run('activitySearch=query');assert.deepEqual(ids(),['open'])}
 h.run("activitySearch='';activityHead='';activityStatus='unpaid'");assert.deepEqual(ids(),['legacy','open']);
 h.run("activityStatus='settled'");assert.deepEqual(ids(),['settled']);
 h.run("activityStatus='unclassified'");assert.deepEqual(ids(),['legacy']);
 h.run("activityFilter='All';activityStatus='overdue'");assert.deepEqual(ids(),['overdue']);
 h.run("activityStatus='all';activityFilter='bill';activityFrom='2026-10-12'");assert.deepEqual(ids(),[]);
});

test('activity pagination can reveal matching records beyond the former 150-entry ceiling',()=>{
 const s=finance.emptyState();s.bills=Array.from({length:180},(_,i)=>bill('bill-'+i));const h=harness(s);
 h.run("activityFilter='bill'");let html=h.run('activity()');assert.equal((html.match(/class="list-row activity-row"/g)||[]).length,75);assert.match(html,/Showing 75 of 180/);
 h.run('activityLimit=225');html=h.run('activity()');assert.equal((html.match(/class="list-row activity-row"/g)||[]).length,180);assert.doesNotMatch(html,/data-action="activity-more"/);
});

test('live preview computes explicit SQ multiplier, invoice charges and partial settlement exactly',()=>{
 const h=harness();h.run("flow='other'");h.context.form={values:{calculate:'calculated',calcQty:'100',calcRate:'38500',quantityUnitId:'sqft',unitId:'sq100',multiplier:'1.5',extras:'100',tax:'25',discount:'50',payStatus:'partial',paidAmount:'10000'}};
 const p=h.run('amountPreview(form)');assert.equal(p.base,5775000);assert.equal(p.total,5782500);assert.equal(p.paid,1000000);assert.equal(p.due,4782500);assert.equal(p.multiplier,'1.5');
 for(const multiplier of ['0','-1','NaN','1.0001']){h.context.form.values.multiplier=multiplier;assert.throws(()=>h.run('amountPreview(form)'))}
 Object.assign(h.context.form.values,{multiplier:'999999999',calcQty:'999999999',calcRate:'999999999999.99'});assert.throws(()=>h.run('amountPreview(form)'),/large/);
 Object.assign(h.context.form.values,{calculate:'amount',amount:'1',extras:'0',tax:'0',discount:'0',paidAmount:'2'});assert.throws(()=>h.run('amountPreview(form)'),/exceeds/);
 Object.assign(h.context.form.values,{discount:'2',payStatus:'none'});assert.throws(()=>h.run('amountPreview(form)'),/discount|negative|total/i);
});

test('category quick search excludes inactive ancestors while retaining active descendants',()=>{
 const s=finance.emptyState(),h=harness(s);assert.ok(h.run("categorySearchResults('OPC cement')").some(n=>n.label==='OPC cement'));
 catalog.changeCostCategory(s,'cost-05',{active:false});assert.equal(h.run("categorySearchResults('OPC cement').length"),0);
 catalog.changeCostCategory(s,'cost-05',{active:true});catalog.changeCostCategory(s,'cost-05-04',{active:false});assert.equal(h.run("categorySearchResults('OPC cement').length"),0);
});

test('new nested categories appear in hierarchy search and no-match offers inline creation',()=>{
 const s=finance.emptyState();catalog.changeCostCategory(s,null,{label:'User project category',parentId:null});
 const head=catalog.costCatalog(s).find(n=>n.label==='User project category');
 catalog.changeCostCategory(s,null,{label:'Custom service',parentId:head.id});
 const h=harness(s),matches=h.run("categorySearchResults('User project category Custom service')");
 assert.ok(matches.some(n=>n.label==='Custom service'));
 h.context.headId=head.id;assert.match(h.run('classificationFields({costHeadId:headId})'),/Custom service/);
 const results={hidden:true,innerHTML:''},box={querySelector:()=>results},input={value:'new custom label',closest:()=>box};
 h.context.input=input;h.run('searchClassification(input)');
 assert.match(results.innerHTML,/data-create-cost-category/);
});

test('purchase preview agrees with posted multi-line calculations and shows each applied multiplier',()=>{
 const h=harness(),values={'.item-mode':'calculated','.item-qty':'100','.item-rate':'38500','.item-unit':'sq100','.item-quantity-unit':'sqft','.item-multiplier':'1.5'};
 const calculated={querySelector:key=>({value:values[key]})},direct={querySelector:key=>({value:key==='.item-mode'?'amount':'100'})};
 h.context.form={values:{extras:'10',tax:'5',discount:'2',payStatus:'partial',paidAmount:'10000'},querySelectorAll:()=>[calculated,direct]};h.run("flow='purchase'");
 const preview=h.run('amountPreview(form)'),posted=finance.billTotal([{mode:'calculated',qty:'100',rate:'38500',unitId:'sq100',quantityUnitId:'sqft',multiplier:'1.5'},{mode:'amount',directAmountPaise:10000}],1000,500,200);
 assert.equal(preview.total,posted);assert.equal(preview.due,posted-1000000);assert.equal(preview.calculations.length,1);assert.match(preview.calculations[0],/multiplier 1\.5/);assert.match(preview.calculations[0],/\/ 100/);
});

test('line invoice edit exposes only actionable classification selectors',()=>{
 const s=finance.emptyState();s.bills=[bill('bill','cost-03')];const h=harness(s);h.run("editEntryForm('bill','bill')");const html=h.element('modal-inner').innerHTML;
 assert.equal((html.match(/data-cost="costHeadId"/g)||[]).length,1);assert.match(html,/class="edit-line/);
 s.bills[0].lines=[];h.run("editEntryForm('bill','bill')");assert.equal((h.element('modal-inner').innerHTML.match(/data-cost="costHeadId"/g)||[]).length,1);
});

test('cost search has a useful empty state and completed instalments have an honest calendar label',()=>{
 const s=finance.emptyState();s.bills=[bill('bill','cost-03')];s.plans=[{id:'done',title:'Engineer instalment',vendor:'Supplier',due:'2026-10-11',amount:5000}];s.payments=[{id:'pay',vendor:'Supplier',planId:'done',amount:5000,date:'2026-10-11'}];
 const h=harness(s);h.run("costSearch='no such category'");const html=h.run('costView()');assert.match(html,/No matching costs/);assert.doesNotMatch(html,/data-action="hierarchy-more"/);
 h.run("calendarDay='2026-10-11'");const events=h.run("calendarEvents('2026-10-11')");assert.equal(events.find(e=>e.id==='done').status,'Completed instalment');assert.match(h.run('renderCalendar()'),/Completed instalment/);
});

test('duplicate review warns on matching supplier invoice or identical dated cost without blocking unrelated bills',()=>{
 const s=finance.emptyState();s.bills=[bill('original')];const h=harness(s);
 h.context.data={...s.bills[0],vendor:' supplier ',invoice:' inv-123 ',date:'2026-10-12',title:'Another purpose',total:12000};assert.equal(h.run('possibleDuplicateBills(data).length'),1);
 Object.assign(h.context.data,{invoice:'',date:'2026-10-11',title:'site supplies',total:10000});assert.equal(h.run('possibleDuplicateBills(data).length'),1);
 h.context.data.vendor='Different supplier';assert.equal(h.run('possibleDuplicateBills(data).length'),0);
 Object.assign(h.context.data,{vendor:'Supplier',date:'2026-10-12'});assert.equal(h.run('possibleDuplicateBills(data).length'),0);
 delete h.context.data.lines;assert.equal(h.run('possibleDuplicateBills(data).length'),0);
});


test('cost-head activity filter includes classified agreements and future instalments',()=>{
 const s=finance.emptyState();s.contracts=[{id:'agreement',title:'Engineer',vendor:'Engineer',amount:10000,costHeadId:'cost-17'}];s.plans=[{id:'instalment',title:'Visit',vendor:'Engineer',amount:10000,due:'2030-01-01',costHeadId:'cost-17'}];const h=harness(s);
 h.run("activityHead='cost-17';activityFilter='plan'");assert.deepEqual(Array.from(h.run('filteredActivity().map(e=>e.id)')),['instalment']);
 h.run("activityFilter='contract';activitySearch='Engineer Supervision'");assert.deepEqual(Array.from(h.run('filteredActivity().map(e=>e.id)')),['agreement']);
});
