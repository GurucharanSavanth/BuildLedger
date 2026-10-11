import test from 'node:test';
import assert from 'node:assert/strict';
import {lineTotal,lineValue,emptyState,verifyState,summary,changeEntry,validateRecordChanges} from '../finance.js';

test('direct amounts, bathroom rates and explicit SQ measurement stay exact',()=>{
 assert.equal(lineValue({mode:'amount',directAmountPaise:1250000}),1250000);
 assert.equal(lineTotal('2','3500',{unitId:'bathroom'}),700000);
 assert.equal(lineTotal('300','38500',{quantityUnitId:'sqft',unitId:'sq100'}),11550000);
 assert.equal(lineTotal('100','38500',{quantityUnitId:'sqft',unitId:'sq100',multiplier:'1.5'}),5775000);
 assert.equal(lineTotal('1','2',{quantityUnitId:'tonne',unitId:'kg'}),200000);
 assert.equal(lineTotal('1500','2',{quantityUnitId:'kg',unitId:'tonne'}),300);
});

test('line rounding happens once after multiplier and conversion',()=>{
 assert.equal(lineTotal('0.005','1'),1);
 assert.equal(lineTotal('0.005','1',{multiplier:'1.5'}),1);
 assert.equal(lineTotal('1','0.50',{quantityUnitId:'sqft',unitId:'sq100'}),1);
 assert.equal(lineTotal('2.5','100.25'),25063);
});

test('invalid multipliers, precision, conversions and overflow fail closed',()=>{
 for(const multiplier of ['0','-1','Infinity','NaN','1.0001'])assert.throws(()=>lineTotal('1','1',{multiplier}));
 for(const qty of ['0','-1','NaN','1.0001'])assert.throws(()=>lineTotal(qty,'1'));
 assert.throws(()=>lineTotal('1','1',{quantityUnitId:'tonne',unitId:'m3'}),/conversion/);
 assert.throws(()=>lineTotal('1','1',{unitId:'unknown'}),/unit/);
 assert.throws(()=>lineTotal('999999999','999999999999.99',{multiplier:'999999999'}),/large/);
});
test('optional area quotations match agreement amounts and do not create actual bills',()=>{
 const s=emptyState(),calculation={mode:'calculated',qty:'100',rate:'38500',quantityUnitId:'sqft',unitId:'sq100',multiplier:'1.5'};
 s.contracts=[{id:'quote',title:'Building labour',amount:5775000,calculation,costHeadId:'cost-16'}];assert.equal(verifyState(s),true);assert.equal(summary(s).invoiced,0);
 s.contracts[0].amount++;assert.throws(()=>verifyState(s),/calculation/);
 for(const amount of [0,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){s.contracts[0].amount=amount;assert.throws(()=>verifyState(s),/contract amount/);}
});

test('classification-only audited edits leave cash, advances and liabilities unchanged',()=>{
 const s=emptyState();s.bills=[{id:'b',total:10000,title:'Legacy',date:'2026-10-11'}];
 s.payments=[{id:'p',amount:6000},{id:'advance',amount:2000}];s.allocations=[{id:'a',paymentId:'p',billId:'b',amount:6000}];
 const before=structuredClone(s),totals=summary(s);changeEntry(s,'bill','b',{costNature:'Labour'});
 assert.equal(validateRecordChanges(before,s),true);assert.deepEqual(summary(s),totals);
 assert.equal(s.audit.at(-1).changes[0].before.costNature,undefined);
});

test('invoice extras reject negatives and complete contract schedules reconcile',()=>{
 const s=emptyState();s.bills=[{id:'b',total:100,extras:-1}];assert.throws(()=>verifyState(s),/extras/);s.bills=[];
 s.contracts=[{id:'c',amount:1001,scheduleComplete:true}];
 s.plans=Array.from({length:16},(_,i)=>({id:'p'+i,contractId:'c',amount:i<9?63:62,due:'2026-10-11'}));
 assert.equal(verifyState(s),true);s.plans[0].amount++;assert.throws(()=>verifyState(s),/reconcile/);
});

test('catalog changes require an exact immutable audit snapshot',()=>{
 const before=emptyState(),next=structuredClone(before);next.settings.costCatalog[0].label+=' renamed';
 assert.throws(()=>validateRecordChanges(before,next),/catalog/);
 next.audit.push({id:'catalog-edit',type:'cost_catalog',before:structuredClone(before.settings.costCatalog),after:structuredClone(next.settings.costCatalog)});
 assert.equal(validateRecordChanges(before,next),true);next.audit[0].before=[];
 assert.throws(()=>validateRecordChanges(before,next),/catalog|Catalog/);
});
test('deleting a scheduled instalment preserves commitment with an audited incomplete schedule',()=>{
 const s=emptyState();s.contracts=[{id:'c',amount:1001,scheduleComplete:true,title:'Engineer'}];
 s.plans=[{id:'p',contractId:'c',amount:1001,due:'2026-10-11',title:'Engineer instalment'}];
 const before=structuredClone(s);changeEntry(s,'plan','p');assert.equal(s.contracts[0].amount,1001);assert.equal(s.contracts[0].scheduleComplete,false);validateRecordChanges(before,s);
 assert.ok(s.audit[0].changes.some(c=>c.kind==='contracts'));
});
test('agreement reclassification updates linked plans with exact audited snapshots',()=>{
 const s=emptyState();s.contracts=[{id:'c',amount:1001,title:'Engineer',vendor:'A'}];s.plans=[{id:'p',contractId:'c',amount:1001,due:'2026-10-11',title:'Engineer instalment',vendor:'A'}];
 const before=structuredClone(s);changeEntry(s,'contract','c',{costHeadId:'cost-17',costNature:'Professional Service'});assert.equal(s.plans[0].costHeadId,'cost-17');validateRecordChanges(before,s);
});
