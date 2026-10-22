# Demo-only additions (NOT real Freshroots data)

The real seed data produces no "Needs Raghav's judgment" SKUs: every SKU has 16
clean weeks and no conflicting flags. These three made-up SKUs exist only so a
demo run shows all five flag types. Load them on top of the real seed data:

    npm run load -- seed-data seed-data/demo

| SKU | Why it is here | Expected result |
|---|---|---|
| SKU016 Millet Chips | New launch, only 6 weeks of sales | Needs judgment (under 12 weeks of history) |
| SKU017 Jaggery Powder | 3 weeks missing from the SAP export inside the 12-week window | Needs judgment (missing data) |
| SKU018 Masala Makhana | Sales jumped 43% but 4,000 units already in stock | Needs judgment (High demand and Overstock conflict) |

To go back to real data only: `npm run db:reset && npm run load`.
