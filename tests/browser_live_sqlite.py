"""Runs against actual HTTP+SQLite server started separately. TEST ON DISPOSABLE DATABASE ONLY."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1':
    raise SystemExit('Refusing to create/delete financial test records. Run only with BUILDLEDGER_TEST_DISPOSABLE=1 against a disposable DB.')
URL=os.environ.get('BUILDLEDGER_TEST_BASE_URL','http://127.0.0.1:8080')
ENV=Path(__file__).parents[1]/'.env'
pw=os.environ.get('BUILDLEDGER_TEST_OWNER_PASSWORD') or next(x.partition('=')[2] for x in ENV.read_text().splitlines() if x.startswith('ADMIN_PASSWORD='))
from PIL import Image
img=Path(__file__).parent/'site_photo.png'
Image.new('RGB',(100,65),(175,212,229)).save(img)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1380,'height':920},accept_downloads=True)
    page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);page.get_by_label('Owner password').fill(pw);page.get_by_role('button',name='Sign in').click()
    page.wait_for_selector('.kpis')
    page.locator('[data-nav="add"]').first.click();page.locator('[data-flow="purchase"]').click()
    assert page.locator('.item-mode').input_value()=='amount'
    assert page.locator('.item-qty').is_hidden()
    assert page.locator('#f-extras').input_value()=='0'
    page.locator('#f-vendor').fill('Site Materials Vendor')
    page.locator('.item-name').fill('12mm TMT steel')
    page.locator('.item-amount').fill('2150.75')
    page.locator('[data-form="entry"] button[type=submit]').click()
    assert '₹2,150.75' in page.locator('#modal-inner').inner_text()
    page.locator('[data-action=confirm]').click()
    page.wait_for_selector('#activity-search')
    page.locator('[data-nav="home"]').first.click()
    page.wait_for_timeout(120)
    assert '₹2,150.75' in page.locator('.info-note').first.inner_text(),page.locator('.info-note').first.inner_text()
    page.locator('[data-nav="files"]').first.click()
    with page.expect_file_chooser() as fc:
        page.locator('[data-action=import-files]').click()
    fc.value.set_files(str(img))
    page.wait_for_timeout(1300)
    assert 'site_photo.png' in page.locator('main').inner_text(),page.locator('main').inner_text()[-300:]
    page.get_by_text('site_photo.png').first.click()
    page.locator('[data-action=view-file]').click()
    page.wait_for_selector('.preview img')
    assert page.locator('.preview img').count()==1
    page.screenshot(path=str(Path(__file__).parents[1]/'assets'/'screenshot-live-document-view.png'),full_page=True)
    page.on('dialog',lambda d:d.accept())
    page.locator('[data-action=delete-file]').click()
    page.wait_for_timeout(650)
    assert 'site_photo.png' not in page.locator('main').inner_text(),page.locator('main').inner_text()
    # Ensure backend didn't silently lose the financial entry.
    page.locator('[data-nav="home"]').first.click()
    assert '₹2,150.75' in page.locator('.info-note').first.inner_text()
    page.screenshot(path=str(Path(__file__).parents[1]/'assets'/'screenshot-live-home.png'),full_page=True)
    mobile=browser.new_context(viewport={'width':390,'height':844},accept_downloads=True)
    m=mobile.new_page();m.goto(URL);m.get_by_label('Owner password').fill(pw);m.get_by_role('button',name='Sign in').click();m.wait_for_selector('.kpis')
    m.locator('#bottom-nav [data-nav=add]').click();m.locator('[data-flow=purchase]').click()
    m.screenshot(path=str(Path(__file__).parents[1]/'assets'/'screenshot-live-mobile-direct-amount.png'),full_page=True)
    assert m.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    assert not errors,errors
    print('PASS live SQLite+REST+browser: login, optional qty/rate, direct cost, persisted dashboard, file upload, in-app image view, permanent deletion, mobile layout, JS console clean')
    browser.close()
