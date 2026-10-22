// npm run run:forecast -- [--date YYYY-MM-DD]
// Runs the full pipeline once and writes the Excel extract to ./output.
import "./env";
import fs from "node:fs";
import { closePool } from "../src/lib/db";
import { getExtract } from "../src/lib/queries";
import { executeRun } from "../src/lib/run";

const i = process.argv.indexOf("--date");
const runDate = i > 0 ? process.argv[i + 1] : null;

const out = await executeRun({ runDate, trigger: "cli", triggeredBy: "cli" });
console.log(`Run #${out.runId}: ${out.status.toUpperCase()} - ${out.message}`);
const extract = await getExtract(out.runId);
if (extract) {
  fs.mkdirSync("output", { recursive: true });
  const file = `output/freshroots-extract-${extract.runDate}-run${out.runId}.xlsx`;
  fs.writeFileSync(file, extract.xlsx);
  console.log(`Excel extract: ${file}`);
}
await closePool();
process.exit(out.status === "failed" ? 1 : 0);
