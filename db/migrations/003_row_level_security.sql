-- Supabase exposes every table in the public schema through its REST API using
-- the project's anon key. Turning on row-level security with no policies closes
-- that door. The app connects with the database connection string (table owner),
-- which RLS does not restrict, so the app is unaffected. Harmless on plain Postgres.

alter table distributors          enable row level security;
alter table skus                  enable row level security;
alter table weekly_sales          enable row level security;
alter table inventory_snapshots   enable row level security;
alter table open_purchase_orders  enable row level security;
alter table festival_calendar     enable row level security;
alter table load_batches          enable row level security;
alter table runs                  enable row level security;
alter table recommendations       enable row level security;
alter table decisions             enable row level security;
alter table zoho_exports          enable row level security;
alter table pilot_outcomes        enable row level security;
