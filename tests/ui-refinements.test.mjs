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
 const context=vm.createContext({...finance,...hierarchy,...catalog,...analytics,fixture:state,document:{getElementById:element,activeElement:null},hasPendingWrite:()=>false,FormData:class{constructor(form){this.values=form.values}entries(){return Object.entries(this.values)}}});
 vm.runInContext(source,context);vm.runInContext('state=fixture',context);
 return {context,element,run:code=>vm.runInContext(code,context)};
}
const bill=(id,head=null)=>({id,title:'Site supplies',vendor:'Supplier',date:'2026-10-11',recordedAt:'2026-10-11T10:00:00Z',invoice:'INV-123',total:10000,lines:[{label:'Copper wire',place:'Kitchen',work:'Ground floor',substage:'Wiring',costHeadId:head,mode:'amount',directAmountPaise:10000,value:10000}]});

test('activity searches invoice, line descriptions, locations and categories with independent settlement filters',()=>{
 const s=finance.emptyState();s.bills=[bill('open','cost-03'),bill('settled','cost-05'),bill('legacy')];
 s.payments=[{id:'paid',vendor:'Supplier',amount:10000,date:'2026-10-11'}];s.allocations=[{id:'a',paymentId:'paid',billId:'settled',amount:10000}];
 s.plans=[{id:'overdue',title:'Engineer',vendor:'Supplier',due:'2000-01-01',amount:10000},{id:'cancelled',title:'Cancelled',due:'2000-01-01',amount:10000,cancelled:true}];
 const h=harness(s),ids=()=>Array.from(h.run('filteredActivity().map(e=>e.id)'));
 h.run("activityFilter='bill';activityHead='cost-03'");assert.deepEqual(ids(),['open']);
 for(const query of ['INV-123','Copper wire','Kitchen','Electrical','Wiring']){h.context.query=query;h.run('activitySearch=query');assert.deepEqual(ids(),['open'])}
 h.run("activitySearch='';activityHead='';activityStatus='unpaid'");assert.deepEqual(ids(),['open','legacy']);
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
