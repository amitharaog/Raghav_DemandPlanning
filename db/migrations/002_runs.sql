-- Steps 4-8: runs, recommendations, Raghav's decisions and Zoho exports.

create table if not exists runs (
  id                   bigserial primary key,
  run_date             date not null,
  trigger              text not null check (trigger in ('manual', 'schedule', 'cli')),
  triggered_by         text,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  status               text not null check (status in ('running', 'completed', 'halted', 'failed')),
  halt_reasons         jsonb not null default '[]',
  warnings             jsonb not null default '[]',
  error                text,
  sku_count            integer,
  flag_counts          jsonb,
  sales_rows_in_window integer,
  reasons_report       jsonb,
  load_batch_id        bigint references load_batches (id),
  extract_xlsx         bytea
);

create table if not exists recommendations (
  id               bigserial primary key,
  run_id           bigint not null references runs (id) on delete cascade,
  sku_id           text not null,
  sku_name         text not null,
  perishability    text not null,
  unit_of_measure  text not null,
  distributor_id   text not null,
  distributor_name text not null,
  flag             text not null,
  action           text not null,
  suggested_qty    integer,
  rule_fired       text not null,
  rule_trace       jsonb not null,
  also_flagged     jsonb not null,
  judgment_reasons jsonb not null,
  numbers          jsonb not null,
  reason           text not null,
  reason_source    text not null check (reason_source in ('llm', 'template')),
  -- Raghav's feedback on the reason text (feeds the AI kill criterion).
  reason_marked_wrong boolean not null default false,
  unique (run_id, sku_id)
);

-- Append-only: every click is kept. The latest row per recommendation is the decision.
create table if not exists decisions (
  id                bigserial primary key,
  recommendation_id bigint not null references recommendations (id) on delete cascade,
  decision          text not null check (decision in ('APPROVE', 'CHANGE_QTY', 'HOLD')),
  final_qty         integer check (final_qty >= 0),
  reason            text,
  decided_by        text not null,
  decided_at        timestamptz not null default now(),
  bulk              boolean not null default false,
  check (decision = 'APPROVE' or (reason is not null and length(trim(reason)) > 0))
);
create index if not exists decisions_by_rec on decisions (recommendation_id, id desc);

create table if not exists zoho_exports (
  id          bigserial primary key,
  run_id      bigint not null references runs (id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  text not null,
  po_count    integer not null,
  line_count  integer not null,
  csv         text not null
);

-- Business kill criterion: finance enters actual losses per quarter.
create table if not exists pilot_outcomes (
  id                  bigserial primary key,
  period_label        text not null,
  stockout_loss_lakh  numeric not null check (stockout_loss_lakh >= 0),
  writeoff_loss_lakh  numeric not null check (writeoff_loss_lakh >= 0),
  entered_by          text not null,
  entered_at          timestamptz not null default now()
);
