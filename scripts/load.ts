// npm run load -- <folder> [<folder> ...]
// Loads one or more SAP export folders, in order. Default: ./seed-data
import "./env";
import { closePool } from "../src/lib/db";
import { loadSapExport } from "../src/lib/loader";

const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (dirs.length === 0) dirs.push("seed-data");

let failed = false;
for (const dir of dirs) {
  try {
    const r = await loadSapExport(dir);
    console.log(`\nLoaded ${dir} (batch #${r.batchId})`);
    console.table(r.rowCounts);
    if (r.missingFiles.length) console.log(`Not in this folder (skipped): ${r.missingFiles.join(", ")}`);
    if (r.rejected.length) {
      console.log(`Rejected ${r.rejected.length} row(s):`);
      for (const x of r.rejected) console.log(`  ${x.file}${x.line ? ` line ${x.line}` : ""}: ${x.reason}`);
    } else console.log("Rejected rows: none");
  } catch (err) {
    failed = true;
    console.error(`\nLoad of ${dir} failed, nothing was written: ${(err as Error).message}`);
  }
}
await closePool();
process.exit(failed ? 1 : 0);
