// Applies db/migrations/*.sql in name order. `--reset` drops everything first.
import fs from "node:fs";
import path from "node:path";
import "./env";
import { closePool, getPool } from "../src/lib/db";

const reset = process.argv.includes("--reset");
const dir = path.join(process.cwd(), "db", "migrations");

const pool = getPool();
if (reset) {
  await pool.query("drop schema public cascade; create schema public;");
  console.log("Database reset.");
}
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  await pool.query(fs.readFileSync(path.join(dir, file), "utf8"));
  console.log(`Applied ${file}`);
}
await closePool();
