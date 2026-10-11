"""UI test for V2 using a deterministic browser-side data adapter; validates UX and money breakdown, not live MongoDB."""
from pathlib import Path
from playwright.sync_api import sync_playwright
p=Path(__file__).resolve().parent.parent
html=(p/'index.html').read_text().replace('<link rel="stylesheet" href="./styles.css">','<style>'+(p/'styles.css').read_text()+'</style>')
import re
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','',html)
finance=(p/'finance.js').read_text().replace('export ','')
hierarchy=(p/'hierarchy.js').read_text().replace("import {add, sum, proportional, lineValue} from './finance.js';",'').replace('export ','')
mock='''let fakeData=emptyState(),fakeFiles=new Map();function storageMode(){return 'local'}async function loginRemote(){}function hasPendingWrite(){return false}async function retryPendingWrite(){}async function readState(){return structuredClone(fakeData)}async function openDb(){return true}async function readFile(id){return fakeFiles.get(id)}async function readAllFiles(){return [...fakeFiles.values()]}async function readSnapshot(){return {state:structuredClone(fakeData),files:[...fakeFiles.values()]}}async function modify(fn,opt={}){const st=structuredClone(fakeData);let result=fn(st);st.rev=(fakeData.rev||0)+1;verifyState(st);fakeData=st;for(const f of (opt.newFiles||[]))fakeFiles.set(f.id,f);for(const id of (opt.removeFiles||[]))fakeFiles.delete(id);return result}async function replaceAll(data,files){verifyState(data);fakeData=data;fakeFiles=new Map(files.map(f=>[f.id,f]))}'''
archive='\n'.join(x for x in (p/'archive.js').read_text().splitlines() if not x.startswith('import ')).replace('export ','')
app='\n'.join(x for x in (p/'app.js').read_text().splitlines() if not x.startswith('import ')).replace('export ','')
html=html.replace('<script type="module" src="./app.js"></script>','<script>'+finance+'\n'+hierarchy+'\n'+mock+'\n'+archive+'\n'+app+'</script>')
with sync_playwright() as w:
 b=w.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1380,'height':900},accept_downloads=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.evaluate("Object.defineProperty(window.crypto,'subtle',{configurable:true,value:{digest:async()=>new Uint8Array(32).buffer}})")
 page.set_content(html,wait_until='load');page.wait_for_timeout(300)
 assert 'Money paid so far' in page.locator('#main').inner_text(),errors
 page.locator('#rail-nav [data-nav=add]').click()
 page.locator('[data-flow=purchase]').click()
 page.locator('input[name=vendor]').fill('Test Materials')
 page.locator('.item-name').fill('20 mm gravel')
 assert page.locator('.item-qty').is_hidden()
 assert page.locator('.item-rate').is_hidden()
 page.locator('.item-more-details').check()
 assert page.locator('.item-qty').is_visible()
 page.locator('.item-qty').fill('25.5')
 page.locator('.item-unit').select_option('kg')
 page.locator('.item-amount').fill('5500.25')
 page.locator('select[name=payStatus]').select_option('full')
 assert page.locator('#f-paidAmount').is_hidden()
 page.locator('#entry-form button[type=submit]').click()
 assert '₹5,500.25' in page.locator('#modal-inner').inner_text(),page.locator('#modal-inner').inner_text()
 page.locator('[data-action=confirm]').click();page.wait_for_timeout(300)
 page.locator('#rail-nav [data-nav=home]').click()
 screen=page.locator('#main').inner_text();assert '₹5,500.25' in screen,screen
 assert page.evaluate("fakeData.bills[0].lines[0].qty")=='25.5'
 assert page.evaluate("fakeData.bills[0].lines[0].unit")=='kg'
 assert page.evaluate("fakeData.bills[0].lines[0].value")==550025
 print('PASS: direct amount purchase with optional fields and full payment')
 page.locator('#rail-nav [data-nav=add]').click()
 page.locator('[data-flow=labour]').click()
 page.locator('input[name=vendor]').fill('Labour team')
 page.locator('input[name=title]').fill('Formwork labour')
 assert page.locator('input[name=qty]').is_hidden()
 assert page.locator('input[name=rate]').is_hidden()
 page.locator('input[name=amount]').fill('1950.00')
 page.locator('#entry-form button[type=submit]').click()
 page.locator('[data-action=confirm]').click();page.wait_for_timeout(200)
 page.locator('#rail-nav [data-nav=home]').click()
 assert '₹1,950' in page.locator('#main').inner_text()
 print('PASS: direct labour amount without quantity/rate')
 # Real preview logic within mock storage (not API route)
 page.evaluate("""async()=>{const f=new File([new Uint8Array([37,80,68,70,45,49,46,55,10,116,101,115,116])],'Column_Plan.pdf',{type:'application/pdf'});await importManyFiles([f])}""")
 page.wait_for_timeout(250)
 assert 'Column_Plan.pdf' in page.locator('#main').inner_text()
 page.locator('[data-file]').first.click()
 assert page.locator('[data-action=delete-file]').count()==1
 page.locator('[data-action=view-file]').click()
 assert page.locator('#document-preview iframe').count()==1
 assert page.locator('#document-preview iframe').get_attribute('src').startswith('blob:')
 print('PASS: in-app PDF preview created as blob URL')
 # share does not fall back to implicit downloads
 page.locator('[data-action=external-file]').click()
 assert 'does not support sharing files' in page.locator('#toast').inner_text()
 page.once('dialog',lambda d:d.accept())
 page.locator('[data-action=delete-file]').click();page.wait_for_timeout(250)
 assert 'Column_Plan.pdf' not in page.locator('#main').inner_text()
 assert page.evaluate('fakeFiles.size')==0
 print('PASS: explicit file deletion removes original blob, no silent share download')
 # Unknown CAD original has no misleading browser-open button, still viewable as file detail and downloadable on explicit request.
 page.evaluate("""async()=>{const f=new File([new Uint8Array([65,67,49,48,49,53])],'Column_Bracing.dwg',{type:'application/acad'});await importManyFiles([f])}""")
 page.wait_for_timeout(160)
 page.locator('[data-file]').first.click()
 assert page.locator('[data-action=open-file-tab]').count()==0, 'Unsupported CAD should not offer new browser tab that downloads automatically'
 assert page.locator('[data-action=external-file]').count()==1
 assert page.locator('[data-action=download-file]').count()==1
 page.locator('#modal [data-action=close]').first.click()
 print('PASS: CAD view clearly distinguishes supported preview from intentional save/share')

 assert not errors,errors
 mobile=b.new_page(viewport={'width':390,'height':844})
 mobile.set_content(html,wait_until='load');mobile.wait_for_timeout(100)
 mobile.locator('#bottom-nav [data-nav=add]').click();mobile.locator('[data-flow=purchase]').click()
 mobile.screenshot(path=str(p/'assets'/'screenshot-mobile-direct-amount.png'),full_page=True)
 assert not mobile.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.locator('#rail-nav [data-nav=home]').click()
 page.screenshot(path=str(p/'assets'/'screenshot-desktop-v2.png'),full_page=True)
 print('PASS: mobile direct entry has no horizontal overflow; no JS page errors')
 b.close()
