-- =============================================================================
-- OmniTill database schema (Supabase / PostgreSQL 15+)
--
-- How to run: Supabase Dashboard > SQL Editor > New query > paste all > Run.
-- Safe to run again after an update (idempotent).
--
-- Security model
--   * Every table has Row Level Security (RLS) switched on.
--   * Roles: pending (no access) < cashier < manager < admin.
--   * The first account that ever signs in becomes admin. Everyone else starts
--     as pending until an admin approves them in the app (Staff screen).
--   * Money and stock only change through the RPC functions below
--     (checkout, void_sale, stock_adjust, ...), never by direct table writes.
-- =============================================================================

create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- Profiles and roles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'pending'
              check (role in ('pending', 'cashier', 'manager', 'admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function public.ot_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.ot_has(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ot_role() = any (roles), false)
$$;

-- First account becomes admin, the rest wait for approval.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(7243001);
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Never allow the last active admin to be demoted or deactivated.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active
     and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'At least one active admin is required';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before update on public.profiles
  for each row execute function public.profiles_guard();

-- -----------------------------------------------------------------------------
-- Business settings (single row)
-- -----------------------------------------------------------------------------
create table if not exists public.business (
  id             int primary key default 1 check (id = 1),
  name           text not null default 'OmniTill',
  address        text not null default '',
  phone          text not null default '',
  currency       text not null default 'IDR',
  locale         text not null default 'id-ID',
  timezone       text not null default 'Asia/Jakarta',
  tax_rate       numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  service_rate   numeric(5, 2) not null default 0 check (service_rate between 0 and 100),
  receipt_footer text not null default 'Thank you!',
  hotel_enabled  boolean not null default true,
  updated_at     timestamptz not null default now()
);
insert into public.business (id) values (1) on conflict do nothing;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists business_touch on public.business;
create trigger business_touch before update on public.business
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Catalog
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id    text primary key,
  name  text not null,
  area  text not null default 'cafe' check (area in ('cafe', 'hotel')),
  sort  int not null default 0
);

create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  text not null references public.categories (id) on update cascade,
  name         text not null check (length(trim(name)) > 0),
  price        numeric(14, 2) not null check (price >= 0),
  popular      boolean not null default false,
  active       boolean not null default true,
  sort         int not null default 0,
  updated_at   timestamptz not null default now()
);
create index if not exists products_category_idx on public.products (category_id);

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create table if not exists public.ingredients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  unit        text not null default 'pcs',
  stock       numeric(14, 3) not null default 0,
  min_stock   numeric(14, 3) not null default 0 check (min_stock >= 0),
  unit_cost   numeric(14, 4) not null default 0 check (unit_cost >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.recipes (
  product_id     uuid not null references public.products (id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients (id) on delete cascade,
  qty            numeric(14, 3) not null check (qty > 0),
  primary key (product_id, ingredient_id)
);

create table if not exists public.stock_moves (
  id             uuid primary key default gen_random_uuid(),
  ingredient_id  uuid not null references public.ingredients (id) on delete cascade,
  kind           text not null check (kind in ('opening', 'purchase', 'sale', 'void', 'waste', 'adjust')),
  qty            numeric(14, 3) not null,          -- signed: + in, - out
  balance_after  numeric(14, 3) not null,
  note           text not null default '',
  sale_id        uuid,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists stock_moves_ing_idx on public.stock_moves (ingredient_id, created_at desc);
create index if not exists stock_moves_sale_idx on public.stock_moves (sale_id);

-- Stock may only change inside the RPC functions (they set this flag).
-- A new ingredient with opening stock gets an 'opening' entry in the stock history.
create or replace function public.ingredients_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock <> 0 then
    insert into public.stock_moves (ingredient_id, kind, qty, balance_after, note, created_by)
    values (new.id, 'opening', new.stock, new.stock, 'Opening balance', auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists ingredients_guard_trg on public.ingredients;
create trigger ingredients_guard_trg after insert on public.ingredients
  for each row execute function public.ingredients_guard();

-- Block direct stock edits (only the RPC functions set the flag).
create or replace function public.ingredients_guard_before() returns trigger
language plpgsql as $$
begin
  if new.stock is distinct from old.stock
     and coalesce(current_setting('omnitill.stock_rpc', true), '') <> '1' then
    raise exception 'Stock can only be changed with stock_adjust or a sale';
  end if;
  return new;
end $$;

drop trigger if exists ingredients_guard_before_trg on public.ingredients;
create trigger ingredients_guard_before_trg before update on public.ingredients
  for each row execute function public.ingredients_guard_before();

-- -----------------------------------------------------------------------------
-- Hotel: rooms and bookings
-- -----------------------------------------------------------------------------
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique check (length(trim(number)) > 0),
  type          text not null default 'Standard',
  rate          numeric(14, 2) not null default 0 check (rate >= 0),
  capacity      int not null default 2 check (capacity > 0),
  housekeeping  text not null default 'clean' check (housekeeping in ('clean', 'dirty', 'maintenance')),
  active        boolean not null default true
);

create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id),
  guest_name      text not null check (length(trim(guest_name)) > 0),
  guest_phone     text not null default '',
  guests          int not null default 1 check (guests > 0),
  check_in        date not null,
  check_out       date not null,
  rate            numeric(14, 2) not null check (rate >= 0),
  deposit         numeric(14, 2) not null default 0 check (deposit >= 0),
  status          text not null default 'reserved'
                  check (status in ('reserved', 'checked_in', 'checked_out', 'cancelled')),
  note            text not null default '',
  created_by      uuid,
  created_at      timestamptz not null default now(),
  checked_in_at   timestamptz,
  checked_out_at  timestamptz,
  total_billed    numeric(14, 2),
  paid_total      numeric(14, 2),
  pay_method      text,
  constraint bookings_dates_ok check (check_out > check_in),
  -- Two active bookings can never overlap on the same room. Check-out day is free.
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status in ('reserved', 'checked_in'))
);
create index if not exists bookings_status_idx on public.bookings (status, check_in);

-- Status and money columns are only changed by the booking_* RPC functions.
create or replace function public.bookings_guard() returns trigger
language plpgsql as $$
begin
  if (new.status is distinct from old.status
      or new.total_billed is distinct from old.total_billed
      or new.paid_total is distinct from old.paid_total
      or new.pay_method is distinct from old.pay_method
      or new.checked_in_at is distinct from old.checked_in_at
      or new.checked_out_at is distinct from old.checked_out_at)
     and coalesce(current_setting('omnitill.booking_rpc', true), '') <> '1' then
    raise exception 'Booking status can only be changed with check in, check out or cancel';
  end if;
  if old.status in ('checked_out', 'cancelled') then
    raise exception 'This booking is closed and cannot be edited';
  end if;
  return new;
end $$;

drop trigger if exists bookings_guard_trg on public.bookings;
create trigger bookings_guard_trg before update on public.bookings
  for each row execute function public.bookings_guard();

-- -----------------------------------------------------------------------------
-- Shifts, sales, expenses, audit
-- -----------------------------------------------------------------------------
create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id),
  user_name     text not null default '',
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  opening_cash  numeric(14, 2) not null default 0 check (opening_cash >= 0),
  counted_cash  numeric(14, 2),
  expected_cash numeric(14, 2),
  note          text not null default ''
);
-- One open shift per person.
create unique index if not exists shifts_one_open_idx on public.shifts (user_id) where closed_at is null;

create table if not exists public.sales (
  id           uuid primary key,                       -- created on the device, makes sync safe to repeat
  no           text not null unique,
  created_at   timestamptz not null default now(),     -- when the sale really happened
  synced_at    timestamptz not null default now(),
  shift_id     uuid references public.shifts (id),
  cashier_id   uuid references public.profiles (id),
  cashier_name text not null default '',
  channel      text not null check (channel in ('dine_in', 'takeaway', 'room')),
  table_no     text not null default '',
  guest_name   text not null default '',
  booking_id   uuid references public.bookings (id),
  subtotal     numeric(14, 2) not null default 0,
  discount     numeric(14, 2) not null default 0 check (discount >= 0),
  service      numeric(14, 2) not null default 0,
  tax          numeric(14, 2) not null default 0,
  total        numeric(14, 2) not null default 0 check (total >= 0),
  method       text not null check (method in ('cash', 'qris', 'card', 'transfer', 'room_charge')),
  paid         numeric(14, 2) not null default 0,
  change       numeric(14, 2) not null default 0,
  status       text not null default 'paid' check (status in ('paid', 'void')),
  void_reason  text,
  voided_by    uuid,
  voided_at    timestamptz,
  note         text not null default ''
);
create index if not exists sales_created_idx on public.sales (created_at desc);
create index if not exists sales_cashier_idx on public.sales (cashier_id, created_at desc);
create index if not exists sales_booking_idx on public.sales (booking_id);
create index if not exists sales_shift_idx on public.sales (shift_id);

create table if not exists public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,
  name        text not null,
  price       numeric(14, 2) not null check (price >= 0),
  qty         int not null check (qty > 0),
  cost        numeric(14, 4) not null default 0          -- ingredient cost of one unit at sale time
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_product_idx on public.sale_items (product_id);

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  spent_on    date not null default current_date,
  category    text not null default 'General',
  amount      numeric(14, 2) not null check (amount > 0),
  note        text not null default '',
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (spent_on);

create table if not exists public.audit_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  actor   uuid,
  action  text not null,
  ref     text,
  detail  jsonb not null default '{}'::jsonb
);
create index if not exists audit_at_idx on public.audit_log (at desc);

create or replace function public.audit(p_action text, p_ref text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, action, ref, detail) values (auth.uid(), p_action, p_ref, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function public.profiles_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role or new.active is distinct from old.active then
    insert into public.audit_log (actor, action, ref, detail)
    values (auth.uid(), 'staff_changed', new.id::text,
            jsonb_build_object('role_from', old.role, 'role_to', new.role, 'active_from', old.active, 'active_to', new.active));
  end if;
  return new;
end $$;

drop trigger if exists profiles_audit_trg on public.profiles;
create trigger profiles_audit_trg after update on public.profiles
  for each row execute function public.profiles_audit();

-- =============================================================================
-- RPC functions (the only way money and stock change)
-- =============================================================================

create or replace function public.money_scale() returns int
language sql stable security definer set search_path = public as $$
  select case when currency in ('IDR', 'JPY', 'KRW', 'VND', 'CLP') then 0 else 2 end from public.business where id = 1
$$;

-- ---- Shifts -----------------------------------------------------------------
create or replace function public.open_shift(p_opening numeric default 0) returns public.shifts
language plpgsql security definer set search_path = public as $$
declare s public.shifts; v_name text;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(p_opening, 0) < 0 then raise exception 'Opening cash cannot be negative'; end if;
  select * into s from public.shifts where user_id = auth.uid() and closed_at is null;
  if found then return s; end if;                      -- already open: return it (safe to repeat)
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.shifts (user_id, user_name, opening_cash) values (auth.uid(), coalesce(v_name, ''), coalesce(p_opening, 0))
  returning * into s;
  return s;
end $$;

create or replace function public.close_shift(p_counted numeric, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shifts; v_cash numeric; v_count int; v_total numeric; v_expected numeric;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Counted cash is required'; end if;
  select * into s from public.shifts where user_id = auth.uid() and closed_at is null for update;
  if not found then raise exception 'There is no open shift'; end if;
  select coalesce(sum(total) filter (where method = 'cash'), 0), count(*), coalesce(sum(total), 0)
    into v_cash, v_count, v_total
    from public.sales where shift_id = s.id and status = 'paid';
  v_expected := s.opening_cash + v_cash;
  update public.shifts set closed_at = now(), counted_cash = p_counted, expected_cash = v_expected, note = coalesce(p_note, '')
   where id = s.id;
  perform public.audit('shift_closed', s.id::text, jsonb_build_object('expected', v_expected, 'counted', p_counted));
  return jsonb_build_object('shift_id', s.id, 'opened_at', s.opened_at, 'opening_cash', s.opening_cash,
                            'cash_sales', v_cash, 'orders', v_count, 'sales_total', v_total,
                            'expected', v_expected, 'counted', p_counted, 'variance', p_counted - v_expected);
end $$;

-- ---- Checkout ---------------------------------------------------------------
-- The device sends everything with its own sale id. Sending the same sale twice
-- returns the first result and changes nothing. Prices come from the catalog,
-- except for a sale made offline before a price change (it keeps the price the
-- customer actually saw).
create or replace function public.checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_no text;
  v_sold timestamptz;
  v_channel text;
  v_method text;
  v_biz public.business%rowtype;
  v_scale int;
  v_service_rate numeric;
  v_tax_rate numeric;
  v_booking uuid;
  v_shift uuid;
  v_sub numeric := 0;
  v_disc numeric;
  v_base numeric;
  v_service numeric;
  v_tax numeric;
  v_total numeric;
  v_paid numeric;
  v_change numeric;
  v_name text;
  v_existing public.sales%rowtype;
  v_items jsonb;
  it jsonb;
  v_prod public.products%rowtype;
  v_qty int;
  v_price numeric;
  v_cost numeric;
  rec record;
  v_stock numeric;
  v_try int := 0;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform set_config('omnitill.stock_rpc', '1', true);

  v_id := nullif(p ->> 'id', '')::uuid;
  if v_id is null then raise exception 'Missing sale id'; end if;

  perform pg_advisory_xact_lock(hashtext('ot-sale:' || v_id::text));   -- two copies of one sale wait for each other
  select * into v_existing from public.sales where id = v_id;
  if found then
    return jsonb_build_object('id', v_existing.id, 'no', v_existing.no, 'total', v_existing.total,
                              'paid', v_existing.paid, 'change', v_existing.change,
                              'created_at', v_existing.created_at, 'already', true);
  end if;

  v_channel := p ->> 'channel';
  v_method := p ->> 'method';
  if v_channel is null or v_channel not in ('dine_in', 'takeaway', 'room') then raise exception 'Invalid order type'; end if;
  if v_method is null or v_method not in ('cash', 'qris', 'card', 'transfer', 'room_charge') then raise exception 'Invalid payment method'; end if;

  v_items := p -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'The order has no items'; end if;
  if jsonb_array_length(v_items) > 100 then raise exception 'Too many lines in one order'; end if;

  v_sold := least(coalesce(nullif(p ->> 'sold_at', '')::timestamptz, now()), now());
  select * into v_biz from public.business where id = 1;
  v_scale := public.money_scale();

  -- A sale made before the last settings change keeps the rates the customer saw.
  if v_sold < v_biz.updated_at then
    v_service_rate := least(greatest(coalesce(nullif(p ->> 'service_rate', '')::numeric, v_biz.service_rate), 0), 100);
    v_tax_rate := least(greatest(coalesce(nullif(p ->> 'tax_rate', '')::numeric, v_biz.tax_rate), 0), 100);
  else
    v_service_rate := v_biz.service_rate;
    v_tax_rate := v_biz.tax_rate;
  end if;

  if v_channel = 'room' then
    v_booking := nullif(p ->> 'booking_id', '')::uuid;
    if v_method = 'room_charge' then
      if v_booking is null or not exists (select 1 from public.bookings where id = v_booking and status = 'checked_in') then
        raise exception 'Room charge needs a guest who is currently checked in';
      end if;
    end if;
  else
    if v_method = 'room_charge' then raise exception 'Room charge is only for room orders'; end if;
    v_booking := null;
  end if;

  v_shift := nullif(p ->> 'shift_id', '')::uuid;
  if v_shift is not null and not exists (select 1 from public.shifts where id = v_shift and user_id = v_uid) then v_shift := null; end if;
  if v_shift is null then select id into v_shift from public.shifts where user_id = v_uid and closed_at is null; end if;

  select full_name into v_name from public.profiles where id = v_uid;

  -- Receipt number: keep the device's number, make a new one if it is taken.
  v_no := nullif(left(trim(coalesce(p ->> 'no', '')), 40), '');
  loop
    if v_no is not null then perform pg_advisory_xact_lock(hashtext('ot-no:' || v_no)); end if;
    if v_no is null or exists (select 1 from public.sales where no = v_no) then
      v_no := 'OT-' || to_char(v_sold at time zone v_biz.timezone, 'YYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
    end if;
    exit when not exists (select 1 from public.sales where no = v_no);
    v_try := v_try + 1;
    exit when v_try > 10;
  end loop;

  insert into public.sales (id, no, created_at, shift_id, cashier_id, cashier_name, channel, table_no, guest_name,
                            booking_id, method, note)
  values (v_id, v_no, v_sold, v_shift, v_uid, coalesce(v_name, ''), v_channel,
          left(coalesce(p ->> 'table_no', ''), 20), left(coalesce(p ->> 'guest_name', ''), 80),
          v_booking, v_method, left(coalesce(p ->> 'note', ''), 300));

  for it in select * from jsonb_array_elements(v_items) loop
    v_qty := nullif(it ->> 'qty', '')::int;
    if v_qty is null or v_qty < 1 or v_qty > 999 then raise exception 'Invalid quantity'; end if;
    select * into v_prod from public.products where id = nullif(it ->> 'product_id', '')::uuid;
    if not found then raise exception 'Unknown product in order'; end if;
    if not v_prod.active and v_sold >= v_prod.updated_at then raise exception 'Product "%" is no longer sold', v_prod.name; end if;

    if v_sold < v_prod.updated_at and nullif(it ->> 'price', '') is not null then
      v_price := greatest((it ->> 'price')::numeric, 0);       -- stale offline sale: keep the price shown
    else
      v_price := v_prod.price;
    end if;

    select coalesce(sum(r.qty * i.unit_cost), 0) into v_cost
      from public.recipes r join public.ingredients i on i.id = r.ingredient_id where r.product_id = v_prod.id;

    insert into public.sale_items (sale_id, product_id, name, price, qty, cost)
    values (v_id, v_prod.id, v_prod.name, v_price, v_qty, v_cost);
    v_sub := v_sub + v_price * v_qty;
  end loop;

  v_disc := least(greatest(coalesce(nullif(p ->> 'discount', '')::numeric, 0), 0), v_sub);
  v_base := v_sub - v_disc;
  v_service := round(v_base * v_service_rate / 100, v_scale);
  v_tax := round((v_base + v_service) * v_tax_rate / 100, v_scale);
  v_total := round(v_base + v_service + v_tax, v_scale);

  if v_method = 'cash' then
    v_paid := coalesce(nullif(p ->> 'paid', '')::numeric, v_total);
    if v_paid < v_total then raise exception 'Cash received (%) is less than the total (%)', v_paid, v_total; end if;
    v_change := v_paid - v_total;
  elsif v_method = 'room_charge' then
    v_paid := 0; v_change := 0;                             -- paid when the guest checks out
  else
    v_paid := v_total; v_change := 0;
  end if;

  update public.sales
     set subtotal = v_sub, discount = v_disc, service = v_service, tax = v_tax, total = v_total,
         paid = v_paid, change = v_change
   where id = v_id;

  -- Take stock out once per ingredient, always in the same order (no deadlocks).
  for rec in
    select r.ingredient_id, sum(r.qty * si.qty) as need
      from public.sale_items si join public.recipes r on r.product_id = si.product_id
     where si.sale_id = v_id
     group by r.ingredient_id order by r.ingredient_id
  loop
    update public.ingredients set stock = stock - rec.need where id = rec.ingredient_id returning stock into v_stock;
    insert into public.stock_moves (ingredient_id, kind, qty, balance_after, note, sale_id, created_by, created_at)
    values (rec.ingredient_id, 'sale', -rec.need, v_stock, 'Sale ' || v_no, v_id, v_uid, v_sold);
  end loop;

  return jsonb_build_object('id', v_id, 'no', v_no, 'total', v_total, 'paid', v_paid, 'change', v_change,
                            'created_at', v_sold, 'already', false);
end $$;

create or replace function public.void_sale(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sales%rowtype; rec record; v_stock numeric;
begin
  if not public.ot_has('manager', 'admin') then raise exception 'Only a manager or admin can void a sale' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  perform set_config('omnitill.stock_rpc', '1', true);
  select * into s from public.sales where id = p_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if s.status = 'void' then return; end if;
  if s.method = 'room_charge' and s.booking_id is not null
     and exists (select 1 from public.bookings where id = s.booking_id and status = 'checked_out') then
    raise exception 'This charge is already part of a settled room bill';
  end if;
  update public.sales set status = 'void', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now() where id = p_id;
  for rec in
    select ingredient_id, sum(-qty) as back from public.stock_moves where sale_id = p_id and kind = 'sale'
     group by ingredient_id order by ingredient_id
  loop
    update public.ingredients set stock = stock + rec.back where id = rec.ingredient_id returning stock into v_stock;
    insert into public.stock_moves (ingredient_id, kind, qty, balance_after, note, sale_id, created_by)
    values (rec.ingredient_id, 'void', rec.back, v_stock, 'Void ' || s.no, p_id, auth.uid());
  end loop;
  perform public.audit('sale_voided', p_id::text, jsonb_build_object('no', s.no, 'total', s.total, 'reason', trim(p_reason)));
end $$;

-- ---- Stock ------------------------------------------------------------------
-- kind: purchase (+qty), waste (-qty), adjust (qty is the counted stock)
create or replace function public.stock_adjust(p_ingredient uuid, p_kind text, p_qty numeric,
                                               p_note text default '', p_unit_cost numeric default null) returns public.ingredients
language plpgsql security definer set search_path = public as $$
declare i public.ingredients; v_delta numeric;
begin
  if not public.ot_has('manager', 'admin') then raise exception 'Only a manager or admin can change stock' using errcode = '42501'; end if;
  if p_kind not in ('purchase', 'waste', 'adjust') then raise exception 'Invalid stock action'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Quantity must be zero or more'; end if;
  if p_kind in ('purchase', 'waste') and p_qty = 0 then raise exception 'Quantity must be more than zero'; end if;
  perform set_config('omnitill.stock_rpc', '1', true);
  select * into i from public.ingredients where id = p_ingredient for update;
  if not found then raise exception 'Ingredient not found'; end if;
  v_delta := case p_kind when 'purchase' then p_qty when 'waste' then -p_qty else p_qty - i.stock end;
  update public.ingredients
     set stock = stock + v_delta,
         unit_cost = case when p_kind = 'purchase' and p_unit_cost is not null and p_unit_cost >= 0 then p_unit_cost else unit_cost end
   where id = p_ingredient returning * into i;
  insert into public.stock_moves (ingredient_id, kind, qty, balance_after, note, created_by)
  values (p_ingredient, p_kind, v_delta, i.stock, coalesce(p_note, ''), auth.uid());
  perform public.audit('stock_' || p_kind, p_ingredient::text, jsonb_build_object('delta', v_delta, 'balance', i.stock));
  return i;
end $$;

-- ---- Hotel ------------------------------------------------------------------
create or replace function public.booking_create(p_room uuid, p_guest text, p_phone text, p_guests int,
                                                 p_check_in date, p_check_out date, p_rate numeric,
                                                 p_deposit numeric default 0, p_note text default '') returns public.bookings
language plpgsql security definer set search_path = public as $$
declare r public.rooms; b public.bookings;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into r from public.rooms where id = p_room and active;
  if not found then raise exception 'Room not found'; end if;
  if coalesce(trim(p_guest), '') = '' then raise exception 'Guest name is required'; end if;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then raise exception 'Check-out must be after check-in'; end if;
  if coalesce(p_guests, 1) > r.capacity then raise exception 'Room % fits % guests at most', r.number, r.capacity; end if;
  begin
    insert into public.bookings (room_id, guest_name, guest_phone, guests, check_in, check_out, rate, deposit, note, created_by)
    values (p_room, trim(p_guest), left(coalesce(p_phone, ''), 40), coalesce(p_guests, 1), p_check_in, p_check_out,
            coalesce(p_rate, r.rate), coalesce(p_deposit, 0), left(coalesce(p_note, ''), 300), auth.uid())
    returning * into b;
  exception when exclusion_violation then
    raise exception 'Room % is already booked for these dates', r.number;
  end;
  return b;
end $$;

create or replace function public.booking_folio(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.bookings; v_nights int; v_room numeric; v_charges numeric; v_lines jsonb;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_id;
  if not found then raise exception 'Booking not found'; end if;
  v_nights := b.check_out - b.check_in;
  v_room := v_nights * b.rate;
  select coalesce(sum(total), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'at', created_at, 'total', total) order by created_at), '[]'::jsonb)
    into v_charges, v_lines
    from public.sales where booking_id = p_id and method = 'room_charge' and status = 'paid';
  return jsonb_build_object('booking_id', b.id, 'nights', v_nights, 'rate', b.rate, 'room_total', v_room,
                            'charges', v_lines, 'charges_total', v_charges, 'deposit', b.deposit,
                            'total', v_room + v_charges, 'due', v_room + v_charges - b.deposit);
end $$;

create or replace function public.booking_check_in(p_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings; r public.rooms; v_today date;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform set_config('omnitill.booking_rpc', '1', true);
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status = 'checked_in' then return b; end if;
  if b.status <> 'reserved' then raise exception 'Only a reserved booking can check in'; end if;
  select (now() at time zone timezone)::date into v_today from public.business where id = 1;
  if v_today < b.check_in and not public.ot_has('manager', 'admin') then
    raise exception 'Check-in date is %. A manager can check in early.', b.check_in;
  end if;
  select * into r from public.rooms where id = b.room_id;
  if r.housekeeping = 'maintenance' then raise exception 'Room % is under maintenance', r.number; end if;
  update public.bookings set status = 'checked_in', checked_in_at = now() where id = p_id returning * into b;
  return b;
end $$;

create or replace function public.booking_check_out(p_id uuid, p_method text default 'cash', p_paid numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bookings; f jsonb; v_due numeric; v_paid numeric;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform set_config('omnitill.booking_rpc', '1', true);
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status = 'checked_out' then
    return jsonb_build_object('booking_id', b.id, 'already', true, 'total', b.total_billed, 'paid', b.paid_total);
  end if;
  if b.status <> 'checked_in' then raise exception 'Only a checked-in guest can check out'; end if;
  f := public.booking_folio(p_id);
  v_due := (f ->> 'due')::numeric;
  if p_method is null or p_method not in ('cash', 'qris', 'card', 'transfer') then raise exception 'Invalid payment method'; end if;
  v_paid := coalesce(p_paid, greatest(v_due, 0));
  if v_due > 0 and v_paid < v_due then raise exception 'The guest still owes % (received %)', v_due, v_paid; end if;
  update public.bookings
     set status = 'checked_out', checked_out_at = now(), total_billed = (f ->> 'total')::numeric,
         paid_total = b.deposit + greatest(v_paid, 0), pay_method = p_method
   where id = p_id;
  update public.rooms set housekeeping = 'dirty' where id = b.room_id;
  perform public.audit('booking_checked_out', p_id::text, f || jsonb_build_object('paid', v_paid, 'method', p_method));
  return f || jsonb_build_object('paid', v_paid, 'method', p_method, 'refund', greatest(-v_due, 0), 'already', false);
end $$;

create or replace function public.booking_cancel(p_id uuid, p_reason text default '') returns public.bookings
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  perform set_config('omnitill.booking_rpc', '1', true);
  select * into b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status = 'cancelled' then return b; end if;
  if b.status <> 'reserved' then raise exception 'Only a reserved booking can be cancelled'; end if;
  update public.bookings
     set status = 'cancelled', note = trim(b.note || case when coalesce(p_reason, '') = '' then '' else E'\nCancelled: ' || p_reason end)
   where id = p_id returning * into b;
  perform public.audit('booking_cancelled', p_id::text, jsonb_build_object('reason', p_reason, 'deposit', b.deposit));
  return b;
end $$;

create or replace function public.room_set_housekeeping(p_room uuid, p_state text) returns public.rooms
language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  if not public.ot_has('cashier', 'manager', 'admin') then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_state not in ('clean', 'dirty', 'maintenance') then raise exception 'Invalid room state'; end if;
  if p_state = 'maintenance' and not public.ot_has('manager', 'admin') then raise exception 'Only a manager can put a room in maintenance'; end if;
  update public.rooms set housekeeping = p_state where id = p_room returning * into r;
  if not found then raise exception 'Room not found'; end if;
  return r;
end $$;

-- ---- Reports ----------------------------------------------------------------
create or replace function public.report_summary(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tz text; v_room numeric; v_totals jsonb; v_cogs numeric; v_exp numeric; v_methods jsonb; v_channels jsonb; v_days jsonb;
        v_top jsonb; v_low int; v_exp_cat jsonb; v_revenue numeric;
begin
  if not public.ot_has('manager', 'admin') then raise exception 'Only a manager or admin can view reports' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Invalid date range'; end if;
  if p_to - p_from > 400 then raise exception 'Date range is too long (400 days at most)'; end if;
  select timezone into tz from public.business where id = 1;

  drop table if exists _rs;
  create temporary table _rs on commit drop as
    select s.* from public.sales s
     where s.status = 'paid' and (s.created_at at time zone tz)::date between p_from and p_to;

  select jsonb_build_object('orders', count(*), 'subtotal', coalesce(sum(subtotal), 0), 'discount', coalesce(sum(discount), 0),
                            'service', coalesce(sum(service), 0), 'tax', coalesce(sum(tax), 0), 'total', coalesce(sum(total), 0)),
         coalesce(sum(subtotal - discount), 0)
    into v_totals, v_revenue from _rs;

  -- Room nights are revenue too (food charged to a room is already in the sales above).
  select coalesce(sum(total_billed - (select coalesce(sum(c.total), 0) from public.sales c
                                       where c.booking_id = b.id and c.method = 'room_charge' and c.status = 'paid')), 0)
    into v_room from public.bookings b
   where b.status = 'checked_out' and (b.checked_out_at at time zone tz)::date between p_from and p_to;
  v_revenue := v_revenue + v_room;

  select coalesce(sum(si.cost * si.qty), 0) into v_cogs from public.sale_items si join _rs on _rs.id = si.sale_id;
  select coalesce(sum(amount), 0) into v_exp from public.expenses where spent_on between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('method', method, 'orders', n, 'total', t) order by t desc), '[]'::jsonb) into v_methods
    from (select method, count(*) n, sum(total) t from _rs group by method) x;
  select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'total', t) order by t desc), '[]'::jsonb) into v_channels
    from (select channel, count(*) n, sum(total) t from _rs group by channel) x;
  select coalesce(jsonb_agg(jsonb_build_object('day', d, 'orders', n, 'total', t) order by d), '[]'::jsonb) into v_days
    from (select (created_at at time zone tz)::date d, count(*) n, sum(total) t from _rs group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'revenue', r) order by q desc), '[]'::jsonb) into v_top
    from (select si.name, sum(si.qty) q, sum(si.qty * si.price) r from public.sale_items si join _rs on _rs.id = si.sale_id
           group by si.name order by sum(si.qty) desc limit 10) x;
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'total', t) order by t desc), '[]'::jsonb) into v_exp_cat
    from (select category, sum(amount) t from public.expenses where spent_on between p_from and p_to group by category) x;
  select count(*) into v_low from public.ingredients where active and stock <= min_stock;

  return jsonb_build_object('from', p_from, 'to', p_to, 'totals', v_totals, 'revenue', v_revenue, 'room_revenue', v_room,
                            'cogs', v_cogs, 'expenses', v_exp, 'profit', v_revenue - v_cogs - v_exp,
                            'by_method', v_methods, 'by_channel', v_channels, 'by_day', v_days,
                            'top_products', v_top, 'expenses_by_category', v_exp_cat, 'low_stock', v_low);
end $$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles    enable row level security;
alter table public.business    enable row level security;
alter table public.categories  enable row level security;
alter table public.products    enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes     enable row level security;
alter table public.stock_moves enable row level security;
alter table public.rooms       enable row level security;
alter table public.bookings    enable row level security;
alter table public.shifts      enable row level security;
alter table public.sales       enable row level security;
alter table public.sale_items  enable row level security;
alter table public.expenses    enable row level security;
alter table public.audit_log   enable row level security;

do $$
declare t text; pol record;
begin
  -- Drop old policies so this file can be run again after an update.
  for pol in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- profiles: see yourself, managers and admins see everyone, only admins edit
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or (select public.ot_has('manager', 'admin')));
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.ot_has('admin'))) with check ((select public.ot_has('admin')));

-- business: staff read, admin edits
create policy business_select on public.business for select to authenticated
  using ((select public.ot_has('cashier', 'manager', 'admin')));
create policy business_update on public.business for update to authenticated
  using ((select public.ot_has('admin'))) with check ((select public.ot_has('admin')));

-- catalog: staff read, managers and admins edit
create policy categories_select on public.categories for select to authenticated using ((select public.ot_has('cashier', 'manager', 'admin')));
create policy categories_write  on public.categories for all to authenticated
  using ((select public.ot_has('manager', 'admin'))) with check ((select public.ot_has('manager', 'admin')));

create policy products_select on public.products for select to authenticated using ((select public.ot_has('cashier', 'manager', 'admin')));
create policy products_write  on public.products for all to authenticated
  using ((select public.ot_has('manager', 'admin'))) with check ((select public.ot_has('manager', 'admin')));

create policy ingredients_select on public.ingredients for select to authenticated using ((select public.ot_has('cashier', 'manager', 'admin')));
create policy ingredients_write  on public.ingredients for all to authenticated
  using ((select public.ot_has('manager', 'admin'))) with check ((select public.ot_has('manager', 'admin')));

create policy recipes_select on public.recipes for select to authenticated using ((select public.ot_has('manager', 'admin')));
create policy recipes_write  on public.recipes for all to authenticated
  using ((select public.ot_has('manager', 'admin'))) with check ((select public.ot_has('manager', 'admin')));

create policy stock_moves_select on public.stock_moves for select to authenticated using ((select public.ot_has('manager', 'admin')));

-- hotel: staff read rooms and bookings; edits through RPC or by managers
create policy rooms_select on public.rooms for select to authenticated using ((select public.ot_has('cashier', 'manager', 'admin')));
create policy rooms_write  on public.rooms for all to authenticated
  using ((select public.ot_has('manager', 'admin'))) with check ((select public.ot_has('manager', 'admin')));

create policy bookings_select on public.bookings for select to authenticated using ((select public.ot_has('cashier', 'manager', 'admin')));
create policy bookings_update on public.bookings for update to authenticated
  using ((select public.ot_has('manager', 'admin'))) with check ((select public.ot_has('manager', 'admin')));

-- shifts and sales: cashiers see their own, managers and admins see all. No direct writes.
create policy shifts_select on public.shifts for select to authenticated
  using (user_id = auth.uid() or (select public.ot_has('manager', 'admin')));

create policy sales_select on public.sales for select to authenticated
  using ((select public.ot_has('cashier', 'manager', 'admin'))
         and (cashier_id = auth.uid() or (select public.ot_has('manager', 'admin'))));
create policy sale_items_select on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create policy expenses_all on public.expenses for all to authenticated
  using ((select public.ot_has('manager', 'admin'))) with check ((select public.ot_has('manager', 'admin')));

create policy audit_select on public.audit_log for select to authenticated using ((select public.ot_has('admin')));

-- =============================================================================
-- Privileges: nobody anonymous, signed-in users go through RLS
-- =============================================================================
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema public from public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.sales, public.sale_items, public.shifts, public.stock_moves, public.audit_log from authenticated;
revoke insert, delete on public.bookings, public.profiles, public.business from authenticated;
grant execute on function
  public.ot_role(), public.ot_has(text[]), public.money_scale(),
  public.open_shift(numeric), public.close_shift(numeric, text), public.checkout(jsonb), public.void_sale(uuid, text),
  public.stock_adjust(uuid, text, numeric, text, numeric),
  public.booking_create(uuid, text, text, int, date, date, numeric, numeric, text), public.booking_folio(uuid),
  public.booking_check_in(uuid), public.booking_check_out(uuid, text, numeric), public.booking_cancel(uuid, text),
  public.room_set_housekeeping(uuid, text), public.report_summary(date, date)
  to authenticated;

-- =============================================================================
-- Realtime: other devices see changes straight away (Supabase only)
-- =============================================================================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['products', 'categories', 'ingredients', 'rooms', 'bookings', 'sales', 'business'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
