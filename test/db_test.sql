\set ON_ERROR_STOP off
\set QUIET on
-- users: first = admin, others pending
insert into auth.users (id,email) values
 ('00000000-0000-0000-0000-00000000000a','admin@t.io'),
 ('00000000-0000-0000-0000-00000000000b','mgr@t.io'),
 ('00000000-0000-0000-0000-00000000000c','cash@t.io'),
 ('00000000-0000-0000-0000-00000000000d','new@t.io');
select 'T01 first user admin, rest pending' t, (select string_agg(role, ',' order by email) from profiles) r;
update profiles set role='manager' where email='mgr@t.io';
update profiles set role='cashier' where email='cash@t.io';

insert into categories values ('coffee','Coffee','cafe',1),('rooms','Room service','hotel',2);
insert into products (id,category_id,name,price) values
 ('11111111-1111-1111-1111-111111111111','coffee','Latte',30000),
 ('22222222-2222-2222-2222-222222222222','coffee','Espresso',20000);
insert into ingredients (id,name,unit,stock,min_stock,unit_cost) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Beans','g',1000,100,100),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Milk','ml',500,100,20);
insert into recipes values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',18),
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',200),
 ('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',18);
update business set tax_rate=10, service_rate=5;
insert into rooms (id,number,rate,capacity) values ('cccccccc-cccc-cccc-cccc-cccccccccccc','101',500000,2);

-- ===== cashier session
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select 'T02 open shift' t, (open_shift(100000)).opening_cash r;
select 'T03 open shift twice returns same' t, (select count(*) from shifts) r;
select 'T04 checkout' t, checkout('{"id":"d0000000-0000-0000-0000-000000000001","no":"R-1","channel":"dine_in","method":"cash","paid":100000,
  "items":[{"product_id":"11111111-1111-1111-1111-111111111111","qty":2,"price":1}]}'::jsonb) r;
select 'T05 idempotent repeat -> already' t, checkout('{"id":"d0000000-0000-0000-0000-000000000001","no":"R-1","channel":"dine_in","method":"cash","paid":100000,
  "items":[{"product_id":"11111111-1111-1111-1111-111111111111","qty":2}]}'::jsonb)->>'already' r;
reset role;
select 'T06 stock after 1 sale (beans 964, milk 100)' t, (select string_agg(name||'='||stock, ',' order by name) from ingredients) r;
select 'T07 sales rows (1), items (1)' t, (select count(*) from sales)||','||(select count(*) from sale_items) r;
select 'T08 total=60000+5%+10% => 69300' t, total r from sales;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select 'T09 receipt no collision gets new no' t, checkout('{"id":"d0000000-0000-0000-0000-000000000002","no":"R-1","channel":"takeaway","method":"qris",
  "items":[{"product_id":"22222222-2222-2222-2222-222222222222","qty":1}]}'::jsonb)->>'no' r;
select 'T10 cash short is rejected' t;
select checkout('{"id":"d0000000-0000-0000-0000-000000000003","channel":"takeaway","method":"cash","paid":1,
  "items":[{"product_id":"22222222-2222-2222-2222-222222222222","qty":1}]}'::jsonb);
select 'T11 rejected sale left nothing' t, (select count(*) from sales where id='d0000000-0000-0000-0000-000000000003') r;
select 'T12 bad qty rejected' t;
select checkout('{"id":"d0000000-0000-0000-0000-000000000004","channel":"takeaway","method":"qris","items":[{"product_id":"22222222-2222-2222-2222-222222222222","qty":0}]}'::jsonb);
select 'T13 room charge w/o guest rejected' t;
select checkout('{"id":"d0000000-0000-0000-0000-000000000005","channel":"room","method":"room_charge","items":[{"product_id":"22222222-2222-2222-2222-222222222222","qty":1}]}'::jsonb);
select 'T14 oversell allowed (stock goes negative)' t;
select checkout('{"id":"d0000000-0000-0000-0000-000000000006","channel":"takeaway","method":"qris","items":[{"product_id":"11111111-1111-1111-1111-111111111111","qty":50}]}'::jsonb)->>'total' ;
select 'T15 cashier cannot void' t;
select void_sale('d0000000-0000-0000-0000-000000000001','test');
select 'T16 cashier cannot adjust stock' t;
select stock_adjust('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','purchase',10);
select 'T17 cashier cannot write sales directly' t;
insert into sales (id,no,channel,method) values (gen_random_uuid(),'X','dine_in','cash');
select 'T18 cashier cannot update stock directly' t;
update ingredients set stock=999999;
select 'T19 cashier cannot read audit/reports' t;
select count(*) from audit_log;
select report_summary(current_date, current_date);
select 'T20 cashier cannot change own role' t;
update profiles set role='admin' where id='00000000-0000-0000-0000-00000000000c';
select 'T20b role still cashier' t, role r from profiles where id='00000000-0000-0000-0000-00000000000c';

-- ===== hotel
select 'T21 booking' t, (booking_create('cccccccc-cccc-cccc-cccc-cccccccccccc','Ana','081',2,current_date,current_date+3,500000,200000,'')).status r;
select 'T22 overlapping booking rejected' t;
select booking_create('cccccccc-cccc-cccc-cccc-cccccccccccc','Bob','082',1,current_date+1,current_date+2,500000,0,'');
select 'T23 back-to-back (check-in = other check-out) allowed' t, (booking_create('cccccccc-cccc-cccc-cccc-cccccccccccc','Cy','083',1,current_date+3,current_date+4,500000,0,'')).status r;
select 'T24 over capacity rejected' t;
select booking_create('cccccccc-cccc-cccc-cccc-cccccccccccc','Dan','084',5,current_date+10,current_date+11,500000,0,'');
select 'T25 direct status change rejected' t;
update bookings set status='checked_out';
select 'T26 check in' t, (booking_check_in((select id from bookings where guest_name='Ana'))).status r;
select 'T27 room charge sale' t, checkout(jsonb_build_object('id','d0000000-0000-0000-0000-000000000007','channel','room','method','room_charge',
  'booking_id',(select id from bookings where guest_name='Ana'),
  'items',jsonb_build_array(jsonb_build_object('product_id','22222222-2222-2222-2222-222222222222','qty',2))))->>'total' r;
select 'T28 folio' t, booking_folio((select id from bookings where guest_name='Ana')) r;
select 'T29 checkout underpaid rejected' t;
select booking_check_out((select id from bookings where guest_name='Ana'),'cash',1);
select 'T30 checkout ok' t, booking_check_out((select id from bookings where guest_name='Ana'),'cash',null)->>'due' r;
select 'T31 checkout twice -> already' t, booking_check_out((select id from bookings where guest_name='Ana'),'cash',null)->>'already' r;
select 'T32 closed booking cannot be edited' t;
update bookings set note='x' where guest_name='Ana';
select 'T33 close shift' t, close_shift(100000)->>'orders' r;
reset role;
select 'T34 room dirty after checkout' t, housekeeping r from rooms;

-- ===== manager
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'T35 manager adjust stock (count to 500)' t, (stock_adjust('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','adjust',500)).stock r;
select 'T36 void restores stock' t;
select void_sale('d0000000-0000-0000-0000-000000000006','mistake');
reset role;
select 'T37 beans after: 500 + 900 back' t, stock r from ingredients where name='Beans';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'T38 void twice is harmless' t;
select void_sale('d0000000-0000-0000-0000-000000000006','again');
select 'T39 report works for manager' t, report_summary(current_date, current_date)->'totals' r;
select 'T40 manager cannot change roles' t;
update profiles set role='admin' where email='cash@t.io';
select 'T41 manager cannot edit business' t;
update business set name='x';
reset role;

-- ===== pending user
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select 'T42 pending sees no products' t, count(*) r from products;
select 'T43 pending cannot checkout' t;
select checkout('{"id":"d0000000-0000-0000-0000-000000000009","channel":"takeaway","method":"qris","items":[]}'::jsonb);
reset role;

-- ===== anon
set role anon;
select 'T44 anon blocked' t;
select count(*) from products;
reset role;

-- ===== admin: last admin protection
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'T45 cannot demote last admin' t;
update profiles set role='cashier' where email='admin@t.io';
select 'T46 audit has rows' t, count(*)>0 r from audit_log;
reset role;
