# Freshroots demand planning

Replaces Raghav's monthly Excel forecast with a run every Monday and Thursday at
06:00 IST. The flow is fixed:

```
SAP export → Excel extract → Trends → Forecast (Raghav's rules) → Raghav's call (manual) → Zoho POs
```

The rules set every flag and quantity. Claude only writes a 1–2 line reason per
SKU, and a number check throws away any reason that quotes a figure not in the
rule result. Nothing is ordered without Raghav's approval.

## What's where

| Step | Code | What it does |
|---|---|---|
| 1. SAP | `src/lib/sapFiles.ts`, `src/lib/loader.ts` | Reads the SAP export CSVs into Postgres, one transaction per folder. Bad rows are rejected with a line number; a changed header stops the load. |
| 2. Excel | `src/lib/extract.ts` | One `.xlsx` per run: run info, sales by SKU by week, current stock, open POs, SKU attributes. |
| 3. Trends | `src/lib/trends.ts` | 4- and 12-week averages, weeks of stock, festival month. |
| 4. Forecast | `src/lib/rules.ts`, `src/lib/rules-config.ts` | Raghav's rules a–e in order. All thresholds live in `rules-config.ts`. |
| 4. Reasons | `src/lib/reasons.ts` | Claude writes reasons; templates take over if it is off, fails or gets numbers wrong. |
| 5. Raghav's call | `src/app/runs/[id]`, `src/lib/decisions.ts` | Approve / Change qty / Hold, a reason required for the last two, bulk approve, every decision timestamped (append-only). |
| 6. Zoho | `src/lib/zoho.ts` | Approved items only → Zoho Inventory PO import CSV. `submitPurchaseOrders()` is the one function to replace with the Zoho API. |
| Run | `src/lib/run.ts` | Wires it all together. Used by "Run now", the schedule and the CLI. |
| Kill switches | `src/lib/checks.ts`, `src/lib/killCriteria.ts` | Data checks halt a bad run; AI and pilot limits drive the kill call on the dashboard. |

Pages: **Dashboard** (`/`), **Raghav's review** (`/runs/:id`), **Trends** (`/runs/:id/trends`), **Run history** (`/history`).

## Run it locally

You need Node 22 and any Postgres 14+ (local install, Docker, or a free Supabase project).

```bash
npm install
cp .env.example .env          # set DATABASE_URL
createdb freshroots           # skip if using Supabase
npm run db:migrate
npm run load -- seed-data     # the real seed data
npm run load -- seed-data/demo   # optional: 3 demo SKUs so all 5 flags appear
npm run run:forecast -- --date 2026-10-22   # writes output/freshroots-extract-*.xlsx
npm run build && npm start    # http://localhost:3000
npm test                      # 65 tests, no database needed
```

The seed data's stock is as of 2026-10-19, so runs must use a run date of
2026-10-19 to 2026-10-22. Any later date is halted by the data checks on purpose
(stale stock). The dashboard's **Run now** has a date field for this. For
scheduled runs, set `RUN_DATE_OVERRIDE`.

Start again from scratch: `npm run db:reset && npm run load -- seed-data`.

## Loading new SAP data

Drop the export into a folder with these file names. Extra columns are ignored;
missing required columns stop the load.

| File | Required columns | Notes |
|---|---|---|
| `distributor_master.csv` | Distributor_ID, Distributor_Name, Region, Status | |
| `sku_master.csv` | SKU_ID, SKU_Name, Category, Perishability (Low/High), Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID | optional Launch_Date (YYYY-MM-DD) |
| `weekly_sales.csv` | SKU_ID, Week (ISO, e.g. 2026-W27), Units_Sold | a missing week means "no data", 0 means "sold nothing" |
| `current_inventory.csv` | SKU_ID, Location, Units_On_Hand, As_Of_Date | multiple locations are summed |
| `calendar.csv` | Year_Month, Is_Festival_Month (TRUE/FALSE) | months not listed fall back to Oct/Nov/Mar |
| `open_purchase_orders.csv` | PO_Number, SKU_ID, Qty_On_Order, As_Of_Date | optional Expected_Date. Not in the seed data: until it is loaded, stock on order = 0 and every run warns |

Then `npm run load -- path/to/folder`. Loading the same file twice is safe (upserts).
Any file can be left out of a folder; the others still load.

## Raghav's rules (as implemented)

Applied in this order. Thresholds are in `src/lib/rules-config.ts`.

- **e (inputs)**: under 12 weeks of history, missing weeks in the 12-week window, no stock figure, or zero sales in the last 4 weeks → **Needs Raghav's judgment** (no quantity).
- **a**: festival month (Oct, Nov, Mar) → expected weekly demand = 4-week average × 1.25, before any threshold.
- **b**: 4-week average more than 20% above the 12-week average → **High demand**, reorder 1.5× standard qty (rounded up).
- **c**: standard SKUs: weeks of stock < 6 → **Stockout risk**, reorder standard qty now; > 14 → **Overstock risk**, pause next order.
- **d**: high-perishability SKUs use < 3 and > 4 weeks instead.
- **e (conflict)**: High demand + Overstock risk → **Needs Raghav's judgment**. High demand + Stockout risk agree, so they become High demand at 1.5×.
- Otherwise **OK**, no action.

Weeks of stock = (stock in hand + stock on order) ÷ expected weekly demand.

## Kill criteria

| Gate | Trips when | What happens |
|---|---|---|
| Data (per run) | stock snapshot > 3 days old; latest sales week isn't last week; > 5% of SKUs without sales or stock; sales rows down > 20% vs last run; unknown SKU/distributor IDs in the last load | Run is halted, nothing is published, dashboard shows why. Two halts in a row = kill call. |
| AI | > 10% of a run's LLM reasons fail the number check; or Raghav marks > 10% of reasons wrong | That run uses template reasons. Set `LLM_REASONS=off` to switch the LLM off for good. Rules and quantities are unaffected. |
| Pilot: rules fit | Raghav changes or holds > 30% of rule results, or > 30% of SKUs go to judgment (he says the rules cover 80–85%) | Kill call: stop and rework the rules. |
| Pilot: business | at day 90, stockout + write-off losses fall < 15% vs the case-study baseline of ₹28–34 lakh/quarter (finance enters actuals on the dashboard) | Kill call: stop the pilot. 15% ≈ ₹4.6 lakh/quarter, which repays the ₹15 lakh budget within a year. |

## Deploy (Vercel + Supabase)

1. Create a Supabase project. Either:
   - **One paste:** open SQL Editor → New query, paste `supabase/setup.sql`, Run. It creates
     the tables (with row-level security on, so Supabase's public API can't read them) and
     loads the seed data, the demo SKUs, run 1 with Raghav's decisions and the Zoho export.
   - **Or from a terminal:** set `DATABASE_URL` to the project's connection string, then
     `npm run db:migrate && npm run load -- seed-data seed-data/demo`.
2. Copy the connection string (Connect → Session pooler) into `DATABASE_URL` for Vercel.
3. Import the repo into Vercel. Set `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `APP_PASSWORD`.
4. `vercel.json` schedules `/api/cron` at `30 0 * * 1,4` (UTC) = Mon & Thu 06:00 IST.

The SAP load is a CLI step for the pilot: IT runs `npm run load` after each SAP
export, before 06:00 on Monday and Thursday. If they forget, the data checks halt
the run rather than forecasting on old numbers.

### Vercel + Neon (what the live demo uses)

Set `DATABASE_URL` (Neon's direct connection string, not the `-pooler` one: the run
lock needs a stable session), `RUN_DATE_OVERRIDE=2026-10-22` and `SEED_ON_BUILD=true`.
Vercel's build runs `vercel-build`, which applies migrations, loads the seed and demo
data and makes one forecast run if there is none. All of it is safe to repeat. Remove
`SEED_ON_BUILD` once real SAP data is loaded, so a deploy never reloads the seed files.

## Zoho Inventory

Approved orders can go to Zoho in two ways, both from the Purchase orders card:

- **Send to Zoho as drafts** (when Zoho is connected): one draft PO per vendor, matched
  to Zoho by vendor name and SKU. A PO number is never sent twice. Procurement still
  issues each draft in Zoho. If a vendor or SKU isn't in Zoho, that PO shows "Not sent"
  with the reason.
- **Download CSV**: the Zoho purchase-order import file, always available.

**Connect once:**
1. In the Zoho API Console (api-console.zoho.in), use a *Server-based Application* client with
   redirect URI `https://<your-app>.vercel.app/api/zoho/callback`. (A *Self Client* works too:
   generate a code with the scopes below and paste it under "Using a Self Client?".)
2. Set `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` in Vercel and redeploy.
3. Press **Connect Zoho** on the Overview and approve. The refresh token is stored encrypted
   (key derived from the client secret, so rotating the secret means connecting again).

Scopes: `ZohoInventory.purchaseorders.CREATE, ZohoInventory.purchaseorders.READ,
ZohoInventory.contacts.READ, ZohoInventory.items.READ, ZohoInventory.settings.READ`.
Optional: `ZOHO_ACCOUNTS_URL` (default `https://accounts.zoho.in`), `ZOHO_ORG_ID` (default: the
first Zoho Inventory organization).

**Sync open POs** pulls issued, not-yet-received POs from Zoho into stock on order for the
next run (ordered minus received, drafts excluded). The code lives in `src/lib/zohoApi.ts`;
`submitPurchaseOrders()` in `src/lib/zoho.ts` is still the single place POs are sent from.

**Setting up Zoho for the first time:** `docs/zoho-import/vendors.csv` and `items.csv` hold all
4 distributors and 18 SKUs from the SAP masters. Import them with Purchases → Vendors → Import File
and Items → Import File (vendors first). Cost and selling prices are placeholders of ₹1; change them to the real figures.
