import test from 'node:test';import assert from 'node:assert/strict';
import {paise,lineValue,billTotal,verifyState,emptyState,breakdown,uid} from '../finance.js';

test('direct rupee amounts require no quantity, rate or unit',()=>{
 const line={mode:'amount',directAmountPaise:paise('10,000.05'),qty:null,rate:null,unit:null,value:paise('10000.05'),label:'12 mm steel',work:'Sump & excavation'};
 assert.equal(lineValue(line),1000005);assert.equal(billTotal([line]),1000005);assert.equal(billTotal([line],0,0,0),1000005);
 const s=emptyState();s.bills.push({id:uid(),title:'Steel',vendor:'Supplier A',total:1000005,date:'2026-10-11',lines:[line],extras:0,tax:0,discount:0});assert.equal(verifyState(s),true);assert.deepEqual(breakdown(s),[['Sump & excavation',1000005]]);
});
test('direct total with optional tax/transport/discount is exact; mixed line modes',()=>{
 const lines=[{mode:'amount',label:'Cement',directAmountPaise:550123,value:550123},{mode:'calculated',label:'Steel',qty:'1.125',rate:'120.25',value:13528,unit:'kg'}];
 assert.equal(lineValue(lines[1]),13528);assert.equal(billTotal(lines,paise('15.50'),paise('0'),paise('3.10')),564891);
});
test('direct amount rejects decimals beyond paise, invalid negatives and non-integral saved amount',()=>{
 for(const input of ['23.001','-5','5e3','1,1x'])assert.throws(()=>paise(input));
 assert.throws(()=>lineValue({mode:'amount',directAmountPaise:12.5}));
});
