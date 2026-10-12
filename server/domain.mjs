import {checkNewPayment,summary,breakdown,eventList,verifyState,uid,dueForBill} from '../finance.js';
import {checkState,failure} from './core.mjs';
import {costBreakdown} from '../cost-analytics.js';
const bad=m=>failure(422,m,'VALIDATION_ERROR');
export function metrics(s){checkState(s);return {revision:s.rev,totals:summary(s),currency:'INR',definitions:{paid:'Posted external payments (including advances)',owed:'Unsettled posted supplier invoices',planned:'Remaining instalments due over next 30 days; may overlap bills'}}}
export function timeline(s){checkState(s);const paid=new Map();for(const p of s.payments)if(p.planId)paid.set(p.planId,(paid.get(p.planId)||0)+p.amount);return s.plans.filter(p=>!p.cancelled).map(p=>({...p,paid:paid.get(p.id)||0}))}
export function activityOptions({type='All',query='',limit=100,offset=0}={}){
 if(typeof type!=='string'||type.length>80||typeof query!=='string'||query.length>200)throw failure(400,'Activity type must be at most 80 characters and search at most 200 characters');
 for(const [name,value] of [['limit',limit],['offset',offset]])if((typeof value==='string'&&!/^\d+$/.test(value))||!Number.isSafeInteger(Number(value))||Number(value)<0||!['string','number'].includes(typeof value))throw failure(400,`Activity ${name} must be a non-negative integer`);
 if(Number(offset)>1000000)throw failure(400,'Activity offset must be at most 1000000');
 return {type,query,limit:Math.min(200,Number(limit)),offset:Number(offset)};
}
export function activity(s,options={}){const {type,query,limit,offset}=activityOptions(options);checkState(s);const events=eventList(s,{type,query});return {count:events.length,items:events.slice(offset,offset+limit),asOfRevision:s.rev}}
export function costs(s,mode='work'){if(!['work','place','vendor','material','head','subhead','nature'].includes(mode))throw bad('Unknown breakdown dimension');return {dimension:mode,values:(['head','subhead','nature'].includes(mode)?costBreakdown(s,mode):breakdown(s,mode)).map(([name,amountPaise])=>({name,amountPaise})),totalPaise:summary(s).invoiced,asOfRevision:s.rev}}
export function appendDomain(state,type,record,links=[]){const s=structuredClone(state);let list;if(type==='bill'){list='bills';if(!record?.id||!record.vendor?.trim()||!record.title?.trim()||!Number.isSafeInteger(record.total)||record.total<=0)throw bad('Invalid bill')}
 else if(type==='payment'){list='payments';try{checkNewPayment(s,record,links[0])}catch(e){throw bad(e.message)}if(links.length>1)throw bad('Use allocation request to split payments across bills');}
 else if(type==='plan'){list='plans';if(!record?.id||!record.vendor?.trim()||!record.title?.trim()||!Number.isSafeInteger(record.amount)||record.amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(record.due))throw bad('Invalid future instalment')}
 else throw bad('Unknown entry type');
 s[list].push(record);if(type==='payment'&&links.length){const link=links[0];s.allocations.push({...link,id:link.id||uid(),paymentId:record.id,recordedAt:new Date().toISOString()})}
 s.audit.push({id:uid(),type:'api_'+type,description:'Created '+type,linked:record.id,at:new Date().toISOString()});s.rev=state.rev+1;try{checkState(s)}catch(e){throw bad(e.message)}return s}
