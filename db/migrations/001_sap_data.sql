-- Step 1: tables that hold the SAP export (sales, stock, masters).
-- Loads are upserts, so re-loading the same export is safe.

create table if not exists distributors (
  distributor_id   text primary key,
  distributor_name text not null,
  region           text not null,
  status           text not null
);

create table if not exists skus (
  sku_id               text primary key,
  sku_name             text not null,
  category             text not null,
  perishability        text not null check (perishability in ('Low', 'High')),
  standard_reorder_qty integer not null check (standard_reorder_qty > 0),
  unit_of_measure      text not null,
  distributor_id       text not null references distributors (distributor_id),
  -- Not in the SAP export yet. When null, the extract shows the first week of sales instead.
  launch_date          date
);

create table if not exists weekly_sales (
  sku_id     text not null references skus (sku_id),
  iso_week   text not null,           -- as exported, e.g. 2026-W27
  week_start date not null,           -- Monday of that ISO week
  units_sold integer not null check (units_sold >= 0),
  primary key (sku_id, week_start)
);

create table if not exists inventory_snapshots (
  sku_id        text not null references skus (sku_id),
  location      text not null,
  as_of_date    date not null,
  units_on_hand integer not null check (units_on_hand >= 0),
  primary key (sku_id, location, as_of_date)
);

-- Optional file. If it is never loaded, stock on order counts as 0 and every run warns.
create table if not exists open_purchase_orders (
  po_number     text not null,
  sku_id        text not null references skus (sku_id),
  qty_on_order  integer not null check (qty_on_order >= 0),
  expected_date date,
  as_of_date    date not null,
  primary key (po_number, sku_id, as_of_date)
);

create table if not exists festival_calendar (
  year_month        text primary key,  -- e.g. 2026-10
  is_festival_month boolean not null
);

create table if not exists load_batches (
  id         bigserial primary key,
  loaded_at  timestamptz not null default now(),
  source_dir text not null,
  row_counts jsonb not null,
  rejected   jsonb not null default '[]'
);
