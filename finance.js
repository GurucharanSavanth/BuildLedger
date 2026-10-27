/* All posted monetary values are integer paise, never floating-point currency. */
import {costCatalog,validateCostCatalog,validateClassification,seedCostCatalog,UNITS} from './cost-catalog.js';
export const uid=()=>{if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const r=crypto.getRandomValues(new Uint8Array(16));r[6]=(r[6]&15)|64;r[8]=(r[8]&63)|128;const h=[...r].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
export function paise(input){const v=String(input??'').trim().replace(/,/g,'');if(!/^\d{1,12}(\.\d{1,2})?$/.test(v))throw Error('Enter a valid amount, with up to two decimal places.');const [a,b='']=v.split('.');const n=BigInt(a)*100n+BigInt((b+'00').slice(0,2));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('The amount is too large.');return Number(n)}
export function qtyScaled(input){const v=String(input??'').trim();if(!/^\d{1,9}(\.\d{1,3})?$/.test(v))throw Error('Enter a quantity with up to three decimal places.');const [a,b='']=v.split('.');return BigInt(a)*1000n+BigInt((b+'000').slice(0,3))}
export function lineTotal(quantity,unitRate,{multiplier='1',quantityUnitId,unitId}={}){
 for(const id of [unitId,quantityUnitId])if(id&&!UNITS.some(u=>u.id===id))throw Error('Unknown calculation unit.');
 const q=qtyScaled(quantity),m=qtyScaled(multiplier);if(q<=0n)throw Error('Quantity must be greater than zero.');if(m<=0n)throw Error('Multiplier must be greater than zero.');
 let numerator=q*BigInt(paise(unitRate))*m,denominator=1000000n;
 if(quantityUnitId&&quantityUnitId!==unitId){
  if(quantityUnitId==='sqft'&&unitId==='sq100')denominator*=100n;
  else if(quantityUnitId==='kg'&&unitId==='tonne')denominator*=1000n;
  else if(quantityUnitId==='tonne'&&unitId==='kg')numerator*=1000n;
  else throw Error('Unsupported unit conversion.');
 }
 // Round half up once, at the posted line-item paise boundary.
 const n=(numerator+denominator/2n)/denominator;if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('The calculated amount is too large.');return Number(n);
}
export function lineValue(l){if(l.mode==='amount'||l.directAmountPaise!==undefined){if(!Number.isSafeInteger(l.directAmountPaise)||l.directAmountPaise<0)throw Error('Invalid direct item amount');return l.directAmountPaise}return lineTotal(l.qty,l.rate,l)}
export function displayMoney(v=0){if(!Number.isSafeInteger(v))throw Error('Unsafe currency value for display');const n=BigInt(v),a=n<0n?-n:n;const whole=a/100n,cents=a%100n;return (n<0n?'−':'')+'₹'+whole.toLocaleString('en-IN')+(cents?'.'+String(cents).padStart(2,'0'):'')}
export function inputMoney(v=0){if(!Number.isSafeInteger(v))throw Error('Unsafe currency value for input');const n=BigInt(v),a=n<0n?-n:n;return (n<0n?'-':'')+String(a/100n)+'.'+String(a%100n).padStart(2,'0')}
export function safeInt(n){if(!Number.isSafeInteger(n)||Math.abs(n)>Number.MAX_SAFE_INTEGER)throw Error('Unsafe financial total.');return n}
export function add(a,b){return safeInt(a+b)}
export const sum=arr=>arr.reduce((x,y)=>add(x,y),0);
export function billTotal(lines,extras=0,tax=0,discount=0){const base=sum(lines.map(l=>lineValue(l)));const v=add(add(base,extras),tax)-discount;if(lines.length&&!base&&v>0)throw Error('Enter a positive item amount before adding invoice charges.');return safeInt(v)}
export function proportional(total,weights){if(!weights.length)return [];if(weights.some(w=>!Number.isSafeInteger(w)||w<0))throw Error('Invalid allocation weights');const wsum=sum(weights);if(!wsum){return [total,...weights.slice(1).map(()=>0)]}const lastPositive=weights.findLastIndex(w=>w>0);let allocated=0;return weights.map((w,i)=>{if(!w)return 0;if(i===lastPositive)return total-allocated;let n=Number(BigInt(total)*BigInt(w)/BigInt(wsum));allocated=add(allocated,n);return n})}
export function emptyState(){return {schema:1,project:{name:'My House Construction',budget:0,currency:'INR'},bills:[],payments:[],allocations:[],plans:[],contracts:[],entries:[],files:[],audit:[],settings:{lastBackupAt:null,costCatalog:seedCostCatalog()},rev:0}}
export function planSupplier(plan,contract){return String(plan.vendor??'').trim()||String(contract?.vendor??'').trim()}
function verifyFinancialState(s){
 if(!s||s.schema!==1)throw Error('Unsupported or damaged backup version.');
 for(const key of ['bills','payments','allocations','plans','contracts','entries','files','audit'])if(!Array.isArray(s[key]))throw Error('Backup missing '+key);
 if(!s.project||typeof s.project.name!=='string')throw Error('Project settings missing');
 if(!Number.isSafeInteger(s.project.budget)||s.project.budget<0)throw Error('Invalid project budget');
 if(!Number.isSafeInteger(s.rev)||s.rev<0)throw Error('Invalid project revision');
 const unique=(list,name)=>{const records=new Map();for(const r of list){if(!r.id||records.has(r.id))throw Error(`Duplicate ${name} ID`);records.set(r.id,r)}return records};
 const bills=unique(s.bills,'bill'),pays=unique(s.payments,'payment'),plans=unique(s.plans,'plan'),contracts=unique(s.contracts,'contract');unique(s.files,'file');unique(s.allocations,'allocation');unique(s.entries,'entry');unique(s.audit,'audit');
 for(const r of [...s.bills,...s.payments,...s.entries])if(r.date!==undefined&&!validDate(r.date))throw Error('Invalid entry date');
 for(const p of s.plans)if(!validDate(p.due))throw Error('Invalid planned date');
 for(const p of s.plans)if(p.contractId){const contract=contracts.get(p.contractId);if(!contract)throw Error('Missing linked contract');if(String(p.vendor??'').trim()&&String(contract.vendor??'').trim()&&String(p.vendor).trim().toLocaleLowerCase()!==String(contract.vendor).trim().toLocaleLowerCase())throw Error('Instalment supplier does not match linked contract');}
 for(const b of s.bills)if(!Number.isSafeInteger(b.total)||b.total<=0)throw Error('Invalid bill amount');
 for(const p of s.payments){if(!Number.isSafeInteger(p.amount)||p.amount<=0)throw Error('Invalid payment amount');if(p.planId&&!plans.has(p.planId))throw Error('Missing linked plan')}
 for(const x of s.allocations)if(!pays.has(x.paymentId)||!bills.has(x.billId)||!Number.isSafeInteger(x.amount)||x.amount<=0)throw Error('Invalid payment allocation');
 for(const a of s.allocations){const p=pays.get(a.paymentId),b=bills.get(a.billId);if(p.vendor&&b.vendor&&String(p.vendor).trim().toLowerCase()!==String(b.vendor).trim().toLowerCase())throw Error('Payment recipient does not match bill vendor')}
 for(const p of s.payments){const plan=plans.get(p.planId),recipient=plan?planSupplier(plan,contracts.get(plan.contractId)):'';if(recipient&&String(p.vendor??'').trim()&&String(p.vendor).trim().toLocaleLowerCase()!==recipient.toLocaleLowerCase())throw Error('Payment recipient differs from linked instalment recipient')}
 const appliedPayments=new Map(),appliedBills=new Map(),paidPlans=new Map();
 for(const a of s.allocations){appliedPayments.set(a.paymentId,add(appliedPayments.get(a.paymentId)||0,a.amount));appliedBills.set(a.billId,add(appliedBills.get(a.billId)||0,a.amount))}
 for(const p of s.payments)if((appliedPayments.get(p.id)||0)>p.amount)throw Error('Payment is overallocated');
 for(const b of s.bills)if((appliedBills.get(b.id)||0)>b.total)throw Error('Bill is overpaid');
 for(const t of s.plans)if(!Number.isSafeInteger(t.amount)||t.amount<=0)throw Error('Invalid planned amount');
 for(const p of s.payments)if(plans.has(p.planId))paidPlans.set(p.planId,add(paidPlans.get(p.planId)||0,p.amount));
 for(const t of s.plans)if((paidPlans.get(t.id)||0)>t.amount)throw Error('Plan is overpaid');
 // Dashboard totals and any 30-calendar-day schedule window must remain representable.
 sum(s.bills.map(b=>b.total));sum(s.payments.map(p=>p.amount));
 const upcoming=s.plans.filter(p=>!p.cancelled).map(p=>({day:Date.parse(p.due+'T12:00:00Z')/86400000,remaining:p.amount-(paidPlans.get(p.id)||0)})).sort((a,b)=>a.day-b.day);
 let windowTotal=0,first=0;
 for(const plan of upcoming){while(first<upcoming.length&&plan.day-upcoming[first].day>30)windowTotal-=upcoming[first++].remaining;windowTotal=add(windowTotal,plan.remaining);}
 for(const b of s.bills)if(b.lines?.length){for(const l of b.lines)if(l.value!==lineValue(l))throw Error('Bill has inconsistent line-item value');if(safeInt(add(add(sum(b.lines.map(lineValue)),b.extras||0),b.tax||0)-(b.discount||0))!==b.total)throw Error('Bill line totals do not reconcile')}
 for(const f of s.files)if(!f.id||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid file metadata');
 return true;
}
export function verifyState(s){
 verifyFinancialState(s);
 const catalog=new Map(costCatalog(s).map(c=>[c.id,c]));
 for(const b of s.bills){
  validateClassification(b,catalog);
  for(const line of b.lines||[]){validateClassification(line,catalog);if(line.multiplier!=null&&qtyScaled(line.multiplier)<=0n)throw Error('Multiplier must be greater than zero.');if(line.qty!=null)qtyScaled(line.qty);if(line.rate!=null)paise(line.rate);}
  for(const key of ['extras','tax','discount'])if(b[key]!==undefined&&(!Number.isSafeInteger(b[key])||b[key]<0))throw Error('Invalid invoice '+key);
 }
 for(const record of [...s.plans,...s.contracts])validateClassification(record,catalog);
 for(const contract of s.contracts){if(!Number.isSafeInteger(contract.amount)||contract.amount<=0)throw Error('Invalid contract amount.');if(contract.calculation){validateClassification(contract.calculation,catalog);if(lineValue(contract.calculation)!==contract.amount)throw Error('Contract calculation does not match the agreed amount.');}}
 const completed=new Set(s.contracts.filter(c=>c.scheduleComplete).map(c=>c.id)),scheduled=new Map();for(const plan of s.plans)if(completed.has(plan.contractId))scheduled.set(plan.contractId,add(scheduled.get(plan.contractId)||0,plan.amount));
 for(const contract of s.contracts)if(contract.scheduleComplete&&scheduled.get(contract.id)!==contract.amount)throw Error('Contract instalments do not reconcile.');
 return true;
}
export function appliedForBill(s,id){return sum(s.allocations.filter(a=>a.billId===id).map(a=>a.amount))}
export function availableForPayment(s,id){const p=s.payments.find(x=>x.id===id);return p?p.amount-sum(s.allocations.filter(a=>a.paymentId===id).map(a=>a.amount)):0}
export function dueForBill(s,id){const b=s.bills.find(x=>x.id===id);return b?b.total-appliedForBill(s,id):0}
export function paidForPlan(s,id){return sum(s.payments.filter(p=>p.planId===id).map(p=>p.amount))}
export function dueForPlan(s,id){const p=s.plans.find(x=>x.id===id);return p?Math.max(0,p.amount-paidForPlan(s,id)):0}
export function settlementIndex(s){
 const bills=new Map(),payments=new Map(),plans=new Map();
 for(const a of s.allocations){bills.set(a.billId,add(bills.get(a.billId)||0,a.amount));payments.set(a.paymentId,add(payments.get(a.paymentId)||0,a.amount))}
 for(const p of s.payments)if(p.planId)plans.set(p.planId,add(plans.get(p.planId)||0,p.amount));
 return {bills,payments,plans};
}
export function summary(s,asOf=new Date()){const balances=settlementIndex(s),paid=sum(s.payments.map(p=>p.amount));const invoiced=sum(s.bills.map(b=>b.total));const owed=sum(s.bills.map(b=>b.total-(balances.bills.get(b.id)||0)));const advances=sum(s.payments.map(p=>p.amount-(balances.payments.get(p.id)||0)));const today=localDate(asOf),date30=localDate(new Date(asOf.getFullYear(),asOf.getMonth(),asOf.getDate()+30));const planned=sum(s.plans.filter(p=>!p.cancelled&&p.due>=today&&p.due<=date30).map(p=>Math.max(0,p.amount-(balances.plans.get(p.id)||0))));return {paid,invoiced,owed,advances,planned,budget:s.project.budget,files:s.files.length}}
export function invoiceCostLines(bill){const lines=bill.lines?.length?bill.lines:[{...bill,label:bill.title,value:bill.total}];return bill.total>0&&!sum(lines.map(l=>Number.isSafeInteger(l.value)?l.value:lineValue(l)))?[{label:'Unclassified invoice adjustments',value:bill.total,work:'Uncategorised',place:'Unspecified'}]:lines}
function cleanLabel(v,fallback){const text=String(v??'').trim();return text||fallback}
export function breakdown(s,key='work'){const groups=new Map();for(const bill of s.bills){let items=invoiceCostLines(bill);const baseWeights=items.map(l=>Number.isSafeInteger(l.value)?l.value:lineValue(l));const alloc=proportional(bill.total,baseWeights);items.forEach((l,i)=>{let k=key==='work'?cleanLabel(l.work||bill.work,'Uncategorised'):key==='place'?cleanLabel(l.place||bill.place,'Unspecified'):key==='vendor'?cleanLabel(bill.vendor,'Unknown supplier'):key==='material'?cleanLabel(l.label||bill.title,'Unnamed item'):'Other';groups.set(k,add(groups.get(k)||0,alloc[i]))})}return [...groups.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))}
export function breakdownDetailed(s,key='work',limit=5){const rows=breakdown(s,key);const total=sum(rows.map(([,v])=>v));const top=rows.slice(0,Math.max(1,limit));const otherValue=sum(rows.slice(limit).map(([,v])=>v));const all=otherValue?[...top,['Other',otherValue]]:top.slice();const segments=all.map(([name,value])=>({name,value,share:total?value/total:0}));const largest=rows[0]?{name:rows[0][0],value:rows[0][1],share:total?rows[0][1]/total:0}:null;const uncategorised=rows.filter(([name])=>/uncategor|unspecified|unknown|unnamed/i.test(name)).reduce((x,[,v])=>add(x,v),0);return {total,segments,largest,uncategorised,categoryCount:rows.length,otherValue,source:rows}}
export function monthlyTotals(s,limit=12){const m=new Map();for(const p of s.payments){const k=(p.date?.slice(0,7)||'Unknown');m.set(k,add(m.get(k)||0,p.amount))}const arr=[...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).slice(-limit);const max=arr.length?Math.max(...arr.map(([,v])=>v)):0;return arr.map(([month,value])=>({month,value,share:max?value/max:0}))}
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value}
export function localDate(d=new Date()){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
export function localStamp(iso){if(!iso)return '—';let d=new Date(iso);if(Number.isNaN(d.getTime()))return String(iso);const n=v=>String(v).padStart(2,'0');return `${n(d.getDate())}-${n(d.getMonth()+1)}-${d.getFullYear()} :: ${n(d.getHours())}:${n(d.getMinutes())}:${n(d.getSeconds())}`}
export function activityEvent(kind,r,{bill,payment,paid=0}={}){
 if(kind==='bills')return {id:r.id,kind:'bill',at:r.recordedAt,date:r.date,label:r.title,party:r.vendor,amount:r.total,status:'Bill recorded',work:r.work};
 if(kind==='payments')return {id:r.id,kind:'payment',at:r.recordedAt,date:r.date,label:`Payment to ${r.vendor}`,party:r.vendor,amount:r.amount,status:'Paid',work:r.work};
 if(kind==='plans')return {id:r.id,kind:'plan',at:r.recordedAt,date:r.due,label:`Planned: ${r.title}`,party:r.vendor,amount:r.amount,status:r.cancelled?'Cancelled':Math.max(0,r.amount-paid)===0?'Completed':'Scheduled',work:r.work};
 if(kind==='entries')return {id:r.id,kind:r.kind,at:r.recordedAt,date:r.date,label:r.title,party:r.party||'',amount:r.amount??null,status:r.status||'Saved',work:r.work};
 if(kind==='files')return {id:r.id,kind:'file',at:r.importedAt,date:r.importedAt?.slice(0,10),label:`File added: ${r.name}`,party:r.category,amount:null,status:r.status||'Saved',work:r.work};
 if(kind==='allocations')return {id:r.id,kind:'allocation',at:r.recordedAt,date:r.recordedAt?.slice(0,10),label:'Advance applied to '+(bill?.title||'bill'),party:payment?.vendor||'',amount:r.amount,status:'Allocated',work:bill?.work};
 if(kind==='contracts')return {id:r.id,kind:'contract',at:r.createdAt,date:r.createdAt?.slice(0,10),label:r.title,party:r.vendor,amount:r.amount,status:'Contract',work:r.work};
 if(kind==='audit')return {id:r.id,kind:'audit',at:r.at,date:r.at?.slice(0,10),label:r.description||r.type,party:'Project log',amount:null,status:r.type==='entry_edit'?'Edited':r.type==='entry_delete'?'Deleted':'Logged',work:''};
 throw Error('Unknown activity record kind');
}
export const activityTime=at=>{const n=new Date(at).getTime();return Number.isFinite(n)?n:0};
export const activitySearch=e=>[e.label,e.party,e.work,e.date].join(' ').toLocaleLowerCase();
export function eventList(s,{type='All',query=''}={}){
 const balances=settlementIndex(s),bills=new Map(s.bills.map(b=>[b.id,b])),payments=new Map(s.payments.map(p=>[p.id,p])),search=query.toLocaleLowerCase(),events=[];
 for(const kind of ['bills','payments','plans','entries','files','allocations','contracts','audit'])for(const r of s[kind])events.push(activityEvent(kind,r,{bill:bills.get(r.billId),payment:payments.get(r.paymentId),paid:balances.plans.get(r.id)||0}));
 return events.filter(e=>(type==='All'||e.kind===type)&&activitySearch(e).includes(search)).sort((a,b)=>activityTime(b.at)-activityTime(a.at)||compareEventText(a.kind,b.kind)||compareEventText(a.id,b.id));
}
// Match SQLite BINARY ordering for timestamp ties, including non-BMP text.
function compareEventText(a='',b=''){const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const difference=x[i].codePointAt(0)-y[i].codePointAt(0);if(difference)return difference}return x.length-y.length}
export function checkNewPayment(s,p,allocation){if(!p.vendor?.trim())throw Error('Enter the recipient.');if(!Number.isSafeInteger(p.amount)||p.amount<=0)throw Error('Enter a valid payment amount.');if(p.planId){const plan=s.plans.find(x=>x.id===p.planId);if(!plan)throw Error('Payment plan not found');if(plan.cancelled)throw Error('Cannot pay a cancelled instalment.');const recipient=planSupplier(plan,s.contracts.find(contract=>contract.id===plan.contractId));if(recipient&&p.vendor.trim().toLocaleLowerCase()!==recipient.toLocaleLowerCase())throw Error('Payment recipient does not match the scheduled instalment');if(p.amount>dueForPlan(s,plan.id))throw Error('Payment exceeds scheduled balance.')}if(allocation?.billId){let bill=s.bills.find(x=>x.id===allocation.billId);if(!bill)throw Error('Selected bill not found');if(bill.vendor?.trim()&&p.vendor.trim().toLocaleLowerCase()!==bill.vendor.trim().toLocaleLowerCase())throw Error('Payment recipient does not match bill vendor');if(!Number.isSafeInteger(allocation.amount)||allocation.amount<=0)throw Error('Enter a valid allocation amount.');if(allocation.amount>dueForBill(s,bill.id))throw Error('Amount exceeds unpaid bill balance.');if(allocation.amount>p.amount)throw Error('Cannot allocate more than the payment.')}}
export function makeBill(form){let lines=(form.lines||[]).map(l=>({...l,value:lineValue(l)}));let total=billTotal(lines,form.extras||0,form.tax||0,form.discount||0);if(total<=0)throw Error('Total must be positive.');return {id:uid(),recordedAt:new Date().toISOString(),date:form.date,title:form.title,vendor:form.vendor,work:form.work,place:form.place,invoice:form.invoice||'',notes:form.notes||'',type:form.type||'purchase',total,lines,extras:form.extras||0,tax:form.tax||0,discount:form.discount||0}}

const entryLists={bill:'bills',payment:'payments',plan:'plans',contract:'contracts',note:'entries',allocation:'allocations'};
const postedLists=['bills','payments','allocations','plans','contracts','entries'];
export function changeEntry(s,kind,id,patch=null){
 const list=entryLists[kind],record=s[list]?.find(r=>r.id===id);
 if(!record)throw Error('Entry no longer exists. Reload and try again.');
 const previous=structuredClone(s),before=structuredClone(record);
 if(patch){
  for(const key of ['id','recordedAt','createdAt'])if(key in patch)throw Error('Entry identity and original timestamp cannot change.');
  Object.assign(record,patch);
  if(kind==='bill'&&record.lines?.length)record.total=safeInt(add(add(sum(record.lines.map(lineValue)),record.extras||0),record.tax||0)-(record.discount||0));
  if(kind==='payment'){
   const links=s.allocations.filter(a=>a.paymentId===id);
   if(links.length===1&&links[0].amount===before.amount)links[0].amount=record.amount;
  }
  if(kind==='contract'){
   const plans=s.plans.filter(p=>p.contractId===id);
   if(plans.length&&record.amount!==before.amount){const amounts=proportional(record.amount,plans.map(p=>p.amount));plans.forEach((p,i)=>p.amount=amounts[i]);}
   for(const p of plans){p.vendor=record.vendor;p.title=String(p.title).replace(before.title,record.title);for(const key of ['costHeadId','costSubheadId','costDetailId','costNature','work'])if(key in patch)p[key]=record[key];}
  }
 }else{
  const planIds=new Set(kind==='contract'?s.plans.filter(p=>p.contractId===id).map(p=>p.id):kind==='plan'?[id]:[]);
  s[list]=s[list].filter(r=>r.id!==id);
  if(kind==='bill')s.allocations=s.allocations.filter(a=>a.billId!==id);
  if(kind==='payment')s.allocations=s.allocations.filter(a=>a.paymentId!==id);
  if(kind==='contract')s.plans=s.plans.filter(p=>!planIds.has(p.id));
  if(kind==='plan'&&record.contractId){const contract=s.contracts.find(c=>c.id===record.contractId);if(contract?.scheduleComplete)contract.scheduleComplete=false;}
  for(const p of s.payments)if(planIds.has(p.planId))p.planId='';
 }
 const changes=[];
 for(const k of postedLists){const next=new Map(s[k].map(r=>[r.id,r]));for(const r of previous[k]){const after=next.get(r.id)||null;if(JSON.stringify(r)!==JSON.stringify(after))changes.push({kind:k,id:r.id,before:r,after:structuredClone(after)});}}
 if(!changes.length)return;
 s.audit.push({id:uid(),type:patch?'entry_edit':'entry_delete',description:`${patch?'Edited':'Deleted'} ${kind}: ${before.title||before.vendor||'Entry'}`,linked:id,kind,at:new Date().toISOString(),changes});
 verifyState(s);
 validateRecordChanges(previous,s);
}
export function validateRecordChanges(previous,next,replace=false){
 if(replace)return true;
 const existing=new Map(previous.audit.map(a=>[a.id,a]));
 const incoming=new Map(next.audit.map(a=>[a.id,a]));
 for(const [id,a] of existing)if(JSON.stringify(a)!==JSON.stringify(incoming.get(id)))throw Error('Cannot change or delete an audit record.');
 const beforeCatalog=previous.settings?.costCatalog,afterCatalog=next.settings?.costCatalog;
 const previousCategories=costCatalog(previous),newCategories=costCatalog(next),categoryBefore=new Map(previousCategories.map(c=>[c.id,c]));
 const catalogChanges=newCategories.filter(c=>JSON.stringify(categoryBefore.get(c.id))!==JSON.stringify(c)).map(c=>({id:c.id,before:categoryBefore.get(c.id)||null,after:c}));
 const exactCatalogLog=a=>a.catalogChanges!==undefined?JSON.stringify(a.catalogChanges)===JSON.stringify(catalogChanges):JSON.stringify(a.before)===JSON.stringify(beforeCatalog)&&JSON.stringify(a.after)===JSON.stringify(afterCatalog);
 if(JSON.stringify(beforeCatalog)!==JSON.stringify(afterCatalog)){
  const nextCategories=new Map(newCategories.map(c=>[c.id,c]));
  for(const category of previousCategories){const saved=nextCategories.get(category.id);if(!saved||saved.type!==category.type||saved.parentId!==category.parentId||saved.origin!==category.origin)throw Error('Cost category identity and parent cannot change; deactivate instead.');}
  const initialSeed=beforeCatalog===undefined&&JSON.stringify(afterCatalog)===JSON.stringify(seedCostCatalog());
  const catalogLog=next.audit.some(a=>!existing.has(a.id)&&a.type==='cost_catalog'&&exactCatalogLog(a));
  if(!initialSeed&&!catalogLog)throw Error('Cannot modify the cost catalog without an exact audit log.');
 }
 for(const a of next.audit.filter(a=>!existing.has(a.id)&&a.type==='cost_catalog'))if(!exactCatalogLog(a))throw Error('Catalog audit does not match saved categories.');
 const changes=next.audit.filter(a=>!existing.has(a.id)&&['entry_edit','entry_delete'].includes(a.type)).flatMap(a=>a.changes||[]);
 for(const k of postedLists){
  const wanted=new Map(next[k].map(r=>[r.id,r]));
  for(const before of previous[k]){
   const after=wanted.get(before.id)||null;
   if(JSON.stringify(before)===JSON.stringify(after))continue;
   // Existing plan cancellation remains compatible with earlier clients.
   if(k==='plans'&&after&&JSON.stringify({...before,cancelled:after.cancelled})===JSON.stringify(after)&&typeof after.cancelled==='boolean')continue;
   const log=changes.find(c=>c.kind===k&&c.id===before.id&&JSON.stringify(c.before)===JSON.stringify(before)&&JSON.stringify(c.after)===JSON.stringify(after));
   if(!log)throw Error('Cannot modify or delete a posted record without an exact audit log.');
  }
 }
 for(const c of changes){const before=previous[c.kind]?.find(r=>r.id===c.id),after=next[c.kind]?.find(r=>r.id===c.id)||null;if(!postedLists.includes(c.kind)||JSON.stringify(before)!==JSON.stringify(c.before)||JSON.stringify(after)!==JSON.stringify(c.after))throw Error('Audit changes do not match the saved entry.');}
 return true;
}
