import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as finance from '../finance.js';
import * as hierarchy from '../hierarchy.js';
import * as costCatalog from '../cost-catalog.js';
import * as costAnalytics from '../cost-analytics.js';

test('dashboard, charts and every entry detail render from real data with edit/delete and readable logs',async()=>{
 const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n').replace(/start\(\);\s*$/,'');
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',hidden:true,querySelector:()=>({focus(){}})});return elements.get(id)};
 const state=finance.emptyState();
 state.project.budget=1000000;
 state.bills=[{id:'bill00001',title:'Steel',vendor:'A',date:'2026-10-11',recordedAt:'2026-10-11T10:00:00Z',total:10000,work:'Foundation',lines:[{label:'Steel',mode:'amount',value:10000,directAmountPaise:10000}]}];
 state.payments=[{id:'pay000001',vendor:'A',amount:5000,date:'2026-10-11',recordedAt:'2026-10-11T10:00:00Z'}];
 state.plans=[{id:'plan00001',vendor:'A',title:'Stage 2',amount:10000,due:'2026-11-11'}];
 state.contracts=[{id:'contract1',vendor:'A',title:'Agreement',amount:10000,count:1,createdAt:'2026-10-11T10:00:00Z'}];
 state.entries=[{id:'note00001',kind:'note',title:'Site visit',date:'2026-10-11'}];
 state.allocations=[{id:'alloc0001',paymentId:'pay000001',billId:'bill00001',amount:5000}];
 const context=vm.createContext({...finance,...hierarchy,...costCatalog,...costAnalytics,structuredClone,fixture:state,document:{getElementById:element,activeElement:null},hasPendingWrite:()=>false});
 vm.runInContext(source,context);vm.runInContext('state=fixture',context);
 const home=vm.runInContext('home()',context);assert.match(home,/Project overview/);assert.match(home,/cash-chart/);assert.match(home,/budget-meter/);assert.ok(home.includes(finance.displayMoney(10000)));assert.equal((home.match(/class="kpi/g)||[]).length,5);
 for(const [kind,id] of [['bill','bill00001'],['payment','pay000001'],['plan','plan00001'],['contract','contract1'],['note','note00001'],['allocation','alloc0001']]){
  vm.runInContext(`details('${kind}','${id}')`,context);const html=element('modal-inner').innerHTML;assert.match(html,/data-action="edit-entry"/);assert.match(html,/data-action="delete-entry"/);
  vm.runInContext(`editEntryForm('${kind}','${id}')`,context);assert.match(element('modal-inner').innerHTML,/data-form="edit-entry"/);
 }
 finance.changeEntry(state,'payment','pay000001',{amount:4000});
 context.logId=state.audit[0].id;vm.runInContext('auditDetail(logId)',context);
 const log=element('modal-inner').innerHTML;assert.match(log,/Before/);assert.match(log,/After/);assert.ok(log.includes(finance.displayMoney(5000)));assert.ok(log.includes(finance.displayMoney(4000)));assert.ok(!log.includes('paymentId'));
 let exported;context.Blob=Blob;context.downloadBlob=blob=>exported=blob;
 state.plans[0].cancelled=true;
 state.bills[0].lines[0].label='=SUM(A1:A9)';vm.runInContext('csv()',context);
 const csv=await exported.text(),rows=csv.replace(/^\uFEFF/,'').split('\r\n').map(row=>[...row.matchAll(/(?:^|,)"((?:[^"]|"")*)"/g)].map(m=>m[1].replace(/""/g,'"')));
 const headings=rows.shift();assert.ok(rows.every(row=>row.length===headings.length),'rectangular CSV');
 const total=column=>rows.reduce((n,row)=>n+(row[headings.indexOf(column)]?finance.paise(row[headings.indexOf(column)]):0),0);
 assert.equal(total('Recorded Cost INR'),10000);assert.equal(total('Payment Cash Outflow INR'),4000);assert.equal(total('Bill Amount Settled INR'),4000);
 assert.equal(total('Planned Amount INR'),0);
 assert.ok(csv.includes("'=SUM(A1:A9)"),'spreadsheet formulas escaped');
 finance.changeEntry(state,'bill','bill00001',{lines:[{...state.bills[0].lines[0],costHeadId:'cost-03',costNature:'Labour'}]});
 context.logId=state.audit.at(-1).id;vm.runInContext('auditDetail(logId)',context);assert.match(element('modal-inner').innerHTML,/cost-03/);assert.match(element('modal-inner').innerHTML,/Electrical/);
 costCatalog.changeCostCategory(state,'cost-03',{label:'Electrical services',active:false});context.logId=state.audit.at(-1).id;vm.runInContext('auditDetail(logId)',context);
 const categoryLog=element('modal-inner').innerHTML;assert.match(categoryLog,/Electrical services/);assert.match(categoryLog,/Before/);assert.ok(!categoryLog.includes('description only'));
 vm.runInContext("details('bill','bill00001')",context);assert.match(element('modal-inner').innerHTML,/Electrical services/);assert.match(element('modal-inner').innerHTML,/Labour/);
});
