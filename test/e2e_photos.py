import os, subprocess, json, urllib.request
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ.get('OT_SHOTS', '/tmp/omnitill-shots'); os.makedirs(S + '/shots', exist_ok=True)
ANON = subprocess.run(['node', HERE + '/anon.js'], capture_output=True, text=True).stdout.strip(); URL = 'http://127.0.0.1:54330'
results = []; errs = []
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '54329', '-U', 'postgres', '-d', 'ot', '-t', '-A', '-c', q], capture_output=True, text=True).stdout.strip()
def shot(pg, n): pg.screenshot(path=f'{S}/shots/{n}.png')
def step(name, pg, fn):
    try: fn(); results.append(('PASS', name)); print('PASS', name, flush=True)
    except Exception as e:
        results.append(('FAIL', name)); print('FAIL', name, '::', str(e).split('\n')[0][:300], flush=True)
        try: shot(pg, 'FAIL-photo-' + name.replace(' ', '_')[:30])
        except Exception: pass

# test photos: a big landscape JPG (with EXIF-ish size) and a portrait PNG
def make(path, size, color):
    im = Image.new('RGB', size, color); d = ImageDraw.Draw(im)
    for i in range(0, size[0], 80): d.rectangle([i, 0, i + 40, size[1]], fill=(255, 255, 255))
    im.save(path, quality=92)
os.makedirs('/tmp/ot-img', exist_ok=True)
make('/tmp/ot-img/coffee.jpg', (3000, 2000), (120, 70, 30)); make('/tmp/ot-img/room.png', (1200, 1600), (30, 60, 120)); make('/tmp/ot-img/room2.jpg', (1600, 1200), (20, 120, 60))
open('/tmp/ot-img/not-image.txt', 'w').write('hello')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
    pg = ctx.new_page(); pg.set_default_timeout(8000)
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' and 'WebSocket' not in m.text and 'frame-ancestors' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('pageerror ' + str(e)[:200]))
    pg.goto(URL); pg.wait_for_selector('text=Connect to your database')
    pg.fill('input[type=url]', URL); pg.fill('input[placeholder="anon / publishable key"]', ANON); pg.click('button:has-text("Connect")')
    pg.wait_for_selector('text=Sign in to continue')
    pg.click('button:has-text("Create account")'); pg.fill('input[autocomplete=name]', 'Owner'); pg.fill('input[type=email]', 'owner@t.io'); pg.fill('input[type=password]', 'password123')
    pg.click('button:has-text("Create account")'); pg.wait_for_selector('text=Protect this device'); pg.click('text=Not now'); pg.wait_for_selector('.products .product')

    def goto(label):
        if pg.is_visible(f'nav a:has-text("{label}")'): pg.click(f'nav a:has-text("{label}")')
        else: pg.click('nav a:has-text("More")'); pg.click(f'a:has-text("{label}") >> visible=true')

    def product_photo():
        goto('Menu'); pg.wait_for_selector('h1:has-text("Menu")')
        pg.click('tr:has-text("Americano") button:has-text("Edit")'); pg.wait_for_selector('.img-field')
        with pg.expect_file_chooser() as fc: pg.click('.img-field button:has-text("Add photo")')
        fc.value.set_files('/tmp/ot-img/coffee.jpg')
        pg.wait_for_selector('.img-field img.prev'); shot(pg, '40-photo-preview')
        pg.click('.modal button.primary:has-text("Save")'); pg.wait_for_selector('.img-field', state='detached')
        u = sql("select image_url from products where name='Americano'")
        assert '/storage/v1/object/public/images/products/' in u and u.endswith('.webp'), u
        info = pg.evaluate("""async (u) => { const r = await fetch(u); const b = await r.blob(); const bm = await createImageBitmap(b); return { type: b.type, size: b.size, w: bm.width, h: bm.height }; }""", u)
        assert info['type'] == 'image/webp' and info['w'] == 640 and info['h'] == 427 and info['size'] < 150000, info
        pg.wait_for_selector('tr:has-text("Americano") img.mini')
    step('menu item photo: pick, shrink to 640px WebP, upload, save', pg, product_photo)

    def sell_shows():
        goto('Sell'); pg.wait_for_selector('.product.has-img img.ph')
        ok = pg.evaluate("[...document.querySelectorAll('.product.has-img img.ph')].every(i => i.complete && i.naturalWidth > 0)")
        assert ok, 'image not loaded'; shot(pg, '41-sell-with-photo')
        assert pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), 'page wider than screen'
    step('sell grid shows the photo', pg, sell_shows)

    def bad_file():
        goto('Menu'); pg.click('tr:has-text("Espresso") button:has-text("Edit")'); pg.wait_for_selector('.img-field')
        with pg.expect_file_chooser() as fc: pg.click('.img-field button:has-text("Add photo")')
        fc.value.set_files('/tmp/ot-img/not-image.txt')
        pg.wait_for_selector('.img-field .form-err:has-text("Choose a photo")')
        pg.click('.modal button:has-text("Cancel")')
        assert sql("select image_url from products where name='Espresso'") == ''
    step('a non-image file is refused with a clear message', pg, bad_file)

    def room_photo():
        goto('Hotel'); pg.wait_for_selector('h1:has-text("Hotel")'); pg.click('button:has-text("Rooms")')
        with pg.expect_file_chooser() as fc: pg.click('.list-item:has-text("101") button:has-text("Add photo")')
        fc.value.set_files('/tmp/ot-img/room.png')
        pg.wait_for_selector('.list-item:has-text("101") img.mini'); shot(pg, '42-rooms-manage')
        u = sql("select image_url from rooms where number='101'"); assert '/images/rooms/' in u, u
        info = pg.evaluate("""async (u) => { const b = await (await fetch(u)).blob(); const bm = await createImageBitmap(b); return [bm.width, bm.height]; }""", u)
        assert info == [480, 640], info
        pg.click('.modal [aria-label="Close"]') if pg.is_visible('.modal [aria-label="Close"]') else pg.keyboard.press('Escape')
        pg.wait_for_selector('.room.has-img img.ph'); shot(pg, '43-rooms-grid')
        pg.click('.room:has-text("101")'); pg.wait_for_selector('img.room-photo'); shot(pg, '44-room-dialog'); pg.keyboard.press('Escape')
    step('room photo: add from Rooms, shows on card and in room dialog', pg, room_photo)

    def replace_room():
        old = sql("select image_url from rooms where number='101'")
        pg.wait_for_selector('.modal', state='detached', timeout=3000) if pg.is_visible('.modal') else None
        pg.click('button:has-text("Rooms")')
        with pg.expect_file_chooser() as fc: pg.click('.list-item:has-text("101") button:has-text("Change photo")')
        fc.value.set_files('/tmp/ot-img/room2.jpg')
        for _ in range(30):
            if sql("select image_url from rooms where number='101'") != old: break
            pg.wait_for_timeout(200)
        new = sql("select image_url from rooms where number='101'"); assert new != old and new, (old, new)
        pg.wait_for_timeout(500)
        deleted = json.loads(urllib.request.urlopen(URL + '/__test/deleted').read())
        assert old.split('/images/')[1] in deleted, ('old file not deleted', deleted)
        pg.click('.list-item:has-text("101") button:has-text("Remove photo")')
        for _ in range(30):
            if sql("select image_url from rooms where number='101'") == '': break
            pg.wait_for_timeout(200)
        assert sql("select image_url from rooms where number='101'") == ''
        pg.keyboard.press('Escape')
    step('room photo: replace deletes old file, remove clears it', pg, replace_room)

    def remove_product():
        goto('Menu'); pg.click('tr:has-text("Americano") button:has-text("Edit")'); pg.wait_for_selector('.img-field img.prev')
        pg.click('.img-field button:has-text("Remove")'); pg.wait_for_selector('.img-field .prev.none')
        pg.click('.modal button.primary:has-text("Save")'); pg.wait_for_selector('.img-field', state='detached')
        assert sql("select image_url from products where name='Americano'") == ''
    step('menu item photo: remove', pg, remove_product)

    def desktop():
        pg.set_viewport_size({'width': 1280, 'height': 800})
        goto('Menu'); pg.click('tr:has-text("Latte") button:has-text("Edit")'); pg.wait_for_selector('.img-field')
        with pg.expect_file_chooser() as fc: pg.click('.img-field button:has-text("Add photo")')
        fc.value.set_files('/tmp/ot-img/coffee.jpg'); pg.wait_for_selector('.img-field img.prev')
        pg.click('.modal button.primary:has-text("Save")'); pg.wait_for_selector('.img-field', state='detached')
        goto('Sell'); pg.wait_for_selector('.product.has-img'); shot(pg, '45-desktop-sell')
    step('desktop layout with photos', pg, desktop)

    step('no console errors (CSP allows photos)', pg, lambda: (_ for _ in ()).throw(Exception(str(errs[:5]))) if errs else None)
    b.close()

print('\n%d/%d passed' % (sum(1 for r in results if r[0] == 'PASS'), len(results)))
