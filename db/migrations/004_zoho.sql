-- Live Zoho Inventory connection. One row: the org this app sends POs to.
create table if not exists zoho_connection (
  id                 integer primary key default 1 check (id = 1),
  accounts_server    text not null,
  api_domain         text not null,
  refresh_token_enc  text not null,   -- AES-256-GCM, key derived from ZOHO_CLIENT_SECRET
  organization_id    text not null,
  organization_name  text not null,
  connected_by       text not null,
  connected_at       timestamptz not null default now()
);

alter table zoho_exports add column if not exists channel text not null default 'csv';

-- One row per PO the app tried to create in Zoho, so a PO is never sent twice.
create table if not exists zoho_po_results (
  id              bigserial primary key,
  export_id       bigint not null references zoho_exports (id) on delete cascade,
  po_number       text not null,
  vendor_name     text not null,
  status          text not null check (status in ('created', 'failed', 'skipped')),
  zoho_po_id      text,
  zoho_po_number  text,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists zoho_po_results_by_po on zoho_po_results (po_number, status);

alter table zoho_connection enable row level security;
alter table zoho_po_results enable row level security;
