-- =============================================================================
-- OmniTill sample data (optional). Run AFTER schema.sql, in the SQL Editor.
-- Safe to run twice: existing rows are left alone.
-- Prices are in IDR. Change them in the app (Menu screen) afterwards.
-- =============================================================================

insert into public.categories (id, name, area, sort) values
  ('coffee',   'Coffee',        'cafe',  1),
  ('drinks',   'Non-coffee',    'cafe',  2),
  ('food',     'Food',          'cafe',  3),
  ('snacks',   'Snacks',        'cafe',  4),
  ('dessert',  'Dessert',       'cafe',  5),
  ('roomsvc',  'Room service',  'hotel', 1),
  ('minibar',  'Minibar',       'hotel', 2),
  ('laundry',  'Laundry',       'hotel', 3),
  ('services', 'Services',      'hotel', 4),
  ('spa',      'Spa',           'hotel', 5)
on conflict (id) do nothing;

with p(cat, name, price, popular) as (values
  ('coffee','Espresso',18000,false), ('coffee','Americano',22000,false), ('coffee','Palm Sugar Latte',24000,true),
  ('coffee','Cappuccino',28000,false), ('coffee','Caffe Latte',28000,false), ('coffee','V60 Single Origin',30000,false),
  ('coffee','Affogato',32000,false),
  ('drinks','Matcha Latte',28000,false), ('drinks','Hot Chocolate',25000,false), ('drinks','Iced Lemon Tea',18000,false),
  ('drinks','Avocado Juice',25000,false), ('drinks','Mineral Water',8000,false),
  ('food','Fried Rice',35000,true), ('food','Fried Noodles',32000,false), ('food','Spicy Fried Chicken',30000,false),
  ('food','Chicken Soup',28000,false), ('food','Fish and Chips',45000,false),
  ('snacks','Truffle Fries',22000,false), ('snacks','Chocolate Cheese Toast',22000,false), ('snacks','Crispy Banana',18000,false),
  ('snacks','Butter Croissant',25000,false),
  ('dessert','Gelato, 3 scoops',20000,false), ('dessert','Baked Brownie',22000,false), ('dessert','Baked Cheesecake',30000,false),
  ('roomsvc','Breakfast set, local',75000,true), ('roomsvc','Breakfast set, western',85000,false),
  ('roomsvc','Club Sandwich',48000,false), ('roomsvc','Caesar Salad',45000,false),
  ('minibar','Cola can',15000,false), ('minibar','Beer',35000,false), ('minibar','Chips',25000,false),
  ('minibar','Chocolate bar',20000,false), ('minibar','Water 600 ml',10000,false),
  ('laundry','Wash and dry, per kg',12000,false), ('laundry','Ironing, per kg',10000,false),
  ('laundry','Express 6 hours, per kg',30000,false),
  ('services','Extra bed',120000,false), ('services','Early check-in',150000,false),
  ('services','Late check-out',150000,false), ('services','Airport transfer',150000,false),
  ('spa','Traditional massage, 60 min',150000,false), ('spa','Aromatherapy spa, 90 min',250000,true),
  ('spa','Sauna and jacuzzi',100000,false)
)
insert into public.products (category_id, name, price, popular)
select cat, name, price, popular from p
where not exists (select 1 from public.products x where x.name = p.name);

with i(name, unit, stock, min_stock, unit_cost) as (values
  ('Arabica beans','g',4500,500,350), ('Fresh milk','ml',6000,1000,22), ('Palm sugar syrup','ml',2500,400,45),
  ('Matcha powder','g',800,150,180), ('Cocoa powder','g',1200,200,120), ('Tea bags','pcs',200,30,900),
  ('Lemon','pcs',24,6,4500), ('Avocado','pcs',18,5,8500), ('Rice','g',15000,3000,16), ('Eggs','pcs',90,24,2600),
  ('Egg noodles','g',4000,800,45), ('Chicken','g',5000,1000,42), ('Bird''s eye chili','g',800,150,85),
  ('Fish fillet','g',2200,500,88), ('Potato','g',6000,1200,17), ('Bread','slices',40,12,2200),
  ('Cheddar','g',1000,200,95), ('Banana','pcs',25,8,3200), ('Croissant, frozen','pcs',22,6,11500),
  ('Vanilla gelato','scoops',35,10,7500), ('Brownie batter','portions',15,5,9800), ('Cream cheese','g',900,200,105),
  ('Cola can','pcs',36,12,8500), ('Beer','bottles',24,6,21000), ('Chips','pcs',18,6,15500),
  ('Chocolate bar','pcs',20,6,11000), ('Water 600 ml','bottles',60,24,3200),
  ('Laundry detergent','ml',8000,1500,24)
)
insert into public.ingredients (name, unit, stock, min_stock, unit_cost)
select name, unit, stock, min_stock, unit_cost from i
where not exists (select 1 from public.ingredients x where x.name = i.name);

with r(product, ingredient, qty) as (values
  ('Espresso','Arabica beans',18), ('Americano','Arabica beans',18),
  ('Palm Sugar Latte','Arabica beans',18), ('Palm Sugar Latte','Fresh milk',120), ('Palm Sugar Latte','Palm sugar syrup',25),
  ('Cappuccino','Arabica beans',18), ('Cappuccino','Fresh milk',150),
  ('Caffe Latte','Arabica beans',18), ('Caffe Latte','Fresh milk',200),
  ('V60 Single Origin','Arabica beans',22),
  ('Affogato','Arabica beans',18), ('Affogato','Vanilla gelato',1),
  ('Matcha Latte','Matcha powder',6), ('Matcha Latte','Fresh milk',200),
  ('Hot Chocolate','Cocoa powder',25), ('Hot Chocolate','Fresh milk',200),
  ('Iced Lemon Tea','Tea bags',2), ('Iced Lemon Tea','Lemon',1),
  ('Avocado Juice','Avocado',1), ('Avocado Juice','Fresh milk',60),
  ('Mineral Water','Water 600 ml',1),
  ('Fried Rice','Rice',250), ('Fried Rice','Eggs',1), ('Fried Rice','Bird''s eye chili',15),
  ('Fried Noodles','Egg noodles',180), ('Fried Noodles','Eggs',1),
  ('Spicy Fried Chicken','Chicken',220), ('Spicy Fried Chicken','Bird''s eye chili',25), ('Spicy Fried Chicken','Rice',250),
  ('Chicken Soup','Chicken',150), ('Chicken Soup','Rice',200),
  ('Fish and Chips','Fish fillet',220), ('Fish and Chips','Potato',200),
  ('Truffle Fries','Potato',250),
  ('Chocolate Cheese Toast','Bread',2), ('Chocolate Cheese Toast','Cheddar',30), ('Chocolate Cheese Toast','Cocoa powder',10),
  ('Crispy Banana','Banana',2),
  ('Butter Croissant','Croissant, frozen',1),
  ('Gelato, 3 scoops','Vanilla gelato',3),
  ('Baked Brownie','Brownie batter',1),
  ('Baked Cheesecake','Cream cheese',120),
  ('Cola can','Cola can',1), ('Beer','Beer',1), ('Chips','Chips',1), ('Chocolate bar','Chocolate bar',1), ('Water 600 ml','Water 600 ml',1),
  ('Wash and dry, per kg','Laundry detergent',40)
)
insert into public.recipes (product_id, ingredient_id, qty)
select p.id, i.id, r.qty
  from r
  join public.products p on p.name = r.product
  join public.ingredients i on i.name = r.ingredient
on conflict do nothing;

insert into public.rooms (number, type, rate, capacity)
select n, t, rate, cap from (values
  ('101','Standard', 450000, 2), ('102','Standard', 450000, 2), ('103','Standard', 450000, 2),
  ('201','Deluxe',   650000, 3), ('202','Deluxe',   650000, 3),
  ('301','Suite',   1100000, 4)
) v(n, t, rate, cap)
on conflict (number) do nothing;
