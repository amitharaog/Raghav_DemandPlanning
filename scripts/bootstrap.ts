// Runs before `next build` on Vercel (see "vercel-build" in package.json).
// With SEED_ON_BUILD=true it prepares an empty database: applies migrations,
// loads ./seed-data and ./seed-data/demo, and makes one forecast run if there
// are none yet. Every step is safe to repeat. Without the flag it only migrates.
import "./env";
import fs from "node:fs";
import path from "node:path";
import { closePool, getPool } from "../src/lib/db";
import { loadSapExport } from "../src/lib/loader";
import { executeRun } from "../src/lib/run";

if (!process.env.DATABASE_URL) {
  console.log("bootstrap: DATABASE_URL not set, skipping database setup.");
  process.exit(0);
}

const pool = getPool();
const dir = path.join(process.cwd(), "db", "migrations");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  await pool.query(fs.readFileSync(path.join(dir, file), "utf8"));
  console.log(`bootstrap: applied ${file}`);
}

if (process.env.SEED_ON_BUILD === "true") {
  for (const folder of ["seed-data", "seed-data/demo"]) {
    const r = await loadSapExport(folder);
    console.log(`bootstrap: loaded ${folder}`, r.rowCounts, `${r.rejected.length} rejected`);
  }
  const { rows } = await pool.query(`select count(*)::int as n from runs`);
  if (rows[0].n === 0) {
    const out = await executeRun({ trigger: "cli", triggeredBy: "first deploy" });
    console.log(`bootstrap: run #${out.runId} ${out.status} - ${out.message}`);
  } else {
    console.log(`bootstrap: ${rows[0].n} run(s) already exist, not running a forecast.`);
  }
}
await closePool();
