"""Actual HTTP/SQLite document and mobile flow on a fresh disposable loopback server."""
import os
from pathlib import Path
import tempfile
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('BUILDLEDGER_TEST_BASE_URL', 'http://127.0.0.1:8117')
if os.environ.get('BUILDLEDGER_TEST_DISPOSABLE') != '1' or urlparse(base).hostname not in {'localhost', '127.0.0.1'}:
    raise SystemExit('Requires a fresh disposable loopback server and BUILDLEDGER_TEST_DISPOSABLE=1')
artifacts = Path(os.environ.get('BUILDLEDGER_TEST_ARTIFACT_DIR', '.tools/browser-live-sqlite'))
artifacts.mkdir(parents=True, exist_ok=True)
# A valid one-pixel GIF keeps the file fixture dependency-free and outside source/assets.
image_bytes = bytes.fromhex('47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020144003b')
rupee = '\u20b9'

with tempfile.TemporaryDirectory(prefix='buildledger-live-fixture-') as folder, sync_playwright() as playwright:
    image = Path(folder) / 'site_photo.gif'
    image.write_bytes(image_bytes)
    launch = {'headless': True, 'args': ['--no-sandbox']}
    if os.environ.get('BUILDLEDGER_TEST_CHROME'):
        launch['executable_path'] = os.environ['BUILDLEDGER_TEST_CHROME']
    browser = playwright.chromium.launch(**launch)
    try:
        context = browser.new_context(viewport={'width': 1380, 'height': 920}, accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base)
        health = page.request.get(base + '/api/v1/health').json()
        if health['auth'] == 'required':
            password = os.environ.get('BUILDLEDGER_TEST_OWNER_PASSWORD')
            assert password, 'Provide an explicit disposable owner password; never read private .env'
            page.get_by_label('Owner password').fill(password)
            page.get_by_role('button', name='Sign in').click()
        page.wait_for_selector('.empty-projects')
        page.evaluate("""async()=>{const db=await import('./db.js');await db.openDb();
          if((await db.listProjects()).length)throw Error('Expected a fresh disposable server');
          await db.createProject('Live SQLite fixture')}""")
        page.reload()
        page.wait_for_selector('.kpis')
        page.locator('#rail-nav [data-nav=add]').click()
        page.locator('[data-flow=purchase]').click()
        assert page.locator('.item-mode').input_value() == 'amount'
        assert page.locator('.item-qty').is_hidden()
        assert page.locator('#f-extras').input_value() == '0'
        page.locator('#f-vendor').fill('Site Materials Vendor')
        page.locator('.item-name').fill('12mm TMT steel')
        page.locator('.item-amount').fill('2150.75')
        page.locator('[data-form=entry] button[type=submit]').click()
        assert rupee + '2,150.75' in page.locator('#modal-inner').inner_text()
        page.locator('[data-action=confirm]').click()
        page.wait_for_selector('#activity-search')
        page.locator('#rail-nav [data-nav=home]').click()
        assert rupee + '2,150.75' in page.locator('.info-note').first.inner_text()
        assert page.request.get(base + '/api/v1/state').json()['bills'][0]['total'] == 215075
        page.locator('#rail-nav [data-nav=files]').click()
        with page.expect_file_chooser() as chooser:
            page.locator('[data-action=import-files]').click()
        chooser.value.set_files(str(image))
        page.get_by_text('site_photo.gif', exact=True).first.wait_for()
        page.get_by_text('site_photo.gif', exact=True).first.click()
        page.locator('[data-action=view-file]').click()
        expect(page.locator('.preview img')).to_have_js_property('naturalWidth', 1)
        original = page.evaluate("""async()=>{const db=await import('./db.js'),s=await db.readState(),f=s.files.find(x=>x.name==='site_photo.gif');
          return [...new Uint8Array(await (await db.readFile(f.id)).blob.arrayBuffer())]}""")
        assert original == list(image_bytes)
        page.screenshot(path=str(artifacts / 'document-view.png'), full_page=True)
        page.on('dialog', lambda dialog: dialog.accept())
        page.locator('[data-action=delete-file]').click()
        page.wait_for_selector('#modal', state='hidden')
        assert 'site_photo.gif' not in page.locator('main').inner_text()
        assert page.request.get(base + '/api/v1/state').json()['files'] == []
        page.locator('#rail-nav [data-nav=home]').click()
        assert rupee + '2,150.75' in page.locator('.info-note').first.inner_text()
        page.screenshot(path=str(artifacts / 'home.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('#bottom-nav [data-nav=add]').click()
        page.locator('[data-flow=purchase]').click()
        page.screenshot(path=str(artifacts / 'mobile-direct-amount.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
        assert not errors, errors
        print('PASS live SQLite/REST/browser: exact 215075 paise, original GIF bytes, in-app image, deletion, mobile layout, clean JS console')
    finally:
        browser.close()
