"""Real browser + db.js + disposable SQLite, including ambiguous saves and restore."""
import os
import json
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1':
    raise SystemExit('Set BUILDLEDGER_TEST_DISPOSABLE=1 and use scripts/browser-test-server.mjs')
base = os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8099')
options = webdriver.ChromeOptions()
options.add_argument('--headless=new')
options.add_argument('--no-sandbox')
options.add_argument('--disable-dev-shm-usage')
options.add_argument('--window-size=1440,1100')
options.add_argument('--disable-gpu')
options.add_argument('--remote-debugging-pipe')
options.add_argument('--disable-crash-reporter')
if os.environ.get('BUILDLEDGER_TEST_CHROME'):
    options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
service = Service(executable_path=os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
driver = webdriver.Chrome(service=service, options=options)
driver.set_script_timeout(60)
wait = WebDriverWait(driver, 20)

def click(selector):
    element = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
    driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'})", element)
    element.click()

def fill(selector, text):
    element = driver.find_element(By.CSS_SELECTOR, selector)
    element.clear()
    element.send_keys(text)

def js_async(source):
    result = driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{' + source + '})().then(x=>done({value:x})).catch(e=>done({error:e.message}));')
    assert 'error' not in result, result
    return result.get('value')

def state():
    return js_async("return await (await fetch('/api/v1/state')).json()")

try:
    driver.get(base)
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
    created = driver.execute_async_script("const done=arguments[0];import('./db.js').then(async db=>{await db.openDb();if((await db.listProjects()).length)throw Error('Expected fresh disposable server');await db.createProject('Browser regression fixture');done(true)}).catch(e=>done({error:e.message}))")
    assert created is True, created
    driver.refresh()
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
    driver.execute_script("window.__originalFetch=window.fetch;window.__lost=0;window.fetch=async(...args)=>{const r=await window.__originalFetch(...args);if(String(args[0]).endsWith('/commit')&&window.__lost++===0)throw Error('Lost success response');return r};")
    click('#rail-nav [data-nav=add]')
    click('[data-flow=purchase]')
    fill('#f-vendor', 'Regression Supplier')
    fill('.item-name', 'Foundation steel')
    fill('.item-amount', '1000')
    click('[data-form=entry] button[type=submit]')
    click('[data-action=confirm]')
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '#activity-search')))
    assert len(state()['bills']) == 1, 'Lost response duplicated invoice'
    driver.execute_script('window.fetch=window.__originalFetch')

    click('[data-detail^="bill:"]')
    click('[data-action=edit-entry]')
    fill('[name=line-amount]', '1200')
    click('[data-form=edit-entry] button[type=submit]')
    wait.until(EC.invisibility_of_element_located((By.ID, 'modal')))
    assert state()['bills'][0]['total'] == 120000
    assert any(x['type'] == 'entry_edit' for x in state()['audit'])

    # A committed payment with a failed refresh must leave no retryable confirmation.
    driver.execute_script("window.__failRefresh=false;window.fetch=async(...args)=>{if(window.__failRefresh&&String(args[0]).endsWith('/state')){window.__failRefresh=false;throw Error('Refresh interrupted')}const r=await window.__originalFetch(...args);if(String(args[0]).endsWith('/commit'))window.__failRefresh=true;return r};")
    click('#rail-nav [data-nav=add]')
    click('[data-flow=payment]')
    fill('#f-vendor', 'Regression Supplier')
    fill('#f-amount', '400')
    click('[data-form=entry] button[type=submit]')
    click('[data-action=confirm]')
    wait.until(EC.invisibility_of_element_located((By.ID, 'modal')))
    driver.execute_script('window.fetch=window.__originalFetch')
    assert len(state()['payments']) == 1
    assert not driver.find_elements(By.CSS_SELECTOR, '[data-action=confirm]')

    # Keep an uncertain request across page reload, then replay the original payload.
    driver.execute_script("window.fetch=async(...args)=>{const r=await window.__originalFetch(...args);if(String(args[0]).endsWith('/commit'))throw Error('All responses lost');return r};")
    click('#rail-nav [data-nav=add]')
    click('[data-flow=note]')
    fill('#f-title', 'Retained uncertain save')
    click('[data-form=entry] button[type=submit]')
    click('[data-action=confirm]')
    wait.until(EC.presence_of_element_located((By.ID, 'pending-save')))
    driver.refresh()
    click('[data-action=retry-save]')
    wait.until(EC.invisibility_of_element_located((By.ID, 'pending-save')))
    assert len(state()['entries']) == 1

    # No mocked adapter: use the real browser backup and server replacement flow.
    result = js_async("""
      const db=await import('/db.js'),archive=await import('/archive.js');
      const blob=new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'],{type:'image/svg+xml'});
      const bytes=await blob.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      const id=crypto.randomUUID();
      await db.modify(s=>s.files.push({id,name:'regression.svg',size:blob.size,type:blob.type,sha256:hash}),{newFiles:[{id,blob}]});
      const zip=await archive.createBackup('browser-regression-password');
      await archive.restoreBackup(zip,'browser-regression-password');
      const s=await db.readState(),original=await db.readFile(id);
      return {type:s.files[0].type,bytes:await original.blob.text(),files:s.files.length};
    """)
    assert result['type'] == 'image/svg+xml' and result['files'] == 1
    assert result['bytes'].startswith('<svg')

    driver.refresh()
    click('#rail-nav [data-nav=activity]')
    click('[data-detail^="bill:"]')
    click('[data-action=delete-entry]')
    wait.until(EC.alert_is_present()).accept()
    wait.until(EC.invisibility_of_element_located((By.ID, 'modal')))
    assert len(state()['bills']) == 0 and len(state()['payments']) == 1
    assert any(x['type'] == 'entry_delete' for x in state()['audit'])
    assert 'Deleted bill' in driver.find_element(By.ID, 'main').text
    click('[data-detail^="audit:"]')
    assert 'Change log' in driver.find_element(By.ID, 'modal-inner').text
    click('#modal-inner [data-action=close]')

    # Populate a disposable project to verify the charts and capture both layouts.
    js_async("""
      const db=await import('/db.js');await db.modify(s=>{
        s.project.budget=10000000;
        for(const [i,name] of ['Foundation','Masonry','Electrical','Plumbing','Finishing','Design'].entries()){
          s.bills.push({id:crypto.randomUUID(),title:name+' work',vendor:'Supplier '+i,work:name,total:500000+i*125000,date:'2026-10-11',recordedAt:new Date().toISOString()});
          s.payments.push({id:crypto.randomUUID(),vendor:'Supplier '+i,amount:200000+i*40000,date:'2026-'+String(i+4).padStart(2,'0')+'-15',recordedAt:new Date().toISOString()});
        }
      });return true;
    """)
    driver.refresh()
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.cash-chart')))
    out = Path(__file__).resolve().parents[1] / '.tools'
    out.mkdir(exist_ok=True)
    driver.save_screenshot(str(out / 'dashboard-desktop.png'))
    click('#rail-nav [data-nav=explore]')
    click('[data-view=work]')
    driver.save_screenshot(str(out / 'infographics-desktop.png'))
    driver.set_window_size(390, 1000)
    click('#bottom-nav [data-nav=home]')
    assert driver.execute_script('return document.documentElement.scrollWidth<=window.innerWidth'), 'Mobile layout overflows'
    driver.save_screenshot(str(out / 'dashboard-mobile.png'))
    severe = [x for x in driver.get_log('browser') if x['level']=='SEVERE' and 'favicon' not in x['message']]
    assert not severe, severe
    print('PASS real browser: stable save replay, failed refresh, reload recovery, SVG restore, audited edit/delete, desktop/mobile charts')
finally:
    driver.quit()
