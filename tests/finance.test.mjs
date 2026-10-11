import test from 'node:test';import assert from 'node:assert/strict';import {paise,lineTotal,billTotal,emptyState,verifyState,dueForBill,availableForPayment,dueForPlan,breakdown,breakdownDetailed,monthlyTotals,summary,proportional,displayMoney,inputMoney} from '../finance.js';
test('integer paise and exact quantity arithmetic',()=>{assert.equal(paise('1,234.56'),123456);assert.equal(lineTotal('2.500','100.25'),25063);assert.equal(billTotal([{qty:'2.500',rate:'100.25'}],101,0,1),25163);assert.throws(()=>paise('1.123'));assert.throws(()=>paise('-5'))});
test('invoice payments and cash are not costs twice',()=>{const s=emptyState();s.bills=[{id:'b',total:50000,title:'Sump steel',lines:[{label:'Steel',qty:'1',rate:'500.00',unit:'kg',work:'Sump',place:'Site',value:50000}]}];s.payments=[{id:'p',amount:20000},{id:'p2',amount:15000}];s.allocations=[{id:'a',paymentId:'p',billId:'b',amount:20000}];verifyState(s);assert.equal(dueForBill(s,'b'),30000);assert.equal(availableForPayment(s,'p2'),15000);assert.equal(summary(s).invoiced,50000);assert.equal(summary(s).paid,35000);assert.equal(summary(s).owed,30000);assert.equal(summary(s).advances,15000)});
test('invalid allocations and missing plan references fail closed',()=>{const s=emptyState();s.bills=[{id:'b',total:100}];s.payments=[{id:'p',amount:100}];s.allocations=[{id:'a',paymentId:'p',billId:'b',amount:101}];assert.throws(()=>verifyState(s));s.allocations[0].amount=100;s.payments[0].planId='missing';assert.throws(()=>verifyState(s))});
test('indexed settlement validation preserves recipients, references and all overpayment guards',()=>{
 const fixture=()=>{const s=emptyState();s.bills=[{id:'b',vendor:' Supplier ',total:100}];s.payments=[{id:'p',vendor:'supplier',amount:100,planId:'plan'}];s.plans=[{id:'plan',vendor:'SUPPLIER',amount:100,due:'2026-10-11'}];s.allocations=[{id:'a',paymentId:'p',billId:'b',amount:100}];return s};
 assert.equal(verifyState(fixture()),true);
 for(const [mutate,message] of [
  [s=>s.bills[0].vendor='Different',/does not match bill vendor/],
  [s=>s.plans[0].vendor='Different',/differs from linked instalment recipient/],
  [s=>s.allocations[0].paymentId='missing',/Invalid payment allocation/],
  [s=>s.allocations[0].billId='missing',/Invalid payment allocation/],
  [s=>s.payments[0].planId='missing',/Missing linked plan/],
  [s=>s.payments[0].amount=99,/Payment is overallocated/],
  [s=>s.bills[0].total=99,/Bill is overpaid/],
  [s=>s.plans[0].amount=99,/Plan is overpaid/],
  [s=>s.plans[0].amount=0,/Invalid planned amount/],
  [s=>s.allocations.push({...s.allocations[0]}),/Duplicate allocation ID/]
 ]){const s=fixture();mutate(s);assert.throws(()=>verifyState(s),message)}
 const s=fixture();s.allocations[0].amount=50;assert.equal(verifyState(s),true);s.allocations[0].amount=101;assert.throws(()=>verifyState(s),/Payment is overallocated/);
});
test('indexed settlement totals reject integer overflow for payments, bills and plans',()=>{
 for(const dimension of ['payment','bill','plan']){
  const s=emptyState(),maximum=Number.MAX_SAFE_INTEGER;s.bills=[{id:'b',total:maximum}];s.payments=[{id:'p',amount:maximum},{id:'p2',amount:1}];
  if(dimension==='plan'){s.plans=[{id:'plan',amount:maximum,due:'2026-10-11'}];for(const p of s.payments)p.planId='plan'}
  else s.allocations=[{id:'a',paymentId:'p',billId:'b',amount:maximum},{id:'a2',paymentId:dimension==='payment'?'p':'p2',billId:'b',amount:1}];
  assert.throws(()=>verifyState(s),/Unsafe financial total/);
 }
});
test('schedule and cash never silently merge',()=>{const s=emptyState();const now=new Date(),date=now.toISOString().slice(0,10);s.plans=[{id:'plan',title:'Engineer',amount:3125000,due:date}];verifyState(s);assert.equal(summary(s,now).planned,3125000);assert.equal(summary(s,now).paid,0);s.payments=[{id:'pay',amount:1000000,planId:'plan'}];assert.equal(dueForPlan(s,'plan'),2125000);assert.equal(summary(s,now).paid,1000000)});
test('split allocation totals exact and category rollups do not double count',()=>{assert.deepEqual(proportional(100,[1,1,1]),[33,33,34]);const s=emptyState();s.bills=[{id:'bill',total:100,lines:[{label:'A',work:'Sump',place:'Site',value:1},{label:'B',work:'Lift',place:'Site',value:1},{label:'C',work:'Sump',place:'Site',value:1}]}];const v=breakdown(s,'work');assert.equal(v.reduce((x,y)=>x+y[1],0),100)});
test('allocation remainder never assigns cost to a zero-value invoice line',()=>{
 for(const [weights,expected] of [[[100,100,0],[50,51,0]],[[0,100,0,100,0],[0,50,0,51,0]],[[100,0,0],[101,0,0]]]){
  const actual=proportional(101,weights);assert.deepEqual(actual,expected);assert.equal(actual.reduce((a,b)=>a+b,0),101);
 }
 assert.deepEqual(proportional(101,[0,0]),[101,0]);
 const s=emptyState();s.bills=[{id:'bill',total:101,lines:[{label:'Steel',work:'Foundation',value:100},{label:'Cement',work:'Foundation',value:100},{label:'Free sample',work:'Finishing',value:0}]}];
 const groups=new Map(breakdown(s,'work'));assert.equal(groups.get('Foundation'),101);assert.equal(groups.get('Finishing'),0);
});


test('segmentation remains stable with many categories and blank labels',()=>{const s=emptyState();for(let i=0;i<120;i++){s.bills.push({id:'b'+i,total:10000+i,title:'Bill '+i,vendor:i%3===0?'':`Vendor ${i%8}`,lines:[{mode:'amount',directAmountPaise:10000+i,label:i%7===0?'':`Item ${i%11}`,work:i%5===0?'':`Stage ${i%9}`,place:i%4===0?'':`Zone ${i%6}`,value:10000+i}]})}verifyState(s);const info=breakdownDetailed(s,'work',5);assert.equal(info.total,s.bills.reduce((x,b)=>x+b.total,0));assert.ok(info.categoryCount>=5);assert.ok(info.segments.length>=5);assert.ok(info.segments.every(x=>x.value>=0&&x.share>=0));assert.ok(info.uncategorised>0);const supplier=breakdownDetailed(s,'vendor',5);assert.ok(supplier.segments.some(x=>x.name==='Unknown supplier'||x.name==='Other'||x.name.startsWith('Vendor')))});
test('monthly totals and breakdown do not overflow with larger datasets',()=>{const s=emptyState();for(let m=1;m<=18;m++){s.payments.push({id:'p'+m,amount:100000*m,date:`2026-${String((m%12)||12).padStart(2,'0')}-15`})}const months=monthlyTotals(s,12);assert.ok(months.length<=12);assert.ok(months.every(x=>x.value>0));});
test('display and input preserve paise at largest safely representable integers',()=>{
  const cases=[[0,'₹0','0.00'],[1,'₹0.01','0.01'],[123456789,'₹12,34,567.89','1234567.89'],[9007199254740991,'₹9,00,71,99,25,47,409.91','90071992547409.91']];
  for(const [value,label,input] of cases){assert.equal(displayMoney(value),label);assert.equal(inputMoney(value),input)}
});
