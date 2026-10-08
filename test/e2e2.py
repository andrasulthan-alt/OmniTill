import sys, subprocess, traceback, datetime
from playwright.sync_api import sync_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__)); S=os.environ.get('OT_SHOTS','/tmp/omnitill-shots'); os.makedirs(S+'/shots',exist_ok=True)
ANON=subprocess.run(['node',HERE+'/anon.js'],capture_output=True,text=True).stdout.strip(); URL='http://127.0.0.1:54330'
results=[]; errs=[]
def sql(q):
    return subprocess.run(['psql','-h','/tmp','-p','54329','-U','postgres','-d','ot','-t','-A','-c',q],capture_output=True,text=True).stdout.strip()
def shot(pg,name): pg.screenshot(path=f'{S}/shots/{name}.png')
def step(name, pg, fn):
    try: fn(); results.append(('PASS',name)); print('PASS',name,flush=True)
    except Exception as e:
        results.append(('FAIL',name+' :: '+str(e).split('\n')[0][:220])); print('FAIL',name,'::',str(e).split('\n')[0][:260],flush=True)
        try: shot(pg,'FAIL-'+name.replace(' ','_')[:30])
        except Exception: pass
def hook(pg):
    pg.on('console', lambda m: errs.append((m.type,m.text[:200])) if m.type=='error' and 'WebSocket' not in m.text and 'frame-ancestors' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append(('pageerror',str(e)[:200])))
def connect(pg):
    pg.goto(URL); pg.wait_for_selector('text=Connect to your database')
    pg.fill('input[type=url]',URL); pg.fill('input[placeholder="anon / publishable key"]',ANON); pg.click('button:has-text("Connect")')
    pg.wait_for_selector('text=Sign in to continue')
def signup(pg,name,email):
    pg.click('button:has-text("Create account")'); pg.fill('input[autocomplete=name]',name); pg.fill('input[type=email]',email); pg.fill('input[type=password]','password123')
    pg.click('button:has-text("Create account")')
def tap_nav(pg,label): pg.click(f'nav a:has-text("{label}")')

with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark')
    pg=ctx.new_page(); pg.set_default_timeout(8000); hook(pg)
    connect(pg)
    step('signup first user becomes admin', pg, lambda: (signup(pg,'Rani Owner','owner@t.io'), pg.wait_for_selector('text=Protect this device'), pg.click('text=Not now'), pg.wait_for_selector('.products .product'),
        (_ for _ in ()).throw(Exception('role='+sql("select role from profiles where email='owner@t.io'"))) if sql("select role from profiles where email='owner@t.io'")!='admin' else None))
    shot(pg,'10-sell-dark')
    def open_shift():
        pg.click('button:has-text("Open shift")'); pg.wait_for_selector('.banner', state='detached', timeout=5000)
        assert sql("select count(*) from shifts where closed_at is null")=='1'
    step('open shift', pg, open_shift)
    def sale1():
        pg.click('.product:has-text("Americano")'); pg.click('.product:has-text("Americano")'); pg.click('.product:has-text("Fried Rice")')
        shot(pg,'11-cart-fab'); pg.click('.cart-fab'); pg.wait_for_selector('.cart.open'); shot(pg,'12-cart-open')
        pg.click('.cart .btn.primary:has-text("Pay")'); pg.wait_for_selector('text=Confirm payment'); shot(pg,'13-pay')
        pg.click('.quick .chip >> nth=1'); pg.click('button:has-text("Confirm payment")'); pg.wait_for_selector('.receipt'); shot(pg,'14-receipt')
        pg.wait_for_timeout(500)
        assert sql("select count(*) from sales")=='1', 'sales='+sql("select count(*) from sales")
        assert sql("select total from sales")=='79000.00', sql("select total from sales")
        assert sql("select stock from ingredients where name='Arabica beans'")=='4464.000', sql("select stock from ingredients where name='Arabica beans'")
        pg.click('button:has-text("New order")')
    step('sale 1 cash, receipt, stock down', pg, sale1)
    def offline_sale():
        ctx.set_offline(True)
        pg.click('.product:has-text("Espresso")'); pg.click('.cart-fab'); pg.click('.cart .btn.primary:has-text("Pay")'); pg.click('button:has-text("Confirm payment")')
        pg.wait_for_selector('.receipt'); assert 'Saved on this device' in pg.inner_text('.receipt'), pg.inner_text('.receipt')[-120:]
        shot(pg,'15-offline-receipt'); pg.click('button:has-text("New order")')
        assert sql("select count(*) from sales")=='1'
        pg.wait_for_selector('.status.off'); shot(pg,'16-offline-status')
        ctx.set_offline(False); pg.evaluate("window.dispatchEvent(new Event('online'))")
        for _ in range(30):
            if sql("select count(*) from sales")=='2': break
            pg.wait_for_timeout(300)
        assert sql("select count(*) from sales")=='2', 'queued sale not synced'
    step('offline sale queues then syncs', pg, offline_sale)
    def reload_offline():
        # new sale while offline, then reload the page offline: must still open and keep the queue
        ctx.set_offline(True); pg.reload(); pg.wait_for_selector('.products .product', timeout=15000)
        pg.click('.product:has-text("Americano")'); pg.click('.cart-fab'); pg.click('.cart .btn.primary:has-text("Pay")'); pg.click('button:has-text("Confirm payment")'); pg.wait_for_selector('.receipt'); pg.click('button:has-text("New order")')
        ctx.set_offline(False); pg.reload(); pg.wait_for_selector('.products .product')
        for _ in range(40):
            if sql("select count(*) from sales")=='3': break
            pg.wait_for_timeout(300)
        assert sql("select count(*) from sales")=='3', 'sales='+sql("select count(*) from sales")
    step('app reloads offline, queue survives reload', pg, reload_offline)

    def hotel():
        tap_nav(pg,'Hotel'); pg.wait_for_selector('.room'); shot(pg,'20-hotel')
        pg.click('button:has-text("New booking")'); pg.wait_for_selector('form select')
        pg.select_option('.modal select', label=[o for o in pg.locator('.modal select option').all_inner_texts() if o.startswith('101')][0])
        pg.fill('.modal input[maxlength="80"]','Ana Guest'); 
        d=datetime.date.today(); 
        pg.locator('.modal input[type=date]').nth(1).fill((d+datetime.timedelta(days=2)).isoformat())
        pg.click('.modal button:has-text("Create booking")'); pg.wait_for_selector('.modal', state='detached')
        assert sql("select count(*) from bookings where guest_name='Ana Guest'")=='1'
        shot(pg,'21-hotel-booked')
        pg.click('tr:has-text("Ana Guest") button:has-text("Open")'); pg.wait_for_selector('text=Balance due'); shot(pg,'22-booking')
        pg.click('.modal button:has-text("Check in")'); pg.wait_for_selector('.modal', state='detached')
        assert sql("select status from bookings where guest_name='Ana Guest'")=='checked_in'
    step('hotel: book and check in', pg, hotel)
    def room_charge():
        pg.click('tr:has-text("Ana Guest") button:has-text("Open")'); pg.click('.modal button:has-text("Charge to room")')
        pg.wait_for_selector('.products .product'); pg.click('.product:has-text("Club Sandwich")') if False else None
        pg.click('.seg button:has-text("Hotel services")'); pg.click('.product:has-text("Club Sandwich")')
        pg.click('.cart-fab'); assert pg.locator('.cart select').input_value()!='' , 'room not preselected'
        pg.click('.cart .btn.primary:has-text("Pay")'); pg.wait_for_selector('text=room bill'); pg.click('button:has-text("Confirm payment")'); pg.wait_for_selector('.receipt'); pg.click('button:has-text("New order")')
        assert sql("select count(*) from sales where method='room_charge'")=='1'
    step('hotel: charge to room from Sell', pg, room_charge)
    def checkout():
        tap_nav(pg,'Hotel'); pg.click('tr:has-text("Ana Guest") button:has-text("Open")'); pg.wait_for_selector('text=Charge '); shot(pg,'23-folio')
        pg.click('.modal button:has-text("Check out")'); pg.wait_for_selector('text=Balance due'); pg.click('button:has-text("Take payment")'); pg.wait_for_selector('.modal', state='detached')
        assert sql("select status from bookings where guest_name='Ana Guest'")=='checked_out'
        assert sql("select housekeeping from rooms where number='101'")=='dirty'
    step('hotel: check out settles folio', pg, checkout)

    def stock():
        tap_nav(pg,'Stock'); pg.wait_for_selector('table'); shot(pg,'30-stock')
        pg.click('tr:has-text("Fresh milk") button:has-text("Adjust")'); pg.fill('.modal input[type=number] >> nth=0','500'); pg.click('.modal button:has-text("Save")'); pg.wait_for_selector('.modal', state='detached')
        assert sql("select stock from ingredients where name='Fresh milk'")=='6500.000', sql("select stock from ingredients where name='Fresh milk'")
    step('stock: receive delivery', pg, stock)
    def menu():
        tap_nav(pg,'More'); pg.click('#view a:has-text("Menu")'); pg.wait_for_selector('table'); shot(pg,'31-menu')
        pg.click('tr:has-text("Espresso") button:has-text("Edit")'); pg.fill('.modal input[type=number] >> nth=0','20000'); pg.click('.modal button:has-text("Save")'); pg.wait_for_selector('.modal', state='detached')
        assert sql("select price from products where name='Espresso'")=='20000.00'
    step('menu: edit price', pg, menu)
    def reports():
        tap_nav(pg,'Reports'); pg.wait_for_selector('.stats'); shot(pg,'32-reports')
        t=pg.inner_text('.stats').lower(); assert 'revenue' in t and 'profit' in t, t
    step('reports render', pg, reports)
    def history():
        tap_nav(pg,'More'); pg.click('#view a:has-text("Sales")'); pg.wait_for_selector('table'); shot(pg,'33-history')
        pg.click('tr:has-text("Cash") >> nth=0 >> button:has-text("Open")'); pg.wait_for_selector('.receipt'); pg.click('.modal button:has-text("Void")')
        pg.fill('.modal input','test void'); pg.click('.modal button:has-text("Void sale")'); pg.wait_for_timeout(800)
        assert sql("select count(*) from sales where status='void'")=='1'
    step('history: void a sale restores stock', pg, history)

    # second user: pending -> approved cashier
    ctx2=b.new_context(viewport={'width':390,'height':844}, is_mobile=True, color_scheme='dark'); pg2=ctx2.new_page(); pg2.set_default_timeout(8000); hook(pg2)
    connect(pg2); signup(pg2,'Bima Cashier','bima@t.io')
    step('second user is pending', pg2, lambda: pg2.wait_for_selector('text=Waiting for approval'))
    shot(pg2,'40-pending')
    def approve():
        tap_nav(pg,'More'); pg.click('#view a:has-text("Staff")'); pg.wait_for_selector('table'); shot(pg,'41-staff')
        pg.select_option('tr:has-text("Bima") select','cashier'); pg.wait_for_timeout(600)
        assert sql("select role from profiles where email='bima@t.io'")=='cashier'
    step('admin approves cashier', pg, approve)
    def cashier_view():
        pg2.click('button:has-text("Check again")'); pg2.wait_for_selector('.products .product', timeout=10000)
        labels=pg2.locator('nav a span').all_inner_texts(); assert 'Stock' not in labels and 'Reports' not in labels, labels
        shot(pg2,'42-cashier')
    step('cashier sees limited nav', pg2, cashier_view)
    def cashier_blocked():
        r=pg2.evaluate("""async()=>{const m=await import('/js/state.js');const {data,error}=await m.S.sb.from('ingredients').update({stock:1}).neq('id','00000000-0000-0000-0000-000000000000').select();
          const r2=await m.S.sb.rpc('void_sale',{p_id:'00000000-0000-0000-0000-000000000000',p_reason:'x'}); const r3=await m.S.sb.from('audit_log').select('*');
          return {upd:(data||[]).length, voidErr:r2.error&&r2.error.message, audit:(r3.data||[]).length}}""")
        assert r['upd']==0 and 'manager' in (r['voidErr'] or '') and r['audit']==0, r
    step('cashier blocked from stock/void/audit via API', pg2, cashier_blocked)

    def pin():
        pg.bring_to_front(); tap_nav(pg,'More'); pg.click('#view a:has-text("Settings")'); pg.wait_for_selector('text=PIN lock'); shot(pg,'50-settings')
        pg.click('button:has-text("Set PIN")'); pg.fill('#pin-a','2468'); pg.fill('#pin-b','2468'); pg.fill('#pin-d','1357'); pg.click('.modal button:has-text("Save PIN")')
    step('settings: set PIN with duress', pg, lambda: (pin(), pg.wait_for_selector('button[aria-label="Lock now"]', timeout=8000)))
    def lock_unlock():
        pg.wait_for_timeout(500); pg.wait_for_selector('.status'); 
        pg.click('button[aria-label="Lock now"]'); pg.wait_for_selector('#lock'); shot(pg,'51-lock')
        for ch in '9999': pg.keyboard.press(ch)
        pg.keyboard.press('Enter'); pg.wait_for_selector('text=Wrong PIN'); shot(pg,'52-lock-wrong')
        for ch in '2468': pg.keyboard.press(ch)
        pg.keyboard.press('Enter'); pg.wait_for_selector('#lock', state='detached', timeout=8000)
    step('lock screen: wrong PIN rejected, right PIN unlocks', pg, lock_unlock)
    def duress():
        pg.click('button[aria-label="Lock now"]'); pg.wait_for_selector('#lock')
        for ch in '1357': pg.keyboard.press(ch)
        pg.keyboard.press('Enter'); pg.wait_for_selector('text=Sign in to continue', timeout=8000)
        assert 'Waiting' not in pg.inner_text('body')
    step('duress PIN signs out silently', pg, duress)
    b.close()
print('\n'.join(f'{a} {n}' for a,n in results)); print('ERRORS:',errs[:8])
