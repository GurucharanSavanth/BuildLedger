import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,proportional,verifyState} from '../finance.js';
import {buildHierarchy,resolveHierarchy,hierarchyEntries,hierarchyChildren,hierarchySummary} from '../hierarchy.js';
const stateFixture=()=>{const s=emptyState();s.bills=[
  {id:'steel',title:'Steel and cement invoice',vendor:'Steel Shop',total:10001,extras:1,lines:[{mode:'amount',directAmountPaise:5000,value:5000,label:'12 mm Fe500D',work:'Sump & excavation',substage:'Reinforcement'}, {mode:'amount',directAmountPaise:5000,value:5000,label:'Cement 53 grade',work:'Sump & excavation',substage:'RCC walls'}]},
  {id:'electric',title:'Electrical invoice',vendor:'Elec Shop',total:3300,lines:[{mode:'amount',directAmountPaise:3300,value:3300,label:'Copper wire',work:'Electrical',substage:'Concealed wiring'}]},
  {id:'legacy',title:'Old invoice',vendor:'Old Shop',total:100,lines:[]},
];return s;};
test('stage → substage → material → invoice drilldown reconciles paise exactly',()=>{
 const s=stateFixture();verifyState(s);const root=buildHierarchy(s);
 assert.equal(root.total,13401);assert.equal(hierarchyChildren(root).reduce((t,c)=>t+c.total,0),root.total);
 const sump=resolveHierarchy(root,['Sump & excavation']);assert.equal(sump.total,10001);
 const reinforcement=resolveHierarchy(root,['Sump & excavation','Reinforcement']);assert.equal(reinforcement.total,5000);
 const steel=hierarchySummary(root,['Sump & excavation','Reinforcement','12 mm Fe500D']);assert.equal(steel.total,5000);assert.equal(steel.entries[0].billId,'steel');
 const cement=hierarchySummary(root,['Sump & excavation','RCC walls','Cement 53 grade']);assert.equal(cement.total,5001);
 assert.equal(resolveHierarchy(root,['Uncategorised','Not specified','Old invoice']).total,100);
 assert.equal(hierarchySummary(root,['Sump & excavation']).children.reduce((x,c)=>x+c.total,0),10001);
});
test('historic missing substages are explicitly Not specified, never inferred',()=>{
 const s=stateFixture();const root=buildHierarchy(s);assert.equal(hierarchySummary(root,['Electrical','Concealed wiring','Copper wire']).entries.length,1);
 assert.equal(resolveHierarchy(root,['Invalid']),null);assert.equal(hierarchySummary(root,['Invalid']),null);
});
test('large hierarchy: 12,000 bills preserve exact totals and deterministic drilldown',()=>{
 const s=emptyState();let expected=0;
 for(let i=0;i<12000;i++){const amount=1000+(i%89),stage=`Stage ${i%22}`,substage=`Package ${i%31}`,item=`Item ${i%23}`;expected+=amount;
 s.bills.push({id:`bill-${i}`,title:'Lot '+i,vendor:'Supplier '+(i%17),total:amount,lines:[{mode:'amount',value:amount,directAmountPaise:amount,label:item,work:stage,substage}]});}
 const root=buildHierarchy(s);assert.equal(root.total,expected);
 const stages=hierarchyChildren(root);assert.equal(stages.length,22);assert.equal(stages.reduce((n,c)=>n+c.total,0),expected);
 let leafTotal=0,entryCount=0;
 for(const st of stages)for(const sub of hierarchyChildren(st))for(const leaf of hierarchyChildren(sub)){leafTotal+=leaf.total;entryCount+=hierarchyEntries(leaf).length;}
 assert.equal(leafTotal,expected);assert.equal(entryCount,12000);
});
