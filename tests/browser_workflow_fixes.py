"""Workflow regression proof against the disposable SQLite browser server."""
import os
import tempfile
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1':
    raise SystemExit('Use scripts/browser-test-server.mjs with BUILDLEDGER_TEST_DISPOSABLE=1')
base = os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8107')
options = webdriver.ChromeOptions()
for argument in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100', '--disable-gpu', '--remote-debugging-pipe']:
    options.add_argument(argument)
if os.environ.get('BUILDLEDGER_TEST_CHROME'):
    options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
service = Service(os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
driver = webdriver.Chrome(service=service, options=options)
wait = WebDriverWait(driver, 20)
driver.set_script_timeout(60)

def click(selector):
    element = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, selector)))
    driver.execute_script("arguments[0].scrollIntoView({block:'center',behavior:'instant'})", element)
    element.click()

def fill(selector, value):
    element = driver.find_element(By.CSS_SELECTOR, selector)
    element.clear()
    element.send_keys(value)

def choose(selector, value):
    # Hidden advanced controls still dispatch the same change event as user selection.
    driver.execute_script("const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event('change',{bubbles:true}))", selector, value)

def async_js(source):
    result = driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{' + source + '})().then(value=>done({value})).catch(e=>done({error:e.message}));')
    assert 'error' not in result, result
    return result.get('value')

def entry(kind):
    click('#rail-nav [data-nav=add]')
    click('[data-flow="' + kind + '"]')

def review():
    click('#entry-form button[type=submit]')

def dialog_name(expected):
    assert driver.find_element(By.ID, 'modal-inner').get_attribute('aria-labelledby') == 'modal-title'
    assert driver.find_element(By.ID, 'modal-title').text == expected

try:
    with tempfile.TemporaryDirectory(prefix='buildledger-workflow-') as folder:
        proof = Path(folder) / 'draft-proof.txt'
        proof.write_text('draft attachment survives another tab saving', encoding='utf-8')
        driver.get(base)
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.empty-projects')))
        created = driver.execute_async_script("const done=arguments[0];import('./db.js').then(async db=>{await db.openDb();if((await db.listProjects()).length)throw Error('Expected fresh disposable server');await db.createProject('Browser regression fixture');done(true)}).catch(e=>done({error:e.message}))")
        assert created is True, created
        driver.refresh()
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
        async_js("const db=await import('/db.js');await db.modify(s=>s.plans.push({id:'workflow-plan',title:'Engineer instalment',vendor:'Workflow Engineer',amount:100000,due:'2026-11-01',date:'2026-10-12',recordedAt:new Date().toISOString(),cancelled:false}));return true")
        driver.refresh()
        entry('purchase')
        fill('#f-vendor', 'Draft supplier')
        fill('.item-name', 'Draft steel')
        fill('.item-amount', '123')
        click('[data-action=add-line]')
        driver.find_elements(By.CSS_SELECTOR, '.item-name')[1].send_keys('Draft cement')
        driver.find_elements(By.CSS_SELECTOR, '.item-amount')[1].send_keys('45')
        driver.find_element(By.CSS_SELECTOR, 'input[name=proof]').send_keys(str(proof))
        original = driver.current_window_handle
        driver.switch_to.new_window('tab')
        driver.get(base)
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, '.kpis')))
        entry('note')
        fill('#f-title', 'Another tab saved')
        review()
        click('[data-action=confirm]')
        wait.until(EC.presence_of_element_located((By.ID, 'activity-search')))
        driver.close()
        driver.switch_to.window(original)
        wait.until(EC.presence_of_element_located((By.ID, 'sync-notice')))
        assert driver.find_element(By.ID, 'f-vendor').get_attribute('value') == 'Draft supplier'
        assert [e.get_attribute('value') for e in driver.find_elements(By.CSS_SELECTOR, '.item-name')] == ['Draft steel', 'Draft cement']
        assert driver.execute_script("return document.querySelector('input[name=proof]').files[0].name") == proof.name
        click('[data-action=reload-project]')
        wait.until(EC.alert_is_present()).dismiss()
        assert driver.find_element(By.ID, 'f-vendor').get_attribute('value') == 'Draft supplier'
        click('[data-action=reload-project]')
        wait.until(EC.alert_is_present()).accept()
        wait.until(EC.invisibility_of_element_located((By.ID, 'sync-notice')))

        entry('labour')
        for wage, advanced, amount_visible in [('calculated', 'amount', False), ('calculated', 'calculated', False), ('calculated', 'amount', False), ('amount', 'amount', True)]:
            choose('#f-wageMode', wage)
            choose('#f-calculate', advanced)
            amount = driver.find_element(By.ID, 'f-amount')
            assert amount.is_displayed() == amount_visible
            assert bool(amount.get_attribute('required')) == amount_visible
            assert bool(driver.find_element(By.ID, 'f-qty').get_attribute('required')) == (wage == 'calculated' and advanced == 'amount')
        fill('#f-amount', '500')
        fill('#f-title', 'Labour direct again')
        fill('#f-vendor', 'Workflow labour')
        review()
        dialog_name('Check before saving')
        click('[data-action=close]')

        entry('payment')
        choose('#f-planId', 'workflow-plan')
        assert driver.find_element(By.ID, 'f-vendor').get_attribute('value') == 'Workflow Engineer'
        assert float(driver.find_element(By.ID, 'f-amount').get_attribute('value')) == 1000
        fill('#f-amount', '1001')
        review()
        wait.until(lambda d: 'exceeds scheduled balance' in d.find_element(By.ID, 'toast').text)
        assert driver.find_element(By.ID, 'modal').get_attribute('hidden')
        fill('#f-amount', '250')
        fill('#f-vendor', 'Wrong recipient')
        review()
        wait.until(lambda d: 'recipient does not match' in d.find_element(By.ID, 'toast').text)
        assert driver.find_element(By.ID, 'modal').get_attribute('hidden')
        fill('#f-vendor', 'Workflow Engineer')
        review()
        click('[data-action=confirm]')
        wait.until(EC.presence_of_element_located((By.ID, 'activity-search')))
        entry('payment')
        choose('#f-planId', 'workflow-plan')
        assert float(driver.find_element(By.ID, 'f-amount').get_attribute('value')) == 750

        entry('note')
        fill('#f-title', 'Timer freezes for review')
        driver.execute_script('window.originalNow=Date.now;window.clockAdvance=0;Date.now=()=>window.originalNow()+window.clockAdvance')
        click('[data-action=start-timer]')
        driver.execute_script('window.clockAdvance=65000')
        review()
        frozen = int(driver.find_element(By.ID, 'f-seconds').get_attribute('value'))
        assert frozen >= 65
        driver.execute_script('window.clockAdvance=125000')
        click('[data-action=close]')
        assert int(driver.find_element(By.ID, 'f-seconds').get_attribute('value')) == frozen
        review()
        click('[data-action=confirm]')
        wait.until(EC.presence_of_element_located((By.ID, 'activity-search')))
        driver.execute_script('Date.now=window.originalNow')
        entry('note')
        assert driver.find_element(By.ID, 'f-seconds').get_attribute('value') == '0'
        assert driver.find_element(By.ID, 'clock-face').text == '00:00:00'

        click('#rail-nav [data-nav=explore]')
        click('[data-action=manage-categories]')
        dialog_name('Manage cost categories')
        row = driver.find_element(By.CSS_SELECTOR, '[data-form=cost-category-edit]')
        row_id = row.get_attribute('data-id')
        label = row.find_element(By.CSS_SELECTOR, '[name=label]')
        label.clear()
        label.send_keys('Pending renamed category')
        order = row.find_element(By.CSS_SELECTOR, '[name=order]')
        order.clear()
        order.send_keys('42')
        row.find_element(By.CSS_SELECTOR, '[name=active]').click()
        fill('#cost-category-search', 'no-category-match')
        assert not row.is_displayed()
        fill('#cost-category-search', 'Pending renamed')
        assert row.is_displayed()
        assert row.get_attribute('data-id') == row_id
        assert label.get_attribute('value') == 'Pending renamed category'
        assert order.get_attribute('value') == '42'
        assert not row.find_element(By.CSS_SELECTOR, '[name=active]').is_selected()
        click('[data-action=close]')

        click('[data-action=backup]')
        dialog_name('Backup & Restore')
        assert 'persistent server project, for every connected browser' in driver.find_element(By.ID, 'modal-inner').text
        driver.execute_script("const input=document.querySelector('input[name=backup]'),dt=new DataTransfer();dt.items.add(new File(['not-a-zip'],'test.zip',{type:'application/zip'}));input.files=dt.files")
        fill('[data-form=restore] input[name=password]', 'workflow-password')
        click('[data-form=restore] button[type=submit]')
        alert = wait.until(EC.alert_is_present())
        assert 'persistent server project for every connected browser' in alert.text
        alert.dismiss()
        click('[data-action=close]')

        entry('payment')
        fill('#f-vendor', 'File limit supplier')
        fill('#f-amount', '1')
        driver.execute_script("const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(25*1024*1024+1)],'too-large.bin'));document.querySelector('input[name=proof]').files=dt.files;window.largeFileRead=false;const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){if(this.name==='too-large.bin')window.largeFileRead=true;return original.call(this)}")
        review()
        click('[data-action=confirm]')
        wait.until(lambda d: '25 MB browser import limit' in d.find_element(By.ID, 'toast').text)
        assert not driver.execute_script('return window.largeFileRead'), 'Oversized file was read before size validation'
        assert len(async_js("return await (await fetch('/api/v1/state')).json()")['payments']) == 1
        print('PASS browser workflows: cross-tab draft/files, labour validation, partial plan payment, invalid review, timer, category drafts, modal names, restore scope, attachment limit')
finally:
    driver.quit()
