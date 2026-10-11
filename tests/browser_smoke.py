"""Static, sandbox-compatible UI smoke harness. Uses a mocked storage adapter because the restricted test browser cannot navigate to localhost or a file URL. It does NOT test the IndexedDB engine or encrypted backup integration."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text()
html=html.replace('<link rel="stylesheet" href="./styles.css">','<style>'+(root/'styles.css').read_text()+'</style>')
html=html.replace('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' blob: data:; media-src blob:; frame-src blob:; object-src \'none\'; connect-src \'self\'; base-uri \'self\'; form-action \'self\'">','')
finance=(root/'finance.js').read_text().replace('export ','')
hierarchy=(root/'hierarchy.js').read_text().replace("import {add, sum, proportional, lineValue} from './finance.js';",'').replace('export ','')
mockdb='''let fakeData=emptyState();let fakeFiles=new Map();function storageMode(){return 'local'}async function loginRemote(){}function hasPendingWrite(){return false}async function retryPendingWrite(){}async function readState(){return structuredClone(fakeData)}async function openDb(){return true}async function readFile(id){return fakeFiles.get(id)}async function readAllFiles(){return [...fakeFiles.values()]}async function readSnapshot(){return {state:structuredClone(fakeData),files:[...fakeFiles.values()]}}async function modify(fn,options={}){let next=structuredClone(fakeData);let r=fn(next);verifyState(next);fakeData=next;for(let x of (options.newFiles||[]))fakeFiles.set(x.id,x);return r}async function replaceAll(st,files){verifyState(st);fakeData=st;fakeFiles=new Map(files.map(x=>[x.id,x]))}'''
archive=(root/'archive.js').read_text()
app=(root/'app.js').read_text()
for chunk in ['archive','app']:
 s=locals()[chunk]
 s='\n'.join(l for l in s.splitlines() if not l.startswith('import '))
 s=s.replace('export ','')
 locals()[chunk]=s
alljs=finance+'\n'+hierarchy+'\n'+mockdb+'\n'+archive+'\n'+app
html=html.replace('<script type="module" src="./app.js"></script>','<script>'+alljs+'</script>')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1340,'height':920},device_scale_factor=1,accept_downloads=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(html,wait_until='load');page.wait_for_timeout(600)
 print('BOOT',page.locator('main').inner_text()[:260], 'errors',errors)
 assert page.get_by_text('Money paid so far').count()==1
 page.screenshot(path=str(root/'assets'/'screenshot-desktop.png'),full_page=True)
 page.locator('#rail-nav [data-nav=add]').click();assert page.locator('[data-flow]').count()==9
 page.locator('[data-flow=purchase]').click()
 page.locator('input[name=vendor]').fill('Steel Supplier A')
 page.locator('.item-name').fill('12mm Fe500D steel')
 page.locator('.item-mode').select_option('calculated')
 page.locator('.item-qty').fill('10')
 page.locator('.item-rate').fill('62.50')
 page.locator('select[name=payStatus]').select_option('partial')
 page.locator('input[name=paidAmount]').fill('200')
 page.locator('#entry-form button[type=submit]').click()
 assert 'Check before saving' in page.locator('#modal-inner').inner_text()
 page.locator('[data-action=confirm]').click()
 page.wait_for_timeout(500)
 print('POST UI',page.locator('#toast').inner_text(),page.locator('#modal').get_attribute('hidden'),page.locator('#main').inner_text()[:250],errors)
 assert 'Payment' in page.locator('#main').inner_text()
 page.locator('#rail-nav [data-nav=home]').click()
 print('AFTER PURCHASE',page.locator('#main').inner_text()[:360])
 assert '₹625' in page.locator('#main').inner_text()
 page.screenshot(path=str(root/'assets'/'screenshot-desktop-populated.png'),full_page=True)
 page.locator('#rail-nav [data-nav=add]').click();page.locator('[data-flow=plan]').click()
 page.locator('input[name=vendor]').fill('Project engineer')
 page.locator('input[name=title]').fill('Engineer installment 1')
 page.locator('input[name=amount]').fill('31250')
 page.locator('#entry-form button[type=submit]').click();page.locator('[data-action=confirm]').click()
 page.locator('#rail-nav [data-nav=home]').click()
 assert '₹31,250' in page.locator('#main').inner_text()
 page.locator('#rail-nav [data-nav=files]').click()
 assert page.get_by_text('Project Files').count()>0
 page.locator('#rail-nav [data-nav=explore]').click()
 page.locator('[data-view=calendar]').click()
 assert page.get_by_text('Upcoming scheduled payments').count()>0
 assert not errors,errors
 print('UI PASS: Home, Add Entry, posted bill + linked payment, future plan, Files, Calendar, no runtime exceptions')
 mobile=b.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
 merrors=[];mobile.on('pageerror',lambda e:merrors.append(str(e)))
 mobile.set_content(html,wait_until='load');mobile.wait_for_timeout(200)
 mobile.screenshot(path=str(root/'assets'/'screenshot-mobile.png'),full_page=True)
 mobile.locator('#bottom-nav [data-nav=add]').click()
 mobile.screenshot(path=str(root/'assets'/'screenshot-mobile-add.png'),full_page=True)
 assert mobile.locator('[data-flow]').count()==9
 print('Mobile horizontal scroll',mobile.evaluate('document.documentElement.scrollWidth > innerWidth'),'errors',merrors)
 assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth')
 b.close()
