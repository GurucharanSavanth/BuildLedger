import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {emptyState,makeBill,sum,changeEntry,lineTotal,verifyState} from '../finance.js';
import {costCatalog} from '../cost-catalog.js';
import {buildHierarchy} from '../hierarchy.js';
import {allocatedCostLines,buildCostHierarchy,costHierarchySummary,costBreakdown} from '../cost-analytics.js';

const direct=(amount,extra={})=>({mode:'amount',directAmountPaise:amount,value:amount,label:'Expense',...extra});
const bill=(lines,extra={})=>makeBill({date:'2026-10-11',title:'Invoice',vendor:'Supplier',lines,...extra});
test('historical adjustment-only invoices use an explicit unclassified bucket in every hierarchy',()=>{
  const s=emptyState();s.bills.push({id:'legacy-adjustment',title:'Old invoice',vendor:'Supplier',total:100,extras:100,lines:[direct(0,{costHeadId:'cost-03',work:'Electrical',label:'Wire'}),direct(0,{costHeadId:'cost-05',work:'Materials',label:'Cement'})]});
  verifyState(s);const entries=allocatedCostLines(s);
  assert.equal(entries.length,1);assert.equal(entries[0].amount,100);assert.equal(entries[0].costHeadId,null);assert.equal(entries[0].lineIndex,-1);
  assert.equal(entries[0].lineLabel,'Unclassified invoice adjustments');
  assert.deepEqual(costBreakdown(s),[['Unclassified / Legacy',100]]);
  const stages=buildHierarchy(s);assert.equal(stages.total,100);assert.equal(stages.children.size,1);assert.ok(stages.children.has('Uncategorised'));
  changeEntry(s,'bill','legacy-adjustment',{notes:'Reviewed historical adjustments'});
  assert.equal(s.bills[0].total,100);assert.equal(s.bills[0].notes,'Reviewed historical adjustments');verifyState(s);
});
test('independent cost heads apportion invoice charges exactly and trace one original bill',()=>{
  const s=emptyState();s.bills.push(bill([direct(10001,{costHeadId:'cost-03',costNature:'Labour',work:'Foundation'}),direct(20000,{costHeadId:'cost-07',costNature:'Material',work:'Roof'})],{extras:100,tax:150,discount:51}));
  const root=buildCostHierarchy(s),report=costHierarchySummary(root);
  assert.equal(root.total,30200);assert.equal(sum(report.children.map(c=>c.total)),30200);assert.equal(root.count,1);
  assert.equal(sum(allocatedCostLines(s).map(l=>l.amount)),30200);assert.equal(sum(costBreakdown(s,'nature').map(([,v])=>v)),30200);
  const leaf=costHierarchySummary(root,['cost-03','legacy-subhead','legacy-detail']);
  assert.equal(leaf.entries[0].billId,s.bills[0].id);assert.equal(leaf.entries[0].work,'Foundation');
  assert.equal(costHierarchySummary(root,['missing']),null);assert.equal(costHierarchySummary(root,['a','b','c','d']),null);
});
test('legacy bills remain unclassified and cash, advances and linked plans never inflate cost',()=>{
  const s=emptyState();s.bills.push({id:'old',title:'Historical invoice',total:90001,work:'Roof'});
  s.payments.push({id:'pay',amount:45000,planId:'plan'});s.allocations.push({id:'allocation',paymentId:'pay',billId:'old',amount:25000});s.plans.push({id:'plan',amount:90001,due:'2026-11-01'});s.contracts.push({id:'contract',amount:90001});
  const root=buildCostHierarchy(s);assert.equal(root.total,90001);assert.equal(root.children.get('legacy-head').name,'Unclassified / Legacy');
  assert.equal(allocatedCostLines(s)[0].costHeadId,null);assert.deepEqual(costBreakdown(s),[['Unclassified / Legacy',90001]]);
});
test('renamed inactive catalog categories retain stable identity and historical amounts',()=>{
  const s=emptyState();s.settings.costCatalog=structuredClone(costCatalog(s));
  const head=s.settings.costCatalog.find(c=>c.id==='cost-03');head.label='Electrical renamed';head.active=false;
  s.bills.push(bill([direct(50000,{costHeadId:head.id})]));
  const root=buildCostHierarchy(s);assert.equal(root.children.get(head.id).name,head.label);assert.equal(root.total,50000);
});
test('no-line invoices retain deliberate classification and same-label subheads remain distinct',()=>{
  const s=emptyState(),catalog=costCatalog(s);
  const subheads=catalog.filter(c=>c.type==='subhead'&&c.label==='Testing and commissioning');
  assert.ok(subheads.length>=2);
  s.bills.push({id:'plain',title:'Electrical service',vendor:'Supplier',total:100,costHeadId:'cost-03',costNature:'Labour'});
  subheads.slice(0,2).forEach((sub,i)=>s.bills.push(bill([direct((i+1)*1000,{costHeadId:sub.parentId,costSubheadId:sub.id})])));
  assert.equal(buildCostHierarchy(s).children.get('cost-03').total,100);
  assert.ok(costBreakdown(s,'nature').some(([name,amount])=>name==='Labour'&&amount===100));
  const rows=costBreakdown(s,'subhead');assert.equal(rows.length,3);assert.ok(rows.every(([label])=>label.includes(' → ')));assert.equal(sum(rows.map(([,amount])=>amount)),3100);
});
test('audited reclassification and deletion recalculate from original records',()=>{
  const s=emptyState();const b=bill([direct(50000,{costHeadId:'cost-03'})]);s.bills.push(b);
  changeEntry(s,'bill',b.id,{lines:[{...b.lines[0],costHeadId:'cost-07'}]});
  assert.equal(buildCostHierarchy(s).children.has('cost-03'),false);assert.equal(buildCostHierarchy(s).children.get('cost-07').total,50000);
  assert.equal(s.audit.at(-1).changes[0].before.lines[0].costHeadId,'cost-03');
  changeEntry(s,'bill',b.id);assert.equal(buildCostHierarchy(s).total,0);assert.equal(s.audit.at(-1).changes[0].before.lines[0].costHeadId,'cost-07');
});
test('12,000 decimal multi-line bills reconcile with a large catalog and partial planned settlements',t=>{
  const s=emptyState();s.settings.costCatalog=structuredClone(costCatalog(s));
  for(let i=0;i<1000;i++)s.settings.costCatalog.push({id:`custom-${i}`,label:`Custom ${i}`,parentId:null,type:'head',active:true,order:i,origin:'user'});
  let expected=0;
  for(let i=0;i<12000;i++){
    const value=lineTotal('1.125','99.99');const lines=[{label:'Decimal quantity',qty:'1.125',rate:'99.99',value,costHeadId:i%4?'cost-03':null,costNature:'Labour'},direct(5000,{costHeadId:'cost-07',costNature:'Material'})];
    const total=value+5000+17;s.bills.push({id:`bill-${i}`,date:'2026-10-11',title:'Stress bill',vendor:'Supplier',total,lines,extras:17});expected+=total;
    s.plans.push({id:`plan-${i}`,amount:total,due:'2026-11-11'});s.payments.push({id:`pay-${i}`,amount:1000,planId:`plan-${i}`});s.allocations.push({id:`allocation-${i}`,billId:`bill-${i}`,paymentId:`pay-${i}`,amount:1000});
  }
  const start=performance.now(),root=buildCostHierarchy(s),elapsed=performance.now()-start;
  assert.equal(root.total,expected);assert.equal(root.count,12000);assert.equal(sum([...root.children.values()].map(c=>c.total)),expected);
  assert.equal(sum(costBreakdown(s,'nature').map(([,amount])=>amount)),expected);assert.equal(allocatedCostLines(s).length,24000);
  assert.equal(buildHierarchy(s).total,expected);
  const validationStart=performance.now();assert.equal(verifyState(s),true);
  t.diagnostic(`Financial validation of the same fixture: ${(performance.now()-validationStart).toFixed(1)} ms`);
  t.diagnostic(`12,000 bills / 24,000 lines, 1,000 custom categories: hierarchy ${elapsed.toFixed(1)} ms; synthetic measurement only`);
});
