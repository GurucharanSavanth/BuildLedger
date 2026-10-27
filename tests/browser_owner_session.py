import os
from urllib.parse import urlparse

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

base = os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8099')
password = os.environ.get('BUILDLEDGER_TEST_OWNER_PASSWORD', '')
parsed = urlparse(base)
if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1' or parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost'} or len(password) < 12:
    raise SystemExit('Owner session test requires disposable loopback server and test password')

options = webdriver.ChromeOptions()
for arg in ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-pipe', '--window-size=1440,1100']:
    options.add_argument(arg)
if os.environ.get('BUILDLEDGER_TEST_CHROME'):
    options.binary_location = os.environ['BUILDLEDGER_TEST_CHROME']
service = Service(os.environ['BUILDLEDGER_TEST_DRIVER']) if os.environ.get('BUILDLEDGER_TEST_DRIVER') else Service()
driver = webdriver.Chrome(service=service, options=options)
driver.set_script_timeout(60)
wait = WebDriverWait(driver, 20)

try:
    driver.get(base)
    wait.until(lambda d: d.find_elements(By.ID, 'login-form'))
    driver.find_element(By.ID, 'owner-password').send_keys(password)
    driver.find_element(By.CSS_SELECTOR, '#login-form button[type=submit]').click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '.empty-projects'))
    seeded = driver.execute_async_script("""
      const done=arguments[0];(async()=>{
        const db=await import('./db.js');const project=await db.createProject('Private owner fixture');
        await db.modify(s=>s.entries.push({id:crypto.randomUUID(),kind:'note',title:'Private owner evidence',date:'2026-10-25'}),{projectId:project.id});
        return true;
      })().then(done,error=>done({error:error.message}));
    """)
    assert seeded is True, seeded
    driver.refresh()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '.kpis'))
    first = driver.current_window_handle
    driver.switch_to.new_window('tab')
    driver.get(base)
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '.kpis'))
    driver.find_element(By.CSS_SELECTOR, '#rail-nav [data-nav=activity]').click()
    assert 'Private owner evidence' in driver.find_element(By.ID, 'main').text
    second = driver.current_window_handle
    driver.switch_to.window(first)
    driver.find_element(By.CSS_SELECTOR, '[data-action=settings]').click()
    wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-action=sign-out]'))
    driver.find_element(By.CSS_SELECTOR, '[data-action=sign-out]').click()
    wait.until(lambda d: d.find_elements(By.ID, 'login-form'))
    driver.switch_to.window(second)
    wait.until(lambda d: d.find_elements(By.ID, 'login-form'))
    assert 'Private owner evidence' not in driver.find_element(By.ID, 'main').text
    assert not driver.find_elements(By.CSS_SELECTOR, '#rail-nav [data-nav]')
    print('PASS owner sign-out clears both open tabs')
finally:
    driver.quit()
